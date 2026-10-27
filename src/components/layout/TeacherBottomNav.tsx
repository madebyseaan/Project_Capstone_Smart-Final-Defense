import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  Ellipsis,
  FileText,
  LayoutDashboard,
  LogOut,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHasAdvisory } from "@/hooks/useHasAdvisory";
import { FullScreenSheet } from "@/components/mobile";

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

export interface TeacherBottomNavProps {
  userName: string;
  schoolYear?: string;
  onLogout: () => void;
}

const PRIMARY_ITEMS: NavItem[] = [
  { name: "Dashboard", href: "/teacher", icon: LayoutDashboard },
  { name: "Classes", href: "/teacher/classes", icon: BookOpen },
  { name: "Attendance", href: "/teacher/attendance", icon: ClipboardCheck },
  { name: "Schedule", href: "/teacher/schedule", icon: CalendarDays },
];

const SECONDARY_ITEMS: NavItem[] = [
  { name: "My Advisory", href: "/teacher/advisory", icon: Users },
  { name: "Attendance Reports", href: "/teacher/attendance-reports", icon: FileText },
];

function isActive(pathname: string, href: string) {
  if (href === "/teacher") return pathname === "/teacher";
  if (href === "/teacher/classes") {
    return pathname === href || pathname.startsWith("/teacher/records/");
  }
  if (href === "/teacher/advisory") {
    return pathname === href || pathname.startsWith("/teacher/advisory/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TeacherBottomNav({ userName, schoolYear, onLogout }: TeacherBottomNavProps) {
  const { pathname } = useLocation();
  const hasAdvisory = useHasAdvisory();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = PRIMARY_ITEMS.filter(
    (item) => item.href !== "/teacher/attendance" || hasAdvisory !== false,
  );
  const secondary = SECONDARY_ITEMS.filter(
    (item) => item.href !== "/teacher/attendance-reports" || hasAdvisory !== false,
  );
  const moreActive = secondary.some((item) => isActive(pathname, item.href));

  return (
    <>
      <nav
        aria-label="Teacher navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex h-16 max-w-lg items-stretch justify-around px-1">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground active:bg-muted",
                )}
              >
                <item.icon className={cn("h-5 w-5", active && "stroke-[2.4]")} aria-hidden="true" />
                <span className="truncate">{item.name}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className={cn(
              "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium transition-colors",
              moreActive ? "text-primary" : "text-muted-foreground active:bg-muted",
            )}
          >
            <Ellipsis className="h-5 w-5" aria-hidden="true" />
            <span>More</span>
          </button>
        </div>
      </nav>

      <FullScreenSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="More"
        description={schoolYear ? `S.Y. ${schoolYear}` : userName}
        contentClassName="space-y-2"
      >
        {secondary.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setMoreOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 text-sm font-semibold transition-colors active:bg-muted",
                active ? "text-primary" : "text-foreground",
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="flex-1">{item.name}</span>
            </Link>
          );
        })}

        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Signed in as</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{userName}</p>
          <p className="text-xs text-muted-foreground">Teacher</p>
        </div>

        <button
          type="button"
          onClick={() => {
            setMoreOpen(false);
            onLogout();
          }}
          className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 text-sm font-semibold text-destructive transition-colors active:bg-destructive/10"
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          Sign out
        </button>

      </FullScreenSheet>
    </>
  );
}
