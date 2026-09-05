import {
  Users,
  Printer,
  ChevronRight,
  MoreVertical,
  FileText,
  FolderOpen,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  onViewSF9: (studentId: string) => void;
  onViewSF10: (studentId: string) => void;
  onBulkPrint: (formType: "sf9" | "sf10") => void;
  onBulkPrintAll: (formType: "sf9" | "sf10") => void;
  themeColors: { primary: string };
  isLoading?: boolean;
}

export function StudentSelectionTable({
  filteredStudents,
  selectedStudentIds,
  searchQuery,
  onSearchChange,
  onToggleAll,
  onToggleStudent,
  onViewSF9,
  onViewSF10,
  onBulkPrint,
  onBulkPrintAll,
  themeColors,
  isLoading = false,
}: StudentSelectionTableProps) {
  const columnCount = 5;

  return (
    <Card className="border border-border shadow-sm bg-card overflow-hidden rounded-xl p-0">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                Students
                <span className="text-sm font-normal text-muted-foreground">
                  ({filteredStudents.length})
                </span>
              </h2>
              {selectedStudentIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedStudentIds.length} selected
                </p>
              )}
            </div>
            {selectedStudentIds.length > 0 && (
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{
                  backgroundColor: `${themeColors.primary}10`,
                  color: themeColors.primary,
                  border: `1px solid ${themeColors.primary}25`,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: themeColors.primary }} />
                {selectedStudentIds.length} selected
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {selectedStudentIds.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="sm"
                      className="rounded-lg h-9 text-white gap-1.5"
                      style={{ backgroundColor: themeColors.primary }}
                    />
                  }
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print&nbsp;Selected
                  <ChevronRight className="w-3.5 h-3.5 rotate-90 opacity-70" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => onBulkPrint("sf9")}>
                    <FileText className="w-4 h-4 mr-2" />
                    SF9 — Report Cards
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onBulkPrint("sf10")}>
                    <FolderOpen className="w-4 h-4 mr-2" />
                    SF10 — Permanent Records
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg h-9 gap-1.5"
                  />
                }
              >
                <Printer className="w-3.5 h-3.5" />
                Print All
                <ChevronRight className="w-3.5 h-3.5 rotate-90 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => onBulkPrintAll("sf9")}>
                  <FileText className="w-4 h-4 mr-2" />
                  SF9 — Report Cards
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onBulkPrintAll("sf10")}>
                  <FolderOpen className="w-4 h-4 mr-2" />
                  SF10 — Permanent Records
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="relative w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search students…"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-8 h-9 rounded-lg text-xs"
              />
            </div>
          </div>
        </div>
      </div>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="w-full">
            <TableHeader>
              <TableRow className="hover:bg-muted/50 border-b border-border bg-muted">
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-10">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border cursor-pointer"
                    checked={
                      selectedStudentIds.length === filteredStudents.length &&
                      filteredStudents.length > 0
                    }
                    onChange={onToggleAll}
                    title="Select all"
                  />
                </TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[18%]">LRN</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4">Name</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%]">Gender</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[10%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <LoadingSkeleton
                  columnCount={columnCount}
                  rowCount={8}
                />
              ) : filteredStudents.length === 0 ? (
                <EmptyState
                  columnCount={columnCount}
                  searchTerm={searchQuery}
                />
              ) : (
                filteredStudents.map((student) => {
                  const isSelected = selectedStudentIds.includes(student.id);
                  const genderUpper = (student.gender ?? "").toUpperCase();
                  const isMale = genderUpper === "MALE" || genderUpper === "M";
                  return (
                    <TableRow
                      key={student.id}
                      className={`border-b border-border cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-muted/50 hover:bg-muted"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => onToggleStudent(student.id)}
                    >
                      <TableCell
                        className="py-3.5 px-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-border cursor-pointer"
                          checked={isSelected}
                          onChange={() => onToggleStudent(student.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-[13px] text-muted-foreground py-3.5 px-4 tabular-nums">
                        {student.lrn || <Dash />}
                      </TableCell>
                      <TableCell className="py-3.5 px-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs shrink-0"
                            style={{ backgroundColor: themeColors.primary }}
                            aria-hidden="true"
                          >
                            {(student.lastName || "?").charAt(0)}
                          </div>
                          <span className="font-semibold text-foreground text-sm">
                            {student.lastName}, {student.firstName}{" "}
                            {student.middleName || ""} {student.suffix || ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3.5 px-4">
                        {student.gender ? (
                          <Badge
                            variant="outline"
                            className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                              isMale
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-pink-50 text-pink-700 border-pink-200"
                            }`}
                          >
                            {student.gender}
                          </Badge>
                        ) : (
                          <Dash />
                        )}
                      </TableCell>
                      <TableCell className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
                              />
                            }
                          >
                            <MoreVertical className="w-4 h-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={() => onViewSF9(student.id)}
                              className="gap-2"
                            >
                              <FileText className="w-4 h-4 text-blue-500" />
                              <span>View SF9</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onViewSF10(student.id)}
                              className="gap-2"
                            >
                              <FolderOpen className="w-4 h-4 text-emerald-500" />
                              <span>View SF10</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
  );
}
