import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FullScreenSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Full-screen task sheet for phone-sized viewports. The header and footer stay
 * pinned while only the body scrolls, which keeps primary actions reachable
 * during long forms.
 */
export function FullScreenSheet({
  open,
  onOpenChange,
  title,
  description,
  header,
  footer,
  children,
  className,
  contentClassName,
}: FullScreenSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "fixed top-0 left-0 right-0 bottom-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none sm:rounded-none",
          className,
        )}
      >
        <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3 pt-[env(safe-area-inset-top)]">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base font-semibold text-foreground">
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="truncate text-xs text-muted-foreground">
                {description}
              </DialogDescription>
            ) : null}
          </div>
          {header}
        </div>

        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4", contentClassName)}>
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-border bg-card px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

