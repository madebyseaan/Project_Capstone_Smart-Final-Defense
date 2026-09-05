import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Clock, Siren, X, ArrowRight, BookOpen, PhoneCall, FileWarning, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GradeDeadlineInfo } from "@/lib/api";

interface GradeDeadlineBannerProps {
  deadline?: GradeDeadlineInfo | null;
  hideLink?: boolean;
}

function formatDeadlineDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const DISMISS_KEY_PREFIX = "gradeDeadlineDismissed_";

// ─── Collapsible Overdue Sub-component ────────────────────────────────────────
interface OverdueBannerProps {
  termLabel: string;
  termEndDate: string | null;
  daysOverdue: number;
  incompleteCount: number;
  incompleteClasses: GradeDeadlineInfo["incompleteClasses"];
  hideLink: boolean;
}

function OverdueBanner({
  termLabel,
  termEndDate,
  daysOverdue,
  incompleteCount,
  incompleteClasses,
  hideLink,
}: OverdueBannerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-red-200/80 bg-red-50/90 shadow-sm animate-fade-in">
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left py-2.5 px-4 flex items-center gap-3 hover:bg-red-100/50 transition-colors group"
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
          <FileWarning className="w-4 h-4 text-red-600" />
        </div>

        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span className="text-xs font-semibold text-red-800 whitespace-nowrap">
            Overdue — Grades Not Submitted
          </span>
          <span className="px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 text-[10px] font-bold whitespace-nowrap">
            {daysOverdue}d overdue
          </span>
          <span className="text-xs text-red-700/70 font-medium hidden sm:inline">
            {termLabel}{termEndDate && ` · due ${formatDeadlineDate(termEndDate)}`} · {incompleteCount} missing
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-red-600 text-white text-[10px] font-semibold">
            <PhoneCall className="w-3 h-3" />
            Contact Admin
          </div>
          <div className="w-6 h-6 rounded-md bg-red-100 flex items-center justify-center text-red-400 group-hover:bg-red-200 transition-colors">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-red-200/60">
          <div className="bg-red-50/60 px-4 py-2 grid grid-cols-3 gap-3">
            <span className="text-[9px] font-bold uppercase tracking-widest text-red-400">Subject</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-red-400">Section</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-red-400 text-right">Progress</span>
          </div>
          <div className="divide-y divide-red-50 bg-white max-h-[200px] overflow-y-auto">
            {incompleteClasses.map((cls, idx) => {
              const pct = cls.totalStudents > 0
                ? Math.round((cls.gradedCount / cls.totalStudents) * 100)
                : 0;
              return (
                <div key={idx} className="px-4 py-2.5 grid grid-cols-3 gap-3 items-center hover:bg-red-50/40 transition-colors">
                  <p className="text-sm font-semibold text-foreground truncate">{cls.subjectName}</p>
                  <p className="text-xs text-muted-foreground truncate">{cls.sectionName}</p>
                  <div className="flex items-center justify-end gap-2">
                    <div className="flex-1 max-w-[60px] h-1.5 bg-red-100 rounded-full overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-red-600 whitespace-nowrap tabular-nums">
                      {cls.gradedCount}/{cls.totalStudents}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bg-red-50/60 border-t border-red-100 px-4 py-2.5 flex items-center justify-between gap-3">
            <p className="text-[10px] text-red-500">Contact your school administrator to resolve overdue grades.</p>
            {!hideLink && (
              <Link to="/teacher/classes" className="flex-shrink-0">
                <Button size="sm" className="h-8 px-3 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm">
                  <BookOpen className="w-3 h-3 mr-1.5" />
                  Open Records
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GradeDeadlineBanner({ deadline, hideLink = false }: GradeDeadlineBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const dismissKey = deadline
    ? `${DISMISS_KEY_PREFIX}${deadline.currentTerm}_${deadline.termEndDate?.slice(0, 10)}`
    : null;

  useEffect(() => {
    if (!dismissKey) return;
    const alreadyDismissed = sessionStorage.getItem(dismissKey) === "true";
    setDismissed(alreadyDismissed);
  }, [dismissKey]);

  if (!deadline) return null;
  if (!deadline.hasIncompleteClasses) return null;
  if (dismissed && deadline.urgencyLevel === "warn") return null;

  const { urgencyLevel, daysRemaining, termEndDate, currentTerm, incompleteCount, incompleteClasses } = deadline;

  const termLabel =
    currentTerm === "T1" ? "Term 1"
    : currentTerm === "T2" ? "Term 2"
    : currentTerm === "T3" ? "Term 3"
    : currentTerm;

  const handleDismiss = () => {
    if (dismissKey) sessionStorage.setItem(dismissKey, "true");
    setDismissed(true);
  };

  // ─── OVERDUE ──────────────────────────────────────────────────────────────
  if (urgencyLevel === "overdue") {
    const daysOverdue = Math.abs(daysRemaining ?? 0);
    return (
      <OverdueBanner
        termLabel={termLabel}
        termEndDate={termEndDate}
        daysOverdue={daysOverdue}
        incompleteCount={incompleteCount}
        incompleteClasses={incompleteClasses}
        hideLink={hideLink}
      />
    );
  }

  // ─── Warn (≤ 7 days) ─────────────────────────────────────────────────────
  if (urgencyLevel === "warn") {
    return (
      <div className="flex items-center gap-3 py-2.5 px-4 rounded-xl bg-amber-50/90 border border-amber-200/80 text-amber-900 shadow-sm animate-fade-in">
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
          <Clock className="w-4 h-4 text-amber-600" />
        </div>
        <p className="flex-1 text-sm font-medium text-amber-800">
          {termLabel} grades due in{" "}
          <span className="font-semibold">{daysRemaining}d</span>
          {termEndDate && ` (${formatDeadlineDate(termEndDate)})`} — {incompleteCount} class{incompleteCount !== 1 ? "es" : ""} incomplete
        </p>
        {!hideLink && (
          <Link to="/teacher/classes">
            <Button className="h-8 px-3 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm">
              Submit
            </Button>
          </Link>
        )}
        <button
          onClick={handleDismiss}
          className="p-1 rounded-lg text-amber-700 hover:bg-amber-200/50 transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // ─── Urgent (≤ 3 days) ───────────────────────────────────────────────────
  if (urgencyLevel === "urgent") {
    return (
      <div className="flex items-center gap-3 py-2.5 px-4 rounded-xl bg-orange-50/90 border border-orange-200/80 text-orange-900 shadow-sm animate-fade-in">
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4 text-orange-600" />
        </div>
        <p className="flex-1 text-sm font-medium text-orange-800">
          <span className="font-semibold">{daysRemaining}d left</span> to submit {termLabel} grades
          {termEndDate && ` (due ${formatDeadlineDate(termEndDate)})`} — {incompleteCount} class{incompleteCount !== 1 ? "es" : ""} pending
        </p>
        {!hideLink && (
          <Link to="/teacher/classes">
            <Button className="h-8 px-3 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-700 text-white shadow-sm group">
              Submit Now
              <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </Link>
        )}
      </div>
    );
  }

  // ─── Critical (≤ 1 day) ──────────────────────────────────────────────────
  if (urgencyLevel === "critical") {
    const isToday = daysRemaining === 0;
    return (
      <div className="flex items-center gap-3 py-2.5 px-4 rounded-xl bg-rose-50/90 border border-rose-200/80 text-rose-900 shadow-sm animate-fade-in">
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center">
          <Siren className="w-4 h-4 text-rose-600 animate-pulse" />
        </div>
        <p className="flex-1 text-sm font-medium text-rose-800">
          {isToday
            ? `${termLabel} grades due TODAY`
            : `${termLabel} grades due TOMORROW`}
          {termEndDate && ` (${formatDeadlineDate(termEndDate)})`} — {incompleteCount} class{incompleteCount !== 1 ? "es" : ""} remaining
        </p>
        {!hideLink && (
          <Link to="/teacher/classes">
            <Button className="h-8 px-3 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm group">
              Submit Now
              <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </Link>
        )}
      </div>
    );
  }

  return null;
}
