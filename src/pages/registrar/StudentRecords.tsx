import { useState, useEffect, useRef } from "react";
import {
  Users,
  Search,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  Command,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { registrarApi, type Section } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Tooltip, HelpTooltip } from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";
import { useSyncStream } from "@/hooks/useSyncStream";

// Extended student type that includes enrollment data
interface StudentWithEnrollment {
  id: string;
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

// Format date helper
const formatDate = (dateString?: string) => {
  if (!dateString) return "-";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  } catch {
    return dateString;
  }
};

// Helper component for Form Status
const FormStatusCard = ({ label, title, status, description }: { 
  label: string; 
  title: string; 
  status: 'completed' | 'pending' | 'missing' | 'dev'; 
  description: string 
}) => {
  const statusConfig = {
    completed: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'Ready' },
    pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', text: 'In Progress' },
    missing: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', text: 'Missing Data' },
    dev: { icon: Loader2, color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200', text: 'In Dev' },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`p-3 rounded-xl border-2 ${config.bg} ${config.border} transition-all ${status === 'dev' ? 'opacity-70 grayscale-[0.5]' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <Badge variant="outline" className={`${config.color} ${config.border} bg-white px-1.5 text-[10px]`}>{label}</Badge>
        <Icon className={`w-4 h-4 ${config.color} ${status === 'dev' ? 'animate-spin-slow' : ''}`} />
      </div>
      <p className="font-bold text-gray-900 text-[11px] truncate leading-tight" title={title}>{title}</p>
      <div className="mt-1">
        <span className={`text-[9px] font-bold uppercase tracking-wider ${config.color}`}>{config.text}</span>
      </div>
    </div>
  );
};

export default function StudentRecords() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();
  const { syncVersion } = useSyncStream();
  const [students, setStudents] = useState<StudentWithEnrollment[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchoolYear, setSelectedSchoolYear] = useState("2026-2027");
  const [selectedGradeLevel, setSelectedGradeLevel] = useState("all");
  const [selectedSection, setSelectedSection] = useState("all");
  
  // School years from API
  const [schoolYears, setSchoolYears] = useState<string[]>(["2026-2027"]);

  // Student detail modal
  const [selectedStudent, setSelectedStudent] = useState<StudentWithEnrollment | null>(null);
  const [studentDetailOpen, setStudentDetailOpen] = useState(false);
  const [sf9Data, setSf9Data] = useState<any>(null);
  const [sf10Data, setSf10Data] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
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

  // Load school years once on mount
  useEffect(() => {
    registrarApi.getSchoolYears().then((res) => {
      const sysYears = res.data.schoolYears;
      if (Array.isArray(sysYears) && sysYears.length > 0) {
        setSchoolYears(sysYears);
        // Set default to the first one (most recent) if not already set or matches default
        if (selectedSchoolYear === "2026-2027" && sysYears[0] !== "2026-2027") {
          setSelectedSchoolYear(sysYears[0]);
        }
      }
    }).catch(() => { /* keep defaults */ });
  }, []);

  // Load data and refresh again whenever a background sync completes.
  useEffect(() => {
    const loadData = async () => {
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
    loadData();
  }, [selectedSchoolYear, syncVersion]);

  // Filter students
  const filteredStudents = students.filter((student) => {
    const fullName = `${student.lastName} ${student.firstName} ${student.middleName || ""}`.toLowerCase();
    const matchesSearch = fullName.includes(searchQuery.toLowerCase()) || student.lrn.includes(searchQuery);
    
    // Handle grade level - could be "7" or "GRADE_7" format
    const studentGrade = student.gradeLevel || "";
    const normalizedGrade = studentGrade.replace("GRADE_", "");
    const matchesGrade = selectedGradeLevel === "all" || normalizedGrade === selectedGradeLevel;
    
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
          const normalizedGrade = s.gradeLevel.replace("GRADE_", "");
          const matchesGrade = selectedGradeLevel === "all" || normalizedGrade === selectedGradeLevel;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <Users className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to Load Student Records</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <Button onClick={() => window.location.reload()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/registrar" },
          { label: "Student Records" },
        ]}
      />
      
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Student Records
          </h1>
          <p className="text-gray-600 mt-1">
            Manage and view all student information
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Tooltip content="Export student records to CSV or Excel format">
            <Button variant="outline" className="rounded-xl">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
          <div className="flex items-center gap-1">
            <p className="text-sm font-medium text-gray-600">Total Students</p>
            <HelpTooltip content="Total number of enrolled students matching current filters" />
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
        </div>
        <div className="p-4 rounded-xl bg-sky-50 border border-sky-100">
          <p className="text-sm font-medium text-gray-600">Male</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.male}</p>
        </div>
        <div className="p-4 rounded-xl bg-pink-50 border border-pink-100">
          <p className="text-sm font-medium text-gray-600">Female</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.female}</p>
        </div>
        <div className="p-4 rounded-xl border" style={{ backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}20` }}>
          <p className="text-sm font-medium text-gray-600">Sections</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.sections}</p>
        </div>
      </div>

      {/* Main Table Card */}
      <Card className="border-0 shadow-xl shadow-gray-200/50 bg-white overflow-hidden rounded-2xl p-0">
        <CardHeader className="border-b border-gray-100 px-6 py-5" style={{ backgroundColor: `${colors.primary}08` }}>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl text-white shadow-lg" style={{ backgroundColor: colors.primary }}>
                <Users className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-gray-900">All Students</CardTitle>
                <CardDescription className="text-gray-500 text-sm">{filteredStudents.length} students found</CardDescription>
              </div>
            </div>
            
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <Select value={selectedSchoolYear} onValueChange={(val) => val && setSelectedSchoolYear(val)}>
                <SelectTrigger className="w-36 rounded-xl border-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schoolYears.map((sy) => (
                    <SelectItem key={sy} value={sy}>{sy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  ref={searchInputRef}
                  placeholder="Search students..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-16 w-64 rounded-xl border-gray-200"
                />
                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-100 rounded border border-gray-200">
                  <Command className="w-3 h-3" />K
                </kbd>
              </div>
              <Select value={selectedGradeLevel} onValueChange={(val) => val && setSelectedGradeLevel(val)}>
                <SelectTrigger className="w-36 rounded-xl border-gray-200">
                  <SelectValue>
                    {selectedGradeLevel === "all" ? "All Grades" : gradeLevelLabels[selectedGradeLevel]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Grades</SelectItem>
                  <SelectItem value="7">Grade 7</SelectItem>
                  <SelectItem value="8">Grade 8</SelectItem>
                  <SelectItem value="9">Grade 9</SelectItem>
                  <SelectItem value="10">Grade 10</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedSection} onValueChange={(val) => val && setSelectedSection(val)}>
                <SelectTrigger className="w-40 rounded-xl border-gray-200">
                  <SelectValue>
                    {selectedSection === "all" ? "All Sections" : sections.find((s) => s.id === selectedSection)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sections</SelectItem>
                  {sections
                    .filter(s => s.enrollProId !== null || students.some(st => st.sectionId === s.id))
                    .map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.name} ({section.gradeLevel.replace("GRADE_", "Grade ")})
                      </SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="block md:hidden p-4 space-y-3">
                {paginatedStudents.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500 font-medium">No students found</p>
                    <p className="text-gray-400 text-sm mt-1">Try adjusting your search or filters</p>
                  </div>
                ) : (
                  paginatedStudents.map((student) => {
                    const normalizedGrade = (student.gradeLevel || "").replace("GRADE_", "");
                    return (
                      <div 
                        key={student.id}
                        className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
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
                              <p className="font-semibold text-gray-900">
                                {student.lastName}, {student.firstName}
                              </p>
                              <p className="text-xs text-gray-500 font-mono">{student.lrn}</p>
                            </div>
                          </div>
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
                        <div className="flex flex-wrap gap-2">
                          <Badge className={student.gender?.toUpperCase() === "MALE" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}>
                            {student.gender}
                          </Badge>
                          <Badge style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>
                            {gradeLevelLabels[student.gradeLevel || ""] || `Grade ${normalizedGrade}`}
                          </Badge>
                          <Badge variant="outline" className="text-gray-600">
                            {student.sectionName || "-"}
                          </Badge>
                          <Badge style={student.status === "ENROLLED" ? { backgroundColor: `${colors.primary}15`, color: colors.primary } : undefined} className={student.status !== "ENROLLED" ? "bg-gray-100 text-gray-600" : ""}>
                            {student.status || "N/A"}
                          </Badge>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white border-b border-slate-100 hover:bg-white">
                    <TableHead className="font-bold text-slate-800 py-4">LRN</TableHead>
                    <TableHead className="font-bold text-slate-800 py-4">Student Name</TableHead>
                    <TableHead className="font-bold text-slate-800 py-4">Gender</TableHead>
                    <TableHead className="font-bold text-slate-800 py-4">Grade Level</TableHead>
                    <TableHead className="font-bold text-slate-800 py-4">Section</TableHead>
                    <TableHead className="font-bold text-slate-800 py-4">Status</TableHead>
                    <TableHead className="font-bold text-slate-800 py-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedStudents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20">
                        <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                        <p className="text-gray-500 font-medium">No students found</p>
                        <p className="text-gray-400 text-sm mt-1">Try adjusting your search or filters</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                  paginatedStudents.map((student) => {
                    const normalizedGrade = (student.gradeLevel || "").replace("GRADE_", "");
                    return (
                      <TableRow key={student.id} className="transition-colors border-b border-slate-50 hover:bg-slate-50/50">
                        <TableCell className="font-mono text-sm text-slate-500 py-4">{student.lrn}</TableCell>
                        <TableCell className="py-4">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-semibold text-sm shadow-sm"
                              style={{ backgroundColor: colors.primary }}
                            >
                              {student.lastName.charAt(0)}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900">
                                {student.lastName}, {student.firstName} {student.middleName || ""} {student.suffix || ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <Badge className={student.gender?.toUpperCase() === "MALE" || student.gender?.toUpperCase() === "M" ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-pink-50 text-pink-700 border-pink-100"} variant="outline">
                            {student.gender}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4">
                          <Badge style={{ backgroundColor: `${colors.primary}10`, color: colors.primary, borderColor: `${colors.primary}20` }} variant="outline">
                            {gradeLevelLabels[student.gradeLevel || ""] || `Grade ${normalizedGrade}`}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-slate-600 py-4">{student.sectionName || "-"}</TableCell>
                        <TableCell className="py-4">
                          <Badge 
                            variant="outline"
                            className={student.status === "ENROLLED" 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                              : "bg-slate-50 text-slate-600 border-slate-100"
                            }
                          >
                            {student.status || "N/A"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right py-4">
                          <div className="flex items-center justify-end gap-2">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleViewStudent(student)}
                              className="h-9 px-4 rounded-xl font-medium transition-all hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-100"
                              style={{ ['--hover-text' as any]: colors.primary }}
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              View
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                  )}
                </TableBody>
              </Table>
              </div>
            </>
          )}
          
          {/* Pagination */}
          {!loading && filteredStudents.length > 0 && (
            <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50/30">
              <div className="flex items-center gap-4 text-sm font-semibold text-slate-800">
                <span>
                  Showing {filteredStudents.length === 0 ? 0 : (currentPage - 1) * limit + 1} to {Math.min(currentPage * limit, filteredStudents.length)} of {filteredStudents.length} Learners
                </span>
                <div className="h-4 w-px bg-slate-300 mx-2" />
                <div className="flex items-center gap-2">
                  <span>Rows per page:</span>
                  <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                    <SelectTrigger className="h-9 w-20 rounded-lg border-slate-200 bg-white">
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
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <Button
                  variant="default"
                  size="sm"
                  className="h-9 w-9 rounded-lg bg-[#800000] hover:bg-[#600000] text-white font-bold shadow-sm"
                >
                  {currentPage}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Student Detail Dialog */}
      <Dialog open={studentDetailOpen} onOpenChange={setStudentDetailOpen}>
        <DialogContent className="w-[95vw] sm:!max-w-3xl md:!max-w-4xl lg:!max-w-5xl xl:!max-w-6xl max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8">
          <DialogHeader className="pb-4 sm:pb-6">
            <DialogTitle className="flex items-center gap-2 sm:gap-3 text-gray-900 text-xl sm:text-2xl">
              <Users className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600" />
              Student Record
            </DialogTitle>
          </DialogHeader>
          
          {selectedStudent && (
            <div className="space-y-6 sm:space-y-8">
              {/* Student Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 p-4 rounded-xl border-2 border-blue-200 shadow-sm">
                  <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">LRN</p>
                  <p className="font-mono font-bold text-gray-900 text-sm break-all">{selectedStudent.lrn}</p>
                </div>
                <div className="p-4 rounded-xl border-2 shadow-sm" style={{ backgroundColor: `${colors.primary}08`, borderColor: `${colors.primary}30` }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: colors.primary }}>Name</p>
                  <p className="font-bold text-gray-900 text-sm leading-tight truncate" title={`${selectedStudent.lastName}, ${selectedStudent.firstName}`}>
                    {selectedStudent.lastName}, {selectedStudent.firstName}
                  </p>
                </div>
                <div className="p-4 rounded-xl border-2 shadow-sm" style={{ backgroundColor: `${colors.secondary}08`, borderColor: `${colors.secondary}30` }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: colors.secondary }}>Gender</p>
                  <p className="font-bold text-gray-900 text-sm">{selectedStudent.gender || "-"}</p>
                </div>
                <div className="p-4 rounded-xl border-2 shadow-sm" style={{ backgroundColor: `${colors.accent}08`, borderColor: `${colors.accent}30` }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: colors.accent }}>Birth Date</p>
                  <p className="font-bold text-gray-900 text-xs">{formatDate(selectedStudent.birthDate)}</p>
                </div>
                <div className="p-4 rounded-xl border-2 shadow-sm bg-gray-50 border-gray-200">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Guardian</p>
                  <p className={`font-bold text-sm ${!selectedStudent.guardianName ? 'text-red-400 italic font-normal' : 'text-gray-900'}`}>
                    {selectedStudent.guardianName || "Not Set"}
                  </p>
                </div>
                <div className="p-4 rounded-xl border-2 shadow-sm bg-gray-50 border-gray-200">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Address</p>
                  <p className={`font-bold text-xs leading-tight line-clamp-2 ${!selectedStudent.address ? 'text-red-400 italic font-normal' : 'text-gray-900'}`} title={selectedStudent.address}>
                    {selectedStudent.address || "No address on record"}
                  </p>
                </div>
              </div>

              {/* Data Completeness Alert (What's needing) */}
              {(() => {
                const missing = [];
                if (!selectedStudent.birthDate) missing.push("Birth Date");
                if (!selectedStudent.lrn || selectedStudent.lrn.trim() === "") missing.push("LRN");
                if (!selectedStudent.address) missing.push("Home Address");
                if (!selectedStudent.guardianName) missing.push("Guardian Name");
                
                if (missing.length === 0) return null;
                
                return (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 animate-pulse-subtle">
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                    <div>
                      <h4 className="text-sm font-bold text-red-900">Information Needed</h4>
                      <p className="text-xs text-red-700 mt-0.5">
                        The following fields are empty and should be synced from EnrollPro: 
                        <span className="font-bold ml-1">{missing.join(", ")}</span>
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Form Compliance Checklist */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2 ml-1">
                  <FileCheck className="w-3.5 h-3.4" style={{ color: colors.primary }} />
                  School Forms Readiness
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  <FormStatusCard 
                    label="SF1" 
                    title="School Register" 
                    status={selectedStudent.status === 'ENROLLED' ? 'completed' : 'pending'} 
                    description="Master list of enrolled students"
                  />
                  <FormStatusCard 
                    label="SF2" 
                    title="Daily Attendance Report" 
                    status={sf9Data && Object.keys(sf9Data.attendance || {}).length > 0 ? 'completed' : 'pending'} 
                    description="Daily attendance tracking"
                  />
                  <FormStatusCard 
                    label="SF3" 
                    title="Books Issued and Returned" 
                    status="dev" 
                    description="Textbook and material tracking"
                  />
                  <FormStatusCard 
                    label="SF4" 
                    title="Monthly Learner's Movement and Attendance" 
                    status="dev" 
                    description="Enrollment and dropout summary"
                  />
                  <FormStatusCard 
                    label="SF5" 
                    title="Report on Promotion" 
                    status="dev" 
                    description="Final academic performance"
                  />
                  <FormStatusCard 
                    label="SF6" 
                    title="Summarized Report on Promotion" 
                    status="dev" 
                    description="Consolidated promotion summary"
                  />
                  <FormStatusCard 
                    label="SF7" 
                    title="School Personnel Assignment List" 
                    status="dev" 
                    description="Staff and teaching assignments"
                  />
                  <FormStatusCard 
                    label="SF8" 
                    title="Learner's Basic Health Profile" 
                    status="dev" 
                    description="BMI and nutritional status"
                  />
                  <FormStatusCard 
                    label="SF9" 
                    title="Learner's Progress Report Card" 
                    status={sf9Data && sf9Data.subjectGrades?.length > 0 ? 'completed' : 'pending'} 
                    description="Quarterly issued report card"
                  />
                  <FormStatusCard 
                    label="SF10" 
                    title="Learner's Permanent Academic Record" 
                    status={sf10Data && sf10Data.schoolRecords?.length > 0 ? 'completed' : 'pending'} 
                    description="Official cumulative record"
                  />
                </div>
              </div>

              {loadingDetail ? (
                <div className="flex items-center justify-center py-12 sm:py-16">
                  <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 animate-spin text-blue-600" />
                </div>
              ) : (
                <>
                  {/* Current Year Grades (SF9 Preview) */}
                  {sf9Data && (
                    <div className="bg-white border-2 border-gray-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8 shadow-md">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-6 gap-3">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
                          <h3 className="font-bold text-gray-900 text-lg sm:text-xl">Current Year Grades (SF9)</h3>
                        </div>
                        <Badge variant="outline" className="text-sm sm:text-base py-1 px-3 sm:py-2 sm:px-4 w-fit">S.Y. {selectedSchoolYear}</Badge>
                      </div>
                      <div className="overflow-x-auto -mx-2 sm:-mx-4 px-2 sm:px-4">
                        <Table className="min-w-[400px] sm:min-w-[500px]">
                          <TableHeader>
                            <TableRow className="bg-gradient-to-r from-gray-50 to-gray-100">
                              <TableHead className="font-bold text-gray-900 py-3 sm:py-4 text-sm sm:text-base">Subject</TableHead>
                              <TableHead className="text-center font-bold text-gray-900 py-3 sm:py-4 text-sm sm:text-base w-14 sm:w-20">Q1</TableHead>
                              <TableHead className="text-center font-bold text-gray-900 py-3 sm:py-4 text-sm sm:text-base w-14 sm:w-20">Q2</TableHead>
                              <TableHead className="text-center font-bold text-gray-900 py-3 sm:py-4 text-sm sm:text-base w-14 sm:w-20">Q3</TableHead>
                              <TableHead className="text-center font-bold text-gray-900 py-3 sm:py-4 text-sm sm:text-base w-14 sm:w-20">Q4</TableHead>
                              <TableHead className="text-center font-bold text-gray-900 py-3 sm:py-4 text-sm sm:text-base w-14 sm:w-20">Final</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sf9Data.subjectGrades.map((sg: any) => (
                              <TableRow key={sg.subjectCode} className="border-b border-gray-200">
                                <TableCell className="font-semibold text-gray-900 py-3 sm:py-4 text-sm sm:text-base">{sg.subjectName}</TableCell>
                                <TableCell className="text-center text-gray-900 py-3 sm:py-4 text-sm sm:text-base">{sg.Q1 ?? "-"}</TableCell>
                                <TableCell className="text-center text-gray-900 py-3 sm:py-4 text-sm sm:text-base">{sg.Q2 ?? "-"}</TableCell>
                                <TableCell className="text-center text-gray-900 py-3 sm:py-4 text-sm sm:text-base">{sg.Q3 ?? "-"}</TableCell>
                                <TableCell className="text-center text-gray-900 py-3 sm:py-4 text-sm sm:text-base">{sg.Q4 ?? "-"}</TableCell>
                                <TableCell className="text-center font-bold text-gray-900 py-3 sm:py-4 text-sm sm:text-base">{sg.final ?? "-"}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="bg-gradient-to-r from-blue-50 to-blue-100 font-bold border-t-4 border-blue-300">
                              <TableCell colSpan={5} className="text-right text-gray-900 py-4 sm:py-5 text-base sm:text-lg">General Average:</TableCell>
                              <TableCell className="text-center text-2xl sm:text-3xl text-blue-700 py-4 sm:py-5 font-extrabold">{sf9Data.generalAverage?.toFixed(2) ?? "-"}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Academic History (SF10 Preview) */}
                  {sf10Data && sf10Data.schoolRecords.length > 0 && (
                    <div className="bg-white border-2 border-gray-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8 shadow-md">
                      <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
                        <FolderOpen className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: colors.primary }} />
                        <h3 className="font-bold text-gray-900 text-lg sm:text-xl">Academic History (SF10)</h3>
                      </div>
                      <div className="space-y-4 sm:space-y-5">
                        {sf10Data.schoolRecords.map((record: any) => (
                          <div key={record.schoolYear} className="border-2 rounded-xl p-4 sm:p-6 shadow-sm" style={{ backgroundColor: `${colors.primary}08`, borderColor: `${colors.primary}30` }}>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2 sm:gap-3">
                              <h4 className="font-bold text-gray-900 text-base sm:text-lg">S.Y. {record.schoolYear} - Grade {record.gradeLevel.replace('GRADE_', '')}</h4>
                              <Badge variant="outline" className="bg-white text-sm sm:text-base py-1 px-3 sm:py-2 sm:px-4 w-fit">{record.section}</Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 sm:gap-5">
                              <span className="font-semibold text-gray-900 text-sm sm:text-base">GWA: <strong className="text-xl sm:text-2xl text-blue-700 ml-1">{record.generalAverage?.toFixed(2) ?? "-"}</strong></span>
                              {record.honors && <Badge className="bg-amber-100 text-amber-800 border-2 border-amber-300 py-1 px-3 sm:py-2 sm:px-4 text-xs sm:text-sm font-semibold">{record.honors}</Badge>}
                              <Badge className={record.promotionStatus === "Promoted" ? "bg-emerald-100 text-emerald-800 border-2 border-emerald-300 py-1 px-3 sm:py-2 sm:px-4 text-xs sm:text-sm font-semibold" : "bg-red-100 text-red-800 border-2 border-red-300 py-1 px-3 sm:py-2 sm:px-4 text-xs sm:text-sm font-semibold"}>
                                {record.promotionStatus || "-"}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
