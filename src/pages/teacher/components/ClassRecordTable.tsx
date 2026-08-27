import React, { useRef, useState, useEffect } from "react";
import { Plus, Minus, Trash2 } from "lucide-react";
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
import { gradesApi } from "@/lib/api";

const terms = ["T1", "T2", "T3"] as const;

function getGradeColor(grade: number | null): string {
  if (grade === null) return "text-slate-300";
  if (grade >= 90) return "text-emerald-600";
  if (grade >= 85) return "text-blue-600";
  if (grade >= 80) return "text-amber-600";
  if (grade >= 75) return "text-orange-600";
  return "text-rose-600";
}

type TransmutationRow = { minGrade: number; maxGrade: number; transmutedGrade: number };

function transmuteGrade(initialGrade: number, table?: TransmutationRow[]): number {
  const roundedGrade = Math.round(initialGrade * 100) / 100;
  if (table && table.length > 0) {
    for (const entry of table) {
      if (roundedGrade >= entry.minGrade && roundedGrade <= entry.maxGrade) {
        return entry.transmutedGrade;
      }
    }
    return 60;
  }
  // Fallback: hardcoded DepEd table (used when table not yet loaded)
  if (roundedGrade >= 99.5) return 100;
  const fallback: [number, number, number][] = [
    [97.5, 99.49, 99], [96.0, 97.49, 98], [95.0, 95.99, 97], [94.0, 94.99, 96],
    [93.0, 93.99, 95], [92.0, 92.99, 94], [91.0, 91.99, 93], [90.0, 90.99, 92],
    [89.0, 89.99, 91], [88.0, 88.99, 90], [87.0, 87.99, 89], [86.0, 86.99, 88],
    [85.0, 85.99, 87], [84.0, 84.99, 86], [83.0, 83.99, 85], [82.0, 82.99, 84],
    [81.0, 81.99, 83], [80.0, 80.99, 82], [79.0, 79.99, 81], [78.0, 78.99, 80],
    [77.0, 77.99, 79], [76.0, 76.99, 78], [75.0, 75.99, 77], [73.0, 74.99, 76],
    [70.0, 72.99, 75], [68.0, 69.99, 74], [66.0, 67.99, 73], [64.0, 65.99, 72],
    [62.0, 63.99, 71], [60.0, 61.99, 70], [58.0, 59.99, 69], [56.0, 57.99, 68],
    [54.0, 55.99, 67], [52.0, 53.99, 66], [50.0, 51.99, 65], [48.0, 49.99, 64],
    [46.0, 47.99, 63], [43.0, 45.99, 62], [40.0, 42.99, 61], [25.0, 39.99, 60],
    [0.0,  24.99, 60],
  ];
  for (const [min, max, grade] of fallback) {
    if (roundedGrade >= min && roundedGrade <= max) return grade;
  }
  return 60;
}

// ─── LedgerRow ────────────────────────────────────────────────────────────────

interface LedgerRowProps {
  record: ClassRecord | null;
  idx: number;
  rowIndex: number;
  isHps?: boolean;
  hpsStickyTop?: number;
  hpsData?: { wwScores: ScoreItem[]; ptScores: ScoreItem[]; qaMax: number };
  selectedTerm: string;
  wwCount: number;
  ptCount: number;
  weights: { ww: number; pt: number; qa: number };
  onHpsUpdate: (cat: "WW" | "PT" | "QA", idx: number, val: number) => void;
  onScoreCommit: (inputEl: HTMLInputElement, sid: string, cat: "WW" | "PT" | "QA", idx: number) => boolean;
  onCellFocus: (cat: "WW" | "PT" | "QA", idx: number) => void;
  isCellInvalid: (sid: string, cat: "WW" | "PT" | "QA", idx: number) => boolean;
  transmutationTable?: TransmutationRow[];
  isViewOnly?: boolean;
}

const LedgerRow = React.memo(
  ({
    record,
    idx,
    rowIndex,
    isHps = false,
    hpsStickyTop,
    hpsData,
    selectedTerm,
    wwCount,
    ptCount,
    weights,
    onHpsUpdate,
    onScoreCommit,
    onCellFocus,
    isCellInvalid,
    transmutationTable,
    isViewOnly = false,
  }: LedgerRowProps) => {
    const studentId = record?.student.id || "HPS";
    const grade = record?.grades?.find((g) => g.term === selectedTerm);

    const wwScores = isHps ? hpsData?.wwScores || [] : ((grade?.writtenWorkScores || []) as ScoreItem[]);
    const ptScores = isHps ? hpsData?.ptScores || [] : ((grade?.perfTaskScores || []) as ScoreItem[]);

    const rowStyle = isHps && hpsStickyTop !== undefined
      ? { top: typeof hpsStickyTop === "number" ? `${hpsStickyTop}px` : hpsStickyTop }
      : undefined;

    const formatNum = (val: number | undefined | null, fallback = "-") => {
      if (val === undefined || val === null) return fallback;
      return Number(val).toFixed(1);
    };

    const formatInitialGrade = (val: number | undefined | null, fallback = "-") => {
      if (val === undefined || val === null) return fallback;
      return Number(val).toFixed(2);
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

    const displayInitialGrade =
      displayWWWS !== null && displayPTWS !== null && displayQAWS !== null ? displayWWWS + displayPTWS + displayQAWS : null;
    const displayQuarterlyGrade = displayInitialGrade !== null ? transmuteGrade(displayInitialGrade, transmutationTable) : null;

    const cellClass = "text-center text-[11px] font-bold border-r border-slate-200 p-0 h-9 w-14 min-w-[56px] max-w-[56px]";
    const inputClass =
      "w-full h-full bg-transparent text-center focus:bg-white focus:ring-1 focus:ring-inset focus:ring-indigo-500/30 outline-none transition-all px-0.5 font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

    return (
      <TableRow
        id={isHps ? "tutorial-hps-row" : undefined}
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
              ? "text-indigo-300 z-[22] bg-slate-800 border-y border-l border-slate-700 bg-clip-padding"
              : "text-slate-300 z-[15] bg-white group-hover:bg-slate-50"
          }`}
          style={rowStyle}
        >
          {isHps ? "MAX" : idx + 1}
        </TableCell>

        {/* LRN */}
        <TableCell
          className={`font-mono text-[11px] font-medium border-r border-b border-slate-200 px-1 truncate w-32 min-w-[128px] max-w-[128px] sticky left-[40px] transition-colors ${
            isHps
              ? "text-slate-500 z-[22] bg-slate-800 border-y border-slate-700 bg-clip-padding"
              : "text-slate-400 z-[15] bg-white group-hover:bg-slate-50"
          }`}
          style={rowStyle}
        >
          {isHps ? "-" : record?.student.lrn}
        </TableCell>

        {/* Full Name */}
        <TableCell
          className={`border-r border-b border-slate-200 px-2 w-64 min-w-[256px] max-w-[256px] sticky left-[168px] transition-colors ${
            isHps
              ? "z-[22] bg-slate-800 border-y border-slate-700 bg-clip-padding shadow-[2px_0_8px_-1px_rgba(0,0,0,0.35)]"
              : "z-[15] bg-white group-hover:bg-slate-50 shadow-[2px_0_8px_-1px_rgba(0,0,0,0.06)]"
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
            id={!isHps && idx === 0 && i === 0 ? "tutorial-cell-example" : isHps && i === 0 ? "tutorial-hps-cell" : undefined}
            className={`${cellClass} border-b border-slate-200 ${isHps ? "bg-slate-800 border-y border-slate-700 bg-clip-padding" : ""}`}
            style={rowStyle}
          >
            {(() => {
              const invalid = !isHps && isCellInvalid(studentId, "WW", i);
              const scoreVal = isHps ? wwScores[i]?.maxScore || 0 : ((wwScores[i] as any)?.status || (wwScores[i]?.score === 0 ? "" : (wwScores[i]?.score ?? "")));
              const scoreStatus = !isHps && ((wwScores[i] as any)?.status || (wwScores[i]?.score === "A" || wwScores[i]?.score === "E" ? wwScores[i]?.score : ""));
              return (
                <input
                  type={isHps ? "number" : "text"}
                  inputMode="decimal"
                  defaultValue={scoreVal}
                  disabled={isViewOnly && !isHps}
                  placeholder="0"
                  className={`${inputClass} ${isHps ? "text-indigo-300 font-black" : (
                    scoreStatus === "A" ? "text-rose-600 bg-rose-55 font-black rounded-lg" :
                    scoreStatus === "E" ? "text-indigo-600 bg-indigo-55 font-black rounded-lg" :
                    "text-slate-600"
                  )} ${
                    invalid ? "ring-1 ring-inset ring-rose-500 bg-rose-50/40 text-rose-700" : ""
                  } ${isViewOnly && !isHps ? "bg-gray-100 cursor-not-allowed opacity-60" : ""}`}
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
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (isHps) {
                      const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
                      onHpsUpdate("WW", i, val);
                    } else {
                      onScoreCommit(e.currentTarget, studentId, "WW", i);
                    }
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
            isHps ? "bg-slate-700 border-y border-slate-600 bg-clip-padding text-indigo-200" : "bg-slate-50/50 text-slate-500"
          }`}
          style={rowStyle}
        >
          {isHps ? wwMaxTotal : wwTotal}
        </TableCell>
        {/* WW PS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-indigo-900/60 border-y border-slate-700 bg-clip-padding text-indigo-300" : "bg-indigo-50/10 text-indigo-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayWWPS)}
        </TableCell>
        {/* WW WS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-indigo-900/80 border-y border-slate-700 bg-clip-padding text-indigo-200" : "bg-indigo-50/20 text-indigo-700"
          }`}
          style={rowStyle}
        >
          {isHps ? weights.ww.toFixed(1) : formatNum(displayWWWS)}
        </TableCell>

        {/* PT score cells */}
        {Array.from({ length: ptCount }).map((_, i) => (
          <TableCell
            key={`pt-${i}`}
            className={`${cellClass} border-b border-slate-200 ${isHps ? "bg-slate-800 border-y border-slate-700 bg-clip-padding" : ""}`}
            style={rowStyle}
          >
            {(() => {
              const invalid = !isHps && isCellInvalid(studentId, "PT", i);
              const scoreVal = isHps ? ptScores[i]?.maxScore || 0 : ((ptScores[i] as any)?.status || (ptScores[i]?.score === 0 ? "" : (ptScores[i]?.score ?? "")));
              const scoreStatus = !isHps && ((ptScores[i] as any)?.status || (ptScores[i]?.score === "A" || ptScores[i]?.score === "E" ? ptScores[i]?.score : ""));
              return (
                <input
                  type={isHps ? "number" : "text"}
                  inputMode="decimal"
                  defaultValue={scoreVal}
                  disabled={isViewOnly && !isHps}
                  placeholder="0"
                  className={`${inputClass} ${isHps ? "text-purple-300 font-black" : (
                    scoreStatus === "A" ? "text-rose-600 bg-rose-55 font-black rounded-lg" :
                    scoreStatus === "E" ? "text-indigo-600 bg-indigo-55 font-black rounded-lg" :
                    "text-slate-600"
                  )} ${
                    invalid ? "ring-1 ring-inset ring-rose-500 bg-rose-50/40 text-rose-700" : ""
                  } ${isViewOnly && !isHps ? "bg-gray-100 cursor-not-allowed opacity-60" : ""}`}
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
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (isHps) {
                      const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
                      onHpsUpdate("PT", i, val);
                    } else {
                      onScoreCommit(e.currentTarget, studentId, "PT", i);
                    }
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
            isHps ? "bg-slate-700 border-y border-slate-600 bg-clip-padding text-purple-200" : "bg-slate-50/50 text-slate-500"
          }`}
          style={rowStyle}
        >
          {isHps ? ptMaxTotal : ptTotal}
        </TableCell>
        {/* PT PS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-purple-900/60 border-y border-slate-700 bg-clip-padding text-purple-300" : "bg-purple-50/10 text-purple-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayPTPS)}
        </TableCell>
        {/* PT WS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-purple-900/80 border-y border-slate-700 bg-clip-padding text-purple-200" : "bg-purple-50/20 text-purple-700"
          }`}
          style={rowStyle}
        >
          {isHps ? weights.pt.toFixed(1) : formatNum(displayPTWS)}
        </TableCell>

        {/* QA SCORE */}
        <TableCell
          className={`${cellClass} border-b border-slate-200 ${isHps ? "bg-slate-800 border-y border-slate-700 bg-clip-padding" : ""}`}
          style={rowStyle}
        >
          {(() => {
            const invalid = !isHps && isCellInvalid(studentId, "QA", 0);
            const scoreVal = isHps ? qaMax : ((grade as any)?.qaStatus || (grade?.quarterlyAssessScore === 0 ? "" : (grade?.quarterlyAssessScore ?? "")));
            const scoreStatus = !isHps && ((grade as any)?.qaStatus || (grade?.quarterlyAssessScore === "A" || grade?.quarterlyAssessScore === "E" ? grade?.quarterlyAssessScore : ""));
            return (
              <input
                type={isHps ? "number" : "text"}
                inputMode="decimal"
                defaultValue={scoreVal}
                disabled={isViewOnly && !isHps}
                placeholder="0"
                className={`${inputClass} ${isHps ? "text-amber-300 font-black" : (
                  scoreStatus === "A" ? "text-rose-600 bg-rose-55 font-black rounded-lg" :
                  scoreStatus === "E" ? "text-indigo-600 bg-indigo-55 font-black rounded-lg" :
                  "text-slate-600"
                )} ${
                  invalid ? "ring-1 ring-inset ring-rose-500 bg-rose-50/40 text-rose-700" : ""
                } ${isViewOnly && !isHps ? "bg-gray-100 cursor-not-allowed opacity-60" : ""}`}
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
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (isHps) {
                    const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
                    onHpsUpdate("QA", 0, val);
                  } else {
                    onScoreCommit(e.currentTarget, studentId, "QA", 0);
                  }
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
            isHps ? "bg-amber-900/60 border-y border-slate-700 bg-clip-padding text-amber-300" : "bg-amber-50/10 text-amber-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayQAPS)}
        </TableCell>
        {/* QA WS */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-amber-900/80 border-y border-slate-700 bg-clip-padding text-amber-200" : "bg-amber-50/20 text-amber-700"
          }`}
          style={rowStyle}
        >
          {isHps ? weights.qa.toFixed(1) : formatNum(displayQAWS)}
        </TableCell>

        {/* INITIAL */}
        <TableCell
          className={`text-center font-black text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-emerald-900/60 border-y border-slate-700 bg-clip-padding text-emerald-300" : "bg-emerald-50/10 text-emerald-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.00" : formatInitialGrade(displayInitialGrade)}
        </TableCell>
        {/* FINAL */}
        <TableCell
          className={`text-center font-black text-xs border-r border-b border-slate-200 w-16 min-w-[64px] max-w-[64px] ${
            isHps
              ? "text-white bg-slate-900 border-y border-r border-slate-700 bg-clip-padding"
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
  selectedTerm: string;
  onTermChange: (term: string) => void;
  /**
   * When set (e.g. "T1"), this subject is a rotating subject and the teacher
   * may only enter grades for this specific term. Other terms are disabled.
   */
  lockedTerm?: string | null;
  /** The system's current active term — past terms are disabled */
  currentTerm?: string;
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
  onClearScores?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClassRecordTable({
  classAssignment,
  effectiveWeights,
  selectedTerm,
  onTermChange,
  lockedTerm,
  currentTerm,
  isViewOnly,
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
  onClearScores,
}: ClassRecordTableProps) {
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);

  const [confirmingClear, setConfirmingClear] = useState(false);
  const clearTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch transmutation table from API (single source of truth)
  const [transmutationTable, setTransmutationTable] = useState<Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>>([]);
  useEffect(() => {
    gradesApi.getTransmutationTable()
      .then(res => setTransmutationTable(res.data))
      .catch(() => {});
  }, []);

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
      <col style={{ width: "40px", minWidth: "40px", maxWidth: "40px" }} />
      <col style={{ width: "128px", minWidth: "128px", maxWidth: "128px" }} />
      <col style={{ width: "256px", minWidth: "256px", maxWidth: "256px" }} />
      {Array.from({ length: wwCount }).map((_, i) => (
        <col key={`col-ww-${i}`} style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      ))}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      {Array.from({ length: ptCount }).map((_, i) => (
        <col key={`col-pt-${i}`} style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      ))}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
      <col style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
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
        {/* Top & corner background masks: prevents scrolled table rows from peeking through rounded-t-2xl corners */}
        <div className="absolute -top-6 -left-3 -right-3 h-6 bg-slate-100 -z-10 pointer-events-none" />
        <div className="absolute top-0 -left-3 w-5 h-5 bg-slate-100 -z-10 pointer-events-none" />
        <div className="absolute top-0 -right-3 w-5 h-5 bg-slate-100 -z-10 pointer-events-none" />

        {/* Card Header bar */}
        <div
          ref={ledgerHeaderRef}
          className="bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between gap-4 rounded-t-2xl"
        >
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase">Class Ledger</h2>
            <div id="tutorial-gender-toggle" className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 shadow-inner">
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
            <div id="tutorial-period-controls" className="flex items-center gap-3">
              {isViewOnly && (
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-md px-2 py-0.5 flex items-center gap-1">
                  👁️ View Only — Past term grades are finalized
                </span>
              )}
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
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Period:</span>
                {lockedTerm && (
                  <span
                    className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 flex items-center gap-1"
                    title={`This is a rotating subject. You may only enter grades for ${lockedTerm === 'T1' ? 'Term 1' : lockedTerm === 'T2' ? 'Term 2' : 'Term 3'}.`}
                  >
                    Rotating — {lockedTerm === 'T1' ? 'Term 1' : lockedTerm === 'T2' ? 'Term 2' : 'Term 3'} only
                  </span>
                )}
                <Select
                  value={selectedTerm}
                  onValueChange={(val) => {
                    if (val && (!lockedTerm || val === lockedTerm)) onTermChange(val);
                  }}
                >
                  <SelectTrigger className="w-24 font-bold" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="shadow-2xl">
                    {terms.map((q) => {
                      const isLocked = !!lockedTerm && q !== lockedTerm;
                      const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
                      const isPastTerm = currentTerm && termOrder[q] < termOrder[currentTerm];
                      const isFutureTerm = currentTerm && termOrder[q] > termOrder[currentTerm];
                      const isReadOnly = isPastTerm; // Past terms are view-only
                      const disabled = isLocked || isFutureTerm; // Future terms are not available at all
                      const label = isPastTerm ? "Past term — view only" : isFutureTerm ? "Not yet available" : undefined;
                      return (
                        <SelectItem
                          key={q}
                          value={q}
                          disabled={disabled}
                          className={`text-[11px] font-bold ${
                            disabled ? "opacity-40 cursor-not-allowed" : ""
                          }`}
                          title={isLocked ? `This rotating subject is only taught in ${lockedTerm === 'T1' ? 'Term 1' : lockedTerm === 'T2' ? 'Term 2' : 'Term 3'}` : label}
                        >
                          {q === "T1" ? "Term 1" : q === "T2" ? "Term 2" : "Term 3"}
                          {isLocked ? " (Locked)" : isPastTerm ? " (View Only)" : isFutureTerm ? " (Locked)" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
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
            <Table className="border-separate border-spacing-0 table-fixed min-w-full">
              {renderColGroup()}
              <TableHeader>
                {/* ── Row 1: Category group headers ── */}
                <TableRow id="tutorial-task-controls" ref={groupRowRef} className="hover:bg-transparent border-0 h-9 transition-none">
                  <TableHead
                    colSpan={3}
                    className={`${thBase} border-l border-r border-b border-slate-200 text-slate-500 bg-slate-50 w-[424px] min-w-[424px] max-w-[424px] sticky left-0 z-[28] shadow-[2px_0_8px_-1px_rgba(0,0,0,0.06)]`}
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
                  </TableHead>

                  <TableHead
                    colSpan={ptCount + 3}
                    className={`${thBase} border-r text-purple-600 bg-purple-50 z-20`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      Perf. Tasks ({effectiveWeights?.pt ?? classAssignment.subject.perfTaskWeight}%)
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
                  </TableHead>

                  <TableHead
                    colSpan={3}
                    className={`${thBase} border-r text-amber-600 bg-amber-50 z-20`}
                  >
                    TA ({effectiveWeights?.qa ?? classAssignment.subject.quarterlyAssessWeight}%)
                  </TableHead>

                  <TableHead
                    colSpan={2}
                    className={`${thBase} border-r text-emerald-600 bg-emerald-50 z-20`}
                  >
                    Grade Summary
                  </TableHead>
                </TableRow>

                {/* ── Row 2: Column sub-headers ── */}
                <TableRow ref={subRowRef} className="hover:bg-transparent border-0 h-9 bg-white transition-none">
                  <TableHead className="w-10 min-w-[40px] max-w-[40px] text-center text-[11px] font-black text-slate-400 uppercase border-l border-r border-b border-slate-200 bg-white sticky left-0 z-[25] bg-clip-padding">#</TableHead>
                  <TableHead className="w-32 min-w-[128px] max-w-[128px] text-[11px] font-black text-slate-400 uppercase border-r border-b border-slate-200 px-1 bg-white sticky left-[40px] z-[25] bg-clip-padding">LRN</TableHead>
                  <TableHead className="w-64 min-w-[256px] max-w-[256px] text-[11px] font-black text-slate-400 uppercase border-r border-b border-slate-200 px-2 bg-white sticky left-[168px] z-[25] bg-clip-padding shadow-[2px_0_8px_-1px_rgba(0,0,0,0.06)]">Full Name</TableHead>

                  {Array.from({ length: wwCount }).map((_, i) => (
                    <TableHead key={`h-ww-${i}`} className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-slate-400 uppercase border-r border-b border-slate-200 bg-white bg-clip-padding cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 transition-colors" onClick={() => onCellFocus("WW", i)}>{i + 1}</TableHead>
                  ))}
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-slate-500 uppercase border-r border-b border-slate-200 bg-slate-100 bg-clip-padding">Total</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-indigo-600 uppercase border-r border-b border-slate-200 bg-indigo-50 bg-clip-padding">PS</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-indigo-700 uppercase border-r border-b border-slate-200 bg-indigo-100 bg-clip-padding">WS</TableHead>

                  {Array.from({ length: ptCount }).map((_, i) => (
                    <TableHead key={`h-pt-${i}`} className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-slate-400 uppercase border-r border-b border-slate-200 bg-white bg-clip-padding cursor-pointer hover:bg-purple-50 hover:text-purple-600 transition-colors" onClick={() => onCellFocus("PT", i)}>{i + 1}</TableHead>
                  ))}
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-slate-500 uppercase border-r border-b border-slate-200 bg-slate-100 bg-clip-padding">Total</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-purple-600 uppercase border-r border-b border-slate-200 bg-purple-50 bg-clip-padding">PS</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-purple-700 uppercase border-r border-b border-slate-200 bg-purple-100 bg-clip-padding">WS</TableHead>

                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => onCellFocus("QA", 0)}>Score</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding">PS</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-black text-amber-700 uppercase border-r border-b border-slate-200 bg-amber-100 bg-clip-padding">WS</TableHead>

                  <TableHead className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-black text-emerald-600 uppercase border-r border-b border-slate-200 bg-emerald-50 bg-clip-padding">Initial</TableHead>
                  <TableHead className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-black text-slate-900 uppercase bg-emerald-100 bg-clip-padding border-r border-b border-slate-200">Grade</TableHead>
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
          <Table className="border-separate border-spacing-0 table-fixed min-w-full">
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
                          <span className="sticky left-4 text-[11px] font-black text-blue-600 uppercase tracking-[0.2em] inline-flex items-center gap-2 z-10">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            Male Learners ({maleRecords.length})
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                    maleRecords.forEach((r, i) =>
                      rows.push(
                        <LedgerRow key={r.student.id} record={r} idx={i} rowIndex={rowCounter++} selectedTerm={selectedTerm} wwCount={wwCount} ptCount={ptCount} weights={weights} onHpsUpdate={onHpsUpdate} onScoreCommit={onScoreCommit} onCellFocus={onCellFocus} isCellInvalid={isCellInvalid} transmutationTable={transmutationTable} isViewOnly={isViewOnly} />
                      )
                    );
                  }
                  if (femaleRecords.length > 0) {
                    rows.push(
                      <TableRow key="female-sep" className="bg-pink-50/60 hover:bg-pink-50/60 border-y border-pink-100/60 h-7">
                        <TableCell colSpan={wwCount + ptCount + 14} className="py-0.5 px-4">
                          <span className="sticky left-4 text-[11px] font-black text-pink-600 uppercase tracking-[0.2em] inline-flex items-center gap-2 z-10">
                            <div className="w-1.5 h-1.5 rounded-full bg-pink-500" />
                            Female Learners ({femaleRecords.length})
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                    femaleRecords.forEach((r, i) =>
                      rows.push(
                        <LedgerRow key={r.student.id} record={r} idx={i} rowIndex={rowCounter++} selectedTerm={selectedTerm} wwCount={wwCount} ptCount={ptCount} weights={weights} onHpsUpdate={onHpsUpdate} onScoreCommit={onScoreCommit} onCellFocus={onCellFocus} isCellInvalid={isCellInvalid} transmutationTable={transmutationTable} isViewOnly={isViewOnly} />
                      )
                    );
                  }
                } else {
                  sortedRecords.forEach((r, i) =>
                    rows.push(
                      <LedgerRow key={r.student.id} record={r} idx={i} rowIndex={rowCounter++} selectedTerm={selectedTerm} wwCount={wwCount} ptCount={ptCount} weights={weights} onHpsUpdate={onHpsUpdate} onScoreCommit={onScoreCommit} onCellFocus={onCellFocus} isCellInvalid={isCellInvalid} transmutationTable={transmutationTable} isViewOnly={isViewOnly} />
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
