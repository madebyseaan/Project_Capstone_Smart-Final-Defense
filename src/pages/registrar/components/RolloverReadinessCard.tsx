import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, GraduationCap, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { registrarApi } from "@/lib/api";

interface RolloverStatus {
  currentSY: { id: string; label: string; status: string } | null;
  previousYear: { id: string; label: string; status: string } | null;
  unfinalizedCount: number;
  unfinalizedSections: Array<{ sectionId: string; sectionName: string; gradeLevel: string; draftBlockerCount: number }>;
  snapshotGapCount: number;
  snapshotGapSections: Array<{ sectionId: string; sectionName: string; finalizedCount: number; snapshotCount: number }>;
  canArchive: boolean;
}

export default function RolloverReadinessCard() {
  const [status, setStatus] = useState<RolloverStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await registrarApi.getRolloverStatus();
      setStatus(res.data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const prev = status?.previousYear;

  const hasBlockers = (status?.unfinalizedCount ?? 0) > 0 || (status?.snapshotGapCount ?? 0) > 0;

  return (
    <Card className="border border-border shadow-sm rounded-2xl bg-card/70 backdrop-blur-xl p-0 overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">School Year Status</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Active: {status?.currentSY?.label ?? "—"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking previous year...</span>
          </div>
        ) : !status ? (
          <p className="text-sm text-muted-foreground py-2">Unable to load school year status.</p>
        ) : !prev ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium text-emerald-800">All previous school years are archived — you're all caught up.</p>
          </div>
        ) : prev.status === "ARCHIVED" ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium text-emerald-800">{prev.label} has been archived.</p>
          </div>
        ) : (
          <div className={`p-3 rounded-xl ${hasBlockers ? "bg-amber-50 border border-amber-200" : "bg-emerald-50 border border-emerald-200"}`}>
            {hasBlockers ? (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">
                    {prev.label} is not ready to archive
                  </p>
                  {status.unfinalizedCount > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      {status.unfinalizedCount} section(s) not EOSY-finalized (grades still in draft).
                    </p>
                  )}
                  {status.snapshotGapCount > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      {status.snapshotGapCount} section(s) missing EOSY promotion snapshots.
                    </p>
                  )}
                  <Link to="/registrar/eosy" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 mt-2 hover:underline">
                    Finish EOSY finalization <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <p className="text-sm font-medium text-emerald-800">
                  {prev.label} is fully finalized — ready for the admin to archive.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}