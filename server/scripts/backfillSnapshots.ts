/**
 * backfillSnapshots.ts
 *
 * Backfills profileSnapshot for existing enrollments that have NULL snapshots.
 * Uses current student data (best effort — not perfectly historical, but better than NULL).
 *
 * Run: npx tsx scripts/backfillSnapshots.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { snapshotForDb } from '../src/lib/studentSnapshot';
import { logger } from '../src/lib/logger';

async function main() {
  logger.info('[Backfill] Starting enrollment snapshot backfill...');

  // Find all enrollments without snapshots
  const allEnrollments = await prisma.enrollment.findMany({
    select: { id: true, studentId: true, schoolYear: true, profileSnapshot: true },
  });

  const needsBackfill = allEnrollments.filter(e => !e.profileSnapshot);
  logger.info(`[Backfill] Found ${needsBackfill.length} enrollments without snapshots (of ${allEnrollments.length} total)`);

  if (needsBackfill.length === 0) {
    logger.info('[Backfill] Nothing to backfill.');
    await prisma.$disconnect();
    return;
  }

  // Fetch all students needed
  const studentIds = [...new Set(needsBackfill.map(e => e.studentId))];
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
  });
  const studentMap = new Map(students.map(s => [s.id, s]));

  // Backfill in batches of 50
  const BATCH_SIZE = 50;
  let backfilled = 0;
  let skipped = 0;

  for (let i = 0; i < needsBackfill.length; i += BATCH_SIZE) {
    const batch = needsBackfill.slice(i, i + BATCH_SIZE);

    const updates = batch.map(e => {
      const student = studentMap.get(e.studentId);
      if (!student) {
        skipped++;
        return prisma.enrollment.update({ where: { id: 'never-match' }, data: {} });
      }
      backfilled++;
      return prisma.enrollment.update({
        where: { id: e.id },
        data: { profileSnapshot: snapshotForDb(student) as any },
      });
    });

    await prisma.$transaction(updates);
    logger.info(`[Backfill] Progress: ${Math.min(i + BATCH_SIZE, needsBackfill.length)}/${needsBackfill.length}`);
  }

  logger.info(`[Backfill] Done. Backfilled: ${backfilled}, Skipped (no student): ${skipped}`);
  await prisma.$disconnect();
}

main().catch(e => {
  logger.error('[Backfill] Failed:', e);
  process.exit(1);
});
