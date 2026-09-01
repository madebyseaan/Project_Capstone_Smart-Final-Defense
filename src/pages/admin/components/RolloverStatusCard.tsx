import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2, Archive, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { adminApi } from "@/lib/api";

interface RolloverStatus {
  currentSY: { id: string; label: string; status: string } | null;
  previousYear: { id: string; label: string; status: string } | null;
  unfinalizedCount: number;
  unfinalizedSections: Array<{ sectionId: string; sectionName: string; gradeLevel: string; draftBlockerCount: number }>;
  canArchive: boolean;
}

export default function RolloverStatusCard() {
  const [status, setStatus] = useState<RolloverStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getRolloverStatus();
      setStatus(res.data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleArchive = async () => {
    if (!status?.previousYear) return;
    if (!window.confirm(`Archive ${status.previousYear.label}? This will lock all grades, archive enrollments, and mark sections as completed.`)) return;
    setArchiving(true);
    setMessage(null);
    try {
      const res = await adminApi.archiveYear(status.previousYear.id);
      setMessage(res.data.message);
      void load();
    } catch (err: any) {
      setMessage(err?.response?.data?.message ?? "Failed to archive");
    } finally {
      setArchiving(false);
      setTimeout(() => setMessage(null), 6000);
    }
  };

  return (
    <div className="mb-8 p-4 rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Archive className="w-4 h-4 text-gray-600" />
          <Label className="text-sm font-semibold text-gray-700">Rollover Status</Label>
        </div>
        <div className="flex items-center gap-2">
          {message && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${message.includes("Fail") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
              {message}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading rollover status...</span>
        </div>
      ) : !status ? (
        <p className="text-sm text-gray-400">Unable to load rollover status.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-gray-500">Active Year: </span>
              <span className="font-semibold text-gray-900">{status.currentSY?.label ?? "—"}</span>
              {status.currentSY && <Badge variant="outline" className="ml-2 text-xs">{status.currentSY.status}</Badge>}
            </div>
            {status.previousYear && (
              <div>
                <span className="text-gray-500">Previous: </span>
                <span className="font-medium text-gray-700">{status.previousYear.label}</span>
                <Badge variant="outline" className="ml-2 text-xs">{status.previousYear.status}</Badge>
              </div>
            )}
          </div>

          {status.previousYear && status.previousYear.status !== "ARCHIVED" && (
            <div className={`p-3 rounded-lg ${status.unfinalizedCount > 0 ? "bg-amber-50 border border-amber-200" : "bg-emerald-50 border border-emerald-200"}`}>
              {status.unfinalizedCount > 0 ? (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">{status.unfinalizedCount} section(s) unfinalized in {status.previousYear.label}</p>
                    <ul className="text-xs text-amber-700 mt-1 space-y-0.5">
                      {status.unfinalizedSections.slice(0, 5).map((s) => (
                        <li key={s.sectionId}>{s.sectionName} ({s.gradeLevel}) — {s.draftBlockerCount} DRAFT blocker(s)</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <p className="text-sm font-medium text-emerald-800">{status.previousYear.label} is fully finalized — ready to archive</p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={archiving}
                    onClick={() => void handleArchive()}
                  >
                    {archiving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Archive className="w-3.5 h-3.5 mr-1" />}
                    Archive Now
                  </Button>
                </div>
              )}
            </div>
          )}

          {status.previousYear?.status === "ARCHIVED" && (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-sm text-gray-600">{status.previousYear.label} has been archived.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
