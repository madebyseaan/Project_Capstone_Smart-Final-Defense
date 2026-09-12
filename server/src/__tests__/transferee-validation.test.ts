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
});
