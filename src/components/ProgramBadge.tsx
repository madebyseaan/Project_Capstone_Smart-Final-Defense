import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getProgramBadgeClass, normalizeProgram, REGULAR_PROGRAM } from "@/lib/programColor";

interface ProgramBadgeProps {
  program?: string | null;
  className?: string;
}

export function ProgramBadge({ program, className }: ProgramBadgeProps) {
  const code = normalizeProgram(program);

  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 gap-1.5 rounded-full px-2 text-[10px] font-semibold whitespace-nowrap",
        getProgramBadgeClass(code),
        className
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {code === REGULAR_PROGRAM ? "REG" : code}
    </Badge>
  );
}
