import { useState, useMemo, useEffect } from "react";
import { CloudDownload, Link2, Unlink, Info, AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";
import { gradesApi, type AimsScoresResponse, type AimsCourseSummary } from "@/lib/api";

interface AimsPanelProps {
  classAssignmentId: string;
  selectedTerm: string;
  aimsData: AimsScoresResponse | null;
  isViewOnly: boolean;
  onImportComplete: () => void;
  /** R2-1: Increment this number to open the link dialog from outside (e.g. Hero badge) */
  openLinkDialogSignal?: number;
}

export function AimsPanel({ classAssignmentId, selectedTerm, aimsData, isViewOnly, onImportComplete, openLinkDialogSignal }: AimsPanelProps) {
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [courseIdInput, setCourseIdInput] = useState("");
  const [linking, setLinking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAssessments, setSelectedAssessments] = useState<Set<string>>(new Set());
  const [availableCourses, setAvailableCourses] = useState<AimsCourseSummary[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [selectedPickerId, setSelectedPickerId] = useState<string>("");
  const [coursesScope, setCoursesScope] = useState<"teacher" | "school" | "none">("none");
  // R2-2: Track warnings + pending courseId separately (don't commit until confirmed)
  const [pendingWarnings, setPendingWarnings] = useState<string[] | null>(null);
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null);

  const linked = aimsData?.linked ?? false;
  const course = aimsData?.course;
  const assessments = aimsData?.assessments ?? [];
  const unmatchedStudents = aimsData?.unmatchedStudents ?? [];
  const lastSyncedAt = aimsData?.lastSyncedAt;
  const aimsOffline = aimsData?.aimsOffline ?? true;
  const warnings = aimsData?.warnings ?? [];

  // R2-1: Open link dialog when signal changes
  useEffect(() => {
    if (openLinkDialogSignal && openLinkDialogSignal > 0) {
      openLinkDialog();
    }
  }, [openLinkDialogSignal]);

  const openLinkDialog = async () => {
    setShowLinkDialog(true);
    setCoursesLoading(true);
    try {
      const res = await gradesApi.getAimsCourses();
      setAvailableCourses(res.data.courses ?? []);
      setCoursesScope(res.data.scope ?? "none");
    } catch {
      setAvailableCourses([]);
      setCoursesScope("none");
    } finally {
      setCoursesLoading(false);
    }
  };

  const openImportDialog = () => {
    // Default selection: all assessments including QA
    setSelectedAssessments(new Set(assessments.map((a) => a.assessmentId)));
    setShowImportDialog(true);
  };

  // R2-2: Pre-validate then link pattern
  const handleLink = async () => {
    const courseId = selectedPickerId || courseIdInput.trim();
    if (!courseId) return;

    // R2-2: Link first; if warnings, offer undo on cancel
    setLinking(true);
    try {
      // R2-2: Link first; if warnings, offer undo on cancel
      const res = await gradesApi.linkAims(classAssignmentId, courseId);
      if (res.data.warnings?.length > 0) {
        // R2-2: Store warnings + courseId; link is committed but user can undo
        setPendingWarnings(res.data.warnings);
        setPendingCourseId(courseId);
      } else {
        toast.success("AIMS course connected successfully");
        closeLinkDialog();
        onImportComplete();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to link AIMS course");
    } finally {
      setLinking(false);
    }
  };

  // R2-2: Confirm link despite warnings
  const confirmLinkDespiteWarnings = () => {
    setPendingWarnings(null);
    setPendingCourseId(null);
    toast.success("AIMS course connected (with warnings)");
    closeLinkDialog();
    onImportComplete();
  };

  // R2-2: Cancel link — undo the link
  const cancelLinkDespiteWarnings = async () => {
    if (pendingCourseId) {
      try {
        await gradesApi.unlinkAims(classAssignmentId);
      } catch {
        // Non-fatal — link may not have persisted
      }
    }
    setPendingWarnings(null);
    setPendingCourseId(null);
    toast.info("Connection cancelled");
  };

  const closeLinkDialog = () => {
    setShowLinkDialog(false);
    setCourseIdInput("");
    setSelectedPickerId("");
  };

  const handleUnlink = async () => {
    try {
      await gradesApi.unlinkAims(classAssignmentId);
      toast.success("AIMS course disconnected");
      onImportComplete();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to disconnect AIMS course");
    }
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
      setShowImportDialog(false);
      onImportComplete();
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
      if (status === 'ok' && scoresUpserted > 0) {
        toast.success(`Synced ${scoresUpserted} new score(s)`);
      } else if (status === 'ok') {
        toast.info('No new scores');
      } else {
        toast.info('AIMS offline — try again later');
      }
      onImportComplete();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to sync from AIMS");
    } finally {
      setRefreshing(false);
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
    for (const row of aimsData?.rows ?? []) {
      for (const score of row.scores) {
        if (score.importedAt) ids.add(score.assessmentId);
      }
    }
    return ids.size;
  }, [aimsData]);

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

  // ── Unlinked state ──────────────────────────────────────────────────
  if (!linked) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-6 flex items-center gap-4">
        <div className="p-3 rounded-xl bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)]">
          <CloudDownload className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">AIMS LMS Integration</p>
          <p className="text-xs text-muted-foreground mt-0.5">Connect an AIMS course to sync assessment scores into your class record.</p>
        </div>
        <Button variant="outline" size="sm" onClick={openLinkDialog} className="gap-1.5">
          <Link2 className="w-4 h-4" />
          Connect AIMS Course
        </Button>

        <Dialog open={showLinkDialog} onOpenChange={(open) => { if (!open) closeLinkDialog(); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Connect AIMS Course</DialogTitle>
              <DialogDescription>
                Select a course from AIMS or enter a course ID manually.
              </DialogDescription>
            </DialogHeader>

            {coursesLoading && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading courses from AIMS...
              </p>
            )}
            {availableCourses.length > 0 && (
              <div className="space-y-2">
                <Label>Select a course</Label>
                {coursesScope === "school" && (
                  <p className="text-xs text-muted-foreground">
                    Couldn't match your courses by email — showing all current school-year courses.
                  </p>
                )}
                <div className="max-h-40 overflow-y-auto space-y-1.5 rounded-lg border border-border p-2">
                  {availableCourses.map((c) => (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${selectedPickerId === c.id ? "bg-[var(--ledger-aims-bg)] border border-[var(--ledger-aims)]" : "hover:bg-accent/50 border border-transparent"}`}
                    >
                      <input
                        type="radio"
                        name="aims-course"
                        checked={selectedPickerId === c.id}
                        onChange={() => setSelectedPickerId(c.id)}
                        className="h-3.5 w-3.5"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{c.code} — {c.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {c.subject} · {c.sectionName} · {c.schoolYear}{c.gradeLevel ? ` · ${c.gradeLevel}` : ''}
                          {c.teacherName !== undefined && ` · ${c.teacherName ?? 'Unassigned'}`}
                          {c.studentCount !== undefined && ` · ${c.studentCount} students`}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {!coursesLoading && availableCourses.length === 0 && (
              <p className="text-xs text-muted-foreground">No courses available from AIMS. Enter a course ID manually below.</p>
            )}

            <div className="space-y-2">
              <Label htmlFor="aims-course-id">Or enter AIMS Course ID manually</Label>
              <Input
                id="aims-course-id"
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                value={courseIdInput}
                onChange={(e) => { setCourseIdInput(e.target.value); setSelectedPickerId(""); }}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeLinkDialog}>Cancel</Button>
              <Button onClick={handleLink} disabled={linking || (!selectedPickerId && !courseIdInput.trim())} className="gap-1.5">
                {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Connect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* R2-2: Warnings confirm dialog — cancel actually unlinks */}
        <Dialog open={pendingWarnings !== null} onOpenChange={(open) => { if (!open) cancelLinkDespiteWarnings(); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Connect with Warnings</DialogTitle>
              <DialogDescription>The AIMS course doesn't fully match this class:</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {pendingWarnings?.map((w, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-primary/5 border border-border">
                  <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground">{w}</p>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={cancelLinkDespiteWarnings}>Cancel</Button>
              <Button onClick={confirmLinkDespiteWarnings}>Connect Anyway</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Linked state ────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)]">
            <CloudDownload className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground">
                AIMS: {course?.code || "Unknown"} — {course?.name || "Unknown Course"}
              </span>
              {aimsOffline && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-foreground border border-border">
                  Offline
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {course?.subject} · {course?.sectionName} · {course?.schoolYear}
              {relativeSyncTime && ` · synced ${relativeSyncTime}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-1.5">
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </Button>
          {assessments.length > 0 && (
            <Button variant="outline" size="sm" onClick={openImportDialog} className="gap-1.5" disabled={isViewOnly}>
              <CloudDownload className="w-4 h-4" />
              Import to Ledger
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleUnlink} className="gap-1.5 text-muted-foreground hover:text-destructive" disabled={isViewOnly}>
            <Unlink className="w-4 h-4" />
            Disconnect
          </Button>
        </div>
      </div>

      {/* Persistent warnings (from GET, not just link-time) */}
      {warnings.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-primary/5 border border-border">
          <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-foreground">{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* Unmatched students warning */}
      {unmatchedStudents.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-primary/5 border border-border">
          <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-foreground">
              {unmatchedStudents.length} unmatched student(s) — EnrollPro backfill pending
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {unmatchedStudents.slice(0, 5).map((u, idx) => (
                <span key={u.enrollproId ?? `${u.studentName}-${idx}`} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-foreground">
                  {u.studentName} ({u.enrollproId != null ? `EP #${u.enrollproId}` : 'no EP ID'})
                </span>
              ))}
              {unmatchedStudents.length > 5 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-foreground">
                  +{unmatchedStudents.length - 5} more
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Assessment summary */}
      {assessments.length > 0 && (
        <div className={`flex items-center gap-2 text-xs ${importedCount < assessments.length ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
          <Info className="w-3.5 h-3.5" />
          <span>
            {importedCount < assessments.length
              ? `${assessments.length - importedCount} assessment(s) ready to import — grades won't compute until imported`
              : `${assessments.length} assessment(s) · all imported`
            }
          </span>
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import AIMS Scores to Ledger</DialogTitle>
            <DialogDescription>
              Select assessments to import for {selectedTerm}. Imported scores append as new ledger columns; existing scores are never overwritten.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-60 overflow-y-auto">
            {assessments.map((a) => {
              const isQA = a.category === "QA";
              const hasImported = aimsData?.rows?.some((r) => r.scores.some((s) => s.assessmentId === a.assessmentId && s.importedAt));
              return (
                <label key={a.assessmentId} className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-accent/50 cursor-pointer">
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
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Imports to the TA column. If you already entered a QA score, yours is kept (AIMS QA stays available to import later).
                      </p>
                    )}
                  </div>
                  {hasImported && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)]">
                      <Check className="w-3 h-3 inline mr-0.5" />
                      Imported — re-run adds newly synced scores
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importing || selectedAssessments.size === 0} className="gap-1.5">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
              Import {selectedAssessments.size} Assessment(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
