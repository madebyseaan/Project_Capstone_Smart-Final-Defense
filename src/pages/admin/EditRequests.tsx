import { useState, useEffect, useCallback } from "react";
import { FileText, Clock, CheckCircle, XCircle, Timer, BookOpen, GraduationCap, Layers, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { gradesApi } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { SearchInput } from "@/components/layout/SearchInput";
import { AppModal } from "@/components/app-modal";
import { DataTable, usePagination } from "@/components/data-table";
import type { TableColumn } from "@/components/data-table";
import { Dash } from "@/components/data-table/Dash";

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

const StatusBadge = function StatusBadge({ status }: { status: EditRequest["status"] }) {
  switch (status) {
    case "PENDING":
      return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    case "APPROVED":
      return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
    case "REJECTED":
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
    case "EXPIRED":
      return <Badge variant="outline" className="bg-muted text-muted-foreground border-border"><Timer className="w-3 h-3 mr-1" />Expired</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
};

const FILTERS = ["ALL", "PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const;
type Filter = (typeof FILTERS)[number];

export default function EditRequests() {
  const [requests, setRequests] = useState<EditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [search, setSearch] = useState("");

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

  const filtered = search.trim()
    ? requests.filter((r) =>
        `${r.teacherName} ${gradeLabel(r.gradeLevel)} ${r.section ?? ""} ${r.subject ?? ""} ${termLabel(r.term)} ${r.schoolYear}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      )
    : requests;

  const pagination = usePagination({ totalRows: filtered.length });

  const columns: TableColumn<EditRequest>[] = [
    {
      key: "teacher",
      header: "Teacher",
      skeleton: "name",
      cell: (req) => (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-foreground">{req.teacherName}</span>
          <StatusBadge status={req.status} />
        </div>
      ),
    },
    {
      key: "class",
      header: "Class",
      skeleton: "name",
      cell: (req) => (
        <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <GraduationCap className="w-3.5 h-3.5" />
            {gradeLabel(req.gradeLevel)}
          </span>
          {req.section && (
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" />
              {req.section}
            </span>
          )}
          {req.subject && (
            <span className="flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5" />
              {req.subject}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "term",
      header: "Term",
      skeleton: "badge",
      cell: (req) => (
        <span className="text-sm text-foreground">
          {termLabel(req.term)} · {req.schoolYear}
        </span>
      ),
    },
    {
      key: "submitted",
      header: "Submitted",
      skeleton: "date",
      cell: (req) => (
        <span className="text-xs text-muted-foreground">
          {new Date(req.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "expires",
      header: "Expires",
      skeleton: "date",
      cell: (req) =>
        req.expiresAt ? (
          <span className="text-xs text-muted-foreground">{new Date(req.expiresAt).toLocaleString()}</span>
        ) : (
          <Dash />
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "text-right",
      cell: (req) => (
        <div className="flex items-center justify-end gap-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {req.status === "PENDING" && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => { setRejectReq(req); setRejectOpen(true); }}
              >
                <XCircle className="w-4 h-4 mr-1" />
                Reject
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs font-semibold"
                onClick={() => { setApproveReq(req); setApproveOpen(true); }}
              >
                <CheckCircle className="w-4 h-4 mr-1" />
                Approve
              </Button>
            </>
          )}
          {req.status === "APPROVED" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => { setRevokeReq(req); setRevokeOpen(true); }}
            >
              <Ban className="w-4 h-4 mr-1" />
              Revoke
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Grade Edit Requests"
        description="Review and manage teacher requests to edit past-term grades"
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList variant="line" className="w-full justify-start gap-1 border-b border-border pb-0">
          {FILTERS.map((f) => (
            <TabsTrigger key={f} value={f} className="px-4 text-xs font-semibold uppercase tracking-wider">
              {f}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        title="Edit Requests"
        description={`${filtered.length} request${filtered.length !== 1 ? "s" : ""} found`}
        emptyTitle={`No ${filter.toLowerCase()} requests`}
        emptySearchTerm={search}
        rowKey={(req) => req.id}
        onRowClick={openDetail}
        pagination={pagination}
        toolbar={<SearchInput value={search} onChange={setSearch} placeholder="Search requests..." />}
      />

      {/* Detail Modal */}
      <AppModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        size="lg"
        icon={<FileText className="w-6 h-6" />}
        title="Edit Request Ticket"
        description={`Submitted ${detailReq ? new Date(detailReq.createdAt).toLocaleString() : ""}`}
        hideFooter
      >
        {detailReq && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="bg-muted text-foreground px-4 py-2 flex items-center justify-between text-xs font-medium border-b border-border">
                <span>GRADE EDIT REQUEST</span>
                <span className="text-muted-foreground">
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
                    <p className="text-foreground font-medium">{detailReq.section || <Dash />}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Subject</span>
                    <p className="text-foreground font-medium">{detailReq.subject || <Dash />}</p>
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

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t border-border">
              {detailReq.status === "PENDING" && (
                <>
                  <Button
                    variant="outline"
                    className="rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => { setRejectReq(detailReq); setRejectOpen(true); }}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Reject
                  </Button>
                  <Button
                    className="rounded-xl"
                    onClick={() => { setApproveReq(detailReq); setApproveOpen(true); }}
                  >
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Approve
                  </Button>
                </>
              )}
              {detailReq.status === "APPROVED" && (
                <Button
                  variant="outline"
                  className="rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => { setRevokeReq(detailReq); setRevokeOpen(true); }}
                >
                  <Ban className="w-4 h-4 mr-1" />
                  Revoke Access
                </Button>
              )}
              {detailReq.status !== "PENDING" && detailReq.status !== "APPROVED" && (
                <Button variant="outline" className="rounded-xl" onClick={() => setDetailOpen(false)}>Close</Button>
              )}
            </div>
          </div>
        )}
      </AppModal>

      <ApproveModal open={approveOpen} onOpenChange={setApproveOpen} request={approveReq} onApproved={handleSuccess} />
      <RejectModal open={rejectOpen} onOpenChange={setRejectOpen} request={rejectReq} onRejected={handleSuccess} />
      <RevokeModal open={revokeOpen} onOpenChange={setRevokeOpen} request={revokeReq} onRevoked={handleSuccess} />
    </div>
  );
}
