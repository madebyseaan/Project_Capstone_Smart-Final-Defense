import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  badge,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {badge}
      </div>
      <div className="flex items-center gap-3">
        {description && (
          <p className="text-sm text-muted-foreground hidden sm:block">
            {description}
          </p>
        )}
        {actions}
      </div>
    </div>
  );
}
