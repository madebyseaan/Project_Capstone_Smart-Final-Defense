import { describe, it, expect } from "vitest";
import { GradingMode } from "@prisma/client";
import {
  computeTermGrade,
  lookupTransmutedGrade,
  recommendedModeForSchoolYear,
  roundGrade,
} from "../lib/gradingMode";

const TABLE = [
  { minGrade: 0.0, maxGrade: 4.67, transmutedGrade: 60 },
  { minGrade: 56.01, maxGrade: 60.66, transmutedGrade: 72 },
  { minGrade: 60.67, maxGrade: 65.33, transmutedGrade: 73 },
  { minGrade: 65.34, maxGrade: 69.99, transmutedGrade: 74 },
  { minGrade: 70.0, maxGrade: 71.17, transmutedGrade: 75 },
  { minGrade: 74.72, maxGrade: 75.89, transmutedGrade: 79 },
  { minGrade: 80.62, maxGrade: 81.79, transmutedGrade: 84 },
  { minGrade: 99.5, maxGrade: 100.0, transmutedGrade: 100 },
];

describe("grading mode math", () => {
  it("rounds to two decimals", () => {
    expect(roundGrade(74.499)).toBe(74.5);
    expect(roundGrade(74.494)).toBe(74.49);
  });

  it("looks up transmuted grades at boundaries", () => {
    expect(lookupTransmutedGrade(TABLE, 70.0)).toBe(75);
    expect(lookupTransmutedGrade(TABLE, 71.17)).toBe(75);
    expect(lookupTransmutedGrade(TABLE, 71.18)).toBeNull();
    expect(lookupTransmutedGrade(TABLE, 81.0)).toBe(84);
    expect(lookupTransmutedGrade(TABLE, 100)).toBe(100);
  });

  it("uses the adjusted table in TRANSMUTED mode", () => {
    expect(computeTermGrade(70.0, GradingMode.TRANSMUTED, TABLE)).toBe(75);
    expect(computeTermGrade(81.0, GradingMode.TRANSMUTED, TABLE)).toBe(84);
    expect(computeTermGrade(74.9, GradingMode.TRANSMUTED, TABLE)).toBe(79);
  });

  it("reports the initial grade directly in ZERO_BASED mode", () => {
    expect(computeTermGrade(81.0, GradingMode.ZERO_BASED, TABLE)).toBe(81);
    expect(computeTermGrade(74.49, GradingMode.ZERO_BASED, TABLE)).toBe(74);
    expect(computeTermGrade(74.5, GradingMode.ZERO_BASED, TABLE)).toBe(75);
    expect(computeTermGrade(75.0, GradingMode.ZERO_BASED, TABLE)).toBe(75);
    expect(computeTermGrade(100, GradingMode.ZERO_BASED, TABLE)).toBe(100);
  });

  it("applies the 60 reportable floor in ZERO_BASED mode", () => {
    expect(computeTermGrade(59.0, GradingMode.ZERO_BASED, TABLE)).toBe(60);
    expect(computeTermGrade(0, GradingMode.ZERO_BASED, TABLE)).toBe(60);
  });

  it("recommends zero-based from SY 2027-2028 onward", () => {
    expect(recommendedModeForSchoolYear("2026-2027")).toBe(GradingMode.TRANSMUTED);
    expect(recommendedModeForSchoolYear("2027-2028")).toBe(GradingMode.ZERO_BASED);
    expect(recommendedModeForSchoolYear("2088-2089")).toBe(GradingMode.ZERO_BASED);
    expect(recommendedModeForSchoolYear("not-a-year")).toBe(GradingMode.TRANSMUTED);
  });
});
