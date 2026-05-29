import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Clock, Siren, X, ArrowRight, BookOpen, PhoneCall, FileWarning, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GradeDeadlineInfo } from "@/lib/api";

interface GradeDeadlineBannerProps {
  /** Pass deadline data directly (from dashboard API response). */
  deadline?: GradeDeadlineInfo | null;
  /** If true the "Go to Class Records" button is hidden (we're already there). */
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
    <div className="overflow-hidden rounded-2xl border-2 border-red-200 bg-white shadow-lg shadow-red-100/40 animate-fade-in">
      {/* Thin red accent bar */}
      <div className="h-1 bg-gradient-to-r from-red-600 to-rose-400 w-full" />

      {/* Collapsed header — always visible, clickable to toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-red-50/50 transition-colors group"
      >
        {/* Icon */}
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-100 border border-red-200 flex items-center justify-center">
          <FileWarning className="w-5 h-5 text-red-600" />
        </div>

        {/* Labels */}
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-red-600 whitespace-nowrap">
            ⛔ Overdue — Grades Not Submitted
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-red-100 text-red-700 text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
            {daysOverdue} {daysOverdue === 1 ? "day" : "days"} overdue
          </span>
          <span className="text-xs text-slate-500 font-medium hidden sm:inline">
            {termLabel}
            {termEndDate && ` · was due ${formatDeadlineDate(termEndDate)}`}
            {" · "}
            <span className="font-black text-red-600">
              {incompleteCount} {incompleteCount === 1 ? "subject" : "subjects"} missing
            </span>
          </span>
        </div>

        {/* Right side: Contact Admin pill + chevron */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 text-white shadow-sm">
            <PhoneCall className="w-3.5 h-3.5" />
            <span className="text-[9px] font-black uppercase tracking-widest">Contact Admin</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-400 group-hover:bg-red-100 transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </button>

      {/* Expandable subject table */}
      {expanded && (
        <div className="border-t border-red-100">
          {/* Sub-info bar (mobile) */}
          <div className="sm:hidden px-5 py-3 bg-red-50 border-b border-red-100 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-600 font-medium">
              {termLabel}{termEndDate && ` · was due ${formatDeadlineDate(termEndDate)}`}
            </p>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 text-white">
              <PhoneCall className="w-3 h-3" />
              <span className="text-[9px] font-black uppercase tracking-widest">Contact Admin</span>
            </div>
          </div>

          {/* Table header */}
          <div className="bg-red-50/60 px-5 py-2.5 grid grid-cols-3 gap-4">
            <span className="text-[9px] font-black uppercase tracking-widest text-red-400">Subject</span>
            <span className="text-[9px] font-black uppercase tracking-widest text-red-400">Section</span>
            <span className="text-[9px] font-black uppercase tracking-widest text-red-400 text-right">Progress</span>
          </div>

          {/* Rows — capped height with scroll if many */}
          <div className="divide-y divide-red-50 bg-white max-h-[260px] overflow-y-auto">
            {incompleteClasses.map((cls, idx) => {
              const pct = cls.totalStudents > 0
                ? Math.round((cls.gradedCount / cls.totalStudents) * 100)
                : 0;
              return (
                <div key={idx} className="px-5 py-3 grid grid-cols-3 gap-4 items-center hover:bg-red-50/40 transition-colors">
                  <p className="text-sm font-bold text-slate-900 truncate">{cls.subjectName}</p>
                  <p className="text-xs font-medium text-slate-500 truncate">{cls.sectionName}</p>
                  <div className="flex items-center justify-end gap-2">
                    <div className="flex-1 max-w-[70px] h-1.5 bg-red-100 rounded-full overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-black text-red-600 whitespace-nowrap tabular-nums">
                      {cls.gradedCount}/{cls.totalStudents}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="bg-red-50/60 border-t border-red-100 px-5 py-3 flex items-center justify-between gap-4">
            <p className="text-[10px] font-medium text-red-500">
              Contact your school administrator to resolve overdue grades.
            </p>
            {!hideLink && (
              <Link to="/teacher/classes" className="flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-4 rounded-xl border-red-200 text-red-600 hover:bg-red-600 hover:text-white font-black text-[9px] tracking-widest uppercase transition-all"
                >
                  <BookOpen className="w-3.5 h-3.5 mr-1.5" />
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

/**
 * GradeDeadlineBanner
 *
 * Renders nothing when:
 *  - No deadline info is provided / urgencyLevel === 'none'
 *  - Teacher has no incomplete classes
 *  - 'warn' tier and the teacher already dismissed it this session
 */
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

  // ─── OVERDUE Tier (deadline passed, grades still missing) ─────────────────
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

  // ─── Warn Tier (≤ 7 days) ──────────────────────────────────────────────────
  if (urgencyLevel === "warn") {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-md shadow-amber-100/50 animate-fade-in">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-amber-200/30 blur-2xl pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center">
            <Clock className="w-6 h-6 text-amber-600" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 mb-1">
              Grade Submission Reminder
            </p>
            <p className="text-sm font-black text-slate-900 leading-snug">
              {termLabel} grade submission deadline is in{" "}
              <span className="text-amber-600">
                {daysRemaining} {daysRemaining === 1 ? "day" : "days"}
              </span>
              {termEndDate && ` (${formatDeadlineDate(termEndDate)})`}.
            </p>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {incompleteCount} {incompleteCount === 1 ? "class has" : "classes have"} incomplete grades — submit before the deadline.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {!hideLink && (
              <Link to="/teacher/classes">
                <Button
                  size="sm"
                  className="h-10 px-5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-[10px] tracking-widest uppercase border-0 shadow-lg shadow-amber-200 transition-all active:scale-95"
                >
                  <BookOpen className="w-3.5 h-3.5 mr-2" />
                  Submit Grades
                </Button>
              </Link>
            )}
            <button
              onClick={handleDismiss}
              className="w-9 h-9 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-600 flex items-center justify-center transition-colors"
              title="Dismiss reminder"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Urgent Tier (≤ 3 days) ───────────────────────────────────────────────
  if (urgencyLevel === "urgent") {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-5 shadow-lg shadow-orange-100/60 animate-fade-in">
        <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-orange-200/40 blur-2xl pointer-events-none" />
        <div className="absolute top-0 left-0 h-full w-1 bg-gradient-to-b from-orange-400 to-amber-500 rounded-l-3xl" />

        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4 pl-3">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-orange-100 border border-orange-200 flex items-center justify-center shadow-sm">
            <AlertTriangle className="w-6 h-6 text-orange-600" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600 mb-1">
              ⚠ Urgent — Grade Submission
            </p>
            <p className="text-sm font-black text-slate-900 leading-snug">
              Only{" "}
              <span className="text-orange-600">
                {daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining
              </span>{" "}
              to submit {termLabel} grades
              {termEndDate && ` (due ${formatDeadlineDate(termEndDate)})`}.
            </p>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {incompleteCount} {incompleteCount === 1 ? "class still needs" : "classes still need"} grade entries. Act now to avoid late submission.
            </p>
          </div>

          {!hideLink && (
            <div className="flex-shrink-0">
              <Link to="/teacher/classes">
                <Button
                  size="sm"
                  className="h-11 px-6 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-[10px] tracking-widest uppercase border-0 shadow-xl shadow-orange-200 transition-all active:scale-95 group"
                >
                  Submit Now
                  <ArrowRight className="w-3.5 h-3.5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Critical Tier (≤ 1 day / today) ─────────────────────────────────────
  if (urgencyLevel === "critical") {
    const isToday = daysRemaining === 0;

    return (
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-rose-600 to-red-600 p-5 shadow-2xl shadow-rose-300/50 animate-fade-in">
        <div className="absolute inset-0 rounded-3xl ring-4 ring-rose-400 ring-opacity-30 animate-pulse pointer-events-none" />
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-rose-500/30 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-red-500/20 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center shadow-lg">
            <Siren className="w-7 h-7 text-white animate-pulse" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-rose-200 mb-1">
              🚨 Final Warning — Grade Deadline
            </p>
            <p className="text-base font-black text-white leading-snug">
              {isToday
                ? `${termLabel} grade submission is DUE TODAY!`
                : `${termLabel} grade submission is due TOMORROW${termEndDate ? ` (${formatDeadlineDate(termEndDate)})` : ""}!`}
            </p>
            <p className="text-sm text-rose-200 font-semibold mt-1">
              {incompleteCount} {incompleteCount === 1 ? "class" : "classes"} with incomplete grades. This is your last chance to submit!
            </p>
          </div>

          {!hideLink && (
            <div className="flex-shrink-0">
              <Link to="/teacher/classes">
                <Button
                  size="sm"
                  className="h-12 px-7 rounded-2xl bg-white text-rose-600 hover:bg-rose-50 font-black text-[10px] tracking-widest uppercase border-0 shadow-2xl shadow-rose-800/30 transition-all active:scale-95 group"
                >
                  <BookOpen className="w-4 h-4 mr-2" />
                  GO TO CLASS RECORDS
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
