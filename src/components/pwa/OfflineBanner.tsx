import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/pwa/useOnlineStatus";

export default function OfflineBanner() {
  const { status } = useOnlineStatus();

  if (status !== "offline") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 flex items-center justify-center gap-2 border-b border-border bg-muted/80 px-3 py-2 text-xs font-medium text-muted-foreground backdrop-blur lg:top-[calc(env(safe-area-inset-top)+4rem)]"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>You are offline. School data will load when the connection returns.</span>
    </div>
  );
}
