/**
 * demo-term-mode.test.ts — Verifies the DEMO-only term override is strictly
 * opt-in (default OFF) and that the settings schema accepts local term dates.
 */
import { describe, it, expect, afterEach } from "vitest";
import { isDemoTermMode } from "../lib/demoTermMode";
import { settingsUpdateSchema } from "../schemas/admin";
import { resolveCurrentTerm } from "../routes/grades-sub/helpers";
import { prisma } from "../lib/prisma";

describe("isDemoTermMode", () => {
  const original = process.env.DEMO_TERM_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_TERM_MODE;
    else process.env.DEMO_TERM_MODE = original;
  });

  it("is OFF by default (no regression to normal operation)", () => {
    delete process.env.DEMO_TERM_MODE;
    expect(isDemoTermMode()).toBe(false);
  });

  it("is OFF for any value other than the exact string 'true'", () => {
    process.env.DEMO_TERM_MODE = "1";
    expect(isDemoTermMode()).toBe(false);
    process.env.DEMO_TERM_MODE = "TRUE";
    expect(isDemoTermMode()).toBe(false);
    process.env.DEMO_TERM_MODE = "false";
    expect(isDemoTermMode()).toBe(false);
  });

  it("is ON only when explicitly set to 'true'", () => {
    process.env.DEMO_TERM_MODE = "true";
    expect(isDemoTermMode()).toBe(true);
  });
});

describe("settingsUpdateSchema term-date fields", () => {
  it("accepts local term dates + current term", () => {
    const res = settingsUpdateSchema.safeParse({
      body: {
        currentTerm: "T2",
        t1StartDate: "2026-06-08",
        t1EndDate: "2026-09-11",
        t2StartDate: "2026-09-12",
        t2EndDate: "2026-12-18",
        t3StartDate: null,
        t3EndDate: null,
        termDatesDerived: false,
      },
    });
    expect(res.success).toBe(true);
  });
});

describe("resolveCurrentTerm in demo mode", () => {
  const original = process.env.DEMO_TERM_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_TERM_MODE;
    else process.env.DEMO_TERM_MODE = original;
  });

  it("returns the locally stored term instead of calling EnrollPro", async () => {
    process.env.DEMO_TERM_MODE = "true";
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "main" },
      select: { currentTerm: true },
    });
    const term = await resolveCurrentTerm();
    expect(term).toBe(settings?.currentTerm ?? "T1");
  });
});
