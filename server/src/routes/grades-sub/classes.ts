import { Router, Response } from "express";
import { AuditAction, AuditSeverity, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../../middleware/auth";
import { createAuditLog } from "../../lib/audit";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { validate } from "../../middleware/validate";
import {
  gradeSaveSchema,
  gradeDeleteSchema,
  clearScoresSchema,
  classAssignmentDeleteSchema,
  batchGradeSaveSchema,
} from "../../schemas/grades";
import {
  EnrollmentWithStudent,
  GradeRecord,
  resolveCurrentTerm,
  resolveEffectiveWeightsForClassAssignment,
  isHomeroomGuidanceSubjectCode,
  calculateGrades,
  createGradeSnapshot,
  getPredecessorGradeBase,
} from "./helpers";
import { checkGradeEditLocks, getGradeLockState } from "../../lib/gradeLocks";
import { computeExamPS } from "../../lib/examMath";

export default function registerClasses(router: Router): void {
  // Get all class assignments for the logged-in teacher
  router.get(
    "/my-classes",
    authenticateToken,
    authorizeRoles("TEACHER"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });

        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const currentSchoolYear = await getActiveSchoolYearLabel();

        const classes = await prisma.classAssignment.findMany({
          where: {
            teacherId: teacher.id,
            schoolYear: currentSchoolYear,
          },
          include: {
            subject: true,
            section: {
              include: {
                enrollments: {
                  where: {
                    status: 'ENROLLED',
                    schoolYear: currentSchoolYear,
                  },
                  include: {
                    student: true,
                  },
                  orderBy: {
                    student: {
                      lastName: "asc",
                    },
                  },
                },
              },
            },
          },
          orderBy: [
            { isActive: 'desc' },
            { section: { gradeLevel: "asc" } },
            { subject: { name: "asc" } },
          ],
        });

        const filteredClasses = classes.filter(
          (ca: any) => !isHomeroomGuidanceSubjectCode(ca.subject.code)
        );

        const classesWithEffectiveWeights = await Promise.all(
          filteredClasses.map(async (classAssignment: any) => {
            const effectiveWeights = await resolveEffectiveWeightsForClassAssignment(classAssignment.id);
            return {
              ...classAssignment,
              effectiveWeights,
            };
          })
        );

        // Resolve successor teacher names for archived classes
        const archivedWithSuccessor = classesWithEffectiveWeights.filter((c: any) => !c.isActive && c.successorTeacherId);
        if (archivedWithSuccessor.length > 0) {
          const sIds = [...new Set(archivedWithSuccessor.map((c: any) => c.successorTeacherId))] as string[];
          const sTeachers = await prisma.teacher.findMany({
            where: { id: { in: sIds } },
            include: { user: { select: { firstName: true, lastName: true } } },
          });
          const sMap = new Map(sTeachers.map(t => [t.id, `${t.user.firstName} ${t.user.lastName}`]));
          for (const c of classesWithEffectiveWeights) {
            if (c.successorTeacherId) {
              (c as any).successorTeacherName = sMap.get(c.successorTeacherId) ?? null;
            }
          }
        }

        res.json(classesWithEffectiveWeights);
      } catch (error) {
        logger.error("Error fetching classes:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // Get class record (all students with grades) for a specific class assignment
  router.get(
    "/class-record/:classAssignmentId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const classAssignmentId = req.params.classAssignmentId as string;
        const { term } = req.query;

        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });

        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: {
            id: classAssignmentId,
            teacherId: teacher.id,
          },
          include: {
            subject: true,
            section: true,
          },
        });

        if (!classAssignment) {
          res.status(404).json({ message: "Class assignment not found" });
          return;
        }

        // Resolve successor teacher name if this is a transferred assignment
        let successorTeacherName: string | null = null;
        if ((classAssignment as any).successorTeacherId) {
          const successor = await prisma.teacher.findUnique({
            where: { id: (classAssignment as any).successorTeacherId },
            include: { user: { select: { firstName: true, lastName: true } } },
          });
          if (successor) successorTeacherName = `${successor.user.firstName} ${successor.user.lastName}`;
        }

        const enrollments = await prisma.enrollment.findMany({
          where: {
            sectionId: classAssignment.sectionId,
            schoolYear: classAssignment.schoolYear,
            status: 'ENROLLED',
          },
          include: {
            student: true,
          },
          orderBy: {
            student: {
              lastName: "asc",
            },
          },
        });

        const grades = await prisma.grade.findMany({
          where: {
            classAssignmentId,
            ...(term ? { term: term as any } : {}),
          },
        });

        const classRecord = enrollments.map((enrollment: EnrollmentWithStudent) => {
          const studentGrades = grades.filter(
            (g: GradeRecord) => g.studentId === enrollment.studentId
          );
          return {
            student: enrollment.student,
            grades: studentGrades,
          };
        });

        const effectiveWeights = await resolveEffectiveWeightsForClassAssignment(classAssignmentId);
        const currentTerm = await resolveCurrentTerm();
        const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
        const lockState = await getGradeLockState(classAssignment.schoolYear);
        const queriedTermLocked = term ? lockState.termLocks[term as keyof typeof lockState.termLocks] : false;

        // Inherited grades: find predecessor assignments (same subject+section+SY, archived, with grades)
        const predecessorAssignments = await prisma.classAssignment.findMany({
          where: {
            subjectId: classAssignment.subjectId,
            sectionId: classAssignment.sectionId,
            schoolYear: classAssignment.schoolYear,
            isActive: false,
            id: { not: classAssignmentId },
            grades: { some: {} },
          },
          include: {
            teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
          },
        });

        const predecessorIds = predecessorAssignments.map(p => p.id);
        const predecessorGrades = predecessorIds.length > 0
          ? await prisma.grade.findMany({
              where: { classAssignmentId: { in: predecessorIds } },
            })
          : [];

        // Build per-predecessor name map
        const predecessorNameMap = new Map(predecessorAssignments.map(p => [p.id, `${p.teacher.user.firstName} ${p.teacher.user.lastName}`]));

        // Build inheritedGrades: per student per term — only for (student, term) where current assignment has NO grade
        const currentGradeKeys = new Set(grades.map((g: any) => `${g.studentId}:${g.term}`));
        const inheritedGrades: Array<{
          studentId: string;
          term: string;
          quarterlyGrade: number | null;
          inheritedFrom: string;
          classAssignmentId: string;
        }> = [];

        // For multiple predecessors, prefer the most recent archivedAt per (student, term)
        const predecessorArchivedAtMap = new Map(predecessorAssignments.map(p => [p.id, p.archivedAt?.getTime() ?? 0]));
        const candidateMap = new Map<string, typeof predecessorGrades[0]>();
        for (const pg of predecessorGrades) {
          const key = `${pg.studentId}:${pg.term}`;
          if (currentGradeKeys.has(key)) continue; // current assignment has a grade for this student+term
          const existing = candidateMap.get(key);
          if (!existing) {
            candidateMap.set(key, pg);
          } else {
            // Prefer the one from the most recently archived predecessor
            const existingTime = predecessorArchivedAtMap.get(existing.classAssignmentId) ?? 0;
            const newTime = predecessorArchivedAtMap.get(pg.classAssignmentId) ?? 0;
            if (newTime > existingTime) candidateMap.set(key, pg);
          }
        }

        for (const [, pg] of candidateMap) {
          const { classAssignmentId: _predCA, ...gradeFields } = pg as any;
          inheritedGrades.push({
            studentId: pg.studentId,
            term: pg.term,
            quarterlyGrade: pg.quarterlyGrade,
            inheritedFrom: predecessorNameMap.get(pg.classAssignmentId) ?? 'Unknown',
            classAssignmentId: pg.classAssignmentId,
            ...gradeFields,
          });
        }

        const inheritedFromTeachers = predecessorAssignments.map(p => ({
          name: predecessorNameMap.get(p.id) ?? 'Unknown',
          termsCovered: [...new Set(predecessorGrades.filter(g => g.classAssignmentId === p.id).map(g => g.term))],
        }));

        // Rotation siblings: other class assignments in the same section + rotation group
        let rotationSiblings: Array<{
          classAssignmentId: string;
          subjectName: string;
          term: string;
          isMine: boolean;
          teacherName: string;
        }> | null = null;

        const rotationGroupId = (classAssignment.subject as any).rotationTermGroupId as string | null;
        if (rotationGroupId) {
          const siblings = await prisma.classAssignment.findMany({
            where: {
              sectionId: classAssignment.sectionId,
              schoolYear: classAssignment.schoolYear,
              isActive: true,
              id: { not: classAssignmentId },
              subject: { rotationTermGroupId: rotationGroupId },
            },
            include: {
              subject: { select: { name: true, rotationTermRank: true } },
              teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
            },
          });
          rotationSiblings = siblings.map(s => ({
            classAssignmentId: s.id,
            subjectName: s.subject.name,
            term: `T${(s.subject as any).rotationTermRank}`,
            isMine: s.teacherId === teacher.id,
            teacherName: `${(s as any).teacher.user.firstName} ${(s as any).teacher.user.lastName}`,
          }));
        }

        res.json({
          classAssignment,
          classRecord,
          effectiveWeights,
          currentTerm,
          termDates: {
            t1StartDate: systemSettings?.t1StartDate,
            t1EndDate: systemSettings?.t1EndDate,
            t2StartDate: systemSettings?.t2StartDate,
            t2EndDate: systemSettings?.t2EndDate,
            t3StartDate: systemSettings?.t3StartDate,
            t3EndDate: systemSettings?.t3EndDate,
            derived: systemSettings?.termDatesDerived ?? false,
          },
          gradeLock: lockState.systemLocked || lockState.yearLocked || queriedTermLocked,
          locks: lockState,
          inheritedGrades,
          inheritedFromTeachers,
          successorTeacherName,
          rotationSiblings,
        });
      } catch (error) {
        logger.error("Error fetching class record:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // Create or update grade for a student
  router.post(
    "/grade",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(gradeSaveSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const {
          studentId,
          classAssignmentId,
          term,
          writtenWorkScores,
          perfTaskScores,
          examScores,
          quarterlyAssessScore,
          quarterlyAssessMax,
          qaDescription,
          qaDate,
        } = req.body;

        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });

        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: {
            id: classAssignmentId,
            teacherId: teacher.id,
          },
          include: {
            subject: true,
            section: true,
          },
        });

        if (!classAssignment) {
          res.status(403).json({ message: "Not authorized for this class" });
          return;
        }

        if (classAssignment.isActive === false) {
          res.status(403).json({
            code: 'ASSIGNMENT_ARCHIVED',
            message: classAssignment.archivedReason === 'ATLAS_REASSIGNED'
              ? 'This class was transferred to another teacher. You can view grades but no longer edit them.'
              : 'This class assignment is no longer active and cannot be edited.',
          });
          return;
        }

        const enrollment = await prisma.enrollment.findFirst({
          where: { studentId, sectionId: classAssignment.sectionId, schoolYear: classAssignment.schoolYear },
        });
        if (enrollment && (enrollment.status === "DROPPED" || enrollment.status === "TRANSFERRED")) {
          const parts: string[] = [`Student is ${enrollment.status.toLowerCase()}`];
          if (enrollment.status === "DROPPED" && enrollment.dropOutDate) parts.push(`since ${new Date(enrollment.dropOutDate).toLocaleDateString()}`);
          if (enrollment.status === "TRANSFERRED" && enrollment.transferOutDate) parts.push(`since ${new Date(enrollment.transferOutDate).toLocaleDateString()}`);
          if (enrollment.dropOutReason) parts.push(`(${enrollment.dropOutReason})`);
          res.status(403).json({ code: "ENROLLMENT_INACTIVE", message: `Cannot edit grades: ${parts.join(" ")}.` });
          return;
        }

        const existingGrade = await prisma.grade.findFirst({ where: { studentId, classAssignmentId, term } });

        const lockBlock = await checkGradeEditLocks({
          teacherUserId: teacher.userId,
          schoolYearLabel: classAssignment.schoolYear,
          term: term as any,
          isArchived: existingGrade?.isArchived ?? false,
        });
        if (lockBlock) {
          res.status(403).json({ code: lockBlock.code, message: lockBlock.message });
          return;
        }

        const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
        const currentTerm = await resolveCurrentTerm();
        const currentTermNum = termOrder[currentTerm] ?? 1;
        const requestTermNum = termOrder[term as string] ?? 0;
        if (requestTermNum > 0 && requestTermNum !== currentTermNum) {
          let hasEditAccess = false;
          if (teacher) {
            const editRequest = await prisma.gradeEditRequest.findFirst({
              where: {
                teacherId: teacher.userId,
                term: term as string,
                status: "APPROVED",
                expiresAt: { gt: new Date() },
              },
            });
            hasEditAccess = !!editRequest;
          }
          if (!hasEditAccess) {
            const relation = requestTermNum < currentTermNum ? "past" : "future";
            res.status(403).json({
              message: `Cannot edit grades for ${term} (${relation} term). The current term is ${currentTerm}. Only current term grades can be edited.`,
            });
            return;
          }
        }

        const isHG = isHomeroomGuidanceSubjectCode(classAssignment.subject.code);
        if (isHG) {
          res.status(400).json({ message: "Homeroom Guidance is a location, not a subject. Cannot save grades for HG." });
          return;
        }

        let writtenWorkPS: number | null = null;
        let perfTaskPS: number | null = null;
        let quarterlyAssessPS: number | null = null;
        let initialGrade: number | null = null;
        let quarterlyGrade: number | null = null;

        if (existingGrade?.status === "FINALIZED") {
          res.status(403).json({ message: "Grade is finalized and cannot be edited. Contact registrar to unfinalize." });
          return;
        }

        const seedGrade = existingGrade ?? await getPredecessorGradeBase(classAssignment, studentId, term);

        const mergedWrittenWorkScores = (writtenWorkScores !== undefined
              ? writtenWorkScores
              : (seedGrade?.writtenWorkScores as Array<{ name: string; score: number; maxScore: number }> | null)) ?? null;

        const mergedPerfTaskScores = (perfTaskScores !== undefined
              ? perfTaskScores
              : (seedGrade?.perfTaskScores as Array<{ name: string; score: number; maxScore: number }> | null)) ?? null;

        let mergedExamScores = (examScores !== undefined
              ? examScores
              : (seedGrade?.examScores as Array<{ name: string; score: number; maxScore: number }> | null)) ?? null;

        // A composite-only save (e.g. mobile TA tab) supersedes any stored breakdown.
        if (quarterlyAssessScore !== undefined && examScores === undefined) {
          mergedExamScores = null;
        }

        let mergedQuarterlyAssessScore = (quarterlyAssessScore !== undefined
              ? quarterlyAssessScore
              : (seedGrade?.quarterlyAssessScore ?? 0));

        let mergedQuarterlyAssessMax = (quarterlyAssessMax !== undefined
              ? quarterlyAssessMax
              : (seedGrade?.quarterlyAssessMax ?? 100));

        // When the detailed ST1/ST2/TE breakdown is supplied, derive the composite
        // Examinations PS (0–100) from it. Existing composite-only saves are unchanged.
        if (examScores !== undefined && mergedExamScores && mergedExamScores.length > 0) {
          const examPS = computeExamPS(mergedExamScores);
          if (examPS !== null) {
            mergedQuarterlyAssessScore = examPS;
            mergedQuarterlyAssessMax = 100;
          }
        }

        const mergedQaDescription = (qaDescription !== undefined
              ? qaDescription
              : (seedGrade?.qaDescription ?? null));

        const mergedQaDate = (qaDate !== undefined
              ? qaDate
              : (seedGrade?.qaDate ?? null));

        const effectiveWeights = await resolveEffectiveWeightsForClassAssignment(classAssignmentId);
        const calculated = await calculateGrades(
            mergedWrittenWorkScores,
            mergedPerfTaskScores,
            mergedQuarterlyAssessScore,
            mergedQuarterlyAssessMax || 100,
            effectiveWeights.ww,
            effectiveWeights.pt,
            effectiveWeights.qa
          );
          writtenWorkPS = calculated.writtenWorkPS;
          perfTaskPS = calculated.perfTaskPS;
          quarterlyAssessPS = calculated.quarterlyAssessPS;
          initialGrade = calculated.initialGrade;
          quarterlyGrade = calculated.quarterlyGrade;

        const gradePayload = {
            writtenWorkScores: mergedWrittenWorkScores,
            perfTaskScores: mergedPerfTaskScores,
            examScores: mergedExamScores,
            quarterlyAssessScore: mergedQuarterlyAssessScore,
            quarterlyAssessMax: mergedQuarterlyAssessMax,
            qaDescription: mergedQaDescription,
            qaDate: mergedQaDate,
              writtenWorkPS,
              perfTaskPS,
              quarterlyAssessPS,
              initialGrade,
              quarterlyGrade,
              qualitativeDescriptor: null,
            };

        const grade = await prisma.grade.upsert({
          where: {
            studentId_classAssignmentId_term: {
              studentId,
              classAssignmentId,
              term,
            },
          },
          update: gradePayload,
          create: {
            studentId,
            classAssignmentId,
            term,
            ...gradePayload,
          },
        });

        const student = await prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true } });
        const teacherUser = await prisma.user.findUnique({ where: { id: req.user?.id }, select: { id: true, firstName: true, lastName: true, role: true } });
        const isNew = !existingGrade;
        if (teacherUser) {
          await createGradeSnapshot({
            gradeId: grade.id,
            studentId: grade.studentId,
            classAssignmentId: grade.classAssignmentId,
            teacherId: teacher.id,
            subjectCode: classAssignment.subject.code,
            subjectName: classAssignment.subject.name,
            sectionId: classAssignment.sectionId,
            sectionName: classAssignment.section.name,
            schoolYear: classAssignment.schoolYear,
            term: grade.term,
            snapshot: {
              writtenWorkScores: grade.writtenWorkScores,
              perfTaskScores: grade.perfTaskScores,
              quarterlyAssessScore: grade.quarterlyAssessScore,
              quarterlyAssessMax: grade.quarterlyAssessMax,
              qaDescription: grade.qaDescription,
              qaDate: grade.qaDate,
              writtenWorkPS: grade.writtenWorkPS,
              perfTaskPS: grade.perfTaskPS,
              quarterlyAssessPS: grade.quarterlyAssessPS,
              initialGrade: grade.initialGrade,
              quarterlyGrade: grade.quarterlyGrade,
              qualitativeDescriptor: grade.qualitativeDescriptor,
            },
          });

          await createAuditLog(
            isNew ? AuditAction.CREATE : AuditAction.UPDATE,
            { id: teacherUser.id, firstName: teacherUser.firstName, lastName: teacherUser.lastName, role: teacherUser.role },
            `Grade: ${student?.firstName || ""} ${student?.lastName || ""} — ${classAssignment.subject.name} (${term})`,
            "Grades",
            `${isNew ? "Recorded" : "Updated"} grade for ${student?.firstName || ""} ${student?.lastName || ""} in ${classAssignment.subject.name} (${term}): ${quarterlyGrade}`,
            (req.ip as string) || req.socket?.remoteAddress,
            AuditSeverity.INFO,
            grade.id
          );
        }

        res.json(grade);
      } catch (error) {
        logger.error("Error saving grade:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // Batch save grades for multiple students
  router.post(
    "/grade/batch",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(batchGradeSaveSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { classAssignmentId, term, updates } = req.body;

        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });
        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: { id: classAssignmentId, teacherId: teacher.id },
          include: { subject: true, section: true },
        });
        if (!classAssignment) {
          res.status(403).json({ message: "Not authorized for this class" });
          return;
        }

        if (classAssignment.isActive === false) {
          res.status(403).json({
            code: 'ASSIGNMENT_ARCHIVED',
            message: classAssignment.archivedReason === 'ATLAS_REASSIGNED'
              ? 'This class was transferred to another teacher. You can view grades but no longer edit them.'
              : 'This class assignment is no longer active and cannot be edited.',
          });
          return;
        }

        const isHG = isHomeroomGuidanceSubjectCode(classAssignment.subject.code);
        if (isHG) {
          res.status(400).json({ message: "Homeroom Guidance is a location, not a subject. Cannot save grades for HG." });
          return;
        }

        // Class-level lock check (uses first existing grade's archived state)
        const sampleGrade = await prisma.grade.findFirst({
          where: { classAssignmentId, term },
          select: { isArchived: true },
        });
        const lockBlock = await checkGradeEditLocks({
          teacherUserId: teacher.userId,
          schoolYearLabel: classAssignment.schoolYear,
          term: term as any,
          isArchived: sampleGrade?.isArchived ?? false,
        });
        if (lockBlock) {
          res.status(403).json({ code: lockBlock.code, message: lockBlock.message });
          return;
        }

        // Current-term check with APPROVED edit-request bypass
        const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
        const currentTerm = await resolveCurrentTerm();
        const currentTermNum = termOrder[currentTerm] ?? 1;
        const requestTermNum = termOrder[term as string] ?? 0;
        if (requestTermNum > 0 && requestTermNum !== currentTermNum) {
          let hasEditAccess = false;
          const editRequest = await prisma.gradeEditRequest.findFirst({
            where: {
              teacherId: teacher.userId,
              term: term as string,
              status: "APPROVED",
              expiresAt: { gt: new Date() },
            },
          });
          hasEditAccess = !!editRequest;
          if (!hasEditAccess) {
            const relation = requestTermNum < currentTermNum ? "past" : "future";
            res.status(403).json({
              message: `Cannot edit grades for ${term} (${relation} term). The current term is ${currentTerm}. Only current term grades can be edited.`,
            });
            return;
          }
        }

        const effectiveWeights = await resolveEffectiveWeightsForClassAssignment(classAssignmentId);
        const skipped: Array<{ studentId: string; reason: string }> = [];

        // Pre-check: gather enrollments and existing grades
        const studentIds = updates.map((u: any) => u.studentId);
        const [enrollments, existingGrades] = await Promise.all([
          prisma.enrollment.findMany({
            where: { studentId: { in: studentIds }, sectionId: classAssignment.sectionId, schoolYear: classAssignment.schoolYear },
          }),
          prisma.grade.findMany({
            where: { studentId: { in: studentIds }, classAssignmentId, term },
          }),
        ]);

        const enrollmentMap = new Map(enrollments.map((e: any) => [e.studentId, e]));
        const gradeMap = new Map(existingGrades.map((g: any) => [g.studentId, g]));

        // Seed from predecessor for students without own grades
        const studentIdsNeedingSeed = studentIds.filter((sid: string) => !gradeMap.has(sid));
        const seedMap = new Map<string, any>();
        if (studentIdsNeedingSeed.length > 0) {
          const predAssignments = await prisma.classAssignment.findMany({
            where: {
              subjectId: classAssignment.subjectId,
              sectionId: classAssignment.sectionId,
              schoolYear: classAssignment.schoolYear,
              isActive: false,
              id: { not: classAssignmentId },
              grades: { some: {} },
            },
            select: { id: true, archivedAt: true },
            orderBy: { archivedAt: 'desc' },
          });
          if (predAssignments.length > 0) {
            const predIds = predAssignments.map((p: any) => p.id);
            const predGrades = await prisma.grade.findMany({
              where: { classAssignmentId: { in: predIds }, studentId: { in: studentIdsNeedingSeed }, term },
              orderBy: { classAssignment: { archivedAt: 'desc' } },
            });
            for (const pg of predGrades) {
              if (!seedMap.has(pg.studentId)) seedMap.set(pg.studentId, pg);
            }
          }
        }

        // Filter out students that should be skipped
        const validUpdates = updates.filter((update: any) => {
          const enrollment = enrollmentMap.get(update.studentId);
          if (enrollment && (enrollment.status === "DROPPED" || enrollment.status === "TRANSFERRED")) {
            skipped.push({ studentId: update.studentId, reason: `Student is ${enrollment.status.toLowerCase()}` });
            return false;
          }
          const existing = gradeMap.get(update.studentId);
          if (existing?.status === "FINALIZED") {
            skipped.push({ studentId: update.studentId, reason: "Grade is finalized" });
            return false;
          }
          if (existing?.isArchived) {
            skipped.push({ studentId: update.studentId, reason: "Grade is archived" });
            return false;
          }
          return true;
        });

        // Transaction: upsert all valid updates
        await prisma.$transaction(async (tx) => {
          for (const update of validUpdates) {
            const existing = gradeMap.get(update.studentId) ?? seedMap.get(update.studentId);

            const mergedWrittenWorkScores = update.writtenWorkScores !== undefined
              ? update.writtenWorkScores
              : (existing?.writtenWorkScores as any[] ?? null);
            const mergedPerfTaskScores = update.perfTaskScores !== undefined
              ? update.perfTaskScores
              : (existing?.perfTaskScores as any[] ?? null);
            let mergedExamScores = update.examScores !== undefined
              ? update.examScores
              : (existing?.examScores as any[] ?? null);
            if (update.quarterlyAssessScore !== undefined && update.examScores === undefined) {
              mergedExamScores = null;
            }
            let mergedQuarterlyAssessScore = update.quarterlyAssessScore !== undefined
              ? update.quarterlyAssessScore
              : (existing?.quarterlyAssessScore ?? 0);
            let mergedQuarterlyAssessMax = update.quarterlyAssessMax !== undefined
              ? update.quarterlyAssessMax
              : (existing?.quarterlyAssessMax ?? 100);
            if (update.examScores !== undefined && mergedExamScores && mergedExamScores.length > 0) {
              const examPS = computeExamPS(mergedExamScores);
              if (examPS !== null) {
                mergedQuarterlyAssessScore = examPS;
                mergedQuarterlyAssessMax = 100;
              }
            }
            const mergedQaDescription = update.qaDescription !== undefined
              ? update.qaDescription
              : (existing?.qaDescription ?? null);
            const mergedQaDate = update.qaDate !== undefined
              ? update.qaDate
              : (existing?.qaDate ?? null);

            const calculated = await calculateGrades(
              mergedWrittenWorkScores,
              mergedPerfTaskScores,
              mergedQuarterlyAssessScore,
              mergedQuarterlyAssessMax || 100,
              effectiveWeights.ww,
              effectiveWeights.pt,
              effectiveWeights.qa
            );

            const gradePayload = {
              writtenWorkScores: mergedWrittenWorkScores,
              perfTaskScores: mergedPerfTaskScores,
              examScores: mergedExamScores,
              quarterlyAssessScore: mergedQuarterlyAssessScore,
              quarterlyAssessMax: mergedQuarterlyAssessMax,
              qaDescription: mergedQaDescription,
              qaDate: mergedQaDate,
              writtenWorkPS: calculated.writtenWorkPS,
              perfTaskPS: calculated.perfTaskPS,
              quarterlyAssessPS: calculated.quarterlyAssessPS,
              initialGrade: calculated.initialGrade,
              quarterlyGrade: calculated.quarterlyGrade,
              qualitativeDescriptor: null,
            };

            await tx.grade.upsert({
              where: {
                studentId_classAssignmentId_term: {
                  studentId: update.studentId,
                  classAssignmentId,
                  term,
                },
              },
              update: gradePayload,
              create: {
                studentId: update.studentId,
                classAssignmentId,
                term,
                ...gradePayload,
              },
            });
          }
        });

        // One summary audit row per batch save (never one row per student).
        if (validUpdates.length > 0) {
          const batchUser = await prisma.user.findUnique({
            where: { id: req.user?.id },
            select: { id: true, firstName: true, lastName: true, role: true },
          });
          if (batchUser) {
            await createAuditLog(
              AuditAction.UPDATE,
              { id: batchUser.id, firstName: batchUser.firstName, lastName: batchUser.lastName, role: batchUser.role },
              `Grade batch: ${classAssignment.subject.name} (${term})`,
              "Grades",
              `Saved ${validUpdates.length} grade(s) for ${classAssignment.section.name} (${term})${skipped.length ? `, ${skipped.length} skipped` : ""}`,
              (req.ip as string) || req.socket?.remoteAddress,
              AuditSeverity.INFO,
              undefined,
              { savedCount: validUpdates.length, skippedCount: skipped.length, term }
            );
          }
        }

        res.json({
          savedCount: validUpdates.length,
          skipped,
        });
      } catch (error) {
        logger.error("Error batch saving grades:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // Delete a grade
  router.delete(
    "/grade/:gradeId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(gradeDeleteSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const gradeId = req.params.gradeId as string;

        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });

        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const grade = await prisma.grade.findUnique({
          where: { id: gradeId },
          include: {
            classAssignment: {
              include: {
                subject: { select: { name: true, code: true } },
                section: { select: { name: true } }
              }
            },
            student: { select: { firstName: true, lastName: true } },
          },
        });

        if (!grade || grade.classAssignment.teacherId !== teacher.id) {
          res.status(403).json({ message: "Not authorized" });
          return;
        }

        if (grade.classAssignment.isActive === false) {
          res.status(403).json({
            code: 'ASSIGNMENT_ARCHIVED',
            message: grade.classAssignment.archivedReason === 'ATLAS_REASSIGNED'
              ? 'This class was transferred to another teacher. You can view grades but no longer edit them.'
              : 'This class assignment is no longer active and cannot be edited.',
          });
          return;
        }

        if (grade.isArchived) {
          res.status(403).json({ message: "Cannot delete archived grades. This school year has been finalized." });
          return;
        }

        const lockBlock = await checkGradeEditLocks({
          teacherUserId: teacher.userId,
          schoolYearLabel: grade.classAssignment.schoolYear,
          term: grade.term,
        });
        if (lockBlock) {
          res.status(403).json({ code: lockBlock.code, message: lockBlock.message });
          return;
        }

        await createGradeSnapshot({
          gradeId: grade.id,
          studentId: grade.studentId,
          classAssignmentId: grade.classAssignmentId,
          teacherId: teacher.id,
          subjectCode: grade.classAssignment.subject.code,
          subjectName: grade.classAssignment.subject.name,
          sectionId: grade.classAssignment.sectionId,
          sectionName: grade.classAssignment.section.name,
          schoolYear: grade.classAssignment.schoolYear,
          term: grade.term,
          snapshot: {
            writtenWorkScores: grade.writtenWorkScores,
            perfTaskScores: grade.perfTaskScores,
            quarterlyAssessScore: grade.quarterlyAssessScore,
            quarterlyAssessMax: grade.quarterlyAssessMax,
            qaDescription: grade.qaDescription,
            qaDate: grade.qaDate,
            writtenWorkPS: grade.writtenWorkPS,
            perfTaskPS: grade.perfTaskPS,
            quarterlyAssessPS: grade.quarterlyAssessPS,
            initialGrade: grade.initialGrade,
            quarterlyGrade: grade.quarterlyGrade,
            qualitativeDescriptor: grade.qualitativeDescriptor,
          },
        });

        await prisma.grade.delete({
          where: { id: gradeId },
        });

        const teacherUser = await prisma.user.findUnique({ where: { id: req.user?.id }, select: { id: true, firstName: true, lastName: true, role: true } });
        if (teacherUser) {
          await createAuditLog(
            AuditAction.DELETE,
            { id: teacherUser.id, firstName: teacherUser.firstName, lastName: teacherUser.lastName, role: teacherUser.role },
            `Grade deleted: ${grade.student.firstName} ${grade.student.lastName} — ${grade.classAssignment.subject.name}`,
            "Grades",
            `Deleted grade for ${grade.student.firstName} ${grade.student.lastName} in ${grade.classAssignment.subject.name} (${grade.term})`,
            (req.ip as string) || req.socket?.remoteAddress,
            AuditSeverity.WARNING,
            gradeId
          );
        }

        res.json({ message: "Grade deleted successfully" });
      } catch (error) {
        logger.error("Error deleting grade:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // Clear all scores for a class assignment and specific quarter
  router.post(
    "/clear-scores",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(clearScoresSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { classAssignmentId, term } = req.body;

        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });

        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: {
            id: classAssignmentId,
            teacherId: teacher.id,
          },
          include: {
            subject: true,
            section: true,
          },
        });

        if (!classAssignment) {
          res.status(403).json({ message: "Not authorized for this class" });
          return;
        }

        if (classAssignment.isActive === false) {
          res.status(403).json({
            code: 'ASSIGNMENT_ARCHIVED',
            message: classAssignment.archivedReason === 'ATLAS_REASSIGNED'
              ? 'This class was transferred to another teacher. You can view grades but no longer edit them.'
              : 'This class assignment is no longer active and cannot be edited.',
          });
          return;
        }

        const archivedCount = await prisma.grade.count({
          where: {
            classAssignmentId,
            term,
            isArchived: true,
          },
        });

        if (archivedCount > 0) {
          res.status(403).json({
            message: "Cannot clear scores: some grades are archived and must be preserved.",
            archivedCount,
          });
          return;
        }

        const lockBlock = await checkGradeEditLocks({
          teacherUserId: teacher.userId,
          schoolYearLabel: classAssignment.schoolYear,
          term: term as any,
        });
        if (lockBlock) {
          res.status(403).json({ code: lockBlock.code, message: lockBlock.message });
          return;
        }

        const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
        const currentTerm = await resolveCurrentTerm();
        const currentTermNum = termOrder[currentTerm] ?? 1;
        const requestTermNum = termOrder[term as string] ?? 0;
        if (requestTermNum > 0 && requestTermNum !== currentTermNum) {
          let hasEditAccess = false;
          if (teacher) {
            const editRequest = await prisma.gradeEditRequest.findFirst({
              where: {
                teacherId: teacher.userId,
                term: term as string,
                status: "APPROVED",
                expiresAt: { gt: new Date() },
              },
            });
            hasEditAccess = !!editRequest;
          }
          if (!hasEditAccess) {
            const relation = requestTermNum < currentTermNum ? "past" : "future";
            res.status(403).json({
              message: `Cannot clear scores for ${term} (${relation} term). The current term is ${currentTerm}. Only current term scores can be cleared.`,
            });
            return;
          }
        }

        const finalizedCount = await prisma.grade.count({
          where: {
            classAssignmentId,
            term,
            status: "FINALIZED",
          },
        });

        if (finalizedCount > 0) {
          res.status(403).json({
            message: "Cannot clear scores: some grades are finalized. Contact registrar to unfinalize first.",
            finalizedCount,
          });
          return;
        }

        const { count } = await prisma.grade.deleteMany({
          where: {
            classAssignmentId,
            term,
          },
        });

        // Reset importedAt on AimsScore staging rows so re-import is self-service
        const { count: resetCount } = await prisma.aimsScore.updateMany({
          where: {
            classAssignmentId,
            term: term as any,
            importedAt: { not: null },
          },
          data: { importedAt: null },
        });

        const teacherUser = await prisma.user.findUnique({
          where: { id: req.user?.id },
          select: { id: true, firstName: true, lastName: true, role: true },
        });

        if (teacherUser) {
          await createAuditLog(
            AuditAction.DELETE,
            { id: teacherUser.id, firstName: teacherUser.firstName, lastName: teacherUser.lastName, role: teacherUser.role },
            `Clear Scores: ${classAssignment.subject.name} (${term})`,
            "Grades",
            `Cleared all (${count}) grades for ${classAssignment.subject.name} in section ${classAssignment.section.name} for ${term}${resetCount > 0 ? ` — reset ${resetCount} AIMS staging rows for re-import` : ""}`,
            (req.ip as string) || req.socket?.remoteAddress,
            AuditSeverity.WARNING
          );
        }

        res.json({ message: `Successfully cleared all scores for ${term}`, count });
      } catch (error) {
        logger.error("Error clearing scores:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // Delete all archived class assignments for the current teacher
  router.delete(
    "/class-assignments/archived/all",
    authenticateToken,
    authorizeRoles("TEACHER"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });

        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const archivedAssignments = await prisma.classAssignment.findMany({
          where: {
            teacherId: teacher.id,
            isActive: false,
          },
          include: {
            subject: true,
            section: true,
          },
        });

        if (archivedAssignments.length === 0) {
          res.status(404).json({ message: "No archived assignments found to delete" });
          return;
        }

        const assignmentIds = archivedAssignments.map(a => a.id);
        const gradeCounts = await prisma.grade.groupBy({
          by: ['classAssignmentId'],
          where: { classAssignmentId: { in: assignmentIds } },
          _count: { id: true }
        });
        const assignmentsWithGrades = new Set(gradeCounts.map(g => g.classAssignmentId));

        const safeToDelete = archivedAssignments.filter(a => !assignmentsWithGrades.has(a.id));
        const blockedCount = archivedAssignments.length - safeToDelete.length;

        if (safeToDelete.length === 0) {
          res.status(400).json({
            message: `Cannot delete archived assignments: ${blockedCount} have grades that must be preserved for student records (SF10).`,
            blockedCount,
            totalArchived: archivedAssignments.length
          });
          return;
        }

        const { count } = await prisma.classAssignment.deleteMany({
          where: {
            id: { in: safeToDelete.map(a => a.id) },
          },
        });

        const teacherUser = await prisma.user.findUnique({
          where: { id: req.user?.id },
          select: { id: true, firstName: true, lastName: true, role: true },
        });

        if (teacherUser) {
          await createAuditLog(
            AuditAction.DELETE,
            teacherUser,
            `Bulk Delete Archived Class Assignments`,
            "Class Records",
            `Permanently deleted ${count} archived class assignments for teacher ${teacherUser.firstName} ${teacherUser.lastName}${blockedCount > 0 ? ` (${blockedCount} blocked: have grades)` : ''}`,
            (req.ip as string) || req.socket?.remoteAddress,
            AuditSeverity.WARNING
          );
        }

        res.json({
          message: blockedCount > 0
            ? `Deleted ${count} assignments. ${blockedCount} skipped (have grades, preserved for SF10).`
            : `Successfully deleted ${count} archived assignments`,
          count,
          blockedCount
        });
      } catch (error) {
        logger.error("Error deleting all archived class assignments:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // Delete a class assignment (only if it's archived/inactive)
  router.delete(
    "/class-assignment/:id",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(classAssignmentDeleteSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const assignmentId = req.params.id as string;

        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
        });

        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const assignment = await prisma.classAssignment.findUnique({
          where: { id: assignmentId },
          include: {
            subject: true,
            section: true,
          },
        });

        if (!assignment || assignment.teacherId !== teacher.id) {
          res.status(403).json({ message: "Not authorized to delete this assignment" });
          return;
        }

        if (assignment.isActive) {
          res.status(400).json({ message: "Only archived assignments can be deleted by teachers" });
          return;
        }

        const gradeCount = await prisma.grade.count({
          where: { classAssignmentId: assignmentId }
        });
        if (gradeCount > 0) {
          res.status(400).json({
            message: `Cannot delete: this assignment has ${gradeCount} grade record(s) that must be preserved for student permanent records (SF10).`,
            gradeCount
          });
          return;
        }

        await prisma.classAssignment.delete({
          where: { id: assignmentId },
        });

        const teacherUser = await prisma.user.findUnique({
          where: { id: req.user?.id },
          select: { id: true, firstName: true, lastName: true, role: true },
        });

        const assignmentAny = assignment as any;
        if (teacherUser && assignmentAny) {
          await createAuditLog(
            AuditAction.DELETE,
            teacherUser,
            `Class Assignment Deleted: ${assignmentAny.subject.name} - ${assignmentAny.section.name}`,
            "Class Records",
            `Permanently deleted archived class assignment: ${assignmentAny.subject.name} for section ${assignmentAny.section.name} (${assignmentAny.schoolYear})`,
            (req.ip as string) || req.socket?.remoteAddress,
            AuditSeverity.WARNING,
            assignmentId
          );
        }

        res.json({ message: "Assignment deleted successfully" });
      } catch (error) {
        logger.error("Error deleting class assignment:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );
}
