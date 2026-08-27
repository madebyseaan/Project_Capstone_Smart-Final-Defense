import { Router, Request, Response } from "express";
import { GradeLevel, Term } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import templateService from "../services/templateService";
import * as XLSX from "xlsx";
import { triggerImmediateSync, getUnifiedSyncStatus } from "../lib/syncCoordinator";
import {
  getAllIntegrationV1Sections,
  getIntegrationV1LearnersPage,
  getIntegrationV1SectionLearners,
  getAllIntegrationV1SectionLearners,
  resolveEnrollProSchoolYear,
  getEnrollProApplications,
  getEnrollProBosyQueue,
  getEnrollProBosyExpectedQueue,
  getEnrollProRemedialPending,
  getEnrollProEosySections,
  getEnrollProEosySectionRecords,
  getEnrollProEosySF5,
  getEnrollProEosySF6,
} from "../lib/enrollproClient";

import { getAtlasTeachingLoadSummary, getAtlasSubjectStats } from "../lib/atlasSync";
import { getActiveSchoolYearLabel } from "../lib/schoolYearResolver";
import { logger } from "../lib/logger";
import { validate } from "../middleware/validate";
import { enrollmentStatusSchema, finalizeGradesSchema } from "../schemas/registrar";

const router = Router();

async function resolveCurrentSchoolYearLabel(): Promise<string> {
  return getActiveSchoolYearLabel();
}

function getSyncFreshness(lastSyncAtIso: string | null): {
  lastSyncedAt: string | null;
  minutesSinceLastSync: number | null;
  isStale: boolean;
  status: "fresh" | "stale" | "never";
} {
  if (!lastSyncAtIso) {
    return {
      lastSyncedAt: null,
      minutesSinceLastSync: null,
      isStale: true,
      status: "never",
    };
  }

  const minutesSinceLastSync = Math.floor((Date.now() - new Date(lastSyncAtIso).getTime()) / 60000);
  const isStale = minutesSinceLastSync > 10;

  return {
    lastSyncedAt: lastSyncAtIso,
    minutesSinceLastSync,
    isStale,
    status: isStale ? "stale" : "fresh",
  };
}

function normalizeGradeLevel(raw: string | null | undefined): GradeLevel | null {
  const value = String(raw ?? "").toLowerCase();
  if (value.includes("7")) return "GRADE_7";
  if (value.includes("8")) return "GRADE_8";
  if (value.includes("9")) return "GRADE_9";
  if (value.includes("10")) return "GRADE_10";
  return null;
}

function normalizeSex(raw: string | null | undefined): "male" | "female" | "unknown" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "male" || value === "m") return "male";
  if (value === "female" || value === "f") return "female";
  return "unknown";
}

/** Converts raw DB sex/gender ("MALE"/"FEMALE"/"M"/"F") to title-case for frontend display and official forms. */
function normalizeDisplaySex(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "MALE" || value === "M") return "Male";
  if (value === "FEMALE" || value === "F") return "Female";
  return "Unknown";
}

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

    res.json({
      currentSchoolYear,
      stats: {
        totalStudents,
        totalStudentsSource,
        localTotalStudents,
        totalSections,
        maleCount,
        femaleCount,
        gradeStats
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

function studentsByGrace(
  studentsByGrade: { sectionId: string; _count: number }[],
  sectionMap: Map<string, GradeLevel>,
  gradeStats: Record<string, number>
) {
  studentsByGrade.forEach(item => {
    const gradeLevel = sectionMap.get(item.sectionId);
    if (gradeLevel && gradeStats[gradeLevel] !== undefined) {
      gradeStats[gradeLevel] += item._count;
    }
  });
}

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

// Get alumni / graduated students (students no longer enrolled)
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
    let students = Array.from(studentMap.values())
      .filter((enr: any) => !currentlyEnrolled.has(enr.studentId))
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

    // Filter by status (graduated = DROPPED or TRANSFERRED in latest year, NLS = DROPPED, transferred = TRANSFERRED)
    if (status && status !== 'all') {
      if (status === 'graduated') {
        // Graduated = students whose last enrollment was ENROLLED (meaning they completed the year)
        students = students.filter((s: any) => s.enrollmentStatus === 'ENROLLED');
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

    // Find the class assignment for this section/term/subject
    const classAssignment = await prisma.classAssignment.findFirst({
      where: {
        sectionId,
        subjectId,
        schoolYear: await getActiveSchoolYearLabel(),
      },
    });

    if (!classAssignment) {
      res.status(404).json({ message: "No class assignment found for this section/subject/year" });
      return;
    }

    // Find all DRAFT grades for this class assignment and term
    const draftGrades = await prisma.grade.findMany({
      where: {
        classAssignmentId: classAssignment.id,
        term: term as Term,
        status: "DRAFT",
      },
    });

    if (draftGrades.length === 0) {
      res.status(200).json({ message: "No draft grades to finalize", finalizedCount: 0 });
      return;
    }

    // Finalize all draft grades
    const result = await prisma.grade.updateMany({
      where: {
        classAssignmentId: classAssignment.id,
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

    res.json({
      message: `Finalized ${result.count} grades`,
      finalizedCount: result.count,
      sectionId,
      term,
      subjectId,
    });
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

    const classAssignment = await prisma.classAssignment.findFirst({
      where: {
        sectionId,
        subjectId,
        schoolYear: await getActiveSchoolYearLabel(),
      },
    });

    if (!classAssignment) {
      res.status(404).json({ message: "No class assignment found for this section/subject/year" });
      return;
    }

    const result = await prisma.grade.updateMany({
      where: {
        classAssignmentId: classAssignment.id,
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

    res.json({
      message: `Unfinalized ${result.count} grades`,
      unfinalizedCount: result.count,
    });
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

// Get per-student grades for a section/term (read-only, for registrar EOSY view)
router.get("/student-grades/:sectionId/:term", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const sectionId = req.params.sectionId as string;
    const term = req.params.term as Term;

    if (!["T1", "T2", "T3"].includes(term)) {
      res.status(400).json({ message: "Invalid term. Must be T1, T2, or T3." });
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

    // Get all class assignments for this section/year with grades for the term
    const classAssignments = await prisma.classAssignment.findMany({
      where: {
        sectionId,
        schoolYear: schoolYearLabel,
        isActive: true,
      },
      include: {
        subject: true,
        grades: {
          where: {
            studentId: { in: studentIds },
            term,
          },
          select: {
            studentId: true,
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
        const grade = ca.grades.find((g) => g.studentId === enrollment.studentId);
        const existing = subjectGradeMap.get(ca.subjectId);
        if (!existing || (grade && !existing.grade)) {
          subjectGradeMap.set(ca.subjectId, { ca, grade });
        }
      }

      const rawSubjectGrades = Array.from(subjectGradeMap.values()).map(({ ca, grade }) => ({
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

      // Merge rotation sub-subjects (e.g. Science-Biology, Science-Chemistry, Science-EarthScience)
      // into a single "Science" row showing the current term's grade
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
        // Use the current term's grade from whichever sub-subject is assigned to this term
        const termRank = parseInt(term.replace("T", ""), 10);
        const currentTermSub = sorted.find((s) => s.rotationTermRank === termRank);
        // Fallback: use whichever sub-subject has a grade
        const fallbackSub = sorted.find((s) => s.quarterlyGrade !== null);
        const bestSub = currentTermSub || fallbackSub || sorted[0];

        mergedRotationRows.push({
          subjectId: bestSub.subjectId,
          subjectName: bestSub.rotationOutputLabel
            ? bestSub.rotationOutputLabel.charAt(0) + bestSub.rotationOutputLabel.slice(1).toLowerCase()
            : bestSub.subjectName,
          subjectCode: bestSub.rotationOutputLabel ?? bestSub.subjectCode,
          quarterlyGrade: bestSub.quarterlyGrade,
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

      // Calculate average from available quarterly grades
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

// Helper to check if a subject is Homeroom Guidance
function isHomeroomGuidanceSubjectCode(subjectCode?: string | null): boolean {
  return (subjectCode ?? '').toUpperCase().startsWith('HG');
}

function isSubjectAlignedWithGrade(subjectCode: string, gradeLevel: string): boolean {
  const gradeSuffix = gradeLevel.replace('GRADE_', '');
  const code = subjectCode.toUpperCase();
  const match = code.match(/\d+$/);
  if (match) {
    return match[0] === gradeSuffix;
  }
  return true;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function canonicalSubjectCode(subjectCode: string): string {
  const code = normalizeWhitespace(subjectCode).toUpperCase();
  const aliasMap: Record<string, string> = {
    TLE_AFA_EXP: 'TLE_AFA_EXP10',
    TLE_FCS_EXP: 'TLE_FCS_EXP10',
    TLE_ICT_EXP: 'TLE_ICT_EXP10',
  };
  return aliasMap[code] ?? code;
}

function toDisplayName(value: string): string {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function subjectCanonicalKey(subjectCode: string, subjectName: string): string {
  // Use canonical code so legacy aliases (e.g., TLE_AFA_EXP vs TLE_AFA_EXP10)
  // collapse into one learning area entry in SF forms.
  return canonicalSubjectCode(subjectCode);
}

/** Convert an ALL-CAPS label like "SCIENCE" or "TLE" to title case "Science" / "Tle". */
function toTitleCase(value: string): string {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

// Get SF9 (Report Card) data for a student
router.get("/forms/sf9/:studentId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const studentId = req.params.studentId as string;
    const { schoolYear } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    // Get student data
    const student = await prisma.student.findUnique({
      where: { id: studentId }
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    // Get active enrollment for school year — accepts any status (ENROLLED, DROPPED, TRANSFERRED)
    // This allows retrieving historical SF9s for students who have since left
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: studentId,
        schoolYear: currentSchoolYear,
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        section: {
          include: {
            adviser: {
              include: { user: true }
            }
          }
        }
      }
    });

    if (!enrollment) {
      res.status(404).json({ message: "Student not found for this school year" });
      return;
    }

    // Get current class assignments for this section/year.
    const classAssignments = await prisma.classAssignment.findMany({
      where: {
        sectionId: enrollment.sectionId,
        schoolYear: currentSchoolYear,
      },
      include: {
        subject: true,
        teacher: {
          include: { user: true }
        }
      }
    });

    // Get all grades for this student in this school year
    const grades = await prisma.grade.findMany({
      where: {
        studentId: studentId,
        classAssignment: {
          sectionId: enrollment.sectionId,
          schoolYear: currentSchoolYear,
        }
      },
      include: {
        classAssignment: {
          include: {
            subject: true,
            teacher: {
              include: { user: true }
            }
          }
        }
      }
    });

    const nonNullQuarterCountByAssignment = new Map<string, number>();
    grades.forEach((g: any) => {
      if (g.quarterlyGrade === null) return;
      nonNullQuarterCountByAssignment.set(
        g.classAssignmentId,
        (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) + 1,
      );
    });

    const gradePriority = (g: any): number => {
      const activeScore = g.classAssignment?.isActive ? 10_000 : 0;
      const densityScore = (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) * 100;
      const freshnessScore = new Date(g.updatedAt).getTime() / 1e12;
      return activeScore + densityScore + freshnessScore;
    };

    // Build canonical subject rows using learning-area identity (code+name), not subjectId,
    // so duplicate subject rows from sync do not appear as separate entries.
    // Each row now carries rotation metadata from the Subject model.
    const subjectGrades: Record<string, {
      subjectCode: string;
      subjectName: string;
      teacher: string;
      T1: number | null;
      T2: number | null;
      T3: number | null;
      finalGrade: number | null;
      // Atlas rotation fields — null = non-rotating subject
      rotationTermGroupId: string | null;
      rotationTermRank: number | null;
      rotationOutputLabel: string | null;
    }> = {};

    classAssignments.forEach((ca: any) => {
      if (isHomeroomGuidanceSubjectCode(ca.subject.code)) {
        return;
      }
      if (!isSubjectAlignedWithGrade(ca.subject.code, enrollment.section.gradeLevel)) {
        return;
      }
      const key = subjectCanonicalKey(ca.subject.code, ca.subject.name);
      if (!subjectGrades[key]) {
        subjectGrades[key] = {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          teacher: ca.teacher?.user
            ? `${toDisplayName(ca.teacher.user.firstName)} ${toDisplayName(ca.teacher.user.lastName)}`
            : "Unknown",
          T1: null,
          T2: null,
          T3: null,
          finalGrade: null,
          rotationTermGroupId: ca.subject.rotationTermGroupId ?? null,
          rotationTermRank: ca.subject.rotationTermRank ?? null,
          rotationOutputLabel: ca.subject.rotationOutputLabel ?? null,
        };
      }
    });

    // Populate with actual grade records, preferring higher-priority assignment sources.
    [...grades].sort((a: any, b: any) => gradePriority(b) - gradePriority(a)).forEach((grade: any) => {
      const subject = grade.classAssignment.subject;
      if (isHomeroomGuidanceSubjectCode(subject.code)) {
        return;
      }
      if (!isSubjectAlignedWithGrade(subject.code, enrollment.section.gradeLevel)) {
        return;
      }

      const key = subjectCanonicalKey(subject.code, subject.name);
      if (!subjectGrades[key]) {
        subjectGrades[key] = {
          subjectCode: subject.code,
          subjectName: subject.name,
          teacher: grade.classAssignment.teacher?.user
            ? `${toDisplayName(grade.classAssignment.teacher.user.firstName)} ${toDisplayName(grade.classAssignment.teacher.user.lastName)}`
            : "Unknown",
          T1: null,
          T2: null,
          T3: null,
          finalGrade: null,
          rotationTermGroupId: subject.rotationTermGroupId ?? null,
          rotationTermRank: subject.rotationTermRank ?? null,
          rotationOutputLabel: subject.rotationOutputLabel ?? null,
        };
      }

      if (grade.quarterlyGrade !== null && subjectGrades[key][grade.term as Term] === null) {
        subjectGrades[key][grade.term as Term] = grade.quarterlyGrade;
      }
    });

    // ---------------------------------------------------------------------------
    // Merge rotating sub-subjects into one row per rotation group.
    //
    // Example: SCI_BIO (rank=1), SCI_CHEM (rank=2), SCI_ES (rank=3) all belong to
    // rotationTermGroupId="SCIENCE". They collapse into one "Science" row where:
    //   T1 = Bio grade (from rank=1 sub-subject)
    //   T2 = Chem grade (from rank=2 sub-subject)
    //   T3 = Earth Sci grade (from rank=3 sub-subject)
    //   teacher = "Bio Teacher / Chem Teacher / EarthSci Teacher"
    // Non-rotating subjects (no rotationTermGroupId) pass through unchanged.
    // ---------------------------------------------------------------------------

    // Separate rotating vs. standalone rows
    const rotationGroups: Record<string, typeof subjectGrades[string][]> = {};
    const standaloneRows: (typeof subjectGrades[string])[] = [];

    for (const row of Object.values(subjectGrades)) {
      if (row.rotationTermGroupId) {
        if (!rotationGroups[row.rotationTermGroupId]) {
          rotationGroups[row.rotationTermGroupId] = [];
        }
        rotationGroups[row.rotationTermGroupId].push(row);
      } else {
        standaloneRows.push(row);
      }
    }

    // Build one merged row per rotation group
    const mergedRotationRows: (typeof subjectGrades[string])[] = [];
    for (const [, groupRows] of Object.entries(rotationGroups)) {
      // Sort sub-subjects by their rotation rank so teacher list is ordered
      const sorted = [...groupRows].sort((a, b) => (a.rotationTermRank ?? 0) - (b.rotationTermRank ?? 0));

      const merged: typeof subjectGrades[string] = {
        subjectCode: sorted[0].rotationOutputLabel ?? sorted[0].subjectCode,
        subjectName: toTitleCase(sorted[0].rotationOutputLabel ?? sorted[0].subjectName),
        teacher: sorted.map(r => r.teacher).filter(Boolean).join(' / '),
        T1: null,
        T2: null,
        T3: null,
        finalGrade: null,
        rotationTermGroupId: sorted[0].rotationTermGroupId,
        rotationTermRank: null, // merged row has no single rank
        rotationOutputLabel: sorted[0].rotationOutputLabel,
      };

      // Place each sub-subject's best available term grade into the correct column
      // using rotationTermRank (1→T1, 2→T2, 3→T3) — authoritative from Atlas
      for (const sub of sorted) {
        if (!sub.rotationTermRank) continue;
        const termKey = `T${sub.rotationTermRank}` as 'T1' | 'T2' | 'T3';
        // Pick the best non-null grade across all term slots for this sub-subject
        const bestGrade = sub.T1 ?? sub.T2 ?? sub.T3 ?? null;
        if (bestGrade !== null) {
          merged[termKey] = bestGrade;
        }
      }

      // Final grade = average of available term slots on the merged row
      const availableTerms = [merged.T1, merged.T2, merged.T3].filter((v): v is number => v !== null);
      if (availableTerms.length > 0) {
        merged.finalGrade = Math.round(availableTerms.reduce((a, b) => a + b, 0) / availableTerms.length);
      }

      mergedRotationRows.push(merged);
    }

    // Combine: standalone rows + merged rotation rows
    const allRows = [...standaloneRows, ...mergedRotationRows];

    // Calculate final grades for standalone (non-rotation) subjects
    standaloneRows.forEach((subject: any) => {
      const terms = [subject.T1, subject.T2, subject.T3].filter((q: number | null) => q !== null);
      if (terms.length > 0) {
        subject.finalGrade = Math.round(terms.reduce((a: number, b: number) => a + b, 0) / terms.length);
      }
    });

    // Calculate general average across all rows (standalone + merged)
    const allFinals = allRows.map((s: any) => s.finalGrade).filter((g: number | null) => g !== null);
    const generalAverage = allFinals.length > 0
      ? Math.round(allFinals.reduce((a: number, b: number) => a + b, 0) / allFinals.length)
      : null;

    // Calculate student age from birthDate
    let age = null;
    if (student.birthDate) {
      const today = new Date();
      const birth = new Date(student.birthDate);
      age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
    }

    // Use profile snapshot if available (historical), else current student data
    const snap = enrollment.profileSnapshot as Record<string, any> | null;

    res.json({
      student: {
        id: student.id,
        lrn: snap?.lrn ?? student.lrn,
        name: `${student.lastName}, ${student.firstName} ${student.middleName || ""} ${student.suffix || ""}`.trim(),
        gender: normalizeDisplaySex(snap?.gender ?? student.gender),
        birthDate: student.birthDate,
        age,
        section: enrollment.section.name,
        gradeLevel: enrollment.section.gradeLevel,
        schoolYear: enrollment.schoolYear,
        adviser: enrollment.section.adviser
          ? `${enrollment.section.adviser.user.firstName} ${enrollment.section.adviser.user.lastName}`
          : null
      },
      subjectGrades: allRows
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName))
        .map((s: any) => ({
          subjectCode: s.subjectCode,
          subjectName: s.subjectName,
          teacher: s.teacher,
          T1: s.T1,
          T2: s.T2,
          T3: s.T3,
          final: s.finalGrade,
          remarks: s.finalGrade ? (s.finalGrade >= 75 ? "Passed" : "Failed") : null
        })),
      attendance: {},
      values: [],
      generalAverage,
      honors: generalAverage ? (generalAverage >= 98 ? "With Highest Honors" : generalAverage >= 95 ? "With High Honors" : generalAverage >= 90 ? "With Honors" : null) : null,
      promotionStatus: generalAverage ? (allRows.every((s: any) => !s.finalGrade || s.finalGrade >= 75) ? "Promoted" : "Retained") : null
    });
  } catch (error) {
    logger.error("Error fetching SF9 data:", error);
    res.status(500).json({ message: "Failed to fetch SF9 data" });
  }
});

// Get SF1 (School Register) data from EnrollPro
router.get("/forms/sf1/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || (user.role !== "REGISTRAR" && user.role !== "ADMIN")) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    const rawSectionId = req.params.sectionId;
    const sectionId = Array.isArray(rawSectionId) ? rawSectionId[0] : rawSectionId;
    const { gradeLevel, schoolYear: querySY } = req.query;

    // Resolve school year
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "main" },
      select: { currentSchoolYear: true },
    });
    const schoolYear = (querySY as string) || await getActiveSchoolYearLabel();

    // Find the local section to get its name for EnrollPro lookup
    const localSection = await prisma.section.findUnique({ where: { id: sectionId } });
    if (!localSection) {
      res.status(404).json({ message: "Section not found" });
      return;
    }

    // Fetch EnrollPro school year ID
    let epSchoolYearId: number | null = null;
    try {
      const resolvedSY = await resolveEnrollProSchoolYear(schoolYear);
      epSchoolYearId = resolvedSY.id;
    } catch (err: any) {
      logger.warn(`[SF1] Could not resolve EnrollPro school year: ${err.message}`);
    }

    // Find the EnrollPro section ID by matching name
    let epSectionId: number | null = null;
    try {
      const epSections = await getAllIntegrationV1Sections(epSchoolYearId ?? undefined);
      const match = epSections.find((s: any) =>
        s.name?.toLowerCase() === localSection.name.toLowerCase()
      );
      if (match) epSectionId = Number(match.id);
    } catch (err: any) {
      logger.warn(`[SF1] Could not fetch EnrollPro sections: ${err.message}`);
    }

    // Fetch students from EnrollPro
    let students: any[] = [];
    if (epSectionId) {
      try {
        students = await getAllIntegrationV1SectionLearners(epSectionId);
      } catch (err: any) {
        logger.warn(`[SF1] EnrollPro learners fetch failed, falling back to local: ${err.message}`);
      }
    }

    // Fallback to local DB if EnrollPro fails
    if (students.length === 0) {
      const enrollments = await prisma.enrollment.findMany({
        where: { sectionId, schoolYear, status: "ENROLLED" },
        include: { student: true },
        orderBy: { student: { lastName: "asc" } },
      });
      students = enrollments.map((e) => {
        // Use profile snapshot if available (historical), else current student data
        const snap = e.profileSnapshot as Record<string, any> | null;
        return {
          learner: {
            lrn: snap?.lrn ?? e.student.lrn,
            firstName: snap?.firstName ?? e.student.firstName,
            middleName: snap?.middleName ?? e.student.middleName,
            lastName: snap?.lastName ?? e.student.lastName,
            suffix: snap?.suffix ?? e.student.suffix,
            birthDate: snap?.birthDate ?? e.student.birthDate,
            gender: snap?.gender ?? e.student.gender,
            address: snap?.address ?? e.student.address,
            guardianName: snap?.guardianName ?? e.student.guardianName,
            guardianContact: snap?.guardianContact ?? e.student.guardianContact,
          },
          status: "ENROLLED",
        };
      });
    }

    // Format students for SF1
    const formattedStudents = students
      .filter((s: any) => {
        const status = (s.status ?? "").toUpperCase();
        return status === "ENROLLED" || status === "OFFICIALLY_ENROLLED" || status === "SECTIONED";
      })
      .map((s: any, index: number) => {
        const learner = s.learner ?? s;
        return {
          index: index + 1,
          lrn: learner.lrn ?? "",
          lastName: learner.lastName ?? "",
          firstName: learner.firstName ?? "",
          middleName: learner.middleName ?? "",
          suffix: learner.suffix ?? "",
          birthDate: learner.birthDate ?? null,
          gender: learner.gender ?? "",
          address: learner.address ?? "",
          guardianName: learner.guardianName ?? "",
          guardianContact: learner.guardianContact ?? "",
        };
      })
      .sort((a: any, b: any) => a.lastName.localeCompare(b.lastName))
      .map((s: any, i: number) => ({ ...s, index: i + 1 }));

    res.json({
      section: {
        id: localSection.id,
        name: localSection.name,
        gradeLevel: localSection.gradeLevel,
        program: localSection.program,
        schoolYear,
      },
      source: epSectionId ? "enrollpro" : "local",
      students: formattedStudents,
    });
  } catch (error: any) {
    logger.error("Error fetching SF1 data:", error);
    res.status(500).json({ message: "Failed to fetch SF1 data" });
  }
});

// Get SF5 (Report on Promotion) data for a section
router.get("/forms/sf5/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const sectionId = req.params.sectionId as string;
    const { schoolYear } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    // Get section
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { adviser: { include: { user: true } } },
    });
    if (!section) {
      res.status(404).json({ message: "Section not found" });
      return;
    }

    // Get all enrollments
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId, schoolYear: currentSchoolYear, status: "ENROLLED" },
      include: { student: true },
    });

    // Get all class assignments for this section
    const classAssignments = await prisma.classAssignment.findMany({
      where: { sectionId, schoolYear: currentSchoolYear },
      include: { subject: true },
    });

    // Get all grades for this section
    const grades = await prisma.grade.findMany({
      where: {
        classAssignment: { sectionId, schoolYear: currentSchoolYear },
      },
      include: { classAssignment: { include: { subject: true } } },
    });

    // Get attendance summary for the school year
    const attendance = await prisma.attendance.groupBy({
      by: ["studentId", "status"],
      where: { sectionId },
      _count: { id: true },
    });

    // Build per-student results
    const students = enrollments.map((enr) => {
      const studentGrades = grades.filter((g) => g.studentId === enr.student.id);
      const studentAttendance = attendance.filter((a) => a.studentId === enr.student.id);

      // Compute per-subject final grades
      const subjectMap: Record<string, { finalGrade: number | null }> = {};
      for (const ca of classAssignments) {
        if (ca.subject.code.toUpperCase().startsWith("HG")) continue;
        const key = `${ca.subject.code}::${ca.subject.name}`.toUpperCase();
        if (!subjectMap[key]) subjectMap[key] = { finalGrade: null };
      }

      for (const grade of studentGrades) {
        const ca = grade.classAssignment;
        if (ca.subject.code.toUpperCase().startsWith("HG")) continue;
        const key = `${ca.subject.code}::${ca.subject.name}`.toUpperCase();
        if (!subjectMap[key]) subjectMap[key] = { finalGrade: null };

        if (grade.quarterlyGrade !== null && subjectMap[key].finalGrade === null) {
          // Use the first available term grade as a simple final
          subjectMap[key].finalGrade = grade.quarterlyGrade;
        }
      }

      // Compute final rating per subject (average of available terms per subject)
      const subjectFinals: number[] = [];
      const subjectDetails: Array<{ subjectCode: string; subjectName: string; finalGrade: number | null }> = [];

      for (const ca of classAssignments) {
        if (ca.subject.code.toUpperCase().startsWith("HG")) continue;
        const key = `${ca.subject.code}::${ca.subject.name}`.toUpperCase();

        // Get all term grades for this subject
        const termGrades = studentGrades
          .filter((g) => `${g.classAssignment.subject.code}::${g.classAssignment.subject.name}`.toUpperCase() === key && g.quarterlyGrade !== null)
          .map((g) => g.quarterlyGrade as number);

        const finalGrade = termGrades.length > 0
          ? Math.round(termGrades.reduce((a, b) => a + b, 0) / termGrades.length)
          : null;

        if (finalGrade !== null) subjectFinals.push(finalGrade);
        subjectDetails.push({ subjectCode: ca.subject.code, subjectName: ca.subject.name, finalGrade });
      }

      // General average
      const generalAverage = subjectFinals.length > 0
        ? Math.round(subjectFinals.reduce((a, b) => a + b, 0) / subjectFinals.length)
        : null;

      // Promotion status
      const hasFailing = subjectFinals.some((g) => g < 75);
      const hasGrades = subjectFinals.length > 0;
      const promotionStatus = !hasGrades ? "No Grades" : hasFailing ? "Retained" : "Promoted";

      // Attendance summary
      const present = studentAttendance.find((a) => a.status === "PRESENT")?._count.id ?? 0;
      const absent = studentAttendance.find((a) => a.status === "ABSENT")?._count.id ?? 0;
      const late = studentAttendance.find((a) => a.status === "LATE")?._count.id ?? 0;
      const excused = studentAttendance.find((a) => a.status === "EXCUSED")?._count.id ?? 0;

      // Use profile snapshot if available (historical), else current student data
      const snap = enr.profileSnapshot as Record<string, any> | null;

      return {
        lrn: snap?.lrn ?? enr.student.lrn,
        name: `${enr.student.lastName}, ${enr.student.firstName} ${enr.student.middleName || ""}`.trim(),
        gender: snap?.gender ?? enr.student.gender,
        subjectDetails,
        generalAverage,
        promotionStatus,
        attendance: { present, absent, late, excused, total: present + absent + late + excused },
      };
    });

    res.json({
      section: {
        id: section.id,
        name: section.name,
        gradeLevel: section.gradeLevel,
        program: section.program,
        schoolYear: currentSchoolYear,
        adviser: section.adviser ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}` : null,
      },
      students: students.sort((a, b) => a.name.localeCompare(b.name)),
      summary: {
        totalStudents: students.length,
        promoted: students.filter((s) => s.promotionStatus === "Promoted").length,
        retained: students.filter((s) => s.promotionStatus === "Retained").length,
        noGrades: students.filter((s) => s.promotionStatus === "No Grades").length,
      },
    });
  } catch (error) {
    logger.error("Error fetching SF5 data:", error);
    res.status(500).json({ message: "Failed to fetch SF5 data" });
  }
});

// Get SF6 (Summary Promotion Report) data — school-wide aggregate
router.get("/forms/sf6", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { schoolYear } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    // Get all sections for this school year
    const sections = await prisma.section.findMany({
      where: { schoolYear: currentSchoolYear },
      include: { adviser: { include: { user: true } } },
      orderBy: [{ gradeLevel: 'asc' }, { name: 'asc' }],
    });

    const gradeOrder = ['GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_10'];
    const sectionResults: any[] = [];
    const byGradeLevel: Record<string, { total: number; promoted: number; retained: number; dropped: number; transferred: number }> = {};

    for (const section of sections) {
      // Get enrollments
      const enrollments = await prisma.enrollment.findMany({
        where: { sectionId: section.id, schoolYear: currentSchoolYear },
        include: { student: true },
      });

      // Get class assignments
      const classAssignments = await prisma.classAssignment.findMany({
        where: { sectionId: section.id, schoolYear: currentSchoolYear },
        include: { subject: true },
      });

      // Get grades
      const grades = await prisma.grade.findMany({
        where: {
          classAssignment: { sectionId: section.id, schoolYear: currentSchoolYear },
        },
        include: { classAssignment: { include: { subject: true } } },
      });

      // Compute per-student promotion status
      let promoted = 0, retained = 0, dropped = 0, transferred = 0;

      for (const enr of enrollments) {
        if (enr.status === 'DROPPED') { dropped++; continue; }
        if (enr.status === 'TRANSFERRED') { transferred++; continue; }

        const studentGrades = grades.filter((g) => g.studentId === enr.studentId);
        const subjectFinals: number[] = [];

        for (const ca of classAssignments) {
          if (ca.subject.code.toUpperCase().startsWith("HG")) continue;
          const termGrades = studentGrades
            .filter((g) => g.classAssignmentId === ca.id && g.quarterlyGrade !== null)
            .map((g) => g.quarterlyGrade as number);
          if (termGrades.length > 0) {
            subjectFinals.push(Math.round(termGrades.reduce((a, b) => a + b, 0) / termGrades.length));
          }
        }

        const hasFailing = subjectFinals.some((g) => g < 75);
        const hasGrades = subjectFinals.length > 0;
        if (!hasGrades || hasFailing) { retained++; } else { promoted++; }
      }

      const total = enrollments.length;
      const promotionRate = total > 0 ? Math.round((promoted / total) * 100) : 0;

      sectionResults.push({
        sectionId: section.id,
        sectionName: section.name,
        gradeLevel: section.gradeLevel,
        program: section.program || 'REGULAR',
        adviser: section.adviser ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}` : null,
        totalStudents: total,
        promoted,
        retained,
        dropped,
        transferred,
        promotionRate,
      });

      // Aggregate by grade level
      const gl = section.gradeLevel;
      if (!byGradeLevel[gl]) byGradeLevel[gl] = { total: 0, promoted: 0, retained: 0, dropped: 0, transferred: 0 };
      byGradeLevel[gl].total += total;
      byGradeLevel[gl].promoted += promoted;
      byGradeLevel[gl].retained += retained;
      byGradeLevel[gl].dropped += dropped;
      byGradeLevel[gl].transferred += transferred;
    }

    // Sort section results by grade level then name
    sectionResults.sort((a, b) => {
      const gi = gradeOrder.indexOf(a.gradeLevel) - gradeOrder.indexOf(b.gradeLevel);
      return gi !== 0 ? gi : a.sectionName.localeCompare(b.sectionName);
    });

    // Overall summary
    const totalStudents = sectionResults.reduce((s, r) => s + r.totalStudents, 0);
    const totalPromoted = sectionResults.reduce((s, r) => s + r.promoted, 0);
    const totalRetained = sectionResults.reduce((s, r) => s + r.retained, 0);
    const totalDropped = sectionResults.reduce((s, r) => s + r.dropped, 0);
    const totalTransferred = sectionResults.reduce((s, r) => s + r.transferred, 0);

    res.json({
      schoolYear: currentSchoolYear,
      sections: sectionResults,
      summary: {
        totalStudents,
        promoted: totalPromoted,
        retained: totalRetained,
        dropped: totalDropped,
        transferred: totalTransferred,
        overallPromotionRate: totalStudents > 0 ? Math.round((totalPromoted / totalStudents) * 100) : 0,
      },
      byGradeLevel,
    });
  } catch (error) {
    logger.error("Error fetching SF6 data:", error);
    res.status(500).json({ message: "Failed to fetch SF6 data" });
  }
});

// Get SF10 (Permanent Record) data for a student
router.get("/forms/sf10/:studentId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const studentId = req.params.studentId as string;

    // Get student data with enrollments
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        enrollments: {
          include: {
            section: {
              include: {
                adviser: {
                  include: { user: true }
                }
              }
            }
          },
          orderBy: { schoolYear: 'asc' }
        }
      }
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    // Resolve one canonical enrollment per school year, prioritizing ENROLLED entries.
    const enrollmentBySchoolYear = new Map<string, any>();
    student.enrollments.forEach((enrollment: any) => {
      const existing = enrollmentBySchoolYear.get(enrollment.schoolYear);
      if (!existing) {
        enrollmentBySchoolYear.set(enrollment.schoolYear, enrollment);
        return;
      }

      const existingScore = existing.status === 'ENROLLED' ? 2 : 1;
      const incomingScore = enrollment.status === 'ENROLLED' ? 2 : 1;
      if (incomingScore > existingScore) {
        enrollmentBySchoolYear.set(enrollment.schoolYear, enrollment);
        return;
      }

      if (incomingScore === existingScore && enrollment.createdAt > existing.createdAt) {
        enrollmentBySchoolYear.set(enrollment.schoolYear, enrollment);
      }
    });

    const canonicalEnrollments = Array.from(enrollmentBySchoolYear.values());

    // Determine the student's CURRENT grade level from their latest enrollment
    const gradeOrder = ['GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_10'];
    // Sort canonicalEnrollments by school year desc to get the latest
    const sortedByYear = [...canonicalEnrollments].sort((a: any, b: any) => b.schoolYear.localeCompare(a.schoolYear));
    const currentEnrollment = sortedByYear[0];
    const currentGradeLevel = currentEnrollment?.section?.gradeLevel ?? 'GRADE_10';
    const currentGradeIdx = gradeOrder.indexOf(currentGradeLevel);
    const currentSchoolYear = currentEnrollment?.schoolYear ?? await getActiveSchoolYearLabel();

    // SF10 only shows grades up to the student's current grade level.
    // Grade 7 → 1 year, Grade 8 → 2 years, Grade 9 → 3 years, Grade 10 → 4 years.
    // Filter enrollments to only include those within the student's JHS range.
    const filteredCanonicalEnrollments = canonicalEnrollments.filter((e: any) => {
      const syStart = parseInt(e.schoolYear.split('-')[0]);
      const currentStart = parseInt(currentSchoolYear.split('-')[0]);
      const yearDiff = currentStart - syStart;
      // Only include years within the student's JHS range (0 = current, up to currentGradeIdx back)
      return yearDiff >= 0 && yearDiff <= currentGradeIdx;
    });

    // Build set of allowed school years for the grades loop
    const allowedSchoolYears = new Set(filteredCanonicalEnrollments.map((e: any) => e.schoolYear));

    // Get all section IDs from canonical enrollments
    const sectionIds = filteredCanonicalEnrollments.map((e: any) => e.sectionId);

    // Fetch all active class assignments for these sections
    const classAssignments = await prisma.classAssignment.findMany({
      where: {
        sectionId: { in: sectionIds },
      },
      include: {
        subject: true,
        teacher: {
          include: { user: true }
        }
      }
    });

    // Get all grades for this student across all school years
    let grades = await prisma.grade.findMany({
      where: { studentId: studentId },
      include: {
        classAssignment: {
          include: {
            subject: true,
            section: true,
            teacher: {
              include: { user: true }
            }
          }
        }
      }
    });

    // Fallback: if no Grade records found, try GradeSnapshot
    if (grades.length === 0) {
      const snapshots = await prisma.gradeSnapshot.findMany({
        where: { studentId: studentId },
        orderBy: { createdAt: "desc" }
      });

      if (snapshots.length > 0) {
        // Reconstruct grade-like objects from snapshots
        const snapshotGrades: any[] = [];
        for (const snap of snapshots) {
          const snapData = snap.snapshot as any;
          snapshotGrades.push({
            id: snap.id,
            studentId: snap.studentId,
            classAssignmentId: snap.classAssignmentId,
            term: snap.term,
            quarterlyGrade: snapData?.quarterlyGrade ?? null,
            writtenWorkPS: snapData?.writtenWorkPS ?? null,
            perfTaskPS: snapData?.perfTaskPS ?? null,
            quarterlyAssessPS: snapData?.quarterlyAssessPS ?? null,
            initialGrade: snapData?.initialGrade ?? null,
            classAssignment: {
              id: snap.classAssignmentId,
              subjectCode: snap.subjectCode,
              subjectName: snap.subjectName,
              sectionName: snap.sectionName,
              schoolYear: snap.schoolYear,
              isActive: false,
              subject: { code: snap.subjectCode, name: snap.subjectName },
              section: { name: snap.sectionName },
              teacher: null
            }
          });
        }
        grades = snapshotGrades;
      }
    }

    const nonNullQuarterCountByAssignment = new Map<string, number>();
    grades.forEach((g: any) => {
      if (g.quarterlyGrade === null) return;
      nonNullQuarterCountByAssignment.set(
        g.classAssignmentId,
        (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) + 1,
      );
    });

    const gradePriority = (g: any): number => {
      const activeScore = g.classAssignment?.isActive ? 10_000 : 0;
      const densityScore = (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) * 100;
      const freshnessScore = new Date(g.updatedAt).getTime() / 1e12;
      return activeScore + densityScore + freshnessScore;
    };

    // Organize by school year
    const academicHistory: Record<string, any> = {};
    
    filteredCanonicalEnrollments.forEach((enrollment: any) => {
      const sy = enrollment.schoolYear;
      if (!academicHistory[sy]) {
        academicHistory[sy] = {
          schoolYear: sy,
          gradeLevel: enrollment.section.gradeLevel,
          section: enrollment.section.name,
          program: enrollment.section.program ?? 'REGULAR',
          subjects: {}
        };
      }

      // Populate subjects based on class assignments for this enrollment's section
      const sectionAssignments = classAssignments.filter(
        (ca: any) => ca.sectionId === enrollment.sectionId && ca.schoolYear === sy
      );
      sectionAssignments.forEach((ca: any) => {
        if (isHomeroomGuidanceSubjectCode(ca.subject.code)) {
          return;
        }
        if (!isSubjectAlignedWithGrade(ca.subject.code, enrollment.section.gradeLevel)) {
          return;
        }

        const key = subjectCanonicalKey(ca.subject.code, ca.subject.name);
        if (!academicHistory[sy].subjects[key]) {
          academicHistory[sy].subjects[key] = {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          T1: null,
          T2: null,
          T3: null,
          finalGrade: null
        };
        }
      });
    });

    [...grades].sort((a: any, b: any) => gradePriority(b) - gradePriority(a)).forEach((grade: any) => {
      const sy = grade.classAssignment.schoolYear;
      // Skip grades for school years beyond the student's current grade level
      if (!allowedSchoolYears.has(sy)) return;

      if (!academicHistory[sy]) {
        academicHistory[sy] = {
          schoolYear: sy,
          gradeLevel: grade.classAssignment.section.gradeLevel,
          section: grade.classAssignment.section.name,
          program: grade.classAssignment.section.program ?? 'REGULAR',
          subjects: {}
        };
      }

      if (isHomeroomGuidanceSubjectCode(grade.classAssignment.subject.code)) {
        return;
      }
      if (!isSubjectAlignedWithGrade(grade.classAssignment.subject.code, grade.classAssignment.section.gradeLevel)) {
        return;
      }

      const key = subjectCanonicalKey(grade.classAssignment.subject.code, grade.classAssignment.subject.name);
      if (!academicHistory[sy].subjects[key]) {
        academicHistory[sy].subjects[key] = {
          subjectCode: grade.classAssignment.subject.code,
          subjectName: grade.classAssignment.subject.name,
          T1: null,
          T2: null,
          T3: null,
          finalGrade: null
        };
      }
      
      // Store term grade only if the slot is still empty (higher-priority rows run first).
      if (grade.term === 'T1' && academicHistory[sy].subjects[key].T1 === null) academicHistory[sy].subjects[key].T1 = grade.quarterlyGrade;
      if (grade.term === 'T2' && academicHistory[sy].subjects[key].T2 === null) academicHistory[sy].subjects[key].T2 = grade.quarterlyGrade;
      if (grade.term === 'T3' && academicHistory[sy].subjects[key].T3 === null) academicHistory[sy].subjects[key].T3 = grade.quarterlyGrade;
    });

    // Fetch school settings for SF10 metadata
    const schoolSettings = await (prisma as any).systemSettings.findUnique({
      where: { id: 'main' },
      select: { schoolName: true, schoolId: true, division: true, region: true }
    });

    // Calculate final grades for each school year
    const schoolRecords = Object.values(academicHistory).map((year: any) => {
      const subjectGrades = Object.values(year.subjects)
        .sort((a: any, b: any) => a.subjectName.localeCompare(b.subjectName))
        .map((subject: any) => {
        const terms = [subject.T1, subject.T2, subject.T3].filter((q: number | null) => q !== null);
        const finalGrade = terms.length > 0 
          ? Math.round(terms.reduce((a: number, b: number) => a + b, 0) / terms.length)
          : null;
        return {
          subjectCode: subject.subjectCode,
          subjectName: subject.subjectName,
          T1: subject.T1,
          T2: subject.T2,
          T3: subject.T3,
          final: finalGrade,
          remarks: finalGrade ? (finalGrade >= 75 ? "Passed" : "Failed") : null
        };
      });

      // Calculate general average
      const allFinals = subjectGrades.map((s: any) => s.final).filter((g: number | null) => g !== null) as number[];
      const generalAverage = allFinals.length > 0 
        ? Math.round(allFinals.reduce((a: number, b: number) => a + b, 0) / allFinals.length)
        : null;

      // Resolve adviser name from the enrollment's section
      const enrollment = filteredCanonicalEnrollments.find((e: any) => e.schoolYear === year.schoolYear);
      let adviserName: string | undefined;
      if (enrollment?.section?.adviser?.user) {
        adviserName = `${enrollment.section.adviser.user.firstName} ${enrollment.section.adviser.user.lastName}`;
      }

      // Include profile snapshot from enrollment for historical accuracy
      const enrollmentForYear = filteredCanonicalEnrollments.find((e: any) => e.schoolYear === year.schoolYear);
      const profileSnapshot = enrollmentForYear?.profileSnapshot ?? null;

      return {
        schoolYear: year.schoolYear,
        gradeLevel: year.gradeLevel,
        section: year.section,
        program: year.program,
        school: schoolSettings?.schoolName || '',
        schoolId: schoolSettings?.schoolId || '',
        district: schoolSettings?.division || '',
        division: schoolSettings?.division || '',
        region: schoolSettings?.region || '',
        adviserName,
        subjectGrades,
        generalAverage,
        honors: generalAverage ? (generalAverage >= 98 ? "With Highest Honors" : generalAverage >= 95 ? "With High Honors" : generalAverage >= 90 ? "With Honors" : null) : null,
        promotionStatus: generalAverage ? (subjectGrades.every((s: any) => !s.final || s.final >= 75) ? "Promoted" : "Retained") : null,
        remedialClasses: [],
        profileSnapshot,
      };
    });

    res.json({
      student: {
        id: student.id,
        lrn: student.lrn,
        name: `${student.lastName}, ${student.firstName} ${student.middleName || ""} ${student.suffix || ""}`.trim(),
        firstName: student.firstName,
        lastName: student.lastName,
        middleName: student.middleName || "",
        nameExtension: student.suffix || "",
        gender: normalizeDisplaySex(student.gender),
        birthDate: student.birthDate,
        address: student.address,
        guardianName: student.guardianName,
        guardianContact: student.guardianContact
      },
      schoolRecords: schoolRecords.sort((a, b) => a.schoolYear.localeCompare(b.schoolYear)),
      schoolSettings: {
        schoolName: schoolSettings?.schoolName || '',
        schoolId: schoolSettings?.schoolId || '',
        division: schoolSettings?.division || '',
        region: schoolSettings?.region || ''
      }
    });
  } catch (error) {
    logger.error("Error fetching SF10 data:", error);
    res.status(500).json({ message: "Failed to fetch SF10 data" });
  }
});

// Get SF8 (Class Record) data
router.get("/forms/sf8", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { schoolYear, sectionId } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    // Get all sections for school year
    const sections = await prisma.section.findMany({
      where: { schoolYear: currentSchoolYear },
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

    // If section is specified, get detailed class record
    if (sectionId && sectionId !== "all") {
      const section = sections.find(s => s.id === sectionId);
      if (!section) {
        res.status(404).json({ message: "Section not found" });
        return;
      }

      // Get all enrollments in this section
      const enrollments = await prisma.enrollment.findMany({
        where: {
          sectionId: sectionId as string,
          schoolYear: currentSchoolYear,
          status: "ENROLLED"
        },
        include: {
          student: true
        },
        orderBy: [
          { student: { lastName: 'asc' } },
          { student: { firstName: 'asc' } }
        ]
      });

      // Get all class assignments for this section
      const classAssignments = await prisma.classAssignment.findMany({
        where: {
          sectionId: sectionId as string,
          schoolYear: currentSchoolYear
        },
        include: {
          subject: true,
          teacher: {
            include: { user: true }
          }
        }
      });

      // Get all grades for students in this section
      const studentIds = enrollments.map(e => e.studentId);
      const grades = await prisma.grade.findMany({
        where: {
          studentId: { in: studentIds },
          classAssignment: {
            sectionId: sectionId as string,
            schoolYear: currentSchoolYear
          }
        }
      });

      // Organize data
      const students = enrollments.map(e => {
        const studentGrades: Record<string, any> = {};
        
        classAssignments.forEach(ca => {
          const subjectGrades = grades.filter(g => 
            g.studentId === e.studentId && g.classAssignmentId === ca.id
          );
          
          studentGrades[ca.subject.code] = {
            T1: subjectGrades.find(g => g.term === "T1")?.quarterlyGrade || null,
            T2: subjectGrades.find(g => g.term === "T2")?.quarterlyGrade || null,
            T3: subjectGrades.find(g => g.term === "T3")?.quarterlyGrade || null
          };
        });

        // Use profile snapshot if available (historical), else current student data
        const snap = e.profileSnapshot as Record<string, any> | null;

        return {
          id: e.student.id,
          lrn: snap?.lrn ?? e.student.lrn,
          firstName: snap?.firstName ?? e.student.firstName,
          middleName: snap?.middleName ?? e.student.middleName,
          lastName: snap?.lastName ?? e.student.lastName,
          gender: normalizeDisplaySex(snap?.gender ?? e.student.gender),
          grades: studentGrades
        };
      });

      const subjects = classAssignments.map(ca => ({
        code: ca.subject.code,
        name: ca.subject.name,
        teacher: `${ca.teacher.user.firstName} ${ca.teacher.user.lastName}`
      }));

      res.json({
        section: {
          id: section.id,
          name: section.name,
          gradeLevel: section.gradeLevel,
          program: section.program,
          schoolYear: currentSchoolYear,
          adviser: section.adviser 
            ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}`
            : null,
          studentCount: section._count.enrollments
        },
        subjects,
        students
      });
      return;
    }

    // Return list of sections if no specific section requested
    res.json({
      sections: sections.map(s => ({
        id: s.id,
        name: s.name,
        gradeLevel: s.gradeLevel,
        program: s.program,
        studentCount: s._count.enrollments,
        adviser: s.adviser 
          ? `${s.adviser.user.firstName} ${s.adviser.user.lastName}`
          : null
      })),
      schoolYear: currentSchoolYear
    });
  } catch (error) {
    logger.error("Error fetching SF8 data:", error);
    res.status(500).json({ message: "Failed to fetch SF8 data" });
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

// Export SF1 - School Register (Student Master List)
router.get("/export/sf1/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || (user.role !== "REGISTRAR" && user.role !== "ADMIN")) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    const rawSectionId = req.params.sectionId;
    const sectionId = Array.isArray(rawSectionId) ? rawSectionId[0] : rawSectionId;

    if (!sectionId) {
      res.status(400).json({ message: "Section ID is required" });
      return;
    }

    // Get section with enrolled students
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: {
        enrollments: {
          where: { status: "ENROLLED" },
          include: { 
            student: true 
          },
          orderBy: { 
            student: { lastName: "asc" } 
          }
        },
        adviser: {
          include: {
            user: true
          }
        }
      }
    }) as any;

    if (!section) {
      res.status(404).json({ message: "Section not found" });
      return;
    }

    // Fetch school settings
    const schoolSettings = await (prisma as any).systemSettings.findUnique({
      where: { id: 'main' },
      select: { schoolName: true, schoolId: true, division: true, region: true }
    });

    // Check if SF1 template exists
    const template = await (prisma as any).excelTemplate.findFirst({
      where: { formType: "SF1", isActive: true },
      orderBy: { updatedAt: "desc" }
    });

    let buffer: Buffer;

    if (template) {
      // USE TEMPLATE SYSTEM
      logger.info("Using SF1 template for school register export");

      const students = section.enrollments.map((enrollment: any, index: number) => ({
        INDEX: index + 1,
        LRN: enrollment.student.lrn,
        LAST_NAME: enrollment.student.lastName,
        FIRST_NAME: enrollment.student.firstName,
        MIDDLE_NAME: enrollment.student.middleName || "",
        SUFFIX: enrollment.student.suffix || "",
        BIRTH_DATE: enrollment.student.birthDate 
          ? new Date(enrollment.student.birthDate).toLocaleDateString('en-US') 
          : "",
        GENDER: normalizeDisplaySex(enrollment.student.gender),
        ADDRESS: enrollment.student.address || "",
        GUARDIAN_NAME: enrollment.student.guardianName || "",
        GUARDIAN_CONTACT: enrollment.student.guardianContact || "",
      }));

      const templateData = {
        SCHOOL_NAME: schoolSettings?.schoolName || '',
        SCHOOL_ID: schoolSettings?.schoolId || '',
        DIVISION: schoolSettings?.division || '',
        REGION: schoolSettings?.region || '',
        SECTION_NAME: section.name,
        GRADE_LEVEL: section.gradeLevel.replace("_", " "),
        SCHOOL_YEAR: section.schoolYear,
        ADVISER: section.adviser 
          ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}`
          : "Not Assigned",
        TOTAL_STUDENTS: students.length,
        STUDENTS: students,
        DATE_GENERATED: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      };

      buffer = await templateService.fillTemplate(template.filePath, templateData, {
        targetSheetName: template.sheetName || undefined,
        keepOnlyTargetSheet: Boolean(template.sheetName)
      });
    } else {
      // FALLBACK TO HARDCODED FORMAT
      logger.info("No SF1 template found, using hardcoded format");

      const worksheetData: any[] = [
        ["SCHOOL FORM 1 - SCHOOL REGISTER"],
        [],
        [`Section: ${section.name}`, `Grade Level: ${section.gradeLevel.replace("_", " ")}`],
        [`School Year: ${section.schoolYear}`, `Adviser: ${section.adviser ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}` : "Not Assigned"}`],
        [],
        ["No.", "LRN", "Last Name", "First Name", "Middle Name", "Suffix", "Birth Date", "Gender", "Address", "Guardian Name", "Guardian Contact"],
      ];

      section.enrollments.forEach((enrollment: any, index: number) => {
        const student = enrollment.student;
        worksheetData.push([
          index + 1,
          student.lrn,
          student.lastName,
          student.firstName,
          student.middleName || "",
          student.suffix || "",
          student.birthDate ? new Date(student.birthDate).toLocaleDateString('en-US') : "",
          normalizeDisplaySex(student.gender),
          student.address || "",
          student.guardianName || "",
          student.guardianContact || "",
        ]);
      });

      worksheetData.push([]);
      worksheetData.push([`Total Students: ${section.enrollments.length}`]);

      // Create workbook
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

      // Set column widths
      worksheet["!cols"] = [
        { wch: 5 },  // No
        { wch: 15 }, // LRN
        { wch: 15 }, // Last Name
        { wch: 15 }, // First Name
        { wch: 15 }, // Middle Name
        { wch: 8 },  // Suffix
        { wch: 12 }, // Birth Date
        { wch: 10 }, // Gender
        { wch: 30 }, // Address
        { wch: 20 }, // Guardian Name
        { wch: 15 }, // Guardian Contact
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, "School Register");

      buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    }

    // Set response headers
    res.setHeader("Content-Disposition", `attachment; filename="SF1_School_Register_${section.name}_${section.schoolYear}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    res.send(buffer);
  } catch (error: any) {
    logger.error("Error exporting SF1:", error);
    res.status(500).json({ message: "Failed to export school register" });
  }
});

// ============================================================
// Phase 1 – Applications, BOSY, Remedial, Section Roster
// ============================================================

// Simple in-memory cache for EnrollPro applications to prevent API timeouts during heavy filtering
interface ApplicationsCacheEntry {
  applications: any[];
  timestamp: number;
}
let applicationsCache: ApplicationsCacheEntry | null = null;
const CACHE_TTL_MS = 3 * 60 * 1000; // Cache for 3 minutes

// GET /registrar/applications — proxy EnrollPro applications
router.get("/applications", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const { status, gradeLevel, page, limit, search, forceRefresh } = req.query as Record<string, string>;
    logger.info("[registrar/applications] query params received:", { status, gradeLevel, page, limit, search, forceRefresh });

    const GRADE_LEVEL_MAP: Record<string, string> = {
      GRADE_7:  "Grade 7",
      GRADE_8:  "Grade 8",
      GRADE_9:  "Grade 9",
      GRADE_10: "Grade 10",
    };

    const sy = await resolveEnrollProSchoolYear();
    const now = Date.now();

    const isCacheExpired = !applicationsCache || (now - applicationsCache.timestamp > CACHE_TTL_MS);
    const shouldRefresh = isCacheExpired || forceRefresh === "true";

    if (shouldRefresh) {
      logger.info(`[registrar/applications] cache status: ${!applicationsCache ? "empty" : isCacheExpired ? "expired" : "forceRefresh requested"}. Re-fetching...`);
      const limitVal = 500;
      const firstPage = await getEnrollProApplications({
        schoolYearId: sy.id,
        page: 1,
        limit: limitVal,
      });

      const applications = firstPage.applications ?? firstPage.data ?? firstPage.items ?? [];
      const total = firstPage.total ?? firstPage.meta?.total ?? firstPage.pagination?.total ?? applications.length;
      let allApps = [...applications];

      const totalPages = Math.ceil(total / limitVal);
      logger.info(`[registrar/applications] total applications in EnrollPro: ${total}. Fetching ${totalPages} pages sequentially...`);
      
      for (let p = 2; p <= totalPages; p++) {
        try {
          const resData = await getEnrollProApplications({
            schoolYearId: sy.id,
            page: p,
            limit: limitVal,
          });
          const apps = resData.applications ?? resData.data ?? resData.items ?? [];
          allApps = allApps.concat(apps);
        } catch (fetchErr: any) {
          logger.error(`[registrar/applications] error fetching page ${p}, retrying once:`, fetchErr.message);
          await new Promise(r => setTimeout(r, 500));
          const resData = await getEnrollProApplications({
            schoolYearId: sy.id,
            page: p,
            limit: limitVal,
          });
          const apps = resData.applications ?? resData.data ?? resData.items ?? [];
          allApps = allApps.concat(apps);
        }
      }

      applicationsCache = {
        applications: allApps,
        timestamp: now,
      };
      logger.info(`[registrar/applications] cache populated successfully with ${allApps.length} applications`);
    } else {
      logger.info(`[registrar/applications] serving from in-memory cache (age: ${Math.round((now - applicationsCache!.timestamp) / 1000)}s)`);
    }

    let filteredApps = [...applicationsCache!.applications];

    // 1. Filter by status
    if (status && status !== "all") {
      filteredApps = filteredApps.filter((app: any) => {
        const appStatus = String(app.status ?? "PENDING").toUpperCase();
        return appStatus === status.toUpperCase();
      });
    }

    // 2. Filter by grade level
    if (gradeLevel && gradeLevel !== "all") {
      const displayName = (GRADE_LEVEL_MAP[gradeLevel] ?? gradeLevel).toLowerCase();
      filteredApps = filteredApps.filter((app: any) => {
        const glName = String(
          app.gradeLevel?.name ?? app.gradeLevelName ?? app.gradeLevel ?? ""
        ).toLowerCase();
        return glName.includes(displayName) || glName.includes(gradeLevel.toLowerCase());
      });
    }

    // 3. Filter by search (name or LRN)
    if (search && search.trim() !== "") {
      const searchLower = search.trim().toLowerCase();
      filteredApps = filteredApps.filter((app: any) => {
        const learner = app.learner ?? app;
        const firstName = String(learner.firstName ?? "").toLowerCase();
        const lastName = String(learner.lastName ?? "").toLowerCase();
        const middleName = String(learner.middleName ?? "").toLowerCase();
        const lrn = String(learner.lrn ?? "").toLowerCase();
        const fullName = `${lastName}, ${firstName} ${middleName}`.toLowerCase();
        return fullName.includes(searchLower) || lrn.includes(searchLower) || firstName.includes(searchLower) || lastName.includes(searchLower);
      });
    }

    // Paginate and slice
    const pageNum = page ? parseInt(page) : 1;
    const limitNum = limit ? parseInt(limit) : 50;
    const totalFiltered = filteredApps.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedApps = filteredApps.slice(startIndex, startIndex + limitNum);
    const totalPagesFiltered = Math.max(1, Math.ceil(totalFiltered / limitNum));

    const meta = {
      total: totalFiltered,
      page: pageNum,
      limit: limitNum,
      totalPages: totalPagesFiltered,
    };

    logger.info(`[registrar/applications] returning ${paginatedApps.length} of ${totalFiltered} filtered applications`);
    res.json({ applications: paginatedApps, meta });
  } catch (err: any) {
    logger.error("[registrar/applications] error:", err.message);
    res.status(502).json({ message: "Failed to fetch applications from EnrollPro" });
  }
});


// GET /registrar/bosy/queue — proxy EnrollPro BOSY pending-confirmation queue
router.get("/bosy/queue", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const { page, limit, search, gradeLevel } = req.query as Record<string, string>;
    const sy = await resolveEnrollProSchoolYear();
    const data = await getEnrollProBosyQueue({
      schoolYearId: sy.id,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      search: search || undefined,
      gradeLevel: gradeLevel || undefined,
    });

    // Hydrate with local sex/gender info if missing from EnrollPro
    if (data.items && Array.isArray(data.items)) {
      const lrns = data.items.map((i: any) => i.lrn).filter(Boolean);
      const students = await prisma.student.findMany({
        where: { lrn: { in: lrns } },
        select: { lrn: true, gender: true }
      });
      const lrnToSex = new Map(students.map(s => [s.lrn, s.gender]));
      data.items = data.items.map((item: any) => ({
        ...item,
        sex: item.sex ?? lrnToSex.get(item.lrn) ?? null
      }));
    }

    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/bosy/queue]", err.message);
    // Handle 404 or other network errors gracefully
    if (err.message?.includes("HTTP 404")) {
      return void res.json({ items: [], total: 0, page: 1, limit: 20, totalPages: 0, message: "Endpoint not yet implemented by EnrollPro" });
    }
    res.status(502).json({ message: "Failed to fetch BOSY queue from EnrollPro" });
  }
});

// GET /registrar/bosy/expected-queue — prior-year promoted not yet in current pipeline
router.get("/bosy/expected-queue", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const { priorSchoolYearId, page, limit, search, gradeLevel } = req.query as Record<string, string>;
    const sy = await resolveEnrollProSchoolYear();
    const priorSyId = priorSchoolYearId ? parseInt(priorSchoolYearId) : Math.max(1, sy.id - 1);
    const data = await getEnrollProBosyExpectedQueue({
      priorSchoolYearId: priorSyId,
      currentSchoolYearId: sy.id,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      search: search || undefined,
      gradeLevel: gradeLevel || undefined,
    });

    // Hydrate with local sex/gender info if missing from EnrollPro
    if (data.items && Array.isArray(data.items)) {
      const lrns = data.items.map((i: any) => i.lrn).filter(Boolean);
      const students = await prisma.student.findMany({
        where: { lrn: { in: lrns } },
        select: { lrn: true, gender: true }
      });
      const lrnToSex = new Map(students.map(s => [s.lrn, s.gender]));
      data.items = data.items.map((item: any) => ({
        ...item,
        sex: item.sex ?? lrnToSex.get(item.lrn) ?? null
      }));
    }

    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/bosy/expected-queue]", err.message);
    // Handle 404 or other network errors gracefully
    if (err.message?.includes("HTTP 404")) {
      return void res.json({ items: [], total: 0, page: 1, limit: 20, totalPages: 0, message: "Endpoint not yet implemented by EnrollPro" });
    }
    res.status(502).json({ message: "Failed to fetch BOSY expected queue from EnrollPro" });
  }
});

// GET /registrar/remedial/pending — proxy EnrollPro remedial pending list
router.get("/remedial/pending", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const { page, limit, search, gradeLevel } = req.query as Record<string, string>;
    const sy = await resolveEnrollProSchoolYear();
    const data = await getEnrollProRemedialPending({
      schoolYearId: sy.id,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      search: search || undefined,
      gradeLevel: gradeLevel || undefined,
    });
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/remedial/pending]", err.message);
    res.status(502).json({ message: "Failed to fetch remedial list from EnrollPro" });
  }
});

// GET /registrar/section-roster/:sectionId — learners in a section (integration v1 – no admin auth needed)
router.get("/section-roster/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || (user.role !== "REGISTRAR" && user.role !== "ADMIN")) { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const rawId = req.params.sectionId;
    const sectionId = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10);
    if (!sectionId || isNaN(sectionId)) { res.status(400).json({ message: "Invalid section ID" }); return; }
    const learners = await getAllIntegrationV1SectionLearners(sectionId);
    const first = await getIntegrationV1SectionLearners(sectionId, 1, 1);
    res.json({ section: first.section, learners, total: first.total });
  } catch (err: any) {
    logger.error("[registrar/section-roster]", err.message);
    res.status(502).json({ message: "Failed to fetch section roster from EnrollPro" });
  }
});

// ============================================================
// Phase 2 – EOSY
// ============================================================

// GET /registrar/eosy/school-years — list school years from EnrollPro
router.get("/eosy/school-years", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const { getEnrollProSchoolYears } = require("../lib/enrollproClient");
    const data = await getEnrollProSchoolYears();
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/school-years]", err.message);
    res.status(502).json({ message: "Failed to fetch school years from EnrollPro" });
  }
});

// GET /registrar/eosy/sections — sections available for EOSY
router.get("/eosy/sections", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    let schoolYearId = parseInt(String(req.query.schoolYearId), 10);
    if (isNaN(schoolYearId)) {
      const sy = await resolveEnrollProSchoolYear();
      schoolYearId = sy.id;
    }
    const data = await getEnrollProEosySections(schoolYearId);
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/sections]", err.message);
    res.status(502).json({ message: "Failed to fetch EOSY sections from EnrollPro" });
  }
});

// GET /registrar/eosy/sections/:sectionId/records — final grades for a section
router.get("/eosy/sections/:sectionId/records", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const sectionId = parseInt(String(req.params.sectionId), 10);
    if (isNaN(sectionId)) { res.status(400).json({ message: "Invalid section ID" }); return; }
    const data = await getEnrollProEosySectionRecords(sectionId);
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/records]", err.message);
    res.status(502).json({ message: "Failed to fetch EOSY records from EnrollPro" });
  }
});

// GET /registrar/eosy/sections/:sectionId/sf5 — SF5 export for a section
router.get("/eosy/sections/:sectionId/sf5", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const sectionId = parseInt(String(req.params.sectionId), 10);
    if (isNaN(sectionId)) { res.status(400).json({ message: "Invalid section ID" }); return; }
    const data = await getEnrollProEosySF5(sectionId);
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/sf5]", err.message);
    res.status(502).json({ message: "Failed to fetch SF5 from EnrollPro" });
  }
});

// GET /registrar/eosy/sf6 — SF6 school-wide EOSY summary
router.get("/eosy/sf6", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    let schoolYearId = parseInt(String(req.query.schoolYearId), 10);
    if (isNaN(schoolYearId)) {
      const sy = await resolveEnrollProSchoolYear();
      schoolYearId = sy.id;
    }
    const data = await getEnrollProEosySF6(schoolYearId);
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/sf6]", err.message);
    res.status(502).json({ message: "Failed to fetch SF6 from EnrollPro" });
  }
});

// ============================================================
// Phase 3 – ATLAS read-only proxies
// ============================================================

// GET /registrar/atlas/teaching-loads — faculty teaching load summary from ATLAS
// Falls back to SMART local DB (last synced ClassAssignments) when ATLAS is unreachable.
router.get("/atlas/teaching-loads", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const atlasSchoolYearId = req.query.atlasSchoolYearId
      ? parseInt(req.query.atlasSchoolYearId as string, 10)
      : undefined;
    const data = await getAtlasTeachingLoadSummary(atlasSchoolYearId);
    res.json(data);
  } catch (atlasErr: any) {
    logger.warn("[registrar/atlas/teaching-loads] ATLAS unavailable, falling back to local DB:", atlasErr.message);
    try {
      const currentSchoolYear = await resolveCurrentSchoolYearLabel();
      const assignments = await prisma.classAssignment.findMany({
        where: { schoolYear: currentSchoolYear, isActive: true },
        include: {
          teacher: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
          subject: { select: { id: true, code: true, name: true } },
          section: { select: { name: true, gradeLevel: true } },
        },
      });

      // Group assignments by teacher
      const byTeacher = new Map<string, any>();
      for (const ca of assignments) {
        const tid = ca.teacherId;
        if (!byTeacher.has(tid)) {
          byTeacher.set(tid, {
            facultyId: tid,
            firstName: ca.teacher.user.firstName ?? "",
            lastName: ca.teacher.user.lastName ?? "",
            email: ca.teacher.user.email ?? "",
            assignments: [],
            subjectCount: 0,
            totalMinutesPerWeek: 0,
            maxHoursPerWeek: 8,
          });
        }
        const entry = byTeacher.get(tid);
        entry.assignments.push({
          subject: { code: ca.subject.code, name: ca.subject.name },
          section: { name: ca.section.name, gradeLevel: ca.section.gradeLevel },
        });
        if (ca.teachingMinutes) entry.totalMinutesPerWeek += ca.teachingMinutes;
      }

      // Compute unique subject count per teacher
      for (const entry of byTeacher.values()) {
        const uniqueSubjects = new Set(entry.assignments.map((a: any) => a.subject.code));
        entry.subjectCount = uniqueSubjects.size;
      }

      res.json({
        faculty: Array.from(byTeacher.values()),
        source: "smart-local-db",
        warning: "ATLAS is currently unreachable. Showing last synced data from SMART local database.",
      });
    } catch (dbErr: any) {
      logger.error("[registrar/atlas/teaching-loads] Local DB fallback also failed:", dbErr.message);
      res.status(502).json({ message: "Failed to fetch teaching loads from ATLAS" });
    }
  }
});

// GET /registrar/atlas/subject-coverage — subjects stats (assigned vs unassigned)
// Falls back to SMART local DB when ATLAS is unreachable.
router.get("/atlas/subject-coverage", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const data = await getAtlasSubjectStats();
    res.json(data);
  } catch (atlasErr: any) {
    logger.warn("[registrar/atlas/subject-coverage] ATLAS unavailable, falling back to local DB:", atlasErr.message);
    try {
      const currentSchoolYear = await resolveCurrentSchoolYearLabel();
      // Subjects that have at least one active assignment this SY
      const assignedSubjectIds = await prisma.classAssignment.findMany({
        where: { schoolYear: currentSchoolYear, isActive: true },
        select: { subjectId: true },
        distinct: ["subjectId"],
      });
      const assignedIds = new Set(assignedSubjectIds.map((a: any) => a.subjectId));
      const allSubjects = await prisma.subject.findMany({ select: { id: true, code: true, name: true } });
      const unassigned = allSubjects.filter((s: any) => !assignedIds.has(s.id));
      res.json({
        count: allSubjects.length,
        unassignedCount: unassigned.length,
        unassigned,
        source: "smart-local-db",
        warning: "ATLAS is currently unreachable. Showing last synced data from SMART local database.",
      });
    } catch (dbErr: any) {
      logger.error("[registrar/atlas/subject-coverage] Local DB fallback also failed:", dbErr.message);
      res.status(502).json({ message: "Failed to fetch subject coverage from ATLAS" });
    }
  }
});

export default router;
