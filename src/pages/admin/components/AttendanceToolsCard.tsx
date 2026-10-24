import { useCallback, useState } from "react";
import { Loader2, FlaskConical, Trash2, CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { adminApi } from "@/lib/api";

type DevAction = "seed" | "clear";

export default function AttendanceToolsCard() {
  const [running, setRunning] = useState<DevAction | null>(null);
  const [pending, setPending] = useState<DevAction | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = useCallback(async (action: DevAction) => {
    if (running) return;
    setPending(null);
    setRunning(action);
    setMessage(null);
    try {
      const res = await adminApi.seedAttendance({
        action,
        clearFirst: action === "seed",
      });
      setMessage({ text: res.data.message });
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
            <p className="text-sm font-semibold text-foreground leading-tight">Attendance Tools (Demo)</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Seed simulated attendance for testing only
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-1">
          Generates SF2-aligned attendance for every section and enrolled learner in the active school year — weekdays
          inside the EnrollPro-synced term windows, from the start of the school year up to today. Requires sections and
          enrolled students synced first.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mt-3">
          <Button
            onClick={() => setPending("seed")}
            disabled={busy}
            size="sm"
            className="font-semibold text-xs"
          >
            {running === "seed" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CalendarDays className="w-4 h-4 mr-2" />}
            {running === "seed" ? "Seeding..." : "Seed Attendance (Demo Ready)"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setPending("clear")}
            disabled={busy}
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/5 text-xs font-medium"
          >
            {running === "clear" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            {running === "clear" ? "Clearing..." : "Clear Attendance"}
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
          title={pending === "seed" ? "Seed attendance" : "Clear attendance"}
          description={
            pending === "seed"
              ? "Replace all existing attendance for the active school year with simulated records aligned to the EnrollPro term calendar (weekdays, school year start to today)?"
              : "Delete all attendance records for the active school year? Grades are not affected."
          }
          confirmLabel={pending === "seed" ? "Seed Attendance" : "Clear Attendance"}
          destructive={pending === "clear"}
          loading={busy}
          onConfirm={() => pending && void run(pending)}
        />
      </CardContent>
    </Card>
  );
}
