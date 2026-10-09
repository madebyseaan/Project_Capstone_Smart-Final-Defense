/**
 * atlas-schedule-contract.test.ts — ATLAS term-aware published + §8A draft
 * contract normalization tests (contract pin 70a51608).
 *
 * Pure unit tests for schemas/atlasSchedule.ts and the draft term validator.
 * Fixtures mirror the live payload documented in
 * docs/ATLAS-TERM-AWARE-SCHEDULE-HANDOFF-2026-09-24.md §4.1/§4.2/§4.4/§8A.
 *
 * Acceptance points covered:
 *  - §3  termIndex is 1..4 or 'active'; anything else is INVALID_TERM_INDEX
 *  - §4.2 entries[].termIndex + faculty externalId/employeeId join keys;
 *        isPlaceholder flagged
 *  - §4.3 room.id is an ATLAS surrogate (kept as atlasId, never an upstream id)
 *  - §4.4 specialEvents have NO eventType field; duplicate windows survive
 *        normalization (two "Lunch Break" rows are NOT merged)
 *  - §7.2 revisionMarker / activeRevisionId reach the caller verbatim
 *  - §8A draft rows are raw surrogate ids; unassignedItems always []
 */

import { describe, it, expect } from 'vitest';
import {
  parseTermSelector,
  normalizeAtlasPublishedPayload,
  normalizeAtlasDraftPayload,
  toAtlasScheduleFailure,
  ATLAS_YEAR_AMBIGUOUS,
} from '../schemas/atlasSchedule';
import { validateDraftTermSelection } from '../lib/atlasDraftSchedule';
import { HttpError } from '../lib/sync/httpClient';

// ---------------------------------------------------------------------------
// Fixtures (from the pinned live payload, run 315 / revision 42)
// ---------------------------------------------------------------------------

function liveSource(overrides: Record<string, unknown> = {}) {
  return {
    runId: 315,
    schoolId: 1,
    schoolYearId: 10,
    schoolYearLabel: '2031-2032',
    isActiveSchoolYear: true,
    isHistorical: false,
    publishedAt: '2026-09-18T05:38:27.923Z',
    generatedAt: '2026-09-18T05:35:28.968Z',
    requestedDate: null,
    resolvedForDate: '2026-09-22T12:54:32.337Z',
    activeRevisionId: 42,
    activeRevisionEffectiveDate: '2026-09-18T05:38:27.923Z',
    appliedRevisionIds: [42],
    revisionMarker: 'run=315|published=2026-09-18T05:38:27.923Z|revision=42|effective=2026-09-18T05:38:27.923Z|date=2026-09-22',
    snapshotState: 'FROZEN',
    snapshotGaps: [],
    termScope: 'active',
    termIndex: 1,
    activeTermVerified: true,
    orderedTerms: [
      { order: 1, identity: 'T1', displayLabel: 'TERM 1' },
      { order: 2, identity: 'T2', displayLabel: 'TERM 2' },
      { order: 3, identity: 'T3', displayLabel: 'TERM 3' },
    ],
    ...overrides,
  };
}

function liveEntry(overrides: Record<string, unknown> = {}) {
  return {
    entryId: 'entry-1::t1',
    day: 'THURSDAY',
    startTime: '06:00',
    endTime: '06:45',
    durationMinutes: 45,
    termIndex: 1,
    subject: { id: 4, code: 'AP', name: 'Araling Panlipunan' },
    section: {
      atlasId: 1350,
      externalId: 143,
      id: 143,
      name: 'Aguinaldo',
      gradeLevel: 17,
      gradeLevelName: 'Grade 7',
      programType: 'REGULAR',
      programCode: 'REGULAR',
      programName: 'Regular',
    },
    faculty: {
      atlasId: 39,
      externalId: '72',
      employeeId: '1000011',
      id: 39,
      name: 'VALDEZ, GABRIELA LUZ',
      isPlaceholder: false,
    },
    room: {
      id: 65,
      name: 'G10 Room 101',
      type: 'CLASSROOM',
      floor: '1',
      buildingId: 4,
      buildingName: 'Grade 10 Academic Wing',
    },
    entryKind: 'SECTION',
    cohortCode: null,
    cohortName: null,
    specializationCode: null,
    specializationLabel: null,
    ...overrides,
  };
}

// §4.4 live special events: two Lunch Break windows, two Health Break windows,
// one flag ceremony — 5 rows total, NO `eventType` field.
function liveSpecialEvents() {
  return [
    {
      eventName: 'Lunch Break', startTime: '11:30', endTime: '12:15', dayOfWeek: null,
      days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    },
    {
      eventName: 'Lunch Break', startTime: '12:15', endTime: '13:00', dayOfWeek: null,
      days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    },
    {
      eventName: 'Health Break', startTime: '09:00', endTime: '09:15', dayOfWeek: null,
      days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    },
    {
      eventName: 'Health Break', startTime: '15:15', endTime: '15:30', dayOfWeek: null,
      days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    },
    {
      eventName: 'Flag Ceremony', startTime: '07:00', endTime: '07:30', dayOfWeek: 'MONDAY',
      days: ['MONDAY'],
    },
  ];
}

// ---------------------------------------------------------------------------
// Term selectors (§3)
// ---------------------------------------------------------------------------

describe('parseTermSelector (contract §3)', () => {
  it('accepts 1..4 and "active"', () => {
    expect(parseTermSelector(1)).toBe(1);
    expect(parseTermSelector('2')).toBe(2);
    expect(parseTermSelector(4)).toBe(4);
    expect(parseTermSelector('active')).toBe('active');
  });

  it('rejects 0, 5, "abc" and empty (INVALID_TERM_INDEX family)', () => {
    expect(parseTermSelector(0)).toBeNull();
    expect(parseTermSelector(5)).toBeNull();
    expect(parseTermSelector('abc')).toBeNull();
    expect(parseTermSelector(undefined)).toBeNull();
    expect(parseTermSelector(null)).toBeNull();
    expect(parseTermSelector(1.5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Published payload normalization (§4.1/§4.2/§4.3/§4.4)
// ---------------------------------------------------------------------------

describe('normalizeAtlasPublishedPayload', () => {
  const payload = normalizeAtlasPublishedPayload({
    source: liveSource(),
    timeSlots: [
      { startTime: '06:00', endTime: '06:45' },
      { startTime: '06:45', endTime: '07:30' },
    ],
    specialEvents: liveSpecialEvents(),
    entries: [liveEntry()],
  });

  it('keeps the source block including revisionMarker and orderedTerms (§7.2)', () => {
    expect(payload.source.revisionMarker).toContain('revision=42');
    expect(payload.source.activeRevisionId).toBe(42);
    expect(payload.source.appliedRevisionIds).toEqual([42]);
    expect(payload.source.snapshotState).toBe('FROZEN');
    expect(payload.source.orderedTerms.map(t => t.displayLabel)).toEqual(['TERM 1', 'TERM 2', 'TERM 3']);
  });

  it('normalizes entries with per-row termIndex and both faculty join keys (§4.2/§7.3)', () => {
    expect(payload.entries).toHaveLength(1);
    const entry = payload.entries[0];
    expect(entry.termIndex).toBe(1);
    expect(entry.isPlaceholder).toBe(false);
    expect(entry.faculty.externalId).toBe('72');
    expect(entry.faculty.employeeId).toBe('1000011');
    expect(entry.faculty.atlasId).toBe(39);
  });

  it('keeps room.id as the ATLAS surrogate (§4.3) alongside its human label', () => {
    const entry = payload.entries[0];
    expect(entry.room.atlasId).toBe(65);
    expect(entry.room.name).toBe('G10 Room 101');
    expect(entry.room.buildingName).toBe('Grade 10 Academic Wing');
  });

  it('keeps section.externalId as the upstream id, atlasId as the surrogate (§4.2/§4.3)', () => {
    const entry = payload.entries[0];
    expect(entry.section.externalId).toBe(143);
    expect(entry.section.atlasId).toBe(1350);
    expect(entry.section.name).toBe('Aguinaldo');
  });

  it('preserves duplicate special-event windows (§4.4 — NOT duplicates)', () => {
    expect(payload.specialEvents).toHaveLength(5);
    const lunches = payload.specialEvents.filter(e => e.eventName === 'Lunch Break');
    expect(lunches.map(e => `${e.startTime}-${e.endTime}`).sort()).toEqual(['11:30-12:15', '12:15-13:00']);
    const health = payload.specialEvents.filter(e => e.eventName === 'Health Break');
    expect(health).toHaveLength(2);
  });

  it('does not require an eventType field on specialEvents (§4.4)', () => {
    const withoutType = normalizeAtlasPublishedPayload({
      source: liveSource({ termIndex: 1 }),
      specialEvents: liveSpecialEvents(),
      entries: [],
    });
    expect(withoutType.specialEvents).toHaveLength(5);
    expect(withoutType.specialEvents[0]).not.toHaveProperty('eventType');
    // termIndex is stamped from the source block for per-term rendering
    expect(withoutType.specialEvents.every(e => e.termIndex === 1)).toBe(true);
  });

  it('flags placeholder faculty (§4.2) and skips malformed entries', () => {
    const withFlags = normalizeAtlasPublishedPayload({
      source: liveSource(),
      entries: [
        liveEntry(),
        liveEntry({ faculty: { id: 40, isPlaceholder: true, name: 'TBD' } }),
        { day: 'MONDAY' }, // malformed — no times
      ],
    });
    expect(withFlags.entries).toHaveLength(2);
    expect(withFlags.entries[1].isPlaceholder).toBe(true);
    expect(withFlags.invalidEntries).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Error taxonomy (§5 / §8A)
// ---------------------------------------------------------------------------

describe('toAtlasScheduleFailure', () => {
  it('maps ACTIVE_SCHOOL_YEAR_AMBIGUOUS with its code (§5 — ask a human)', () => {
    const failure = toAtlasScheduleFailure(
      new HttpError(409, 'HTTP 409', ATLAS_YEAR_AMBIGUOUS),
    );
    expect(failure.httpStatus).toBe(409);
    expect(failure.code).toBe(ATLAS_YEAR_AMBIGUOUS);
  });

  it('passes through details.reason (e.g. PUBLISHED_RUN_IS_NOT_A_DRAFT)', () => {
    const failure = toAtlasScheduleFailure(
      new HttpError(404, 'HTTP 404', 'DRAFT_RUN_NOT_FOUND', { reason: 'PUBLISHED_RUN_IS_NOT_A_DRAFT' }),
    );
    expect(failure.code).toBe('DRAFT_RUN_NOT_FOUND');
    expect(failure.reason).toBe('PUBLISHED_RUN_IS_NOT_A_DRAFT');
  });

  it('falls back to HTTP_<status> when the body carries no code', () => {
    const failure = toAtlasScheduleFailure(new HttpError(502, 'boom'));
    expect(failure.code).toBe('HTTP_502');
    expect(failure.reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §8A draft payload + term validation
// ---------------------------------------------------------------------------

describe('normalizeAtlasDraftPayload (§8A)', () => {
  const draft = normalizeAtlasDraftPayload({
    source: {
      runId: 77,
      schoolYearId: 10,
      isDraft: true,
      termScope: '1',
      termIndex: 1,
      orderedTerms: [{ order: 1, identity: 'T1', displayLabel: 'TERM 1' }],
      runStatus: 'COMPLETED',
      draftSharedWithTeachers: true,
      inputFingerprint: 'abc123',
      inputStateStatus: 'FROZEN',
    },
    entries: [
      {
        entryId: 'draft-1',
        facultyId: 39,
        sectionId: 1350,
        subjectId: 4,
        roomId: 65,
        day: 'MONDAY',
        startTime: '07:30',
        endTime: '08:15',
        durationMinutes: 45,
        termIndex: 1,
      },
    ],
    unassignedItems: [{ foo: 'bar' }],
  });

  it('keeps raw surrogate ids (no nested names) per the raw draft entry shape', () => {
    const entry = draft.entries[0];
    expect(entry.sectionId).toBe(1350);
    expect(entry.subjectId).toBe(4);
    expect(entry.roomId).toBe(65);
    expect(entry.termIndex).toBe(1);
    expect(entry).not.toHaveProperty('section');
    expect(entry).not.toHaveProperty('subject');
    expect(entry).not.toHaveProperty('room');
  });

  it('exposes the §8A source fields used by the SMART draft view', () => {
    expect(draft.source.isDraft).toBe(true);
    expect(draft.source.draftSharedWithTeachers).toBe(true);
    expect(draft.source.runStatus).toBe('COMPLETED');
    expect(draft.source.inputFingerprint).toBe('abc123');
    expect(draft.runId).toBe(77);
    expect(draft.entries).toHaveLength(1);
    // unassignedItems pass through (always [] in the producer; never synthesized)
    expect(draft.unassignedItems).toHaveLength(1);
  });

  it('defaults draftSharedWithTeachers to false when absent', () => {
    const bare = normalizeAtlasDraftPayload({ entries: [] });
    expect(bare.source.draftSharedWithTeachers).toBe(false);
    expect(bare.unassignedItems).toEqual([]);
  });
});

describe('validateDraftTermSelection (§8A term scoping)', () => {
  const trimester = [
    { order: 1, identity: 'T1', displayLabel: 'TERM 1' },
    { order: 2, identity: 'T2', displayLabel: 'TERM 2' },
    { order: 3, identity: 'T3', displayLabel: 'TERM 3' },
  ];

  it('requires an explicit term', () => {
    const result = validateDraftTermSelection(undefined, trimester);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TERM_INDEX_REQUIRED');
  });

  it('rejects malformed indexes', () => {
    const result = validateDraftTermSelection('abc', trimester);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_TERM_INDEX');
  });

  it('rejects indexes outside the verified ordered-term contract', () => {
    const result = validateDraftTermSelection(4, trimester);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TERM_INDEX_OUTSIDE_CONTRACT');
  });

  it('accepts "active" and in-contract indexes', () => {
    expect(validateDraftTermSelection('active', trimester)).toEqual({ ok: true, term: 'active' });
    expect(validateDraftTermSelection(2, trimester)).toEqual({ ok: true, term: 2 });
    // No contract known yet (first run) — ATLAS validates instead
    expect(validateDraftTermSelection(4, [])).toEqual({ ok: true, term: 4 });
  });
});
