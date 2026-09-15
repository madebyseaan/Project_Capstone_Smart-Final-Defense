/**
 * error-handler.test.ts — P1-5 regression tests for the global error handler.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { globalErrorHandler, apiNotFoundHandler } from "../middleware/errorHandler";

function makeApp() {
  const app = express();
  app.get("/boom", () => {
    throw new Error("secret internal detail: db password");
  });
  app.get("/bad", (_req, _res, next) => {
    const e: any = new Error("bad request detail");
    e.status = 400;
    next(e);
  });
  app.use("/api", apiNotFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

describe("P1-5 — global error handler", () => {
  it("returns a generic 500 and never leaks the internal message or stack", async () => {
    const res = await request(makeApp()).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
    expect(JSON.stringify(res.body)).not.toContain("secret internal detail");
  });

  it("preserves a numeric status when the error sets one", async () => {
    const res = await request(makeApp()).get("/bad");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Internal server error" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await request(makeApp()).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });
});
