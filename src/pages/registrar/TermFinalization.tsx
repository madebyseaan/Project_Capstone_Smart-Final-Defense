import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  BookOpen,
  Clock,
  FileCheck2,
  FileEdit,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { publicSettingsApi, registrarApi } from "@/lib/api";
import type {
  TermFinalizationOverview,
  TermFinalizationSection,
  TermFinalizationSubject,
  TermName,
} from "@/lib/termFinalizationTypes";
import { toast } from "@/lib/toast";
import TermFinalizationSectionCard from "./components/TermFinalizationSectionCard";
import TermGradesPreviewModal from "./components/TermGradesPreviewModal";

const TERM_OPTIONS: TermName[] = ["T1", "T2", "T3"];

interface PendingAction {
  kind: "finalize" | "unfinalize";
  scope: "section" | "subject";
  section: TermFinalizationSection;
  subject?: TermFinalizationSubject;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function deadlinePassed(value: string | null): boolean {
  if (!value) return false;
  return new Date(value).getTime() < Date.now();
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return "The request could not be completed. Please try again.";
}

function subjectIdsFor(action: PendingAction): string[] | undefined {
  return action.scope === "subject" ? action.subject?.subjectIds : undefined;
}

function actionCount(action: PendingAction): number {
  if (action.scope === "section") {
    return action.kind === "finalize" ? action.section.draftCount : action.section.finalizedCount;
  }
  if (!action.subject) return 0;
  return action.kind === "finalize" ? action.subject.draft : action.subject.finalized;
}

function actionDescription(action: PendingAction, term: TermName, deadline: string | null): string {
  const count = actionCount(action);
  const sectionName = action.section.sectionName;
  const scope =
    action.scope === "section"
      ? `every subject in ${sectionName}`
      : `${action.subject?.subjectName ?? "the selected subject"} in ${sectionName}`;

  if (action.kind === "finalize") {
    const parts = [
      `This will mark ${count} DRAFT grade${count === 1 ? "" : "s"} as FINALIZED for ${scope} (${term}).`,
    ];
    if (action.section.noGradeSubjects > 0 && action.scope === "section") {
      parts.push(
        `${action.section.noGradeSubjects} subject${action.section.noGradeSubjects === 1 ? "" : "s"} without grades will not be finalized.`,
      );
    }
    if (deadline && !deadlinePassed(deadline)) {
      parts.push(
        `The ${term} deadline is ${formatDate(deadline)}; finalizing early will lock teacher edits.`,
      );
    }
    if (action.section.eosyStarted && !action.section.eosyFinalized) {
      parts.push(
        "EOSY has partial promotion data for this section; re-run EOSY after finalizing.",
      );
    }
    return parts.join(" ");
  }

  const parts = [
    `This will return ${count} FINALIZED grade${count === 1 ? "" : "s"} to DRAFT for ${scope} (${term}).`,
    "If the term is locked, teachers still need an approved edit request or an admin unlock before they can edit.",
  ];
  if (action.section.eosyStarted && !action.section.eosyFinalized) {
    parts.push("EOSY has partial promotion data for this section; re-run EOSY after unfinalizing.");
  }
  return parts.join(" ");
}

export default function TermFinalization() {
  const [searchParams] = useSearchParams();
  const initialSectionId = useRef(searchParams.get("sectionId") ?? "");

  const [schoolYears, setSchoolYears] = useState<string[]>([]);
  const [selectedSchoolYear, setSelectedSchoolYear] = useState(
    searchParams.get("schoolYear") ?? "",
  );
  const [selectedTerm, setSelectedTerm] = useState<TermName | "">(
    (searchParams.get("term") as TermName | null) ?? "",
  );
  const [overview, setOverview] = useState<TermFinalizationOverview | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [loadingYears, setLoadingYears] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [gradePreviewSection, setGradePreviewSection] =
    useState<TermFinalizationSection | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadMetadata = async () => {
      setLoadingYears(true);
      try {
        const [yearsRes, settingsRes] = await Promise.all([
          registrarApi.getSchoolYears(),
          publicSettingsApi.getSettings(),
        ]);
        if (cancelled) return;

        const years = yearsRes.data.schoolYears ?? [];
        const activeYear = yearsRes.data.activeSchoolYear ?? years[0] ?? "";
        const currentTerm = settingsRes.data.settings.currentTerm as TermName | undefined;

        setSchoolYears(years);
        setSelectedSchoolYear((current) => current || activeYear);
        setSelectedTerm((current) => current || currentTerm || "T1");
      } catch {
        if (!cancelled) {
          setError("Failed to load school years and term settings.");
        }
      } finally {
        if (!cancelled) setLoadingYears(false);
      }
    };

    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSchoolYear || !selectedTerm) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPendingAction(null);
    setGradePreviewSection(null);

    registrarApi
      .getTermFinalization({ schoolYear: selectedSchoolYear, term: selectedTerm })
      .then((res) => {
        if (cancelled) return;
        setOverview(res.data);
        const target = initialSectionId.current;
        if (target && res.data.sections.some((section) => section.sectionId === target)) {
          setExpandedSections((prev) => ({ ...prev, [target]: true }));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setOverview(null);
          setError(extractErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSchoolYear, selectedTerm, refreshKey]);

  const filteredSections = useMemo(() => {
    const sections = overview?.sections ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return sections;
    return sections.filter((section) =>
      [section.sectionName, section.gradeLevel, section.adviserName, section.program]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(query)),
    );
  }, [overview, search]);

  const yearArchived = overview?.yearStatus === "ARCHIVED" || overview?.canFinalize === false;
  const deadline = overview?.deadline ?? null;
  const isDeadlinePassed = deadlinePassed(deadline);
  const lockActive = !!overview?.yearLock?.isLocked || !!overview?.termLock?.isLocked;

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const startSectionAction = (
    kind: PendingAction["kind"],
    section: TermFinalizationSection,
  ) => {
    setPendingAction({ kind, scope: "section", section });
  };

  const startSubjectAction = (
    kind: PendingAction["kind"],
    section: TermFinalizationSection,
    subject: TermFinalizationSubject,
  ) => {
    setPendingAction({ kind, scope: "subject", section, subject });
  };

  const runAction = async (action: PendingAction) => {
    if (!selectedTerm || !selectedSchoolYear) return;
    const subjectIds = subjectIdsFor(action);
    const key =
      action.scope === "section"
        ? `${action.section.sectionId}:section`
        : `${action.section.sectionId}:subject:${subjectIds?.join(",") ?? ""}`;

    setBusyKey(key);
    try {
      const payload = {
        sectionId: action.section.sectionId,
        term: selectedTerm,
        schoolYear: selectedSchoolYear,
        ...(subjectIds && subjectIds.length > 0 ? { subjectIds } : {}),
      };
      const res =
        action.kind === "finalize"
          ? await registrarApi.finalizeTerm(payload)
          : await registrarApi.unfinalizeTerm(payload);

      toast.success(res.data.message);
      if (res.data.warning) toast.warning(res.data.warning);
      setPendingAction(null);
      setRefreshKey((value) => value + 1);
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  };

  const confirmCopy = (() => {
    if (!pendingAction) {
      return { title: "", description: "", confirmLabel: "Confirm" };
    }
    const verb = pendingAction.kind === "finalize" ? "Finalize" : "Unfinalize";
    const scope =
      pendingAction.scope === "section"
        ? pendingAction.section.sectionName
        : pendingAction.subject?.subjectName ?? pendingAction.section.sectionName;
    return {
      title: `${verb} ${selectedTerm} grades for ${scope}?`,
      description: selectedTerm
        ? actionDescription(pendingAction, selectedTerm, deadline)
        : "",
      confirmLabel: pendingAction.kind === "finalize" ? "Finalize grades" : "Unfinalize grades",
    };
  })();

  const lockProvenance = overview?.yearLock?.isLocked
    ? `${overview.yearLock.lockedBy ?? "System"}${overview.yearLock.lockedAt ? ` · ${formatDateTime(overview.yearLock.lockedAt)}` : ""}`
    : overview?.termLock?.isLocked
      ? `${overview.termLock.lockedBy ?? "System"}${overview.termLock.lockedAt ? ` · ${formatDateTime(overview.termLock.lockedAt)}` : ""}`
      : "";

  return (
    <div className="space-y-6" data-testid="term-finalization-page">
      <PageHeader
        title="Term Finalization"
        description="Finalize grades at the end of each term. Term locks stay separate; EOSY promotion finalization remains on the EOSY page."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading || loadingYears}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <Card className="border border-border bg-card shadow-sm rounded-xl p-0">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-[560px]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="term-finalization-year">
                  School Year
                </label>
                <Select
                  value={selectedSchoolYear}
                  onValueChange={(value) => value && setSelectedSchoolYear(value)}
                >
                  <SelectTrigger id="term-finalization-year" className="h-9 w-full" aria-label="School Year">
                    <SelectValue placeholder="School Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {schoolYears.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="term-finalization-term">
                  Term
                </label>
                <Select
                  value={selectedTerm}
                  onValueChange={(value) => setSelectedTerm(value as TermName)}
                >
                  <SelectTrigger id="term-finalization-term" className="h-9 w-full" aria-label="Term">
                    <SelectValue placeholder="Term" />
                  </SelectTrigger>
                  <SelectContent>
                    {TERM_OPTIONS.map((term) => (
                      <SelectItem key={term} value={term}>
                        {term}
                        {overview?.currentTerm === term ? " (Current)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:justify-end">
              {deadline && (
                <Badge
                  variant="outline"
                  className={`h-9 gap-1.5 px-3 text-xs font-medium ${
                    isDeadlinePassed
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Deadline {formatDate(deadline)}
                  {isDeadlinePassed ? " · passed" : " · upcoming"}
                </Badge>
              )}
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search section, adviser, or grade level"
                  aria-label="Search sections"
                  className="h-9 pl-9 text-sm"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {overview && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Sections"
            value={overview.summary.sections}
            numericValue={overview.summary.sections}
            icon={<Users className="h-5 w-5 text-primary" />}
            iconClassName="bg-primary/10"
          />
          <StatCard
            label="Finalized Sections"
            value={overview.summary.sectionsFinalized}
            numericValue={overview.summary.sectionsFinalized}
            icon={<FileCheck2 className="h-5 w-5 text-primary" />}
            iconClassName="bg-primary/10"
          />
          <StatCard
            label="Draft Grades"
            value={overview.summary.totalDraftGrades}
            numericValue={overview.summary.totalDraftGrades}
            icon={<FileEdit className="h-5 w-5 text-primary" />}
            iconClassName="bg-primary/10"
          />
          <StatCard
            label="Subjects Without Grades"
            value={overview.summary.noGradeSubjects}
            numericValue={overview.summary.noGradeSubjects}
            icon={<AlertTriangle className="h-5 w-5 text-primary" />}
            iconClassName="bg-primary/10"
          />
        </div>
      )}

      {yearArchived && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <Archive className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground">This school year is archived</p>
            <p className="text-xs text-muted-foreground">
              Finalization is read-only. Unarchive the year or select a different school year to make changes.
            </p>
          </div>
        </div>
      )}

      {!yearArchived && lockActive && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {overview?.yearLock?.isLocked ? "The whole school year is locked" : "This term is locked"}
            </p>
            <p className="text-xs text-amber-800">
              {lockProvenance ? `${lockProvenance}. ` : ""}
              You can still finalize grades after the deadline. Unfinalizing does not reopen teacher
              editing while the lock is active — teachers need an approved edit request or an admin unlock.
            </p>
          </div>
        </div>
      )}

      {loading || loadingYears ? (
        <Card className="border border-border bg-card shadow-sm rounded-xl p-0">
          <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading term finalization status...</span>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border border-border bg-card shadow-sm rounded-xl p-0">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
            <p className="text-sm font-semibold text-foreground">Unable to load term finalization</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setRefreshKey((value) => value + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : filteredSections.length === 0 ? (
        <Card className="border border-border bg-card shadow-sm rounded-xl p-0">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="mb-3 h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">No sections found</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {search.trim()
                ? "No sections match your search."
                : "No sections were found for this school year."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-sm font-medium text-foreground">
              {filteredSections.length} section{filteredSections.length === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-muted-foreground">
              {overview?.summary.totalSubjects ?? 0} subjects ·{" "}
              {overview?.summary.finalizedSubjects ?? 0} finalized
            </p>
          </div>
          {filteredSections.map((section) => (
            <TermFinalizationSectionCard
              key={section.sectionId}
              section={section}
              expanded={!!expandedSections[section.sectionId]}
              yearArchived={yearArchived}
              busyKey={busyKey}
              onToggle={() => toggleSection(section.sectionId)}
              onViewGrades={() => setGradePreviewSection(section)}
              onFinalizeSection={() => startSectionAction("finalize", section)}
              onUnfinalizeSection={() => startSectionAction("unfinalize", section)}
              onFinalizeSubject={(subject) => startSubjectAction("finalize", section, subject)}
              onUnfinalizeSubject={(subject) => startSubjectAction("unfinalize", section, subject)}
            />
          ))}
        </div>
      )}

      {selectedTerm && (
        <TermGradesPreviewModal
          open={!!gradePreviewSection}
          onOpenChange={(open) => {
            if (!open) setGradePreviewSection(null);
          }}
          section={gradePreviewSection}
          term={selectedTerm}
          schoolYear={selectedSchoolYear}
        />
      )}

      <ConfirmDialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open && !busyKey) setPendingAction(null);
        }}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        destructive={pendingAction?.kind === "unfinalize"}
        loading={!!busyKey}
        onConfirm={() => {
          if (pendingAction) void runAction(pendingAction);
        }}
      />
    </div>
  );
}
