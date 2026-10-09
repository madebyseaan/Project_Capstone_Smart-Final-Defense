/**
 * atlasDraftSchedule.ts — ATLAS §8A draft-schedule reads (contract pin 70a51608).
 *
 * Companions can read a teacher's DRAFT (not-yet-published) schedule through a
 * read-only family that is never public and is gated by a per-run sharing switch
 * (default OFF). Contract rules honored here:
 *
 *  - D3 ("Never expose whole-school drafts"): only the param-scoped
 *    `faculty-external` read exists on SMART's side, and it always resolves to
 *    the CALLER's own teacher. There is no whole-run/whole-school draft read.
 *  - `termIndex` is mandatory and always sent explicitly (§8A term scoping).
 *  - Reads use the ATLAS system token (`Authorization: Bearer ATLAS_SYSTEM_TOKEN`)
 *    — the sharing toggle itself is JWT-only and is NOT implemented here.
 *  - Draft rows are RAW (surrogate ids, no nested names); human labels are
 *    resolved from SMART's AtlasCrosswalk (written from published reads).
 *  - Error taxonomy is mapped, not swallowed: `403 DRAFT_SHARING_DISABLED` is an
 *    expected state ("not shared yet"), `404 DRAFT_RUN_NOT_FOUND` is
 *    "no draft", and everything else surfaces with its contract code.
 *
 * @see docs/ATLAS-TERM-AWARE-SCHEDULE-HANDOFF-2026-09-24.md §8A
 */
import { prisma } from './prisma';
import { logger } from './logger';
import {
  atlasGet,
  atlasGetRaw,
  ATLAS_SCHOOL_ID,
  resolveAtlasSchoolYear,
} from './sync/httpClient';
import { getCachedAtlasFaculty, setCachedAtlasFaculty } from './syncCache';
import { resolveCrosswalkLabels } from './atlasScheduleSync';
import {
  normalizeAtlasDraftPayload,
  toAtlasScheduleFailure,
  parseTermSelector,
  type AtlasDraftEntry,
  type AtlasDraftPayload,
  type AtlasOrderedTerm,
  type AtlasTermSelector,
} from '../schemas/atlasSchedule';

// ---------------------------------------------------------------------------
// Outcomes — the SMART-facing draft states (never a silent empty grid)
// ---------------------------------------------------------------------------

export interface DraftEntryView extends AtlasDraftEntry {
  subjectLabel: string | null;
  sectionLabel: string | null;
  roomLabel: string | null;
  facultyLabel: string | null;
  unmapped: string[];
}

export interface DraftSharedResult {
  status: 'shared';
  termIndex: number | null;
  termScope: string | null;
  terms: AtlasOrderedTerm[];
  runId: number | null;
  runStatus: string | null;
  draftSharedWithTeachers: boolean;
  inputFingerprint: string | null;
  inputStateStatus: string | null;
  entries: DraftEntryView[];
  /** Always [] per contract — run-wide demand is not scope-attributable. */
  unassignedItems: unknown[];
  finishedAt: string | null;
  createdAt: string | null;
}

export type DraftReadResult =
  | DraftSharedResult
  | { status: 'not_shared'; reason: string | null }
  | { status: 'unavailable'; reason: string | null }
  | { status: 'error'; code: string; httpStatus: number; message: string };

// ---------------------------------------------------------------------------
// Faculty identity resolution (SMART Teacher -> ATLAS external faculty id)
// ---------------------------------------------------------------------------

export interface AtlasFacultyRef {
  /** The id to send as `:externalFacultyId` (ATLAS faculty.externalId preferred). */
  externalId: string;
  /** `externalId` | `employeeId` — which join key was used (§7.3). */
  via: 'externalId' | 'employeeId';
}

async function loadAtlasFaculty(): Promise<any[]> {
  const cached = getCachedAtlasFaculty();
  if (cached && cached.length > 0) return cached;
  try {
    const data = await atlasGet(`/faculty?schoolId=${ATLAS_SCHOOL_ID}`);
    const faculty: any[] = data?.faculty ?? [];
    if (faculty.length > 0) setCachedAtlasFaculty(faculty);
    return faculty;
  } catch (err: any) {
    logger.warn(`[AtlasDraft] Faculty fetch failed: ${err.message}`);
    return [];
  }
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').toLowerCase().trim();
}

/**
 * Resolve a SMART teacher to ATLAS faculty id candidates.
 * Primary key is `faculty.externalId` (§7.3); `faculty.employeeId` is the
 * fallback join key. Both are tried on `404 FACULTY_NOT_FOUND`.
 */
export async function resolveAtlasFacultyRefs(teacher: {
  id: string;
  employeeId: string;
  email?: string | null;
}): Promise<AtlasFacultyRef[]> {
  const faculty = await loadAtlasFaculty();
  const employeeId = String(teacher.employeeId ?? '').trim();
  const email = normalizeEmail(teacher.email);

  const match = faculty.find((af: any) => {
    const afEmployee = String(af?.employeeId ?? '').trim();
    if (employeeId && afEmployee && afEmployee === employeeId) return true;
    if (email && normalizeEmail(af?.contactInfo) === email) return true;
    return false;
  });

  const refs: AtlasFacultyRef[] = [];
  const push = (value: unknown, via: 'externalId' | 'employeeId') => {
    const id = String(value ?? '').trim();
    if (id && !refs.some(r => r.externalId === id)) refs.push({ externalId: id, via });
  };

  if (match) {
    push(match.externalId, 'externalId');
    push(match.employeeId, 'employeeId');
    push(match.id, 'employeeId');
  }
  if (refs.length === 0 && employeeId) push(employeeId, 'employeeId');

  return refs;
}

// ---------------------------------------------------------------------------
// Draft read (§8A)
// ---------------------------------------------------------------------------

interface FetchDraftParams {
  schoolYearLabel: string;
  /** ATLAS school year id; explicit on the path — no active-year election. */
  atlasSchoolYearId: number;
  /** Faculty id candidates (`faculty.externalId` first, §7.3). */
  facultyRefs: AtlasFacultyRef[];
  termIndex: AtlasTermSelector;
}

async function fetchDraftOnce(
  atlasSchoolYearId: number,
  externalFacultyId: string,
  termIndex: AtlasTermSelector,
): Promise<{ ok: true; payload: AtlasDraftPayload } | { ok: false; failure: ReturnType<typeof toAtlasScheduleFailure> }> {
  try {
    const raw = await atlasGetRaw(
      `/schools/${ATLAS_SCHOOL_ID}/school-years/${atlasSchoolYearId}/schedules/draft/faculty-external/${encodeURIComponent(externalFacultyId)}?termIndex=${termIndex}`,
    );
    return { ok: true, payload: normalizeAtlasDraftPayload(raw) };
  } catch (err: unknown) {
    return { ok: false, failure: toAtlasScheduleFailure(err) };
  }
}

function isFacultyNotFound(failure: ReturnType<typeof toAtlasScheduleFailure>): boolean {
  return failure.httpStatus === 404 && (failure.code === 'FACULTY_NOT_FOUND' || failure.code === 'HTTP_404');
}

function isSharingDisabled(failure: ReturnType<typeof toAtlasScheduleFailure>): boolean {
  return failure.httpStatus === 403 && failure.code === 'DRAFT_SHARING_DISABLED';
}

async function withLabels(
  schoolYearLabel: string,
  payload: AtlasDraftPayload,
): Promise<DraftEntryView[]> {
  const refs = payload.entries.flatMap(e => [
    { kind: 'SUBJECT', atlasId: e.subjectId },
    { kind: 'SECTION', atlasId: e.sectionId },
    { kind: 'ROOM', atlasId: e.roomId },
    { kind: 'FACULTY', atlasId: e.facultyId },
  ]);
  let labels: Map<string, { label: string; detail: string | null; smartId: string | null }>;
  try {
    labels = await resolveCrosswalkLabels(schoolYearLabel, refs);
  } catch {
    labels = new Map();
  }

  return payload.entries.map(e => {
    const subject = e.subjectId != null ? labels.get(`SUBJECT:${e.subjectId}`) : undefined;
    const section = e.sectionId != null ? labels.get(`SECTION:${e.sectionId}`) : undefined;
    const room = e.roomId != null ? labels.get(`ROOM:${e.roomId}`) : undefined;
    const faculty = e.facultyId != null ? labels.get(`FACULTY:${e.facultyId}`) : undefined;
    const unmapped: string[] = [];
    if (e.subjectId != null && !subject) unmapped.push(`subject ${e.subjectId}`);
    if (e.sectionId != null && !section) unmapped.push(`section ${e.sectionId}`);
    if (e.roomId != null && !room) unmapped.push(`room ${e.roomId}`);
    return {
      ...e,
      subjectLabel: subject?.label ?? null,
      sectionLabel: section?.label ?? null,
      roomLabel: room?.label ?? null,
      facultyLabel: faculty?.label ?? null,
      unmapped,
    };
  });
}

/**
 * Read one teacher's shared draft schedule for an explicit term.
 * Fail-closed mapping of the §8A error taxonomy — see DraftReadResult.
 */
export async function fetchTeacherDraftSchedule(params: FetchDraftParams): Promise<DraftReadResult> {
  const { schoolYearLabel, atlasSchoolYearId, facultyRefs, termIndex } = params;

  let lastFailure: ReturnType<typeof toAtlasScheduleFailure> | null = null;
  for (const ref of facultyRefs) {
    const outcome = await fetchDraftOnce(atlasSchoolYearId, ref.externalId, termIndex);
    if (outcome.ok) {
      const payload = outcome.payload;
      return {
        status: 'shared',
        termIndex: payload.source.termIndex,
        termScope: payload.source.termScope,
        terms: payload.source.orderedTerms,
        runId: payload.runId,
        runStatus: payload.source.runStatus ?? payload.status,
        draftSharedWithTeachers: payload.source.draftSharedWithTeachers,
        inputFingerprint: payload.source.inputFingerprint,
        inputStateStatus: payload.source.inputStateStatus,
        entries: await withLabels(schoolYearLabel, payload),
        unassignedItems: payload.unassignedItems,
        finishedAt: payload.finishedAt,
        createdAt: payload.createdAt,
      };
    }

    lastFailure = outcome.failure;

    // Expected states resolve immediately — no candidate hopping.
    if (isSharingDisabled(lastFailure)) {
      return { status: 'not_shared', reason: lastFailure.reason ?? lastFailure.code };
    }
    if (lastFailure.httpStatus === 404 && lastFailure.code === 'DRAFT_RUN_NOT_FOUND') {
      return { status: 'unavailable', reason: lastFailure.reason };
    }
    if (isFacultyNotFound(lastFailure)) {
      continue; // try the next join key (§7.3)
    }
    break; // anything else is terminal
  }

  const failure = lastFailure;
  if (!failure) {
    return { status: 'error', code: 'FACULTY_NOT_FOUND', httpStatus: 404, message: 'No ATLAS faculty identity resolved for this teacher' };
  }
  if (isFacultyNotFound(failure)) {
    return { status: 'error', code: 'FACULTY_NOT_FOUND', httpStatus: 404, message: failure.message };
  }
  return {
    status: 'error',
    code: failure.code,
    httpStatus: failure.httpStatus,
    message: failure.message,
  };
}

// ---------------------------------------------------------------------------
// Year + term resolution for the draft route
// ---------------------------------------------------------------------------

/**
 * ATLAS school year id for a SMART school-year label. The published sync
 * asserts ATLAS mirrors EnrollPro's numeric year id, so the persisted ids are
 * preferred over a fresh active-year election (the draft path is explicit —
 * there is no ACTIVE_SCHOOL_YEAR_AMBIGUOUS on this family).
 */
export async function resolveAtlasSchoolYearIdForLabel(schoolYearLabel: string): Promise<number | null> {
  try {
    const meta = await prisma.atlasScheduleMeta.findUnique({
      where: { schoolYear: schoolYearLabel },
      select: { source: true },
    });
    const metaYearId = Number((meta?.source as any)?.schoolYearId);
    if (Number.isFinite(metaYearId) && metaYearId > 0) return metaYearId;
  } catch { /* fall through */ }

  try {
    const row = await prisma.schoolYear.findUnique({
      where: { label: schoolYearLabel },
      select: { externalId: true },
    });
    if (row?.externalId != null && row.externalId > 0) return row.externalId;
  } catch { /* fall through */ }

  try {
    const resolved = await resolveAtlasSchoolYear();
    return resolved.id > 0 ? resolved.id : null;
  } catch (err: any) {
    logger.warn(`[AtlasDraft] ATLAS school year resolution failed: ${err.message}`);
    return null;
  }
}

/**
 * Ordered-term contract from the last published read (label authority §4.1).
 * Used to reject out-of-contract indexes before calling ATLAS
 * (`400 TERM_INDEX_OUTSIDE_CONTRACT`).
 */
export async function getOrderedTermContract(schoolYearLabel: string): Promise<AtlasOrderedTerm[]> {
  try {
    const meta = await prisma.atlasScheduleMeta.findUnique({
      where: { schoolYear: schoolYearLabel },
      select: { terms: true },
    });
    const rows: any[] = Array.isArray(meta?.terms) ? (meta?.terms as any[]) : [];
    return rows
      .filter(r => Number.isFinite(Number(r?.termIndex)))
      .map(r => ({
        order: Number(r.order ?? r.termIndex),
        identity: String(r.identity ?? r.termIndex),
        displayLabel: String(r.displayLabel ?? `TERM ${r.termIndex}`),
      }));
  } catch {
    return [];
  }
}

/**
 * SMART-side term validation mirroring the contract codes:
 *  - missing            -> TERM_INDEX_REQUIRED
 *  - malformed          -> INVALID_TERM_INDEX
 *  - outside the verified ordered-term contract -> TERM_INDEX_OUTSIDE_CONTRACT
 */
export function validateDraftTermSelection(
  rawTerm: unknown,
  orderedTerms: AtlasOrderedTerm[],
): { ok: true; term: AtlasTermSelector } | { ok: false; code: string; message: string } {
  if (rawTerm === undefined || rawTerm === null || rawTerm === '') {
    return { ok: false, code: 'TERM_INDEX_REQUIRED', message: 'termIndex is required (1..4 or "active")' };
  }
  const term = parseTermSelector(rawTerm);
  if (term === null) {
    return { ok: false, code: 'INVALID_TERM_INDEX', message: `termIndex must be 1..4 or "active", got "${String(rawTerm)}"` };
  }
  if (term !== 'active' && orderedTerms.length > 0 && !orderedTerms.some(t => t.order === term)) {
    return {
      ok: false,
      code: 'TERM_INDEX_OUTSIDE_CONTRACT',
      message: `termIndex ${term} is outside the verified term contract (${orderedTerms.map(t => t.identity).join('/')})`,
    };
  }
  return { ok: true, term };
}
