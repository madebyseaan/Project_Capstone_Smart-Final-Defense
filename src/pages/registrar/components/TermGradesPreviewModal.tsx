import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Loader2, RefreshCw } from "lucide-react";
import { AlertBanner, AppModal } from "@/components/app-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { registrarApi } from "@/lib/api";
import { shortSubjectName } from "@/lib/subjectLabels";
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
  if (!subject) return "border-border bg-muted/20";
  if (subject.status === "DRAFT") return "border-amber-200 bg-amber-50/70";
  if (subject.status === "FINALIZED" || subject.status === "LOCKED") {
    return "border-emerald-200 bg-emerald-50/50";
  }
  return "border-border bg-muted/20";
}

function gradeTextClass(subject: TermGradeSubject | undefined): string {
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

export default function TermGradesPreviewModal({
  open,
  onOpenChange,
  section,
  term,
  schoolYear,
}: TermGradesPreviewModalProps) {
  const [data, setData] = useState<TermGradesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!open || !section) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    registrarApi
      .getStudentTermGrades(section.sectionId, term, schoolYear, {
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
  }, [open, section, term, schoolYear, refreshKey]);

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

  const subjectFor = (student: TermGradeStudent, subjectName: string) =>
    student.subjects.find((subject) => subject.subjectName === subjectName);

  const title = section ? `Grades — ${section.sectionName}` : "Grades";

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      icon={<BookOpen className="h-5 w-5" />}
      title={title}
      description={`${term} · read-only grade preview before finalization`}
      size="xl"
      hideFooter
    >
      <div data-testid="term-grades-preview">
        {loading ? (
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
                <strong className="font-semibold text-foreground">{columns.length}</strong>{" "}
                subject{columns.length === 1 ? "" : "s"}
              </span>
              <span>
                <strong className="font-semibold text-amber-700">{draftCells}</strong> draft grade
                {draftCells === 1 ? "" : "s"}
              </span>
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
                        return (
                          <div
                            key={`${student.studentId}-${column.subjectName}`}
                            className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${chipClass(subject)}`}
                            title={cellTitle(subject)}
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
              in finalization. Rotation components are listed separately because each row is
              finalized.
            </p>
          </>
        )}

        <div className="mt-4 flex justify-end border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </div>
    </AppModal>
  );
}
