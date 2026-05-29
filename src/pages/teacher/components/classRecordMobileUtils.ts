import type { ClassRecord, ScoreItem } from "@/lib/api";

type ScoreCategory = "WW" | "PT" | "QA";

function transmuteGrade(initialGrade: number): number {
  const roundedGrade = Math.round(initialGrade * 100) / 100;
  if (roundedGrade >= 99.5) return 100;

  const transmutationTable: [number, number, number][] = [
    [97.5, 99.49, 99],
    [96.0, 97.49, 98],
    [95.0, 95.99, 97],
    [94.0, 94.99, 96],
    [93.0, 93.99, 95],
    [92.0, 92.99, 94],
    [91.0, 91.99, 93],
    [90.0, 90.99, 92],
    [89.0, 89.99, 91],
    [88.0, 88.99, 90],
    [87.0, 87.99, 89],
    [86.0, 86.99, 88],
    [85.0, 85.99, 87],
    [84.0, 84.99, 86],
    [83.0, 83.99, 85],
    [82.0, 82.99, 84],
    [81.0, 81.99, 83],
    [80.0, 80.99, 82],
    [79.0, 79.99, 81],
    [78.0, 78.99, 80],
    [77.0, 77.99, 79],
    [76.0, 76.99, 78],
    [75.0, 75.99, 77],
    [73.0, 74.99, 76],
    [70.0, 72.99, 75],
    [68.0, 69.99, 74],
    [66.0, 67.99, 73],
    [64.0, 65.99, 72],
    [62.0, 63.99, 71],
    [60.0, 61.99, 70],
    [58.0, 59.99, 69],
    [56.0, 57.99, 68],
    [54.0, 55.99, 67],
    [52.0, 53.99, 66],
    [50.0, 51.99, 65],
    [48.0, 49.99, 64],
    [46.0, 47.99, 63],
    [43.0, 45.99, 62],
    [40.0, 42.99, 61],
    [25.0, 39.99, 60],
    [0.0,  24.99, 60],
  ];

  for (const [min, max, grade] of transmutationTable) {
    if (roundedGrade >= min && roundedGrade <= max) {
      return grade;
    }
  }

  return 60; // Minimum grade
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

  const initial = wwPS * (weights.ww / 100) + ptPS * (weights.pt / 100) + qaPS * (weights.qa / 100);

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
