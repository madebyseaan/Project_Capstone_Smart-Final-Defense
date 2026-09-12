import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dash } from "@/components/data-table/Dash";
import type { SF9Data } from "@/lib/api";
import { formatGradeLevel } from "./formUtils";

interface SF9InspectorProps {
  data: SF9Data;
  highlightSubject: string | null;
  onHighlight: (subject: string | null) => void;
}

function Field({ label, value }: { label: string; value?: ReactNode }) {
  const shown = value === null || value === undefined || value === "" ? <Dash /> : value;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground break-words mt-0.5">{shown}</p>
    </div>
  );
}

export default function SF9Inspector({ data, highlightSubject, onHighlight }: SF9InspectorProps) {
  return (
    <Card className="border border-border shadow-sm rounded-xl bg-card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-foreground">Record Inspector</p>
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px]">Read-only</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {data.student.name} · {data.student.lrn}
        </p>
      </div>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Grade" value={formatGradeLevel(data.student.gradeLevel)} />
          <Field label="Section" value={data.student.section} />
          <Field label="School Year" value={data.student.schoolYear} />
          <Field label="Adviser" value={data.student.adviser} />
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Learning Areas</p>
          <div className="space-y-1">
            {data.subjectGrades.map((sg) => {
              const active = highlightSubject === sg.subjectName;
              return (
                <button
                  key={sg.subjectCode}
                  type="button"
                  onClick={() => onHighlight(active ? null : sg.subjectName)}
                  className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs border transition-colors ${
                    active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60"
                  }`}
                >
                  <span className="flex-1 font-medium text-foreground truncate">{sg.subjectName}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {[sg.T1, sg.T2, sg.T3].filter((v) => v != null).join(" / ") || "—"}
                  </span>
                  <span className="font-bold text-foreground tabular-nums w-8 text-right">{sg.final ?? "—"}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
          <span className="text-xs font-semibold text-muted-foreground">General Average</span>
          <span className="text-lg font-bold text-foreground tabular-nums">{data.generalAverage?.toFixed(2) ?? "—"}</span>
        </div>

        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Generated from class grades and EnrollPro data. To correct a grade, edit the class record.
        </p>
      </CardContent>
    </Card>
  );
}
