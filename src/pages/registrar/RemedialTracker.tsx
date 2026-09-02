import { useState, useEffect, useCallback, Fragment } from "react";
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
  ChevronDown,
  ChevronUp,
  Save,
  CheckCircle2,
  Printer,
  AlertCircle,
  Calendar,
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

interface RemedialRecord {
  id: string;
  subjectCode: string;
  subjectName: string;
  originalGrade: number;
  remedialMark: number | null;
  recomputedGrade: number | null;
  outcome: string | null;
  status: string;
  conductedFrom: string | null;
  conductedTo: string | null;
}

interface RemedialStudent {
  enrollmentId: string;
  studentId: string;
  lrn: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  sex: string | null;
  gradeLevel: string;
  section: { name: string };
  schoolYear: string;
  promotionStatus: string;
  remedialClasses: RemedialRecord[];
}

export default function RemedialTracker() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<RemedialStudent[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Edit state for expanded row
  const [editMarks, setEditMarks] = useState<Record<string, number | "">>({});
  const [editDates, setEditDates] = useState<Record<string, { from: string; to: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const load = useCallback(async (p = 1, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await registrarApi.getRemedialPending({ page: p, limit: 500 });
      const payload = res.data as any;
      setItems(payload.items ?? []);
      setMeta(payload.meta ?? { total: 0, totalPages: 1 });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load remedial data.");
      setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [page, load]);

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
    pending: filtered.filter((i) =>
      i.remedialClasses.some((rc) => rc.status === "PENDING")
    ).length,
    completed: filtered.filter((i) =>
      i.remedialClasses.every((rc) => rc.status === "COMPLETED")
    ).length,
  };

  const toggleExpand = (enrollmentId: string) => {
    if (expandedId === enrollmentId) {
      setExpandedId(null);
      setEditMarks({});
      setEditDates({});
      return;
    }
    setExpandedId(enrollmentId);
    setEditMarks({});
    setEditDates({});
  };

  const handleMarkChange = (rcId: string, value: string) => {
    if (value === "") {
      setEditMarks((prev) => ({ ...prev, [rcId]: "" }));
      return;
    }
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setEditMarks((prev) => ({ ...prev, [rcId]: num }));
    }
  };

  const handleDateChange = (rcId: string, field: "from" | "to", value: string) => {
    setEditDates((prev) => ({
      ...prev,
      [rcId]: { ...(prev[rcId] ?? { from: "", to: "" }), [field]: value },
    }));
  };

  const saveRow = async (rcId: string) => {
    const mark = editMarks[rcId];
    if (mark === undefined || mark === "" || typeof mark !== "number") return;
    setSaving(rcId);
    try {
      const dates = editDates[rcId];
      await registrarApi.updateRemedialRow(rcId, {
        remedialMark: mark,
        ...(dates?.from ? { conductedFrom: dates.from } : {}),
        ...(dates?.to ? { conductedTo: dates.to } : {}),
      });
      await load(page, true);
      setEditMarks((prev) => {
        const next = { ...prev };
        delete next[rcId];
        return next;
      });
      setEditDates((prev) => {
        const next = { ...prev };
        delete next[rcId];
        return next;
      });
    } catch (err: any) {
      alert(err?.response?.data?.message ?? "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const handleComplete = async (enrollmentId: string) => {
    const student = items.find((i) => i.enrollmentId === enrollmentId);
    if (!student) return;

    const pendingRows = student.remedialClasses.filter((rc) => rc.status === "PENDING");
    const missingRcm = pendingRows.filter((rc) => rc.remedialMark === null);

    if (missingRcm.length > 0) {
      alert(`Missing RCM for: ${missingRcm.map((r) => r.subjectName).join(", ")}`);
      return;
    }

    const confirmed = window.confirm(
      `Complete remedial for ${student.lastName}, ${student.firstName}?\n\n` +
      `This will:\n` +
      `- Compute Recomputed Final Grades (RFG)\n` +
      `- Transition promotion status\n` +
      `- This action cannot be undone`
    );
    if (!confirmed) return;

    setCompleting(true);
    try {
      const res = await registrarApi.completeRemedial(enrollmentId);
      const result = res.data as any;
      alert(
        `Remedial completed!\n` +
        `Status: ${result.previousStatus} → ${result.newStatus}\n` +
        result.subjectOutcomes
          ?.map((o: any) => `${o.subjectName}: RFG=${o.recomputedGrade} (${o.outcome})`)
          .join("\n")
      );
      await load(page, true);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? "Failed to complete remedial");
    } finally {
      setCompleting(false);
    }
  };

  const computeRfg = (original: number, rcm: number) =>
    Math.round(((original + rcm) / 2) * 10) / 10;

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Remedial Tracker</h1>
          <p className="text-gray-600 mt-1">
            Manage remedial classes for conditionally promoted students.
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
          <p className="text-sm font-medium text-gray-600">Total Students</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
        </div>
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
          <p className="text-sm font-medium text-gray-600">Pending</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.pending}</p>
        </div>
        <div className="p-4 rounded-xl bg-green-50 border border-green-100">
          <p className="text-sm font-medium text-gray-600">Completed</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.completed}</p>
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
                  Remedial Students
                </CardTitle>
                <CardDescription className="text-gray-500 text-sm">
                  {filtered.length} student(s) found
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
                  </SelectContent>
                </Select>
              </div>
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
              <p className="text-gray-700 font-medium">Unable to load remedial data</p>
              <p className="text-gray-500 text-sm mt-1">{error}</p>
              <Button onClick={() => void load(page)} variant="outline" className="mt-4 rounded-xl">
                Try Again
              </Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-white border-b border-slate-100 hover:bg-white">
                      <TableHead className="w-8" />
                      <TableHead className="font-bold text-slate-800 py-4">LRN</TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">Learner Name</TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">Grade / Section</TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">Failed Subjects</TableHead>
                      <TableHead className="font-bold text-slate-800 py-4">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-20">
                          <BookOpen className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                          <p className="text-gray-500 font-medium">No remedial learners found</p>
                          <p className="text-gray-400 text-sm mt-1">Try adjusting your search</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginated.map((student) => {
                        const isExpanded = expandedId === student.enrollmentId;
                        const pendingCount = student.remedialClasses.filter((r) => r.status === "PENDING").length;
                        const completedCount = student.remedialClasses.filter((r) => r.status === "COMPLETED").length;

                        return (
                          <Fragment key={student.enrollmentId}>
                            <TableRow
                              key={student.enrollmentId}
                              className={`transition-colors border-b border-slate-50 hover:bg-slate-50/50 cursor-pointer ${isExpanded ? "bg-slate-50" : ""}`}
                              onClick={() => toggleExpand(student.enrollmentId)}
                            >
                              <TableCell className="w-8">
                                {isExpanded ? (
                                  <ChevronUp className="w-4 h-4 text-gray-500" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-gray-500" />
                                )}
                              </TableCell>
                              <TableCell className="font-mono text-sm text-slate-500 py-4">
                                {student.lrn ?? "--"}
                              </TableCell>
                              <TableCell className="py-4">
                                <div className="flex items-center gap-3">
                                  <div
                                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-semibold text-sm shadow-sm"
                                    style={{ backgroundColor: colors.primary }}
                                  >
                                    {(student.lastName ?? "?").charAt(0)}
                                  </div>
                                  <div>
                                    <p className="font-bold text-slate-900">
                                      {student.lastName}, {student.firstName}{" "}
                                      {student.middleName ?? ""}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {student.section?.name} &middot; SY {student.schoolYear}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="font-medium text-slate-600 py-4">
                                {student.gradeLevel?.replace("GRADE_", "Grade ")} / {student.section?.name}
                              </TableCell>
                              <TableCell className="py-4">
                                <div className="flex flex-wrap gap-1">
                                  {student.remedialClasses.map((rc) => (
                                    <Badge
                                      key={rc.id}
                                      variant="outline"
                                      className={
                                        rc.status === "COMPLETED"
                                          ? rc.outcome === "PASSED"
                                            ? "bg-green-50 text-green-700 border-green-200"
                                            : "bg-red-50 text-red-700 border-red-200"
                                          : "bg-amber-50 text-amber-700 border-amber-200"
                                      }
                                    >
                                      {rc.subjectName}
                                    </Badge>
                                  ))}
                                </div>
                              </TableCell>
                              <TableCell className="py-4">
                                <Badge
                                  className={
                                    pendingCount > 0
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : "bg-green-50 text-green-700 border-green-200"
                                  }
                                  variant="outline"
                                >
                                  {pendingCount > 0 ? `${pendingCount} pending` : "All completed"}
                                </Badge>
                              </TableCell>
                            </TableRow>

                            {/* Expanded Panel */}
                            {isExpanded && (
                              <TableRow key={`${student.enrollmentId}-detail`}>
                                <TableCell colSpan={6} className="p-0 bg-slate-50/50">
                                  <div className="p-6 space-y-4">
                                    {/* Conducted Dates */}
                                    <div className="flex items-center gap-4 text-sm text-gray-600">
                                      <Calendar className="w-4 h-4" />
                                      <span className="font-medium">Conducted from:</span>
                                      <input
                                        type="date"
                                        className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                                        defaultValue={student.remedialClasses[0]?.conductedFrom?.split("T")[0] ?? ""}
                                        onChange={(e) => {
                                          student.remedialClasses.forEach((rc) => {
                                            handleDateChange(rc.id, "from", e.target.value);
                                          });
                                        }}
                                      />
                                      <span className="font-medium">to:</span>
                                      <input
                                        type="date"
                                        className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                                        defaultValue={student.remedialClasses[0]?.conductedTo?.split("T")[0] ?? ""}
                                        onChange={(e) => {
                                          student.remedialClasses.forEach((rc) => {
                                            handleDateChange(rc.id, "to", e.target.value);
                                          });
                                        }}
                                      />
                                    </div>

                                    {/* Subjects Table */}
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="bg-gray-50 border-b border-gray-200">
                                            <th className="text-left px-4 py-3 font-bold text-gray-700">Learning Area</th>
                                            <th className="text-center px-4 py-3 font-bold text-gray-700">Final Rating</th>
                                            <th className="text-center px-4 py-3 font-bold text-gray-700">RCM</th>
                                            <th className="text-center px-4 py-3 font-bold text-gray-700">RFG</th>
                                            <th className="text-center px-4 py-3 font-bold text-gray-700">Outcome</th>
                                            <th className="text-center px-4 py-3 font-bold text-gray-700">Action</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {student.remedialClasses.map((rc) => {
                                            const currentMark = editMarks[rc.id] ?? rc.remedialMark ?? "";
                                            const rfg =
                                              typeof currentMark === "number"
                                                ? computeRfg(rc.originalGrade, currentMark)
                                                : null;
                                            const isEditing = rc.id in editMarks || rc.id in editDates;
                                            const isSavingThis = saving === rc.id;

                                            return (
                                              <tr key={rc.id} className="border-b border-gray-100 last:border-0">
                                                <td className="px-4 py-3 font-medium text-gray-900">{rc.subjectName}</td>
                                                <td className="px-4 py-3 text-center text-gray-700 font-semibold">
                                                  {rc.originalGrade}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                  {rc.status === "COMPLETED" ? (
                                                    <span className="font-semibold text-gray-900">
                                                      {rc.remedialMark}
                                                    </span>
                                                  ) : (
                                                    <Input
                                                      type="number"
                                                      min={60}
                                                      max={100}
                                                      step={0.1}
                                                      className="w-20 text-center mx-auto"
                                                      placeholder="--"
                                                      value={editMarks[rc.id] ?? ""}
                                                      onChange={(e) => handleMarkChange(rc.id, e.target.value)}
                                                    />
                                                  )}
                                                </td>
                                                <td className="px-4 py-3 text-center font-bold text-gray-900">
                                                  {rfg !== null ? rfg.toFixed(1) : rc.recomputedGrade?.toFixed(1) ?? "--"}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                  {rc.status === "COMPLETED" ? (
                                                    <Badge
                                                      className={
                                                        rc.outcome === "PASSED"
                                                          ? "bg-green-50 text-green-700 border-green-200"
                                                          : "bg-red-50 text-red-700 border-red-200"
                                                      }
                                                      variant="outline"
                                                    >
                                                      {rc.outcome === "PASSED" ? "Passed" : "Failed"}
                                                    </Badge>
                                                  ) : rfg !== null ? (
                                                    <Badge
                                                      className={
                                                        rfg >= 75
                                                          ? "bg-green-50 text-green-700 border-green-200"
                                                          : "bg-red-50 text-red-700 border-red-200"
                                                      }
                                                      variant="outline"
                                                    >
                                                      {rfg >= 75 ? "Passed" : "Failed"}
                                                    </Badge>
                                                  ) : (
                                                    <span className="text-gray-400">--</span>
                                                  )}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                  {rc.status === "PENDING" && (isEditing || editMarks[rc.id] !== undefined) && (
                                                    <Button
                                                      size="sm"
                                                      variant="outline"
                                                      className="rounded-lg"
                                                      disabled={isSavingThis || editMarks[rc.id] === undefined || editMarks[rc.id] === ""}
                                                      onClick={() => saveRow(rc.id)}
                                                    >
                                                      {isSavingThis ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                      ) : (
                                                        <Save className="w-3 h-3 mr-1" />
                                                      )}
                                                      Save
                                                    </Button>
                                                  )}
                                                  {rc.status === "COMPLETED" && (
                                                    <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                                                  )}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-3 pt-2">
                                      {pendingCount > 0 && (
                                        <Button
                                          className="rounded-xl"
                                          style={{ backgroundColor: colors.primary }}
                                          disabled={completing}
                                          onClick={() => handleComplete(student.enrollmentId)}
                                        >
                                          {completing ? (
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                          ) : (
                                            <CheckCircle2 className="w-4 h-4 mr-2" />
                                          )}
                                          Complete Remedial
                                        </Button>
                                      )}
                                      {completedCount > 0 && pendingCount === 0 && (
                                        <Button
                                          variant="outline"
                                          className="rounded-xl"
                                          onClick={() => {
                                            window.print();
                                          }}
                                        >
                                          <Printer className="w-4 h-4 mr-2" />
                                          Print Certificate
                                        </Button>
                                      )}
                                      {completedCount === 0 && pendingCount === 0 && (
                                        <p className="text-sm text-gray-500 italic">
                                          No remedial records for this student.
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50/30">
                <div className="flex items-center gap-4 text-sm font-semibold text-slate-800">
                  <span>
                    Showing{" "}
                    {filtered.length === 0 ? 0 : (page - 1) * limit + 1}{" "}
                    to {Math.min(page * limit, filtered.length)} of {filtered.length} Students
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
