/**
 * public-settings.test.ts — RL-4a regression test.
 *
 * GET /api/admin/settings/public must:
 *  - be reachable without authentication (teacher/registrar depend on it)
 *  - expose term labels + active year/term (calendar metadata)
 *  - never expose EnrollPro credentials or other secrets
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import adminRoutes from "../routes/admin";

const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);

describe("RL-4a — public settings endpoint", () => {
  it("returns term labels + active year/term without auth and leaks no secrets", async () => {
    const res = await request(app).get("/api/admin/settings/public");

    expect(res.status).toBe(200);
    expect(res.body.settings).toBeDefined();
    expect(res.body.termLabels).toBeDefined();
    expect(res.body.termLabels.T1).toBeTruthy();
    expect(res.body.termLabels.T2).toBeTruthy();
    expect(res.body.termLabels.T3).toBeTruthy();
    expect(typeof res.body.settings.currentSchoolYear).toBe("string");
    expect(res.body.settings.currentTerm).toBeTruthy();

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("enrollproPassword");
    expect(raw).not.toContain("enrollproIntegrationKey");
  });
});
