import type { ReactNode } from "react";
import { memo } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";

/**
 * Registrar Modal Design System
 * Reference implementation: src/pages/registrar/components/CompleteRemedialDialog.tsx
 * Design language: StudentRecords-style — border-2 tinted cards, rounded-xl/2xl,
 * generous responsive padding, no horizontal scroll, theme-color tints.
 *
 * Migration guide: PLAN_REGISTRAR_MODAL_ALIGNMENT.md
 */

export type ModalTone = "primary" | "secondary" | "accent";
export type ModalSize = "sm" | "md" | "lg" | "xl";
export type AlertVariant = "danger" | "warning" | "info";

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "sm:!max-w-md",
  md: "sm:!max-w-2xl",
  lg: "sm:!max-w-2xl md:!max-w-3xl",
  xl: "sm:!max-w-3xl md:!max-w-4xl lg:!max-w-5xl",
};

const ALERT_CONFIG: Record<AlertVariant, { bg: string; border: string; text: string; iconBg: string; icon: typeof AlertTriangle }> = {
  danger: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", iconBg: "text-red-600", icon: AlertTriangle },
  warning: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", iconBg: "text-amber-600", icon: AlertTriangle },
  info: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", iconBg: "text-blue-600", icon: Info },
};

export interface RegistrarModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: ReactNode;
  title: string;
  description?: string;
  size?: ModalSize;
  /** Footer confirm button */
  confirmLabel?: string;
  onConfirm?: () => void;
  /** Disables confirm (validation failures) */
  confirmDisabled?: boolean;
  /** Red confirm button for destructive actions */
  destructive?: boolean;
  loading?: boolean;
  /** Hide footer entirely (view-only dialogs) */
  hideFooter?: boolean;
  children?: ReactNode;
}

export function RegistrarModal({
  open,
  onOpenChange,
  icon,
  title,
  description,
  size = "md",
  confirmLabel = "Confirm",
  onConfirm,
  confirmDisabled = false,
  destructive = false,
  loading = false,
  hideFooter = false,
  children,
}: RegistrarModalProps) {
  const { colors } = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`${SIZE_CLASSES[size]} max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8 border-0 shadow-2xl bg-card rounded-xl sm:rounded-2xl gap-0`}
      >
        {/* Header */}
        <div className="pb-4 sm:pb-5">
          <div className="flex items-start gap-3 sm:gap-4">
            <div
              className="p-3 rounded-xl text-white shadow-lg shrink-0"
              style={{ backgroundColor: destructive ? "#dc2626" : colors.primary }}
            >
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-xl sm:text-2xl font-bold text-foreground leading-tight">
                {title}
              </DialogTitle>
              {description && (
                <DialogDescription className="mt-1 text-sm text-muted-foreground">
                  {description}
                </DialogDescription>
              )}
            </div>
          </div>
        </div>

        {children}

        {/* Footer */}
        {!hideFooter && (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 mt-4 border-t border-border">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl"
              style={
                destructive
                  ? { backgroundColor: "#dc2626", color: "white" }
                  : { backgroundColor: colors.primary, color: "white" }
              }
              disabled={loading || confirmDisabled}
              onClick={() => onConfirm?.()}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              {confirmLabel}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Tinted info card — grid of these at the top of modal bodies. */
export const InfoCard = memo(function InfoCard({
  tone = "primary",
  label,
  children,
}: {
  tone?: ModalTone;
  label: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const color = colors[tone];
  return (
    <div
      className="p-4 rounded-xl min-w-0 shadow-sm"
      style={{ backgroundColor: `${color}0A` }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color }}>
        {label}
      </p>
      {children}
    </div>
  );
});

/** Compact stat tile. */
export const StatTile = memo(function StatTile({
  tone = "secondary",
  icon,
  label,
  value,
  hint,
}: {
  tone?: ModalTone;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  const { colors } = useTheme();
  const color = colors[tone];
  return (
    <div
      className="rounded-xl border-2 px-3 sm:px-4 py-2.5 sm:py-3 overflow-hidden"
      style={{ backgroundColor: `${color}08`, borderColor: `${color}30` }}
    >
      <div className="flex items-center gap-1.5 mb-1" style={{ color }}>
        {icon}
        <span className="text-[10px] sm:text-[11px] font-semibold uppercase">{label}</span>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-foreground tabular-nums leading-none">{value}</p>
      {hint && <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
});

/** Colored callout banner. */
export const AlertBanner = memo(function AlertBanner({
  variant = "warning",
  title,
  children,
}: {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
}) {
  const config = ALERT_CONFIG[variant];
  const Icon = config.icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border-2 ${config.bg} ${config.border} ${config.text} px-4 py-3`}>
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${config.iconBg}`} />
      <div className="min-w-0">
        {title && <h4 className={`text-sm font-bold ${config.text}`}>{title}</h4>}
        <div className="text-xs leading-relaxed">{children}</div>
      </div>
    </div>
  );
});

/** Numbered action-step cards row. Pass one step color per tone. */
export const StepCards = memo(function StepCards({
  steps,
  tones = ["primary", "secondary", "accent"],
}: {
  steps: { title: string; hint?: string }[];
  tones?: ModalTone[];
}) {
  const { colors } = useTheme();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {steps.map((step, i) => {
        const color = colors[tones[i % tones.length]];
        return (
          <div
            key={step.title}
            className="p-3 rounded-xl border-2"
            style={{ backgroundColor: `${color}08`, borderColor: `${color}30` }}
          >
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white mb-2"
              style={{ backgroundColor: color }}
            >
              {i + 1}
            </span>
            <p className="text-sm font-semibold text-foreground leading-snug">{step.title}</p>
            {step.hint && <p className="text-xs text-muted-foreground mt-1">{step.hint}</p>}
          </div>
        );
      })}
    </div>
  );
});

/** Section wrapper for bordered content blocks (tables, lists) inside modal bodies. */
export const ModalSection = memo(function ModalSection({
  title,
  badge,
  children,
}: {
  title?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-background border-2 border-border rounded-xl overflow-hidden">
      {(title || badge) && (
        <div className="px-4 py-3 border-b-2 border-border flex items-center justify-between gap-2">
          {title && <p className="font-bold text-foreground text-sm sm:text-base">{title}</p>}
          {badge}
        </div>
      )}
      {children}
    </div>
  );
});
