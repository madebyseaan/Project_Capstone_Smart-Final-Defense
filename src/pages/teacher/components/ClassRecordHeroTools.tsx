import { useEffect, useState } from "react";
import { Link2, FileDown, FileUp, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { gradesApi, type AimsScoresResponse } from "@/lib/api";
import { AimsPanel } from "./AimsPanel";
import { ExcelExchangePanel } from "./ExcelExchangePanel";

interface ClassRecordHeroToolsProps {
  classAssignmentId: string;
  selectedTerm: string;
  aimsData: AimsScoresResponse | null;
  isViewOnly: boolean;
  /** Invalidate class-record + aims queries after a successful tool action */
  onChanged: () => void;
  /** Auto-open the AIMS link dialog (e.g. from the ?connect=aims query param) */
  openLinkDialogSignal?: number;
}

export function ClassRecordHeroTools({
  classAssignmentId,
  selectedTerm,
  aimsData,
  isViewOnly,
  onChanged,
  openLinkDialogSignal = 0,
}: ClassRecordHeroToolsProps) {
  const [aimsOpen, setAimsOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [linkSignal, setLinkSignal] = useState(0);

  const linked = aimsData?.linked ?? false;
  const courseCode = aimsData?.course?.code;

  // Auto-open the AIMS manager + link dialog when signalled from outside
  useEffect(() => {
    if (openLinkDialogSignal > 0) {
      setAimsOpen(true);
      setLinkSignal((n) => n + 1);
    }
  }, [openLinkDialogSignal]);

  const openAims = () => {
    setAimsOpen(true);
    if (!linked) setLinkSignal((n) => n + 1);
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await gradesApi.ecrExport(classAssignmentId, selectedTerm);
      const url = window.URL.createObjectURL(new Blob([res.data as Blob]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `E-Class-Record-${selectedTerm}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Official E-Class-Record downloaded — it opens pre-filled with your roster.");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to download E-Class-Record");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={openAims}
        title={linked ? "Manage AIMS LMS connection" : "Connect an AIMS LMS course"}
        className={cn(
          "h-8 rounded-lg border font-bold text-[11px] gap-1.5 shadow-xs",
          linked
            ? "bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)] border-[var(--ledger-aims)] hover:bg-[var(--ledger-aims-bg)]"
            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
        )}
      >
        {linked ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5 text-[var(--ledger-aims)]" />}
        {linked ? `AIMS${courseCode ? `: ${courseCode}` : " Connected"}` : "Connect AIMS"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={downloading}
        title="Download the official DepEd E-Class-Record pre-filled with your roster"
        className="h-8 rounded-lg border-slate-200 bg-white text-slate-600 hover:bg-slate-50 font-bold text-[11px] gap-1.5 shadow-xs"
      >
        {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5 text-emerald-600" />}
        Download pre-filled Excel
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => setExcelOpen(true)}
        disabled={isViewOnly}
        title={isViewOnly ? "Read-only — importing is disabled" : "Import a filled E-Class-Record"}
        className="h-8 rounded-lg border-slate-200 bg-white text-slate-600 hover:bg-slate-50 font-bold text-[11px] gap-1.5 shadow-xs disabled:opacity-50"
      >
        <FileUp className="w-3.5 h-3.5 text-indigo-600" />
        Import filled Excel
      </Button>

      {/* AIMS LMS manager (link / import assessments / disconnect) */}
      <Dialog open={aimsOpen} onOpenChange={setAimsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AIMS LMS Integration</DialogTitle>
          </DialogHeader>
          <AimsPanel
            classAssignmentId={classAssignmentId}
            selectedTerm={selectedTerm}
            aimsData={aimsData}
            isViewOnly={isViewOnly}
            openLinkDialogSignal={linkSignal}
            onImportComplete={onChanged}
          />
        </DialogContent>
      </Dialog>

      {/* DepEd E-Class-Record Excel exchange */}
      <Dialog open={excelOpen} onOpenChange={setExcelOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Official E-Class-Record</DialogTitle>
          </DialogHeader>
          <ExcelExchangePanel
            classAssignmentId={classAssignmentId}
            selectedTerm={selectedTerm}
            isViewOnly={isViewOnly}
            autoStartImport
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
