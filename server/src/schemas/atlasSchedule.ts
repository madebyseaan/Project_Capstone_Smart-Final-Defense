/**
 * atlasSchedule.ts — Zod schemas and normalizers for the ATLAS term-aware
 * published-schedule read contract and the §8A draft-schedule read family.
 *
 * Contract pin: ATLAS release 70a51608 (2026-09-24).
 *
 * Key contract points enforced here:
 *  - `termIndex` is mandatory on every read (1..4 or 'active'); omitting it
 *    resolves to the ACTIVE term, never "all terms" (§3).
 *  - `source.orderedTerms` is the term-label authority (§4.1) — never a
 *    hardcoded "Term 1/2/3" list.
 *  - `specialEvents[]` rows have exactly {eventName, startTime, endTime,
 *    dayOfWeek, days} — there is NO `eventType` field (§4.4). Duplicate windows
 *    (two "Lunch Break" rows) are real data and must never be de-duplicated.
 *  - `entries[].room.id` is an ATLAS surrogate, not an upstream room id (§4.3).
 *  - `faculty.externalId` / `faculty.employeeId` are the join keys; `isPlaceholder`
 *    marks a non-real assignment (§4.2).
 *
 * @see docs/ATLAS-TERM-AWARE-SCHEDULE-HANDOFF-2026-09-24.md
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Term selectors
// ---------------------------------------------------------------------------

/** MAX_ACADEMIC_TERM_INDEX (QUARTER_TERM_COUNT = 4) per §3. */
export const ATLAS_MAX_TERM_INDEX = 4;

export type AtlasTermSelector = number | 'active';

/** Accepts 1..4 or the literal 'active'; rejects anything else (§5 INVALID_TERM_INDEX). */
export function parseTermSelector(raw: unknown): AtlasTermSelector | null {
  if (raw === 'active') return 'active';
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= ATLAS_MAX_TERM_INDEX) return n;
  return null;
}

// ---------------------------------------------------------------------------
// §4.1 source block
// ---------------------------------------------------------------------------

export interface AtlasOrderedTerm {
  order: number;
  identity: string;
  displayLabel: string;
}

const atlasOrderedTermSchema = z.object({
  order: z.number().int(),
  identity: z.string().catch(''),
  displayLabel: z.string().catch(''),
});

export interface AtlasPublishedSource {
  runId: number | null;
  schoolId: number | null;
  schoolYearId: number | null;
  schoolYearLabel: string | null;
  isActiveSchoolYear: boolean | null;
  isHistorical: boolean | null;
  publishedAt: string | null;
  generatedAt: string | null;
  requestedDate: string | null;
  resolvedForDate: string | null;
  activeRevisionId: number | null;
  activeRevisionEffectiveDate: string | null;
  appliedRevisionIds: number[];
  revisionMarker: string | null;
  snapshotState: string | null;
  snapshotGaps: string[];
  termScope: string | null;
  termIndex: number | null;
  activeTermVerified: boolean | null;
  orderedTerms: AtlasOrderedTerm[];
}

const nullableString = z.string().nullable().catch(null);
const nullableInt = z.number().int().nullable().catch(null);
const nullableBool = z.boolean().nullable().catch(null);

const atlasPublishedSourceSchema = z.object({
  runId: nullableInt,
  schoolId: nullableInt,
  schoolYearId: nullableInt,
  schoolYearLabel: nullableString,
  isActiveSchoolYear: nullableBool,
  isHistorical: nullableBool,
  publishedAt: nullableString,
  generatedAt: nullableString,
  requestedDate: nullableString,
  resolvedForDate: nullableString,
  activeRevisionId: nullableInt,
  activeRevisionEffectiveDate: nullableString,
  appliedRevisionIds: z.array(z.number().int()).catch([]),
  revisionMarker: nullableString,
  snapshotState: nullableString,
  snapshotGaps: z.array(z.string()).catch([]),
  termScope: nullableString,
  termIndex: nullableInt,
  activeTermVerified: nullableBool,
  orderedTerms: z.array(atlasOrderedTermSchema).catch([]),
});

// ---------------------------------------------------------------------------
// §4.2 schedule entries
// ---------------------------------------------------------------------------

export interface AtlasPublishedScheduleEntry {
  entryId: string | null;
  day: string;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
  /** Per-row term membership — a multi-term consumer filters client-side (§4.2). */
  termIndex: number | null;
  /** Marks a non-real assignment; never present a placeholder as a person (§4.2). */
  isPlaceholder: boolean;
  faculty: {
    atlasId: number | null;
    /** Join key — EnrollPro-side faculty id (preferred, §7.3). */
    externalId: string | null;
    /** Join key — employee number (preferred, §7.3). */
    employeeId: string | null;
    name: string | null;
  };
  subject: { atlasId: number | null; code: string | null; name: string | null };
  section: {
    atlasId: number | null;
    /** Upstream (EnrollPro) section id (§4.2). */
    externalId: number | null;
    name: string | null;
    gradeLevelName: string | null;
  };
  /** Nested room object; `atlasId` is the ATLAS Room.id surrogate (§4.3). */
  room: {
    atlasId: number | null;
    name: string | null;
    buildingName: string | null;
    floor: string | null;
    type: string | null;
  };
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function normalizeEntry(raw: any): AtlasPublishedScheduleEntry | null {
  const day = str(raw?.day);
  const startTime = str(raw?.startTime);
  const endTime = str(raw?.endTime);
  if (!day || !startTime || !endTime) return null;

  const faculty = raw?.faculty ?? {};
  const subject = raw?.subject ?? {};
  const section = raw?.section ?? {};
  const room = raw?.room ?? {};

  return {
    entryId: str(raw?.entryId),
    day: day.toUpperCase(),
    startTime,
    endTime,
    durationMinutes: num(raw?.durationMinutes),
    termIndex: num(raw?.termIndex),
    isPlaceholder: faculty?.isPlaceholder === true || raw?.isPlaceholder === true,
    faculty: {
      atlasId: num(faculty?.id ?? faculty?.atlasId ?? raw?.facultyId),
      externalId: str(faculty?.externalId),
      employeeId: str(faculty?.employeeId),
      name: str(faculty?.name),
    },
    subject: {
      atlasId: num(subject?.id ?? raw?.subjectId),
      code: str(subject?.code ?? raw?.subjectCode),
      name: str(subject?.name),
    },
    section: {
      atlasId: num(section?.atlasId),
      externalId: num(section?.externalId ?? section?.id ?? raw?.sectionId),
      name: str(section?.name ?? raw?.sectionName),
      gradeLevelName: str(section?.gradeLevelName ?? section?.gradeLevel),
    },
    room: {
      atlasId: num(room?.id ?? raw?.roomId),
      name: str(room?.name),
      buildingName: str(room?.buildingName),
      floor: str(room?.floor),
      type: str(room?.type),
    },
  };
}

// ---------------------------------------------------------------------------
// §4.3/§4.4 time slots + special events
// ---------------------------------------------------------------------------

export interface AtlasTimeSlot {
  startTime: string;
  endTime: string;
}

/**
 * §4.4: exactly these fields — there is NO `eventType`. `dayOfWeek: null` with a
 * five-day `days` list is the school-wide case; a day-scoped event carries a
 * concrete `dayOfWeek` and a single-entry `days`.
 */
export interface AtlasSpecialEvent {
  eventName: string;
  startTime: string;
  endTime: string;
  dayOfWeek: string | null;
  days: string[];
  /** Term the window was read under (SMART-added; not an ATLAS field). */
  termIndex: number | null;
}

const atlasSpecialEventSchema = z.object({
  eventName: z.string().catch(''),
  startTime: z.string().catch(''),
  endTime: z.string().catch(''),
  dayOfWeek: z.string().nullable().catch(null),
  days: z.array(z.string()).catch([]),
});

// ---------------------------------------------------------------------------
// Published payload normalizer
// ---------------------------------------------------------------------------

export interface AtlasPublishedPayload {
  source: AtlasPublishedSource;
  timeSlots: AtlasTimeSlot[];
  /** Verbatim union — duplicate windows preserved (§4.4: NOT duplicates). */
  specialEvents: AtlasSpecialEvent[];
  entries: AtlasPublishedScheduleEntry[];
  invalidEntries: number;
}

export function normalizeAtlasPublishedPayload(raw: unknown): AtlasPublishedPayload {
  const data = (raw ?? {}) as Record<string, any>;

  const sourceParsed = atlasPublishedSourceSchema.safeParse(data.source ?? {});
  const source: AtlasPublishedSource = sourceParsed.success
    ? sourceParsed.data
    : {
        runId: null, schoolId: null, schoolYearId: null, schoolYearLabel: null,
        isActiveSchoolYear: null, isHistorical: null, publishedAt: null, generatedAt: null,
        requestedDate: null, resolvedForDate: null, activeRevisionId: null,
        activeRevisionEffectiveDate: null, appliedRevisionIds: [], revisionMarker: null,
        snapshotState: null, snapshotGaps: [], termScope: null, termIndex: null,
        activeTermVerified: null, orderedTerms: [],
      };

  const timeSlots: AtlasTimeSlot[] = [];
  for (const slot of Array.isArray(data.timeSlots) ? data.timeSlots : []) {
    const startTime = str(slot?.startTime);
    const endTime = str(slot?.endTime);
    if (startTime && endTime) timeSlots.push({ startTime, endTime });
  }

  const specialEvents: AtlasSpecialEvent[] = [];
  for (const evt of Array.isArray(data.specialEvents) ? data.specialEvents : []) {
    const parsed = atlasSpecialEventSchema.safeParse(evt);
    if (!parsed.success) continue;
    const e = parsed.data;
    if (!e.eventName || !e.startTime || !e.endTime) continue;
    specialEvents.push({ ...e, termIndex: source.termIndex });
  }

  const entries: AtlasPublishedScheduleEntry[] = [];
  let invalidEntries = 0;
  for (const raw of Array.isArray(data.entries) ? data.entries : []) {
    const entry = normalizeEntry(raw);
    if (entry) entries.push(entry);
    else invalidEntries++;
  }

  return { source, timeSlots, specialEvents, entries, invalidEntries };
}

// ---------------------------------------------------------------------------
// §8A draft payload
// ---------------------------------------------------------------------------

export interface AtlasDraftSource {
  runId: number | null;
  schoolYearId: number | null;
  isDraft: boolean;
  termScope: string | null;
  termIndex: number | null;
  orderedTerms: AtlasOrderedTerm[];
  runStatus: string | null;
  draftSharedWithTeachers: boolean;
  inputFingerprint: string | null;
  inputStateStatus: string | null;
}

/** §8A: raw draft rows — surrogate ids, NOT the published nested objects. */
export interface AtlasDraftEntry {
  entryId: string | null;
  facultyId: number | null;
  sectionId: number | null;
  subjectId: number | null;
  roomId: number | null;
  day: string;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
  termIndex: number | null;
}

export interface AtlasDraftPayload {
  source: AtlasDraftSource;
  entries: AtlasDraftEntry[];
  /** Always `[]` per §8A — run-wide demand is not attributable to one scope. */
  unassignedItems: unknown[];
  runId: number | null;
  status: string | null;
  version: number | null;
  finishedAt: string | null;
  createdAt: string | null;
}

const atlasDraftSourceSchema = z.object({
  runId: nullableInt,
  schoolYearId: nullableInt,
  isDraft: z.boolean().catch(true),
  termScope: nullableString,
  termIndex: nullableInt,
  orderedTerms: z.array(atlasOrderedTermSchema).catch([]),
  runStatus: nullableString,
  draftSharedWithTeachers: z.boolean().catch(false),
  inputFingerprint: nullableString,
  inputStateStatus: nullableString,
});

export function normalizeAtlasDraftPayload(raw: unknown): AtlasDraftPayload {
  const data = (raw ?? {}) as Record<string, any>;
  const sourceParsed = atlasDraftSourceSchema.safeParse(data.source ?? {});
  const source: AtlasDraftSource = sourceParsed.success
    ? sourceParsed.data
    : {
        runId: null, schoolYearId: null, isDraft: true, termScope: null, termIndex: null,
        orderedTerms: [], runStatus: null, draftSharedWithTeachers: false,
        inputFingerprint: null, inputStateStatus: null,
      };

  const entries: AtlasDraftEntry[] = [];
  for (const row of Array.isArray(data.entries) ? data.entries : []) {
    const day = str(row?.day);
    const startTime = str(row?.startTime);
    const endTime = str(row?.endTime);
    if (!day || !startTime || !endTime) continue;
    entries.push({
      entryId: str(row?.entryId),
      facultyId: num(row?.facultyId),
      sectionId: num(row?.sectionId),
      subjectId: num(row?.subjectId),
      roomId: num(row?.roomId),
      day: day.toUpperCase(),
      startTime,
      endTime,
      durationMinutes: num(row?.durationMinutes),
      termIndex: num(row?.termIndex),
    });
  }

  return {
    source,
    entries,
    unassignedItems: Array.isArray(data.unassignedItems) ? data.unassignedItems : [],
    runId: num(data.runId ?? source.runId),
    status: str(data.status),
    version: num(data.version),
    finishedAt: str(data.finishedAt),
    createdAt: str(data.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Error taxonomy (§5 published + §8A draft)
// ---------------------------------------------------------------------------

export interface AtlasScheduleFailure {
  httpStatus: number;
  code: string;
  message: string;
  /** `details.reason` passthrough (e.g. PUBLISHED_RUN_IS_NOT_A_DRAFT). */
  reason: string | null;
}

/**
 * Maps an HttpError from `atlasGetRaw` onto the contract's error taxonomy.
 * `409 ACTIVE_SCHOOL_YEAR_AMBIGUOUS` means "ask a human which year" — the
 * caller must surface it, never retry (§5).
 */
export function toAtlasScheduleFailure(err: unknown): AtlasScheduleFailure {
  const anyErr = err as { statusCode?: number; code?: string | null; details?: unknown; message?: string };
  const httpStatus = typeof anyErr?.statusCode === 'number' ? anyErr.statusCode : 500;
  const details = (anyErr?.details ?? {}) as Record<string, unknown>;
  const bodyCode = typeof anyErr?.code === 'string' && anyErr.code ? anyErr.code : null;
  const reason = typeof details?.reason === 'string' ? details.reason : null;
  return {
    httpStatus,
    code: bodyCode ?? `HTTP_${httpStatus}`,
    message: typeof anyErr?.message === 'string' ? anyErr.message : String(err),
    reason,
  };
}

export const ATLAS_YEAR_AMBIGUOUS = 'ACTIVE_SCHOOL_YEAR_AMBIGUOUS';
