import { useMemo, useState } from "react";
import { ChevronRight, Lock, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClassRecord, AimsAssessmentInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ClassRecordMobileListProps {
  records: ClassRecord[];
  selectedTerm: string;
  onTermChange: (term: string) => void;
  onOpenEditor: (studentId: string) => void;
  getDisplayFinalGrade: (record: ClassRecord) => number | null;
  getGradeColor: (grade: number | null) => string;
  isViewOnly?: boolean;
  aimsByStudent?: Record<string, Record<string, { pointsEarned: number; maxPoints: number; score: number }>>;
  aimsAssessments?: AimsAssessmentInfo[];
}

const terms = ["T1", "T2", "T3"] as const;

export function ClassRecordMobileList({
  records,
  selectedTerm,
  onTermChange,
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
    return records.filter((record) =>
      `${record.student.lastName}, ${record.student.firstName} ${record.student.middleName ?? ""}`
        .toLowerCase()
        .includes(normalized) || record.student.lrn.toLowerCase().includes(normalized),
    );
  }, [records, query]);

  return (
    <Card className="rounded-none border-0 bg-card shadow-none lg:hidden">
      <div className="space-y-3 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">Learners</h2>
            <p className="text-xs text-muted-foreground">
              {records.length} {records.length === 1 ? "learner" : "learners"} · tap a row to enter scores
            </p>
          </div>
          <Select value={selectedTerm} onValueChange={(val) => val && onTermChange(val)} disabled={isViewOnly}>
            <SelectTrigger className="h-12! w-24 shrink-0 font-semibold sm:h-8!" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="shadow-2xl">
              {terms.map((q) => (
                <SelectItem key={q} value={q} className="text-xs font-semibold">
                  {q === "T1" ? "Term 1" : q === "T2" ? "Term 2" : "Term 3"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            inputMode="search"
            placeholder="Search learner or LRN"
            aria-label="Search learners"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-12 rounded-xl border-border bg-background pl-10 text-base"
          />
        </div>
        {isViewOnly && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            View only — scores cannot be edited for this term.
          </p>
        )}
      </div>

      <CardContent className="space-y-2 bg-background/60 p-3">
        {filteredRecords.length === 0 ? (
          <div className="px-3 py-12 text-center">
            <Search className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">No learners match your search</p>
            <p className="mt-1 text-xs text-muted-foreground">Try a different name or LRN.</p>
          </div>
        ) : (
          filteredRecords.map((record) => {
            const grade = record.grades.find((g) => g.term === selectedTerm);
            const finalGrade = getDisplayFinalGrade(record);

            const wwScores = (grade?.writtenWorkScores ?? []) as { score: number | null; maxScore: number | null }[];
            const ptScores = (grade?.perfTaskScores ?? []) as { score: number | null; maxScore: number | null }[];
            const wwTotal = wwScores.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
            const wwMax = wwScores.reduce((acc, s) => acc + (Number(s.maxScore) || 0), 0);
            const ptTotal = ptScores.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
            const ptMax = ptScores.reduce((acc, s) => acc + (Number(s.maxScore) || 0), 0);
            const qaScore = grade?.quarterlyAssessScore ?? null;
            const qaMax = grade?.quarterlyAssessMax ?? null;
            const hasScores = wwMax > 0 || ptMax > 0 || qaScore !== null;

            const wwAims = aimsAssessments.filter((a) => a.category === "WW").length;
            const ptAims = aimsAssessments.filter((a) => a.category === "PT").length;
            const qaAims = aimsAssessments.filter((a) => a.category === "QA").length;

            return (
              <button
                key={record.student.id}
                type="button"
                onClick={() => !isViewOnly && onOpenEditor(record.student.id)}
                disabled={isViewOnly}
                className={cn(
                  "flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left shadow-sm transition-colors",
                  "active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isViewOnly && "cursor-default opacity-70",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold text-foreground">
                    {record.student.lastName}, {record.student.firstName}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{record.student.lrn}</p>

                  {hasScores && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-xs font-semibold text-[var(--ledger-ww)]">
                        WW {wwMax > 0 ? `${wwTotal}/${wwMax}` : "—"}
                        {wwAims > 0 && <span className="ml-1 text-[10px] text-[var(--ledger-aims)]">+{wwAims}</span>}
                      </span>
                      <span className="text-xs font-semibold text-[var(--ledger-pt)]">
                        PT {ptMax > 0 ? `${ptTotal}/${ptMax}` : "—"}
                        {ptAims > 0 && <span className="ml-1 text-[10px] text-[var(--ledger-aims)]">+{ptAims}</span>}
                      </span>
                      <span className="text-xs font-semibold text-[var(--ledger-ta)]">
                        TA {qaScore !== null ? (qaMax ? `${qaScore}/${qaMax}` : String(qaScore)) : "—"}
                        {qaAims > 0 && <span className="ml-1 text-[10px] text-[var(--ledger-aims)]">+{qaAims}</span>}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Grade</span>
                  <span className={cn("text-xl font-bold", getGradeColor(finalGrade))}>{finalGrade ?? "—"}</span>
                </div>

                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}



