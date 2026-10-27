import { useState, useEffect } from "react";
import { CalendarDays, Clock, RefreshCw, BookOpen, MapPin, AlertTriangle, CalendarClock, Sun, Coffee, UtensilsCrossed, Info, MoveHorizontal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSyncStream } from "@/hooks/useSyncStream";
import {
  scheduleApi,
  type ScheduleDataDto,
  type ScheduleEntryDto,
  type ScheduleSpecialEvent,
  type ScheduleTermInfo,
} from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import ScheduleDraftPanel from "./components/ScheduleDraftPanel";

// ---------------------------------------------------------------------------
// Types (server DTOs — ATLAS term-aware published-schedule contract)
// ---------------------------------------------------------------------------
type ScheduleEntry = ScheduleEntryDto;
type ScheduleData = ScheduleDataDto;

// ---------------------------------------------------------------------------
// Time slot types — class slots and break slots (contract §4.4 specialEvents)
// ---------------------------------------------------------------------------
interface ClassSlot {
  type: "class";
  start: string;
  end: string;
  entries: Record<string, ScheduleEntry>;
  /** Contract special-event window matching this row exactly (§4.4). */
  event?: ScheduleSpecialEvent | undefined;
}

interface BreakSlot {
  type: "break";
  start: string;
  end: string;
  /** Contract event name — the display label (never invented). */
  eventName: string;
  breakType: "recess" | "lunch" | "other";
  durationMin: number;
  /** Days the window applies to (`specialEvents[].days`). */
  days: string[];
}

type TimeSlot = ClassSlot | BreakSlot;

// ---------------------------------------------------------------------------
// Constants — matching ClassRecordsList.tsx exactly
// ---------------------------------------------------------------------------
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;
const DAY_LABELS: Record<string, string> = {
  MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday", THURSDAY: "Thursday", FRIDAY: "Friday",
};
const DAY_SHORT: Record<string, string> = {
  MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri",
};

// Grade colors — same palette as ClassRecordsList.tsx
function getGradeColors(gradeLevel: string) {
  switch (gradeLevel) {
    case "GRADE_7": return {
      badge: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
      cell: "bg-emerald-50/40 border-emerald-200 hover:bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:hover:bg-emerald-500/15",
      dot: "bg-emerald-400",
      text: "text-emerald-800 dark:text-emerald-200",
    };
    case "GRADE_8": return {
      badge: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
      cell: "bg-amber-50/40 border-amber-200 hover:bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 dark:hover:bg-amber-500/15",
      dot: "bg-amber-400",
      text: "text-amber-800 dark:text-amber-200",
    };
    case "GRADE_9": return {
      badge: "bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20",
      cell: "bg-rose-50/40 border-rose-200 hover:bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/20 dark:hover:bg-rose-500/15",
      dot: "bg-rose-400",
      text: "text-rose-800 dark:text-rose-200",
    };
    case "GRADE_10": return {
      badge: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20",
      cell: "bg-blue-50/40 border-blue-200 hover:bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 dark:hover:bg-blue-500/15",
      dot: "bg-blue-400",
      text: "text-blue-800 dark:text-blue-200",
    };
    default: return {
      badge: "bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20",
      cell: "bg-indigo-50/40 border-indigo-200 hover:bg-indigo-50 dark:bg-indigo-500/10 dark:border-indigo-500/20 dark:hover:bg-indigo-500/15",
      dot: "bg-indigo-400",
      text: "text-indigo-800 dark:text-indigo-200",
    };
  }
}

function formatGradeShort(gradeLevel: string): string {
  const map: Record<string, string> = { GRADE_7: "G7", GRADE_8: "G8", GRADE_9: "G9", GRADE_10: "G10" };
  return map[gradeLevel] ?? gradeLevel;
}

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

function formatSectionLabel(gradeLevel: string, sectionName: string): string {
  return `${gradeLevelLabels[gradeLevel] ?? gradeLevel} - ${sectionName}`;
}

const ABBREVIATIONS: Record<string, string> = {
  "Environmental Science": "Env. Science",
  "Applied Chemistry": "App. Chemistry",
  "Physical Science": "Phys. Science",
  "General Science": "Gen. Science",
  "Earth Science": "Earth Sci.",
  "Life Science": "Life Sci.",
  "Social Studies": "Social Std.",
  "Filipino": "Filipino",
  "Araling Panlipunan": "Aral. Pan.",
  "Edukasyon sa Pagpapakatao": "ESP",
  "Technology and Livelihood Education": "TLE",
  "Understanding Culture Society and Politics": "UCSP",
  "Komunikasyon at Pananaliksik": "Kom. Pan.",
  "Reading and Writing Skills": "Read & Write",
  "Contemporary Arts": "Contemp. Arts",
  "Media and Information Literacy": "MIL",
  "Physical Education": "P.E.",
  "Mathematics": "Math",
  "English": "English",
  "Science": "Science",
};

function stripGradeSuffix(name: string): string {
  return name.replace(/\s*\d+$/, "").trim();
}

function shortenSubject(name: string): string {
  if (name.length <= 15) return name;
  for (const [full, short] of Object.entries(ABBREVIATIONS)) {
    if (name.startsWith(full)) {
      return name.replace(full, short);
    }
  }
  return name;
}

function getDayKey(): string {
  const day = new Date().getDay();
  const map = ["", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "", ""];
  return map[day] ?? "";
}

/** Convert "08:15" to "8:15 AM" */
function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Convert "HH:MM" to total minutes since midnight for gap calculation */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function TeacherSchedule() {
  const { colors } = useTheme();
  const { syncVersion } = useSyncStream();
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<"agenda" | "week">("agenda");
  const [selectedDay, setSelectedDay] = useState<string>(getDayKey() || "MONDAY");

  const fetchSchedule = async (termIndex?: number | null) => {
    try {
      const res = await scheduleApi.getMySchedule(termIndex ?? undefined);
      setSchedule(res.data);
      setError(null);
    } catch {
      setError("Failed to load schedule");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSchedule(selectedTerm); }, [syncVersion, selectedTerm]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await scheduleApi.refreshSchedule(); } catch { /* fire-and-forget */ }
    setTimeout(() => setRefreshing(false), 2000);
  };

  const todayKey = getDayKey();
  const todayClasses = schedule?.byDay[todayKey] ?? [];
  const selectedDayClasses = [...(schedule?.byDay[selectedDay] ?? [])].sort(
    (a, b) => a.startTime.localeCompare(b.startTime),
  );
  const gridRows = getTimeSlots(schedule?.entries ?? [], schedule?.specialEvents ?? [], schedule?.timeSlots ?? []);
  const gradeLevels = [...new Set((schedule?.entries ?? []).map(e => e.section.gradeLevel))].sort();
  const terms: ScheduleTermInfo[] = schedule?.terms ?? [];
  const meta = schedule?.meta ?? null;
  const activeTerm = selectedTerm ?? schedule?.activeTermIndex ?? schedule?.requestedTermIndex ?? null;

  // ---- Shared fragments (contract §7.5: surface gaps/conflicts to a human) ----
  const notices = (
    <>
      {meta?.conflict === "ACTIVE_SCHOOL_YEAR_AMBIGUOUS" && (
        <Card className="border border-destructive/30 bg-destructive/5 rounded-2xl">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">Schedule sync paused — ambiguous school year</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                ATLAS reports more than one active school year. An administrator must choose which year is current
                before schedules can sync again.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {(meta?.snapshotGaps?.length ?? 0) > 0 && (
        <Card className="border border-amber-300/40 bg-amber-50/50 rounded-2xl">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">Schedule data may be incomplete</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                The ATLAS timetable snapshot reports gaps:{" "}
                <span className="font-medium text-foreground">{meta!.snapshotGaps.join(", ")}</span>
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {meta?.isHistorical && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="w-4 h-4" />
          <span>Viewing a historical (archived) school year.</span>
        </div>
      )}
    </>
  );

  const termChips = terms.length > 1 ? (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Term:</span>
      {terms.map((t) => {
        const isActive = t.order === activeTerm;
        return (
          <button
            key={t.identity}
            type="button"
            onClick={() => setSelectedTerm(t.order)}
            className={`min-h-12 rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1.5 ${
              isActive
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {t.displayLabel}
          </button>
        );
      })}
    </div>
  ) : null;

  const gradeLegend = gradeLevels.length > 1 ? (
    <div className="flex items-center gap-2.5 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Grade Levels:</span>
      {gradeLevels.map((gl) => {
        const gc = getGradeColors(gl);
        return (
          <span key={gl} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${gc.badge}`}>
            <span className={`w-2 h-2 rounded-full ${gc.dot}`} />
            {formatGradeShort(gl)}
          </span>
        );
      })}
    </div>
  ) : null;

  const filterContent = termChips || gradeLegend ? (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-8">
      {termChips}
      {gradeLegend}
    </div>
  ) : null;

  const mobileFilterBar = filterContent ? (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm lg:hidden">
      {filterContent}
    </div>
  ) : null;

  const draftPanel = (
    <ScheduleDraftPanel termIndex={activeTerm} terms={terms} syncVersion={syncVersion} />
  );

  // ---- Loading ----
  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-12">
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
              <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: colors.primary, borderTopColor: "transparent" }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <CalendarDays className="w-8 h-8 animate-pulse" style={{ color: colors.primary }} />
              </div>
            </div>
            <p className="text-muted-foreground font-semibold text-lg animate-pulse">Loading your schedule...</p>
          </div>
        </div>
      </div>
    );
  }

  // ---- Error ----
  if (error) {
    return (
      <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-12">
        <Card className="rounded-2xl border border-border bg-card shadow-sm">
          <CardContent className="py-32 text-center">
            <div className="w-24 h-24 bg-red-50 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 shadow-sm">
              <AlertTriangle className="w-10 h-10 text-red-400" />
            </div>
            <h3 className="font-bold text-foreground text-2xl mb-3">Unable to Load Schedule</h3>
            <p className="text-muted-foreground max-w-sm mx-auto font-medium text-lg leading-relaxed">{error}</p>
            <Button onClick={() => fetchSchedule(selectedTerm)} className="mt-6 h-12 px-8 rounded-2xl text-white font-bold shadow-lg" style={{ backgroundColor: colors.primary }}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Empty ----
  if (!schedule || schedule.count === 0) {
    return (
      <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-12">
        {/* Header */}
        <PageHeader
          title="My Schedule"
          description={`S.Y. ${schedule?.schoolYear ?? ""}`}
          footer={filterContent}
        />

        {notices}

        {/* Draft preview — shown even with no published schedule */}
        {draftPanel}

        {/* Empty state card */}
        <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <CardContent className="p-10 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-[1.75rem] bg-muted flex items-center justify-center mb-6">
              <CalendarClock className="w-9 h-9 text-muted-foreground" />
            </div>
            <h3 className="font-bold text-foreground text-2xl mb-2">No Schedule Published</h3>
            <p className="text-muted-foreground font-medium max-w-sm mx-auto leading-relaxed mb-8 text-center">
              Your weekly timetable will appear here once your administrator publishes it.
            </p>

            {/* Feature hints */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl mx-auto">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <CalendarDays className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-foreground">Weekly Grid</p>
                  <p className="text-[11px] text-muted-foreground">Mon–Fri timetable</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-foreground">Time Slots</p>
                  <p className="text-[11px] text-muted-foreground">Period-by-period</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Sun className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-foreground">Today&apos;s Classes</p>
                  <p className="text-[11px] text-muted-foreground">Quick glance at today</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Main render ----
  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* Compact mobile header */}
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            S.Y. {schedule.schoolYear} · {schedule.count} classes/week
          </p>
          <h1 className="mt-0.5 text-xl font-semibold text-foreground">Weekly schedule</h1>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={refreshing}
          variant="outline"
          size="icon"
          aria-label="Refresh schedule"
          className="h-12 w-12 shrink-0 rounded-xl"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Desktop header */}
      <div className="hidden lg:block">
        <PageHeader
          title="My Schedule"
          description={`S.Y. ${schedule.schoolYear} · ${schedule.count} class${schedule.count !== 1 ? "es" : ""} per week`}
          footer={filterContent}
          actions={
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              className="h-12 px-6 rounded-xl border-border text-foreground font-semibold hover:bg-muted text-sm shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Syncing..." : "Refresh"}
            </Button>
          }
        />
      </div>

      {notices}
      {mobileFilterBar}

      {/* Mobile view switch */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 lg:hidden">
        {(["agenda", "week"] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setMobileView(view)}
            aria-pressed={mobileView === view}
            className={cn(
              "min-h-12 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors",
              mobileView === view ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {view === "agenda" ? "Day agenda" : "Week grid"}
          </button>
        ))}
      </div>

      {/* Mobile day agenda */}
      {mobileView === "agenda" && (
        <Card className="rounded-2xl border border-border bg-card shadow-sm lg:hidden">
          <CardContent className="p-0">
            <div className="grid grid-cols-5 gap-1 border-b border-border p-2">
              {DAYS.map((day) => {
                const active = selectedDay === day;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    aria-pressed={active}
                    aria-label={DAY_LABELS[day]}
                    className={cn(
                      "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground active:bg-muted",
                    )}
                  >
                    <span>{DAY_SHORT[day]}</span>
                    {day === todayKey && (
                      <span className={cn("text-[9px] font-bold uppercase tracking-wide", active ? "text-primary-foreground/80" : "text-primary")}>
                        Today
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{DAY_LABELS[selectedDay]}</h2>
                  <p className="text-xs text-muted-foreground">
                    {selectedDayClasses.length} {selectedDayClasses.length === 1 ? "class" : "classes"}
                  </p>
                </div>
                <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide">
                  {selectedDay === todayKey ? "Today" : "Selected day"}
                </Badge>
              </div>

              {selectedDayClasses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                  <Sun className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">No classes scheduled</p>
                  <p className="mt-1 text-xs text-muted-foreground">Enjoy the free day.</p>
                </div>
              ) : (
                <ol className="space-y-2">
                  {selectedDayClasses.map((entry, idx) => {
                    const gc = getGradeColors(entry.section.gradeLevel);
                    return (
                      <li key={entry.id} className={cn("flex gap-3 rounded-xl border p-3", gc.cell)}>
                        <div className="w-16 shrink-0 border-r border-border/60 pr-2 text-xs font-semibold text-muted-foreground">
                          <p className="whitespace-nowrap text-foreground">{formatTime12h(entry.startTime)}</p>
                          <p className="mt-0.5 whitespace-nowrap">{formatTime12h(entry.endTime)}</p>
                          <p className="mt-1 text-[10px] font-medium uppercase tracking-wide">#{idx + 1}</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-sm font-semibold", gc.text)} title={entry.subject.name}>
                            {stripGradeSuffix(entry.subject.name)}
                          </p>
                          <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                            {formatSectionLabel(entry.section.gradeLevel, entry.section.name)}
                          </p>
                          {roomDisplay(entry) && (
                            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{roomDisplay(entry)!.text}</span>
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grade Level Legend */}
      {mobileView === "week" && (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground lg:hidden">
          <MoveHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Swipe to see the full week
        </p>
      )}

      {/* Weekly Timetable Grid */}
      <div className={cn(mobileView === "week" ? "block" : "hidden", "lg:block")}>
      <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-border" style={{ backgroundColor: `${colors.primary}08` }}>
                  <th className="sticky left-0 z-20 w-[84px] bg-card px-3 py-5 lg:w-[120px] lg:px-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time</th>
                  {DAYS.map((day) => {
                    const isToday = day === todayKey;
                    return (
                      <th key={day} className={`px-3 py-5 text-center ${isToday ? "bg-primary/5" : ""}`}>
                        <div className="flex flex-col items-center gap-1.5">
                          <span className={`text-xs font-bold uppercase tracking-widest ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                            {DAY_SHORT[day]}
                          </span>
                          {isToday && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: colors.primary }}>
                              Today
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gridRows.map((slot, idx) => {
                  // --- Break row (contract §4.4 specialEvents window) ---
                  if (slot.type === "break") {
                    const BreakIcon = slot.breakType === "lunch" ? UtensilsCrossed : slot.breakType === "recess" ? Coffee : Sun;
                    const label = slot.eventName;
                    const tone = slot.breakType === "lunch" ? "orange" : slot.breakType === "recess" ? "amber" : "slate";
                    return (
                      <tr key={`break-${idx}`} className="border-y border-dashed border-border">
                        {/* Time column */}
                        <td className="sticky left-0 z-10 whitespace-nowrap border-r border-border bg-card px-3 py-3 align-middle lg:px-4">
                          <div className="flex items-center gap-2.5">
                            <div className={`hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg lg:flex ${tone === "orange" ? "bg-orange-50" : tone === "amber" ? "bg-amber-50" : "bg-slate-100"}`}>
                              <BreakIcon className={`w-4 h-4 ${tone === "orange" ? "text-orange-400" : tone === "amber" ? "text-amber-500" : "text-muted-foreground"}`} />
                            </div>
                            <div className="leading-none">
                              <p className="text-sm font-bold text-muted-foreground whitespace-nowrap">{formatTime12h(slot.start)}</p>
                              <p className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap mt-1">{formatTime12h(slot.end)}</p>
                            </div>
                          </div>
                        </td>
                        {/* Day columns — only the days the window applies to (§4.4 days[]) */}
                        {DAYS.map((day) => {
                          const applies = slot.days.length === 0 || slot.days.includes(day);
                          if (!applies) {
                            return (
                              <td key={day} className="px-2 py-2 align-middle">
                                <div className={`min-h-[88px] rounded-2xl ${day === todayKey ? "bg-primary/[0.03]" : "bg-muted/40"}`} />
                              </td>
                            );
                          }
                          return (
                            <td key={day} className="px-2 py-2 align-middle">
                              <div className={`min-h-[88px] rounded-2xl border border-dashed flex flex-col items-center justify-center gap-1 ${
                                tone === "orange"
                                  ? "border-orange-200/60 bg-orange-50/30"
                                  : tone === "amber"
                                    ? "border-amber-200/60 bg-amber-50/30"
                                    : "border-border bg-muted/30"
                              }`}>
                                <BreakIcon className={`w-4 h-4 ${tone === "orange" ? "text-orange-300" : tone === "amber" ? "text-amber-400" : "text-muted-foreground"}`} />
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${tone === "orange" ? "text-orange-400" : tone === "amber" ? "text-amber-400" : "text-muted-foreground"}`}>
                                  {label}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  }

                  // --- Class row ---
                  return (
                    <tr key={idx} className="group hover:bg-muted/40 transition-colors">
                      {/* Time column — single line, no wrap */}
                      <td className="sticky left-0 z-10 whitespace-nowrap border-r border-border bg-card px-3 py-4 align-middle lg:px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted lg:flex">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div className="leading-none">
                            <p className="text-sm font-bold text-foreground whitespace-nowrap">{formatTime12h(slot.start)}</p>
                            <p className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap mt-1">{formatTime12h(slot.end)}</p>
                          </div>
                        </div>
                      </td>
                      {/* Day columns */}
                      {DAYS.map((day) => {
                        const entry = slot.entries[day];
                        if (!entry) {
                          // A class row's window may still carry a school-wide
                          // event (§4.4 union) — show it where no class sits.
                          const eventApplies =
                            slot.event && (slot.event.days.length === 0 || slot.event.days.includes(day));
                          return (
                            <td key={day} className="px-2 py-2 align-middle">
                              <div className={`min-h-[88px] rounded-2xl flex flex-col items-center justify-center gap-1 ${
                                eventApplies
                                  ? "border border-dashed border-amber-200/60 bg-amber-50/30"
                                  : day === todayKey ? "bg-primary/[0.03]" : "bg-muted/40"
                              }`}>
                                {eventApplies && (
                                  <>
                                    <Coffee className="w-4 h-4 text-amber-400" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                                      {slot.event!.eventName}
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>
                          );
                        }
                        const gc = getGradeColors(entry.section.gradeLevel);
                        return (
                          <td key={day} className="px-2 py-2 align-top">
                            <div className={`rounded-2xl border ${gc.cell} p-3 transition-all hover:shadow-md hover:-translate-y-0.5 cursor-default h-[88px] flex flex-col justify-between`}>
                              {/* Subject */}
                              <div>
                                <p className={`text-[13px] font-bold ${gc.text} leading-tight line-clamp-1`} title={entry.subject.name}>{shortenSubject(stripGradeSuffix(entry.subject.name))}</p>
                                {/* Grade + Section */}
                                <p className="text-[11px] font-bold text-muted-foreground mt-0.5 line-clamp-1" title={formatSectionLabel(entry.section.gradeLevel, entry.section.name)}>
                                  {formatSectionLabel(entry.section.gradeLevel, entry.section.name)}
                                </p>
                              </div>
                              {/* Room — label from the ATLAS crosswalk (§4.3) */}
                              <div className="flex items-center gap-1">
                                {roomDisplay(entry) ? (
                                  <>
                                    <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                    <span className="text-[11px] font-bold text-muted-foreground whitespace-nowrap" title={roomDisplay(entry)!.title}>
                                      {roomDisplay(entry)!.text}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">&nbsp;</span>
                                )}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Today's Classes — desktop */}
      {todayClasses.length > 0 && (
        <Card className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:block">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary text-primary-foreground">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Today&apos;s Classes</h2>
                  <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest mt-0.5">{DAY_LABELS[todayKey]}</p>
                </div>
              </div>
              <Badge variant="secondary" className="px-3 py-1.5 rounded-full text-xs font-bold border-0" style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>
                {todayClasses.length} class{todayClasses.length !== 1 ? "es" : ""}
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {todayClasses.map((entry, idx) => {
                const gc = getGradeColors(entry.section.gradeLevel);
                return (
                  <div key={entry.id} className={`rounded-2xl border ${gc.cell} p-5 transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col h-full`}>
                    {/* Period + Time row */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Period {idx + 1}</span>
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{formatTime12h(entry.startTime)} – {formatTime12h(entry.endTime)}</span>
                    </div>
                    {/* Subject */}
                    <p className={`text-lg font-bold ${gc.text} leading-tight line-clamp-2`} title={entry.subject.name}>{shortenSubject(stripGradeSuffix(entry.subject.name))}</p>
                    {/* Grade + Section */}
                    <p className="text-sm font-bold text-muted-foreground mt-1.5">
                      {formatSectionLabel(entry.section.gradeLevel, entry.section.name)}
                    </p>
                    {/* Room — label from the ATLAS crosswalk (§4.3) */}
                    <div className="mt-auto pt-3">
                      {roomDisplay(entry) ? (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs font-bold text-muted-foreground" title={roomDisplay(entry)!.title}>
                            {roomDisplay(entry)!.text}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">&nbsp;</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No classes today — desktop */}
      {todayClasses.length === 0 && todayKey && (
        <Card className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:block">
          <CardContent className="p-6 text-center">
            <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-bold text-foreground text-lg">No Classes Today</p>
            <p className="text-muted-foreground text-sm font-semibold mt-1">{DAY_LABELS[todayKey]} is free!</p>
          </CardContent>
        </Card>
      )}

      {/* Draft (unpublished) timetable preview — ATLAS §8A */}
      {draftPanel}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimum gap (minutes) to qualify as a fallback break row */
const BREAK_THRESHOLD_MIN = 15;

function classifyBreak(eventName: string): BreakSlot["breakType"] {
  const n = eventName.toLowerCase();
  if (n.includes("lunch")) return "lunch";
  if (n.includes("health") || n.includes("recess")) return "recess";
  return "other";
}

/**
 * Build the grid rows from the contract's own windows (§4.4):
 *  - class rows keyed by their exact start-end window;
 *  - break rows from `specialEvents[]` — the published school-wide union of
 *    non-teaching windows. Distinct windows are kept as distinct rows (two
 *    "Lunch Break" rows are real: different grade/shift groups); day scope is
 *    honored through `days`. Never invent or merge a window.
 * The old gap heuristic is used ONLY as a fallback when ATLAS published no
 * special events at all (e.g. first sync before the contract state lands).
 */
function getTimeSlots(
  entries: ScheduleEntry[],
  specialEvents: ScheduleSpecialEvent[],
  contractSlots: { startTime: string; endTime: string }[],
): TimeSlot[] {
  // 1. Class windows by exact start-end pair
  const slotMap = new Map<string, ClassSlot>();
  for (const entry of entries) {
    const key = `${entry.startTime}-${entry.endTime}`;
    if (!slotMap.has(key)) {
      slotMap.set(key, { type: "class", start: entry.startTime, end: entry.endTime, entries: {} });
    }
    slotMap.get(key)!.entries[entry.day.toUpperCase()] = entry;
  }

  const result: TimeSlot[] = [];

  if (specialEvents.length > 0) {
    // 2a. Break rows from the published specialEvents union (§4.4).
    const breakRows = new Map<string, BreakSlot>();
    for (const evt of specialEvents) {
      const key = `${evt.startTime}-${evt.endTime}`;
      const existing = breakRows.get(key);
      if (existing) {
        // Same window emitted for overlapping scopes — union the day scope.
        // The ROW stays single; the distinct-window rule is about windows.
        existing.days = [...new Set([...existing.days, ...evt.days])];
        continue;
      }
      breakRows.set(key, {
        type: "break",
        start: evt.startTime,
        end: evt.endTime,
        eventName: evt.eventName,
        breakType: classifyBreak(evt.eventName),
        durationMin: timeToMinutes(evt.endTime) - timeToMinutes(evt.startTime),
        days: [...evt.days],
      });
    }

    // Contract period windows anchor the row set (§4.4: use timeSlots to render
    // a correct grid); rows with no class and no event are skipped as noise.
    const windowKeys = new Set<string>([
      ...slotMap.keys(),
      ...breakRows.keys(),
      ...contractSlots.map(s => `${s.startTime}-${s.endTime}`),
    ]);
    for (const key of windowKeys) {
      const classSlot = slotMap.get(key);
      const breakSlot = breakRows.get(key);
      if (classSlot) {
        // Class wins the row; a matching event still colors empty day cells.
        if (breakSlot) classSlot.event = specialEvents.find(e => e.startTime === breakSlot.start && e.endTime === breakSlot.end);
        result.push(classSlot);
      } else if (breakSlot) {
        result.push(breakSlot);
      }
    }
    return result.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  }

  // 2b. Fallback: derive break rows from gaps between class slots (legacy).
  const classSlots = Array.from(slotMap.values()).sort((a, b) => a.start.localeCompare(b.start));
  if (classSlots.length === 0) return [];

  result.push(classSlots[0]);
  for (let i = 1; i < classSlots.length; i++) {
    const prevEnd = timeToMinutes(classSlots[i - 1].end);
    const nextStart = timeToMinutes(classSlots[i].start);
    const gap = nextStart - prevEnd;

    if (gap >= BREAK_THRESHOLD_MIN) {
      const breakType = gap >= 45 ? "lunch" : "recess";
      result.push({
        type: "break",
        start: classSlots[i - 1].end,
        end: classSlots[i].start,
        eventName: breakType === "lunch" ? "Lunch Break" : "Recess",
        breakType,
        durationMin: gap,
        days: [...DAYS],
      });
    }
    result.push(classSlots[i]);
  }

  return result;
}

/** Room label per contract §4.3 — never present a raw ATLAS surrogate id as a room. */
function roomDisplay(entry: ScheduleEntry): { text: string; title: string } | null {
  if (entry.roomLabel) {
    return { text: entry.roomLabel, title: entry.roomBuilding ? `${entry.roomLabel} — ${entry.roomBuilding}` : entry.roomLabel };
  }
  if (entry.roomId != null) {
    return { text: "Room", title: `ATLAS room id ${entry.roomId} — name not mapped yet` };
  }
  return null;
}




