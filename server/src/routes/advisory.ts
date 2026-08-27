import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../middleware/auth";
import { syncTeacherOnLogin } from "../lib/teacherSync";
import { invalidateEnrollProToken } from "../lib/enrollproClient";
import { broadcastSyncStatus } from "../lib/sseManager";
import { getActiveSchoolYearLabel } from "../lib/schoolYearResolver";
import { logger } from "../lib/logger";

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

function isHomeroomGuidanceCode(subjectCode: string | null | undefined): boolean {
  return (subjectCode ?? '').toUpperCase().startsWith('HG');
}

/**
 * Helper to check if a subject code is aligned with a section's grade level.
 * Example: MATH7 is NOT aligned with GRADE_10.
 * Generic codes like MATH or ENG are considered aligned.
 */
function isSubjectAlignedWithGrade(subjectCode: string, gradeLevel: string): boolean {
  const gradeSuffix = gradeLevel.replace('GRADE_', '');
  const code = subjectCode.toUpperCase();
  
  // Find numeric suffix at the end of the code (e.g., "7", "10")
  const match = code.match(/\d+$/);
  if (match) {
    const codeGrade = match[0];
    return codeGrade === gradeSuffix;
  }
  
  return true; // Generic code, assume aligned
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toDisplayName(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function toTitleCase(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function subjectDedupKey(subjectCode: string, subjectName: string): string {
  return `${normalizeWhitespace(subjectCode).toUpperCase()}::${normalizeWhitespace(subjectName).toUpperCase()}`;
}

function gradeSignalScore(assignment: { grades: Grade[]; updatedAt: Date }): number {
  const gradedQuarters = assignment.grades.filter(
    (g) =>
      g.quarterlyGrade !== null ||
      g.initialGrade !== null ||
      g.qualitativeDescriptor !== null
  ).length;

  const scoredQuarters = assignment.grades.filter(
    (g) =>
      g.writtenWorkPS !== null ||
      g.perfTaskPS !== null ||
      g.quarterlyAssessPS !== null
  ).length;

  // Weighted score to prefer rows with complete grading data, then recency.
  return gradedQuarters * 1000 + scoredQuarters * 100 + assignment.grades.length * 10 + assignment.updatedAt.getTime() / 1e12;
}

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
      let advisorySection = await prisma.section.findFirst({
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

      // Fallback: if no section for currentSchoolYear, try any section assigned to teacher
      if (!advisorySection) {
        advisorySection = await prisma.section.findFirst({
          where: { adviserId: teacher.id },
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
      }

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

      // Get student with their enrollment
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: {
          enrollments: {
            where: {
              ...(schoolYear ? { schoolYear } : {}),
              status: 'ENROLLED',
            },
            include: {
              section: true,
            },
            orderBy: [
              { schoolYear: "desc" },
              { createdAt: "desc" },
            ],
            take: 1,
          },
        },
      });

      if (!student) {
        res.status(404).json({ message: "Student not found" });
        return;
      }

      const currentEnrollment = student.enrollments[0];
      if (!currentEnrollment) {
        res.status(404).json({ message: "Student not enrolled" });
        return;
      }

      // Verify teacher is adviser of this section
      const section = await prisma.section.findFirst({
        where: {
          id: currentEnrollment.sectionId,
          adviserId: teacher.id,
        },
      });

      // Also allow if teacher teaches this student (any class assignment)
      const teachesStudent = await prisma.classAssignment.findFirst({
        where: {
          teacherId: teacher.id,
          sectionId: currentEnrollment.sectionId,
        },
      });

      if (!section && !teachesStudent) {
        res.status(403).json({ message: "Not authorized to view this student" });
        return;
      }

      // Get all class assignments for this section
      // Filter for isActive: true to show current assignments only
      // Filter out Homeroom Guidance from this list
      const classAssignments = await prisma.classAssignment.findMany({
        where: { 
          sectionId: currentEnrollment.sectionId,
          schoolYear: currentEnrollment.schoolYear,
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
          grades: {
            where: { studentId },
          },
        },
        orderBy: {
          subject: {
            name: "asc",
          },
        },
      }) as (ClassAssignment & { 
        subject: Subject; 
        teacher: TeacherWithUser; 
        grades: Grade[] 
      })[];

      // Keep all aligned assigned subjects for this section/year.
      // Duplicates are handled separately below by canonical subject key.
      const alignedAssignments = classAssignments.filter(ca => 
        isSubjectAlignedWithGrade(ca.subject.code, currentEnrollment.section.gradeLevel)
      );

      // Deduplicate duplicate class assignments that point to the same subject
      // (e.g., duplicate teacher sync rows with different name casing).
      const dedupedAssignments = Array.from(
        alignedAssignments.reduce((acc, assignment) => {
          const key = subjectDedupKey(assignment.subject.code, assignment.subject.name);
          const existing = acc.get(key);

          if (!existing || gradeSignalScore(assignment) > gradeSignalScore(existing)) {
            acc.set(key, assignment);
          }

          return acc;
        }, new Map<string, (ClassAssignment & { subject: Subject; teacher: TeacherWithUser; grades: Grade[] })>()).values()
      );

      // Format grades by subject
      const subjectGrades = dedupedAssignments.map((ca) => {
        const terms = ["T1", "T2", "T3"] as const;
        const gradesByTerm: Record<string, {
          writtenWorkPS: number | null;
          perfTaskPS: number | null;
          quarterlyAssessPS: number | null;
          initialGrade: number | null;
          quarterlyGrade: number | null;
          qualitativeDescriptor: string | null;
        } | null> = {};
        
        terms.forEach((q) => {
          const grade = ca.grades.find((g: Grade) => g.term === q);
          gradesByTerm[q] = grade ? {
            writtenWorkPS: grade.writtenWorkPS,
            perfTaskPS: grade.perfTaskPS,
            quarterlyAssessPS: grade.quarterlyAssessPS,
            initialGrade: grade.initialGrade,
            quarterlyGrade: grade.quarterlyGrade,
            qualitativeDescriptor: grade.qualitativeDescriptor ?? null,
          } : null;
        });

        // Calculate final grade (average of available term grades)
        const termGrades = Object.values(gradesByTerm)
          .filter((g): g is NonNullable<typeof g> => g?.quarterlyGrade !== null && g?.quarterlyGrade !== undefined)
          .map((g) => g.quarterlyGrade as number);
        
        const finalGrade = termGrades.length > 0 
          ? Math.round(termGrades.reduce((a, b) => a + b, 0) / termGrades.length)
          : null;

        return {
          subjectId: ca.subject.id,
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          subjectType: ca.subject.type,
          teacher: `${toDisplayName(ca.teacher.user.firstName)} ${toDisplayName(ca.teacher.user.lastName)}`,
          grades: gradesByTerm,
          finalGrade,
          remarks: finalGrade ? (finalGrade >= 75 ? "PASSED" : "FAILED") : null,
          rotationTermGroupId: (ca.subject as any).rotationTermGroupId ?? null,
          rotationTermRank: (ca.subject as any).rotationTermRank ?? null,
          rotationOutputLabel: (ca.subject as any).rotationOutputLabel ?? null,
        };
      });

      // Merge rotating sub-subjects (e.g. Science-Biology, Science-Chemistry, Science-EarthScience)
      // into a single row where T1/T2/T3 each hold one sub-subject's grade.
      const rotationGroups: Record<string, typeof subjectGrades> = {};
      const standaloneRows: typeof subjectGrades = [];

      for (const row of subjectGrades) {
        if (row.rotationTermGroupId) {
          if (!rotationGroups[row.rotationTermGroupId]) {
            rotationGroups[row.rotationTermGroupId] = [];
          }
          rotationGroups[row.rotationTermGroupId].push(row);
        } else {
          standaloneRows.push(row);
        }
      }

      const mergedRotationRows: typeof subjectGrades = [];
      for (const [, groupRows] of Object.entries(rotationGroups)) {
        const sorted = [...groupRows].sort((a, b) => (a.rotationTermRank ?? 0) - (b.rotationTermRank ?? 0));

        // Build merged grades: each sub-subject occupies its rotation term slot
        const mergedGrades: typeof subjectGrades[0]['grades'] = { T1: null, T2: null, T3: null };
        for (const sub of sorted) {
          if (!sub.rotationTermRank) continue;
          const termKey = `T${sub.rotationTermRank}` as 'T1' | 'T2' | 'T3';
          // Use the sub-subject's grade for its assigned term
          const subGrade = sub.grades[termKey];
          if (subGrade) {
            mergedGrades[termKey] = subGrade;
          } else {
            // Fallback: use whichever term has a grade
            for (const t of ['T1', 'T2', 'T3'] as const) {
              if (sub.grades[t]) {
                mergedGrades[t] = sub.grades[t];
                break;
              }
            }
          }
        }

        // Calculate final grade from available term grades
        const termGradeValues = Object.values(mergedGrades)
          .filter((g): g is NonNullable<typeof g> => g?.quarterlyGrade !== null && g?.quarterlyGrade !== undefined)
          .map((g) => g.quarterlyGrade as number);
        const finalGrade = termGradeValues.length > 0
          ? Math.round(termGradeValues.reduce((a, b) => a + b, 0) / termGradeValues.length)
          : null;

        mergedRotationRows.push({
          subjectId: sorted[0].subjectId,
          subjectCode: sorted[0].rotationOutputLabel ?? sorted[0].subjectCode,
          subjectName: toTitleCase(sorted[0].rotationOutputLabel ?? sorted[0].subjectName),
          subjectType: sorted[0].subjectType,
          teacher: sorted.map(r => r.teacher).filter(Boolean).join(' / '),
          grades: mergedGrades,
          finalGrade,
          remarks: finalGrade ? (finalGrade >= 75 ? "PASSED" : "FAILED") : null,
          rotationTermGroupId: sorted[0].rotationTermGroupId,
          rotationTermRank: null,
          rotationOutputLabel: sorted[0].rotationOutputLabel,
        });
      }

      const mergedSubjectGrades = [...standaloneRows, ...mergedRotationRows];

      // Calculate General Average
      const finalGrades = mergedSubjectGrades
        .filter((s) => s.finalGrade !== null)
        .map((s) => s.finalGrade as number);
      const academicSubjects = mergedSubjectGrades;
      
      const generalAverage = finalGrades.length > 0
        ? Math.round((finalGrades.reduce((a, b) => a + b, 0) / finalGrades.length) * 100) / 100
        : null;

      // Determine honors based on DepEd criteria
      let honors: string | null = null;
      if (generalAverage !== null) {
        if (generalAverage >= 98) honors = "With Highest Honors";
        else if (generalAverage >= 95) honors = "With High Honors";
        else if (generalAverage >= 90) honors = "With Honors";
      }

      // Determine promotion status
      let promotionStatus: string | null = null;
      if (finalGrades.length === academicSubjects.length && finalGrades.length > 0) {
        const failedSubjects = academicSubjects.filter((s) => s.finalGrade !== null && s.finalGrade < 75);
        if (failedSubjects.length === 0) {
          promotionStatus = "PROMOTED";
        } else if (failedSubjects.length <= 2) {
          promotionStatus = "CONDITIONALLY PROMOTED";
        } else {
          promotionStatus = "RETAINED";
        }
      }

      // Use profile snapshot if available (historical), else current student data
      const snap = currentEnrollment.profileSnapshot as Record<string, any> | null;

      res.json({
        student: {
          id: student.id,
          lrn: snap?.lrn ?? student.lrn,
          firstName: snap?.firstName ?? student.firstName,
          middleName: snap?.middleName ?? student.middleName,
          lastName: snap?.lastName ?? student.lastName,
          suffix: snap?.suffix ?? student.suffix,
          gender: snap?.gender ?? student.gender,
          birthDate: student.birthDate,
          address: snap?.address ?? student.address,
          guardianName: snap?.guardianName ?? student.guardianName,
          guardianContact: snap?.guardianContact ?? student.guardianContact,
          religion: snap?.religion ?? (student as any).religion,
          motherTongue: snap?.motherTongue ?? (student as any).motherTongue,
          barangay: snap?.barangay ?? (student as any).barangay,
          city: snap?.city ?? (student as any).city,
          province: snap?.province ?? (student as any).province,
          fatherName: snap?.fatherName ?? (student as any).fatherName,
          fatherContact: snap?.fatherContact ?? (student as any).fatherContact,
          motherName: snap?.motherName ?? (student as any).motherName,
          motherContact: snap?.motherContact ?? (student as any).motherContact,
          ipCommunity: snap?.ipCommunity ?? (student as any).ipCommunity,
          is4PsBeneficiary: snap?.is4PsBeneficiary ?? (student as any).is4PsBeneficiary,
          disability: snap?.disability ?? (student as any).disability,
          isBalikAral: snap?.isBalikAral ?? (student as any).isBalikAral,
        },
        enrollment: {
          sectionName: currentEnrollment.section.name,
          gradeLevel: currentEnrollment.section.gradeLevel,
          program: currentEnrollment.section.program,
          schoolYear: currentEnrollment.schoolYear,
          status: currentEnrollment.status,
        },
        subjectGrades: mergedSubjectGrades,
        summary: {
          generalAverage,
          honors,
          promotionStatus,
          totalSubjects: academicSubjects.length,
          completedSubjects: finalGrades.length,
        },
      });
    } catch (error) {
      logger.error("Error fetching student grades:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

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
          const academicSubjects = classAssignments;

          // Compute per-subject final grade from available terms, then average across subjects
          const subjectFinals = academicSubjects.map((ca) => {
            const termGrades = ca.grades
              .filter((g: Grade) => g.studentId === enrollment.studentId && g.quarterlyGrade !== null)
              .map((g: Grade) => g.quarterlyGrade as number);
            return termGrades.length > 0
              ? Math.round(termGrades.reduce((a, b) => a + b, 0) / termGrades.length)
              : null;
          }).filter((g): g is number => g !== null);

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
            totalSubjects: academicSubjects.length,
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
