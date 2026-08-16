/**
 * sync/utils.ts
 *
 * Shared utilities for all sync modules.
 * Re-exports from atlasUtils.ts and adds additional shared helpers.
 */

import { prisma } from '../prisma';
import type { GradeLevel } from '@prisma/client';

// Re-export everything from atlasUtils (the canonical source)
export {
  mapGradeLevel,
  resolveSubjectCode,
  resolveSubjectName,
  normalizeSubjectLabel,
  sanitizeSubjectName,
  ensureHomeroomGuidanceLabel,
  HOMEROOM_GUIDANCE_LABEL,
  HOMEROOM_GUIDANCE_MINUTES,
} from '../atlasUtils';

// ---------------------------------------------------------------------------
// Student/Enrollment upsert helpers
// ---------------------------------------------------------------------------

/**
 * Upsert a learner (student + enrollment) into SMART.
 * Used by both teacherSync and enrollproSync.
 */
export async function upsertLearner(
  learner: any,
  sectionId: string,
  schoolYear: string,
): Promise<boolean> {
  if (!learner?.lrn) return false;
  const student = await prisma.student.upsert({
    where: { lrn: learner.lrn },
    update: {
      firstName: learner.firstName,
      lastName: learner.lastName,
      middleName: learner.middleName ?? null,
      gender: learner.sex ?? null,
      birthDate: learner.birthdate ? new Date(learner.birthdate) : undefined,
    },
    create: {
      lrn: learner.lrn,
      firstName: learner.firstName,
      lastName: learner.lastName,
      middleName: learner.middleName ?? null,
      suffix: learner.extensionName ?? null,
      gender: learner.sex ?? null,
      birthDate: learner.birthdate ? new Date(learner.birthdate) : null,
    },
  });
  await prisma.enrollment.upsert({
    where: { studentId_sectionId_schoolYear: { studentId: student.id, sectionId, schoolYear } },
    update: { status: 'ENROLLED' },
    create: { studentId: student.id, sectionId, schoolYear, status: 'ENROLLED' },
  });
  return true;
}

/**
 * Drop stale enrollments for a section after a fresh sync.
 * Any student currently ENROLLED in the section who is NOT in the new
 * learner list (identified by LRN) gets marked as DROPPED.
 */
export async function dropStaleEnrollments(
  sectionId: string,
  schoolYear: string,
  freshLearners: any[],
): Promise<number> {
  const freshLRNs = new Set<string>(
    freshLearners
      .map((rec) => (rec.learner ?? rec)?.lrn)
      .filter((lrn): lrn is string => Boolean(lrn)),
  );

  const currentlyEnrolled = await prisma.enrollment.findMany({
    where: { sectionId, schoolYear, status: 'ENROLLED' },
    select: { id: true, student: { select: { lrn: true } } },
  });

  const toDropIds = currentlyEnrolled
    .filter((e) => !freshLRNs.has(e.student.lrn))
    .map((e) => e.id);

  if (toDropIds.length > 0) {
    await prisma.enrollment.updateMany({
      where: { id: { in: toDropIds } },
      data: { status: 'DROPPED' },
    });
  }
  return toDropIds.length;
}

/**
 * Upsert a section in SMART (create from Atlas/EnrollPro data if missing).
 */
export async function upsertSection(
  name: string,
  gradeLevel: GradeLevel,
  schoolYear: string,
  adviserId?: string,
): Promise<any> {
  return (prisma.section as any).upsert({
    where: { name_gradeLevel_schoolYear: { name, gradeLevel, schoolYear } },
    update: adviserId ? { adviserId } : {},
    create: { name, gradeLevel, schoolYear, ...(adviserId ? { adviserId } : {}) },
  });
}
