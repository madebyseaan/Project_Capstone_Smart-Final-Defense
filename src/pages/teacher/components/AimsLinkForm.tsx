import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Link2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";
import { gradesApi, type AimsCourseSummary } from "@/lib/api";

export interface AimsClassContext {
  subjectName: string;
  sectionName: string;
  gradeLevel: string;
  schoolYear: string;
}

interface AimsLinkFormProps {
  classAssignmentId: string;
  classContext?: AimsClassContext;
  onConnected: () => void;
  onCancel: () => void;
}

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

function mismatchChips(course: AimsCourseSummary): string[] {
  const match = course.match;
  if (!match) return [];
  const chips: string[] = [];
  if (!match.schoolYearMatched) chips.push("Different school year");
  if (!match.sectionMatched) chips.push("Different section");
  if (!match.subjectMatched) chips.push("Different subject");
  else if (course.gradeLevel && !match.gradeLevelMatched) chips.push("Different grade level");
  return chips;
}

export function AimsLinkForm({ classAssignmentId, classContext, onConnected, onCancel }: AimsLinkFormProps) {
  const [courses, setCourses] = useState<AimsCourseSummary[]>([]);
  const [scope, setScope] = useState<"teacher" | "school" | "none">("none");
  const [suggestedCourseId, setSuggestedCourseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualId, setManualId] = useState("");
  const [linking, setLinking] = useState(false);
  const [pendingWarnings, setPendingWarnings] = useState<string[] | null>(null);
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await gradesApi.getAimsCourses(classAssignmentId);
      const list = res.data.courses ?? [];
      setCourses(list);
      setScope(res.data.scope ?? "none");
      const suggested = res.data.suggestedCourseId;
      setSuggestedCourseId(suggested ?? null);
      setSelectedId((prev) => {
        if (suggested && list.some((c) => c.id === suggested)) return suggested;
        if (prev && list.some((c) => c.id === prev)) return prev;
        return "";
      });
    } catch {
      setCourses([]);
      setScope("none");
      setSuggestedCourseId(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [classAssignmentId]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    if (!loading && courses.length === 0) setManualOpen(true);
  }, [loading, courses.length]);

  const handleLink = async () => {
    const courseId = selectedId || manualId.trim();
    if (!courseId) return;

    setLinking(true);
    try {
      const res = await gradesApi.linkAims(classAssignmentId, courseId);
      if (res.data.warnings?.length > 0) {
        setPendingWarnings(res.data.warnings);
        setPendingCourseId(courseId);
      } else {
        toast.success("AIMS course connected successfully");
        onConnected();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to link AIMS course");
    } finally {
      setLinking(false);
    }
  };

  const confirmLinkDespiteWarnings = () => {
    setPendingWarnings(null);
    setPendingCourseId(null);
    toast.success("AIMS course connected (with warnings)");
    onConnected();
  };

  const cancelLinkDespiteWarnings = async () => {
    if (pendingCourseId) {
      try {
        await gradesApi.unlinkAims(classAssignmentId);
      } catch {
        // Non-fatal — link may not have persisted
      }
    }
    setPendingWarnings(null);
    setPendingCourseId(null);
    toast.info("Connection cancelled");
    onCancel();
  };

  // ── Warnings confirm view (no nested dialog) ───────────────────────
  if (pendingWarnings !== null) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Connect with Warnings</DialogTitle>
          <DialogDescription>The AIMS course doesn't fully match this class:</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {pendingWarnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
              <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">{w}</p>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={cancelLinkDespiteWarnings}>Cancel</Button>
          <Button onClick={confirmLinkDespiteWarnings}>Connect Anyway</Button>
        </DialogFooter>
      </>
    );
  }

  // ── Course picker view ─────────────────────────────────────────────
  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect to AIMS</DialogTitle>
        <DialogDescription>
          {classContext
            ? <>Connecting <span className="font-medium text-foreground">{classContext.subjectName}</span> · {gradeLevelLabels[classContext.gradeLevel] ?? classContext.gradeLevel} – {classContext.sectionName} · {classContext.schoolYear}. The best-matching AIMS course is preselected.</>
            : "Select the AIMS course that matches this class."}
        </DialogDescription>
      </DialogHeader>

      {loading && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg border border-border bg-muted/40 animate-pulse" />
          ))}
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading courses from AIMS...
          </p>
        </div>
      )}

      {!loading && loadError && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
          <p className="text-sm text-foreground">Couldn't reach AIMS right now.</p>
          <Button variant="outline" size="sm" onClick={loadCourses} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </Button>
        </div>
      )}

      {!loading && !loadError && courses.length > 0 && (
        <div className="space-y-2">
          <Label>Select a course</Label>
          {scope === "school" && (
            <p className="text-xs text-muted-foreground">
              Couldn't match your courses by email — showing all current school-year courses.
            </p>
          )}
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1" role="radiogroup" aria-label="AIMS courses">
            {courses.map((c) => {
              const selected = selectedId === c.id;
              const chips = mismatchChips(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={c.archived}
                  onClick={() => { setSelectedId(c.id); setManualId(""); }}
                  className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                    selected
                      ? "border-[var(--ledger-aims)] bg-[var(--ledger-aims-bg)]"
                      : "border-border hover:bg-accent/50"
                  } ${c.archived ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-[var(--ledger-aims)] bg-[var(--ledger-aims)]" : "border-muted-foreground/40"
                    }`}
                  >
                    {selected && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground truncate">
                      {c.code} — {c.name}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {c.subject} · {c.sectionName} · {c.schoolYear}
                      {c.gradeLevel ? ` · ${c.gradeLevel}` : ""}
                      {c.teacherName !== undefined ? ` · ${c.teacherName ?? "Unassigned"}` : ""}
                      {c.studentCount !== undefined ? ` · ${c.studentCount} learners` : ""}
                    </span>
                    {(c.id === suggestedCourseId || chips.length > 0 || c.archived) && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.id === suggestedCourseId && !c.archived && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--ledger-aims)] text-white">
                            Best match
                          </span>
                        )}
                        {chips.map((chip) => (
                          <span key={chip} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                            {chip}
                          </span>
                        ))}
                        {c.archived && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                            Archived
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !loadError && courses.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No courses available from AIMS. Enter a course ID manually below.
        </p>
      )}

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${manualOpen ? "rotate-180" : ""}`} />
          Enter AIMS Course ID manually
        </button>
        {manualOpen && (
          <div className="space-y-1.5">
            <Label htmlFor="aims-course-id" className="text-xs">AIMS Course ID</Label>
            <Input
              id="aims-course-id"
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              value={manualId}
              onChange={(e) => { setManualId(e.target.value); setSelectedId(""); }}
            />
            <p className="text-[11px] text-muted-foreground">
              Copy the course ID from the AIMS course URL.
            </p>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleLink} disabled={linking || (!selectedId && !manualId.trim())} className="gap-1.5">
          {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          Connect
        </Button>
      </DialogFooter>
    </>
  );
}
