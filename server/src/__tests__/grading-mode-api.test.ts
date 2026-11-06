import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { GradingMode, Term } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";
import { invalidateSchoolYearCache } from "../lib/schoolYearResolver";
import { invalidateGradingModeCache } from "../lib/gradingMode";
import { invalidateTransmutationCache } from "../lib/transmutationCache";
import adminRoutes from "../routes/admin";

const YEAR_A = "2087-2088";
const YEAR_B = "2086-2087";

const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);

let adminToken = "";
let teacherToken = "";
let adminUserId = "";
let teacherUserId = "";
let teacherId = "";
let yearAId = "";
let yearBId = "";
let subjectAId = "";
let subjectBId = "";
let sectionAId = "";
let sectionBId = "";
let caAId = "";
let caBId = "";
let studentAId = "";
let studentBId = "";
let gradeAId = "";
let gradeBId = "";
let originalSchoolYearId: string | null = null;
let originalCurrentSchoolYear: string | null = null;
let originalCurrentTerm: Term | null = null;

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: { username: `admin-gm-${Date.now()}`, password: "hashed", role: "ADMIN", status: "ACTIVE" },
  });
  adminUserId = admin.id;
  adminToken = signAccessToken({ id: admin.id, username: admin.username, role: "ADMIN" });

  const teacherUser = await prisma.user.create({
    data: { username: `teacher-gm-${Date.now()}`, password: "hashed", role: "TEACHER", status: "ACTIVE" },
  });
  teacherUserId = teacherUser.id;
  teacherToken = signAccessToken({ id: teacherUser.id, username: teacherUser.username, role: "TEACHER" });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `EMP-GM-${Date.now()}` },
  });
  teacherId = teacher.id;

  const yearA = await prisma.schoolYear.create({
    data: { label: YEAR_A, status: "ACTIVE", externalId: 990001, gradingMode: GradingMode.TRANSMUTED },
  });
  const yearB = await prisma.schoolYear.create({
    data: { label: YEAR_B, status: "ACTIVE", externalId: 990002, gradingMode: GradingMode.TRANSMUTED },
  });
  yearAId = yearA.id;
  yearBId = yearB.id;

  const subjectA = await prisma.subject.create({
    data: {
      code: `GM-A-${Date.now()}`,
      name: "Grading Mode A",
      type: "CORE",
      writtenWorkWeight: 20,
      perfTaskWeight: 50,
      quarterlyAssessWeight: 30,
    },
  });
  const subjectB = await prisma.subject.create({
    data: {
      code: `GM-B-${Date.now()}`,
      name: "Grading Mode B",
      type: "CORE",
      writtenWorkWeight: 20,
      perfTaskWeight: 50,
      quarterlyAssessWeight: 30,
    },
  });
  subjectAId = subjectA.id;
  subjectBId = subjectB.id;

  const sectionA = await prisma.section.create({
    data: { name: `GM-A-${Date.now()}`, gradeLevel: "GRADE_7", schoolYear: YEAR_A, status: "ACTIVE" },
  });
  const sectionB = await prisma.section.create({
    data: { name: `GM-B-${Date.now()}`, gradeLevel: "GRADE_7", schoolYear: YEAR_B, status: "ACTIVE" },
  });
  sectionAId = sectionA.id;
  sectionBId = sectionB.id;

  const caA = await prisma.classAssignment.create({
    data: { teacherId, subjectId: subjectA.id, sectionId: sectionA.id, schoolYear: YEAR_A, isActive: true },
  });
  const caB = await prisma.classAssignment.create({
    data: { teacherId, subjectId: subjectB.id, sectionId: sectionB.id, schoolYear: YEAR_B, isActive: true },
  });
  caAId = caA.id;
  caBId = caB.id;

  const studentA = await prisma.student.create({
    data: { lrn: `LRN-GM-A-${Date.now()}`, firstName: "Alpha", lastName: "Mode" },
  });
  const studentB = await prisma.student.create({
    data: { lrn: `LRN-GM-B-${Date.now()}`, firstName: "Beta", lastName: "Mode" },
  });
  studentAId = studentA.id;
  studentBId = studentB.id;

  await prisma.enrollment.create({
    data: { studentId: studentA.id, sectionId: sectionA.id, schoolYear: YEAR_A, status: "ENROLLED" },
  });
  await prisma.enrollment.create({
    data: { studentId: studentB.id, sectionId: sectionB.id, schoolYear: YEAR_B, status: "ENROLLED" },
  });

  const commonGrade = {
    writtenWorkScores: [],
    perfTaskScores: [],
    quarterlyAssessScore: 90,
    quarterlyAssessMax: 100,
    writtenWorkPS: 70,
    perfTaskPS: 80,
    quarterlyAssessPS: 90,
    initialGrade: 81,
    quarterlyGrade: 84,
    status: "DRAFT" as const,
  };

  const gradeA = await prisma.grade.create({
    data: { studentId: studentA.id, classAssignmentId: caA.id, term: "T1", ...commonGrade },
  });
  const gradeB = await prisma.grade.create({
    data: { studentId: studentB.id, classAssignmentId: caB.id, term: "T1", ...commonGrade },
  });
  gradeAId = gradeA.id;
  gradeBId = gradeB.id;

  const settings = await prisma.systemSettings.findUnique({
    where: { id: "main" },
    select: { schoolYearId: true, currentSchoolYear: true, currentTerm: true },
  });
  originalSchoolYearId = settings?.schoolYearId ?? null;
  originalCurrentSchoolYear = settings?.currentSchoolYear ?? null;
  originalCurrentTerm = settings?.currentTerm ?? null;
  await prisma.systemSettings.upsert({
    where: { id: "main" },
    update: { schoolYearId: yearA.id, currentSchoolYear: YEAR_A, currentTerm: "T1" },
    create: { id: "main", schoolYearId: yearA.id, currentSchoolYear: YEAR_A, currentTerm: "T1" },
  });

  await prisma.transmutationEntry.deleteMany({});
  await prisma.transmutationEntry.createMany({
    data: [
      { minGrade: 0, maxGrade: 69.99, transmutedGrade: 74, isDefault: true },
      { minGrade: 70, maxGrade: 79.99, transmutedGrade: 75, isDefault: true },
      { minGrade: 80, maxGrade: 81.79, transmutedGrade: 84, isDefault: true },
      { minGrade: 81.8, maxGrade: 100, transmutedGrade: 85, isDefault: true },
    ],
  });

  invalidateSchoolYearCache();
  invalidateGradingModeCache();
  invalidateTransmutationCache();
});

afterAll(async () => {
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: { in: [YEAR_A, YEAR_B] } } }).catch(() => {});
  await prisma.grade.deleteMany({ where: { classAssignmentId: { in: [caAId, caBId] } } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: { in: [YEAR_A, YEAR_B] } } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { id: { in: [caAId, caBId] } } }).catch(() => {});
  await prisma.section.deleteMany({ where: { id: { in: [sectionAId, sectionBId] } } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: { in: [subjectAId, subjectBId] } } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: { in: [studentAId, studentBId] } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { target: "GradingMode" } }).catch(() => {});
  await prisma.systemSettings.update({
    where: { id: "main" },
    data: {
      schoolYearId: originalSchoolYearId ?? undefined,
      currentSchoolYear: originalCurrentSchoolYear ?? undefined,
      currentTerm: originalCurrentTerm ?? undefined,
    },
  }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: { in: [YEAR_A, YEAR_B] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, teacherUserId] } } }).catch(() => {});
  invalidateSchoolYearCache();
  invalidateGradingModeCache();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("grading mode API", () => {
  it("returns the active mode and guard state", async () => {
    const res = await request(app).get("/api/admin/grading-mode").set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe(GradingMode.TRANSMUTED);
    expect(res.body.schoolYear.label).toBe(YEAR_A);
    expect(res.body.canChange).toBe(true);
    expect(res.body.gradeCount).toBe(1);
    expect(res.body.recommendedMode).toBe(GradingMode.ZERO_BASED);
  });

  it("rejects non-admin access", async () => {
    const res = await request(app).get("/api/admin/grading-mode").set(auth(teacherToken));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid mode", async () => {
    const res = await request(app)
      .put("/api/admin/grading-mode")
      .set(auth(adminToken))
      .send({ mode: "INVALID" });
    expect(res.status).toBe(400);
  });

  it("is idempotent when the mode is unchanged", async () => {
    const res = await request(app)
      .put("/api/admin/grading-mode")
      .set(auth(adminToken))
      .send({ mode: GradingMode.TRANSMUTED });

    expect(res.status).toBe(200);
    expect(res.body.recompute.updated).toBe(0);
  });

  it("switches to zero-based and recomputes only the active school year", async () => {
    const res = await request(app)
      .put("/api/admin/grading-mode")
      .set(auth(adminToken))
      .send({ mode: GradingMode.ZERO_BASED });

    expect(res.status).toBe(200);
    expect(res.body.recompute.scanned).toBe(1);
    expect(res.body.recompute.updated).toBe(1);

    const yearA = await prisma.schoolYear.findUnique({ where: { id: yearAId } });
    expect(yearA?.gradingMode).toBe(GradingMode.ZERO_BASED);

    const gradeA = await prisma.grade.findUnique({ where: { id: gradeAId } });
    expect(gradeA?.quarterlyGrade).toBe(81);

    const gradeB = await prisma.grade.findUnique({ where: { id: gradeBId } });
    expect(gradeB?.quarterlyGrade).toBe(84);

    const audit = await prisma.auditLog.findFirst({
      where: { target: "GradingMode" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(audit?.details).toContain("ZERO_BASED");
  });

  it("switches back to transmutation and restores the table grade", async () => {
    const res = await request(app)
      .put("/api/admin/grading-mode")
      .set(auth(adminToken))
      .send({ mode: GradingMode.TRANSMUTED });

    expect(res.status).toBe(200);

    const gradeA = await prisma.grade.findUnique({ where: { id: gradeAId } });
    expect(gradeA?.quarterlyGrade).toBe(84);

    const yearA = await prisma.schoolYear.findUnique({ where: { id: yearAId } });
    expect(yearA?.gradingMode).toBe(GradingMode.TRANSMUTED);
  });

  it("blocks the switch when the active year has finalized grades", async () => {
    await prisma.grade.update({ where: { id: gradeAId }, data: { status: "FINALIZED" } });

    const res = await request(app)
      .put("/api/admin/grading-mode")
      .set(auth(adminToken))
      .send({ mode: GradingMode.ZERO_BASED });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("FINALIZED_GRADES");

    await prisma.grade.update({ where: { id: gradeAId }, data: { status: "DRAFT" } });
  });

  it("blocks the switch when EOSY snapshots exist for the active year", async () => {
    await prisma.gradeSnapshot.create({
      data: {
        gradeId: gradeAId,
        studentId: studentAId,
        classAssignmentId: caAId,
        teacherId,
        subjectCode: "GM-A",
        subjectName: "Grading Mode A",
        sectionId: sectionAId,
        sectionName: "GM-A",
        schoolYear: YEAR_A,
        term: "T1",
        snapshot: { source: "EOSY_FINALIZE", quarterlyGrade: 84 },
      },
    });

    const res = await request(app)
      .put("/api/admin/grading-mode")
      .set(auth(adminToken))
      .send({ mode: GradingMode.ZERO_BASED });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EOSY_FINALIZED");

    await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR_A, classAssignmentId: caAId } });
  });

  it("blocks the switch for an archived school year", async () => {
    await prisma.schoolYear.update({ where: { id: yearAId }, data: { status: "ARCHIVED" } });
    invalidateSchoolYearCache();

    const getRes = await request(app).get("/api/admin/grading-mode").set(auth(adminToken));
    expect(getRes.status).toBe(200);
    expect(getRes.body.canChange).toBe(false);
    expect(getRes.body.blockedReason).toBe("ARCHIVED_SCHOOL_YEAR");

    const putRes = await request(app)
      .put("/api/admin/grading-mode")
      .set(auth(adminToken))
      .send({ mode: GradingMode.ZERO_BASED });
    expect(putRes.status).toBe(409);
    expect(putRes.body.code).toBe("ARCHIVED_SCHOOL_YEAR");

    await prisma.schoolYear.update({ where: { id: yearAId }, data: { status: "ACTIVE" } });
    invalidateSchoolYearCache();
  });

  it("recompute recovery realigns a damaged stored grade", async () => {
    await request(app)
      .put("/api/admin/grading-mode")
      .set(auth(adminToken))
      .send({ mode: GradingMode.ZERO_BASED });

    await prisma.grade.update({ where: { id: gradeAId }, data: { quarterlyGrade: 84 } });

    const res = await request(app)
      .post("/api/admin/grading-mode/recompute")
      .set(auth(adminToken));

    expect(res.status).toBe(200);
    const gradeA = await prisma.grade.findUnique({ where: { id: gradeAId } });
    expect(gradeA?.quarterlyGrade).toBe(81);

    await request(app)
      .put("/api/admin/grading-mode")
      .set(auth(adminToken))
      .send({ mode: GradingMode.TRANSMUTED });
  });
});
