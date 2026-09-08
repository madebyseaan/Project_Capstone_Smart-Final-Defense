/**
 * schemas/aims.ts — Zod validation for AIMS integration payloads.
 *
 * Validates:
 *   - External AIMS API responses (defensive — don't trust external data)
 *   - Internal request bodies for link/import endpoints
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// AIMS public scores response (GET /public/courses/:id/scores)
// ---------------------------------------------------------------------------

const aimsScoreRowSchema = z.object({
  submissionId: z.string(),
  userId: z.string(),
  studentName: z.string(),
  studentEmail: z.string().nullable(),
  enrollproId: z.number().nullable(),
  assessmentId: z.string(),
  quizId: z.string().nullable(),
  quizTitle: z.string(),
  type: z.enum(['QUIZ', 'TASK']),
  category: z.enum(['WW', 'PT', 'QA']),
  isRemedial: z.boolean(),
  sourceQuizId: z.string().nullable().optional(),
  forStudentId: z.string().nullable().optional(),
  passingScore: z.number().nullable().optional(),
  score: z.number(),
  maxPoints: z.number(),
  pointsEarned: z.number(),
  status: z.enum(['GRADED', 'RETURNED']),
  attemptNumber: z.number(),
  startedAt: z.string().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  gradedAt: z.string().nullable().optional(),
  termIndex: z.number().int().min(1).max(3).nullable().optional(),
});

export const aimsPublicScoresSchema = z.object({
  course: z.object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    subject: z.string(),
    gradeLevel: z.string(),
    sectionName: z.string(),
    schoolYear: z.string(),
  }),
  weights: z.object({
    ww: z.number(),
    pt: z.number(),
  }),
  rows: z.array(aimsScoreRowSchema),
});

// ---------------------------------------------------------------------------
// AIMS course summary (GET /public/courses)
// ---------------------------------------------------------------------------

export const aimsCourseSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  subject: z.string(),
  gradeLevel: z.string(),
  sectionName: z.string(),
  schoolYear: z.string(),
  archived: z.boolean(),
  teacherEmail: z.string().nullable().optional(),
  teacherName: z.string().nullable().optional(),
  teacherUsername: z.string().nullable().optional(),
  studentCount: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Internal request schemas
// ---------------------------------------------------------------------------

export const aimsLinkSchema = z.object({
  body: z.object({
    aimsCourseId: z.string().uuid('Invalid AIMS course ID format'),
  }),
});

export const aimsImportSchema = z.object({
  body: z.object({
    term: z.enum(['T1', 'T2', 'T3']),
    assessmentIds: z.array(z.string()).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AimsPublicScoresPayload = z.infer<typeof aimsPublicScoresSchema>;
export type AimsCourseSummaryPayload = z.infer<typeof aimsCourseSummarySchema>;
