/**
 * schoolEnv.ts
 *
 * Fail-fast environment guards for school-scoped env vars.
 * In development: warns once and returns legacy defaults.
 * In production: throws at first use if vars are unset.
 */

import { isProduction } from "./env";

// Track which vars we've already warned about (dev mode only)
const warnedKeys = new Set<string>();

const DEFAULTS: Record<string, string | undefined> = {
  ENROLLPRO_SCHOOL_YEAR_ID: "38",
  ATLAS_SCHOOL_ID: "1",
  ATLAS_SCHOOL_YEAR_ID: "3",
};

function resolveSchoolVar(name: string): number {
  const raw = process.env[name];

  if (raw === undefined || raw === "") {
    if (isProduction()) {
      throw new Error(
        `[FATAL] ${name} is not set. ` +
        `In production, this env var MUST be provided. ` +
        `Set it in server/.env or your deployment environment.`
      );
    }

    // Dev mode: warn once, return legacy default
    if (!warnedKeys.has(name)) {
      warnedKeys.add(name);
      const defaultVal = DEFAULTS[name] ?? "???";
      console.warn(
        `[CONFIG] ${name} not set — using dev default ${defaultVal}. NEVER do this in production.`
      );
    }

    return Number(DEFAULTS[name]);
  }

  const num = Number(raw);
  if (Number.isNaN(num)) {
    throw new Error(
      `[FATAL] ${name} is set to "${raw}" which is not a valid number.`
    );
  }

  return num;
}

/**
 * EnrollPro school year ID for the current school deployment.
 */
export function getEnrollProSchoolYearId(): number {
  return resolveSchoolVar("ENROLLPRO_SCHOOL_YEAR_ID");
}

/**
 * ATLAS school ID for the current school deployment.
 */
export function getAtlasSchoolId(): number {
  return resolveSchoolVar("ATLAS_SCHOOL_ID");
}

/**
 * ATLAS school year ID for the current school deployment.
 */
export function getAtlasSchoolYearId(): number {
  return resolveSchoolVar("ATLAS_SCHOOL_YEAR_ID");
}

// ---------------------------------------------------------------------------
// Prune config — safe defaults, never fail-fast
// ---------------------------------------------------------------------------

/**
 * Whether the auto-prune engine is enabled.
 * Default: true. Set PRUNE_ENABLED=false to disable.
 */
export function isPruneEnabled(): boolean {
  return process.env.PRUNE_ENABLED !== 'false';
}

/**
 * Whether prune should run in dry-run mode (plan only, no writes).
 * Default: false.
 */
export function isPruneDryRun(): boolean {
  return process.env.PRUNE_DRY_RUN === 'true';
}

/**
 * Maximum ratio of planned deletes vs active entities before circuit breaker trips.
 * Range: 0..1. Default: 0.5 (50%).
 */
export function getPruneMaxDeletionRatio(): number {
  const raw = parseFloat(process.env.PRUNE_MAX_DELETION_RATIO ?? '0.5');
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.5;
}
