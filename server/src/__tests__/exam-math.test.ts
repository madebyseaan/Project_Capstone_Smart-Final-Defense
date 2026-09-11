/**
 * exam-math.test.ts — Pure unit tests for the Examinations (ST1/ST2/TE) math.
 * Mirrors the official E-Class-Record template formulas (weights 30/30/40).
 */
import { describe, it, expect } from "vitest";
import {
  EXAM_SUB_TESTS,
  defaultExamScores,
  computeExamPS,
  computeExamSubWS,
} from "../lib/examMath";

describe("examMath", () => {
  it("exposes the fixed 30/30/40 sub-test weights and 10/10/30 default HPS", () => {
    expect(EXAM_SUB_TESTS.map((s) => s.name)).toEqual(["ST1", "ST2", "TE"]);
    expect(EXAM_SUB_TESTS.map((s) => s.weight)).toEqual([30, 30, 40]);
    expect(EXAM_SUB_TESTS.map((s) => s.defaultMax)).toEqual([10, 10, 30]);
  });

  it("defaultExamScores returns zeroed ST1/ST2/TE with default maxes", () => {
    expect(defaultExamScores()).toEqual([
      { name: "ST1", score: 0, maxScore: 10 },
      { name: "ST2", score: 0, maxScore: 10 },
      { name: "TE", score: 0, maxScore: 30 },
    ]);
  });

  it("computes weighted sub-scores like the template (ROUND to 2dp)", () => {
    expect(computeExamSubWS(9, 10, 30)).toBe(27);
    expect(computeExamSubWS(6, 10, 30)).toBe(18);
    expect(computeExamSubWS(25, 30, 40)).toBe(33.33);
  });

  it("matches the beneficiary example: ST1 9/10, ST2 6/10, TE 25/30 → PS 78.33", () => {
    const ps = computeExamPS([
      { name: "ST1", score: 9, maxScore: 10 },
      { name: "ST2", score: 6, maxScore: 10 },
      { name: "TE", score: 25, maxScore: 30 },
    ]);
    expect(ps).toBe(78.33);
  });

  it("returns null when no usable max is present", () => {
    expect(computeExamPS(null)).toBeNull();
    expect(computeExamPS([])).toBeNull();
    expect(computeExamPS([
      { name: "ST1", score: 5, maxScore: 0 },
      { name: "ST2", score: 5, maxScore: 0 },
      { name: "TE", score: 5, maxScore: 0 },
    ])).toBeNull();
  });

  it("ignores sub-tests with a zero max but uses the others", () => {
    const ps = computeExamPS([
      { name: "ST1", score: 8, maxScore: 10 }, // 24
      { name: "ST2", score: 0, maxScore: 0 },  // ignored
      { name: "TE", score: 30, maxScore: 30 }, // 40
    ]);
    expect(ps).toBe(64);
  });

  it("computeExamSubWS returns null for a zero/absent max", () => {
    expect(computeExamSubWS(5, 0, 30)).toBeNull();
  });
});
