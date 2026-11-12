/**
 * scripts/reportTeacherArchives.ts
 *
 * Read-only size/performance report for per-teacher year archives.
 * Builds payloads in memory and prints raw/gzip sizes without writing to the DB.
 *
 * Usage:
 *   pnpm --prefix server exec ts-node --transpile-only scripts/reportTeacherArchives.ts [schoolYear]
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  collectExpectedTeachers,
  fetchYearData,
  buildTeacherArchivePayload,
  serializeTeacherArchivePayload,
  TEACHER_ARCHIVE_MAX_RAW_BYTES,
} from "../src/lib/teacherYearArchive";

const AVG_BUDGET_BYTES = 400 * 1024;
const TOTAL_BUDGET_BYTES = 20 * 1024 * 1024;

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main(): Promise<void> {
  const yearArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const years = yearArg
    ? await prisma.schoolYear.findMany({ where: { label: yearArg } })
    : await prisma.schoolYear.findMany({
        where: { status: { in: ["ARCHIVED", "COMPLETED"] } },
        orderBy: { label: "asc" },
      });

  if (years.length === 0) {
    console.log("[report] No archived school years found.");
    return;
  }

  let budgetFailed = false;

  for (const year of years) {
    const startedAt = Date.now();
    const [teachers, data] = await Promise.all([
      collectExpectedTeachers(prisma, year.label),
      fetchYearData(prisma, year.label),
    ]);

    let totalRaw = 0;
    let totalCompressed = 0;
    let largestRaw = 0;
    let largestName = "-";
    let oversized = 0;

    for (const teacher of teachers) {
      const payload = buildTeacherArchivePayload(data, teacher, { source: "BACKFILL", backfilled: true });
      const serialized = serializeTeacherArchivePayload(payload);
      totalRaw += serialized.rawBytes;
      totalCompressed += serialized.compressedBytes;
      if (serialized.rawBytes > largestRaw) {
        largestRaw = serialized.rawBytes;
        largestName = teacher.teacherName;
      }
      if (serialized.oversized || serialized.rawBytes > TEACHER_ARCHIVE_MAX_RAW_BYTES) oversized += 1;
    }

    const avgCompressed = teachers.length > 0 ? totalCompressed / teachers.length : 0;
    const ratio = totalCompressed > 0 ? totalRaw / totalCompressed : 0;
    const durationMs = Date.now() - startedAt;

    console.log(
      `\n[report] ${year.label} (${year.status}) — ${teachers.length} teacher(s), ${durationMs}ms\n` +
        `  raw total:        ${kb(totalRaw)}\n` +
        `  compressed total: ${kb(totalCompressed)}\n` +
        `  avg compressed:   ${kb(avgCompressed)} per teacher-year\n` +
        `  compression ratio ${ratio.toFixed(1)}x\n` +
        `  largest:          ${kb(largestRaw)} (${largestName})\n` +
        `  oversized (>10MB): ${oversized}`,
    );

    if (avgCompressed > AVG_BUDGET_BYTES) {
      console.error(`[report] FAIL: average ${kb(avgCompressed)} exceeds ${kb(AVG_BUDGET_BYTES)} budget.`);
      budgetFailed = true;
    }
    if (totalCompressed > TOTAL_BUDGET_BYTES) {
      console.error(`[report] WARN: total ${kb(totalCompressed)} exceeds ${kb(TOTAL_BUDGET_BYTES)} reference budget.`);
    }
  }

  if (budgetFailed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[report] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
