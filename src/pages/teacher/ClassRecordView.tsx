import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Loader2, X, Monitor } from "lucide-react";
import { gradesApi, adminApi, type ClassRecord, type ScoreItem, type TermLabels } from "@/lib/api";
import { ClassRecordTable } from "./components/ClassRecordTable";
import { ClassRecordMobileList } from "./components/ClassRecordMobileList";
import { GradeEditModal } from "./components/GradeEditModal";
import { GradeStatusBanner } from "@/components/GradeStatusBanner";
import { ClassRecordHero } from "./components/ClassRecordHero";
import { ClassRecordStats } from "./components/ClassRecordStats";
import { ClassRecordTour } from "./components/ClassRecordTour";
import { EditRequestModal } from "./components/EditRequestModal";
import { AssessmentHeader } from "./components/AssessmentHeader";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { executeHpsUpdate, executeRemoveTask, executeScoreUpdate } from "./components/classRecordActions";
import { getDisplayFinalGrade as computeDisplayFinalGrade, getMobileDraftKey, getScoreFromGrade as computeScoreFromGrade } from "./components/classRecordMobileUtils";
import { getGradeColor } from "@/lib/gradeMath";
import { useClassRecordQuery, useTransmutationTable } from "./hooks/useClassRecord";
import { useEditAccess } from "./hooks/useEditAccess";
import { useAssessmentMeta } from "./hooks/useAssessmentMeta";
import { useMobileEditor } from "./hooks/useMobileEditor";
import { useStickyLayout } from "./hooks/useStickyLayout";

export default function ClassRecordView() {
  const { classAssignmentId } = useParams();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const userName = useMemo(() => {
    try {
      const u = JSON.parse(sessionStorage.getItem("user_teacher") || sessionStorage.getItem("user") || "{}");
      return `${u.firstName || ""} ${u.lastName || ""}`.trim() || "—";
    } catch { return "—"; }
  }, []);

  const [selectedTerm, setSelectedTerm] = useState("T1");
  const [termInitialized, setTermInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAssessmentDetails, setShowAssessmentDetails] = useState(false);
  const [termLabels, setTermLabels] = useState<TermLabels>({ T1: "Quarterly 1", T2: "Quarterly 2", T3: "Quarterly 3" });
  const [invalidCells, setInvalidCells] = useState<Record<string, string>>({});
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [showMobileWarning, setShowMobileWarning] = useState(false);
  const [separateByGender, setSeparateByGender] = useState(false);

  // React Query hooks
  const classRecordQuery = useClassRecordQuery(classAssignmentId, selectedTerm);
  const transmutationQuery = useTransmutationTable();

  const classRecord = classRecordQuery.data?.classRecord ?? [];
  const classAssignment = classRecordQuery.data?.classAssignment ?? null;
  const effectiveWeights = classRecordQuery.data?.effectiveWeights ?? null;
  const currentTerm = classRecordQuery.data?.currentTerm ?? "T1";
  const termDates = classRecordQuery.data?.termDates ?? null;
  const gradeLock = classRecordQuery.data?.gradeLock ?? false;
  const loading = classRecordQuery.isLoading;
  const transmutationTable = transmutationQuery.data ?? [];

  const lockedTerm = classAssignment?.subject?.rotationTermRank ? `T${classAssignment.subject.rotationTermRank}` : null;
  const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
  const isPastTerm = currentTerm && termOrder[selectedTerm] < termOrder[currentTerm];

  // setClassRecord wrapper for action functions
  const setClassRecord = useCallback((updater: React.SetStateAction<ClassRecord[]>) => {
    queryClient.setQueryData(["class-record", classAssignmentId, selectedTerm], (old: any) => {
      if (!old) return old;
      return { ...old, classRecord: typeof updater === "function" ? updater(old.classRecord) : updater };
    });
  }, [queryClient, classAssignmentId, selectedTerm]);

  const fetchClassRecord = useCallback(async () => { await classRecordQuery.refetch(); }, [classRecordQuery]);

  // Term initialization (F9 fix)
  useEffect(() => {
    if (!termInitialized && classRecordQuery.data?.currentTerm) {
      setTermInitialized(true);
      const forcedTerm = classAssignment?.subject?.rotationTermRank ? `T${classAssignment.subject.rotationTermRank}` : null;
      const termToSet = forcedTerm ?? classRecordQuery.data.currentTerm;
      if (termToSet !== selectedTerm) setSelectedTerm(termToSet);
    }
  }, [termInitialized, classRecordQuery.data?.currentTerm, classAssignment?.subject?.rotationTermRank, selectedTerm]);

  // Term labels
  useEffect(() => {
    adminApi.getSettings().then((res) => { if (res.data.termLabels) setTermLabels(res.data.termLabels); }).catch(() => {});
  }, []);

  // Edit access hook
  const editAccess = useEditAccess({ isPastTerm: !!isPastTerm, gradeLock, selectedTerm });

  // Apply meta to scores
  const applyMetaToScores = useCallback((scores: ScoreItem[], category: "WW" | "PT", minLength = 0, metaOverride?: Array<{ description: string; date: string }>): ScoreItem[] => {
    const meta = metaOverride || (category === "WW" ? metaHook.wwMeta : metaHook.ptMeta);
    const targetLength = Math.max(scores.length, minLength);
    return Array.from({ length: targetLength }, (_, i) => {
      const existing = scores[i] || ({ score: 0, maxScore: 10 } as ScoreItem);
      return { ...existing, name: meta[i]?.description?.trim() || `${category} ${i + 1}`, description: meta[i]?.description?.trim() || `${category} ${i + 1}`, date: meta[i]?.date || undefined, maxScore: Number(existing.maxScore ?? 10), score: Number(existing.score ?? 0) };
    });
  }, []);

  // Assessment meta hook
  const metaHook = useAssessmentMeta({
    classRecord, selectedTerm, classAssignmentId, applyMetaToScores,
    setSuccess, setError, fetchClassRecord, isViewOnly: editAccess.isViewOnly,
  });

  // HPS data
  const hpsData = useMemo(() => {
    const wwScores: ScoreItem[] = Array.from({ length: metaHook.wwCount }, (_, i) => ({ name: `WW ${i + 1}`, score: 0, maxScore: 0 }));
    const ptScores: ScoreItem[] = Array.from({ length: metaHook.ptCount }, (_, i) => ({ name: `PT ${i + 1}`, score: 0, maxScore: 0 }));
    let qaMax = 0;
    classRecord.forEach((record) => {
      const grade = record.grades.find((g) => g.term === selectedTerm);
      if (!grade) return;
      (grade.writtenWorkScores || []).forEach((item: any, i: number) => { if (i < wwScores.length) wwScores[i].maxScore = Math.max(wwScores[i].maxScore || 0, Number(item.maxScore) || 0); });
      (grade.perfTaskScores || []).forEach((item: any, i: number) => { if (i < ptScores.length) ptScores[i].maxScore = Math.max(ptScores[i].maxScore || 0, Number(item.maxScore) || 0); });
      qaMax = Math.max(qaMax, Number(grade.quarterlyAssessMax) || 0);
    });
    return { wwScores, ptScores, qaMax: qaMax || 100 };
  }, [classRecord, selectedTerm, metaHook.wwCount, metaHook.ptCount]);

  const getCellKey = useCallback((sid: string, cat: "WW" | "PT" | "QA", idx: number) => `${sid}:${cat}:${idx}`, []);
  const getMaxForCell = useCallback((cat: "WW" | "PT" | "QA", idx: number): number => {
    if (cat === "WW") return Number(hpsData.wwScores[idx]?.maxScore ?? 0);
    if (cat === "PT") return Number(hpsData.ptScores[idx]?.maxScore ?? 0);
    return Number(hpsData.qaMax ?? 0);
  }, [hpsData]);
  const isCellInvalid = useCallback((sid: string, cat: "WW" | "PT" | "QA", idx: number) => invalidCells[getCellKey(sid, cat, idx)], [invalidCells, getCellKey]);

  const handleScoreUpdate = useCallback(async (studentId: string, category: "WW" | "PT" | "QA", index: number, newValue: number) => {
    if (editAccess.isViewOnly) return;
    await executeScoreUpdate({ classAssignmentId, classRecord, selectedTerm, studentId, category, index, newValue, qaMeta: metaHook.qaMeta, getCellKey, getMaxForCell, applyMetaToScores, setClassRecord, setInvalidCells, setError, fetchClassRecord, isViewOnly: editAccess.isViewOnly });
  }, [editAccess.isViewOnly, classAssignmentId, classRecord, selectedTerm, metaHook.qaMeta, getCellKey, getMaxForCell, applyMetaToScores, fetchClassRecord]);

  const handleHpsUpdate = useCallback(async (category: "WW" | "PT" | "QA", index: number, newMax: number) => {
    if (editAccess.isViewOnly) return;
    await executeHpsUpdate({ classAssignmentId, classRecord, selectedTerm, category, index, newMax, qaMeta: metaHook.qaMeta, applyMetaToScores, setClassRecord, setError, fetchClassRecord, isViewOnly: editAccess.isViewOnly });
  }, [editAccess.isViewOnly, classAssignmentId, classRecord, selectedTerm, metaHook.qaMeta, applyMetaToScores, fetchClassRecord]);

  const addTask = useCallback((category: "WW" | "PT") => {
    if (editAccess.isViewOnly) return;
    metaHook.addTask(category);
    handleHpsUpdate(category, category === "WW" ? metaHook.wwCount : metaHook.ptCount, 10);
  }, [editAccess.isViewOnly, metaHook, handleHpsUpdate]);

  const removeTask = useCallback(async (category: "WW" | "PT") => {
    if (editAccess.isViewOnly) return;
    await executeRemoveTask({ classAssignmentId, classRecord, selectedTerm, category, wwCount: metaHook.wwCount, ptCount: metaHook.ptCount, qaMeta: metaHook.qaMeta, applyMetaToScores, setClassRecord, setWwMeta: metaHook.setWwMeta, setPtMeta: metaHook.setPtMeta, setSuccess, setError, fetchClassRecord, isViewOnly: editAccess.isViewOnly });
  }, [editAccess.isViewOnly, classAssignmentId, classRecord, selectedTerm, metaHook, applyMetaToScores, fetchClassRecord]);

  const sortedRecords = useMemo(() => [...classRecord].sort((a, b) => `${a.student.lastName}, ${a.student.firstName}`.localeCompare(`${b.student.lastName}, ${b.student.firstName}`)), [classRecord]);
  const maleRecords = useMemo(() => sortedRecords.filter((r) => r.student.gender?.toLowerCase() === "male"), [sortedRecords]);
  const femaleRecords = useMemo(() => sortedRecords.filter((r) => r.student.gender?.toLowerCase() === "female"), [sortedRecords]);

  const activeWeights = useMemo(() => ({ ww: effectiveWeights?.ww ?? classAssignment?.subject?.writtenWorkWeight ?? 0, pt: effectiveWeights?.pt ?? classAssignment?.subject?.perfTaskWeight ?? 0, qa: effectiveWeights?.qa ?? classAssignment?.subject?.quarterlyAssessWeight ?? 0 }), [effectiveWeights, classAssignment]);
  const getDisplayFinalGrade = useCallback((record: ClassRecord) => computeDisplayFinalGrade(record, selectedTerm, activeWeights, transmutationTable), [selectedTerm, activeWeights, transmutationTable]);
  const stats = useMemo(() => {
    if (classRecord.length === 0) return null;
    const grades = classRecord.map((r) => getDisplayFinalGrade(r)).filter((g): g is number => g != null);
    if (grades.length === 0) return { avg: 0, passed: 0, highest: 0, lowest: 0 };
    return { avg: grades.reduce((a, b) => a + b, 0) / grades.length, passed: grades.filter((g) => g >= 75).length, highest: Math.max(...grades), lowest: Math.min(...grades) };
  }, [classRecord, selectedTerm, activeWeights]);

  // Mobile editor hook
  const mobileEditor = useMobileEditor({ sortedRecords, selectedTerm, wwCount: metaHook.wwCount, ptCount: metaHook.ptCount, getMaxForCell, getCellKey, handleScoreUpdate, setInvalidCells, setError, isViewOnly: editAccess.isViewOnly });

  // Sticky layout hook
  const layout = useStickyLayout({ classAssignmentId, showAssessmentDetails, selectedColumn: metaHook.selectedColumn });

  const commitScoreInput = (inputEl: HTMLInputElement, studentId: string, category: "WW" | "PT" | "QA", index: number): boolean => {
    const rawValue = inputEl.value.trim().toUpperCase();
    const isSpecial = rawValue === "A" || rawValue === "E";
    const key = getCellKey(studentId, category, index);
    const maxAllowed = getMaxForCell(category, index);

    if (isSpecial) {
      setInvalidCells((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next; });
      inputEl.dataset.prev = rawValue;
      handleScoreUpdate(studentId, category, index, rawValue as any);
      return true;
    }
    const parsed = rawValue === "" ? 0 : Number(rawValue);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > maxAllowed) {
      inputEl.value = inputEl.dataset.prev ?? "";
      setInvalidCells((prev) => ({ ...prev, [key]: `Score cannot exceed ${maxAllowed}.` }));
      setError(`${category} ${category === "QA" ? "" : index + 1} score cannot exceed MAX (${maxAllowed}).`.trim());
      return false;
    }
    setInvalidCells((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next; });
    inputEl.dataset.prev = String(parsed);
    handleScoreUpdate(studentId, category, index, parsed);
    return true;
  };

  const handleClearScores = useCallback(async () => {
    if (editAccess.isViewOnly || !classAssignmentId) return;
    try { await gradesApi.clearScores(classAssignmentId, selectedTerm); setSuccess("Successfully cleared all scores for the current term."); await fetchClassRecord(); } catch (err: any) { setError(err?.response?.data?.message || "Failed to clear scores"); }
  }, [editAccess.isViewOnly, classAssignmentId, selectedTerm, fetchClassRecord]);

  // Auto-dismiss toasts
  useEffect(() => {
    if (error || success) { const t = setTimeout(() => { setError(null); setSuccess(null); }, 4000); return () => clearTimeout(t); }
  }, [error, success]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="text-center"><div className="w-20 h-20 bg-indigo-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-sm"><Loader2 className="w-10 h-10 text-indigo-600 animate-spin" /></div><p className="text-slate-500 font-black text-xs uppercase tracking-widest">Fetching Class Records...</p></div></div>;
  if (!classAssignment) return null;

  return (
    <div className="space-y-6 animate-fade-in w-full px-6 pb-12">
      {(error || success) && (
        <div className={`fixed top-20 right-6 z-[100] flex items-center gap-4 px-6 py-4 rounded-[1.5rem] shadow-2xl border-0 animate-slide-in-right ${error ? "bg-rose-500 text-white" : "bg-emerald-500 text-white"}`}>
          {error ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
          <span className="text-sm font-black uppercase tracking-widest">{error || success}</span>
          <button onClick={() => { setError(null); setSuccess(null); }} className="ml-4 p-1 hover:bg-white/20 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>
      )}

      <ClassRecordHero classAssignment={classAssignment} effectiveWeightsSource={effectiveWeights?.source ?? null} onStartTour={() => { window.innerWidth < 1024 ? setShowMobileWarning(true) : (setIsTourOpen(true), window.dispatchEvent(new Event("tour:start"))); }} />

      <GradeStatusBanner currentTerm={currentTerm} selectedTerm={selectedTerm} termEndDate={currentTerm === "T1" ? termDates?.t1EndDate : currentTerm === "T2" ? termDates?.t2EndDate : termDates?.t3EndDate} gradeLock={gradeLock} colors={colors} editRequestStatus={isPastTerm ? editAccess.editRequestStatus : "idle"} editTimeRemaining={editAccess.editTimeRemaining} onRequestEdit={isPastTerm && !gradeLock && editAccess.editRequestStatus === "idle" ? editAccess.openEditRequestModal : undefined} termLabels={termLabels} />

      {stats && <ClassRecordStats avg={stats.avg} passed={stats.passed} total={classRecord.length} highest={stats.highest} />}

      <ClassRecordMobileList records={sortedRecords} selectedTerm={selectedTerm} onTermChange={setSelectedTerm} onOpenEditor={mobileEditor.openMobileEditor} getDisplayFinalGrade={getDisplayFinalGrade} getGradeColor={getGradeColor} isViewOnly={editAccess.isViewOnly} />

      <ClassRecordTable classAssignment={classAssignment} effectiveWeights={effectiveWeights} selectedTerm={selectedTerm} onTermChange={setSelectedTerm} lockedTerm={lockedTerm} currentTerm={currentTerm} isViewOnly={editAccess.isViewOnly} separateByGender={separateByGender} onSeparateByGenderChange={setSeparateByGender} showAssessmentDetails={showAssessmentDetails} onToggleAssessmentDetails={() => setShowAssessmentDetails((p) => !p)} onClearScores={handleClearScores} ledgerHeaderRef={layout.ledgerHeaderRef} topNavHeight={layout.topNavHeight} ledgerHeaderHeight={Math.ceil(layout.ledgerHeaderHeight)} stickyOffset={layout.stickyOffset} wwCount={metaHook.wwCount} ptCount={metaHook.ptCount} hpsData={hpsData} sortedRecords={sortedRecords} maleRecords={maleRecords} femaleRecords={femaleRecords} onRemoveTask={removeTask} onAddTask={addTask} onHpsUpdate={handleHpsUpdate} onScoreCommit={commitScoreInput} onCellFocus={metaHook.openMetaEditor} isCellInvalid={isCellInvalid} transmutationTable={transmutationTable} dataUpdatedAt={classRecordQuery.dataUpdatedAt} assessmentHeaderNode={<AssessmentHeader showAssessmentDetails={showAssessmentDetails} assessmentDetailsRef={layout.assessmentDetailsRef} metaEditorRef={layout.metaEditorRef} wwCount={metaHook.wwCount} ptCount={metaHook.ptCount} wwMeta={metaHook.wwMeta} ptMeta={metaHook.ptMeta} qaMeta={metaHook.qaMeta} setWwMeta={metaHook.setWwMeta} setPtMeta={metaHook.setPtMeta} setQaMeta={metaHook.setQaMeta} saveAssessmentDetails={metaHook.saveAssessmentDetails} savingMeta={metaHook.savingMeta} selectedColumn={metaHook.selectedColumn} setSelectedColumn={metaHook.setSelectedColumn} metaEditorDraft={metaHook.metaEditorDraft} setMetaEditorDraft={metaHook.setMetaEditorDraft} saveColumnMeta={metaHook.saveColumnMeta} isViewOnly={editAccess.isViewOnly} />} />

      <GradeEditModal open={mobileEditor.mobileEditorOpen} onOpenChange={(open) => { mobileEditor.setMobileEditorOpen(open); if (!open) { mobileEditor.setMobileEditorStudentId(null); mobileEditor.setMobileScoreDraft({}); } }} selectedRecord={mobileEditor.selectedMobileRecord} selectedTerm={selectedTerm} mobileEditorTab={mobileEditor.mobileEditorTab} onTabChange={mobileEditor.setMobileEditorTab} wwCount={metaHook.wwCount} ptCount={metaHook.ptCount} wwMeta={metaHook.wwMeta} ptMeta={metaHook.ptMeta} qaMeta={metaHook.qaMeta} mobileScoreDraft={mobileEditor.mobileScoreDraft} invalidCells={invalidCells} getCellKey={getCellKey} getMobileDraftKey={getMobileDraftKey} getScoreFromGrade={(record, category, index) => computeScoreFromGrade(record, selectedTerm, category, index)} getMaxForCell={getMaxForCell} onMobileScoreDraftChange={mobileEditor.handleMobileDraftChange} onMobileScoreCommit={mobileEditor.commitMobileScore} onApplyColumnMeta={metaHook.applyColumnMetaFromMobile} isViewOnly={editAccess.isViewOnly} />

      <ClassRecordTour isOpen={isTourOpen} onClose={() => { setIsTourOpen(false); setShowAssessmentDetails(false); metaHook.setSelectedColumn(null); window.dispatchEvent(new Event("tour:end")); }} setShowAssessmentDetails={setShowAssessmentDetails} setSelectedColumn={metaHook.setSelectedColumn} />

      <Dialog open={showMobileWarning} onOpenChange={setShowMobileWarning}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><div className="p-2 bg-amber-100 rounded-xl"><Monitor className="w-5 h-5 text-amber-600" /></div>Desktop Recommended</DialogTitle>
            <DialogDescription className="text-slate-600 pt-2">The interactive tutorial is optimized for desktop screens (1024px and wider). For the best experience, we recommend using a laptop or desktop computer the first time you go through the tutorial.</DialogDescription>
          </DialogHeader>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 my-2"><p className="text-sm text-amber-800 font-medium"><strong>Why desktop?</strong> The tutorial highlights specific UI elements and may not display correctly on smaller screens.</p></div>
          <DialogFooter className="gap-2 sm:gap-0"><Button onClick={() => setShowMobileWarning(false)} className="bg-indigo-600 hover:bg-indigo-700">Got it, I'll use Desktop</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <EditRequestModal open={editAccess.editRequestModalOpen} onOpenChange={editAccess.setEditRequestModalOpen} onSuccess={editAccess.onEditRequestSuccess} selectedTerm={selectedTerm} classAssignment={classAssignment} userName={userName} />
    </div>
  );
}
