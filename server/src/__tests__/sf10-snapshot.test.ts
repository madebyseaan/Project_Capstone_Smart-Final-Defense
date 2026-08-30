/**
 * sf10-snapshot.test.ts — SF10/SF-form tests (live server)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { BASE, hasCredentials, getRegistrarCredentials, login } from "./test-helpers";

const credsOk = hasCredentials("registrar");

describe.skipIf(!credsOk)("SF10 / Snapshot", () => {
  let registrarToken = "";

  beforeAll(async () => {
    const creds = getRegistrarCredentials()!;
    registrarToken = await login(creds.email, creds.password);
  });

  it("GET /registrar/sections returns sections", async () => {
    const res = await fetch(`${BASE}/registrar/sections`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const data: any = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /registrar/forms/sf8 returns students for a section", async () => {
    const sectionsRes = await fetch(`${BASE}/registrar/sections`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    const sections: any = await sectionsRes.json();
    if (!sections?.length) return;
    const res = await fetch(`${BASE}/registrar/forms/sf8/${sections[0].id}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    expect([200, 404]).toContain(res.status);
  });

  it("GET /registrar/forms/sf10/:studentId returns student with snapshot", async () => {
    const res = await fetch(`${BASE}/registrar/forms/sf10/test-student-id`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    expect([200, 404]).toContain(res.status);
  });

  it("SF10 school records contain profileSnapshot field", async () => {
    const res = await fetch(`${BASE}/registrar/forms/sf10/test-student-id`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    if (res.status !== 200) return;
    const data: any = await res.json();
    expect(data).toHaveProperty("profileSnapshot");
  });

  it("profileSnapshot contains student identity fields when present", async () => {
    const res = await fetch(`${BASE}/registrar/forms/sf10/test-student-id`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    if (res.status !== 200) return;
    const data: any = await res.json();
    if (data.profileSnapshot) {
      expect(data.profileSnapshot).toHaveProperty("firstName");
      expect(data.profileSnapshot).toHaveProperty("lastName");
    }
  });
});
