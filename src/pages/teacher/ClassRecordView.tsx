import React, { useEffect, useState, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  X,
} from "lucide-react";
import {
  gradesApi,
  SERVER_URL,
  type ClassAssignment,
  type ClassRecord,
  type ScoreItem,
} from "@/lib/api";
import { ClassRecordTable } from "./components/ClassRecordTable";
import { ClassRecordMobileList } from "./components/ClassRecordMobileList";
import { GradeEditModal } from "./components/GradeEditModal";
import { AssessmentHeader } from "./components/AssessmentHeader";
import { ClassRecordHero } from "./components/ClassRecordHero";
import { ClassRecordStats } from "./components/ClassRecordStats";
import { EcrGenerationDialog } from "./components/EcrGenerationDialog";
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
  const [classAssignment, setClassAssignment] = useState<ClassAssignment | null>(null);
  const [classRecord, setClassRecord] = useState<ClassRecord[]>([]);
  const [effectiveWeights, setEffectiveWeights] = useState<{
    ww: number;
    pt: number;
    qa: number;
    source: "subject" | "generic-fallback";
    hasExactEcrTemplate: boolean;
  } | null>(null);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("Q1");
  const [quarterInitialized, setQuarterInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingDescriptorStudentId, setSavingDescriptorStudentId] = useState<string | null>(null);
  const [showAssessmentDetails, setShowAssessmentDetails] = useState(false);
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

  const [separateByGender, setSeparateByGender] = useState(false);
  const ecrFileInputRef = useRef<HTMLInputElement>(null);
  const isHGClass = (classAssignment?.subject?.code ?? '').startsWith('HG');
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
      const grade = r.grades.find(g => g.quarter === selectedQuarter);
      if (grade?.writtenWorkScores) max = Math.max(max, (grade.writtenWorkScores as any[]).length);
    });
    return max;
  }, [classRecord, selectedQuarter]);

  const ptCount = useMemo(() => {
    let max = 1;
    classRecord.forEach(r => {
      const grade = r.grades.find(g => g.quarter === selectedQuarter);
      if (grade?.perfTaskScores) max = Math.max(max, (grade.perfTaskScores as any[]).length);
    });
    return max;
  }, [classRecord, selectedQuarter]);

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
      const grade = record.grades.find((g) => g.quarter === selectedQuarter);
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
  }, [classRecord, selectedQuarter, wwCount, ptCount]);

  useEffect(() => {
    const gradeSamples = classRecord
      .map((record) => record.grades.find((g) => g.quarter === selectedQuarter))
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
  }, [classRecord, selectedQuarter, wwCount, ptCount]);

  const applyMetaToScores = (
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
  };

  const getCellKey = (sid: string, cat: 'WW' | 'PT' | 'QA', idx: number) => `${sid}:${cat}:${idx}`;

  const getMaxForCell = (cat: 'WW' | 'PT' | 'QA', idx: number): number => {
    if (cat === 'WW') return Number(hpsData.wwScores[idx]?.maxScore ?? 0);
    if (cat === 'PT') return Number(hpsData.ptScores[idx]?.maxScore ?? 0);
    return Number(hpsData.qaMax ?? 0);
  };

  const openMetaEditor = (type: 'WW' | 'PT' | 'QA', index: number) => {
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
      description: qaMeta.description || 'Quarterly Assessment',
      date: qaMeta.date || '',
    });
  };

  const saveColumnMeta = async () => {
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
        const grade = record.grades.find((g) => g.quarter === selectedQuarter);
        const wwScores = applyMetaToScores([...(grade?.writtenWorkScores || []) as ScoreItem[]], 'WW', wwCount, nextWwMeta);
        const ptScores = applyMetaToScores([...(grade?.perfTaskScores || []) as ScoreItem[]], 'PT', ptCount, nextPtMeta);

        return gradesApi.saveGrade({
          studentId: record.student.id,
          classAssignmentId,
          quarter: selectedQuarter,
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
  };

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
        const grade = record.grades.find((g) => g.quarter === selectedQuarter);
        const wwScores = applyMetaToScores([...(grade?.writtenWorkScores || []) as ScoreItem[]], 'WW', wwCount, nextWwMeta);
        const ptScores = applyMetaToScores([...(grade?.perfTaskScores || []) as ScoreItem[]], 'PT', ptCount, nextPtMeta);

        return gradesApi.saveGrade({
          studentId: record.student.id,
          classAssignmentId,
          quarter: selectedQuarter,
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

  const isCellInvalid = (sid: string, cat: 'WW' | 'PT' | 'QA', idx: number) => Boolean(invalidCells[getCellKey(sid, cat, idx)]);

  const commitScoreInput = (
    inputEl: HTMLInputElement,
    studentId: string,
    category: 'WW' | 'PT' | 'QA',
    index: number,
  ): boolean => {
    const rawValue = inputEl.value;
    const parsed = rawValue === '' ? 0 : Number(rawValue);
    const key = getCellKey(studentId, category, index);
    const maxAllowed = getMaxForCell(category, index);

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
  }, [classAssignmentId, selectedQuarter]);

  useEffect(() => {
    if (classAssignmentId && !isHGClass) {
      fetchEcrStatus();
    }
  }, [classAssignmentId, isHGClass]);

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


  const fetchClassRecord = async (silent = false) => {
    if (!classAssignmentId) return;
    try {
      if (!silent) setLoading(true);
      const response = await gradesApi.getClassRecord(classAssignmentId, selectedQuarter);

      // Align initial quarter to system current quarter to avoid saving/viewing grades in the wrong quarter.
      if (!quarterInitialized && response.data.currentQuarter) {
        setQuarterInitialized(true);
        if (response.data.currentQuarter !== selectedQuarter) {
          setSelectedQuarter(response.data.currentQuarter);
          return;
        }
      }

      setClassAssignment(response.data.classAssignment);
      setClassRecord(response.data.classRecord);
      setEffectiveWeights(response.data.effectiveWeights ?? null);
    } catch (err) {
      console.error("Failed to fetch class record:", err);
      if (!silent) setError("Failed to load class record");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchEcrStatus = async () => {
    if (!classAssignmentId) return;
    try {
      await gradesApi.getEcrStatus(classAssignmentId);
    } catch (err) {
      console.error("Failed to fetch ECR status:", err);
    }
  };

  const handleEcrFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleEcrImport(file);
    }
  };

  const handleEcrImport = async (file: File) => {
    if (!classAssignmentId) return;
    try {
      const response = await gradesApi.importEcr(classAssignmentId, file);
      setSuccess(`Successfully imported ${response.data.importedGrades} grades from ECR.`);
      fetchClassRecord();
    } catch (err: any) {
      console.error("Failed to import ECR:", err);
      setError(err.response?.data?.message || "Failed to import ECR grades");
    }
  };

  const handleScoreUpdate = async (
    studentId: string, 
    category: 'WW' | 'PT' | 'QA', 
    index: number, 
    newValue: number
  ) => {
    await executeScoreUpdate({
      classAssignmentId,
      classRecord,
      selectedQuarter,
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
    });
  };

  const handleHpsUpdate = async (
    category: 'WW' | 'PT' | 'QA', 
    index: number, 
    newMax: number
  ) => {
    await executeHpsUpdate({
      classAssignmentId,
      classRecord,
      selectedQuarter,
      category,
      index,
      newMax,
      qaMeta,
      applyMetaToScores,
      setClassRecord,
      setError,
      fetchClassRecord,
    });
  };

  const handleDescriptorUpdate = async (studentId: string, descriptor: string) => {
    if (!classAssignmentId) return;
    try {
      setSavingDescriptorStudentId(studentId);
      await gradesApi.saveGrade({
        studentId,
        classAssignmentId,
        quarter: selectedQuarter,
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

  const addTask = async (category: 'WW' | 'PT') => {
    const targetIdx = category === 'WW' ? wwCount : ptCount;
    if (category === 'WW') {
      setWwMeta((prev) => [...prev, { description: `WW ${targetIdx + 1}`, date: '' }]);
    } else {
      setPtMeta((prev) => [...prev, { description: `PT ${targetIdx + 1}`, date: '' }]);
    }
    handleHpsUpdate(category, targetIdx, 10);
  };

  const removeTask = async (category: 'WW' | 'PT') => {
    await executeRemoveTask({
      classAssignmentId,
      classRecord,
      selectedQuarter,
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
    });
  };

  const stats = useMemo(() => {
    if (classRecord.length === 0) return null;
    const grades = classRecord
      .map((r) => r.grades.find((g) => g.quarter === selectedQuarter)?.quarterlyGrade)
      .filter((g): g is number => g !== undefined && g !== null);
    if (grades.length === 0) return { avg: 0, passed: 0, highest: 0, lowest: 0 };
    return {
      avg: grades.reduce((a, b) => a + b, 0) / grades.length,
      passed: grades.filter((g) => g >= 75).length,
      highest: Math.max(...grades),
      lowest: Math.min(...grades),
    };
  }, [classRecord, selectedQuarter]);

  const sortedRecords = useMemo(
    () =>
      [...classRecord].sort((a, b) => {
        const nameA = `${a.student.lastName}, ${a.student.firstName}`.toLowerCase();
        const nameB = `${b.student.lastName}, ${b.student.firstName}`.toLowerCase();
        return nameA.localeCompare(nameB);
      }),
    [classRecord]
  );

  const saveAssessmentDetails = async () => {
    if (!classAssignmentId) return;

    try {
      const updatePromises = classRecord.map((record) => {
        const grade = record.grades.find((g) => g.quarter === selectedQuarter);
        const wwScores = applyMetaToScores([...(grade?.writtenWorkScores || []) as ScoreItem[]], 'WW', wwCount);
        const ptScores = applyMetaToScores([...(grade?.perfTaskScores || []) as ScoreItem[]], 'PT', ptCount);

        return gradesApi.saveGrade({
          studentId: record.student.id,
          classAssignmentId,
          quarter: selectedQuarter,
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
  };

  const handleClearScores = async () => {
    if (!classAssignmentId) return;
    try {
      setLoading(true);
      await gradesApi.clearScores(classAssignmentId, selectedQuarter);
      setSuccess("Successfully cleared all scores for the current quarter.");
      await fetchClassRecord();
    } catch (err: any) {
      console.error("Failed to clear scores:", err);
      setError(err?.response?.data?.message || "Failed to clear scores");
      await fetchClassRecord();
    } finally {
      setLoading(false);
    }
  };

  const maleRecords = useMemo(() => sortedRecords.filter(r => r.student.gender?.toLowerCase() === 'male'), [sortedRecords]);
  const femaleRecords = useMemo(() => sortedRecords.filter(r => r.student.gender?.toLowerCase() === 'female'), [sortedRecords]);

  const activeWeights = useMemo(() => ({
    ww: effectiveWeights?.ww ?? classAssignment?.subject?.writtenWorkWeight ?? 0,
    pt: effectiveWeights?.pt ?? classAssignment?.subject?.perfTaskWeight ?? 0,
    qa: effectiveWeights?.qa ?? classAssignment?.subject?.quarterlyAssessWeight ?? 0,
  }), [effectiveWeights, classAssignment?.subject?.writtenWorkWeight, classAssignment?.subject?.perfTaskWeight, classAssignment?.subject?.quarterlyAssessWeight]);

  const getDisplayFinalGrade = (record: ClassRecord): number | null =>
    computeDisplayFinalGrade(record, selectedQuarter, activeWeights);

  const openMobileEditor = (studentId: string) => {
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
    const key = getMobileDraftKey(record.student.id, category, index);
    const value = mobileScoreDraft[key] ?? computeScoreFromGrade(record, selectedQuarter, category, index);
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

  const [ecrProgress, setEcrProgress] = useState<string>('');
  const [ecrPercentage, setEcrPercentage] = useState<number>(0);
  const [showEcrGenerationDialog, setShowEcrGenerationDialog] = useState(false);
  
  const downloadECR = async () => {
    if (!classAssignment) return;
    try {
      setShowEcrGenerationDialog(true);
      setEcrPercentage(0);
      setEcrProgress('Initializing compilation...');
      setEcrPercentage(20);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const token = sessionStorage.getItem("token");
      const response = await fetch(`${SERVER_URL}/api/ecr-templates/generate/${classAssignment.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quarter: selectedQuarter }),
      });

      if (!response.ok) throw new Error('Failed to generate ECR');
      
      setEcrPercentage(60);
      setEcrProgress('Injecting records...');
      const blob = await response.blob();
      
      setEcrPercentage(90);
      setEcrProgress('Finalizing workbook...');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `ECR_${classAssignment.subject.name}_${classAssignment.section.name}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      setEcrPercentage(100);
      setEcrProgress('Download started!');
      setTimeout(() => setShowEcrGenerationDialog(false), 1500);
    } catch (error: any) {
      setError(error.message);
      setShowEcrGenerationDialog(false);
    }
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
        onExportEcr={downloadECR}
        onOpenImport={() => ecrFileInputRef.current?.click()}
        onImportSelect={handleEcrFileSelect}
        fileInputRef={ecrFileInputRef}
      />

      {isHGClass && (
        <>
          <ClassRecordMobileList
            records={sortedRecords}
            selectedQuarter={selectedQuarter}
            isHGClass
            onQuarterChange={setSelectedQuarter}
            onOpenEditor={openMobileEditor}
            getDisplayFinalGrade={getDisplayFinalGrade}
            getGradeColor={getGradeColor}
          />
          <HGDescriptorPanel
            records={sortedRecords}
            selectedQuarter={selectedQuarter}
            onQuarterChange={setSelectedQuarter}
            savingDescriptorStudentId={savingDescriptorStudentId}
            descriptors={HG_DESCRIPTORS}
            onDescriptorUpdate={handleDescriptorUpdate}
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
            selectedQuarter={selectedQuarter}
            isHGClass={false}
            onQuarterChange={setSelectedQuarter}
            onOpenEditor={openMobileEditor}
            getDisplayFinalGrade={getDisplayFinalGrade}
            getGradeColor={getGradeColor}
          />

          <ClassRecordTable
            classAssignment={classAssignment}
            effectiveWeights={effectiveWeights}
            selectedQuarter={selectedQuarter}
            onQuarterChange={setSelectedQuarter}
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
                metaEditorTop={metaEditorTop}
                assessmentDetailsTop={assessmentDetailsTop}
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
        selectedQuarter={selectedQuarter}
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
        getScoreFromGrade={(record, category, index) => computeScoreFromGrade(record, selectedQuarter, category, index)}
        getMaxForCell={getMaxForCell}
        onMobileScoreDraftChange={handleMobileDraftChange}
        onMobileScoreCommit={commitMobileScore}
        onDescriptorUpdate={handleDescriptorUpdate}
        onApplyColumnMeta={applyColumnMetaFromMobile}
      />

      <EcrGenerationDialog
        open={showEcrGenerationDialog}
        percentage={ecrPercentage}
        progress={ecrProgress}
      />
    </div>
  );
}
