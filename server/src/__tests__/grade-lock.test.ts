/**
 * grade-lock.test.ts — Grade lock enforcement tests
 */
import { describe, it, expect, beforeAll } from "vitest";
import { BASE, hasCredentials, getAdminCredentials, getTeacherCredentials, login } from "./test-helpers";

const credsOk = hasCredentials("admin", "teacher");

describe.skipIf(!credsOk)("Grade Lock", () => {
  let adminToken = "";
  let teacherToken = "";

  beforeAll(async () => {
    const adminCreds = getAdminCredentials()!;
    const teacherCreds = getTeacherCredentials()!;
    adminToken = await login(adminCreds.email, adminCreds.password);
    teacherToken = await login(teacherCreds.email, teacherCreds.password);
  });

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
    if (!settings.gradeLock) return;
    const res = await fetch(`${BASE}/grades/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` },
      body: JSON.stringify({ studentId: "test", sectionId: "test", subjectId: "test", term: settings.currentTerm, scores: [] }),
    });
    expect([403, 400]).toContain(res.status);
  });
});
