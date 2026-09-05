import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  GraduationCap,
  UserCheck,
  Activity,
  ChevronRight,
  ArrowUpRight,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Trash2,
  Plus,
  LogIn,
  LogOut,
  Settings,
  TrendingUp,
  Server,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { adminApi } from "@/lib/api";
import type { AdminDashboard as AdminDashboardData, AdminAuditLog } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";

const quickActions = [
  { name: "Manage Users", description: "Add, edit, or deactivate users", icon: Users, href: "/admin/users", color: "blue" },
  { name: "View Audit Logs", description: "See all system activities", icon: Activity, href: "/admin/logs", color: "blue" },
  { name: "Grading Config", description: "Modify grading weights", icon: Settings, href: "/admin/grading", color: "amber" },
  { name: "System Settings", description: "Configure system options", icon: Server, href: "/admin/settings", color: "blue" },
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

const getActionColor = (action: AdminAuditLog["action"]) => {
  switch (action) {
    case "create": return "action-theme-15";
    case "update": return "action-theme-25";
    case "delete": return "bg-red-100 text-red-700";
    case "login": return "action-theme-35";
    case "logout": return "bg-gray-100 text-muted-foreground";
    case "config": return "action-theme-45";
  }
};

const getSeverityBadge = (severity: AdminAuditLog["severity"]) => {
  switch (severity) {
    case "info": return <Badge className="bg-gray-100 text-muted-foreground border-0 text-xs">Info</Badge>;
    case "warning": return <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">Warning</Badge>;
    case "critical": return <Badge className="bg-red-100 text-red-700 border-0 text-xs">Critical</Badge>;
  }
};

export default function AdminDashboard() {
  const { colors } = useTheme();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      const response = await adminApi.getDashboard();
      setData(response.data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch dashboard:", err);
      setError("Failed to load dashboard data");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void fetchDashboard();

    const poller = window.setInterval(() => {
      void fetchDashboard(true);
    }, 60000);

    return () => window.clearInterval(poller);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500" />
          <p className="text-foreground font-medium">{error || "Failed to load data"}</p>
          <Button onClick={fetchDashboard} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { stats, recentLogs, systemStatus } = data;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader 
        title="Admin Dashboard"
        description="System overview and administration"
        actions={
          <div className="flex items-center gap-3">
            <Badge className="border-0 font-semibold flex items-center gap-1.5 px-3 py-1.5" style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              System Online
            </Badge>
            <Link to="/admin/logs">
              <Button 
                className="gap-2 text-white font-semibold rounded-xl shadow-lg"
                style={{ backgroundColor: colors.primary }}
              >
                <Activity className="w-4 h-4" />
                View All Logs
              </Button>
            </Link>
          </div>
        }
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {[
          { label: "Total\nUsers", value: stats.totalUsers, icon: Users, color: "primary", gradient: "primary", footerText: "Live" },
          { label: "Total\nTeachers", value: stats.totalTeachers, icon: UserCheck, color: "accent", gradient: "accent", footerText: "Live" },
          {
            label: "Total\nStudents",
            value: stats.totalStudents,
            icon: GraduationCap,
            color: "secondary",
            gradient: "secondary",
            footerText: stats.studentCountSchoolYear ? `EnrollPro SY ${stats.studentCountSchoolYear}` : "Live",
          },
          { label: "Active\nToday", value: stats.activeUsers, icon: Activity, color: "primary", gradient: "primary", footerText: "Live" },
        ].map((stat) => (
          <Card 
            key={stat.label} 
            className="group border-0 shadow-lg shadow-gray-200/50 hover:shadow-xl hover:shadow-gray-200/60 transition-all duration-300 bg-white overflow-hidden"
          >
            <CardContent className="p-6 h-full flex flex-col">
              <div className="flex items-start justify-between flex-1">
                <div>
                  <p className="text-sm font-medium text-muted-foreground whitespace-pre-line leading-tight">{stat.label}</p>
                  <p className="text-3xl font-bold mt-2 text-foreground">
                    {stat.value.toLocaleString()}
                  </p>
                </div>
                <div 
                  className={`p-3 rounded-xl text-white shadow-lg group-hover:scale-110 transition-transform`}
                  style={stat.gradient === "primary" ? { backgroundColor: colors.primary } : stat.gradient === "secondary" ? { backgroundColor: colors.secondary } : stat.gradient === "accent" ? { backgroundColor: colors.accent } : { backgroundColor: colors.primary }}
                >
                  <stat.icon className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center text-sm text-muted-foreground">
                <TrendingUp className="w-4 h-4 mr-1" style={{ color: colors.primary }} />
                <span className="font-medium" style={{ color: colors.primary }}>{stat.footerText}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* System Status Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${colors.primary}15` }}>
                  <Server className="w-5 h-5" style={{ color: colors.primary }} />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">System Uptime</p>
                  <p className="text-xl font-bold" style={{ color: colors.primary }}>{systemStatus.uptime}</p>
                </div>
              </div>
              <CheckCircle2 className="w-6 h-6" style={{ color: colors.primary }} />
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${colors.accent}15` }}>
                  <LogIn className="w-5 h-5" style={{ color: colors.accent }} />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Today's Logins</p>
                  <p className="text-xl font-bold" style={{ color: colors.accent }}>{stats.todayLogins}</p>
                </div>
              </div>
              <ArrowUpRight className="w-5 h-5" style={{ color: colors.primary }} />
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${colors.primary}15` }}>
                  <Users className="w-5 h-5" style={{ color: colors.primary }} />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Admins</p>
                  <p className="text-xl font-bold" style={{ color: colors.primary }}>{stats.totalAdmins}</p>
                </div>
              </div>
              <Badge className="border-0" style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>Staff</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <Card className="lg:col-span-2 border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white overflow-hidden p-0">
          <CardHeader className="border-b border-gray-100 px-6 py-4" style={{ backgroundColor: `${colors.primary}08` }}>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2 text-foreground">
                  <Activity className="w-5 h-5" style={{ color: colors.primary }} />
                  Recent Activity
                </CardTitle>
                <CardDescription>Latest system events and user actions</CardDescription>
              </div>
              <Link to="/admin/logs">
                <Button variant="ghost" size="sm" className="rounded-lg" style={{ color: colors.primary }}>
                  View All
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[380px]">
              <div className="divide-y divide-gray-100">
                {recentLogs.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Activity className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                    <p>No recent activity</p>
                  </div>
                ) : (
                  recentLogs.map((log) => (
                    <div key={log.id} className="p-4 hover:bg-gray-50/50 transition-colors">
                      <div className="flex items-start gap-3">
                        {(() => {
                          const ac = getActionColor(log.action);
                          const isTheme = ac?.startsWith('action-theme');
                          return (
                            <div className={`p-2 rounded-lg ${isTheme ? '' : ac}`}
                              style={isTheme ? { backgroundColor: `${colors.primary}${ac?.split('-').pop()}`, color: colors.primary } : undefined}
                            >
                              {getActionIcon(log.action)}
                            </div>
                          );
                        })()}
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
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white p-0">
          <CardHeader className="border-b border-gray-100 px-6 py-4">
            <CardTitle className="text-lg text-foreground">Quick Actions</CardTitle>
            <CardDescription>Common administrative tasks</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3">
              {quickActions.map((action) => (
                <Link key={action.name} to={action.href}>
                  <div className={`p-4 rounded-xl border border-gray-100 hover:border-${action.color}-200 hover:bg-${action.color}-50/50 transition-all cursor-pointer group`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl bg-${action.color}-100 text-${action.color}-600 group-hover:bg-${action.color}-200 transition-colors`}>
                        <action.icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold text-sm text-foreground">{action.name}</h4>
                        <p className="text-xs text-muted-foreground">{action.description}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Distribution */}
      <Card className="border-0 shadow-xl shadow-gray-200/50 overflow-hidden rounded-2xl text-white p-0" style={{ backgroundColor: colors.primary }}>
        <CardContent className="p-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div>
              <h3 className="text-2xl font-bold mb-2">User Distribution</h3>
              <p className="text-white/70 max-w-xl">
                Overview of all registered users in the system by role type.
              </p>
              <div className="flex flex-wrap gap-4 mt-4">
                <div className="bg-white/10 rounded-xl px-4 py-2">
                  <span className="text-white/70 text-sm">Teachers</span>
                  <p className="text-xl font-bold">{stats.totalTeachers}</p>
                </div>
                <div className="bg-white/10 rounded-xl px-4 py-2">
                  <span className="text-white/70 text-sm">Admins</span>
                  <p className="text-xl font-bold">{stats.totalAdmins}</p>
                </div>
                <div className="bg-white/10 rounded-xl px-4 py-2">
                  <span className="text-white/70 text-sm">Registrars</span>
                  <p className="text-xl font-bold">{stats.totalRegistrars}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/admin/users">
                <Button className="font-semibold rounded-xl px-6" style={{ backgroundColor: 'white', color: colors.primary }}>
                  <Users className="w-4 h-4 mr-2" />
                  Manage Users
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
