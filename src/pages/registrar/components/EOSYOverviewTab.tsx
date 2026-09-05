import { Loader2, AlertTriangle, FileCheck, Users, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatCard } from "@/components/layout/StatCard";
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
        <span className="text-muted-foreground">Adviser:</span>
        {adviserName ? (
          <span className="font-semibold text-foreground">{adviserName}</span>
        ) : (
          <span className="text-amber-600 italic">Not assigned</span>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Learners"
          value={records.length}
          numericValue={records.length}
          icon={<Users className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Promoted"
          value={promotedCount}
          numericValue={promotedCount}
          icon={<CheckCircle className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Held"
          value={heldCount}
          numericValue={heldCount}
          icon={<XCircle className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Draft Subjects"
          value={totalDraftSubjects}
          numericValue={totalDraftSubjects}
          icon={<AlertCircle className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
      </div>

      {/* Grade Locking Progress */}
      {allTermStatus.length > 0 && (
        <Card className="border border-border shadow-sm rounded-xl p-0 overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">Grade Locking Progress</span>
              <span className="text-sm text-muted-foreground">
                {totalFinalizedSubjects}/{allTermStatus.length} subjects finalized
              </span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
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
        <Card className="border border-border shadow-sm rounded-xl p-0">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Computing promotion status...</span>
            </div>
          </CardContent>
        </Card>
      ) : smartPromotion?.enrollments?.length > 0 ? (
        <Card className="border border-border shadow-sm rounded-xl p-0">
          <CardHeader className="pb-3 px-6 pt-5">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Promotion Decisions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6">
            <EOSYPromotionBreakdown enrollments={smartPromotion.enrollments} />

            {/* EOSY Finalize Action */}
            <Separator />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Finalize EOSY</p>
                <p className="text-xs text-muted-foreground">
                  Snapshots all finalized grades and persists promotion status on each enrollment.
                </p>
              </div>
              <Button
                onClick={onEosyFinalize}
                disabled={eosyFinalizing || hasBlockers}
                style={{ backgroundColor: hasBlockers ? undefined : colors.primary }}
                className={hasBlockers ? "bg-muted text-muted-foreground cursor-not-allowed" : "text-primary-foreground"}
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
        <Card className="border border-border shadow-sm rounded-xl p-0">
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              Select a section that exists in SMART to compute promotion status.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Draft Blockers */}
      {hasBlockers && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <p className="text-sm font-semibold text-rose-800">
              Finalize blocked — {draftBlockers.length} DRAFT grade(s) remaining
            </p>
          </div>
          <div className="max-h-32 overflow-y-auto">
            <ul className="text-xs text-rose-700 space-y-1">
              {draftBlockers.slice(0, 10).map((b: any, i: number) => (
                <li key={i} className="flex items-center gap-1">
                  <span className="text-rose-400">•</span>
                  {b.studentName} — {b.subjectName} ({b.term})
                </li>
              ))}
              {draftBlockers.length > 10 && (
                <li className="text-rose-500 font-medium">
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
