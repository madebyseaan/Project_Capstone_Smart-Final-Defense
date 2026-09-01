import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  GraduationCap,
  LayoutGrid,
  ArrowUpRight,
  UserMinus,
  AlertTriangle,
  Loader2,
  RefreshCw,
  CheckCircle2,
  TrendingUp,
  ChevronRight,
  BarChart3,
  FileText,
  ClipboardList,
  UserCheck,
  Clock,
  Target,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { registrarApi, type RegistrarDashboard } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  AreaChart,
  Area,
} from "recharts";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

const GRADE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"];

const quickActions = [
  { name: "Student Records", icon: Users, href: "/registrar/students" },
  { name: "EOSY Finalization", icon: GraduationCap, href: "/registrar/eosy" },
  { name: "School Forms", icon: FileText, href: "/registrar/forms" },
  { name: "Alumni Records", icon: ClipboardList, href: "/registrar/alumni" },
];

const GlowTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900/95 backdrop-blur-sm text-white rounded-xl px-3 py-2 shadow-2xl border border-white/10">
      {label && <p className="text-[10px] font-medium text-white/60 mb-1">{label}</p>}
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-sm font-bold" style={{ color: entry.color || entry.payload?.fill }}>
          {entry.value?.toLocaleString()}
        </p>
      ))}
    </div>
  );
};

export default function RegistrarDashboardPage() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dashboard, setDashboard] = useState<RegistrarDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promotionData, setPromotionData] = useState<any>(null);
  const [showFailingList, setShowFailingList] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const loadDashboard = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await registrarApi.getDashboard();
      setDashboard(response.data);
      setError(null);
    } catch (err: any) {
      console.error("Failed to load registrar dashboard:", err);
      setError(err?.response?.data?.message || "Failed to load registrar dashboard");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadPromotionData = async () => {
    try {
      const res = await registrarApi.getSF6();
      setPromotionData(res.data);
    } catch {}
  };

  useEffect(() => {
    void loadDashboard(false);
    void loadPromotionData();
    const poller = window.setInterval(() => void loadDashboard(true), 30000);
    return () => window.clearInterval(poller);
  }, []);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await registrarApi.runSync();
      await loadDashboard(true);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
          <p className="text-gray-500 font-medium">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!dashboard || error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-gray-700 font-medium">{error || "Failed to load data"}</p>
          <Button onClick={() => void loadDashboard(false)} variant="outline" className="gap-2 rounded-xl">
            <RefreshCw className="w-4 h-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const { stats, sections, dataCompleteness, gradePerformance } = dashboard;

  const gradeBarData = Object.entries(stats.gradeStats).map(([grade, count]) => ({
    name: gradeLevelLabels[grade] || grade,
    count,
  }));

  const genderPieData = [
    { name: "Male", value: stats.maleCount, fill: "#3b82f6" },
    { name: "Female", value: stats.femaleCount, fill: "#ec4899" },
  ];

  const promotionBarData = promotionData?.summary
    ? [
        { name: "Promoted", count: promotionData.summary.promoted, color: "#10b981" },
        { name: "Retained", count: promotionData.summary.retained, color: "#f59e0b" },
        { name: "Dropped", count: promotionData.summary.dropped, color: "#ef4444" },
        { name: "Transferred", count: promotionData.summary.transferred, color: "#6b7280" },
      ]
    : [];

  const passingRateData = gradePerformance.bySection.map((s) => ({
    name: s.sectionName.length > 14 ? s.sectionName.slice(0, 14) + "..." : s.sectionName,
    fullName: s.sectionName,
    passingRate: s.passingRate,
    avgGrade: s.avgGrade ?? 0,
    failing: s.failingCount,
    total: s.totalStudents,
    gradeLevel: s.gradeLevel,
    failingStudents: s.failingStudents,
  }));

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Hero Gradient Card ── */}
      <div
        className="relative overflow-hidden rounded-2xl p-6 text-white"
        style={{ background: `linear-gradient(145deg, ${colors.primary}, ${colors.primary}cc)` }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 opacity-10" style={{ background: "radial-gradient(circle, white 0%, transparent 60%)" }} />
        <div className="absolute bottom-0 left-0 w-48 h-48 opacity-10" style={{ background: "radial-gradient(circle, white 0%, transparent 60%)" }} />
        <div className="absolute top-1/2 right-1/4 w-32 h-32 opacity-5" style={{ background: "radial-gradient(circle, white 0%, transparent 60%)" }} />

        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Registrar Dashboard</h1>
            <p className="text-white/70 text-sm mt-1">Student enrollment overview for {dashboard.currentSchoolYear}</p>
          </div>
          <div className="flex items-center gap-3">
            {dashboard.sync.running ? (
              <Badge className="bg-white/20 text-white border-white/20 backdrop-blur-sm">Syncing...</Badge>
            ) : dashboard.sync.status === "fresh" ? (
              <Badge className="bg-white/20 text-white border-white/20 backdrop-blur-sm">Fresh ({dashboard.sync.minutesSinceLastSync}m)</Badge>
            ) : (
              <Badge className="bg-white/20 text-white border-white/20 backdrop-blur-sm">
                {dashboard.sync.status === "never" ? "Not synced" : `Stale (${dashboard.sync.minutesSinceLastSync}m)`}
              </Badge>
            )}
            <Button
              onClick={triggerSync}
              disabled={syncing}
              className="bg-white/20 hover:bg-white/30 text-white border-white/20 backdrop-blur-sm rounded-xl font-semibold"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
              Sync
            </Button>
          </div>
        </div>

        {/* Hero mini stats */}
        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {[
            { label: "Active", value: stats.activeStudents, icon: Users },
            { label: "Sections", value: stats.totalSections, icon: LayoutGrid },
            { label: "Passing", value: `${gradePerformance.overallPassingRate}%`, icon: Target },
            { label: "Avg Grade", value: gradePerformance.overallAvgGrade, icon: BarChart3 },
          ].map((item) => (
            <div key={item.label} className="bg-white/15 backdrop-blur-sm rounded-xl p-3 border border-white/10">
              <div className="flex items-center gap-2 mb-1">
                <item.icon className="w-3.5 h-3.5 text-white/60" />
                <span className="text-[10px] font-bold text-white/60 uppercase tracking-wider">{item.label}</span>
              </div>
              <p className="text-2xl font-black stat-number">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── 5 KPI Cards with Sparklines ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "ACTIVE STUDENTS", value: stats.activeStudents, icon: Users, color: colors.primary, sparkData: [{ v: 42 }, { v: 45 }, { v: 43 }, { v: 48 }, { v: 47 }, { v: stats.activeStudents }] },
          { label: "SECTIONS", value: stats.totalSections, icon: LayoutGrid, color: "#10b981", sparkData: [{ v: 14 }, { v: 15 }, { v: 15 }, { v: 16 }, { v: 16 }, { v: stats.totalSections }] },
          { label: "MALE / FEMALE", value: `${stats.maleCount}/${stats.femaleCount}`, icon: UserCheck, color: "#3b82f6", sparkData: [{ v: stats.femaleCount }, { v: stats.maleCount }] },
          { label: "TRANSFERRED", value: stats.transferredStudents, icon: ArrowUpRight, color: "#f59e0b", sparkData: [{ v: 2 }, { v: 3 }, { v: 3 }, { v: 4 }, { v: 4 }, { v: stats.transferredStudents }], href: "/registrar/alumni?status=TRANSFERRED" },
          { label: "DROPPED", value: stats.droppedStudents, icon: UserMinus, color: "#ef4444", sparkData: [{ v: 1 }, { v: 2 }, { v: 2 }, { v: 2 }, { v: 3 }, { v: stats.droppedStudents }], href: "/registrar/alumni?status=DROPPED" },
        ].map((card) => (
          <div key={card.label} className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl p-4 shadow-lg shadow-gray-200/50 hover:shadow-xl transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 opacity-5 rounded-full -mr-6 -mt-6" style={{ backgroundColor: card.color }} />
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl text-white shadow-md group-hover:scale-110 transition-transform" style={{ backgroundColor: card.color }}>
                <card.icon className="w-4 h-4" />
              </div>
              {card.href && (
                <Link to={card.href} className="text-[10px] font-bold uppercase tracking-wider hover:underline" style={{ color: card.color }}>
                  View
                </Link>
              )}
            </div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{card.label}</p>
            <p className="text-2xl font-black text-gray-900 stat-number leading-none mt-1">{card.value}</p>
            <div className="mt-2">
              <ResponsiveContainer width="100%" height={32}>
                <AreaChart data={card.sparkData}>
                  <defs>
                    <linearGradient id={`spark-${card.label}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={card.color} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={card.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke={card.color} strokeWidth={2} fill={`url(#spark-${card.label})`} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts Row 1: Grade Distribution + Gender ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Grade Distribution */}
        <div className="lg:col-span-2 bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl p-4 shadow-lg shadow-gray-200/50">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4" style={{ color: colors.primary }} />
            <h3 className="text-sm font-bold text-gray-900">Grade Level Distribution</h3>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={gradeBarData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <defs>
                {gradeBarData.map((_, i) => (
                  <linearGradient key={i} id={`gradeGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GRADE_COLORS[i]} stopOpacity={1} />
                    <stop offset="100%" stopColor={GRADE_COLORS[i]} stopOpacity={0.6} />
                  </linearGradient>
                ))}
              </defs>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8", fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#cbd5e1" }} axisLine={false} tickLine={false} />
              <Tooltip content={<GlowTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)", radius: 8 }} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={48}>
                {gradeBarData.map((_, i) => (
                  <Cell key={i} fill={`url(#gradeGrad${i})`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Gender Donut */}
        <div className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl p-4 shadow-lg shadow-gray-200/50">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Gender Breakdown</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <Pie
                data={genderPieData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={4}
                dataKey="value"
                stroke="none"
              >
                {genderPieData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} filter="url(#glow)" />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.[0] ? (
                    <div className="bg-slate-900/95 text-white rounded-xl px-3 py-2 shadow-2xl border border-white/10">
                      <p className="text-sm font-bold" style={{ color: payload[0].payload.fill }}>
                        {payload[0].name}: {payload[0].value?.toLocaleString()}
                      </p>
                    </div>
                  ) : null
                }
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-4 mt-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-lg shadow-blue-500/30" />
              <span className="text-[11px] font-semibold text-gray-600">Male {stats.maleCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-pink-500 shadow-lg shadow-pink-500/30" />
              <span className="text-[11px] font-semibold text-gray-600">Female {stats.femaleCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Charts Row 2: Promotion + Grade Summary ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Promotion Outcomes */}
        <div className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl p-4 shadow-lg shadow-gray-200/50">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4" style={{ color: colors.primary }} />
            <h3 className="text-sm font-bold text-gray-900">Promotion Outcomes</h3>
          </div>
          {promotionBarData.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {promotionBarData.map((item) => (
                <div key={item.name} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{item.name}</p>
                    <p className="text-xl font-black stat-number text-gray-900">{item.count}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <p className="text-xs">No promotion data yet</p>
            </div>
          )}
        </div>

        {/* Grade Summary */}
        <div className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl p-4 shadow-lg shadow-gray-200/50">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4" style={{ color: colors.primary }} />
            <h3 className="text-sm font-bold text-gray-900">Grade Summary</h3>
          </div>
          <div className="flex items-center gap-6">
            {/* Big percentage */}
            <div className="text-center flex-shrink-0">
              <p
                className="text-6xl font-black stat-number leading-none"
                style={{
                  color: gradePerformance.overallPassingRate === 100 ? "#10b981"
                    : gradePerformance.overallPassingRate >= 75 ? "#84cc16"
                    : gradePerformance.overallPassingRate >= 50 ? "#f59e0b"
                    : "#ef4444",
                }}
              >
                {gradePerformance.overallPassingRate}%
              </p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Passing</p>
            </div>
            {/* Stats grid */}
            <div className="flex-1 grid grid-cols-2 gap-2.5">
              <div className="text-center p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <p className="text-2xl font-black text-emerald-600 stat-number leading-none">{gradePerformance.totalPassing}</p>
                <p className="text-[9px] font-bold text-emerald-400 uppercase mt-1">Passing</p>
              </div>
              <button
                className={`text-center p-3 rounded-xl transition-all cursor-pointer border ${
                  showFailingList ? "bg-red-100 border-red-200 ring-2 ring-red-100" : "bg-red-50 border-red-100 hover:bg-red-100"
                }`}
                onClick={() => gradePerformance.totalFailing > 0 && setShowFailingList(!showFailingList)}
              >
                <p className="text-2xl font-black text-red-500 stat-number leading-none">{gradePerformance.totalFailing}</p>
                <p className="text-[9px] font-bold text-red-400 uppercase mt-1">
                  Failing {gradePerformance.totalFailing > 0 ? (showFailingList ? "▲" : "▼") : ""}
                </p>
              </button>
              <div className="text-center p-3 rounded-xl bg-blue-50 border border-blue-100">
                <p className="text-2xl font-black text-blue-600 stat-number leading-none">{gradePerformance.overallAvgGrade}</p>
                <p className="text-[9px] font-bold text-blue-400 uppercase mt-1">Avg</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-gray-50 border border-gray-100">
                <p className="text-2xl font-black text-gray-700 stat-number leading-none">{gradePerformance.totalGraded}</p>
                <p className="text-[9px] font-bold text-gray-400 uppercase mt-1">Graded</p>
              </div>
            </div>
          </div>

          {/* Failing Students Dropdown */}
          {showFailingList && gradePerformance.failingStudents.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Students Below 75 Average</p>
                <span className="text-[10px] text-gray-400">{gradePerformance.failingStudents.length} student(s)</span>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 sticky top-0">
                      <th className="text-left font-semibold text-gray-600 px-3 py-2">Student</th>
                      <th className="text-left font-semibold text-gray-600 px-3 py-2">Section</th>
                      <th className="text-left font-semibold text-gray-600 px-3 py-2">Grade</th>
                      <th className="text-right font-semibold text-gray-600 px-3 py-2">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradePerformance.failingStudents.map((s, i) => (
                      <tr key={i} className="border-t border-gray-50 hover:bg-red-50/30">
                        <td className="px-3 py-1.5 font-medium text-gray-900">{s.studentName}</td>
                        <td className="px-3 py-1.5 text-gray-600">{s.sectionName}</td>
                        <td className="px-3 py-1.5 text-gray-600">{s.gradeLevel?.replace("GRADE_", "Grade ")}</td>
                        <td className="px-3 py-1.5 text-right font-bold text-red-500">{s.average}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section Passing Summary ── */}
      {passingRateData.length > 0 && (() => {
        const passing = passingRateData.filter((s) => s.passingRate >= 75);
        const failing = passingRateData.filter((s) => s.passingRate < 75);
        const getRateColor = (rate: number) =>
          rate === 100 ? "#10b981" : rate >= 75 ? "#84cc16" : rate >= 50 ? "#f59e0b" : "#ef4444";
        const getRateBg = (rate: number) =>
          rate === 100 ? "bg-emerald-50" : rate >= 75 ? "bg-lime-50" : rate >= 50 ? "bg-amber-50" : "bg-red-50";
        const getRateBorder = (rate: number) =>
          rate === 100 ? "border-emerald-100" : rate >= 75 ? "border-lime-100" : rate >= 50 ? "border-amber-100" : "border-red-100";
        const overallRate = Math.round((passing.length / passingRateData.length) * 100);
        return (
          <div className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl p-4 shadow-lg shadow-gray-200/50">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4" style={{ color: colors.primary }} />
                <h3 className="text-sm font-bold text-gray-900">Section Passing</h3>
              </div>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Current Term</span>
            </div>
            <div
              className="flex items-center gap-4 cursor-pointer hover:bg-gray-50/50 rounded-xl p-2 -mx-2 transition-colors"
              onClick={() => setExpandedSection(expandedSection ? null : "all")}
            >
              <div className="flex items-center gap-2">
                <span className="text-4xl font-black stat-number leading-none" style={{ color: getRateColor(overallRate) }}>{passing.length}</span>
                <span className="text-xs text-gray-400">of {passingRateData.length} passing</span>
              </div>
              <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${overallRate}%`, backgroundColor: getRateColor(overallRate) }} />
              </div>
              <span className="text-lg font-black stat-number" style={{ color: getRateColor(overallRate) }}>{overallRate}%</span>
              <span className="text-xs text-gray-400">{expandedSection ? "▲" : "▼"}</span>
            </div>

            {/* Expanded Section Breakdown */}
            {expandedSection && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5 max-h-64 overflow-y-auto">
                {passingRateData.map((s, i) => {
                  const isExpanded = expandedSection === s.fullName;
                  const rateColor = getRateColor(s.passingRate);
                  return (
                    <div key={i}>
                      <div
                        className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${getRateBg(s.passingRate)} hover:brightness-95 border ${getRateBorder(s.passingRate)}`}
                        onClick={() => setExpandedSection(isExpanded ? "all" : s.fullName)}
                      >
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: rateColor }} />
                        <span className="text-xs font-semibold text-gray-700 flex-1">{s.fullName}</span>
                        <span className="text-[10px] text-gray-400 font-medium w-6">{s.gradeLevel?.replace("GRADE_", "G")}</span>
                        <span className="text-sm font-black stat-number w-14 text-right" style={{ color: rateColor }}>{s.passingRate}%</span>
                        <span className="text-[10px] text-gray-400 w-14 text-right">{s.total} students</span>
                        {s.failingStudents.length > 0 && (
                          <span className="text-[10px] text-gray-400 w-3 text-center">{isExpanded ? "▲" : "▼"}</span>
                        )}
                        {s.failingStudents.length === 0 && <span className="w-3" />}
                      </div>

                      {/* Failing Students for this section */}
                      {isExpanded && s.failingStudents.length > 0 && (
                        <div className="ml-5 mt-1 mb-1 rounded-lg border border-red-100 bg-red-50/30 overflow-hidden">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="bg-red-50">
                                <th className="text-left font-semibold text-red-600 px-3 py-1.5">Student</th>
                                <th className="text-right font-semibold text-red-600 px-3 py-1.5">Average</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.failingStudents.map((fs, j) => (
                                <tr key={j} className="border-t border-red-100/50">
                                  <td className="px-3 py-1 text-gray-700">{fs.studentName}</td>
                                  <td className="px-3 py-1 text-right font-bold text-red-500">{fs.average}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Bottom Row: Data Quality + Quick Actions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Data Quality */}
        <div className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl p-4 shadow-lg shadow-gray-200/50">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-bold text-gray-900">Data Quality</h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 border border-amber-100">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-semibold text-gray-700">Missing LRN</span>
              </div>
              <span className="text-lg font-black text-amber-600 stat-number">{dataCompleteness.missingLrn}</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-blue-50 border border-blue-100">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs font-semibold text-gray-700">Missing Birth Date</span>
              </div>
              <span className="text-lg font-black text-blue-600 stat-number">{dataCompleteness.missingBirthDate}</span>
            </div>
            {dataCompleteness.totalIssues === 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-semibold text-emerald-700">All records complete</span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-2 bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl p-4 shadow-lg shadow-gray-200/50">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {quickActions.map((action) => (
              <Link key={action.name} to={action.href}>
                <div className="p-3 rounded-xl bg-gray-50 hover:bg-white border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all cursor-pointer group text-center">
                  <div className="p-2.5 rounded-xl bg-gray-100 text-gray-600 group-hover:bg-gray-200 transition-colors mx-auto w-fit">
                    <action.icon className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-gray-700 mt-2">{action.name}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
