import { memo } from "react";
import { ChevronDown, ChevronUp, CheckCircle2, Loader2, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dash } from "@/components/data-table";

export interface RemedialRecord {
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

export interface RemedialStudent {
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

interface StudentRowProps {
  student: RemedialStudent;
  isExpanded: boolean;
  primaryColor: string;
  onExpand: (enrollmentId: string) => void;
}

export const RemedialStudentRow = memo(function RemedialStudentRow({
  student,
  isExpanded,
  primaryColor,
  onExpand,
}: StudentRowProps) {
  const pendingCount = student.remedialClasses.filter((r) => r.status === "PENDING").length;

  return (
    <TableRow
      className={`border-b border-border hover:bg-muted/50 transition-colors cursor-pointer ${isExpanded ? "bg-muted" : ""}`}
      onClick={() => onExpand(student.enrollmentId)}
    >
      <TableCell className="py-3.5 px-4 text-left align-middle">
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </TableCell>
      <TableCell className="font-mono text-[13px] text-muted-foreground py-3.5 px-4 tabular-nums text-left align-middle whitespace-nowrap">
        {student.lrn ?? <Dash />}
      </TableCell>
      <TableCell className="py-3.5 px-4 text-left align-middle">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs shrink-0"
            style={{ backgroundColor: primaryColor }}
            aria-hidden="true"
          >
            {(student.lastName ?? "?").charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground text-sm truncate">
              {student.lastName}, {student.firstName}{" "}
              {student.middleName ?? ""}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              SY {student.schoolYear}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground py-3.5 px-4 text-left align-middle whitespace-nowrap">
        {student.gradeLevel?.replace("GRADE_", "Grade ")} &middot; {student.section?.name}
      </TableCell>
      <TableCell className="py-3.5 px-4 text-left align-middle">
        <div className="flex flex-wrap gap-1">
          {student.remedialClasses.map((rc) => (
            <Badge
              key={rc.id}
              variant="outline"
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                rc.status === "COMPLETED"
                  ? rc.outcome === "PASSED"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-rose-50 text-rose-700 border-rose-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {rc.subjectName}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="py-3.5 px-4 text-left align-middle">
        <Badge
          variant="outline"
          className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap ${
            pendingCount > 0
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200"
          }`}
        >
          {pendingCount > 0 ? `${pendingCount} pending` : "All completed"}
        </Badge>
      </TableCell>
    </TableRow>
  );
});

interface ExpandedPanelProps {
  student: RemedialStudent;
  editMarks: Record<string, number | "">;
  saving: boolean;
  primaryColor: string;
  onMarkChange: (rcId: string, value: string) => void;
  computeRfg: (original: number, rcm: number) => number;
  validate: (student: RemedialStudent) => { ok: boolean; reason?: string };
  onOpenConfirm: (student: RemedialStudent) => void;
}

export const RemedialExpandedPanel = memo(function RemedialExpandedPanel({
  student,
  editMarks,
  saving,
  primaryColor,
  onMarkChange,
  computeRfg,
  validate,
  onOpenConfirm,
}: ExpandedPanelProps) {
  const pendingCount = student.remedialClasses.filter((r) => r.status === "PENDING").length;
  const completedCount = student.remedialClasses.filter((r) => r.status === "COMPLETED").length;
  const validation = validate(student);

  return (
    <TableRow>
      <TableCell colSpan={6} className="p-0 bg-muted/50">
        <div className="p-6 space-y-4 border-b border-border">
          {/* Subjects Table */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-muted/50 border-b border-border bg-muted">
                  <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4">Learning Area</TableHead>
                  <TableHead className="text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 w-[10%]">Final Rating</TableHead>
                  <TableHead className="text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 w-[10%]">RCM</TableHead>
                  <TableHead className="text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 w-[10%]">RFG</TableHead>
                  <TableHead className="text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 w-[12%]">Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {student.remedialClasses.map((rc) => {
                  const currentMark = editMarks[rc.id] ?? rc.remedialMark ?? "";
                  const rfg =
                    typeof currentMark === "number"
                      ? computeRfg(rc.originalGrade, currentMark)
                      : null;

                  return (
                    <TableRow key={rc.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <TableCell className="font-semibold text-foreground py-3 px-4">{rc.subjectName}</TableCell>
                      <TableCell className="text-center font-semibold text-foreground py-3 px-4 tabular-nums">
                        {rc.originalGrade}
                      </TableCell>
                      <TableCell className="text-center py-3 px-4">
                        {rc.status === "COMPLETED" ? (
                          <span className="font-semibold text-foreground tabular-nums">
                            {rc.remedialMark}
                          </span>
                        ) : (
                          <Input
                            type="number"
                            min={60}
                            max={100}
                            step={0.1}
                            className="w-20 text-center mx-auto h-8 rounded-md text-xs"
                            placeholder="--"
                            value={editMarks[rc.id] ?? rc.remedialMark ?? ""}
                            onChange={(e) => onMarkChange(rc.id, e.target.value)}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-center font-bold text-foreground py-3 px-4 tabular-nums">
                        {rfg !== null ? rfg.toFixed(1) : rc.recomputedGrade?.toFixed(1) ?? <Dash />}
                      </TableCell>
                      <TableCell className="text-center py-3 px-4">
                        {rc.status === "COMPLETED" ? (
                          <Badge
                            className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                              rc.outcome === "PASSED"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`}
                            variant="outline"
                          >
                            {rc.outcome === "PASSED" ? "Passed" : "Failed"}
                          </Badge>
                        ) : rfg !== null ? (
                          <Badge
                            className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                              rfg >= 75
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`}
                            variant="outline"
                          >
                            {rfg >= 75 ? "Passed" : "Failed"}
                          </Badge>
                        ) : (
                          <Dash />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-1">
            {pendingCount > 0 && (
              <Button
                className="rounded-lg"
                style={{ backgroundColor: primaryColor, color: "white" }}
                disabled={saving || !validation.ok}
                title={validation.ok ? "" : validation.reason}
                onClick={() => onOpenConfirm(student)}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                Save & Complete
              </Button>
            )}
            {completedCount > 0 && pendingCount === 0 && (
              <Button
                variant="outline"
                className="rounded-lg"
                onClick={() => {
                  window.print();
                }}
              >
                <Printer className="w-4 h-4 mr-2" />
                Print Certificate
              </Button>
            )}
            {completedCount === 0 && pendingCount === 0 && (
              <p className="text-sm text-muted-foreground italic">
                No remedial records for this student.
              </p>
            )}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
});
