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
import type { ClassAssignment } from "@/lib/api";

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
  stats?: { avg: number; passed: number; total: number; highest: number; lowest: number } | null;
  onStartTour?: () => void;
  selectedTerm: string;
  onTermChange: (term: string) => void;
  lockedTerm: string | null;
  termLabels?: Record<string, string>;
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
  const passingRate = stats && stats.total > 0 
    ? `${Math.round((stats.passed / stats.total) * 100)}%` 
    : "0%";

  return (
    <div className="bg-white transition-all">
      {/* Top Accent Gradient Line */}
      <div className="h-1 bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-800" />

      {/* Top Utility & Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-slate-100 bg-white">
        {/* Left: Back Arrow + Breadcrumb */}
        <div className="flex items-center gap-3">
          <Link to="/teacher/classes">
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 rounded-lg bg-slate-50 text-slate-500 hover:bg-indigo-600 hover:text-white transition-all border border-slate-200/80 shadow-xs"
              title="Back to class records"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
            <span>Class Record</span>
            <span>/</span>
            <span className="text-slate-700 font-bold">
              {gradeLevelLabels[classAssignment.section.gradeLevel] ?? classAssignment.section.gradeLevel} - {classAssignment.section.name}
            </span>
          </div>
        </div>

        {/* Right Action Cluster */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Term Switcher (Preserves tutorial-period-controls ID) */}
          <div id="tutorial-period-controls" className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
            {(["T1", "T2", "T3"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => !lockedTerm && onTermChange(t)}
                disabled={!!lockedTerm && lockedTerm !== t}
                className={cn(
                  "h-6 px-2.5 rounded-md text-[11px] font-bold transition-all",
                  selectedTerm === t
                    ? "bg-white text-indigo-700 shadow-xs scale-[1.02]"
                    : "text-slate-500 hover:text-slate-800"
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
              className="h-8 px-3 rounded-lg border-amber-200 bg-amber-50/80 text-amber-900 hover:bg-amber-100 font-bold text-xs uppercase tracking-wider gap-1.5 shadow-xs"
              title="Start Step-by-Step Interactive Tutorial"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
              <span>Tutorial</span>
            </Button>
          )}

          {/* View / Entry Mode Badge */}
          {isViewOnly ? (
            <Badge className="h-8 px-3 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[11px] gap-1">
              <Eye className="w-3 h-3" /> View Only
            </Badge>
          ) : (
            <Badge className="h-8 px-3 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[11px]">
              Grade Entry Mode
            </Badge>
          )}
        </div>
      </div>

      {/* Hero Subject & Metadata Area (Preserves tutorial-hero-info ID) */}
      <div id="tutorial-hero-info" className="px-6 py-4 bg-white">
        <div className="flex flex-col gap-1.5">
          {/* Main Subject Title */}
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight uppercase">
            {classAssignment.subject.name}
          </h1>

          {/* Clean Metadata Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-[11px] font-bold px-2.5 py-0.5 rounded-md">
              {gradeLevelLabels[classAssignment.section.gradeLevel] ?? classAssignment.section.gradeLevel} · Section {classAssignment.section.name}
            </Badge>

            <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-[11px] font-bold px-2.5 py-0.5 rounded-md flex items-center gap-1.5">
              <User className="w-3 h-3 text-slate-400" />
              <span>Teacher:</span>
              <span className="text-slate-900 font-extrabold">{userName}</span>
            </Badge>

            <Badge className="bg-indigo-50 text-indigo-700 border-indigo-100 text-[11px] font-bold px-2.5 py-0.5 rounded-md">
              Weights: WW {activeWeights.ww}% · PT {activeWeights.pt}% · QA {activeWeights.qa}%
            </Badge>

            {effectiveWeightsSource === "subject-override" && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">
                (Custom Weights)
              </span>
            )}
            {effectiveWeightsSource === "subject-type" && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                (Group Defaults)
              </span>
            )}
            {effectiveWeightsSource === "generic-fallback" && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600">
                (Generic 20/50/30)
              </span>
            )}

            <div className="h-3.5 w-px bg-slate-200 mx-1 hidden sm:block" />

            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              DepEd Form 7-A (E-Class Record)
            </span>
          </div>
        </div>
      </div>

      {/* High-End Telemetry Bar (No Chunky Boxes - Preserves tutorial-stats-overview ID) */}
      {(stats || toolsSlot) && (
        <div 
          id="tutorial-stats-overview" 
          className="border-t border-slate-100 bg-slate-50/60 px-6 py-2.5 flex flex-wrap items-center gap-6 text-xs"
        >
          {stats && (
            <>
              {/* Class Average */}
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-md bg-indigo-50 text-indigo-600">
                  <Target className="w-3.5 h-3.5" />
                </div>
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Class Average:</span>
            <span className="text-slate-900 font-extrabold text-sm">{stats.avg.toFixed(1)}</span>
          </div>

          <div className="h-3.5 w-px bg-slate-200 hidden sm:block" />

          {/* Passing Rate */}
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-emerald-50 text-emerald-600">
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Passing Rate:</span>
            <span className="text-slate-900 font-extrabold text-sm">{passingRate}</span>
            <span className="text-slate-400 text-[11px] font-semibold">({stats.passed}/{stats.total})</span>
          </div>

          <div className="h-3.5 w-px bg-slate-200 hidden sm:block" />

          {/* Highest Grade */}
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-amber-50 text-amber-600">
              <Award className="w-3.5 h-3.5" />
            </div>
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Highest Grade:</span>
            <span className="text-slate-900 font-extrabold text-sm">{stats.highest}</span>
          </div>

          <div className="h-3.5 w-px bg-slate-200 hidden sm:block" />

          {/* Lowest Grade */}
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-rose-50 text-rose-600">
              <TrendingDown className="w-3.5 h-3.5" />
            </div>
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Lowest Grade:</span>
            <span className="text-slate-900 font-extrabold text-sm">{stats.lowest}</span>
          </div>
            </>
          )}

          {toolsSlot && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {toolsSlot}
            </div>
          )}
        </div>
      )}

      {rotationSlot}
    </div>
  );
}