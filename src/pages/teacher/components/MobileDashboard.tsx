import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  GraduationCap,
  Medal,
  PieChart,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SERVER_URL } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import {
  MASTERY_SEGMENTS,
  MEDAL_TONES,
  SURFACE,
  clampPercent,
  type MasteryDistribution,
} from "./MobileDashboardTokens";
import {
  MasteryDonut,
  ProgressRing,
  SectionHeading,
  SectionLink,
  StatTile,
} from "./MobileDashboardWidgets";

interface MobileClassEntry {
  startTime: string;
  endTime: string;
  subject: { name: string };
  section: { name: string; gradeLevel: string };
}

interface MobileClassInfo {
  status: "empty" | "before" | "next" | "active" | "done";
  current?: MobileClassEntry;
  next?: MobileClassEntry;
}

interface MobileClassStat {
  id: string;
  subjectName: string;
  sectionName: string;
  totalStudents: number;
  gradedCount: number;
  rotationOffTerm?: boolean;
}

interface MobileHonor {
  id: string;
  name: string;
  grade: number;
  honor: string;
  class: string;
}

interface MobileAtRisk {
  id: string;
  name: string;
  grade: number;
  class: string;
}

interface MobileMastery {
  distribution: MasteryDistribution;
  totalStudents: number;
}

export interface MobileDashboardProps {
  teacherName: string;
  schoolYear?: string;
  termLabel: string;
  todayLabel: string;
  totalStudents: number;
  totalClasses: number;
  passingRate: number;
  submissionRate: number;
  classInfo: MobileClassInfo;
  todayClasses: MobileClassEntry[];
  classStats: MobileClassStat[];
  mastery: MobileMastery | null;
  honors: MobileHonor[];
  atRisk: MobileAtRisk[];
}

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatTimeRange(start: string, end: string): string {
  const startLabel = formatTime12h(start);
  const endLabel = formatTime12h(end);
  const startPeriod = startLabel.slice(-2);
  const endPeriod = endLabel.slice(-2);
  if (startPeriod === endPeriod) {
    return `${startLabel.slice(0, -3)}–${endLabel}`;
  }
  return `${startLabel} – ${endLabel}`;
}

function toMinutes(time24: string): number {
  const [h, m] = time24.split(":").map(Number);
  return h * 60 + m;
}

function formatCountdown(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function displayName(name: string): string {
  const cleaned = name.includes(",") ? name.split(",").slice(1).join(" ").trim() || name : name;
  const words = cleaned
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(?:Ii|Iii|Iv)\b/g, (m) => m.toUpperCase())
    .split(/\s+/)
    .filter(Boolean);
  return words[0] ?? cleaned;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function MobileDashboard({
  teacherName,
  schoolYear,
  termLabel,
  todayLabel,
  totalStudents,
  totalClasses,
  passingRate,
  submissionRate,
  classInfo,
  todayClasses,
  classStats,
  mastery,
  honors,
  atRisk,
}: MobileDashboardProps) {
  const { logoUrl, schoolName } = useTheme();

  const current = classInfo.status === "active" ? classInfo.current : classInfo.next;
  const hasClass = !!current;
  const isActive = classInfo.status === "active" && !!current;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = current ? toMinutes(current.startTime) : 0;
  const endMinutes = current ? toMinutes(current.endTime) : 0;
  const remainingMinutes = current ? Math.max(0, endMinutes - nowMinutes) : 0;
  const untilStartMinutes = current ? Math.max(0, startMinutes - nowMinutes) : 0;
  const elapsedPercent =
    current && endMinutes > startMinutes
      ? clampPercent(((nowMinutes - startMinutes) / (endMinutes - startMinutes)) * 100)
      : 0;

  const sortedToday = [...todayClasses].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const totalToday = sortedToday.length;

  const indexOfEntry = (entry?: MobileClassEntry) =>
    entry
      ? sortedToday.findIndex(
          (item) => item.startTime === entry.startTime && item.endTime === entry.endTime,
        )
      : -1;

  const activeIndex =
    classInfo.status === "active"
      ? indexOfEntry(classInfo.current)
      : classInfo.status === "next" || classInfo.status === "before"
        ? indexOfEntry(classInfo.next)
        : -1;

  const completedToday = classInfo.status === "done" ? totalToday : Math.max(0, activeIndex);

  const statusLabel = !hasClass
    ? "Day complete"
    : classInfo.status === "active"
      ? "In session"
      : classInfo.status === "before"
        ? "First up"
        : "Up next";

  const teachingStats = classStats.filter((item) => !item.rotationOffTerm);
  const completeClasses = teachingStats.filter(
    (item) => item.totalStudents > 0 && item.gradedCount >= item.totalStudents,
  ).length;
  const topClasses = teachingStats.slice(0, 3);
  const topHonors = honors.slice(0, 3);
  const atRiskCount = atRisk.length;
  const masteryTotal = mastery?.totalStudents ?? 0;

  const passingTone =
    passingRate >= 75
      ? "text-emerald-600"
      : passingRate >= 50
        ? "text-amber-600"
        : "text-destructive";

  const termTone =
    atRiskCount > 0
      ? "bg-destructive/10 text-destructive"
      : submissionRate >= 100
        ? "bg-emerald-500/10 text-emerald-600"
        : "bg-amber-500/10 text-amber-600";

  const logoSrc = logoUrl
    ? logoUrl.startsWith("http") || logoUrl.startsWith("data:")
      ? logoUrl
      : `${SERVER_URL}${logoUrl}`
    : null;

  return (
    <div className="relative lg:hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-gradient-to-b from-primary/[0.06] via-primary/[0.02] to-transparent"
      />

      <div className="relative space-y-5">
        <header className="pt-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-sm">
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt={schoolName ? `${schoolName} logo` : "School logo"}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <GraduationCap className="h-5 w-5 text-primary" aria-hidden="true" />
                )}
              </div>
              <p className="inline-flex min-w-0 items-center gap-1.5 text-[0.8rem] font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{todayLabel}</span>
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[0.8rem] font-semibold text-primary">
              {termLabel}
            </span>
          </div>
          <h1 className="mt-3 text-[1.5rem] font-semibold leading-[1.18] tracking-tight text-foreground">
            {getGreeting()}, Teacher{" "}
            <span className="text-primary">{displayName(teacherName)}</span>
          </h1>
          <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
            {schoolYear ? `S.Y. ${schoolYear}` : "Teacher Portal"}
          </p>
        </header>

        <section className="relative overflow-hidden rounded-[1.5rem] bg-primary text-primary-foreground shadow-[0_22px_46px_-26px_rgba(0,0,0,0.6)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(255,255,255,0.17),transparent_58%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full border border-primary-foreground/10"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full border border-primary-foreground/10"
          />

          <div className="relative p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/10 px-2.5 py-1 text-[0.8rem] font-semibold text-primary-foreground/90 ring-1 ring-inset ring-primary-foreground/15">
                {isActive ? (
                  <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75 motion-reduce:animate-none" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  </span>
                ) : (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      hasClass ? "bg-primary-foreground/50" : "bg-emerald-300",
                    )}
                    aria-hidden="true"
                  />
                )}
                {statusLabel}
              </span>

              <Link
                to="/teacher/schedule"
                className="-my-3 inline-flex min-h-12 items-center gap-1 py-3 text-[0.8rem] font-medium text-primary-foreground/70 transition-colors active:text-primary-foreground"
              >
                Schedule
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                {hasClass && current ? (
                  <>
                    <h2 className="text-[1.45rem] font-semibold leading-[1.15] tracking-tight text-primary-foreground">
                      {current.subject.name}
                    </h2>
                    <p className="mt-1 text-[0.85rem] font-medium text-primary-foreground/75">
                      {current.section.name} ·{" "}
                      {current.section.gradeLevel.replace("GRADE_", "Grade ")}
                    </p>
                    <p className="mt-3 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary-foreground/10 px-2 py-1 text-[0.8rem] font-medium tabular-nums text-primary-foreground/80 ring-1 ring-inset ring-primary-foreground/10">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatTimeRange(current.startTime, current.endTime)}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-[1.35rem] font-semibold leading-tight tracking-tight text-primary-foreground">
                      No more classes today
                    </h2>
                    <p className="mt-1 text-[0.85rem] font-medium text-primary-foreground/70">
                      You&apos;re all caught up.
                    </p>
                  </>
                )}
              </div>

              <div className="shrink-0">
                {isActive ? (
                  <ProgressRing
                    value={elapsedPercent}
                    size={84}
                    stroke={7}
                    className="text-primary-foreground"
                    trackClassName="stroke-primary-foreground/20"
                  >
                    <span className="text-[1.05rem] font-semibold leading-none tabular-nums text-primary-foreground">
                      {formatCountdown(remainingMinutes)}
                    </span>
                    <span className="mt-1 text-[0.8rem] font-medium text-primary-foreground/65">
                      left
                    </span>
                  </ProgressRing>
                ) : hasClass ? (
                  <div className="flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full bg-primary-foreground/10 ring-1 ring-inset ring-primary-foreground/15">
                    <Clock className="h-4 w-4 text-primary-foreground/70" aria-hidden="true" />
                    <span className="mt-1 text-[0.95rem] font-semibold leading-none tabular-nums text-primary-foreground">
                      {formatCountdown(untilStartMinutes)}
                    </span>
                    <span className="mt-1 text-[0.8rem] font-medium text-primary-foreground/60">
                      to start
                    </span>
                  </div>
                ) : (
                  <div className="flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full bg-primary-foreground/10 ring-1 ring-inset ring-primary-foreground/15">
                    <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden="true" />
                    <span className="mt-1 text-[0.9rem] font-semibold text-primary-foreground">
                      Done
                    </span>
                    <span className="mt-0.5 text-[0.8rem] font-medium text-primary-foreground/60">
                      today
                    </span>
                  </div>
                )}
              </div>
            </div>

            {totalToday > 0 && (
              <div className="mt-5">
                <div className="flex items-center gap-1" aria-hidden="true">
                  {sortedToday.map((entry, index) => {
                    const done = index < completedToday;
                    const inSession = classInfo.status === "active" && index === activeIndex;
                    return (
                      <span
                        key={`${entry.startTime}-${index}`}
                        className={cn(
                          "h-1.5 flex-1 rounded-full",
                          done
                            ? "bg-primary-foreground/50"
                            : inSession
                              ? "bg-primary-foreground"
                              : "bg-primary-foreground/20",
                        )}
                      />
                    );
                  })}
                </div>
                <p className="mt-2 text-[0.8rem] font-medium text-primary-foreground/60">
                  {classInfo.status === "done"
                    ? `All ${totalToday} classes done today`
                    : `${completedToday} of ${totalToday} classes done today`}
                </p>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Link
                to="/teacher/attendance"
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary-foreground px-3 text-[0.85rem] font-semibold text-primary shadow-sm transition-transform active:scale-[0.98]"
              >
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                Attendance
              </Link>
              <Link
                to="/teacher/classes"
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary-foreground/10 px-3 text-[0.85rem] font-semibold text-primary-foreground ring-1 ring-inset ring-primary-foreground/20 transition-colors active:bg-primary-foreground/15"
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Classes
              </Link>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div
            className={cn(
              "col-span-2 relative overflow-hidden bg-gradient-to-br from-card via-card to-primary/[0.04] p-4",
              SURFACE,
            )}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-10 -top-16 h-44 w-44 rounded-full bg-primary/[0.06] blur-2xl"
            />
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BarChart3 className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-[0.95rem] font-semibold tracking-tight text-foreground">
                    Term progress
                  </h2>
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[0.8rem] font-semibold",
                  termTone,
                )}
              >
                {atRiskCount > 0
                  ? "Needs attention"
                  : submissionRate >= 100
                    ? "On track"
                    : "In progress"}
              </span>
            </div>

            <div className="relative mt-4 flex items-center gap-4">
              <ProgressRing
                value={submissionRate}
                size={88}
                stroke={8}
                className="text-primary"
                trackClassName="stroke-muted"
              >
                <span className="text-[1.3rem] font-semibold leading-none tabular-nums text-foreground">
                  {Math.round(submissionRate)}%
                </span>
                <span className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
                  submitted
                </span>
              </ProgressRing>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.8rem] font-medium text-muted-foreground">
                    Passing rate
                  </span>
                  <span className={cn("text-[0.9rem] font-semibold tabular-nums", passingTone)}>
                    {Math.round(passingRate)}%
                  </span>
                </div>
                <div className="h-px bg-border/70" />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.8rem] font-medium text-muted-foreground">At risk</span>
                  <span
                    className={cn(
                      "text-[0.9rem] font-semibold tabular-nums",
                      atRiskCount > 0 ? "text-destructive" : "text-emerald-600",
                    )}
                  >
                    {atRiskCount}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <StatTile icon={Users} value={totalStudents} label="Learners" accent="primary" />
          <StatTile icon={BookOpen} value={totalClasses} label="Classes" accent="amber" />
        </section>

        <section className="space-y-2">
          <SectionHeading
            icon={ClipboardList}
            title="Grading progress"
            meta={
              teachingStats.length > 0
                ? `${completeClasses} of ${teachingStats.length} complete`
                : undefined
            }
            action={<SectionLink to="/teacher/classes" label="View all" />}
          />

          <div className="overflow-hidden rounded-[1.4rem] border border-border/70 bg-card shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]">
            {topClasses.length > 0 ? (
              <div className="divide-y divide-border/70">
                {topClasses.map((classStat) => {
                  const percent =
                    classStat.totalStudents > 0
                      ? Math.round((classStat.gradedCount / classStat.totalStudents) * 100)
                      : 0;
                  const complete =
                    classStat.totalStudents > 0 && classStat.gradedCount >= classStat.totalStudents;

                  return (
                    <Link
                      key={classStat.id}
                      to="/teacher/classes"
                      className="block px-4 py-3.5 transition-colors active:bg-muted/60"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-[0.85rem] font-semibold uppercase text-primary">
                          {classStat.subjectName.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-[0.875rem] font-semibold text-foreground">
                              {classStat.sectionName}
                            </p>
                            <span
                              className={cn(
                                "shrink-0 text-[0.85rem] font-semibold tabular-nums",
                                complete ? "text-emerald-600" : "text-foreground",
                              )}
                            >
                              {percent}%
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[0.8rem] font-medium text-muted-foreground">
                            {classStat.subjectName}
                          </p>
                          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                complete ? "bg-emerald-500" : "bg-primary",
                              )}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-muted-foreground/60"
                          aria-hidden="true"
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="px-4 py-6 text-center text-[0.85rem] font-medium text-muted-foreground">
                No classes assigned yet.
              </p>
            )}
          </div>
        </section>

        {atRiskCount > 0 && (
          <section className="space-y-2">
            <SectionHeading
              icon={AlertTriangle}
              iconClass="bg-destructive/10 text-destructive"
              title="Needs attention"
              meta={`${atRiskCount} below passing`}
              action={<SectionLink to="/teacher/classes" label="View all" />}
            />

            <div className="overflow-hidden rounded-[1.4rem] border border-border/70 bg-card shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]">
              <div className="divide-y divide-border/70">
                {atRisk.slice(0, 3).map((student) => (
                  <div key={student.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-[0.85rem] font-semibold uppercase text-destructive">
                      {student.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-semibold text-foreground">
                        {student.name}
                      </p>
                      <p className="mt-0.5 truncate text-[0.8rem] font-medium text-muted-foreground">
                        {student.class}
                      </p>
                    </div>
                    <span className="shrink-0 text-[0.85rem] font-semibold tabular-nums text-destructive">
                      {typeof student.grade === "number" ? student.grade.toFixed(2) : student.grade}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {mastery && masteryTotal > 0 && (
          <section className="space-y-2">
            <SectionHeading
              icon={PieChart}
              title="Performance"
              meta="Learner ratings"
            />

            <div className="rounded-[1.4rem] border border-border/70 bg-card p-4 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]">
              <div className="flex items-center gap-4">
                <MasteryDonut distribution={mastery.distribution} total={masteryTotal} />

                <div className="min-w-0 flex-1 space-y-2">
                  {MASTERY_SEGMENTS.map((segment) => (
                    <div key={segment.key} className="flex items-center gap-2">
                      <span
                        className={cn("h-2 w-2 shrink-0 rounded-full", segment.color)}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-[0.8rem] font-medium text-muted-foreground">
                        {segment.label}
                      </span>
                      <span className="text-[0.8rem] font-semibold tabular-nums text-foreground">
                        {mastery.distribution[segment.key] ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {topHonors.length > 0 && (
          <section className="space-y-2">
            <SectionHeading
              icon={Medal}
              iconClass="bg-amber-500/10 text-amber-600"
              title={
                <>
                  <span className="min-[360px]:hidden">Honors</span>
                  <span className="hidden min-[360px]:inline">Academic honors</span>
                </>
              }
              action={<SectionLink to="/teacher/advisory" label="Advisory" />}
            />

            <div className="overflow-hidden rounded-[1.4rem] border border-border/70 bg-card shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]">
              <div className="divide-y divide-border/70">
                {topHonors.map((student, index) => (
                  <div key={student.id} className="flex items-center gap-3 px-4 py-3">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
                        MEDAL_TONES[index] ?? "bg-primary/10 text-primary ring-primary/15",
                      )}
                    >
                      <Medal className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-semibold text-foreground">
                        {student.name}
                      </p>
                      <p className="mt-0.5 truncate text-[0.8rem] font-medium text-muted-foreground">
                        {student.honor}
                      </p>
                    </div>
                    <span className="shrink-0 text-[0.9rem] font-semibold tabular-nums text-primary">
                      {typeof student.grade === "number"
                        ? student.grade.toFixed(2)
                        : student.grade}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
