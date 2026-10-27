/**
 * observed-values.test.ts — Live-server roundtrip for SF9 observed values.
 * Writes only to the isolated test database (run via `pnpm --prefix server test`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  getCsrfToken,
  getRegistrarCredentials,
  getTeacherCredentials,
  hasCredentials,
  login,
} from "./test-helpers";

const credsOk = hasCredentials("teacher");

describe.skipIf(!credsOk)("Observed values", () => {
  let teacherToken = "";
  let registrarToken = "";
  let csrfToken = "";
  let studentId = "";
  let behaviorCodes: string[] = [];

  const authHeaders = () => ({ Authorization: `Bearer ${teacherToken}` });

  const saveValues = async (values: Array<{ behaviorCode: string; rating: string }>) =>
    fetch(`${BASE}/advisory/observed-values/${studentId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken}`,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ term: "T1", values }),
    });

  beforeAll(async () => {
    const creds = getTeacherCredentials()!;
    teacherToken = await login(creds.email, creds.password);
    csrfToken = await getCsrfToken();

    const res = await fetch(`${BASE}/advisory/observed-values?term=T1`, {
      headers: authHeaders(),
    });
    if (res.status !== 200) return;
    const data: any = await res.json();
    studentId = data.students?.[0]?.id ?? "";
    behaviorCodes = (data.groups ?? []).flatMap((group: any) =>
      group.behaviors.map((behavior: any) => behavior.code),
    );

    if (hasCredentials("registrar")) {
      const regCreds = getRegistrarCredentials()!;
      registrarToken = await login(regCreds.email, regCreds.password);
    }
  });

  afterAll(async () => {
    if (studentId && csrfToken) {
      await saveValues([]).catch(() => undefined);
    }
  });

  it("returns groups and learners for the advisory", async () => {
    if (!studentId) return;
    const res = await fetch(`${BASE}/advisory/observed-values?term=T1`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.groups.length).toBeGreaterThan(0);
    expect(body.students.length).toBeGreaterThan(0);
    expect(body.students[0].totalCount).toBeGreaterThan(0);
  });

  it("saves a rating set, reads it back, and clears it", async () => {
    if (!studentId || behaviorCodes.length < 2) return;

    const values = [
      { behaviorCode: behaviorCodes[0], rating: "AO" },
      { behaviorCode: behaviorCodes[1], rating: "SO" },
    ];

    const saveRes = await saveValues(values);
    expect(saveRes.status).toBe(200);
    const saveBody: any = await saveRes.json();
    expect(saveBody.values).toHaveLength(2);

    const readRes = await fetch(`${BASE}/advisory/observed-values?term=T1`, {
      headers: authHeaders(),
    });
    const readBody: any = await readRes.json();
    const student = readBody.students.find((item: any) => item.id === studentId);
    expect(student.markedCount).toBe(2);
    expect(student.ratings[behaviorCodes[0]]).toBe("AO");
    expect(student.ratings[behaviorCodes[1]]).toBe("SO");

    const clearRes = await saveValues([]);
    expect(clearRes.status).toBe(200);
  });

  it("rejects an unknown behavior code", async () => {
    if (!studentId) return;
    const res = await saveValues([{ behaviorCode: "NOT_A_REAL_CODE", rating: "AO" }]);
    expect(res.status).toBe(400);
  });

  it("does not allow a registrar to read teacher observed values", async () => {
    if (!registrarToken) return;
    const res = await fetch(`${BASE}/advisory/observed-values?term=T1`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    expect(res.status).toBe(403);
  });
});
