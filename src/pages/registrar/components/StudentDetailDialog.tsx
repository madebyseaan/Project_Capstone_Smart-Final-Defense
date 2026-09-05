import { memo } from "react";
import {
  Users,
  FileText,
  FolderOpen,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileCheck,
  ClipboardList,
  CalendarCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RegistrarModal,
  InfoCard,
  AlertBanner,
} from "@/components/registrar-modal";
import { useTheme } from "@/contexts/ThemeContext";
import { Dash } from "@/components/data-table/Dash";

interface Student {
  id: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender?: string;
  birthDate?: string;
  address?: string;
  guardianName?: string;
  gradeLevel?: string;
  sectionName?: string;
  status?: string;
}

interface Props {
  student: Student | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sf9Data: any;
  sf10Data: any;
  loadingDetail: boolean;
  schoolYear: string;
}

const formatDate = (dateString?: string) => {
  if (!dateString) return "-";
  try {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
};

const FORM_STATUS = {
  ready: {
    icon: CheckCircle2,
    color: "text-emerald-600",
    text: "Ready",
  },
  inProgress: {
    icon: Clock,
    color: "text-amber-600",
    text: "In Progress",
  },
  noData: {
    icon: AlertCircle,
    color: "text-muted-foreground",
    text: "No Data",
  },
} as const;

type FormStatusKey = keyof typeof FORM_STATUS;

const SchoolFormCard = memo(function SchoolFormCard({
  formCode,
  title,
  icon,
  status,
  detail,
  primaryColor,
}: {
  formCode: string;
  title: string;
  icon: React.ReactNode;
  status: FormStatusKey;
  detail?: string;
  primaryColor: string;
}) {
  const config = FORM_STATUS[status];
  const StatusIcon = config.icon;

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-xl transition-all ${
        status === "ready" ? "shadow-sm" : "bg-muted/30"
      }`}
      style={{
        backgroundColor: status === "ready" ? `${primaryColor}08` : undefined,
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white font-bold text-xs"
        style={{ backgroundColor: status === "ready" ? primaryColor : "#94a3b8" }}
      >
        {formCode}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground text-sm leading-tight">{title}</p>
        {detail && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{detail}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1.5">
          <StatusIcon className={`w-3.5 h-3.5 ${config.color}`} />
          <span className={`text-[11px] font-semibold ${config.color}`}>{config.text}</span>
        </div>
      </div>
      {icon}
    </div>
  );
});

function StudentDetailDialogBase({
  student,
  open,
  onOpenChange,
  sf9Data,
  sf10Data,
  loadingDetail,
  schoolYear,
}: Props) {
  const { colors } = useTheme();
  if (!student) return null;

  const missing: string[] = [];
  if (!student.birthDate) missing.push("Birth Date");
  if (!student.lrn || student.lrn.trim() === "") missing.push("LRN");
  if (!student.address) missing.push("Home Address");
  if (!student.guardianName) missing.push("Guardian Name");

  return (
    <RegistrarModal
      open={open}
      onOpenChange={onOpenChange}
      icon={<Users className="w-6 h-6" />}
      title="Student Record"
      size="xl"
      hideFooter
    >
      <div className="space-y-6 sm:space-y-8">
        {/* Student Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
          <InfoCard tone="primary" label="LRN">
            <p className="font-mono font-bold text-foreground text-sm break-all">
              {student.lrn}
            </p>
          </InfoCard>
          <InfoCard tone="primary" label="Name">
            <p
              className="font-bold text-foreground text-sm leading-tight truncate"
              title={`${student.lastName}, ${student.firstName}`}
            >
              {student.lastName}, {student.firstName}
            </p>
          </InfoCard>
          <InfoCard tone="secondary" label="Gender">
            <p className="font-bold text-foreground text-sm">
              {student.gender || <Dash />}
            </p>
          </InfoCard>
          <InfoCard tone="accent" label="Birth Date">
            <p className="font-bold text-foreground text-xs">
              {formatDate(student.birthDate)}
            </p>
          </InfoCard>
          <div className="p-4 rounded-xl bg-muted/40 min-w-0 shadow-sm">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
              Guardian
            </p>
            <p
              className={`font-bold text-sm ${!student.guardianName ? "text-destructive italic font-normal" : "text-foreground"}`}
            >
              {student.guardianName || "Not Set"}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-muted/40 min-w-0 shadow-sm">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
              Address
            </p>
            <p
              className={`font-bold text-xs leading-tight line-clamp-2 ${!student.address ? "text-destructive italic font-normal" : "text-foreground"}`}
              title={student.address}
            >
              {student.address || "No address on record"}
            </p>
          </div>
        </div>

        {/* Data Completeness Alert */}
        {missing.length > 0 && (
          <AlertBanner variant="danger" title="Information Needed">
            The following fields are empty and should be synced from EnrollPro:{" "}
            <span className="font-bold ml-1">{missing.join(", ")}</span>
          </AlertBanner>
        )}

        {/* School Forms Readiness */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2 ml-1">
            <FileCheck className="w-3.5 h-3.5" style={{ color: colors.primary }} />
            School Forms Readiness
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SchoolFormCard
              formCode="SF1"
              title="School Register"
              icon={<ClipboardList className="w-5 h-5 text-muted-foreground/40" />}
              status={student.status === "ENROLLED" ? "ready" : "noData"}
              detail={student.status === "ENROLLED" ? "Student is enrolled" : "No active enrollment"}
              primaryColor={colors.primary}
            />
            <SchoolFormCard
              formCode="SF2"
              title="Daily Attendance Report"
              icon={<CalendarCheck className="w-5 h-5 text-muted-foreground/40" />}
              status={sf9Data && Object.keys(sf9Data.attendance || {}).length > 0 ? "ready" : "inProgress"}
              detail={sf9Data && Object.keys(sf9Data.attendance || {}).length > 0 ? "Attendance records available" : "Awaiting attendance data"}
              primaryColor={colors.primary}
            />
            <SchoolFormCard
              formCode="SF9"
              title="Learner's Progress Report Card"
              icon={<FileText className="w-5 h-5 text-muted-foreground/40" />}
              status={sf9Data && sf9Data.subjectGrades?.length > 0 ? "ready" : "inProgress"}
              detail={sf9Data && sf9Data.subjectGrades?.length > 0 ? `${sf9Data.subjectGrades.length} subjects recorded` : "Awaiting grade submissions"}
              primaryColor={colors.primary}
            />
            <SchoolFormCard
              formCode="SF10"
              title="Learner's Permanent Academic Record"
              icon={<FolderOpen className="w-5 h-5 text-muted-foreground/40" />}
              status={sf10Data && sf10Data.schoolRecords?.length > 0 ? "ready" : "noData"}
              detail={sf10Data && sf10Data.schoolRecords?.length > 0 ? `${sf10Data.schoolRecords.length} school year(s) on file` : "No historical records yet"}
              primaryColor={colors.primary}
            />
          </div>
        </div>

        {loadingDetail ? (
          <div className="flex items-center justify-center py-12 sm:py-16">
            <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Current Year Grades (SF9 Preview) */}
            {sf9Data && (
              <div className="bg-background rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-6 gap-3">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
                    <h3 className="font-bold text-foreground text-lg sm:text-xl">
                      Current Year Grades (SF9)
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-sm sm:text-base py-1 px-3 sm:py-2 sm:px-4 w-fit"
                  >
                    S.Y. {schoolYear}
                  </Badge>
                </div>
                <div className="overflow-x-auto -mx-2 sm:-mx-4 px-2 sm:px-4">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="font-bold text-foreground py-3 sm:py-4 text-sm sm:text-base">
                          Subject
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground py-3 sm:py-4 text-sm sm:text-base w-14 sm:w-20">
                          T1
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground py-3 sm:py-4 text-sm sm:text-base w-14 sm:w-20">
                          T2
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground py-3 sm:py-4 text-sm sm:text-base w-14 sm:w-20">
                          T3
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground py-3 sm:py-4 text-sm sm:text-base w-14 sm:w-20">
                          Final
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sf9Data.subjectGrades.map((sg: any) => (
                        <TableRow key={sg.subjectCode} className="border-b border-border/30">
                          <TableCell className="font-semibold text-foreground py-3 sm:py-4 text-sm sm:text-base">
                            {sg.subjectName}
                          </TableCell>
                          <TableCell className="text-center text-foreground py-3 sm:py-4 text-sm sm:text-base">
                            {sg.T1 ?? <Dash />}
                          </TableCell>
                          <TableCell className="text-center text-foreground py-3 sm:py-4 text-sm sm:text-base">
                            {sg.T2 ?? <Dash />}
                          </TableCell>
                          <TableCell className="text-center text-foreground py-3 sm:py-4 text-sm sm:text-base">
                            {sg.T3 ?? <Dash />}
                          </TableCell>
                          <TableCell className="text-center font-bold text-foreground py-3 sm:py-4 text-sm sm:text-base">
                            {sg.final ?? <Dash />}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-primary/5 font-bold border-t-4 border-primary/30">
                        <TableCell
                          colSpan={4}
                          className="text-right text-foreground py-4 sm:py-5 text-base sm:text-lg"
                        >
                          General Average:
                        </TableCell>
                        <TableCell className="text-center text-2xl sm:text-3xl text-primary py-4 sm:py-5 font-extrabold">
                          {sf9Data.generalAverage?.toFixed(2) ?? <Dash />}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Academic History (SF10 Preview) */}
            {sf10Data && sf10Data.schoolRecords.length > 0 && (
              <div className="bg-background rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8 shadow-sm">
                <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
                  <FolderOpen
                    className="w-5 h-5 sm:w-6 sm:h-6"
                    style={{ color: colors.primary }}
                  />
                  <h3 className="font-bold text-foreground text-lg sm:text-xl">
                    Academic History (SF10)
                  </h3>
                </div>
                <div className="space-y-4 sm:space-y-5">
                  {sf10Data.schoolRecords.map((record: any) => (
                    <div
                      key={record.schoolYear}
                      className="rounded-xl p-4 sm:p-6 shadow-sm"
                      style={{
                        backgroundColor: `${colors.primary}08`,
                      }}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2 sm:gap-3">
                        <h4 className="font-bold text-foreground text-base sm:text-lg">
                          S.Y. {record.schoolYear} - Grade{" "}
                          {record.gradeLevel.replace("GRADE_", "")}
                        </h4>
                        <Badge
                          variant="outline"
                          className="bg-card text-sm sm:text-base py-1 px-3 sm:py-2 sm:px-4 w-fit"
                        >
                          {record.section}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:gap-5">
                        <span className="font-semibold text-foreground text-sm sm:text-base">
                          GWA:{" "}
                          <strong className="text-xl sm:text-2xl text-primary ml-1">
                            {record.generalAverage?.toFixed(2) ?? <Dash />}
                          </strong>
                        </span>
                        {record.honors && (
                          <Badge className="bg-amber-100 text-amber-800 border-2 border-amber-300 py-1 px-3 sm:py-2 sm:px-4 text-xs sm:text-sm font-semibold">
                            {record.honors}
                          </Badge>
                        )}
                        <Badge
                          className={
                            record.promotionStatus === "Promoted"
                              ? "bg-emerald-100 text-emerald-800 border-2 border-emerald-300 py-1 px-3 sm:py-2 sm:px-4 text-xs sm:text-sm font-semibold"
                              : "bg-red-100 text-red-800 border-2 border-red-300 py-1 px-3 sm:py-2 sm:px-4 text-xs sm:text-sm font-semibold"
                          }
                        >
                          {record.promotionStatus || <Dash />}
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
    </RegistrarModal>
  );
}

export const StudentDetailDialog = memo(StudentDetailDialogBase);
