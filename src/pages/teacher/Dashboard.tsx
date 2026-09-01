import { useEffect, useState } from "react";
import { useSyncStream } from "@/hooks/useSyncStream";
import { Link, useLocation } from "react-router-dom";
import {
  Users,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  Target,
  FileCheck,
  Star,
  Medal,
  Calendar,
  Sparkles,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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

function shorten(name: string, max = 14): string {
  return name.length > max ? name.slice(0, max) + "…" : name;
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
          <p className="text-slate-500 font-medium text-lg animate-pulse">Igniting your dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-[60vh] p-4">
        <Card className="max-w-md w-full border-0 shadow-2xl rounded-3xl overflow-hidden">
          <div className="h-2 bg-red-500" />
          <CardContent className="p-10 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-red-50 flex items-center justify-center text-red-500">
              <AlertTriangle className="w-10 h-10" />
            </div>
            <h3 className="font-bold text-slate-900 text-2xl mb-2">Oops! Something's wrong</h3>
            <p className="text-slate-500 mb-8">{error || "We couldn't load your dashboard data right now."}</p>
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
    <div className="space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* Grade Submission Deadline Banner */}
      {data.gradeDeadline && (
        <GradeDeadlineBanner deadline={data.gradeDeadline} />
      )}

      {/* Hero Welcome Section - Refined for "Professional Settings" */}
      <div className="relative overflow-hidden rounded-[2.5rem] bg-white border border-slate-200 p-8 md:p-12 shadow-xl shadow-slate-200/50">
        <div className="absolute top-0 right-0 w-1/3 h-full bg-slate-50/50 -skew-x-12 translate-x-1/2" />
        <div className="absolute top-0 right-1/4 w-px h-full bg-slate-100" />
        
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-10">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-6">
              <Badge variant="secondary" className="px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border"
                style={{ backgroundColor: `${colors.primary}15`, color: colors.primary, borderColor: `${colors.primary}30` }}>
                <Target className="w-3 h-3 mr-2" />
                {data.currentTerm === 'T1' ? 'Term 1' : 
                 data.currentTerm === 'T2' ? 'Term 2' : 
                 data.currentTerm === 'T3' ? 'Term 3' : 
                 'Teacher Portal v2.0'}
              </Badge>
              <div className="h-4 w-px bg-slate-200" />
              <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                <Calendar className="w-3 h-3" />
                S.Y. {data.classAssignments[0]?.schoolYear || ""}
              </div>
            </div>
            
            <h1 className="text-4xl md:text-5xl font-black text-slate-900 leading-[1.1] tracking-tight">
              Good day, <br />
              <span className="font-black" style={{ color: colors.primary }}>
                Teacher {data.teacher.name.split(',')[0]}
              </span>
            </h1>
            
            <p className="text-slate-500 text-lg mt-6 max-w-lg leading-relaxed font-medium">
              You're currently managing <span className="text-slate-900 font-bold underline decoration-indigo-200 decoration-4 underline-offset-4">{data.stats.totalStudents} students</span> across <span className="text-slate-900 font-bold underline decoration-emerald-200 decoration-4 underline-offset-4">{data.stats.totalClasses} classes</span>.
            </p>
            
            <div className="flex flex-wrap items-center gap-4 mt-10">
              <Link to="/teacher/advisory">
                <Button className="h-14 px-8 rounded-2xl text-white shadow-xl border-0 transition-all active:scale-95 group font-bold"
                  style={{ backgroundColor: colors.primary, boxShadow: `0 20px 25px -5px ${colors.primary}40` }}>
                  <Users className="w-5 h-5 mr-3 group-hover:rotate-12 transition-transform" />
                  My Advisory
                </Button>
              </Link>
              <Link to="/teacher/classes">
                <Button variant="outline" className="h-14 px-8 rounded-2xl bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all active:scale-95 font-bold">
                  <BookOpen className="w-5 h-5 mr-3" />
                  Class Records
                </Button>
              </Link>
            </div>
          </div>

          <div className="hidden lg:flex flex-col gap-3 min-w-[280px] max-w-[320px]">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between group hover:border-indigo-200 transition-all">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Overall Passing</p>
                <p className="text-3xl font-black text-slate-900 leading-none">{stats?.summary.overallPassingRate.toFixed(0)}%</p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-white shadow-sm flex items-center justify-center group-hover:scale-110 transition-all">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between group hover:border-indigo-200 transition-all">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Grade Submission</p>
                <p className="text-3xl font-black text-slate-900 leading-none">{stats?.summary.gradeSubmissionRate.toFixed(0)}%</p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-white shadow-sm flex items-center justify-center group-hover:scale-110 transition-all">
                <FileCheck className="w-5 h-5 text-indigo-500" />
              </div>
            </div>
            {/* Today's Classes — dynamic status */}
            {classInfo.status === "empty" ? (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Today&apos;s Classes</p>
                  <p className="text-sm font-bold text-slate-400">No classes today</p>
                </div>
                <div className="w-11 h-11 rounded-xl bg-white shadow-sm flex items-center justify-center">
                  <Clock className="w-5 h-5 text-slate-300" />
                </div>
              </div>
            ) : classInfo.status === "done" ? (
              <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">All Done</p>
                  <p className="text-sm font-black text-emerald-700">Great job today!</p>
                </div>
                <div className="w-11 h-11 rounded-xl bg-white shadow-sm flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>
              </div>
            ) : classInfo.status === "before" ? (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between group hover:border-indigo-200 transition-all">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Upcoming</p>
                  <p className="text-sm font-black text-slate-800 leading-tight">{shorten(classInfo.next.subject.name)}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">{classInfo.next.section.name} &middot; {fmtTime12h(classInfo.next.startTime)}</p>
                </div>
                <div className="w-11 h-11 rounded-xl bg-white shadow-sm flex items-center justify-center group-hover:scale-110 transition-all">
                  <Clock className="w-5 h-5 text-amber-500" />
                </div>
              </div>
            ) : classInfo.status === "active" ? (
              <div className="p-4 rounded-2xl border-2 bg-white flex items-center justify-between" style={{ borderColor: colors.primary + "60" }}>
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: colors.primary }} />
                      <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: colors.primary }} />
                    </span>
                    <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>Now Teaching</p>
                  </div>
                  <p className="text-sm font-black text-slate-800 leading-tight">{shorten(classInfo.current.subject.name)}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">{classInfo.current.section.name} &middot; {fmtTime12h(classInfo.current.startTime)}–{fmtTime12h(classInfo.current.endTime)}</p>
                </div>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: colors.primary + "15" }}>
                  <BookOpen className="w-5 h-5" style={{ color: colors.primary }} />
                </div>
              </div>
            ) : (
              /* next */
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between group hover:border-indigo-200 transition-all">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Next Class</p>
                  <p className="text-sm font-black text-slate-800 leading-tight">{shorten(classInfo.next.subject.name)}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">{classInfo.next.section.name} &middot; {fmtTime12h(classInfo.next.startTime)}</p>
                </div>
                <div className="w-11 h-11 rounded-xl bg-white shadow-sm flex items-center justify-center group-hover:scale-110 transition-all">
                  <Clock className="w-5 h-5 text-amber-500" />
                </div>
              </div>
            )}
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
            bg: "bg-indigo-50", fg: "text-indigo-600",
            desc: "Currently enrolled"
          },
          { 
            label: "Handled Classes", 
            value: data.stats.totalClasses, 
            icon: BookOpen, 
            bg: "bg-emerald-50", fg: "text-emerald-600",
            desc: "Teaching assignments"
          },
          { 
            label: "Critical Cases", 
            value: stats?.summary.studentsAtRiskCount || 0, 
            icon: AlertTriangle, 
            bg: "bg-rose-50", fg: "text-rose-600",
            desc: "Requires immediate attention"
          },
          { 
            label: "Graded Items", 
            value: stats?.summary.totalGraded || 0, 
            icon: FileCheck, 
            bg: "bg-amber-50", fg: "text-amber-600",
            desc: "Successful submissions"
          },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 shadow-lg shadow-slate-200/50 rounded-3xl overflow-hidden group hover:-translate-y-1 transition-all duration-300 bg-white">
            <CardContent className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className={`p-3 rounded-2xl ${stat.bg} ${stat.fg} group-hover:scale-110 transition-transform`}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
                  <p className="text-2xl font-black text-slate-900 mt-0.5">{stat.value}</p>
                </div>
              </div>
              <p className="text-[10px] font-medium text-slate-400 pl-1">{stat.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {(data.archivedClassesCount || stats?.archivedClassesCount || 0) > 0 && (
        <Card className="border-0 shadow-2xl shadow-rose-100/40 rounded-[2.5rem] overflow-hidden bg-rose-50/70 border border-rose-100">
          <CardContent className="p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-rose-600">Atlas removal detected</p>
              <h3 className="text-lg font-black text-slate-900 mt-1">{data.archivedClassesCount || stats?.archivedClassesCount || 0} subject assignment(s) were removed from the current Atlas load</h3>
              <p className="text-sm text-slate-600 font-medium mt-1">SMART keeps the grade history, but these assignments are hidden from active dashboard counts. Contact the EnrollPro/Atlas admin if this was not intended.</p>
            </div>
            <Badge className="bg-rose-600 text-white font-black px-4 py-2 rounded-xl border-0 shadow-lg shadow-rose-300/50 text-sm self-start md:self-center">
              CONTACT ADMIN
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* ── Performance Mastery ── Full Width */}
      <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden flex flex-col bg-white">
          <CardHeader className="p-8 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-slate-900 text-white">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">Performance Mastery</h2>
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1">Distribution of student ratings</p>
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
          <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white">
            <CardHeader className="p-8 pb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-slate-100 text-slate-900">
                  <FileCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">Grading Status</h2>
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1">Submission progress per class</p>
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
                              <p className="text-sm font-black text-slate-900 leading-tight">{classStat.sectionName}</p>
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">{classStat.subjectName}</p>
                            </div>
                            <span className="text-xl font-black" style={{ color: barColor }}>{percentage}%</span>
                          </div>
                          <div className="h-3 bg-white rounded-full overflow-hidden shadow-inner">
                            <div
                              className="h-full rounded-full transition-all duration-1000 ease-out"
                              style={{ width: `${percentage}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <div className="flex justify-between mt-3">
                            <p className="text-[9px] font-bold text-slate-400">{classStat.gradedCount} graded</p>
                            <p className="text-[9px] font-bold text-slate-400">{classStat.totalStudents} total</p>
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
                        className="w-full h-12 rounded-2xl border-dashed border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 font-black text-[10px] tracking-[0.2em] uppercase transition-all"
                      >
                        Show {remaining} more {remaining === 1 ? 'class' : 'classes'}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-16 text-center text-slate-300">
                  <FileCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-black text-sm uppercase tracking-widest">No class records found</p>
                </div>
              )}
              <div className="mt-8">
                <Link to="/teacher/classes">
                  <Button className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white shadow-xl shadow-slate-200 transition-all font-black text-[10px] tracking-[0.2em] uppercase">
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
          <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white">
            <CardHeader className="p-8 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                  <Medal className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">Academic Honors</h2>
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1">Leading advisory achievements</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                {advisoryHonors?.hasAdvisory && (
                  <Badge variant="secondary" className="bg-slate-50 text-slate-400 border-slate-100 font-black px-4 py-2 rounded-xl text-[10px] tracking-widest uppercase">
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
                      <div className="py-20 text-center text-slate-300 bg-slate-50 rounded-[2rem] mt-4 border-2 border-dashed border-slate-100">
                        <Star className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p className="font-black text-sm uppercase tracking-widest">No advisory honors yet</p>
                        <p className="text-[10px] font-bold mt-2">Students with grades of 85 and above will appear here.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="overflow-hidden rounded-3xl border border-slate-100 mt-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50/50 border-b border-slate-100">
                            <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Student</th>
                            <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Section</th>
                            <th className="px-6 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Grade</th>
                            <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {allHonors.map((student, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 transition-all">
                              <td className="px-6 py-5">
                                <div className="flex items-center gap-3">
                                  <Avatar className="w-9 h-9 border-2 border-white shadow-sm">
                                    <AvatarFallback className="font-black text-xs text-white" style={{ backgroundColor: colors.primary }}>
                                      {student.name.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="font-black text-slate-900 text-sm tracking-tight">{student.name}</span>
                                </div>
                              </td>
                              <td className="px-6 py-5 text-slate-500 font-bold text-xs">{student.class}</td>
                              <td className="px-6 py-5 text-center">
                                <span className="font-black text-xs px-3 py-1.5 rounded-xl" style={{ color: colors.primary, backgroundColor: `${colors.primary}15` }}>
                                  {typeof student.grade === 'number' ? student.grade.toFixed(2) : student.grade}
                                </span>
                              </td>
                              <td className="px-6 py-5 text-right">
                                <Badge className="bg-emerald-500 text-white border-0 text-[9px] font-black uppercase px-3 py-1 rounded-lg shadow-lg shadow-emerald-500/20">
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
          <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white border-t-[8px] border-t-rose-500">
            <CardHeader className="p-8 pb-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-rose-50 text-rose-500">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900">Students Needing Attention</h2>
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1">Immediate intervention required</p>
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

                  <Badge className="bg-rose-500 text-white font-black px-4 py-2 rounded-xl border-0 shadow-lg shadow-rose-500/30 text-sm">
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
                            <p className="text-sm font-black text-slate-900 truncate">{student.name}</p>
                            <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5 truncate">{student.class}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-rose-100">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Grade</p>
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-black text-rose-600 leading-none">
                              {typeof student.grade === 'number' ? student.grade.toFixed(2) : student.grade}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg"
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
                <div className="py-24 flex flex-col items-center justify-center text-center bg-emerald-50/50 rounded-[2.5rem] border-2 border-dashed border-emerald-100">
                  <CheckCircle2 className="w-16 h-16 mb-4 text-emerald-400" />
                  <p className="font-black text-emerald-800 text-lg uppercase tracking-widest">All students passed!</p>
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
