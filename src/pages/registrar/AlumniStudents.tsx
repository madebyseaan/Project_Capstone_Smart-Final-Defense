import { useState, useEffect } from "react";
import {
  Search,
  FileText,
  Users,
  GraduationCap,
  ArrowRightLeft,
  RefreshCw,
  CloudDownload,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { registrarApi } from "@/lib/api";

import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { LoadingSkeleton, EmptyState, Dash } from "@/components/data-table";
import { toast } from "@/lib/toast";
import { SyncProgressModal } from "@/components/common/SyncProgressModal";

interface AlumniStudent {
  id: string;
  enrollmentId: string;
  lrn: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  gender: string | null;
  lastGradeLevel: string;
  lastSection: string;
  lastSchoolYear: string;
  lastProgram: string;
  enrollmentStatus: string;
}

const formatGradeLevel = (gl: string) => {
  const num = gl.replace("GRADE_", "");
  return `Grade ${num}`;
};

const gradeLevelLabels: Record<string, string> = {
  "all": "All Grades",
  "GRADE_7": "Grade 7",
  "GRADE_8": "Grade 8",
  "GRADE_9": "Grade 9",
  "GRADE_10": "Grade 10",
};

const formatName = (s: AlumniStudent) => {
  const parts = [s.lastName, s.firstName, s.middleName].filter(Boolean);
  return parts.join(", ");
};

const statusStyles: Record<string, { bg: string; text: string; border: string }> = {
  "ENROLLED": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "TRANSFERRED": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  "GRADUATED": { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
};

const statusLabels: Record<string, string> = {
  "ENROLLED": "Enrolled",
  "TRANSFERRED": "Transferred",
  "GRADUATED": "Graduated",
};

const tabConfig = [
  { key: "all", label: "All", icon: Users },
  { key: "graduated", label: "Graduated", icon: GraduationCap },
  { key: "TRANSFERRED", label: "Transferred", icon: ArrowRightLeft },
];

export default function AlumniStudents() {
  const { colors } = useTheme();
  const [students, setStudents] = useState<AlumniStudent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, graduated: 0, TRANSFERRED: 0 });

  // Sync modal state
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [syncError, setSyncError] = useState<string | undefined>();

  useEffect(() => {
    loadAlumni();
  }, [gradeFilter, page, activeTab, rowsPerPage]);

  useEffect(() => {
    loadCounts();
  }, []);

  const loadCounts = async () => {
    try {
      const [allRes, gradRes, transRes] = await Promise.all([
        registrarApi.getAlumni({ limit: 1 }),
        registrarApi.getAlumni({ status: 'graduated', limit: 1 }),
        registrarApi.getAlumni({ status: 'TRANSFERRED', limit: 1 }),
      ]);
      setCounts({
        all: allRes.data.total || 0,
        graduated: gradRes.data.total || 0,
        TRANSFERRED: transRes.data.total || 0,
      });
    } catch (err) {
      console.error("Failed to load counts:", err);
    }
  };

  const loadAlumni = async () => {
    setLoading(true);
    try {
      const response = await registrarApi.getAlumni({
        search: search || undefined,
        gradeLevel: gradeFilter !== "all" ? gradeFilter : undefined,
        status: activeTab !== "all" ? activeTab : undefined,
        limit: rowsPerPage,
        offset: page * rowsPerPage,
      });
      const data = response.data;
      setStudents(data.students || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to load alumni:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(0);
    loadAlumni();
  };

  const handleViewSF10 = async (studentId: string) => {
    try {
      const response = await registrarApi.getSF10(studentId);
      sessionStorage.setItem("sf10Data", JSON.stringify(response.data));
      sessionStorage.setItem("sf10StudentId", studentId);
      window.location.href = "/registrar/forms?view=sf10&alumni=1";
    } catch (err) {
      console.error("Failed to load SF10:", err);
    }
  };

  const handleSync = async () => {
    setSyncModalOpen(true);
    setSyncStatus("syncing");
    setSyncError(undefined);

    try {
      const result = await registrarApi.syncInactiveStudents();
      setSyncStatus("success");
      toast.success("Student data synced successfully");

      void handleSearch();
      void loadCounts();
    } catch {
      setSyncStatus("error");
      setSyncError("Failed to sync with EnrollPro. Please try again.");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <SyncProgressModal isOpen={syncModalOpen} onClose={() => { setSyncModalOpen(false); setSyncStatus("idle"); }} status={syncStatus} errorMessage={syncError} />

      <PageHeader
        title="Former Students"
        description="Archived learners who are no longer actively enrolled"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="font-semibold text-xs shadow-sm shadow-primary/20"
              disabled={syncStatus === "syncing"}
              onClick={() => void handleSync()}
            >
              <CloudDownload className="w-4 h-4 mr-1.5" />
              Sync from EnrollPro
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
              onClick={() => void loadAlumni()}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total"
          value={counts.all}
          numericValue={counts.all}
          icon={<Users className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Graduated"
          value={counts.graduated}
          numericValue={counts.graduated}
          icon={<GraduationCap className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Transferred"
          value={counts.TRANSFERRED}
          numericValue={counts.TRANSFERRED}
          icon={<ArrowRightLeft className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Other"
          value={Math.max(0, counts.all - counts.graduated - counts.TRANSFERRED)}
          numericValue={Math.max(0, counts.all - counts.graduated - counts.TRANSFERRED)}
          icon={<FileText className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
      </div>

      {/* Main Table Card */}
      <Card className="border border-border shadow-sm bg-card overflow-hidden rounded-xl p-0">
        <div className="px-6 py-4 border-b border-border">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">All Former Students</h2>
              <p className="text-sm text-muted-foreground">
                {total} learner{total !== 1 ? "s" : ""} found
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Tabs - Pill style */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-muted">
                {tabConfig.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => { setActiveTab(tab.key); setPage(0); }}
                        className={`flex items-center gap-1.5 px-3 h-7 rounded-md text-xs font-medium transition-all ${
                        isActive
                          ? "bg-card shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{tab.label}</span>
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-semibold tabular-nums ${
                        isActive
                          ? "bg-muted text-foreground"
                          : "bg-card/60 text-muted-foreground"
                      }`}>
                        {counts[tab.key] || 0}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name or LRN..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-8 pr-12 h-9 w-56 rounded-lg text-xs"
                />
                <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted rounded border border-border">
                  ↵
                </kbd>
              </div>
              <Select value={gradeFilter} onValueChange={(v) => { setGradeFilter(v); setPage(0); }}>
                <SelectTrigger className="w-32 h-9 rounded-lg text-xs font-medium">
                  <SelectValue placeholder="All Grades">
                    {gradeLevelLabels[gradeFilter] || "All Grades"}
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
            </div>
          </div>
        </div>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-muted/50 border-b border-border bg-muted/50">
                 <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%] text-left">LRN</TableHead>
                 <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[30%] text-left">Learner Name</TableHead>
                 <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[8%] text-left">Sex</TableHead>
                 <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[10%] text-left">Prior Grade</TableHead>
                 <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[12%] text-left">Prior Section</TableHead>
                 <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[10%] text-left whitespace-nowrap">Last SY</TableHead>
                 <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[8%] text-left">Program</TableHead>
                 <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[12%] text-left">Status</TableHead>
                 <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[10%] text-left">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <LoadingSkeleton columnCount={9} rowCount={10} />
                ) : students.length === 0 ? (
                  <EmptyState
                    columnCount={9}
                    icon={<Users className="h-5 w-5 text-muted-foreground/60" />}
                    title="No learners found matching your criteria"
                    hint="Try adjusting your search or filter criteria."
                  />
                ) : (
                  students.map((student) => (
                    <TableRow key={student.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                      <TableCell className="font-mono text-[13px] text-muted-foreground py-3.5 px-4 tabular-nums text-left align-middle whitespace-nowrap">
                        {student.lrn || <Dash />}
                      </TableCell>
                      <TableCell className="py-3.5 px-4 text-left align-middle">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs shrink-0"
                            style={{ backgroundColor: colors.primary }}
                            aria-hidden="true"
                          >
                            {(student.lastName || "?").charAt(0)}
                          </div>
                           <p className="font-semibold text-foreground text-sm truncate">{formatName(student)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="py-3.5 px-4 text-sm text-muted-foreground text-left align-middle whitespace-nowrap">
                        {student.gender || <Dash />}
                      </TableCell>
                      <TableCell className="py-3.5 px-4 text-sm text-muted-foreground text-left align-middle whitespace-nowrap">
                        {student.lastGradeLevel ? formatGradeLevel(student.lastGradeLevel) : <Dash />}
                      </TableCell>
                      <TableCell className="py-3.5 px-4 text-sm text-muted-foreground text-left align-middle whitespace-nowrap">
                        {student.lastSection || <Dash />}
                      </TableCell>
                      <TableCell className="py-3.5 px-4 text-sm text-muted-foreground text-left align-middle whitespace-nowrap">
                        {student.lastSchoolYear || <Dash />}
                      </TableCell>
                      <TableCell className="py-3.5 px-4 text-left align-middle">
                        {student.lastProgram ? (
                          <Badge variant="outline" className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground border-border whitespace-nowrap">
                            {student.lastProgram}
                          </Badge>
                        ) : (
                          <Dash />
                        )}
                      </TableCell>
                      <TableCell className="py-3.5 px-4 text-left align-middle">
                        <Badge
                          variant="outline"
                          className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap ${statusStyles[student.enrollmentStatus]?.bg || "bg-muted/50"} ${statusStyles[student.enrollmentStatus]?.text || "text-muted-foreground"} ${statusStyles[student.enrollmentStatus]?.border || "border-border"}`}
                        >
                          {statusLabels[student.enrollmentStatus] || student.enrollmentStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-left py-3.5 px-4 align-middle">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewSF10(student.id)}
                          className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap -ml-2.5"
                        >
                          <FileText className="h-3.5 w-3.5 mr-1.5" />
                          SF10
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {!loading && total > 0 && (
            <div className="border-t border-border px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Showing {page * rowsPerPage + 1}–{Math.min((page + 1) * rowsPerPage, total)} of{" "}
                  <span className="font-medium text-foreground">{total}</span> learners
                </span>
                <div className="h-3.5 w-px bg-border" />
                <div className="flex items-center gap-1.5">
                  <span>Rows:</span>
                  <Select value={String(rowsPerPage)} onValueChange={(v) => { setRowsPerPage(Number(v)); setPage(0); }}>
                    <SelectTrigger className="w-16 h-7 rounded-md text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page <= 0}
                  onClick={() => setPage(0)}
                  aria-label="First page"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" />
                  </svg>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label="Previous page"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </Button>

                <Button
                  variant="default"
                  size="sm"
                  className="h-8 w-8 text-xs font-bold"
                >
                  {page + 1}
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  aria-label="Next page"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(totalPages - 1)}
                  aria-label="Last page"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 17 5-5-5-5" /><path d="m13 17 5-5-5-5" />
                  </svg>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
