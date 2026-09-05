/**
 * studentSnapshot.ts
 *
 * Creates immutable student profile snapshots at enrollment time.
 * Snapshots are stored on the Enrollment model as `profileSnapshot` (JSON).
 * Used by: sync, registrar, admin routes.
 */

import { logger } from './logger';

/**
 * Shape of the student profile snapshot.
 * Captures all profile fields at enrollment time.
 * This is immutable — never updated after creation.
 */
export interface StudentProfileSnapshot {
  lrn: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  birthDate: string | null;
  gender: string | null;
  address: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  guardianName: string | null;
  guardianContact: string | null;
  fatherName: string | null;
  fatherContact: string | null;
  motherName: string | null;
  motherContact: string | null;
  religion: string | null;
  motherTongue: string | null;
  ipCommunity: boolean | null;
  is4PsBeneficiary: boolean | null;
  disability: string | null;
  isBalikAral: boolean | null;
  previousSchool: string | null;
  lastGradeCompleted: string | null;
  transferCertNo: string | null;
}

/**
 * Creates a snapshot from a student record.
 * The student object must have all profile fields (from Prisma include or direct query).
 */
export function createProfileSnapshot(student: Record<string, any>): StudentProfileSnapshot {
  return {
    lrn: student.lrn ?? '',
    firstName: student.firstName ?? '',
    middleName: student.middleName ?? null,
    lastName: student.lastName ?? '',
    suffix: student.suffix ?? null,
    birthDate: student.birthDate ? new Date(student.birthDate).toISOString().split('T')[0] : null,
    gender: student.gender ?? null,
    address: student.address ?? null,
    barangay: student.barangay ?? null,
    city: student.city ?? null,
    province: student.province ?? null,
    guardianName: student.guardianName ?? null,
    guardianContact: student.guardianContact ?? null,
    fatherName: student.fatherName ?? null,
    fatherContact: student.fatherContact ?? null,
    motherName: student.motherName ?? null,
    motherContact: student.motherContact ?? null,
    religion: student.religion ?? null,
    motherTongue: student.motherTongue ?? null,
    ipCommunity: student.ipCommunity ?? null,
    is4PsBeneficiary: student.is4PsBeneficiary ?? null,
    disability: student.disability ?? null,
    isBalikAral: student.isBalikAral ?? null,
    previousSchool: student.previousSchool ?? null,
    lastGradeCompleted: student.lastGradeCompleted ?? null,
    transferCertNo: student.transferCertNo ?? null,
  };
}

/**
 * Returns snapshot data suitable for Prisma create/update (plain object, not typed).
 */
export function snapshotForDb(student: Record<string, any>): Record<string, any> {
  return createProfileSnapshot(student) as Record<string, any>;
}
