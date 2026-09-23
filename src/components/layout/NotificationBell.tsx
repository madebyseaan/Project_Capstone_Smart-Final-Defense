/**
 * NotificationBell.tsx — header bell shared by all three portals.
 *
 * Renders derived notifications (no DB). Offline flags come from the layout's
 * single SSE connection; the rest come from useNotifications. Dismissal is
 * per-user localStorage state.
 */
import { Bell, AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";
import type { PortalRole } from "@/lib/api";
import type { NotificationSeverity } from "@/lib/notifications";

interface NotificationBellProps {
  portal: PortalRole;
  userId: string | null;
  atlasOffline?: boolean;
  enrollproOffline?: boolean;
}

const SEVERITY_ICON: Record<NotificationSeverity, typeof Info> = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  critical: "text-destructive",
  warning: "text-amber-600",
  info: "text-muted-foreground",
};

export default function NotificationBell({
  portal,
  userId,
  atlasOffline = false,
  enrollproOffline = false,
}: NotificationBellProps) {
  const navigate = useNavigate();
  const { notifications, dismiss, dismissAll } = useNotifications({
    portal,
    userId,
    atlasOffline,
    enrollproOffline,
  });

  if (!userId) return null;

  const count = notifications.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={count > 0 ? `Notifications, ${count} active` : "Notifications"}
            className="relative p-2 rounded-xl hover:bg-accent text-muted-foreground transition-all active:scale-95"
          />
        }
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notifications
          </span>
          {count > 0 && (
            <button
              type="button"
              onClick={dismissAll}
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              Dismiss all
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {count === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <CheckCircle2 className="w-6 h-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">You&apos;re all caught up</p>
            </div>
          ) : (
            notifications.map((n) => {
              const Icon = SEVERITY_ICON[n.severity];
              return (
                <DropdownMenuItem
                  key={n.id}
                  className="items-start gap-2.5 px-3 py-2.5"
                  onClick={() => {
                    dismiss(n.id);
                    navigate(n.href);
                  }}
                >
                  <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", SEVERITY_COLOR[n.severity])} />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground leading-snug">{n.title}</span>
                    {n.description && (
                      <span className="text-xs text-muted-foreground leading-snug">{n.description}</span>
                    )}
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
