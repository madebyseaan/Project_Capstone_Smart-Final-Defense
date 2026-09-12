/**
 * sf10-scan-parser.test.ts — Heuristic parser for scanned SF10/SF9 OCR text.
 */
import { describe, it, expect } from "vitest";
import {
  parseSf10Text,
  detectDocumentType,
  extractSchoolYear,
  extractGradeLevel,
  extractSchoolId,
  extractLabeledValue,
  parseGradeNumbers,
} from "../lib/sf10Scan/parser";
import { matchSubject } from "../lib/sf10Scan/subjects";

const SF10_TEXT = [
  "Learner Permanent Academic Record for Junior High School (SF10-JHS)",
  "Republic of the Philippines",
  "School Name: Montevista National High School",
  "School ID: 123456",
  "School Year: 2029-2030",
  "Classified as Grade: 8",
  "Section: Sampaguita",
  "LEARNING AREAS   Term Rating",
  "Filipino 84 85 86 85",
  "English 88 89 90 89",
  "Mathematics 80 81 82 81",
  "Science 84 85 84",
  "Araling Panlipunan 86 85 84",
  "Edukasyon sa Pagpapakatao 85 84 84",
  "Technology and Livelihood Education (TLE) 84 85 84",
  "MAPEH 84 85 84",
].join("\n");

describe("sf10Scan parser", () => {
  describe("detectDocumentType", () => {
    it("detects SF10 and SF9, else UNKNOWN", () => {
      expect(detectDocumentType("Learner Permanent Academic Record")).toBe("SF10");
      expect(detectDocumentType("Form 137")).toBe("SF10");
      expect(detectDocumentType("Learner's Progress Report Card (SF9)")).toBe("SF9");
      expect(detectDocumentType("random text")).toBe("UNKNOWN");
    });
  });

  describe("field extractors", () => {
    it("extracts the school year (en/em dash tolerated)", () => {
      expect(extractSchoolYear("S.Y. 2029-2030")).toBe("2029-2030");
      expect(extractSchoolYear("2029\u20132030")).toBe("2029-2030");
      expect(extractSchoolYear("no year here")).toBeNull();
    });

    it("extracts the grade level (7-10)", () => {
      expect(extractGradeLevel("Classified as Grade: 8")).toBe("GRADE_8");
      expect(extractGradeLevel("Grade 10")).toBe("GRADE_10");
      expect(extractGradeLevel("Grade 12")).toBeNull();
    });

    it("extracts the school id", () => {
      expect(extractSchoolId("School ID: 123456")).toBe("123456");
      expect(extractSchoolId("no id")).toBeNull();
    });

    it("reads a labeled value from the same or next line", () => {
      const lines = ["School Name:", "Montevista NHS", "Section: Sampaguita"];
      expect(extractLabeledValue(lines, /school\s*name/i)).toBe("Montevista NHS");
      expect(extractLabeledValue(lines, /section/i)).toBe("Sampaguita");
    });
  });

  describe("parseGradeNumbers", () => {
    it("keeps only plausible grade values (60-100)", () => {
      expect(parseGradeNumbers("Filipino 84 85 86 85")).toEqual([84, 85, 86, 85]);
      expect(parseGradeNumbers("Grade 8 55 101")).toEqual([]);
    });
  });

  describe("matchSubject", () => {
    it("matches learning-area names and variants", () => {
      expect(matchSubject("Mathematics 80 81 82")).toBe("Mathematics");
      expect(matchSubject("MAPEH")).toBe("MAPEH");
      expect(matchSubject("Physical Education")).toBe("MAPEH");
      expect(matchSubject("Environmental Science 87 85")).toBe("Environmental Science");
      expect(matchSubject("Term Rating")).toBeNull();
    });
  });

  describe("parseSf10Text", () => {
    const draft = parseSf10Text(SF10_TEXT);

    it("reads header fields", () => {
      expect(draft.documentType).toBe("SF10");
      expect(draft.schoolName).toBe("Montevista National High School");
      expect(draft.schoolId).toBe("123456");
      expect(draft.schoolYear).toBe("2029-2030");
      expect(draft.gradeLevel).toBe("GRADE_8");
      expect(draft.sectionName).toBe("Sampaguita");
    });

    it("extracts subject terms and computes nothing it can't read", () => {
      const filipino = draft.subjects.find((s) => s.subjectName === "Filipino")!;
      expect(filipino).toBeTruthy();
      expect(filipino.terms).toEqual([
        { label: "T1", value: 84 },
        { label: "T2", value: 85 },
        { label: "T3", value: 86 },
      ]);
      expect(filipino.finalRating).toBe(85);

      const science = draft.subjects.find((s) => s.subjectName === "Science")!;
      expect(science.terms).toHaveLength(3);
      expect(science.finalRating).toBeNull();
    });

    it("returns a confidence and no crash on empty input", () => {
      expect(draft.confidence).toBeGreaterThan(0);
      expect(draft.subjects.length).toBeGreaterThanOrEqual(8);

      const empty = parseSf10Text("");
      expect(empty.subjects).toEqual([]);
      expect(empty.confidence).toBe(0);
      expect(empty.warnings.length).toBeGreaterThan(0);
    });
  });
});
