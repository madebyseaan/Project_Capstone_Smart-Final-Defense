/**
 * auth.test.ts — Authentication flow tests
 */

import { describe, it, expect } from "vitest";

const BASE = "http://localhost:5003/api";

describe("POST /api/auth/login", () => {
  it("returns token + user for valid credentials", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "1000002@deped.gov.ph", password: "DepEd2026!" }),
    });
    const data: any = await res.json();

    expect(res.status).toBe(200);
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe("string");
    expect(data.user).toBeDefined();
    expect(data.user.firstName).toBeDefined();
    expect(data.user.lastName).toBeDefined();
    expect(data.user.role).toBeDefined();
  });

  it("returns 400 or 429 for empty body", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect([400, 429]).toContain(res.status);
  });

  it("returns 400 or 429 for missing password", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@test.com" }),
    });

    expect([400, 429]).toContain(res.status);
  });

  it("returns 400 or 429 for missing email", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "somepassword" }),
    });

    expect([400, 429]).toContain(res.status);
  });

  it("returns 401 or 429 for wrong password", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "1000002@deped.gov.ph", password: "WrongPassword123!" }),
    });

    expect([401, 429]).toContain(res.status);
  });

  it("returns 401 for nonexistent user", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@nowhere.com", password: "password" }),
    });

    expect(res.status).toBe(401);
  });

  it("rejects non-string email type (400 or 429)", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: 12345, password: "test" }),
    });

    expect([400, 429]).toContain(res.status);
  });
});
