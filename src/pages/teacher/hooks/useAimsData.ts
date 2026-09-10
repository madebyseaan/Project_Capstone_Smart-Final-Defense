import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AimsRowScore } from "@/lib/api";
import { useAimsScoresQuery } from "./useClassRecord";
import { useSyncStream } from "@/hooks/useSyncStream";

export function useAimsData(classAssignmentId: string | undefined, selectedTerm: string) {
  const { syncVersion } = useSyncStream();
  const [searchParams, setSearchParams] = useSearchParams();
  const [linkDialogSignal, setLinkDialogSignal] = useState(0);

  const aimsQuery = useAimsScoresQuery(classAssignmentId, selectedTerm, syncVersion);
  const aimsData = aimsQuery.data;

  // Auto-open AIMS link dialog from ?connect=aims query param
  useEffect(() => {
    if (searchParams.get("connect") === "aims") {
      if (!aimsData?.linked) {
        setLinkDialogSignal((s) => s + 1);
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, aimsData?.linked, setSearchParams]);

  const aimsAssessments = useMemo(() => {
    if (!aimsData?.linked || !aimsData.assessments) return [];
    // Hide staging columns entirely — AimsPanel shows "ready to import" badge.
    // After import, scores land in DepEd columns; no raw staging preview needed.
    const rows = aimsData.rows ?? [];
    const hasUnimported = rows.some((r) => r.scores.some((s) => !s.importedAt));
    return hasUnimported
      ? []
      : aimsData.assessments.filter((a) => {
          const aRows = rows.flatMap((r) => r.scores.filter((s) => s.assessmentId === a.assessmentId));
          return aRows.length === 0 || aRows.some((s) => !s.importedAt);
        });
  }, [aimsData]);

  const aimsAllAssessments = useMemo(() => {
    if (!aimsData?.linked || !aimsData.assessments) return [];
    return aimsData.assessments;
  }, [aimsData]);

  const aimsByStudent = useMemo(() => {
    if (!aimsData?.linked || !aimsData.rows) return {} as Record<string, Record<string, AimsRowScore>>;
    const map: Record<string, Record<string, AimsRowScore>> = {};
    for (const row of aimsData.rows) {
      map[row.studentId] = {};
      for (const score of row.scores) {
        map[row.studentId][score.assessmentId] = score;
      }
    }
    return map;
  }, [aimsData]);

  return { aimsQuery, aimsData, aimsAssessments, aimsAllAssessments, aimsByStudent, linkDialogSignal, setLinkDialogSignal };
}