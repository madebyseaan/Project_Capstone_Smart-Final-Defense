/**
 * syncCache.ts
 *
 * In-memory TTL cache for frequently accessed external data.
 * Reduces API calls to EnrollPro/Atlas during teacher login from ~15 to ~0.
 *
 * Cache is populated by the background sync scheduler and read by:
 *  - teacherSync.ts (on teacher login)
 *  - integration.ts (proxy endpoints)
 *
 * Each cache entry has a configurable TTL (default 5 min = sync interval).
 * Cache miss gracefully falls through to a live API call.
 */

import {
  getEnrollProTeachers,
  getAllIntegrationV1Sections,
  resolveEnrollProSchoolYear,
  getEnrollProSectionRoster,
  getIntegrationV1LearnersPage,
  type EnrollProTeacher,
} from './enrollproClient';
import type { AtlasEffectiveTeachingLoadResponse } from './sync/httpClient';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DEFAULT_TTL_MS = parseInt(process.env.SYNC_CACHE_TTL_MS ?? '300000', 10); // 5 min
// Stale-while-revalidate window for BULK data (P1). 0 = disabled (kill switch).
const STALE_TTL_MS = parseInt(process.env.SYNC_CACHE_STALE_MS ?? '86400000', 10); // 24 h

// ---------------------------------------------------------------------------
// Generic cache entry
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  ttlMs: number;
  staleTtlMs: number;
}

class SyncCache {
  private store = new Map<string, CacheEntry<any>>();
  private inflight = new Map<string, Promise<any>>();

  /**
   * Get a cached value. Returns undefined if expired or not present.
   * Fresh-only read — stale-aware callers use getOrFetch().
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.fetchedAt > entry.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /**
   * Stale-aware read: returns data even after its fresh TTL, with staleness info.
   * Returns undefined when the entry is beyond the stale window or stale serving is off.
   */
  getWithStatus<T>(key: string): { data: T; stale: boolean; ageMs: number } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const ageMs = Date.now() - entry.fetchedAt;
    if (ageMs <= entry.ttlMs) return { data: entry.data as T, stale: false, ageMs };
    if (entry.staleTtlMs > 0 && ageMs <= entry.ttlMs + entry.staleTtlMs) {
      return { data: entry.data as T, stale: true, ageMs };
    }
    this.store.delete(key);
    return undefined;
  }

  /**
   * Set a cached value with optional custom fresh TTL and stale window.
   */
  set<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS, staleTtlMs = STALE_TTL_MS): void {
    this.store.set(key, { data, fetchedAt: Date.now(), ttlMs, staleTtlMs });
  }

  /**
   * Fresh value → return it. Stale-but-usable value → return immediately and refresh
   * in the background (single-flight). Miss → fetch now; on fetch failure, fall back
   * to a stale value if one is still usable.
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    opts?: { ttlMs?: number; staleTtlMs?: number },
  ): Promise<T> {
    const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    const staleTtlMs = opts?.staleTtlMs ?? STALE_TTL_MS;
    const entry = this.store.get(key);

    if (entry) {
      const ageMs = Date.now() - entry.fetchedAt;
      // An existing entry is judged by the TTL/stale window it was written with;
      // caller opts may only tighten the stale window (e.g. kill switch).
      if (ageMs <= entry.ttlMs) return entry.data as T;
      const cap = opts?.staleTtlMs;
      const effectiveStale = cap != null ? Math.min(entry.staleTtlMs, cap) : entry.staleTtlMs;
      const usable = effectiveStale > 0 && ageMs <= entry.ttlMs + effectiveStale;
      if (!usable) {
        this.store.delete(key);
      } else {
        // Serve stale now; refresh in the background.
        void this.refresh(key, fetcher, ttlMs, staleTtlMs).catch(() => {});
        this.logStale(key, ageMs);
        return entry.data as T;
      }
    }

    return this.refresh(key, fetcher, ttlMs, staleTtlMs);
  }

  private refresh<T>(key: string, fetcher: () => Promise<T>, ttlMs: number, staleTtlMs: number): Promise<T> {
    const inflight = this.inflight.get(key);
    if (inflight) return inflight as Promise<T>;

    const promise = fetcher()
      .then((fresh) => {
        this.set(key, fresh, ttlMs, staleTtlMs);
        return fresh;
      })
      .catch((err) => {
        const entry = this.store.get(key);
        const ageMs = entry ? Date.now() - entry.fetchedAt : 0;
        if (entry && staleTtlMs > 0 && ageMs <= ttlMs + staleTtlMs) {
          this.logStale(key, ageMs);
          return entry.data as T;
        }
        throw err;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  private logStale(key: string, ageMs: number): void {
    logger.debug(`[SyncCache] serving stale ${key} (age=${Math.round(ageMs / 1000)}s)`);
  }

  /**
   * Invalidate a specific key or all keys.
   */
  invalidate(key?: string): void {
    if (key) {
      this.store.delete(key);
    } else {
      this.store.clear();
    }
  }

  /**
   * Invalidate every key starting with the given prefix.
   * Used for per-source invalidation after a successful sync step.
   */
  invalidatePrefix(prefix: string): void {
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /**
   * Get cache stats for debugging.
   */
  stats(): { size: number; keys: string[] } {
    return { size: this.store.size, keys: Array.from(this.store.keys()) };
  }
}

// Singleton instance
export const syncCache = new SyncCache();

// ---------------------------------------------------------------------------
// Convenience getters with auto-fetch on miss
// ---------------------------------------------------------------------------

/**
 * Get all EnrollPro teachers. Fresh cache → instant; stale → serve now + refresh
 * in the background; miss → fetch (fast-fail on EP outage). P1 bulk SWR.
 *
 * `allowStale=false` is for security-sensitive callers (e.g. the login faculty
 * gate): fresh-only cache, then a live fast-fail fetch — never a stale roster.
 */
export async function getCachedEnrollProTeachers(force = false, allowStale = true): Promise<EnrollProTeacher[]> {
  const KEY = 'enrollpro:teachers';
  if (force) {
    const fresh = await getEnrollProTeachers();
    syncCache.set(KEY, fresh);
    return fresh;
  }
  if (!allowStale) {
    const cached = syncCache.get<EnrollProTeacher[]>(KEY);
    if (cached) return cached;
    const fresh = await getEnrollProTeachers();
    syncCache.set(KEY, fresh);
    return fresh;
  }
  return syncCache.getOrFetch(KEY, () => getEnrollProTeachers());
}

/**
 * Get all EnrollPro integration v1 sections. Same stale-while-revalidate rules.
 */
export async function getCachedIntegrationV1Sections(schoolYearId?: number, force = false): Promise<any[]> {
  const KEY = `enrollpro:sections:${schoolYearId ?? 'default'}`;
  if (force) {
    const fresh = await getAllIntegrationV1Sections(schoolYearId);
    syncCache.set(KEY, fresh);
    return fresh;
  }
  return syncCache.getOrFetch(KEY, () => getAllIntegrationV1Sections(schoolYearId));
}

/**
 * Get resolved EnrollPro school year. Returns cached data if fresh.
 */
export async function getCachedSchoolYear(preferredLabel?: string): Promise<{
  id: number;
  yearLabel: string;
  source: string;
}> {
  const KEY = `enrollpro:schoolYear:${preferredLabel ?? 'default'}`;
  const cached = syncCache.get<{ id: number; yearLabel: string; source: string }>(KEY);
  if (cached) return cached;

  const fresh = await resolveEnrollProSchoolYear(preferredLabel);
  syncCache.set(KEY, fresh);
  return fresh;
}

/**
 * Get Atlas faculty list. Returns cached data if fresh.
 * Must be populated by atlasSync — no auto-fetch because Atlas requires a token.
 */
export function getCachedAtlasFaculty(): any[] | undefined {
  return syncCache.get<any[]>('atlas:faculty');
}

/**
 * Set Atlas faculty list in cache (called by atlasSync after fetch).
 */
export function setCachedAtlasFaculty(faculty: any[]): void {
  syncCache.set('atlas:faculty', faculty);
}

// ---------------------------------------------------------------------------
// Atlas Effective Teaching Load cache (ATLAS Annual Contract)
// ---------------------------------------------------------------------------
// Contract cache key: atlas-teaching-load:{schoolId}:{schoolYearId}:{version}
// Implementation: store by schoolId:schoolYearId (get doesn't know version),
// but track the version separately so set() can invalidate stale entries
// when ATLAS bumps the version.

const atlasTLVersionByScope = new Map<string, number>();

function atlasTLSchoolYearKey(schoolId: number, schoolYearId: number): string {
  return `atlas-teaching-load:${schoolId}:${schoolYearId}`;
}

/**
 * Get cached effective teaching load for a school year.
 * Returns undefined if not cached.
 */
export function getCachedEffectiveTeachingLoad(
  schoolId: number,
  schoolYearId: number,
): AtlasEffectiveTeachingLoadResponse | undefined {
  return syncCache.get<AtlasEffectiveTeachingLoadResponse>(
    atlasTLSchoolYearKey(schoolId, schoolYearId),
  );
}

/**
 * Set effective teaching load in cache.
 * Invalidates stale entries when ATLAS bumps the version (contract compliance).
 */
export function setCachedEffectiveTeachingLoad(
  schoolId: number,
  schoolYearId: number,
  data: AtlasEffectiveTeachingLoadResponse,
): void {
  const scopeKey = atlasTLSchoolYearKey(schoolId, schoolYearId);
  const newVersion = data.source.version;
  const prevVersion = atlasTLVersionByScope.get(scopeKey);

  // If version changed, invalidate old entry first (contract: refetch on version change)
  if (prevVersion != null && prevVersion !== newVersion) {
    syncCache.invalidate(scopeKey);
    logger.debug(`[SyncCache] Teaching load version changed: ${prevVersion} → ${newVersion} for schoolYear ${schoolYearId}`);
  }

  atlasTLVersionByScope.set(scopeKey, newVersion);
  syncCache.set(scopeKey, data);
}

/**
 * Invalidate cached teaching load for a specific school year.
 */
export function invalidateEffectiveTeachingLoad(
  schoolId: number,
  schoolYearId: number,
): void {
  const scopeKey = atlasTLSchoolYearKey(schoolId, schoolYearId);
  syncCache.invalidate(scopeKey);
  atlasTLVersionByScope.delete(scopeKey);
}

/**
 * Invalidate all cached data. Called after a sync cycle completes
 * to force the next read to get fresh data.
 */
export function invalidateAllCaches(): void {
  syncCache.invalidate();
}

/**
 * Invalidate every key with the given prefix (e.g. 'enrollpro:').
 * Used for per-source invalidation after a successful sync step.
 */
export function invalidatePrefix(prefix: string): void {
  syncCache.invalidatePrefix(prefix);
}

// ---------------------------------------------------------------------------
// P1 extension — rosters & learner pages (SWR)
// ---------------------------------------------------------------------------

/**
 * Section roster with stale-while-revalidate. During an EnrollPro outage a
 * previously fetched roster (within the stale window) is served instead of a 500;
 * `stale`/`ageMs` let the UI show a "cached data" badge.
 */
export async function getSectionRosterWithStatus(sectionId: number): Promise<{
  learners: any[];
  stale: boolean;
  ageMs: number;
}> {
  const KEY = `enrollpro:roster:${sectionId}`;
  const learners = await syncCache.getOrFetch(KEY, () => getEnrollProSectionRoster(sectionId));
  const status = syncCache.getWithStatus<any[]>(KEY);
  return {
    learners: status?.data ?? learners ?? [],
    stale: status?.stale ?? false,
    ageMs: status?.ageMs ?? 0,
  };
}

/**
 * Learner page with stale-while-revalidate (registrar dashboard breakdowns).
 */
export async function getCachedLearnersPage(
  schoolYearId: number,
  page: number,
  limit: number,
): Promise<{ data?: any[]; meta?: any }> {
  return syncCache.getOrFetch(
    `enrollpro:learners:${schoolYearId}:${page}:${limit}`,
    () => getIntegrationV1LearnersPage(schoolYearId, page, limit),
  );
}
