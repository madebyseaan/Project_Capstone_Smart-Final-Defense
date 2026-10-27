/**
 * sf9Composer.ts
 *
 * Single source of truth for SF9 (Learner's Progress Report Card) and the
 * temporary per-term progress card. Both the registrar SF9 endpoint and the
 * teacher advisory printables endpoints build their payloads here so grade
 * rules cannot drift between portals.
 *
 * Historical/form query rule (AGENTS.md): all reads filter by schoolYear only,
 * never by ClassAssignment.isActive / Enrollment.isArchived.
 */

import type {
  ClassAssignment,
  Grade,
  PromotionStatus,
  Section,
  Student,
  Subject,
  Teacher,
  Term,
  User,
} from "@prisma/client";
import { prisma } from "./prisma";
import { getSchoolIdentityForYear } from "./schoolSettingsSnapshot";
import { buildSf9Attendance, buildTermAttendance, type Sf9Attendance, type TermAttendance } from "./attendanceAggregate";
import {
  derivePromotionStatus,
  PASSING_GRADE,
  promotionStatusLabel,
  type RemedialOutcomeInput,
  type SubjectFinalRow,
} from "./promotion";
import { getGradeLockState } from "./gradeLocks";
import { OBSERVED_VALUE_GROUPS } from "./observedValues";
import {
  isHomeroomGuidanceSubjectCode,
  isSubjectAlignedWithGrade,
  normalizeDisplaySex,
  subjectCanonicalKey,
  toDisplayName,
  toTitleCase,
} from "../routes/registrar/helpers";

export type Sf9Term = "T1" | "T2" | "T3";
export type Sf9Mode = "SF9" | "TERM_CARD";
export type Sf9TermStatus = "DRAFT" | "FINAL";

export interface Sf9Meta {
  mode: Sf9Mode;
  schoolYear: string;
  generatedAt: string;
  isTemporary: boolean;
  term?: Sf9Term;
  termLabel?: string;
  termStatus?: Sf9TermStatus;
  termStartDate?: string | null;
  termEndDate?: string | null;
  termDatesDerived?: boolean;
}

export interface Sf9StudentInfo {
  id: string;
  lrn: string;
  name: string;
  gender: string;
  birthDate?: Date | string | null;
  age?: number | null;
  section: string;
  gradeLevel: string;
  schoolYear: string;
  adviser?: string | null;
}

export interface Sf9SubjectGrade {
  subjectCode: string;
  subjectName: string;
  teacher?: string;
  T1?: number | null;
  T2?: number | null;
  T3?: number | null;
  final?: number | null;
  remarks?: string | null;
}

export interface Sf9TermSubject {
  subjectCode: string;
  subjectName: string;
  teacher?: string;
  grade: number | null;
  remarks: "Passed" | "Failed" | null;
}

export interface Sf9ValueRow {
  code: string;
  coreValue: string;
  statement: string;
  T1?: string | null;
  T2?: string | null;
  T3?: string | null;
}

export interface Sf9SchoolSettings {
  schoolName: string;
  division: string;
  region: string;
  schoolHeadName: string;
}

export interface Sf9FullPayload {
  meta: Sf9Meta & { mode: "SF9"; isTemporary: false; term?: never };
  student: Sf9StudentInfo;
  subjectGrades: Sf9SubjectGrade[];
  attendance: Sf9Attendance;
  values: Sf9ValueRow[];
  generalAverage?: number | null;
  honors?: string | null;
  promotionStatus?: string | null;
  schoolSettings?: Sf9SchoolSettings;
}

export interface Sf9TermCardPayload {
  meta: Sf9Meta & {
    mode: "TERM_CARD";
    isTemporary: true;
    term: Sf9Term;
    termStatus: Sf9TermStatus;
  };
  student: Sf9StudentInfo;
  termSubjects: Sf9TermSubject[];
  termAverage: number | null;
  termAttendance: TermAttendance | null;
  schoolSettings?: Sf9SchoolSettings;
}

export type Sf9Payload = Sf9FullPayload | Sf9TermCardPayload;

export interface Sf9SectionInfo {
  id: string;
  name: string;
  gradeLevel: string;
  schoolYear: string;
  adviser: string | null;
  totalStudents: number;
}

export interface Sf9ComposeResult {
  meta: Sf9Meta;
  section: Sf9SectionInfo;
  students: Sf9Payload[];
}

export interface ComposeSf9SectionOptions {
  sectionId: string;
  schoolYear: string;
  term?: Sf9Term;
  /** Restrict to specific learners (single-learner printing). */
  studentIds?: string[];
  /** Single-learner printing must include DROPPED / TRANSFERRED rows. */
  includeNonEnrolled?: boolean;
}

type AssignmentWithSubjectTeacher = ClassAssignment & {
  subject: Subject;
  teacher: Teacher & { user: Pick<User, "firstName" | "lastName"> };
};

type EnrollmentWithStudent = {
  id: string;
  studentId: string;
  sectionId: string;
  schoolYear: string;
  status: string;
  profileSnapshot: unknown;
  promotionStatus: PromotionStatus | null;
  student: Student;
};

interface SubjectRow {
  subjectCode: string;
  subjectName: string;
  teacher: string;
  T1: number | null;
  T2: number | null;
  T3: number | null;
  finalGrade: number | null;
  rotationTermGroupId: string | null;
  rotationTermRank: number | null;
  rotationOutputLabel: string | null;
}

const TERM_KEYS: Sf9Term[] = ["T1", "T2", "T3"];

function teacherName(assignment: AssignmentWithSubjectTeacher): string {
  const user = assignment.teacher.user;
  return `${toDisplayName(user.firstName ?? "")} ${toDisplayName(user.lastName ?? "")}`.trim();
}

function adviserName(section: Section & { adviser: (Teacher & { user: Pick<User, "firstName" | "lastName"> }) | null }): string | null {
  if (!section.adviser) return null;
  return `${section.adviser.user.firstName ?? ""} ${section.adviser.user.lastName ?? ""}`.trim();
}

function computeAge(birthDate: Date | null | undefined): number | null {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function roundAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildSubjectRows(
  studentGrades: Grade[],
  assignments: AssignmentWithSubjectTeacher[],
  gradeLevel: string,
): { rows: SubjectRow[]; includedAssignmentIds: Set<string> } {
  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const includedAssignmentIds = new Set(
    assignments
      .filter(
        (assignment) =>
          !isHomeroomGuidanceSubjectCode(assignment.subject.code) &&
          isSubjectAlignedWithGrade(assignment.subject.code, gradeLevel),
      )
      .map((assignment) => assignment.id),
  );

  const nonNullQuarterCountByAssignment = new Map<string, number>();
  for (const grade of studentGrades) {
    if (grade.quarterlyGrade === null) continue;
    nonNullQuarterCountByAssignment.set(
      grade.classAssignmentId,
      (nonNullQuarterCountByAssignment.get(grade.classAssignmentId) ?? 0) + 1,
    );
  }

  const gradePriority = (grade: Grade): number => {
    const assignment = assignmentById.get(grade.classAssignmentId);
    const activeScore = assignment?.isActive ? 10_000 : 0;
    const densityScore = (nonNullQuarterCountByAssignment.get(grade.classAssignmentId) ?? 0) * 100;
    const freshnessScore = new Date(grade.updatedAt).getTime() / 1e12;
    return activeScore + densityScore + freshnessScore;
  };

  const subjectGrades: Record<string, SubjectRow> = {};

  const ensureRow = (assignment: AssignmentWithSubjectTeacher): SubjectRow => {
    const key = subjectCanonicalKey(assignment.subject.code, assignment.subject.name);
    if (!subjectGrades[key]) {
      subjectGrades[key] = {
        subjectCode: assignment.subject.code,
        subjectName: assignment.subject.displayName ?? assignment.subject.name,
        teacher: teacherName(assignment),
        T1: null,
        T2: null,
        T3: null,
        finalGrade: null,
        rotationTermGroupId: assignment.subject.rotationTermGroupId ?? null,
        rotationTermRank: assignment.subject.rotationTermRank ?? null,
        rotationOutputLabel: assignment.subject.rotationOutputLabel ?? null,
      };
    }
    return subjectGrades[key];
  };

  for (const assignment of assignments) {
    if (isHomeroomGuidanceSubjectCode(assignment.subject.code)) continue;
    if (!isSubjectAlignedWithGrade(assignment.subject.code, gradeLevel)) continue;
    ensureRow(assignment);
  }

  [...studentGrades]
    .sort((a, b) => gradePriority(b) - gradePriority(a))
    .forEach((grade) => {
      const assignment = assignmentById.get(grade.classAssignmentId);
      if (!assignment) return;
      if (isHomeroomGuidanceSubjectCode(assignment.subject.code)) return;
      if (!isSubjectAlignedWithGrade(assignment.subject.code, gradeLevel)) return;

      const row = ensureRow(assignment);
      if (grade.quarterlyGrade !== null && row[grade.term as Term] === null) {
        row[grade.term as Term] = grade.quarterlyGrade;
      }
    });

  const rotationGroups: Record<string, SubjectRow[]> = {};
  const standaloneRows: SubjectRow[] = [];

  for (const row of Object.values(subjectGrades)) {
    if (row.rotationTermGroupId) {
      const group = rotationGroups[row.rotationTermGroupId] ?? [];
      group.push(row);
      rotationGroups[row.rotationTermGroupId] = group;
    } else {
      standaloneRows.push(row);
    }
  }

  const mergedRotationRows: SubjectRow[] = [];
  for (const groupRows of Object.values(rotationGroups)) {
    const sorted = [...groupRows].sort((a, b) => (a.rotationTermRank ?? 0) - (b.rotationTermRank ?? 0));
    const representative = sorted[0];
    const merged: SubjectRow = {
      subjectCode: representative.rotationOutputLabel ?? representative.subjectCode,
      subjectName: toTitleCase(representative.rotationOutputLabel ?? representative.subjectName),
      teacher: sorted.map((row) => row.teacher).filter(Boolean).join(" / "),
      T1: null,
      T2: null,
      T3: null,
      finalGrade: null,
      rotationTermGroupId: representative.rotationTermGroupId,
      rotationTermRank: null,
      rotationOutputLabel: representative.rotationOutputLabel,
    };

    for (const sub of sorted) {
      if (!sub.rotationTermRank) continue;
      const termKey = `T${sub.rotationTermRank}` as Sf9Term;
      const bestGrade = sub.T1 ?? sub.T2 ?? sub.T3 ?? null;
      if (bestGrade !== null) {
        merged[termKey] = bestGrade;
      }
    }

    const availableTerms = TERM_KEYS
      .map((term) => merged[term])
      .filter((value): value is number => value !== null);
    if (availableTerms.length > 0) {
      merged.finalGrade = roundAverage(availableTerms);
    }

    mergedRotationRows.push(merged);
  }

  for (const row of standaloneRows) {
    const availableTerms = TERM_KEYS
      .map((term) => row[term])
      .filter((value): value is number => value !== null);
    if (availableTerms.length > 0) {
      row.finalGrade = roundAverage(availableTerms);
    }
  }

  return { rows: [...standaloneRows, ...mergedRotationRows], includedAssignmentIds };
}

function toSubjectFinalRows(rows: SubjectRow[]): SubjectFinalRow[] {
  return rows.map((row) => ({
    subjectCode: row.subjectCode,
    subjectName: row.subjectName,
    teacher: row.teacher ?? "",
    T1: row.T1 ?? null,
    T2: row.T2 ?? null,
    T3: row.T3 ?? null,
    finalRating: row.finalGrade ?? null,
    remarks: row.finalGrade !== null ? (row.finalGrade >= PASSING_GRADE ? "Passed" : "Failed") : null,
    status: row.finalGrade !== null ? "GRADED" : "NG",
  }));
}

function buildTermSubjects(rows: SubjectRow[], term: Sf9Term): Sf9TermSubject[] {
  return [...rows]
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName))
    .map((row) => {
      const grade = row[term] ?? null;
      return {
        subjectCode: row.subjectCode,
        subjectName: row.subjectName,
        teacher: row.teacher,
        grade,
        remarks: grade !== null ? (grade >= PASSING_GRADE ? "Passed" : "Failed") : null,
      };
    });
}

function toIsoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function termRange(
  settings: {
    t1StartDate: Date | null;
    t1EndDate: Date | null;
    t2StartDate: Date | null;
    t2EndDate: Date | null;
    t3StartDate: Date | null;
    t3EndDate: Date | null;
    termDatesDerived: boolean;
  } | null,
  term: Sf9Term,
): { startDate: Date | null; endDate: Date | null; derived: boolean } {
  if (!settings) return { startDate: null, endDate: null, derived: false };
  if (term === "T1") {
    return { startDate: settings.t1StartDate, endDate: settings.t1EndDate, derived: settings.termDatesDerived };
  }
  if (term === "T2") {
    return { startDate: settings.t2StartDate, endDate: settings.t2EndDate, derived: settings.termDatesDerived };
  }
  return { startDate: settings.t3StartDate, endDate: settings.t3EndDate, derived: settings.termDatesDerived };
}

function termLabel(
  yearRow: { termLabelT1: string; termLabelT2: string; termLabelT3: string } | null,
  term: Sf9Term,
): string {
  if (term === "T1") return yearRow?.termLabelT1 || "Term 1";
  if (term === "T2") return yearRow?.termLabelT2 || "Term 2";
  return yearRow?.termLabelT3 || "Term 3";
}

function baseMeta(schoolYear: string, term?: Sf9Term, label?: string, range?: { startDate: Date | null; endDate: Date | null; derived: boolean } | null): Sf9Meta {
  if (!term) {
    return {
      mode: "SF9",
      schoolYear,
      generatedAt: new Date().toISOString(),
      isTemporary: false,
    };
  }

  return {
    mode: "TERM_CARD",
    schoolYear,
    generatedAt: new Date().toISOString(),
    isTemporary: true,
    term,
    termLabel: label ?? `Term ${term.slice(1)}`,
    termStartDate: toIsoDate(range?.startDate),
    termEndDate: toIsoDate(range?.endDate),
    termDatesDerived: range?.derived ?? false,
  };
}

/**
 * Compose SF9 / term-card payloads for every learner in a section (or a subset).
 * Returns null when the section does not exist.
 */
export async function composeSf9Section(options: ComposeSf9SectionOptions): Promise<Sf9ComposeResult | null> {
  const section = await prisma.section.findUnique({
    where: { id: options.sectionId },
    include: {
      adviser: {
        include: {
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!section) return null;

  const enrollments = (await prisma.enrollment.findMany({
    where: {
      sectionId: options.sectionId,
      schoolYear: options.schoolYear,
      ...(options.studentIds !== undefined ? { studentId: { in: options.studentIds } } : {}),
      ...(options.includeNonEnrolled ? {} : { status: "ENROLLED" as const }),
    },
    include: { student: true },
    orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
  })) as EnrollmentWithStudent[];

  const sectionInfo: Sf9SectionInfo = {
    id: section.id,
    name: section.name,
    gradeLevel: section.gradeLevel,
    schoolYear: section.schoolYear,
    adviser: adviserName(section),
    totalStudents: enrollments.length,
  };

  let termContext: {
    term: Sf9Term;
    label: string;
    range: { startDate: Date | null; endDate: Date | null; derived: boolean };
    locked: boolean;
  } | null = null;

  if (options.term) {
    const [yearRow, settings, lockState] = await Promise.all([
      prisma.schoolYear.findUnique({
        where: { label: options.schoolYear },
        select: { termLabelT1: true, termLabelT2: true, termLabelT3: true },
      }),
      prisma.systemSettings.findUnique({
        where: { id: "main" },
        select: {
          t1StartDate: true,
          t1EndDate: true,
          t2StartDate: true,
          t2EndDate: true,
          t3StartDate: true,
          t3EndDate: true,
          termDatesDerived: true,
        },
      }),
      getGradeLockState(options.schoolYear),
    ]);

    termContext = {
      term: options.term,
      label: termLabel(yearRow, options.term),
      range: termRange(settings, options.term),
      locked: lockState.termLocks[options.term] || lockState.yearLocked,
    };
  }

  const meta = baseMeta(
    options.schoolYear,
    termContext?.term,
    termContext?.label,
    termContext?.range ?? null,
  );

  if (enrollments.length === 0) {
    return { meta, section: sectionInfo, students: [] };
  }

  const studentIds = enrollments.map((enrollment) => enrollment.studentId);
  const enrollmentIds = enrollments.map((enrollment) => enrollment.id);

  const [assignments, grades, attendanceRecords, remedialRows, schoolIdentity] = await Promise.all([
    prisma.classAssignment.findMany({
      where: { sectionId: options.sectionId, schoolYear: options.schoolYear },
      include: {
        subject: true,
        teacher: {
          include: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }) as Promise<AssignmentWithSubjectTeacher[]>,
    prisma.grade.findMany({
      where: {
        studentId: { in: studentIds },
        classAssignment: { sectionId: options.sectionId, schoolYear: options.schoolYear },
      },
    }),
    prisma.attendance.findMany({
      where: {
        studentId: { in: studentIds },
        section: { schoolYear: options.schoolYear },
      },
      select: { studentId: true, date: true, status: true },
    }),
    prisma.remedialClass.findMany({
      where: { enrollmentId: { in: enrollmentIds } },
      select: {
        enrollmentId: true,
        subjectCode: true,
        subjectName: true,
        outcome: true,
        recomputedGrade: true,
      },
    }),
    getSchoolIdentityForYear(options.schoolYear),
  ]);

  const gradesByStudent = new Map<string, Grade[]>();
  for (const grade of grades) {
    const list = gradesByStudent.get(grade.studentId) ?? [];
    list.push(grade);
    gradesByStudent.set(grade.studentId, list);
  }

  const attendanceByStudent = new Map<string, typeof attendanceRecords>();
  for (const record of attendanceRecords) {
    const list = attendanceByStudent.get(record.studentId) ?? [];
    list.push(record);
    attendanceByStudent.set(record.studentId, list);
  }

  const remedialByEnrollment = new Map<string, RemedialOutcomeInput[]>();
  for (const row of remedialRows) {
    const list = remedialByEnrollment.get(row.enrollmentId) ?? [];
    list.push({
      subjectCode: row.subjectCode,
      subjectName: row.subjectName,
      outcome: row.outcome,
      recomputedGrade: row.recomputedGrade,
    });
    remedialByEnrollment.set(row.enrollmentId, list);
  }

  const observedValueRows = options.term
    ? []
    : await prisma.studentObservedValue.findMany({
        where: {
          studentId: { in: studentIds },
          schoolYear: options.schoolYear,
        },
        select: {
          studentId: true,
          term: true,
          behaviorCode: true,
          rating: true,
        },
      });

  const observedByStudent = new Map<string, Map<string, Partial<Record<Sf9Term, string>>>>();
  for (const row of observedValueRows) {
    const behaviorMap = observedByStudent.get(row.studentId) ?? new Map<string, Partial<Record<Sf9Term, string>>>();
    const termRatings = behaviorMap.get(row.behaviorCode) ?? {};
    termRatings[row.term as Sf9Term] = row.rating;
    behaviorMap.set(row.behaviorCode, termRatings);
    observedByStudent.set(row.studentId, behaviorMap);
  }

  const schoolSettings: Sf9SchoolSettings = {
    schoolName: schoolIdentity.schoolName,
    division: schoolIdentity.division,
    region: schoolIdentity.region,
    schoolHeadName: schoolIdentity.schoolHeadName,
  };

  const students: Sf9Payload[] = enrollments.map((enrollment) => {
    const studentGrades = gradesByStudent.get(enrollment.studentId) ?? [];
    const { rows, includedAssignmentIds } = buildSubjectRows(
      studentGrades,
      assignments,
      section.gradeLevel,
    );

    const studentAttendance = attendanceByStudent.get(enrollment.studentId) ?? [];
    const studentRemedial = remedialByEnrollment.get(enrollment.id) ?? [];
    const studentObservedValues = observedByStudent.get(enrollment.studentId);
    const snapshot = enrollment.profileSnapshot as Record<string, unknown> | null;
    const student = enrollment.student;

    const studentInfo: Sf9StudentInfo = {
      id: student.id,
      lrn: (snapshot?.lrn as string | undefined) ?? student.lrn,
      name: `${student.lastName}, ${student.firstName} ${student.middleName || ""} ${student.suffix || ""}`.trim(),
      gender: normalizeDisplaySex((snapshot?.gender as string | undefined) ?? student.gender),
      birthDate: student.birthDate,
      age: computeAge(student.birthDate),
      section: section.name,
      gradeLevel: section.gradeLevel,
      schoolYear: enrollment.schoolYear,
      adviser: adviserName(section),
    };

    if (!termContext) {
      const subjectGrades = [...rows]
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName))
        .map((row) => ({
          subjectCode: row.subjectCode,
          subjectName: row.subjectName,
          teacher: row.teacher,
          T1: row.T1,
          T2: row.T2,
          T3: row.T3,
          final: row.finalGrade,
          remarks: row.finalGrade !== null
            ? (row.finalGrade >= PASSING_GRADE ? "Passed" : "Failed")
            : null,
        }));

      const finalGrades = rows
        .map((row) => row.finalGrade)
        .filter((grade): grade is number => grade !== null);
      const generalAverage = finalGrades.length > 0
        ? roundAverage(finalGrades)
        : null;

      const honors = generalAverage === null
        ? null
        : generalAverage >= 98
          ? "With Highest Honors"
          : generalAverage >= 95
            ? "With High Honors"
            : generalAverage >= 90
              ? "With Honors"
              : null;

      const promotionStatus = promotionStatusLabel(enrollment.promotionStatus ?? null)
        ?? promotionStatusLabel(
          derivePromotionStatus(
            section.gradeLevel,
            toSubjectFinalRows(rows),
            studentRemedial,
          ),
        );

      const payload: Sf9FullPayload = {
        meta: meta as Sf9FullPayload["meta"],
        student: studentInfo,
        subjectGrades,
        attendance: buildSf9Attendance(studentAttendance, options.schoolYear),
        values: OBSERVED_VALUE_GROUPS.flatMap((group) =>
          group.behaviors.map((behavior) => {
            const ratings = studentObservedValues?.get(behavior.code);
            return {
              code: behavior.code,
              coreValue: group.coreValue,
              statement: behavior.statement,
              T1: ratings?.T1 ?? null,
              T2: ratings?.T2 ?? null,
              T3: ratings?.T3 ?? null,
            };
          }),
        ),
        generalAverage,
        honors,
        promotionStatus,
        schoolSettings,
      };

      return payload;
    }

    const term = termContext.term;
    const termSubjects = buildTermSubjects(rows, term);
    const termGradeValues = termSubjects
      .map((subject) => subject.grade)
      .filter((grade): grade is number => grade !== null);
    const termAverage = termGradeValues.length > 0
      ? roundTwoDecimals(termGradeValues.reduce((sum, value) => sum + value, 0) / termGradeValues.length)
      : null;

    const gradedTermRows = studentGrades.filter(
      (grade) =>
        grade.term === term &&
        grade.quarterlyGrade !== null &&
        includedAssignmentIds.has(grade.classAssignmentId),
    );
    const hasTermGrades = gradedTermRows.length > 0;
    const allFinalized =
      hasTermGrades &&
      gradedTermRows.every((grade) => grade.status === "FINALIZED" || grade.status === "LOCKED");
    const termStatus: Sf9TermStatus =
      hasTermGrades && (termContext.locked || allFinalized) ? "FINAL" : "DRAFT";

    const payload: Sf9TermCardPayload = {
      meta: {
        ...meta,
        mode: "TERM_CARD",
        isTemporary: true,
        term,
        termStatus,
      },
      student: studentInfo,
      termSubjects,
      termAverage,
      termAttendance: buildTermAttendance(
        studentAttendance,
        termContext.range.startDate,
        termContext.range.endDate,
      ),
      schoolSettings,
    };

    return payload;
  });

  return { meta, section: sectionInfo, students };
}

/**
 * Compose the payload for one learner. Returns null when the learner has no
 * enrollment for the school year.
 */
export async function composeSf9ForStudent(options: {
  studentId: string;
  schoolYear: string;
  term?: Sf9Term;
}): Promise<Sf9Payload | null> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId: options.studentId, schoolYear: options.schoolYear },
    orderBy: { createdAt: "desc" },
    select: { sectionId: true },
  });

  if (!enrollment) return null;

  const result = await composeSf9Section({
    sectionId: enrollment.sectionId,
    schoolYear: options.schoolYear,
    term: options.term,
    studentIds: [options.studentId],
    includeNonEnrolled: true,
  });

  return result?.students[0] ?? null;
}
