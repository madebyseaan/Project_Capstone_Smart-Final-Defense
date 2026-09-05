import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

interface StudentWithEnrollment {
  id: string;
  enrollmentId?: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender?: string;
  gradeLevel?: string;
  sectionName?: string;
  status?: string;
  transferInDate?: string | null;
}

const gradeLevelLabels: Record<string, string> = {
  "7": "Grade 7",
  "8": "Grade 8",
  "9": "Grade 9",
  "10": "Grade 10",
  "GRADE_7": "Grade 7",
  "GRADE_8": "Grade 8",
  "GRADE_9": "Grade 9",
  "GRADE_10": "Grade 10",
};

interface StudentRecordsTableProps {
  students: StudentWithEnrollment[];
  loading: boolean;
  searchQuery: string;
  hasActiveFilters: boolean;
  onViewStudent: (student: StudentWithEnrollment) => void;
  primaryColor: string;
}

export function StudentRecordsTable({
  students,
  loading,
  searchQuery,
  hasActiveFilters,
  onViewStudent,
  primaryColor,
}: StudentRecordsTableProps) {
  const isEmpty = students.length === 0;
  const isFilteredEmpty = isEmpty && hasActiveFilters;

  return (
    <div className="overflow-x-auto">
      <Table className="w-full table-fixed">
        <TableHeader>
           <TableRow className="hover:bg-muted/50 border-b border-border/30 bg-muted">
             <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%] text-left">
               LRN
             </TableHead>
             <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[29%] text-left">
               Student Name
             </TableHead>
             <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[10%] text-left">
               Gender
             </TableHead>
             <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[12%] text-left">
               Grade Level
             </TableHead>
             <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%] text-left">
               Section
             </TableHead>
             <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[13%] text-left">
               Status
             </TableHead>
              <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[10%] text-left">
                Actions
              </TableHead>
           </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <LoadingSkeleton
              columnCount={7}
              rowCount={8}
              skeletonHints={["number", "avatar", "badge", "badge", "name", "badge", "number"]}
            />
          ) : isEmpty ? (
            <EmptyState
              columnCount={7}
              title={isFilteredEmpty ? undefined : "No students found"}
              searchTerm={isFilteredEmpty ? searchQuery : undefined}
              hint={
                isFilteredEmpty
                  ? "Try adjusting your search or filter criteria."
                  : "No students have been enrolled yet. Check the selected school year or sync enrollment data."
              }
            />
          ) : (
            students.map((student) => {
              const normalizedGrade = (student.gradeLevel || "").replace("GRADE_", "");
              const genderUpper = (student.gender || "").toUpperCase();
              const isMale = genderUpper === "MALE" || genderUpper === "M";

              return (
                <TableRow
                  key={student.id}
                  className="border-b border-border/20 hover:bg-muted/50 transition-colors"
                >
                  <TableCell className="py-3.5 px-4 font-mono text-[13px] text-muted-foreground tabular-nums text-left align-middle whitespace-nowrap">
                    {student.lrn || <Dash />}
                  </TableCell>
                  <TableCell className="py-3.5 px-4 text-left align-middle">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs shrink-0"
                        style={{ backgroundColor: primaryColor }}
                        aria-hidden="true"
                      >
                        {(student.lastName || "?").charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate">
                          {student.lastName}, {student.firstName}{" "}
                          {student.middleName || ""} {student.suffix || ""}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3.5 px-4 text-left align-middle">
                    {student.gender ? (
                      <Badge
                        variant="outline"
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
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
                  <TableCell className="py-3.5 px-4 text-left align-middle">
                    {student.gradeLevel ? (
                      <Badge
                        variant="outline"
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                        style={{
                          backgroundColor: `${primaryColor}10`,
                          color: primaryColor,
                          borderColor: `${primaryColor}25`,
                        }}
                      >
                        {gradeLevelLabels[student.gradeLevel] ||
                          `Grade ${normalizedGrade}`}
                      </Badge>
                    ) : (
                      <Dash />
                    )}
                  </TableCell>
                  <TableCell className="py-3.5 px-4 text-sm text-muted-foreground text-left align-middle whitespace-nowrap">
                    {student.sectionName || <Dash />}
                  </TableCell>
                  <TableCell className="py-3.5 px-4 text-left align-middle">
                    <div className="flex items-center gap-1.5 flex-nowrap whitespace-nowrap">
                      {student.status ? (
                        <Badge
                          variant="outline"
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                            student.status === "ENROLLED"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : student.status === "TRANSFERRED"
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {student.status}
                        </Badge>
                      ) : (
                        <Dash />
                      )}
                      {student.transferInDate && (
                        <Badge
                          variant="outline"
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border-violet-200"
                          title={`Transferred in on ${new Date(student.transferInDate).toLocaleDateString()}`}
                        >
                          T/I
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3.5 px-4 text-left align-middle">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewStudent(student)}
                      className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap -ml-2.5"
                    >
                      <Eye className="w-3.5 h-3.5 mr-1.5" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
