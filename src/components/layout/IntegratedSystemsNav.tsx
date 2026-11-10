import { useState } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";

const COMPANIONS = [
  { key: "AIMS", label: "AIMS", description: "Academic interventions", icon: FlaskConical },
  { key: "SMART", label: "SMART", description: "Grades and attendance", icon: CheckCircle2 },
  { key: "ATLAS", label: "ATLAS", description: "Teaching loads and schedules", icon: CalendarClock },
  { key: "MRF", label: "MRF", description: "Maintenance requests", icon: Wrench },
];

type Portal = "admin" | "teacher" | "registrar";

interface IntegratedSystemsNavProps {
  collapsed: boolean;
  portal: Portal;
}

/**
 * Integrated Systems sidebar group.
 *
 * EnrollPro is the hub for the EnrollPro reverse flow. ATLAS is a direct,
 * admin-only SMART -> ATLAS launch: only the SMART admin portal enables it,
 * and the click starts ATLAS's SSO start endpoint. Direct links to AIMS and
 * MRF stay disabled until federation exists.
 */
export default function IntegratedSystemsNav({ collapsed, portal }: IntegratedSystemsNavProps) {
  const { enrollproPublicUrl, atlasSsoStartUrl } = useTheme();
  const [launchingKey, setLaunchingKey] = useState<string | null>(null);

  const enrollproStartUrl = `${enrollproPublicUrl.replace(/\/+$/, "")}/api/auth/companion-sso/smart/reverse/start`;
  const atlasEnabled = portal === "admin" && Boolean(atlasSsoStartUrl);

  const handleOpenEnrollPro = () => {
    if (launchingKey) return;
    setLaunchingKey("enrollpro");
    window.location.assign(enrollproStartUrl);
  };

  const handleOpenAtlas = () => {
    if (launchingKey || !atlasSsoStartUrl) return;
    setLaunchingKey("ATLAS");
    window.location.assign(atlasSsoStartUrl);
  };

  return (
    <div className={collapsed ? "border-t border-border/60 mt-1" : "mb-5"}>
      {!collapsed && (
        <span className="px-4 mb-1 text-[0.625rem] font-bold text-[#0F1729]/60 uppercase tracking-normal block whitespace-nowrap">
          Integrated Systems
        </span>
      )}
      <div className="space-y-1">
        <button
          type="button"
          onClick={handleOpenEnrollPro}
          disabled={launchingKey !== null}
          aria-label="Open EnrollPro"
          title={collapsed ? "EnrollPro" : "Open EnrollPro"}
          className={cn(
            "flex items-center rounded-full text-[14px] font-medium transition-all duration-200 group overflow-hidden py-1.5 text-[#0F1729] hover:bg-white/80",
            collapsed ? "px-0 justify-center h-9 w-9 mx-auto" : "px-4 w-full",
          )}
        >
          <div className={cn("flex items-center transition-all duration-200", collapsed ? "justify-center" : "w-full")}>
            <div className="w-6 h-6 flex flex-shrink-0 items-center justify-center">
              {launchingKey === "enrollpro" ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#0F1729]/70" />
              ) : (
                <ArrowUpRight
                  className="w-5 h-5 text-[#0F1729]/70 group-hover:text-[#0F1729]"
                  strokeWidth={2.2}
                />
              )}
            </div>
            <div
              className={cn(
                "flex min-w-0 items-center gap-2 transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left",
                collapsed
                  ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0"
                  : "opacity-100 scale-100 translate-x-0 ml-4",
              )}
            >
              <div className="flex min-w-0 flex-col text-left">
                <span className="truncate whitespace-nowrap">
                  {launchingKey === "enrollpro" ? "Opening EnrollPro" : "EnrollPro"}
                </span>
                <span className="truncate whitespace-nowrap text-[10px] font-normal text-[#0F1729]/50">
                  School management hub
                </span>
              </div>
            </div>
          </div>
        </button>

        {COMPANIONS.map((system) => {
          const isCurrent = system.key === "SMART";
          const isAtlas = system.key === "ATLAS";
          const isLaunching = launchingKey === system.key;
          const enabled = isAtlas && atlasEnabled;

          const statusText = isCurrent
            ? "Current system"
            : isAtlas
              ? portal !== "admin"
                ? "Admin only"
                : atlasSsoStartUrl
                  ? (isLaunching ? "Starting secure sign-in" : "Open ATLAS")
                  : "ATLAS SSO is not configured"
              : "Unavailable until federation";

          const content = (
            <div className={cn("flex items-center transition-all duration-200", collapsed ? "justify-center" : "w-full")}>
              <div className="w-6 h-6 flex flex-shrink-0 items-center justify-center">
                {isLaunching ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#0F1729]/70" />
                ) : (
                  <system.icon className="w-5 h-5 text-[#0F1729]/70" strokeWidth={2.2} />
                )}
              </div>
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2 transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left",
                  collapsed
                    ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0"
                    : "opacity-100 scale-100 translate-x-0 ml-4",
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate whitespace-nowrap">
                    {isLaunching ? `Opening ${system.label}` : system.label}
                  </span>
                  <span className="truncate whitespace-nowrap text-[10px] font-normal text-[#0F1729]/50">
                    {statusText}
                  </span>
                </div>
              </div>
            </div>
          );

          if (enabled) {
            return (
              <button
                key={system.key}
                type="button"
                onClick={handleOpenAtlas}
                disabled={launchingKey !== null}
                aria-label="Open ATLAS"
                title={collapsed ? "ATLAS" : "Open ATLAS"}
                className={cn(
                  "flex items-center rounded-full text-[14px] font-medium transition-all duration-200 group overflow-hidden py-1.5 text-[#0F1729] hover:bg-white/80",
                  collapsed ? "px-0 justify-center h-9 w-9 mx-auto" : "px-4 w-full",
                )}
              >
                {content}
              </button>
            );
          }

          return (
            <div
              key={system.key}
              aria-label={`${system.label} - ${statusText}`}
              title={statusText}
              className={cn(
                "flex items-center rounded-full text-[14px] font-medium select-none py-1.5 text-[#0F1729]",
                collapsed ? "px-0 justify-center h-9 w-9 mx-auto" : "px-4",
                isCurrent ? "" : "opacity-40 cursor-not-allowed",
              )}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
