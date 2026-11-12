import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gradesApi, teacherArchivesApi } from "@/lib/api";
import { downloadBlobResponse } from "@/lib/download";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, usePagination } from "@/components/data-table";
import type { TableColumn } from "@/components/data-table";
import { ArrowLeft, Download, FileSpreadsheet, Loader2 } from "lucide-react";

interface ClassRecordRow {
  classAssignmentId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
  teachingMinutes: number | null;
  terms: string[];
}

const TERM_LABELS: Record<string, string> = {
  T1: "Term 1",
  T2: "Term 2",
  T3: "Term 3",
};

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } } };
  return e.response?.data?.message || fallback;
}

export default function TeacherArchiveDetail() {
  const { archiveId = "" } = useParams();
  const navigate = useNavigate();
  const [archive, setArchive] = useState<{ id: string; schoolYear: string; teacherName: string } | null>(null);
  const [classes, setClasses] = useState<ClassRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!archiveId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await teacherArchivesApi.classes(archiveId);
      setArchive(res.data.archive);
      setClasses(res.data.classes);
    } catch (err) {
      setError(errorText(err, "Failed to load class records"));
    } finally {
      setLoading(false);
    }
  }, [archiveId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleClassDownload = async (row: ClassRecordRow) => {
    if (row.terms.length === 0) return;
    setDownloading(row.classAssignmentId);
    setMessage(null);
    try {
      const res = await gradesApi.ecrExportAllTerms(row.classAssignmentId);
      const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");
      downloadBlobResponse(res, `E-Class-Record_${safe(row.subjectName)}_${safe(row.sectionName)}_AllTerms.xlsx`);
    } catch (err) {
      setMessage(errorText(err, "Class record download failed"));
    } finally {
      setDownloading(null);
    }
  };

  const handleYearBackup = async () => {
    if (!archive) return;
    setBackupBusy(true);
    setMessage(null);
    try {
      const res = await teacherArchivesApi.download(archive.id, "xlsx");
      downloadBlobResponse(res, `TeacherArchive_${archive.schoolYear}.xlsx`);
    } catch (err) {
      setMessage(errorText(err, "Year backup download failed"));
    } finally {
      setBackupBusy(false);
    }
  };

  const pagination = usePagination({ totalRows: classes.length });

  const columns: TableColumn<ClassRecordRow>[] = [
    {
      key: "subject",
      header: "Subject",
      skeleton: "name",
      cell: (row) => (
        <div>
          <div className="font-medium text-foreground">{row.subjectName}</div>
          <div className="text-xs text-muted-foreground">{row.subjectCode}</div>
        </div>
      ),
    },
    {
      key: "section",
      header: "Section",
      skeleton: "name",
      cell: (row) => <span className="text-foreground">{row.sectionName}</span>,
    },
    {
      key: "terms",
      header: "Terms Included",
      cell: (row) =>
        row.terms.length === 0 ? (
          <Badge variant="outline" className="text-[11px] text-muted-foreground">
            No grades archived
          </Badge>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.terms.map((term) => (
              <Badge key={term} variant="outline" className="text-[11px]">
                {TERM_LABELS[term] ?? term}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: "actions",
      header: "Class Record",
      align: "right",
      className: "text-right",
      cell: (row) => (
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={row.terms.length === 0 || downloading === row.classAssignmentId}
          onClick={() => void handleClassDownload(row)}
        >
          {downloading === row.classAssignmentId ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
          ) : (
            <FileSpreadsheet className="w-4 h-4 mr-1.5" />
          )}
          Download Excel
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in w-full">
      {message && (
        <div className="p-4 rounded-xl flex items-center gap-2 border-2 bg-destructive/5 border-destructive/20 text-destructive">
          <span className="text-sm font-medium">{message}</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setMessage(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <PageHeader
        title={archive ? `${archive.schoolYear} Class Records` : "Class Records"}
        description="Open the official DepEd class-record Excel with all terms and final grades filled in."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate("/teacher/archives")}>
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!archive || backupBusy}
              onClick={() => void handleYearBackup()}
            >
              {backupBusy ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1.5" />
              )}
              Year backup
            </Button>
          </div>
        }
      />

      <DataTable
        columns={columns}
        rows={classes}
        loading={loading}
        error={error}
        title="Class Records"
        description={`${classes.length} class record${classes.length === 1 ? "" : "s"} available`}
        emptyTitle="No class records in this archive"
        emptyHint="This archive does not contain any class assignments."
        rowKey={(row) => row.classAssignmentId}
        pagination={pagination}
        onRetry={() => void load()}
      />
    </div>
  );
}
