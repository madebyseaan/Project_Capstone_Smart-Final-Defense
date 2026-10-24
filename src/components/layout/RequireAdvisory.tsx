import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useHasAdvisory } from "@/hooks/useHasAdvisory";

export default function RequireAdvisory({ children }: { children: ReactNode }) {
  const hasAdvisory = useHasAdvisory();

  if (hasAdvisory === false) {
    return <Navigate to="/teacher" replace />;
  }

  return <>{children}</>;
}
