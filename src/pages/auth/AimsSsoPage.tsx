import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plainAimsSsoMessage } from "@/lib/ssoMessages";

type Portal = "admin" | "teacher" | "registrar";

interface AimsIdentity {
  id: string | null;
  role: string;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  lrn: string | null;
}

interface AimsExchangeResponse {
  success: true;
  token: string;
  refreshToken?: string;
  user: {
    id: string;
    username: string;
    role: "TEACHER" | "ADMIN" | "REGISTRAR";
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  };
  redirectTo: string;
}

interface AimsErrorResponse {
  success: false;
  code: string;
  error: string;
  identity?: AimsIdentity;
}

function portalForRole(role: string): Portal | null {
  if (role === "ADMIN") return "admin";
  if (role === "TEACHER") return "teacher";
  if (role === "REGISTRAR") return "registrar";
  return null;
}

function defaultDestination(portal: Portal): string {
  if (portal === "admin") return "/admin";
  if (portal === "registrar") return "/registrar";
  return "/teacher";
}

function safeRedirect(value: unknown, portal: Portal): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return defaultDestination(portal);
}

export default function AimsSsoPage() {
  const startedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [identity, setIdentity] = useState<AimsIdentity | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const signInCode = new URLSearchParams(window.location.search).get("code");
    if (!signInCode) {
      setLoading(false);
      setCode("INVALID_CODE");
      setMessage(plainAimsSsoMessage("INVALID_CODE"));
      return;
    }

    (async () => {
      try {
        const response = await axios.post<AimsExchangeResponse>(
          "/api/auth/aims/exchange",
          { code: signInCode },
        );
        const { user, token, refreshToken, redirectTo } = response.data;
        const portal = portalForRole(user.role);

        if (!portal) {
          setLoading(false);
          setCode("AIMS_ROLE_UNSUPPORTED");
          setMessage(plainAimsSsoMessage("AIMS_ROLE_UNSUPPORTED"));
          return;
        }

        const existingRaw = sessionStorage.getItem(`user_${portal}`);
        if (existingRaw) {
          try {
            const existing = JSON.parse(existingRaw) as { id?: string };
            if (existing?.id && existing.id !== user.id) {
              setLoading(false);
              setCode("ACCOUNT_SWITCH_BLOCKED");
              setMessage("A different user is already signed in to this SMART portal. Sign out of that portal first, then start again from AIMS.");
              return;
            }
          } catch {
            // Ignore malformed legacy storage and replace it below.
          }
        }

        sessionStorage.setItem(`user_${portal}`, JSON.stringify(user));
        sessionStorage.setItem(`token_${portal}`, token);
        if (refreshToken) {
          sessionStorage.setItem(`refreshToken_${portal}`, refreshToken);
        }
        sessionStorage.setItem("user", JSON.stringify(user));
        sessionStorage.setItem("token", token);
        localStorage.setItem("smart_active_portal", portal);

        window.history.replaceState({}, "", "/sso/aims");
        window.location.replace(safeRedirect(redirectTo, portal));
      } catch (err) {
        const data = axios.isAxiosError(err)
          ? (err.response?.data as AimsErrorResponse | undefined)
          : undefined;
        const stableCode = typeof data?.code === "string" ? data.code : "AIMS_EXCHANGE_FAILED";
        setLoading(false);
        setCode(stableCode);
        setMessage(plainAimsSsoMessage(stableCode));
        setIdentity(data?.identity ?? null);
        window.history.replaceState({}, "", "/sso/aims");
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Completing AIMS sign-in...</p>
        </div>
      </div>
    );
  }

  const isNotProvisioned = code === "AIMS_ACCOUNT_NOT_PROVISIONED";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-destructive" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">
          {isNotProvisioned ? "SMART account not linked" : "Could not sign in with AIMS"}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>

        {identity && (
          <dl className="mx-auto grid w-full max-w-sm grid-cols-[auto,1fr] gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/30 p-4 text-left text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="text-foreground">
              {[identity.firstName, identity.lastName].filter(Boolean).join(" ") || "—"}
            </dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd className="text-foreground">{identity.role}</dd>
            {identity.username && (
              <>
                <dt className="text-muted-foreground">Username</dt>
                <dd className="text-foreground">{identity.username}</dd>
              </>
            )}
            {identity.lrn && (
              <>
                <dt className="text-muted-foreground">LRN</dt>
                <dd className="text-foreground">{identity.lrn}</dd>
              </>
            )}
          </dl>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={() => window.location.assign("/login")}>Go to SMART sign in</Button>
        </div>
      </div>
    </div>
  );
}
