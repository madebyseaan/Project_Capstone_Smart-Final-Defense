/**
 * seedTeacherScoresCore.ts — tier tables, score builders, and transmutation
 * helpers shared by seed-teacher-scores.ts. Extracted so the seed script stays
 * under the repo's 1000-line file cap.
 */

import { makeTransmuter } from "./canonicalGrade";

// ─── Tier Definitions ────────────────────────────────────────────────────────

export type Tier =
  | "HIGHEST_HONORS"
  | "HIGH_HONORS"
  | "HONORS"
  | "ABOVE_AVG"
  | "AVERAGE"
  | "BELOW_AVG"
  | "AT_RISK"
  | "REMEDIAL_FAIL_70"
  | "REMEDIAL_FAIL_71"
  | "STE_ELIGIBLE";

export const TIER_QG: Record<Tier, number[]> = {
  HIGHEST_HONORS: [98, 99, 98],
  HIGH_HONORS: [95, 96, 95],
  HONORS: [91, 90, 92],
  ABOVE_AVG: [93, 91, 92],
  AVERAGE: [84, 83, 85],
  BELOW_AVG: [77, 76, 78],
  // Retained students' failed subjects (final ~70, any failing grade is valid)
  AT_RISK: [70, 68, 72],
  // Remedial/conditionally-promoted failed subjects — DepEd DO 13: 1-2 failed
  // subjects. Final rating must land at exactly 70 or 71 so the RemedialTracker
  // shows originalGrade 70-71 and RFG = (70-71 + RCM)/2 reaches 75 with RCM >= 79-80.
  REMEDIAL_FAIL_70: [70, 70, 70],
  REMEDIAL_FAIL_71: [71, 71, 71],
  // STE learners must keep every subject at 85+ to stay eligible for the
  // program. Seeded exact (no jitter) so rounding can never undershoot 85.
  STE_ELIGIBLE: [85, 85, 85],
};

export const TIER_LABELS: Record<Tier, string> = {
  HIGHEST_HONORS: "With Highest Honors",
  HIGH_HONORS: "With High Honors",
  HONORS: "With Honors",
  ABOVE_AVG: "Above Average",
  AVERAGE: "Average",
  BELOW_AVG: "Below Average",
  AT_RISK: "At Risk",
  REMEDIAL_FAIL_70: "Remedial (Final 70)",
  REMEDIAL_FAIL_71: "Remedial (Final 71)",
  STE_ELIGIBLE: "STE Eligible (85)",
};

// Tiers an STE learner may receive: every T1-T3 target is >= 85, so an STE
// learner can never be seeded below the program's 85 retention threshold.
export const STE_ELIGIBLE_TIERS: Tier[] = [
  "STE_ELIGIBLE",
  "HONORS",
  "ABOVE_AVG",
  "HIGH_HONORS",
  "HIGHEST_HONORS",
];

// ─── Transmutation ───────────────────────────────────────────────────────────

let transmute: (initialGrade: number) => number = () => 0;
let transmutationRanges: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }> = [];

// Must be called once in main() with the DB table so seeded grades always
// match the admin-configured transmutation table.
export function initTransmutation(
  table: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>,
): void {
  transmute = makeTransmuter(table);
  transmutationRanges = table;
}

// Deterministic: returns the MIDPOINT of the first table range mapping to targetQG
// (midpoint keeps integer-score rounding noise safely inside the range).
function findInitialGradeForTarget(targetQG: number): number {
  const range = transmutationRanges.find((r) => r.transmutedGrade === targetQG);
  if (range) return (range.minGrade + range.maxGrade) / 2;
  // Fallback: binary search
  let low = 0;
  let high = 100;
  let best = 50;
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    if (transmute(mid) === targetQG) { best = mid; low = mid + 0.01; }
    else if (transmute(mid) < targetQG) low = mid + 0.01;
    else high = mid - 0.01;
  }
  if (transmute(best) === targetQG) return best;
  for (let ig = 0; ig <= 100; ig += 0.01) {
    if (transmute(ig) === targetQG) return ig;
  }
  return best;
}

// ─── Score Generation ────────────────────────────────────────────────────────

export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function genScores(
  count: number,
  max: number,
  targetPS: number,
  rand: () => number,
  exact = false,
): Array<{ name: string; score: number; maxScore: number }> {
  return Array.from({ length: count }, (_, i) => {
    // exact = no per-item jitter so the computed PS (and thus QG) lands exactly on target
    const jitter = exact ? 1 : 1 + (rand() - 0.5) * 0.08;
    const raw = max * (targetPS / 100) * jitter;
    const score = Math.round(Math.max(1, Math.min(max, raw)));
    return { name: `Item ${i + 1}`, score, maxScore: max };
  });
}

function calculateGrades(
  wwScores: Array<{ name: string; score: number; maxScore: number }>,
  ptScores: Array<{ name: string; score: number; maxScore: number }>,
  qaScore: number,
  qaMax: number,
  wwWeight: number,
  ptWeight: number,
  qaWeight: number,
) {
  const wwTotal = wwScores.reduce((s, i) => s + i.score, 0);
  const wwMax = wwScores.reduce((s, i) => s + i.maxScore, 0);
  const wwPS = wwMax > 0 ? (wwTotal / wwMax) * 100 : 0;

  const ptTotal = ptScores.reduce((s, i) => s + i.score, 0);
  const ptMax = ptScores.reduce((s, i) => s + i.maxScore, 0);
  const ptPS = ptMax > 0 ? (ptTotal / ptMax) * 100 : 0;

  const qaPS = qaMax > 0 ? (qaScore / qaMax) * 100 : 0;

  const ig = (wwPS * wwWeight) / 100 + (ptPS * ptWeight) / 100 + (qaPS * qaWeight) / 100;
  const qg = transmute(ig);

  return { writtenWorkPS: wwPS, perfTaskPS: ptPS, quarterlyAssessPS: qaPS, initialGrade: ig, quarterlyGrade: qg };
}

export function buildGradeForTarget(
  targetQG: number,
  weights: { ww: number; pt: number; qa: number },
  rand: () => number,
  exact = false,
) {
  const targetInitial = findInitialGradeForTarget(targetQG);
  // exact = no jitter: PS values sit at the range midpoint so integer-score
  // rounding can never push the quarterly grade off target (used for remedial
  // failed subjects that must land at exactly 70/71, and STE subjects that
  // must never fall below 85).
  const jitterOf = (r: number) => (exact ? 0 : (r - 0.5) * 3);
  const wwPS = Math.min(100, Math.max(0, targetInitial + jitterOf(rand())));
  const ptPS = Math.min(100, Math.max(0, targetInitial + jitterOf(rand())));
  const qaPS = Math.min(100, Math.max(0, targetInitial + jitterOf(rand())));

  const wwScores = genScores(4, 10, wwPS, rand, exact);
  const ptScores = genScores(4, 20, ptPS, rand, exact);
  const qaScore = Math.round(Math.max(0, Math.min(100, 100 * (qaPS / 100))));

  // Exam breakdown (ST1/ST2 max 10, TE max 30) scaled from the assessment score,
  // so the ledger's EXS columns are populated (they read Grade.examScores).
  const examScores = [
    { name: "ST1", score: Math.round((qaScore / 100) * 10), maxScore: 10 },
    { name: "ST2", score: Math.round((qaScore / 100) * 10), maxScore: 10 },
    { name: "TE", score: Math.round((qaScore / 100) * 30), maxScore: 30 },
  ];

  const computed = calculateGrades(wwScores, ptScores, qaScore, 100, weights.ww, weights.pt, weights.qa);
  return { writtenWorkScores: wwScores, perfTaskScores: ptScores, examScores, quarterlyAssessScore: qaScore, quarterlyAssessMax: 100, computed };
}

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface StudentInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

export interface SpecialStudent {
  studentId: string;
  failedSubjects: string[];
  type: "RETAINED" | "REMEDIAL";
}
