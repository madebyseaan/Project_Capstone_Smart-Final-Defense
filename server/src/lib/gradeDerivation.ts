/**
 * gradeDerivation.ts — single source of truth for derived grade fields.
 *
 * The class-record ledger recomputes the quarterly grade from the live scores
 * and gives the ST1/ST2/TE exam breakdown precedence over the stored composite
 * QA. Advisory/SF9/SF10 read the persisted Grade columns. This helper keeps
 * both worlds identical:
 *
 *   WW PS = stored PS ?? scores-derived PS
 *   PT PS = stored PS ?? scores-derived PS
 *   QA PS = exam breakdown PS ?? stored QA PS ?? composite QA
 *   initial = WW% · ww + PT% · pt + QA% · qa
 *   quarterly = computeTermGrade(initial, schoolYear mode, table)
 *
 * When an exam breakdown exists it becomes the canonical composite QA
 * (`quarterlyAssessScore = exam PS`, max 100), matching the teacher save path.
 */

import type { GradingMode } from "@prisma/client";
import { computeExamPS } from "./examMath";
import { computeTermGrade } from "./gradingMode";

export interface DerivationScoreItem {
  score?: number | null;
  maxScore?: number | null;
}

export interface DerivationInput {
  writtenWorkScores?: unknown;
  perfTaskScores?: unknown;
  examScores?: unknown;
  quarterlyAssessScore?: number | null;
  quarterlyAssessMax?: number | null;
  storedWrittenWorkPS?: number | null;
  storedPerfTaskPS?: number | null;
  storedQuarterlyAssessPS?: number | null;
}

export interface DerivationWeights {
  ww: number;
  pt: number;
  qa: number;
}

export interface DerivationResult {
  writtenWorkPS: number | null;
  perfTaskPS: number | null;
  examPS: number | null;
  quarterlyAssessPS: number | null;
  initialGrade: number | null;
  quarterlyGrade: number | null;
  hasExamBreakdown: boolean;
  nextQuarterlyAssessScore: number | null;
  nextQuarterlyAssessMax: number | null;
}

function asScores(value: unknown): DerivationScoreItem[] {
  return Array.isArray(value) ? (value as DerivationScoreItem[]) : [];
}

function sumScores(scores: DerivationScoreItem[]): number {
  return scores.reduce((sum, item) => sum + (Number(item?.score) || 0), 0);
}

function sumMax(scores: DerivationScoreItem[]): number {
  return scores.reduce((sum, item) => sum + (Number(item?.maxScore) || 0), 0);
}

function percent(raw: number, max: number): number | null {
  return max > 0 ? (raw / max) * 100 : null;
}

export function deriveGradeValues(
  input: DerivationInput,
  weights: DerivationWeights,
  mode: GradingMode,
  transmutationTable: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>,
): DerivationResult {
  const writtenWorkScores = asScores(input.writtenWorkScores);
  const perfTaskScores = asScores(input.perfTaskScores);
  const examScores = asScores(input.examScores);

  const writtenWorkPS = input.storedWrittenWorkPS ?? percent(sumScores(writtenWorkScores), sumMax(writtenWorkScores));
  const perfTaskPS = input.storedPerfTaskPS ?? percent(sumScores(perfTaskScores), sumMax(perfTaskScores));

  const examPS = examScores.length > 0 ? computeExamPS(examScores as Parameters<typeof computeExamPS>[0]) : null;
  const qaMax = Number(input.quarterlyAssessMax) || 100;
  const quarterlyAssessPS =
    examPS
    ?? input.storedQuarterlyAssessPS
    ?? (qaMax > 0 ? ((Number(input.quarterlyAssessScore) || 0) / qaMax) * 100 : null);

  let initialGrade: number | null = null;
  if (writtenWorkPS !== null && perfTaskPS !== null && quarterlyAssessPS !== null) {
    initialGrade =
      writtenWorkPS * (weights.ww / 100) +
      perfTaskPS * (weights.pt / 100) +
      quarterlyAssessPS * (weights.qa / 100);
  }

  const quarterlyGrade = initialGrade !== null ? computeTermGrade(initialGrade, mode, transmutationTable) : null;

  return {
    writtenWorkPS,
    perfTaskPS,
    examPS,
    quarterlyAssessPS,
    initialGrade,
    quarterlyGrade,
    hasExamBreakdown: examPS !== null,
    nextQuarterlyAssessScore: examPS !== null ? examPS : input.quarterlyAssessScore ?? null,
    nextQuarterlyAssessMax: examPS !== null ? 100 : input.quarterlyAssessMax ?? null,
  };
}
