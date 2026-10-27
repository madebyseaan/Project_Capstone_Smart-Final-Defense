import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MobileListRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}

/**
 * Full-row tap target for mobile list views. Minimum height is 56px so the
 * whole row stays comfortably above the 44px touch target floor.
 */
export function MobileListRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  className,
  ...props
}: MobileListRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left transition-colors",
        "active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
        {meta ? <div className="mt-1.5">{meta}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </button>
  );
}
