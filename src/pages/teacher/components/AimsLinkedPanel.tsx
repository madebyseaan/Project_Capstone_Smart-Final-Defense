import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CloudDownload, Info, Loader2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { gradesApi, type AimsScoresResponse } from "@/lib/api";

interface AimsLinkedPanelProps {
  classAssignmentId: string;
  selectedTerm: string;
  aimsData: AimsScoresResponse;
  isViewOnly: boolean;
  onChanged: () => void;
  onClose: () => void;
}

export function AimsLinkedPanel({ classAssignmentId, selectedTerm, aimsData, isViewOnly, onChanged, onClose }: AimsLinkedPanelProps) {
  const [view, setView] = useState<"manage" | "import">("manage");
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [selectedAssessments, setSelectedAssessments] = useState<Set<string>>(new Set());

  const course = aimsData.course;
  const assessments = aimsData.assessments ?? [];
  const unmatchedStudents = aimsData.unmatchedStudents ?? [];
  const warnings = aimsData.warnings ?? [];
  const aimsOffline = aimsData.aimsOffline ?? true;
  const lastSyncedAt = aimsData.lastSyncedAt;

  const relativeSyncTime = useMemo(() => {
    if (!lastSyncedAt) return null;
    const diff = Date.now() - new Date(lastSyncedAt).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }, [lastSyncedAt]);

  const openImportView = () => {
    setSelectedAssessments(new Set(assessments.map((a) => a.assessmentId)));
    setView("import");
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await gradesApi.importAims(classAssignmentId, selectedTerm, Array.from(selectedAssessments));
      const { savedCount, skipped } = res.data;
      const parts = [`${savedCount} student(s) imported`];
      if (skipped.finalized > 0) parts.push(`${skipped.finalized} finalized (skipped)`);
      if (skipped.archived > 0) parts.push(`${skipped.archived} archived (skipped)`);
      if (skipped.notFound > 0) parts.push(`${skipped.notFound} not found (skipped)`);
      if (skipped.alreadyImported > 0) parts.push(`${skipped.alreadyImported} already imported`);
      if (res.data.qaSkippedOccupied > 0) parts.push(`${res.data.qaSkippedOccupied} QA kept (teacher score exists)`);
      toast.success(parts.join(", "));
      setView("manage");
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to import AIMS scores");
    } finally {
      setImporting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await gradesApi.syncAims(classAssignmentId);
      const { status, scoresUpserted } = res.data;
      if (status === "ok" && scoresUpserted > 0) {
        toast.success(`Synced ${scoresUpserted} new score(s)`);
      } else if (status === "ok") {
        toast.info("No new scores");
      } else {
        toast.info("AIMS offline — try again later");
      }
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to sync from AIMS");
    } finally {
      setRefreshing(false);
    }
  };

  const handleUnlink = async () => {
    setDisconnecting(true);
    try {
      await gradesApi.unlinkAims(classAssignmentId);
      toast.success("AIMS course disconnected");
      onChanged();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to disconnect AIMS course");
    } finally {
      setDisconnecting(false);
    }
  };

  const toggleAssessment = (id: string) => {
    setSelectedAssessments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importedCount = useMemo(() => {
    const ids = new Set<string>();
    for (const row of aimsData.rows ?? []) {
      for (const score of row.scores) {
        if (score.importedAt) ids.add(score.assessmentId);
      }
    }
    return ids.size;
  }, [aimsData]);

  // ── Import view ────────────────────────────────────────────────────
  if (view === "import") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Import AIMS Scores to Ledger</DialogTitle>
          <DialogDescription>
            Select assessments to import for {selectedTerm}. Imported scores append as new ledger columns; existing scores are never overwritten.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {assessments.map((a) => {
            const isQA = a.category === "QA";
            const hasImported = aimsData.rows?.some((r) => r.scores.some((s) => s.assessmentId === a.assessmentId && s.importedAt));
            return (
              <label key={a.assessmentId} className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-accent/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedAssessments.has(a.assessmentId)}
                  onChange={() => toggleAssessment(a.assessmentId)}
                  className="h-4 w-4 rounded border-border text-[var(--ledger-aims)] focus:ring-[var(--ledger-aims)]"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className={`font-semibold ${a.category === "WW" ? "text-[var(--ledger-ww)]" : a.category === "QA" ? "text-[var(--ledger-ta)]" : "text-[var(--ledger-pt)]"}`}>
                      {a.category}
                    </span>
                    {" · "}
                    {a.type} · Max: {a.maxPoints}
                  </p>
                  {isQA && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Imports to the TA column. If you already entered a QA score, yours is kept (AIMS QA stays available to import later).
                    </p>
                  )}
                </div>
                {hasImported && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)]">
                    <Check className="w-3 h-3 inline mr-0.5" />
                    Imported
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setView("manage")} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <Button onClick={handleImport} disabled={importing || selectedAssessments.size === 0} className="gap-1.5">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
            Import {selectedAssessments.size} Assessment(s)
          </Button>
        </DialogFooter>
      </>
    );
  }

  // ── Manage view ────────────────────────────────────────────────────
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          AIMS LMS Integration
          {aimsOffline && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
              Offline
            </span>
          )}
        </DialogTitle>
        <DialogDescription>
          {course?.code ? `${course.code} — ${course.name} · ` : ""}
          {course?.subject} · {course?.sectionName} · {course?.schoolYear}
          {relativeSyncTime ? ` · synced ${relativeSyncTime}` : ""}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-1.5">
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </Button>
        {assessments.length > 0 && (
          <Button variant="outline" size="sm" onClick={openImportView} className="gap-1.5" disabled={isViewOnly}>
            <CloudDownload className="w-4 h-4" />
            Import to Ledger
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={handleUnlink} disabled={isViewOnly || disconnecting} className="gap-1.5 text-muted-foreground hover:text-destructive">
          {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
          Disconnect
        </Button>
      </div>

      {warnings.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/50 border border-border">
          <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-foreground">{w}</p>
            ))}
          </div>
        </div>
      )}

      {unmatchedStudents.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/50 border border-border">
          <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-foreground">
              {unmatchedStudents.length} unmatched student(s) — EnrollPro backfill pending
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {unmatchedStudents.slice(0, 5).map((u, idx) => (
                <span key={u.enrollproId ?? `${u.studentName}-${idx}`} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-foreground">
                  {u.studentName} ({u.enrollproId != null ? `EP #${u.enrollproId}` : "no EP ID"})
                </span>
              ))}
              {unmatchedStudents.length > 5 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-foreground">
                  +{unmatchedStudents.length - 5} more
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {assessments.length > 0 && (
        <div className={`flex items-center gap-2 text-xs ${importedCount < assessments.length ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
          <Info className="w-3.5 h-3.5" />
          <span>
            {importedCount < assessments.length
              ? `${assessments.length - importedCount} assessment(s) ready to import — grades won't compute until imported`
              : `${assessments.length} assessment(s) · all imported`}
          </span>
        </div>
      )}
    </>
  );
}
