import React from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ClassRecord, ScoreItem, AimsAssessmentInfo, AimsRowScore } from "@/lib/api";
import { getGradeColor, transmuteGrade, type TransmutationRow } from "@/lib/gradeMath";
import { LedgerScoreCell } from "./LedgerScoreCell";

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

export const LedgerRow = React.memo(
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
