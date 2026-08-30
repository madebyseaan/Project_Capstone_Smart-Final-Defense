/**
 * auth.test.ts — Authentication tests
 */
import { describe, it, expect, beforeAll } from "vitest";
import { BASE, hasCredentials, getTeacherCredentials, login } from "./test-helpers";

const credsOk = hasCredentials("teacher");

describe.skipIf(!credsOk)("Auth", () => {
  let teacherCreds: { email: string; password: string };

  beforeAll(async () => {
    teacherCreds = getTeacherCredentials()!;
  });

  it("returns token + user for valid credentials", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: teacherCreds.email, password: teacherCreds.password }),
    });
    const data: any = await res.json();
    expect(res.status).toBe(200);
    expect(data.token).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(teacherCreds.email);
  });

  it("returns 400 or 429 for missing password", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect([400, 429]).toContain(res.status);
  });

  it("returns 401 or 429 for wrong password", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: teacherCreds.email, password: "WrongPassword123!" }),
    });
    expect([401, 429]).toContain(res.status);
  });

  it("returns 401 for nonexistent user", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@nowhere.com", password: "password" }),
    });
    expect([401, 429]).toContain(res.status);
  });
});
