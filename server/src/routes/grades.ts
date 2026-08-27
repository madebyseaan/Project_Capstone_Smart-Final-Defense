import { Router, Response } from "express";
import { AuditAction, AuditSeverity, Term, EnrollmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../middleware/auth";
import { createAuditLog } from "../lib/audit";
import { getTransmutationTable } from "../lib/transmutationCache";
import { getActiveSchoolYearLabel } from "../lib/schoolYearResolver";
import { logger } from "../lib/logger";
import { validate } from "../middleware/validate";
import { getIntegrationV1ActiveTerm } from "../lib/enrollproClient";
import {
  gradeSaveSchema,
  gradeDeleteSchema,
  clearScoresSchema,
  editRequestSchema,
  editRequestApproveSchema,
  editRequestRejectSchema,
  classAssignmentDeleteSchema,
} from "../schemas/grades";
const router = Router();

// ─── Live Term Resolver ──────────────────────────────────────────────────────
// Always fetch the active term from EnrollPro. Falls back to DB value if unreachable.
// Cache for 60s to avoid hammering EnrollPro on every request.
let cachedTerm: { term: string; fetchedAt: number } | null = null;
const TERM_CACHE_TTL_MS = 60_000;

export async function resolveCurrentTerm(): Promise<string> {
  const now = Date.now();
  if (cachedTerm && now - cachedTerm.fetchedAt < TERM_CACHE_TTL_MS) {
    return cachedTerm.term;
  }

  try {
    const activeTermData = await getIntegrationV1ActiveTerm();
    if (activeTermData?.activeTerm) {
      const termUpper = activeTermData.activeTerm.toUpperCase();
      if (['T1', 'T2', 'T3'].includes(termUpper)) {
        cachedTerm = { term: termUpper, fetchedAt: now };
        // Also persist to DB so offline fallback is correct
        await prisma.systemSettings.upsert({
          where: { id: 'main' },
          update: { currentTerm: termUpper as any },
          create: { id: 'main', currentTerm: termUpper as any },
        }).catch(() => {});
        return termUpper;
      }
    }
  } catch (err: any) {
    logger.warn(`[Grades] Live term fetch from EnrollPro failed (non-fatal): ${err.message}`);
  }

  // Fallback: read from database
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  const dbTerm = settings?.currentTerm ?? 'T1';
  cachedTerm = { term: dbTerm, fetchedAt: now };
  return dbTerm;
}

// Types for enrolled student with relations
interface EnrollmentWithStudent {
  student: {
    id: string;
    lrn: string;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    suffix?: string | null;
    gender?: string | null;
  };
  studentId: string;
}

interface GradeRecord {
  id: string;
  studentId: string;
  classAssignmentId: string;
  term: string;
}

interface ClassAssignmentWithRelations {
  subject: { name: string; code: string };
  section: { _count: { enrollments: number } };
}

export interface EffectiveWeights {
  ww: number;
  pt: number;
  qa: number;
  source: "subject-override" | "subject-type" | "generic-fallback";
}

const GENERIC_FALLBACK_WEIGHTS = {
  ww: 20,
  pt: 50,
  qa: 30,
} as const;

// ─── Grade Deadline Utilities ─────────────────────────────────────────────────

export interface GradeDeadlineInfo {
  termEndDate: string | null;
  daysRemaining: number | null;
  urgencyLevel: 'none' | 'warn' | 'urgent' | 'critical' | 'overdue';
  currentTerm: string;
  hasIncompleteClasses: boolean;
  incompleteCount: number;
  /** Populated for all urgency levels — lists exactly which classes are missing grades */
  incompleteClasses: { subjectName: string; sectionName: string; gradedCount: number; totalStudents: number }[];
}

/**
 * Reads the active term's end date from SystemSettings and returns deadline
 * info for the banner.  Returns null when no end date is configured OR when
 * the term is fully graded (nothing to warn about).
 */
async function resolveTermDeadline(
  teacherId: string,
  currentSchoolYear: string
): Promise<GradeDeadlineInfo | null> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  if (!settings) return null;

  const currentTerm = await resolveCurrentTerm();

  // Pick the end-date for the current term
  let termEndDate: Date | null = null;
  if (currentTerm === 'T1' && settings.t1EndDate) termEndDate = new Date(settings.t1EndDate);
  else if (currentTerm === 'T2' && settings.t2EndDate) termEndDate = new Date(settings.t2EndDate);
  else if (currentTerm === 'T3' && settings.t3EndDate) termEndDate = new Date(settings.t3EndDate);

  if (!termEndDate) return null;

  // Days remaining — floor so day-of counts as 0, negative means overdue
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  termEndDate.setHours(0, 0, 0, 0);
  const msRemaining = termEndDate.getTime() - now.getTime();
  const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

  // Gather all active teaching classes (excluding HG) with their grade counts
  const activeClasses = await prisma.classAssignment.findMany({
    where: { teacherId, schoolYear: currentSchoolYear, isActive: true },
    include: {
      subject: { select: { code: true, name: true } },
      section: {
        select: {
          name: true,
          _count: {
            select: {
              enrollments: {
                where: { status: EnrollmentStatus.ENROLLED, schoolYear: currentSchoolYear },
              },
            },
          },
        },
      },
      grades: { where: { term: currentTerm as any } },
    },
  });

  // Exclude Homeroom Guidance (HG) subjects
  const teachingClasses = activeClasses.filter(
    (ca: any) => !isHomeroomGuidanceSubjectCode(ca.subject.code)
  );

  const incompleteClasses: GradeDeadlineInfo['incompleteClasses'] = [];
  for (const ca of teachingClasses) {
    const totalStudents = ca.section._count.enrollments;
    const gradedCount = (ca.grades as any[]).filter(
      (g: any) => g.quarterlyGrade !== null
    ).length;
    if (gradedCount < totalStudents) {
      incompleteClasses.push({
        subjectName: ca.subject.name,
        sectionName: ca.section.name,
        gradedCount,
        totalStudents,
      });
    }
  }

  const incompleteCount = incompleteClasses.length;
  const hasIncompleteClasses = incompleteCount > 0;

  // If everything is graded, no banner needed regardless of date
  if (!hasIncompleteClasses) return null;

  // Determine urgency — overdue takes priority over all other levels
  let urgencyLevel: GradeDeadlineInfo['urgencyLevel'];
  if (daysRemaining < 0) {
    urgencyLevel = 'overdue';
  } else if (daysRemaining <= 1) {
    urgencyLevel = 'critical';
  } else if (daysRemaining <= 3) {
    urgencyLevel = 'urgent';
  } else if (daysRemaining <= 7) {
    urgencyLevel = 'warn';
  } else {
    urgencyLevel = 'none';
  }

  // Nothing to show if deadline is far away and no overdue state
  if (urgencyLevel === 'none') return null;

  return {
    termEndDate: termEndDate.toISOString(),
    daysRemaining,
    urgencyLevel,
    currentTerm,
    hasIncompleteClasses,
    incompleteCount,
    incompleteClasses,
  };
}

function getBaseSubjectName(subjectName: string): string {
  return subjectName.replace(/\s+\d+$/, "").trim();
}

const HG_QUALITATIVE_DESCRIPTORS = [
  'No Improvement',
  'Needs Improvement',
  'Developing',
  'Sufficiently Developed',
] as const;

function isHomeroomGuidanceSubjectCode(subjectCode?: string | null): boolean {
  return (subjectCode ?? '').toUpperCase().startsWith('HG');
}

export async function resolveEffectiveWeightsForClassAssignment(classAssignmentId: string): Promise<EffectiveWeights> {
  const classAssignment = await prisma.classAssignment.findUnique({
    where: { id: classAssignmentId },
    select: {
      subject: {
        select: {
          name: true,
          type: true,
          writtenWorkWeight: true,
          perfTaskWeight: true,
          quarterlyAssessWeight: true,
        },
      },
    },
  });

  if (!classAssignment) {
    return {
      ww: GENERIC_FALLBACK_WEIGHTS.ww,
      pt: GENERIC_FALLBACK_WEIGHTS.pt,
      qa: GENERIC_FALLBACK_WEIGHTS.qa,
      source: "generic-fallback",
    };
  }

  const subjectName = classAssignment.subject.name.trim();
  const baseSubjectName = getBaseSubjectName(subjectName);

  // 1. Check Subject-level weight override (if set)
  if (
    classAssignment.subject.writtenWorkWeight !== null &&
    classAssignment.subject.perfTaskWeight !== null &&
    classAssignment.subject.quarterlyAssessWeight !== null
  ) {
    return {
      ww: classAssignment.subject.writtenWorkWeight,
      pt: classAssignment.subject.perfTaskWeight,
      qa: classAssignment.subject.quarterlyAssessWeight,
      source: "subject-override",
    };
  }

  // 2. Check GradingConfig for subject type
  const gradingConfig = await prisma.gradingConfig.findUnique({
    where: { subjectType: classAssignment.subject.type },
  });

  if (gradingConfig) {
    return {
      ww: gradingConfig.writtenWorkWeight,
      pt: gradingConfig.performanceTaskWeight,
      qa: gradingConfig.quarterlyAssessWeight,
      source: "subject-type",
    };
  }

  // 3. Generic fallback
  return {
    ww: GENERIC_FALLBACK_WEIGHTS.ww,
    pt: GENERIC_FALLBACK_WEIGHTS.pt,
    qa: GENERIC_FALLBACK_WEIGHTS.qa,
    source: "generic-fallback",
  };
}

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
          { section: { gradeLevel: "asc" } },
          { subject: { name: "asc" } },
        ],
      });

      // Filter out Homeroom Guidance subjects — they are advisory subjects, not class records
      const filteredClasses = classes.filter(
        (ca: any) => !isHomeroomGuidanceSubjectCode(ca.subject.code)
      );

      // Keep card weights aligned with ClassRecordView by exposing the same effective weights.
      const classesWithEffectiveWeights = await Promise.all(
        filteredClasses.map(async (classAssignment: any) => {
          const effectiveWeights = await resolveEffectiveWeightsForClassAssignment(classAssignment.id);
          return {
            ...classAssignment,
            effectiveWeights,
          };
        })
      );

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

      // Get all enrolled students with their grades
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

      // Get grades for these students
      const grades = await prisma.grade.findMany({
        where: {
          classAssignmentId,
          ...(term ? { term: term as any } : {}),
        },
      });

      // Map grades to students
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

      res.json({
        classAssignment,
        classRecord,
        effectiveWeights,
        currentTerm,
        // Term dates and lock status for banner display
        termDates: {
          t1StartDate: systemSettings?.t1StartDate,
          t1EndDate: systemSettings?.t1EndDate,
          t2StartDate: systemSettings?.t2StartDate,
          t2EndDate: systemSettings?.t2EndDate,
          t3StartDate: systemSettings?.t3StartDate,
          t3EndDate: systemSettings?.t3EndDate,
        },
        gradeLock: systemSettings?.gradeLock ?? false,
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
        quarterlyAssessScore,
        quarterlyAssessMax,
        qaDescription,
        qaDate,
        qualitativeDescriptor,
      } = req.body;

      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
      });

      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      // Grade lock check — block edits during EOSY or when admin locks grades
      const sysSettings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      if (sysSettings?.gradeLock) {
        res.status(403).json({ message: "Grade editing is locked. Contact admin to unlock." });
        return;
      }

      // Term boundary check — only current term is editable (unless teacher has approved edit request)
      const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
      const currentTerm = await resolveCurrentTerm();
      const currentTermNum = termOrder[currentTerm] ?? 1;
      const requestTermNum = termOrder[term as string] ?? 0;
      if (requestTermNum > 0 && requestTermNum !== currentTermNum) {
        // Check if teacher has an approved, non-expired edit request for this term
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

      // Verify teacher owns this class assignment
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

      const isHG = isHomeroomGuidanceSubjectCode(classAssignment.subject.code);

      if (isHG) {
        if (!qualitativeDescriptor || !HG_QUALITATIVE_DESCRIPTORS.includes(qualitativeDescriptor)) {
          res.status(400).json({
            message: `Homeroom Guidance requires a qualitative descriptor: ${HG_QUALITATIVE_DESCRIPTORS.join(', ')}`,
          });
          return;
        }
      }

      let writtenWorkPS: number | null = null;
      let perfTaskPS: number | null = null;
      let quarterlyAssessPS: number | null = null;
      let initialGrade: number | null = null;
      let quarterlyGrade: number | null = null;

      // Load existing row so partial saves (WW/PT/QA one at a time) can be merged
      // before recomputing DepEd totals.
      const existingGrade = await prisma.grade.findFirst({ where: { studentId, classAssignmentId, term } });

      // Block edits on archived grades
      if (existingGrade?.isArchived) {
        res.status(403).json({ message: "Cannot edit archived grades. This school year has been finalized." });
        return;
      }

      // Block edits on finalized grades (registrar has locked them for EOSY)
      if (existingGrade?.status === "FINALIZED") {
        res.status(403).json({ message: "Grade is finalized and cannot be edited. Contact registrar to unfinalize." });
        return;
      }

      const mergedWrittenWorkScores = !isHG
        ? ((writtenWorkScores !== undefined
            ? writtenWorkScores
            : (existingGrade?.writtenWorkScores as Array<{ name: string; score: number; maxScore: number }> | null)) ?? null)
        : null;

      const mergedPerfTaskScores = !isHG
        ? ((perfTaskScores !== undefined
            ? perfTaskScores
            : (existingGrade?.perfTaskScores as Array<{ name: string; score: number; maxScore: number }> | null)) ?? null)
        : null;

      const mergedQuarterlyAssessScore = !isHG
        ? (quarterlyAssessScore !== undefined
            ? quarterlyAssessScore
            : (existingGrade?.quarterlyAssessScore ?? 0))
        : null;

      const mergedQuarterlyAssessMax = !isHG
        ? (quarterlyAssessMax !== undefined
            ? quarterlyAssessMax
            : (existingGrade?.quarterlyAssessMax ?? 100))
        : null;

      const mergedQaDescription = !isHG
        ? (qaDescription !== undefined
            ? qaDescription
            : (existingGrade?.qaDescription ?? null))
        : null;

      const mergedQaDate = !isHG
        ? (qaDate !== undefined
            ? qaDate
            : (existingGrade?.qaDate ?? null))
        : null;

      if (!isHG) {
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
      }

      const gradePayload = isHG
        ? {
            writtenWorkScores: Prisma.JsonNull,
            perfTaskScores: Prisma.JsonNull,
            quarterlyAssessScore: null,
            quarterlyAssessMax: null,
            writtenWorkPS: null,
            perfTaskPS: null,
            quarterlyAssessPS: null,
            initialGrade: null,
            quarterlyGrade: null,
            qaDescription: null,
            qaDate: null,
            qualitativeDescriptor,
          }
        : {
          writtenWorkScores: mergedWrittenWorkScores,
          perfTaskScores: mergedPerfTaskScores,
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

      // Upsert grade
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

      // Fetch student and teacher names for audit log
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
          `${isNew ? "Recorded" : "Updated"} grade for ${student?.firstName || ""} ${student?.lastName || ""} in ${classAssignment.subject.name} (${term}): ${isHG ? qualitativeDescriptor : quarterlyGrade}`,
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

      // Verify ownership through class assignment and fetch audit details in one query
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

      // Block deletion of archived grades
      if (grade.isArchived) {
        res.status(403).json({ message: "Cannot delete archived grades. This school year has been finalized." });
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

      // Grade lock check
      const sysSettings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      if (sysSettings?.gradeLock) {
        res.status(403).json({ message: "Grade editing is locked. Contact admin to unlock." });
        return;
      }

      // Term boundary check — only current term is editable (unless teacher has approved edit request)
      const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
      const currentTerm = await resolveCurrentTerm();
      const currentTermNum = termOrder[currentTerm] ?? 1;
      const requestTermNum = termOrder[term as string] ?? 0;
      if (requestTermNum > 0 && requestTermNum !== currentTermNum) {
        // Check if teacher has an approved, non-expired edit request for this term
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

      // Verify ownership
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

      // Block deletion if any grades for this assignment + term are archived
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

      // Block deletion if any grades for this assignment + term are finalized
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

      // Delete all grade records for this class assignment and quarter
      const { count } = await prisma.grade.deleteMany({
        where: {
          classAssignmentId,
          term,
        },
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
          `Cleared all (${count}) grades for ${classAssignment.subject.name} in section ${classAssignment.section.name} for ${term}`,
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

      // Find all archived assignments first to log them
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

      // Check which assignments have grades — block deletion for those
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

      // We only allow deleting archived/inactive assignments from the teacher's view
      if (assignment.isActive) {
        res.status(400).json({ message: "Only archived assignments can be deleted by teachers" });
        return;
      }

      // Block deletion if assignment has grades — preserve for SF10
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

// Get summary/dashboard data for teacher
router.get(
  "/dashboard",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      const currentSchoolYear = await getActiveSchoolYearLabel();
      const currentTerm = await resolveCurrentTerm();

      const classAssignments = await prisma.classAssignment.findMany({
        where: {
          teacherId: teacher.id,
          schoolYear: currentSchoolYear,
          isActive: true,
        },
        include: {
          subject: true,
          section: {
            include: {
              _count: {
                select: {
                  enrollments: {
                    where: { status: EnrollmentStatus.ENROLLED, schoolYear: currentSchoolYear },
                  },
                },
              },
            },
          },
        },
      });

      const archivedClassAssignmentsCount = await prisma.classAssignment.count({
        where: {
          teacherId: teacher.id,
          schoolYear: currentSchoolYear,
          isActive: false,
        },
      });

      const activeTeachingAssignments = classAssignments.filter(
        (ca: ClassAssignmentWithRelations) => !isHomeroomGuidanceSubjectCode(ca.subject.code)
      );

      // Count unique students across unique sections (avoid double-counting students
      // who appear in multiple class assignments for the same section)
      const uniqueSectionEnrollments = new Map<string, number>();
      for (const ca of classAssignments) {
        if (!uniqueSectionEnrollments.has(ca.sectionId)) {
          uniqueSectionEnrollments.set(ca.sectionId, ca.section._count.enrollments);
        }
      }

        // Add advisory sections — EnrollPro assigns the teacher as class adviser.
        // Only include advisory sections not already covered by a class assignment.
        const advisorySections = await prisma.section.findMany({
          where: {
            adviserId: teacher.id,
            schoolYear: currentSchoolYear,
            id: { notIn: [...uniqueSectionEnrollments.keys()] },
          },
          include: {
            _count: {
              select: {
                enrollments: {
                  where: { status: EnrollmentStatus.ENROLLED, schoolYear: currentSchoolYear },
                },
              },
            },
          },
        });
        for (const sec of advisorySections) {
          uniqueSectionEnrollments.set(sec.id, sec._count.enrollments);
        }

        const totalStudents = [...uniqueSectionEnrollments.values()].reduce((sum, n) => sum + n, 0);
        const totalTeachingClasses = activeTeachingAssignments.length;

      const gradeDeadline = await resolveTermDeadline(teacher.id, currentSchoolYear);

      res.json({
        teacher: {
          ...teacher,
          name: `${teacher.user.firstName} ${teacher.user.lastName}`,
        },
        stats: {
          totalClasses: totalTeachingClasses,
          totalStudents,
          subjects: [...new Set(classAssignments.map((ca: ClassAssignmentWithRelations) => ca.subject.name))],
          archivedClassesCount: archivedClassAssignmentsCount,
        },
        classAssignments,
        archivedClassesCount: archivedClassAssignmentsCount,
        currentTerm,
        gradeDeadline,
      });
    } catch (error) {
      logger.error("Error fetching dashboard:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Get detailed dashboard statistics with real grade data
router.get(
  "/dashboard-stats",
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

      const currentSY = await getActiveSchoolYearLabel();
      const currentTerm = await resolveCurrentTerm();

      const classAssignments = await prisma.classAssignment.findMany({
        where: {
          teacherId: teacher.id,
          schoolYear: currentSY,
          isActive: true,
        },
        include: {
          subject: true,
          section: {
            include: {
              enrollments: {
                where: { status: EnrollmentStatus.ENROLLED, schoolYear: currentSY },
                include: {
                  student: true,
                },
              },
            },
          },
          grades: {
            where: { term: currentTerm as Term },
          },
        },
      });

      // Calculate stats for each class
      const classStats = await Promise.all(classAssignments.map(async (ca: any) => {
        const isHG = isHomeroomGuidanceSubjectCode(ca.subject.code);
        const totalStudents = ca.section.enrollments.length;

        let gradesForStats: any[] = ca.grades;
        if (!isHG) {
          const effectiveWeights = await resolveEffectiveWeightsForClassAssignment(ca.id);
          gradesForStats = await Promise.all(ca.grades.map(async (g: any) => {
            if (g.quarterlyGrade !== null) return g;

            const recalculated = await calculateGrades(
              (g.writtenWorkScores as Array<{ name: string; score: number; maxScore: number }> | null) ?? null,
              (g.perfTaskScores as Array<{ name: string; score: number; maxScore: number }> | null) ?? null,
              g.quarterlyAssessScore ?? 0,
              g.quarterlyAssessMax ?? 100,
              effectiveWeights.ww,
              effectiveWeights.pt,
              effectiveWeights.qa
            );

            return {
              ...g,
              writtenWorkPS: recalculated.writtenWorkPS,
              perfTaskPS: recalculated.perfTaskPS,
              quarterlyAssessPS: recalculated.quarterlyAssessPS,
              initialGrade: recalculated.initialGrade,
              quarterlyGrade: recalculated.quarterlyGrade,
            };
          }));
        }

        const gradesWithScore = isHG
          ? []
          : gradesForStats.filter((g: any) => g.quarterlyGrade !== null);
        const gradedCount = gradesWithScore.length;
        
        // Calculate average grade
        const avgGrade = gradedCount > 0 
          ? Math.round(gradesWithScore.reduce((sum: number, g: any) => sum + g.quarterlyGrade, 0) / gradedCount)
          : null;
        
        // Calculate passing rate
        const passingCount = gradesWithScore.filter((g: any) => g.quarterlyGrade >= 75).length;
        const passingRate = gradedCount > 0 ? Math.round((passingCount / gradedCount) * 100) : 0;
        
        // Find students needing attention (below 75)
        const studentsAtRisk = isHG ? [] : gradesForStats
          .filter((g: any) => g.quarterlyGrade !== null && g.quarterlyGrade < 75)
          .map((g: any) => {
            const enrollment = ca.section.enrollments.find((e: any) => e.student.id === g.studentId);
            return enrollment ? {
              id: g.studentId,
              name: `${enrollment.student.lastName}, ${enrollment.student.firstName}`,
              grade: g.quarterlyGrade,
              class: `${ca.subject.name} - ${ca.section.name}`,
            } : null;
          })
          .filter(Boolean);
        
        // Find honors students (90+) and with honors (85-89)
        const honorsStudents = isHG ? [] : gradesForStats
          .filter((g: any) => g.quarterlyGrade !== null && g.quarterlyGrade >= 90)
          .map((g: any) => {
            const enrollment = ca.section.enrollments.find((e: any) => e.student.id === g.studentId);
            return enrollment ? {
              id: g.studentId,
              name: `${enrollment.student.lastName}, ${enrollment.student.firstName}`,
              grade: g.quarterlyGrade,
              honor: g.quarterlyGrade >= 98 ? "Highest Honors" : g.quarterlyGrade >= 95 ? "High Honors" : "Honors",
            } : null;
          })
          .filter(Boolean);
        
        const withHonorsStudents = isHG ? [] : gradesForStats
          .filter((g: any) => g.quarterlyGrade !== null && g.quarterlyGrade >= 85 && g.quarterlyGrade < 90)
          .map((g: any) => {
            const enrollment = ca.section.enrollments.find((e: any) => e.student.id === g.studentId);
            return enrollment ? {
              id: g.studentId,
              name: `${enrollment.student.lastName}, ${enrollment.student.firstName}`,
              grade: g.quarterlyGrade,
              honor: "With Honors",
            } : null;
          })
          .filter(Boolean);

        return {
          id: ca.id,
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          sectionName: ca.section.name,
          gradeLevel: ca.section.gradeLevel,
          totalStudents,
          gradedCount,
          avgGrade,
          passingRate,
          studentsAtRisk,
          honorsStudents,
          withHonorsStudents,
        };
      }));

      // Aggregate stats — deduplicate students by section to avoid counting the same
      // student multiple times when a teacher has several subjects in the same section.
      const allStudentsAtRisk = classStats.flatMap((cs: any) => cs.studentsAtRisk);
      const totalGraded = classStats.reduce((sum: number, cs: any) => sum + cs.gradedCount, 0);
      const seenSections = new Set<string>();
      const totalStudents = classStats.reduce((sum: number, cs: any) => {
        if (seenSections.has(cs.sectionName + cs.gradeLevel)) return sum;
        seenSections.add(cs.sectionName + cs.gradeLevel);
        return sum + cs.totalStudents;
      }, 0);
      const overallPassingRate = totalGraded > 0 
        ? Math.round(classStats.reduce((sum: number, cs: any) => sum + (cs.passingRate * cs.gradedCount), 0) / totalGraded)
        : 0;
      const academicClassStats = classStats.filter((cs: any) => !cs.subjectCode?.toUpperCase().startsWith('HG'));
      const gradeSubmissionRate = academicClassStats.length > 0
        ? Math.round(academicClassStats.filter((cs: any) => cs.gradedCount >= cs.totalStudents).length / academicClassStats.length * 100)
        : 0;

      const gradeDeadline = await resolveTermDeadline(teacher.id, currentSY);

      res.json({
        classStats,
        summary: {
          totalClasses: classStats.length,
          totalStudents,
          totalGraded,
          gradeSubmissionRate,
          overallPassingRate,
          studentsAtRisk: allStudentsAtRisk,
          studentsAtRiskCount: allStudentsAtRisk.length,
        },
        archivedClassesCount: await prisma.classAssignment.count({
          where: {
            teacherId: teacher.id,
            schoolYear: currentSY,
            isActive: false,
          },
        }),
        gradeDeadline,
      });
    } catch (error) {
      logger.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Lightweight endpoint for grade deadline status (used by Class Records page)
router.get(
  "/deadline-status",
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

      const gradeDeadline = await resolveTermDeadline(teacher.id, currentSchoolYear);

      res.json({ gradeDeadline });
    } catch (error) {
      logger.error("Error fetching deadline status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Helper function to calculate grades based on DepEd formula
async function calculateGrades(
  writtenWorkScores: Array<{ name: string; score: number; maxScore: number }> | null,
  perfTaskScores: Array<{ name: string; score: number; maxScore: number }> | null,
  quarterlyAssessScore: number | null,
  quarterlyAssessMax: number,
  wwWeight: number,
  ptWeight: number,
  qaWeight: number
) {
  // Calculate Written Work PS
  let writtenWorkPS: number | null = null;
  if (writtenWorkScores && writtenWorkScores.length > 0) {
    const totalScore = writtenWorkScores.reduce((sum, item) => sum + item.score, 0);
    const totalMax = writtenWorkScores.reduce((sum, item) => sum + item.maxScore, 0);
    writtenWorkPS = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
  }

  // Calculate Performance Task PS
  let perfTaskPS: number | null = null;
  if (perfTaskScores && perfTaskScores.length > 0) {
    const totalScore = perfTaskScores.reduce((sum, item) => sum + item.score, 0);
    const totalMax = perfTaskScores.reduce((sum, item) => sum + item.maxScore, 0);
    perfTaskPS = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
  }

  // Calculate Quarterly Assessment PS
  let quarterlyAssessPS: number | null = null;
  if (quarterlyAssessScore !== null && quarterlyAssessMax > 0) {
    quarterlyAssessPS = (quarterlyAssessScore / quarterlyAssessMax) * 100;
  }

  // Calculate Initial Grade (sum of weighted scores)
  let initialGrade: number | null = null;
  if (writtenWorkPS !== null && perfTaskPS !== null && quarterlyAssessPS !== null) {
    initialGrade =
      (writtenWorkPS * wwWeight) / 100 +
      (perfTaskPS * ptWeight) / 100 +
      (quarterlyAssessPS * qaWeight) / 100;
  }

  // Transmute to Quarterly Grade
  let quarterlyGrade: number | null = null;
  if (initialGrade !== null) {
    quarterlyGrade = await transmute(initialGrade);
  }

  return {
    writtenWorkPS,
    perfTaskPS,
    quarterlyAssessPS,
    initialGrade,
    quarterlyGrade,
  };
}

// DepEd Transmutation Table — loaded from DB (single source of truth)
async function transmute(initialGrade: number): Promise<number> {
  const roundedGrade = Math.round(initialGrade * 100) / 100;
  const table = await getTransmutationTable();
  for (const entry of table) {
    if (roundedGrade >= entry.minGrade && roundedGrade <= entry.maxGrade) {
      return entry.transmutedGrade;
    }
  }
  logger.warn(
    `[Transmutation] Initial grade ${roundedGrade} did not match any range — returning fallback 60. ` +
      `Check the transmutation table for gaps or misconfigured ranges (${table.length} entries).`
  );
  return 60; // Minimum grade
}

async function createGradeSnapshot(params: {
  gradeId?: string;
  studentId: string;
  classAssignmentId: string;
  teacherId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
  schoolYear: string;
  term: Term;
  snapshot: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.gradeSnapshot.create({
      data: {
        gradeId: params.gradeId ?? null,
        studentId: params.studentId,
        classAssignmentId: params.classAssignmentId,
        teacherId: params.teacherId,
        subjectCode: params.subjectCode,
        subjectName: params.subjectName,
        sectionId: params.sectionId,
        sectionName: params.sectionName,
        schoolYear: params.schoolYear,
        term: params.term,
        snapshot: params.snapshot as any,
      },
    });
  } catch (error) {
    logger.error('Failed to create grade snapshot:', error);
  }
}

// Get honors students from the teacher's advisory class based on final grades
router.get(
  "/advisory-honors",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user?.id } });
      if (!teacher) { res.status(404).json({ message: "Teacher not found" }); return; }

      const { term } = req.query;
      const currentSY = await getActiveSchoolYearLabel();
      const currentTerm = await resolveCurrentTerm();
      const selectedTerm = (term as string) || currentTerm || 'T1';

      const advisorySection = await prisma.section.findFirst({
        where: { adviserId: teacher.id, schoolYear: currentSY },
        include: {
          enrollments: {
            where: { status: 'ENROLLED', schoolYear: currentSY },
            include: { student: true },
          },
        },
      });

      if (!advisorySection) {
        res.json({ advisoryHonors: [], withHonors: [], hasAdvisory: false });
        return;
      }

      const studentIds = advisorySection.enrollments.map((e: any) => e.student.id);

      // Get all non-HG class assignments for this section
      const classAssignments = await prisma.classAssignment.findMany({
        where: {
          sectionId: advisorySection.id,
          schoolYear: currentSY,
          isActive: true,
        },
        include: { subject: true },
      });
      const nonHgAssignmentIds = classAssignments
        .filter((ca: any) => !isHomeroomGuidanceSubjectCode(ca.subject.code))
        .map((ca: any) => ca.id);

      if (nonHgAssignmentIds.length === 0 || studentIds.length === 0) {
        res.json({ advisoryHonors: [], withHonors: [], hasAdvisory: true });
        return;
      }

      // Get grades for advisory students in their section subjects
      // If term is 'FINAL', we calculate based on the final grade field (if it exists) 
      // or average of available terms.
      
      let grades: any[] = [];
      if (selectedTerm === 'FINAL') {
        // For FINAL, we need all terms to calculate the average of quarterly grades
        grades = await prisma.grade.findMany({
          where: {
            classAssignmentId: { in: nonHgAssignmentIds },
            studentId: { in: studentIds },
            quarterlyGrade: { not: null },
          },
        });
      } else {
        grades = await prisma.grade.findMany({
          where: {
            classAssignmentId: { in: nonHgAssignmentIds },
            studentId: { in: studentIds },
            term: selectedTerm as any,
            quarterlyGrade: { not: null },
          },
        });
      }

      // Group grades by student and calculate GWA
      const studentGradesMap = new Map<string, number[]>();
      
      if (selectedTerm === 'FINAL') {
        // Calculate average of final grades per subject first
        // Map: studentId -> Map: classAssignmentId -> quarterlyGrades[]
        const studentSubjectGrades = new Map<string, Map<string, number[]>>();
        
        for (const grade of grades) {
          if (!studentSubjectGrades.has(grade.studentId)) {
            studentSubjectGrades.set(grade.studentId, new Map());
          }
          const subjectMap = studentSubjectGrades.get(grade.studentId)!;
          if (!subjectMap.has(grade.classAssignmentId)) {
            subjectMap.set(grade.classAssignmentId, []);
          }
          subjectMap.get(grade.classAssignmentId)!.push(grade.quarterlyGrade);
        }
        
        for (const [studentId, subjects] of studentSubjectGrades.entries()) {
          const finalGrades: number[] = [];
          for (const [caId, qGrades] of subjects.entries()) {
            const finalGrade = qGrades.reduce((a, b) => a + b, 0) / qGrades.length;
            finalGrades.push(finalGrade);
          }
          studentGradesMap.set(studentId, finalGrades);
        }
      } else {
        for (const grade of grades) {
          if (!studentGradesMap.has(grade.studentId)) {
            studentGradesMap.set(grade.studentId, []);
          }
          studentGradesMap.get(grade.studentId)!.push(grade.quarterlyGrade);
        }
      }

      const advisoryHonors: { id: string; name: string; grade: number; honor: string; class: string }[] = [];
      const withHonors: { id: string; name: string; grade: number; honor: string; class: string }[] = [];

      for (const enrollment of (advisorySection.enrollments as any[])) {
        const studentGradesList = studentGradesMap.get(enrollment.student.id);
        
        // Ensure student has grades for most subjects (e.g. at least 1)
        if (!studentGradesList || studentGradesList.length === 0) continue;

        const gwa = studentGradesList.reduce((sum: number, g: number) => sum + g, 0) / studentGradesList.length;
        const roundedGwa = Math.round(gwa);
        const studentName = `${enrollment.student.lastName}, ${enrollment.student.firstName}`;

        if (roundedGwa >= 90) {
          advisoryHonors.push({
            id: enrollment.student.id,
            name: studentName,
            grade: gwa, // Return unrounded GWA
            honor: roundedGwa >= 98 ? 'Highest Honors' : roundedGwa >= 95 ? 'High Honors' : 'Honors',
            class: advisorySection.name,
          });
        } else if (roundedGwa >= 85) {
          withHonors.push({
            id: enrollment.student.id,
            name: studentName,
            grade: gwa, // Return unrounded GWA
            honor: 'With Honors',
            class: advisorySection.name,
          });
        }
      }

      res.json({ advisoryHonors, withHonors, hasAdvisory: true });
    } catch (error) {
      logger.error("Error fetching advisory honors:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Get mastery level distribution for DepEd bar graph
router.get(
  "/mastery-distribution",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { gradeLevel, sectionId } = req.query;

      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
      });

      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      const currentTerm = await resolveCurrentTerm();

      // Build filter for class assignments
      const classAssignmentFilter: any = {
        teacherId: teacher.id,
        isActive: true,
      };

      if (sectionId) {
        classAssignmentFilter.sectionId = sectionId as string;
      }

      const currentSYForMastery = await getActiveSchoolYearLabel();

      if (!classAssignmentFilter.schoolYear) {
        classAssignmentFilter.schoolYear = currentSYForMastery;
      }

      const classAssignments = await prisma.classAssignment.findMany({
        where: classAssignmentFilter,
        include: {
          section: true,
          subject: true,
          grades: {
            where: { term: currentTerm as Term },
          },
        },
      });

      // Filter by grade level if specified
      const filteredAssignments = gradeLevel 
        ? classAssignments.filter((ca: any) => ca.section.gradeLevel === gradeLevel)
        : classAssignments;

      // Collect all quarterly grades
      const allGrades = filteredAssignments.flatMap((ca: any) => {
        if (isHomeroomGuidanceSubjectCode(ca.subject?.code)) return [];
        return ca.grades.filter((g: any) => g.quarterlyGrade !== null).map((g: any) => g.quarterlyGrade);
      });

      // Calculate mastery level distribution (DepEd categories)
      const distribution = {
        outstanding: allGrades.filter((g: number) => g >= 90 && g <= 100).length,
        verySatisfactory: allGrades.filter((g: number) => g >= 85 && g <= 89).length,
        satisfactory: allGrades.filter((g: number) => g >= 80 && g <= 84).length,
        fairlySatisfactory: allGrades.filter((g: number) => g >= 75 && g <= 79).length,
        didNotMeet: allGrades.filter((g: number) => g < 75).length,
      };

      // Get available filters (grade levels and sections for this teacher)
      const allSections = await prisma.classAssignment.findMany({
        where: {
          teacherId: teacher.id,
          schoolYear: currentSYForMastery,
          isActive: true,
        },
        include: { section: true, subject: true },
        distinct: ['sectionId'],
      });

      const gradeLevels = [...new Set(allSections.map((ca: any) => ca.section.gradeLevel))];
      const sections = allSections.map((ca: any) => ({
        id: ca.section.id,
        name: ca.section.name,
        gradeLevel: ca.section.gradeLevel,
        program: ca.section.program,
      }));

      res.json({
        distribution,
        totalStudents: allGrades.length,
        filters: {
          gradeLevels,
          sections,
        },
      });
    } catch (error) {
      logger.error("Error fetching mastery distribution:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/grades/transmutation-table — public read-only endpoint for frontend transmutation
router.get("/transmutation-table", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const table = await getTransmutationTable();
    res.json(table);
  } catch (err: any) {
    logger.error("Error fetching transmutation table:", err);
    res.status(500).json({ message: "Failed to fetch transmutation table" });
  }
});

// ---------------------------------------------------------------------------
// Grade Edit Request Endpoints
// ---------------------------------------------------------------------------

// Teacher: Create edit request for past term
router.post(
  "/edit-request",
  authenticateToken,
  authorizeRoles("TEACHER"),
  validate(editRequestSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { term, reason, classAssignmentId, gradeLevel, section, subject } = req.body;
      if (!term || !reason) {
        res.status(400).json({ message: "term and reason are required" });
        return;
      }

      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
        include: { user: true },
      });
      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      const currentTerm = await resolveCurrentTerm();
      const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
      if (termOrder[term] >= termOrder[currentTerm]) {
        res.status(400).json({ message: "Can only request edit access for past terms" });
        return;
      }

      // Check for existing pending request
      const existing = await prisma.gradeEditRequest.findFirst({
        where: { teacherId: teacher.userId, term, status: "PENDING" },
      });
      if (existing) {
        res.status(409).json({ message: "You already have a pending request for this term" });
        return;
      }

      const user = req.user!;
      const request = await prisma.gradeEditRequest.create({
        data: {
          teacherId: teacher.userId,
          teacherName: `${teacher.user?.firstName || ""} ${teacher.user?.lastName || ""}`.trim() || req.user!.username,
          term,
          schoolYear: settings?.currentSchoolYear ?? "2026-2027",
          gradeLevel: gradeLevel || null,
          section: section || null,
          subject: subject || null,
          classAssignmentId: classAssignmentId || null,
          reason,
        },
      });

      // Broadcast to admin SSE
      const { broadcastSettingsUpdate } = await import("../lib/sseManager");
      const updatedSettings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      if (updatedSettings) broadcastSettingsUpdate(updatedSettings);

      res.status(201).json({ message: "Edit request submitted", request });
    } catch (err: any) {
      logger.error("Error creating edit request:", err);
      res.status(500).json({ message: "Failed to create edit request" });
    }
  }
);

// Teacher: Get own edit requests
router.get(
  "/edit-requests",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user?.id } });
      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      const requests = await prisma.gradeEditRequest.findMany({
        where: { teacherId: teacher.userId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      res.json({ requests });
    } catch (err: any) {
      logger.error("Error fetching edit requests:", err);
      res.status(500).json({ message: "Failed to fetch edit requests" });
    }
  }
);

// Admin: Get all edit requests
router.get(
  "/admin/edit-requests",
  authenticateToken,
  authorizeRoles("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { status } = req.query;
      const where = status ? { status: status as any } : {};
      const requests = await prisma.gradeEditRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      res.json({ requests });
    } catch (err: any) {
      logger.error("Error fetching edit requests:", err);
      res.status(500).json({ message: "Failed to fetch edit requests" });
    }
  }
);

// Admin: Approve edit request
router.post(
  "/admin/edit-requests/:id/approve",
  authenticateToken,
  authorizeRoles("ADMIN"),
  validate(editRequestApproveSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { hours } = req.body; // Duration in hours (default 24)
      const durationHours = Math.min(Math.max(Number(hours) || 24, 1), 168); // 1-168 hours (1 week max)

      const request = await prisma.gradeEditRequest.findUnique({ where: { id } });
      if (!request) {
        res.status(404).json({ message: "Request not found" });
        return;
      }
      if (request.status !== "PENDING") {
        res.status(400).json({ message: `Request is already ${request.status.toLowerCase()}` });
        return;
      }

      const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
      const user = req.user!;
      const adminUser = await prisma.user.findUnique({ where: { id: user.id } });

      const updated = await prisma.gradeEditRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedById: user.id,
          approvedByName: `${adminUser?.firstName || ""} ${adminUser?.lastName || ""}`.trim() || user.username,
          expiresAt,
        },
      });

      // Audit log
      await createAuditLog(
        AuditAction.UPDATE,
        user,
        `Approved grade edit request for ${request.teacherName} - ${request.term}`,
        "Grade Edit Request",
        `Approved edit access for ${durationHours}h. Expires: ${expiresAt.toISOString()}`,
        (req.ip as string) || req.socket?.remoteAddress,
        AuditSeverity.INFO
      );

      res.json({ message: "Request approved", request: updated });
    } catch (err: any) {
      logger.error("Error approving edit request:", err);
      res.status(500).json({ message: "Failed to approve request" });
    }
  }
);

// Admin: Reject edit request
router.post(
  "/admin/edit-requests/:id/reject",
  authenticateToken,
  authorizeRoles("ADMIN"),
  validate(editRequestRejectSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { reason } = req.body;

      const request = await prisma.gradeEditRequest.findUnique({ where: { id } });
      if (!request) {
        res.status(404).json({ message: "Request not found" });
        return;
      }
      if (request.status !== "PENDING") {
        res.status(400).json({ message: `Request is already ${request.status.toLowerCase()}` });
        return;
      }

      const user = req.user!;
      const updated = await prisma.gradeEditRequest.update({
        where: { id },
        data: { status: "REJECTED" },
      });

      await createAuditLog(
        AuditAction.UPDATE,
        user,
        `Rejected grade edit request for ${request.teacherName} - ${request.term}`,
        "Grade Edit Request",
        `Rejected. Reason: ${reason || "No reason provided"}`,
        (req.ip as string) || req.socket?.remoteAddress,
        AuditSeverity.INFO
      );

      res.json({ message: "Request rejected", request: updated });
    } catch (err: any) {
      logger.error("Error rejecting edit request:", err);
      res.status(500).json({ message: "Failed to reject request" });
    }
  }
);

// Admin: Revoke (immediately expire) an approved edit request
router.post(
  "/admin/edit-requests/:id/revoke",
  authenticateToken,
  authorizeRoles("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;

      const request = await prisma.gradeEditRequest.findUnique({ where: { id } });
      if (!request) {
        res.status(404).json({ message: "Request not found" });
        return;
      }
      if (request.status !== "APPROVED") {
        res.status(400).json({ message: `Cannot revoke a request with status ${request.status.toLowerCase()}` });
        return;
      }

      const user = req.user!;
      const updated = await prisma.gradeEditRequest.update({
        where: { id },
        data: { status: "EXPIRED", expiresAt: new Date() },
      });

      await createAuditLog(
        AuditAction.UPDATE,
        user,
        `Revoked grade edit access for ${request.teacherName} - ${request.term}`,
        "Grade Edit Request",
        `Admin manually revoked edit access`,
        (req.ip as string) || req.socket?.remoteAddress,
        AuditSeverity.INFO
      );

      res.json({ message: "Edit access revoked", request: updated });
    } catch (err: any) {
      logger.error("Error revoking edit request:", err);
      res.status(500).json({ message: "Failed to revoke request" });
    }
  }
);

export default router;
