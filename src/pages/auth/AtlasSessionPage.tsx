import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plainAtlasReverseSsoMessage } from "@/lib/ssoMessages";

/**
 * ATLAS -> SMART reverse SSO completion page.
 *
 * The server callback already exchanged the ATLAS code and set a SMART access
 * cookie. This page bootstraps the admin session storage and lands on /admin.
 * No code ever appears in this URL.
 */
export default function AtlasSessionPage() {
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const response = await axios.post("/api/auth/atlas/session", {}, { withCredentials: true });
        const { token, refreshToken, user } = response.data;

        if (user?.role !== "ADMIN") {
          setError(plainAtlasReverseSsoMessage("COMPANION_REVERSE_SSO_ROLE_DENIED"));
          return;
        }

        sessionStorage.setItem("user_admin", JSON.stringify(user));
        sessionStorage.setItem("token_admin", token);
        if (refreshToken) {
          sessionStorage.setItem("refreshToken_admin", refreshToken);
        }
        // Legacy keys (backward compatibility with existing layouts/guards)
        sessionStorage.setItem("user", JSON.stringify(user));
        sessionStorage.setItem("token", token);
        localStorage.setItem("smart_active_portal", "admin");

        window.location.replace("/admin");
      } catch (err) {
        const code = axios.isAxiosError(err) ? err.response?.data?.code : null;
        setError(plainAtlasReverseSsoMessage(typeof code === "string" ? code : "COMPANION_REVERSE_SSO_UNAVAILABLE"));
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Sign-in could not be completed</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => window.location.assign("/login/admin")}>Go to admin sign in</Button>
            <Button variant="outline" onClick={() => window.location.assign("/auth/atlas/start")}>
              Try again from ATLAS
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">Completing ATLAS sign-in...</p>
      </div>
    </div>
  );
}
