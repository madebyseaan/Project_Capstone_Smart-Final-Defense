import { CheckCircle, AlertTriangle, XCircle, Award } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface EOSYPromotionBreakdownProps {
  enrollments: any[];
  compact?: boolean;
}

const decisionConfig = {
  PROMOTED: {
    label: "Promoted",
    icon: CheckCircle,
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    iconColor: "text-emerald-500",
  },
  CONDITIONALLY_PROMOTED: {
    label: "Conditionally Promoted",
    icon: AlertTriangle,
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    iconColor: "text-amber-500",
  },
  RETAINED: {
    label: "Retained",
    icon: XCircle,
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    iconColor: "text-red-500",
  },
  JHS_COMPLETER: {
    label: "JHS Completer",
    icon: Award,
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    iconColor: "text-blue-500",
  },
};

export default function EOSYPromotionBreakdown({ enrollments, compact = false }: EOSYPromotionBreakdownProps) {
  if (!enrollments || enrollments.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const e of enrollments) {
    const status = e.decision?.promotionStatus ?? e.stored?.promotionStatus ?? "PROMOTED";
    counts[status] = (counts[status] || 0) + 1;
  }

  const total = enrollments.length;
  const entries = Object.entries(counts).filter(([_, count]) => count > 0);

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {entries.map(([status, count]) => {
          const config = decisionConfig[status as keyof typeof decisionConfig] ?? decisionConfig.PROMOTED;
          const Icon = config.icon;
          const pct = Math.round((count / total) * 100);
          return (
            <div
              key={status}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${config.bg} border ${config.border}`}
            >
              <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
              <span className={`text-xs font-semibold ${config.text}`}>{count}</span>
              <span className={`text-xs ${config.text} opacity-70`}>{config.label}</span>
              <span className={`text-[10px] ${config.text} opacity-50`}>({pct}%)</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {entries.map(([status, count]) => {
        const config = decisionConfig[status as keyof typeof decisionConfig] ?? decisionConfig.PROMOTED;
        const Icon = config.icon;
        const pct = Math.round((count / total) * 100);
        return (
          <div
            key={status}
            className={`flex flex-col items-center p-3 rounded-xl ${config.bg} border ${config.border}`}
          >
            <Icon className={`w-5 h-5 ${config.iconColor} mb-1`} />
            <span className={`text-xl font-bold ${config.text}`}>{count}</span>
            <span className={`text-xs font-medium ${config.text} text-center`}>{config.label}</span>
            <span className={`text-[10px] ${config.text} opacity-60`}>{pct}% of {total}</span>
          </div>
        );
      })}
    </div>
  );
}
