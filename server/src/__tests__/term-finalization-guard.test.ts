/**
 * term-finalization-guard.test.ts — Sealed term + correction window flow.
 *
 * Covers: seal blocks writes; teacher request for a finalized class; admin
 * approval without a timer; registrar open/close/review/refinalize; expired
 * window stays read-only; deletes and imports are blocked while sealed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";
import gradesRoutes from "../routes/grades";
import registrarRoutes from "../routes/registrar";

const YEAR = "2103-2104";
const TERM = "T1";
const app = express();
app.use(express.json());
app.use("/api/grades", gradesRoutes);
app.use("/api/registrar", registrarRoutes);

let registrarToken = "";
let teacherToken = "";
let adminToken = "";
let teacherUserId = "";
let teacherId = "";
let sectionId = "";
let subjectId = "";
let caId = "";
let studentAId = "";
let studentBId = "";
let requestId = "";
let previousSettings: Record<string, unknown> | null = null;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const suffix = Date.now();

  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.grade.deleteMany({ where: { classAssignment: { schoolYear: YEAR } } }).catch(() => {});
  await prisma.gradeEditRequest.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.section.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
  previousSettings = (await prisma.systemSettings.findUnique({ where: { id: "main" } })) as unknown as Record<string, unknown> | null;
  await prisma.systemSettings.deleteMany({ where: { id: "main" } }).catch(() => {});

  const registrar = await prisma.user.create({
    data: {
      username: `reg-guard-${suffix}`,
      password: "hashed",
      role: "REGISTRAR",
      status: "ACTIVE",
      firstName: "Reg",
      lastName: "Guard",
    },
  });
  registrarToken = signAccessToken({ id: registrar.id, username: registrar.username, role: "REGISTRAR" });

  const admin = await prisma.user.create({
    data: {
      username: `admin-guard-${suffix}`,
      password: "hashed",
      role: "ADMIN",
      status: "ACTIVE",
      firstName: "Admin",
      lastName: "Guard",
    },
  });
  adminToken = signAccessToken({ id: admin.id, username: admin.username, role: "ADMIN" });

  const teacherUser = await prisma.user.create({
    data: {
      username: `t-guard-${suffix}`,
      password: "hashed",
      role: "TEACHER",
      status: "ACTIVE",
      firstName: "T",
      lastName: "Guard",
    },
  });
  teacherUserId = teacherUser.id;
  teacherToken = signAccessToken({ id: teacherUser.id, username: teacherUser.username, role: "TEACHER" });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `EMP-GUARD-${suffix}` },
  });
  teacherId = teacher.id;

  const year = await prisma.schoolYear.create({
    data: { label: YEAR, status: "ACTIVE" },
  });
  await prisma.systemSettings.create({
    data: {
      id: "main",
      currentSchoolYear: YEAR,
      schoolYearId: year.id,
      currentTerm: "T1",
    },
  });

  const subject = await prisma.subject.create({
    data: { code: `GUARD-${suffix}`, name: `Guard Subject ${suffix}` },
  });
  subjectId = subject.id;

  const section = await prisma.section.create({
    data: { name: `Guard Section ${suffix}`, schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
  });
  sectionId = section.id;

  const ca = await prisma.classAssignment.create({
    data: { sectionId, schoolYear: YEAR, subjectId, teacherId, isActive: true },
  });
  caId = ca.id;

  const studentA = await prisma.student.create({
    data: { lrn: `LRN-GUARD-A-${suffix}`, firstName: "Alpha", lastName: "Guard" },
  });
  const studentB = await prisma.student.create({
    data: { lrn: `LRN-GUARD-B-${suffix}`, firstName: "Beta", lastName: "Guard" },
  });
  studentAId = studentA.id;
  studentBId = studentB.id;
  await prisma.enrollment.createMany({
    data: [
      { studentId: studentAId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
      { studentId: studentBId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
    ],
  });

  await prisma.grade.createMany({
    data: [
      {
        studentId: studentAId,
        classAssignmentId: caId,
        term: "T1",
        status: "DRAFT",
        writtenWorkScores: [{ name: "WW1", score: 10, maxScore: 10 }],
        perfTaskScores: [{ name: "PT1", score: 10, maxScore: 10 }],
        quarterlyAssessScore: 90,
        quarterlyAssessMax: 100,
      },
      {
        studentId: studentBId,
        classAssignmentId: caId,
        term: "T1",
        status: "DRAFT",
        writtenWorkScores: [{ name: "WW1", score: 10, maxScore: 10 }],
        perfTaskScores: [{ name: "PT1", score: 10, maxScore: 10 }],
        quarterlyAssessScore: 90,
        quarterlyAssessMax: 100,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.grade.deleteMany({ where: { classAssignmentId: caId } }).catch(() => {});
  await prisma.gradeEditRequest.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { sectionId, schoolYear: YEAR } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { id: caId } }).catch(() => {});
  await prisma.section.deleteMany({ where: { id: sectionId } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: subjectId } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.user.deleteMany({
    where: { username: { contains: "guard-" } },
  }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
  await prisma.systemSettings.deleteMany({ where: { id: "main" } }).catch(() => {});
  if (previousSettings) {
    await prisma.systemSettings.create({ data: previousSettings as any }).catch(() => {});
  }
});

const saveBody = (studentId: string, score: number) => ({
  studentId,
  classAssignmentId: caId,
  term: TERM,
  writtenWorkScores: [{ name: "WW1", score, maxScore: 10 }],
  perfTaskScores: [{ name: "PT1", score, maxScore: 10 }],
  quarterlyAssessScore: 90,
  quarterlyAssessMax: 100,
});

describe("term finalization seal + correction window", () => {
  it("teacher can save before finalization", async () => {
    const res = await request(app)
      .post("/api/grades/grade")
      .set(auth(teacherToken))
      .send(saveBody(studentAId, 9));
    expect(res.status).toBe(200);
  });

  it("registrar finalizes the class term", async () => {
    const res = await request(app)
      .post("/api/registrar/term-finalization/finalize")
      .set(auth(registrarToken))
      .send({ sectionId, term: TERM, schoolYear: YEAR });
    expect(res.status).toBe(200);
    const grades = await prisma.grade.findMany({ where: { classAssignmentId: caId, term: "T1" } });
    expect(grades.every((g) => g.status === "FINALIZED")).toBe(true);
  });

  it("blocks teacher save while sealed", async () => {
    const res = await request(app)
      .post("/api/grades/grade")
      .set(auth(teacherToken))
      .send(saveBody(studentAId, 8));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TERM_FINALIZED");
  });

  it("blocks deleting a finalized grade", async () => {
    const grade = await prisma.grade.findFirst({ where: { classAssignmentId: caId, studentId: studentAId } });
    const res = await request(app)
      .delete(`/api/grades/grade/${grade!.id}`)
      .set(auth(teacherToken));
    expect(res.status).toBe(403);
    expect(await prisma.grade.findUnique({ where: { id: grade!.id } })).not.toBeNull();
  });

  it("blocks ECR import before parsing while sealed", async () => {
    const res = await request(app)
      .post(`/api/grades/ecr-import/${caId}`)
      .set(auth(teacherToken))
      .field("term", TERM)
      .field("dryRun", "true")
      .attach("file", Buffer.from("not an xlsx"), "dummy.xlsx");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TERM_FINALIZED");
  });

  it("allows a teacher to request a correction for a finalized class", async () => {
    const res = await request(app)
      .post("/api/grades/edit-request")
      .set(auth(teacherToken))
      .send({
        term: TERM,
        reason: "Correct one Written Work score",
        classAssignmentId: caId,
        gradeLevel: "GRADE_7",
        section: "Guard Section",
        subject: "Guard Subject",
      });
    expect(res.status).toBe(201);
    expect(res.body.request.windowRequired).toBe(true);
    requestId = res.body.request.id;
  });

  it("admin approval does not start the window or change grades", async () => {
    const res = await request(app)
      .post(`/api/grades/admin/edit-requests/${requestId}/approve`)
      .set(auth(adminToken))
      .send({ hours: 2 });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe("APPROVED");
    expect(res.body.request.expiresAt).toBeNull();
    const grades = await prisma.grade.findMany({ where: { classAssignmentId: caId, term: "T1" } });
    expect(grades.every((g) => g.status === "FINALIZED")).toBe(true);
  });

  it("registrar opens the window: grades become DRAFT and a baseline is captured", async () => {
    const res = await request(app)
      .post(`/api/registrar/edit-requests/${requestId}/open-window`)
      .set(auth(registrarToken));
    expect(res.status).toBe(200);
    expect(res.body.request.displayStatus).toBe("WINDOW_OPEN");
    const grades = await prisma.grade.findMany({ where: { classAssignmentId: caId, term: "T1" } });
    expect(grades.every((g) => g.status === "DRAFT")).toBe(true);
    const dbRequest = await prisma.gradeEditRequest.findUnique({ where: { id: requestId } });
    expect(dbRequest?.unfinalizedGradeCount).toBe(2);
    expect(Array.isArray(dbRequest?.baseline)).toBe(true);
  });

  it("teacher can save during the open window", async () => {
    const res = await request(app)
      .post("/api/grades/grade")
      .set(auth(teacherToken))
      .send(saveBody(studentAId, 7));
    expect(res.status).toBe(200);
    const grade = await prisma.grade.findFirst({
      where: { classAssignmentId: caId, studentId: studentAId, term: "T1" },
    });
    expect(grade?.status).toBe("DRAFT");
  });

  it("review shows the change", async () => {
    const res = await request(app)
      .get(`/api/registrar/edit-requests/${requestId}/review`)
      .set(auth(registrarToken));
    expect(res.status).toBe(200);
    expect(res.body.changedCount).toBeGreaterThan(0);
    expect(res.body.students[0].changes.length).toBeGreaterThan(0);
    expect(res.body.reasonCategories).toContain("Written Work");
    expect(res.body.outsideReasonCategories).toContain("Performance Task");
    expect(res.body.outsideReasonCategories).not.toContain("Initial Grade");
    expect(res.body.outsideReasonCategories).not.toContain("Quarterly Grade");
  });

  it("closing the window leaves grades DRAFT and blocks the teacher", async () => {
    const close = await request(app)
      .post(`/api/registrar/edit-requests/${requestId}/close-window`)
      .set(auth(registrarToken));
    expect(close.status).toBe(200);
    const res = await request(app)
      .post("/api/grades/grade")
      .set(auth(teacherToken))
      .send(saveBody(studentAId, 6));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TERM_FINALIZED");
  });

  it("registrar re-finalizes and the seal returns", async () => {
    const res = await request(app)
      .post(`/api/registrar/edit-requests/${requestId}/refinalize`)
      .set(auth(registrarToken));
    expect(res.status).toBe(200);
    expect(res.body.request.displayStatus).toBe("REFINALIZED");
    const grades = await prisma.grade.findMany({ where: { classAssignmentId: caId, term: "T1" } });
    expect(grades.every((g) => g.status === "FINALIZED")).toBe(true);

    const blocked = await request(app)
      .post("/api/grades/grade")
      .set(auth(teacherToken))
      .send(saveBody(studentAId, 5));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("TERM_FINALIZED");
  });

  it("registrar summary exposes the re-finalized request history", async () => {
    const res = await request(app)
      .get("/api/registrar/edit-requests")
      .query({ schoolYear: YEAR, includeClosed: "true" })
      .set(auth(registrarToken));
    expect(res.status).toBe(200);
    expect(res.body.items.some((item: any) => item.id === requestId)).toBe(true);
  });

  it("teacher can end an open correction session early", async () => {
    const create = await request(app)
      .post("/api/grades/edit-request")
      .set(auth(teacherToken))
      .send({
        term: TERM,
        reason: "Second correction — Written Work",
        classAssignmentId: caId,
        gradeLevel: "GRADE_7",
        section: "Guard Section",
        subject: "Guard Subject",
      });
    expect(create.status).toBe(201);
    const secondId = create.body.request.id;

    const approve = await request(app)
      .post(`/api/grades/admin/edit-requests/${secondId}/approve`)
      .set(auth(adminToken))
      .send({ hours: 2 });
    expect(approve.status).toBe(200);

    const open = await request(app)
      .post(`/api/registrar/edit-requests/${secondId}/open-window`)
      .set(auth(registrarToken));
    expect(open.status).toBe(200);

    const end = await request(app)
      .post(`/api/grades/edit-window/${secondId}/end`)
      .set(auth(teacherToken));
    expect(end.status).toBe(200);
    expect(end.body.request.status).toBe("EXPIRED");

    const blocked = await request(app)
      .post("/api/grades/grade")
      .set(auth(teacherToken))
      .send(saveBody(studentAId, 4));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("TERM_FINALIZED");
  });
});
