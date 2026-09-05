import { Search, ChevronDown, ChevronRight, Loader2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  if (!status) return "bg-muted text-muted-foreground border-border";
  switch (status) {
    case "PROMOTED":
    case "JHS_COMPLETER":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "CONDITIONALLY_PROMOTED":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "RETAINED":
      return "bg-red-100 text-red-700 border-red-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function getGradeColor(grade: number | null) {
  if (grade === null) return "text-muted-foreground";
  if (grade >= 90) return "text-emerald-700 font-semibold";
  if (grade >= 75) return "text-foreground font-medium";
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
          <TableCell colSpan={6} className="bg-muted/50 py-6">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
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
          <TableCell colSpan={6} className="bg-muted/50 py-6 text-center text-sm text-muted-foreground">
            No grade data available
          </TableCell>
        </TableRow>
      );
    }

    return (
      <TableRow>
        <TableCell colSpan={6} className="p-0 bg-muted/50">
          <div className="px-6 py-4">
            {/* Summary */}
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Average:</span>
                <span className="text-sm font-bold text-foreground">
                  {data.average != null ? data.average : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Graded:</span>
                <span className="text-sm font-medium text-foreground">
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
            <div className="border rounded-lg overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="font-bold text-foreground text-xs">Subject</TableHead>
                    <TableHead className="font-bold text-foreground text-xs text-center w-20">T1</TableHead>
                    <TableHead className="font-bold text-foreground text-xs text-center w-20">T2</TableHead>
                    <TableHead className="font-bold text-foreground text-xs text-center w-20">T3</TableHead>
                    <TableHead className="font-bold text-foreground text-xs text-center w-20">Final</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.subjects.map((sub: any, idx: number) => {
                    const grades = [sub.T1, sub.T2, sub.T3].filter((g): g is number => g !== null);
                    const finalGrade = grades.length > 0 ? Math.round(grades.reduce((s, g) => s + g, 0) / grades.length) : null;
                    return (
                      <TableRow key={idx} className="hover:bg-muted/50">
                        <TableCell className="text-sm font-medium text-foreground py-2">{sub.subjectName}</TableCell>
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search learners..."
              className="pl-8 h-9 w-56 rounded-lg text-xs"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {filtered.length} of {records.length}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>{promotedCount} Promoted</span>
          </div>
          {heldCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              <span>{heldCount} Held</span>
            </div>
          )}
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-muted/50 border-b border-border bg-muted/50">
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-10" />
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-12">#</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4">Learner Name</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[12%] text-right">Average</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[16%] text-center">Status</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[18%]">Promoted To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
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
                        className={`border-b border-border hover:bg-muted/50 transition-colors cursor-pointer ${isExpanded ? "bg-muted/50" : ""}`}
                        onClick={() => onToggleStudentGrades(rec)}
                      >
                        <TableCell className="py-3.5 px-4">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm py-3.5 px-4 tabular-nums">{i + 1}</TableCell>
                        <TableCell className="py-3.5 px-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-primary-foreground font-semibold text-xs shrink-0"
                              style={{ backgroundColor: "var(--primary, #6366f1)" }}
                              aria-hidden="true"
                            >
                              {(rec.lastName || "?").charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground text-sm truncate">
                                {rec.lastName}, {rec.firstName} {rec.middleName ?? ""}
                              </p>
                              {rec.lrn && (
                                <p className="text-[11px] text-muted-foreground font-mono tabular-nums">{rec.lrn}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right py-3.5 px-4">
                          <span className="font-semibold text-foreground text-sm tabular-nums">
                            {computedAverage != null ? Number(computedAverage).toFixed(2) : "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-center py-3.5 px-4">
                          {computedStatus ? (
                            <Badge className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${getStatusBadgeClass(computedStatus)}`}>
                              {STATUS_LABELS[computedStatus] ?? computedStatus}
                            </Badge>
                          ) : rec.promoted ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px] font-medium px-2.5 py-0.5 rounded-full">
                              Promoted
                            </Badge>
                          ) : rec.finalStatus ? (
                            <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-[11px] font-medium px-2.5 py-0.5 rounded-full">
                              {rec.finalStatus}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground py-3.5 px-4">{promotedTo}</TableCell>
                      </TableRow>
                      {isExpanded && renderExpandedGrades(rec.lrn)}
                    </>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-muted-foreground text-sm">
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
                  className={`bg-card border rounded-xl p-4 shadow-sm transition-all cursor-pointer ${
                    isExpanded ? "border-primary/30 shadow-md" : "border-border hover:shadow-md"
                  }`}
                  onClick={() => onToggleStudentGrades(rec)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                        isExpanded ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"
                      }`}>
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : i + 1}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-sm">
                          {rec.lastName}, {rec.firstName}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">{rec.lrn}</p>
                      </div>
                    </div>
                    {computedStatus ? (
                      <Badge className={getStatusBadgeClass(computedStatus)}>
                        {STATUS_LABELS[computedStatus] ?? computedStatus}
                      </Badge>
                    ) : rec.promoted ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Promoted</Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground border-border" variant="outline">—</Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Average</p>
                        <p className="text-sm font-bold text-foreground tabular-nums">
                          {computedAverage != null ? Number(computedAverage).toFixed(1) : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">To</p>
                        <p className="text-sm font-medium text-foreground">
                          {rec.smart?.decision?.promotedToGradeLevel
                            ? GRADE_LABELS[rec.smart.decision.promotedToGradeLevel] ?? "—"
                            : rec.promotedToGradeLevel?.name ?? "—"}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90 text-muted-foreground" : "text-muted-foreground"}`} />
                  </div>
                </div>

                {/* Expanded grades (mobile) */}
                {isExpanded && (
                  <div className="mt-1 bg-muted/50 border border-border rounded-xl p-4">
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading grades...</span>
                      </div>
                    ) : gradesData && gradesData.subjects.length > 0 ? (
                      <>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xs font-medium text-muted-foreground">Avg:</span>
                          <span className="text-sm font-bold text-foreground tabular-nums">
                            {gradesData.average != null ? gradesData.average : "—"}
                          </span>
                          <Badge
                            className={
                              gradesData.average != null && gradesData.average >= 75
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
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
                              <div key={idx} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                                <span className="text-xs font-medium text-foreground truncate flex-1 mr-2">{sub.subjectName}</span>
                                <div className="flex items-center gap-3 text-xs">
                                  <span className={`w-8 text-center ${getGradeColor(sub.T1)}`}>{sub.T1 ?? "—"}</span>
                                  <span className={`w-8 text-center ${getGradeColor(sub.T2)}`}>{sub.T2 ?? "—"}</span>
                                  <span className={`w-8 text-center ${getGradeColor(sub.T3)}`}>{sub.T3 ?? "—"}</span>
                                  <span className={`w-8 text-center font-bold ${getGradeColor(finalGrade)}`}>{finalGrade ?? "—"}</span>
                                </div>
                              </div>
                            );
                          })}
                          <div className="flex justify-end gap-3 text-[10px] font-medium text-muted-foreground pt-1">
                            <span className="w-8 text-center">T1</span>
                            <span className="w-8 text-center">T2</span>
                            <span className="w-8 text-center">T3</span>
                            <span className="w-8 text-center">Avg</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">No grade data</p>
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
