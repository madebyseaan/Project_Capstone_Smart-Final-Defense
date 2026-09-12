import React, { useRef, useState, useEffect, useMemo } from "react";
import { Plus, Minus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClassAssignment, ClassRecord, ScoreItem, AimsAssessmentInfo, AimsRowScore } from "@/lib/api";
import type { TransmutationRow } from "@/lib/gradeMath";

import { LedgerRow } from "./ledger/LedgerRow";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ClassRecordTableProps {
  classAssignment: ClassAssignment;
  effectiveWeights: {
    ww: number;
    pt: number;
    qa: number;
  } | null;
  selectedTerm: string;
  /** View-only mode — past terms or locked grades */
  isViewOnly?: boolean;
  separateByGender: boolean;
  onSeparateByGenderChange: (value: boolean) => void;
  showAssessmentDetails: boolean;
  onToggleAssessmentDetails: () => void;
  /** px height of the top nav bar */
  topNavHeight: number;
  ledgerHeaderHeight: number;
  stickyOffset: number;
  wwCount: number;
  ptCount: number;
  hpsData: { wwScores: ScoreItem[]; ptScores: ScoreItem[]; qaMax: number; examMaxes: number[] };
  sortedRecords: ClassRecord[];
  maleRecords: ClassRecord[];
  femaleRecords: ClassRecord[];
  onRemoveTask: (category: "WW" | "PT") => void;
  onAddTask: (category: "WW" | "PT") => void;
  onHpsUpdate: (cat: "WW" | "PT" | "QA" | "EX", idx: number, val: number) => void;
  onScoreCommit: (inputEl: HTMLInputElement, sid: string, cat: "WW" | "PT" | "QA" | "EX", idx: number) => boolean;
  onCellFocus: (cat: "WW" | "PT" | "QA" | "EX", idx: number) => void;
  isCellInvalid: (sid: string, cat: "WW" | "PT" | "QA" | "EX", idx: number) => string | undefined;
  assessmentHeaderNode?: React.ReactNode;
  ledgerHeaderRef?: React.RefObject<HTMLDivElement | null>;
  onClearScores?: () => void;
  transmutationTable?: TransmutationRow[];
  aimsAssessments?: AimsAssessmentInfo[];
  aimsByStudent?: Record<string, Record<string, AimsRowScore>>;
  aimsAllAssessments?: AimsAssessmentInfo[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClassRecordTable({
  classAssignment,
  effectiveWeights,
  selectedTerm,
  isViewOnly,
  separateByGender,
  onSeparateByGenderChange,
  showAssessmentDetails,
  onToggleAssessmentDetails,
  topNavHeight,
  ledgerHeaderHeight: _ledgerHeaderHeight,
  stickyOffset: _stickyOffset,
  wwCount,
  ptCount,
  hpsData,
  sortedRecords,
  maleRecords,
  femaleRecords,
  onRemoveTask,
  onAddTask,
  onHpsUpdate,
  onScoreCommit,
  onCellFocus,
  isCellInvalid,
  assessmentHeaderNode,
  ledgerHeaderRef,
  onClearScores,
  transmutationTable,
  aimsAssessments = [],
  aimsByStudent = {},
}: ClassRecordTableProps) {
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);

  const [confirmingClear, setConfirmingClear] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClearClick = () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      clearTimerRef.current = setTimeout(() => {
        setConfirmingClear(false);
      }, 4000);
    } else {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      setConfirmingClear(false);
      onClearScores?.();
    }
  };

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const handleBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // ── Measure header rows for nested sticky within the scroll container ────
  const groupRowRef = useRef<HTMLTableRowElement | null>(null);
  const subRowRef = useRef<HTMLTableRowElement | null>(null);
  const [_groupRowH, setGroupRowH] = useState(36);
  const [_subRowH, setSubRowH] = useState(36);

  useEffect(() => {
    const nodes = [groupRowRef.current, subRowRef.current];
    const setters = [setGroupRowH, setSubRowH];

    const observers = nodes.map((node, i) => {
      if (!node) return null;
      const update = () => setters[i](node.offsetHeight || 36);
      update();
      if (typeof ResizeObserver === "undefined") return null;
      const obs = new ResizeObserver(update);
      obs.observe(node);
      return obs;
    });

    return () => observers.forEach((o) => o?.disconnect());
  }, [wwCount, ptCount]);

  const weights = {
    ww: effectiveWeights?.ww ?? classAssignment.subject.writtenWorkWeight,
    pt: effectiveWeights?.pt ?? classAssignment.subject.perfTaskWeight,
    qa: effectiveWeights?.qa ?? classAssignment.subject.quarterlyAssessWeight,
  };

  // Phase 7: Partition visible AIMS assessments by category
  const aimsWW = aimsAssessments.filter(a => a.category === 'WW');
  const aimsPT = aimsAssessments.filter(a => a.category === 'PT');
  const aimsQA = aimsAssessments.filter(a => a.category === 'QA');

  // Phase 7: Derive per-column isAims flags from ALL grades for the selected term
  const gradeList = useMemo(() =>
    sortedRecords.map(r => r.grades.find(g => g.term === selectedTerm)).filter(Boolean),
    [sortedRecords, selectedTerm]
  );
  const wwColIsAims = useMemo(() =>
    Array.from({ length: wwCount }, (_, i) =>
      gradeList.some(g => (g?.writtenWorkScores as any[])?.[i]?.isAims)
    ),
    [gradeList, wwCount]
  );
  const ptColIsAims = useMemo(() =>
    Array.from({ length: ptCount }, (_, i) =>
      gradeList.some(g => (g?.perfTaskScores as any[])?.[i]?.isAims)
    ),
    [gradeList, ptCount]
  );

  // Per-column AIMS titles for tooltips on ledger numbered headers
  const wwColAimsTitle = useMemo(() =>
    Array.from({ length: wwCount }, (_, i) => {
      const item = gradeList.find(g => (g?.writtenWorkScores as any[])?.[i]?.isAims);
      return ((item?.writtenWorkScores as any[])?.[i]?.name as string) || undefined;
    }),
    [gradeList, wwCount]
  );
  const ptColAimsTitle = useMemo(() =>
    Array.from({ length: ptCount }, (_, i) => {
      const item = gradeList.find(g => (g?.perfTaskScores as any[])?.[i]?.isAims);
      return ((item?.perfTaskScores as any[])?.[i]?.name as string) || undefined;
    }),
    [gradeList, ptCount]
  );

  const aimsDistributedCount = aimsWW.length + aimsPT.length + aimsQA.length;
  const tableRows = useMemo(() => {
    const rows: React.ReactNode[] = [];
    let rowCounter = 0;

    if (separateByGender) {
      if (maleRecords.length > 0) {
        rows.push(
          <TableRow key="male-sep" className="bg-blue-50/60 hover:bg-blue-50/60 border-y border-blue-100/60 h-7">
            <TableCell colSpan={wwCount + ptCount + 14 + aimsDistributedCount} className="py-0.5 px-4">
              <span className="sticky left-4 text-[11px] font-bold text-blue-600 uppercase tracking-[0.2em] inline-flex items-center gap-2 z-10">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Male Learners ({maleRecords.length})
              </span>
            </TableCell>
          </TableRow>
        );
        maleRecords.forEach((r, i) =>
          rows.push(
            <LedgerRow key={`${r.student.id}-${selectedTerm}`} record={r} idx={i} rowIndex={rowCounter++} selectedTerm={selectedTerm} wwCount={wwCount} ptCount={ptCount} weights={weights} onHpsUpdate={onHpsUpdate} onScoreCommit={onScoreCommit} onCellFocus={onCellFocus} isCellInvalid={isCellInvalid} transmutationTable={transmutationTable} isViewOnly={isViewOnly} aimsAssessments={aimsAssessments} aimsByStudent={aimsByStudent} aimsWW={aimsWW} aimsPT={aimsPT} aimsQA={aimsQA} wwColIsAims={wwColIsAims} ptColIsAims={ptColIsAims} />
          )
        );
      }
      if (femaleRecords.length > 0) {
        rows.push(
          <TableRow key="female-sep" className="bg-pink-50/60 hover:bg-pink-50/60 border-y border-pink-100/60 h-7">
            <TableCell colSpan={wwCount + ptCount + 14 + aimsDistributedCount} className="py-0.5 px-4">
              <span className="sticky left-4 text-[11px] font-bold text-pink-600 uppercase tracking-[0.2em] inline-flex items-center gap-2 z-10">
                <div className="w-1.5 h-1.5 rounded-full bg-pink-500" />
                Female Learners ({femaleRecords.length})
              </span>
            </TableCell>
          </TableRow>
        );
        femaleRecords.forEach((r, i) =>
          rows.push(
            <LedgerRow key={`${r.student.id}-${selectedTerm}`} record={r} idx={i} rowIndex={rowCounter++} selectedTerm={selectedTerm} wwCount={wwCount} ptCount={ptCount} weights={weights} onHpsUpdate={onHpsUpdate} onScoreCommit={onScoreCommit} onCellFocus={onCellFocus} isCellInvalid={isCellInvalid} transmutationTable={transmutationTable} isViewOnly={isViewOnly} aimsAssessments={aimsAssessments} aimsByStudent={aimsByStudent} aimsWW={aimsWW} aimsPT={aimsPT} aimsQA={aimsQA} wwColIsAims={wwColIsAims} ptColIsAims={ptColIsAims} />
          )
        );
      }
    } else {
      sortedRecords.forEach((r, i) =>
        rows.push(
          <LedgerRow key={`${r.student.id}-${selectedTerm}`} record={r} idx={i} rowIndex={rowCounter++} selectedTerm={selectedTerm} wwCount={wwCount} ptCount={ptCount} weights={weights} onHpsUpdate={onHpsUpdate} onScoreCommit={onScoreCommit} onCellFocus={onCellFocus} isCellInvalid={isCellInvalid} transmutationTable={transmutationTable} isViewOnly={isViewOnly} aimsAssessments={aimsAssessments} aimsByStudent={aimsByStudent} aimsWW={aimsWW} aimsPT={aimsPT} aimsQA={aimsQA} wwColIsAims={wwColIsAims} ptColIsAims={ptColIsAims} />
        )
      );
    }

    return rows;
  }, [sortedRecords, maleRecords, femaleRecords, separateByGender, selectedTerm, wwCount, ptCount, weights, isViewOnly, onHpsUpdate, onScoreCommit, onCellFocus, isCellInvalid, transmutationTable, aimsAssessments, aimsByStudent, aimsWW, aimsPT, aimsQA, wwColIsAims, ptColIsAims]);

  // Sticky + grade columns are fixed; score columns are flexible and share the
  // leftover card width so the table always fills the space with no blank gap.
  const FIXED_COL_WIDTH = 40 + 128 + 220 + 72 + 72 + 132; // #, LRN, Name, Initial, Term, Descriptor
  const SCORE_COL_WIDTH = 56;
  const scoreColCount = wwCount + aimsWW.length + 3 + ptCount + aimsPT.length + 3 + 8 + aimsQA.length;
  const tableMinWidth = FIXED_COL_WIDTH + scoreColCount * SCORE_COL_WIDTH;

  const renderColGroup = () => (
    <colgroup>
      {/* Sticky columns — fixed widths so sticky left offsets stay correct */}
      <col style={{ width: "40px", minWidth: "40px", maxWidth: "40px" }} />
      <col style={{ width: "128px", minWidth: "128px", maxWidth: "128px" }} />
      <col style={{ width: "220px", minWidth: "220px", maxWidth: "220px" }} />
      {/* WW columns (flexible) */}
      {Array.from({ length: wwCount }).map((_, i) => (
        <col key={`col-ww-${i}`} style={{ minWidth: "56px" }} />
      ))}
      {aimsWW.map((a) => (
        <col key={`col-aims-ww-${a.assessmentId}`} style={{ minWidth: "64px" }} />
      ))}
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      {/* PT columns (flexible) */}
      {Array.from({ length: ptCount }).map((_, i) => (
        <col key={`col-pt-${i}`} style={{ minWidth: "56px" }} />
      ))}
      {aimsPT.map((a) => (
        <col key={`col-aims-pt-${a.assessmentId}`} style={{ minWidth: "64px" }} />
      ))}
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      {/* Examinations columns: ST1, ST2, TE, WS ST1, WS ST2, WS TE, PS, WS (flexible) */}
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      <col style={{ minWidth: "56px" }} />
      {aimsQA.map((a) => (
        <col key={`col-aims-qa-${a.assessmentId}`} style={{ minWidth: "64px" }} />
      ))}
      {/* Grade columns (fixed) */}
      <col style={{ width: "72px", minWidth: "72px", maxWidth: "72px" }} />
      <col style={{ width: "72px", minWidth: "72px", maxWidth: "72px" }} />
      <col style={{ width: "132px", minWidth: "132px", maxWidth: "132px" }} />
    </colgroup>
  );

  const thBase = "border-b border-slate-200 text-[11px] font-bold uppercase tracking-widest text-center px-0 bg-clip-padding";

  return (
    <div className="hidden lg:block w-full relative z-[15]">
      {/* ── Sticky Header Stack (pins Card Header + settings panels + table headers + HPS row as ONE) ── */}
      <div
        className="sticky z-[29] bg-white isolate"
        style={{ top: `${topNavHeight}px` }}
      >
        {/* Card Header bar */}
        <div
          ref={ledgerHeaderRef}
          className="bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight uppercase">Class Ledger</h2>
            <div id="tutorial-gender-toggle" className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 shadow-inner">
              <Button
                variant="ghost"
                onClick={() => onSeparateByGenderChange(false)}
                className={`h-7 px-3 rounded-[10px] text-[11px] font-bold uppercase tracking-widest transition-all ${
                  !separateByGender ? "bg-white text-[var(--ledger-ww)] shadow-sm" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Alphabetical
              </Button>
              <Button
                variant="ghost"
                onClick={() => onSeparateByGenderChange(true)}
                className={`h-7 px-3 rounded-[10px] text-[11px] font-bold uppercase tracking-widest transition-all ${
                  separateByGender ? "bg-white text-[var(--ledger-ww)] shadow-sm" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Gendered
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              id="tutorial-optional-details"
              variant="outline"
              size="sm"
              className={`h-8 rounded-xl border-slate-200 font-bold text-[11px] transition-all ${
                showAssessmentDetails
                  ? "bg-indigo-50 text-indigo-700 border-indigo-200 shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
              onClick={onToggleAssessmentDetails}
            >
              Optional Assessment Details
            </Button>
            <div className="flex items-center gap-3">
              {onClearScores && !isViewOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearClick}
                  className={`h-8 rounded-xl border font-bold text-[11px] uppercase tracking-widest transition-all gap-1.5 ${
                    confirmingClear
                      ? "bg-rose-500 text-white border-rose-500 hover:bg-rose-600 hover:text-white"
                      : "text-rose-500 hover:text-rose-600 hover:bg-rose-50 border-rose-100"
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {confirmingClear ? "Confirm Clear?" : "Clear Scores"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Assessment panels */}
        <div className="relative z-20 bg-white">
          {assessmentHeaderNode}
        </div>

        {/* Table Column Headers & HPS Row (horizontally scrollable, synchronized with table body) */}
        <div
          ref={headerScrollRef}
          className="w-full overflow-x-hidden relative z-10 bg-white border-t border-slate-200/60"
        >
          <div className="relative bg-white min-w-full">
            <Table className="border-separate border-spacing-0 table-fixed min-w-full" style={{ minWidth: `max(100%, ${tableMinWidth}px)` }}>
              {renderColGroup()}
              <TableHeader>
                {/* ── Row 1: Category group headers ── */}
                <TableRow id="tutorial-task-controls" ref={groupRowRef} className="hover:bg-transparent border-0 h-auto transition-none">
                  <TableHead
                    colSpan={3}
                    className={`${thBase} border-l border-r border-b border-slate-200 text-slate-500 bg-slate-50 min-w-[388px] sticky left-0 z-[28] shadow-[2px_0_8px_-1px_rgba(0,0,0,0.06)]`}
                  >
                    Learner Information
                  </TableHead>

                  <TableHead
                    colSpan={wwCount + aimsWW.length + 3}
                    className={`${thBase} border-r text-[10px] tracking-wide whitespace-normal py-1 text-[var(--ledger-ww)] bg-[var(--ledger-ww-bg)] z-20`}
                  >
                    <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                      <span>Written / Oral Works (WWs)</span>
                      <div className="flex items-center gap-1">
                        <button
                          disabled={isViewOnly || wwCount <= 1}
                          className="w-5 h-5 rounded-full bg-white text-indigo-600 shadow-sm border border-indigo-200 hover:bg-indigo-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                          onClick={() => onRemoveTask("WW")}
                        >
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <button
                          disabled={isViewOnly}
                          className="w-5 h-5 rounded-full bg-white text-indigo-600 shadow-sm border border-indigo-200 hover:bg-indigo-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                          onClick={() => onAddTask("WW")}
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  </TableHead>

                  <TableHead
                    colSpan={ptCount + aimsPT.length + 3}
                    className={`${thBase} border-r text-[10px] tracking-wide whitespace-normal py-1 text-[var(--ledger-pt)] bg-[var(--ledger-pt-bg)] z-20`}
                  >
                    <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                      <span>Product / Performance Tasks (PTs)</span>
                      <div className="flex items-center gap-1">
                        <button
                          disabled={isViewOnly || ptCount <= 1}
                          className="w-5 h-5 rounded-full bg-white text-purple-600 shadow-sm border border-purple-200 hover:bg-purple-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                          onClick={() => onRemoveTask("PT")}
                        >
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <button
                          disabled={isViewOnly}
                          className="w-5 h-5 rounded-full bg-white text-purple-600 shadow-sm border border-purple-200 hover:bg-purple-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                          onClick={() => onAddTask("PT")}
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  </TableHead>

                  <TableHead
                    colSpan={8 + aimsQA.length}
                    className={`${thBase} border-r text-[10px] tracking-wide whitespace-normal py-1 text-[var(--ledger-ta)] bg-[var(--ledger-ta-bg)] z-20`}
                  >
                    Examinations (Exs)
                  </TableHead>

                  <TableHead
                    rowSpan={2}
                    className={`${thBase} w-[72px] min-w-[72px] max-w-[72px] border-r text-[10px] tracking-wide whitespace-normal leading-tight py-1 text-[var(--ledger-grade)] bg-[var(--ledger-grade-bg)] z-20 align-middle`}
                  >
                    Initial Grade
                  </TableHead>
                  <TableHead
                    rowSpan={2}
                    className={`${thBase} w-[72px] min-w-[72px] max-w-[72px] border-r text-[10px] tracking-wide whitespace-normal leading-tight py-1 text-[var(--ledger-grade)] bg-[var(--ledger-grade-bg)] z-20 align-middle`}
                  >
                    Term Grade
                  </TableHead>
                  <TableHead
                    rowSpan={2}
                    className={`${thBase} w-[132px] min-w-[132px] max-w-[132px] border-r text-[10px] tracking-wide whitespace-normal leading-tight py-1 text-[var(--ledger-grade)] bg-[var(--ledger-grade-bg)] z-20 align-middle`}
                  >
                    Descriptor
                  </TableHead>
                </TableRow>

                {/* ── Row 2: Column sub-headers ── */}
                <TableRow ref={subRowRef} className="hover:bg-transparent border-0 h-9 bg-white transition-none">
                  <TableHead className="w-10 min-w-[40px] max-w-[40px] text-center text-[11px] font-bold text-slate-400 uppercase border-l border-r border-b border-slate-200 bg-white sticky left-0 z-[25] bg-clip-padding">#</TableHead>
                  <TableHead className="w-32 min-w-[128px] max-w-[128px] text-[11px] font-bold text-slate-400 uppercase border-r border-b border-slate-200 px-1 bg-white sticky left-[40px] z-[25] bg-clip-padding">LRN</TableHead>
                  <TableHead className="min-w-[220px] text-[11px] font-bold text-slate-400 uppercase border-r border-b border-slate-200 px-2 bg-white sticky left-[168px] z-[25] bg-clip-padding shadow-[2px_0_8px_-1px_rgba(0,0,0,0.06)]">Full Name</TableHead>

                  {Array.from({ length: wwCount }).map((_, i) => (
                    <TableHead key={`h-ww-${i}`} className={` px-1 text-center text-[11px] font-bold uppercase border-r border-b border-slate-200 bg-clip-padding cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 transition-colors ${wwColIsAims[i] ? "text-[var(--ledger-aims)] bg-[var(--ledger-aims-bg)]" : "text-slate-400 bg-white"}`} onClick={() => onCellFocus("WW", i)} title={wwColAimsTitle[i]}>{i + 1}</TableHead>
                  ))}
                  {aimsWW.map((a, i) => (
                    <TableHead key={`h-aims-ww-${a.assessmentId}`} id={i === 0 ? "tutorial-aims-group" : undefined} className=" px-1 text-center text-[11px] font-bold text-[var(--ledger-aims)] uppercase border-r border-b border-slate-200 bg-[var(--ledger-aims-bg)] bg-clip-padding" title={`${a.title} — ${a.maxPoints} max`}>
                      <span>{wwCount + 1}</span>
                    </TableHead>
                  ))}
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-slate-500 uppercase border-r border-b border-slate-200 bg-slate-100 bg-clip-padding">Total</TableHead>
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-indigo-600 uppercase border-r border-b border-slate-200 bg-indigo-50 bg-clip-padding">PS</TableHead>
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-indigo-700 uppercase border-r border-b border-slate-200 bg-indigo-100 bg-clip-padding">WS</TableHead>

                  {Array.from({ length: ptCount }).map((_, i) => (
                    <TableHead key={`h-pt-${i}`} className={` px-1 text-center text-[11px] font-bold uppercase border-r border-b border-slate-200 bg-clip-padding cursor-pointer hover:bg-purple-50 hover:text-purple-600 transition-colors ${ptColIsAims[i] ? "text-[var(--ledger-aims)] bg-[var(--ledger-aims-bg)]" : "text-slate-400 bg-white"}`} onClick={() => onCellFocus("PT", i)} title={ptColAimsTitle[i]}>{i + 1}</TableHead>
                  ))}
                  {aimsPT.map((a, i) => (
                    <TableHead key={`h-aims-pt-${a.assessmentId}`} id={i === 0 && aimsWW.length === 0 ? "tutorial-aims-group" : undefined} className=" px-1 text-center text-[11px] font-bold text-[var(--ledger-aims)] uppercase border-r border-b border-slate-200 bg-[var(--ledger-aims-bg)] bg-clip-padding" title={`${a.title} — ${a.maxPoints} max`}>
                      <span>{ptCount + 1}</span>
                    </TableHead>
                  ))}
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-slate-500 uppercase border-r border-b border-slate-200 bg-slate-100 bg-clip-padding">Total</TableHead>
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-purple-600 uppercase border-r border-b border-slate-200 bg-purple-50 bg-clip-padding">PS</TableHead>
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-purple-700 uppercase border-r border-b border-slate-200 bg-purple-100 bg-clip-padding">WS</TableHead>

                  <TableHead className=" px-1 text-center text-[11px] font-bold text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => onCellFocus("EX", 0)} title="Summative Test 1">ST1</TableHead>
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => onCellFocus("EX", 1)} title="Summative Test 2">ST2</TableHead>
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => onCellFocus("EX", 2)} title="Term Exam">TE</TableHead>
                  <TableHead className=" px-1 text-center text-[10px] font-bold text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding" title="Weighted Score ST1 (30%)">WS ST1</TableHead>
                  <TableHead className=" px-1 text-center text-[10px] font-bold text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding" title="Weighted Score ST2 (30%)">WS ST2</TableHead>
                  <TableHead className=" px-1 text-center text-[10px] font-bold text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding" title="Weighted Score TE (40%)">WS TE</TableHead>
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding">PS</TableHead>
                  <TableHead className=" px-1 text-center text-[11px] font-bold text-amber-700 uppercase border-r border-b border-slate-200 bg-amber-100 bg-clip-padding">WS</TableHead>
                  {aimsQA.map((a, i) => (
                    <TableHead key={`h-aims-qa-${a.assessmentId}`} id={i === 0 && aimsWW.length === 0 && aimsPT.length === 0 ? "tutorial-aims-group" : undefined} className=" px-1 text-center text-[11px] font-bold text-[var(--ledger-aims)] uppercase border-r border-b border-slate-200 bg-[var(--ledger-aims-bg)] bg-clip-padding" title={`${a.title} — ${a.maxPoints} max`}>
                      <span>AIMS</span>
                    </TableHead>
                  ))}

                </TableRow>

                {/* ── Row 3: HPS (MAX) Row ── */}
                <LedgerRow
                  key="HPS-ROW"
                  record={null}
                  idx={0}
                  rowIndex={-1}
                  isHps
                  hpsStickyTop={undefined}
                  hpsData={hpsData}
                  selectedTerm={selectedTerm}
                  wwCount={wwCount}
                  ptCount={ptCount}
                  weights={weights}
                  onHpsUpdate={onHpsUpdate}
                  onScoreCommit={onScoreCommit}
                  onCellFocus={onCellFocus}
                  isCellInvalid={isCellInvalid}
                  transmutationTable={transmutationTable}
                  aimsAssessments={aimsAssessments}
                  aimsByStudent={aimsByStudent}
                  aimsWW={aimsWW}
                  aimsPT={aimsPT}
                  aimsQA={aimsQA}
                  wwColIsAims={wwColIsAims}
                  ptColIsAims={ptColIsAims}
                />
              </TableHeader>
            </Table>
          </div>
        </div>
      </div>

      {/* ── Scrollable Table Body Area (horizontal scrolling only, natural vertical height) ── */}
      <div
        id="tutorial-ledger-scores"
        ref={bodyScrollRef}
        onScroll={handleBodyScroll}
        className="w-full overflow-x-auto overflow-y-clip relative z-10 bg-white rounded-b-2xl border-x border-b border-slate-200/60 shadow-sm scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100"
      >
        <div className="relative bg-white min-w-full">
          <Table className="border-separate border-spacing-0 table-fixed min-w-full" style={{ minWidth: `max(100%, ${tableMinWidth}px)` }}>
            {renderColGroup()}
            <TableBody>
              {tableRows}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
