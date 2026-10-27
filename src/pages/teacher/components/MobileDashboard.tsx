import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Medal,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  distribution: {
    outstanding: number;
    verySatisfactory: number;
    satisfactory: number;
    fairlySatisfactory: number;
    didNotMeet: number;
  };
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
  classStats: MobileClassStat[];
  mastery: MobileMastery | null;
  honors: MobileHonor[];
  atRisk: MobileAtRisk[];
}

const MASTERY_SEGMENTS = [
  { key: "outstanding", label: "Outstanding", range: "90-100", color: "bg-emerald-500" },
  { key: "verySatisfactory", label: "Very satisfactory", range: "85-89", color: "bg-blue-500" },
  { key: "satisfactory", label: "Satisfactory", range: "80-84", color: "bg-amber-500" },
  { key: "fairlySatisfactory", label: "Fairly satisfactory", range: "75-79", color: "bg-orange-500" },
  { key: "didNotMeet", label: "Did not meet", range: "<75", color: "bg-rose-500" },
] as const;

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
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

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
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
  classStats,
  mastery,
  honors,
  atRisk,
}: MobileDashboardProps) {
  const current = classInfo.status === "active" ? classInfo.current : classInfo.next;
  const hasClass = !!current;
  const statusLabel = !hasClass
    ? "Today"
    : classInfo.status === "active"
      ? "In session now"
      : "Next class";

  const teachingStats = classStats.filter((c) => !c.rotationOffTerm);
  const topClasses = teachingStats.slice(0, 3);
  const topHonors = honors.slice(0, 3);
  const masteryTotal = mastery?.totalStudents ?? 0;
  const masteryKnown = MASTERY_SEGMENTS.reduce((sum, s) => sum + (mastery?.distribution[s.key] ?? 0), 0);

  return (
    <div className="space-y-4 lg:hidden">
      {/* Greeting */}
      <div className="px-1">
        <p className="text-xs font-medium text-muted-foreground">{todayLabel}</p>
        <h1 className="mt-0.5 text-xl font-semibold leading-tight text-foreground">
          Good day, Teacher {displayName(teacherName)}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          S.Y. {schoolYear || "—"} · {termLabel}
        </p>
      </div>

      {/* Now / next class + primary actions */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{statusLabel}</p>
            {hasClass ? (
              <>
                <p className="mt-1 text-lg font-semibold leading-snug text-foreground">{current.subject.name}</p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {current.section.name} · {current.section.gradeLevel.replace("GRADE_", "Grade ")}
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-lg font-semibold leading-snug text-foreground">No more classes today</p>
                <p className="mt-0.5 text-sm text-muted-foreground">You&apos;re all caught up.</p>
              </>
            )}
          </div>
          {hasClass ? (
            <div className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {formatTime12h(current.startTime)} – {formatTime12h(current.endTime)}
            </div>
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            to="/teacher/attendance"
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            Attendance
          </Link>
          <Link
            to="/teacher/classes"
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-semibold text-foreground transition-colors active:bg-muted"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Class records
          </Link>
        </div>
      </section>

      {/* Snapshot */}
      <section className="grid grid-cols-4 divide-x divide-border rounded-2xl border border-border bg-card py-3 shadow-sm">
        {[
          { label: "Learners", value: totalStudents, tone: "text-foreground" },
          { label: "Classes", value: totalClasses, tone: "text-foreground" },
          { label: "At risk", value: atRisk.length, tone: atRisk.length > 0 ? "text-rose-600" : "text-emerald-600" },
          { label: "Graded", value: `${Math.round(submissionRate)}%`, tone: "text-foreground" },
        ].map((item) => (
          <div key={item.label} className="px-2 text-center">
            <p className={cn("text-lg font-bold leading-none", item.tone)}>{item.value}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </section>

      {/* Grading progress */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Grading progress</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {Math.round(passingRate)}% passing · {teachingStats.length} classes
            </p>
          </div>
          <Link to="/teacher/classes" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary">
            All classes
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="px-4 pb-3 pt-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Overall submitted</span>
            <span className="font-semibold text-foreground">{Math.round(submissionRate)}%</span>
          </div>
          <ProgressBar value={submissionRate} />
        </div>

        {topClasses.length > 0 ? (
          <div className="divide-y divide-border border-t border-border">
            {topClasses.map((classStat) => {
              const pct = classStat.totalStudents > 0 ? Math.round((classStat.gradedCount / classStat.totalStudents) * 100) : 0;
              return (
                <Link
                  key={classStat.id}
                  to="/teacher/classes"
                  className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors active:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{classStat.sectionName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{classStat.subjectName}</p>
                  </div>
                  <ProgressBar value={pct} className="w-16 shrink-0" />
                  <span className="w-9 shrink-0 text-right text-xs font-semibold text-foreground">{pct}%</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground">No classes assigned yet.</p>
        )}
      </section>

      {/* At-risk or all-clear */}
      {atRisk.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3.5 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">All learners are on track.</p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <AlertTriangle className="h-4 w-4 text-rose-500" aria-hidden="true" />
              Needs attention
            </h2>
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
              {atRisk.length}
            </span>
          </div>
          <div className="mt-2 divide-y divide-border border-t border-border">
            {atRisk.slice(0, 3).map((student) => (
              <div key={student.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{student.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{student.class}</p>
                </div>
                <span className="text-sm font-bold text-rose-600">{typeof student.grade === "number" ? student.grade.toFixed(2) : student.grade}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mastery */}
      {mastery && masteryTotal > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-foreground">Performance</h2>
            <span className="text-xs text-muted-foreground">{masteryTotal} {masteryTotal === 1 ? "learner" : "learners"}</span>
          </div>

          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
            {masteryKnown > 0 &&
              MASTERY_SEGMENTS.map((segment) => {
                const count = mastery.distribution[segment.key] ?? 0;
                if (count === 0) return null;
                return (
                  <div
                    key={segment.key}
                    className={cn("h-full", segment.color)}
                    style={{ width: `${(count / masteryKnown) * 100}%` }}
                    aria-label={`${segment.label}: ${count}`}
                  />
                );
              })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {MASTERY_SEGMENTS.map((segment) => (
              <div key={segment.key} className="flex items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", segment.color)} />
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{segment.label}</span>
                <span className="text-xs font-semibold text-foreground">{mastery.distribution[segment.key] ?? 0}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Honors */}
      {topHonors.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Medal className="h-4 w-4 text-amber-500" aria-hidden="true" />
              Academic honors
            </h2>
            <Link to="/teacher/advisory" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary">
              Advisory
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-2 divide-y divide-border border-t border-border">
            {topHonors.map((student, index) => (
              <div key={student.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-xs font-bold text-amber-600">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{student.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{student.honor}</p>
                </div>
                <span className="text-sm font-bold text-foreground">{typeof student.grade === "number" ? student.grade.toFixed(2) : student.grade}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}


