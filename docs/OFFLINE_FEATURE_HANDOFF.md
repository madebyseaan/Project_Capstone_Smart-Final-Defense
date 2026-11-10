# SMART Teacher Offline Feature - Handoff and Review Brief

> **CURRENT DECISION (2026-11-10):**
> The approved first release is the **online-only teacher PWA** in `docs/PWA_ONLINE_FIRST_PLAN.md`.
> This offline-first document is **deferred** and is kept for a later decision after real teacher usage.
> Do not implement the offline queue yet. Use this document only to evaluate alternatives for that later decision.

**Purpose of this document:** Give another AI or engineer enough context to review the problem, challenge the plan, and propose alternative approaches. This is a planning artifact. No application code has been changed.

**Companion documents:**
- Current release: `docs/PWA_ONLINE_FIRST_PLAN.md`
- Deferred detailed offline plan: `docs/TEACHER_OFFLINE_MODE_PLAN.md`

---

## 1. TL;DR

SMART is a DepEd Junior High School management system used by teachers, admins, and registrars. Teachers need to enter grades and attendance in classrooms where internet is unreliable. Today the system is online-only: if the connection drops, the page fails and typed work can be lost.

**Current decision:** Build the online-only teacher PWA first (`docs/PWA_ONLINE_FIRST_PLAN.md`). Offline grade/attendance entry is deferred until real teacher usage shows it is necessary.

**The deferred proposal** is a teacher-only offline mode:
- Install SMART as a PWA on the teacher's phone.
- Keep a local copy of the teacher's classes, students, grades, and attendance.
- Allow grade and attendance entry while offline.
- Queue changes on the device and sync them when the connection returns.
- Never silently lose work or create duplicates.
- Keep admin and registrar online-only.

The hard parts are not the phone storage. They are:
1. Preventing duplicate writes when a queue retries.
2. Handling grades/attendance that changed on the server while the teacher was offline.
3. Handling term/year locks and deadlines.
4. Surviving app restarts, expired sessions, shared devices, and browser storage eviction.
5. Proving all of this with tests at realistic school scale.

**The main question for the reviewer:** Is a full offline-first sync system justified, or is a simpler alternative (for example, an Excel offline round-trip, which the system already partly supports) a better engineering and product tradeoff?

---

## 2. The Problem

### 2.1 Real-world situation

- Teachers take attendance and enter grades during class, often on a phone.
- School WiFi and mobile data can be weak or absent in classrooms.
- A teacher may be offline for minutes, hours, or a whole school day.
- Grades are high-stakes official records. Losing typed work is unacceptable.
- Teachers may share a device or use a personal phone.
- Some teachers are comfortable with Excel; some are not.
- The school has roughly 13,000 students in the user's stated example, with many teachers. This is a whole-school figure; each teacher only handles a small slice.

### 2.2 Current behavior and pain

- The teacher portal is a React SPA that depends on API calls.
- If the connection drops:
  - A page reload fails.
  - A route change can fail.
  - Grade saves can fail.
  - The existing score write queue retries 3 times in memory, then clears pending edits and shows an error. That is data loss from the teacher's perspective.
- Attendance saves are direct HTTP calls; failure means the teacher must retry manually and hope the values are still on screen.
- Closing the tab or app loses unsaved in-memory state.
- There is no local database, no persistent queue, and no offline login.

### 2.3 What success looks like

A teacher can:
1. Open SMART on a phone with no internet.
2. See their own classes, current-term class records, rosters, and attendance.
3. Enter scores and take attendance.
4. Close the app and come back offline without losing work.
5. Reconnect and have the work sync automatically.
6. See a clear status for pending, blocked, or conflicting changes.
7. Never lose work silently; never create duplicate grades or attendance.

Admins and registrars do not need offline mode.

---

## 3. The System Today

### 3.1 Product and roles

- SMART = Student Management and Records Tracking.
- DepEd public Junior High School, Grades 7-10.
- Roles: TEACHER, ADMIN, REGISTRAR.
- Three separate login portals with separate `sessionStorage` keys.
- One school per deployment (isolated stack and database). This is documented in `docs/DEPLOYMENT_RUNBOOK.md`.
- External systems: EnrollPro (student data, school years, terms), ATLAS, AIMS. All read-only integrations.

### 3.2 Stack

- Frontend: React 19, Vite 8, React Router 7, React Query 5, Tailwind 4, shadcn/ui.
- Backend: Node.js, Express 5, Prisma, PostgreSQL, TypeScript.
- Process manager: PM2.
- Tests: Vitest on the server, Playwright for E2E, a custom offline integration rig under `e2e/offline`.
- Package manager: pnpm.

### 3.3 Relevant current facts (verified in the repository)

| Area | Current state |
|---|---|
| Grade writes | `POST /api/grades/grade` for one student; `POST /api/grades/grade/batch` for up to 200 students. Scores are JSON arrays per student/class/term. |
| Attendance writes | `POST /api/attendance/bulk` upserts one section/date roster in a transaction. |
| Grade reads | `GET /api/grades/class-record/:classAssignmentId?term=`; React Query key `["class-record", id, term]`. |
| Attendance reads | `GET /api/attendance/section/:sectionId?date=`; monthly report `GET /api/attendance/sf2/:sectionId?month=&year=`. |
| Existing queue | `src/pages/teacher/hooks/useScoreWriteQueue.ts` debounces, batches, retries 3 times, then clears pending edits. In-memory only. |
| Auth | Access token 15 minutes; refresh token 7 days. Tokens in `sessionStorage`; refresh token also set as an HTTP-only cookie. |
| CSRF | Cookie `x-csrf-token` sent as a header on writes. A GET re-issues it when missing. |
| Locks | Server checks archived class, year lock, term lock, current-term rules, approved edit requests. A grade edit after lock requires an approved edit request. |
| Local storage | No IndexedDB. `localStorage` only for UI preferences, notifications dismiss state, and mobile drafts. |
| React Query | No persistence; stale time 30 seconds. |
| PWA | Not implemented. No manifest, no service worker. |
| Production serving | Backend serves `dist` on :5003. PM2 currently runs a Vite dev client. Production must serve the built app for PWA/offline to exist. |
| Existing "offline rig" | `e2e/offline/*` simulates EnrollPro/ATLAS/AIMS outages. It is **not** browser-offline testing. |
| Excel | Import/export exists for class records (`ExcelExchangePanel.tsx`, `server/src/routes/grades-sub/ecr.ts`). |
| Scale example | User states ~13,000 students school-wide. Each teacher only sees their own classes. |

---

## 4. Hard Constraints

These are non-negotiable and shape every alternative.

1. **The server is the official record.** The phone copy is temporary and disposable after sync.
2. **HTTPS is required** for installation and service workers. Over plain `http://192.168.x.x`, PWA/offline will not work.
3. **Production must serve the built app**, not the Vite dev server.
4. **No silent data loss.** If sync cannot apply work, the teacher must see it and be able to recover or export it.
5. **No duplicate grades or attendance.** Retries and app restarts must be idempotent.
6. **Respect locks and deadlines.** Client clock time cannot be used to bypass a lock.
7. **Admin and registrar remain online-only.** No cross-portal caching or install prompts.
8. **Student data is sensitive.** Per-user local data, no tokens in IndexedDB, wipe on logout, shared-device warning.
9. **One school per stack.** The design does not need to be multi-tenant.
10. **Do not break existing online behavior.** Existing tests and lock rules must remain green.

---

## 5. Options Considered

| Option | Description | Effort | Risk | Notes |
|---|---|---|---|---|
| **A. Install-only PWA** | App installs and opens offline; shows last saved information; no offline typing. | Small | Very low | Safe first step; does not solve the core problem. |
| **B. Excel offline round-trip** | Teacher downloads class record while online, edits in Excel offline, uploads when back. Uses existing import/export. | Small-medium | Medium | Simple mental model; manual; conflicts and validation still need care. |
| **C. Attendance-only offline** | Offline typing only for attendance (simple statuses). Grades remain online. | Medium | Medium | Much smaller data model; still needs a queue and idempotency. |
| **D. Save-then-send (manual queue)** | Teacher types offline; work is saved on the device; teacher presses "Send saved work" when online. No background auto-sync. | Medium | Medium-high | Easier to understand; still needs duplicate protection and conflicts. |
| **E. Full offline-first (proposed)** | Local DB, automatic sync, conflicts, locks, grade tools, attendance, offline reports. | Large | High | Best UX; highest complexity; must be phased and piloted. |
| **F. Paper/manual fallback** | Teacher records offline on paper/notes; enters online later. | Zero code | Low tech risk, high human error | Valid fallback for very poor connectivity; no automation. |
| **G. Native app / Capacitor + SQLite** | Store data in SQLite, sync in background. | Very large | High | More robust storage, but app distribution, updates, and platform work are much heavier. Not recommended for this project. |
| **H. Local school server / LAN mode** | Run a local server in the school; devices sync over LAN, then cloud. | Very large | High | Requires hardware, backup, and ops; not a PWA problem. |
| **I. Cache API responses in the service worker** | Cache GET responses and replay writes. | Small | High | Dangerous for grades/locks; stale data and privacy risk. Rejected. |
| **J. CRDT / automatic merge** | Conflict-free replicated data types. | Very large | High | Overkill for one-teacher-per-class; hard to explain to teachers. Rejected. |

The current recommendation is **A now, B next, then E only if needed**, or **A + C + D/E for a phased rollout** if the school insists on in-app offline entry.

---

## 6. Recommended Scope (Approved in the Detailed Plan)

### In scope

**Offline writes**
- Per-cell grade scores: WW, PT, QA, EX.
- Assessment details and column metadata.
- Add task, remove task, HPS/max-score changes.
- Attendance status and remarks, including save-and-next-day.

**Offline reads**
- Dashboard, schedule, class list.
- Current-term class records; past terms cached after first online open.
- Advisory roster, student basic profile, allowed student grades.
- Current and previous month attendance; local monthly SF2 summary.
- Public settings, transmutation table, branding.

**Platform**
- Installable teacher-only PWA.
- Persistent "Remember this device" session (opt-in, installed app only, 30-day rotating token).
- Local database and persistent outbox.
- Automatic sync on reconnect/app start/visibility change.
- Conflict, lock, and rejection handling with no silent loss.
- Sync center UI.
- Per-user data, wipe on logout, no tokens in IndexedDB.

### Out of scope

- Admin/registrar offline.
- School forms, SF9/SF10, printing.
- Excel import/export offline.
- AIMS and EnrollPro sync.
- Clear-all-scores.
- Account/settings changes offline.
- Multi-device live collaboration.
- Background Sync as the primary mechanism (iOS Safari does not support it).
- Encryption or PIN vault for local data.

---

## 7. Proposed Architecture

### 7.1 Mental model

- **Notebook:** local copy of the teacher's data.
- **Outbox:** queue of typed changes waiting to be sent.
- **Receipt:** server response for each queued change.
- **Official record:** the server database; always the source of truth.

### 7.2 Local storage

- Browser IndexedDB, accessed through Dexie.
- Stores:
  - `meta`: schema version, user id, device id, last sync, app version.
  - `snapshots`: class list, class record per class/term, attendance day/month, advisory, settings, transmutation table.
  - `outbox`: one record per pending change.
  - `syncLog`: receipts and errors, capped.
  - `conflicts`: local vs server values.
- Never store access/refresh tokens in IndexedDB.
- Request persistent storage; show usage and warnings.

### 7.3 Outbox item

```ts
type MutationKind = "GRADE_SAVE" | "GRADE_STRUCTURAL" | "ATTENDANCE_BULK";

interface OutboxItem {
  clientMutationId: string;   // UUID, generated once, reused on retry
  userId: string;
  deviceId: string;
  kind: MutationKind;
  entityKey: string;          // grade: class|term|student
                              // structural: class|term
                              // attendance: section|date
  payload: unknown;           // exact server request body
  baseVersion: number | null; // row version the edit was based on
  baseRevision: number | null;// class+term revision for structural changes
  capturedAt: string;         // device time; audit only
  state: "PENDING" | "SYNCING" | "CONFLICT" | "BLOCKED" | "REJECTED";
  attempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}
```

Rules:
- Merge multiple cell edits for the same student/term into one item.
- Delete only after `APPLIED` or `DUPLICATE`.
- Terminal states stay until the teacher resolves them.
- Retryable failures stay pending with exponential backoff plus jitter.
- Structural operations are atomic for the class+term.

### 7.4 Sync engine

Triggers: `online` event, app start/login, every 30-60 seconds while pending, visibility change, after token refresh.

Behavior:
- Single-flight; one sync loop at a time.
- Oldest item first; 50 mutations max per request.
- Backoff: 2s, 5s, 15s, 60s, 5m, capped at 15m, plus 0-60s jitter.
- On 401: refresh once; if refresh fails, pause and prompt login without touching the outbox.
- On 409: fetch the server copy and create a conflict record.
- On success: replace optimistic state with server data and invalidate relevant React Query keys.
- Log compact `[offline-sync]` summaries for PM2.

### 7.5 Server endpoint

```text
POST /api/offline-sync/mutations
Authorization: Bearer <teacher access token>
x-csrf-token: <cookie value>

{
  "deviceId": "uuid",
  "mutations": [
    {
      "clientMutationId": "uuid",
      "kind": "GRADE_SAVE",
      "entityKey": "classId|T2|studentId",
      "baseVersion": 4,
      "capturedAt": "2026-11-10T08:15:00.000Z",
      "payload": { ... }
    }
  ]
}

200 {
  "results": [
    { "clientMutationId": "uuid", "status": "APPLIED", "version": 5, "revision": 18 },
    { "clientMutationId": "uuid-2", "status": "DUPLICATE" },
    { "clientMutationId": "uuid-3", "status": "CONFLICT", "serverData": { ... } },
    { "clientMutationId": "uuid-4", "status": "BLOCKED", "code": "TERM_LOCKED" },
    { "clientMutationId": "uuid-5", "status": "REJECTED", "code": "ENROLLMENT_INACTIVE" }
  ]
}
```

- HTTP 200 for processed batches, even with per-item failures.
- Max 50 mutations; 60 requests/minute per user.
- Each mutation in its own transaction; one failure does not roll back others.
- Structural grade mutations are all-or-nothing.
- `clientMutationId` unique per user; repeat returns `DUPLICATE`.
- `capturedAt` is audit only; it never bypasses locks.
- Audit entries include `source: "OFFLINE_SYNC"`.

### 7.6 Database changes

New models:
- `SyncMutation` (idempotency ledger; unique `userId + clientMutationId`; indexes; 180-day retention).
- `GradeSetRevision` (class + term revision; protects structural operations from column misalignment).

Modified models:
- `Grade`: add `version Int @default(0)`.
- `Attendance`: add `version Int @default(0)`.

Write services:
- Extract route logic into `server/src/services/gradeWriteService.ts` and `attendanceWriteService.ts`.
- Existing routes and the sync endpoint share them. No duplicated lock/validation rules.

### 7.7 Read path

One client gateway, `src/lib/offline/teacherDataClient.ts`:
- Online: fetch, save snapshot, return fresh.
- Offline/network error: return snapshot with `cachedAt` and `source: "cache"`.
- Allowlist only teacher endpoints. Never cache auth, uploads, admin, registrar, or integrations.
- Pages that currently call `axios` directly (notably Attendance) must move to this client.

---

## 8. UX Summary

- Status banner: Offline / Syncing / Needs attention / All synced.
- Save feedback: "Saved on this device. Will sync when online."
- Pending indicators on grade cells and student rows.
- Sync center:
  - Pending items grouped by Grades and Attendance.
  - Structural items shown as one row.
  - Conflicts: "This device" vs "Server"; keep device / keep server / review cells.
  - Blocked: reason and "Request edit access".
  - Rejected: reason and copy/export values.
  - Storage usage and "Refresh offline data".
- Class card badge: "Available offline" when cached; "Open once online to enable offline" when not.
- Online-only actions remain visible but disabled with a reason.
- Accessibility: `aria-live` status, text alternatives, 44-48px targets, semantic tokens.

---

## 9. Security and Privacy

- Local data is sensitive (student names, grades, attendance).
- Per-user scoping; different account wipes previous user's data.
- "Remember this device" is opt-in, installed-app only, stores only a 30-day rotating refresh token in `localStorage`, wiped on sign-out.
- No tokens in IndexedDB or logs.
- Logout with pending work:
  - Try sync first.
  - If work remains: default "Stay signed in".
  - "Sign out and keep work" (same teacher recovery, 7-day window, different account wipes).
  - "Discard" requires typing `DISCARD`.
- No student data in sync logs or PM2 logs; counts, durations, error codes only.
- Persistent storage requested; eviction warnings displayed.
- Optional later hardening: local screen lock (not encryption).

---

## 10. Scale Reality (13,000 students example)

- No phone stores the whole school. A teacher caches only their classes.
- Typical teacher: 5-8 classes x 40-50 students; 2-5 MB for current term.
- IndexedDB quota is typically hundreds of MB to several GB; storage is not the bottleneck.
- Server:
  - 13k students is modest for PostgreSQL.
  - Indexes already exist on student/class/term.
  - Offline ledger rows pruned after 180 days.
  - Reconnect bursts handled with jitter, per-user rate limits, 50-item batches, and single-flight sync.
  - First-login prefetch: current term first, 0-10 minute stagger, concurrency 2, resumable.
- The real scale risk is the morning login/sync spike, which must be load-tested.
- Deployment is one school per stack; not district-wide multi-tenant.

Optional data reductions:
1. Current term only by default (largest win).
2. Store IDs and codes, not repeated text labels.
3. Optional delta sync for score cells.
4. Optional gzip of large snapshots via `CompressionStream`.
5. Never cache files (Excel, PDF, forms, images).

---

## 11. Testing and Anti-Regression Gates

- Unit tests: outbox merge, stable mutation ids, retry classification, reload persistence, logout rules, conflict transitions, structural ordering.
- Server tests: duplicate replay, version/revision conflicts, atomic structural apply, lock blocking, partial batch behavior, rate limits, audit fields, attendance idempotency, remembered-token TTL/revocation.
- Browser E2E (Playwright with isolated DB):
  - Offline grade entry, add/remove task, HPS, attendance, save-and-next-day.
  - Reload and reopen offline.
  - Reconnect, double replay, exactly one row per change.
  - Conflict, lock, expired session, account switch.
  - Offline attendance report.
- Build/static gates:
  - `pnpm run verify` stays green.
  - PWA build check: manifest, icons, service worker, no `/api` in precache.
  - Offline check: offline-capable pages do not import `axios` directly; admin/registrar do not import teacher offline modules.
- Manual: Android Chrome and iOS Safari, airplane mode, force close, storage warnings, shared device, rollback drill.
- PM2: verify `[offline-sync]` entries for success, conflict, and blocked cases.

---

## 12. Phased Plan

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 | Confirm HTTPS, production serving built `dist`, icons, fixtures, device matrix | Infrastructure confirmed |
| 1 | Local DB, snapshots, connectivity, read cache, "Remember this device" | Offline read and offline reopen work; online behavior unchanged |
| 2 | Outbox, server sync endpoint, ledger, versions/revisions, audit, idempotency | Double replay proves no duplicates; atomic tests pass |
| 3 | Offline per-cell scores + pending UI + sync engine | Offline grade E2E passes; online queue behavior unchanged |
| 4 | Offline grade structural tools (add/remove task, HPS, metadata) | Atomic conflict tests pass; remove-task backup works |
| 5 | Offline attendance, save-and-next-day, local report | Offline attendance/report E2E passes |
| 6 | Sync center, conflicts, blocked/rejected, logout/recovery, shared-device wipe | All conflict/logout/account-switch scenarios pass |
| 7 | Hardening, storage, PM2 verification, device QA, pilot, docs, rollback | One pilot week with zero data-loss reports |

Each phase is independently revertible. Admin/registrar are never touched.

---

## 13. Risks and Limitations

- HTTPS missing = feature impossible.
- Dev server in production = PWA never reaches users.
- Session closing offline = requires "Remember this device"; still a shared-device risk.
- Refresh token expiry (30 days remembered, 7 days normal) = re-login required; queue preserved.
- Browser storage eviction or user clearing data can still lose local work; no web app can prevent it.
- Term locks can block offline work; teacher must request edit access.
- Two devices can create conflicts; resolved manually.
- Remove-task and HPS changes are structural; they must be atomic.
- iOS is less capable and needs manual install and real-device testing.
- Large-school login/sync spikes need load testing.
- Full offline-first is a subsystem, not a small feature. Timeline is weeks to months, not days.
- Perfection is not possible: the goal is no silent loss, no duplicates, and clear recovery.

---

## 14. Alternatives Already Considered and Why

- **Excel offline round-trip:** strong simpler alternative; manual; existing import/export helps; validation and conflict handling still needed. Worth prototyping first.
- **Attendance-only offline:** smaller and safer; good pilot if full grades are too risky.
- **Manual save-then-send queue:** simpler UX than automatic sync; still needs idempotency and conflict handling.
- **Service worker API caching:** rejected; stale grades/locks and privacy risk.
- **CRDT/auto-merge:** rejected; overkill and hard to explain.
- **Native app:** rejected; larger build/deployment burden.
- **Local LAN server:** rejected; hardware/ops burden.
- **Paper fallback:** valid but manual and error-prone.

---

## 15. Questions for the Reviewing AI

Please challenge and improve this plan. Specifically:

1. **Is full offline-first justified**, or is the Excel offline round-trip (Option B) the better tradeoff for a DepEd school with 13k students and uneven connectivity?
2. **Can the sync design be simplified** while preserving no-loss and no-duplicate guarantees? For example, is a single "upload my day" batch better than per-item receipts?
3. **Validate the concurrency design:** per-row `version` plus class-term `revision` plus atomic structural mutations. Is there a simpler scheme that still prevents column misalignment and lost updates?
4. **Challenge the outbox state machine:** are the states and retry rules sufficient? What failure modes are missing (clock skew, duplicate device ids, token family revocation, partial batch timeouts)?
5. **Is IndexedDB + Dexie the right choice** versus alternatives (idb, localForage, SQLite via WASM, native wrapper)? Consider iOS durability and schema migrations.
6. **Should any API GET responses be cached by the service worker?** We currently say no. Are there safe exceptions (public settings, transmutation table)?
7. **Propose a load-test plan** for the morning spike: N teachers, M classes, batch sizes, rate limits, database write contention, and PM2/Node limits.
8. **Estimate effort realistically** for one experienced developer, split by phase, including tests and device QA.
9. **Identify privacy/security gaps** for shared devices, lost phones, and local data retention. Is a local screen lock worth it?
10. **Suggest a smaller first release** that still delivers real value (for example, install + offline read + Excel round-trip).
11. **Find hidden coupling** in the current codebase that would make this harder than it looks (direct axios calls, React Query cache assumptions, sessionStorage auth, grade lock logic, attendance guards).
12. **Propose objective pilot metrics:** sync success rate, conflict rate, blocked rate, duplicate rate, lost-work reports, time-to-sync, teacher satisfaction.

---

## 16. Key Files and Where to Look

Frontend:
- `src/pages/teacher/ClassRecordView.tsx`
- `src/pages/teacher/components/classRecordActions.ts`
- `src/pages/teacher/hooks/useScoreWriteQueue.ts`
- `src/pages/teacher/hooks/useClassRecord.ts`
- `src/pages/teacher/Attendance.tsx`
- `src/pages/teacher/AttendanceReports.tsx`
- `src/pages/teacher/MyAdvisory.tsx`
- `src/pages/teacher/StudentGradeProfile.tsx`
- `src/layouts/TeacherLayout.tsx`
- `src/lib/api.ts`
- `src/main.tsx`

Backend:
- `server/src/routes/grades.ts`
- `server/src/routes/grades-sub/classes.ts`
- `server/src/routes/attendance.ts`
- `server/src/routes/auth.ts`
- `server/src/lib/tokens.ts`
- `server/src/lib/termFinalization.ts`
- `server/src/middleware/auth.ts`
- `server/src/middleware/rateLimiter.ts`
- `server/src/index.ts`
- `server/prisma/schema.prisma`

Tests and infra:
- `e2e/offline/*` (integration outage rig, not browser offline)
- `server/src/__tests__/*`
- `playwright.config.ts`
- `ecosystem.config.cjs`
- `docs/DEPLOYMENT_RUNBOOK.md`

---

## 17. Review Request

Please produce:
1. A critique of the problem framing and whether the feature is worth building versus simpler alternatives.
2. A recommended architecture, with a clear preference and reasons.
3. A list of failure modes this plan misses.
4. A smaller first-release recommendation.
5. A realistic effort estimate and pilot plan.

Assume the constraints in Section 4 are real. Do not assume unlimited time, unlimited server capacity, or perfect connectivity.
