import { useCallback, useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { gradesApi, type ClassRecord } from "@/lib/api";
import { buildScoreSavePayload, type ApplyMetaToScores, type ScoreEdit } from "../components/classRecordActions";

const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 1500;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [800, 2500, 6000];

interface QueuedScoreEdit extends ScoreEdit {
  term: string;
}

interface QueueOptions {
  classAssignmentId?: string;
  selectedTerm: string;
  queryClient: QueryClient;
  qaMeta: { description: string; date: string };
  applyMetaToScores: ApplyMetaToScores;
  onError: (message: string) => void;
  refetch: () => Promise<void>;
}

interface ClassRecordCache {
  classRecord?: ClassRecord[];
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useScoreWriteQueue(opts: QueueOptions) {
  const optsRef = useRef(opts);

  useEffect(() => {
    optsRef.current = opts;
  });

  const pendingRef = useRef<Map<string, QueuedScoreEdit>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const scheduleRef = useRef<() => void>(() => {});

  const runFlush = useCallback(async () => {
    while (pendingRef.current.size > 0) {
      const { classAssignmentId, queryClient } = optsRef.current;
      if (!classAssignmentId) {
        pendingRef.current.clear();
        return;
      }

      const batch = new Map(pendingRef.current);
      pendingRef.current.clear();

      const groups = new Map<string, { term: string; studentId: string; edits: ScoreEdit[] }>();
      for (const edit of batch.values()) {
        const key = `${edit.term}|${edit.studentId}`;
        const group = groups.get(key) ?? { term: edit.term, studentId: edit.studentId, edits: [] };
        group.edits.push(edit);
        groups.set(key, group);
      }

      let saved = false;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS && !saved; attempt += 1) {
        try {
          await Promise.all(
            [...groups.values()].map(async (group) => {
              const data = queryClient.getQueryData<ClassRecordCache>(["class-record", classAssignmentId, group.term]);
              const record = data?.classRecord?.find((r) => r.student.id === group.studentId);
              if (!record) return;
              const payload = buildScoreSavePayload({
                record,
                classAssignmentId,
                selectedTerm: group.term,
                edits: group.edits,
                qaMeta: optsRef.current.qaMeta,
                applyMetaToScores: optsRef.current.applyMetaToScores,
              });
              await gradesApi.saveGrade(payload);
            }),
          );
          saved = true;
        } catch (err: unknown) {
          lastError = err;
          if (attempt < MAX_ATTEMPTS - 1) {
            await delay(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
          }
        }
      }

      if (!saved) {
        pendingRef.current.clear();
        optsRef.current.onError(
          (lastError as any)?.response?.data?.message || "Failed to save scores. Please retry.",
        );
        await optsRef.current.refetch();
        return;
      }
    }
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) {
      await flushPromiseRef.current;
      return;
    }
    flushingRef.current = true;
    const promise = runFlush().finally(() => {
      flushingRef.current = false;
      flushPromiseRef.current = null;
      if (hardTimerRef.current && pendingRef.current.size === 0) {
        clearTimeout(hardTimerRef.current);
        hardTimerRef.current = null;
      }
    });
    flushPromiseRef.current = promise;
    await promise;
  }, [runFlush]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, DEBOUNCE_MS);
    if (!hardTimerRef.current) {
      hardTimerRef.current = setTimeout(() => {
        hardTimerRef.current = null;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        void flushRef.current();
      }, MAX_WAIT_MS);
    }
  }, []);

  useEffect(() => {
    flushRef.current = flush;
    scheduleRef.current = scheduleFlush;
  });

  const enqueue = useCallback((edit: ScoreEdit) => {
    const term = optsRef.current.selectedTerm;
    const key = `${term}|${edit.studentId}|${edit.category}|${edit.index}`;
    pendingRef.current.set(key, { ...edit, term });
    scheduleRef.current();
  }, []);

  const flushNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (hardTimerRef.current) {
      clearTimeout(hardTimerRef.current);
      hardTimerRef.current = null;
    }
    await flushRef.current();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.size === 0 && !flushingRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (hardTimerRef.current) clearTimeout(hardTimerRef.current);
      void flushRef.current();
    };
  }, []);

  const hasPending = useCallback(() => pendingRef.current.size > 0 || flushingRef.current, []);

  return { enqueue, flushNow, hasPending };
}
