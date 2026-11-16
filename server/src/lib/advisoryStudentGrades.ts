import type { ClassAssignment, Grade, Subject } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Core builder for the teacher advisory student-grade profile
 * (`GET /api/advisory/student/:studentId/grades`).
 *
 * Extracted from the route so parity audits and regression tests exercise the
 * exact same logic the API serves.
 */

export interface AdvisoryGradeTerm {
  writtenWorkPS: number | null;
  perfTaskPS: number | null;
  quarterlyAssessPS: number | null;
  initialGrade: number | null;
  quarterlyGrade: number | null;
  qualitativeDescriptor: string | null;
  classAssignmentId?: string;
}

export type AdvisoryGradeTermKey = "T1" | "T2" | "T3";

export interface AdvisorySubjectGrade {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  subjectType: string;
  teacher: string;
  grades: Record<string, AdvisoryGradeTerm | null>;
  finalGrade: number | null;
  remarks: "PASSED" | "FAILED" | null;
  rotationTermGroupId: string | null;
  rotationTermRank: number | null;
  rotationOutputLabel: string | null;
}

export interface AdvisoryStudentGradesPayload {
  student: Record<string, unknown>;
  enrollment: {
    sectionName: string;
    gradeLevel: string;
    program: string;
    schoolYear: string;
    status: string;
  };
  subjectGrades: AdvisorySubjectGrade[];
  summary: {
    generalAverage: number | null;
    honors: string | null;
    promotionStatus: string | null;
    totalSubjects: number;
    completedSubjects: number;
  };
}

export type AdvisoryStudentGradesResult =
  | { ok: true; payload: AdvisoryStudentGradesPayload }
  | { ok: false; status: 403 | 404; message: string };

export function isHomeroomGuidanceCode(subjectCode: string | null | undefined): boolean {
  return (subjectCode ?? "").toUpperCase().startsWith("HG");
}

/**
 * Check if a subject code is aligned with a section's grade level.
 * Example: MATH7 is NOT aligned with GRADE_10.
 * Generic codes like MATH or ENG are considered aligned.
 */
export function isSubjectAlignedWithGrade(subjectCode: string, gradeLevel: string): boolean {
  const gradeSuffix = gradeLevel.replace("GRADE_", "");
  const code = subjectCode.toUpperCase();
  const match = code.match(/\d+$/);
  if (match) return match[0] === gradeSuffix;
  return true;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function toDisplayName(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

const SUBJECT_ACRONYMS = new Set(["TLE", "MAPEH", "ESP", "STE", "SPA", "SPS", "GMRC", "AP", "PE", "ICT", "HE"]);

export function toTitleCase(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? "")
    .split(" ")
    .filter(Boolean)
    .map((part) => (SUBJECT_ACRONYMS.has(part.toUpperCase())
      ? part.toUpperCase()
      : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");
}

export function subjectDedupKey(subjectCode: string, subjectName: string): string {
  return `${normalizeWhitespace(subjectCode).toUpperCase()}::${normalizeWhitespace(subjectName).toUpperCase()}`;
}

export function gradeSignalScore(assignment: { grades: Grade[]; updatedAt: Date }): number {
  const gradedQuarters = assignment.grades.filter(
    (g) =>
      g.quarterlyGrade !== null ||
      g.initialGrade !== null ||
      g.qualitativeDescriptor !== null,
  ).length;

  const scoredQuarters = assignment.grades.filter(
    (g) =>
      g.writtenWorkPS !== null ||
      g.perfTaskPS !== null ||
      g.quarterlyAssessPS !== null,
  ).length;

  // Weighted score to prefer rows with complete grading data, then recency.
  return gradedQuarters * 1000 + scoredQuarters * 100 + assignment.grades.length * 10 + assignment.updatedAt.getTime() / 1e12;
}

type ClassAssignmentWithGrades = ClassAssignment & {
  subject: Subject;
  grades: Grade[];
};

type ClassAssignmentWithTeacher = ClassAssignmentWithGrades & {
  teacher: { user: { firstName: string | null; lastName: string | null } };
};

export async function buildAdvisoryStudentGrades(options: {
  teacherId: string;
  studentId: string;
  schoolYear?: string;
}): Promise<AdvisoryStudentGradesResult> {
  const { teacherId, studentId, schoolYear } = options;

  // Get student with their enrollment
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      enrollments: {
        where: {
          ...(schoolYear ? { schoolYear } : {}),
          status: "ENROLLED",
        },
        include: {
          section: true,
        },
        orderBy: [{ schoolYear: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
    },
  });

  if (!student) {
    return { ok: false, status: 404, message: "Student not found" };
  }

  const currentEnrollment = student.enrollments[0];
  if (!currentEnrollment) {
    return { ok: false, status: 404, message: "Student not enrolled" };
  }

  // Verify teacher is adviser of this section
  const section = await prisma.section.findFirst({
    where: {
      id: currentEnrollment.sectionId,
      adviserId: teacherId,
    },
  });

  // Also allow if teacher teaches this student (any class assignment)
  const teachesStudent = await prisma.classAssignment.findFirst({
    where: {
      teacherId,
      sectionId: currentEnrollment.sectionId,
    },
  });

  if (!section && !teachesStudent) {
    return { ok: false, status: 403, message: "Not authorized to view this student" };
  }

  // Get all class assignments for this section
  // Filter for isActive: true to show current assignments only
  // Filter out Homeroom Guidance from this list
  const classAssignments = (await prisma.classAssignment.findMany({
    where: {
      sectionId: currentEnrollment.sectionId,
      schoolYear: currentEnrollment.schoolYear,
      isActive: true,
      subject: {
        NOT: {
          code: {
            startsWith: "HG",
            mode: "insensitive",
          },
        },
      },
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
  })) as ClassAssignmentWithTeacher[];

  // Keep all aligned assigned subjects for this section/year.
  // Duplicates are handled separately below by canonical subject key.
  const alignedAssignments = classAssignments.filter((ca) =>
    isSubjectAlignedWithGrade(ca.subject.code, currentEnrollment.section.gradeLevel),
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
    }, new Map<string, ClassAssignmentWithTeacher>()).values(),
  );

  // Grades can live on predecessor (archived) class assignments after a
  // teacher reassignment. The class record and SF9/SF10 composers already
  // inherit those grades; the profile must do the same or it shows Pending
  // for subjects whose grades were entered before the reassignment.
  const allAssignmentsForGrades = (await prisma.classAssignment.findMany({
    where: {
      sectionId: currentEnrollment.sectionId,
      schoolYear: currentEnrollment.schoolYear,
      subject: {
        NOT: {
          code: {
            startsWith: "HG",
            mode: "insensitive",
          },
        },
      },
    },
    include: {
      subject: true,
      grades: {
        where: { studentId },
      },
    },
  })) as ClassAssignmentWithGrades[];

  const nonNullQuarterCountByAssignment = new Map<string, number>();
  for (const assignment of allAssignmentsForGrades) {
    nonNullQuarterCountByAssignment.set(
      assignment.id,
      assignment.grades.filter((g) => g.quarterlyGrade !== null).length,
    );
  }

  // Per subject key, list grades by priority: active assignment first,
  // then the assignment with the most completed quarters, then freshest.
  const gradeCandidatesBySubject = new Map<string, Array<{ grade: Grade; priority: number }>>();
  for (const assignment of allAssignmentsForGrades) {
    if (!isSubjectAlignedWithGrade(assignment.subject.code, currentEnrollment.section.gradeLevel)) continue;
    if (isHomeroomGuidanceCode(assignment.subject.code)) continue;
    const key = subjectDedupKey(assignment.subject.code, assignment.subject.name);
    const list = gradeCandidatesBySubject.get(key) ?? [];
    const priorityBase =
      (assignment.isActive ? 10_000 : 0) +
      (nonNullQuarterCountByAssignment.get(assignment.id) ?? 0) * 100;
    for (const grade of assignment.grades) {
      list.push({ grade, priority: priorityBase + grade.updatedAt.getTime() / 1e12 });
    }
    gradeCandidatesBySubject.set(key, list);
  }

  // Format grades by subject
  const subjectGrades = dedupedAssignments.map((ca): AdvisorySubjectGrade => {
    const terms = ["T1", "T2", "T3"] as const;
    const gradesByTerm: Record<string, AdvisoryGradeTerm | null> = {};

    const candidates = [
      ...(gradeCandidatesBySubject.get(subjectDedupKey(ca.subject.code, ca.subject.name)) ?? []),
    ].sort((a, b) => b.priority - a.priority);

    terms.forEach((q) => {
      // Prefer a completed quarter; fall back to any row for partial scores.
      const grade = candidates.find((c) => c.grade.term === q && c.grade.quarterlyGrade !== null)?.grade
        ?? candidates.find((c) => c.grade.term === q)?.grade;
      gradesByTerm[q] = grade
        ? {
            writtenWorkPS: grade.writtenWorkPS,
            perfTaskPS: grade.perfTaskPS,
            quarterlyAssessPS: grade.quarterlyAssessPS,
            initialGrade: grade.initialGrade,
            quarterlyGrade: grade.quarterlyGrade,
            qualitativeDescriptor: grade.qualitativeDescriptor ?? null,
            classAssignmentId: grade.classAssignmentId,
          }
        : null;
    });

    // Calculate final grade (average of available term grades)
    const termGrades = Object.values(gradesByTerm)
      .filter((g): g is AdvisoryGradeTerm => g?.quarterlyGrade !== null && g?.quarterlyGrade !== undefined)
      .map((g) => g.quarterlyGrade as number);

    const finalGrade = termGrades.length > 0
      ? Math.round(termGrades.reduce((a, b) => a + b, 0) / termGrades.length)
      : null;

    return {
      subjectId: ca.subject.id,
      subjectCode: ca.subject.code,
      subjectName: ca.subject.name,
      subjectType: ca.subject.type,
      teacher: `${toDisplayName(ca.teacher.user.firstName)} ${toDisplayName(ca.teacher.user.lastName)}`.trim(),
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
    const mergedGrades: Record<string, AdvisoryGradeTerm | null> = { T1: null, T2: null, T3: null };
    for (const sub of sorted) {
      if (!sub.rotationTermRank) continue;
      const termKey = `T${sub.rotationTermRank}` as AdvisoryGradeTermKey;
      // Rotation grades belong to the sub-subject's rotation term.
      // SF9, SF10 and promotion use the same rule.
      const subGrade = sub.grades[termKey];
      if (subGrade) {
        mergedGrades[termKey] = subGrade;
      }
    }

    // Calculate final grade from available term grades
    const termGradeValues = Object.values(mergedGrades)
      .filter((g): g is AdvisoryGradeTerm => g?.quarterlyGrade !== null && g?.quarterlyGrade !== undefined)
      .map((g) => g.quarterlyGrade as number);
    const finalGrade = termGradeValues.length > 0
      ? Math.round(termGradeValues.reduce((a, b) => a + b, 0) / termGradeValues.length)
      : null;

    mergedRotationRows.push({
      subjectId: sorted[0].subjectId,
      subjectCode: sorted[0].rotationOutputLabel ?? sorted[0].subjectCode,
      subjectName: toTitleCase(sorted[0].rotationOutputLabel ?? sorted[0].subjectName),
      subjectType: sorted[0].subjectType,
      teacher: [...new Set(sorted.map((r) => r.teacher).filter(Boolean))].join(" / "),
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

  return {
    ok: true,
    payload: {
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
    },
  };
}
