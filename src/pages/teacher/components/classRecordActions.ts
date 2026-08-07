import { gradesApi, type ClassRecord, type ScoreItem } from "@/lib/api";
import type React from "react";

type ScoreCategory = "WW" | "PT" | "QA";

type ApplyMetaToScores = (
  scores: ScoreItem[],
  category: "WW" | "PT",
  minLength?: number,
  metaOverride?: Array<{ description: string; date: string }>,
) => ScoreItem[];

interface ScoreUpdateArgs {
  classAssignmentId: string | undefined;
  classRecord: ClassRecord[];
  selectedTerm: string;
  studentId: string;
  category: ScoreCategory;
  index: number;
  newValue: number;
  qaMeta: { description: string; date: string };
  getCellKey: (sid: string, cat: ScoreCategory, idx: number) => string;
  getMaxForCell: (cat: ScoreCategory, idx: number) => number;
  applyMetaToScores: ApplyMetaToScores;
  setClassRecord: React.Dispatch<React.SetStateAction<ClassRecord[]>>;
  setInvalidCells: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  fetchClassRecord: (silent?: boolean) => Promise<void>;
}

interface HpsUpdateArgs {
  classAssignmentId: string | undefined;
  classRecord: ClassRecord[];
  selectedTerm: string;
  category: ScoreCategory;
  index: number;
  newMax: number;
  qaMeta: { description: string; date: string };
  applyMetaToScores: ApplyMetaToScores;
  setClassRecord: React.Dispatch<React.SetStateAction<ClassRecord[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  fetchClassRecord: (silent?: boolean) => Promise<void>;
}

interface RemoveTaskArgs {
  classAssignmentId: string | undefined;
  classRecord: ClassRecord[];
  selectedTerm: string;
  category: "WW" | "PT";
  wwCount: number;
  ptCount: number;
  qaMeta: { description: string; date: string };
  applyMetaToScores: ApplyMetaToScores;
  setClassRecord: React.Dispatch<React.SetStateAction<ClassRecord[]>>;
  setWwMeta: React.Dispatch<React.SetStateAction<Array<{ description: string; date: string }>>>;
  setPtMeta: React.Dispatch<React.SetStateAction<Array<{ description: string; date: string }>>>;
  setSuccess: React.Dispatch<React.SetStateAction<string | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  fetchClassRecord: (silent?: boolean) => Promise<void>;
}

export async function executeScoreUpdate({
  classAssignmentId,
  classRecord,
  selectedTerm,
  studentId,
  category,
  index,
  newValue,
  qaMeta,
  getCellKey,
  getMaxForCell,
  applyMetaToScores,
  setClassRecord,
  setInvalidCells,
  setError,
  fetchClassRecord,
}: ScoreUpdateArgs) {
  if (!classAssignmentId) return;

  const key = getCellKey(studentId, category, index);
  const maxAllowed = getMaxForCell(category, index);
  const isSpecial = typeof newValue === "string" && (newValue.toUpperCase() === "A" || newValue.toUpperCase() === "E");

  if (!isSpecial) {
    const numValue = Number(newValue);
    if (numValue < 0) {
      setInvalidCells((prev) => ({ ...prev, [key]: "Score cannot be negative." }));
      setError("Score cannot be negative.");
      return;
    }
    if (numValue > maxAllowed) {
      setInvalidCells((prev) => ({ ...prev, [key]: `Score cannot exceed ${maxAllowed}.` }));
      setError(`${category} ${category === "QA" ? "" : index + 1} score cannot exceed MAX (${maxAllowed}).`.trim());
      return;
    }
  }

  setInvalidCells((prev) => {
    if (!prev[key]) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  });

  setClassRecord((prev) =>
    prev.map((record) => {
      if (record.student.id !== studentId) return record;

      const newRecord = { ...record, grades: [...record.grades] };
      const gradeIdx = newRecord.grades.findIndex((g) => g.term === selectedTerm);

      let targetGrade =
        gradeIdx > -1
          ? { ...newRecord.grades[gradeIdx] }
          : ({
              studentId,
              classAssignmentId,
              term: selectedTerm,
              writtenWorkScores: [],
              perfTaskScores: [],
              quarterlyAssessScore: 0,
              quarterlyAssessMax: 100,
            } as any);

      if (category === "WW") {
        const scores = [...((targetGrade.writtenWorkScores as any[]) || [])];
        while (scores.length <= index) scores.push({ name: `WW ${scores.length + 1}`, score: 0, maxScore: 10 });
        if (isSpecial) {
          scores[index] = { ...scores[index], score: 0, status: (newValue as string).toUpperCase() };
        } else {
          scores[index] = { ...scores[index], score: Number(newValue) || 0, status: undefined };
        }
        targetGrade.writtenWorkScores = applyMetaToScores(scores as ScoreItem[], "WW", index + 1);
      } else if (category === "PT") {
        const scores = [...((targetGrade.perfTaskScores as any[]) || [])];
        while (scores.length <= index) scores.push({ name: `PT ${scores.length + 1}`, score: 0, maxScore: 10 });
        if (isSpecial) {
          scores[index] = { ...scores[index], score: 0, status: (newValue as string).toUpperCase() };
        } else {
          scores[index] = { ...scores[index], score: Number(newValue) || 0, status: undefined };
        }
        targetGrade.perfTaskScores = applyMetaToScores(scores as ScoreItem[], "PT", index + 1);
      } else if (category === "QA") {
        targetGrade.quarterlyAssessScore = isSpecial ? 0 : Number(newValue) || 0;
        targetGrade.qaDescription = qaMeta.description || null;
        targetGrade.qaDate = qaMeta.date || null;
      }

      if (gradeIdx > -1) newRecord.grades[gradeIdx] = targetGrade;
      else newRecord.grades.push(targetGrade);

      return newRecord;
    })
  );

  try {
    const record = classRecord.find((r) => r.student.id === studentId);
    const grade = record?.grades.find((g) => g.term === selectedTerm);

    const wwScores = [...((grade?.writtenWorkScores || []) as ScoreItem[])];
    const ptScores = [...((grade?.perfTaskScores || []) as ScoreItem[])];

    if (category === "WW") {
      while (wwScores.length <= index) wwScores.push({ name: `WW ${wwScores.length + 1}`, score: 0, maxScore: 10 });
      if (isSpecial) {
        wwScores[index] = { ...wwScores[index], score: 0, status: (newValue as string).toUpperCase() } as any;
      } else {
        wwScores[index] = { ...wwScores[index], score: Number(newValue) || 0, status: undefined } as any;
      }
    } else if (category === "PT") {
      while (ptScores.length <= index) ptScores.push({ name: `PT ${ptScores.length + 1}`, score: 0, maxScore: 10 });
      if (isSpecial) {
        ptScores[index] = { ...ptScores[index], score: 0, status: (newValue as string).toUpperCase() } as any;
      } else {
        ptScores[index] = { ...ptScores[index], score: Number(newValue) || 0, status: undefined } as any;
      }
    }

    const wwScoresWithMeta = applyMetaToScores(wwScores, "WW", index + 1);
    const ptScoresWithMeta = applyMetaToScores(ptScores, "PT", index + 1);

    await gradesApi.saveGrade({
      studentId,
      classAssignmentId,
      term: selectedTerm,
      writtenWorkScores: category === "WW" ? wwScoresWithMeta : undefined,
      perfTaskScores: category === "PT" ? ptScoresWithMeta : undefined,
      quarterlyAssessScore: category === "QA" ? (isSpecial ? 0 : Number(newValue) || 0) : undefined,
      qaDescription: qaMeta.description || undefined,
      qaDate: qaMeta.date || undefined,
    });

    await fetchClassRecord(true);
  } catch (err: any) {
    console.error("Failed to update score:", err);
    setError(err?.response?.data?.message || "Failed to save grade. Please retry.");
    await fetchClassRecord(true);
  }
}

export async function executeHpsUpdate({
  classAssignmentId,
  classRecord,
  selectedTerm,
  category,
  index,
  newMax,
  qaMeta,
  applyMetaToScores,
  setClassRecord,
  setError,
  fetchClassRecord,
}: HpsUpdateArgs) {
  if (!classAssignmentId || classRecord.length === 0) return;

  setClassRecord((prev) =>
    prev.map((record) => {
      const newRecord = { ...record, grades: [...record.grades] };
      const gradeIdx = newRecord.grades.findIndex((g) => g.term === selectedTerm);

      let targetGrade =
        gradeIdx > -1
          ? { ...newRecord.grades[gradeIdx] }
          : ({
              studentId: record.student.id,
              classAssignmentId,
              term: selectedTerm,
              writtenWorkScores: [],
              perfTaskScores: [],
              quarterlyAssessScore: 0,
              quarterlyAssessMax: 100,
            } as any);

      if (category === "WW") {
        const scores = [...((targetGrade.writtenWorkScores as any[]) || [])];
        while (scores.length <= index) scores.push({ name: `WW ${scores.length + 1}`, score: 0, maxScore: newMax });
        scores[index] = { ...scores[index], maxScore: newMax };
        targetGrade.writtenWorkScores = applyMetaToScores(scores as ScoreItem[], "WW", index + 1);
      } else if (category === "PT") {
        const scores = [...((targetGrade.perfTaskScores as any[]) || [])];
        while (scores.length <= index) scores.push({ name: `PT ${scores.length + 1}`, score: 0, maxScore: newMax });
        scores[index] = { ...scores[index], maxScore: newMax };
        targetGrade.perfTaskScores = applyMetaToScores(scores as ScoreItem[], "PT", index + 1);
      } else if (category === "QA") {
        targetGrade.quarterlyAssessMax = newMax;
        targetGrade.qaDescription = qaMeta.description || null;
        targetGrade.qaDate = qaMeta.date || null;
      }

      if (gradeIdx > -1) newRecord.grades[gradeIdx] = targetGrade;
      else newRecord.grades.push(targetGrade);
      return newRecord;
    })
  );

  try {
    const updatePromises = classRecord.map((record) => {
      const grade = record.grades.find((g) => g.term === selectedTerm);
      const wwScores = [...((grade?.writtenWorkScores || []) as ScoreItem[])];
      const ptScores = [...((grade?.perfTaskScores || []) as ScoreItem[])];

      if (category === "WW") {
        while (wwScores.length <= index) wwScores.push({ name: `WW ${wwScores.length + 1}`, score: 0, maxScore: newMax });
        wwScores[index].maxScore = newMax;
      } else if (category === "PT") {
        while (ptScores.length <= index) ptScores.push({ name: `PT ${ptScores.length + 1}`, score: 0, maxScore: newMax });
        ptScores[index].maxScore = newMax;
      }

      const wwScoresWithMeta = applyMetaToScores(wwScores, "WW", index + 1);
      const ptScoresWithMeta = applyMetaToScores(ptScores, "PT", index + 1);

      return gradesApi.saveGrade({
        studentId: record.student.id,
        classAssignmentId,
        term: selectedTerm,
        writtenWorkScores: category === "WW" ? wwScoresWithMeta : undefined,
        perfTaskScores: category === "PT" ? ptScoresWithMeta : undefined,
        quarterlyAssessMax: category === "QA" ? newMax : undefined,
        qaDescription: qaMeta.description || undefined,
        qaDate: qaMeta.date || undefined,
      });
    });

    await Promise.all(updatePromises);
    await fetchClassRecord(true);
  } catch (err: any) {
    console.error("Failed to update HPS:", err);
    setError(err?.response?.data?.message || "Failed to save HPS changes.");
    await fetchClassRecord(true);
  }
}

export async function executeRemoveTask({
  classAssignmentId,
  classRecord,
  selectedTerm,
  category,
  wwCount,
  ptCount,
  qaMeta,
  applyMetaToScores,
  setClassRecord,
  setWwMeta,
  setPtMeta,
  setSuccess,
  setError,
  fetchClassRecord,
}: RemoveTaskArgs) {
  if (!classAssignmentId || classRecord.length === 0) return;

  const currentCount = category === "WW" ? wwCount : ptCount;
  if (currentCount <= 1) return;

  if (category === "WW") {
    setWwMeta((prev) => prev.slice(0, Math.max(0, prev.length - 1)));
  } else {
    setPtMeta((prev) => prev.slice(0, Math.max(0, prev.length - 1)));
  }

  setClassRecord((prev) =>
    prev.map((record) => {
      const newRecord = { ...record, grades: [...record.grades] };
      const gradeIdx = newRecord.grades.findIndex((g) => g.term === selectedTerm);
      if (gradeIdx === -1) return newRecord;

      const targetGrade = { ...newRecord.grades[gradeIdx] } as any;
      if (category === "WW") {
        const scores = [...((targetGrade.writtenWorkScores || []) as ScoreItem[])];
        targetGrade.writtenWorkScores = scores.slice(0, Math.max(0, scores.length - 1));
      } else {
        const scores = [...((targetGrade.perfTaskScores || []) as ScoreItem[])];
        targetGrade.perfTaskScores = scores.slice(0, Math.max(0, scores.length - 1));
      }

      newRecord.grades[gradeIdx] = targetGrade;
      return newRecord;
    })
  );

  try {
    const updatePromises = classRecord.map((record) => {
      const grade = record.grades.find((g) => g.term === selectedTerm);
      const wwScores = [...((grade?.writtenWorkScores || []) as ScoreItem[])];
      const ptScores = [...((grade?.perfTaskScores || []) as ScoreItem[])];

      if (category === "WW") {
        wwScores.splice(Math.max(0, wwScores.length - 1), 1);
      } else {
        ptScores.splice(Math.max(0, ptScores.length - 1), 1);
      }

      const wwScoresWithMeta = applyMetaToScores(wwScores, "WW");
      const ptScoresWithMeta = applyMetaToScores(ptScores, "PT");

      return gradesApi.saveGrade({
        studentId: record.student.id,
        classAssignmentId,
        term: selectedTerm,
        writtenWorkScores: category === "WW" ? wwScoresWithMeta : undefined,
        perfTaskScores: category === "PT" ? ptScoresWithMeta : undefined,
        qaDescription: qaMeta.description || undefined,
        qaDate: qaMeta.date || undefined,
      });
    });

    await Promise.all(updatePromises);
    await fetchClassRecord(true);
    setSuccess(`${category} activity removed`);
  } catch (err: any) {
    console.error(`Failed to remove ${category} task:`, err);
    await fetchClassRecord(true);
    setError(err?.response?.data?.message || `Failed to remove ${category} activity`);
  }
}
