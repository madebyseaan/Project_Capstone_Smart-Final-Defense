/**
 * teacher-archives-api.test.ts
 *
 * G5: admin API authorization, payload-leak guard, download, and backfill.
 * Uses a minimal Express app with the real admin sub-router and a test DB.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { Router } from "express";
import request from "supertest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";
import teacherArchivesRouter from "../routes/admin-sub/teacherArchives";
import { ensureTeacherArchivesQueued, generateTeacherYearArchives } from "../lib/teacherYearArchive";

const YEAR = `2090-2091-${Date.now()}`;
let yearId = "";
let sectionId = "";
let teacherId = "";
let adminId = "";
let teacherUserId = "";
let subjectId = "";

const app = express();
app.use(express.json());
const router = Router();
teacherArchivesRouter(router);
app.use("/api/admin", router);

let adminToken = "";
let teacherToken = "";

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
    data: { code: `API-${Date.now()}`, name: "API Subject" },
  });

  const [admin, teacherUser] = await Promise.all([
    prisma.user.create({
      data: { username: `arch-admin-${Date.now()}`, password: "hashed", role: "ADMIN" },
    }),
    prisma.user.create({
      data: { username: `arch-teacher-${Date.now()}`, password: "hashed", role: "TEACHER" },
    }),
  ]);
  adminId = admin.id;
  teacherUserId = teacherUser.id;

  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `API-EMP-${Date.now()}` },
  });
  teacherId = teacher.id;

  await prisma.classAssignment.create({
    data: { sectionId, schoolYear: YEAR, subjectId: subject.id, teacherId, isActive: false },
  });
  subjectId = subject.id;

  adminToken = signAccessToken({ id: admin.id, username: admin.username, role: "ADMIN" });
  teacherToken = signAccessToken({ id: teacherUser.id, username: teacherUser.username, role: "TEACHER" });

  await ensureTeacherArchivesQueued({ schoolYearId: yearId, yearLabel: YEAR, source: "BACKFILL" });
  await generateTeacherYearArchives(yearId, { source: "BACKFILL" });
}

afterAll(async () => {
  if (yearId) {
    await prisma.teacherYearArchive.deleteMany({ where: { schoolYearId: yearId } });
    await prisma.schoolYear.deleteMany({ where: { id: yearId } });
  }
  if (teacherId) await prisma.teacher.deleteMany({ where: { id: teacherId } });
  if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
  if (teacherUserId) await prisma.user.deleteMany({ where: { id: teacherUserId } });
  if (sectionId) await prisma.section.deleteMany({ where: { id: sectionId } });
  if (subjectId) await prisma.subject.deleteMany({ where: { id: subjectId } });
});

describe("admin teacher archives API", () => {
  beforeAll(async () => {
    await seed();
  });

  it("requires authentication", async () => {
    const res = await request(app).get(`/api/admin/teacher-archives?schoolYearId=${yearId}`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin roles", async () => {
    const res = await request(app)
      .get(`/api/admin/teacher-archives?schoolYearId=${yearId}`)
      .set("Authorization", `Bearer ${teacherToken}`);
    expect(res.status).toBe(403);
  });

  it("lists archives without leaking payloads", async () => {
    const res = await request(app)
      .get(`/api/admin/teacher-archives?schoolYearId=${yearId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.schoolYear.id).toBe(yearId);
    expect(res.body.teachers).toHaveLength(1);
    expect(res.body.teachers[0].status).toBe("COMPLETE");
    expect(res.body.counts.complete).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('"payload"');
  });

  it("returns metadata on detail without the payload", async () => {
    const list = await request(app)
      .get(`/api/admin/teacher-archives?schoolYearId=${yearId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const id = list.body.teachers[0].id;

    const res = await request(app)
      .get(`/api/admin/teacher-archives/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.teacher.id).toBe(id);
    expect(res.body.teacher.checksum).toHaveLength(64);
    expect(res.body.teacher.payload).toBeUndefined();
  });

  it("downloads decompressed JSON and gzip variants", async () => {
    const list = await request(app)
      .get(`/api/admin/teacher-archives?schoolYearId=${yearId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const id = list.body.teachers[0].id;

    const json = await request(app)
      .get(`/api/admin/teacher-archives/${id}/download?format=json`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(json.status).toBe(200);
    expect(json.headers["content-type"]).toContain("application/json");
    expect(json.body.teacher.id).toBe(teacherId);

    const gz = await request(app)
      .get(`/api/admin/teacher-archives/${id}/download?format=json.gz`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(gz.status).toBe(200);
    expect(gz.headers["content-type"]).toContain("application/gzip");

    const xlsx = await request(app)
      .get(`/api/admin/teacher-archives/${id}/download?format=xlsx`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(Number(xlsx.headers["content-length"] ?? 0)).toBeGreaterThan(1000);
  });

  it("backfills an archived year idempotently", async () => {
    const res = await request(app)
      .post("/api/admin/teacher-archives/backfill")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ schoolYearId: yearId });

    expect(res.status).toBe(200);
    expect(res.body.schoolYear).toBe(YEAR);
    expect(res.body.failed).toBe(0);
  });

  it("refuses backfill for an active year", async () => {
    const activeYear = await prisma.schoolYear.create({
      data: { label: `2089-2090-${Date.now()}`, status: "ACTIVE" },
    });
    try {
      const res = await request(app)
        .post("/api/admin/teacher-archives/backfill")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ schoolYearId: activeYear.id });
      expect(res.status).toBe(400);
    } finally {
      await prisma.schoolYear.deleteMany({ where: { id: activeYear.id } });
    }
  });
});
