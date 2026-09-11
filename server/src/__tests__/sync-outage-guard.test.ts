/**
 * sync-outage-guard.test.ts — Fail-closed guard tests for destructive sync steps.
 *
 * Covers the 2026-09-10 incident class (docs/SYNC_OUTAGE_GUARDRAIL_FIX_PLAN.md):
 *   - §5.2 ATLAS stale-check resolution-confidence + ratio breaker
 *   - §5.3 EnrollPro deactivation ratio breaker (via guard helpers)
 *   - §5.4 dropStaleEnrollments empty-roster guard
 *
 * These are unit tests — no network, no live EP/ATLAS required. The single DB
 * helper test mocks Prisma so it never touches the shared dev database.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isConfidentData,
  exceedsRatio,
  computeResolutionConfidence,
  MIN_RESOLUTION_COVERAGE,
  MAX_ARCHIVE_RATIO,
  MAX_DEACTIVATION_RATIO,
} from '../lib/syncGuard';

const { mockFindMany, mockUpdateMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    enrollment: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
    },
  },
}));

import { dropStaleEnrollments } from '../lib/sync/utils';

// ---------------------------------------------------------------------------
// isConfidentData
// ---------------------------------------------------------------------------

describe('isConfidentData', () => {
  it('treats 0 as not confident', () => {
    expect(isConfidentData(0)).toBe(false);
  });

  it('treats any positive count as confident', () => {
    expect(isConfidentData(1)).toBe(true);
    expect(isConfidentData(265)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exceedsRatio
// ---------------------------------------------------------------------------

describe('exceedsRatio', () => {
  it('does not trip at exactly the threshold (strictly greater than)', () => {
    expect(exceedsRatio(5, 10, MAX_ARCHIVE_RATIO)).toBe(false);
  });

  it('trips above the threshold', () => {
    expect(exceedsRatio(6, 10, MAX_ARCHIVE_RATIO)).toBe(true);
  });

  it('trips on the incident-scale wipe (257 of 257)', () => {
    expect(exceedsRatio(257, 257, MAX_ARCHIVE_RATIO)).toBe(true);
  });

  it('never trips when there is nothing to destroy relative to', () => {
    expect(exceedsRatio(0, 0, MAX_ARCHIVE_RATIO)).toBe(false);
    expect(exceedsRatio(5, 0, MAX_ARCHIVE_RATIO)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeResolutionConfidence — the ATLAS fail-closed gate (B1)
// ---------------------------------------------------------------------------

describe('computeResolutionConfidence (ATLAS stale-check gate)', () => {
  it('INCIDENT: POPULATED load + no EP sections -> NOT confident', () => {
    // 265 assignments, EnrollPro down, zero resolved.
    const c = computeResolutionConfidence({
      state: 'POPULATED',
      resolvedCount: 0,
      totalAssignments: 265,
      epSectionsAvailable: false,
    });
    expect(c.confident).toBe(false);
    expect(c.sectionResolutionFailed).toBe(true);
    expect(c.coverage).toBe(0);
  });

  it('POPULATED load + EP sections present but zero resolved -> NOT confident', () => {
    const c = computeResolutionConfidence({
      state: 'POPULATED',
      resolvedCount: 0,
      totalAssignments: 265,
      epSectionsAvailable: true,
    });
    expect(c.confident).toBe(false);
    expect(c.sectionResolutionFailed).toBe(true);
  });

  it('POPULATED load with partial coverage below threshold -> NOT confident', () => {
    const c = computeResolutionConfidence({
      state: 'POPULATED',
      resolvedCount: 200,
      totalAssignments: 265,
      epSectionsAvailable: true,
    });
    expect(c.coverage).toBeCloseTo(200 / 265, 5);
    expect(c.confident).toBe(false);
  });

  it('POPULATED load at exactly the coverage threshold -> confident', () => {
    const c = computeResolutionConfidence({
      state: 'POPULATED',
      resolvedCount: 9,
      totalAssignments: 10,
      epSectionsAvailable: true,
    });
    expect(c.coverage).toBe(MIN_RESOLUTION_COVERAGE);
    expect(c.confident).toBe(true);
  });

  it('POPULATED load fully resolved -> confident (anti-regression)', () => {
    const c = computeResolutionConfidence({
      state: 'POPULATED',
      resolvedCount: 265,
      totalAssignments: 265,
      epSectionsAvailable: true,
    });
    expect(c.confident).toBe(true);
    expect(c.coverage).toBe(1);
    expect(c.sectionResolutionFailed).toBe(false);
  });

  it('EMPTY state is not gated here (has its own two-cycle guard)', () => {
    const c = computeResolutionConfidence({
      state: 'EMPTY',
      resolvedCount: 0,
      totalAssignments: 0,
      epSectionsAvailable: false,
    });
    expect(c.confident).toBe(true);
    expect(c.sectionResolutionFailed).toBe(false);
  });

  it('UNAVAILABLE / REJECTED are not gated here', () => {
    for (const state of ['UNAVAILABLE', 'REJECTED']) {
      const c = computeResolutionConfidence({
        state,
        resolvedCount: 0,
        totalAssignments: 0,
        epSectionsAvailable: false,
      });
      expect(c.confident).toBe(true);
    }
  });

  it('honours a custom coverage threshold', () => {
    const c = computeResolutionConfidence({
      state: 'POPULATED',
      resolvedCount: 7,
      totalAssignments: 10,
      epSectionsAvailable: true,
      minCoverage: 0.7,
    });
    expect(c.coverage).toBe(0.7);
    expect(c.confident).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deactivation ratio (B4) — same helper used by EnrollProSync
// ---------------------------------------------------------------------------

describe('teacher deactivation ratio breaker', () => {
  it('allows a small, plausible deactivation', () => {
    expect(exceedsRatio(2, 42, MAX_DEACTIVATION_RATIO)).toBe(false);
  });

  it('trips on a partial EP faculty response (30 of 40)', () => {
    expect(exceedsRatio(30, 40, MAX_DEACTIVATION_RATIO)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dropStaleEnrollments empty-roster guard (B5)
// ---------------------------------------------------------------------------

describe('dropStaleEnrollments (empty-roster guard)', () => {
  it('returns 0 and touches nothing when the fresh roster is empty', async () => {
    mockFindMany.mockReset();
    mockUpdateMany.mockReset();

    const dropped = await dropStaleEnrollments('section-1', '2030-2031', []);

    expect(dropped).toBe(0);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('still drops genuinely stale enrollments (anti-regression)', async () => {
    mockFindMany.mockReset();
    mockUpdateMany.mockReset();
    mockFindMany.mockResolvedValue([
      { id: 'e1', student: { lrn: 'LRN-STALE' } },
      { id: 'e2', student: { lrn: 'LRN-KEEP' } },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const dropped = await dropStaleEnrollments('section-1', '2030-2031', [{ lrn: 'LRN-KEEP' }]);

    expect(dropped).toBe(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1'] } },
      data: { status: 'DROPPED' },
    });
  });
});
