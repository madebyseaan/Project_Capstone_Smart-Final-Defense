import { Fragment, useEffect, useState } from "react";
import { Calendar, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import api, { advisoryApi, type SF2Data } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

interface AdvisorySection {
  id: string;
  name: string;
  gradeLevel: string;
}

function MarkContent({ mark }: { mark: string }) {
  if (mark === "x") {
    return <span className="flex h-full w-full items-center justify-center bg-rose-50 py-2 text-rose-600">x</span>;
  }
  if (mark === "/") {
    return <span className="flex h-full w-full items-center justify-center bg-amber-50 py-2 text-amber-600">/</span>;
  }
  if (mark === "E") {
    return <span className="flex h-full w-full items-center justify-center bg-indigo-50 py-2 text-indigo-600">E</span>;
  }
  return <span className="text-emerald-500 font-normal opacity-30">•</span>;
}

export default function AttendanceReports() {
  const currentYear = new Date().getFullYear();
  const [section, setSection] = useState<AdvisorySection | null>(null);
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [year, setYear] = useState<number>(currentYear);
  const [data, setData] = useState<SF2Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    advisoryApi
      .getMyAdvisory()
      .then((res) => {
        if (cancelled) return;
        if (res.data?.hasAdvisory && res.data.section) {
          setSection(res.data.section);
        } else {
          setError("No advisory class assigned to your account.");
          setLoading(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load your advisory class.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!section) return;
    let cancelled = false;

    const loadReport = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<{ success: boolean; data: SF2Data }>(`/attendance/sf2/${section.id}`, {
          params: { month, year },
        });
        if (!cancelled) setData(res.data.data);
      } catch {
        if (!cancelled) setError("Failed to load the attendance report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [section, month, year]);

  const handleDownload = async () => {
    if (!section || !data) return;
    try {
      const res = await api.get(`/attendance/export/${section.id}`, {
        params: { month, year },
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SF2_${section.name}_${data.monthLabel}_${year}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading attendance export:", err);
    }
  };

  const hasReport = data !== null && data.schoolDays.length > 0;
  const totalDays = data?.schoolDays.length ?? 0;
  const enrolmentTotal = data?.summary.enrolmentTotal ?? 0;
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const getAttendanceRate = (present: number) => {
    if (totalDays === 0) return "0";
    return ((present / totalDays) * 100).toFixed(1);
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Attendance Reports"
        description="View and download attendance summaries"
        actions={
          <div className="p-2.5 rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
        }
      />

      <Card className="border-0 shadow-xl shadow-foreground/5 rounded-[2.5rem] overflow-hidden bg-card">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-xl bg-primary text-primary-foreground">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground tracking-tight">Attendance Report</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Advisory section — auto-loaded, SF2-aligned
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">
                Advisory Section
              </label>
              <div className="h-12 bg-muted/50 border border-border rounded-xl flex items-center px-4">
                <span className="text-sm font-bold text-foreground">
                  {section
                    ? `${gradeLevelLabels[section.gradeLevel] ?? section.gradeLevel} - ${section.name}`
                    : "Loading..."}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="reportMonth" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">
                Month
              </label>
              <select
                id="reportMonth"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="h-12 w-full bg-background border border-border rounded-xl text-xs font-bold px-3 text-foreground"
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="reportYear" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">
                Year
              </label>
              <select
                id="reportYear"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-12 w-full bg-background border border-border rounded-xl text-xs font-bold px-3 text-foreground"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <Button
              onClick={handleDownload}
              disabled={!data}
              variant="outline"
              className="h-12 rounded-xl font-bold text-[10px] tracking-widest uppercase"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {hasReport && data && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="border-0 shadow-lg shadow-foreground/5 rounded-[2rem] bg-card overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Total Students</p>
                  <p className="text-2xl font-bold text-foreground">{enrolmentTotal}</p>
                </div>
                <div className="p-3 rounded-2xl bg-primary text-primary-foreground">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-lg shadow-foreground/5 rounded-[2rem] bg-card overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Avg. Attendance</p>
                  <p className="text-2xl font-bold text-emerald-600">{data.summary.percentageAttendance}%</p>
                </div>
                <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-500">
                  <Calendar className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-lg shadow-foreground/5 rounded-[2rem] bg-card overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Total Days</p>
                  <p className="text-2xl font-bold text-foreground">{totalDays}</p>
                </div>
                <div className="p-3 rounded-2xl bg-amber-50 text-amber-500">
                  <Calendar className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-0 shadow-2xl shadow-foreground/5 rounded-[2.5rem] overflow-hidden bg-card">
        <CardHeader className="p-8 border-b border-border/60 bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold text-foreground tracking-tight">Attendance Summary</CardTitle>
              <CardDescription className="text-muted-foreground font-sans normal-case font-medium tracking-normal mt-1">
                {hasReport && data
                  ? `${data.monthLabel} ${data.year} — ${enrolmentTotal} students, ${totalDays} school days`
                  : "Attendance overview for your advisory class"}
              </CardDescription>
            </div>
            {hasReport && data && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-3 py-1.5 rounded-full bg-muted">
                {enrolmentTotal} Students
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="text-center">
                <div className="w-20 h-20 rounded-[2rem] bg-muted flex items-center justify-center mx-auto mb-6 shadow-sm">
                  <Loader2 className="w-10 h-10 animate-spin text-primary" />
                </div>
                <p className="text-muted-foreground font-bold text-xs uppercase tracking-widest">Compiling SF2 Daily Grid...</p>
              </div>
            </div>
          ) : error ? (
            <div className="py-32 text-center px-8">
              <div className="w-24 h-24 bg-muted rounded-[2.5rem] flex items-center justify-center mx-auto mb-8">
                <Calendar className="w-10 h-10 text-muted-foreground" />
              </div>
              <h3 className="font-bold text-foreground text-2xl mb-3">Unable to Load Report</h3>
              <p className="text-muted-foreground font-medium leading-relaxed">{error}</p>
            </div>
          ) : hasReport && data ? (
            <>
              <div className="overflow-x-auto">
                <Table className="border-collapse table-fixed min-w-full">
                  <TableHeader>
                    <TableRow className="bg-muted/50 border-b border-border">
                      <TableHead className="w-36 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-r border-border/60 px-4">LRN</TableHead>
                      <TableHead className="w-56 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-r border-border/60 px-4">Student Name</TableHead>
                      {data.schoolDays.map((d) => (
                        <TableHead
                          key={d.date}
                          title={d.date}
                          className="w-10 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center border-r border-border/60 p-0"
                        >
                          {d.dayNum}
                        </TableHead>
                      ))}
                      <TableHead className="w-12 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center border-r border-border/60 p-0">P</TableHead>
                      <TableHead className="w-12 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center border-r border-border/60 p-0">A</TableHead>
                      <TableHead className="w-12 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center border-r border-border/60 p-0">L</TableHead>
                      <TableHead className="w-12 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center border-r border-border/60 p-0">E</TableHead>
                      <TableHead className="w-16 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center border-r border-border/60 p-0">Total</TableHead>
                      <TableHead className="w-20 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center px-2">Rate %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.groups.map((group) => (
                      <Fragment key={group.key}>
                        <TableRow className="bg-muted/60 hover:bg-muted/60">
                          <TableCell
                            colSpan={data.schoolDays.length + 8}
                            className="py-2.5 px-6 text-[10px] font-bold text-muted-foreground tracking-widest uppercase"
                          >
                            {group.label} ({group.students.length} Learners)
                          </TableCell>
                        </TableRow>
                        {group.students.map((student) => {
                          const excused = Object.values(student.marks).filter((m) => m === "E").length;
                          const rate = parseFloat(getAttendanceRate(student.present));
                          return (
                            <TableRow key={student.studentId} className="hover:bg-muted/30 transition-all border-border/60">
                              <TableCell className="font-mono text-xs text-muted-foreground font-bold border-r border-border/60 px-4">
                                {student.lrn}
                              </TableCell>
                              <TableCell className="font-bold text-foreground tracking-tight border-r border-border/60 whitespace-nowrap min-w-[200px] px-4">
                                <div className="flex items-center justify-between gap-3">
                                  <span>
                                    {student.lastName}, {student.firstName}
                                  </span>
                                  {student.maxConsecutiveAbsent >= 5 && (
                                    <span className="bg-rose-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse shrink-0">
                                      5+ Abs
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              {data.schoolDays.map((d) => (
                                <TableCell
                                  key={`${student.studentId}-${d.date}`}
                                  className="text-center font-bold text-xs border-r border-border/60 p-0 w-10 min-w-[40px] max-w-[40px]"
                                >
                                  <MarkContent mark={student.marks[d.date] ?? ""} />
                                </TableCell>
                              ))}
                              <TableCell className="text-center font-bold text-xs text-emerald-600 border-r border-border/60">{student.present}</TableCell>
                              <TableCell className="text-center font-bold text-xs text-rose-600 border-r border-border/60">{student.absent}</TableCell>
                              <TableCell className="text-center font-bold text-xs text-amber-600 border-r border-border/60">{student.tardy}</TableCell>
                              <TableCell className="text-center font-bold text-xs text-indigo-600 border-r border-border/60">{excused}</TableCell>
                              <TableCell className="text-center font-bold text-xs text-muted-foreground border-r border-border/60">{totalDays}</TableCell>
                              <TableCell className="text-center border-r border-border/60 px-3">
                                <span
                                  className={`font-bold text-xs ${
                                    rate >= 90 ? "text-emerald-600" : rate >= 75 ? "text-amber-600" : "text-rose-600"
                                  }`}
                                >
                                  {getAttendanceRate(student.present)}%
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </Fragment>
                    ))}

                    <TableRow className="bg-muted/40 hover:bg-muted/40 font-bold border-t-2 border-border">
                      <TableCell colSpan={2} className="text-right text-[10px] font-bold uppercase text-muted-foreground tracking-wider px-4 py-3">
                        Daily Attendance Count
                      </TableCell>
                      {data.schoolDays.map((d) => (
                        <TableCell key={`cnt-${d.date}`} className="text-center font-bold text-foreground text-xs py-3 border-r border-border/60">
                          {data.dailyPresent[d.date] ?? 0}
                        </TableCell>
                      ))}
                      <TableCell colSpan={6} className="bg-muted/20" />
                    </TableRow>

                    <TableRow className="bg-muted/60 hover:bg-muted/60 font-bold">
                      <TableCell colSpan={2} className="text-right text-[10px] font-bold uppercase text-muted-foreground tracking-wider px-4 py-3">
                        Daily Attendance Rate %
                      </TableCell>
                      {data.schoolDays.map((d) => {
                        const present = data.dailyPresent[d.date] ?? 0;
                        const rate = enrolmentTotal > 0 ? (present / enrolmentTotal) * 100 : 0;
                        return (
                          <TableCell key={`rate-${d.date}`} className="text-center font-bold text-[10px] py-3 border-r border-border/60 text-primary">
                            {rate.toFixed(0)}%
                          </TableCell>
                        );
                      })}
                      <TableCell colSpan={6} className="bg-muted/30" />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-6 py-3 border-t border-border/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <span className="text-emerald-500 opacity-60">• Present</span>
                <span className="text-rose-600">x Absent</span>
                <span className="text-amber-600">/ Tardy</span>
                <span className="text-indigo-600">E Excused</span>
              </div>
            </>
          ) : (
            <div className="py-32 text-center px-8">
              <div className="w-24 h-24 bg-muted rounded-[2.5rem] flex items-center justify-center mx-auto mb-8">
                <Calendar className="w-10 h-10 text-muted-foreground" />
              </div>
              <h3 className="font-bold text-foreground text-2xl mb-3">No Attendance Data</h3>
              <p className="text-muted-foreground font-medium leading-relaxed">
                {data ? `No attendance recorded for ${data.monthLabel} ${data.year}.` : "Select a month to view the report."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
