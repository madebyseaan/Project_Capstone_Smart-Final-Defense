import { useEffect, useRef, useState, useCallback } from "react";
import { useSyncStream } from "@/hooks/useSyncStream";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  Users,
  GraduationCap,
  ChevronRight,
  Search,
  UserCircle,
  ClipboardList,
  SplitSquareHorizontal,
  RefreshCw,
  Printer,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { advisoryApi, type AdvisoryData } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { sanitizeCssColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import AdvisoryPrintablesPanel from "./components/AdvisoryPrintablesPanel";
import AdvisoryObservedValuesPanel from "./components/AdvisoryObservedValuesPanel";

type AdvisoryView = "directory" | "printables" | "observed-values";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

export default function MyAdvisory() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const activeView: AdvisoryView =
    viewParam === "printables" || viewParam === "observed-values" ? viewParam : "directory";
  const { colors } = useTheme();
  const { syncVersion } = useSyncStream();
  const [data, setData] = useState<AdvisoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [separateByGender, setSeparateByGender] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const setActiveView = (view: AdvisoryView) => {
    const next = new URLSearchParams(searchParams);
    if (view === "directory") next.delete("view");
    else next.set("view", view);
    setSearchParams(next, { replace: true });
    requestAnimationFrame(() => {
      document.getElementById("advisory-view-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await advisoryApi.syncFromEnrollPro();
      const { studentsFound, advisorySection: foundSection } = (res.data as any);
      if (!foundSection) {
        setSyncMessage("Sync complete — no advisory section found. If you are assigned an advisory class, please contact the admin.");
      } else {
        setSyncMessage(`Sync complete — ${studentsFound} student${studentsFound !== 1 ? 's' : ''} found for ${foundSection}.`);
      }
      await fetchAdvisory(true);
    } catch {
      setSyncMessage("Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  const fetchAdvisory = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const res = await advisoryApi.getMyAdvisory();
      setData(res.data);
      hasLoadedRef.current = true;
    } catch (err) {
      if (!silent) setError("Failed to load advisory data");
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Re-fetch when navigating to the page (pathname changes) or after background sync.
  // Do not depend on location.key: switching the Student Directory / Printables view
  // updates the query string and must not reload the advisory or trigger a sync.
  // Once loaded, refreshes are silent so an open editor is never replaced by the loader.
  useEffect(() => {
    fetchAdvisory(hasLoadedRef.current);
  }, [fetchAdvisory, location.pathname, syncVersion]);

  // Silent background sync on every page load — pulls fresh data from EnrollPro
  // then re-fetches advisory so new students appear automatically
  useEffect(() => {
    advisoryApi.syncFromEnrollPro()
      .then(() => fetchAdvisory(true)) // silent=true: no spinner, no error toast
      .catch(() => {/* silent — manual button still available */});
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <div 
            className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center shadow-lg animate-pulse"
            style={{ backgroundColor: `${colors.primary}10` }}
          >
            <div 
              className="w-10 h-10 border-[3px] border-t-transparent rounded-full animate-spin"
              style={{ borderColor: colors.primary, borderTopColor: 'transparent' }}
            />
          </div>
          <p className="text-muted-foreground font-medium text-lg">Loading advisory records...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh] p-4">
        <div className="text-center max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-rose-50 flex items-center justify-center">
            <UserCircle className="w-10 h-10 text-rose-500" />
          </div>
          <h3 className="font-bold text-foreground text-2xl mb-2">Access Denied</h3>
          <p className="text-muted-foreground mb-8 text-sm leading-relaxed">{error}</p>
          <Button 
            onClick={() => window.location.reload()} 
            className="w-full h-12 rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold transition-all"
          >
            Try to Reconnect
          </Button>
        </div>
      </div>
    );
  }

  if (!data?.hasAdvisory) {
    return (
      <div className="flex items-center justify-center h-[60vh] p-4">
        <div className="text-center max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-muted flex items-center justify-center text-muted-foreground">
            <ClipboardList className="w-10 h-10" />
          </div>
          <h3 className="font-bold text-foreground text-2xl mb-3">No Advisory Assigned</h3>
          <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
            You are not currently designated as an adviser for any section. Please contact the registrar or system administrator for assignment.
          </p>
          <div className="flex flex-col gap-3">
            <Button
              onClick={handleSync}
              disabled={syncing}
              className="w-full h-12 rounded-2xl font-bold transition-all"
              style={{ backgroundColor: syncing ? undefined : colors.primary }}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
            {syncMessage && <p className="text-xs text-muted-foreground text-center">{syncMessage}</p>}
            <Link to="/teacher" className="w-full">
              <Button variant="outline" className="w-full h-12 rounded-2xl border-border text-muted-foreground font-bold hover:bg-muted transition-all">
                Return to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Filter students based on search query
  const filteredStudents = data.students?.filter((student) => {
    const fullName = `${student.lastName}, ${student.firstName} ${student.middleName || ""}`.toLowerCase();
    const lrn = student.lrn.toLowerCase();
    const query = searchQuery.toLowerCase();
    return fullName.includes(query) || lrn.includes(query);
  }) || [];

  // Separate by gender if enabled
  const maleStudents = filteredStudents
    .filter((s) => s.gender?.toLowerCase() === "male")
    .sort((a, b) => {
      const nameA = `${a.lastName}, ${a.firstName}`.toLowerCase();
      const nameB = `${b.lastName}, ${b.firstName}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

  const femaleStudents = filteredStudents
    .filter((s) => s.gender?.toLowerCase() === "female")
    .sort((a, b) => {
      const nameA = `${a.lastName}, ${a.firstName}`.toLowerCase();
      const nameB = `${b.lastName}, ${b.firstName}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

  // Combined list (alphabetically sorted)
  const sortedStudents = [...filteredStudents].sort((a, b) => {
    const nameA = `${a.lastName}, ${a.firstName}`.toLowerCase();
    const nameB = `${b.lastName}, ${b.firstName}`.toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const getGuardian = (student: NonNullable<AdvisoryData["students"]>[number]) => {
    if (student.guardianName) return student.guardianName;
    if (student.fatherName && student.motherName) return `${student.fatherName} / ${student.motherName}`;
    return student.fatherName || student.motherName || "Unspecified";
  };

  const renderMobileRow = (student: NonNullable<AdvisoryData["students"]>[number], idx: number) => {
    const isMale = student.gender?.toLowerCase() === "male";
    return (
      <Link
        key={student.id}
        to={`/teacher/advisory/student/${student.id}`}
        data-testid="student-profile-link-mobile"
        className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors active:bg-muted"
      >
        <span className="w-5 shrink-0 text-center text-[11px] font-medium text-muted-foreground">{idx + 1}</span>
        <Avatar className="h-10 w-10 shrink-0 border border-border shadow-sm">
          <AvatarFallback className={cn("text-xs font-semibold text-white", isMale ? "bg-blue-500" : "bg-pink-500")}>
            {student.lastName.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold text-foreground">
            {student.lastName}, {student.firstName}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{student.lrn}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Guardian: {getGuardian(student)}</p>
        </div>
        <Badge
          variant="secondary"
          className={cn(
            "shrink-0 rounded-md border-0 px-2 py-0.5 text-[10px] font-semibold uppercase",
            isMale ? "bg-blue-50 text-blue-600" : "bg-pink-50 text-pink-600",
          )}
        >
          {student.gender || "N/A"}
        </Badge>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* Compact mobile summary */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm lg:hidden">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Class adviser · S.Y. {data.section?.schoolYear}
            </p>
            <p className="mt-0.5 truncate text-base font-semibold text-foreground">
              {gradeLevelLabels[data.section?.gradeLevel || ""] || data.section?.gradeLevel} — {data.section?.name}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {data.teacher.name} · {data.stats?.totalStudents || 0} {(data.stats?.totalStudents || 0) === 1 ? "learner" : "learners"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveView("printables")}
            data-testid="advisory-printables-mobile"
            aria-label="Open advisory printables"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors active:bg-muted"
          >
            <Printer className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            aria-label="Sync from EnrollPro"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors active:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-border rounded-xl bg-muted/40 py-2 text-center">
          <div>
            <p className="text-lg font-bold leading-none text-foreground">{data.stats?.totalStudents || 0}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total</p>
          </div>
          <div>
            <p className="text-lg font-bold leading-none text-foreground">{data.stats?.maleCount || 0}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Male</p>
          </div>
          <div>
            <p className="text-lg font-bold leading-none text-foreground">{data.stats?.femaleCount || 0}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Female</p>
          </div>
        </div>

        {syncMessage && (
          <p className="mt-2 text-xs font-medium text-muted-foreground">{syncMessage}</p>
        )}
      </section>

      {/* Header Section - Refined Glass Style */}
      <div className="relative hidden overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm lg:block lg:p-6">
        
        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-6">
          <div className="flex items-center gap-3 lg:gap-5">
            <div 
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg transition-all duration-500 lg:h-16 lg:w-16 lg:rounded-3xl"
              style={{ 
                backgroundColor: colors.primary,
                boxShadow: `0 20px 25px -5px ${colors.primary}40, 0 10px 10px -5px ${colors.primary}20`
              }}
            >
              <GraduationCap className="h-7 w-7 lg:h-10 lg:w-10" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1.5">
                <Badge 
                  variant="secondary" 
                  className="text-[10px] font-bold uppercase tracking-widest px-3 border"
                  style={{ 
                    backgroundColor: `${colors.primary}10`, 
                    color: colors.primary,
                    borderColor: `${colors.primary}20`
                  }}
                >
                  Class Adviser
                </Badge>
                <div className="h-4 w-px bg-border" />
                <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">S.Y. {data.section?.schoolYear}</span>
              </div>
              <PageHeader
                variant="plain"
                title={`${gradeLevelLabels[data.section?.gradeLevel || ""] || data.section?.gradeLevel} — ${data.section?.name}`}
                description={`${data.stats?.totalStudents || 0} ${(data.stats?.totalStudents || 0) === 1 ? "Learner" : "Learners"} Managed`}
              />
            </div>
          </div>
          
          <div className="flex flex-col items-stretch gap-2 md:items-end">
            <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 shadow-sm">
               <Avatar className="h-9 w-9 border-2 border-white shadow-md">
                 <AvatarFallback 
                    className="text-white font-bold text-sm"
                    style={{ backgroundColor: colors.primary }}
                 >
                   {data.teacher.name.charAt(0)}
                 </AvatarFallback>
               </Avatar>
               <div>
                 <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest leading-none mb-1">Assigned Teacher</p>
                 <p className="text-sm font-bold text-foreground tracking-tight">{data.teacher.name}</p>
               </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <Button
                variant="outline"
                size="sm"
                data-testid="advisory-printables-link"
                onClick={() => setActiveView("printables")}
                className="h-10 flex-1 rounded-2xl border-border px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-all hover:bg-muted hover:text-foreground sm:flex-none"
              >
                <Printer className="mr-2 h-3.5 w-3.5" />
                Printables
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing}
                className="h-10 flex-1 rounded-2xl border-border px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-all group/sync sm:flex-none"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-2 ${syncing ? 'animate-spin' : ''} group-hover/sync:text-primary`} />
                <span className="group-hover/sync:text-foreground">{syncing ? 'SYNCING...' : 'SYNC FROM ENROLLPRO'}</span>
                <style dangerouslySetInnerHTML={{ __html: `
                  .group\\/sync:hover {
                    background-color: ${sanitizeCssColor(colors.primary)}10 !important;
                    border-color: ${sanitizeCssColor(colors.primary)}30 !important;
                    color: ${sanitizeCssColor(colors.primary)} !important;
                  }
                `}} />
              </Button>
            </div>
            {syncMessage && (
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{syncMessage}</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick Insights Grid */}
      <div className="hidden grid-cols-3 gap-2 lg:grid lg:gap-6">
        {[
          { label: "TOTAL CLASS", value: data.stats?.totalStudents || 0, icon: Users, color: "theme" },
          { label: "MALE LEARNERS", value: data.stats?.maleCount || 0, icon: UserCircle, color: "blue" },
          { label: "FEMALE LEARNERS", value: data.stats?.femaleCount || 0, icon: UserCircle, color: "pink" },
        ].map((stat) => (
          <Card key={stat.label} className="group overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1">
            <CardContent className="flex flex-col items-start gap-2 p-3 sm:flex-row sm:items-center sm:gap-4 lg:p-6">
              <div 
                className={cn(
                  "rounded-xl p-2 transition-transform group-hover:scale-110 lg:p-3.5 lg:rounded-2xl",
                  stat.color === "blue" ? "bg-blue-50 text-blue-600" : 
                  stat.color === "pink" ? "bg-pink-50 text-pink-600" : ""
                )}
                style={stat.color === "theme" ? { 
                  backgroundColor: `${colors.primary}15`, 
                  color: colors.primary 
                } : {}}
              >
                <stat.icon className="h-5 w-5 lg:h-6 lg:w-6" />
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-bold leading-none text-foreground lg:text-2xl">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* View tabs */}
      <div
        id="advisory-view-tabs"
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Advisory views"
      >
        <Button
          type="button"
          aria-pressed={activeView === "directory"}
          data-testid="advisory-view-directory"
          variant={activeView === "directory" ? "default" : "outline"}
          onClick={() => setActiveView("directory")}
          className="h-11 gap-2 text-xs font-semibold"
        >
          <Users className="h-4 w-4" />
          Student Directory
        </Button>
        <Button
          type="button"
          aria-pressed={activeView === "printables"}
          data-testid="advisory-view-printables"
          variant={activeView === "printables" ? "default" : "outline"}
          onClick={() => setActiveView("printables")}
          className="h-11 gap-2 text-xs font-semibold"
        >
          <Printer className="h-4 w-4" />
          Printables
        </Button>
        <Button
          type="button"
          aria-pressed={activeView === "observed-values"}
          data-testid="advisory-view-observed-values"
          variant={activeView === "observed-values" ? "default" : "outline"}
          onClick={() => setActiveView("observed-values")}
          className="h-11 gap-2 text-xs font-semibold"
        >
          <ClipboardList className="h-4 w-4" />
          Observed Values
        </Button>
      </div>

      {activeView === "observed-values" ? (
        <AdvisoryObservedValuesPanel />
      ) : activeView === "printables" ? (
        <AdvisoryPrintablesPanel />
      ) : (
      /* Main Directory Table */
      <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="flex flex-col justify-between gap-4 border-b border-border p-4 pb-4 sm:flex-row sm:items-center lg:p-8 lg:pb-6">
          <div className="flex flex-wrap items-center gap-3 lg:gap-5">
            <h2 className="text-lg font-semibold tracking-tight text-foreground lg:text-xl">Student directory</h2>
            <div className="hidden h-6 w-px bg-border sm:block" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSeparateByGender(!separateByGender)}
              aria-pressed={separateByGender}
              className={cn(
                "h-12 rounded-xl border px-3 text-[10px] font-semibold uppercase tracking-wide transition-all lg:h-9 lg:px-4",
                separateByGender ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <SplitSquareHorizontal className="mr-2 h-4 w-4" />
              {separateByGender ? "Gender separated" : "By gender"}
            </Button>
          </div>
          
          <div className="relative w-full group sm:w-80">
            <div className="absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-focus-within:bg-primary group-focus-within:text-primary-foreground">
              <Search className="h-4 w-4" />
            </div>
            <Input
              type="search"
              inputMode="search"
              placeholder="Search by name or LRN"
              aria-label="Search advisory learners"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-12 rounded-xl border-border bg-background pl-12 text-base font-medium lg:h-11 lg:text-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Mobile card directory */}
          <div className="divide-y divide-border lg:hidden">
            {separateByGender ? (
              <>
                {maleStudents.length > 0 && (
                  <div>
                    <p className="bg-blue-50/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-blue-600">
                      Male students ({maleStudents.length})
                    </p>
                    <div className="divide-y divide-border">{maleStudents.map((s, i) => renderMobileRow(s, i))}</div>
                  </div>
                )}
                {femaleStudents.length > 0 && (
                  <div>
                    <p className="bg-pink-50/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-pink-600">
                      Female students ({femaleStudents.length})
                    </p>
                    <div className="divide-y divide-border">{femaleStudents.map((s, i) => renderMobileRow(s, i))}</div>
                  </div>
                )}
              </>
            ) : sortedStudents.length === 0 ? (
              <div className="px-4 py-16 text-center">
                <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">
                  {searchQuery ? "No matching records found" : "No enrolled students yet"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">{sortedStudents.map((s, i) => renderMobileRow(s, i))}</div>
            )}
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-transparent border-0">
                  <TableHead className="w-16 text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-8">#</TableHead>
                  <TableHead className="w-40 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Learner Reference (LRN)</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Full Legal Name</TableHead>
                  {!separateByGender && <TableHead className="text-center w-32 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Gender</TableHead>}
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Parent / Guardian</TableHead>
                  <TableHead className="w-32 text-right pr-8 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const renderRow = (student: any, idx: number) => (
                    <TableRow key={student.id} className="hover:bg-muted/40 transition-all border-border group">
                      <TableCell className="text-center text-muted-foreground font-bold text-[10px] px-8">{idx + 1}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground font-bold tracking-tighter group-hover:text-foreground transition-colors">{student.lrn}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-4">
                          <Avatar className="w-9 h-9 border-2 border-white shadow-sm ring-1 ring-slate-100">
                            <AvatarFallback className={cn(
                              "text-white font-bold text-xs",
                              student.gender?.toLowerCase() === "male" ? "bg-blue-500" : "bg-pink-500"
                            )}>
                              {student.lastName.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-bold text-foreground text-sm tracking-tight">{student.lastName}, {student.firstName}</p>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">{student.middleName || ""}</p>
                          </div>
                        </div>
                      </TableCell>
                      {!separateByGender && (
                        <TableCell className="text-center">
                          <Badge 
                            variant="secondary" 
                            className={cn(
                              "text-[10px] font-bold uppercase px-3 h-6 rounded-lg border-0",
                              student.gender?.toLowerCase() === "male" ? "bg-blue-50 text-blue-600" : "bg-pink-50 text-pink-600"
                            )}
                          >
                            {student.gender || 'N/A'}
                          </Badge>
                        </TableCell>
                      )}
                      <TableCell className="text-xs text-muted-foreground font-bold italic">
                        {student.guardianName || student.fatherName || student.motherName
                          ? student.guardianName || `${student.fatherName || ''}${student.fatherName && student.motherName ? ' / ' : ''}${student.motherName || ''}`
                          : <span className="text-muted-foreground">UNSPECIFIED</span>}
                      </TableCell>
                      <TableCell className="text-right pr-8">
                        <Link
                          to={`/teacher/advisory/student/${student.id}`}
                          data-testid="student-profile-link"
                        >
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-10 px-4 rounded-xl text-muted-foreground font-bold text-[10px] tracking-widest uppercase transition-all group/profile"
                          >
                            <span className="group-hover/profile:text-primary">PROFILE</span>
                            <ChevronRight className="w-4 h-4 ml-2 group-hover/profile:translate-x-1 transition-transform" />
                            <style dangerouslySetInnerHTML={{ __html: `
                              .group\\/profile:hover {
                                background-color: ${sanitizeCssColor(colors.primary)}10 !important;
                                color: ${sanitizeCssColor(colors.primary)} !important;
                              }
                            `}} />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );

                  if (separateByGender) {
                    return (
                      <>
                        {maleStudents.length > 0 && (
                          <>
                            <TableRow className="bg-blue-50/20 hover:bg-blue-50/20 border-y border-blue-100/30">
                              <TableCell colSpan={6} className="py-3 px-8">
                                <span className="text-[11px] font-bold text-blue-600 uppercase tracking-[0.2em] flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                                  MALE STUDENTS ({maleStudents.length})
                                </span>
                              </TableCell>
                            </TableRow>
                            {maleStudents.map((s, i) => renderRow(s, i))}
                          </>
                        )}
                        {femaleStudents.length > 0 && (
                          <>
                            <TableRow className="bg-pink-50/20 hover:bg-pink-50/20 border-y border-pink-100/30">
                              <TableCell colSpan={6} className="py-3 px-8">
                                <span className="text-[11px] font-bold text-pink-600 uppercase tracking-[0.2em] flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-pink-500" />
                                  FEMALE STUDENTS ({femaleStudents.length})
                                </span>
                              </TableCell>
                            </TableRow>
                            {femaleStudents.map((s, i) => renderRow(s, i))}
                          </>
                        )}
                      </>
                    );
                  }

                  if (sortedStudents.length === 0) {
                    return (
                      <TableRow>
                        <TableCell colSpan={6} className="py-24 text-center">
                          <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
                            <Search className="w-8 h-8 text-muted-foreground" />
                          </div>
                          <p className="text-muted-foreground font-bold text-xs uppercase tracking-widest">
                            {searchQuery ? "No matching records found" : "No enrolled students yet"}
                          </p>
                          {!searchQuery && (
                            <p className="text-muted-foreground text-xs mt-2">
                              Enrollment for this school year has not yet opened in EnrollPro.
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return sortedStudents.map((s, i) => renderRow(s, i));
                })()}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
