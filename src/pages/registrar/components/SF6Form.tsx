import { useMemo } from "react";
import { AlertCircle, ArrowLeft, Loader2, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ExcelRenderer from "@/components/ExcelRenderer";
import { useTemplate } from "@/lib/useTemplate";
import type { Sf6Data } from "@/lib/api";
import { buildSf6TemplateFields } from "./sf6TemplateFields";
import { formatGradeLevel } from "./formUtils";

interface SF6FormProps {
  sf6Data: Sf6Data;
  onBack: () => void;
}

const GRADE_ORDER = ["GRADE_7", "GRADE_8", "GRADE_9", "GRADE_10"];

const PRINT_STYLES = `
  @media print {
    @page {
      size: A4 landscape;
      margin: 6mm;
    }

    .sf6-print-root {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      zoom: 0.78;
    }

    .sf6-print-root .excel-renderer-container {
      position: static !important;
      width: 100% !important;
      overflow: visible !important;
    }
  }
`;

function SF6SummaryFallback({ data }: { data: Sf6Data }) {
  return (
    <Card className="border-0 shadow-lg rounded-2xl">
      <CardHeader>
        <CardTitle className="text-lg">Promotion summary</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-4 py-3 text-left font-semibold">Grade Level</th>
                <th className="px-4 py-3 text-center font-semibold">Total</th>
                <th className="px-4 py-3 text-center font-semibold">Promoted</th>
                <th className="px-4 py-3 text-center font-semibold">Conditional</th>
                <th className="px-4 py-3 text-center font-semibold">Retained</th>
                <th className="px-4 py-3 text-center font-semibold">Pending</th>
                <th className="px-4 py-3 text-center font-semibold">Rate (graded)</th>
              </tr>
            </thead>
            <tbody>
              {GRADE_ORDER.map((gradeLevel) => {
                const grade = data.byGradeLevel?.[gradeLevel];
                if (!grade) return null;
                const graded = grade.promoted + grade.conditional + grade.retained;
                const rate = graded > 0 ? Math.round((grade.promoted / graded) * 100) : 0;
                return (
                  <tr key={gradeLevel} className="border-b hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium">{formatGradeLevel(gradeLevel)}</td>
                    <td className="px-4 py-3 text-center">{grade.total}</td>
                    <td className="px-4 py-3 text-center font-semibold">{grade.promoted}</td>
                    <td className="px-4 py-3 text-center font-semibold">{grade.conditional}</td>
                    <td className="px-4 py-3 text-center font-semibold">{grade.retained}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{grade.noGrades}</td>
                    <td className="px-4 py-3 text-center font-semibold">{rate}%</td>
                  </tr>
                );
              })}
              <tr className="bg-muted/50 font-bold">
                <td className="px-4 py-3">TOTAL</td>
                <td className="px-4 py-3 text-center">{data.summary.totalStudents}</td>
                <td className="px-4 py-3 text-center">{data.summary.promoted}</td>
                <td className="px-4 py-3 text-center">{data.summary.conditional}</td>
                <td className="px-4 py-3 text-center">{data.summary.retained}</td>
                <td className="px-4 py-3 text-center text-muted-foreground">{data.summary.noGrades}</td>
                <td className="px-4 py-3 text-center">
                  {data.summary.gradedStudents > 0
                    ? Math.round((data.summary.promoted / data.summary.gradedStudents) * 100)
                    : 0}
                  %
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SF6Form({ sf6Data, onBack }: SF6FormProps) {
  const { activeSheet, loading, error, refetch } = useTemplate("SF6");
  const templateFields = useMemo(() => buildSf6TemplateFields(sf6Data), [sf6Data]);
  const noGrades = sf6Data.summary.noGrades ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <style>{PRINT_STYLES}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print-hide">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-xl font-bold text-foreground">
              SF6 - Summarized Report on Promotion and Learning Progress &amp; Achievement
            </h2>
            <p className="text-sm text-muted-foreground">School Year: {sf6Data.schoolYear}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Reload template
          </Button>
          <Button size="sm" onClick={() => window.print()} disabled={!activeSheet}>
            <Printer className="w-4 h-4 mr-2" />
            Print SF6
          </Button>
        </div>
      </div>

      {noGrades > 0 && (
        <p className="text-xs text-muted-foreground print-hide">
          {noGrades} learner{noGrades === 1 ? "" : "s"} still have no encoded grades and are excluded from
          the promotion and proficiency totals.
        </p>
      )}

      {loading && (
        <Card className="border-0 shadow-lg rounded-2xl">
          <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading school form template...
          </CardContent>
        </Card>
      )}

      {!loading && activeSheet && (
        <Card className="border-0 shadow-lg rounded-2xl">
          <CardContent className="overflow-x-auto p-4 sm:p-6">
            <div className="sf6-print-root">
              <ExcelRenderer sheet={activeSheet} data={templateFields} showGridlines={false} />
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && !activeSheet && (
        <>
          <Card className="border-destructive/30 bg-destructive/5 p-0 print-hide">
            <CardContent className="flex items-start gap-3 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-semibold text-foreground">SF6 school form template unavailable</p>
                <p className="text-xs text-muted-foreground">
                  {error || "No active SF6 Excel template is registered."} Showing the computed promotion
                  summary instead. Register the template with{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                    pnpm run prisma:seed-sf6-template
                  </code>
                  .
                </p>
              </div>
            </CardContent>
          </Card>
          <SF6SummaryFallback data={sf6Data} />
        </>
      )}
    </div>
  );
}
