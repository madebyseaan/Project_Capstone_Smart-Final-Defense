/**
 * grades.ts — Zod schemas for grade management endpoints
 */

import { z } from 'zod';

const termEnum = z.enum(['T1', 'T2', 'T3']);

const scoreItemSchema = z.object({
  name: z.string().min(1),
  score: z.number().min(0),
  maxScore: z.number().positive(),
});

export const gradeSaveSchema = z.object({
  body: z.object({
    studentId: z.string().min(1, 'studentId is required'),
    classAssignmentId: z.string().min(1, 'classAssignmentId is required'),
    term: termEnum,
    writtenWorkScores: z.array(scoreItemSchema).optional(),
    perfTaskScores: z.array(scoreItemSchema).optional(),
    quarterlyAssessScore: z.number().min(0).optional(),
    quarterlyAssessMax: z.number().positive().optional(),
    qaDescription: z.string().optional(),
    qaDate: z.string().optional(),
  }),
});

export const gradeDeleteSchema = z.object({
  params: z.object({
    gradeId: z.string().min(1, 'gradeId is required'),
  }),
});

export const clearScoresSchema = z.object({
  body: z.object({
    classAssignmentId: z.string().min(1, 'classAssignmentId is required'),
    term: termEnum,
  }),
});

export const editRequestSchema = z.object({
  body: z.object({
    term: termEnum,
    reason: z.string().min(1, 'Reason is required').max(500, 'Reason must be 500 characters or less'),
    classAssignmentId: z.string().optional(),
    gradeLevel: z.string().optional(),
    section: z.string().optional(),
    subject: z.string().optional(),
  }),
});

export const editRequestApproveSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'id is required'),
  }),
  body: z.object({
    hours: z.number().min(1).max(168).optional(),
  }),
});

export const editRequestRejectSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'id is required'),
  }),
  body: z.object({
    reason: z.string().max(500).optional(),
  }),
});

export const classAssignmentDeleteSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'id is required'),
  }),
});
