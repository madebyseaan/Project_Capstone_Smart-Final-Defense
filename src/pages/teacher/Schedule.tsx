import { useState, useEffect } from "react";
import { CalendarDays, Clock, RefreshCw, BookOpen, MapPin, AlertTriangle, CalendarClock, Sun } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSyncStream } from "@/hooks/useSyncStream";
import { scheduleApi } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ScheduleEntry {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  roomId: number | null;
  subject: { code: string; name: string };
  section: { name: string; gradeLevel: string };
}

interface ScheduleData {
  schoolYear: string;
  entries: ScheduleEntry[];
  byDay: Record<string, ScheduleEntry[]>;
  count: number;
}

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
      badge: "bg-emerald-50 text-emerald-700 border-emerald-100",
      cell: "bg-emerald-50/40 border-emerald-200 hover:bg-emerald-50",
      dot: "bg-emerald-400",
      text: "text-emerald-800",
    };
    case "GRADE_8": return {
      badge: "bg-amber-50 text-amber-700 border-amber-100",
      cell: "bg-amber-50/40 border-amber-200 hover:bg-amber-50",
      dot: "bg-amber-400",
      text: "text-amber-800",
    };
    case "GRADE_9": return {
      badge: "bg-rose-50 text-rose-700 border-rose-100",
      cell: "bg-rose-50/40 border-rose-200 hover:bg-rose-50",
      dot: "bg-rose-400",
      text: "text-rose-800",
    };
    case "GRADE_10": return {
      badge: "bg-blue-50 text-blue-700 border-blue-100",
      cell: "bg-blue-50/40 border-blue-200 hover:bg-blue-50",
      dot: "bg-blue-400",
      text: "text-blue-800",
    };
    default: return {
      badge: "bg-indigo-50 text-indigo-700 border-indigo-100",
      cell: "bg-indigo-50/40 border-indigo-200 hover:bg-indigo-50",
      dot: "bg-indigo-400",
      text: "text-indigo-800",
    };
  }
}

function formatGradeShort(gradeLevel: string): string {
  const map: Record<string, string> = { GRADE_7: "G7", GRADE_8: "G8", GRADE_9: "G9", GRADE_10: "G10" };
  return map[gradeLevel] ?? gradeLevel;
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
  "Filipino": "Filipino",
  "Araling Panlipunan": "Aral. Pan.",
};

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

  const fetchSchedule = async () => {
    try {
      const res = await scheduleApi.getMySchedule();
      setSchedule(res.data);
      setError(null);
    } catch {
      setError("Failed to load schedule");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSchedule(); }, [syncVersion]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await scheduleApi.refreshSchedule(); } catch { /* fire-and-forget */ }
    setTimeout(() => setRefreshing(false), 2000);
  };

  const todayKey = getDayKey();
  const todayClasses = schedule?.byDay[todayKey] ?? [];
  const timeSlots = getTimeSlots(schedule?.entries ?? []);
  const gradeLevels = [...new Set((schedule?.entries ?? []).map(e => e.section.gradeLevel))].sort();

  // ---- Loading ----
  if (loading) {
    return (
      <div className="space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
              <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: colors.primary, borderTopColor: "transparent" }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <CalendarDays className="w-8 h-8 animate-pulse" style={{ color: colors.primary }} />
              </div>
            </div>
            <p className="text-slate-600 font-semibold text-lg animate-pulse">Loading your schedule...</p>
          </div>
        </div>
      </div>
    );
  }

  // ---- Error ----
  if (error) {
    return (
      <div className="space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">
        <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] bg-white">
          <CardContent className="py-32 text-center">
            <div className="w-24 h-24 bg-red-50 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 shadow-sm">
              <AlertTriangle className="w-10 h-10 text-red-400" />
            </div>
            <h3 className="font-black text-slate-900 text-2xl mb-3">Unable to Load Schedule</h3>
            <p className="text-slate-600 max-w-sm mx-auto font-medium text-lg leading-relaxed">{error}</p>
            <Button onClick={fetchSchedule} className="mt-6 h-12 px-8 rounded-2xl text-white font-bold shadow-lg" style={{ backgroundColor: colors.primary }}>
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
      <div className="space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">
        {/* Header */}
        <div className="flex items-center gap-4 mb-2">
          <div className="p-3 rounded-2xl text-white shadow-lg" style={{ backgroundColor: colors.primary }}>
            <CalendarDays className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">My Schedule</h1>
            <p className="text-slate-500 text-sm font-semibold mt-1">S.Y. {schedule.schoolYear}</p>
          </div>
        </div>

        {/* Empty state card */}
        <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] bg-white overflow-hidden">
          <CardContent className="p-10 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-[1.75rem] bg-slate-100 flex items-center justify-center mb-6">
              <CalendarClock className="w-9 h-9 text-slate-300" />
            </div>
            <h3 className="font-black text-slate-900 text-2xl mb-2">No Schedule Published</h3>
            <p className="text-slate-400 font-medium max-w-sm mx-auto leading-relaxed mb-8 text-center">
              Your weekly timetable will appear here once your administrator publishes it.
            </p>

            {/* Feature hints */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl mx-auto">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <CalendarDays className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-slate-700">Weekly Grid</p>
                  <p className="text-[11px] text-slate-400">Mon–Fri timetable</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-slate-700">Time Slots</p>
                  <p className="text-[11px] text-slate-400">Period-by-period</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Sun className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-slate-700">Today&apos;s Classes</p>
                  <p className="text-[11px] text-slate-400">Quick glance at today</p>
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
    <div className="space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-white shadow-lg" style={{ backgroundColor: colors.primary }}>
            <CalendarDays className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">My Schedule</h1>
            <p className="text-slate-500 text-sm font-semibold mt-1">
              S.Y. {schedule.schoolYear} &middot; {schedule.count} class{schedule.count !== 1 ? "es" : ""} per week
            </p>
          </div>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={refreshing}
          variant="outline"
          className="h-11 px-6 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-sm shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Syncing..." : "Refresh"}
        </Button>
      </div>

      {/* Grade Level Legend */}
      {gradeLevels.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Grade Levels:</span>
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
      )}

      {/* Weekly Timetable Grid */}
      <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px]">
              <thead>
                <tr className="border-b border-slate-200" style={{ backgroundColor: `${colors.primary}08` }}>
                  <th className="px-5 py-5 text-left text-xs font-black text-slate-500 uppercase tracking-widest w-[120px]">Time</th>
                  {DAYS.map((day) => {
                    const isToday = day === todayKey;
                    return (
                      <th key={day} className={`px-3 py-5 text-center ${isToday ? "bg-primary/5" : ""}`}>
                        <div className="flex flex-col items-center gap-1.5">
                          <span className={`text-xs font-black uppercase tracking-widest ${isToday ? "text-primary" : "text-slate-500"}`}>
                            {DAY_SHORT[day]}
                          </span>
                          {isToday && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider text-white" style={{ backgroundColor: colors.primary }}>
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
                {timeSlots.map((slot, idx) => (
                  <tr key={idx} className="group hover:bg-slate-50/50 transition-colors">
                    {/* Time column — single line, no wrap */}
                    <td className="px-5 py-4 align-middle border-r border-slate-100 whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Clock className="w-4 h-4 text-slate-500" />
                        </div>
                        <div className="leading-none">
                          <p className="text-sm font-black text-slate-800 whitespace-nowrap">{formatTime12h(slot.start)}</p>
                          <p className="text-[11px] font-semibold text-slate-400 whitespace-nowrap mt-1">{formatTime12h(slot.end)}</p>
                        </div>
                      </div>
                    </td>
                    {/* Day columns */}
                    {DAYS.map((day) => {
                      const entry = slot.entries[day];
                      if (!entry) {
                        return (
                          <td key={day} className="px-2 py-2 align-middle">
                            <div className={`h-[88px] rounded-2xl ${day === todayKey ? "bg-primary/[0.03]" : "bg-slate-50/50"}`} />
                          </td>
                        );
                      }
                      const gc = getGradeColors(entry.section.gradeLevel);
                      return (
                        <td key={day} className="px-2 py-2 align-top">
                          <div className={`rounded-2xl border ${gc.cell} p-3 transition-all hover:shadow-md hover:-translate-y-0.5 cursor-default h-[88px] flex flex-col justify-between`}>
                            {/* Subject */}
                            <div>
                              <p className={`text-[13px] font-black ${gc.text} leading-tight line-clamp-1`} title={entry.subject.name}>{shortenSubject(entry.subject.name)}</p>
                              {/* Section */}
                              <p className="text-[11px] font-bold text-slate-600 mt-0.5 line-clamp-1">{entry.section.name}</p>
                            </div>
                            {/* Room — always at bottom */}
                            <div className="flex items-center gap-1">
                              {entry.roomId != null ? (
                                <>
                                  <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                  <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">Rm {entry.roomId}</span>
                                </>
                              ) : (
                                <span className="text-[11px] text-slate-300">&nbsp;</span>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Today's Classes */}
      {todayClasses.length > 0 && (
        <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white">
          <CardContent className="p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-slate-900 text-white">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">Today&apos;s Classes</h2>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-0.5">{DAY_LABELS[todayKey]}</p>
                </div>
              </div>
              <Badge variant="secondary" className="px-3 py-1.5 rounded-full text-xs font-black border-0" style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>
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
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Period {idx + 1}</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{formatTime12h(entry.startTime)} – {formatTime12h(entry.endTime)}</span>
                    </div>
                    {/* Subject */}
                    <p className={`text-lg font-black ${gc.text} leading-tight line-clamp-2`} title={entry.subject.name}>{shortenSubject(entry.subject.name)}</p>
                    {/* Section + Grade */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="secondary" className={`border-0 text-[10px] font-black px-2 py-0.5 rounded-md ${gc.badge} flex-shrink-0`}>
                        {formatGradeShort(entry.section.gradeLevel)}
                      </Badge>
                      <span className="text-sm font-bold text-slate-600">{entry.section.name}</span>
                    </div>
                    {/* Room — pushed to bottom */}
                    <div className="mt-auto pt-3">
                      {entry.roomId != null ? (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="text-xs font-bold text-slate-500">Room {entry.roomId}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300">&nbsp;</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No classes today */}
      {todayClasses.length === 0 && todayKey && (
        <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white">
          <CardContent className="p-8 text-center">
            <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="font-black text-slate-900 text-lg">No Classes Today</p>
            <p className="text-slate-500 text-sm font-semibold mt-1">{DAY_LABELS[todayKey]} is free!</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTimeSlots(entries: ScheduleEntry[]): Array<{ start: string; end: string; entries: Record<string, ScheduleEntry> }> {
  const slotMap = new Map<string, { start: string; end: string; entries: Record<string, ScheduleEntry> }>();
  for (const entry of entries) {
    const key = `${entry.startTime}-${entry.endTime}`;
    if (!slotMap.has(key)) {
      slotMap.set(key, { start: entry.startTime, end: entry.endTime, entries: {} });
    }
    slotMap.get(key)!.entries[entry.day.toUpperCase()] = entry;
  }
  return Array.from(slotMap.values()).sort((a, b) => a.start.localeCompare(b.start));
}
