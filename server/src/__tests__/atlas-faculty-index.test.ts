import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAtlasFacultyIndex,
  collectPublishedFacultyCandidates,
  type AtlasFacultyIdentity,
  type EnrollProTeacherIdentity,
  type SmartTeacherIdentity,
} from '../lib/atlasFacultyIndex';
import { resolveAtlasFacultyIndex } from '../lib/atlasFacultyFallback';
import { fetchAtlasPublishedTerm } from '../lib/atlasScheduleSync';
import type { AtlasPublishedPayload, AtlasPublishedScheduleEntry } from '../schemas/atlasSchedule';

vi.mock('../lib/atlasScheduleSync', () => ({
  fetchAtlasPublishedTerm: vi.fn(),
}));

const mockedFetchPublished = vi.mocked(fetchAtlasPublishedTerm);

function makeEntry(
  overrides: Partial<AtlasPublishedScheduleEntry> = {},
): AtlasPublishedScheduleEntry {
  return {
    entryId: 'entry-1',
    day: 'MONDAY',
    startTime: '08:00',
    endTime: '08:45',
    durationMinutes: 45,
    termIndex: 1,
    isPlaceholder: false,
    faculty: {
      atlasId: 39,
      externalId: '72',
      employeeId: '1000011',
      name: 'VALDEZ, GABRIELA LUZ',
    },
    subject: { atlasId: 4, code: 'AP', name: 'Araling Panlipunan' },
    section: { atlasId: 1350, externalId: 143, name: 'Aguinaldo', gradeLevelName: 'Grade 7' },
    room: { atlasId: 65, name: 'G10 Room 101', buildingName: 'Grade 10 Academic Wing', floor: '1', type: 'CLASSROOM' },
    ...overrides,
  };
}

const smartTeachers: SmartTeacherIdentity[] = [
  { id: 'smart-1', employeeId: '1000011', email: 'gab@example.com' },
  { id: 'smart-2', employeeId: '1000022', email: 'other@example.com' },
];

const enrollProTeachers: EnrollProTeacherIdentity[] = [
  { id: 72, employeeId: '1000011' },
  { id: 99, employeeId: '1000022' },
];

describe('collectPublishedFacultyCandidates', () => {
  it('dedupes by atlasId, skips placeholders and rows without an atlas id', () => {
    const candidates = collectPublishedFacultyCandidates([
      makeEntry(),
      makeEntry({ entryId: 'entry-2' }),
      makeEntry({ entryId: 'entry-3', isPlaceholder: true, faculty: { atlasId: 40, externalId: '99', employeeId: '1000022', name: 'X' } }),
      makeEntry({ entryId: 'entry-4', faculty: { atlasId: null, externalId: '1', employeeId: null, name: 'No Atlas Id' } }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      atlasId: 39,
      externalId: '72',
      employeeId: '1000011',
      contactInfo: null,
      name: 'VALDEZ, GABRIELA LUZ',
    });
  });
});

describe('buildAtlasFacultyIndex', () => {
  it('resolves via externalId -> EnrollPro teacher id -> employeeId', () => {
    const result = buildAtlasFacultyIndex(
      [
        { atlasId: 39, externalId: '72', employeeId: null, contactInfo: null, name: 'Externally linked' },
        { atlasId: 40, externalId: null, employeeId: '1000022', contactInfo: null, name: 'Employee linked' },
        { atlasId: 41, externalId: null, employeeId: null, contactInfo: 'GAB@example.com', name: 'Email linked' },
      ],
      smartTeachers,
      enrollProTeachers,
    );

    expect(result.matched).toBe(3);
    expect(result.matchedByExternalId).toBe(1);
    expect(result.matchedByEmployeeId).toBe(1);
    expect(result.matchedByEmail).toBe(1);
    expect(result.index.byAtlasId.get(39)).toBe('smart-1');
    expect(result.index.byAtlasId.get(40)).toBe('smart-2');
    expect(result.index.byAtlasId.get(41)).toBe('smart-1');
    expect(result.index.byExternalId.get(72)).toBe('smart-1');
  });

  it('prefers externalId over a conflicting employeeId', () => {
    const result = buildAtlasFacultyIndex(
      [{ atlasId: 39, externalId: '72', employeeId: '1000022', contactInfo: null, name: 'Conflict' }],
      smartTeachers,
      enrollProTeachers,
    );

    expect(result.index.byAtlasId.get(39)).toBe('smart-1');
    expect(result.matchedByExternalId).toBe(1);
  });

  it('ignores unresolved identities and keeps the full employee lookup', () => {
    const result = buildAtlasFacultyIndex(
      [
        { atlasId: 39, externalId: '404', employeeId: null, contactInfo: null, name: 'Unknown external' },
        { atlasId: 40, externalId: null, employeeId: null, contactInfo: 'nobody@example.com', name: 'Unknown email' },
      ],
      smartTeachers,
      enrollProTeachers,
    );

    expect(result.matched).toBe(0);
    expect(result.index.byAtlasId.size).toBe(0);
    expect(result.index.byExternalId.size).toBe(0);
    expect(result.index.byEmployeeId.size).toBe(2);
  });

  it('resolves every published candidate in the fallback shape', () => {
    const identities: AtlasFacultyIdentity[] = collectPublishedFacultyCandidates([
      makeEntry(),
      makeEntry({
        entryId: 'entry-2',
        faculty: { atlasId: 40, externalId: '99', employeeId: null, name: 'BAUTISTA, CLARISSE JOY' },
      }),
    ]);

    const result = buildAtlasFacultyIndex(identities, smartTeachers, enrollProTeachers);
    expect(result.matched).toBe(2);
    expect(result.index.byAtlasId.get(39)).toBe('smart-1');
    expect(result.index.byAtlasId.get(40)).toBe('smart-2');
  });
});

describe('resolveAtlasFacultyIndex', () => {
  const publishedPayload = {
    entries: [
      makeEntry(),
      makeEntry({
        entryId: 'entry-2',
        faculty: { atlasId: 40, externalId: '99', employeeId: null, name: 'BAUTISTA, CLARISSE JOY' },
      }),
    ],
    source: {},
    timeSlots: [],
    specialEvents: [],
    invalidEntries: 0,
  } as unknown as AtlasPublishedPayload;

  beforeEach(() => {
    mockedFetchPublished.mockReset();
  });

  it('falls back to the published schedule when the directory is empty', async () => {
    mockedFetchPublished.mockResolvedValue(publishedPayload);

    const result = await resolveAtlasFacultyIndex({
      atlasFaculty: [],
      smartTeachers,
      enrollProTeachers,
      atlasSchoolYearId: 5,
    });

    expect(mockedFetchPublished).toHaveBeenCalledWith(5, 'active');
    expect(result.source).toBe('published-schedule');
    expect(result.matched).toBe(2);
    expect(result.candidates).toBe(2);
    expect(result.prefetchedActivePayload).toBe(publishedPayload);
    expect(result.errors).toEqual([]);
  });

  it('does not call the fallback when the directory is available', async () => {
    const result = await resolveAtlasFacultyIndex({
      atlasFaculty: [
        { id: 39, externalId: '72', employeeId: null, contactInfo: null, name: 'Directory row' },
      ],
      smartTeachers,
      enrollProTeachers,
      atlasSchoolYearId: 5,
    });

    expect(mockedFetchPublished).not.toHaveBeenCalled();
    expect(result.source).toBe('directory');
    expect(result.matched).toBe(1);
  });

  it('returns a non-fatal error when both sources are unavailable', async () => {
    mockedFetchPublished.mockRejectedValue(new Error('HTTP 403 SCHOOL_SCOPE_REQUIRED'));

    const result = await resolveAtlasFacultyIndex({
      atlasFaculty: [],
      smartTeachers,
      enrollProTeachers,
      atlasSchoolYearId: 5,
    });

    expect(result.source).toBe('none');
    expect(result.matched).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('published-schedule fallback failed');
  });
});
