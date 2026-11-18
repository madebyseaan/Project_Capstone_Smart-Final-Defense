import "dotenv/config";
import { PrismaClient, Term, GradeStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveCanonicalWeights } from "./canonicalGrade";
import { finalizeSectionEosy } from "../src/lib/promotion";
import { completeRemedial } from "../src/lib/remedial";
import { normalizeProgramCode } from "../src/lib/programCode";
import { pickProgramFailureStudents } from "./seedProgramFailure";
import {
  STE_ELIGIBLE_TIERS,
  TIER_LABELS,
  TIER_QG,
  buildGradeForTarget,
  hashStr,
  initGradingMode,
  initTransmutation,
  seededRandom,
  type SpecialStudent,
  type StudentInfo,
  type Tier,
} from "./seedTeacherScoresCore";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const VALID_TERMS: Term[] = ["T1", "T2", "T3"];

// Programs with DepEd minimum-grade retention rules:
//   SPA - 85% in specialization, no failing grade, >=80% in other subjects
//   SPS - 85% in specialization, >=80% in other subjects, no failing grade
//   STE - 85% average in Science/Math/English, 83% in the rest, no grade <80%
// Seeding these learners at 85+ everywhere keeps demo cohorts program-eligible;
// only the intentional program-failure learner drops below.
const HIGH_RETENTION_PROGRAMS = new Set(["STE", "SPA", "SPS"]);

// School names an older seed run fabricated for transferee `previousSchool`.
// Kept only so --clear-transferee-details can remove those fabricated values;
// real data comes from the EnrollPro transferee feed (contract v1.1).
const SEEDED_TRANSFEREE_SCHOOLS = [
  "San Jose National High School", "Sta. Rosa National High School",
  "Binalbagan National High School", "La Castellana National High School",
  "Hinigaran National High School (Annex)", "Pontevedra National High School",
  "Pulupandan National High School", "Valladolid National High School",
  "San Enrique National High School", "Ilog National High School",
];

// ─── Per-Subject Tier Assignment ─────────────────────────────────────────────

function pickSpecialStudents(
  students: StudentInfo[],
  studentSubjects: Map<string, string[]>,
  retainedCount: number,
  remedialCount: number,
  studentGradeLevels: Map<string, string>,
  studentPrograms: Map<string, string>,
  retainedGrade: string | null,
  remedialGrade: string | null,
  transfereeIds: Set<string>,
): SpecialStudent[] {
  // Special picks come from REGULAR sections only: a failing STE/SPA/SPS learner
  // exits the program rather than being retained in it, so seeding them as
  // retained/remedial would misrepresent the program rules.
  const isRegular = (s: StudentInfo) =>
    (studentPrograms.get(s.id) ?? "REGULAR").toUpperCase() === "REGULAR";

  // Filter students by program + grade level, and exclude transferees
  const retainedPool = students.filter(s => {
    if (!isRegular(s)) return false;
    if (transfereeIds.has(s.id)) return false;
    if (retainedGrade) {
      const gl = studentGradeLevels.get(s.id);
      return gl === `GRADE_${retainedGrade}`;
    }
    return true;
  });

  const remedialPool = students.filter(s => {
    if (!isRegular(s)) return false;
    if (transfereeIds.has(s.id)) return false;
    if (remedialGrade) {
      const gl = studentGradeLevels.get(s.id);
      return gl === `GRADE_${remedialGrade}`;
    }
    return true;
  });

  const sortedRetained = [...retainedPool].sort((a, b) => {
    const cmp = (a.lastName ?? "").localeCompare(b.lastName ?? "");
    return cmp !== 0 ? cmp : (a.firstName ?? "").localeCompare(b.firstName ?? "");
  });

  const sortedRemedial = [...remedialPool].sort((a, b) => {
    const cmp = (a.lastName ?? "").localeCompare(b.lastName ?? "");
    return cmp !== 0 ? cmp : (a.firstName ?? "").localeCompare(b.firstName ?? "");
  });

  if (sortedRetained.length < retainedCount) {
    console.log(`  Note: only ${sortedRetained.length} REGULAR student(s) eligible for retained picks (requested ${retainedCount}).`);
  }
  if (sortedRemedial.length < remedialCount) {
    console.log(`  Note: only ${sortedRemedial.length} REGULAR student(s) eligible for remedial picks (requested ${remedialCount}).`);
  }

  const result: SpecialStudent[] = [];
  const usedIds = new Set<string>();

  // Pick retained students from middle of the list
  const midStart = Math.floor(sortedRetained.length * 0.3);
  for (let i = 0; i < retainedCount && midStart + i < sortedRetained.length; i++) {
    const idx = midStart + i;
    const student = sortedRetained[idx];
    usedIds.add(student.id);
    const enrolled = studentSubjects.get(student.id) ?? [];
    const rand = seededRandom(hashStr(student.id + "-retained"));
    const shuffled = [...enrolled].sort(() => rand() - 0.5);
    result.push({
      studentId: student.id,
      failedSubjects: shuffled.slice(0, Math.min(4, shuffled.length)),
      type: "RETAINED",
    });
  }

  // Pick remedial students from later in the list
  const remedialStart = Math.floor(sortedRemedial.length * 0.6);
  let picked = 0;
  for (let i = remedialStart; i < sortedRemedial.length && picked < remedialCount; i++) {
    const student = sortedRemedial[i];
    if (usedIds.has(student.id)) continue;
    usedIds.add(student.id);
    const enrolled = studentSubjects.get(student.id) ?? [];
    const rand = seededRandom(hashStr(student.id + "-remedial"));
    const shuffled = [...enrolled].sort(() => rand() - 0.5);
    const failCount = rand() > 0.5 ? 2 : 1;
    result.push({
      studentId: student.id,
      failedSubjects: shuffled.slice(0, Math.min(failCount, shuffled.length)),
      type: "REMEDIAL",
    });
    picked++;
  }

  return result;
}

// Remedial failed subjects alternate between final 70 and 71 (deterministic per student)
function remedialFailTier(studentId: string): Tier {
  return hashStr(studentId + "-remedialfail") % 2 === 0 ? "REMEDIAL_FAIL_70" : "REMEDIAL_FAIL_71";
}

function getTierForStudentSubject(
  studentId: string,
  subjectCode: string,
  term: Term,
  specialStudents: SpecialStudent[],
  normalTiers: Map<string, Tier>,
  studentPrograms: Map<string, string>,
): { tier: Tier; isFailedSubject: boolean } {
  const special = specialStudents.find(s => s.studentId === studentId);
  if (!special) {
    return { tier: normalTiers.get(studentId) ?? "AVERAGE", isFailedSubject: false };
  }

  const isFailed = special.failedSubjects.includes(subjectCode);
  if (!isFailed) {
    // Program learners keep their 85+ tiers in non-failed subjects so only the
    // intentional failure can affect program eligibility. REGULAR special picks
    // (retained/remedial) use AVERAGE for their passing subjects.
    const program = normalizeProgramCode(studentPrograms.get(studentId));
    if (HIGH_RETENTION_PROGRAMS.has(program)) {
      return { tier: normalTiers.get(studentId) ?? "STE_ELIGIBLE", isFailedSubject: false };
    }
    return { tier: "AVERAGE", isFailedSubject: false };
  }

  if (special.type === "RETAINED") {
    // Retained: fail all 3 terms with AT_RISK grades (QG ≈ 70, 68, 72 — all < 75)
    return { tier: "AT_RISK", isFailedSubject: true };
  }

  // REMEDIAL: fail ALL terms at exactly 70 or 71 (final rating 70-71)
  return { tier: remedialFailTier(studentId), isFailedSubject: true };
}

function assignNormalTiers(students: StudentInfo[], studentPrograms: Map<string, string>): Map<string, Tier> {
  const sorted = [...students].sort((a, b) => {
    const cmp = (a.lastName ?? "").localeCompare(b.lastName ?? "");
    return cmp !== 0 ? cmp : (a.firstName ?? "").localeCompare(b.firstName ?? "");
  });

  const tiers = new Map<string, Tier>();
  // NOTE: no AT_RISK here — normal students must never fail (only the picked
  // retained/remedial special students fail subjects).
  const patterns: Tier[][] = [
    ["HIGHEST_HONORS", "AVERAGE", "BELOW_AVG", "AVERAGE"],
    ["HIGH_HONORS", "ABOVE_AVG", "AVERAGE", "BELOW_AVG"],
    ["HONORS", "AVERAGE", "ABOVE_AVG", "AVERAGE"],
    ["HIGH_HONORS", "AVERAGE", "BELOW_AVG", "AVERAGE"],
    ["HONORS", "ABOVE_AVG", "AVERAGE", "BELOW_AVG"],
    ["HIGHEST_HONORS", "AVERAGE", "BELOW_AVG", "ABOVE_AVG"],
  ];

  const patternIdx = sorted.length > 0 ? (sorted[0].lastName?.charCodeAt(0) ?? 0) % patterns.length : 0;
  const pattern = patterns[patternIdx];

  for (let i = 0; i < sorted.length; i++) {
    const student = sorted[i];
    const program = normalizeProgramCode(studentPrograms.get(student.id));
    // SPA/SPS/STE learners must stay at 85+ in every subject to remain eligible
    // for their programs — never give them a mixed pattern tier.
    if (HIGH_RETENTION_PROGRAMS.has(program)) {
      tiers.set(student.id, STE_ELIGIBLE_TIERS[i % STE_ELIGIBLE_TIERS.length]);
      continue;
    }
    tiers.set(student.id, pattern[i % pattern.length]);
  }

  return tiers;
}

// ─── Remarks Logic ───────────────────────────────────────────────────────────

function getRemarks(
  tier: Tier,
  term: Term,
  quarterlyGrade: number | null,
  isFailedSubject: boolean,
  isRemedialStudent: boolean,
): string | null {
  if (quarterlyGrade === null) return null;

  if (isRemedialStudent && isFailedSubject) {
    // Remedial student's failed subject (final rating 70-71)
    return "Remedial Class";
  }

  return quarterlyGrade >= 75 ? "Passed" : "Failed";
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  terms: Term[];
  finalized: boolean;
  clear: boolean;
  dryRun: boolean;
  retainedCount: number;
  remedialCount: number;
  retainedGrade: string | null;
  remedialGrade: string | null;
  programFailCount: number;
  programFailGrade: string | null;
  programFailProgram: string | null;
  completeTransferees: boolean;
  clearTransfereeDetails: boolean;
  keepRemedialPending: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const clearTransfereeDetails = args.includes("--clear-transferee-details");

  if (args.length === 0 || args[0] === "--help") {
    console.error("Usage: npx ts-node prisma/seed-teacher-scores.ts <T1|T2|T3|--all> [flags]");
    console.error("       npx ts-node prisma/seed-teacher-scores.ts --clear-transferee-details");
    console.error("Flags:");
    console.error("  --finalized            Set status=FINALIZED (default: DRAFT)");
    console.error("  --clear                Delete existing grades for this SY first");
    console.error("  --dry-run              Print what would be seeded, write nothing");
    console.error("  --retained N           Number of retained students (default: 2)");
    console.error("  --retained-grade G     Restrict retained picks to this grade (e.g. 9)");
    console.error("  --remedial N           Number of remedial students (default: 2)");
    console.error("  --remedial-grade G     Restrict remedial picks to this grade (e.g. 8)");
    console.error("  --program-fail N       Special-program learners failing exactly 1 subject (default: 0, G7-G9 only)");
    console.error("  --program-fail-grade G Restrict program-failure picks to this grade (e.g. 7)");
    console.error("  --program-fail-program P Restrict program-failure picks to this program (e.g. STE)");
    console.error("  --complete-transferees Fill in missing birth date/sex for existing transferees");
    console.error("  --keep-remedial-pending  Leave seeded remedial rows PENDING (blocks rollover)");
    console.error("  --clear-transferee-details  Standalone mode: remove seed-fabricated previous-school");
    console.error("                              details so the EnrollPro sync can fill the real values");
    process.exit(1);
  }

  const firstArg = args[0];
  let terms: Term[] = [];

  if (clearTransfereeDetails) {
    // Standalone cleanup mode — skips all grade seeding.
  } else if (firstArg === "--all") {
    terms = ["T1", "T2", "T3"];
  } else if (VALID_TERMS.includes(firstArg as Term)) {
    terms = [firstArg as Term];
  } else {
    console.error(`Invalid term: "${firstArg}". Use T1, T2, T3, or --all`);
    process.exit(1);
  }

  const remaining = args.slice(1);
  const retainedIdx = remaining.indexOf("--retained");
  const remedialIdx = remaining.indexOf("--remedial");
  const retainedGradeIdx = remaining.indexOf("--retained-grade");
  const remedialGradeIdx = remaining.indexOf("--remedial-grade");
  const programFailIdx = remaining.indexOf("--program-fail");
  const programFailGradeIdx = remaining.indexOf("--program-fail-grade");
  const programFailProgramIdx = remaining.indexOf("--program-fail-program");

  return {
    terms,
    finalized: remaining.includes("--finalized"),
    clear: remaining.includes("--clear"),
    dryRun: remaining.includes("--dry-run"),
    retainedCount: retainedIdx >= 0 ? parseInt(remaining[retainedIdx + 1] ?? "2", 10) : 2,
    remedialCount: remedialIdx >= 0 ? parseInt(remaining[remedialIdx + 1] ?? "2", 10) : 2,
    retainedGrade: retainedGradeIdx >= 0 ? (remaining[retainedGradeIdx + 1] ?? null) : null,
    remedialGrade: remedialGradeIdx >= 0 ? (remaining[remedialGradeIdx + 1] ?? null) : null,
    programFailCount: programFailIdx >= 0 ? parseInt(remaining[programFailIdx + 1] ?? "0", 10) : 0,
    programFailGrade: programFailGradeIdx >= 0 ? (remaining[programFailGradeIdx + 1] ?? null) : null,
    programFailProgram: programFailProgramIdx >= 0 ? (remaining[programFailProgramIdx + 1] ?? null) : null,
    completeTransferees: remaining.includes("--complete-transferees"),
    clearTransfereeDetails,
    keepRemedialPending: remaining.includes("--keep-remedial-pending"),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function resolveSchoolYear(): Promise<{ label: string; id: string; gradingMode: "TRANSMUTED" | "ZERO_BASED" }> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  if (!settings?.schoolYearId) {
    console.error("No active school year. Run EnrollPro sync first.");
    process.exit(1);
  }
  const sy = await prisma.schoolYear.findUnique({ where: { id: settings.schoolYearId } });
  if (!sy) {
    console.error("Active school year not found in DB.");
    process.exit(1);
  }
  return { label: sy.label, id: sy.id, gradingMode: sy.gradingMode };
}

// Remove previous-school details fabricated by older seed runs so the EnrollPro
// transferee feed (contract v1.1) can fill the real values under fill-nulls-only.
async function clearSeededTransfereeDetails(schoolYearLabel: string): Promise<void> {
  const transferees = await prisma.enrollment.findMany({
    where: { schoolYear: schoolYearLabel, transferInDate: { not: null }, status: "ENROLLED" },
    include: { student: true, section: true },
  });

  let clearedCount = 0;
  for (const t of transferees) {
    const clearData: Record<string, any> = {};
    const last6 = t.student.lrn?.slice(-6);
    if (last6 && t.student.transferCertNo === `TC-${last6}`) {
      clearData.transferCertNo = null;
    }
    if (t.student.previousSchool && SEEDED_TRANSFEREE_SCHOOLS.includes(t.student.previousSchool)) {
      clearData.previousSchool = null;
    }
    const gradeNum = parseInt(t.section.gradeLevel.replace("GRADE_", "")) - 1;
    if (t.student.lastGradeCompleted === `Grade ${gradeNum > 0 ? gradeNum : 6}`) {
      clearData.lastGradeCompleted = null;
    }

    if (Object.keys(clearData).length > 0) {
      await prisma.student.update({ where: { id: t.studentId }, data: clearData });
      clearedCount++;
      console.log(`  Cleared: ${t.student.lastName}, ${t.student.firstName} (${Object.keys(clearData).join(", ")})`);
    }
  }

  console.log(`\n  Learners cleared: ${clearedCount} of ${transferees.length}`);
  console.log(`  Run a sync to fill real values from the EnrollPro transferee feed.`);
}

async function main() {
  const args = parseArgs();
  const startTime = Date.now();

  console.log(`=== SMART Teacher Score Seed Script ===`);
  if (args.clearTransfereeDetails) {
    console.log(`Mode: CLEAR SEEDED TRANSFEREE DETAILS (standalone — no grade seeding)`);
  } else {
    console.log(`Terms: ${args.terms.join(", ")} | Finalized: ${args.finalized} | Clear: ${args.clear} | Dry-run: ${args.dryRun}`);
    console.log(`Retained: ${args.retainedCount}${args.retainedGrade ? ` (Grade ${args.retainedGrade})` : ""} (REGULAR only, fails 4 subjects) | Remedial: ${args.remedialCount}${args.remedialGrade ? ` (Grade ${args.remedialGrade})` : ""} (REGULAR only, fails 1-2 subjects, final 70-71)`);
    console.log(`Program failures: ${args.programFailCount}${args.programFailGrade ? ` (Grade ${args.programFailGrade})` : ""}${args.programFailProgram ? ` (${args.programFailProgram} only)` : ""} (special programs only, G7-G9, fails exactly 1 subject)`);
    if (args.completeTransferees) console.log(`Transferee completion: ENABLED`);
  }

  const { label: schoolYearLabel, gradingMode } = await resolveSchoolYear();
  console.log(`Active school year: ${schoolYearLabel} | Grading mode: ${gradingMode}\n`);

  if (args.clearTransfereeDetails) {
    await clearSeededTransfereeDetails(schoolYearLabel);
    console.log(`\nDone in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    return;
  }

  // Load canonical grading config from the DB so seeded grades match what the
  // app computes (class record ledger recompute + SF9/SF10 display)
  const transmutationTable = await prisma.transmutationEntry.findMany({ orderBy: { minGrade: "asc" } });
  if (transmutationTable.length === 0) {
    console.error("TransmutationEntry table is empty — run `npm run prisma:seed` first.");
    process.exit(1);
  }
  initTransmutation(transmutationTable);
  initGradingMode(gradingMode);
  const gradingConfigs = await prisma.gradingConfig.findMany();

  let adminUserId: string | null = null;
  if (args.finalized) {
    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!adminUser) {
      console.error("Admin user not found. Run prisma:seed first.");
      process.exit(1);
    }
    adminUserId = adminUser.id;
  }

  const allSections = await prisma.section.findMany({
    where: { schoolYear: schoolYearLabel },
    orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
  });
  console.log(`Found ${allSections.length} sections for SY ${schoolYearLabel}`);

  // Sections that actually have active teaching loads — grades are only seeded
  // for these, so the program-failure picker must not choose anywhere else.
  const activeCaRows = await prisma.classAssignment.findMany({
    where: { schoolYear: schoolYearLabel, isActive: true },
    select: { sectionId: true },
    distinct: ["sectionId"],
  });
  const sectionsWithActiveCa = new Set(activeCaRows.map((row) => row.sectionId));

  // Collect all unique students across all sections (and per-section student ids
  // for the program-failure picker).
  const studentMap = new Map<string, StudentInfo>();
  const sectionStudentIds = new Map<string, string[]>();
  for (const sec of allSections) {
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId: sec.id, status: "ENROLLED", isArchived: false },
      include: { student: true },
    });
    const ids: string[] = [];
    for (const e of enrollments) {
      ids.push(e.studentId);
      if (!studentMap.has(e.studentId)) {
        studentMap.set(e.studentId, {
          id: e.studentId,
          firstName: e.student.firstName,
          lastName: e.student.lastName,
        });
      }
    }
    sectionStudentIds.set(sec.id, ids);
  }

  const allStudents = [...studentMap.values()];
  console.log(`Unique students: ${allStudents.length}`);

  // Build student → grade level / program maps (from their enrollment section)
  const studentGradeLevels = new Map<string, string>();
  const studentPrograms = new Map<string, string>();
  for (const sec of allSections) {
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId: sec.id, status: "ENROLLED", isArchived: false },
    });
    for (const e of enrollments) {
      if (!studentGradeLevels.has(e.studentId)) {
        studentGradeLevels.set(e.studentId, sec.gradeLevel);
        studentPrograms.set(e.studentId, sec.program);
      }
    }
  }

  // Build transferee set (enrollments with transferInDate set)
  const transfereeEnrollments = await prisma.enrollment.findMany({
    where: { schoolYear: schoolYearLabel, transferInDate: { not: null }, status: "ENROLLED" },
    select: { studentId: true },
  });
  const transfereeIds = new Set(transfereeEnrollments.map(e => e.studentId));
  console.log(`Transferees: ${transfereeIds.size}`);

  const steCount = [...studentPrograms.values()].filter((p) => p.toUpperCase() === "STE").length;
  console.log(`STE learners: ${steCount} (seeded at 85+ in every subject)`);

  // Collect per-student enrolled subjects (from class assignments in their sections).
  // HG and non-promotional subjects are excluded — they never count as failed
  // subjects for retained/remedial classification (matches promotion.ts logic).
  const studentSubjects = new Map<string, string[]>();
  for (const sec of allSections) {
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId: sec.id, status: "ENROLLED", isArchived: false },
    });
    const cas = await prisma.classAssignment.findMany({
      where: { sectionId: sec.id, schoolYear: schoolYearLabel, isActive: true },
      include: { subject: true },
    });
    const subjectCodes = cas
      .filter((ca) => !ca.subject.code.toUpperCase().startsWith("HG") && !ca.subject.isNonPromotional)
      .map((ca) => ca.subject.code);
    for (const e of enrollments) {
      const existing = studentSubjects.get(e.studentId) ?? [];
      const merged = [...new Set([...existing, ...subjectCodes])];
      studentSubjects.set(e.studentId, merged);
    }
  }

  // Rotation groups count as ONE learning area (e.g. TLE exploratory: ICT/AFA/FCS
  // are term strands, merged before promotion). Failing a single strand does not
  // fail the merged subject while the other strands pass — expand each picked
  // failed subject to its whole rotation group so EOSY finalize sees a real
  // failure and produces a single canonical remedial row (e.g. "TLE").
  // Loaded before picking so the program-failure picker can avoid rotation strands.
  const rotationSubjects = await prisma.subject.findMany({
    where: { rotationTermGroupId: { not: null } },
    select: { code: true, rotationTermGroupId: true },
  });
  const rotationGroupByCode = new Map(
    rotationSubjects.map((s) => [s.code, s.rotationTermGroupId as string]),
  );

  // Pick special students (retained & remedial) — REGULAR sections only
  const specialStudents = pickSpecialStudents(
    allStudents, studentSubjects, args.retainedCount, args.remedialCount,
    studentGradeLevels, studentPrograms, args.retainedGrade, args.remedialGrade, transfereeIds,
  );

  // Controlled special-program failure (1 overall by default, G7-G9, exactly 1 subject)
  specialStudents.push(
    ...pickProgramFailureStudents(
      allSections,
      sectionStudentIds,
      studentMap,
      studentSubjects,
      sectionsWithActiveCa,
      args.programFailCount,
      args.programFailGrade,
      args.programFailProgram,
      transfereeIds,
      rotationGroupByCode,
    ),
  );

  for (const sp of specialStudents) {
    const groups = new Set(
      sp.failedSubjects
        .map((code) => rotationGroupByCode.get(code))
        .filter((g): g is string => Boolean(g)),
    );
    if (groups.size === 0) continue;
    const expanded = new Set(sp.failedSubjects);
    for (const [code, group] of rotationGroupByCode) {
      if (groups.has(group)) expanded.add(code);
    }
    sp.failedSubjects = [...expanded];
  }

  // Assign normal tiers for non-special students (SPA/SPS/STE get 85+ tiers only)
  const normalTiers = assignNormalTiers(allStudents, studentPrograms);

  // Log special students
  console.log(`\n--- Special Students ---`);
  for (const sp of specialStudents) {
    const student = allStudents.find(s => s.id === sp.studentId);
    const program = normalizeProgramCode(studentPrograms.get(sp.studentId));
    const isProgramFailure = sp.type === "REMEDIAL" && program !== "REGULAR";
    const label = isProgramFailure
      ? `PROGRAM FAIL [${program}] (fails 1 subject, exits to BEC/Regular on rollover)`
      : sp.type === "RETAINED"
        ? "RETAINED (fails 4 subjects, 3+ rule)"
        : "REMEDIAL (fails 1-2 subjects, final 70-71)";
    console.log(`  ${label}: ${student?.lastName}, ${student?.firstName}`);
    console.log(`    Failed subjects: ${sp.failedSubjects.join(", ")}`);
  }

  // Log normal tier distribution
  const tierCounts = new Map<Tier, number>();
  for (const t of normalTiers.values()) tierCounts.set(t, (tierCounts.get(t) ?? 0) + 1);
  console.log(`\nNormal tier distribution:`);
  for (const [tier, count] of tierCounts) {
    console.log(`  ${TIER_LABELS[tier]}: ${count}`);
  }

  let grandTotalGrades = 0;
  let grandTotalSnapshots = 0;
  let grandSkippedSections = 0;

  // ─── Clear stale data for this SY (grades, snapshots, remedial, promo status) ──
  if (args.clear && !args.dryRun) {
    console.log(`\n--- Clearing existing data for SY ${schoolYearLabel} (terms: ${args.terms.join(", ")}) ---`);
    for (const term of args.terms) {
      const delSnap = await prisma.gradeSnapshot.deleteMany({
        where: { schoolYear: schoolYearLabel, term },
      });
      const delGrade = await prisma.grade.deleteMany({
        where: { term, classAssignment: { schoolYear: schoolYearLabel } },
      });
      console.log(`  ${term}: deleted ${delGrade.count} grades, ${delSnap.count} snapshots`);
    }
    // Stale remedial records + promotion statuses from previous runs
    const delRemedial = await prisma.remedialClass.deleteMany({
      where: { schoolYear: schoolYearLabel },
    });
    const resetPromo = await prisma.enrollment.updateMany({
      where: { schoolYear: schoolYearLabel },
      data: { promotionStatus: null, promotedToGradeLevel: null },
    });
    console.log(`  Deleted ${delRemedial.count} remedial records`);
    console.log(`  Reset promotion status on ${resetPromo.count} enrollments\n`);
  }

  for (const term of args.terms) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`TERM: ${term}`);
    console.log(`${"=".repeat(60)}`);

    const termIdx = VALID_TERMS.indexOf(term);
    let termGrades = 0;
    let termSnapshots = 0;
    let termSkipped = 0;

    for (const sec of allSections) {
      const enrollments = await prisma.enrollment.findMany({
        where: { sectionId: sec.id, status: "ENROLLED", isArchived: false },
        include: { student: true },
      });
      if (enrollments.length === 0) {
        termSkipped++;
        continue;
      }

      const cas = await prisma.classAssignment.findMany({
        where: { sectionId: sec.id, schoolYear: schoolYearLabel, isActive: true },
        include: { teacher: { include: { user: true } }, subject: true },
      });
      if (cas.length === 0) {
        termSkipped++;
        continue;
      }

      const sorted = [...enrollments].sort((a, b) => {
        const cmp = (a.student.lastName ?? "").localeCompare(b.student.lastName ?? "");
        return cmp !== 0 ? cmp : (a.student.firstName ?? "").localeCompare(b.student.firstName ?? "");
      });

      // Count special students in this section
      const secSpecial = specialStudents.filter(sp => sorted.some(e => e.studentId === sp.studentId));
      const secSpecialStr = secSpecial.map(sp => {
        const student = allStudents.find(s => s.id === sp.studentId);
        return `${sp.type === "RETAINED" ? "Retained" : "Remedial"}: ${student?.lastName}`;
      }).join(" | ");

      const teacherName = cas[0]?.teacher?.user
        ? `${cas[0].teacher.user.firstName} ${cas[0].teacher.user.lastName}`
        : "Unknown";
      console.log(`\n  ${sec.gradeLevel} ${sec.name} | Teacher: ${teacherName} | Students: ${sorted.length}${secSpecialStr ? " | " + secSpecialStr : ""}`);

      let sectionGrades = 0;
      for (const ca of cas) {
        const isHG = ca.subject.code.startsWith("HG");
        const weights = resolveCanonicalWeights(ca.subject, gradingConfigs);

        for (const enrollment of sorted) {
          const { tier, isFailedSubject } = getTierForStudentSubject(
            enrollment.studentId,
            ca.subject.code,
            term,
            specialStudents,
            normalTiers,
            studentPrograms,
          );

          const special = specialStudents.find(sp => sp.studentId === enrollment.studentId);
          const isRemedial = special?.type === "REMEDIAL";

          const qgTarget = TIER_QG[tier][termIdx];
          const rand = seededRandom(hashStr(`${enrollment.studentId}-${ca.id}-${term}`));

          let gradeData: {
            writtenWorkScores: Array<{ name: string; score: number; maxScore: number }> | null;
            perfTaskScores: Array<{ name: string; score: number; maxScore: number }> | null;
            examScores?: Array<{ name: string; score: number; maxScore: number }>;
            quarterlyAssessScore: number | null;
            quarterlyAssessMax: number;
            computed: { writtenWorkPS: number | null; perfTaskPS: number | null; quarterlyAssessPS: number | null; initialGrade: number | null; quarterlyGrade: number | null };
            qualitativeDescriptor?: string;
          };

          if (isHG) {
            const descs = ["No Improvement", "Needs Improvement", "Developing", "Sufficiently Developed"];
            const di = tier === "HIGHEST_HONORS" ? 3 : tier === "HIGH_HONORS" ? 2 : tier === "HONORS" ? 1 : 0;
            gradeData = {
              writtenWorkScores: null, perfTaskScores: null, quarterlyAssessScore: null, quarterlyAssessMax: 100,
              computed: { writtenWorkPS: null, perfTaskPS: null, quarterlyAssessPS: null, initialGrade: null, quarterlyGrade: null },
              qualitativeDescriptor: descs[di],
            };
          } else {
            // Remedial failed subjects build exact (no jitter) so QG lands at 70/71.
            // STE_ELIGIBLE also builds exact so the 85 threshold is never undershot.
            const exact = tier === "REMEDIAL_FAIL_70" || tier === "REMEDIAL_FAIL_71" || tier === "STE_ELIGIBLE";
            // SPA/SPS/STE retention rules need >=85 in every non-failed subject.
            // Every other non-designated subject must at least pass (>=75) so
            // item-score rounding can never create accidental failures.
            const isProgramLearner = HIGH_RETENTION_PROGRAMS.has(
              normalizeProgramCode(studentPrograms.get(enrollment.studentId)),
            );
            const minQuarterlyGrade = isFailedSubject ? undefined : isProgramLearner ? 85 : 75;
            gradeData = buildGradeForTarget(qgTarget, weights, rand, exact, minQuarterlyGrade);
          }

          const qg = gradeData.computed.quarterlyGrade;
          const remarks = getRemarks(tier, term, qg, isFailedSubject, isRemedial ?? false);

          if (args.dryRun) {
            sectionGrades++;
            continue;
          }

          // AIMS protection: skip if this grade has AIMS-imported scores
          let hasAimsScores = false;
          if (ca.aimsCourseId) {
            const existingGrade = await prisma.grade.findUnique({
              where: {
                studentId_classAssignmentId_term: {
                  studentId: enrollment.studentId,
                  classAssignmentId: ca.id,
                  term,
                },
              },
              select: { writtenWorkScores: true, perfTaskScores: true },
            });
            if (existingGrade) {
              const ww = (existingGrade.writtenWorkScores as any[]) || [];
              const pt = (existingGrade.perfTaskScores as any[]) || [];
              hasAimsScores = ww.some((s: any) => s.isAims) || pt.some((s: any) => s.isAims);
            }
          }
          if (hasAimsScores) {
            sectionGrades++;
            continue;
          }

          try {
            const gr = await prisma.grade.upsert({
              where: {
                studentId_classAssignmentId_term: {
                  studentId: enrollment.studentId,
                  classAssignmentId: ca.id,
                  term,
                },
              },
              update: {
                writtenWorkScores: gradeData.writtenWorkScores as any,
                perfTaskScores: gradeData.perfTaskScores as any,
                examScores: gradeData.examScores as any,
                quarterlyAssessScore: gradeData.quarterlyAssessScore,
                quarterlyAssessMax: gradeData.quarterlyAssessMax,
                writtenWorkPS: gradeData.computed.writtenWorkPS,
                perfTaskPS: gradeData.computed.perfTaskPS,
                quarterlyAssessPS: gradeData.computed.quarterlyAssessPS,
                initialGrade: gradeData.computed.initialGrade,
                quarterlyGrade: gradeData.computed.quarterlyGrade,
                remarks,
                qualitativeDescriptor: gradeData.qualitativeDescriptor ?? null,
                ...(args.finalized && adminUserId ? { status: "FINALIZED" as GradeStatus, finalizedAt: new Date(), finalizedBy: adminUserId } : {}),
              },
              create: {
                studentId: enrollment.studentId,
                classAssignmentId: ca.id,
                term,
                writtenWorkScores: gradeData.writtenWorkScores as any,
                perfTaskScores: gradeData.perfTaskScores as any,
                examScores: gradeData.examScores as any,
                quarterlyAssessScore: gradeData.quarterlyAssessScore,
                quarterlyAssessMax: gradeData.quarterlyAssessMax,
                writtenWorkPS: gradeData.computed.writtenWorkPS,
                perfTaskPS: gradeData.computed.perfTaskPS,
                quarterlyAssessPS: gradeData.computed.quarterlyAssessPS,
                initialGrade: gradeData.computed.initialGrade,
                quarterlyGrade: gradeData.computed.quarterlyGrade,
                remarks,
                qualitativeDescriptor: gradeData.qualitativeDescriptor ?? null,
                ...(args.finalized && adminUserId ? { status: "FINALIZED" as GradeStatus, finalizedAt: new Date(), finalizedBy: adminUserId } : {}),
              },
            });
            sectionGrades++;

            try {
              await prisma.gradeSnapshot.create({
                data: {
                  gradeId: gr.id,
                  studentId: enrollment.studentId,
                  classAssignmentId: ca.id,
                  teacherId: ca.teacherId,
                  subjectCode: ca.subject.code,
                  subjectName: ca.subject.name,
                  sectionId: sec.id,
                  sectionName: sec.name,
                  schoolYear: schoolYearLabel,
                  term,
                  snapshot: gr as any,
                },
              });
              termSnapshots++;
            } catch {}
          } catch {}
        }
      }

      termGrades += sectionGrades;
      console.log(`  Grades seeded: ${sectionGrades}`);
    }

    grandTotalGrades += termGrades;
    grandTotalSnapshots += termSnapshots;
    grandSkippedSections += termSkipped;

    console.log(`\n  --- ${term} Complete ---`);
    console.log(`  Grades: ${termGrades} | Snapshots: ${termSnapshots} | Skipped: ${termSkipped}`);
  }

  // Promotion statuses and RemedialClass rows are NOT written here. The EOSY
  // finalize step below (finalizeSectionEosy) is the single writer: it derives
  // the DO 8 / DO 13 promotion matrix from the seeded grades, canonicalizes
  // rotation subjects (one "TLE" row, not per-strand rows), and removes
  // orphaned never-conducted PENDING rows when the decision is not
  // CONDITIONALLY_PROMOTED.

  // ─── Transferee Detail Completion ───────────────────────────────────────────
  // Only demographics are fabricated. Previous-school fields are supplied by the
  // EnrollPro feed (contract v1.1) and must never be seeded — fabricated values
  // would permanently block the real ones under fill-nulls-only.
  if (args.completeTransferees && !args.dryRun) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`TRANSFEREE DETAIL COMPLETION`);
    console.log(`${"=".repeat(60)}`);

    const transferees = await prisma.enrollment.findMany({
      where: { schoolYear: schoolYearLabel, transferInDate: { not: null }, status: "ENROLLED" },
      include: { student: true, section: true },
    });

    let completedCount = 0;
    for (const t of transferees) {
      const studentUpdates: Record<string, any> = {};

      if (!t.student.birthDate) {
        // Generate a plausible birth date (12-16 years old)
        const age = 12 + (hashStr(t.studentId + "-age") % 5);
        const year = 2029 - age;
        const month = (hashStr(t.studentId + "-month") % 12) + 1;
        const day = (hashStr(t.studentId + "-day") % 28) + 1;
        studentUpdates.birthDate = new Date(year, month - 1, day);
      }
      if (!t.student.gender) {
        // Heuristic: names ending in 'a' are often female in Filipino names
        const firstName = (t.student.firstName ?? "").toUpperCase();
        studentUpdates.gender = (firstName.endsWith("A") || firstName.endsWith("E")) ? "FEMALE" : "MALE";
      }

      if (Object.keys(studentUpdates).length > 0) {
        await prisma.student.update({
          where: { id: t.studentId },
          data: studentUpdates,
        });
        completedCount++;
        const filledFields = Object.keys(studentUpdates).join(", ");
        console.log(`  Completed: ${t.student.lastName}, ${t.student.firstName} (${filledFields})`);
      }
    }

    console.log(`\n  Transferees completed: ${completedCount} of ${transferees.length}`);
  }

  // ─── EOSY Finalize (rollover safety) ─────────────────────────────────────────
  // This seed writes grades directly as FINALIZED (with --finalized), which skips
  // the EOSY promotion step. Run the real finalize flow so EOSY_FINALIZE snapshots
  // + promotion status exist — otherwise the rollover archive guardrail (snapshot
  // gap) blocks the year and the system silently reverts.
  if (args.finalized && !args.dryRun) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`EOSY FINALIZE (rollover safety)`);
    console.log(`${"=".repeat(60)}`);
    let eosyOk = 0;
    let eosySkipped = 0;
    for (const sec of allSections) {
      try {
        const res = await finalizeSectionEosy({
          sectionId: sec.id,
          schoolYear: schoolYearLabel,
          actor: { id: "seed", name: "Teacher Score Seed", role: "REGISTRAR" },
        });
        if (res.ok) {
          eosyOk++;
          console.log(`  ${sec.name}: ${res.snapshotsCreated} EOSY snapshots, ${res.processed} enrollments`);
        } else {
          eosySkipped++;
          console.warn(`  ${sec.name}: skipped (${res.error})`);
        }
      } catch (err: any) {
        eosySkipped++;
        console.warn(`  ${sec.name}: failed (${err.message})`);
      }
    }
    console.log(`EOSY finalize: ${eosyOk} section(s) OK, ${eosySkipped} skipped`);
  }

  // ─── Complete seeded remedial (rollover safety) ─────────────────────────────
  // EOSY finalize creates a PENDING RemedialClass row for every conditionally
  // promoted learner. The rollover guard blocks the whole year until each row is
  // completed, so the demo profile must not leave them behind. Pass
  // --keep-remedial-pending only when intentionally testing the Pending tab.
  if (args.finalized && !args.dryRun && !args.keepRemedialPending) {
    const remedialStudentIds = specialStudents
      .filter((sp) => sp.type === "REMEDIAL")
      .map((sp) => sp.studentId);

    if (remedialStudentIds.length > 0) {
      const yearRecord = await prisma.schoolYear.findUnique({
        where: { label: schoolYearLabel },
        select: { startDate: true, endDate: true },
      });
      const conductedFrom = (yearRecord?.startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .toISOString()
        .slice(0, 10);
      const conductedTo = (yearRecord?.endDate ?? new Date()).toISOString().slice(0, 10);

      const pendingRows = await prisma.remedialClass.findMany({
        where: {
          schoolYear: schoolYearLabel,
          status: "PENDING",
          enrollment: { studentId: { in: remedialStudentIds } },
        },
        select: { enrollmentId: true },
      });
      const enrollmentIds = [...new Set(pendingRows.map((row) => row.enrollmentId))];

      console.log(`\n${"=".repeat(60)}`);
      console.log(`REMEDIAL COMPLETION (rollover safety)`);
      console.log(`${"=".repeat(60)}`);

      for (const enrollmentId of enrollmentIds) {
        // completeRemedial derives the RFG from the stored RCM; seed a passing
        // mark first so the learner finishes PASSED instead of PENDING.
        await prisma.remedialClass.updateMany({
          where: { enrollmentId, status: "PENDING" },
          data: { remedialMark: 88 },
        });
        try {
          const res = await completeRemedial(
            enrollmentId,
            { id: "seed", name: "Teacher Score Seed", role: "REGISTRAR" },
            { conductedFrom, conductedTo },
          );
          console.log(`  ${enrollmentId}: ${res.previousStatus ?? "null"} → ${res.newStatus}`);
        } catch (err: any) {
          console.warn(`  ${enrollmentId}: remedial completion failed (${err.message})`);
        }
      }

      console.log(
        enrollmentIds.length > 0
          ? `Completed remedial for ${enrollmentIds.length} learner(s).`
          : `No pending remedial rows for seeded learners.`,
      );
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`=== GRAND SUMMARY ===`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Duration: ${duration}s`);
  console.log(`Terms seeded: ${args.terms.join(", ")}`);
  console.log(`Sections processed per term: ${allSections.length - grandSkippedSections}`);
  console.log(`Sections skipped per term: ${grandSkippedSections}`);
  console.log(`Total grades: ${grandTotalGrades}`);
  console.log(`Total snapshots: ${grandTotalSnapshots}`);
  if (args.dryRun) console.log(`(dry-run — no data written)`);
}

main()
  .then(async () => {
    // The pg pool behind the Prisma driver adapter (and/or imported modules) can
    // keep handles open, so the process may never exit on its own — which made
    // the admin "Seed + Finalize" button spin forever. Exit explicitly.
    try {
      await prisma.$disconnect();
    } catch {
      // ignore — we are exiting anyway
    }
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("Error during grade seeding:", e);
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
    process.exit(1);
  });
