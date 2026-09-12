import type React from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SF9Data, SF10Data } from "@/lib/api";
import SF9Form from "./SF9Form";
import SF10Form from "./SF10Form";

interface BulkSF9ViewProps {
  data: SF9Data[];
  fullLogoUrl: string | null;
  printRef: React.RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onPrint: () => void;
}

export function BulkSF9View({ data, fullLogoUrl, printRef, onBack, onPrint }: BulkSF9ViewProps) {
  return (
    <div className="space-y-6 animate-fade-in max-w-[860px] mx-auto">
      <div className="flex items-center justify-between print-hide">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button onClick={onPrint} variant="default" size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20">
          <Printer className="w-4 h-4 mr-2" />
          Print {data.length} SF9 Forms
        </Button>
      </div>

      <div ref={printRef}>
        {data.map((item, idx) => (
          <div key={`${item.student.lrn}-${idx}`}><SF9Form data={item} fullLogoUrl={fullLogoUrl} /></div>
        ))}
      </div>
    </div>
  );
}

interface BulkSF10ViewProps {
  data: SF10Data[];
  schoolName?: string;
  printRef: React.RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onPrint: () => void;
}

export function BulkSF10View({ data, schoolName, printRef, onBack, onPrint }: BulkSF10ViewProps) {
  return (
    <div className="space-y-6 animate-fade-in max-w-[900px] mx-auto">
      <div className="flex items-center justify-between print-hide">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button onClick={onPrint} variant="default" size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20">
          <Printer className="w-4 h-4 mr-2" />
          Print {data.length} SF10 Forms
        </Button>
      </div>

      <div ref={printRef}>
        {data.map((item, idx) => (
          <div key={`${item.student.lrn}-${idx}`}><SF10Form data={item} schoolName={schoolName} /></div>
        ))}
      </div>
    </div>
  );
}
