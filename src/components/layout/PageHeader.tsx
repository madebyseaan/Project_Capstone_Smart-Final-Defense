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
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3 sm:shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {badge}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
        {description && (
          <p className="min-w-0 break-words text-sm text-muted-foreground">
            {description}
          </p>
        )}
        {actions}
      </div>
    </div>
  );
}
