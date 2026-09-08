import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gradesApi, type ClassRecord, type ClassAssignment, type ScoreItem, type InheritedGrade, type InheritedFromTeacher, type AimsScoresResponse } from "@/lib/api";
import type { TransmutationRow } from "@/lib/gradeMath";

interface ClassRecordResponse {
  classAssignment: ClassAssignment;
  classRecord: ClassRecord[];
  currentTerm?: "T1" | "T2" | "T3";
  effectiveWeights?: {
    ww: number;
    pt: number;
    qa: number;
    source: "subject-override" | "subject-type" | "generic-fallback";
  };
  termDates?: {
    t1StartDate?: string | null;
    t1EndDate?: string | null;
    t2StartDate?: string | null;
    t2EndDate?: string | null;
    t3StartDate?: string | null;
    t3EndDate?: string | null;
  };
  gradeLock?: boolean;
  locks?: {
    systemLocked: boolean;
    yearLocked: boolean;
    termLocks: { T1: boolean; T2: boolean; T3: boolean };
  };
  inheritedGrades?: InheritedGrade[];
  inheritedFromTeachers?: InheritedFromTeacher[];
  successorTeacherName?: string | null;
}

export function useClassRecordQuery(classAssignmentId: string | undefined, selectedTerm: string) {
  return useQuery<ClassRecordResponse>({
    queryKey: ["class-record", classAssignmentId, selectedTerm],
    queryFn: async () => {
      if (!classAssignmentId) throw new Error("No class assignment ID");
      const res = await gradesApi.getClassRecord(classAssignmentId, selectedTerm);
      return res.data;
    },
    enabled: !!classAssignmentId,
    placeholderData: (prev) => prev,
  });
}

export function useTransmutationTable() {
  return useQuery<TransmutationRow[]>({
    queryKey: ["transmutation-table"],
    queryFn: async () => {
      const res = await gradesApi.getTransmutationTable();
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useEditRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["edit-requests"],
    queryFn: async () => {
      const res = await gradesApi.getMyEditRequests();
      return res.data;
    },
    refetchInterval: 60_000,
    enabled,
  });
}

export function useSaveScore(classAssignmentId: string | undefined, selectedTerm: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      studentId: string;
      category: "WW" | "PT" | "QA";
      index: number;
      newValue: number | "A" | "E";
      qaMeta: { description: string; date: string };
      scores: { wwScores: ScoreItem[]; ptScores: ScoreItem[] };
    }) => {
      if (!classAssignmentId) throw new Error("No class assignment ID");
      return gradesApi.saveGrade({
        studentId: data.studentId,
        classAssignmentId,
        term: selectedTerm,
        writtenWorkScores: data.category === "WW" ? data.scores.wwScores : undefined,
        perfTaskScores: data.category === "PT" ? data.scores.ptScores : undefined,
        quarterlyAssessScore: data.category === "QA" ? (typeof data.newValue === "number" ? data.newValue : 0) : undefined,
        qaDescription: data.qaMeta.description || undefined,
        qaDate: data.qaMeta.date || undefined,
      });
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["class-record", classAssignmentId] });
      const previous = queryClient.getQueryData<ClassRecordResponse>(["class-record", classAssignmentId, selectedTerm]);

      if (previous) {
        queryClient.setQueryData<ClassRecordResponse>(
          ["class-record", classAssignmentId, selectedTerm],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              classRecord: old.classRecord.map((record) => {
                if (record.student.id !== data.studentId) return record;
                return {
                  ...record,
                  grades: record.grades.map((grade) => {
                    if (grade.term !== selectedTerm) return grade;
                    return { ...grade, ...data.scores };
                  }),
                };
              }),
            };
          }
        );
      }

      return { previous };
    },
    onError: (_err, _data, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["class-record", classAssignmentId, selectedTerm], context.previous);
      }
    },
  });
}

export function useBatchSave(classAssignmentId: string | undefined, selectedTerm: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      updates: Array<{
        studentId: string;
        writtenWorkScores?: ScoreItem[];
        perfTaskScores?: ScoreItem[];
        quarterlyAssessScore?: number;
        quarterlyAssessMax?: number;
        qaDescription?: string;
        qaDate?: string;
      }>;
    }) => {
      if (!classAssignmentId) throw new Error("No class assignment ID");
      return gradesApi.saveGradeBatch({
        classAssignmentId,
        term: selectedTerm,
        updates: data.updates,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["class-record", classAssignmentId] });
    },
  });
}

export function useAimsScoresQuery(
  classAssignmentId: string | undefined,
  selectedTerm: string,
  syncVersion: number,
) {
  return useQuery<AimsScoresResponse>({
    queryKey: ["aims-scores", classAssignmentId, selectedTerm, syncVersion],
    queryFn: async () => {
      if (!classAssignmentId) throw new Error("No class assignment ID");
      const res = await gradesApi.getAimsScores(classAssignmentId, selectedTerm);
      return res.data;
    },
    enabled: !!classAssignmentId,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
