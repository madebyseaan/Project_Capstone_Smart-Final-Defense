/**
 * enrollproClient.ts
 *
 * Read-only client for the EnrollPro API.
 * NEVER writes to EnrollPro — read-only per system policy.
 *
 * Auth: POST /auth/login  { accountName, password }  →  { token }
 *   ENROLLPRO_ACCOUNT_NAME = admin account ID (e.g. "1000001")
 *   ENROLLPRO_PASSWORD     = admin password
 *
 * Endpoints used:
 *   GET /teachers                                          → all teachers with employee IDs
 *   GET /sections                                          → all sections grouped by gradeLevels
 *   GET /students?schoolYearId=:sy                        → all students for a school year
 *   GET /students?sectionId=:id&schoolYearId=:sy          → students in a specific section
 *   GET /school-years                                      → available school years
 */

import https from 'https';
import http from 'http';

const ENROLLPRO_BASE = process.env.ENROLLPRO_BASE_URL ?? 'https://dev-jegs.buru-degree.ts.net/api';

// Cached admin token (re-fetched when expired)
let _cachedToken: string | null = null;
let _tokenFetchedAt = 0;
const TOKEN_TTL_MS = 25 * 60 * 1000; // 25 minutes

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function fetchJSON(
  url: string,
  options?: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyBuf = options?.body ? Buffer.from(options.body) : undefined;
    const reqOptions: Record<string, any> = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
      path: parsed.pathname + parsed.search,
      method: options?.method ?? 'GET',
      // Allow Tailscale .ts.net certs (managed by Tailscale CA)
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyBuf ? { 'Content-Length': String(bodyBuf.length) } : {}),
        ...(options?.headers ?? {}),
      },
    };
    const req = (lib as any).request(reqOptions, (res: any) => {
      let body = '';
      res.on('data', (c: any) => (body += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });
    req.on('error', (err: Error) => reject(err));
    req.setTimeout(20000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Auth — admin token (cached)
// ---------------------------------------------------------------------------

async function getAdminToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && now - _tokenFetchedAt < TOKEN_TTL_MS) {
    return _cachedToken;
  }

  const accountName = process.env.ENROLLPRO_ACCOUNT_NAME;
  const password = process.env.ENROLLPRO_PASSWORD;
  if (!accountName || !password) {
    throw new Error('ENROLLPRO_ACCOUNT_NAME / ENROLLPRO_PASSWORD not set in .env');
  }

  const result = await fetchJSON(`${ENROLLPRO_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ accountName, password }),
  });

  if (!result?.token) {
    throw new Error(`EnrollPro login failed: ${JSON.stringify(result).slice(0, 200)}`);
  }

  _cachedToken = result.token as string;
  _tokenFetchedAt = now;
  return _cachedToken;
}

/** Force token refresh on next call (call after auth errors) */
export function invalidateEnrollProToken(): void {
  _cachedToken = null;
  _tokenFetchedAt = 0;
}

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

/**
 * Returns all teachers from EnrollPro.
 * Fields include: id, employeeId, firstName, lastName, middleName, email,
 *   contactNumber, designationTitle, specialization, department, isActive, subjects[]
 */
export async function getEnrollProTeachers(): Promise<EnrollProTeacher[]> {
  const token = await getAdminToken();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/teachers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (result?.teachers ?? []) as EnrollProTeacher[];
}

/**
 * @deprecated Use getEnrollProTeachers() instead.
 * Kept for backward compatibility. Returns teachers mapped to the old EnrollProFaculty shape.
 * Note: advisorySectionId is always null — advisory info is now on the section record.
 */
export async function getEnrollProFaculty(): Promise<EnrollProFaculty[]> {
  const teachers = await getEnrollProTeachers();
  return teachers.map((t) => ({
    teacherId: t.id,
    employeeId: t.employeeId,
    email: t.email,
    firstName: t.firstName,
    lastName: t.lastName,
    middleName: t.middleName,
    fullName: `${t.lastName}, ${t.firstName}${t.middleName ? ' ' + t.middleName[0] + '.' : ''}`,
    isActive: t.isActive,
    isClassAdviser: t.designationTitle?.toLowerCase().includes('adviser') ?? false,
    advisorySectionId: null,
    advisorySectionName: null,
    advisorySectionGradeLevelId: null,
    advisorySectionGradeLevelName: null,
    schoolId: 0,
    schoolYearId: 0,
    schoolYearLabel: '',
  }));
}

/**
 * Finds an EnrollPro teacher by their employee ID (e.g. "3179586").
 */
export async function findEnrollProTeacherByEmployeeId(
  employeeId: string
): Promise<EnrollProTeacher | undefined> {
  const all = await getEnrollProTeachers();
  return all.find((t) => t.employeeId === employeeId);
}

/**
 * @deprecated Use findEnrollProTeacherByEmployeeId() instead.
 * Attempts to find a faculty record by email.
 */
export async function findEnrollProFacultyByEmail(
  email: string
): Promise<EnrollProFaculty | undefined> {
  const all = await getEnrollProFaculty();
  return all.find((f) => f.email?.toLowerCase() === email.toLowerCase());
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * Returns all sections from EnrollPro, flattened from the gradeLevels grouping.
 * Each section includes: id, name, sortOrder, maxCapacity, programType,
 *   isHomogeneous, enrolledCount, advisingTeacher {id, name},
 *   gradeLevelId, gradeLevelName (e.g. "Grade 7"), displayOrder (7/8/9/10)
 */
export async function getEnrollProSections(): Promise<EnrollProSectionWithGradeLevel[]> {
  const token = await getAdminToken();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/sections`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const gradeLevels: any[] = result?.gradeLevels ?? [];
  return gradeLevels.flatMap((gl) =>
    (gl.sections ?? []).map((s: any) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
      maxCapacity: s.maxCapacity,
      programType: s.programType,
      isHomogeneous: s.isHomogeneous,
      enrolledCount: s.enrolledCount ?? 0,
      advisingTeacher: s.advisingTeacher ?? null,
      gradeLevelId: gl.gradeLevelId,
      gradeLevelName: gl.gradeLevelName,
      displayOrder: gl.displayOrder,
    }))
  );
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/**
 * Returns students for a specific section and school year.
 * GET /students?sectionId=:id&schoolYearId=:sy&limit=200
 */
export async function getEnrollProSectionStudents(
  sectionId: number,
  schoolYearId: number
): Promise<EnrollProStudent[]> {
  const token = await getAdminToken();
  const url = `${ENROLLPRO_BASE}/students?sectionId=${sectionId}&schoolYearId=${schoolYearId}&limit=200`;
  const result = await fetchJSON(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (result?.students ?? []) as EnrollProStudent[];
}

/**
 * Returns enrolled learners for a section using the registrar roster endpoint.
 * This endpoint is section-bound and does not require an explicit schoolYearId.
 *
 * GET /sections/:id/roster
 */
export async function getEnrollProSectionRoster(
  sectionId: number,
): Promise<any[]> {
  const token = await getAdminToken();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/sections/${sectionId}/roster`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result?.learners ?? result?.data?.learners ?? [];
}

/**
 * Returns all students for a school year (paginated).
 * GET /students?schoolYearId=:sy&limit=200&page=:n
 */
export async function getEnrollProLearners(
  schoolYearId: number,
  page = 1,
  limit = 200
): Promise<EnrollProStudent[]> {
  const token = await getAdminToken();
  const url = `${ENROLLPRO_BASE}/students?schoolYearId=${schoolYearId}&page=${page}&limit=${limit}`;
  const result = await fetchJSON(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (result?.students ?? []) as EnrollProStudent[];
}

// ---------------------------------------------------------------------------
// School Years
// ---------------------------------------------------------------------------

/**
 * Returns available school years from EnrollPro.
 * Fields: id, yearLabel (e.g. "2025-2026"), status ("ACTIVE" | "ARCHIVED")
 */
export async function getEnrollProSchoolYears(): Promise<EnrollProSchoolYear[]> {
  const token = await getAdminToken();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/school-years`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rows: any[] = result?.schoolYears ?? result?.years ?? result?.data ?? [];
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      const id = Number(row?.id ?? row?.schoolYearId ?? row?.value);
      const yearLabel = String(
        row?.yearLabel ?? row?.label ?? row?.year ?? row?.schoolYear ?? ''
      ).trim();
      const statusRaw = String(row?.status ?? row?.schoolYearStatus ?? '').toUpperCase();
      const status: 'ACTIVE' | 'ARCHIVED' = statusRaw === 'ACTIVE' ? 'ACTIVE' : 'ARCHIVED';
      if (!Number.isFinite(id) || !yearLabel) return null;
      return { id, yearLabel, status } as EnrollProSchoolYear;
    })
    .filter((row): row is EnrollProSchoolYear => Boolean(row));
}

/**
 * Resolve the best school year context to use for EnrollPro sync calls.
 * Priority:
 *   1) integration/v1 active school year
 *   2) /school-years matched by preferred label, then ACTIVE, then latest
 *   3) env fallback
 */
export async function resolveEnrollProSchoolYear(
  preferredLabel?: string,
): Promise<{ id: number; yearLabel: string; source: 'integration-active' | 'school-years' | 'env-fallback' }> {
  const envId = parseInt(process.env.ENROLLPRO_SCHOOL_YEAR_ID ?? '38', 10);
  const envLabel = process.env.ENROLLPRO_SCHOOL_YEAR_LABEL ?? '2026-2027';

  try {
    const active = await getIntegrationV1ActiveSchoolYear();
    if (active?.id && active?.yearLabel) {
      return { id: active.id, yearLabel: active.yearLabel, source: 'integration-active' };
    }
  } catch {
    // Try next fallback.
  }

  try {
    const schoolYears = await getEnrollProSchoolYears();
    if (schoolYears.length > 0) {
      const wanted = (preferredLabel ?? '').trim();
      const byLabel = wanted
        ? schoolYears.find((sy) => String(sy.yearLabel).trim() === wanted)
        : undefined;
      const active = schoolYears.find((sy) => sy.status === 'ACTIVE');
      const latest = [...schoolYears].sort((a, b) => b.id - a.id)[0];
      const picked = byLabel ?? active ?? latest;
      if (picked) {
        return { id: picked.id, yearLabel: picked.yearLabel, source: 'school-years' };
      }
    }
  } catch {
    // Fall through to env defaults.
  }

  return {
    id: Number.isFinite(envId) ? envId : 38,
    yearLabel: envLabel,
    source: 'env-fallback',
  };
}

// ---------------------------------------------------------------------------
// Integration v1 — Public read-only endpoints (NO AUTH REQUIRED)
// These are designed for companion systems (ATLAS, SMART, AIMS)
// ---------------------------------------------------------------------------

/**
 * Returns the active school year from EnrollPro's integration feed.
 * No auth required.
 * GET /api/integration/v1/school-year
 */
export async function getIntegrationV1ActiveSchoolYear(): Promise<{ id: number; yearLabel: string }> {
  const result = await fetchJSON(`${ENROLLPRO_BASE}/integration/v1/school-year`);
  return result?.data as { id: number; yearLabel: string };
}

/**
 * Returns a single page of enrolled learners from EnrollPro's integration feed.
 * No auth required.
 * GET /api/integration/v1/learners?schoolYearId=:id&page=:n&limit=:n
 * Each record: { enrollmentApplicationId, status, learner: { lrn, firstName, lastName, middleName, birthdate, sex },
 *               gradeLevel: { id, name }, section: { id, name } }
 */
export async function getIntegrationV1LearnersPage(
  schoolYearId: number,
  page = 1,
  limit = 200,
  updatedSince?: string,
): Promise<{ data: any[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
  const query = new URLSearchParams({
    schoolYearId: String(schoolYearId),
    page: String(page),
    limit: String(limit),
  });
  if (updatedSince) query.set('updatedSince', updatedSince);

  const result = await fetchJSON(
    `${ENROLLPRO_BASE}/integration/v1/learners?${query.toString()}`
  );
  return { data: result?.data ?? [], meta: result?.meta ?? { total: 0, page, limit, totalPages: 0 } };
}

/**
 * Fetches ALL enrolled learners across all pages from Integration v1.
 * No auth required. Automatically paginates until all records are retrieved.
 */
export async function getAllIntegrationV1Learners(schoolYearId: number, updatedSince?: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const limit = 200;

  while (true) {
    const { data, meta } = await getIntegrationV1LearnersPage(schoolYearId, page, limit, updatedSince);
    all.push(...data);
    if (page >= meta.totalPages || data.length === 0) break;
    page++;
  }

  return all;
}

/**
 * Returns a single page of sections from EnrollPro's integration feed.
 * No auth required.
 * GET /api/integration/v1/sections?schoolYearId=:id&page=:n&limit=:n
 */
export async function getIntegrationV1Sections(
  schoolYearId?: number,
  page = 1,
  limit = 200,
): Promise<any[]> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (schoolYearId) query.set('schoolYearId', String(schoolYearId));
  const result = await fetchJSON(`${ENROLLPRO_BASE}/integration/v1/sections?${query.toString()}`);
  return result?.data ?? [];
}

/**
 * Fetches ALL sections across all pages from EnrollPro's integration feed.
 * No auth required. Automatically paginates.
 * Use this instead of getIntegrationV1Sections() when you need the full list
 * (e.g., if there are 66 sections but the server default limit is 50).
 */
export async function getAllIntegrationV1Sections(schoolYearId?: number): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const limit = 200;

  while (true) {
    const data = await getIntegrationV1Sections(schoolYearId, page, limit);
    all.push(...data);
    // If fewer results than the limit, we've hit the last page
    if (data.length < limit) break;
    page++;
  }

  return all;
}

/**
 * Returns a single page of faculty from EnrollPro's integration feed, including advisory info.
 * No auth required.
 * GET /api/integration/v1/faculty?schoolYearId=:id&page=:n&limit=:n
 */
export async function getIntegrationV1FacultyPage(
  schoolYearId?: number,
  page = 1,
  limit = 50,
): Promise<{ data: IntegrationV1Faculty[]; meta: any }> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (schoolYearId) query.set('schoolYearId', String(schoolYearId));
  const url = `${ENROLLPRO_BASE}/integration/v1/faculty?${query.toString()}`;
  const result = await fetchJSON(url);
  return {
    data: (result?.data ?? []) as IntegrationV1Faculty[],
    meta: result?.meta ?? { total: (result?.data ?? []).length, page, limit, totalPages: 1 },
  };
}

/**
 * Returns all faculty from EnrollPro's integration feed (first page only).
 * @deprecated Use getAllIntegrationV1Faculty() for full list or getIntegrationV1FacultyPage() for pagination.
 */
export async function getIntegrationV1Faculty(schoolYearId?: number): Promise<IntegrationV1Faculty[]> {
  const { data } = await getIntegrationV1FacultyPage(schoolYearId, 1, 50);
  return data;
}

/**
 * Fetches ALL faculty members across all pages from Integration v1.
 * No auth required. Automatically paginates.
 */
export async function getAllIntegrationV1Faculty(schoolYearId?: number): Promise<IntegrationV1Faculty[]> {
  const all: IntegrationV1Faculty[] = [];
  let page = 1;
  const limit = 200;

  while (true) {
    const { data, meta } = await getIntegrationV1FacultyPage(schoolYearId, page, limit);
    all.push(...data);
    if (page >= meta.totalPages || data.length === 0) break;
    page++;
  }

  return all;
}

/**
 * Find one faculty member by employeeId from integration v1.
 * No auth required.
 */
export async function findIntegrationV1FacultyByEmployeeId(
  employeeId: string,
  schoolYearId?: number,
): Promise<IntegrationV1Faculty | undefined> {
  const all = await getAllIntegrationV1Faculty(schoolYearId);
  const wanted = String(employeeId ?? '').trim();
  return all.find((f) => String(f.employeeId ?? '').trim() === wanted);
}

/**
 * Returns paginated learner roster for a specific section.
 * No auth required.
 * GET /api/integration/v1/sections/:sectionId/learners?page=:n&limit=:n
 */
export async function getIntegrationV1SectionLearners(
  sectionId: number,
  page = 1,
  limit = 50,
  updatedSince?: string,
): Promise<{ section: any; learners: any[]; total: number }> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (updatedSince) query.set('updatedSince', updatedSince);
  const url = `${ENROLLPRO_BASE}/integration/v1/sections/${sectionId}/learners?${query.toString()}`;
  const result = await fetchJSON(url);
  return {
    section: result?.data?.section ?? null,
    learners: result?.data?.learners ?? [],
    total: result?.meta?.total ?? 0,
  };
}

/**
 * Returns ALL learners in a section across all pages.
 * No auth required.
 */
export async function getAllIntegrationV1SectionLearners(sectionId: number, updatedSince?: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const limit = 50;
  while (true) {
    const { learners, total } = await getIntegrationV1SectionLearners(sectionId, page, limit, updatedSince);
    all.push(...learners);
    if (all.length >= total || learners.length === 0) break;
    page++;
  }
  return all;
}

/**
 * Validate teacher credentials against EnrollPro's auth endpoint.
 * Returns the EnrollPro user object if valid, null if invalid credentials, throws if unreachable.
 * accountName is the employeeId (e.g. "3179586").
 */
export async function validateEnrollProTeacherCredentials(
  accountName: string,
  password: string,
): Promise<{ token: string; user: any } | null> {
  try {
    const result = await fetchJSON(`${ENROLLPRO_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ accountName, password }),
    });
    if (result?.token) return { token: result.token, user: result.user };
    return null;
  } catch (err: any) {
    // Re-throw network errors so caller can distinguish "wrong password" vs "unreachable"
    if (err.message?.includes('HTTP 401') || err.message?.includes('HTTP 400')) {
      return null; // Wrong credentials
    }
    throw err; // Network error, timeout, etc.
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Returns true if EnrollPro is reachable and credentials are valid.
 */
export async function checkEnrollProHealth(): Promise<boolean> {
  try {
    await getAdminToken();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnrollProTeacher {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  email: string;
  contactNumber?: string;
  designationTitle?: string;
  specialization?: string;
  department?: string;
  plantillaPosition?: string;
  sex?: string;
  isActive: boolean;
  subjects: any[];
}

export interface EnrollProSectionWithGradeLevel {
  id: number;
  name: string;
  sortOrder: number;
  maxCapacity: number;
  programType: string;
  isHomogeneous: boolean;
  enrolledCount: number;
  advisingTeacher: { id: number; name: string } | null;
  gradeLevelId: number;
  gradeLevelName: string; // e.g. "Grade 7", "Grade 8", "Grade 9", "Grade 10"
  displayOrder: number;   // 7, 8, 9, 10
}

export interface EnrollProStudent {
  id: number;
  lrn: string;
  fullName: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  sex: 'MALE' | 'FEMALE';
  birthDate?: string;
  address?: string;
  parentGuardianName?: string;
  parentGuardianContact?: string;
  learningProgram?: string;
  dateEnrolled?: string;
}

export interface EnrollProSchoolYear {
  id: number;
  yearLabel: string;  // e.g. "2025-2026"
  status: 'ACTIVE' | 'ARCHIVED';
}

/** @deprecated Use EnrollProTeacher instead */
export interface EnrollProFaculty {
  teacherId: number;
  employeeId: string;
  email: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  fullName: string;
  isActive: boolean;
  isClassAdviser: boolean;
  advisorySectionId: number | null;
  advisorySectionName: string | null;
  advisorySectionGradeLevelId: number | null;
  advisorySectionGradeLevelName: string | null;
  schoolId: number;
  schoolYearId: number;
  schoolYearLabel: string;
}

/** @deprecated Use EnrollProSectionWithGradeLevel instead */
export interface EnrollProSection {
  id: number;
  name: string;
  programType: string;
  maxCapacity: number;
  enrolledCount: number;
  gradeLevel: { id: number; name: string; displayOrder: number };
  advisingTeacher: { id: number; firstName: string; lastName: string; middleName?: string } | null;
  schoolYear: { id: number; yearLabel: string };
}

/** @deprecated Use EnrollProStudent instead */
export interface EnrollProLearner {
  id: number;
  lrn: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  sex: 'MALE' | 'FEMALE';
  status: string;
  enrolledAt: string;
  enrollmentApplicationId?: number;
}

// ---------------------------------------------------------------------------
// Public Settings (no auth required)
// ---------------------------------------------------------------------------

export interface EnrollProPaletteColor {
  hex: string;
  hsl: string;
  foreground: string;
}

export interface EnrollProPublicSettings {
  schoolName: string;
  logoUrl: string | null;
  colorScheme: {
    palette: EnrollProPaletteColor[];
    extracted_at?: string;
  } | null;
  selectedAccentHsl: string | null;
  activeSchoolYearId: number | null;
  activeSchoolYearLabel: string | null;
  activeSchoolYearStatus: string | null;
  depedEmail: string | null;
  facebookPageUrl: string | null;
  schoolWebsite: string | null;
  enrollmentPhase: string | null;
  systemStatus: string | null;
}

/**
 * Fetches public branding and school info from EnrollPro.
 * No authentication required — this is publicly accessible.
 */
export async function getEnrollProPublicSettings(): Promise<EnrollProPublicSettings> {
  return fetchJSON(`${ENROLLPRO_BASE}/settings/public`) as Promise<EnrollProPublicSettings>;
}

// ---------------------------------------------------------------------------
// Integration v1 Faculty type
// ---------------------------------------------------------------------------

export interface IntegrationV1Faculty {
  teacherId: number;              // EnrollPro internal teacher ID
  employeeId: string;             // DepEd employee ID (e.g. "3179586") — matches SMART Teacher.employeeId
  firstName: string;
  lastName: string;
  middleName?: string;
  fullName: string;
  email: string;
  contactNumber?: string;
  specialization?: string;
  isActive: boolean;
  sectionCount: number;
  isClassAdviser: boolean;
  advisorySectionId: number | null;
  advisorySectionName: string | null;
  advisorySectionGradeLevelId: number | null;
  advisorySectionGradeLevelName: string | null;
  schoolYearId: number;
  schoolYearLabel: string;
}

// ---------------------------------------------------------------------------
// Admissions — Applications (Phase 9, requires auth)
// ---------------------------------------------------------------------------

/**
 * Returns enrollment applications from EnrollPro.
 * GET /api/applications
 */
export async function getEnrollProApplications(params?: {
  status?: string;
  schoolYearId?: number;
  gradeLevel?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<any> {
  const token = await getAdminToken();
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.schoolYearId) query.set('schoolYearId', String(params.schoolYearId));
  if (params?.gradeLevel) query.set('gradeLevel', params.gradeLevel);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('search', params.search);
  const qs = query.toString();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/applications${qs ? '?' + qs : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result;
}

// ---------------------------------------------------------------------------
// BOSY — Beginning of School Year (requires auth)
// ---------------------------------------------------------------------------

/**
 * Returns learners in the PENDING_CONFIRMATION BOSY queue.
 * GET /api/bosy/queue
 */
export async function getEnrollProBosyQueue(params?: {
  schoolYearId?: number;
  gradeLevel?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<any> {
  const token = await getAdminToken();
  const query = new URLSearchParams();
  if (params?.schoolYearId) query.set('schoolYearId', String(params.schoolYearId));
  if (params?.gradeLevel) query.set('gradeLevel', params.gradeLevel);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('search', params.search);
  const qs = query.toString();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/bosy/queue${qs ? '?' + qs : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result;
}

/**
 * Returns prior-year PROMOTED learners not yet in current SY pipeline.
 * GET /api/bosy/expected-queue
 */
export async function getEnrollProBosyExpectedQueue(params?: {
  priorSchoolYearId?: number;
  currentSchoolYearId?: number;
  gradeLevel?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<any> {
  const token = await getAdminToken();
  const query = new URLSearchParams();
  if (params?.priorSchoolYearId) query.set('priorSchoolYearId', String(params.priorSchoolYearId));
  if (params?.currentSchoolYearId) query.set('currentSchoolYearId', String(params.currentSchoolYearId));
  if (params?.gradeLevel) query.set('gradeLevel', params.gradeLevel);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('search', params.search);
  const qs = query.toString();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/bosy/expected-queue${qs ? '?' + qs : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result;
}

// ---------------------------------------------------------------------------
// Remedial Processing (requires auth)
// ---------------------------------------------------------------------------

/**
 * Returns learners with pending remedial status.
 * GET /api/remedial/pending
 */
export async function getEnrollProRemedialPending(params?: {
  schoolYearId?: number;
  gradeLevel?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<any> {
  const token = await getAdminToken();
  const query = new URLSearchParams();
  if (params?.schoolYearId) query.set('schoolYearId', String(params.schoolYearId));
  if (params?.gradeLevel) query.set('gradeLevel', params.gradeLevel);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('search', params.search);
  const qs = query.toString();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/remedial/pending${qs ? '?' + qs : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result;
}

// ---------------------------------------------------------------------------
// EOSY — End of School Year (requires auth)
// ---------------------------------------------------------------------------

/**
 * Returns sections available for EOSY processing.
 * GET /api/eosy/sections
 */
export async function getEnrollProEosySections(schoolYearId?: number): Promise<any> {
  const token = await getAdminToken();
  const qs = schoolYearId ? `?schoolYearId=${schoolYearId}` : '';
  const result = await fetchJSON(`${ENROLLPRO_BASE}/eosy/sections${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result;
}

/**
 * Returns final grades and promotion status for a section.
 * GET /api/eosy/sections/:id/records
 */
export async function getEnrollProEosySectionRecords(sectionId: number): Promise<any> {
  const token = await getAdminToken();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/eosy/sections/${sectionId}/records`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result;
}

/**
 * Returns SF5 data for a section (section-scoped promotion report).
 * GET /api/eosy/sections/:id/exports/sf5
 */
export async function getEnrollProEosySF5(sectionId: number): Promise<any> {
  const token = await getAdminToken();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/eosy/sections/${sectionId}/exports/sf5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result;
}

/**
 * Returns SF6 data (school-wide enrollment summary by grade level).
 * GET /api/eosy/exports/sf6
 */
export async function getEnrollProEosySF6(schoolYearId: number): Promise<any> {
  const token = await getAdminToken();
  const result = await fetchJSON(`${ENROLLPRO_BASE}/eosy/exports/sf6?schoolYearId=${schoolYearId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result;
}
