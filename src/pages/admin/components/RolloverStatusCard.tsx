import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2, Archive, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { adminApi } from "@/lib/api";

interface RolloverStatus {
  currentSY: { id: string; label: string; status: string } | null;
  previousYear: { id: string; label: string; status: string } | null;
  unfinalizedCount: number;
  unfinalizedSections: Array<{ sectionId: string; sectionName: string; gradeLevel: string; draftBlockerCount: number }>;
  snapshotGapCount?: number;
  snapshotGapSections?: Array<{ sectionId: string; sectionName: string; finalizedCount: number; snapshotCount: number }>;
  canArchive: boolean;
}

export default function RolloverStatusCard() {
  const [status, setStatus] = useState<RolloverStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getRolloverStatus();
      setStatus(res.data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleArchive = async () => {
    if (!status?.previousYear) return;
    setArchiving(true);
    setMessage(null);
    try {
      const res = await adminApi.archiveYear(status.previousYear.id);
      setMessage({ text: res.data.message });
      setConfirmArchive(false);
      void load();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage({ text: e?.response?.data?.message ?? "Failed to archive", error: true });
    } finally {
      setArchiving(false);
      setTimeout(() => setMessage(null), 6000);
    }
  };

  return (
    <Card className="border border-border shadow-sm rounded-xl bg-card p-0">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-muted-foreground" />
            <Label className="text-sm font-semibold text-foreground">Rollover Status</Label>
          </div>
          <div className="flex items-center gap-2">
            {message && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                message.error
                  ? "bg-destructive/10 text-destructive border-destructive/20"
                  : "bg-primary/10 text-primary border-primary/20"
              }`}>
                {message.text}
              </span>
            )}
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading rollover status...</span>
          </div>
        ) : !status ? (
          <p className="text-sm text-muted-foreground">Unable to load rollover status.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <div>
                <span className="text-muted-foreground">Active Year: </span>
                <span className="font-semibold text-foreground">{status.currentSY?.label ?? "—"}</span>
                {status.currentSY && <Badge variant="outline" className="ml-2 text-xs">{status.currentSY.status}</Badge>}
              </div>
              {status.previousYear && (
                <div>
                  <span className="text-muted-foreground">Previous: </span>
                  <span className="font-medium text-foreground">{status.previousYear.label}</span>
                  <Badge variant="outline" className="ml-2 text-xs">{status.previousYear.status}</Badge>
                </div>
              )}
            </div>

            {status.previousYear && status.previousYear.status !== "ARCHIVED" && (
              <div className={`p-3 rounded-xl border-2 ${status.unfinalizedCount > 0 || (status.snapshotGapCount ?? 0) > 0 ? "bg-amber-50 border-amber-200" : "bg-primary/5 border-primary/20"}`}>
                {status.unfinalizedCount > 0 ? (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">{status.unfinalizedCount} section(s) unfinalized in {status.previousYear.label}</p>
                      <ul className="text-xs text-amber-700 mt-1 space-y-0.5">
                        {status.unfinalizedSections.slice(0, 5).map((s) => (
                          <li key={s.sectionId}>{s.sectionName} ({s.gradeLevel}) — {s.draftBlockerCount} DRAFT blocker(s)</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (status.snapshotGapCount ?? 0) > 0 ? (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">
                        {status.snapshotGapCount} section(s) in {status.previousYear.label} are missing EOSY promotion snapshots
                      </p>
                      <p className="text-xs text-amber-700 mt-1">
                        Grades are locked but the EOSY finalize step was never completed. Run <strong>EOSY Finalization → Overview → Finalize EOSY</strong> for each section before archiving.
                      </p>
                      <ul className="text-xs text-amber-700 mt-1 space-y-0.5">
                        {status.snapshotGapSections?.slice(0, 5).map((s) => (
                          <li key={s.sectionId}>
                            {s.sectionName} — {s.snapshotCount}/{s.finalizedCount} snapshots created
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <p className="text-sm font-medium text-foreground">{status.previousYear.label} is fully finalized — ready to archive</p>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={archiving}
                      onClick={() => setConfirmArchive(true)}
                    >
                      {archiving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Archive className="w-3.5 h-3.5 mr-1" />}
                      Archive Now
                    </Button>
                  </div>
                )}
              </div>
            )}

            {status.previousYear?.status === "ARCHIVED" && (
              <div className="p-3 bg-muted border border-border rounded-xl">
                <p className="text-sm text-muted-foreground">{status.previousYear.label} has been archived.</p>
              </div>
            )}
          </div>
        )}

        <ConfirmDialog
          open={confirmArchive}
          onOpenChange={setConfirmArchive}
          title="Archive school year"
          description={status?.previousYear ? `Archive ${status.previousYear.label}? This will lock all grades, archive enrollments, and mark sections as completed.` : ""}
          confirmLabel="Archive Now"
          destructive
          loading={archiving}
          onConfirm={handleArchive}
        />
      </CardContent>
    </Card>
  );
}
