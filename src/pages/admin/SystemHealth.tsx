import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type AdminSystemHealth, type ExternalServiceHealth, type SyncHistoryItem } from "@/lib/api";
import { Activity, AlertCircle, CheckCircle2, Clock3, Database, RefreshCw, Server, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dash } from "@/components/data-table/Dash";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatUptime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function serviceBadgeColor(service: ExternalServiceHealth): string {
  if (service.status === "HEALTHY") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (service.status === "DEGRADED") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function serviceDotColor(service: ExternalServiceHealth): string {
  if (service.status === "HEALTHY") return "bg-emerald-500";
  if (service.status === "DEGRADED") return "bg-amber-500";
  return "bg-rose-500";
}

export default function SystemHealth() {
  const [health, setHealth] = useState<AdminSystemHealth | null>(null);
  const [history, setHistory] = useState<SyncHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [healthRes, historyRes] = await Promise.all([
        adminApi.getSystemHealth(),
        adminApi.getSyncHistory(30),
      ]);
      setHealth(healthRes.data);
      setHistory(historyRes.data.history || []);
      setError(null);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      const message = e?.response?.data?.message || e?.message || "Failed to fetch diagnostics";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll(false);

    const interval = window.setInterval(() => {
      void fetchAll(true);
    }, 20000);

    return () => window.clearInterval(interval);
  }, [fetchAll]);

  const externalServices = useMemo(() => {
    if (!health) return [];
    return [health.external.enrollpro, health.external.atlas, health.external.aims];
  }, [health]);

  // Dependencies whose data is authoritative for SMART. AIMS is intentionally
  // excluded: it is fail-soft and never feeds core roster/grading data.
  const offlineDependencies = useMemo(() => {
    if (!health) return [];
    return [health.external.enrollpro, health.external.atlas].filter((service) => !service.online);
  }, [health]);

  const lastSyncLabel = useMemo(() => {
    const iso = health?.sync.coordinator.lastSyncAt;
    return iso ? new Date(iso).toLocaleString() : null;
  }, [health]);

  const runSyncNow = async () => {
    setSyncing(true);
    try {
      await adminApi.runSystemSync();
      await fetchAll(true);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      const message = e?.response?.data?.message || e?.message || "Failed to trigger sync";
      setError(message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !health) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
        <div className="h-10 w-72 rounded-lg bg-muted/30 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="System Health"
        description="Live pulse of SMART, EnrollPro, Atlas, and AIMS."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchAll(true)}
              disabled={refreshing || syncing}
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={runSyncNow}
              disabled={refreshing || syncing}
              className="font-semibold text-xs shadow-sm shadow-primary/20"
            >
              <Activity className={`w-4 h-4 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              Run Sync Now
            </Button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-xl border-2 border-destructive/20 bg-destructive/5 px-4 py-3 text-destructive">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {health && (
        <>
          {offlineDependencies.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                <span className="font-semibold">Showing cached data.</span>{" "}
                {offlineDependencies.map((service) => service.name).join(", ")}{" "}
                {offlineDependencies.length === 1 ? "is" : "are"} offline. Destructive sync steps are
                fail-closed and will not run until {offlineDependencies.length === 1 ? "it" : "they"}{" "}
                {offlineDependencies.length === 1 ? "is" : "are"} reachable.{" "}
                {lastSyncLabel
                  ? `Last successful sync: ${lastSyncLabel}.`
                  : "No successful sync recorded yet."}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Card className="border border-border shadow-sm bg-card rounded-xl p-0">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Overall</p>
                  {health.status === "HEALTHY" ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-amber-600" />
                  )}
                </div>
                <p className="mt-2 text-xl font-bold text-foreground">{health.status}</p>
                <p className="text-xs text-muted-foreground mt-1">Response: {formatDuration(health.responseTimeMs)}</p>
              </CardContent>
            </Card>

            <Card className="border border-border shadow-sm bg-card rounded-xl p-0">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Node Uptime</p>
                  <Server className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="mt-2 text-xl font-bold text-foreground">{formatUptime(health.local.uptimeSeconds)}</p>
                <p className="text-xs text-muted-foreground mt-1">Last check: {new Date(health.timestamp).toLocaleString()}</p>
              </CardContent>
            </Card>

            <Card className="border border-border shadow-sm bg-card rounded-xl p-0">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Database</p>
                  <Database className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="mt-2 text-xl font-bold text-foreground">{health.local.database.online ? "ONLINE" : "OFFLINE"}</p>
                <p className="text-xs text-muted-foreground mt-1">Latency: {health.local.database.latencyMs} ms</p>
              </CardContent>
            </Card>

            <Card className="border border-border shadow-sm bg-card rounded-xl p-0">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Heap Used</p>
                  <Clock3 className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="mt-2 text-xl font-bold text-foreground">{formatBytes(health.local.memory.heapUsed)}</p>
                <p className="text-xs text-muted-foreground mt-1">RSS: {formatBytes(health.local.memory.rss)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border border-border shadow-sm bg-card rounded-xl p-0">
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">External Services</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {externalServices.map((service) => (
                  <div key={service.name} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${serviceDotColor(service)}`} />
                        <span className="font-semibold text-foreground text-sm">{service.name}</span>
                      </div>
                      <span className={`text-xs font-semibold border rounded-full px-2 py-0.5 ${serviceBadgeColor(service)}`}>
                        {service.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 break-all">{service.url}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      HTTP: {service.httpStatus ?? "N/A"} • Latency: {service.latencyMs} ms
                    </p>
                    {service.error && <p className="text-xs text-destructive mt-1">{service.error}</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border shadow-sm bg-card rounded-xl p-0">
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold text-foreground mb-2">Sync Circuit Breaker</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase">State</p>
                  <p className={`mt-1 font-bold ${health.sync.circuitBreaker.open ? "text-destructive" : "text-emerald-700"}`}>
                    {health.sync.circuitBreaker.open ? "OPEN" : "CLOSED"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase">Consecutive Failures</p>
                  <p className="mt-1 font-bold text-foreground">{health.sync.circuitBreaker.consecutiveCriticalFailures}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase">Threshold</p>
                  <p className="mt-1 font-bold text-foreground">{health.sync.circuitBreaker.failureThreshold}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase">Cooldown</p>
                  <p className="mt-1 font-bold text-foreground">{Math.round(health.sync.circuitBreaker.cooldownMs / 1000)} s</p>
                </div>
              </div>
              {health.sync.circuitBreaker.reason && (
                <p className="text-xs text-amber-700 mt-3">Reason: {health.sync.circuitBreaker.reason}</p>
              )}
            </CardContent>
          </Card>

          <Card className="border border-border shadow-sm bg-card rounded-xl p-0">
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">Recent Sync History</h2>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-muted/50 border-b border-border bg-muted/50">
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4">Started</TableHead>
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4">Source</TableHead>
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4">Status</TableHead>
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4">Duration</TableHead>
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4">Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.length === 0 ? (
                      <TableRow>
                        <TableCell className="py-4 text-muted-foreground" colSpan={5}>No sync history yet.</TableCell>
                      </TableRow>
                    ) : (
                      history.map((item) => {
                        const statusClass =
                          item.status === "SUCCESS"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : item.status === "SKIPPED"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-rose-50 text-rose-700 border-rose-200";

                        return (
                          <TableRow key={item.id} className="border-b border-border/20">
                            <TableCell className="py-3 px-4 text-sm text-foreground">{new Date(item.startedAt).toLocaleString()}</TableCell>
                            <TableCell className="py-3 px-4 text-sm text-foreground">{item.source}</TableCell>
                            <TableCell className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${statusClass}`}>{item.status}</span>
                            </TableCell>
                            <TableCell className="py-3 px-4 text-sm text-foreground">{formatDuration(item.durationMs)}</TableCell>
                            <TableCell className="py-3 px-4 text-sm text-muted-foreground max-w-[380px] truncate">
                              {item.error || <Dash />}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
