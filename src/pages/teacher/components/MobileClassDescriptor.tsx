import { Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { GRADE_DESCRIPTORS, getDescriptorInfo, getGradeColor } from "@/lib/gradeMath";
import { SURFACE } from "./MobileDashboardTokens";

interface MobileClassDescriptorProps {
  average: number | null;
  totalLearners?: number;
}

export default function MobileClassDescriptor({
  average,
  totalLearners,
}: MobileClassDescriptorProps) {
  const active = getDescriptorInfo(average);

  return (
    <div className="space-y-2 lg:hidden">
      <div className={cn("p-4", SURFACE)}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ledger-grade-bg)] text-[var(--ledger-grade)]">
            <Award className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.8rem] font-medium text-muted-foreground">Class descriptor</p>
            <p
              className={cn(
                "mt-0.5 text-[0.95rem] font-semibold",
                active ? getGradeColor(average) : "text-muted-foreground",
              )}
            >
              {active?.label ?? "—"}
            </p>
            <p className="mt-0.5 text-[0.8rem] font-medium text-muted-foreground">
              Class average {average != null ? average.toFixed(1) : "—"}
              {typeof totalLearners === "number" && totalLearners > 0
                ? ` · ${totalLearners} learner${totalLearners !== 1 ? "s" : ""}`
                : ""}
            </p>
          </div>
        </div>

        {active && (
          <p className="mt-3 text-[0.8rem] leading-relaxed text-muted-foreground">
            {active.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {GRADE_DESCRIPTORS.map((descriptor) => {
            const isActive = active?.label === descriptor.label;
            return (
              <span
                key={descriptor.label}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[0.8rem] font-semibold",
                  isActive
                    ? "border-[var(--ledger-grade)] bg-[var(--ledger-grade-bg)] text-[var(--ledger-grade)]"
                    : "border-border/70 bg-card text-muted-foreground",
                )}
              >
                {descriptor.label} · {descriptor.min}–{descriptor.max}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
