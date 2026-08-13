/**
 * enrollproClient.ts
 *
 * Read-only client for the EnrollPro API.
 * NEVER writes to EnrollPro — read-only per system policy.
 *
 * Primary Integration: EnrollPro Partner Integration v1 (/api/integration/v1/...)
 * Public, read-only feeds designed for companion systems (SMART, ATLAS, AIMS).
 *
 * Auth (Staff/Teacher Verification only):
 *   POST /api/auth/login  { accountName, password }  →  { token, user }
 */

import https from 'https';
import http from 'http';

function getEnrollProBase(): string {
  const base = process.env.ENROLLPRO_URL ?? process.env.ENROLLPRO_BASE_URL ?? 'https://dev-jegs.buru-degree.ts.net/api';
  return base.replace(/\/$/, '');
}

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

  const result = await fetchJSON(`${getEnrollProBase()}/auth/login`, {
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
export function invalidateEnrollProToken(token?: string): void {
  _cachedToken = null;
  _tokenFetchedAt = 0;
}

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

/**
 * Returns all teachers from EnrollPro.
 * Attempts internal route with admin token, falling back to Partner Integration v1.
 */
export async function getEnrollProTeachers(): Promise<EnrollProTeacher[]> {
  try {
    const token = await getAdminToken();
    const result = await fetchJSON(`${getEnrollProBase()}/teachers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (result?.teachers ?? []) as EnrollProTeacher[];
  } catch {
    // Fallback to Partner Integration v1 faculty feed
    const v1Faculty = await getAllIntegrationV1Faculty();
    return v1Faculty.map((f) => ({
      id: f.teacherId,
      employeeId: f.employeeId,
      firstName: f.firstName,
      lastName: f.lastName,
      middleName: f.middleName,
      email: f.email,
      contactNumber: f.contactNumber,
      specialization: f.specialization,
      isActive: f.isActive,
      subjects: [],
    }));
  }
}

/**
 * @deprecated Use getEnrollProTeachers() instead.
 * Kept for backward compatibility. Returns teachers mapped to the old EnrollProFaculty shape.
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
 * Returns all sections from EnrollPro.
 */
export async function getEnrollProSections(): Promise<EnrollProSectionWithGradeLevel[]> {
  try {
    const token = await getAdminToken();
    const result = await fetchJSON(`${getEnrollProBase()}/sections`, {
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
  } catch {
    const sections = await getAllIntegrationV1Sections();
    return sections.map((s: any) => ({
      id: s.id,
      name: s.name,
      sortOrder: 0,
      maxCapacity: s.capacity ?? s.maxCapacity ?? 40,
      programType: s.programType ?? 'REGULAR',
      isHomogeneous: false,
      enrolledCount: s.enrolledCount ?? s.learnerCount ?? 0,
      advisingTeacher: s.adviser ?? s.advisingTeacher ?? null,
      gradeLevelId: s.gradeLevel?.id ?? 0,
      gradeLevelName: s.gradeLevel?.name ?? 'Grade',
      displayOrder: 0,
    }));
  }
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/**
 * Returns students for a specific section and school year.
 */
export async function getEnrollProSectionStudents(
  sectionId: number,
  schoolYearId: number
): Promise<EnrollProStudent[]> {
  try {
    const token = await getAdminToken();
    const url = `${getEnrollProBase()}/students?sectionId=${sectionId}&schoolYearId=${schoolYearId}&limit=200`;
    const result = await fetchJSON(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (result?.students ?? []) as EnrollProStudent[];
  } catch {
    const learners = await getAllIntegrationV1SectionLearners(sectionId);
    return learners.map((l: any) => {
      const student = l.learner ?? l;
      return {
        id: student.id ?? 0,
        lrn: student.lrn ?? '',
        fullName: `${student.lastName ?? ''}, ${student.firstName ?? ''}`,
        firstName: student.firstName ?? '',
        lastName: student.lastName ?? '',
        middleName: student.middleName,
        sex: student.sex ?? 'MALE',
        birthDate: student.birthdate,
      };
    });
  }
}

/**
 * Returns enrolled learners for a section using the registrar roster endpoint.
 */
export async function getEnrollProSectionRoster(
  sectionId: number,
): Promise<any[]> {
  try {
    const token = await getAdminToken();
    const result = await fetchJSON(`${getEnrollProBase()}/sections/${sectionId}/roster`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return result?.learners ?? result?.data?.learners ?? [];
  } catch {
    return getAllIntegrationV1SectionLearners(sectionId);
  }
}

/**
 * Returns all students for a school year (paginated).
 */
export async function getEnrollProLearners(
  schoolYearId: number,
  page = 1,
  limit = 200
): Promise<EnrollProStudent[]> {
  const { data } = await getIntegrationV1LearnersPage(schoolYearId, page, limit);
  return data.map((r: any) => {
    const l = r.learner ?? r;
    return {
      id: l.id ?? 0,
      lrn: l.lrn ?? '',
      fullName: `${l.lastName ?? ''}, ${l.firstName ?? ''}`,
      firstName: l.firstName ?? '',
      lastName: l.lastName ?? '',
      middleName: l.middleName,
      sex: l.sex ?? 'MALE',
      birthDate: l.birthdate,
    };
  });
}

// ---------------------------------------------------------------------------
// School Years
// ---------------------------------------------------------------------------

/**
 * Returns available school years from EnrollPro.
 */
export async function getEnrollProSchoolYears(): Promise<EnrollProSchoolYear[]> {
  try {
    const token = await getAdminToken();
    const result = await fetchJSON(`${getEnrollProBase()}/school-years`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rows: any[] = result?.schoolYears ?? result?.years ?? result?.data ?? [];
    if (Array.isArray(rows) && rows.length > 0) {
      return rows
        .map((row) => {
          const id = Number(row?.id ?? row?.schoolYearId ?? row?.value);
          const yearLabel = String(row?.yearLabel ?? row?.label ?? row?.year ?? row?.schoolYear ?? '').trim();
          const statusRaw = String(row?.status ?? row?.schoolYearStatus ?? '').toUpperCase();
          const status: 'ACTIVE' | 'ARCHIVED' = statusRaw === 'ACTIVE' ? 'ACTIVE' : 'ARCHIVED';
          if (!Number.isFinite(id) || !yearLabel) return null;
          return { id, yearLabel, status } as EnrollProSchoolYear;
        })
        .filter((row): row is EnrollProSchoolYear => Boolean(row));
    }
  } catch { /* ignore fallback below */ }

  try {
    const active = await getIntegrationV1ActiveSchoolYear();
    if (active?.id && active?.yearLabel) {
      return [{ id: active.id, yearLabel: active.yearLabel, status: 'ACTIVE' }];
    }
  } catch { /* ignore */ }

  return [];
}

/**
 * Resolve the best school year context to use for EnrollPro sync calls.
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
    id: Number.isFinite(envId) ? envId : 3,
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
 * GET /api/integration/v1/school-year
 */
export async function getIntegrationV1ActiveSchoolYear(): Promise<{ id: number; yearLabel: string }> {
  const result = await fetchJSON(`${getEnrollProBase()}/integration/v1/school-year`);
  return result?.data as { id: number; yearLabel: string };
}

/**
 * Returns a single page of enrolled learners from EnrollPro's integration feed.
 * GET /api/integration/v1/learners?schoolYearId=:id&page=:n&limit=:n
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
    `${getEnrollProBase()}/integration/v1/learners?${query.toString()}`
  );
  return { data: result?.data ?? [], meta: result?.meta ?? { total: 0, page, limit, totalPages: 0 } };
}

/**
 * Fetches ALL enrolled learners across all pages from Integration v1.
 */
export async function getAllIntegrationV1Learners(schoolYearId?: number, updatedSince?: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const limit = 200;

  let targetSY: number | undefined = schoolYearId;
  if (!targetSY) {
    try {
      const active = await getIntegrationV1ActiveSchoolYear();
      targetSY = active?.id;
    } catch { /* ignore */ }
  }

  try {
    while (true) {
      const { data, meta } = await getIntegrationV1LearnersPage(targetSY ?? 3, page, limit, updatedSince);
      all.push(...data);
      if (page >= meta.totalPages || data.length === 0) break;
      page++;
    }
  } catch (err: any) {
    // If scoped schoolYearId query failed (e.g. School year not found), fallback to unscoped learners query
    console.warn(`[EnrollProClient] Scoped learners query for SY=${targetSY} failed (${err.message}). Retrying unscoped...`);
    all.length = 0;
    page = 1;
    while (true) {
      const query = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (updatedSince) query.set('updatedSince', updatedSince);
      const result = await fetchJSON(`${getEnrollProBase()}/integration/v1/learners?${query.toString()}`);
      const data = result?.data ?? [];
      const meta = result?.meta ?? { totalPages: 1 };
      all.push(...data);
      if (page >= meta.totalPages || data.length === 0) break;
      page++;
    }
  }

  return all;
}

/**
 * Returns a single page of sections from EnrollPro's integration feed.
 * GET /api/integration/v1/sections?schoolYearId=:id&page=:n&limit=:n
 */
export async function getIntegrationV1Sections(
  schoolYearId?: number,
  page = 1,
  limit = 200,
): Promise<any[]> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (schoolYearId) query.set('schoolYearId', String(schoolYearId));
  const result = await fetchJSON(`${getEnrollProBase()}/integration/v1/sections?${query.toString()}`);
  return result?.data ?? [];
}

/**
 * Fetches ALL sections across all pages from EnrollPro's integration feed.
 */
export async function getAllIntegrationV1Sections(schoolYearId?: number): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const limit = 200;

  while (true) {
    const data = await getIntegrationV1Sections(schoolYearId, page, limit);
    all.push(...data);
    if (data.length < limit) break;
    page++;
  }

  return all;
}

/**
 * Returns a single page of faculty from EnrollPro's integration feed.
 * GET /api/integration/v1/faculty?schoolYearId=:id&page=:n&limit=:n
 */
export async function getIntegrationV1FacultyPage(
  schoolYearId?: number,
  page = 1,
  limit = 50,
): Promise<{ data: IntegrationV1Faculty[]; meta: any }> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (schoolYearId) query.set('schoolYearId', String(schoolYearId));
  const url = `${getEnrollProBase()}/integration/v1/faculty?${query.toString()}`;
  const result = await fetchJSON(url);
  return {
    data: (result?.data ?? []) as IntegrationV1Faculty[],
    meta: result?.meta ?? { total: (result?.data ?? []).length, page, limit, totalPages: 1 },
  };
}

/**
 * Returns all faculty from EnrollPro's integration feed.
 */
export async function getIntegrationV1Faculty(schoolYearId?: number): Promise<IntegrationV1Faculty[]> {
  const { data } = await getIntegrationV1FacultyPage(schoolYearId, 1, 50);
  return data;
}

/**
 * Fetches ALL faculty members across all pages from Integration v1.
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
  const url = `${getEnrollProBase()}/integration/v1/sections/${sectionId}/learners?${query.toString()}`;
  const result = await fetchJSON(url);
  return {
    section: result?.data?.section ?? null,
    learners: result?.data?.learners ?? [],
    total: result?.meta?.total ?? 0,
  };
}

/**
 * Returns ALL learners in a section across all pages.
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

export interface EnrollProAuthResult {
  token?: string;
  user?: any;
  isReachable: boolean;
  invalidCredentials?: boolean;
}

/**
 * Validate teacher credentials against EnrollPro's auth endpoint.
 * POST /api/auth/login { accountName, password }
 */
export async function validateEnrollProTeacherCredentials(
  accountName: string,
  password: string,
): Promise<EnrollProAuthResult> {
  try {
    const result = await fetchJSON(`${getEnrollProBase()}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ accountName, password }),
    });
    if (result?.token) {
      return { token: result.token, user: result.user, isReachable: true };
    }
    return { isReachable: true, invalidCredentials: true };
  } catch (err: any) {
    if (err.message?.includes('HTTP 401') || err.message?.includes('HTTP 400')) {
      return { isReachable: true, invalidCredentials: true };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Health check & Public settings
// ---------------------------------------------------------------------------

/**
 * Returns true if EnrollPro is reachable.
 */
export async function checkEnrollProHealth(): Promise<boolean> {
  try {
    await fetchJSON(`${getEnrollProBase()}/integration/v1/health`);
    return true;
  } catch {
    try {
      await fetchJSON(`${getEnrollProBase()}/health`);
      return true;
    } catch {
      return false;
    }
  }
}

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
 * GET /api/settings/public
 */
export async function getEnrollProPublicSettings(): Promise<EnrollProPublicSettings> {
  return fetchJSON(`${getEnrollProBase()}/settings/public`) as Promise<EnrollProPublicSettings>;
}

// ---------------------------------------------------------------------------
// Admissions, BOSY, Remedial & EOSY Endpoints
// ---------------------------------------------------------------------------

export async function getEnrollProApplications(params?: {
  status?: string;
  schoolYearId?: number;
  gradeLevel?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<any> {
  try {
    const token = await getAdminToken();
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.schoolYearId) query.set('schoolYearId', String(params.schoolYearId));
    if (params?.gradeLevel) query.set('gradeLevel', params.gradeLevel);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return await fetchJSON(`${getEnrollProBase()}/applications${qs ? '?' + qs : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { applications: [], total: 0 };
  }
}

export async function getEnrollProBosyQueue(params?: {
  schoolYearId?: number;
  gradeLevel?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<any> {
  try {
    const token = await getAdminToken();
    const query = new URLSearchParams();
    if (params?.schoolYearId) query.set('schoolYearId', String(params.schoolYearId));
    if (params?.gradeLevel) query.set('gradeLevel', params.gradeLevel);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return await fetchJSON(`${getEnrollProBase()}/bosy/queue${qs ? '?' + qs : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { data: [], total: 0 };
  }
}

export async function getEnrollProBosyExpectedQueue(params?: {
  priorSchoolYearId?: number;
  currentSchoolYearId?: number;
  gradeLevel?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<any> {
  try {
    const token = await getAdminToken();
    const query = new URLSearchParams();
    if (params?.priorSchoolYearId) query.set('priorSchoolYearId', String(params.priorSchoolYearId));
    if (params?.currentSchoolYearId) query.set('currentSchoolYearId', String(params.currentSchoolYearId));
    if (params?.gradeLevel) query.set('gradeLevel', params.gradeLevel);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return await fetchJSON(`${getEnrollProBase()}/bosy/expected-queue${qs ? '?' + qs : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { data: [], total: 0 };
  }
}

export async function getEnrollProRemedialPending(params?: {
  schoolYearId?: number;
  gradeLevel?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<any> {
  try {
    const token = await getAdminToken();
    const query = new URLSearchParams();
    if (params?.schoolYearId) query.set('schoolYearId', String(params.schoolYearId));
    if (params?.gradeLevel) query.set('gradeLevel', params.gradeLevel);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return await fetchJSON(`${getEnrollProBase()}/remedial/pending${qs ? '?' + qs : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { data: [], total: 0 };
  }
}

export async function getEnrollProEosySections(schoolYearId?: number): Promise<any> {
  try {
    const token = await getAdminToken();
    const qs = schoolYearId ? `?schoolYearId=${schoolYearId}` : '';
    return await fetchJSON(`${getEnrollProBase()}/eosy/sections${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { sections: [] };
  }
}

export async function getEnrollProEosySectionRecords(sectionId: number): Promise<any> {
  try {
    const token = await getAdminToken();
    return await fetchJSON(`${getEnrollProBase()}/eosy/sections/${sectionId}/records`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { records: [] };
  }
}

export async function getEnrollProEosySF5(sectionId: number): Promise<any> {
  try {
    const token = await getAdminToken();
    return await fetchJSON(`${getEnrollProBase()}/eosy/sections/${sectionId}/exports/sf5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
}

export async function getEnrollProEosySF6(schoolYearId: number): Promise<any> {
  try {
    const token = await getAdminToken();
    return await fetchJSON(`${getEnrollProBase()}/eosy/exports/sf6?schoolYearId=${schoolYearId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
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
  gradeLevelName: string;
  displayOrder: number;
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
  yearLabel: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

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

export interface IntegrationV1Faculty {
  teacherId: number;
  employeeId: string;
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
