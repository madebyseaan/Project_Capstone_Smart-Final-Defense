import { useEffect, useState } from "react";
import { ClipboardList, FileCheck2, Loader2 } from "lucide-react";
import { AlertBanner, AppModal } from "@/components/app-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { registrarApi, type CorrectionReviewResponse, type CorrectionWindowItem } from "@/lib/api";
import { toast } from "@/lib/toast";

interface CorrectionReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: CorrectionWindowItem | null;
  onChanged?: () => void;
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number") return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function CorrectionReviewModal({
  open,
  onOpenChange,
  request,
  onChanged,
}: CorrectionReviewModalProps) {
  const [data, setData] = useState<CorrectionReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"close" | "refinalize" | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);

  useEffect(() => {
    if (!open || !request) return;
    let cancelled = false;
    setShowUnchanged(false);
    setLoading(true);
    setError(null);
    registrarApi
      .reviewEditWindow(request.id)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the correction review.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, request]);

  const runAction = async (action: "close" | "refinalize") => {
    if (!request) return;
    setBusy(true);
    try {
      const res =
        action === "close"
          ? await registrarApi.closeEditWindow(request.id)
          : await registrarApi.refinalizeEditWindow(request.id);
      toast.success(res.data.message);
      setConfirmAction(null);
      onOpenChange(false);
      onChanged?.();
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(message || "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const status = data?.request.displayStatus ?? request?.displayStatus;
  const canClose = status === "WINDOW_OPEN";
  const canRefinalize = status === "EXPIRED";

  const changedStudents = data?.students.filter((student) => student.changes.length > 0) ?? [];
  const unchangedStudents = data?.students.filter((student) => student.changes.length === 0) ?? [];
  const visibleStudents = showUnchanged ? data?.students ?? [] : changedStudents;

  return (
    <>
      <AppModal
        open={open}
        onOpenChange={onOpenChange}
        icon={<FileCheck2 className="h-6 w-6" />}
        title="Review grade edits"
        description={
          request
            ? `${request.teacherName} · ${request.section ?? "Section"} ${request.subject ?? ""} · ${request.term}`
            : ""
        }
        size="xl"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            {canClose && (
              <Button variant="outline" onClick={() => setConfirmAction("close")}>
                Close window
              </Button>
            )}
            {canRefinalize && (
              <Button onClick={() => setConfirmAction("refinalize")}>
                Re-finalize grades
              </Button>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading changes...</span>
          </div>
        ) : error ? (
          <AlertBanner variant="danger" title="Unable to load review">
            {error}
          </AlertBanner>
        ) : !data ? null : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ClipboardList className="h-3.5 w-3.5" />
                Teacher's stated reason
              </div>
              <p className="text-sm text-foreground">{data.request.reason}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{data.changedCount} changed</Badge>
              <Badge variant="outline" className="text-muted-foreground">
                {data.unchangedCount} unchanged
              </Badge>
              {data.changedCategories.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Areas: {data.changedCategories.join(", ")}
                </span>
              )}
            </div>

            {data.outsideReasonCategories.length > 0 && (
              <AlertBanner variant="warning" title="Changed outside the stated reason">
                The teacher mentioned {data.reasonCategories.join(", ")} but also changed{" "}
                {data.outsideReasonCategories.join(", ")}. Review these changes before re-finalizing.
              </AlertBanner>
            )}

            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Students with changes</h3>
              {unchangedStudents.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setShowUnchanged((value) => !value)}
                >
                  {showUnchanged
                    ? `Hide ${unchangedStudents.length} unchanged`
                    : `Show ${unchangedStudents.length} unchanged`}
                </Button>
              )}
            </div>

            <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
              {visibleStudents.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">No changes were made</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The window ended without changing any grades.
                  </p>
                </div>
              ) : (
                visibleStudents.map((student) => {
                  const inputChanges = student.changes.filter(
                    (change) => change.kind === "input" || change.kind === "record",
                  );
                  const computedChanges = student.changes.filter(
                    (change) => change.kind === "computed",
                  );
                  return (
                    <div
                      key={student.studentId}
                      className="rounded-xl border border-border bg-card p-4"
                      data-testid="correction-student-card"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {student.studentName}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {student.changes.length === 0
                              ? "No changes"
                              : `${student.changes.length} change${student.changes.length === 1 ? "" : "s"}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Final grade
                          </p>
                          <p className="text-lg font-semibold tabular-nums text-muted-foreground">
                            {formatNumber(student.before?.quarterlyGrade)}
                            <span className="mx-1.5 text-muted-foreground/50">→</span>
                            <span className="text-foreground">
                              {formatNumber(student.after?.quarterlyGrade)}
                            </span>
                          </p>
                        </div>
                      </div>

                      {student.changes.length === 0 ? null : (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg border border-amber-200/70 bg-amber-50/40 p-3">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                              Encoded changes
                            </p>
                            {inputChanges.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No encoded scores changed.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {inputChanges.map((change) => (
                                  <div key={change.field}>
                                    <p className="text-xs font-semibold text-foreground">
                                      {change.label}
                                    </p>
                                    {change.details.map((detail) => (
                                      <p
                                        key={detail}
                                        className="text-xs leading-relaxed text-muted-foreground"
                                      >
                                        {detail}
                                      </p>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="rounded-lg border border-border bg-muted/20 p-3">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Computed changes
                            </p>
                            {computedChanges.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No computed grades changed.
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {computedChanges.map((change) => (
                                  <div
                                    key={change.field}
                                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs"
                                  >
                                    <span className="font-medium text-foreground">
                                      {change.label}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {change.details.join("; ")}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </AppModal>

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(next) => {
          if (!next && !busy) setConfirmAction(null);
        }}
        title={confirmAction === "close" ? "Close the edit window?" : "Re-finalize these grades?"}
        description={
          confirmAction === "close"
            ? "The teacher will lose edit access immediately. Grades stay DRAFT until you re-finalize."
            : "This will seal the reviewed grades again. The teacher will no longer be able to edit them."
        }
        confirmLabel={confirmAction === "close" ? "Close window" : "Re-finalize"}
        destructive={confirmAction === "close"}
        loading={busy}
        onConfirm={() => {
          if (confirmAction) void runAction(confirmAction);
        }}
      />
    </>
  );
}
