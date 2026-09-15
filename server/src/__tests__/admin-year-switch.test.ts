/**
 * admin-year-switch.test.ts — RL-7a regression tests.
 *
 * 1. Switching the active school year via PUT /api/admin/settings must run the
 *    safe rollover and REFUSE (400, no state change) when the outgoing year is
 *    not finalized.
 * 2. PATCH /api/admin/school-years/:id { status: "ARCHIVED" } must not be a bare
 *    status flip: it rejects the active year and performs the real archive.
 * 3. Once the outgoing year is finalized + snapshotted, the switch succeeds and
 *    the old year is archived.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";
import adminRoutes from "../routes/admin";

const YEAR_A = "2084-2085"; // outgoing / active
const YEAR_B = "2083-2084"; // incoming

const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);

let token = "";
let adminUserId = "";
let teacherUserId = "";
let teacherId = "";
let studentId = "";
let sectionId = "";
let subjectId = "";
let classAssignmentId = "";
let yearAId = "";
let yearBId = "";
let origSchoolYearId: string | null = null;
let origCurrentSchoolYear: string | null = null;

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: { username: `admin-rl7a-${Date.now()}`, password: "hashed", role: "ADMIN", status: "ACTIVE" },
  });
  adminUserId = admin.id;
  token = signAccessToken({ id: admin.id, username: admin.username, role: "ADMIN" });

  const teacherUser = await prisma.user.create({
    data: { username: `t-rl7a-${Date.now()}`, password: "hashed", role: "TEACHER", status: "ACTIVE" },
  });
  teacherUserId = teacherUser.id;
  const teacher = await prisma.teacher.create({ data: { userId: teacherUser.id, employeeId: `EMP-RL7A-${Date.now()}` } });
  teacherId = teacher.id;

  const yA = await prisma.schoolYear.create({ data: { label: YEAR_A, status: "ACTIVE", externalId: 900011 } });
  const yB = await prisma.schoolYear.create({ data: { label: YEAR_B, status: "INACTIVE", externalId: 900012 } });
  yearAId = yA.id;
  yearBId = yB.id;

  const student = await prisma.student.create({ data: { lrn: `LRN-RL7A-${Date.now()}`, firstName: "T", lastName: "S" } });
  studentId = student.id;
  const subject = await prisma.subject.create({ data: { code: `RL7A-${Date.now()}`, name: "RL7A Subject" } });
  subjectId = subject.id;
  const section = await prisma.section.create({ data: { name: `RL7A Section ${Date.now()}`, schoolYear: YEAR_A, gradeLevel: "GRADE_7", status: "ACTIVE" } });
  sectionId = section.id;
  const ca = await prisma.classAssignment.create({ data: { sectionId, schoolYear: YEAR_A, subjectId, teacherId, isActive: true } });
  classAssignmentId = ca.id;
  await prisma.enrollment.create({
    data: { studentId, sectionId, schoolYear: YEAR_A, status: "ENROLLED", promotionStatus: "PROMOTED" },
  });
  // One DRAFT grade initially → outgoing year is NOT finalized
  await prisma.grade.create({
    data: { studentId, classAssignmentId, term: "T1", status: "DRAFT", writtenWorkScores: [], perfTaskScores: [] },
  });

  // Point settings at YEAR_A
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "main" },
    select: { schoolYearId: true, currentSchoolYear: true },
  });
  origSchoolYearId = settings?.schoolYearId ?? null;
  origCurrentSchoolYear = settings?.currentSchoolYear ?? null;
  await prisma.systemSettings.update({
    where: { id: "main" },
    data: { schoolYearId: yearAId, currentSchoolYear: YEAR_A },
  });
});

afterAll(async () => {
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR_A } }).catch(() => {});
  await prisma.grade.deleteMany({ where: { classAssignmentId } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: YEAR_A } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { id: classAssignmentId } }).catch(() => {});
  await prisma.section.deleteMany({ where: { id: sectionId } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: subjectId } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: studentId } }).catch(() => {});
  await prisma.yearGradeLock.deleteMany({ where: { schoolYearId: { in: [yearAId, yearBId] } } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: { in: [YEAR_A, YEAR_B] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, teacherUserId] } } }).catch(() => {});
  await prisma.systemSettings.update({
    where: { id: "main" },
    data: {
      schoolYearId: origSchoolYearId ?? undefined,
      currentSchoolYear: origCurrentSchoolYear ?? undefined,
    },
  }).catch(() => {});
});

describe("RL-7a — manual year switch runs the safe rollover", () => {
  it("refuses to switch while the outgoing year has draft grades (400, no state change)", async () => {
    const res = await request(app)
      .put("/api/admin/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ schoolYearId: yearBId, currentSchoolYear: YEAR_B });

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/Cannot switch/i);

    const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
    expect(settings?.schoolYearId).toBe(yearAId);
    expect(settings?.currentSchoolYear).toBe(YEAR_A);

    const yA = await prisma.schoolYear.findUnique({ where: { id: yearAId } });
    expect(yA?.status).not.toBe("ARCHIVED");
  });

  it("rejects archiving the active year via School Years PATCH (400)", async () => {
    const res = await request(app)
      .patch(`/api/admin/school-years/${yearAId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "ARCHIVED" });

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/active school year/i);
  });

  it("switches and archives once the outgoing year is finalized + snapshotted", async () => {
    // Finalize grades and create EOSY snapshots so archive guardrails pass
    await prisma.grade.updateMany({
      where: { classAssignmentId },
      data: { status: "FINALIZED", finalizedAt: new Date(), finalizedBy: adminUserId },
    });
    const grades = await prisma.grade.findMany({ where: { classAssignmentId } });
    for (const g of grades) {
      await prisma.gradeSnapshot.create({
        data: {
          gradeId: g.id,
          studentId,
          classAssignmentId,
          teacherId,
          subjectCode: "RL7A-SUBJ",
          subjectName: "RL7A Subject",
          sectionId,
          sectionName: "RL7A Section",
          schoolYear: YEAR_A,
          term: g.term,
          snapshot: { source: "EOSY_FINALIZE", quarterlyGrade: 85 },
        },
      });
    }

    const res = await request(app)
      .put("/api/admin/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ schoolYearId: yearBId, currentSchoolYear: YEAR_B });

    expect(res.status).toBe(200);

    const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
    expect(settings?.schoolYearId).toBe(yearBId);

    const yA = await prisma.schoolYear.findUnique({ where: { id: yearAId } });
    expect(yA?.status).toBe("ARCHIVED");

    const lock = await prisma.yearGradeLock.findUnique({ where: { schoolYearId: yearAId } });
    expect(lock?.isLocked).toBe(true);
  });
});
