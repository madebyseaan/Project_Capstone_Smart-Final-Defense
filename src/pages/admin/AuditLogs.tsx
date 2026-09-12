import { useState, useEffect, useRef } from "react";
import {
  Activity,
  AlertTriangle,
  Calendar,
  Clock,
  Download,
  Loader2,
  LogIn,
  Monitor,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminApi, getPortalToken } from "@/lib/api";
import type { AdminAuditLog } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { SearchInput } from "@/components/layout/SearchInput";
import { StatCard } from "@/components/layout/StatCard";
import { DataTable, Dash, usePagination } from "@/components/data-table";
import type { TableColumn } from "@/components/data-table";
import { toast } from "@/lib/toast";
import { AuditLogDetailDialog } from "./components/AuditLogDetailDialog";
import {
  actionIcons,
  actionLabels,
  defaultActionIcon,
  deviceTypeIcon,
  formatExactDate,
  formatRelative,
  NetworkBadge,
  OutcomeBadge,
  SeverityBadge,
} from "./components/auditHelpers";

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function AuditLogs() {
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const { colors } = useTheme();
  const [counts, setCounts] = useState({
    total: 0,
    today: 0,
    failed: 0,
    uniqueDevices: 0,
    logins: 0,
    critical: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAction, setSelectedAction] = useState("all");
  const [selectedSeverity, setSelectedSeverity] = useState("all");
  const [selectedNetwork, setSelectedNetwork] = useState("all");
  const [selectedDevice, setSelectedDevice] = useState("all");
  const [selectedOutcome, setSelectedOutcome] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [selectedLog, setSelectedLog] = useState<AdminAuditLog | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getLogs({
        action: selectedAction !== "all" ? selectedAction : undefined,
        severity: selectedSeverity !== "all" ? selectedSeverity : undefined,
        network: selectedNetwork !== "all" ? selectedNetwork : undefined,
        deviceType: selectedDevice !== "all" ? selectedDevice : undefined,
        outcome: selectedOutcome !== "all" ? selectedOutcome : undefined,
        search: searchQuery || undefined,
        limit: 100,
      });
      setLogs(response.data.logs);
      setCounts({
        total: response.data.counts.total,
        today: response.data.counts.today ?? 0,
        failed: response.data.counts.failed ?? 0,
        uniqueDevices: response.data.counts.uniqueDevices ?? 0,
        logins: response.data.counts.logins,
        critical: response.data.counts.critical,
      });
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
  }, [selectedAction, selectedSeverity, selectedNetwork, selectedDevice, selectedOutcome]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLogs();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // SSE real-time stream
  useEffect(() => {
    const token = getPortalToken();
    if (!token) return;

    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 2000;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const url = `/api/admin/logs/stream?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        const newLog: AdminAuditLog = JSON.parse(event.data);
        setLogs((prev) => {
          // Only prepend if not filtered out by current filters
          const actionMatch = selectedAction === "all" || newLog.action === selectedAction;
          const severityMatch = selectedSeverity === "all" || newLog.severity === selectedSeverity;
          const networkMatch = selectedNetwork === "all" || newLog.network === selectedNetwork;
          const deviceMatch = selectedDevice === "all" || newLog.deviceType === selectedDevice;
          const outcomeMatch = selectedOutcome === "all" || newLog.outcome === selectedOutcome;
          const searchMatch = !searchQuery ||
            newLog.user?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            newLog.target?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            newLog.details?.toLowerCase().includes(searchQuery.toLowerCase());
          if (actionMatch && severityMatch && networkMatch && deviceMatch && outcomeMatch && searchMatch) {
            return [newLog, ...prev];
          }
          return prev;
        });
        setCounts((prev) => ({
          ...prev,
          total: prev.total + 1,
          today: prev.today + 1,
          failed: newLog.outcome === "failure" ? prev.failed + 1 : prev.failed,
          logins: (newLog.action === "login" || newLog.action === "logout") ? prev.logins + 1 : prev.logins,
          critical: newLog.severity === "critical" ? prev.critical + 1 : prev.critical,
        }));
        setLiveCount((n) => n + 1);
      };

      es.onopen = () => {
        backoffMs = 2000;
      };

      es.onerror = () => {
        es?.close();
        eventSourceRef.current = null;
        if (!cancelled) {
          reconnectTimeout = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, 30000);
            connect();
          }, backoffMs);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      es?.close();
      eventSourceRef.current = null;
    };
  }, [selectedAction, selectedSeverity, selectedNetwork, selectedDevice, selectedOutcome, searchQuery]);

  const handleExport = async () => {
    try {
      setExporting(true);
      const response = await adminApi.exportLogs();
      const blob = new Blob([response.data as BlobPart], { type: "text/csv" });
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
      toast.error("Failed to export logs");
    } finally {
      setExporting(false);
    }
  };

  const openDetail = (log: AdminAuditLog) => {
    setSelectedLog(log);
    setDetailOpen(true);
  };

  const pagination = usePagination({ totalRows: logs.length });

  const actionBadge = (action: string) => {
    const icon = actionIcons[action] || defaultActionIcon;
    const label = actionLabels[action] || action;
    if (action === "delete") {
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 font-medium flex items-center gap-1 w-fit">
          {icon}{label}
        </Badge>
      );
    }
    if (action === "logout") {
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground border-border font-medium flex items-center gap-1 w-fit">
          {icon}{label}
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="font-medium flex items-center gap-1 w-fit"
        style={{ backgroundColor: `${colors.primary}12`, color: colors.primary, borderColor: `${colors.primary}30` }}
      >
        {icon}{label}
      </Badge>
    );
  };

  const columns: TableColumn<AdminAuditLog>[] = [
    {
      key: "action",
      header: "Action",
      skeleton: "badge",
      cell: (log) => actionBadge(log.action),
    },
    {
      key: "user",
      header: "User",
      skeleton: "avatar",
      cell: (log) => (
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}
          >
            {avatarInitials(log.user || "?")}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">{log.user}</p>
            <p className="text-xs text-muted-foreground">{log.userRole}</p>
          </div>
        </div>
      ),
    },
    {
      key: "what",
      header: "What Happened",
      skeleton: "name",
      cell: (log) => (
        <div className="min-w-0">
          <p className="text-sm text-foreground truncate max-w-[220px]" title={log.target}>{log.target}</p>
          <p className="text-xs text-muted-foreground truncate max-w-[220px]" title={log.details}>{log.details}</p>
        </div>
      ),
    },
    {
      key: "from",
      header: "From",
      cell: (log) => {
        const hasNetwork = log.network && log.network !== "Unknown";
        if (!hasNetwork && !log.ipAddress) return <Dash />;
        return (
          <div className="space-y-1">
            {hasNetwork && <NetworkBadge network={log.network} />}
            {log.ipAddress ? (
              <p className="font-mono text-xs text-muted-foreground">{log.ipAddress}</p>
            ) : (
              <Dash />
            )}
          </div>
        );
      },
    },
    {
      key: "device",
      header: "Device",
      cell: (log) => {
        if (!log.browser && !log.os && !log.deviceType) return <Dash />;
        return (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground shrink-0">{deviceTypeIcon(log.deviceType)}</span>
            <div className="min-w-0">
              <p className="text-sm text-foreground truncate max-w-[140px]">{log.browser || "—"}</p>
              <p className="text-xs text-muted-foreground truncate max-w-[140px]">{log.os || "—"}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "severity",
      header: "Severity",
      skeleton: "badge",
      cell: (log) => (
        <div className="flex items-center gap-1.5">
          <SeverityBadge severity={log.severity} />
          <OutcomeBadge outcome={log.outcome} />
        </div>
      ),
    },
    {
      key: "timestamp",
      header: "When",
      skeleton: "date",
      cell: (log) => (
        <div className="text-sm" title={formatExactDate(log.createdAt)}>
          <div className="flex items-center gap-1 font-medium text-foreground">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            {formatRelative(log.createdAt)}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="w-3 h-3" />
            {log.timestamp}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Audit Logs"
        description={`Who did what, from where, on what device${liveCount > 0 ? ` — ${liveCount} new live` : ""}`}
        actions={
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
              onClick={fetchLogs}
              disabled={loading}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              onClick={handleExport}
              disabled={exporting}
              size="sm"
              className="font-semibold text-xs shadow-sm shadow-primary/20"
            >
              {exporting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
              Export Logs
            </Button>
          </div>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Logs" value={counts.total} numericValue={counts.total} icon={<Activity className="w-5 h-5" style={{ color: colors.primary }} />} iconClassName="bg-primary/10" />
        <StatCard label="Today" value={counts.today} numericValue={counts.today} icon={<Calendar className="w-5 h-5" style={{ color: colors.secondary }} />} iconClassName="bg-secondary/10" />
        <StatCard label="Failed Logins" value={counts.failed} numericValue={counts.failed} icon={<AlertTriangle className="w-5 h-5 text-destructive" />} iconClassName="bg-destructive/10" />
        <StatCard label="Unique Devices" value={counts.uniqueDevices} numericValue={counts.uniqueDevices} icon={<Monitor className="w-5 h-5" style={{ color: colors.primary }} />} iconClassName="bg-primary/10" />
        <StatCard label="Auth Events" value={counts.logins} numericValue={counts.logins} icon={<LogIn className="w-5 h-5" style={{ color: colors.primary }} />} iconClassName="bg-primary/10" />
        <StatCard label="Critical" value={counts.critical} numericValue={counts.critical} icon={<AlertTriangle className="w-5 h-5 text-destructive" />} iconClassName="bg-destructive/10" />
      </div>

      {/* Logs Table */}
      <DataTable
        columns={columns}
        rows={logs}
        loading={loading}
        error={error}
        onRetry={fetchLogs}
        emptyTitle="No audit logs found"
        emptyHint="Try adjusting your search or filters."
        emptySearchTerm={searchQuery}
        title="Activity History"
        description="Complete log of all system activities"
        rowKey={(log) => log.id}
        onRowClick={openDetail}
        pagination={pagination}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search logs..." />
            <Select value={selectedAction} onValueChange={(val) => val && setSelectedAction(val)}>
              <SelectTrigger className="w-36 h-9 rounded-lg text-xs font-medium">
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
              <SelectTrigger className="w-32 h-9 rounded-lg text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severity</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedNetwork} onValueChange={(val) => val && setSelectedNetwork(val)}>
              <SelectTrigger className="w-36 h-9 rounded-lg text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Networks</SelectItem>
                <SelectItem value="Tailscale">Tailscale</SelectItem>
                <SelectItem value="School LAN">School LAN</SelectItem>
                <SelectItem value="Localhost">Localhost</SelectItem>
                <SelectItem value="Public Internet">Public Internet</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedDevice} onValueChange={(val) => val && setSelectedDevice(val)}>
              <SelectTrigger className="w-32 h-9 rounded-lg text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Devices</SelectItem>
                <SelectItem value="Desktop">Desktop</SelectItem>
                <SelectItem value="Mobile">Mobile</SelectItem>
                <SelectItem value="Tablet">Tablet</SelectItem>
                <SelectItem value="Bot">Bot</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedOutcome} onValueChange={(val) => val && setSelectedOutcome(val)}>
              <SelectTrigger className="w-32 h-9 rounded-lg text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Outcomes</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failure">Failure</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <AuditLogDetailDialog log={selectedLog} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}
