/**
 * rotation-parity.test.ts â€” one rotation rule across Advisory, SF9 and SF10.
 *
 * Every sub-subject occupies its own rotation term (rank). Grades recorded in
 * other terms are not used. This is the rule SF10 and promotion already use.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { buildAdvisoryStudentGrades } from "../lib/advisoryStudentGrades";
import { composeSf9Section } from "../lib/sf9Composer";
import { buildSf10Records } from "../lib/sf10";

const YEAR = "2076-2077";

let teacherId = "";
let teacherTwoId = "";
let teacherThreeId = "";
const teacherUserIds: string[] = [];
let studentId = "";
let sectionId = "";
const subjectIds: string[] = [];

async function cleanup() {
  await prisma.grade.deleteMany({ where: { classAssignment: { schoolYear: YEAR } } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.section.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } }).catch(() => {});
  const teacherIds = [teacherId, teacherTwoId, teacherThreeId].filter(Boolean);
  if (teacherIds.length) await prisma.teacher.deleteMany({ where: { id: { in: teacherIds } } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { employeeId: { startsWith: "EMP-ROT-" } } }).catch(() => {});
  if (teacherUserIds.length) await prisma.user.deleteMany({ where: { id: { in: teacherUserIds } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { username: { startsWith: "t-rotation-" } } }).catch(() => {});
  if (studentId) await prisma.student.deleteMany({ where: { id: studentId } }).catch(() => {});
}

beforeAll(async () => {
  const suffix = Date.now();
  await cleanup();

  const existingYear = await prisma.schoolYear.findUnique({ where: { label: YEAR } });
  if (!existingYear) await prisma.schoolYear.create({ data: { label: YEAR, status: "ACTIVE" } });

  const teacherUser = await prisma.user.create({
    data: { username: `t-rotation-parity-${suffix}`, password: "hashed", role: "TEACHER", status: "ACTIVE", firstName: "Rotation", lastName: "One" },
  });
  teacherUserIds.push(teacherUser.id);
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `EMP-ROT-${suffix}` },
  });
  teacherId = teacher.id;
  const teacherTwoUser = await prisma.user.create({ data: { username: `t-rotation-two-${suffix}`, password: "hashed", role: "TEACHER", status: "ACTIVE", firstName: "Rotation", lastName: "Two" } });
  teacherUserIds.push(teacherTwoUser.id);
  teacherTwoId = (await prisma.teacher.create({ data: { userId: teacherTwoUser.id, employeeId: `EMP-ROT-TWO-${suffix}` } })).id;
  const teacherThreeUser = await prisma.user.create({ data: { username: `t-rotation-three-${suffix}`, password: "hashed", role: "TEACHER", status: "ACTIVE", firstName: "Rotation", lastName: "Three" } });
  teacherUserIds.push(teacherThreeUser.id);
  teacherThreeId = (await prisma.teacher.create({ data: { userId: teacherThreeUser.id, employeeId: `EMP-ROT-THREE-${suffix}` } })).id;

  const student = await prisma.student.create({
    data: { lrn: `LRN-ROT-${suffix}`, firstName: "Rotation", lastName: "Parity" },
  });
  studentId = student.id;

  const section = await prisma.section.create({
    data: {
      name: `Rotation Parity ${suffix}`,
      schoolYear: YEAR,
      gradeLevel: "GRADE_7",
      status: "ACTIVE",
      adviserId: teacher.id,
    },
  });
  sectionId = section.id;

  await prisma.enrollment.create({
    data: { studentId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
  });

  const makeRotationSubject = async (code: string, name: string, rank: number) => {
    const subject = await prisma.subject.create({
      data: {
        code,
        name,
        rotationTermGroupId: "SCIENCE",
        rotationTermRank: rank,
        rotationOutputLabel: "SCIENCE",
      },
    });
    subjectIds.push(subject.id);
    return subject;
  };

  const biology = await makeRotationSubject(`SCIBIO${suffix}X7`, "Science - Biology 7", 1);
  const chemistry = await makeRotationSubject(`SCICHEM${suffix}X7`, "Science - Chemistry 7", 2);
  const earthScience = await makeRotationSubject(`SCIEARTH${suffix}X7`, "Science - Earth Science 7", 3);

  const createGrades = async (subjectId: string, grades: Array<{ term: "T1" | "T2" | "T3"; quarterlyGrade: number }>, assignmentTeacherId = teacherId) => {
    const assignment = await prisma.classAssignment.create({
      data: { sectionId, subjectId, teacherId: assignmentTeacherId, schoolYear: YEAR, isActive: true },
    });
    for (const grade of grades) {
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
  };

  await createGrades(biology.id, [
    { term: "T1", quarterlyGrade: 80 },
    { term: "T2", quarterlyGrade: 85 },
    { term: "T3", quarterlyGrade: 90 },
  ]);
  await createGrades(chemistry.id, [
    { term: "T1", quarterlyGrade: 81 },
    { term: "T2", quarterlyGrade: 82 },
    { term: "T3", quarterlyGrade: 83 },
  ], teacherTwoId);
  await createGrades(earthScience.id, [
    { term: "T1", quarterlyGrade: 91 },
    { term: "T2", quarterlyGrade: 92 },
    { term: "T3", quarterlyGrade: 93 },
  ], teacherThreeId);

  // Archived subject with NO grades must not render as a blank SF9 row.
  const inactiveBlank = await prisma.subject.create({
    data: { code: `COMEDADV${suffix}X7`, name: "Comed 7" },
  });
  subjectIds.push(inactiveBlank.id);
  await prisma.classAssignment.create({
    data: {
      sectionId,
      subjectId: inactiveBlank.id,
      teacherId,
      schoolYear: YEAR,
      isActive: false,
      archivedAt: new Date(),
      archivedReason: "ATLAS_STALE_WITH_GRADES",
    },
  });

  // Archived subject WITH grades must stay on the form (history preserved).
  const inactiveGraded = await prisma.subject.create({
    data: { code: `APADVROT${suffix}X7`, name: "Araling Panlipunan 7" },
  });
  subjectIds.push(inactiveGraded.id);
  await prisma.classAssignment.create({
    data: {
      sectionId,
      subjectId: inactiveGraded.id,
      teacherId,
      schoolYear: YEAR,
      isActive: false,
      archivedAt: new Date(),
      archivedReason: "ATLAS_STALE_WITH_GRADES",
    },
  }).then(async (assignment) => {
    await prisma.grade.create({
      data: {
        studentId,
        classAssignmentId: assignment.id,
        term: "T1",
        writtenWorkScores: [],
        perfTaskScores: [],
        writtenWorkPS: 88,
        perfTaskPS: 88,
        quarterlyAssessPS: 88,
        initialGrade: 88,
        quarterlyGrade: 88,
      },
    });
  });
});

afterAll(async () => {
  await cleanup();
});

describe("rotation parity â€” Advisory, SF9, SF10", () => {
  it("uses each sub-subject's own rotation term in every surface", async () => {
    const advisory = await buildAdvisoryStudentGrades({ teacherId, studentId, schoolYear: YEAR });
    expect(advisory.ok).toBe(true);
    if (!advisory.ok) return;
    const advisoryScience = advisory.payload.subjectGrades.find((row) => row.subjectCode === "SCIENCE");
    expect(advisoryScience).toBeDefined();
    expect(advisoryScience!.grades.T1?.quarterlyGrade).toBe(80);
    expect(advisoryScience!.grades.T2?.quarterlyGrade).toBe(82);
    expect(advisoryScience!.grades.T3?.quarterlyGrade).toBe(93);
    expect(advisoryScience!.finalGrade).toBe(85);
    expect(advisoryScience!.teacher).toBe("Rotation One / Rotation Two / Rotation Three");

    const sf9 = await composeSf9Section({ sectionId, schoolYear: YEAR });
    const sf9Student: any = sf9?.students.find((student: any) => student.student.id === studentId);
    expect(sf9Student).toBeDefined();
    const sf9Science: any = sf9Student.subjectGrades.find((row: any) => row.subjectCode === "SCIENCE");
    expect(sf9Science).toBeDefined();
    expect(sf9Science.T1).toBe(80);
    expect(sf9Science.T2).toBe(82);
    expect(sf9Science.T3).toBe(93);
    expect(sf9Science.final).toBe(85);
    expect(sf9Science.teacher).toBe(advisoryScience!.teacher);

    const sf10 = await buildSf10Records(studentId);
    const yearRecord: any = sf10?.schoolRecords.find((record: any) => record.schoolYear === YEAR);
    expect(yearRecord).toBeDefined();
    const sf10Science: any = yearRecord.subjectGrades.find((row: any) => row.subjectCode === "SCIENCE");
    expect(sf10Science).toBeDefined();
    expect(sf10Science.T1).toBe(80);
    expect(sf10Science.T2).toBe(82);
    expect(sf10Science.T3).toBe(93);
    expect(sf10Science.final).toBe(85);

    // Row-set hygiene: blank archived subjects are omitted; graded ones remain.
    const sf9Codes = (sf9Student.subjectGrades as any[]).map((row) => row.subjectCode);
    expect(sf9Codes.some((code: string) => code.startsWith("COMEDADV"))).toBe(false);
    expect(sf9Codes.some((code: string) => code.startsWith("APADVROT"))).toBe(true);
  });
});



