/**
 * syncVerification.ts
 *
 * Post-sync verification report and orphan/stale data detection.
 * Answers: "Is the DB a faithful mirror of EnrollPro for the current year?"
 *
 * Data sources: DB via Prisma; EnrollPro via existing client functions.
 * Read-only. If EnrollPro is unreachable, returns a report with a single
 * WARNING anomaly — never crashes.
 */

import { prisma } from "./prisma";
import {
  getEnrollProTeachers,
  getAllIntegrationV1Sections,
  getAllIntegrationV1Learners,
  resolveEnrollProSchoolYear,
} from "./enrollproClient";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncAnomaly {
  code: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  detail?: unknown;
}

export interface SyncVerificationReport {
  generatedAt: string;
  activeSchoolYear: string | null;
  ok: boolean;
  anomalies: SyncAnomaly[];
  metrics: {
    dbStudents: number;
    epStudents: number;
    dbSections: number;
    epSections: number;
    dbTeachers: number;
    epTeachers: number;
    dbEnrollmentsByYear: Record<string, number>;
    epEnrollments: number;
  };
  lastPruneAt: string | null;
  lastPruneCounts: Record<string, number> | null;
}

export interface OrphanReport {
  orphanStudents: {
    id: string;
    lrn: string;
    name: string;
    lastEnrollmentYear: string | null;
  }[];
  staleEnrollmentYears: string[];
  usersWithoutTeacherProfile: {
    id: string;
    username: string;
    role: string;
    createdAt: Date;
  }[];
  teachersMissingFromEnrollPro: {
    employeeId: string;
    name: string;
  }[];
}

// ---------------------------------------------------------------------------
// Orphan detection (Task 4 — standalone checker)
// ---------------------------------------------------------------------------

/**
 * Find orphaned and stale data in the current DB.
 * Read-only. The remedy for orphans is db:wipe + resync, not surgical deletes.
 */
export async function findOrphanedData(): Promise<OrphanReport> {
  // 1. Orphan students: Student with zero Enrollments, or only enrollments in non-active years
  const activeSettings = await prisma.systemSettings.findUnique({
    where: { id: "main" },
  });
  const activeYear = activeSettings?.currentSchoolYear ?? "UNSET";

  const [allStudents, enrollmentYearGroups] = await Promise.all([
    prisma.student.findMany({
      include: {
        enrollments: {
          select: { schoolYear: true },
        },
      },
    }),
    prisma.enrollment.groupBy({
      by: ["schoolYear"],
      _count: { id: true },
    }),
  ]);

  const orphanStudents: OrphanReport["orphanStudents"] = [];

  for (const student of allStudents) {
    if (student.enrollments.length === 0) {
      orphanStudents.push({
        id: student.id,
        lrn: student.lrn,
        name: `${student.lastName}, ${student.firstName}`,
        lastEnrollmentYear: null,
      });
    } else {
      const years = student.enrollments.map((e) => e.schoolYear);
      if (years.every((y) => y !== activeYear)) {
        // Student only has enrollments in non-active years
        const latestYear = [...years].sort().pop()!;
        orphanStudents.push({
          id: student.id,
          lrn: student.lrn,
          name: `${student.lastName}, ${student.firstName}`,
          lastEnrollmentYear: latestYear,
        });
      }
    }
  }

  // Stale years derived from ALL enrollments — catches students with
  // enrollments in BOTH active and stale years, not just fully-stale students.
  const staleEnrollmentYears = enrollmentYearGroups
    .map((g) => g.schoolYear)
    .filter((y) => y !== activeYear)
    .sort();

  // 2. Users with role TEACHER but no Teacher profile
  const usersWithoutTeacherProfile = await prisma.user.findMany({
    where: {
      role: "TEACHER",
      teacher: null,
    },
    select: {
      id: true,
      username: true,
      role: true,
      createdAt: true,
    },
  });

  // 3. Teachers whose employeeId is absent from EnrollPro current faculty
  const teachersMissingFromEnrollPro: OrphanReport["teachersMissingFromEnrollPro"] = [];
  try {
    const epTeachers = await getEnrollProTeachers();
    const epEmployeeIds = new Set(epTeachers.map((t) => t.employeeId));

    const dbTeachers = await prisma.teacher.findMany({
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    for (const teacher of dbTeachers) {
      if (!epEmployeeIds.has(teacher.employeeId)) {
        teachersMissingFromEnrollPro.push({
          employeeId: teacher.employeeId,
          name: teacher.user
            ? `${teacher.user.lastName ?? ""}, ${teacher.user.firstName ?? ""}`
            : "(no user)",
        });
      }
    }
  } catch (err) {
    logger.warn("[syncVerification] Could not fetch EnrollPro teachers for orphan check:", err);
  }

  return {
    orphanStudents,
    staleEnrollmentYears,
    usersWithoutTeacherProfile,
    teachersMissingFromEnrollPro,
  };
}

// ---------------------------------------------------------------------------
// Verification report (Task 3)
// ---------------------------------------------------------------------------

/**
 * Build a comprehensive sync verification report.
 * Compares DB state against EnrollPro for the active school year.
 */
export async function buildSyncVerificationReport(): Promise<SyncVerificationReport> {
  const anomalies: SyncAnomaly[] = [];
  const generatedAt = new Date().toISOString();

  // Resolve active school year
  let activeYearLabel: string | null = null;
  try {
    const sy = await resolveEnrollProSchoolYear();
    activeYearLabel = sy.yearLabel;
  } catch {
    try {
      const settings = await prisma.systemSettings.findUnique({
        where: { id: "main" },
      });
      activeYearLabel = settings?.currentSchoolYear ?? null;
    } catch {
      // leave null
    }
  }

  // Collect DB metrics
  const [
    dbStudentsWithEnrollment,
    dbSections,
    dbActiveTeachers,
    enrollmentsByYear,
  ] = await Promise.all([
    // Students with at least one enrollment in the active year
    activeYearLabel
      ? prisma.student.count({
          where: {
            enrollments: { some: { schoolYear: activeYearLabel } },
          },
        })
      : Promise.resolve(0),
    // Sections in active year
    activeYearLabel
      ? prisma.section.count({
          where: { schoolYear: activeYearLabel },
        })
      : Promise.resolve(0),
    // Active teachers (with a class assignment in active year)
    activeYearLabel
      ? prisma.teacher.count({
          where: {
            classAssignments: { some: { schoolYear: activeYearLabel, isActive: true } },
          },
        })
      : Promise.resolve(0),
    // Enrollments grouped by year
    prisma.enrollment
      .groupBy({
        by: ["schoolYear"],
        _count: { id: true },
      })
      .then((rows) =>
        Object.fromEntries(rows.map((r) => [r.schoolYear, r._count.id]))
      ),
  ]);

  // Collect EnrollPro metrics
  let epStudents = 0;
  let epSections = 0;
  let epTeachers = 0;
  let epEnrollments = 0;
  let epReachable = true;

  try {
    const [epTeacherList, epSectionList, epLearnerList] = await Promise.all([
      getEnrollProTeachers(),
      getAllIntegrationV1Sections(),
      getAllIntegrationV1Learners(),
    ]);
    epTeachers = epTeacherList.length;
    epSections = epSectionList.length;
    epStudents = epLearnerList.length;
    epEnrollments = epLearnerList.length; // Each learner = one enrollment in EP
  } catch (err) {
    epReachable = false;
    anomalies.push({
      code: "ENROLLPRO_UNREACHABLE",
      severity: "WARNING",
      message: "Could not reach EnrollPro API. Counts below are DB-only.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Check anomalies
  if (epReachable && activeYearLabel) {
    // Student count mismatch
    if (dbStudentsWithEnrollment !== epStudents) {
      anomalies.push({
        code: "STUDENT_COUNT_MISMATCH",
        severity: "CRITICAL",
        message: `DB has ${dbStudentsWithEnrollment} students with enrollments in ${activeYearLabel}, EnrollPro has ${epStudents}.`,
        detail: { db: dbStudentsWithEnrollment, ep: epStudents, year: activeYearLabel },
      });
    }

    // Section count mismatch
    if (dbSections !== epSections) {
      anomalies.push({
        code: "SECTION_ENROLLMENT_MISMATCH",
        severity: "WARNING",
        message: `DB has ${dbSections} sections in ${activeYearLabel}, EnrollPro has ${epSections}.`,
        detail: { db: dbSections, ep: epSections },
      });
    }

    // Teacher count mismatch
    if (dbActiveTeachers !== epTeachers) {
      anomalies.push({
        code: "TEACHER_COUNT_MISMATCH",
        severity: "WARNING",
        message: `DB has ${dbActiveTeachers} active teachers, EnrollPro has ${epTeachers}.`,
        detail: { db: dbActiveTeachers, ep: epTeachers },
      });
    }
  }

  // Multiple years in enrollments (expected exactly 1 right after wipe+resync)
  const yearLabels = Object.keys(enrollmentsByYear);
  if (yearLabels.length > 1) {
    anomalies.push({
      code: "MULTIPLE_YEARS_IN_ENROLLMENTS",
      severity: "WARNING",
      message: `DB has enrollments in ${yearLabels.length} school years: ${yearLabels.join(", ")}. Expected exactly 1 after wipe+resync.`,
      detail: enrollmentsByYear,
    });
  }

  // Orphan and stale data checks (Task 4 integrated)
  const orphanReport = await findOrphanedData();

  if (orphanReport.orphanStudents.length > 0) {
    anomalies.push({
      code: "ORPHAN_STUDENTS",
      severity: "WARNING",
      message: `${orphanReport.orphanStudents.length} students have no enrollment in the active year.`,
      detail: orphanReport.orphanStudents.slice(0, 10), // Cap detail size
    });
  }

  if (
    orphanReport.usersWithoutTeacherProfile.length > 0 ||
    orphanReport.teachersMissingFromEnrollPro.length > 0
  ) {
    anomalies.push({
      code: "UNEXPECTED_USER_ACCOUNTS",
      severity: "CRITICAL",
      message:
        `${orphanReport.usersWithoutTeacherProfile.length} TEACHER users without profile, ` +
        `${orphanReport.teachersMissingFromEnrollPro.length} teachers missing from EnrollPro.`,
      detail: {
        usersWithoutProfile: orphanReport.usersWithoutTeacherProfile.slice(0, 5),
        missingFromEP: orphanReport.teachersMissingFromEnrollPro.slice(0, 5),
      },
    });
  }

  const hasNonInfoAnomalies = anomalies.some((a) => a.severity !== "INFO");

  // Prune stats from latest AuditLog
  let lastPruneAt: string | null = null;
  let lastPruneCounts: Record<string, number> | null = null;
  try {
    const lastPruneLog = await prisma.auditLog.findFirst({
      where: { targetType: 'Prune', action: 'DELETE' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, details: true },
    });
    if (lastPruneLog) {
      lastPruneAt = lastPruneLog.createdAt.toISOString();
      try {
        lastPruneCounts = JSON.parse(lastPruneLog.details);
      } catch { /* non-fatal */ }
    }
  } catch { /* non-fatal */ }

  return {
    generatedAt,
    activeSchoolYear: activeYearLabel,
    ok: !hasNonInfoAnomalies,
    anomalies,
    metrics: {
      dbStudents: dbStudentsWithEnrollment,
      epStudents,
      dbSections,
      epSections,
      dbTeachers: dbActiveTeachers,
      epTeachers,
      dbEnrollmentsByYear: enrollmentsByYear,
      epEnrollments,
    },
    lastPruneAt,
    lastPruneCounts,
  };
}
