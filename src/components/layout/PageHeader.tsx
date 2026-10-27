import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  footer?: ReactNode;
  className?: string;
  variant?: "surface" | "flat" | "plain";
}

export function PageHeader({
  title,
  description,
  actions,
  badge,
  footer,
  className,
  variant = "surface",
}: PageHeaderProps) {
  const content = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="!text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );

  if (variant === "flat") {
    return (
      <div className={cn("flex flex-col border-b border-border", className)}>
        <div className="pb-4">{content}</div>
        {footer && <div className="border-t border-border py-3">{footer}</div>}
      </div>
    );
  }

  if (variant === "plain") {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        {content}
        {footer}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
        className
      )}
    >
      <div className="px-4 py-4 lg:px-5">{content}</div>
      {footer && (
        <div className="border-t border-border px-4 py-3 lg:px-5">{footer}</div>
      )}
    </div>
  );
}
