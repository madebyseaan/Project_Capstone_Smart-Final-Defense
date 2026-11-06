import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Loader2,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/data-table/DataTable";
import { usePagination } from "@/components/data-table/usePagination";
import type { TableColumn } from "@/components/data-table/types";
import { StatCard } from "@/components/layout/StatCard";
import type {
  EosyFinalizationOverview,
  EosyFinalizationSectionStatus,
  EosySectionState,
} from "@/lib/eosyTypes";

interface EOSYFinalizationStatusPanelProps {
  overview: EosyFinalizationOverview | null;
  loading: boolean;
  error: string | null;
  yearLabel: string;
  onRefresh: () => void;
  onOpenSection: (section: EosyFinalizationSectionStatus) => void;
  canOpenSection: (section: EosyFinalizationSectionStatus) => boolean;
}

const STATE_CONFIG: Record<
  EosySectionState,
  { label: string; className: string }
> = {
  FINALIZED: {
    label: "Finalized",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  PARTIAL: {
    label: "In progress",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  NOT_STARTED: {
    label: "Not started",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  EMPTY: {
    label: "No learners",
    className: "bg-muted text-muted-foreground border-border",
  },
};

type StatusFilter =
  | "all"
  | "needs_attention"
  | "finalized"
  | "not_started"
  | "partial"
  | "empty"
  | "snapshot_gap";

function gradeLevelLabel(value: string): string {
  return value.replace(/^GRADE_/, "Grade ");
}

function needsAttention(section: EosyFinalizationSectionStatus): boolean {
  return !section.finalized || section.snapshotGap;
}

export default function EOSYFinalizationStatusPanel({
  overview,
  loading,
  error,
  yearLabel,
  onRefresh,
  onOpenSection,
  canOpenSection,
}: EOSYFinalizationStatusPanelProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [gradeFilter, setGradeFilter] = useState("all");

  const sections = useMemo(() => overview?.sections ?? [], [overview]);
  const gradeOptions = useMemo(
    () =>
      Array.from(new Set(sections.map((section) => section.gradeLevel))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [sections],
  );

  const filteredSections = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sections
      .filter((section) => {
        if (gradeFilter !== "all" && section.gradeLevel !== gradeFilter) return false;
        if (statusFilter === "needs_attention" && !needsAttention(section)) return false;
        if (statusFilter === "finalized" && !section.finalized) return false;
        if (statusFilter === "not_started" && section.state !== "NOT_STARTED") return false;
        if (statusFilter === "partial" && section.state !== "PARTIAL") return false;
        if (statusFilter === "empty" && section.state !== "EMPTY") return false;
        if (statusFilter === "snapshot_gap" && !section.snapshotGap) return false;
        if (!query) return true;
        return [section.sectionName, section.adviserName, gradeLevelLabel(section.gradeLevel)]
          .filter(Boolean)
          .some((value) => (value as string).toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const aAttention = needsAttention(a) ? 0 : 1;
        const bAttention = needsAttention(b) ? 0 : 1;
        if (aAttention !== bAttention) return aAttention - bAttention;
        const grade = a.gradeLevel.localeCompare(b.gradeLevel);
        return grade !== 0 ? grade : a.sectionName.localeCompare(b.sectionName);
      });
  }, [sections, search, statusFilter, gradeFilter]);

  const pagination = usePagination({
    totalRows: filteredSections.length,
    initialRowsPerPage: 25,
  });

  const updateSearch = (value: string) => {
    setSearch(value);
    pagination.setPage(1);
  };

  const updateStatusFilter = (value: string | null) => {
    setStatusFilter((value ?? "all") as StatusFilter);
    pagination.setPage(1);
  };

  const updateGradeFilter = (value: string | null) => {
    setGradeFilter(value ?? "all");
    pagination.setPage(1);
  };

  const summary = overview?.summary;
  const stillNeedsWork = (summary?.partialSections ?? 0) + (summary?.notStartedSections ?? 0);
  const bannerSections = sections.filter((section) => !section.finalized).slice(0, 5);

  const columns: TableColumn<EosyFinalizationSectionStatus>[] = [
    {
      key: "section",
      header: "Section",
      skeleton: "name",
      cell: (section) => (
        <div data-testid="eosy-status-section">
          <p className="font-semibold text-foreground">{section.sectionName}</p>
          <p className="text-xs text-muted-foreground">
            {gradeLevelLabel(section.gradeLevel)}
            {section.program ? ` · ${section.program}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "adviser",
      header: "Adviser",
      skeleton: "name",
      cell: (section) => (
        <span className="text-sm text-foreground">{section.adviserName ?? "—"}</span>
      ),
    },
    {
      key: "learners",
      header: "Learners",
      skeleton: "number",
      align: "center",
      cell: (section) => (
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">{section.enrollmentCount}</p>
          <p className="text-[11px] text-muted-foreground">
            {section.withStoredStatus} promoted saved
          </p>
        </div>
      ),
    },
    {
      key: "drafts",
      header: "Draft Blockers",
      skeleton: "badge",
      align: "center",
      cell: (section) =>
        section.draftBlockerCount > 0 ? (
          <Badge className="border-amber-200 bg-amber-50 text-amber-700">
            {section.draftBlockerCount}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      skeleton: "badge",
      cell: (section) => {
        const config = STATE_CONFIG[section.state];
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={config.className}>{config.label}</Badge>
            {section.snapshotGap && (
              <Badge className="border-rose-200 bg-rose-50 text-rose-700">
                Missing snapshots
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (section) => {
        const enabled = canOpenSection(section);
        return (
          <Button
            variant="outline"
            size="sm"
            disabled={!enabled}
            title={enabled ? undefined : "This section is not available in EnrollPro."}
            aria-label={`Open ${section.sectionName}`}
            data-testid="eosy-status-open"
            onClick={(event) => {
              event.stopPropagation();
              if (enabled) onOpenSection(section);
            }}
          >
            Open
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-4" data-testid="eosy-finalization-status">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              EOSY Finalization Status
            </h2>
            <p className="text-sm text-muted-foreground">
              {yearLabel
                ? `Every SMART section for ${yearLabel} — check at a glance for missed sections.`
                : "Select a school year to check every section."}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading || !yearLabel}
          data-testid="eosy-status-refresh"
        >
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="eosy-status-summary">
          <StatCard
            label="Sections"
            value={summary.totalSections}
            numericValue={summary.totalSections}
            icon={<Users className="h-5 w-5 text-primary" />}
            iconClassName="bg-primary/10"
          />
          <StatCard
            label="Finalized"
            value={summary.finalizedSections}
            numericValue={summary.finalizedSections}
            icon={<CheckCircle2 className="h-5 w-5 text-primary" />}
            iconClassName="bg-primary/10"
          />
          <StatCard
            label="Still Needs Work"
            value={stillNeedsWork}
            numericValue={stillNeedsWork}
            icon={<AlertTriangle className="h-5 w-5 text-primary" />}
            iconClassName="bg-primary/10"
          />
          <StatCard
            label="Snapshot Gaps"
            value={summary.snapshotGapSections}
            numericValue={summary.snapshotGapSections}
            icon={<FileWarning className="h-5 w-5 text-primary" />}
            iconClassName="bg-primary/10"
          />
        </div>
      )}

      {overview?.yearStatus === "ARCHIVED" && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3">
          <Archive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            This school year is archived. Status is shown for review only.
          </p>
        </div>
      )}

      {!loading && !error && summary && summary.totalSections > 0 && (
        <div data-testid="eosy-status-banner">
          {summary.readyForRollover ? (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">
                  All sections are finalized — nothing missed.
                </p>
                <p className="text-xs text-emerald-700">
                  {summary.finalizedSections} finalized
                  {summary.emptySections > 0
                    ? ` · ${summary.emptySections} with no learners`
                    : ""}
                  {summary.snapshotGapSections === 0 ? " · snapshots complete" : ""}
                </p>
              </div>
            </div>
          ) : summary.allPromotionsFinalized ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {summary.snapshotGapSections} section
                  {summary.snapshotGapSections === 1 ? "" : "s"} missing EOSY snapshots.
                </p>
                <p className="text-xs text-amber-700">
                  Promotion statuses are saved, but rollover will stay blocked until the snapshot gaps are resolved.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {summary.partialSections + summary.notStartedSections} section
                  {summary.partialSections + summary.notStartedSections === 1 ? "" : "s"} still{" "}
                  {summary.partialSections + summary.notStartedSections === 1 ? "needs" : "need"}{" "}
                  finalization.
                </p>
                <p className="text-xs text-amber-700">
                  {bannerSections.map((section) => section.sectionName).join(", ")}
                  {sections.filter((section) => !section.finalized).length > bannerSections.length
                    ? ` and ${
                        sections.filter((section) => !section.finalized).length -
                        bannerSections.length
                      } more`
                    : ""}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={filteredSections}
        loading={loading}
        error={error}
        title="Section Status"
        description="Status is from SMART records; section detail uses EnrollPro records."
        emptyTitle={
          sections.length === 0
            ? "No SMART sections for this school year"
            : "No sections match these filters"
        }
        emptyHint={
          sections.length === 0
            ? "Sync the school year from EnrollPro, then refresh this board."
            : "Try clearing the search or changing the filters."
        }
        emptySearchTerm={search}
        rowKey={(section) => section.sectionId}
        onRowClick={(section) => {
          if (canOpenSection(section)) onOpenSection(section);
        }}
        onRetry={onRefresh}
        pagination={pagination}
        toolbar={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-52">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                placeholder="Search section or adviser"
                aria-label="Search sections"
                data-testid="eosy-status-search"
                className="h-9 pl-9 text-sm"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={updateStatusFilter}
            >
              <SelectTrigger
                className="h-9 w-full sm:w-44"
                aria-label="Filter by finalization status"
                data-testid="eosy-status-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="needs_attention">Needs attention</SelectItem>
                <SelectItem value="finalized">Finalized</SelectItem>
                <SelectItem value="partial">In progress</SelectItem>
                <SelectItem value="not_started">Not started</SelectItem>
                <SelectItem value="empty">No learners</SelectItem>
                <SelectItem value="snapshot_gap">Snapshot gaps</SelectItem>
              </SelectContent>
            </Select>
            <Select value={gradeFilter} onValueChange={updateGradeFilter}>
              <SelectTrigger
                className="h-9 w-full sm:w-36"
                aria-label="Filter by grade level"
                data-testid="eosy-status-grade-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All grades</SelectItem>
                {gradeOptions.map((gradeLevel) => (
                  <SelectItem key={gradeLevel} value={gradeLevel}>
                    {gradeLevelLabel(gradeLevel)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
    </div>
  );
}
