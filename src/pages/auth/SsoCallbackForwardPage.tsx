import { useEffect } from "react";
import { Loader2 } from "lucide-react";

/**
 * Compatibility shim for EnrollPro deployments that registered the SMART
 * callback without the /api prefix. Forwards the browser (one-time code and
 * state intact) to the canonical server callback, which performs the exchange.
 */
export default function SsoCallbackForwardPage() {
  useEffect(() => {
    window.location.replace(`/api/auth/enrollpro/callback${window.location.search}`);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  );
}
