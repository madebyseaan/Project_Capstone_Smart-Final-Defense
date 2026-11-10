import { useEffect, useState } from "react";

export type OnlineStatus = "online" | "offline" | "checking";

async function probeHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/health", {
      signal: controller.signal,
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function useOnlineStatus(): { status: OnlineStatus } {
  const [status, setStatus] = useState<OnlineStatus>(() =>
    navigator.onLine ? "online" : "offline",
  );

  useEffect(() => {
    let active = true;
    let probeTimer: number | null = null;

    const refresh = async () => {
      setStatus("checking");
      const ok = await probeHealth();
      if (active) setStatus(ok ? "online" : "offline");
    };

    const scheduleRefresh = () => {
      if (probeTimer !== null) window.clearTimeout(probeTimer);
      probeTimer = window.setTimeout(() => {
        void refresh();
      }, 250);
    };

    const handleOnline = () => scheduleRefresh();
    const handleOffline = () => setStatus("offline");

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    scheduleRefresh();

    return () => {
      active = false;
      if (probeTimer !== null) window.clearTimeout(probeTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { status };
}
