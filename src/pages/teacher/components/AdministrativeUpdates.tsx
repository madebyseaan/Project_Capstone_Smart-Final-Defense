import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ArchivedClassInfo } from "@/lib/api";

interface AdministrativeUpdatesProps {
  removedCount: number;
  transferredCount: number;
  archivedClasses: ArchivedClassInfo[];
}

type NoticeKind = "removed" | "transferred";

const DISMISS_KEY_PREFIX = "teacher_admin_updates_dismissed_";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

function dismissedStorageKey(): string {
  try {
    const raw = sessionStorage.getItem("user_teacher");
    const userId = raw ? (JSON.parse(raw) as { id?: string }).id : undefined;
    return `${DISMISS_KEY_PREFIX}${userId ?? "anon"}`;
  } catch {
    return `${DISMISS_KEY_PREFIX}anon`;
  }
}

function readDismissedIds(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(dismissedStorageKey()) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function persistDismissedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(dismissedStorageKey(), JSON.stringify([...ids]));
  } catch {
    // Best-effort — dismissal is non-critical.
  }
}

function humanReason(kind: ArchivedClassInfo["kind"]): string {
  switch (kind) {
    case "REMOVED":
      return "Removed from the Atlas teaching load";
    case "ENROLLPRO_REMOVED":
      return "Removed in EnrollPro (teacher unassigned)";
    case "SUSPENDED":
      return "Teacher account suspended";
    case "ADMIN_REMOVED":
      return "Removed by a SMART administrator";
    case "YEAR_ARCHIVE":
      return "School year archived";
    default:
      return "Removed";
  }
}

function NoticeRow({
  kind,
  count,
  expanded,
  onToggle,
  onDismiss,
}: {
  kind: NoticeKind;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}) {
  const isRemoval = kind === "removed";
  const title = isRemoval
    ? `${count} subject assignment${count !== 1 ? "s" : ""} removed`
    : `${count} class${count !== 1 ? "es were" : " was"} transferred to another teacher`;
  const description = isRemoval
    ? "Grade history is preserved. Contact the admin if this was not intended."
    : "This is normal administrative action. Your grades for earlier terms are preserved.";
  const Icon = isRemoval ? AlertTriangle : ArrowRightLeft;

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isRemoval ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-700",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 pl-11 sm:pl-0">
        <Link
          to="/teacher/classes"
          className="rounded-lg px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          View records
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide notice details" : "Show notice details"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notice"
          title="Dismiss notice"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function NoticeDetails({ kind, rows }: { kind: NoticeKind; rows: ArchivedClassInfo[] }) {
  return (
    <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
      {rows.map((ac) => (
        <div key={ac.id} className="rounded-lg border border-border bg-background px-3 py-2">
          {kind === "removed" ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  {ac.subjectName} — {ac.sectionName}{" "}
                  <span className="text-muted-foreground">
                    ({gradeLevelLabels[ac.gradeLevel] ?? ac.gradeLevel})
                  </span>
                </p>
                {ac.hasGrades && (
                  <Badge variant="secondary" className="text-[10px] font-semibold">
                    Grades preserved
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {humanReason(ac.kind)}
                {ac.archivedAt ? ` · ${new Date(ac.archivedAt).toLocaleDateString()}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                {ac.subjectName} — {ac.sectionName} was transferred to{" "}
                {ac.successorTeacherName ?? "another teacher"}
                {ac.archivedAt ? ` on ${new Date(ac.archivedAt).toLocaleDateString()}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Your grades for earlier terms are preserved and already included in the
                student&apos;s permanent record (SF10). The new teacher continues from the current
                term.
              </p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function AdministrativeUpdates({
  removedCount,
  transferredCount,
  archivedClasses,
}: AdministrativeUpdatesProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(readDismissedIds);
  const [expanded, setExpanded] = useState<NoticeKind | null>(null);

  const removalRows = useMemo(
    () =>
      archivedClasses.filter(
        (a) => a.kind !== "TRANSFERRED" && a.kind !== "YEAR_ARCHIVE",
      ),
    [archivedClasses],
  );
  const transferRows = useMemo(
    () => archivedClasses.filter((a) => a.kind === "TRANSFERRED"),
    [archivedClasses],
  );

  const visibleRemovals = removalRows.filter((a) => !dismissedIds.has(a.id));
  const visibleTransfers = transferRows.filter((a) => !dismissedIds.has(a.id));

  const removalVisible =
    removalRows.length > 0
      ? visibleRemovals.length
      : dismissedIds.has("summary:removed")
        ? 0
        : removedCount;
  const transferVisible =
    transferRows.length > 0
      ? visibleTransfers.length
      : dismissedIds.has("summary:transferred")
        ? 0
        : transferredCount;

  if (removalVisible === 0 && transferVisible === 0) return null;

  const dismiss = (kind: NoticeKind) => {
    const rows = kind === "removed" ? visibleRemovals : visibleTransfers;
    const ids = rows.length > 0 ? rows.map((r) => r.id) : [`summary:${kind}`];
    const next = new Set(dismissedIds);
    ids.forEach((id) => next.add(id));
    setDismissedIds(next);
    persistDismissedIds(next);
    setExpanded((prev) => (prev === kind ? null : prev));
  };

  const toggle = (kind: NoticeKind) => {
    setExpanded((prev) => (prev === kind ? null : kind));
  };

  return (
    <Card className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="divide-y divide-border">
        {removalVisible > 0 && (
          <section>
            <NoticeRow
              kind="removed"
              count={removalVisible}
              expanded={expanded === "removed"}
              onToggle={() => toggle("removed")}
              onDismiss={() => dismiss("removed")}
            />
            {expanded === "removed" && visibleRemovals.length > 0 && (
              <NoticeDetails kind="removed" rows={visibleRemovals} />
            )}
          </section>
        )}
        {transferVisible > 0 && (
          <section>
            <NoticeRow
              kind="transferred"
              count={transferVisible}
              expanded={expanded === "transferred"}
              onToggle={() => toggle("transferred")}
              onDismiss={() => dismiss("transferred")}
            />
            {expanded === "transferred" && visibleTransfers.length > 0 && (
              <NoticeDetails kind="transferred" rows={visibleTransfers} />
            )}
          </section>
        )}
      </div>
    </Card>
  );
}
