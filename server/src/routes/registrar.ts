import { Router, Request, Response } from "express";
import { GradeLevel, Quarter } from "@prisma/client";
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

const router = Router();

async function resolveCurrentSchoolYearLabel(): Promise<string> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "main" },
    select: { currentSchoolYear: true },
  });
  return settings?.currentSchoolYear ?? process.env.ENROLLPRO_SCHOOL_YEAR_LABEL ?? "2026-2027";
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
        studentCount: Number(section?.enrolledCount ?? 0),
        adviser: section?.advisingTeacher
          ? (
              `${String(section.advisingTeacher.firstName ?? '')} ${String(section.advisingTeacher.lastName ?? '')}`.trim() ||
              String(section.advisingTeacher.name ?? '').trim() ||
              null
            )
          : null,
      }));

      console.log(`[RegistrarDashboard] EnrollPro: ${totalStudents} students, ${totalSections} sections (all pages fetched)`);

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
        console.warn("[RegistrarDashboard] Gender count fallback to local DB:", (genderErr as Error).message);
      }
    } catch (error) {
      console.warn("[RegistrarDashboard] Falling back to SMART DB metrics:", (error as Error).message);
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
    console.error("Error fetching registrar dashboard:", error);
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
    console.error("Error fetching registrar sync status:", error);
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
    console.error("Error triggering registrar sync:", error);
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
      console.warn("[RegistrarSchoolYears] Failed to resolve active EnrollPro school year:", (error as Error).message);
    }

    res.json({
      schoolYears: Array.from(allYears).sort().reverse()
    });
  } catch (error) {
    console.error("Error fetching school years:", error);
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
      console.log(`[RegistrarStudents] Data is stale (${syncFreshness.minutesSinceLastSync}m), triggering background sync...`);
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
        gradeLevel: true
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
    console.error("Error fetching students:", error);
    res.status(500).json({ message: "Failed to fetch students" });
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
    console.error("Error fetching student:", error);
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

    // Get active enrollment for school year.
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: studentId,
        schoolYear: currentSchoolYear,
        status: 'ENROLLED',
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
      res.status(404).json({ message: "Student not enrolled for this school year" });
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
          isActive: true,
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
    const subjectGrades: Record<string, {
      subjectCode: string;
      subjectName: string;
      teacher: string;
      Q1: number | null;
      Q2: number | null;
      Q3: number | null;
      Q4: number | null;
      finalGrade: number | null;
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
        Q1: null,
        Q2: null,
        Q3: null,
        Q4: null,
        finalGrade: null
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
          Q1: null,
          Q2: null,
          Q3: null,
          Q4: null,
          finalGrade: null,
        };
      }

      if (grade.quarterlyGrade !== null && subjectGrades[key][grade.quarter as Quarter] === null) {
        subjectGrades[key][grade.quarter as Quarter] = grade.quarterlyGrade;
      }
    });

    // Calculate final grades
    Object.values(subjectGrades).forEach((subject: any) => {
      const quarters = [subject.Q1, subject.Q2, subject.Q3, subject.Q4].filter((q: number | null) => q !== null);
      if (quarters.length > 0) {
        subject.finalGrade = Math.round(quarters.reduce((a: number, b: number) => a + b, 0) / quarters.length);
      }
    });

    // Calculate general average
    const allFinals = Object.values(subjectGrades).map((s: any) => s.finalGrade).filter((g: number | null) => g !== null);
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

    res.json({
      student: {
        id: student.id,
        lrn: student.lrn,
        name: `${student.lastName}, ${student.firstName} ${student.middleName || ""} ${student.suffix || ""}`.trim(),
        gender: normalizeDisplaySex(student.gender),
        birthDate: student.birthDate,
        age,
        section: enrollment.section.name,
        gradeLevel: enrollment.section.gradeLevel,
        schoolYear: enrollment.schoolYear,
        adviser: enrollment.section.adviser 
          ? `${enrollment.section.adviser.user.firstName} ${enrollment.section.adviser.user.lastName}`
          : null
      },
      subjectGrades: Object.values(subjectGrades)
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName))
        .map((s: any) => ({
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        Q1: s.Q1,
        Q2: s.Q2,
        Q3: s.Q3,
        Q4: s.Q4,
        final: s.finalGrade,
        remarks: s.finalGrade ? (s.finalGrade >= 75 ? "Passed" : "Failed") : null
      })),
      attendance: {},
      values: [],
      generalAverage,
      honors: generalAverage ? (generalAverage >= 98 ? "With Highest Honors" : generalAverage >= 95 ? "With High Honors" : generalAverage >= 90 ? "With Honors" : null) : null,
      promotionStatus: generalAverage ? (Object.values(subjectGrades).every((s: any) => !s.finalGrade || s.finalGrade >= 75) ? "Promoted" : "Retained") : null
    });
  } catch (error) {
    console.error("Error fetching SF9 data:", error);
    res.status(500).json({ message: "Failed to fetch SF9 data" });
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

    // Get all section IDs from canonical enrollments
    const sectionIds = canonicalEnrollments.map((e: any) => e.sectionId);

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
    const grades = await prisma.grade.findMany({
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
    
    canonicalEnrollments.forEach((enrollment: any) => {
      const sy = enrollment.schoolYear;
      if (!academicHistory[sy]) {
        academicHistory[sy] = {
          schoolYear: sy,
          gradeLevel: enrollment.section.gradeLevel,
          section: enrollment.section.name,
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
          Q1: null,
          Q2: null,
          Q3: null,
          Q4: null,
          finalGrade: null
        };
        }
      });
    });

    [...grades].sort((a: any, b: any) => gradePriority(b) - gradePriority(a)).forEach((grade: any) => {
      const sy = grade.classAssignment.schoolYear;
      if (!academicHistory[sy]) {
        academicHistory[sy] = {
          schoolYear: sy,
          gradeLevel: grade.classAssignment.section.gradeLevel,
          section: grade.classAssignment.section.name,
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
          Q1: null,
          Q2: null,
          Q3: null,
          Q4: null,
          finalGrade: null
        };
      }
      
      // Store quarterly grade only if the slot is still empty (higher-priority rows run first).
      if (grade.quarter === 'Q1' && academicHistory[sy].subjects[key].Q1 === null) academicHistory[sy].subjects[key].Q1 = grade.quarterlyGrade;
      if (grade.quarter === 'Q2' && academicHistory[sy].subjects[key].Q2 === null) academicHistory[sy].subjects[key].Q2 = grade.quarterlyGrade;
      if (grade.quarter === 'Q3' && academicHistory[sy].subjects[key].Q3 === null) academicHistory[sy].subjects[key].Q3 = grade.quarterlyGrade;
      if (grade.quarter === 'Q4' && academicHistory[sy].subjects[key].Q4 === null) academicHistory[sy].subjects[key].Q4 = grade.quarterlyGrade;
    });

    // Calculate final grades for each school year
    const schoolRecords = Object.values(academicHistory).map((year: any) => {
      const subjectGrades = Object.values(year.subjects)
        .sort((a: any, b: any) => a.subjectName.localeCompare(b.subjectName))
        .map((subject: any) => {
        const quarters = [subject.Q1, subject.Q2, subject.Q3, subject.Q4].filter((q: number | null) => q !== null);
        const finalGrade = quarters.length > 0 
          ? Math.round(quarters.reduce((a: number, b: number) => a + b, 0) / quarters.length)
          : null;
        return {
          subjectCode: subject.subjectCode,
          subjectName: subject.subjectName,
          Q1: subject.Q1,
          Q2: subject.Q2,
          Q3: subject.Q3,
          Q4: subject.Q4,
          final: finalGrade,
          remarks: finalGrade ? (finalGrade >= 75 ? "Passed" : "Failed") : null
        };
      });

      // Calculate general average
      const allFinals = subjectGrades.map((s: any) => s.final).filter((g: number | null) => g !== null) as number[];
      const generalAverage = allFinals.length > 0 
        ? Math.round(allFinals.reduce((a: number, b: number) => a + b, 0) / allFinals.length)
        : null;

      return {
        schoolYear: year.schoolYear,
        gradeLevel: year.gradeLevel,
        section: year.section,
        subjectGrades,
        generalAverage,
        honors: generalAverage ? (generalAverage >= 98 ? "With Highest Honors" : generalAverage >= 95 ? "With High Honors" : generalAverage >= 90 ? "With Honors" : null) : null,
        promotionStatus: generalAverage ? (subjectGrades.every((s: any) => !s.final || s.final >= 75) ? "Promoted" : "Retained") : null
      };
    });

    res.json({
      student: {
        id: student.id,
        lrn: student.lrn,
        name: `${student.lastName}, ${student.firstName} ${student.middleName || ""} ${student.suffix || ""}`.trim(),
        gender: normalizeDisplaySex(student.gender),
        birthDate: student.birthDate,
        address: student.address,
        guardianName: student.guardianName,
        guardianContact: student.guardianContact
      },
      schoolRecords: schoolRecords.sort((a, b) => a.schoolYear.localeCompare(b.schoolYear))
    });
  } catch (error) {
    console.error("Error fetching SF10 data:", error);
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
            Q1: subjectGrades.find(g => g.quarter === "Q1")?.quarterlyGrade || null,
            Q2: subjectGrades.find(g => g.quarter === "Q2")?.quarterlyGrade || null,
            Q3: subjectGrades.find(g => g.quarter === "Q3")?.quarterlyGrade || null,
            Q4: subjectGrades.find(g => g.quarter === "Q4")?.quarterlyGrade || null
          };
        });

        return {
          id: e.student.id,
          lrn: e.student.lrn,
          firstName: e.student.firstName,
          middleName: e.student.middleName,
          lastName: e.student.lastName,
          gender: normalizeDisplaySex(e.student.gender),
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
        studentCount: s._count.enrollments,
        adviser: s.adviser 
          ? `${s.adviser.user.firstName} ${s.adviser.user.lastName}`
          : null
      })),
      schoolYear: currentSchoolYear
    });
  } catch (error) {
    console.error("Error fetching SF8 data:", error);
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
    let epSectionNameToId = new Map<string, number>();
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
      adviser: s.adviser
        ? `${s.adviser.user.firstName} ${s.adviser.user.lastName}`
        : null,
      _count: s._count,
      enrollProId: epSectionNameToId.get(s.name) ?? null, // numeric EnrollPro section ID for roster
    })));
  } catch (error) {
    console.error("Error fetching sections:", error);
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
      console.log("Using SF1 template for school register export");

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
      console.log("No SF1 template found, using hardcoded format");

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
    console.error("Error exporting SF1:", error);
    res.status(500).json({ message: "Failed to export school register", error: error.message });
  }
});

// ============================================================
// Phase 1 – Applications, BOSY, Remedial, Section Roster
// ============================================================

// GET /registrar/applications — proxy EnrollPro applications
router.get("/applications", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const { status, gradeLevel, page, limit, search } = req.query as Record<string, string>;
    const sy = await resolveEnrollProSchoolYear();
    const data = await getEnrollProApplications({
      schoolYearId: sy.id,
      status: status || undefined,
      gradeLevel: gradeLevel || undefined,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      search: search || undefined,
    });
    // Normalise response shape: EnrollPro may return { data: [...], meta: {...} }
    // or { applications: [...], pagination: {...} } — unify to { applications, meta }
    const applications: any[] = data.applications ?? data.data ?? data.items ?? [];
    
    // Robustly extract pagination info from common EnrollPro response shapes
    const total = data.total ?? data.meta?.total ?? data.pagination?.total ?? applications.length;
    const pageNum = parseInt(page) || (data.page ?? data.meta?.page ?? data.pagination?.page ?? 1);
    const limitNum = parseInt(limit) || (data.limit ?? data.meta?.limit ?? data.pagination?.limit ?? 50);
    const totalPages = data.totalPages ?? data.meta?.totalPages ?? data.pagination?.totalPages ?? Math.ceil(total / limitNum);

    const meta = {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, totalPages),
    };

    res.json({ applications, meta });
  } catch (err: any) {
    console.error("[registrar/applications]", err.message);
    res.status(502).json({ message: "Failed to fetch applications from EnrollPro", error: err.message });
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
    console.error("[registrar/bosy/queue]", err.message);
    // Handle 404 or other network errors gracefully
    if (err.message?.includes("HTTP 404")) {
      return void res.json({ items: [], total: 0, page: 1, limit: 20, totalPages: 0, message: "Endpoint not yet implemented by EnrollPro" });
    }
    res.status(502).json({ message: "Failed to fetch BOSY queue from EnrollPro", error: err.message });
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
    console.error("[registrar/bosy/expected-queue]", err.message);
    // Handle 404 or other network errors gracefully
    if (err.message?.includes("HTTP 404")) {
      return void res.json({ items: [], total: 0, page: 1, limit: 20, totalPages: 0, message: "Endpoint not yet implemented by EnrollPro" });
    }
    res.status(502).json({ message: "Failed to fetch BOSY expected queue from EnrollPro", error: err.message });
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
    console.error("[registrar/remedial/pending]", err.message);
    res.status(502).json({ message: "Failed to fetch remedial list from EnrollPro", error: err.message });
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
    console.error("[registrar/section-roster]", err.message);
    res.status(502).json({ message: "Failed to fetch section roster from EnrollPro", error: err.message });
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
    console.error("[registrar/eosy/school-years]", err.message);
    res.status(502).json({ message: "Failed to fetch school years from EnrollPro", error: err.message });
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
    console.error("[registrar/eosy/sections]", err.message);
    res.status(502).json({ message: "Failed to fetch EOSY sections from EnrollPro", error: err.message });
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
    console.error("[registrar/eosy/records]", err.message);
    res.status(502).json({ message: "Failed to fetch EOSY records from EnrollPro", error: err.message });
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
    console.error("[registrar/eosy/sf5]", err.message);
    res.status(502).json({ message: "Failed to fetch SF5 from EnrollPro", error: err.message });
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
    console.error("[registrar/eosy/sf6]", err.message);
    res.status(502).json({ message: "Failed to fetch SF6 from EnrollPro", error: err.message });
  }
});

// ============================================================
// Phase 3 – ATLAS read-only proxies
// ============================================================

// GET /registrar/atlas/teaching-loads — faculty teaching load summary from ATLAS
router.get("/atlas/teaching-loads", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const atlasSchoolYearId = req.query.atlasSchoolYearId
      ? parseInt(req.query.atlasSchoolYearId as string, 10)
      : undefined;
    const data = await getAtlasTeachingLoadSummary(atlasSchoolYearId);
    res.json(data);
  } catch (err: any) {
    console.error("[registrar/atlas/teaching-loads]", err.message);
    res.status(502).json({ message: "Failed to fetch teaching loads from ATLAS", error: err.message });
  }
});

// GET /registrar/atlas/subject-coverage — subjects stats (assigned vs unassigned)
router.get("/atlas/subject-coverage", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const data = await getAtlasSubjectStats();
    res.json(data);
  } catch (err: any) {
    console.error("[registrar/atlas/subject-coverage]", err.message);
    res.status(502).json({ message: "Failed to fetch subject coverage from ATLAS", error: err.message });
  }
});

export default router;
