import type { ClassRecord, ScoreItem } from "@/lib/api";

export type TransmutationRow = {
  minGrade: number;
  maxGrade: number;
  transmutedGrade: number;
};

// Adjusted Transmutation Table (DepEd Order No. 015, s. 2026) — SY 2026-2027.
// Rows are [minGrade, maxGrade, transmutedGrade], ascending.
export const DEPED_FALLBACK_TRANSMUTATION: [number, number, number][] = [
  [0.00, 4.67, 60], [4.68, 9.34, 61], [9.35, 14.00, 62], [14.01, 18.67, 63],
  [18.68, 23.34, 64], [23.35, 28.00, 65], [28.01, 32.67, 66], [32.68, 37.33, 67],
  [37.34, 42.00, 68], [42.01, 46.66, 69], [46.67, 51.33, 70], [51.34, 56.00, 71],
  [56.01, 60.66, 72], [60.67, 65.33, 73], [65.34, 69.99, 74], [70.00, 71.17, 75],
  [71.18, 72.35, 76], [72.36, 73.53, 77], [73.54, 74.71, 78], [74.72, 75.89, 79],
  [75.90, 77.07, 80], [77.08, 78.25, 81], [78.26, 79.43, 82], [79.44, 80.61, 83],
  [80.62, 81.79, 84], [81.80, 82.97, 85], [82.98, 84.15, 86], [84.16, 85.33, 87],
  [85.34, 86.51, 88], [86.52, 87.69, 89], [87.70, 88.87, 90], [88.88, 90.05, 91],
  [90.06, 91.23, 92], [91.24, 92.41, 93], [92.42, 93.59, 94], [93.60, 94.77, 95],
  [94.78, 95.95, 96], [95.96, 97.13, 97], [97.14, 98.31, 98], [98.32, 99.49, 99],
  [99.50, 100.00, 100],
];

export function transmuteGrade(initialGrade: number, table?: TransmutationRow[]): number {
  const roundedGrade = Math.round(initialGrade * 100) / 100;
  if (table && table.length > 0) {
    for (const entry of table) {
      if (roundedGrade >= entry.minGrade && roundedGrade <= entry.maxGrade) {
        return entry.transmutedGrade;
      }
    }
    return 60;
  }
  for (const [min, max, grade] of DEPED_FALLBACK_TRANSMUTATION) {
    if (roundedGrade >= min && roundedGrade <= max) return grade;
  }
  return 60;
}

export type GradeDescriptorInfo = {
  label: string;
  min: number;
  max: number;
  description: string;
};

// Qualitative descriptors (DepEd Order No. 015, s. 2026).
export const GRADE_DESCRIPTORS: GradeDescriptorInfo[] = [
  { label: "Advancing", min: 90, max: 100, description: "Consistently demonstrates understanding of concepts that meet or exceed standards with independence, flexibility, and depth." },
  { label: "Benchmarking", min: 85, max: 89, description: "Demonstrates expected grade-level skills and understanding with competency and independence." },
  { label: "Connecting", min: 80, max: 84, description: "Demonstrates sufficient understanding and application of grade-level standards with occasional guidance." },
  { label: "Developing", min: 75, max: 79, description: "Demonstrates partial understanding and application of skills; requires targeted support and scaffolding." },
  { label: "Emerging", min: 60, max: 74, description: "Does not yet demonstrate foundational skills and understanding; requires intensive support." },
];

export function getDescriptorInfo(grade: number | null): GradeDescriptorInfo | null {
  if (grade === null || grade === undefined) return null;
  return GRADE_DESCRIPTORS.find((d) => grade >= d.min && grade <= d.max) ?? null;
}

export function getDescriptor(grade: number | null): string {
  return getDescriptorInfo(grade)?.label ?? "-";
}

export function getGradeColor(grade: number | null): string {
  if (grade === null) return "text-slate-300";
  if (grade >= 90) return "text-emerald-600";
  if (grade >= 85) return "text-blue-600";
  if (grade >= 80) return "text-amber-600";
  if (grade >= 75) return "text-orange-600";
  return "text-rose-600";
}

export function totalScores(scores: ScoreItem[]): number {
  return scores.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
}

export function maxScores(scores: ScoreItem[]): number {
  return scores.reduce((sum, item) => sum + (Number(item.maxScore) || 0), 0);
}

export function percentageScore(rawTotal: number, rawMax: number): number {
  return rawMax > 0 ? (rawTotal / rawMax) * 100 : 0;
}

export function getQuarterGrade(record: ClassRecord, selectedTerm: string) {
  return record.grades.find((g) => g.term === selectedTerm);
}

// ─── Examinations (EXs) — official E-Class-Record ST1/ST2/TE breakdown ─────────
// Weights are fixed at 30/30/40; PS = Σ weighted sub-scores (0–100);
// WS = PS × (exam component weight / 100).

export const EXAM_SUB_TESTS = [
  { name: "ST1", weight: 30, defaultMax: 10 },
  { name: "ST2", weight: 30, defaultMax: 10 },
  { name: "TE", weight: 40, defaultMax: 30 },
] as const;

export function defaultExamScores(): ScoreItem[] {
  return EXAM_SUB_TESTS.map((s) => ({ name: s.name, score: 0, maxScore: s.defaultMax }));
}

export function hasExamScores(examScores: ScoreItem[] | null | undefined): boolean {
  return Array.isArray(examScores) && examScores.length > 0;
}

export function computeExamSubWS(score: number, max: number, weight: number): number | null {
  if (!max || max <= 0) return null;
  return Math.round(((Number(score) || 0) / max) * weight * 100) / 100;
}

export function computeExamPS(examScores: ScoreItem[] | null | undefined): number | null {
  if (!Array.isArray(examScores) || examScores.length === 0) return null;
  let hasMax = false;
  let ps = 0;
  EXAM_SUB_TESTS.forEach((sub, i) => {
    const item = examScores[i];
    const max = Number(item?.maxScore) || 0;
    if (max <= 0) return;
    hasMax = true;
    ps += Math.round(((Number(item?.score) || 0) / max) * sub.weight * 100) / 100;
  });
  return hasMax ? Math.round(ps * 100) / 100 : null;
}

export function getDisplayFinalGrade(
  record: ClassRecord,
  selectedTerm: string,
  weights: { ww: number; pt: number; qa: number },
  transmutationTable?: TransmutationRow[]
): number | null {
  const grade = getQuarterGrade(record, selectedTerm);
  if (!grade) return null;

  const wwScores = (grade.writtenWorkScores || []) as ScoreItem[];
  const ptScores = (grade.perfTaskScores || []) as ScoreItem[];

  const wwMax = maxScores(wwScores);
  const ptMax = maxScores(ptScores);
  const wwPS = grade.writtenWorkPS ?? (wwMax > 0 ? percentageScore(totalScores(wwScores), wwMax) : null);
  const ptPS = grade.perfTaskPS ?? (ptMax > 0 ? percentageScore(totalScores(ptScores), ptMax) : null);
  const examScores = (grade.examScores || []) as ScoreItem[];
  const examPSFromScores = hasExamScores(examScores) ? computeExamPS(examScores) : null;
  const qaScore = Number(grade.quarterlyAssessScore) || 0;
  const qaMax = Number(grade.quarterlyAssessMax) || 100;
  const qaPS = examPSFromScores ?? grade.quarterlyAssessPS ?? (qaMax > 0 ? percentageScore(qaScore, qaMax) : null);

  if (wwPS === null || ptPS === null || qaPS === null) return null;

  const initial = wwPS * (weights.ww / 100) + ptPS * (weights.pt / 100) + qaPS * (weights.qa / 100);

  return transmuteGrade(initial, transmutationTable);
}
