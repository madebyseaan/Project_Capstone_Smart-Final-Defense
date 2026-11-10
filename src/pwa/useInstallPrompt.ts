import { useCallback, useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type InstallState = "installed" | "available" | "ios" | "dismissed" | "unsupported";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOs = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
  return /iPad|iPhone|iPod/.test(ua) || iPadOs;
}

export function useInstallPrompt() {
  const [state, setState] = useState<InstallState>(() => {
    if (isStandalone()) return "installed";
    if (isIos()) return "ios";
    return "unsupported";
  });
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as BeforeInstallPromptEvent;
      setState("available");
    };

    const handleInstalled = () => {
      promptRef.current = null;
      setState("installed");
    };

    const displayMode = window.matchMedia("(display-mode: standalone)");
    const handleDisplayMode = () => {
      if (displayMode.matches) setState("installed");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    displayMode.addEventListener("change", handleDisplayMode);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
      displayMode.removeEventListener("change", handleDisplayMode);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const promptEvent = promptRef.current;
    if (!promptEvent) return;
    promptRef.current = null;

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setState(choice.outcome === "accepted" ? "installed" : "dismissed");
    } catch {
      setState("dismissed");
    }
  }, []);

  return {
    state,
    promptInstall,
    isStandalone: isStandalone(),
  };
}
