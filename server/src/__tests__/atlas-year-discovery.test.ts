/**
 * atlas-year-discovery.test.ts — ordered ATLAS active-year probe candidates.
 *
 * Guards the 2026-09-17 rollover incident: when /runtime/context is unavailable,
 * SMART discovers the active year by probing /faculty-assignments/effective and
 * only accepts a payload whose scope validation confirms
 * isActiveSchoolYear=true. These tests pin the candidate order and coverage:
 *   - last known applied year is probed first (restart / rollover recovery)
 *   - forward scan finds the normal next year
 *   - env year is still covered (stale or mis-pinned config)
 *   - backward scan covers renumbered year spaces
 *   - no id is probed twice
 */

import { describe, it, expect } from 'vitest';
import { buildAtlasYearProbeCandidates } from '../lib/sync/httpClient';

describe('ATLAS active-year discovery candidates', () => {
  it('starts at the env year when nothing has been discovered yet, then scans forward', () => {
    expect(buildAtlasYearProbeCandidates(3, null, 4)).toEqual([3, 4, 5, 6, 7, 2, 1]);
  });

  it('probes the last known/applied year first (rollover recovery)', () => {
    const candidates = buildAtlasYearProbeCandidates(3, 10, 2);
    expect(candidates[0]).toBe(10);
    expect(candidates).toContain(11);
  });

  it('covers the gap between seed and env on the backward pass', () => {
    expect(buildAtlasYearProbeCandidates(3, 10, 2)).toEqual([10, 11, 12, 3, 9, 8, 7, 6, 5, 4, 2, 1]);
  });

  it('covers a future-pinned env year via the backward scan', () => {
    const candidates = buildAtlasYearProbeCandidates(12, null, 1);
    expect(candidates[0]).toBe(12);
    expect(candidates).toContain(11);
    expect(candidates).toContain(1);
  });

  it('falls back to year 1 when the env year is invalid', () => {
    expect(buildAtlasYearProbeCandidates(Number.NaN, null, 2)).toEqual([1, 2, 3]);
  });

  it('ignores an invalid seed year and starts from env', () => {
    expect(buildAtlasYearProbeCandidates(5, Number.NaN, 2)).toEqual([5, 6, 7, 4, 3, 2, 1]);
  });

  it('never emits duplicates when seed equals env', () => {
    const candidates = buildAtlasYearProbeCandidates(10, 10, 2);
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates[0]).toBe(10);
    expect(candidates).toContain(12);
    expect(candidates).toContain(9);
  });
});
