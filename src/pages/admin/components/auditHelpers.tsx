import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Edit3,
  Info,
  LogIn,
  LogOut,
  Monitor,
  Plus,
  Settings,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dash } from "@/components/data-table";

export const actionLabels: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  login: "Login",
  logout: "Logout",
  config: "Configured",
};

export const actionIcons: Record<string, ReactNode> = {
  create: <Plus className="w-3.5 h-3.5" />,
  update: <Edit3 className="w-3.5 h-3.5" />,
  delete: <Trash2 className="w-3.5 h-3.5" />,
  login: <LogIn className="w-3.5 h-3.5" />,
  logout: <LogOut className="w-3.5 h-3.5" />,
  config: <Settings className="w-3.5 h-3.5" />,
};

export const severityConfig: Record<string, { icon: ReactNode; className: string; label: string }> = {
  info: { icon: <Info className="w-3.5 h-3.5" />, className: "bg-muted text-muted-foreground border-border", label: "Info" },
  warning: { icon: <AlertTriangle className="w-3.5 h-3.5" />, className: "bg-amber-50 text-amber-700 border-amber-200", label: "Warning" },
  critical: { icon: <AlertTriangle className="w-3.5 h-3.5" />, className: "bg-red-50 text-red-700 border-red-200", label: "Critical" },
};

const networkConfig: Record<string, string> = {
  Tailscale: "bg-violet-50 text-violet-700 border-violet-200",
  "School LAN": "bg-blue-50 text-blue-700 border-blue-200",
  Localhost: "bg-muted text-muted-foreground border-border",
  "Public Internet": "bg-amber-50 text-amber-700 border-amber-200",
  Unknown: "bg-muted text-muted-foreground border-border",
};

export function networkBadgeClass(network?: string): string {
  return networkConfig[network || "Unknown"] || networkConfig.Unknown;
}

export function deviceTypeIcon(deviceType?: string): ReactNode {
  switch (deviceType) {
    case "Mobile":
      return <Smartphone className="w-3.5 h-3.5" />;
    case "Tablet":
      return <Tablet className="w-3.5 h-3.5" />;
    case "Bot":
      return <Bot className="w-3.5 h-3.5" />;
    default:
      return <Monitor className="w-3.5 h-3.5" />;
  }
}

export function SeverityBadge({ severity }: { severity?: string }) {
  const cfg = severityConfig[severity || "info"] || severityConfig.info;
  return (
    <Badge variant="outline" className={`${cfg.className} font-medium flex items-center gap-1 w-fit`}>
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

export function NetworkBadge({ network }: { network?: string }) {
  if (!network || network === "Unknown") return <Dash />;
  return (
    <Badge variant="outline" className={`${networkBadgeClass(network)} font-medium w-fit`}>
      {network}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome?: string }) {
  if (outcome !== "failure") return null;
  return (
    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 font-medium w-fit">
      Failed
    </Badge>
  );
}

export function formatRelative(iso?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatExactDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export const defaultActionIcon = <Activity className="w-3.5 h-3.5" />;
