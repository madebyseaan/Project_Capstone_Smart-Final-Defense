import React, { useRef, useState, useEffect } from "react";
import { Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClassAssignment, ClassRecord, ScoreItem } from "@/lib/api";

const quarters = ["Q1", "Q2", "Q3", "Q4"] as const;

function getGradeColor(grade: number | null): string {
  if (grade === null) return "text-slate-300";
  if (grade >= 90) return "text-emerald-600";
  if (grade >= 85) return "text-blue-600";
  if (grade >= 80) return "text-amber-600";
  if (grade >= 75) return "text-orange-600";
  return "text-rose-600";
}

function transmuteGrade(initialGrade: number): number {
  const transmutationTable: [number, number, number][] = [
    [100, 100, 100],
    [98.4, 99.99, 99],
    [96.8, 98.39, 98],
    [95.2, 96.79, 97],
    [93.6, 95.19, 96],
    [92, 93.59, 95],
    [90.4, 91.99, 94],
    [88.8, 90.39, 93],
    [87.2, 88.79, 92],
    [85.6, 87.19, 91],
    [84, 85.59, 90],
    [82.4, 83.99, 89],
    [80.8, 82.39, 88],
    [79.2, 80.79, 87],
    [77.6, 79.19, 86],
    [76, 77.59, 85],
    [74.4, 75.99, 84],
    [72.8, 74.39, 83],
    [71.2, 72.79, 82],
    [69.6, 71.19, 81],
    [68, 69.59, 80],
    [66.4, 67.99, 79],
    [64.8, 66.39, 78],
    [63.2, 64.79, 77],
    [61.6, 63.19, 76],
    [60, 61.59, 75],
    [56, 59.99, 74],
    [52, 55.99, 73],
    [48, 51.99, 72],
    [44, 47.99, 71],
    [40, 43.99, 70],
    [36, 39.99, 69],
    [32, 35.99, 68],
    [28, 31.99, 67],
    [24, 27.99, 66],
    [20, 23.99, 65],
    [16, 19.99, 64],
    [12, 15.99, 63],
    [8, 11.99, 62],
    [4, 7.99, 61],
    [0, 3.99, 60],
  ];

  for (const [min, max, grade] of transmutationTable) {
    if (initialGrade >= min && initialGrade <= max) {
      return grade;
    }
  }

  return Math.round(Math.max(60, Math.min(100, initialGrade)));
}

// ─── LedgerRow ────────────────────────────────────────────────────────────────

interface LedgerRowProps {
  record: ClassRecord | null;
  idx: number;
  rowIndex: number;
  isHps?: boolean;
  hpsStickyTop?: number;
  hpsData?: { wwScores: ScoreItem[]; ptScores: ScoreItem[]; qaMax: number };
  selectedQuarter: string;
  wwCount: number;
  ptCount: number;
  weights: { ww: number; pt: number; qa: number };
  onHpsUpdate: (cat: "WW" | "PT" | "QA", idx: number, val: number) => void;
  onScoreCommit: (inputEl: HTMLInputElement, sid: string, cat: "WW" | "PT" | "QA", idx: number) => boolean;
  onCellFocus: (cat: "WW" | "PT" | "QA", idx: number) => void;
  isCellInvalid: (sid: string, cat: "WW" | "PT" | "QA", idx: number) => boolean;
}

const LedgerRow = React.memo(
  ({
    record,
    idx,
    rowIndex,
    isHps = false,
    hpsStickyTop,
    hpsData,
    selectedQuarter,
    wwCount,
    ptCount,
    weights,
    onHpsUpdate,
    onScoreCommit,
    onCellFocus,
    isCellInvalid,
  }: LedgerRowProps) => {
    const studentId = record?.student.id || "HPS";
    const grade = record?.grades?.find((g) => g.quarter === selectedQuarter);

    const wwScores = isHps ? hpsData?.wwScores || [] : ((grade?.writtenWorkScores || []) as ScoreItem[]);
    const ptScores = isHps ? hpsData?.ptScores || [] : ((grade?.perfTaskScores || []) as ScoreItem[]);

    const rowStyle = isHps && hpsStickyTop !== undefined
      ? { top: typeof hpsStickyTop === "number" ? `${hpsStickyTop}px` : hpsStickyTop }
      : undefined;

    const formatNum = (val: number | undefined | null, fallback = "-") => {
      if (val === undefined || val === null) return fallback;
      return Number(val).toFixed(1);
    };

    const calcTotal = (scores: ScoreItem[]) => scores.reduce((acc, curr) => acc + (Number(curr.score) || 0), 0);
    const calcMax = (scores: ScoreItem[]) => scores.reduce((acc, curr) => acc + (Number(curr.maxScore) || 0), 0);
    const calcPS = (total: number, max: number) => (max > 0 ? (total / max) * 100 : 0);

    const wwTotal = calcTotal(wwScores);
    const wwMaxTotal = calcMax(wwScores);
    const displayWWPS = grade?.writtenWorkPS ?? (wwMaxTotal > 0 ? calcPS(wwTotal, wwMaxTotal) : null);
    const displayWWWS = displayWWPS !== null ? displayWWPS * (weights.ww / 100) : null;

    const ptTotal = calcTotal(ptScores);
    const ptMaxTotal = calcMax(ptScores);
    const displayPTPS = grade?.perfTaskPS ?? (ptMaxTotal > 0 ? calcPS(ptTotal, ptMaxTotal) : null);
    const displayPTWS = displayPTPS !== null ? displayPTPS * (weights.pt / 100) : null;

    const qaScore = Number(grade?.quarterlyAssessScore) || 0;
    const qaMax = isHps ? hpsData?.qaMax ?? 100 : Number(grade?.quarterlyAssessMax) || 100;
    const displayQAPS = grade?.quarterlyAssessPS ?? (qaMax > 0 ? calcPS(qaScore, qaMax) : null);
    const displayQAWS = displayQAPS !== null ? displayQAPS * (weights.qa / 100) : null;

    const computedInitialGrade =
      displayWWWS !== null && displayPTWS !== null && displayQAWS !== null ? displayWWWS + displayPTWS + displayQAWS : null;
    const displayInitialGrade = grade?.initialGrade ?? computedInitialGrade;
    const displayQuarterlyGrade =
      grade?.quarterlyGrade ?? (displayInitialGrade !== null ? transmuteGrade(displayInitialGrade) : null);

    const cellClass = "text-center text-[11px] font-bold border-r border-slate-200 p-0 h-9 w-14 min-w-[56px] max-w-[56px]";
    const inputClass =
      "w-full h-full bg-transparent text-center focus:bg-white focus:ring-1 focus:ring-inset focus:ring-indigo-500/30 outline-none transition-all px-0.5 font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

    return (
      <TableRow
        className={
          isHps
            ? "bg-slate-800 text-white h-9 hover:bg-slate-800 transition-none group/hps sticky z-15"
            : "hover:bg-indigo-50/20 transition-all group h-9"
        }
        style={rowStyle}
      >
        {/* # */}
        <TableCell
          className={`text-center font-bold text-[11px] border-r border-b border-slate-200 w-10 min-w-[40px] max-w-[40px] sticky left-0 p-1 transition-colors ${
            isHps
              ? "text-indigo-300 z-[18] bg-slate-800 border-y border-l border-slate-700 bg-clip-padding"
              : "text-slate-300 z-10 bg-white group-hover:bg-slate-50/80"
          }`}
          style={rowStyle}
        >
          {isHps ? "MAX" : idx + 1}
        </TableCell>

        {/* LRN */}
        <TableCell
          className={`font-mono text-[11px] font-medium border-r border-b border-slate-200 px-1 truncate w-32 min-w-[128px] max-w-[128px] sticky left-[40px] transition-colors ${
            isHps
              ? "text-slate-500 z-[18] bg-slate-800 border-y border-slate-700 bg-clip-padding"
              : "text-slate-400 z-10 bg-white group-hover:bg-slate-50/80"
          }`}
          style={rowStyle}
        >
          {isHps ? "-" : record?.student.lrn}
        </TableCell>

        {/* Full Name */}
        <TableCell
          className={`border-r border-b border-slate-200 px-2 w-64 min-w-[256px] max-w-[256px] sticky left-[168px] transition-colors ${
            isHps
              ? "z-[18] bg-slate-800 border-y border-slate-700 bg-clip-padding shadow-[2px_0_8px_-1px_rgba(0,0,0,0.35)]"
              : "z-10 bg-white group-hover:bg-slate-50/80 shadow-[2px_0_8px_-1px_rgba(0,0,0,0.06)]"
          }`}
          style={rowStyle}
        >
          <p className={`font-bold text-[11px] tracking-tight uppercase truncate ${isHps ? "text-indigo-200" : "text-slate-700"}`}>
            {isHps ? "HIGHEST POSSIBLE SCORE" : `${record?.student.lastName}, ${record?.student.firstName}`}
          </p>
        </TableCell>

        {/* WW score cells */}
        {Array.from({ length: wwCount }).map((_, i) => (
          <TableCell
            key={`ww-${i}`}
            className={`${cellClass} border-b border-slate-200 ${isHps ? "sticky z-15 bg-slate-800 border-y border-slate-700 bg-clip-padding" : ""}`}
            style={rowStyle}
          >
            {(() => {
              const invalid = !isHps && isCellInvalid(studentId, "WW", i);
              return (
                <input
                  type="number"
                  inputMode="decimal"
                  defaultValue={isHps ? wwScores[i]?.maxScore || 0 : wwScores[i]?.score || ""}
                  placeholder="0"
                  className={`${inputClass} ${isHps ? "text-indigo-300 font-black" : "text-slate-600"} ${
                    invalid ? "ring-1 ring-inset ring-rose-500 bg-rose-50/40 text-rose-700" : ""
                  }`}
                  onFocus={(e) => {
                    onCellFocus("WW", i);
                    e.currentTarget.select();
                    e.currentTarget.dataset.prev = e.currentTarget.value;
                  }}
                  onBlur={(e) => {
                    if (isHps) {
                      const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
                      onHpsUpdate("WW", i, val);
                    } else {
                      onScoreCommit(e.currentTarget, studentId, "WW", i);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || isHps) return;
                    e.preventDefault();
                    const didSave = onScoreCommit(e.currentTarget, studentId, "WW", i);
                    if (!didSave) return;
                    const nextInput = document.querySelector<HTMLInputElement>(
                      `[data-row-index="${rowIndex + 1}"][data-cat="WW"][data-col="${i}"]`
                    );
                    nextInput?.focus();
                  }}
                  data-row-index={isHps ? -1 : rowIndex}
                  data-cat="WW"
                  data-col={i}
                />
              );
            })()}
          </TableCell>
        ))}

        {/* WW TOTAL */}
        <TableCell
          className={`text-center text-[11px] font-black border-r border-b border-slate-200 ${
            isHps ? "bg-slate-700 sticky z-15 border-y border-slate-600 bg-clip-padding text-indigo-200" : "bg-slate-50/50 text-slate-500"
          }`}
          style={rowStyle}
        >
          {isHps ? wwMaxTotal : wwTotal}
        </TableCell>
        {/* WW PS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-indigo-900/60 sticky z-15 border-y border-slate-700 bg-clip-padding text-indigo-300" : "bg-indigo-50/10 text-indigo-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayWWPS)}
        </TableCell>
        {/* WW WS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-indigo-900/80 sticky z-15 border-y border-slate-700 bg-clip-padding text-indigo-200" : "bg-indigo-50/20 text-indigo-700"
          }`}
          style={rowStyle}
        >
          {isHps ? weights.ww.toFixed(1) : formatNum(displayWWWS)}
        </TableCell>

        {/* PT score cells */}
        {Array.from({ length: ptCount }).map((_, i) => (
          <TableCell
            key={`pt-${i}`}
            className={`${cellClass} border-b border-slate-200 ${isHps ? "sticky z-15 bg-slate-800 border-y border-slate-700 bg-clip-padding" : ""}`}
            style={rowStyle}
          >
            {(() => {
              const invalid = !isHps && isCellInvalid(studentId, "PT", i);
              return (
                <input
                  type="number"
                  inputMode="decimal"
                  defaultValue={isHps ? ptScores[i]?.maxScore || 0 : ptScores[i]?.score || ""}
                  placeholder="0"
                  className={`${inputClass} ${isHps ? "text-purple-300 font-black" : "text-slate-600"} ${
                    invalid ? "ring-1 ring-inset ring-rose-500 bg-rose-50/40 text-rose-700" : ""
                  }`}
                  onFocus={(e) => {
                    onCellFocus("PT", i);
                    e.currentTarget.select();
                    e.currentTarget.dataset.prev = e.currentTarget.value;
                  }}
                  onBlur={(e) => {
                    if (isHps) {
                      const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
                      onHpsUpdate("PT", i, val);
                    } else {
                      onScoreCommit(e.currentTarget, studentId, "PT", i);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || isHps) return;
                    e.preventDefault();
                    const didSave = onScoreCommit(e.currentTarget, studentId, "PT", i);
                    if (!didSave) return;
                    const nextInput = document.querySelector<HTMLInputElement>(
                      `[data-row-index="${rowIndex + 1}"][data-cat="PT"][data-col="${i}"]`
                    );
                    nextInput?.focus();
                  }}
                  data-row-index={isHps ? -1 : rowIndex}
                  data-cat="PT"
                  data-col={i}
                />
              );
            })()}
          </TableCell>
        ))}

        {/* PT TOTAL */}
        <TableCell
          className={`text-center text-[11px] font-black border-r border-b border-slate-200 ${
            isHps ? "bg-slate-700 sticky z-15 border-y border-slate-600 bg-clip-padding text-purple-200" : "bg-slate-50/50 text-slate-500"
          }`}
          style={rowStyle}
        >
          {isHps ? ptMaxTotal : ptTotal}
        </TableCell>
        {/* PT PS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-purple-900/60 sticky z-15 border-y border-slate-700 bg-clip-padding text-purple-300" : "bg-purple-50/10 text-purple-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayPTPS)}
        </TableCell>
        {/* PT WS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-purple-900/80 sticky z-15 border-y border-slate-700 bg-clip-padding text-purple-200" : "bg-purple-50/20 text-purple-700"
          }`}
          style={rowStyle}
        >
          {isHps ? weights.pt.toFixed(1) : formatNum(displayPTWS)}
        </TableCell>

        {/* QA SCORE */}
        <TableCell
          className={`${cellClass} border-b border-slate-200 ${isHps ? "sticky z-15 bg-slate-800 border-y border-slate-700 bg-clip-padding" : ""}`}
          style={rowStyle}
        >
          {(() => {
            const invalid = !isHps && isCellInvalid(studentId, "QA", 0);
            return (
              <input
                type="number"
                inputMode="decimal"
                defaultValue={isHps ? qaMax : grade?.quarterlyAssessScore || ""}
                placeholder="0"
                className={`${inputClass} ${isHps ? "text-amber-300 font-black" : "text-amber-600"} ${
                  invalid ? "ring-1 ring-inset ring-rose-500 bg-rose-50/40 text-rose-700" : ""
                }`}
                onFocus={(e) => {
                  onCellFocus("QA", 0);
                  e.currentTarget.select();
                  e.currentTarget.dataset.prev = e.currentTarget.value;
                }}
                onBlur={(e) => {
                  if (isHps) {
                    const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
                    onHpsUpdate("QA", 0, val);
                  } else {
                    onScoreCommit(e.currentTarget, studentId, "QA", 0);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || isHps) return;
                  e.preventDefault();
                  const didSave = onScoreCommit(e.currentTarget, studentId, "QA", 0);
                  if (!didSave) return;
                  const nextInput = document.querySelector<HTMLInputElement>(
                    `[data-row-index="${rowIndex + 1}"][data-cat="QA"][data-col="0"]`
                  );
                  nextInput?.focus();
                }}
                data-row-index={isHps ? -1 : rowIndex}
                data-cat="QA"
                data-col={0}
              />
            );
          })()}
        </TableCell>
        {/* QA PS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-amber-900/60 sticky z-15 border-y border-slate-700 bg-clip-padding text-amber-300" : "bg-amber-50/10 text-amber-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayQAPS)}
        </TableCell>
        {/* QA WS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-amber-900/80 sticky z-15 border-y border-slate-700 bg-clip-padding text-amber-200" : "bg-amber-50/20 text-amber-700"
          }`}
          style={rowStyle}
        >
          {isHps ? weights.qa.toFixed(1) : formatNum(displayQAWS)}
        </TableCell>

        {/* INITIAL */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-emerald-900/60 sticky z-15 border-y border-slate-700 bg-clip-padding text-emerald-300" : "bg-emerald-50/10 text-emerald-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayInitialGrade)}
        </TableCell>
        {/* FINAL */}
        <TableCell
          className={`text-center font-black text-xs border-r border-b border-slate-200 w-16 min-w-[64px] max-w-[64px] ${
            isHps
              ? "text-white bg-slate-900 sticky z-15 border-y border-r border-slate-700 bg-clip-padding"
              : `bg-emerald-50/30 ${getGradeColor(displayQuarterlyGrade)}`
          }`}
          style={rowStyle}
        >
          {isHps ? "100" : displayQuarterlyGrade ?? <span className="text-slate-300">-</span>}
        </TableCell>
      </TableRow>
    );
  }
);

LedgerRow.displayName = "LedgerRow";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ClassRecordTableProps {
  classAssignment: ClassAssignment;
  effectiveWeights: {
    ww: number;
    pt: number;
    qa: number;
  } | null;
  selectedQuarter: string;
  onQuarterChange: (quarter: string) => void;
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
  hpsData: { wwScores: ScoreItem[]; ptScores: ScoreItem[]; qaMax: number };
  sortedRecords: ClassRecord[];
  maleRecords: ClassRecord[];
  femaleRecords: ClassRecord[];
  onRemoveTask: (category: "WW" | "PT") => void;
  onAddTask: (category: "WW" | "PT") => void;
  onHpsUpdate: (cat: "WW" | "PT" | "QA", idx: number, val: number) => void;
  onScoreCommit: (inputEl: HTMLInputElement, sid: string, cat: "WW" | "PT" | "QA", idx: number) => boolean;
  onCellFocus: (cat: "WW" | "PT" | "QA", idx: number) => void;
  isCellInvalid: (sid: string, cat: "WW" | "PT" | "QA", idx: number) => boolean;
  assessmentHeaderNode?: React.ReactNode;
  ledgerHeaderRef?: React.RefObject<HTMLDivElement | null>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClassRecordTable({
  classAssignment,
  effectiveWeights,
  selectedQuarter,
  onQuarterChange,
  separateByGender,
  onSeparateByGenderChange,
  showAssessmentDetails,
  onToggleAssessmentDetails,
  topNavHeight,
  ledgerHeaderHeight,
  stickyOffset,
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
}: ClassRecordTableProps) {
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);

  const handleBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // ── Measure header rows for nested sticky within the scroll container ────
  const groupRowRef = useRef<HTMLTableRowElement | null>(null);
  const subRowRef = useRef<HTMLTableRowElement | null>(null);
  const [groupRowH, setGroupRowH] = useState(36);
  const [subRowH, setSubRowH] = useState(36);

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

  const renderColGroup = () => (
    <colgroup>
      {/* Learner Info */}
      <col style={{ width: "40px", minWidth: "40px", maxWidth: "40px" }} />
      <col style={{ width: "128px", minWidth: "128px", maxWidth: "128px" }} />
      <col style={{ width: "256px", minWidth: "256px", maxWidth: "256px" }} />
      {/* WW */}
      {Array.from({ length: wwCount }).map((_, i) => (
        <col key={`col-ww-${i}`} style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      ))}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} /> {/* Total */}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} /> {/* PS */}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} /> {/* WS */}
      {/* PT */}
      {Array.from({ length: ptCount }).map((_, i) => (
        <col key={`col-pt-${i}`} style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      ))}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} /> {/* Total */}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} /> {/* PS */}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} /> {/* WS */}
      {/* QA */}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} /> {/* Score */}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} /> {/* PS */}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} /> {/* WS */}
      {/* Summary */}
      <col style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} /> {/* Initial */}
      <col style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} /> {/* Final */}
    </colgroup>
  );

  const thBase = "border-b border-slate-200 text-[11px] font-black uppercase tracking-widest text-center px-0 bg-clip-padding";

  return (
    <div className="hidden lg:block w-full relative z-[15]">
      {/* ── Sticky Header Stack (pins Card Header + settings panels + table headers + HPS row as ONE) ── */}
      <div
        className="sticky z-[29] bg-white border-x border-t border-slate-200/60 rounded-t-2xl shadow-sm isolate"
        style={{ top: `${topNavHeight}px` }}
      >
        {/* Card Header bar */}
        <div
          ref={ledgerHeaderRef}
          className="bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between gap-4 rounded-t-2xl"
        >
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase">Class Ledger</h2>
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 shadow-inner">
              <Button
                variant="ghost"
                onClick={() => onSeparateByGenderChange(false)}
                className={`h-7 px-3 rounded-[10px] text-[11px] font-black uppercase tracking-widest transition-all ${
                  !separateByGender ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Alphabetical
              </Button>
              <Button
                variant="ghost"
                onClick={() => onSeparateByGenderChange(true)}
                className={`h-7 px-3 rounded-[10px] text-[11px] font-black uppercase tracking-widest transition-all ${
                  separateByGender ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Gendered
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
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
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Period:</span>
              <Select value={selectedQuarter} onValueChange={(val) => val && onQuarterChange(val)}>
                <SelectTrigger className="h-8 w-20 bg-white border-slate-200 text-[11px] font-black uppercase rounded-xl shadow-sm px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200 shadow-2xl p-1">
                  {quarters.map((q) => (
                    <SelectItem
                      key={q}
                      value={q}
                      className="text-[11px] font-black uppercase rounded-lg py-1.5 px-3 focus:bg-indigo-50 focus:text-indigo-600 transition-colors cursor-pointer"
                    >
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          <div className="relative bg-white min-w-max">
            <Table className="border-separate border-spacing-0 table-fixed w-max">
              {renderColGroup()}
              <TableHeader>
                {/* ── Row 1: Category group headers ── */}
                <TableRow ref={groupRowRef} className="hover:bg-transparent border-0 h-9 transition-none">
                  <TableHead
                    colSpan={3}
                    className={`${thBase} border-l border-r text-slate-500 bg-slate-55 w-[424px] min-w-[424px] max-w-[424px] left-0 z-[25]`}
                  >
                    Learner Information
                  </TableHead>

                  <TableHead
                    colSpan={wwCount + 3}
                    className={`${thBase} border-r text-indigo-600 bg-indigo-50 z-20`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      Written Work ({effectiveWeights?.ww ?? classAssignment.subject.writtenWorkWeight}%)
                      <button
                        disabled={wwCount <= 1}
                        className="w-5 h-5 rounded-full bg-white text-indigo-600 shadow-sm border border-indigo-200 hover:bg-indigo-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                        onClick={() => onRemoveTask("WW")}
                      >
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <button
                        className="w-5 h-5 rounded-full bg-white text-indigo-600 shadow-sm border border-indigo-200 hover:bg-indigo-600 hover:text-white transition-all flex items-center justify-center"
                        onClick={() => onAddTask("WW")}
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </TableHead>

                  <TableHead
                    colSpan={ptCount + 3}
                    className={`${thBase} border-r text-purple-600 bg-purple-50 z-20`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      Perf. Tasks ({effectiveWeights?.pt ?? classAssignment.subject.perfTaskWeight}%)
                      <button
                        disabled={ptCount <= 1}
                        className="w-5 h-5 rounded-full bg-white text-purple-600 shadow-sm border border-purple-200 hover:bg-purple-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                        onClick={() => onRemoveTask("PT")}
                      >
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <button
                        className="w-5 h-5 rounded-full bg-white text-purple-600 shadow-sm border border-purple-200 hover:bg-purple-600 hover:text-white transition-all flex items-center justify-center"
                        onClick={() => onAddTask("PT")}
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </TableHead>

                  <TableHead
                    colSpan={3}
                    className={`${thBase} border-r text-amber-600 bg-amber-50 z-20`}
                  >
                    QA ({effectiveWeights?.qa ?? classAssignment.subject.quarterlyAssessWeight}%)
                  </TableHead>

                  <TableHead
                    colSpan={2}
                    className={`${thBase} border-r text-emerald-600 bg-emerald-50 z-20`}
                  >
                    Summary
                  </TableHead>
                </TableRow>

                {/* ── Row 2: Column sub-headers ── */}
                <TableRow ref={subRowRef} className="hover:bg-transparent border-0 h-9 bg-white transition-none">
                  <TableHead className="w-10 min-w-[40px] max-w-[40px] text-center text-[11px] font-black text-slate-400 uppercase border-l border-r border-b border-slate-200 bg-white sticky left-0 z-[25] bg-clip-padding">#</TableHead>
                  <TableHead className="w-32 min-w-[128px] max-w-[128px] text-[11px] font-black text-slate-400 uppercase border-r border-b border-slate-200 px-1 bg-white sticky left-[40px] z-[25] bg-clip-padding">LRN</TableHead>
                  <TableHead className="w-64 min-w-[256px] max-w-[256px] text-[11px] font-black text-slate-400 uppercase border-r border-b border-slate-200 px-2 bg-white sticky left-[168px] z-[25] bg-clip-padding shadow-[2px_0_8px_-1px_rgba(0,0,0,0.06)]">Full Name</TableHead>

                  {Array.from({ length: wwCount }).map((_, i) => (
                    <TableHead key={`h-ww-${i}`} className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-slate-400 uppercase border-r border-b border-slate-200 bg-white bg-clip-padding sticky z-20 cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 transition-colors" onClick={() => onCellFocus("WW", i)}>{i + 1}</TableHead>
                  ))}
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-slate-500 uppercase border-r border-b border-slate-200 bg-slate-100 bg-clip-padding sticky z-20">Total</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-indigo-600 uppercase border-r border-b border-slate-200 bg-indigo-50 bg-clip-padding sticky z-20">PS</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-indigo-700 uppercase border-r border-b border-slate-200 bg-indigo-100 bg-clip-padding sticky z-20">WS</TableHead>

                  {Array.from({ length: ptCount }).map((_, i) => (
                    <TableHead key={`h-pt-${i}`} className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-slate-400 uppercase border-r border-b border-slate-200 bg-white bg-clip-padding sticky z-20 cursor-pointer hover:bg-purple-50 hover:text-purple-600 transition-colors" onClick={() => onCellFocus("PT", i)}>{i + 1}</TableHead>
                  ))}
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-slate-500 uppercase border-r border-b border-slate-200 bg-slate-100 bg-clip-padding sticky z-20">Total</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-purple-600 uppercase border-r border-b border-slate-200 bg-purple-50 bg-clip-padding sticky z-20">PS</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-purple-700 uppercase border-r border-b border-slate-200 bg-purple-100 bg-clip-padding sticky z-20">WS</TableHead>

                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding sticky z-20 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => onCellFocus("QA", 0)}>Score</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding sticky z-20">PS</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-amber-700 uppercase border-r border-b border-slate-200 bg-amber-100 bg-clip-padding sticky z-20">WS</TableHead>

                  <TableHead className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-black text-emerald-600 uppercase border-r border-b border-slate-200 bg-emerald-50 bg-clip-padding sticky z-20">Initial</TableHead>
                  <TableHead className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-black text-slate-900 uppercase bg-emerald-100 bg-clip-padding border-r border-b border-slate-200 sticky z-20">Final</TableHead>
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
                  selectedQuarter={selectedQuarter}
                  wwCount={wwCount}
                  ptCount={ptCount}
                  weights={weights}
                  onHpsUpdate={onHpsUpdate}
                  onScoreCommit={onScoreCommit}
                  onCellFocus={onCellFocus}
                  isCellInvalid={isCellInvalid}
                />
              </TableHeader>
            </Table>
          </div>
        </div>
      </div>

      {/* ── Scrollable Table Body Area (horizontal scrolling only, natural vertical height) ── */}
      <div
        ref={bodyScrollRef}
        onScroll={handleBodyScroll}
        className="w-full overflow-x-auto overflow-y-clip relative z-10 bg-white rounded-b-2xl border-x border-b border-slate-200/60 shadow-sm scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100"
      >
        <div className="relative bg-white min-w-max">
          <Table className="border-separate border-spacing-0 table-fixed w-max">
            {renderColGroup()}
            <TableBody>
              {(() => {
                const rows: React.ReactNode[] = [];
                let rowCounter = 0;

                if (separateByGender) {
                  if (maleRecords.length > 0) {
                    rows.push(
                      <TableRow key="male-sep" className="bg-blue-50/60 hover:bg-blue-50/60 border-y border-blue-100/60 h-7">
                        <TableCell colSpan={wwCount + ptCount + 14} className="py-0.5 px-4">
                          <span className="text-[11px] font-black text-blue-600 uppercase tracking-[0.2em] flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            Male Learners ({maleRecords.length})
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                    maleRecords.forEach((r, i) =>
                      rows.push(
                        <LedgerRow key={r.student.id} record={r} idx={i} rowIndex={rowCounter++} selectedQuarter={selectedQuarter} wwCount={wwCount} ptCount={ptCount} weights={weights} onHpsUpdate={onHpsUpdate} onScoreCommit={onScoreCommit} onCellFocus={onCellFocus} isCellInvalid={isCellInvalid} />
                      )
                    );
                  }
                  if (femaleRecords.length > 0) {
                    rows.push(
                      <TableRow key="female-sep" className="bg-pink-50/60 hover:bg-pink-50/60 border-y border-pink-100/60 h-7">
                        <TableCell colSpan={wwCount + ptCount + 14} className="py-0.5 px-4">
                          <span className="text-[11px] font-black text-pink-600 uppercase tracking-[0.2em] flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-pink-500" />
                            Female Learners ({femaleRecords.length})
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                    femaleRecords.forEach((r, i) =>
                      rows.push(
                        <LedgerRow key={r.student.id} record={r} idx={i} rowIndex={rowCounter++} selectedQuarter={selectedQuarter} wwCount={wwCount} ptCount={ptCount} weights={weights} onHpsUpdate={onHpsUpdate} onScoreCommit={onScoreCommit} onCellFocus={onCellFocus} isCellInvalid={isCellInvalid} />
                      )
                    );
                  }
                } else {
                  sortedRecords.forEach((r, i) =>
                    rows.push(
                      <LedgerRow key={r.student.id} record={r} idx={i} rowIndex={rowCounter++} selectedQuarter={selectedQuarter} wwCount={wwCount} ptCount={ptCount} weights={weights} onHpsUpdate={onHpsUpdate} onScoreCommit={onScoreCommit} onCellFocus={onCellFocus} isCellInvalid={isCellInvalid} />
                    )
                  );
                }

                return rows;
              })()}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
