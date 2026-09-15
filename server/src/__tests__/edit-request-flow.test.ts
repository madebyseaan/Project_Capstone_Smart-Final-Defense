/**
 * edit-request-flow.test.ts — covers the demo flow that cannot be rehearsed
 * live while EnrollPro reports T1: teacher requests edit access for a past term,
 * admin approves it, and the request becomes APPROVED with an expiry.
 *
 * resolveCurrentTerm is mocked to "T2" so T1 counts as a past term.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";

vi.mock("../routes/grades-sub/helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../routes/grades-sub/helpers")>();
  return { ...actual, resolveCurrentTerm: async () => "T2" };
});

// Import AFTER the mock so the route picks up the mocked helper
import gradesRoutes from "../routes/grades";

const app = express();
app.use(express.json());
app.use("/api/grades", gradesRoutes);

let teacherToken = "";
let adminToken = "";
let teacherUserId = "";
let teacherId = "";
let adminUserId = "";

beforeAll(async () => {
  const teacher = await prisma.user.create({
    data: { username: `t-er-${Date.now()}`, password: "hashed", role: "TEACHER", status: "ACTIVE", firstName: "Edit", lastName: "Requester" },
  });
  teacherUserId = teacher.id;
  teacherToken = signAccessToken({ id: teacher.id, username: teacher.username, role: "TEACHER" });
  const teacherProfile = await prisma.teacher.create({
    data: { userId: teacher.id, employeeId: `EMP-ER-${Date.now()}` },
  });
  teacherId = teacherProfile.id;

  const admin = await prisma.user.create({
    data: { username: `a-er-${Date.now()}`, password: "hashed", role: "ADMIN", status: "ACTIVE", firstName: "Admin", lastName: "Approver" },
  });
  adminUserId = admin.id;
  adminToken = signAccessToken({ id: admin.id, username: admin.username, role: "ADMIN" });
});

afterAll(async () => {
  await prisma.gradeEditRequest.deleteMany({ where: { teacherId: teacherUserId } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [teacherUserId, adminUserId] } } }).catch(() => {});
});

describe("edit-request flow (teacher create → admin approve)", () => {
  let requestId = "";

  it("teacher can request edit access for a past term", async () => {
    const res = await request(app)
      .post("/api/grades/edit-request")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ term: "T1", reason: "Correct a score entered after the deadline" });

    expect(res.status).toBe(201);
    requestId = res.body.request.id;
    expect(requestId).toBeTruthy();

    const row = await prisma.gradeEditRequest.findUnique({ where: { id: requestId } });
    expect(row?.status).toBe("PENDING");
  });

  it("admin sees it as pending and approves it", async () => {
    const list = await request(app)
      .get("/api/grades/admin/edit-requests?status=PENDING")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.requests.some((r: any) => r.id === requestId)).toBe(true);

    const approve = await request(app)
      .post(`/api/grades/admin/edit-requests/${requestId}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ hours: 24 });
    expect(approve.status).toBe(200);

    const row = await prisma.gradeEditRequest.findUnique({ where: { id: requestId } });
    expect(row?.status).toBe("APPROVED");
    expect(row?.expiresAt).toBeTruthy();
  });

  it("rejects a second request while one is already pending/approved for the term", async () => {
    await prisma.gradeEditRequest.update({ where: { id: requestId }, data: { status: "PENDING" } });
    const res = await request(app)
      .post("/api/grades/edit-request")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ term: "T1", reason: "duplicate" });
    expect(res.status).toBe(409);
  });
});
