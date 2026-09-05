import { useEffect, useState } from "react";
import { useSyncStream } from "@/hooks/useSyncStream";
import { Link, useLocation } from "react-router-dom";
import {
  Users,
  BookOpen,
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  BarChart3,
  FileCheck,
  Star,
  Medal,
  Sparkles,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { gradesApi, scheduleApi, type ClassAssignment, type GradeDeadlineInfo } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { GradeDeadlineBanner } from "@/components/GradeDeadlineBanner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface AdvisoryHonorsData {
  advisoryHonors: { id: string; name: string; grade: number; honor: string; class: string }[];
  withHonors: { id: string; name: string; grade: number; honor: string; class: string }[];
  hasAdvisory: boolean;
}

interface DashboardData {
  teacher: {
    name: string;
    employeeId: string;
    specialization?: string;
  };
  stats: {
    totalClasses: number;
    totalStudents: number;
    subjects: string[];
    archivedClassesCount?: number;
  };
  classAssignments: ClassAssignment[];
  archivedClassesCount?: number;
  currentTerm: string;
  gradeDeadline?: GradeDeadlineInfo | null;
}

interface ClassStats {
  id: string;
  subjectCode: string;
  subjectName: string;
  sectionName: string;
  gradeLevel: string;
  totalStudents: number;
  gradedCount: number;
  avgGrade: number | null;
  passingRate: number;
  studentsAtRisk: { id: string; name: string; grade: number; class: string }[];
  honorsStudents: { id: string; name: string; grade: number; honor: string }[];
  withHonorsStudents: { id: string; name: string; grade: number; honor: string }[];
}

interface DashboardStats {
  classStats: ClassStats[];
  summary: {
    totalClasses: number;
    totalStudents: number;
    totalGraded: number;
    gradeSubmissionRate: number;
    overallPassingRate: number;
    studentsAtRisk: { id: string; name: string; grade: number; class: string }[];
    studentsAtRiskCount: number;
  };
  archivedClassesCount?: number;
}

interface MasteryDistribution {
  distribution: {
    outstanding: number;
    verySatisfactory: number;
    satisfactory: number;
    fairlySatisfactory: number;
    didNotMeet: number;
  };
  totalStudents: number;
  filters: {
    gradeLevels: string[];
    sections: { id: string; name: string; gradeLevel: string }[];
  };
}

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

function fmtTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function TeacherDashboard() {
  const { colors } = useTheme();
  const { syncVersion } = useSyncStream();
  const location = useLocation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [masteryData, setMasteryData] = useState<MasteryDistribution | null>(null);
  const [advisoryHonors, setAdvisoryHonors] = useState<AdvisoryHonorsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHonorsTerm, setSelectedHonorsTerm] = useState<string>("all");
  const [selectedGradeLevel, setSelectedGradeLevel] = useState<string>("all");
  const [selectedSection, setSelectedSection] = useState<string>("all");
  const [attentionSectionFilter, setAttentionSectionFilter] = useState<string>("all");
  const [attentionSubjectFilter, setAttentionSubjectFilter] = useState<string>("all");
  const [showAllGrading, setShowAllGrading] = useState(false);
  const [todayClasses, setTodayClasses] = useState<{ subject: { code: string; name: string }; section: { name: string; gradeLevel: string }; startTime: string; endTime: string; roomId: number | null }[]>([]);
  const [now, setNow] = useState(new Date());

  // Get current day key (MONDAY, TUESDAY, etc.)
  const getDayKey = (): string => {
    const day = new Date().getDay();
    return ["", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "", ""][day] ?? "";
  };

  // Auto-advance: update `now` every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Determine current class status from time
  const getCurrentClassInfo = () => {
    if (todayClasses.length === 0) return { status: "empty" as const };

    const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const currentMin = now.getHours() * 60 + now.getMinutes();

    // Sort classes by start time
    const sorted = [...todayClasses].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    const firstStart = toMin(sorted[0].startTime);
    const lastEnd = toMin(sorted[sorted.length - 1].endTime);

    // Before school
    if (currentMin < firstStart) {
      return { status: "before" as const, next: sorted[0] };
    }

    // After all classes
    if (currentMin >= lastEnd) {
      return { status: "done" as const };
    }

    // Find current or next class
    for (const cls of sorted) {
      const start = toMin(cls.startTime);
      const end = toMin(cls.endTime);
      if (currentMin >= start && currentMin < end) {
        return { status: "active" as const, current: cls };
      }
    }

    // Between classes — find next
    for (const cls of sorted) {
      if (toMin(cls.startTime) > currentMin) {
        return { status: "next" as const, next: cls };
      }
    }

    return { status: "done" as const };
  };

  const classInfo = getCurrentClassInfo();

  // Fetch mastery distribution with filters
  const fetchMasteryDistribution = async (gradeLevel?: string, sectionId?: string) => {
    try {
      const res = await gradesApi.getMasteryDistribution(
        gradeLevel === "all" ? undefined : gradeLevel,
        sectionId === "all" ? undefined : sectionId
      );
      setMasteryData(res.data);
    } catch (err) {
      console.error("Error fetching mastery distribution:", err);
    }
  };

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const [dashboardRes, statsRes, masteryRes, advisoryHonorsRes, scheduleRes] = await Promise.all([
          gradesApi.getDashboard(),
          gradesApi.getDashboardStats(),
          gradesApi.getMasteryDistribution(),
          gradesApi.getAdvisoryHonors(),
          scheduleApi.getMySchedule().catch(() => ({ data: null })),
        ]);
        setData(dashboardRes.data);
        setStats(statsRes.data);
        setMasteryData(masteryRes.data);
        setAdvisoryHonors(advisoryHonorsRes.data);
        setSelectedHonorsTerm(dashboardRes.data.currentTerm);

        // Extract today's classes from schedule
        if (scheduleRes.data) {
          const dayKey = getDayKey();
          const todayEntries = scheduleRes.data.byDay?.[dayKey] ?? [];
          setTodayClasses(todayEntries);
        }
      } catch (err) {
        setError("Failed to load dashboard data");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, [syncVersion, location.key]);

  // Update mastery data when filters change
  useEffect(() => {
    if (!loading) {
      fetchMasteryDistribution(selectedGradeLevel, selectedSection);
    }
  }, [selectedGradeLevel, selectedSection]);

  // Update honors data when term changes
  useEffect(() => {
    if (!loading && selectedHonorsTerm && selectedHonorsTerm !== "all") {
      const fetchHonors = async () => {
        try {
          const res = await gradesApi.getAdvisoryHonors(selectedHonorsTerm);
          setAdvisoryHonors(res.data);
        } catch (err) {
          console.error("Error fetching honors:", err);
        }
      };
      fetchHonors();
    }
  }, [selectedHonorsTerm]);

  // Get filtered sections based on selected grade level
  const filteredSections = selectedGradeLevel === "all"
    ? masteryData?.filters.sections || []
    : masteryData?.filters.sections.filter(s => s.gradeLevel === selectedGradeLevel) || [];

  // Prepare chart data with more vibrant colors
  const chartData = masteryData ? [
    { 
      name: "Outstanding", 
      range: "90-100", 
      students: masteryData.distribution.outstanding,
      fill: "#10b981", // Emerald 500
      secondary: "#059669" // Emerald 600
    },
    { 
      name: "Very Satisfactory", 
      range: "85-89", 
      students: masteryData.distribution.verySatisfactory,
      fill: "#3b82f6", // Blue 500
      secondary: "#2563eb" // Blue 600
    },
    { 
      name: "Satisfactory", 
      range: "80-84", 
      students: masteryData.distribution.satisfactory,
      fill: "#f59e0b", // Amber 500
      secondary: "#d97706" // Amber 600
    },
    { 
      name: "Fairly Satisfactory", 
      range: "75-79", 
      students: masteryData.distribution.fairlySatisfactory,
      fill: "#f97316", // Orange 500
      secondary: "#ea580c" // Orange 600
    },
    { 
      name: "Did Not Meet", 
      range: "<75", 
      students: masteryData.distribution.didNotMeet,
      fill: "#ef4444", // Red 500
      secondary: "#dc2626" // Red 600
    },
  ] : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="text-center">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
            <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-indigo-500 animate-pulse" />
            </div>
          </div>
          <p className="text-muted-foreground font-medium text-lg animate-pulse">Igniting your dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-[60vh] p-4">
        <Card className="max-w-md w-full border border-slate-200/60 rounded-2xl overflow-hidden">
          <div className="h-2 bg-red-500" />
          <CardContent className="p-10 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-red-50 flex items-center justify-center text-red-500">
              <AlertTriangle className="w-10 h-10" />
            </div>
            <h3 className="font-bold text-foreground text-2xl mb-2">Oops! Something's wrong</h3>
            <p className="text-muted-foreground mb-8">{error || "We couldn't load your dashboard data right now."}</p>
            <Button 
              onClick={() => window.location.reload()} 
              className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-lg transition-all"
            >
              Try to Refresh
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* Grade Submission Deadline Banner */}
      {data.gradeDeadline && (
        <GradeDeadlineBanner deadline={data.gradeDeadline} />
      )}

      {/* ── Dynamic Living Hero Banner ── */}
      <div
        className="relative overflow-hidden rounded-3xl p-7 md:p-8 text-white shadow-xl shadow-red-950/20 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
        style={{
          background: `linear-gradient(135deg, ${colors.primary} 0%, color-mix(in srgb, ${colors.primary} 70%, black) 100%)`,
        }}
      >
        {/* Ambient subtle light sheen across the top */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.08] to-transparent pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Greeting & Quick Actions (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            {/* Live Status Pill Row */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-xs font-semibold tracking-wide">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                </span>
                <span>S.Y. {data.classAssignments[0]?.schoolYear || "2029-2030"}</span>
                <span className="text-white/40">•</span>
                <span className="text-amber-200 font-bold">
                  {data.currentTerm === "T1" ? "Term 1" : data.currentTerm === "T2" ? "Term 2" : data.currentTerm === "T3" ? "Term 3" : "Active Term"}
                </span>
              </div>

              <span className="text-xs text-white/70 font-medium hidden sm:inline">
                {data.stats.totalStudents} Enrolled Learners across {data.stats.totalClasses} Sections
              </span>
            </div>

            {/* Main Title & Subtitle */}
            <div>
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight">
                Good day, Teacher {data.teacher.name.split(",")[0]}
              </h1>
              <p className="text-sm sm:text-base text-white/80 font-normal mt-2 max-w-xl leading-relaxed">
                Welcome back to your academic workspace. Monitor grading deadlines, track student mastery, and manage your advisory roster.
              </p>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link to="/teacher/advisory">
                <Button className="h-11 px-5 rounded-xl bg-white text-slate-900 hover:bg-white/90 active:scale-95 font-bold text-sm transition-all shadow-md flex items-center gap-2">
                  <Users className="w-4 h-4 text-red-900" />
                  My Advisory
                </Button>
              </Link>
              <Link to="/teacher/classes">
                <Button className="h-11 px-5 rounded-xl bg-white/20 hover:bg-white/30 active:scale-95 text-white border border-white/25 backdrop-blur-md font-semibold text-sm transition-all shadow-sm flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  Class Records
                </Button>
              </Link>
            </div>
          </div>

          {/* Right Column: Live Timetable & Performance Pulse (5 cols) */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl bg-white/[0.12] hover:bg-white/[0.15] backdrop-blur-xl border border-white/20 p-5 shadow-lg shadow-black/5 space-y-4 transition-colors">
              {/* Schedule Header */}
              <div className="flex items-center justify-between border-b border-white/15 pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-300" />
                  <span className="text-xs font-bold uppercase tracking-wider text-white/90">Daily Timetable</span>
                </div>
                <Link to="/teacher/schedule" className="text-[11px] font-semibold text-amber-200 hover:underline flex items-center gap-1">
                  Full Schedule &rarr;
                </Link>
              </div>

              {/* Dynamic Class Status Card */}
              {classInfo.status === "active" && classInfo.current ? (
                <div className="p-3.5 rounded-xl bg-emerald-500/20 border border-emerald-400/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded bg-emerald-500 text-white shadow-sm animate-pulse">
                      In Session Now
                    </span>
                    <span className="text-xs font-bold text-emerald-200">
                      {fmtTime12h(classInfo.current.startTime)} – {fmtTime12h(classInfo.current.endTime)}
                    </span>
                  </div>
                  <p className="text-base font-bold text-white mt-1">{classInfo.current.subject.name}</p>
                  <p className="text-xs text-white/80 font-medium">{classInfo.current.section.name}</p>
                </div>
              ) : (classInfo.status === "next" || classInfo.status === "before") && classInfo.next ? (
                <div className="p-3.5 rounded-xl bg-white/[0.08] border border-white/15">
                  <div className="flex items-center justify-between mb-1">
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-400/20 text-amber-200 border border-amber-300/30">
                      Upcoming Next
                    </span>
                    <span className="text-xs font-semibold text-amber-200">
                      {fmtTime12h(classInfo.next.startTime)}
                    </span>
                  </div>
                  <p className="text-base font-bold text-white mt-1">{classInfo.next.subject.name}</p>
                  <p className="text-xs text-white/70 font-medium">{classInfo.next.section.name}</p>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-white/[0.08] border border-white/15 text-center py-5">
                  <CheckCircle className="w-5 h-5 text-white/50 mx-auto mb-1.5" />
                  <p className="text-sm font-semibold text-white/90">No further classes scheduled for today</p>
                  <p className="text-xs text-white/50 mt-0.5">Use this time for grading or lesson preparations</p>
                </div>
              )}

              {/* Quick Micro-Progress Metrics */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-2.5 rounded-xl bg-white/[0.08] border border-white/15 text-center">
                  <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest block">Passing Rate</span>
                  <span className="text-lg font-black text-white">{stats?.summary.overallPassingRate.toFixed(0) ?? 0}%</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white/[0.08] border border-white/15 text-center">
                  <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest block">Submissions</span>
                  <span className="text-lg font-black text-white">{stats?.summary.gradeSubmissionRate.toFixed(0) ?? 0}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards - Refined Professional Look */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            label: "Active Students",
            value: data.stats.totalStudents,
            icon: Users,
            color: colors.primary,
            desc: "Currently enrolled"
          },
          {
            label: "Handled Classes",
            value: data.stats.totalClasses,
            icon: BookOpen,
            color: "#10b981",
            desc: "Teaching assignments"
          },
          {
            label: "Critical Cases",
            value: stats?.summary.studentsAtRiskCount || 0,
            icon: AlertTriangle,
            color: "#ef4444",
            desc: "Requires immediate attention"
          },
          {
            label: "Graded Items",
            value: stats?.summary.totalGraded || 0,
            icon: FileCheck,
            color: "#f59e0b",
            desc: "Successful submissions"
          },
        ].map((stat) => (
          <Card key={stat.label} className="border border-slate-200/60 rounded-2xl bg-card/70 backdrop-blur-xl p-4 shadow-md shadow-slate-200/40 hover:shadow-xl transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 opacity-5 rounded-full -mr-6 -mt-6" style={{ backgroundColor: stat.color }} />
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl text-primary-foreground shadow-md group-hover:scale-110 transition-transform" style={{ backgroundColor: stat.color }}>
                <stat.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{stat.label}</p>
            <p className="text-2xl font-bold text-foreground mt-0.5">{stat.value}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{stat.desc}</p>
          </Card>
        ))}
      </div>

      {(data.archivedClassesCount || stats?.archivedClassesCount || 0) > 0 && (
        <Card className="border border-slate-200/60 rounded-2xl overflow-hidden bg-rose-50/70">
          <CardContent className="p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-rose-600">Atlas removal detected</p>
              <h3 className="text-lg font-bold text-foreground mt-1">{data.archivedClassesCount || stats?.archivedClassesCount || 0} subject assignment(s) were removed from the current Atlas load</h3>
              <p className="text-sm text-foreground font-medium mt-1">SMART keeps the grade history, but these assignments are hidden from active dashboard counts. Contact the EnrollPro/Atlas admin if this was not intended.</p>
            </div>
            <Badge className="bg-rose-600 text-white font-bold px-4 py-2 rounded-xl border-0 shadow-lg shadow-rose-300/50 text-sm self-start md:self-center">
              CONTACT ADMIN
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* ── Performance Mastery ── Full Width */}
      <Card className="border border-slate-200/60 rounded-2xl overflow-hidden flex flex-col bg-white">
          <CardHeader className="p-6 pb-3 border-b border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-slate-900 text-white">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Performance Mastery</h2>
                  <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mt-1">Distribution of student ratings</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                <Select value={selectedGradeLevel} onValueChange={(val) => {
                  if (val) setSelectedGradeLevel(val);
                  setSelectedSection("all");
                }}>
                  <SelectTrigger className="w-[115px]">
                    <SelectValue placeholder="Grade">
                      {selectedGradeLevel === "all" ? "All Grades" : (gradeLevelLabels[selectedGradeLevel] || selectedGradeLevel)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="shadow-xl">
                    <SelectItem value="all" className="text-xs font-bold">All Grades</SelectItem>
                    {masteryData?.filters.gradeLevels.map(gl => (
                      <SelectItem key={gl} value={gl} className="text-xs font-bold">{gradeLevelLabels[gl] || gl}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedSection} onValueChange={(val) => val && setSelectedSection(val)}>
                  <SelectTrigger className="w-[135px]">
                    <SelectValue placeholder="Section">
                      {selectedSection === "all" ? "All Sections" : (filteredSections.find((sec) => sec.id === selectedSection)?.name || "All Sections")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="shadow-xl">
                    <SelectItem value="all" className="text-xs font-bold">All Sections</SelectItem>
                    {filteredSections.map(s => (
                      <SelectItem key={s.id} value={s.id} className="text-xs font-bold">{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-8 pt-0 flex-1">
            <div className="h-[320px] w-full mt-6">
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 320 }}>
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    {chartData.map((entry, index) => (
                      <linearGradient key={`gradient-${index}`} id={`barGradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={entry.fill} stopOpacity={1} />
                        <stop offset="100%" stopColor={entry.secondary} stopOpacity={0.8} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    dy={10}
                  />
                  <YAxis 
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc', radius: 12 }}
                    contentStyle={{ 
                      border: 'none', 
                      borderRadius: '20px', 
                      boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
                      padding: '16px',
                      backgroundColor: '#fff'
                    }}
                    itemStyle={{ fontWeight: 900, fontSize: '14px' }}
                  />
                  <Bar dataKey="students" radius={[12, 12, 0, 0]} maxBarSize={60}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={`url(#barGradient-${index})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

      {/* ── Grading Status ── Full Width Big Card */}
      {(() => {
        const INITIAL_COUNT = 6;
        const classStats = stats?.classStats ?? [];
        const visibleStats = showAllGrading ? classStats : classStats.slice(0, INITIAL_COUNT);
        const remaining = classStats.length - INITIAL_COUNT;

        return (
          <Card className="border border-slate-200/60 rounded-2xl overflow-hidden bg-white">
            <CardHeader className="p-6 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-slate-100 text-foreground">
                  <FileCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Grading Status</h2>
                  <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mt-1">Submission progress per class</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-8 pt-0">
              {classStats.length > 0 ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {visibleStats.map((classStat, idx) => {
                      const percentage = classStat.totalStudents > 0
                        ? Math.round((classStat.gradedCount / classStat.totalStudents) * 100)
                        : 0;
                      const barColorList = [colors.primary, '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
                      const barColor = barColorList[idx % barColorList.length];
                      return (
                        <div key={classStat.id} className="p-6 rounded-3xl bg-slate-50 border border-slate-100 hover:border-slate-200 transition-all">
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <p className="text-sm font-bold text-foreground leading-tight">{classStat.sectionName}</p>
                              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1">{classStat.subjectName}</p>
                            </div>
                            <span className="text-xl font-bold" style={{ color: barColor }}>{percentage}%</span>
                          </div>
                          <div className="h-3 bg-white rounded-full overflow-hidden shadow-inner">
                            <div
                              className="h-full rounded-full transition-all duration-1000 ease-out"
                              style={{ width: `${percentage}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <div className="flex justify-between mt-3">
                            <p className="text-[9px] font-bold text-muted-foreground">{classStat.gradedCount} graded</p>
                            <p className="text-[9px] font-bold text-muted-foreground">{classStat.totalStudents} total</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {classStats.length > INITIAL_COUNT && !showAllGrading && (
                    <div className="mt-6">
                      <Button
                        onClick={() => setShowAllGrading(true)}
                        variant="outline"
                        className="w-full h-12 rounded-2xl border-dashed border-slate-200 text-muted-foreground hover:bg-slate-50 hover:text-foreground font-bold text-[10px] tracking-[0.2em] uppercase transition-all"
                      >
                        Show {remaining} more {remaining === 1 ? 'class' : 'classes'}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-16 text-center text-muted-foreground">
                  <FileCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-bold text-sm uppercase tracking-widest">No class records found</p>
                </div>
              )}
              <div className="mt-8">
                <Link to="/teacher/classes">
                  <Button className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white shadow-xl shadow-slate-200 transition-all font-bold text-[10px] tracking-[0.2em] uppercase">
                    VIEW DETAILED REPORTS
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ── Academic Honors ── Full Width with Safety Guard */}
      {(() => {
        const academicClassStats = stats?.classStats?.filter((c: any) => !c.subjectCode?.toUpperCase().startsWith('HG')) ?? [];
        const isGradingComplete = academicClassStats.length > 0
          ? academicClassStats.every((c: any) => c.totalStudents > 0 && c.gradedCount >= c.totalStudents) && (stats?.summary.gradeSubmissionRate ?? 0) >= 100
          : false;

        if (!isGradingComplete) return null;

        return (
          <Card className="border border-slate-200/60 rounded-2xl overflow-hidden bg-white">
            <CardHeader className="p-6 pb-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                  <Medal className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Academic Honors</h2>
                  <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mt-1">Leading advisory achievements</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                {advisoryHonors?.hasAdvisory && (
                  <Badge variant="secondary" className="bg-slate-50 text-muted-foreground border-slate-100 font-bold px-4 py-2 rounded-xl text-[10px] tracking-widest uppercase">
                    ADVISORY CLASS
                  </Badge>
                )}
                
                <Select value={selectedHonorsTerm} onValueChange={(val) => val && setSelectedHonorsTerm(val)}>
                  <SelectTrigger className="w-[135px]">
                    <SelectValue placeholder="Select Term" />
                  </SelectTrigger>
                  <SelectContent className="shadow-xl">
                    <SelectItem value="T1" className="text-xs font-bold">Term 1</SelectItem>
                    <SelectItem value="T2" className="text-xs font-bold">Term 2</SelectItem>
                    <SelectItem value="T3" className="text-xs font-bold">Term 3</SelectItem>
                    <SelectItem value="FINAL" className="text-xs font-bold">Final Grade</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[420px] overflow-y-auto px-8 pb-8">
                {(() => {
                  const allHonors = [
                    ...(advisoryHonors?.advisoryHonors || []),
                    ...(advisoryHonors?.withHonors || []),
                  ].sort((a, b) => b.grade - a.grade);

                  if (allHonors.length === 0) {
                    return (
                      <div className="py-20 text-center text-muted-foreground bg-slate-50 rounded-[2rem] mt-4 border-2 border-dashed border-slate-100">
                        <Star className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p className="font-bold text-sm uppercase tracking-widest">No advisory honors yet</p>
                        <p className="text-[10px] font-bold mt-2">Students with grades of 85 and above will appear here.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="overflow-hidden rounded-3xl border border-slate-100 mt-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50/50 border-b border-slate-100">
                            <th className="px-6 py-4 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Student</th>
                            <th className="px-6 py-4 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Section</th>
                            <th className="px-6 py-4 text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Grade</th>
                            <th className="px-6 py-4 text-right text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {allHonors.map((student, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 transition-all">
                              <td className="px-6 py-5">
                                <div className="flex items-center gap-3">
                                  <Avatar className="w-9 h-9 border-2 border-white shadow-sm">
                                    <AvatarFallback className="font-bold text-xs text-white" style={{ backgroundColor: colors.primary }}>
                                      {student.name.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="font-bold text-foreground text-sm tracking-tight">{student.name}</span>
                                </div>
                              </td>
                              <td className="px-6 py-5 text-muted-foreground font-bold text-xs">{student.class}</td>
                              <td className="px-6 py-5 text-center">
                                <span className="font-bold text-xs px-3 py-1.5 rounded-xl" style={{ color: colors.primary, backgroundColor: `${colors.primary}15` }}>
                                  {typeof student.grade === 'number' ? student.grade.toFixed(2) : student.grade}
                                </span>
                              </td>
                              <td className="px-6 py-5 text-right">
                                <Badge className="bg-emerald-500 text-white border-0 text-[9px] font-bold uppercase px-3 py-1 rounded-lg shadow-lg shadow-emerald-500/20">
                                  {student.honor}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ── Students Needing Attention ── Full Width Big Card */}
      {(() => {
        const advisoryName = advisoryHonors?.advisoryHonors?.[0]?.class || advisoryHonors?.withHonors?.[0]?.class;
        
        // Extract unique section names and subject names from class stats
        const sectionNames = Array.from(new Set(stats?.classStats.map(c => c.sectionName) || []));
        const subjectNames = Array.from(new Set(stats?.classStats.map(c => c.subjectName) || []));

        const filteredStudentsAtRisk = (stats?.summary.studentsAtRisk || []).filter(student => {
          // 1. Filter by Section
          if (attentionSectionFilter !== "all") {
            if (attentionSectionFilter === "advisory") {
              if (!advisoryName || !student.class.includes(advisoryName)) return false;
            } else {
              if (!student.class.includes(attentionSectionFilter)) return false;
            }
          }
          // 2. Filter by Subject
          if (attentionSubjectFilter !== "all") {
            if (!student.class.includes(attentionSubjectFilter)) return false;
          }
          return true;
        });

        return (
          <Card className="border border-slate-200/60 rounded-2xl overflow-hidden bg-white border-t-[8px] border-t-rose-500">
            <CardHeader className="p-6 pb-3 border-b border-slate-100">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-rose-50 text-rose-500">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">Students Needing Attention</h2>
                    <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mt-1">Immediate intervention required</p>
                  </div>
                </div>
                
                <div className="flex flex-wrap items-center gap-4">
                  {/* Section Select Filter */}
                  <Select value={attentionSectionFilter} onValueChange={setAttentionSectionFilter}>
                    <SelectTrigger className="w-[185px]">
                      <SelectValue placeholder="Select Section" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-slate-200 shadow-xl">
                      <SelectItem value="all" className="text-xs font-semibold">All Sections</SelectItem>
                      {advisoryHonors?.hasAdvisory && (
                        <SelectItem value="advisory" className="text-xs font-semibold text-indigo-600">My Advisory Section</SelectItem>
                      )}
                      {sectionNames.map(sect => (
                        <SelectItem key={sect} value={sect} className="text-xs font-semibold">
                          Section {sect}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Subject Select Filter */}
                  <Select value={attentionSubjectFilter} onValueChange={setAttentionSubjectFilter}>
                    <SelectTrigger className="w-[185px]">
                      <SelectValue placeholder="Select Subject" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-slate-200 shadow-xl">
                      <SelectItem value="all" className="text-xs font-semibold">All Subjects</SelectItem>
                      {subjectNames.map(subj => (
                        <SelectItem key={subj} value={subj} className="text-xs font-semibold">
                          {subj}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Badge className="bg-rose-500 text-white font-bold px-4 py-2 rounded-xl border-0 shadow-lg shadow-rose-500/30 text-sm">
                    {filteredStudentsAtRisk.length} students
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-8 pt-0">
              {filteredStudentsAtRisk && filteredStudentsAtRisk.length > 0 ? (
                <ScrollArea className="h-[350px] pr-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">
                    {filteredStudentsAtRisk.map((student, idx) => (
                      <div key={idx} className="p-6 rounded-3xl bg-rose-50/40 border border-rose-100 hover:bg-rose-50 hover:border-rose-200 transition-all flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center text-rose-500 shrink-0">
                            <Users className="w-6 h-6" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-foreground truncate">{student.name}</p>
                            <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5 truncate">{student.class}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-rose-100">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Grade</p>
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold text-rose-600 leading-none">
                              {typeof student.grade === 'number' ? student.grade.toFixed(2) : student.grade}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg"
                              style={{ backgroundColor: student.grade <= 72 ? '#fef2f2' : '#fff7ed', color: student.grade <= 72 ? '#dc2626' : '#ea580c' }}>
                              {student.grade <= 72 ? 'INC' : 'FAILED'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="py-24 flex flex-col items-center justify-center text-center bg-emerald-50/50 rounded-2xl border-2 border-dashed border-emerald-100">
                  <CheckCircle2 className="w-16 h-16 mb-4 text-emerald-400" />
                  <p className="font-bold text-emerald-800 text-lg uppercase tracking-widest">All students passed!</p>
                  <p className="text-[10px] text-emerald-600 font-bold px-8 mt-3 leading-relaxed max-w-md text-center">
                    Great job maintaining academic performance across all classes!
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
