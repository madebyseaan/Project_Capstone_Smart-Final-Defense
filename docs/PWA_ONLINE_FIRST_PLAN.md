# SMART Teacher PWA - Online-Only First Release Plan

**Status:** Core implemented on 2026-11-10. Phase 3 (browser errors to PM2) is optional and not implemented.
**Decision date:** 2026-11-10.
**Scope:** Teacher portal only. Installable PWA with app-shell caching. **All data stays online. No offline grade/attendance entry.**
**Deferred:** The offline-first plan in `docs/TEACHER_OFFLINE_MODE_PLAN.md` is **not approved for implementation** until a later decision.

---

## 1. Plain-English Summary

We will make SMART installable on a teacher's phone, like a real app:

- Teacher opens SMART in the browser once.
- A button in the sidebar says "Install app".
- The phone adds a SMART icon.
- Tapping the icon opens SMART fullscreen.
- The app's files are saved on the phone, so it opens fast and even opens when the signal is weak.
- But **grades, attendance, and all school data still need internet**.
- If the teacher is offline, the app shows a clear message instead of a broken page.
- Admin and registrar get no install button and no offline behavior.

This is the **safe first release**. It does not store or queue school data on the phone.

---

## Implementation Status (2026-11-10)

Implemented:

- `vite-plugin-pwa` with `generateSW`, `registerType: "prompt"`, `injectRegister: false`, `scope: "/teacher"`.
- Teacher-only registration through `src/pwa/registerTeacherPwa.ts` and `virtual:pwa-register`.
- Install entry in the teacher sidebar (expanded, collapsed, mobile drawer) with iOS instructions.
- App-shell precache with `/api/*` and `/uploads/*` denied.
- Offline banner and update prompt.
- Manifest, school-logo icons (any, maskable, Apple touch), and Apple meta tags.
- Build/scope gates: `pnpm run check:pwa`.
- Playwright coverage: `e2e/pwa.spec.ts`.
- `workbox-window` added as a direct devDependency for pnpm.

Verified:

- `pnpm run typecheck` passes.
- `pnpm run lint` passes (warnings only, no errors).
- `pnpm run build` generates `dist/manifest.webmanifest` and `dist/sw.js`.
- `pnpm run check:pwa` passes.
- PWA Playwright suite: 5/5 passed on an isolated Vite server.
- Production URL over HTTPS registers a SW with scope `/teacher`, caches the app shell, shows the offline banner, and opens the shell offline after reload.
- Chrome DevTools Protocol reports **zero installability errors** and no manifest errors.
- No `/api` responses appear in cache storage.
- Admin and registrar have no install entry and no SW registration.

Live deployment note:

- The backend serves `dist` from the repository, so rebuilding updated the Funnel URL immediately. A dev server running during `pnpm add` may need a restart because `node_modules` changed.
- The first visit activates the SW; the page is controlled after the next reload or app launch.

Not implemented:

- Optional Phase 3 browser-error reporting to PM2.
- Offline data entry (deferred).

---

## 2. What This Release Does and Does Not Do

### Does

- Installs on Android (Chrome/Edge) and iPhone/iPad (manual Add to Home Screen).
- Adds an install button in the teacher sidebar (desktop, collapsed, and mobile drawer).
- Caches only the app shell: HTML, JS, CSS, icons, and fonts already bundled.
- Opens offline to a clear "You are offline" screen.
- Shows a "New version available - Reload" prompt when the app updates. Never force-reloads.
- Works only for the teacher portal. Admin and registrar are unchanged.
- Keeps the server as the only place where grades and attendance live.
- Does **not** send browser errors to PM2 yet; that is optional Phase 3.

### Does not

- No offline grade entry.
- No offline attendance.
- No local database of students, grades, or attendance.
- No sync queue, no conflict handling, no duplicate protection.
- No "Remember this device" login.
- No offline Excel, AIMS, EnrollPro, school forms, or printing.
- No API response caching.
- No changes to grade locks, finalization, or edit-request behavior.

### Honest limitations

- If the teacher loses signal while typing, the values stay on screen, but a reload can lose them. Existing retry behavior remains.
- The app can open offline, but it cannot show school data offline.
- iPhone installation is manual and less discoverable.
- PWA requires HTTPS and a production build. Over `http://192.168.x.x` or the Vite dev server, installation will not work.

---

## 3. Hard Prerequisites

1. **HTTPS in production.** A domain with a valid certificate, or localhost for testing. Without this, there is no install prompt and no service worker.
2. **Production serves the built app.** The backend serves `dist` on `:5003`. PM2 currently also runs a Vite dev client; production must not rely on that for the PWA.
3. **Teacher-only registration.** The service worker is registered only from the teacher portal and scoped to `/teacher`. Admin and registrar never register it.
4. **No API caching.** The service worker must never precache or runtime-cache `/api/*` or `/uploads/*`.
5. **No changes to the offline feature.** This release must not create local grade/attendance queues.

### Confirmed 2026-11-10

The teacher URL `https://laptop-pfvh73qk.buru-degree.ts.net/login` was checked:

- Returns `200` over HTTPS with a valid Tailscale certificate.
- Serves the built app (`/assets/index-*.js` hashed bundles), not the Vite dev server.
- `/api/health` returns `200`.
- `/manifest.webmanifest` currently returns `index.html` because no manifest exists yet. After the PWA build, verify it returns JSON with `Content-Type: application/manifest+json`.
- `tailscale funnel status` shows **Funnel is enabled**:
  `https://laptop-pfvh73qk.buru-degree.ts.net` -> proxy to `http://127.0.0.1:5003`.

**Result:** prerequisites 1 and 2 are already satisfied. No infrastructure change is required.

**Phones do NOT need Tailscale.** The host is published through Tailscale Funnel to the public internet, which is why it worked on a phone without Tailscale.

Caveats:

- **Funnel depends on the laptop.** If the laptop is off, asleep, or Tailscale Funnel stops, the URL is unreachable. An already-installed PWA can still open its cached shell, but data will not load.
- **The URL is public.** The login page and API are reachable from the internet. Existing authentication, CSRF, and rate limiting already apply, but review them before a school-wide rollout.
- **Tailscale Funnel is not a full production host.** It is fine for a single school/pilot. For a large long-term rollout, consider a stable domain and normal hosting.
- The hostname is a laptop name. If that laptop is renamed or replaced, the install URL changes. Use a stable hostname for long-term use.
- Add `Cache-Control: no-cache` for `/sw.js` and `index.html` so updates are detected promptly.
- Ensure `/manifest.webmanifest` and `/sw.js` are served with the correct MIME types, not the SPA fallback.

---

## 4. Architecture

### 4.1 Pieces

| Piece | Responsibility |
|---|---|
| `manifest.webmanifest` | App name, icons, `start_url: "/teacher"`, `scope: "/"`, standalone display, theme/background colors. |
| Service worker (`sw.js`) | Precache app shell, serve `/teacher/*` navigations from cached `index.html`, handle update messages. Never touch `/api`. |
| Registration module | Register SW from the teacher portal only, with `scope: "/teacher"`. |
| Install button | Teacher sidebar entry using `beforeinstallprompt`; iOS instructions dialog. |
| Update prompt | Toast when a waiting worker exists; user chooses reload. |
| Connectivity banner | Online/offline notice. Disables data actions offline with a clear reason. |
| Error reporter (recommended) | Sends sanitized browser errors to `/api/client-errors` so PM2 sees them. |

### 4.2 Service worker strategy

Use `vite-plugin-pwa` with **generateSW** plus the `virtual:pwa-register` module:
- Precache hashed build assets.
- The generated SW includes the `SKIP_WAITING` message listener used by the update prompt.
- Serve the cached `index.html` for `/teacher/*` navigations.
- Deny `/api/*` and `/uploads/*`.
- Clean old caches on activation.
- Register only from the teacher portal with `scope: "/teacher"`.

Actual workbox behavior:
- `cleanupOutdatedCaches: true`
- `clientsClaim: true`
- `skipWaiting: false` until the user accepts an update
- `navigateFallback: "index.html"`
- `navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//]`
- Precache: `**/*.{js,css,html,svg,png,ico,woff2}`
- No runtime caching for API or uploads
- Optional CacheFirst for Google Fonts with a short expiration; the app must still work without them

Note: the first visit registers and activates the SW; the page is controlled on the next reload/launch. This is normal. Offline shell behavior was verified after a reload.

### 4.3 Manifest

- `name`: `SMART`
- `short_name`: `SMART`
- `description`: `Student Management and Records Tracking - Teacher Portal`
- `start_url`: `/teacher`
- `scope`: `/`
- `id`: `/`
- `display`: `standalone`
- `orientation`: `portrait` (optional)
- `theme_color` / `background_color`: match the default app theme (static value; the school's dynamic branding stays inside the app)
- Icons (generated from `public/pwa/school-logo.png`, the official school logo):
  - `192x192` any
  - `512x512` any
  - `512x512` maskable
  - `180x180` apple-touch-icon
- To change the logo later: replace `public/pwa/school-logo.png`, run `node scripts/generate-pwa-icons.mjs`, rebuild, then reinstall the app. Installed icons are cached by the phone and do not update automatically.
- Add Apple meta tags in `index.html`:
  - `apple-mobile-web-app-capable`
  - `apple-mobile-web-app-status-bar-style`
  - `apple-mobile-web-app-title`
  - `theme-color`

### 4.4 Install button behavior

Component: `src/components/pwa/InstallAppButton.tsx`

States:
- `installed` (standalone display or `appinstalled` fired): hidden.
- `available` (`beforeinstallprompt` captured): show button; click calls `prompt()`.
- `ios` (iOS Safari, not standalone): show button; click opens "Share -> Add to Home Screen" instructions.
- `unsupported`: hidden.

Placement:
- Sidebar footer, above the user profile block.
- Same position in the mobile drawer.
- Collapsed sidebar: icon-only button with `aria-label="Install app"` and a title.
- Design tokens only; 44-48px tap target; accessible focus state.

No on-load popups and no nagging. The entry disappears after install.

### 4.5 Update flow

- SW detects a new version and enters `waiting`.
- Show a sonner toast: "New version available" with a "Reload" action.
- On reload click:
  1. Send `{ type: "SKIP_WAITING" }` to the waiting worker.
  2. Wait for `controllerchange`.
  3. Reload the page once.
- Never auto-reload while the teacher is typing.
- Show "Ready to work offline" only if the shell cache is complete; do not imply data is available offline.

### 4.6 Offline behavior

- Global `useOnlineStatus` hook (browser `online`/`offline` events plus a lightweight `/api/health` probe).
- Banner: "You are offline. Reconnect to load school data."
- Data pages render the app shell and show the offline state; do not show stale grades.
- Disable save/action buttons offline with an inline reason.
- If the app is opened offline, route to `/teacher` and show the offline notice. If not logged in, show the login page with an offline notice.

### 4.7 Teacher-only isolation

- Registration lives in `TeacherLayout` (or a hook imported only there).
- `main.tsx` does not register the SW.
- Admin and registrar layouts do not import PWA components.
- The manifest is origin-wide by nature; `start_url: "/teacher"` and teacher-only registration keep the practical behavior teacher-only.
- A same-browser admin/registrar user who never opens the teacher portal never gets the SW.

---

## 5. Files Expected to Change

### New

- `src/pwa/registerTeacherPwa.ts` - idempotent registration with scope `/teacher`, update detection, kill-switch awareness.
- `src/pwa/useInstallPrompt.ts` - install state machine, `beforeinstallprompt` capture, iOS/standalone detection.
- `src/pwa/useOnlineStatus.ts` - connectivity state and health probe.
- `src/pwa/errorReporter.ts` - optional sanitized browser error beacon (not implemented).
- `src/pwa/pwa-env.d.ts` - PWA virtual module types.
- `src/components/pwa/InstallAppButton.tsx`
- `src/components/pwa/IosInstallDialog.tsx`
- `src/components/pwa/OfflineBanner.tsx`
- `public/pwa/school-logo.png` (source image)
- `public/pwa/icon-192.png`
- `public/pwa/icon-512.png`
- `public/pwa/icon-maskable-512.png`
- `public/pwa/apple-touch-icon-180.png`
- `scripts/generate-pwa-icons.mjs`
- `scripts/check-pwa-build.mjs` - artifact gate.
- `scripts/check-pwa-scope.mjs` - teacher-only source gate.
- `e2e/pwa.spec.ts` - install UI and portal isolation.
- Optional: `server/src/routes/clientErrors.ts`, `server/src/schemas/clientErrors.ts`, `server/src/__tests__/client-errors.test.ts`.

### Modified

- `vite.config.ts` - `VitePWA` with `generateSW`, scope `/teacher`, prompt updates.
- `index.html` - Apple meta tags, theme color.
- `src/layouts/TeacherLayout.tsx` - register SW, mount install button, update toast, offline banner.
- `package.json` - `vite-plugin-pwa` dev dependency, `check:pwa` script wired into `verify`.
- `src/main.tsx` - no SW registration; only existing app bootstrap.
- `pnpm-workspace.yaml` - only if pnpm reports ignored build scripts.
- `ecosystem.config.cjs` - explicit PM2 log files and timestamps (coordinate with other session).
- `docs/DEPLOYMENT_RUNBOOK.md` - HTTPS, install steps, update/cache troubleshooting, rollback.

### Explicitly untouched

- `docs/TEACHER_OFFLINE_MODE_PLAN.md` (deferred plan, reference only).
- Admin and registrar layouts.
- Grade/attendance write routes.
- Prisma schema.
- Offline integration rig.

---

## 6. Vite PWA Configuration Notes

- `vite-plugin-pwa` v2 supports Vite 8.
- Use `strategies: "generateSW"` with `registerType: "prompt"`.
- `injectRegister: false`; the teacher portal calls `registerSW` through `virtual:pwa-register`.
- Top-level `scope: "/teacher"` so registration is teacher-only.
- `devOptions.enabled: false` by default. Test install with `pnpm build` plus a production/preview server, not the Vite dev server.
- `workbox-window` is a direct devDependency because pnpm does not hoist it for the virtual register import.
- Optional environment flag `VITE_PWA_DEV=true` for local SW debugging; never default.

---

## 7. Anti-Regression Gates

### 7.1 Build gate: `scripts/check-pwa-build.mjs`

Run after `pnpm build`. Fail the build if:

- `dist/manifest.webmanifest` is missing or invalid.
- `start_url !== "/teacher"`.
- `display !== "standalone"`.
- Required icons are missing, or PNG dimensions do not match their declared sizes (read the PNG IHDR header, no dependencies).
- `dist/sw.js` is missing.
- `dist/index.html` has no manifest link.
- The service worker precache includes `/api/` or `/uploads/`.
- Any API URL appears in the generated precache manifest.
- The SW lacks a `SKIP_WAITING` message handler.

### 7.2 Source gate: `scripts/check-pwa-scope.mjs`

Fail if:

- `main.tsx` registers a service worker.
- `AdminLayout.tsx` or `RegistrarLayout.tsx` imports install/PWA components.
- `TeacherLayout.tsx` does not mount the install entry.
- Any source outside `src/pwa` calls `navigator.serviceWorker.register`.
- Any service worker source imports an API client.

### 7.3 Playwright: `e2e/pwa.spec.ts`

Read-only, isolated from existing specs:

- Teacher login -> install entry exists in the sidebar and mobile drawer.
- Synthetic `beforeinstallprompt` -> button becomes actionable; click calls `prompt()` (mock).
- Standalone/`appinstalled` simulation -> button disappears.
- Admin login -> no install entry.
- Registrar login -> no install entry.
- `/manifest.webmanifest` returns 200 and expected fields.
- On a production/preview server: SW registers with scope `/teacher`.
- On a production/preview server: API requests are not served from cache when offline.
- Offline navigation shows the offline notice, not stale data.

### 7.4 Existing gates

- `pnpm run verify` stays green: typecheck, build, server build, lint, server tests.
- Add `node scripts/check-pwa-build.mjs && node scripts/check-pwa-scope.mjs` to `verify`.
- No changes to existing offline integration tests.

### 7.5 Manual QA

- Android Chrome: install prompt, installed icon, fullscreen open, update prompt, uninstall.
- iPhone Safari: manual Add to Home Screen, icon, fullscreen open, offline notice.
- DevTools Application: manifest valid, SW active with scope `/teacher`, cache storage contains only static assets, no `/api` entries.
- Lighthouse: installable.
- Admin/registrar: no install entry, no `/teacher` SW registration.
- Production build served over HTTPS.
- PM2 logs show `[client-error]` if the optional reporter is enabled.

---

## 8. Optional Phase 3: Browser Errors in PM2

PM2 only sees server output. To capture teacher-side crashes:

- `src/pwa/errorReporter.ts` listens for `error` and `unhandledrejection`.
- Sends `navigator.sendBeacon("/api/client-errors", payload)`.
- Payload allowlist: message (truncate 500 chars), stack (truncate 4 KB), route, portal, online state, app version, user agent.
- Sanitize `Bearer ...` and JWT-shaped strings. No tokens, no student data, no scores.
- Throttle to 5 reports per session.
- Server route: zod strict schema, 16 KB body limit, `clientErrorLimiter` (e.g., 20/minute/IP), always `202`, log via `logger.warn("[client-error]", payload)`.
- PM2 captures the log. Verify with `pm2 logs server --lines 100 | Select-String "client-error"`.

This is observability only. It is not offline support.

---

## 9. Rollout and Rollback

### Rollout

1. Confirm HTTPS and production serving of `dist`.
2. Ship manifest, icons, SW, install button, offline notice.
3. Run build gates and Playwright.
4. Test on one Android phone and one iPhone.
5. Announce to teachers: "You can install SMART; data still needs internet."

### Rollback

- Revert the feature commit.
- Or deploy the kill-switch build: a SW that unregisters itself and clears its caches on next visit.
- Server data is untouched because this release does not change writes.
- No database migration, so rollback is low risk.

---

## 10. Acceptance Criteria

- Teacher can install on Android and iPhone.
- Installed app opens fullscreen with the school logo icon.
- App shell opens offline and shows a clear offline message.
- No grades, attendance, or API responses are cached.
- Admin and registrar have no install entry and no SW.
- Update prompt appears and never reloads without consent.
- `pnpm run verify` passes with the new gates.
- Lighthouse installability passes.
- Production runs over HTTPS and serves the built app.
- Rollback tested.

---

## 11. What Comes Later (Not Now)

After this release, observe real teacher usage:

- Do teachers report losing work when the signal drops?
- Do they report being unable to take attendance offline?
- Is the school WiFi reliable enough that install-only is sufficient?

Only if the answer justifies it, revisit `docs/TEACHER_OFFLINE_MODE_PLAN.md` for the staged offline queue. Do not build the offline subsystem speculatively.
