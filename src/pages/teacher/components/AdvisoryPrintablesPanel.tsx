import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckSquare,
  FileText,
  Loader2,
  Printer,
  Search,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/contexts/ThemeContext";
import {
  advisoryApi,
  publicSettingsApi,
  SERVER_URL,
  type Sf9BatchResponse,
  type Sf9Payload,
  type Sf9Term,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { printForm } from "@/lib/printForm";
import SF9Form from "@/components/forms/sf9/SF9Form";
import TermCardForm from "@/components/forms/sf9/TermCardForm";
import TermPills from "@/components/forms/sf9/TermPills";

type PrintMode = "sf9" | "term";

export default function AdvisoryPrintablesPanel() {
  const { logoUrl } = useTheme();
  const [mode, setMode] = useState<PrintMode>("sf9");
  const [term, setTerm] = useState<Sf9Term>("T1");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const termInitializedRef = useRef(false);

  const fullLogoUrl = logoUrl
    ? logoUrl.startsWith("http")
      ? logoUrl
      : `${SERVER_URL}${logoUrl}`
    : null;

  const settingsQuery = useQuery({
    queryKey: ["public-settings", "printables"],
    queryFn: async () => (await publicSettingsApi.getSettings()).data,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (termInitializedRef.current) return;
    const currentTerm = settingsQuery.data?.settings.currentTerm;
    if (currentTerm === "T1" || currentTerm === "T2" || currentTerm === "T3") {
      setTerm(currentTerm);
      termInitializedRef.current = true;
    }
  }, [settingsQuery.data]);

  const printablesQuery = useQuery({
    queryKey: ["advisory", "printables", mode, mode === "term" ? term : "full-year"],
    queryFn: async () =>
      (
        await advisoryApi.getSf9Section(mode === "term" ? { term } : undefined)
      ).data,
    staleTime: 60_000,
    retry: 0,
  });

  useEffect(() => {
    setSelectedIds(new Set());
    setPreviewId(null);
  }, [mode, term]);

  const data: Sf9BatchResponse | undefined = printablesQuery.data;

  const termLabels = settingsQuery.data?.termLabels;

  const filteredStudents = useMemo(() => {
    const students = data?.students ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return students;
    return students.filter((student) => {
      const name = student.student.name.toLowerCase();
      const lrn = student.student.lrn.toLowerCase();
      return name.includes(query) || lrn.includes(query);
    });
  }, [data?.students, search]);

  const filteredIds = filteredStudents.map((student) => student.student.id);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  const selectedStudents = useMemo(
    () => (data?.students ?? []).filter((student) => selectedIds.has(student.student.id)),
    [data?.students, selectedIds],
  );

  const previewStudent: Sf9Payload | undefined =
    (data?.students ?? []).find((student) => student.student.id === previewId) ??
    selectedStudents[0] ??
    filteredStudents[0] ??
    data?.students[0];

  const toggleStudent = (studentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  };

  const handlePrintSelected = () => {
    if (!printRef.current || selectedStudents.length === 0) return;
    printForm(printRef.current, {
      styleId: "advisory-print-style",
      extraCss: `
        .sf-print-container .term-card-watermark { font-size: 46pt !important; line-height: 1.1 !important; }
        .print-form-term-card { page-break-after: always !important; }
      `,
    });
  };

  const termLabel = (value: Sf9Term) =>
    termLabels?.[value] ?? `Term ${value.slice(1)}`;

  return (
    <div className="space-y-4" data-testid="print-center">
      <div>
        <h2 className="text-base font-semibold text-foreground">Printables</h2>
        <p className="text-sm text-muted-foreground">
          Print the official SF9 or a temporary term card for your advisory learners.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border p-4 lg:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                data-testid="print-mode-sf9"
                variant={mode === "sf9" ? "default" : "outline"}
                aria-pressed={mode === "sf9"}
                onClick={() => setMode("sf9")}
                className="h-11 gap-2 text-xs font-semibold"
              >
                <FileText className="h-4 w-4" />
                Official SF9
              </Button>
              <Button
                type="button"
                data-testid="print-mode-term"
                variant={mode === "term" ? "default" : "outline"}
                aria-pressed={mode === "term"}
                onClick={() => setMode("term")}
                className="h-11 gap-2 text-xs font-semibold"
              >
                <CheckSquare className="h-4 w-4" />
                Temporary Term Card
              </Button>
            </div>

            {mode === "term" && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Term
                </span>
                <TermPills
                  value={term}
                  onChange={setTerm}
                  labels={{ T1: termLabel("T1"), T2: termLabel("T2"), T3: termLabel("T3") }}
                  testIdPrefix="term-pill"
                  ariaLabel="Select term"
                  size="md"
                />
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {printablesQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading advisory printables…
            </div>
          ) : printablesQuery.isError ? (
            <div className="px-4 py-20 text-center">
              <p className="text-sm font-semibold text-foreground">Unable to load advisory printables</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Please refresh the page or contact the system administrator.
              </p>
            </div>
          ) : !data || data.students.length === 0 ? (
            <div className="px-4 py-20 text-center">
              <p className="text-sm font-semibold text-foreground">No advisory learners found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Students appear here after the advisory roster is synced.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
              <div className="border-b border-border 2xl:border-b-0 2xl:border-r">
                <div className="flex flex-col gap-3 border-b border-border p-4">
                  <div className="relative">
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

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      data-testid="select-all"
                      onClick={toggleAll}
                      className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {allFilteredSelected ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                      {allFilteredSelected ? "Clear all" : "Select all"}
                    </button>
                    <Button
                      type="button"
                      data-testid="print-selected"
                      onClick={handlePrintSelected}
                      disabled={selectedStudents.length === 0}
                      className="h-11 gap-2 text-xs font-semibold"
                    >
                      <Printer className="h-4 w-4" />
                      Print selected ({selectedStudents.length})
                    </Button>
                  </div>
                </div>

                <div className="max-h-[65vh] divide-y divide-border overflow-y-auto">
                  {filteredStudents.length === 0 ? (
                    <p className="px-4 py-12 text-center text-xs text-muted-foreground">
                      No matching learners.
                    </p>
                  ) : (
                    filteredStudents.map((student) => {
                      const isSelected = selectedIds.has(student.student.id);
                      const status =
                        student.meta.mode === "TERM_CARD" ? student.meta.termStatus : null;
                      return (
                        <div
                          key={student.student.id}
                          data-testid="student-row"
                          className={cn(
                            "flex min-h-16 items-center gap-3 px-4 py-3 transition-colors",
                            isSelected ? "bg-primary/5" : "hover:bg-muted/40",
                          )}
                        >
                          <label className="-m-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center p-2">
                            <Checkbox
                              data-testid="student-checkbox"
                              checked={isSelected}
                              onChange={() => toggleStudent(student.student.id)}
                              aria-label={`Select ${student.student.name}`}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setPreviewId(student.student.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-sm font-semibold text-foreground">
                              {student.student.name}
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                              {student.student.lrn}
                            </p>
                          </button>
                          {status && (
                            <Badge
                              variant="secondary"
                              data-testid="term-status-badge"
                              className={cn(
                                "shrink-0 border-0 text-[10px] font-semibold uppercase",
                                status === "FINAL"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-700",
                              )}
                            >
                              {status}
                            </Badge>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="min-w-0 p-4" data-testid="preview-pane">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Preview</h2>
                    <p className="text-xs text-muted-foreground">
                      {previewStudent
                        ? `${previewStudent.student.name} · ${previewStudent.student.lrn}`
                        : "Select a learner to preview"}
                    </p>
                  </div>
                  {previewStudent?.meta.mode === "TERM_CARD" && (
                    <Badge variant="outline" className="text-[10px] font-semibold uppercase">
                      {previewStudent.meta.termStatus}
                    </Badge>
                  )}
                </div>

                <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-white p-2">
                  {previewStudent ? (
                    <div className="min-w-[820px]">
                      {"subjectGrades" in previewStudent ? (
                        <SF9Form data={previewStudent} fullLogoUrl={fullLogoUrl} />
                      ) : (
                        <TermCardForm data={previewStudent} fullLogoUrl={fullLogoUrl} />
                      )}
                    </div>
                  ) : (
                    <p className="py-16 text-center text-xs text-muted-foreground">
                      No learner selected.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="pointer-events-none fixed left-[-10000px] top-0 w-[210mm]" aria-hidden="true">
        <div ref={printRef}>
          {selectedStudents.map((student) =>
            "subjectGrades" in student ? (
              <SF9Form
                key={`sf9-${student.student.id}`}
                data={student}
                fullLogoUrl={fullLogoUrl}
              />
            ) : (
              <TermCardForm
                key={`term-${student.student.id}`}
                data={student}
                fullLogoUrl={fullLogoUrl}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
