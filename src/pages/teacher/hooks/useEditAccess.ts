import { useState, useEffect, useCallback } from "react";
import { gradesApi } from "@/lib/api";

interface EditRequest {
  id: string;
  term: string;
  status: string;
  expiresAt: string | null;
}

interface LockState {
  systemLocked: boolean;
  yearLocked: boolean;
  termLocks: { T1: boolean; T2: boolean; T3: boolean };
}

type RequestStatus = "idle" | "pending" | "approved";

interface RequestInfo {
  term: string;
  status: RequestStatus;
  expiresAt: Date | null;
}

/**
 * Computes whether a teacher may edit the selected term.
 *
 * Rules (mirror server `checkGradeEditLocks`):
 *  - system-wide (emergency) lock and year lock are NOT bypassable.
 *  - a past term or a TERM lock IS bypassable with an approved edit request.
 */
export function useEditAccess(opts: {
  isPastTerm: boolean;
  locks: LockState | null;
  selectedTerm: string;
}) {
  const [editRequestModalOpen, setEditRequestModalOpen] = useState(false);
  const [requestInfo, setRequestInfo] = useState<RequestInfo>({ term: "", status: "idle", expiresAt: null });
  const [editTimeRemaining, setEditTimeRemaining] = useState("");

  const termLocked = !!opts.locks?.termLocks?.[opts.selectedTerm as "T1" | "T2" | "T3"];
  const hardLocked = !!opts.locks?.systemLocked || !!opts.locks?.yearLocked;
  // Needs an approved request: viewing a past term, or the term is locked.
  const needsAccess = opts.isPastTerm || termLocked;
  // Only request-bypassable situations; year/system locks can't be edited at all.
  const accessRequired = needsAccess && !hardLocked;

  // Only trust status that belongs to the currently selected term.
  const scoped: RequestInfo =
    accessRequired && requestInfo.term === opts.selectedTerm
      ? requestInfo
      : { term: opts.selectedTerm, status: "idle", expiresAt: null };

  const editRequestStatus = scoped.status;
  const editRequestExpiresAt = scoped.expiresAt;

  const isViewOnly = hardLocked || (needsAccess && editRequestStatus !== "approved");
  const canRequestEdit = accessRequired && editRequestStatus === "idle";

  // Countdown for approved edit access
  useEffect(() => {
    if (editRequestStatus !== "approved" || !editRequestExpiresAt) return;
    const updateRemaining = () => {
      const diff = editRequestExpiresAt.getTime() - Date.now();
      if (diff <= 0) {
        setEditTimeRemaining("Expired");
        setRequestInfo((prev) => ({ ...prev, status: "idle" }));
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

  // Check for existing edit requests. Polls so an approval takes effect without
  // a manual reload. Never gated on the coarse lock flag — a term lock is
  // exactly the case an approved request is meant to open.
  useEffect(() => {
    if (!accessRequired) return;

    let cancelled = false;
    const check = () => {
      gradesApi.getMyEditRequests().then((res) => {
        if (cancelled) return;
        const requests = res.data.requests ?? [];
        const approved = requests.find(
          (r: EditRequest) =>
            r.term === opts.selectedTerm &&
            r.status === "APPROVED" &&
            new Date(r.expiresAt ?? 0) > new Date()
        );
        const pending = requests.find(
          (r: EditRequest) => r.term === opts.selectedTerm && r.status === "PENDING"
        );
        if (approved) {
          setRequestInfo({ term: opts.selectedTerm, status: "approved", expiresAt: new Date(approved.expiresAt) });
        } else if (pending) {
          setRequestInfo({ term: opts.selectedTerm, status: "pending", expiresAt: null });
        } else {
          setRequestInfo({ term: opts.selectedTerm, status: "idle", expiresAt: null });
        }
      }).catch(() => {});
    };

    check();
    const interval = setInterval(check, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [accessRequired, opts.selectedTerm]);

  const openEditRequestModal = useCallback(() => setEditRequestModalOpen(true), []);

  return {
    editRequestModalOpen,
    setEditRequestModalOpen,
    editRequestStatus,
    editRequestExpiresAt,
    editTimeRemaining,
    isViewOnly,
    canRequestEdit,
    openEditRequestModal,
    onEditRequestSuccess: () =>
      setRequestInfo({ term: opts.selectedTerm, status: "pending", expiresAt: null }),
  };
}
