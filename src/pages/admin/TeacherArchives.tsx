import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type TeacherArchiveRow } from "@/lib/api";
import { downloadBlobResponse } from "@/lib/download";
import { toast } from "@/lib/toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppModal } from "@/components/app-modal";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DataTable, Dash, TableToolbar, usePagination } from "@/components/data-table";
import type { TableColumn } from "@/components/data-table";
import {
  AlertTriangle,
  Archive,
  Database,
  Eye,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
} from "lucide-react";

interface SchoolYearOption {
  id: string;
  label: string;
  status: string;
  archivedAt?: string | null;
}

const STATUS_CLASS: Record<string, string> = {
  COMPLETE: "bg-primary/10 text-primary border-primary/20",
  PENDING: "bg-muted text-muted-foreground border-border",
  FAILED: "bg-destructive/10 text-destructive border-destructive/20",
};

const STAT_LABELS: Record<string, string> = {
  sections: "Sections",
  subjects: "Subjects",
  students: "Students",
  assignments: "Class assignments",
  grades: "Grades",
  attendanceRows: "Attendance rows",
  schedules: "Schedules",
  workloadEntries: "Workload entries",
  observedValues: "Observed values",
  editRequests: "Edit requests",
  eosySnapshots: "EOSY snapshots",
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } } };
  return e.response?.data?.message || fallback;
}

export default function TeacherArchives() {
  const [years, setYears] = useState<SchoolYearOption[]>([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [rows, setRows] = useState<TeacherArchiveRow[]>([]);
  const [counts, setCounts] = useState({
    expectedTeachers: 0,
    complete: 0,
    pending: 0,
    failed: 0,
    total: 0,
    totalRawBytes: 0,
    totalCompressedBytes: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingYears, setLoadingYears] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [detail, setDetail] = useState<TeacherArchiveRow | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const loadYears = useCallback(async () => {
    setLoadingYears(true);
    try {
      const res = await adminApi.getSchoolYears();
      const archived = (res.data.schoolYears || [])
        .filter((year) => year.status === "ARCHIVED" || year.status === "COMPLETED")
        .sort((a, b) => b.label.localeCompare(a.label));
      setYears(archived);
      if (archived.length > 0) setSelectedYearId((current) => current || archived[0].id);
    } catch (err) {
      setError(errorText(err, "Failed to load school years"));
    } finally {
      setLoadingYears(false);
    }
  }, []);

  const fetchArchives = useCallback(async (schoolYearId: string) => {
    if (!schoolYearId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getTeacherArchives({ schoolYearId, pageSize: 100 });
      setRows(res.data.teachers);
      setCounts(res.data.counts);
    } catch (err) {
      setError(errorText(err, "Failed to load teacher archives"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadYears();
  }, [loadYears]);

  useEffect(() => {
    void fetchArchives(selectedYearId);
  }, [fetchArchives, selectedYearId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "ALL" && row.status !== statusFilter) return false;
      if (!q) return true;
      return (
        row.teacherName.toLowerCase().includes(q) ||
        (row.employeeId ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  const pagination = usePagination({ totalRows: filtered.length });
  const missing = Math.max(0, counts.expectedTeachers - counts.complete);
  const selectedYear = years.find((year) => year.id === selectedYearId);

  const handleDownload = async (row: TeacherArchiveRow, format: "xlsx" | "json" | "json.gz") => {
    setDownloadingId(row.id);
    try {
      const res = await adminApi.downloadTeacherArchive(row.id, format);
      downloadBlobResponse(res, `TeacherArchive_${row.schoolYear}.${format}`);
      toast.success("Teacher archive downloaded.");
    } catch (err) {
      toast.error(errorText(err, "Download failed"));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleBackfill = async () => {
    if (!selectedYearId) return;
    setBackfilling(true);
    try {
      const res = await adminApi.backfillTeacherArchives({ schoolYearId: selectedYearId });
      toast.success(
        `Generated ${res.data.completed} archive(s) for ${res.data.schoolYear} (${formatBytes(res.data.compressedBytes)}).`,
      );
      setShowBackfill(false);
      await fetchArchives(selectedYearId);
    } catch (err) {
      toast.error(errorText(err, "Backfill failed"));
    } finally {
      setBackfilling(false);
    }
  };

  const columns: TableColumn<TeacherArchiveRow>[] = [
    {
      key: "teacher",
      header: "Teacher",
      skeleton: "name",
      cell: (row) => (
        <div>
          <div className="font-medium text-foreground">{row.teacherName}</div>
          <div className="text-xs text-muted-foreground">{row.employeeId || row.teacherId}</div>
        </div>
      ),
    },
    {
      key: "contents",
      header: "Contents",
      skeleton: "number",
      cell: (row) => (
        <div>
          <div className="text-sm text-foreground">
            {row.stats?.sections ?? 0} class{(row.stats?.sections ?? 0) === 1 ? "" : "es"}
          </div>
          <div className="text-xs text-muted-foreground">
            {row.stats?.students ?? 0} students · {row.stats?.grades ?? 0} grades
          </div>
        </div>
      ),
    },
    {
      key: "size",
      header: "Size",
      skeleton: "number",
      align: "right",
      cell: (row) => (
        <div className="text-right">
          <div className="font-medium">{formatBytes(row.compressedBytes)}</div>
          <div className="text-xs text-muted-foreground">from {formatBytes(row.rawBytes)}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      skeleton: "badge",
      cell: (row) => (
        <Badge variant="outline" className={`text-[11px] ${STATUS_CLASS[row.status] ?? ""}`}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: "generated",
      header: "Generated",
      skeleton: "date",
      cell: (row) =>
        row.completedAt ? new Date(row.completedAt).toLocaleDateString() : <Dash />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={() => setDetail(row)}
            aria-label={`View ${row.teacherName}`}
          >
            <Eye className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-primary/30 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10"
            disabled={row.status !== "COMPLETE" || downloadingId === row.id}
            onClick={() => void handleDownload(row, "xlsx")}
            aria-label={`Download ${row.teacherName} Excel`}
          >
            {downloadingId === row.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-1.5" />
            )}
            Excel
          </Button>
        </div>
      ),
    },
  ];

  const detailStats = detail?.stats
    ? Object.entries(detail.stats)
        .filter(([key, value]) => STAT_LABELS[key] && Number(value) > 0)
        .sort(([a], [b]) => (STAT_LABELS[a] ?? a).localeCompare(STAT_LABELS[b] ?? b))
    : [];

  return (
    <div className="space-y-6 animate-fade-in w-full">
      <PageHeader
        title="Teacher Archives"
        description="Per-teacher records for each archived school year"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            disabled={!selectedYearId || missing === 0}
            onClick={() => setShowBackfill(true)}
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Generate missing
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Teachers archived"
          value={`${counts.complete} / ${counts.expectedTeachers}`}
          icon={<Archive className="w-5 h-5" />}
          iconClassName="bg-primary/10 text-primary"
        />
        <StatCard
          label="Missing / failed"
          value={`${missing} / ${counts.failed}`}
          icon={<AlertTriangle className="w-5 h-5" />}
          iconClassName="bg-destructive/10 text-destructive"
        />
        <StatCard
          label="Compressed size"
          value={formatBytes(counts.totalCompressedBytes)}
          icon={<Database className="w-5 h-5" />}
          iconClassName="bg-primary/10 text-primary"
        />
        <StatCard
          label="Raw size"
          value={formatBytes(counts.totalRawBytes)}
          icon={<Database className="w-5 h-5" />}
          iconClassName="bg-muted text-muted-foreground"
        />
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading || loadingYears}
        error={error}
        title={selectedYear?.label || "Teacher Archives"}
        description={`${filtered.length} record${filtered.length === 1 ? "" : "s"} found`}
        emptyTitle={years.length === 0 ? "No archived school years" : "No teacher archives yet"}
        emptyHint={
          years.length === 0
            ? "Archives are available after a school year is archived."
            : 'Use "Generate missing" to create archives from the live year data.'
        }
        emptySearchTerm={search}
        rowKey={(row) => row.id}
        pagination={pagination}
        onRetry={() => void fetchArchives(selectedYearId)}
        toolbar={
          <TableToolbar
            searchPlaceholder="Search teachers..."
            searchValue={search}
            onSearchChange={setSearch}
            filters={[
              {
                label: "School Year",
                value: selectedYearId,
                onChange: setSelectedYearId,
                options: years.map((year) => ({ label: year.label, value: year.id })),
              },
              {
                label: "Status",
                value: statusFilter,
                onChange: setStatusFilter,
                options: [
                  { label: "All Statuses", value: "ALL" },
                  { label: "Complete", value: "COMPLETE" },
                  { label: "Pending", value: "PENDING" },
                  { label: "Failed", value: "FAILED" },
                ],
              },
            ]}
          />
        }
      />

      <AppModal
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        size="lg"
        icon={<Archive className="w-6 h-6" />}
        title={detail?.teacherName ?? "Teacher Archive"}
        description={
          detail
            ? `${detail.schoolYear} · ${detail.employeeId || detail.teacherId}`
            : undefined
        }
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDetail(null)}>
              Close
            </Button>
            <Button
              variant="outline"
              disabled={!detail || detail.status !== "COMPLETE" || downloadingId === detail.id}
              onClick={() => detail && void handleDownload(detail, "json.gz")}
            >
              .json.gz
            </Button>
            <Button
              variant="outline"
              disabled={!detail || detail.status !== "COMPLETE" || downloadingId === detail.id}
              onClick={() => detail && void handleDownload(detail, "json")}
            >
              JSON
            </Button>
            <Button
              disabled={!detail || detail.status !== "COMPLETE" || downloadingId === detail.id}
              onClick={() => detail && void handleDownload(detail, "xlsx")}
            >
              <FileSpreadsheet className="w-4 h-4 mr-1.5" />
              Excel
            </Button>
          </div>
        }
      >
        {detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">Status</div>
                <div className="mt-1 text-sm font-medium text-foreground">{detail.status}</div>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">Compressed</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {formatBytes(detail.compressedBytes)}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">Raw</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {formatBytes(detail.rawBytes)}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">Generated</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {detail.completedAt ? new Date(detail.completedAt).toLocaleDateString() : "—"}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground">Contents</h3>
              {detailStats.length > 0 ? (
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                  {detailStats.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{STAT_LABELS[key]}</span>
                      <span className="font-medium text-foreground">{String(value)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No content counts available.</p>
              )}
            </div>

            {detail.dataQuality?.warnings && detail.dataQuality.warnings.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                  Data quality
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {detail.dataQuality.warnings.join(", ")}
                </p>
              </div>
            )}

            {detail.checksum && (
              <div>
                <h3 className="text-sm font-semibold text-foreground">Checksum</h3>
                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                  {detail.checksum}
                </p>
              </div>
            )}
          </div>
        )}
      </AppModal>

      <ConfirmDialog
        open={showBackfill}
        onOpenChange={setShowBackfill}
        title="Generate missing teacher archives"
        description={`Create archives for ${missing} missing teacher(s) in ${selectedYear?.label ?? "the selected school year"}? This reads live data and writes only to the archive table.`}
        confirmLabel="Generate"
        loading={backfilling}
        onConfirm={() => void handleBackfill()}
      />
    </div>
  );
}
