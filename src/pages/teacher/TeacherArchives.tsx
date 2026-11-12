import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { teacherArchivesApi, type TeacherArchiveRow } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Button } from "@/components/ui/button";
import { DataTable, usePagination } from "@/components/data-table";
import type { TableColumn } from "@/components/data-table";
import { Archive, ChevronRight, HardDrive } from "lucide-react";

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
  const navigate = useNavigate();
  const [archives, setArchives] = useState<TeacherArchiveRow[]>([]);
  const [totals, setTotals] = useState({ count: 0, rawBytes: 0, compressedBytes: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await teacherArchivesApi.list();
      setArchives(res.data.archives);
      setTotals(res.data.totals);
    } catch (err) {
      setError(errorText(err, "Failed to load your archives"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latestYear = useMemo(
    () => [...archives].sort((a, b) => b.schoolYear.localeCompare(a.schoolYear))[0]?.schoolYear ?? "—",
    [archives],
  );

  const pagination = usePagination({ totalRows: archives.length });

  const columns: TableColumn<TeacherArchiveRow>[] = [
    {
      key: "year",
      header: "School Year",
      skeleton: "name",
      cell: (row) => <span className="font-medium text-foreground">{row.schoolYear}</span>,
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
      cell: (row) => <span className="font-medium">{formatBytes(row.compressedBytes)}</span>,
    },
    {
      key: "generated",
      header: "Generated",
      skeleton: "date",
      cell: (row) => (row.completedAt ? new Date(row.completedAt).toLocaleDateString() : "—"),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "text-right",
      cell: (row) => (
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => navigate(`/teacher/archives/${row.id}`)}
        >
          Open
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in w-full">
      <PageHeader
        title="My Archives"
        description="Choose a school year to open your class records."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Archived years"
          value={String(totals.count)}
          icon={<Archive className="w-4 h-4" />}
          iconClassName="bg-primary/10 text-primary"
        />
        <StatCard
          label="Latest year"
          value={latestYear}
          icon={<Archive className="w-4 h-4" />}
          iconClassName="bg-muted text-muted-foreground"
        />
        <StatCard
          label="Total compressed size"
          value={formatBytes(totals.compressedBytes)}
          icon={<HardDrive className="w-4 h-4" />}
          iconClassName="bg-primary/10 text-primary"
        />
      </div>

      <DataTable
        columns={columns}
        rows={archives}
        loading={loading}
        error={error}
        title="Archived School Years"
        description={`${archives.length} year${archives.length === 1 ? "" : "s"} available`}
        emptyTitle="No archives yet"
        emptyHint="Your records will appear here after a school year is archived."
        rowKey={(row) => row.id}
        pagination={pagination}
        onRetry={() => void load()}
      />
    </div>
  );
}
