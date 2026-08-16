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
import { atlasGet, ATLAS_BASE, ATLAS_SCHOOL_ID } from './sync/httpClient';
import {
  mapGradeLevel,
  resolveSubjectCode,
  resolveSubjectName,
  sanitizeSubjectName,
  normalizeSubjectLabel,
  ensureHomeroomGuidanceLabel,
  HOMEROOM_GUIDANCE_LABEL,
  HOMEROOM_GUIDANCE_MINUTES,
} from './atlasUtils';

const DEFAULT_ATLAS_SCHOOL_YEAR_ID = parseInt(process.env.ATLAS_SCHOOL_YEAR_ID ?? '3', 10);
const DEFAULT_SCHOOL_YEAR_LABEL = process.env.ENROLLPRO_SCHOOL_YEAR_LABEL ?? '2026-2027';

function normalizeAtlasSubjectCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  return email.toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/├æ/g, 'n')
    .replace(/ñ/g, 'n');
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
    const preferredLabel = process.env.ENROLLPRO_SCHOOL_YEAR_LABEL ?? settings?.currentSchoolYear ?? DEFAULT_SCHOOL_YEAR_LABEL;
    const resolvedSY = await resolveEnrollProSchoolYear(preferredLabel);
    const enrollProSchoolYearId = resolvedSY.id;
    const schoolYearLabel = resolvedSY.yearLabel;

    const atlasSchoolYearId = Number.isFinite(DEFAULT_ATLAS_SCHOOL_YEAR_ID)
      ? DEFAULT_ATLAS_SCHOOL_YEAR_ID
      : 8;
    logger.debug(
      `[AtlasSync] Using EnrollPro SY ${schoolYearLabel} (id=${enrollProSchoolYearId}, source=${resolvedSY.source}) and Atlas SY id=${atlasSchoolYearId}`,
    );

    // 1. Get all faculty from ATLAS
    const facultyData = await atlasGet(`/faculty?schoolId=${ATLAS_SCHOOL_ID}`);
    const atlasFaculty: any[] = facultyData.faculty ?? [];
    // Populate the in-memory cache so teacherSync reads from cache on teacher login
    if (atlasFaculty.length > 0) setCachedAtlasFaculty(atlasFaculty);

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
        await prisma.subject.create({
          data: { code, name: properName, type: 'CORE', ...rotationData },
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
    for (const subj of allSubjects) {
      const fixedName = sanitizeSubjectName(subj.name, subj.code);
      if (fixedName !== subj.name) {
        await prisma.subject.update({ where: { id: subj.id }, data: { name: fixedName } }).catch(() => {});
        subj.name = fixedName;
        logger.debug(`[AtlasSync] Fixed bad name: "${subj.code}" "${subj.name}" → "${fixedName}"`);
      }
    }

    // 5. Fetch teaching loads from ATLAS per faculty
    const loads: Array<{ smartTeacherId: string; subjectCode: string; sectionName: string; gradeLevel: GradeLevel }> = [];
    const desiredAssignmentPairs = new Set<string>();
    // Only teachers with at least 1 successfully resolved load are eligible for stale-check.
    // Teachers whose loads fail (e.g. section-ID lookup returns nothing in EnrollPro) are skipped
    // from the stale check so their existing assignments are not incorrectly archived.
    const teacherIdsWithLoads = new Set<string>();

    for (const af of atlasFaculty) {
      try {
        let detail = await atlasGet(
          `/faculty-assignments/${af.id}?schoolYearId=${atlasSchoolYearId}`,
        );
        let assignmentsPayload = detail?.assignments ?? detail?.data ?? detail ?? [];
        let assignments: any[] = Array.isArray(assignmentsPayload) ? assignmentsPayload : [];

        // Fallback: If primary schoolYearId returned no sectionIds, try alternate active schoolYearId (e.g. 6 or 1)
        const hasDirectSections = assignments.some(a => (a?.sectionIds && a.sectionIds.length > 0) || (a?.sections && a.sections.length > 0));
        if (!hasDirectSections) {
          const fallbackSYs = [3, 6, 1, 8].filter(id => id !== atlasSchoolYearId);
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
        if (!smartTeacherId) continue;

        const flatAssignments = assignments.filter((a) => a && (a.subjectCode || a.sectionId));
        const nestedAssignments = assignments.filter((a) => a && (a.subject?.code || a.sections));
          // Fetch published schedule when there are no assignments at all, OR when flat
          // assignments only have grade-level data (no sectionId) — Atlas /faculty-assignments
          // returns subject+gradeLevel only; section specifics come from the published schedule.
          const hasSectionIds = flatAssignments.some((a) => a?.sectionId ?? a?.section?.id);
          const pubEntries: any[] = (!hasSectionIds)
          ? await (async () => {
              try {
                const pubData = await atlasGet(`/schools/${ATLAS_SCHOOL_ID}/schedules/published/faculty/${af.id}`);
                return Array.isArray(pubData?.entries) ? pubData.entries : [];
              } catch (error: any) {
                errors.push(`Faculty ${af.firstName} ${af.lastName} published schedule: ${error?.message ?? error}`);
                return [];
              }
            })()
          : [];

        const teacherLoads: Array<{ smartTeacherId: string; subjectCode: string; sectionName: string; gradeLevel: GradeLevel }> = [];
        const MAX_SANE_SECTIONS = 10;

        if (flatAssignments.length > 0 && flatAssignments.some(a => a?.sectionId ?? a?.section?.id)) {
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
            const epSection = epSectionById.get(sectionId);
            if (!epSection?.name) {
              errors.push(`ATLAS sectionId=${sectionId} not found in EnrollPro sections`);
              continue;
            }
            const gradeLevel = mapGradeLevel(epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name);
            if (gradeLevel) {
              teacherLoads.push({ smartTeacherId, subjectCode, sectionName: epSection.name, gradeLevel });
            }
          }
        } else if (nestedAssignments.length > 0 && nestedAssignments.some(a => (a.sections ?? []).length > 0)) {
          for (const a of nestedAssignments) {
            const subjectCode = normalizeAtlasSubjectCode(a.subject?.code ?? '');
            if (!subjectCode) continue;
            let sections: any[] = a.sections ?? [];

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
            const epSection = epSectionById.get(sectionId);
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
      } catch (err: any) {
        errors.push(`Faculty ${af.firstName} ${af.lastName}: ${err.message}`);
      }
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
          create: { code: smartSubjectCode, name: autoName, type: 'CORE' },
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
      } catch { /* duplicate or constraint */ }
    }

    if (staleCandidateIds.length > 0) {
      const currentAssignments = await prisma.classAssignment.findMany({
        where: {
          teacherId: { in: staleCandidateIds },
          schoolYear: schoolYearLabel,
        },
        select: { id: true, teacherId: true, subjectId: true, sectionId: true, isActive: true },
      });

      let reactivatedCount = 0;
      let preservedMissingCount = 0;

      for (const assignment of currentAssignments) {
        const key = `${assignment.teacherId}:${assignment.subjectId}:${assignment.sectionId}`;
        const shouldBeActive = desiredAssignmentPairs.has(key);
        if (shouldBeActive && !assignment.isActive) {
          await prisma.classAssignment.update({
            where: { id: assignment.id },
            data: { isActive: true, archivedAt: null, archivedReason: null },
          });
          reactivatedCount++;
        } else if (!shouldBeActive && assignment.isActive) {
          // Preserve existing assignment when a sync cycle cannot prove it is stale.
          // This avoids false negative "-1 section" drops during partial ATLAS payloads.
          preservedMissingCount++;
        }
      }

      if (reactivatedCount > 0 || preservedMissingCount > 0) {
        console.log(
          `[AtlasSync] Stale-check (safe mode): reactivated=${reactivatedCount}, preservedMissing=${preservedMissingCount}.`,
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
