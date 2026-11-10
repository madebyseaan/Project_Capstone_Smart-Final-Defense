import { useState, useEffect } from "react";
import { CalendarDays, Clock, RefreshCw, BookOpen, MapPin, AlertTriangle, CalendarClock, Sun, Coffee, UtensilsCrossed, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSyncStream } from "@/hooks/useSyncStream";
import {
  scheduleApi,
  type ScheduleDataDto,
  type ScheduleTermInfo,
} from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import ScheduleDraftPanel from "./components/ScheduleDraftPanel";
import MobileSchedule from "./components/MobileSchedule";
import {
  DAYS,
  DAY_LABELS,
  DAY_SHORT,
  formatGradeShort,
  formatSectionLabel,
  formatTime12h,
  getDayKey,
  getGradeColors,
  getTimeSlots,
  roomDisplay,
  shortenSubject,
  stripGradeSuffix,
} from "./components/ScheduleShared";

type ScheduleData = ScheduleDataDto;

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

  const draftPanel = (
    <ScheduleDraftPanel termIndex={activeTerm} terms={terms} syncVersion={syncVersion} />
  );

  // ---- Loading ----
  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in pb-12">
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
      <div className="space-y-6 animate-fade-in pb-12">
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
      <div className="space-y-6 animate-fade-in pb-12">
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
    <div className="animate-fade-in pb-12">
      <div className="lg:hidden">
        <MobileSchedule
          totalClasses={schedule.count}
          terms={terms}
          activeTerm={activeTerm}
          onTermChange={setSelectedTerm}
          todayKey={todayKey}
          byDay={schedule.byDay}
          gridRows={gridRows}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          notices={notices}
        />
      </div>

      <div className="hidden space-y-6 lg:block">
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

      {/* Weekly Timetable Grid */}
      <div>
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

      </div>

      <div className="mt-6">
        {/* Draft (unpublished) timetable preview — ATLAS §8A */}
        {draftPanel}
      </div>
    </div>
  );
}

