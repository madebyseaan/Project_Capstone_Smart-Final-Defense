import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "daily" as const, label: "Daily", href: "/teacher/attendance" },
  { key: "reports" as const, label: "Reports", href: "/teacher/attendance-reports" },
];

export default function MobileAttendanceTabs({
  active,
}: {
  active: "daily" | "reports";
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-muted p-1 lg:hidden">
      {TABS.map((tab) => {
        const selected = active === tab.key;
        return (
          <Link
            key={tab.key}
            to={tab.href}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex min-h-12 flex-1 items-center justify-center rounded-lg text-[0.8rem] font-semibold transition-colors",
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground active:bg-card/60",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
