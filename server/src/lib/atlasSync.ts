/**
 * atlasSync.ts
 *
 * Syncs teaching loads from ATLAS into SMART's DB.
 * Called on server start and on a schedule (every 30 min by default).
 * Also callable via POST /api/admin/sync-atlas for manual trigger.
 *
 * What it syncs:
 *  - ClassAssignments (teacher → subject → section) from ATLAS faculty-assignments
 *
 * What it does NOT sync (separate concern):
 *  - Students/Enrollments from EnrollPro (enrollment opens June 1)
 */
import { type GradeLevel, AuditAction, AuditSeverity } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { createAuditLog } from './audit';
import { getEnrollProTeachers, getAllIntegrationV1Sections, resolveEnrollProSchoolYear } from './enrollproClient';
import { syncAdvisoryWorkloadEntry } from './workload';
import { setCachedAtlasFaculty, setCachedEffectiveTeachingLoad } from './syncCache';
import { atlasGet, ATLAS_BASE, ATLAS_SCHOOL_ID, resolveAtlasSchoolYear, fetchEffectiveTeachingLoad } from './sync/httpClient';
import {
  mapGradeLevel,
  resolveSubjectCode,
  resolveSubjectName,
  sanitizeSubjectName,
  normalizeSubjectLabel,
  inferSubjectTypeFromCode,
} from './atlasUtils';
import { computeDisplayName } from './subjectDisplay';

import { getActiveSchoolYearLabel } from './schoolYearResolver';

function normalizeAtlasSubjectCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  return email.toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// -- State ------------------------------------------------------------------
let syncRunning = false;
let lastSyncAt: Date | null = null;
let lastSyncResult: {
  matched: number; created: number; deleted: number;
  teachersWithLoads: number; errors: string[];
} | null = null;

// -- Core sync logic --------------------------------------------------------
export async function runAtlasSync(): Promise<typeof lastSyncResult> {
  if (syncRunning) {
    console.log('[AtlasSync] Already running, skipping.');
    return lastSyncResult;
  }

  syncRunning = true;
  const errors: string[] = [];
  let matched = 0, created = 0;
  const deleted = 0, teachersWithLoads = 0;

  try {
    const atlasToken = process.env.ATLAS_SYSTEM_TOKEN;
    if (!atlasToken) {
      throw new Error('ATLAS_SYSTEM_TOKEN not set in environment');
    }

    const settings = await prisma.systemSettings.findUnique({
      where: { id: 'main' },
      select: { currentSchoolYear: true },
    });
    const preferredLabel = settings?.currentSchoolYear ?? await getActiveSchoolYearLabel();
    const resolvedSY = await resolveEnrollProSchoolYear(preferredLabel);
    const enrollProSchoolYearId = resolvedSY.id;
    const schoolYearLabel = resolvedSY.yearLabel;

    const resolvedAtlasSY = await resolveAtlasSchoolYear();
    const atlasSchoolYearId = resolvedAtlasSY.id;
    logger.debug(
      `[AtlasSync] Using EnrollPro SY ${schoolYearLabel} (id=${enrollProSchoolYearId}, source=${resolvedSY.source}) and Atlas SY id=${atlasSchoolYearId} (source=${resolvedAtlasSY.source})`,
    );

    // 1. Get all faculty from ATLAS (with graceful degradation)
    let atlasFaculty: any[] = [];
    try {
      const facultyData = await atlasGet(`/faculty?schoolId=${ATLAS_SCHOOL_ID}`);
      atlasFaculty = facultyData.faculty ?? [];
      // Populate the in-memory cache so teacherSync reads from cache on teacher login
      if (atlasFaculty.length > 0) setCachedAtlasFaculty(atlasFaculty);
    } catch (err: any) {
      const msg = `Faculty fetch failed: ${err.message}`;
      errors.push(msg);
      logger.warn(`[AtlasSync] ${msg} — continuing with cached/empty faculty`);
    }

    // 2. Build SMART teacher lookups and EnrollPro teacher-id mapping.
    // Atlas externalId is tied to the EnrollPro teacher record id, not the employeeId string.
    const smartTeachers = await prisma.teacher.findMany({
      include: { user: { select: { email: true } } },
    });
    const smartTeacherIdByEmployeeId = new Map<string, string>();
    const smartTeacherIdByEmail = new Map<string, string>();
    for (const teacher of smartTeachers) {
      smartTeacherIdByEmployeeId.set(String(teacher.employeeId).trim(), teacher.id);
      const email = teacher.user.email;
      if (email) smartTeacherIdByEmail.set(normalizeEmail(email), teacher.id);
    }

    const enrollProTeachers = await getEnrollProTeachers();

    // Match ATLAS faculty by externalId first, then fallback to email.
    const atlasIdToSmartTeacherId = new Map<number, string>();
    for (const af of atlasFaculty) {
      const externalId = Number(af.externalId ?? NaN);
      const externalMatch = Number.isFinite(externalId)
        ? enrollProTeachers.find((teacher) => Number(teacher.id) === externalId)
        : undefined;
      const externalTeacherId = externalMatch?.employeeId
        ? smartTeacherIdByEmployeeId.get(String(externalMatch.employeeId).trim())
        : undefined;
      const directEmployeeIdMatch = af.employeeId
        ? smartTeacherIdByEmployeeId.get(String(af.employeeId).trim())
        : undefined;
      const emailMatch = smartTeacherIdByEmail.get(normalizeEmail(af.contactInfo));
      const tid = externalTeacherId ?? directEmployeeIdMatch ?? emailMatch;
      if (tid) {
        atlasIdToSmartTeacherId.set(af.id, tid);
        matched++;
      }
    }

    // 3.1 Build EnrollPro sectionId → section details map for ATLAS assignments
    let epSectionById = new Map<number, any>();
    const epSectionByName = new Map<string, any>();
    try {
      let epSections = await getAllIntegrationV1Sections(enrollProSchoolYearId);
      let unscopedSections: any[] = [];

      if (epSections.length === 0) {
        epSections = await getAllIntegrationV1Sections();
        console.warn(
          `[AtlasSync] No EnrollPro sections for schoolYearId=${enrollProSchoolYearId}; using unscoped sections fallback (${epSections.length})`,
        );
      } else {
        // Merge unscoped sections to reduce false misses when ATLAS section IDs
        // reference records not included in the scoped EnrollPro response.
        unscopedSections = await getAllIntegrationV1Sections();
      }

      const mergedSections = new Map<number, any>();
      for (const s of epSections) {
        mergedSections.set(Number(s.id), s);
      }
      for (const s of unscopedSections) {
        if (!mergedSections.has(Number(s.id))) {
          mergedSections.set(Number(s.id), s);
        }
      }

      epSectionById = mergedSections;

      // Build name-based lookup for fallback (ATLAS and EP use different integer IDs)
      for (const [, s] of epSectionById) {
        if (s?.name) epSectionByName.set(s.name.trim().toLowerCase(), s);
      }

      if (unscopedSections.length > 0) {
        const mergedExtra = Math.max(0, epSectionById.size - epSections.length);
        if (mergedExtra > 0) {
          console.log(
            `[AtlasSync] EnrollPro section merge: scoped=${epSections.length}, unscoped=${unscopedSections.length}, mergedExtra=${mergedExtra}`,
          );
        }
      }
    } catch (err: any) {
      errors.push(`EnrollPro sections lookup failed: ${err.message}`);
    }

    // 4. Build subject code → SMART subject map
    // 4.1 First, fetch complete subject definitions from ATLAS.
    // IMPORTANT: Do NOT overwrite existing subject names — SMART names are authoritative.
    // Atlas often sends abbreviated names (e.g. "Sci Bio" instead of "Science - Biology").
    // Only create brand-new subjects that don't already exist in any form (raw or grade-suffixed).
    // Rotation metadata (rotationTermGroupId, rotationTermRank, rotationOutputLabel) IS always
    // kept up-to-date from Atlas since names are not affected.
    try {
      const atlasSubjectsData = await atlasGet(`/subjects?schoolId=${ATLAS_SCHOOL_ID}`);
      const atlasSubjects: any[] = atlasSubjectsData.subjects ?? [];
      // Pre-load existing subjects to check for grade-suffixed duplicates
      const existingSubjects = await prisma.subject.findMany({ select: { code: true } });
      const existingCodes = new Set(existingSubjects.map(s => s.code));
      let subjectsCreated = 0;
      let rotationUpdated = 0;
      for (const atlasSubj of atlasSubjects) {
        if (!atlasSubj.code || !atlasSubj.name) continue;
        const code = normalizeAtlasSubjectCode(atlasSubj.code);

        // Extract rotation metadata from Atlas subject
        const rotationTermGroupId: string | null = atlasSubj.rotationTermGroupId ?? null;
        const rotationTermRank: number | null = atlasSubj.rotationTermRank ?? null;
        const rotationOutputLabel: string | null = atlasSubj.outputLabel ?? null;
        const rotationData = { rotationTermGroupId, rotationTermRank, rotationOutputLabel };

        // Check if a grade-suffixed version already exists (e.g. SCI_BIO7 exists, don't create SCI_BIO)
        const hasGradeSuffixed = ['7', '8', '9', '10'].some(g => existingCodes.has(code + g));
        if (hasGradeSuffixed) {
          // Propagate rotation fields to all grade-suffixed variants that exist in SMART
          if (rotationTermGroupId) {
            for (const g of ['7', '8', '9', '10']) {
              const suffixedCode = code + g;
              if (existingCodes.has(suffixedCode)) {
                await prisma.subject.update({
                  where: { code: suffixedCode },
                  data: rotationData,
                }).catch(() => { /* subject may not exist */ });
              }
            }
            rotationUpdated++;
          }
          continue;
        }

        if (existingCodes.has(code)) {
          // Subject already exists — do NOT overwrite its name (SMART names are authoritative)
          // But DO update rotation fields from Atlas (these are Atlas-authoritative)
          if (rotationTermGroupId) {
            await prisma.subject.update({
              where: { code },
              data: rotationData,
            }).catch(() => { /* ignore if missing */ });
            rotationUpdated++;
          }
          continue;
        }

        // Brand new subject — create it with proper display name (not ATLAS abbreviation)
        const properName = resolveSubjectName(code);
        const inferredType = inferSubjectTypeFromCode(code);
        await prisma.subject.create({
          data: { code, name: properName, displayName: computeDisplayName(code, properName), type: inferredType, ...rotationData },
        }).catch(() => { /* already exists via race condition */ });
        existingCodes.add(code);
        subjectsCreated++;
      }
      logger.debug(`[AtlasSync] Processed ${atlasSubjects.length} Atlas subjects, created ${subjectsCreated} new, rotation-updated ${rotationUpdated}`);
    } catch (err: any) {
      logger.warn(`[AtlasSync] Failed to fetch subjects from ATLAS: ${err.message}`);
    }


    const allSubjects = await prisma.subject.findMany();
    const subjectByCode = new Map(allSubjects.map(s => [s.code, s]));

    // 4.5 Batch-fix any bad subject names that slipped through previous syncs
    const subjectNameFixes: Array<{ id: string; name: string; displayName: string }> = [];
    for (const subj of allSubjects) {
      const fixedName = sanitizeSubjectName(subj.name, subj.code);
      if (fixedName !== subj.name) {
        subjectNameFixes.push({ id: subj.id, name: fixedName, displayName: computeDisplayName(subj.code, fixedName) });
        subj.name = fixedName;
      }
    }
    if (subjectNameFixes.length > 0) {
      try {
        await prisma.$transaction(
          subjectNameFixes.map(f => prisma.subject.update({ where: { id: f.id }, data: { name: f.name, displayName: f.displayName } }))
        );
        logger.debug(`[AtlasSync] Batch fixed ${subjectNameFixes.length} subject names`);
      } catch (err: any) {
        logger.warn(`[AtlasSync] Batch subject name fix failed: ${err.message}`);
      }
    }

    // 5. Fetch teaching loads via ATLAS Effective Annual Endpoint (ATLAS Contract)
    // Single call replaces per-faculty fetching. EMPTY state = valid, no fallback to prior years.
    const loads: Array<{ smartTeacherId: string; subjectCode: string; sectionName: string; gradeLevel: GradeLevel }> = [];
    const desiredAssignmentPairs = new Set<string>();
    // ALL Atlas-matched teacher IDs (for stale-check scope — not just those with resolved loads)
    const allAtlasMatchedTeacherIds = Array.from(atlasIdToSmartTeacherId.values());
    let effectiveLoadState: 'EMPTY' | 'POPULATED' | 'UNAVAILABLE' = 'UNAVAILABLE';

    // Build ATLAS subjectId → code lookup from already-fetched atlasSubjects
    const atlasSubjectIdToCode = new Map<number, string>();
    try {
      const atlasSubjectsData = await atlasGet(`/subjects?schoolId=${ATLAS_SCHOOL_ID}`);
      const atlasSubjects: any[] = atlasSubjectsData.subjects ?? [];
      for (const s of atlasSubjects) {
        if (s.id && s.code) atlasSubjectIdToCode.set(Number(s.id), normalizeAtlasSubjectCode(s.code));
      }
    } catch { /* non-critical — will use ID as fallback */ }

    type FacultyAssignmentResult = {
      af: any;
      detail: any;
      pubEntries: any[];
      error?: string;
    };

    const fetchResults: FacultyAssignmentResult[] = [];

    // 5.1 Fetch effective annual teaching load (single call, no cross-year fallback)
    const effectiveLoad = await fetchEffectiveTeachingLoad(atlasSchoolYearId);
    if (effectiveLoad) {
      // Cache the response for consumption by teacherSync and teacherDashboardComposer
      setCachedEffectiveTeachingLoad(ATLAS_SCHOOL_ID, atlasSchoolYearId, effectiveLoad);
      effectiveLoadState = effectiveLoad.source.state;
      logger.info(
        `[AtlasSync] Effective teaching load: state=${effectiveLoad.source.state}, ` +
        `assignments=${effectiveLoad.assignments.length}, version=${effectiveLoad.source.version}`,
      );

      if (effectiveLoad.source.state === 'EMPTY') {
        // Contract: EMPTY is valid current-year truth. No fallback to prior years.
        // All current-year ClassAssignments for Atlas-matched teachers are stale.
        logger.info('[AtlasSync] Teaching load state is EMPTY — all current-year assignments for Atlas-matched teachers will be archived.');
      } else {
        // POPULATED: map effective assignments to SMART teacher loads
        for (const assignment of effectiveLoad.assignments) {
          const smartTeacherId = atlasIdToSmartTeacherId.get(assignment.facultyId);
          if (!smartTeacherId) continue;

          const subjectCode = atlasSubjectIdToCode.get(Number(assignment.subjectId))
            ?? normalizeAtlasSubjectCode(String(assignment.subjectId));
          const sectionId = Number(assignment.sectionId);
          if (!Number.isFinite(sectionId)) continue;

          const epSection = epSectionById.get(sectionId);
          if (!epSection?.name) {
            errors.push(`ATLAS sectionId=${sectionId} not found in EnrollPro sections`);
            continue;
          }
          const gradeLevel = mapGradeLevel(epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name);
          if (gradeLevel) {
            loads.push({ smartTeacherId, subjectCode, sectionName: epSection.name, gradeLevel });
          }
        }
      }
    } else {
      errors.push('Failed to fetch effective teaching load from ATLAS');
      logger.warn('[AtlasSync] Effective teaching load fetch failed');
    }

    // 5.2 Fetch published schedules per faculty (for ScheduleEntry records)
    // Published schedule endpoint is still valid per ATLAS contract — only teaching load ownership changed.
    // Fetch using active school year only — no cross-year probing.
    const CONCURRENT_LIMIT = 5;

    // Pre-resolve desired assignment pairs from effective loads (for stale-check)
    const allSectionsPre = await prisma.section.findMany({ where: { schoolYear: schoolYearLabel } });
    const sectionByKeyPre = new Map(allSectionsPre.map(s => [`${s.name.trim()}:${s.gradeLevel}`, s]));
    for (const load of loads) {
      const section = sectionByKeyPre.get(`${load.sectionName.trim()}:${load.gradeLevel}`);
      if (!section) continue;
      const smartSubjectCode = resolveSubjectCode(load.subjectCode, section.gradeLevel);
      const subject = subjectByCode.get(smartSubjectCode);
      if (subject) {
        desiredAssignmentPairs.add(`${load.smartTeacherId}:${subject.id}:${section.id}`);
      }
    }

    async function fetchPubEntriesForFaculty(af: any): Promise<any[]> {
      try {
        const data = await atlasGet(
          `/schools/${ATLAS_SCHOOL_ID}/school-years/${atlasSchoolYearId}/schedules/published/faculty/${af.id}?termIndex=active`,
        );
        return Array.isArray(data?.entries) ? data.entries : [];
      } catch {
        // Try school-wide endpoint as fallback
        try {
          const data = await atlasGet(
            `/schools/${ATLAS_SCHOOL_ID}/schedules/published/faculty/${af.id}?termIndex=active`,
          );
          return Array.isArray(data?.entries) ? data.entries : [];
        } catch { return []; }
      }
    }

    for (let i = 0; i < atlasFaculty.length; i += CONCURRENT_LIMIT) {
      const batch = atlasFaculty.slice(i, i + CONCURRENT_LIMIT);
      const batchResults = await Promise.all(batch.map(async (af) => {
        const pubEntries = await fetchPubEntriesForFaculty(af);
        return { af, detail: null, pubEntries };
      }));
      fetchResults.push(...batchResults);
    }

    // 6. Upsert loads from effective endpoint into ClassAssignment
    // Run BEFORE stale-check so desiredAssignmentPairs is fully populated
    // (includes pairs from newly-created subjects that weren't in subjectByCode at pre-resolve time).
    const allSections = allSectionsPre;
    const sectionByKey = sectionByKeyPre;

    let hgLoadsSkipped = 0;
    for (const load of loads) {
      const section = sectionByKey.get(`${load.sectionName.trim()}:${load.gradeLevel}`);
      if (!section) continue;

      const smartSubjectCode = resolveSubjectCode(load.subjectCode, section.gradeLevel);
      if (smartSubjectCode.toUpperCase().startsWith('HG')) { hgLoadsSkipped++; continue; }

      let subject = subjectByCode.get(smartSubjectCode);

      if (!subject) {
        const autoName = resolveSubjectName(smartSubjectCode, section.gradeLevel);
        subject = await prisma.subject.upsert({
          where: { code: smartSubjectCode },
          update: {},
          create: { code: smartSubjectCode, name: autoName, displayName: computeDisplayName(smartSubjectCode, autoName), type: inferSubjectTypeFromCode(smartSubjectCode) },
        });
        subjectByCode.set(smartSubjectCode, subject);
        logger.debug(`[AtlasSync] Auto-created subject "${smartSubjectCode}" ("${autoName}")`);
      }

      const teachingMinutes = null;
      const desiredKey = `${load.smartTeacherId}:${subject.id}:${section.id}`;
      desiredAssignmentPairs.add(desiredKey);

      try {
        await prisma.classAssignment.upsert({
          where: {
            teacherId_subjectId_sectionId_schoolYear: {
              teacherId: load.smartTeacherId,
              subjectId: subject.id,
              sectionId: section.id,
              schoolYear: schoolYearLabel,
            },
          },
          update: { teachingMinutes, isActive: true, archivedAt: null, archivedReason: null, successorTeacherId: null },
          create: {
            teacherId: load.smartTeacherId,
            subjectId: subject.id,
            sectionId: section.id,
            schoolYear: schoolYearLabel,
            teachingMinutes,
            isActive: true,
          },
        });
        created++;
      } catch (err: any) {
        logger.warn({ err: err.message, teacherId: load.smartTeacherId, subjectCode: load.subjectCode, sectionName: load.sectionName }, 'Class assignment upsert failed');
      }
    }

    // 6.5 Stale-check: archive assignments not in the effective load
    // Runs AFTER upserts so desiredAssignmentPairs includes all resolved loads.
    // Scope: ALL Atlas-matched teachers (not just those with resolved loads this cycle).
    // When effective load is EMPTY, archive ALL current-year assignments for Atlas-matched teachers.
    // When POPULATED, archive assignments not in the desired set.
    if (allAtlasMatchedTeacherIds.length > 0) {

      // EMPTY-load safety guard: require two consecutive EMPTY cycles
      let proceedWithArchive = true;
      if (effectiveLoadState === 'EMPTY') {
        const settingsRow = await prisma.systemSettings.findUnique({
          where: { id: 'main' },
          select: { atlasEmptyLoadSeenAt: true },
        });
        const seenAt = settingsRow?.atlasEmptyLoadSeenAt;
        const now = new Date();
        if (!seenAt) {
          // First EMPTY observation — defer archiving
          await prisma.systemSettings.update({
            where: { id: 'main' },
            data: { atlasEmptyLoadSeenAt: now },
          });
          logger.warn('[AtlasSync] EMPTY teaching load — first observation; archiving deferred until confirmed on next cycle.');
          await createAuditLog(
            AuditAction.UPDATE,
            { id: null, role: 'SYSTEM', firstName: 'Atlas', lastName: 'Sync' },
            'SystemSettings',
            'SYNC',
            'Atlas reports EMPTY teaching load — first observation; archiving deferred until confirmed on next cycle.',
            undefined,
            AuditSeverity.WARNING,
          ).catch(() => {});
          proceedWithArchive = false;
        } else if (now.getTime() - seenAt.getTime() < 20 * 60 * 1000) {
          // Same cycle (within 20 min) — defer
          logger.warn('[AtlasSync] EMPTY load seen again but within 20 min of first observation — deferring.');
          proceedWithArchive = false;
        } else {
          // Second consecutive EMPTY — proceed, then clear flag
          logger.info('[AtlasSync] EMPTY load confirmed on second cycle — proceeding with mass-archive.');
          await prisma.systemSettings.update({
            where: { id: 'main' },
            data: { atlasEmptyLoadSeenAt: null },
          });
        }
      } else if (effectiveLoadState === 'POPULATED') {
        // POPULATED clears the EMPTY flag
        await prisma.systemSettings.update({
          where: { id: 'main' },
          data: { atlasEmptyLoadSeenAt: null },
        }).catch(() => {});
      }

      // Build subjectId:sectionId → teacherId map from desired pairs for reassignment detection
      const desiredSubjectSectionToTeacher = new Map<string, string>();
      for (const pair of desiredAssignmentPairs) {
        const [tid, sid, secId] = pair.split(':');
        const ssKey = `${sid}:${secId}`;
        if (!desiredSubjectSectionToTeacher.has(ssKey)) {
          desiredSubjectSectionToTeacher.set(ssKey, tid);
        }
      }

      const currentAssignments = await prisma.classAssignment.findMany({
        where: {
          teacherId: { in: allAtlasMatchedTeacherIds },
          schoolYear: schoolYearLabel,
        },
        select: { id: true, teacherId: true, subjectId: true, sectionId: true, isActive: true, source: true },
      });

      const archiveIds: string[] = [];
      const reactivateIds: string[] = [];
      let preservedMissingCount = 0;
      // Map: assignmentId → { isReassignment, successorTeacherId }
      const archiveMeta = new Map<string, { isReassignment: boolean; successorTeacherId: string | null }>();

      for (const assignment of currentAssignments) {
        // MANUAL assignments are protected from Atlas stale-check
        if (assignment.source === 'MANUAL') {
          preservedMissingCount++;
          continue;
        }

        const key = `${assignment.teacherId}:${assignment.subjectId}:${assignment.sectionId}`;
        const shouldBeActive = desiredAssignmentPairs.has(key);

        if (shouldBeActive) {
          // Assignment is in the effective load — reactivate if it was archived
          if (!assignment.isActive) {
            reactivateIds.push(assignment.id);
          }
        } else {
          // Assignment is NOT in the effective load — stale
          if (!proceedWithArchive) continue;

          // Check for reassignment: same subject+section under a different teacher
          const ssKey = `${assignment.subjectId}:${assignment.sectionId}`;
          const successorTeacherId = desiredSubjectSectionToTeacher.get(ssKey) ?? null;
          const isReassignment = successorTeacherId !== null && successorTeacherId !== assignment.teacherId;

          if (effectiveLoadState === 'EMPTY') {
            archiveIds.push(assignment.id);
            archiveMeta.set(assignment.id, { isReassignment, successorTeacherId });
          } else if (effectiveLoadState === 'POPULATED' && assignment.isActive) {
            archiveIds.push(assignment.id);
            archiveMeta.set(assignment.id, { isReassignment, successorTeacherId });
          } else {
            preservedMissingCount++;
          }
        }
      }

      // Soft-archive ALL stale assignments (no more hard deletes)
      let softArchivedCount = 0;
      if (archiveIds.length > 0) {
        try {
          const withGradeCounts = await prisma.classAssignment.findMany({
            where: { id: { in: archiveIds } },
            select: { id: true, _count: { select: { grades: true } } },
          });
          const gradesMap = new Map(withGradeCounts.map(c => [c.id, c._count.grades]));

          for (const aid of archiveIds) {
            const meta = archiveMeta.get(aid);
            const hasGrades = (gradesMap.get(aid) ?? 0) > 0;
            let reason: string;
            let successorTid: string | null = null;

            if (meta?.isReassignment) {
              reason = 'ATLAS_REASSIGNED';
              successorTid = meta.successorTeacherId;
            } else if (hasGrades) {
              reason = 'ATLAS_STALE_WITH_GRADES';
            } else {
              reason = 'ATLAS_STALE_NO_GRADES';
            }

            await prisma.classAssignment.update({
              where: { id: aid },
              data: {
                isActive: false,
                archivedAt: new Date(),
                archivedReason: reason,
                successorTeacherId: successorTid,
              },
            });
          }
          softArchivedCount = archiveIds.length;

          // Alert admins via audit log with human-readable details
          try {
            const archivedAssignments = await prisma.classAssignment.findMany({
              where: { id: { in: archiveIds } },
              select: {
                id: true,
                archivedReason: true,
                subject: { select: { name: true, code: true } },
                section: { select: { name: true, gradeLevel: true } },
                teacher: { select: { user: { select: { firstName: true, lastName: true } } } },
              },
            });
            const details = archivedAssignments.map(a =>
              `${a.subject.name} (${a.section.name}) — ${a.teacher.user.firstName} ${a.teacher.user.lastName} [${a.archivedReason}]`
            ).join('; ');
            await createAuditLog(
              AuditAction.UPDATE,
              { id: null, role: 'SYSTEM', firstName: 'Atlas', lastName: 'Sync' },
              'ClassAssignment',
              'SYNC',
              `Atlas sync archived ${archiveIds.length} stale assignment(s): ${details}`,
              undefined,
              AuditSeverity.WARNING,
              undefined,
              { assignmentIds: archiveIds, schoolYear: schoolYearLabel, effectiveLoadState },
            );
          } catch (auditErr: any) {
            logger.warn(`[AtlasSync] Audit log for soft-archive failed (non-fatal): ${auditErr.message}`);
          }

          console.log(
            `[AtlasSync] Soft-archived ${softArchivedCount} stale ClassAssignment(s) ` +
            `(effectiveLoadState=${effectiveLoadState}, schoolYear=${schoolYearLabel})`,
          );
        } catch (err: any) {
          logger.warn(`[AtlasSync] Batch archive failed: ${err.message}`);
        }
      }

      // Batch reactivation — also clear successorTeacherId on reactivation
      if (reactivateIds.length > 0) {
        try {
          await prisma.classAssignment.updateMany({
            where: { id: { in: reactivateIds } },
            data: { isActive: true, archivedAt: null, archivedReason: null, successorTeacherId: null },
          });
        } catch (err: any) {
          logger.warn(`[AtlasSync] Batch reactivation failed: ${err.message}`);
        }
      }

      if (archiveIds.length > 0 || reactivateIds.length > 0 || preservedMissingCount > 0) {
        console.log(
          `[AtlasSync] Stale-check: softArchived=${softArchivedCount}, reactivated=${reactivateIds.length}, preserved=${preservedMissingCount}.`,
        );
      }
    }

    // 6.6 Persist published schedule entries as ScheduleEntry records
    {
      const allScheduleEntries: Array<{
        teacherId: string; subjectCode: string; sectionName: string;
        gradeLevel: GradeLevel; day: string; startTime: string; endTime: string; roomId: number | null;
        termIndex: number | null;
      }> = [];
      let totalPubEntries = 0;
      let skippedNoDay = 0;
      let skippedNoSubject = 0;
      let skippedNoSection = 0;
      for (const result of fetchResults) {
        if (result.error || !result.pubEntries?.length) continue;
        totalPubEntries += result.pubEntries.length;
        const smartTeacherId = atlasIdToSmartTeacherId.get(result.af.id);
        if (!smartTeacherId) continue;
        for (const entry of result.pubEntries) {
          const day = entry?.day;
          const startTime = entry?.startTime;
          const endTime = entry?.endTime;
          if (!day || !startTime || !endTime) { skippedNoDay++; continue; }
          if (entry?.faculty?.isPlaceholder) continue;
          const subjectCode = normalizeAtlasSubjectCode(entry?.subject?.code ?? entry?.subjectCode);
          if (!subjectCode) {
            skippedNoSubject++;
            continue;
          }
          const sectionId = Number(entry?.section?.externalId ?? entry?.section?.id ?? entry?.sectionId);
          if (!Number.isFinite(sectionId)) {
            skippedNoSection++;
            continue;
          }
          let epSection = epSectionById.get(sectionId);
          if (!epSection?.name) {
            const atlasSectionName = entry?.section?.name ?? entry?.sectionName;
            if (atlasSectionName) {
              epSection = epSectionByName.get(atlasSectionName.trim().toLowerCase()) ?? null;
            }
          }
          if (!epSection?.name) { skippedNoSection++; continue; }
          const gradeLevelRaw = epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name;
          const gradeLevel = mapGradeLevel(gradeLevelRaw);
          if (!gradeLevel) continue;
          const roomId = entry?.room?.id ?? entry?.roomId ?? null;
          allScheduleEntries.push({
            teacherId: smartTeacherId, subjectCode, sectionName: epSection.name,
            gradeLevel, day, startTime, endTime, roomId: Number.isFinite(Number(roomId)) ? Number(roomId) : null,
            termIndex: Number.isFinite(Number(entry?.termIndex)) ? Number(entry.termIndex) : null,
          });
        }
      }

      const hgScheduleSkipped = allScheduleEntries.filter(e => e.subjectCode.toUpperCase().startsWith('HG')).length;
      const filteredScheduleEntries = allScheduleEntries.filter(e => !e.subjectCode.toUpperCase().startsWith('HG'));
      if (hgScheduleSkipped > 0) logger.info(`[AtlasSync] Skipped ${hgScheduleSkipped} HG schedule entries`);
      if (filteredScheduleEntries.length > 0) {
        let scheduleCreated = 0;
        let scheduleCleaned = 0;
        const teacherIdsWithSchedule = new Set(filteredScheduleEntries.map(e => e.teacherId));

        const existingEntries = await prisma.scheduleEntry.findMany({
          where: { teacherId: { in: Array.from(teacherIdsWithSchedule) }, schoolYear: schoolYearLabel },
          select: { id: true, teacherId: true, subjectId: true, sectionId: true, day: true, startTime: true },
        });
        const existingByKey = new Map(
          existingEntries.map(e => [`${e.teacherId}:${e.subjectId}:${e.sectionId}:${e.day}:${e.startTime}`, e.id]),
        );

        for (const entry of filteredScheduleEntries) {
          const smartSubjectCode = resolveSubjectCode(entry.subjectCode, entry.gradeLevel);
          let subject = subjectByCode.get(smartSubjectCode);
          if (!subject) {
            try {
              subject = await prisma.subject.upsert({
                where: { code: smartSubjectCode },
                update: {},
                create: { code: smartSubjectCode, name: resolveSubjectName(smartSubjectCode, entry.gradeLevel), displayName: computeDisplayName(smartSubjectCode, resolveSubjectName(smartSubjectCode, entry.gradeLevel)), type: inferSubjectTypeFromCode(smartSubjectCode) },
              });
              subjectByCode.set(smartSubjectCode, subject);
            } catch { continue; }
          }
          if (!subject) continue;
          const section = sectionByKey.get(`${entry.sectionName.trim()}:${entry.gradeLevel}`);
          if (!section) continue;

          const dedupKey = `${entry.teacherId}:${subject.id}:${section.id}:${entry.day}:${entry.startTime}`;
          const existingId = existingByKey.get(dedupKey);
          if (existingId) {
            existingByKey.delete(dedupKey);
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
              update: { endTime: entry.endTime, roomId: entry.roomId, termIndex: entry.termIndex },
              create: {
                teacherId: entry.teacherId, subjectId: subject.id,
                sectionId: section.id, schoolYear: schoolYearLabel,
                termIndex: entry.termIndex,
                day: entry.day, startTime: entry.startTime,
                endTime: entry.endTime, roomId: entry.roomId,
              },
            });
            scheduleCreated++;
          } catch (err: any) {
            logger.warn(`[AtlasSync] Schedule entry upsert failed: ${err.message}`);
          }
        }

        const staleIds = Array.from(existingByKey.values());
        if (staleIds.length > 0) {
          await prisma.scheduleEntry.deleteMany({ where: { id: { in: staleIds } } });
          scheduleCleaned = staleIds.length;
        }

        if (scheduleCreated > 0 || scheduleCleaned > 0) {
          console.log(`[AtlasSync] Schedule entries: created=${scheduleCreated}, cleaned=${scheduleCleaned}`);
        }
      }
      if (totalPubEntries > 0) {
        console.log(`[AtlasSync] Schedule diag: totalPub=${totalPubEntries}, skippedNoDay=${skippedNoDay}, skippedNoSubject=${skippedNoSubject}, skippedNoSection=${skippedNoSection}, resolved=${allScheduleEntries.length}, atlasSY=${atlasSchoolYearId}`);
      } else {
        console.log(`[AtlasSync] Schedule diag: no published schedule entries found from ATLAS (atlasSY=${atlasSchoolYearId})`);
      }
    }

    // 7. Sync section advisers from ATLAS /faculty/advisers
    try {
      const advisersData = await atlasGet(`/faculty/advisers?schoolId=${ATLAS_SCHOOL_ID}&schoolYearId=${atlasSchoolYearId}`);
      const atlasAdvisers: any[] = advisersData.advisers ?? [];
      const facultyEmailById = new Map<number, string>(atlasFaculty.map(f => [f.id, (f.contactInfo ?? '').toLowerCase()]));
      const emailToTeacherIdForAdviser = new Map<string, string>();
      const teacherUsers = await prisma.user.findMany({ where: { role: 'TEACHER' }, include: { teacher: { select: { id: true } } } });
      for (const u of teacherUsers) {
        if (u.teacher?.id && u.email) emailToTeacherIdForAdviser.set(u.email.toLowerCase(), u.teacher.id);
      }
      const sectionsByName = new Map(allSections.map(s => [s.name, s]));
      for (const adviser of atlasAdvisers) {
        const email = facultyEmailById.get(adviser.id) ?? '';
        const sectionName = adviser.advisedSectionName ?? '';
        const tid = emailToTeacherIdForAdviser.get(email);
        const sec = sectionsByName.get(sectionName);
        if (tid && sec) {
          if (sec.adviserId !== tid) {
            await prisma.section.update({ where: { id: sec.id }, data: { adviserId: tid } });
          }
          await syncAdvisoryWorkloadEntry({ teacherId: tid, sectionId: sec.id, schoolYear: schoolYearLabel });
        }
      }
      logger.debug(`[AtlasSync] Advisers synced: ${atlasAdvisers.length} from ATLAS`);
    } catch (advErr: any) {
      logger.warn('[AtlasSync] Adviser sync failed:', advErr.message);
    }

    if (hgLoadsSkipped > 0) logger.info(`[AtlasSync] Skipped ${hgLoadsSkipped} Homeroom Guidance loads (HG is a location, not a subject)`);
    lastSyncResult = { matched, created, deleted, teachersWithLoads, errors };
    lastSyncAt = new Date();
    logger.debug(`[AtlasSync] ✔ Done: matched=${matched}, created=${created}, deleted=${deleted}, teachers=${teachersWithLoads}, errors=${errors.length}`);
  } catch (err: any) {
    console.error('[AtlasSync] ✗ Sync failed:', err.message);
    errors.push(err.message);
    lastSyncResult = { matched, created, deleted, teachersWithLoads, errors };
  } finally {
    syncRunning = false;
  }

  return lastSyncResult;
}

export function getSyncStatus() {
  return {
    running: syncRunning,
    lastSyncAt: lastSyncAt?.toISOString() ?? null,
    result: lastSyncResult,
  };
}

// NOTE: Scheduling is now handled by syncCoordinator.ts.
// Call runAtlasSync() directly; do not add a scheduler here.
