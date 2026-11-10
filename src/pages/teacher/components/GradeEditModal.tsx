import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FullScreenSheet } from "@/components/mobile";
import { cn } from "@/lib/utils";
import { EXAM_SUB_TESTS } from "@/lib/gradeMath";
import type { ClassRecord, AimsRowScore, AimsAssessmentInfo } from "@/lib/api";

type MobileScoreCategory = "WW" | "PT" | "QA" | "EX";
type MobileEditorTab = "WW" | "PT" | "EX";

interface AssessmentTaskMeta {
  description: string;
  date: string;
}

interface GradeEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRecord: ClassRecord | null;
  selectedTerm: string;
  mobileEditorTab: MobileEditorTab;
  onTabChange: (tab: MobileEditorTab) => void;
  wwCount: number;
  ptCount: number;
  wwMeta: AssessmentTaskMeta[];
  ptMeta: AssessmentTaskMeta[];
  qaMeta: { description: string; date: string };
  mobileScoreDraft: Record<string, string>;
  invalidCells: Record<string, string>;
  getCellKey: (sid: string, cat: MobileScoreCategory, idx: number) => string;
  getMobileDraftKey: (studentId: string, category: MobileScoreCategory, index: number) => string;
  getScoreFromGrade: (record: ClassRecord, category: MobileScoreCategory, index: number) => string;
  getMaxForCell: (cat: MobileScoreCategory, idx: number) => number;
  onMobileScoreDraftChange: (studentId: string, category: MobileScoreCategory, index: number, value: string) => void;
  onMobileScoreCommit: (record: ClassRecord, category: MobileScoreCategory, index: number) => void;
  onApplyColumnMeta: (category: "WW" | "PT" | "QA", index: number, description: string, date: string) => void;
  isViewOnly?: boolean;
  /** R3-4: Optional AIMS scores for this student — renders read-only block above tabs */
  aimsScores?: Record<string, AimsRowScore>;
  /** R4-2c: Assessment titles for friendly display */
  aimsAssessmentTitles?: Record<string, string>;
  /** Phase 7: Unfiltered assessments for QA provenance detection */
  aimsAllAssessments?: AimsAssessmentInfo[];
  /** Phase 7: AIMS scores by student for provenance detection */
  aimsByStudent?: Record<string, Record<string, AimsRowScore>>;
  /** Optional previous/next student navigation within the same class record */
  onNavigateStudent?: (direction: "prev" | "next") => void;
  canNavigatePrev?: boolean;
  canNavigateNext?: boolean;
}

function TaskMetaDetails({
  label,
  description,
  date,
  disabled,
  onDescriptionChange,
  onDateChange,
}: {
  label: string;
  description: string;
  date: string;
  disabled: boolean;
  onDescriptionChange: (value: string) => void;
  onDateChange: (value: string) => void;
}) {
  return (
    <details className="group/details mt-2 rounded-xl border border-border/60 bg-background">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3 text-[0.8rem] font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span>Class-wide details</span>
        <ChevronDown className="h-4 w-4 transition-transform group-open/details:rotate-180" aria-hidden="true" />
      </summary>
      <div className="grid grid-cols-1 gap-2 border-t border-border/60 p-3">
        <input
          type="text"
          defaultValue={description}
          disabled={disabled}
          onBlur={(e) => onDescriptionChange(e.currentTarget.value)}
          aria-label={`${label} description`}
          className="h-12 w-full rounded-lg border border-border bg-card px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Description"
        />
        <input
          type="date"
          defaultValue={date}
          disabled={disabled}
          onBlur={(e) => onDateChange(e.currentTarget.value)}
          aria-label={`${label} date`}
          className="h-12 w-full rounded-lg border border-border bg-card px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
    </details>
  );
}

export function GradeEditModal({
  open,
  onOpenChange,
  selectedRecord,
  mobileEditorTab,
  onTabChange,
  wwCount,
  ptCount,
  wwMeta,
  ptMeta,
  qaMeta,
  mobileScoreDraft,
  invalidCells,
  getCellKey,
  getMobileDraftKey,
  getScoreFromGrade,
  getMaxForCell,
  onMobileScoreDraftChange,
  onMobileScoreCommit,
  onApplyColumnMeta,
  isViewOnly = false,
  aimsScores,
  aimsAllAssessments,
  onNavigateStudent,
  canNavigatePrev = false,
  canNavigateNext = false,
}: GradeEditModalProps) {
  if (!selectedRecord) return null;

  const aimsForTab = (category: "WW" | "PT" | "QA") =>
    (aimsAllAssessments ?? [])
      .filter((a) => a.category === category)
      .map((a) => {
        const score = aimsScores?.[a.assessmentId];
        return (
          <div
            key={`aims-${category}-${a.assessmentId}`}
            className="flex items-center justify-between gap-2 rounded-lg bg-[var(--ledger-aims-bg)] px-3 py-2"
          >
            <span className="truncate text-[0.8rem] font-medium text-[var(--ledger-aims)]">{a.title}</span>
            <span className="shrink-0 text-sm font-semibold text-[var(--ledger-aims)]">
              {score ? `${score.pointsEarned}/${score.maxPoints}` : "—"}
            </span>
          </div>
        );
      });

  const renderScoreField = (category: MobileScoreCategory, index: number, label: string) => {
    const key = getMobileDraftKey(selectedRecord.student.id, category, index);
    const invalid = invalidCells[getCellKey(selectedRecord.student.id, category, index)];

    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <input
          type="number"
          inputMode="decimal"
          enterKeyHint="done"
          value={mobileScoreDraft[key] ?? getScoreFromGrade(selectedRecord, category, index)}
          disabled={isViewOnly}
          onChange={(e) => onMobileScoreDraftChange(selectedRecord.student.id, category, index, e.target.value)}
          onBlur={() => onMobileScoreCommit(selectedRecord, category, index)}
          aria-invalid={!!invalid}
          aria-label={`${label} score`}
          className={cn(
            "h-14 w-24 rounded-xl border bg-background px-2 text-center text-2xl font-bold text-foreground outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            invalid ? "border-destructive" : "border-border focus:border-primary",
          )}
          placeholder="0"
        />
        {invalid && <span className="max-w-24 text-right text-[0.8rem] font-medium text-destructive">{invalid}</span>}
      </div>
    );
  };

  const isExamTab = mobileEditorTab === "EX";

  const tasks =
    mobileEditorTab === "WW"
      ? Array.from({ length: wwCount }).map((_, i) => ({
          index: i,
          description: wwMeta[i]?.description || `WW ${i + 1}`,
          date: wwMeta[i]?.date || "",
          label: `WW ${i + 1}`,
          category: "WW" as const,
        }))
      : mobileEditorTab === "PT"
        ? Array.from({ length: ptCount }).map((_, i) => ({
            index: i,
            description: ptMeta[i]?.description || `PT ${i + 1}`,
            date: ptMeta[i]?.date || "",
            label: `PT ${i + 1}`,
            category: "PT" as const,
          }))
        : [];

  const aimsTab = mobileEditorTab === "EX" ? "QA" : mobileEditorTab;

  return (
    <FullScreenSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${selectedRecord.student.lastName}, ${selectedRecord.student.firstName}`}
      description={selectedRecord.student.lrn}
      contentClassName="space-y-4"
      footer={
        <div className="flex items-center gap-2">
          {onNavigateStudent && (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Previous learner"
                disabled={!canNavigatePrev}
                onClick={() => onNavigateStudent("prev")}
                className="h-12 w-12 shrink-0 rounded-xl disabled:opacity-40"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Next learner"
                disabled={!canNavigateNext}
                onClick={() => onNavigateStudent("next")}
                className="h-12 w-12 shrink-0 rounded-xl disabled:opacity-40"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          )}
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-12 flex-1 rounded-xl text-sm font-semibold"
          >
            Done
          </Button>
        </div>
      }
    >
      <div role="tablist" aria-label="Score category" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {(["WW", "PT", "EX"] as const).map((tab) => {
          const active = mobileEditorTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab)}
              className={cn(
                "min-h-12 rounded-lg text-[0.8rem] font-semibold uppercase tracking-wide transition-colors",
                active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {tab === "EX" ? "Exam" : tab}
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        {isExamTab ? (
          <>
            <div className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.9rem] font-semibold text-foreground">Term exam</p>
                <span className="text-[0.8rem] font-medium text-muted-foreground">ST1 · ST2 · TE</span>
              </div>
              <TaskMetaDetails
                label="Exam"
                description={qaMeta.description}
                date={qaMeta.date}
                disabled={isViewOnly}
                onDescriptionChange={(value) => onApplyColumnMeta("QA", 0, value, qaMeta.date)}
                onDateChange={(value) => onApplyColumnMeta("QA", 0, qaMeta.description, value)}
              />
            </div>
            {EXAM_SUB_TESTS.map((sub, i) => (
              <div
                key={sub.name}
                className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9rem] font-semibold text-foreground">{sub.name}</p>
                    <p className="mt-0.5 text-[0.8rem] font-medium text-muted-foreground">
                      Max {getMaxForCell("EX", i)}
                    </p>
                  </div>
                  {renderScoreField("EX", i, sub.name)}
                </div>
              </div>
            ))}
          </>
        ) : tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm font-semibold text-foreground">
              No {mobileEditorTab === "WW" ? "written work" : "performance task"} columns yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add assessment columns from the class record tools.
            </p>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={`${task.category}-${task.index}`}
              className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]"
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9rem] font-semibold text-foreground">{task.label}</p>
                  <p className="mt-0.5 text-[0.8rem] font-medium text-muted-foreground">
                    Max {getMaxForCell(task.category, task.index)}
                  </p>
                </div>
                {renderScoreField(task.category, task.index, task.label)}
              </div>
              <TaskMetaDetails
                label={task.label}
                description={task.description}
                date={task.date}
                disabled={isViewOnly}
                onDescriptionChange={(value) =>
                  onApplyColumnMeta(task.category, task.index, value, task.date)
                }
                onDateChange={(value) =>
                  onApplyColumnMeta(task.category, task.index, task.description, value)
                }
              />
            </div>
          ))
        )}

        {aimsForTab(aimsTab).length > 0 && (
          <div className="space-y-2 rounded-2xl border border-border/70 bg-card p-3">
            <p className="text-[0.8rem] font-semibold text-muted-foreground">
              AIMS scores (read-only)
            </p>
            {aimsForTab(aimsTab)}
          </div>
        )}

        {isViewOnly && (
          <p className="rounded-xl bg-muted px-3 py-2 text-[0.8rem] font-medium text-muted-foreground">
            This term is view only. Scores cannot be edited.
          </p>
        )}
      </div>
    </FullScreenSheet>
  );
}
