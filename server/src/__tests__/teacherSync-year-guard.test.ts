/**
 * teacherSync-year-guard.test.ts — RL-10a pure guard: per-teacher sync must
 * fail closed instead of writing rows under a placeholder school-year label.
 */
import { describe, it, expect } from "vitest";
import { isResolvedSchoolYearLabel } from "../lib/teacherSync";

describe("RL-10a — isResolvedSchoolYearLabel", () => {
  it("accepts real labels (with surrounding whitespace)", () => {
    expect(isResolvedSchoolYearLabel("2030-2031")).toBe(true);
    expect(isResolvedSchoolYearLabel(" 2026-2027 ")).toBe(true);
  });

  it("rejects placeholder, empty and missing labels", () => {
    const bad: Array<string | null | undefined> = [
      "loading...",
      "LOADING...",
      "loading",
      "unknown",
      "(unknown)",
      "",
      "   ",
      null,
      undefined,
    ];
    for (const v of bad) {
      expect(isResolvedSchoolYearLabel(v)).toBe(false);
    }
  });
});
