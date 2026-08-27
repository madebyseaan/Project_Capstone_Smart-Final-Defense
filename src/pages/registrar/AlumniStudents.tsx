import { useState, useEffect, useRef } from "react";
import {
  Search,
  FileText,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  GraduationCap,
  UserX,
  ArrowRightLeft,
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
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useTheme } from "@/contexts/ThemeContext";

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
  "ENROLLED": { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
  "TRANSFERRED": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  "DROPPED": { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
};

const statusLabels: Record<string, string> = {
  "ENROLLED": "Enrolled",
  "TRANSFERRED": "Transferred",
  "DROPPED": "NLS",
};

const tabConfig = [
  { key: "all", label: "All", icon: Users },
  { key: "graduated", label: "Graduated", icon: GraduationCap },
  { key: "DROPPED", label: "NLS", icon: UserX },
  { key: "TRANSFERRED", label: "Transferred", icon: ArrowRightLeft },
];

export default function AlumniStudents() {
  const { theme, colors } = useTheme();
  const [students, setStudents] = useState<AlumniStudent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, graduated: 0, DROPPED: 0, TRANSFERRED: 0 });

  useEffect(() => {
    loadAlumni();
  }, [gradeFilter, page, activeTab, rowsPerPage]);

  useEffect(() => {
    loadCounts();
  }, []);

  const loadCounts = async () => {
    try {
      const [allRes, gradRes, nlsRes, transRes] = await Promise.all([
        registrarApi.getAlumni({ limit: 1 }),
        registrarApi.getAlumni({ status: 'graduated', limit: 1 }),
        registrarApi.getAlumni({ status: 'DROPPED', limit: 1 }),
        registrarApi.getAlumni({ status: 'TRANSFERRED', limit: 1 }),
      ]);
      setCounts({
        all: allRes.data.total || 0,
        graduated: gradRes.data.total || 0,
        DROPPED: nlsRes.data.total || 0,
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

  const totalPages = Math.ceil(total / rowsPerPage);
  const startItem = page * rowsPerPage + 1;
  const endItem = Math.min((page + 1) * rowsPerPage, total);

  return (
    <div className={`p-6 space-y-6 ${theme === 'dark' ? 'bg-gray-900 text-gray-100' : ''}`}>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/registrar" },
          { label: "Former Students" },
        ]}
      />

      {/* Main Card */}
      <Card className={`rounded-2xl shadow-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
        <CardContent className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl" style={{ backgroundColor: `${colors.primary}15` }}>
                <Users className="h-5 w-5" style={{ color: colors.primary }} />
              </div>
              <div>
                <h2 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  Former Students
                </h2>
                <p className={`text-xs uppercase tracking-wider font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  {total} Learners Found
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search by name or LRN..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className={`pl-9 w-64 rounded-xl ${theme === 'dark' ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}
                />
              </div>
              <Select value={gradeFilter} onValueChange={(v) => { setGradeFilter(v); setPage(0); }}>
                <SelectTrigger className={`w-[140px] rounded-xl ${theme === 'dark' ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
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

          {/* Tabs - Pill style */}
          <div className={`flex items-center gap-1 p-1 rounded-xl mb-6 ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'}`}>
            {tabConfig.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); setPage(0); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-white shadow-sm text-gray-900'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                  } ${theme === 'dark' && isActive ? 'bg-gray-600 text-white' : ''} ${theme === 'dark' && !isActive ? 'text-gray-400 hover:text-gray-300' : ''}`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                    isActive
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-gray-200/50 text-gray-400'
                  } ${theme === 'dark' && isActive ? 'bg-gray-500 text-gray-200' : ''} ${theme === 'dark' && !isActive ? 'bg-gray-600 text-gray-400' : ''}`}>
                    {counts[tab.key] || 0}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Table */}
          <div className={`rounded-xl border ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
            <Table>
              <TableHeader>
                <TableRow className={`${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>LRN</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Learner Name</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Sex</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Prior Grade</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Prior Section</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Last SY</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Program</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Status</TableHead>
                  <TableHead className={`font-semibold text-xs uppercase tracking-wider text-right ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-16">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: colors.primary }} />
                    </TableCell>
                  </TableRow>
                ) : students.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-16">
                      <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                      <p className="text-gray-500 font-medium">No learners found matching your criteria</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  students.map((student) => (
                    <TableRow key={student.id} className={`hover:${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-50'}`}>
                      <TableCell className="font-mono text-sm">{student.lrn}</TableCell>
                      <TableCell className="font-medium">{formatName(student)}</TableCell>
                      <TableCell>{student.gender || "-"}</TableCell>
                      <TableCell>{formatGradeLevel(student.lastGradeLevel)}</TableCell>
                      <TableCell>{student.lastSection}</TableCell>
                      <TableCell>{student.lastSchoolYear}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{student.lastProgram}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs border ${statusStyles[student.enrollmentStatus]?.bg || 'bg-gray-50'} ${statusStyles[student.enrollmentStatus]?.text || 'text-gray-700'} ${statusStyles[student.enrollmentStatus]?.border || 'border-gray-200'}`}
                        >
                          {statusLabels[student.enrollmentStatus] || student.enrollmentStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewSF10(student.id)}
                          className="rounded-lg"
                        >
                          <FileText className="h-4 w-4 mr-1" /> SF10
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Footer */}
          <div className={`flex items-center justify-between mt-4 pt-4 border-t ${theme === 'dark' ? 'border-gray-700' : 'border-gray-100'}`}>
            <div className="flex items-center gap-4">
              <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                Showing {total > 0 ? startItem : 0} to {endItem} of {total} Learners
              </span>
              <div className="flex items-center gap-2">
                <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Rows per page:</span>
                <Select value={String(rowsPerPage)} onValueChange={(v) => { setRowsPerPage(Number(v)); setPage(0); }}>
                  <SelectTrigger className={`w-[70px] h-8 text-sm ${theme === 'dark' ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
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
                className="h-8 w-8 rounded-lg"
                disabled={page === 0}
                onClick={() => setPage(0)}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="h-8 w-8 flex items-center justify-center rounded-lg text-sm font-medium" style={{ backgroundColor: colors.primary, color: 'white' }}>
                {page + 1}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(totalPages - 1)}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
