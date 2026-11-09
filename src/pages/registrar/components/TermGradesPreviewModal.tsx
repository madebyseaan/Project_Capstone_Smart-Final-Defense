import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FileEdit,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { AlertBanner, AppModal } from "@/components/app-modal";
import { ProgramBadge } from "@/components/ProgramBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { registrarApi } from "@/lib/api";
import { getGradeBadgeClass, gradeLevelLabel } from "@/lib/gradeColor";
import { shortSubjectName } from "@/lib/subjectLabels";
import { cn } from "@/lib/utils";
import type {
  TermFinalizationSection,
  TermGradeStudent,
  TermGradeSubject,
  TermGradesResponse,
  TermName,
} from "@/lib/termFinalizationTypes";

interface TermGradesPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: TermFinalizationSection | null;
  term: TermName;
  schoolYear: string;
  refreshToken?: number;
  yearArchived: boolean;
  positionLabel: string | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onFinalizeSection: () => void;
  onUnfinalizeSection: () => void;
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return "Failed to load grades for this section and term.";
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function isFailing(subject: TermGradeSubject | undefined): boolean {
  return !!subject && subject.quarterlyGrade !== null && subject.quarterlyGrade < 75;
}

function cellTitle(subject: TermGradeSubject | undefined): string {
  if (!subject) return "No grade record";
  const status =
    subject.status === "DRAFT"
      ? "Draft"
      : subject.status === "FINALIZED"
        ? "Finalized"
        : subject.status === "LOCKED"
          ? "Locked"
          : "No grade";
  const parts = [
    isFailing(subject) ? "Failing" : null,
    subject.initialGrade !== null ? `Initial ${formatNumber(subject.initialGrade)}` : null,
    subject.writtenWorkPS !== null ? `WW ${formatNumber(subject.writtenWorkPS)}` : null,
    subject.perfTaskPS !== null ? `PT ${formatNumber(subject.perfTaskPS)}` : null,
    subject.quarterlyAssessPS !== null
      ? `TA ${formatNumber(subject.quarterlyAssessPS)}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? `${status} · ${parts.join(" · ")}` : status;
}

function chipClass(subject: TermGradeSubject | undefined): string {
  if (isFailing(subject)) return "border-destructive/30 bg-destructive/5";
  if (!subject) return "border-border bg-muted/20";
  if (subject.status === "DRAFT") return "border-amber-200 bg-amber-50/70";
  if (subject.status === "FINALIZED" || subject.status === "LOCKED") {
    return "border-emerald-200 bg-emerald-50/50";
  }
  return "border-border bg-muted/20";
}

function gradeTextClass(subject: TermGradeSubject | undefined): string {
  if (isFailing(subject)) return "font-semibold text-destructive";
  if (!subject) return "text-muted-foreground";
  if (subject.status === "DRAFT") return "font-semibold text-amber-800";
  if (subject.status === "FINALIZED" || subject.status === "LOCKED") {
    return "font-medium text-emerald-800";
  }
  return "text-muted-foreground";
}

function subjectStatusMeta(subjects: Array<TermGradeSubject | undefined>) {
  const drafts = subjects.filter((subject) => subject?.status === "DRAFT").length;
  const finalized = subjects.filter(
    (subject) => subject?.status === "FINALIZED" || subject?.status === "LOCKED",
  ).length;
  if (drafts > 0) {
    return {
      label: `${drafts} draft`,
      className: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }
  if (finalized > 0) {
    return {
      label: "Finalized",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  return { label: "No grades", className: "bg-muted text-muted-foreground border-border" };
}

function sectionStatusMeta(section: TermFinalizationSection, yearArchived: boolean) {
  if (
    yearArchived ||
    section.sectionStatus === "ARCHIVED" ||
    section.sectionStatus === "COMPLETED"
  ) {
    return { label: "Archived", className: "bg-muted text-muted-foreground border-border" };
  }
  if (section.isFinalized) {
    return {
      label: "Finalized",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  if (section.draftCount > 0) {
    return { label: "Draft", className: "bg-amber-50 text-amber-700 border-amber-200" };
  }
  return { label: "No grades", className: "bg-muted text-muted-foreground border-border" };
}

export default function TermGradesPreviewModal({
  open,
  onOpenChange,
  section,
  term,
  schoolYear,
  refreshToken,
  yearArchived,
  positionLabel,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onFinalizeSection,
  onUnfinalizeSection,
}: TermGradesPreviewModalProps) {
  const [data, setData] = useState<TermGradesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionId = section?.sectionId ?? null;
  const hasStaleData = !!data && data.sectionId !== sectionId;

  useEffect(() => {
    if (!open || !sectionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    registrarApi
      .getStudentTermGrades(sectionId, term, schoolYear, {
        includeInactive: true,
        mergeRotations: false,
      })
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(extractErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, sectionId, term, schoolYear, refreshToken, refreshKey]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [sectionId]);

  const columns = useMemo(() => {
    const byName = new Map<string, TermGradeSubject>();
    for (const student of data?.students ?? []) {
      for (const subject of student.subjects) {
        if (!byName.has(subject.subjectName)) byName.set(subject.subjectName, subject);
      }
    }
    return [...byName.values()];
  }, [data]);

  const draftCells = useMemo(
    () =>
      (data?.students ?? []).reduce(
        (count, student) =>
          count + student.subjects.filter((subject) => subject.status === "DRAFT").length,
        0,
      ),
    [data],
  );

  const inactiveCount = useMemo(
    () =>
      (data?.students ?? []).filter(
        (student) => student.enrollmentStatus && student.enrollmentStatus !== "ENROLLED",
      ).length,
    [data],
  );

  const issueCounts = useMemo(() => {
    const students = data?.students ?? [];
    let failing = 0;
    let missing = 0;

    for (const student of students) {
      for (const column of columns) {
        const subject = student.subjects.find(
          (entry) => entry.subjectName === column.subjectName,
        );
        if (!subject || subject.quarterlyGrade === null) {
          missing += 1;
        } else if (subject.quarterlyGrade < 75) {
          failing += 1;
        }
      }
    }

    return { failing, missing };
  }, [data, columns]);

  const subjectFor = (student: TermGradeStudent, subjectName: string) =>
    student.subjects.find((subject) => subject.subjectName === subjectName);

  const title = section ? `Grades — ${section.sectionName}` : "Grades";

  const descriptionText = useMemo(() => {
    if (!section) return `${term} · grade preview`;
    const progress = `${section.finalizedSubjects}/${section.totalSubjects} subjects finalized`;
    if (section.isFinalized) return `${term} · ${progress}`;
    if (section.draftCount > 0) {
      return `${term} · ${progress} · ${section.draftCount} draft grade${
        section.draftCount === 1 ? "" : "s"
      } to finalize`;
    }
    return `${term} · ${progress}`;
  }, [section, term]);

  const statusMeta = section ? sectionStatusMeta(section, yearArchived) : null;

  const actionDisabled =
    !section ||
    yearArchived ||
    !section.canFinalize ||
    section.eosyFinalized ||
    loading ||
    !!error;

  const actionDisabledReason = yearArchived
    ? "This school year is archived"
    : section?.eosyFinalized
      ? "Unfinalize EOSY before changing term grades"
      : section && !section.canFinalize
        ? "This section cannot be finalized"
        : loading
          ? "Wait for grades to finish loading"
          : error
            ? "Grades could not be loaded"
            : undefined;

  const footer = section ? (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={onPrev}
            disabled={!hasPrev}
            data-testid="term-grades-prev-section"
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={onNext}
            disabled={!hasNext}
            data-testid="term-grades-next-section"
          >
            Next
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
          {positionLabel && (
            <span className="text-xs text-muted-foreground">Section {positionLabel}</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground sm:text-right">
          <p>
            <span className="font-medium text-foreground">
              {section.finalizedSubjects}/{section.totalSubjects}
            </span>{" "}
            subjects finalized
            {section.draftCount > 0 && (
              <>
                {" · "}
                <span className="font-medium text-amber-700">{section.draftCount} draft</span>
              </>
            )}
          </p>
          {!loading && !error && actionDisabledReason && (
            <p className="text-amber-700">{actionDisabledReason}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={() => onOpenChange(false)}
          data-testid="term-grades-close"
        >
          Close
        </Button>
        {section.draftCount > 0 ? (
          <Button
            className="rounded-xl"
            onClick={onFinalizeSection}
            disabled={actionDisabled}
            title={actionDisabledReason}
            data-testid="term-grades-finalize-section"
          >
            <FileCheck2 className="mr-2 h-4 w-4" />
            Finalize section
          </Button>
        ) : section.finalizedCount > 0 ? (
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={onUnfinalizeSection}
            disabled={actionDisabled}
            title={actionDisabledReason}
            data-testid="term-grades-unfinalize-section"
          >
            <FileEdit className="mr-2 h-4 w-4" />
            Unfinalize
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">No grades to finalize</span>
        )}
      </div>
    </div>
  ) : null;

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      icon={<BookOpen className="h-5 w-5" />}
      title={title}
      description={
        section && statusMeta ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
                getGradeBadgeClass(section.gradeLevel),
              )}
            >
              {gradeLevelLabel(section.gradeLevel)}
            </Badge>
            <ProgramBadge program={section.program} />
            {section.eosyFinalized ? (
              <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px] font-medium">
                EOSY finalized
              </Badge>
            ) : section.eosyStarted ? (
              <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-medium">
                EOSY partial
              </Badge>
            ) : null}
            <Badge className={cn("text-[10px] font-medium", statusMeta.className)}>
              {statusMeta.label}
            </Badge>
            <span>{descriptionText}</span>
          </span>
        ) : (
          descriptionText
        )
      }
      size="xl"
      footer={footer}
      bodyRef={bodyRef}
    >
      <div data-testid="term-grades-preview">
        {loading || hasStaleData ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading learner grades...</span>
          </div>
        ) : error ? (
          <div className="space-y-3">
            <AlertBanner variant="danger" title="Unable to load grades">
              {error}
            </AlertBanner>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        ) : !data || data.students.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="mb-3 h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">No grades to show</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              There are no learners with grade records for this section and term.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span>
                <strong className="font-semibold text-foreground">{data.students.length}</strong>{" "}
                learner{data.students.length === 1 ? "" : "s"}
              </span>
              <span>
                <strong className="font-semibold text-foreground">{columns.length}</strong> grade
                column{columns.length === 1 ? "" : "s"}
              </span>
              <span>
                <strong className="font-semibold text-amber-700">{draftCells}</strong> draft grade
                {draftCells === 1 ? "" : "s"}
              </span>
              {issueCounts.failing > 0 && (
                <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {issueCounts.failing} failing grade{issueCounts.failing === 1 ? "" : "s"}
                </span>
              )}
              {issueCounts.missing > 0 && (
                <span>
                  {issueCounts.missing} missing grade{issueCounts.missing === 1 ? "" : "s"}
                </span>
              )}
              {inactiveCount > 0 && (
                <span className="text-amber-700">
                  includes {inactiveCount} dropped/transferred learner
                  {inactiveCount === 1 ? "" : "s"}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-200" /> Draft
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" /> Finalized
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-destructive/20 ring-1 ring-destructive/40" />{" "}
                Failing
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-muted" /> No grade
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {columns.map((column) => {
                const subjectRows = data.students.map((student) => ({
                  student,
                  subject: subjectFor(student, column.subjectName),
                }));
                const status = subjectStatusMeta(subjectRows.map((row) => row.subject));
                return (
                  <div
                    key={column.subjectName}
                    className="min-w-0 overflow-hidden rounded-xl border-2 border-border bg-background"
                    data-testid="term-grades-subject-card"
                  >
                    <div className="flex items-start justify-between gap-3 border-b-2 border-border px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {shortSubjectName(column.subjectName)}
                        </p>
                        <p
                          className="mt-0.5 truncate text-[11px] text-muted-foreground"
                          title={column.subjectName}
                        >
                          {column.subjectName}
                          {column.subjectCode ? ` · ${column.subjectCode}` : ""}
                        </p>
                      </div>
                      <Badge
                        className={`shrink-0 text-[10px] font-medium ${status.className}`}
                      >
                        {status.label}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 p-2.5 sm:grid-cols-2">
                      {subjectRows.map(({ student, subject }) => {
                        const inactive =
                          student.enrollmentStatus &&
                          student.enrollmentStatus !== "ENROLLED";
                        const failing = isFailing(subject);
                        return (
                          <div
                            key={`${student.studentId}-${column.subjectName}`}
                            className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${chipClass(subject)}`}
                            title={cellTitle(subject)}
                            data-failing={failing ? "true" : undefined}
                            data-testid="term-grades-student-row"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-foreground">
                                {student.lastName}, {student.firstName}
                              </p>
                              {inactive && (
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                  {student.enrollmentStatus!.toLowerCase()}
                                </p>
                              )}
                            </div>
                            <span
                              className={`shrink-0 text-sm tabular-nums ${gradeTextClass(subject)}`}
                            >
                              {formatNumber(subject?.quarterlyGrade)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Hover a grade for the WW / PT / TA breakdown. Amber chips are draft grades included
              in finalization; red chips are failing grades below 75. Rotation components are
              listed separately because each row is finalized.
            </p>
          </>
        )}
      </div>
    </AppModal>
  );
}
