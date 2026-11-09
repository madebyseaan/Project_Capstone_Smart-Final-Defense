import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { useCountUp } from "@/hooks/useCountUp";

interface StatCardProps {
  label: string;
  value: ReactNode;
  numericValue?: number;
  icon?: ReactNode;
  iconClassName?: string;
  trend?: {
    value: string;
    direction: "up" | "down" | "neutral";
    hint?: string;
  };
  compact?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  numericValue,
  icon,
  iconClassName,
  trend,
  compact,
  className,
}: StatCardProps) {
  const animated = useCountUp(numericValue ?? 0, 800, numericValue !== undefined);

  const displayValue =
    numericValue !== undefined ? animated.toLocaleString() : value;

  return (
    <Card
      className={cn(
        "border-0 shadow-lg shadow-muted/50 rounded-xl bg-card p-0",
        className
      )}
    >
      <CardContent className={cn("p-4", compact && "p-3")}>
        <div className="flex items-center justify-between gap-2">
          <div className={cn("space-y-1", compact && "space-y-0.5")}>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className={cn("text-2xl font-bold text-foreground", compact && "text-xl")}>
              {displayValue}
            </p>
          </div>
          {icon && (
            <div
              className={cn(
                "p-2 rounded-lg bg-muted",
                compact && "p-1.5 [&_svg]:size-4",
                iconClassName
              )}
            >
              {icon}
            </div>
          )}
        </div>
        {trend && (
          <div className="mt-2 pt-2 border-t border-border">
            <span
              className={cn(
                "inline-flex items-center text-xs font-medium",
                trend.direction === "up" && "text-emerald-600",
                trend.direction === "down" && "text-red-600",
                trend.direction === "neutral" && "text-muted-foreground"
              )}
            >
              {trend.value}
            </span>
            {trend.hint && (
              <span className="text-xs text-muted-foreground ml-1">
                {trend.hint}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
