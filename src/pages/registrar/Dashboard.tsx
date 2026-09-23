import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  GraduationCap,
  LayoutGrid,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  FileText,
  ClipboardList,
  UserCheck,
  Clock,
  Target,
  ArrowLeftRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { registrarApi, type RegistrarDashboard } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { SyncProgressModal } from "@/components/common/SyncProgressModal";
import RolloverReadinessCard from "./components/RolloverReadinessCard";
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

const GRADE_ORDER = ["GRADE_7", "GRADE_8", "GRADE_9", "GRADE_10"] as const;

/**
 * Area sparkline for a real series (e.g. active enrollment per school year).
 * Only rendered with 2+ points — a one-point "trend" is not a trend.
 */
function AreaSparkline({
  id,
  series,
  color,
  height = 36,
}: {
  id: string;
  series: { label: string; count: number }[];
  color: string;
  height?: number;
}) {
  if (series.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <div className="bg-popover text-popover-foreground rounded-lg px-2 py-1 shadow-lg border border-border">
                <p className="text-[10px] text-muted-foreground">{payload[0].payload.label}</p>
                <p className="text-xs font-bold" style={{ color }}>
                  {payload[0].value?.toLocaleString()} enrolled
                </p>
              </div>
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${id})`}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bar breakdown — ranks categories (which grade has the fewest sections). */
function BarBreakdown({
  items,
  color,
  labelWidthClass = "w-7",
}: {
  items: { label: string; count: number; color?: string; title?: string }[];
  color: string;
  labelWidthClass?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div
      className="space-y-1"
      role="img"
      aria-label={items.map((i) => `${i.title ?? i.label}: ${i.count}`).join(", ")}
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2" title={item.title ?? `${item.label}: ${item.count}`}>
          <span className={`${labelWidthClass} text-[9px] font-bold uppercase text-muted-foreground`}>{item.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(item.count / max) * 100}%`, backgroundColor: item.color ?? color }}
            />
          </div>
          <span className="w-4 text-right text-[10px] font-bold tabular-nums text-foreground">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

/** Single stacked bar — a ratio, not a trend. */
function GenderSplitBar({ male, female }: { male: number; female: number }) {
  const total = male + female;
  if (total === 0) return null;
  const malePct = Math.round((male / total) * 100);
  return (
    <div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Gender split: ${malePct}% male (${male}), ${100 - malePct}% female (${female})`}
      >
        <div style={{ width: `${malePct}%`, backgroundColor: "#3b82f6" }} />
        <div style={{ width: `${100 - malePct}%`, backgroundColor: "#ec4899" }} />
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold text-muted-foreground">
        <span>{malePct}% M · {male}</span>
        <span>{100 - malePct}% F · {female}</span>
      </div>
    </div>
  );
}

/** Discrete counts over time — bars, not a continuous line. */
function WeeklyBars({ items, color }: { items: { label: string; count: number }[]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div
      className="flex h-9 items-end gap-1"
      role="img"
      aria-label={`Transferees per week: ${items.map((i) => `${i.label} ${i.count}`).join(", ")}`}
    >
      {items.map((item, i) => (
        <div
          key={`${item.label}-${i}`}
          className="flex h-full flex-1 items-end justify-center"
          title={`Week of ${item.label}: ${item.count}`}
        >
          <div
            className="w-full max-w-[22px] rounded-t transition-all"
            style={{ height: `${Math.max(3, (item.count / max) * 100)}%`, backgroundColor: color }}
          />
        </div>
      ))}
    </div>
  );
}

/** Big-number metric tile used inside the Learner Movement panel. */
function MovementMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="text-3xl font-bold leading-none stat-number" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

/**
 * Learner Movement — inflow vs outflow. Kept full-width because it carries the
 * most information: three counts, net movement, drop-out rate, weekly arrivals,
 * and the document gap.
 */
function LearnerMovementPanel({
  inCount,
  outCount,
  dropped,
  dropRate,
  weekly,
  missingDocs,
  schoolYear,
}: {
  inCount: number;
  outCount: number;
  dropped: number;
  dropRate: number;
  weekly: { label: string; count: number }[];
  missingDocs: number;
  schoolYear: string;
}) {
  const totalOut = outCount + dropped;
  const net = inCount - totalOut;

  return (
    <div className="mb-6 rounded-2xl border border-border/40 bg-card/70 p-4 shadow-lg shadow-muted/50 backdrop-blur-xl">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-xl p-2 text-primary-foreground shadow-md" style={{ backgroundColor: "#8b5cf6" }}>
            <ArrowLeftRight className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-foreground">Learner Movement</h3>
            <p className="text-[11px] text-muted-foreground">Transferred in / out · SY {schoolYear}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {missingDocs > 0 && (
            <Link to="/registrar/transferees?incomplete=1" title="Show learners with missing documents">
              <Badge
                variant="outline"
                className="cursor-pointer rounded-full border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100"
              >
                {missingDocs} Missing SF10 →
              </Badge>
            </Link>
          )}
          <Link
            to="/registrar/transferees"
            className="text-[10px] font-bold uppercase tracking-wider hover:underline"
            style={{ color: "#8b5cf6" }}
          >
            View
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MovementMetric label="Transferred in" value={inCount} color="#8b5cf6" />
        <MovementMetric label="Transferred out" value={outCount} color="#f59e0b" />
        <MovementMetric label="Dropped" value={dropped} color="#ef4444" />
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Arrivals by week
          </p>
          {weekly.length > 0 ? (
            <WeeklyBars items={weekly} color="#8b5cf6" />
          ) : (
            <p className="pt-2 text-[11px] text-muted-foreground">No arrivals recorded</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
        <span>
          Net movement{" "}
          <span className="font-bold text-foreground tabular-nums">
            {net >= 0 ? "+" : ""}
            {net}
          </span>
        </span>
        <span>
          Total out <span className="font-bold text-foreground tabular-nums">{totalOut}</span>
        </span>
        <span>
          Drop-out rate <span className="font-bold text-foreground tabular-nums">{dropRate}%</span>
        </span>
      </div>
    </div>
  );
}

const quickActions = [
  { name: "Student Records", icon: Users, href: "/registrar/students" },
  { name: "EOSY Finalization", icon: GraduationCap, href: "/registrar/eosy" },
  { name: "School Forms", icon: FileText, href: "/registrar/forms" },
  { name: "Alumni Records", icon: ClipboardList, href: "/registrar/alumni" },
];

interface GlowTooltipProps {
  active?: boolean;
  payload?: Array<{ color?: string; value?: number; payload?: { fill?: string } }>;
  label?: string;
}

const GlowTooltip = ({ active, payload, label }: GlowTooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-xl px-3 py-2 shadow-lg border border-border">
      {label && <p className="text-[10px] font-medium text-muted-foreground mb-1">{label}</p>}
      {payload.map((entry, i) => (
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
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [syncError, setSyncError] = useState<string | undefined>();
  const [dashboard, setDashboard] = useState<RegistrarDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promotionData, setPromotionData] = useState<null | { schoolYear?: string; summary?: { promoted: number; retained: number; dropped: number; transferred: number; noGrades?: number; gradedStudents?: number } }>(null);
  const [showFailingList, setShowFailingList] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const loadDashboard = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await registrarApi.getDashboard();
      setDashboard(response.data);
      setError(null);
    } catch (err: unknown) {
      console.error("Failed to load registrar dashboard:", err);
      const message = err instanceof Error ? err.message : "Failed to load registrar dashboard";
      setError(message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadPromotionData = async () => {
    try {
      const res = await registrarApi.getSF6();
      setPromotionData(res.data);
    } catch { /* intentionally empty */ }
  };

  useEffect(() => {
    void loadDashboard(false);
    void loadPromotionData();
    const poller = window.setInterval(() => void loadDashboard(true), 30000);
    return () => window.clearInterval(poller);
  }, []);

  const triggerSync = async () => {
    setSyncModalOpen(true);
    setSyncStatus("syncing");
    setSyncError(undefined);
    try {
      await registrarApi.runSync();
      setSyncStatus("success");
      await loadDashboard(true);
    } catch {
      setSyncStatus("error");
      setSyncError("Failed to sync with EnrollPro. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl p-6 bg-muted/30 h-40" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-2xl p-4 bg-muted/30 h-32 animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl bg-muted/30 h-64 animate-pulse" />
          <div className="rounded-2xl bg-muted/30 h-64 animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-muted/30 h-48 animate-pulse" />
          <div className="rounded-2xl bg-muted/30 h-48 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!dashboard || error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <p className="text-foreground font-medium">{error || "Failed to load data"}</p>
          <Button onClick={() => void loadDashboard(false)} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const { stats, dataCompleteness, gradePerformance } = dashboard;

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
        ...(promotionData.summary.noGrades
          ? [{ name: "Pending (no grades)", count: promotionData.summary.noGrades, color: "#94a3b8" }]
          : []),
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

  // ── KPI card data (real series from the dashboard payload) ──
  const sectionsByGrade = GRADE_ORDER.map((grade) => ({
    label: grade.replace("GRADE_", "G"),
    count: dashboard.sections.filter((s) => s.gradeLevel === grade).length,
  }));
  const enrollmentTrend = dashboard.enrollmentTrend ?? [];
  const transfereeWeekly = dashboard.transfereeWeekly ?? [];
  const genderTotal = stats.maleCount + stats.femaleCount;
  const dropCohort = stats.activeStudents + stats.droppedStudents + stats.transferredStudents;
  const dropRate = dropCohort > 0 ? Math.round((stats.droppedStudents / dropCohort) * 100) : 0;
  const incompleteCount = stats.incompleteTransferees ?? 0;

  const kpiCards = [
    {
      label: "ACTIVE STUDENTS",
      value: stats.activeStudents,
      icon: Users,
      color: colors.primary,
      subtitle: "Official DepEd LIS Enrolled",
      chart: { kind: "area" as const, id: "spark-active-students", series: enrollmentTrend },
    },
    {
      label: "SECTIONS",
      value: stats.totalSections,
      icon: LayoutGrid,
      color: "#10b981",
      subtitle: "Across Grade 7 to Grade 10",
      chart: { kind: "bars" as const, items: sectionsByGrade },
    },
    {
      label: "MALE / FEMALE",
      value: `${stats.maleCount}/${stats.femaleCount}`,
      icon: UserCheck,
      color: "#3b82f6",
      subtitle:
        genderTotal > 0
          ? `${Math.round((stats.maleCount / genderTotal) * 100)}% Male \u2022 ${Math.round((stats.femaleCount / genderTotal) * 100)}% Female parity`
          : "No enrollment data",
      chart: { kind: "gender" as const, male: stats.maleCount, female: stats.femaleCount },
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── Hero Gradient Card ── */}
      <div
        className="relative overflow-hidden rounded-2xl p-6 text-white animate-in fade-in slide-in-from-bottom-1 duration-300"
        style={{ backgroundColor: colors.primary }}
      >
        <div className="relative">
          <PageHeader
            title="Registrar Dashboard"
            description={`Student enrollment overview for ${dashboard.currentSchoolYear}`}
            className="text-white [&_h1]:!text-white [&_p]:!text-white/80"
            actions={
              <>
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
                  disabled={syncStatus === "syncing"}
                  className="bg-white/20 hover:bg-white/30 text-white border-white/20 backdrop-blur-sm font-semibold"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Sync
                </Button>
              </>
            }
          />
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
                <item.icon className="w-3.5 h-3.5 text-white/80" />
                <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">{item.label}</span>
              </div>
              <p className="text-2xl font-bold stat-number text-white">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* School Year Readiness */}
      <RolloverReadinessCard />

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {kpiCards.map((card, idx) => (
          <div key={card.label} className="border border-slate-200/60 rounded-2xl bg-card/70 backdrop-blur-xl p-4 shadow-md shadow-slate-200/40 hover:shadow-xl transition-all group relative overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-300" style={{ animationDelay: `${(idx + 1) * 50}ms` }}>
            <div className="absolute top-0 right-0 w-20 h-20 opacity-5 rounded-full -mr-6 -mt-6" style={{ backgroundColor: card.color }} />
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl text-primary-foreground shadow-md group-hover:scale-110 transition-transform" style={{ backgroundColor: card.color }}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{card.label}</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-2xl font-bold text-foreground stat-number leading-none">{card.value}</p>
            </div>
            <p className="text-[11px] mt-1 text-muted-foreground">{card.subtitle}</p>
            <div className="mt-2">
              {card.chart.kind === "area" && (
                <AreaSparkline id={card.chart.id} series={card.chart.series} color={card.color} />
              )}
              {card.chart.kind === "bars" && (
                <BarBreakdown items={card.chart.items} color={card.color} />
              )}
              {card.chart.kind === "gender" && (
                <GenderSplitBar male={card.chart.male} female={card.chart.female} />
              )}
            </div>
          </div>
        ))}
      </div>

      <LearnerMovementPanel
        inCount={stats.transfereeStudents ?? 0}
        outCount={stats.transferredStudents}
        dropped={stats.droppedStudents}
        dropRate={dropRate}
        weekly={transfereeWeekly}
        missingDocs={incompleteCount}
        schoolYear={dashboard.currentSchoolYear}
      />

      {/* ── Charts Row 1: Grade Distribution + Gender ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Grade Distribution */}
        <div className="lg:col-span-2 bg-card/70 backdrop-blur-xl border border-border/40 rounded-2xl p-4 shadow-lg shadow-muted/50">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4" style={{ color: colors.primary }} />
            <h3 className="text-sm font-bold text-foreground">Grade Level Distribution</h3>
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
        <div className="bg-card/70 backdrop-blur-xl border border-border/40 rounded-2xl p-4 shadow-lg shadow-muted/50">
          <h3 className="text-sm font-bold text-foreground mb-3">Gender Breakdown</h3>
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
                    <div className="bg-popover text-popover-foreground rounded-xl px-3 py-2 shadow-lg border border-border">
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
              <span className="text-[11px] font-semibold text-muted-foreground">Male {stats.maleCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-pink-500 shadow-lg shadow-pink-500/30" />
              <span className="text-[11px] font-semibold text-muted-foreground">Female {stats.femaleCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Charts Row 2: Promotion + Grade Summary ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Promotion Outcomes */}
        <div className="bg-card/70 backdrop-blur-xl border border-border/40 rounded-2xl p-4 shadow-lg shadow-muted/50">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4" style={{ color: colors.primary }} />
            <h3 className="text-sm font-bold text-foreground">Promotion Outcomes</h3>
          </div>
          {promotionBarData.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {promotionBarData.map((item) => (
                  <div key={item.name} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/50">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <div>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{item.name}</p>
                      <p className="text-xl font-bold stat-number text-foreground">{item.count}</p>
                    </div>
                  </div>
                ))}
              </div>
              {!!promotionData?.summary?.noGrades && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {promotionData.summary.noGrades} learner(s) have no grades encoded for{" "}
                  {promotionData.schoolYear ?? "this school year"} yet — they are pending, not retained.
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <p className="text-xs">No promotion data yet</p>
            </div>
          )}
        </div>

        {/* Grade Summary */}
        <div className="bg-card/70 backdrop-blur-xl border border-border/40 rounded-2xl p-4 shadow-lg shadow-muted/50">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4" style={{ color: colors.primary }} />
            <h3 className="text-sm font-bold text-foreground">Grade Summary</h3>
          </div>
          {gradePerformance.totalGraded === 0 ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                No grades encoded for the current term yet — passing rates and averages will appear once
                teachers submit grades.
              </p>
            </div>
          ) : (
          <div className="flex items-center gap-6">
            {/* Big percentage */}
            <div className="text-center flex-shrink-0">
              <p
                className="text-6xl font-bold stat-number leading-none"
                style={{
                  color: gradePerformance.overallPassingRate === 100 ? "var(--color-emerald-500, #10b981)"
                    : gradePerformance.overallPassingRate >= 75 ? "var(--color-lime-500, #84cc16)"
                    : gradePerformance.overallPassingRate >= 50 ? "var(--color-amber-500, #f59e0b)"
                    : "var(--color-red-500, #ef4444)",
                }}
              >
                {gradePerformance.overallPassingRate}%
              </p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-1">Passing</p>
            </div>
            {/* Stats grid */}
            <div className="flex-1 grid grid-cols-2 gap-2.5">
              <div className="text-center p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <p className="text-2xl font-bold text-emerald-600 stat-number leading-none">{gradePerformance.totalPassing}</p>
                <p className="text-[9px] font-bold text-emerald-400 uppercase mt-1">Passing</p>
              </div>
              <button
                className={`text-center p-3 rounded-xl transition-all cursor-pointer border ${
                  showFailingList ? "bg-red-100 border-red-200 ring-2 ring-red-100" : "bg-red-50 border-red-100 hover:bg-red-100"
                }`}
                onClick={() => gradePerformance.totalFailing > 0 && setShowFailingList(!showFailingList)}
              >
                <p className="text-2xl font-bold text-red-500 stat-number leading-none">{gradePerformance.totalFailing}</p>
                <p className="text-[9px] font-bold text-red-400 uppercase mt-1">
                  Failing {gradePerformance.totalFailing > 0 ? (showFailingList ? "▲" : "▼") : ""}
                </p>
              </button>
              <div className="text-center p-3 rounded-xl bg-blue-50 border border-blue-100">
                <p className="text-2xl font-bold text-blue-600 stat-number leading-none">{gradePerformance.overallAvgGrade}</p>
                <p className="text-[9px] font-bold text-blue-400 uppercase mt-1">Avg</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-muted/50 border border-border">
                <p className="text-2xl font-bold text-foreground stat-number leading-none">{gradePerformance.totalGraded}</p>
                <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1">Graded</p>
              </div>
            </div>
          </div>
          )}

          {/* Failing Students Dropdown */}
          {showFailingList && gradePerformance.failingStudents.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Students Below 75 Average</p>
                <span className="text-[10px] text-muted-foreground">{gradePerformance.failingStudents.length} student(s)</span>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 sticky top-0">
                      <th className="text-left font-semibold text-muted-foreground px-3 py-2">Student</th>
                      <th className="text-left font-semibold text-muted-foreground px-3 py-2">Section</th>
                      <th className="text-left font-semibold text-muted-foreground px-3 py-2">Grade</th>
                      <th className="text-right font-semibold text-muted-foreground px-3 py-2">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradePerformance.failingStudents.map((s, i) => (
                      <tr key={i} className="border-t border-border/30 hover:bg-red-50/30">
                        <td className="px-3 py-1.5 font-medium text-foreground">{s.studentName}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{s.sectionName}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{s.gradeLevel?.replace("GRADE_", "Grade ")}</td>
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
        const getRateColor = (rate: number) =>
          rate === 100 ? "var(--color-emerald-500, #10b981)" : rate >= 75 ? "var(--color-lime-500, #84cc16)" : rate >= 50 ? "var(--color-amber-500, #f59e0b)" : "var(--color-red-500, #ef4444)";
        const getRateBg = (rate: number) =>
          rate === 100 ? "bg-emerald-50" : rate >= 75 ? "bg-lime-50" : rate >= 50 ? "bg-amber-50" : "bg-red-50";
        const getRateBorder = (rate: number) =>
          rate === 100 ? "border-emerald-100" : rate >= 75 ? "border-lime-100" : rate >= 50 ? "border-amber-100" : "border-red-100";
        const overallRate = Math.round((passing.length / passingRateData.length) * 100);
        return (
          <div className="bg-card/70 backdrop-blur-xl border border-border/40 rounded-2xl p-4 shadow-lg shadow-muted/50">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4" style={{ color: colors.primary }} />
                <h3 className="text-sm font-bold text-foreground">Section Passing</h3>
              </div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Current Term</span>
            </div>
            <div
              className="flex items-center gap-4 cursor-pointer hover:bg-muted/50 rounded-xl p-2 -mx-2 transition-colors"
              onClick={() => setExpandedSection(expandedSection ? null : "all")}
            >
              <div className="flex items-center gap-2">
                <span className="text-4xl font-bold stat-number leading-none" style={{ color: getRateColor(overallRate) }}>{passing.length}</span>
                <span className="text-xs text-muted-foreground">of {passingRateData.length} passing</span>
              </div>
              <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${overallRate}%`, backgroundColor: getRateColor(overallRate) }} />
              </div>
              <span className="text-lg font-bold stat-number" style={{ color: getRateColor(overallRate) }}>{overallRate}%</span>
              <span className="text-xs text-muted-foreground">{expandedSection ? "▲" : "▼"}</span>
            </div>

            {/* Expanded Section Breakdown */}
            {expandedSection && (
              <div className="mt-3 pt-3 border-t border-border space-y-1.5 max-h-64 overflow-y-auto">
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
                        <span className="text-xs font-semibold text-foreground flex-1">{s.fullName}</span>
                        <span className="text-[10px] text-muted-foreground font-medium w-6">{s.gradeLevel?.replace("GRADE_", "G")}</span>
                        <span className="text-sm font-bold stat-number w-14 text-right" style={{ color: rateColor }}>{s.passingRate}%</span>
                        <span className="text-[10px] text-muted-foreground w-14 text-right">{s.total} students</span>
                        {s.failingStudents.length > 0 && (
                          <span className="text-[10px] text-muted-foreground w-3 text-center">{isExpanded ? "▲" : "▼"}</span>
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
                                  <td className="px-3 py-1 text-foreground">{fs.studentName}</td>
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
        <div className="bg-card/70 backdrop-blur-xl border border-border/40 rounded-2xl p-4 shadow-lg shadow-muted/50">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-bold text-foreground">Data Quality</h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 border border-amber-100">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-semibold text-foreground">Missing LRN</span>
              </div>
              <span className="text-lg font-bold text-amber-600 stat-number">{dataCompleteness.missingLrn}</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-blue-50 border border-blue-100">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs font-semibold text-foreground">Missing Birth Date</span>
              </div>
              <span className="text-lg font-bold text-blue-600 stat-number">{dataCompleteness.missingBirthDate}</span>
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
        <div className="lg:col-span-2 bg-card/70 backdrop-blur-xl border border-border/40 rounded-2xl p-4 shadow-lg shadow-muted/50">
          <h3 className="text-sm font-bold text-foreground mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {quickActions.map((action, idx) => (
              <Link key={action.name} to={action.href}>
                <div className="p-3 rounded-xl bg-muted/50 hover:bg-card border border-border hover:border-border hover:shadow-md transition-all cursor-pointer group text-center animate-in fade-in slide-in-from-bottom-1 duration-300" style={{ animationDelay: `${idx * 50}ms` }}>
                  <div className="p-2.5 rounded-xl bg-muted text-muted-foreground group-hover:bg-muted/80 transition-colors mx-auto w-fit">
                    <action.icon className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-foreground mt-2">{action.name}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <SyncProgressModal isOpen={syncModalOpen} onClose={() => { setSyncModalOpen(false); setSyncStatus("idle"); }} status={syncStatus} errorMessage={syncError} />
    </div>
  );
}
