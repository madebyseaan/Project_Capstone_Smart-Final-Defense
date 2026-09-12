import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import { AppModal, ModalSection } from "@/components/app-modal";
import { Dash } from "@/components/data-table";
import type { AdminAuditLog } from "@/lib/api";
import {
  actionLabels,
  deviceTypeIcon,
  NetworkBadge,
  OutcomeBadge,
  SeverityBadge,
} from "./auditHelpers";

interface AuditLogDetailDialogProps {
  log: AdminAuditLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      <div className="text-sm text-foreground break-words">
        {isEmpty ? <Dash /> : value}
      </div>
    </div>
  );
}

export function AuditLogDetailDialog({ log, open, onOpenChange }: AuditLogDetailDialogProps) {
  const action = log?.action ?? "config";

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      hideFooter
      icon={<Activity className="w-6 h-6" />}
      title="Activity Detail"
      description={log ? `${actionLabels[action] || action} · ${log.date} ${log.timestamp}` : undefined}
    >
      {log && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={log.severity} />
            <OutcomeBadge outcome={log.outcome} />
          </div>

          <ModalSection title="Identity">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
              <Field label="User" value={log.user} />
              <Field label="Role" value={log.userRole} />
              <Field label="User ID" value={log.userId} />
            </div>
          </ModalSection>

          <ModalSection title="Source">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
              <Field
                label="IP Address"
                value={log.ipAddress ? <span className="font-mono text-xs">{log.ipAddress}</span> : null}
              />
              <Field label="Network" value={<NetworkBadge network={log.network} />} />
              <Field label="Method" value={log.requestMethod} />
              <Field
                label="Path"
                value={log.requestPath ? <span className="font-mono text-xs break-all">{log.requestPath}</span> : null}
              />
            </div>
          </ModalSection>

          <ModalSection title="Device">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
              <Field label="Browser" value={log.browser} />
              <Field label="Operating System" value={log.os} />
              <Field
                label="Device Type"
                value={
                  log.deviceType ? (
                    <span className="inline-flex items-center gap-1.5">
                      {deviceTypeIcon(log.deviceType)}
                      {log.deviceType}
                    </span>
                  ) : null
                }
              />
              <Field
                label="User Agent"
                value={log.userAgent ? <span className="text-xs text-muted-foreground break-all">{log.userAgent}</span> : null}
              />
            </div>
          </ModalSection>

          <ModalSection title="Activity">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
              <Field label="Action" value={actionLabels[action] || action} />
              <Field label="Target" value={log.target} />
              <Field label="Target Type" value={log.targetType} />
              <Field label="Details" value={log.details} />
            </div>
          </ModalSection>

          {log.metadata ? (
            <ModalSection title="Metadata">
              <pre className="p-4 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-words">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </ModalSection>
          ) : null}
        </div>
      )}
    </AppModal>
  );
}
