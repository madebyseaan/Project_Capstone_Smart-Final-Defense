import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AimsDriftChange } from "@/lib/api";

interface AimsUpdateDiffProps {
  changes: AimsDriftChange[];
  checkedAt: string | null;
  lastSyncedAt: string | null;
  loading: boolean;
  applying: boolean;
  isViewOnly: boolean;
  onCheckAgain: () => void;
  onApply: (selected: Array<{ studentId: string; assessmentId: string }>) => void;
  onBack: () => void;
}

const keyOf = (c: Pick<AimsDriftChange, "studentId" | "assessmentId">) =>
  `${c.studentId}:${c.assessmentId}`;

const isAppliable = (c: AimsDriftChange) =>
  c.kind === "changed" && !c.blockReason;

const catLabel = (category: string) => (category === "QA" ? "TA" : category);

const catClass = (category: string) =>
  category === "WW"
    ? "text-[var(--ledger-ww)]"
    : category === "QA"
      ? "text-[var(--ledger-ta)]"
      : "text-[var(--ledger-pt)]";

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(2);

const relativeTime = (iso: string | null) => {
  if (!iso) return "never";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export function AimsUpdateDiff({
  changes,
  checkedAt,
  lastSyncedAt,
  loading,
  applying,
  isViewOnly,
  onCheckAgain,
  onApply,
  onBack,
}: AimsUpdateDiffProps) {
  const defaultSelected = useMemo(
    () =>
      new Set(
        changes
          .filter((c) => isAppliable(c) && !c.teacherEdited)
          .map(keyOf),
      ),
    [changes],
  );
  const [selected, setSelected] = useState<Set<string>>(defaultSelected);

  useEffect(() => {
    setSelected(defaultSelected);
  }, [defaultSelected]);

  const selectableCount = useMemo(
    () => changes.filter(isAppliable).length,
    [changes],
  );
  const blockedCount = useMemo(
    () => changes.filter((c) => c.kind === "changed" && c.blockReason).length,
    [changes],
  );

  const toggle = (c: AimsDriftChange) => {
    if (!isAppliable(c) || isViewOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(c);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === selectableCount) setSelected(new Set());
    else setSelected(new Set(changes.filter(isAppliable).map(keyOf)));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          AIMS Score Changes
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)]">
            Review
          </span>
        </DialogTitle>
        <DialogDescription>
          These imported scores changed in AIMS. SMART recomputes grades after applying — AIMS only replaces the score in that column.
          {` Checked ${relativeTime(checkedAt)} · Last AIMS sync ${relativeTime(lastSyncedAt)}.`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCheckAgain} disabled={loading || applying} className="gap-1.5">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Check AIMS again
        </Button>
      </div>

      {loading ? (
        <div className="py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking for score changes...
        </div>
      ) : changes.length === 0 ? (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/50 border border-border">
          <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-foreground">
            No changes found. Every imported AIMS score matches what AIMS currently shows.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selectableCount > 0 && selected.size === selectableCount}
                onChange={toggleAll}
                disabled={selectableCount === 0 || isViewOnly}
                className="h-4 w-4 rounded border-border"
              />
              {selected.size} of {selectableCount} selected
            </label>
            {blockedCount > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {blockedCount} change(s) cannot be applied now
              </span>
            )}
          </div>

          <div className="max-h-80 overflow-auto rounded-xl border border-border">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Student</th>
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Assessment</th>
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Previous</th>
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">AIMS now</th>
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => {
                  const appliable = isAppliable(c);
                  const k = keyOf(c);
                  const delta =
                    c.previous !== null ? c.current.pointsEarned - c.previous.pointsEarned : null;
                  return (
                    <tr key={k} className="border-b border-border last:border-0 align-top">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(k)}
                          disabled={!appliable || isViewOnly}
                          onChange={() => toggle(c)}
                          className="h-4 w-4 rounded border-border"
                          aria-label={`Select ${c.studentName} ${c.assessmentTitle}`}
                        />
                      </td>
                      <td className="px-2 py-2 text-sm text-foreground whitespace-nowrap">{c.studentName}</td>
                      <td className="px-2 py-2">
                        <p className="text-sm text-foreground truncate max-w-[16rem]" title={c.assessmentTitle}>
                          {c.assessmentTitle}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          <span className={`font-semibold ${catClass(c.category)}`}>{catLabel(c.category)}</span>
                          {" · "}
                          {c.type}
                          {" · "}
                          attempt {c.current.attemptNumber}
                        </p>
                      </td>
                      <td className="px-2 py-2 text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                        {c.previous ? `${fmt(c.previous.pointsEarned)} / ${fmt(c.previous.maxPoints)}` : "—"}
                      </td>
                      <td className="px-2 py-2 text-sm text-foreground font-semibold tabular-nums whitespace-nowrap">
                        {fmt(c.current.pointsEarned)} / {fmt(c.current.maxPoints)}
                        {delta !== null && delta !== 0 && (
                          <span className={delta > 0 ? "ml-1.5 text-emerald-600" : "ml-1.5 text-rose-600"}>
                            ({delta > 0 ? "+" : ""}{fmt(delta)})
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {c.kind === "term_moved" ? (
                          <span className="text-[11px] text-muted-foreground">{c.blockReason}</span>
                        ) : c.blockReason ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-rose-600">
                            <AlertTriangle className="w-3 h-3" /> {c.blockReason}
                          </span>
                        ) : c.teacherEdited ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600" title="The ledger value differs from what AIMS imported last time. Applying will overwrite your manual edit.">
                            <AlertTriangle className="w-3 h-3" /> Edited in ledger
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ledger-aims)]">
                            <Check className="w-3 h-3" /> Changed in AIMS
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button
          onClick={() =>
            onApply(
              changes
                .filter((c) => selected.has(keyOf(c)) && isAppliable(c))
                .map((c) => ({ studentId: c.studentId, assessmentId: c.assessmentId })),
            )
          }
          disabled={applying || isViewOnly || selected.size === 0}
          className="gap-1.5"
        >
          {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Apply {selected.size} update(s)
        </Button>
      </DialogFooter>
    </>
  );
}
