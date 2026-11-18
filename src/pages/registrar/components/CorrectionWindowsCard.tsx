import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  registrarApi,
  type CorrectionSummary,
  type CorrectionWindowItem,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { CorrectionReviewModal } from "./CorrectionReviewModal";

interface CorrectionWindowsCardProps {
  schoolYear?: string;
  onChanged?: () => void;
}

const EMPTY_SUMMARY: CorrectionSummary = {
  awaitingWindow: 0,
  windowOpen: 0,
  needsRefinalization: 0,
  total: 0,
};

function statusBadge(item: CorrectionWindowItem) {
  if (item.displayStatus === "APPROVED") {
    return <Badge className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">Awaiting window</Badge>;
  }
  if (item.displayStatus === "WINDOW_OPEN") {
    return <Badge className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">Window open</Badge>;
  }
  if (item.displayStatus === "EXPIRED") {
    return <Badge className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">Needs re-finalization</Badge>;
  }
  if (item.displayStatus === "DECLINED") {
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">Declined</Badge>;
  }
  return <Badge variant="outline" className="text-[10px] text-emerald-700">Re-finalized</Badge>;
}

export function CorrectionWindowsCard({ schoolYear, onChanged }: CorrectionWindowsCardProps) {
  const [items, setItems] = useState<CorrectionWindowItem[]>([]);
  const [summary, setSummary] = useState<CorrectionSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewItem, setReviewItem] = useState<CorrectionWindowItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<CorrectionWindowItem | null>(null);
  const [declineItem, setDeclineItem] = useState<CorrectionWindowItem | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await registrarApi.getEditRequests(schoolYear ? { schoolYear } : undefined);
        setItems(res.data.items);
        setSummary(res.data.summary);
        setError(null);
      } catch {
        if (!silent) setError("Unable to load correction windows.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [schoolYear],
  );

  useEffect(() => {
    void load(false);
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const visible = useMemo(
    () => items.filter((item) => item.displayStatus !== "REFINALIZED").slice(0, 6),
    [items],
  );

  const openWindow = async (item: CorrectionWindowItem) => {
    setBusyId(item.id);
    try {
      const res = await registrarApi.openEditWindow(item.id);
      toast.success(res.data.message);
      setConfirmOpen(null);
      await load(true);
      onChanged?.();
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(message || "Failed to open the correction window.");
    } finally {
      setBusyId(null);
    }
  };

  const declineWindow = async (item: CorrectionWindowItem) => {
    setBusyId(item.id);
    try {
      const res = await registrarApi.declineEditWindow(item.id);
      toast.success(res.data.message);
      setDeclineItem(null);
      await load(true);
      onChanged?.();
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(message || "Failed to decline the correction request.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Card className="p-4" data-testid="registrar-correction-windows">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Grade Correction Windows</h3>
              <p className="text-xs text-muted-foreground">
                Approved corrections need a registrar-opened window and re-finalization.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              {summary.awaitingWindow} awaiting
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {summary.windowOpen} open
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {summary.needsRefinalization} to re-finalize
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => void load(false)}
              aria-label="Refresh correction windows"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading correction windows...</span>
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{error}</p>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No correction windows. All finalized grades are sealed.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-border rounded-lg border border-border">
            {visible.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{item.teacherName}</span>
                    {statusBadge(item)}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.section ?? "Section"} · {item.subject ?? "Subject"} · {item.term}
                    {item.displayStatus === "WINDOW_OPEN" && item.minutesRemaining != null
                      ? ` · ${Math.ceil(item.minutesRemaining / 60)}h left`
                      : item.displayStatus === "EXPIRED" && item.unfinalizedGradeCount > 0
                        ? ` · ${item.unfinalizedGradeCount} grade(s) edited`
                        : ""}
                  </p>
                  <p className="mt-0.5 max-w-xl truncate text-xs text-muted-foreground" title={item.reason}>
                    Reason: {item.reason}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {item.displayStatus === "APPROVED" && (
                    <>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busyId === item.id}
                        onClick={() => setConfirmOpen(item)}
                      >
                        {busyId === item.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Clock className="mr-1 h-3 w-3" />
                        )}
                        Open window
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        disabled={busyId === item.id}
                        onClick={() => setDeclineItem(item)}
                      >
                        Decline
                      </Button>
                    </>
                  )}
                  {item.displayStatus !== "APPROVED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setReviewItem(item)}
                    >
                      Review
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex justify-end">
          <Link
            to="/registrar/term-finalization?filter=corrections"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open Term Finalization
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </Card>

      <CorrectionReviewModal
        open={!!reviewItem}
        onOpenChange={(next) => {
          if (!next) setReviewItem(null);
        }}
        request={reviewItem}
        onChanged={() => {
          void load(true);
          onChanged?.();
        }}
      />

      <ConfirmDialog
        open={!!confirmOpen}
        onOpenChange={(next) => {
          if (!next && !busyId) setConfirmOpen(null);
        }}
        title="Open the correction edit window?"
        description={
          confirmOpen
            ? `This will temporarily unfinalize ${confirmOpen.unfinalizedGradeCount || "the scoped"} grade(s) for ${confirmOpen.teacherName} and start a ${confirmOpen.approvedHours ?? 24}h window. Grades stay DRAFT after it ends until you re-finalize.`
            : ""
        }
        confirmLabel="Open window"
        loading={!!busyId}
        onConfirm={() => {
          if (confirmOpen) void openWindow(confirmOpen);
        }}
      />

      <ConfirmDialog
        open={!!declineItem}
        onOpenChange={(next) => {
          if (!next && !busyId) setDeclineItem(null);
        }}
        title="Decline this correction request?"
        description={
          declineItem
            ? `The request from ${declineItem.teacherName} will be declined. No grades will be unfinalized.`
            : ""
        }
        confirmLabel="Decline request"
        destructive
        loading={!!busyId}
        onConfirm={() => {
          if (declineItem) void declineWindow(declineItem);
        }}
      />
    </>
  );
}
