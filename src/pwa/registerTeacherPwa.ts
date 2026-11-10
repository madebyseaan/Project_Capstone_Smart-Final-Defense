import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

let started = false;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;

export function registerTeacherPwa(): void {
  if (started) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  started = true;

  // Dev has no generated service worker; registration would only log errors.
  if (!import.meta.env.PROD) return;

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast("A new version of SMART is available.", {
        id: "pwa-update",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            void updateServiceWorker?.(true);
          },
        },
      });
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      window.setInterval(() => {
        void registration.update();
      }, 60 * 60 * 1000);
    },
    onRegisterError(error) {
      console.error("[pwa] Service worker registration failed", error);
    },
  });
}
