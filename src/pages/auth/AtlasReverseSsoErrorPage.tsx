import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plainAtlasReverseSsoMessage } from "@/lib/ssoMessages";

/**
 * ATLAS -> SMART reverse SSO error page.
 * Reads only the stable error code; never renders raw codes, secrets, or URLs.
 */
export default function AtlasReverseSsoErrorPage() {
  const code = useMemo(() => new URLSearchParams(window.location.search).get("code"), []);
  const message = plainAtlasReverseSsoMessage(code);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-destructive" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Could not sign in with ATLAS</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={() => window.location.assign("/auth/atlas/start")}>Try again from ATLAS</Button>
          <Button variant="outline" onClick={() => window.location.assign("/login/admin")}>
            Go to admin sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
