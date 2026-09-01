import { Router, Response } from "express";
import { Term, EnrollmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../../middleware/auth";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { getTransmutationTable } from "../../lib/transmutationCache";
import { logger } from "../../lib/logger";
import {
  ClassAssignmentWithRelations,
  resolveCurrentTerm,
  resolveTermDeadline,
  resolveEffectiveWeightsForClassAssignment,
  isHomeroomGuidanceSubjectCode,
  calculateGrades,
} from "./helpers";

export default function registerDashboard(router: Router): void {
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

        // Aggregate stats — deduplicate rotational subjects (TLE, Science) by section
        // Each rotational component (e.g., SCI_BIO, SCI_CHEM, SCI_ES) shares the same students
        const allStudentsAtRisk = classStats.flatMap((cs: any) => cs.studentsAtRisk);

        // Deduplicate gradedCount by section+gradeLevel (rotational components share students)
        const seenSectionsForGraded = new Map<string, number>();
        for (const cs of classStats) {
          const key = `${cs.sectionName}::${cs.gradeLevel}`;
          if (!seenSectionsForGraded.has(key)) {
            seenSectionsForGraded.set(key, cs.gradedCount);
          } else {
            seenSectionsForGraded.set(key, Math.max(seenSectionsForGraded.get(key)!, cs.gradedCount));
          }
        }
        const totalGraded = Array.from(seenSectionsForGraded.values()).reduce((a, b) => a + b, 0);

        const seenSections = new Set<string>();
        const totalStudents = classStats.reduce((sum: number, cs: any) => {
          if (seenSections.has(cs.sectionName + cs.gradeLevel)) return sum;
          seenSections.add(cs.sectionName + cs.gradeLevel);
          return sum + cs.totalStudents;
        }, 0);

        const overallPassingRate = totalGraded > 0
          ? Math.round(classStats.reduce((sum: number, cs: any) => sum + (cs.passingRate * cs.gradedCount), 0) / totalGraded)
          : 0;

        // Grade submission rate: group by section, count each section once
        const academicClassStats = classStats.filter((cs: any) => !cs.subjectCode?.toUpperCase().startsWith('HG'));
        const sectionGradedMap = new Map<string, { total: number; graded: number }>();
        for (const cs of academicClassStats) {
          const key = `${cs.sectionName}::${cs.gradeLevel}`;
          const existing = sectionGradedMap.get(key);
          if (existing) {
            existing.total = Math.max(existing.total, cs.totalStudents);
            existing.graded = Math.max(existing.graded, cs.gradedCount);
          } else {
            sectionGradedMap.set(key, { total: cs.totalStudents, graded: cs.gradedCount });
          }
        }
        const uniqueSections = Array.from(sectionGradedMap.values());
        const gradeSubmissionRate = uniqueSections.length > 0
          ? Math.round(uniqueSections.filter((s) => s.graded >= s.total).length / uniqueSections.length * 100)
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

        let grades: any[] = [];
        if (selectedTerm === 'FINAL') {
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

          if (!studentGradesList || studentGradesList.length === 0) continue;

          const gwa = studentGradesList.reduce((sum: number, g: number) => sum + g, 0) / studentGradesList.length;
          const roundedGwa = Math.round(gwa);
          const studentName = `${enrollment.student.lastName}, ${enrollment.student.firstName}`;

          if (roundedGwa >= 90) {
            advisoryHonors.push({
              id: enrollment.student.id,
              name: studentName,
              grade: gwa,
              honor: roundedGwa >= 98 ? 'Highest Honors' : roundedGwa >= 95 ? 'High Honors' : 'Honors',
              class: advisorySection.name,
            });
          } else if (roundedGwa >= 85) {
            withHonors.push({
              id: enrollment.student.id,
              name: studentName,
              grade: gwa,
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

        const filteredAssignments = gradeLevel
          ? classAssignments.filter((ca: any) => ca.section.gradeLevel === gradeLevel)
          : classAssignments;

        const allGrades = filteredAssignments.flatMap((ca: any) => {
          if (isHomeroomGuidanceSubjectCode(ca.subject?.code)) return [];
          return ca.grades.filter((g: any) => g.quarterlyGrade !== null).map((g: any) => g.quarterlyGrade);
        });

        const distribution = {
          outstanding: allGrades.filter((g: number) => g >= 90 && g <= 100).length,
          verySatisfactory: allGrades.filter((g: number) => g >= 85 && g <= 89).length,
          satisfactory: allGrades.filter((g: number) => g >= 80 && g <= 84).length,
          fairlySatisfactory: allGrades.filter((g: number) => g >= 75 && g <= 79).length,
          didNotMeet: allGrades.filter((g: number) => g < 75).length,
        };

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
}
