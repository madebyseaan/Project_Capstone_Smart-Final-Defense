/**
 * sf5Composer.ts
 *
 * Centralized SF5 (Report on Promotion) assembly logic.
 * Both the data endpoint and the Excel export endpoint call this — one code path, zero drift.
 *
 * DepEd Order No. 8, s. 2015 — DO 73 scale (O/VS/S/FS/DNME) for descriptors.
 */

import { prisma } from "./prisma";
import { mergeRotationSubjects, SubjectTermInput, PASSING_GRADE } from "./promotion";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SF5SubjectDetail {
  subjectCode: string;
  subjectName: string;
  finalGrade: number | null;
  termGrades: Record<string, number | null>;
}

export interface SF5Student {
  lrn: string;
  name: string;
  firstName: string;
  lastName: string;
  middleName: string;
  gender: string;
  subjectDetails: SF5SubjectDetail[];
  generalAverage: number | null;
  descriptor: "O" | "VS" | "S" | "FS" | "DNME" | null;
  promotionStatus: "Promoted" | "Conditional" | "Retained" | "No Grades";
  failingSubjects: string[];
  incompleteSubjects: { prevSY: string[]; currentSY: string[] };
  attendance: { present: number; absent: number; late: number; excused: number; total: number };
}

export interface SF5Summary {
  totalStudents: number;
  promoted: number;
  conditional: number;
  retained: number;
  noGrades: number;
  male: { promoted: number; conditional: number; retained: number; noGrades: number };
  female: { promoted: number; conditional: number; retained: number; noGrades: number };
  descriptors: Record<"O" | "VS" | "S" | "FS" | "DNME", { male: number; female: number; total: number }>;
}

export interface SF5Data {
  section: {
    id: string;
    name: string;
    gradeLevel: string;
    program: string;
    schoolYear: string;
    adviser: string | null;
  };
  students: SF5Student[];
  summary: SF5Summary;
  schoolSettings: {
    schoolName: string;
    schoolId: string;
    division: string;
    region: string;
    district: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map raw grade to DO 8, s. 2015 descriptive letter. */
function mapDescriptor(grade: number | null): "O" | "VS" | "S" | "FS" | "DNME" | null {
  if (grade === null) return null;
  if (grade >= 90) return "O";
  if (grade >= 85) return "VS";
  if (grade >= 80) return "S";
  if (grade >= 75) return "FS";
  return "DNME";
}

/** Format GA: 2 decimal places (or 3 if >= 90 for honor transparency — keep consistent with SF10). */
function formatGA(grade: number | null): string {
  if (grade === null) return "";
  return grade >= 90 ? grade.toFixed(3) : grade.toFixed(2);
}

// ---------------------------------------------------------------------------
// Main composer
// ---------------------------------------------------------------------------

export async function composeSF5(
  sectionId: string,
  schoolYearLabel: string
): Promise<SF5Data> {
  // 1. Fetch section + adviser
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: { adviser: { include: { user: true } } },
  });
  if (!section) throw new Error("Section not found");

  // 2. Fetch school settings
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });

  // 3. Fetch enrollments (ENROLLED only — exclude DROPPED/TRANSFERRED per DepEd guidelines)
  const enrollments = await prisma.enrollment.findMany({
    where: { sectionId, schoolYear: schoolYearLabel, status: "ENROLLED" },
    include: { student: true },
  });

  // 4. Fetch class assignments + subjects
  const classAssignments = await prisma.classAssignment.findMany({
    where: { sectionId, schoolYear: schoolYearLabel },
    include: { subject: true },
  });

  // 5. Fetch grades
  const grades = await prisma.grade.findMany({
    where: { classAssignment: { sectionId, schoolYear: schoolYearLabel } },
    include: { classAssignment: { include: { subject: true } } },
  });

  // 6. Fetch attendance — filtered by school year date range
  const schoolYearRecord = await prisma.schoolYear.findUnique({
    where: { label: schoolYearLabel },
  });
  const attendanceWhere: any = { sectionId };
  if (schoolYearRecord?.startDate && schoolYearRecord?.endDate) {
    attendanceWhere.date = {
      gte: schoolYearRecord.startDate,
      lte: schoolYearRecord.endDate,
    };
  }
  const attendance = await prisma.attendance.groupBy({
    by: ["studentId", "status"],
    where: attendanceWhere,
    _count: { id: true },
  });

  // 7. Build per-student results
  const students: SF5Student[] = enrollments.map((enr) => {
    const studentGrades = grades.filter((g) => g.studentId === enr.student.id);
    const studentAttendance = attendance.filter((a) => a.studentId === enr.student.id);

    // Per-subject: compute final grade from available term grades
    // Merge rotational subjects (TLE, Science) so each rotation group = one subject
    const rotationInputs: SubjectTermInput[] = classAssignments
      .filter((ca) => !ca.subject.code.toUpperCase().startsWith("HG"))
      .map((ca) => {
        const caGrades = studentGrades.filter((g) => g.classAssignment.subject.code === ca.subject.code);
        const terms: Record<string, number | null> = { T1: null, T2: null, T3: null };
        for (const g of caGrades) {
          if (g.quarterlyGrade !== null && !terms[g.term]) {
            terms[g.term] = g.quarterlyGrade;
          }
        }
        return {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          T1: terms.T1,
          T2: terms.T2,
          T3: terms.T3,
          rotationTermGroupId: (ca.subject as any).rotationTermGroupId ?? null,
          rotationTermRank: (ca.subject as any).rotationTermRank ?? null,
          rotationOutputLabel: (ca.subject as any).rotationOutputLabel ?? null,
        };
      });

    const mergedSubjects = mergeRotationSubjects(rotationInputs);

    const subjectDetails: SF5SubjectDetail[] = [];
    const subjectFinals: number[] = [];
    const failingSubjects: string[] = [];
    const incompleteCurrent: string[] = [];

    for (const row of mergedSubjects) {
      const termValues = [row.T1, row.T2, row.T3].filter((v): v is number => v !== null);
      const finalGrade = termValues.length > 0
        ? Math.round(termValues.reduce((a, b) => a + b, 0) / termValues.length)
        : null;

      if (finalGrade !== null) subjectFinals.push(finalGrade);

      const subjectLabel = row.subjectCode;

      if (finalGrade === null) {
        incompleteCurrent.push(subjectLabel);
      } else if (finalGrade < PASSING_GRADE) {
        failingSubjects.push(subjectLabel);
        incompleteCurrent.push(subjectLabel);
      }

      subjectDetails.push({
        subjectCode: row.subjectCode,
        subjectName: row.subjectName,
        finalGrade,
        termGrades: { T1: row.T1, T2: row.T2, T3: row.T3 },
      });
    }

    // General average
    const generalAverage = subjectFinals.length > 0
      ? Math.round(subjectFinals.reduce((a, b) => a + b, 0) / subjectFinals.length)
      : null;

    const descriptor = mapDescriptor(generalAverage);

    // Promotion status — driven by failingSubjects (not incomplete)
    const failingCount = failingSubjects.length;
    const hasGrades = subjectFinals.length > 0;
    let promotionStatus: SF5Student["promotionStatus"];
    if (!hasGrades) {
      promotionStatus = "No Grades";
    } else if (failingCount === 0) {
      promotionStatus = "Promoted";
    } else if (failingCount <= 2) {
      promotionStatus = "Conditional";
    } else {
      promotionStatus = "Retained";
    }

    // Attendance
    const present = studentAttendance.find((a) => a.status === "PRESENT")?._count.id ?? 0;
    const absent = studentAttendance.find((a) => a.status === "ABSENT")?._count.id ?? 0;
    const late = studentAttendance.find((a) => a.status === "LATE")?._count.id ?? 0;
    const excused = studentAttendance.find((a) => a.status === "EXCUSED")?._count.id ?? 0;

    // Profile snapshot for historical accuracy
    const snap = enr.profileSnapshot as Record<string, any> | null;

    return {
      lrn: snap?.lrn ?? enr.student.lrn ?? "",
      name: `${enr.student.lastName}, ${enr.student.firstName} ${enr.student.middleName || ""}`.trim(),
      firstName: enr.student.firstName,
      lastName: enr.student.lastName,
      middleName: enr.student.middleName || "",
      gender: snap?.gender ?? enr.student.gender ?? "",
      subjectDetails,
      generalAverage,
      descriptor,
      promotionStatus,
      failingSubjects,
      incompleteSubjects: { prevSY: [], currentSY: incompleteCurrent },
      attendance: { present, absent, late, excused, total: present + absent + late + excused },
    };
  });

  // 8. Sort: males first, then females; alphabetical by last name within each block
  const sorted = [...students].sort((a, b) => {
    const genderOrder = (g: string) => (g?.toUpperCase() === "MALE" || g?.toUpperCase() === "M" ? 0 : 1);
    const gDiff = genderOrder(a.gender) - genderOrder(b.gender);
    if (gDiff !== 0) return gDiff;
    return a.lastName.localeCompare(b.lastName);
  });

  // 9. Build gender-disaggregated summaries
  const maleStudents = sorted.filter((s) => s.gender?.toUpperCase() === "MALE" || s.gender?.toUpperCase() === "M");
  const femaleStudents = sorted.filter((s) => s.gender?.toUpperCase() === "FEMALE" || s.gender?.toUpperCase() === "F");

  const countByStatus = (list: SF5Student[]) => ({
    promoted: list.filter((s) => s.promotionStatus === "Promoted").length,
    conditional: list.filter((s) => s.promotionStatus === "Conditional").length,
    retained: list.filter((s) => s.promotionStatus === "Retained").length,
    noGrades: list.filter((s) => s.promotionStatus === "No Grades").length,
  });

  const countByDescriptor = (list: SF5Student[]) => {
    const counts: Record<"O" | "VS" | "S" | "FS" | "DNME", number> = { O: 0, VS: 0, S: 0, FS: 0, DNME: 0 };
    for (const s of list) {
      if (s.descriptor) counts[s.descriptor]++;
    }
    return counts;
  };

  const maleCounts = countByStatus(maleStudents);
  const femaleCounts = countByStatus(femaleStudents);
  const maleDesc = countByDescriptor(maleStudents);
  const femaleDesc = countByDescriptor(femaleStudents);

  const summary: SF5Summary = {
    totalStudents: sorted.length,
    promoted: maleCounts.promoted + femaleCounts.promoted,
    conditional: maleCounts.conditional + femaleCounts.conditional,
    retained: maleCounts.retained + femaleCounts.retained,
    noGrades: maleCounts.noGrades + femaleCounts.noGrades,
    male: maleCounts,
    female: femaleCounts,
    descriptors: {
      O: { male: maleDesc.O, female: femaleDesc.O, total: maleDesc.O + femaleDesc.O },
      VS: { male: maleDesc.VS, female: femaleDesc.VS, total: maleDesc.VS + femaleDesc.VS },
      S: { male: maleDesc.S, female: femaleDesc.S, total: maleDesc.S + femaleDesc.S },
      FS: { male: maleDesc.FS, female: femaleDesc.FS, total: maleDesc.FS + femaleDesc.FS },
      DNME: { male: maleDesc.DNME, female: femaleDesc.DNME, total: maleDesc.DNME + femaleDesc.DNME },
    },
  };

  return {
    section: {
      id: section.id,
      name: section.name,
      gradeLevel: section.gradeLevel,
      program: section.program,
      schoolYear: schoolYearLabel,
      adviser: section.adviser
        ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}`
        : null,
    },
    students: sorted,
    summary,
    schoolSettings: {
      schoolName: settings?.schoolName ?? "",
      schoolId: settings?.schoolId ?? "",
      division: settings?.division ?? "",
      region: settings?.region ?? "",
      district: "", // No district field in SystemSettings
    },
  };
}
