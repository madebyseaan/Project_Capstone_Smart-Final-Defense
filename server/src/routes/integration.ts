/**
 * integration.ts
 *
 * Proxy routes that pull data from EnrollPro, ATLAS, and AIMS
 * and expose them to the SMART frontend.
 *
 * All external calls are READ-ONLY. No writes to EnrollPro, ATLAS, or AIMS.
 */

import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { authenticateToken, AuthRequest, authorizeRoles } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { aimsAuthSchema } from '../schemas/integration';
import {
  getEnrollProTeachers,
  getEnrollProSections,
  getEnrollProSectionStudents,
  checkEnrollProHealth,
  resolveEnrollProSchoolYear,
} from '../lib/enrollproClient';
import {
  aimsLogin,
  aimsRefreshToken,
  getAimsCourses,
  getAimsCourseStudents,
  getAimsGradebook,
  getAimsTeacherDashboard,
  checkAimsHealth,
} from '../lib/aimsClient';
import { triggerImmediateSync } from '../lib/syncCoordinator';
import { addSyncSseClient, removeSyncSseClient } from '../lib/sseManager';
import { getActiveSchoolYearLabel } from '../lib/schoolYearResolver';
import { serviceAuth } from '../middleware/serviceAuth';

const router = Router();

// ---------------------------------------------------------------------------
// Real-time Sync Updates (SSE)
// ---------------------------------------------------------------------------

/**
 * GET /api/integration/sync/stream
 * Real-time SSE stream for sync status updates.
 * Frontend listens here to auto-refresh data when background sync finishes.
 */
router.get('/sync/stream', authenticateToken, (req: AuthRequest, res: Response): void => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  addSyncSseClient(res);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSyncSseClient(res);
  });
});

// ---------------------------------------------------------------------------
// Grade Outcomes (called by EnrollPro during EOSY)
// ---------------------------------------------------------------------------

/**
 * POST /api/integration/smart/sections/:sectionId/sync-grades
 * POST /api/integration/sections/:sectionId/sync-grades
 *
 * EnrollPro calls this to pull final grades for all students in a section.
 * Returns per-subject final ratings, general average, remarks, and promotion status.
 */
const handleSmartSectionSyncGrades = async (req: any, res: any) => {
  try {
    const sectionId = req.params.sectionId as string;
    const { schoolYear: querySY } = req.query;
    logger.info(`[SmartIntegration] Grade outcomes requested for Section #${sectionId}`);

    // Resolve school year
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 'main' },
      select: { currentSchoolYear: true },
    });
    const schoolYear = (querySY as string) || await getActiveSchoolYearLabel();

    // Find section
    const section = await prisma.section.findFirst({
      where: {
        OR: [
          { id: sectionId },
          { name: { equals: sectionId, mode: 'insensitive' } },
        ],
        schoolYear,
      },
      include: {
        adviser: { include: { user: true } },
      },
    });

    if (!section) {
      return res.status(404).json({ success: false, error: `Section not found for school year ${schoolYear}` });
    }

    // Get all enrollments
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId: section.id, schoolYear, status: 'ENROLLED' },
      include: { student: true },
    });

    // Get all class assignments for this section (schoolYear only — historical reads must survive rollover archiving)
    const classAssignments = await prisma.classAssignment.findMany({
      where: { sectionId: section.id, schoolYear },
      include: { subject: true, teacher: { include: { user: true } } },
    });

    // Get all FINALIZED grades for this section — only finalized grades sync to EnrollPro
    const grades = await prisma.grade.findMany({
      where: {
        classAssignment: { sectionId: section.id, schoolYear },
        status: 'FINALIZED',
      },
      include: {
        classAssignment: { include: { subject: true, teacher: { include: { user: true } } } },
      },
    });

    const { finalizeSubjectRows, evaluatePromotion, promotionStatusLabel, canonicalSubjectKey } = await import('../lib/promotion');
    type SubjectTermInput = {
      subjectCode: string;
      subjectName: string;
      teacher?: string;
      T1: number | null;
      T2: number | null;
      T3: number | null;
      isNonPromotional?: boolean;
      rotationTermGroupId?: string | null;
      rotationTermRank?: number | null;
      rotationOutputLabel?: string | null;
    };

    // Build per-student results
    const outcomes = enrollments.map((enr) => {
      const studentGrades = grades.filter((g) => g.studentId === enr.student.id);

      const subjectMap: Map<string, SubjectTermInput> = new Map();

      for (const ca of classAssignments) {
        const key = canonicalSubjectKey(ca.subject.code, ca.subject.name);
        if (!subjectMap.has(key)) {
          subjectMap.set(key, {
            subjectCode: ca.subject.code,
            subjectName: ca.subject.name,
            teacher: ca.teacher?.user
              ? `${ca.teacher.user.firstName ?? ''} ${ca.teacher.user.lastName ?? ''}`.trim()
              : '',
            T1: null, T2: null, T3: null,
            isNonPromotional: ca.subject.isNonPromotional,
            rotationTermGroupId: ca.subject.rotationTermGroupId,
            rotationTermRank: ca.subject.rotationTermRank,
            rotationOutputLabel: ca.subject.rotationOutputLabel,
          });
        }
      }

      for (const grade of studentGrades) {
        const ca = grade.classAssignment;
        const key = canonicalSubjectKey(ca.subject.code, ca.subject.name);
        if (!subjectMap.has(key)) {
          subjectMap.set(key, {
            subjectCode: ca.subject.code,
            subjectName: ca.subject.name,
            teacher: ca.teacher?.user
              ? `${ca.teacher.user.firstName ?? ''} ${ca.teacher.user.lastName ?? ''}`.trim()
              : '',
            T1: null, T2: null, T3: null,
            isNonPromotional: ca.subject.isNonPromotional,
            rotationTermGroupId: ca.subject.rotationTermGroupId,
            rotationTermRank: ca.subject.rotationTermRank,
            rotationOutputLabel: ca.subject.rotationOutputLabel,
          });
        }
        const row = subjectMap.get(key)!;
        const termKey = grade.term as 'T1' | 'T2' | 'T3';
        if (grade.quarterlyGrade !== null && row[termKey] === null) {
          row[termKey] = grade.quarterlyGrade;
        }
      }

      const subjectRows = finalizeSubjectRows(Array.from(subjectMap.values()));
      const decision = evaluatePromotion(section.gradeLevel, subjectRows);

      const finalizedTimes = studentGrades
        .map((g) => g.finalizedAt)
        .filter((t): t is Date => t !== null);
      const publishedAt = finalizedTimes.length > 0
        ? new Date(Math.max(...finalizedTimes.map((t) => t.getTime())))
        : null;

      return {
        lrn: enr.student.lrn,
        studentName: `${enr.student.lastName}, ${enr.student.firstName}`,
        subjectGrades: subjectRows,
        generalAverage: decision.generalAverage,
        remarks: decision.generalRemarks,
        promotionStatus: decision.promotionStatus === "JHS_COMPLETER"
          ? "Promoted"
          : promotionStatusLabel(decision.promotionStatus),
        publishedAt: publishedAt ? publishedAt.toISOString() : null,
      };
    });

    const sectionPublishedTimes = outcomes
      .map((o: any) => o.publishedAt)
      .filter((t: string | null): t is string => t !== null);
    const sectionPublishedAt = sectionPublishedTimes.length === outcomes.length && outcomes.length > 0
      ? sectionPublishedTimes.reduce((a, b) => (a > b ? a : b))
      : null;

    res.json({
      success: true,
      ready: sectionPublishedAt !== null,
      sectionId: section.id,
      sectionName: section.name,
      gradeLevel: section.gradeLevel,
      program: section.program,
      schoolYear,
      adviser: section.adviser
        ? `${section.adviser.user.firstName ?? ''} ${section.adviser.user.lastName ?? ''}`.trim()
        : null,
      outcomesSynced: outcomes.length,
      publishedAt: sectionPublishedAt,
      outcomes,
    });
  } catch (err: any) {
    console.error(`[SmartIntegration] Error syncing grades for section ${req.params.sectionId}:`, err.message);
    res.status(500).json({ success: false, error: 'Failed to sync grades' });
  }
};

router.post('/smart/sections/:sectionId/sync-grades', serviceAuth, handleSmartSectionSyncGrades);
router.post('/sections/:sectionId/sync-grades', serviceAuth, handleSmartSectionSyncGrades);

// ---------------------------------------------------------------------------
// System Status
// ---------------------------------------------------------------------------

const ATLAS_BASE = (process.env.ATLAS_URL ?? process.env.ATLAS_BASE_URL ?? 'https://njgrm.buru-degree.ts.net/api/v1').replace(/\/$/, '');

router.get('/status', authenticateToken, async (_req: AuthRequest, res: Response): Promise<void> => {
  const results = await Promise.allSettled([
    checkEnrollProHealth(),
    fetch(`${ATLAS_BASE}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok),
    checkAimsHealth(),
  ]);

  res.json({
    success: true,
    data: {
      enrollpro: { online: results[0].status === 'fulfilled' && results[0].value },
      atlas: { online: results[1].status === 'fulfilled' && results[1].value },
      aims: { online: results[2].status === 'fulfilled' && results[2].value },
      checkedAt: new Date().toISOString(),
    },
  });
});

// ---------------------------------------------------------------------------
// EnrollPro — Advisory
// ---------------------------------------------------------------------------

router.get(
  '/enrollpro/my-advisory',
  authenticateToken,
  authorizeRoles('TEACHER'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      });
      if (!teacher?.employeeId) {
        res.json({ success: true, data: { advisory: null, message: 'No employee ID' } });
        return;
      }

      const epTeachers = await getEnrollProTeachers();
      const epTeacher = epTeachers.find((t) => t.employeeId === teacher.employeeId);
      if (!epTeacher) {
        res.json({ success: true, data: { advisory: null, message: 'Not found in EP' } });
        return;
      }

      const allSections = await getEnrollProSections();
      const mySection = allSections.find((s) => s.advisingTeacher?.id === epTeacher.id);
      if (!mySection) {
        res.json({ success: true, data: { advisory: null, message: 'No advisory in EP' } });
        return;
      }

      const resolvedSY = await resolveEnrollProSchoolYear(process.env.ENROLLPRO_SCHOOL_YEAR_LABEL);
      const schoolYearId = resolvedSY.id;
      const students = await getEnrollProSectionStudents(mySection.id, schoolYearId);

      res.json({
        success: true,
        data: {
          teacher: { name: `${epTeacher.lastName}, ${epTeacher.firstName}`, email: epTeacher.email },
          advisory: {
            sectionName: mySection.name,
            gradeLevel: mySection.gradeLevelName,
            students: students.map((s) => ({ lrn: s.lrn, firstName: s.firstName, lastName: s.lastName })),
          },
        },
      });
    } catch (err: any) {
      res.status(502).json({ success: false, error: 'EP Error' });
    }
  }
);

router.get('/enrollpro/sections', authenticateToken, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sections = await getEnrollProSections();
    res.json({ success: true, data: sections });
  } catch (err: any) {
    res.status(502).json({ success: false, error: 'EP Error' });
  }
});

router.get(
  '/enrollpro/faculty',
  authenticateToken,
  authorizeRoles('ADMIN', 'REGISTRAR'),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const faculty = await getEnrollProTeachers();
      res.json({ success: true, data: faculty });
    } catch (err: any) {
      res.status(502).json({ success: false, error: 'EP Error' });
    }
  }
);

// ---------------------------------------------------------------------------
// ATLAS — Teaching Load
// ---------------------------------------------------------------------------

router.get(
  '/atlas/my-teaching-load',
  authenticateToken,
  authorizeRoles('TEACHER'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
      });
      if (!teacher) return;

      const settings = await prisma.systemSettings.findUnique({
        where: { id: 'main' },
        select: { currentSchoolYear: true },
      });
      const currentSchoolYear = await getActiveSchoolYearLabel();

      const assignments = await prisma.classAssignment.findMany({
        where: {
          teacherId: teacher.id,
          schoolYear: currentSchoolYear,
        },
        include: {
          subject: true,
          section: { include: { _count: { select: { enrollments: { where: { status: 'ENROLLED' } } } } } },
        },
      });

      res.json({
        success: true,
        data: {
          assignments: assignments.map((a) => ({
            id: a.id,
            subject: a.subject,
            section: { ...a.section, studentCount: a.section._count.enrollments },
          })),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: 'Atlas Load Error' });
    }
  }
);

// ---------------------------------------------------------------------------
// AIMS — Auth & Gradebook
// ---------------------------------------------------------------------------

router.post(
  '/aims/auth',
  authenticateToken,
  authorizeRoles('TEACHER'),
  validate(aimsAuthSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { aimsPassword } = req.body as { aimsPassword?: string };
    const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
    if (!user?.email || !aimsPassword) return;

    try {
      const result = await aimsLogin(user.email, aimsPassword);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(502).json({ success: false, error: 'AIMS Error' });
    }
  }
);

router.get(
  '/aims/gradebook/:courseId',
  authenticateToken,
  authorizeRoles('TEACHER'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const aimsToken = req.headers['x-aims-token'] as string;
    if (!aimsToken) return;

    try {
      const gradebook = await getAimsGradebook(req.params.courseId as string, aimsToken);
      res.json({ success: true, data: gradebook });
    } catch (err: any) {
      res.status(502).json({ success: false, error: 'AIMS Gradebook Error' });
    }
  }
);

// ---------------------------------------------------------------------------
// Teacher Schedule (from ATLAS published schedule)
// ---------------------------------------------------------------------------

/**
 * GET /api/integration/schedule
 * Returns the logged-in teacher's schedule entries for the current school year,
 * grouped by day for easy frontend rendering.
 */
router.get(
  '/schedule',
  authenticateToken,
  authorizeRoles('TEACHER'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const teacher = await prisma.teacher.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!teacher) { res.status(404).json({ error: 'Teacher profile not found' }); return; }

      const schoolYear = await getActiveSchoolYearLabel();

      const entries = await prisma.scheduleEntry.findMany({
        where: { teacherId: teacher.id, schoolYear },
        include: {
          subject: { select: { code: true, name: true } },
          section: { select: { name: true, gradeLevel: true } },
        },
        orderBy: [{ day: 'asc' }, { startTime: 'asc' }],
      });

      // Group by day
      const byDay: Record<string, typeof entries> = {
        MONDAY: [], TUESDAY: [], WEDNESDAY: [], THURSDAY: [], FRIDAY: [],
      };
      for (const entry of entries) {
        const day = entry.day.toUpperCase();
        if (byDay[day]) byDay[day].push(entry);
      }

      res.json({
        schoolYear,
        entries,
        byDay,
        count: entries.length,
      });
    } catch (err: any) {
      logger.error('[Schedule] Failed to fetch schedule:', err.message);
      res.status(500).json({ error: 'Failed to fetch schedule' });
    }
  }
);

/**
 * POST /api/integration/schedule/refresh
 * Triggers an immediate background sync and returns the schedule.
 * The frontend should listen for SYNC_COMPLETE SSE event for final data.
 */
router.post(
  '/schedule/refresh',
  authenticateToken,
  authorizeRoles('TEACHER'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      triggerImmediateSync('teacher-schedule-refresh');

      // Return current data immediately — SSE will push fresh data when sync completes
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const teacher = await prisma.teacher.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!teacher) { res.status(404).json({ error: 'Teacher profile not found' }); return; }

      const schoolYear = await getActiveSchoolYearLabel();

      const entries = await prisma.scheduleEntry.findMany({
        where: { teacherId: teacher.id, schoolYear },
        include: {
          subject: { select: { code: true, name: true } },
          section: { select: { name: true, gradeLevel: true } },
        },
        orderBy: [{ day: 'asc' }, { startTime: 'asc' }],
      });

      const byDay: Record<string, typeof entries> = {
        MONDAY: [], TUESDAY: [], WEDNESDAY: [], THURSDAY: [], FRIDAY: [],
      };
      for (const entry of entries) {
        const day = entry.day.toUpperCase();
        if (byDay[day]) byDay[day].push(entry);
      }

      res.json({
        schoolYear,
        entries,
        byDay,
        count: entries.length,
        syncTriggered: true,
      });
    } catch (err: any) {
      logger.error('[Schedule] Failed to refresh schedule:', err.message);
      res.status(500).json({ error: 'Failed to refresh schedule' });
    }
  }
);

export default router;
