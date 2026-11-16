/**
 * advisory-inheritance.test.ts â€” predecessor (archived assignment) grade
 * inheritance for the advisory student profile.
 *
 * Locks the behavior fixed after ATLAS reassignments:
 *   - grades entered before a teacher change remain visible on the profile;
 *   - the active assignment wins when both active and archived have grades;
 *   - a subject with only archived grades still renders its terms;
 *   - authorization stays adviser-or-teacher-of-section.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { buildAdvisoryStudentGrades } from "../lib/advisoryStudentGrades";

const YEAR = "2077-2078";

let teacherUserId = "";
let teacherId = "";
let otherTeacherId = "";
let outsiderTeacherId = "";
let otherUserId = "";
let outsiderUserId = "";
let studentId = "";
let sectionId = "";
const subjectIds: string[] = [];
const classAssignmentIds: string[] = [];
const enrollmentIds: string[] = [];

async function cleanup() {
  await prisma.grade.deleteMany({ where: { classAssignment: { schoolYear: YEAR } } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.section.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: { in: [teacherId, otherTeacherId, outsiderTeacherId].filter(Boolean) } } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { employeeId: { startsWith: "EMP-ADV-" } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [teacherUserId, otherUserId, outsiderUserId].filter(Boolean) } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { username: { startsWith: "t-advisory-" } } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: studentId || "none" } }).catch(() => {});
}

async function createAssignment(params: {
  subjectId: string;
  isActive: boolean;
  teacherIdOverride?: string;
  grades: Array<{ term: "T1" | "T2" | "T3"; quarterlyGrade: number | null }>;
}) {
  const assignment = await prisma.classAssignment.create({
    data: {
      sectionId,
      subjectId: params.subjectId,
      teacherId: params.teacherIdOverride ?? teacherId,
      schoolYear: YEAR,
      isActive: params.isActive,
      ...(params.isActive ? {} : { archivedAt: new Date(), archivedReason: "ATLAS_REASSIGNED" }),
    },
  });
  classAssignmentIds.push(assignment.id);
  for (const grade of params.grades) {
    await prisma.grade.create({
      data: {
        studentId,
        classAssignmentId: assignment.id,
        term: grade.term,
        writtenWorkScores: [],
        perfTaskScores: [],
        writtenWorkPS: 80,
        perfTaskPS: 80,
        quarterlyAssessPS: 80,
        initialGrade: 80,
        quarterlyGrade: grade.quarterlyGrade,
      },
    });
  }
  return assignment;
}

beforeAll(async () => {
  const suffix = Date.now();
  await cleanup();

  const schoolYearExists = await prisma.schoolYear.findUnique({ where: { label: YEAR } });
  if (!schoolYearExists) {
    await prisma.schoolYear.create({ data: { label: YEAR, status: "ACTIVE" } });
  }

  const teacherUser = await prisma.user.create({
    data: {
      username: `t-advisory-inheritance-${suffix}`,
      firstName: "Current",
      lastName: "Teacher",
      password: "hashed",
      role: "TEACHER",
      status: "ACTIVE",
    },
  });
  teacherUserId = teacherUser.id;
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `EMP-ADV-${suffix}` },
  });
  teacherId = teacher.id;

  const otherTeacherUser = await prisma.user.create({
    data: {
      username: `t-advisory-other-${suffix}`,
      firstName: "Previous",
      lastName: "Teacher",
      password: "hashed",
      role: "TEACHER",
      status: "ACTIVE",
    },
  });
  const otherTeacher = await prisma.teacher.create({
    data: { userId: otherTeacherUser.id, employeeId: `EMP-ADV-OTHER-${suffix}` },
  });
  otherTeacherId = otherTeacher.id;
  const outsiderUser = await prisma.user.create({ data: { username: `t-advisory-outsider-${suffix}`, password: "hashed", role: "TEACHER", status: "ACTIVE" } });
  const outsiderTeacher = await prisma.teacher.create({ data: { userId: outsiderUser.id, employeeId: `EMP-ADV-OUTSIDER-${suffix}` } });
  otherUserId = otherTeacherUser.id;
  outsiderTeacherId = outsiderTeacher.id;
  outsiderUserId = outsiderUser.id;

  const student = await prisma.student.create({
    data: { lrn: `LRN-ADV-${suffix}`, firstName: "Advisory", lastName: "Inheritance" },
  });
  studentId = student.id;

  const section = await prisma.section.create({
    data: {
      name: `Advisory Inheritance ${suffix}`,
      schoolYear: YEAR,
      gradeLevel: "GRADE_7",
      status: "ACTIVE",
      adviserId: teacher.id,
    },
  });
  sectionId = section.id;

  const enrollment = await prisma.enrollment.create({
    data: { studentId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
  });
  enrollmentIds.push(enrollment.id);

  // Subject A: active has T1, archived has T1..T3 -> active T1 wins, rest inherited.
  const subjectA = await prisma.subject.create({
    data: { code: `APADV${suffix}X7`, name: `Araling Panlipunan 7 ${suffix}` },
  });
  subjectIds.push(subjectA.id);
  await createAssignment({
    subjectId: subjectA.id,
    isActive: false,
    teacherIdOverride: otherTeacherId,
    grades: [
      { term: "T1", quarterlyGrade: 73 },
      { term: "T2", quarterlyGrade: 72 },
      { term: "T3", quarterlyGrade: 71 },
    ],
  });
  await createAssignment({
    subjectId: subjectA.id,
    isActive: true,
    grades: [{ term: "T1", quarterlyGrade: 90 }],
  });

  // Subject B: only the archived assignment has grades.
  const subjectB = await prisma.subject.create({
    data: { code: `MATHADV${suffix}X7`, name: `Mathematics 7 ${suffix}` },
  });
  subjectIds.push(subjectB.id);
  await createAssignment({
    subjectId: subjectB.id,
    isActive: false,
    teacherIdOverride: otherTeacherId,
    grades: [
      { term: "T1", quarterlyGrade: 84 },
      { term: "T2", quarterlyGrade: 85 },
      { term: "T3", quarterlyGrade: 86 },
    ],
  });
  await createAssignment({ subjectId: subjectB.id, isActive: true, grades: [] });
});

afterAll(async () => {
  await cleanup();
});

describe("advisory student grades â€” predecessor inheritance", () => {
  it("prefers active grades and inherits missing terms from archived predecessors", async () => {
    const result = await buildAdvisoryStudentGrades({ teacherId, studentId, schoolYear: YEAR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const subjectA = result.payload.subjectGrades.find((s) => s.subjectCode.includes("APADV"));
    expect(subjectA).toBeDefined();
    expect(subjectA!.grades.T1?.quarterlyGrade).toBe(90);
    expect(subjectA!.grades.T2?.quarterlyGrade).toBe(72);
    expect(subjectA!.grades.T3?.quarterlyGrade).toBe(71);
    expect(subjectA!.finalGrade).toBe(78);
    expect(subjectA!.teacher).toBe("Current Teacher");
  });

  it("shows grades when only the archived assignment has them", async () => {
    const result = await buildAdvisoryStudentGrades({ teacherId, studentId, schoolYear: YEAR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const subjectB = result.payload.subjectGrades.find((s) => s.subjectCode.includes("MATHADV"));
    expect(subjectB).toBeDefined();
    expect(subjectB!.grades.T1?.quarterlyGrade).toBe(84);
    expect(subjectB!.grades.T2?.quarterlyGrade).toBe(85);
    expect(subjectB!.grades.T3?.quarterlyGrade).toBe(86);
    expect(subjectB!.finalGrade).toBe(85);
  });

  it("rejects a teacher who is neither adviser nor teacher of the section", async () => {
    const result = await buildAdvisoryStudentGrades({ teacherId: outsiderTeacherId, studentId, schoolYear: YEAR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  it("allows a teacher assigned to the section even when not the adviser", async () => {
    const subjectC = await prisma.subject.create({
      data: { code: `ESPADV${Date.now()}X7`, name: "Edukasyon sa Pagpapakatao 7" },
    });
    subjectIds.push(subjectC.id);

    await prisma.classAssignment.create({
      data: {
        sectionId,
        subjectId: subjectC.id,
        teacherId: otherTeacherId,
        schoolYear: YEAR,
        isActive: true,
      },
    });

    const result = await buildAdvisoryStudentGrades({ teacherId: otherTeacherId, studentId, schoolYear: YEAR });
    expect(result.ok).toBe(true);
  });
});




