import { useEffect, useState } from "react";
import {
  CloudDownload,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SyncProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  status: "idle" | "syncing" | "success" | "error";
  errorMessage?: string;
  stats?: { updated?: number; created?: number };
}

const steps = [
  "Connecting to EnrollPro API",
  "Synchronizing learner data",
  "Finalizing records",
];

export function SyncProgressModal({
  isOpen,
  onClose,
  title = "Syncing with EnrollPro",
  subtitle = "Fetching the latest learner and section records...",
  status,
  errorMessage,
  stats,
}: SyncProgressModalProps) {
  const [activeStep, setActiveStep] = useState(0);

  // Advance steps during syncing
  useEffect(() => {
    if (status !== "syncing") return;
    setActiveStep(0);
    const t1 = setTimeout(() => setActiveStep(1), 1200);
    const t2 = setTimeout(() => setActiveStep(2), 2800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [status]);

  // Auto-dismiss on success
  useEffect(() => {
    if (status !== "success") return;
    const t = setTimeout(() => onClose(), 1200);
    return () => clearTimeout(t);
  }, [status, onClose]);

  // Reset step on open
  useEffect(() => {
    if (isOpen) setActiveStep(0);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 backdrop-blur-sm bg-black/40 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0"
        )}
        onClick={status !== "syncing" ? onClose : undefined}
      />

      {/* Modal */}
      <div
        className={cn(
          "relative z-10 w-full max-w-sm mx-4 bg-card rounded-2xl border border-border/50 shadow-2xl overflow-hidden transition-all duration-300",
          isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
        )}
      >
        <div className="px-6 pt-8 pb-6 flex flex-col items-center text-center">
          {/* Center Graphic */}
          <div className="relative mb-5">
            {status === "syncing" && (
              <>
                {/* Pulsing outer ring */}
                <div className="absolute inset-0 w-20 h-20 rounded-full bg-primary/20 animate-ping" />
                <div className="absolute -inset-1 w-[84px] h-[84px] rounded-full border-2 border-primary/30 animate-pulse" />
                {/* Rotating icon */}
                <div className="relative w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                  <CloudDownload className="w-8 h-8 text-primary animate-spin" />
                </div>
              </>
            )}

            {status === "success" && (
              <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center animate-in zoom-in-0 duration-500">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </div>
            )}

            {status === "error" && (
              <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center animate-in zoom-in-0 duration-300">
                <AlertTriangle className="w-10 h-10 text-destructive" />
              </div>
            )}

            {status === "idle" && (
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                <CloudDownload className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Title & Subtitle */}
          <h3 className="text-base font-semibold text-foreground mb-1">
            {status === "error" ? "Sync Failed" : status === "success" ? "Sync Complete" : title}
          </h3>
          <p className="text-sm text-muted-foreground mb-5">
            {status === "error"
              ? errorMessage || "Something went wrong while syncing."
              : status === "success"
              ? "All records are up to date."
              : subtitle}
          </p>

          {/* Stats on success */}
          {status === "success" && stats && (stats.updated || stats.created) && (
            <div className="flex items-center gap-4 mb-5 text-xs text-muted-foreground">
              {stats.updated != null && stats.updated > 0 && (
                <span><span className="font-semibold text-foreground">{stats.updated}</span> updated</span>
              )}
              {stats.created != null && stats.created > 0 && (
                <span><span className="font-semibold text-foreground">{stats.created}</span> created</span>
              )}
            </div>
          )}

          {/* Progress Step Indicators */}
          {status === "syncing" && (
            <div className="w-full space-y-2">
              {steps.map((step, i) => (
                <div
                  key={step}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all duration-300",
                    i < activeStep
                      ? "bg-emerald-50 text-emerald-700"
                      : i === activeStep
                      ? "bg-primary/5 text-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {i < activeStep ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  ) : i === activeStep ? (
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-border shrink-0" />
                  )}
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {status === "error" && (
          <div className="px-6 pb-5 flex justify-center">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
