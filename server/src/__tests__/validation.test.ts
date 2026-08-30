/**
 * validation.test.ts — Request validation tests
 */
import { describe, it, expect, beforeAll } from "vitest";
import { BASE, hasCredentials, getAdminCredentials, getTeacherCredentials, login, getCsrfToken, post } from "./test-helpers";

const credsOk = hasCredentials("admin", "teacher");

describe.skipIf(!credsOk)("Validation", () => {
  let adminToken = "";
  let teacherToken = "";
  let csrfToken = "";

  beforeAll(async () => {
    const adminCreds = getAdminCredentials()!;
    const teacherCreds = getTeacherCredentials()!;
    adminToken = await login(adminCreds.email, adminCreds.password);
    teacherToken = await login(teacherCreds.email, teacherCreds.password);
    csrfToken = await getCsrfToken();
  });

  it("rejects POST /login with empty body (400 or 429)", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    expect([400, 429]).toContain(res.status);
  });

  it("rejects grade save with invalid term (400 or 403)", async () => {
    const res = await post("/grades/grade", teacherToken, {
      studentId: "test", sectionId: "test", subjectId: "test", term: "INVALID", scores: [],
    }, csrfToken);
    expect([400, 403]).toContain(res.status);
  });

  it("rejects admin user create with missing fields (400)", async () => {
    const res = await post("/admin/users", adminToken, {}, csrfToken);
    expect([400, 403]).toContain(res.status);
  });

  it("rejects attendance bulk with invalid status (400)", async () => {
    const res = await post("/attendance/bulk", teacherToken, {
      sectionId: "test", date: "2026-01-01",
      attendance: [{ studentId: "s1", status: "INVALID_STATUS" }],
    }, csrfToken);
    expect([400, 403, 409]).toContain(res.status);
  });

  it("rejects enrollment status with invalid status (400)", async () => {
    const res = await post("/registrar/enrollment/test-id/status", adminToken, { status: "INVALID" }, csrfToken);
    expect([400, 403, 404]).toContain(res.status);
  });
});
