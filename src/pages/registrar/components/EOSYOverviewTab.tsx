import { Loader2, AlertTriangle, FileCheck, FileEdit, Users, CheckCircle, XCircle, AlertCircle, Lock, GraduationCap, Rocket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatCard } from "@/components/layout/StatCard";
import EOSYPromotionBreakdown from "./EOSYPromotionBreakdown";
import { useTheme } from "@/contexts/ThemeContext";
import type { TermFinalizeStatusSubject } from "@/lib/termFinalizationTypes";

interface EOSYOverviewTabProps {
  smartPromotion: any;
  smartLoading: boolean;
  eosyFinalizing: boolean;
  eosyUnfinalizing?: boolean;
  records: any[];
  allTermStatus: TermFinalizeStatusSubject[];
  epSectionName: string | null;
  adviserName: string | null;
  eosyFinalized?: boolean;
  onEosyFinalize: () => void;
  onUnfinalizeEosy: () => void;
  onOpenTermFinalization: () => void;
}

export default function EOSYOverviewTab({
  smartPromotion,
  smartLoading,
  eosyFinalizing,
  eosyUnfinalizing,
  records,
  allTermStatus,
  epSectionName,
  adviserName,
  eosyFinalized,
  onEosyFinalize,
  onUnfinalizeEosy,
  onOpenTermFinalization,
}: EOSYOverviewTabProps) {
  const { colors } = useTheme();

  const promotedCount = records.filter((r) => {
    const s = r.smart?.decision?.promotionStatus;
    if (s) return s === "PROMOTED" || s === "JHS_COMPLETER";
    return r.promoted || r.finalStatus === "PROMOTED";
  }).length;
  const heldCount = records.filter((r) => {
    const s = r.smart?.decision?.promotionStatus;
    if (s) return s === "RETAINED" || s === "CONDITIONALLY_PROMOTED";
    return !r.promoted && r.finalStatus !== "PROMOTED" && r.finalStatus;
  }).length;
  const totalDraftSubjects = allTermStatus.filter((s) => s.totalDraft > 0).length;
  const totalFinalizedSubjects = allTermStatus.filter(
    (s) => s.totalDraft === 0 && s.totalGrades > 0
  ).length;
  const draftBlockers = smartPromotion?.draftBlockers ?? [];
  const hasBlockers = draftBlockers.length > 0;

  // Readiness checklist state
  const gradesLocked = allTermStatus.length > 0 && allTermStatus.every((s: any) => s.totalDraft === 0);
  const eosyDone = !!eosyFinalized;
  const readyForRollover = gradesLocked && eosyDone;

  return (
    <div className="space-y-6">
      {/* EOSY Readiness Checklist */}
      <Card className="border border-border shadow-sm rounded-xl p-0 overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">EOSY Readiness — {epSectionName ?? "this section"}</p>
            </div>
            <Badge
              className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                readyForRollover
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {readyForRollover ? "Ready for rollover" : "Not ready yet"}
            </Badge>
          </div>

          <div className="space-y-2">
            {/* Step 1 — Finalize term grades (owned by Term Finalization) */}
            <div
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3 ${
                gradesLocked ? "border-emerald-200 bg-emerald-50/50" : "border-border bg-muted/30"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    gradesLocked ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Step 1 — Finalize term grades</p>
                  <p className="text-xs text-muted-foreground">
                    {allTermStatus.length === 0
                      ? "No subjects loaded yet."
                      : gradesLocked
                        ? `${totalFinalizedSubjects}/${allTermStatus.length} subjects finalized across T1–T3.`
                        : `${totalDraftSubjects} subject(s) still have draft grades. Finalize them term-by-term on the Term Finalization page.`}
                  </p>
                  {allTermStatus.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(["T1", "T2", "T3"] as const).map((term) => {
                        const termSubjects = allTermStatus.filter(
                          (subject) => (subject.terms?.[term]?.total ?? 0) > 0,
                        );
                        const complete =
                          termSubjects.length > 0 &&
                          termSubjects.every((subject) => subject.terms[term].draft === 0);
                        return (
                          <Badge
                            key={term}
                            className={`text-[10px] font-medium ${
                              complete
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            }`}
                          >
                            {term} {complete ? "finalized" : "draft"}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <Button
                onClick={onOpenTermFinalization}
                disabled={allTermStatus.length === 0}
                size="sm"
                variant={gradesLocked ? "outline" : "default"}
                className="shrink-0"
              >
                <FileCheck className="w-4 h-4 mr-2" />
                {gradesLocked ? "Review Term Finalization" : "Open Term Finalization"}
              </Button>
            </div>

            {/* Step 2 — Finalize EOSY promotion */}
            <div
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3 ${
                eosyDone ? "border-emerald-200 bg-emerald-50/50" : "border-border bg-muted/30"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    eosyDone ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"
                  }`}
                >
                  <GraduationCap className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Step 2 — Finalize EOSY promotion</p>
                  <p className="text-xs text-muted-foreground">
                    {eosyDone
                      ? "Promotion snapshots saved and promotion status persisted for every learner."
                      : "Snapshots all final grades and saves each learner's promotion status (needed for rollover)."}
                  </p>
                </div>
              </div>
              {eosyDone ? (
                <Button
                  onClick={onUnfinalizeEosy}
                  disabled={eosyUnfinalizing || eosyFinalizing}
                  size="sm"
                  variant="outline"
                  className="text-amber-700 border-amber-200 hover:bg-amber-50 shrink-0"
                >
                  {eosyUnfinalizing ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <FileEdit className="w-4 h-4 mr-2" />
                  )}
                  Unfinalize EOSY
                </Button>
              ) : (
                <Button
                  onClick={onEosyFinalize}
                  disabled={eosyFinalizing || hasBlockers || !gradesLocked}
                  size="sm"
                  variant="outline"
                  className="text-primary border-primary/40 hover:bg-primary/5 shrink-0"
                >
                  {eosyFinalizing ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <GraduationCap className="w-4 h-4 mr-2" />
                  )}
                  {hasBlockers
                    ? "Blocked by Draft Grades"
                    : !gradesLocked
                      ? "Finalize All Terms First"
                      : "Finalize EOSY"}
                </Button>
              )}
            </div>
          </div>

          {readyForRollover && (
            <p className="text-xs font-medium text-emerald-700 mt-3">
              ✓ This section is complete. Once every section is ready, the admin can archive the school year.
            </p>
          )}
        </CardContent>
      </Card>

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
                <p className="text-sm font-medium text-foreground">
                  {eosyDone ? "EOSY promotion is finalized" : "Finalize EOSY"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {eosyDone
                    ? "Unfinalize only when term grades or promotion decisions need to change."
                    : "Snapshots all finalized grades and persists promotion status on each enrollment."}
                </p>
              </div>
              {eosyDone ? (
                <Button
                  onClick={onUnfinalizeEosy}
                  disabled={eosyUnfinalizing || eosyFinalizing}
                  variant="outline"
                  className="text-amber-700 border-amber-200 hover:bg-amber-50"
                >
                  {eosyUnfinalizing ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <FileEdit className="w-4 h-4 mr-2" />
                  )}
                  Unfinalize EOSY
                </Button>
              ) : (
                <Button
                  onClick={onEosyFinalize}
                  disabled={eosyFinalizing || hasBlockers || !gradesLocked}
                >
                  {eosyFinalizing ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <FileCheck className="w-4 h-4 mr-2" />
                  )}
                  {hasBlockers
                    ? "Blocked by Draft Grades"
                    : !gradesLocked
                      ? "Finalize All Terms First"
                      : "Finalize EOSY"}
                </Button>
              )}
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
