import { useRef } from "react";
import { useElementHeight } from "@/hooks/useElementHeight";

export function useStickyLayout(opts: {
  classAssignmentId?: string;
  showAssessmentDetails: boolean;
  selectedColumn: { type: string; number: number } | null;
}) {
  const ledgerHeaderRef = useRef<HTMLDivElement | null>(null);
  const assessmentDetailsRef = useRef<HTMLDivElement | null>(null);
  const metaEditorRef = useRef<HTMLDivElement | null>(null);

  const ledgerHeaderHeight = useElementHeight(ledgerHeaderRef, !!opts.classAssignmentId);
  const assessmentDetailsHeight = useElementHeight(assessmentDetailsRef, opts.showAssessmentDetails);
  const metaEditorHeight = useElementHeight(metaEditorRef, !!opts.selectedColumn);

  const topNavHeight = 64;
  const metaEditorTop = topNavHeight + Math.ceil(ledgerHeaderHeight);
  const metaEditorOffset = opts.selectedColumn ? Math.ceil(metaEditorHeight) : 0;
  const assessmentDetailsTop = metaEditorTop + metaEditorOffset;
  const assessmentPanelOffset = opts.showAssessmentDetails ? Math.ceil(assessmentDetailsHeight) : 0;
  const stickyOffset = assessmentDetailsTop + assessmentPanelOffset;

  return {
    ledgerHeaderRef,
    assessmentDetailsRef,
    metaEditorRef,
    ledgerHeaderHeight,
    assessmentDetailsHeight,
    metaEditorHeight,
    topNavHeight,
    metaEditorTop,
    assessmentDetailsTop,
    stickyOffset,
  };
}
