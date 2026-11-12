/**
 * teacher-archives-self-api.test.ts
 *
 * Teacher self-service archives: ownership isolation, role gate, download.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";
import teacherArchivesRouter from "../routes/teacherArchives";
import { ensureTeacherArchivesQueued, generateTeacherYearArchives } from "../lib/teacherYearArchive";
import { exportEcrWorkbook } from "../lib/ecrExport";
import ExcelJS from "exceljs";

const YEAR = `2088-2089-${Date.now()}`;
let yearId = "";
let sectionId = "";
let subjectId = "";
let teacherAId = "";
let teacherBId = "";
let userAId = "";
let userBId = "";
let adminId = "";
let studentId = "";
let assignmentId = "";
let otherArchiveId = "";

const app = express();
app.use(express.json());
app.use("/api/teacher-archives", teacherArchivesRouter);

let adminToken = "";
let teacherAToken = "";

async function seed() {
  const year = await prisma.schoolYear.create({
    data: { label: YEAR, status: "ARCHIVED", gradingMode: "TRANSMUTED", archivedAt: new Date() },
  });
  yearId = year.id;

  const section = await prisma.section.create({
    data: { name: `Section ${YEAR}`, schoolYear: YEAR, gradeLevel: "GRADE_7", status: "COMPLETED" },
  });
  sectionId = section.id;

  const subject = await prisma.subject.create({
    data: { code: `SELF-${Date.now()}`, name: "Self Subject" },
  });
  subjectId = subject.id;

  const student = await prisma.student.create({
    data: { lrn: `LRN-SELF-${Date.now()}`, firstName: "Self", lastName: "Learner", gender: "Male" },
  });
  studentId = student.id;

  const [admin, userA, userB] = await Promise.all([
    prisma.user.create({ data: { username: `self-admin-${Date.now()}`, password: "hashed", role: "ADMIN" } }),
    prisma.user.create({ data: { username: `self-a-${Date.now()}`, password: "hashed", role: "TEACHER" } }),
    prisma.user.create({ data: { username: `self-b-${Date.now()}`, password: "hashed", role: "TEACHER" } }),
  ]);
  adminId = admin.id;
  userAId = userA.id;
  userBId = userB.id;

  const [teacherA, teacherB] = await Promise.all([
    prisma.teacher.create({ data: { userId: userA.id, employeeId: `SELF-A-${Date.now()}` } }),
    prisma.teacher.create({ data: { userId: userB.id, employeeId: `SELF-B-${Date.now()}` } }),
  ]);
  teacherAId = teacherA.id;
  teacherBId = teacherB.id;

  const assignment = await prisma.classAssignment.create({
    data: { sectionId, schoolYear: YEAR, subjectId, teacherId: teacherAId, isActive: false },
  });

  assignmentId = assignment.id;

  await prisma.enrollment.create({
    data: { studentId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
  });

  for (const term of ["T1", "T2", "T3"] as const) {
    await prisma.grade.create({
      data: {
        studentId,
        classAssignmentId: assignment.id,
        term,
        writtenWorkScores: [{ score: 8, maxScore: 10 }],
        perfTaskScores: [{ score: 18, maxScore: 20 }],
        examScores: [
          { score: 9, maxScore: 10 },
          { score: 9, maxScore: 10 },
          { score: 27, maxScore: 30 },
        ],
        quarterlyAssessScore: 45,
        quarterlyAssessMax: 50,
        initialGrade: 90,
        quarterlyGrade: 92,
        status: "FINALIZED",
      },
    });
  }

  adminToken = signAccessToken({ id: admin.id, username: admin.username, role: "ADMIN" });
  teacherAToken = signAccessToken({ id: userA.id, username: userA.username, role: "TEACHER" });

  await ensureTeacherArchivesQueued({ schoolYearId: yearId, yearLabel: YEAR, source: "BACKFILL" });
  await generateTeacherYearArchives(yearId, { source: "BACKFILL" });

  const other = await prisma.teacherYearArchive.create({
    data: {
      schoolYearId: yearId,
      schoolYear: YEAR,
      teacherId: teacherBId,
      teacherUserId: userBId,
      employeeId: teacherB.employeeId,
      teacherName: "Other Teacher",
      status: "COMPLETE",
      schemaVersion: 1,
      encoding: "gzip",
      payload: Uint8Array.from([1, 2, 3]),
      compressedBytes: 3,
      rawBytes: 3,
      checksum: "not-used",
      source: "BACKFILL",
    },
  });
  otherArchiveId = other.id;
}

afterAll(async () => {
  if (yearId) {
    await prisma.teacherYearArchive.deleteMany({ where: { schoolYearId: yearId } });
    await prisma.schoolYear.deleteMany({ where: { id: yearId } });
  }
  if (teacherAId || teacherBId) {
    await prisma.teacher.deleteMany({ where: { id: { in: [teacherAId, teacherBId].filter(Boolean) } } });
  }
  if (adminId || userAId || userBId) {
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userAId, userBId].filter(Boolean) } } });
  }
  if (sectionId) await prisma.section.deleteMany({ where: { id: sectionId } });
  if (subjectId) await prisma.subject.deleteMany({ where: { id: subjectId } });
  if (studentId) await prisma.student.deleteMany({ where: { id: studentId } });
});

describe("teacher self-service archives API", () => {
  beforeAll(async () => {
    await seed();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/teacher-archives");
    expect(res.status).toBe(401);
  });

  it("rejects non-teacher roles", async () => {
    const res = await request(app)
      .get("/api/teacher-archives")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  it("lists only the signed-in teacher's archives without payloads", async () => {
    const res = await request(app)
      .get("/api/teacher-archives")
      .set("Authorization", `Bearer ${teacherAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.archives).toHaveLength(1);
    expect(res.body.archives[0].teacherUserId).toBe(userAId);
    expect(res.body.archives[0].teacherId).toBe(teacherAId);
    expect(JSON.stringify(res.body)).not.toContain('"payload"');
  });

  it("downloads the signed-in teacher's own archive", async () => {
    const list = await request(app)
      .get("/api/teacher-archives")
      .set("Authorization", `Bearer ${teacherAToken}`);
    const id = list.body.archives[0].id;

    const res = await request(app)
      .get(`/api/teacher-archives/${id}/download?format=json`)
      .set("Authorization", `Bearer ${teacherAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.teacher.id).toBe(teacherAId);

    const xlsx = await request(app)
      .get(`/api/teacher-archives/${id}/download?format=xlsx`)
      .set("Authorization", `Bearer ${teacherAToken}`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml.sheet");
  });

  it("lists the signed-in teacher's own class records", async () => {
    const list = await request(app)
      .get("/api/teacher-archives")
      .set("Authorization", `Bearer ${teacherAToken}`);
    const id = list.body.archives[0].id;

    const res = await request(app)
      .get(`/api/teacher-archives/${id}/classes`)
      .set("Authorization", `Bearer ${teacherAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.archive.schoolYear).toBe(YEAR);
    expect(res.body.classes).toHaveLength(1);
    expect(res.body.classes[0].classAssignmentId).toBeTruthy();
    expect(res.body.classes[0].terms).toContain("T1");
  });

  it("exports all three term sheets in one class-record workbook", async () => {
    const { buffer } = await exportEcrWorkbook({
      classAssignmentId: assignmentId,
      terms: ["T1", "T2", "T3"],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    for (const sheetName of ["TERM 1", "TERM 2", "TERM 3"]) {
      const sheet = workbook.getWorksheet(sheetName);
      expect(sheet).toBeTruthy();
      expect(Number(sheet!.getCell("F18").value)).toBeGreaterThan(0);
      expect(Number(sheet!.getCell("N18").value)).toBeGreaterThan(0);
      expect(Number(sheet!.getCell("T18").value)).toBeGreaterThan(0);
    }
  });

  it("cannot list another teacher's class records", async () => {
    const res = await request(app)
      .get(`/api/teacher-archives/${otherArchiveId}/classes`)
      .set("Authorization", `Bearer ${teacherAToken}`);
    expect(res.status).toBe(404);
  });

  it("cannot download another teacher's archive", async () => {
    const res = await request(app)
      .get(`/api/teacher-archives/${otherArchiveId}/download`)
      .set("Authorization", `Bearer ${teacherAToken}`);
    expect(res.status).toBe(404);
  });
});
