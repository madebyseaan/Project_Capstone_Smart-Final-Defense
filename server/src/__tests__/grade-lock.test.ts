/**
 * grade-lock.test.ts — Grade lock enforcement tests
 */

import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:5003/api";

let adminToken: string;
let teacherToken: string;

beforeAll(async () => {
  const adminRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "1234501@deped.gov.ph", password: "DepEdSY2026!" }),
  });
  const adminData: any = await adminRes.json();
  adminToken = adminData.token;

  const teacherRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "1000002@deped.gov.ph", password: "DepEd2026!" }),
  });
  const teacherData: any = await teacherRes.json();
  teacherToken = teacherData.token;
});

describe("Grade Lock", () => {
  it("GET /admin/settings returns gradeLock field", async () => {
    const res = await fetch(`${BASE}/admin/settings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data: any = await res.json();

    expect(res.status).toBe(200);
    expect(data.settings).toBeDefined();
    expect(data.settings.gradeLock).toBeDefined();
    expect(typeof data.settings.gradeLock).toBe("boolean");
  });

  it("GET /admin/settings returns currentTerm field", async () => {
    const res = await fetch(`${BASE}/admin/settings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data: any = await res.json();

    expect(data.settings.currentTerm).toBeDefined();
    expect(["T1", "T2", "T3"]).toContain(data.settings.currentTerm);
  });

  it("POST /grades/grade is blocked when grades are locked", async () => {
    const settingsRes = await fetch(`${BASE}/admin/settings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const { settings }: any = await settingsRes.json();

    if (!settings.gradeLock) {
      return;
    }

    const res = await fetch(`${BASE}/grades/grade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({
        studentId: "test",
        sectionId: "test",
        subjectId: "test",
        term: settings.currentTerm,
        scores: [],
      }),
    });

    expect([403, 400]).toContain(res.status);
  });
});
