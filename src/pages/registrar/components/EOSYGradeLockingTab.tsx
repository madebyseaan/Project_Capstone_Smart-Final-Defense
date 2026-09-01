import { Loader2, CheckCircle, FileCheck, FileEdit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTheme } from "@/contexts/ThemeContext";

interface EOSYGradeLockingTabProps {
  allTermStatus: any[];
  finalizeLoading: boolean;
  finalizingSubject: string | null;
  finalizeMessage: string | null;
  epSectionName: string | null;
  onFinalizeAll: () => void;
  onUnfinalizeAll: () => void;
}

export default function EOSYGradeLockingTab({
  allTermStatus,
  finalizeLoading,
  finalizingSubject,
  finalizeMessage,
  epSectionName,
  onFinalizeAll,
  onUnfinalizeAll,
}: EOSYGradeLockingTabProps) {
  const { colors } = useTheme();

  const totalSubjects = allTermStatus.length;
  const draftCount = allTermStatus.filter((s) => s.totalDraft > 0).length;
  const finalizedCount = allTermStatus.filter(
    (s) => s.totalDraft === 0 && s.totalGrades > 0
  ).length;
  const progressPct = totalSubjects > 0 ? (finalizedCount / totalSubjects) * 100 : 0;

  if (allTermStatus.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileCheck className="w-10 h-10 text-slate-200 mb-3" />
        <p className="text-slate-500 font-medium">No subjects found for this section.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-xs font-medium text-gray-500">Total Subjects</p>
            <p className="text-2xl font-bold text-gray-900">{totalSubjects}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-amber-600">Draft</p>
            <p className="text-2xl font-bold text-amber-600">{draftCount}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-emerald-600">Finalized</p>
            <p className="text-2xl font-bold text-emerald-600">{finalizedCount}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {draftCount > 0 ? (
            <Button
              onClick={onFinalizeAll}
              disabled={finalizingSubject === "all"}
              style={{ backgroundColor: colors.primary }}
              className="text-white"
            >
              {finalizingSubject === "all" ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <FileCheck className="w-4 h-4 mr-2" />
              )}
              Finalize All ({draftCount})
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={onUnfinalizeAll}
              disabled={finalizingSubject === "all"}
              className="text-orange-600 border-orange-200 hover:bg-orange-50"
            >
              {finalizingSubject === "all" ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <FileEdit className="w-4 h-4 mr-2" />
              )}
              Unfinalize All
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-500">Locking Progress</span>
          <span className="text-xs text-gray-500">{Math.round(progressPct)}%</span>
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              backgroundColor: progressPct === 100 ? "#10b981" : colors.primary,
            }}
          />
        </div>
      </div>

      {/* Status Message */}
      {finalizeMessage && (
        <div
          className={`text-sm font-medium px-4 py-2 rounded-lg ${
            finalizeMessage.includes("Failed")
              ? "bg-red-100 text-red-700 border border-red-200"
              : "bg-emerald-100 text-emerald-700 border border-emerald-200"
          }`}
        >
          {finalizeMessage}
        </div>
      )}

      {/* Subject/Term Matrix */}
      <div className="border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50/80 hover:bg-gray-50/80">
              <TableHead className="font-bold text-gray-700">Subject</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">T1</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">T2</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">T3</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allTermStatus.map((subject: any) => (
              <TableRow key={subject.subjectId} className="hover:bg-slate-50/50 transition-colors">
                <TableCell className="font-medium text-gray-900 text-sm">
                  {subject.subjectName}
                </TableCell>
                {(["T1", "T2", "T3"] as const).map((term) => {
                  const ts = subject.terms[term];
                  const hasGrades = ts.total > 0;
                  const hasDraft = ts.draft > 0;
                  const allFinalized = hasGrades && ts.draft === 0;
                  return (
                    <TableCell key={term} className="text-center">
                      {!hasGrades ? (
                        <span className="text-gray-300">—</span>
                      ) : allFinalized ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[11px]">
                          <CheckCircle className="w-3 h-3 mr-1" /> {ts.finalized} final
                        </Badge>
                      ) : hasDraft ? (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[11px]">
                          {ts.draft} draft
                        </Badge>
                      ) : (
                        <span className="text-gray-400 text-sm">{ts.total}</span>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="text-center">
                  {subject.isComplete ? (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                      <CheckCircle className="w-3 h-3 mr-1" /> Finalized
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-700 border-amber-200">Draft</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
