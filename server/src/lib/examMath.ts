/**
 * examMath.ts — Shared Examinations (EXs) math for the DepEd E-Class-Record.
 *
 * The official template splits the Examinations component into three fixed
 * sub-tests with fixed weights (30/30/40):
 *   WS ST1 = round(ST1 / ST1-max * 30, 2)
 *   WS ST2 = round(ST2 / ST2-max * 30, 2)
 *   WS TE  = round(TE  / TE-max  * 40, 2)
 *   PS     = WS ST1 + WS ST2 + WS TE          (0–100)
 *   WS     = round(PS * examWeight / 100, 2)  (examWeight = subject QA weight)
 */

export const EXAM_SUB_TESTS = [
  { name: "ST1", weight: 30, defaultMax: 10 },
  { name: "ST2", weight: 30, defaultMax: 10 },
  { name: "TE", weight: 40, defaultMax: 30 },
] as const;

export interface ExamScoreItem {
  name: string;
  score: number;
  maxScore: number;
}

export function defaultExamScores(): ExamScoreItem[] {
  return EXAM_SUB_TESTS.map((s) => ({ name: s.name, score: 0, maxScore: s.defaultMax }));
}

/**
 * Composite Examinations Percentage Score (0–100) = sum of weighted sub-scores.
 * Returns null when there are no usable exam maxes.
 */
export function computeExamPS(examScores: ExamScoreItem[] | null | undefined): number | null {
  if (!Array.isArray(examScores) || examScores.length === 0) return null;
  let hasMax = false;
  let ps = 0;
  EXAM_SUB_TESTS.forEach((sub, i) => {
    const item = examScores[i];
    const max = Number(item?.maxScore) || 0;
    if (max <= 0) return;
    hasMax = true;
    const score = Number(item?.score) || 0;
    ps += Math.round((score / max) * sub.weight * 100) / 100;
  });
  return hasMax ? Math.round(ps * 100) / 100 : null;
}

/** Weighted score for a single sub-test. */
export function computeExamSubWS(score: number, max: number, weight: number): number | null {
  if (!max || max <= 0) return null;
  return Math.round(((Number(score) || 0) / max) * weight * 100) / 100;
}
