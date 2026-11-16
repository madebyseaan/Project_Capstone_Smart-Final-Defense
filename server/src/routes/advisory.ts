import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../middleware/auth";
import { syncTeacherOnLogin } from "../lib/teacherSync";
import { invalidateEnrollProToken } from "../lib/enrollproClient";
import { broadcastSyncStatus } from "../lib/sseManager";
import { getActiveSchoolYearLabel } from "../lib/schoolYearResolver";
import { logger } from "../lib/logger";
import { mergeRotationSubjects, SubjectTermInput } from "../lib/promotion";
import { validate } from "../middleware/validate";
import { advisorySf9QuerySchema, advisorySf9StudentParamsSchema } from "../schemas/advisory";
import { composeSf9Section, type Sf9Term } from "../lib/sf9Composer";
import { buildAdvisoryStudentGrades, isSubjectAlignedWithGrade } from "../lib/advisoryStudentGrades";
import registerObservedValueRoutes from "./advisory-sub/observedValues";

import type { Student, Enrollment, Section, ClassAssignment, Subject, Teacher, User, Grade } from "@prisma/client";

const router = Router();

// Type definitions for query results
type StudentWithDetails = Student;
type EnrollmentWithStudent = Enrollment & { student: Student };
type SectionWithEnrollments = Section & { 
  enrollments: EnrollmentWithStudent[];
  _count?: { enrollments: number };
};
type TeacherWithUser = Teacher & { user: Pick<User, 'firstName' | 'lastName'> };
type ClassAssignmentWithDetails = ClassAssignment & {
  subject: Subject;
  teacher: TeacherWithUser;
  grades?: Grade[];
};

// Get teacher's advisory section
router.get(
  "/my-advisory",
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

      // Get current school year from system settings
      const currentSchoolYear = await getActiveSchoolYearLabel();

      // Find advisory section assigned to this teacher for the current school year.
      const advisorySection = await prisma.section.findFirst({
        where: { adviserId: teacher.id, schoolYear: currentSchoolYear },
        include: {
          enrollments: {
            where: { status: "ENROLLED" },
            include: {
              student: true,
            },
            orderBy: {
              student: {
                lastName: "asc",
              },
            },
          },
          _count: {
            select: {
              enrollments: {
                where: { status: "ENROLLED" }
              },
            },
          },
        },
      }) as SectionWithEnrollments | null;

      if (!advisorySection) {
        res.json({ 
          hasAdvisory: false,
          message: "No advisory section assigned",
          teacher: {
            id: teacher.id,
            name: `${teacher.user.firstName} ${teacher.user.lastName}`,
            employeeId: teacher.employeeId,
          },
        });
        return;
      }

      // Get class assignments for this section (to know which subjects they have)
      // Filter for isActive: true to ensure subjects match current curriculum
      // Filter out Homeroom Guidance as it's not considered an academic subject for these views
      const classAssignments = await prisma.classAssignment.findMany({
        where: { 
          sectionId: advisorySection.id,
          isActive: true,
          subject: {
            NOT: {
              code: {
                startsWith: 'HG',
                mode: 'insensitive'
              }
            }
          }
        },
        include: {
          subject: true,
          teacher: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
        orderBy: {
          subject: {
            name: "asc",
          },
        },
      }) as ClassAssignmentWithDetails[];

      // Final filter to ensure subjects are aligned with the section's grade level
      const alignedAssignments = classAssignments.filter(ca => 
        isSubjectAlignedWithGrade(ca.subject.code, advisorySection.gradeLevel)
      );

      // Calculate section stats
      const maleCount = advisorySection.enrollments.filter((e: any) => e.student.gender?.toLowerCase() === "male").length;
      const femaleCount = advisorySection.enrollments.filter((e: any) => e.student.gender?.toLowerCase() === "female").length;

      res.json({
        hasAdvisory: true,
        teacher: {
          id: teacher.id,
          name: `${teacher.user.firstName} ${teacher.user.lastName}`,
          employeeId: teacher.employeeId,
        },
        section: {
          id: advisorySection.id,
          name: advisorySection.name,
          gradeLevel: advisorySection.gradeLevel,
          program: advisorySection.program,
          schoolYear: advisorySection.schoolYear,
        },
        students: advisorySection.enrollments.map((e: any, index: number) => {
          const snap = e.profileSnapshot as Record<string, any> | null;
          const s = e.student;
          return {
            id: s.id,
            lrn: snap?.lrn ?? s.lrn,
            firstName: snap?.firstName ?? s.firstName,
            middleName: snap?.middleName ?? s.middleName,
            lastName: snap?.lastName ?? s.lastName,
            suffix: snap?.suffix ?? s.suffix,
            gender: snap?.gender ?? s.gender,
            birthDate: s.birthDate,
            address: snap?.address ?? s.address,
            guardianName: snap?.guardianName ?? s.guardianName,
            guardianContact: snap?.guardianContact ?? s.guardianContact,
            fatherName: snap?.fatherName ?? s.fatherName,
            fatherContact: snap?.fatherContact ?? s.fatherContact,
            motherName: snap?.motherName ?? s.motherName,
            motherContact: snap?.motherContact ?? s.motherContact,
            religion: snap?.religion ?? s.religion,
            motherTongue: snap?.motherTongue ?? s.motherTongue,
            barangay: snap?.barangay ?? s.barangay,
            city: snap?.city ?? s.city,
            province: snap?.province ?? s.province,
            rank: index + 1,
          };
        }),
        stats: {
          totalStudents: advisorySection.enrollments.length,
          maleCount,
          femaleCount,
        },
        subjects: alignedAssignments.map((ca: ClassAssignmentWithDetails) => ({
          id: ca.subject.id,
          code: ca.subject.code,
          name: ca.subject.name,
          type: ca.subject.type,
          teacher: `${ca.teacher.user.firstName} ${ca.teacher.user.lastName}`,
        })),
      });
    } catch (error) {
      logger.error("Error fetching advisory:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Get student's complete grade profile (all subjects, all quarters)
router.get(
  "/student/:studentId/grades",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const studentId = req.params.studentId as string;
      const schoolYear = req.query.schoolYear as string | undefined;

      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
      });

      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      const result = await buildAdvisoryStudentGrades({
        teacherId: teacher.id,
        studentId,
        schoolYear,
      });

      if (!result.ok) {
        res.status(result.status).json({ message: result.message });
        return;
      }

      res.json(result.payload);
    } catch (error) {
      logger.error("Error fetching student grades:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Adviser printables: full SF9 or a temporary per-term card for the advisory section.
router.get(
  "/sf9",
  authenticateToken,
  authorizeRoles("TEACHER"),
  validate(advisorySf9QuerySchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
        select: { id: true },
      });

      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      const activeSchoolYear = await getActiveSchoolYearLabel();
      const requestedSchoolYear = (req.query.schoolYear as string | undefined) ?? activeSchoolYear;

      if (requestedSchoolYear !== activeSchoolYear) {
        res.status(400).json({
          message: "Historical school years are not available in teacher printables yet. Use the registrar portal.",
        });
        return;
      }

      const section = await prisma.section.findFirst({
        where: { adviserId: teacher.id, schoolYear: requestedSchoolYear },
        select: { id: true },
      });

      if (!section) {
        res.status(404).json({ message: "No advisory section assigned for this school year" });
        return;
      }

      const term = req.query.term as Sf9Term | undefined;
      const result = await composeSf9Section({
        sectionId: section.id,
        schoolYear: requestedSchoolYear,
        term,
      });

      if (!result) {
        res.status(404).json({ message: "Advisory section not found" });
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error("Error fetching advisory SF9 printables:", error);
      res.status(500).json({ message: "Failed to build advisory printables" });
    }
  }
);

router.get(
  "/sf9/:studentId",
  authenticateToken,
  authorizeRoles("TEACHER"),
  validate(advisorySf9StudentParamsSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
        select: { id: true },
      });

      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      const activeSchoolYear = await getActiveSchoolYearLabel();
      const requestedSchoolYear = (req.query.schoolYear as string | undefined) ?? activeSchoolYear;

      if (requestedSchoolYear !== activeSchoolYear) {
        res.status(400).json({
          message: "Historical school years are not available in teacher printables yet. Use the registrar portal.",
        });
        return;
      }

      const section = await prisma.section.findFirst({
        where: { adviserId: teacher.id, schoolYear: requestedSchoolYear },
        select: { id: true },
      });

      if (!section) {
        res.status(404).json({ message: "No advisory section assigned for this school year" });
        return;
      }

      const studentId = req.params.studentId as string;
      const enrollment = await prisma.enrollment.findFirst({
        where: {
          studentId,
          sectionId: section.id,
          schoolYear: requestedSchoolYear,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (!enrollment) {
        res.status(403).json({ message: "Not authorized to view this student" });
        return;
      }

      const term = req.query.term as Sf9Term | undefined;
      const result = await composeSf9Section({
        sectionId: section.id,
        schoolYear: requestedSchoolYear,
        term,
        studentIds: [studentId],
        includeNonEnrolled: true,
      });

      const payload = result?.students[0];
      if (!payload) {
        res.status(404).json({ message: "Student not found for this school year" });
        return;
      }

      res.json(payload);
    } catch (error) {
      logger.error("Error fetching advisory SF9 printable:", error);
      res.status(500).json({ message: "Failed to build the printable" });
    }
  }
);

registerObservedValueRoutes(router);

// Get advisory section summary (for report card generation)
router.get(
  "/summary",
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

      const advisorySection = await prisma.section.findFirst({
        where: { adviserId: teacher.id, schoolYear: currentSchoolYear },
        include: {
          enrollments: {
            where: { status: "ENROLLED" },
            include: {
              student: true,
            },
          },
        },
      }) as SectionWithEnrollments | null;

      if (!advisorySection) {
        res.json({ hasAdvisory: false });
        return;
      }

      // Get all grades for students in this section
      // Filter for isActive: true and align with grade level
      // Filter out Homeroom Guidance
      const classAssignmentsData = await prisma.classAssignment.findMany({
        where: { 
          sectionId: advisorySection.id,
          isActive: true,
          subject: {
            NOT: {
              code: {
                startsWith: 'HG',
                mode: 'insensitive'
              }
            }
          }
        },
        include: {
          subject: { select: { code: true } },
          grades: true, // Fetch all terms to compute final rating from available grades
        },
      }) as (ClassAssignment & { subject: { code: string }; grades: Grade[] })[];

      const classAssignments = classAssignmentsData.filter(ca => 
        isSubjectAlignedWithGrade(ca.subject.code, advisorySection.gradeLevel)
      );

      // Calculate rankings based on general average
      interface StudentAverage {
        studentId: string;
        name: string;
        lrn: string;
        gender: string | null;
        average: number | null;
        gradedSubjects: number;
        totalSubjects: number;
      }

      const studentAverages: StudentAverage[] = await Promise.all(
        advisorySection.enrollments.map(async (enrollment: EnrollmentWithStudent) => {
          // Merge rotational subjects (TLE, Science) so each rotation group = one subject
          const rotationInputs: SubjectTermInput[] = classAssignments.map((ca) => {
            const caGrades = ca.grades.filter((g: Grade) => g.studentId === enrollment.studentId);
            const terms: Record<string, number | null> = { T1: null, T2: null, T3: null };
            for (const g of caGrades) {
              if (g.quarterlyGrade !== null && !terms[g.term]) {
                terms[g.term] = g.quarterlyGrade;
              }
            }
            return {
              subjectCode: ca.subject.code,
              subjectName: ca.subject.code,
              T1: terms.T1,
              T2: terms.T2,
              T3: terms.T3,
              rotationTermGroupId: (ca.subject as any).rotationTermGroupId ?? null,
              rotationTermRank: (ca.subject as any).rotationTermRank ?? null,
              rotationOutputLabel: (ca.subject as any).rotationOutputLabel ?? null,
            };
          });

          const mergedSubjects = mergeRotationSubjects(rotationInputs);
          const subjectFinals = mergedSubjects
            .map((row) => {
              const vals = [row.T1, row.T2, row.T3].filter((v): v is number => v !== null);
              return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
            })
            .filter((g): g is number => g !== null);

          const average = subjectFinals.length > 0
            ? subjectFinals.reduce((a, b) => a + b, 0) / subjectFinals.length
            : null;

          return {
            studentId: enrollment.student.id,
            name: `${enrollment.student.lastName}, ${enrollment.student.firstName}`,
            lrn: enrollment.student.lrn,
            gender: enrollment.student.gender,
            average,
            gradedSubjects: subjectFinals.length,
            totalSubjects: mergedSubjects.length,
          };
        })
      );

      // Sort by average (highest first) and assign ranks
      const rankedStudents = studentAverages
        .filter((s: StudentAverage) => s.average !== null)
        .sort((a: StudentAverage, b: StudentAverage) => (b.average ?? 0) - (a.average ?? 0))
        .map((student: StudentAverage, index: number) => ({
          ...student,
          rank: index + 1,
          honors: student.average! >= 98 ? "Highest Honors" :
                  student.average! >= 95 ? "High Honors" :
                  student.average! >= 90 ? "Honors" :
                  student.average! >= 85 ? "With Honors" : null,
        }));

      // Students without grades yet
      const ungradedStudents = studentAverages
        .filter((s: StudentAverage) => s.average === null)
        .map((s: StudentAverage) => ({ ...s, rank: null, honors: null }));

      res.json({
        hasAdvisory: true,
        section: {
          id: advisorySection.id,
          name: advisorySection.name,
          gradeLevel: advisorySection.gradeLevel,
          program: advisorySection.program,
          schoolYear: advisorySection.schoolYear,
        },
        rankings: [...rankedStudents, ...ungradedStudents],
        stats: {
          totalStudents: advisorySection.enrollments.length,
          gradedStudents: rankedStudents.length,
          withHonors: rankedStudents.filter((s) => s.honors !== null).length,
          passingRate: rankedStudents.length > 0
            ? Math.round((rankedStudents.filter((s) => (s.average ?? 0) >= 75).length / rankedStudents.length) * 100)
            : 0,
        },
      });
    } catch (error) {
      logger.error("Error fetching advisory summary:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Manually trigger a sync from EnrollPro for the logged-in teacher
router.post(
  "/sync",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
        include: { user: { select: { email: true } } },
      });

      if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return;
      }

      if (!teacher.employeeId || !teacher.user.email) {
        res.status(400).json({ message: "Teacher profile is missing employee ID or email" });
        return;
      }

      // Force fresh EnrollPro token so stale auth does not serve cached data
      invalidateEnrollProToken();

      const result = await syncTeacherOnLogin(
        teacher.id,
        teacher.employeeId,
        teacher.user.email,
      );

      // Broadcast completion so frontend auto-refreshes
      broadcastSyncStatus({
        type: 'SYNC_COMPLETE',
        source: 'teacher-manual',
        timestamp: new Date().toISOString(),
        result: {
          enrollpro: { 
            studentsUpdated: result.studentsUpserted, 
            advisories: result.advisorySection ? 1 : 0, 
            errors: result.errors.length 
          },
          atlas: { 
            created: result.classAssignmentsCreated, 
            matched: 1, 
            errors: 0 
          }
        }
      });

      res.json({
        success: true,
        studentsFound: result.studentsFound,
        studentsUpserted: result.studentsUpserted,
        advisorySection: result.advisorySection,
        errors: result.errors,
      });
    } catch (error) {
      logger.error("Error syncing advisory:", error);
      res.status(500).json({ message: "Sync failed" });
    }
  }
);

export default router;
