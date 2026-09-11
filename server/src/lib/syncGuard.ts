/**
 * syncGuard.ts
 *
 * Fail-closed helpers for destructive sync reconciliation steps.
 * See docs/SYNC_OUTAGE_GUARDRAIL_FIX_PLAN.md §4–§6.
 *
 * Principle: a destructive step (archive / suspend / drop / delete) may only
 * run when the source data is confidently complete. When in doubt, skip.
 *
 * The 2026-09-10 incident: ATLAS reported a POPULATED load (265 assignments)
 * while EnrollPro was down, so no row could be resolved to a SMART section.
 * The desired set was empty and 257 ClassAssignments were wrongly archived.
 */

export const MIN_RESOLUTION_COVERAGE = 0.9;
export const MAX_ARCHIVE_RATIO = 0.5;
export const MAX_DEACTIVATION_RATIO = 0.5;

/** True when a data source returned a usable (non-empty) payload. */
export function isConfidentData(count: number): boolean {
  return count > 0;
}

/**
 * True when `destroyCount / totalActive` exceeds `maxRatio`.
 * A non-positive `totalActive` never trips (nothing to destroy relative to).
 */
export function exceedsRatio(destroyCount: number, totalActive: number, maxRatio: number): boolean {
  if (totalActive <= 0) return false;
  return destroyCount / totalActive > maxRatio;
}

export type EffectiveLoadState = 'EMPTY' | 'POPULATED' | 'UNAVAILABLE' | 'REJECTED';

export interface ResolutionConfidence {
  /** Safe to run the destructive archive/reconcile phase. */
  confident: boolean;
  /** Fraction of effective-load rows that resolved to a SMART section. */
  coverage: number;
  /** EP sections were unavailable, or POPULATED load resolved to zero rows. */
  sectionResolutionFailed: boolean;
}

/**
 * Decide whether the ATLAS stale-check may run its destructive phase.
 *
 * Only POPULATED is gated here; EMPTY has its own two-cycle confirmation guard.
 */
export function computeResolutionConfidence(args: {
  state: EffectiveLoadState | string;
  resolvedCount: number;
  totalAssignments: number;
  epSectionsAvailable: boolean;
  minCoverage?: number;
}): ResolutionConfidence {
  const { state, resolvedCount, totalAssignments, epSectionsAvailable } = args;
  const minCoverage = args.minCoverage ?? MIN_RESOLUTION_COVERAGE;

  if (state !== 'POPULATED') {
    return { confident: true, coverage: 1, sectionResolutionFailed: false };
  }

  const sectionResolutionFailed =
    !epSectionsAvailable || (totalAssignments > 0 && resolvedCount === 0);
  const coverage = totalAssignments > 0 ? resolvedCount / totalAssignments : 1;
  const confident = !sectionResolutionFailed && coverage >= minCoverage;

  return { confident, coverage, sectionResolutionFailed };
}
