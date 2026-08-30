/**
 * csrf.test.ts — CSRF token flow tests
 */
import { describe, it, expect, beforeAll } from "vitest";
import { BASE, hasCredentials, getAdminCredentials, getTeacherCredentials, login, getCsrfToken } from "./test-helpers";

const credsOk = hasCredentials("admin", "teacher");

describe.skipIf(!credsOk)("CSRF Protection", () => {
  let adminToken = "";

  beforeAll(async () => {
    const adminCreds = getAdminCredentials()!;
    adminToken = await login(adminCreds.email, adminCreds.password);
  });

  it("GET /api/health sets x-csrf-token cookie", async () => {
    const res = await fetch(`${BASE}/health`);
    const setCookie = res.headers.get("set-cookie") || "";
    expect(res.status).toBe(200);
    expect(setCookie).toContain("x-csrf-token");
  });

  it("POST /api/admin/users without CSRF token returns 403", async () => {
    const res = await fetch(`${BASE}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: "testuser", email: "test@test.com", password: "TestPass123!", role: "TEACHER" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/admin/users with invalid CSRF token returns 403", async () => {
    const res = await fetch(`${BASE}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}`, "x-csrf-token": "invalid.token.here" },
      body: JSON.stringify({ username: "testuser", email: "test@test.com", password: "TestPass123!", role: "TEACHER" }),
    });
    expect(res.status).toBe(403);
  });

  it("auth routes are exempt from CSRF (200 or 429)", async () => {
    const creds = getTeacherCredentials()!;
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
    expect([200, 429]).toContain(res.status);
  });
});
