/**
 * grades-sub/aims.ts — AIMS integration endpoints for the teacher ledger.
 */

import { Router, Response } from "express";
import { AuditAction, AuditSeverity, Term } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../../middleware/auth";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { validate } from "../../middleware/validate";
import { syncCache } from "../../lib/syncCache";
import {
  isAimsConfigured,
  getAimsPublicScores,
  getAimsPublicCourses,
  AimsError,
} from "../../lib/aimsClient";
import { aimsLinkSchema, aimsImportSchema } from "../../schemas/aims";
import {
  resolveCurrentTerm,
  isHomeroomGuidanceSubjectCode,
} from "./helpers";
import { checkGradeEditLocks } from "../../lib/gradeLocks";
import { importAimsScoresToGrades } from "../../lib/aimsImport";
import { computeCourseWarnings } from "../../lib/aimsCourseMatch";

const VALID_TERMS = ["T1", "T2", "T3"] as const;

export default function registerAims(router: Router): void {

  // GET /aims-scores/:classAssignmentId?term=T1
  router.get(
    "/aims-scores/:classAssignmentId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const classAssignmentId = String(req.params.classAssignmentId);
        const termRaw = String(req.query.term ?? "T1");

        // P2-3: Validate term
        if (!VALID_TERMS.includes(termRaw as any)) {
          res.status(400).json({ message: "Invalid term. Must be T1, T2, or T3." });
          return;
        }
        const term = termRaw as Term;

        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });
        if (!teacher) { res.status(404).json({ message: "Teacher profile not found" }); return; }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: { id: classAssignmentId, teacherId: teacher.id },
          include: { section: { select: { name: true } }, subject: { select: { name: true } } },
        });
        if (!classAssignment) { res.status(403).json({ message: "Not authorized for this class" }); return; }

        const linked = !!classAssignment.aimsCourseId;

        if (!linked) {
          res.json({
            linked: false, course: null, weights: null, lastSyncedAt: null,
            aimsOffline: !isAimsConfigured(), unmatchedStudents: [], assessments: [], rows: [], warnings: [],
          });
          return;
        }

        const courseId = classAssignment.aimsCourseId!;

        // P2-2: Cache-miss refetch for course metadata
        let courseMeta = syncCache.get<any>(`aims:course:${courseId}`);
        let courseWeights: { ww: number; pt: number } | null = null;

        if (!courseMeta) {
          // Try to refetch and re-populate cache
          try {
            const refetchData = await getAimsPublicScores(courseId);
            if (refetchData) {
              courseMeta = refetchData.course;
              courseWeights = refetchData.weights;
              syncCache.set(`aims:course:${courseId}`, courseMeta, 3600_000);
              syncCache.set(`aims:weights:${courseId}`, courseWeights, 3600_000);
            }
          } catch {
            // Degrade to stub — non-fatal
          }
        }

        // Read weights from cache if not already fetched
        if (!courseWeights) {
          courseWeights = syncCache.get<any>(`aims:weights:${courseId}`) ?? null;
        }

        const scores = await prisma.aimsScore.findMany({
          where: { classAssignmentId, term },
          include: { student: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { assessmentTitle: "asc" },
        });

        const assessmentMap = new Map<string, { assessmentId: string; title: string; type: string; category: string; maxPoints: number }>();
        for (const s of scores) {
          if (!assessmentMap.has(s.assessmentId)) {
            assessmentMap.set(s.assessmentId, {
              assessmentId: s.assessmentId, title: s.assessmentTitle,
              type: s.type, category: s.category, maxPoints: s.maxPoints,
            });
          }
        }
        const assessments = Array.from(assessmentMap.values()).sort((a, b) => {
          if (a.category !== b.category) return a.category === "WW" ? -1 : 1;
          return a.title.localeCompare(b.title);
        });

        const studentMap = new Map<string, { studentId: string; firstName: string; lastName: string; scores: any[] }>();
        for (const s of scores) {
          let entry = studentMap.get(s.studentId);
          if (!entry) {
            entry = { studentId: s.studentId, firstName: s.student.firstName, lastName: s.student.lastName, scores: [] };
            studentMap.set(s.studentId, entry);
          }
          entry.scores.push({
            assessmentId: s.assessmentId, pointsEarned: s.pointsEarned, maxPoints: s.maxPoints,
            score: s.score, isRemedial: s.isRemedial, attemptNumber: s.attemptNumber,
            gradedAt: s.gradedAt?.toISOString() ?? null, importedAt: s.importedAt?.toISOString() ?? null,
          });
        }
        const rows = Array.from(studentMap.values());

        const lastSyncAgg = await prisma.aimsScore.aggregate({
          where: { classAssignmentId },
          _max: { syncedAt: true },
        });
        const lastSyncedAt = lastSyncAgg._max?.syncedAt?.toISOString() ?? null;

        const { getLastUnifiedSyncResult } = await import("../../lib/syncCoordinator");
        const lastResult = getLastUnifiedSyncResult();
        const unmatchedStudents = (lastResult?.aims?.unmatched ?? [])
          .filter((u: any) => u.classAssignmentId === classAssignmentId)
          .map((u: any) => ({ enrollproId: u.enrollproId, studentName: u.studentName, studentEmail: u.studentEmail }));

        // P2-7: Persistent warnings (recomputed on every GET, not just link-time)
        const warnings = courseMeta
          ? computeCourseWarnings(
              { schoolYear: courseMeta.schoolYear, sectionName: courseMeta.sectionName, subject: courseMeta.subject },
              { schoolYear: classAssignment.schoolYear, sectionName: classAssignment.section?.name, subjectName: classAssignment.subject?.name },
            )
          : [];

        res.json({
          linked: true,
          course: courseMeta ?? { id: courseId, name: "Unknown", code: "", subject: "", gradeLevel: "", sectionName: "", schoolYear: "" },
          weights: courseWeights, lastSyncedAt,
          aimsOffline: !isAimsConfigured() || (lastResult?.aims?.status === "offline"),
          unmatchedStudents, assessments, rows, warnings,
        });
      } catch (error) {
        logger.error("Error fetching AIMS scores:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // GET /grades/aims-courses (P2-6: course picker)
  router.get(
    "/aims-courses",
    authenticateToken,
    authorizeRoles("TEACHER"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        if (!isAimsConfigured()) {
          res.json({ courses: [], scope: "none" });
          return;
        }

        const user = await prisma.user.findUnique({ where: { id: req.user?.id }, select: { email: true } });
        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
          select: { employeeId: true },
        });
        const employeeId = teacher?.employeeId?.trim();

        // Resolve current school year for scoping
        const { getActiveSchoolYearLabel } = await import("../../lib/schoolYearResolver");
        let schoolYear: string;
        try {
          schoolYear = await getActiveSchoolYearLabel();
        } catch {
          // No active school year — fail-soft
          res.json({ courses: [], scope: "none" });
          return;
        }

        // WARNING: AIMS AND-combines teacherUsername + teacherEmail when both are passed.
        // We want either-or matching, so these must be sequential separate calls.
        // NEVER send both in the same getAimsPublicCourses() call.

        // 1st try: match by employee number (teacherUsername)
        if (employeeId) {
          const usernameCourses = await getAimsPublicCourses({ teacherUsername: employeeId, schoolYear });
          if (usernameCourses.length > 0) {
            res.json({ courses: usernameCourses, scope: "teacher" });
            return;
          }
        }

        // 2nd try: match by email (catches legacy null-username accounts)
        if (user?.email) {
          const emailCourses = await getAimsPublicCourses({ teacherEmail: user.email, schoolYear });
          if (emailCourses.length > 0) {
            res.json({ courses: emailCourses, scope: "teacher" });
            return;
          }
        }

        // 3rd try: school-wide fallback
        const schoolCourses = await getAimsPublicCourses({ schoolYear });
        if (schoolCourses.length > 0) {
          res.json({ courses: schoolCourses, scope: "school" });
          return;
        }

        // All empty
        res.json({ courses: [], scope: "none" });
      } catch (error) {
        logger.error("Error fetching AIMS courses:", error);
        res.json({ courses: [], scope: "none" }); // Fail-soft
      }
    }
  );

  // POST /aims-link/:classAssignmentId  (body: { aimsCourseId })
  router.post(
    "/aims-link/:classAssignmentId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(aimsLinkSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const classAssignmentId = String(req.params.classAssignmentId);
        const { aimsCourseId } = req.body;

        const teacher = await prisma.teacher.findUnique({ where: { userId: req.user?.id } });
        if (!teacher) { res.status(404).json({ message: "Teacher profile not found" }); return; }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: { id: classAssignmentId, teacherId: teacher.id },
          include: { section: { select: { name: true } }, subject: { select: { name: true } } },
        });
        if (!classAssignment) { res.status(403).json({ message: "Not authorized for this class" }); return; }

        let scoresData;
        try {
          scoresData = await getAimsPublicScores(aimsCourseId);
        } catch (err) {
          if (err instanceof AimsError && err.statusCode === 404) {
            res.status(400).json({ message: "AIMS course not found" }); return;
          }
          if (err instanceof AimsError && err.statusCode === 503) {
            res.status(503).json({ message: "AIMS integration not configured (EXTERNAL_API_KEY missing on AIMS)." }); return;
          }
          throw err;
        }
        if (!scoresData) { res.status(400).json({ message: "AIMS course not found" }); return; }

        // P2-7: Compute warnings for the response
        const warnings = computeCourseWarnings(
          { schoolYear: scoresData.course.schoolYear, sectionName: scoresData.course.sectionName, subject: scoresData.course.subject },
          { schoolYear: classAssignment.schoolYear, sectionName: classAssignment.section?.name, subjectName: classAssignment.subject?.name },
        );

        await prisma.classAssignment.update({ where: { id: classAssignmentId }, data: { aimsCourseId } });
        syncCache.set(`aims:course:${aimsCourseId}`, scoresData.course, 3600_000);
        syncCache.set(`aims:weights:${aimsCourseId}`, scoresData.weights, 3600_000);

        const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
        if (user) {
          await createAuditLog(
            AuditAction.UPDATE,
            { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
            `AIMS Course Link: ${classAssignment.subject?.name} — ${classAssignment.section?.name}`,
            "Grades", `Linked AIMS course ${aimsCourseId} to class assignment ${classAssignmentId}`,
            req.ip as string, AuditSeverity.INFO, classAssignmentId,
          );
        }

        // P2-1: Trigger immediate single-course sync (not full cycle)
        import("../../lib/aimsScoreSync").then(({ syncAimsScoresForAssignment }) => {
          syncAimsScoresForAssignment(classAssignmentId).catch((err: any) => logger.warn(`[AIMS Link] Immediate sync failed: ${err.message}`));
        });

        res.json({ success: true, warnings });
      } catch (error) {
        logger.error("Error linking AIMS course:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // DELETE /aims-link/:classAssignmentId
  router.delete(
    "/aims-link/:classAssignmentId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const classAssignmentId = String(req.params.classAssignmentId);

        const teacher = await prisma.teacher.findUnique({ where: { userId: req.user?.id } });
        if (!teacher) { res.status(404).json({ message: "Teacher profile not found" }); return; }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: { id: classAssignmentId, teacherId: teacher.id },
          include: { section: { select: { name: true } }, subject: { select: { name: true } } },
        });
        if (!classAssignment) { res.status(403).json({ message: "Not authorized for this class" }); return; }

        await prisma.classAssignment.update({ where: { id: classAssignmentId }, data: { aimsCourseId: null } });

        const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
        if (user) {
          await createAuditLog(
            AuditAction.UPDATE,
            { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
            `AIMS Course Unlink: ${classAssignment.subject?.name} — ${classAssignment.section?.name}`,
            "Grades", `Unlinked AIMS course from class assignment ${classAssignmentId}`,
            req.ip as string, AuditSeverity.INFO, classAssignmentId,
          );
        }

        res.json({ success: true });
      } catch (error) {
        logger.error("Error unlinking AIMS course:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // POST /aims-import/:classAssignmentId  (body: { term, assessmentIds? })
  router.post(
    "/aims-import/:classAssignmentId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(aimsImportSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const classAssignmentId = String(req.params.classAssignmentId);
        const { term, assessmentIds } = req.body as { term: Term; assessmentIds?: string[] };

        const teacher = await prisma.teacher.findUnique({ where: { userId: req.user?.id } });
        if (!teacher) { res.status(404).json({ message: "Teacher profile not found" }); return; }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: { id: classAssignmentId, teacherId: teacher.id },
          include: { subject: true, section: true },
        });
        if (!classAssignment) { res.status(403).json({ message: "Not authorized for this class" }); return; }

        if (classAssignment.isActive === false) {
          res.status(403).json({
            code: 'ASSIGNMENT_ARCHIVED',
            message: classAssignment.archivedReason === 'ATLAS_REASSIGNED'
              ? 'This class was transferred to another teacher.'
              : 'This class assignment is no longer active.',
          });
          return;
        }

        if (isHomeroomGuidanceSubjectCode(classAssignment.subject.code)) {
          res.status(400).json({ message: "Cannot import grades for HG." }); return;
        }

        const sampleGrade = await prisma.grade.findFirst({
          where: { classAssignmentId, term }, select: { isArchived: true },
        });
        const lockBlock = await checkGradeEditLocks({
          teacherUserId: teacher.userId, schoolYearLabel: classAssignment.schoolYear,
          term, isArchived: sampleGrade?.isArchived ?? false,
        });
        if (lockBlock) { res.status(403).json({ code: lockBlock.code, message: lockBlock.message }); return; }

        const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
        const currentTerm = await resolveCurrentTerm();
        const currentTermNum = termOrder[currentTerm] ?? 1;
        const requestTermNum = termOrder[term] ?? 0;
        if (requestTermNum > 0 && requestTermNum !== currentTermNum) {
          const editRequest = await prisma.gradeEditRequest.findFirst({
            where: { teacherId: teacher.userId, term, status: "APPROVED", expiresAt: { gt: new Date() } },
          });
          if (!editRequest) {
            const relation = requestTermNum < currentTermNum ? "past" : "future";
            res.status(403).json({ message: `Cannot edit grades for ${term} (${relation} term).` }); return;
          }
        }

        // Delegate to lib (guards above, data work below)
        const result = await importAimsScoresToGrades({
          classAssignmentId,
          term,
          assessmentIds,
          teacherId: teacher.id,
          teacherUserId: teacher.userId,
        });

        res.json(result);
      } catch (error) {
        logger.error("Error importing AIMS scores:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // POST /aims-sync/:classAssignmentId — "Refresh from AIMS" button
  // In-memory 60s per-class cooldown
  const syncCooldowns = new Map<string, number>();
  const COOLDOWN_MS = 60_000;

  router.post(
    "/aims-sync/:classAssignmentId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const classAssignmentId = String(req.params.classAssignmentId);

        // Cooldown check
        const lastSync = syncCooldowns.get(classAssignmentId) ?? 0;
        if (Date.now() - lastSync < COOLDOWN_MS) {
          res.status(429).json({ message: "Synced recently — try again in a moment" });
          return;
        }

        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });
        if (!teacher) { res.status(404).json({ message: "Teacher profile not found" }); return; }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: { id: classAssignmentId, teacherId: teacher.id },
          select: { aimsCourseId: true },
        });
        if (!classAssignment) { res.status(403).json({ message: "Not authorized for this class" }); return; }

        if (!classAssignment.aimsCourseId) {
          res.status(400).json({ message: "No AIMS course linked" });
          return;
        }

        // Set cooldown before sync to prevent concurrent hammering
        syncCooldowns.set(classAssignmentId, Date.now());

        const { syncAimsScoresForAssignment } = await import("../../lib/aimsScoreSync");
        const result = await syncAimsScoresForAssignment(classAssignmentId);

        res.json({
          status: 'ok' as const,
          scoresUpserted: result.scoresUpserted,
          unmatchedCount: result.unmatched.length,
        });
      } catch (error) {
        logger.error("Error syncing AIMS scores:", error);
        // Fail-soft: AIMS offline is a known state, not a 500
        res.json({
          status: 'offline' as const,
          scoresUpserted: 0,
          unmatchedCount: 0,
        });
      }
    }
  );
}
