import { useState } from "react";
import { XCircle, ShieldCheck, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AppModal, AlertBanner, InfoCard } from "@/components/app-modal";
import { gradesApi } from "@/lib/api";
import { toast } from "@/lib/toast";

interface EditRequest {
  id: string;
  teacherName: string;
  term: string;
  schoolYear: string;
  gradeLevel?: string;
  section?: string;
  subject?: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  approvedByName?: string;
  expiresAt?: string;
  createdAt: string;
}

function termLabel(t: string) {
  return t === "T1" ? "Term 1" : t === "T2" ? "Term 2" : t === "T3" ? "Term 3" : t;
}

// ─── Approve Modal ────────────────────────────────────────────────
interface ApproveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: EditRequest | null;
  onApproved: () => void;
}

export function ApproveModal({ open, onOpenChange, request, onApproved }: ApproveModalProps) {
  const [hours, setHours] = useState("24");
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    if (!request) return;
    const h = parseInt(hours);
    if (isNaN(h) || h < 1 || h > 168) return;
    setLoading(true);
    try {
      await gradesApi.approveEditRequest(request.id, h);
      onOpenChange(false);
      onApproved();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message || "Failed to approve request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={<ShieldCheck className="w-6 h-6" />}
      title="Approve Edit Access"
      description={<>Grant <strong>{request?.teacherName}</strong> temporary edit access for <strong>{termLabel(request?.term || "")}</strong> grades.</>}
      confirmLabel="Grant Access"
      onConfirm={handleApprove}
      confirmDisabled={!hours || parseInt(hours) < 1}
      loading={loading}
    >
      <div className="space-y-4">
        <InfoCard tone="primary" label="Teacher's Reason">
          <p className="text-sm text-foreground">{request?.reason}</p>
        </InfoCard>

        <div className="space-y-2">
          <Label htmlFor="approveDuration" className="text-sm font-semibold">Duration (hours)</Label>
          <Input
            id="approveDuration"
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="24"
          />
          <p className="text-xs text-muted-foreground">Access expires automatically after this duration. Maximum: 168 hours (1 week).</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {["4", "8", "24", "48", "72", "168"].map((h) => (
            <Button
              key={h}
              type="button"
              size="xs"
              variant={hours === h ? "default" : "outline"}
              onClick={() => setHours(h)}
              className="font-semibold"
            >
              {h}h
            </Button>
          ))}
        </div>
      </div>
    </AppModal>
  );
}

// ─── Reject Modal ─────────────────────────────────────────────────
interface RejectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: EditRequest | null;
  onRejected: () => void;
}

export function RejectModal({ open, onOpenChange, request, onRejected }: RejectModalProps) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleReject = async () => {
    if (!request) return;
    setLoading(true);
    try {
      await gradesApi.rejectEditRequest(request.id, reason || undefined);
      setReason("");
      onOpenChange(false);
      onRejected();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message || "Failed to reject request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={<XCircle className="w-6 h-6" />}
      title="Reject Edit Request"
      description={<>Reject the edit request from <strong>{request?.teacherName}</strong> for <strong>{termLabel(request?.term || "")}</strong>.</>}
      confirmLabel="Reject Request"
      destructive
      onConfirm={handleReject}
      loading={loading}
    >
      <div className="space-y-4">
        <AlertBanner variant="warning" title="Teacher's Reason">
          {request?.reason}
        </AlertBanner>

        <div className="space-y-2">
          <Label htmlFor="rejectReason" className="text-sm font-semibold">Rejection Reason (optional)</Label>
          <Textarea
            id="rejectReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Grades are finalized and cannot be changed..."
            className="min-h-[80px] resize-none"
          />
        </div>
      </div>
    </AppModal>
  );
}

// ─── Revoke Modal ─────────────────────────────────────────────────
interface RevokeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: EditRequest | null;
  onRevoked: () => void;
}

export function RevokeModal({ open, onOpenChange, request, onRevoked }: RevokeModalProps) {
  const [loading, setLoading] = useState(false);

  const handleRevoke = async () => {
    if (!request) return;
    setLoading(true);
    try {
      await gradesApi.revokeEditRequest(request.id);
      onOpenChange(false);
      onRevoked();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message || "Failed to revoke access");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={<Ban className="w-6 h-6" />}
      title="Revoke Edit Access"
      description={<>Immediately revoke edit access for <strong>{request?.teacherName}</strong>.</>}
      confirmLabel="Revoke Access"
      destructive
      onConfirm={handleRevoke}
      loading={loading}
    >
      <div className="space-y-4">
        <AlertBanner variant="danger" title="This action is immediate.">
          The teacher will lose the ability to edit <strong>{termLabel(request?.term || "")}</strong> grades right away.
          They can still submit a new edit request afterward.
        </AlertBanner>

        <div className="bg-muted rounded-xl p-3 border border-border text-sm text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>Teacher</span>
            <span className="font-medium text-foreground">{request?.teacherName}</span>
          </div>
          <div className="flex justify-between">
            <span>Term</span>
            <span className="font-medium text-foreground">{termLabel(request?.term || "")}</span>
          </div>
          <div className="flex justify-between">
            <span>Approved by</span>
            <span className="font-medium text-foreground">{request?.approvedByName || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Expires</span>
            <span className="font-medium text-foreground">{request?.expiresAt ? new Date(request.expiresAt).toLocaleString() : "—"}</span>
          </div>
        </div>
      </div>
    </AppModal>
  );
}
