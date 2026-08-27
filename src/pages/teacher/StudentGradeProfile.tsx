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
  MapPin,
  Medal,
  Home,
  Users,
  Heart,
  Shield,
  AlertTriangle,
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

// Extended info row for additional details
function ExtendedInfoRow({ icon, label, value, color, sub }: { icon: React.ReactNode; label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3 group p-2.5 -mx-2.5 rounded-xl transition-colors duration-200 hover:bg-gray-50">
      <div className="p-2 rounded-xl transition-colors duration-200 group-hover:scale-110" style={{ backgroundColor: `${color}08` }}>
        <div style={{ color: `${color}aa` }}>{icon}</div>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-0.5">{label}</p>
        <p className="font-semibold text-gray-800 text-sm leading-snug">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
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
    <div className="space-y-6 animate-fade-in">
      {/* Header with Back Button */}
      <div className="flex items-center gap-4">
        <Link to="/teacher/advisory">
          <Button variant="outline" size="icon" className="rounded-xl border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all duration-200">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Student Grade Profile</h1>
          <p className="text-sm text-gray-500">Complete academic record</p>
        </div>
      </div>

      {/* Student Info Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <Card className="lg:col-span-2 border-0 shadow-xl shadow-gray-200/50 bg-white overflow-hidden rounded-2xl p-0">
          <CardHeader className="px-6 py-4 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${colors.primary}12 0%, ${colors.primary}06 100%)` }}>
            <div className="absolute top-0 right-0 w-32 h-32 opacity-5" style={{ background: `radial-gradient(circle, ${colors.primary} 0%, transparent 70%)` }} />
            <div className="flex items-center gap-4">
              <div 
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-lg ring-2 ring-white/50"
                style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}dd 100%)` }}
              >
                {student.lastName.charAt(0)}
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-gray-900 tracking-tight">{fullName}</CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className="font-mono text-[10px]" style={{ backgroundColor: `${colors.primary}12`, color: colors.primary }}>
                    LRN: {student.lrn}
                  </Badge>
                  <Badge className={`text-[10px] font-medium ${
                    student.gender?.toLowerCase() === "male"
                      ? "bg-blue-50 text-blue-700 border border-blue-100"
                      : "bg-pink-50 text-pink-700 border border-pink-100"
                  }`}>
                    {student.gender || "N/A"}
                  </Badge>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 py-4 pb-3">
            {/* Compact info pills */}
            <div className="flex flex-wrap gap-x-5 gap-y-2 mb-4">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-4 h-4" style={{ color: `${colors.primary}99` }} />
                <div>
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Grade & Section</span>
                  <p className="text-sm font-semibold text-gray-800 leading-tight">{gradeLevelLabels[enrollment.gradeLevel] || enrollment.gradeLevel} — {enrollment.sectionName}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" style={{ color: `${colors.primary}99` }} />
                <div>
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">School Year</span>
                  <p className="text-sm font-semibold text-gray-800 leading-tight">{enrollment.schoolYear}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" style={{ color: `${colors.primary}99` }} />
                <div>
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Birth Date</span>
                  <p className="text-sm font-semibold text-gray-800 leading-tight">{formatDate(student.birthDate)}</p>
                </div>
              </div>
            </div>

            {/* Contact strip */}
            {(student.guardianName || student.guardianContact) && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-sm">
                {student.guardianName && (
                  <span className="text-gray-600">
                    <span className="text-gray-400 text-xs">Guardian:</span>{" "}
                    <span className="font-medium text-gray-800">{student.guardianName}</span>
                    {student.guardianContact && <span className="text-gray-400 ml-1.5">• {student.guardianContact}</span>}
                  </span>
                )}
              </div>
            )}

            {/* Extended Profile Section */}
            <div className="pt-4 mt-2 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1 rounded-md" style={{ backgroundColor: `${colors.primary}10` }}>
                  <Users className="w-3 h-3" style={{ color: colors.primary }} />
                </div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Additional Information</span>
              </div>
              <div className="space-y-4">
                {/* Background & Location */}
                {(student.religion || student.motherTongue || student.barangay || student.city || student.province) && (
                  <div>
                    <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-2 px-0.5">Background & Location</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {student.religion && <ExtendedInfoRow icon={<Heart className="w-3.5 h-3.5" />} label="Religion" value={student.religion} color={colors.primary} />}
                      {student.motherTongue && <ExtendedInfoRow icon={<Users className="w-3.5 h-3.5" />} label="Mother Tongue" value={student.motherTongue} color={colors.primary} />}
                      {student.barangay && <ExtendedInfoRow icon={<Home className="w-3.5 h-3.5" />} label="Barangay" value={student.barangay} color={colors.primary} />}
                      {student.city && <ExtendedInfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="City/Municipality" value={student.city} color={colors.primary} />}
                      {student.province && <ExtendedInfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="Province" value={student.province} color={colors.primary} />}
                    </div>
                  </div>
                )}

                {/* Family */}
                {(student.fatherName || student.motherName) && (
                  <div>
                    <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-2 px-0.5">Family</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {student.fatherName && <ExtendedInfoRow icon={<User className="w-3.5 h-3.5" />} label="Father" value={student.fatherName} sub={student.fatherContact} color={colors.primary} />}
                      {student.motherName && <ExtendedInfoRow icon={<User className="w-3.5 h-3.5" />} label="Mother" value={student.motherName} sub={student.motherContact} color={colors.primary} />}
                    </div>
                  </div>
                )}

                {/* Status Flags — only show "Yes" values */}
                {(student.ipCommunity || student.is4PsBeneficiary || student.isBalikAral || student.disability) && (
                  <div>
                    <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-2 px-0.5">Status</p>
                    <div className="flex flex-wrap gap-2">
                      {student.disability && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-100">
                          <Shield className="w-3 h-3" />
                          {student.disability}
                        </span>
                      )}
                      {student.ipCommunity && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-100">
                          <Users className="w-3 h-3" />
                          IP Community
                        </span>
                      )}
                      {student.is4PsBeneficiary && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                          <CheckCircle2 className="w-3 h-3" />
                          4Ps Beneficiary
                        </span>
                      )}
                      {student.isBalikAral && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
                          <AlertTriangle className="w-3 h-3" />
                          Balik-Aral
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Card */}
        <Card className="border-0 shadow-xl shadow-gray-200/50 overflow-hidden rounded-2xl text-white p-0 relative" style={{ background: `linear-gradient(145deg, ${colors.primary} 0%, ${colors.primary}ee 100%)` }}>
          <div className="absolute top-0 right-0 w-40 h-40 opacity-10" style={{ background: 'radial-gradient(circle at 70% 30%, white 0%, transparent 60%)' }} />
          <div className="absolute bottom-0 left-0 w-32 h-32 opacity-10" style={{ background: 'radial-gradient(circle at 30% 70%, white 0%, transparent 60%)' }} />
          <CardContent className="p-6 h-full flex flex-col relative">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-white/20 backdrop-blur-sm">
                <Award className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg tracking-tight">Academic Summary</h3>
            </div>
            
            <div className="space-y-4 flex-1">
              <div className="p-4 rounded-2xl bg-white/10 backdrop-blur-sm">
                <p className="text-white/60 text-xs font-medium uppercase tracking-wider mb-1">General Average</p>
                <p className="text-4xl font-bold tracking-tight">
                  {summary.generalAverage !== null ? summary.generalAverage.toFixed(2) : "N/A"}
                </p>
                {summary.generalAverage !== null && (
                  <Badge className={`mt-2.5 ${getMasteryLevel(summary.generalAverage).bgColor} ${getMasteryLevel(summary.generalAverage).color} text-xs`}>
                    {getMasteryLevel(summary.generalAverage).label}
                  </Badge>
                )}
              </div>
              
              {summary.honors && (
                <div className="p-4 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20">
                  <div className="flex items-center gap-2.5">
                    <Medal className="w-5 h-5 text-amber-300" />
                    <p className="font-bold text-white text-sm">{summary.honors}</p>
                  </div>
                </div>
              )}
              
              <div className="p-4 rounded-2xl bg-white/10 backdrop-blur-sm">
                <p className="text-white/60 text-xs font-medium uppercase tracking-wider mb-1">Status</p>
                <Badge className={`${
                  summary.promotionStatus === "PROMOTED" ? "bg-emerald-400/30 text-emerald-100 border border-emerald-300/30" :
                  summary.promotionStatus === "CONDITIONALLY PROMOTED" ? "bg-amber-400/30 text-amber-100 border border-amber-300/30" :
                  summary.promotionStatus === "RETAINED" ? "bg-red-400/30 text-red-100 border border-red-300/30" :
                  "bg-gray-400/30 text-gray-100"
                }`}>
                  {summary.promotionStatus || "Pending"}
                </Badge>
              </div>
              
              <div className="p-4 rounded-2xl bg-white/10 backdrop-blur-sm">
                <p className="text-white/60 text-xs font-medium uppercase tracking-wider mb-2">Progress</p>
                <p className="text-lg font-bold">
                  {summary.completedSubjects} / {summary.totalSubjects} <span className="text-sm font-medium text-white/70">Subjects Graded</span>
                </p>
                <div className="mt-2 h-2 bg-white/20 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-white/80 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${summary.totalSubjects > 0 ? (summary.completedSubjects / summary.totalSubjects) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grades Table */}
      <Card className="border-0 shadow-2xl shadow-slate-200/40 bg-white overflow-hidden rounded-[2.5rem] p-0">
        <CardHeader className="border-b border-slate-50 px-8 py-6" style={{ background: `linear-gradient(135deg, ${colors.primary}06 0%, ${colors.primary}03 100%)` }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div 
                className="p-2.5 rounded-2xl text-white shadow-xl"
                style={{ backgroundColor: colors.primary }}
              >
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-xl font-black text-slate-900 tracking-tight">Subject Grades</CardTitle>
                <CardDescription className="text-slate-500 font-sans normal-case font-medium tracking-normal mt-1">
                  Term grades and final rating per subject
                </CardDescription>
              </div>
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 py-1.5 rounded-full" style={{ backgroundColor: `${colors.primary}10`, color: colors.primary }}>
              S.Y. {enrollment.schoolYear}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 hover:bg-transparent border-0">
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-[200px] px-8">Subject</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">T1</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">T2</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">T3</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center" style={{ backgroundColor: `${colors.primary}06` }}>Final Grade</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjectGrades.map((subject) => (
                  <TableRow key={subject.subjectId} className="hover:bg-slate-50/50 transition-all border-slate-50 group">
                    <TableCell className="px-8">
                      <div>
                        <p className="font-black text-slate-900 tracking-tight">{subject.subjectName}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{subject.teacher}</p>
                      </div>
                    </TableCell>
                    {(["T1", "T2", "T3"] as const).map((term) => {
                      const grade = subject.grades[term]?.quarterlyGrade;
                      const descriptor = subject.grades[term]?.qualitativeDescriptor;
                      const isHG = subject.subjectCode.startsWith("HG");
                      return (
                        <TableCell key={term} className="text-center">
                          {grade !== null && grade !== undefined ? (
                            <span className={`font-black text-sm ${grade >= 75 ? "text-slate-800" : "text-rose-600"}`}>
                              {grade}
                            </span>
                          ) : isHG && descriptor ? (
                            <span className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
                              {descriptor}
                            </span>
                          ) : (
                            <span className="text-slate-300 font-medium">-</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center" style={{ backgroundColor: `${colors.primary}04` }}>
                      {subject.finalGrade !== null ? (
                        <span className={`text-xl font-black ${subject.finalGrade >= 75 ? "" : "text-rose-600"}`} style={subject.finalGrade >= 75 ? { color: colors.primary } : undefined}>
                          {subject.finalGrade}
                        </span>
                      ) : (
                        <span className="text-slate-300 font-medium">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {subject.remarks ? (
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full ${
                          subject.remarks === "PASSED" 
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                            : subject.remarks === "QUALITATIVE"
                            ? "bg-sky-50 text-sky-700 border border-sky-100"
                            : "bg-rose-50 text-rose-700 border border-rose-100"
                        }`}>
                          {subject.remarks === "PASSED" ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : subject.remarks === "QUALITATIVE" ? (
                            <BookOpen className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {subject.remarks === "QUALITATIVE" ? "Descriptor-Based" : subject.remarks}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full bg-slate-100 text-slate-400">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                
                {/* General Average Row */}
                <TableRow className="border-t-2 hover:bg-transparent" style={{ backgroundColor: `${colors.primary}08`, borderColor: `${colors.primary}20` }}>
                  <TableCell colSpan={4} />
                  <TableCell className="text-right pr-4 py-4" style={{ backgroundColor: `${colors.primary}06` }}>
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>
                      General Average:
                    </span>
                  </TableCell>
                  <TableCell className="text-center py-4">
                    <span className="text-2xl font-black" style={{ color: colors.primary }}>
                      {summary.generalAverage !== null ? summary.generalAverage.toFixed(2) : "N/A"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center py-4">
                    {summary.promotionStatus && (
                      <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full ${
                        summary.promotionStatus === "PROMOTED" ? "text-white" :
                        summary.promotionStatus === "CONDITIONALLY PROMOTED" ? "bg-amber-500 text-white" :
                        "bg-rose-500 text-white"
                      }`}
                        style={summary.promotionStatus === "PROMOTED" ? { backgroundColor: colors.primary } : undefined}
                      >
                        {summary.promotionStatus}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* DepEd Grading Legend */}
      <Card className="border-0 shadow-lg shadow-slate-200/50 bg-white overflow-hidden rounded-[2.5rem] p-0">
        <CardHeader className="border-b border-slate-50 px-8 py-5" style={{ background: `linear-gradient(135deg, ${colors.primary}05 0%, transparent 100%)` }}>
          <CardTitle className="text-sm font-black text-slate-600 uppercase tracking-widest">DepEd Grading Scale</CardTitle>
        </CardHeader>
        <CardContent className="p-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { label: "Outstanding", range: "90-100", opacity: "18" },
              { label: "Very Satisfactory", range: "85-89", opacity: "28" },
              { label: "Satisfactory", range: "80-84", opacity: "38" },
              { label: "Fairly Satisfactory", range: "75-79", opacity: "48" },
              { label: "Did Not Meet Expectations", range: "Below 75", color: "bg-rose-50 text-rose-700 border-rose-200" },
            ].map((level) => (
              <div key={level.label} className={`p-4 rounded-2xl border ${level.color || ''}`}
                style={!level.color ? { backgroundColor: `${colors.primary}${level.opacity}`, color: colors.primary, borderColor: `${colors.primary}30` } : undefined}
              >
                <p className="font-black text-sm tracking-tight">{level.label}</p>
                <p className="text-[10px] font-bold opacity-80 mt-0.5">{level.range}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 pt-6 border-t border-slate-100">
            <h4 className="font-black text-slate-700 text-sm mb-4">Academic Honors (Based on General Average):</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "With Highest Honors", range: "98-100", icon: "🏆" },
                { label: "With High Honors", range: "95-97", icon: "🥇" },
                { label: "With Honors", range: "90-94", icon: "🥈" },
              ].map((honor) => (
                <div key={honor.label} className="flex items-center gap-3 p-4 rounded-2xl border" style={{ backgroundColor: `${colors.primary}06`, borderColor: `${colors.primary}20` }}>
                  <span className="text-2xl">{honor.icon}</span>
                  <div>
                    <p className="font-black text-sm tracking-tight" style={{ color: colors.primary }}>{honor.label}</p>
                    <p className="text-[10px] font-bold" style={{ color: `${colors.primary}aa` }}>{honor.range}</p>
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
