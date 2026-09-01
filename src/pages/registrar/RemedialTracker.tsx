import { useState, useEffect } from "react";
import {
  FlaskConical,
  Loader2,
  AlertTriangle,
  RefreshCw,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  Command,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { registrarApi } from "@/lib/api";

import { useTheme } from "@/contexts/ThemeContext";

export default function RemedialTracker() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const load = async (p = 1, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await registrarApi.getRemedialPending({ page: p, limit: 500 });
      const payload = res.data as any;
      setItems(payload.items ?? payload.data ?? payload.learners ?? []);
      setMeta(payload.meta ?? { total: payload.total ?? 0, totalPages: Math.ceil((payload.total ?? 0) / 20) });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load remedial data from EnrollPro.");
      setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load(page);
  }, [page]);

  const filtered = search
    ? items.filter((item) => {
        const name = `${item.lastName ?? ""} ${item.firstName ?? ""}`.toLowerCase();
        const lrn = String(item.lrn ?? "");
        return name.includes(search.toLowerCase()) || lrn.includes(search);
      })
    : items;

  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  const stats = {
    total: filtered.length,
    male: filtered.filter((i: any) => (i.sex || "").toUpperCase() === "MALE").length,
    female: filtered.filter((i: any) => (i.sex || "").toUpperCase() === "FEMALE").length,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Remedial Tracker</h1>
          <p className="text-gray-600 mt-1">
            Learners enrolled in remedial classes — read-only view from EnrollPro.
          </p>
        </div>
        <Button
          onClick={() => void load(page)}
          variant="outline"
          className="rounded-xl"
        >
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
          <p className="text-sm font-medium text-gray-600">Total Learners</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
        </div>
        <div className="p-4 rounded-xl bg-sky-50 border border-sky-100">
          <p className="text-sm font-medium text-gray-600">Male</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.male}</p>
        </div>
        <div className="p-4 rounded-xl bg-pink-50 border border-pink-100">
          <p className="text-sm font-medium text-gray-600">Female</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.female}</p>
        </div>
      </div>

      {/* Main Table Card */}
      <Card className="border-0 shadow-xl shadow-gray-200/50 bg-white overflow-hidden rounded-2xl p-0">
        <CardHeader
          className="border-b border-gray-100 px-6 py-5"
          style={{ backgroundColor: `${colors.primary}08` }}
        >
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="p-2.5 rounded-xl text-white shadow-lg"
                style={{ backgroundColor: colors.primary }}
              >
                <FlaskConical className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-gray-900">
                  Remedial Pending List
                </CardTitle>
                <CardDescription className="text-gray-500 text-sm">
                  {filtered.length} learner(s) found
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search students..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9 pr-16 w-64 rounded-xl border-gray-200"
                />
                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-100 rounded border border-gray-200">
                  <Command className="w-3 h-3" />K
                </kbd>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 font-medium">Rows:</span>
                <Select
                  value={String(limit)}
                  onValueChange={(v) => {
                    setLimit(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-20" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="15">15</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2
                className="w-8 h-8 animate-spin"
                style={{ color: colors.primary }}
              />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
              <p className="text-gray-700 font-medium">Unable to load remedial data</p>
              <p className="text-gray-500 text-sm mt-1">{error}</p>
              <Button
                onClick={() => void load(page)}
                variant="outline"
                className="mt-4 rounded-xl"
              >
                Try Again
              </Button>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="overflow-x-auto hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-white border-b border-slate-100 hover:bg-white">
                      <TableHead className="font-bold text-slate-800 py-4">
                        LRN
                      </TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">
                        Learner Name
                      </TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">
                        Sex
                      </TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">
                        Grade / Section
                      </TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">
                        Subject(s)
                      </TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">
                        Failing Grade
                      </TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">
                        Status
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-20">
                          <BookOpen className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                          <p className="text-gray-500 font-medium">
                            No remedial learners found
                          </p>
                          <p className="text-gray-400 text-sm mt-1">
                            Try adjusting your search
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginated.map((item: any, i: number) => (
                        <TableRow
                          key={item.enrollmentRecordId ?? item.learnerId ?? i}
                          className="transition-colors border-b border-slate-50 hover:bg-slate-50/50"
                        >
                          <TableCell className="font-mono text-sm text-slate-500 py-4">
                            {item.lrn ?? "--"}
                          </TableCell>
                          <TableCell className="py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-semibold text-sm shadow-sm"
                                style={{ backgroundColor: colors.primary }}
                              >
                                {(item.lastName ?? "?").charAt(0)}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900">
                                  {item.lastName}, {item.firstName}{" "}
                                  {item.middleName ?? ""}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <Badge
                              className={
                                item.sex === "MALE"
                                  ? "bg-blue-50 text-blue-700 border-blue-100"
                                  : "bg-pink-50 text-pink-700 border-pink-100"
                              }
                              variant="outline"
                            >
                              {item.sex ?? "--"}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium text-slate-600 py-4">
                            {item.gradeLevel?.name ?? "--"} /{" "}
                            {item.section?.name ?? "--"}
                          </TableCell>
                          <TableCell className="py-4 font-medium text-slate-600">
                            {Array.isArray(item.subjects)
                              ? item.subjects
                                  .map((s: any) => s.name ?? s)
                                  .join(", ")
                              : item.subjectName ?? "--"}
                          </TableCell>
                          <TableCell className="py-4 font-bold text-slate-900">
                            {item.failingGrade ?? item.grade ?? "--"}
                          </TableCell>
                          <TableCell className="py-4">
                            <Badge className="bg-amber-50 text-amber-700 border-amber-100" variant="outline">
                              {item.status ?? "PENDING"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card View */}
              <div className="block md:hidden p-4 space-y-3">
                {paginated.length === 0 ? (
                  <div className="text-center py-12">
                    <BookOpen className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500 font-medium">
                      No remedial learners found
                    </p>
                  </div>
                ) : (
                  paginated.map((item: any, i: number) => (
                    <div
                      key={item.enrollmentRecordId ?? item.learnerId ?? i}
                      className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-semibold"
                            style={{ backgroundColor: colors.primary }}
                          >
                            {(item.lastName ?? "?").charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">
                              {item.lastName}, {item.firstName}{" "}
                              {item.middleName ?? ""}
                            </p>
                            <p className="text-xs text-gray-500 font-mono">
                              {item.lrn ?? "--"}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          className={
                            item.sex === "MALE"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-pink-100 text-pink-700"
                          }
                        >
                          {item.sex ?? "--"}
                        </Badge>
                        <Badge variant="outline" className="text-gray-600">
                          {item.gradeLevel?.name ?? "--"} /{" "}
                          {item.section?.name ?? "--"}
                        </Badge>
                        <Badge className="bg-amber-100 text-amber-700">
                          {item.status ?? "PENDING"}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Pagination */}
              <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50/30">
                <div className="flex items-center gap-4 text-sm font-semibold text-slate-800">
                  <span>
                    Showing{" "}
                    {filtered.length === 0
                      ? 0
                      : (page - 1) * limit + 1}{" "}
                    to {Math.min(page * limit, filtered.length)} of{" "}
                    {filtered.length} Learners
                  </span>
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
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400"
                    disabled={page >= totalPages}
                    onClick={() => setPage(totalPages)}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
