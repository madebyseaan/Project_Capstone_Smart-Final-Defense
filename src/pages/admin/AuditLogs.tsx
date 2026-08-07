import { useState, useEffect, useRef } from "react";
import {
  Activity,
  Search,
  Download,
  Clock,
  Plus,
  Edit3,
  Trash2,
  LogIn,
  LogOut,
  Settings,
  AlertTriangle,
  Info,
  Calendar,
  User,
  FileText,
  Database,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { adminApi } from "@/lib/api";
import type { AdminAuditLog } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

const actionLabels: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  login: "Login",
  logout: "Logout",
  config: "Configured",
};

const actionColors: Record<string, string> = {
  create: "action-theme-15",
  update: "action-theme-25",
  delete: "bg-red-100 text-red-700",
  login: "action-theme-35",
  logout: "bg-gray-100 text-gray-600",
  config: "action-theme-45",
};

const actionIcons: Record<string, React.ReactNode> = {
  create: <Plus className="w-3.5 h-3.5" />,
  update: <Edit3 className="w-3.5 h-3.5" />,
  delete: <Trash2 className="w-3.5 h-3.5" />,
  login: <LogIn className="w-3.5 h-3.5" />,
  logout: <LogOut className="w-3.5 h-3.5" />,
  config: <Settings className="w-3.5 h-3.5" />,
};

const severityConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  info: { icon: <Info className="w-3.5 h-3.5" />, color: "bg-gray-100 text-gray-600", label: "Info" },
  warning: { icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "bg-amber-100 text-amber-700", label: "Warning" },
  critical: { icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "bg-red-100 text-red-700", label: "Critical" },
};

const targetTypeIcons: Record<string, React.ReactNode> = {
  Grades: <FileText className="w-4 h-4" />,
  Auth: <LogIn className="w-4 h-4" />,
  Config: <Settings className="w-4 h-4" />,
  Student: <User className="w-4 h-4" />,
  User: <User className="w-4 h-4" />,
};

export default function AuditLogs() {
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const { colors } = useTheme();
  const [counts, setCounts] = useState({
    total: 0,
    creates: 0,
    updates: 0,
    deletes: 0,
    logins: 0,
    critical: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAction, setSelectedAction] = useState("all");
  const [selectedSeverity, setSelectedSeverity] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getLogs({
        action: selectedAction !== "all" ? selectedAction : undefined,
        severity: selectedSeverity !== "all" ? selectedSeverity : undefined,
        search: searchQuery || undefined,
        limit: 100,
      });
      setLogs(response.data.logs);
      setCounts(response.data.counts);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setError("Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [selectedAction, selectedSeverity]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLogs();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // SSE real-time stream
  useEffect(() => {
    const token = sessionStorage.getItem("token");
    if (!token) return;

    const url = `/api/admin/logs/stream`;
    const es = new EventSource(url + `?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const newLog: AdminAuditLog = JSON.parse(event.data);
      setLogs((prev) => {
        // Only prepend if not filtered out by current filters
        const actionMatch = selectedAction === "all" || newLog.action === selectedAction;
        const severityMatch = selectedSeverity === "all" || newLog.severity === selectedSeverity;
        const searchMatch = !searchQuery || 
          newLog.user?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          newLog.target?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          newLog.details?.toLowerCase().includes(searchQuery.toLowerCase());
        if (actionMatch && severityMatch && searchMatch) {
          return [newLog, ...prev];
        }
        return prev;
      });
      setCounts((prev) => ({
        ...prev,
        total: prev.total + 1,
        creates: newLog.action === "create" ? prev.creates + 1 : prev.creates,
        updates: newLog.action === "update" ? prev.updates + 1 : prev.updates,
        deletes: newLog.action === "delete" ? prev.deletes + 1 : prev.deletes,
        logins: (newLog.action === "login" || newLog.action === "logout") ? prev.logins + 1 : prev.logins,
        critical: newLog.severity === "critical" ? prev.critical + 1 : prev.critical,
      }));
      setLiveCount((n) => n + 1);
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [selectedAction, selectedSeverity, searchQuery]);

  const handleExport = async () => {
    try {
      setExporting(true);
      const response = await adminApi.exportLogs();
      const blob = new Blob([response.data as any], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to export logs:", err);
      alert("Failed to export logs");
    } finally {
      setExporting(false);
    }
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
          <p className="text-gray-500">Loading audit logs...</p>
        </div>
      </div>
    );
  }

  if (error && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500" />
          <p className="text-gray-700 font-medium">{error}</p>
          <Button onClick={fetchLogs} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: '#111827' }}>
            Audit Logs
          </h1>
          <p style={{ color: '#6b7280' }} className="mt-1">
            Track all system activities and changes
            {liveCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-green-600">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                {liveCount} new live
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            className="gap-2 rounded-xl border-gray-200"
            onClick={fetchLogs}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button 
            onClick={handleExport}
            disabled={exporting}
            className="gap-2 text-white font-semibold rounded-xl shadow-lg"
            style={{ backgroundColor: colors.primary }}
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export Logs
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Total Logs</p>
                <p className="text-2xl font-bold" style={{ color: '#111827' }}>{counts.total}</p>
              </div>
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${colors.primary}15` }}>
                <Activity className="w-5 h-5" style={{ color: colors.primary }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Creates</p>
                <p className="text-2xl font-bold" style={{ color: colors.secondary }}>{counts.creates}</p>
              </div>
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${colors.secondary}15` }}>
                <Plus className="w-5 h-5" style={{ color: colors.secondary }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Updates</p>
                <p className="text-2xl font-bold" style={{ color: colors.secondary }}>{counts.updates}</p>
              </div>
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${colors.secondary}15` }}>
                <Edit3 className="w-5 h-5" style={{ color: colors.secondary }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Deletes</p>
                <p className="text-2xl font-bold text-red-600">{counts.deletes}</p>
              </div>
              <div className="p-2 rounded-lg bg-red-100">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Auth Events</p>
                <p className="text-2xl font-bold" style={{ color: colors.primary }}>{counts.logins}</p>
              </div>
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${colors.primary}15` }}>
                <LogIn className="w-5 h-5" style={{ color: colors.primary }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg shadow-gray-200/50 rounded-xl bg-white p-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Critical</p>
                <p className="text-2xl font-bold text-red-600">{counts.critical}</p>
              </div>
              <div className="p-2 rounded-lg bg-red-100">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logs Table */}
      <Card className="border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white p-0">
        <CardHeader className="border-b border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-lg flex items-center gap-2" style={{ color: '#111827' }}>
                <Database className="w-5 h-5" style={{ color: colors.primary }} />
                Activity History
              </CardTitle>
              <CardDescription>Complete log of all system activities</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64 rounded-xl border-gray-200"
                />
              </div>
              <Select value={selectedAction} onValueChange={(val) => val && setSelectedAction(val)}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="create">Created</SelectItem>
                  <SelectItem value="update">Updated</SelectItem>
                  <SelectItem value="delete">Deleted</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="config">Configured</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedSeverity} onValueChange={(val) => val && setSelectedSeverity(val)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severity</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/80">
                  <TableHead className="font-bold text-gray-700 w-16">#</TableHead>
                  <TableHead className="font-bold text-gray-700">Action</TableHead>
                  <TableHead className="font-bold text-gray-700">User</TableHead>
                  <TableHead className="font-bold text-gray-700">Target</TableHead>
                  <TableHead className="font-bold text-gray-700">Details</TableHead>
                  <TableHead className="font-bold text-gray-700">Severity</TableHead>
                  <TableHead className="font-bold text-gray-700">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-500">
                        <Activity className="w-8 h-8 text-gray-300" />
                        <p>No audit logs found</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log, index) => (
                    <TableRow key={log.id} className="hover:bg-gray-50/50">
                      <TableCell className="text-sm font-semibold text-gray-500 text-center">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          className={`${actionColors[log.action]?.startsWith('action-theme') ? '' : (actionColors[log.action] || 'bg-gray-100 text-gray-700')} border-0 font-medium flex items-center gap-1 w-fit`}
                          style={actionColors[log.action]?.startsWith('action-theme') ? { backgroundColor: `${colors.primary}${actionColors[log.action].split('-').pop()}`, color: colors.primary } : undefined}
                        >
                          {actionIcons[log.action] || <Activity className="w-3.5 h-3.5" />}
                          {actionLabels[log.action] || log.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-sm" style={{ color: '#111827' }}>{log.user}</p>
                          <p className="text-xs text-gray-500">{log.userRole}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-gray-100 text-gray-600">
                            {targetTypeIcons[log.targetType] || <FileText className="w-4 h-4" />}
                          </div>
                          <span className="text-sm text-gray-700">{log.target}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-sm text-gray-600 truncate" title={log.details}>
                          {log.details}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${severityConfig[log.severity]?.color || 'bg-gray-100 text-gray-600'} border-0 font-medium flex items-center gap-1 w-fit`}>
                          {severityConfig[log.severity]?.icon || <Info className="w-3.5 h-3.5" />}
                          {severityConfig[log.severity]?.label || log.severity}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div className="flex items-center gap-1 font-medium" style={{ color: '#111827' }}>
                            <Clock className="w-3.5 h-3.5 text-gray-400" />
                            {log.timestamp}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Calendar className="w-3 h-3" />
                            {log.date}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
