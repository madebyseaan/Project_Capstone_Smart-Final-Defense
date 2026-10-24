import { useEffect, useRef } from "react";
import { Eye, Printer, Search, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadingSkeleton, EmptyState } from "@/components/data-table";
import { Dash } from "@/components/data-table/Dash";

interface FormStudent {
  id: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender?: string;
}

interface StudentSelectionTableProps {
  filteredStudents: FormStudent[];
  selectedStudentIds: string[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onToggleAll: () => void;
  onToggleStudent: (id: string) => void;
  onClearSelection: () => void;
  studentForm: "sf9" | "sf10";
  sf9Term?: "T1" | "T2" | "T3";
  onPreview: (studentId: string) => void;
  onBulkPrint: (formType: "sf9" | "sf10") => void;
  onBulkPrintAll: (formType: "sf9" | "sf10") => void;
  totalStudents: number;
  isLoading?: boolean;
}

const FORM_LABELS = {
  sf9: { code: "SF9", name: "SF9 Report Card" },
  sf10: { code: "SF10", name: "SF10 Permanent Record" },
} as const;

export function StudentSelectionTable({
  filteredStudents,
  selectedStudentIds,
  searchQuery,
  onSearchChange,
  onToggleAll,
  onToggleStudent,
  onClearSelection,
  studentForm,
  sf9Term,
  onPreview,
  onBulkPrint,
  onBulkPrintAll,
  totalStudents,
  isLoading = false,
}: StudentSelectionTableProps) {
  const columnCount = 5;
  const form = FORM_LABELS[studentForm];
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const allSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every((student) => selectedStudentIds.includes(student.id));
  const someSelected =
    !allSelected &&
    filteredStudents.some((student) => selectedStudentIds.includes(student.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  return (
    <>
      <Card className="border-border p-0">
        <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <div className="text-sm font-semibold text-foreground">Students</div>
            <span className="text-xs text-muted-foreground">
              ({filteredStudents.length}
              {searchQuery ? ` of ${totalStudents}` : ""})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search
                className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                placeholder="Search students..."
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                aria-label="Search students"
                className="h-8 rounded-lg pl-8 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onBulkPrintAll(studentForm)}
              disabled={totalStudents === 0}
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              Print all {form.code}
            </Button>
          </div>
        </div>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="w-full">
              <TableHeader>
                <TableRow className="border-b border-border bg-muted hover:bg-muted">
                  <TableHead className="w-10 px-3 py-2">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={onToggleAll}
                      aria-label="Select all students"
                      className="h-4 w-4 shrink-0 cursor-pointer rounded border border-input bg-transparent accent-primary outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  </TableHead>
                  <TableHead className="hidden w-[18%] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                    LRN
                  </TableHead>
                  <TableHead className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="hidden w-[14%] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                    Gender
                  </TableHead>
                  <TableHead className="w-[112px] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <LoadingSkeleton columnCount={columnCount} rowCount={8} />
                ) : filteredStudents.length === 0 ? (
                  <EmptyState
                    columnCount={columnCount}
                    searchTerm={searchQuery}
                    title="No students found"
                    hint="This section has no enrolled learners for the selected school year."
                  />
                ) : (
                  filteredStudents.map((student) => {
                    const isSelected = selectedStudentIds.includes(student.id);
                    return (
                      <TableRow
                        key={student.id}
                        className={`cursor-pointer border-b border-border transition-colors ${
                          isSelected ? "bg-muted/60 hover:bg-muted" : "hover:bg-muted/40"
                        }`}
                        onClick={() => onToggleStudent(student.id)}
                      >
                        <TableCell
                          className="px-3 py-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            checked={isSelected}
                            onChange={() => onToggleStudent(student.id)}
                            aria-label={`Select ${student.lastName}, ${student.firstName}`}
                          />
                        </TableCell>
                        <TableCell className="hidden px-3 py-2 font-mono text-[13px] tabular-nums text-muted-foreground sm:table-cell">
                          {student.lrn || <Dash />}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
                              aria-hidden="true"
                            >
                              {(student.lastName || "?").charAt(0)}
                            </div>
                            <span className="truncate text-sm font-semibold text-foreground">
                              {student.lastName}, {student.firstName}{" "}
                              {student.middleName || ""} {student.suffix || ""}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-3 py-2 sm:table-cell">
                          {student.gender ? (
                            <Badge variant="outline" className="text-[11px] font-medium">
                              {student.gender}
                            </Badge>
                          ) : (
                            <Dash />
                          )}
                        </TableCell>
                        <TableCell
                          className="px-3 py-2 text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => onPreview(student.id)}
                            aria-label={`Preview ${form.code} for ${student.lastName}, ${student.firstName}`}
                            title={
                              studentForm === "sf9" && sf9Term
                                ? `Preview ${form.code} · Term ${sf9Term.replace("T", "")}`
                                : `Preview ${form.code}`
                            }
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            Preview
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedStudentIds.length > 0 && (
        <div
          className="fixed bottom-4 left-1/2 z-40 w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 print-hide lg:left-[calc(50%+140px)]"
          role="region"
          aria-label="Bulk print actions"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur">
            <p className="px-1 text-sm font-semibold text-foreground">
              {selectedStudentIds.length} selected
            </p>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={() => onBulkPrint(studentForm)}
                disabled={selectedStudentIds.length === 0}
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                Print {form.code} ({selectedStudentIds.length})
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={onClearSelection}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
