/**
 * grade-batch.test.ts — Batch grade save endpoint tests
 */
import { describe, it, expect, beforeAll } from "vitest";
import { BASE, hasCredentials, getTeacherCredentials, login } from "./test-helpers";

const credsOk = hasCredentials("teacher");

describe.skipIf(!credsOk)("Batch Grade Save", () => {
  let teacherToken = "";

  beforeAll(async () => {
    const teacherCreds = getTeacherCredentials()!;
    teacherToken = await login(teacherCreds.email, teacherCreds.password);
  });

  it("POST /grades/grade/batch requires authentication", async () => {
    const res = await fetch(`${BASE}/grades/grade/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classAssignmentId: "x", term: "T1", updates: [] }),
    });
    expect([401, 403]).toContain(res.status);
  });

  it("POST /grades/grade/batch rejects empty updates", async () => {
    const res = await fetch(`${BASE}/grades/grade/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` },
      body: JSON.stringify({ classAssignmentId: "nonexistent", term: "T1", updates: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /grades/grade/batch rejects >200 updates", async () => {
    const updates = Array.from({ length: 201 }, (_, i) => ({
      studentId: `student-${i}`,
    }));
    const res = await fetch(`${BASE}/grades/grade/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` },
      body: JSON.stringify({ classAssignmentId: "nonexistent", term: "T1", updates }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /grades/grade/batch rejects invalid term", async () => {
    const res = await fetch(`${BASE}/grades/grade/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` },
      body: JSON.stringify({
        classAssignmentId: "nonexistent",
        term: "T4",
        updates: [{ studentId: "s1" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /grades/grade/batch rejects nonexistent class assignment", async () => {
    const res = await fetch(`${BASE}/grades/grade/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` },
      body: JSON.stringify({
        classAssignmentId: "nonexistent-id-12345",
        term: "T1",
        updates: [{ studentId: "s1" }],
      }),
    });
    expect([403, 404]).toContain(res.status);
  });
});
