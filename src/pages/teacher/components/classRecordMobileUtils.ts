import type { ClassRecord, ScoreItem } from "@/lib/api";

type ScoreCategory = "WW" | "PT" | "QA";

function transmuteGrade(initialGrade: number): number {
  const transmutationTable: [number, number, number][] = [
    [100, 100, 100],
    [98.4, 99.99, 99],
    [96.8, 98.39, 98],
    [95.2, 96.79, 97],
    [93.6, 95.19, 96],
    [92, 93.59, 95],
    [90.4, 91.99, 94],
    [88.8, 90.39, 93],
    [87.2, 88.79, 92],
    [85.6, 87.19, 91],
    [84, 85.59, 90],
    [82.4, 83.99, 89],
    [80.8, 82.39, 88],
    [79.2, 80.79, 87],
    [77.6, 79.19, 86],
    [76, 77.59, 85],
    [74.4, 75.99, 84],
    [72.8, 74.39, 83],
    [71.2, 72.79, 82],
    [69.6, 71.19, 81],
    [68, 69.59, 80],
    [66.4, 67.99, 79],
    [64.8, 66.39, 78],
    [63.2, 64.79, 77],
    [61.6, 63.19, 76],
    [60, 61.59, 75],
    [56, 59.99, 74],
    [52, 55.99, 73],
    [48, 51.99, 72],
    [44, 47.99, 71],
    [40, 43.99, 70],
    [36, 39.99, 69],
    [32, 35.99, 68],
    [28, 31.99, 67],
    [24, 27.99, 66],
    [20, 23.99, 65],
    [16, 19.99, 64],
    [12, 15.99, 63],
    [8, 11.99, 62],
    [4, 7.99, 61],
    [0, 3.99, 60],
  ];

  for (const [min, max, grade] of transmutationTable) {
    if (initialGrade >= min && initialGrade <= max) {
      return grade;
    }
  }

  return Math.round(Math.max(60, Math.min(100, initialGrade)));
}

export function getQuarterGrade(record: ClassRecord, selectedTerm: string) {
  return record.grades.find((g) => g.term === selectedTerm);
}

export function getDisplayFinalGrade(
  record: ClassRecord,
  selectedTerm: string,
  weights: { ww: number; pt: number; qa: number }
): number | null {
  const grade = getQuarterGrade(record, selectedTerm);
  if (!grade) return null;
  if (grade.quarterlyGrade !== null && grade.quarterlyGrade !== undefined) return grade.quarterlyGrade;

  const wwScores = (grade.writtenWorkScores || []) as ScoreItem[];
  const ptScores = (grade.perfTaskScores || []) as ScoreItem[];

  const total = (scores: ScoreItem[]) => scores.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
  const max = (scores: ScoreItem[]) => scores.reduce((sum, item) => sum + (Number(item.maxScore) || 0), 0);
  const ps = (rawTotal: number, rawMax: number) => (rawMax > 0 ? (rawTotal / rawMax) * 100 : 0);

  const wwMax = max(wwScores);
  const ptMax = max(ptScores);
  const wwPS = grade.writtenWorkPS ?? (wwMax > 0 ? ps(total(wwScores), wwMax) : null);
  const ptPS = grade.perfTaskPS ?? (ptMax > 0 ? ps(total(ptScores), ptMax) : null);
  const qaScore = Number(grade.quarterlyAssessScore) || 0;
  const qaMax = Number(grade.quarterlyAssessMax) || 100;
  const qaPS = grade.quarterlyAssessPS ?? (qaMax > 0 ? ps(qaScore, qaMax) : null);

  if (wwPS === null || ptPS === null || qaPS === null) return null;

  const initial =
    grade.initialGrade ??
    wwPS * (weights.ww / 100) + ptPS * (weights.pt / 100) + qaPS * (weights.qa / 100);

  return transmuteGrade(initial);
}

export function getMobileDraftKey(studentId: string, category: ScoreCategory, index: number) {
  return `${studentId}:${category}:${index}`;
}

export function getScoreFromGrade(
  record: ClassRecord,
  selectedTerm: string,
  category: ScoreCategory,
  index: number
): string {
  const grade = getQuarterGrade(record, selectedTerm);
  if (!grade) return "";
  if (category === "WW") {
    const score = Number((grade.writtenWorkScores as ScoreItem[] | undefined)?.[index]?.score ?? 0);
    return score > 0 ? String(score) : "";
  }
  if (category === "PT") {
    const score = Number((grade.perfTaskScores as ScoreItem[] | undefined)?.[index]?.score ?? 0);
    return score > 0 ? String(score) : "";
  }
  const score = Number(grade.quarterlyAssessScore ?? 0);
  return score > 0 ? String(score) : "";
}
