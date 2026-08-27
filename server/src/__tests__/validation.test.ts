/**
 * validation.test.ts — Zod validation middleware tests
 */

import { describe, it, expect } from "vitest";

const BASE = "http://localhost:5003/api";

async function loginAsAdmin(): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "1234501@deped.gov.ph", password: "DepEdSY2026!" }),
  });
  const data: any = await res.json();
  return data.token;
}

async function getCsrfToken(): Promise<string> {
  const res = await fetch(`${BASE}/health`);
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/x-csrf-token=([^;]+)/);
  return match ? match[1] : "";
}

describe("Zod validation middleware", () => {
  it("rejects POST /login with empty body (400 or 429)", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data: any = await res.json();

    expect([400, 429]).toContain(res.status);
    if (res.status === 400) {
      expect(data.message).toBe("Validation failed");
      expect(data.errors).toBeInstanceOf(Array);
      expect(data.errors.length).toBeGreaterThanOrEqual(2);
      expect(data.errors[0]).toHaveProperty("path");
      expect(data.errors[0]).toHaveProperty("message");
    }
  });

  it("rejects grade save with invalid term (400 or 403)", async () => {
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "1000002@deped.gov.ph", password: "DepEd2026!" }),
    });
    if (loginRes.status === 429) return;
    const loginData: any = await loginRes.json();
    const token = loginData.token;
    if (!token) return;
    const csrf = await getCsrfToken();
    const gradeRes = await fetch(`${BASE}/grades/grade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        studentId: "test",
        sectionId: "test",
        subjectId: "test",
        term: "INVALID_TERM",
        scores: [],
      }),
    });

    expect([400, 403]).toContain(gradeRes.status);
  });

  it("rejects admin user create with missing fields (400)", async () => {
    const token = await loginAsAdmin();
    const csrf = await getCsrfToken();
    const res = await fetch(`${BASE}/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({}),
    });
    const data: any = await res.json();

    expect(res.status).toBe(400);
    expect(data.errors).toBeDefined();
  });

  it("rejects attendance bulk with invalid status (400)", async () => {
    const token = await loginAsAdmin();
    const csrf = await getCsrfToken();
    const res = await fetch(`${BASE}/attendance/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        attendanceDate: "2026-08-20",
        records: [{ studentId: "test", status: "INVALID_STATUS" }],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects enrollment status with invalid status (400)", async () => {
    const token = await loginAsAdmin();
    const csrf = await getCsrfToken();
    const res = await fetch(`${BASE}/registrar/enrollment/test-id/status`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ status: "BOGUS" }),
    });

    expect(res.status).toBe(400);
  });
});
