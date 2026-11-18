import { useState, useEffect, useCallback } from "react";
import { gradesApi } from "@/lib/api";

interface EditRequest {
  id: string;
  term: string;
  status: string;
  expiresAt: string | null;
  windowRequired?: boolean;
  classAssignmentId?: string | null;
}

interface LockState {
  systemLocked: boolean;
  yearLocked: boolean;
  termLocks: { T1: boolean; T2: boolean; T3: boolean };
}

type RequestStatus =
  | "idle"
  | "pending"
  | "approved"
  | "awaiting_window"
  | "window_open"
  | "awaiting_refinalize";

interface RequestInfo {
  term: string;
  status: RequestStatus;
  expiresAt: Date | null;
  requestId: string | null;
}

function matchesScope(request: EditRequest, opts: { selectedTerm: string; classAssignmentId?: string }): boolean {
  if (request.term !== opts.selectedTerm) return false;
  if (!opts.classAssignmentId) return true;
  return !request.classAssignmentId || request.classAssignmentId === opts.classAssignmentId;
}

/**
 * Computes whether a teacher may edit the selected term.
 *
 * Rules (mirror server `getGradeEditLocks` + `getWriteBlock`):
 *  - system-wide and year locks are NOT bypassable.
 *  - a past term or a TERM lock is bypassable with an approved request.
 *  - a finalized term is bypassable only by an open correction window.
 *  - an expired correction window is read-only until the registrar re-finalizes.
 */
export function useEditAccess(opts: {
  isPastTerm: boolean;
  locks: LockState | null;
  selectedTerm: string;
  isTermFinalized: boolean;
  classAssignmentId?: string;
}) {
  const { selectedTerm, classAssignmentId } = opts;
  const [editRequestModalOpen, setEditRequestModalOpen] = useState(false);
  const [requestInfo, setRequestInfo] = useState<RequestInfo>({ term: "", status: "idle", expiresAt: null, requestId: null });
  const [editTimeRemaining, setEditTimeRemaining] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const termLocked = !!opts.locks?.termLocks?.[opts.selectedTerm as "T1" | "T2" | "T3"];
  const hardLocked = !!opts.locks?.systemLocked || !!opts.locks?.yearLocked;
  const sealed = opts.isTermFinalized;
  const needsAccess = opts.isPastTerm || termLocked || sealed;
  const accessRequired = needsAccess && !hardLocked;

  // Only trust status that belongs to the currently selected term/class.
  const scoped: RequestInfo =
    !hardLocked && requestInfo.term === opts.selectedTerm
      ? requestInfo
      : { term: selectedTerm, status: "idle", expiresAt: null, requestId: null };

  const editRequestStatus = scoped.status;
  const editRequestExpiresAt = scoped.expiresAt;

  const windowOpen = editRequestStatus === "window_open";
  const awaitingRefinalize = editRequestStatus === "awaiting_refinalize";
  const approvedForLock = editRequestStatus === "approved";

  const isViewOnly =
    hardLocked ||
    awaitingRefinalize ||
    (sealed && !windowOpen) ||
    (needsAccess && !windowOpen && !approvedForLock);

  const canRequestEdit = accessRequired && editRequestStatus === "idle";

  // Countdown for approved legacy access and open correction windows.
  useEffect(() => {
    if (!editRequestExpiresAt || !(editRequestStatus === "approved" || editRequestStatus === "window_open")) return;

    const updateRemaining = () => {
      const diff = editRequestExpiresAt.getTime() - Date.now();
      if (diff <= 0) {
        setEditTimeRemaining("Expired");
        setRequestInfo((prev) => ({
          ...prev,
          status: prev.status === "window_open" ? "awaiting_refinalize" : "idle",
        }));
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      setEditTimeRemaining(
        hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`
      );
    };
    updateRemaining();
    const interval = setInterval(updateRemaining, 60000);
    return () => clearInterval(interval);
  }, [editRequestStatus, editRequestExpiresAt]);

  // Check for existing requests. Polls so approval/window changes take effect
  // without a manual reload. Never gated on the coarse lock flag.
  useEffect(() => {
    if (hardLocked) return;

    let cancelled = false;
    const check = () => {
      gradesApi.getMyEditRequests().then((res) => {
        if (cancelled) return;
        const requests = (res.data.requests ?? []) as EditRequest[];
        const scopedRequests = requests.filter((r) => matchesScope(r, { selectedTerm, classAssignmentId }));
        const now = Date.now();

        const windowOpen = scopedRequests.find(
          (r) => r.status === "WINDOW_OPEN" && new Date(r.expiresAt ?? 0).getTime() > now,
        );
        const awaitingRefinalize = scopedRequests.find(
          (r) =>
            r.windowRequired &&
            (r.status === "EXPIRED" ||
              (r.status === "WINDOW_OPEN" && new Date(r.expiresAt ?? 0).getTime() <= now)),
        );
        const awaitingWindow = scopedRequests.find(
          (r) => r.status === "APPROVED" && r.windowRequired,
        );
        const approved = scopedRequests.find(
          (r) =>
            r.status === "APPROVED" &&
            !r.windowRequired &&
            new Date(r.expiresAt ?? 0).getTime() > now,
        );
        const pending = scopedRequests.find((r) => r.status === "PENDING");

        if (windowOpen?.expiresAt) {
          setRequestInfo({
            term: selectedTerm,
            status: "window_open",
            expiresAt: new Date(windowOpen.expiresAt), requestId: windowOpen.id,
          });
        } else if (awaitingRefinalize) {
          setRequestInfo({ term: selectedTerm, status: "awaiting_refinalize", expiresAt: null, requestId: null });
        } else if (awaitingWindow) {
          setRequestInfo({ term: selectedTerm, status: "awaiting_window", expiresAt: null, requestId: null });
        } else if (approved?.expiresAt) {
          setRequestInfo({
            term: selectedTerm,
            status: "approved",
            expiresAt: new Date(approved.expiresAt), requestId: approved.id,
          });
        } else if (pending) {
          setRequestInfo({ term: selectedTerm, status: "pending", expiresAt: null, requestId: null });
        } else {
          setRequestInfo({ term: selectedTerm, status: "idle", expiresAt: null, requestId: null });
        }
      }).catch(() => {});
    };

    check();
    const interval = setInterval(check, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hardLocked, selectedTerm, classAssignmentId, refreshKey]);

  const openEditRequestModal = useCallback(() => setEditRequestModalOpen(true), []);
  const refreshEditRequests = useCallback(() => setRefreshKey((value) => value + 1), []);

  return {
    editRequestModalOpen,
    setEditRequestModalOpen,
    editRequestStatus,
    editRequestExpiresAt,
    editTimeRemaining,
    windowRequestId: scoped.requestId,
    isViewOnly,
    canRequestEdit,
    openEditRequestModal,
    refreshEditRequests,
    onEditRequestSuccess: () =>
      setRequestInfo({ term: selectedTerm, status: "pending", expiresAt: null, requestId: null }),
  };
}
