import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AppModal } from "@/components/app-modal";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * Shared confirmation dialog built on the role-agnostic app-modal system.
 * Replaces native `window.confirm` / `alert` flows with a consistent,
 * theme-aware modal.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  destructive = false,
  loading = false,
  icon,
  children,
}: ConfirmDialogProps) {
  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      icon={
        icon ??
        (destructive ? (
          <AlertTriangle className="w-6 h-6" />
        ) : (
          <CheckCircle2 className="w-6 h-6" />
        ))
      }
      title={title}
      description={description}
      size="sm"
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      destructive={destructive}
      loading={loading}
    >
      {children}
    </AppModal>
  );
}
