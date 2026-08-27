import { useState, useEffect, useRef } from "react";
import {
  BarChart3,
  Loader2,
  AlertTriangle,
  RefreshCw,
  BookOpen,
  User,
  WifiOff,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Command,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { registrarApi } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useTheme } from "@/contexts/ThemeContext";

export default function TeachingLoad() {
  const { colors, theme } = useTheme();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [loadLoading, setLoadLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [faculty, setFaculty] = useState<any[]>([]);

  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<any>(null);

  const [search, setSearch] = useState("");
  const [isLocalDbFallback, setIsLocalDbFallback] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName))) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadAll = async (silent = false) => {
    if (!silent) { setLoadLoading(true); setCoverageLoading(true); }
    setLoadError(null);
    setCoverageError(null);
    setIsLocalDbFallback(false);

    void (async () => {
      try {
        const res = await registrarApi.getAtlasTeachingLoads();
        const payload = res.data as any;
        setFaculty(payload.faculty ?? payload.teachers ?? payload.data ?? []);
        if (payload.source === "smart-local-db") setIsLocalDbFallback(true);
      } catch (err: any) {
        const detail = err?.response?.data?.error ?? err?.response?.data?.message ?? err?.message ?? "";
        setLoadError(`Failed to load teaching loads: ${detail}`);
        setFaculty([]);
      } finally {
        setLoadLoading(false);
      }
    })();

    void (async () => {
      try {
        const res = await registrarApi.getAtlasSubjectCoverage();
        setCoverage(res.data);
      } catch (err: any) {
        const detail = err?.response?.data?.error ?? err?.response?.data?.message ?? err?.message ?? "";
        setCoverageError(`Failed to load subject coverage: ${detail}`);
        setCoverage(null);
      } finally {
        setCoverageLoading(false);
      }
    })();
  };

  useEffect(() => { void loadAll(); }, []);

  const filtered = search
    ? faculty.filter((f) => {
        const name = `${f.firstName ?? ""} ${f.lastName ?? ""}`.toLowerCase();
        return name.includes(search.toLowerCase());
      })
    : faculty;

  const minutesToHours = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

  const paginated = filtered.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const totalPages = Math.ceil(filtered.length / rowsPerPage);
  const startItem = page * rowsPerPage + 1;
  const endItem = Math.min((page + 1) * rowsPerPage, filtered.length);

  return (
    <div className={`p-6 space-y-6 ${theme === 'dark' ? 'bg-gray-900 text-gray-100' : ''}`}>
      <Breadcrumb items={[{ label: "Dashboard", href: "/registrar" }, { label: "Teaching Load" }]} />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className={`rounded-2xl shadow-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${colors.primary}15` }}>
                <User className="h-5 w-5" style={{ color: colors.primary }} />
              </div>
              <div>
                <p className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {loadLoading ? "…" : faculty.length}
                </p>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Faculty Members</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={`rounded-2xl shadow-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-50">
                <BookOpen className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {coverageLoading ? "…" : coverage ? (coverage.count ?? 0) - (coverage.unassignedCount ?? 0) : "—"}
                </p>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Subjects Assigned</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={`rounded-2xl shadow-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-50">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {coverageLoading ? "…" : coverage?.unassignedCount ?? "—"}
                </p>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Unassigned Subjects</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Local DB fallback banner */}
      {isLocalDbFallback && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <WifiOff className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            <strong>ATLAS is currently offline.</strong> Showing last synced data from SMART's local database. Data may not reflect the latest assignments.
          </span>
        </div>
      )}

      {/* Main Card - Teaching Load Table */}
      <Card className={`rounded-2xl shadow-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
        <CardContent className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl" style={{ backgroundColor: `${colors.primary}15` }}>
                <BarChart3 className="h-5 w-5" style={{ color: colors.primary }} />
              </div>
              <div>
                <h2 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  Faculty Teaching Loads
                </h2>
                <p className={`text-xs uppercase tracking-wider font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  {filtered.length} Faculty Members
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  ref={searchInputRef}
                  placeholder="Search faculty..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  className={`pl-9 w-64 rounded-xl ${theme === 'dark' ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}
                />
                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-100 rounded border border-gray-200">
                  <Command className="w-3 h-3" />K
                </kbd>
              </div>
              <Button onClick={() => void loadAll()} variant="outline" className="rounded-xl">
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className={`rounded-xl border ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
            <Table>
              <TableHeader>
                <TableRow className={`${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Faculty Name</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider text-center ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Subjects</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Weekly Load</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider text-center ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Load %</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Assigned Subjects</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-16">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: colors.primary }} />
                    </TableCell>
                  </TableRow>
                ) : loadError ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-16">
                      <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                      <p className="text-gray-700 font-medium">Unable to load teaching loads</p>
                      <p className="text-gray-500 text-sm mt-1">{loadError}</p>
                      <Button onClick={() => void loadAll()} variant="outline" className="mt-4 rounded-xl">Try Again</Button>
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-16">
                      <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                      <p className="text-gray-500 font-medium">No faculty found matching your criteria</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.map((f: any, i: number) => {
                    const rawSubjectHours = f.subjectHours ?? f.weeklyHours ?? 0;
                    const advHours = f.isClassAdviser ? (f.advisoryEquivalentHours ?? 0) : 0;
                    const pureTeachingHours = Math.max(0, rawSubjectHours - advHours);
                    
                    const loadPct = f.maxHoursPerWeek 
                      ? Math.round((pureTeachingHours / f.maxHoursPerWeek) * 100) 
                      : (f.loadPercentage ?? 0);
                    
                    return (
                      <TableRow key={f.facultyId ?? i} className={`hover:${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-50'}`}>
                        <TableCell className="font-medium">
                          {f.firstName && f.lastName
                            ? `${f.lastName}, ${f.firstName}`
                            : f.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            className={
                              (f.assignedSubjects?.length ?? f.subjectCount ?? 0) > 0
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-gray-100 text-gray-500"
                            }
                          >
                            {f.subjectCount ?? f.assignedSubjects?.length ?? 0}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold">
                              {f.subjectHours != null
                                ? `${f.subjectHours}h`
                                : f.totalMinutesPerWeek != null
                                ? minutesToHours(f.totalMinutesPerWeek)
                                : f.weeklyHours != null
                                ? `${f.weeklyHours}h`
                                : "—"}
                            </span>
                            {f.maxHoursPerWeek != null && (
                              <span className="text-[10px] text-gray-400">Max: {f.maxHoursPerWeek}h</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`text-sm font-bold ${loadPct > 100 ? 'text-red-600' : 'text-emerald-600'}`}>
                              {loadPct}%
                            </span>
                            <div className="w-16 h-1 bg-gray-100 rounded-full overflow-hidden">
                              <div 
                                className={`h-full ${loadPct > 100 ? 'bg-red-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(loadPct, 100)}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm max-w-xs">
                          {Array.isArray(f.assignments)
                            ? f.assignments.map((a: any) => a.subject?.name ?? a.subject?.code ?? a.subjectCode ?? "").filter(Boolean).join(", ") || "—"
                            : Array.isArray(f.assignedSubjects)
                            ? f.assignedSubjects.map((s: any) => s.name ?? s.code ?? s).join(", ")
                            : f.subjects ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Footer */}
          <div className={`flex items-center justify-between mt-4 pt-4 border-t ${theme === 'dark' ? 'border-gray-700' : 'border-gray-100'}`}>
            <div className="flex items-center gap-4">
              <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                Showing {filtered.length > 0 ? startItem : 0} to {endItem} of {filtered.length} Faculty
              </span>
              <div className="flex items-center gap-2">
                <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Rows per page:</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
                  className={`h-8 px-2 text-sm rounded-lg border ${theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-50 border-gray-200'}`}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" disabled={page === 0} onClick={() => setPage(0)}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="h-8 w-8 flex items-center justify-center rounded-lg text-sm font-medium text-white" style={{ backgroundColor: colors.primary }}>
                {page + 1}
              </div>
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Unassigned Subjects */}
      {!coverageLoading && coverage?.unassigned?.length > 0 && (
        <Card className={`rounded-2xl shadow-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-amber-50">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  Unassigned Subjects ({coverage.unassignedCount})
                </h3>
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  Subjects without a faculty assignment in ATLAS
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {coverage.unassigned.map((s: any) => (
                <Badge key={s.id} variant="outline" className="border-amber-300 text-amber-700 bg-amber-100">
                  {s.code ? `${s.code} — ` : ""}{s.name}
                </Badge>
              ))}
            </div>
            {coverageError && <p className="text-red-500 text-sm mt-3">{coverageError}</p>}
          </CardContent>
        </Card>
      )}

      {coverageError && !coverage && (
        <div className="text-center py-4 text-amber-600 text-sm">
          <AlertTriangle className="w-4 h-4 inline mr-1" /> {coverageError}
        </div>
      )}
    </div>
  );
}
