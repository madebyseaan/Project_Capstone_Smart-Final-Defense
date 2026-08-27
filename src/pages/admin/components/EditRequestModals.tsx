import { useState } from "react";
import { Clock, CheckCircle, XCircle, ShieldCheck, Ban, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { gradesApi } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

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
  const { colors } = useTheme();
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
    } catch (err: any) {
      alert(err?.response?.data?.message || "Failed to approve request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Approve Edit Access
          </DialogTitle>
          <DialogDescription>
            Grant <strong>{request?.teacherName}</strong> temporary edit access for <strong>{termLabel(request?.term || "")}</strong> grades.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
            <p className="text-sm text-blue-800 font-medium mb-1">Teacher's Reason:</p>
            <p className="text-sm text-blue-600">{request?.reason}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-700">Duration (hours)</Label>
            <input
              type="number"
              min={1}
              max={168}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="24"
              className="w-full h-10 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-gray-500">Access expires automatically after this duration. Maximum: 168 hours (1 week).</p>
          </div>

          <div className="flex gap-2">
            {["4", "8", "24", "48", "72", "168"].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  hours === h
                    ? "text-white shadow-md"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                style={hours === h ? { backgroundColor: colors.primary } : undefined}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            disabled={loading || !hours || parseInt(hours) < 1}
            className="text-white"
            style={{ backgroundColor: colors.primary }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            Grant Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    } catch (err: any) {
      alert(err?.response?.data?.message || "Failed to reject request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <XCircle className="w-5 h-5 text-red-600" />
            Reject Edit Request
          </DialogTitle>
          <DialogDescription>
            Reject the edit request from <strong>{request?.teacherName}</strong> for <strong>{termLabel(request?.term || "")}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
            <p className="text-sm text-amber-800 font-medium mb-1">Teacher's Reason:</p>
            <p className="text-sm text-amber-600">{request?.reason}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-700">Rejection Reason (optional)</Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Grades are finalized and cannot be changed..."
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 min-h-[80px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleReject} disabled={loading} variant="destructive">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
            Reject Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    } catch (err: any) {
      alert(err?.response?.data?.message || "Failed to revoke access");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Ban className="w-5 h-5 text-red-600" />
            Revoke Edit Access
          </DialogTitle>
          <DialogDescription>
            Immediately revoke edit access for <strong>{request?.teacherName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="bg-red-50 rounded-xl p-4 border border-red-100">
            <p className="text-sm text-red-800 font-medium mb-1">This action is immediate.</p>
            <p className="text-sm text-red-600">
              The teacher will lose the ability to edit <strong>{termLabel(request?.term || "")}</strong> grades right away.
              They can still submit a new edit request afterward.
            </p>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-sm text-slate-600 space-y-1">
            <div className="flex justify-between">
              <span>Teacher</span>
              <span className="font-medium text-slate-800">{request?.teacherName}</span>
            </div>
            <div className="flex justify-between">
              <span>Term</span>
              <span className="font-medium text-slate-800">{termLabel(request?.term || "")}</span>
            </div>
            <div className="flex justify-between">
              <span>Approved by</span>
              <span className="font-medium text-slate-800">{request?.approvedByName || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>Expires</span>
              <span className="font-medium text-slate-800">{request?.expiresAt ? new Date(request.expiresAt).toLocaleString() : "—"}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleRevoke} disabled={loading} variant="destructive">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Ban className="w-4 h-4 mr-2" />}
            Revoke Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
