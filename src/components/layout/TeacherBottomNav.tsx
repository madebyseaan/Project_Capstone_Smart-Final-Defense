import { Link, useLocation } from "react-router-dom";
import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHasAdvisory } from "@/hooks/useHasAdvisory";

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

const PRIMARY_ITEMS: NavItem[] = [
  { name: "Dashboard", href: "/teacher", icon: LayoutDashboard },
  { name: "Classes", href: "/teacher/classes", icon: BookOpen },
  { name: "Attendance", href: "/teacher/attendance", icon: ClipboardCheck },
  { name: "Schedule", href: "/teacher/schedule", icon: CalendarDays },
  { name: "Advisory", href: "/teacher/advisory", icon: Users },
];

const ADVISORY_ONLY_HREFS = new Set(["/teacher/attendance", "/teacher/advisory"]);

function isActive(pathname: string, href: string) {
  if (href === "/teacher") return pathname === "/teacher";
  if (href === "/teacher/classes") {
    return pathname === href || pathname.startsWith("/teacher/records/");
  }
  if (href === "/teacher/attendance") {
    return pathname === href || pathname.startsWith("/teacher/attendance-reports");
  }
  if (href === "/teacher/advisory") {
    return pathname === href || pathname.startsWith("/teacher/advisory/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TeacherBottomNav() {
  const { pathname } = useLocation();
  const hasAdvisory = useHasAdvisory();

  const items = PRIMARY_ITEMS.filter((item) => {
    if (ADVISORY_ONLY_HREFS.has(item.href)) return hasAdvisory !== false;
    return true;
  });

  return (
    <nav
      aria-label="Teacher navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch justify-around px-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-0 py-1.5 text-[0.75rem] font-medium tracking-tight transition-colors min-[360px]:text-[0.8rem]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
                active ? "text-primary" : "text-muted-foreground active:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-12 items-center justify-center rounded-full transition-colors",
                  active && "bg-primary/10",
                )}
              >
                <item.icon
                  className={cn("h-5 w-5", active && "stroke-[2.4]")}
                  aria-hidden="true"
                />
              </span>
              <span className="w-full truncate text-center">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

