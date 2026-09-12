import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageErrorProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: ReactNode;
}

/**
 * Canonical page-level error block — centered h-64 destructive tile with an
 * optional retry action. Mirrors the registrar error pattern.
 */
export function PageError({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try Again",
  icon,
}: PageErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
        {icon ?? <AlertTriangle className="w-8 h-8 text-destructive" />}
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">{title}</h2>
      <p className="text-muted-foreground mb-4">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
