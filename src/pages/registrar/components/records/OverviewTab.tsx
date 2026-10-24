/**
 * OverviewTab.tsx — identity summary + document availability + School Forms
 * Readiness checker for the vault (shared by Former Students and Student Records).
 */
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileCheck,
  FileText,
  GraduationCap,
  History,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StudentDocumentsIndexEntry } from "@/lib/api";
import { formatVaultGradeLevel, formatVaultName, type VaultStudent, type VaultTab } from "./types";

interface OverviewTabProps {
  student: VaultStudent;
  entry: StudentDocumentsIndexEntry | null;
  loading: boolean;
  onSelectTab: (tab: VaultTab) => void;
  onOpenYear: (year: string) => void;
}

interface RowProps {
  label: string;
  value: string;
}

function Row({ label, value }: RowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-b-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
    </div>
  );
}

interface DocRowProps {
  icon: typeof FileText;
  title: string;
  detail: string;
  available: boolean;
  onOpen: () => void;
}

function DocRow({ icon: Icon, title, detail, available, onOpen }: DocRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <span
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
          available ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-foreground truncate">{title}</span>
        <span className="block text-xs text-muted-foreground truncate">{detail}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}

const FORM_STATUS = {
  ready: { text: "Ready", className: "text-emerald-600", icon: CheckCircle2 },
  inProgress: { text: "In Progress", className: "text-amber-600", icon: Clock },
  noData: { text: "No Data", className: "text-muted-foreground", icon: AlertCircle },
} as const;

type FormStatusKey = keyof typeof FORM_STATUS;

function FormCard({
  formCode,
  title,
  detail,
  status,
}: {
  formCode: string;
  title: string;
  detail: string;
  status: FormStatusKey;
}) {
  const config = FORM_STATUS[status];
  const StatusIcon = config.icon;
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-xl border",
        status === "ready" ? "border-emerald-100 bg-emerald-50/50" : "border-border bg-muted/30",
      )}
    >
      <div
        className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold",
          status === "ready" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {formCode}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground text-sm leading-tight">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{detail}</p>
        <div className="flex items-center gap-1.5 mt-1.5">
          <StatusIcon className={cn("w-3.5 h-3.5", config.className)} />
          <span className={cn("text-[11px] font-semibold", config.className)}>{config.text}</span>
        </div>
      </div>
    </div>
  );
}

export default function OverviewTab({ student, entry, loading, onSelectTab, onOpenYear }: OverviewTabProps) {
  const missing: string[] = [];
  if (!student.lrn || student.lrn.trim() === "") missing.push("LRN");
  if (!student.birthDate) missing.push("Birth Date");
  if (!student.homeAddress) missing.push("Home Address");
  if (!student.guardianName) missing.push("Guardian Name");

  const isEnrolled = student.enrollmentStatus === "ENROLLED";
  const reportCardYears = entry?.reportCardYears.length ?? 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">Learner</h3>
        <Row label="Name" value={formatVaultName(student)} />
        <Row label="LRN" value={student.lrn || "—"} />
        <Row label="Sex" value={student.gender || "—"} />
        <Row label="Last Grade" value={student.lastGradeLevel ? formatVaultGradeLevel(student.lastGradeLevel) : "—"} />
        <Row label="Last Section" value={student.lastSection || "—"} />
        <Row label="Last School Year" value={student.lastSchoolYear || "—"} />
        <Row label="Program" value={student.lastProgram || "—"} />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Documents</h3>
          <Badge variant="outline" className="text-[11px] font-medium">
            {student.enrollmentStatus}
          </Badge>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking available documents…
          </div>
        ) : (
          <div className="space-y-2">
            <DocRow
              icon={FileText}
              title="SF10 — Permanent Record"
              detail={entry?.sf10 ? "Available" : "Not available"}
              available={!!entry?.sf10}
              onOpen={() => onSelectTab("sf10")}
            />
            <DocRow
              icon={GraduationCap}
              title="Report Cards (SF9)"
              detail={
                reportCardYears
                  ? `${reportCardYears} school year${reportCardYears !== 1 ? "s" : ""}`
                  : "No report cards"
              }
              available={!!reportCardYears}
              onOpen={() => onSelectTab("sf9")}
            />
            <DocRow
              icon={History}
              title="Prior School Records"
              detail={entry?.priorRecords ? `${entry.priorRecords} saved record${entry.priorRecords !== 1 ? "s" : ""}` : "None saved"}
              available={!!entry?.priorRecords}
              onOpen={() => onSelectTab("prior")}
            />
            <DocRow
              icon={ClipboardCheck}
              title="Remedial"
              detail={entry?.remedial ? "Has remedial records" : "No remedial records"}
              available={!!entry?.remedial}
              onOpen={() => onSelectTab("remedial")}
            />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-muted-foreground" />
          School Forms Readiness
        </h3>

        {missing.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50/60 p-3 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              <span className="font-bold">Information needed:</span> {missing.join(", ")} — empty on
              record and should be synced from EnrollPro.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking form readiness…
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormCard
              formCode="SF1"
              title="School Register"
              detail={isEnrolled ? "Student is enrolled" : "No active enrollment"}
              status={isEnrolled ? "ready" : "noData"}
            />
            <FormCard
              formCode="SF2"
              title="Daily Attendance Report"
              detail={entry?.attendance ? "Attendance records available" : "Awaiting attendance data"}
              status={entry?.attendance ? "ready" : "inProgress"}
            />
            <FormCard
              formCode="SF9"
              title="Learner's Progress Report Card"
              detail={reportCardYears ? `${reportCardYears} school year${reportCardYears !== 1 ? "s" : ""} recorded` : "Awaiting grade submissions"}
              status={reportCardYears ? "ready" : "inProgress"}
            />
            <FormCard
              formCode="SF10"
              title="Learner's Permanent Academic Record"
              detail={entry?.sf10 ? "Permanent record on file" : "No records yet"}
              status={entry?.sf10 ? "ready" : "noData"}
            />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold text-foreground mb-3">Enrollment History</h3>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading years…
          </div>
        ) : reportCardYears > 0 ? (
          <div className="flex flex-wrap gap-2">
            {[...(entry?.reportCardYears ?? [])].reverse().map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => onOpenYear(year)}
                className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/60"
              >
                <GraduationCap className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-semibold text-foreground tabular-nums">{year}</span>
                <span className="text-[11px] font-medium text-muted-foreground">View SF9</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No enrollment years recorded in SMART.</p>
        )}
      </section>
    </div>
  );
}
