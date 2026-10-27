/**
 * atlasFacultyIndex.ts — pure helpers for resolving ATLAS faculty identity.
 *
 * The ATLAS `/faculty` directory is the primary source, but it can be
 * unavailable (e.g. 403 SCHOOL_SCOPE_REQUIRED). The published schedule carries
 * the same join keys (`faculty.externalId` / `faculty.employeeId`) on every
 * entry, so it is a safe read-only fallback for building the same index.
 *
 * Keep this file free of Prisma/network imports so the resolution rules are
 * unit-testable without touching the database.
 */
import type { AtlasPublishedScheduleEntry } from '../schemas/atlasSchedule';

export interface AtlasFacultyIdentity {
  atlasId: number | null;
  externalId: string | null;
  employeeId: string | null;
  contactInfo: string | null;
  name: string | null;
}

export interface SmartTeacherIdentity {
  id: string;
  employeeId: string;
  email: string | null;
}

export interface EnrollProTeacherIdentity {
  id: number | string;
  employeeId: string;
}

export interface AtlasFacultyIndexValues {
  /** ATLAS surrogate faculty id -> SMART Teacher.id. */
  byAtlasId: Map<number, string>;
  /** ATLAS faculty.externalId (EnrollPro teacher record id) -> SMART Teacher.id. */
  byExternalId: Map<number, string>;
  /** Employee-id string -> SMART Teacher.id. */
  byEmployeeId: Map<string, string>;
}

export interface AtlasFacultyIndexResult {
  index: AtlasFacultyIndexValues;
  matched: number;
  matchedByExternalId: number;
  matchedByEmployeeId: number;
  matchedByEmail: number;
}

function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  return email.toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Extract one candidate per ATLAS faculty surrogate id from published schedule
 * entries. Placeholder assignments are not real people and are skipped.
 */
export function collectPublishedFacultyCandidates(
  entries: AtlasPublishedScheduleEntry[],
): AtlasFacultyIdentity[] {
  const byAtlasId = new Map<number, AtlasFacultyIdentity>();
  for (const entry of entries) {
    if (entry.isPlaceholder) continue;
    const atlasId = entry.faculty.atlasId;
    if (atlasId == null || byAtlasId.has(atlasId)) continue;
    byAtlasId.set(atlasId, {
      atlasId,
      externalId: entry.faculty.externalId,
      employeeId: entry.faculty.employeeId,
      contactInfo: null,
      name: entry.faculty.name,
    });
  }
  return [...byAtlasId.values()];
}

/**
 * Resolve ATLAS faculty identities to SMART teachers. Precedence matches the
 * existing sync contract: externalId (EnrollPro teacher record id) ->
 * employeeId -> email. Only resolved identities are indexed.
 */
export function buildAtlasFacultyIndex(
  identities: AtlasFacultyIdentity[],
  smartTeachers: SmartTeacherIdentity[],
  enrollProTeachers: EnrollProTeacherIdentity[],
): AtlasFacultyIndexResult {
  const byEmployeeId = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const teacher of smartTeachers) {
    const employeeId = String(teacher.employeeId ?? '').trim();
    if (employeeId) byEmployeeId.set(employeeId, teacher.id);
    const email = normalizeEmail(teacher.email);
    if (email) byEmail.set(email, teacher.id);
  }

  const byAtlasId = new Map<number, string>();
  const byExternalId = new Map<number, string>();
  let matched = 0;
  let matchedByExternalId = 0;
  let matchedByEmployeeId = 0;
  let matchedByEmail = 0;

  for (const identity of identities) {
    const externalId = Number(identity.externalId ?? NaN);
    const externalMatch = Number.isFinite(externalId)
      ? enrollProTeachers.find((teacher) => Number(teacher.id) === externalId)
      : undefined;
    const externalTeacherId = externalMatch?.employeeId
      ? byEmployeeId.get(String(externalMatch.employeeId).trim())
      : undefined;
    const directEmployeeId = identity.employeeId
      ? byEmployeeId.get(String(identity.employeeId).trim())
      : undefined;
    const emailMatch = normalizeEmail(identity.contactInfo)
      ? byEmail.get(normalizeEmail(identity.contactInfo))
      : undefined;

    const smartTeacherId = externalTeacherId ?? directEmployeeId ?? emailMatch;
    if (!smartTeacherId) continue;

    if (identity.atlasId != null) byAtlasId.set(identity.atlasId, smartTeacherId);
    if (Number.isFinite(externalId)) byExternalId.set(externalId, smartTeacherId);
    matched++;
    if (externalTeacherId) matchedByExternalId++;
    else if (directEmployeeId) matchedByEmployeeId++;
    else if (emailMatch) matchedByEmail++;
  }

  return {
    index: { byAtlasId, byExternalId, byEmployeeId },
    matched,
    matchedByExternalId,
    matchedByEmployeeId,
    matchedByEmail,
  };
}
