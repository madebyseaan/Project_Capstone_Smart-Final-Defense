/**
 * sf10-snapshot.test.ts — Student profile snapshot tests
 */

import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:5003/api";

let registrarToken: string;

beforeAll(async () => {
  const adminRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "1234502@deped.gov.ph", password: "DepEd2026!" }),
  });
  const adminData: any = await adminRes.json();
  registrarToken = adminData.token;
});

describe("SF10 Student Profile Snapshot", () => {
  it("GET /registrar/sections returns sections", async () => {
    const res = await fetch(`${BASE}/registrar/sections?schoolYear=2026-2027`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const data: any = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("name");
  });

  it("GET /registrar/forms/sf8 returns students for a section", async () => {
    const sectionsRes = await fetch(`${BASE}/registrar/sections?schoolYear=2026-2027`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const sections: any = await sectionsRes.json();
    const sectionId = sections[0].id;

    const res = await fetch(`${BASE}/registrar/forms/sf8?schoolYear=2026-2027&sectionId=${sectionId}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const data: any = await res.json();

    expect(res.status).toBe(200);
    expect(data.students).toBeDefined();
    expect(Array.isArray(data.students)).toBe(true);
    expect(data.students.length).toBeGreaterThan(0);
  });

  it("GET /registrar/forms/sf10/:studentId returns student with snapshot", async () => {
    const sectionsRes = await fetch(`${BASE}/registrar/sections?schoolYear=2026-2027`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const sections: any = await sectionsRes.json();
    const sectionId = sections[0].id;

    const sf8Res = await fetch(`${BASE}/registrar/forms/sf8?schoolYear=2026-2027&sectionId=${sectionId}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const sf8: any = await sf8Res.json();
    const studentId = sf8.students[0].id;

    const res = await fetch(`${BASE}/registrar/forms/sf10/${studentId}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const data: any = await res.json();

    expect(res.status).toBe(200);
    expect(data.student).toBeDefined();
    expect(data.student.name).toBeDefined();
    expect(data.schoolRecords).toBeDefined();
    expect(Array.isArray(data.schoolRecords)).toBe(true);
  });

  it("SF10 school records contain profileSnapshot field", async () => {
    const sectionsRes = await fetch(`${BASE}/registrar/sections?schoolYear=2026-2027`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const sections: any = await sectionsRes.json();
    const sectionId = sections[0].id;

    const sf8Res = await fetch(`${BASE}/registrar/forms/sf8?schoolYear=2026-2027&sectionId=${sectionId}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const sf8: any = await sf8Res.json();
    const studentId = sf8.students[0].id;

    const res = await fetch(`${BASE}/registrar/forms/sf10/${studentId}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const data: any = await res.json();

    expect(data.schoolRecords.length).toBeGreaterThan(0);
    const record = data.schoolRecords[0];
    expect(record).toHaveProperty("profileSnapshot");
  });

  it("profileSnapshot contains student identity fields when present", async () => {
    const sectionsRes = await fetch(`${BASE}/registrar/sections?schoolYear=2026-2027`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const sections: any = await sectionsRes.json();
    const sectionId = sections[0].id;

    const sf8Res = await fetch(`${BASE}/registrar/forms/sf8?schoolYear=2026-2027&sectionId=${sectionId}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const sf8: any = await sf8Res.json();
    const studentId = sf8.students[0].id;

    const res = await fetch(`${BASE}/registrar/forms/sf10/${studentId}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const data: any = await res.json();

    const recordWithSnap = data.schoolRecords.find((r: any) => r.profileSnapshot != null);
    if (recordWithSnap) {
      const snap = recordWithSnap.profileSnapshot;
      expect(snap).toHaveProperty("lrn");
      expect(snap).toHaveProperty("firstName");
      expect(snap).toHaveProperty("lastName");
    }
  });
});
