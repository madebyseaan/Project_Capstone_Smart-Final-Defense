import "dotenv/config";
import { GradingMode, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveCanonicalWeights } from "../prisma/canonicalGrade";
import { deriveGradeValues } from "../src/lib/gradeDerivation";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// Convert plain number arrays (legacy seed output) to the app's object score form.
// Seed numbers are percentages, so maxScore 100 preserves the stored PS (total/totalMax = average).
function toObjectScores(scores: unknown, prefix: string): Array<{ name: string; score: number; maxScore: number }> | null {
  if (!Array.isArray(scores) || scores.length === 0) return null;
  if (typeof scores[0] === "object" && scores[0] !== null) return null; // already object form
  return scores.map((n: unknown, i: number) => ({
    name: `${prefix} ${i + 1}`,
    score: Number(n) || 0,
    maxScore: 100,
  }));
}

async function main() {
  const table = await prisma.transmutationEntry.findMany({ orderBy: { minGrade: "asc" } });
  if (table.length === 0) throw new Error("TransmutationEntry table is empty — aborting");
  const gradingConfigs = await prisma.gradingConfig.findMany();
  const schoolYears = await prisma.schoolYear.findMany({ select: { label: true, gradingMode: true } });
  const modeByYear = new Map(schoolYears.map((year) => [year.label, year.gradingMode]));

  const grades = await prisma.grade.findMany({
    include: { classAssignment: { include: { subject: true } } },
  });

  let recomputed = 0;
  let shapesFixed = 0;
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

  for (const g of grades) {
    const data: Record<string, unknown> = {};

    // 1. Repair legacy number-form score arrays
    const wwObj = toObjectScores(g.writtenWorkScores, "WW");
    const ptObj = toObjectScores(g.perfTaskScores, "PT");
    if (wwObj) { data.writtenWorkScores = wwObj; shapesFixed++; }
    if (ptObj) { data.perfTaskScores = ptObj; shapesFixed++; }

    // 2. Recompute initialGrade + quarterlyGrade from stored PS with canonical weights + table
    const w = resolveCanonicalWeights(g.classAssignment.subject, gradingConfigs);
    const mode = modeByYear.get(g.classAssignment.schoolYear) ?? GradingMode.TRANSMUTED;
    const derived = deriveGradeValues(
      {
        writtenWorkScores: g.writtenWorkScores,
        perfTaskScores: g.perfTaskScores,
        examScores: g.examScores,
        quarterlyAssessScore: g.quarterlyAssessScore,
        quarterlyAssessMax: g.quarterlyAssessMax,
        storedWrittenWorkPS: g.writtenWorkPS,
        storedPerfTaskPS: g.perfTaskPS,
        storedQuarterlyAssessPS: g.quarterlyAssessPS,
      },
      w,
      mode,
      table,
    );
    if (derived.writtenWorkPS !== null && derived.perfTaskPS !== null && derived.quarterlyAssessPS !== null && derived.initialGrade !== null && derived.quarterlyGrade !== null) {
      if (Math.abs((g.initialGrade ?? -1) - derived.initialGrade) > 1e-9 || g.quarterlyGrade !== derived.quarterlyGrade || derived.hasExamBreakdown) {
        data.initialGrade = derived.initialGrade;
        data.quarterlyGrade = derived.quarterlyGrade;
        data.writtenWorkPS = derived.writtenWorkPS;
        data.perfTaskPS = derived.perfTaskPS;
        data.quarterlyAssessPS = derived.quarterlyAssessPS;
        if (derived.hasExamBreakdown) {
          data.quarterlyAssessScore = derived.nextQuarterlyAssessScore;
          data.quarterlyAssessMax = derived.nextQuarterlyAssessMax;
        }
      }
    }

    if (Object.keys(data).length > 0) {
      updates.push({ where: { id: g.id }, data });
    }
  }

  // Apply in batches
  const BATCH = 200;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((u) => prisma.grade.update({ where: u.where, data: u.data as any })),
    );
  }

  recomputed = updates.filter((u) => u.data.quarterlyGrade !== undefined).length;
  console.log(`=== Grade realignment complete ===`);
  console.log(`Total grades scanned: ${grades.length}`);
  console.log(`Grades with recomputed initialGrade/quarterlyGrade: ${recomputed}`);
  console.log(`Legacy number-form score arrays converted: ${shapesFixed}`);
  console.log(`Total rows updated: ${updates.length}`);
}

main()
  .catch((e) => {
    console.error("Error during realignment:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

