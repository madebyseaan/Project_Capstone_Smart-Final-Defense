import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ClassAssignment } from "@/lib/api";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

function getGradeColors(gradeLevel: string) {
  switch (gradeLevel) {
    case "GRADE_7": return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case "GRADE_8": return "bg-amber-50 text-amber-700 border-amber-100";
    case "GRADE_9": return "bg-rose-50 text-rose-700 border-rose-100";
    case "GRADE_10": return "bg-blue-50 text-blue-700 border-blue-100";
    default: return "bg-indigo-50 text-indigo-700 border-indigo-100";
  }
}

interface ClassRecordHeroProps {
  classAssignment: ClassAssignment;
  isHGClass: boolean;
  effectiveWeightsSource: "subject" | "generic-fallback" | null;
  onExportEcr: () => void;
  onOpenImport: () => void;
  onImportSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function ClassRecordHero({
  classAssignment,
  isHGClass,
  effectiveWeightsSource,
  onExportEcr,
  onOpenImport,
  onImportSelect,
  fileInputRef,
}: ClassRecordHeroProps) {
  return (
    <>
      <div className="relative overflow-hidden bg-white border border-slate-100 p-8 shadow-xl shadow-slate-200/50">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50/50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="flex items-center gap-6">
            <Link to="/teacher/classes">
              <Button variant="ghost" size="icon" className="w-12 h-12 rounded-2xl bg-slate-50 text-slate-400 hover:bg-indigo-600 hover:text-white transition-all border border-slate-100 shadow-sm">
                <ArrowLeft className="w-6 h-6" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Badge className={`${getGradeColors(classAssignment.section.gradeLevel)} text-[10px] font-black uppercase tracking-widest px-3`}>
                  {gradeLevelLabels[classAssignment.section.gradeLevel]}
                </Badge>
                <div className="h-4 w-px bg-slate-200" />
                <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">
                  Section {classAssignment.section.name}
                </span>
              </div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight uppercase">{classAssignment.subject.name}</h1>
              {effectiveWeightsSource === "generic-fallback" && !isHGClass && (
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mt-2">
                  Generic WW/PT/TA fallback active (no exact ECR template for this subject)
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!isHGClass ? (
              <>
                <Button
                  variant="outline"
                  className="h-12 px-6 rounded-2xl border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all shadow-sm"
                  onClick={onExportEcr}
                >
                  <Download className="w-4 h-4 mr-2" />EXPORT ECR
                </Button>
                <Button
                  className="h-12 px-8 rounded-2xl text-[10px] tracking-widest uppercase transition-all shadow-xl"
                  style={{ backgroundColor: "var(--theme-primary)", color: "var(--theme-primary-text)" }}
                  onClick={onOpenImport}
                >
                  <Upload className="w-4 h-4 mr-3" />IMPORT ECR
                </Button>
                <input type="file" ref={fileInputRef} onChange={onImportSelect} accept=".xlsx,.xls" className="hidden" />
              </>
            ) : (
              <Badge className="h-9 px-4 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold">
                Qualitative Grading Mode
              </Badge>
            )}
          </div>
        </div>
      </div>

      {(classAssignment.isActive === false || !!classAssignment.archivedAt) && (
        <Card className="border-0 shadow-lg shadow-rose-100/50 rounded-[2rem] overflow-hidden bg-rose-50/60 border border-rose-100">
          <CardContent className="p-6 flex flex-col gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-rose-600">Archived from Atlas</p>
            <p className="text-sm font-bold text-slate-700">
              This subject was removed from the current Atlas load. SMART keeps the grade history for recovery, but this class is no longer active on the dashboard.
            </p>
            {classAssignment.archivedReason && (
              <p className="text-[10px] font-semibold text-rose-500 uppercase tracking-widest">
                Reason: {classAssignment.archivedReason}
              </p>
            )}
            <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">
              If this was not intended, contact the EnrollPro/Atlas admin to restore the subject assignment.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
