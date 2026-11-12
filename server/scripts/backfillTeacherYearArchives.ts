/**
 * scripts/backfillTeacherYearArchives.ts
 *
 * Creates/regenerates per-teacher archives for already-archived school years.
 * This is the historical backfill path; rollover handles future years.
 *
 * Usage:
 *   pnpm --prefix server exec ts-node --transpile-only scripts/backfillTeacherYearArchives.ts [schoolYear]
 *   pnpm --prefix server exec ts-node --transpile-only scripts/backfillTeacherYearArchives.ts --force
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  ensureTeacherArchivesQueued,
  generateTeacherYearArchives,
} from "../src/lib/teacherYearArchive";

const ARCHIVABLE_STATUSES = new Set(["ARCHIVED", "COMPLETED"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const yearArg = args.find((arg) => !arg.startsWith("--"));

  const years = yearArg
    ? await prisma.schoolYear.findMany({ where: { label: yearArg } })
    : await prisma.schoolYear.findMany({
        where: { status: { in: ["ARCHIVED", "COMPLETED"] } },
        orderBy: { label: "asc" },
      });

  if (years.length === 0) {
    console.log("[backfill] No matching school years found.");
    return;
  }

  let failed = 0;

  for (const year of years) {
    if (!ARCHIVABLE_STATUSES.has(year.status)) {
      console.warn(`[backfill] Skipping ${year.label}: status is ${year.status}, not archived.`);
      continue;
    }

    const queued = await ensureTeacherArchivesQueued({
      schoolYearId: year.id,
      yearLabel: year.label,
      source: "BACKFILL",
      createdBy: "backfill-script",
    });

    const summary = await generateTeacherYearArchives(year.id, {
      regenerate: force,
      source: "BACKFILL",
    });

    console.log(
      `[backfill] ${year.label}: queued=${queued}, considered=${summary.considered}, ` +
        `complete=${summary.completed}, failed=${summary.failed}, ` +
        `raw=${(summary.rawBytes / 1024).toFixed(1)}KB, ` +
        `gzip=${(summary.compressedBytes / 1024).toFixed(1)}KB, ${summary.durationMs}ms`,
    );

    failed += summary.failed;
  }

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[backfill] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
