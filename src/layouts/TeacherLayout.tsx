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
import { cn, getAcronym } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { SERVER_URL } from "@/lib/api";
import DevPortalSwitcher from "@/components/DevPortalSwitcher";

interface UserData {
  id: string;
  username: string;
  role: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  isDeveloper?: boolean;
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

export default function TeacherLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<UserData | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('teacherSidebarCollapsed');
    return saved === 'true';
  });
  const { colors, logoUrl, schoolName } = useTheme();

  useEffect(() => {
    const userData = sessionStorage.getItem("user");

    if (!userData) {
      navigate("/login");
      return;
    }

    const parsedUser = JSON.parse(userData);
    const isDev = Boolean(parsedUser.isDeveloper || parsedUser.username === "999999" || parsedUser.role === "ADMIN");
    if (parsedUser.role !== "TEACHER" && !isDev) {
      navigate("/login");
      return;
    }

    setUser(parsedUser);
  }, [navigate]);

  const handleLogout = () => {
    sessionStorage.removeItem("user");
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

  const userEmail = user.email || `${user.username}@school.edu.ph`;
  const userDisplayName = user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}` 
    : user.username;

  return (
    <div className="min-h-screen bg-slate-100">
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
          "fixed inset-y-0 left-0 z-50 bg-[#fafafa] border-r border-slate-200 transition-[width,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] flex flex-col shadow-sm will-change-[width,transform]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          sidebarCollapsed ? "lg:w-[70px] w-[280px]" : "w-[280px]"
        )}
        style={{ fontFamily: "'Instrument Sans', 'Geist Variable', sans-serif" }}
      >
        {/* Logo Header */}
        <div className={cn(
          "h-24 flex items-center overflow-hidden transition-all duration-200",
          sidebarCollapsed ? "px-0 justify-center" : "px-6"
        )}>
          {sidebarCollapsed ? (
            <div
              className="w-12 h-12 rounded-lg bg-white border border-slate-100 shadow-sm flex items-center justify-center overflow-hidden transition-transform duration-200 ease-out p-1 scale-[0.85]"
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
                <div className="w-12 h-12 rounded-lg bg-white border border-slate-100 shadow-sm flex items-center justify-center overflow-hidden p-1">
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
            className="lg:hidden ml-auto p-2 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-3 custom-scrollbar overflow-x-hidden">
          {navigationGroups.map((group) => (
            <div key={group.title} className="mb-5 first:mt-2">
              {!sidebarCollapsed && (
                <span className="px-4 mb-1 text-[0.625rem] font-bold text-[#0F1729]/60 uppercase tracking-normal block whitespace-nowrap">
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
                        "flex items-center rounded-full text-[14px] font-medium transition-all duration-200 group overflow-hidden py-1.5",
                        sidebarCollapsed ? "px-0 justify-center h-10 w-10 mx-auto" : "px-4",
                        isActive 
                          ? "text-white shadow-sm" 
                          : "text-[#0F1729] hover:bg-white/80"
                      )}
                      style={{
                        backgroundColor: isActive ? 'var(--theme-primary)' : 'transparent',
                      }}
                      onClick={() => setSidebarOpen(false)}
                      title={sidebarCollapsed ? item.name : undefined}
                    >
                      <div className={cn(
                        "flex items-center transition-all duration-200",
                        sidebarCollapsed ? "justify-center" : "w-full"
                      )}>
                        <div className="w-6 h-6 flex flex-shrink-0 items-center justify-center">
                          <item.icon className={cn(
                            "w-5 h-5 transition-colors duration-200",
                            isActive ? "text-white" : "text-[#0F1729]/70 group-hover:text-[#0F1729]"
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
        </nav>

        {/* User Profile at Bottom */}
        <div className={cn(
          "p-4 border-t border-slate-100 transition-all duration-200 bg-white/20 overflow-hidden",
          sidebarCollapsed ? "px-2 py-4" : "p-4"
        )}>
          <div className={cn(
            "flex items-center transition-all duration-200 px-1 py-1",
            sidebarCollapsed ? "justify-center" : "w-full"
          )}>
            <div className="w-9 h-9 flex flex-shrink-0 items-center justify-center">
              <Avatar className="w-9 h-9 border border-white shadow-sm transition-transform duration-200" style={{ transform: sidebarCollapsed ? 'scale(0.9)' : 'scale(1)' }}>
                <AvatarFallback className="bg-slate-100 text-slate-700 font-bold text-xs uppercase">
                  {user.firstName ? user.firstName.charAt(0).toUpperCase() : user.username.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className={cn(
              "flex-1 min-w-0 flex items-center justify-between transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left",
              sidebarCollapsed ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0" : "opacity-100 scale-100 translate-x-0 ml-3"
            )}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[#0F1729] truncate leading-none mb-1">{userDisplayName}</p>
                <p className="text-[10px] font-bold text-[#0F1729]/50 truncate uppercase tracking-tight">Teacher</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg hover:bg-white hover:text-red-600 text-slate-400 transition-colors duration-200 ml-1"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className={cn(
        "transition-[padding] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] flex flex-col min-h-screen will-change-[padding]",
        sidebarCollapsed ? "lg:pl-[70px]" : "lg:pl-[280px]"
      )}>
        {/* Top navbar */}
        <header className="sticky top-0 z-30 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 lg:px-6">
          <div className="h-full flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-all active:scale-95"
                onClick={() => {
                  if (window.innerWidth >= 1024) {
                    toggleSidebarCollapse();
                  } else {
                    setSidebarOpen(true);
                  }
                }}
              >
                <Menu className="w-5 h-5" />
              </button>
              
              {/* Page Title */}
              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Teacher Portal</span>
                <span className="text-base font-bold text-slate-900 -mt-1">
                  {getCurrentPageTitle()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Dev Portal Quick Switcher */}
              <DevPortalSwitcher user={user} />

              {/* User Avatar and Name */}
              <div className="flex items-center gap-3 pl-3 border-l border-slate-100">
                <div className="hidden sm:flex flex-col items-end mr-1">
                  <span className="text-sm font-bold text-slate-900 leading-none">
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
                <Avatar className="w-9 h-9 ring-2 ring-slate-100 ring-offset-2">
                  <AvatarFallback className="bg-slate-200 text-slate-700 text-sm font-bold">
                    {user.firstName ? user.firstName.charAt(0).toUpperCase() : user.username.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-8 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
