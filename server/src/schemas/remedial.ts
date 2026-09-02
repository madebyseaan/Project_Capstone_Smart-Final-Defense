/**
 * remedial.ts — Zod schemas for remedial class endpoints
 */

import { z } from 'zod';

export const remedialUpdateSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'RemedialClass id is required'),
  }),
  body: z.object({
    remedialMark: z.number().min(60, 'RCM must be at least 60').max(100, 'RCM must be at most 100'),
    conductedFrom: z.string().optional(),
    conductedTo: z.string().optional(),
  }),
});

export const remedialCompleteSchema = z.object({
  params: z.object({
    enrollmentId: z.string().min(1, 'enrollmentId is required'),
  }),
  body: z.object({
    retentionOverride: z.boolean().optional(),
  }),
});

export const remedialManualCreateSchema = z.object({
  params: z.object({
    enrollmentId: z.string().min(1, 'enrollmentId is required'),
  }),
  body: z.object({
    subjectCode: z.string().min(1),
    subjectName: z.string().min(1),
    originalGrade: z.number().min(0).max(100),
  }),
});

export const remedialPendingQuerySchema = z.object({
  query: z.object({
    schoolYear: z.string().optional(),
    gradeLevel: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});
