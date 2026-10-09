/**
 * transferee-validation.test.ts — Pure validators for the EnrollPro transferee feed.
 * Contract: "SMART Transferee Enrollment Handoff" (verified 2026-09-11).
 */
import { describe, it, expect } from "vitest";
import {
  isValidLrn,
  normalizeLrn,
  isOfficiallyEnrolled,
  mapGradeLevelToEnum,
  sanitizeSf9EligibilityStatus,
  sanitizeConditionalSubjectCodes,
  sanitizeOptionalBoolean,
  sanitizeOptionalNumber,
  sanitizeOptionalText,
} from "../lib/transfereeValidation";

describe("transfereeValidation", () => {
  describe("isValidLrn", () => {
    it("accepts exactly 12 digits", () => {
      expect(isValidLrn("123456789012")).toBe(true);
    });

    it("trims surrounding whitespace", () => {
      expect(isValidLrn("  123456789012 ")).toBe(true);
      expect(normalizeLrn("  123456789012 ")).toBe("123456789012");
    });

    it("rejects wrong lengths", () => {
      expect(isValidLrn("12345678901")).toBe(false); // 11
      expect(isValidLrn("1234567890123")).toBe(false); // 13
    });

    it("rejects non-numeric or empty values", () => {
      expect(isValidLrn("12345678901a")).toBe(false);
      expect(isValidLrn("")).toBe(false);
      expect(isValidLrn(null)).toBe(false);
      expect(isValidLrn(undefined)).toBe(false);
    });
  });

  describe("isOfficiallyEnrolled", () => {
    it("accepts OFFICIALLY_ENROLLED (case-insensitive)", () => {
      expect(isOfficiallyEnrolled("OFFICIALLY_ENROLLED")).toBe(true);
      expect(isOfficiallyEnrolled("officially_enrolled")).toBe(true);
      expect(isOfficiallyEnrolled(" OFFICIALLY_ENROLLED ")).toBe(true);
    });

    it("rejects other / missing statuses", () => {
      expect(isOfficiallyEnrolled("ENROLLED")).toBe(false);
      expect(isOfficiallyEnrolled("READY_FOR_SECTIONING")).toBe(false);
      expect(isOfficiallyEnrolled("DROPPED")).toBe(false);
      expect(isOfficiallyEnrolled(null)).toBe(false);
    });
  });

  describe("mapGradeLevelToEnum", () => {
    it("maps the feed's { name, displayOrder } object", () => {
      expect(mapGradeLevelToEnum({ name: "Grade 8", displayOrder: 8 })).toBe("GRADE_8");
      expect(mapGradeLevelToEnum({ name: "Grade 10", displayOrder: 10 })).toBe("GRADE_10");
    });

    it("falls back to displayOrder when name is unknown", () => {
      expect(mapGradeLevelToEnum({ name: "SHS", displayOrder: 9 })).toBe("GRADE_9");
    });

    it("maps strings in several formats", () => {
      expect(mapGradeLevelToEnum("Grade 7")).toBe("GRADE_7");
      expect(mapGradeLevelToEnum("GRADE_10")).toBe("GRADE_10");
      expect(mapGradeLevelToEnum("grade9")).toBe("GRADE_9");
      expect(mapGradeLevelToEnum("10")).toBe("GRADE_10");
    });

    it("returns null outside Grade 7-10", () => {
      expect(mapGradeLevelToEnum("Grade 6")).toBeNull();
      expect(mapGradeLevelToEnum("Grade 11")).toBeNull();
      expect(mapGradeLevelToEnum("Kinder")).toBeNull();
      expect(mapGradeLevelToEnum(null)).toBeNull();
      expect(mapGradeLevelToEnum("")).toBeNull();
    });
  });

  describe("sanitizeSf9EligibilityStatus", () => {
    it("accepts the contract's three statuses (case-insensitive)", () => {
      expect(sanitizeSf9EligibilityStatus("PROMOTED")).toBe("PROMOTED");
      expect(sanitizeSf9EligibilityStatus("conditionally_promoted")).toBe("CONDITIONALLY_PROMOTED");
      expect(sanitizeSf9EligibilityStatus(" Retained ")).toBe("RETAINED");
    });

    it("rejects unknown / missing values", () => {
      expect(sanitizeSf9EligibilityStatus("JHS_COMPLETER")).toBeNull();
      expect(sanitizeSf9EligibilityStatus("")).toBeNull();
      expect(sanitizeSf9EligibilityStatus(null)).toBeNull();
      expect(sanitizeSf9EligibilityStatus(undefined)).toBeNull();
    });
  });

  describe("sanitizeConditionalSubjectCodes", () => {
    it("returns an empty array for no back subjects", () => {
      expect(sanitizeConditionalSubjectCodes([])).toEqual([]);
    });

    it("preserves order and trims codes", () => {
      expect(sanitizeConditionalSubjectCodes([" MATH ", "ENG"])).toEqual(["MATH", "ENG"]);
    });

    it("rejects malformed payloads and cardinality violations", () => {
      expect(sanitizeConditionalSubjectCodes(["MATH", "ENG", "SCI"])).toBeNull();
      expect(sanitizeConditionalSubjectCodes(["MATH", ""])).toBeNull();
      expect(sanitizeConditionalSubjectCodes("MATH")).toBeNull();
      expect(sanitizeConditionalSubjectCodes(null)).toBeNull();
      expect(sanitizeConditionalSubjectCodes(undefined)).toBeNull();
    });
  });

  describe("sanitizeOptionalBoolean", () => {
    it("passes through booleans", () => {
      expect(sanitizeOptionalBoolean(true)).toBe(true);
      expect(sanitizeOptionalBoolean(false)).toBe(false);
    });

    it("rejects non-boolean or missing values", () => {
      expect(sanitizeOptionalBoolean("true")).toBeNull();
      expect(sanitizeOptionalBoolean(1)).toBeNull();
      expect(sanitizeOptionalBoolean(null)).toBeNull();
    });
  });

  describe("sanitizeOptionalNumber", () => {
    it("passes through finite numbers", () => {
      expect(sanitizeOptionalNumber(84.5)).toBe(84.5);
      expect(sanitizeOptionalNumber(0)).toBe(0);
    });

    it("rejects numeric strings, NaN, Infinity, and null", () => {
      expect(sanitizeOptionalNumber("84.5")).toBeNull();
      expect(sanitizeOptionalNumber(NaN)).toBeNull();
      expect(sanitizeOptionalNumber(Infinity)).toBeNull();
      expect(sanitizeOptionalNumber(null)).toBeNull();
    });
  });

  describe("sanitizeOptionalText", () => {
    it("trims and returns non-empty strings", () => {
      expect(sanitizeOptionalText("  Rizal NHS ")).toBe("Rizal NHS");
    });

    it("returns null for blank, non-string, or missing values", () => {
      expect(sanitizeOptionalText("   ")).toBeNull();
      expect(sanitizeOptionalText(123)).toBeNull();
      expect(sanitizeOptionalText(null)).toBeNull();
    });
  });
});
