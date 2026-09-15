/**
 * registrar-finalize-year.test.ts — RL-1a regression test.
 *
 * finalize-grades / unfinalize-grades must accept an explicit schoolYear so the
 * registrar can still finalize an outgoing year after EnrollPro has rolled over.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";
import registrarRoutes from "../routes/registrar";

const YEAR = "2086-2087"; // unique to this test
const app = express();
app.use(express.json());
app.use("/api/registrar", registrarRoutes);

let token = "";
let registrarUserId = "";
let teacherUserId = "";
let teacherId = "";
let studentId = "";
let sectionId = "";
let subjectId = "";
let classAssignmentId = "";

beforeAll(async () => {
  const registrar = await prisma.user.create({
    data: {
      username: `reg-rl1a-${Date.now()}`,
      password: "hashed",
      role: "REGISTRAR",
      status: "ACTIVE",
      firstName: "Reg",
      lastName: "Test",
    },
  });
  registrarUserId = registrar.id;
  token = signAccessToken({ id: registrar.id, username: registrar.username, role: "REGISTRAR" });

  const teacherUser = await prisma.user.create({
    data: { username: `t-rl1a-${Date.now()}`, password: "hashed", role: "TEACHER", status: "ACTIVE" },
  });
  teacherUserId = teacherUser.id;
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `EMP-RL1A-${Date.now()}` },
  });
  teacherId = teacher.id;

  const student = await prisma.student.create({
    data: { lrn: `LRN-RL1A-${Date.now()}`, firstName: "Test", lastName: "Student" },
  });
  studentId = student.id;

  const subject = await prisma.subject.create({
    data: { code: `RL1A-${Date.now()}`, name: "RL1A Subject" },
  });
  subjectId = subject.id;

  const section = await prisma.section.create({
    data: { name: `RL1A Section ${Date.now()}`, schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
  });
  sectionId = section.id;

  const ca = await prisma.classAssignment.create({
    data: { sectionId, schoolYear: YEAR, subjectId, teacherId, isActive: true },
  });
  classAssignmentId = ca.id;

  await prisma.enrollment.create({
    data: { studentId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
  });

  // Two drafts: finalizing T1 leaves T2 draft, so the auto-EOSY path is skipped
  for (const term of ["T1", "T2"] as const) {
    await prisma.grade.create({
      data: { studentId, classAssignmentId, term, status: "DRAFT", writtenWorkScores: [], perfTaskScores: [] },
    });
  }
});

afterAll(async () => {
  await prisma.grade.deleteMany({ where: { classAssignmentId } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { id: classAssignmentId } }).catch(() => {});
  await prisma.section.deleteMany({ where: { id: sectionId } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: subjectId } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: studentId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [registrarUserId, teacherUserId] } } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
});

describe("RL-1a — explicit schoolYear on finalize/unfinalize", () => {
  it("finalizes grades for an explicit non-active year", async () => {
    const res = await request(app)
      .post("/api/registrar/finalize-grades")
      .set("Authorization", `Bearer ${token}`)
      .send({ sectionId, term: "T1", subjectId, schoolYear: YEAR });

    expect(res.status).toBe(200);
    expect(res.body.finalizedCount).toBe(1);

    const g = await prisma.grade.findFirst({ where: { classAssignmentId, term: "T1" } });
    expect(g?.status).toBe("FINALIZED");
  });

  it("leaves other terms untouched", async () => {
    const other = await prisma.grade.findFirst({ where: { classAssignmentId, term: "T2" } });
    expect(other?.status).toBe("DRAFT");
  });

  it("unfinalizes grades with an explicit non-active year", async () => {
    const res = await request(app)
      .post("/api/registrar/unfinalize-grades")
      .set("Authorization", `Bearer ${token}`)
      .send({ sectionId, term: "T1", subjectId, schoolYear: YEAR });

    expect(res.status).toBe(200);
    expect(res.body.unfinalizedCount).toBe(1);

    const g = await prisma.grade.findFirst({ where: { classAssignmentId, term: "T1" } });
    expect(g?.status).toBe("DRAFT");
  });

  it("still defaults to the active year when schoolYear is omitted", async () => {
    // This section lives in YEAR, not in the active fixture year → 404
    const res = await request(app)
      .post("/api/registrar/finalize-grades")
      .set("Authorization", `Bearer ${token}`)
      .send({ sectionId, term: "T1", subjectId });

    expect(res.status).toBe(404);
  });
});
