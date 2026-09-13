/**
 * external-record-validation.test.ts — Pure helpers for registrar prior-school records.
 * See docs/REGISTRAR/SF10_SF9_IMPORT_PLAN.md.
 */
import { describe, it, expect } from "vitest";
import {
  isValidGradeScore,
  normalizeGradeScore,
  roundGradeScore,
  sanitizeTerms,
  computeFinalFromTerms,
  deriveRemarks,
  expectedPriorGradeLevels,
  PRIOR_PASSING_GRADE,
} from "../lib/externalRecordValidation";
import { externalRecordCreateSchema } from "../schemas/registrar";

describe("externalRecordValidation", () => {
  describe("isValidGradeScore", () => {
    it("accepts numbers within 0-100", () => {
      expect(isValidGradeScore(0)).toBe(true);
      expect(isValidGradeScore(75)).toBe(true);
      expect(isValidGradeScore(100)).toBe(true);
      expect(isValidGradeScore("88")).toBe(true);
    });

    it("rejects out-of-range or non-numeric values", () => {
      expect(isValidGradeScore(-1)).toBe(false);
      expect(isValidGradeScore(101)).toBe(false);
      expect(isValidGradeScore("abc")).toBe(false);
      expect(isValidGradeScore(null)).toBe(false);
      expect(isValidGradeScore(NaN)).toBe(false);
    });
  });

  describe("normalizeGradeScore", () => {
    it("returns a number in range and null otherwise", () => {
      expect(normalizeGradeScore("90")).toBe(90);
      expect(normalizeGradeScore(150)).toBeNull();
    });
  });

  describe("roundGradeScore", () => {
    it("rounds to the nearest whole number (SF10 has no decimals)", () => {
      expect(roundGradeScore(86.4)).toBe(86);
      expect(roundGradeScore(86.5)).toBe(87);
      expect(roundGradeScore("88.6")).toBe(89);
      expect(roundGradeScore(150)).toBeNull();
      expect(roundGradeScore(null)).toBeNull();
    });
  });

  describe("sanitizeTerms", () => {
    it("keeps valid entries and trims labels", () => {
      expect(sanitizeTerms([{ label: " Q1 ", value: 88 }, { label: "Q2", value: 92 }])).toEqual([
        { label: "Q1", value: 88 },
        { label: "Q2", value: 92 },
      ]);
    });

    it("drops invalid entries and non-arrays", () => {
      expect(sanitizeTerms([{ label: "", value: 88 }, { label: "Q2", value: 999 }, null])).toEqual([]);
      expect(sanitizeTerms("nope")).toEqual([]);
      expect(sanitizeTerms(undefined)).toEqual([]);
    });

    it("rounds decimals to whole numbers", () => {
      expect(sanitizeTerms([{ label: "Q1", value: 88.6 }])).toEqual([{ label: "Q1", value: 89 }]);
    });
  });

  describe("computeFinalFromTerms", () => {
    it("rounds the average of term values to a whole number", () => {
      expect(computeFinalFromTerms([{ label: "Q1", value: 88 }, { label: "Q2", value: 91 }])).toBe(90);
      expect(computeFinalFromTerms([{ label: "Q1", value: 90 }, { label: "Q2", value: 90 }])).toBe(90);
    });

    it("returns null when there are no usable terms", () => {
      expect(computeFinalFromTerms([])).toBeNull();
      expect(computeFinalFromTerms(null)).toBeNull();
    });
  });

  describe("deriveRemarks", () => {
    it("uses the passing grade threshold", () => {
      expect(deriveRemarks(PRIOR_PASSING_GRADE)).toBe("Passed");
      expect(deriveRemarks(PRIOR_PASSING_GRADE - 1)).toBe("Failed");
      expect(deriveRemarks(null)).toBeNull();
    });
  });

  describe("expectedPriorGradeLevels", () => {
    it("returns the completed years for each JHS grade", () => {
      expect(expectedPriorGradeLevels("GRADE_8")).toEqual(["GRADE_7"]);
      expect(expectedPriorGradeLevels("GRADE_9")).toEqual(["GRADE_7", "GRADE_8"]);
      expect(expectedPriorGradeLevels("GRADE_10")).toEqual(["GRADE_7", "GRADE_8", "GRADE_9"]);
    });

    it("returns empty for Grade 7 (elementary prior record out of scope)", () => {
      expect(expectedPriorGradeLevels("GRADE_7")).toEqual([]);
      expect(expectedPriorGradeLevels(null)).toEqual([]);
    });
  });

  describe("externalRecordCreateSchema (whole-number coercion)", () => {
    it("rounds decimal ratings/averages to integers", () => {
      const parsed = externalRecordCreateSchema.parse({
        params: { studentId: "s1" },
        body: {
          schoolYear: "2029-2030",
          gradeLevel: "GRADE_7",
          schoolName: "Previous School",
          generalAverage: 88.6,
          subjects: [
            {
              subjectName: "Mathematics",
              terms: [{ label: "T1", value: 88.6 }],
              finalRating: 88.5,
            },
          ],
        },
      });
      expect(parsed.body.generalAverage).toBe(89);
      expect(parsed.body.subjects[0].terms?.[0].value).toBe(89);
      expect(parsed.body.subjects[0].finalRating).toBe(89);
    });
  });
});
