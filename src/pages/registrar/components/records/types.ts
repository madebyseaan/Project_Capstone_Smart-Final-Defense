/**
 * types.ts — shared types for the registrar Records Vault.
 */
import type { StudentDocumentsIndexEntry } from "@/lib/api";

export interface VaultStudent {
  id: string;
  enrollmentId: string;
  lrn: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  gender: string | null;
  lastGradeLevel: string;
  lastSection: string;
  lastSchoolYear: string;
  lastProgram: string;
  enrollmentStatus: string;
}

export type VaultTab = "overview" | "sf10" | "sf9" | "prior" | "remedial";

export const EMPTY_INDEX_ENTRY: StudentDocumentsIndexEntry = {
  sf10: false,
  reportCardYears: [],
  priorRecords: 0,
  remedial: false,
};

export const isSyntheticStudentId = (id: string): boolean => id.startsWith("ep-");

export const formatVaultName = (student: VaultStudent): string =>
  [student.lastName, student.firstName, student.middleName].filter(Boolean).join(", ");

export const formatVaultGradeLevel = (gradeLevel: string): string =>
  gradeLevel ? `Grade ${gradeLevel.replace("GRADE_", "")}` : "";
