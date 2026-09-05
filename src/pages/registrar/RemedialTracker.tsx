import { useState, useEffect, useCallback, Fragment, useMemo } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  CloudDownload,
  FlaskConical,
  Users,
  Clock,
  CheckCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { registrarApi } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { LoadingSkeleton, EmptyState } from "@/components/data-table";
import { toast } from "@/lib/toast";
import { RemedialHistoryTable } from "./components/RemedialHistoryTable";
import { CompleteRemedialDialog, type PendingSubject } from "./components/CompleteRemedialDialog";
import {
  RemedialStudentRow,
  RemedialExpandedPanel,
  type RemedialStudent,
} from "./components/RemedialStudentRow";
import { SyncProgressModal } from "@/components/common/SyncProgressModal";

const EMPTY_SUBJECTS: PendingSubject[] = [];

export default function RemedialTracker() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<RemedialStudent[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Edit state for expanded row
  const [editMarks, setEditMarks] = useState<Record<string, number | "">>({});
  const [conductedFrom, setConductedFrom] = useState(() => localStorage.getItem("remedial_conductedFrom") ?? "");
  const [conductedTo, setConductedTo] = useState(() => localStorage.getItem("remedial_conductedTo") ?? "");
  const [savingAndCompleting, setSavingAndCompleting] = useState(false);
  const [confirmDialogStudent, setConfirmDialogStudent] = useState<RemedialStudent | null>(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [syncError, setSyncError] = useState<string | undefined>();
  const [schoolYears, setSchoolYears] = useState<string[]>([]);
  const [selectedSY, setSelectedSY] = useState<string>("");
  const [viewMode, setViewMode] = useState<"pending" | "history">("pending");
  const [historyItems, setHistoryItems] = useState<RemedialStudent[]>([]);
  const [historyMeta, setHistoryMeta] = useState<{ total: number; totalPages: number }>({ total: 0, totalPages: 1 });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyYearFilter, setHistoryYearFilter] = useState<string>("all");

  const load = useCallback(async (p = 1, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await registrarApi.getRemedialPending({ page: p, limit: 500, schoolYear: selectedSY || undefined });
      const payload = res.data as { items?: RemedialStudent[]; meta?: { total: number; totalPages: number } };
      const items = payload.items ?? [];
      setItems(items);

      // Auto-sync from EnrollPro if list is empty on first load and selected SY is the active (latest) SY
      const activeSY = schoolYears.length > 0 ? schoolYears[schoolYears.length - 1] : null;
      if (items.length === 0 && p === 1 && !silent && selectedSY && selectedSY === activeSY) {
        setSyncStatus("syncing");
        try {
          await registrarApi.syncRemedialFromEnrollPro(selectedSY);
          const retry = await registrarApi.getRemedialPending({ page: 1, limit: 500, schoolYear: selectedSY });
          const retryPayload = retry.data as { items?: RemedialStudent[]; meta?: { total: number; totalPages: number } };
          setItems(retryPayload.items ?? []);
          if ((retryPayload.items ?? []).length > 0) {
            toast.success(`Synced ${(retryPayload.items ?? []).length} learner(s) from EnrollPro`);
          }
        } catch {
          // Silently ignore — manual Sync button still available
        } finally {
          setSyncStatus("idle");
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load remedial data.";
      setError(message);
      setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedSY, schoolYears]);

  const loadHistory = useCallback(async (p = 1) => {
    setHistoryLoading(true);
    try {
      const params: { schoolYear?: string; page?: number; limit?: number } = { page: p, limit: 500 };
      if (historyYearFilter !== "all") params.schoolYear = historyYearFilter;
      const res = await registrarApi.getRemedialHistory(params);
      const payload = res.data as { items?: RemedialStudent[]; meta?: { total: number; totalPages: number } };
      setHistoryItems(payload.items ?? []);
      setHistoryMeta(payload.meta ?? { total: 0, totalPages: 1 });
    } catch {
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyYearFilter]);

  useEffect(() => {
    if (viewMode === "pending") {
      void load(page);
    } else {
      void loadHistory(page);
    }
  }, [page, load, loadHistory, viewMode]);

  useEffect(() => {
    registrarApi.getSchoolYears().then((res) => {
      const data = res.data as { schoolYears?: string[]; activeSchoolYear?: string | null };
      const years = data.schoolYears ?? [];
      setSchoolYears(years);
      if (years.length > 0 && !selectedSY) {
        const active = data.activeSchoolYear;
        setSelectedSY(active && years.includes(active) ? active : years[0]);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (conductedFrom) localStorage.setItem("remedial_conductedFrom", conductedFrom);
  }, [conductedFrom]);

  useEffect(() => {
    if (conductedTo) localStorage.setItem("remedial_conductedTo", conductedTo);
  }, [conductedTo]);

  const handleSync = async () => {
    const confirmed = window.confirm(
      "Pull conditionally promoted students and their back-subjects from EnrollPro?\n\n" +
      "This will:\n" +
      "- Create CONDITIONALLY_PROMOTED enrollment tags\n" +
      "- Create remedial class records for each failed subject\n" +
      "- Existing records are not overwritten"
    );
    if (!confirmed) return;
    setSyncModalOpen(true);
    setSyncStatus("syncing");
    setSyncError(undefined);
    try {
      const res = await registrarApi.syncRemedialFromEnrollPro();
      const result = res.data as { fetched: number; matched: number; enrollmentsUpdated: number; remedialCreated: number; studentsNotFound?: string[] };
      toast.success(
        `Sync complete: ${result.fetched} fetched, ${result.remedialCreated} remedial records created`
      );
      setSyncStatus("success");
      await load(page, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to sync from EnrollPro";
      setSyncStatus("error");
      setSyncError(message);
    }
  };

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((item) => {
      const name = `${item.lastName ?? ""} ${item.firstName ?? ""}`.toLowerCase();
      const lrn = String(item.lrn ?? "");
      return name.includes(q) || lrn.includes(q);
    });
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * limit, page * limit),
    [filtered, page, limit]
  );

  const stats = useMemo(() => {
    const pendingRows = filtered.reduce(
      (n, i) => n + i.remedialClasses.filter((rc) => rc.status === "PENDING").length,
      0
    );
    const completedRows = filtered.reduce(
      (n, i) => n + i.remedialClasses.filter((rc) => rc.status === "COMPLETED").length,
      0
    );
    return {
      total: filtered.length,
      pending: filtered.filter((i) =>
        i.remedialClasses.some((rc) => rc.status === "PENDING")
      ).length,
      completed: filtered.filter((i) =>
        i.remedialClasses.every((rc) => rc.status === "COMPLETED")
      ).length,
      pendingRows,
      completedRows,
    };
  }, [filtered]);

  const toggleExpand = useCallback((enrollmentId: string) => {
    setExpandedId((prev) => (prev === enrollmentId ? null : enrollmentId));
    setEditMarks({});
  }, []);

  const handleMarkChange = useCallback((rcId: string, value: string) => {
    if (value === "") {
      setEditMarks((prev) => ({ ...prev, [rcId]: "" }));
      return;
    }
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setEditMarks((prev) => ({ ...prev, [rcId]: num }));
    }
  }, []);

  // Check if a student's pending rows all have valid RCM and dates
  const canComplete = useCallback((student: RemedialStudent): { ok: boolean; reason?: string } => {
    const pendingRows = student.remedialClasses.filter((rc) => rc.status === "PENDING");
    const missingRcm = pendingRows.filter((rc) => {
      const mark = editMarks[rc.id] ?? rc.remedialMark;
      return mark === null || mark === undefined || mark === "";
    });
    if (missingRcm.length > 0) {
      return { ok: false, reason: `Missing RCM: ${missingRcm.map((r) => r.subjectName).join(", ")}` };
    }
    const invalidRcm = pendingRows.filter((rc) => {
      const mark = editMarks[rc.id] ?? rc.remedialMark;
      return typeof mark === "number" && (mark < 60 || mark > 100);
    });
    if (invalidRcm.length > 0) {
      return { ok: false, reason: `RCM must be 60–100: ${invalidRcm.map((r) => r.subjectName).join(", ")}` };
    }
    if (!conductedFrom || !conductedTo) {
      return { ok: false, reason: "Conducted date range is required" };
    }
    return { ok: true };
  }, [editMarks, conductedFrom, conductedTo]);

  const handleSaveAndComplete = useCallback(async (student: RemedialStudent) => {
    // Guard: all pending rows must have RCM
    const pendingRows = student.remedialClasses.filter((rc) => rc.status === "PENDING");
    const missingRcm = pendingRows.filter((rc) => {
      const mark = editMarks[rc.id] ?? rc.remedialMark;
      return mark === null || mark === undefined || mark === "";
    });
    if (missingRcm.length > 0) {
      toast.error(`Missing RCM for: ${missingRcm.map((r) => r.subjectName).join(", ")}`);
      return;
    }

    // Guard: RCM must be 60-100
    const invalidRcm = pendingRows.filter((rc) => {
      const mark = editMarks[rc.id] ?? rc.remedialMark;
      return typeof mark === "number" && (mark < 60 || mark > 100);
    });
    if (invalidRcm.length > 0) {
      toast.error(`RCM must be 60–100 for: ${invalidRcm.map((r) => r.subjectName).join(", ")}`);
      return;
    }

    // Guard: conducted dates required
    if (!conductedFrom || !conductedTo) {
      toast.error("Set the conducted date range before completing.");
      return;
    }

    setSavingAndCompleting(true);
    try {
      // 1. One combined PATCH per row (mark + dates), all in parallel
      await Promise.all(
        student.remedialClasses.map((rc) => {
          const patch: { remedialMark?: number; conductedFrom: string; conductedTo: string } = {
            conductedFrom,
            conductedTo,
          };
          const mark = editMarks[rc.id];
          if (rc.status === "PENDING" && typeof mark === "number") {
            patch.remedialMark = mark;
          }
          return registrarApi.updateRemedialRow(rc.id, patch);
        })
      );

      // 2. Complete remedial
      const res = await registrarApi.completeRemedial(student.enrollmentId, {
        conductedFrom,
        conductedTo,
      });
      const result = res.data as { previousStatus: string; newStatus: string };
      toast.success(`Remedial completed: ${result.previousStatus} → ${result.newStatus}`);
      setConfirmDialogStudent(null);
      setEditMarks({});
      await load(page, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save & complete remedial";
      toast.error(message);
    } finally {
      setSavingAndCompleting(false);
    }
  }, [editMarks, conductedFrom, conductedTo, load, page]);

  const computeRfg = useCallback((original: number, rcm: number) =>
    Math.round(((original + rcm) / 2) * 10) / 10, []);

  // Stable dialog callbacks so the memoized dialog doesn't re-render on every keystroke
  const openConfirmDialog = useCallback((student: RemedialStudent) => {
    setConfirmDialogStudent(student);
  }, []);

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialogStudent(null);
  }, []);

  const handleDialogConfirm = useCallback((student: RemedialStudent) => {
    void handleSaveAndComplete(student);
  }, [handleSaveAndComplete]);

  // Dialog props (memoized)
  const dialogPendingSubjects = useMemo(() => {
    if (!confirmDialogStudent) return EMPTY_SUBJECTS;
    return confirmDialogStudent.remedialClasses
      .filter((rc) => rc.status === "PENDING")
      .map((rc) => {
        const raw = editMarks[rc.id] ?? rc.remedialMark;
        return {
          id: rc.id,
          subjectName: rc.subjectName,
          originalGrade: rc.originalGrade,
          effectiveMark: typeof raw === "number" ? raw : null,
        };
      });
  }, [confirmDialogStudent, editMarks]);

  const dialogValidation = useMemo(
    () => (confirmDialogStudent ? canComplete(confirmDialogStudent) : { ok: false }),
    [confirmDialogStudent, canComplete]
  );

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Remedial Tracker"
        description="Manage remedial classes for conditionally promoted students."
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void handleSync()}
              variant="default"
              size="sm"
              className="font-semibold text-xs shadow-sm shadow-primary/20"
              disabled={syncStatus === "syncing"}
            >
              <CloudDownload className="w-4 h-4 mr-1.5" />
              Sync from EnrollPro
            </Button>
            <Button
              onClick={() => void load(page)}
              variant="outline"
              size="sm"
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        }
      />

      {/* View Mode Tabs */}
      <div className="flex items-center gap-1 bg-muted p-1 rounded-lg w-fit">
        <button
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            viewMode === "pending" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { setViewMode("pending"); setPage(1); }}
        >
          Pending
        </button>
        <button
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            viewMode === "history" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { setViewMode("history"); setPage(1); }}
        >
          History
        </button>
      </div>

      {/* Stats Row + Pending Table */}
      {viewMode === "pending" && (<>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Students"
          value={stats.total}
          numericValue={stats.total}
          icon={<Users className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Pending"
          value={stats.pending}
          numericValue={stats.pending}
          icon={<Clock className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          numericValue={stats.completed}
          icon={<CheckCircle className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Remedial Rows"
          value={stats.pendingRows + stats.completedRows}
          numericValue={stats.pendingRows + stats.completedRows}
          icon={<FlaskConical className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
      </div>

      {/* Main Table Card */}
      <Card className="border border-slate-200/60 shadow-sm bg-card overflow-hidden rounded-2xl p-0">
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Remedial Students</h2>
              <p className="text-sm text-muted-foreground">
                {filtered.length} student{filtered.length !== 1 ? "s" : ""} found
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {schoolYears.length > 0 && (
                <Select
                  value={selectedSY}
                  onValueChange={(v) => {
                    setSelectedSY(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-36 h-9 rounded-lg text-xs">
                    <SelectValue placeholder="School Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {schoolYears.map((sy) => (
                      <SelectItem key={sy} value={sy}>{sy}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name or LRN..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-8 h-9 w-56 rounded-lg text-xs"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Rows:</span>
                <Select
                  value={String(limit)}
                  onValueChange={(v) => {
                    setLimit(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-16 h-9 rounded-lg text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="15">15</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Conducted Date Range — applies to all students */}
          {stats.pending > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Calendar className="w-4 h-4" />
                Conducted
              </span>
              <input
                type="date"
                value={conductedFrom}
                onChange={(e) => setConductedFrom(e.target.value)}
                className="border border-border rounded-lg px-2 py-1 text-sm bg-background text-foreground"
              />
              <span className="text-muted-foreground">–</span>
              <input
                type="date"
                value={conductedTo}
                onChange={(e) => setConductedTo(e.target.value)}
                className="border border-border rounded-lg px-2 py-1 text-sm bg-background text-foreground"
              />
              {(conductedFrom || conductedTo) && (
                <span className="text-xs text-muted-foreground">Applies to all students</span>
              )}
            </div>
          )}
        </div>
        <CardContent className="p-0">
          {error ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Unable to Load Remedial Data</h2>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => void load(page)} variant="outline">
                Try Again
              </Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className="w-full table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-muted/50 border-b border-border bg-muted">
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-8" />
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%] text-left">LRN</TableHead>
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[30%] text-left">Learner Name</TableHead>
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[18%] text-left">Grade / Section</TableHead>
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[24%] text-left">Failed Subjects</TableHead>
                      <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%] text-left">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <LoadingSkeleton columnCount={6} rowCount={8} />
                    ) : paginated.length === 0 ? (
                      <EmptyState
                        columnCount={6}
                        title="No remedial learners found"
                        hint="Try adjusting your search"
                        searchTerm={search || undefined}
                      />
                    ) : (
                      paginated.map((student) => (
                        <Fragment key={student.enrollmentId}>
                          <RemedialStudentRow
                            student={student}
                            isExpanded={expandedId === student.enrollmentId}
                            primaryColor={colors.primary}
                            onExpand={toggleExpand}
                          />
                          {expandedId === student.enrollmentId && (
                            <RemedialExpandedPanel
                              student={student}
                              editMarks={editMarks}
                              saving={savingAndCompleting}
                              primaryColor={colors.primary}
                              onMarkChange={handleMarkChange}
                              computeRfg={computeRfg}
                              validate={canComplete}
                              onOpenConfirm={openConfirmDialog}
                            />
                          )}
                        </Fragment>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {!loading && filtered.length > 0 && (
                <div className="border-t border-border px-6 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      Showing {(page - 1) * limit + 1}–{Math.min(page * limit, filtered.length)} of{" "}
                      <span className="font-medium text-foreground">{filtered.length}</span> students
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page <= 1}
                      onClick={() => setPage(1)}
                      aria-label="First page"
                    >
                      <ChevronsLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 w-8 text-xs font-bold"
                    >
                      {page}
                    </Button>

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page >= totalPages}
                      onClick={() => setPage(totalPages)}
                      aria-label="Last page"
                    >
                      <ChevronsRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </>)}

      {/* History View */}
      {viewMode === "history" && (<>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Filter:</span>
          <Select value={historyYearFilter} onValueChange={(v) => { setHistoryYearFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36 h-8 rounded-lg text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {schoolYears.map((sy) => (
                <SelectItem key={sy} value={sy}>{sy}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <RemedialHistoryTable
          items={historyItems}
          loading={historyLoading}
          page={page}
          limit={limit}
          meta={historyMeta}
          historyYearFilter={historyYearFilter}
          setPage={setPage}
        />
      </>)}

      {/* Save & Complete Confirmation Dialog */}
      <CompleteRemedialDialog
        student={confirmDialogStudent}
        conductedFrom={conductedFrom}
        conductedTo={conductedTo}
        pendingSubjects={dialogPendingSubjects}
        saving={savingAndCompleting}
        validation={dialogValidation}
        onOpenChange={(open) => { if (!open) closeConfirmDialog(); }}
        onConfirm={handleDialogConfirm}
      />
      <SyncProgressModal isOpen={syncModalOpen} onClose={() => { setSyncModalOpen(false); setSyncStatus("idle"); }} status={syncStatus} errorMessage={syncError} />
    </div>
  );
}
