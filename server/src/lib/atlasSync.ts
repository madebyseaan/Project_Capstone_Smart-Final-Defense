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
import type { GradeLevel } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { getEnrollProTeachers, getAllIntegrationV1Sections, resolveEnrollProSchoolYear } from './enrollproClient';
import { syncAdvisoryWorkloadEntry } from './workload';
import { setCachedAtlasFaculty } from './syncCache';
import { atlasGet, ATLAS_BASE, ATLAS_SCHOOL_ID, resolveAtlasSchoolYear, DEFAULT_ATLAS_SCHOOL_YEAR_ID } from './sync/httpClient';
import {
  mapGradeLevel,
  resolveSubjectCode,
  resolveSubjectName,
  sanitizeSubjectName,
  normalizeSubjectLabel,
  ensureHomeroomGuidanceLabel,
  inferSubjectTypeFromCode,
  HOMEROOM_GUIDANCE_LABEL,
  HOMEROOM_GUIDANCE_MINUTES,
} from './atlasUtils';

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
  let matched = 0, created = 0, deleted = 0, teachersWithLoads = 0;

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
          data: { code, name: properName, type: inferredType, ...rotationData },
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
    const homeroomLabelUpdated = new Set<string>();

    // 4.5 Batch-fix any bad subject names that slipped through previous syncs
    const subjectNameFixes: Array<{ id: string; name: string }> = [];
    for (const subj of allSubjects) {
      const fixedName = sanitizeSubjectName(subj.name, subj.code);
      if (fixedName !== subj.name) {
        subjectNameFixes.push({ id: subj.id, name: fixedName });
        subj.name = fixedName;
      }
    }
    if (subjectNameFixes.length > 0) {
      try {
        await prisma.$transaction(
          subjectNameFixes.map(f => prisma.subject.update({ where: { id: f.id }, data: { name: f.name } }))
        );
        logger.debug(`[AtlasSync] Batch fixed ${subjectNameFixes.length} subject names`);
      } catch (err: any) {
        logger.warn(`[AtlasSync] Batch subject name fix failed: ${err.message}`);
      }
    }

    // 5. Fetch teaching loads from ATLAS per faculty
    const loads: Array<{ smartTeacherId: string; subjectCode: string; sectionName: string; gradeLevel: GradeLevel }> = [];
    const desiredAssignmentPairs = new Set<string>();
    // Only teachers with at least 1 successfully resolved load are eligible for stale-check.
    // Teachers whose loads fail (e.g. section-ID lookup returns nothing in EnrollPro) are skipped
    // from the stale check so their existing assignments are not incorrectly archived.
    const teacherIdsWithLoads = new Set<string>();

    // 5.1 Pre-fetch all faculty assignments in parallel (with concurrency limit)
    const CONCURRENT_LIMIT = 5;

    // Discover which school year has a published schedule (check once, reuse for all faculty)
    let discoveredPubYearId: number | null = null;
    try {
      const schoolWide = await atlasGet(`/schools/${ATLAS_SCHOOL_ID}/schedules/published`);
      if (schoolWide?.source?.schoolYearId) {
        discoveredPubYearId = schoolWide.source.schoolYearId;
        logger.info(`[AtlasSync] Discovered published schedule in school year ${discoveredPubYearId} (label=${schoolWide.source.schoolYearLabel})`);
      }
    } catch { /* no school-wide published schedule for active year */ }

    // If no published year discovered, probe known year IDs to find one with data
    if (!discoveredPubYearId) {
      const probeYears = [atlasSchoolYearId, 2, 3, 5, 6, 1, 8].filter((v, i, a) => a.indexOf(v) === i); // deduplicate
      for (const probeYear of probeYears) {
        try {
          const probeData = await atlasGet(`/schools/${ATLAS_SCHOOL_ID}/school-years/${probeYear}/schedules/published`);
          if (probeData?.entries?.length > 0 || probeData?.source?.schoolYearId) {
            discoveredPubYearId = probeYear;
            logger.info(`[AtlasSync] Discovered published schedule in school year ${discoveredPubYearId} via probe`);
            break;
          }
        } catch { /* this year has no published schedule */ }
      }
    }

    type FacultyAssignmentResult = {
      af: any;
      detail: any;
      pubEntries: any[];
      error?: string;
    };

    async function fetchFacultyAssignment(af: any): Promise<FacultyAssignmentResult> {
      try {
        const detail = await atlasGet(
          `/faculty-assignments/${af.id}?schoolYearId=${atlasSchoolYearId}`,
        );
        const assignmentsPayload = detail?.assignments ?? detail?.data ?? detail ?? [];
        let assignments: any[] = Array.isArray(assignmentsPayload) ? assignmentsPayload : [];

        // Fallback: If primary schoolYearId returned no sectionIds, try alternate active schoolYearId (e.g. 6 or 1)
        const hasDirectSections = assignments.some(a => (a?.sectionIds && a.sectionIds.length > 0) || (a?.sections && a.sections.length > 0));
        if (!hasDirectSections) {
          const fallbackSYs = [DEFAULT_ATLAS_SCHOOL_YEAR_ID, 2, 5, 6, 1, 8].filter(id => id !== atlasSchoolYearId);
          for (const fallbackSY of fallbackSYs) {
            try {
              const fbDetail = await atlasGet(
                `/faculty-assignments/${af.id}?schoolYearId=${fallbackSY}`,
              );
              const fbPayload = fbDetail?.assignments ?? fbDetail?.data ?? fbDetail ?? [];
              const fbAssignments: any[] = Array.isArray(fbPayload) ? fbPayload : [];
              if (fbAssignments.some(a => (a?.sectionIds && a.sectionIds.length > 0) || (a?.sections && a.sections.length > 0))) {
                assignments = fbAssignments;
                break;
              }
            } catch {
              // Ignore fallback errors
            }
          }
        }

        const smartTeacherId = atlasIdToSmartTeacherId.get(af.id);
        if (!smartTeacherId) return { af, detail: null, pubEntries: [] };

        const flatAssignments = assignments.filter((a) => a && (a.subjectCode || a.sectionId));
        const nestedAssignments = assignments.filter((a) => a && (a.subject?.code || a.sections));
          // Always fetch published schedule — needed for teaching load fallback AND schedule entries
          // ATLAS uses path-based routing: /school-years/:schoolYearId/schedules/published/faculty/:facultyId
          // Uses pre-discovered year or configured year, falls back to current-year auto-resolve
          let pubEntries: any[] = [];

          async function fetchPubEntries(path: string): Promise<any[]> {
            try {
              const data = await atlasGet(path);
              return Array.isArray(data?.entries) ? data.entries : [];
            } catch { return []; }
          }

          // 1. Try discovered or configured school year
          const yearToTry = discoveredPubYearId ?? atlasSchoolYearId;
          pubEntries = await fetchPubEntries(`/schools/${ATLAS_SCHOOL_ID}/school-years/${yearToTry}/schedules/published/faculty/${af.id}?termIndex=active`);
          if (pubEntries.length > 0) {
            logger.debug(`[AtlasSync] Faculty ${af.firstName} ${af.lastName}: ${pubEntries.length} entries (year ${yearToTry})`);
          }

          // 2. Try current-year endpoint (ATLAS resolves active year automatically)
          if (pubEntries.length === 0 && yearToTry !== atlasSchoolYearId) {
            pubEntries = await fetchPubEntries(`/schools/${ATLAS_SCHOOL_ID}/school-years/${atlasSchoolYearId}/schedules/published/faculty/${af.id}?termIndex=active`);
          }
          if (pubEntries.length === 0) {
            pubEntries = await fetchPubEntries(`/schools/${ATLAS_SCHOOL_ID}/schedules/published/faculty/${af.id}?termIndex=active`);
          }

        return { af, detail: assignments, pubEntries };
      } catch (err: any) {
        return { af, detail: null, pubEntries: [], error: `${af.firstName} ${af.lastName}: ${err.message}` };
      }
    }

    // Run with concurrency limit
    const fetchResults: FacultyAssignmentResult[] = [];
    for (let i = 0; i < atlasFaculty.length; i += CONCURRENT_LIMIT) {
      const batch = atlasFaculty.slice(i, i + CONCURRENT_LIMIT);
      const batchResults = await Promise.all(batch.map(af => fetchFacultyAssignment(af)));
      fetchResults.push(...batchResults);
    }

    // 5.2 Process results sequentially (same logic as before)
    for (const result of fetchResults) {
      if (result.error) {
        errors.push(result.error);
        continue;
      }

      const { af, detail: assignments, pubEntries } = result;
      if (!assignments) continue;

      const smartTeacherId = atlasIdToSmartTeacherId.get(af.id);
      if (!smartTeacherId) continue;

        const flatAssignments = assignments.filter((a: any) => a && (a.subjectCode || a.sectionId));
        const nestedAssignments = assignments.filter((a: any) => a && (a.subject?.code || a.sections));
        const teacherLoads: Array<{ smartTeacherId: string; subjectCode: string; sectionName: string; gradeLevel: GradeLevel }> = [];
        const MAX_SANE_SECTIONS = 10;

        if (flatAssignments.length > 0 && flatAssignments.some((a: any) => a?.sectionId ?? a?.section?.id)) {
          // Trust Gate: Group by subject to detect broad over-assignment
          const flatBySubject = new Map<string, number>();
          for (const a of flatAssignments) {
            const code = normalizeAtlasSubjectCode(a?.subjectCode ?? a?.subject?.code);
            if (code) flatBySubject.set(code, (flatBySubject.get(code) || 0) + 1);
          }

          for (const a of flatAssignments) {
            const subjectCode = normalizeAtlasSubjectCode(a?.subjectCode ?? a?.subject?.code);
            if (!subjectCode) continue;

            if ((flatBySubject.get(subjectCode) || 0) > MAX_SANE_SECTIONS) {
              // Broad assignment detected - global sync only keeps these if verified by other sources
              // or if they are advisory (not easily checked in global loop without more lookups).
              // For now, we skip broad flat assignments in global sync to prevent bulk over-assignment.
              continue;
            }

            const sectionId = Number(a?.sectionId ?? a?.section?.id);
            if (!Number.isFinite(sectionId)) continue;
            let epSection = epSectionById.get(sectionId);
            // Fallback: ATLAS and EnrollPro use different integer IDs for same section — match by name
            if (!epSection?.name && (a?.sectionName || a?.section?.name)) {
              const sectionName = (a?.sectionName || a?.section?.name || '').trim().toLowerCase();
              epSection = epSectionByName.get(sectionName) ?? null;
            }
            if (!epSection?.name) {
              errors.push(`ATLAS sectionId=${sectionId} not found in EnrollPro sections`);
              continue;
            }
            const gradeLevel = mapGradeLevel(epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name);
            if (gradeLevel) {
              teacherLoads.push({ smartTeacherId, subjectCode, sectionName: epSection.name, gradeLevel });
            }
          }
        } else if (nestedAssignments.length > 0 && nestedAssignments.some((a: any) => (a.sections ?? []).length > 0)) {
          for (const a of nestedAssignments) {
            const subjectCode = normalizeAtlasSubjectCode(a.subject?.code ?? '');
            if (!subjectCode) continue;
            const sections: any[] = a.sections ?? [];

            if (sections.length > MAX_SANE_SECTIONS) {
              logger.warn(`[AtlasSync] Rejecting broad nested assignment for ${subjectCode} (${sections.length} sections)`);
              continue;
            }

            for (const sec of sections) {
              if (!sec?.name) continue;
              const gradeLevel = mapGradeLevel(sec.gradeLevelName ?? sec.name);
              if (gradeLevel) {
                teacherLoads.push({ smartTeacherId, subjectCode, sectionName: sec.name, gradeLevel });
              }
            }
          }
        } else if (pubEntries.length > 0) {
          // The published schedule endpoint returns one entry per time slot.
          // Filter to this faculty only (defensive: endpoint may return all-school data)
          // and deduplicate by {subjectCode:sectionId} to collapse slots to unique teaching pairs.
          const seen = new Set<string>();
          for (const entry of pubEntries) {
            if (entry.facultyId != null && Number(entry.facultyId) !== af.id) continue;
            const subjectCode = normalizeAtlasSubjectCode(entry?.subjectCode);
            const sectionId = Number(entry?.sectionId);
            if (!subjectCode || !Number.isFinite(sectionId)) continue;
            const key = `${subjectCode}:${sectionId}`;
            if (seen.has(key)) continue; // deduplicate time slots
            seen.add(key);
            let epSection = epSectionById.get(sectionId);
            // Fallback: ATLAS and EnrollPro use different integer IDs for same section — match by name
            if (!epSection?.name && (entry?.sectionName || entry?.section?.name)) {
              const sectionName = (entry?.sectionName || entry?.section?.name || '').trim().toLowerCase();
              epSection = epSectionByName.get(sectionName) ?? null;
            }
            if (!epSection?.name) {
              errors.push(`ATLAS published sectionId=${sectionId} not found in EnrollPro sections`);
              continue;
            }
            const gradeLevel = mapGradeLevel(epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name);
            if (gradeLevel) {
              teacherLoads.push({ smartTeacherId, subjectCode, sectionName: epSection.name, gradeLevel });
            }
          }
        } else if (Array.isArray(af.facultySubjects) && af.facultySubjects.length > 0) {
          // Fallback: use facultySubjects list from the main /faculty response
          // This is often populated even when the detail/published endpoints are not.
          for (const fs of af.facultySubjects) {
            const subjectCode = normalizeAtlasSubjectCode(fs.subject?.code);
            if (!subjectCode) continue;
            const sectionIds: number[] = Array.isArray(fs.sectionIds) ? fs.sectionIds : [];
            for (const sid of sectionIds) {
              const epSection = epSectionById.get(sid);
              if (epSection?.name) {
                const gradeLevel = mapGradeLevel(epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name);
                if (gradeLevel) {
                  teacherLoads.push({ smartTeacherId, subjectCode, sectionName: epSection.name, gradeLevel });
                }
              }
            }
          }
        }

        if (teacherLoads.length === 0) continue;
        teachersWithLoads++;
        teacherIdsWithLoads.add(smartTeacherId);
        loads.push(...teacherLoads);
    }

    // 6. Data-safety note: stale-check runs ONLY for teachers who had ≥1 successfully resolved
    // load this cycle. Teachers whose loads could not be resolved (e.g. EnrollPro section-ID
    // lookup returned nothing) are excluded — their existing assignments must NOT be archived just
    // because this sync cycle couldn't confirm them. This prevents the bug where assignments are
    // repeatedly archived/re-created when the EnrollPro section lookup is temporarily unavailable.
    const matchedTeacherIds = Array.from(atlasIdToSmartTeacherId.values());
    const staleCandidateIds = Array.from(teacherIdsWithLoads);
    if (matchedTeacherIds.length > 0) {
      const skippedCount = matchedTeacherIds.length - staleCandidateIds.length;
      console.log(
        `[AtlasSync] Stale-check scope: ${staleCandidateIds.length}/${matchedTeacherIds.length} ` +
        `Atlas-matched teachers had loads resolved. ${skippedCount} teacher(s) skipped (no loads resolved — assignments preserved).`,
      );
    }

    const allSections = await prisma.section.findMany({ where: { schoolYear: schoolYearLabel } });
    const sectionByKey = new Map(allSections.map(s => [`${s.name.trim()}:${s.gradeLevel}`, s]));

    for (const load of loads) {
      const section = sectionByKey.get(`${load.sectionName.trim()}:${load.gradeLevel}`);
      if (!section) continue;

      const smartSubjectCode = resolveSubjectCode(load.subjectCode, section.gradeLevel);
      let subject = subjectByCode.get(smartSubjectCode);

      if (!subject) {
        const autoName = smartSubjectCode.startsWith('HG')
          ? HOMEROOM_GUIDANCE_LABEL
          : resolveSubjectName(smartSubjectCode, section.gradeLevel);
        subject = await prisma.subject.upsert({
          where: { code: smartSubjectCode },
          update: {},
          create: { code: smartSubjectCode, name: autoName, type: inferSubjectTypeFromCode(smartSubjectCode) },
        });
        subjectByCode.set(smartSubjectCode, subject);
        logger.debug(`[AtlasSync] Auto-created subject "${smartSubjectCode}" ("${autoName}")`);
      }

      await ensureHomeroomGuidanceLabel(subject, homeroomLabelUpdated);
      const teachingMinutes = subject.code.startsWith('HG') ? HOMEROOM_GUIDANCE_MINUTES : null;
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
          update: { teachingMinutes, isActive: true, archivedAt: null, archivedReason: null },
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

    // 5.3 Persist published schedule entries as ScheduleEntry records
    // ATLAS published schedule uses NESTED objects: entry.subject.code, entry.section.externalId, etc.
    // See AIMS integration guide for full schema reference.
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
          // Skip placeholder faculty entries (test/dummy data per AIMS guide)
          if (entry?.faculty?.isPlaceholder) continue;
          // ATLAS nested structure: entry.subject.code (not entry.subjectCode)
          const subjectCode = normalizeAtlasSubjectCode(entry?.subject?.code ?? entry?.subjectCode);
          if (!subjectCode) {
            skippedNoSubject++;
            logger.debug(`[AtlasSync] Skipped entry (no subject): day=${day} ${startTime}-${endTime} subject.raw=${JSON.stringify(entry?.subject)} label=${JSON.stringify(entry?.label ?? entry?.name ?? entry?.type)}`);
            continue;
          }
          // ATLAS nested structure: entry.section.externalId (EnrollPro section ID for cross-system matching)
          // Falls back to entry.section.id (backward-compatible alias) then entry.sectionId
          const sectionId = Number(entry?.section?.externalId ?? entry?.section?.id ?? entry?.sectionId);
          if (!Number.isFinite(sectionId)) {
            logger.debug(`[AtlasSync] Skipped entry (no section): day=${day} ${startTime}-${endTime} subject=${subjectCode} section.raw=${JSON.stringify(entry?.section)}`);
            continue;
          }
          let epSection = epSectionById.get(sectionId);
          // Fallback: match by section name from ATLAS nested response
          if (!epSection?.name) {
            const atlasSectionName = entry?.section?.name ?? entry?.sectionName;
            if (atlasSectionName) {
              epSection = epSectionByName.get(atlasSectionName.trim().toLowerCase()) ?? null;
            }
          }
          if (!epSection?.name) { skippedNoSection++; continue; }
          // ATLAS nested: entry.section.gradeLevelName or entry.section.gradeLevel (number)
          const gradeLevelRaw = epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name;
          const gradeLevel = mapGradeLevel(gradeLevelRaw);
          if (!gradeLevel) continue;
          // ATLAS nested: entry.room?.id (not entry.roomId)
          const roomId = entry?.room?.id ?? entry?.roomId ?? null;
          allScheduleEntries.push({
            teacherId: smartTeacherId, subjectCode, sectionName: epSection.name,
            gradeLevel, day, startTime, endTime, roomId: Number.isFinite(Number(roomId)) ? Number(roomId) : null,
            termIndex: Number.isFinite(Number(entry?.termIndex)) ? Number(entry.termIndex) : null,
          });
        }
      }

      if (allScheduleEntries.length > 0) {
        let scheduleCreated = 0;
        let scheduleCleaned = 0;
        const teacherIdsWithSchedule = new Set(allScheduleEntries.map(e => e.teacherId));

        const existingEntries = await prisma.scheduleEntry.findMany({
          where: { teacherId: { in: Array.from(teacherIdsWithSchedule) }, schoolYear: schoolYearLabel },
          select: { id: true, teacherId: true, subjectId: true, sectionId: true, day: true, startTime: true },
        });
        const existingByKey = new Map(
          existingEntries.map(e => [`${e.teacherId}:${e.subjectId}:${e.sectionId}:${e.day}:${e.startTime}`, e.id]),
        );

        for (const entry of allScheduleEntries) {
          const smartSubjectCode = resolveSubjectCode(entry.subjectCode, entry.gradeLevel);
          let subject = subjectByCode.get(smartSubjectCode);
          if (!subject) {
            try {
              subject = await prisma.subject.upsert({
                where: { code: smartSubjectCode },
                update: {},
                create: { code: smartSubjectCode, name: resolveSubjectName(smartSubjectCode, entry.gradeLevel), type: inferSubjectTypeFromCode(smartSubjectCode) },
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
      // Always log schedule diagnostics with school year info
      if (totalPubEntries > 0) {
        console.log(`[AtlasSync] Schedule diag: totalPub=${totalPubEntries}, skippedNoDay=${skippedNoDay}, skippedNoSubject=${skippedNoSubject}, skippedNoSection=${skippedNoSection}, resolved=${allScheduleEntries.length}, atlasSY=${atlasSchoolYearId}${discoveredPubYearId ? `, discoveredSY=${discoveredPubYearId}` : ''}`);
      } else {
        console.log(`[AtlasSync] Schedule diag: no published schedule entries found from ATLAS (tried atlasSY=${atlasSchoolYearId}, current-year${discoveredPubYearId ? `, discoveredSY=${discoveredPubYearId}` : ''})`);
      }
    }

    if (staleCandidateIds.length > 0) {
      const currentAssignments = await prisma.classAssignment.findMany({
        where: {
          teacherId: { in: staleCandidateIds },
          schoolYear: schoolYearLabel,
        },
        select: { id: true, teacherId: true, subjectId: true, sectionId: true, isActive: true },
      });

      let preservedMissingCount = 0;
      const reactivateIds: string[] = [];

      for (const assignment of currentAssignments) {
        const key = `${assignment.teacherId}:${assignment.subjectId}:${assignment.sectionId}`;
        const shouldBeActive = desiredAssignmentPairs.has(key);
        if (shouldBeActive && !assignment.isActive) {
          reactivateIds.push(assignment.id);
        } else if (!shouldBeActive && assignment.isActive) {
          preservedMissingCount++;
        }
      }

      // Batch reactivation
      if (reactivateIds.length > 0) {
        try {
          await prisma.classAssignment.updateMany({
            where: { id: { in: reactivateIds } },
            data: { isActive: true, archivedAt: null, archivedReason: null },
          });
        } catch (err: any) {
          logger.warn(`[AtlasSync] Batch reactivation failed: ${err.message}`);
        }
      }

      if (reactivateIds.length > 0 || preservedMissingCount > 0) {
        console.log(
          `[AtlasSync] Stale-check (safe mode): reactivated=${reactivateIds.length}, preservedMissing=${preservedMissingCount}.`,
        );
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

// ---------------------------------------------------------------------------
// Read-only ATLAS data helpers (for registrar proxy endpoints)
// ---------------------------------------------------------------------------

/**
 * Fetch teaching load summary from ATLAS.
 * GET /faculty-assignments/summary?schoolId=<id>&schoolYearId=<id>
 * Requires ATLAS_SYSTEM_TOKEN.
 */
export async function getAtlasTeachingLoadSummary(
  atlasSchoolYearId?: number,
): Promise<any> {
  const syId = atlasSchoolYearId ?? DEFAULT_ATLAS_SCHOOL_YEAR_ID;
  return atlasGet(`/faculty-assignments/summary?schoolId=${ATLAS_SCHOOL_ID}&schoolYearId=${syId}`);
}

/**
 * Fetch subject coverage (assigned vs unassigned) from ATLAS.
 * GET /subjects/stats/:schoolId
 * Requires ATLAS_SYSTEM_TOKEN.
 */
export async function getAtlasSubjectStats(): Promise<any> {
  return atlasGet(`/subjects/stats/${ATLAS_SCHOOL_ID}`);
}

// NOTE: Scheduling is now handled by syncCoordinator.ts.
// Call runAtlasSync() directly; do not add a scheduler here.
