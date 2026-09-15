/**
 * service-auth.test.ts — P1-3 regression tests.
 * Integration auth must FAIL CLOSED when the key is not configured.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { serviceAuth } from "../middleware/serviceAuth";

function makeApp() {
  const app = express();
  app.post("/integration/thing", serviceAuth, (_req, res) => res.json({ ok: true }));
  return app;
}

const ORIGINAL = process.env.ENROLLPRO_API_KEY;

beforeEach(() => {
  delete process.env.ENROLLPRO_API_KEY;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ENROLLPRO_API_KEY;
  else process.env.ENROLLPRO_API_KEY = ORIGINAL;
});

describe("P1-3 — serviceAuth fail-closed", () => {
  it("returns 401 when the key is not configured (no fail-open)", async () => {
    delete process.env.ENROLLPRO_API_KEY;
    const res = await request(makeApp()).post("/integration/thing").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it("returns 401 when the key is configured but the header is missing or wrong", async () => {
    process.env.ENROLLPRO_API_KEY = "secret-key-123";
    const missing = await request(makeApp()).post("/integration/thing").send({});
    expect(missing.status).toBe(401);

    const wrong = await request(makeApp())
      .post("/integration/thing")
      .set("x-enrollpro-api-key", "wrong-key")
      .send({});
    expect(wrong.status).toBe(401);
  });

  it("allows the request when the key matches", async () => {
    process.env.ENROLLPRO_API_KEY = "secret-key-123";
    const res = await request(makeApp())
      .post("/integration/thing")
      .set("x-enrollpro-api-key", "secret-key-123")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
