import React, { useState, useEffect, useCallback } from "react";
import { FileText, Clock, CheckCircle, XCircle, Loader2, Timer, BookOpen, GraduationCap, Layers, Ban } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { gradesApi } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";

import { ApproveModal, RejectModal, RevokeModal } from "./components/EditRequestModals";

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

function gradeLabel(g?: string) {
  if (!g) return "—";
  return g.replace("GRADE_", "Grade ");
}

const StatusBadge = React.memo(function StatusBadge({ status }: { status: EditRequest["status"] }) {
  switch (status) {
    case "PENDING":
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    case "APPROVED":
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
    case "REJECTED":
      return <Badge className="bg-red-100 text-red-700 border-red-200"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
    case "EXPIRED":
      return <Badge className="bg-muted text-muted-foreground border-border"><Timer className="w-3 h-3 mr-1" />Expired</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
});

export default function EditRequests() {
  const { colors } = useTheme();
  const [requests, setRequests] = useState<EditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED">("PENDING");

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailReq, setDetailReq] = useState<EditRequest | null>(null);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveReq, setApproveReq] = useState<EditRequest | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReq, setRejectReq] = useState<EditRequest | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReq, setRevokeReq] = useState<EditRequest | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = filter === "ALL" ? undefined : filter;
      const res = await gradesApi.getAdminEditRequests(statusParam);
      setRequests(res.data.requests || []);
    } catch (err) {
      console.error("Failed to fetch edit requests:", err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const openDetail = (req: EditRequest) => {
    setDetailReq(req);
    setDetailOpen(true);
  };

  const handleSuccess = () => {
    setDetailOpen(false);
    setDetailReq(null);
    fetchRequests();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Card className="border-0 shadow-xl shadow-gray-200/50 bg-white overflow-hidden rounded-2xl">
        <CardHeader className="border-b border-gray-100 px-6 py-5">
          <PageHeader
            title="Grade Edit Requests"
            description="Review and manage teacher requests to edit past-term grades"
          />
        </CardHeader>

        <div className="px-6 py-3 border-b border-gray-100 flex gap-2">
          {(["ALL", "PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                filter === f
                  ? "text-white shadow-md"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
              style={filter === f ? { backgroundColor: colors.primary } : undefined}
            >
              {f}
            </button>
          ))}
        </div>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: colors.primary }} />
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No {filter.toLowerCase()} requests</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="px-6 py-4 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  onClick={() => openDetail(req)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="p-2.5 rounded-xl bg-blue-50 flex-shrink-0">
                        <FileText className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-foreground">{req.teacherName}</h3>
                          <StatusBadge status={req.status} />
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <GraduationCap className="w-3.5 h-3.5 text-muted-foreground" />
                            {gradeLabel(req.gradeLevel)}
                          </span>
                          {req.section && (
                            <span className="flex items-center gap-1">
                              <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                              {req.section}
                            </span>
                          )}
                          {req.subject && (
                            <span className="flex items-center gap-1">
                              <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
                              {req.subject}
                            </span>
                          )}
                          <span className="text-muted-foreground">|</span>
                          <span>{termLabel(req.term)}</span>
                          <span className="text-muted-foreground">|</span>
                          <span>{req.schoolYear}</span>
                        </div>
                        {req.approvedByName && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Approved by {req.approvedByName} · Expires: {req.expiresAt ? new Date(req.expiresAt).toLocaleString() : "N/A"}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Submitted: {new Date(req.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {req.status === "PENDING" && (
                      <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => { setRejectReq(req); setRejectOpen(true); }}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          className="text-white"
                          style={{ backgroundColor: colors.primary }}
                          onClick={() => { setApproveReq(req); setApproveOpen(true); }}
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                      </div>
                    )}
                    {req.status === "APPROVED" && (
                      <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => { setRevokeReq(req); setRevokeOpen(true); }}
                        >
                          <Ban className="w-4 h-4 mr-1" />
                          Revoke
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <FileText className="w-5 h-5 text-blue-600" />
              Edit Request Ticket
            </DialogTitle>
          </DialogHeader>

          {detailReq && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="bg-slate-700 text-white px-4 py-2 flex items-center justify-between text-xs font-medium">
                  <span>GRADE EDIT REQUEST</span>
                  <span className="opacity-70">
                    {new Date(detailReq.createdAt).toLocaleDateString("en-PH", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Teacher</span>
                      <p className="text-foreground font-medium">{detailReq.teacherName}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</span>
                      <div className="mt-0.5"><StatusBadge status={detailReq.status} /></div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Grade Level</span>
                      <p className="text-foreground font-medium">{gradeLabel(detailReq.gradeLevel)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Section</span>
                      <p className="text-foreground font-medium">{detailReq.section || "—"}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Subject</span>
                      <p className="text-foreground font-medium">{detailReq.subject || "—"}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Term</span>
                      <p className="text-foreground font-medium">{termLabel(detailReq.term)} · {detailReq.schoolYear}</p>
                    </div>
                  </div>
                  <div className="border-t border-border pt-2.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Reason</span>
                    <p className="text-sm text-foreground mt-0.5">{detailReq.reason}</p>
                  </div>
                  {detailReq.approvedByName && (
                    <div className="border-t border-border pt-2.5 text-xs text-muted-foreground">
                      Approved by <span className="font-medium">{detailReq.approvedByName}</span> · Expires:{" "}
                      {detailReq.expiresAt ? new Date(detailReq.expiresAt).toLocaleString() : "N/A"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {detailReq?.status === "PENDING" && (
              <>
                <Button
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => { setRejectReq(detailReq); setRejectOpen(true); }}
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Reject
                </Button>
                <Button
                  className="text-white"
                  style={{ backgroundColor: colors.primary }}
                  onClick={() => { setApproveReq(detailReq); setApproveOpen(true); }}
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Approve
                </Button>
              </>
            )}
            {detailReq?.status === "APPROVED" && (
              <Button
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => { setRevokeReq(detailReq); setRevokeOpen(true); }}
              >
                <Ban className="w-4 h-4 mr-1" />
                Revoke Access
              </Button>
            )}
            {detailReq?.status !== "PENDING" && detailReq?.status !== "APPROVED" && (
              <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApproveModal open={approveOpen} onOpenChange={setApproveOpen} request={approveReq} onApproved={handleSuccess} />
      <RejectModal open={rejectOpen} onOpenChange={setRejectOpen} request={rejectReq} onRejected={handleSuccess} />
      <RevokeModal open={revokeOpen} onOpenChange={setRevokeOpen} request={revokeReq} onRevoked={handleSuccess} />
    </div>
  );
}
