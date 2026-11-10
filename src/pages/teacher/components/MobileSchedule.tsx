import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Coffee,
  MapPin,
  RefreshCw,
  Sun,
  UtensilsCrossed,
} from "lucide-react";
import type { ScheduleTermInfo } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  DAYS,
  DAY_LABELS,
  DAY_SHORT,
  classifyBreak,
  formatSectionLabel,
  formatTime12h,
  formatTimeRange,
  getGradeColors,
  roomDisplay,
  stripGradeSuffix,
  timeToMinutes,
  type ScheduleEntry,
  type TimeSlot,
} from "./ScheduleShared";

type MobileView = "day" | "week";

interface DayClassItem {
  type: "class";
  entry: ScheduleEntry;
}

interface DayBreakItem {
  type: "break";
  start: string;
  end: string;
  eventName: string;
  breakType: "recess" | "lunch" | "other";
  durationMin: number;
}

type DayItem = DayClassItem | DayBreakItem;

export interface MobileScheduleProps {
  totalClasses: number;
  terms: ScheduleTermInfo[];
  activeTerm: number | null;
  onTermChange: (term: number) => void;
  todayKey: string;
  byDay: Record<string, ScheduleEntry[]>;
  gridRows: TimeSlot[];
  refreshing: boolean;
  onRefresh: () => void;
  notices?: ReactNode;
}

const CARD =
  "rounded-[1.4rem] border border-border/70 bg-card shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]";

function BreakIcon({
  type,
  className,
}: {
  type: DayBreakItem["breakType"];
  className?: string;
}) {
  const Icon = type === "lunch" ? UtensilsCrossed : type === "recess" ? Coffee : Sun;
  return <Icon className={className} aria-hidden="true" />;
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function MobileSchedule({
  totalClasses,
  terms,
  activeTerm,
  onTermChange,
  todayKey,
  byDay,
  gridRows,
  refreshing,
  onRefresh,
  notices,
}: MobileScheduleProps) {
  const [view, setView] = useState<MobileView>("day");
  const [selectedDay, setSelectedDay] = useState<string>(todayKey || "MONDAY");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const weekdayLabel = now.toLocaleDateString("en-PH", { weekday: "long" });
  const monthLabel = now.toLocaleDateString("en-PH", { month: "short" }).toUpperCase();
  const dayNumber = now.getDate();

  const selectedClasses = useMemo(
    () =>
      [...(byDay[selectedDay] ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [byDay, selectedDay],
  );

  const dayItems = useMemo<DayItem[]>(() => {
    const items: DayItem[] = [];
    for (const slot of gridRows) {
      if (slot.type === "break") {
        if (slot.days.length > 0 && !slot.days.includes(selectedDay)) continue;
        items.push({
          type: "break",
          start: slot.start,
          end: slot.end,
          eventName: slot.eventName,
          breakType: slot.breakType,
          durationMin: slot.durationMin,
        });
        continue;
      }

      const entry = slot.entries[selectedDay];
      if (entry) {
        items.push({ type: "class", entry });
        continue;
      }

      if (
        slot.event &&
        (slot.event.days.length === 0 || slot.event.days.includes(selectedDay))
      ) {
        items.push({
          type: "break",
          start: slot.start,
          end: slot.end,
          eventName: slot.event.eventName,
          breakType: classifyBreak(slot.event.eventName),
          durationMin: timeToMinutes(slot.end) - timeToMinutes(slot.start),
        });
      }
    }
    return items;
  }, [gridRows, selectedDay]);

  const selectedRange =
    selectedClasses.length > 0
      ? formatTimeRange(
          selectedClasses[0].startTime,
          selectedClasses[selectedClasses.length - 1].endTime,
        )
      : "";
  const isToday = selectedDay === todayKey;

  return (
    <div className="motion-stagger space-y-5">
      <header className={cn("relative overflow-hidden p-4", CARD)}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-primary/[0.06] blur-2xl"
        />
        <div className="relative flex items-start gap-3">
          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_12px_24px_-14px_rgba(0,0,0,0.55)]">
            <span className="text-[0.8rem] font-semibold uppercase leading-none tracking-wide text-primary-foreground/85">
              {monthLabel}
            </span>
            <span className="mt-1 text-[1.25rem] font-semibold leading-none tabular-nums">
              {dayNumber}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[0.8rem] font-medium text-muted-foreground">{weekdayLabel}</p>
            <h1 className="mt-0.5 text-[1.5rem] font-semibold leading-tight tracking-tight text-foreground">
              This week
            </h1>
            <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
              {totalClasses} classes
            </p>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh schedule"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card text-muted-foreground shadow-sm transition-colors active:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
              aria-hidden="true"
            />
          </button>
        </div>
      </header>

      {notices}

      {terms.length > 1 && (
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {terms.map((term) => {
            const active = term.order === activeTerm;
            return (
              <button
                key={term.identity}
                type="button"
                onClick={() => onTermChange(term.order)}
                aria-pressed={active}
                className={cn(
                  "min-h-12 flex-1 rounded-lg px-2 text-[0.8rem] font-semibold transition-colors",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground active:bg-card/60",
                )}
              >
                {titleCase(term.displayLabel)}
              </button>
            );
          })}
        </div>
      )}

      <div className={cn("p-1.5", CARD)}>
        <div className="grid grid-cols-5 gap-1.5">
          {DAYS.map((day) => {
            const count = byDay[day]?.length ?? 0;
            const active = selectedDay === day;
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setSelectedDay(day);
                  setView("day");
                }}
                aria-pressed={active}
                aria-label={`${DAY_LABELS[day]}, ${count} ${count === 1 ? "class" : "classes"}`}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/40 text-muted-foreground active:bg-muted",
                )}
              >
                <span className="text-[0.8rem] font-semibold">{DAY_SHORT[day]}</span>
                <span
                  className={cn(
                    "text-[0.8rem] font-medium tabular-nums",
                    active ? "text-primary-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {count}
                </span>
                {day === todayKey && (
                  <span
                    className={cn(
                      "absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full",
                      active ? "bg-primary-foreground" : "bg-primary",
                    )}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {(["day", "week"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setView(option)}
            aria-pressed={view === option}
            className={cn(
              "min-h-12 flex-1 rounded-lg text-[0.8rem] font-semibold transition-colors",
              view === option ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {option === "day" ? "Day" : "Week"}
          </button>
        ))}
      </div>

      {view === "day" ? (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[1.25rem] font-semibold tracking-tight text-foreground">
                  {DAY_LABELS[selectedDay]}
                </h2>
                {isToday && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.8rem] font-semibold text-primary">
                    Today
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[0.8rem] font-medium text-muted-foreground">
                {selectedClasses.length} {selectedClasses.length === 1 ? "class" : "classes"}
                {selectedRange ? ` · ${selectedRange}` : ""}
              </p>
            </div>
          </div>

          {dayItems.length === 0 ? (
            <div className="rounded-[1.4rem] border border-border/70 bg-card px-4 py-10 text-center shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Sun className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-[0.9rem] font-semibold text-foreground">
                No classes on {DAY_LABELS[selectedDay]}
              </p>
              <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
                Enjoy the free day.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {dayItems.map((item) => {
                if (item.type === "break") {
                  return (
                    <div key={`break-${item.start}-${item.end}`} className="flex gap-3">
                      <div className="w-14 shrink-0 pt-1.5 text-left">
                        <p className="whitespace-nowrap text-[0.8rem] font-semibold tabular-nums text-muted-foreground">
                          {formatTime12h(item.start)}
                        </p>
                        <p className="mt-0.5 whitespace-nowrap text-[0.8rem] font-medium tabular-nums text-muted-foreground">
                          {formatTime12h(item.end)}
                        </p>
                      </div>
                      <div className="flex min-h-9 flex-1 items-center justify-center gap-2 rounded-full bg-muted/60 px-3 text-[0.8rem] font-medium text-muted-foreground">
                        <BreakIcon type={item.breakType} className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.eventName}</span>
                        <span className="shrink-0">{item.durationMin}m</span>
                      </div>
                    </div>
                  );
                }

                const entry = item.entry;
                const start = timeToMinutes(entry.startTime);
                const end = timeToMinutes(entry.endTime);
                const status =
                  selectedDay === todayKey
                    ? nowMinutes >= end
                      ? "done"
                      : nowMinutes >= start
                        ? "now"
                        : "upcoming"
                    : "upcoming";
                const gc = getGradeColors(entry.section.gradeLevel);
                const room = roomDisplay(entry);

                return (
                  <div key={entry.id} className="flex gap-3">
                    <div className="w-14 shrink-0 pt-1">
                      <p className="whitespace-nowrap text-[0.8rem] font-semibold tabular-nums text-foreground">
                        {formatTime12h(entry.startTime)}
                      </p>
                      <p className="mt-0.5 whitespace-nowrap text-[0.8rem] font-medium tabular-nums text-muted-foreground">
                        {formatTime12h(entry.endTime)}
                      </p>
                      {status === "done" && (
                        <CheckCircle2
                          className="mt-1.5 h-3.5 w-3.5 text-muted-foreground"
                          aria-label="Completed"
                        />
                      )}
                    </div>

                    <div
                      className={cn(
                        "min-w-0 flex-1 rounded-2xl border border-l-4 p-3.5",
                        gc.cell,
                        gc.accent,
                        status === "now" && "ring-2 ring-primary/20",
                      )}
                    >
                      <p
                        className="line-clamp-2 text-[1rem] font-semibold leading-snug text-foreground"
                        title={entry.subject.name}
                      >
                        {stripGradeSuffix(entry.subject.name)}
                      </p>
                      <p className="mt-0.5 truncate text-[0.8rem] font-medium text-muted-foreground">
                        {formatSectionLabel(entry.section.gradeLevel, entry.section.name)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] font-medium text-muted-foreground">
                        {room && (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{room.text}</span>
                          </span>
                        )}
                        {status === "now" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse"
                              aria-hidden="true"
                            />
                            Now
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <div className={cn("overflow-hidden", CARD)}>
          <div className="px-4 pb-3 pt-4">
            <h2 className="text-[0.95rem] font-semibold tracking-tight text-foreground">
              Week overview
            </h2>
            <p className="mt-0.5 text-[0.8rem] font-medium text-muted-foreground">
              {totalClasses} classes across {DAYS.length} days
            </p>
          </div>

          <div className="divide-y divide-border/60 border-t border-border/70">
            {DAYS.map((day) => {
              const classes = [...(byDay[day] ?? [])].sort((a, b) =>
                a.startTime.localeCompare(b.startTime),
              );
              const first = classes[0];
              const last = classes[classes.length - 1];
              const range =
                first && last ? formatTimeRange(first.startTime, last.endTime) : "";
              const today = day === todayKey;
              const selected = day === selectedDay;

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    setSelectedDay(day);
                    setView("day");
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/60",
                    selected && "bg-primary/[0.03]",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-[0.8rem] font-semibold",
                      today ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {DAY_SHORT[day]}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[0.875rem] font-semibold text-foreground">
                        {DAY_LABELS[day]}
                      </p>
                      {today && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[0.8rem] font-semibold text-primary">
                          Today
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[0.8rem] font-medium text-muted-foreground">
                      {classes.length} {classes.length === 1 ? "class" : "classes"}
                      {range ? ` · ${range}` : ""}
                    </p>
                    {classes.length > 0 && (
                      <div className="mt-1 flex items-center gap-1" aria-hidden="true">
                        {classes.slice(0, 8).map((entry) => (
                          <span
                            key={entry.id}
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              getGradeColors(entry.section.gradeLevel).dot,
                            )}
                          />
                        ))}
                        {classes.length > 8 && (
                          <span className="ml-0.5 text-[0.8rem] font-medium text-muted-foreground">
                            +{classes.length - 8}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
