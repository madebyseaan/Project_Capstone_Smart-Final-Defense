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
  type EnrollProTeacher,
} from './enrollproClient';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DEFAULT_TTL_MS = parseInt(process.env.SYNC_CACHE_TTL_MS ?? '300000', 10); // 5 min

// ---------------------------------------------------------------------------
// Generic cache entry
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  ttlMs: number;
}

class SyncCache {
  private store = new Map<string, CacheEntry<any>>();

  /**
   * Get a cached value. Returns undefined if expired or not present.
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
   * Set a cached value with optional custom TTL.
   */
  set<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
    this.store.set(key, { data, fetchedAt: Date.now(), ttlMs });
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
 * Get all EnrollPro teachers. Returns cached data if fresh, otherwise fetches.
 */
export async function getCachedEnrollProTeachers(force = false): Promise<EnrollProTeacher[]> {
  const KEY = 'enrollpro:teachers';
  if (!force) {
    const cached = syncCache.get<EnrollProTeacher[]>(KEY);
    if (cached) return cached;
  }

  const fresh = await getEnrollProTeachers();
  syncCache.set(KEY, fresh);
  return fresh;
}

/**
 * Get all EnrollPro integration v1 sections. Returns cached data if fresh.
 */
export async function getCachedIntegrationV1Sections(schoolYearId?: number, force = false): Promise<any[]> {
  const KEY = `enrollpro:sections:${schoolYearId ?? 'default'}`;
  if (!force) {
    const cached = syncCache.get<any[]>(KEY);
    if (cached) return cached;
  }

  const fresh = await getAllIntegrationV1Sections(schoolYearId);
  syncCache.set(KEY, fresh);
  return fresh;
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

/**
 * Invalidate all cached data. Called after a sync cycle completes
 * to force the next read to get fresh data.
 */
export function invalidateAllCaches(): void {
  syncCache.invalidate();
}
