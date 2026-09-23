/**
 * Sf9Tab.tsx — Report Card (SF9) per school year, rendered inside the vault.
 *
 * Year selection uses inline pills instead of the shared Select: the Select
 * primitive portals at z-50, which sits *below* the vault drawer (z-[60]) and
 * would render the options behind it.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, Loader2, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registrarApi, SERVER_URL } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import SF9Form from "../SF9Form";
import { printForm } from "./printForm";
import type { VaultStudent } from "./types";

interface Sf9TabProps {
  student: VaultStudent;
  years: string[];
  initialYear?: string | null;
}

export default function Sf9Tab({ student, years, initialYear }: Sf9TabProps) {
  const { logoUrl } = useTheme();
  const formRef = useRef<HTMLDivElement>(null);

  const fallbackYear = years[years.length - 1] ?? "";
  const [selectedYear, setSelectedYear] = useState<string>(() => initialYear ?? fallbackYear);
  // Never query a year this learner does not have (would 404 and trip the e2e gate).
  const year = years.includes(selectedYear) ? selectedYear : fallbackYear;

  const fullLogoUrl = logoUrl ? (logoUrl.startsWith("http") ? logoUrl : `${SERVER_URL}${logoUrl}`) : null;

  const sf9Query = useQuery({
    queryKey: ["registrar", "vault", "sf9", student.id, year],
    queryFn: async () => (await registrarApi.getSF9(student.id, year)).data,
    enabled: !!year,
    retry: 0,
    staleTime: 60_000,
  });

  if (years.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <FileWarning className="w-10 h-10 text-muted-foreground/60" />
        <p className="text-sm font-semibold text-foreground">No report cards available</p>
        <p className="text-xs text-muted-foreground">This learner has no enrollment years recorded in SMART.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 print-hide">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">SF9 — Learner&apos;s Progress Report Card</h3>
            <p className="text-xs text-muted-foreground">Read-only view · pick a school year</p>
          </div>
          <Button
            size="sm"
            className="font-semibold text-xs shrink-0"
            disabled={!sf9Query.data}
            onClick={() => printForm(formRef.current, "vault-sf9-print-style")}
          >
            <Printer className="w-3.5 h-3.5 mr-1.5" />
            Print SF9
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setSelectedYear(y)}
              className={cn(
                "px-3 h-8 rounded-lg text-xs font-medium border transition-colors tabular-nums",
                y === year
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted/60",
              )}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {sf9Query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading SF9…
        </div>
      ) : sf9Query.isError || !sf9Query.data ? (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
          <FileWarning className="w-10 h-10 text-muted-foreground/60" />
          <p className="text-sm font-semibold text-foreground">No report card for {year}</p>
          <p className="text-xs text-muted-foreground">Select a different school year.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div ref={formRef} className="min-w-[820px]">
            <SF9Form data={sf9Query.data} fullLogoUrl={fullLogoUrl} />
          </div>
        </div>
      )}
    </div>
  );
}
