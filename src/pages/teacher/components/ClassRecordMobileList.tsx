import { useMemo, useState } from "react";
import { ChevronRight, Lock, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SURFACE } from "./MobileDashboardTokens";
import { SectionHeading } from "./MobileDashboardWidgets";
import type { ClassRecord, AimsAssessmentInfo, ScoreItem } from "@/lib/api";
import { computeExamPS } from "@/lib/gradeMath";

interface ClassRecordMobileListProps {
  records: ClassRecord[];
  selectedTerm: string;
  onOpenEditor: (studentId: string) => void;
  getDisplayFinalGrade: (record: ClassRecord) => number | null;
  getGradeColor: (grade: number | null) => string;
  isViewOnly?: boolean;
  aimsByStudent?: Record<string, Record<string, { pointsEarned: number; maxPoints: number; score: number }>>;
  aimsAssessments?: AimsAssessmentInfo[];
}

export function ClassRecordMobileList({
  records,
  selectedTerm,
  onOpenEditor,
  getDisplayFinalGrade,
  getGradeColor,
  isViewOnly = false,
  aimsAssessments = [],
}: ClassRecordMobileListProps) {
  const [query, setQuery] = useState("");

  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records;
    return records.filter(
      (record) =>
        `${record.student.lastName}, ${record.student.firstName} ${record.student.middleName ?? ""}`
          .toLowerCase()
          .includes(normalized) || record.student.lrn.toLowerCase().includes(normalized),
    );
  }, [records, query]);

  const wwAims = aimsAssessments.filter((assessment) => assessment.category === "WW").length;
  const ptAims = aimsAssessments.filter((assessment) => assessment.category === "PT").length;
  const qaAims = aimsAssessments.filter((assessment) => assessment.category === "QA").length;

  return (
    <div className="space-y-2 lg:hidden">
      <SectionHeading
        icon={Users}
        title="Learners"
        meta={`${records.length} ${records.length === 1 ? "learner" : "learners"}`}
      />

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          inputMode="search"
          placeholder="Search learner or LRN"
          aria-label="Search learners"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-12 rounded-xl border-border bg-background pl-10 text-base font-medium"
        />
      </div>

      {isViewOnly && (
        <p className="flex items-center gap-1.5 px-1 text-[0.8rem] font-medium text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          View only — scores cannot be edited for this term.
        </p>
      )}

      <div className={cn("overflow-hidden", SURFACE)}>
        {filteredRecords.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Search className="mx-auto h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
            <p className="mt-3 text-[0.9rem] font-semibold text-foreground">
              No learners match your search
            </p>
            <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
              Try a different name or LRN.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {filteredRecords.map((record) => {
              const grade = record.grades.find((entry) => entry.term === selectedTerm);
              const finalGrade = getDisplayFinalGrade(record);

              const wwScores = (grade?.writtenWorkScores ?? []) as {
                score: number | null;
                maxScore: number | null;
              }[];
              const ptScores = (grade?.perfTaskScores ?? []) as {
                score: number | null;
                maxScore: number | null;
              }[];
              const wwTotal = wwScores.reduce((sum, score) => sum + (Number(score.score) || 0), 0);
              const wwMax = wwScores.reduce((sum, score) => sum + (Number(score.maxScore) || 0), 0);
              const ptTotal = ptScores.reduce((sum, score) => sum + (Number(score.score) || 0), 0);
              const ptMax = ptScores.reduce((sum, score) => sum + (Number(score.maxScore) || 0), 0);
              const qaScore = grade?.quarterlyAssessScore ?? null;
              const qaMax = grade?.quarterlyAssessMax ?? null;
              const examScores = (grade?.examScores ?? []) as ScoreItem[];
              const examPS = computeExamPS(examScores);
              const examDisplay = examPS ?? qaScore;
              const examMax = examPS !== null ? 100 : qaMax;
              const hasScores = wwMax > 0 || ptMax > 0 || examDisplay !== null;

              return (
                <button
                  key={record.student.id}
                  type="button"
                  onClick={() => !isViewOnly && onOpenEditor(record.student.id)}
                  disabled={isViewOnly}
                  className={cn(
                    "block w-full px-4 py-3.5 text-left transition-colors",
                    "active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isViewOnly && "cursor-default opacity-70",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.8rem] font-semibold uppercase text-primary">
                      {record.student.lastName.charAt(0)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[0.875rem] font-semibold text-foreground">
                        {record.student.lastName}, {record.student.firstName}
                      </p>
                      <p className="mt-0.5 font-mono text-[0.8rem] text-muted-foreground">
                        {record.student.lrn}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-[0.8rem] font-medium text-muted-foreground">Grade</p>
                      <p
                        className={cn(
                          "mt-0.5 text-[1.2rem] font-semibold leading-none tabular-nums",
                          getGradeColor(finalGrade),
                        )}
                      >
                        {finalGrade ?? "—"}
                      </p>
                    </div>

                    <ChevronRight
                      className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/60"
                      aria-hidden="true"
                    />
                  </div>

                  {hasScores && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-12">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ledger-ww-bg)] px-2 py-0.5 text-[0.8rem] font-semibold text-[var(--ledger-ww)]">
                        WW {wwMax > 0 ? `${wwTotal}/${wwMax}` : "—"}
                        {wwAims > 0 && (
                          <span className="text-[0.8rem] text-[var(--ledger-aims)]">+{wwAims}</span>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ledger-pt-bg)] px-2 py-0.5 text-[0.8rem] font-semibold text-[var(--ledger-pt)]">
                        PT {ptMax > 0 ? `${ptTotal}/${ptMax}` : "—"}
                        {ptAims > 0 && (
                          <span className="text-[0.8rem] text-[var(--ledger-aims)]">+{ptAims}</span>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ledger-ta-bg)] px-2 py-0.5 text-[0.8rem] font-semibold text-[var(--ledger-ta)]">
                        EX{" "}
                        {examDisplay !== null
                          ? examMax
                            ? `${examDisplay}/${examMax}`
                            : String(examDisplay)
                          : "—"}
                        {qaAims > 0 && (
                          <span className="text-[0.8rem] text-[var(--ledger-aims)]">+{qaAims}</span>
                        )}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
