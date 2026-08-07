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
  resolveEnrollProSchoolYear,
} from './enrollproClient';
import { prisma } from './prisma';
import bcrypt from 'bcryptjs';
import type { GradeLevel } from '@prisma/client';
import { broadcastSyncStatus } from './sseManager';
import { syncAdvisoryWorkloadEntry } from './workload';
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
}): string {
  const raw = `${data.firstName}|${data.lastName}|${data.middleName ?? ''}|${data.gender ?? ''}|${data.birthDate?.toISOString() ?? ''}|${data.address ?? ''}|${data.guardianName ?? ''}`;
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
    console.log(
      `[EnrollProSync] Using school year ${schoolYearLabel} (id=${schoolYearId}) from ${resolvedSY.source}`,
    );

    // 2. Fetch EnrollPro teachers + integration sections.
    const epTeachers = await getEnrollProTeachers();
    const epTeacherIdToEmpId = new Map<number, string>(
      epTeachers.map((t: any) => [Number(t.id ?? t.teacherId), String(t.employeeId)])
    );
    console.log(`[EnrollProSync] Loaded ${epTeachers.length} teachers from EnrollPro`);

    // 3. Build & Upsert SMART teachers for all EnrollPro faculty
    const empIdToSmartTeacherId = new Map<string, string>();
    for (const epTeacher of epTeachers) {
      if (!epTeacher.employeeId) continue;
      try {
        const empId = String(epTeacher.employeeId).trim();
        const userEmail = epTeacher.email ?? `${empId}@deped.gov.ph`;
        const firstName = epTeacher.firstName ?? '';
        const lastName = epTeacher.lastName ?? '';

        const user = await prisma.user.findFirst({
          where: { OR: [{ username: empId }, { email: userEmail }] },
        });

        let targetUserId = user?.id;
        if (!user) {
          const defaultPassword = await bcrypt.hash('password123', 10);
          const createdUser = await prisma.user.create({
            data: {
              username: empId,
              email: userEmail,
              password: defaultPassword,
              role: 'TEACHER',
              firstName,
              lastName,
            },
          });
          targetUserId = createdUser.id;
        } else {
          await prisma.user.update({
            where: { id: user.id },
            data: { firstName, lastName },
          });
        }

        if (targetUserId) {
          const teacher = await prisma.teacher.upsert({
            where: { employeeId: empId },
            update: { userId: targetUserId, specialization: epTeacher.specialization ?? null },
            create: { employeeId: empId, userId: targetUserId, specialization: epTeacher.specialization ?? null },
          });
          empIdToSmartTeacherId.set(empId, teacher.id);
        }
      } catch (tErr: any) {
        errors.push(`Teacher ${epTeacher.employeeId}: ${tErr.message}`);
      }
    }
    console.log(`[EnrollProSync] Synced ${empIdToSmartTeacherId.size} SMART teachers`);

    // 4. Fetch ALL sections from EnrollPro integration v1 (paginated — fixes 50-section cap)
    const epSections = await getAllIntegrationV1Sections(schoolYearId);
    console.log(`[EnrollProSync] Loaded ${epSections.length} sections from EnrollPro`);

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
          update: { adviserId: teacherId },
          create: {
            name: epSection.name,
            gradeLevel,
            schoolYear: schoolYearLabel,
            adviserId: teacherId,
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
    console.log(`[EnrollProSync] Sections upserted: ${epSectionKeyToSmartSectionId.size}`);

    // 6. Fetch ALL enrolled learners
    console.log(`[EnrollProSync] Fetching all learners from Integration v1...`);
    let allLearners: any[] = [];
    let updatedSince: string | undefined;
    try {
      updatedSince = await getLastSuccessfulSyncTimestamp();
      if (updatedSince) {
        console.log(`[EnrollProSync] Delta mode enabled: updatedSince=${updatedSince}`);
      }

      try {
        allLearners = await getAllIntegrationV1Learners(schoolYearId, updatedSince);
      } catch (deltaError: any) {
        if (!updatedSince) throw deltaError;
        console.warn(`[EnrollProSync] Delta fetch failed, retrying full pull: ${deltaError.message}`);
        updatedSince = undefined; 
        allLearners = await getAllIntegrationV1Learners(schoolYearId);
      }

      console.log(`[EnrollProSync] Fetched ${allLearners.length} learners`);
    } catch (err: any) {
      errors.push(`Integration v1 learners fetch failed: ${err.message}`);
    }

    // 7. Upsert each learner + their enrollment
    // Track which studentIds were synced per section so we can drop stale enrollments afterwards.
    const syncedStudentsPerSection = new Map<string, Set<string>>();

    for (const record of allLearners) {
      const statusUpper = String(record.status ?? '').toUpperCase();
      if (statusUpper !== 'ENROLLED' && statusUpper !== 'OFFICIALLY_ENROLLED' && statusUpper !== 'SECTIONED') continue;

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
                name: sectionName,
                gradeLevel,
                schoolYear: schoolYearLabel,
              },
            },
            update: {},
            create: { name: sectionName, gradeLevel, schoolYear: schoolYearLabel, adviserId: null },
          });
          epSectionKeyToSmartSectionId.set(key, sec.id);
          resolvedSectionId = sec.id;
        } catch { /* ignore */ }
      }

      if (!resolvedSectionId) continue;

      try {
        const incomingBirthDate = learner.birthdate ? new Date(learner.birthdate) : null;
        const incomingAddress = learner.address || record.address || record.homeAddress || record.currentAddress || null;
        const incomingGuardian = learner.parentGuardianName || learner.guardianName || record.guardianName || record.parentGuardianName || record.guardianInfo || null;

        const incomingHash = hashStudentFields({
          firstName: learner.firstName,
          lastName: learner.lastName,
          middleName: learner.middleName ?? null,
          gender: learner.sex ?? null,
          birthDate: incomingBirthDate,
          address: incomingAddress,
          guardianName: incomingGuardian,
        });

        // Upsert the student record keyed by LRN.
        const existing = await prisma.student.findUnique({
          where: { lrn: learner.lrn },
          select: {
            id: true,
            firstName: true, lastName: true, middleName: true,
            gender: true, birthDate: true, address: true, guardianName: true,
          },
        });

        let studentId: string;

        if (!existing) {
          // New student — create
          const created = await prisma.student.create({
            data: {
              lrn: learner.lrn,
              firstName: learner.firstName ?? '',
              middleName: learner.middleName ?? null,
              lastName: learner.lastName ?? '',
              suffix: learner.extensionName ?? null,
              gender: learner.sex ?? null,
              birthDate: incomingBirthDate,
              address: incomingAddress,
              guardianName: incomingGuardian,
            },
            select: { id: true },
          });
          studentId = created.id;
          studentsSynced++;
        } else {
          // Existing student — update only if fields changed
          const existingHash = hashStudentFields({
            firstName: existing.firstName,
            lastName: existing.lastName,
            middleName: existing.middleName,
            gender: existing.gender,
            birthDate: existing.birthDate,
            address: existing.address,
            guardianName: existing.guardianName,
          });

          if (existingHash !== incomingHash) {
            await prisma.student.update({
              where: { id: existing.id },
              data: {
                firstName: learner.firstName ?? '',
                middleName: learner.middleName ?? null,
                lastName: learner.lastName ?? '',
                suffix: learner.extensionName ?? null,
                gender: learner.sex ?? null,
                birthDate: incomingBirthDate,
                address: incomingAddress,
                guardianName: incomingGuardian,
              },
            });
            studentsSynced++;
          } else {
            studentsSkipped++;
          }
          studentId = existing.id;
        }

        // Prevent duplicate enrollments in the same SY
        await prisma.enrollment.updateMany({
          where: {
            studentId,
            schoolYear: schoolYearLabel,
            sectionId: { not: resolvedSectionId },
            status: 'ENROLLED'
          },
          data: { status: 'DROPPED' }
        });

        await prisma.enrollment.upsert({
          where: {
            studentId_sectionId_schoolYear: {
              studentId: studentId,
              sectionId: resolvedSectionId,
              schoolYear: schoolYearLabel,
            },
          },
          update: { status: 'ENROLLED' },
          create: {
            studentId: studentId,
            sectionId: resolvedSectionId,
            schoolYear: schoolYearLabel,
            status: 'ENROLLED',
          },
        });

        // Track synced student per section for stale-enrollment cleanup below.
        if (!syncedStudentsPerSection.has(resolvedSectionId)) {
          syncedStudentsPerSection.set(resolvedSectionId, new Set());
        }
        syncedStudentsPerSection.get(resolvedSectionId)!.add(studentId);

      } catch (err: any) {
        errors.push(`Student LRN ${learner.lrn}: ${err.message}`);
      }
    }

    // 8. Drop stale enrollments
    let studentsDropped = 0;
    
    if (!updatedSince) {
      try {
        const allSmartSections = await prisma.section.findMany({
          where: { schoolYear: schoolYearLabel },
          select: { id: true, name: true },
        });

        for (const section of allSmartSections) {
          const sectionId = section.id;
          const syncedStudentIds = syncedStudentsPerSection.get(sectionId) || new Set<string>();

          try {
            const currentlyEnrolled = await prisma.enrollment.findMany({
              where: { sectionId, schoolYear: schoolYearLabel, status: 'ENROLLED' },
              select: { id: true, studentId: true },
            });
            const toDropIds = currentlyEnrolled
              .filter((e) => !syncedStudentIds.has(e.studentId))
              .map((e) => e.id);
            if (toDropIds.length > 0) {
              await prisma.enrollment.updateMany({
                where: { id: { in: toDropIds } },
                data: { status: 'DROPPED' },
              });
              studentsDropped += toDropIds.length;
              console.log(
                `[EnrollProSync] Marked ${toDropIds.length} stale enrollment(s) as DROPPED for sectionId=${sectionId}`,
              );
            }
          } catch (err: any) {
            errors.push(`Stale enrollment cleanup sectionId=${sectionId}: ${err.message}`);
          }
        }
      } catch (err: any) {
        errors.push(`Stale enrollment cleanup global: ${err.message}`);
      }
    } else {
      console.log(`[EnrollProSync] Delta sync enabled — skipping full roster stale enrollment cleanup.`);
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

    studentsFetched = allLearners.filter((row: any) => String(row?.status ?? '').toUpperCase() === 'ENROLLED').length;

    lastSyncResult = {
      advisoriesSynced,
      studentsFetched,
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
    } catch { /* ignore if settings missing */ }

    console.log(
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
