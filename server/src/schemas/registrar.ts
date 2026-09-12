/**
 * registrar.ts — Zod schemas for registrar endpoints
 */

import { z } from 'zod';

const enrollmentStatusEnum = z.enum(['ENROLLED', 'DROPPED', 'TRANSFERRED']);
const termEnum = z.enum(['T1', 'T2', 'T3']);

export const enrollmentStatusSchema = z.object({
  params: z.object({
    enrollmentId: z.string().min(1, 'enrollmentId is required'),
  }),
  body: z.object({
    status: enrollmentStatusEnum,
  }),
});

export const finalizeGradesSchema = z.object({
  body: z.object({
    sectionId: z.string().min(1, 'sectionId is required'),
    term: termEnum,
    subjectId: z.string().min(1, 'subjectId is required'),
  }),
});

export const unfinalizeGradesSchema = z.object({
  body: z.object({
    sectionId: z.string().min(1, 'sectionId is required'),
    term: termEnum,
    subjectId: z.string().min(1, 'subjectId is required'),
  }),
});

export const eosyFinalizeSchema = z.object({
  body: z.object({
    sectionId: z.string().min(1, 'sectionId is required'),
    schoolYear: z.string().min(1, 'schoolYear is required'),
  }),
});

export const transfereeUpdateSchema = z.object({
  params: z.object({
    enrollmentId: z.string().min(1, 'enrollmentId is required'),
  }),
  body: z.object({
    previousSchool: z.string().min(1).max(200).optional(),
    lastGradeCompleted: z.string().max(100).optional(),
    transferCertNo: z.string().max(100).optional(),
    birthDate: z.string().datetime().optional(),
    gender: z.enum(['MALE', 'FEMALE']).optional(),
    transferInDate: z.string().datetime().optional(),
  }),
});

export const transfereeTagSchema = z.object({
  params: z.object({
    enrollmentId: z.string().min(1, 'enrollmentId is required'),
  }),
  body: z.object({
    transferInDate: z.string().datetime().optional(),
    reason: z.string().max(300).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Prior-school (SF10/SF9) records — registrar manual entry
// See docs/REGISTRAR/SF10_SF9_IMPORT_PLAN.md
// ---------------------------------------------------------------------------

const externalGradeLevelEnum = z.enum(['GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_10']);
const schoolYearLabel = z.string().regex(/^\d{4}-\d{4}$/, 'schoolYear must look like YYYY-YYYY');

export const externalTermSchema = z.object({
  label: z.string().min(1).max(30),
  value: z.number().min(0).max(100),
});

export const externalSubjectSchema = z.object({
  subjectCode: z.string().max(50).optional(),
  subjectName: z.string().min(1).max(200),
  terms: z.array(externalTermSchema).max(8).optional(),
  finalRating: z.number().min(0).max(100).optional(),
  remarks: z.string().max(50).optional(),
  isNonPromotional: z.boolean().optional(),
});

export const externalRecordCreateSchema = z.object({
  params: z.object({ studentId: z.string().min(1, 'studentId is required') }),
  body: z.object({
    schoolYear: schoolYearLabel,
    gradeLevel: externalGradeLevelEnum,
    schoolName: z.string().min(1).max(200),
    schoolId: z.string().max(50).optional(),
    sectionName: z.string().max(100).optional(),
    adviserName: z.string().max(150).optional(),
    generalAverage: z.number().min(0).max(100).optional(),
    promotionStatus: z.string().max(50).optional(),
    formType: z.enum(['SF10', 'SF9']).optional(),
    isPartialYear: z.boolean().optional(),
    ocrRawText: z.string().max(20000).optional(),
    source: z.enum(['MANUAL', 'SF10_SCAN', 'SF9_SCAN', 'SF10_XLSX']).optional(),
    subjects: z.array(externalSubjectSchema).min(1).max(50),
  }),
});

export const externalRecordUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1, 'id is required') }),
  body: z.object({
    schoolYear: schoolYearLabel.optional(),
    gradeLevel: externalGradeLevelEnum.optional(),
    schoolName: z.string().min(1).max(200).optional(),
    schoolId: z.string().max(50).optional(),
    sectionName: z.string().max(100).optional(),
    adviserName: z.string().max(150).optional(),
    generalAverage: z.number().min(0).max(100).optional(),
    promotionStatus: z.string().max(50).optional(),
    formType: z.enum(['SF10', 'SF9']).optional(),
    isPartialYear: z.boolean().optional(),
    subjects: z.array(externalSubjectSchema).min(1).max(50).optional(),
  }),
});

export const externalRecordIdSchema = z.object({
  params: z.object({ id: z.string().min(1, 'id is required') }),
});

export const externalRecordStudentSchema = z.object({
  params: z.object({ studentId: z.string().min(1, 'studentId is required') }),
});

// ---------------------------------------------------------------------------
// SF10 profile (registrar-editable fields rendered on the SF10)
// The "Eligibility for JHS Enrolment" block is registrar-owned (EnrollPro does
// not provide it). Names / LRN remain EnrollPro-owned and are NOT accepted here.
// ---------------------------------------------------------------------------

const dateLike = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date');

export const sf10ProfileUpdateSchema = z.object({
  params: z.object({ studentId: z.string().min(1, 'studentId is required') }),
  body: z.object({
    birthDate: dateLike.nullable().optional(),
    gender: z
      .preprocess((v) => {
        if (v == null) return v;
        const s = String(v).trim().toUpperCase();
        if (s === 'MALE' || s === 'M') return 'MALE';
        if (s === 'FEMALE' || s === 'F') return 'FEMALE';
        return v;
      }, z.enum(['MALE', 'FEMALE']).nullable())
      .optional(),
    previousSchool: z.string().max(200).nullable().optional(),
    lastGradeCompleted: z.string().max(100).nullable().optional(),
    transferCertNo: z.string().max(100).nullable().optional(),
    transferInDate: dateLike.nullable().optional(),
    elementarySchoolCompleter: z.boolean().optional(),
    elementarySchoolName: z.string().max(200).nullable().optional(),
    elementaryGeneralAverage: z.number().min(0).max(100).nullable().optional(),
    peptPasser: z.boolean().optional(),
    peptRating: z.number().min(0).max(100).nullable().optional(),
    peptExamDate: dateLike.nullable().optional(),
    alsAePasser: z.boolean().optional(),
  }),
});
