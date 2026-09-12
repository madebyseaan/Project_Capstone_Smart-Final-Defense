import { useCallback, useState } from "react";
import { Loader2, FlaskConical, Trash2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { adminApi } from "@/lib/api";

type DevAction = "seed" | "clear";

export default function DeveloperToolsCard() {
  const [running, setRunning] = useState<DevAction | null>(null);
  const [pending, setPending] = useState<DevAction | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = useCallback(async (action: DevAction, finalized: boolean) => {
    if (running) return;
    setPending(null);
    setRunning(action);
    setMessage(null);
    try {
      const res = await adminApi.seedScores({
        action,
        finalized,
        clearFirst: action === "seed",
      });
      const text = res.data.summary || res.data.message;
      setMessage({ text: res.data.message + (text && text !== res.data.message ? `\n${text}` : "") });
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      const msg = e?.response?.data?.message ?? e?.message ?? "Operation failed";
      setMessage({ text: msg, error: true });
    } finally {
      setRunning(null);
    }
  }, [running]);

  const busy = running !== null;

  return (
    <Card className="border border-border shadow-sm rounded-xl bg-card p-0 overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <FlaskConical className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">Developer Tools (Demo)</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Seed simulated scores for testing only
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-1">
          Generates realistic grades for every teacher in the active school year (honors, average, at-risk, retained,
          remedial). Requires students enrolled in EnrollPro and teaching loads from ATLAS, synced first.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mt-3">
          <Button
            onClick={() => setPending("seed")}
            disabled={busy}
            size="sm"
            className="font-semibold text-xs"
          >
            {running === "seed" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {running === "seed" ? "Seeding..." : "Seed + Finalize (Demo Ready)"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setPending("clear")}
            disabled={busy}
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/5 text-xs font-medium"
          >
            {running === "clear" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            {running === "clear" ? "Clearing..." : "Clear Grades"}
          </Button>
        </div>

        {message && (
          <pre
            className={`mt-3 whitespace-pre-wrap text-xs font-medium p-3 rounded-xl border-2 max-h-40 overflow-y-auto ${
              message.error
                ? "bg-destructive/5 text-destructive border-destructive/20"
                : "bg-primary/5 text-primary border-primary/20"
            }`}
          >
            {message.text}
          </pre>
        )}

        <ConfirmDialog
          open={pending !== null}
          onOpenChange={(open) => !open && setPending(null)}
          title={pending === "seed" ? "Seed and finalize grades" : "Clear grades"}
          description={
            pending === "seed"
              ? "Replace all existing grades for the active school year with simulated scores, lock them, and complete EOSY? This makes the year rollover-ready."
              : "Delete all grades, snapshots, remedial records, and reset promotion status for the active school year?"
          }
          confirmLabel={pending === "seed" ? "Seed + Finalize" : "Clear Grades"}
          destructive={pending === "clear"}
          loading={busy}
          onConfirm={() => pending && void run(pending, pending === "seed")}
        />
      </CardContent>
    </Card>
  );
}
