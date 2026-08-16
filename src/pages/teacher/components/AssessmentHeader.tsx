import React from "react";
import { Button } from "@/components/ui/button";

interface AssessmentTaskMeta {
  description: string;
  date: string;
}

interface AssessmentHeaderProps {
  showAssessmentDetails: boolean;
  wwCount: number;
  ptCount: number;
  wwMeta: AssessmentTaskMeta[];
  ptMeta: AssessmentTaskMeta[];
  qaMeta: { description: string; date: string };
  setWwMeta: React.Dispatch<React.SetStateAction<AssessmentTaskMeta[]>>;
  setPtMeta: React.Dispatch<React.SetStateAction<AssessmentTaskMeta[]>>;
  setQaMeta: React.Dispatch<React.SetStateAction<{ description: string; date: string }>>;
  saveAssessmentDetails: () => void;
  savingMeta: boolean;
  selectedColumn: { type: "WW" | "PT" | "QA"; number: number } | null;
  setSelectedColumn: React.Dispatch<React.SetStateAction<{ type: "WW" | "PT" | "QA"; number: number } | null>>;
  metaEditorDraft: { description: string; date: string };
  setMetaEditorDraft: React.Dispatch<React.SetStateAction<{ description: string; date: string }>>;
  saveColumnMeta: () => void;
  metaEditorRef?: React.RefObject<HTMLDivElement | null>;
  assessmentDetailsRef?: React.RefObject<HTMLDivElement | null>;
}

export function AssessmentHeader({
  showAssessmentDetails,
  wwCount,
  ptCount,
  wwMeta,
  ptMeta,
  qaMeta,
  setWwMeta,
  setPtMeta,
  setQaMeta,
  saveAssessmentDetails,
  savingMeta,
  selectedColumn,
  setSelectedColumn,
  metaEditorDraft,
  setMetaEditorDraft,
  saveColumnMeta,
  metaEditorRef,
  assessmentDetailsRef,
}: AssessmentHeaderProps) {
  const categoryLabel = selectedColumn
    ? `${selectedColumn.type === "QA" ? "TA" : selectedColumn.type}${selectedColumn.type === "QA" ? "" : ` ${selectedColumn.number}`}`
    : "";

  return (
    <>
      {/* ── Per-column Quick Meta Editor ─────────────────────────────── */}
      {selectedColumn && (
        <div id="tutorial-column-meta-editor" ref={metaEditorRef} className="bg-white w-full border-b border-slate-100">
          <div className="px-5 py-2">
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm animate-fade-in">
              <div className="flex items-end gap-4 px-5 py-3">
                {/* Inputs */}
                <div className="flex-1 grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                      {categoryLabel} Description (optional)
                    </label>
                    <input
                      type="text"
                      value={metaEditorDraft.description}
                      onChange={(e) =>
                        setMetaEditorDraft((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder={`e.g., Quiz ${selectedColumn.number}`}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-300 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                      Column Date (applies to all students)
                    </label>
                    <input
                      type="date"
                      value={metaEditorDraft.date}
                      onChange={(e) =>
                        setMetaEditorDraft((prev) => ({ ...prev, date: e.target.value }))
                      }
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-300 transition-all"
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setSelectedColumn(null)}
                    className="px-5 py-2.5 border border-slate-200 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all"
                  >
                    Close
                  </button>
                  <button
                    onClick={saveColumnMeta}
                    disabled={savingMeta}
                    className="px-6 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-700 transition-all disabled:opacity-50 shadow-sm"
                  >
                    {savingMeta ? "Applying\u2026" : "Apply"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Optional Assessment Details (bulk editor) ────────────────── */}
      {showAssessmentDetails && (
        <div id="tutorial-assessment-details-panel" ref={assessmentDetailsRef} className="bg-white w-full border-b border-slate-100">
          <div className="px-4 py-1.5">
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Optional Assessment Details
                </span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              <div className="grid grid-cols-3 gap-0 divide-x divide-slate-100">
                {/* Written Work */}
                <div className="px-4 py-2.5 space-y-2 flex flex-col">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-1.5 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
                    Written Work
                  </p>
                  <div className="mb-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5 ml-0.5">
                      WW 1 Date
                    </label>
                    <input
                      type="date"
                      value={wwMeta[0]?.date || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setWwMeta((prev) => {
                          const next = [...prev];
                          while (next.length < wwCount) next.push({ description: `WW ${next.length + 1}`, date: "" });
                          next[0] = { ...(next[0] || { description: "WW 1", date: "" }), date: val };
                          return next;
                        });
                      }}
                      className="w-full h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-400/30 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    {Array.from({ length: wwCount }).map((_, i) => (
                      <input
                        key={`ww-meta-${i}`}
                        type="text"
                        value={wwMeta[i]?.description || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setWwMeta((prev) => {
                            const next = [...prev];
                            while (next.length <= i) next.push({ description: `WW ${next.length + 1}`, date: next[0]?.date || "" });
                            next[i] = { ...next[i], description: val };
                            return next;
                          });
                        }}
                        placeholder={`WW ${i + 1} description`}
                        className="w-full h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 placeholder:text-slate-300 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-400/30 outline-none transition-all"
                      />
                    ))}
                  </div>
                </div>

                {/* Performance Tasks */}
                <div className="px-4 py-2.5 space-y-2 flex flex-col">
                  <p className="text-[10px] font-black uppercase tracking-widest text-purple-600 flex items-center gap-1.5 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block" />
                    Performance Tasks
                  </p>
                  <div className="mb-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5 ml-0.5">
                      PT 1 Date
                    </label>
                    <input
                      type="date"
                      value={ptMeta[0]?.date || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPtMeta((prev) => {
                          const next = [...prev];
                          while (next.length < ptCount) next.push({ description: `PT ${next.length + 1}`, date: "" });
                          next[0] = { ...(next[0] || { description: "PT 1", date: "" }), date: val };
                          return next;
                        });
                      }}
                      className="w-full h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 focus:border-purple-300 focus:ring-2 focus:ring-purple-400/30 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    {Array.from({ length: ptCount }).map((_, i) => (
                      <input
                        key={`pt-meta-${i}`}
                        type="text"
                        value={ptMeta[i]?.description || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPtMeta((prev) => {
                            const next = [...prev];
                            while (next.length <= i) next.push({ description: `PT ${next.length + 1}`, date: next[0]?.date || "" });
                            next[i] = { ...next[i], description: val };
                            return next;
                          });
                        }}
                        placeholder={`PT ${i + 1} description`}
                        className="w-full h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 placeholder:text-slate-300 focus:border-purple-300 focus:ring-2 focus:ring-purple-400/30 outline-none transition-all"
                      />
                    ))}
                  </div>
                </div>

                {/* Term Assessment */}
                <div className="px-4 py-2.5 space-y-2 flex flex-col">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-1.5 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                    Term Assessment
                  </p>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5 ml-0.5">
                      TA Date
                    </label>
                    <input
                      type="date"
                      value={qaMeta.date}
                      onChange={(e) => setQaMeta((prev) => ({ ...prev, date: e.target.value }))}
                      className="w-full h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 focus:border-amber-300 focus:ring-2 focus:ring-amber-400/30 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5 ml-0.5">
                      TA Description
                    </label>
                    <input
                      type="text"
                      value={qaMeta.description}
                      onChange={(e) => setQaMeta((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder="e.g., Term Assessment"
                      className="w-full h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 placeholder:text-slate-300 focus:border-amber-300 focus:ring-2 focus:ring-amber-400/30 outline-none transition-all"
                    />
                  </div>
                  <Button
                    onClick={saveAssessmentDetails}
                    className="w-full h-8 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white hover:bg-slate-700 transition-all shadow-sm mt-0.5"
                  >
                    Save All Details
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
