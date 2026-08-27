/**
 * csrf.test.ts — CSRF token flow tests
 */

import { describe, it, expect } from "vitest";

const BASE = "http://localhost:5003/api";

describe("CSRF Protection", () => {
  it("GET /api/health sets x-csrf-token cookie", async () => {
    const res = await fetch(`${BASE}/health`);
    const setCookie = res.headers.get("set-cookie") || "";

    expect(res.status).toBe(200);
    expect(setCookie).toContain("x-csrf-token");
  });

  it("POST /api/admin/users without CSRF token returns 403", async () => {
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "1234501@deped.gov.ph", password: "DepEdSY2026!" }),
    });
    const loginData: any = await loginRes.json();
    const token = loginData.token;

    const res = await fetch(`${BASE}/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        username: "testuser",
        email: "test@test.com",
        password: "TestPass123!",
        role: "TEACHER",
      }),
    });

    expect(res.status).toBe(403);
  });

  it("POST /api/admin/users with invalid CSRF token returns 403", async () => {
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "1234501@deped.gov.ph", password: "DepEdSY2026!" }),
    });
    const loginData: any = await loginRes.json();
    const token = loginData.token;

    const res = await fetch(`${BASE}/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-csrf-token": "invalid.token.here",
      },
      body: JSON.stringify({
        username: "testuser",
        email: "test@test.com",
        password: "TestPass123!",
        role: "TEACHER",
      }),
    });

    expect(res.status).toBe(403);
  });

  it("auth routes are exempt from CSRF (200 or 429)", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "1000002@deped.gov.ph", password: "DepEd2026!" }),
    });

    expect([200, 429]).toContain(res.status);
  });
});
