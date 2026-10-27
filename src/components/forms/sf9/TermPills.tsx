import type { Sf9Term } from "@/lib/api";
import { cn } from "@/lib/utils";

const TERMS: Sf9Term[] = ["T1", "T2", "T3"];

interface TermPillsProps {
  value: Sf9Term;
  onChange: (term: Sf9Term) => void;
  labels?: Partial<Record<Sf9Term, string>>;
  testIdPrefix?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
}

export default function TermPills({
  value,
  onChange,
  labels,
  testIdPrefix = "term-pill",
  ariaLabel = "Select term",
  size = "md",
  className,
}: TermPillsProps) {
  return (
    <div
      className={cn("inline-flex items-center gap-1.5", className)}
      role="group"
      aria-label={ariaLabel}
    >
      {TERMS.map((term) => {
        const active = value === term;
        return (
          <button
            key={term}
            type="button"
            data-testid={`${testIdPrefix}-${term}`}
            aria-pressed={active}
            onClick={() => onChange(term)}
            className={cn(
              "rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "h-8 min-w-11 px-3 text-[11px]" : "h-10 min-w-14 px-4 text-xs",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {labels?.[term] ?? term}
          </button>
        );
      })}
    </div>
  );
}
