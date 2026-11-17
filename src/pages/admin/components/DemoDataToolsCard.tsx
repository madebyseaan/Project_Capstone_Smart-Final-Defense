import { useCallback, useState } from "react";
import { Loader2, FlaskConical, Trash2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { adminApi } from "@/lib/api";

type DevAction = "seed" | "clear";
type Stage = "scores" | "attendance";

function errorMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? "Operation failed";
}

export default function DemoDataToolsCard() {
  const [running, setRunning] = useState<DevAction | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [pending, setPending] = useState<DevAction | null>(null);
  const [finalize, setFinalize] = useState(true);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = useCallback(async (action: DevAction) => {
    if (running) return;
    setPending(null);
    setRunning(action);
    setMessage(null);
    const lines: string[] = [];

    try {
      setStage("scores");
      if (action === "seed") {
        const scores = await adminApi.seedScores({
          action: "seed",
          finalized: finalize,
          clearFirst: true,
        });
        lines.push(scores.data.message);
        if (scores.data.summary) lines.push(scores.data.summary);
      } else {
        const scores = await adminApi.seedScores({ action: "clear" });
        lines.push(scores.data.message);
      }
    } catch (err) {
      setMessage({ text: `Scores step failed: ${errorMessage(err)}`, error: true });
      setRunning(null);
      setStage(null);
      return;
    }

    let partialError = false;
    try {
      setStage("attendance");
      const attendance = await adminApi.seedAttendance({
        action,
        clearFirst: action === "seed",
      });
      lines.push(attendance.data.message);
      if (attendance.data.summary) lines.push(attendance.data.summary);
    } catch (err) {
      partialError = true;
      lines.push(`Attendance step failed: ${errorMessage(err)}`);
    } finally {
      setRunning(null);
      setStage(null);
    }

    setMessage({ text: lines.join("\n\n"), error: partialError || undefined });
  }, [running, finalize]);

  const busy = running !== null;
  const stageLabel =
    running === "seed"
      ? stage === "scores"
        ? "Seeding scores and grades (1/2)..."
        : "Seeding attendance (2/2)..."
      : stage === "scores"
        ? "Clearing scores and grades (1/2)..."
        : "Clearing attendance (2/2)...";

  return (
    <Card className="border border-border shadow-sm rounded-xl bg-card p-0 overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <FlaskConical className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">Demo Data Tools</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              One-click demo data for the active school year
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-1">
          Seeds scores for every active class (3 WW, 2 PT, ST1/ST2/TE), then attendance for every section
          and enrolled learner. Controlled profile: 1 retained (G9), 1 remedial (G8), 1 special-program
          failure (G7-G9, exactly 1 subject). All other SPA/SPS/STE learners stay at 85+ so only the
          intentional learner exits the program on rollover. Requires EnrollPro enrollments and ATLAS
          teaching loads, synced first.
        </p>

        <div className="flex items-center gap-2 mt-3">
          <Switch
            id="demo-finalize-grades"
            checked={finalize}
            onCheckedChange={setFinalize}
            disabled={busy}
          />
          <label htmlFor="demo-finalize-grades" className="text-xs font-medium text-foreground cursor-pointer">
            Finalize grades (EOSY-ready)
          </label>
          <span className="text-[11px] text-muted-foreground">
            {finalize ? "Finalized + EOSY snapshots" : "Draft grades — teachers can still encode"}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mt-3">
          <Button
            onClick={() => setPending("seed")}
            disabled={busy}
            size="sm"
            className="font-semibold text-xs"
          >
            {running === "seed" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {running === "seed" ? "Seeding..." : "Seed Demo Data"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setPending("clear")}
            disabled={busy}
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/5 text-xs font-medium"
          >
            {running === "clear" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            {running === "clear" ? "Clearing..." : "Clear Demo Data"}
          </Button>
        </div>

        {busy && (
          <p className="text-xs font-medium text-muted-foreground mt-2">
            {stageLabel} Keep this tab open until both stages finish.
          </p>
        )}

        {message && (
          <pre
            className={`mt-3 whitespace-pre-wrap text-xs font-medium p-3 rounded-xl border-2 max-h-56 overflow-y-auto ${
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
          title={pending === "seed" ? "Seed demo data" : "Clear demo data"}
          description={
            pending === "seed"
              ? `Replace all grades/scores and attendance for the active school year? Scores are seeded first ${
                  finalize ? "as FINALIZED with EOSY snapshots" : "as DRAFT (not finalized)"
                }, then attendance. Existing grades, snapshots, remedial rows, and promotion statuses are cleared first.`
              : "Delete all scores/grades (all terms), EOSY snapshots, remedial rows, promotion statuses, and attendance for the active school year?"
          }
          confirmLabel={pending === "seed" ? "Seed Demo Data" : "Clear Demo Data"}
          destructive={pending === "clear"}
          loading={busy}
          onConfirm={() => pending && void run(pending)}
        />
      </CardContent>
    </Card>
  );
}
