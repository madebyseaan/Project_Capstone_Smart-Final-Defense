import { useRef, useState, useEffect } from "react";
import { FileDown, FileUp, Loader2, AlertTriangle, Info, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { downloadBlobResponse } from "@/lib/download";
import { gradesApi, type EcrImportReport } from "@/lib/api";

interface ExcelExchangePanelProps {
  classAssignmentId: string;
  selectedTerm: string;
  isViewOnly: boolean;
  /** When true, immediately open the OS file picker on mount (used by hero "Import filled Excel") */
  autoStartImport?: boolean;
  /** Called after a successful import so the ledger can refresh */
  onImported?: () => void;
  /** Called before preview/import so pending unsaved scores are persisted first */
  beforeImport?: () => Promise<void>;
}

interface ApiErrorBody {
  message?: string;
  details?: string[];
}

const TERM_KEYS = ["T1", "T2", "T3"] as const;

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function errorMessage(err: unknown): string {
  const body = (err as { response?: { data?: ApiErrorBody } })?.response?.data;
  return body?.message || body?.details?.join(" ") || "Request failed. Please try again.";
}

export function ExcelExchangePanel({ classAssignmentId, selectedTerm, isViewOnly, autoStartImport = false, onImported, beforeImport }: ExcelExchangePanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<EcrImportReport | null>(null);
  const [busy, setBusy] = useState<"downloading" | "previewing" | "importing" | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Reset preview when the term or class changes
  useEffect(() => {
    setFile(null);
    setReport(null);
  }, [classAssignmentId, selectedTerm]);

  // Load the persisted last-synced timestamp for the selected term
  useEffect(() => {
    let cancelled = false;
    setLastSyncedAt(null);
    gradesApi
      .ecrSync(classAssignmentId)
      .then((res) => {
        if (cancelled) return;
        const key = TERM_KEYS.find((t) => t === selectedTerm);
        setLastSyncedAt(key ? res.data[key] : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [classAssignmentId, selectedTerm]);

  // Open the OS file picker immediately when requested by the hero action
  useEffect(() => {
    if (autoStartImport) fileInputRef.current?.click();
  }, [autoStartImport]);

  const handleDownload = async () => {
    setBusy("downloading");
    try {
      const res = await gradesApi.ecrExport(classAssignmentId, selectedTerm);
      downloadBlobResponse(res, `E-Class-Record-${selectedTerm}.xlsx`);
      toast.success("Official E-Class-Record downloaded — it opens pre-filled with your roster.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setFile(picked);
    setReport(null);
    setBusy("previewing");
    try {
      await beforeImport?.();
      const res = await gradesApi.ecrImport(classAssignmentId, selectedTerm, picked, true);
      setReport(res.data);
    } catch (err) {
      setFile(null);
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleConfirmImport = async () => {
    if (!file) return;
    setBusy("importing");
    try {
      await beforeImport?.();
      const res = await gradesApi.ecrImport(classAssignmentId, selectedTerm, file, false);
      toast.success(`Imported scores for ${res.data.savedCount} learner(s).`);
      setLastSyncedAt(res.data.lastSyncedAt ?? new Date().toISOString());
      setFile(null);
      setReport(null);
      onImported?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const reportUnmatched = report?.unmatched ?? [];
  const reportWarnings = report?.warnings ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <FileDown className="w-5 h-5" />
          </div>
          <div>
            <span className="text-sm font-bold text-foreground">Official E-Class-Record</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Work offline in the DepEd Excel — download it pre-filled with your roster, then import scores back.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last synced: <span className="font-medium text-foreground">{formatSyncedAt(lastSyncedAt)}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={busy !== null} className="gap-1.5">
            {busy === "downloading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Download pre-filled Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isViewOnly || busy !== null} className="gap-1.5">
            {busy === "previewing" || busy === "importing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            Import filled Excel
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Preview / confirm block */}
      {report && (
        <div className="rounded-xl border border-border bg-primary/5 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm font-semibold text-foreground">
                Preview for {selectedTerm}
                {report.overwrittenCount > 0
                  ? ` — ${report.overwrittenCount} learner(s) already have scores that will be replaced`
                  : " — no existing scores will be touched"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setFile(null); setReport(null); }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-foreground">
              {report.matched} matched
            </span>
            <span className={`font-semibold px-2.5 py-1 rounded-full ${reportUnmatched.length > 0 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-foreground"}`}>
              {reportUnmatched.length} unmatched
            </span>
            {report.emptySkipped > 0 && (
              <span className="font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-foreground">
                {report.emptySkipped} empty rows skipped
              </span>
            )}
          </div>

          {reportUnmatched.length > 0 && (
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">
                <span className="font-semibold">Not found in this class:</span>{" "}
                {reportUnmatched.slice(0, 5).join(" · ")}
                {reportUnmatched.length > 5 && ` · +${reportUnmatched.length - 5} more`}
              </p>
            </div>
          )}

          {report.specialSkipped.length > 0 && (
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">
                <span className="font-semibold">A/E special marks skipped</span> (not representable in Excel) for{" "}
                {report.specialSkipped.slice(0, 3).join(" · ")}
                {report.specialSkipped.length > 3 && ` +${report.specialSkipped.length - 3} more`}
              </p>
            </div>
          )}

          {reportWarnings.slice(0, 3).map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">{w}</p>
            </div>
          ))}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => { setFile(null); setReport(null); }} disabled={busy !== null}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmImport} disabled={busy !== null || report.matched === 0} className="gap-1.5">
              {busy === "importing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm Import ({report.matched})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}