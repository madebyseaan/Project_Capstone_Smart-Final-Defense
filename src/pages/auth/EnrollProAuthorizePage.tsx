import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plainSsoMessage } from "@/lib/ssoMessages";

type Portal = "admin" | "teacher" | "registrar";

const PORTALS: Portal[] = ["admin", "teacher", "registrar"];

interface AuthorizeRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
}

/**
 * Flow B entry page (SMART launching EnrollPro).
 *
 * EnrollPro redirects the browser here with response_type/client_id/
 * redirect_uri/state. This SPA route confirms the local SMART session
 * (waiting for auth state — never bouncing to /login prematurely), asks the
 * backend for a one-time code, and hands the browser back to EnrollPro.
 */
function pickActiveSession(): string | null {
  const hint = localStorage.getItem("smart_active_portal");
  const ordered = hint && PORTALS.includes(hint as Portal)
    ? [hint as Portal, ...PORTALS.filter((portal) => portal !== hint)]
    : PORTALS;

  for (const portal of ordered) {
    const token = sessionStorage.getItem(`token_${portal}`);
    const user = sessionStorage.getItem(`user_${portal}`);
    if (token && user) return token;
  }
  return null;
}

function readAuthorizeRequest(): AuthorizeRequest | null {
  const params = new URLSearchParams(window.location.search);
  const request: AuthorizeRequest = {
    responseType: params.get("response_type") ?? "",
    clientId: params.get("client_id") ?? "",
    redirectUri: params.get("redirect_uri") ?? "",
    state: params.get("state") ?? "",
  };
  if (!request.responseType || !request.clientId || !request.redirectUri || !request.state) {
    return null;
  }
  return request;
}

export default function EnrollProAuthorizePage() {
  const startedRef = useRef(false);
  const [authorizeRequest] = useState(readAuthorizeRequest);
  const [error, setError] = useState<string | null>(null);
  const [returnUrl] = useState(() => `${window.location.pathname}${window.location.search}`);

  useEffect(() => {
    if (startedRef.current || !authorizeRequest) return;
    startedRef.current = true;

    const token = pickActiveSession();
    if (!token) {
      // Resume the authorize request after login (preserve the full authorize URL).
      window.location.replace(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }

    axios
      .post("/api/auth/sso/authorize", authorizeRequest, {
        headers: { Authorization: `Bearer ${token}` },
        withCredentials: true,
      })
      .then((response) => {
        if (response.data?.redirectUrl) {
          window.location.assign(response.data.redirectUrl);
        } else {
          setError(plainSsoMessage("COMPANION_REVERSE_SSO_NOT_CONFIGURED"));
        }
      })
      .catch((err) => {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        // Expired/missing SMART session: sign in first, then resume this request.
        if (status === 401 || status === 403) {
          window.location.replace(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
          return;
        }
        const code = axios.isAxiosError(err) ? err.response?.data?.code : null;
        setError(plainSsoMessage(typeof code === "string" ? code : "COMPANION_REVERSE_SSO_NOT_CONFIGURED"));
      });
  }, [authorizeRequest, returnUrl]);

  const displayError = error
    ?? (authorizeRequest ? null : plainSsoMessage("COMPANION_REVERSE_SSO_CALLBACK_INVALID"));

  if (displayError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Could not open EnrollPro</h1>
          <p className="text-sm text-muted-foreground">{displayError}</p>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => window.location.reload()}>Try again</Button>
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
        <p className="text-sm font-medium text-muted-foreground">Opening EnrollPro...</p>
      </div>
    </div>
  );
}
