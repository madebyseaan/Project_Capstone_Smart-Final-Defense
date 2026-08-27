import { useState } from "react";
import { Clock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { gradesApi, type ClassAssignment } from "@/lib/api";

interface EditRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  selectedTerm: string;
  classAssignment: ClassAssignment | null;
  userName: string;
}

function termLabel(t: string) {
  return t === "T1" ? "Term 1" : t === "T2" ? "Term 2" : t === "T3" ? "Term 3" : t;
}

export function EditRequestModal({
  open,
  onOpenChange,
  onSuccess,
  selectedTerm,
  classAssignment,
  userName,
}: EditRequestModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await gradesApi.createEditRequest({
        term: selectedTerm,
        reason: reason.trim(),
        classAssignmentId: classAssignment?.id,
        gradeLevel: classAssignment?.section?.gradeLevel || undefined,
        section: classAssignment?.section?.name || undefined,
        subject: classAssignment?.subject?.name || undefined,
      });
      setReason("");
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-600" />
            Edit Access Request
          </DialogTitle>
          <DialogDescription>
            Submit a request to admin for temporary edit access to past-term grades.
          </DialogDescription>
        </DialogHeader>

        {/* Ticket Card */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
          <div className="bg-slate-700 text-white px-4 py-2 flex items-center justify-between text-xs font-medium">
            <span>GRADE EDIT REQUEST</span>
            <span className="opacity-70">{new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>

          <div className="px-4 py-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Teacher</span>
                <p className="text-slate-800 font-medium">{userName}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Term</span>
                <p className="text-slate-800 font-medium">{termLabel(selectedTerm)}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Grade Level</span>
                <p className="text-slate-800 font-medium">{classAssignment?.section?.gradeLevel?.replace("GRADE_", "Grade ") || "—"}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Section</span>
                <p className="text-slate-800 font-medium">{classAssignment?.section?.name || "—"}</p>
              </div>
              <div className="col-span-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Subject</span>
                <p className="text-slate-800 font-medium">{classAssignment?.subject?.name || "—"}</p>
              </div>
            </div>

            <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Reason for editing</span>
              <textarea
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] bg-white"
                placeholder="e.g., Need to correct grades for student who was absent during the exam..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!reason.trim() || submitting}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {submitting ? "Submitting..." : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
