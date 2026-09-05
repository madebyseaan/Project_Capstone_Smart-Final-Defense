import { useState, useMemo, useCallback } from "react";
import type { ClassRecord } from "@/lib/api";
import { getMobileDraftKey, getScoreFromGrade } from "../components/classRecordMobileUtils";

type ScoreCategory = "WW" | "PT" | "QA";

export function useMobileEditor(opts: {
  sortedRecords: ClassRecord[];
  selectedTerm: string;
  wwCount: number;
  ptCount: number;
  getMaxForCell: (cat: ScoreCategory, idx: number) => number;
  getCellKey: (sid: string, cat: ScoreCategory, idx: number) => string;
  handleScoreUpdate: (studentId: string, category: ScoreCategory, index: number, newValue: number) => void;
  setInvalidCells: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setError: (msg: string) => void;
  isViewOnly: boolean;
}) {
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [mobileEditorStudentId, setMobileEditorStudentId] = useState<string | null>(null);
  const [mobileEditorTab, setMobileEditorTab] = useState<"WW" | "PT" | "QA">("WW");
  const [mobileScoreDraft, setMobileScoreDraft] = useState<Record<string, string>>({});

  const selectedMobileRecord = useMemo(
    () => opts.sortedRecords.find((r) => r.student.id === mobileEditorStudentId) ?? null,
    [opts.sortedRecords, mobileEditorStudentId]
  );

  const openMobileEditor = useCallback((studentId: string) => {
    if (opts.isViewOnly) return;
    setMobileEditorStudentId(studentId);
    setMobileEditorOpen(true);
    setMobileScoreDraft({});
    setMobileEditorTab("WW");
  }, [opts.isViewOnly]);

  const handleMobileDraftChange = useCallback((studentId: string, category: ScoreCategory, index: number, value: string) => {
    if (opts.isViewOnly) return;
    const key = getMobileDraftKey(studentId, category, index);
    if (value === "") { setMobileScoreDraft((prev) => ({ ...prev, [key]: "" })); return; }

    const parsed = Number(value);
    const maxAllowed = opts.getMaxForCell(category, index);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > maxAllowed) {
      setMobileScoreDraft((prev) => ({ ...prev, [key]: "" }));
      opts.setInvalidCells((prev) => ({ ...prev, [opts.getCellKey(studentId, category, index)]: `Score cannot exceed ${maxAllowed}.` }));
      return;
    }

    setMobileScoreDraft((prev) => ({ ...prev, [key]: value }));
    opts.setInvalidCells((prev) => {
      const cellKey = opts.getCellKey(studentId, category, index);
      if (!prev[cellKey]) return prev;
      const next = { ...prev };
      delete next[cellKey];
      return next;
    });
  }, [opts.isViewOnly, opts.getMaxForCell, opts.getCellKey]);

  const commitMobileScore = useCallback((record: ClassRecord, category: ScoreCategory, index: number) => {
    if (opts.isViewOnly) return;
    const key = getMobileDraftKey(record.student.id, category, index);
    const value = mobileScoreDraft[key] ?? getScoreFromGrade(record, opts.selectedTerm, category, index);
    const normalized = value.trim() === "" ? 0 : Number(value);
    const maxAllowed = opts.getMaxForCell(category, index);

    if (Number.isNaN(normalized) || normalized < 0 || normalized > maxAllowed) {
      setMobileScoreDraft((prev) => ({ ...prev, [key]: "" }));
      opts.setError(`${category} ${category === "QA" ? "" : index + 1} score cannot exceed MAX (${maxAllowed}).`.trim());
      opts.setInvalidCells((prev) => ({ ...prev, [opts.getCellKey(record.student.id, category, index)]: `Score cannot exceed ${maxAllowed}.` }));
      return;
    }

    setMobileScoreDraft((prev) => ({ ...prev, [key]: normalized === 0 ? "" : String(normalized) }));
    opts.handleScoreUpdate(record.student.id, category, index, normalized);
  }, [opts.isViewOnly, mobileScoreDraft, opts.selectedTerm, opts.getMaxForCell, opts.handleScoreUpdate, opts.getCellKey]);

  return {
    mobileEditorOpen, setMobileEditorOpen,
    mobileEditorStudentId, setMobileEditorStudentId,
    mobileEditorTab, setMobileEditorTab,
    mobileScoreDraft, setMobileScoreDraft,
    selectedMobileRecord,
    openMobileEditor,
    handleMobileDraftChange,
    commitMobileScore,
  };
}
