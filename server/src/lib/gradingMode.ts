import { GradingMode } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";

export { GradingMode };

const CACHE_TTL_MS = 5 * 60 * 1000;

const modeCache = new Map<string, { mode: GradingMode; expiresAt: number }>();

export function isGradingMode(value: unknown): value is GradingMode {
  return value === GradingMode.TRANSMUTED || value === GradingMode.ZERO_BASED;
}

export function roundGrade(value: number): number {
  return Math.round(value * 100) / 100;
}

export function lookupTransmutedGrade(
  table: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>,
  initialGrade: number,
): number | null {
  const rounded = roundGrade(initialGrade);
  for (const entry of table) {
    if (rounded >= entry.minGrade && rounded <= entry.maxGrade) {
      return entry.transmutedGrade;
    }
  }
  return null;
}

/**
 * Canonical TG derivation.
 * - ZERO_BASED: IG is reported directly, rounded to the nearest whole number,
 *   with the DO 015 60-point reportable floor.
 * - TRANSMUTED: adjusted transmutation table lookup.
 */
export function computeTermGrade(
  initialGrade: number,
  mode: GradingMode,
  table: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>,
): number {
  if (mode === GradingMode.ZERO_BASED) {
    return Math.min(100, Math.max(60, Math.round(roundGrade(initialGrade))));
  }

  const transmuted = lookupTransmutedGrade(table, initialGrade);
  if (transmuted !== null) {
    return transmuted;
  }

  logger.warn(
    `[Transmutation] Initial grade ${roundGrade(initialGrade)} did not match any range — returning fallback 60. ` +
      `Check the transmutation table for gaps or misconfigured ranges (${table.length} entries).`,
  );
  return 60;
}

export function recommendedModeForSchoolYear(label: string): GradingMode {
  const startYear = Number.parseInt(label.split("-")[0] ?? "", 10);
  if (Number.isFinite(startYear) && startYear >= 2027) {
    return GradingMode.ZERO_BASED;
  }
  return GradingMode.TRANSMUTED;
}

export async function getGradingModeForSchoolYear(schoolYear: string): Promise<GradingMode> {
  const now = Date.now();
  const cached = modeCache.get(schoolYear);
  if (cached && cached.expiresAt > now) {
    return cached.mode;
  }

  try {
    const year = await prisma.schoolYear.findUnique({
      where: { label: schoolYear },
      select: { gradingMode: true },
    });

    if (!year) {
      logger.warn(`[GradingMode] School year "${schoolYear}" not found — falling back to TRANSMUTED`);
      modeCache.set(schoolYear, {
        mode: GradingMode.TRANSMUTED,
        expiresAt: now + CACHE_TTL_MS,
      });
      return GradingMode.TRANSMUTED;
    }

    modeCache.set(schoolYear, {
      mode: year.gradingMode,
      expiresAt: now + CACHE_TTL_MS,
    });
    return year.gradingMode;
  } catch (error: any) {
    logger.warn(
      `[GradingMode] Failed to resolve mode for "${schoolYear}" — falling back to TRANSMUTED: ${error?.message ?? error}`,
    );
    return GradingMode.TRANSMUTED;
  }
}

export function invalidateGradingModeCache(schoolYear?: string): void {
  if (schoolYear) {
    modeCache.delete(schoolYear);
    return;
  }
  modeCache.clear();
}
