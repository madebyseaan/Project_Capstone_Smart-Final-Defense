import type { ClassRecord, ScoreItem } from "@/lib/api";
import { getDisplayFinalGrade, getQuarterGrade } from "@/lib/gradeMath";

type ScoreCategory = "WW" | "PT" | "QA";

export { getDisplayFinalGrade, getQuarterGrade };

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
