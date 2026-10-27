import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { 
  ArrowLeft, 
  Eye, 
  Sparkles, 
  User, 
  Target, 
  TrendingUp, 
  Award, 
  TrendingDown 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClassAssignment, TermLabels } from "@/lib/api";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

const termTitles: Record<string, string> = {
  T1: "Term 1",
  T2: "Term 2",
  T3: "Term 3",
};

interface ClassRecordHeroProps {
  classAssignment: ClassAssignment;
  effectiveWeightsSource: "subject-override" | "subject-type" | "generic-fallback" | null;
  activeWeights: { ww: number; pt: number; qa: number };
  stats?: { avg: number; passed: number; total?: number; highest: number; lowest: number } | null;
  onStartTour?: () => void;
  selectedTerm: string;
  onTermChange: (term: string) => void;
  lockedTerm: string | null;
  termLabels?: TermLabels;
  isViewOnly?: boolean;
  userName: string;
  /** Tools cluster (AIMS / Excel actions) rendered on the right of the telemetry bar */
  toolsSlot?: ReactNode;
  /** Rotation info strip rendered at the bottom of the hero card */
  rotationSlot?: ReactNode;
}

export function ClassRecordHero({
  classAssignment,
  effectiveWeightsSource,
  activeWeights,
  stats,
  onStartTour,
  selectedTerm,
  onTermChange,
  lockedTerm,
  termLabels,
  isViewOnly = false,
  userName,
  toolsSlot,
  rotationSlot,
}: ClassRecordHeroProps) {
  const passingRate = stats && stats.total != null && stats.total > 0 
    ? `${Math.round((stats.passed / stats.total) * 100)}%` 
    : "0%";

  return (
    <div className="bg-card transition-all">
      {/* Top Accent Line */}
      <div className="h-1 bg-primary" />

      {/* Top Utility & Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 lg:px-6">
        {/* Left: Back Arrow + Breadcrumb */}
        <div className="flex min-w-0 items-center gap-2 lg:gap-3">
          <Link to="/teacher/classes" aria-label="Back to class records">
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 rounded-xl border border-border bg-muted/50 text-muted-foreground transition-all hover:bg-primary hover:text-primary-foreground lg:h-8 lg:w-8 lg:rounded-lg"
              title="Back to class records"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
            <span className="hidden sm:inline">Class Record</span>
            <span className="hidden sm:inline">/</span>
            <span className="truncate font-semibold text-foreground">
              {gradeLevelLabels[classAssignment.section.gradeLevel] ?? classAssignment.section.gradeLevel} - {classAssignment.section.name}
            </span>
          </div>
        </div>

        {/* Right Action Cluster */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Term Switcher (Preserves tutorial-period-controls ID) */}
          <div id="tutorial-period-controls" className="flex items-center rounded-lg border border-border bg-muted p-0.5">
            {(["T1", "T2", "T3"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => !lockedTerm && onTermChange(t)}
                disabled={!!lockedTerm && lockedTerm !== t}
                className={cn(
                  "h-12 rounded-md px-2.5 text-[11px] font-semibold transition-all lg:h-6",
                  selectedTerm === t
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {termLabels?.[t] ?? termTitles[t]}
              </button>
            ))}
          </div>

          {/* Interactive Tutorial Button */}
          {onStartTour && (
            <Button
              variant="outline"
              size="sm"
              onClick={onStartTour}
              className="hidden h-12 gap-1.5 rounded-xl border-amber-200 bg-amber-50/80 px-3 text-xs font-semibold uppercase tracking-wide text-amber-900 shadow-xs hover:bg-amber-100 lg:inline-flex lg:h-8 lg:rounded-lg"
              title="Start Step-by-Step Interactive Tutorial"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
              <span>Tutorial</span>
            </Button>
          )}

          {/* View / Entry Mode Badge */}
          {isViewOnly ? (
            <Badge className="h-9 gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 text-[11px] font-semibold text-blue-700 lg:h-8">
              <Eye className="w-3 h-3" /> View Only
            </Badge>
          ) : (
            <Badge className="h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-700 lg:h-8">
              Grade Entry Mode
            </Badge>
          )}
        </div>
      </div>

      {/* Hero Subject & Metadata Area (Preserves tutorial-hero-info ID) */}
      <div id="tutorial-hero-info" className="bg-card px-4 py-4 lg:px-6">
        <div className="flex flex-col gap-1.5">
          {/* Main Subject Title */}
          <h1 className="text-xl font-bold tracking-tight text-foreground lg:text-2xl">
            {classAssignment.subject.name}
          </h1>

          {/* Clean Metadata Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-muted text-foreground border-border text-[11px] font-bold px-2.5 py-0.5 rounded-md">
              {gradeLevelLabels[classAssignment.section.gradeLevel] ?? classAssignment.section.gradeLevel} · Section {classAssignment.section.name}
            </Badge>

            <Badge className="hidden items-center gap-1.5 rounded-md border-border bg-muted px-2.5 py-0.5 text-[11px] font-medium text-foreground sm:inline-flex">
              <User className="w-3 h-3 text-muted-foreground" />
              <span>Teacher:</span>
              <span className="text-foreground font-semibold">{userName}</span>
            </Badge>

            <Badge className="bg-primary/10 text-primary border-primary/20 text-[11px] font-bold px-2.5 py-0.5 rounded-md">
              Weights: WW {activeWeights.ww}% · PT {activeWeights.pt}% · QA {activeWeights.qa}%
            </Badge>

            {effectiveWeightsSource === "subject-override" && (
              <span className="hidden text-[10px] font-medium uppercase tracking-wide text-primary lg:inline">
                (Custom Weights)
              </span>
            )}
            {effectiveWeightsSource === "subject-type" && (
              <span className="hidden text-[10px] font-medium uppercase tracking-wide text-muted-foreground lg:inline">
                (Group Defaults)
              </span>
            )}
            {effectiveWeightsSource === "generic-fallback" && (
              <span className="hidden text-[10px] font-medium uppercase tracking-wide text-amber-600 lg:inline">
                (Generic 20/50/30)
              </span>
            )}

            <div className="mx-1 hidden h-3.5 w-px bg-border lg:block" />

            <span className="hidden text-[10px] font-medium uppercase tracking-wide text-muted-foreground lg:inline">
              DepEd Form 7-A (E-Class Record)
            </span>
          </div>
        </div>
      </div>

      {/* Telemetry — compact strip on phones, detailed bar on desktop */}
      {(stats || toolsSlot) && (
        <div id="tutorial-stats-overview" className="border-t border-border bg-muted/40">
          {stats && (
            <>
              <div className="hidden flex-wrap items-center gap-6 px-6 py-2.5 text-xs lg:flex">
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-primary/10 p-1 text-primary">
                    <Target className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Class Average:</span>
                  <span className="text-sm font-semibold text-foreground">{stats.avg.toFixed(1)}</span>
                </div>

                <div className="h-3.5 w-px bg-border" />

                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-emerald-50 p-1 text-emerald-600">
                    <TrendingUp className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Passing Rate:</span>
                  <span className="text-sm font-semibold text-foreground">{passingRate}</span>
                  <span className="text-[11px] font-semibold text-muted-foreground">({stats.passed}/{stats.total})</span>
                </div>

                <div className="h-3.5 w-px bg-border" />

                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-amber-50 p-1 text-amber-600">
                    <Award className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Highest Grade:</span>
                  <span className="text-sm font-semibold text-foreground">{stats.highest}</span>
                </div>

                <div className="h-3.5 w-px bg-border" />

                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-rose-50 p-1 text-rose-600">
                    <TrendingDown className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lowest Grade:</span>
                  <span className="text-sm font-semibold text-foreground">{stats.lowest}</span>
                </div>
              </div>

              <div className="grid grid-cols-4 divide-x divide-border lg:hidden">
                {[
                  { label: "Average", value: stats.avg.toFixed(1) },
                  { label: "Passing", value: passingRate },
                  { label: "Highest", value: stats.highest },
                  { label: "Lowest", value: stats.lowest },
                ].map((item) => (
                  <div key={item.label} className="px-2 py-2.5 text-center">
                    <p className="text-sm font-bold leading-none text-foreground">{item.value}</p>
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {toolsSlot && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2.5 lg:px-6">
              {toolsSlot}
            </div>
          )}
        </div>
      )}

      {rotationSlot}
    </div>
  );
}

