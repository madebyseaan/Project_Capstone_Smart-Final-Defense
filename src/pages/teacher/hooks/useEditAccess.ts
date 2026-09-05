import { useState, useEffect, useCallback } from "react";
import { gradesApi } from "@/lib/api";

export function useEditAccess(opts: {
  isPastTerm: boolean;
  gradeLock: boolean;
  selectedTerm: string;
}) {
  const [editRequestModalOpen, setEditRequestModalOpen] = useState(false);
  const [editRequestStatus, setEditRequestStatus] = useState<"idle" | "pending" | "approved">("idle");
  const [editRequestExpiresAt, setEditRequestExpiresAt] = useState<Date | null>(null);
  const [editTimeRemaining, setEditTimeRemaining] = useState("");

  const isViewOnly = (opts.isPastTerm || opts.gradeLock) && editRequestStatus !== "approved";

  // Countdown for approved edit access
  useEffect(() => {
    if (editRequestStatus !== "approved" || !editRequestExpiresAt) return;
    const updateRemaining = () => {
      const diff = editRequestExpiresAt.getTime() - Date.now();
      if (diff <= 0) {
        setEditTimeRemaining("Expired");
        setEditRequestStatus("idle");
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      setEditTimeRemaining(`${hours}h ${minutes}m remaining`);
    };
    updateRemaining();
    const interval = setInterval(updateRemaining, 60000);
    return () => clearInterval(interval);
  }, [editRequestStatus, editRequestExpiresAt]);

  // Check for existing edit requests
  useEffect(() => {
    if (!opts.isPastTerm || opts.gradeLock) return;
    gradesApi.getMyEditRequests().then((res) => {
      const requests = res.data.requests ?? [];
      const pending = requests.find((r: any) => r.term === opts.selectedTerm && r.status === "PENDING");
      const approved = requests.find((r: any) => r.term === opts.selectedTerm && r.status === "APPROVED" && new Date(r.expiresAt) > new Date());
      if (approved) {
        setEditRequestStatus("approved");
        setEditRequestExpiresAt(new Date(approved.expiresAt));
      } else if (pending) {
        setEditRequestStatus("pending");
      } else {
        setEditRequestStatus("idle");
      }
    }).catch(() => {});
  }, [opts.isPastTerm, opts.gradeLock, opts.selectedTerm]);

  const openEditRequestModal = useCallback(() => setEditRequestModalOpen(true), []);

  return {
    editRequestModalOpen,
    setEditRequestModalOpen,
    editRequestStatus,
    editRequestExpiresAt,
    editTimeRemaining,
    isViewOnly,
    openEditRequestModal,
    onEditRequestSuccess: () => setEditRequestStatus("pending"),
  };
}
