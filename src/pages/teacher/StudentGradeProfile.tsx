import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  User,
  GraduationCap,
  Calendar,
  Award,
  BookOpen,
  CheckCircle2,
  XCircle,
  Clock,
  Phone,
  MapPin,
  Medal,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { advisoryApi, type StudentGradeProfile } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

// DepEd mastery level helper
function getMasteryLevel(grade: number | null): { label: string; color: string; bgColor: string } {
  if (grade === null) return { label: "Not Graded", color: "text-gray-500", bgColor: "bg-gray-100" };
  if (grade >= 90) return { label: "Outstanding", color: "text-emerald-700", bgColor: "bg-emerald-100" };
  if (grade >= 85) return { label: "Very Satisfactory", color: "text-blue-700", bgColor: "bg-blue-100" };
  if (grade >= 80) return { label: "Satisfactory", color: "text-amber-700", bgColor: "bg-amber-100" };
  if (grade >= 75) return { label: "Fairly Satisfactory", color: "text-orange-700", bgColor: "bg-orange-100" };
  return { label: "Did Not Meet", color: "text-red-700", bgColor: "bg-red-100" };
}

// Format date helper
function formatDate(dateString?: string): string {
  if (!dateString) return "N/A";
  return new Date(dateString).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function StudentGradeProfilePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const location = useLocation();
  const { colors } = useTheme();
  const [data, setData] = useState<StudentGradeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudentGrades = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await advisoryApi.getStudentGrades(studentId);
      setData(res.data);
    } catch (err) {
      setError("Failed to load student grades");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  // Re-fetch when studentId changes OR when navigating to the page (location.key changes)
  useEffect(() => {
    fetchStudentGrades();
  }, [fetchStudentGrades, location.key]);

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
              style={{ borderColor: colors.primary, borderTopColor: 'transparent' }}
            />
          </div>
          <p className="text-gray-500 font-medium">Loading student profile...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-red-100 to-rose-100 flex items-center justify-center shadow-lg">
            <span className="text-4xl">😕</span>
          </div>
          <h3 className="font-semibold text-gray-900 text-lg mb-2">Something went wrong</h3>
          <p className="text-gray-500 mb-6">{error || "Failed to load student data"}</p>
          <Link to="/teacher/advisory">
            <Button variant="outline" className="rounded-xl">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Advisory
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { student, enrollment, subjectGrades, summary } = data;
  const fullName = `${student.lastName}, ${student.firstName} ${student.middleName ? `${student.middleName.charAt(0)}.` : ""} ${student.suffix || ""}`.trim();

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header with Back Button */}
      <div className="flex items-center gap-4">
        <Link to="/teacher/advisory">
          <Button variant="outline" size="icon" className="rounded-xl border-gray-300 hover:bg-gray-100">
            <ArrowLeft className="w-5 h-5 text-gray-900" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#111827' }}>Student Grade Profile</h1>
          <p style={{ color: '#4b5563' }}>Complete academic record</p>
        </div>
      </div>

      {/* Student Info Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <Card className="lg:col-span-2 border-0 shadow-xl shadow-gray-200/50 bg-white overflow-hidden rounded-2xl p-0">
          <CardHeader className="border-b border-gray-100 px-6 py-5" style={{ backgroundColor: `${colors.primary}08` }}>
            <div className="flex items-center gap-4">
              <div 
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg"
                style={{ backgroundColor: colors.primary }}
              >
                {student.lastName.charAt(0)}
              </div>
              <div>
                <CardTitle className="text-xl font-bold text-gray-900">{fullName}</CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>
                    LRN: {student.lrn}
                  </Badge>
                  <Badge className={`${
                    student.gender?.toLowerCase() === "male"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-pink-100 text-pink-700"
                  }`}>
                    {student.gender || "N/A"}
                  </Badge>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-gray-100">
                    <GraduationCap className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Grade & Section</p>
                    <p className="font-semibold text-gray-900">
                      {gradeLevelLabels[enrollment.gradeLevel] || enrollment.gradeLevel} - {enrollment.sectionName}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-gray-100">
                    <Calendar className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">School Year</p>
                    <p className="font-semibold text-gray-900">{enrollment.schoolYear}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-gray-100">
                    <Calendar className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Birth Date</p>
                    <p className="font-semibold text-gray-900">{formatDate(student.birthDate)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-gray-100">
                    <MapPin className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Address</p>
                    <p className="font-semibold text-gray-900">{student.address || "N/A"}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-gray-100">
                    <User className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Guardian</p>
                    <p className="font-semibold text-gray-900">{student.guardianName || "N/A"}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-gray-100">
                    <Phone className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Contact Number</p>
                    <p className="font-semibold text-gray-900">{student.guardianContact || "N/A"}</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Card */}
        <Card className="border-0 shadow-xl shadow-gray-200/50 overflow-hidden rounded-2xl text-white p-0" style={{ backgroundColor: colors.primary }}>
          <CardContent className="p-6 h-full flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-white/20 backdrop-blur-sm">
                <Award className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg">Academic Summary</h3>
            </div>
            
            <div className="space-y-4 flex-1">
              <div className="p-4 rounded-xl bg-white/10 backdrop-blur-sm">
                <p className="text-white/70 text-sm mb-1">General Average</p>
                <p className="text-4xl font-bold">
                  {summary.generalAverage !== null ? summary.generalAverage.toFixed(2) : "N/A"}
                </p>
                {summary.generalAverage !== null && (
                  <Badge className={`mt-2 ${getMasteryLevel(summary.generalAverage).bgColor} ${getMasteryLevel(summary.generalAverage).color}`}>
                    {getMasteryLevel(summary.generalAverage).label}
                  </Badge>
                )}
              </div>
              
              {summary.honors && (
                <div className="p-4 rounded-xl backdrop-blur-sm border" style={{ backgroundColor: `${colors.accent}30`, borderColor: `${colors.accent}40` }}>
                  <div className="flex items-center gap-2">
                    <Medal className="w-5 h-5" style={{ color: colors.accent }} />
                    <p className="font-bold text-white">{summary.honors}</p>
                  </div>
                </div>
              )}
              
              <div className="p-4 rounded-xl bg-white/10 backdrop-blur-sm">
                <p className="text-white/70 text-sm mb-1">Status</p>
                <Badge className={`${
                  summary.promotionStatus === "PROMOTED" ? "text-white" :
                  summary.promotionStatus === "CONDITIONALLY PROMOTED" ? "bg-amber-400/30 text-amber-100" :
                  summary.promotionStatus === "RETAINED" ? "bg-red-400/30 text-red-100" :
                  "bg-gray-400/30 text-gray-100"
                }`}
                  style={summary.promotionStatus === "PROMOTED" ? { backgroundColor: `${colors.primary}50`, color: 'white' } : undefined}
                >
                  {summary.promotionStatus || "Pending"}
                </Badge>
              </div>
              
              <div className="p-4 rounded-xl bg-white/10 backdrop-blur-sm">
                <p className="text-white/70 text-sm mb-1">Progress</p>
                <p className="text-lg font-semibold">
                  {summary.completedSubjects} / {summary.totalSubjects} Subjects Graded
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grades Table */}
      <Card className="border-0 shadow-xl shadow-gray-200/50 bg-white overflow-hidden rounded-2xl p-0">
        <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-slate-50 px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div 
                className="p-2.5 rounded-xl text-white shadow-lg"
                style={{ backgroundColor: colors.primary }}
              >
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-gray-900">Subject Grades</CardTitle>
                <CardDescription className="text-gray-500 text-sm">
                  Term grades and final rating per subject
                </CardDescription>
              </div>
            </div>
            <Badge style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}>
              S.Y. {enrollment.schoolYear}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/80">
                  <TableHead className="font-bold text-gray-700 min-w-[200px]">Subject</TableHead>
                  <TableHead className="font-bold text-gray-700 text-center">T1</TableHead>
                  <TableHead className="font-bold text-gray-700 text-center">T2</TableHead>
                  <TableHead className="font-bold text-gray-700 text-center">T3</TableHead>
                  <TableHead className="font-bold text-gray-700 text-center" style={{ backgroundColor: `${colors.primary}08` }}>Final Grade</TableHead>
                  <TableHead className="font-bold text-gray-700 text-center">Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjectGrades.map((subject) => (
                  <TableRow key={subject.subjectId} className="hover:bg-gray-50/50">
                    <TableCell>
                      <div>
                        <p className="font-semibold text-gray-900">{subject.subjectName}</p>
                        <p className="text-xs text-gray-500">{subject.teacher}</p>
                      </div>
                    </TableCell>
                    {(["T1", "T2", "T3"] as const).map((term) => {
                      const grade = subject.grades[term]?.quarterlyGrade;
                      const descriptor = subject.grades[term]?.qualitativeDescriptor;
                      const isHG = subject.subjectCode.startsWith("HG");
                      return (
                        <TableCell key={term} className="text-center">
                          {grade !== null && grade !== undefined ? (
                            <span className={`font-semibold ${grade >= 75 ? "text-gray-900" : "text-red-600"}`}>
                              {grade}
                            </span>
                          ) : isHG && descriptor ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px]">
                              {descriptor}
                            </Badge>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center" style={{ backgroundColor: `${colors.primary}06` }}>
                      {subject.finalGrade !== null ? (
                        <span className={`text-lg font-bold ${subject.finalGrade >= 75 ? "" : "text-red-600"}`} style={subject.finalGrade >= 75 ? { color: colors.primary } : undefined}>
                          {subject.finalGrade}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {subject.remarks ? (
                        <Badge className={`${
                          subject.remarks === "PASSED" 
                            ? "bg-emerald-100 text-emerald-700" 
                            : subject.remarks === "QUALITATIVE"
                            ? "bg-sky-100 text-sky-700"
                            : "bg-red-100 text-red-700"
                        }`}>
                          {subject.remarks === "PASSED" ? (
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                          ) : subject.remarks === "QUALITATIVE" ? (
                            <BookOpen className="w-3 h-3 mr-1" />
                          ) : (
                            <XCircle className="w-3 h-3 mr-1" />
                          )}
                          {subject.remarks === "QUALITATIVE" ? "Descriptor-Based" : subject.remarks}
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-500">
                          <Clock className="w-3 h-3 mr-1" />
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                
                {/* General Average Row */}
                <TableRow className="border-t-2" style={{ backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}30` }}>
                  <TableCell colSpan={5} className="font-bold text-right pr-8" style={{ color: colors.primary }}>
                    General Average:
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-2xl font-bold" style={{ color: colors.primary }}>
                      {summary.generalAverage !== null ? summary.generalAverage.toFixed(2) : "N/A"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    {summary.promotionStatus && (
                      <Badge className={`${
                        summary.promotionStatus === "PROMOTED" ? "text-white" :
                        summary.promotionStatus === "CONDITIONALLY PROMOTED" ? "bg-amber-500 text-white" :
                        "bg-red-500 text-white"
                      }`}
                        style={summary.promotionStatus === "PROMOTED" ? { backgroundColor: colors.primary } : undefined}
                      >
                        {summary.promotionStatus}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* DepEd Grading Legend */}
      <Card className="border-0 shadow-lg shadow-gray-200/50 bg-white overflow-hidden rounded-2xl p-0">
        <CardHeader className="border-b border-gray-100 px-6 py-4">
          <CardTitle className="text-sm font-bold text-gray-700">DepEd Grading Scale</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { label: "Outstanding", range: "90-100", opacity: "18" },
              { label: "Very Satisfactory", range: "85-89", opacity: "28" },
              { label: "Satisfactory", range: "80-84", opacity: "38" },
              { label: "Fairly Satisfactory", range: "75-79", opacity: "48" },
              { label: "Did Not Meet Expectations", range: "Below 75", color: "bg-red-100 text-red-700 border-red-200" },
            ].map((level) => (
              <div key={level.label} className={`p-3 rounded-xl border ${level.color || ''}`}
                style={!level.color ? { backgroundColor: `${colors.primary}${level.opacity}`, color: colors.primary, borderColor: `${colors.primary}30` } : undefined}
              >
                <p className="font-semibold text-sm">{level.label}</p>
                <p className="text-xs opacity-80">{level.range}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <h4 className="font-bold text-gray-700 text-sm mb-3">Academic Honors (Based on General Average):</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "With Highest Honors", range: "98-100", icon: "🏆" },
                { label: "With High Honors", range: "95-97", icon: "🥇" },
                { label: "With Honors", range: "90-94", icon: "🥈" },
              ].map((honor) => (
                <div key={honor.label} className="flex items-center gap-3 p-3 rounded-xl border" style={{ backgroundColor: `${colors.primary}08`, borderColor: `${colors.primary}25` }}>
                  <span className="text-2xl">{honor.icon}</span>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: colors.primary }}>{honor.label}</p>
                    <p className="text-xs" style={{ color: `${colors.primary}aa` }}>{honor.range}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
