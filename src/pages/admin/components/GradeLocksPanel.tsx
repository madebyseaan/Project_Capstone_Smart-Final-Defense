import { useCallback, useEffect, useState } from "react";
import { Lock, LockOpen, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { adminApi } from "@/lib/api";
import { toast } from "@/lib/toast";

interface TermLock {
  term: "T1" | "T2" | "T3";
  isLocked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
  unlockedBy: string | null;
  unlockedAt: string | null;
}

interface YearLockRow {
  schoolYearId: string;
  label: string;
  status: string;
  yearLock: { isLocked: boolean; lockedBy: string | null; lockedAt: string | null };
  termLocks: TermLock[];
}

type ConfirmState =
  | { kind: "term"; row: YearLockRow; term: TermLock; nextLocked: boolean }
  | { kind: "year"; row: YearLockRow; nextLocked: boolean };

function humanStatus(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "ARCHIVED":
      return "Archived";
    case "DRAFT":
      return "Draft";
    default:
      return status;
  }
}

function provenance(who: string | null | undefined, at: string | null | undefined): string | undefined {
  if (!who && !at) return undefined;
  const when = at ? new Date(at).toLocaleString() : "";
  return [who, when].filter(Boolean).join(" · ");
}

export default function GradeLocksPanel() {
  const [locks, setLocks] = useState<YearLockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getYearLocks();
      setLocks(res.data.locks ?? []);
      setError(null);
    } catch {
      setError("Failed to load grade locks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "term") {
        await adminApi.toggleTermLock(confirm.row.schoolYearId, confirm.term.term, confirm.nextLocked);
      } else {
        await adminApi.toggleYearLock(confirm.row.schoolYearId, confirm.nextLocked);
      }
      await load();
      setConfirm(null);
    } catch {
      toast.error("Failed to update lock");
    } finally {
      setBusy(false);
    }
  };

  const confirmCopy = () => {
    if (!confirm) return { title: "", description: "", confirmLabel: "Confirm", destructive: false };
    if (confirm.kind === "term") {
      return confirm.nextLocked
        ? {
            title: `Lock ${confirm.term.term}?`,
            description: `Teachers will not be able to edit ${confirm.term.term} grades for ${confirm.row.label} unless an approved edit request exists.`,
            confirmLabel: "Lock term",
            destructive: true,
          }
        : {
            title: `Unlock ${confirm.term.term}?`,
            description: `Teachers will be able to edit ${confirm.term.term} grades for ${confirm.row.label} again.`,
            confirmLabel: "Unlock term",
            destructive: false,
          };
    }
    return confirm.nextLocked
      ? {
          title: `Lock the whole year ${confirm.row.label}?`,
          description: `This blocks grade editing for every term of ${confirm.row.label}. Nothing bypasses a year lock except an admin unlock.`,
          confirmLabel: "Lock year",
          destructive: true,
        }
      : {
          title: `Unlock the whole year ${confirm.row.label}?`,
          description: `Grade editing for every term of ${confirm.row.label} will be allowed (subject to term locks).`,
          confirmLabel: "Unlock year",
          destructive: false,
        };
  };

  const copy = confirmCopy();

  const lockButton = (locked: boolean, archived: boolean, title: string, onClick: () => void) => (
    <Button
      size="sm"
      variant={locked ? "destructive" : "outline"}
      className="h-8 gap-1.5 text-xs"
      disabled={archived}
      title={title}
      onClick={onClick}
    >
      {locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
      {locked ? "Locked" : "Open"}
    </Button>
  );

  return (
    <Card className="border border-border shadow-sm rounded-xl bg-card p-0">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Per-Year / Per-Term Locks</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              A term lock blocks one term — an <strong>approved edit request</strong> lets a teacher
              through. A year lock blocks the whole school year and cannot be bypassed by an edit
              request. Archived years are permanently locked.
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
            Refresh
          </Button>
        </div>

        {error && <p className="text-xs text-destructive mb-2">{error}</p>}

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading locks...</span>
          </div>
        ) : locks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No school years found.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-muted/50 border-b border-border bg-muted/50">
                  <TableHead>School Year</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Term 1</TableHead>
                  <TableHead className="text-center">Term 2</TableHead>
                  <TableHead className="text-center">Term 3</TableHead>
                  <TableHead className="text-center">Whole Year</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locks.map((row) => {
                  const archived = row.status === "ARCHIVED";
                  return (
                    <TableRow key={row.schoolYearId} className="border-b border-border/20">
                      <TableCell className="font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {row.label}
                          {row.status === "ACTIVE" && (
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px]">Active</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={archived ? "bg-muted text-muted-foreground border-border" : "text-foreground"}
                        >
                          {humanStatus(row.status)}
                        </Badge>
                      </TableCell>
                      {row.termLocks.map((tl) => (
                        <TableCell key={tl.term} className="text-center">
                          {lockButton(
                            tl.isLocked,
                            archived,
                            archived
                              ? "Archived years are permanently locked"
                              : provenance(tl.isLocked ? tl.lockedBy : tl.unlockedBy, tl.isLocked ? tl.lockedAt : tl.unlockedAt) ||
                                  (tl.isLocked ? "Locked" : "Open"),
                            () => setConfirm({ kind: "term", row, term: tl, nextLocked: !tl.isLocked })
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="text-center">
                        {lockButton(
                          row.yearLock.isLocked,
                          archived,
                          archived
                            ? "Archived years are permanently locked"
                            : provenance(row.yearLock.lockedBy, row.yearLock.lockedAt) || (row.yearLock.isLocked ? "Locked" : "Open"),
                          () => setConfirm({ kind: "year", row, nextLocked: !row.yearLock.isLocked })
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        destructive={copy.destructive}
        loading={busy}
        onConfirm={runConfirm}
      />
    </Card>
  );
}
