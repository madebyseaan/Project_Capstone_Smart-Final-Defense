import { Router, Response } from "express";
import { AuditAction, AuditSeverity, Term, EnrollmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../middleware/auth";
import { createAuditLog } from "../lib/audit";
import multer from "multer";
import * as XLSX from "xlsx";

const router = Router();

// Configure multer for ECR file uploads (in-memory storage)
const ecrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    // Accept only Excel files
    const validMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const validExts = ['.xlsx', '.xls'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (validMimes.includes(file.mimetype) || validExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  },
});

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

interface EffectiveWeights {
  ww: number;
  pt: number;
  qa: number;
  source: "subject" | "generic-fallback";
  hasExactEcrTemplate: boolean;
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

  const currentTerm = settings.currentTerm ?? 'T1';

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

async function resolveEffectiveWeightsForClassAssignment(classAssignmentId: string): Promise<EffectiveWeights> {
  const classAssignment = await prisma.classAssignment.findUnique({
    where: { id: classAssignmentId },
    select: {
      subject: {
        select: {
          name: true,
          type: true,
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
      hasExactEcrTemplate: false,
    };
  }

  const subjectName = classAssignment.subject.name.trim();
  const baseSubjectName = getBaseSubjectName(subjectName);
  const hasExactEcrTemplate =
    (await prisma.eCRTemplate.count({
      where: {
        isActive: true,
        OR: [
          { subjectName },
          { subjectName: baseSubjectName },
        ],
      },
    })) > 0;

  // Use admin-configurable GradingConfig as the source of truth for weights
  const gradingConfig = await prisma.gradingConfig.findUnique({
    where: { subjectType: classAssignment.subject.type },
  });

  if (gradingConfig) {
    return {
      ww: gradingConfig.writtenWorkWeight,
      pt: gradingConfig.performanceTaskWeight,
      qa: gradingConfig.quarterlyAssessWeight,
      source: "subject",
      hasExactEcrTemplate,
    };
  }

  return {
    ww: GENERIC_FALLBACK_WEIGHTS.ww,
    pt: GENERIC_FALLBACK_WEIGHTS.pt,
    qa: GENERIC_FALLBACK_WEIGHTS.qa,
    source: "generic-fallback",
    hasExactEcrTemplate,
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

      const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      const currentSchoolYear = systemSettings?.currentSchoolYear ?? '2026-2027';

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
      console.error("Error fetching classes:", error);
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
      const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      const currentTerm = systemSettings?.currentTerm ?? 'T1';

      res.json({
        classAssignment,
        classRecord,
        effectiveWeights,
        currentTerm,
      });
    } catch (error) {
      console.error("Error fetching class record:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Create or update grade for a student
router.post(
  "/grade",
  authenticateToken,
  authorizeRoles("TEACHER"),
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
        const calculated = calculateGrades(
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
      console.error("Error saving grade:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Delete a grade
router.delete(
  "/grade/:gradeId",
  authenticateToken,
  authorizeRoles("TEACHER"),
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
      console.error("Error deleting grade:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Clear all scores for a class assignment and specific quarter
router.post(
  "/clear-scores",
  authenticateToken,
  authorizeRoles("TEACHER"),
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
      console.error("Error clearing scores:", error);
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

      const { count } = await prisma.classAssignment.deleteMany({
        where: {
          teacherId: teacher.id,
          isActive: false,
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
          `Permanently deleted all (${count}) archived class assignments for teacher ${teacherUser.firstName} ${teacherUser.lastName}`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.WARNING
        );
      }

      res.json({ message: `Successfully deleted ${count} archived assignments`, count });
    } catch (error) {
      console.error("Error deleting all archived class assignments:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Delete a class assignment (only if it's archived/inactive)
router.delete(
  "/class-assignment/:id",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const assignmentId = req.params.id;

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
      console.error("Error deleting class assignment:", error);
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

      const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      const currentSchoolYear = systemSettings?.currentSchoolYear ?? '2026-2027';
      const currentTerm = systemSettings?.currentTerm ?? 'T1';

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
      console.error("Error fetching dashboard:", error);
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

      const sysSettings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      const currentSY = sysSettings?.currentSchoolYear ?? '2026-2027';
      const currentTerm = sysSettings?.currentTerm ?? 'T1';

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
            where: { term: currentTerm },
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
          gradesForStats = ca.grades.map((g: any) => {
            if (g.quarterlyGrade !== null) return g;

            const recalculated = calculateGrades(
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
          });
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
      const gradeSubmissionRate = totalStudents > 0 ? Math.round((totalGraded / totalStudents) * 100) : 0;

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
      console.error("Error fetching dashboard stats:", error);
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

      const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      const currentSchoolYear = settings?.currentSchoolYear ?? '2026-2027';

      const gradeDeadline = await resolveTermDeadline(teacher.id, currentSchoolYear);

      res.json({ gradeDeadline });
    } catch (error) {
      console.error("Error fetching deadline status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Helper function to calculate grades based on DepEd formula
function calculateGrades(
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
    quarterlyGrade = transmute(initialGrade);
  }

  return {
    writtenWorkPS,
    perfTaskPS,
    quarterlyAssessPS,
    initialGrade,
    quarterlyGrade,
  };
}

// DepEd Transmutation Table (Revised Guidelines 2026)
function transmute(initialGrade: number): number {
  const roundedGrade = Math.round(initialGrade * 100) / 100;
  if (roundedGrade >= 99.5) return 100;

  const transmutationTable: [number, number, number][] = [
    [97.5, 99.49, 99],
    [96.0, 97.49, 98],
    [95.0, 95.99, 97],
    [94.0, 94.99, 96],
    [93.0, 93.99, 95],
    [92.0, 92.99, 94],
    [91.0, 91.99, 93],
    [90.0, 90.99, 92],
    [89.0, 89.99, 91],
    [88.0, 88.99, 90],
    [87.0, 87.99, 89],
    [86.0, 86.99, 88],
    [85.0, 85.99, 87],
    [84.0, 84.99, 86],
    [83.0, 83.99, 85],
    [82.0, 82.99, 84],
    [81.0, 81.99, 83],
    [80.0, 80.99, 82],
    [79.0, 79.99, 81],
    [78.0, 78.99, 80],
    [77.0, 77.99, 79],
    [76.0, 76.99, 78],
    [75.0, 75.99, 77],
    [73.0, 74.99, 76],
    [70.0, 72.99, 75],
    [68.0, 69.99, 74],
    [66.0, 67.99, 73],
    [64.0, 65.99, 72],
    [62.0, 63.99, 71],
    [60.0, 61.99, 70],
    [58.0, 59.99, 69],
    [56.0, 57.99, 68],
    [54.0, 55.99, 67],
    [52.0, 53.99, 66],
    [50.0, 51.99, 65],
    [48.0, 49.99, 64],
    [46.0, 47.99, 63],
    [43.0, 45.99, 62],
    [40.0, 42.99, 61],
    [25.0, 39.99, 60],
    [0.0,  24.99, 60],
  ];

  for (const [min, max, grade] of transmutationTable) {
    if (roundedGrade >= min && roundedGrade <= max) {
      return grade;
    }
  }

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
    console.error('Failed to create grade snapshot:', error);
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
      const sysSettings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      const currentSY = sysSettings?.currentSchoolYear ?? '2026-2027';
      const selectedTerm = (term as string) || sysSettings?.currentTerm || 'T1';

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
      console.error("Error fetching advisory honors:", error);
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

      const sysSettings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      const currentTerm = sysSettings?.currentTerm ?? 'T1';

      // Build filter for class assignments
      const classAssignmentFilter: any = {
        teacherId: teacher.id,
        isActive: true,
      };

      if (sectionId) {
        classAssignmentFilter.sectionId = sectionId as string;
      }

      const sysSettingsForMastery = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
      const currentSYForMastery = sysSettingsForMastery?.currentSchoolYear ?? '2026-2027';

      if (!classAssignmentFilter.schoolYear) {
        classAssignmentFilter.schoolYear = currentSYForMastery;
      }

      const classAssignments = await prisma.classAssignment.findMany({
        where: classAssignmentFilter,
        include: {
          section: true,
          subject: true,
          grades: {
            where: { term: currentTerm },
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
      console.error("Error fetching mastery distribution:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// ====================
// ECR (E-Class Record) Import
// ====================

interface ECRStudentData {
  name: string;
  writtenWorkScores: number[];
  writtenWorkTotal: number;
  writtenWorkPS: number;
  perfTaskScores: number[];
  perfTaskTotal: number;
  perfTaskPS: number;
  quarterlyAssessScore: number;
  quarterlyAssessPS: number;
  initialGrade: number;
  quarterlyGrade: number;
}

interface ECRQuarterData {
  term: string;
  students: ECRStudentData[];
  maxScores: {
    writtenWork: number[];
    perfTask: number[];
    quarterlyAssess: number;
  };
}

// Parse ECR Excel file and extract student grades
function parseECRFile(buffer: Buffer): { quarters: ECRQuarterData[]; metadata: any } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const quarters: ECRQuarterData[] = [];
  let metadata: any = {};

  // Map sheet names to quarters
  const termSheetMap: Record<string, string> = {};
  workbook.SheetNames.forEach(name => {
    const upperName = name.toUpperCase();
    if (upperName.includes('T1') || upperName.includes('_T1') || upperName.includes('Q1') || upperName.includes('_Q1')) termSheetMap.T1 = name;
    else if (upperName.includes('T2') || upperName.includes('_T2') || upperName.includes('Q2') || upperName.includes('_Q2')) termSheetMap.T2 = name;
    else if (upperName.includes('T3') || upperName.includes('_T3') || upperName.includes('Q3') || upperName.includes('_Q3')) termSheetMap.T3 = name;
  });

  // Process each term sheet
  for (const [term, sheetName] of Object.entries(termSheetMap)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
    
    // Extract metadata from early rows (typically row 7)
    if (data[6]) {
      const row7 = data[6];
      metadata = {
        ...metadata,
        gradeSection: row7[2] || '',
        teacher: row7[3] || '',
        subject: row7[4] || '',
      };
    }

    // Row 10 (index 9) contains highest possible scores
    const maxScoreRow = data[9] || [];
    const maxScores = {
      writtenWork: [] as number[],
      perfTask: [] as number[],
      quarterlyAssess: 100,
    };

    // Extract max scores for WW (columns 5-14) and PT (columns 18-27)
    for (let i = 5; i <= 14; i++) {
      const val = Number(maxScoreRow[i]) || 0;
      if (val > 0) maxScores.writtenWork.push(val);
    }
    for (let i = 18; i <= 27; i++) {
      const val = Number(maxScoreRow[i]) || 0;
      if (val > 0) maxScores.perfTask.push(val);
    }

    // Find MALE and FEMALE section markers (can be in column A or B depending on ECR format)
    let maleStart = -1;
    let femaleStart = -1;
    let dataEnd = data.length;

    for (let i = 0; i < data.length; i++) {
      const colA = String(data[i][0] || '').toUpperCase().trim();
      const colB = String(data[i][1] || '').toUpperCase().trim();
      // Check both column A and B for MALE/FEMALE markers
      if (colA === 'MALE' || colA === 'MALE ' || colB === 'MALE' || colB === 'MALE ') maleStart = i;
      if (colA === 'FEMALE' || colA === 'FEMALE ' || colB === 'FEMALE' || colB === 'FEMALE ') femaleStart = i;
      // Stop at empty sections or summary markers
      if (maleStart > 0 && (colA.includes('SUMMARY') || colA.includes('AVERAGE') || colB.includes('SUMMARY') || colB.includes('AVERAGE'))) {
        dataEnd = i;
        break;
      }
    }

    const students: ECRStudentData[] = [];

    // Process student rows (after MALE header, and after FEMALE header)
    const processStudentRows = (startRow: number, endRow: number) => {
      for (let i = startRow + 1; i < endRow; i++) {
        const row = data[i];
        if (!row) continue;

        // Column A is row number (can be string or number), Column B is student name
        const rowNum = row[0];
        const name = String(row[1] || '').trim();

        // Skip empty rows or non-student rows (headers, totals, etc.)
        if (!name || name === '') continue;
        // Check if rowNum is a valid number (as string or number)
        const rowNumParsed = typeof rowNum === 'number' ? rowNum : parseInt(String(rowNum), 10);
        if (isNaN(rowNumParsed)) continue;
        if (name.toUpperCase().includes('FEMALE') || name.toUpperCase().includes('MALE')) continue;
        if (name.toUpperCase().includes('TOTAL') || name.toUpperCase().includes('AVERAGE')) continue;
        if (name.toUpperCase().includes('HIGHEST')) continue;

        // Extract Written Work scores (columns 5-14, 10 items max)
        const wwScores: number[] = [];
        for (let c = 5; c <= 14; c++) {
          const val = Number(row[c]);
          if (!isNaN(val) && maxScores.writtenWork[c - 5] !== undefined) {
            wwScores.push(val);
          }
        }

        // Extract Performance Task scores (columns 18-27, 10 items max)
        const ptScores: number[] = [];
        for (let c = 18; c <= 27; c++) {
          const val = Number(row[c]);
          if (!isNaN(val) && maxScores.perfTask[c - 18] !== undefined) {
            ptScores.push(val);
          }
        }

        // Extract totals, PS, and grades
        const wwTotal = Number(row[15]) || 0;
        const wwPS = Number(row[16]) || 0;
        const ptTotal = Number(row[28]) || 0;
        const ptPS = Number(row[29]) || 0;
        const qaScore = Number(row[31]) || 0;
        const qaPS = Number(row[32]) || 0;
        const initialGrade = Number(row[34]) || 0;
        const quarterlyGrade = Number(row[35]) || 0;

        // Only add if student has any data
        if (wwScores.length > 0 || ptScores.length > 0 || qaScore > 0 || quarterlyGrade > 0) {
          students.push({
            name,
            writtenWorkScores: wwScores,
            writtenWorkTotal: wwTotal,
            writtenWorkPS: wwPS,
            perfTaskScores: ptScores,
            perfTaskTotal: ptTotal,
            perfTaskPS: ptPS,
            quarterlyAssessScore: qaScore,
            quarterlyAssessPS: qaPS,
            initialGrade,
            quarterlyGrade,
          });
        }
      }
    };

    // Process male students
    if (maleStart > 0 && femaleStart > maleStart) {
      processStudentRows(maleStart, femaleStart);
    } else if (maleStart > 0) {
      processStudentRows(maleStart, dataEnd);
    }

    // Process female students
    if (femaleStart > 0) {
      processStudentRows(femaleStart, dataEnd);
    }

    if (students.length > 0) {
      quarters.push({ term, students, maxScores });
    }
  }

  return { quarters, metadata };
}

// Normalize name for matching (remove extra spaces, convert to uppercase)
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/,\s*/g, ', '); // Standardize comma spacing
}

// Strip name extensions (Jr., Sr., II, III, IV, V) from both sides for flexible matching
function stripExtensions(name: string): string {
  return name
    .replace(/\b(JR\.?|SR\.?|II|III|IV|V)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/,\s*$/, '')
    .trim();
}

// Match ECR student name to database student
// Handles: double first names (e.g. "Mary Grace"), extensions (Jr./Sr./III),
// and flexible prefix matching for compound first names in ECR.
function matchStudent(
  ecrName: string,
  dbStudents: Array<{ id: string; firstName: string; middleName?: string | null; lastName: string; suffix?: string | null }>
): { id: string } | null {
  const normalizedEcr = normalizeName(ecrName);
  const strippedEcr = stripExtensions(normalizedEcr);

  for (const student of dbStudents) {
    const { firstName, lastName, middleName, suffix } = student;

    // Build various name formats to match
    const formats = [
      // LASTNAME, FIRSTNAME MIDDLENAME
      `${lastName}, ${firstName}${middleName ? ' ' + middleName : ''}`,
      // LASTNAME, FIRSTNAME M.  (middle initial only)
      `${lastName}, ${firstName}${middleName ? ' ' + middleName.charAt(0) + '.' : ''}`,
      // LASTNAME, FIRSTNAME
      `${lastName}, ${firstName}`,
      // FIRSTNAME MIDDLENAME LASTNAME
      `${firstName}${middleName ? ' ' + middleName : ''} ${lastName}`,
      // FIRSTNAME LASTNAME
      `${firstName} ${lastName}`,
    ];

    // Add suffix (Jr./Sr./etc.) variations
    if (suffix) {
      formats.push(`${lastName} ${suffix}, ${firstName}`);
      formats.push(`${lastName}, ${firstName} ${suffix}`);
      formats.push(`${lastName}, ${firstName}${middleName ? ' ' + middleName : ''} ${suffix}`);
      formats.push(`${lastName}, ${firstName}${middleName ? ' ' + middleName.charAt(0) + '.' : ''} ${suffix}`);
    }

    // 1. Exact match
    for (const fmt of formats) {
      if (normalizeName(fmt) === normalizedEcr) return { id: student.id };
    }

    // 2. Extension-stripped match (handles Jr./Sr./II/III in ECR without suffix in DB, or vice versa)
    for (const fmt of formats) {
      if (stripExtensions(normalizeName(fmt)) === strippedEcr) return { id: student.id };
    }

    // 3. Double-first-name: DB has compound first name (e.g. "Mary Grace"),
    //    try also matching against just the first word
    const firstWordOfDbFirst = firstName.split(' ')[0];
    if (firstWordOfDbFirst !== firstName) {
      const shortFormats = [
        `${lastName}, ${firstWordOfDbFirst}${middleName ? ' ' + middleName : ''}`,
        `${lastName}, ${firstWordOfDbFirst}${middleName ? ' ' + middleName.charAt(0) + '.' : ''}`,
        `${lastName}, ${firstWordOfDbFirst}`,
      ];
      for (const fmt of shortFormats) {
        if (normalizeName(fmt) === normalizedEcr) return { id: student.id };
        if (stripExtensions(normalizeName(fmt)) === strippedEcr) return { id: student.id };
      }
    }

    // 4. Prefix match: ECR may combine first+second name as one token
    //    e.g. ECR "PIATOS, MARY GRACE O." vs DB firstName="Mary", middleName=null
    //    Check if ECR last name matches and ECR's first-name token STARTS WITH DB firstName
    const commaIdx = strippedEcr.indexOf(',');
    if (commaIdx > 0) {
      const ecrLastNamePart = strippedEcr.substring(0, commaIdx).trim();
      const ecrFirstPart = strippedEcr.substring(commaIdx + 1).trim().split(' ');
      const dbLastNorm = normalizeName(lastName);
      const dbFirstNorm = normalizeName(firstName);

      if (ecrLastNamePart === dbLastNorm && ecrFirstPart.length > 0) {
        // ECR first token starts with DB first name
        if (ecrFirstPart[0] === dbFirstNorm) return { id: student.id };
        // ECR first two tokens together equal DB first name (e.g. DB="Mary Grace", ECR tokens=["MARY","GRACE"])
        if (ecrFirstPart.length > 1 && `${ecrFirstPart[0]} ${ecrFirstPart[1]}` === dbFirstNorm) return { id: student.id };
      }
    }
  }

  return null;
}

// Preview ECR import (returns parsed data without saving)
router.post(
  "/ecr/preview",
  authenticateToken,
  authorizeRoles("TEACHER"),
  ecrUpload.single('file'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No file uploaded" });
        return;
      }

      const classAssignmentId = req.body.classAssignmentId;
      if (!classAssignmentId) {
        res.status(400).json({ message: "Class assignment ID required" });
        return;
      }

      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
      });

      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      // Verify teacher owns this class assignment
      const classAssignment = await prisma.classAssignment.findFirst({
        where: {
          id: classAssignmentId,
          teacherId: teacher.id,
        },
        include: {
          subject: true,
          section: {
            include: {
              enrollments: {
                include: { student: true },
              },
            },
          },
        },
      });

      if (!classAssignment) {
        res.status(403).json({ message: "Not authorized for this class" });
        return;
      }
      if (isHomeroomGuidanceSubjectCode(classAssignment.subject.code)) {
        res.status(400).json({ message: "ECR import is not available for Homeroom Guidance classes" });
        return;
      }

      // Parse ECR file
      const { quarters, metadata } = parseECRFile(req.file.buffer);

      if (quarters.length === 0) {
        res.status(400).json({ message: "No valid term data found in ECR file" });
        return;
      }

      // Get enrolled students for matching
      const enrolledStudents = classAssignment.section.enrollments.map(e => e.student);

      // Match ECR students to database students
      const matchResults = quarters.map(q => ({
        term: q.term,
        maxScores: q.maxScores,
        students: q.students.map(ecrStudent => {
          const match = matchStudent(ecrStudent.name, enrolledStudents);
          return {
            ...ecrStudent,
            matchedStudentId: match?.id || null,
            matchedStudent: match ? enrolledStudents.find(s => s.id === match.id) : null,
          };
        }),
      }));

      // Calculate match statistics (deduplicate by name across quarters)
      const allNames = new Set<string>();
      const matchedNames = new Set<string>();
      matchResults.forEach(q => {
        q.students.forEach(s => {
          allNames.add(s.name);
          if (s.matchedStudentId) matchedNames.add(s.name);
        });
      });
      const totalStudents = allNames.size;
      const matchedStudents = matchedNames.size;

      res.json({
        fileName: req.file.originalname,
        metadata,
        quarters: matchResults,
        stats: {
          totalStudents,
          matchedStudents,
          unmatchedStudents: totalStudents - matchedStudents,
        },
        classAssignment: {
          id: classAssignment.id,
          subject: classAssignment.subject.name,
          section: classAssignment.section.name,
          ecrLastSyncedAt: classAssignment.ecrLastSyncedAt,
          ecrFileName: classAssignment.ecrFileName,
        },
      });
    } catch (error) {
      console.error("Error previewing ECR:", error);
      res.status(500).json({ message: "Failed to parse ECR file" });
    }
  }
);

// Import ECR grades (after preview confirmation)
router.post(
  "/ecr/import",
  authenticateToken,
  authorizeRoles("TEACHER"),
  ecrUpload.single('file'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No file uploaded" });
        return;
      }

      const { classAssignmentId, selectedQuarters } = req.body;
      const quartersToImport = selectedQuarters ? JSON.parse(selectedQuarters) : ['T1', 'T2', 'T3'];

      if (!classAssignmentId) {
        res.status(400).json({ message: "Class assignment ID required" });
        return;
      }

      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
      });

      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      // Verify teacher owns this class assignment
      const classAssignment = await prisma.classAssignment.findFirst({
        where: {
          id: classAssignmentId,
          teacherId: teacher.id,
        },
        include: {
          subject: true,
          section: {
            include: {
              enrollments: {
                include: { student: true },
              },
            },
          },
        },
      });

      if (!classAssignment) {
        res.status(403).json({ message: "Not authorized for this class" });
        return;
      }
      if (isHomeroomGuidanceSubjectCode(classAssignment.subject.code)) {
        res.status(400).json({ message: "ECR import is not available for Homeroom Guidance classes" });
        return;
      }

      // Parse ECR file
      const { quarters } = parseECRFile(req.file.buffer);

      if (quarters.length === 0) {
        res.status(400).json({ message: "No valid term data found in ECR file" });
        return;
      }

      const enrolledStudents = classAssignment.section.enrollments.map(e => e.student);
      const weights = {
        ww: classAssignment.subject.writtenWorkWeight,
        pt: classAssignment.subject.perfTaskWeight,
        qa: classAssignment.subject.quarterlyAssessWeight,
      };

      let importedGrades = 0;
      let skippedStudents = 0;

      // Process each quarter
      for (const termData of quarters) {
        if (!quartersToImport.includes(termData.term)) continue;

        for (const ecrStudent of termData.students) {
          const match = matchStudent(ecrStudent.name, enrolledStudents);
          
          if (!match) {
            skippedStudents++;
            continue;
          }

          // Build score items array from ECR data
          const writtenWorkScores = ecrStudent.writtenWorkScores.map((score, idx) => ({
            name: `WW ${idx + 1}`,
            score,
            maxScore: termData.maxScores.writtenWork[idx] || 100,
          }));

          const perfTaskScores = ecrStudent.perfTaskScores.map((score, idx) => ({
            name: `PT ${idx + 1}`,
            score,
            maxScore: termData.maxScores.perfTask[idx] || 100,
          }));

          // Calculate PS (percentage scores) using existing function, but use ECR's final grades
          const calculated = calculateGrades(
            writtenWorkScores,
            perfTaskScores,
            ecrStudent.quarterlyAssessScore,
            termData.maxScores.quarterlyAssess,
            weights.ww,
            weights.pt,
            weights.qa
          );

          // IMPORTANT: Use ECR's official grades (which include transmutation, conduct, etc.)
          // Only use calculated PS values for display purposes
          const finalInitialGrade = ecrStudent.initialGrade || calculated.initialGrade;
          const finalQuarterlyGrade = ecrStudent.quarterlyGrade || calculated.quarterlyGrade;

          // Upsert grade
          await prisma.grade.upsert({
            where: {
              studentId_classAssignmentId_term: {
                studentId: match.id,
                classAssignmentId,
                term: termData.term as Term,
              },
            },
            update: {
              writtenWorkScores,
              perfTaskScores,
              quarterlyAssessScore: ecrStudent.quarterlyAssessScore,
              quarterlyAssessMax: termData.maxScores.quarterlyAssess,
              writtenWorkPS: ecrStudent.writtenWorkPS || calculated.writtenWorkPS,
              perfTaskPS: ecrStudent.perfTaskPS || calculated.perfTaskPS,
              quarterlyAssessPS: ecrStudent.quarterlyAssessPS || calculated.quarterlyAssessPS,
              initialGrade: finalInitialGrade,
              quarterlyGrade: finalQuarterlyGrade,
            },
            create: {
              studentId: match.id,
              classAssignmentId,
              term: termData.term as Term,
              writtenWorkScores,
              perfTaskScores,
              quarterlyAssessScore: ecrStudent.quarterlyAssessScore,
              quarterlyAssessMax: termData.maxScores.quarterlyAssess,
              writtenWorkPS: ecrStudent.writtenWorkPS || calculated.writtenWorkPS,
              perfTaskPS: ecrStudent.perfTaskPS || calculated.perfTaskPS,
              quarterlyAssessPS: ecrStudent.quarterlyAssessPS || calculated.quarterlyAssessPS,
              initialGrade: finalInitialGrade,
              quarterlyGrade: finalQuarterlyGrade,
            },
          });

          importedGrades++;
        }
      }

      // Update class assignment with ECR sync info
      await prisma.classAssignment.update({
        where: { id: classAssignmentId },
        data: {
          ecrLastSyncedAt: new Date(),
          ecrFileName: req.file.originalname,
        },
      });

      // Create audit log
      const teacherUser = await prisma.user.findUnique({
        where: { id: req.user?.id },
        select: { id: true, firstName: true, lastName: true, role: true },
      });

      if (teacherUser) {
        await createAuditLog(
          AuditAction.UPDATE,
          teacherUser,
          `ECR Import: ${classAssignment.subject.name} - ${classAssignment.section.name}`,
          "Grades",
          `Imported ${importedGrades} grades from ECR file "${req.file.originalname}" for quarters: ${quartersToImport.join(', ')}. ${skippedStudents} students unmatched.`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.INFO,
          classAssignmentId
        );
      }

      res.json({
        success: true,
        importedGrades,
        skippedStudents,
        quartersImported: quarters.map(q => q.term).filter(q => quartersToImport.includes(q)),
        ecrLastSyncedAt: new Date().toISOString(),
        ecrFileName: req.file.originalname,
      });
    } catch (error) {
      console.error("Error importing ECR:", error);
      res.status(500).json({ message: "Failed to import ECR file" });
    }
  }
);

// Get ECR sync status for a class assignment
router.get(
  "/ecr/status/:classAssignmentId",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const classAssignmentId = req.params.classAssignmentId as string;

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
        select: {
          id: true,
          subject: { select: { code: true } },
          ecrLastSyncedAt: true,
          ecrFileName: true,
        },
      });

      if (!classAssignment) {
        res.status(404).json({ message: "Class assignment not found" });
        return;
      }
      if (isHomeroomGuidanceSubjectCode(classAssignment.subject.code)) {
        res.status(400).json({ message: "ECR status is not applicable to Homeroom Guidance classes" });
        return;
      }

      res.json({
        hasSynced: !!classAssignment.ecrLastSyncedAt,
        ecrLastSyncedAt: classAssignment.ecrLastSyncedAt,
        ecrFileName: classAssignment.ecrFileName,
      });
    } catch (error) {
      console.error("Error fetching ECR status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
