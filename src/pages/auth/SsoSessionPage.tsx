import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { plainSsoMessage } from "@/lib/ssoMessages";

type Portal = "admin" | "teacher" | "registrar";

function portalForRole(role: string): Portal {
  if (role === "ADMIN") return "admin";
  if (role === "REGISTRAR") return "registrar";
  return "teacher";
}

function destinationForPortal(portal: Portal): string {
  if (portal === "admin") return "/admin";
  if (portal === "registrar") return "/registrar";
  return "/teacher";
}

/**
 * Flow A completion page (EnrollPro launcher).
 *
 * The server callback already exchanged the one-time code and set a SMART
 * access cookie. This page bootstraps the role-specific session storage and
 * lands the user on their SMART workspace. No code ever appears in this URL.
 */
export default function SsoSessionPage() {
  const { enrollproPublicUrl } = useTheme();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const response = await axios.post(
          "/api/auth/enrollpro/session",
          {},
          { withCredentials: true },
        );
        const { token, refreshToken, user } = response.data;
        const portal = portalForRole(user.role);

        sessionStorage.setItem(`user_${portal}`, JSON.stringify(user));
        sessionStorage.setItem(`token_${portal}`, token);
        if (refreshToken) {
          sessionStorage.setItem(`refreshToken_${portal}`, refreshToken);
        }
        // Legacy keys (backward compatibility with existing layouts/guards)
        sessionStorage.setItem("user", JSON.stringify(user));
        sessionStorage.setItem("token", token);
        localStorage.setItem("smart_active_portal", portal);

        window.location.replace(destinationForPortal(portal));
      } catch (err) {
        const code = axios.isAxiosError(err) ? err.response?.data?.code : null;
        setError(plainSsoMessage(typeof code === "string" ? code : "COMPANION_SSO_UNREACHABLE"));
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Sign-in could not be completed</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => window.location.assign(`${enrollproPublicUrl.replace(/\/+$/, "")}/personnel/login`)}>
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">Setting up your SMART session...</p>
      </div>
    </div>
  );
}
