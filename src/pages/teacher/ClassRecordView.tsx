import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  X,
  Monitor,
} from "lucide-react";
import {
  gradesApi,
  adminApi,
  type ClassAssignment,
  type ClassRecord,
  type ScoreItem,
  type TermLabels,
} from "@/lib/api";
import { ClassRecordTable } from "./components/ClassRecordTable";
import { ClassRecordMobileList } from "./components/ClassRecordMobileList";
import { GradeEditModal } from "./components/GradeEditModal";
import { GradeStatusBanner } from "@/components/GradeStatusBanner";
import { AssessmentHeader } from "./components/AssessmentHeader";
import { ClassRecordHero } from "./components/ClassRecordHero";
import { ClassRecordStats } from "./components/ClassRecordStats";
import { ClassRecordTour } from "./components/ClassRecordTour";
import { EditRequestModal } from "./components/EditRequestModal";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { executeHpsUpdate, executeRemoveTask, executeScoreUpdate } from "./components/classRecordActions";
import { HGDescriptorPanel } from "./components/HGDescriptorPanel";
import {
  getDisplayFinalGrade as computeDisplayFinalGrade,
  getMobileDraftKey,
  getScoreFromGrade as computeScoreFromGrade,
} from "./components/classRecordMobileUtils";

const HG_DESCRIPTORS = [
  'No Improvement',
  'Needs Improvement',
  'Developing',
  'Sufficiently Developed',
] as const;

interface AssessmentTaskMeta {
  description: string;
  date: string;
}

function getGradeColor(grade: number | null): string {
  if (grade === null) return "text-slate-300";
  if (grade >= 90) return "text-emerald-600";
  if (grade >= 85) return "text-blue-600";
  if (grade >= 80) return "text-amber-600";
  if (grade >= 75) return "text-orange-600";
  return "text-rose-600";
}


export default function ClassRecordView() {
  const { classAssignmentId } = useParams();
  const { colors } = useTheme();

  const userName = useMemo(() => {
    try {
      const u = JSON.parse(sessionStorage.getItem("user_teacher") || sessionStorage.getItem("user") || "{}");
      return `${u.firstName || ""} ${u.lastName || ""}`.trim() || "—";
    } catch { return "—"; }
  }, []);

  const [classAssignment, setClassAssignment] = useState<ClassAssignment | null>(null);
  const [classRecord, setClassRecord] = useState<ClassRecord[]>([]);
  const [effectiveWeights, setEffectiveWeights] = useState<{
    ww: number;
    pt: number;
    qa: number;
    source: "subject-override" | "subject-type" | "generic-fallback";
  } | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<string>("T1");
  const [termInitialized, setTermInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingDescriptorStudentId, setSavingDescriptorStudentId] = useState<string | null>(null);
  const [showAssessmentDetails, setShowAssessmentDetails] = useState(false);
  const [currentTerm, setCurrentTerm] = useState<string>("T1");
  const [termDates, setTermDates] = useState<{ t1EndDate?: string | null; t2EndDate?: string | null; t3EndDate?: string | null } | null>(null);
  const [gradeLock, setGradeLock] = useState(false);
  const [termLabels, setTermLabels] = useState<TermLabels>({ T1: "Quarterly 1", T2: "Quarterly 2", T3: "Quarterly 3" });

  // Fetch term labels on mount
  useEffect(() => {
    adminApi.getSettings().then((res) => {
      if (res.data.termLabels) setTermLabels(res.data.termLabels);
    }).catch(() => {});
  }, []);

  // Edit request state (must be declared before isViewOnly)
  const [editRequestModalOpen, setEditRequestModalOpen] = useState(false);
  const [editRequestStatus, setEditRequestStatus] = useState<"idle" | "pending" | "approved" | "rejected">("idle");
  const [editRequestExpiresAt, setEditRequestExpiresAt] = useState<Date | null>(null);
  const [editTimeRemaining, setEditTimeRemaining] = useState<string>("");

  // Check if selected term is a past term (view-only mode)
  const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
  const isPastTerm = currentTerm && termOrder[selectedTerm] < termOrder[currentTerm];
  const isViewOnly = (isPastTerm || gradeLock) && editRequestStatus !== "approved";

  // Compute time remaining for approved edit access
  useEffect(() => {
    if (editRequestStatus !== "approved" || !editRequestExpiresAt) return;
    const updateRemaining = () => {
      const now = new Date();
      const diff = editRequestExpiresAt.getTime() - now.getTime();
      if (diff <= 0) {
        setEditTimeRemaining("Expired");
        setEditRequestStatus("idle");
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setEditTimeRemaining(`${hours}h ${minutes}m remaining`);
    };
    updateRemaining();
    const interval = setInterval(updateRemaining, 60000);
    return () => clearInterval(interval);
  }, [editRequestStatus, editRequestExpiresAt]);

  // Check for existing edit requests on load
  useEffect(() => {
    if (isPastTerm && !gradeLock) {
      gradesApi.getMyEditRequests().then((res) => {
        const pending = res.data.requests?.find((r: any) => r.term === selectedTerm && r.status === "PENDING");
        const approved = res.data.requests?.find((r: any) => r.term === selectedTerm && r.status === "APPROVED" && new Date(r.expiresAt) > new Date());
        if (approved) {
          setEditRequestStatus("approved");
          setEditRequestExpiresAt(new Date(approved.expiresAt));
        } else if (pending) {
          setEditRequestStatus("pending");
        } else {
          setEditRequestStatus("idle");
        }
      }).catch(() => {});
    }
  }, [isPastTerm, gradeLock, selectedTerm]);
  const [wwMeta, setWwMeta] = useState<AssessmentTaskMeta[]>([]);
  const [ptMeta, setPtMeta] = useState<AssessmentTaskMeta[]>([]);
  const [qaMeta, setQaMeta] = useState<{ description: string; date: string }>({ description: '', date: '' });
  const [invalidCells, setInvalidCells] = useState<Record<string, string>>({});
  const [selectedColumn, setSelectedColumn] = useState<{ type: 'WW' | 'PT' | 'QA'; number: number } | null>(null);
  const [metaEditorDraft, setMetaEditorDraft] = useState<{ description: string; date: string }>({ description: '', date: '' });
  const [savingMeta, setSavingMeta] = useState(false);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [mobileEditorStudentId, setMobileEditorStudentId] = useState<string | null>(null);
  const [mobileEditorTab, setMobileEditorTab] = useState<'WW' | 'PT' | 'QA' | 'HG'>('WW');
  const [mobileScoreDraft, setMobileScoreDraft] = useState<Record<string, string>>({});
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [showMobileWarning, setShowMobileWarning] = useState(false);

  const [separateByGender, setSeparateByGender] = useState(false);
  const isHGClass = (classAssignment?.subject?.code ?? '').startsWith('HG');
  // If the subject is a rotating subject (e.g. SCI_BIO = Term 1 only),
  // lock the term selector so the teacher can't accidentally enter grades in the wrong term.
  const lockedTerm: string | null = classAssignment?.subject?.rotationTermRank
    ? `T${classAssignment.subject.rotationTermRank}`
    : null;
  const ledgerHeaderRef = useRef<HTMLDivElement | null>(null);
  const [ledgerHeaderHeight, setLedgerHeaderHeight] = useState(0);
  const assessmentDetailsRef = useRef<HTMLDivElement | null>(null);
  const [assessmentDetailsHeight, setAssessmentDetailsHeight] = useState(0);
  const metaEditorRef = useRef<HTMLDivElement | null>(null);
  const [metaEditorHeight, setMetaEditorHeight] = useState(0);

  // Dynamic Column Counts
  const wwCount = useMemo(() => {
    let max = 1;
    classRecord.forEach(r => {
      const grade = r.grades.find(g => g.term === selectedTerm);
      if (grade?.writtenWorkScores) max = Math.max(max, (grade.writtenWorkScores as any[]).length);
    });
    return max;
  }, [classRecord, selectedTerm]);

  const ptCount = useMemo(() => {
    let max = 1;
    classRecord.forEach(r => {
      const grade = r.grades.find(g => g.term === selectedTerm);
      if (grade?.perfTaskScores) max = Math.max(max, (grade.perfTaskScores as any[]).length);
    });
    return max;
  }, [classRecord, selectedTerm]);

  const hpsData = useMemo(() => {
    const wwScores: ScoreItem[] = Array.from({ length: wwCount }, (_, i) => ({
      name: `WW ${i + 1}`,
      score: 0,
      maxScore: 0,
    }));
    const ptScores: ScoreItem[] = Array.from({ length: ptCount }, (_, i) => ({
      name: `PT ${i + 1}`,
      score: 0,
      maxScore: 0,
    }));

    let qaMax = 0;

    classRecord.forEach((record) => {
      const grade = record.grades.find((g) => g.term === selectedTerm);
      if (!grade) return;

      const ww = (grade.writtenWorkScores || []) as ScoreItem[];
      const pt = (grade.perfTaskScores || []) as ScoreItem[];

      ww.forEach((item, i) => {
        if (i < wwScores.length) {
          wwScores[i].maxScore = Math.max(wwScores[i].maxScore || 0, Number(item.maxScore) || 0);
        }
      });

      pt.forEach((item, i) => {
        if (i < ptScores.length) {
          ptScores[i].maxScore = Math.max(ptScores[i].maxScore || 0, Number(item.maxScore) || 0);
        }
      });

      qaMax = Math.max(qaMax, Number(grade.quarterlyAssessMax) || 0);
    });

    return {
      wwScores,
      ptScores,
      qaMax: qaMax || 100,
    };
  }, [classRecord, selectedTerm, wwCount, ptCount]);

  useEffect(() => {
    const gradeSamples = classRecord
      .map((record) => record.grades.find((g) => g.term === selectedTerm))
      .filter(Boolean) as Array<any>;

    const wwSample = gradeSamples.find((g) => Array.isArray(g.writtenWorkScores) && g.writtenWorkScores.length > 0);
    const ptSample = gradeSamples.find((g) => Array.isArray(g.perfTaskScores) && g.perfTaskScores.length > 0);

    const wwSource = ((wwSample?.writtenWorkScores || []) as ScoreItem[]);
    const ptSource = ((ptSample?.perfTaskScores || []) as ScoreItem[]);

    setWwMeta((prev) =>
      Array.from({ length: wwCount }, (_, i) => ({
        description: wwSource[i]?.description || wwSource[i]?.name || prev[i]?.description || `WW ${i + 1}`,
        date: wwSource[i]?.date || prev[i]?.date || '',
      }))
    );

    setPtMeta((prev) =>
      Array.from({ length: ptCount }, (_, i) => ({
        description: ptSource[i]?.description || ptSource[i]?.name || prev[i]?.description || `PT ${i + 1}`,
        date: ptSource[i]?.date || prev[i]?.date || '',
      }))
    );

    setQaMeta((prev) => {
      const qaSample = gradeSamples.find((g) => g.qaDescription || g.qaDate);
      return {
        description: qaSample?.qaDescription || prev.description || '',
        date: qaSample?.qaDate || prev.date || '',
      };
    });
  }, [classRecord, selectedTerm, wwCount, ptCount]);

  const applyMetaToScores = useCallback((
    scores: ScoreItem[],
    category: 'WW' | 'PT',
    minLength = 0,
    metaOverride?: AssessmentTaskMeta[],
  ): ScoreItem[] => {
    const meta = metaOverride || (category === 'WW' ? wwMeta : ptMeta);
    const targetLength = Math.max(scores.length, minLength);

    return Array.from({ length: targetLength }, (_, i) => {
      const existing = scores[i] || ({ score: 0, maxScore: 10 } as ScoreItem);
      const description = meta[i]?.description?.trim() || `${category} ${i + 1}`;
      const date = meta[i]?.date || '';
      return {
        ...existing,
        name: description,
        description,
        date: date || undefined,
        maxScore: Number(existing.maxScore ?? 10),
        score: Number(existing.score ?? 0),
      };
    });
  }, [wwMeta, ptMeta]);

  const fetchClassRecord = useCallback(async (silent = false) => {
    if (!classAssignmentId) return;
    try {
      if (!silent) setLoading(true);
      const response = await gradesApi.getClassRecord(classAssignmentId, selectedTerm);

      if (!termInitialized && response.data.currentTerm) {
        setTermInitialized(true);
        const forcedTerm = classAssignment?.subject?.rotationTermRank
          ? `T${classAssignment.subject.rotationTermRank}`
          : null;
        const termToSet = forcedTerm ?? response.data.currentTerm;
        if (termToSet !== selectedTerm) {
          setSelectedTerm(termToSet);
          return;
        }
      }

      setClassAssignment(response.data.classAssignment);
      setClassRecord(response.data.classRecord);
      setEffectiveWeights(response.data.effectiveWeights ?? null);
      if (response.data.currentTerm) {
        setCurrentTerm(response.data.currentTerm);
      }
      if (response.data.termDates) {
        setTermDates(response.data.termDates);
      }
      if (response.data.gradeLock !== undefined) {
        setGradeLock(response.data.gradeLock);
      }
    } catch (err) {
      console.error("Failed to fetch class record:", err);
      if (!silent) setError("Failed to load class record");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [classAssignmentId, selectedTerm, termInitialized, classAssignment?.subject?.rotationTermRank]);

  const getCellKey = useCallback((sid: string, cat: 'WW' | 'PT' | 'QA', idx: number) => `${sid}:${cat}:${idx}`, []);

  const getMaxForCell = useCallback((cat: 'WW' | 'PT' | 'QA', idx: number): number => {
    if (cat === 'WW') return Number(hpsData.wwScores[idx]?.maxScore ?? 0);
    if (cat === 'PT') return Number(hpsData.ptScores[idx]?.maxScore ?? 0);
    return Number(hpsData.qaMax ?? 0);
  }, [hpsData]);

  const isCellInvalid = useCallback((sid: string, cat: 'WW' | 'PT' | 'QA', idx: number): string | undefined => {
    return invalidCells[getCellKey(sid, cat, idx)];
  }, [invalidCells, getCellKey]);

  const openMetaEditor = useCallback((type: 'WW' | 'PT' | 'QA', index: number) => {
    setSelectedColumn({ type, number: index + 1 });
    if (type === 'WW') {
      setMetaEditorDraft({
        description: wwMeta[index]?.description || `WW ${index + 1}`,
        date: wwMeta[index]?.date || '',
      });
      return;
    }
    if (type === 'PT') {
      setMetaEditorDraft({
        description: ptMeta[index]?.description || `PT ${index + 1}`,
        date: ptMeta[index]?.date || '',
      });
      return;
    }
    setMetaEditorDraft({
      description: qaMeta.description || 'Term Assessment',
      date: qaMeta.date || '',
    });
  }, [wwMeta, ptMeta, qaMeta]);

  const saveColumnMeta = useCallback(async () => {
    if (!classAssignmentId || !selectedColumn) return;
    const nextWwMeta = [...wwMeta];
    const nextPtMeta = [...ptMeta];
    const nextQaMeta = { ...qaMeta };

    const index = selectedColumn.number - 1;

    if (selectedColumn.type === 'WW') {
      while (nextWwMeta.length <= index) {
        nextWwMeta.push({ description: `WW ${nextWwMeta.length + 1}`, date: '' });
      }
      nextWwMeta[index] = {
        description: metaEditorDraft.description || `WW ${selectedColumn.number}`,
        date: metaEditorDraft.date || '',
      };
    } else if (selectedColumn.type === 'PT') {
      while (nextPtMeta.length <= index) {
        nextPtMeta.push({ description: `PT ${nextPtMeta.length + 1}`, date: '' });
      }
      nextPtMeta[index] = {
        description: metaEditorDraft.description || `PT ${selectedColumn.number}`,
        date: metaEditorDraft.date || '',
      };
    } else {
      nextQaMeta.description = metaEditorDraft.description;
      nextQaMeta.date = metaEditorDraft.date;
    }

    setWwMeta(nextWwMeta);
    setPtMeta(nextPtMeta);
    setQaMeta(nextQaMeta);

    setSavingMeta(true);
    try {
      const updatePromises = classRecord.map((record) => {
        const grade = record.grades.find((g) => g.term === selectedTerm);
        const wwScores = applyMetaToScores([...(grade?.writtenWorkScores || []) as ScoreItem[]], 'WW', wwCount, nextWwMeta);
        const ptScores = applyMetaToScores([...(grade?.perfTaskScores || []) as ScoreItem[]], 'PT', ptCount, nextPtMeta);

        return gradesApi.saveGrade({
          studentId: record.student.id,
          classAssignmentId,
          term: selectedTerm,
          writtenWorkScores: wwScores,
          perfTaskScores: ptScores,
          qaDescription: nextQaMeta.description || undefined,
          qaDate: nextQaMeta.date || undefined,
        });
      });

      await Promise.all(updatePromises);
      setSuccess('Assessment metadata applied to the selected column');
      fetchClassRecord(true);
      setSelectedColumn(null);
    } catch (err: any) {
      console.error('Failed to save column metadata:', err);
      setError(err?.response?.data?.message || 'Failed to save assessment metadata');
      fetchClassRecord(true);
    } finally {
      setSavingMeta(false);
    }
  }, [classAssignmentId, selectedColumn, wwMeta, ptMeta, qaMeta, metaEditorDraft, classRecord, selectedTerm, applyMetaToScores, wwCount, ptCount, fetchClassRecord]);

  const applyColumnMetaFromMobile = async (
    category: 'WW' | 'PT' | 'QA',
    index: number,
    description: string,
    date: string,
  ) => {
    if (!classAssignmentId) return;

    const nextWwMeta = [...wwMeta];
    const nextPtMeta = [...ptMeta];
    const nextQaMeta = { ...qaMeta };

    if (category === 'WW') {
      while (nextWwMeta.length <= index) {
        nextWwMeta.push({ description: `WW ${nextWwMeta.length + 1}`, date: '' });
      }
      nextWwMeta[index] = {
        description: description || `WW ${index + 1}`,
        date: date || '',
      };
    } else if (category === 'PT') {
      while (nextPtMeta.length <= index) {
        nextPtMeta.push({ description: `PT ${nextPtMeta.length + 1}`, date: '' });
      }
      nextPtMeta[index] = {
        description: description || `PT ${index + 1}`,
        date: date || '',
      };
    } else {
      nextQaMeta.description = description;
      nextQaMeta.date = date;
    }

    setWwMeta(nextWwMeta);
    setPtMeta(nextPtMeta);
    setQaMeta(nextQaMeta);

    try {
      const updatePromises = classRecord.map((record) => {
        const grade = record.grades.find((g) => g.term === selectedTerm);
        const wwScores = applyMetaToScores([...(grade?.writtenWorkScores || []) as ScoreItem[]], 'WW', wwCount, nextWwMeta);
        const ptScores = applyMetaToScores([...(grade?.perfTaskScores || []) as ScoreItem[]], 'PT', ptCount, nextPtMeta);

        return gradesApi.saveGrade({
          studentId: record.student.id,
          classAssignmentId,
          term: selectedTerm,
          writtenWorkScores: wwScores,
          perfTaskScores: ptScores,
          qaDescription: nextQaMeta.description || undefined,
          qaDate: nextQaMeta.date || undefined,
        });
      });

      await Promise.all(updatePromises);
      setSuccess('Assessment metadata synced for the class');
      fetchClassRecord(true);
    } catch (err: any) {
      console.error('Failed to sync mobile column metadata:', err);
      setError(err?.response?.data?.message || 'Failed to sync assessment metadata');
      fetchClassRecord(true);
    }
  };

  const commitScoreInput = (
    inputEl: HTMLInputElement,
    studentId: string,
    category: 'WW' | 'PT' | 'QA',
    index: number,
  ): boolean => {
    const rawValue = inputEl.value.trim().toUpperCase();
    const isSpecial = rawValue === 'A' || rawValue === 'E';
    const key = getCellKey(studentId, category, index);
    const maxAllowed = getMaxForCell(category, index);

    if (isSpecial) {
      setInvalidCells((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      inputEl.dataset.prev = rawValue;
      handleScoreUpdate(studentId, category, index, rawValue as any);
      return true;
    }

    const parsed = rawValue === '' ? 0 : Number(rawValue);

    if (Number.isNaN(parsed) || parsed < 0 || parsed > maxAllowed) {
      const prevValue = inputEl.dataset.prev ?? '';
      inputEl.value = prevValue;
      setInvalidCells((prev) => ({ ...prev, [key]: `Score cannot exceed ${maxAllowed}.` }));
      setError(`${category} ${category === 'QA' ? '' : index + 1} score cannot exceed MAX (${maxAllowed}).`.trim());
      return false;
    }

    setInvalidCells((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    inputEl.dataset.prev = String(parsed);
    handleScoreUpdate(studentId, category, index, parsed);
    return true;
  };

  useEffect(() => {
    fetchClassRecord();
  }, [classAssignmentId, selectedTerm]);

  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  useEffect(() => {
    const node = ledgerHeaderRef.current;
    if (!node) {
      setLedgerHeaderHeight(0);
      return;
    }
    const update = () => setLedgerHeaderHeight(node.offsetHeight || 0);
    update();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(node);
    }
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [classAssignment?.id]);

  useEffect(() => {
    if (!showAssessmentDetails) {
      setAssessmentDetailsHeight(0);
      return;
    }
    const node = assessmentDetailsRef.current;
    if (!node) return;
    const update = () => setAssessmentDetailsHeight(node.offsetHeight || 0);
    update();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(node);
    }
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [showAssessmentDetails, wwCount, ptCount]);

  useEffect(() => {
    if (!selectedColumn) {
      setMetaEditorHeight(0);
      return;
    }
    const node = metaEditorRef.current;
    if (!node) return;
    const update = () => setMetaEditorHeight(node.offsetHeight || 0);
    update();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(node);
    }
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [selectedColumn]);


  const handleScoreUpdate = useCallback(async (
    studentId: string, 
    category: 'WW' | 'PT' | 'QA', 
    index: number, 
    newValue: number
  ) => {
    if (isViewOnly) return;
    await executeScoreUpdate({
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
    });
  }, [isViewOnly, classAssignmentId, classRecord, selectedTerm, qaMeta, getCellKey, getMaxForCell, applyMetaToScores, fetchClassRecord]);

  const handleHpsUpdate = useCallback(async (
    category: 'WW' | 'PT' | 'QA', 
    index: number, 
    newMax: number
  ) => {
    if (isViewOnly) return;
    await executeHpsUpdate({
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
      isViewOnly,
    });
  }, [isViewOnly, classAssignmentId, classRecord, selectedTerm, qaMeta, applyMetaToScores, fetchClassRecord]);

  const handleDescriptorUpdate = async (studentId: string, descriptor: string) => {
    if (isViewOnly) return;
    if (!classAssignmentId) return;
    try {
      setSavingDescriptorStudentId(studentId);
      await gradesApi.saveGrade({
        studentId,
        classAssignmentId,
        term: selectedTerm,
        qualitativeDescriptor: descriptor,
      });
      setSuccess('Descriptor saved');
      fetchClassRecord(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save descriptor');
    } finally {
      setSavingDescriptorStudentId(null);
    }
  };

  const addTask = useCallback(async (category: 'WW' | 'PT') => {
    if (isViewOnly) return;
    const targetIdx = category === 'WW' ? wwCount : ptCount;
    if (category === 'WW') {
      setWwMeta((prev) => [...prev, { description: `WW ${targetIdx + 1}`, date: '' }]);
    } else {
      setPtMeta((prev) => [...prev, { description: `PT ${targetIdx + 1}`, date: '' }]);
    }
    handleHpsUpdate(category, targetIdx, 10);
  }, [isViewOnly, wwCount, ptCount, handleHpsUpdate]);

  const removeTask = useCallback(async (category: 'WW' | 'PT') => {
    if (isViewOnly) return;
    await executeRemoveTask({
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
    });
  }, [isViewOnly, classAssignmentId, classRecord, selectedTerm, wwCount, ptCount, qaMeta, applyMetaToScores, fetchClassRecord]);

  const sortedRecords = useMemo(
    () =>
      [...classRecord].sort((a, b) => {
        const nameA = `${a.student.lastName}, ${a.student.firstName}`.toLowerCase();
        const nameB = `${b.student.lastName}, ${b.student.firstName}`.toLowerCase();
        return nameA.localeCompare(nameB);
      }),
    [classRecord]
  );

  const saveAssessmentDetails = useCallback(async () => {
    if (isViewOnly) return;
    if (!classAssignmentId) return;

    try {
      const updatePromises = classRecord.map((record) => {
        const grade = record.grades.find((g) => g.term === selectedTerm);
        const wwScores = applyMetaToScores([...(grade?.writtenWorkScores || []) as ScoreItem[]], 'WW', wwCount);
        const ptScores = applyMetaToScores([...(grade?.perfTaskScores || []) as ScoreItem[]], 'PT', ptCount);

        return gradesApi.saveGrade({
          studentId: record.student.id,
          classAssignmentId,
          term: selectedTerm,
          writtenWorkScores: wwScores,
          perfTaskScores: ptScores,
          qaDescription: qaMeta.description || undefined,
          qaDate: qaMeta.date || undefined,
        });
      });

      if (updatePromises.length === 0) {
        setSuccess('No learners to update yet.');
        return;
      }

      await Promise.all(updatePromises);
      setSuccess('Assessment details saved');
      fetchClassRecord(true);
    } catch (err: any) {
      console.error('Failed to save assessment details:', err);
      setError(err?.response?.data?.message || 'Failed to save assessment details');
    }
  }, [isViewOnly, classAssignmentId, classRecord, selectedTerm, applyMetaToScores, wwCount, ptCount, qaMeta, fetchClassRecord]);

  const handleClearScores = useCallback(async () => {
    if (isViewOnly) return;
    if (!classAssignmentId) return;
    try {
      setLoading(true);
      await gradesApi.clearScores(classAssignmentId, selectedTerm);
      setSuccess("Successfully cleared all scores for the current term.");
      await fetchClassRecord();
    } catch (err: any) {
      console.error("Failed to clear scores:", err);
      setError(err?.response?.data?.message || "Failed to clear scores");
      await fetchClassRecord();
    } finally {
      setLoading(false);
    }
  }, [isViewOnly, classAssignmentId, selectedTerm, fetchClassRecord]);

  const maleRecords = useMemo(() => sortedRecords.filter(r => r.student.gender?.toLowerCase() === 'male'), [sortedRecords]);
  const femaleRecords = useMemo(() => sortedRecords.filter(r => r.student.gender?.toLowerCase() === 'female'), [sortedRecords]);

  const activeWeights = useMemo(() => ({
    ww: effectiveWeights?.ww ?? classAssignment?.subject?.writtenWorkWeight ?? 0,
    pt: effectiveWeights?.pt ?? classAssignment?.subject?.perfTaskWeight ?? 0,
    qa: effectiveWeights?.qa ?? classAssignment?.subject?.quarterlyAssessWeight ?? 0,
  }), [effectiveWeights, classAssignment?.subject?.writtenWorkWeight, classAssignment?.subject?.perfTaskWeight, classAssignment?.subject?.quarterlyAssessWeight]);

  const getDisplayFinalGrade = useCallback((record: ClassRecord): number | null =>
    computeDisplayFinalGrade(record, selectedTerm, activeWeights), [selectedTerm, activeWeights]);

  const stats = useMemo(() => {
    if (classRecord.length === 0) return null;
    const grades = classRecord
      .map((record) => getDisplayFinalGrade(record))
      .filter((g): g is number => g !== undefined && g !== null);
    if (grades.length === 0) return { avg: 0, passed: 0, highest: 0, lowest: 0 };
    return {
      avg: grades.reduce((a, b) => a + b, 0) / grades.length,
      passed: grades.filter((g) => g >= 75).length,
      highest: Math.max(...grades),
      lowest: Math.min(...grades),
    };
  }, [classRecord, selectedTerm, activeWeights]);

  const openMobileEditor = (studentId: string) => {
    if (isViewOnly) return;
    setMobileEditorStudentId(studentId);
    setMobileEditorOpen(true);
    setMobileScoreDraft({});
    setMobileEditorTab(isHGClass ? 'HG' : 'WW');
  };

  const selectedMobileRecord = useMemo(
    () => sortedRecords.find((record) => record.student.id === mobileEditorStudentId) ?? null,
    [sortedRecords, mobileEditorStudentId]
  );

  const handleMobileDraftChange = (
    studentId: string,
    category: 'WW' | 'PT' | 'QA',
    index: number,
    value: string,
  ) => {
    if (isViewOnly) return;
    const key = getMobileDraftKey(studentId, category, index);
    if (value === '') {
      setMobileScoreDraft((prev) => ({ ...prev, [key]: '' }));
      return;
    }

    const parsed = Number(value);
    const maxAllowed = getMaxForCell(category, index);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > maxAllowed) {
      setMobileScoreDraft((prev) => ({ ...prev, [key]: '' }));
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
  };

  const commitMobileScore = (
    record: ClassRecord,
    category: 'WW' | 'PT' | 'QA',
    index: number,
  ) => {
    if (isViewOnly) return;
    const key = getMobileDraftKey(record.student.id, category, index);
    const value = mobileScoreDraft[key] ?? computeScoreFromGrade(record, selectedTerm, category, index);
    const normalized = value.trim() === '' ? 0 : Number(value);
    const maxAllowed = getMaxForCell(category, index);

    if (Number.isNaN(normalized) || normalized < 0 || normalized > maxAllowed) {
      setMobileScoreDraft((prev) => ({ ...prev, [key]: '' }));
      setError(`${category} ${category === 'QA' ? '' : index + 1} score cannot exceed MAX (${maxAllowed}).`.trim());
      setInvalidCells((prev) => ({ ...prev, [getCellKey(record.student.id, category, index)]: `Score cannot exceed ${maxAllowed}.` }));
      return;
    }

    setMobileScoreDraft((prev) => ({ ...prev, [key]: normalized === 0 ? '' : String(normalized) }));
    handleScoreUpdate(record.student.id, category, index, normalized);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-20 h-20 bg-indigo-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-sm">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
          </div>
          <p className="text-slate-500 font-black text-xs uppercase tracking-widest">Fetching Class Records...</p>
        </div>
      </div>
    );
  }

  if (!classAssignment) return null;
  const topNavHeight = 64;
  // metaEditorTop: where the quick-column editor sticks (below top nav + ledger card header)
  const metaEditorTop = topNavHeight + Math.ceil(ledgerHeaderHeight);
  // assessmentDetailsTop: below the meta editor (if open)
  const metaEditorOffset = selectedColumn ? Math.ceil(metaEditorHeight) : 0;
  const assessmentDetailsTop = metaEditorTop + metaEditorOffset;
  // stickyOffset: total px above the table column headers — passed to ClassRecordTable
  // ClassRecordTable internally adds its own group-row and sub-row heights for the HPS row.
  const assessmentPanelOffset = showAssessmentDetails ? Math.ceil(assessmentDetailsHeight) : 0;
  const stickyOffset = assessmentDetailsTop + assessmentPanelOffset;

  return (
    <div className="space-y-8 animate-fade-in w-full px-6 pb-12">
      {/* Toast Messages */}
      {(error || success) && (
        <div className={`fixed top-20 right-6 z-[100] flex items-center gap-4 px-6 py-4 rounded-[1.5rem] shadow-2xl border-0 animate-slide-in-right ${error ? "bg-rose-500 text-white" : "bg-emerald-500 text-white"}`}>
          {error ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
          <span className="text-sm font-black uppercase tracking-widest">{error || success}</span>
          <button onClick={() => { setError(''); setSuccess(''); }} className="ml-4 p-1 hover:bg-white/20 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>
      )}

      <ClassRecordHero
        classAssignment={classAssignment}
        isHGClass={isHGClass}
        effectiveWeightsSource={effectiveWeights?.source ?? null}
        onStartTour={() => {
          // Check if on mobile or tablet
          const isMobileOrTablet = window.innerWidth < 1024;
          if (isMobileOrTablet) {
            setShowMobileWarning(true);
          } else {
            setIsTourOpen(true);
            window.dispatchEvent(new Event("tour:start"));
          }
        }}
      />

      {/* Grade Status Banner */}
      <GradeStatusBanner
        currentTerm={currentTerm}
        selectedTerm={selectedTerm}
        termEndDate={currentTerm === "T1" ? termDates?.t1EndDate : currentTerm === "T2" ? termDates?.t2EndDate : termDates?.t3EndDate}
        gradeLock={gradeLock}
        colors={colors}
        editRequestStatus={isPastTerm ? editRequestStatus : "idle"}
        editTimeRemaining={editTimeRemaining}
        onRequestEdit={isPastTerm && !gradeLock && editRequestStatus === "idle" ? () => setEditRequestModalOpen(true) : undefined}
        termLabels={termLabels}
      />

      {isHGClass && (
        <>
          <ClassRecordMobileList
            records={sortedRecords}
            selectedTerm={selectedTerm}
            isHGClass
            onTermChange={setSelectedTerm}
            onOpenEditor={openMobileEditor}
            getDisplayFinalGrade={getDisplayFinalGrade}
            getGradeColor={getGradeColor}
            isViewOnly={isViewOnly}
          />
          <HGDescriptorPanel
            records={sortedRecords}
            selectedTerm={selectedTerm}
            onTermChange={setSelectedTerm}
            savingDescriptorStudentId={savingDescriptorStudentId}
            descriptors={HG_DESCRIPTORS}
            onDescriptorUpdate={handleDescriptorUpdate}
            isViewOnly={isViewOnly}
          />
        </>
      )}

      {/* Analytics Insights */}
      {!isHGClass && stats && (
        <ClassRecordStats
          avg={stats.avg}
          passed={stats.passed}
          total={classRecord.length}
          highest={stats.highest}
        />
      )}

      {/* Main Ledger Table */}
      {!isHGClass && (
        <>
          <ClassRecordMobileList
            records={sortedRecords}
            selectedTerm={selectedTerm}
            isHGClass={false}
            onTermChange={setSelectedTerm}
            onOpenEditor={openMobileEditor}
            getDisplayFinalGrade={getDisplayFinalGrade}
            getGradeColor={getGradeColor}
            isViewOnly={isViewOnly}
          />

          <ClassRecordTable
            classAssignment={classAssignment}
            effectiveWeights={effectiveWeights}
            selectedTerm={selectedTerm}
            onTermChange={setSelectedTerm}
            lockedTerm={lockedTerm}
            currentTerm={currentTerm}
            isViewOnly={isViewOnly}
            separateByGender={separateByGender}
            onSeparateByGenderChange={setSeparateByGender}
            showAssessmentDetails={showAssessmentDetails}
            onToggleAssessmentDetails={() => setShowAssessmentDetails((prev) => !prev)}
            onClearScores={handleClearScores}
            ledgerHeaderRef={ledgerHeaderRef}
            topNavHeight={topNavHeight}
            ledgerHeaderHeight={Math.ceil(ledgerHeaderHeight)}
            stickyOffset={stickyOffset}
            wwCount={wwCount}
            ptCount={ptCount}
            hpsData={hpsData}
            sortedRecords={sortedRecords}
            maleRecords={maleRecords}
            femaleRecords={femaleRecords}
            onRemoveTask={removeTask}
            onAddTask={addTask}
            onHpsUpdate={handleHpsUpdate}
            onScoreCommit={commitScoreInput}
            onCellFocus={openMetaEditor}
            isCellInvalid={isCellInvalid}
            assessmentHeaderNode={
              <AssessmentHeader
                showAssessmentDetails={showAssessmentDetails}
                assessmentDetailsRef={assessmentDetailsRef}
                metaEditorRef={metaEditorRef}
                wwCount={wwCount}
                ptCount={ptCount}
                wwMeta={wwMeta}
                ptMeta={ptMeta}
                qaMeta={qaMeta}
                setWwMeta={setWwMeta}
                setPtMeta={setPtMeta}
                setQaMeta={setQaMeta}
                saveAssessmentDetails={saveAssessmentDetails}
                savingMeta={savingMeta}
                selectedColumn={selectedColumn}
                setSelectedColumn={setSelectedColumn}
                metaEditorDraft={metaEditorDraft}
                setMetaEditorDraft={setMetaEditorDraft}
                saveColumnMeta={saveColumnMeta}
                isViewOnly={isViewOnly}
              />
            }
          />
        </>
      )}

      <GradeEditModal
        open={mobileEditorOpen}
        onOpenChange={(open) => {
          setMobileEditorOpen(open);
          if (!open) {
            setMobileEditorStudentId(null);
            setMobileScoreDraft({});
          }
        }}
        selectedRecord={selectedMobileRecord}
        isHGClass={isHGClass}
        selectedTerm={selectedTerm}
        hgDescriptors={HG_DESCRIPTORS}
        mobileEditorTab={mobileEditorTab}
        onTabChange={setMobileEditorTab}
        wwCount={wwCount}
        ptCount={ptCount}
        wwMeta={wwMeta}
        ptMeta={ptMeta}
        qaMeta={qaMeta}
        mobileScoreDraft={mobileScoreDraft}
        invalidCells={invalidCells}
        getCellKey={getCellKey}
        getMobileDraftKey={getMobileDraftKey}
        getScoreFromGrade={(record, category, index) => computeScoreFromGrade(record, selectedTerm, category, index)}
        getMaxForCell={getMaxForCell}
        onMobileScoreDraftChange={handleMobileDraftChange}
        onMobileScoreCommit={commitMobileScore}
        onDescriptorUpdate={handleDescriptorUpdate}
        onApplyColumnMeta={applyColumnMetaFromMobile}
        isViewOnly={isViewOnly}
      />

      <ClassRecordTour
        isOpen={isTourOpen}
        onClose={() => {
          setIsTourOpen(false);
          setShowAssessmentDetails(false);
          setSelectedColumn(null);
          window.dispatchEvent(new Event("tour:end"));
        }}
        setShowAssessmentDetails={setShowAssessmentDetails}
        setSelectedColumn={setSelectedColumn}
      />

      {/* Mobile/Tablet Tutorial Warning Dialog */}
      <Dialog open={showMobileWarning} onOpenChange={setShowMobileWarning}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="p-2 bg-amber-100 rounded-xl">
                <Monitor className="w-5 h-5 text-amber-600" />
              </div>
              Desktop Recommended
            </DialogTitle>
            <DialogDescription className="text-slate-600 pt-2">
              The interactive tutorial is optimized for desktop screens (1024px and wider).
              For the best experience, we recommend using a laptop or desktop computer
              the first time you go through the tutorial.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 my-2">
            <p className="text-sm text-amber-800 font-medium">
              <strong>Why desktop?</strong> The tutorial highlights specific UI elements
              and may not display correctly on smaller screens.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              onClick={() => setShowMobileWarning(false)}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Got it, I'll use Desktop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Access Request Modal */}
      <EditRequestModal
        open={editRequestModalOpen}
        onOpenChange={setEditRequestModalOpen}
        onSuccess={() => {
          setEditRequestStatus("pending");
        }}
        selectedTerm={selectedTerm}
        classAssignment={classAssignment}
        userName={userName}
      />
    </div>
  );
}
