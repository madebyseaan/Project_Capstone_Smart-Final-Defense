import "dotenv/config";
import { PrismaClient, Term, GradeStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const VALID_TERMS: Term[] = ["T1", "T2", "T3"];

type Tier =
  | "HIGHEST_HONORS"
  | "HIGH_HONORS"
  | "HONORS"
  | "ABOVE_AVG"
  | "AVERAGE"
  | "BELOW_AVG"
  | "AT_RISK"
  | "FAILED";

const TIER_QG: Record<Tier, number[]> = {
  HIGHEST_HONORS: [98, 99, 98],
  HIGH_HONORS: [95, 96, 95],
  HONORS: [91, 90, 92],
  ABOVE_AVG: [93, 91, 92],
  AVERAGE: [84, 83, 85],
  BELOW_AVG: [77, 76, 78],
  AT_RISK: [70, 68, 72],
  FAILED: [65, 63, 68],
};

const TIER_LABELS: Record<Tier, string> = {
  HIGHEST_HONORS: "With Highest Honors",
  HIGH_HONORS: "With High Honors",
  HONORS: "With Honors",
  ABOVE_AVG: "Above Average",
  AVERAGE: "Average",
  BELOW_AVG: "Below Average",
  AT_RISK: "At Risk",
  FAILED: "Failed — Retention Candidate",
};

function transmute(initialGrade: number): number {
  const r = Math.round(initialGrade * 100) / 100;
  if (r >= 99.5) return 100;
  const t: [number, number, number][] = [
    [97.5, 99.49, 99], [96.0, 97.49, 98], [95.0, 95.99, 97], [94.0, 94.99, 96],
    [93.0, 93.99, 95], [92.0, 92.99, 94], [91.0, 91.99, 93], [90.0, 90.99, 92],
    [89.0, 89.99, 91], [88.0, 88.99, 90], [87.0, 87.99, 89], [86.0, 86.99, 88],
    [85.0, 85.99, 87], [84.0, 84.99, 86], [83.0, 83.99, 85], [82.0, 82.99, 84],
    [81.0, 81.99, 83], [80.0, 80.99, 82], [79.0, 79.99, 81], [78.0, 78.99, 80],
    [77.0, 77.99, 79], [76.0, 76.99, 78], [75.0, 75.99, 77], [73.0, 74.99, 76],
    [70.0, 72.99, 75], [68.0, 69.99, 74], [66.0, 67.99, 73], [64.0, 65.99, 72],
    [62.0, 63.99, 71], [60.0, 61.99, 70], [58.0, 59.99, 69], [56.0, 57.99, 68],
    [54.0, 55.99, 67], [52.0, 53.99, 66], [50.0, 51.99, 65], [48.0, 49.99, 64],
    [46.0, 47.99, 63], [43.0, 45.99, 62], [40.0, 42.99, 61], [25.0, 39.99, 60],
    [0.0, 24.99, 60],
  ];
  for (const [min, max, grade] of t) {
    if (r >= min && r <= max) return grade;
  }
  return 60;
}

function findInitialGradeForTarget(targetQG: number): number {
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

function calculateGrades(
  wwScores: Array<{ name: string; score: number; maxScore: number }> | null,
  ptScores: Array<{ name: string; score: number; maxScore: number }> | null,
  qaScore: number | null,
  qaMax: number,
  wwWeight: number,
  ptWeight: number,
  qaWeight: number,
) {
  let wwPS: number | null = null;
  if (wwScores && wwScores.length > 0) {
    const total = wwScores.reduce((s, i) => s + i.score, 0);
    const max = wwScores.reduce((s, i) => s + i.maxScore, 0);
    wwPS = max > 0 ? (total / max) * 100 : 0;
  }
  let ptPS: number | null = null;
  if (ptScores && ptScores.length > 0) {
    const total = ptScores.reduce((s, i) => s + i.score, 0);
    const max = ptScores.reduce((s, i) => s + i.maxScore, 0);
    ptPS = max > 0 ? (total / max) * 100 : 0;
  }
  let qaPS: number | null = null;
  if (qaScore !== null && qaMax > 0) qaPS = (qaScore / qaMax) * 100;
  let ig: number | null = null;
  if (wwPS !== null && ptPS !== null && qaPS !== null) {
    ig = (wwPS * wwWeight) / 100 + (ptPS * ptWeight) / 100 + (qaPS * qaWeight) / 100;
  }
  let qg: number | null = null;
  if (ig !== null) qg = transmute(ig);
  return { writtenWorkPS: wwPS, perfTaskPS: ptPS, quarterlyAssessPS: qaPS, initialGrade: ig, quarterlyGrade: qg };
}

function genWW(count: number, max: number, targetPS: number) {
  return Array.from({ length: count }, (_, i) => {
    const v = 1 + ((i % 3 === 0 ? -0.02 : i % 3 === 1 ? 0.01 : 0));
    return { name: `WW ${i + 1}`, score: Math.round(Math.max(0, Math.min(max, max * (targetPS / 100) * v))), maxScore: max };
  });
}

function genPT(count: number, max: number, targetPS: number) {
  return Array.from({ length: count }, (_, i) => {
    const v = 1 + ((i % 3 === 0 ? -0.015 : i % 3 === 1 ? 0.01 : 0.005));
    return { name: `PT ${i + 1}`, score: Math.round(Math.max(0, Math.min(max, max * (targetPS / 100) * v))), maxScore: max };
  });
}

function buildGradeForTarget(targetQG: number, weights: { ww: number; pt: number; qa: number }) {
  const targetInitial = findInitialGradeForTarget(targetQG);
  const wwPS = Math.min(100, Math.max(0, targetInitial + 1.5));
  const ptPS = Math.min(100, Math.max(0, targetInitial - 0.5));
  const qaPS = Math.min(100, Math.max(0, targetInitial + 0.3));
  const wwScores = genWW(4, 10, wwPS);
  const ptScores = genPT(4, 20, ptPS);
  const qaScore = Math.round(100 * (qaPS / 100));
  const computed = calculateGrades(wwScores, ptScores, qaScore, 100, weights.ww, weights.pt, weights.qa);
  return { writtenWorkScores: wwScores, perfTaskScores: ptScores, quarterlyAssessScore: qaScore, quarterlyAssessMax: 100, computed };
}

function assignTiersDeterministic(students: { id: string; firstName: string; lastName: string }[]): Map<string, Tier> {
  const sorted = [...students].sort((a, b) => {
    const cmp = (a.lastName ?? "").localeCompare(b.lastName ?? "");
    return cmp !== 0 ? cmp : (a.firstName ?? "").localeCompare(b.firstName ?? "");
  });

  const tiers = new Map<string, Tier>();

  const patterns: Tier[][] = [
    ["HIGHEST_HONORS", "AVERAGE", "BELOW_AVG", "FAILED"],
    ["HIGH_HONORS", "ABOVE_AVG", "AT_RISK", "FAILED"],
    ["HIGHEST_HONORS", "HONORS", "AVERAGE", "AT_RISK"],
    ["HIGH_HONORS", "AVERAGE", "BELOW_AVG", "FAILED"],
    ["HONORS", "ABOVE_AVG", "AVERAGE", "FAILED"],
    ["HIGHEST_HONORS", "AVERAGE", "AT_RISK", "BELOW_AVG"],
  ];

  const patternIdx = sorted.length > 0 ? (sorted[0].lastName?.charCodeAt(0) ?? 0) % patterns.length : 0;
  const pattern = patterns[patternIdx];

  for (let i = 0; i < sorted.length; i++) {
    tiers.set(sorted[i].id, i < pattern.length ? pattern[i] : "AVERAGE");
  }

  return tiers;
}

interface ParsedArgs {
  terms: Term[];
  finalized: boolean;
  sectionFilter: string | null;
  clear: boolean;
  dryRun: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const firstArg = args[0];

  if (!firstArg) {
    console.error("Usage: npx ts-node prisma/seed-grades-term.ts <T1|T2|T3|--all> [flags]");
    console.error("Flags:");
    console.error("  --finalized    Set status=FINALIZED, finalizedAt=now, finalizedBy=admin user id (default: DRAFT)");
    console.error('  --section "Name"   Restrict to one section by name (optional)');
    console.error("  --clear        Delete existing grades+snapshots for this term/school year first");
    console.error("  --dry-run      Print what would be seeded, write nothing");
    process.exit(1);
  }

  let terms: Term[];
  const remaining = args.slice(1);

  if (firstArg === "--all") {
    terms = ["T1", "T2", "T3"];
  } else if (VALID_TERMS.includes(firstArg as Term)) {
    terms = [firstArg as Term];
  } else {
    console.error(`Invalid term: "${firstArg}". Use T1, T2, T3, or --all`);
    process.exit(1);
  }

  return {
    terms,
    finalized: remaining.includes("--finalized"),
    sectionFilter: remaining.includes("--section") ? remaining[remaining.indexOf("--section") + 1] ?? null : null,
    clear: remaining.includes("--clear"),
    dryRun: remaining.includes("--dry-run"),
  };
}

async function resolveSchoolYear(): Promise<string> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  if (!settings?.schoolYearId) {
    console.error("No active school year. Run EnrollPro sync first (start the server or POST /api/sync/all).");
    process.exit(1);
  }
  const sy = await prisma.schoolYear.findUnique({ where: { id: settings.schoolYearId } });
  if (!sy) {
    console.error("No active school year. Run EnrollPro sync first (start the server or POST /api/sync/all).");
    process.exit(1);
  }
  return sy.label;
}

async function main() {
  const args = parseArgs();
  const startTime = Date.now();

  console.log(`=== SMART Term Grade Seed Script ===`);
  console.log(`Terms: ${args.terms.join(", ")} | Finalized: ${args.finalized} | Clear: ${args.clear} | Dry-run: ${args.dryRun}`);
  if (args.sectionFilter) console.log(`Section filter: ${args.sectionFilter}`);
  console.log();

  const schoolYearLabel = await resolveSchoolYear();
  console.log(`Active school year: ${schoolYearLabel}\n`);

  let adminUserId: string | null = null;
  if (args.finalized) {
    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN", username: "admin" } });
    if (!adminUser) {
      console.error("Admin user (username: admin) not found. Run prisma:seed first.");
      process.exit(1);
    }
    adminUserId = adminUser.id;
  }

  let allSections = await prisma.section.findMany({
    where: { schoolYear: schoolYearLabel },
    orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
  });
  console.log(`Found ${allSections.length} sections for SY ${schoolYearLabel}`);

  if (args.sectionFilter) {
    allSections = allSections.filter((s) => s.name === args.sectionFilter);
    if (allSections.length === 0) {
      console.error(`Section "${args.sectionFilter}" not found for SY ${schoolYearLabel}.`);
      process.exit(1);
    }
  }

  let grandTotalGrades = 0;
  let grandTotalSnapshots = 0;
  let grandSkippedSections = 0;

  for (const term of args.terms) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`TERM: ${term}`);
    console.log(`${"=".repeat(60)}`);

    if (args.clear && !args.dryRun) {
      console.log(`--- Clearing existing ${term} grades and snapshots ---`);
      const delSnap = await prisma.gradeSnapshot.deleteMany({
        where: { schoolYear: schoolYearLabel, term },
      });
      const delGrade = await prisma.grade.deleteMany({
        where: { term, classAssignment: { schoolYear: schoolYearLabel } },
      });
      console.log(`  Deleted ${delGrade.count} grades, ${delSnap.count} snapshots\n`);
    }

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
        console.log(`Skipping ${sec.gradeLevel} ${sec.name}: no enrolled learners`);
        termSkipped++;
        continue;
      }

      const cas = await prisma.classAssignment.findMany({
        where: { sectionId: sec.id, schoolYear: schoolYearLabel, isActive: true },
        include: { teacher: { include: { user: true } }, subject: true },
      });
      if (cas.length === 0) {
        console.log(`Skipping ${sec.gradeLevel} ${sec.name}: no class assignments`);
        termSkipped++;
        continue;
      }

      console.log(`\n  ${sec.gradeLevel} ${sec.name} | Students: ${enrollments.length} | Assignments: ${cas.length}`);

      const sorted = [...enrollments].sort((a, b) => {
        const cmp = (a.student.lastName ?? "").localeCompare(b.student.lastName ?? "");
        return cmp !== 0 ? cmp : (a.student.firstName ?? "").localeCompare(b.student.firstName ?? "");
      });

      const studentTiers = assignTiersDeterministic(sorted.map((e) => e.student));

      const tierCounts = new Map<Tier, number>();
      for (const t of studentTiers.values()) tierCounts.set(t, (tierCounts.get(t) ?? 0) + 1);
      const tierStr = [...tierCounts.entries()].map(([t, c]) => `${TIER_LABELS[t]}:${c}`).join(" | ");
      console.log(`  Distribution: ${tierStr}`);

      let sectionGrades = 0;
      for (const ca of cas) {
        const isHG = ca.subject.code.startsWith("HG");
        const weights = {
          ww: ca.subject.writtenWorkWeight ?? 20,
          pt: ca.subject.perfTaskWeight ?? 50,
          qa: ca.subject.quarterlyAssessWeight ?? 30,
        };

        for (const enrollment of sorted) {
          const tier = studentTiers.get(enrollment.studentId) ?? "AVERAGE";
          const qgTarget = TIER_QG[tier][termIdx];

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
            gradeData = buildGradeForTarget(qgTarget, weights);
          }

          const qg = gradeData.computed.quarterlyGrade;
          const remarks = qg !== null ? (qg < 75 ? "Failed" : "Passed") : null;

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
