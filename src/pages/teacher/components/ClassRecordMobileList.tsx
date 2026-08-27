import React from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClassRecord } from "@/lib/api";

interface ClassRecordMobileListProps {
  records: ClassRecord[];
  selectedTerm: string;
  isHGClass: boolean;
  onTermChange: (term: string) => void;
  onOpenEditor: (studentId: string) => void;
  getDisplayFinalGrade: (record: ClassRecord) => number | null;
  getGradeColor: (grade: number | null) => string;
  isViewOnly?: boolean;
}

const terms = ["T1", "T2", "T3"] as const;

export function ClassRecordMobileList({
  records,
  selectedTerm,
  isHGClass,
  onTermChange,
  onOpenEditor,
  getDisplayFinalGrade,
  getGradeColor,
  isViewOnly = false,
}: ClassRecordMobileListProps) {
  return (
    <Card className="lg:hidden border-0 shadow-lg shadow-slate-200/40 rounded-[2rem] overflow-hidden bg-white">
      <CardHeader className="p-4 border-b border-slate-100 flex flex-row items-center justify-between">
        <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">
          {isHGClass ? "Homeroom Guidance" : "Class Ledger"}
        </h2>
        <Select value={selectedTerm} onValueChange={(val) => val && onTermChange(val)} disabled={isViewOnly}>
          <SelectTrigger className="w-28 font-bold" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="shadow-2xl">
            {terms.map((q) => (
              <SelectItem
                key={q}
                value={q}
                className="text-xs font-bold"
              >
                { q === "T1" ? "Term 1" : q === "T2" ? "Term 2" : "Term 3" }
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="p-4 space-y-3 bg-slate-50/40">
        {records.map((record, index) => {
          const grade = record.grades.find((g) => g.term === selectedTerm);
          const descriptor = grade?.qualitativeDescriptor ?? "Not set";
          const finalGrade = getDisplayFinalGrade(record);

          // Score breakdowns
          const wwScores = (grade?.writtenWorkScores ?? []) as { score: number | null; maxScore: number | null }[];
          const ptScores = (grade?.perfTaskScores ?? []) as { score: number | null; maxScore: number | null }[];
          const wwTotal = wwScores.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
          const wwMax = wwScores.reduce((acc, s) => acc + (Number(s.maxScore) || 0), 0);
          const ptTotal = ptScores.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
          const ptMax = ptScores.reduce((acc, s) => acc + (Number(s.maxScore) || 0), 0);
          const qaScore = grade?.quarterlyAssessScore ?? null;
          const qaMax = grade?.quarterlyAssessMax ?? null;
          const hasScores = wwMax > 0 || ptMax > 0 || qaScore !== null;

          return (
            <button
              key={record.student.id}
              type="button"
              onClick={() => !isViewOnly && onOpenEditor(record.student.id)}
              disabled={isViewOnly}
              className={`w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm active:scale-[0.995] transition ${isViewOnly ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{index + 1}</p>
                  <p className="text-sm font-black text-slate-900 uppercase tracking-tight truncate">
                    {record.student.lastName}, {record.student.firstName}
                  </p>
                  <p className="text-[10px] text-slate-500 font-semibold mt-0.5 font-mono">{record.student.lrn}</p>

                  {!isHGClass && hasScores && (
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">WW</span>
                        <span className="text-[10px] font-bold text-indigo-600">
                          {wwMax > 0 ? `${wwTotal}/${wwMax}` : "—"}
                        </span>
                      </div>
                      <div className="w-px h-3 bg-slate-200" />
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-black text-purple-400 uppercase tracking-widest">PT</span>
                        <span className="text-[10px] font-bold text-purple-600">
                          {ptMax > 0 ? `${ptTotal}/${ptMax}` : "—"}
                        </span>
                      </div>
                      <div className="w-px h-3 bg-slate-200" />
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">TA</span>
                        <span className="text-[10px] font-bold text-amber-600">
                          {qaScore !== null ? (qaMax ? `${qaScore}/${qaMax}` : String(qaScore)) : "—"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  {isHGClass ? (
                    <>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Descriptor</p>
                      <p className="text-xs font-bold text-slate-700 mt-1">{descriptor}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Grade</p>
                      <p className={`text-xl font-black ${getGradeColor(finalGrade)}`}>{finalGrade ?? "—"}</p>
                    </>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-300 ml-auto mt-1" />
                </div>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
