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
import {
  getEnrollProTeachers,
  getEnrollProSections,
  getEnrollProSectionStudents,
  checkEnrollProHealth,
  resolveEnrollProSchoolYear,
} from '../lib/enrollproClient';
import { checkAimsHealth } from '../lib/aimsClient';
import { triggerImmediateSync } from '../lib/syncCoordinator';
import { addSyncSseClient, removeSyncSseClient } from '../lib/sseManager';
import { getActiveSchoolYearLabel } from '../lib/schoolYearResolver';
import { resolveCurrentTerm } from './grades-sub/helpers';
import { serviceAuth } from '../middleware/serviceAuth';
import { maskId } from '../lib/redact';
import { buildSf10Records } from '../lib/sf10';
import { parseTermSelector } from '../schemas/atlasSchedule';
import {
  fetchTeacherDraftSchedule,
  resolveAtlasFacultyRefs,
  resolveAtlasSchoolYearIdForLabel,
  getOrderedTermContract,
  validateDraftTermSelection,
} from '../lib/atlasDraftSchedule';

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
// Per-Student SF10 Grades (called by EnrollPro)
// ---------------------------------------------------------------------------

/**
 * GET /api/integration/smart/students/:studentId/sf10-grades
 * GET /api/integration/students/:studentId/sf10-grades
 *
 * EnrollPro queries this with the student's LRN (not the SMART UUID).
 * Returns all historical SF10 grades for one student, optionally filtered by schoolYear.
 */
const handleStudentSf10Grades = async (req: any, res: any) => {
  try {
    const studentRef = req.params.studentId as string;
    const { schoolYear } = req.query;
    logger.info(`[SmartIntegration] SF10 grades requested for student ref #${maskId(studentRef)}`);

    // EnrollPro passes the LRN — resolve to the SMART student ID (fallback: internal UUID)
    const byLrn = await prisma.student.findUnique({
      where: { lrn: studentRef },
      select: { id: true },
    });
    const student = byLrn ?? await prisma.student.findUnique({
      where: { id: studentRef },
      select: { id: true },
    });

    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    const data = await buildSf10Records(student.id);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    const schoolRecords = schoolYear
      ? data.schoolRecords.filter((r: any) => r.schoolYear === (schoolYear as string))
      : data.schoolRecords;

    res.json({
      success: true,
      student: {
        id: data.student.id,
        lrn: data.student.lrn,
        firstName: data.student.firstName,
        lastName: data.student.lastName,
        middleName: data.student.middleName,
        nameExtension: data.student.nameExtension,
        gender: data.student.gender,
        birthDate: data.student.birthDate,
      },
      schoolRecords,
      schoolSettings: {
        schoolName: data.schoolSettings.schoolName,
        schoolId: data.schoolSettings.schoolId,
      },
    });
  } catch (err: any) {
    logger.error(`[SmartIntegration] Error fetching SF10 grades for student ${maskId(String(req.params.studentId))}:`, err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch SF10 grades' });
  }
};

router.get('/smart/students/:studentId/sf10-grades', serviceAuth, handleStudentSf10Grades);
router.get('/students/:studentId/sf10-grades', serviceAuth, handleStudentSf10Grades);

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
          isActive: true,
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
// ---------------------------------------------------------------------------
// Teacher Schedule (ATLAS term-aware published schedule, contract pin 70a51608)
// ---------------------------------------------------------------------------

const TERM_INDEX_BY_LABEL: Record<string, number> = { T1: 1, T2: 2, T3: 3 };

interface ScheduleTermRow {
  termIndex: number;
  order: number;
  identity: string;
  displayLabel: string;
  revisionMarker: string | null;
  entries: number;
}

interface ScheduleMetaView {
  revisionMarker: string | null;
  revisionId: number | null;
  appliedRevisionIds: number[];
  publishedAt: string | null;
  generatedAt: string | null;
  snapshotState: string | null;
  snapshotGaps: string[];
  isHistorical: boolean;
  isActiveSchoolYear: boolean | null;
  conflict: string | null;
  syncedAt: string | null;
}

interface ScheduleSpecialEventView {
  eventName: string;
  startTime: string;
  endTime: string;
  dayOfWeek: string | null;
  days: string[];
  termIndex: number | null;
}

async function findTeacherScheduleEntries(teacherId: string, schoolYear: string, termIndex: number | null) {
  return prisma.scheduleEntry.findMany({
    where: {
      teacherId,
      schoolYear,
      ...(termIndex ? { OR: [{ termIndex }, { termIndex: null }] } : {}),
    },
    include: {
      subject: { select: { code: true, name: true } },
      section: { select: { name: true, gradeLevel: true } },
    },
    orderBy: [{ day: 'asc' }, { startTime: 'asc' }],
  });
}

/**
 * Compose the teacher schedule response for a term (default: the locally
 * resolved current term). Term labels come from `source.orderedTerms` via the
 * persisted AtlasScheduleMeta (label authority §4.1 — never hardcoded); room
 * names come from the AtlasCrosswalk (§4.3 — a raw ATLAS surrogate id is never
 * presented as a room number).
 */
async function buildScheduleResponse(teacherId: string, requestedTermIndex: number | null) {
  const schoolYear = await getActiveSchoolYearLabel();
  const resolvedTermIndex = TERM_INDEX_BY_LABEL[await resolveCurrentTerm()] ?? null;
  const termIndex = requestedTermIndex ?? resolvedTermIndex;

  const [entries, meta] = await Promise.all([
    findTeacherScheduleEntries(teacherId, schoolYear, termIndex),
    prisma.atlasScheduleMeta.findUnique({ where: { schoolYear } }),
  ]);

  const roomIds = Array.from(new Set(entries.map(e => e.roomId).filter((id): id is number => id != null)));
  const roomRows = roomIds.length > 0
    ? await prisma.atlasCrosswalk.findMany({
        where: { kind: 'ROOM', schoolYear, atlasId: { in: roomIds } },
        select: { atlasId: true, label: true, detail: true },
      })
    : [];
  const roomByAtlasId = new Map(roomRows.map(r => [r.atlasId, r]));

  const entriesWithRooms = entries.map(e => {
    const room = e.roomId != null ? roomByAtlasId.get(e.roomId) : undefined;
    return { ...e, roomLabel: room?.label ?? null, roomBuilding: room?.detail ?? null };
  });

  const byDay: Record<string, typeof entriesWithRooms> = {
    MONDAY: [], TUESDAY: [], WEDNESDAY: [], THURSDAY: [], FRIDAY: [],
  };
  for (const entry of entriesWithRooms) {
    const day = entry.day.toUpperCase();
    if (byDay[day]) byDay[day].push(entry);
  }

  const terms: ScheduleTermRow[] = ((meta?.terms ?? []) as any[])
    .filter(t => Number.isFinite(Number(t?.termIndex)))
    .map(t => ({
      termIndex: Number(t.termIndex),
      order: Number(t.order ?? t.termIndex),
      identity: String(t.identity ?? t.termIndex),
      displayLabel: String(t.displayLabel ?? `TERM ${t.termIndex}`),
      revisionMarker: t.revisionMarker ?? null,
      entries: Number(t.entries ?? 0),
    }))
    .sort((a, b) => a.order - b.order);

  // §4.4: specialEvents[] is the school-wide union of non-teaching windows.
  // Duplicate windows are real (two "Lunch Break" rows) and are never merged.
  const specialEvents: ScheduleSpecialEventView[] = ((meta?.specialEvents ?? []) as any[])
    .map(e => ({
      eventName: String(e.eventName ?? ''),
      startTime: String(e.startTime ?? ''),
      endTime: String(e.endTime ?? ''),
      dayOfWeek: e.dayOfWeek != null ? String(e.dayOfWeek) : null,
      days: Array.isArray(e.days) ? e.days.map(String) : [],
      termIndex: e.termIndex != null ? Number(e.termIndex) : null,
    }))
    .filter(e => e.eventName && e.startTime && e.endTime)
    .filter(e => termIndex == null || e.termIndex == null || e.termIndex === termIndex);

  const timeSlots = ((meta?.timeSlots ?? []) as any[])
    .map(s => ({ startTime: String(s.startTime ?? ''), endTime: String(s.endTime ?? '') }))
    .filter(s => s.startTime && s.endTime);

  const source = (meta?.source ?? {}) as any;
  const metaView: ScheduleMetaView = {
    revisionMarker: source.revisionMarker ?? null,
    revisionId: source.activeRevisionId ?? null,
    appliedRevisionIds: Array.isArray(source.appliedRevisionIds) ? source.appliedRevisionIds : [],
    publishedAt: source.publishedAt ?? null,
    generatedAt: source.generatedAt ?? null,
    snapshotState: source.snapshotState ?? null,
    snapshotGaps: Array.isArray(source.snapshotGaps) ? source.snapshotGaps.map(String) : [],
    isHistorical: source.isHistorical === true,
    isActiveSchoolYear: source.isActiveSchoolYear ?? null,
    conflict: meta?.conflict ?? null,
    syncedAt: meta?.syncedAt ? new Date(meta.syncedAt).toISOString() : null,
  };

  return {
    schoolYear,
    entries: entriesWithRooms,
    byDay,
    count: entriesWithRooms.length,
    requestedTermIndex: termIndex,
    activeTermIndex: resolvedTermIndex,
    terms: terms.map(t => ({ order: t.order, identity: t.identity, displayLabel: t.displayLabel })),
    specialEvents,
    timeSlots,
    meta: metaView,
  };
}

/**
 * GET /api/integration/schedule
 * Returns the logged-in teacher's schedule entries for the current school year
 * and term, grouped by day. `?termIndex=1..4` switches the term (labels come
 * from `terms`, per contract §7.4).
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

      let requestedTermIndex: number | null = null;
      if (req.query.termIndex != null) {
        const parsed = parseTermSelector(req.query.termIndex);
        if (parsed === null || parsed === 'active') {
          res.status(400).json({ code: 'INVALID_TERM_INDEX', error: 'termIndex must be 1..4' });
          return;
        }
        requestedTermIndex = parsed;
      }

      res.json(await buildScheduleResponse(teacher.id, requestedTermIndex));
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

      res.json({ ...(await buildScheduleResponse(teacher.id, null)), syncTriggered: true });
    } catch (err: any) {
      logger.error('[Schedule] Failed to refresh schedule:', err.message);
      res.status(500).json({ error: 'Failed to refresh schedule' });
    }
  }
);

// ---------------------------------------------------------------------------
// Teacher Draft Schedule (ATLAS §8A — share-gated, term-scoped, own-draft only)
// ---------------------------------------------------------------------------

function draftErrorStatus(code: string, httpStatus: number): number {
  if (httpStatus === 401) return 502; // our credential — integration config problem
  if (httpStatus >= 400 && httpStatus < 600) return httpStatus;
  return 502;
}

/**
 * GET /api/integration/schedule/draft?termIndex=<n>
 * The logged-in teacher's own DRAFT schedule (ATLAS §8A). Never whole-school
 * (contract D3): the ATLAS faculty identity is always resolved from the caller.
 *
 * `status` is one of:
 *   shared      — a scheduler shared the draft; entries carry labels mapped
 *                 from SMART's AtlasCrosswalk (unmapped ids listed per row)
 *   not_shared  — the run exists but the sharing switch is OFF (the default)
 *   unavailable — no completed FULL draft run, or the latest run is published
 *
 * Term selection errors use the contract codes (TERM_INDEX_REQUIRED,
 * INVALID_TERM_INDEX, TERM_INDEX_OUTSIDE_CONTRACT).
 */
router.get(
  '/schedule/draft',
  authenticateToken,
  authorizeRoles('TEACHER'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const teacher = await prisma.teacher.findUnique({
        where: { userId },
        select: { id: true, employeeId: true, user: { select: { email: true } } },
      });
      if (!teacher) { res.status(404).json({ error: 'Teacher profile not found' }); return; }

      const schoolYear = await getActiveSchoolYearLabel();
      const orderedTerms = await getOrderedTermContract(schoolYear);
      const termCheck = validateDraftTermSelection(req.query.termIndex, orderedTerms);
      if (!termCheck.ok) {
        res.status(400).json({ code: termCheck.code, error: termCheck.message });
        return;
      }

      const atlasSchoolYearId = await resolveAtlasSchoolYearIdForLabel(schoolYear);
      if (!atlasSchoolYearId) {
        res.status(502).json({ code: 'ATLAS_YEAR_UNRESOLVED', error: 'ATLAS school year could not be resolved' });
        return;
      }

      const facultyRefs = await resolveAtlasFacultyRefs({
        id: teacher.id,
        employeeId: teacher.employeeId,
        email: teacher.user?.email ?? null,
      });
      const outcome = await fetchTeacherDraftSchedule({
        schoolYearLabel: schoolYear,
        atlasSchoolYearId,
        facultyRefs,
        termIndex: termCheck.term,
      });

      if (outcome.status === 'error') {
        logger.error(`[Schedule] Draft read failed: ${outcome.code} — ${outcome.message}`);
        res.status(draftErrorStatus(outcome.code, outcome.httpStatus)).json({
          code: outcome.code,
          error: outcome.message,
        });
        return;
      }

      res.json({ ...outcome, schoolYear, terms: orderedTerms });
    } catch (err: any) {
      logger.error('[Schedule] Failed to fetch draft schedule:', err.message);
      res.status(500).json({ error: 'Failed to fetch draft schedule' });
    }
  }
);

export default router;
