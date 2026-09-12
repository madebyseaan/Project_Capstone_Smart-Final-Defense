import { useState, useEffect, useMemo } from "react";
import {
  RefreshCw,
  Users,
  ClipboardList,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  ArrowRight,
  Inbox,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { SearchInput } from "@/components/layout/SearchInput";
import { PageError } from "@/components/layout/PageError";
import { DataTable, TablePagination, usePagination } from "@/components/data-table";
import type { TableColumn } from "@/components/data-table";
import { Dash } from "@/components/data-table/Dash";
import { useTheme } from "@/contexts/ThemeContext";
import { adminApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface SchoolYearOption {
  id: string;
  label: string;
  status: string;
}

interface TeacherOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
}

interface SubjectOption {
  id: string;
  code: string;
  name: string;
}

interface SectionOption {
  id: string;
  name: string;
  gradeLevel: string;
  program?: string;
}

interface ClassAssignmentRow {
  id: string;
  teacherId: string;
  subjectId: string;
  sectionId: string;
  isActive: boolean;
  teachingMinutes?: number | null;
  archivedReason?: string | null;
  source?: string;
  successorTeacherName?: string | null;
  teacher?: {
    employeeId?: string;
    user?: { firstName?: string; lastName?: string };
  };
  subject?: { code?: string; name?: string };
  section?: { name?: string; program?: string; gradeLevel?: string };
}

interface WorkloadRow {
  teacherId: string;
  teacherName: string;
  sectionId: string;
  sectionName: string;
  gradeLevel: string;
  hgMinutes: number;
  advisoryRoleMinutes: number;
  otherSubjectMinutes: number;
  totalMinutes: number;
}

interface AssignmentOptions {
  teachers: TeacherOption[];
  subjects: SubjectOption[];
  sections: SectionOption[];
}

interface TeacherLoad {
  teacherId: string;
  teacherName: string;
  employeeId?: string;
  advisorySections: string[];
  assignments: ClassAssignmentRow[];
  sectionCount: number;
  totalMinutes: number;
}

function gradeLevelLabel(gl?: string) {
  if (!gl) return "—";
  return gl.replace("GRADE_", "Grade ");
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export default function ClassAssignments() {
  const { colors } = useTheme();
  const [schoolYear, setSchoolYear] = useState("");
  const [schoolYears, setSchoolYears] = useState<SchoolYearOption[]>([]);
  const [assignments, setAssignments] = useState<ClassAssignmentRow[]>([]);
  const [workloadSummary, setWorkloadSummary] = useState<WorkloadRow[]>([]);
  const [options, setOptions] = useState<AssignmentOptions>({ teachers: [], subjects: [], sections: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [tab, setTab] = useState("load");
  const [search, setSearch] = useState("");
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    adminApi.getSchoolYears().then((res) => {
      const years = res.data.schoolYears as SchoolYearOption[];
      if (Array.isArray(years) && years.length > 0) {
        setSchoolYears(years);
        const active = years.find((y) => y.status === "ACTIVE");
        setSchoolYear((prev) => prev || active?.label || years[0].label);
      }
    }).catch(() => {});
  }, []);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [assignRes, optRes, historyRes] = await Promise.all([
        adminApi.getClassAssignments(schoolYear),
        adminApi.getClassAssignmentOptions(schoolYear),
        adminApi.getSyncHistory(1).catch(() => null),
      ]);
      setAssignments((assignRes.data?.assignments ?? []) as ClassAssignmentRow[]);
      setWorkloadSummary((assignRes.data?.workloadSummary ?? []) as WorkloadRow[]);
      setOptions(optRes.data as AssignmentOptions);
      const latest = historyRes?.data?.history?.[0];
      setLastSyncAt(latest?.startedAt ?? null);
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message ?? "Failed to load teaching load");
      toast.error("Failed to load teaching load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (schoolYear) void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolYear]);

  const activeAssignments = useMemo(() => assignments.filter((a) => a.isActive !== false), [assignments]);
  const archivedAssignments = useMemo(() => assignments.filter((a) => a.isActive === false), [assignments]);

  const teacherLoads = useMemo<TeacherLoad[]>(() => {
    const map = new Map<string, TeacherLoad>();

    const ensure = (teacherId: string, teacherName: string, employeeId?: string): TeacherLoad => {
      const existing = map.get(teacherId);
      if (existing) {
        if (!existing.employeeId && employeeId) existing.employeeId = employeeId;
        return existing;
      }
      const entry: TeacherLoad = {
        teacherId,
        teacherName,
        employeeId,
        advisorySections: [],
        assignments: [],
        sectionCount: 0,
        totalMinutes: 0,
      };
      map.set(teacherId, entry);
      return entry;
    };

    for (const a of activeAssignments) {
      const name = `${a.teacher?.user?.lastName ?? ""}, ${a.teacher?.user?.firstName ?? ""}`.replace(/^, |, $/, "").trim() || "Unknown teacher";
      const entry = ensure(a.teacherId, name, a.teacher?.employeeId);
      entry.assignments.push(a);
    }

    for (const w of workloadSummary) {
      const entry = ensure(w.teacherId, w.teacherName);
      entry.totalMinutes += w.totalMinutes;
      if (w.advisoryRoleMinutes > 0) entry.advisorySections.push(w.sectionName);
    }

    return [...map.values()]
      .map((entry) => {
        entry.assignments.sort((a, b) => (a.section?.name ?? "").localeCompare(b.section?.name ?? ""));
        entry.sectionCount = new Set(entry.assignments.map((a) => a.sectionId)).size;
        entry.advisorySections = [...new Set(entry.advisorySections)];
        return entry;
      })
      .sort((a, b) => a.teacherName.localeCompare(b.teacherName));
  }, [activeAssignments, workloadSummary]);

  const gapCount = useMemo(() => {
    if (!options.sections.length) return 0;
    const covered = new Set(activeAssignments.map((a) => a.sectionId));
    return options.sections.filter((s) => !covered.has(s.id)).length;
  }, [options.sections, activeAssignments]);

  const transferCount = useMemo(
    () => archivedAssignments.filter((a) => a.archivedReason === "ATLAS_REASSIGNED").length,
    [archivedAssignments]
  );

  const filteredTeacherLoads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teacherLoads;
    return teacherLoads.filter((t) => {
      const haystack = [
        t.teacherName,
        t.employeeId ?? "",
        ...t.advisorySections,
        ...t.assignments.map((a) => `${a.subject?.code ?? ""} ${a.subject?.name ?? ""} ${a.section?.name ?? ""} ${a.section?.gradeLevel ?? ""}`),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [teacherLoads, search]);

  const filteredWorkload = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workloadSummary;
    return workloadSummary.filter((row) =>
      `${row.teacherName} ${row.sectionName} ${row.gradeLevel}`.toLowerCase().includes(q)
    );
  }, [workloadSummary, search]);

  const filteredArchived = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archivedAssignments;
    return archivedAssignments.filter((a) =>
      `${a.teacher?.user?.lastName ?? ""} ${a.teacher?.user?.firstName ?? ""} ${a.subject?.name ?? ""} ${a.section?.name ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [archivedAssignments, search]);

  const workloadPagination = usePagination({ totalRows: filteredWorkload.length });
  const archivedPagination = usePagination({ totalRows: filteredArchived.length });
  const teacherPagination = usePagination({ totalRows: filteredTeacherLoads.length });
  const paginatedTeacherLoads = teacherPagination.slice(filteredTeacherLoads);
  const maxTotalMinutes = useMemo(
    () => Math.max(1, ...workloadSummary.map((w) => w.totalMinutes)),
    [workloadSummary]
  );

  const hasNoSchedule = !loading && activeAssignments.length === 0 && archivedAssignments.length === 0;

  const workloadColumns: TableColumn<WorkloadRow>[] = [
    { key: "teacher", header: "Teacher", skeleton: "name", cell: (row) => <span className="font-medium text-foreground">{row.teacherName}</span> },
    { key: "section", header: "Section", skeleton: "name", cell: (row) => `${row.sectionName} (${gradeLevelLabel(row.gradeLevel)})` },
    { key: "hg", header: "HG", skeleton: "number", align: "right", className: "text-right", cell: (row) => `${row.hgMinutes} min` },
    { key: "advisory", header: "Advisory", skeleton: "number", align: "right", className: "text-right", cell: (row) => `${row.advisoryRoleMinutes} min` },
    { key: "other", header: "Subjects", skeleton: "number", align: "right", className: "text-right", cell: (row) => `${row.otherSubjectMinutes} min` },
    { key: "total", header: "Total Load", skeleton: "number", align: "right", className: "text-right", cell: (row) => <span className="font-semibold text-foreground">{row.totalMinutes} min</span> },
    {
      key: "bar",
      header: "Distribution",
      cell: (row) => (
        <div className="flex h-2.5 w-32 rounded-full bg-muted overflow-hidden">
          <div style={{ width: `${(row.hgMinutes / maxTotalMinutes) * 100}%`, backgroundColor: colors.primary }} />
          <div style={{ width: `${(row.advisoryRoleMinutes / maxTotalMinutes) * 100}%`, backgroundColor: colors.secondary }} />
          <div style={{ width: `${(row.otherSubjectMinutes / maxTotalMinutes) * 100}%`, backgroundColor: colors.accent }} />
        </div>
      ),
    },
  ];

  const archivedColumns: TableColumn<ClassAssignmentRow>[] = [
    {
      key: "subject",
      header: "Subject",
      skeleton: "name",
      cell: (a) => (
        <span>
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded mr-1">{a.subject?.code ?? <Dash />}</span>
          {a.subject?.name ?? <Dash />}
        </span>
      ),
    },
    { key: "section", header: "Section", skeleton: "name", cell: (a) => `${a.section?.name ?? "—"} (${gradeLevelLabel(a.section?.gradeLevel)})` },
    {
      key: "teacher",
      header: "Was assigned to",
      skeleton: "name",
      cell: (a) => `${a.teacher?.user?.lastName ?? ""}, ${a.teacher?.user?.firstName ?? ""}`.replace(/^, |, $/, "").trim() || "—",
    },
    {
      key: "reason",
      header: "Status",
      skeleton: "badge",
      cell: (a) =>
        a.archivedReason === "ATLAS_REASSIGNED" ? (
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-bold">TRANSFERRED</Badge>
            {a.successorTeacherName && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <ArrowRight className="w-3 h-3" /> {a.successorTeacherName}
              </span>
            )}
          </div>
        ) : (
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-bold">ARCHIVED</Badge>
        ),
    },
  ];

  if (error && !loading && assignments.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
        <PageError title="Unable to Load Teaching Load" message={error} onRetry={() => void loadData()} retryLabel="Retry" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Teaching Load"
        description="Read-only mirror of teaching assignments synchronized from ATLAS"
        actions={
          <>
            <Select value={schoolYear} onValueChange={setSchoolYear}>
              <SelectTrigger className="w-36 h-9 rounded-lg text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {schoolYears.map((sy) => (
                  <SelectItem key={sy.id} value={sy.label}>{sy.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadData()}
              disabled={loading}
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </>
        }
      />

      {/* Trust strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 border-primary/20 bg-primary/5 px-4 py-3 text-sm">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-foreground">
          <strong>Synced from ATLAS</strong> · last sync {relativeTime(lastSyncAt)}
        </span>
        <span className="text-muted-foreground">Assignments are managed in ATLAS — this page is read-only.</span>
      </div>

      {/* Load health */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Teachers with Load" value={teacherLoads.length} numericValue={teacherLoads.length} icon={<Users className="w-5 h-5" style={{ color: colors.primary }} />} iconClassName="bg-primary/10" />
        <StatCard label="Active Assignments" value={activeAssignments.length} numericValue={activeAssignments.length} icon={<ClipboardList className="w-5 h-5" style={{ color: colors.secondary }} />} iconClassName="bg-secondary/10" />
        <StatCard
          label="Sections Without Teacher"
          value={gapCount}
          numericValue={gapCount}
          icon={<AlertTriangle className={cn("w-5 h-5", gapCount > 0 ? "text-amber-500" : "text-muted-foreground")} />}
          iconClassName={gapCount > 0 ? "bg-amber-50" : "bg-muted"}
        />
        <StatCard label="Recent Transfers" value={transferCount} numericValue={transferCount} icon={<ArrowRight className="w-5 h-5" style={{ color: colors.accent }} />} iconClassName="bg-accent/10" />
      </div>

      {/* Empty state */}
      {hasNoSchedule ? (
        <Card className="border border-border shadow-sm rounded-xl bg-card p-0">
          <CardContent className="py-14 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <Inbox className="h-5 w-5 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-semibold text-foreground">No ATLAS schedule configured for {schoolYear} yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Teaching load fills in automatically when teachers log in and their ATLAS schedule is available.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tabs + search */}
          <Tabs value={tab} onValueChange={setTab}>
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <TabsList variant="line" className="justify-start gap-1 border-b border-border pb-0">
                <TabsTrigger value="load" className="px-4 text-xs font-semibold uppercase tracking-wider">Teaching Load</TabsTrigger>
                <TabsTrigger value="workload" className="px-4 text-xs font-semibold uppercase tracking-wider">Workload Summary</TabsTrigger>
              </TabsList>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={tab === "load" ? "Search teacher, subject, section..." : "Search workload..."}
              />
            </div>

            <TabsContent value="load">
              <Card className="border border-border shadow-sm rounded-xl bg-card p-0 overflow-hidden">
                <div className="divide-y divide-border/40">
                  {paginatedTeacherLoads.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">No teachers match your search</div>
                  ) : (
                    paginatedTeacherLoads.map((t) => {
                      const expanded = expandedTeacher === t.teacherId;
                      return (
                        <div key={t.teacherId}>
                          <button
                            type="button"
                            onClick={() => setExpandedTeacher(expanded ? null : t.teacherId)}
                            className="w-full flex items-center gap-3 px-6 py-4 hover:bg-muted/50 transition-colors text-left"
                          >
                            <span
                              className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-semibold shrink-0"
                              style={{ backgroundColor: colors.primary }}
                              aria-hidden="true"
                            >
                              {t.teacherName.split(/[ ,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm text-foreground truncate">{t.teacherName}</p>
                              <p className="text-xs text-muted-foreground font-mono">
                                {t.employeeId || "—"}
                                {t.advisorySections.length > 0 && (
                                  <span className="font-sans ml-2">
                                    · Advisory: {t.advisorySections.join(", ")}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline" className="text-[11px] font-medium px-2 py-0.5 rounded-full">
                                {t.assignments.length} subject{t.assignments.length !== 1 ? "s" : ""}
                              </Badge>
                              <Badge variant="outline" className="text-[11px] font-medium px-2 py-0.5 rounded-full">
                                {t.sectionCount} section{t.sectionCount !== 1 ? "s" : ""}
                              </Badge>
                            </div>
                            <span className="w-24 text-right text-sm font-semibold text-foreground tabular-nums shrink-0">
                              {t.totalMinutes} min
                            </span>
                            {expanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                            )}
                          </button>

                          {expanded && (
                            <div className="bg-muted/30 px-6 py-3 space-y-1.5">
                              {t.assignments.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-1">Advisory role only — no subject assignments.</p>
                              ) : (
                                t.assignments.map((a) => (
                                  <div key={a.id} className="flex items-center gap-3 rounded-lg bg-card border border-border/50 px-3 py-2">
                                    <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded shrink-0">
                                      {a.subject?.code ?? "—"}
                                    </span>
                                    <span className="text-sm text-foreground flex-1 truncate">{a.subject?.name ?? "—"}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {a.section?.name ?? "—"} ({gradeLevelLabel(a.section?.gradeLevel)})
                                    </span>
                                    <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                                      {a.teachingMinutes ? `${a.teachingMinutes} min` : <Dash />}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                {!loading && filteredTeacherLoads.length > 0 && (
                  <TablePagination
                    page={teacherPagination.page}
                    totalPages={teacherPagination.totalPages}
                    totalRows={teacherPagination.totalRows}
                    rowsPerPage={teacherPagination.rowsPerPage}
                    onPageChange={teacherPagination.setPage}
                    onRowsPerPageChange={teacherPagination.setRowsPerPage}
                  />
                )}
              </Card>
            </TabsContent>

            <TabsContent value="workload">
              <DataTable
                columns={workloadColumns}
                rows={filteredWorkload}
                loading={loading}
                title="Workload Summary (DepEd)"
                description={`${filteredWorkload.length} record${filteredWorkload.length !== 1 ? "s" : ""} · HG + Advisory + Subjects per teacher and section`}
                emptyTitle="No workload records"
                emptySearchTerm={search}
                rowKey={(row) => `${row.teacherId}-${row.sectionId}`}
                pagination={workloadPagination}
              />
            </TabsContent>
          </Tabs>

          {/* Transfers / Archived */}
          {archivedAssignments.length > 0 && (
            <Card className="border border-border shadow-sm rounded-xl bg-card p-0 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="w-full flex items-center gap-3 px-6 py-4 hover:bg-muted/50 transition-colors text-left"
              >
                <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">
                  Transferred / Archived ({archivedAssignments.length})
                </span>
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  Assignments removed or reassigned in ATLAS
                </span>
                <span className="ml-auto">
                  {showArchived ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </span>
              </button>
              {showArchived && (
                <div className="border-t border-border/40">
                  <DataTable
                    columns={archivedColumns}
                    rows={filteredArchived}
                    loading={loading}
                    emptyTitle="No transferred or archived assignments"
                    emptySearchTerm={search}
                    rowKey={(a) => a.id}
                    pagination={archivedPagination}
                  />
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
