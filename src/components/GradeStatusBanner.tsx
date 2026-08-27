import React from "react";
import { AlertTriangle, CheckCircle, Clock, Lock, Pencil } from "lucide-react";

interface GradeStatusBannerProps {
  currentTerm: string;
  selectedTerm?: string;
  termEndDate?: string | null;
  gradeLock: boolean;
  colors: { primary: string };
  editRequestStatus?: "idle" | "pending" | "approved" | "rejected";
  editTimeRemaining?: string;
  onRequestEdit?: () => void;
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((a.getTime() - b.getTime()) / msPerDay);
}

function getTermLabel(term: string): string {
  return term === "T1" ? "Term 1" : term === "T2" ? "Term 2" : term === "T3" ? "Term 3" : term;
}

const TERM_ORDER: Record<string, number> = { T1: 1, T2: 2, T3: 3 };

export const GradeStatusBanner = React.memo(function GradeStatusBanner({
  currentTerm,
  selectedTerm,
  termEndDate,
  gradeLock,
  colors,
  editRequestStatus = "idle",
  editTimeRemaining,
  onRequestEdit,
}: GradeStatusBannerProps) {
  const isViewingPastTerm = selectedTerm && currentTerm && TERM_ORDER[selectedTerm] < TERM_ORDER[currentTerm];

  // --- Locked ---
  if (gradeLock) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs mb-3">
        <Lock className="w-3.5 h-3.5 text-red-500 shrink-0" />
        <span className="font-medium text-red-700">Grades locked for EOSY</span>
      </div>
    );
  }

  // --- Past term: edit request states ---
  if (isViewingPastTerm) {
    if (editRequestStatus === "approved") {
      // Parse remaining time for progress bar (rough estimate)
      const match = editTimeRemaining?.match(/(?:(\d+)h\s*)?(\d+)m/);
      const totalMinutes = match ? (parseInt(match[1] || "0") * 60) + parseInt(match[2]) : 120;
      const maxMinutes = 120; // default 2h window for visual
      const pct = Math.min(100, Math.max(5, (totalMinutes / maxMinutes) * 100));

      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 mb-3 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="font-semibold text-emerald-800">
                Editing {getTermLabel(selectedTerm!)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-700 font-bold">
              <Clock className="w-3.5 h-3.5" />
              <span>{editTimeRemaining}</span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-emerald-100">
            <div
              className="h-full bg-emerald-400 transition-all duration-1000 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      );
    }

    if (editRequestStatus === "pending") {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs mb-3">
          <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="font-medium text-amber-700">Edit request pending admin approval</span>
        </div>
      );
    }

    // idle — show request button inline
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs mb-3">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-slate-600">
            {getTermLabel(selectedTerm!)} is finalized — read-only
          </span>
        </div>
        {onRequestEdit && (
          <button
            onClick={onRequestEdit}
            className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Request Access
          </button>
        )}
      </div>
    );
  }

  // --- Current term: deadline warnings ---
  if (!termEndDate) return null;

  const now = new Date();
  const endDate = new Date(termEndDate);
  const daysRemaining = daysBetween(endDate, now);

  if (daysRemaining > 0) {
    if (daysRemaining <= 3) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs mb-3">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
          <span className="text-red-700">
            <span className="font-semibold">{daysRemaining} day{daysRemaining !== 1 ? "s" : ""} left</span>
            {" — deadline "}{endDate.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
          </span>
        </div>
      );
    }

    if (daysRemaining <= 7) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs mb-3">
          <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="text-amber-700">
            <span className="font-semibold">{daysRemaining} days left</span>
            {" — deadline "}{endDate.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
          </span>
        </div>
      );
    }

    if (daysRemaining <= 14) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs mb-3">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="text-emerald-700">
            {daysRemaining} days remaining — deadline{" "}
            {endDate.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
          </span>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs mb-3">
      <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
      <span className="text-amber-700">
        {getTermLabel(currentTerm)} ended — grades editable until locked
      </span>
    </div>
  );
});
