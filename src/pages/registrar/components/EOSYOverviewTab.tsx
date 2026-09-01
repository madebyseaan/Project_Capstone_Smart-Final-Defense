import { Loader2, AlertTriangle, FileCheck, Users, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import EOSYPromotionBreakdown from "./EOSYPromotionBreakdown";
import { useTheme } from "@/contexts/ThemeContext";

interface EOSYOverviewTabProps {
  smartPromotion: any;
  smartLoading: boolean;
  eosyFinalizing: boolean;
  records: any[];
  allTermStatus: any[];
  epSectionName: string | null;
  adviserName: string | null;
  onEosyFinalize: () => void;
}

export default function EOSYOverviewTab({
  smartPromotion,
  smartLoading,
  eosyFinalizing,
  records,
  allTermStatus,
  epSectionName,
  adviserName,
  onEosyFinalize,
}: EOSYOverviewTabProps) {
  const { colors } = useTheme();

  const promotedCount = records.filter(
    (r) => r.promoted || r.finalStatus === "PROMOTED"
  ).length;
  const heldCount = records.filter(
    (r) => !r.promoted && r.finalStatus !== "PROMOTED" && r.finalStatus
  ).length;
  const totalDraftSubjects = allTermStatus.filter((s) => s.totalDraft > 0).length;
  const totalFinalizedSubjects = allTermStatus.filter(
    (s) => s.totalDraft === 0 && s.totalGrades > 0
  ).length;
  const draftBlockers = smartPromotion?.draftBlockers ?? [];
  const hasBlockers = draftBlockers.length > 0;

  return (
    <div className="space-y-6">
      {/* Section Info */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Adviser:</span>
        {adviserName ? (
          <span className="font-semibold text-gray-900">{adviserName}</span>
        ) : (
          <span className="text-amber-600 italic">Not assigned</span>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-blue-50 border border-blue-100">
          <div className="p-2 rounded-lg bg-blue-100">
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-blue-600">Learners</p>
            <p className="text-2xl font-bold text-blue-900">{records.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-100">
          <div className="p-2 rounded-lg bg-emerald-100">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-emerald-600">Promoted</p>
            <p className="text-2xl font-bold text-emerald-900">{promotedCount}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
          <div className="p-2 rounded-lg bg-red-100">
            <XCircle className="w-4 h-4 text-red-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-red-600">Held</p>
            <p className="text-2xl font-bold text-red-900">{heldCount}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-100">
          <div className="p-2 rounded-lg bg-amber-100">
            <AlertCircle className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-amber-600">Draft Subjects</p>
            <p className="text-2xl font-bold text-amber-900">{totalDraftSubjects}</p>
          </div>
        </div>
      </div>

      {/* Grade Locking Progress */}
      {allTermStatus.length > 0 && (
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Grade Locking Progress</span>
              <span className="text-sm text-gray-500">
                {totalFinalizedSubjects}/{allTermStatus.length} subjects finalized
              </span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${allTermStatus.length > 0 ? (totalFinalizedSubjects / allTermStatus.length) * 100 : 0}%`,
                  backgroundColor: totalDraftSubjects === 0 ? "#10b981" : colors.primary,
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Promotion Breakdown */}
      {smartLoading ? (
        <Card className="border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Computing promotion status...</span>
            </div>
          </CardContent>
        </Card>
      ) : smartPromotion?.enrollments?.length > 0 ? (
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Promotion Decisions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <EOSYPromotionBreakdown enrollments={smartPromotion.enrollments} />

            {/* EOSY Finalize Action */}
            <Separator />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Finalize EOSY</p>
                <p className="text-xs text-gray-500">
                  Snapshots all finalized grades and persists promotion status on each enrollment.
                </p>
              </div>
              <Button
                onClick={onEosyFinalize}
                disabled={eosyFinalizing || hasBlockers}
                style={{ backgroundColor: hasBlockers ? undefined : colors.primary }}
                className={hasBlockers ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "text-white"}
              >
                {eosyFinalizing ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <FileCheck className="w-4 h-4 mr-2" />
                )}
                {hasBlockers ? "Blocked by Draft Grades" : "Finalize EOSY"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : !smartPromotion ? (
        <Card className="border-slate-200">
          <CardContent className="p-6">
            <p className="text-sm text-gray-400">
              Select a section that exists in SMART to compute promotion status.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Draft Blockers */}
      {hasBlockers && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <p className="text-sm font-semibold text-red-800">
              Finalize blocked — {draftBlockers.length} DRAFT grade(s) remaining
            </p>
          </div>
          <div className="max-h-32 overflow-y-auto">
            <ul className="text-xs text-red-700 space-y-1">
              {draftBlockers.slice(0, 10).map((b: any, i: number) => (
                <li key={i} className="flex items-center gap-1">
                  <span className="text-red-400">•</span>
                  {b.studentName} — {b.subjectName} ({b.term})
                </li>
              ))}
              {draftBlockers.length > 10 && (
                <li className="text-red-500 font-medium">
                  ...and {draftBlockers.length - 10} more
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
