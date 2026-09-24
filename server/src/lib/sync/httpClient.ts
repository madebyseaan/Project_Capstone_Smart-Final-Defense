/**
 * sync/httpClient.ts
 *
 * Shared HTTP client for all external API calls (Atlas, EnrollPro).
 * Replaces the duplicated HTTP helpers in atlasSync.ts, teacherSync.ts, and syncService.ts.
 *
 * Features:
 *  - Configurable timeouts (default 20s)
 *  - Automatic JSON parsing
 *  - Bearer token auth support
 *  - Tailscale .ts.net cert handling (rejectUnauthorized: false)
 */

import http from 'http';
import https from 'https';
import { getAtlasSchoolId, getAtlasSchoolYearId } from '../../config/schoolEnv';
import { logger } from '../logger';
import { reportExternalSuccess, reportExternalFailure, isExternalDown } from '../externalState';
import {
  atlasEffectiveTeachingLoadSchema,
  validateAtlasScope,
  type AtlasEffectivePayload,
  type AtlasScopeConstraints,
} from '../../schemas/atlas';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

// Request-path ATLAS calls must fail fast; background sync keeps the defaults.
export const ATLAS_REQUEST_TIMEOUT_MS = parseInt(process.env.ATLAS_REQUEST_TIMEOUT_MS ?? '5000', 10);
export const ATLAS_REQUEST_RETRIES = parseInt(process.env.ATLAS_REQUEST_RETRIES ?? '0', 10);

// Request-path ATLAS year discovery is probe-capped; background sync stays exhaustive.
export const ATLAS_YEAR_PROBE_CAP_REQUEST_PATH = parseInt(process.env.ATLAS_YEAR_PROBE_CAP ?? '3', 10);

// ---------------------------------------------------------------------------
// Custom error class for typed HTTP failures
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }

  get isAuth(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

// ---------------------------------------------------------------------------
// Core HTTP helpers
// ---------------------------------------------------------------------------

function request(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
    retries?: number;
  } = {},
): Promise<any> {
  const maxRetries = options.retries ?? MAX_RETRIES;

  return new Promise((resolve, reject) => {
    const attempt = (retryCount: number) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const bodyStr = options.body != null ? JSON.stringify(options.body) : undefined;
      const bodyBuf = bodyStr != null ? Buffer.from(bodyStr) : undefined;

      const reqOptions: Record<string, any> = {
        hostname: parsed.hostname,
        port: parsed.port
          ? Number(parsed.port)
          : parsed.protocol === 'https:'
            ? 443
            : 80,
        path: parsed.pathname + parsed.search,
        method: options.method ?? 'GET',
        rejectUnauthorized: false, // Allow Tailscale .ts.net certs
        headers: {
          ...(bodyBuf ? { 'Content-Length': String(bodyBuf.length) } : {}),
          ...(options.headers ?? {}),
        },
      };

      const req = (lib as any).request(reqOptions, (res: any) => {
        let body = '';
        res.on('data', (chunk: any) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 404) {
            resolve(null);
            return;
          }
          if (res.statusCode && res.statusCode >= 500 && retryCount < maxRetries) {
            // Retry on 5xx errors (server errors like 502 Bad Gateway)
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
            setTimeout(() => attempt(retryCount + 1), delay);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new HttpError(res.statusCode, `HTTP ${res.statusCode} ${url}: ${body.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body || null);
          }
        });
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        // Retry on network errors (ECONNREFUSED, ECONNRESET, ETIMEDOUT)
        const retryable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code ?? '');
        if (retryable && retryCount < maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
          setTimeout(() => attempt(retryCount + 1), delay);
          return;
        }
        reject(err);
      });

      req.setTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
        req.destroy(new Error(`Timeout: ${url}`));
      });

      if (bodyBuf) req.write(bodyBuf);
      req.end();
    };

    attempt(0);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generic GET request. Returns parsed JSON or null on 404.
 */
export async function httpGet(
  url: string,
  headers?: Record<string, string>,
  timeoutMs?: number,
  retries?: number,
): Promise<any> {
  return request(url, { method: 'GET', headers, timeoutMs, retries });
}

/**
 * Generic POST request. Returns parsed JSON.
 */
export async function httpPost(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
  timeoutMs?: number,
): Promise<any> {
  return request(url, { method: 'POST', body, headers, timeoutMs });
}

// ---------------------------------------------------------------------------
// Atlas-specific helpers
// ---------------------------------------------------------------------------

const ATLAS_BASE = (process.env.ATLAS_URL ?? process.env.ATLAS_BASE_URL ?? 'https://njgrm.buru-degree.ts.net/api/v1').replace(/\/$/, '');
const ATLAS_SCHOOL_ID = getAtlasSchoolId();

function atlasAuthHeader(): Record<string, string> {
  const token = process.env.ATLAS_SYSTEM_TOKEN;
  if (!token) throw new Error('ATLAS_SYSTEM_TOKEN not set in environment');
  return { Authorization: `Bearer ${token}` };
}

function atlasUrl(path: string): string {
  return `${ATLAS_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * GET request to Atlas API with auth.
 * `retries`/`timeoutMs` are exposed for discovery probes that must fail fast.
 * Connectivity outcomes are reported to externalState (transition-only logging).
 */
export async function atlasGet(path: string, retries?: number, timeoutMs?: number): Promise<any> {
  const headers = atlasAuthHeader();
  try {
    const result = await httpGet(atlasUrl(path), headers, timeoutMs, retries);
    reportExternalSuccess('atlas');
    return result;
  } catch (err) {
    // HTTP errors mean Atlas is reachable; only network failures count as down.
    if (!(err instanceof HttpError)) reportExternalFailure('atlas', err);
    throw err;
  }
}

/**
 * POST request to Atlas API with auth.
 */
export async function atlasPost(path: string, body: unknown): Promise<any> {
  return httpPost(atlasUrl(path), body, atlasAuthHeader());
}

// ---------------------------------------------------------------------------
// Atlas school year resolution
// ---------------------------------------------------------------------------

const DEFAULT_ATLAS_SCHOOL_YEAR_ID = getAtlasSchoolYearId();
const ATLAS_SY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ATLAS_SY_FALLBACK_CACHE_TTL_MS = 60 * 1000; // retry discovery sooner
const ATLAS_YEAR_PROBE_LIMIT = 25;
const ATLAS_YEAR_PROBE_TIMEOUT_MS = 8_000;

export type AtlasYearSource = 'runtime-context' | 'discovered' | 'env-fallback';

export interface AtlasYearResolution {
  id: number;
  source: AtlasYearSource;
  error?: string;
}

let cachedAtlasSY: AtlasYearResolution | null = null;
let cachedAtlasSYAt: number = 0;
let lastKnownActiveAtlasYearId: number | null = null;
let lastYearResolution: (AtlasYearResolution & { resolvedAt: string }) | null = null;

/**
 * Resolution state for observability — exposed via sync status and system health.
 */
export function getAtlasYearResolutionState(): (AtlasYearResolution & { resolvedAt: string }) | null {
  return lastYearResolution;
}

/**
 * Drop the cached year so the next resolve re-verifies / re-discovers.
 * Called when a fetch reports the resolved year is no longer the active one.
 */
export function invalidateAtlasSchoolYearCache(): void {
  cachedAtlasSY = null;
  cachedAtlasSYAt = 0;
}

/**
 * Ordered candidate list for active-year discovery.
 *
 * Priority: last known active year → forward (rollover direction) → env year →
 * backward down to year 1. Every candidate is validated with
 * `validateAtlasScope`, which rejects any year where `isActiveSchoolYear=false`,
 * so probing older ids can never surface stale-year data.
 *
 * Forward scan handles the normal case (ATLAS advances one year). Backward scan
 * handles a renumbered/reset ATLAS year space or a future-pinned env value,
 * where the active year would otherwise sit below the scan start.
 */
export function buildAtlasYearProbeCandidates(
  envYearId: number,
  seedYearId: number | null,
  limit = ATLAS_YEAR_PROBE_LIMIT,
): number[] {
  const env = Number.isFinite(envYearId) && envYearId > 0 ? Math.trunc(envYearId) : 1;
  const seed = Number.isFinite(seedYearId) && (seedYearId as number) > 0
    ? Math.trunc(seedYearId as number)
    : null;

  const ordered: number[] = [];
  const seen = new Set<number>();
  const push = (id: number) => {
    if (id > 0 && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  };

  if (seed !== null) {
    push(seed);
    for (let id = Math.max(seed, env) + 1; id <= Math.max(seed, env) + limit; id += 1) push(id);
    push(env);
    for (let id = Math.max(seed, env) - 1; id >= 1; id -= 1) push(id);
  } else {
    push(env);
    for (let id = env + 1; id <= env + limit; id += 1) push(id);
    for (let id = env - 1; id >= 1; id -= 1) push(id);
  }

  return ordered;
}

function cacheAtlasYearResolution(resolution: AtlasYearResolution): AtlasYearResolution {
  cachedAtlasSY = resolution;
  cachedAtlasSYAt = Date.now();
  lastYearResolution = { ...resolution, resolvedAt: new Date().toISOString() };
  return resolution;
}

/**
 * Dynamically resolve the active Atlas school year ID.
 *
 * Resolution order:
 *   1. In-memory cache (5 min TTL; 60 s when the result is an env fallback)
 *   2. GET /runtime/context?schoolId=X&verifyUpstream=true → activeSchoolYearId
 *   3. Verified discovery: probe /faculty-assignments/effective using the
 *      ordered candidate list (last known → forward → env → backward) and
 *      accept ONLY a payload whose scope validation confirms
 *      `isActiveSchoolYear=true`. Inactive and missing years are skipped, so
 *      this can never surface stale-year data.
 *   4. Fall back to env ATLAS_SCHOOL_YEAR_ID (unverified, logged loudly).
 *
 * Step 3 exists because ATLAS `/runtime/context` requires an actor-school-bound
 * token; when that 403s the env fallback silently pinned a dead year and every
 * teacher lost their class list (2026-09-17 incident). Discovery makes annual
 * rollovers self-healing: forward covers normal rollover, backward covers a
 * renumbered/reset year space, and `seedYearId` lets restart recovery start
 * from the last year SMART actually applied.
 */
export async function resolveAtlasSchoolYear(
  seedYearId?: number | null,
  opts?: { retries?: number; timeoutMs?: number },
): Promise<AtlasYearResolution> {
  const now = Date.now();
  if (cachedAtlasSY) {
    const ttl = cachedAtlasSY.source === 'env-fallback'
      ? ATLAS_SY_FALLBACK_CACHE_TTL_MS
      : ATLAS_SY_CACHE_TTL_MS;
    if ((now - cachedAtlasSYAt) < ttl) {
      return cachedAtlasSY;
    }
  }

  // 1. Runtime context (contract-compliant resolution)
  let runtimeError: string | undefined;
  try {
    const ctx = await atlasGet(
      `/runtime/context?schoolId=${ATLAS_SCHOOL_ID}&verifyUpstream=true`,
      opts?.retries,
      opts?.timeoutMs,
    );
    const activeYearId = ctx?.activeSchoolYearId;
    if (Number.isFinite(activeYearId) && activeYearId > 0) {
      return cacheAtlasYearResolution({ id: activeYearId, source: 'runtime-context' });
    }
    runtimeError = 'runtime context returned no activeSchoolYearId';
  } catch (err: unknown) {
    const status = err instanceof HttpError ? `HTTP ${err.statusCode}` : 'request failed';
    const detail = err instanceof Error ? err.message.slice(0, 160) : 'unknown error';
    runtimeError = `${status}: ${detail}`;
  }

  logger.warn(
    `[AtlasYear] runtime/context unavailable (${runtimeError}). Probing ATLAS for the active school year — forward-only, inactive years rejected.`,
  );

  // 2. Verified discovery — only `isActiveSchoolYear=true` is accepted.
  //    Seed priority: in-process last known → caller seed (e.g. persisted
  //    SystemSettings.atlasAppliedScope) → env fallback.
  const envYearId = DEFAULT_ATLAS_SCHOOL_YEAR_ID;
  const seed = lastKnownActiveAtlasYearId
    ?? (Number.isFinite(seedYearId) && (seedYearId as number) > 0
      ? Math.trunc(seedYearId as number)
      : null);

  // P3-2: the request path must never walk the whole candidate list.
  const isRequestPath = Boolean(opts);
  if (isRequestPath && isExternalDown('atlas')) {
    const fallbackId = lastKnownActiveAtlasYearId ?? envYearId;
    logger.warn(
      `[AtlasYear] ATLAS marked down — skipping active-year discovery; using year ${fallbackId} (unverified; will re-resolve after recovery).`,
    );
    return cacheAtlasYearResolution({
      id: fallbackId,
      source: 'env-fallback',
      error: 'ATLAS marked down — discovery skipped on request path',
    });
  }
  const maxProbes = isRequestPath ? ATLAS_YEAR_PROBE_CAP_REQUEST_PATH : Number.POSITIVE_INFINITY;
  let probes = 0;
  for (const candidateId of buildAtlasYearProbeCandidates(envYearId, seed)) {
    if (probes >= maxProbes) {
      runtimeError = `probe cap (${maxProbes}) reached on request path`;
      break;
    }
    probes++;
    const probe = await fetchEffectiveTeachingLoad(candidateId, {
      retries: 0,
      timeoutMs: ATLAS_YEAR_PROBE_TIMEOUT_MS,
    });

    if (probe.status === 'ok') {
      lastKnownActiveAtlasYearId = candidateId;
      logger.warn(
        `[AtlasYear] Resolved active ATLAS school year ${candidateId} by probing (env ATLAS_SCHOOL_YEAR_ID=${envYearId}).`,
      );
      return cacheAtlasYearResolution({ id: candidateId, source: 'discovered' });
    }
    if (probe.status === 'auth') {
      runtimeError = 'ATLAS rejected the system token during active-year discovery';
      break;
    }
    if (probe.status === 'unreachable') {
      runtimeError = 'ATLAS unreachable during active-year discovery';
      break; // network problem — probing further ids is pointless
    }
    // 'missing' (404), 'inactive', 'rejected' → try the next year id
  }

  // 3. Env fallback (unverified) — loud, never silent.
  logger.error(
    `[AtlasYear] Active ATLAS school year could not be verified (${runtimeError ?? 'no active year found'}). ` +
    `Falling back to env ATLAS_SCHOOL_YEAR_ID=${envYearId}; teaching load may be stale or unavailable.`,
  );
  return cacheAtlasYearResolution({
    id: envYearId,
    source: 'env-fallback',
    ...(runtimeError ? { error: runtimeError } : {}),
  });
}

export interface AtlasRuntimeContext {
  activeSchoolYearId: number;
  source: string;
  upstreamVerified: boolean;
  activeTerm: {
    source: string;
    reachable: boolean;
    verified: boolean;
    activeTerm: string;
    termIndex: number;
    schoolYearId: number;
    matchedSchoolYear: boolean;
  } | null;
}

export async function getAtlasRuntimeContext(): Promise<AtlasRuntimeContext | null> {
  try {
    const data = await atlasGet(`/runtime/context?schoolId=${ATLAS_SCHOOL_ID}&verifyUpstream=true`);
    if (data?.activeSchoolYearId != null) return data;
  } catch { /* ATLAS unreachable or no runtime context */ }
  return null;
}

// ---------------------------------------------------------------------------
// Effective Teaching Load (ATLAS Annual Contract)
// ---------------------------------------------------------------------------

export interface AtlasEffectiveAssignment {
  subjectId: number;
  sectionId: number;
  facultyId: number;
  facultyName: string;
  specializationCode: string | null;
  specializationLabel: string | null;
}

export interface AtlasEffectiveSource {
  schoolId: number;
  schoolYearId: number;
  state: 'EMPTY' | 'POPULATED';
  version: number;
  initializedAt: string;
  updatedAt: string;
  isActiveSchoolYear: boolean;
}

export interface AtlasEffectiveTeachingLoadResponse {
  source: AtlasEffectiveSource;
  assignments: AtlasEffectiveAssignment[];
  coverageTotals: {
    assignedPairs: number;
    activeAssignedPairs: number;
    realFacultyAssignedPairs: number;
    syntheticPlaceholderPairs: number;
    rawAssignedPairs: number;
    totalPairs: number;
    unassignedPairs: number;
    rawUnassignedPairs: number;
  };
}

/**
 * Fetch the effective annual teaching load from ATLAS.
 * GET /faculty-assignments/effective?schoolId={schoolId}&schoolYearId={schoolYearId}
 *
 * This is the ONLY correct endpoint for integration consumers per the ATLAS
 * Annual Teaching Load Contract. Returns EMPTY state when no assignments exist
 * for the requested year — this is valid and must not be treated as an error.
 *
 * Validates the response payload against the contract schema and scope constraints.
 * Returns a discriminated result to let callers handle each failure mode explicitly.
 */
export type EffectiveLoadResult =
  | { status: 'ok'; data: AtlasEffectiveTeachingLoadResponse }
  | { status: 'inactive'; reason: string }
  | { status: 'rejected'; reason: string }
  | { status: 'missing' }
  | { status: 'unreachable' }
  | { status: 'auth' };

export async function fetchEffectiveTeachingLoad(
  schoolYearId: number,
  opts?: { retries?: number; timeoutMs?: number },
): Promise<EffectiveLoadResult> {
  let raw: unknown;
  try {
    raw = await atlasGet(
      `/faculty-assignments/effective?schoolId=${ATLAS_SCHOOL_ID}&schoolYearId=${schoolYearId}`,
      opts?.retries,
      opts?.timeoutMs,
    );
  } catch (err: unknown) {
    if (err instanceof HttpError && err.isAuth) return { status: 'auth' };
    return { status: 'unreachable' };
  }

  // `request()` resolves null on HTTP 404 — the year id does not exist in ATLAS.
  if (raw == null) return { status: 'missing' };

  // Zod structural validation
  const parsed = atlasEffectiveTeachingLoadSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { status: 'rejected', reason: `Schema validation failed: ${issues}` };
  }

  // Scope validation (school, year, active flag)
  const constraints: AtlasScopeConstraints = { schoolId: ATLAS_SCHOOL_ID, schoolYearId };
  const scopeError = validateAtlasScope(parsed.data, constraints);
  if (scopeError) {
    if (scopeError.startsWith('Inactive school year')) {
      return { status: 'inactive', reason: scopeError };
    }
    return { status: 'rejected', reason: scopeError };
  }

  return { status: 'ok', data: parsed.data as AtlasEffectiveTeachingLoadResponse };
}

export { ATLAS_BASE, ATLAS_SCHOOL_ID, DEFAULT_ATLAS_SCHOOL_YEAR_ID };
