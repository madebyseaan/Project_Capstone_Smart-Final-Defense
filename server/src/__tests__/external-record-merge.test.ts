import { describe, it, expect } from "vitest";
import {
  termLabelToSlot,
  externalRecordToSchoolRecord,
  mergeExternalRecords,
  type MergeableRecord,
  type ExternalRecordLike,
} from "../lib/externalRecordMerge";

function localRecord(overrides: Partial<MergeableRecord> = {}): MergeableRecord {
  return {
    schoolYear: "2030-2031",
    gradeLevel: "GRADE_9",
    section: "Daisy",
    school: "SMART NHS",
    schoolId: "100001",
    adviserName: "Adviser A",
    subjectGrades: [
      { subjectCode: "MATH9", subjectName: "Mathematics", T1: null, T2: 85, T3: 88, final: 87 },
      { subjectCode: "ENG9", subjectName: "English", T1: null, T2: 90, T3: 91, final: 91 },
    ],
    generalAverage: 89,
    promotionStatus: "Promoted",
    remedialClasses: [],
    ...overrides,
  };
}

function external(overrides: Partial<ExternalRecordLike> = {}): ExternalRecordLike {
  return {
    schoolYear: "2029-2030",
    gradeLevel: "GRADE_8",
    schoolName: "Previous NHS",
    schoolId: "200002",
    sectionName: "Sampaguita",
    adviserName: "Adviser B",
    promotionStatus: "Promoted",
    isPartialYear: false,
    subjects: [
      { subjectCode: "MATH8", subjectName: "Mathematics", terms: [{ label: "T1", value: 80 }, { label: "T2", value: 82 }, { label: "T3", value: 84 }] },
      { subjectCode: "SCI8", subjectName: "Science", terms: [{ label: "T1", value: 88 }, { label: "T2", value: 89 }, { label: "T3", value: 90 }] },
    ],
    ...overrides,
  };
}

describe("externalRecordMerge", () => {
  describe("termLabelToSlot", () => {
    it("maps T/Q/ordinal labels to T1-T3", () => {
      expect(termLabelToSlot("T1")).toBe("T1");
      expect(termLabelToSlot("Q2")).toBe("T2");
      expect(termLabelToSlot("First Quarter")).toBe("T1");
      expect(termLabelToSlot("3rd")).toBe("T3");
      expect(termLabelToSlot("Term 2")).toBe("T2");
    });

    it("returns null for unknown labels", () => {
      expect(termLabelToSlot("Homeroom")).toBeNull();
      expect(termLabelToSlot("")).toBeNull();
    });
  });

  describe("externalRecordToSchoolRecord", () => {
    it("maps terms, computes final and general average", () => {
      const rec = externalRecordToSchoolRecord(external());
      expect(rec.external).toBe(true);
      expect(rec.school).toBe("Previous NHS");
      expect(rec.schoolId).toBe("200002");
      const math = rec.subjectGrades.find((s) => s.subjectCode === "MATH8")!;
      expect(math).toMatchObject({ T1: 80, T2: 82, T3: 84, final: 82 });
      // (82 + 89) / 2 = 85.5 -> 86
      expect(rec.generalAverage).toBe(86);
    });
  });

  describe("mergeExternalRecords", () => {
    it("appends a completed prior year and sorts by school year", () => {
      const merged = mergeExternalRecords([localRecord()], [external()]);
      expect(merged.map((r) => r.schoolYear)).toEqual(["2029-2030", "2030-2031"]);
      expect(merged[0].external).toBe(true);
      expect(merged[1].external).toBeUndefined();
    });

    it("keeps local records untouched when there is no external match", () => {
      const before = localRecord();
      const merged = mergeExternalRecords([before], [external()]);
      expect(merged.find((r) => r.schoolYear === "2030-2031")!.subjectGrades).toHaveLength(2);
    });

    it("term-fills a partial transfer-in year without overwriting local terms", () => {
      const partial = external({
        schoolYear: "2030-2031",
        gradeLevel: "GRADE_9",
        schoolName: "Previous NHS",
        isPartialYear: true,
        subjects: [
          { subjectCode: "MATH9", subjectName: "Mathematics", terms: [{ label: "T1", value: 78 }, { label: "T2", value: 99 }] },
          { subjectCode: "FIL9", subjectName: "Filipino", terms: [{ label: "T1", value: 90 }] },
        ],
      });
      const merged = mergeExternalRecords([localRecord()], [partial]);
      expect(merged).toHaveLength(1);
      const year = merged[0];
      const math = year.subjectGrades.find((s) => s.subjectCode === "MATH9")!;
      // T1 filled from previous school; T2 (local 85) NOT overwritten by 99.
      expect(math.T1).toBe(78);
      expect(math.T2).toBe(85);
      expect(math.T3).toBe(88);
      // Unmatched external subject appended.
      expect(year.subjectGrades.find((s) => s.subjectCode === "FIL9")).toBeTruthy();
      expect((year as any).mergedFromPreviousSchool).toBe("Previous NHS");
    });

    it("does not merge a non-partial same-year record into the local year", () => {
      const sameYear = external({ schoolYear: "2030-2031", gradeLevel: "GRADE_9", isPartialYear: false });
      const merged = mergeExternalRecords([localRecord()], [sameYear]);
      expect(merged).toHaveLength(2);
      expect(merged.filter((r) => r.external === true)).toHaveLength(1);
    });
  });
});
