/**
 * sf10.ts
 *
 * Shared SF10 (Permanent Academic Record) builder.
 * Used by the registrar JWT endpoint (/api/registrar/forms/sf10/:studentId)
 * and the service-level EnrollPro endpoint (/api/integration/students/:studentId/sf10-grades).
 */

import { prisma } from './prisma';
import { getActiveSchoolYearLabel } from './schoolYearResolver';
import { logger } from './logger';
import { getSchoolIdentityForYear, getSchoolIdentityByYears } from './schoolSettingsSnapshot';
import { mergeRotationSubjects, SubjectTermInput, PASSING_GRADE, promotionStatusLabel } from './promotion';
import {
  normalizeDisplaySex,
  isHomeroomGuidanceSubjectCode,
  isSubjectAlignedWithGrade,
  subjectCanonicalKey,
} from '../routes/registrar/helpers';
import { computeDisplayName } from './subjectDisplay';

export interface Sf10Response {
  student: {
    id: string;
    lrn: string;
    name: string;
    firstName: string;
    lastName: string;
    middleName: string;
    nameExtension: string;
    gender: string;
    birthDate: Date | null;
    address: string | null;
    guardianName: string | null;
    guardianContact: string | null;
    previousSchool: string | null;
    lastGradeCompleted: string | null;
    transferCertNo: string | null;
    isTransferee: boolean;
    transferInDate: Date | null;
  };
  schoolRecords: any[];
  schoolSettings: {
    schoolName: string;
    schoolId: string;
    division: string;
    region: string;
    schoolHeadName: string;
  };
}

export async function buildSf10Records(studentId: string): Promise<Sf10Response | null> {
  // Get student data with enrollments
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      enrollments: {
        include: {
          section: {
            include: {
              adviser: {
                include: { user: true }
              }
            }
          }
        },
        orderBy: { schoolYear: 'asc' }
      }
    }
  });

  if (!student) {
    return null;
  }

  // Resolve one canonical enrollment per school year, prioritizing ENROLLED entries.
  const enrollmentBySchoolYear = new Map<string, any>();
  student.enrollments.forEach((enrollment: any) => {
    const existing = enrollmentBySchoolYear.get(enrollment.schoolYear);
    if (!existing) {
      enrollmentBySchoolYear.set(enrollment.schoolYear, enrollment);
      return;
    }

    const existingScore = existing.status === 'ENROLLED' ? 2 : 1;
    const incomingScore = enrollment.status === 'ENROLLED' ? 2 : 1;
    if (incomingScore > existingScore) {
      enrollmentBySchoolYear.set(enrollment.schoolYear, enrollment);
      return;
    }

    if (incomingScore === existingScore && enrollment.createdAt > existing.createdAt) {
      enrollmentBySchoolYear.set(enrollment.schoolYear, enrollment);
    }
  });

  const canonicalEnrollments = Array.from(enrollmentBySchoolYear.values());

  // Sort canonicalEnrollments by school year desc to get the latest
  const sortedByYear = [...canonicalEnrollments].sort((a: any, b: any) => b.schoolYear.localeCompare(a.schoolYear));
  const currentEnrollment = sortedByYear[0];
  const currentSchoolYear = currentEnrollment?.schoolYear ?? await getActiveSchoolYearLabel();

  // SF10 shows ALL of the student's JHS enrollment history (Grades 7-10).
  // Retained students may have more years than their current grade level index.
  // Only exclude future school years (yearDiff < 0).
  const filteredCanonicalEnrollments = canonicalEnrollments.filter((e: any) => {
    const syStart = parseInt(e.schoolYear.split('-')[0]);
    const currentStart = parseInt(currentSchoolYear.split('-')[0]);
    const yearDiff = currentStart - syStart;
    return yearDiff >= 0;
  });

  // Build set of allowed school years for the grades loop
  const allowedSchoolYears = new Set(filteredCanonicalEnrollments.map((e: any) => e.schoolYear));

  // Get all section IDs from canonical enrollments
  const sectionIds = filteredCanonicalEnrollments.map((e: any) => e.sectionId);

  // Fetch all class assignments for these sections (schoolYear only — historical reads must survive rollover archiving)
  const classAssignments = await prisma.classAssignment.findMany({
    where: {
      sectionId: { in: sectionIds },
    },
    include: {
      subject: true,
      teacher: {
        include: { user: true }
      }
    }
  });

  // Get all grades for this student across all school years
  let grades = await prisma.grade.findMany({
    where: { studentId: studentId },
    include: {
      classAssignment: {
        include: {
          subject: true,
          section: true,
          teacher: {
            include: { user: true }
          }
        }
      }
    }
  });

  // Fetch all remedial classes for this student (for SF10 remedial section)
  const enrollmentIds = filteredCanonicalEnrollments.map((e: any) => e.id);
  const allRemedialClasses = await prisma.remedialClass.findMany({
    where: { enrollmentId: { in: enrollmentIds } },
    orderBy: { subjectName: "asc" },
  });
  const remedialByEnrollment = new Map<string, typeof allRemedialClasses>();
  for (const rc of allRemedialClasses) {
    const list = remedialByEnrollment.get(rc.enrollmentId) ?? [];
    list.push(rc);
    remedialByEnrollment.set(rc.enrollmentId, list);
  }

  // Fallback: if no Grade records found, try GradeSnapshot
  if (grades.length === 0) {
    const snapshots = await prisma.gradeSnapshot.findMany({
      where: { studentId: studentId },
      orderBy: { createdAt: "desc" }
    });

    if (snapshots.length > 0) {
      // Reconstruct grade-like objects from snapshots
      const snapshotGrades: any[] = [];
      for (const snap of snapshots) {
        const snapData = snap.snapshot as any;
        snapshotGrades.push({
          id: snap.id,
          studentId: snap.studentId,
          classAssignmentId: snap.classAssignmentId,
          term: snap.term,
          quarterlyGrade: snapData?.quarterlyGrade ?? null,
          writtenWorkPS: snapData?.writtenWorkPS ?? null,
          perfTaskPS: snapData?.perfTaskPS ?? null,
          quarterlyAssessPS: snapData?.quarterlyAssessPS ?? null,
          initialGrade: snapData?.initialGrade ?? null,
          classAssignment: {
            id: snap.classAssignmentId,
            subjectCode: snap.subjectCode,
            subjectName: snap.subjectName,
            sectionName: snap.sectionName,
            schoolYear: snap.schoolYear,
            isActive: false,
            subject: { code: snap.subjectCode, name: snap.subjectName },
            section: { name: snap.sectionName },
            teacher: null
          }
        });
      }
      grades = snapshotGrades;
    }
  }

  const nonNullQuarterCountByAssignment = new Map<string, number>();
  grades.forEach((g: any) => {
    if (g.quarterlyGrade === null) return;
    nonNullQuarterCountByAssignment.set(
      g.classAssignmentId,
      (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) + 1,
    );
  });

  const gradePriority = (g: any): number => {
    const activeScore = g.classAssignment?.isActive ? 10_000 : 0;
    const densityScore = (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) * 100;
    const freshnessScore = new Date(g.updatedAt).getTime() / 1e12;
    return activeScore + densityScore + freshnessScore;
  };

  // Organize by school year
  const academicHistory: Record<string, any> = {};

  filteredCanonicalEnrollments.forEach((enrollment: any) => {
    const sy = enrollment.schoolYear;
    if (!academicHistory[sy]) {
      academicHistory[sy] = {
        schoolYear: sy,
        gradeLevel: enrollment.section.gradeLevel,
        section: enrollment.section.name,
        program: enrollment.section.program ?? 'REGULAR',
        subjects: {}
      };
    }

    // Populate subjects based on class assignments for this enrollment's section
    const sectionAssignments = classAssignments.filter(
      (ca: any) => ca.sectionId === enrollment.sectionId && ca.schoolYear === sy
    );
    sectionAssignments.forEach((ca: any) => {
      if (isHomeroomGuidanceSubjectCode(ca.subject.code)) {
        return;
      }
      if (!isSubjectAlignedWithGrade(ca.subject.code, enrollment.section.gradeLevel)) {
        return;
      }

      const key = subjectCanonicalKey(ca.subject.code, ca.subject.name);
      if (!academicHistory[sy].subjects[key]) {
        academicHistory[sy].subjects[key] = {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.displayName ?? ca.subject.name,
          T1: null,
          T2: null,
          T3: null,
          finalGrade: null,
          rotationTermGroupId: ca.subject.rotationTermGroupId ?? null,
          rotationTermRank: ca.subject.rotationTermRank ?? null,
          rotationOutputLabel: ca.subject.rotationOutputLabel ?? null,
        };
      }
    });
  });

  [...grades].sort((a: any, b: any) => gradePriority(b) - gradePriority(a)).forEach((grade: any) => {
    const sy = grade.classAssignment.schoolYear;
    // Skip grades for school years beyond the student's current grade level
    if (!allowedSchoolYears.has(sy)) return;

    if (!academicHistory[sy]) {
      academicHistory[sy] = {
        schoolYear: sy,
        gradeLevel: grade.classAssignment.section.gradeLevel,
        section: grade.classAssignment.section.name,
        program: grade.classAssignment.section.program ?? 'REGULAR',
        subjects: {}
      };
    }

    if (isHomeroomGuidanceSubjectCode(grade.classAssignment.subject.code)) {
      return;
    }
    if (!isSubjectAlignedWithGrade(grade.classAssignment.subject.code, grade.classAssignment.section.gradeLevel)) {
      return;
    }

    const key = subjectCanonicalKey(grade.classAssignment.subject.code, grade.classAssignment.subject.name);
    if (!academicHistory[sy].subjects[key]) {
      academicHistory[sy].subjects[key] = {
        subjectCode: grade.classAssignment.subject.code,
        subjectName: grade.classAssignment.subject.displayName ?? grade.classAssignment.subject.name,
        T1: null,
        T2: null,
        T3: null,
        finalGrade: null,
        rotationTermGroupId: grade.classAssignment.subject.rotationTermGroupId ?? null,
        rotationTermRank: grade.classAssignment.subject.rotationTermRank ?? null,
        rotationOutputLabel: grade.classAssignment.subject.rotationOutputLabel ?? null,
      };
    }

    // Store term grade only if the slot is still empty (higher-priority rows run first).
    if (grade.term === 'T1' && academicHistory[sy].subjects[key].T1 === null) academicHistory[sy].subjects[key].T1 = grade.quarterlyGrade;
    if (grade.term === 'T2' && academicHistory[sy].subjects[key].T2 === null) academicHistory[sy].subjects[key].T2 = grade.quarterlyGrade;
    if (grade.term === 'T3' && academicHistory[sy].subjects[key].T3 === null) academicHistory[sy].subjects[key].T3 = grade.quarterlyGrade;
  });

  // Fetch school settings for SF10 metadata — per-year snapshots (no N+1)
  const yearLabels = [...new Set(filteredCanonicalEnrollments.map((e: any) => e.schoolYear))];
  const identityByYear = await getSchoolIdentityByYears(yearLabels);

  // Calculate final grades for each school year — merge rotational subjects first
  const schoolRecords = Object.values(academicHistory).map((year: any) => {
    // Build SubjectTermInput[] from the raw subjects map for rotation merging
    const rotationInputs: SubjectTermInput[] = Object.values(year.subjects).map((subject: any) => ({
      subjectCode: subject.subjectCode,
      subjectName: subject.subjectName,
      T1: subject.T1,
      T2: subject.T2,
      T3: subject.T3,
      rotationTermGroupId: (subject as any).rotationTermGroupId ?? null,
      rotationTermRank: (subject as any).rotationTermRank ?? null,
      rotationOutputLabel: (subject as any).rotationOutputLabel ?? null,
    }));

    const merged = mergeRotationSubjects(rotationInputs);

    const subjectGrades = merged
      .sort((a: any, b: any) => a.subjectName.localeCompare(b.subjectName))
      .map((row: any) => {
        const terms = [row.T1, row.T2, row.T3].filter((q: number | null) => q !== null);
        const finalGrade = terms.length > 0
          ? Math.round(terms.reduce((a: number, b: number) => a + b, 0) / terms.length)
          : null;
        return {
          subjectCode: row.subjectCode,
          subjectName: row.subjectName,
          T1: row.T1,
          T2: row.T2,
          T3: row.T3,
          final: finalGrade,
          remarks: finalGrade ? (finalGrade >= PASSING_GRADE ? "Passed" : "Failed") : null
        };
      });

    // Calculate general average from merged subjects
    const allFinals = subjectGrades.map((s: any) => s.final).filter((g: number | null) => g !== null) as number[];
    const generalAverage = allFinals.length > 0
      ? Math.round(allFinals.reduce((a: number, b: number) => a + b, 0) / allFinals.length)
      : null;

    // Resolve adviser name from the enrollment's section
    const enrollment = filteredCanonicalEnrollments.find((e: any) => e.schoolYear === year.schoolYear);
    let adviserName: string | undefined;
    if (enrollment?.section?.adviser?.user) {
      adviserName = `${enrollment.section.adviser.user.firstName} ${enrollment.section.adviser.user.lastName}`;
    }

    // Include profile snapshot from enrollment for historical accuracy
    const enrollmentForYear = filteredCanonicalEnrollments.find((e: any) => e.schoolYear === year.schoolYear);
    const profileSnapshot = enrollmentForYear?.profileSnapshot ?? null;

    const yearIdentity = identityByYear.get(year.schoolYear);

    return {
      schoolYear: year.schoolYear,
      gradeLevel: year.gradeLevel,
      section: year.section,
      program: year.program,
      school: yearIdentity?.schoolName || '',
      schoolId: yearIdentity?.schoolId || '',
      district: yearIdentity?.district || '',
      division: yearIdentity?.division || '',
      region: yearIdentity?.region || '',
      adviserName,
      transferInDate: enrollmentForYear?.transferInDate ?? null,
      subjectGrades,
      generalAverage,
      honors: generalAverage ? (generalAverage >= 98 ? "With Highest Honors" : generalAverage >= 95 ? "With High Honors" : generalAverage >= 90 ? "With Honors" : null) : null,
      promotionStatus: promotionStatusLabel(enrollmentForYear?.promotionStatus ?? null)
        ?? (generalAverage ? (subjectGrades.every((s: any) => !s.final || s.final >= 75) ? "Promoted" : "Retained") : null),
      remedialClasses: enrollmentForYear
        ? (remedialByEnrollment.get(enrollmentForYear.id) ?? []).map((rc) => ({
            learningAreas: computeDisplayName(rc.subjectCode, rc.subjectName),
            finalRating: String(rc.originalGrade),
            remedialClassMark: rc.remedialMark != null ? String(rc.remedialMark) : undefined,
            conductedFrom: rc.conductedFrom?.toISOString(),
            conductedTo: rc.conductedTo?.toISOString(),
            status: rc.status,
            outcome: rc.outcome,
          }))
        : [],
      profileSnapshot,
    };
  });

  // Certification block: use snapshot of student's most recent year in the record
  const sortedLabels = schoolRecords.map((r: any) => r.schoolYear).sort();
  const mostRecentLabel = sortedLabels[sortedLabels.length - 1];
  const certIdentity = mostRecentLabel
    ? await getSchoolIdentityForYear(mostRecentLabel)
    : null;

  // Transfer-in info reads from the LIVE student + most-recent enrollment.
  // profileSnapshot is frozen at enrollment time and never contains
  // registrar-completed transferee fields (see TRANSFEREE_PLAN §4.4).
  const latestEnrollment = sortedByYear[0] ?? null;
  const isTransferee = latestEnrollment?.transferInDate != null;
  const transferInDate = latestEnrollment?.transferInDate ?? null;

  logger.debug(`[SF10] Built ${schoolRecords.length} school records for student ${studentId}`);

  return {
    student: {
      id: student.id,
      lrn: student.lrn,
      name: `${student.lastName}, ${student.firstName} ${student.middleName || ""} ${student.suffix || ""}`.trim(),
      firstName: student.firstName,
      lastName: student.lastName,
      middleName: student.middleName || "",
      nameExtension: student.suffix || "",
      gender: normalizeDisplaySex(student.gender),
      birthDate: student.birthDate,
      address: student.address,
      guardianName: student.guardianName,
      guardianContact: student.guardianContact,
      previousSchool: student.previousSchool,
      lastGradeCompleted: student.lastGradeCompleted,
      transferCertNo: student.transferCertNo,
      isTransferee,
      transferInDate,
    },
    schoolRecords: schoolRecords.sort((a, b) => a.schoolYear.localeCompare(b.schoolYear)),
    schoolSettings: {
      schoolName: certIdentity?.schoolName || '',
      schoolId: certIdentity?.schoolId || '',
      division: certIdentity?.division || '',
      region: certIdentity?.region || '',
      schoolHeadName: certIdentity?.schoolHeadName || ''
    }
  };
}
