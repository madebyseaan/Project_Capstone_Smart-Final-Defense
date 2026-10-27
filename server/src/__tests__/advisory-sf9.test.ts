/**
 * advisory-sf9.test.ts — Live-server contract tests for teacher printables.
 * Skips when SMART_TEST_* credentials are not configured.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  getRegistrarCredentials,
  getTeacherCredentials,
  hasCredentials,
  login,
} from "./test-helpers";

const teacherCredsOk = hasCredentials("teacher");

describe.skipIf(!teacherCredsOk)("Advisory SF9 printables", () => {
  let teacherToken = "";
  let schoolYear = "";
  let studentId = "";
  let teacherHasAdvisory = false;

  beforeAll(async () => {
    const creds = getTeacherCredentials()!;
    teacherToken = await login(creds.email, creds.password);

    const res = await fetch(`${BASE}/advisory/sf9`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    if (res.status !== 200) return;
    teacherHasAdvisory = true;
    const body: any = await res.json();
    schoolYear = body.meta?.schoolYear ?? "";
    studentId = body.students?.[0]?.student?.id ?? "";
  });

  it("returns the full official SF9 payload for the advisory", async () => {
    if (!teacherHasAdvisory) return;
    const res = await fetch(`${BASE}/advisory/sf9`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();

    expect(body.meta.mode).toBe("SF9");
    expect(body.meta.isTemporary).toBe(false);
    expect(Array.isArray(body.students)).toBe(true);
    if (body.students.length === 0) return;

    const student = body.students[0];
    expect(Array.isArray(student.subjectGrades)).toBe(true);
    expect(student.attendance).toHaveProperty("months");
    expect(student.attendance.months).toHaveLength(11);
  });

  it("returns a term-only temporary card payload", async () => {
    if (!teacherHasAdvisory) return;
    const res = await fetch(`${BASE}/advisory/sf9?term=T1`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();

    expect(body.meta.mode).toBe("TERM_CARD");
    expect(body.meta.isTemporary).toBe(true);
    expect(body.meta.term).toBe("T1");
    expect(typeof body.meta.termLabel).toBe("string");
    if (body.students.length === 0) return;

    for (const student of body.students) {
      expect(Array.isArray(student.termSubjects)).toBe(true);
      expect(student.termSubjects.every((row: any) => "grade" in row)).toBe(true);
      expect(["DRAFT", "FINAL"]).toContain(student.meta.termStatus);
      expect(student).not.toHaveProperty("promotionStatus");
      expect(student).not.toHaveProperty("honors");
    }
  });

  it("rejects an invalid term", async () => {
    const res = await fetch(`${BASE}/advisory/sf9?term=T4`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-active school year", async () => {
    const res = await fetch(`${BASE}/advisory/sf9?schoolYear=1900-1901`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(res.status).toBe(400);
  });

  it("does not allow a teacher to use the registrar SF9 endpoint", async () => {
    if (!studentId) return;
    const res = await fetch(
      `${BASE}/registrar/forms/sf9/${studentId}?schoolYear=${schoolYear}`,
      { headers: { Authorization: `Bearer ${teacherToken}` } },
    );
    expect(res.status).toBe(403);
  });

  it("does not allow a registrar to use the advisory printables endpoint", async () => {
    if (!hasCredentials("registrar")) return;
    const creds = getRegistrarCredentials()!;
    const registrarToken = await login(creds.email, creds.password);
    if (!registrarToken) return;

    const res = await fetch(`${BASE}/advisory/sf9`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    expect(res.status).toBe(403);
  });
});
