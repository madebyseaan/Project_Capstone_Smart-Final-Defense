/**
 * syncCoordinator.ts
 *
 * Unified sync coordinator — the SINGLE entry point for all background sync.
 * Replaces the previous triple-scheduler pattern that caused race conditions
 * and inconsistent data.
 *
 * Responsibilities:
 *  1. Runs EnrollPro sync → Atlas sync → Branding sync in correct order
 *  2. Maintains a global lock (no overlapping runs)
 *  3. Broadcasts SSE events so frontend auto-refreshes
 *  4. Exposes status/result for admin dashboard
 *  5. Supports immediate trigger (webhook, manual admin action)
 *
 * Call startUnifiedSyncScheduler() once on server boot. That's it.
 */

import { runEnrollProSync, getEnrollProSyncStatus } from './enrollproSync';
import { runAtlasSync, getSyncStatus as getAtlasSyncStatus } from './atlasSync';
import { syncEnrollProBranding } from './enrollproBrandingSync';
import { runStudentProfileSync } from './studentProfileSync';
import { broadcastSyncStatus } from './sseManager';
import { prisma } from './prisma';
import { invalidateAllCaches } from './syncCache';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DEFAULT_INTERVAL_MS = 300000; // 5 minutes
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS ?? '', 10) || 
                       (parseInt(process.env.SYNC_INTERVAL_MINUTES ?? '', 10) * 60 * 1000) || 
                       DEFAULT_INTERVAL_MS;

const SYNC_INTERVAL_MINUTES = Math.round(SYNC_INTERVAL_MS / 60000);
const BRANDING_SYNC_EVERY_N_CYCLES = parseInt(process.env.BRANDING_SYNC_EVERY_N_CYCLES ?? '12', 10); // 12 × 5min = 60min
const STUDENT_PROFILE_SYNC_EVERY_N_CYCLES = parseInt(process.env.STUDENT_PROFILE_SYNC_EVERY_N_CYCLES ?? '12', 10); // 12 × 5min = 60min
const INITIAL_DELAY_MS = parseInt(process.env.SYNC_INITIAL_DELAY_MS ?? '5000', 10); // 5s after boot
const ENROLLPRO_BASE = (process.env.ENROLLPRO_URL ?? process.env.ENROLLPRO_BASE_URL ?? 'https://dev-jegs.buru-degree.ts.net/api').replace(/\/$/, '');
const ATLAS_BASE = (process.env.ATLAS_URL ?? process.env.ATLAS_BASE_URL ?? 'https://njgrm.buru-degree.ts.net/api/v1').replace(/\/$/, '');
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = parseInt(process.env.SYNC_CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? '3', 10);
const CIRCUIT_BREAKER_COOLDOWN_MS = parseInt(process.env.SYNC_CIRCUIT_BREAKER_COOLDOWN_MS ?? '300000', 10);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let syncRunning = false;
let syncCycleCount = 0;
let lastFullSyncAt: Date | null = null;
let lastSyncResult: UnifiedSyncResult | null = null;
let _schedulerTimer: NodeJS.Timeout | null = null;
let consecutiveCriticalFailures = 0;
let circuitOpenedAt: Date | null = null;
let circuitOpenReason: string | null = null;
let lastDependencyHealth: DependencyHealthSnapshot | null = null;

export interface UnifiedSyncResult {
  timestamp: string;
  durationMs: number;
  enrollpro: {
    advisoriesSynced: number;
    studentsFetched: number;
    studentsSynced: number;
    studentsSkipped: number;
    studentsDropped: number;
    teachersMatched: number;
    errors: string[];
  } | null;
  atlas: {
    matched: number;
    created: number;
    deleted: number;
    teachersWithLoads: number;
    errors: string[];
  } | null;
  branding: boolean;
  error?: string;
}

export interface DependencyHealth {
  name: string;
  url: string;
  online: boolean;
  httpStatus: number | null;
  latencyMs: number;
  error?: string;
}

export interface DependencyHealthSnapshot {
  checkedAt: string;
  enrollpro: DependencyHealth;
  atlas: DependencyHealth;
}

// ---------------------------------------------------------------------------
// Core sync cycle
// ---------------------------------------------------------------------------

/**
 * Runs a full sync cycle in the correct dependency order:
 *   1. EnrollPro (teachers, sections, students, enrollments)
 *   2. Atlas (teaching load — depends on sections from step 1)
 *   3. Branding (independent, only every Nth cycle)
 *
 * Safe to call from anywhere — will skip if already running.
 */
export async function runUnifiedSync(options?: {
  forceBranding?: boolean;
  source?: string;
}): Promise<UnifiedSyncResult> {
  const source = options?.source ?? 'scheduled';

  if (syncRunning) {
    console.log('[SyncCoordinator] Sync already running, skipping.');
    const skippedResult = lastSyncResult ?? buildEmptyResult('skipped — already running');
    await persistSyncHistory({
      source,
      status: 'SKIPPED',
      startedAt: new Date(),
      completedAt: new Date(),
      result: skippedResult,
      metadata: { reason: 'already-running' },
    });
    return skippedResult;
  }

  if (isCircuitOpen()) {
    const skippedAt = new Date();
    const skippedResult = buildEmptyResult(`skipped — circuit breaker open (${circuitOpenReason ?? 'critical dependency unavailable'})`);
    lastSyncResult = skippedResult;

    broadcastSyncStatus({
      type: 'SYNC_SKIPPED',
      source,
      timestamp: skippedAt.toISOString(),
      reason: skippedResult.error,
    });

    await persistSyncHistory({
      source,
      status: 'SKIPPED',
      startedAt: skippedAt,
      completedAt: skippedAt,
      result: skippedResult,
      metadata: {
        reason: 'circuit-open',
        circuitOpenedAt: circuitOpenedAt?.toISOString() ?? null,
        consecutiveCriticalFailures,
        lastDependencyHealth,
      },
    });

    return skippedResult;
  }

  const dependencySnapshot = await checkCriticalDependencies();
  lastDependencyHealth = dependencySnapshot;

  if (!dependencySnapshot.enrollpro.online || !dependencySnapshot.atlas.online) {
    consecutiveCriticalFailures += 1;
    const skippedAt = new Date();
    const reason = `skipped — dependency offline (EnrollPro: ${dependencySnapshot.enrollpro.online ? 'online' : 'offline'}, Atlas: ${dependencySnapshot.atlas.online ? 'online' : 'offline'})`;
    const skippedResult = buildEmptyResult(reason);
    lastSyncResult = skippedResult;

    if (consecutiveCriticalFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      circuitOpenedAt = new Date();
      circuitOpenReason = reason;
      console.warn(
        `[SyncCoordinator] Circuit breaker opened after ${consecutiveCriticalFailures} failed dependency checks. Cooldown: ${CIRCUIT_BREAKER_COOLDOWN_MS}ms.`,
      );
    }

    broadcastSyncStatus({
      type: 'SYNC_SKIPPED',
      source,
      timestamp: skippedAt.toISOString(),
      reason,
      dependencies: dependencySnapshot,
    });

    await persistSyncHistory({
      source,
      status: 'SKIPPED',
      startedAt: skippedAt,
      completedAt: skippedAt,
      result: skippedResult,
      metadata: {
        reason: 'dependency-offline',
        dependencySnapshot,
        consecutiveCriticalFailures,
        circuitOpenedAt: circuitOpenedAt?.toISOString() ?? null,
      },
    });

    return skippedResult;
  }

  consecutiveCriticalFailures = 0;
  circuitOpenedAt = null;
  circuitOpenReason = null;

  syncRunning = true;
  syncCycleCount++;
  const startedAt = new Date();
  const startTime = Date.now();

  logger.debug(`[SyncCoordinator] Sync cycle #${syncCycleCount} started (${source}) ${new Date().toISOString()}`);

  // Broadcast start event to SSE clients
  broadcastSyncStatus({
    type: 'SYNC_STARTED',
    source,
    timestamp: new Date().toISOString(),
  });

  let enrollproResult: UnifiedSyncResult['enrollpro'] = null;
  let atlasResult: UnifiedSyncResult['atlas'] = null;
  let brandingSynced = false;
  let error: string | undefined;

  try {
    // ── Step 1: EnrollPro Sync ──────────────────────────────────────────
    // Must run first — Atlas depends on sections and teachers from EnrollPro.
    try {
      logger.debug('[SyncCoordinator] Step 1/4: EnrollPro sync...');
      const epResult = await runEnrollProSync();
      if (epResult) {
        enrollproResult = {
          advisoriesSynced: epResult.advisoriesSynced,
          studentsFetched: epResult.studentsFetched,
          studentsSynced: epResult.studentsSynced,
          studentsSkipped: epResult.studentsSkipped,
          studentsDropped: epResult.studentsDropped,
          teachersMatched: epResult.teachersMatched,
          errors: epResult.errors,
        };
      }
    } catch (err: any) {
      logger.error('[SyncCoordinator] EnrollPro sync failed:', err.message);
      enrollproResult = {
        advisoriesSynced: 0,
        studentsFetched: 0,
        studentsSynced: 0,
        studentsSkipped: 0,
        studentsDropped: 0,
        teachersMatched: 0,
        errors: [err.message],
      };
    }

    // ── Step 2: Atlas Sync ──────────────────────────────────────────────
    // Teaching load — depends on sections existing in SMART DB.
    try {
      logger.debug('[SyncCoordinator] Step 2/4: Atlas sync...');
      const atResult = await runAtlasSync();
      if (atResult) {
        atlasResult = {
          matched: atResult.matched,
          created: atResult.created,
          deleted: atResult.deleted,
          teachersWithLoads: atResult.teachersWithLoads,
          errors: atResult.errors,
        };
      }
    } catch (err: any) {
      logger.error('[SyncCoordinator] Atlas sync failed:', err.message);
      atlasResult = { matched: 0, created: 0, deleted: 0, teachersWithLoads: 0, errors: [err.message] };
    }

    // ── Step 3: Branding Sync (low frequency) ───────────────────────────
    // Only runs every Nth cycle unless forced.
    const shouldSyncBranding = options?.forceBranding || (syncCycleCount % BRANDING_SYNC_EVERY_N_CYCLES === 0);
    if (shouldSyncBranding) {
      try {
        logger.debug('[SyncCoordinator] Step 3/4: Branding sync...');
        await syncEnrollProBranding();
        brandingSynced = true;
      } catch (err: any) {
        logger.error('[SyncCoordinator] Branding sync failed:', err.message);
      }
    } else {
      logger.debug(`[SyncCoordinator] Step 3/4: Branding sync skipped (next at cycle #${Math.ceil(syncCycleCount / BRANDING_SYNC_EVERY_N_CYCLES) * BRANDING_SYNC_EVERY_N_CYCLES})`);
    }

    // ── Step 4: Student Profile Sync (hourly) ──────────────────────────
    // Enriches student profile fields from EnrollPro. Runs every Nth cycle.
    const shouldSyncStudentProfiles = syncCycleCount % STUDENT_PROFILE_SYNC_EVERY_N_CYCLES === 0;
    if (shouldSyncStudentProfiles) {
      try {
        logger.debug('[SyncCoordinator] Step 4/4: Student profile sync...');
        const profileResult = await runStudentProfileSync();
        if (profileResult.errors.length > 0) {
          logger.warn(`[SyncCoordinator] Student profile sync had ${profileResult.errors.length} errors`);
        }
      } catch (err: any) {
        logger.error('[SyncCoordinator] Student profile sync failed:', err.message);
      }
    } else {
      logger.debug(`[SyncCoordinator] Step 4/4: Student profile sync skipped (next at cycle #${Math.ceil(syncCycleCount / STUDENT_PROFILE_SYNC_EVERY_N_CYCLES) * STUDENT_PROFILE_SYNC_EVERY_N_CYCLES})`);
    }

  } catch (err: any) {
    error = err.message;
    logger.error('[SyncCoordinator] Fatal error:', err.message);
  } finally {
    syncRunning = false;
    invalidateAllCaches(); // Force fresh reads on next request
  }

  const durationMs = Date.now() - startTime;
  lastFullSyncAt = new Date();

  lastSyncResult = {
    timestamp: lastFullSyncAt.toISOString(),
    durationMs,
    enrollpro: enrollproResult,
    atlas: atlasResult,
    branding: brandingSynced,
    ...(error ? { error } : {}),
  };

  logger.info(
    `[SyncCoordinator] ✔ Sync cycle #${syncCycleCount} complete in ${durationMs}ms | ` +
    `EnrollPro: ${enrollproResult?.studentsFetched ?? 0} learners, ${enrollproResult?.advisoriesSynced ?? 0} advisories | ` +
    `ATLAS: ${atlasResult?.matched ?? 0} teachers matched | ` +
    `Branding: ${brandingSynced ? 'synced' : 'skipped'}`
  );

  // Broadcast completion to all SSE clients
  broadcastSyncStatus({
    type: 'SYNC_COMPLETE',
    source,
    timestamp: lastFullSyncAt.toISOString(),
    durationMs,
    result: {
      enrollpro: enrollproResult ? {
        studentsFetched: enrollproResult.studentsFetched,
        studentsUpdated: enrollproResult.studentsSynced,
        studentsUnchanged: enrollproResult.studentsSkipped,
        studentsDropped: enrollproResult.studentsDropped,
        advisories: enrollproResult.advisoriesSynced,
        errors: enrollproResult.errors.length,
      } : null,
      atlas: atlasResult ? {
        created: atlasResult.created,
        matched: atlasResult.matched,
        errors: atlasResult.errors.length,
      } : null,
    },
  });

  await persistSyncHistory({
    source,
    status: error ? 'FAILED' : 'SUCCESS',
    startedAt,
    completedAt: lastFullSyncAt,
    result: lastSyncResult,
    metadata: {
      cycle: syncCycleCount,
      dependencySnapshot,
    },
  });

  return lastSyncResult;
}

/**
 * Trigger an immediate sync cycle (from webhook or manual admin action).
 * Non-blocking — returns immediately if sync is already running.
 */
export function triggerImmediateSync(source = 'manual'): void {
  runUnifiedSync({ source, forceBranding: false }).catch((err) => {
    console.error(`[SyncCoordinator] Triggered sync (${source}) failed:`, err);
  });
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Start the unified sync scheduler. Call ONCE on server boot.
 * Replaces startAtlasSyncScheduler, startEnrollProSyncScheduler,
 * startEnrollProBrandingSyncScheduler, and the autoSync setInterval.
 *
 * Uses a self-rescheduling pattern instead of setInterval to prevent
 * timer-drift storms after machine sleep (setInterval fires all missed
 * ticks at once on wake, hammering external services and DB).
 */
export function startUnifiedSyncScheduler(): void {
  if (_schedulerTimer) {
    console.warn('[SyncCoordinator] Scheduler already running, ignoring duplicate start.');
    return;
  }

  const intervalMs = SYNC_INTERVAL_MINUTES * 60 * 1000;

  console.log(
    `[SyncCoordinator] Scheduler started — syncing every ${SYNC_INTERVAL_MINUTES} min. ` +
    `Branding every ${BRANDING_SYNC_EVERY_N_CYCLES * SYNC_INTERVAL_MINUTES} min. ` +
    `First sync in ${INITIAL_DELAY_MS / 1000}s.`
  );

  // First sync after a short delay (let DB connections settle)
  setTimeout(() => {
    runUnifiedSync({ source: 'boot', forceBranding: true }).catch((err) => {
      console.error('[SyncCoordinator] Boot sync failed:', err);
    });
  }, INITIAL_DELAY_MS);

  // Self-rescheduling loop — avoids setInterval drift storms
  let lastRunAt = Date.now();
  const scheduleNext = () => {
    _schedulerTimer = setTimeout(() => {
      const now = Date.now();
      const elapsed = now - lastRunAt;

      // If more than 2× the interval has elapsed, the machine likely
      // slept and woke — skip this catch-up tick to avoid hammering.
      if (elapsed > intervalMs * 2) {
        console.warn(
          `[SyncCoordinator] Timer drift detected (${Math.round(elapsed / 1000)}s since last run). ` +
          `Skipping catch-up tick to avoid overload.`
        );
      }

      lastRunAt = now;
      runUnifiedSync({ source: 'scheduled' }).catch((err) => {
        console.error('[SyncCoordinator] Scheduled sync failed:', err);
      });

      scheduleNext();
    }, intervalMs) as unknown as NodeJS.Timeout;
  };

  scheduleNext();
}

/**
 * Stop the scheduler (for graceful shutdown or testing).
 */
export function stopUnifiedSyncScheduler(): void {
  if (_schedulerTimer) {
    clearTimeout(_schedulerTimer);
    _schedulerTimer = null;
    console.log('[SyncCoordinator] Scheduler stopped.');
  }
}

// ---------------------------------------------------------------------------
// Status accessors
// ---------------------------------------------------------------------------

export function getUnifiedSyncStatus() {
  return {
    running: syncRunning,
    cycleCount: syncCycleCount,
    lastSyncAt: lastFullSyncAt?.toISOString() ?? null,
    lastResult: lastSyncResult,
    config: {
      intervalMinutes: SYNC_INTERVAL_MINUTES,
      brandingEveryNCycles: BRANDING_SYNC_EVERY_N_CYCLES,
      circuitBreakerFailureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      circuitBreakerCooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS,
    },
    circuitBreaker: getSyncCircuitBreakerStatus(),
    subsystems: {
      enrollpro: getEnrollProSyncStatus(),
      atlas: getAtlasSyncStatus(),
    },
  };
}

export function isUnifiedSyncRunning(): boolean {
  return syncRunning;
}

export function getLastUnifiedSyncResult(): UnifiedSyncResult | null {
  return lastSyncResult;
}

export function getSyncCircuitBreakerStatus() {
  const open = isCircuitOpen();
  return {
    open,
    openedAt: circuitOpenedAt?.toISOString() ?? null,
    reason: circuitOpenReason,
    consecutiveCriticalFailures,
    failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    cooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS,
    lastDependencyHealth,
  };
}

export async function getRecentSyncHistory(limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, limit));
  return prisma.syncHistory.findMany({
    take: safeLimit,
    orderBy: { createdAt: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUrl(base: string, path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function pingUrl(url: string, name: string, headers?: Record<string, string>): Promise<DependencyHealth> {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers });
    return {
      name,
      url,
      online: response.ok,
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      name,
      url,
      online: false,
      httpStatus: null,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkCriticalDependencies(): Promise<DependencyHealthSnapshot> {
  const epHeaders = process.env.ENROLLPRO_INTEGRATION_KEY
    ? { 'X-Integration-Key': process.env.ENROLLPRO_INTEGRATION_KEY }
    : undefined;
  const [enrollpro, atlas] = await Promise.all([
    pingUrl(buildUrl(ENROLLPRO_BASE, '/integration/v1/health'), 'EnrollPro', epHeaders),
    pingUrl(buildUrl(ATLAS_BASE, '/health'), 'Atlas'),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    enrollpro,
    atlas,
  };
}

function isCircuitOpen(): boolean {
  if (!circuitOpenedAt) return false;
  const elapsed = Date.now() - circuitOpenedAt.getTime();
  if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
    circuitOpenedAt = null;
    circuitOpenReason = null;
    consecutiveCriticalFailures = 0;
    return false;
  }
  return true;
}

async function persistSyncHistory(params: {
  source: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  startedAt: Date;
  completedAt: Date;
  result: UnifiedSyncResult;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.syncHistory.create({
      data: {
        source: params.source,
        status: params.status,
        durationMs: params.result.durationMs,
        startedAt: params.startedAt,
        completedAt: params.completedAt,
        enrollpro: params.result.enrollpro as any,
        atlas: params.result.atlas as any,
        branding: params.result.branding,
        error: params.result.error,
        metadata: params.metadata as any,
      },
    });
  } catch (error) {
    console.error('[SyncCoordinator] Failed to persist sync history:', error);
  }
}

function buildEmptyResult(error: string): UnifiedSyncResult {
  return {
    timestamp: new Date().toISOString(),
    durationMs: 0,
    enrollpro: null,
    atlas: null,
    branding: false,
    error,
  };
}
