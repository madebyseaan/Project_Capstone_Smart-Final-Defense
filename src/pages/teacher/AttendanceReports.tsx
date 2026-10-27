import { Fragment, useEffect, useState } from "react";
import { Calendar, ChevronDown, ChevronUp, Download, FileSpreadsheet, Loader2, MoveHorizontal, User } from "lucide-react";
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
  const [showFullGrid, setShowFullGrid] = useState(false);

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
      <div className="hidden lg:block">
        <PageHeader
          title="Attendance Reports"
          description="View and download attendance summaries"
          actions={
            <div className="rounded-2xl bg-primary p-2.5 text-primary-foreground shadow-lg">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-3 gap-2 lg:gap-6">
        <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <CardContent className="p-3 lg:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Total Students</p>
                <p className="text-2xl font-bold text-foreground">{data ? enrolmentTotal : "—"}</p>
              </div>
              <div className="hidden rounded-xl bg-primary p-2.5 text-primary-foreground sm:flex">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <CardContent className="p-3 lg:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Avg. Attendance</p>
                <p className="text-2xl font-bold text-emerald-600">
                  {data ? `${data.summary.percentageAttendance}%` : "—"}
                </p>
              </div>
              <div className="hidden rounded-xl bg-emerald-50 p-2.5 text-emerald-500 sm:flex">
                <Calendar className="w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <CardContent className="p-3 lg:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Total Days</p>
                <p className="text-2xl font-bold text-foreground">{data ? totalDays : "—"}</p>
              </div>
              <div className="hidden rounded-xl bg-amber-50 p-2.5 text-amber-500 sm:flex">
                <Calendar className="w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border p-4 lg:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="hidden rounded-xl bg-primary p-2 text-primary-foreground sm:flex">
                <Calendar className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg font-semibold tracking-tight text-foreground lg:text-xl">
                  Attendance summary
                </CardTitle>
                <CardDescription className="mt-1 text-sm">
                  {section
                    ? `${gradeLevelLabels[section.gradeLevel] ?? section.gradeLevel} - ${section.name}`
                    : "Loading advisory section…"}
                  {hasReport && data ? ` · ${data.monthLabel} ${data.year}` : ""}
                </CardDescription>
              </div>
            </div>

            <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[8rem_6rem_auto]">
              <div className="space-y-1.5">
                <label htmlFor="reportMonth" className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Month
                </label>
                <select
                  id="reportMonth"
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground"
                >
                  {MONTH_NAMES.map((name, i) => (
                    <option key={name} value={i + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="reportYear" className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Year
                </label>
                <select
                  id="reportYear"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground"
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
                className="col-span-2 h-10 rounded-lg text-xs font-semibold uppercase tracking-wide sm:col-span-1"
              >
                <Download className="mr-2 h-4 w-4" />
                Download Excel
              </Button>
            </div>
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
              {/* Mobile per-student summary */}
              {!showFullGrid && (
              <div className="md:hidden">
                {data.groups.map((group) => (
                  <div key={`mobile-${group.key}`}>
                    <p className="bg-muted/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label} ({group.students.length})
                    </p>
                    <div className="divide-y divide-border">
                      {group.students.map((student) => {
                        const excused = Object.values(student.marks).filter((m) => m === "E").length;
                        const rate = parseFloat(getAttendanceRate(student.present));
                        return (
                          <details key={`mobile-${student.studentId}`} className="group/student">
                            <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                                {student.lastName.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-sm font-semibold text-foreground">
                                  {student.lastName}, {student.firstName}
                                </p>
                                <p className="font-mono text-[11px] text-muted-foreground">{student.lrn}</p>
                                {student.maxConsecutiveAbsent >= 5 && (
                                  <span className="mt-1 inline-flex rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600">
                                    5+ consecutive absences
                                  </span>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                <p className={`text-sm font-bold ${rate >= 90 ? "text-emerald-600" : rate >= 75 ? "text-amber-600" : "text-rose-600"}`}>
                                  {getAttendanceRate(student.present)}%
                                </p>
                                <p className="text-[10px] text-muted-foreground">{student.present}/{totalDays} days</p>
                              </div>
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/student:rotate-180" aria-hidden="true" />
                            </summary>
                            <div className="space-y-3 bg-muted/30 px-4 pb-4">
                              <div className="grid grid-cols-4 gap-2">
                                <div className="rounded-lg border border-border bg-card px-2 py-2 text-center">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">P</p>
                                  <p className="text-sm font-bold text-emerald-600">{student.present}</p>
                                </div>
                                <div className="rounded-lg border border-border bg-card px-2 py-2 text-center">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">A</p>
                                  <p className="text-sm font-bold text-rose-600">{student.absent}</p>
                                </div>
                                <div className="rounded-lg border border-border bg-card px-2 py-2 text-center">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">L</p>
                                  <p className="text-sm font-bold text-amber-600">{student.tardy}</p>
                                </div>
                                <div className="rounded-lg border border-border bg-card px-2 py-2 text-center">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">E</p>
                                  <p className="text-sm font-bold text-indigo-600">{excused}</p>
                                </div>
                              </div>
                              <div>
                                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  <User className="h-3 w-3" /> Daily marks
                                </p>
                                <ul className="grid grid-cols-2 gap-1">
                                  {data.schoolDays.map((d) => {
                                    const mark = student.marks[d.date] ?? "";
                                    return (
                                      <li key={`${student.studentId}-${d.date}`} className="flex items-center justify-between rounded-md bg-card px-2 py-1 text-[11px]">
                                        <span className="text-muted-foreground">{new Date(`${d.date}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</span>
                                        <MarkContent mark={mark} />
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              )}

              <div className="flex items-center justify-between gap-3 border-y border-border px-4 py-3 md:hidden">
                <div>
                  <p className="text-sm font-semibold text-foreground">Full SF2 grid</p>
                  <p className="text-xs text-muted-foreground">Wide matrix with sticky LRN column</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowFullGrid((prev) => !prev)}
                  aria-expanded={showFullGrid}
                  className="h-12 shrink-0 rounded-xl text-xs font-semibold"
                >
                  {showFullGrid ? <ChevronUp className="mr-1.5 h-4 w-4" /> : <ChevronDown className="mr-1.5 h-4 w-4" />}
                  {showFullGrid ? "Hide" : "View"}
                </Button>
              </div>

              {showFullGrid && (
                <p className="flex items-center gap-1.5 px-4 pb-2 text-[11px] font-medium text-muted-foreground md:hidden">
                  <MoveHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  Swipe horizontally to see all days
                </p>
              )}
              <div className={showFullGrid ? "overflow-x-auto" : "hidden overflow-x-auto md:block"}>
                <Table className="border-collapse table-fixed min-w-full">
                  <TableHeader>
                    <TableRow className="bg-muted/50 border-b border-border">
                      <TableHead className="sticky left-0 z-10 w-36 bg-muted px-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-r border-border/60">LRN</TableHead>
                      <TableHead className="w-56 bg-muted px-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-r border-border/60">Student name</TableHead>
                      {data.schoolDays.map((d) => (
                        <TableHead
                          key={d.date}
                          title={d.date} aria-label={d.date}
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
                            {group.label} ({group.students.length} {group.students.length === 1 ? "Learner" : "Learners"})
                          </TableCell>
                        </TableRow>
                        {group.students.map((student) => {
                          const excused = Object.values(student.marks).filter((m) => m === "E").length;
                          const rate = parseFloat(getAttendanceRate(student.present));
                          return (
                            <TableRow key={student.studentId} className="hover:bg-muted/30 transition-all border-border/60">
                              <TableCell className="sticky left-0 z-10 bg-card px-4 font-mono text-xs font-semibold text-muted-foreground border-r border-border/60">
                                {student.lrn}
                              </TableCell>
                              <TableCell className="min-w-[200px] bg-card px-4 font-semibold tracking-tight text-foreground border-r border-border/60">
                                <div className="flex items-center justify-between gap-3">
                                  <span>
                                    {student.lastName}, {student.firstName}
                                  </span>
                                  {student.maxConsecutiveAbsent >= 5 && (
                                    <span className="bg-rose-500 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0">
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




