/**
 * remedial.ts — Zod schemas for remedial class endpoints
 */

import { z } from 'zod';

// Date-only string (YYYY-MM-DD) — avoids timezone drift from partial ISO parsing
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const remedialUpdateSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'RemedialClass id is required'),
  }),
  body: z.object({
    remedialMark: z.number().min(60, 'RCM must be at least 60').max(100, 'RCM must be at most 100').optional(),
    conductedFrom: dateString.optional(),
    conductedTo: dateString.optional(),
  }).refine(
    (d) => d.remedialMark !== undefined || d.conductedFrom !== undefined || d.conductedTo !== undefined,
    { message: 'At least one of remedialMark, conductedFrom, or conductedTo is required' }
  ).refine(
    (d) => {
      if (d.conductedFrom && d.conductedTo) {
        return d.conductedTo >= d.conductedFrom;
      }
      return true;
    },
    { message: 'conductedTo must be on or after conductedFrom' }
  ),
});

export const remedialCompleteSchema = z.object({
  params: z.object({
    enrollmentId: z.string().min(1, 'enrollmentId is required'),
  }),
  body: z.object({
    retentionOverride: z.boolean().optional(),
    conductedFrom: dateString.optional(),
    conductedTo: dateString.optional(),
  }).refine(
    (d) => {
      if (d.conductedFrom && d.conductedTo) {
        return d.conductedTo >= d.conductedFrom;
      }
      return true;
    },
    { message: 'conductedTo must be on or after conductedFrom' }
  ),
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

export const remedialSyncSchema = z.object({
  body: z.object({
    schoolYear: z.string().optional(),
  }),
});

export const remedialHistoryQuerySchema = z.object({
  query: z.object({
    schoolYear: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});
