import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Award,
  BookOpen,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SURFACE } from "./MobileDashboardTokens";
import type { ClassAssignment, TermLabels } from "@/lib/api";

interface MobileClassRecordHeroProps {
  classAssignment: ClassAssignment;
  activeWeights: { ww: number; pt: number; qa: number };
  stats?: { avg: number; passed: number; total?: number; highest: number; lowest: number } | null;
  selectedTerm: string;
  onTermChange: (term: string) => void;
  lockedTerm: string | null;
  termLabels?: TermLabels;
  isViewOnly?: boolean;
  toolsSlot?: ReactNode;
  rotationSlot?: ReactNode;
}

const termTitles: Record<string, string> = {
  T1: "Term 1",
  T2: "Term 2",
  T3: "Term 3",
};

function MetricTile({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof Target;
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <div className={cn("p-4", SURFACE)}>
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tone)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="mt-3 text-[1.35rem] font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1.5 text-[0.8rem] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

export default function MobileClassRecordHero({
  classAssignment,
  activeWeights,
  stats,
  selectedTerm,
  onTermChange,
  lockedTerm,
  termLabels,
  isViewOnly = false,
  toolsSlot,
  rotationSlot,
}: MobileClassRecordHeroProps) {
  const passingRate =
    stats && stats.total && stats.total > 0
      ? `${Math.round((stats.passed / stats.total) * 100)}%`
      : "—";

  return (
    <div className="motion-stagger space-y-3 lg:hidden">
      <div className={cn("relative overflow-hidden p-4", SURFACE)}>
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/teacher/classes"
            aria-label="Back to class records"
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-border/70 bg-background text-muted-foreground transition-colors active:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>

          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.8rem] font-semibold",
              isViewOnly
                ? "bg-blue-500/10 text-blue-600"
                : "bg-emerald-500/10 text-emerald-600",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isViewOnly ? "bg-blue-500" : "bg-emerald-500",
              )}
              aria-hidden="true"
            />
            {isViewOnly ? "View only" : "Entry mode"}
          </span>
        </div>

        <div className="mt-4 flex items-start gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <BookOpen className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-foreground">
              {classAssignment.subject.name}
            </h1>
            <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
              {classAssignment.section.gradeLevel.replace("GRADE_", "Grade ")} · Section{" "}
              {classAssignment.section.name}
            </p>
            <p className="mt-0.5 text-[0.8rem] font-medium text-muted-foreground">
              {classAssignment.schoolYear}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[0.8rem] font-semibold text-primary">
            WW {activeWeights.ww}% · PT {activeWeights.pt}% · QA {activeWeights.qa}%
          </span>
        </div>

        <div className="mt-4 flex gap-1 rounded-xl bg-muted p-1">
          {(["T1", "T2", "T3"] as const).map((term) => {
            const active = selectedTerm === term;
            const disabled = !!lockedTerm && lockedTerm !== term;
            return (
              <button
                key={term}
                type="button"
                onClick={() => !disabled && onTermChange(term)}
                disabled={disabled}
                aria-pressed={active}
                className={cn(
                  "min-h-12 flex-1 rounded-lg text-[0.8rem] font-semibold transition-colors disabled:opacity-40",
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {termLabels?.[term] ?? termTitles[term]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          icon={Target}
          value={stats ? stats.avg.toFixed(1) : "—"}
          label="Average"
          tone="bg-primary/10 text-primary"
        />
        <MetricTile
          icon={TrendingUp}
          value={passingRate}
          label="Passing"
          tone="bg-emerald-500/10 text-emerald-600"
        />
        <MetricTile
          icon={Award}
          value={stats ? String(stats.highest) : "—"}
          label="Highest"
          tone="bg-amber-500/10 text-amber-600"
        />
        <MetricTile
          icon={TrendingDown}
          value={stats ? String(stats.lowest) : "—"}
          label="Lowest"
          tone="bg-rose-500/10 text-rose-600"
        />
      </div>

      {toolsSlot && (
        <div className={cn("flex gap-2 p-2 [&>button]:min-w-0 [&>button]:flex-1", SURFACE)}>
          {toolsSlot}
        </div>
      )}

      {rotationSlot}
    </div>
  );
}
