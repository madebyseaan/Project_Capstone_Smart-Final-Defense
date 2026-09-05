/**
 * sync/utils.ts
 *
 * Shared utilities for all sync modules.
 * Re-exports from atlasUtils.ts and adds additional shared helpers.
 */

import { prisma } from '../prisma';
import type { GradeLevel } from '@prisma/client';
import { snapshotForDb } from '../studentSnapshot';

// Re-export everything from atlasUtils (the canonical source)
export {
  mapGradeLevel,
  resolveSubjectCode,
  resolveSubjectName,
  normalizeSubjectLabel,
  sanitizeSubjectName,
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

  // Resolve address and guardian from multiple possible field names
  const incomingAddress = learner.address || learner.homeAddress || learner.currentAddress || null;
  const incomingGuardian = learner.parentGuardianName || learner.guardianName || null;
  const incomingGuardianContact = learner.parentGuardianContact || learner.guardianContact || null;

  // Resolve extended profile fields
  const incomingReligion = learner.religion || null;
  const incomingMotherTongue = learner.motherTongue || null;
  const incomingBarangay = learner.barangay || null;
  const incomingCity = learner.city || learner.municipality || null;
  const incomingProvince = learner.province || null;
  const incomingFatherName = learner.fatherName || learner.father?.name || null;
  const incomingFatherContact = learner.fatherContact || learner.father?.contact || null;
  const incomingMotherName = learner.motherName || learner.mother?.name || null;
  const incomingMotherContact = learner.motherContact || learner.mother?.contact || null;
  const incomingIpCommunity = learner.ipCommunity === true || String(learner.ipCommunity).toUpperCase() === 'YES';
  const incomingIs4Ps = learner.is4PsBeneficiary === true || String(learner.is4PsBeneficiary).toUpperCase() === 'YES';
  const incomingDisability = learner.disability && learner.disability !== 'NONE' ? learner.disability : null;
  const incomingIsBalikAral = learner.isBalikAral === true || String(learner.isBalikAral).toUpperCase() === 'YES';

  const student = await prisma.student.upsert({
    where: { lrn: learner.lrn },
    update: {
      firstName: learner.firstName,
      lastName: learner.lastName,
      middleName: learner.middleName ?? null,
      suffix: learner.extensionName ?? null,
      gender: learner.sex ?? null,
      birthDate: learner.birthdate ? new Date(learner.birthdate) : undefined,
      address: incomingAddress,
      guardianName: incomingGuardian,
      guardianContact: incomingGuardianContact,
      religion: incomingReligion,
      motherTongue: incomingMotherTongue,
      barangay: incomingBarangay,
      city: incomingCity,
      province: incomingProvince,
      fatherName: incomingFatherName,
      fatherContact: incomingFatherContact,
      motherName: incomingMotherName,
      motherContact: incomingMotherContact,
      ipCommunity: incomingIpCommunity,
      is4PsBeneficiary: incomingIs4Ps,
      disability: incomingDisability,
      isBalikAral: incomingIsBalikAral,
    },
    create: {
      lrn: learner.lrn,
      firstName: learner.firstName,
      lastName: learner.lastName,
      middleName: learner.middleName ?? null,
      suffix: learner.extensionName ?? null,
      gender: learner.sex ?? null,
      birthDate: learner.birthdate ? new Date(learner.birthdate) : null,
      address: incomingAddress,
      guardianName: incomingGuardian,
      guardianContact: incomingGuardianContact,
      religion: incomingReligion,
      motherTongue: incomingMotherTongue,
      barangay: incomingBarangay,
      city: incomingCity,
      province: incomingProvince,
      fatherName: incomingFatherName,
      fatherContact: incomingFatherContact,
      motherName: incomingMotherName,
      motherContact: incomingMotherContact,
      ipCommunity: incomingIpCommunity,
      is4PsBeneficiary: incomingIs4Ps,
      disability: incomingDisability,
      isBalikAral: incomingIsBalikAral,
    },
  });
  await prisma.enrollment.upsert({
    where: { studentId_sectionId_schoolYear: { studentId: student.id, sectionId, schoolYear } },
    update: { status: 'ENROLLED' },
    create: {
      studentId: student.id, sectionId, schoolYear, status: 'ENROLLED',
      profileSnapshot: snapshotForDb(student) as any,
    },
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
