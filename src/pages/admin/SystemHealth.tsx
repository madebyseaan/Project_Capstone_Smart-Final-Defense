import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type AdminSystemHealth, type ExternalServiceHealth, type SyncHistoryItem } from "@/lib/api";
import { Activity, AlertCircle, CheckCircle2, Clock3, Database, RefreshCw, Server, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

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
  if (service.status === "HEALTHY") return "bg-emerald-100 text-emerald-700 border-emerald-300";
  if (service.status === "DEGRADED") return "bg-amber-100 text-amber-700 border-amber-300";
  return "bg-rose-100 text-rose-700 border-rose-300";
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
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || "Failed to fetch diagnostics";
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

  const runSyncNow = async () => {
    setSyncing(true);
    try {
      await adminApi.runSystemSync();
      await fetchAll(true);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || "Failed to trigger sync";
      setError(message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !health) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-10 w-72 bg-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 bg-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="System Health"
        description="Live pulse of SMART, EnrollPro, Atlas, and AIMS."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchAll(true)}
              disabled={refreshing || syncing}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-white text-foreground hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={runSyncNow}
              disabled={refreshing || syncing}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <Activity className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              Run Sync Now
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {health && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
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
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Node Uptime</p>
                <Server className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="mt-2 text-xl font-bold text-foreground">{formatUptime(health.local.uptimeSeconds)}</p>
              <p className="text-xs text-muted-foreground mt-1">Last check: {new Date(health.timestamp).toLocaleString()}</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Database</p>
                <Database className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="mt-2 text-xl font-bold text-foreground">{health.local.database.online ? "ONLINE" : "OFFLINE"}</p>
              <p className="text-xs text-muted-foreground mt-1">Latency: {health.local.database.latencyMs} ms</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Heap Used</p>
                <Clock3 className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="mt-2 text-xl font-bold text-foreground">{formatBytes(health.local.memory.heapUsed)}</p>
              <p className="text-xs text-muted-foreground mt-1">RSS: {formatBytes(health.local.memory.rss)}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">External Services</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {externalServices.map((service) => (
                <div key={service.name} className="rounded-lg border border-slate-200 p-3">
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
                  {service.error && <p className="text-xs text-rose-600 mt-1">{service.error}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-foreground mb-2">Sync Circuit Breaker</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-muted-foreground uppercase">State</p>
                <p className={`mt-1 font-bold ${health.sync.circuitBreaker.open ? "text-rose-700" : "text-emerald-700"}`}>
                  {health.sync.circuitBreaker.open ? "OPEN" : "CLOSED"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-muted-foreground uppercase">Consecutive Failures</p>
                <p className="mt-1 font-bold text-foreground">{health.sync.circuitBreaker.consecutiveCriticalFailures}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-muted-foreground uppercase">Threshold</p>
                <p className="mt-1 font-bold text-foreground">{health.sync.circuitBreaker.failureThreshold}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-muted-foreground uppercase">Cooldown</p>
                <p className="mt-1 font-bold text-foreground">{Math.round(health.sync.circuitBreaker.cooldownMs / 1000)} s</p>
              </div>
            </div>
            {health.sync.circuitBreaker.reason && (
              <p className="text-xs text-amber-700 mt-3">Reason: {health.sync.circuitBreaker.reason}</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">Recent Sync History</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-slate-200">
                    <th className="py-2 pr-4">Started</th>
                    <th className="py-2 pr-4">Source</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Duration</th>
                    <th className="py-2 pr-4">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr>
                      <td className="py-4 text-muted-foreground" colSpan={5}>No sync history yet.</td>
                    </tr>
                  ) : (
                    history.map((item) => {
                      const statusClass =
                        item.status === "SUCCESS"
                          ? "text-emerald-700 bg-emerald-100"
                          : item.status === "SKIPPED"
                            ? "text-amber-700 bg-amber-100"
                            : "text-rose-700 bg-rose-100";

                      return (
                        <tr key={item.id} className="border-b border-slate-100">
                          <td className="py-2 pr-4 text-foreground">{new Date(item.startedAt).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-foreground">{item.source}</td>
                          <td className="py-2 pr-4">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusClass}`}>{item.status}</span>
                          </td>
                          <td className="py-2 pr-4 text-foreground">{formatDuration(item.durationMs)}</td>
                          <td className="py-2 pr-4 text-muted-foreground max-w-[380px] truncate" title={item.error || ""}>
                            {item.error || "-"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
