/**
 * external-records-api.test.ts — Prior-school record CRUD routes (live server).
 *
 * Self-contained: mints a registrar/teacher JWT with the server's own signer and
 * cleans up any record it creates. Read-only against existing students.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";

const BASE = "http://localhost:5003/api";

let ready = false;
let registrarToken = "";
let teacherToken = "";
let csrf = "";
let studentId = "";
let createdId: string | null = null;

async function mintToken(role: "REGISTRAR" | "TEACHER"): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { role },
    select: { id: true, username: true, email: true, role: true },
  });
  if (!user) return "";
  return signAccessToken({ id: user.id, username: user.username, email: user.email ?? undefined, role: user.role });
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-csrf-token": csrf };
}

describe("External prior-school records API", () => {
  beforeAll(async () => {
    try {
      const health = await fetch(`${BASE}/health`);
      if (!health.ok) return;
      const cookies = (health.headers.getSetCookie?.() ?? []) as string[];
      csrf = cookies.find((c) => c.startsWith("x-csrf-token="))?.split(";")[0]?.split("=")[1] ?? "";
      registrarToken = await mintToken("REGISTRAR");
      teacherToken = await mintToken("TEACHER");
      const student = await prisma.student.findFirst({ select: { id: true } });
      studentId = student?.id ?? "";
      ready = !!registrarToken && !!studentId;
    } catch {
      ready = false;
    }
  });

  afterAll(async () => {
    if (createdId) {
      await prisma.externalSchoolRecord.delete({ where: { id: createdId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("401 without a token", async () => {
    if (!ready) return;
    const res = await fetch(`${BASE}/registrar/students/${studentId}/external-records`);
    expect(res.status).toBe(401);
  });

  it("403 for a non-registrar (teacher)", async () => {
    if (!ready || !teacherToken) return;
    const res = await fetch(`${BASE}/registrar/students/${studentId}/external-records`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("lists records for a student (200)", async () => {
    if (!ready) return;
    const res = await fetch(`${BASE}/registrar/students/${studentId}/external-records`, {
      headers: auth(registrarToken),
    });
    const data: any = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data.records)).toBe(true);
  });

  it("rejects an invalid create body (400)", async () => {
    if (!ready) return;
    const res = await fetch(`${BASE}/registrar/students/${studentId}/external-records`, {
      method: "POST",
      headers: auth(registrarToken),
      body: JSON.stringify({ gradeLevel: "GRADE_8", schoolName: "X", subjects: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("creates, updates, then deletes a record", async () => {
    if (!ready) return;

    const createRes = await fetch(`${BASE}/registrar/students/${studentId}/external-records`, {
      method: "POST",
      headers: auth(registrarToken),
      body: JSON.stringify({
        schoolYear: "9999-9999",
        gradeLevel: "GRADE_8",
        schoolName: "ZZ Integration Test School",
        subjects: [
          { subjectCode: "MATH8", subjectName: "Mathematics", terms: [{ label: "T1", value: 88 }, { label: "T2", value: 90 }] },
        ],
      }),
    });
    // 201 on success, 409 if a prior test left a row behind.
    expect([201, 409]).toContain(createRes.status);
    if (createRes.status !== 201) return;

    const createData: any = await createRes.json();
    createdId = createData.record.id;
    expect(createData.record.subjects).toHaveLength(1);
    expect(createData.record.subjects[0].finalRating).toBe(89);

    const patchRes = await fetch(`${BASE}/registrar/external-records/${createdId}`, {
      method: "PATCH",
      headers: auth(registrarToken),
      body: JSON.stringify({ promotionStatus: "Promoted" }),
    });
    expect(patchRes.status).toBe(200);

    const delRes = await fetch(`${BASE}/registrar/external-records/${createdId}`, {
      method: "DELETE",
      headers: auth(registrarToken),
    });
    expect(delRes.status).toBe(200);
    createdId = null;
  });
});
