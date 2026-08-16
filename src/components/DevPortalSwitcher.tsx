import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Terminal, Shield, GraduationCap, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface DevPortalSwitcherProps {
  user?: {
    username?: string;
    isDeveloper?: boolean;
    role?: string;
  } | null;
  className?: string;
}

export default function DevPortalSwitcher({ user, className }: DevPortalSwitcherProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isDev = Boolean(
    user?.isDeveloper ||
    user?.username === "999999" ||
    user?.role === "DEVELOPER"
  );

  if (!isDev) return null;

  const currentPath = location.pathname;
  const isTeacher = currentPath.startsWith("/teacher");
  const isAdmin = currentPath.startsWith("/admin");
  const isRegistrar = currentPath.startsWith("/registrar");

  const portals = [
    {
      name: "Teacher",
      path: "/teacher",
      active: isTeacher,
      icon: GraduationCap,
      color: "text-emerald-700 bg-emerald-100 hover:bg-emerald-200 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700",
      activeColor: "bg-emerald-600 text-white shadow-sm border-emerald-600 dark:bg-emerald-600 dark:text-white",
    },
    {
      name: "Admin",
      path: "/admin",
      active: isAdmin,
      icon: Shield,
      color: "text-purple-700 bg-purple-100 hover:bg-purple-200 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-700",
      activeColor: "bg-purple-600 text-white shadow-sm border-purple-600 dark:bg-purple-600 dark:text-white",
    },
    {
      name: "Registrar",
      path: "/registrar",
      active: isRegistrar,
      icon: Users,
      color: "text-amber-700 bg-amber-100 hover:bg-amber-200 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700",
      activeColor: "bg-amber-600 text-white shadow-sm border-amber-600 dark:bg-amber-600 dark:text-white",
    },
  ];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-900/90 text-white text-xs shadow-md border border-slate-700 backdrop-blur-md transition-all",
        className
      )}
      title="Developer Mode: Switch between Teacher, Admin, and Registrar portals instantly"
    >
      <div className="flex items-center gap-1 pl-1 pr-1.5 text-amber-400 font-semibold text-[11px] tracking-wide border-r border-slate-700">
        <Terminal className="w-3.5 h-3.5 animate-pulse text-amber-400" />
        <span className="hidden sm:inline">DEV</span>
      </div>

      <div className="flex items-center gap-1">
        {portals.map((portal) => {
          const Icon = portal.icon;
          return (
            <button
              key={portal.name}
              onClick={() => {
                if (!portal.active) {
                  navigate(portal.path);
                }
              }}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full font-medium text-[11px] transition-all duration-150 border",
                portal.active
                  ? portal.activeColor
                  : "text-slate-300 hover:text-white hover:bg-slate-800 border-transparent"
              )}
            >
              <Icon className="w-3 h-3" />
              <span>{portal.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
