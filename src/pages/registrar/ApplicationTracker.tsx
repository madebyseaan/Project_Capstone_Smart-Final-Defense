import { useState, useEffect } from "react";
import { ClipboardList, Loader2, AlertTriangle, RefreshCw, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { registrarApi } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useTheme } from "@/contexts/ThemeContext";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  VERIFIED: "bg-blue-100 text-blue-700",
  ENROLLED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
};

const GRADE_LABELS: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  VERIFIED: "Verified",
  ENROLLED: "Enrolled",
  REJECTED: "Rejected",
};

export default function ApplicationTracker() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const load = async (p = 1, l = limit, s = search, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    console.log("[ApplicationTracker] calling getApplications with params:", {
      status: statusFilter !== "all" ? statusFilter : undefined,
      gradeLevel: gradeFilter !== "all" ? gradeFilter : undefined,
      page: p,
      limit: l,
      search: s.trim() || undefined,
    });
    try {
      const res = await registrarApi.getApplications({
        status: statusFilter !== "all" ? statusFilter : undefined,
        gradeLevel: gradeFilter !== "all" ? gradeFilter : undefined,
        page: p,
        limit: l,
        search: s.trim() || undefined,
      });
      const payload = res.data as any;
      console.log("[ApplicationTracker] payload received:", payload);
      const apps = payload.applications ?? payload.data ?? payload.items ?? [];
      setApplications(apps);
      
      // The backend now returns a normalized meta object, but we handle fallbacks just in case
      setMeta(payload.meta ?? payload.pagination ?? {
        total: payload.total ?? apps.length,
        page: p,
        limit: l,
        totalPages: payload.totalPages ?? Math.ceil((payload.total ?? apps.length) / l)
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load applications from EnrollPro.");
      setApplications([]);
      setMeta(null);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Single effect: reset to page 1 when filters change, then load
  useEffect(() => {
    setPage(1);
    const timer = setTimeout(() => {
      void load(1, limit, search);
    }, search ? 500 : 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, gradeFilter, limit, search]);

  // Separate effect: reload when page changes (but not when filters change)
  useEffect(() => {
    void load(page, limit, search);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Keep client-side filter as a secondary "instant" filter for the current page
  const filtered = search
    ? applications.filter((a) => {
        const name = `${a.learner?.firstName ?? a.firstName ?? ""} ${a.learner?.lastName ?? a.lastName ?? ""}`.toLowerCase();
        const lrn = String(a.learner?.lrn ?? a.lrn ?? "");
        return name.includes(search.toLowerCase()) || lrn.includes(search);
      })
    : applications;

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Dashboard", href: "/registrar" }, { label: "Applications" }]} />

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Enrollment Applications</h1>
          <p className="text-gray-600 mt-1">
            Enrollment application tracker — read from EnrollPro. Verification actions must be done in EnrollPro directly.
          </p>
        </div>
        <Button onClick={() => void load(page, limit)} variant="outline" className="rounded-xl">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      <Card className="border border-slate-200">
        <CardHeader className="border-b border-slate-100 pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-xl text-white" style={{ backgroundColor: colors.primary }}>
                <ClipboardList className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>Applications</CardTitle>
                <CardDescription>{meta?.total ?? filtered.length} total</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search by name or LRN..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-56 rounded-xl border-gray-200"
                />
              </div>
              <Select value={gradeFilter} onValueChange={setGradeFilter}>
                <SelectTrigger className="w-40 rounded-xl border-gray-200">
                  <SelectValue placeholder="All Grades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Grades</SelectItem>
                  <SelectItem value="GRADE_7">Grade 7</SelectItem>
                  <SelectItem value="GRADE_8">Grade 8</SelectItem>
                  <SelectItem value="GRADE_9">Grade 9</SelectItem>
                  <SelectItem value="GRADE_10">Grade 10</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40 rounded-xl border-gray-200">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="VERIFIED">Verified</SelectItem>
                  <SelectItem value="ENROLLED">Enrolled</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
              <p className="text-gray-700 font-medium">Unable to load applications</p>
              <p className="text-gray-500 text-sm mt-1">{error}</p>
              <Button onClick={() => void load(page, limit)} variant="outline" className="mt-4 rounded-xl">
                Try Again
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/80">
                    <TableHead className="font-bold text-gray-700">Applicant</TableHead>
                    <TableHead className="font-bold text-gray-700">LRN</TableHead>
                    <TableHead className="font-bold text-gray-700">Grade Applied</TableHead>
                    <TableHead className="font-bold text-gray-700">Type</TableHead>
                    <TableHead className="font-bold text-gray-700">Status</TableHead>
                    <TableHead className="font-bold text-gray-700">Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-gray-500">
                        No applications found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((app, i) => {
                      const learner = app.learner ?? app;
                      const status = app.status ?? "PENDING";
                      return (
                        <TableRow key={app.id ?? i}>
                          <TableCell className="font-medium text-gray-900">
                            {learner.lastName}, {learner.firstName} {learner.middleName ?? ""}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-gray-600">{learner.lrn ?? "—"}</TableCell>
                          <TableCell>{app.gradeLevel?.name ?? app.gradeLevelName ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize text-xs">
                              {(app.applicantType ?? app.learnerType ?? "—").replace(/_/g, " ").toLowerCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}>
                              {status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {app.createdAt ? new Date(app.createdAt).toLocaleDateString("en-PH") : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {!loading && !error && meta && (
            <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50/30">
              <div className="flex items-center gap-4 text-sm font-semibold text-slate-800">
                <span>
                  Showing {meta.total === 0 ? 0 : (page - 1) * limit + 1} to {Math.min(page * limit, meta.total)} of {meta.total} Learners
                </span>
                <div className="h-4 w-px bg-slate-300 mx-2" />
                <div className="flex items-center gap-2">
                  <span>Rows per page:</span>
                  <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                    <SelectTrigger className="h-9 w-20 rounded-lg border-slate-200 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="250">250</SelectItem>
                      <SelectItem value="500">500</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400"
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <Button
                  variant="default"
                  size="sm"
                  className="h-9 w-9 rounded-lg bg-[#800000] hover:bg-[#600000] text-white font-bold shadow-sm"
                >
                  {page}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400"
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400"
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage(meta.totalPages)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
