/**
 * ScheduleDraftPanel — ATLAS §8A draft (unpublished) timetable preview.
 *
 * Shows the logged-in teacher's OWN draft schedule when the scheduler has
 * shared it (per-run sharing switch, default OFF). Never a whole-school draft
 * (contract D3): the server always resolves the ATLAS faculty identity from the
 * caller. Draft rows are raw surrogate ids — labels come from SMART's
 * AtlasCrosswalk; unmapped ids are disclosed per row, never invented.
 *
 * States: shared | not_shared | unavailable (+ loading/error).
 */
import { useState, useEffect, useCallback } from "react";
import {
  FileClock,
  Clock,
  MapPin,
  Users,
  RefreshCw,
  EyeOff,
  AlertTriangle,
  CalendarX2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  scheduleApi,
  type DraftScheduleResponse,
  type DraftScheduleEntryDto,
  type ScheduleTermInfo,
} from "@/lib/api";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;

const DAY_LABELS: Record<string, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
};

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function groupByDay(entries: DraftScheduleEntryDto[]): Array<{ day: string; rows: DraftScheduleEntryDto[] }> {
  const grouped = new Map<string, DraftScheduleEntryDto[]>();
  for (const entry of entries) {
    const key = entry.day.toUpperCase();
    const rows = grouped.get(key) ?? [];
    rows.push(entry);
    grouped.set(key, rows);
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => DAYS.indexOf(a as (typeof DAYS)[number]) - DAYS.indexOf(b as (typeof DAYS)[number]))
    .map(([day, rows]) => ({ day, rows }));
}

interface ScheduleDraftPanelProps {
  termIndex: number | null;
  terms: ScheduleTermInfo[];
  syncVersion?: number;
}

export default function ScheduleDraftPanel({ termIndex, terms, syncVersion }: ScheduleDraftPanelProps) {
  const [data, setData] = useState<DraftScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await scheduleApi.getMyDraft(termIndex ?? undefined);
      setData(res.data);
      setError(null);
    } catch (err: unknown) {
      const payload = (err as { response?: { data?: { code?: string; error?: string } } })?.response?.data;
      setData(null);
      setError({
        code: payload?.code ?? "UNKNOWN",
        message: payload?.error ?? "Failed to load the draft timetable",
      });
    } finally {
      setLoading(false);
    }
  }, [termIndex]);

  useEffect(() => {
    load();
  }, [load, syncVersion]);

  const termLabel =
    terms.find((t) => t.order === termIndex)?.displayLabel ?? (termIndex != null ? `TERM ${termIndex}` : "");

  const cardClass = "border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white";

  // ---- Loading ----
  if (loading && !data) {
    return (
      <Card className={cardClass}>
        <CardContent className="p-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-100">
              <FileClock className="w-5 h-5 text-muted-foreground animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Draft Timetable (Preview)</h2>
              <p className="text-sm text-muted-foreground">Checking for a shared draft…</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Error (contract codes surfaced verbatim) ----
  if (error) {
    return (
      <Card className={cardClass}>
        <CardContent className="p-8">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-red-50 flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Draft Timetable (Preview)</h2>
              <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
              <p className="text-xs text-muted-foreground mt-2">
                <span className="font-medium">Code:</span> {error.code}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={load}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Try again
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // ---- Not shared (the default state — an expected state, not a failure) ----
  if (data.status === "not_shared") {
    return (
      <Card className={cardClass}>
        <CardContent className="p-8">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-slate-100 flex-shrink-0">
              <EyeOff className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Draft Timetable (Preview)</h2>
              <p className="text-sm text-muted-foreground mt-1">
                The next timetable hasn&apos;t been shared for preview yet. You&apos;ll see it here once your
                scheduler opens the draft view.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- No draft run available ----
  if (data.status === "unavailable") {
    const published = data.reason === "PUBLISHED_RUN_IS_NOT_A_DRAFT";
    return (
      <Card className={cardClass}>
        <CardContent className="p-8">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-slate-100 flex-shrink-0">
              <CalendarX2 className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Draft Timetable (Preview)</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {published
                  ? "The latest timetable has already been published — there is no pending draft to preview."
                  : "No draft timetable exists yet. A draft appears here after your scheduler generates one."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Shared draft ----
  const days = groupByDay(data.entries);
  return (
    <Card className={cardClass}>
      <CardContent className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700">
              <FileClock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-foreground">Draft Timetable (Preview)</h2>
                <Badge variant="secondary" className="px-2.5 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider bg-amber-100 text-amber-800 border-0">
                  Draft
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Not yet published · shared by your scheduler for preview
                {termLabel ? ` · ${termLabel}` : ""}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="h-9 px-4 rounded-xl border-border text-foreground hover:bg-muted text-xs font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {(data.runStatus || data.finishedAt) && (
          <p className="text-xs text-muted-foreground mb-4">
            {data.runStatus && <span className="font-medium text-foreground">Run status: {data.runStatus}</span>}
            {data.runStatus && data.finishedAt && " · "}
            {data.finishedAt && <span>Generated {new Date(data.finishedAt).toLocaleString()}</span>}
          </p>
        )}

        {days.length === 0 ? (
          <p className="text-sm text-muted-foreground">The shared draft has no scheduled classes for this term.</p>
        ) : (
          <div className="space-y-5">
            {days.map(({ day, rows }) => (
              <div key={day}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  {DAY_LABELS[day] ?? day}
                </p>
                <div className="space-y-2">
                  {rows.map((entry) => (
                    <div
                      key={`${entry.entryId ?? `${entry.startTime}-${entry.subjectId ?? 0}`}`}
                      className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border"
                    >
                      <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-medium text-foreground whitespace-nowrap">
                        {formatTime12h(entry.startTime)} — {formatTime12h(entry.endTime)}
                      </span>
                      <span className="text-sm font-medium text-foreground truncate">
                        {entry.subjectLabel ?? `Subject #${entry.subjectId ?? "?"}`}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                        <Users className="w-3.5 h-3.5" />
                        {entry.sectionLabel ?? `Section #${entry.sectionId ?? "?"}`}
                      </span>
                      {entry.roomId != null && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                          <MapPin className="w-3.5 h-3.5" />
                          {entry.roomLabel ?? `Room #${entry.roomId}`}
                        </span>
                      )}
                      {entry.unmapped.length > 0 && (
                        <span
                          className="text-[10px] text-muted-foreground whitespace-nowrap"
                          title={`Names not yet synced for: ${entry.unmapped.join(", ")}`}
                        >
                          (unmapped: {entry.unmapped.join(", ")})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground mt-6">
          Draft data is preview-only and may change before publication.
        </p>
      </CardContent>
    </Card>
  );
}
