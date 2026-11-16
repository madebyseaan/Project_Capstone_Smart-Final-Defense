import { describe, expect, it } from "vitest";
import { GradingMode } from "@prisma/client";
import { deriveGradeValues } from "../lib/gradeDerivation";

const weights = { ww: 20, pt: 50, qa: 30 };

describe("grade derivation — single source of truth", () => {
  it("treats the exam breakdown as authoritative over the stored composite QA", () => {
    const result = deriveGradeValues(
      {
        writtenWorkScores: [],
        perfTaskScores: [],
        examScores: [
          { name: "ST1", score: 10, maxScore: 10 },
          { name: "ST2", score: 10, maxScore: 10 },
          { name: "TE", score: 29, maxScore: 30 },
        ],
        quarterlyAssessScore: 95,
        quarterlyAssessMax: 100,
        storedWrittenWorkPS: 92.5,
        storedPerfTaskPS: 93.75,
        storedQuarterlyAssessPS: 95,
      },
      weights,
      GradingMode.ZERO_BASED,
      [],
    );

    expect(result.hasExamBreakdown).toBe(true);
    expect(result.examPS).toBeCloseTo(98.67, 2);
    expect(result.quarterlyAssessPS).toBeCloseTo(98.67, 2);
    expect(result.initialGrade).toBeCloseTo(94.976, 3);
    expect(result.quarterlyGrade).toBe(95);
    expect(result.nextQuarterlyAssessScore).toBeCloseTo(98.67, 2);
    expect(result.nextQuarterlyAssessMax).toBe(100);
  });

  it("leaves the composite QA untouched when there is no exam breakdown", () => {
    const result = deriveGradeValues(
      {
        writtenWorkScores: [],
        perfTaskScores: [],
        examScores: [],
        quarterlyAssessScore: 90,
        quarterlyAssessMax: 100,
        storedWrittenWorkPS: 80,
        storedPerfTaskPS: 80,
        storedQuarterlyAssessPS: 90,
      },
      weights,
      GradingMode.ZERO_BASED,
      [],
    );

    expect(result.hasExamBreakdown).toBe(false);
    expect(result.quarterlyAssessPS).toBe(90);
    expect(result.initialGrade).toBe(83);
    expect(result.quarterlyGrade).toBe(83);
    expect(result.nextQuarterlyAssessScore).toBe(90);
    expect(result.nextQuarterlyAssessMax).toBe(100);
  });

  it("uses the transmutation table in TRANSMUTED mode", () => {
    const result = deriveGradeValues(
      {
        writtenWorkScores: [],
        perfTaskScores: [],
        examScores: [],
        quarterlyAssessScore: 80,
        quarterlyAssessMax: 100,
        storedWrittenWorkPS: 80,
        storedPerfTaskPS: 80,
        storedQuarterlyAssessPS: 80,
      },
      weights,
      GradingMode.TRANSMUTED,
      [{ minGrade: 0, maxGrade: 100, transmutedGrade: 88 }],
    );
    expect(result.initialGrade).toBe(80);
    expect(result.quarterlyGrade).toBe(88);
  });

  it("returns nulls when a required PS cannot be derived", () => {
    const result = deriveGradeValues(
      {
        writtenWorkScores: [],
        perfTaskScores: [],
        examScores: [],
        quarterlyAssessScore: null,
        quarterlyAssessMax: 100,
        storedWrittenWorkPS: null,
        storedPerfTaskPS: null,
        storedQuarterlyAssessPS: null,
      },
      weights,
      GradingMode.ZERO_BASED,
      [],
    );
    expect(result.writtenWorkPS).toBeNull();
    expect(result.perfTaskPS).toBeNull();
    expect(result.quarterlyAssessPS).toBe(0);
    expect(result.initialGrade).toBeNull();
    expect(result.quarterlyGrade).toBeNull();
  });
});
