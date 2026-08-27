import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClassRecord } from "@/lib/api";

interface AssessmentTaskMeta {
  description: string;
  date: string;
}

interface GradeEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRecord: ClassRecord | null;
  isHGClass: boolean;
  selectedTerm: string;
  hgDescriptors: readonly string[];
  mobileEditorTab: "WW" | "PT" | "QA" | "HG";
  onTabChange: (tab: "WW" | "PT" | "QA" | "HG") => void;
  wwCount: number;
  ptCount: number;
  wwMeta: AssessmentTaskMeta[];
  ptMeta: AssessmentTaskMeta[];
  qaMeta: { description: string; date: string };
  mobileScoreDraft: Record<string, string>;
  invalidCells: Record<string, string>;
  getCellKey: (sid: string, cat: "WW" | "PT" | "QA", idx: number) => string;
  getMobileDraftKey: (studentId: string, category: "WW" | "PT" | "QA", index: number) => string;
  getScoreFromGrade: (record: ClassRecord, category: "WW" | "PT" | "QA", index: number) => string;
  getMaxForCell: (cat: "WW" | "PT" | "QA", idx: number) => number;
  onMobileScoreDraftChange: (studentId: string, category: "WW" | "PT" | "QA", index: number, value: string) => void;
  onMobileScoreCommit: (record: ClassRecord, category: "WW" | "PT" | "QA", index: number) => void;
  onDescriptorUpdate: (studentId: string, descriptor: string) => void;
  onApplyColumnMeta: (category: "WW" | "PT" | "QA", index: number, description: string, date: string) => void;
  isViewOnly?: boolean;
}

export function GradeEditModal({
  open,
  onOpenChange,
  selectedRecord,
  isHGClass,
  selectedTerm,
  hgDescriptors,
  mobileEditorTab,
  onTabChange,
  wwCount,
  ptCount,
  wwMeta,
  ptMeta,
  qaMeta,
  mobileScoreDraft,
  invalidCells,
  getCellKey,
  getMobileDraftKey,
  getScoreFromGrade,
  getMaxForCell,
  onMobileScoreDraftChange,
  onMobileScoreCommit,
  onDescriptorUpdate,
  onApplyColumnMeta,
  isViewOnly = false,
}: GradeEditModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-[2rem] border-0 shadow-2xl p-0 overflow-hidden bg-white">
        {selectedRecord && (
          <div className="max-h-[85vh] overflow-y-auto">
            <div className="px-5 pt-5 pb-4 border-b border-slate-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Edit Grade</p>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mt-1">
                {selectedRecord.student.lastName}, {selectedRecord.student.firstName}
              </h3>
              <p className="text-[10px] font-semibold text-slate-500 mt-1">{selectedRecord.student.lrn}</p>
            </div>

            {isHGClass ? (
              <div className="p-5 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Descriptor ({selectedTerm})
                </p>
                <Select
                  value={selectedRecord.grades.find((g) => g.term === selectedTerm)?.qualitativeDescriptor || undefined}
                  onValueChange={(value) => {
                    if (!value) return;
                    onDescriptorUpdate(selectedRecord.student.id, value);
                  }}
                  disabled={isViewOnly}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select descriptor" />
                  </SelectTrigger>
                  <SelectContent>
                    {hgDescriptors.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="px-5 pt-4">
                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1">
                    {(["WW", "PT", "QA"] as const).map((tab) => {
                      const active = mobileEditorTab === tab;
                      return (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => onTabChange(tab)}
                          className="h-10 rounded-lg text-xs font-black uppercase tracking-widest transition"
                          style={active ? { backgroundColor: "var(--theme-primary)", color: "var(--theme-primary-text)" } : { color: "#475569" }}
                        >
                          {tab === "WW" ? "Quiz" : tab === "QA" ? "TA" : tab}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {mobileEditorTab === "WW" &&
                    Array.from({ length: wwCount }).map((_, i) => {
                      const key = getMobileDraftKey(selectedRecord.student.id, "WW", i);
                      const maxAllowed = getMaxForCell("WW", i);
                      const description = wwMeta[i]?.description || `WW ${i + 1}`;
                      const date = wwMeta[i]?.date || "";

                      return (
                        <div key={`mobile-ww-${i}`} className="rounded-xl border border-slate-100 p-3 space-y-2 bg-slate-50/40">
                          <div className="grid grid-cols-1 gap-2">
                            <input
                              type="text"
                              defaultValue={description}
                              disabled={isViewOnly}
                              onBlur={(e) => onApplyColumnMeta("WW", i, e.currentTarget.value, date)}
                              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                              placeholder={`WW ${i + 1} description`}
                            />
                            <input
                              type="date"
                              defaultValue={date}
                              disabled={isViewOnly}
                              onBlur={(e) => onApplyColumnMeta("WW", i, description, e.currentTarget.value)}
                              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                            Quiz {i + 1} Score (MAX {maxAllowed})
                          </label>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={mobileScoreDraft[key] ?? getScoreFromGrade(selectedRecord, "WW", i)}
                            disabled={isViewOnly}
                            onChange={(e) => onMobileScoreDraftChange(selectedRecord.student.id, "WW", i, e.target.value)}
                            onBlur={() => onMobileScoreCommit(selectedRecord, "WW", i)}
                            className="w-full h-12 rounded-xl border border-slate-200 px-4 text-base font-bold text-slate-700 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{ borderColor: invalidCells[getCellKey(selectedRecord.student.id, "WW", i)] ? "#f43f5e" : undefined }}
                            placeholder="0"
                          />
                        </div>
                      );
                    })}

                  {mobileEditorTab === "PT" &&
                    Array.from({ length: ptCount }).map((_, i) => {
                      const key = getMobileDraftKey(selectedRecord.student.id, "PT", i);
                      const maxAllowed = getMaxForCell("PT", i);
                      const description = ptMeta[i]?.description || `PT ${i + 1}`;
                      const date = ptMeta[i]?.date || "";

                      return (
                        <div key={`mobile-pt-${i}`} className="rounded-xl border border-slate-100 p-3 space-y-2 bg-slate-50/40">
                          <div className="grid grid-cols-1 gap-2">
                            <input
                              type="text"
                              defaultValue={description}
                              disabled={isViewOnly}
                              onBlur={(e) => onApplyColumnMeta("PT", i, e.currentTarget.value, date)}
                              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                              placeholder={`PT ${i + 1} description`}
                            />
                            <input
                              type="date"
                              defaultValue={date}
                              disabled={isViewOnly}
                              onBlur={(e) => onApplyColumnMeta("PT", i, description, e.currentTarget.value)}
                              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                            PT {i + 1} Score (MAX {maxAllowed})
                          </label>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={mobileScoreDraft[key] ?? getScoreFromGrade(selectedRecord, "PT", i)}
                            disabled={isViewOnly}
                            onChange={(e) => onMobileScoreDraftChange(selectedRecord.student.id, "PT", i, e.target.value)}
                            onBlur={() => onMobileScoreCommit(selectedRecord, "PT", i)}
                            className="w-full h-12 rounded-xl border border-slate-200 px-4 text-base font-bold text-slate-700 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{ borderColor: invalidCells[getCellKey(selectedRecord.student.id, "PT", i)] ? "#f43f5e" : undefined }}
                            placeholder="0"
                          />
                        </div>
                      );
                    })}

                  {mobileEditorTab === "QA" && (
                    <div className="rounded-xl border border-slate-100 p-3 space-y-2 bg-slate-50/40">
                      <input
                        type="text"
                        defaultValue={qaMeta.description}
                        disabled={isViewOnly}
                        onBlur={(e) => onApplyColumnMeta("QA", 0, e.currentTarget.value, qaMeta.date || "")}
                        className="w-full h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                        placeholder="TA description"
                      />
                      <input
                        type="date"
                        defaultValue={qaMeta.date || ""}
                        disabled={isViewOnly}
                        onBlur={(e) => onApplyColumnMeta("QA", 0, qaMeta.description || "", e.currentTarget.value)}
                        className="w-full h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                        TA Score (MAX {getMaxForCell("QA", 0)})
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={
                          mobileScoreDraft[getMobileDraftKey(selectedRecord.student.id, "QA", 0)] ??
                          getScoreFromGrade(selectedRecord, "QA", 0)
                        }
                        disabled={isViewOnly}
                        onChange={(e) => onMobileScoreDraftChange(selectedRecord.student.id, "QA", 0, e.target.value)}
                        onBlur={() => onMobileScoreCommit(selectedRecord, "QA", 0)}
                        className="w-full h-12 rounded-xl border border-slate-200 px-4 text-base font-bold text-slate-700 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{ borderColor: invalidCells[getCellKey(selectedRecord.student.id, "QA", 0)] ? "#f43f5e" : undefined }}
                        placeholder="0"
                      />
                    </div>
                  )}
                </div>

                <div className="px-5 pb-5">
                  <Button
                    type="button"
                    disabled={isViewOnly}
                    className="w-full h-11 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ backgroundColor: "var(--theme-primary)", color: "var(--theme-primary-text)" }}
                    onClick={() => onOpenChange(false)}
                  >
                    Done
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
