/**
 * cleanup-hg-current-sy.ts
 *
 * Removes Homeroom Guidance (HG) data for the CURRENT school year only.
 * Historical HG data is preserved for archived-year SF10/SF5 regeneration.
 *
 * Usage: npx ts-node scripts/cleanup-hg-current-sy.ts
 *
 * Safety:
 * - Only deletes Grade, ClassAssignment, and ScheduleEntry for current SY
 * - Subject rows HG* are KEPT (historical FK targets)
 * - GradeSnapshot rows with subjectCode LIKE 'HG%' are KEPT
 * - Past-year HG Grades/ClassAssignments are KEPT
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[cleanup-hg] Starting Homeroom Guidance cleanup for current school year...');

  // 1. Resolve current school year
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  const currentSY = settings?.currentSchoolYear;
  if (!currentSY) {
    console.error('[cleanup-hg] No current school year found in SystemSettings. Aborting.');
    process.exit(1);
  }
  console.log(`[cleanup-hg] Current school year: ${currentSY}`);

  // 2. Find current-SY ClassAssignments with HG subjects
  const hgAssignments = await prisma.classAssignment.findMany({
    where: {
      schoolYear: currentSY,
      subject: { code: { startsWith: 'HG' } },
    },
    select: { id: true, subject: { select: { code: true } } },
  });

  if (hgAssignments.length === 0) {
    console.log('[cleanup-hg] No HG class assignments found for current SY. Nothing to clean.');
    await prisma.$disconnect();
    return;
  }

  console.log(`[cleanup-hg] Found ${hgAssignments.length} HG class assignments to remove:`);
  for (const a of hgAssignments) {
    console.log(`  - ${a.id} (${a.subject.code})`);
  }

  const assignmentIds = hgAssignments.map(a => a.id);

  // 3. Delete Grades for these assignments (current SY only)
  const deletedGrades = await prisma.grade.deleteMany({
    where: { classAssignmentId: { in: assignmentIds } },
  });
  console.log(`[cleanup-hg] Deleted ${deletedGrades.count} Grade rows`);

  // 4. Delete ScheduleEntries for HG subjects (current SY)
  const deletedSchedules = await prisma.scheduleEntry.deleteMany({
    where: {
      schoolYear: currentSY,
      subject: { code: { startsWith: 'HG' } },
    },
  });
  console.log(`[cleanup-hg] Deleted ${deletedSchedules.count} ScheduleEntry rows`);

  // 5. Delete the ClassAssignments themselves
  const deletedAssignments = await prisma.classAssignment.deleteMany({
    where: { id: { in: assignmentIds } },
  });
  console.log(`[cleanup-hg] Deleted ${deletedAssignments.count} ClassAssignment rows`);

  // 6. Summary
  console.log('[cleanup-hg] Cleanup complete. Summary:');
  console.log(`  Grades deleted:          ${deletedGrades.count}`);
  console.log(`  ScheduleEntries deleted: ${deletedSchedules.count}`);
  console.log(`  ClassAssignments deleted: ${deletedAssignments.count}`);
  console.log('[cleanup-hg] Subject rows HG* preserved (historical FK targets).');
  console.log('[cleanup-hg] GradeSnapshot rows with subjectCode LIKE HG% preserved (SF10 regeneration).');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[cleanup-hg] Fatal error:', err);
  process.exit(1);
});
