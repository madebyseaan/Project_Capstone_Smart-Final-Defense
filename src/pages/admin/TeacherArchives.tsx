import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type TeacherArchiveRow } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { SearchInput } from "@/components/layout/SearchInput";
import { StatCard } from "@/components/layout/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DataTable, usePagination } from "@/components/data-table";
import type { TableColumn } from "@/components/data-table";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  Download,
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
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  const handleDownload = async (row: TeacherArchiveRow, format: "xlsx" | "json" | "json.gz") => {
    setDownloadingId(row.id);
    try {
      const res = await adminApi.downloadTeacherArchive(row.id, format);
      const url = URL.createObjectURL(res.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      const safeName = (row.employeeId || row.teacherName).replace(/[^A-Za-z0-9._-]+/g, "_");
      anchor.download = `TeacherArchive_${row.schoolYear}_${safeName}.${format === "json.gz" ? "json.gz" : format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage({ type: "error", text: errorText(err, "Download failed") });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleBackfill = async () => {
    if (!selectedYearId) return;
    setBackfilling(true);
    try {
      const res = await adminApi.backfillTeacherArchives({ schoolYearId: selectedYearId });
      setMessage({
        type: "success",
        text: `Generated ${res.data.completed} archive(s) for ${res.data.schoolYear} (${formatBytes(res.data.compressedBytes)}).`,
      });
      setShowBackfill(false);
      await fetchArchives(selectedYearId);
    } catch (err) {
      setMessage({ type: "error", text: errorText(err, "Backfill failed") });
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
      key: "sections",
      header: "Sections",
      skeleton: "number",
      align: "center",
      cell: (row) => row.stats?.sections ?? "—",
    },
    {
      key: "students",
      header: "Students",
      skeleton: "number",
      align: "center",
      cell: (row) => row.stats?.students ?? "—",
    },
    {
      key: "grades",
      header: "Grades",
      skeleton: "number",
      align: "center",
      cell: (row) => row.stats?.grades ?? "—",
    },
    {
      key: "attendance",
      header: "Attendance",
      skeleton: "number",
      align: "center",
      cell: (row) => row.stats?.attendanceRows ?? "—",
    },
    {
      key: "size",
      header: "Size",
      skeleton: "number",
      align: "right",
      cell: (row) => (
        <div className="text-right">
          <div className="font-medium">{formatBytes(row.compressedBytes)}</div>
          {row.rawBytes ? (
            <div className="text-xs text-muted-foreground">from {formatBytes(row.rawBytes)}</div>
          ) : null}
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
        row.completedAt ? new Date(row.completedAt).toLocaleDateString() : "—",
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
            className="h-8 px-2 text-xs"
            disabled={row.status !== "COMPLETE" || downloadingId === row.id}
            onClick={() => void handleDownload(row, "xlsx")}
            aria-label={`Download ${row.teacherName} Excel`}
          >
            {downloadingId === row.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            disabled={row.status !== "COMPLETE" || downloadingId === row.id}
            onClick={() => void handleDownload(row, "json")}
            aria-label={`Download ${row.teacherName} JSON`}
          >
            JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            disabled={row.status !== "COMPLETE" || downloadingId === row.id}
            onClick={() => void handleDownload(row, "json.gz")}
            aria-label={`Download ${row.teacherName} gzip`}
          >
            .gz
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in w-full">
      {message && (
        <div
          className={`p-4 rounded-xl flex items-center gap-2 border-2 ${
            message.type === "success"
              ? "bg-primary/5 border-primary/20 text-primary"
              : "bg-destructive/5 border-destructive/20 text-destructive"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span className="text-sm font-medium">{message.text}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => setMessage(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      <PageHeader
        title="Teacher Archives"
        description="Compressed per-teacher records for each archived school year"
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
          value={`${counts.complete}/${counts.expectedTeachers}`}
          icon={<Archive className="w-4 h-4" />}
          iconClassName="bg-primary/10 text-primary"
        />
        <StatCard
          label="Missing / failed"
          value={`${missing} / ${counts.failed}`}
          icon={<AlertTriangle className="w-4 h-4" />}
          iconClassName="bg-destructive/10 text-destructive"
        />
        <StatCard
          label="Compressed size"
          value={formatBytes(counts.totalCompressedBytes)}
          icon={<Database className="w-4 h-4" />}
          iconClassName="bg-primary/10 text-primary"
        />
        <StatCard
          label="Raw size"
          value={formatBytes(counts.totalRawBytes)}
          icon={<Database className="w-4 h-4" />}
          iconClassName="bg-muted text-muted-foreground"
        />
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading || loadingYears}
        error={error}
        title={years.find((year) => year.id === selectedYearId)?.label || "Teacher Archives"}
        description={`${filtered.length} record${filtered.length === 1 ? "" : "s"} found`}
        emptyTitle={years.length === 0 ? "No archived school years" : "No teacher archives yet"}
        emptyHint={
          years.length === 0
            ? "Archives are available after a school year is archived."
            : "Use \"Generate missing\" to create archives from the live year data."
        }
        emptySearchTerm={search}
        rowKey={(row) => row.id}
        pagination={pagination}
        onRetry={() => void fetchArchives(selectedYearId)}
        toolbar={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              value={selectedYearId}
              onChange={(event) => setSelectedYearId(event.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground"
              aria-label="School year"
            >
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground"
              aria-label="Status"
            >
              <option value="ALL">All statuses</option>
              <option value="COMPLETE">Complete</option>
              <option value="PENDING">Pending</option>
              <option value="FAILED">Failed</option>
            </select>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search teachers..."
            />
          </div>
        }
      />

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.teacherName}</DialogTitle>
            <DialogDescription>
              {detail?.schoolYear} · {detail?.employeeId || detail?.teacherId}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className="font-medium">{detail.status}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Compressed</div>
                  <div className="font-medium">{formatBytes(detail.compressedBytes)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Raw</div>
                  <div className="font-medium">{formatBytes(detail.rawBytes)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Source</div>
                  <div className="font-medium">{detail.source}</div>
                </div>
              </div>

              {detail.stats && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Contents</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(detail.stats).map(([key, value]) => (
                      <Badge key={key} variant="outline" className="text-[11px]">
                        {key}: {String(value)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {detail.dataQuality?.warnings && detail.dataQuality.warnings.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Data quality</div>
                  <div className="flex flex-wrap gap-2">
                    {detail.dataQuality.warnings.map((warning) => (
                      <Badge
                        key={warning}
                        variant="outline"
                        className="text-[11px] bg-muted text-muted-foreground"
                      >
                        {warning}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {detail.checksum && (
                <div>
                  <div className="text-xs text-muted-foreground">Checksum</div>
                  <div className="font-mono text-[11px] break-all text-muted-foreground">
                    {detail.checksum}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              Close
            </Button>
            <Button
              disabled={!detail || detail.status !== "COMPLETE" || downloadingId === detail.id}
              onClick={() => detail && void handleDownload(detail, "xlsx")}
            >
              <Download className="w-4 h-4 mr-1.5" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showBackfill}
        onOpenChange={setShowBackfill}
        title="Generate missing teacher archives"
        description={`Create archives for ${missing} missing teacher(s) in the selected school year? This reads live data and writes only to the archive table.`}
        confirmLabel="Generate"
        loading={backfilling}
        onConfirm={() => void handleBackfill()}
      />
    </div>
  );
}
