import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plainAtlasSsoMessage } from "@/lib/ssoMessages";

interface AuthorizeRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
}

/**
 * SMART -> ATLAS admin-only SSO entry page.
 *
 * ATLAS redirects the browser here with response_type/client_id/redirect_uri/
 * state. This page confirms an active SMART ADMIN session, asks the backend for
 * a one-time code, and hands the browser back to ATLAS. No code is ever
 * exchanged in the browser.
 */
function pickAdminSession(): string | null {
  const token = sessionStorage.getItem("token_admin");
  const rawUser = sessionStorage.getItem("user_admin");
  if (!token || !rawUser) return null;

  try {
    const user = JSON.parse(rawUser);
    return user?.role === "ADMIN" ? token : null;
  } catch {
    return null;
  }
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

export default function AtlasAuthorizePage() {
  const startedRef = useRef(false);
  const [authorizeRequest] = useState(readAuthorizeRequest);
  const [error, setError] = useState<string | null>(null);
  const [returnUrl] = useState(() => `${window.location.pathname}${window.location.search}`);

  useEffect(() => {
    if (startedRef.current || !authorizeRequest) return;
    startedRef.current = true;

    const token = pickAdminSession();
    if (!token) {
      // Resume the authorize request after admin sign-in.
      window.location.replace(`/login/admin?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }

    axios
      .post("/api/auth/atlas/authorize", authorizeRequest, {
        headers: { Authorization: `Bearer ${token}` },
        withCredentials: true,
      })
      .then((response) => {
        if (response.data?.redirectUrl) {
          window.location.assign(response.data.redirectUrl);
        } else {
          setError(plainAtlasSsoMessage("COMPANION_REVERSE_SSO_NOT_CONFIGURED"));
        }
      })
      .catch((err) => {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const code = axios.isAxiosError(err) ? err.response?.data?.code : null;

        // Expired/missing SMART session: sign in first, then resume.
        // A role denial is a real authorization result, so show it instead.
        if (status === 401 || (status === 403 && code !== "COMPANION_REVERSE_SSO_ROLE_DENIED")) {
          window.location.replace(`/login/admin?returnUrl=${encodeURIComponent(returnUrl)}`);
          return;
        }

        setError(plainAtlasSsoMessage(typeof code === "string" ? code : "COMPANION_SSO_UNREACHABLE"));
      });
  }, [authorizeRequest, returnUrl]);

  const displayError = error
    ?? (authorizeRequest ? null : plainAtlasSsoMessage("COMPANION_REVERSE_SSO_CALLBACK_INVALID"));

  if (displayError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Could not open ATLAS</h1>
          <p className="text-sm text-muted-foreground">{displayError}</p>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => window.location.assign("/admin")}>Back to SMART admin</Button>
            <Button variant="outline" onClick={() => window.location.assign("/login/admin")}>
              Go to admin sign in
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
        <p className="text-sm font-medium text-muted-foreground">Opening ATLAS...</p>
      </div>
    </div>
  );
}
