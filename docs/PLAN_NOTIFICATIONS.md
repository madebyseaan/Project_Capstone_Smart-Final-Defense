# Plan: In-App Notifications (all 3 roles, zero DB/backend changes)

Status: **IMPLEMENTED — all gates green**
Author: opencode
Date: 2026-09-19

Gates result: typecheck ✅ · client build ✅ · server build ✅ · lint 0 errors ✅ · e2e 4/4 (all 3 roles, no console/API errors) ✅ · manual matrix ✅ (teacher/admin/registrar bells).

---

## 1. Goal / non-goals

**Goal:** a header bell in each portal that surfaces role-relevant alerts, derived from data the app already has.

**Non-goals (this pass):** persistent notification history, cross-device sync, email/SMS, admin-composed announcements. All of those need a `Notification` table → that is "Option B" and is explicitly out.

**Hard constraint:** no schema/migration/backend endpoints. This is a **frontend-only** change.

---

## 2. Current state (evidence)

| Concern | Finding | Ref |
|---|---|---|
| Query client | Global `QueryClient` exists; `staleTime 30s`, `retry 1`, `refetchOnWindowFocus false` | `src/main.tsx:9` |
| Real-time | SSE hook exposes `atlasOffline`, `enrollproOffline`, `syncVersion` | `src/hooks/useSyncStream.ts:62` |
| SSE auth | `/sync/stream` is `authenticateToken` only → **all 3 roles allowed** | `server/src/routes/integration.ts:41` |
| Teacher alert source | `GET /grades/deadline-status` (TEACHER, light) | `src/lib/api.ts:530`, `grades-sub/dashboard.ts:479` |
| Admin alert source | `GET /grades/admin/edit-requests?status=PENDING` (ADMIN, DB-only) | `src/lib/api.ts:543`, `grades-sub/editRequests.ts:131` |
| Registrar sources | `/registrar/remedial/pending`, `/registrar/sync/status` | `src/lib/api.ts:1528`; registrar routes |
| Integration health (any role) | `GET /integration/status` — but pings EnrollPro/ATLAS/AIMS | `integration.ts:314` |
| UI primitive | `DropdownMenu` (base-ui) already used | `StudentSelectionTable.tsx:108` |
| Dismiss precedent | sessionStorage per-key | `GradeDeadlineBanner.tsx:20` |
| **Regression gate** | `verify` = typecheck + client build + server build + lint + server tests | `package.json:18` |
| **E2E gate** | logs in each role, all pages, **fails on any console error or API ≥400** | `e2e/portals.spec.ts`, `fixtures.ts:60` |
| Baseline drift | Most pages fetch via manual `useState/useEffect`, **not** React Query | `admin/Dashboard.tsx:111`, `registrar/Dashboard.tsx:117` |

**Critical implication:** the E2E gate treats *any* ≥400 API response as a failure. So the bell can only call endpoints authorized for the current role, and must never probe a foreign-role endpoint.

---

## 3. Notification catalog (role-scoped)

| Role | Alert | Source | Trigger | Link | Stable id |
|---|---|---|---|---|---|
| Teacher | Grade deadline | `gradesApi.getDeadlineStatus()` | `hasIncompleteClasses` | `/teacher/classes` | `deadline:{term}:{termEndDate}` |
| Teacher | ATLAS offline | SSE | `atlasOffline` | `/teacher/schedule` | `atlas-offline` |
| Teacher | EnrollPro offline | SSE | `enrollproOffline` | `/teacher` | `enrollpro-offline` |
| Admin | Pending edit requests | `gradesApi.getAdminEditRequests('PENDING')` | `count > 0` | `/admin/edit-requests` | `edit-requests:{count}` |
| Admin | ATLAS/EnrollPro offline | SSE | as above | `/admin/health` | `atlas-offline` / `enrollpro-offline` |
| Registrar | Pending remedial | `registrarApi.getRemedialPending()` | `count > 0` | `/registrar/remedial` | `remedial:{count}` |
| Registrar | Sync stale | `/registrar/sync/status` | `status !== 'fresh'` | `/registrar` | `sync-stale` |
| Registrar | ATLAS/EnrollPro offline | SSE | as above | `/registrar` | `atlas-offline` / `enrollpro-offline` |

Deliberately **excluded** for now: admin unfinalized-sections / offline-services (only available via `/admin/dashboard`, which makes a **live EnrollPro call** — unacceptable to poll from a bell).

### 3.1 Banner migration (Teacher)

The two Teacher Dashboard reminders become bell entries; the Class Records reminder stays.

| Banner | Current location | Disposition |
|---|---|---|
| ATLAS offline (amber, global) | `src/layouts/TeacherLayout.tsx:379` (all teacher pages) | **Remove** → `atlas-offline` notification |
| Grade deadline (rose/amber) | `src/pages/teacher/Dashboard.tsx:367` | **Remove** → `deadline:*` notification |
| Grade deadline (Class Records, `hideLink`) | `src/pages/teacher/ClassRecordsList.tsx:385` | **Keep as-is** |

Cleanup that comes with the removal (typecheck/lint will flag):
- `TeacherLayout.tsx`: drop `atlasBannerDismissed` state + `setAtlasBannerDismissed`; remove now-unused imports (`AlertTriangle`, `X` if not used elsewhere).
- `Dashboard.tsx`: remove the `GradeDeadlineBanner` import if no longer used in that file; keep `data.gradeDeadline` only if referenced elsewhere.

---

## 4. Architecture

```
Layout (Admin/Teacher/Registrar)
 ├─ useSyncStream()  ── one SSE connection per portal (teacher already has one; add to admin/registrar)
 └─ <NotificationBell portal="admin|teacher|registrar"
        userId={...} atlasOffline enrollproOffline />
        │
        ├─ useNotifications(portal,userId)   ← role-scoped React Query, poll 60s
        │     └─ derives Notification[] via useMemo
        └─ DropdownMenu (existing primitive)
              ├─ badge = active (non-dismissed) count
              ├─ list item → navigate(link) + dismiss
              └─ "Dismiss all"
```

**Read/dismiss state:** `localStorage` key `smart_notif_dismissed_<role>_<userId>` = JSON array of dismissed ids. Chosen over unread flags because every alert here is *state*, not an event. (Recommended; see open questions.)

**New files**
- `src/components/layout/NotificationBell.tsx` — bell + dropdown UI
- `src/hooks/useNotifications.ts` — role derivation + query keys
- `src/lib/notifications.ts` — `Notification` type, id builders, dismiss store helpers

**Edits (tiny, additive — except the two banner removals)**
- `src/layouts/AdminLayout.tsx` — add SSE hook + `<NotificationBell>` in right cluster (`:536`)
- `src/layouts/TeacherLayout.tsx` — pass existing SSE flags to bell; **remove** the global ATLAS banner block (`:379`) and its `atlasBannerDismissed` state/imports
- `src/layouts/RegistrarLayout.tsx` — add SSE hook + bell (`:362`)
- `src/pages/teacher/Dashboard.tsx` — **remove** `<GradeDeadlineBanner>` (`:367`) and its now-unused import
- `src/pages/teacher/ClassRecordsList.tsx` — **no change** (banner kept)

**Design adherence:** semantic tokens only (`text-foreground`, `text-muted-foreground`, `bg-primary`, `text-destructive`), no raw palette; reuse `DropdownMenu`; keep files < 1000 lines.

---

## 5. Regression analysis (what could break) + mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | E2E gate trips on API 400/403 | Only role-authorized endpoints per portal; `retry: 0`; never call foreign-role routes |
| R2 | Duplicate SSE connections (teacher page calls `useSyncStream` too) | Layout owns the single SSE call; bell gets flags via **props**, never calls the hook |
| R3 | Header overflow / layout shift, esp. mobile | Icon-only button `w-9 h-9`; place before school-year badge; verify at 375/768/1512 |
| R4 | Extra load from polling | 60s interval, `refetchIntervalInBackground:false`, light DB-only endpoints; SSE for offline (free) |
| R5 | Offline flag not populated until first sync event | Accept (matches existing ATLAS banner behavior); optional one-shot `/integration/status` seed if instant needed |
| R6 | StrictMode double-mount | React Query dedupes; `useSyncStream` already StrictMode-safe |
| R7 | localStorage collision between users on same browser | Key includes `userId`; clear on logout optional |
| R8 | Design-system churn | No new deps, reuse dropdown primitive + tokens |
| R9 | Removing banners reduces at-a-glance visibility on non-dashboard teacher pages | Bell badge + `atlas-offline` entry is global in the header, visible on all pages; verify class-records banner still renders |

---

## 6. Gates (approval checkpoints)

**G0 — Baseline (must do first).** Run `npm run verify` and `npm run test:e2e`; record green. If red, triage *before* any bell work, so we never attribute pre-existing failures to this feature. *(e2e needs `tests/playwright-accounts.json` or `SMART_TEST_*` env.)*

**G1 — Scaffolding.** Types + `useNotifications` + dismiss store only, nothing mounted. Gate: `npm run typecheck` + `npm run build`.

**G2 — Teacher bell + banner migration.** Mount in TeacherLayout; remove the ATLAS banner from the layout and the deadline banner from Dashboard; confirm Class Records banner still renders. Gate: `npm run build` + e2e `teacher` case passes with **zero** new problems.

**G3 — Admin + Registrar.** Mount remaining. Gate: full `npm run verify` + full `npm run test:e2e` (all 3 roles, all pages).

**G4 — Polish/manual matrix.** Per role: badge count correct, dropdown opens, navigation works, dismiss persists after reload, mobile layout intact, no console errors.

**Merge gate:** G0–G4 green; diff touches only the 3 new files + 3 layout insertions; one commit per phase for clean revert.

---

## 7. Test plan

- **Automated:** existing `portals.spec.ts` is the primary regression net (it will catch any bell-induced 4xx/console error). Optional new `e2e/notifications.spec.ts`: open bell per role, assert it renders and dropdown opens.
- **Manual matrix:** role × (alert present / absent) × (desktop / mobile) × (dismiss → reload persistence).
- **Edge cases:** empty list (bell shows "You're all caught up", badge hidden), endpoint slow (skeleton, no error), user id missing (bell disabled), token expiry (existing interceptor path — must not create a loop).

---

## 8. Effort

- G0 baseline: ~15 min
- G1 scaffold: ~30 min
- G2 teacher: ~45 min
- G3 admin+registrar: ~1 hr
- G4 polish: ~30 min

**~3 focused sessions**, no backend deploy, no migration — nothing to run on prod DB.

---

## 9. Open questions (need a call before coding)

1. **Dismiss vs read/unread?** Recommend dismiss + active-count badge (simplest, no DB).
2. **Admin scope** — confirm we skip unfinalized/offline-services (avoids polling a live EnrollPro call)?
3. **Offline alerts instant or SSE-only?** SSE-only means they appear after the next sync cycle. Want the optional one-shot `/integration/status` seed for instant display?
4. **Bell on mobile** — icon-only, or hide under a menu?
