import { useCallback, useState } from "react";
import { Loader2, FlaskConical, Trash2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { adminApi } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

export default function DeveloperToolsCard() {
  const { colors } = useTheme();
  const [running, setRunning] = useState<"seed" | "clear" | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = useCallback(async (action: "seed" | "clear", finalized: boolean, confirmText: string) => {
    if (running) return;
    if (!window.confirm(confirmText)) return;
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
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? "Operation failed";
      setMessage({ text: msg, error: true });
    } finally {
      setRunning(null);
    }
  }, [running]);

  const busy = running !== null;

  return (
    <Card className="border border-border shadow-sm rounded-2xl bg-card/70 backdrop-blur-xl p-0 overflow-hidden mb-8">
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
            onClick={() => run("seed", true, "Replace all existing grades for the active school year with simulated scores, lock them, and complete EOSY? This makes the year rollover-ready.")}
            disabled={busy}
            style={{ backgroundColor: colors.primary }}
            className="text-primary-foreground"
          >
            {running === "seed" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {running === "seed" ? "Seeding..." : "Seed + Finalize (Demo Ready)"}
          </Button>
          <Button
            variant="outline"
            onClick={() => run("clear", false, "Delete all grades, snapshots, remedial records, and reset promotion status for the active school year?")}
            disabled={busy}
            className="text-destructive border-destructive/30 hover:bg-destructive/5"
          >
            {running === "clear" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            {running === "clear" ? "Clearing..." : "Clear Grades"}
          </Button>
        </div>

        {message && (
          <pre
            className={`mt-3 whitespace-pre-wrap text-xs font-medium p-3 rounded-xl border max-h-40 overflow-y-auto ${
              message.error
                ? "bg-rose-50 text-rose-700 border-rose-200"
                : "bg-emerald-50 text-emerald-800 border-emerald-200"
            }`}
          >
            {message.text}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}