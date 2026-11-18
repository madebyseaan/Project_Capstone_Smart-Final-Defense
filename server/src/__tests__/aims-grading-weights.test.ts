import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { Router } from "express";
import request from "supertest";
import registerAimsGradingWeights, {
  mapEffectiveWeightsSource,
  normalizeAimsTerm,
} from "../routes/integration-sub/aimsGradingWeights";

const ORIGINAL_KEY = process.env.AIMS_SERVICE_API_KEY;
const COURSE_ID = "904bcd77-8950-4fb7-a373-9fecb80646d4";

function makeApp() {
  const app = express();
  const router = Router();
  registerAimsGradingWeights(router);
  app.use("/api/integration", router);
  return app;
}

beforeEach(() => {
  delete process.env.AIMS_SERVICE_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.AIMS_SERVICE_API_KEY;
  else process.env.AIMS_SERVICE_API_KEY = ORIGINAL_KEY;
});

describe("aimsServiceAuth", () => {
  it("fails closed when AIMS_SERVICE_API_KEY is not configured", async () => {
    const res = await request(makeApp()).get(
      `/api/integration/aims/grading-weights?aimsCourseId=${COURSE_ID}`,
    );
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("rejects a missing or wrong x-api-key", async () => {
    process.env.AIMS_SERVICE_API_KEY = "aims-secret";

    const missing = await request(makeApp()).get(
      `/api/integration/aims/grading-weights?aimsCourseId=${COURSE_ID}`,
    );
    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe("UNAUTHORIZED");

    const wrong = await request(makeApp())
      .get(`/api/integration/aims/grading-weights?aimsCourseId=${COURSE_ID}`)
      .set("x-api-key", "wrong");
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("UNAUTHORIZED");
  });
});

describe("aims grading weights query validation", () => {
  beforeEach(() => {
    process.env.AIMS_SERVICE_API_KEY = "aims-secret";
  });

  it("requires a lookup key", async () => {
    const res = await request(makeApp())
      .get("/api/integration/aims/grading-weights")
      .set("x-api-key", "aims-secret");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_QUERY");
  });

  it("rejects a malformed aimsCourseId", async () => {
    const res = await request(makeApp())
      .get("/api/integration/aims/grading-weights?aimsCourseId=not-a-uuid")
      .set("x-api-key", "aims-secret");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_QUERY");
  });

  it("rejects an invalid term before touching the database", async () => {
    const res = await request(makeApp())
      .get(`/api/integration/aims/grading-weights?aimsCourseId=${COURSE_ID}&term=9`)
      .set("x-api-key", "aims-secret");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_QUERY");
  });

  it("rejects more than 50 batch IDs", async () => {
    const ids = Array.from({ length: 51 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    ).join(",");
    const res = await request(makeApp())
      .get(`/api/integration/aims/grading-weights?aimsCourseIds=${ids}`)
      .set("x-api-key", "aims-secret");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TOO_MANY_COURSES");
  });

  it("rejects a malformed batch ID", async () => {
    const res = await request(makeApp())
      .get(`/api/integration/aims/grading-weights?aimsCourseIds=${COURSE_ID},nope`)
      .set("x-api-key", "aims-secret");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_QUERY");
  });
});

describe("normalizeAimsTerm", () => {
  it("accepts numeric and T-prefixed terms", () => {
    expect(normalizeAimsTerm("1")).toEqual({ ok: true, value: "T1" });
    expect(normalizeAimsTerm("t2")).toEqual({ ok: true, value: "T2" });
    expect(normalizeAimsTerm("T3")).toEqual({ ok: true, value: "T3" });
  });

  it("returns null when omitted", () => {
    expect(normalizeAimsTerm()).toEqual({ ok: true, value: null });
  });

  it("rejects anything else", () => {
    expect(normalizeAimsTerm("4")).toEqual({ ok: false });
    expect(normalizeAimsTerm("T4")).toEqual({ ok: false });
  });
});

describe("mapEffectiveWeightsSource", () => {
  it("maps SMART source names to the AIMS contract", () => {
    expect(mapEffectiveWeightsSource("subject-override")).toBe("SUBJECT_DEFAULT");
    expect(mapEffectiveWeightsSource("subject-type")).toBe("GROUP_DEFAULT");
    expect(mapEffectiveWeightsSource("generic-fallback")).toBe("GENERIC_FALLBACK");
  });
});
