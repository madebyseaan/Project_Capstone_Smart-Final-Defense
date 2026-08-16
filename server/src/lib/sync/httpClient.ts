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

const DEFAULT_TIMEOUT_MS = 20_000;

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
  } = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
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
        if (res.statusCode && res.statusCode >= 400) {
          // Return the error body for debugging but don't throw — callers can decide
          reject(new Error(`HTTP ${res.statusCode} ${url}: ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          // Some endpoints return plain text or empty bodies
          resolve(body || null);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout: ${url}`));
    });

    if (bodyBuf) req.write(bodyBuf);
    req.end();
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
const ATLAS_SCHOOL_ID = Number(process.env.ATLAS_SCHOOL_ID ?? '1');

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

export { ATLAS_BASE, ATLAS_SCHOOL_ID };
