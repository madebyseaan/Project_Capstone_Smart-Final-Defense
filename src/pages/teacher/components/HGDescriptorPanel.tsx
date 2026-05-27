import React from "react";
import { Card, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClassRecord } from "@/lib/api";

const terms = ["T1", "T2", "T3"] as const;

interface HGDescriptorPanelProps {
  records: ClassRecord[];
  selectedTerm: string;
  onTermChange: (term: string) => void;
  savingDescriptorStudentId: string | null;
  descriptors: readonly string[];
  onDescriptorUpdate: (studentId: string, descriptor: string) => void;
}

export function HGDescriptorPanel({
  records,
  selectedTerm,
  onTermChange,
  savingDescriptorStudentId,
  descriptors,
  onDescriptorUpdate,
}: HGDescriptorPanelProps) {
  return (
    <Card className="hidden lg:block border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white">
      <CardHeader className="p-8 border-0 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Homeroom Guidance Descriptors</h2>
          <p className="text-slate-500 text-sm mt-1">Select one qualitative descriptor per learner for {selectedTerm}.</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Period:</span>
          <Select value={selectedTerm} onValueChange={(val) => val && onTermChange(val)}>
            <SelectTrigger className="h-11 w-40 bg-white border-slate-200 text-sm font-black uppercase rounded-xl shadow-sm px-6">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-slate-200 shadow-2xl p-2">
              {terms.map((q) => (
                <SelectItem key={q} value={q} className="text-xs font-black uppercase rounded-lg py-2.5 px-4 focus:bg-indigo-50 focus:text-indigo-600 transition-colors cursor-pointer">
                  {q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <div className="border-t border-slate-100 p-6 space-y-3">
        {records.map((record, index) => {
          const termGrade = record.grades.find((g) => g.term === selectedTerm);
          const descriptor = termGrade?.qualitativeDescriptor ?? "";
          const isSaving = savingDescriptorStudentId === record.student.id;

          return (
            <div key={record.student.id} className="grid grid-cols-[52px_140px_minmax(200px,1fr)_minmax(280px,360px)] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-black text-slate-500">{index + 1}</p>
              <p className="text-xs font-mono text-slate-500">{record.student.lrn}</p>
              <p className="text-sm font-bold text-slate-800">{record.student.lastName}, {record.student.firstName}</p>
              <Select
                value={descriptor || undefined}
                onValueChange={(value) => {
                  if (!value) return;
                  onDescriptorUpdate(record.student.id, value);
                }}
                disabled={isSaving}
              >
                <SelectTrigger className="h-10 rounded-xl">
                  <SelectValue placeholder="Select descriptor" />
                </SelectTrigger>
                <SelectContent>
                  {descriptors.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
