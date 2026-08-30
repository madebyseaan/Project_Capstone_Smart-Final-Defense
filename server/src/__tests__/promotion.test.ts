/**
 * promotion.test.ts — Promotion rules + per-subject finals counting (pure unit tests)
 */

import { describe, it, expect } from "vitest";
import {
  finalizeSubjectRows,
  evaluatePromotion,
  mergeRotationSubjects,
  promotionStatusLabel,
  PASSING_GRADE,
  type SubjectTermInput,
} from "../lib/promotion";

function subj(overrides: Partial<SubjectTermInput> = {}): SubjectTermInput {
  return {
    subjectCode: "SCI",
    subjectName: "Science",
    T1: 80,
    T2: 80,
    T3: 80,
    ...overrides,
  };
}

describe("finalizeSubjectRows", () => {
  it("counts one subject (avg of T1–T3), never term grades as subjects", () => {
    const rows = finalizeSubjectRows([subj({ T1: 90, T2: 80, T3: 70 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].finalRating).toBe(80);
    expect(rows[0].status).toBe("GRADED");
  });

  it("marks failing subject when final rating < 75", () => {
    const rows = finalizeSubjectRows([subj({ T1: 70, T2: 70, T3: 70 })]);
    expect(rows[0].finalRating).toBe(70);
    expect(rows[0].remarks).toBe("Failed");
  });

  it("excludes non-promotional subjects", () => {
    const rows = finalizeSubjectRows([
      subj(),
      subj({ subjectCode: "HG1", subjectName: "Homeroom Guidance", isNonPromotional: true }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].subjectCode).toBe("SCI");
  });

  it("merges rotation sub-subjects into one subject", () => {
    const rows = finalizeSubjectRows([
      subj({ subjectCode: "SCI-BIO", subjectName: "Science-Biology", rotationTermGroupId: "SCIENCE", rotationTermRank: 1, T1: 90, T2: null, T3: null }),
      subj({ subjectCode: "SCI-CHEM", subjectName: "Science-Chemistry", rotationTermGroupId: "SCIENCE", rotationTermRank: 2, T1: null, T2: 80, T3: null }),
      subj({ subjectCode: "SCI-ES", subjectName: "Science-Earth Science", rotationTermGroupId: "SCIENCE", rotationTermRank: 3, T1: null, T2: null, T3: 70 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].finalRating).toBe(80);
    expect(rows[0].T1).toBe(90);
    expect(rows[0].T2).toBe(80);
    expect(rows[0].T3).toBe(70);
  });

  it("treats partial terms as PARTIAL and no grades as NG", () => {
    const rows = finalizeSubjectRows([
      subj({ T1: 80, T2: null, T3: null }),
      subj({ subjectCode: "MAJ", subjectName: "Major", T1: null, T2: null, T3: null }),
    ]);
    expect(rows.find((r) => r.subjectCode === "SCI")?.status).toBe("PARTIAL");
    expect(rows.find((r) => r.subjectCode === "MAJ")?.status).toBe("NG");
    expect(rows.find((r) => r.subjectCode === "MAJ")?.finalRating).toBeNull();
  });
});

describe("mergeRotationSubjects", () => {
  it("keeps standalone subjects untouched", () => {
    const merged = mergeRotationSubjects([subj()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].subjectCode).toBe("SCI");
  });
});

describe("evaluatePromotion", () => {
  const passing = (n: number, from = 80) =>
    Array.from({ length: n }, (_, i) => ({
      subjectCode: `S${i}`,
      subjectName: `Subject ${i}`,
      teacher: "",
      T1: from, T2: from, T3: from,
      finalRating: from,
      remarks: "Passed",
      status: "GRADED" as const,
    }));

  const failing = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      subjectCode: `F${i}`,
      subjectName: `Fail ${i}`,
      teacher: "",
      T1: 70, T2: 70, T3: 70,
      finalRating: 70,
      remarks: "Failed",
      status: "GRADED" as const,
    }));

  it("0 failing → PROMOTED with next grade", () => {
    const d = evaluatePromotion("GRADE_7", passing(5));
    expect(d.promotionStatus).toBe("PROMOTED");
    expect(d.promotedToGradeLevel).toBe("GRADE_8");
    expect(d.failingCount).toBe(0);
    expect(d.generalAverage).toBe(80);
  });

  it("1–2 failing → CONDITIONALLY_PROMOTED", () => {
    expect(evaluatePromotion("GRADE_8", [...passing(5), ...failing(1)]).promotionStatus).toBe("CONDITIONALLY_PROMOTED");
    const two = evaluatePromotion("GRADE_8", [...passing(5), ...failing(2)]);
    expect(two.promotionStatus).toBe("CONDITIONALLY_PROMOTED");
    expect(two.promotedToGradeLevel).toBe("GRADE_9");
  });

  it("≥3 failing → RETAINED at same grade", () => {
    const d = evaluatePromotion("GRADE_9", [...passing(5), ...failing(3)]);
    expect(d.promotionStatus).toBe("RETAINED");
    expect(d.promotedToGradeLevel).toBe("GRADE_9");
  });

  it("no grades → RETAINED", () => {
    const d = evaluatePromotion("GRADE_7", []);
    expect(d.promotionStatus).toBe("RETAINED");
    expect(d.promotedToGradeLevel).toBe("GRADE_7");
    expect(d.generalAverage).toBeNull();
  });

  it("Grade 10 with 0 failing → JHS_COMPLETER (no next grade)", () => {
    const d = evaluatePromotion("GRADE_10", passing(6));
    expect(d.promotionStatus).toBe("JHS_COMPLETER");
    expect(d.promotedToGradeLevel).toBeNull();
  });

  it("Grade 10 with 1–2 failing → JHS_COMPLETER (completer with conditions)", () => {
    const d = evaluatePromotion("GRADE_10", [...passing(6), ...failing(2)]);
    expect(d.promotionStatus).toBe("JHS_COMPLETER");
    expect(d.failingCount).toBe(2);
  });

  it("Grade 10 with ≥3 failing → RETAINED", () => {
    expect(evaluatePromotion("GRADE_10", [...passing(6), ...failing(3)]).promotionStatus).toBe("RETAINED");
  });

  it("never counts term grades as subjects: 3 failing TERMS of one subject = 1 failing subject", () => {
    const oneSubjectAllTermsFailing = finalizeSubjectRows([subj({ T1: 70, T2: 70, T3: 70 })]);
    const d = evaluatePromotion("GRADE_7", oneSubjectAllTermsFailing);
    expect(d.failingCount).toBe(1);
    expect(d.promotionStatus).toBe("CONDITIONALLY_PROMOTED");
    expect(PASSING_GRADE).toBe(75);
  });
});

describe("promotionStatusLabel", () => {
  it("maps enum values to wire-compatible labels", () => {
    expect(promotionStatusLabel("PROMOTED")).toBe("Promoted");
    expect(promotionStatusLabel("CONDITIONALLY_PROMOTED")).toBe("Conditionally Promoted");
    expect(promotionStatusLabel("RETAINED")).toBe("Retained");
    expect(promotionStatusLabel("JHS_COMPLETER")).toBe("JHS Completer");
    expect(promotionStatusLabel(null)).toBeNull();
  });
});
