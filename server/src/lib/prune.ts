/**
 * prune.ts
 *
 * Strict EnrollPro SSOT auto-prune engine.
 * EnrollPro is the single source of truth for PEOPLE in the ACTIVE school year.
 * Anything active-year that EnrollPro no longer returns is deleted locally.
 *
 * Architecture:
 *   - Core (runPrune): pure DB logic, all inputs injected. Testable with fake years.
 *   - Wrapper (runPruneFromLiveSources): fetches real EP data, calls core.
 *
 * Phases (A→E):
 *   A — Teachers not in EP faculty → suspend or delete
 *   B — Orphan TEACHER users (no Teacher row) → delete
 *   C — Sections not in EP → delete (cascades CAs, enrollments, attendance)
 *   D — Students not in EP learners → delete active-year data, keep if has history
 *   E — Stale enrollment pairs (wrong section) → delete enrollment + section data
 *
 * Guardrails:
 *   - EP empty-set abort (outage protection)
 *   - Circuit breaker (maxDeletionRatio)
 *   - Single transaction with post-verify rollback
 *   - Audit logging every run
 *   - Dry-run mode
 */

import { prisma } from './prisma';
import { logger } from './logger';
import { createAuditLog } from './audit';
import { AuditAction, AuditSeverity } from '@prisma/client';
import {
  getEnrollProTeachers,
  getAllIntegrationV1Learners,
  getAllIntegrationV1Sections,
  resolveEnrollProSchoolYear,
} from './enrollproClient';
import { getActiveSchoolYearLabel } from './schoolYearResolver';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PruneInputs {
  activeYearLabel: string;
  epFacultyEmployeeIds: Set<string>;
  epLearnerLrns: Set<string>;
  epSectionKeys: Set<string>;
  epEnrollmentPairs: Set<string>;
  dryRun: boolean;
  maxDeletionRatio: number;
}

export interface PrunePhaseCounts {
  teachersSuspended: number;
  teachersDeleted: number;
  orphanUsersDeleted: number;
  sectionsDeleted: number;
  studentsDeleted: number;
  enrollmentsDeleted: number;
  gradesDeleted: number;
  attendanceDeleted: number;
  snapshotsDeleted: number;
}

export interface PruneResult {
  activeYearLabel: string;
  dryRun: boolean;
  aborted: boolean;
  abortReason?: string;
  phases: PrunePhaseCounts;
  auditLogId?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getPruneEnabled(): boolean {
  return process.env.PRUNE_ENABLED !== 'false';
}

function getPruneDryRun(): boolean {
  return process.env.PRUNE_DRY_RUN === 'true';
}

function getPruneMaxDeletionRatio(): number {
  const raw = parseFloat(process.env.PRUNE_MAX_DELETION_RATIO ?? '0.5');
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.5;
}

// ---------------------------------------------------------------------------
// Core — pure DB logic, all inputs injected
// ---------------------------------------------------------------------------

export async function runPrune(inputs: PruneInputs): Promise<PruneResult> {
  const {
    activeYearLabel,
    epFacultyEmployeeIds,
    epLearnerLrns,
    epSectionKeys,
    epEnrollmentPairs,
    dryRun,
    maxDeletionRatio,
  } = inputs;

  const result: PruneResult = {
    activeYearLabel,
    dryRun,
    aborted: false,
    phases: {
      teachersSuspended: 0,
      teachersDeleted: 0,
      orphanUsersDeleted: 0,
      sectionsDeleted: 0,
      studentsDeleted: 0,
      enrollmentsDeleted: 0,
      gradesDeleted: 0,
      attendanceDeleted: 0,
      snapshotsDeleted: 0,
    },
  };

  // ── PASS 1: PLAN (read-only) ─────────────────────────────────────────

  // Phase A — Teachers to suspend/delete
  // Scope: teachers with an active-year footprint (CAs in activeYearLabel).
  // Deliberately narrowed so the core is testable on a shared DB (fixtures
  // under a fake year fully control this population). Teachers NOT in EP
  // faculty but with zero active-year CAs escape here — they are still
  // blocked at login (auth faculty gate) and surfaced by the verification
  // report (teachersMissingFromEnrollPro). Do NOT broaden to all ACTIVE
  // teachers: core tests inject fake faculty sets and would suspend/delete
  // every real teacher on the shared dev DB.
  const localActiveTeachers = await prisma.teacher.findMany({
    where: {
      user: { role: 'TEACHER', status: 'ACTIVE' },
      classAssignments: { some: { schoolYear: activeYearLabel } },
    },
    select: { id: true, employeeId: true, userId: true },
  });

  const staleTeachers = localActiveTeachers.filter(
    (t) => !epFacultyEmployeeIds.has(t.employeeId),
  );

  const teachersToSuspend: Array<{ userId: string; teacherId: string; hasHistory: boolean }> = [];
  const teachersToDelete: Array<{ userId: string; teacherId: string }> = [];

  for (const t of staleTeachers) {
    const hasHistory =
      (await prisma.classAssignment.count({
        where: { teacherId: t.id, schoolYear: { not: activeYearLabel } },
      }) > 0) ||
      (await prisma.gradeSnapshot.count({
        where: { teacherId: t.id, schoolYear: { not: activeYearLabel } },
      }) > 0);

    if (hasHistory) {
      teachersToSuspend.push({ userId: t.userId, teacherId: t.id, hasHistory: true });
    } else {
      teachersToDelete.push({ userId: t.userId, teacherId: t.id });
    }
  }

  // Phase B — Orphan TEACHER users
  const orphanUsers = await prisma.user.findMany({
    where: { role: 'TEACHER', teacher: null, username: { notIn: [...epFacultyEmployeeIds] } },
    select: { id: true, username: true },
  });

  // Phase C — Sections to delete
  const activeSections = await prisma.section.findMany({
    where: { schoolYear: activeYearLabel },
    select: { id: true, name: true, gradeLevel: true },
  });

  const staleSections = activeSections.filter(
    (s) => !epSectionKeys.has(`${s.name}:${s.gradeLevel}`),
  );

  // Phase D — Students to delete
  const activeEnrollments = await prisma.enrollment.findMany({
    where: { schoolYear: activeYearLabel },
    select: { id: true, studentId: true, sectionId: true },
  });

  const staleStudentIds = new Set<string>();
  for (const e of activeEnrollments) {
    // We need the LRN to check — query student
    const student = await prisma.student.findUnique({
      where: { id: e.studentId },
      select: { lrn: true },
    });
    if (student && !epLearnerLrns.has(student.lrn)) {
      staleStudentIds.add(e.studentId);
    }
  }

  // Phase E — Stale enrollment pairs
  const staleEnrollments: Array<{ id: string; studentId: string; sectionId: string }> = [];
  for (const e of activeEnrollments) {
    const student = await prisma.student.findUnique({
      where: { id: e.studentId },
      select: { lrn: true },
    });
    const section = activeSections.find((s) => s.id === e.sectionId);
    if (student && section) {
      const pairKey = `${student.lrn}:${section.name}:${section.gradeLevel}`;
      if (!epEnrollmentPairs.has(pairKey)) {
        staleEnrollments.push({ id: e.id, studentId: e.studentId, sectionId: e.sectionId });
      }
    }
  }

  // ── Circuit breaker ───────────────────────────────────────────────────
  // Include stale enrollment pairs: a mass section reshuffle in EP would delete
  // every active enrollment + its grades (SMART-owned data) — must trip too.
  const totalPlannedDeletes =
    teachersToSuspend.length +
    teachersToDelete.length +
    orphanUsers.length +
    staleSections.length +
    staleStudentIds.size +
    staleEnrollments.length;

  const currentActiveCount =
    localActiveTeachers.length + activeSections.length + activeEnrollments.length;

  if (currentActiveCount > 0) {
    const ratio = totalPlannedDeletes / currentActiveCount;
    if (ratio > maxDeletionRatio) {
      result.aborted = true;
      result.abortReason = `CIRCUIT_BREAKER: planned ${totalPlannedDeletes} deletes vs ${currentActiveCount} active entities (${(ratio * 100).toFixed(1)}% > ${(maxDeletionRatio * 100).toFixed(0)}% threshold)`;

      await createAuditLog(
        AuditAction.DELETE,
        { firstName: 'prune-engine', lastName: null, role: 'SYSTEM' },
        'Prune aborted — circuit breaker',
        'Prune',
        result.abortReason,
        undefined,
        AuditSeverity.CRITICAL,
      );

      logger.warn(`[Prune] ${result.abortReason}`);
      return result;
    }
  }

  // ── PASS 2: EXECUTE ──────────────────────────────────────────────────
  if (dryRun) {
    // Dry run — return plan, write audit
    await createAuditLog(
      AuditAction.DELETE,
      { firstName: 'prune-engine', lastName: null, role: 'SYSTEM' },
      `Prune dry-run: ${totalPlannedDeletes} planned deletes`,
      'Prune',
      JSON.stringify({
        activeYearLabel,
        teachersToSuspend: teachersToSuspend.length,
        teachersToDelete: teachersToDelete.length,
        orphanUsers: orphanUsers.length,
        staleSections: staleSections.length,
        staleStudents: staleStudentIds.size,
        staleEnrollments: staleEnrollments.length,
      }),
      undefined,
      AuditSeverity.WARNING,
    );
    return result;
  }

  // Execute in a single transaction
  try {
    await prisma.$transaction(async (tx) => {
      // Phase A — Teachers
      for (const t of teachersToSuspend) {
        await tx.user.update({
          where: { id: t.userId },
          data: {
            status: 'SUSPENDED',
            suspendedBy: 'prune-engine',
            suspendedAt: new Date(),
            suspensionReason: 'Removed from EnrollPro faculty',
          },
        });
        // Delete active-year footprint
        await tx.classAssignment.deleteMany({
          where: { teacherId: t.teacherId, schoolYear: activeYearLabel },
        });
        await tx.scheduleEntry.deleteMany({
          where: { teacherId: t.teacherId, schoolYear: activeYearLabel },
        });
        await tx.gradeSnapshot.deleteMany({
          where: { teacherId: t.teacherId, schoolYear: activeYearLabel },
        });
        result.phases.teachersSuspended++;
      }

      for (const t of teachersToDelete) {
        // Null out audit log FK first
        await tx.auditLog.updateMany({
          where: { userId: t.userId },
          data: { userId: null },
        });

        // Check for ExcelTemplate FK — suspend instead of delete
        const templateCount = await tx.excelTemplate.count({
          where: { uploadedBy: t.userId },
        });
        if (templateCount > 0) {
          await tx.user.update({
            where: { id: t.userId },
            data: {
              status: 'SUSPENDED',
              suspendedBy: 'prune-engine',
              suspendedAt: new Date(),
              suspensionReason: 'Removed from EnrollPro (has uploaded templates)',
            },
          });
          result.phases.teachersSuspended++;
        } else {
          await tx.user.delete({ where: { id: t.userId } });
          // Manual GradeSnapshot cleanup (no FK)
          await tx.gradeSnapshot.deleteMany({
            where: { teacherId: t.teacherId },
          });
          result.phases.teachersDeleted++;
        }
      }

      // Phase B — Orphan TEACHER users
      for (const u of orphanUsers) {
        await tx.auditLog.updateMany({
          where: { userId: u.id },
          data: { userId: null },
        });
        const templateCount = await tx.excelTemplate.count({
          where: { uploadedBy: u.id },
        });
        if (templateCount > 0) {
          await tx.user.update({
            where: { id: u.id },
            data: {
              status: 'SUSPENDED',
              suspendedBy: 'prune-engine',
              suspendedAt: new Date(),
              suspensionReason: 'Orphan teacher user (no Teacher profile, not in EnrollPro)',
            },
          });
        } else {
          await tx.user.delete({ where: { id: u.id } });
          result.phases.orphanUsersDeleted++;
        }
      }

      // Phase C — Sections
      for (const s of staleSections) {
        await tx.section.delete({ where: { id: s.id } });
        await tx.gradeSnapshot.deleteMany({
          where: { sectionId: s.id, schoolYear: activeYearLabel },
        });
        result.phases.sectionsDeleted++;
      }

      // Phase D — Students
      for (const studentId of staleStudentIds) {
        // Delete active-year footprint first
        await tx.enrollment.deleteMany({
          where: { studentId, schoolYear: activeYearLabel },
        });
        await tx.attendance.deleteMany({
          where: { studentId, section: { schoolYear: activeYearLabel } },
        });
        await tx.grade.deleteMany({
          where: { studentId, classAssignment: { schoolYear: activeYearLabel } },
        });
        await tx.gradeSnapshot.deleteMany({
          where: { studentId, schoolYear: activeYearLabel },
        });
        result.phases.enrollmentsDeleted++;
        result.phases.gradesDeleted++;
        result.phases.attendanceDeleted++;
        result.phases.snapshotsDeleted++;

        // Check if student has history in other years
        const hasHistory =
          (await tx.enrollment.count({
            where: { studentId, schoolYear: { not: activeYearLabel } },
          }) > 0) ||
          (await tx.grade.count({
            where: { studentId, classAssignment: { schoolYear: { not: activeYearLabel } } },
          }) > 0);

        if (!hasHistory) {
          await tx.student.delete({ where: { id: studentId } });
          result.phases.studentsDeleted++;
        }
      }

  // Phase E — Stale enrollment pairs
  for (const e of staleEnrollments) {
    await tx.enrollment.deleteMany({ where: { id: e.id } });
    await tx.grade.deleteMany({
      where: {
        studentId: e.studentId,
        classAssignment: { sectionId: e.sectionId, schoolYear: activeYearLabel },
      },
    });
    await tx.attendance.deleteMany({
      where: { studentId: e.studentId, sectionId: e.sectionId },
    });
    await tx.gradeSnapshot.deleteMany({
      where: { studentId: e.studentId, sectionId: e.sectionId, schoolYear: activeYearLabel },
    });
  }

      // ── Post-verify: sanity check ────────────────────────────────────
      // Verify no stale enrollments remain for entities we planned to delete
      for (const s of staleSections) {
        const remaining = await tx.enrollment.count({
          where: { sectionId: s.id, schoolYear: activeYearLabel },
        });
        if (remaining > 0) {
          throw new Error(
            `Post-verify failed: ${remaining} enrollment(s) remain for deleted section ${s.id}`,
          );
        }
      }

      // Write audit log
      const severity = result.aborted ? AuditSeverity.CRITICAL : AuditSeverity.WARNING;
      const logResult = await tx.auditLog.create({
        data: {
          action: AuditAction.DELETE,
          userId: undefined,
          userName: 'prune-engine',
          userRole: 'SYSTEM',
          target: `Prune ${activeYearLabel}`,
          targetType: 'Prune',
          details: JSON.stringify({
            activeYearLabel,
            ...result.phases,
            dryRun: false,
          }),
          severity,
        },
      });
      result.auditLogId = logResult.id;
    });

    logger.info(
      `[Prune] Completed for ${activeYearLabel}: ` +
      `suspended=${result.phases.teachersSuspended}, deleted=${result.phases.teachersDeleted}, ` +
      `orphanUsers=${result.phases.orphanUsersDeleted}, sections=${result.phases.sectionsDeleted}, ` +
      `students=${result.phases.studentsDeleted}`,
    );
  } catch (err: any) {
    logger.error(`[Prune] Transaction failed: ${err.message}`);
    result.aborted = true;
    result.abortReason = `Transaction failed: ${err.message}`;

    await createAuditLog(
      AuditAction.DELETE,
      { firstName: 'prune-engine', lastName: null, role: 'SYSTEM' },
      'Prune transaction failed — rolled back',
      'Prune',
      err.message,
      undefined,
      AuditSeverity.CRITICAL,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Wrapper — fetches real EP data, resolves real active year, calls core
// ---------------------------------------------------------------------------

export async function runPruneFromLiveSources(
  opts?: { dryRun?: boolean },
): Promise<PruneResult> {
  if (!getPruneEnabled()) {
    return {
      activeYearLabel: '(disabled)',
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: 'PRUNE_ENABLED is false',
      phases: {
        teachersSuspended: 0,
        teachersDeleted: 0,
        orphanUsersDeleted: 0,
        sectionsDeleted: 0,
        studentsDeleted: 0,
        enrollmentsDeleted: 0,
        gradesDeleted: 0,
        attendanceDeleted: 0,
        snapshotsDeleted: 0,
      },
    };
  }

  // Resolve active year
  let activeYearLabel: string;
  try {
    activeYearLabel = await getActiveSchoolYearLabel();
  } catch {
    return {
      activeYearLabel: '(unknown)',
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: 'Could not resolve active school year',
      phases: {
        teachersSuspended: 0,
        teachersDeleted: 0,
        orphanUsersDeleted: 0,
        sectionsDeleted: 0,
        studentsDeleted: 0,
        enrollmentsDeleted: 0,
        gradesDeleted: 0,
        attendanceDeleted: 0,
        snapshotsDeleted: 0,
      },
    };
  }

  // Resolve EP school year for data fetching
  let epSchoolYearId: number;
  try {
    const resolved = await resolveEnrollProSchoolYear();
    epSchoolYearId = resolved.id;
  } catch {
    return {
      activeYearLabel,
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: 'Could not resolve EnrollPro school year',
      phases: {
        teachersSuspended: 0,
        teachersDeleted: 0,
        orphanUsersDeleted: 0,
        sectionsDeleted: 0,
        studentsDeleted: 0,
        enrollmentsDeleted: 0,
        gradesDeleted: 0,
        attendanceDeleted: 0,
        snapshotsDeleted: 0,
      },
    };
  }

  // Fetch EP data — all three must succeed or we abort
  let epTeachers: any[];
  let epLearners: any[];
  let epSections: any[];

  try {
    epTeachers = await getEnrollProTeachers();
  } catch (err: any) {
    return {
      activeYearLabel,
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: `EP_EMPTY_TEACHERS: ${err.message}`,
      phases: {
        teachersSuspended: 0, teachersDeleted: 0, orphanUsersDeleted: 0,
        sectionsDeleted: 0, studentsDeleted: 0, enrollmentsDeleted: 0,
        gradesDeleted: 0, attendanceDeleted: 0, snapshotsDeleted: 0,
      },
    };
  }

  try {
    epLearners = await getAllIntegrationV1Learners(epSchoolYearId);
  } catch (err: any) {
    return {
      activeYearLabel,
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: `EP_EMPTY_LEARNERS: ${err.message}`,
      phases: {
        teachersSuspended: 0, teachersDeleted: 0, orphanUsersDeleted: 0,
        sectionsDeleted: 0, studentsDeleted: 0, enrollmentsDeleted: 0,
        gradesDeleted: 0, attendanceDeleted: 0, snapshotsDeleted: 0,
      },
    };
  }

  try {
    epSections = await getAllIntegrationV1Sections(epSchoolYearId);
  } catch (err: any) {
    return {
      activeYearLabel,
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: `EP_EMPTY_SECTIONS: ${err.message}`,
      phases: {
        teachersSuspended: 0, teachersDeleted: 0, orphanUsersDeleted: 0,
        sectionsDeleted: 0, studentsDeleted: 0, enrollmentsDeleted: 0,
        gradesDeleted: 0, attendanceDeleted: 0, snapshotsDeleted: 0,
      },
    };
  }

  // Empty-set guard: if any list is empty, abort (EP outage must not look like everyone left)
  if (epTeachers.length === 0) {
    return {
      activeYearLabel,
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: 'EP_EMPTY_TEACHERS: EnrollPro returned 0 teachers — aborting prune',
      phases: {
        teachersSuspended: 0, teachersDeleted: 0, orphanUsersDeleted: 0,
        sectionsDeleted: 0, studentsDeleted: 0, enrollmentsDeleted: 0,
        gradesDeleted: 0, attendanceDeleted: 0, snapshotsDeleted: 0,
      },
    };
  }

  if (epLearners.length === 0) {
    return {
      activeYearLabel,
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: 'EP_EMPTY_LEARNERS: EnrollPro returned 0 learners — aborting prune',
      phases: {
        teachersSuspended: 0, teachersDeleted: 0, orphanUsersDeleted: 0,
        sectionsDeleted: 0, studentsDeleted: 0, enrollmentsDeleted: 0,
        gradesDeleted: 0, attendanceDeleted: 0, snapshotsDeleted: 0,
      },
    };
  }

  if (epSections.length === 0) {
    return {
      activeYearLabel,
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: 'EP_EMPTY_SECTIONS: EnrollPro returned 0 sections — aborting prune',
      phases: {
        teachersSuspended: 0, teachersDeleted: 0, orphanUsersDeleted: 0,
        sectionsDeleted: 0, studentsDeleted: 0, enrollmentsDeleted: 0,
        gradesDeleted: 0, attendanceDeleted: 0, snapshotsDeleted: 0,
      },
    };
  }

  // Build desired sets
  function mapGradeLevel(name: string | null | undefined): string | null {
    const n = (name ?? '').toLowerCase();
    if (n.includes('10')) return 'GRADE_10';
    if (n.includes('7')) return 'GRADE_7';
    if (n.includes('8')) return 'GRADE_8';
    if (n.includes('9')) return 'GRADE_9';
    return null;
  }

  const epFacultyEmployeeIds = new Set(
    epTeachers.map((t: any) => String(t.employeeId ?? '').trim()).filter(Boolean),
  );

  const epLearnerLrns = new Set(
    epLearners
      .map((r: any) => String(r.learner?.lrn ?? '').trim())
      .filter(Boolean),
  );

  const epSectionKeys = new Set(
    epSections
      .map((s: any) => {
        const gl = mapGradeLevel(s.gradeLevel?.name ?? s.gradeLevelName ?? s.name);
        return gl ? `${s.name}:${gl}` : null;
      })
      .filter(Boolean) as string[],
  );

  // Enrollment pairs: "LRN:SECTION_NAME:GRADE_LEVEL"
  const epEnrollmentPairs = new Set(
    epLearners
      .map((r: any) => {
        const lrn = String(r.learner?.lrn ?? '').trim();
        const sectionName = String(r.section?.name ?? '').trim();
        const gl = mapGradeLevel(r.gradeLevel?.name ?? r.gradeLevelName ?? '');
        return lrn && sectionName && gl ? `${lrn}:${sectionName}:${gl}` : null;
      })
      .filter(Boolean) as string[],
  );

  // Shape guard: if the learners payload carries no section info (or the sections
  // feed has no grade levels), the derived pair/section-key sets would be empty —
  // Phase E would then flag EVERY active enrollment as stale and delete grades
  // (SMART-owned data, unrecoverable). Abort instead.
  if (epEnrollmentPairs.size === 0 && epLearnerLrns.size > 0) {
    return {
      activeYearLabel,
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: 'EP_EMPTY_ENROLLMENT_PAIRS: learners payload has no section info — aborting prune (shape guard)',
      phases: {
        teachersSuspended: 0, teachersDeleted: 0, orphanUsersDeleted: 0,
        sectionsDeleted: 0, studentsDeleted: 0, enrollmentsDeleted: 0,
        gradesDeleted: 0, attendanceDeleted: 0, snapshotsDeleted: 0,
      },
    };
  }

  if (epSectionKeys.size === 0 && epSections.length > 0) {
    return {
      activeYearLabel,
      dryRun: opts?.dryRun ?? false,
      aborted: true,
      abortReason: 'EP_EMPTY_SECTION_KEYS: sections payload has no resolvable grade levels — aborting prune (shape guard)',
      phases: {
        teachersSuspended: 0, teachersDeleted: 0, orphanUsersDeleted: 0,
        sectionsDeleted: 0, studentsDeleted: 0, enrollmentsDeleted: 0,
        gradesDeleted: 0, attendanceDeleted: 0, snapshotsDeleted: 0,
      },
    };
  }

  return runPrune({
    activeYearLabel,
    epFacultyEmployeeIds,
    epLearnerLrns,
    epSectionKeys,
    epEnrollmentPairs,
    dryRun: opts?.dryRun ?? getPruneDryRun(),
    maxDeletionRatio: getPruneMaxDeletionRatio(),
  });
}
