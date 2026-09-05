import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { makeTransmuter, resolveCanonicalWeights } from "../prisma/canonicalGrade";

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
  const transmute = makeTransmuter(table);
  const gradingConfigs = await prisma.gradingConfig.findMany();

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
    if (g.writtenWorkPS !== null && g.perfTaskPS !== null && g.quarterlyAssessPS !== null) {
      const w = resolveCanonicalWeights(g.classAssignment.subject, gradingConfigs);
      const initial =
        (g.writtenWorkPS * w.ww) / 100 +
        (g.perfTaskPS * w.pt) / 100 +
        (g.quarterlyAssessPS * w.qa) / 100;
      const qg = transmute(initial);
      if (Math.abs((g.initialGrade ?? -1) - initial) > 1e-9 || g.quarterlyGrade !== qg) {
        data.initialGrade = initial;
        data.quarterlyGrade = qg;
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
