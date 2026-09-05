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
