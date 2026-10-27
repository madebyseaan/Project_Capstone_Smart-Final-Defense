import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Lock,
  Pencil,
  Search,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import TermPills from "@/components/forms/sf9/TermPills";
import {
  advisoryApi,
  publicSettingsApi,
  type AdvisoryObservedValuesData,
  type ObservedValueRating,
  type ObservedValueStudent,
  type Sf9Term,
} from "@/lib/api";
import { cn, getErrorMessage } from "@/lib/utils";

const FALLBACK_RATINGS: ObservedValueRating[] = ["AO", "SO", "RO", "NO"];

const RATING_ACTIVE_CLASS: Record<ObservedValueRating, string> = {
  AO: "border-emerald-600 bg-emerald-600 text-white",
  SO: "border-sky-600 bg-sky-600 text-white",
  RO: "border-amber-500 bg-amber-500 text-white",
  NO: "border-rose-600 bg-rose-600 text-white",
};

export default function AdvisoryObservedValuesPanel() {
  const [term, setTerm] = useState<Sf9Term>("T1");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, ObservedValueRating>>({});
  const [saving, setSaving] = useState(false);
  const termInitializedRef = useRef(false);
  const termTouchedRef = useRef(false);

  const settingsQuery = useQuery({
    queryKey: ["public-settings", "observed-values"],
    queryFn: async () => (await publicSettingsApi.getSettings()).data,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (termInitializedRef.current || termTouchedRef.current) return;
    const currentTerm = settingsQuery.data?.settings.currentTerm;
    if (currentTerm === "T1" || currentTerm === "T2" || currentTerm === "T3") {
      setTerm(currentTerm);
      termInitializedRef.current = true;
    }
  }, [settingsQuery.data]);

  const query = useQuery({
    queryKey: ["advisory", "observed-values", term],
    queryFn: async () => (await advisoryApi.getObservedValues({ term })).data,
    staleTime: 30_000,
    retry: 0,
  });

  const data: AdvisoryObservedValuesData | undefined = query.data;
  const groups = data?.groups ?? [];
  const ratings = data?.ratings?.length ? data.ratings : FALLBACK_RATINGS;
  const totalCount = groups.reduce((count, group) => count + group.behaviors.length, 0);

  const students = useMemo(() => {
    const list = data?.students ?? [];
    const term_ = search.trim().toLowerCase();
    if (!term_) return list;
    return list.filter((student) => {
      return (
        student.name.toLowerCase().includes(term_) ||
        student.lrn.toLowerCase().includes(term_)
      );
    });
  }, [data?.students, search]);

  const selectedStudent = data?.students.find((student) => student.id === selectedId);
  const isLocked = data?.isLocked ?? false;

  const completeCount = (data?.students ?? []).filter(
    (student) => student.totalCount > 0 && student.markedCount >= student.totalCount,
  ).length;

  const isDirty = selectedStudent
    ? Object.keys({ ...selectedStudent.ratings, ...draft }).some(
        (code) => selectedStudent.ratings[code] !== draft[code],
      )
    : false;

  const markedCount = Object.keys(draft).length;
  const progressPercent = totalCount > 0 ? Math.round((markedCount / totalCount) * 100) : 0;

  const handleTermChange = (nextTerm: Sf9Term) => {
    termTouchedRef.current = true;
    setTerm(nextTerm);
    setSelectedId(null);
    setEditorOpen(false);
    setDraft({});
  };

  const openEditor = (student: ObservedValueStudent) => {
    setSelectedId(student.id);
    setDraft({ ...student.ratings });
    setEditorOpen(true);
  };

  const handleEditorOpenChange = (open: boolean) => {
    if (saving) return;
    setEditorOpen(open);
    if (!open) {
      setSelectedId(null);
      setDraft({});
    }
  };

  const setRating = (behaviorCode: string, rating: ObservedValueRating) => {
    setDraft((previous) => {
      const next = { ...previous };
      if (next[behaviorCode] === rating) delete next[behaviorCode];
      else next[behaviorCode] = rating;
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedStudent || isLocked) return;
    setSaving(true);
    try {
      await advisoryApi.saveObservedValues(selectedStudent.id, {
        term,
        values: Object.entries(draft).map(([behaviorCode, rating]) => ({
          behaviorCode,
          rating,
        })),
      });
      toast.success(`Observed values saved for ${selectedStudent.name}`);
      setEditorOpen(false);
      setSelectedId(null);
      setDraft({});
      await query.refetch();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to save observed values"));
    } finally {
      setSaving(false);
    }
  };

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading observed values…
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card className="rounded-2xl border-border">
        <CardContent className="px-4 py-20 text-center">
          <p className="text-sm font-semibold text-foreground">Unable to load observed values</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page or contact the system administrator.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="observed-values-panel">
      <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border p-4 lg:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Observed Values</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Mark the learner&apos;s observed values for {data?.termLabel ?? `Term ${term.slice(1)}`}.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Term
                </span>
                <TermPills value={term} onChange={handleTermChange} size="md" />
              </div>
              {isLocked && (
                <Badge variant="secondary" className="gap-1 bg-amber-50 text-amber-700">
                  <Lock className="h-3 w-3" />
                  Read-only
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name or LRN"
                aria-label="Search advisory learners"
                className="h-11 pl-9"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>
                {completeCount} of {data?.students.length ?? 0} learners complete
              </span>
            </div>
          </div>

          {isLocked && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              This school year is archived. Observed values are read-only.
            </div>
          )}

          {students.length === 0 ? (
            <div className="px-4 py-20 text-center">
              <p className="text-sm font-semibold text-foreground">
                {(data?.students.length ?? 0) === 0 ? "No advisory learners found" : "No matching learners"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(data?.students.length ?? 0) === 0
                  ? "Students appear here after the advisory roster is synced."
                  : "Try a different name or LRN."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {students.map((student) => {
                const complete =
                  student.totalCount > 0 && student.markedCount >= student.totalCount;
                const started = student.markedCount > 0;

                return (
                  <div
                    key={student.id}
                    data-testid="observed-value-student-row"
                    className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {student.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {student.lrn}
                      </p>
                    </div>

                    <Badge
                      variant="secondary"
                      className={cn(
                        "shrink-0 gap-1 border-0 text-[10px] font-semibold uppercase",
                        complete
                          ? "bg-emerald-50 text-emerald-700"
                          : started
                            ? "bg-amber-50 text-amber-700"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {complete ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Circle className="h-3 w-3" />
                      )}
                      {student.markedCount}/{student.totalCount || totalCount}
                    </Badge>

                    <Button
                      type="button"
                      size="sm"
                      variant={complete ? "outline" : "default"}
                      data-testid="observed-value-edit"
                      onClick={() => openEditor(student)}
                      className="h-10 shrink-0 gap-2 rounded-xl text-xs font-semibold"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {complete ? "Edit" : started ? "Continue" : "Mark"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={handleEditorOpenChange}>
        <DialogContent
          data-testid="observed-values-dialog"
          showCloseButton={!saving}
          className="flex max-h-[92vh] w-[calc(100%-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogHeader className="border-b border-border bg-card p-4 pr-12">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base font-semibold text-foreground">
                  {selectedStudent?.name ?? "Observed Values"}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                  {data?.termLabel ?? `Term ${term.slice(1)}`} &middot; {markedCount} of {totalCount} marked
                </DialogDescription>
              </div>
              {isDirty && (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700"
                >
                  Unsaved
                </Badge>
              )}
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <span><strong className="font-semibold text-emerald-700">AO</strong> Always</span>
              <span><strong className="font-semibold text-sky-700">SO</strong> Sometimes</span>
              <span><strong className="font-semibold text-amber-700">RO</strong> Rarely</span>
              <span><strong className="font-semibold text-rose-700">NO</strong> Not observed</span>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-muted/20 p-4">
            <div className="space-y-3">
              {groups.map((group) => {
                const groupMarked = group.behaviors.filter((behavior) => draft[behavior.code]).length;
                const groupComplete =
                  group.behaviors.length > 0 && groupMarked >= group.behaviors.length;

                return (
                  <section
                    key={group.coreValue}
                    className="overflow-hidden rounded-2xl border border-border bg-card"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                      <h3 className="text-sm font-semibold text-foreground">{group.coreValue}</h3>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "gap-1 border-0 text-[10px] font-semibold",
                          groupComplete
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {groupComplete && <CheckCircle2 className="h-3 w-3" />}
                        {groupMarked}/{group.behaviors.length}
                      </Badge>
                    </div>

                    <div className="divide-y divide-border">
                      {group.behaviors.map((behavior) => {
                        const selectedRating = draft[behavior.code];
                        return (
                          <div
                            key={behavior.code}
                            className="flex flex-col gap-2.5 px-4 py-3 md:flex-row md:items-center md:justify-between"
                          >
                            <p className="text-sm leading-relaxed text-foreground md:pr-6">
                              {behavior.statement}
                            </p>
                            <div
                              className="grid grid-cols-4 gap-1.5 md:w-[260px] md:shrink-0"
                              role="group"
                              aria-label={`Rating for ${behavior.statement}`}
                            >
                              {ratings.map((rating) => (
                                <button
                                  key={rating}
                                  type="button"
                                  data-testid={`observed-rating-${behavior.code}-${rating}`}
                                  aria-pressed={selectedRating === rating}
                                  disabled={isLocked || saving}
                                  onClick={() => setRating(behavior.code, rating)}
                                  className={cn(
                                    "h-10 rounded-lg border text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                                    selectedRating === rating
                                      ? RATING_ACTIVE_CLASS[rating]
                                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                                  )}
                                >
                                  {rating}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 border-t border-border bg-card p-4">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {markedCount}/{totalCount}
                </span>
                <span className="text-xs text-muted-foreground">marked</span>
              </div>
              <div className="flex gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleEditorOpenChange(false)}
                  disabled={saving}
                  className="h-11 flex-1 rounded-xl px-4 text-xs font-semibold text-muted-foreground hover:text-foreground sm:flex-none"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  data-testid="observed-values-save"
                  onClick={handleSave}
                  disabled={isLocked || saving || !isDirty}
                  className="h-11 flex-1 gap-2 rounded-xl text-xs font-semibold sm:flex-none"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
