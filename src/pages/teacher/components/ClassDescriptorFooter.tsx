import { Award } from "lucide-react";
import { GRADE_DESCRIPTORS, getDescriptorInfo, getGradeColor } from "@/lib/gradeMath";
import { cn } from "@/lib/utils";

interface ClassDescriptorFooterProps {
  /** Class average (transmuted). Null when there are no grades yet. */
  average: number | null;
  totalLearners?: number;
}

export function ClassDescriptorFooter({ average, totalLearners }: ClassDescriptorFooterProps) {
  const active = getDescriptorInfo(average);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[var(--ledger-grade-bg)] text-[var(--ledger-grade)]">
            <Award className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Class Descriptor</p>
            <p className="text-sm font-bold">
              <span className={active ? getGradeColor(average) : "text-slate-400"}>
                {active?.label ?? "—"}
              </span>
              {average != null && (
                <span className="ml-2 text-slate-400 font-semibold">
                  Class Average {average.toFixed(1)}
                  {typeof totalLearners === "number" && totalLearners > 0 ? ` · ${totalLearners} learner${totalLearners !== 1 ? "s" : ""}` : ""}
                </span>
              )}
            </p>
          </div>
        </div>

        {active && (
          <p className="text-xs text-slate-500 flex-1 min-w-[240px] leading-relaxed">
            {active.description}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {GRADE_DESCRIPTORS.map((d) => {
          const isActive = active?.label === d.label;
          return (
            <span
              key={d.label}
              className={cn(
                "text-[10px] font-bold px-2 py-1 rounded-md border",
                isActive
                  ? "bg-[var(--ledger-grade-bg)] text-[var(--ledger-grade)] border-[var(--ledger-grade)]"
                  : "bg-slate-50 text-slate-500 border-slate-200"
              )}
            >
              {d.label} · {d.min}–{d.max}
            </span>
          );
        })}
      </div>
    </div>
  );
}
