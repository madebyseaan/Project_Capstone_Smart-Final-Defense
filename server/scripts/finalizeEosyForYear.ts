/**
 * finalizeEosyForYear.ts
 *
 * Backfills the EOSY promotion finalize step for a school year whose grades were
 * marked FINALIZED directly (e.g. by a seed script) without running the EOSY
 * finalize flow. Creates source="EOSY_FINALIZE" promotion snapshots and sets
 * Enrollment.promotionStatus / promotedToGradeLevel so the year can be archived.
 *
 * Idempotent: finalizeSectionEosy skips snapshots whose quarterlyGrade already matches.
 *
 * Run:
 *   npx ts-node --transpile-only scripts/finalizeEosyForYear.ts 2029-2030           (dry-run)
 *   npx ts-node --transpile-only scripts/finalizeEosyForYear.ts 2029-2030 --apply   (write)
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { finalizeSectionEosy } from "../src/lib/promotion";
import { findSnapshotGapSections } from "../src/lib/rollover";
import { logger } from "../src/lib/logger";

const SY = process.argv[2] || "2029-2030";
const apply = process.argv.includes("--apply");

async function main() {
  logger.info(`[EosyBackfill] School year: ${SY} | mode: ${apply ? "APPLY" : "DRY-RUN"}`);

  const gaps = await findSnapshotGapSections(SY);
  logger.info(`[EosyBackfill] Snapshot-gap sections: ${gaps.length}`);
  for (const g of gaps) {
    logger.info(`  - ${g.sectionName}: ${g.snapshotCount}/${g.finalizedCount} snapshots`);
  }

  if (!apply) {
    logger.info("[EosyBackfill] Dry run — pass --apply to run the EOSY finalize.");
    await prisma.$disconnect();
    return;
  }

  if (gaps.length === 0) {
    logger.info("[EosyBackfill] No gaps — nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const actor = { id: "seed-backfill", name: "EOSY Backfill Script", role: "REGISTRAR" };

  let okCount = 0;
  let blockedCount = 0;
  let snapshotsCreated = 0;
  let processed = 0;

  for (const gap of gaps) {
    const result = await finalizeSectionEosy({
      sectionId: gap.sectionId,
      schoolYear: SY,
      actor,
    });

    if (result.ok === false) {
      blockedCount++;
      logger.warn(
        `[EosyBackfill] BLOCKED ${gap.sectionName}: ${result.error} ${
          result.error === "DRAFT_BLOCKED" ? `(${result.blockers.length} draft blockers)` : ""
        }`
      );
      continue;
    }

    okCount++;
    snapshotsCreated += result.snapshotsCreated;
    processed += result.processed;
    logger.info(
      `[EosyBackfill] OK ${gap.sectionName}: ${result.processed} enrollments, ${result.snapshotsCreated} snapshots`
    );
  }

  logger.info(
    `[EosyBackfill] Done. Sections OK: ${okCount}, Blocked: ${blockedCount}, Total snapshots created: ${snapshotsCreated}, Enrollments processed: ${processed}`
  );

  const after = await findSnapshotGapSections(SY);
  logger.info(`[EosyBackfill] Remaining snapshot-gap sections: ${after.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  logger.error("[EosyBackfill] Failed:", e);
  process.exit(1);
});