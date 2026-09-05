import { useState, useEffect, useRef } from "react";
import {
  Users,
  Search,
  Download,
  Command,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  User,
  UserRound,
  Layers,
  CloudDownload,
  RefreshCw,
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

import { registrarApi, type Section } from "@/lib/api";
import { toast } from "@/lib/toast";

import { Tooltip } from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";
import { useSyncStream } from "@/hooks/useSyncStream";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Dash } from "@/components/data-table/Dash";
import { StudentRecordsTable } from "./components/StudentRecordsTable";
import { StudentDetailDialog } from "./components/StudentDetailDialog";
import { SyncProgressModal } from "@/components/common/SyncProgressModal";

// Extended student type that includes enrollment data
interface StudentWithEnrollment {
  id: string;
  enrollmentId: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender?: string;
  birthDate?: string;
  address?: string;
  guardianName?: string;
  guardianContact?: string;
  gradeLevel?: string;
  sectionId?: string;
  sectionName?: string;
  schoolYear?: string;
  status?: string;
  transferInDate?: string | null;
  adviser?: string;
}

const gradeLevelLabels: Record<string, string> = {
  "7": "Grade 7",
  "8": "Grade 8",
  "9": "Grade 9",
  "10": "Grade 10",
  "GRADE_7": "Grade 7",
  "GRADE_8": "Grade 8",
  "GRADE_9": "Grade 9",
  "GRADE_10": "Grade 10",
};



export default function StudentRecords() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();
  const { syncVersion } = useSyncStream();
  const [students, setStudents] = useState<StudentWithEnrollment[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchoolYear, setSelectedSchoolYear] = useState("");
  const [selectedGradeLevel, setSelectedGradeLevel] = useState("all");
  const [selectedSection, setSelectedSection] = useState("all");
  
  // School years from API
  const [schoolYears, setSchoolYears] = useState<string[]>([]);

  // Student detail modal
  const [selectedStudent, setSelectedStudent] = useState<StudentWithEnrollment | null>(null);
  const [studentDetailOpen, setStudentDetailOpen] = useState(false);
  const [sf9Data, setSf9Data] = useState<any>(null);
  const [sf10Data, setSf10Data] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [syncError, setSyncError] = useState<string | undefined>();
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(50);
  
  // Search input ref for keyboard shortcut
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // Keyboard shortcut for search (Ctrl+K or /)
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
  
  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedGradeLevel, selectedSection, selectedSchoolYear, limit]);

  // Reset section filter if it does not belong to the selected grade level
  useEffect(() => {
    if (selectedGradeLevel !== "all" && selectedSection !== "all") {
      const activeSectionObj = sections.find(s => s.id === selectedSection);
      if (activeSectionObj && activeSectionObj.gradeLevel !== selectedGradeLevel) {
        setSelectedSection("all");
      }
    }
  }, [selectedGradeLevel, sections, selectedSection]);

  // Load school years once on mount
  useEffect(() => {
    registrarApi.getSchoolYears().then((res) => {
      const sysYears = res.data.schoolYears;
      if (Array.isArray(sysYears) && sysYears.length > 0) {
        setSchoolYears(sysYears);
        if (!selectedSchoolYear) {
          setSelectedSchoolYear(sysYears[0]);
        }
      }
    }).catch(() => { /* keep defaults */ });
  }, []);

  // Load data and refresh again whenever a background sync completes.
  const loadStudents = async () => {
    setLoading(true);
    setError(null);
    try {
      const [studentsRes, sectionsRes] = await Promise.all([
        registrarApi.getStudents({ schoolYear: selectedSchoolYear }),
        registrarApi.getSections({ schoolYear: selectedSchoolYear }),
      ]);
      // Handle response structure - students are in .students property
      const studentsData = studentsRes.data.students || studentsRes.data;
      setStudents(Array.isArray(studentsData) ? studentsData : []);
      setSections(sectionsRes.data || []);
    } catch (error: any) {
      console.error("Error loading data:", error);
      if (error.response?.status === 403) {
        setError("Access denied. Please log in as Registrar.");
      } else if (error.response?.status === 401) {
        setError("Session expired. Please log in again.");
      } else {
        setError("Failed to load student data. Please check server connection.");
      }
      setStudents([]);
      setSections([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStudents();
  }, [selectedSchoolYear, syncVersion, refreshKey]);

  const handleSync = async () => {
    setSyncModalOpen(true);
    setSyncStatus("syncing");
    setSyncError(undefined);
    try {
      await registrarApi.runSync();
      setSyncStatus("success");
      await loadStudents();
    } catch {
      setSyncStatus("error");
      setSyncError("Failed to sync with EnrollPro. Please try again.");
    }
  };

  // Filter students
  const filteredStudents = students.filter((student) => {
    const fullName = `${student.lastName} ${student.firstName} ${student.middleName || ""}`.toLowerCase();
    const matchesSearch = fullName.includes(searchQuery.toLowerCase()) || String(student.lrn || "").includes(searchQuery);
    
    // Handle grade level - match the database enum value (e.g. GRADE_7) exactly
    const matchesGrade = selectedGradeLevel === "all" || student.gradeLevel === selectedGradeLevel;
    
    const matchesSection = selectedSection === "all" || student.sectionId === selectedSection;
    
    return matchesSearch && matchesGrade && matchesSection;
  });

  // View student details
  const handleViewStudent = async (student: StudentWithEnrollment) => {
    setSelectedStudent(student);
    setStudentDetailOpen(true);
    setLoadingDetail(true);
    setSf9Data(null);
    setSf10Data(null);

    try {
      const [sf9Res, sf10Res] = await Promise.all([
        registrarApi.getSF9(student.id, selectedSchoolYear),
        registrarApi.getSF10(student.id),
      ]);
      setSf9Data(sf9Res.data);
      setSf10Data(sf10Res.data);
    } catch (error) {
      console.error("Error loading student details:", error);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Stats calculations (case-insensitive gender match — DB stores MALE/FEMALE from EnrollPro)
  const stats = {
    total: filteredStudents.length,
    male: filteredStudents.filter((s) => {
      const g = (s.gender || "").toUpperCase();
      return g === "MALE" || g === "M";
    }).length,
    female: filteredStudents.filter((s) => {
      const g = (s.gender || "").toUpperCase();
      return g === "FEMALE" || g === "F";
    }).length,
    sections: searchQuery 
      ? new Set(filteredStudents.map((s) => s.sectionId).filter(Boolean)).size
      : sections.filter(s => {
          const matchesGrade = selectedGradeLevel === "all" || s.gradeLevel === selectedGradeLevel;
          const matchesSection = selectedSection === "all" || s.id === selectedSection;
          
          if (!matchesGrade || !matchesSection) return false;
          
          // A section is "valid" if it either exists in EnrollPro (matching the dashboard's 66 count)
          // or it has active enrolled students in our local database.
          const isFromEnrollPro = s.enrollProId !== null;
          const hasEnrolledStudents = students.some(st => st.sectionId === s.id);
          
          return isFromEnrollPro || hasEnrolledStudents;
        }).length,
  };
  
  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / limit));
  const paginatedStudents = filteredStudents.slice(
    (currentPage - 1) * limit,
    currentPage * limit
  );

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
          <Users className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Unable to Load Student Records</h2>
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button onClick={() => window.location.reload()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Student Records"
        description="Manage and view all student information"
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
              onClick={() => void loadStudents()}
              variant="outline"
              size="sm"
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
            <Tooltip content="Export student records to CSV or Excel format">
              <Button variant="outline" size="sm" className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs">
                <Download className="w-4 h-4 mr-1.5" />
                Export
              </Button>
            </Tooltip>
          </div>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Students"
          value={stats.total}
          numericValue={stats.total}
          icon={<Users className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard label="Male" value={stats.male} numericValue={stats.male} icon={<User className="w-5 h-5 text-blue-600" />} iconClassName="bg-blue-50" />
        <StatCard label="Female" value={stats.female} numericValue={stats.female} icon={<UserRound className="w-5 h-5 text-pink-600" />} iconClassName="bg-pink-50" />
        <StatCard label="Sections" value={stats.sections} numericValue={stats.sections} icon={<Layers className="w-5 h-5 text-primary" />} iconClassName="bg-primary/10" />
      </div>

      {/* Main Table Card */}
      <Card className="border-0 shadow-sm bg-card overflow-hidden rounded-xl p-0">
        <div className="px-6 py-4 border-b border-border/30">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">All Students</h2>
              <p className="text-sm text-muted-foreground">
                {filteredStudents.length} student{filteredStudents.length !== 1 ? "s" : ""} found
              </p>
            </div>
            
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <Select value={selectedSchoolYear} onValueChange={(val) => val && setSelectedSchoolYear(val)}>
                <SelectTrigger className="w-32 h-9 rounded-lg text-xs font-medium">
                  <SelectValue placeholder="School Year">
                    {selectedSchoolYear}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {schoolYears.map((sy) => (
                    <SelectItem key={sy} value={sy}>{sy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  placeholder="Search name or LRN..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-14 h-9 w-56 rounded-lg text-xs"
                />
                <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-medium text-muted-foreground bg-muted rounded">
                  <Command className="w-2.5 h-2.5" />K
                </kbd>
              </div>
              <Select value={selectedGradeLevel} onValueChange={(val) => val && setSelectedGradeLevel(val)}>
                <SelectTrigger className="w-32 h-9 rounded-lg text-xs font-medium">
                  <SelectValue placeholder="All Grades">
                    {gradeLevelLabels[selectedGradeLevel] || "All Grades"}
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
              <Select value={selectedSection} onValueChange={(val) => val && setSelectedSection(val)}>
                <SelectTrigger className="w-36 h-9 rounded-lg text-xs font-medium">
                  <SelectValue placeholder="All Sections">
                    {selectedSection === "all" ? "All Sections" : (sections.find((s) => s.id === selectedSection)?.name || "All Sections")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sections</SelectItem>
                  {sections
                    .filter(s => s.enrollProId !== null || students.some(st => st.sectionId === s.id))
                    .filter(s => selectedGradeLevel === "all" || s.gradeLevel === selectedGradeLevel)
                    .map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.name}{section.program && section.program !== 'REGULAR' ? ` (${section.program})` : ''} ({section.gradeLevel.replace("GRADE_", "Grade ")})
                      </SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <CardContent className="p-0">
            <>
              {/* Mobile Card View */}
              <div className="block md:hidden p-4 space-y-3">
                {paginatedStudents.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground font-medium">No students found</p>
                    <p className="text-muted-foreground text-sm mt-1">Try adjusting your search or filters</p>
                  </div>
                ) : (
                  paginatedStudents.map((student) => {
                    const normalizedGrade = (student.gradeLevel || "").replace("GRADE_", "");
                    return (
                      <div 
                        key={student.id}
                        className="bg-card rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-semibold"
                              style={{ backgroundColor: colors.primary }}
                            >
                              {student.lastName.charAt(0)}
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">
                                {student.lastName}, {student.firstName}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono">{student.lrn}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleViewStudent(student)}
                              className="h-8 rounded-lg"
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${colors.primary}10`; e.currentTarget.style.color = colors.primary; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; }}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge className={student.gender?.toUpperCase() === "MALE" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}>
                            {student.gender}
                          </Badge>
                          <Badge style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>
                            {gradeLevelLabels[student.gradeLevel || ""] || `Grade ${normalizedGrade}`}
                          </Badge>
                          <Badge variant="outline" className="text-muted-foreground">
                            {student.sectionName || <Dash />}
                          </Badge>
                          <div className="flex items-center gap-1.5">
                            {student.status ? (
                              <Badge
                                className={
                                  student.status === "ENROLLED"
                                    ? "bg-green-100 text-green-700 border-green-200"
                                    : student.status === "TRANSFERRED"
                                    ? "bg-blue-100 text-blue-700 border-blue-200"
                                    : "bg-orange-100 text-orange-700 border-orange-200"
                                }
                              >
                                {student.status}
                              </Badge>
                            ) : (
                              <Dash />
                            )}
                            {student.transferInDate && (
                              <Badge variant="outline" className="bg-violet-100 text-violet-700 border-violet-200">
                                T/I
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
              {/* Desktop Table View */}
              <div className="hidden md:block">
                <StudentRecordsTable
                  students={paginatedStudents}
                  loading={loading}
                  searchQuery={searchQuery}
                  hasActiveFilters={!!searchQuery || selectedGradeLevel !== "all" || selectedSection !== "all"}
                  onViewStudent={handleViewStudent}
                  primaryColor={colors.primary}
                />
              </div>
            </>
          
          {/* Pagination */}
          {!loading && filteredStudents.length > 0 && (
            <div className="border-t border-border/30 px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Showing {(currentPage - 1) * limit + 1}–{Math.min(currentPage * limit, filteredStudents.length)} of{" "}
                  <span className="font-medium text-foreground">{filteredStudents.length}</span> learners
                </span>
                <div className="h-3.5 w-px bg-border" />
                <div className="flex items-center gap-1.5">
                  <span>Rows:</span>
                  <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                    <SelectTrigger className="w-16 h-7 rounded-md text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="250">250</SelectItem>
                      <SelectItem value="500">500</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(1)}
                  aria-label="First page"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 w-8 text-xs font-bold"
                >
                  {currentPage}
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  aria-label="Last page"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Student Detail Dialog */}
      <StudentDetailDialog
        student={selectedStudent}
        open={studentDetailOpen}
        onOpenChange={setStudentDetailOpen}
        sf9Data={sf9Data}
        sf10Data={sf10Data}
        loadingDetail={loadingDetail}
        schoolYear={selectedSchoolYear}
      />
      <SyncProgressModal isOpen={syncModalOpen} onClose={() => { setSyncModalOpen(false); setSyncStatus("idle"); }} status={syncStatus} errorMessage={syncError} />
    </div>
  );
}
