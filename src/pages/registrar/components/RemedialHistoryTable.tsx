import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LoadingSkeleton, EmptyState, Dash } from "@/components/data-table";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react";

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

interface Props {
  items: RemedialStudent[];
  loading: boolean;
  page: number;
  limit: number;
  meta: { total: number; totalPages: number };
  historyYearFilter: string;
  setPage: (p: number) => void;
}

export function RemedialHistoryTable({ items, loading, page, limit, meta, historyYearFilter, setPage }: Props) {
  return (
    <Card className="border border-border shadow-sm bg-card overflow-hidden rounded-xl p-0">
      <div className="px-6 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-foreground">Remedial History</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} student{items.length !== 1 ? "s" : ""} &middot; {historyYearFilter === "all" ? "All Years" : `SY ${historyYearFilter}`}
          </p>
        </div>
      </div>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="w-full">
            <TableHeader>
              <TableRow className="hover:bg-muted/50 border-b border-border bg-muted">
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%]">LRN</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[28%]">Learner Name</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[16%]">Grade / Section</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[22%]">Subjects</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[10%]">Status</TableHead>
                <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[10%]">Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <LoadingSkeleton columnCount={6} rowCount={5} />
              ) : items.length === 0 ? (
                <EmptyState columnCount={6} title="No remedial history" hint="No records found for this school year" />
              ) : (
                items.map((student) => {
                  const allCompleted = student.remedialClasses.every((rc) => rc.status === "COMPLETED");
                  const allPassed = student.remedialClasses.every((rc) => rc.outcome === "PASSED");
                  return (
                    <TableRow key={student.enrollmentId} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <TableCell className="font-mono text-[13px] text-muted-foreground py-3.5 px-4 tabular-nums">{student.lrn ?? <Dash />}</TableCell>
                      <TableCell className="py-3.5 px-4 text-sm font-medium text-foreground">
                        {student.lastName}, {student.firstName} {student.middleName ?? ""}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground py-3.5 px-4">
                        {student.gradeLevel?.replace("GRADE_", "Grade ")} &middot; {student.section?.name}
                      </TableCell>
                      <TableCell className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1">
                          {student.remedialClasses.map((rc) => (
                            <Badge
                              key={rc.id}
                              variant="outline"
                              className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                                rc.status === "COMPLETED"
                                  ? rc.outcome === "PASSED"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-rose-50 text-rose-700 border-rose-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}
                            >
                              {rc.subjectName} {rc.recomputedGrade != null ? `(${rc.recomputedGrade})` : ""}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="py-3.5 px-4">
                        <Badge variant="outline" className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                          allCompleted ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}>
                          {allCompleted ? "Completed" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3.5 px-4">
                        {allCompleted ? (
                          <Badge variant="outline" className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                            allPassed ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"
                          }`}>
                            {allPassed ? "Promoted" : "Retained"}
                          </Badge>
                        ) : <Dash />}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {items.length > 0 && (
          <div className="border-t border-border px-6 py-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, items.length)} of{" "}
              <span className="font-medium text-foreground">{items.length}</span> students
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(1)}>
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="default" size="sm" className="h-8 w-8 text-xs font-bold">{page}</Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= meta.totalPages} onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= meta.totalPages} onClick={() => setPage(meta.totalPages)}>
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
