import { useState, useEffect } from "react";
import { BarChart3, Loader2, AlertTriangle, RefreshCw, BookOpen, User, WifiOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const { colors } = useTheme();
  const [loadLoading, setLoadLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [faculty, setFaculty] = useState<any[]>([]);

  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<any>(null);

  const [search, setSearch] = useState("");
  const [isLocalDbFallback, setIsLocalDbFallback] = useState(false);

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

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Dashboard", href: "/registrar" }, { label: "Teaching Load" }]} />

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Teaching Load</h1>
          <p className="text-gray-600 mt-1 flex items-center gap-2">
            Faculty teaching assignments and subject coverage — read-only from ATLAS.
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-100 font-medium">
              AY 2026-2027
            </Badge>
          </p>
        </div>
        <Button onClick={() => void loadAll()} variant="outline" className="rounded-xl">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
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

      {/* Stats bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border border-slate-200">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl text-white" style={{ backgroundColor: colors.primary }}>
                <User className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{loadLoading ? "…" : faculty.length}</p>
                <p className="text-sm text-gray-500">Faculty Members</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-slate-200">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-500 text-white">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {coverageLoading ? "…" : coverage ? (coverage.count ?? 0) - (coverage.unassignedCount ?? 0) : "—"}
                </p>
                <p className="text-sm text-gray-500">Subjects Assigned</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-slate-200">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500 text-white">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {coverageLoading ? "…" : coverage?.unassignedCount ?? "—"}
                </p>
                <p className="text-sm text-gray-500">Unassigned Subjects</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Teaching Load Table */}
      <Card className="border border-slate-200">
        <CardHeader className="border-b border-slate-100 pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 rounded-xl text-white" style={{ backgroundColor: colors.primary }}>
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>Faculty Teaching Loads</CardTitle>
                <CardDescription>Subject assignments per faculty member</CardDescription>
              </div>
            </div>
            <Input
              placeholder="Search faculty…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-52 rounded-xl border-gray-200"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
              <p className="text-gray-700 font-medium">Unable to load teaching loads</p>
              <p className="text-gray-500 text-sm mt-1">{loadError}</p>
              <Button onClick={() => void loadAll()} variant="outline" className="mt-4 rounded-xl">Try Again</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/80">
                    <TableHead className="font-bold text-gray-700">Faculty Name</TableHead>
                    <TableHead className="font-bold text-gray-700 text-center">Subjects</TableHead>
                    <TableHead className="font-bold text-gray-700">Weekly Load</TableHead>
                    <TableHead className="font-bold text-gray-700 text-center">Load %</TableHead>
                    <TableHead className="font-bold text-gray-700">Assigned Subjects</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-gray-500">
                        No faculty found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((f: any, i: number) => {
                      // Pure teaching load percentage = ((Total Subject Hours - Advisory Equivalent) / Max Hours) * 100
                      const rawSubjectHours = f.subjectHours ?? f.weeklyHours ?? 0;
                      const advHours = f.isClassAdviser ? (f.advisoryEquivalentHours ?? 0) : 0;
                      const pureTeachingHours = Math.max(0, rawSubjectHours - advHours);
                      
                      const loadPct = f.maxHoursPerWeek 
                        ? Math.round((pureTeachingHours / f.maxHoursPerWeek) * 100) 
                        : (f.loadPercentage ?? 0);
                      
                      return (
                        <TableRow key={f.facultyId ?? i}>
                          <TableCell className="font-medium text-gray-900">
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
                              <span className="font-semibold text-gray-900">
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
                          <TableCell className="text-sm text-gray-600 max-w-xs">
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
          )}
        </CardContent>
      </Card>

      {/* Unassigned Subjects */}
      {!coverageLoading && coverage?.unassigned?.length > 0 && (
        <Card className="border border-amber-200 bg-amber-50/50">
          <CardHeader className="border-b border-amber-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500 text-white">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-amber-800">Unassigned Subjects ({coverage.unassignedCount})</CardTitle>
                <CardDescription className="text-amber-600">Subjects without a faculty assignment in ATLAS</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
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
