import { useState, useEffect } from "react";
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  Users,
  Search,
  GraduationCap,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
import { useTheme } from "@/contexts/ThemeContext";

const gradeLabel = (g: string) => g.replace("GRADE_", "Grade ");

function getGradeColors(gradeLevel: string) {
  switch (gradeLevel) {
    case "GRADE_7": return "bg-emerald-50 text-emerald-700 border border-emerald-100";
    case "GRADE_8": return "bg-amber-50 text-amber-700 border border-amber-100";
    case "GRADE_9": return "bg-rose-50 text-rose-700 border border-rose-100";
    case "GRADE_10": return "bg-blue-50 text-blue-700 border border-blue-100";
    default: return "bg-gray-100 text-gray-600 border border-gray-200";
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
  const [limit, setLimit] = useState(25);

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

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Filter Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search section name or adviser..."
            value={sectionSearch}
            onChange={(e) => setSectionSearch(e.target.value)}
            className="pl-9 rounded-xl bg-white/50 backdrop-blur-sm border-white/40 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={activeGrade} onValueChange={(val) => setActiveGrade(val)}>
            <SelectTrigger className="w-36 rounded-xl bg-white/50 backdrop-blur-sm border-white/40 text-xs font-bold">
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
          <Select value={activeProgram} onValueChange={(val) => setActiveProgram(val)}>
            <SelectTrigger className="w-36 rounded-xl bg-white/50 backdrop-blur-sm border-white/40 text-xs font-bold">
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
          <Select value={activeSectionFilter} onValueChange={(val) => setActiveSectionFilter(val)}>
            <SelectTrigger className="w-36 rounded-xl bg-white/50 backdrop-blur-sm border-white/40 text-xs font-bold">
              <SelectValue placeholder="All Sections">
                {activeSectionFilter === "all" ? "All Sections" : filteredSections.find(s => String(s.id) === activeSectionFilter)?.name || "All Sections"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sections</SelectItem>
              {filteredSections.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name} ({s._count?.enrollments ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(activeGrade !== "all" || activeProgram !== "all" || activeSectionFilter !== "all" || sectionSearch) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setActiveGrade("all"); setActiveProgram("all"); setActiveSectionFilter("all"); setSectionSearch(""); }}
              className="rounded-xl text-xs font-bold text-gray-500 hover:text-gray-700"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* ── Sections Table ── */}
      <div className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-2xl shadow-lg shadow-gray-200/50 overflow-hidden">
        {sectionsLoading ? (
          <div className="py-16">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4 animate-pulse border-b border-gray-50">
                <div className="w-10 h-10 rounded-xl bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/6" />
                </div>
                <div className="h-6 w-20 rounded-full bg-gray-100" />
                <div className="h-6 w-16 rounded-full bg-gray-100" />
              </div>
            ))}
          </div>
        ) : sectionsError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mb-3">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
            <p className="text-sm font-bold text-gray-700">Failed to load sections</p>
            <p className="text-xs text-gray-400 mt-1">{sectionsError}</p>
            <Button onClick={loadSections} variant="outline" className="mt-4 rounded-xl">
              Try Again
            </Button>
          </div>
        ) : filteredSections.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-400 font-medium">No sections found</p>
            <p className="text-xs text-gray-300 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-slate-50/80 to-slate-100/50 border-b border-slate-100">
                    <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-4 w-[28%]">Section</TableHead>
                    <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-4 w-[12%]">Grade</TableHead>
                    <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-4 w-[25%]">Adviser</TableHead>
                    <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-4 w-[10%] text-center">Learners</TableHead>
                    <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-4 w-[13%]">Program</TableHead>
                    <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-4 w-[12%] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSections.map((s, idx) => (
                    <TableRow
                      key={s.id}
                      className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors cursor-pointer ${idx % 2 === 0 ? "bg-white/40" : ""}`}
                      onClick={() => loadRoster(s)}
                    >
                      <TableCell className="py-3.5">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-md flex-shrink-0"
                            style={{ backgroundColor: colors.primary }}
                          >
                            {s.name.charAt(0)}
                          </div>
                          <span className="font-bold text-gray-900 text-sm truncate">{s.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3.5">
                        <Badge className={`text-[10px] font-black uppercase tracking-widest rounded-full ${getGradeColors(s.gradeLevel)}`}>
                          {gradeLabel(s.gradeLevel)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3.5">
                        <span className="text-sm text-gray-600 font-medium truncate block">{s.adviser || "--"}</span>
                      </TableCell>
                      <TableCell className="py-3.5 text-center">
                        <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-lg bg-gray-100 font-black text-gray-900 text-sm">
                          {s._count?.enrollments ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="py-3.5">
                        {s.program && s.program !== "REGULAR" ? (
                          <Badge className="text-[9px] font-black uppercase tracking-widest rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                            {s.program}
                          </Badge>
                        ) : (
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">REG</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-lg h-8 px-3 text-xs font-bold"
                          style={{ color: colors.primary }}
                          onClick={(e) => { e.stopPropagation(); loadRoster(s); }}
                        >
                          View Roster
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className="block md:hidden p-4 space-y-2">
              {paginatedSections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => loadRoster(s)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/60 border border-white/40 hover:bg-white hover:shadow-sm transition-all text-left cursor-pointer"
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-md flex-shrink-0"
                    style={{ backgroundColor: colors.primary }}
                  >
                    {s.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-gray-900 text-sm truncate">{s.name}</p>
                      {s.program && s.program !== "REGULAR" && (
                        <Badge className="text-[8px] font-black uppercase tracking-widest rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                          {s.program}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{gradeLabel(s.gradeLevel)}</span>
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{s._count?.enrollments ?? 0} learners</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>

            {/* Section Pagination */}
            {filteredSections.length > sectionLimit && (
              <div className="px-6 py-4 border-t border-white/20 flex items-center justify-between bg-white/30 backdrop-blur-sm">
                <div className="text-xs text-gray-500 font-medium">
                  Showing {(sectionPage - 1) * sectionLimit + 1} to{" "}
                  {Math.min(sectionPage * sectionLimit, filteredSections.length)} of{" "}
                  <span className="font-black text-gray-900">{filteredSections.length}</span> sections
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-400" disabled={sectionPage <= 1} onClick={() => setSectionPage(1)}>
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-400" disabled={sectionPage <= 1} onClick={() => setSectionPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="default" size="sm" className="h-8 w-8 rounded-lg text-white font-bold text-xs shadow-sm" style={{ backgroundColor: colors.primary }}>
                    {sectionPage}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-400" disabled={sectionPage >= totalSectionPages} onClick={() => setSectionPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-400" disabled={sectionPage >= totalSectionPages} onClick={() => setSectionPage(totalSectionPages)}>
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Roster Dialog ── */}
      <Dialog open={rosterOpen} onOpenChange={setRosterOpen}>
        <DialogContent className="w-[95vw] sm:!max-w-4xl lg:!max-w-5xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden border border-gray-200/80 shadow-2xl bg-white rounded-2xl">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50/50">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-md"
                style={{ backgroundColor: colors.primary }}
              >
                {selectedSection?.name?.charAt(0)}
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-gray-900">
                  {selectedSection?.name ?? "Section Roster"}
                </DialogTitle>
                {rosterData.length > 0 && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      {rosterStats.total} learners
                    </span>
                    <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">
                      {rosterStats.male} male
                    </span>
                    <span className="text-[10px] font-black text-pink-500 uppercase tracking-widest">
                      {rosterStats.female} female
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {rosterData.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search learners..."
                    value={rosterSearch}
                    onChange={(e) => { setRosterSearch(e.target.value); setCurrentPage(1); }}
                    className="pl-9 w-56 rounded-xl bg-white border-gray-200 text-sm"
                  />
                </div>
              )}
              <Button
                onClick={() => selectedSection && loadRoster(selectedSection)}
                variant="outline"
                size="sm"
                className="rounded-xl"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${rosterLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            {rosterLoading ? (
              <div className="py-16">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-3 animate-pulse">
                    <div className="w-8 h-8 rounded-lg bg-gray-200" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-1/3" />
                      <div className="h-3 bg-gray-100 rounded w-1/4" />
                    </div>
                    <div className="h-6 w-16 rounded-full bg-gray-100" />
                  </div>
                ))}
              </div>
            ) : rosterError ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-3">
                  <AlertTriangle className="w-7 h-7 text-amber-500" />
                </div>
                <p className="text-sm font-bold text-gray-700">Unable to load roster</p>
                <p className="text-xs text-gray-400 mt-1">{rosterError}</p>
              </div>
            ) : filteredRoster.length === 0 ? (
              <div className="text-center py-16">
                <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-400 font-medium">No learners found</p>
                <p className="text-xs text-gray-300 mt-1">Try adjusting your search</p>
              </div>
            ) : (
              <>
                <div className="overflow-auto max-h-[50vh]">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-white">
                      <TableRow className="border-b border-gray-100">
                        <TableHead className="text-[10px] font-black text-gray-400 uppercase tracking-widest py-3 w-12">#</TableHead>
                        <TableHead className="text-[10px] font-black text-gray-400 uppercase tracking-widest py-3">LRN</TableHead>
                        <TableHead className="text-[10px] font-black text-gray-400 uppercase tracking-widest py-3">Learner Name</TableHead>
                        <TableHead className="text-[10px] font-black text-gray-400 uppercase tracking-widest py-3">Sex</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedRoster.map((l: any, i: number) => (
                        <TableRow
                          key={l.lrn ?? l.enrollmentRecordId ?? i}
                          className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                        >
                          <TableCell className="text-[11px] text-gray-400 font-medium py-3">
                            {(currentPage - 1) * limit + i + 1}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-gray-500 py-3">
                            {l.lrn ?? "--"}
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-[10px] shadow-sm"
                                style={{ backgroundColor: colors.primary }}
                              >
                                {(l.lastName ?? "?").charAt(0)}
                              </div>
                              <p className="font-bold text-gray-900 text-sm">
                                {l.lastName}, {l.firstName} {l.middleName ?? ""}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="py-3">
                            <Badge
                              className={`text-[10px] font-black uppercase tracking-widest rounded-full ${
                                l.sex === "MALE"
                                  ? "bg-blue-50 text-blue-600 border border-blue-100"
                                  : "bg-pink-50 text-pink-600 border border-pink-100"
                              }`}
                              variant="outline"
                            >
                              {l.sex ?? "--"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {filteredRoster.length > limit && (
                  <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div className="text-xs text-gray-500 font-medium">
                      Showing {(currentPage - 1) * limit + 1} to{" "}
                      {Math.min(currentPage * limit, filteredRoster.length)} of{" "}
                      <span className="font-black text-gray-900">{filteredRoster.length}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="default" size="sm" className="h-8 w-8 rounded-lg text-white font-bold text-xs" style={{ backgroundColor: colors.primary }}>
                        {currentPage}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
