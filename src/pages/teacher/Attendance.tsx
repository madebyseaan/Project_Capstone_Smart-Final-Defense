import { useEffect, useState } from "react";
import { Calendar as CalendarIcon, Users, X, FileText, Save, CheckCircle2, AlertCircle, ClipboardCheck, RefreshCw, Download, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTheme } from "@/contexts/ThemeContext";
import { SERVER_URL, getPortalToken } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import axios from "axios";

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

function getLocalMonth(): number {
  return new Date().getMonth() + 1;
}

function getLocalYear(): number {
  return new Date().getFullYear();
}

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

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
  const { colors } = useTheme();
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
  const [selectedMonth, setSelectedMonth] = useState<number>(getLocalMonth());
  const [selectedYear, setSelectedYear] = useState<number>(getLocalYear());
  const [showConfirmClear, setShowConfirmClear] = useState(false);

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
      const totalPresence = summaryList.reduce((acc: number, s: any) => acc + s.present + s.late, 0);
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

  const handleStatusChange = (studentId: string, status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED") => {
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
        { headers: { Authorization: `Bearer ${token}` } }
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
        { headers: { Authorization: `Bearer ${token}` } }
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

  const downloadExcel = async () => {
    if (!selectedSection) return;
    try {
      const token = getPortalToken();
      const response = await axios.get(
        `${SERVER_URL}/api/attendance/export/${selectedSection}?month=${selectedMonth}&year=${selectedYear}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `SF2_${MONTH_NAMES[selectedMonth - 1]}_${selectedYear}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: any) {
      setMessage({ type: "error", text: "Failed to download Excel" });
    }
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

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Daily Attendance"
        description="Manage and track student attendance records"
      />

      {/* Control Panel - Refined Glass Style */}
      <Card className="border-0 shadow-xl shadow-slate-200/50 rounded-[2.5rem] overflow-hidden bg-white/90 backdrop-blur-md">
        <CardContent className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            <div className="space-y-2">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Advisory Section</Label>
              <div className="h-12 bg-slate-50 border border-slate-100 rounded-xl flex items-center px-4">
                <span className="text-sm font-bold text-foreground">
                  {sections.length > 0
                    ? `${gradeLevelLabels[sections[0].gradeLevel]} - ${sections[0].name}`
                    : "Loading..."}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Attendance Date</Label>
              <div className="relative">
                <Input
                  id="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  max={getLocalDateStr()}
                  className="h-12 bg-slate-50 border-slate-100 rounded-xl text-xs font-bold shadow-sm focus:ring-2 focus:ring-indigo-100 transition-all pl-10"
                />
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={markAllPresent}
                variant="outline"
                className="flex-1 h-12 rounded-xl border-slate-200 text-muted-foreground hover:bg-slate-50 font-bold transition-all"
                disabled={!attendanceData || loading}
              >
                <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" />
                MARK ALL
              </Button>
              <Button
                onClick={clearAttendance}
                variant="outline"
                className="h-12 rounded-xl border-slate-200 text-muted-foreground hover:bg-slate-50 font-bold transition-all px-4"
                disabled={!attendanceData || loading}
              >
                CLEAR
              </Button>
              <Button
                onClick={saveAndNextDay}
                disabled={saving || !attendanceData}
                className="flex-1 h-12 rounded-xl text-white shadow-xl font-bold text-[10px] tracking-widest uppercase transition-all"
                style={{ backgroundColor: colors.primary }}
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    SAVING...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    SAVE & NEXT DAY
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Messaging */}
      {message && (
        <div
          className={`p-5 rounded-2xl border-0 shadow-lg animate-slide-up ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 shadow-emerald-100"
              : "bg-rose-50 text-rose-700 shadow-rose-100"
          }`}
        >
          <div className="flex items-center gap-3">
            {message.type === "success" ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            <span className="font-bold text-sm tracking-tight">{message.text}</span>
          </div>
        </div>
      )}

      {/* Quick Stats Grid - SF2 Monthly & Daily live counters */}
      {attendanceData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { 
              label: "Daily Presence", 
              value: `${stats.present} / ${attendanceData.attendance.length}`, 
              icon: CheckCircle2, 
              color: "emerald",
              desc: "Learners present today"
            },
            { 
              label: "Monthly Attendance Rate", 
              value: loadingMonthly ? "Syncing..." : (monthlyStats ? `${monthlyStats.enrollmentRate.toFixed(1)}%` : "0.0%"), 
              icon: RefreshCw, 
              color: "indigo",
              desc: "SF2 Month Average"
            },
            { 
              label: "Average Daily Attendance", 
              value: loadingMonthly ? "Syncing..." : (monthlyStats ? monthlyStats.avgAttendance.toFixed(1) : "0.0"), 
              icon: Users, 
              color: "amber",
              desc: "Learners present daily avg"
            },
            { 
              label: "School Days Tracked", 
              value: loadingMonthly ? "Syncing..." : (monthlyStats ? `${monthlyStats.schoolDays} Days` : "0 Days"), 
              icon: CalendarIcon, 
              color: "slate",
              desc: "Days with records this month"
            },
          ].map((stat) => (
            <Card key={stat.label} className="border-0 shadow-lg shadow-slate-200/50 rounded-[2rem] bg-white overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{stat.label}</p>
                    <p className={`text-2xl font-bold text-foreground`}>{stat.value}</p>
                    <p className="text-[9px] text-muted-foreground font-medium mt-1">{stat.desc}</p>
                  </div>
                  <div className={`p-3 rounded-2xl bg-${stat.color}-50 text-${stat.color}-500 shrink-0`}>
                    <stat.icon className={`w-6 h-6 ${loadingMonthly && stat.icon === RefreshCw ? "animate-spin" : ""}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* SF2 Download Section */}
      {attendanceData && (
        <Card className="border-0 shadow-lg shadow-slate-200/50 rounded-[2rem] bg-white overflow-hidden">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-600">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">SF2 Export</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Download Daily Attendance Record (Excel)</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                  <SelectTrigger className="w-[140px] h-10 rounded-xl text-xs font-bold">
                    <SelectValue>{MONTH_NAMES[selectedMonth - 1]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((name, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)} className="text-xs font-bold">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                  <SelectTrigger className="w-[100px] h-10 rounded-xl text-xs font-bold">
                    <SelectValue>{selectedYear}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {[selectedYear - 1, selectedYear, selectedYear + 1].map((y) => (
                      <SelectItem key={y} value={String(y)} className="text-xs font-bold">
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={downloadExcel}
                  className="h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] tracking-widest uppercase transition-all"
                >
                  <Download className="w-4 h-4 mr-2" />
                  DOWNLOAD SF2
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Table - Modern Corporate List */}
      <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white">
        <CardHeader className="p-8 border-b border-slate-50 bg-slate-50/30">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold text-foreground tracking-tight">
                {attendanceData?.section 
                  ? `${gradeLevelLabels[attendanceData.section.gradeLevel]} - ${attendanceData.section.name}`
                  : "Attendance Roster"
                }
              </CardTitle>
              <CardDescription className="text-muted-foreground font-sans normal-case font-medium tracking-normal mt-1">
                {attendanceData ? `${attendanceData.attendance.length} Learners Enrolled` : "Select filters to view list"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="text-center">
                <div className="w-20 h-20 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-sm" style={{ backgroundColor: `${colors.primary}15` }}>
                  <Loader2 className="w-10 h-10 animate-spin" style={{ color: colors.primary }} />
                </div>
                <p className="text-muted-foreground font-bold text-xs uppercase tracking-widest">Loading attendance...</p>
              </div>
            </div>
          ) : attendanceData ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50 hover:bg-transparent border-0">
                    <TableHead className="px-8 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">LRN</TableHead>
                    <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Learner Name</TableHead>
                    <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">Attendance Status</TableHead>
                    <TableHead className="px-8 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Notes / Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendanceData.attendance.map((student) => (
                    <TableRow key={student.studentId} className="hover:bg-slate-50/50 transition-all border-slate-50 group">
                      <TableCell className="px-8 font-mono text-xs text-muted-foreground font-bold group-hover:text-foreground transition-colors">
                        {student.lrn}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-muted-foreground font-bold text-xs shrink-0">
                            {student.lastName.charAt(0)}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-foreground tracking-tight truncate">
                              {student.lastName}, {student.firstName}
                            </span>
                              {monthlyStats?.consecutiveAbsenceFlags[student.studentId] && (
                              <span className="text-[8px] font-bold uppercase text-rose-600 bg-rose-50 border border-rose-100 rounded px-1.5 py-0.5 mt-0.5 w-fit tracking-wide animate-pulse">
                                5+ Consecutive Absences
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-center">
                          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 shadow-inner">
                            {[
                              { id: "PRESENT", symbol: "•", color: "emerald", label: "Present" },
                              { id: "ABSENT", symbol: "X", color: "rose", label: "Absent" },
                              { id: "LATE", symbol: "/", color: "amber", label: "Tardy" },
                              { id: "EXCUSED", symbol: "E", color: "indigo", label: "Excused" }
                            ].map((option) => (
                              <button
                                key={option.id}
                                onClick={() => handleStatusChange(student.studentId, option.id as any)}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold transition-all text-xs ${
                                  student.status === option.id 
                                    ? `bg-${option.color}-600 text-white shadow-md scale-105 z-10` 
                                    : `text-muted-foreground hover:text-muted-foreground hover:bg-slate-200/50`
                                }`}
                                title={option.label}
                              >
                                {option.symbol}
                              </button>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-8">
                        <Input
                          placeholder="Add remark..."
                          value={student.remarks || ""}
                          onChange={(e) => handleRemarksChange(student.studentId, e.target.value)}
                          className="h-10 bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-indigo-500 focus:ring-0 rounded-none text-xs font-medium transition-all"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-32 flex flex-col items-center justify-center text-center px-4">
              <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-sm">
                <Users className="w-10 h-10 text-muted-foreground" />
              </div>
              <h3 className="font-bold text-foreground text-2xl mb-3">No Records Selected</h3>
              <p className="text-muted-foreground font-medium text-lg leading-relaxed">Configure section and date to begin tracking attendance</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clear Confirmation Dialog */}
      <Dialog open={showConfirmClear} onOpenChange={setShowConfirmClear}>
        <DialogContent className="rounded-[2rem] border-0 shadow-2xl p-0 overflow-hidden max-w-md">
          <div className="bg-amber-600 p-8 text-white">
            <div className="w-16 h-16 bg-white/20 rounded-[1.5rem] flex items-center justify-center mb-6 backdrop-blur-md">
              <AlertCircle className="w-8 h-8 text-white" />
            </div>
            <DialogHeader className="p-0 text-left">
              <DialogTitle className="text-2xl font-bold text-white leading-tight">Reset Attendance?</DialogTitle>
              <DialogDescription className="text-amber-100 font-medium text-base mt-2">
                This will delete all saved attendance records for this date from the database. All students will reset to Present.
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="p-8 bg-white flex flex-col sm:flex-row gap-4">
            <Button
              onClick={() => setShowConfirmClear(false)}
              variant="outline"
              className="h-14 rounded-2xl border-slate-200 font-bold hover:bg-slate-50 transition-all flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmClear}
              className="h-14 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-xl shadow-amber-100 transition-all flex-1"
            >
              Reset All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
