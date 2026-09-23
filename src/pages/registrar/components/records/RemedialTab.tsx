/**
 * RemedialTab.tsx — remedial summary for the learner (link out to Remedial Tracker).
 */
import { ClipboardCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VaultStudent } from "./types";

interface RemedialTabProps {
  student: VaultStudent;
  hasRemedial: boolean;
  onOpenTracker: () => void;
}

export default function RemedialTab({ hasRemedial, onOpenTracker }: RemedialTabProps) {
  if (!hasRemedial) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <ClipboardCheck className="w-10 h-10 text-muted-foreground/60" />
        <p className="text-sm font-semibold text-foreground">No remedial records</p>
        <p className="text-xs text-muted-foreground">This learner has no remedial classes on file.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <ClipboardCheck className="w-10 h-10 text-primary" />
      <p className="text-sm font-semibold text-foreground">This learner has remedial records</p>
      <p className="text-xs text-muted-foreground max-w-sm">
        Open the Remedial Tracker to view marks, outcomes, and print the certificate.
      </p>
      <Button size="sm" className="font-semibold text-xs" onClick={onOpenTracker}>
        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
        Open Remedial Tracker
      </Button>
    </div>
  );
}
