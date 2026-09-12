import type { ReactNode } from "react";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dash } from "@/components/data-table/Dash";
import type { SF10Data } from "@/lib/api";
import { formatGradeLevel } from "./formUtils";
import { buildSF10Areas, getAreaDisplayValues } from "./sf10Utils";

interface SF10InspectorProps {
  data: SF10Data;
  highlightArea: { recordIndex: number; name: string } | null;
  onHighlight: (area: { recordIndex: number; name: string } | null) => void;
  onClose?: () => void;
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

export default function SF10Inspector({ data, highlightArea, onHighlight, onClose }: SF10InspectorProps) {
  return (
    <Card className="border-0 shadow-none rounded-none bg-background p-0 overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-bold text-foreground">Record Inspector</p>
            <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px]">Read-only</Badge>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {data.student.name} · {data.student.lrn}
        </p>
      </div>
      <CardContent className="p-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          <Field label="LRN" value={<span className="font-mono">{data.student.lrn}</span>} />
          <Field label="Birthdate" value={data.student.birthDate} />
          <Field label="Sex" value={data.student.gender} />
          <Field label="Transferee" value={data.student.isTransferee ? "Yes" : "No"} />
        </div>

        {data.schoolRecords.map((record, recordIndex) => {
          const areas = buildSF10Areas(record.subjectGrades);
          return (
            <div key={recordIndex} className="rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">
                    Grade {formatGradeLevel(record.gradeLevel)} · {record.section}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{record.schoolYear}</p>
                </div>
                <Badge variant="outline" className="bg-card text-[11px] tabular-nums shrink-0">
                  Avg {record.generalAverage ?? "—"}
                </Badge>
              </div>
              <div className="p-2 space-y-1">
                {areas.map((area) => {
                  const vals = getAreaDisplayValues(area, record.subjectGrades);
                  const active =
                    !!highlightArea &&
                    highlightArea.recordIndex === recordIndex &&
                    highlightArea.name === area.name;
                  return (
                    <button
                      key={area.code}
                      type="button"
                      onClick={() => onHighlight(active ? null : { recordIndex, name: area.name })}
                      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs border transition-colors ${
                        active ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/60"
                      }`}
                    >
                      <span className="flex-1 font-medium text-foreground truncate">{area.name}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {[vals.t1, vals.t2, vals.t3].filter((v) => v != null).join(" / ") || "—"}
                      </span>
                      <span className="font-bold text-foreground tabular-nums w-8 text-right">{vals.final ?? "—"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Generated from class grades and EnrollPro data. To correct a grade, edit the class record.
        </p>
      </CardContent>
    </Card>
  );
}
