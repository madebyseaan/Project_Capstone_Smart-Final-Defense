/**
 * schoolYearResolver.ts
 *
 * Centralized school year resolution. ALL server code should use this
 * instead of reading SystemSettings.currentSchoolYear directly.
 *
 * Resolution order:
 *   1. SystemSettings.schoolYearId → SchoolYear record (FK, preferred)
 *   2. SystemSettings.currentSchoolYear string → match by label
 *   3. Throw if nothing found (fail loudly — don't silently default)
 *
 * EnrollPro alignment:
 *   SchoolYear.externalId stores the EnrollPro numeric ID.
 *   Use resolveSchoolYearByExternalId() when syncing from EnrollPro.
 *
 * Caches the active SchoolYear for 5 minutes to avoid DB hit on every request.
 */

import { prisma } from './prisma';
import { logger } from './logger';
import type { SchoolYear } from '@prisma/client';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedActiveYear: SchoolYear | null = null;
let cacheCreatedAt: number = 0;

/**
 * Returns the active SchoolYear record. Throws if none found.
 * Use this everywhere instead of `settings?.currentSchoolYear ?? '2026-2027'`.
 */
export async function getActiveSchoolYear(): Promise<SchoolYear> {
  const now = Date.now();
  if (cachedActiveYear && (now - cacheCreatedAt) < CACHE_TTL_MS) {
    return cachedActiveYear;
  }

  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'main' },
    include: { schoolYear: true },
  });

  if (!settings) {
    throw new Error('[SchoolYearResolver] SystemSettings row not found — cannot resolve active school year');
  }

  // Priority 1: FK relation
  if (settings.schoolYear) {
    cachedActiveYear = settings.schoolYear;
    cacheCreatedAt = now;
    return cachedActiveYear;
  }

  // Priority 2: Match by label string
  if (settings.currentSchoolYear) {
    const year = await prisma.schoolYear.findFirst({
      where: { label: settings.currentSchoolYear },
    });
    if (year) {
      cachedActiveYear = year;
      cacheCreatedAt = now;
      logger.info(`[SchoolYearResolver] Resolved by label "${settings.currentSchoolYear}" → ${year.id}`);
      return cachedActiveYear;
    }
  }

  throw new Error(
    `[SchoolYearResolver] No active SchoolYear found. ` +
    `schoolYearId=${settings.schoolYearId}, currentSchoolYear="${settings.currentSchoolYear}". ` +
    `Create a SchoolYear record and link it in SystemSettings.`
  );
}

/**
 * Returns the active school year label string (e.g. "2026-2027").
 * Use this as a drop-in replacement for `settings?.currentSchoolYear ?? '2026-2027'`.
 */
export async function getActiveSchoolYearLabel(): Promise<string> {
  const year = await getActiveSchoolYear();
  return year.label;
}

/**
 * Finds a SchoolYear by its EnrollPro external ID.
 * Returns null if not found — caller decides what to do.
 */
export async function findSchoolYearByExternalId(externalId: number): Promise<SchoolYear | null> {
  return prisma.schoolYear.findUnique({ where: { externalId } });
}

/**
 * Ensures a SchoolYear exists for the given EnrollPro data, and links it as active.
 * - Creates the record if it doesn't exist (by externalId or label)
 * - Updates the label/status if changed
 * - Sets SystemSettings.schoolYearId FK to point to it
 * - Invalidates the cache
 */
export async function ensureSchoolYearFromEnrollPro(
  enrollProId: number,
  yearLabel: string,
  opts?: { status?: string },
): Promise<SchoolYear> {
  const status = opts?.status ?? 'ACTIVE';

  // Try by externalId first, then by label
  let year = await prisma.schoolYear.findUnique({ where: { externalId: enrollProId } });
  if (!year) {
    year = await prisma.schoolYear.findUnique({ where: { label: yearLabel } });
  }

  if (year) {
    // Update if label or externalId changed
    const updates: Record<string, unknown> = {};
    if (year.externalId !== enrollProId) updates.externalId = enrollProId;
    if (year.label !== yearLabel) updates.label = yearLabel;
    if (year.status !== status) updates.status = status;
    if (Object.keys(updates).length > 0) {
      year = await prisma.schoolYear.update({ where: { id: year.id }, data: updates });
      logger.info(`[SchoolYearResolver] Updated SchoolYear ${year.id}: ${JSON.stringify(updates)}`);
    }
  } else {
    // Create new
    year = await prisma.schoolYear.create({
      data: { label: yearLabel, externalId: enrollProId, status },
    });
    logger.info(`[SchoolYearResolver] Created SchoolYear ${year.id} (externalId=${enrollProId}, label=${yearLabel})`);
  }

  // Link FK in SystemSettings
  await prisma.systemSettings.upsert({
    where: { id: 'main' },
    update: { schoolYearId: year.id, currentSchoolYear: yearLabel },
    create: { id: 'main', schoolYearId: year.id, currentSchoolYear: yearLabel },
  });

  invalidateSchoolYearCache();
  return year;
}

/**
 * Invalidates the cache. Call after writing to SchoolYear or SystemSettings.
 */
export function invalidateSchoolYearCache(): void {
  cachedActiveYear = null;
  cacheCreatedAt = 0;
}
