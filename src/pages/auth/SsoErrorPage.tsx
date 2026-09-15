import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { plainSsoMessage } from "@/lib/ssoMessages";

/**
 * Flow A failure page.
 * Shows a plain retry message and sends the user back to EnrollPro.
 * The stable error code is stripped from the address bar on mount.
 */
export default function SsoErrorPage() {
  const { enrollproPublicUrl } = useTheme();
  const [code] = useState(() => new URLSearchParams(window.location.search).get("code") ?? "");

  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-destructive" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Sign-in could not be completed</h1>
        <p className="text-sm text-muted-foreground">{plainSsoMessage(code)}</p>
        <div className="flex flex-col gap-2 pt-2">
          <Button
            onClick={() =>
              window.location.assign(`${enrollproPublicUrl.replace(/\/+$/, "")}/personnel/login`)
            }
          >
            Return to EnrollPro
          </Button>
          <Button variant="outline" onClick={() => window.location.assign("/login")}>
            Go to SMART login
          </Button>
        </div>
      </div>
    </div>
  );
}
