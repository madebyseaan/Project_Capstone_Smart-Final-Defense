import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StickyActionBarProps {
  children: ReactNode;
  className?: string;
}

/**
 * Sticky action bar for mobile task pages. Sits above the teacher bottom
 * navigation and respects the iOS safe area.
 */
export function StickyActionBar({ children, className }: StickyActionBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
