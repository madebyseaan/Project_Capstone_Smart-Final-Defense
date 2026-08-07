import { useEffect, useState } from "react";
import { Calendar as CalendarIcon, Users, Check, X, Clock, FileText, Save, CheckCircle2, AlertCircle, ClipboardCheck, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { useTheme } from "@/contexts/ThemeContext";
import { SERVER_URL } from "@/lib/api";
import axios from "axios";

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
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
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

  const fetchMonthlySF2Stats = async (sectionId: string, dateStr: string) => {
    setLoadingMonthly(true);
    try {
      const token = sessionStorage.getItem("token");
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

  // Fetch teacher's sections
  useEffect(() => {
    const fetchSections = async () => {
      try {
        const token = sessionStorage.getItem("token");
        
        // Get class assignments
        const classResponse = await axios.get(`${SERVER_URL}/api/grades/my-classes`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Get advisory section
        const advisoryResponse = await axios.get(`${SERVER_URL}/api/advisory/my-advisory`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const sectionsMap = new Map<string, Section>();

        // Add sections from class assignments (API returns array directly)
        if (Array.isArray(classResponse.data)) {
          classResponse.data.forEach((assignment: any) => {
            if (assignment.section && !sectionsMap.has(assignment.section.id)) {
              sectionsMap.set(assignment.section.id, {
                id: assignment.section.id,
                name: assignment.section.name,
                gradeLevel: assignment.section.gradeLevel,
              });
            }
          });
        }

        // Add advisory section if exists (API returns object with section property)
        if (advisoryResponse.data?.hasAdvisory && advisoryResponse.data?.section) {
          const advisorySection = advisoryResponse.data.section;
          if (!sectionsMap.has(advisorySection.id)) {
            sectionsMap.set(advisorySection.id, {
              id: advisorySection.id,
              name: advisorySection.name,
              gradeLevel: advisorySection.gradeLevel,
            });
          }
        }

        const sectionsList = Array.from(sectionsMap.values());
        setSections(sectionsList);

        // Auto-select advisory section if available
        if (advisoryResponse.data?.hasAdvisory && advisoryResponse.data?.section) {
          setSelectedSection(advisoryResponse.data.section.id);
        } else if (sectionsList.length > 0) {
          setSelectedSection(sectionsList[0].id);
        }
      } catch (error) {
        console.error("Error fetching sections:", error);
      }
    };

    fetchSections();
  }, []);

  // Fetch attendance when section or date changes
  useEffect(() => {
    if (selectedSection && selectedDate) {
      fetchAttendance();
      fetchMonthlySF2Stats(selectedSection, selectedDate);
    }
  }, [selectedSection, selectedDate]);

  const fetchAttendance = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const token = sessionStorage.getItem("token");
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

  const saveAttendance = async () => {
    if (!attendanceData) return;

    setSaving(true);
    setMessage(null);
    try {
      const token = sessionStorage.getItem("token");
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
    <div className="space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-lg">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Daily Attendance</h1>
          </div>
          <p className="text-slate-500 font-medium">Manage and track student attendance records</p>
        </div>
      </div>

      {/* Control Panel - Refined Glass Style */}
      <Card className="border-0 shadow-xl shadow-slate-200/50 rounded-[2rem] overflow-hidden bg-white/90 backdrop-blur-md">
        <CardContent className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
            <div className="space-y-2">
              <Label htmlFor="section" className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Target Section</Label>
              <Select value={selectedSection} onValueChange={setSelectedSection}>
                <SelectTrigger id="section" className="w-full">
                  <SelectValue placeholder="Select section">
                    {(() => {
                      const sec = sections.find((s) => s.id === selectedSection);
                      return sec ? `${gradeLevelLabels[sec.gradeLevel]} - ${sec.name}` : "Select section";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="shadow-xl">
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id} className="text-xs font-bold">
                      {gradeLevelLabels[section.gradeLevel]} - {section.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date" className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Attendance Date</Label>
              <div className="relative">
                <Input
                  id="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  className="h-12 bg-slate-50 border-slate-100 rounded-xl text-xs font-bold shadow-sm focus:ring-2 focus:ring-indigo-100 transition-all pl-10"
                />
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col sm:flex-row gap-3">
              <Button
                onClick={markAllPresent}
                variant="outline"
                className="flex-1 h-12 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 font-bold transition-all"
                disabled={!attendanceData || loading}
              >
                <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" />
                MARK ALL PRESENT
              </Button>
              <Button
                onClick={saveAttendance}
                disabled={saving || !attendanceData}
                className="flex-1 h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-xl shadow-slate-200 font-black text-[10px] tracking-widest uppercase transition-all"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    SYNCING...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    COMMIT CHANGES
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
            <Card key={stat.label} className="border-0 shadow-lg shadow-slate-200/50 rounded-3xl bg-white overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
                    <p className={`text-2xl font-black text-slate-800`}>{stat.value}</p>
                    <p className="text-[9px] text-slate-400 font-medium mt-1">{stat.desc}</p>
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

      {/* Main Table - Modern Corporate List */}
      <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white">
        <CardHeader className="p-8 border-b border-slate-50 bg-slate-50/30">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-black text-slate-900">
                {attendanceData?.section 
                  ? `${gradeLevelLabels[attendanceData.section.gradeLevel]} - ${attendanceData.section.name}`
                  : "Attendance Roster"
                }
              </CardTitle>
              <CardDescription className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">
                {attendanceData ? `${attendanceData.attendance.length} Learners Enrolled` : "Select filters to view list"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-24 text-center">
              <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4" />
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Pulling Records...</p>
            </div>
          ) : attendanceData ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50 hover:bg-transparent border-0">
                    <TableHead className="px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">LRN</TableHead>
                    <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Learner Name</TableHead>
                    <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Attendance Status</TableHead>
                    <TableHead className="px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Notes / Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendanceData.attendance.map((student) => (
                    <TableRow key={student.studentId} className="hover:bg-slate-50/50 transition-all border-slate-50 group">
                      <TableCell className="px-8 font-mono text-xs text-slate-400 font-bold group-hover:text-slate-900 transition-colors">
                        {student.lrn}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-black text-xs shrink-0">
                            {student.lastName.charAt(0)}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-slate-900 tracking-tight truncate">
                              {student.lastName}, {student.firstName}
                            </span>
                            {monthlyStats?.consecutiveAbsenceFlags[student.studentId] && (
                              <span className="text-[8px] font-black uppercase text-rose-600 bg-rose-50 border border-rose-100 rounded px-1.5 py-0.5 mt-0.5 w-fit tracking-wide animate-pulse">
                                ⚠️ 5+ Consecutive Absences
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
                                className={`w-8 h-8 rounded-lg flex items-center justify-center font-black transition-all text-xs ${
                                  student.status === option.id 
                                    ? `bg-${option.color}-600 text-white shadow-md scale-105 z-10` 
                                    : `text-slate-400 hover:text-slate-700 hover:bg-slate-200/50`
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
            <div className="py-32 text-center bg-slate-50/50">
              <div className="w-20 h-20 bg-white rounded-[2rem] shadow-sm flex items-center justify-center mx-auto mb-6">
                <Users className="w-8 h-8 text-slate-200" />
              </div>
              <h3 className="text-slate-900 font-black text-sm uppercase tracking-widest mb-2">No Records Selected</h3>
              <p className="text-slate-400 text-xs font-medium">Configure section and date to begin tracking attendance</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
