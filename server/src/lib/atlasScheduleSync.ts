/**
 * atlasScheduleSync.ts — ATLAS term-aware published-schedule sync.
 *
 * Fetches the published schedule per explicit term (contract pin 70a51608) and
 * persists it as ScheduleEntry rows plus companion contract state:
 *  - AtlasCrosswalk  — ATLAS surrogate-id map (§4.3 room crosswalk, §8A draft labels)
 *  - AtlasScheduleMeta — `source` block: orderedTerms, revisionMarker /
 *    activeRevisionId (change detection), snapshotState/snapshotGaps, and the
 *    verbatim specialEvents[]/timeSlots[] used to render break bands.
 *
 * Contract points honored here (see docs/ATLAS-TERM-AWARE-SCHEDULE-HANDOFF-2026-09-24.md):
 *  - §3  `termIndex` is always explicit on every read; never an implicit
 *        "all terms" read. The term list comes from `source.orderedTerms`.
 *  - §4.2 `isPlaceholder` faculty rows are never stored as people.
 *  - §4.3 rooms are keyed by ATLAS `room.id`; the human label (name +
 *        buildingName) comes from the nested `entry.room` object and is kept in
 *        the crosswalk. A raw surrogate id is never presented as a room number.
 *  - §4.4 duplicate special-event windows (two "Lunch Break" rows) are real data
 *        and are stored verbatim — never de-duplicated, never invented.
 *  - §7.2 `revisionMarker` is persisted; the ScheduleEntry rewrite is skipped
 *        when the revision identity and per-term entry counts are unchanged.
 *  - §5  `409 ACTIVE_SCHOOL_YEAR_AMBIGUOUS` is surfaced as a conflict state —
 *        "ask a human which year", never a blind retry.
 */
import { type GradeLevel, AuditAction, AuditSeverity } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { createAuditLog } from './audit';
import { atlasGet, ATLAS_SCHOOL_ID } from './sync/httpClient';
import {
  mapGradeLevel,
  resolveSubjectCode,
  resolveSubjectName,
  inferSubjectTypeFromCode,
} from './atlasUtils';
import { computeDisplayName } from './subjectDisplay';
import {
  normalizeAtlasPublishedPayload,
  toAtlasScheduleFailure,
  ATLAS_YEAR_AMBIGUOUS,
  type AtlasPublishedPayload,
  type AtlasPublishedScheduleEntry,
  type AtlasSpecialEvent,
  type AtlasOrderedTerm,
  type AtlasTimeSlot,
  type AtlasTermSelector,
} from '../schemas/atlasSchedule';

// ---------------------------------------------------------------------------
// Sync state (consumed by getSyncStatus / admin health)
// ---------------------------------------------------------------------------

export interface AtlasScheduleSyncState {
  activeTermIndex: number | null;
  orderedTerms: Array<{ order: number; identity: string; displayLabel: string }>;
  terms: Array<{ termIndex: number; displayLabel: string | null; revisionMarker: string | null; entries: number }>;
  snapshotGaps: string[];
  snapshotState: string | null;
  revisionMarker: string | null;
  conflict: string | null;
}

let lastScheduleSync: AtlasScheduleSyncState | null = null;

export function getAtlasScheduleSyncState(): AtlasScheduleSyncState | null {
  if (!lastScheduleSync) return null;
  return {
    ...lastScheduleSync,
    orderedTerms: lastScheduleSync.orderedTerms.map(t => ({ ...t })),
    terms: lastScheduleSync.terms.map(t => ({ ...t })),
    snapshotGaps: [...lastScheduleSync.snapshotGaps],
  };
}

// ---------------------------------------------------------------------------
// Fetch (contract §2/§3: whole-school published read, always explicit termIndex)
// ---------------------------------------------------------------------------

export async function fetchAtlasPublishedTerm(
  atlasSchoolYearId: number,
  term: AtlasTermSelector,
): Promise<AtlasPublishedPayload> {
  const data = await atlasGet(
    `/schools/${ATLAS_SCHOOL_ID}/school-years/${atlasSchoolYearId}/schedules/published?termIndex=${term}`,
  );
  return normalizeAtlasPublishedPayload(data);
}

// ---------------------------------------------------------------------------
// Faculty resolution (contract §7.3: join on externalId/employeeId first)
// ---------------------------------------------------------------------------

export interface AtlasFacultyIndex {
  /** ATLAS surrogate faculty id -> SMART Teacher.id (fallback key). */
  byAtlasId: Map<number, string>;
  /** ATLAS faculty.externalId -> SMART Teacher.id (preferred key). */
  byExternalId: Map<number, string>;
  /** Employee-id string -> SMART Teacher.id (preferred key). */
  byEmployeeId: Map<string, string>;
}

export function resolveSmartTeacherId(
  entry: Pick<AtlasPublishedScheduleEntry, 'faculty'>,
  index: AtlasFacultyIndex,
): string | undefined {
  const employeeId = entry.faculty.employeeId?.trim();
  if (employeeId) {
    const byEmployee = index.byEmployeeId.get(employeeId);
    if (byEmployee) return byEmployee;
  }

  const externalId = entry.faculty.externalId != null ? Number(entry.faculty.externalId) : NaN;
  if (Number.isFinite(externalId)) {
    const byExternal = index.byExternalId.get(externalId);
    if (byExternal) return byExternal;
  }

  return entry.faculty.atlasId != null ? index.byAtlasId.get(entry.faculty.atlasId) : undefined;
}

// ---------------------------------------------------------------------------
// Crosswalk (contract §4.3 + §8A label mapping)
// ---------------------------------------------------------------------------

type CrosswalkRow = {
  kind: string;
  atlasId: number;
  label: string;
  detail: string | null;
  smartId: string | null;
};

async function persistCrosswalk(
  schoolYearLabel: string,
  entries: AtlasPublishedScheduleEntry[],
  resolveSectionId: (name: string, gradeLevel: GradeLevel) => string | null,
  resolveSubjectId: (code: string, gradeLevel: GradeLevel) => string | null,
  facultyIndex: AtlasFacultyIndex,
): Promise<void> {
  const rows = new Map<string, CrosswalkRow>();
  const put = (row: CrosswalkRow) => {
    if (!Number.isFinite(row.atlasId) || !row.label) return;
    rows.set(`${row.kind}:${row.atlasId}`, row);
  };

  for (const entry of entries) {
    const gradeLevel = mapGradeLevel(entry.section.gradeLevelName ?? entry.section.name ?? '');

    if (entry.room.atlasId != null && entry.room.name) {
      put({
        kind: 'ROOM',
        atlasId: entry.room.atlasId,
        label: entry.room.name,
        detail: entry.room.buildingName,
        smartId: null,
      });
    }
    if (entry.section.atlasId != null && entry.section.name) {
      put({
        kind: 'SECTION',
        atlasId: entry.section.atlasId,
        label: entry.section.name,
        detail: entry.section.gradeLevelName,
        smartId: gradeLevel ? resolveSectionId(entry.section.name, gradeLevel) : null,
      });
    }
    if (entry.subject.atlasId != null && (entry.subject.name || entry.subject.code)) {
      const code = entry.subject.code ?? '';
      put({
        kind: 'SUBJECT',
        atlasId: entry.subject.atlasId,
        label: entry.subject.name ?? code,
        detail: code,
        smartId: gradeLevel && code ? resolveSubjectId(code, gradeLevel) : null,
      });
    }
    if (entry.faculty.atlasId != null && (entry.faculty.name || entry.faculty.employeeId)) {
      put({
        kind: 'FACULTY',
        atlasId: entry.faculty.atlasId,
        label: entry.faculty.name ?? entry.faculty.employeeId ?? 'Unknown',
        detail: entry.faculty.employeeId,
        smartId: resolveSmartTeacherId(entry, facultyIndex) ?? null,
      });
    }
  }

  if (rows.size === 0) return;

  try {
    await prisma.$transaction(
      Array.from(rows.values()).map(row =>
        prisma.atlasCrosswalk.upsert({
          where: {
            kind_atlasId_schoolYear: {
              kind: row.kind,
              atlasId: row.atlasId,
              schoolYear: schoolYearLabel,
            },
          },
          update: { label: row.label, detail: row.detail, smartId: row.smartId },
          create: {
            kind: row.kind,
            atlasId: row.atlasId,
            schoolYear: schoolYearLabel,
            label: row.label,
            detail: row.detail,
            smartId: row.smartId,
          },
        }),
      ),
    );
  } catch (err: any) {
    logger.warn(`[AtlasSync] Crosswalk upsert failed: ${err.message}`);
  }
}

/**
 * Resolve raw surrogate ids to human labels via the crosswalk. Used by the §8A
 * draft read (draft rows carry only surrogate ids, no nested names).
 */
export async function resolveCrosswalkLabels(
  schoolYearLabel: string,
  refs: Array<{ kind: string; atlasId: number | null }>,
): Promise<Map<string, { label: string; detail: string | null; smartId: string | null }>> {
  const out = new Map<string, { label: string; detail: string | null; smartId: string | null }>();
  const ids = Array.from(
    new Set(refs.filter(r => r.atlasId != null && Number.isFinite(r.atlasId)).map(r => r.atlasId as number)),
  );
  const kinds = Array.from(new Set(refs.map(r => r.kind)));
  if (ids.length === 0 || kinds.length === 0) return out;

  const rows = await prisma.atlasCrosswalk.findMany({
    where: { schoolYear: schoolYearLabel, kind: { in: kinds }, atlasId: { in: ids } },
    select: { kind: true, atlasId: true, label: true, detail: true, smartId: true },
  });
  for (const row of rows) {
    out.set(`${row.kind}:${row.atlasId}`, { label: row.label, detail: row.detail, smartId: row.smartId });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ScheduleEntry persistence (timetable truth — NOT ownership)
// ---------------------------------------------------------------------------

interface PersistParams {
  schoolYearLabel: string;
  terms: Array<{ termIndex: number | null; entries: AtlasPublishedScheduleEntry[] }>;
  epSectionById: Map<number, any>;
  sectionByKey: Map<string, any>;
  subjectByCode: Map<string, any>;
  facultyIndex: AtlasFacultyIndex;
}

async function persistScheduleEntries(params: PersistParams): Promise<void> {
  const { schoolYearLabel, terms, epSectionById, sectionByKey, subjectByCode, facultyIndex } = params;

  const epSectionByName = new Map<string, any>();
  for (const [, s] of epSectionById) {
    if (s?.name) epSectionByName.set(s.name.trim().toLowerCase(), s);
  }

  const allScheduleEntries: Array<{
    teacherId: string; subjectCode: string; sectionName: string;
    gradeLevel: GradeLevel; day: string; startTime: string; endTime: string; roomId: number | null;
    termIndex: number | null;
  }> = [];
  let totalPubEntries = 0;
  let skippedNoSubject = 0;
  let skippedNoSection = 0;
  let skippedNoFaculty = 0;

  for (const term of terms) {
    totalPubEntries += term.entries.length;
    for (const entry of term.entries) {
      if (entry.isPlaceholder) continue;

      const smartTeacherId = resolveSmartTeacherId(entry, facultyIndex);
      if (!smartTeacherId) { skippedNoFaculty++; continue; }

      const subjectCode = (entry.subject.code ?? '').trim().toUpperCase();
      if (!subjectCode) { skippedNoSubject++; continue; }

      // Upstream section id (EnrollPro) first; name fallback is allowed here
      // because the timetable is not an ownership path.
      const sectionId = entry.section.externalId;
      let epSection = sectionId != null ? epSectionById.get(sectionId) : undefined;
      if (!epSection?.name && entry.section.name) {
        epSection = epSectionByName.get(entry.section.name.trim().toLowerCase()) ?? null;
      }
      if (!epSection?.name) { skippedNoSection++; continue; }

      const gradeLevelRaw = epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name;
      const gradeLevel = mapGradeLevel(gradeLevelRaw);
      if (!gradeLevel) continue;

      const entryTermIndex = entry.termIndex;
      allScheduleEntries.push({
        teacherId: smartTeacherId,
        subjectCode,
        sectionName: epSection.name,
        gradeLevel,
        day: entry.day,
        startTime: entry.startTime,
        endTime: entry.endTime,
        roomId: entry.room.atlasId,
        termIndex: entryTermIndex != null && Number.isFinite(entryTermIndex) ? entryTermIndex : term.termIndex,
      });
    }
  }

  const hgScheduleSkipped = allScheduleEntries.filter(e => e.subjectCode.toUpperCase().startsWith('HG')).length;
  const filteredScheduleEntries = allScheduleEntries.filter(e => !e.subjectCode.toUpperCase().startsWith('HG'));
  if (hgScheduleSkipped > 0) logger.info(`[AtlasSync] Skipped ${hgScheduleSkipped} HG schedule entries`);

  if (filteredScheduleEntries.length === 0) {
    if (totalPubEntries > 0) {
      console.log(
        `[AtlasSync] Schedule diag: totalPub=${totalPubEntries}, terms=${terms.map(t => `${t.termIndex}:${t.entries.length}`).join('|')}, skippedNoSubject=${skippedNoSubject}, skippedNoSection=${skippedNoSection}, skippedNoFaculty=${skippedNoFaculty}, resolved=0`,
      );
    } else {
      console.log('[AtlasSync] Schedule diag: no published schedule entries found from ATLAS');
    }
    return;
  }

  let scheduleCreated = 0;
  let scheduleCleaned = 0;
  const teacherIdsWithSchedule = new Set(filteredScheduleEntries.map(e => e.teacherId));

  // A class that repeats identically across terms (year-long subjects) collapses
  // onto one row: store termIndex=null so it is treated as term-agnostic.
  const classKeyOf = (e: (typeof filteredScheduleEntries)[number]) =>
    `${e.teacherId}:${e.subjectCode}:${e.gradeLevel}:${e.sectionName.trim()}:${e.day}:${e.startTime}`;
  const termIndexesByClassKey = new Map<string, Set<number | null>>();
  for (const entry of filteredScheduleEntries) {
    const key = classKeyOf(entry);
    const termSet = termIndexesByClassKey.get(key) ?? new Set<number | null>();
    termSet.add(entry.termIndex);
    termIndexesByClassKey.set(key, termSet);
  }
  const writtenClassKeys = new Set<string>();

  const existingEntries = await prisma.scheduleEntry.findMany({
    where: { teacherId: { in: Array.from(teacherIdsWithSchedule) }, schoolYear: schoolYearLabel },
    select: { id: true, teacherId: true, subjectId: true, sectionId: true, day: true, startTime: true, termIndex: true },
  });
  const existingByKey = new Map(
    existingEntries.map(e => [`${e.teacherId}:${e.subjectId}:${e.sectionId}:${e.day}:${e.startTime}`, e]),
  );

  for (const entry of filteredScheduleEntries) {
    const classKey = classKeyOf(entry);
    if (writtenClassKeys.has(classKey)) continue;
    writtenClassKeys.add(classKey);
    const termIndexes = termIndexesByClassKey.get(classKey);
    const storedTermIndex = termIndexes && termIndexes.size > 1 ? null : entry.termIndex;

    const smartSubjectCode = resolveSubjectCode(entry.subjectCode, entry.gradeLevel);
    let subject = subjectByCode.get(smartSubjectCode);
    if (!subject) {
      try {
        const autoName = resolveSubjectName(smartSubjectCode, entry.gradeLevel);
        subject = await prisma.subject.upsert({
          where: { code: smartSubjectCode },
          update: {},
          create: {
            code: smartSubjectCode,
            name: autoName,
            displayName: computeDisplayName(smartSubjectCode, autoName),
            type: inferSubjectTypeFromCode(smartSubjectCode),
          },
        });
        subjectByCode.set(smartSubjectCode, subject);
      } catch { continue; }
    }
    if (!subject) continue;

    const section = sectionByKey.get(`${entry.sectionName.trim()}:${entry.gradeLevel}`);
    if (!section) continue;

    const dedupKey = `${entry.teacherId}:${subject.id}:${section.id}:${entry.day}:${entry.startTime}`;
    const existing = existingByKey.get(dedupKey);
    if (existing) {
      existingByKey.delete(dedupKey);
      if (existing.termIndex === storedTermIndex) continue;
      try {
        await prisma.scheduleEntry.update({
          where: { id: existing.id },
          data: { termIndex: storedTermIndex, endTime: entry.endTime, roomId: entry.roomId },
        });
        scheduleCreated++;
      } catch (err: any) {
        logger.warn(`[AtlasSync] Schedule entry term update failed: ${err.message}`);
      }
      continue;
    }

    try {
      await prisma.scheduleEntry.upsert({
        where: {
          teacherId_subjectId_sectionId_schoolYear_day_startTime: {
            teacherId: entry.teacherId, subjectId: subject.id,
            sectionId: section.id, schoolYear: schoolYearLabel,
            day: entry.day, startTime: entry.startTime,
          },
        },
        update: { endTime: entry.endTime, roomId: entry.roomId, termIndex: storedTermIndex },
        create: {
          teacherId: entry.teacherId, subjectId: subject.id,
          sectionId: section.id, schoolYear: schoolYearLabel,
          termIndex: storedTermIndex,
          day: entry.day, startTime: entry.startTime,
          endTime: entry.endTime, roomId: entry.roomId,
        },
      });
      scheduleCreated++;
    } catch (err: any) {
      logger.warn(`[AtlasSync] Schedule entry upsert failed: ${err.message}`);
    }
  }

  const staleIds = Array.from(existingByKey.values()).map(e => e.id);
  if (staleIds.length > 0 && epSectionById.size > 0) {
    await prisma.scheduleEntry.deleteMany({ where: { id: { in: staleIds } } });
    scheduleCleaned = staleIds.length;
  } else if (staleIds.length > 0) {
    logger.warn(
      `[AtlasSync] Schedule cleanup skipped — EnrollPro sections unavailable (fail-closed, ${staleIds.length} stale entr(ies) preserved)`,
    );
  }

  if (scheduleCreated > 0 || scheduleCleaned > 0) {
    console.log(`[AtlasSync] Schedule entries: created=${scheduleCreated}, cleaned=${scheduleCleaned}`);
  }
  console.log(
    `[AtlasSync] Schedule diag: totalPub=${totalPubEntries}, terms=${terms.map(t => `${t.termIndex}:${t.entries.length}`).join('|')}, skippedNoSubject=${skippedNoSubject}, skippedNoSection=${skippedNoSection}, skippedNoFaculty=${skippedNoFaculty}, resolved=${allScheduleEntries.length}`,
  );
}

// ---------------------------------------------------------------------------
// Meta persistence + change detection
// ---------------------------------------------------------------------------

interface StoredTermRow {
  termIndex: number;
  order: number | null;
  identity: string | null;
  displayLabel: string | null;
  revisionMarker: string | null;
  revisionId: number | null;
  entries: number;
}

/**
 * Change detection (§7.2): skip the ScheduleEntry rewrite when the revision
 * identity (`activeRevisionId`) and per-term entry counts are unchanged.
 *
 * NOTE: `revisionMarker` embeds a `date=YYYY-MM-DD` segment (the as-of date), so
 * the marker string differs on a new day even with no regeneration. The raw
 * marker is persisted verbatim per the contract, but "unchanged" is decided on
 * revision identity + counts — never on the marker string.
 */
function isScheduleUnchanged(prevTerms: StoredTermRow[], nextTerms: StoredTermRow[]): boolean {
  if (prevTerms.length === 0 || prevTerms.length !== nextTerms.length) return false;
  const prevByTerm = new Map(prevTerms.map(t => [t.termIndex, t]));
  return nextTerms.every(t => {
    const prev = prevByTerm.get(t.termIndex);
    return prev != null
      && prev.revisionId != null
      && prev.revisionId === t.revisionId
      && prev.entries === t.entries;
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface FetchedTerm {
  termIndex: number | null;
  revisionMarker: string | null;
  revisionId: number | null;
  entries: AtlasPublishedScheduleEntry[];
  specialEvents: AtlasSpecialEvent[];
  timeSlots: AtlasTimeSlot[];
}

export interface SyncAtlasScheduleParams {
  schoolYearLabel: string;
  atlasSchoolYearId: number;
  facultyIndex: AtlasFacultyIndex;
  epSectionById: Map<number, any>;
  sectionByKey: Map<string, any>;
  subjectByCode: Map<string, any>;
  /** Active-term payload already fetched for the faculty fallback (avoid a duplicate read). */
  prefetchedActivePayload?: AtlasPublishedPayload | null;
}

export interface SyncAtlasScheduleResult {
  errors: string[];
  /** true when the ScheduleEntry set was rewritten this cycle. */
  changed: boolean;
  conflict: string | null;
}

export async function syncAtlasPublishedSchedule(
  params: SyncAtlasScheduleParams,
): Promise<SyncAtlasScheduleResult> {
  const { schoolYearLabel, atlasSchoolYearId, facultyIndex, epSectionById, sectionByKey, subjectByCode, prefetchedActivePayload } = params;
  const errors: string[] = [];
  let conflict: string | null = null;

  // 1. Fetch the active term first — it carries the authoritative term list (§4.1).
  let orderedTerms: AtlasOrderedTerm[] = [];
  let activeTermIndex: number | null = null;
  let snapshotGaps: string[] = [];
  let snapshotState: string | null = null;
  let revisionMarker: string | null = null;
  let sourceBlock: Record<string, unknown> = {};
  const fetchedTerms: FetchedTerm[] = [];

  const toFetchedTerm = (payload: AtlasPublishedPayload, fallbackTermIndex: number | null): FetchedTerm => {
    const termIndex = payload.source.termIndex ?? fallbackTermIndex;
    return {
      termIndex,
      revisionMarker: payload.source.revisionMarker,
      revisionId: payload.source.activeRevisionId,
      entries: payload.entries,
      // Re-stamp events with the effective term so the union stays per-term (§4.4).
      specialEvents: payload.specialEvents.map(e => ({ ...e, termIndex })),
      timeSlots: payload.timeSlots,
    };
  };

  const fetchTerm = async (term: AtlasTermSelector): Promise<AtlasPublishedPayload | null> => {
    try {
      return await fetchAtlasPublishedTerm(atlasSchoolYearId, term);
    } catch (err: unknown) {
      const failure = toAtlasScheduleFailure(err);
      if (failure.code === ATLAS_YEAR_AMBIGUOUS || failure.httpStatus === 409) {
        conflict = ATLAS_YEAR_AMBIGUOUS;
        errors.push(
          `ATLAS published schedule: ${ATLAS_YEAR_AMBIGUOUS} — more than one active school year; a human must resolve which year is current`,
        );
        return null;
      }
      errors.push(`ATLAS published schedule (term=${term}) fetch failed: ${failure.message}`);
      logger.warn(`[AtlasSync] Published schedule term=${term} fetch failed: ${failure.message}`);
      return null;
    }
  };

  const activePayload = prefetchedActivePayload ?? await fetchTerm('active');
  if (prefetchedActivePayload) {
    logger.debug('[AtlasSync] Using prefetched active-term published schedule (faculty fallback)');
  }
  if (activePayload) {
    const source = activePayload.source;
    activeTermIndex = source.termIndex;
    orderedTerms = source.orderedTerms.map(t => ({
      order: t.order,
      identity: t.identity || String(t.order),
      displayLabel: t.displayLabel || `TERM ${t.order}`,
    }));
    snapshotGaps = source.snapshotGaps;
    snapshotState = source.snapshotState;
    revisionMarker = source.revisionMarker;
    sourceBlock = {
      runId: source.runId,
      schoolId: source.schoolId,
      schoolYearId: source.schoolYearId,
      schoolYearLabel: source.schoolYearLabel,
      isActiveSchoolYear: source.isActiveSchoolYear,
      isHistorical: source.isHistorical,
      publishedAt: source.publishedAt,
      generatedAt: source.generatedAt,
      requestedDate: source.requestedDate,
      resolvedForDate: source.resolvedForDate,
      activeRevisionId: source.activeRevisionId,
      activeRevisionEffectiveDate: source.activeRevisionEffectiveDate,
      appliedRevisionIds: source.appliedRevisionIds,
      revisionMarker: source.revisionMarker,
      snapshotState: source.snapshotState,
      snapshotGaps: source.snapshotGaps,
      termScope: source.termScope,
      termIndex: source.termIndex,
      activeTermVerified: source.activeTermVerified,
    };
    if (activePayload.invalidEntries > 0) {
      logger.warn(`[AtlasSync] Published schedule active term: ${activePayload.invalidEntries} malformed entr(ies) skipped`);
    }
    fetchedTerms.push(toFetchedTerm(activePayload, source.termIndex));
    if (snapshotGaps.length > 0) {
      logger.warn(
        `[AtlasSync] ATLAS snapshot gaps for published schedule: ${snapshotGaps.join(', ')} — payload may be incomplete`,
      );
    }
  }

  // 2. Fetch the remaining ordered terms (explicit termIndex — §3). A missing
  //    orderedTerms list falls back to 1-3 only because ATLAS omitted it.
  if (!conflict) {
    const scheduleTermOrders = orderedTerms.length > 0
      ? orderedTerms.map(t => t.order)
      : [1, 2, 3];
    for (const term of scheduleTermOrders) {
      if (term === activeTermIndex) continue;
      const payload = await fetchTerm(term);
      if (payload) fetchedTerms.push(toFetchedTerm(payload, term));
    }
  }

  const labelByOrder = new Map(orderedTerms.map(t => [t.order, t.displayLabel]));
  const termMetaByOrder = new Map(orderedTerms.map(t => [t.order, t]));
  const termRows: StoredTermRow[] = fetchedTerms
    .filter(t => t.termIndex != null)
    .map(t => {
      const meta = termMetaByOrder.get(t.termIndex as number);
      return {
        termIndex: t.termIndex as number,
        order: meta?.order ?? null,
        identity: meta?.identity ?? null,
        displayLabel: meta?.displayLabel ?? null,
        revisionMarker: t.revisionMarker,
        revisionId: t.revisionId,
        entries: t.entries.length,
      };
    });

  // 3. Change detection against the persisted meta (§7.2).
  let changed = true;
  try {
    const prevMeta = await prisma.atlasScheduleMeta.findUnique({ where: { schoolYear: schoolYearLabel } });
    const prevTerms: StoredTermRow[] = prevMeta && Array.isArray(prevMeta.terms)
      ? (prevMeta.terms as unknown as StoredTermRow[])
      : [];
    changed = !isScheduleUnchanged(prevTerms, termRows);
  } catch {
    changed = true;
  }

  // 4. Crosswalk always refreshed (cheap, small) so §8A draft labels resolve
  //    even when the ScheduleEntry set is unchanged.
  const allEntries = fetchedTerms.flatMap(t => t.entries);
  await persistCrosswalk(
    schoolYearLabel,
    allEntries,
    (name, gradeLevel) => sectionByKey.get(`${name.trim()}:${gradeLevel}`)?.id ?? null,
    (code, gradeLevel) => subjectByCode.get(resolveSubjectCode(code, gradeLevel))?.id ?? null,
    facultyIndex,
  );

  // 5. Persist ScheduleEntry rows (skipped when the revision is unchanged).
  if (changed && !conflict) {
    await persistScheduleEntries({
      schoolYearLabel,
      terms: fetchedTerms.map(t => ({ termIndex: t.termIndex, entries: t.entries })),
      epSectionById,
      sectionByKey,
      subjectByCode,
      facultyIndex,
    });
  } else if (!changed) {
    logger.info('[AtlasSync] Published schedule unchanged (revision identity + counts match) — ScheduleEntry rewrite skipped');
  }

  // 6. Persist the `source` block + verbatim specialEvents (§4.4: duplicate
  //    break windows preserved) and the time-slot period boundaries.
  const specialEvents: AtlasSpecialEvent[] = fetchedTerms.flatMap(t => t.specialEvents);
  const timeSlots: AtlasTimeSlot[] = (() => {
    const seen = new Set<string>();
    const slots: AtlasTimeSlot[] = [];
    for (const term of fetchedTerms) {
      for (const slot of term.timeSlots) {
        const key = `${slot.startTime}-${slot.endTime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        slots.push(slot);
      }
    }
    return slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
  })();

  try {
    await prisma.atlasScheduleMeta.upsert({
      where: { schoolYear: schoolYearLabel },
      update: {
        source: sourceBlock as object,
        terms: termRows as unknown as object,
        specialEvents: specialEvents as unknown as object,
        timeSlots: timeSlots as unknown as object,
        activeTermIndex,
        conflict,
        syncedAt: new Date(),
      },
      create: {
        schoolYear: schoolYearLabel,
        source: sourceBlock as object,
        terms: termRows as unknown as object,
        specialEvents: specialEvents as unknown as object,
        timeSlots: timeSlots as unknown as object,
        activeTermIndex,
        conflict,
      },
    });
  } catch (err: any) {
    logger.warn(`[AtlasSync] Schedule meta upsert failed: ${err.message}`);
  }

  // 7. In-memory state for getSyncStatus().
  lastScheduleSync = {
    activeTermIndex,
    orderedTerms,
    terms: fetchedTerms
      .filter(t => t.termIndex != null)
      .map(t => ({
        termIndex: t.termIndex as number,
        displayLabel: t.termIndex != null ? labelByOrder.get(t.termIndex) ?? null : null,
        revisionMarker: t.revisionMarker,
        entries: t.entries.length,
      })),
    snapshotGaps: [...snapshotGaps],
    snapshotState,
    revisionMarker,
    conflict,
  };

  if (conflict === ATLAS_YEAR_AMBIGUOUS) {
    void createAuditLog(
      AuditAction.UPDATE,
      { id: null, role: 'SYSTEM', firstName: 'Atlas', lastName: 'Sync' },
      'ScheduleEntry',
      'SYNC',
      `ATLAS published schedule blocked: ${ATLAS_YEAR_AMBIGUOUS}. More than one active school year is configured — a human must choose which year is current before schedules sync again.`,
      undefined,
      AuditSeverity.CRITICAL,
    ).catch(() => {});
  }

  logger.debug(
    `[AtlasSync] Published schedule terms: ${fetchedTerms
      .map(t => `${t.termIndex}=${t.entries.length}`)
      .join(', ') || 'none'} (orderedTerms=${orderedTerms.map(t => t.identity).join('/') || 'fallback 1-3'})`,
  );

  return { errors, changed, conflict };
}
