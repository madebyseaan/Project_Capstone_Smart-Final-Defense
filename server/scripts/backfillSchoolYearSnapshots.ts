/**
 * backfillSchoolYearSnapshots.ts
 *
 * Backfills schoolSettingsSnapshot for existing SchoolYear records
 * that have NULL snapshots. Uses current SystemSettings (best effort).
 *
 * Run:
 *   npx tsx scripts/backfillSchoolYearSnapshots.ts          (dry-run)
 *   npx tsx scripts/backfillSchoolYearSnapshots.ts --apply   (write)
 *
 * Safe to re-run (W5): years with existing snapshots are skipped.
 */

import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { logger } from "../src/lib/logger";

async function main() {
  const apply = process.argv.includes("--apply");

  const prisma = new PrismaClient();

  const settings = await prisma.systemSettings.findUnique({
    where: { id: "main" },
    select: {
      schoolName: true,
      schoolId: true,
      division: true,
      region: true,
      schoolHeadName: true,
      address: true,
    },
  });
  if (!settings) {
    logger.error("[BackfillSnapshots] SystemSettings row 'main' missing — nothing to backfill from");
    await prisma.$disconnect();
    process.exit(1);
  }

  const snapshot = {
    schoolName: settings.schoolName || "",
    schoolId: settings.schoolId || "",
    division: settings.division || "",
    region: settings.region || "",
    schoolHeadName: settings.schoolHeadName || "",
    address: settings.address || "",
  };

  // Json null filtering: use Prisma.DbNull (NOT bare null — ambiguous with JSON null)
  const targets = await prisma.schoolYear.findMany({
    where: { schoolSettingsSnapshot: { equals: Prisma.DbNull } },
    select: { id: true, label: true, status: true },
  });

  logger.info(
    `[BackfillSnapshots] Years without snapshot: ${targets.length} -> ${targets.map((t) => `${t.label} (${t.status})`).join(", ")}`
  );

  if (!apply) {
    logger.info("[BackfillSnapshots] Dry run — pass --apply to write.");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.schoolYear.updateMany({
    where: { schoolSettingsSnapshot: { equals: Prisma.DbNull } },
    data: { schoolSettingsSnapshot: snapshot as any },
  });

  logger.info(`[BackfillSnapshots] Backfilled ${result.count} school years`);
  await prisma.$disconnect();
}

main().catch((e) => {
  logger.error("[BackfillSnapshots] Failed:", e);
  process.exit(1);
});
