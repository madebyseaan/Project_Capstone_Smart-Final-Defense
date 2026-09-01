import { Search, ChevronDown, ChevronRight, Loader2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";

interface EOSYLearnerRecordsTabProps {
  records: any[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  expandedStudentLrn: string | null;
  expandedGrades: Record<string, { subjects: any[]; average: number | null; totalSubjects: number; gradedSubjects: number }>;
  expandedGradesLoading: Record<string, boolean>;
  onToggleStudentGrades: (student: any) => void;
}

const STATUS_LABELS: Record<string, string> = {
  PROMOTED: "Promoted",
  CONDITIONALLY_PROMOTED: "Conditionally Promoted",
  RETAINED: "Retained",
  JHS_COMPLETER: "JHS Completer",
};

const GRADE_LABELS: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

function getStatusBadgeClass(status: string | null) {
  if (!status) return "bg-gray-100 text-gray-500 border-gray-200";
  switch (status) {
    case "PROMOTED":
    case "JHS_COMPLETER":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "CONDITIONALLY_PROMOTED":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "RETAINED":
      return "bg-red-100 text-red-700 border-red-200";
    default:
      return "bg-gray-100 text-gray-500 border-gray-200";
  }
}

function getGradeColor(grade: number | null) {
  if (grade === null) return "text-gray-400";
  if (grade >= 90) return "text-emerald-700 font-semibold";
  if (grade >= 75) return "text-gray-900 font-medium";
  return "text-red-600 font-semibold";
}

export default function EOSYLearnerRecordsTab({
  records,
  searchTerm,
  onSearchChange,
  expandedStudentLrn,
  expandedGrades,
  expandedGradesLoading,
  onToggleStudentGrades,
}: EOSYLearnerRecordsTabProps) {
  const filtered = records.filter((r) =>
    `${r.firstName} ${r.lastName} ${r.lrn}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const promotedCount = records.filter(
    (r) => r.smart?.decision?.promotionStatus === "PROMOTED" || r.promoted || r.finalStatus === "PROMOTED"
  ).length;
  const heldCount = records.filter((r) => {
    const s = r.smart?.decision?.promotionStatus;
    return s === "RETAINED" || s === "CONDITIONALLY_PROMOTED";
  }).length;

  const renderExpandedGrades = (lrn: string) => {
    if (expandedGradesLoading[lrn]) {
      return (
        <TableRow>
          <TableCell colSpan={6} className="bg-slate-50/80 py-6">
            <div className="flex items-center justify-center gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading grades...</span>
            </div>
          </TableCell>
        </TableRow>
      );
    }

    const data = expandedGrades[lrn];
    if (!data || data.subjects.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={6} className="bg-slate-50/80 py-6 text-center text-sm text-gray-400">
            No grade data available
          </TableCell>
        </TableRow>
      );
    }

    return (
      <TableRow>
        <TableCell colSpan={6} className="p-0 bg-slate-50/60">
          <div className="px-6 py-4">
            {/* Summary */}
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">Average:</span>
                <span className="text-sm font-bold text-gray-900">
                  {data.average != null ? data.average : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">Graded:</span>
                <span className="text-sm font-medium text-gray-700">
                  {data.gradedSubjects}/{data.totalSubjects}
                </span>
              </div>
              <Badge
                className={
                  data.average != null && data.average >= 75
                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                    : "bg-red-100 text-red-700 border-red-200"
                }
              >
                {data.average != null ? (data.average >= 75 ? "PASSED" : "FAILED") : "No Grade"}
              </Badge>
            </div>

            {/* Grades Table */}
            <div className="border rounded-lg overflow-hidden bg-white">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/80 hover:bg-gray-50/80">
                    <TableHead className="font-bold text-gray-700 text-xs">Subject</TableHead>
                    <TableHead className="font-bold text-gray-700 text-xs text-center w-20">T1</TableHead>
                    <TableHead className="font-bold text-gray-700 text-xs text-center w-20">T2</TableHead>
                    <TableHead className="font-bold text-gray-700 text-xs text-center w-20">T3</TableHead>
                    <TableHead className="font-bold text-gray-700 text-xs text-center w-20">Final</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.subjects.map((sub: any, idx: number) => {
                    const grades = [sub.T1, sub.T2, sub.T3].filter((g): g is number => g !== null);
                    const finalGrade = grades.length > 0 ? Math.round(grades.reduce((s, g) => s + g, 0) / grades.length) : null;
                    return (
                      <TableRow key={idx} className="hover:bg-slate-50/50">
                        <TableCell className="text-sm font-medium text-gray-900 py-2">{sub.subjectName}</TableCell>
                        <TableCell className={`text-center text-sm py-2 ${getGradeColor(sub.T1)}`}>
                          {sub.T1 ?? "—"}
                        </TableCell>
                        <TableCell className={`text-center text-sm py-2 ${getGradeColor(sub.T2)}`}>
                          {sub.T2 ?? "—"}
                        </TableCell>
                        <TableCell className={`text-center text-sm py-2 ${getGradeColor(sub.T3)}`}>
                          {sub.T3 ?? "—"}
                        </TableCell>
                        <TableCell className={`text-center text-sm py-2 ${getGradeColor(finalGrade)}`}>
                          {finalGrade ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search learners..."
              className="pl-9 rounded-xl border-slate-200 bg-white shadow-sm"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <span className="text-sm text-gray-500 whitespace-nowrap">
            {filtered.length} of {records.length}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>{promotedCount} Promoted</span>
          </div>
          {heldCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 text-red-700 border border-red-100">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span>{heldCount} Held</span>
            </div>
          )}
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50/80 hover:bg-gray-50/80">
              <TableHead className="font-bold text-gray-700 w-10" />
              <TableHead className="font-bold text-gray-700 w-12 pl-2">#</TableHead>
              <TableHead className="font-bold text-gray-700">Learner Name</TableHead>
              <TableHead className="font-bold text-gray-700 text-right">Average</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">Status</TableHead>
              <TableHead className="font-bold text-gray-700">Promoted To</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-16 text-gray-500">
                  {searchTerm ? "No learners match your search" : "No EOSY records for this section"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((rec: any, i: number) => {
                const computedStatus = rec.smart?.decision?.promotionStatus ?? null;
                const computedAverage = rec.smart?.decision?.generalAverage ?? rec.finalAverage;
                const promotedTo = rec.smart?.decision?.promotedToGradeLevel
                  ? GRADE_LABELS[rec.smart.decision.promotedToGradeLevel] ?? "—"
                  : rec.promotedToGradeLevel?.name ?? rec.nextGradeLevel?.name ?? "—";
                const isExpanded = expandedStudentLrn === rec.lrn;

                return (
                  <>
                    <TableRow
                      key={rec.enrollmentRecordId ?? rec.learnerId ?? i}
                      className={`hover:bg-slate-50/50 transition-colors cursor-pointer ${isExpanded ? "bg-blue-50/30" : ""}`}
                      onClick={() => onToggleStudentGrades(rec)}
                    >
                      <TableCell className="w-10 pl-2">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-blue-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                      </TableCell>
                      <TableCell className="text-gray-400 text-sm pl-2">{i + 1}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">
                            {rec.lastName}, {rec.firstName} {rec.middleName ?? ""}
                          </p>
                          {rec.lrn && (
                            <Tooltip content={`LRN: ${rec.lrn}`}>
                              <p className="text-[11px] text-gray-400 font-mono mt-0.5 cursor-help">
                                {rec.lrn}
                              </p>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-semibold text-gray-900 text-sm">
                          {computedAverage != null ? Number(computedAverage).toFixed(2) : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {computedStatus ? (
                          <Badge className={getStatusBadgeClass(computedStatus)}>
                            {STATUS_LABELS[computedStatus] ?? computedStatus}
                          </Badge>
                        ) : rec.promoted ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                            Promoted
                          </Badge>
                        ) : rec.finalStatus ? (
                          <Badge className="bg-red-100 text-red-700 border-red-200">
                            {rec.finalStatus}
                          </Badge>
                        ) : (
                          <span className="text-gray-400 text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">{promotedTo}</TableCell>
                    </TableRow>
                    {isExpanded && renderExpandedGrades(rec.lrn)}
                  </>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="w-8 h-8 text-slate-200 mb-2" />
            <p className="text-gray-500 text-sm">
              {searchTerm ? "No learners match your search" : "No records"}
            </p>
          </div>
        ) : (
          filtered.map((rec: any, i: number) => {
            const computedStatus = rec.smart?.decision?.promotionStatus ?? null;
            const computedAverage = rec.smart?.decision?.generalAverage ?? rec.finalAverage;
            const isExpanded = expandedStudentLrn === rec.lrn;
            const gradesData = expandedGrades[rec.lrn];
            const isLoading = expandedGradesLoading[rec.lrn];

            return (
              <div key={rec.enrollmentRecordId ?? rec.learnerId ?? i}>
                <div
                  className={`bg-white border rounded-xl p-4 shadow-sm transition-all cursor-pointer ${
                    isExpanded ? "border-blue-200 shadow-md" : "border-gray-100 hover:shadow-md"
                  }`}
                  onClick={() => onToggleStudentGrades(rec)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                        isExpanded ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"
                      }`}>
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : i + 1}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">
                          {rec.lastName}, {rec.firstName}
                        </p>
                        <p className="text-[11px] text-gray-400 font-mono">{rec.lrn}</p>
                      </div>
                    </div>
                    {computedStatus ? (
                      <Badge className={getStatusBadgeClass(computedStatus)}>
                        {STATUS_LABELS[computedStatus] ?? computedStatus}
                      </Badge>
                    ) : rec.promoted ? (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Promoted</Badge>
                    ) : (
                      <Badge className="bg-gray-100 text-gray-500 border-gray-200" variant="outline">—</Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase">Average</p>
                        <p className="text-sm font-bold text-gray-900">
                          {computedAverage != null ? Number(computedAverage).toFixed(1) : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase">To</p>
                        <p className="text-sm font-medium text-gray-700">
                          {rec.smart?.decision?.promotedToGradeLevel
                            ? GRADE_LABELS[rec.smart.decision.promotedToGradeLevel] ?? "—"
                            : rec.promotedToGradeLevel?.name ?? "—"}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90 text-blue-500" : "text-gray-400"}`} />
                  </div>
                </div>

                {/* Expanded grades (mobile) */}
                {isExpanded && (
                  <div className="mt-1 bg-slate-50 border border-blue-100 rounded-xl p-4">
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2 py-4 text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading grades...</span>
                      </div>
                    ) : gradesData && gradesData.subjects.length > 0 ? (
                      <>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xs font-medium text-gray-500">Avg:</span>
                          <span className="text-sm font-bold text-gray-900">
                            {gradesData.average != null ? gradesData.average : "—"}
                          </span>
                          <Badge
                            className={
                              gradesData.average != null && gradesData.average >= 75
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                : "bg-red-100 text-red-700 border-red-200"
                            }
                          >
                            {gradesData.average != null ? (gradesData.average >= 75 ? "PASSED" : "FAILED") : "—"}
                          </Badge>
                        </div>
                        <div className="space-y-1.5">
                          {gradesData.subjects.map((sub: any, idx: number) => {
                            const grades = [sub.T1, sub.T2, sub.T3].filter((g): g is number => g !== null);
                            const finalGrade = grades.length > 0 ? Math.round(grades.reduce((s, g) => s + g, 0) / grades.length) : null;
                            return (
                              <div key={idx} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                                <span className="text-xs font-medium text-gray-700 truncate flex-1 mr-2">{sub.subjectName}</span>
                                <div className="flex items-center gap-3 text-xs">
                                  <span className={`w-8 text-center ${getGradeColor(sub.T1)}`}>{sub.T1 ?? "—"}</span>
                                  <span className={`w-8 text-center ${getGradeColor(sub.T2)}`}>{sub.T2 ?? "—"}</span>
                                  <span className={`w-8 text-center ${getGradeColor(sub.T3)}`}>{sub.T3 ?? "—"}</span>
                                  <span className={`w-8 text-center font-bold ${getGradeColor(finalGrade)}`}>{finalGrade ?? "—"}</span>
                                </div>
                              </div>
                            );
                          })}
                          <div className="flex justify-end gap-3 text-[10px] font-medium text-gray-400 pt-1">
                            <span className="w-8 text-center">T1</span>
                            <span className="w-8 text-center">T2</span>
                            <span className="w-8 text-center">T3</span>
                            <span className="w-8 text-center">Avg</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-4">No grade data</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
