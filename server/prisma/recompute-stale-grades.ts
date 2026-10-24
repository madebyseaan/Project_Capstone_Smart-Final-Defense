/**
 * recompute-stale-grades.ts — Re-derive stored initialGrade/quarterlyGrade for
 * every grade using the current GradingConfig weights and TransmutationEntry
 * table (mirrors the class-record ledger and POST /api/grades/grade).
 *
 * Run after replacing the transmutation table / weights outside the admin UI,
 * or to repair historical drift:
 *   cd server && npx ts-node --files prisma/recompute-stale-grades.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recomputeStoredGrades } from "../src/lib/gradeRecalc";

async function main() {
  const summary = await recomputeStoredGrades();
  console.log("=== Stored grade realignment complete ===");
  console.log(`Scanned:  ${summary.scanned}`);
  console.log(`Updated:  ${summary.updated}`);
  console.log(`Skipped (missing PS values): ${summary.unrecomputable}`);
  console.log(`Duration: ${summary.durationMs}ms`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
