import {
  CalendarDays,
  CheckCircle2,
  Eraser,
  RefreshCw,
  Save,
  Search,
  StickyNote,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StickyActionBar } from "@/components/mobile";
import { cn } from "@/lib/utils";
import { SURFACE } from "./MobileDashboardTokens";
import { ProgressRing, SectionHeading } from "./MobileDashboardWidgets";

type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

interface AttendanceStudent {
  studentId: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  status: AttendanceStatus;
  remarks?: string;
}

interface AttendanceMonthlyStats {
  enrollmentRate: number;
  avgAttendance: number;
  schoolDays: number;
  consecutiveAbsenceFlags: Record<string, boolean>;
}

interface MobileAttendanceViewProps {
  sectionLabel: string;
  learnerCount: number;
  students: AttendanceStudent[];
  hasData: boolean;
  loading: boolean;
  loadingMonthly: boolean;
  selectedDate: string;
  maxDate: string;
  onDateChange: (date: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusStats: { present: number; absent: number; late: number; excused: number };
  monthlyStats: AttendanceMonthlyStats | null;
  expandedRemarks: Record<string, boolean>;
  onToggleRemark: (studentId: string) => void;
  onStatusChange: (studentId: string, status: AttendanceStatus) => void;
  onRemarksChange: (studentId: string, value: string) => void;
  onMarkAllPresent: () => void;
  onClear: () => void;
  saving: boolean;
  onSaveAndNext: () => void;
}

const STATUS_OPTIONS: {
  id: AttendanceStatus;
  label: string;
  activeClass: string;
}[] = [
  {
    id: "PRESENT",
    label: "Present",
    activeClass: "border-emerald-600 bg-emerald-600 text-white",
  },
  { id: "ABSENT", label: "Absent", activeClass: "border-rose-600 bg-rose-600 text-white" },
  { id: "LATE", label: "Late", activeClass: "border-amber-500 bg-amber-500 text-white" },
  {
    id: "EXCUSED",
    label: "Excused",
    activeClass: "border-indigo-600 bg-indigo-600 text-white",
  },
];

const STATUS_COUNTS = [
  { key: "present", label: "Present", dot: "bg-emerald-500", text: "text-emerald-600" },
  { key: "absent", label: "Absent", dot: "bg-rose-500", text: "text-rose-600" },
  { key: "late", label: "Late", dot: "bg-amber-500", text: "text-amber-600" },
  { key: "excused", label: "Excused", dot: "bg-indigo-500", text: "text-indigo-600" },
] as const;

export default function MobileAttendanceView({
  sectionLabel,
  learnerCount,
  students,
  hasData,
  loading,
  loadingMonthly,
  selectedDate,
  maxDate,
  onDateChange,
  searchQuery,
  onSearchChange,
  statusStats,
  monthlyStats,
  expandedRemarks,
  onToggleRemark,
  onStatusChange,
  onRemarksChange,
  onMarkAllPresent,
  onClear,
  saving,
  onSaveAndNext,
}: MobileAttendanceViewProps) {
  const date = new Date(`${selectedDate}T00:00:00`);
  const monthLabel = date.toLocaleDateString("en-PH", { month: "short" }).toUpperCase();
  const dayNumber = date.getDate();
  const weekdayLabel = date.toLocaleDateString("en-PH", { weekday: "long" });
  const presentPercent = learnerCount > 0 ? (statusStats.present / learnerCount) * 100 : 0;

  return (
    <div className="space-y-4 lg:hidden">
      <div className={cn("flex items-center gap-3 p-4", SURFACE)}>
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
          <h1 className="mt-0.5 text-[1.4rem] font-semibold leading-tight tracking-tight text-foreground">
            Daily record
          </h1>
          <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
            {sectionLabel} · {learnerCount} {learnerCount === 1 ? "learner" : "learners"}
          </p>
        </div>
      </div>

      {loading ? (
        <div className={cn("flex items-center justify-center gap-2 p-8 text-[0.85rem] font-medium text-muted-foreground", SURFACE)}>
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading attendance…
        </div>
      ) : hasData ? (
        <>
          <div className={cn("p-4", SURFACE)}>
            <div className="flex items-center gap-4">
              <ProgressRing
                value={presentPercent}
                size={88}
                stroke={8}
                className="text-emerald-500"
                trackClassName="stroke-muted"
              >
                <span className="text-[1.2rem] font-semibold leading-none tabular-nums text-foreground">
                  {statusStats.present}/{learnerCount}
                </span>
                <span className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
                  present
                </span>
              </ProgressRing>

              <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                {STATUS_COUNTS.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-lg bg-muted/40 px-2 py-1.5 text-center"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", item.dot)} aria-hidden="true" />
                      <span className="truncate text-[0.8rem] font-medium text-muted-foreground">
                        {item.label}
                      </span>
                    </div>
                    <p className={cn("mt-0.5 text-[0.95rem] font-semibold tabular-nums", item.text)}>
                      {statusStats[item.key]}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 divide-x divide-border/70 border-t border-border/70 pt-3 text-center">
              <div>
                <p className="text-[0.8rem] font-medium text-muted-foreground">Monthly</p>
                <p className="mt-0.5 text-[0.9rem] font-semibold tabular-nums text-foreground">
                  {loadingMonthly ? "…" : monthlyStats ? `${monthlyStats.enrollmentRate.toFixed(1)}%` : "0.0%"}
                </p>
              </div>
              <div>
                <p className="text-[0.8rem] font-medium text-muted-foreground">Avg/day</p>
                <p className="mt-0.5 text-[0.9rem] font-semibold tabular-nums text-foreground">
                  {loadingMonthly ? "…" : monthlyStats ? monthlyStats.avgAttendance.toFixed(1) : "0.0"}
                </p>
              </div>
              <div>
                <p className="text-[0.8rem] font-medium text-muted-foreground">Days</p>
                <p className="mt-0.5 text-[0.9rem] font-semibold tabular-nums text-foreground">
                  {loadingMonthly ? "…" : monthlyStats ? monthlyStats.schoolDays : 0}
                </p>
              </div>
            </div>
          </div>

          <div className={cn("space-y-2 p-3", SURFACE)}>
            <div className="relative">
              <CalendarDays
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="date"
                aria-label="Attendance date"
                value={selectedDate}
                onChange={(event) => onDateChange(event.target.value)}
                max={maxDate}
                className="h-12 rounded-xl border-border bg-background pl-10 text-base font-semibold"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onMarkAllPresent}
                className="h-12 gap-2 rounded-xl text-[0.8rem] font-semibold"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                All present
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClear}
                className="h-12 gap-2 rounded-xl text-[0.8rem] font-semibold"
              >
                <Eraser className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Clear
              </Button>
            </div>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                inputMode="search"
                placeholder="Search name or LRN"
                aria-label="Search learners"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                className="h-12 rounded-xl border-border bg-background pl-10 text-base"
              />
            </div>
          </div>

          <div className="space-y-2">
            <SectionHeading
              icon={Users}
              title="Learners"
              meta={`${students.length} ${students.length === 1 ? "learner" : "learners"}`}
            />

            <div className={cn("overflow-hidden", SURFACE)}>
              {students.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Search className="mx-auto h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
                  <p className="mt-3 text-[0.9rem] font-semibold text-foreground">
                    No learners match your search
                  </p>
                  <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
                    Try a different name or LRN.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/70">
                  {students.map((student) => {
                    const flag = monthlyStats?.consecutiveAbsenceFlags[student.studentId];
                    const remarksOpen = !!expandedRemarks[student.studentId];
                    return (
                      <div key={student.studentId} className="space-y-3 px-4 py-3.5">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.8rem] font-semibold uppercase text-primary">
                            {student.lastName.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-[0.875rem] font-semibold text-foreground">
                              {student.lastName}, {student.firstName}
                            </p>
                            <p className="mt-0.5 font-mono text-[0.8rem] text-muted-foreground">
                              {student.lrn}
                            </p>
                            {flag && (
                              <span className="mt-1.5 inline-flex rounded-full bg-rose-500/10 px-2 py-0.5 text-[0.8rem] font-semibold text-rose-600">
                                5+ consecutive absences
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onToggleRemark(student.studentId)}
                            aria-label={remarksOpen ? "Hide remark" : "Add remark"}
                            aria-expanded={remarksOpen}
                            className={cn(
                              "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border transition-colors",
                              remarksOpen
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground",
                            )}
                          >
                            <StickyNote className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>

                        <div
                          role="group"
                          aria-label={`Attendance status for ${student.firstName} ${student.lastName}`}
                          className="grid grid-cols-4 gap-1.5"
                        >
                          {STATUS_OPTIONS.map((option) => {
                            const selected = student.status === option.id;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => onStatusChange(student.studentId, option.id)}
                                aria-pressed={selected}
                                aria-label={option.label}
                                className={cn(
                                  "flex min-h-12 items-center justify-center rounded-xl border px-1 text-[0.8rem] font-semibold transition-colors active:scale-[0.98]",
                                  selected
                                    ? option.activeClass
                                    : "border-border bg-background text-muted-foreground",
                                )}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>

                        {remarksOpen && (
                          <Input
                            autoFocus
                            placeholder="Add a remark for this learner…"
                            aria-label={`Remark for ${student.firstName} ${student.lastName}`}
                            value={student.remarks || ""}
                            onChange={(event) => onRemarksChange(student.studentId, event.target.value)}
                            className="h-12 rounded-xl border-border bg-background text-base"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <StickyActionBar>
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-[0.8rem] font-medium text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                <span>
                  <strong className="font-semibold text-foreground">{statusStats.present}</strong>{" "}
                  of {learnerCount} present
                </span>
              </div>
              <Button
                type="button"
                onClick={onSaveAndNext}
                disabled={saving}
                className="h-12 min-w-[150px] rounded-xl text-sm font-semibold"
              >
                {saving ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                    Save & next day
                  </>
                )}
              </Button>
            </div>
          </StickyActionBar>
        </>
      ) : (
        <div className={cn("px-4 py-10 text-center", SURFACE)}>
          <Users className="mx-auto h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-3 text-[0.9rem] font-semibold text-foreground">No attendance records</p>
          <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
            Select a section and date to start taking attendance.
          </p>
        </div>
      )}
    </div>
  );
}
