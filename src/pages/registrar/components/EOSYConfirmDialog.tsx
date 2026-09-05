import { memo } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { RegistrarModal, AlertBanner } from "@/components/registrar-modal";
import type { AlertVariant } from "@/components/registrar-modal";

interface EOSYConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "danger" | "warning" | "info";
  loading?: boolean;
  onConfirm: () => void;
}

const ICONS: Record<AlertVariant, typeof AlertTriangle> = {
  danger: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};

function EOSYConfirmDialogBase({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "warning",
  loading = false,
  onConfirm,
}: EOSYConfirmDialogProps) {
  const Icon = ICONS[variant];

  return (
    <RegistrarModal
      open={open}
      onOpenChange={onOpenChange}
      icon={<Icon className="w-5 h-5" />}
      title={title}
      size="sm"
      confirmLabel={confirmLabel}
      destructive={variant === "danger"}
      loading={loading}
      onConfirm={onConfirm}
    >
      <AlertBanner variant={variant}>{description}</AlertBanner>
    </RegistrarModal>
  );
}

const EOSYConfirmDialog = memo(EOSYConfirmDialogBase);
export default EOSYConfirmDialog;
