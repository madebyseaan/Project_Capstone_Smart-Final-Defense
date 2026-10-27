import { useEffect, useState } from "react";
import { Link2, FileDown, FileUp, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { downloadBlobResponse } from "@/lib/download";
import { gradesApi, type AimsScoresResponse } from "@/lib/api";
import { AimsLinkForm, type AimsClassContext } from "./AimsLinkForm";
import { AimsLinkedPanel } from "./AimsLinkedPanel";
import { ExcelExchangePanel } from "./ExcelExchangePanel";

interface ClassRecordHeroToolsProps {
  classAssignmentId: string;
  selectedTerm: string;
  aimsData: AimsScoresResponse | null;
  isViewOnly: boolean;
  /** Invalidate class-record + aims queries after a successful tool action */
  onChanged: () => void;
  /** Persist pending unsaved scores before a class-wide action (imports) */
  beforeImport?: () => Promise<void>;
  /** Auto-open the AIMS dialog (e.g. from the ?connect=aims query param) */
  openLinkDialogSignal?: number;
  /** Class identity shown in the link dialog so teachers can verify the match */
  classContext?: AimsClassContext;
}

export function ClassRecordHeroTools({
  classAssignmentId,
  selectedTerm,
  aimsData,
  isViewOnly,
  onChanged,
  beforeImport,
  openLinkDialogSignal = 0,
  classContext,
}: ClassRecordHeroToolsProps) {
  const [aimsOpen, setAimsOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const linked = aimsData?.linked ?? false;
  const courseCode = aimsData?.course?.code;

  // Auto-open the AIMS dialog when signalled from outside
  useEffect(() => {
    if (openLinkDialogSignal > 0) setAimsOpen(true);
  }, [openLinkDialogSignal]);

  const openAims = () => setAimsOpen(true);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await gradesApi.ecrExport(classAssignmentId, selectedTerm);
      downloadBlobResponse(res, `E-Class-Record-${selectedTerm}.xlsx`);
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
        aria-label={linked ? "Manage AIMS connection" : "Connect AIMS"}
        className={cn(
          "h-12 gap-1.5 rounded-xl border text-xs font-semibold shadow-xs lg:h-8 lg:rounded-lg lg:text-[11px]",
          linked
            ? "bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)] border-[var(--ledger-aims)] hover:bg-[var(--ledger-aims-bg)]"
            : "border-border bg-background text-muted-foreground hover:bg-muted"
        )}
      >
        {linked ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5 text-[var(--ledger-aims)]" />}
        <span className="sm:hidden">AIMS</span>
        <span className="hidden sm:inline">{linked ? `AIMS${courseCode ? `: ${courseCode}` : " Connected"}` : "Connect AIMS"}</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={downloading}
        title="Download the official DepEd E-Class-Record pre-filled with your roster"
        aria-label="Download pre-filled Excel"
        className="h-12 gap-1.5 rounded-xl border border-border bg-background text-xs font-semibold text-muted-foreground shadow-xs hover:bg-muted lg:h-8 lg:rounded-lg lg:text-[11px]"
      >
        {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5 text-emerald-600" />}
        <span className="sm:hidden">Excel</span>
        <span className="hidden sm:inline">Download pre-filled Excel</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => setExcelOpen(true)}
        disabled={isViewOnly}
        title={isViewOnly ? "Read-only — importing is disabled" : "Import a filled E-Class-Record"}
        aria-label="Import filled Excel"
        className="h-12 gap-1.5 rounded-xl border border-border bg-background text-xs font-semibold text-muted-foreground shadow-xs hover:bg-muted disabled:opacity-50 lg:h-8 lg:rounded-lg lg:text-[11px]"
      >
        <FileUp className="w-3.5 h-3.5 text-primary" />
        <span className="sm:hidden">Import</span>
        <span className="hidden sm:inline">Import filled Excel</span>
      </Button>

      {/* AIMS LMS manager — one dialog, no nesting (link form XOR manager) */}
      <Dialog open={aimsOpen} onOpenChange={setAimsOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
          {!aimsData ? (
            <DialogHeader>
              <DialogTitle>AIMS LMS Integration</DialogTitle>
              <div className="py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking AIMS connection...
              </div>
            </DialogHeader>
          ) : linked ? (
            <AimsLinkedPanel
              classAssignmentId={classAssignmentId}
              selectedTerm={selectedTerm}
              aimsData={aimsData}
              isViewOnly={isViewOnly}
              onChanged={onChanged}
              onClose={() => setAimsOpen(false)}
            />
          ) : (
            <AimsLinkForm
              classAssignmentId={classAssignmentId}
              classContext={classContext}
              onConnected={() => {
                onChanged();
                setAimsOpen(false);
              }}
              onCancel={() => setAimsOpen(false)}
            />
          )}
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
            beforeImport={beforeImport}
            onImported={() => {
              onChanged();
              setExcelOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

