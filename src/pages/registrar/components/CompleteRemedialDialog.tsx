import { memo } from "react";
import { FlaskConical, Clock, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/contexts/ThemeContext";
import {
  RegistrarModal,
  InfoCard,
  StatTile,
  AlertBanner,
  StepCards,
  ModalSection,
} from "@/components/registrar-modal";
import type { RemedialStudent } from "./RemedialStudentRow";

export interface PendingSubject {
  id: string;
  subjectName: string;
  originalGrade: number;
  effectiveMark: number | null;
}

interface Props {
  student: RemedialStudent | null;
  conductedFrom: string;
  conductedTo: string;
  pendingSubjects: PendingSubject[];
  saving: boolean;
  validation: { ok: boolean; reason?: string };
  onOpenChange: (open: boolean) => void;
  onConfirm: (student: RemedialStudent) => void;
}

const STEPS = [
  { title: "Save all RCM marks and conducted dates", hint: "Marks and date range written to every row" },
  { title: "Compute Recomputed Final Grades (RFG)", hint: "Average of final rating and RCM" },
  { title: "Transition promotion status", hint: "Conditional to final status" },
];

function CompleteRemedialDialogBase({
  student,
  conductedFrom,
  conductedTo,
  pendingSubjects,
  saving,
  validation,
  onOpenChange,
  onConfirm,
}: Props) {
  const { colors } = useTheme();
  if (!student) return null;

  const isValid = validation.ok;
  const initial = (student.lastName ?? "?").charAt(0);
  const fullName = `${student.lastName}, ${student.firstName}${student.middleName ? ` ${student.middleName}` : ""}`;
  const gradeSection = `${student.gradeLevel?.replace("GRADE_", "Grade ")} · ${student.section?.name}`;

  return (
    <RegistrarModal
      open
      onOpenChange={onOpenChange}
      icon={<FlaskConical className="w-6 h-6" />}
      title="Complete Remedial"
      description="Save all marks and complete remedial for this learner."
      size="lg"
      confirmLabel="Save & Complete"
      confirmDisabled={!isValid}
      loading={saving}
      onConfirm={() => onConfirm(student)}
    >
      <div className="space-y-4 sm:space-y-5">
        {/* Student identity grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InfoCard tone="primary" label="Learner">
            <p className="font-bold text-foreground text-sm leading-tight flex items-center gap-2 min-w-0">
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0"
                style={{ backgroundColor: colors.primary }}
              >
                {initial}
              </span>
              <span className="truncate" title={fullName}>{fullName}</span>
            </p>
          </InfoCard>
          <InfoCard tone="secondary" label="Grade &amp; Section">
            <p className="font-bold text-foreground text-sm leading-tight truncate">{gradeSection}</p>
            <p className="text-xs text-muted-foreground mt-1">SY {student.schoolYear}</p>
          </InfoCard>
          <InfoCard tone="accent" label="LRN">
            <p className="font-mono font-bold text-foreground text-sm break-all">{student.lrn || "—"}</p>
          </InfoCard>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile
            tone="accent"
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Pending"
            value={pendingSubjects.length}
            hint={`subject${pendingSubjects.length !== 1 ? "s" : ""}`}
          />
          <StatTile
            tone="secondary"
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="From"
            value={conductedFrom || <span className="text-muted-foreground/50 font-normal">—</span>}
          />
          <StatTile
            tone="secondary"
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="To"
            value={conductedTo || <span className="text-muted-foreground/50 font-normal">—</span>}
          />
        </div>

        {/* Validation error */}
        {!isValid && (
          <AlertBanner variant="danger" title={validation.reason} />
        )}

        {/* Pending subjects — fluid, no min-width */}
        {pendingSubjects.length > 0 && (
          <ModalSection
            title={`Pending Subjects (${pendingSubjects.length})`}
            badge={
              <Badge className="bg-amber-100 text-amber-800 border-2 border-amber-300 py-1 px-3 text-xs font-semibold w-fit shrink-0">
                To be finalized
              </Badge>
            }
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 sm:px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Learning Area
                  </th>
                  <th className="text-center px-2 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-20 sm:w-24">
                    Final
                  </th>
                  <th className="text-center px-2 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-16 sm:w-20">
                    RCM
                  </th>
                </tr>
              </thead>
              <tbody>
                {pendingSubjects.map((rc) => (
                  <tr key={rc.id} className="border-b border-border last:border-0">
                    <td className="px-3 sm:px-4 py-2.5 font-semibold text-foreground break-words">
                      {rc.subjectName}
                    </td>
                    <td className="px-2 sm:px-3 py-2.5 text-center font-semibold text-muted-foreground tabular-nums whitespace-nowrap">
                      {rc.originalGrade}
                    </td>
                    <td className="px-2 sm:px-3 py-2.5 text-center font-bold text-foreground tabular-nums whitespace-nowrap">
                      {rc.effectiveMark ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ModalSection>
        )}

        {/* Steps */}
        <StepCards steps={STEPS} />

        {/* Warning */}
        <AlertBanner variant="danger" title="This action cannot be undone">
          Once completed, remedial marks are locked and the learner&apos;s promotion status is finalized.
        </AlertBanner>
      </div>
    </RegistrarModal>
  );
}

export const CompleteRemedialDialog = memo(CompleteRemedialDialogBase);
