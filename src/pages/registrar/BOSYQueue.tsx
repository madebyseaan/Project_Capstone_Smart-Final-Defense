import { useState, useEffect } from "react";
import { CalendarCheck, Loader2, AlertTriangle, RefreshCw, Users, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
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

type QueueTab = "pending" | "expected";

export default function BOSYQueue() {
  const { colors } = useTheme();
  const [tab, setTab] = useState<QueueTab>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const load = async (p = 1, l = limit, s = search, g = gradeFilter, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      let res: any;
      const params = { 
        page: p, 
        limit: l, 
        search: s.trim() || undefined,
        gradeLevel: g !== "all" ? g : undefined
      };
      if (tab === "pending") {
        res = await registrarApi.getBosyQueue(params);
      } else {
        res = await registrarApi.getBosyExpectedQueue(params);
      }
      const payload = res.data as any;
      const rawItems: any[] = payload.items ?? payload.learners ?? payload.data ?? [];

      // Normalize: map the actual flat OR nested API field names from EnrollPro BOSY queue
      const normalized = rawItems.map((item: any) => {
        const l = item.learner ?? item;
        const rawSex = (l.sex ?? item.sex ?? "").toString().trim().toUpperCase();
        const sex = rawSex === "MALE" || rawSex === "M" ? "Male" : rawSex === "FEMALE" || rawSex === "F" ? "Female" : "";
        
        // Helper to extract nested names robustly
        const getName = (obj: any, flatKey: string) => {
          if (typeof obj === "string") return obj;
          if (obj && typeof obj === "object" && obj.name) return obj.name;
          return item[flatKey] ?? "";
        };

        return {
          enrollmentRecordId: item.applicationId ?? item.enrollmentRecordId ?? item.id,
          learnerId: l.id ?? item.learnerId,
          lrn: l.lrn ?? item.lrn ?? "",
          firstName: l.firstName ?? item.firstName ?? "",
          lastName: l.lastName ?? item.lastName ?? "",
          middleName: l.middleName ?? item.middleName ?? "",
          sex,
          status: item.status,
          // BOSY queue can use flat or nested field names depending on EnrollPro version/endpoint
          gradeLevelName: getName(item.priorGradeLevel ?? item.gradeLevel, "gradeLevelName"),
          priorSectionName: getName(item.priorSection ?? item.section, "priorSectionName"),
          priorAdviserName: getName(item.priorAdviser ?? item.adviser, "priorAdviserName"),
          finalAverage: item.finalAverage ?? item.previousGenAve ?? item.priorFinalAverage ?? null,
        };
      });

      setItems(normalized);
      setMeta(payload.meta ?? payload.pagination ?? { 
        total: payload.total ?? normalized.length, 
        page: p, 
        limit: l,
        totalPages: payload.totalPages ?? Math.ceil((payload.total ?? normalized.length) / l) 
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load BOSY data from EnrollPro.");
      setItems([]);
      setMeta(null);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [tab, limit, search, gradeFilter]);

  // Load data when page or other dependencies change
  useEffect(() => {
    const timer = setTimeout(() => {
      void load(page, limit, search, gradeFilter);
    }, search ? 500 : 0); // Debounce search
    return () => clearTimeout(timer);
  }, [page, tab, limit, search, gradeFilter]);

  // Keep client-side filter as a secondary "instant" filter for the current page
  const filtered = search
    ? items.filter((item) => {
        const name = `${item.firstName} ${item.lastName}`.toLowerCase();
        const lrn = String(item.lrn);
        return name.includes(search.toLowerCase()) || lrn.includes(search);
      })
    : items;

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Dashboard", href: "/registrar" }, { label: "BOSY Queue" }]} />

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">BOSY Queue</h1>
          <p className="text-gray-600 mt-1">
            Beginning of School Year — learner return confirmation tracking. Read-only from EnrollPro.
          </p>
        </div>
        <Button onClick={() => void load(page, limit, search)} variant="outline" className="rounded-xl">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2">
        <Button
          variant={tab === "pending" ? "default" : "outline"}
          onClick={() => setTab("pending")}
          className="rounded-xl shadow-sm"
          style={tab === "pending" ? { backgroundColor: colors.primary } : {}}
        >
          Pending Confirmation
        </Button>
        <Button
          variant={tab === "expected" ? "default" : "outline"}
          onClick={() => setTab("expected")}
          className="rounded-xl shadow-sm"
          style={tab === "expected" ? { backgroundColor: colors.primary } : {}}
        >
          Expected (Not Yet in Pipeline)
        </Button>
      </div>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-xl text-white shadow-sm" style={{ backgroundColor: colors.primary }}>
                <CalendarCheck className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>{tab === "pending" ? "Pending Confirmation Queue" : "Expected Return Queue"}</CardTitle>
                <CardDescription>{meta?.total ?? filtered.length} Learners Found</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search by name or LRN..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-64 rounded-xl border-gray-200"
                />
              </div>
              <Select value={gradeFilter} onValueChange={setGradeFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Grades">
                    {gradeFilter === "all" ? "All Grades" : gradeFilter.replace("GRADE_", "Grade ")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Grades</SelectItem>
                  <SelectItem value="GRADE_7">Grade 7</SelectItem>
                  <SelectItem value="GRADE_8">Grade 8</SelectItem>
                  <SelectItem value="GRADE_9">Grade 9</SelectItem>
                  <SelectItem value="GRADE_10">Grade 10</SelectItem>
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
              <p className="text-gray-700 font-medium">Unable to load BOSY data</p>
              <p className="text-gray-500 text-sm mt-1">{error}</p>
              <Button onClick={() => void load(page, limit, search)} variant="outline" className="mt-4 rounded-xl">Try Again</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/80">
                    <TableHead className="font-bold text-gray-700">LRN</TableHead>
                    <TableHead className="font-bold text-gray-700">Learner Name</TableHead>
                    <TableHead className="font-bold text-gray-700">Sex</TableHead>
                    <TableHead className="font-bold text-gray-700">Prior Grade</TableHead>
                    <TableHead className="font-bold text-gray-700">Prior Section</TableHead>
                    {tab === "expected" && (
                      <TableHead className="font-bold text-gray-700">Final Avg</TableHead>
                    )}
                    {tab === "pending" && (
                      <TableHead className="font-bold text-gray-700">Status</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={tab === "expected" ? 6 : 6} className="text-center py-12">
                        <Users className="w-10 h-10 mx-auto text-gray-300 mb-2" />
                        <p className="text-gray-500">No learners found matching your criteria</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((item, i) => (
                      <TableRow key={item.enrollmentRecordId ?? item.learnerId ?? i} className="hover:bg-slate-50/50">
                        <TableCell className="font-mono text-sm text-gray-600">{item.lrn ?? "—"}</TableCell>
                        <TableCell className="font-medium text-gray-900">
                          {item.lastName}, {item.firstName} {item.middleName ?? ""}
                        </TableCell>
                        <TableCell>
                          {item.sex
                            ? <Badge className={item.sex === "Male" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}>{item.sex}</Badge>
                            : <span className="text-gray-400">N/A</span>}
                        </TableCell>
                        <TableCell>{item.gradeLevelName || "—"}</TableCell>
                        <TableCell>{item.priorSectionName || "—"}</TableCell>
                        {tab === "expected" && (
                          <TableCell className="font-semibold text-slate-700">
                            {item.finalAverage != null ? item.finalAverage.toFixed(1) : "—"}
                          </TableCell>
                        )}
                        {tab === "pending" && (
                          <TableCell>
                            <Badge className="bg-amber-100 text-amber-700">
                              {item.status ?? "PENDING"}
                            </Badge>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination Footer */}
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
                    <SelectTrigger className="w-20" size="sm">
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
                  className="h-9 min-w-[36px] px-2 rounded-lg font-bold shadow-sm"
                  style={{ backgroundColor: colors.primary }}
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

