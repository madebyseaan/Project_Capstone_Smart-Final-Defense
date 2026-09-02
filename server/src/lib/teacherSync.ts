/**
 * teacherSync.ts
 *
 * Per-teacher real-time data sync triggered on login or background refresh.
 * Pulls advisory + student data from EnrollPro and teaching load from Atlas.
 *
 * Data flow (read-only from external systems):
 *   EnrollPro → advisory section + section students → SMART Students / Enrollments
 *   Atlas     → faculty-assignments (subject + section) → SMART ClassAssignments
 *   EnrollPro → teaching section students → SMART Students / Enrollments
 *
 * SMART only writes to its own smart_db. Never writes to EnrollPro or Atlas.
 * See DATA_ALIGNMENT.md for full field mapping documentation.
 */

import { prisma } from './prisma';
import { logger } from './logger';
import {
  findEnrollProTeacherByEmployeeId,
  findIntegrationV1FacultyByEmployeeId,
  getEnrollProSectionRoster,
  getEnrollProSections,
  getAllIntegrationV1SectionLearners,
} from './enrollproClient';
import {
  getCachedEnrollProTeachers,
  getCachedIntegrationV1Sections,
  getCachedSchoolYear,
  getCachedAtlasFaculty,
  setCachedAtlasFaculty,
  getCachedEffectiveTeachingLoad,
} from './syncCache';
import { syncAdvisoryWorkloadEntry } from './workload';
import type { GradeLevel } from '@prisma/client';
import {
  mapGradeLevel,
  resolveSubjectCode,
  normalizeSubjectLabel,
  ensureHomeroomGuidanceLabel,
  HOMEROOM_GUIDANCE_LABEL,
  HOMEROOM_GUIDANCE_MINUTES,
} from './atlasUtils';
import { atlasGet, ATLAS_SCHOOL_ID, resolveAtlasSchoolYear, DEFAULT_ATLAS_SCHOOL_YEAR_ID } from './sync/httpClient';
import {
  upsertLearner,
  dropStaleEnrollments,
  upsertSection,
} from './sync/utils';

import { getActiveSchoolYearLabel } from './schoolYearResolver';
import { getEnrollProSchoolYearId } from '../config/schoolEnv';
const DEFAULT_ENROLLPRO_SCHOOL_YEAR_ID = getEnrollProSchoolYearId();

// ---------------------------------------------------------------------------
// Upsert a learner (student + enrollment) into SMART
// ---------------------------------------------------------------------------
// Main per-teacher sync
// ---------------------------------------------------------------------------

export interface TeacherSyncResult {
  employeeId: string;
  advisorySection: string | null;
  studentsFound: number;
  studentsUpserted: number;
  classAssignmentsCreated: number;
  classAssignmentsFromAtlas: number;
  errors: string[];
}

/**
 * Syncs a single teacher's data from EnrollPro + Atlas.
 * Call this after teacher login — does not block the response.
 *
 * @param smartTeacherId  SMART DB teacher.id (cuid)
 * @param employeeId      DepEd employee ID string (e.g. "3179586")
 * @param email           Teacher's email (used to match Atlas faculty)
 */
export async function syncTeacherOnLogin(
  smartTeacherId: string,
  employeeId: string,
  email: string,
): Promise<TeacherSyncResult> {
  const result: TeacherSyncResult = {
    employeeId,
    advisorySection: 'none',
    studentsFound: 0,
    studentsUpserted: 0,
    classAssignmentsCreated: 0,
    classAssignmentsFromAtlas: 0,
    errors: [],
  };

  // ── 1. Resolve sync school year ────────────────────────────────────────
  // Source of truth is SMART system setting (currentSchoolYear), then we
  // resolve the matching EnrollPro schoolYearId from /school-years.
  // If lookup fails, fall back to EnrollPro active SY, then static defaults.
  let schoolYearId = DEFAULT_ENROLLPRO_SCHOOL_YEAR_ID;
  let schoolYearLabel = 'loading...'; // will be set by resolver below
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
    const preferredLabel = settings?.currentSchoolYear ?? await getActiveSchoolYearLabel();
    const resolvedSY = await getCachedSchoolYear(preferredLabel);
    schoolYearId = resolvedSY.id;
    schoolYearLabel = resolvedSY.yearLabel;
    logger.debug(
      `[TeacherSync] Using school year ${schoolYearLabel} (id=${schoolYearId}) from ${resolvedSY.source}`,
    );
  } catch {
    logger.warn('[TeacherSync] Could not resolve school year from EnrollPro, using defaults');
  }

  // Resolve Atlas school year dynamically (runtime/context → env fallback)
  let atlasSchoolYearId = DEFAULT_ATLAS_SCHOOL_YEAR_ID;
  try {
    const resolvedAtlasSY = await resolveAtlasSchoolYear();
    atlasSchoolYearId = resolvedAtlasSY.id;
    logger.debug(`[TeacherSync] Using Atlas SY id=${atlasSchoolYearId} (source=${resolvedAtlasSY.source})`);
  } catch {
    logger.warn('[TeacherSync] Could not resolve Atlas school year, using env default');
  }

  // epTeacherId is the EnrollPro integer teacherId — used to match Atlas externalId
  let epTeacherId: number | null = null;
  let advisorySectionSmartId: string | null = null;
  let advisorySectionGradeLevel: GradeLevel | null = null;

  const resolveAdvisoryFromSections = async (): Promise<boolean> => {
    // FORCE fresh fetch on login to ensure absolute real-time section mappings
    const teachers = await getCachedEnrollProTeachers(true);
    const teacherRecord = teachers.find((t) => String(t.employeeId ?? '').trim() === String(employeeId).trim());
    if (!teacherRecord) {
      return false;
    }

    epTeacherId = Number((teacherRecord as any).teacherId ?? teacherRecord.id);
    const sections = await getCachedIntegrationV1Sections(schoolYearId, true);
    const mySections = sections
      .filter((s: any) =>
        String(s?.advisingTeacher?.employeeId ?? s?.adviser?.employeeId ?? '').trim() === String(employeeId).trim() ||
        Number(s?.advisingTeacher?.id ?? s?.adviser?.id) === Number(epTeacherId)
      );

    if (mySections.length === 0) {
      return false;
    }

    // Process all sections assigned to this teacher in EnrollPro
    // Aggregate learners into the primary SMART section (keyed by name)
    const totalLearners: any[] = [];
    
    for (const mySection of mySections) {
      const gradeLevel = mapGradeLevel(mySection.gradeLevel?.name ?? mySection.gradeLevelName ?? mySection.name);
      if (!gradeLevel) {
        result.errors.push(`Could not determine grade level for advisory section "${mySection.name}"`);
        continue;
      }

      if (!result.advisorySection) result.advisorySection = mySection.name;
      
      const section = await upsertSection(
        mySection.name,
        gradeLevel,
        schoolYearLabel,
        smartTeacherId,
      );
      advisorySectionSmartId = section.id;
      advisorySectionGradeLevel = gradeLevel;

      const learners = await getAllIntegrationV1SectionLearners(Number(mySection.id));
      totalLearners.push(...learners);
      logger.debug(`[TeacherSync] Advisory "${mySection.name}" (EP id=${mySection.id}): ${learners.length} learners`);

      for (const rec of learners) {
        const learner = rec.learner ?? rec;
        try {
          const ok = await upsertLearner(learner, section.id, schoolYearLabel);
          if (ok) result.studentsUpserted++;
        } catch (err: any) {
          result.errors.push(`Advisory LRN ${learner?.lrn}: ${err.message}`);
        }
      }
    }

    result.studentsFound = totalLearners.length;

    // Drop students who are no longer in EnrollPro for this section (aggregated check)
    if (advisorySectionSmartId) {
      try {
        const dropped = await dropStaleEnrollments(advisorySectionSmartId, schoolYearLabel, totalLearners);
        if (dropped > 0) logger.debug(`[TeacherSync] Dropped ${dropped} stale enrollment(s) for "${result.advisorySection}"`);
      } catch (err: any) {
        result.errors.push(`Stale enrollment cleanup: ${err.message}`);
      }
    }

    return true;
  };

  // ── 2. EnrollPro: Get teacher record + advisory section ─────────────────
  try {
    const sectionsSynced = await resolveAdvisoryFromSections();

    if (!sectionsSynced) {
      const epFaculty = await findIntegrationV1FacultyByEmployeeId(employeeId, schoolYearId);

      if (epFaculty) {
        // Store EnrollPro teacherId — used to match Atlas faculty via externalId
        epTeacherId = epFaculty.teacherId;

        if (epFaculty.isClassAdviser && epFaculty.advisorySectionId && epFaculty.advisorySectionName) {
          // Prefer explicit grade level field; fall back to parsing section name
          const gradeLevelRaw =
            epFaculty.advisorySectionGradeLevelName ?? epFaculty.advisorySectionName;
          const gradeLevel = mapGradeLevel(gradeLevelRaw);
          result.advisorySection = epFaculty.advisorySectionName;

          logger.debug(`[TeacherSync] Advisory: ${epFaculty.advisorySectionName} gl=${gradeLevel ?? 'unknown'}`);

          if (gradeLevel) {
            // Upsert the section in SMART and mark this teacher as adviser
            const section = await upsertSection(
              epFaculty.advisorySectionName,
              gradeLevel,
              schoolYearLabel,
              smartTeacherId,
            );
            advisorySectionSmartId = section.id;
            advisorySectionGradeLevel = gradeLevel;

            const learners = await getAllIntegrationV1SectionLearners(epFaculty.advisorySectionId);
            result.studentsFound = learners.length;
            logger.debug(`[TeacherSync] Advisory "${section.name}": ${learners.length} learners`);

            for (const rec of learners) {
              const learner = rec.learner ?? rec;
              try {
                const ok = await upsertLearner(learner, section.id, schoolYearLabel);
                if (ok) result.studentsUpserted++;
              } catch (err: any) {
                result.errors.push(`Advisory LRN ${learner?.lrn}: ${err.message}`);
              }
            }

            // Drop students who are no longer in EnrollPro for this section.
            try {
              const dropped = await dropStaleEnrollments(section.id, schoolYearLabel, learners);
              if (dropped > 0) logger.debug(`[TeacherSync] Dropped ${dropped} stale enrollment(s) for "${section.name}"`);
            } catch (err: any) {
              result.errors.push(`Stale enrollment cleanup: ${err.message}`);
            }
          } else {
            result.errors.push(`Could not determine grade level for "${epFaculty.advisorySectionName}"`);
          }
        } else {
          logger.debug(`[TeacherSync] No advisory for employeeId=${employeeId}`);
          result.errors.push('EnrollPro faculty record has no advisory assignment for current school year');
        }
      } else {
        logger.debug(`[TeacherSync] Teacher not found in EnrollPro faculty feed for employeeId=${employeeId}`);
        result.errors.push('Teacher not found in EnrollPro integration faculty feed for current school year');
      }
    }

    // Fallback path: some EnrollPro deployments may miss teachers in
    // /integration/v1/faculty but still provide advisory in /integration/v1/sections.
    // If we still don't have an advisory after faculty lookup, use teacherId + sections feed.
    if (!advisorySectionSmartId) {
      const epTeacher = await findEnrollProTeacherByEmployeeId(employeeId);
      if (epTeacher?.id) {
        if (epTeacherId == null) {
          epTeacherId = Number(epTeacher.id);
        }

        const sections = await getCachedIntegrationV1Sections(schoolYearId);
        const mySections = sections
          .filter((s: any) => Number(s?.advisingTeacher?.id) === Number(epTeacher.id));

        if (mySections.length > 0) {
          const totalLearners: any[] = [];
          
          for (const mySection of mySections) {
            const gradeLevel =
              mapGradeLevel(mySection.gradeLevel?.name ?? mySection.gradeLevelName ?? mySection.name);

            if (gradeLevel) {
              if (!result.advisorySection) result.advisorySection = mySection.name;

              const section = await upsertSection(
                mySection.name,
                gradeLevel,
                schoolYearLabel,
                smartTeacherId,
              );
              advisorySectionSmartId = section.id;
              advisorySectionGradeLevel = gradeLevel;

              const learners = await getAllIntegrationV1SectionLearners(Number(mySection.id));
              totalLearners.push(...learners);
              console.log(
                `[TeacherSync] Advisory fallback via sections: ${mySection.name} ` +
                `(EP sectionId=${mySection.id}) learners=${learners.length}`,
              );

              for (const rec of learners) {
                const learner = rec.learner ?? rec;
                try {
                  const ok = await upsertLearner(learner, section.id, schoolYearLabel);
                  if (ok) result.studentsUpserted++;
                } catch (err: any) {
                  result.errors.push(`Advisory fallback LRN ${learner?.lrn}: ${err.message}`);
                }
              }
            }
          }
          
          result.studentsFound = totalLearners.length;

          // Drop students who are no longer in EnrollPro (aggregated check)
          if (advisorySectionSmartId) {
            try {
              const dropped = await dropStaleEnrollments(advisorySectionSmartId, schoolYearLabel, totalLearners);
              if (dropped > 0) logger.debug(`[TeacherSync] Dropped ${dropped} stale enrollment(s) for "${result.advisorySection}" (fallback)`);
            } catch (err: any) {
              result.errors.push(`Stale enrollment cleanup fallback: ${err.message}`);
            }
          }
        } else {
          logger.debug(`[TeacherSync] Advisory fallback: no section found for EP teacherId=${epTeacher.id}`);
          result.errors.push('EnrollPro sections feed has no advisory section mapped to this teacher for current school year');
        }
      } else {
        logger.debug(`[TeacherSync] Advisory fallback: no EnrollPro teacher record for employeeId=${employeeId}`);
        result.errors.push('Teacher not found in EnrollPro teachers endpoint by employee ID');
      }
    }
  } catch (err: any) {
    result.errors.push(`EnrollPro advisory sync failed: ${err.message}`);
    logger.error(`[TeacherSync] EnrollPro error: ${err.message}`);
  }

  // Keep adviser assignment in SMART aligned with current EnrollPro state.
  // A teacher should have at most one advisory section per school year.
  // IMPORTANT: Only clear OTHER advisory links if we positively confirmed a NEW one.
  // Never clear advisory links when EnrollPro lookup simply failed — that would
  // destroy ATLAS-sourced advisory assignments (set by runAtlasSync) on every login.
  try {
    if (advisorySectionSmartId) {
      // We confirmed a new advisory — clear any stale duplicates for this teacher+year.
      await prisma.section.updateMany({
        where: {
          adviserId: smartTeacherId,
          schoolYear: schoolYearLabel,
          id: { not: advisorySectionSmartId },
        } as any,
        data: { adviserId: null },
      });
    } else {
      // No advisory found in EnrollPro. Do NOT clear existing links — EnrollPro may not
      // have this teacher yet (enrollment opens June 1), or the employee ID lookup may
      // have failed due to a format mismatch. The global runAtlasSync() is the
      // authoritative cleanup mechanism for stale advisory links.
      console.log(
        `[TeacherSync] Advisory not found in EnrollPro for employeeId=${employeeId}. ` +
        `Preserving any existing advisory links set by AtlasSync.`,
      );
    }
  } catch (err: any) {
    result.errors.push(`Advisory cleanup failed: ${err.message}`);
    logger.error(`[TeacherSync] Advisory cleanup error: ${err.message}`);
  }

  // ── 3. Atlas: Get teaching load (subject + section assignments) ─────────
  try {
    if (!process.env.ATLAS_SYSTEM_TOKEN) throw new Error('ATLAS_SYSTEM_TOKEN not set');

// Use cached Atlas faculty list if available (populated by background sync)
        // Fall back to a live fetch on cache miss so login always works.
        let atlasFaculty: any[] = getCachedAtlasFaculty() ?? [];
        if (atlasFaculty.length === 0) {
          const facultyData = await atlasGet(`/faculty?schoolId=${ATLAS_SCHOOL_ID}`);
          atlasFaculty = facultyData?.faculty ?? [];
          if (atlasFaculty.length > 0) setCachedAtlasFaculty(atlasFaculty);
        }

    // Identity resolution policy:
    // 1) Match direct employeeId (e.g. "1000018") - strongest cross-system link
    // 2) Exact Atlas contactInfo / email match to user email
    // 3) Match externalId against EnrollPro teacher ID
    // 4) Exact name match
    const cleanEmpId = String(employeeId || '').trim();
    const atlasByEmpId = cleanEmpId
      ? atlasFaculty.find((f) => String(f.employeeId ?? '').trim() === cleanEmpId)
      : undefined;
    const atlasByEmail = atlasFaculty.find(
      (f) => (f.contactInfo ?? '').toLowerCase() === email.toLowerCase() ||
             (f.email ?? '').toLowerCase() === email.toLowerCase(),
    );
    const atlasByExternalId = epTeacherId != null
      ? atlasFaculty.find((f) => Number(f.externalId) === Number(epTeacherId))
      : undefined;

    const atlasMember = atlasByEmpId ?? atlasByEmail ?? atlasByExternalId;

    if (atlasByEmpId) {
      logger.debug(`[TeacherSync] Atlas: matched via employeeId=${employeeId} -> atlas.id=${atlasByEmpId.id}`);
    } else if (atlasByEmail) {
      logger.debug(`[TeacherSync] Atlas: matched via email id=${atlasByEmail.id}`);
    } else if (atlasByExternalId) {
      logger.debug(`[TeacherSync] Atlas: matched via externalId=${epTeacherId} -> atlas.id=${atlasByExternalId.id}`);
    }

    if (!atlasMember) {
      logger.debug(`[TeacherSync] Atlas: no faculty match for employeeId=${employeeId} email=${email}`);
    } else {
      logger.debug(`[TeacherSync] Atlas: matched faculty id=${atlasMember.id}`);

      // Read from cached effective teaching load (populated by background atlasSync).
      // This is the ATLAS contract-compliant source. EMPTY = valid, no cross-year fallback.
      let effectiveLoad = getCachedEffectiveTeachingLoad(ATLAS_SCHOOL_ID, atlasSchoolYearId) ?? undefined;
      if (!effectiveLoad) {
        // Cache miss — background sync hasn't run yet for this year. Fetch live.
        const { fetchEffectiveTeachingLoad } = await import('./sync/httpClient');
        effectiveLoad = (await fetchEffectiveTeachingLoad(atlasSchoolYearId)) ?? undefined;
      }

      const effectiveAssignments = effectiveLoad?.assignments ?? [];
      const effectiveFaculty = effectiveAssignments.filter(
        (a: any) => Number(a.facultyId) === Number(atlasMember.id),
      );

      // Build ATLAS subjectId → code lookup for mapping effective assignments
      const atlasSubjectIdToCode = new Map<number, string>();
      try {
        const atlasSubjectsData = await atlasGet(`/subjects?schoolId=${ATLAS_SCHOOL_ID}`);
        const atlasSubjs: any[] = atlasSubjectsData.subjects ?? [];
        for (const s of atlasSubjs) {
          if (s.id && s.code) atlasSubjectIdToCode.set(Number(s.id), (s.code ?? '').trim().toUpperCase());
        }
      } catch { /* non-critical */ }

      const flatAssignments: any[] = effectiveFaculty.map((a: any) => ({
        subjectCode: atlasSubjectIdToCode.get(Number(a.subjectId)) ?? String(a.subjectId),
        sectionId: a.sectionId,
      }));
      const nestedAssignments: any[] = [];

      // Always try published schedule first. It is the most specific source for
      // actual teacher-to-section assignments and avoids broad over-assignment.
      let pubEntries: any[] = [];
      try {
        const pubData = await atlasGet(
          `/schools/${ATLAS_SCHOOL_ID}/schedules/published/faculty/${atlasMember.id}?termIndex=active`,
        );
        pubEntries = pubData?.entries ?? [];
      } catch (e: any) {
        logger.warn(`[TeacherSync] Atlas published schedule lookup failed: ${e?.message ?? e}`);
      }

      const homeroomLabelUpdated = new Set<string>();
      const desiredAssignmentPairs = new Set<string>();
      const rememberDesiredAssignment = (subjectId: string, sectionId: string) => {
        desiredAssignmentPairs.add(`${subjectId}:${sectionId}`);
      };

      if (pubEntries.length > 0) {
        logger.debug(`[TeacherSync] Atlas published: ${pubEntries.length} schedule entries`);
        result.classAssignmentsFromAtlas = pubEntries.length;

        // Filter out entries with missing sectionId before processing
        const validEntries = pubEntries.filter((e: any) => e.sectionId != null);
        const skippedMissingSectionId = pubEntries.length - validEntries.length;
        if (skippedMissingSectionId > 0) {
          logger.warn(
            `[TeacherSync] Skipped ${skippedMissingSectionId} ATLAS schedule entr${skippedMissingSectionId === 1 ? 'y' : 'ies'} with missing sectionId`,
          );
        }

        // Build subject + section lookups
        const allSubjectsP = await prisma.subject.findMany();
        const subjectByCodeP = new Map(allSubjectsP.map((s) => [s.code, s]));
        // Atlas sectionId in published schedule = EnrollPro section ID (integer)
        // Fetch EP sections to map ID -> name + grade level
        let epSectionsP = await getCachedIntegrationV1Sections(schoolYearId);
        if (epSectionsP.length === 0) {
          epSectionsP = await getCachedIntegrationV1Sections();
        }
        const epSectionByIdP = new Map<number, any>(epSectionsP.map((s: any) => [Number(s.id), s]));
        // Build name-based lookup for fallback (ATLAS and EP use different integer IDs)
        const epSectionByNameP = new Map<string, any>();
        for (const s of epSectionsP) {
          if (s?.name) epSectionByNameP.set(s.name.trim().toLowerCase(), s);
        }

        for (const entry of validEntries) {
          const atlasCode = normalizeSubjectLabel(entry.subjectCode ?? '');
          let epSection = epSectionByIdP.get(Number(entry.sectionId));
          // Fallback: ATLAS and EnrollPro use different integer IDs for same section — match by name
          if (!epSection && (entry?.sectionName || entry?.section?.name)) {
            const sectionName = (entry?.sectionName || entry?.section?.name || '').trim().toLowerCase();
            epSection = epSectionByNameP.get(sectionName) ?? null;
          }
          if (!epSection) {
            logger.warn(
              `[TeacherSync] System ID Mismatch: ATLAS sectionId=${entry.sectionId} not found in EnrollPro sections`,
            );
            result.errors.push(
              `System ID Mismatch: ATLAS sectionId=${entry.sectionId} not found in EnrollPro sections`,
            );
            continue;
          }
          const gradeLevel = mapGradeLevel(epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name);
          if (!gradeLevel) continue;
          const section = await upsertSection(epSection.name, gradeLevel, schoolYearLabel);
          const smartCode = resolveSubjectCode(atlasCode, gradeLevel);
          const subject = subjectByCodeP.get(smartCode) ?? subjectByCodeP.get(atlasCode);
          if (!subject) {
            console.warn(
              `[TeacherSync] MISSING SUBJECT MAPPING: Atlas code "${entry.subjectCode}" ` +
              `(resolved "${smartCode}") for section "${epSection.name}" grade=${gradeLevel}. ` +
              `Skipping - add this subject to SMART to enable this assignment.`,
            );
            result.errors.push(`MISSING SUBJECT MAPPING: Atlas code "${entry.subjectCode}" (resolved "${smartCode}") - add to SMART subjects`);
            continue;
          }
          await ensureHomeroomGuidanceLabel(subject, homeroomLabelUpdated);
          const teachingMinutes = subject.code.startsWith('HG') ? HOMEROOM_GUIDANCE_MINUTES : null;
          rememberDesiredAssignment(subject.id, section.id);
          try {
            await (prisma.classAssignment as any).upsert({
              where: { teacherId_subjectId_sectionId_schoolYear: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel } },
              update: { teachingMinutes, isActive: true, archivedAt: null, archivedReason: null },
              create: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel, teachingMinutes, isActive: true },
            });
            result.classAssignmentsCreated++;
          } catch { /* concurrent duplicate */ }
        }
      } else if (nestedAssignments.length > 0) {
        // assignments have subject + specific sections array
        logger.debug(`[TeacherSync] Atlas assignments: ${nestedAssignments.length} subject-section assignments`);
        result.classAssignmentsFromAtlas = nestedAssignments.length;

        const allSubjectsA = await prisma.subject.findMany();
        const subjectByCodeA = new Map(allSubjectsA.map((s) => [s.code, s]));
        const allSectionsA = await prisma.section.findMany({ where: { schoolYear: schoolYearLabel } });
        const sectionByKeyA = new Map(allSectionsA.map((s) => [`${s.name.trim()}:${s.gradeLevel}`, s]));

        // Pre-resolve EnrollPro sections for fallback lookup if needed
        let epSectionsSync: any[] | null = null;
        let epSectionByIdSync: Map<number, any> | null = null;

        for (const assignment of nestedAssignments) {
          const atlasCode = normalizeSubjectLabel(assignment.subject?.code ?? '');
          let atlasSections: any[] = assignment.sections ?? [];

          // ... (fallback logic omitted for brevity in replace tool, but included in actual replacement)
          if (atlasSections.length === 0) {
            const fs = (atlasMember.facultySubjects || []).find((s: any) => 
              (s.subjectId && assignment.subjectId && s.subjectId === assignment.subjectId) || 
              (s.subject?.id && assignment.subject?.id && s.subject.id === assignment.subject.id) ||
              (s.subject?.code && assignment.subject?.code && s.subject.code === assignment.subject.code)
            );
            if (fs && fs.sectionIds && fs.sectionIds.length > 0) {
              if (!epSectionsSync) {
                epSectionsSync = await getCachedIntegrationV1Sections(schoolYearId);
                if (!epSectionsSync || epSectionsSync.length === 0) epSectionsSync = await getCachedIntegrationV1Sections();
                epSectionByIdSync = new Map<number, any>((epSectionsSync || []).map((s: any) => [Number(s.id), s]));
              }
              atlasSections = fs.sectionIds.map((id: number) => {
                const ep = epSectionByIdSync!.get(Number(id));
                return ep ? { id, name: ep.name, gradeLevelName: ep.gradeLevel?.name || ep.gradeLevelName } : null;
              }).filter(Boolean);
              
              if (atlasSections.length > 0) {
                logger.debug(`[TeacherSync] Fallback: recovered ${atlasSections.length} section(s) for ${atlasCode} from facultySubjects`);
              }
            }
          }

          // Trust Gate: Reject or cap broad fallback assignments (untrusted sources)
          const MAX_SANE_SECTIONS = 10;
          if (atlasSections.length > MAX_SANE_SECTIONS) {
            const advisoryName = result.advisorySection;
            const capped = atlasSections.filter((s: any) => s.name === advisoryName);
            if (capped.length > 0) {
              logger.debug(`[TeacherSync] Broad Atlas assignment for ${atlasCode} (${atlasSections.length} sections) capped to advisory section "${advisoryName}"`);
              atlasSections = capped;
            } else {
              logger.warn(`[TeacherSync] Rejecting broad Atlas assignment for ${atlasCode}: ${atlasSections.length} sections. Threshold is ${MAX_SANE_SECTIONS}.`);
              result.errors.push(`Broad Atlas assignment rejected for ${atlasCode} (${atlasSections.length} sections). Please use published schedule.`);
              continue;
            }
          }

          for (const atlasSection of atlasSections) {
            // Grade level from Atlas section data (most reliable)
            const gradeLevel =
              mapGradeLevel(atlasSection.gradeLevelName) ??
              mapGradeLevel(atlasSection.name);
            if (!gradeLevel) {
              logger.debug(`[TeacherSync] Assignments: cannot map grade level for "${atlasSection.name}"`);
              continue;
            }

            // Find or create the section in SMART
            let section = sectionByKeyA.get(`${atlasSection.name?.trim()}:${gradeLevel}`);
            if (!section) {
              section = await upsertSection(atlasSection.name, gradeLevel, schoolYearLabel);
              if (section) {
                sectionByKeyA.set(`${atlasSection.name?.trim()}:${gradeLevel}`, section);
              }
              logger.debug(`[TeacherSync] Created missing section "${atlasSection.name}"`);
            }
            if (!section) continue;

            // Resolve SMART subject code: "FIL" + grade 7 -> "FIL7"; ENV_SCI -> ENVIRONMENTAL_SCIENCE7
            const smartCode = resolveSubjectCode(atlasCode, gradeLevel);
            const subject = subjectByCodeA.get(smartCode) ?? subjectByCodeA.get(atlasCode);
            if (!subject) {
              console.warn(
                `[TeacherSync] MISSING SUBJECT MAPPING: Atlas code "${atlasCode}" ` +
                `(resolved "${smartCode}") for section "${atlasSection.name}" grade=${gradeLevel}. ` +
                `Skipping - add this subject to SMART to enable this assignment.`,
              );
              result.errors.push(`MISSING SUBJECT MAPPING: Atlas code "${atlasCode}" (resolved "${smartCode}") - add to SMART subjects`);
              continue;
            }

            await ensureHomeroomGuidanceLabel(subject, homeroomLabelUpdated);
            const teachingMinutes = subject.code.startsWith('HG') ? HOMEROOM_GUIDANCE_MINUTES : null;
            rememberDesiredAssignment(subject.id, section.id);

            try {
              await (prisma.classAssignment as any).upsert({
                where: { teacherId_subjectId_sectionId_schoolYear: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel } },
                update: { teachingMinutes, isActive: true, archivedAt: null, archivedReason: null },
                create: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel, teachingMinutes, isActive: true },
              });
              result.classAssignmentsCreated++;
              logger.debug(`[TeacherSync] Upserted: ${subject.code} -> ${section.name}`);
            } catch { /* concurrent duplicate */ }
          }
        }
      } else if (flatAssignments.length > 0) {
        logger.debug(`[TeacherSync] Atlas assignments: ${flatAssignments.length} subject-section assignments (flat)`);
        result.classAssignmentsFromAtlas = flatAssignments.length;

        // Trust Gate: Group by subject to detect broad over-assignment in flat payload
        const flatBySubject = new Map<string, number>();
        for (const a of flatAssignments) {
          const code = normalizeSubjectLabel(a?.subjectCode ?? a?.subject?.code);
          if (code) flatBySubject.set(code, (flatBySubject.get(code) || 0) + 1);
        }

        let epSectionsF = await getCachedIntegrationV1Sections(schoolYearId);
        if (epSectionsF.length === 0) {
          epSectionsF = await getCachedIntegrationV1Sections();
        }
        const epSectionByIdF = new Map<number, any>(epSectionsF.map((s: any) => [Number(s.id), s]));
        // Build name-based lookup for fallback (ATLAS and EP use different integer IDs)
        const epSectionByNameF = new Map<string, any>();
        for (const s of epSectionsF) {
          if (s?.name) epSectionByNameF.set(s.name.trim().toLowerCase(), s);
        }
        const allSubjectsF = await prisma.subject.findMany();
        const subjectByCodeF = new Map(allSubjectsF.map((s) => [s.code, s]));
        const allSectionsF = await prisma.section.findMany({ where: { schoolYear: schoolYearLabel } });
        const sectionByKeyF = new Map(allSectionsF.map((s) => [`${s.name.trim()}:${s.gradeLevel}`, s]));

        for (const assignment of flatAssignments) {
          const atlasCode = normalizeSubjectLabel(assignment?.subjectCode ?? assignment?.subject?.code);
          const sectionId = Number(assignment?.sectionId);
          if (!atlasCode || !Number.isFinite(sectionId)) continue;

          // Trust Gate: Cap to advisory if broad
          const MAX_SANE_SECTIONS = 10;
          if ((flatBySubject.get(atlasCode) || 0) > MAX_SANE_SECTIONS) {
            let epSection = epSectionByIdF.get(sectionId);
            if (!epSection && (assignment?.sectionName || assignment?.section?.name)) {
              const sectionName = (assignment?.sectionName || assignment?.section?.name || '').trim().toLowerCase();
              epSection = epSectionByNameF.get(sectionName) ?? null;
            }
            const advisoryName = result.advisorySection;
            if (advisoryName && epSection?.name === advisoryName) {
              logger.debug(`[TeacherSync] Broad flat assignment for ${atlasCode} capped to advisory "${advisoryName}"`);
            } else {
              // Skip if not advisory and too broad
              continue;
            }
          }

          let epSection = epSectionByIdF.get(sectionId);
          // Fallback: ATLAS and EnrollPro use different integer IDs for same section — match by name
          if (!epSection && (assignment?.sectionName || assignment?.section?.name)) {
            const sectionName = (assignment?.sectionName || assignment?.section?.name || '').trim().toLowerCase();
            epSection = epSectionByNameF.get(sectionName) ?? null;
          }
          if (!epSection) {
            console.warn(
              `[TeacherSync] System ID Mismatch: ATLAS assignment sectionId=${sectionId} not found in EnrollPro sections`,
            );
            result.errors.push(`System ID Mismatch: ATLAS sectionId=${sectionId} not found in EnrollPro sections`);
            continue;
          }

          const gradeLevel = mapGradeLevel(epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name);
          if (!gradeLevel) {
            logger.debug(`[TeacherSync] Assignments: cannot map grade level for "${epSection.name}"`);
            continue;
          }

          let section = sectionByKeyF.get(`${epSection.name?.trim()}:${gradeLevel}`);
          if (!section) {
            section = await upsertSection(epSection.name, gradeLevel, schoolYearLabel);
            if (section) sectionByKeyF.set(`${epSection.name?.trim()}:${gradeLevel}`, section);
          }
          if (!section) continue;

          const smartCode = resolveSubjectCode(atlasCode, gradeLevel);
          const subject = subjectByCodeF.get(smartCode) ?? subjectByCodeF.get(atlasCode);
          if (!subject) {
            console.warn(
              `[TeacherSync] MISSING SUBJECT MAPPING: Atlas code "${atlasCode}" ` +
              `(resolved "${smartCode}") for section "${epSection.name}" grade=${gradeLevel}. ` +
              `Skipping — add this subject to SMART to enable this assignment.`,
            );
            result.errors.push(`MISSING SUBJECT MAPPING: Atlas code "${atlasCode}" (resolved "${smartCode}") — add to SMART subjects`);
            continue;
          }

          await ensureHomeroomGuidanceLabel(subject, homeroomLabelUpdated);
          const teachingMinutes = subject.code.startsWith('HG') ? HOMEROOM_GUIDANCE_MINUTES : null;
          rememberDesiredAssignment(subject.id, section.id);

          try {
            await (prisma.classAssignment as any).upsert({
              where: { teacherId_subjectId_sectionId_schoolYear: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel } },
              update: { teachingMinutes, isActive: true, archivedAt: null, archivedReason: null },
              create: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel, teachingMinutes, isActive: true },
            });
            result.classAssignmentsCreated++;
          } catch { /* concurrent duplicate */ }
        }
      } else {
        logger.debug(`[TeacherSync] Atlas: no assignments or published schedule for this teacher yet`);
      }

      // IMPORTANT DATA-SAFETY POLICY:
      // Teacher login sync still never deactivates class assignments (per-teacher Atlas
      // responses are partial). Active-year reconciliation is owned by the prune engine
      // + global Atlas sync stale-check.
      if (desiredAssignmentPairs.size === 0) {
        console.log(
          `[TeacherSync] Skip stale class-assignment checks for teacherId=${smartTeacherId}: ` +
          `no concrete Atlas pairs resolved in this cycle.`,
        );
      } else {
        console.log(
          `[TeacherSync] Preserved existing assignments for teacherId=${smartTeacherId}; ` +
          `stale archival is disabled in teacher-level sync (global Atlas sync handles this).`,
        );
      }

      // ── 3.5 ATLAS advisory fallback ──────────────────────────────────────
      // If EnrollPro did not yield an advisory section (ID mismatch, enrollment not
      // open yet, teacher missing from EnrollPro), check ATLAS /faculty/advisers.
      // ATLAS is authoritative for advisory assignments and must not be ignored.
      if (!advisorySectionSmartId) {
        try {
          const advisersData = await atlasGet(
            `/faculty/advisers?schoolId=${ATLAS_SCHOOL_ID}&schoolYearId=${atlasSchoolYearId}`,
          );
          const atlasAdvisers: any[] = advisersData?.advisers ?? advisersData?.data ?? [];
          let thisAdviser = atlasAdvisers.find(
            (a: any) => String(a.facultyId ?? a.teacherId ?? '') === String(atlasMember!.id),
          );

          if (thisAdviser) {
            const sectionName: string = thisAdviser.sectionName ?? thisAdviser.advisorySectionName ?? '';
            const gradeLevelRaw: string = thisAdviser.gradeLevelName ?? thisAdviser.sectionName ?? '';
            const gradeLevel = mapGradeLevel(gradeLevelRaw);

            if (sectionName && gradeLevel) {
              console.log(
                `[TeacherSync] Advisory found via ATLAS /faculty/advisers: ` +
                `"${sectionName}" gl=${gradeLevel}`,
              );
              const section = await upsertSection(sectionName, gradeLevel, schoolYearLabel, smartTeacherId);
              advisorySectionSmartId = section.id;
              advisorySectionGradeLevel = gradeLevel;
              result.advisorySection = sectionName;

              // Try to fetch students from EnrollPro for this section by name match
              const epSectionsForAdvisory = await getCachedIntegrationV1Sections(schoolYearId);
              const matchingEpSection = epSectionsForAdvisory.find(
                (s: any) => s.name?.trim() === sectionName.trim(),
              );
              if (matchingEpSection) {
                const learners = await getAllIntegrationV1SectionLearners(Number(matchingEpSection.id));
                result.studentsFound = learners.length;
                console.log(
                  `[TeacherSync] ATLAS advisory "${sectionName}": ${learners.length} learners from EnrollPro`,
                );
                for (const rec of learners) {
                  const learner = rec.learner ?? rec;
                  try {
                    const ok = await upsertLearner(learner, section.id, schoolYearLabel);
                    if (ok) result.studentsUpserted++;
                  } catch (err: any) {
                    result.errors.push(`ATLAS advisory LRN ${learner?.lrn}: ${err.message}`);
                  }
                }
              } else {
                console.log(
                  `[TeacherSync] ATLAS advisory "${sectionName}" not found in EnrollPro sections ` +
                  `(enrollment may not be open yet, or section name mismatch)`,
                );
              }
            } else {
              console.log(
                `[TeacherSync] ATLAS adviser record has no usable section/grade for ` +
                `atlasMember.id=${atlasMember!.id}`,
              );
            }
          } else {
            console.log(
              `[TeacherSync] ATLAS /faculty/advisers: no advisory assigned for ` +
              `atlasMember.id=${atlasMember!.id}`,
            );
          }
        } catch (advErr: any) {
          logger.warn(`[TeacherSync] ATLAS advisers fallback error: ${advErr.message}`);
        }
      }

      if (advisorySectionSmartId) {
        await syncAdvisoryWorkloadEntry({
          teacherId: smartTeacherId,
          sectionId: advisorySectionSmartId,
          schoolYear: schoolYearLabel,
        });
      }
    }
  } catch (err: any) {
    result.errors.push(`Atlas sync failed: ${err.message}`);
    logger.error(`[TeacherSync] Atlas error: ${err.message}`);
  }

  // ── 4. EnrollPro: Sync students in teaching sections ───────────────────
  // Advisory sync (step 2) covers only the section the teacher advises.
  // Teachers may also teach in other sections — pull their students too.
  try {
    // Get all unique sections this teacher teaches
    const teachingAssignments = await prisma.classAssignment.findMany({
      where: { teacherId: smartTeacherId, schoolYear: schoolYearLabel },
      include: { section: true },
      distinct: ['sectionId'],
    });

    if (teachingAssignments.length > 0) {
      const epSections = await getCachedIntegrationV1Sections(schoolYearId);
      // Group EnrollPro sections by composite key (NAME:GRADE) to handle data split across multiple IDs.
      const epSectionsByKey = new Map<string, any[]>();
      for (const s of epSections) {
        const gradeLevel = mapGradeLevel(s.gradeLevel?.name ?? s.gradeLevelName ?? s.name);
        if (!gradeLevel) continue;
        const key = `${s.name?.trim()}:${gradeLevel}`;
        const list = epSectionsByKey.get(key) ?? [];
        list.push(s);
        epSectionsByKey.set(key, list);
      }

      // Cache roster lookups per EP sectionId to avoid repeated network calls.
      const rosterCache = new Map<number, any[]>();

      const getRoster = async (sectionId: number): Promise<any[]> => {
        if (rosterCache.has(sectionId)) return rosterCache.get(sectionId) ?? [];
        const learners = await getEnrollProSectionRoster(sectionId);
        rosterCache.set(sectionId, learners);
        return learners;
      };

      for (const assignment of teachingAssignments) {
        const smartSection = assignment.section;

        // Skip advisory section — already synced in step 2
        if (result.advisorySection && smartSection.name === result.advisorySection) continue;

        const compositeKey = `${smartSection.name.trim()}:${smartSection.gradeLevel}`;
        const candidates = epSectionsByKey.get(compositeKey) ?? [];
        if (candidates.length === 0) {
          logger.debug(`[TeacherSync] Teaching section "${smartSection.name}" (${smartSection.gradeLevel}) not found in EnrollPro`);
          continue;
        }

        // Aggregate learners from ALL sections with this name and grade in EnrollPro.
        const allLearnersForSection: any[] = [];
        let epSectionIdsUsed: number[] = [];

        for (const candidate of candidates) {
          const roster = await getRoster(Number(candidate.id));
          if (roster.length > 0) {
            allLearnersForSection.push(...roster);
            epSectionIdsUsed.push(Number(candidate.id));
          }
        }

        if (allLearnersForSection.length === 0 && candidates[0]) {
           // Fallback if roster fetch yielded 0 (e.g. enrollment not open yet)
           epSectionIdsUsed = [Number(candidates[0].id)];
        }

        console.log(
          `[TeacherSync] Teaching "${smartSection.name}" (${smartSection.gradeLevel}) (EP ids=[${epSectionIdsUsed.join(', ')}]): ` +
          `${allLearnersForSection.length} learners aggregated`,
        );

        for (const rec of allLearnersForSection) {
          const learner = rec.learner ?? rec;
          try {
            await upsertLearner(learner, smartSection.id, schoolYearLabel);
          } catch (err: any) {
            result.errors.push(`Teaching LRN ${learner?.lrn}: ${err.message}`);
          }
        }

        // --- HARDENING: Drop stale enrollments for this teaching section ---
        // This keeps the count accurate if students moved out of this section in EnrollPro.
        try {
          const dropped = await dropStaleEnrollments(smartSection.id, schoolYearLabel, allLearnersForSection);
          if (dropped > 0) {
            logger.debug(`[TeacherSync] Dropped ${dropped} stale enrollment(s) for teaching section "${smartSection.name}"`);
          }
        } catch (err: any) {
          result.errors.push(`Teaching section cleanup "${smartSection.name}": ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    result.errors.push(`Teaching sections sync failed: ${err.message}`);
    logger.error(`[TeacherSync] Teaching sections error: ${err.message}`);
  }

  // ── 5. Advisory class assignments: ATLAS authority only ─────────────────────
  // UNIVERSAL POLICY: ATLAS is the Master of Subjects.
  // EnrollPro is the Master of People (students) only — never subjects.
  // buildSubjectCodeFromEnrollProLabel is DISABLED. No EnrollPro label inference.
  //
  // If ATLAS has assigned subjects to this advisory section they were already
  // created in Step 3. No action needed here.
  //
  // If ATLAS has no assignments yet for this advisory section, we log a note
  // but do NOT fall back to guessing from EnrollPro subject labels.
  try {
    if (advisorySectionSmartId && advisorySectionGradeLevel && result.studentsFound > 0) {

      const atlasAssignmentCount = await prisma.classAssignment.count({
        where: {
          teacherId: smartTeacherId,
          sectionId: advisorySectionSmartId,
          schoolYear: schoolYearLabel,
        },
      });

      if (atlasAssignmentCount > 0) {
        console.log(
          `[TeacherSync] Advisory section confirmed: ${atlasAssignmentCount} ATLAS assignment(s) present. ` +
          `EnrollPro label inference permanently disabled.`,
        );
      } else {
        // ATLAS has no assignments yet for this advisory section.
        // Under universal policy we do NOT fall back to EnrollPro labels.
        console.log(
          `[TeacherSync] Advisory section "${result.advisorySection}" has no ATLAS assignments yet. ` +
          `Waiting for ATLAS data — EnrollPro label inference is permanently disabled.`,
        );
        result.errors.push(
          `Advisory section "${result.advisorySection}" has no ATLAS assignment data yet. ` +
          `Ensure ATLAS has a published schedule for this teacher.`,
        );
      }
    }
  } catch (err: any) {
    result.errors.push(`Advisory assignment sync failed: ${err.message}`);
    logger.error(`[TeacherSync] Advisory assignment error: ${err.message}`);
  }

  console.log(
    `[TeacherSync] Done for ${employeeId}: ` +
    `advisory=${result.advisorySection ?? 'none'}, ` +
    `students=${result.studentsUpserted}/${result.studentsFound}, ` +
    `assignments=${result.classAssignmentsCreated} (Atlas had ${result.classAssignmentsFromAtlas}), ` +
    `errors=${result.errors.length}`,
  );

  return result;
}
