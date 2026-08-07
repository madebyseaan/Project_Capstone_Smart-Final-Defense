/**
 * aimsClient.ts
 *
 * Read-only client for the AIMS (Academic Information Management System) API.
 * NEVER writes to AIMS — read-only per system policy.
 *
 * AIMS Base URL: http://100.92.245.14:5000/api/v1
 *
 * Key endpoints used:
 *   POST /auth/login                         → get teacher access token
 *   POST /auth/refresh                       → refresh expired token
 *   GET  /courses                            → teacher's courses (section-subject combos)
 *   GET  /courses/:id/students               → students enrolled in a course
 *   GET  /dashboard/course/:id/gradebook     → full DepEd-format gradebook
 *   GET  /dashboard/teacher                  → teacher overview
 */

import http from 'http';

const AIMS_BASE = process.env.AIMS_BASE_URL ?? 'http://100.92.245.14:5000/api/v1';

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function fetchJSON(url: string, options?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions: any = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : 80,
      path: parsed.pathname + parsed.search,
      method: options?.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    };
    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error(`AIMS timeout: ${url}`));
    });
    if (options?.body) req.write(options.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Authenticate a teacher against AIMS.
 * Returns { accessToken, refreshToken } on success.
 * AIMS and SMART share the same teacher emails (DepEd email addresses).
 * Each teacher must have an AIMS account with the same email.
 */
export async function aimsLogin(email: string, password: string): Promise<AimsLoginResult> {
  const result = await fetchJSON(`${AIMS_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (result?.success && result?.data?.accessToken) {
    return {
      success: true,
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken,
      user: result.data.user,
    };
  }

  return { success: false, error: result?.error ?? result?.data?.message ?? 'AIMS login failed' };
}

/**
 * Refresh an expired AIMS access token using the refresh token.
 */
export async function aimsRefreshToken(refreshToken: string): Promise<{ success: boolean; accessToken?: string; error?: string }> {
  const result = await fetchJSON(`${AIMS_BASE}/auth/refresh`, {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });

  if (result?.success && result?.data?.accessToken) {
    return { success: true, accessToken: result.data.accessToken };
  }
  return { success: false, error: result?.error ?? 'Token refresh failed' };
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

/**
 * Get all courses for the authenticated teacher.
 * Each course corresponds to a section-subject combo the teacher is teaching.
 * Returns courses array with: id, name, subject, gradeLevel, schoolYear, studentCount, code, etc.
 */
export async function getAimsCourses(aimsToken: string): Promise<AimsCourse[]> {
  const result = await fetchJSON(`${AIMS_BASE}/courses`, {
    headers: { Authorization: `Bearer ${aimsToken}` },
  });
  return result?.data?.courses ?? result?.courses ?? [];
}

/**
 * Get a single course by ID.
 */
export async function getAimsCourse(courseId: string, aimsToken: string): Promise<AimsCourse | null> {
  const result = await fetchJSON(`${AIMS_BASE}/courses/${courseId}`, {
    headers: { Authorization: `Bearer ${aimsToken}` },
  });
  return result?.data?.course ?? result?.course ?? null;
}

/**
 * Get all students enrolled in an AIMS course.
 */
export async function getAimsCourseStudents(courseId: string, aimsToken: string): Promise<AimsStudent[]> {
  const result = await fetchJSON(`${AIMS_BASE}/courses/${courseId}/students`, {
    headers: { Authorization: `Bearer ${aimsToken}` },
  });
  return result?.data?.students ?? result?.students ?? [];
}

// ---------------------------------------------------------------------------
// Gradebook (primary integration endpoint)
// ---------------------------------------------------------------------------

/**
 * Get the full DepEd-format gradebook for a course.
 * Returns all students, all assessments (quizzes + tasks), per-category averages,
 * and weighted quarterly grades.
 *
 * Assessment categories:
 *   WW = Written Work (quizzes + WRITTEN_WORK tasks)
 *   PT = Performance Task (PERFORMANCE_TASK tasks)
 * Default weights: WW=30%, PT=70%
 */
export async function getAimsGradebook(courseId: string, aimsToken: string): Promise<AimsGradebook | null> {
  const result = await fetchJSON(`${AIMS_BASE}/dashboard/course/${courseId}/gradebook`, {
    headers: { Authorization: `Bearer ${aimsToken}` },
  });

  if (!result?.success) return null;
  return result.data as AimsGradebook;
}

/**
 * Get the teacher's school-wide overview from AIMS.
 */
export async function getAimsTeacherDashboard(aimsToken: string): Promise<any> {
  const result = await fetchJSON(`${AIMS_BASE}/dashboard/teacher`, {
    headers: { Authorization: `Bearer ${aimsToken}` },
  });
  return result?.data ?? null;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkAimsHealth(): Promise<boolean> {
  try {
    const result = await fetchJSON(`${AIMS_BASE}/health`);
    return result?.data?.status === 'ok' || result?.success === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AimsLoginResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  user?: AimsUser;
  error?: string;
}

export interface AimsUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'TEACHER' | 'STUDENT' | 'ADMIN';
  emailVerified: boolean;
}

export interface AimsCourse {
  id: string;
  name: string;
  description?: string;
  code: string;
  subject: string;
  subjectType: string;
  gradeLevel: string;
  schoolYear: string;
  color?: string;
  archived: boolean;
  teacherId: string;
  studentCount: number;
  activeQuizCount: number;
  createdAt: string;
}

export interface AimsStudent {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface AimsAssessment {
  id: string;           // e.g. "QUIZ:uuid" or "TASK:uuid"
  sourceId: string;
  title: string;
  type: 'QUIZ' | 'TASK';
  category: 'WW' | 'PT';
  maxPoints: number;
}

export interface AimsGradebookRow {
  userId: string;
  name: string;
  email: string;
  googlePicture?: string;
  scores: Array<{ assessmentId: string; score: number | null }>;
  categoryAverages: { ww: number | null; pt: number | null };
  initialGrade: number | null;
  quarterlyGrade: number | null;
  average: number | null;
}

export interface AimsGradebook {
  assessments: AimsAssessment[];
  weights: { ww: number; pt: number };
  rows: AimsGradebookRow[];
}
