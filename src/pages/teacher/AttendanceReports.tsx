import { useState, useEffect } from "react";
import { Download, Calendar, Filter, FileSpreadsheet, Eye, Loader2 } from "lucide-react";
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
import { useTheme } from "@/contexts/ThemeContext";
import { SERVER_URL, getPortalToken } from "@/lib/api";
import axios from "axios";

// ── Local date helper (fixes UTC timezone bug) ─────────────────────────────
function getLocalDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

interface Section {
  id: string;
  name: string;
  gradeLevel: string;
}

interface AttendanceSummary {
  studentId: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
}

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

export default function AttendanceReports() {
  const { colors } = useTheme();
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>(getLocalDateStr());
  const [summary, setSummary] = useState<AttendanceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [studentGenders, setStudentGenders] = useState<Record<string, string>>({});
  const [dailyRecords, setDailyRecords] = useState<Record<string, any[]>>({});
  const [loadingDaily, setLoadingDaily] = useState(false);

  const getDatesInRange = (startStr: string, endStr: string) => {
    const dates: string[] = [];
    const curr = new Date(startStr + "T00:00:00");
    const end = new Date(endStr + "T00:00:00");
    while (curr <= end) {
      const day = curr.getDay();
      if (day >= 1 && day <= 5) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, "0");
        const d = String(curr.getDate()).padStart(2, "0");
        dates.push(`${y}-${m}-${d}`);
      }
      curr.setDate(curr.getDate() + 1);
    }
    return dates;
  };

  const fetchGenders = async (sectionId: string) => {
    try {
      const token = getPortalToken();
      const gendersMap: Record<string, string> = {};

      const advisoryRes = await axios.get(`${SERVER_URL}/api/advisory/my-advisory`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (advisoryRes.data?.hasAdvisory && advisoryRes.data?.section?.id === sectionId) {
        const students = advisoryRes.data.students || [];
        students.forEach((s: any) => {
          if (s.gender) {
            gendersMap[s.id] = s.gender.toUpperCase();
          }
        });
        setStudentGenders(gendersMap);
        return;
      }
      setStudentGenders(gendersMap);
    } catch (err) {
      console.error("Error fetching genders:", err);
    }
  };

  // Auto-load advisory section on mount
  useEffect(() => {
    let cancelled = false;
    const fetchAdvisory = async () => {
      try {
        const token = getPortalToken();
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

          // Auto-set date range to current month
          const now = new Date();
          const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
          const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          const startStr = `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, "0")}-${String(firstDay.getDate()).padStart(2, "0")}`;
          const endStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
          setStartDate(startStr);
          setEndDate(endStr);
        }
      } catch (error) {
        if (!cancelled) console.error("Error fetching advisory section:", error);
      }
    };

    fetchAdvisory();
    return () => { cancelled = true; };
  }, []);

  // Auto-fetch report when section and dates are ready
  useEffect(() => {
    if (selectedSection && startDate && endDate) {
      fetchReport();
    }
  }, [selectedSection, startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchReport = async () => {
    if (!selectedSection || !startDate || !endDate) return;

    setLoading(true);
    setLoadingDaily(true);
    try {
      const token = getPortalToken();
      await fetchGenders(selectedSection);

      const response = await axios.get(
        `${SERVER_URL}/api/attendance/summary/${selectedSection}`,
        {
          params: { startDate, endDate },
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const summaryList = response.data.data.summary || [];
      setSummary(summaryList);

      const studentRecordsMap: Record<string, any[]> = {};
      const fetchPromises = summaryList.map(async (student: any) => {
        try {
          const detailRes = await axios.get(
            `${SERVER_URL}/api/attendance/student/${student.studentId}`,
            {
              params: { startDate, endDate, sectionId: selectedSection },
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          studentRecordsMap[student.studentId] = detailRes.data?.data?.records || [];
        } catch (err) {
          console.error("Error fetching student daily records:", student.studentId, err);
          studentRecordsMap[student.studentId] = [];
        }
      });
      await Promise.all(fetchPromises);
      setDailyRecords(studentRecordsMap);
    } catch (error) {
      console.error("Error fetching report:", error);
    } finally {
      setLoading(false);
      setLoadingDaily(false);
    }
  };

  const downloadExcel = async () => {
    if (!selectedSection || !startDate || !endDate) return;

    setDownloading(true);
    try {
      const token = getPortalToken();
      const d = new Date(startDate + "T00:00:00");
      const month = d.getMonth() + 1;
      const year = d.getFullYear();
      
      const response = await axios.get(
        `${SERVER_URL}/api/attendance/export/${selectedSection}`,
        {
          params: { month, year },
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        }
      );

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      
      const section = sections.find(s => s.id === selectedSection);
      const sectionName = section ? `${gradeLevelLabels[section.gradeLevel]}-${section.name}` : "Attendance";
      const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      link.setAttribute("download", `SF2_${sectionName}_${monthNames[month - 1]}_${year}.xlsx`);
      
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading Excel:", error);
    } finally {
      setDownloading(false);
    }
  };

  const getAttendanceRate = (present: number, total: number) => {
    if (total === 0) return 0;
    return ((present / total) * 100).toFixed(1);
  };

  return (
    <div className="space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl text-white shadow-xl" style={{ backgroundColor: colors.primary }}>
              <FileSpreadsheet className="w-6 h-6" />
            </div>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Attendance Reports</h1>
          <p className="text-slate-500 font-medium text-lg">View and download attendance summaries</p>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-xl shadow-slate-200/50 rounded-[2.5rem] overflow-hidden bg-white/90 backdrop-blur-md">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-xl text-white" style={{ backgroundColor: colors.primary }}>
              <Filter className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900 tracking-tight">Attendance Report</p>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Advisory section — auto-loaded for current month</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
            <div className="space-y-2">
              <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Advisory Section</Label>
              <div className="h-12 bg-slate-50 border border-slate-100 rounded-xl flex items-center px-4">
                <span className="text-sm font-bold text-slate-900">
                  {sections.length > 0
                    ? `${gradeLevelLabels[sections[0].gradeLevel]} - ${sections[0].name}`
                    : "Loading..."}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate" className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate}
                className="h-12 bg-slate-50 border-slate-100 rounded-xl text-xs font-bold shadow-sm focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate" className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                max={getLocalDateStr()}
                className="h-12 bg-slate-50 border-slate-100 rounded-xl text-xs font-bold shadow-sm focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>

            <div className="flex items-end gap-2">
              <Button
                onClick={fetchReport}
                disabled={!selectedSection || !startDate || !endDate || loading}
                className="flex-1 h-12 rounded-xl text-white shadow-xl font-bold text-[10px] tracking-widest uppercase transition-all"
                style={{ backgroundColor: colors.primary }}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 mr-2" />
                    VIEW REPORT
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      {summary.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-0 shadow-lg shadow-slate-200/50 rounded-[2rem] bg-white overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Students</p>
                  <p className="text-2xl font-black text-slate-800">{summary.length}</p>
                </div>
                <div className="p-3 rounded-2xl text-white" style={{ backgroundColor: colors.primary }}>
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-lg shadow-slate-200/50 rounded-[2rem] bg-white overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Avg. Attendance</p>
                  <p className="text-2xl font-black text-emerald-600">
                    {summary.length > 0
                      ? (
                          (summary.reduce((acc, s) => acc + s.present, 0) /
                            summary.reduce((acc, s) => acc + s.total, 0)) *
                          100
                        ).toFixed(1)
                      : 0}%
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-500">
                  <Eye className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-lg shadow-slate-200/50 rounded-[2rem] bg-white overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Days</p>
                  <p className="text-2xl font-black text-slate-800">{summary[0]?.total || 0}</p>
                </div>
                <div className="p-3 rounded-2xl bg-amber-50 text-amber-500">
                  <Calendar className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-lg shadow-slate-200/50 rounded-[2rem] bg-white overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Export</p>
                  <p className="text-sm font-black text-slate-800">SF2 Download</p>
                </div>
                <Button
                  onClick={downloadExcel}
                  disabled={downloading}
                  className="h-10 rounded-xl text-white font-bold text-[10px] tracking-widest uppercase transition-all"
                  style={{ backgroundColor: colors.secondary }}
                >
                  {downloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Report Table */}
      <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white">
        <CardHeader className="p-8 border-b border-slate-50 bg-slate-50/30">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-black text-slate-900 tracking-tight">Attendance Summary</CardTitle>
              <CardDescription className="text-slate-500 font-sans normal-case font-medium tracking-normal mt-1">
                {summary.length > 0
                  ? `Showing ${summary.length} students from ${startDate} to ${endDate}`
                  : "Select filters and click 'View Report' to see data"}
              </CardDescription>
            </div>
            {summary.length > 0 && (
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 py-1.5 rounded-full bg-slate-100">
                {summary.length} Records
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading || loadingDaily ? (
            <div className="flex items-center justify-center py-24">
              <div className="text-center">
                <div className="w-20 h-20 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-sm" style={{ backgroundColor: `${colors.primary}15` }}>
                  <Loader2 className="w-10 h-10 animate-spin" style={{ color: colors.primary }} />
                </div>
                <p className="text-slate-500 font-black text-xs uppercase tracking-widest">Compiling SF2 Daily Grid...</p>
              </div>
            </div>
          ) : summary.length > 0 ? (
            (() => {
              const dateList = getDatesInRange(startDate, endDate);
              const getIsActiveDay = (date: string) => {
                return Object.values(dailyRecords).some((records) =>
                  records.some((r) => r.date.split("T")[0] === date)
                );
              };
              const activeSchoolDays = dateList.filter(date => getIsActiveDay(date));

              const getDailyAttendanceStats = (date: string) => {
                let presentCount = 0;
                summary.forEach((student) => {
                  const records = dailyRecords[student.studentId] || [];
                  const recordForDate = records.find((r) => r.date.split("T")[0] === date);
                  if (!recordForDate || recordForDate.status === "PRESENT" || recordForDate.status === "LATE") {
                    presentCount++;
                  }
                });
                return presentCount;
              };

              const getHasConsecutiveAbsences = (studentId: string) => {
                const records = dailyRecords[studentId] || [];
                const sorted = [...records].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                let maxConsec = 0;
                let currentConsec = 0;
                for (const r of sorted) {
                  if (r.status === "ABSENT") {
                    currentConsec++;
                    if (currentConsec > maxConsec) maxConsec = currentConsec;
                  } else {
                    currentConsec = 0;
                  }
                }
                return maxConsec >= 5;
              };

              const males = summary.filter((s) => studentGenders[s.studentId] === "MALE").sort((a, b) => a.lastName.localeCompare(b.lastName));
              const females = summary.filter((s) => studentGenders[s.studentId] === "FEMALE").sort((a, b) => a.lastName.localeCompare(b.lastName));
              const unclassified = summary.filter((s) => studentGenders[s.studentId] !== "MALE" && studentGenders[s.studentId] !== "FEMALE").sort((a, b) => a.lastName.localeCompare(b.lastName));

              const renderRosterRows = (studentList: AttendanceSummary[], groupLabel: string) => {
                if (studentList.length === 0) return null;
                return (
                  <>
                    {/* Gender Group Divider */}
                    <TableRow className="bg-slate-100/60 hover:bg-slate-100/60">
                      <TableCell colSpan={activeSchoolDays.length + 8} className="py-2.5 px-6 text-[10px] font-black text-slate-500 tracking-widest uppercase">
                        {groupLabel} ({studentList.length} Learners)
                      </TableCell>
                    </TableRow>
                    {studentList.map((student) => {
                      const records = dailyRecords[student.studentId] || [];
                      const hasConsecAbsence = getHasConsecutiveAbsences(student.studentId);
                      
                      return (
                        <TableRow key={student.studentId} className="hover:bg-slate-50/50 transition-all border-slate-100 group">
                          {/* LRN - Sticky left */}
                          <TableCell className="font-mono text-xs text-slate-400 font-bold group-hover:text-slate-900 transition-colors border-r border-slate-100 px-4">
                            {student.lrn}
                          </TableCell>
                          
                          {/* Learner Name - Sticky left */}
                          <TableCell className="font-bold text-slate-900 tracking-tight border-r border-slate-100 whitespace-nowrap min-w-[200px] px-4">
                            <div className="flex items-center justify-between gap-3">
                              <span>{student.lastName}, {student.firstName}</span>
                              {hasConsecAbsence && (
                                <span className="bg-rose-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse shrink-0">
                                  5+ Abs
                                </span>
                              )}
                            </div>
                          </TableCell>

                          {/* Daily Columns */}
                          {activeSchoolDays.map((date) => {
                            const record = records.find((r) => r.date.split("T")[0] === date);
                            const status = record?.status || "PRESENT";
                            
                            return (
                              <TableCell 
                                key={date} 
                                className="text-center font-black text-xs border-r border-slate-100 p-0 w-10 min-w-[40px] max-w-[40px]"
                              >
                                {status === "ABSENT" ? (
                                  <span className="text-rose-600 bg-rose-50 w-full h-full flex items-center justify-center py-2">X</span>
                                ) : status === "LATE" ? (
                                  <span className="text-amber-600 bg-amber-50 w-full h-full flex items-center justify-center py-2">/</span>
                                ) : status === "EXCUSED" ? (
                                  <span className="text-indigo-600 bg-indigo-50 w-full h-full flex items-center justify-center py-2">E</span>
                                ) : (
                                  <span className="text-emerald-500 font-normal opacity-30">•</span>
                                )}
                              </TableCell>
                            );
                          })}

                          {/* Right Summaries */}
                          <TableCell className="text-center font-black text-xs text-emerald-600 border-r border-slate-100">{student.present}</TableCell>
                          <TableCell className="text-center font-black text-xs text-rose-600 border-r border-slate-100">{student.absent}</TableCell>
                          <TableCell className="text-center font-black text-xs text-amber-600 border-r border-slate-100">{student.late}</TableCell>
                          <TableCell className="text-center font-black text-xs text-indigo-600 border-r border-slate-100">{student.excused}</TableCell>
                          <TableCell className="text-center font-bold text-xs text-slate-500 border-r border-slate-100">{student.total}</TableCell>
                          <TableCell className="text-center border-r border-slate-100 px-3">
                            <span
                              className={`font-black text-xs ${
                                parseFloat(getAttendanceRate(student.present, student.total)) >= 90
                                  ? "text-emerald-600"
                                  : parseFloat(getAttendanceRate(student.present, student.total)) >= 75
                                  ? "text-amber-600"
                                  : "text-rose-600"
                              }`}
                            >
                              {getAttendanceRate(student.present, student.total)}%
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </>
                );
              };

              return (
                <div className="overflow-x-auto border border-slate-150 rounded-[1.5rem]">
                  <Table className="border-collapse table-fixed min-w-full">
                    <TableHeader>
                      <TableRow className="bg-slate-50 border-b border-slate-200">
                        <TableHead className="w-36 text-[10px] font-black text-slate-400 uppercase tracking-widest border-r border-slate-200 px-4">LRN</TableHead>
                        <TableHead className="w-56 text-[10px] font-black text-slate-400 uppercase tracking-widest border-r border-slate-200 px-4">Student Name</TableHead>
                        
                        {/* Daily Columns Headers */}
                        {activeSchoolDays.map((date) => (
                          <TableHead 
                            key={date} 
                            className="w-10 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center border-r border-slate-200 p-0"
                            title={date}
                          >
                            {new Date(date).getDate()}
                          </TableHead>
                        ))}

                        <TableHead className="w-12 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center border-r border-slate-200 p-0">P</TableHead>
                        <TableHead className="w-12 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center border-r border-slate-200 p-0">A</TableHead>
                        <TableHead className="w-12 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center border-r border-slate-200 p-0">L</TableHead>
                        <TableHead className="w-12 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center border-r border-slate-200 p-0">E</TableHead>
                        <TableHead className="w-16 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center border-r border-slate-200 p-0">Total</TableHead>
                        <TableHead className="w-20 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center px-2">Rate %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renderRosterRows(males, "Male")}
                      {renderRosterRows(females, "Female")}
                      {renderRosterRows(unclassified, "Unclassified")}

                      {/* Bottom SF2 Stats Calculations */}
                      {activeSchoolDays.length > 0 && (
                        <>
                          {/* Daily Present count */}
                          <TableRow className="bg-slate-50/50 hover:bg-slate-50/50 font-bold border-t-2 border-slate-200">
                            <TableCell colSpan={2} className="text-right text-[10px] font-black uppercase text-slate-400 tracking-wider px-4 py-3">
                              Daily Attendance count
                            </TableCell>
                            {activeSchoolDays.map((date) => {
                              const presentCount = getDailyAttendanceStats(date);
                              return (
                                <TableCell key={`cnt-${date}`} className="text-center font-black text-slate-800 text-xs py-3 border-r border-slate-100">
                                  {presentCount}
                                </TableCell>
                              );
                            })}
                            <TableCell colSpan={6} className="bg-slate-50/30" />
                          </TableRow>

                          {/* Daily Attendance Rate % */}
                          <TableRow className="bg-slate-50/80 hover:bg-slate-50/80 font-bold">
                            <TableCell colSpan={2} className="text-right text-[10px] font-black uppercase text-slate-400 tracking-wider px-4 py-3">
                              Daily Attendance Rate %
                            </TableCell>
                            {activeSchoolDays.map((date) => {
                              const presentCount = getDailyAttendanceStats(date);
                              const rate = summary.length > 0 ? (presentCount / summary.length) * 100 : 0;
                              return (
                                <TableCell key={`rate-${date}`} className="text-center font-black text-[10px] py-3 border-r border-slate-100" style={{ color: colors.primary }}>
                                  {rate.toFixed(0)}%
                                </TableCell>
                              );
                            })}
                            <TableCell colSpan={6} className="bg-slate-50/50" />
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                </div>
              );
            })()
          ) : (
            <div className="py-32 text-center px-8">
              <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 shadow-sm">
                <Calendar className="w-10 h-10 text-slate-200" />
              </div>
              <h3 className="font-black text-slate-900 text-2xl mb-3">No Attendance Data</h3>
              <p className="text-slate-400 font-medium text-lg leading-relaxed">Select a section and date range to view the report</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
