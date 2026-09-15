/**
 * prune-year-guard.test.ts — R0a pure guard: prune must refuse to run when
 * SMART's active year and EnrollPro's active year disagree (blocked rollover
 * must never be interpreted as "everyone left").
 */
import { describe, it, expect } from "vitest";
import { isPruneYearAligned } from "../lib/prune";

describe("R0a — isPruneYearAligned (prune year-mismatch guard)", () => {
  it("aligned when EnrollPro externalIds match", () => {
    expect(isPruneYearAligned(9, "2030-2031", 9, "2030-2031")).toBe(true);
  });

  it("mismatch when externalIds differ — even if labels look aligned", () => {
    expect(isPruneYearAligned(8, "2030-2031", 9, "2030-2031")).toBe(false);
  });

  it("falls back to label equality when no externalId is linked", () => {
    expect(isPruneYearAligned(null, "2030-2031", 9, "2030-2031")).toBe(true);
    expect(isPruneYearAligned(undefined, "2029-2030", 9, "2030-2031")).toBe(false);
  });

  it("fail closed when nothing identifies the SMART year", () => {
    expect(isPruneYearAligned(null, null, 9, "2030-2031")).toBe(false);
    expect(isPruneYearAligned(undefined, "", 9, "2030-2031")).toBe(false);
  });
});
