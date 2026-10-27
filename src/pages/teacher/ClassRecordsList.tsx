import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  LayoutGrid,
  Link2,
  List,
  Plug,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { gradesApi, advisoryApi, publicSettingsApi, type ClassAssignment, type GradeDeadlineInfo, type PublicSettingsData, type TermLabels } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { GradeStatusBanner } from "@/components/GradeStatusBanner";
import { useSyncStream } from "@/hooks/useSyncStream";
import { GradeDeadlineBanner } from "@/components/GradeDeadlineBanner";
import { PageHeader } from "@/components/layout/PageHeader";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

function getGradeColors(gradeLevel: string) {
  switch (gradeLevel) {
    case "GRADE_7": return { 
      badge: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20", 
      circle: "bg-emerald-400",
      decor: "bg-emerald-50/50 group-hover:bg-emerald-50",
      button: "bg-emerald-50 text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white"
    };
    case "GRADE_8": return { 
      badge: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20", 
      circle: "bg-amber-400",
      decor: "bg-amber-50/50 group-hover:bg-amber-50",
      button: "bg-amber-50 text-amber-400 group-hover:bg-amber-600 group-hover:text-white"
    };
    case "GRADE_9": return { 
      badge: "bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20", 
      circle: "bg-rose-400",
      decor: "bg-rose-50/50 group-hover:bg-rose-50",
      button: "bg-rose-50 text-rose-400 group-hover:bg-rose-600 group-hover:text-white"
    };
    case "GRADE_10": return { 
      badge: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20", 
      circle: "bg-blue-400",
      decor: "bg-blue-50/50 group-hover:bg-blue-50",
      button: "bg-blue-50 text-blue-400 group-hover:bg-blue-600 group-hover:text-white"
    };
    default: return { 
      badge: "bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20", 
      circle: "bg-indigo-400",
      decor: "bg-indigo-50/50 group-hover:bg-indigo-50",
      button: "bg-indigo-50 text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white"
    };
  }
}

function AssignmentCard({ 
  assignment, 
  archived,
  currentTerm,
  onDelete 
}: { 
  assignment: ClassAssignment; 
  archived: boolean;
  currentTerm: string;
  onDelete?: (id: string, name: string) => void;
}) {
  const navigate = useNavigate();
  const isTransferred = archived && assignment.archivedReason === 'ATLAS_REASSIGNED';
  const isOffTerm = !archived && !!assignment.subject.rotationTermRank && `T${assignment.subject.rotationTermRank}` !== currentTerm;
  const titleHover = archived ? (isTransferred ? "group-hover:text-amber-700" : "group-hover:text-rose-600") : "group-hover:text-primary";
  const colors = getGradeColors(assignment.section.gradeLevel);
  const badgeClass = archived
    ? (isTransferred ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-rose-100 text-rose-700 border-rose-200")
    : colors.badge;
  const circleClass = archived ? (isTransferred ? "bg-amber-400" : "bg-rose-400") : colors.circle;
  const containerClass = archived
    ? (isTransferred
      ? "border border-amber-200 shadow-xl shadow-amber-100/50 hover:shadow-2xl hover:shadow-amber-200"
      : "border border-rose-200 shadow-xl shadow-rose-100/50 hover:shadow-2xl hover:shadow-rose-200")
    : "border border-border shadow-sm hover:shadow-md";
  const cardBg = "bg-card";
  const sectionText = archived ? (isTransferred ? "text-amber-600" : "text-rose-500") : "text-muted-foreground";
  const mutedText = archived ? (isTransferred ? "text-amber-500" : "text-rose-400") : "text-muted-foreground";
  const iconClass = archived
    ? (isTransferred
      ? "w-8 h-8 rounded-lg bg-amber-50 text-amber-500 group-hover:bg-amber-600 group-hover:text-white"
      : "w-8 h-8 rounded-lg bg-rose-50 text-rose-500 group-hover:bg-rose-600 group-hover:text-white")
    : "w-10 h-10 rounded-xl bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground";
  const chevronClass = archived
    ? (isTransferred ? "w-10 h-10 rounded-xl bg-amber-100 text-amber-400" : "w-10 h-10 rounded-xl bg-rose-100 text-rose-400")
    : "w-12 h-12 rounded-2xl bg-muted text-muted-foreground";
  const displayWwWeight = assignment.effectiveWeights?.ww ?? assignment.subject.writtenWorkWeight;
  const displayPtWeight = assignment.effectiveWeights?.pt ?? assignment.subject.perfTaskWeight;
  const displayQaWeight = assignment.effectiveWeights?.qa ?? assignment.subject.quarterlyAssessWeight;

  return (
    <div className="relative group/card h-full">
      <Link to={`/teacher/records/${assignment.id}`} className="group block h-full">
        <Card className={`h-full ${containerClass} transition-all duration-300 rounded-2xl ${cardBg} overflow-hidden flex flex-col relative lg:group-hover:-translate-y-2`}>
          <CardHeader className={`${archived ? 'p-4 pb-3 lg:p-6' : 'p-5 pb-4 lg:p-8'} relative z-10`}>
            <div className={`flex items-start justify-between ${archived ? 'mb-4' : 'mb-4 lg:mb-8'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`${badgeClass} text-[10px] font-bold uppercase tracking-[0.1em] ${archived ? 'px-3 py-1' : 'px-4 py-1.5'} rounded-full`}>
                  {archived ? (isTransferred ? "TRANSFERRED" : "ARCHIVED") : gradeLevelLabels[assignment.section.gradeLevel]}
                </Badge>
                {!archived && (assignment.subject as any).rotationTermRank && (
                  <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full" title={`Rotating subject — taught in one term only. Other terms are separate class records for this section.`}>
                    Rotating · {["Term 1", "Term 2", "Term 3"][(assignment.subject as any).rotationTermRank - 1] ?? `Term ${(assignment.subject as any).rotationTermRank}`}
                  </Badge>
                )}
              </div>
              <div className={`${archived ? 'w-9 h-9 rounded-lg' : 'w-11 h-11 rounded-xl'} ${archived ? (isTransferred ? "bg-amber-50 text-amber-500 group-hover:bg-amber-600 group-hover:text-white" : "bg-rose-50 text-rose-500 group-hover:bg-rose-600 group-hover:text-white") : "bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground"} flex items-center justify-center transition-colors shadow-sm`}>
                <ArrowUpRight className={`${archived ? 'w-4 h-4' : 'w-5 h-5'}`} />
              </div>
            </div>

            <div className="space-y-1">
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${mutedText}`}>Subject title</p>
              <h3 className={`${archived ? 'text-lg' : 'text-xl lg:text-3xl'} font-semibold text-foreground ${titleHover} transition-colors leading-tight`}>
                {assignment.subject.name}
              </h3>
            </div>

            <div className={`${archived ? 'pt-3' : 'pt-4'} flex items-center gap-2`}>
              <div className={`w-1.5 h-1.5 rounded-full ${circleClass} ${isOffTerm ? '' : 'animate-pulse'}`} />
              <p className={`${archived ? 'text-xs' : 'text-sm'} font-bold ${sectionText}`}>
                Section {assignment.section.name} &bull; {assignment.schoolYear}
              </p>
            </div>

            {isTransferred && (assignment as any).successorTeacherName && (
              <p className="mt-3 text-[10px] font-bold text-amber-700 bg-amber-50 rounded-xl px-3 py-2 border border-amber-100 leading-relaxed">
                Transferred to {(assignment as any).successorTeacherName}
              </p>
            )}

            {archived && !isTransferred && assignment.archivedReason && (
              <p className="mt-3 text-[10px] font-bold text-rose-600 bg-rose-50 rounded-xl px-3 py-2 border border-rose-100 leading-relaxed line-clamp-2">
                {assignment.archivedReason}
              </p>
            )}
          </CardHeader>

          <CardContent className={`${archived ? 'p-4 pt-4 lg:p-6' : 'p-5 pt-6 lg:p-8'} mt-auto relative z-10`}>
            <div className={`flex items-center justify-between ${archived ? 'pt-4' : 'pt-6'} border-t ${archived ? (isTransferred ? "border-amber-100" : "border-rose-100") : "border-border"}`}>
              <div className={`flex items-center ${archived ? 'gap-2' : 'gap-3'}`}>
                <div className={`${iconClass} flex items-center justify-center transition-colors shadow-sm`}>
                  <Users className={`${archived ? 'w-4 h-4' : 'w-5 h-5'}`} />
                </div>
                <div>
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${mutedText}`}>Enrolled</p>
                  <p className={`${archived ? 'text-xs' : 'text-sm'} font-bold text-foreground`}>{assignment.section.enrollments?.length || 0} {assignment.section.enrollments?.length === 1 ? "Learner" : "Learners"}</p>
                </div>
              </div>

              <div className="text-right">
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${mutedText}`}>Weights</p>
                <p className={`${archived ? 'text-[10px]' : 'text-xs'} font-bold text-foreground font-mono tracking-tighter`}>
                  {displayWwWeight}/{displayPtWeight}/{displayQaWeight} (TA)
                </p>
              </div>
            </div>

            <div className={`${archived ? 'mt-3' : 'mt-4'} flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <Badge className={`${archived ? (isTransferred ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-rose-100 text-rose-700 border-rose-200") : isOffTerm ? "bg-amber-50 text-amber-700 border-amber-200" : colors.badge} text-[10px] font-bold uppercase tracking-widest ${archived ? 'px-2' : 'px-3'}`}>
                  {archived ? (isTransferred ? "Transferred" : "Backup") : isOffTerm ? (assignment.subject as any).rotationOutputLabel ?? "Rotating" : "Active Record"}
                </Badge>
                {!archived && !isOffTerm && !assignment.aimsCourseId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate(`/teacher/records/${assignment.id}?connect=aims`);
                    }}
                    className="inline-flex min-h-12 items-center gap-1 rounded-full border border-[var(--ledger-aims)]/30 bg-[var(--ledger-aims-bg)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--ledger-aims)] transition-colors hover:bg-[var(--ledger-aims)]/10 lg:min-h-0 lg:px-2.5 lg:py-1"
                  >
                    <Link2 className="w-3 h-3" />
                    Connect AIMS
                  </button>
                )}
                {!archived && !isOffTerm && assignment.aimsCourseId && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)] border border-[var(--ledger-aims)]/20" title="AIMS course connected">
                    <Plug className="w-3 h-3" />
                    AIMS ✓
                  </span>
                )}
              </div>
              <div className={`${chevronClass} flex items-center justify-center transition-all group-hover:translate-x-2`}>
                <ChevronRight className={`${archived ? 'w-5 h-5' : 'w-6 h-6'}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
      {archived && !isTransferred && onDelete && (
        <Button
          variant="destructive"
          size="icon"
          className="absolute -top-2 -right-2 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition-all opacity-100 lg:opacity-0 lg:group-hover/card:opacity-100 hover:bg-rose-700 active:scale-95"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(assignment.id, assignment.subject.name);
          }}
          aria-label={`Delete ${assignment.subject.name}`}
        >
          <Trash2 className="w-5 h-5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export default function ClassRecordsList() {
  const { colors } = useTheme();
  const navigate = useNavigate();
  const { syncVersion } = useSyncStream();
  const [classes, setClasses] = useState<ClassAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [gradeDeadline, setGradeDeadline] = useState<GradeDeadlineInfo | null>(null);
  const [termLabels, setTermLabels] = useState<TermLabels>({ T1: "Term 1", T2: "Term 2", T3: "Term 3" });
  const [termDatesDerived, setTermDatesDerived] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? "grid" : "list",
  );
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const [assignmentToDelete, setAssignmentToDelete] = useState<{ id: string; name: string } | null>(null);
  const [termFilter, setTermFilter] = useState<"current" | "full">("current");
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      await advisoryApi.syncFromEnrollPro();
      setSyncMessage("Sync complete — class records updated.");
      // Re-fetch classes
      const classesRes = await gradesApi.getMyClasses();
      setClasses(classesRes.data);
    } catch {
      setSyncMessage("Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  // Silent background sync on every page load — pulls teaching loads (ATLAS) + rosters (EnrollPro)
  useEffect(() => {
    advisoryApi.syncFromEnrollPro().catch(() => {/* silent fallback */});
  }, []);

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const [classesRes, deadlineRes, settingsRes] = await Promise.all([
          gradesApi.getMyClasses(),
          gradesApi.getDeadlineStatus().catch(() => ({ data: { gradeDeadline: null } })),
          publicSettingsApi.getSettings().catch(
            (): { data: PublicSettingsData } => ({
              data: { settings: {}, termLabels: { T1: "Term 1", T2: "Term 2", T3: "Term 3" } },
            }),
          ),
        ]);
        setClasses(classesRes.data);
        setGradeDeadline(deadlineRes.data.gradeDeadline);
        if (settingsRes.data.termLabels) setTermLabels(settingsRes.data.termLabels);
        if (settingsRes.data.settings?.termDatesDerived) setTermDatesDerived(true);
      } catch (err) {
        console.error("Failed to fetch classes:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchClasses();
  }, [syncVersion]);

  const handleDelete = async () => {
    if (!assignmentToDelete) return;
    setIsDeleting(true);
    try {
      await gradesApi.deleteClassAssignment(assignmentToDelete.id);
      setClasses(classes.filter((c) => c.id !== assignmentToDelete.id));
      setAssignmentToDelete(null);
    } catch (err) {
      console.error("Failed to delete class:", err);
      alert("Failed to delete class record. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    try {
      await gradesApi.deleteAllArchivedClassAssignments();
      setClasses(classes.filter((c) => c.isActive !== false && !c.archivedAt));
      setConfirmDeleteAll(false);
    } catch (err) {
      console.error("Failed to delete all archived classes:", err);
      alert("Failed to delete all archived records. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredClasses = classes.filter(
    (c) =>
      c.subject.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.section.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      gradeLevelLabels[c.section.gradeLevel].toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeClasses = filteredClasses.filter(
    (assignment) => assignment.isActive !== false && !assignment.archivedAt && (assignment.section.enrollments?.length ?? 0) > 0
  );
  const archivedClasses = filteredClasses.filter((assignment) => assignment.isActive === false || !!assignment.archivedAt);
  const currentTerm = gradeDeadline?.currentTerm ?? "T1";
  const termFilteredClasses = termFilter === "current"
    ? activeClasses.filter((a) => !a.subject.rotationTermRank || `T${a.subject.rotationTermRank}` === currentTerm)
    : activeClasses;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <div
            className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center shadow-lg animate-pulse"
            style={{ backgroundColor: `${colors.primary}15` }}
          >
            <div
              className="w-10 h-10 border-[3px] border-t-transparent rounded-full animate-spin"
              style={{ borderColor: colors.primary, borderTopColor: "transparent" }}
            />
          </div>
          <p className="text-muted-foreground font-medium text-lg">Loading class rosters...</p>
        </div>
      </div>
    );
  }

  const hasArchived = archivedClasses.length > 0;

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* Grade Submission Deadline Banner */}
      {gradeDeadline && (
        <GradeDeadlineBanner deadline={gradeDeadline} hideLink />
      )}

      {/* Grade Status Banner */}
      <GradeStatusBanner
        currentTerm={gradeDeadline?.currentTerm ?? "T1"}
        termEndDate={gradeDeadline?.currentTerm === "T1" ? gradeDeadline?.t1EndDate : gradeDeadline?.currentTerm === "T2" ? gradeDeadline?.t2EndDate : gradeDeadline?.t3EndDate}
        gradeLock={gradeDeadline?.gradeLock ?? false}
        colors={colors}
        termLabels={termLabels}
        termDatesDerived={termDatesDerived}
      />

      {(activeClasses.length > 0 || hasArchived) && (
        <>
          <div className="flex items-center justify-between gap-3 lg:hidden">
            <p className="text-sm font-medium text-foreground">
              {termFilteredClasses.length} {termFilter === "current" ? "classes this term" : "active classes"}
            </p>
            {hasArchived && (
              <p className="text-xs font-medium text-muted-foreground">
                {archivedClasses.length} archived
              </p>
            )}
          </div>
          <div className="hidden lg:block">
            <PageHeader
              title="Class Records"
              description="Open a class to manage grades"
              badge={
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-100 text-[10px] font-bold uppercase tracking-widest px-3">
                    {termFilteredClasses.length} {termFilter === "current" ? "THIS TERM" : "ACTIVE CLASSES"}
                  </Badge>
                  {hasArchived && (
                    <Badge className="bg-rose-600 text-white border-rose-200 text-[10px] font-bold uppercase tracking-widest px-3 shadow-lg shadow-rose-100">
                      {archivedClasses.length} BACKUP ARCHIVED
                    </Badge>
                  )}
                </div>
              }
            />
          </div>
        </>
      )}

      {(activeClasses.length > 0 || hasArchived) && (
        <Card className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <CardContent className="p-4 lg:p-6">
            <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:gap-6">
              <div className="relative w-full flex-1 group">
                <div className="absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-focus-within:bg-primary group-focus-within:text-primary-foreground">
                  <Search className="w-4 h-4" />
                </div>
                <Input
                  type="search"
                  inputMode="search"
                  placeholder="Search subject, section, or grade"
                  aria-label="Search class records"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-12 rounded-xl border-border bg-background pl-12 text-base font-medium lg:h-11 lg:text-sm"
                />
              </div>

              <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:gap-4">
                <div className="flex flex-1 items-center rounded-xl bg-muted p-1 lg:flex-none">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-12 flex-1 rounded-lg px-3 text-xs font-semibold transition-all lg:flex-none lg:px-4 ${termFilter === "current" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setTermFilter("current")}
                  >
                    This term
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-12 flex-1 rounded-lg px-3 text-xs font-semibold transition-all lg:flex-none lg:px-4 ${termFilter === "full" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setTermFilter("full")}
                  >
                    Full year
                  </Button>
                </div>

                <div className="hidden items-center rounded-xl bg-muted p-1 lg:flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Grid view"
                    aria-pressed={viewMode === "grid"}
                    className={`h-12 w-12 rounded-lg transition-all ${viewMode === "grid" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                    onClick={() => setViewMode("grid")}
                  >
                    <LayoutGrid className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="List view"
                    aria-pressed={viewMode === "list"}
                    className={`h-12 w-12 rounded-lg transition-all ${viewMode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                    onClick={() => setViewMode("list")}
                  >
                    <List className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {viewMode === "grid" && (
        <div className="hidden space-y-10 lg:block">
          {termFilteredClasses.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
              {termFilteredClasses.map((assignment) => (
                <AssignmentCard key={assignment.id} assignment={assignment} archived={false} currentTerm={currentTerm} />
              ))}
            </div>
          )}

          {hasArchived && (
            <div className="space-y-6">
              <div 
                className="flex cursor-pointer flex-col gap-3 group sm:flex-row sm:items-center sm:justify-between"
                onClick={() => setIsArchivedExpanded(!isArchivedExpanded)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsArchivedExpanded(!isArchivedExpanded); } }}
                role="button"
                tabIndex={0}
                aria-expanded={isArchivedExpanded}
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-rose-100 text-rose-600">
                    <Archive className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground lg:text-2xl">Archived class records</h2>
                    <p className="text-muted-foreground font-medium">Backup data from previous syncs or manual archives</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isArchivedExpanded && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-12 rounded-xl bg-rose-600 px-4 font-semibold text-white hover:bg-rose-700 shadow-lg shadow-rose-100 animate-in fade-in slide-in-from-right-4 text-[10px] tracking-widest uppercase"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteAll(true);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      DELETE ALL
                    </Button>
                  )}
                  <Badge className="bg-rose-50 text-rose-600 border-rose-100 font-bold px-4 py-2 rounded-xl">
                    {archivedClasses.length} RECORD{archivedClasses.length === 1 ? "" : "S"}
                  </Badge>
                  <div className="w-12 h-12 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center group-hover:bg-rose-600 group-hover:text-white transition-all">
                    {isArchivedExpanded ? <ChevronUp className="w-6 h-6" /> : <ChevronDown className="w-6 h-6" />}
                  </div>
                </div>
              </div>

              {isArchivedExpanded && (
                <div className="relative">
                  <div className="flex flex-col gap-4 pb-8 pt-2 rose-scrollbar lg:flex-row lg:gap-6 lg:overflow-x-auto lg:snap-x lg:snap-mandatory">
                    {archivedClasses.map((assignment) => (
                      <div key={assignment.id} className="w-full shrink-0 lg:w-[320px] lg:snap-start">
                        <AssignmentCard assignment={assignment} archived currentTerm={currentTerm} onDelete={(id, name) => setAssignmentToDelete({ id, name })} />
                      </div>
                    ))}
                  </div>
                  {/* Fade indicators for scroll */}
                  <div className="absolute top-0 right-0 h-full w-20 bg-gradient-to-l from-slate-50/50 to-transparent pointer-events-none" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {viewMode === "list" && (
        <div className="space-y-10">
          {termFilteredClasses.length > 0 && (
            <>
            {/* Mobile list rows */}
            <Card className="overflow-hidden rounded-2xl border border-border bg-card lg:hidden">
              <div className="divide-y divide-border">
                {termFilteredClasses.map((assignment) => {
                  const isListOffTerm = !!assignment.subject.rotationTermRank && `T${assignment.subject.rotationTermRank}` !== currentTerm;
                  return (
                    <Link
                      key={assignment.id}
                      to={`/teacher/records/${assignment.id}`}
                      className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors active:bg-muted"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <BookOpen className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-semibold text-foreground">{assignment.subject.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          Section {assignment.section.name} · {assignment.schoolYear}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge className={`${getGradeColors(assignment.section.gradeLevel).badge} border-0 px-2 text-[10px] font-semibold uppercase tracking-wide`}>
                            {gradeLevelLabels[assignment.section.gradeLevel]}
                          </Badge>
                          {(assignment.subject as any).rotationTermRank && (
                            <Badge className={`${isListOffTerm ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"} px-2 text-[10px] font-semibold uppercase tracking-wide`}>
                              Rotating · Term {(assignment.subject as any).rotationTermRank}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-base font-bold leading-none text-foreground">{assignment.section.enrollments?.length || 0}</p>
                        <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">learners</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
            </Card>

            {/* Desktop list rows */}
            <Card className="hidden overflow-hidden rounded-2xl border border-border bg-card lg:block">
              <div className="divide-y divide-slate-50">
                {termFilteredClasses.map((assignment) => {
                  const isListOffTerm = !!assignment.subject.rotationTermRank && `T${assignment.subject.rotationTermRank}` !== currentTerm;
                  return (
                  <Link key={assignment.id} to={`/teacher/records/${assignment.id}`} className="block group">
                    <div className="flex flex-col gap-3 p-4 transition-all duration-300 hover:bg-muted/40 group lg:flex-row lg:items-center lg:gap-8 lg:p-6">
                      <div className="w-16 h-16 rounded-[1.5rem] bg-muted text-muted-foreground flex items-center justify-center group-hover:bg-primary group-hover:text-white group-hover:shadow-xl group-hover:shadow-indigo-100 transition-all duration-500">
                        <BookOpen className="w-8 h-8" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-foreground transition-colors group-hover:text-primary lg:text-2xl">{assignment.subject.name}</h3>
                          <Badge className={`${getGradeColors(assignment.section.gradeLevel).badge} border-0 text-[10px] font-bold uppercase tracking-widest px-3`}>
                            {gradeLevelLabels[assignment.section.gradeLevel]}
                          </Badge>
                          {(assignment.subject as any).rotationTermRank && (
                            <Badge className={`${isListOffTerm ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"} text-[10px] font-bold uppercase tracking-widest px-3`} title="Rotating subject — taught in one term only. Other terms are separate class records for this section.">
                    Rotating · {["Term 1", "Term 2", "Term 3"][(assignment.subject as any).rotationTermRank - 1] ?? `Term ${(assignment.subject as any).rotationTermRank}`}
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground font-bold text-sm uppercase tracking-widest">
                          Section {assignment.section.name} &bull; {assignment.schoolYear}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 lg:gap-12">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-foreground leading-none">{assignment.section.enrollments?.length || 0}</p>
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mt-2">Learners</p>
                        </div>

                        <div className="hidden lg:block">
                          <div className="px-5 py-3 rounded-2xl border border-border bg-muted/50 group-hover:bg-card transition-colors">
                            <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mb-1 text-center">WW / PT / TA</p>
                            <p className="text-sm text-foreground font-bold font-mono tracking-tighter text-center">
                              {assignment.effectiveWeights?.ww ?? assignment.subject.writtenWorkWeight} / {assignment.effectiveWeights?.pt ?? assignment.subject.perfTaskWeight} / {assignment.effectiveWeights?.qa ?? assignment.subject.quarterlyAssessWeight}
                            </p>
                          </div>
                        </div>

                        {!isListOffTerm && !assignment.aimsCourseId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              navigate(`/teacher/records/${assignment.id}?connect=aims`);
                            }}
                            className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)] border border-[var(--ledger-aims)]/30 hover:bg-[var(--ledger-aims)]/10 transition-colors"
                          >
                            <Link2 className="w-3 h-3" />
                            Connect AIMS
                          </button>
                        )}
                        {!isListOffTerm && assignment.aimsCourseId && (
                          <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full bg-[var(--ledger-aims-bg)] text-[var(--ledger-aims)] border border-[var(--ledger-aims)]/20" title="AIMS course connected">
                            <Plug className="w-3 h-3" />
                            AIMS ✓
                          </span>
                        )}

                        <div className="w-12 h-12 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center group-hover:translate-x-2 transition-all">
                          <ChevronRight className="w-6 h-6" />
                        </div>
                      </div>
                    </div>
                  </Link>
                  );
                })}
              </div>
            </Card>
            </>
          )}

          {hasArchived && (
            <div className="space-y-6">
              <div 
                className="flex cursor-pointer flex-col gap-3 group sm:flex-row sm:items-center sm:justify-between"
                onClick={() => setIsArchivedExpanded(!isArchivedExpanded)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsArchivedExpanded(!isArchivedExpanded); } }}
                role="button"
                tabIndex={0}
                aria-expanded={isArchivedExpanded}
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-rose-100 text-rose-600">
                    <Archive className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground lg:text-2xl">Archived class records</h2>
                    <p className="text-muted-foreground font-medium">Backup data from previous syncs or manual archives</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isArchivedExpanded && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-12 rounded-xl bg-rose-600 px-4 font-semibold text-white hover:bg-rose-700 shadow-lg shadow-rose-100 animate-in fade-in slide-in-from-right-4 text-[10px] tracking-widest uppercase"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteAll(true);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      DELETE ALL
                    </Button>
                  )}
                  <Badge className="bg-rose-50 text-rose-600 border-rose-100 font-bold px-4 py-2 rounded-xl">
                    {archivedClasses.length} RECORD{archivedClasses.length === 1 ? "" : "S"}
                  </Badge>
                  <div className="w-12 h-12 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center group-hover:bg-rose-600 group-hover:text-white transition-all">
                    {isArchivedExpanded ? <ChevronUp className="w-6 h-6" /> : <ChevronDown className="w-6 h-6" />}
                  </div>
                </div>
              </div>

              {isArchivedExpanded && (
                <>
                <Card className="overflow-hidden rounded-2xl border border-rose-100 bg-card lg:hidden">
                  <div className="divide-y divide-border">
                    {archivedClasses.map((assignment) => {
                      const isTransferred = assignment.archivedReason === 'ATLAS_REASSIGNED';
                      return (
                        <div key={`mobile-arch-${assignment.id}`} className="flex items-center gap-2 px-4 py-3">
                          <Link
                            to={`/teacher/records/${assignment.id}`}
                            className="flex min-w-0 flex-1 items-center gap-3 active:opacity-70"
                          >
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isTransferred ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'}`}>
                              <BookOpen className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-foreground">{assignment.subject.name}</p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                Section {assignment.section.name} · {assignment.schoolYear}
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <Badge className={`${isTransferred ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-rose-100 text-rose-700 border-rose-200'} px-2 text-[10px] font-semibold uppercase tracking-wide`}>
                                  {isTransferred ? "Transferred" : "Archived"}
                                </Badge>
                                <span className="text-[10px] font-medium text-muted-foreground">
                                  {assignment.section.enrollments?.length || 0} {(assignment.section.enrollments?.length || 0) === 1 ? "learner" : "learners"}
                                </span>
                              </div>
                            </div>
                          </Link>
                          {!isTransferred && (
                            <Button
                              variant="destructive"
                              size="icon"
                              className="h-12 w-12 shrink-0 rounded-xl bg-rose-600 text-white shadow-sm active:scale-95"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setAssignmentToDelete({ id: assignment.id, name: assignment.subject.name });
                              }}
                              aria-label={`Delete ${assignment.subject.name}`}
                            >
                              <Trash2 className="h-5 w-5" aria-hidden="true" />
                            </Button>
                          )}
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <Card className="hidden overflow-hidden rounded-2xl border border-rose-100 bg-card lg:block">
                  <div className="divide-y divide-rose-50">
                    {archivedClasses.map((assignment) => {
                      const isTransferred = assignment.archivedReason === 'ATLAS_REASSIGNED';
                      return (
                      <Link key={assignment.id} to={`/teacher/records/${assignment.id}`} className="block group">
                        <div className={`flex flex-col gap-3 p-4 transition-all duration-300 group lg:flex-row lg:items-center lg:gap-8 lg:p-6 ${isTransferred ? 'hover:bg-amber-50' : 'hover:bg-rose-50'}`}>
                          <div className={`w-16 h-16 rounded-[1.5rem] ${isTransferred ? 'bg-amber-100 text-amber-400 group-hover:bg-amber-600' : 'bg-rose-100 text-rose-400 group-hover:bg-rose-600'} flex items-center justify-center group-hover:text-white group-hover:shadow-xl transition-all duration-500`}>
                            <BookOpen className="w-8 h-8" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                              <h3 className={`text-lg font-semibold text-foreground transition-colors lg:text-2xl ${isTransferred ? 'group-hover:text-amber-700' : 'group-hover:text-rose-600'}`}>{assignment.subject.name}</h3>
                              <Badge className={`${isTransferred ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-rose-100 text-rose-700 border-rose-200'} text-[10px] font-bold uppercase tracking-widest px-3`}>
                                {isTransferred ? "TRANSFERRED" : "ARCHIVED"}
                              </Badge>
                            </div>
                            <p className={`${isTransferred ? 'text-amber-600' : 'text-rose-500'} font-bold text-sm uppercase tracking-widest`}>
                              Section {assignment.section.name} &bull; {assignment.schoolYear}
                            </p>
                            {isTransferred && (assignment as any).successorTeacherName && (
                              <p className="mt-3 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
                                Transferred to {(assignment as any).successorTeacherName}
                              </p>
                            )}
                            {!isTransferred && assignment.archivedReason && (
                              <p className="mt-3 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-2xl px-4 py-3">
                                {assignment.archivedReason}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-4 lg:gap-12">
                            <div className="text-center">
                              <p className="text-2xl font-bold text-foreground leading-none">{assignment.section.enrollments?.length || 0}</p>
                              <p className={`text-[10px] font-bold ${isTransferred ? 'text-amber-400' : 'text-rose-400'} uppercase tracking-[0.2em] mt-2`}>Learners</p>
                            </div>

                            <div className="hidden lg:block">
                              <div className={`px-5 py-3 rounded-2xl ${isTransferred ? 'bg-amber-50 border-amber-100' : 'bg-rose-50 border-rose-100'} border group-hover:bg-card transition-colors`}>
                                <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mb-1 text-center">WW / PT / TA</p>
                                <p className="text-sm text-foreground font-bold font-mono tracking-tighter text-center">
                                  {assignment.effectiveWeights?.ww ?? assignment.subject.writtenWorkWeight} / {assignment.effectiveWeights?.pt ?? assignment.subject.perfTaskWeight} / {assignment.effectiveWeights?.qa ?? assignment.subject.quarterlyAssessWeight}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              {!isTransferred && (
                                <Button
                                  variant="destructive"
                                  size="icon"
                                  className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-600 text-white opacity-100 shadow-lg shadow-rose-100 transition-all active:scale-95 lg:rounded-2xl lg:opacity-0 lg:group-hover:opacity-100"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setAssignmentToDelete({ id: assignment.id, name: assignment.subject.name });
                                  }}
                                  aria-label={`Delete ${assignment.subject.name}`}
                                >
                                  <Trash2 className="w-5 h-5" aria-hidden="true" />
                                </Button>
                              )}
                              <div className={`w-12 h-12 rounded-2xl ${isTransferred ? 'bg-amber-100 text-amber-400' : 'bg-rose-100 text-rose-400'} flex items-center justify-center group-hover:translate-x-2 transition-all`}>
                                <ChevronRight className="w-6 h-6" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                      );
                    })}
                  </div>
                </Card>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {termFilteredClasses.length === 0 && archivedClasses.length === 0 && (
        <div className="flex items-center justify-center h-[60vh] p-4">
          <div className="text-center max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-muted flex items-center justify-center text-muted-foreground">
              <ClipboardList className="w-10 h-10" />
            </div>
            <h3 className="font-bold text-foreground text-2xl mb-3">
              {searchTerm ? "No Classes Found" : termFilter === "current" && activeClasses.length > 0 ? "No Classes This Term" : "No Active Classes"}
            </h3>
            <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
              {searchTerm
                ? "We couldn't find any classes matching your current search parameters."
                : termFilter === "current" && activeClasses.length > 0
                  ? `You have ${activeClasses.length} class${activeClasses.length > 1 ? 'es' : ''} scheduled in other terms. Switch to Full Year to see them.`
                  : "You don't have any active classes with enrolled learners yet. Please contact the registrar or system administrator for assignment."}
            </p>
            {!searchTerm && (
              <div className="flex flex-col gap-3">
                {termFilter === "current" && activeClasses.length > 0 && (
                  <Button
                    onClick={() => setTermFilter("full")}
                    className="w-full h-12 rounded-2xl font-bold transition-all"
                    style={{ backgroundColor: colors.primary }}
                  >
                    <LayoutGrid className="w-4 h-4 mr-2" />
                    View Full Year
                  </Button>
                )}
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
            )}
          </div>
        </div>
      )}

      <Dialog open={!!assignmentToDelete} onOpenChange={(open) => !open && setAssignmentToDelete(null)}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-0">
          <div className="bg-rose-600 p-5 text-white lg:p-8">
            <div className="w-16 h-16 bg-white/20 rounded-[1.5rem] flex items-center justify-center mb-6 backdrop-blur-md">
              <Trash2 className="w-8 h-8 text-white" />
            </div>
            <DialogHeader className="p-0 text-left">
              <DialogTitle className="text-2xl font-bold text-white leading-tight">Are You sure to delete this Subject?</DialogTitle>
              <DialogDescription className="text-rose-100 font-medium text-base mt-2">
                Permanently removing <span className="font-bold text-white underline decoration-2 underline-offset-4">{assignmentToDelete?.name}</span> will erase all student grades and synchronization history for this record.
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="flex flex-col gap-3 bg-card p-4 sm:flex-row lg:p-8">
            <Button
              variant="outline"
              onClick={() => setAssignmentToDelete(null)}
              className="h-14 rounded-2xl border-border font-bold hover:bg-muted hover:text-foreground transition-all flex-1"
              disabled={isDeleting}
            >
              CANCEL
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="h-14 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-xl shadow-rose-100 transition-all flex-1"
              disabled={isDeleting}
            >
              {isDeleting ? (
                "DELETING..."
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <Trash2 className="w-5 h-5" aria-hidden="true" />
                  <span>YES, DELETE RECORD</span>
                </div>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDeleteAll} onOpenChange={setConfirmDeleteAll}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-0">
          <div className="bg-rose-600 p-5 text-white lg:p-8">
            <div className="w-16 h-16 bg-white/20 rounded-[1.5rem] flex items-center justify-center mb-6 backdrop-blur-md">
              <Trash2 className="w-8 h-8 text-white" />
            </div>
            <DialogHeader className="p-0 text-left">
              <DialogTitle className="text-2xl font-bold text-white leading-tight">Delete All Archived Records?</DialogTitle>
              <DialogDescription className="text-rose-100 font-medium text-base mt-2">
                This will permanently remove all <span className="font-bold text-white underline decoration-2 underline-offset-4">{archivedClasses.length} archived subjects</span>. This action cannot be undone and all historical grades for these records will be lost.
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="flex flex-col gap-3 bg-card p-4 sm:flex-row lg:p-8">
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteAll(false)}
              className="h-14 rounded-2xl border-border font-bold hover:bg-muted hover:text-foreground transition-all flex-1"
              disabled={isDeleting}
            >
              CANCEL
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
              className="h-14 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-xl shadow-rose-100 transition-all flex-1"
              disabled={isDeleting}
            >
              {isDeleting ? (
                "DELETING ALL..."
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <Trash2 className="w-5 h-5" aria-hidden="true" />
                  <span>YES, DELETE ALL</span>
                </div>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}






