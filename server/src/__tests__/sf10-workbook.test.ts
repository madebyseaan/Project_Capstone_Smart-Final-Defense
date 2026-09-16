import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSf10Workbook, workbookToText } from "../lib/sf10Scan/xlsx";

function makeWorkbook(): Buffer {
  const aoa = [
    ["Learner Permanent Academic Record for Junior High School"],
    ["School Name:", "Montevista National High School"],
    ["School ID:", "123456"],
    ["School Year:", "2029-2030"],
    ["Classified as Grade:", "8"],
    ["Section:", "Sampaguita"],
    ["LEARNING AREAS", "Term Rating"],
    ["Filipino", 84, 85, 86, 85],
    ["English", 88, 89, 90, 89],
    ["Mathematics", 80, 81, 82, 81],
    ["Science", 84, 85, 84],
    ["MAPEH", 84, 85, 84],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "SF10");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("sf10Scan xlsx", () => {
  it("converts a workbook into text lines", () => {
    const text = workbookToText(makeWorkbook());
    expect(text).toContain("Filipino 84 85 86 85");
    expect(text).toContain("School Name: Montevista National High School");
  });

  it("parses header fields and subjects from a workbook", () => {
    const { drafts } = parseSf10Workbook(makeWorkbook());
    const draft = drafts[0];
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(draft.schoolName).toBe("Montevista National High School");
    expect(draft.schoolId).toBe("123456");
    expect(draft.schoolYear).toBe("2029-2030");
    expect(draft.gradeLevel).toBe("GRADE_8");
    const filipino = draft.subjects.find((s) => s.subjectName === "Filipino")!;
    expect(filipino).toBeTruthy();
    expect(filipino.terms).toEqual([
      { label: "T1", value: 84 },
      { label: "T2", value: 85 },
      { label: "T3", value: 86 },
    ]);
    expect(filipino.finalRating).toBe(85);
    expect(draft.subjects.length).toBeGreaterThanOrEqual(5);
  });
});
