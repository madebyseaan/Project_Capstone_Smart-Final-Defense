import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  GraduationCap,
  UserCheck,
  Activity,
  ChevronRight,
  Clock,
  CheckCircle2,
  Edit3,
  Trash2,
  Plus,
  LogIn,
  LogOut,
  Settings,
  Server,
  Lock,
  LockOpen,
  WifiOff,
  ClipboardList,
  Calendar,
  FileText,
  AlertTriangle,
  BarChart3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { adminApi } from "@/lib/api";
import type { AdminDashboard as AdminDashboardData, AdminAuditLog } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageError } from "@/components/layout/PageError";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const quickActions = [
  { name: "Manage Users", icon: Users, href: "/admin/users" },
  { name: "Edit Requests", icon: FileText, href: "/admin/edit-requests" },
  { name: "Assignments", icon: ClipboardList, href: "/admin/assignments" },
  { name: "School Years", icon: Calendar, href: "/admin/school-years" },
  { name: "Grading Config", icon: Settings, href: "/admin/grading" },
  { name: "System Health", icon: Activity, href: "/admin/health" },
  { name: "Audit Logs", icon: Clock, href: "/admin/logs" },
];

const getActionIcon = (action: AdminAuditLog["action"]) => {
  switch (action) {
    case "create": return <Plus className="w-3.5 h-3.5" />;
    case "update": return <Edit3 className="w-3.5 h-3.5" />;
    case "delete": return <Trash2 className="w-3.5 h-3.5" />;
    case "login": return <LogIn className="w-3.5 h-3.5" />;
    case "logout": return <LogOut className="w-3.5 h-3.5" />;
    case "config": return <Settings className="w-3.5 h-3.5" />;
  }
};

const getSeverityBadge = (severity: AdminAuditLog["severity"]) => {
  switch (severity) {
    case "info": return <Badge className="bg-muted text-muted-foreground border-0 text-xs">Info</Badge>;
    case "warning": return <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">Warning</Badge>;
    case "critical": return <Badge className="bg-red-100 text-red-700 border-0 text-xs">Critical</Badge>;
  }
};

function relativeMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

interface GlowTooltipProps {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { date?: string } }>;
  label?: string;
}

const LoginTooltip = ({ active, payload, label }: GlowTooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-xl px-3 py-2 shadow-lg border border-border">
      <p className="text-[10px] font-medium text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-bold">{payload[0].value?.toLocaleString()} logins</p>
    </div>
  );
};

export default function AdminDashboard() {
  const { colors } = useTheme();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchDashboard = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await adminApi.getDashboard();
      setData(response.data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error("Failed to fetch dashboard:", err);
      setError("Failed to load dashboard data");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboard();
    const poller = window.setInterval(() => void fetchDashboard(true), 60000);
    return () => window.clearInterval(poller);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
        <div className="relative overflow-hidden rounded-2xl h-40 bg-muted/30" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl h-28 bg-muted/30 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl h-64 bg-muted/30 animate-pulse" />
          <div className="rounded-2xl h-64 bg-muted/30 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
        <PageError
          title="Unable to Load Dashboard"
          message={error || "Failed to load data"}
          onRetry={() => void fetchDashboard()}
          retryLabel="Retry"
        />
      </div>
    );
  }

  const { stats, recentLogs, systemStatus, settings, termLabels } = data;
  const attention = data.attention ?? {
    pendingEditRequests: 0,
    unfinalizedCount: 0,
    unfinalizedSections: [],
    previousYearLabel: null,
    previousYearStatus: null,
    offlineServices: [],
    activeClassAssignments: 0,
  };
  const loginTrend = data.loginTrend ?? [];

  const currentTermLabel =
    settings?.currentTerm && termLabels
      ? termLabels[settings.currentTerm as keyof typeof termLabels] ?? settings.currentTerm
      : null;
  const gradeLock = Boolean(settings?.gradeLock);
  const transitionLock = Boolean(settings?.transitionLock);
  const integrationsChecked = systemStatus.integrationsChecked !== false;

  const glassCard = "bg-card/70 backdrop-blur-xl border border-border/40 rounded-2xl shadow-lg shadow-muted/50";

  const workload = [
    { label: "Students", value: stats.totalStudents, icon: GraduationCap, href: "/admin/assignments" },
    { label: "Teachers", value: stats.totalTeachers, icon: UserCheck, href: "/admin/assignments" },
    { label: "Users", value: stats.totalUsers, icon: Users, href: "/admin/users" },
    { label: "Class Loads", value: attention.activeClassAssignments, icon: ClipboardList, href: "/admin/assignments" },
  ];

  interface QueueItem {
    key: string;
    icon: ReactNode;
    text: string;
    meta: string;
    href: string;
    tone: "warning" | "danger";
  }

  const queue: QueueItem[] = [];
  if (attention.pendingEditRequests > 0) {
    queue.push({
      key: "edits",
      icon: <FileText className="w-4 h-4 text-amber-600" />,
      text: "Grade edit requests awaiting review",
      meta: `${attention.pendingEditRequests} pending`,
      href: "/admin/edit-requests",
      tone: "warning",
    });
  }
  if (attention.unfinalizedCount > 0 && attention.previousYearStatus !== "ARCHIVED") {
    queue.push({
      key: "rollover",
      icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
      text: `Sections unfinalized${attention.previousYearLabel ? ` in ${attention.previousYearLabel}` : ""} — archiving blocked`,
      meta: `${attention.unfinalizedCount} section${attention.unfinalizedCount !== 1 ? "s" : ""}`,
      href: "/admin/settings",
      tone: "warning",
    });
  }
  if (attention.offlineServices.length > 0 && integrationsChecked) {
    queue.push({
      key: "offline",
      icon: <WifiOff className="w-4 h-4 text-destructive" />,
      text: `${attention.offlineServices.join(", ")} offline — showing cached data`,
      meta: "connectivity",
      href: "/admin/health",
      tone: "danger",
    });
  }
  if (systemStatus.syncStatus === "stale" || systemStatus.syncStatus === "never") {
    queue.push({
      key: "sync",
      icon: <RefreshCw className="w-4 h-4 text-amber-600" />,
      text: "Integration sync is overdue",
      meta: `last sync ${relativeMinutes(systemStatus.minutesSinceLastSync)}`,
      href: "/admin/health",
      tone: "warning",
    });
  }

  const integrationOk = integrationsChecked && attention.offlineServices.length === 0;
  const uptime = systemStatus.uptime;

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      {/* ── Hero: live context ── */}
      <div
        className="relative overflow-hidden rounded-2xl p-6 text-white animate-in fade-in slide-in-from-bottom-1 duration-300"
        style={{ backgroundColor: colors.primary }}
      >
        <div className="absolute -top-20 -right-12 w-64 h-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 left-1/3 w-72 h-72 rounded-full bg-white/5 blur-3xl pointer-events-none" />
        <div className="relative">
          <PageHeader
            title="Admin Dashboard"
            description={`${settings?.schoolName || "SMART"} · ${settings?.currentSchoolYear || "—"}${currentTermLabel ? ` · ${currentTermLabel}` : ""}`}
            className="text-white [&_h1]:!text-white [&_p]:!text-white/80"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-white/20 text-white border-white/20 backdrop-blur-sm flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                  </span>
                  Live
                </Badge>
                <Badge className="bg-white/20 text-white border-white/20 backdrop-blur-sm flex items-center gap-1.5">
                  {gradeLock ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                  Grades {gradeLock ? "Locked" : "Open"}
                </Badge>
                {transitionLock && (
                  <Badge className="bg-white/20 text-white border-white/20 backdrop-blur-sm">
                    Teacher Login Locked
                  </Badge>
                )}
                <Button
                  onClick={() => void fetchDashboard(true)}
                  size="sm"
                  className="bg-white/20 hover:bg-white/30 text-white border border-white/20 backdrop-blur-sm font-semibold"
                >
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                  Refresh
                </Button>
              </div>
            }
          />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {workload.map((item) => (
              <Link key={item.label} to={item.href}>
                <div className="bg-white/15 hover:bg-white/25 transition-colors backdrop-blur-sm rounded-xl p-3 border border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <item.icon className="w-3.5 h-3.5 text-white/80" />
                    <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">{item.label}</span>
                  </div>
                  <p className="text-2xl font-bold text-white tabular-nums leading-none">{item.value.toLocaleString()}</p>
                </div>
              </Link>
            ))}
          </div>

          {lastUpdated && (
            <p className="relative mt-3 text-[11px] text-white/70">
              Updated {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · auto-refreshes every 60s
            </p>
          )}
        </div>
      </div>

      {/* ── Action Queue ── */}
      <div className={`${glassCard} overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-300`}>
        <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
          {queue.length > 0 ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
            </span>
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          )}
          <h2 className="text-sm font-bold text-foreground">
            {queue.length > 0 ? "Needs Attention" : "All Clear"}
          </h2>
          <span className="text-xs text-muted-foreground ml-auto">
            {queue.length > 0 ? `${queue.length} item(s) to resolve` : "No pending admin actions"}
          </span>
        </div>
        {queue.length > 0 ? (
          <div className="divide-y divide-border/40">
            {queue.map((item) => (
              <Link
                key={item.key}
                to={item.href}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/50 transition-colors group"
              >
                {item.icon}
                <span className="text-sm text-foreground flex-1">{item.text}</span>
                <Badge
                  variant="outline"
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    item.tone === "danger"
                      ? "bg-destructive/10 text-destructive border-destructive/20"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}
                >
                  {item.meta}
                </Badge>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-5 py-4 flex items-center gap-3 text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            {integrationsChecked
              ? "Integrations online, sync fresh, and no outstanding requests."
              : "No outstanding requests. Integration status is still being checked."}
          </div>
        )}
      </div>

      {/* ── Login Activity (real 7-day) + System Status ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`lg:col-span-2 ${glassCard} p-5 animate-in fade-in slide-in-from-bottom-1 duration-300`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" style={{ color: colors.primary }} />
              <h3 className="text-sm font-bold text-foreground">Logins — Last 7 Days</h3>
            </div>
            <div className="flex items-center gap-3">
              <div>
                <span className="text-2xl font-bold text-foreground tabular-nums leading-none">{stats.todayLogins}</span>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider ml-1.5">today</span>
              </div>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-medium px-2 py-0.5 rounded-full">
                {stats.activeUsers} active / 1h
              </Badge>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={loginTrend} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="loginGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.primary} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} allowDecimals={false} className="text-muted-foreground" />
              <Tooltip content={<LoginTooltip />} />
              <Area
                type="monotone"
                dataKey="count"
                stroke={colors.primary}
                strokeWidth={2}
                fill="url(#loginGrad)"
                dot={{ r: 3, fill: colors.primary, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className={`${glassCard} p-5 animate-in fade-in slide-in-from-bottom-1 duration-300`}>
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4" style={{ color: colors.primary }} />
            <h3 className="text-sm font-bold text-foreground">System Status</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${!integrationsChecked ? "bg-muted-foreground/40" : integrationOk ? "bg-emerald-500" : "bg-rose-500"}`} />
                Integrations
              </span>
              <span className={`text-xs font-semibold ${!integrationsChecked ? "text-muted-foreground" : integrationOk ? "text-emerald-600" : "text-destructive"}`}>
                {!integrationsChecked ? "Checking…" : integrationOk ? "All online" : `${attention.offlineServices.join(", ")} offline`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <RefreshCw className={`w-3.5 h-3.5 ${systemStatus.syncStatus === "fresh" ? "text-emerald-500" : "text-amber-500"}`} />
                Last sync
              </span>
              <span className={`text-xs font-semibold ${systemStatus.syncStatus === "fresh" ? "text-emerald-600" : "text-amber-600"}`}>
                {relativeMinutes(systemStatus.minutesSinceLastSync)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Settings className="w-3.5 h-3.5" />
                Grade editing
              </span>
              <span className="text-xs font-semibold text-foreground">{gradeLock ? "Locked" : "Open"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <LogIn className="w-3.5 h-3.5" />
                Teacher login
              </span>
              <span className="text-xs font-semibold text-foreground">{transitionLock ? "Locked" : "Normal"}</span>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-border/40">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Activity className="w-3.5 h-3.5" />
                System uptime
              </span>
              <span className="text-xs font-semibold text-foreground">{uptime}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Activity + Quick Actions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`lg:col-span-2 ${glassCard} overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-300`}>
          <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" style={{ color: colors.primary }} />
              <h3 className="text-sm font-bold text-foreground">Recent Activity</h3>
            </div>
            <Link to="/admin/logs" className="text-xs font-semibold hover:underline" style={{ color: colors.primary }}>
              View All
            </Link>
          </div>
          <ScrollArea className="h-[380px]">
            <div className="divide-y divide-border/40">
              {recentLogs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Activity className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p>No recent activity</p>
                </div>
              ) : (
                recentLogs.map((log) => (
                  <div key={log.id} className="p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-muted text-muted-foreground">
                        {getActionIcon(log.action)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground">{log.user}</span>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-sm text-muted-foreground capitalize">{log.action}d {log.target}</span>
                          {getSeverityBadge(log.severity)}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{log.details}</p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {log.timestamp} • {log.date}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className={`${glassCard} p-4 animate-in fade-in slide-in-from-bottom-1 duration-300`}>
          <h3 className="text-sm font-bold text-foreground mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((action) => (
              <Link key={action.name} to={action.href}>
                <div className="p-3 rounded-xl bg-muted/50 hover:bg-card border border-border/40 hover:shadow-md transition-all cursor-pointer group text-center h-full">
                  <div className="p-2.5 rounded-xl bg-muted text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors mx-auto w-fit">
                    <action.icon className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-foreground mt-2">{action.name}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
