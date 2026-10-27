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
  Trophy,
  Star,
  Home,
  Users,
  Heart,
  Shield,
  AlertTriangle,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
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
import { PageHeader } from "@/components/layout/PageHeader";
import PrintPreviewDialog from "@/components/forms/sf9/PrintPreviewDialog";
import TermPills from "@/components/forms/sf9/TermPills";
import {
  advisoryApi,
  SERVER_URL,
  type Sf9Payload,
  type Sf9Term,
  type StudentGradeProfile,
} from "@/lib/api";
import { cn, getErrorMessage } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

// DepEd mastery level helper
function getMasteryLevel(grade: number | null): { label: string; color: string; bgColor: string } {
  if (grade === null) return { label: "Not Graded", color: "text-muted-foreground", bgColor: "bg-gray-100" };
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
    <div className="flex items-start gap-3 group p-2.5 -mx-2.5 rounded-xl transition-colors duration-200 hover:bg-muted/50">
      <div className="p-2 rounded-xl transition-colors duration-200 group-hover:scale-110" style={{ backgroundColor: `${color}08` }}>
        <div style={{ color: `${color}aa` }}>{icon}</div>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
        <p className="font-semibold text-foreground text-sm leading-snug">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function StudentGradeProfilePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const location = useLocation();
  const { colors, logoUrl } = useTheme();
  const [data, setData] = useState<StudentGradeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printTerm, setPrintTerm] = useState<Sf9Term>("T1");
  const [printPayload, setPrintPayload] = useState<Sf9Payload | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printLoading, setPrintLoading] = useState<"sf9" | "term" | null>(null);

  const fullLogoUrl = logoUrl
    ? logoUrl.startsWith("http")
      ? logoUrl
      : `${SERVER_URL}${logoUrl}`
    : null;

  const openPrint = async (mode: "sf9" | "term") => {
    if (!studentId) return;
    setPrintLoading(mode);
    try {
      const res = await advisoryApi.getStudentSf9(
        studentId,
        mode === "term" ? { term: printTerm } : undefined,
      );
      setPrintPayload(res.data);
      setPrintOpen(true);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to load the printable"));
    } finally {
      setPrintLoading(null);
    }
  };

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
          <p className="text-muted-foreground font-medium">Loading student profile...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-destructive/10 flex items-center justify-center shadow-sm">
            <AlertTriangle className="w-9 h-9 text-destructive" />
          </div>
          <h3 className="font-semibold text-foreground text-lg mb-2">Something went wrong</h3>
          <p className="text-muted-foreground mb-6">{error || "Failed to load student data"}</p>
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
      <div className="hidden lg:block">
        <PageHeader
          title="Student Grade Profile"
          description="Complete academic record"
          actions={
            <Link to="/teacher/advisory" aria-label="Back to advisory">
              <Button variant="outline" className="h-12 gap-2 rounded-xl px-3 text-sm font-semibold transition-all duration-200">
                <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                Back
              </Button>
            </Link>
          }
        />
      </div>

      {/* Sticky mobile identity */}
      <div className="sticky top-14 z-20 -mx-4 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link
          to="/teacher/advisory"
          aria-label="Back to advisory"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: colors.primary }}
        >
          {student.lastName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{fullName}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">LRN {student.lrn}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Average</p>
          <p className="text-lg font-bold text-foreground">
            {summary.generalAverage !== null ? summary.generalAverage.toFixed(2) : "—"}
          </p>
        </div>
      </div>

      {/* Printables toolbar */}
      <Card className="overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4 xl:flex-row xl:items-center xl:justify-between xl:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Printer className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Printables</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Print the official SF9 or a temporary card for one term.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Term
              </span>
              <TermPills
                value={printTerm}
                onChange={setPrintTerm}
                testIdPrefix="profile-term-pill"
                ariaLabel="Term for temporary card"
                size="sm"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                data-testid="print-student-sf9"
                onClick={() => openPrint("sf9")}
                disabled={printLoading !== null}
                className="h-11 gap-2 rounded-xl text-xs font-semibold"
              >
                <Printer className="h-4 w-4" />
                {printLoading === "sf9" ? "Loading..." : "Print SF9"}
              </Button>
              <Button
                data-testid="print-student-term"
                variant="outline"
                onClick={() => openPrint("term")}
                disabled={printLoading !== null}
                className="h-11 gap-2 rounded-xl text-xs font-semibold"
              >
                <Printer className="h-4 w-4 text-muted-foreground" />
                {printLoading === "term" ? "Loading..." : "Term Card"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Student Info Card */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
        {/* Main Info */}
        <Card className="overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-sm lg:col-span-2">
          <CardHeader className="px-6 py-4 relative overflow-hidden" style={{ backgroundColor: `${colors.primary}10` }}>
            <div className="flex items-center gap-4">
              <div 
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-lg ring-2 ring-white/50"
                style={{ backgroundColor: colors.primary }}
              >
                {student.lastName.charAt(0)}
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-foreground tracking-tight">{fullName}</CardTitle>
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
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Grade & Section</span>
                  <p className="text-sm font-semibold text-foreground leading-tight">{gradeLevelLabels[enrollment.gradeLevel] || enrollment.gradeLevel} — {enrollment.sectionName}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" style={{ color: `${colors.primary}99` }} />
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">School Year</span>
                  <p className="text-sm font-semibold text-foreground leading-tight">{enrollment.schoolYear}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" style={{ color: `${colors.primary}99` }} />
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Birth Date</span>
                  <p className="text-sm font-semibold text-foreground leading-tight">{formatDate(student.birthDate)}</p>
                </div>
              </div>
            </div>

            {/* Contact strip */}
            {(student.guardianName || student.guardianContact) && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-sm">
                {student.guardianName && (
                  <span className="text-muted-foreground">
                    <span className="text-muted-foreground text-xs">Guardian:</span>{" "}
                    <span className="font-medium text-foreground">{student.guardianName}</span>
                    {student.guardianContact && <span className="text-muted-foreground ml-1.5">• {student.guardianContact}</span>}
                  </span>
                )}
              </div>
            )}

            {/* Extended Profile Section */}
            <div className="pt-4 mt-2 border-t border-border">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1 rounded-md" style={{ backgroundColor: `${colors.primary}10` }}>
                  <Users className="w-3 h-3" style={{ color: colors.primary }} />
                </div>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Additional Information</span>
              </div>
              <div className="space-y-4">
                {/* Background & Location */}
                {(student.religion || student.motherTongue || student.barangay || student.city || student.province) && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-0.5">Background & Location</p>
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
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-0.5">Family</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {student.fatherName && <ExtendedInfoRow icon={<User className="w-3.5 h-3.5" />} label="Father" value={student.fatherName} sub={student.fatherContact} color={colors.primary} />}
                      {student.motherName && <ExtendedInfoRow icon={<User className="w-3.5 h-3.5" />} label="Mother" value={student.motherName} sub={student.motherContact} color={colors.primary} />}
                    </div>
                  </div>
                )}

                {/* Status Flags — only show "Yes" values */}
                {(student.ipCommunity || student.is4PsBeneficiary || student.isBalikAral || student.disability) && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-0.5">Status</p>
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
        <Card className="border-0 shadow-xl shadow-gray-200/50 overflow-hidden rounded-2xl text-white p-0 relative" style={{ backgroundColor: colors.primary }}>
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
                  "bg-gray-400/30 text-muted-foreground"
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
      <Card className="overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-sm">
        <CardHeader className="border-b border-border p-4 lg:px-8 lg:py-6" style={{ backgroundColor: `${colors.primary}06` }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 lg:gap-4">
              <div 
                className="rounded-xl p-2 text-white shadow-md lg:rounded-2xl lg:p-2.5"
                style={{ backgroundColor: colors.primary }}
              >
                <BookOpen className="h-4 w-4 lg:h-5 lg:w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight text-foreground lg:text-xl">Subject grades</CardTitle>
                <CardDescription className="mt-1 font-sans text-xs font-medium normal-case tracking-normal text-muted-foreground">
                  Term grades and final rating per subject
                </CardDescription>
              </div>
            </div>
            <span className="rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" style={{ backgroundColor: `${colors.primary}10`, color: colors.primary }}>
              S.Y. {enrollment.schoolYear}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Mobile subject cards */}
          <div className="divide-y divide-border lg:hidden">
            {subjectGrades.map((subject) => (
              <div key={subject.subjectId} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{subject.subjectName}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{subject.teacher}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Final</p>
                    {subject.finalGrade !== null ? (
                      <p className={cn("text-xl font-bold", subject.finalGrade >= 75 ? "text-foreground" : "text-rose-600")}>
                        {subject.finalGrade}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["T1", "T2", "T3"] as const).map((term) => {
                    const grade = subject.grades[term]?.quarterlyGrade;
                    return (
                      <div key={term} className="rounded-xl border border-border bg-background px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{term}</p>
                        <p className={cn("mt-0.5 text-base font-bold", grade != null && grade < 75 ? "text-rose-600" : "text-foreground")}>
                          {grade != null ? grade : "—"}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <div>
                  {subject.remarks ? (
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
                      subject.remarks === "PASSED"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : subject.remarks === "QUALITATIVE"
                          ? "border-sky-200 bg-sky-50 text-sky-700"
                          : "border-rose-200 bg-rose-50 text-rose-700",
                    )}>
                      {subject.remarks === "PASSED" ? <CheckCircle2 className="h-3 w-3" /> : subject.remarks === "QUALITATIVE" ? <BookOpen className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {subject.remarks === "QUALITATIVE" ? "Descriptor-based" : subject.remarks}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Pending
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between bg-muted/60 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">General average</span>
              <span className="text-xl font-bold" style={{ color: colors.primary }}>
                {summary.generalAverage !== null ? summary.generalAverage.toFixed(2) : "N/A"}
              </span>
            </div>
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-transparent border-0">
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest min-w-[200px] px-8">Subject</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">T1</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">T2</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">T3</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center" style={{ backgroundColor: `${colors.primary}06` }}>Final Grade</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjectGrades.map((subject) => (
                  <TableRow key={subject.subjectId} className="hover:bg-muted/40 transition-all border-border group">
                    <TableCell className="px-8">
                      <div>
                        <p className="font-bold text-foreground tracking-tight">{subject.subjectName}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">{subject.teacher}</p>
                      </div>
                    </TableCell>
                    {(["T1", "T2", "T3"] as const).map((term) => {
                      const grade = subject.grades[term]?.quarterlyGrade;
                      return (
                        <TableCell key={term} className="text-center">
                          {grade !== null && grade !== undefined ? (
                            <span className={`font-bold text-sm ${grade >= 75 ? "text-foreground" : "text-rose-600"}`}>
                              {grade}
                            </span>
                          ) : (
                            <span className="text-muted-foreground font-medium">-</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center" style={{ backgroundColor: `${colors.primary}04` }}>
                      {subject.finalGrade !== null ? (
                        <span className={`text-xl font-bold ${subject.finalGrade >= 75 ? "" : "text-rose-600"}`} style={subject.finalGrade >= 75 ? { color: colors.primary } : undefined}>
                          {subject.finalGrade}
                        </span>
                      ) : (
                        <span className="text-muted-foreground font-medium">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {subject.remarks ? (
                        <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-3 py-1.5 rounded-full ${
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
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-3 py-1.5 rounded-full bg-muted text-muted-foreground">
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
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: colors.primary }}>
                      General Average:
                    </span>
                  </TableCell>
                  <TableCell className="text-center py-4">
                    <span className="text-2xl font-bold" style={{ color: colors.primary }}>
                      {summary.generalAverage !== null ? summary.generalAverage.toFixed(2) : "N/A"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center py-4">
                    {summary.promotionStatus && (
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-3 py-1.5 rounded-full ${
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
      <Card className="overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-sm">
        <CardHeader className="border-b border-border px-4 py-4 lg:px-8 lg:py-5" style={{ backgroundColor: `${colors.primary}05` }}>
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:text-sm">DepEd grading scale</CardTitle>
        </CardHeader>
        <CardContent className="p-4 lg:p-8">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
            {[
              { label: "Outstanding", range: "90-100", opacity: "18" },
              { label: "Very Satisfactory", range: "85-89", opacity: "28" },
              { label: "Satisfactory", range: "80-84", opacity: "38" },
              { label: "Fairly Satisfactory", range: "75-79", opacity: "48" },
              { label: "Did Not Meet Expectations", range: "Below 75", color: "border-destructive/20 bg-destructive/10 text-destructive" },
            ].map((level) => (
              <div key={level.label} className={`p-4 rounded-2xl border ${level.color || ''}`}
                style={!level.color ? { backgroundColor: `${colors.primary}${level.opacity}`, color: colors.primary, borderColor: `${colors.primary}30` } : undefined}
              >
                <p className="font-bold text-sm tracking-tight">{level.label}</p>
                <p className="text-[10px] font-bold opacity-80 mt-0.5">{level.range}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 border-t border-border pt-5 lg:mt-8 lg:pt-6">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Academic honors (based on general average)</h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:gap-4">
              {[
                { label: "With Highest Honors", range: "98-100", Icon: Trophy },
                { label: "With High Honors", range: "95-97", Icon: Medal },
                { label: "With Honors", range: "90-94", Icon: Star },
              ].map((honor) => (
                <div key={honor.label} className="flex items-center gap-3 rounded-xl border p-3 lg:rounded-2xl lg:p-4" style={{ backgroundColor: `${colors.primary}06`, borderColor: `${colors.primary}20` }}>
                  <honor.Icon className="h-5 w-5 shrink-0" style={{ color: colors.primary }} aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold tracking-tight" style={{ color: colors.primary }}>{honor.label}</p>
                    <p className="text-[10px] font-semibold" style={{ color: `${colors.primary}aa` }}>{honor.range}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <PrintPreviewDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        payload={printPayload}
        fullLogoUrl={fullLogoUrl}
      />
    </div>
  );
}
