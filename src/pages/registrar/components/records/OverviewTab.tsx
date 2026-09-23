/**
 * OverviewTab.tsx — identity summary + document availability for the vault.
 */
import { FileText, GraduationCap, History, ClipboardCheck, ChevronRight, Loader2 } from "lucide-react";
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

export default function OverviewTab({ student, entry, loading, onSelectTab, onOpenYear }: OverviewTabProps) {
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
                entry?.reportCardYears.length
                  ? `${entry.reportCardYears.length} school year${entry.reportCardYears.length !== 1 ? "s" : ""}`
                  : "No report cards"
              }
              available={!!entry?.reportCardYears.length}
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
        <h3 className="text-sm font-semibold text-foreground mb-3">Enrollment History</h3>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading years…
          </div>
        ) : entry && entry.reportCardYears.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {[...entry.reportCardYears].reverse().map((year) => (
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
