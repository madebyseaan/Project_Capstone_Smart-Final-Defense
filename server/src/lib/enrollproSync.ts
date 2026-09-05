/**
 * enrollproSync.ts
 *
 * Syncs student and section data from EnrollPro into SMART's local DB.
 * Runs on server start and every N minutes (default 30).
 * Also manually triggerable via POST /api/admin/enrollpro-sync/run
 *
 * What it syncs:
 *  - Sections (with adviserId from EnrollPro integration v1 faculty advisory info)
 *  - Students (Student model, keyed by LRN)
 *  - Enrollments (Enrollment model, linking student ↔ section)
 *
 * Data sources — ALL NO-AUTH integration v1 endpoints:
 *  - Active SY:     GET /integration/v1/school-year
 *  - Faculty:       GET /integration/v1/faculty  (has advisorySectionId/Name directly)
 *  - Sections:      GET /integration/v1/sections (has advisingTeacher embedded)
 *  - Learners:      GET /integration/v1/learners (paginated, all enrolled)
 *
 * Read-only from EnrollPro. Only writes to SMART's smart_db.
 */

import {
  getAllIntegrationV1Sections,
  getAllIntegrationV1Learners,
  getEnrollProTeachers,
  getEnrollProSectionStudents,
  resolveEnrollProSchoolYear,
} from './enrollproClient';
import { ensureSchoolYearFromEnrollPro } from './schoolYearResolver';
import { prisma } from './prisma';
import { logger } from './logger';
import bcrypt from 'bcryptjs';
import type { GradeLevel } from '@prisma/client';
import { broadcastSyncStatus } from './sseManager';
import { syncAdvisoryWorkloadEntry } from './workload';
import { snapshotForDb } from './studentSnapshot';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Grade level mapping
// ---------------------------------------------------------------------------
function mapGradeLevel(name: string | null | undefined): GradeLevel | null {
  const n = (name ?? '').toLowerCase();
  if (n.includes('10')) return 'GRADE_10';
  if (n.includes('7'))  return 'GRADE_7';
  if (n.includes('8'))  return 'GRADE_8';
  if (n.includes('9'))  return 'GRADE_9';
  return null;
}

function mapProgramType(programType: string | null | undefined): string {
  const pt = (programType ?? '').toUpperCase();
  if (pt.includes('ARTS')) return 'SPA';
  if (pt.includes('SPORT')) return 'SPS';
  if (pt.includes('SCIENCE') || pt.includes('ENGINEERING') || pt.includes('STE')) return 'STE';
  return 'REGULAR';
}

// ---------------------------------------------------------------------------
// EnrollPro status classification
// EnrollPro uses several variants (TRANSFERRED_OUT, TRANSFERRED_OUT_TO_ALS,
// DROPPED_OUT, OFFICIALLY_ENROLLED, GRADUATED, COMPLETED, ...). Classify by keyword so no variant
// is silently skipped. TRANSFERRED_IN means the learner is enrolled HERE.
// Returns null for statuses we should ignore entirely.
// ---------------------------------------------------------------------------
function mapEpEnrollmentStatus(raw: string | null | undefined): 'ENROLLED' | 'DROPPED' | 'TRANSFERRED' | 'GRADUATED' | null {
  const s = String(raw ?? '').toUpperCase().trim().replace(/[\s-]+/g, '_');
  if (!s) return null;
  if (s.includes('TRANSFER')) {
    return s.includes('_IN') || s.startsWith('TRANSFERRED_IN') ? 'ENROLLED' : 'TRANSFERRED';
  }
  if (s.includes('DROP')) return 'DROPPED';
  if (s.includes('GRADUAT') || s.includes('COMPLETED')) return 'GRADUATED';
  if (s.includes('ENROLL') || s === 'SECTIONED') return 'ENROLLED';
  return null;
}

// ---------------------------------------------------------------------------
// Change detection — hash the fields we care about for a student record.
// Returns a short SHA-256 hex prefix (16 chars) — good enough for drift detection.
// ---------------------------------------------------------------------------
function hashStudentFields(data: {
  firstName: string;
  lastName: string;
  middleName: string | null;
  gender: string | null;
  birthDate: Date | null;
  address: string | null;
  guardianName: string | null;
  suffix?: string | null;
  guardianContact?: string | null;
  religion?: string | null;
  motherTongue?: string | null;
  barangay?: string | null;
  city?: string | null;
  province?: string | null;
  fatherName?: string | null;
  fatherContact?: string | null;
  motherName?: string | null;
  motherContact?: string | null;
}): string {
  const raw = `${data.firstName}|${data.lastName}|${data.middleName ?? ''}|${data.gender ?? ''}|${data.birthDate?.toISOString() ?? ''}|${data.address ?? ''}|${data.guardianName ?? ''}|${data.suffix ?? ''}|${data.guardianContact ?? ''}|${data.religion ?? ''}|${data.motherTongue ?? ''}|${data.barangay ?? ''}|${data.city ?? ''}|${data.province ?? ''}|${data.fatherName ?? ''}|${data.fatherContact ?? ''}|${data.motherName ?? ''}|${data.motherContact ?? ''}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let syncRunning = false;
let lastSyncAt: Date | null = null;
let lastSyncResult: {
  advisoriesSynced: number;
  studentsFetched: number;
  studentsEnrolled: number;
  studentsSynced: number;
  studentsSkipped: number;
  studentsDropped: number;
  teachersMatched: number;
  errors: string[];
} | null = null;

const DELTA_SYNC_ENABLED = process.env.ENROLLPRO_DELTA_SYNC_ENABLED === 'true';

export function getEnrollProSyncStatus() {
  return { syncRunning, lastSyncAt, lastSyncResult };
}

async function getLastSuccessfulSyncTimestamp(): Promise<string | undefined> {
  if (!DELTA_SYNC_ENABLED) return undefined;

  const latestSuccess = await prisma.syncHistory.findFirst({
    where: { status: 'SUCCESS' },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  });

  return latestSuccess?.completedAt?.toISOString();
}

// ---------------------------------------------------------------------------
// Core sync
// ---------------------------------------------------------------------------
export async function runEnrollProSync() {
  if (syncRunning) {
    console.log('[EnrollProSync] Already running, skipping.');
    return lastSyncResult;
  }

  syncRunning = true;
  // Notify clients that sync has started
  broadcastSyncStatus({ type: 'ENROLLPRO_SYNC_STARTED', timestamp: new Date() });

  const errors: string[] = [];
  let advisoriesSynced = 0;
  let studentsFetched = 0;
  let studentsEnrolled = 0;
  let studentsSynced = 0;
  let studentsSkipped = 0;
  let teachersMatched = 0;

  try {
    // 1. Get active school year from EnrollPro Integration v1 (no auth)
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 'main' },
      select: { currentSchoolYear: true },
    });
    const preferredLabel = process.env.ENROLLPRO_SCHOOL_YEAR_LABEL ?? settings?.currentSchoolYear;
    const resolvedSY = await resolveEnrollProSchoolYear(preferredLabel);
    const schoolYearId = resolvedSY.id;
    const schoolYearLabel = resolvedSY.yearLabel;
    logger.debug(
      `[EnrollProSync] Using school year ${schoolYearLabel} (id=${schoolYearId}) from ${resolvedSY.source}`,
    );

    // Align SMART SchoolYear record to EnrollPro (source of truth)
    await ensureSchoolYearFromEnrollPro(schoolYearId, schoolYearLabel);

    // 2. Fetch EnrollPro teachers + integration sections.
    const epTeachers = await getEnrollProTeachers();
    const epTeacherIdToEmpId = new Map<number, string>(
      epTeachers.map((t: any) => [Number(t.id ?? t.teacherId), String(t.employeeId)])
    );
    logger.debug(`[EnrollProSync] Loaded ${epTeachers.length} teachers from EnrollPro`);

    // 3. Build & Upsert SMART teachers for all EnrollPro faculty
    const empIdToSmartTeacherId = new Map<string, string>();

    // Pre-fetch all existing users into Maps for O(1) lookup (eliminates N individual findFirst)
    const allExistingUsers = await prisma.user.findMany({
      where: { role: 'TEACHER' },
      select: { id: true, username: true, email: true },
    });
    const userByUsername = new Map(allExistingUsers.map(u => [u.username, u]));
    const userByEmail = new Map(allExistingUsers.map(u => [u.email, u]));
    logger.debug(`[EnrollProSync] Pre-fetched ${allExistingUsers.length} teacher users for O(1) lookup`);

    const usersToCreate: Array<{ username: string; email: string; password: string; role: 'TEACHER'; firstName: string; lastName: string }> = [];
    const usersToUpdate: Array<{ id: string; data: { firstName: string; lastName: string } }> = [];
    const teacherUpserts: Array<{ employeeId: string; userId: string; specialization: string | null }> = [];

    for (const epTeacher of epTeachers) {
      if (!epTeacher.employeeId) continue;
      try {
        const empId = String(epTeacher.employeeId).trim();
        const userEmail = epTeacher.email ?? `${empId}@deped.gov.ph`;
        const firstName = epTeacher.firstName ?? '';
        const lastName = epTeacher.lastName ?? '';

        const existingUser = userByUsername.get(empId) ?? userByEmail.get(userEmail);

        let targetUserId = existingUser?.id;
        if (!existingUser) {
          const defaultPassword = await bcrypt.hash(process.env.DEFAULT_SYNC_PASSWORD || 'password123', 10);
          usersToCreate.push({ username: empId, email: userEmail, password: defaultPassword, role: 'TEACHER', firstName, lastName });
          // Placeholder — will resolve after batch create
          targetUserId = `__pending_user__${empId}`;
        } else {
          usersToUpdate.push({ id: existingUser.id, data: { firstName, lastName } });
        }

        if (targetUserId && !targetUserId.startsWith('__pending_user__')) {
          teacherUpserts.push({ employeeId: empId, userId: targetUserId, specialization: epTeacher.specialization ?? null });
        }
      } catch (tErr: any) {
        errors.push(`Teacher ${epTeacher.employeeId}: ${tErr.message}`);
      }
    }

    // Batch execute: User creates
    if (usersToCreate.length > 0) {
      try {
        await prisma.user.createMany({ data: usersToCreate, skipDuplicates: true });
        const createdUsers = await prisma.user.findMany({
          where: { username: { in: usersToCreate.map(u => u.username) } },
          select: { id: true, username: true },
        });
        const usernameToId = new Map(createdUsers.map(u => [u.username, u.id]));

        // Resolve pending teacher upserts
        for (const upsert of teacherUpserts) {
          if (upsert.userId.startsWith('__pending_user__')) {
            const empId = upsert.userId.replace('__pending_user__', '');
            const realId = usernameToId.get(empId);
            if (realId) upsert.userId = realId;
          }
        }
        // Add newly created users to lookup Maps
        for (const u of createdUsers) {
          userByUsername.set(u.username, { id: u.id, username: u.username, email: '' });
        }
        logger.debug(`[EnrollProSync] Batch created ${createdUsers.length} teacher users`);
      } catch (err: any) {
        errors.push(`Batch user create failed: ${err.message}`);
      }
    }

    // Batch execute: User updates
    if (usersToUpdate.length > 0) {
      try {
        await prisma.$transaction(
          usersToUpdate.map(u => prisma.user.update({ where: { id: u.id }, data: u.data }))
        );
      } catch (err: any) {
        errors.push(`Batch user update failed: ${err.message}`);
      }
    }

    // Batch execute: Teacher upserts
    const validTeacherUpserts = teacherUpserts.filter(u => !u.userId.startsWith('__pending_user__'));
    if (validTeacherUpserts.length > 0) {
      try {
        await prisma.$transaction(
          validTeacherUpserts.map(u =>
            prisma.teacher.upsert({
              where: { employeeId: u.employeeId },
              update: { userId: u.userId, specialization: u.specialization },
              create: { employeeId: u.employeeId, userId: u.userId, specialization: u.specialization },
            })
          )
        );
        // Populate empIdToSmartTeacherId from results
        const syncedTeachers = await prisma.teacher.findMany({
          where: { employeeId: { in: validTeacherUpserts.map(u => u.employeeId) } },
          select: { id: true, employeeId: true },
        });
        for (const t of syncedTeachers) {
          empIdToSmartTeacherId.set(t.employeeId, t.id);
        }
      } catch (err: any) {
        errors.push(`Batch teacher upsert failed: ${err.message}`);
      }
    }
    logger.debug(`[EnrollProSync] Synced ${empIdToSmartTeacherId.size} SMART teachers`);

    // 3b. Deactivate teachers no longer in EnrollPro (batch)
    // SAFEGUARD: Only deactivate if EnrollPro returned a non-empty teacher list
    // If EnrollPro is offline/error, epTeachers will be empty - don't archive anything
    const epEmpIds = new Set(epTeachers.map((t: any) => String(t.employeeId).trim()).filter(Boolean));
    
    if (epEmpIds.size === 0) {
      logger.warn(`[EnrollProSync] EnrollPro returned 0 teachers - skipping teacher deactivation to prevent false archival`);
    } else {
      const localTeachers = await prisma.teacher.findMany({
        where: { user: { role: 'TEACHER', status: 'ACTIVE' } },
        select: { id: true, employeeId: true, userId: true },
      });
      const deactivatedTeacherIds = localTeachers
        .filter(t => !epEmpIds.has(t.employeeId))
        .map(t => ({ userId: t.userId, teacherId: t.id }));

      if (deactivatedTeacherIds.length > 0) {
        try {
          const userIds = deactivatedTeacherIds.map(t => t.userId);
          const teacherIds = deactivatedTeacherIds.map(t => t.teacherId);
          await prisma.$transaction([
            prisma.user.updateMany({ where: { id: { in: userIds } }, data: { status: 'SUSPENDED' } }),
            prisma.classAssignment.updateMany({
              where: { teacherId: { in: teacherIds }, isActive: true },
              data: { isActive: false, archivedAt: new Date(), archivedReason: 'Teacher removed from EnrollPro' },
            }),
          ]);
          logger.info(`[EnrollProSync] Deactivated ${deactivatedTeacherIds.length} teachers no longer in EnrollPro`);
        } catch (err: any) {
          errors.push(`Batch teacher deactivation failed: ${err.message}`);
        }
      }
    } // End of epEmpIds.size > 0 check

    // 3c. Reactivate teachers who reappeared in EnrollPro (batch)
    const suspendedTeachers = await prisma.teacher.findMany({
      where: { user: { status: 'SUSPENDED', role: 'TEACHER' } },
      select: { id: true, employeeId: true, userId: true },
    });
    const reactivatableUserIds = suspendedTeachers
      .filter(t => epEmpIds.has(t.employeeId))
      .map(t => t.userId);

    if (reactivatableUserIds.length > 0) {
      try {
        await prisma.user.updateMany({
          where: { id: { in: reactivatableUserIds } },
          data: { status: 'ACTIVE', suspendedAt: null, suspendedBy: null, suspensionReason: null },
        });
        
        // Also restore ClassAssignments for reactivated teachers
        const reactivatedTeacherIds = suspendedTeachers
          .filter(t => reactivatableUserIds.includes(t.userId))
          .map(t => t.id);
        
        if (reactivatedTeacherIds.length > 0) {
          await prisma.classAssignment.updateMany({
            where: { 
              teacherId: { in: reactivatedTeacherIds },
              isActive: false,
              archivedReason: 'Teacher removed from EnrollPro',
            },
            data: { isActive: true, archivedAt: null, archivedReason: null },
          });
          logger.info(`[EnrollProSync] Restored ClassAssignments for ${reactivatedTeacherIds.length} reactivated teachers`);
        }
        
        logger.info(`[EnrollProSync] Reactivated ${reactivatableUserIds.length} teachers who reappeared in EnrollPro`);
      } catch (err: any) {
        errors.push(`Batch teacher reactivation failed: ${err.message}`);
      }
    }

    // 4. Fetch ALL sections from EnrollPro integration v1 (paginated — fixes 50-section cap)
    const epSections = await getAllIntegrationV1Sections(schoolYearId);
    logger.debug(`[EnrollProSync] Loaded ${epSections.length} sections from EnrollPro`);

    // 5. Upsert ALL sections into SMART
    const epSectionKeyToSmartSectionId = new Map<string, string>();

    for (const epSection of epSections) {
      try {
        const gradeLevelName: string = epSection.gradeLevel?.name ?? '';
        const gradeLevel = mapGradeLevel(gradeLevelName);
        if (!gradeLevel) {
          errors.push(`Unknown grade level "${gradeLevelName}" for section "${epSection.name}"`);
          continue;
        }

        // Resolve adviser
        const epAdviserTeacherId = epSection.advisingTeacher?.id ?? epSection.adviser?.id ?? epSection.adviserId;
        const adviserEmployeeId = epAdviserTeacherId ? epTeacherIdToEmpId.get(Number(epAdviserTeacherId)) : (epSection.adviser?.employeeId ?? epSection.advisingTeacher?.employeeId);
        const teacherId = adviserEmployeeId ? (empIdToSmartTeacherId.get(adviserEmployeeId) ?? null) : null;
        if (teacherId) teachersMatched++;

        const section = await (prisma.section as any).upsert({
          where: {
            name_gradeLevel_schoolYear: {
              name: epSection.name,
              gradeLevel,
              schoolYear: schoolYearLabel,
            },
          },
          update: { adviserId: teacherId, program: mapProgramType(epSection.programType) },
          create: {
            name: epSection.name,
            gradeLevel,
            schoolYear: schoolYearLabel,
            adviserId: teacherId,
            program: mapProgramType(epSection.programType),
          },
        });

        await syncAdvisoryWorkloadEntry({
          teacherId,
          sectionId: section.id,
          schoolYear: schoolYearLabel,
        });

        const key = `${epSection.name}:${gradeLevel}`;
        epSectionKeyToSmartSectionId.set(key, section.id);
        if (epSection.advisingTeacher || epSection.adviser) advisoriesSynced++;
      } catch (err: any) {
        errors.push(`Section "${epSection.name}": ${err.message}`);
      }
    }
    logger.debug(`[EnrollProSync] Sections upserted: ${epSectionKeyToSmartSectionId.size}`);

    // 6. Fetch ALL enrolled learners
    logger.debug(`[EnrollProSync] Fetching all learners from Integration v1...`);
    let allLearners: any[] = [];
    let updatedSince: string | undefined;
    try {
      updatedSince = await getLastSuccessfulSyncTimestamp();
      if (updatedSince) {
        logger.debug(`[EnrollProSync] Delta mode enabled: updatedSince=${updatedSince}`);
      }

      try {
        allLearners = await getAllIntegrationV1Learners(schoolYearId, updatedSince);
      } catch (deltaError: any) {
        if (!updatedSince) throw deltaError;
        logger.warn(`[EnrollProSync] Delta fetch failed, retrying full pull: ${deltaError.message}`);
        updatedSince = undefined; 
        allLearners = await getAllIntegrationV1Learners(schoolYearId);
      }

      logger.debug(`[EnrollProSync] Fetched ${allLearners.length} learners`);
      studentsFetched = allLearners.length;
    } catch (err: any) {
      errors.push(`Integration v1 learners fetch failed: ${err.message}`);
    }

    // 7. Upsert each learner + their enrollment
    // Track which studentIds were synced per section so we can drop stale enrollments afterwards.
    const syncedStudentsPerSection = new Map<string, Set<string>>();

    // 7.1 Pre-fetch all existing students into a Map for O(1) lookup (reduces N queries to 1)
    const existingStudentsByLrn = new Map<string, { id: string; firstName: string; lastName: string; middleName: string | null; gender: string | null; birthDate: Date | null; address: string | null; guardianName: string | null; suffix: string | null; guardianContact?: string | null; religion?: string | null; motherTongue?: string | null; barangay?: string | null; city?: string | null; province?: string | null; fatherName?: string | null; fatherContact?: string | null; motherName?: string | null; motherContact?: string | null; ipCommunity?: boolean | null; is4PsBeneficiary?: boolean | null; disability?: string | null; isBalikAral?: boolean | null }>();
    try {
      const allExistingStudents = await prisma.student.findMany({
        select: {
          lrn: true, id: true, firstName: true, lastName: true, middleName: true,
          gender: true, birthDate: true, address: true, guardianName: true, suffix: true,
          guardianContact: true, religion: true, motherTongue: true, barangay: true,
          city: true, province: true, fatherName: true, fatherContact: true,
          motherName: true, motherContact: true, ipCommunity: true, is4PsBeneficiary: true,
          disability: true, isBalikAral: true,
        },
      });
      for (const s of allExistingStudents) {
        existingStudentsByLrn.set(s.lrn, s);
      }
      logger.debug(`[EnrollProSync] Pre-fetched ${allExistingStudents.length} existing students for O(1) lookup`);
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to pre-fetch existing students, falling back to per-record lookup');
    }

    // --- Batch collections for students and enrollments ---
    const newStudentsToCreate: Array<{
      lrn: string; firstName: string; middleName: string | null; lastName: string;
      suffix: string | null; gender: string | null; birthDate: Date | null;
      address: string | null; guardianName: string | null; guardianContact: string | null;
      religion: string | null; motherTongue: string | null; barangay: string | null;
      city: string | null; province: string | null; fatherName: string | null;
      fatherContact: string | null; motherName: string | null; motherContact: string | null;
      ipCommunity: boolean; is4PsBeneficiary: boolean; disability: string | null; isBalikAral: boolean;
    }> = [];
    const studentsToUpdate: Array<{ id: string; data: Record<string, any> }> = [];
    const enrollmentUpserts: Array<{
      studentId: string; sectionId: string; status: 'ENROLLED' | 'DROPPED' | 'TRANSFERRED';
    }> = [];
    const enrollmentDedupPairs: Array<{ studentId: string; currentSectionId: string }> = [];

    // Build LRN → EnrollPro student ID map from Integration v1 data
    const lrnToEpStudentId = new Map<string, number>();
    for (const record of allLearners) {
      const learner = record.learner;
      if (learner?.lrn && learner?.id) {
        lrnToEpStudentId.set(learner.lrn, Number(learner.id));
      }
    }
    logger.debug(`[EnrollProSync] Mapped ${lrnToEpStudentId.size} LRNs to EnrollPro student IDs`);

    for (const record of allLearners) {
      // EnrollPro may expose status at record level or nested on the learner/enrollment
      const epStatus = String(
        record.status ?? record.learner?.status ?? record.enrollment?.status ?? ''
      ).toUpperCase();
      const smartStatus = mapEpEnrollmentStatus(epStatus);
      if (!smartStatus) continue;

      const learner = record.learner;
      const sectionName: string = record.section?.name ?? '';
      const gradeLevelName: string = record.gradeLevel?.name ?? '';
      const gradeLevel = mapGradeLevel(gradeLevelName);

      if (!learner?.lrn || !gradeLevel) continue;

      const key = `${sectionName}:${gradeLevel}`;
      let resolvedSectionId = epSectionKeyToSmartSectionId.get(key);
      if (!resolvedSectionId) {
        try {
          const sec = await (prisma.section as any).upsert({
            where: {
              name_gradeLevel_schoolYear: {
                name: sectionName, gradeLevel, schoolYear: schoolYearLabel,
              },
            },
            update: {},
            create: { name: sectionName, gradeLevel, schoolYear: schoolYearLabel, adviserId: null },
          });
          epSectionKeyToSmartSectionId.set(key, sec.id);
          resolvedSectionId = sec.id;
        } catch (err: any) {
          logger.warn({ err: err.message, sectionName, gradeLevel }, 'Section upsert failed during learner sync');
        }
      }

      if (!resolvedSectionId) continue;

      try {
        const incomingBirthDate = learner.birthdate ? new Date(learner.birthdate) : null;
        const incomingAddress = learner.address || record.address || record.homeAddress || record.currentAddress || null;
        const incomingGuardian = learner.parentGuardianName || learner.guardianName || record.guardianName || record.parentGuardianName || record.guardianInfo || null;
        const incomingGuardianContact = learner.parentGuardianContact || learner.guardianContact || record.guardianContact || record.parentGuardianContact || null;
        const incomingReligion = learner.religion || record.religion || null;
        const incomingMotherTongue = learner.motherTongue || record.motherTongue || null;
        const incomingBarangay = learner.barangay || record.barangay || null;
        const incomingCity = learner.city || learner.municipality || record.city || record.municipality || null;
        const incomingProvince = learner.province || record.province || null;
        const incomingFatherName = learner.fatherName || learner.father?.name || record.fatherName || record.father?.name || null;
        const incomingFatherContact = learner.fatherContact || learner.father?.contact || record.fatherContact || record.father?.contact || null;
        const incomingMotherName = learner.motherName || learner.mother?.name || record.motherName || record.mother?.name || null;
        const incomingMotherContact = learner.motherContact || learner.mother?.contact || record.motherContact || record.mother?.contact || null;
        const incomingIpCommunity = learner.ipCommunity === true || String(learner.ipCommunity).toUpperCase() === 'YES' || record.ipCommunity === true;
        const incomingIs4Ps = learner.is4PsBeneficiary === true || String(learner.is4PsBeneficiary).toUpperCase() === 'YES' || record.is4PsBeneficiary === true;
        const incomingDisability = learner.disability || record.disability || null;
        const incomingIsBalikAral = learner.isBalikAral === true || String(learner.isBalikAral).toUpperCase() === 'YES' || record.isBalikAral === true;

        const incomingHash = hashStudentFields({
          firstName: learner.firstName, lastName: learner.lastName,
          middleName: learner.middleName ?? null, gender: learner.sex ?? null,
          birthDate: incomingBirthDate, address: incomingAddress,
          guardianName: incomingGuardian, suffix: learner.extensionName ?? null,
          guardianContact: incomingGuardianContact, religion: incomingReligion,
          motherTongue: incomingMotherTongue, barangay: incomingBarangay,
          city: incomingCity, province: incomingProvince,
          fatherName: incomingFatherName, fatherContact: incomingFatherContact,
          motherName: incomingMotherName, motherContact: incomingMotherContact,
        });

        const cached = existingStudentsByLrn.get(learner.lrn);
        let existing = cached ?? null;
        if (cached === undefined) {
          existing = await prisma.student.findUnique({
            where: { lrn: learner.lrn },
            select: {
              id: true, firstName: true, lastName: true, middleName: true,
              gender: true, birthDate: true, address: true, guardianName: true, suffix: true,
            },
          });
        }

        let studentId: string;

        if (!existing) {
          newStudentsToCreate.push({
            lrn: learner.lrn, firstName: learner.firstName ?? '',
            middleName: learner.middleName ?? null, lastName: learner.lastName ?? '',
            suffix: learner.extensionName ?? null, gender: learner.sex ?? null,
            birthDate: incomingBirthDate, address: incomingAddress,
            guardianName: incomingGuardian, guardianContact: incomingGuardianContact,
            religion: incomingReligion, motherTongue: incomingMotherTongue,
            barangay: incomingBarangay, city: incomingCity, province: incomingProvince,
            fatherName: incomingFatherName, fatherContact: incomingFatherContact,
            motherName: incomingMotherName, motherContact: incomingMotherContact,
            ipCommunity: incomingIpCommunity, is4PsBeneficiary: incomingIs4Ps,
            disability: incomingDisability, isBalikAral: incomingIsBalikAral,
          });
          // Placeholder ID — will be resolved after batch create
          studentId = `__pending__${learner.lrn}`;
          studentsSynced++;
        } else {
          const existingHash = hashStudentFields({
            firstName: existing.firstName, lastName: existing.lastName,
            middleName: existing.middleName, gender: existing.gender,
            birthDate: existing.birthDate, address: existing.address,
            guardianName: existing.guardianName, suffix: existing.suffix,
            guardianContact: (existing as any).guardianContact,
            religion: (existing as any).religion,
            motherTongue: (existing as any).motherTongue,
            barangay: (existing as any).barangay, city: (existing as any).city,
            province: (existing as any).province,
            fatherName: (existing as any).fatherName,
            fatherContact: (existing as any).fatherContact,
            motherName: (existing as any).motherName,
            motherContact: (existing as any).motherContact,
          });

          if (existingHash !== incomingHash) {
            studentsToUpdate.push({
              id: existing.id,
              data: {
                firstName: learner.firstName ?? '', middleName: learner.middleName ?? null,
                lastName: learner.lastName ?? '', suffix: learner.extensionName ?? null,
                gender: learner.sex ?? null, birthDate: incomingBirthDate,
                // Only overwrite enriched fields if Integration v1 has a value — never null them out
                // (Enrichment pass fetches these from /students/:id detail endpoint)
                address: incomingAddress || existing.address,
                guardianName: incomingGuardian || existing.guardianName,
                guardianContact: incomingGuardianContact || (existing as any).guardianContact,
                religion: incomingReligion || (existing as any).religion,
                motherTongue: incomingMotherTongue || (existing as any).motherTongue,
                barangay: incomingBarangay || (existing as any).barangay,
                city: incomingCity || (existing as any).city,
                province: incomingProvince || (existing as any).province,
                fatherName: incomingFatherName || (existing as any).fatherName,
                fatherContact: incomingFatherContact || (existing as any).fatherContact,
                motherName: incomingMotherName || (existing as any).motherName,
                motherContact: incomingMotherContact || (existing as any).motherContact,
                ipCommunity: incomingIpCommunity || (existing as any).ipCommunity,
                is4PsBeneficiary: incomingIs4Ps || (existing as any).is4PsBeneficiary,
                disability: incomingDisability || (existing as any).disability,
                isBalikAral: incomingIsBalikAral || (existing as any).isBalikAral,
              },
            });
            studentsSynced++;
            existingStudentsByLrn.set(learner.lrn, {
              id: existing.id, firstName: learner.firstName ?? '',
              lastName: learner.lastName ?? '', middleName: learner.middleName ?? null,
              gender: learner.sex ?? null, birthDate: incomingBirthDate,
              address: incomingAddress, guardianName: incomingGuardian,
              suffix: learner.extensionName ?? null,
            });
          } else {
            studentsSkipped++;
          }
          studentId = existing.id;
        }

        // Collect enrollment dedup and upsert operations (batched below)
        enrollmentDedupPairs.push({ studentId, currentSectionId: resolvedSectionId });
        enrollmentUpserts.push({ studentId, sectionId: resolvedSectionId, status: smartStatus === 'GRADUATED' ? 'ENROLLED' : smartStatus });

        if (!syncedStudentsPerSection.has(resolvedSectionId)) {
          syncedStudentsPerSection.set(resolvedSectionId, new Set());
        }
        // Track will be resolved after batch create; pending IDs are skipped here
        if (!studentId.startsWith('__pending__')) {
          syncedStudentsPerSection.get(resolvedSectionId)!.add(studentId);
        }

      } catch (err: any) {
        errors.push(`Student LRN ${learner.lrn}: ${err.message}`);
      }
    }

    // --- Batch execute: Student creates ---
    if (newStudentsToCreate.length > 0) {
      try {
        await prisma.student.createMany({ data: newStudentsToCreate, skipDuplicates: true });
        // Re-fetch created students to get their IDs
        const createdLrns = newStudentsToCreate.map(s => s.lrn);
        const createdStudents = await prisma.student.findMany({
          where: { lrn: { in: createdLrns } },
          select: { id: true, lrn: true },
        });
        const lrnToId = new Map(createdStudents.map(s => [s.lrn, s.id]));

        // Resolve pending studentIds in enrollment ops and tracking
        for (const op of enrollmentUpserts) {
          if (op.studentId.startsWith('__pending__')) {
            const lrn = op.studentId.replace('__pending__', '');
            const realId = lrnToId.get(lrn);
            if (realId) op.studentId = realId;
          }
        }
        for (const op of enrollmentDedupPairs) {
          if (op.studentId.startsWith('__pending__')) {
            const lrn = op.studentId.replace('__pending__', '');
            const realId = lrnToId.get(lrn);
            if (realId) op.studentId = realId;
          }
        }
        for (const [sectionId, studentSet] of syncedStudentsPerSection) {
          const pending = [...studentSet].filter(id => id.startsWith('__pending__'));
          for (const p of pending) {
            studentSet.delete(p);
            const lrn = p.replace('__pending__', '');
            const realId = lrnToId.get(lrn);
            if (realId) studentSet.add(realId);
          }
        }

        // Update the lookup Map for this sync cycle
        for (const s of createdStudents) {
          const created = newStudentsToCreate.find(c => c.lrn === s.lrn);
          if (created) {
            existingStudentsByLrn.set(s.lrn, {
              id: s.id, firstName: created.firstName, lastName: created.lastName,
              middleName: created.middleName, gender: created.gender,
              birthDate: created.birthDate, address: created.address,
              guardianName: created.guardianName, suffix: created.suffix,
            });
          }
        }
        logger.debug(`[EnrollProSync] Batch created ${createdStudents.length} students`);
      } catch (err: any) {
        errors.push(`Batch student create failed: ${err.message}`);
      }
    }

    // --- Batch execute: Student updates ---
    if (studentsToUpdate.length > 0) {
      try {
        await prisma.$transaction(
          studentsToUpdate.map(u => prisma.student.update({ where: { id: u.id }, data: u.data }))
        );
        logger.debug(`[EnrollProSync] Batch updated ${studentsToUpdate.length} students`);
      } catch (err: any) {
        errors.push(`Batch student update failed: ${err.message}`);
      }
    }

    // --- Batch execute: Enrollment dedup (drop stale cross-section enrollments) ---
    const dedupPairs = enrollmentDedupPairs.filter(p => !p.studentId.startsWith('__pending__'));
    if (dedupPairs.length > 0) {
      try {
        // For each student, drop ENROLLED enrollments in sections other than their current one
        // Batch: collect all studentIds, query once, filter in memory, batch update
        const dedupStudentIds = [...new Set(dedupPairs.map(p => p.studentId))];
        const currentEnrollments = await prisma.enrollment.findMany({
          where: {
            studentId: { in: dedupStudentIds },
            schoolYear: schoolYearLabel,
            status: 'ENROLLED',
          },
          select: { id: true, studentId: true, sectionId: true },
        });

        const dedupPairMap = new Map(dedupPairs.map(p => [p.studentId, p.currentSectionId]));
        const staleEnrollmentIds = currentEnrollments
          .filter(e => {
            const currentSectionId = dedupPairMap.get(e.studentId);
            return currentSectionId && e.sectionId !== currentSectionId;
          })
          .map(e => e.id);

        if (staleEnrollmentIds.length > 0) {
          await prisma.enrollment.updateMany({
            where: { id: { in: staleEnrollmentIds } },
            data: { status: 'DROPPED' },
          });
          logger.debug(`[EnrollProSync] Batch dedup: dropped ${staleEnrollmentIds.length} stale enrollments`);
        }
      } catch (err: any) {
        errors.push(`Batch enrollment dedup failed: ${err.message}`);
      }
    }

    // --- Batch execute: Enrollment upserts ---
    const validUpserts = enrollmentUpserts.filter(op => !op.studentId.startsWith('__pending__'));
    if (validUpserts.length > 0) {
      try {
        await prisma.$transaction(
          validUpserts.map(op =>
            prisma.enrollment.upsert({
              where: {
                studentId_sectionId_schoolYear: {
                  studentId: op.studentId, sectionId: op.sectionId, schoolYear: schoolYearLabel,
                },
              },
              update: { status: op.status },
              create: { studentId: op.studentId, sectionId: op.sectionId, schoolYear: schoolYearLabel, status: op.status },
            })
          )
        );
        logger.debug(`[EnrollProSync] Batch upserted ${validUpserts.length} enrollments`);
      } catch (err: any) {
        errors.push(`Batch enrollment upsert failed: ${err.message}`);
      }
    }

    // --- Snapshot: Create profile snapshots for new enrollments ---
    try {
      const snapshotBatch = validUpserts.filter(op => !op.studentId.startsWith('__pending__'));
      if (snapshotBatch.length > 0) {
        const studentIds = [...new Set(snapshotBatch.map(op => op.studentId))];
        const students = await prisma.student.findMany({
          where: { id: { in: studentIds } },
        });
        const studentMap = new Map(students.map(s => [s.id, s]));

        // Find enrollments missing snapshots (filter in code to avoid JSON null filter issue)
        const allEnrollments = await prisma.enrollment.findMany({
          where: {
            studentId: { in: studentIds },
            schoolYear: schoolYearLabel,
          },
          select: { id: true, studentId: true, profileSnapshot: true },
        });

        const needsSnapshot = allEnrollments.filter(e => !e.profileSnapshot);

        if (needsSnapshot.length > 0) {
          let snapshotCount = 0;
          await prisma.$transaction(
            needsSnapshot.map(e => {
              const student = studentMap.get(e.studentId);
              if (!student) return prisma.enrollment.update({ where: { id: 'never-match' }, data: {} });
              snapshotCount++;
              return prisma.enrollment.update({
                where: { id: e.id },
                data: { profileSnapshot: snapshotForDb(student) as any },
              });
            })
          );
          logger.debug(`[EnrollProSync] Created ${snapshotCount} enrollment profile snapshots`);
        }
      }
    } catch (err: any) {
      errors.push(`Snapshot creation failed: ${err.message}`);
    }

      // 8. Drop stale enrollments (single batch query instead of per-section)
      let studentsDropped = 0;
    
      {
        try {
          // Collect all synced student IDs across all sections
          const allSyncedStudentIds = new Set<string>();
          for (const studentSet of syncedStudentsPerSection.values()) {
            for (const sid of studentSet) allSyncedStudentIds.add(sid);
          }

          // During delta sync, also fetch the full learners feed to detect stale enrollments
          // (delta only processes changed students, so we need the full list to know who's gone)
          if (updatedSince && allSyncedStudentIds.size > 0) {
            try {
              const fullLearners = await getAllIntegrationV1Learners();
              for (const record of fullLearners) {
                const l = record.learner ?? record;
                const lrn = String(l.lrn ?? '').trim();
                if (lrn) {
                  const dbStudent = await prisma.student.findUnique({ where: { lrn }, select: { id: true } });
                  if (dbStudent) allSyncedStudentIds.add(dbStudent.id);
                }
              }
            } catch { /* non-fatal — stale check will use whatever IDs we have */ }
          }

          // Single query: find all ENROLLED enrollments for this SY
          const allCurrentEnrollments = await prisma.enrollment.findMany({
            where: { schoolYear: schoolYearLabel, status: 'ENROLLED' },
            select: { id: true, studentId: true },
          });

          // Filter to stale enrollments (student not in synced set)
          const staleIds = allCurrentEnrollments
            .filter(e => !allSyncedStudentIds.has(e.studentId))
            .map(e => e.id);

          if (staleIds.length > 0) {
            await prisma.enrollment.updateMany({
              where: { id: { in: staleIds } },
              data: { status: 'TRANSFERRED' },
            });
            studentsDropped = staleIds.length;
            logger.debug(`[EnrollProSync] Batch dropped ${staleIds.length} stale enrollment(s)`);
          }
        } catch (err: any) {
          errors.push(`Stale enrollment cleanup: ${err.message}`);
        }
      }

    // 9. Drop enrollments in orphaned sections
    if (!updatedSince) {
      const epSectionNames = new Set(epSections.map((s: any) => s.name));
      try {
        const allSmartSections = await prisma.section.findMany({
          where: { schoolYear: schoolYearLabel },
          select: { id: true, name: true },
        });
        const orphanedSections = allSmartSections.filter((s) => !epSectionNames.has(s.name));
        const orphanedSectionIds = orphanedSections.map((s) => s.id);

        if (orphanedSectionIds.length > 0) {
          const dropResult = await prisma.enrollment.updateMany({
            where: {
              sectionId: { in: orphanedSectionIds },
              schoolYear: schoolYearLabel,
              status: 'ENROLLED',
            },
            data: { status: 'DROPPED' },
          });
          if (dropResult.count > 0) {
            studentsDropped += dropResult.count;
          }

          for (const section of orphanedSections) {
            try {
              const [caCount, attCount] = await Promise.all([
                prisma.classAssignment.count({ where: { sectionId: section.id } }),
                prisma.attendance.count({ where: { sectionId: section.id } }),
              ]);

              if (caCount === 0 && attCount === 0) {
                await prisma.section.delete({ where: { id: section.id } });
              }
            } catch (delErr: any) {
              console.warn(`[EnrollProSync] Failed to delete orphaned section "${section.name}":`, delErr.message);
            }
          }
        }
      } catch (err: any) {
        errors.push(`Orphaned section cleanup: ${err.message}`);
      }
    }

    // Update enrollment lifecycle fields from SMART students feed
    try {
      const { getSmartStudentsFeed } = await import('./enrollproClient');
      const smartStudents = await getSmartStudentsFeed();
      logger.info(`[EnrollProSync] Lifecycle: fetched ${smartStudents.length} students from SMART feed`);
      let lifecycleUpdated = 0;
      let lifecycleSkippedNoLrn = 0;
      let lifecycleSkippedNoDbStudent = 0;
      let lifecycleSkippedNoEnrollment = 0;
      let lifecycleSkippedNoChange = 0;
      for (const student of smartStudents) {
        const lrn = student.lrn;
        if (!lrn) { lifecycleSkippedNoLrn++; continue; }
        const eosyStatus = String(student.eosyStatus ?? student.status ?? '').toUpperCase();
        const dropOutDate = student.dropOutDate ? new Date(student.dropOutDate) : null;
        const transferOutDate = student.transferOutDate ? new Date(student.transferOutDate) : null;
        const dropOutReason = student.dropOutReason ?? null;
        const schoolYearLabel = student.schoolYear?.yearLabel;
        if (!schoolYearLabel) continue;

        const dbStudent = await prisma.student.findUnique({ where: { lrn }, select: { id: true } });
        if (!dbStudent) { lifecycleSkippedNoDbStudent++; continue; }

        // Match ENROLLED and DROPPED: the stale-roster cleanup above marks
        // transferred-out learners DROPPED (they vanish from the learners feed),
        // so this pass must be able to correct that to TRANSFERRED.
        const enrollment = await prisma.enrollment.findFirst({
          where: { studentId: dbStudent.id, schoolYear: schoolYearLabel, status: { in: ['ENROLLED', 'DROPPED'] } },
          select: { id: true, dropOutDate: true, transferOutDate: true },
        });
        if (!enrollment) { lifecycleSkippedNoEnrollment++; continue; }

        const mappedStatus = mapEpEnrollmentStatus(eosyStatus);
        const updateData: Record<string, any> = {};
        if (mappedStatus === 'DROPPED') {
          updateData.status = 'DROPPED';
          if (dropOutDate && !enrollment.dropOutDate) updateData.dropOutDate = dropOutDate;
          if (dropOutReason) updateData.dropOutReason = dropOutReason;
        } else if (mappedStatus === 'TRANSFERRED') {
          updateData.status = 'TRANSFERRED';
          if (transferOutDate && !enrollment.transferOutDate) updateData.transferOutDate = transferOutDate;
        } else {
          lifecycleSkippedNoChange++;
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.enrollment.update({ where: { id: enrollment.id }, data: updateData });
          lifecycleUpdated++;
        }
      }
      if (lifecycleUpdated > 0) {
        console.log(`[EnrollProSync] Lifecycle: ${lifecycleUpdated} enrollment(s) updated with drop/transfer info`);
      }
      logger.info(`[EnrollProSync] Lifecycle: ${smartStudents.length} total, ${lifecycleUpdated} updated, ${lifecycleSkippedNoLrn} no LRN, ${lifecycleSkippedNoDbStudent} no DB student, ${lifecycleSkippedNoEnrollment} no enrollment, ${lifecycleSkippedNoChange} no change`);
    } catch (err: any) {
      logger.warn(`[EnrollProSync] Lifecycle feed failed (non-fatal): ${err.message}`);
    }

    studentsFetched = allLearners.length;
    studentsEnrolled = allLearners.filter((row: any) => String(row?.status ?? '').toUpperCase() === 'ENROLLED').length;

    lastSyncResult = {
      advisoriesSynced,
      studentsFetched,
      studentsEnrolled,
      studentsSynced,
      studentsSkipped,
      studentsDropped,
      teachersMatched,
      errors,
    };
    lastSyncAt = new Date();
    
    try {
      await prisma.systemSettings.update({
        where: { id: 'main' },
        data: {
          lastEnrollProSync: lastSyncAt,
          currentSchoolYear: schoolYearLabel,
        }
      });
      const { invalidateSchoolYearCache } = await import("./schoolYearResolver");
      invalidateSchoolYearCache();
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to update system settings after sync');
    }

    logger.debug(
      `[EnrollProSync] ✓ Done: advisories=${advisoriesSynced}, learners=${studentsFetched} fetched, ` +
      `${studentsSynced} updated, ${studentsSkipped} unchanged, ${studentsDropped} dropped, ` +
      `matched=${teachersMatched}, errors=${errors.length}`
    );

    broadcastSyncStatus({
      type: 'ENROLLPRO_SYNC_COMPLETE',
      timestamp: lastSyncAt,
      result: lastSyncResult
    });

    return lastSyncResult;
  } catch (err: any) {
    console.error('[EnrollProSync] Fatal error:', err.message);
    errors.push(`Fatal: ${err.message}`);
    lastSyncResult = {
      advisoriesSynced,
      studentsFetched,
      studentsEnrolled: 0,
      studentsSynced,
      studentsSkipped,
      studentsDropped: 0,
      teachersMatched,
      errors,
    };
    
    broadcastSyncStatus({
      type: 'ENROLLPRO_SYNC_FAILED',
      timestamp: new Date(),
      error: err.message
    });

    return lastSyncResult;
  } finally {
    syncRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Transferee enrichment pass
// ---------------------------------------------------------------------------

export interface TransfereeSyncResult {
  transfereesTagged: number;
  unmatched: Array<{ lrn: string; reason: string }>;
}

let lastSyncTaggedLrns = new Set<string>();

/** LRNs tagged as transferees by the most recent sync pass (module state). */
export function getSyncTaggedTransfereeLrns(): Set<string> {
  return lastSyncTaggedLrns;
}

/**
 * Enrichment pass that tags transferee enrollments with transferInDate.
 * Runs AFTER the main EnrollPro sync. Never creates Students or Enrollments.
 * Only sets transferInDate on existing ENROLLED enrollments where it is currently null.
 */
export async function syncTransferees(): Promise<TransfereeSyncResult> {
  const result: TransfereeSyncResult = { transfereesTagged: 0, unmatched: [] };
  lastSyncTaggedLrns = new Set();

  try {
    const { getSmartTransferees } = await import('./enrollproClient');
    const { getActiveSchoolYearLabel } = await import('./schoolYearResolver');

    const currentSY = await getActiveSchoolYearLabel();
    const records = await getSmartTransferees();

    logger.info(`[syncTransferees] Fetched ${records.length} transferee records from EnrollPro`);

    for (const record of records) {
      try {
        const schoolYearLabel = record.schoolYear?.yearLabel;
        if (schoolYearLabel !== currentSY) continue;

        const lrn = String(record.lrn ?? '').trim();
        if (!lrn) continue;
        if (record.isPendingLrn) {
          result.unmatched.push({ lrn, reason: 'Pending LRN — skipped' });
          continue;
        }

        const student = await prisma.student.findUnique({
          where: { lrn },
          select: { id: true },
        });
        if (!student) {
          result.unmatched.push({ lrn, reason: 'Student not found in SMART DB' });
          continue;
        }

        const enrollment = await prisma.enrollment.findFirst({
          where: {
            studentId: student.id,
            schoolYear: currentSY,
            status: 'ENROLLED',
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (!enrollment) {
          result.unmatched.push({ lrn, reason: 'No ENROLLED enrollment for current SY' });
          continue;
        }

        if (enrollment.transferInDate == null && record.enrolledAt) {
          await prisma.enrollment.update({
            where: { id: enrollment.id },
            data: { transferInDate: new Date(record.enrolledAt) },
          });
          result.transfereesTagged++;
          lastSyncTaggedLrns.add(lrn);
        }
      } catch (itemErr: any) {
        logger.warn(`[syncTransferees] Error processing LRN ${record.lrn}: ${itemErr.message}`);
      }
    }

    logger.info(`[syncTransferees] Done: ${result.transfereesTagged} tagged, ${result.unmatched.length} unmatched`);
  } catch (err: any) {
    logger.warn(`[syncTransferees] Failed (non-fatal): ${err.message}`);
  }

  return result;
}
