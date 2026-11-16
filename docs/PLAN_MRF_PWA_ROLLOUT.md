# MRF PWA Rollout Plan

**Status:** Planning. Not implemented.
**Blueprint:** `docs/AI_HANDOFF_PWA_FOR_MRF.md` (self-contained build spec; code shipped in SMART on 2026-11-10, commit `3fb01a8`).
**Decision record:** `docs/PWA_ONLINE_FIRST_PLAN.md`.
**Scope context:** `docs/AI_HANDOFF_MRF_MASTER.md` (Admin/MRF staff portals only; MRF landing/login for students/teachers stays untouched).
**Owner:** SMART developer who is also on the MRF team.
**Goal:** Reproduce SMART's installable, online-first PWA in MRF with MRF branding, routes, and content — same behavior, same guardrails, zero API caching.

---

## 1. Objective and non-goals

### Objective

MRF staff open the staff portal on a phone once, tap "Install app", and get a standalone icon that opens the cached app shell offline with a clear offline banner. All school data remains online-only and server-authoritative.

### Non-goals (hard)

- No offline grade/attendance/form entry.
- No IndexedDB, background sync, mutation queue, or conflict resolution.
- No `/api/*` or `/uploads/*` caching, precache or runtime.
- No force-reload on update.
- No student/teacher landing page changes.
- No "remember this device" auth change. Installed app may still ask for login.

---

## 2. What gets sent to MRF

Send **only** the blueprint file plus this plan. Do not send SMART source files — the blueprint contains the actual shipped code.

Deliverable package:

1. `AI_HANDOFF_PWA_FOR_MRF.md` — implementation spec (Sections 0–13, Appendix A).
2. `PLAN_MRF_PWA_ROLLOUT.md` — this rollout plan (phases, inputs, gates).
3. Working agreement: MRF AI fills the Phase 0 worksheet, implements in order, then reports PASS/FAIL with `file:line` evidence. No silent deviations.

**ADAPT rule:** everything marked ADAPT in the blueprint must be resolved from MRF's real codebase, not guessed.

---

## 3. Phase 0 — Discovery worksheet (blocking)

No code until this table is filled and reviewed. Missing values are the #1 cause of copy-paste breakage.

| # | Input | SMART value | MRF value | Where to find |
|---|---|---|---|---|
| 1 | Framework + build | React 19, Vite 8, TS, Tailwind 4 | | `package.json`, `vite.config.*` |
| 2 | Target portal | Teacher portal | | Portal/layout files |
| 3 | Portal route path | `/teacher` | | Router config |
| 4 | Portal layout file | `src/layouts/TeacherLayout.tsx` | | Layout imports |
| 5 | Non-target portals (must stay untouched) | Admin, Registrar | | Router config |
| 6 | App name / short_name | SMART / SMART | | Branding source |
| 7 | Manifest description | Student Management and Records Tracking - Teacher Portal | | Copy |
| 8 | Theme + background color (must match) | `#111827` | | Design tokens |
| 9 | Source logo for icons | `public/pwa/school-logo.png` | | Brand assets |
| 10 | Apple home-screen title | SMART | | Branding |
| 11 | Toast library | `sonner` | | `package.json` |
| 12 | Dialog primitives | shadcn `Dialog` | | `src/components/ui` |
| 13 | Icon library | `lucide-react` | | `package.json` |
| 14 | `cn` utility path | `@/lib/utils` | | Source tree |
| 15 | Health/probe endpoint | `GET /api/health` (unauthenticated, cheap) | | Server routes |
| 16 | SPA fallback + static serving | `server/src/index.ts:113-120` | | Server entry |
| 17 | Build / verify scripts | `build`, `verify`, `check:pwa` | | `package.json` |
| 18 | E2E framework + auth fixtures | Playwright | | `e2e/`, config |
| 19 | Manifest `id` | `/` | | Decision (never change after release) |
| 20 | SW scope = portal path | `/teacher` | | Decision |

### Phase 0 decisions to record

1. **Install identity:** `id` and `start_url`. Use a stable value; changing `id` after release creates a new installable app.
2. **Scope split:** manifest `scope` is origin-wide (`/`), SW `scope` is the portal path. Do not collapse them unless MRF is single-portal (blueprint §11.1).
3. **Portal choice:** staff portal, not the student/teacher landing page (blueprint §11.5 + MRF master doc).
4. **Probe endpoint:** if no `/api/health`, add one or probe a static asset with `cache: "no-store"`.
5. **Fallback:** if MRF is not React + Vite, use blueprint §11.3/§11.4 and keep the contract.

**Exit gate:** filled worksheet committed to MRF repo (or attached to the implementation PR).

---

## 4. Implementation phases

Order is mandatory. Each phase has its own gate; do not start UI before the SW is scoped and isolated.

### Phase 1 — Dependencies + plugin config

Tasks:

- `vite-plugin-pwa` major matching MRF's Vite major; `workbox-window` as a **direct** devDependency (pnpm does not hoist it for `virtual:pwa-register`).
- Add `VitePWA(...)` with: `generateSW`, `registerType: "prompt"`, `injectRegister: false`, `devOptions.enabled: false`, portal `scope`, `skipWaiting: false`, `clientsClaim: true`, `navigateFallback: "index.html"`, `navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//]`, `cleanupOutdatedCaches: true`.
- Manifest: MRF name/short_name/description/colors, `start_url` = portal path, `scope: "/"`, `display: "standalone"`, 3 icons (192 any, 512 any, 512 maskable).
- `globPatterns` extended only for MRF's bundled asset types.

Gate:

- `vite build` emits `dist/manifest.webmanifest` and `dist/sw.js`.
- Manifest JSON visually correct; no API URLs in precache.
- Dev server still has zero registrations.

### Phase 2 — Registration and portal-only mount

Tasks:

- Add `pwa-env.d.ts` with `/// <reference types="vite-plugin-pwa/client" />` inside the tsconfig-app include.
- Port the registration module (blueprint §4.4): idempotent, `!import.meta.env.PROD` guard, persistent update toast with stable `id`, hourly `registration.update()`, error logging.
- Call registration **only** from the target portal layout `useEffect`.
- Confirm `main.tsx`, `App.tsx`, and all non-target layouts have zero PWA imports.

Gate:

- Production build registers exactly one SW with the portal scope.
- Non-target portals register zero SWs.
- Update toast appears on a new build; reload happens only on click.

### Phase 3 — Install UX

Tasks:

- Port `useInstallPrompt` state machine: `installed | available | ios | dismissed | unsupported`; `beforeinstallprompt` + `preventDefault`, `appinstalled`, standalone media query, iOS/iPadOS detection.
- Port `InstallAppButton` in the target sidebar footer; mount the same component in collapsed sidebar and mobile drawer (do not duplicate logic).
- Port `IosInstallDialog` with MRF copy and the explicit "data still needs internet" note.
- Accessibility: 44–48 px tap target, `aria-label` when text hidden, `title` in icon-only mode, no nagging popups.

Gate:

- Android Chrome shows prompt; dismissal hides entry for the session.
- iPhone path opens the instructions dialog.
- Installed/dismissed/unsupported states render nothing.

### Phase 4 — Connectivity and offline banner

Tasks:

- Port `useOnlineStatus`: `online | offline | checking`, backend probe with `cache: "no-store"`, 5 s abort, 250 ms debounce, event listeners.
- Port `OfflineBanner` above page content. Show banner only; never show stale school data.
- Disable write actions offline with an inline reason.
- Offline + logged out shows login page plus offline notice; never silently clear session.

Gate:

- DevTools offline reload shows shell + banner, not a browser error.
- Probe endpoint returns `200`; banner clears on reconnect.
- No API response in Cache Storage.

### Phase 5 — Icons and document head

Tasks:

- Generate 192/512 any, 512 maskable (62% safe zone), 180 Apple touch from MRF logo; white background; one source image.
- Update `index.html`: favicon, `apple-touch-icon`, `viewport-fit=cover`, `theme-color` matching manifest, `apple-mobile-web-app-*` meta.
- Do not add a manual `<link rel="manifest">`; the plugin injects it.

Gate:

- Icon dimensions read correctly from PNG headers.
- Maskable icon survives Android launcher crop.
- Installed app shows MRF logo and title.

### Phase 6 — Build and scope gates

Tasks:

- Port `check-pwa-build.mjs` (manifest fields, icon existence/dimensions, maskable, `sw.js` precache non-empty, `index.html` present, `SKIP_WAITING`, no `api/` or `uploads/` precache, manifest link, Apple touch icon).
- Port `check-pwa-scope.mjs` (no registration in `main.tsx`, no PWA imports in non-target layouts, target layout has registration + install entry + banner, no direct `navigator.serviceWorker.register`, config has `injectRegister: false`, `devOptions`, portal `scope`).
- Wire `check:pwa` into MRF's `verify` chain **after** the production build.

Gate:

- Both gates fail when deliberately broken (mutate one condition, confirm failure, revert).
- `verify` is green.

### Phase 7 — E2E and device QA

Tasks:

- Port `e2e/pwa.spec.ts`: install entry visible/actionable via synthetic `beforeinstallprompt`, dismissal hides it, dev registers zero SWs, offline event shows banner, online clears it, non-target portals have no install entry.
- Run MRF's own auth fixture; do not skip the negative isolation test.
- Device QA: Android install/uninstall/update; iPhone manual Add to Home Screen; reinstall after logo change; offline while logged out.

Gate:

- E2E suite passes.
- Device checklist signed with device/browser/version.

### Phase 8 — Deployment and rollback

Tasks:

- HTTPS with valid certificate (or `localhost` for non-prod).
- Serve build output from MRF backend; SPA fallback order: static assets → API JSON 404 → `index.html`. Adapt Express 5 wildcard syntax (`/*splat`).
- MIME: `manifest.webmanifest` -> `application/manifest+json`; `sw.js` -> `application/javascript`.
- Cache headers: `/sw.js` no-cache, `/index.html` no-cache, `/manifest.webmanifest` no-cache, hashed `/assets/*` immutable.
- Test rollback: revert build, redeploy `dist`, confirm old clients behave; optional `selfDestroying` kill-switch build documented but not shipped.

Gate:

- `curl`/DevTools confirm MIME and headers.
- Lighthouse installability passes in production.
- Rollback path exercised once in staging.

---

## 5. SMART → MRF file map

| SMART file | MRF equivalent | Action |
|---|---|---|
| `vite.config.ts:12-62` | MRF Vite config | Adapt |
| `src/pwa/pwa-env.d.ts` | same path under MRF `src` | Copy |
| `src/pwa/registerTeacherPwa.ts` | rename to MRF portal | Copy + toast/copy adapt |
| `src/pwa/useInstallPrompt.ts` | same | Copy |
| `src/pwa/useOnlineStatus.ts` | same, probe path | Copy + endpoint adapt |
| `src/components/pwa/InstallAppButton.tsx` | same | Copy + `cn`/icons adapt |
| `src/components/pwa/IosInstallDialog.tsx` | same | Copy + dialog/copy adapt |
| `src/components/pwa/OfflineBanner.tsx` | same | Copy |
| `src/layouts/TeacherLayout.tsx` | MRF target layout | Adapt placement |
| `index.html` | MRF `index.html` | Adapt |
| `public/pwa/*` | MRF logo/icons | Regenerate |
| `scripts/generate-pwa-icons.mjs` | same | Adapt source image |
| `scripts/check-pwa-build.mjs` | same | Adapt expected fields |
| `scripts/check-pwa-scope.mjs` | same | Adapt portal paths |
| `e2e/pwa.spec.ts` | same | Adapt auth/roles |
| `server/src/index.ts:113-120` | MRF server entry | Adapt fallback order |

Explicitly untouched in MRF: landing/login pages, non-target layouts, API write routes, database schema.

---

## 6. Hard guardrails (repeat to MRF AI)

1. Online-first only. App shell cached; data never cached.
2. One portal registers the SW. Never in `main.tsx` or an app-wide entry.
3. Never precache or runtime-cache `/api/*` or `/uploads/*`.
4. Never force-reload. `registerType: "prompt"` + `skipWaiting: false`.
5. `workbox-window` direct dependency.
6. Test installability with `build` + `preview` or HTTPS, never the dev server.
7. If MRF is not React + Vite, keep the contract (blueprint §11).
8. Do not restyle or touch the student/teacher landing/login page.

---

## 7. Verification and reporting

MRF AI must report each phase as PASS/FAIL with evidence:

```text
Phase N: PASS
- gate item: PASS — file:line
- command: pnpm run build -> exit 0; dist/sw.js emitted
- manual: Android Chrome install prompt shown; screenshot attached
```

Required global evidence:

- `pnpm run build` emits `manifest.webmanifest` and `sw.js`.
- `pnpm run check:pwa` passes.
- `pnpm run verify` green.
- `pnpm run test:e2e:pwa` passes.
- `grep`/search proof that no source outside the PWA module calls `navigator.serviceWorker.register`.
- DevTools: one registration with the portal scope; Cache Storage contains only precache entries; no `/api` or `/uploads`.
- Non-target portals: no install entry, no registration.
- Production: correct MIME types, HTTPS, Lighthouse installability pass, rollback tested.

---

## 8. Risks and pre-emptions

| Risk | Pre-emption |
|---|---|
| Copy-pasting SMART branding/routes | Phase 0 worksheet; ADAPT markers |
| SW registers on every portal | `injectRegister: false`, scope gate, negative E2E |
| Stale grades from runtime caching | Denylist + build gate + "never cache API" rule |
| Lost unsaved input on update | Prompt flow; no auto-reload |
| pnpm resolve error for register import | `workbox-window` direct devDependency |
| Dev testing confusion | document `build` + `preview`; dev has no SW |
| iOS install fatigue | explicit instructions dialog; no nagging |
| Broken installed launch | `start_url` + SPA fallback verified in Phase 8 |
| Launcher-cropped logo | maskable safe zone (62%) + device QA |
| Forgotten rollback | Phase 8 rollback exercise |

---

## 9. Open questions for MRF

1. Which portal needs installability, and is it behind SSO or local login?
2. Is MRF React + Vite, or another stack (blueprint §11 branch)?
3. Does MRF already expose an unauthenticated health endpoint?
4. Who owns branding assets (logo, colors, name) for icon generation?
5. Is MRF served under a subpath (blueprint §11.2)?
6. Which roles must be verified as non-target in E2E?
7. Is there an existing `verify`/CI chain where `check:pwa` should attach?

---

## 10. Definition of done

- [ ] Phase 0 worksheet filled and signed.
- [ ] Target portal installable on Android and iPhone with MRF logo and branding.
- [ ] Installed app opens standalone; shell opens offline with banner.
- [ ] No API/upload precache or runtime cache.
- [ ] Non-target portals have no install entry and no SW.
- [ ] Update toast only; reload on consent.
- [ ] `check:pwa` in `verify`; E2E green; Lighthouse installability pass.
- [ ] HTTPS + correct MIME + SPA fallback verified in production.
- [ ] Rollback path tested.

---

## Appendix A — Copy-paste prompt for MRF AI

```text
Implement the attached SMART PWA blueprint in the MRF codebase.

Step 1: Fill the Phase 0 worksheet in PLAN_MRF_PWA_ROLLOUT.md using MRF's real
package.json, router, layouts, branding, server entry, and scripts. Do not
guess. Stop and list unknowns if any value cannot be found.

Step 2: Implement in the phase order in Section 4. Follow every ADAPT marker in
AI_HANDOFF_PWA_FOR_MRF.md. Use MRF's branding, routes, auth, and portal layout.
Do not copy SMART student/school data, and do not touch MRF's student/teacher
landing or login page.

Step 3: Run each phase gate and the full checklist in AI_HANDOFF_PWA_FOR_MRF.md
Section 7. Report PASS/FAIL per phase with file:line evidence and command
output tails. If a gate fails, fix it before moving on. Do not add offline data
entry, IndexedDB, sync queues, or API caching.
```
