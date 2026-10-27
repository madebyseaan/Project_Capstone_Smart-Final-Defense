import { useEffect, useState } from "react";
import { useNavigate, Outlet, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  LogOut,
  Menu,
  X,
  GraduationCap,
  Users,
  ClipboardCheck,
  FileText,
  CalendarDays,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { SERVER_URL } from "@/lib/api";
import { useSyncStream } from "@/hooks/useSyncStream";
import IntegratedSystemsNav from "@/components/layout/IntegratedSystemsNav";
import PixelGridBackground from "@/components/layout/PixelGridBackground";
import AccessibilityMenu from "@/components/layout/AccessibilityMenu";
import NotificationBell from "@/components/layout/NotificationBell";
import TeacherBottomNav from "@/components/layout/TeacherBottomNav";
import { useHasAdvisory } from "@/hooks/useHasAdvisory";
interface UserData {
  id: string;
  username: string;
  role: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

const navigationGroups = [
  {
    title: "OPERATIONS",
    items: [
      { name: "Dashboard", href: "/teacher", icon: LayoutDashboard },
      { name: "Schedule", href: "/teacher/schedule", icon: CalendarDays },
    ]
  },
  {
    title: "ACADEMICS",
    items: [
      { name: "Class Records", href: "/teacher/classes", icon: BookOpen },
      { name: "Attendance", href: "/teacher/attendance", icon: ClipboardCheck },
      { name: "Attendance Reports", href: "/teacher/attendance-reports", icon: FileText },
    ]
  },
  {
    title: "MANAGEMENT",
    items: [
      { name: "My Advisory", href: "/teacher/advisory", icon: Users },
    ]
  }
];

// Attendance is advisory-based (SF2) — only teachers with an advisory class
// (assigned via EnrollPro) see these entries.
const ADVISORY_ONLY_HREFS = new Set(["/teacher/attendance", "/teacher/attendance-reports"]);

export default function TeacherLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<UserData | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('teacherSidebarCollapsed');
    return saved === 'true';
  });
  const { colors, logoUrl, schoolName, currentSchoolYear } = useTheme();
  const { atlasOffline, enrollproOffline } = useSyncStream();
  const hasAdvisory = useHasAdvisory();

  const visibleNavigationGroups = hasAdvisory === false
    ? navigationGroups.map((group) => ({
        ...group,
        items: group.items.filter((item) => !ADVISORY_ONLY_HREFS.has(item.href)),
      }))
    : navigationGroups;

  useEffect(() => {
    localStorage.setItem("smart_active_portal", "teacher");
  }, []);

  useEffect(() => {
    const userData = sessionStorage.getItem("user_teacher");

    if (!userData) {
      navigate("/login");
      return;
    }

    const parsedUser = JSON.parse(userData);
    if (parsedUser.role !== "TEACHER") {
      navigate("/login");
      return;
    }

    setUser(parsedUser);
  }, [navigate]);

  const handleLogout = () => {
    sessionStorage.removeItem("user_teacher");
    sessionStorage.removeItem("token_teacher");
    sessionStorage.removeItem("refreshToken_teacher");
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("token");
    navigate("/login");
  };

  const toggleSidebarCollapse = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem('teacherSidebarCollapsed', String(newState));
  };

  // Collapse sidebar when tutorial opens, restore when it closes
  useEffect(() => {
    const savedState = localStorage.getItem('teacherSidebarCollapsed');
    const handleTourStart = () => {
      setSidebarCollapsed(true);
    };
    const handleTourEnd = () => {
      const restored = savedState === 'true';
      setSidebarCollapsed(restored);
    };
    window.addEventListener("tour:start", handleTourStart);
    window.addEventListener("tour:end", handleTourEnd);
    return () => {
      window.removeEventListener("tour:start", handleTourStart);
      window.removeEventListener("tour:end", handleTourEnd);
    };
  }, []);

  const getCurrentPageTitle = () => {
    // Check for specific record view routes
    if (location.pathname.startsWith("/teacher/records/")) {
      return "Class Record";
    }
    if (location.pathname.startsWith("/teacher/advisory/student/")) {
      return "Student Profile";
    }
    
    for (const group of navigationGroups) {
      const currentNav = group.items.find(nav => 
        location.pathname === nav.href || 
        (nav.href !== "/teacher" && location.pathname.startsWith(nav.href + '/'))
      );
      if (currentNav) return currentNav.name;
    }
    return "Dashboard";
  };

  if (!user) return null;

  const userDisplayName = user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}` 
    : user.username;

  return (
    <div className="isolate min-h-dvh">
      <PixelGridBackground />
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 bg-card border-r border-border transition-[width,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] flex flex-col shadow-sm will-change-[width,transform]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          sidebarCollapsed ? "lg:w-[70px] w-[min(86vw,320px)]" : "w-[min(86vw,320px)] lg:w-[280px]"
        )}
        style={{ fontFamily: "'DM Sans', 'Poppins', sans-serif" }}
      >
        {/* Logo Header */}
        <div className={cn(
          "h-24 flex items-center overflow-hidden transition-all duration-200",
          sidebarCollapsed ? "px-0 justify-center" : "px-6"
        )}>
          {sidebarCollapsed ? (
            <div
              className="w-12 h-12 rounded-lg bg-background border border-border shadow-sm flex items-center justify-center overflow-hidden transition-transform duration-200 ease-out p-1 scale-[0.85]"
            >
              {logoUrl ? (
                <img
                  src={logoUrl.startsWith("http") ? logoUrl : `${SERVER_URL}${logoUrl}`}
                  alt="School Logo"
                  className="w-full h-full object-contain"
                />
              ) : (
                <GraduationCap className="w-6 h-6 text-[var(--theme-primary)]" />
              )}
            </div>
          ) : (
            <div className="flex items-center w-full min-w-[240px] transition-all duration-200">
              <div className="w-12 h-12 flex flex-shrink-0 items-center justify-center">
                <div className="w-12 h-12 rounded-lg bg-background border border-border shadow-sm flex items-center justify-center overflow-hidden p-1">
                  {logoUrl ? (
                    <img
                      src={logoUrl.startsWith("http") ? logoUrl : `${SERVER_URL}${logoUrl}`}
                      alt="School Logo"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <GraduationCap className="w-6 h-6 text-[var(--theme-primary)]" />
                  )}
                </div>
              </div>
              <div className="ml-3 transition-all duration-200 origin-left flex-shrink-0">
                <span className="font-bold text-sm leading-tight tracking-tight uppercase block max-w-[160px] text-[var(--theme-primary)]">
                  {schoolName}
                </span>
              </div>
            </div>
          )}
          <button
            className="lg:hidden ml-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-3 custom-scrollbar overflow-x-hidden">
          {visibleNavigationGroups.map((group) => (
            <div key={group.title} className="mb-5 first:mt-2">
              {!sidebarCollapsed && (
                <span className="px-4 mb-1 text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide block whitespace-nowrap">
                  {group.title}
                </span>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  let isActive = location.pathname === item.href;
                  
                  if (!isActive && item.href !== "/teacher") {
                    isActive = location.pathname.startsWith(item.href + '/') || location.pathname === item.href;
                    if (item.href === "/teacher/classes" && location.pathname.startsWith("/teacher/records/")) isActive = true;
                    if (item.href === "/teacher/advisory" && location.pathname.startsWith("/teacher/advisory/")) isActive = true;
                  }
                  
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={cn(
                        "flex min-h-12 items-center rounded-full text-[14px] font-medium transition-all duration-200 group overflow-hidden py-2 lg:min-h-0 lg:py-1.5",
                        sidebarCollapsed ? "px-0 justify-center h-10 w-10 mx-auto" : "px-4",
                        isActive 
                          ? "text-white shadow-sm" 
                          : "text-foreground hover:bg-muted"
                      )}
                      style={{
                        backgroundColor: isActive ? 'var(--theme-primary)' : undefined,
                      }}
                      onClick={() => setSidebarOpen(false)}
                      title={sidebarCollapsed ? item.name : undefined}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <div className={cn(
                        "flex items-center transition-all duration-200",
                        sidebarCollapsed ? "justify-center" : "w-full"
                      )}>
                        <div className="w-6 h-6 flex flex-shrink-0 items-center justify-center">
                          <item.icon className={cn(
                            "w-5 h-5 transition-colors duration-200",
                            isActive ? "text-white" : "text-muted-foreground group-hover:text-foreground"
                          )} strokeWidth={2.2} />
                        </div>
                        <span className={cn(
                          "transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left whitespace-nowrap flex-shrink-0",
                          sidebarCollapsed ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0" : "opacity-100 scale-100 translate-x-0 ml-4"
                        )}>{item.name}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          <IntegratedSystemsNav collapsed={sidebarCollapsed} />
        </nav>

        {/* User Profile at Bottom */}
        <div className={cn(
          "p-4 border-t border-border transition-all duration-200 bg-muted/20 overflow-hidden",
          sidebarCollapsed ? "px-2 py-4" : "p-4"
        )}>
          <div className={cn(
            "flex items-center transition-all duration-200 px-1 py-1",
            sidebarCollapsed ? "justify-center" : "w-full"
          )}>
            <div className="w-9 h-9 flex flex-shrink-0 items-center justify-center">
              <Avatar className="w-9 h-9 border border-border shadow-sm transition-transform duration-200" style={{ transform: sidebarCollapsed ? 'scale(0.9)' : 'scale(1)' }}>
                <AvatarFallback className="bg-muted text-foreground font-semibold text-xs uppercase">
                  {user.firstName ? user.firstName.charAt(0).toUpperCase() : user.username.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className={cn(
              "flex-1 min-w-0 flex items-center justify-between transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left",
              sidebarCollapsed ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0" : "opacity-100 scale-100 translate-x-0 ml-3"
            )}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate leading-none mb-1">{userDisplayName}</p>
                <p className="text-[10px] font-medium text-muted-foreground truncate uppercase tracking-wide">Teacher</p>
              </div>
              <button
                onClick={handleLogout}
                className="ml-1 flex h-12 w-12 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-destructive"
                title="Sign Out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className={cn(
        "transition-[padding] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] flex flex-col min-h-dvh will-change-[padding]",
        sidebarCollapsed ? "lg:pl-[70px]" : "lg:pl-[280px]"
      )}>
        {/* Top navbar */}
        <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/85 backdrop-blur-md px-3 lg:h-16 lg:px-6">
          <div className="h-full flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <button
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted active:scale-95"
                onClick={() => {
                  if (window.innerWidth >= 1024) {
                    toggleSidebarCollapse();
                  } else {
                    setSidebarOpen(true);
                  }
                }}
                aria-label="Open navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
              
              {/* Page Title */}
              <div className="flex min-w-0 flex-col">
                <span className="hidden text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:block">Teacher Portal</span>
                <span className="truncate text-base font-semibold text-foreground sm:-mt-0.5">
                  {getCurrentPageTitle()}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1 sm:gap-3">
              <AccessibilityMenu userId={user.id} />
              <NotificationBell
                portal="teacher"
                userId={user.id}
                atlasOffline={atlasOffline}
                enrollproOffline={enrollproOffline}
              />
              {/* School Year Badge */}
              {currentSchoolYear && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide px-2 py-1 rounded-lg bg-muted text-muted-foreground">
                  S.Y. {currentSchoolYear}
                </span>
              )}
              {/* User Avatar and Name */}
              <div className="flex items-center gap-3 border-l border-border pl-2 sm:pl-3">
                <div className="hidden sm:flex flex-col items-end mr-1">
                  <span className="text-sm font-semibold text-foreground leading-none">
                    {user.firstName || user.username}
                  </span>
                  <span 
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-md mt-1"
                    style={{ 
                      color: colors.primary,
                      backgroundColor: `${colors.primary}10`
                    }}
                  >
                    Teacher
                  </span>
                </div>
                <Avatar className="h-9 w-9 ring-2 ring-border ring-offset-2 ring-offset-background">
                  <AvatarFallback className="bg-muted text-foreground text-sm font-semibold">
                    {user.firstName ? user.firstName.charAt(0).toUpperCase() : user.username.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
            </div>
          </div>
        </header>

        {/* Page content — bottom padding clears the mobile nav + safe area */}
        <main className="flex-1 p-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:p-8 lg:pb-8">
          <Outlet />
        </main>
      </div>

      <TeacherBottomNav
        userName={userDisplayName}
        schoolYear={currentSchoolYear}
        onLogout={handleLogout}
      />
    </div>
  );
}
