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

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

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
            reject(new Error(`HTTP ${res.statusCode} ${url}: ${body.slice(0, 300)}`));
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
): Promise<any> {
  return request(url, { method: 'GET', headers, timeoutMs });
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
 */
export async function atlasGet(path: string): Promise<any> {
  return httpGet(atlasUrl(path), atlasAuthHeader());
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

let cachedAtlasSY: { id: number; source: string } | null = null;
let cachedAtlasSYAt: number = 0;

/**
 * Dynamically resolve the active Atlas school year ID.
 *
 * Resolution order:
 *   1. In-memory cache (5 min TTL)
 *   2. GET /schools/{id}/schedules/published → source.schoolYearId
 *   3. Probe known year IDs for a published schedule
 *   4. Fall back to env ATLAS_SCHOOL_YEAR_ID
 */
export async function resolveAtlasSchoolYear(): Promise<{ id: number; source: string }> {
  const now = Date.now();
  if (cachedAtlasSY && (now - cachedAtlasSYAt) < ATLAS_SY_CACHE_TTL_MS) {
    return cachedAtlasSY;
  }

  // 1. Try school-wide published schedule
  try {
    const pub = await atlasGet(`/schools/${ATLAS_SCHOOL_ID}/schedules/published`);
    const pubYearId = pub?.source?.schoolYearId;
    if (Number.isFinite(pubYearId) && pubYearId > 0) {
      cachedAtlasSY = { id: pubYearId, source: 'published-schedule' };
      cachedAtlasSYAt = now;
      return cachedAtlasSY;
    }
  } catch { /* continue to probe */ }

  // 2. Probe known year IDs for a published schedule
  const probeYears = [DEFAULT_ATLAS_SCHOOL_YEAR_ID, 2, 3, 5, 6, 1, 8]
    .filter((v, i, a) => a.indexOf(v) === i); // deduplicate
  for (const probeYear of probeYears) {
    try {
      const data = await atlasGet(`/schools/${ATLAS_SCHOOL_ID}/school-years/${probeYear}/schedules/published`);
      if (data?.entries?.length > 0 || data?.source?.schoolYearId) {
        cachedAtlasSY = { id: probeYear, source: 'probe' };
        cachedAtlasSYAt = now;
        return cachedAtlasSY;
      }
    } catch { /* this year has no published schedule */ }
  }

  // 3. Fall back to env default
  cachedAtlasSY = { id: DEFAULT_ATLAS_SCHOOL_YEAR_ID, source: 'env-fallback' };
  cachedAtlasSYAt = now;
  return cachedAtlasSY;
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

export { ATLAS_BASE, ATLAS_SCHOOL_ID, DEFAULT_ATLAS_SCHOOL_YEAR_ID };
