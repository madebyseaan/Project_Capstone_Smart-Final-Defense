# SMART Teacher PWA - Build Handoff for MRF

**Status:** Implemented and verified in SMART on 2026-11-10.
**Source commit:** `3fb01a8 feat(teacher): add installable PWA and mobile UI polish`
**Audience:** MRF engineering team and/or MRF's AI coding agent.
**Purpose:** Reproduce SMART's installable, online-first PWA on the MRF codebase without re-discovering the pitfalls.

This document is self-contained. Every code block below is the actual code shipped in SMART, not a sketch. Adapt only the parts marked **ADAPT** (branding, routes, portal names, icons, health endpoint). Keep the behavior and the guardrails identical.

---

## 0. How to run this handoff

Paste this file to the MRF agent with this instruction:

> Implement the attached PWA handoff in the MRF codebase. Use MRF's own branding, routes, auth, and portal layout. Do not copy SMART student or school data. Follow the implementation order in Section 4. After implementation, run the checklist in Section 7 and report PASS/FAIL with `file:line` evidence. Do not add offline data entry or API caching.

Rules for MRF:

1. **Online-first only.** The app shell is cached. Grades, attendance, students, and all API data remain online-only. Do not add IndexedDB, background sync, or mutation queues.
2. **One portal only.** SMART scopes the service worker to `/teacher`. MRF should scope it to whichever staff portal needs installability. Never register the SW globally in `main.tsx` or an app-wide entry point if other portals must stay unaffected.
3. **Never cache `/api/*` or `/uploads/*`.** This is a hard gate, not a preference.
4. **Do not force-reload.** Updates are user-consented only.
5. **Adapt the stack, keep the contract.** If MRF does not use React + Vite, use Section 11. The manifest, scope, caching rules, update flow, and offline behavior still apply.

---

## 1. What this PWA does and does not do

### Does

- Installs on Android (Chrome/Edge) and iPhone/iPad (Safari Share menu).
- Adds an "Install app" entry in the staff sidebar.
- Caches the app shell: HTML, JS, CSS, icons, bundled fonts.
- Opens offline with a clear offline banner instead of a network error page.
- Shows a "new version available" toast; reload happens only when the user clicks it.
- Leaves the server as the only source of truth for school data.
- Is isolated to one portal. Admin/registrar (or MRF equivalent) never register the SW.

### Does not

- No offline grade entry, attendance entry, or form filling.
- No local database of students, grades, or attendance.
- No sync queue, conflict resolution, or duplicate protection.
- No API response caching.
- No "remember this device" login. SMART uses `sessionStorage`; an installed PWA may still ask for login on launch. Changing that is a separate auth decision, not part of this PWA work.
- No offline Excel, printing, or third-party integrations.

### Honest limitations

- Offline, the shell opens but no school data loads.
- If the connection drops while typing, values stay on screen, but a reload can lose them. Existing retry behavior is unchanged.
- iPhone installation is manual and less discoverable.
- PWA requires HTTPS (or `localhost`) and a production build. It will not install from `http://192.168.x.x` or the Vite dev server.
- Installing does not make the app faster on a slow connection beyond shell/asset caching.

---

## 2. Prerequisites

| Requirement | Why |
|---|---|
| HTTPS in production, or `localhost` for testing | Service workers and install prompts require a secure context. |
| Production build served by the backend | The SW and manifest are build artifacts (`dist/sw.js`, `dist/manifest.webmanifest`). |
| SPA fallback returns `index.html` for app routes | `start_url` and offline navigation must resolve. SMART does this at `server/src/index.ts:113-120`. |
| Correct MIME types | `manifest.webmanifest` must be `application/manifest+json`; `sw.js` must be JavaScript, not the SPA fallback. |
| Node/pnpm available | SMART uses pnpm; npm works too. |

SMART versions:

```json
{
  "vite": "^8.0.1",
  "vite-plugin-pwa": "^2.0.0",
  "workbox-window": "^7.4.1"
}
```

**ADAPT:** match the `vite-plugin-pwa` major to MRF's Vite major. Check the plugin's compatibility table before installing. `workbox-window` must be a direct dependency; pnpm does not hoist it for the `virtual:pwa-register` import.

---

## 3. Architecture

| Piece | Responsibility | SMART file |
|---|---|---|
| PWA plugin config | Generates `manifest.webmanifest` + `sw.js`, precaches the shell, scopes the SW | `vite.config.ts:12-62` |
| Virtual module types | Makes `virtual:pwa-register` type-safe | `src/pwa/pwa-env.d.ts:1` |
| Registration module | Registers the SW from the staff portal only, shows the update toast | `src/pwa/registerTeacherPwa.ts:1-40` |
| Install state hook | Captures `beforeinstallprompt`, handles iOS and standalone detection | `src/pwa/useInstallPrompt.ts:1-80` |
| Install button | Sidebar entry; opens native prompt or iOS instructions | `src/components/pwa/InstallAppButton.tsx:1-58` |
| iOS instructions | Share -> Add to Home Screen dialog | `src/components/pwa/IosInstallDialog.tsx:1-71` |
| Connectivity hook | `online`/`offline` events plus a `/api/health` probe | `src/pwa/useOnlineStatus.ts:1-59` |
| Offline banner | Clear "you are offline" message | `src/components/pwa/OfflineBanner.tsx:1-19` |
| Portal mount point | Registers SW and mounts install/offline UI | `src/layouts/TeacherLayout.tsx:91,305,420` |
| Apple/theme meta | iOS standalone title, status bar, theme color, touch icon | `index.html:5-11` |
| Icons | 192/512 any, 512 maskable, 180 Apple touch | `public/pwa/*` |
| Icon generator | Renders icons from the school logo with Playwright | `scripts/generate-pwa-icons.mjs:1-44` |
| Build gate | Fails the build if manifest/SW/icons/precache are wrong | `scripts/check-pwa-build.mjs:1-118` |
| Scope gate | Fails if another portal or `main.tsx` registers the SW | `scripts/check-pwa-scope.mjs:1-99` |
| E2E | Install UI, offline banner, portal isolation | `e2e/pwa.spec.ts:1-82` |

### Request flow

1. Staff member opens the portal in a browser.
2. The portal layout calls `registerTeacherPwa()`.
3. In production, `registerSW` registers `/sw.js` with scope `/teacher`.
4. Workbox precaches the hashed app shell and serves `/teacher/*` navigations from cached `index.html`.
5. `/api/*` and `/uploads/*` are denied from the navigation fallback and are never precached.
6. If a new build exists, the SW waits. `onNeedRefresh` shows a toast. Only a user click sends `SKIP_WAITING` and reloads.

---

## 4. Implementation, in order

### 4.1 Install dependencies

```bash
pnpm add -D vite-plugin-pwa workbox-window
```

If the repo is split into root + server packages, install in the frontend package only. Restart the dev server after install; Vite may hold stale module paths.

### 4.2 Configure `vite.config.ts`

This is the exact SMART config:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false,
      scope: '/teacher',
      includeAssets: ['pwa/school-logo.png', 'pwa/apple-touch-icon-180.png'],
      manifest: {
        id: '/',
        name: 'SMART',
        short_name: 'SMART',
        description: 'Student Management and Records Tracking - Teacher Portal',
        start_url: '/teacher',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111827',
        theme_color: '#111827',
        icons: [
          {
            src: 'pwa/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // ...existing server config stays unchanged
})
```

**ADAPT for MRF:**

- `scope: '/teacher'` -> the MRF portal path, e.g. `'/admin'` or `'/staff'`.
- `manifest.start_url` -> the same portal path.
- `manifest.scope` -> usually `'/'`. This is the installable app scope, not the SW scope. SMART intentionally keeps the manifest origin-wide but the SW portal-scoped.
- `id` -> `'/'` for a single app. If MRF hosts multiple apps on one origin, use a unique stable value such as `'/staff'`. Never change `id` after release; it changes app identity.
- `name`, `short_name`, `description` -> MRF branding.
- `background_color`, `theme_color` -> MRF's app shell color. Keep them equal to avoid a flash on launch.
- `navigateFallbackDenylist` -> keep `/api/` and add every backend path that must never return HTML.
- `globPatterns` -> add other bundled asset extensions if MRF uses them (e.g. `woff`, `webp`). Do not add `/api` URLs.
- `maximumFileSizeToCacheInBytes` -> 5 MB in SMART because bundles/assets can exceed Workbox's 2 MB default. Adjust only if MRF's build is smaller.

Key decisions and why:

| Setting | Value | Why |
|---|---|---|
| `strategies` | `generateSW` | No custom SW file to maintain; Workbox generates it. |
| `registerType` | `prompt` | Never force-reload while a teacher is typing. |
| `injectRegister` | `false` | Auto-injection would register on every portal. Registration is manual and portal-only. |
| `scope` | portal path | The SW only controls portal routes. Other portals are unaffected. |
| `skipWaiting` | `false` | New SW waits for user consent. |
| `clientsClaim` | `true` | First activation controls open clients without requiring every tab to close. |
| `navigateFallback` | `index.html` | SPA routes work offline. |
| `devOptions.enabled` | `false` | Dev server has no generated SW; enabling it creates confusing stale caches. Test with build + preview. |

### 4.3 Add virtual module types

Create `src/pwa/pwa-env.d.ts`:

```ts
/// <reference types="vite-plugin-pwa/client" />
```

Ensure the file is inside a directory included by `tsconfig.app.json` (SMART includes `src`). Without it, TypeScript reports `Cannot find module 'virtual:pwa-register'`.

### 4.4 Add the registration module

`src/pwa/registerTeacherPwa.ts`:

```ts
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
```

Notes:

- `started` makes registration idempotent across StrictMode double-effects and route remounts.
- `!import.meta.env.PROD` prevents dev-server registration. E2E asserts zero registrations in dev.
- `onNeedRefresh` uses a persistent toast (`duration: Infinity`). The update only applies when the user clicks Reload.
- `updateServiceWorker(true)` sends `SKIP_WAITING` and reloads after `controllerchange`, which the generated Workbox SW handles.
- Hourly `registration.update()` is enough for a school-day app; do not poll aggressively.

**ADAPT:** toast library (`sonner` in SMART) and copy.

### 4.5 Register only from the portal layout

`src/layouts/TeacherLayout.tsx` (relevant lines):

```tsx
import InstallAppButton from "@/components/pwa/InstallAppButton";
import OfflineBanner from "@/components/pwa/OfflineBanner";
import { registerTeacherPwa } from "@/pwa/registerTeacherPwa";

// inside the component
useEffect(() => {
  registerTeacherPwa();
}, []);
```

```tsx
{/* Sidebar footer, above the user profile block */}
<InstallAppButton collapsed={sidebarCollapsed} />
```

```tsx
{/* Above page content, below the header */}
<OfflineBanner />
```

Rules:

- `main.tsx`, `App.tsx`, and admin/registrar layouts must not import or call any PWA module.
- If the install entry is rendered in a mobile drawer and a collapsed sidebar, mount the same component in both places. Do not create a second implementation.
- The install entry is hidden automatically after install or dismissal; no extra cleanup is needed.

**ADAPT:** MRF layout path and sidebar structure. Keep the component behavior and placement principles.

### 4.6 Add the install state hook

`src/pwa/useInstallPrompt.ts`:

```ts
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
```

Behavior details worth preserving:

- `beforeinstallprompt` is Chromium-only. Safari never fires it; iOS is handled by the `"ios"` state and a manual instructions dialog.
- `event.preventDefault()` suppresses the browser's own mini-infobar. The app decides when to prompt.
- `userChoice` resolves `accepted` or `dismissed`. SMART hides the entry for the rest of the session after dismissal.
- Standalone detection checks both `display-mode: standalone` and iOS `navigator.standalone`.
- iPadOS reports a desktop `Macintosh` UA; `maxTouchPoints > 1` catches it.

### 4.7 Add the install button

`src/components/pwa/InstallAppButton.tsx`:

```tsx
import { useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInstallPrompt } from "@/pwa/useInstallPrompt";
import IosInstallDialog from "./IosInstallDialog";

interface InstallAppButtonProps {
  collapsed: boolean;
}

export default function InstallAppButton({ collapsed }: InstallAppButtonProps) {
  const { state, promptInstall } = useInstallPrompt();
  const [iosDialogOpen, setIosDialogOpen] = useState(false);

  if (state === "installed" || state === "dismissed" || state === "unsupported") {
    return null;
  }

  const handleClick = () => {
    if (state === "ios") {
      setIosDialogOpen(true);
      return;
    }
    void promptInstall();
  };

  return (
    <>
      <div className={cn("border-b border-border/60", collapsed ? "mb-1 pb-1" : "mb-2 pb-2")}>
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "group flex items-center rounded-full text-[14px] font-medium text-foreground transition-colors duration-200 hover:bg-muted",
            collapsed
              ? "mx-auto h-9 w-9 justify-center"
              : "min-h-12 w-full px-4 py-2 lg:min-h-0 lg:py-1.5",
          )}
          title={collapsed ? "Install app" : undefined}
          aria-label="Install app"
        >
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
            <Download
              className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground"
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </span>
          <span className={cn("whitespace-nowrap", collapsed ? "sr-only" : "ml-4")}>
            Install app
          </span>
        </button>
      </div>

      <IosInstallDialog open={iosDialogOpen} onOpenChange={setIosDialogOpen} />
    </>
  );
}
```

Accessibility requirements:

- 44-48 px tap target on mobile. The expanded variant uses `min-h-12`. SMART's collapsed variant is a 36 px button inside a padded sidebar row; if MRF does not have that surrounding padding, use at least `h-11 w-11` (44 px) for the button itself.
- `aria-label="Install app"` is required when the text is visually hidden.
- Icon-only mode must keep a `title`.
- No on-load popup, no nagging. The entry disappears after install/dismissal.

**ADAPT:** `cn` utility, icon library, dialog primitives. Keep the state logic and accessibility attributes.

### 4.8 Add the iOS instructions dialog

`src/components/pwa/IosInstallDialog.tsx`:

```tsx
import { Share, Plus, MoreHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface IosInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const steps = [
  {
    icon: Share,
    title: "Tap the Share button",
    description: "It is the square with an arrow at the bottom of Safari.",
  },
  {
    icon: MoreHorizontal,
    title: "Tap Add to Home Screen",
    description: "Scroll down in the share sheet if you do not see it.",
  },
  {
    icon: Plus,
    title: "Tap Add",
    description: "SMART will appear on your home screen like an app.",
  },
];

export default function IosInstallDialog({ open, onOpenChange }: IosInstallDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install SMART on iPhone or iPad</DialogTitle>
          <DialogDescription>
            Safari installs apps through the Share menu. This takes a few seconds.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-4">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <step.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {step.title}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Grades and attendance still need an internet connection. The installed app only opens
          faster and works without the browser bar.
        </p>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
```

The limits note is intentional. Do not imply that data works offline.

### 4.9 Add connectivity status and the offline banner

`src/pwa/useOnlineStatus.ts`:

```ts
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
```

`src/components/pwa/OfflineBanner.tsx`:

```tsx
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
```

Notes:

- `navigator.onLine` alone is unreliable (WiFi with no internet, captive portals). The probe confirms reachability.
- `cache: "no-store"` is mandatory; otherwise the probe can be served from cache and report a false positive.
- 5-second abort prevents a hanging banner state.
- 250 ms debounce absorbs the rapid online/offline event pairs some devices fire.
- Use an endpoint that is cheap and unauthenticated. **ADAPT:** if MRF has no `/api/health`, add one or probe a lightweight static endpoint with `no-store`.

Offline behavior rules:

- Show the banner; do not show stale grades or attendance.
- Disable write actions offline with an inline reason.
- If opened offline while logged out, show the login page plus the offline notice. Do not silently clear the session.

### 4.10 Update `index.html`

SMART's head:

```html
<link rel="icon" type="image/png" href="/pwa/school-logo.png" />
<link rel="apple-touch-icon" href="/pwa/apple-touch-icon-180.png" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#111827" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="SMART" />
```

- `theme-color` must match the manifest `theme_color`.
- `apple-mobile-web-app-title` is the home-screen label on iOS.
- `viewport-fit=cover` is needed if the layout uses `env(safe-area-inset-*)`.
- Do not add a manual `<link rel="manifest">`; the plugin injects it at build time.

### 4.11 Generate icons

SMART uses one source image, `public/pwa/school-logo.png`, and renders all sizes with Playwright:

```js
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// Source: replace public/pwa/school-logo.png with the current school logo, then
// run `node scripts/generate-pwa-icons.mjs` and rebuild.
const logo = fs.readFileSync("public/pwa/school-logo.png").toString("base64");
const logoUri = `data:image/png;base64,${logo}`;

const targets = [
  { file: "icon-192.png", size: 192, ratio: 0.86 },
  { file: "icon-512.png", size: 512, ratio: 0.86 },
  { file: "icon-maskable-512.png", size: 512, ratio: 0.62 },
  { file: "apple-touch-icon-180.png", size: 180, ratio: 0.8 },
];

const outDir = path.join("public", "pwa");
const browser = await chromium.launch();

try {
  for (const target of targets) {
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1,
    });
    const width = Math.round(target.size * target.ratio);
    await page.setContent(
      `<style>
        html,body{margin:0;width:${target.size}px;height:${target.size}px;overflow:hidden;background:#ffffff}
        body{display:flex;align-items:center;justify-content:center}
        img{display:block;width:${width}px;height:${width}px;object-fit:contain}
      </style><img src="${logoUri}" alt="" />`,
      { waitUntil: "load" },
    );
    await page.screenshot({
      path: path.join(outDir, target.file),
      omitBackground: false,
    });
    await page.close();
    console.log(`wrote ${target.file}`);
  }
} finally {
  await browser.close();
}
```

Icon rules:

- `192x192` and `512x512`, purpose `any`.
- One `512x512` purpose `maskable`. Keep the logo inside the central safe zone (SMART scales to 62%). Maskable icons are cropped by Android launchers.
- `180x180` Apple touch icon, linked from `index.html`.
- White background avoids transparency artifacts on some launchers.
- **ADAPT:** MRF can use any image tool. The sizes, purpose values, and safe-zone rule are the requirement, not the Playwright script.
- Installed icons are cached by the OS. After changing the logo, rebuild and reinstall the app to see the new icon.

### 4.12 Add a build gate

SMART runs `node scripts/check-pwa-build.mjs` after `vite build`, via `pnpm run check:pwa`, and `check:pwa` is part of `pnpm run verify`.

Full script (`scripts/check-pwa-build.mjs`):

```js
import fs from "node:fs";
import path from "node:path";

const failures = [];
const dist = path.resolve("dist");

function fail(message) {
  failures.push(message);
}

function readPngSize(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function resolveDistAsset(src) {
  return path.join(dist, src.replace(/^\/+/, ""));
}

if (!fs.existsSync(dist)) {
  fail("dist/ does not exist. Run the production build first.");
} else {
  const manifestPath = path.join(dist, "manifest.webmanifest");
  if (!fs.existsSync(manifestPath)) {
    fail("dist/manifest.webmanifest is missing.");
  } else {
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      fail(`dist/manifest.webmanifest is not valid JSON: ${error.message}`);
    }

    if (manifest) {
      if (manifest.name !== "SMART") fail("Manifest name must be SMART.");
      if (manifest.short_name !== "SMART") fail("Manifest short_name must be SMART.");
      if (manifest.start_url !== "/teacher") fail("Manifest start_url must be /teacher.");
      if (manifest.scope !== "/") fail("Manifest scope must be /.");
      if (manifest.display !== "standalone") fail("Manifest display must be standalone.");
      if (!Array.isArray(manifest.icons) || manifest.icons.length < 3) {
        fail("Manifest must declare at least 3 icons.");
      } else {
        for (const icon of manifest.icons) {
          const file = resolveDistAsset(icon.src);
          if (!fs.existsSync(file)) {
            fail(`Manifest icon is missing from dist: ${icon.src}`);
            continue;
          }
          const size = readPngSize(file);
          if (!size) {
            fail(`Manifest icon is not a PNG: ${icon.src}`);
            continue;
          }
          const declared = String(icon.sizes ?? "").split(/\s+/)[0];
          const expected = declared.includes("x") ? declared.split("x").map(Number) : [];
          if (expected.length !== 2 || size.width !== expected[0] || size.height !== expected[1]) {
            fail(
              `Manifest icon size mismatch: ${icon.src} declared ${icon.sizes}, actual ${size.width}x${size.height}`,
            );
          }
        }
        const maskable = manifest.icons.some((icon) =>
          String(icon.purpose ?? "").includes("maskable"),
        );
        if (!maskable) fail("Manifest must include a maskable icon.");
      }
    }
  }

  const swPath = path.join(dist, "sw.js");
  if (!fs.existsSync(swPath)) {
    fail("dist/sw.js is missing.");
  } else {
    const sw = fs.readFileSync(swPath, "utf8");

    const precacheUrls = [...sw.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
    if (precacheUrls.length === 0) {
      fail("Service worker precache manifest is empty.");
    }
    if (!precacheUrls.some((url) => url.endsWith("index.html"))) {
      fail("Service worker must precache index.html.");
    }
    const apiEntries = precacheUrls.filter(
      (url) => /^\/?api\//.test(url) || /^\/?uploads\//.test(url),
    );
    if (apiEntries.length > 0) {
      fail(`Service worker must not precache API/uploads: ${apiEntries.join(", ")}`);
    }
    if (!sw.includes("SKIP_WAITING")) {
      fail("Service worker is missing the SKIP_WAITING update handler.");
    }
  }

  const indexPath = path.join(dist, "index.html");
  if (!fs.existsSync(indexPath)) {
    fail("dist/index.html is missing.");
  } else {
    const index = fs.readFileSync(indexPath, "utf8");
    if (!index.includes('rel="manifest"')) {
      fail("dist/index.html is missing the web manifest link.");
    }
    if (!index.includes('rel="apple-touch-icon"')) {
      fail("dist/index.html is missing the Apple touch icon.");
    }
  }
}

if (failures.length > 0) {
  console.error("[check-pwa-build] FAILED");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("[check-pwa-build] OK");
```

**ADAPT:** replace the expected `name`, `short_name`, `start_url`, and portal path. Keep all structural checks. The icon dimension check reads the PNG IHDR header directly, so it needs no dependency.

### 4.13 Add a source-scope gate

SMART also runs `scripts/check-pwa-scope.mjs`, which fails if:

- `main.tsx` registers a service worker.
- Admin or registrar layouts import install/PWA components.
- The staff layout is missing the install entry, offline banner, or registration call.
- Any source outside `src/pwa` imports `virtual:pwa-register`.
- Any source calls `navigator.serviceWorker.register` directly.
- `vite.config.ts` is missing `injectRegister: false`, `devOptions`, or `scope: '/teacher'`.

**ADAPT:** replace the portal paths. Keep the same class of checks. This gate is what prevents future contributors from accidentally enabling the SW for every portal.

### 4.14 Wire scripts

`package.json`:

```json
{
  "scripts": {
    "check:pwa": "node scripts/check-pwa-build.mjs && node scripts/check-pwa-scope.mjs",
    "verify": "npm run typecheck && npm run build && npm run check:pwa && npm --prefix server run build && npm run lint && npm --prefix server test",
    "test:e2e:pwa": "playwright test e2e/pwa.spec.ts"
  }
}
```

**ADAPT:** the `verify` chain to the MRF equivalent. The PWA gate must run after the production build and before lint/tests in CI.

### 4.15 Test with a production build

The dev server does not emit a service worker (`devOptions.enabled: false`). Test like this:

```bash
pnpm run build
pnpm run preview
```

`http://localhost:4173` is a secure context, so the SW registers. For a real phone test, serve the build over HTTPS.

Playwright coverage in SMART (`e2e/pwa.spec.ts:19-82`) verifies:

- Teacher sees the install entry; a synthetic `beforeinstallprompt` makes it actionable; clicking calls `prompt()` and hides it after dismissal.
- Development registers zero service workers.
- Offline event shows the banner; online event clears it.
- Admin and registrar have no install entry.

**ADAPT:** MRF roles and login fixture. Do not skip the negative test for non-target portals; that is the isolation guarantee.

---

## 5. Update lifecycle

1. MRF deploys a new build. `sw.js` content changes because the precache manifest hash changed.
2. The hourly `registration.update()` (or the next page load) finds the new SW.
3. The new SW installs and enters `waiting` because `skipWaiting: false`.
4. `onNeedRefresh` fires; the persistent toast appears: "A new version is available. Reload."
5. User clicks Reload:
   - `updateServiceWorker(true)` sends `{ type: "SKIP_WAITING" }`.
   - The waiting worker activates.
   - `controllerchange` fires.
   - The page reloads once.
6. If the user ignores it, the old version keeps working. No data is lost. The prompt appears again next session.

Do:

- Keep `registerType: "prompt"`.
- Keep `skipWaiting: false`.
- Show the update toast with a stable `id` so it does not stack.

Do not:

- Call `updateServiceWorker(true)` on mount.
- Reload on `controllerchange` without user consent.
- Use `registerType: "autoUpdate"` for a data-entry app.

---

## 6. Caching rules (hard requirements)

| Path | Allowed in precache | Allowed in runtime cache | Why |
|---|---|---|---|
| Hashed JS/CSS/HTML/icons/fonts | Yes | N/A (precached) | App shell must open offline. |
| `/api/*` | **Never** | **Never** | School data must be live. Stale grades are dangerous. |
| `/uploads/*` | **Never** | **Never** | Private/student files must not be stored on device. |
| External Google Fonts | No | Optional, short TTL | App must work without them; offline shows fallback fonts. |

Enforcement:

- `navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//]` prevents API navigations from receiving cached HTML.
- `check-pwa-build.mjs` fails if any precache URL matches `api/` or `uploads/`.
- Manual check: DevTools -> Application -> Cache Storage should contain only Workbox precache entries.

If MRF later wants runtime caching for a non-sensitive static asset, add it explicitly with `runtimeCaching`, a distinct cache name, and an expiration policy. Never add a catch-all pattern.

---

## 7. Verification checklist

### Automated

- [ ] `pnpm run build` emits `dist/manifest.webmanifest` and `dist/sw.js`.
- [ ] `pnpm run check:pwa` passes.
- [ ] `pnpm run verify` (or MRF equivalent) is green.
- [ ] `pnpm run test:e2e:pwa` passes.
- [ ] No source outside the PWA module calls `navigator.serviceWorker.register`.
- [ ] The non-target portals have no install entry and no registration.

### DevTools (production build, HTTPS or localhost)

- [ ] Application -> Manifest: name, `start_url`, `display: standalone`, icons, maskable icon are valid. No manifest errors.
- [ ] Application -> Service Workers: active worker, scope equals the portal path.
- [ ] Application -> Cache Storage: only precache assets; no `/api` or `/uploads` URLs.
- [ ] Network -> offline: reload shows the app shell and the offline banner, not a browser error.
- [ ] Lighthouse: installability passes.
- [ ] `navigator.serviceWorker.getRegistrations()` returns one registration with the expected scope in production.

### Device QA

- [ ] Android Chrome: install prompt appears, icon uses the school logo, app opens standalone, update toast works, uninstall works.
- [ ] iPhone Safari: "Install app" opens the instructions dialog; manual Add to Home Screen; icon and standalone open work; offline banner shows.
- [ ] Reinstall after a logo change shows the new icon.
- [ ] App opened offline while logged out shows login plus the offline notice.

### Server/deployment

- [ ] `/manifest.webmanifest` returns `200` with `application/manifest+json`, not the SPA HTML fallback.
- [ ] `/sw.js` returns JavaScript, not the SPA HTML fallback.
- [ ] `/api/health` (or the MRF probe endpoint) returns `200`.
- [ ] The app is served over HTTPS with a valid certificate.

---

## 8. Deployment requirements and headers

1. **HTTPS is mandatory.** No SW and no install prompt on plain HTTP, except `localhost`.
2. **Serve the built app, not the dev server.** The backend must serve `dist` and fall back to `index.html` for app routes.
3. **Correct MIME types.**
   - `manifest.webmanifest` -> `application/manifest+json`
   - `sw.js` -> `application/javascript`
4. **Recommended cache headers** (not implemented in SMART at the time of writing; add them in MRF):
   - `/sw.js` -> `Cache-Control: no-cache`
   - `/index.html` -> `Cache-Control: no-cache`
   - `/manifest.webmanifest` -> short cache, e.g. `Cache-Control: no-cache`
   - `/assets/*` (hashed) -> `Cache-Control: public, max-age=31536000, immutable`
5. **SPA fallback must not swallow backend paths.** Unknown `/api/*` routes must return JSON 404, never HTML.

SMART's fallback for reference (`server/src/index.ts:113-120`):

```ts
const distPath = path.join(__dirname, "../../dist");
app.use(express.static(distPath));

// Unknown API routes -> JSON 404 (never the SPA HTML fallback)
app.use("/api", (req, res) => { /* JSON 404 */ });

app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});
```

**ADAPT:** Express 5 route syntax differs; use `app.get("/*splat", ...)` or the equivalent. The order is the important part: static, API 404, then SPA fallback.

---

## 9. Lessons learned / gotchas

1. **`workbox-window` must be direct.** With pnpm, the virtual register import fails or resolves unpredictably if `workbox-window` is only transitive. Add it as a devDependency.
2. **`injectRegister: false` is not optional** when the PWA is portal-specific. Auto-injection registers the SW on every page of the origin.
3. **Manifest scope and SW scope are different.** SMART's manifest scope is `/` (installable app), while the SW scope is `/teacher` (only the teacher portal is controlled). Do not collapse them unless MRF's whole app is one portal.
4. **First visit behavior is normal.** The first load registers and activates the SW; the page is fully controlled after the next navigation/reload. Do not report this as a bug.
5. **Dev server has no SW.** `devOptions.enabled: false` is intentional. Test install/offline with `build` + `preview` or HTTPS production.
6. **`beforeinstallprompt` never fires on Safari.** iOS needs the manual dialog. All iOS browsers use WebKit, so the "Add to Home Screen" path is required regardless of browser brand.
7. **Installed icons are cached by the OS.** Changing `public/pwa/*.png` requires rebuild and reinstall to see the update.
8. **Maskable icons are cropped.** Keep the logo inside the safe zone. SMART uses 62% scale for the maskable variant.
9. **API caching is the most dangerous failure mode.** A single `runtimeCaching` pattern can serve stale grades and hide synchronization failures. Keep the denylist and the build gate.
10. **`navigator.onLine` is not enough.** Probe the backend with `cache: "no-store"` and a timeout.
11. **Do not force updates.** `registerType: "prompt"` + `skipWaiting: false` prevents losing unsaved grade input.
12. **The manifest is origin-wide.** Even though only the teacher portal registers the SW, the manifest is served at the origin root and can make the origin installable. `start_url` and the registration gate keep the practical behavior portal-specific.
13. **`start_url` needs SPA fallback.** If `/teacher` returns 404, the installed app opens broken even though the SW is fine.
14. **Installing does not log the user in.** SMART uses `sessionStorage`; an installed app may ask for login each launch. If MRF wants persistent login, that is an auth change with its own security review.
15. **`/sw.js` and `index.html` must not be cached long.** Otherwise users do not see updates promptly. This was a known deployment note in SMART; verify it in MRF's server config.

---

## 10. Rollback

Preferred:

1. Revert the PWA commit.
2. Rebuild and redeploy `dist`.
3. No database migration is involved, so server data is untouched.

If installed clients must be cleaned up:

- Deploy a kill-switch build using `selfDestroying` in `vite-plugin-pwa`. It unregisters the SW and clears its caches on the next visit.
- Manual cleanup per browser: DevTools -> Application -> Service Workers -> Unregister, then clear site data.

Do not add a "delete all caches" step to normal operation; the SW's `cleanupOutdatedCaches` handles versioned caches.

---

## 11. Adapting to a different stack

### 11.1 Single-portal app

Use `scope: '/'` and `start_url: '/'`. Remove the portal-isolation checks. Keep everything else identical.

### 11.2 App hosted under a subpath

Set Vite `base: '/subpath/'`, manifest `start_url`/`scope`/`id` to the subpath, and the plugin `scope` to the subpath. Verify `sw.js` is served from that base. Manifest icon paths must resolve under the deployed base.

### 11.3 Not Vite (webpack, Next.js, plain React)

- Use `workbox-webpack-plugin` (`GenerateSW`) or Next.js PWA tooling, or write a small Workbox SW manually.
- Keep the same contract:
  - Precache only build assets.
  - SPA navigation fallback for the portal path.
  - Deny `/api/*` and `/uploads/*`.
  - `skipWaiting: false`, `clientsClaim: true`, cleanup outdated caches.
  - Manual registration scoped to the portal.
- Keep a manifest with `start_url`, `scope`, `display: standalone`, 192/512/maskable icons.
- Keep the install/update/offline UI logic; it is framework-independent.

### 11.4 Not React

Port the hooks to the framework's state model:

- Install state machine: `installed | available | ios | dismissed | unsupported`.
- Update state: `waiting worker exists` -> show consent UI -> send `SKIP_WAITING` -> reload on `controllerchange`.
- Connectivity state: `online | offline | checking`, with a backend probe.
- Registration: idempotent, production-only, portal-only.

### 11.5 MRF may want a different portal

SMART chose the teacher portal because teachers use phones in classrooms. MRF should choose the portal with the same operational need. Do not make the student/teacher landing page installable if the design handoff says it must stay untouched; scope the SW to the staff portal instead.

---

## 12. Optional phase 3 (not implemented in SMART)

Browser errors are invisible to PM2. If MRF wants observability:

- Add a client error reporter that listens for `error` and `unhandledrejection`.
- Send sanitized payloads with `navigator.sendBeacon("/api/client-errors", payload)`.
- Allowlist only: message (truncate 500 chars), stack (truncate 4 KB), route, portal, online state, app version, user agent.
- Strip `Bearer ...` and JWT-shaped strings. Never send tokens, student data, or scores.
- Throttle to a small number of reports per session.
- Server: strict Zod schema, small body limit, per-IP rate limit, always `202`, log via the existing logger.

This is observability only. It is not offline support and must not be presented as such.

---

## 13. Acceptance criteria

The MRF implementation is complete when:

- [ ] The target portal is installable on Android and iPhone.
- [ ] The installed app opens standalone with the MRF logo.
- [ ] The app shell opens offline and shows a clear offline banner.
- [ ] No API or upload response is ever precached or runtime-cached.
- [ ] Non-target portals have no install entry and register no SW.
- [ ] A new build shows an update toast; reload happens only on user action.
- [ ] `check:pwa` (or the MRF equivalent) is part of `verify`.
- [ ] Lighthouse installability passes.
- [ ] Production runs over HTTPS and serves the built app with correct MIME types.
- [ ] The rollback path has been tested.

---

## Appendix A: File manifest

New files:

```text
src/pwa/pwa-env.d.ts
src/pwa/registerTeacherPwa.ts
src/pwa/useInstallPrompt.ts
src/pwa/useOnlineStatus.ts
src/components/pwa/InstallAppButton.tsx
src/components/pwa/IosInstallDialog.tsx
src/components/pwa/OfflineBanner.tsx
public/pwa/school-logo.png          # source logo (ADAPT)
public/pwa/icon-192.png
public/pwa/icon-512.png
public/pwa/icon-maskable-512.png
public/pwa/apple-touch-icon-180.png
scripts/generate-pwa-icons.mjs
scripts/check-pwa-build.mjs
scripts/check-pwa-scope.mjs
e2e/pwa.spec.ts
```

Modified files:

```text
vite.config.ts
index.html
src/layouts/TeacherLayout.tsx       # ADAPT to MRF portal layout
package.json
```

Explicitly untouched:

```text
src/main.tsx                        # no SW registration
admin/registrar layouts             # no PWA imports
API write routes                    # no offline queue
database schema                     # no PWA tables
```

---

## Appendix B: References in SMART

- `docs/PWA_ONLINE_FIRST_PLAN.md` - decision record and full plan.
- `docs/DEPLOYMENT_RUNBOOK.md:222-282` - deployment, verification, rollback.
- `vite.config.ts:12-62` - plugin configuration.
- `src/pwa/` - registration and hooks.
- `src/components/pwa/` - install and offline UI.
- `scripts/check-pwa-build.mjs`, `scripts/check-pwa-scope.mjs` - hard gates.
- `e2e/pwa.spec.ts` - automated coverage.
