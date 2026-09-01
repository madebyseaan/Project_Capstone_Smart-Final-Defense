import { Router, Request, Response } from "express";
import { GradeLevel, Term } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { triggerImmediateSync, getUnifiedSyncStatus } from "../../lib/syncCoordinator";
import {
  getAllIntegrationV1Sections,
  getIntegrationV1LearnersPage,
  resolveEnrollProSchoolYear,
  getEnrollProSectionRoster,
} from "../../lib/enrollproClient";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { withSectionLock } from "../../lib/sectionLock";
import { validate } from "../../middleware/validate";
import { enrollmentStatusSchema, finalizeGradesSchema } from "../../schemas/registrar";
import {
  resolveCurrentSchoolYearLabel,
  getSyncFreshness,
  normalizeGradeLevel,
  normalizeSex,
  normalizeDisplaySex,
  studentsByGrace,
} from "./helpers";

export default function registerMainRoutes(router: Router): void {

// Get registrar dashboard stats
router.get("/dashboard", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const currentSchoolYear = await resolveCurrentSchoolYearLabel();
    const syncStatus = getUnifiedSyncStatus();
    const syncFreshness = getSyncFreshness(syncStatus.lastSyncAt);

    if (syncFreshness.status === "stale" && syncFreshness.lastSyncedAt && !syncStatus.running && !syncStatus.circuitBreaker.open) {
      triggerImmediateSync("registrar_page_load");
    }

    // Get all sections for current school year (local fallback)
    const sections = await prisma.section.findMany({
      where: { schoolYear: currentSchoolYear },
      include: {
        _count: {
          select: { 
            enrollments: {
              where: { status: "ENROLLED" }
            }
          }
        },
        adviser: {
          include: {
            user: true
          }
        }
      }
    });

    // Local fallback metrics from SMART DB (deduped by student).
    const localEnrolledStudents = await prisma.enrollment.findMany({
      where: { 
        schoolYear: currentSchoolYear,
        status: "ENROLLED"
      },
      distinct: ["studentId"],
      select: {
        studentId: true,
        student: { select: { gender: true, birthDate: true, lrn: true } },
      },
    });
    const localTotalStudents = localEnrolledStudents.length;

    // Preferred real-time metric from EnrollPro integration feed.
    let totalStudents = localTotalStudents;
    let totalSections = sections.length;
    let sectionSummary = sections.map(section => ({
      id: section.id,
      name: section.name,
      gradeLevel: section.gradeLevel,
      program: section.program,
      studentCount: section._count.enrollments,
      adviser: section.adviser ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}` : null
    }));
    let maleCount = localEnrolledStudents.filter((row) => normalizeSex(row.student.gender) === "male").length;
    let femaleCount = localEnrolledStudents.filter((row) => normalizeSex(row.student.gender) === "female").length;
    const gradeStats: Record<string, number> = {
      GRADE_7: 0,
      GRADE_8: 0,
      GRADE_9: 0,
      GRADE_10: 0,
    };
    let totalStudentsSource: "enrollpro-realtime" | "smart-db-fallback" = "smart-db-fallback";

    // Compute local grade stats from section enrollments as fallback.
    const studentsByGrade = await prisma.enrollment.groupBy({
      by: ['sectionId'],
      where: {
        schoolYear: currentSchoolYear,
        status: "ENROLLED"
      },
      _count: true
    });
    const sectionMap = new Map(sections.map(s => [s.id, s.gradeLevel]));
    studentsByGrace(studentsByGrade, sectionMap, gradeStats);

    try {
      // Two lightweight requests in parallel:
      // 1. learnersPage(limit=1)  → meta.total for accurate student count (no full fetch)
      // 2. getAllIntegrationV1Sections → paginated until ALL sections are returned (fixes 50-section cap)
      const resolvedSchoolYear = await resolveEnrollProSchoolYear(currentSchoolYear);
      const [learnersPage, epSections] = await Promise.all([
        getIntegrationV1LearnersPage(resolvedSchoolYear.id, 1, 1),
        getAllIntegrationV1Sections(resolvedSchoolYear.id),
      ]);

      const metaTotal = Number(learnersPage.meta?.total ?? NaN);
      if (Number.isFinite(metaTotal) && metaTotal >= 0) {
        totalStudents = metaTotal;
        totalStudentsSource = "enrollpro-realtime";
      }

      // Use full section list from EnrollPro (all pages)
      totalSections = epSections.length;
      sectionSummary = epSections.map((section: any) => ({
        id: String(section?.id ?? ''),
        name: String(section?.name ?? ''),
        gradeLevel: normalizeGradeLevel(section?.gradeLevel?.name) ?? "GRADE_7",
        program: (() => { const pt = (section?.programType ?? '').toUpperCase(); if (pt.includes('ARTS')) return 'SPA'; if (pt.includes('SPORT')) return 'SPS'; if (pt.includes('SCIENCE') || pt.includes('ENGINEERING') || pt.includes('STE')) return 'STE'; return 'REGULAR'; })(),
        studentCount: Number(section?.enrolledCount ?? 0),
        adviser: section?.advisingTeacher
          ? (
              `${String(section.advisingTeacher.firstName ?? '')} ${String(section.advisingTeacher.lastName ?? '')}`.trim() ||
              String(section.advisingTeacher.name ?? '').trim() ||
              null
            )
          : null,
      }));

      logger.info(`[RegistrarDashboard] EnrollPro: ${totalStudents} students, ${totalSections} sections (all pages fetched)`);

      // Live gender breakdown from EnrollPro learners (page 1 up to 500; fetch more if needed)
      try {
        const genderPage1 = await getIntegrationV1LearnersPage(resolvedSchoolYear.id, 1, 500);
        const allLearnerRows: any[] = [...(genderPage1.data ?? [])];
        const genderTotalPages = Number(genderPage1.meta?.totalPages ?? 1);
        for (let p = 2; p <= genderTotalPages; p++) {
          const pg = await getIntegrationV1LearnersPage(resolvedSchoolYear.id, p, 500);
          allLearnerRows.push(...(pg.data ?? []));
        }
        maleCount = allLearnerRows.filter((r: any) => {
          const s = r.learner?.sex ?? r.learner?.gender ?? r.sex ?? r.gender;
          return normalizeSex(s) === "male";
        }).length;
        femaleCount = allLearnerRows.filter((r: any) => {
          const s = r.learner?.sex ?? r.learner?.gender ?? r.sex ?? r.gender;
          return normalizeSex(s) === "female";
        }).length;
        // Recompute grade distribution from live EnrollPro section enrolled counts
        Object.keys(gradeStats).forEach(k => { gradeStats[k] = 0; });
        epSections.forEach((section: any) => {
          const gl = normalizeGradeLevel(section?.gradeLevel?.name);
          if (gl && gradeStats[gl] !== undefined) {
            gradeStats[gl] += Number(section?.enrolledCount ?? 0);
          }
        });
      } catch (genderErr) {
        logger.warn("[RegistrarDashboard] Gender count fallback to local DB:", (genderErr as Error).message);
      }
    } catch (error) {
      logger.warn("[RegistrarDashboard] Falling back to SMART DB metrics:", (error as Error).message);
    }

    const missingBirthDate = localEnrolledStudents.filter((row) => !row.student.birthDate).length;
    const missingLrn = localEnrolledStudents.filter((row) => !row.student.lrn || String(row.student.lrn).trim().length === 0).length;

    // Enrollment status breakdown for current school year
    const enrollmentStatusCounts = await prisma.enrollment.groupBy({
      by: ['status'],
      where: { schoolYear: currentSchoolYear },
      _count: true,
    });
    const statusMap = new Map(enrollmentStatusCounts.map((row) => [row.status, row._count]));
    const activeStudents = statusMap.get("ENROLLED") ?? 0;
    const droppedStudents = statusMap.get("DROPPED") ?? 0;
    const transferredStudents = statusMap.get("TRANSFERRED") ?? 0;
    const pendingStudents = statusMap.get("PENDING") ?? 0;

    // Grade performance stats: average grade and passing rate per section (current term)
    let gradePerformance: {
      overallPassingRate: number;
      overallAvgGrade: number;
      totalGraded: number;
      totalPassing: number;
      totalFailing: number;
      failingStudents: Array<{
        studentName: string;
        sectionName: string;
        gradeLevel: string;
        average: number;
      }>;
      bySection: Array<{
        sectionId: string;
        sectionName: string;
        gradeLevel: string;
        avgGrade: number | null;
        passingRate: number;
        totalStudents: number;
        failingCount: number;
        failingStudents: Array<{ studentName: string; average: number }>;
      }>;
    } = { overallPassingRate: 0, overallAvgGrade: 0, totalGraded: 0, totalPassing: 0, totalFailing: 0, failingStudents: [], bySection: [] };

    try {
      const settingsRow = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      const currentTerm = (settingsRow?.currentTerm ?? "T1") as Term;

      const gradedEnrollments = await prisma.grade.findMany({
        where: {
          classAssignment: {
            section: { schoolYear: currentSchoolYear },
          },
          term: currentTerm,
          quarterlyGrade: { not: null },
        },
        select: {
          quarterlyGrade: true,
          studentId: true,
          student: { select: { firstName: true, lastName: true } },
          classAssignment: {
            select: {
              sectionId: true,
              section: { select: { id: true, name: true, gradeLevel: true } },
            },
          },
        },
      });

      // Group grades by section, then by student to compute per-student averages
      const sectionStudentGrades = new Map<string, {
        sectionName: string;
        gradeLevel: string;
        studentGrades: Map<string, { grades: number[]; firstName: string; lastName: string }>;
      }>();

      for (const rec of gradedEnrollments) {
        const secId = rec.classAssignment.sectionId;
        if (!sectionStudentGrades.has(secId)) {
          sectionStudentGrades.set(secId, {
            sectionName: rec.classAssignment.section.name,
            gradeLevel: rec.classAssignment.section.gradeLevel,
            studentGrades: new Map(),
          });
        }
        const section = sectionStudentGrades.get(secId)!;
        const existing = section.studentGrades.get(rec.studentId);
        if (existing) {
          existing.grades.push(rec.quarterlyGrade!);
        } else {
          section.studentGrades.set(rec.studentId, {
            grades: [rec.quarterlyGrade!],
            firstName: rec.student.firstName,
            lastName: rec.student.lastName,
          });
        }
      }

      // Compute per-student averages and section stats
      const allFailingStudents: Array<{
        studentName: string;
        sectionName: string;
        gradeLevel: string;
        average: number;
      }> = [];

      const bySection = Array.from(sectionStudentGrades.entries()).map(([secId, data]) => {
        const studentAverages: number[] = [];
        let failingStudents = 0;
        const sectionFailingList: Array<{ studentName: string; average: number }> = [];

        for (const [, studentData] of data.studentGrades) {
          const avg = Math.round(studentData.grades.reduce((s, g) => s + g, 0) / studentData.grades.length);
          studentAverages.push(avg);
          if (avg < 75) {
            failingStudents++;
            const name = `${studentData.lastName}, ${studentData.firstName}`;
            sectionFailingList.push({ studentName: name, average: avg });
            allFailingStudents.push({
              studentName: name,
              sectionName: data.sectionName,
              gradeLevel: data.gradeLevel,
              average: avg,
            });
          }
        }

        const totalStudents = studentAverages.length;
        const passingStudents = totalStudents - failingStudents;
        const avgGrade = totalStudents > 0
          ? Math.round(studentAverages.reduce((s, g) => s + g, 0) / totalStudents)
          : null;

        return {
          sectionId: secId,
          sectionName: data.sectionName,
          gradeLevel: data.gradeLevel,
          avgGrade,
          passingRate: totalStudents > 0 ? Math.round((passingStudents / totalStudents) * 100) : 0,
          totalStudents,
          failingCount: failingStudents,
          failingStudents: sectionFailingList.sort((a, b) => a.studentName.localeCompare(b.studentName)),
        };
      }).sort((a, b) => a.sectionName.localeCompare(b.sectionName));

      // Overall stats: unique students across all sections
      const allStudentAverages = Array.from(sectionStudentGrades.values()).flatMap((data) =>
        Array.from(data.studentGrades.values()).map((studentData) =>
          Math.round(studentData.grades.reduce((s, g) => s + g, 0) / studentData.grades.length)
        )
      );
      const totalGraded = allStudentAverages.length;
      const totalPassing = allStudentAverages.filter((g) => g >= 75).length;
      const totalFailing = totalGraded - totalPassing;

      gradePerformance = {
        overallPassingRate: totalGraded > 0 ? Math.round((totalPassing / totalGraded) * 100) : 0,
        overallAvgGrade: totalGraded > 0 ? Math.round(allStudentAverages.reduce((s, g) => s + g, 0) / totalGraded) : 0,
        totalGraded,
        totalPassing,
        totalFailing,
        failingStudents: allFailingStudents.sort((a, b) => a.studentName.localeCompare(b.studentName)),
        bySection,
      };
    } catch (gradeErr) {
      logger.warn("[RegistrarDashboard] Grade performance query failed:", (gradeErr as Error).message);
    }

    res.json({
      currentSchoolYear,
      stats: {
        totalStudents,
        totalStudentsSource,
        localTotalStudents,
        totalSections,
        maleCount,
        femaleCount,
        gradeStats,
        activeStudents,
        droppedStudents,
        transferredStudents,
        pendingStudents,
      },
      sections: sectionSummary,
      sync: {
        running: syncStatus.running,
        ...syncFreshness,
      },
      dataCompleteness: {
        missingBirthDate,
        missingLrn,
        totalIssues: missingBirthDate + missingLrn,
      },
      gradePerformance,
    });
  } catch (error) {
    logger.error("Error fetching registrar dashboard:", error);
    res.status(500).json({ message: "Failed to fetch dashboard data" });
  }
});

// Get registrar sync freshness and status badge info.
router.get("/sync/status", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const syncStatus = getUnifiedSyncStatus();
    res.json({
      running: syncStatus.running,
      ...getSyncFreshness(syncStatus.lastSyncAt),
      cycleCount: syncStatus.cycleCount,
      lastResult: syncStatus.lastResult,
    });
  } catch (error) {
    logger.error("Error fetching registrar sync status:", error);
    res.status(500).json({ message: "Failed to fetch sync status" });
  }
});

// Trigger force sync for registrar workflows (fire-and-forget).
router.post("/sync/run", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    triggerImmediateSync("registrar_manual");
    const syncStatus = getUnifiedSyncStatus();

    res.json({
      message: "Sync queued",
      running: syncStatus.running,
      ...getSyncFreshness(syncStatus.lastSyncAt),
    });
  } catch (error) {
    logger.error("Error triggering registrar sync:", error);
    res.status(500).json({ message: "Failed to trigger sync" });
  }
});

// Get available school years
router.get("/school-years", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    // Get unique school years from sections
    const sections = await prisma.section.findMany({
      select: { schoolYear: true },
      distinct: ['schoolYear'],
      orderBy: { schoolYear: 'desc' }
    });

    const schoolYears = sections.map(s => s.schoolYear);

    const allYears = new Set(schoolYears);
    try {
      const resolved = await resolveEnrollProSchoolYear();
      if (resolved.yearLabel) {
        allYears.add(resolved.yearLabel);
      }
    } catch (error) {
      logger.warn("[RegistrarSchoolYears] Failed to resolve active EnrollPro school year:", (error as Error).message);
    }

    res.json({
      schoolYears: Array.from(allYears).sort().reverse()
    });
  } catch (error) {
    logger.error("Error fetching school years:", error);
    res.status(500).json({ message: "Failed to fetch school years" });
  }
});

// Get students by school year
router.get("/students", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { schoolYear, gradeLevel, sectionId, search } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    // Trigger sync if stale, similar to dashboard
    const syncStatus = getUnifiedSyncStatus();
    const syncFreshness = getSyncFreshness(syncStatus.lastSyncAt);
    if (syncFreshness.status === "stale" && syncFreshness.lastSyncedAt && !syncStatus.running && !syncStatus.circuitBreaker.open) {
      logger.info(`[RegistrarStudents] Data is stale (${syncFreshness.minutesSinceLastSync}m), triggering background sync...`);
      triggerImmediateSync("registrar_students_load");
    }

    // Build where clause for enrollments
    const enrollmentWhere: any = {
      schoolYear: currentSchoolYear,
      status: "ENROLLED"
    };

    if (sectionId && sectionId !== "all") {
      enrollmentWhere.sectionId = sectionId;
    }

    // Get enrollments with student and section data
    const enrollments = await prisma.enrollment.findMany({
      where: enrollmentWhere,
      include: {
        student: true,
        section: {
          include: {
            adviser: {
              include: { user: true }
            }
          }
        }
      },
      orderBy: [
        { student: { lastName: 'asc' } },
        { student: { firstName: 'asc' } }
      ]
    });

    // Filter by grade level if specified
    let filteredEnrollments = enrollments;
    if (gradeLevel && gradeLevel !== "all") {
      filteredEnrollments = enrollments.filter(e => e.section.gradeLevel === gradeLevel);
    }

    // Filter by search query
    if (search) {
      const searchLower = (search as string).toLowerCase();
      filteredEnrollments = filteredEnrollments.filter(e => {
        const fullName = `${e.student.lastName} ${e.student.firstName} ${e.student.middleName || ""}`.toLowerCase();
        return fullName.includes(searchLower) || e.student.lrn.includes(searchLower);
      });
    }

    // Deduplicate by studentId to prevent overcounting if stale enrollments exist
    const uniqueEnrollmentsMap = new Map<string, typeof filteredEnrollments[0]>();
    for (const e of filteredEnrollments) {
      // Keep the most recent enrollment by simply overwriting (since they might not be sorted by date here)
      uniqueEnrollmentsMap.set(e.studentId, e);
    }
    const uniqueFilteredEnrollments = Array.from(uniqueEnrollmentsMap.values());

    // Transform data
    const students = uniqueFilteredEnrollments.map(e => ({
      id: e.student.id,
      enrollmentId: e.id,
      lrn: e.student.lrn,
      firstName: e.student.firstName,
      middleName: e.student.middleName,
      lastName: e.student.lastName,
      suffix: e.student.suffix,
      gender: normalizeDisplaySex(e.student.gender),
      birthDate: e.student.birthDate,
      address: e.student.address,
      guardianName: e.student.guardianName,
      guardianContact: e.student.guardianContact,
      gradeLevel: e.section.gradeLevel,
      sectionId: e.section.id,
      sectionName: e.section.name,
      program: e.section.program,
      schoolYear: e.schoolYear,
      status: e.status,
      adviser: e.section.adviser ? `${e.section.adviser.user.firstName} ${e.section.adviser.user.lastName}` : null
    }));

    // Get sections for filter
    const sections = await prisma.section.findMany({
      where: { schoolYear: currentSchoolYear },
      select: {
        id: true,
        name: true,
        gradeLevel: true,
        program: true
      },
      orderBy: [
        { gradeLevel: 'asc' },
        { name: 'asc' }
      ]
    });

    // Stats
    const missingBirthDate = students.filter(s => !s.birthDate).length;
    const missingLrn = students.filter(s => !s.lrn || String(s.lrn).trim().length === 0).length;

    const stats = {
      total: students.length,
      byGrade: {
        GRADE_7: students.filter(s => s.gradeLevel === "GRADE_7").length,
        GRADE_8: students.filter(s => s.gradeLevel === "GRADE_8").length,
        GRADE_9: students.filter(s => s.gradeLevel === "GRADE_9").length,
        GRADE_10: students.filter(s => s.gradeLevel === "GRADE_10").length
      },
      byGender: {
        male: students.filter(s => s.gender?.toLowerCase() === "male").length,
        female: students.filter(s => s.gender?.toLowerCase() === "female").length
      },
      dataCompleteness: {
        missingBirthDate,
        missingLrn,
        totalIssues: missingBirthDate + missingLrn,
      }
    };

    res.json({
      students,
      sections,
      stats,
      schoolYear: currentSchoolYear,
      source: "smart-db-fallback"
    });
  } catch (error) {
    logger.error("Error fetching students:", error);
    res.status(500).json({ message: "Failed to fetch students" });
  }
});

// Trigger EnrollPro sync from registrar portal
router.post("/sync-enrollpro", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }
    triggerImmediateSync("registrar-sync");
    res.json({ message: "EnrollPro sync triggered. Data will update shortly." });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to trigger sync" });
  }
});

// Map EnrollPro grade level name to SMART GradeLevel enum
function mapGradeLevel(name: string | null | undefined): GradeLevel | null {
  const n = (name ?? '').toLowerCase();
  if (n.includes('10')) return 'GRADE_10';
  if (n.includes('7'))  return 'GRADE_7';
  if (n.includes('8'))  return 'GRADE_8';
  if (n.includes('9'))  return 'GRADE_9';
  return null;
}

// Keyword-based EnrollPro status classification (mirrors mapEpEnrollmentStatus in enrollproSync.ts)
function classifyEpStatus(raw: string | null | undefined): 'ENROLLED' | 'DROPPED' | 'TRANSFERRED' | 'GRADUATED' | null {
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

// Lightweight sync: fetch inactive students (TRANSFERRED/DROPPED) directly from EnrollPro
// Uses both the learners feed AND the SMART students lifecycle feed to catch all inactive students.
router.post("/sync-inactive-students", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { getAllIntegrationV1Learners, getSmartStudentsFeed } = await import("../../lib/enrollproClient");
    const schoolYearLabel = await getActiveSchoolYearLabel();

    // ── Source 1: learners feed (keyword-based matching) ─────────────────
    const allLearners = await getAllIntegrationV1Learners();
    logger.info(`[Registrar] Inactive sync: fetched ${allLearners.length} learners from EnrollPro`);

    const inactiveFromFeed: Array<{ record: any; smartStatus: 'TRANSFERRED' | 'DROPPED' | 'GRADUATED' }> = [];
    for (const record of allLearners) {
      const raw = String(record.status ?? record.learner?.status ?? record.enrollment?.status ?? '');
      const classified = classifyEpStatus(raw);
      if (classified === 'TRANSFERRED' || classified === 'DROPPED' || classified === 'GRADUATED') {
        inactiveFromFeed.push({ record, smartStatus: classified });
      }
    }

    logger.info(`[Registrar] Inactive sync: found ${inactiveFromFeed.length} inactive students from learners feed`);

    // ── Source 1b: Unscoped learners feed (no SY filter — catches inactive students
    //    that may not appear in the scoped learners feed)
    try {
      const unscopedLearners = await getAllIntegrationV1Learners(null);
      logger.info(`[Registrar] Inactive sync: fetched ${unscopedLearners.length} learners from unscoped feed`);
      for (const record of unscopedLearners) {
        const l = record.learner ?? record;
        const lrn = String(l.lrn ?? '').trim();
        if (!lrn) continue;
        const raw = String(record.status ?? l.status ?? record.enrollment?.status ?? '');
        const classified = classifyEpStatus(raw);
        if (classified === 'TRANSFERRED' || classified === 'DROPPED' || classified === 'GRADUATED') {
          // Dedup by LRN — only add if not already found from scoped feed
          const alreadyFound = inactiveFromFeed.some(e => {
            const eLrn = String((e.record.learner ?? e.record).lrn ?? '').trim();
            return eLrn === lrn;
          });
          if (!alreadyFound) {
            inactiveFromFeed.push({ record, smartStatus: classified });
          }
        }
      }
    } catch (unscopedErr: any) {
      logger.warn(`[Registrar] Inactive sync: unscoped learners feed failed (non-fatal): ${unscopedErr.message}`);
    }

    // ── Source 2: SMART students lifecycle feed (catches transferred-out students
    //    that may not appear in the learners feed). Paginated — fetches all pages.
    let lifecycleInactive: Array<{ lrn: string; smartStatus: 'TRANSFERRED' | 'DROPPED' | 'GRADUATED'; transferOutDate?: Date | null; dropOutDate?: Date | null; dropOutReason?: string | null; studentData?: any }> = [];
    try {
      const smartStudents = await getSmartStudentsFeed();
      for (const s of smartStudents) {
        const raw = String(s.eosyStatus ?? s.status ?? '').toUpperCase();
        const classified = classifyEpStatus(raw);
        if (classified !== 'TRANSFERRED' && classified !== 'DROPPED' && classified !== 'GRADUATED') continue;

        const lrn = String(s.lrn ?? '').trim();
        if (!lrn) continue;

        lifecycleInactive.push({
          lrn,
          smartStatus: classified,
          transferOutDate: s.transferOutDate ? new Date(s.transferOutDate) : null,
          dropOutDate: s.dropOutDate ? new Date(s.dropOutDate) : null,
          dropOutReason: s.dropOutReason ?? null,
          studentData: s,
        });
      }
      logger.info(`[Registrar] Inactive sync: found ${lifecycleInactive.length} inactive students from lifecycle feed`);
    } catch (lifecycleErr: any) {
      logger.warn(`[Registrar] Inactive sync: lifecycle feed failed (non-fatal): ${lifecycleErr.message}`);
    }

    // ── Merge both sources, dedup by LRN ────────────────────────────────
    let upserted = 0;
    const processedLrns = new Set<string>();

    // Process learners feed first
    for (const { record, smartStatus } of inactiveFromFeed) {
      const l = record.learner ?? record;
      const lrn = String(l.lrn ?? '').trim();
      if (!lrn || processedLrns.has(lrn)) continue;
      processedLrns.add(lrn);

      // Find or create student
      let student = await prisma.student.findUnique({ where: { lrn } });
      if (!student) {
        student = await prisma.student.create({
          data: {
            lrn,
            firstName: l.firstName ?? '',
            lastName: l.lastName ?? '',
            middleName: l.middleName ?? null,
            suffix: l.suffix ?? null,
            gender: String(l.sex ?? '').toUpperCase().startsWith('F') ? 'FEMALE' : 'MALE',
            birthDate: l.birthdate ? new Date(l.birthdate) : null,
          },
        });
      }

      // Find section for this student in current SY
      const existingEnrollment = await prisma.enrollment.findFirst({
        where: { studentId: student.id, schoolYear: schoolYearLabel },
        include: { section: true },
      });

      if (existingEnrollment) {
        if (existingEnrollment.status !== smartStatus) {
          await prisma.enrollment.update({
            where: { id: existingEnrollment.id },
            data: { status: smartStatus as any },
          });
          upserted++;
        }
      } else {
        const sectionName = l.sectionName ?? l.section?.name ?? l.advisoryName ?? null;
        if (sectionName) {
          const section = await prisma.section.findFirst({
            where: { name: sectionName, schoolYear: schoolYearLabel },
          });
          if (section) {
            await prisma.enrollment.create({
              data: {
                studentId: student.id,
                sectionId: section.id,
                schoolYear: schoolYearLabel,
                status: smartStatus as any,
              },
            });
            upserted++;
          }
        }
      }
    }

    // Process lifecycle feed students not already handled
    for (const entry of lifecycleInactive) {
      if (processedLrns.has(entry.lrn)) continue;
      processedLrns.add(entry.lrn);

      const sData = entry.studentData ?? {};
      let student = await prisma.student.findUnique({ where: { lrn: entry.lrn } });
      if (!student) {
        student = await prisma.student.create({
          data: {
            lrn: entry.lrn,
            firstName: sData.firstName ?? '',
            lastName: sData.lastName ?? '',
            middleName: sData.middleName ?? null,
            suffix: sData.extensionName ?? null,
            gender: String(sData.sex ?? '').toUpperCase().startsWith('F') ? 'FEMALE' : 'MALE',
          },
        });
      }

      const existingEnrollment = await prisma.enrollment.findFirst({
        where: { studentId: student.id, schoolYear: schoolYearLabel },
      });

      if (existingEnrollment) {
        const updateData: Record<string, any> = {};
        if (existingEnrollment.status !== entry.smartStatus) updateData.status = entry.smartStatus;
        if (entry.transferOutDate && !existingEnrollment.transferOutDate) updateData.transferOutDate = entry.transferOutDate;
        if (entry.dropOutDate && !existingEnrollment.dropOutDate) updateData.dropOutDate = entry.dropOutDate;
        if (entry.dropOutReason && !existingEnrollment.dropOutReason) updateData.dropOutReason = entry.dropOutReason;
        if (Object.keys(updateData).length > 0) {
          await prisma.enrollment.update({ where: { id: existingEnrollment.id }, data: updateData });
          upserted++;
        }
      } else {
        // Find section from SMART feed data or from prior enrollment
        let sectionId: string | null = null;

        // Try from SMART feed: sData.section.name + sData.gradeLevel.name
        const epSectionName = sData.section?.name;
        const epGradeLevelName = sData.gradeLevel?.name;
        if (epSectionName && epGradeLevelName) {
          const mappedGrade = mapGradeLevel(epGradeLevelName);
          if (mappedGrade) {
            const section = await prisma.section.findFirst({
              where: { name: epSectionName, gradeLevel: mappedGrade, schoolYear: schoolYearLabel },
            });
            if (section) sectionId = section.id;
          }
        }

        // Fallback: any prior enrollment section
        if (!sectionId) {
          const priorEnrollment = await prisma.enrollment.findFirst({
            where: { studentId: student.id },
            orderBy: { schoolYear: 'desc' },
          });
          sectionId = priorEnrollment?.sectionId ?? null;
        }

        if (sectionId) {
          await prisma.enrollment.create({
            data: {
              studentId: student.id,
              sectionId,
              schoolYear: schoolYearLabel,
              status: entry.smartStatus as any,
              transferOutDate: entry.transferOutDate ?? null,
              dropOutDate: entry.dropOutDate ?? null,
              dropOutReason: entry.dropOutReason ?? null,
            },
          });
          upserted++;
        } else {
          logger.warn(`[Registrar] Inactive sync: no section found for ${entry.lrn}, skipping enrollment creation`);
        }
      }
    }

    res.json({
      message: `Inactive sync complete: ${upserted} students updated`,
      fetched: allLearners.length,
      inactive: processedLrns.size,
      upserted,
    });
  } catch (error: any) {
    logger.error("[Registrar] Inactive sync failed:", error.message);
    res.status(500).json({ message: "Failed to sync inactive students" });
  }
});

// Get alumni / graduated students (students no longer enrolled)
// Also fetches inactive students directly from EnrollPro as fallback
router.get("/alumni", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { search, gradeLevel, status, limit: limitParam, offset: offsetParam } = req.query;
    const limit = Math.min(parseInt(limitParam as string) || 50, 200);
    const offset = parseInt(offsetParam as string) || 0;

    // Get the current school year
    const currentSchoolYear = await resolveCurrentSchoolYearLabel();

    // Get all students who have enrollments
    const allEnrollments = await prisma.enrollment.findMany({
      include: {
        student: true,
        section: true,
      },
      orderBy: { schoolYear: 'desc' },
    });

    // Get all student IDs who are currently enrolled in the current year
    const currentlyEnrolled = new Set<string>();
    for (const enr of allEnrollments) {
      if (enr.schoolYear === currentSchoolYear && enr.status === 'ENROLLED') {
        currentlyEnrolled.add(enr.studentId);
      }
    }

    // Group by student, keep the latest enrollment
    const studentMap = new Map<string, any>();
    for (const enr of allEnrollments) {
      const existing = studentMap.get(enr.studentId);
      if (!existing || enr.schoolYear > existing.schoolYear) {
        studentMap.set(enr.studentId, enr);
      }
    }

    // Only include students who are NOT currently enrolled
    // Also exclude promoted/retained students awaiting re-enrollment (not alumni)
    let students = Array.from(studentMap.values())
      .filter((enr: any) => {
        if (currentlyEnrolled.has(enr.studentId)) return false;
        // Students with PROMOTED/CONDITIONALLY_PROMOTED/RETAINED status and no current-year
        // enrollment are awaiting re-enrollment, not alumni — unless they are JHS completers
        // or have a later TRANSFERRED/DROPPED enrollment
        const ps = enr.promotionStatus;
        const isContinuing = ps === 'PROMOTED' || ps === 'CONDITIONALLY_PROMOTED' || ps === 'RETAINED';
        if (isContinuing && ps !== 'JHS_COMPLETER') {
          // Check if student has a newer enrollment with terminal status
          const latestForStudent = allEnrollments.filter((e: any) => e.studentId === enr.studentId);
          const hasTerminal = latestForStudent.some((e: any) =>
            e.schoolYear > enr.schoolYear &&
            (e.status === 'TRANSFERRED' || e.status === 'DROPPED')
          );
          if (!hasTerminal) return false;
        }
        return true;
      })
      .map((enr: any) => ({
        id: enr.student.id,
        enrollmentId: enr.id,
        lrn: enr.student.lrn,
        firstName: enr.student.firstName,
        middleName: enr.student.middleName,
        lastName: enr.student.lastName,
        suffix: enr.student.suffix,
        gender: enr.student.gender,
        lastGradeLevel: enr.section.gradeLevel,
        lastSection: enr.section.name,
        lastSchoolYear: enr.schoolYear,
        lastProgram: enr.section.program || 'REGULAR',
        enrollmentStatus: enr.status,
      }));

    logger.info(`[Alumni] DB query: ${students.length} alumni from ${allEnrollments.length} total enrollments, ${currentlyEnrolled.size} currently enrolled, schoolYear=${currentSchoolYear}`);

    // Also fetch inactive students directly from EnrollPro (merge with DB results)
    // Uses both learners feed and SMART students lifecycle feed
    try {
      const { getAllIntegrationV1Learners, getSmartStudentsFeed } = await import("../../lib/enrollproClient");
      const existingLrns = new Set(students.map((s: any) => s.lrn));

      // Source 1: learners feed with keyword-based status matching
      const allLearners = await getAllIntegrationV1Learners();
      for (const record of allLearners) {
        const l = record.learner ?? record;
        const lrn = String(l.lrn ?? '').trim();
        if (!lrn || existingLrns.has(lrn)) continue;

        const raw = String(record.status ?? l.status ?? record.enrollment?.status ?? '');
        const smartStatus = classifyEpStatus(raw);
        if (smartStatus !== 'TRANSFERRED' && smartStatus !== 'DROPPED') continue;

        students.push({
          id: `ep-${lrn}`,
          enrollmentId: `ep-${lrn}`,
          lrn,
          firstName: l.firstName ?? '',
          middleName: l.middleName ?? null,
          lastName: l.lastName ?? '',
          suffix: l.suffix ?? null,
          gender: String(l.sex ?? '').toUpperCase().startsWith('F') ? 'Female' : 'Male',
          lastGradeLevel: l.gradeLevel ?? l.section?.gradeLevel ?? 'GRADE_7',
          lastSection: l.sectionName ?? l.section?.name ?? l.advisoryName ?? '—',
          lastSchoolYear: currentSchoolYear,
          lastProgram: l.program ?? 'REGULAR',
          enrollmentStatus: smartStatus,
        });
        existingLrns.add(lrn);
      }

      // Source 2: SMART students lifecycle feed (catches transferred-out students
      // that may not appear in the learners feed)
      try {
        const smartStudents = await getSmartStudentsFeed();
        for (const s of smartStudents) {
          const lrn = String(s.lrn ?? '').trim();
          if (!lrn || existingLrns.has(lrn)) continue;

          const raw = String(s.eosyStatus ?? s.status ?? '').toUpperCase();
          const smartStatus = classifyEpStatus(raw);
          if (smartStatus !== 'TRANSFERRED' && smartStatus !== 'DROPPED' && smartStatus !== 'GRADUATED') continue;

          // gradeLevel from SMART feed is an object { id, name, displayOrder } — extract and map
          const epGradeName = typeof s.gradeLevel === 'object' && s.gradeLevel !== null
            ? s.gradeLevel.name
            : s.gradeLevel;
          const mappedGrade = mapGradeLevel(epGradeName) ?? 'GRADE_7';
          students.push({
            id: `ep-${lrn}`,
            enrollmentId: `ep-${lrn}`,
            lrn,
            firstName: s.firstName ?? '',
            middleName: s.middleName ?? null,
            lastName: s.lastName ?? '',
            suffix: s.suffix ?? null,
            gender: String(s.sex ?? '').toUpperCase().startsWith('F') ? 'Female' : 'Male',
            lastGradeLevel: mappedGrade,
            lastSection: s.sectionName ?? s.section?.name ?? '—',
            lastSchoolYear: s.schoolYear?.yearLabel ?? currentSchoolYear,
            lastProgram: s.section?.programType ?? 'REGULAR',
            enrollmentStatus: smartStatus,
          });
          existingLrns.add(lrn);
        }
      } catch (lifecycleErr: any) {
        logger.warn(`[Alumni] Lifecycle feed fallback failed (non-fatal): ${lifecycleErr.message}`);
      }

      // Source 3: Unscoped learners feed (no school year filter — catches inactive students
      // that may not appear in the scoped learners feed or the SMART lifecycle feed)
      try {
        const unscopedLearners = await getAllIntegrationV1Learners(null);
        for (const record of unscopedLearners) {
          const l = record.learner ?? record;
          const lrn = String(l.lrn ?? '').trim();
          if (!lrn || existingLrns.has(lrn)) continue;

          const raw = String(record.status ?? l.status ?? record.enrollment?.status ?? '');
          const smartStatus = classifyEpStatus(raw);
          if (smartStatus !== 'TRANSFERRED' && smartStatus !== 'DROPPED' && smartStatus !== 'GRADUATED') continue;

          const epGradeName = typeof l.gradeLevel === 'object' && l.gradeLevel !== null
            ? l.gradeLevel.name
            : (l.gradeLevel ?? record.gradeLevel?.name);
          const mappedGrade = mapGradeLevel(epGradeName) ?? 'GRADE_7';
          students.push({
            id: `ep-${lrn}`,
            enrollmentId: `ep-${lrn}`,
            lrn,
            firstName: l.firstName ?? '',
            middleName: l.middleName ?? null,
            lastName: l.lastName ?? '',
            suffix: l.suffix ?? null,
            gender: String(l.sex ?? '').toUpperCase().startsWith('F') ? 'Female' : 'Male',
            lastGradeLevel: mappedGrade,
            lastSection: l.sectionName ?? l.section?.name ?? record.section?.name ?? '—',
            lastSchoolYear: record.schoolYear?.yearLabel ?? currentSchoolYear,
            lastProgram: record.section?.programType ?? 'REGULAR',
            enrollmentStatus: smartStatus,
          });
          existingLrns.add(lrn);
        }
      } catch (unscopedErr: any) {
        logger.warn(`[Alumni] Unscoped learners feed failed (non-fatal): ${unscopedErr.message}`);
      }
    } catch (err: any) {
      logger.warn(`[Alumni] EnrollPro fallback fetch failed (non-fatal): ${err.message}`);
    }

    logger.info(`[Alumni] After EnrollPro merge: ${students.length} total students, statuses: ${JSON.stringify(students.reduce((acc: Record<string, number>, s: any) => { acc[s.enrollmentStatus] = (acc[s.enrollmentStatus] || 0) + 1; return acc; }, {}))}`);

    // Filter by search
    if (search) {
      const searchLower = (search as string).toLowerCase();
      students = students.filter((s: any) => {
        const fullName = `${s.lastName} ${s.firstName} ${s.middleName || ""}`.toLowerCase();
        return fullName.includes(searchLower) || s.lrn.includes(searchLower);
      });
    }

    // Filter by grade level
    if (gradeLevel && gradeLevel !== 'all') {
      students = students.filter((s: any) => s.lastGradeLevel === gradeLevel);
    }

    // Filter by status (graduated = GRADUATED or ENROLLED in latest year, transferred = TRANSFERRED, GRADUATED = EP Graduated)
    if (status && status !== 'all') {
      if (status === 'graduated') {
        // Graduated = students whose last enrollment was GRADUATED or ENROLLED (meaning they completed the year)
        students = students.filter((s: any) => s.enrollmentStatus === 'GRADUATED' || s.enrollmentStatus === 'ENROLLED');
      } else if (status === 'GRADUATED') {
        // EP Graduated = students explicitly marked as GRADUATED from EnrollPro
        students = students.filter((s: any) => s.enrollmentStatus === 'GRADUATED');
      } else {
        students = students.filter((s: any) => s.enrollmentStatus === status);
      }
    }

    const total = students.length;
    students = students.slice(offset, offset + limit);

    res.json({ students, total });
  } catch (error) {
    logger.error("Error fetching alumni:", error);
    res.status(500).json({ message: "Failed to fetch alumni" });
  }
});

// Update enrollment status (DROPPED ↔ TRANSFERRED)
router.put("/enrollment/:enrollmentId/status", authenticateToken, validate(enrollmentStatusSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const enrollmentId = req.params.enrollmentId as string;
    const { status } = req.body;

    if (!['ENROLLED', 'DROPPED', 'TRANSFERRED'].includes(status)) {
      res.status(400).json({ message: "Invalid status. Must be ENROLLED, DROPPED, or TRANSFERRED" });
      return;
    }

    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) {
      res.status(404).json({ message: "Enrollment not found" });
      return;
    }

    const updated = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { status },
    });

    res.json({ enrollment: updated });
  } catch (error) {
    logger.error("Error updating enrollment status:", error);
    res.status(500).json({ message: "Failed to update enrollment status" });
  }
});

// Finalize grades for a section/term/subject (DRAFT → FINALIZED)
router.post("/finalize-grades", authenticateToken, validate(finalizeGradesSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { sectionId, term, subjectId } = req.body;

    const lockResult = await withSectionLock(`finalize-grades:${sectionId}:${term}:${subjectId}`, async () => {
      const schoolYearLabel = await getActiveSchoolYearLabel();

      // Find ALL class assignments for this section/subject/year (handles teacher changes)
      const classAssignments = await prisma.classAssignment.findMany({
        where: {
          sectionId,
          subjectId,
          schoolYear: schoolYearLabel,
        },
      });

      if (classAssignments.length === 0) {
        return { status: 404 as const, body: { message: "No class assignment found for this section/subject/year" } };
      }

      const caIds = classAssignments.map((ca) => ca.id);

      // Find all DRAFT grades across ALL class assignments for this section/subject/term
      const draftGrades = await prisma.grade.findMany({
        where: {
          classAssignmentId: { in: caIds },
          term: term as Term,
          status: "DRAFT",
        },
      });

      if (draftGrades.length === 0) {
        return { status: 200 as const, body: { message: "No draft grades to finalize", finalizedCount: 0 } };
      }

      // Finalize all draft grades across all matching class assignments
      const result = await prisma.grade.updateMany({
        where: {
          classAssignmentId: { in: caIds },
          term: term as Term,
          status: "DRAFT",
        },
        data: {
          status: "FINALIZED",
          finalizedBy: user.id,
          finalizedAt: new Date(),
        },
      });

      logger.info(`[Registrar] ${user.username} finalized ${result.count} grades for section ${sectionId}, ${term}, subject ${subjectId}`);

      return {
        status: 200 as const,
        body: {
          message: `Finalized ${result.count} grades`,
          finalizedCount: result.count,
          sectionId,
          term,
          subjectId,
        },
      };
    });

    res.status(lockResult.status).json(lockResult.body);
  } catch (error) {
    logger.error("Error finalizing grades:", error);
    res.status(500).json({ message: "Failed to finalize grades" });
  }
});

// Unfinalize grades (FINALIZED → DRAFT) — registrar can unlock
router.post("/unfinalize-grades", authenticateToken, validate(finalizeGradesSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { sectionId, term, subjectId } = req.body;

    const lockResult = await withSectionLock(`unfinalize-grades:${sectionId}:${term}:${subjectId}`, async () => {
      const schoolYearLabel = await getActiveSchoolYearLabel();

      const classAssignments = await prisma.classAssignment.findMany({
        where: {
          sectionId,
          subjectId,
          schoolYear: schoolYearLabel,
        },
      });

      if (classAssignments.length === 0) {
        return { status: 404 as const, body: { message: "No class assignment found for this section/subject/year" } };
      }

      const caIds = classAssignments.map((ca) => ca.id);

      const result = await prisma.grade.updateMany({
        where: {
          classAssignmentId: { in: caIds },
          term: term as Term,
          status: "FINALIZED",
        },
        data: {
          status: "DRAFT",
          finalizedBy: null,
          finalizedAt: null,
        },
      });

      logger.info(`[Registrar] ${user.username} unfinalized ${result.count} grades for section ${sectionId}, ${term}, subject ${subjectId}`);

      return {
        status: 200 as const,
        body: {
          message: `Unfinalized ${result.count} grades`,
          unfinalizedCount: result.count,
        },
      };
    });

    res.status(lockResult.status).json(lockResult.body);
  } catch (error) {
    logger.error("Error unfinalizing grades:", error);
    res.status(500).json({ message: "Failed to unfinalize grades" });
  }
});

// Get finalization status for a section/term
router.get("/finalize-status/:sectionId/:term", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const sectionId = req.params.sectionId as string;
    const term = req.params.term as string;

    // Get all class assignments for this section
    const schoolYearLabel = await getActiveSchoolYearLabel();
    const classAssignments = await prisma.classAssignment.findMany({
      where: {
        sectionId,
        schoolYear: schoolYearLabel,
      },
      include: {
        subject: true,
        grades: {
          where: { term: term as Term },
          select: { status: true },
        },
      },
    });

    const status = classAssignments.map((ca: any) => {
      const grades = ca.grades || [];
      const draftCount = grades.filter((g: any) => g.status === "DRAFT").length;
      const finalizedCount = grades.filter((g: any) => g.status === "FINALIZED").length;
      const lockedCount = grades.filter((g: any) => g.status === "LOCKED").length;

      return {
        subjectId: ca.subjectId,
        subjectName: ca.subject?.name || "",
        subjectCode: ca.subject?.code || "",
        total: grades.length,
        draft: draftCount,
        finalized: finalizedCount,
        locked: lockedCount,
        isComplete: draftCount === 0 && grades.length > 0,
      };
    });

    res.json({ sectionId, term, subjects: status });
  } catch (error) {
    logger.error("Error getting finalize status:", error);
    res.status(500).json({ message: "Failed to get finalize status" });
  }
});

// Get finalize status for ALL terms at once (T1, T2, T3) — used by EOSY page
// Groups rotational subjects (TLE, Science) into a single row
router.get("/finalize-status-all/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const sectionId = req.params.sectionId as string;
    const schoolYearLabel = await getActiveSchoolYearLabel();

    const classAssignments = await prisma.classAssignment.findMany({
      where: {
        sectionId,
        schoolYear: schoolYearLabel,
      },
      include: {
        subject: true,
        grades: {
          where: { term: { in: ['T1', 'T2', 'T3'] } },
          select: { status: true, term: true },
        },
      },
    });

    const terms = ['T1', 'T2', 'T3'] as const;

    // Helper: extract base subject name for grouping
    // "TLE Exploratory - Agriculture and Fishery Arts 7" → "TLE Exploratory 7"
    // "Science - Earth Science 7" → "Science 7"
    // "Filipino 7" → "Filipino 7"
    const getBaseName = (name: string): string => {
      const dashIdx = name.indexOf(' - ');
      if (dashIdx === -1) return name;
      const prefix = name.substring(0, dashIdx).trim();
      // Extract grade level suffix from the full name (e.g., " 7", " 8")
      const gradeMatch = name.match(/\s+(\d+)\s*$/);
      const gradeSuffix = gradeMatch ? ` ${gradeMatch[1]}` : '';
      return `${prefix}${gradeSuffix}`;
    };

    // Build per-classAssignment rows first
    const rows = classAssignments.map((ca: any) => {
      const allGrades = ca.grades || [];
      const termStatus: Record<string, { draft: number; finalized: number; locked: number; total: number; isComplete: boolean }> = {} as any;

      for (const t of terms) {
        const termGrades = allGrades.filter((g: any) => g.term === t);
        const draftCount = termGrades.filter((g: any) => g.status === "DRAFT").length;
        const finalizedCount = termGrades.filter((g: any) => g.status === "FINALIZED").length;
        const lockedCount = termGrades.filter((g: any) => g.status === "LOCKED").length;
        termStatus[t] = {
          draft: draftCount,
          finalized: finalizedCount,
          locked: lockedCount,
          total: termGrades.length,
          isComplete: draftCount === 0 && termGrades.length > 0,
        };
      }

      return {
        baseName: getBaseName(ca.subject?.name || ''),
        subjectId: ca.subjectId,
        subjectName: ca.subject?.name || '',
        subjectCode: ca.subject?.code || '',
        terms: termStatus,
      };
    });

    // Group by base name — rotational subjects (TLE, Science) have multiple components
    // but each student only has ONE grade per term across all components
    const grouped = new Map<string, {
      subjectName: string;
      subjectIds: string[];
      terms: Record<string, { draft: number; finalized: number; locked: number; total: number; isComplete: boolean }>;
    }>();

    for (const row of rows) {
      const existing = grouped.get(row.baseName);
      if (existing) {
        existing.subjectIds.push(row.subjectId);
        // For rotational subjects, each component only has grades in ONE term
        // Use MAX for all counts — students are shared across components, not duplicated
        for (const t of terms) {
          existing.terms[t].draft = Math.max(existing.terms[t].draft, row.terms[t].draft);
          existing.terms[t].finalized = Math.max(existing.terms[t].finalized, row.terms[t].finalized);
          existing.terms[t].locked = Math.max(existing.terms[t].locked, row.terms[t].locked);
          existing.terms[t].total = Math.max(existing.terms[t].total, row.terms[t].total);
          existing.terms[t].isComplete = existing.terms[t].draft === 0 && existing.terms[t].total > 0;
        }
      } else {
        grouped.set(row.baseName, {
          subjectName: row.baseName,
          subjectIds: [row.subjectId],
          terms: {
            T1: { ...row.terms.T1 },
            T2: { ...row.terms.T2 },
            T3: { ...row.terms.T3 },
          },
        });
      }
    }

    const status = Array.from(grouped.values()).map((g) => {
      const totalDraft = terms.reduce((sum, t) => sum + g.terms[t].draft, 0);
      const totalFinalized = terms.reduce((sum, t) => sum + g.terms[t].finalized, 0);
      const totalLocked = terms.reduce((sum, t) => sum + g.terms[t].locked, 0);
      const totalGrades = terms.reduce((sum, t) => sum + g.terms[t].total, 0);

      return {
        subjectId: g.subjectIds.length === 1 ? g.subjectIds[0] : g.subjectIds.join(','),
        subjectName: g.subjectName,
        subjectIds: g.subjectIds,
        terms: g.terms,
        totalDraft,
        totalFinalized,
        totalLocked,
        totalGrades,
        isComplete: totalDraft === 0 && totalGrades > 0,
      };
    });

    res.json({ sectionId, subjects: status });
  } catch (error) {
    logger.error("Error getting all-term finalize status:", error);
    res.status(500).json({ message: "Failed to get finalize status" });
  }
});

// Get per-student grades for a section/term (read-only, for registrar EOSY view)
router.get("/student-grades/:sectionId/:term", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const sectionId = req.params.sectionId as string;
    const term = req.params.term as Term | "FINAL";
    const isFinal = term === "FINAL";

    if (!["T1", "T2", "T3", "FINAL"].includes(term)) {
      res.status(400).json({ message: "Invalid term. Must be T1, T2, T3, or FINAL." });
      return;
    }

    const schoolYearLabel = await getActiveSchoolYearLabel();

    // Get all enrollments for this section
    const enrollments = await prisma.enrollment.findMany({
      where: {
        sectionId,
        schoolYear: schoolYearLabel,
        status: "ENROLLED",
      },
      include: {
        student: true,
      },
      orderBy: {
        student: { lastName: "asc" },
      },
    });

    if (enrollments.length === 0) {
      res.json({ sectionId, term, students: [] });
      return;
    }

    const studentIds = enrollments.map((e) => e.studentId);

    // For FINAL: fetch all terms so we can average; otherwise single term
    const gradeWhereClause = isFinal
      ? { studentId: { in: studentIds }, term: { in: ["T1", "T2", "T3"] as Term[] } }
      : { studentId: { in: studentIds }, term };

    // Get all class assignments for this section/year with grades for the term(s)
    // (schoolYear only — year-scoped historical view, must survive rollover archiving)
    const classAssignments = await prisma.classAssignment.findMany({
      where: {
        sectionId,
        schoolYear: schoolYearLabel,
      },
      include: {
        subject: true,
        grades: {
          where: gradeWhereClause,
          select: {
            studentId: true,
            term: true,
            quarterlyGrade: true,
            status: true,
            initialGrade: true,
            writtenWorkPS: true,
            perfTaskPS: true,
            quarterlyAssessPS: true,
          },
        },
      },
      orderBy: {
        subject: { name: "asc" },
      },
    });

    // Build per-student grade map
    const students = enrollments.map((enrollment) => {
      // Deduplicate by subjectId — keep the one with a grade if duplicates exist
      const subjectGradeMap = new Map<string, any>();
      for (const ca of classAssignments) {
        if (isFinal) {
          // FINAL mode: average all term grades for this subject+student
          const studentGrades = ca.grades.filter((g) => g.studentId === enrollment.studentId);
          if (studentGrades.length > 0) {
            const gradesWithValues = studentGrades.filter((g) => g.quarterlyGrade !== null);
            const avgGrade = gradesWithValues.length > 0
              ? Math.round(gradesWithValues.reduce((sum, g) => sum + (g.quarterlyGrade as number), 0) / gradesWithValues.length)
              : null;
            const latestStatus = gradesWithValues.length > 0
              ? gradesWithValues[gradesWithValues.length - 1].status
              : studentGrades[0]?.status ?? "NO_GRADE";
            const latestGrade = gradesWithValues.length > 0 ? gradesWithValues[gradesWithValues.length - 1] : studentGrades[0];
            const existing = subjectGradeMap.get(ca.subjectId);
            if (!existing || (avgGrade !== null && (existing.quarterlyGrade === null || avgGrade !== null))) {
              subjectGradeMap.set(ca.subjectId, {
                subjectId: ca.subjectId,
                subjectName: ca.subject.name,
                subjectCode: ca.subject.code,
                quarterlyGrade: avgGrade,
                initialGrade: latestGrade?.initialGrade ?? null,
                writtenWorkPS: latestGrade?.writtenWorkPS ?? null,
                perfTaskPS: latestGrade?.perfTaskPS ?? null,
                quarterlyAssessPS: latestGrade?.quarterlyAssessPS ?? null,
                status: latestStatus,
                rotationTermGroupId: (ca.subject as any).rotationTermGroupId ?? null,
                rotationTermRank: (ca.subject as any).rotationTermRank ?? null,
                rotationOutputLabel: (ca.subject as any).rotationOutputLabel ?? null,
              });
            }
          }
        } else {
          // Single-term mode
          const grade = ca.grades.find((g) => g.studentId === enrollment.studentId);
          const existing = subjectGradeMap.get(ca.subjectId);
          if (!existing || (grade && !existing.grade)) {
            subjectGradeMap.set(ca.subjectId, { ca, grade });
          }
        }
      }

      let rawSubjectGrades: any[];
      if (isFinal) {
        rawSubjectGrades = Array.from(subjectGradeMap.values());
      } else {
        rawSubjectGrades = Array.from(subjectGradeMap.values()).map(({ ca, grade }) => ({
          subjectId: ca.subjectId,
          subjectName: ca.subject.name,
          subjectCode: ca.subject.code,
          quarterlyGrade: grade?.quarterlyGrade ?? null,
          initialGrade: grade?.initialGrade ?? null,
          writtenWorkPS: grade?.writtenWorkPS ?? null,
          perfTaskPS: grade?.perfTaskPS ?? null,
          quarterlyAssessPS: grade?.quarterlyAssessPS ?? null,
          status: grade?.status ?? "NO_GRADE",
          rotationTermGroupId: (ca.subject as any).rotationTermGroupId ?? null,
          rotationTermRank: (ca.subject as any).rotationTermRank ?? null,
          rotationOutputLabel: (ca.subject as any).rotationOutputLabel ?? null,
        }));
      }

      // Merge rotation sub-subjects (e.g. Science-Biology, Science-Chemistry, Science-EarthScience)
      // into a single "Science" row
      const rotationGroups: Record<string, typeof rawSubjectGrades> = {};
      const standaloneRows: typeof rawSubjectGrades = [];

      for (const row of rawSubjectGrades) {
        if (row.rotationTermGroupId) {
          if (!rotationGroups[row.rotationTermGroupId]) {
            rotationGroups[row.rotationTermGroupId] = [];
          }
          rotationGroups[row.rotationTermGroupId].push(row);
        } else {
          standaloneRows.push(row);
        }
      }

      const mergedRotationRows: typeof rawSubjectGrades = [];
      for (const [, groupRows] of Object.entries(rotationGroups)) {
        const sorted = [...groupRows].sort((a, b) => (a.rotationTermRank ?? 0) - (b.rotationTermRank ?? 0));

        let bestSub: typeof sorted[0];
        let mergedGrade: number | null;

        if (isFinal) {
          // FINAL: average all sub-subject grades across the rotation group
          const gradesWithValues = sorted.filter((s) => s.quarterlyGrade !== null);
          mergedGrade = gradesWithValues.length > 0
            ? Math.round(gradesWithValues.reduce((sum, s) => sum + (s.quarterlyGrade as number), 0) / gradesWithValues.length)
            : null;
          bestSub = sorted.find((s) => s.quarterlyGrade !== null) || sorted[0];
        } else {
          // Single term: use the current term's grade
          const termRank = parseInt(term.replace("T", ""), 10);
          const currentTermSub = sorted.find((s) => s.rotationTermRank === termRank);
          const fallbackSub = sorted.find((s) => s.quarterlyGrade !== null);
          bestSub = currentTermSub || fallbackSub || sorted[0];
          mergedGrade = bestSub.quarterlyGrade;
        }

        mergedRotationRows.push({
          subjectId: bestSub.subjectId,
          subjectName: bestSub.rotationOutputLabel
            ? bestSub.rotationOutputLabel.charAt(0) + bestSub.rotationOutputLabel.slice(1).toLowerCase()
            : bestSub.subjectName,
          subjectCode: bestSub.rotationOutputLabel ?? bestSub.subjectCode,
          quarterlyGrade: mergedGrade,
          initialGrade: bestSub.initialGrade,
          writtenWorkPS: bestSub.writtenWorkPS,
          perfTaskPS: bestSub.perfTaskPS,
          quarterlyAssessPS: bestSub.quarterlyAssessPS,
          status: bestSub.status,
          rotationTermGroupId: bestSub.rotationTermGroupId,
          rotationTermRank: null,
          rotationOutputLabel: bestSub.rotationOutputLabel,
        });
      }

      const subjectGrades = [...standaloneRows, ...mergedRotationRows].sort((a, b) =>
        a.subjectName.localeCompare(b.subjectName)
      );

      // Calculate average from available term/final grades
      const gradedSubjects = subjectGrades.filter(
        (sg) => sg.quarterlyGrade !== null && sg.quarterlyGrade !== undefined
      );
      const average =
        gradedSubjects.length > 0
          ? Math.round(
              gradedSubjects.reduce((sum, sg) => sum + (sg.quarterlyGrade as number), 0) /
                gradedSubjects.length
            )
          : null;

      return {
        studentId: enrollment.studentId,
        firstName: enrollment.student.firstName,
        lastName: enrollment.student.lastName,
        middleName: enrollment.student.middleName,
        lrn: enrollment.student.lrn,
        subjects: subjectGrades,
        average,
        totalSubjects: subjectGrades.length,
        gradedSubjects: gradedSubjects.length,
      };
    });

    res.json({ sectionId, term, students });
  } catch (error) {
    logger.error("Error getting student grades:", error);
    res.status(500).json({ message: "Failed to get student grades" });
  }
});

// Get single student details
router.get("/student/:studentId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const studentId = req.params.studentId as string;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        enrollments: {
          include: {
            section: true
          },
          orderBy: { schoolYear: 'desc' }
        }
      }
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    res.json({ student });
  } catch (error) {
    logger.error("Error fetching student:", error);
    res.status(500).json({ message: "Failed to fetch student" });
  }
});

// Get sections list — also tries to include EnrollPro numeric IDs for roster viewer
router.get("/sections", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { schoolYear, gradeLevel } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    const whereClause: any = { schoolYear: currentSchoolYear };
    if (gradeLevel && gradeLevel !== "all") {
      whereClause.gradeLevel = gradeLevel;
    }

    const sections = await prisma.section.findMany({
      where: whereClause,
      include: {
        adviser: {
          include: { user: true }
        },
        _count: {
          select: { 
            enrollments: {
              where: { status: "ENROLLED" }
            }
          }
        }
      },
      orderBy: [
        { gradeLevel: 'asc' },
        { name: 'asc' }
      ]
    });

    // Also fetch EnrollPro sections to map their numeric IDs (needed for roster viewer)
    const epSectionNameToId = new Map<string, number>();
    try {
      const resolvedSY = await resolveEnrollProSchoolYear(currentSchoolYear);
      const epSections = await getAllIntegrationV1Sections(resolvedSY.id);
      for (const ep of epSections) {
        if (ep.name && ep.id) {
          epSectionNameToId.set(String(ep.name), Number(ep.id));
        }
      }
    } catch {
      // EnrollPro unreachable — roster viewer will show error when it tries
    }

    res.json(sections.map(s => ({
      id: s.id,
      name: s.name,
      gradeLevel: s.gradeLevel,
      schoolYear: s.schoolYear,
      program: s.program,
      adviser: s.adviser
        ? `${s.adviser.user.firstName} ${s.adviser.user.lastName}`
        : null,
      _count: s._count,
      enrollProId: epSectionNameToId.get(s.name) ?? null, // numeric EnrollPro section ID for roster
    })));
  } catch (error) {
    logger.error("Error fetching sections:", error);
    res.status(500).json({ message: "Failed to fetch sections" });
  }
});

// Section Roster — fetch learners for a section from EnrollPro
router.get("/section-roster/:enrollProId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const enrollProId = Number(req.params.enrollProId);
    if (!Number.isFinite(enrollProId) || enrollProId <= 0) {
      res.status(400).json({ message: "Invalid EnrollPro section ID." });
      return;
    }

    const learners = await getEnrollProSectionRoster(enrollProId);
    res.json({
      section: { enrollProId },
      learners,
      total: learners.length,
    });
  } catch (error: any) {
    logger.error("[registrar/section-roster]", error.message);
    res.status(500).json({ message: error.message ?? "Failed to fetch roster from EnrollPro." });
  }
});

} // end registerMainRoutes

// ── Alumni classification predicate (testable pure function) ─────────────────
// Determines whether a student's latest enrollment qualifies them as alumni.
// Exported for unit testing; no behavior change to the route.
export interface EnrollmentRecord {
  studentId: string;
  promotionStatus: string | null;
  status: string;
  schoolYear: string;
}

export function isStudentAlumni(
  latestEnrollment: EnrollmentRecord,
  allEnrollments: EnrollmentRecord[],
  currentlyEnrolled: Set<string>,
  currentSchoolYear: string,
): boolean {
  // Currently enrolled students are never alumni
  if (latestEnrollment.schoolYear === currentSchoolYear && latestEnrollment.status === "ENROLLED") {
    return false;
  }
  // JHS completers are always alumni
  if (latestEnrollment.promotionStatus === "JHS_COMPLETER") return true;
  // PROMOTED/CONDITIONALLY_PROMOTED/RETAINED without current-year enrollment
  // are awaiting re-enrollment, not alumni — unless they have a terminal enrollment
  const ps = latestEnrollment.promotionStatus;
  const isContinuing = ps === "PROMOTED" || ps === "CONDITIONALLY_PROMOTED" || ps === "RETAINED";
  if (isContinuing) {
    const hasTerminal = allEnrollments.some(
      (e) =>
        e.studentId === latestEnrollment.studentId &&
        e.schoolYear > latestEnrollment.schoolYear &&
        (e.status === "TRANSFERRED" || e.status === "DROPPED"),
    );
    if (!hasTerminal) return false;
  }
  return true;
}
