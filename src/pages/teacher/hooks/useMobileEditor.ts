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
  const { selectedTerm, getMaxForCell, getCellKey, handleScoreUpdate, setInvalidCells, setError, isViewOnly } = opts;

  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [mobileEditorStudentId, setMobileEditorStudentId] = useState<string | null>(null);
  const [mobileEditorTab, setMobileEditorTab] = useState<"WW" | "PT" | "QA">("WW");
  const [mobileScoreDraft, setMobileScoreDraft] = useState<Record<string, string>>({});

  const selectedMobileRecord = useMemo(
    () => opts.sortedRecords.find((r) => r.student.id === mobileEditorStudentId) ?? null,
    [opts.sortedRecords, mobileEditorStudentId]
  );

  const openMobileEditor = useCallback((studentId: string) => {
    if (isViewOnly) return;
    setMobileEditorStudentId(studentId);
    setMobileEditorOpen(true);
    setMobileScoreDraft({});
    setMobileEditorTab("WW");
  }, [isViewOnly]);

  const handleMobileDraftChange = useCallback((studentId: string, category: ScoreCategory, index: number, value: string) => {
    if (isViewOnly) return;
    const key = getMobileDraftKey(studentId, category, index);
    if (value === "") { setMobileScoreDraft((prev) => ({ ...prev, [key]: "" })); return; }

    const parsed = Number(value);
    const maxAllowed = getMaxForCell(category, index);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > maxAllowed) {
      setMobileScoreDraft((prev) => ({ ...prev, [key]: "" }));
      setInvalidCells((prev) => ({ ...prev, [getCellKey(studentId, category, index)]: `Score cannot exceed ${maxAllowed}.` }));
      return;
    }

    setMobileScoreDraft((prev) => ({ ...prev, [key]: value }));
    setInvalidCells((prev) => {
      const cellKey = getCellKey(studentId, category, index);
      if (!prev[cellKey]) return prev;
      const next = { ...prev };
      delete next[cellKey];
      return next;
    });
  }, [isViewOnly, getMaxForCell, getCellKey, setInvalidCells]);

  const commitMobileScore = useCallback((record: ClassRecord, category: ScoreCategory, index: number) => {
    if (isViewOnly) return;
    const key = getMobileDraftKey(record.student.id, category, index);
    const value = mobileScoreDraft[key] ?? getScoreFromGrade(record, selectedTerm, category, index);
    const normalized = value.trim() === "" ? 0 : Number(value);
    const maxAllowed = getMaxForCell(category, index);

    if (Number.isNaN(normalized) || normalized < 0 || normalized > maxAllowed) {
      setMobileScoreDraft((prev) => ({ ...prev, [key]: "" }));
      setError(`${category} ${category === "QA" ? "" : index + 1} score cannot exceed MAX (${maxAllowed}).`.trim());
      setInvalidCells((prev) => ({ ...prev, [getCellKey(record.student.id, category, index)]: `Score cannot exceed ${maxAllowed}.` }));
      return;
    }

    setMobileScoreDraft((prev) => ({ ...prev, [key]: normalized === 0 ? "" : String(normalized) }));
    handleScoreUpdate(record.student.id, category, index, normalized);
  }, [isViewOnly, mobileScoreDraft, selectedTerm, getMaxForCell, handleScoreUpdate, getCellKey, setError, setInvalidCells]);

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
