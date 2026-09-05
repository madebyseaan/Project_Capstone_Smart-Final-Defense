import "dotenv/config";
import { PrismaClient, Term, GradeStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { makeTransmuter, resolveCanonicalWeights } from "./canonicalGrade";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const VALID_TERMS: Term[] = ["T1", "T2", "T3"];

// ─── Tier Definitions ────────────────────────────────────────────────────────

type Tier =
  | "HIGHEST_HONORS"
  | "HIGH_HONORS"
  | "HONORS"
  | "ABOVE_AVG"
  | "AVERAGE"
  | "BELOW_AVG"
  | "AT_RISK"
  | "REMEDIAL_FAIL_70"
  | "REMEDIAL_FAIL_71";

const TIER_QG: Record<Tier, number[]> = {
  HIGHEST_HONORS: [98, 99, 98],
  HIGH_HONORS: [95, 96, 95],
  HONORS: [91, 90, 92],
  ABOVE_AVG: [93, 91, 92],
  AVERAGE: [84, 83, 85],
  BELOW_AVG: [77, 76, 78],
  // Retained students' failed subjects (final ~70, any failing grade is valid)
  AT_RISK: [70, 68, 72],
  // Remedial/conditionally-promoted failed subjects — DepEd DO 13: 1-2 failed
  // subjects. Final rating must land at exactly 70 or 71 so the RemedialTracker
  // shows originalGrade 70-71 and RFG = (70-71 + RCM)/2 reaches 75 with RCM >= 79-80.
  REMEDIAL_FAIL_70: [70, 70, 70],
  REMEDIAL_FAIL_71: [71, 71, 71],
};

const TIER_LABELS: Record<Tier, string> = {
  HIGHEST_HONORS: "With Highest Honors",
  HIGH_HONORS: "With High Honors",
  HONORS: "With Honors",
  ABOVE_AVG: "Above Average",
  AVERAGE: "Average",
  BELOW_AVG: "Below Average",
  AT_RISK: "At Risk",
  REMEDIAL_FAIL_70: "Remedial (Final 70)",
  REMEDIAL_FAIL_71: "Remedial (Final 71)",
};

// ─── Transmutation ───────────────────────────────────────────────────────────

// Canonical transmuter — loaded from the DB TransmutationEntry table in main()
// so seeded grades always match the admin-configured table.
let transmute: (initialGrade: number) => number;
let transmutationRanges: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>;

// Deterministic: returns the MIDPOINT of the first table range mapping to targetQG
// (midpoint keeps integer-score rounding noise safely inside the range).
function findInitialGradeForTarget(targetQG: number): number {
  const range = transmutationRanges.find((r) => r.transmutedGrade === targetQG);
  if (range) return (range.minGrade + range.maxGrade) / 2;
  // Fallback: binary search
  let low = 0;
  let high = 100;
  let best = 50;
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    if (transmute(mid) === targetQG) { best = mid; low = mid + 0.01; }
    else if (transmute(mid) < targetQG) low = mid + 0.01;
    else high = mid - 0.01;
  }
  if (transmute(best) === targetQG) return best;
  for (let ig = 0; ig <= 100; ig += 0.01) {
    if (transmute(ig) === targetQG) return ig;
  }
  return best;
}

// ─── Grading Weights ─────────────────────────────────────────────────────────

// ─── Score Generation ────────────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function genScores(
  count: number,
  max: number,
  targetPS: number,
  rand: () => number,
  exact = false,
): Array<{ name: string; score: number; maxScore: number }> {
  return Array.from({ length: count }, (_, i) => {
    // exact = no per-item jitter so the computed PS (and thus QG) lands exactly on target
    const jitter = exact ? 1 : 1 + (rand() - 0.5) * 0.08;
    const raw = max * (targetPS / 100) * jitter;
    const score = Math.round(Math.max(1, Math.min(max, raw)));
    return { name: `Item ${i + 1}`, score, maxScore: max };
  });
}

function calculateGrades(
  wwScores: Array<{ name: string; score: number; maxScore: number }>,
  ptScores: Array<{ name: string; score: number; maxScore: number }>,
  qaScore: number,
  qaMax: number,
  wwWeight: number,
  ptWeight: number,
  qaWeight: number,
) {
  const wwTotal = wwScores.reduce((s, i) => s + i.score, 0);
  const wwMax = wwScores.reduce((s, i) => s + i.maxScore, 0);
  const wwPS = wwMax > 0 ? (wwTotal / wwMax) * 100 : 0;

  const ptTotal = ptScores.reduce((s, i) => s + i.score, 0);
  const ptMax = ptScores.reduce((s, i) => s + i.maxScore, 0);
  const ptPS = ptMax > 0 ? (ptTotal / ptMax) * 100 : 0;

  const qaPS = qaMax > 0 ? (qaScore / qaMax) * 100 : 0;

  const ig = (wwPS * wwWeight) / 100 + (ptPS * ptWeight) / 100 + (qaPS * qaWeight) / 100;
  const qg = transmute(ig);

  return { writtenWorkPS: wwPS, perfTaskPS: ptPS, quarterlyAssessPS: qaPS, initialGrade: ig, quarterlyGrade: qg };
}

function buildGradeForTarget(
  targetQG: number,
  weights: { ww: number; pt: number; qa: number },
  rand: () => number,
  exact = false,
) {
  const targetInitial = findInitialGradeForTarget(targetQG);
  // exact = no jitter: PS values sit at the range midpoint so integer-score
  // rounding can never push the quarterly grade off target (used for remedial
  // failed subjects that must land at exactly 70/71).
  const jitterOf = (r: number) => (exact ? 0 : (r - 0.5) * 3);
  const wwPS = Math.min(100, Math.max(0, targetInitial + jitterOf(rand())));
  const ptPS = Math.min(100, Math.max(0, targetInitial + jitterOf(rand())));
  const qaPS = Math.min(100, Math.max(0, targetInitial + jitterOf(rand())));

  const wwScores = genScores(4, 10, wwPS, rand, exact);
  const ptScores = genScores(4, 20, ptPS, rand, exact);
  const qaScore = Math.round(Math.max(0, Math.min(100, 100 * (qaPS / 100))));

  const computed = calculateGrades(wwScores, ptScores, qaScore, 100, weights.ww, weights.pt, weights.qa);
  return { writtenWorkScores: wwScores, perfTaskScores: ptScores, quarterlyAssessScore: qaScore, quarterlyAssessMax: 100, computed };
}

// ─── Per-Subject Tier Assignment ─────────────────────────────────────────────

interface StudentInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

interface SpecialStudent {
  studentId: string;
  failedSubjects: string[];
  type: "RETAINED" | "REMEDIAL";
}

function pickSpecialStudents(
  students: StudentInfo[],
  studentSubjects: Map<string, string[]>,
  retainedCount: number,
  remedialCount: number,
): SpecialStudent[] {
  const sorted = [...students].sort((a, b) => {
    const cmp = (a.lastName ?? "").localeCompare(b.lastName ?? "");
    return cmp !== 0 ? cmp : (a.firstName ?? "").localeCompare(b.firstName ?? "");
  });

  const result: SpecialStudent[] = [];
  const usedIndices = new Set<number>();

  // Pick retained students from middle of the list (not the first ones)
  const midStart = Math.floor(sorted.length * 0.3);
  for (let i = 0; i < retainedCount && midStart + i < sorted.length; i++) {
    const idx = midStart + i;
    usedIndices.add(idx);
    // Retained: fail 4 subjects (3+ per DepEd DO 13 = retained); pass the rest
    const enrolled = studentSubjects.get(sorted[idx].id) ?? [];
    const rand = seededRandom(hashStr(sorted[idx].id + "-retained"));
    const shuffled = [...enrolled].sort(() => rand() - 0.5);
    result.push({
      studentId: sorted[idx].id,
      failedSubjects: shuffled.slice(0, Math.min(4, shuffled.length)),
      type: "RETAINED",
    });
  }

  // Pick remedial students from later in the list
  const remedialStart = Math.floor(sorted.length * 0.6);
  let picked = 0;
  for (let i = remedialStart; i < sorted.length && picked < remedialCount; i++) {
    if (usedIndices.has(i)) continue;
    usedIndices.add(i);
    // Fail 1-2 random subjects from this student's actual enrolled subjects
    const enrolled = studentSubjects.get(sorted[i].id) ?? [];
    const rand = seededRandom(hashStr(sorted[i].id + "-remedial"));
    const shuffled = [...enrolled].sort(() => rand() - 0.5);
    const failCount = rand() > 0.5 ? 2 : 1;
    result.push({
      studentId: sorted[i].id,
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
): { tier: Tier; isFailedSubject: boolean } {
  const special = specialStudents.find(s => s.studentId === studentId);
  if (!special) {
    return { tier: normalTiers.get(studentId) ?? "AVERAGE", isFailedSubject: false };
  }

  const isFailed = special.failedSubjects.includes(subjectCode);
  if (!isFailed) {
    // Passing subjects for special students use AVERAGE tier
    return { tier: "AVERAGE", isFailedSubject: false };
  }

  if (special.type === "RETAINED") {
    // Retained: fail all 3 terms with AT_RISK grades (QG ≈ 70, 68, 72 — all < 75)
    return { tier: "AT_RISK", isFailedSubject: true };
  }

  // REMEDIAL: fail ALL terms at exactly 70 or 71 (final rating 70-71)
  return { tier: remedialFailTier(studentId), isFailedSubject: true };
}

function assignNormalTiers(students: StudentInfo[]): Map<string, Tier> {
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
    tiers.set(sorted[i].id, pattern[i % pattern.length]);
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
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.error("Usage: npx ts-node prisma/seed-teacher-scores.ts <T1|T2|T3|--all> [flags]");
    console.error("Flags:");
    console.error("  --finalized       Set status=FINALIZED (default: DRAFT)");
    console.error("  --clear           Delete existing grades for this SY first");
    console.error("  --dry-run         Print what would be seeded, write nothing");
    console.error("  --retained N      Number of retained students (default: 2)");
    console.error("  --remedial N      Number of remedial students (default: 2)");
    process.exit(1);
  }

  const firstArg = args[0];
  let terms: Term[];

  if (firstArg === "--all") {
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

  return {
    terms,
    finalized: remaining.includes("--finalized"),
    clear: remaining.includes("--clear"),
    dryRun: remaining.includes("--dry-run"),
    retainedCount: retainedIdx >= 0 ? parseInt(remaining[retainedIdx + 1] ?? "2", 10) : 2,
    remedialCount: remedialIdx >= 0 ? parseInt(remaining[remedialIdx + 1] ?? "2", 10) : 2,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function resolveSchoolYear(): Promise<{ label: string; id: string }> {
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
  return { label: sy.label, id: sy.id };
}

async function main() {
  const args = parseArgs();
  const startTime = Date.now();

  console.log(`=== SMART Teacher Score Seed Script ===`);
  console.log(`Terms: ${args.terms.join(", ")} | Finalized: ${args.finalized} | Clear: ${args.clear} | Dry-run: ${args.dryRun}`);
  console.log(`Retained: ${args.retainedCount} (fails 4 subjects) | Remedial: ${args.remedialCount} (fails 1-2 subjects, final 70-71)`);

  const { label: schoolYearLabel, id: schoolYearId } = await resolveSchoolYear();
  console.log(`Active school year: ${schoolYearLabel}\n`);

  // Load canonical grading config from the DB so seeded grades match what the
  // app computes (class record ledger recompute + SF9/SF10 display)
  const transmutationTable = await prisma.transmutationEntry.findMany({ orderBy: { minGrade: "asc" } });
  if (transmutationTable.length === 0) {
    console.error("TransmutationEntry table is empty — run `npm run prisma:seed` first.");
    process.exit(1);
  }
  transmute = makeTransmuter(transmutationTable);
  transmutationRanges = transmutationTable;
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

  // Collect all unique students across all sections
  const studentMap = new Map<string, StudentInfo>();
  for (const sec of allSections) {
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId: sec.id, status: "ENROLLED", isArchived: false },
      include: { student: true },
    });
    for (const e of enrollments) {
      if (!studentMap.has(e.studentId)) {
        studentMap.set(e.studentId, {
          id: e.studentId,
          firstName: e.student.firstName,
          lastName: e.student.lastName,
        });
      }
    }
  }

  const allStudents = [...studentMap.values()];
  console.log(`Unique students: ${allStudents.length}`);

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

  // Pick special students (retained & remedial)
  const specialStudents = pickSpecialStudents(allStudents, studentSubjects, args.retainedCount, args.remedialCount);

  // Assign normal tiers for non-special students
  const normalTiers = assignNormalTiers(allStudents);

  // Log special students
  console.log(`\n--- Special Students ---`);
  for (const sp of specialStudents) {
    const student = allStudents.find(s => s.id === sp.studentId);
    const label = sp.type === "RETAINED" ? "RETAINED (fails 4 subjects, 3+ rule)" : "REMEDIAL (fails 1-2 subjects, final 70-71)";
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
          );

          const special = specialStudents.find(sp => sp.studentId === enrollment.studentId);
          const isRemedial = special?.type === "REMEDIAL";

          const qgTarget = TIER_QG[tier][termIdx];
          const rand = seededRandom(hashStr(`${enrollment.studentId}-${ca.id}-${term}`));

          let gradeData: {
            writtenWorkScores: Array<{ name: string; score: number; maxScore: number }> | null;
            perfTaskScores: Array<{ name: string; score: number; maxScore: number }> | null;
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
            // Remedial failed subjects build exact (no jitter) so QG lands at 70/71
            const exact = tier === "REMEDIAL_FAIL_70" || tier === "REMEDIAL_FAIL_71";
            gradeData = buildGradeForTarget(qgTarget, weights, rand, exact);
          }

          const qg = gradeData.computed.quarterlyGrade;
          const remarks = getRemarks(tier, term, qg, isFailedSubject, isRemedial ?? false);

          if (args.dryRun) {
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

  // ─── Promotion Status & Remedial Classes ──────────────────────────────────
  if (!args.dryRun) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`PROMOTION STATUS & REMEDIAL CLASSES`);
    console.log(`${"=".repeat(60)}`);

    const nextGrade: Record<string, string> = {
      GRADE_7: "GRADE_8",
      GRADE_8: "GRADE_9",
      GRADE_9: "GRADE_10",
      GRADE_10: "GRADE_10",
    };

    // Process each special student
    for (const sp of specialStudents) {
      const student = allStudents.find(s => s.id === sp.studentId);
      if (!student) continue;

      // Find all enrollments for this student in the current SY
      const enrollments = await prisma.enrollment.findMany({
        where: {
          studentId: sp.studentId,
          section: { schoolYear: schoolYearLabel },
          isArchived: false,
        },
        include: { section: true },
      });

      for (const enrollment of enrollments) {
        const currentGrade = enrollment.section.gradeLevel;
        const promotedGrade = sp.type === "RETAINED" ? null : nextGrade[currentGrade] ?? null;
        const promotionStatus = sp.type === "RETAINED" ? "RETAINED" : "CONDITIONALLY_PROMOTED";

        await prisma.enrollment.update({
          where: { id: enrollment.id },
          data: {
            promotionStatus: promotionStatus as any,
            promotedToGradeLevel: promotedGrade as any,
          },
        });

        console.log(`  ${sp.type}: ${student.lastName}, ${student.firstName} | ${currentGrade} → ${promotedGrade ?? "STAY"}`);

        // Create RemedialClass records for remedial students' failed subjects
        if (sp.type === "REMEDIAL") {
          for (const subjectCode of sp.failedSubjects) {
            // Find the class assignment for this subject in the student's section
            const ca = await prisma.classAssignment.findFirst({
              where: {
                sectionId: enrollment.sectionId,
                subject: { code: subjectCode },
                schoolYear: schoolYearLabel,
                isActive: true,
              },
              include: { subject: true },
            });
            if (!ca) continue;

            // Get the average quarterly grade across all terms for this subject
            const grades = await prisma.grade.findMany({
              where: {
                studentId: sp.studentId,
                classAssignmentId: ca.id,
              },
            });
            const avgQG = grades.length > 0
              ? grades.reduce((sum, g) => sum + (g.quarterlyGrade ?? 0), 0) / grades.length
              : 0;

            await prisma.remedialClass.upsert({
              where: {
                enrollmentId_subjectCode: {
                  enrollmentId: enrollment.id,
                  subjectCode,
                },
              },
              create: {
                enrollmentId: enrollment.id,
                schoolYear: schoolYearLabel,
                gradeLevel: currentGrade as any,
                subjectCode,
                subjectName: ca.subject.name,
                originalGrade: Math.round(avgQG * 100) / 100,
                status: "PENDING",
              },
              update: {
                originalGrade: Math.round(avgQG * 100) / 100,
                status: "PENDING",
              },
            });

            console.log(`    RemedialClass: ${ca.subject.name} (avg QG: ${Math.round(avgQG * 100) / 100})`);
          }
        }
      }
    }

    // Set normal students to PROMOTED
    const specialIds = new Set(specialStudents.map(sp => sp.studentId));
    const normalEnrollments = await prisma.enrollment.findMany({
      where: {
        section: { schoolYear: schoolYearLabel },
        isArchived: false,
        status: "ENROLLED",
        studentId: { notIn: [...specialIds] },
      },
      include: { section: true },
    });

    for (const enrollment of normalEnrollments) {
      const currentGrade = enrollment.section.gradeLevel;
      const promotedGrade = nextGrade[currentGrade] ?? currentGrade;
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          promotionStatus: "PROMOTED" as any,
          promotedToGradeLevel: promotedGrade as any,
        },
      });
    }

    console.log(`\n  Normal students set to PROMOTED: ${normalEnrollments.length}`);
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
  .catch((e) => {
    console.error("Error during grade seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
