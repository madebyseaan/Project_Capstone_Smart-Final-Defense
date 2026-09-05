import { useState, useMemo, useCallback, useEffect } from "react";
import type { ClassRecord, ScoreItem } from "@/lib/api";
import { saveMetaToAllStudents } from "../components/classRecordActions";

interface AssessmentTaskMeta {
  description: string;
  date: string;
}

export function useAssessmentMeta(opts: {
  classRecord: ClassRecord[];
  selectedTerm: string;
  classAssignmentId?: string;
  setSuccess: (msg: string) => void;
  setError: (msg: string) => void;
  fetchClassRecord: () => Promise<void>;
  isViewOnly: boolean;
}) {
  const { classRecord, selectedTerm, classAssignmentId, setSuccess, setError, fetchClassRecord, isViewOnly } = opts;

  const [wwMeta, setWwMeta] = useState<AssessmentTaskMeta[]>([]);
  const [ptMeta, setPtMeta] = useState<AssessmentTaskMeta[]>([]);
  const [qaMeta, setQaMeta] = useState<{ description: string; date: string }>({ description: "", date: "" });
  const [selectedColumn, setSelectedColumn] = useState<{ type: "WW" | "PT" | "QA"; number: number } | null>(null);
  const [metaEditorDraft, setMetaEditorDraft] = useState<{ description: string; date: string }>({ description: "", date: "" });
  const [savingMeta, setSavingMeta] = useState(false);

  const applyMetaToScores = useCallback((scores: ScoreItem[], category: "WW" | "PT", minLength = 0, metaOverride?: AssessmentTaskMeta[]): ScoreItem[] => {
    const meta = metaOverride || (category === "WW" ? wwMeta : ptMeta);
    const targetLength = Math.max(scores.length, minLength);
    return Array.from({ length: targetLength }, (_, i) => {
      const existing = scores[i] || ({ score: 0, maxScore: 10 } as ScoreItem);
      return { ...existing, name: meta[i]?.description?.trim() || `${category} ${i + 1}`, description: meta[i]?.description?.trim() || `${category} ${i + 1}`, date: meta[i]?.date || undefined, maxScore: Number(existing.maxScore ?? 10), score: Number(existing.score ?? 0) };
    });
  }, [wwMeta, ptMeta]);

  const wwCount = useMemo(() => {
    let max = 1;
    classRecord.forEach((r) => {
      const grade = r.grades.find((g) => g.term === selectedTerm);
      if (grade?.writtenWorkScores) max = Math.max(max, (grade.writtenWorkScores as any[]).length);
    });
    return max;
  }, [classRecord, selectedTerm]);

  const ptCount = useMemo(() => {
    let max = 1;
    classRecord.forEach((r) => {
      const grade = r.grades.find((g) => g.term === selectedTerm);
      if (grade?.perfTaskScores) max = Math.max(max, (grade.perfTaskScores as any[]).length);
    });
    return max;
  }, [classRecord, selectedTerm]);

  // Derive meta from query data
  useEffect(() => {
    const gradeSamples = classRecord
      .map((r) => r.grades.find((g) => g.term === selectedTerm))
      .filter(Boolean) as Array<any>;

    const wwSample = gradeSamples.find((g) => Array.isArray(g.writtenWorkScores) && g.writtenWorkScores.length > 0);
    const ptSample = gradeSamples.find((g) => Array.isArray(g.perfTaskScores) && g.perfTaskScores.length > 0);
    const wwSource = (wwSample?.writtenWorkScores || []) as ScoreItem[];
    const ptSource = (ptSample?.perfTaskScores || []) as ScoreItem[];

    setWwMeta((prev) =>
      Array.from({ length: wwCount }, (_, i) => ({
        description: wwSource[i]?.description || wwSource[i]?.name || prev[i]?.description || `WW ${i + 1}`,
        date: wwSource[i]?.date || prev[i]?.date || "",
      }))
    );
    setPtMeta((prev) =>
      Array.from({ length: ptCount }, (_, i) => ({
        description: ptSource[i]?.description || ptSource[i]?.name || prev[i]?.description || `PT ${i + 1}`,
        date: ptSource[i]?.date || prev[i]?.date || "",
      }))
    );
    setQaMeta((prev) => {
      const qaSample = gradeSamples.find((g) => g.qaDescription || g.qaDate);
      return {
        description: qaSample?.qaDescription || prev.description || "",
        date: qaSample?.qaDate || prev.date || "",
      };
    });
  }, [classRecord, selectedTerm, wwCount, ptCount]);

  const openMetaEditor = useCallback((type: "WW" | "PT" | "QA", index: number) => {
    setSelectedColumn({ type, number: index + 1 });
    if (type === "WW") {
      setMetaEditorDraft({ description: wwMeta[index]?.description || `WW ${index + 1}`, date: wwMeta[index]?.date || "" });
    } else if (type === "PT") {
      setMetaEditorDraft({ description: ptMeta[index]?.description || `PT ${index + 1}`, date: ptMeta[index]?.date || "" });
    } else {
      setMetaEditorDraft({ description: qaMeta.description || "Term Assessment", date: qaMeta.date || "" });
    }
  }, [wwMeta, ptMeta, qaMeta]);

  const saveColumnMeta = useCallback(async () => {
    if (!classAssignmentId || !selectedColumn) return;
    const nextWwMeta = [...wwMeta];
    const nextPtMeta = [...ptMeta];
    const nextQaMeta = { ...qaMeta };
    const index = selectedColumn.number - 1;

    if (selectedColumn.type === "WW") {
      while (nextWwMeta.length <= index) nextWwMeta.push({ description: `WW ${nextWwMeta.length + 1}`, date: "" });
      nextWwMeta[index] = { description: metaEditorDraft.description || `WW ${selectedColumn.number}`, date: metaEditorDraft.date || "" };
    } else if (selectedColumn.type === "PT") {
      while (nextPtMeta.length <= index) nextPtMeta.push({ description: `PT ${nextPtMeta.length + 1}`, date: "" });
      nextPtMeta[index] = { description: metaEditorDraft.description || `PT ${selectedColumn.number}`, date: metaEditorDraft.date || "" };
    } else {
      nextQaMeta.description = metaEditorDraft.description;
      nextQaMeta.date = metaEditorDraft.date;
    }

    setWwMeta(nextWwMeta);
    setPtMeta(nextPtMeta);
    setQaMeta(nextQaMeta);
    setSavingMeta(true);

    const result = await saveMetaToAllStudents({
      classAssignmentId: classAssignmentId, classRecord: classRecord, selectedTerm: selectedTerm,
      wwMeta: nextWwMeta, ptMeta: nextPtMeta, qaMeta: nextQaMeta,
      wwCount, ptCount, applyMetaToScores,
    });
    if (!result.ok) {
      setError(result.error || "Failed to save assessment metadata");
      fetchClassRecord();
      setSavingMeta(false);
      return;
    }
    setSuccess("Assessment metadata applied to the selected column");
    fetchClassRecord();
    setSelectedColumn(null);
    setSavingMeta(false);
  }, [classAssignmentId, selectedColumn, wwMeta, ptMeta, qaMeta, metaEditorDraft, classRecord, selectedTerm, wwCount, ptCount, applyMetaToScores, setSuccess, setError, fetchClassRecord]);

  const saveAssessmentDetails = useCallback(async () => {
    if (isViewOnly || !classAssignmentId) return;
    if (classRecord.length === 0) { setSuccess("No learners to update yet."); return; }

    const result = await saveMetaToAllStudents({
      classAssignmentId: classAssignmentId, classRecord: classRecord, selectedTerm: selectedTerm,
      wwMeta, ptMeta, qaMeta, wwCount, ptCount, applyMetaToScores,
    });
    if (!result.ok) { setError(result.error || "Failed to save assessment details"); return; }
    setSuccess("Assessment details saved");
    fetchClassRecord();
  }, [isViewOnly, classAssignmentId, classRecord, selectedTerm, wwMeta, ptMeta, qaMeta, wwCount, ptCount, applyMetaToScores, setSuccess, setError, fetchClassRecord]);

  const applyColumnMetaFromMobile = useCallback(async (category: "WW" | "PT" | "QA", index: number, description: string, date: string) => {
    if (!classAssignmentId) return;
    const nextWwMeta = [...wwMeta];
    const nextPtMeta = [...ptMeta];
    const nextQaMeta = { ...qaMeta };

    if (category === "WW") {
      while (nextWwMeta.length <= index) nextWwMeta.push({ description: `WW ${nextWwMeta.length + 1}`, date: "" });
      nextWwMeta[index] = { description: description || `WW ${index + 1}`, date: date || "" };
    } else if (category === "PT") {
      while (nextPtMeta.length <= index) nextPtMeta.push({ description: `PT ${nextPtMeta.length + 1}`, date: "" });
      nextPtMeta[index] = { description: description || `PT ${index + 1}`, date: date || "" };
    } else {
      nextQaMeta.description = description;
      nextQaMeta.date = date;
    }

    setWwMeta(nextWwMeta);
    setPtMeta(nextPtMeta);
    setQaMeta(nextQaMeta);

    const result = await saveMetaToAllStudents({
      classAssignmentId: classAssignmentId, classRecord: classRecord, selectedTerm: selectedTerm,
      wwMeta: nextWwMeta, ptMeta: nextPtMeta, qaMeta: nextQaMeta,
      wwCount, ptCount, applyMetaToScores,
    });
    if (!result.ok) { setError(result.error || "Failed to sync assessment metadata"); fetchClassRecord(); return; }
    setSuccess("Assessment metadata synced for the class");
    fetchClassRecord();
  }, [classAssignmentId, wwMeta, ptMeta, qaMeta, classRecord, selectedTerm, wwCount, ptCount, applyMetaToScores, setSuccess, setError, fetchClassRecord]);

  const addTask = useCallback((category: "WW" | "PT") => {
    if (isViewOnly) return;
    const targetIdx = category === "WW" ? wwCount : ptCount;
    if (category === "WW") setWwMeta((prev) => [...prev, { description: `WW ${targetIdx + 1}`, date: "" }]);
    else setPtMeta((prev) => [...prev, { description: `PT ${targetIdx + 1}`, date: "" }]);
  }, [isViewOnly, wwCount, ptCount]);

  return {
    wwMeta, setWwMeta, ptMeta, setPtMeta, qaMeta, setQaMeta,
    wwCount, ptCount,
    selectedColumn, setSelectedColumn,
    metaEditorDraft, setMetaEditorDraft,
    savingMeta, applyMetaToScores,
    openMetaEditor, saveColumnMeta, saveAssessmentDetails,
    applyColumnMetaFromMobile, addTask,
  };
}
