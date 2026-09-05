import { useState, useEffect, useMemo } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  Building2,
  UserCheck,
  GraduationCap,
  CloudDownload,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { registrarApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useTheme } from "@/contexts/ThemeContext";
import { LoadingSkeleton, EmptyState } from "@/components/data-table";
import { Dash } from "@/components/data-table/Dash";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { SyncProgressModal } from "@/components/common/SyncProgressModal";

const gradeLabel = (g: string) => g.replace("GRADE_", "Grade ");

function getGradeColors(gradeLevel: string) {
  switch (gradeLevel) {
    case "GRADE_7": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "GRADE_8": return "bg-amber-50 text-amber-700 border-amber-200";
    case "GRADE_9": return "bg-rose-50 text-rose-700 border-rose-200";
    case "GRADE_10": return "bg-blue-50 text-blue-700 border-blue-200";
    default: return "bg-muted/30 text-muted-foreground border-border";
  }
}

export default function SectionRosterViewer() {
  const { colors } = useTheme();
  const [sections, setSections] = useState<any[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [activeGrade, setActiveGrade] = useState("all");
  const [activeProgram, setActiveProgram] = useState("all");
  const [activeSectionFilter, setActiveSectionFilter] = useState("all");
  const [sectionSearch, setSectionSearch] = useState("");
  const [sectionPage, setSectionPage] = useState(1);
  const sectionLimit = 10;

  const [rosterOpen, setRosterOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState<any>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterData, setRosterData] = useState<any[]>([]);
  const [rosterSearch, setRosterSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const limit = 25;
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [syncError, setSyncError] = useState<string | undefined>();

  const loadSections = async () => {
    setSectionsLoading(true);
    setSectionsError(null);
    try {
      const res = await registrarApi.getSections();
      const payload = res.data as any;
      const raw: any[] = payload.sections ?? payload.data ?? payload ?? [];
      setSections(raw.filter((s: any) => s.id && s.name));
    } catch {
      setSectionsError("Failed to load sections.");
    } finally {
      setSectionsLoading(false);
    }
  };

  const loadRoster = async (section: any) => {
    setSelectedSection(section);
    setRosterOpen(true);
    setRosterLoading(true);
    setRosterError(null);
    setRosterData([]);
    setRosterSearch("");
    setCurrentPage(1);

    if (!section.enrollProId) {
      setRosterError("This section has no EnrollPro ID.");
      setRosterLoading(false);
      return;
    }

    try {
      const res = await registrarApi.getSectionRoster(section.enrollProId);
      const payload = res.data as any;
      const rawLearners: any[] = payload.learners ?? [];
      const learners = rawLearners.map((row: any) => {
        const l = row.learner ?? row;
        return {
          enrollmentRecordId: row.enrollmentRecordId,
          lrn: l.lrn ?? row.lrn,
          firstName: l.firstName ?? row.firstName,
          lastName: l.lastName ?? row.lastName,
          middleName: l.middleName ?? row.middleName,
          sex: l.sex ?? row.sex,
        };
      });
      setRosterData(learners);
    } catch (err: any) {
      setRosterError(err?.response?.data?.message ?? "Failed to load roster.");
    } finally {
      setRosterLoading(false);
    }
  };

  useEffect(() => {
    void loadSections();
  }, []);

  const handleSync = async () => {
    setSyncModalOpen(true);
    setSyncStatus("syncing");
    setSyncError(undefined);
    try {
      await registrarApi.runSync();
      setSyncStatus("success");
      await loadSections();
    } catch {
      setSyncStatus("error");
      setSyncError("Failed to sync with EnrollPro. Please try again.");
    }
  };

  useEffect(() => {
    setSectionPage(1);
  }, [activeGrade, activeProgram, activeSectionFilter, sectionSearch]);

  const filteredSections = sections.filter((s) => {
    const matchesGrade = activeGrade === "all" || s.gradeLevel === activeGrade;
    const matchesProgram = activeProgram === "all" || s.program === activeProgram;
    const matchesSection = activeSectionFilter === "all" || String(s.id) === activeSectionFilter;
    const matchesSearch = !sectionSearch ||
      s.name.toLowerCase().includes(sectionSearch.toLowerCase()) ||
      (s.adviser || "").toLowerCase().includes(sectionSearch.toLowerCase());
    return matchesGrade && matchesProgram && matchesSection && matchesSearch;
  });

  const totalSectionPages = Math.max(1, Math.ceil(filteredSections.length / sectionLimit));
  const paginatedSections = filteredSections.slice(
    (sectionPage - 1) * sectionLimit,
    sectionPage * sectionLimit
  );

  const filteredRoster = rosterData.filter((l: any) => {
    if (!rosterSearch) return true;
    const q = rosterSearch.toLowerCase();
    const fullName = `${l.lastName ?? ""} ${l.firstName ?? ""} ${l.middleName ?? ""}`.toLowerCase();
    return fullName.includes(q) || String(l.lrn ?? "").includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filteredRoster.length / limit));
  const paginatedRoster = filteredRoster.slice((currentPage - 1) * limit, currentPage * limit);

  const rosterStats = {
    total: filteredRoster.length,
    male: filteredRoster.filter((l: any) => (l.sex || "").toUpperCase() === "MALE").length,
    female: filteredRoster.filter((l: any) => (l.sex || "").toUpperCase() === "FEMALE").length,
  };

  const stats = useMemo(() => {
    const totalLearners = sections.reduce(
      (sum, s) => sum + (s._count?.enrollments ?? 0),
      0
    );
    const gradeSet = new Set(sections.map((s) => s.gradeLevel).filter(Boolean));
    const withAdviser = sections.filter((s) => s.adviser && s.adviser.trim()).length;
    return {
      totalSections: sections.length,
      totalLearners,
      gradeLevels: gradeSet.size,
      withAdviser,
    };
  }, [sections]);

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Section Rosters"
        description="Browse sections and view learner rosters"
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void handleSync()}
              variant="default"
              size="sm"
              className="font-semibold text-xs shadow-sm shadow-primary/20"
              disabled={syncStatus === "syncing"}
            >
              <CloudDownload className="w-4 h-4 mr-1.5" />
              Sync from EnrollPro
            </Button>
            <Button
              onClick={() => void loadSections()}
              variant="outline"
              size="sm"
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Sections"
          value={stats.totalSections}
          numericValue={stats.totalSections}
          icon={<Layers className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Total Learners"
          value={stats.totalLearners}
          numericValue={stats.totalLearners}
          icon={<Users className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Grade Levels"
          value={stats.gradeLevels}
          numericValue={stats.gradeLevels}
          icon={<GraduationCap className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="With Adviser"
          value={stats.withAdviser}
          numericValue={stats.withAdviser}
          icon={<UserCheck className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
      </div>

      {/* Main Table Card */}
      <Card className="border border-slate-200/60 shadow-sm bg-card overflow-hidden rounded-2xl p-0">
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">All Sections</h2>
              <p className="text-sm text-muted-foreground">
                {filteredSections.length} section{filteredSections.length !== 1 ? "s" : ""} found
              </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search section or adviser..."
                  value={sectionSearch}
                  onChange={(e) => setSectionSearch(e.target.value)}
                  className="pl-8 h-9 w-56 rounded-lg text-xs"
                />
              </div>
              <Select value={activeGrade} onValueChange={(val) => val && setActiveGrade(val)}>
                <SelectTrigger className="w-32 h-9 rounded-lg text-xs font-medium">
                  <SelectValue placeholder="All Grades">
                    {activeGrade === "all" ? "All Grades" : gradeLabel(activeGrade)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Grades</SelectItem>
                  <SelectItem value="GRADE_7">Grade 7</SelectItem>
                  <SelectItem value="GRADE_8">Grade 8</SelectItem>
                  <SelectItem value="GRADE_9">Grade 9</SelectItem>
                  <SelectItem value="GRADE_10">Grade 10</SelectItem>
                </SelectContent>
              </Select>
              <Select value={activeProgram} onValueChange={(val) => val && setActiveProgram(val)}>
                <SelectTrigger className="w-32 h-9 rounded-lg text-xs font-medium">
                  <SelectValue placeholder="All Programs">
                    {activeProgram === "all" ? "All Programs" : activeProgram}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Programs</SelectItem>
                  <SelectItem value="REGULAR">Regular</SelectItem>
                  <SelectItem value="SPA">SPA</SelectItem>
                  <SelectItem value="SPS">SPS</SelectItem>
                  <SelectItem value="STE">STE</SelectItem>
                </SelectContent>
              </Select>
              {(activeGrade !== "all" || activeProgram !== "all" || activeSectionFilter !== "all" || sectionSearch) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setActiveGrade("all"); setActiveProgram("all"); setActiveSectionFilter("all"); setSectionSearch(""); }}
                  className="h-9 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>

        <CardContent className="p-0">
          {sectionsError ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Failed to load sections</h2>
              <p className="text-muted-foreground mb-4">{sectionsError}</p>
              <Button onClick={loadSections} variant="outline">
                Try Again
              </Button>
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="block md:hidden p-4 space-y-3">
                {paginatedSections.length === 0 ? (
                  <div className="text-center py-12">
                    <Building2 className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground font-medium">No sections found</p>
                    <p className="text-muted-foreground text-sm mt-1">Try adjusting your filters</p>
                  </div>
                ) : (
                  paginatedSections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => loadRoster(s)}
                      className="w-full flex items-center gap-3 p-4 bg-card border border-border rounded-xl shadow-sm hover:shadow-md transition-shadow text-left"
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-semibold"
                        style={{ backgroundColor: colors.primary }}
                      >
                        {s.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground truncate">{s.name}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <Badge className={`text-[10px] font-bold uppercase tracking-widest rounded-full ${getGradeColors(s.gradeLevel)}`}>
                            {gradeLabel(s.gradeLevel)}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {s._count?.enrollments ?? 0} learners
                          </Badge>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
                    </button>
                  ))
                )}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block">
                {sectionsLoading ? (
                  <div className="py-8">
                    <LoadingSkeleton columnCount={6} rowCount={8} />
                  </div>
                ) : paginatedSections.length === 0 ? (
                  <div className="py-8">
                    <EmptyState
                      columnCount={6}
                      title="No sections found"
                      hint="Try adjusting your search or filters"
                      icon={<Building2 className="h-5 w-5 text-muted-foreground/60" />}
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                      <Table className="w-full table-fixed">
                      <TableHeader>
                        <TableRow className="hover:bg-muted/50 border-b border-slate-100 bg-muted/30">
                          <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[28%] text-left">Section</TableHead>
                          <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[12%] text-left">Grade</TableHead>
                          <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[25%] text-left">Adviser</TableHead>
                          <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[10%] text-center">Learners</TableHead>
                          <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[13%] text-left">Program</TableHead>
                          <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%] text-left">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedSections.map((s) => (
                          <TableRow
                            key={s.id}
                            className="border-b border-slate-100/80 hover:bg-muted/50 transition-colors"
                          >
                            <TableCell className="py-3.5 px-4 text-left align-middle">
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs shrink-0"
                                  style={{ backgroundColor: colors.primary }}
                                  aria-hidden="true"
                                >
                                  {s.name.charAt(0)}
                                </div>
                                <p className="font-semibold text-foreground text-sm truncate">{s.name}</p>
                              </div>
                            </TableCell>
                            <TableCell className="py-3.5 px-4 text-left align-middle whitespace-nowrap">
                              <Badge
                                variant="outline"
                                className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${getGradeColors(s.gradeLevel)}`}
                              >
                                {gradeLabel(s.gradeLevel)}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-3.5 px-4 text-sm text-muted-foreground text-left align-middle whitespace-nowrap">
                              {s.adviser || <Dash />}
                            </TableCell>
                            <TableCell className="py-3.5 px-4 text-center align-middle">
                              <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-lg bg-muted font-semibold text-foreground text-sm tabular-nums">
                                {s._count?.enrollments ?? 0}
                              </span>
                            </TableCell>
                            <TableCell className="py-3.5 px-4 text-left align-middle whitespace-nowrap">
                              {s.program && s.program !== "REGULAR" ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-semibold rounded-full bg-amber-50 text-amber-700 border-amber-200 whitespace-nowrap"
                                >
                                  {s.program}
                                </Badge>
                              ) : (
                                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">REG</span>
                              )}
                            </TableCell>
                            <TableCell className="py-3.5 px-4 text-left align-middle">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap -ml-2.5"
                                onClick={() => loadRoster(s)}
                              >
                                <Users className="w-3.5 h-3.5 mr-1.5" />
                                View Roster
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Pagination */}
          {!sectionsLoading && !sectionsError && filteredSections.length > 0 && (
            <div className="border-t border-slate-100 px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Showing {(sectionPage - 1) * sectionLimit + 1}–{Math.min(sectionPage * sectionLimit, filteredSections.length)} of{" "}
                  <span className="font-medium text-foreground">{filteredSections.length}</span> sections
                </span>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={sectionPage <= 1}
                  onClick={() => setSectionPage(1)}
                  aria-label="First page"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={sectionPage <= 1}
                  onClick={() => setSectionPage((p) => p - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>

                <Button
                  variant="default"
                  size="sm"
                  className="h-8 w-8 text-xs font-bold"
                >
                  {sectionPage}
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={sectionPage >= totalSectionPages}
                  onClick={() => setSectionPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={sectionPage >= totalSectionPages}
                  onClick={() => setSectionPage(totalSectionPages)}
                  aria-label="Last page"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Roster Dialog ── */}
      <Dialog open={rosterOpen} onOpenChange={setRosterOpen}>
        <DialogContent className="sm:!max-w-4xl lg:!max-w-5xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden border-0 shadow-2xl bg-card rounded-xl sm:rounded-2xl">
          <div className="px-4 sm:px-6 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="p-3 rounded-xl text-white shadow-lg shrink-0"
                style={{ backgroundColor: colors.primary }}
              >
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-xl sm:text-2xl font-bold text-foreground leading-tight truncate">
                  {selectedSection?.name ?? "Section Roster"}
                </DialogTitle>
                {rosterData.length > 0 && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {rosterStats.total} learners
                    </span>
                    <span className="text-[11px] font-medium text-blue-600">
                      {rosterStats.male} male
                    </span>
                    <span className="text-[11px] font-medium text-pink-600">
                      {rosterStats.female} female
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {rosterData.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search learners..."
                    value={rosterSearch}
                    onChange={(e) => { setRosterSearch(e.target.value); setCurrentPage(1); }}
                    className="pl-8 h-9 w-56 rounded-lg text-xs"
                  />
                </div>
              )}
              <Button
                onClick={() => selectedSection && loadRoster(selectedSection)}
                variant="outline"
                size="sm"
                className="h-9 rounded-lg"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${rosterLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            {rosterLoading ? (
              <div className="py-8">
                <LoadingSkeleton columnCount={4} rowCount={6} />
              </div>
            ) : rosterError ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle className="w-8 h-8 text-destructive" />
                </div>
                <h2 className="text-base font-semibold text-foreground mb-1">Unable to load roster</h2>
                <p className="text-sm text-muted-foreground">{rosterError}</p>
              </div>
            ) : filteredRoster.length === 0 ? (
              <div className="py-8">
                <EmptyState
                  columnCount={4}
                  title="No learners found"
                  hint="Try adjusting your search"
                  icon={<Users className="h-5 w-5 text-muted-foreground/60" />}
                />
              </div>
            ) : (
              <>
                <div className="overflow-auto max-h-[50vh]">
                  <Table className="w-full table-fixed">
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="hover:bg-muted/50 border-b border-border bg-muted/50">
                        <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-12 text-left">#</TableHead>
                        <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[24%] text-left">LRN</TableHead>
                        <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[50%] text-left">Learner Name</TableHead>
                        <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%] text-left">Sex</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedRoster.map((l: any, i: number) => (
                        <TableRow
                          key={l.lrn ?? l.enrollmentRecordId ?? i}
                          className="border-b border-border hover:bg-muted/50 transition-colors"
                        >
                          <TableCell className="text-[11px] text-muted-foreground font-medium py-3.5 px-4 text-left align-middle whitespace-nowrap">
                            {(currentPage - 1) * limit + i + 1}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground py-3.5 px-4 text-left align-middle whitespace-nowrap tabular-nums">
                            {l.lrn ?? <Dash />}
                          </TableCell>
                          <TableCell className="py-3.5 px-4 text-left align-middle">
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className="w-7 h-7 rounded-full flex items-center justify-center text-white font-semibold text-[10px] shrink-0"
                                style={{ backgroundColor: colors.primary }}
                                aria-hidden="true"
                              >
                                {(l.lastName ?? "?").charAt(0)}
                              </div>
                              <p className="font-semibold text-foreground text-sm truncate">
                                {l.lastName}, {l.firstName} {l.middleName ?? ""}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="py-3.5 px-4 text-left align-middle">
                            {l.sex ? (
                              <Badge
                                variant="outline"
                                className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                                  l.sex === "MALE"
                                    ? "bg-blue-50 text-blue-700 border-blue-200"
                                    : "bg-pink-50 text-pink-700 border-pink-200"
                                }`}
                              >
                                {l.sex}
                              </Badge>
                            ) : (
                              <Dash />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {filteredRoster.length > limit && (
                  <div className="border-t border-border px-4 sm:px-6 py-3 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      Showing {(currentPage - 1) * limit + 1}–{Math.min(currentPage * limit, filteredRoster.length)} of{" "}
                      <span className="font-medium text-foreground">{filteredRoster.length}</span> learners
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)} aria-label="First page">
                        <ChevronsLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)} aria-label="Previous page">
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="default" size="sm" className="h-8 w-8 text-xs font-bold">
                        {currentPage}
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)} aria-label="Next page">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)} aria-label="Last page">
                        <ChevronsRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <SyncProgressModal isOpen={syncModalOpen} onClose={() => { setSyncModalOpen(false); setSyncStatus("idle"); }} status={syncStatus} errorMessage={syncError} />
    </div>
  );
}
