/**
 * aimsClient.ts — AIMS LMS public API client (x-api-key auth).
 *
 * Replaces the old JWT-based stub. Uses the shared httpGet from sync/httpClient
 * for retries, timeout, and Tailscale cert handling.
 */

import { httpGet, HttpError } from './sync/httpClient';
import { logger } from './logger';
import { aimsPublicScoresSchema, aimsCourseSummarySchema } from '../schemas/aims';
import type { AimsPublicScoresPayload } from '../schemas/aims';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AIMS_BASE = (process.env.AIMS_URL ?? process.env.AIMS_BASE_URL ?? 'http://100.92.245.14:5000/api/v1').replace(/\/$/, '');
const AIMS_API_KEY = process.env.AIMS_API_KEY ?? '';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AimsError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AimsError';
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Types (mirror AIMS-PUBLIC-API.md)
// ---------------------------------------------------------------------------

export interface AimsPublicScoreRow {
  submissionId: string;
  userId: string;
  studentName: string;
  studentEmail: string;
  enrollproId: number;
  assessmentId: string;      // "QUIZ:<uuid>" | "TASK:<uuid>"
  quizId: string | null;
  quizTitle: string;
  type: 'QUIZ' | 'TASK';
  category: 'WW' | 'PT' | 'QA';
  isRemedial: boolean;
  sourceQuizId: string | null;
  forStudentId: string | null;
  passingScore: number | null;
  score: number;             // normalized 0-100
  maxPoints: number;
  pointsEarned: number;      // raw
  status: 'GRADED' | 'RETURNED';
  attemptNumber: number;
  startedAt: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  termIndex?: number | null;
}

export interface AimsPublicScoresData {
  course: {
    id: string;
    name: string;
    code: string;
    subject: string;
    gradeLevel: string;
    sectionName: string;
    schoolYear: string;
  };
  weights: {
    ww: number;
    pt: number;
  };
  rows: AimsPublicScoreRow[];
}

export interface AimsCourseSummary {
  id: string;
  name: string;
  code: string;
  subject: string;
  gradeLevel: string;
  sectionName: string;
  schoolYear: string;
  archived: boolean;
  teacherEmail?: string | null;
  teacherName?: string | null;
  teacherUsername?: string | null;
  studentCount?: number;
}

export interface AimsCourseListOptions {
  teacherEmail?: string;
  teacherUsername?: string;
  schoolYear?: string;
  includeArchived?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aimsUrl(path: string): string {
  return `${AIMS_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function aimsAuthHeaders(): Record<string, string> {
  return { 'x-api-key': AIMS_API_KEY };
}

function unwrapEnvelope(raw: any, context: string): any {
  if (raw == null) {
    throw new AimsError(503, `AIMS ${context}: empty response`);
  }
  if (raw.success === false) {
    const msg = raw.error ?? raw.message ?? 'Unknown AIMS error';
    throw new AimsError(400, `AIMS ${context}: ${msg}`);
  }
  return raw.data ?? raw;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if AIMS API key is configured.
 */
export function isAimsConfigured(): boolean {
  return AIMS_API_KEY.length > 0;
}

/**
 * Health check — GET /health (no auth required).
 * Signature-compatible with the old stub (used by systemHealth.ts + integration.ts /status).
 */
export async function checkAimsHealth(): Promise<boolean> {
  try {
    const url = aimsUrl('/health');
    await httpGet(url, undefined, 5000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch public scores for a course.
 * GET /public/courses/:courseId/scores
 * Returns null on 404 (course not found).
 */
export async function getAimsPublicScores(courseId: string): Promise<AimsPublicScoresPayload | null> {
  if (!isAimsConfigured()) {
    throw new AimsError(503, 'AIMS EXTERNAL_API_KEY not configured');
  }

  try {
    const raw = await httpGet(
      aimsUrl(`/public/courses/${courseId}/scores`),
      aimsAuthHeaders(),
    );

    if (raw === null) return null; // 404

    const data = unwrapEnvelope(raw, 'scores');

    // Validate with zod at the client boundary (P1-2)
    const parsed = aimsPublicScoresSchema.safeParse(data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new AimsError(400, `AIMS scores payload validation failed: ${issues}`);
    }

    return parsed.data;
  } catch (err) {
    if (err instanceof AimsError) throw err;
    if (err instanceof HttpError) {
      if (err.statusCode === 401) {
        throw new AimsError(401, 'AIMS API key rejected');
      }
      if (err.statusCode === 404) {
        return null;
      }
    }
    throw err;
  }
}

/**
 * Fetch public course list.
 * GET /public/courses?teacherEmail=...&schoolYear=...&includeArchived=true
 * May 404 until AIMS ships the endpoint — returns [] in that case.
 */
export async function getAimsPublicCourses(opts?: AimsCourseListOptions): Promise<AimsCourseSummary[]> {
  if (!isAimsConfigured()) {
    throw new AimsError(503, 'AIMS EXTERNAL_API_KEY not configured');
  }

  try {
    const params = new URLSearchParams();
    if (opts?.teacherEmail) params.set('teacherEmail', opts.teacherEmail);
    if (opts?.teacherUsername) params.set('teacherUsername', opts.teacherUsername);
    if (opts?.schoolYear) params.set('schoolYear', opts.schoolYear);
    if (opts?.includeArchived) params.set('includeArchived', 'true');
    const qs = params.toString();
    const raw = await httpGet(
      aimsUrl(`/public/courses${qs ? `?${qs}` : ''}`),
      aimsAuthHeaders(),
    );

    if (raw === null) return []; // 404

    const data = unwrapEnvelope(raw, 'courses');
    const list = Array.isArray(data) ? data : Array.isArray(data?.courses) ? data.courses : [];

    // Validate each course with zod
    const validCourses: AimsCourseSummary[] = [];
    for (const item of list) {
      const parsed = aimsCourseSummarySchema.safeParse(item);
      if (parsed.success) {
        validCourses.push(parsed.data);
      }
    }
    return validCourses;
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) {
      return [];
    }
    throw err;
  }
}
