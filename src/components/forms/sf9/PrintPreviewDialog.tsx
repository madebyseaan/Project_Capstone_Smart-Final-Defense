import { useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Sf9Payload } from "@/lib/api";
import { printForm } from "@/lib/printForm";
import SF9Form from "./SF9Form";
import TermCardForm from "./TermCardForm";

interface PrintPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  payload: Sf9Payload | null;
  fullLogoUrl: string | null;
  title?: string;
}

export default function PrintPreviewDialog({
  open,
  onClose,
  payload,
  fullLogoUrl,
  title,
}: PrintPreviewDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    printForm(printRef.current, {
      styleId: "advisory-print-style",
      extraCss: `
        .sf-print-container .term-card-watermark { font-size: 46pt !important; line-height: 1.1 !important; }
        .print-form-term-card { page-break-after: always !important; }
      `,
    });
  };

  const resolvedTitle =
    title ??
    (payload?.meta.mode === "TERM_CARD"
      ? `Temporary Term Card — ${payload.meta.termLabel ?? payload.meta.term}`
      : "Official SF9 — Learner's Progress Report Card");

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        data-testid="preview-dialog"
        className="max-h-[92vh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto sm:max-w-5xl"
      >
        <DialogHeader className="print-hide">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-foreground">{resolvedTitle}</DialogTitle>
              <DialogDescription className="mt-1 text-xs text-muted-foreground">
                {payload
                  ? `${payload.student.name} · ${payload.student.lrn} · ${payload.student.section}`
                  : "No printable data selected."}
              </DialogDescription>
            </div>
            <Button
              type="button"
              data-testid="confirm-print"
              size="sm"
              className="shrink-0 text-xs font-semibold"
              onClick={handlePrint}
              disabled={!payload}
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Print
            </Button>
          </div>
        </DialogHeader>

        {payload ? (
          <div ref={printRef} className="overflow-x-auto print:overflow-visible">
            <div className="min-w-[820px] print:min-w-0">
              {"subjectGrades" in payload ? (
                <SF9Form data={payload} fullLogoUrl={fullLogoUrl} />
              ) : (
                <TermCardForm data={payload} fullLogoUrl={fullLogoUrl} />
              )}
            </div>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">No printable data selected.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
