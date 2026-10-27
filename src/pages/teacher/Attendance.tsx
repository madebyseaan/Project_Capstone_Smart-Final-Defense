import { useEffect, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  Users,
  Save,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
  Search,
  StickyNote,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SERVER_URL, getPortalToken, getCsrfToken } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { StickyActionBar } from "@/components/mobile";
import { cn } from "@/lib/utils";
import axios from "axios";

type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

const STATUS_OPTIONS: {
  id: AttendanceStatus;
  label: string;
  short: string;
  activeClass: string;
}[] = [
  { id: "PRESENT", label: "Present", short: "P", activeClass: "border-emerald-600 bg-emerald-600 text-white" },
  { id: "ABSENT", label: "Absent", short: "A", activeClass: "border-rose-600 bg-rose-600 text-white" },
  { id: "LATE", label: "Late", short: "L", activeClass: "border-amber-500 bg-amber-500 text-white" },
  { id: "EXCUSED", label: "Excused", short: "E", activeClass: "border-indigo-600 bg-indigo-600 text-white" },
];

// ── Local date helpers (fixes UTC timezone bug) ─────────────────────────────
function getLocalDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getNextSchoolDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Student {
  studentId: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
  remarks?: string;
  attendanceId?: string | null;
}

interface Section {
  id: string;
  name: string;
  gradeLevel: string;
}

interface AttendanceData {
  section: Section;
  date: string;
  attendance: Student[];
}

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

export default function Attendance() {
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateStr());
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<{
    enrollmentRate: number;
    avgAttendance: number;
    schoolDays: number;
    consecutiveAbsenceFlags: Record<string, boolean>;
  } | null>(null);
  const [loadingMonthly, setLoadingMonthly] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRemarks, setExpandedRemarks] = useState<Record<string, boolean>>({});

  const fetchMonthlySF2Stats = async (sectionId: string, dateStr: string) => {
    setLoadingMonthly(true);
    try {
      const token = getPortalToken();
      const d = new Date(dateStr);
      const y = d.getFullYear();
      const m = d.getMonth();
      const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const end = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const summaryRes = await axios.get(
        `${SERVER_URL}/api/attendance/summary/${sectionId}`,
        {
          params: { startDate: start, endDate: end },
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const summaryList = summaryRes.data?.data?.summary || [];
      if (summaryList.length === 0) {
        setMonthlyStats(null);
        return;
      }

      const schoolDays = Math.max(...summaryList.map((s: any) => s.total), 0);
      const totalPresence = summaryList.reduce((acc: number, s: any) => acc + s.present + s.late + s.excused, 0);
      const registeredLearners = summaryList.length;
      
      const avgAttendance = schoolDays > 0 ? totalPresence / schoolDays : 0;
      const enrollmentRate = registeredLearners > 0 ? (avgAttendance / registeredLearners) * 100 : 0;

      const studentsToFetch = summaryList.filter((s: any) => s.absent >= 5);
      const flagsMap: Record<string, boolean> = {};

      if (studentsToFetch.length > 0) {
        const fetchPromises = studentsToFetch.map(async (student: any) => {
          try {
            const res = await axios.get(
              `${SERVER_URL}/api/attendance/student/${student.studentId}`,
              {
                params: { startDate: start, endDate: end, sectionId },
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            const records = res.data?.data?.records || [];
            const sortedRecords = [...records].sort(
              (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()
            );

            let maxConsecutive = 0;
            let currentConsecutive = 0;
            for (const rec of sortedRecords) {
              if (rec.status === "ABSENT") {
                currentConsecutive++;
                if (currentConsecutive > maxConsecutive) {
                  maxConsecutive = currentConsecutive;
                }
              } else {
                currentConsecutive = 0;
              }
            }
            if (maxConsecutive >= 5) {
              flagsMap[student.studentId] = true;
            }
          } catch (err) {
            console.error("Error checking consecutive absences:", err);
          }
        });
        await Promise.all(fetchPromises);
      }

      setMonthlyStats({
        schoolDays,
        avgAttendance,
        enrollmentRate,
        consecutiveAbsenceFlags: flagsMap,
      });
    } catch (error) {
      console.error("Error fetching monthly SF2 stats:", error);
      setMonthlyStats(null);
    } finally {
      setLoadingMonthly(false);
    }
  };

  // Fetch teacher's advisory section
  useEffect(() => {
    let cancelled = false;
    const fetchSections = async () => {
      try {
        const token = getPortalToken();
        
        // Get advisory section only
        const advisoryResponse = await axios.get(`${SERVER_URL}/api/advisory/my-advisory`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!cancelled && advisoryResponse.data?.hasAdvisory && advisoryResponse.data?.section) {
          const advisorySection = advisoryResponse.data.section;
          setSections([{
            id: advisorySection.id,
            name: advisorySection.name,
            gradeLevel: advisorySection.gradeLevel,
          }]);
          setSelectedSection(advisorySection.id);
        }
      } catch (error) {
        if (!cancelled) console.error("Error fetching advisory section:", error);
      }
    };

    fetchSections();
    return () => { cancelled = true; };
  }, []);

  // Fetch attendance when section or date changes
  useEffect(() => {
    if (selectedSection && selectedDate) {
      fetchAttendance();
      fetchMonthlySF2Stats(selectedSection, selectedDate);
    }
  }, [selectedSection, selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAttendance = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const token = getPortalToken();
      const response = await axios.get(
        `${SERVER_URL}/api/attendance/section/${selectedSection}?date=${selectedDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAttendanceData(response.data.data);
    } catch (error: any) {
      setMessage({ type: "error", text: error.response?.data?.message || "Failed to load attendance" });
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = (studentId: string, status: AttendanceStatus) => {
    if (!attendanceData) return;
    setAttendanceData({
      ...attendanceData,
      attendance: attendanceData.attendance.map((student) =>
        student.studentId === studentId ? { ...student, status } : student
      ),
    });
  };

  const handleRemarksChange = (studentId: string, remarks: string) => {
    if (!attendanceData) return;
    setAttendanceData({
      ...attendanceData,
      attendance: attendanceData.attendance.map((student) =>
        student.studentId === studentId ? { ...student, remarks } : student
      ),
    });
  };

  const markAllPresent = () => {
    if (!attendanceData) return;
    setAttendanceData({
      ...attendanceData,
      attendance: attendanceData.attendance.map((student) => ({
        ...student,
        status: "PRESENT",
        remarks: "",
      })),
    });
  };

  const clearAttendance = () => {
    setShowConfirmClear(true);
  };

  const confirmClear = async () => {
    if (!attendanceData) return;
    
    // Delete attendance records from database for this date
    try {
      const token = getPortalToken();
      await axios.post(
        `${SERVER_URL}/api/attendance/clear`,
        { sectionId: selectedSection, date: selectedDate },
        { headers: { Authorization: `Bearer ${token}`, "x-csrf-token": getCsrfToken() } }
      );
    } catch (error) {
      console.error("Error deleting attendance records:", error);
    }

    // Reset UI to all present
    setAttendanceData({
      ...attendanceData,
      attendance: attendanceData.attendance.map((student) => ({
        ...student,
        status: "PRESENT",
        remarks: "",
      })),
    });
    setShowConfirmClear(false);
    setMessage({ type: "success", text: "Attendance records deleted — all students reset" });
    fetchMonthlySF2Stats(selectedSection, selectedDate);
    setTimeout(() => setMessage(null), 2000);
  };

  const saveAttendance = async () => {
    if (!attendanceData) return;

    setSaving(true);
    setMessage(null);
    try {
      const token = getPortalToken();
      await axios.post(
        `${SERVER_URL}/api/attendance/bulk`,
        {
          sectionId: selectedSection,
          date: selectedDate,
          attendance: attendanceData.attendance.map((s) => ({
            studentId: s.studentId,
            status: s.status,
            remarks: s.remarks || null,
          })),
        },
        { headers: { Authorization: `Bearer ${token}`, "x-csrf-token": getCsrfToken() } }
      );
      setMessage({ type: "success", text: "Attendance saved successfully!" });
      fetchMonthlySF2Stats(selectedSection, selectedDate);
      setTimeout(() => setMessage(null), 3000);
    } catch (error: any) {
      setMessage({ type: "error", text: error.response?.data?.message || "Failed to save attendance" });
    } finally {
      setSaving(false);
    }
  };

  const saveAndNextDay = async () => {
    await saveAttendance();
    setSelectedDate(getNextSchoolDay(selectedDate));
  };

  const getStatusStats = () => {
    if (!attendanceData) return { present: 0, absent: 0, late: 0, excused: 0 };
    return {
      present: attendanceData.attendance.filter((s) => s.status === "PRESENT").length,
      absent: attendanceData.attendance.filter((s) => s.status === "ABSENT").length,
      late: attendanceData.attendance.filter((s) => s.status === "LATE").length,
      excused: attendanceData.attendance.filter((s) => s.status === "EXCUSED").length,
    };
  };

  const stats = getStatusStats();

  const attendanceStatItems = [
    {
      label: "Daily Presence",
      short: "Present",
      value: `${stats.present} / ${attendanceData?.attendance.length ?? 0}`,
      icon: CheckCircle2,
      iconClass: "bg-emerald-50 text-emerald-600",
      desc: "Present today",
    },
    {
      label: "Monthly Rate",
      short: "Monthly",
      value: loadingMonthly ? "Syncing…" : monthlyStats ? `${monthlyStats.enrollmentRate.toFixed(1)}%` : "0.0%",
      icon: RefreshCw,
      iconClass: "bg-primary/10 text-primary",
      desc: "SF2 month average",
    },
    {
      label: "Daily Average",
      short: "Avg/day",
      value: loadingMonthly ? "Syncing…" : monthlyStats ? monthlyStats.avgAttendance.toFixed(1) : "0.0",
      icon: Users,
      iconClass: "bg-amber-50 text-amber-600",
      desc: "Present daily avg",
    },
    {
      label: "School Days",
      short: "Days",
      value: loadingMonthly ? "Syncing…" : monthlyStats ? `${monthlyStats.schoolDays}` : "0",
      icon: CalendarIcon,
      iconClass: "bg-muted text-muted-foreground",
      desc: "Tracked this month",
    },
  ];

  const filteredStudents = useMemo(() => {
    const list = attendanceData?.attendance ?? [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return list;
    return list.filter((student) =>
      `${student.lastName}, ${student.firstName} ${student.middleName ?? ""}`
        .toLowerCase()
        .includes(query) || student.lrn.toLowerCase().includes(query),
    );
  }, [attendanceData, searchQuery]);

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl mx-auto pb-4 lg:space-y-6 lg:pb-12">
      <div className="hidden lg:block">
        <PageHeader
          title="Daily Attendance"
          description="Manage and track student attendance records"
        />
      </div>

      {/* Messaging */}
      {message && (
        <div
          role="status"
          className={cn(
            "flex items-center gap-3 rounded-xl border p-3 text-sm font-semibold",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Quick Stats — compact strip on phones, cards on desktop */}
      {attendanceData && (
        <>
          <div className="grid grid-cols-4 divide-x divide-border rounded-2xl border border-border bg-card py-3 shadow-sm lg:hidden">
            {attendanceStatItems.map((stat) => (
              <div key={stat.label} className="px-2 text-center">
                <p className="truncate text-base font-bold leading-none text-foreground">{stat.value}</p>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{stat.short}</p>
              </div>
            ))}
          </div>

          <div className="hidden grid-cols-2 gap-3 lg:grid lg:grid-cols-4 lg:gap-4">
            {attendanceStatItems.map((stat) => (
              <Card key={stat.label} className="rounded-2xl border border-border bg-card shadow-sm">
                <CardContent className="flex items-center justify-between gap-2 p-3 lg:p-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">{stat.label}</p>
                    <p className="mt-0.5 text-lg font-bold leading-tight text-foreground lg:text-xl">{stat.value}</p>
                    <p className="mt-0.5 hidden truncate text-[11px] text-muted-foreground sm:block">{stat.desc}</p>
                  </div>
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", stat.iconClass)}>
                    <stat.icon className={cn("h-4 w-4", loadingMonthly && stat.icon === RefreshCw && "animate-spin")} aria-hidden="true" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Main roster */}
      <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border bg-muted/30 p-4 lg:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <CardTitle className="truncate text-lg font-semibold text-foreground lg:text-xl">
                {attendanceData?.section
                  ? `${gradeLevelLabels[attendanceData.section.gradeLevel]} - ${attendanceData.section.name}`
                  : sections.length > 0
                    ? `${gradeLevelLabels[sections[0].gradeLevel]} - ${sections[0].name}`
                    : "Attendance Roster"}
              </CardTitle>
              <CardDescription className="mt-1 font-sans text-xs font-medium normal-case tracking-normal text-muted-foreground">
                {attendanceData ? `${attendanceData.attendance.length} ${attendanceData.attendance.length === 1 ? "learner" : "learners"} enrolled` : "Select filters to view list"}
              </CardDescription>
            </div>

            {/* Desktop actions */}
            <div className="hidden flex-row items-center gap-2 lg:flex">
              <div className="relative w-[200px]">
                <Input
                  type="date"
                  aria-label="Attendance date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  max={getLocalDateStr()}
                  className="h-11 rounded-xl border-border bg-background pl-10 text-xs font-semibold"
                />
                <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <Button
                onClick={markAllPresent}
                variant="outline"
                className="h-11 rounded-xl font-semibold"
                disabled={!attendanceData || loading}
              >
                <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                Mark all
              </Button>
              <Button
                onClick={clearAttendance}
                variant="outline"
                className="h-11 rounded-xl px-4 font-semibold"
                disabled={!attendanceData || loading}
              >
                Clear
              </Button>
              <Button
                onClick={saveAndNextDay}
                disabled={saving || !attendanceData}
                className="h-11 rounded-xl px-5 text-xs font-semibold uppercase tracking-wide"
              >
                {saving ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save & next day
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Mobile date + search + bulk actions */}
          <div className="space-y-3 lg:hidden">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  type="date"
                  aria-label="Attendance date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  max={getLocalDateStr()}
                  className="h-12 rounded-xl border-border bg-background pl-10 text-base font-semibold"
                />
                <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <Button
                onClick={markAllPresent}
                variant="outline"
                className="h-12 shrink-0 rounded-xl px-3 text-xs font-semibold"
                disabled={!attendanceData || loading}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4 text-emerald-500" />
                All
              </Button>
              <Button
                onClick={clearAttendance}
                variant="outline"
                className="h-12 shrink-0 rounded-xl px-3 text-xs font-semibold"
                disabled={!attendanceData || loading}
              >
                Clear
              </Button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                inputMode="search"
                placeholder="Search name or LRN"
                aria-label="Search learners"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 rounded-xl border-border bg-background pl-10 text-base"
              />
            </div>
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>{filteredStudents.length} shown</span>
              <span className="flex items-center gap-3">
                <span className="text-emerald-600">{stats.present} present</span>
                <span className="text-rose-600">{stats.absent} absent</span>
                <span className="text-amber-600">{stats.late} late</span>
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <Loader2 className="mx-auto mb-4 h-9 w-9 animate-spin text-primary" />
                <p className="text-sm font-medium text-muted-foreground">Loading attendance…</p>
              </div>
            </div>
          ) : attendanceData ? (
            <>
              {/* Mobile roster list */}
              <div className="divide-y divide-border lg:hidden">
                {filteredStudents.length === 0 ? (
                  <div className="px-4 py-16 text-center">
                    <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-semibold text-foreground">No learners match your search</p>
                    <p className="mt-1 text-xs text-muted-foreground">Try a different name or LRN.</p>
                  </div>
                ) : (
                  filteredStudents.map((student) => {
                    const flag = monthlyStats?.consecutiveAbsenceFlags[student.studentId];
                    const remarksOpen = !!expandedRemarks[student.studentId];
                    return (
                      <div key={student.studentId} className="space-y-3 p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                            {student.lastName.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-semibold text-foreground">
                              {student.lastName}, {student.firstName}
                            </p>
                            <p className="font-mono text-xs text-muted-foreground">{student.lrn}</p>
                            {flag && (
                              <span className="mt-1.5 inline-flex rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600">
                                5+ consecutive absences
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpandedRemarks((prev) => ({ ...prev, [student.studentId]: !prev[student.studentId] }))}
                            aria-label={remarksOpen ? "Hide remark" : "Add remark"}
                            aria-expanded={remarksOpen}
                            className={cn(
                              "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border transition-colors",
                              remarksOpen
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground",
                            )}
                          >
                            <StickyNote className="h-5 w-5" />
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
                                onClick={() => handleStatusChange(student.studentId, option.id)}
                                aria-pressed={selected}
                                aria-label={option.label}
                                className={cn(
                                  "flex min-h-12 items-center justify-center rounded-xl border px-1 text-[11px] font-semibold transition-colors active:scale-[0.98]",
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
                            onChange={(e) => handleRemarksChange(student.studentId, e.target.value)}
                            className="h-12 rounded-xl border-border bg-background text-base"
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow className="border-0 bg-muted/50 hover:bg-transparent">
                      <TableHead className="px-6 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">LRN</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Learner name</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Attendance status</TableHead>
                      <TableHead className="px-6 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Notes / remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendanceData.attendance.map((student) => (
                      <TableRow key={student.studentId} className="group border-border transition-colors hover:bg-muted/40">
                        <TableCell className="px-6 font-mono text-xs font-semibold text-muted-foreground">
                          {student.lrn}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                              {student.lastName.charAt(0)}
                            </div>
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate font-semibold tracking-tight text-foreground">
                                {student.lastName}, {student.firstName}
                              </span>
                              {monthlyStats?.consecutiveAbsenceFlags[student.studentId] && (
                                <span className="mt-0.5 w-fit rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600">
                                  5+ consecutive absences
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-center">
                            <div role="group" aria-label={`Attendance status for ${student.firstName} ${student.lastName}`} className="flex items-center gap-0.5 rounded-xl border border-border bg-muted p-1">
                              {STATUS_OPTIONS.map((option) => {
                                const selected = student.status === option.id;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => handleStatusChange(student.studentId, option.id)}
                                    aria-pressed={selected}
                                    aria-label={option.label}
                                    className={cn(
                                      "flex h-9 w-9 items-center justify-center rounded-lg text-xs font-semibold transition-colors",
                                      selected
                                        ? option.activeClass
                                        : "text-muted-foreground hover:bg-background",
                                    )}
                                    title={option.label}
                                  >
                                    {option.short}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-6">
                          <Input
                            placeholder="Add remark…"
                            aria-label={`Remark for ${student.firstName} ${student.lastName}`}
                            value={student.remarks || ""}
                            onChange={(e) => handleRemarksChange(student.studentId, e.target.value)}
                            className="h-10 rounded-none border-0 border-b border-transparent bg-transparent text-sm font-medium transition-all hover:border-border focus:border-primary focus:ring-0"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No records selected</h3>
              <p className="mt-2 text-sm text-muted-foreground">Configure section and date to begin tracking attendance.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mobile sticky save */}
      {attendanceData && (
        <StickyActionBar>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
              <span className="font-semibold text-foreground">{stats.present}</span> of {attendanceData.attendance.length} present
            </div>
            <Button
              onClick={saveAndNextDay}
              disabled={saving || !attendanceData}
              className="h-12 min-w-[160px] rounded-xl text-xs font-semibold uppercase tracking-wide"
            >
              {saving ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save & next day
                </>
              )}
            </Button>
          </div>
        </StickyActionBar>
      )}

      {/* Clear Confirmation Dialog */}
      <Dialog open={showConfirmClear} onOpenChange={setShowConfirmClear}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-0">
          <div className="p-5">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <AlertCircle className="h-6 w-6" />
            </div>
            <DialogHeader className="p-0 text-left">
              <DialogTitle className="text-xl font-semibold text-foreground">Reset attendance?</DialogTitle>
              <DialogDescription className="mt-2 text-sm text-muted-foreground">
                This deletes all saved attendance records for this date. Every learner resets to Present.
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="flex flex-col gap-2 border-t border-border bg-muted/30 p-4 sm:flex-row">
            <Button
              onClick={() => setShowConfirmClear(false)}
              variant="outline"
              className="h-12 flex-1 rounded-xl font-semibold"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmClear}
              className="h-12 flex-1 rounded-xl bg-amber-600 font-semibold text-white hover:bg-amber-700"
            >
              Reset all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


