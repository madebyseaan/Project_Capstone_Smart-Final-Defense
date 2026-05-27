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

import http from 'http';
import { prisma } from './prisma';
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
} from './syncCache';
import { syncAdvisoryWorkloadEntry } from './workload';
import type { GradeLevel } from '@prisma/client';

const ATLAS_BASE = 'http://100.88.55.125:5001/api/v1';
const ATLAS_SCHOOL_ID = 1;
const DEFAULT_SCHOOL_YEAR = process.env.ENROLLPRO_SCHOOL_YEAR_LABEL ?? '2026-2027';
const DEFAULT_ENROLLPRO_SCHOOL_YEAR_ID = parseInt(process.env.ENROLLPRO_SCHOOL_YEAR_ID ?? '38', 10);
const DEFAULT_ATLAS_SCHOOL_YEAR_ID = parseInt(process.env.ATLAS_SCHOOL_YEAR_ID ?? '8', 10);

// ---------------------------------------------------------------------------
// Grade level mapping — handles "Grade 7", "GRADE_7", "7-Rizal", etc.
// ---------------------------------------------------------------------------
function mapGradeLevel(name: string | null | undefined): GradeLevel | null {
  const n = (name ?? '').toLowerCase();
  if (n.includes('10')) return 'GRADE_10';
  if (n.includes('7'))  return 'GRADE_7';
  if (n.includes('8'))  return 'GRADE_8';
  if (n.includes('9'))  return 'GRADE_9';
  return null;
}

// ---------------------------------------------------------------------------
// Atlas subject code → SMART subject code
// Atlas uses base codes ("FIL", "ENG") — SMART appends the grade number ("FIL7").
// Special overrides handle naming differences between Atlas and SMART.
// ---------------------------------------------------------------------------
// ATLAS_SUBJECT_OVERRIDES: maps Atlas base codes (with grade suffix appended) to SMART subject codes.
// Add entries here when ATLAS uses a different code than the SMART canonical code.
const ATLAS_SUBJECT_OVERRIDES: Record<string, string> = {
  'ENV_SCI7':                 'ENVIRONMENTAL_SCIENCE7',
  'ENV_SCI8':                 'ENVIRONMENTAL_SCIENCE7',
  'ENV_SCI9':                 'ENVIRONMENTAL_SCIENCE7',
  'ENV_SCI10':                'ENVIRONMENTAL_SCIENCE7',
  'ENVIRONMENTAL_SCIENCE8':   'ENVIRONMENTAL_SCIENCE7',
  'ENVIRONMENTAL_SCIENCE9':   'ENVIRONMENTAL_SCIENCE7',
  'ENVIRONMENTAL_SCIENCE10':  'ENVIRONMENTAL_SCIENCE7',
  // Homeroom Guidance: ATLAS may send bare 'HG'; ensure it routes to HG{grade}.
  // (resolveSubjectCode appends the grade suffix before this lookup, so the
  //  key here would be e.g. 'HG7' if Atlas sent 'HG' for a Grade 7 section.
  //  No override needed — the passthrough (atlasCode + gradeSuffix) is correct.)
};

function resolveSubjectCode(atlasCode: string, gradeLevel: GradeLevel): string {
  const gradeSuffix = gradeLevel.replace('GRADE_', ''); // "GRADE_7" → "7"
  const withSuffix = atlasCode + gradeSuffix;
  return ATLAS_SUBJECT_OVERRIDES[withSuffix] ?? withSuffix;
}

function normalizeSubjectLabel(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

const HOMEROOM_GUIDANCE_LABEL = 'Homeroom Guidance';
const HOMEROOM_GUIDANCE_MINUTES = 60;

async function ensureHomeroomGuidanceLabel(
  subject: { id: string; code: string; name: string },
  updated: Set<string>,
): Promise<void> {
  if (!subject.code.startsWith('HG')) return;
  if (subject.name === HOMEROOM_GUIDANCE_LABEL) return;
  if (updated.has(subject.id)) return;

  await prisma.subject.update({ where: { id: subject.id }, data: { name: HOMEROOM_GUIDANCE_LABEL } });
  subject.name = HOMEROOM_GUIDANCE_LABEL;
  updated.add(subject.id);
}

// ---------------------------------------------------------------------------
// buildSubjectCodeFromEnrollProLabel — DISABLED (universal policy)
// ---------------------------------------------------------------------------
// EnrollPro is the master of PEOPLE (students) only.
// ATLAS is the master of SUBJECTS. Do not derive subject codes from text labels.
// This function is retained for reference but must never be called to create
// ClassAssignment records. Any call site below that still references it will
// be skipped by the surrounding ATLAS-authority guard.
// ---------------------------------------------------------------------------
function _disabledBuildSubjectCodeFromEnrollProLabel(
  _subjectLabel: string,
  _gradeLevel: GradeLevel,
): string | null {
  // Intentionally disabled. ATLAS is the only allowed source of subject codes.
  return null;
}

// ---------------------------------------------------------------------------
// Atlas HTTP helper
// ---------------------------------------------------------------------------
function atlasGet(path: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${ATLAS_BASE}${path}`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: parseInt(url.port) || 80,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          if (res.statusCode === 404) { resolve(null); return; }
          if (res.statusCode && res.statusCode >= 400) {
            // Resolve with null rather than rejecting — 404/403 are not fatal
            resolve(null);
            return;
          }
          try { resolve(JSON.parse(b)); }
          catch { reject(new Error(`Atlas JSON parse error ${path}`)); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error(`Atlas timeout ${path}`)));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Upsert a learner (student + enrollment) into SMART
// ---------------------------------------------------------------------------
async function upsertLearner(
  learner: any,
  sectionId: string,
  schoolYear: string,
): Promise<boolean> {
  if (!learner?.lrn) return false;
  const student = await prisma.student.upsert({
    where: { lrn: learner.lrn },
    update: {
      firstName: learner.firstName,
      lastName: learner.lastName,
      middleName: learner.middleName ?? null,
      gender: learner.sex ?? null,
      birthDate: learner.birthdate ? new Date(learner.birthdate) : undefined,
    },
    create: {
      lrn: learner.lrn,
      firstName: learner.firstName,
      lastName: learner.lastName,
      middleName: learner.middleName ?? null,
      suffix: learner.extensionName ?? null,
      gender: learner.sex ?? null,
      birthDate: learner.birthdate ? new Date(learner.birthdate) : null,
    },
  });
  await prisma.enrollment.upsert({
    where: { studentId_sectionId_schoolYear: { studentId: student.id, sectionId, schoolYear } },
    update: { status: 'ENROLLED' },
    create: { studentId: student.id, sectionId, schoolYear, status: 'ENROLLED' },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Upsert a section in SMART (create from Atlas/EnrollPro data if missing)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Drop stale advisory enrollments for a section after a fresh sync.
// Any student currently ENROLLED in the section who is NOT in the new
// learner list (identified by LRN) gets marked as DROPPED.
// ---------------------------------------------------------------------------
async function dropStaleEnrollments(
  sectionId: string,
  schoolYear: string,
  freshLearners: any[],
): Promise<number> {
  // Build the set of LRNs that are still active according to EnrollPro.
  const freshLRNs = new Set<string>(
    freshLearners
      .map((rec) => (rec.learner ?? rec)?.lrn)
      .filter((lrn): lrn is string => Boolean(lrn)),
  );

  // Load all students currently enrolled so we can compare.
  const currentlyEnrolled = await prisma.enrollment.findMany({
    where: { sectionId, schoolYear, status: 'ENROLLED' },
    select: { id: true, student: { select: { lrn: true } } },
  });

  const toDropIds = currentlyEnrolled
    .filter((e) => !freshLRNs.has(e.student.lrn))
    .map((e) => e.id);

  if (toDropIds.length > 0) {
    await prisma.enrollment.updateMany({
      where: { id: { in: toDropIds } },
      data: { status: 'DROPPED' },
    });
  }
  return toDropIds.length;
}

async function upsertSection(
  name: string,
  gradeLevel: GradeLevel,
  schoolYear: string,
  adviserId?: string,
): Promise<any> {
  return (prisma.section as any).upsert({
    where: { name_gradeLevel_schoolYear: { name, gradeLevel, schoolYear } },
    update: adviserId ? { adviserId } : {},
    create: { name, gradeLevel, schoolYear, ...(adviserId ? { adviserId } : {}) },
  });
}

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
    advisorySection: null,
    studentsFound: 0,
    studentsUpserted: 0,
    classAssignmentsCreated: 0,
    classAssignmentsFromAtlas: 0,
    errors: [],
  };

  console.log(`[TeacherSync] Starting sync for employeeId=${employeeId}`);

  // ── 1. Resolve sync school year ────────────────────────────────────────
  // Source of truth is SMART system setting (currentSchoolYear), then we
  // resolve the matching EnrollPro schoolYearId from /school-years.
  // If lookup fails, fall back to EnrollPro active SY, then static defaults.
  let schoolYearId = DEFAULT_ENROLLPRO_SCHOOL_YEAR_ID;
  let schoolYearLabel = DEFAULT_SCHOOL_YEAR;
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
    const preferredLabel = process.env.ENROLLPRO_SCHOOL_YEAR_LABEL ?? settings?.currentSchoolYear ?? DEFAULT_SCHOOL_YEAR;
    const resolvedSY = await getCachedSchoolYear(preferredLabel);
    schoolYearId = resolvedSY.id;
    schoolYearLabel = resolvedSY.yearLabel;
    console.log(
      `[TeacherSync] Using school year ${schoolYearLabel} (id=${schoolYearId}) from ${resolvedSY.source}`,
    );
  } catch {
    console.warn('[TeacherSync] Could not resolve school year from EnrollPro, using defaults');
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

    epTeacherId = Number(teacherRecord.id);
    const sections = await getCachedIntegrationV1Sections(schoolYearId, true);
    const mySections = sections
      .filter((s: any) => Number(s?.advisingTeacher?.id) === Number(teacherRecord.id));

    if (mySections.length === 0) {
      return false;
    }

    // Process all sections assigned to this teacher in EnrollPro
    // Aggregate learners into the primary SMART section (keyed by name)
    let totalLearners: any[] = [];
    
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
      console.log(`[TeacherSync] Advisory "${mySection.name}" (EP id=${mySection.id}): ${learners.length} learners`);

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
        if (dropped > 0) console.log(`[TeacherSync] Dropped ${dropped} stale enrollment(s) for "${result.advisorySection}"`);
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

          console.log(`[TeacherSync] Advisory: ${epFaculty.advisorySectionName} gl=${gradeLevel ?? 'unknown'}`);

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
            console.log(`[TeacherSync] Advisory "${section.name}": ${learners.length} learners`);

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
              if (dropped > 0) console.log(`[TeacherSync] Dropped ${dropped} stale enrollment(s) for "${section.name}"`);
            } catch (err: any) {
              result.errors.push(`Stale enrollment cleanup: ${err.message}`);
            }
          } else {
            result.errors.push(`Could not determine grade level for "${epFaculty.advisorySectionName}"`);
          }
        } else {
          console.log(`[TeacherSync] No advisory for employeeId=${employeeId}`);
          result.errors.push('EnrollPro faculty record has no advisory assignment for current school year');
        }
      } else {
        console.log(`[TeacherSync] Teacher not found in EnrollPro faculty feed for employeeId=${employeeId}`);
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
          let totalLearners: any[] = [];
          
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
              if (dropped > 0) console.log(`[TeacherSync] Dropped ${dropped} stale enrollment(s) for "${result.advisorySection}" (fallback)`);
            } catch (err: any) {
              result.errors.push(`Stale enrollment cleanup fallback: ${err.message}`);
            }
          }
        } else {
          console.log(`[TeacherSync] Advisory fallback: no section found for EP teacherId=${epTeacher.id}`);
          result.errors.push('EnrollPro sections feed has no advisory section mapped to this teacher for current school year');
        }
      } else {
        console.log(`[TeacherSync] Advisory fallback: no EnrollPro teacher record for employeeId=${employeeId}`);
        result.errors.push('Teacher not found in EnrollPro teachers endpoint by employee ID');
      }
    }
  } catch (err: any) {
    result.errors.push(`EnrollPro advisory sync failed: ${err.message}`);
    console.error(`[TeacherSync] EnrollPro error: ${err.message}`);
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
    console.error(`[TeacherSync] Advisory cleanup error: ${err.message}`);
  }

  // ── 3. Atlas: Get teaching load (subject + section assignments) ─────────
  try {
    const atlasToken = process.env.ATLAS_SYSTEM_TOKEN;
    if (!atlasToken) throw new Error('ATLAS_SYSTEM_TOKEN not set');

// Use cached Atlas faculty list if available (populated by background sync)
        // Fall back to a live fetch on cache miss so login always works.
        let atlasFaculty: any[] = getCachedAtlasFaculty() ?? [];
        if (atlasFaculty.length === 0) {
          const facultyData = await atlasGet(`/faculty?schoolId=${ATLAS_SCHOOL_ID}`, atlasToken);
          atlasFaculty = facultyData?.faculty ?? [];
          if (atlasFaculty.length > 0) setCachedAtlasFaculty(atlasFaculty);
        }

    // Identity resolution policy:
    // 1) Prefer exact Atlas email match to guarantee user ownership.
    // 2) Fall back to externalId only when email match is unavailable.
    const atlasByEmail = atlasFaculty.find(
      (f) => (f.contactInfo ?? '').toLowerCase() === email.toLowerCase(),
    );
    const atlasByExternalId = epTeacherId != null
      ? atlasFaculty.find((f) => f.externalId === epTeacherId)
      : undefined;

    let atlasMember = atlasByEmail ?? atlasByExternalId;

    if (atlasByEmail && atlasByExternalId && atlasByEmail.id !== atlasByExternalId.id) {
      console.warn(
        `[TeacherSync] Atlas identity mismatch: email matched id=${atlasByEmail.id} but externalId=${epTeacherId} matched id=${atlasByExternalId.id}. Using email match.`,
      );
    }

    if (atlasByEmail) {
      console.log(`[TeacherSync] Atlas: matched via email id=${atlasByEmail.id}`);
    } else if (atlasByExternalId) {
      console.log(`[TeacherSync] Atlas: matched via externalId=${epTeacherId} -> atlas.id=${atlasByExternalId.id}`);
    }

    if (!atlasMember) {
      console.log(`[TeacherSync] Atlas: no faculty match for employeeId=${employeeId} email=${email}`);
    } else {
      console.log(`[TeacherSync] Atlas: matched faculty id=${atlasMember.id}`);

      // Try 1: faculty-assignments (subject-grade assignments, may have section info)
      const assignmentsData = await atlasGet(
        `/faculty-assignments/${atlasMember.id}?schoolYearId=${DEFAULT_ATLAS_SCHOOL_YEAR_ID}`,
        atlasToken,
      );
      const assignmentsPayload = assignmentsData?.assignments ?? assignmentsData?.data ?? assignmentsData ?? [];
      const flatAssignments: any[] = Array.isArray(assignmentsPayload)
        ? assignmentsPayload.filter((a) => a && (a.subjectCode || a.sectionId))
        : [];
      const nestedAssignments: any[] = Array.isArray(assignmentsPayload)
        ? assignmentsPayload.filter((a) => a && (a.subject?.code || a.sections))
        : [];

      // Always try published schedule first. It is the most specific source for
      // actual teacher-to-section assignments and avoids broad over-assignment.
      let pubEntries: any[] = [];
      try {
        const pubData = await atlasGet(
          `/schools/${ATLAS_SCHOOL_ID}/schedules/published/faculty/${atlasMember.id}`,
          atlasToken,
        );
        pubEntries = pubData?.entries ?? [];
      } catch (e: any) {
        console.warn(`[TeacherSync] Atlas published schedule lookup failed: ${e?.message ?? e}`);
      }

      const homeroomLabelUpdated = new Set<string>();
      const desiredAssignmentPairs = new Set<string>();
      const rememberDesiredAssignment = (subjectId: string, sectionId: string) => {
        desiredAssignmentPairs.add(`${subjectId}:${sectionId}`);
      };

      if (pubEntries.length > 0) {
        console.log(`[TeacherSync] Atlas published: ${pubEntries.length} schedule entries`);
        result.classAssignmentsFromAtlas = pubEntries.length;

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

        for (const entry of pubEntries) {
          const atlasCode = normalizeSubjectLabel(entry.subjectCode ?? '');
          const epSection = epSectionByIdP.get(Number(entry.sectionId));
          if (!epSection) {
            console.warn(
              `[TeacherSync] System ID Mismatch: ATLAS published schedule entry has sectionId=${entry.sectionId} ` +
              `but this ID was not found in EnrollPro /integration/v1/sections. ` +
              `ATLAS sectionId and EnrollPro sectionId must be identical.`,
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
        console.log(`[TeacherSync] Atlas assignments: ${nestedAssignments.length} subject-section assignments`);
        result.classAssignmentsFromAtlas = nestedAssignments.length;

        const allSubjectsA = await prisma.subject.findMany();
        const subjectByCodeA = new Map(allSubjectsA.map((s) => [s.code, s]));
        const allSectionsA = await prisma.section.findMany({ where: { schoolYear: schoolYearLabel } });
        const sectionByNameA = new Map(allSectionsA.map((s) => [s.name.trim(), s]));

        // Pre-resolve EnrollPro sections for fallback lookup if needed
        let epSectionsSync: any[] | null = null;
        let epSectionByIdSync: Map<number, any> | null = null;

        for (const assignment of nestedAssignments) {
          const atlasCode = normalizeSubjectLabel(assignment.subject?.code ?? '');
          let atlasSections: any[] = assignment.sections ?? [];

          // FALLBACK: If 'sections' array is empty (common for BASELINE_ONLY assignments in detailed view),
          // check if 'facultySubjects' in the faculty list (from Step 1) has 'sectionIds' for this subject.
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
                console.log(`[TeacherSync] Fallback: recovered ${atlasSections.length} section(s) for ${atlasCode} from facultySubjects`);
              }
            }
          }

          // Trust Gate: Reject or cap broad fallback assignments (untrusted sources)
          const MAX_SANE_SECTIONS = 10;
          if (atlasSections.length > MAX_SANE_SECTIONS) {
            const advisoryName = result.advisorySection;
            const capped = atlasSections.filter((s: any) => s.name === advisoryName);
            if (capped.length > 0) {
              console.log(`[TeacherSync] Broad Atlas assignment for ${atlasCode} (${atlasSections.length} sections) capped to advisory section "${advisoryName}"`);
              atlasSections = capped;
            } else {
              console.warn(`[TeacherSync] Rejecting broad Atlas assignment for ${atlasCode}: ${atlasSections.length} sections. Threshold is ${MAX_SANE_SECTIONS}.`);
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
              console.log(`[TeacherSync] Assignments: cannot map grade level for "${atlasSection.name}"`);
              continue;
            }

            // Find or create the section in SMART
            let section = sectionByNameA.get(atlasSection.name?.trim());
            if (!section) {
              section = await upsertSection(atlasSection.name, gradeLevel, schoolYearLabel);
              if (section) {
                sectionByNameA.set(atlasSection.name?.trim(), section);
              }
              console.log(`[TeacherSync] Created missing section "${atlasSection.name}"`);
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
              console.log(`[TeacherSync] Upserted: ${subject.code} -> ${section.name}`);
            } catch { /* concurrent duplicate */ }
          }
        }
      } else if (flatAssignments.length > 0) {
        console.log(`[TeacherSync] Atlas assignments: ${flatAssignments.length} subject-section assignments (flat)`);
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
        const allSubjectsF = await prisma.subject.findMany();
        const subjectByCodeF = new Map(allSubjectsF.map((s) => [s.code, s]));
        const allSectionsF = await prisma.section.findMany({ where: { schoolYear: schoolYearLabel } });
        const sectionByNameF = new Map(allSectionsF.map((s) => [s.name.trim(), s]));

        for (const assignment of flatAssignments) {
          const atlasCode = normalizeSubjectLabel(assignment?.subjectCode ?? assignment?.subject?.code);
          const sectionId = Number(assignment?.sectionId);
          if (!atlasCode || !Number.isFinite(sectionId)) continue;

          // Trust Gate: Cap to advisory if broad
          const MAX_SANE_SECTIONS = 10;
          if ((flatBySubject.get(atlasCode) || 0) > MAX_SANE_SECTIONS) {
            const epSection = epSectionByIdF.get(sectionId);
            const advisoryName = result.advisorySection;
            if (advisoryName && epSection?.name === advisoryName) {
              console.log(`[TeacherSync] Broad flat assignment for ${atlasCode} capped to advisory "${advisoryName}"`);
            } else {
              // Skip if not advisory and too broad
              continue;
            }
          }

          const epSection = epSectionByIdF.get(sectionId);
          if (!epSection) {
            console.warn(
              `[TeacherSync] System ID Mismatch: ATLAS assignment sectionId=${sectionId} not found in EnrollPro sections`,
            );
            result.errors.push(`System ID Mismatch: ATLAS sectionId=${sectionId} not found in EnrollPro sections`);
            continue;
          }

          const gradeLevel = mapGradeLevel(epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name);
          if (!gradeLevel) {
            console.log(`[TeacherSync] Assignments: cannot map grade level for "${epSection.name}"`);
            continue;
          }

          let section = sectionByNameF.get(epSection.name?.trim());
          if (!section) {
            section = await upsertSection(epSection.name, gradeLevel, schoolYearLabel);
            if (section) sectionByNameF.set(epSection.name?.trim(), section);
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
        console.log(`[TeacherSync] Atlas: no assignments or published schedule for this teacher yet`);
      }

      // IMPORTANT DATA-SAFETY POLICY:
      // Do not delete class assignments during background/login sync.
      // Grade rows cascade on classAssignment deletion, so any transient Atlas mismatch
      // can erase teacher-entered WW/PT/QA data.
      //
      // Stale assignment cleanup should be handled by an explicit admin-maintenance flow
      // that can archive/verify grades before pruning.
      // ── 3.4 Deactivate stale assignments ────────────────────────────────
      // We do NOT delete (destructive pruning), but we DO set isActive: false
      // for any assignments previously tied to this teacher+year that Atlas
      // no longer reports. This moves them to the "Archived" section in the UI.
      if (desiredAssignmentPairs.size > 0) {
        const currentAssignments = await prisma.classAssignment.findMany({
          where: {
            teacherId: smartTeacherId,
            schoolYear: schoolYearLabel,
          },
          select: { id: true, subjectId: true, sectionId: true, isActive: true },
        });

        let deactivatedCount = 0;
        for (const assignment of currentAssignments) {
          const key = `${assignment.subjectId}:${assignment.sectionId}`;
          const shouldBeActive = desiredAssignmentPairs.has(key);
          if (assignment.isActive !== shouldBeActive) {
            await prisma.classAssignment.update({
              where: { id: assignment.id },
              data: shouldBeActive
                ? { isActive: true, archivedAt: null, archivedReason: null }
                : { isActive: false, archivedAt: new Date(), archivedReason: 'Removed from Atlas schedule' },
            });
            if (!shouldBeActive) deactivatedCount++;
          }
        }
        if (deactivatedCount > 0) {
          console.log(`[TeacherSync] Deactivated ${deactivatedCount} stale assignment(s) for teacherId=${smartTeacherId}`);
        }
      } else {
        console.log(
          `[TeacherSync] Skip class-assignment deactivation for teacherId=${smartTeacherId}: ` +
          `Atlas returned no concrete assignment pairs in this sync cycle (safety guard).`,
        );
      }

      // ── 3.5 ATLAS advisory fallback ──────────────────────────────────────
      // If EnrollPro did not yield an advisory section (ID mismatch, enrollment not
      // open yet, teacher missing from EnrollPro), check ATLAS /faculty/advisers.
      // ATLAS is authoritative for advisory assignments and must not be ignored.
      if (!advisorySectionSmartId) {
        try {
          const advisersData = await atlasGet(
            `/faculty/advisers?schoolId=${ATLAS_SCHOOL_ID}&schoolYearId=${DEFAULT_ATLAS_SCHOOL_YEAR_ID}`,
            atlasToken,
          );
          const atlasAdvisers: any[] = advisersData?.advisers ?? advisersData?.data ?? [];
          const thisAdviser = atlasAdvisers.find(
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
          console.warn(`[TeacherSync] ATLAS advisers fallback error: ${advErr.message}`);
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
    console.error(`[TeacherSync] Atlas error: ${err.message}`);
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
          console.log(`[TeacherSync] Teaching section "${smartSection.name}" (${smartSection.gradeLevel}) not found in EnrollPro`);
          continue;
        }

        // Aggregate learners from ALL sections with this name and grade in EnrollPro.
        let allLearnersForSection: any[] = [];
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
            console.log(`[TeacherSync] Dropped ${dropped} stale enrollment(s) for teaching section "${smartSection.name}"`);
          }
        } catch (err: any) {
          result.errors.push(`Teaching section cleanup "${smartSection.name}": ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    result.errors.push(`Teaching sections sync failed: ${err.message}`);
    console.error(`[TeacherSync] Teaching sections error: ${err.message}`);
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
    console.error(`[TeacherSync] Advisory assignment error: ${err.message}`);
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
