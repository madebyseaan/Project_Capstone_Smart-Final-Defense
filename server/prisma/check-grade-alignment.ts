import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function transmute(initialGrade: number, table: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>): number {
  const roundedGrade = Math.round(initialGrade * 100) / 100;
  for (const entry of table) {
    if (roundedGrade >= entry.minGrade && roundedGrade <= entry.maxGrade) {
      return entry.transmutedGrade;
    }
  }
  return -1; // no match
}

async function main() {
  // 1. Canonical DB transmutation table (used by server save + SF9/SF10 + class record preview)
  const table = await prisma.transmutationEntry.findMany({ orderBy: { minGrade: "asc" } });
  console.log(`\nDB TransmutationEntry rows: ${table.length}`);
  console.log("Sample DB entries:", table.slice(22, 26).map(e => `${e.minGrade}-${e.maxGrade}=>${e.transmutedGrade}`).join(" | "));

  // 2. GradingConfig weights (server resolution source)
  const gradingConfigs = await prisma.gradingConfig.findMany();
  console.log(`\nGradingConfig rows: ${gradingConfigs.length}`);
  for (const gc of gradingConfigs) {
    console.log(`  type=${gc.subjectType}: ww=${gc.writtenWorkWeight} pt=${gc.performanceTaskWeight} qa=${gc.quarterlyAssessWeight}`);
  }

  // 3. Sample grades + their subjects, recompute server formula
  const grades = await prisma.grade.findMany({
    where: { quarterlyGrade: { not: null } },
    include: { classAssignment: { include: { subject: true } } },
    take: 12,
  });

  console.log(`\n=== Recompute check (server formula: storedPS x serverWeights -> DB table) vs stored quarterlyGrade ===`);
  let mismatchCount = 0;
  const shapeMismatches: Record<string, number> = { "number-form": 0, "object-form": 0 };
  const totalCount = await prisma.grade.count({ where: { quarterlyGrade: { not: null } } });
  const allGrades = await prisma.grade.findMany({
    where: { quarterlyGrade: { not: null } },
    include: { classAssignment: { include: { subject: true } } },
  });

  for (const g of allGrades) {
    const subject = g.classAssignment.subject;
    const isNumberForm = Array.isArray(g.writtenWorkScores) && g.writtenWorkScores.length > 0 && typeof g.writtenWorkScores[0] === "number";
    // server weight resolution: subject override (all three non-null) > gradingConfig by type > generic fallback
    let weights: { ww: number; pt: number; qa: number };
    if (subject.writtenWorkWeight !== null && subject.perfTaskWeight !== null && subject.quarterlyAssessWeight !== null) {
      weights = { ww: subject.writtenWorkWeight, pt: subject.perfTaskWeight, qa: subject.quarterlyAssessWeight };
    } else {
      const gc = gradingConfigs.find((c: any) => c.subjectType === subject.type);
      if (gc) {
        weights = { ww: gc.writtenWorkWeight, pt: gc.performanceTaskWeight, qa: gc.quarterlyAssessWeight };
      } else {
        weights = { ww: 20, pt: 50, qa: 30 }; // GENERIC_FALLBACK (helpers.ts:45)
      }
    }

    if (g.writtenWorkPS === null || g.perfTaskPS === null || g.quarterlyAssessPS === null) continue;

    const initial = (g.writtenWorkPS * weights.ww) / 100 + (g.perfTaskPS * weights.pt) / 100 + (g.quarterlyAssessPS * weights.qa) / 100;
    const recomputedQG = transmute(initial, table);
    if (recomputedQG !== g.quarterlyGrade) {
      mismatchCount++;
      shapeMismatches[isNumberForm ? "number-form" : "object-form"]++;
      if (mismatchCount <= 10 && grades.some((s: any) => s.id === g.id)) {
        console.log(`  MISMATCH ${subject.code} ${g.term}: stored quarterlyGrade=${g.quarterlyGrade} | recomputed initial=${initial.toFixed(2)} -> transmuted=${recomputedQG} (weights ww/pt/qa=${weights.ww}/${weights.pt}/${weights.qa}, PS=${g.writtenWorkPS.toFixed(2)}/${g.perfTaskPS.toFixed(2)}/${g.quarterlyAssessPS.toFixed(2)})`);
      }
    }
  }

  console.log(`\nMismatches by score shape: number-form=${shapeMismatches["number-form"]}, object-form=${shapeMismatches["object-form"]}`);

  console.log(`\nTOTAL grades with quarterlyGrade: ${totalCount}`);
  console.log(`MISMATCHES (stored quarterlyGrade != server recompute): ${mismatchCount} (${totalCount > 0 ? ((mismatchCount / totalCount) * 100).toFixed(1) : 0}%)`);

  // 4. Check score array shape (object vs plain number arrays)
  const shapeObj = allGrades.filter((g: any) => Array.isArray(g.writtenWorkScores) && g.writtenWorkScores.length > 0 && typeof g.writtenWorkScores[0] === "object").length;
  const shapeNum = allGrades.filter((g: any) => Array.isArray(g.writtenWorkScores) && g.writtenWorkScores.length > 0 && typeof g.writtenWorkScores[0] === "number").length;
  console.log(`\nwrittenWorkScores shape: object-form=${shapeObj}, number-form=${shapeNum}`);

  const statuses = await prisma.grade.groupBy({ by: ["status"], _count: true });
  console.log("Grade statuses:", statuses.map((s: any) => `${s.status}:${s._count}`).join(" | "));
}

main().catch(console.error).finally(() => prisma.$disconnect());
