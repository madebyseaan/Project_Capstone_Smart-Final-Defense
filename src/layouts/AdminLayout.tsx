import { useEffect, useState } from "react";
import { useNavigate, Outlet, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Users,
  Settings,
  Shield,
  Activity,
  Sliders,
  FileSpreadsheet,
  BookOpen,
  ChevronDown,
  Calendar,
  FileText,
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

interface NavItem {
  name: string;
  href?: string;
  icon: any;
  isDropdown?: boolean;
  inDevelopment?: boolean;
  disabled?: boolean;
  children?: Array<{ name: string; href: string; icon: any; inDevelopment?: boolean; disabled?: boolean }>;
}

const navigationGroups = [
  {
    title: "OPERATIONS",
    items: [
      { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
    ]
  },
  {
    title: "ACADEMICS",
    items: [
      { name: "Class Assignments", href: "/admin/assignments", icon: BookOpen },
      { name: "Grade Edit Requests", href: "/admin/edit-requests", icon: FileText },
    ]
  },
  {
    title: "MANAGEMENT",
    items: [
      { name: "User Management", href: "/admin/users", icon: Users },
      { name: "SF Templates", href: "/admin/templates", icon: FileSpreadsheet },
    ]
  },
  {
    title: "SYSTEM",
    items: [
      { name: "Grading Config", href: "/admin/grading", icon: Sliders },
      { name: "Transmutation Table", href: "/admin/transmutation", icon: Sliders },
      { name: "School Years", href: "/admin/school-years", icon: Calendar },
      { name: "System Settings", href: "/admin/settings", icon: Settings },
      { name: "System Health", href: "/admin/health", icon: Shield },
      { name: "Audit Logs", href: "/admin/logs", icon: Activity },
    ]
  }
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<UserData | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('adminSidebarCollapsed');
    return saved === 'true';
  });
  const [dropdownOpen, setDropdownOpen] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('adminDropdownState');
    return saved ? JSON.parse(saved) : { 'Template Managers': true };
  });
  const { colors, logoUrl, schoolName, currentSchoolYear } = useTheme();

  useEffect(() => {
    const userData = sessionStorage.getItem("user_admin");

    if (!userData) {
      navigate("/login");
      return;
    }

    const parsedUser = JSON.parse(userData);
    const isDev = Boolean(parsedUser.isDeveloper || parsedUser.username === "999999");
    if (parsedUser.role !== "ADMIN" && !isDev) {
      navigate("/login");
      return;
    }

    setUser(parsedUser);
  }, [navigate]);

  const handleLogout = () => {
    sessionStorage.removeItem("user_admin");
    sessionStorage.removeItem("token_admin");
    sessionStorage.removeItem("refreshToken_admin");
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("token");
    navigate("/login");
  };

  const toggleSidebarCollapse = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem('adminSidebarCollapsed', String(newState));
  };

  const toggleDropdown = (name: string) => {
    const newState = { ...dropdownOpen, [name]: !dropdownOpen[name] };
    setDropdownOpen(newState);
    localStorage.setItem('adminDropdownState', JSON.stringify(newState));
  };

  const getCurrentPageTitle = () => {
    for (const group of navigationGroups) {
      for (const nav of group.items) {
        if (nav.href && (location.pathname === nav.href || (nav.href !== "/admin" && location.pathname.startsWith(nav.href)))) {
          return nav.name;
        }
        if (nav.children) {
          const child = nav.children.find(c => location.pathname === c.href || location.pathname.startsWith(c.href));
          if (child) return child.name;
        }
      }
    }
    return "Dashboard";
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-600 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

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
        style={{ fontFamily: "'Inter', 'Poppins', sans-serif" }}
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
                <Shield className="w-6 h-6 text-[var(--theme-primary)]" />
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
                    <Shield className="w-6 h-6 text-[var(--theme-primary)]" />
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
                  if (item.isDropdown && item.children) {
                    const hasActiveChild = !item.disabled && item.children.some(child => 
                      location.pathname === child.href || location.pathname.startsWith(child.href)
                    );
                    const isOpen = dropdownOpen[item.name];
                    
                    if (item.disabled) {
                      return (
                        <div key={item.name} className="relative">
                          {/* Dropdown Header (Disabled) */}
                          <div
                            className={cn(
                              "w-full flex items-center rounded-full text-[14px] font-medium opacity-40 cursor-not-allowed select-none py-1.5 text-[#0F1729]",
                              sidebarCollapsed ? "px-0 justify-center h-10 w-10 mx-auto" : "px-4"
                            )}
                            title={`${item.name} (Unavailable)`}
                          >
                            <div className={cn(
                              "flex items-center transition-all duration-200",
                              sidebarCollapsed ? "justify-center" : "w-full"
                            )}>
                              <div className="w-6 h-6 flex flex-shrink-0 items-center justify-center">
                                <item.icon className="w-5 h-5 text-[#0F1729]/70" strokeWidth={2.2} />
                              </div>
                              <div className={cn(
                                "flex items-center justify-between flex-1 transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left",
                                sidebarCollapsed ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0" : "opacity-100 scale-100 translate-x-0 ml-4"
                              )}>
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate whitespace-nowrap">{item.name}</span>
                                  {item.inDevelopment && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 whitespace-nowrap">
                                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                      In Dev
                                    </span>
                                  )}
                                </div>
                                <ChevronDown className="w-4 h-4 transition-transform duration-200 opacity-60 shrink-0" />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={item.name}>
                        {/* Dropdown Header */}
                        <button
                          onClick={() => toggleDropdown(item.name)}
                          className={cn(
                            "w-full flex items-center rounded-full text-[14px] font-medium transition-all duration-200 group overflow-hidden py-1.5",
                            sidebarCollapsed ? "px-0 justify-center h-10 w-10 mx-auto" : "px-4",
                            hasActiveChild ? "text-[#0F1729]" : "text-[#0F1729] hover:bg-white/80"
                          )}
                          style={{
                            backgroundColor: hasActiveChild && !sidebarCollapsed ? 'rgba(var(--theme-primary-rgb), 0.1)' : 'transparent',
                          }}
                          title={sidebarCollapsed ? item.name : undefined}
                        >
                          <div className={cn(
                            "flex items-center transition-all duration-200",
                            sidebarCollapsed ? "justify-center" : "w-full"
                          )}>
                            <div className="w-6 h-6 flex flex-shrink-0 items-center justify-center">
                              <item.icon className={cn(
                                "w-5 h-5 transition-colors duration-200",
                                hasActiveChild ? "text-[#0F1729]" : "text-[#0F1729]/70 group-hover:text-[#0F1729]"
                              )} strokeWidth={2.2} />
                            </div>
                            <div className={cn(
                              "flex items-center justify-between flex-1 transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left",
                              sidebarCollapsed ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0" : "opacity-100 scale-100 translate-x-0 ml-4"
                            )}>
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate whitespace-nowrap">{item.name}</span>
                                {item.inDevelopment && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 whitespace-nowrap">
                                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                    In Dev
                                  </span>
                                )}
                              </div>
                              <ChevronDown className={cn(
                                "w-4 h-4 transition-transform duration-200 opacity-60 shrink-0",
                                isOpen && "transform rotate-180"
                              )} />
                            </div>
                          </div>
                        </button>
                        
                        {/* Dropdown Children */}
                        {isOpen && !sidebarCollapsed && (
                          <div className="mt-0.5 space-y-0.5 pl-4 animate-in fade-in slide-in-from-top-1 duration-200 border-l border-slate-100 ml-7">
                            {item.children.map((child) => {
                              const isActive = !child.disabled && (location.pathname === child.href || location.pathname.startsWith(child.href));
                              
                              const childContent = (
                                <>
                                  <child.icon className={cn(
                                    "w-4 h-4 flex-shrink-0",
                                    isActive ? "text-white" : "text-[#0F1729]/60"
                                  )} strokeWidth={2.2} />
                                  <span className="flex-1 min-w-0 truncate">{child.name}</span>
                                  {child.inDevelopment && (
                                    <span
                                      className={cn(
                                        "ml-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase whitespace-nowrap",
                                        isActive
                                          ? "bg-white/20 text-white/90"
                                          : "bg-amber-100 text-amber-700"
                                      )}
                                    >
                                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                      In Dev
                                    </span>
                                  )}
                                </>
                              );

                              if (child.disabled) {
                                return (
                                  <div
                                    key={child.name}
                                    className="flex items-center gap-3 rounded-full text-[13px] font-medium px-4 py-1.5 opacity-40 cursor-not-allowed select-none text-[#0F1729]"
                                    title={`${child.name} (Unavailable)`}
                                  >
                                    {childContent}
                                  </div>
                                );
                              }

                              return (
                                <Link
                                  key={child.name}
                                  to={child.href}
                                  className={cn(
                                    "flex items-center gap-3 rounded-full text-[13px] font-medium transition-all duration-200 px-4 py-1.5"
                                  )}
                                  style={{
                                    backgroundColor: isActive ? 'var(--theme-primary)' : 'transparent',
                                    color: isActive ? "white" : "#0F1729",
                                  }}
                                  onClick={() => setSidebarOpen(false)}
                                >
                                  {childContent}
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }
                  
                  // Regular navigation item
                  const isActive = !item.disabled && (location.pathname === item.href || 
                    (item.href && item.href !== "/admin" && location.pathname.startsWith(item.href)));
                  
                  const regularContent = (
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
                  );

                  if (item.disabled) {
                    return (
                      <div
                        key={item.name}
                        className={cn(
                          "flex items-center rounded-full text-[14px] font-medium opacity-40 cursor-not-allowed select-none py-1.5 text-[#0F1729]",
                          sidebarCollapsed ? "px-0 justify-center h-10 w-10 mx-auto" : "px-4"
                        )}
                        title={`${item.name} (Unavailable)`}
                      >
                        {regularContent}
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.name}
                      to={item.href!}
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
                      {regularContent}
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
                <p className="text-[10px] font-bold text-[#0F1729]/50 truncate uppercase tracking-tight">Admin</p>
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
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Admin Portal</span>
                <span className="text-base font-bold text-slate-900 -mt-1">
                  {getCurrentPageTitle()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* School Year Badge */}
              {currentSchoolYear && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold tracking-wider px-2 py-1 rounded-lg bg-slate-100 text-slate-600">
                  S.Y. {currentSchoolYear}
                </span>
              )}
              {/* Dev Portal Quick Switcher */}
              <DevPortalSwitcher user={user} />

              {/* User Avatar and Name */}
              <div className="flex items-center gap-3 pl-3 border-l border-slate-100">
                <div className="hidden sm:flex flex-col items-end mr-1">
                  <span className="text-sm font-bold text-slate-900 leading-none">
                    {user.firstName || user.username}
                  </span>
                  <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md mt-1">
                    Online
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
