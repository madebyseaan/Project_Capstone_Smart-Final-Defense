/**
 * atlasFacultyFallback.ts — read-only fallback for the ATLAS faculty directory.
 *
 * Used only when `/faculty?schoolId=` is unavailable. The published schedule
 * already carries each entry's `faculty.atlasId`, `externalId`, and
 * `employeeId`, so SMART can still resolve teaching-load ownership without
 * writing anything to ATLAS.
 */
import { logger } from './logger';
import { fetchAtlasPublishedTerm } from './atlasScheduleSync';
import {
  buildAtlasFacultyIndex,
  collectPublishedFacultyCandidates,
  type AtlasFacultyIdentity,
  type AtlasFacultyIndexValues,
} from './atlasFacultyIndex';
import type { AtlasPublishedPayload } from '../schemas/atlasSchedule';

export interface PublishedFacultyFallback {
  candidates: AtlasFacultyIdentity[];
  activePayload: AtlasPublishedPayload | null;
  error: string | null;
}

export async function loadPublishedFacultyFallback(
  atlasSchoolYearId: number,
): Promise<PublishedFacultyFallback> {
  try {
    const payload = await fetchAtlasPublishedTerm(atlasSchoolYearId, 'active');
    return {
      candidates: collectPublishedFacultyCandidates(payload.entries),
      activePayload: payload,
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[AtlasSync] Published-schedule faculty fallback failed: ${message}`);
    return { candidates: [], activePayload: null, error: message };
  }
}

export interface FacultyResolutionInput {
  atlasFaculty: Array<{
    id?: number | null;
    atlasId?: number | null;
    externalId?: string | null;
    employeeId?: string | null;
    contactInfo?: string | null;
    name?: string | null;
  }>;
  smartTeachers: Array<{ id: string; employeeId: string; email: string | null }>;
  enrollProTeachers: Array<{ id: number | string; employeeId: string }>;
  atlasSchoolYearId: number;
}

export interface FacultyResolutionResult {
  index: AtlasFacultyIndexValues;
  matched: number;
  matchedByExternalId: number;
  matchedByEmployeeId: number;
  matchedByEmail: number;
  source: 'directory' | 'published-schedule' | 'none';
  candidates: number;
  prefetchedActivePayload: AtlasPublishedPayload | null;
  errors: string[];
}

/**
 * Resolve ATLAS faculty identities using the directory when available, then
 * the published schedule as a read-only fallback. Returns the index and any
 * non-fatal errors so the caller can surface them without aborting the cycle.
 */
export async function resolveAtlasFacultyIndex(
  input: FacultyResolutionInput,
): Promise<FacultyResolutionResult> {
  const errors: string[] = [];
  let atlasFaculty = input.atlasFaculty;
  let source: FacultyResolutionResult['source'] = atlasFaculty.length > 0 ? 'directory' : 'none';
  let prefetchedActivePayload: AtlasPublishedPayload | null = null;

  if (atlasFaculty.length === 0) {
    const fallback = await loadPublishedFacultyFallback(input.atlasSchoolYearId);
    if (fallback.candidates.length > 0) {
      atlasFaculty = fallback.candidates.map((candidate) => ({
        id: candidate.atlasId,
        externalId: candidate.externalId,
        employeeId: candidate.employeeId,
        contactInfo: candidate.contactInfo,
        name: candidate.name,
      }));
      prefetchedActivePayload = fallback.activePayload;
      source = 'published-schedule';
      logger.info(
        `[AtlasSync] Faculty directory unavailable; published-schedule fallback found ${fallback.candidates.length} faculty candidate(s)`,
      );
    } else {
      errors.push(
        fallback.error
          ? `Faculty directory unavailable and published-schedule fallback failed: ${fallback.error}`
          : 'Faculty directory unavailable and published schedule contained no faculty identities',
      );
    }
  }

  const identities = atlasFaculty
    .map((faculty) => ({
      atlasId: Number(faculty.id ?? faculty.atlasId),
      externalId: faculty.externalId != null ? String(faculty.externalId) : null,
      employeeId: faculty.employeeId != null ? String(faculty.employeeId) : null,
      contactInfo: faculty.contactInfo != null ? String(faculty.contactInfo) : null,
      name: faculty.name != null ? String(faculty.name) : null,
    }))
    .filter((faculty) => Number.isFinite(faculty.atlasId));

  const resolution = buildAtlasFacultyIndex(
    identities,
    input.smartTeachers,
    input.enrollProTeachers,
  );

  if (source === 'published-schedule' && resolution.matched === 0) {
    errors.push('Faculty directory unavailable and published-schedule fallback resolved 0 teachers');
  }

  return {
    ...resolution,
    source,
    candidates: identities.length,
    prefetchedActivePayload,
    errors,
  };
}
