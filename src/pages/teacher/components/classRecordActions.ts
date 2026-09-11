import { gradesApi, type ClassRecord, type ScoreItem } from "@/lib/api";
import type React from "react";
import { EXAM_SUB_TESTS, computeExamPS, defaultExamScores } from "@/lib/gradeMath";

type ScoreCategory = "WW" | "PT" | "QA" | "EX";

/** Normalize a grade's examScores to exactly 3 items (ST1/ST2/TE) with defaults. */
function ensureExamScores(existing: unknown): ScoreItem[] {
  const arr = Array.isArray(existing) ? (existing as ScoreItem[]) : [];
  return EXAM_SUB_TESTS.map((sub, i) => {
    const item = arr[i];
    return {
      name: (typeof item?.name === "string" && item.name) || sub.name,
      score: Number(item?.score) || 0,
      maxScore: Number(item?.maxScore) || sub.defaultMax,
    };
  });
}

export { ensureExamScores, defaultExamScores };

type ApplyMetaToScores = (
  scores: ScoreItem[],
  category: "WW" | "PT",
  minLength?: number,
  metaOverride?: Array<{ description: string; date: string }>,
) => ScoreItem[];

interface SaveMetaArgs {
  classAssignmentId: string;
  classRecord: ClassRecord[];
  selectedTerm: string;
  wwMeta: Array<{ description: string; date: string }>;
  ptMeta: Array<{ description: string; date: string }>;
  qaMeta: { description: string; date: string };
  wwCount: number;
  ptCount: number;
  applyMetaToScores: ApplyMetaToScores;
}

export async function saveMetaToAllStudents({
  classAssignmentId,
  classRecord,
  selectedTerm,
  wwMeta,
  ptMeta,
  qaMeta,
  wwCount,
  ptCount,
  applyMetaToScores,
}: SaveMetaArgs): Promise<{ ok: boolean; error?: string; skipped?: Array<{ studentId: string; reason: string }> }> {
  try {
    // Build updates array for batch endpoint
    const updates = classRecord.map((record) => {
      const grade = record.grades.find((g) => g.term === selectedTerm);
      const wwScores = applyMetaToScores([...(grade?.writtenWorkScores || []) as ScoreItem[]], 'WW', wwCount, wwMeta);
      const ptScores = applyMetaToScores([...(grade?.perfTaskScores || []) as ScoreItem[]], 'PT', ptCount, ptMeta);

      return {
        studentId: record.student.id,
        writtenWorkScores: wwScores,
        perfTaskScores: ptScores,
        qaDescription: qaMeta.description || undefined,
        qaDate: qaMeta.date || undefined,
      };
    });

    if (updates.length === 0) return { ok: true };

    // Try batch endpoint first; fall back to per-student if 404
    try {
      const res = await gradesApi.saveGradeBatch({
        classAssignmentId,
        term: selectedTerm,
        updates,
      });
      return { ok: true, skipped: res.data.skipped };
    } catch (batchErr: any) {
      if (batchErr?.response?.status === 404) {
        // Older backend — fall back to per-student saves
        const updatePromises = updates.map((u) =>
          gradesApi.saveGrade({
            classAssignmentId,
            term: selectedTerm,
            ...u,
          })
        );
        await Promise.all(updatePromises);
        return { ok: true };
      }
      throw batchErr;
    }
  } catch (err: unknown) {
    const message = (err as any)?.response?.data?.message || 'Failed to save assessment metadata';
    console.error('Failed to save meta to all students:', err);
    return { ok: false, error: message };
  }
}

interface ScoreUpdateArgs {
  classAssignmentId: string | undefined;
  classRecord: ClassRecord[];
  selectedTerm: string;
  studentId: string;
  category: ScoreCategory;
  index: number;
  newValue: number | "A" | "E";
  qaMeta: { description: string; date: string };
  getCellKey: (sid: string, cat: ScoreCategory, idx: number) => string;
  getMaxForCell: (cat: ScoreCategory, idx: number) => number;
  applyMetaToScores: ApplyMetaToScores;
  setClassRecord: React.Dispatch<React.SetStateAction<ClassRecord[]>>;
  setInvalidCells: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  fetchClassRecord: (silent?: boolean) => Promise<void>;
  isViewOnly?: boolean;
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
  setSuccess: React.Dispatch<React.SetStateAction<string | null>>;
  fetchClassRecord: (silent?: boolean) => Promise<void>;
  isViewOnly?: boolean;
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
  isViewOnly?: boolean;
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
  isViewOnly,
}: ScoreUpdateArgs) {
  if (isViewOnly) return false;
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

      const targetGrade =
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
      } else if (category === "EX") {
        const scores = ensureExamScores(targetGrade.examScores);
        scores[index] = { ...scores[index], score: isSpecial ? 0 : Number(newValue) || 0 };
        targetGrade.examScores = scores;
        targetGrade.quarterlyAssessScore = computeExamPS(scores) ?? 0;
        targetGrade.quarterlyAssessMax = 100;
      }

      // Null out server-derived fields so the table falls through to client-side calc
      targetGrade.writtenWorkPS = null;
      targetGrade.perfTaskPS = null;
      targetGrade.quarterlyAssessPS = null;
      targetGrade.initialGrade = null;
      targetGrade.quarterlyGrade = null;

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
    const examScores = ensureExamScores(grade?.examScores);
    if (category === "EX") {
      examScores[index] = { ...examScores[index], score: isSpecial ? 0 : Number(newValue) || 0 };
    }

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
      examScores: category === "EX" ? examScores : undefined,
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
  setSuccess,
  fetchClassRecord,
  isViewOnly,
}: HpsUpdateArgs) {
  if (isViewOnly) return false;
  if (!classAssignmentId || classRecord.length === 0) return;

  setClassRecord((prev) =>
    prev.map((record) => {
      const newRecord = { ...record, grades: [...record.grades] };
      const gradeIdx = newRecord.grades.findIndex((g) => g.term === selectedTerm);

      const targetGrade =
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
      } else if (category === "EX") {
        const scores = ensureExamScores(targetGrade.examScores);
        scores[index] = { ...scores[index], maxScore: newMax };
        targetGrade.examScores = scores;
        targetGrade.quarterlyAssessScore = computeExamPS(scores) ?? 0;
        targetGrade.quarterlyAssessMax = 100;
      }

      // Null out server-derived fields so the table falls through to client-side calc
      targetGrade.writtenWorkPS = null;
      targetGrade.perfTaskPS = null;
      targetGrade.quarterlyAssessPS = null;
      targetGrade.initialGrade = null;
      targetGrade.quarterlyGrade = null;

      if (gradeIdx > -1) newRecord.grades[gradeIdx] = targetGrade;
      else newRecord.grades.push(targetGrade);
      return newRecord;
    })
  );

  try {
    // Build updates for batch
    const updates = classRecord.map((record) => {
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

      const examScores = ensureExamScores(grade?.examScores);
      if (category === "EX") {
        examScores[index] = { ...examScores[index], maxScore: newMax };
      }

      const wwScoresWithMeta = applyMetaToScores(wwScores, "WW", index + 1);
      const ptScoresWithMeta = applyMetaToScores(ptScores, "PT", index + 1);

      return {
        studentId: record.student.id,
        writtenWorkScores: category === "WW" ? wwScoresWithMeta : undefined,
        perfTaskScores: category === "PT" ? ptScoresWithMeta : undefined,
        examScores: category === "EX" ? examScores : undefined,
        quarterlyAssessMax: category === "QA" ? newMax : undefined,
        qaDescription: qaMeta.description || undefined,
        qaDate: qaMeta.date || undefined,
      };
    });

    // Try batch; fall back to per-student on404
    try {
      const res = await gradesApi.saveGradeBatch({ classAssignmentId, term: selectedTerm, updates });
      const skipped = res.data.skipped;
      const msg = skipped && skipped.length > 0
        ? `Saved ${res.data.savedCount} — ${skipped.length} skipped`
        : "HPS updated";
      setSuccess(msg);
      await fetchClassRecord(true);
    } catch (batchErr: any) {
      if (batchErr?.response?.status === 404) {
        await Promise.all(updates.map((u) => gradesApi.saveGrade({ classAssignmentId, term: selectedTerm, ...u })));
        setSuccess("HPS updated");
        await fetchClassRecord(true);
      } else {
        throw batchErr;
      }
    }
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
  isViewOnly,
}: RemoveTaskArgs) {
  if (isViewOnly) return false;
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

      // Null out server-derived fields so the table falls through to client-side calc
      targetGrade.writtenWorkPS = null;
      targetGrade.perfTaskPS = null;
      targetGrade.quarterlyAssessPS = null;
      targetGrade.initialGrade = null;
      targetGrade.quarterlyGrade = null;

      newRecord.grades[gradeIdx] = targetGrade;
      return newRecord;
    })
  );

  try {
    // Build updates for batch
    const updates = classRecord.map((record) => {
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

      return {
        studentId: record.student.id,
        writtenWorkScores: category === "WW" ? wwScoresWithMeta : undefined,
        perfTaskScores: category === "PT" ? ptScoresWithMeta : undefined,
        qaDescription: qaMeta.description || undefined,
        qaDate: qaMeta.date || undefined,
      };
    });

    // Try batch; fall back to per-student on 404
    try {
      const res = await gradesApi.saveGradeBatch({ classAssignmentId, term: selectedTerm, updates });
      const skipped = res.data.skipped;
      const msg = skipped && skipped.length > 0
        ? `${category} activity removed — ${skipped.length} skipped`
        : `${category} activity removed`;
      setSuccess(msg);
      await fetchClassRecord(true);
    } catch (batchErr: any) {
      if (batchErr?.response?.status === 404) {
        await Promise.all(updates.map((u) => gradesApi.saveGrade({ classAssignmentId, term: selectedTerm, ...u })));
        setSuccess(`${category} activity removed`);
        await fetchClassRecord(true);
      } else {
        throw batchErr;
      }
    }
  } catch (err: any) {
    console.error(`Failed to remove ${category} task:`, err);
    await fetchClassRecord(true);
    setError(err?.response?.data?.message || `Failed to remove ${category} activity`);
  }
}
