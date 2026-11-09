import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LayoutDashboard, Users, X } from "lucide-react";
import { FilterTabs } from "@/components/layout/FilterTabs";
import type { FilterTabItem } from "@/components/layout/FilterTabs";

const EOSY_TAB_ITEMS: FilterTabItem[] = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "learner-records", label: "Learner Records", icon: Users },
];

interface EOSYSectionDrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  activeTab: string;
  onTabChange: (value: string) => void;
  onClose: () => void;
  children: ReactNode;
}

export default function EOSYSectionDrawer({
  open,
  title,
  subtitle,
  activeTab,
  onTabChange,
  onClose,
  children,
}: EOSYSectionDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-end print-hide"
      role="dialog"
      aria-modal="true"
      aria-label={`EOSY details for ${title}`}
      data-testid="eosy-section-drawer"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative flex h-full w-full max-w-[980px] flex-col bg-background shadow-2xl animate-in slide-in-from-right-2 duration-200">
        <header className="border-b border-border px-4 pt-4 lg:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                EOSY Section
              </p>
              <h2 className="truncate text-lg font-bold tracking-tight text-foreground">
                {title}
              </h2>
              {subtitle && (
                <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close section detail"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <FilterTabs
            value={activeTab}
            onValueChange={onTabChange}
            items={EOSY_TAB_ITEMS}
            className="mt-3"
          />
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
