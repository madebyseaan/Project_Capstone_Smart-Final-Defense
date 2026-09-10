import React, { useRef, useState, useEffect, useMemo } from "react";
import { Plus, Minus, Trash2, Eye } from "lucide-react";
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
import type { ClassAssignment, ClassRecord, ScoreItem, AimsAssessmentInfo, AimsRowScore } from "@/lib/api";
import { getGradeColor, transmuteGrade, type TransmutationRow } from "@/lib/gradeMath";

const terms = ["T1", "T2", "T3"] as const;

// ─── LedgerScoreCell ─────────────────────────────────────────────────────────

interface LedgerScoreCellProps {
  cat: "WW" | "PT" | "QA";
  index: number;
  value: string | number;
  status?: string;
  isHps: boolean;
  invalid?: string;
  disabled?: boolean;
  hpsColorClass: string;
  onCommit: (inputEl: HTMLInputElement) => void;
  onHps: (val: number) => void;
  onFocus: () => void;
  rowIndex: number;
  ariaLabel: string;
  aims?: boolean;
}

const LedgerScoreCell = React.memo(function LedgerScoreCell({
  cat,
  index,
  value,
  status,
  isHps,
  invalid,
  disabled,
  hpsColorClass,
  onCommit,
  onHps,
  onFocus,
  rowIndex,
  ariaLabel,
  aims,
}: LedgerScoreCellProps) {
  return (
    <input
      key={`${String(value ?? "")}-${status ?? ""}`}
      type={isHps ? "number" : "text"}
      inputMode="decimal"
      defaultValue={value}
      disabled={disabled}
      placeholder="0"
      aria-label={ariaLabel}
      aria-invalid={!!invalid}
      title={invalid}
      className={`w-full text-center text-[11px] font-bold border-0 outline-none bg-transparent tabular-nums ${isHps ? hpsColorClass : (
        status === "A" ? "text-rose-600 bg-rose-500/10 font-bold rounded-lg" :
        status === "E" ? "text-indigo-600 bg-indigo-500/10 font-bold rounded-lg" :
        aims ? "text-[var(--ledger-aims)] font-bold bg-[var(--ledger-aims-bg)]" :
        "text-slate-600"
      )} ${
        invalid ? "ring-1 ring-inset ring-rose-500 bg-rose-50/40 text-rose-700" : ""
      } ${disabled ? "bg-gray-100 cursor-not-allowed opacity-60" : ""}`}
      onFocus={(e) => {
        onFocus();
        e.currentTarget.select();
        e.currentTarget.dataset.prev = e.currentTarget.value;
      }}
      onBlur={(e) => {
        if (isHps) {
          const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
          onHps(val);
        } else {
          onCommit(e.currentTarget);
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (isHps) {
          const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
          onHps(val);
        } else {
          onCommit(e.currentTarget);
        }
        // Defer focus to after React's batched state updates and re-render,
        // so the next row's input exists in the DOM when we query for it.
        requestAnimationFrame(() => {
          const nextInput = document.querySelector<HTMLInputElement>(
            `[data-row-index="${rowIndex + 1}"][data-cat="${cat}"][data-col="${index}"]`
          );
          nextInput?.focus();
        });
      }}
      data-row-index={isHps ? -1 : rowIndex}
      data-cat={cat}
      data-col={index}
    />
  );
});

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
  isCellInvalid: (sid: string, cat: "WW" | "PT" | "QA", idx: number) => string | undefined;
  transmutationTable?: TransmutationRow[];
  isViewOnly?: boolean;
  aimsAssessments?: AimsAssessmentInfo[];
  aimsByStudent?: Record<string, Record<string, AimsRowScore>>;
  aimsWW?: AimsAssessmentInfo[];
  aimsPT?: AimsAssessmentInfo[];
  aimsQA?: AimsAssessmentInfo[];
  wwColIsAims?: boolean[];
  ptColIsAims?: boolean[];
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
    aimsAssessments = [],
    aimsByStudent = {},
    aimsWW = [],
    aimsPT = [],
    aimsQA = [],
    wwColIsAims = [],
    ptColIsAims = [],
  }: LedgerRowProps) => {
    const studentId = record?.student.id || "HPS";
    const grade = record?.grades?.find((g) => g.term === selectedTerm);
    const isInherited = !!(grade as any)?.inheritedFrom;

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

    return (
      <TableRow
        id={isHps ? "tutorial-hps-row" : undefined}
        className={
          isHps
            ? "bg-slate-800 text-white h-9 hover:bg-slate-800 transition-none group/hps sticky z-15"
            : isInherited
              ? "bg-blue-50/40 hover:bg-blue-50/60 transition-all group h-9"
              : "hover:bg-indigo-50/20 transition-all group h-9"
        }
        style={rowStyle}
        title={isInherited && grade ? `Inherited from ${(grade as any).inheritedFrom} — editing copies it to your record` : undefined}
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
            <LedgerScoreCell
              cat="WW"
              index={i}
              value={isHps ? wwScores[i]?.maxScore || 0 : ((wwScores[i] as any)?.status || (wwScores[i]?.score === 0 ? "" : (wwScores[i]?.score ?? "")))}
              status={!isHps ? (wwScores[i] as any)?.status : undefined}
              isHps={!!isHps}
              invalid={!isHps ? isCellInvalid(studentId, "WW", i) : undefined}
              disabled={isViewOnly && !isHps}
              hpsColorClass="text-[var(--ledger-ww)] font-bold"
              onCommit={(el) => onScoreCommit(el, studentId, "WW", i)}
              onHps={(val) => onHpsUpdate("WW", i, val)}
              onFocus={() => onCellFocus("WW", i)}
              rowIndex={rowIndex}
              ariaLabel={`WW ${i + 1} score for student, max ${wwScores[i]?.maxScore || 0}`}
              aims={!!(wwScores[i] as any)?.isAims || wwColIsAims[i]}
            />
          </TableCell>
        ))}

        {/* AIMS WW staging columns */}
        {aimsWW.map((a) => {
          const score = !isHps ? aimsByStudent[studentId]?.[a.assessmentId] : undefined;
          return (
            <TableCell
              key={`aims-ww-${a.assessmentId}`}
              className={`text-center text-[11px] font-bold border-r border-b border-slate-200 p-0 h-9 w-16 min-w-[64px] max-w-[64px] ${
                isHps
                  ? "bg-slate-800 border-y border-slate-700 bg-clip-padding text-[var(--ledger-aims)]"
                  : `text-[var(--ledger-aims)] ${score?.importedAt ? "bg-[var(--ledger-aims-bg)]" : ""}`
              }`}
              style={rowStyle}
              title={
                !isHps && score
                  ? `${score.pointsEarned}/${score.maxPoints} · ${a.title} · WW · attempt ${score.attemptNumber} · graded ${score.gradedAt?.slice(0, 10) ?? "?"}${score.importedAt ? " (imported)" : ""}`
                  : undefined
              }
            >
              {isHps ? a.maxPoints : score?.pointsEarned ?? <span className="text-slate-300">-</span>}
            </TableCell>
          );
        })}

        {/* WW TOTAL */}
        <TableCell
          className={`text-center text-[11px] font-bold border-r border-b border-slate-200 ${
            isHps ? "bg-slate-700 border-y border-slate-600 bg-clip-padding text-indigo-200" : "bg-slate-50/50 text-slate-500"
          }`}
          style={rowStyle}
        >
          {isHps ? wwMaxTotal : wwTotal}
        </TableCell>
        {/* WW PS */}
        <TableCell
          className={`text-center font-bold text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-indigo-900/60 border-y border-slate-700 bg-clip-padding text-indigo-300" : "bg-indigo-50/10 text-indigo-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayWWPS)}
        </TableCell>
        {/* WW WS */}
        <TableCell
          className={`text-center font-bold text-[11px] border-r border-b border-slate-200 ${
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
            <LedgerScoreCell
              cat="PT"
              index={i}
              value={isHps ? ptScores[i]?.maxScore || 0 : ((ptScores[i] as any)?.status || (ptScores[i]?.score === 0 ? "" : (ptScores[i]?.score ?? "")))}
              status={!isHps ? (ptScores[i] as any)?.status : undefined}
              isHps={!!isHps}
              invalid={!isHps ? isCellInvalid(studentId, "PT", i) : undefined}
              disabled={isViewOnly && !isHps}
              hpsColorClass="text-[var(--ledger-pt)] font-bold"
              onCommit={(el) => onScoreCommit(el, studentId, "PT", i)}
              onHps={(val) => onHpsUpdate("PT", i, val)}
              onFocus={() => onCellFocus("PT", i)}
              rowIndex={rowIndex}
              ariaLabel={`PT ${i + 1} score for student, max ${ptScores[i]?.maxScore || 0}`}
              aims={!!(ptScores[i] as any)?.isAims || ptColIsAims[i]}
            />
          </TableCell>
        ))}

        {/* AIMS PT staging columns */}
        {aimsPT.map((a) => {
          const score = !isHps ? aimsByStudent[studentId]?.[a.assessmentId] : undefined;
          return (
            <TableCell
              key={`aims-pt-${a.assessmentId}`}
              className={`text-center text-[11px] font-bold border-r border-b border-slate-200 p-0 h-9 w-16 min-w-[64px] max-w-[64px] ${
                isHps
                  ? "bg-slate-800 border-y border-slate-700 bg-clip-padding text-[var(--ledger-aims)]"
                  : `text-[var(--ledger-aims)] ${score?.importedAt ? "bg-[var(--ledger-aims-bg)]" : ""}`
              }`}
              style={rowStyle}
              title={
                !isHps && score
                  ? `${score.pointsEarned}/${score.maxPoints} · ${a.title} · PT · attempt ${score.attemptNumber} · graded ${score.gradedAt?.slice(0, 10) ?? "?"}${score.importedAt ? " (imported)" : ""}`
                  : undefined
              }
            >
              {isHps ? a.maxPoints : score?.pointsEarned ?? <span className="text-slate-300">-</span>}
            </TableCell>
          );
        })}

        {/* PT TOTAL */}
        <TableCell
          className={`text-center text-[11px] font-bold border-r border-b border-slate-200 ${
            isHps ? "bg-slate-700 border-y border-slate-600 bg-clip-padding text-purple-200" : "bg-slate-50/50 text-slate-500"
          }`}
          style={rowStyle}
        >
          {isHps ? ptMaxTotal : ptTotal}
        </TableCell>
        {/* PT PS */}
        <TableCell
          className={`text-center font-bold text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-purple-900/60 border-y border-slate-700 bg-clip-padding text-purple-300" : "bg-purple-50/10 text-purple-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayPTPS)}
        </TableCell>
        {/* PT WS */}
        <TableCell
          className={`text-center font-bold text-[11px] border-r border-b border-slate-200 ${
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
          <LedgerScoreCell
            cat="QA"
            index={0}
            value={isHps ? qaMax : ((grade as any)?.qaStatus || (grade?.quarterlyAssessScore === 0 ? "" : (grade?.quarterlyAssessScore ?? "")))}
            status={!isHps ? (grade as any)?.qaStatus : undefined}
            isHps={!!isHps}
            invalid={!isHps ? isCellInvalid(studentId, "QA", 0) : undefined}
            disabled={isViewOnly && !isHps}
            hpsColorClass="text-[var(--ledger-ta)] font-bold"
            onCommit={(el) => onScoreCommit(el, studentId, "QA", 0)}
            onHps={(val) => onHpsUpdate("QA", 0, val)}
            onFocus={() => onCellFocus("QA", 0)}
            rowIndex={rowIndex}
            ariaLabel={`QA score for student, max ${qaMax}`}
          />
        </TableCell>

        {/* AIMS QA staging columns */}
        {aimsQA.map((a) => {
          const score = !isHps ? aimsByStudent[studentId]?.[a.assessmentId] : undefined;
          return (
            <TableCell
              key={`aims-qa-${a.assessmentId}`}
              className={`text-center text-[11px] font-bold border-r border-b border-slate-200 p-0 h-9 w-16 min-w-[64px] max-w-[64px] ${
                isHps
                  ? "bg-slate-800 border-y border-slate-700 bg-clip-padding text-[var(--ledger-aims)]"
                  : `text-[var(--ledger-aims)] ${score?.importedAt ? "bg-[var(--ledger-aims-bg)]" : ""}`
              }`}
              style={rowStyle}
              title={
                !isHps && score
                  ? `${score.pointsEarned}/${score.maxPoints} · ${a.title} · QA · attempt ${score.attemptNumber} · graded ${score.gradedAt?.slice(0, 10) ?? "?"}${score.importedAt ? " (imported)" : ""}`
                  : undefined
              }
            >
              {isHps ? a.maxPoints : score?.pointsEarned ?? <span className="text-slate-300">-</span>}
            </TableCell>
          );
        })}

        {/* QA PS */}
        <TableCell
          className={`text-center font-bold text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-amber-900/60 border-y border-slate-700 bg-clip-padding text-amber-300" : "bg-amber-50/10 text-amber-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.0" : formatNum(displayQAPS)}
        </TableCell>
        {/* QA WS */}
        <TableCell
          className={`text-center font-bold text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-amber-900/80 border-y border-slate-700 bg-clip-padding text-amber-200" : "bg-amber-50/20 text-amber-700"
          }`}
          style={rowStyle}
        >
          {isHps ? weights.qa.toFixed(1) : formatNum(displayQAWS)}
        </TableCell>

        {/* INITIAL */}
        <TableCell
          className={`text-center font-bold text-[11px] border-r border-b border-slate-200 ${
            isHps ? "bg-emerald-900/60 border-y border-slate-700 bg-clip-padding text-emerald-300" : "bg-emerald-50/10 text-emerald-600"
          }`}
          style={rowStyle}
        >
          {isHps ? "100.00" : formatInitialGrade(displayInitialGrade)}
        </TableCell>
        {/* FINAL */}
        <TableCell
          className={`text-center font-bold text-xs border-r border-b border-slate-200 w-16 min-w-[64px] max-w-[64px] ${
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
  /** Term labels from settings (e.g. "Term 1", "Term 2") */
  termLabels?: { T1: string; T2: string; T3: string };
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
  isCellInvalid: (sid: string, cat: "WW" | "PT" | "QA", idx: number) => string | undefined;
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
  onTermChange,
  lockedTerm,
  currentTerm,
  termLabels: termLabelsProp,
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
  aimsAllAssessments = [],
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

  const aimsCount = aimsAssessments.length;

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

  const renderColGroup = () => (
    <colgroup>
      <col style={{ width: "40px", minWidth: "40px", maxWidth: "40px" }} />
      <col style={{ width: "128px", minWidth: "128px", maxWidth: "128px" }} />
      <col style={{ width: "256px", minWidth: "256px", maxWidth: "256px" }} />
      {/* WW columns */}
      {Array.from({ length: wwCount }).map((_, i) => (
        <col key={`col-ww-${i}`} style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      ))}
      {aimsWW.map((a) => (
        <col key={`col-aims-ww-${a.assessmentId}`} style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
      ))}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      {/* PT columns */}
      {Array.from({ length: ptCount }).map((_, i) => (
        <col key={`col-pt-${i}`} style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      ))}
      {aimsPT.map((a) => (
        <col key={`col-aims-pt-${a.assessmentId}`} style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
      ))}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      {/* TA columns */}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      {aimsQA.map((a) => (
        <col key={`col-aims-qa-${a.assessmentId}`} style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
      ))}
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      <col style={{ width: "56px", minWidth: "56px", maxWidth: "56px" }} />
      {/* Grade columns */}
      <col style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
      <col style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
    </colgroup>
  );

  const thBase = "border-b border-slate-200 text-[11px] font-bold uppercase tracking-widest text-center px-0 bg-clip-padding";

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
            <div id="tutorial-period-controls" className="flex items-center gap-3">
              {isViewOnly && (
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-md px-2 py-0.5 flex items-center gap-1">
                  <Eye className="w-3 h-3" /> View Only — Past term grades are finalized
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
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Period:</span>
                {lockedTerm ? (
                  <span className="text-[11px] font-bold text-foreground bg-slate-100 border border-slate-200 rounded-lg px-3 py-1">
                    {termLabelsProp?.[lockedTerm as keyof typeof termLabelsProp] ?? (lockedTerm === 'T1' ? 'Term 1' : lockedTerm === 'T2' ? 'Term 2' : 'Term 3')} — fixed schedule
                  </span>
                ) : (
                <Select
                  value={selectedTerm}
                  onValueChange={(val) => {
                    if (val) onTermChange(val);
                  }}
                >
                  <SelectTrigger className="w-24 font-bold" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="shadow-2xl">
                    {terms.map((q) => {
                      const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
                      const isPastTerm = currentTerm && termOrder[q] < termOrder[currentTerm];
                      return (
                        <SelectItem
                          key={q}
                          value={q}
                          className="text-[11px] font-bold"
                          title={isPastTerm ? "Past term — view only" : undefined}
                        >
                          {q === "T1" ? "Term 1" : q === "T2" ? "Term 2" : "Term 3"}
                          {isPastTerm ? " (View Only)" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                )}
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
                    colSpan={wwCount + aimsWW.length + 3}
                    className={`${thBase} border-r text-[var(--ledger-ww)] bg-[var(--ledger-ww-bg)] z-20`}
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
                    colSpan={ptCount + aimsPT.length + 3}
                    className={`${thBase} border-r text-[var(--ledger-pt)] bg-[var(--ledger-pt-bg)] z-20`}
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
                    colSpan={3 + aimsQA.length}
                    className={`${thBase} border-r text-[var(--ledger-ta)] bg-[var(--ledger-ta-bg)] z-20`}
                  >
                    TA ({effectiveWeights?.qa ?? classAssignment.subject.quarterlyAssessWeight}%)
                  </TableHead>

                  <TableHead
                    colSpan={2}
                    className={`${thBase} border-r text-[var(--ledger-grade)] bg-[var(--ledger-grade-bg)] z-20`}
                  >
                    Grade Summary
                  </TableHead>
                </TableRow>

                {/* ── Row 2: Column sub-headers ── */}
                <TableRow ref={subRowRef} className="hover:bg-transparent border-0 h-9 bg-white transition-none">
                  <TableHead className="w-10 min-w-[40px] max-w-[40px] text-center text-[11px] font-bold text-slate-400 uppercase border-l border-r border-b border-slate-200 bg-white sticky left-0 z-[25] bg-clip-padding">#</TableHead>
                  <TableHead className="w-32 min-w-[128px] max-w-[128px] text-[11px] font-bold text-slate-400 uppercase border-r border-b border-slate-200 px-1 bg-white sticky left-[40px] z-[25] bg-clip-padding">LRN</TableHead>
                  <TableHead className="w-64 min-w-[256px] max-w-[256px] text-[11px] font-bold text-slate-400 uppercase border-r border-b border-slate-200 px-2 bg-white sticky left-[168px] z-[25] bg-clip-padding shadow-[2px_0_8px_-1px_rgba(0,0,0,0.06)]">Full Name</TableHead>

                  {Array.from({ length: wwCount }).map((_, i) => (
                    <TableHead key={`h-ww-${i}`} className={`w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold uppercase border-r border-b border-slate-200 bg-clip-padding cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 transition-colors ${wwColIsAims[i] ? "text-[var(--ledger-aims)] bg-[var(--ledger-aims-bg)]" : "text-slate-400 bg-white"}`} onClick={() => onCellFocus("WW", i)} title={wwColAimsTitle[i]}>{i + 1}</TableHead>
                  ))}
                  {aimsWW.map((a) => (
                    <TableHead key={`h-aims-ww-${a.assessmentId}`} className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-bold text-[var(--ledger-aims)] uppercase border-r border-b border-slate-200 bg-[var(--ledger-aims-bg)] bg-clip-padding" title={`${a.title} — ${a.maxPoints} max`}>
                      <span>{wwCount + 1}</span>
                    </TableHead>
                  ))}
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold text-slate-500 uppercase border-r border-b border-slate-200 bg-slate-100 bg-clip-padding">Total</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold text-indigo-600 uppercase border-r border-b border-slate-200 bg-indigo-50 bg-clip-padding">PS</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold text-indigo-700 uppercase border-r border-b border-slate-200 bg-indigo-100 bg-clip-padding">WS</TableHead>

                  {Array.from({ length: ptCount }).map((_, i) => (
                    <TableHead key={`h-pt-${i}`} className={`w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold uppercase border-r border-b border-slate-200 bg-clip-padding cursor-pointer hover:bg-purple-50 hover:text-purple-600 transition-colors ${ptColIsAims[i] ? "text-[var(--ledger-aims)] bg-[var(--ledger-aims-bg)]" : "text-slate-400 bg-white"}`} onClick={() => onCellFocus("PT", i)} title={ptColAimsTitle[i]}>{i + 1}</TableHead>
                  ))}
                  {aimsPT.map((a) => (
                    <TableHead key={`h-aims-pt-${a.assessmentId}`} className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-bold text-[var(--ledger-aims)] uppercase border-r border-b border-slate-200 bg-[var(--ledger-aims-bg)] bg-clip-padding" title={`${a.title} — ${a.maxPoints} max`}>
                      <span>{ptCount + 1}</span>
                    </TableHead>
                  ))}
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold text-slate-500 uppercase border-r border-b border-slate-200 bg-slate-100 bg-clip-padding">Total</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold text-purple-600 uppercase border-r border-b border-slate-200 bg-purple-50 bg-clip-padding">PS</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold text-purple-700 uppercase border-r border-b border-slate-200 bg-purple-100 bg-clip-padding">WS</TableHead>

                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => onCellFocus("QA", 0)}>Score</TableHead>
                  {aimsQA.map((a) => (
                    <TableHead key={`h-aims-qa-${a.assessmentId}`} className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-bold text-[var(--ledger-aims)] uppercase border-r border-b border-slate-200 bg-[var(--ledger-aims-bg)] bg-clip-padding" title={`${a.title} — ${a.maxPoints} max`}>
                      <span>AIMS</span>
                    </TableHead>
                  ))}
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold text-amber-600 uppercase border-r border-b border-slate-200 bg-amber-50 bg-clip-padding">PS</TableHead>
                  <TableHead className="w-14 min-w-[56px] max-w-[56px] px-1 text-center text-[11px] font-bold text-amber-700 uppercase border-r border-b border-slate-200 bg-amber-100 bg-clip-padding">WS</TableHead>

                  <TableHead className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-bold text-emerald-600 uppercase border-r border-b border-slate-200 bg-emerald-50 bg-clip-padding">Initial</TableHead>
                  <TableHead className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-bold text-slate-900 uppercase bg-emerald-100 bg-clip-padding border-r border-b border-slate-200">Grade</TableHead>
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
          <Table className="border-separate border-spacing-0 table-fixed min-w-full">
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
