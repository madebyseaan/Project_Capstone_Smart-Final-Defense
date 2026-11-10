import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MASTERY_SEGMENTS,
  SURFACE,
  clampPercent,
  type MasteryDistribution,
} from "./MobileDashboardTokens";

export function ProgressRing({
  value,
  size,
  stroke,
  className,
  trackClassName,
  children,
}: {
  value: number;
  size: number;
  stroke: number;
  className?: string;
  trackClassName?: string;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const offset =
    circumference - ((entered ? clampPercent(value) : 0) / 100) * circumference;

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={trackClassName ?? "stroke-current opacity-15"}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="motion-ring stroke-current"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function MasteryDonut({
  distribution,
  total,
}: {
  distribution: MasteryDistribution;
  total: number;
}) {
  const size = 108;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = MASTERY_SEGMENTS.map((segment) => ({
    ...segment,
    count: distribution[segment.key] ?? 0,
  })).filter((segment) => segment.count > 0);
  const known = segments.reduce((sum, segment) => sum + segment.count, 0);
  let cumulative = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="img"
        aria-label={`Performance distribution for ${total} learners`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        {known > 0 &&
          segments.map((segment) => {
            const dash = Math.max(0.5, (segment.count / known) * circumference - 4);
            const gap = circumference - dash;
            const offset = -(cumulative / known) * circumference;
            cumulative += segment.count;
            return (
              <circle
                key={segment.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={offset}
                className={segment.stroke}
              />
            );
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[1.2rem] font-semibold leading-none tabular-nums text-foreground">
          {total}
        </span>
        <span className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
          {total === 1 ? "learner" : "learners"}
        </span>
      </div>
    </div>
  );
}

export function SectionHeading({
  icon: Icon,
  title,
  meta,
  action,
  iconClass,
}: {
  icon: LucideIcon;
  title: ReactNode;
  meta?: string;
  action?: ReactNode;
  iconClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pl-4 pr-4">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            iconClass ?? "bg-primary/10 text-primary",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[0.9rem] font-semibold tracking-tight text-foreground min-[360px]:text-[0.95rem]">
            {title}
          </h2>
          {meta && (
            <p className="mt-0.5 truncate text-[0.8rem] font-medium text-muted-foreground">{meta}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

export function SectionLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="-my-3 inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1 py-3 text-[0.8rem] font-semibold text-primary transition-colors active:text-primary/70"
    >
      <span className="hidden min-[360px]:inline">{label}</span>
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

export function StatTile({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  accent: "primary" | "amber";
}) {
  const iconClass =
    accent === "amber" ? "bg-amber-500/10 text-amber-600" : "bg-primary/10 text-primary";
  const glowClass = accent === "amber" ? "bg-amber-500/[0.07]" : "bg-primary/[0.06]";

  return (
    <div className={cn("relative overflow-hidden p-4", SURFACE)}>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-5 -top-5 h-20 w-20 rounded-full blur-xl",
          glowClass,
        )}
      />
      <div className={cn("relative flex h-10 w-10 items-center justify-center rounded-xl", iconClass)}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="relative mt-4 text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      <p className="relative mt-1.5 text-[0.8rem] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
