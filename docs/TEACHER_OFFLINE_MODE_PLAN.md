# Teacher Offline-First Mode - Plan (DEFERRED)

> **CURRENT DECISION (2026-11-10): DO NOT IMPLEMENT THIS YET.**
> The approved first release is the **online-only teacher PWA** in `docs/PWA_ONLINE_FIRST_PLAN.md`.
> This offline-first plan is kept for a later decision after real teacher usage. Sections 4-13 describe the future design, not current work.

**Status:** Deferred planning only. No application code changed.
**Scope:** Full daily teaching workflow for the teacher portal (`/teacher/*`). Admin and registrar stay online-only.
**Goal:** A teacher can open SMART on a phone with no internet, do the normal daily work — grades, grade tools, attendance, advisory viewing, reports — and have all of it sync automatically and safely when the connection returns.
**Approved decisions (2026-11-10):**
1. Locked-term work is kept and marked blocked; teacher uses the edit-request flow.
2. Conflicts are shown to the teacher; never silently overwritten.
3. "Remember this device" is approved for teachers (Section 4.3).
4. Logout recommendation accepted pending confirmation of Section 4.4 wording.
5. Offline scope is expanded beyond grades and attendance (Section 7).

---

## 1. Plain-English Summary

### What the teacher gets

1. The app is installed on the phone (PWA).
2. Before losing signal, the teacher opens the app once while online. SMART quietly saves the class lists, rosters, grades, and attendance it needs onto the phone.
3. With no internet, the teacher can still:
   - Open the app.
   - View the dashboard, schedule, class list, advisory roster, and student profiles from the saved copy.
   - Open class records for all their classes. The current term is always cached; past terms are cached after the teacher opens them once online.
   - Type scores into the grade ledger.
   - Add or remove WW/PT tasks, change HPS/max scores, and edit assessment details.
   - Take attendance and use "Save and next day".
   - View the monthly attendance report computed on the device.
4. Every offline save is shown as **"Saved on this device"**, with a small "waiting to sync" count.
5. When the internet returns, SMART sends the saved work to the server automatically.
6. If something cannot be saved (for example, the term was already locked), the work is **not deleted**. It moves to a "Needs attention" list where the teacher can review it, retry it, or ask for edit access.

### What the teacher does NOT get (clearly out of scope)

- No offline admin or registrar work.
- No offline school forms, SF9/SF10 generation, or printing.
- No offline Excel import/export, AIMS sync, EnrollPro sync, or account settings.
- No offline "clear all scores" (kept online-only because it is destructive and rare).
- No automatic merge if two devices edit the same student. Conflicts are shown to the teacher, never silently overwritten.
- No offline first-time login. "Remember this device" (approved) lets a previously signed-in teacher reopen the installed app offline.
- No guarantee if the browser evicts local storage; the app warns and lets the teacher sync early.

### The one-sentence mental model

The phone keeps a **notebook** (local database) and an **outbox** (pending changes). Reading uses the notebook when offline. Saving writes to the notebook and the outbox. Reconnecting delivers the outbox to the school system, one item at a time, with a receipt for each.

---

## 2. Scope

### In scope — full daily teacher workflow

**Writes that work offline**

- Per-cell grade scores: WW, PT, QA, EX.
- Assessment details (column description and date) and column-level edits.
- Add task (WW/PT), remove task, and HPS/max-score changes.
- Attendance status and remarks, including "Save and next day".
- Everything above survives reload, app restart, and network loss.

**Reads that work offline**

- Teacher dashboard (cached).
- Schedule (cached).
- Class list with offline-ready badges.
- Class record for the current term (cached by default). Past terms are cached after the first online open, or via the "Prefetch all terms" option.
- Advisory roster, student basic profile, and student grades the teacher is allowed to see.
- Attendance for the current and previous month (cached) plus a locally computed monthly SF2 summary.
- Public settings, transmutation table, school year/term labels, theme/branding.

**Platform**

- Teacher PWA installation and app shell (from the earlier PWA plan).
- Persistent "Remember this device" session for the installed teacher app.
- Local database and outbox that survive reloads and restarts.
- Automatic sync on reconnect, app start, and visibility change.
- Idempotent server sync (safe to retry; no duplicates).
- Conflict, lock, and rejection handling with no silent data loss.
- Offline status UI: banner, per-class badges, pending-cell indicators, sync center.
- Per-user local data, wipe on logout, no tokens in IndexedDB.
- Automated regression gates and rollback plan.

### Out of scope (deliberate)

- Admin/registrar offline.
- School forms, SF1/SF5/SF9/SF10 generation or printing.
- Excel import/export.
- AIMS sync or writes.
- EnrollPro sync actions.
- "Clear all scores" (online-only: rare, destructive, easy to undo server-side only).
- Account/settings changes while offline.
- Multi-device live collaboration.
- Background Sync as the primary mechanism (iOS Safari does not support it; the app-level queue is the source of truth).
- Offline encryption or a PIN vault. Device-level security only unless added later.

---

## 3. What the Codebase Already Has (verified)

| Area | Current reality | Consequence |
|---|---|---|
| Grade writes | `POST /api/grades/grade` (one student) and `POST /api/grades/grade/batch` (up to 200 students). Grade scores are stored as JSON arrays per term. | Good fit for the outbox. Batch endpoint can be extended or reused. |
| Attendance writes | `POST /api/attendance/bulk` upserts one section/date roster in a transaction. | Good fit: one outbox item per section + date. |
| Existing score queue | `src/pages/teacher/hooks/useScoreWriteQueue.ts` already debounces, batches, retries 3 times, then **clears pending edits and shows an error**. It is in-memory only. | This is the exact gap. Offline work must never be cleared. The queue must become persistent. |
| Grade reads | `useClassRecordQuery` centralizes class record fetches under `["class-record", id, term]`. | One good choke point for network-or-cache reads. |
| Attendance reads | `Attendance.tsx` calls `axios` directly. | Must be refactored through one data client before offline cache is possible. |
| Auth | Access token 15 minutes, refresh token 7 days. Tokens live in `sessionStorage`. CSRF cookie is checked on writes. | Short offline gaps are fine. Offline longer than 7 days requires re-login. Closing the installed app clears the session unless we add persistent session. |
| Local storage | No IndexedDB today. React Query has no persistence. Only `localStorage` for UI preferences and mobile drafts. | New local database layer required. |
| Sync stream | SSE `/api/integration/sync/stream` informs the app when background syncs complete. | Useful trigger for refreshing local snapshots when online. |
| Existing "offline rig" | `e2e/offline/*` simulates EnrollPro/ATLAS/AIMS outages. It is **not** browser-offline testing. | A separate browser offline test suite is required. |
| Grade locks | Server checks archived class, year lock, term lock, current-term rules, and approved edit requests at save time. | Offline work can become invalid while the teacher is disconnected. Sync must return a clear, non-destructive "blocked" result. |
| File serving | Backend serves `dist` at `:5003`; PM2 currently runs a Vite dev client. | Production must serve the built app for the PWA to exist. |

---

## 4. Product Rules (approved unless marked otherwise)

These are policy decisions, not technical preferences. Each one changes the implementation.

### 4.1 Lock and deadline policy — APPROVED

When offline work reaches the server after the term/year is locked:

- The server returns `BLOCKED` with a clear code and message.
- The teacher's work is kept on the device and shown in the sync center.
- The teacher can use the existing edit-request flow and retry after approval.
- The device clock (`capturedAt`) is audit metadata only. It never bypasses a lock.

### 4.2 Conflict policy — APPROVED

If the server version changed after the teacher's offline copy was taken:

- The server returns `CONFLICT` and does not overwrite.
- The sync center shows "This device" versus "Server".
- The teacher chooses:
  - Keep this device (creates a new mutation based on the current server version, still subject to locks).
  - Keep server (discards the local item after confirmation).
  - For grade scores, review cell by cell where possible.

### 4.3 Session persistence — APPROVED

"Remember this device" is enabled for teachers:

- A checkbox on the teacher login: "Keep me signed in on this device".
- Default OFF. The teacher must opt in.
- Available only when the app is installed (standalone display mode). Browser sessions continue to use `sessionStorage`.
- Stores only the teacher refresh token and user id in `localStorage`, never in IndexedDB and never the access token.
- Remembered refresh token lifetime: 30 days, rotating on each successful refresh. Normal sessions stay at 7 days.
- Signing out removes the remembered token immediately.
- Password change / admin revocation invalidates remembered refresh tokens through the existing refresh-token family revocation.
- Shared-device warning is shown when enabling it: "Only use this on a device you control. Cached grades and attendance remain on this device until you sign out."
- On cold start offline, the app opens in a clearly labelled offline state using cached data. Nothing is sent until connectivity returns and the token refresh succeeds.

Optional Phase 6 hardening for shared devices: a local 4-6 digit app screen lock on cold start. It deters casual access but is not encryption; do not advertise it as encryption.

### 4.4 Logout and device cleanup — BEST PRACTICE (recommended)

The best balance of "never lose a teacher's work" and "never leak student data on a shared device":

1. **Logout while online with pending work**
   - Attempt sync immediately.
   - If everything syncs: normal logout, wipe local teacher data, go to login.
   - If blocked/conflict items remain: show the choices below.

2. **Logout while offline or with unsynced items still remaining**
   - Default and recommended option: **Stay signed in** (the work is not at risk).
   - Other options:
     - **Sign out and keep work on this device**: the outbox and cached data stay, keyed to this teacher. Only the same teacher can recover it after signing back in. A different account signing in wipes it. A 7-day recovery window applies after the last activity, then the unsynced work is discarded with a warning in the sync center on the next login.
     - **Discard work**: type `DISCARD` to confirm; deletes the outbox and cached data for this teacher on this device.
   - Remembered-device token is always removed on sign out. Recovering unsynced work requires signing back in.

3. **A different teacher signs in on the same device**
   - The previous teacher's cached data and outbox are wiped before the new session starts. No cross-account leakage.

4. **No pending work**
   - Normal logout wipes all teacher cached data and the remembered token.

This behavior is implemented once in the logout dialog and reused by the sidebar, bottom nav, and session-expiry redirect.

### 4.5 What is editable offline — APPROVED (expanded)

Offline writes:

- Per-cell scores in WW, PT, QA, EX.
- Assessment details and column metadata.
- Add task (WW/PT).
- Remove task (WW/PT), with a local backup snapshot and confirmation.
- HPS/max-score changes.
- Attendance status, remarks, and save-and-next-day.

Online-only writes:

- Clear all scores.
- Excel import/export.
- AIMS actions.
- EnrollPro sync.
- School forms and printing.
- Account/settings changes.

### 4.6 Multi-device — RECOMMENDED: ALLOWED

A teacher may use a phone and a laptop. Each device has its own outbox and device id. The server treats each device as a separate writer and uses version checks. Conflicts are shown, never merged silently.

If the school wants stricter control, a later admin setting can limit offline editing to one registered device, but it is not required for the first release.

---

## 5. Architecture

### 5.1 Diagram (mental model)

```text
 Teacher types a score / marks attendance
                  |
                  v
        +---------------------+
        |  UI (optimistic)    |
        +----------+----------+
                   |
                   v
        +---------------------+        online, success
        |  Teacher Data Client | ----------------------> Server API
        |  (single write path) |                              |
        +----------+----------+                              v
                   |                                  normal response
                   v
        +---------------------+        offline / failure
        |  IndexedDB          | <----------------------------+
        |  - snapshots        |
        |  - outbox           |
        |  - sync log         |
        +----------+----------+
                   |
          reconnect / online event / timer / visibility
                   |
                   v
        +---------------------+
        |   Sync Engine       | ---> POST /api/offline-sync/mutations
        |  (one item at a    | <--- per-item receipt (applied/duplicate/
        |   time, backoff)    |       conflict/blocked/rejected)
        +---------------------+
                   |
                   v
        Update local state + React Query cache + UI badges
```

### 5.2 Local database stores (IndexedDB, via Dexie)

| Store | Key | Contents | Notes |
|---|---|---|---|
| `meta` | key | schema version, user id, device id, last full sync, app version | Small. |
| `snapshots` | `kind:id` | class list, class record per class/term, attendance day, attendance month, advisory, public settings, transmutation table | Includes `cachedAt` and source version fields. |
| `outbox` | `clientMutationId` | one pending write | Indexed by user, state, entity key, captured time. |
| `syncLog` | auto id | receipts and errors, capped at 200 per user | For the sync center and PM2 reporting. |
| `conflicts` | `clientMutationId` | local and server versions | Kept until resolved. |

Rules:

- Never store access or refresh tokens in IndexedDB.
- Every record is scoped by `userId`.
- `navigator.storage.persist()` is requested after install; storage usage is shown in the sync center.
- A schema version upgrade must migrate, never silently wipe pending work.

### 5.3 Outbox item shape

```ts
type MutationKind =
  | "GRADE_SAVE"        // one student's full score payload for a term
  | "GRADE_STRUCTURAL"  // atomic class+term change: add/remove task, HPS, assessment meta
  | "ATTENDANCE_BULK";  // one section + one date, full roster

interface OutboxItem {
  clientMutationId: string;      // UUID, generated once, reused on every retry
  userId: string;
  deviceId: string;
  kind: MutationKind;
  entityKey: string;             // grade: classAssignmentId|term|studentId
                                 // structural: classAssignmentId|term
                                 // attendance: sectionId|date
  payload: unknown;              // exact server request body
  baseVersion: number | null;    // row version the edit was based on
  baseRevision: number | null;   // class+term revision for structural changes
  capturedAt: string;            // device time, audit only
  state: "PENDING" | "SYNCING" | "CONFLICT" | "BLOCKED" | "REJECTED";
  attempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}
```

Hard rules:

- `clientMutationId` is generated once and never changes.
- Multiple score edits for the same student/term merge into one item before it is sent.
- Grade structural operations are atomic for the whole class+term. There is no partial application.
- Items are deleted only after a receipt says `APPLIED` or `DUPLICATE`.
- A terminal failure (`BLOCKED`, `REJECTED`, `CONFLICT`) stays until the teacher resolves it.
- Retryable failures (network, 5xx, 429, expired access token after refresh attempt) stay `PENDING` with exponential backoff and a cap.
- Structural items always sync after earlier grade items for the same class+term; the engine updates its base revision from each receipt.

### 5.4 Sync engine

Triggers:

- Browser `online` event.
- App start and teacher login.
- Every 30-60 seconds while online with pending work.
- When the tab becomes visible.
- After a successful token refresh.

Behavior:

- Single-flight: only one sync loop at a time.
- Oldest item first; one request per item; small batch grouping for grades of the same class/term is allowed.
- Exponential backoff: 2s, 5s, 15s, 60s, 5m, capped at 15m, with 0-60s random jitter so devices do not all reconnect at the same second.
- Distinguish terminal from retryable failures.
- On `401`, run the normal refresh flow once; if refresh fails, pause sync and prompt login. Do not touch the outbox.
- On `409` from version checks, fetch the server copy and create a conflict record.
- On success, replace local optimistic state with the server response and invalidate the relevant React Query keys.
- Log a compact sync summary to the server (`[offline-sync]`) for PM2 visibility. No student names, no scores, no tokens.

### 5.5 Server changes

New endpoint:

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
      "payload": { ... same body as /grades/grade ... }
    },
    {
      "clientMutationId": "uuid-structural",
      "kind": "GRADE_STRUCTURAL",
      "entityKey": "classId|T2",
      "baseRevision": 17,
      "capturedAt": "2026-11-10T08:20:00.000Z",
      "payload": {
        "classAssignmentId": "classId",
        "term": "T2",
        "operation": "HPS_UPDATE",
        "updates": [ ... full per-student grade payloads ... ]
      }
    },
    {
      "clientMutationId": "uuid-attendance",
      "kind": "ATTENDANCE_BULK",
      "entityKey": "sectionId|2026-11-10",
      "baseVersion": null,
      "capturedAt": "2026-11-10T07:30:00.000Z",
      "payload": { "sectionId": "sectionId", "date": "2026-11-10", "attendance": [ ... ] }
    }
  ]
}

200 {
  "results": [
    { "clientMutationId": "uuid", "status": "APPLIED", "version": 5, "revision": 18, "serverData": { ... } },
    { "clientMutationId": "uuid-2", "status": "DUPLICATE", "version": 5, "revision": 18 },
    { "clientMutationId": "uuid-3", "status": "CONFLICT", "serverData": { ... } },
    { "clientMutationId": "uuid-4", "status": "BLOCKED", "code": "TERM_LOCKED", "message": "..." },
    { "clientMutationId": "uuid-5", "status": "REJECTED", "code": "ENROLLMENT_INACTIVE", "message": "..." }
  ]
}
```

Rules:

- HTTP 200 for processed batches, even when some items fail; each item carries its own result. HTTP 401 only for authentication failure, 429 for rate limiting.
- Max 50 mutations per request; reject larger batches with 400.
- Rate limit: 60 requests/minute per user/IP.
- `clientMutationId` is unique per user. A repeat returns the stored result (`DUPLICATE`) without re-applying.
- Each mutation is applied in its own transaction, including the ledger insert. One failure does not roll back the others.
- Structural grade mutations are all-or-nothing for the class+term.
- `capturedAt` is audit metadata only. It never bypasses locks or term rules.
- Audit log entries include `source: "OFFLINE_SYNC"`, `capturedAt`, and `syncedAt`.

New Prisma model:

```prisma
model SyncMutation {
  id               String   @id @default(cuid())
  userId           String
  deviceId         String
  clientMutationId String
  kind             String
  entityKey        String
  status           String
  payload          Json
  result           Json?
  errorCode        String?
  errorMessage     String?
  capturedAt       DateTime
  receivedAt       DateTime @default(now())
  appliedAt        DateTime?
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, clientMutationId])
  @@index([userId, receivedAt])
  @@index([status])
}

model GradeSetRevision {
  id                String   @id @default(cuid())
  classAssignmentId String
  term              Term
  revision          Int      @default(1)
  updatedAt         DateTime @updatedAt

  @@unique([classAssignmentId, term])
  @@index([classAssignmentId])
}
```

Optimistic concurrency:

- Add `version Int @default(0)` to `Grade` and `Attendance`.
- Update with `where: { id, version: baseVersion }` and increment. Zero updated rows means a conflict.
- For new rows, `baseVersion = null`. If the row now exists, return a conflict instead of silently overwriting.
- Every grade write increments `GradeSetRevision.revision` for its class+term.
- Structural grade mutations require `baseRevision` to match the current revision. This prevents column misalignment when another device added or removed a task.
- Existing save routes also accept optional `baseVersion` / `baseRevision` so online edits get the same protection. If omitted, they behave as today (backward compatible).

Refactor for reuse:

- Extract the grade and attendance write rules from the route handlers into:
  - `server/src/services/gradeWriteService.ts`
  - `server/src/services/attendanceWriteService.ts`
- Existing routes and the new offline-sync route both call these services. No duplicated lock or validation logic.
- Routes stay thin, per repository rules.
- Structural operations use the existing `saveGradeBatch` logic internally so weight/HPS/column rules stay in one place.

### 5.6 Read path (network-or-cache)

One client module becomes the only read/write gateway for offline-capable teacher pages:

- `src/lib/offline/teacherDataClient.ts`

Behavior:

- Online: call the API, write a snapshot, return fresh data with `source: "network"`.
- Offline or network error: return the newest snapshot with `source: "cache"` and `cachedAt`.
- No cache for endpoints that are not explicitly allowlisted.
- Never cache `/api/auth/*`, `/api/uploads/*`, admin, registrar, or integration endpoints.

Wrapped reads (Phase 1):

- `getMyClasses`
- `getClassRecord(classAssignmentId, term)`
- `getAttendanceSection(sectionId, date)`
- `getAdvisory`
- `getPublicSettings`
- `getTransmutationTable`
- `getDashboard` (read-only cache)

Not cached: reports that need server aggregation, school forms, audit logs, anything admin/registrar.

### 5.7 Prefetch ("prepare for offline")

After teacher login and after a successful full sync:

1. Fetch `my-classes` and the dashboard shell.
2. For each active class, fetch the **current term** class record first. Past and future terms are cached lazily the first time the teacher opens them online. "Prefetch all terms" is an explicit option in the sync center.
3. Fetch the advisory roster, student basic profiles, and attendance for the current and previous month (weekdays only).
4. Fetch the schedule, public settings, and the transmutation table.
5. Cache the latest notifications for read-only display.
6. Store snapshots with a school-year + term fingerprint.
7. Show "Available offline" on the class card when its snapshot is complete.

Refresh prefetch when:

- The SSE `syncVersion` changes.
- The app returns online after more than 15 minutes.
- The teacher opens a class record, attendance page, or advisory page while online.
- The teacher presses "Refresh offline data" in the sync center.

Prefetch must be resumable. If it is interrupted (app closed, network lost), it continues on the next online opportunity and never deletes existing snapshots first.

To avoid a login-time stampede in a large school:

- Stagger prefetch by a random 0-10 minutes after login when more than a few classes are involved.
- Concurrency stays at 2.
- Skip prefetch when the device already has a fresh snapshot for that class+term.
- Use conditional requests (ETag/If-None-Match) where the API supports them.

Storage estimate for a typical teacher: 5 classes x 40 students x current term, plus two months of attendance, is typically 2-5 MB. Prefetching all three terms stays under 10-15 MB. The sync center shows actual usage.

### 5.8 Attendance offline specifics

- One outbox item per `sectionId + date` with the full roster statuses.
- `Save and next day` prefetches the current and previous month for the advisory section, so it works offline for those cached dates.
- Monthly SF2 statistics are computed locally from cached records plus pending changes. Days from `AttendanceReports` are merged in the same local calculation. If a required day is not cached, show "Stats incomplete offline" instead of a wrong number.
- The attendance report page works offline for the cached month and clearly labels it as device data. Excel export stays online-only.
- Clearing a day's attendance stays online-only.
- Access is already advisory-scoped server-side; keep that.

### 5.9 Grade offline specifics

- Per-cell edits: one outbox item per `classAssignmentId + term + studentId`, containing the full score payload for that student.
- Multiple cell edits for the same student merge before sending.
- Optimistic UI applies the score immediately and marks the cell as pending.
- Assessment details typed offline are part of the same payload.
- Offline-supported grade tools (queued as atomic `GRADE_STRUCTURAL` items):
  - Add task (WW/PT).
  - Remove task (WW/PT), with a local backup snapshot and a confirmation dialog.
  - HPS/max-score changes.
  - Assessment metadata propagation across the class.
- Structural operations are all-or-nothing. If another device changed the class+term revision, the whole operation is a conflict; nothing is partially applied.
- Online-only grade actions (disabled with a clear message offline):
  - Clear scores.
  - Excel import.
  - AIMS writes.
- Inherited grades and rotation data come from the cached class record; they remain read-only.
- If the cached lock state says the term is locked, editing is disabled offline. If the server locks it later, the queued item becomes `BLOCKED` at sync time and the work is preserved.

### 5.10 Connectivity detection

`navigator.onLine` is not trustworthy (it can be true with a captive portal or no internet).

- Treat the app as offline after a network request fails with a network error or timeout.
- Probe `/api/health` with a 5-second timeout when the browser reports online and pending work exists.
- Show three states: `Online`, `Offline`, `Checking`.
- Never block reading cached data while checking.

### 5.11 Scalability and limits

**Per device**

- A typical teacher's offline data (5 classes x 40 students x 3 terms + 2 months attendance) is well under 10 MB.
- Browser storage quotas are typically hundreds of MB to multiple GB. This feature will not fill a phone.
- The local database is per teacher and per device. More teachers means more devices, not one larger central store.
- Prefetch uses concurrency 2 and resumes safely, so a login storm does not hammer the server.
- `persist()` is requested, but eviction remains possible; the app warns and syncs early.

**Server**

- The sync endpoint is indexed by `userId + clientMutationId`; duplicate checks are a unique-index lookup.
- Sync bursts after a school-wide outage are spread with jitter, per-user rate limits, and single-flight execution.
- Batch cap is 50 mutations per request. A teacher's queue drains in small, predictable chunks.
- `SyncMutation` rows grow with usage. Add a retention job: keep 180 days (configurable), then prune. Keep aggregate counts for reporting.
- Conflict frequency scales with how many people edit the same class at the same time. In this system that is normally one teacher per class, so conflicts should be rare.
- PM2 logs are summaries only (`[offline-sync]` counts and durations), so log volume stays small.

**Deployment limit**

- The architecture is sized for the intended deployment model: one school per isolated stack, as documented in the deployment runbook.
- It is not a district-wide multi-tenant design. Running many schools on one database would require additional tenancy work that is out of scope.

### 5.12 Large-school sizing (e.g., 13,000 students)

**The key point: no phone ever stores the whole school.**

- A teacher caches only the classes they teach. At 13,000 students school-wide, a teacher with 8 classes x 50 learners still caches about 400 students, not 13,000.
- 400 students x current term is typically 2-4 MB including scores. That is negligible for a phone.
- Even an extreme teacher with 20 classes x 60 students stays around 10-20 MB.

**The real pressure points at 13k students are server-side, not phone-side.**

| Pressure point | Why it grows | Mitigation in this plan |
|---|---|---|
| Grade rows | 13k students x subjects x terms | Existing PostgreSQL design; indexes already exist on `studentId`, `classAssignmentId`, `term`. 13k is modest for Postgres. |
| Sync ledger | One row per offline change | 180-day retention + indexes on `userId + clientMutationId` and `status`. |
| Login-time prefetch | Many teachers open the app at 7-8 AM | Current-term-first caching, 0-10 minute stagger, concurrency 2, resumable prefetch, conditional requests. |
| Reconnect burst | Everyone returns online together | Jitter, per-user single-flight, 50-item batches, 429 + Retry-After handling, optional global concurrency cap on the sync endpoint. |
| Audit volume | Offline writes create audit entries | Reuse the existing audit pipeline; log compact summaries, not payloads. |

**Ways to reduce data further (in order of value)**

1. **Cache the current term only by default.** Past terms load on first online open. This cuts storage by roughly two-thirds with almost no loss for daily offline work. (Already in the plan.)
2. **Store IDs, not repeated text.** Snapshots store `studentId`, score arrays, and status codes. Names and section labels come from the cached roster, not duplicated into every grade record.
3. **Compact attendance codes.** Store `P/A/L/E` codes and a remarks map, not repeated labels.
4. **Delta sync for scores (optional optimization).** Instead of sending the full score array for a student, send only the changed cells plus the base version. Usually a 70-90% smaller request. Add it only after the full-payload version is proven; it increases server merge complexity.
5. **Compress large snapshots on the device (optional).** If a device exceeds ~25 MB, gzip the snapshot JSON with the browser's built-in `CompressionStream` and store it as a Blob. Scores compress well (often 5-10x). Do not enable by default: it makes debugging harder, and normal per-teacher data does not need it.
6. **Never cache files.** No Excel exports, no PDFs, no school form templates, no `/uploads` images beyond the current logo cache.

**Do not compress blindly**

- The plan measures first: the sync center shows exact storage usage and warns above 25 MB.
- Compression is a fallback for extreme cases, not the primary strategy. The primary strategy is "cache only this teacher's current work".

**Server sizing reality check**

- 13,000 students is not large for PostgreSQL. An offline ledger of a few hundred thousand rows over a term is routine, indexed, and pruned.
- What matters is avoiding a thundering herd at 7:30 AM. The stagger + jitter + rate-limit combination is the safeguard, and it can be tuned without changing the architecture.
- If the school ever grows to district scale (many schools, one database), that is a separate tenancy project, not a PWA problem.

---

## 6. User Experience

### 6.1 Global status banner

A slim, non-blocking banner below the teacher top bar:

- `Offline - changes are saved on this device` (amber-ish semantic warning token, not raw palette).
- `Syncing 3 changes...`
- `3 changes need attention` (links to the sync center).
- `All changes synced` (brief, auto-dismiss).

### 6.2 Save feedback

- Online and synced: existing success toast.
- Offline: "Saved on this device. Will sync when online."
- Pending cell: subtle indicator on the grade cell and student row.
- Failed retryable: "Still trying. Check connection."
- Blocked/conflict: persistent entry in the sync center, plus a badge on the affected class.

### 6.3 Sync Center

A teacher-only sheet or page, reachable from the status banner and sidebar:

- Pending count and oldest pending age, grouped by Grades and Attendance.
- Per-item: class, term, student or attendance date, captured time, state, retry button.
- Structural items appear as one row: "Add WW task 4 (Class 7-Mabini, T2)" or "HPS change WW3 (Class 7-Mabini, T2)".
- Recovered work banner after signing back in: "3 unsynced changes were recovered on this device."
- Conflicts: compare "This device" vs "Server", with actions:
  - Keep this device (creates a new mutation on the current server version, respecting locks).
  - Keep server (discards local item after confirmation).
  - For grades: review cell by cell.
- Blocked: reason, "Request edit access" link, copy/export values.
- Rejected: reason, copy/export values.
- Storage: "Using 3.2 MB. Keep this app installed to reduce data cleanup risk."
- No student data beyond what the teacher already sees on the class page; no scores in URLs or logs.

### 6.4 Offline readiness

- Class card badge: `Available offline` when snapshots are complete.
- Class card warning: `Open once online to enable offline` when not cached.
- First-run sheet after install: "Open your classes once while online so you can grade offline."

### 6.5 Online-only actions

Buttons remain visible but disabled offline with an inline reason: "Clear scores needs internet." Do not hide actions silently; a teacher must know the action exists but is unavailable.

### 6.6 Accessibility

- Status banner uses `role="status"` and `aria-live="polite"`.
- Pending indicators have text alternatives, not color alone.
- Sync center is a keyboard-accessible dialog/sheet.
- Tap targets at least 44-48px.
- Semantic tokens only; no raw palette colors, per repository rules.

---

## 7. Coverage Matrix

| Page / action | Offline read | Offline write | Notes |
|---|---|---|---|
| Teacher dashboard | Yes (cached) | No | Read-only cache; labels data as device copy. |
| Schedule | Yes (cached) | No | Read-only cache. |
| My classes list | Yes | No | Prefetched after login. |
| Class record ledger | Yes (cached) | Yes, per-cell scores | Core feature. |
| Assessment details (column description/date) | Yes | Yes | Part of the grade payload. |
| Add task / remove task | Yes | Yes | Atomic structural mutation; remove keeps a local backup. |
| HPS / max-score changes | Yes | Yes | Atomic structural mutation. |
| Clear scores | Yes | No | Deliberately online-only. |
| Attendance (advisory) | Yes (cached months) | Yes | Includes save-and-next-day for cached dates. |
| Attendance reports (SF2 summary) | Yes | No | Computed from cached + pending data; export stays online-only. |
| My advisory | Yes (cached) | No | Read-only roster and basic profiles. |
| Student grade profile | Yes if cached | No | Only grades the teacher is allowed to see; cached after viewing online. |
| Notifications | Yes (last cached) | No | Read-only. |
| Sync center | Yes | Yes | Local queue management; works offline. |
| Remembered offline login | Yes | No | Installed teacher app only, opt-in. |
| Excel import/export | No | No | Online-only. |
| AIMS | No | No | Online-only. |
| EnrollPro sync | No | No | Online-only. |
| School forms / SF9 / SF10 / printing | No | No | Out of scope. |
| Account settings / password change | No | No | Online-only. |

---

## 8. Security and Privacy

- Student names, grades, and attendance are sensitive. The local database is plain IndexedDB, protected by device security only.
- No tokens in IndexedDB or localStorage unless the "Remember this device" decision is approved; even then, only the refresh token, and only for the teacher portal.
- Local data is scoped by `userId`. A different account cannot read another teacher's snapshots.
- Logout policy per Section 4.4. At minimum, offer "wipe local data" and explain the risk.
- No student data in sync logs, server logs, or PM2 output. Log only counts, durations, and error codes.
- CSRF and auth headers are added at send time, not stored with the outbox item.
- Cache only the minimum needed. Do not cache admin, registrar, integration, or `/uploads` responses.
- Request persistent storage; show a warning if the browser refuses. Treat eviction as a possible data-loss event and keep pending counts visible.
- Rollout to shared devices should recommend "Remember this device" off.

---

## 9. Testing and Anti-Regression Gates

### 9.1 New automated gates

1. **Unit tests (root, Vitest)**
   - Outbox merge rules (same student/term collapses).
   - Stable `clientMutationId` across retries.
   - Retry classification: network/5xx/429 retry; 400/403/409 terminal.
   - Queue survives simulated reload.
   - Logout keep/discard/recover rules.
   - Conflict state transitions.
   - No item is ever deleted on a retryable failure.
   - Structural items always sort after earlier grade items for the same class+term.
   - Remembered-session expiry and wipe behavior.

2. **Server tests (Vitest)**
   - Same `clientMutationId` twice -> one row, one audit entry, `DUPLICATE` receipt.
   - `baseVersion` mismatch -> `CONFLICT`, no overwrite.
   - `baseRevision` mismatch on a structural mutation -> whole operation `CONFLICT`, no partial writes.
   - Structural operation applies all students or none.
   - Term/year/archived lock -> `BLOCKED`, payload preserved in the ledger.
   - Partial batch: one conflict does not block other mutations.
   - Rate limit and max batch size.
   - Audit source and captured/synced timestamps.
   - Attendance bulk idempotency.
   - Grade batch idempotency.
   - Remembered refresh token TTL and revocation on logout/password change.

3. **Browser offline E2E (Playwright, isolated DB)**
   - Seed a teacher, class, roster, advisory, and attendance month.
   - Open class record, attendance, advisory, and reports online; confirm snapshots.
   - `context.setOffline(true)`.
   - Enter scores, add a task, change HPS, take attendance, and save-and-next-day.
   - Reload the app; confirm pending values and pending badges persist.
   - Close and reopen the installed context with "Remember this device"; confirm offline open works.
   - View the offline attendance report; confirm the device-data label.
   - Back online; confirm sync and server values.
   - Trigger replay twice; confirm exactly one row per grade/attendance.
   - Simulate a server-side version revision bump; confirm structural conflict UI and no partial apply.
   - Simulate a term lock; confirm blocked UI and preserved payload.
   - Simulate expired refresh token; confirm re-login prompt does not delete the outbox.
   - Sign in as a different teacher; confirm the previous teacher's local data is wiped.

4. **Build/static gates**
   - Existing `pnpm run verify` remains green.
   - `check:pwa`: manifest, icons, service worker, no `/api` in precache.
   - `check:offline`:
     - Offline-capable pages do not import `axios` directly; they must use `teacherDataClient`.
     - Service worker never caches `/api`.
     - Outbox module has no `clear()` call in retryable failure paths (unit-tested).
     - Admin/registrar bundles do not import teacher offline modules.

5. **PM2 visibility**
   - Sync summary logs use the `[offline-sync]` prefix.
   - Verify with `pm2 logs server --lines 100 | Select-String "offline-sync"`.
   - Add a manual QA step that produces one success, one conflict, and one blocked receipt.

### 9.2 Existing gates must not change behavior

- `useScoreWriteQueue` online behavior must remain equivalent while online: debounce, coalesce, save, refresh.
- Existing grade-lock, term, archived, and edit-request tests must pass unchanged.
- Existing offline integration rig (`e2e/offline`) must not be modified except to add the new suite alongside it.
- No database changes to unrelated models.

### 9.3 Definition of done

- All gates above pass.
- Real-device tests: Android Chrome install + airplane mode; iOS Safari add to home screen + airplane mode.
- Force-quit and reopen offline with "Remember this device" enabled.
- Offline grade tools: add task, remove task, HPS change, assessment details.
- Offline attendance with save-and-next-day and monthly report.
- Offline advisory and student profile views for cached data.
- Shared-device test: second teacher cannot see the first teacher's cached data.
- Sync after 1 hour offline, after 8 hours offline, and after refresh-token expiry.
- Rollback drill completed.
- Runbook updated with HTTPS, install, remember-device, sync troubleshooting, and rollback.

---

## 10. Rollout and Rollback

### Rollout

1. Deploy server changes dark (new endpoint + ledger + version fields), with no client using them.
2. Ship the local data layer and read cache behind a feature flag (`VITE_TEACHER_OFFLINE`).
3. Enable offline writes for one pilot teacher or one device.
4. Monitor `[offline-sync]` logs: success rate, conflict rate, blocked rate, retry counts.
5. Expand to all teachers after one full week with zero data-loss reports.

### Rollback

- Stage 1: disable the client feature flag. Online saves keep working through the existing routes. The outbox remains on devices.
- Stage 2: provide "Export pending changes" (JSON/CSV) in the sync center before any cleanup.
- Stage 3: service worker kill switch (`selfDestroying` build) if the app shell itself is broken.
- Never ship a migration that drops `SyncMutation` or version columns while devices may still hold pending work.

---

## 11. Phased Delivery

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 | Decisions signed off; HTTPS confirmed; production serving built `dist`; test fixtures; device matrix | All approved decisions recorded; infrastructure confirmed |
| 1 | Local DB, snapshots, connectivity state, read cache for dashboard/schedule/classes/class records/attendance/advisory/reports, "Remember this device" | Offline read works; offline reopen works; existing online behavior unchanged; `verify` green |
| 2 | Outbox + server sync endpoint + ledger + version columns + class-term revision + audit + idempotency | Double-replay proves no duplicates; atomic structural tests pass |
| 3 | Offline per-cell score entry + pending UI + sync engine integration | Offline grade E2E passes; existing score queue behavior unchanged online |
| 4 | Offline grade structural tools: add/remove task, HPS, assessment metadata | Atomic conflict tests pass; remove-task backup works |
| 5 | Offline attendance, save-and-next-day, local SF2 summary, offline report page | Offline attendance and report E2E pass |
| 6 | Sync center, conflict/blocked/rejected UX, edit-request link, logout keep/recover/discard, shared-device wipe | Conflict, lock, logout, and account-switch scenarios pass |
| 7 | Hardening, storage persistence/warnings, PM2 log verification, device QA, pilot, docs, rollback drill | Pilot week with zero data-loss reports |

Each phase is its own commit and is independently revertible. No phase touches admin/registrar pages.

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| HTTPS not available on the school network | PWA/offline is impossible | Confirm before Phase 0; use a domain or Tailscale |
| PM2 runs the Vite dev client in production | Built service worker never reaches users | Serve `dist` (backend or nginx) |
| Refresh token expires while offline | Sync cannot authenticate | Preserve outbox; prompt re-login; same-user recovery |
| Installed app closed offline | Cannot reopen offline | Approved "Remember this device" session; offline open without network |
| Remembered device shared or stolen | Cached student data exposed | Opt-in only, shared-device warning, 30-day token, wipe on sign-out/other login, optional screen lock in Phase 6 |
| Term lock happens while offline | Work cannot be applied | Blocked state + edit-request flow; never discard |
| Two devices edit the same record | Lost update | Per-row version checks + class-term revision + conflict UI |
| Two devices change the column structure | Columns misaligned | Atomic structural mutations with `baseRevision`; no partial apply |
| Browser evicts storage | Pending work lost | `persist()`, storage warnings, install prompt, early sync |
| Remove-task applied incorrectly | Lost scores in a column | Local backup snapshot before queueing; atomic server apply; conflict review |
| API accidentally cached by service worker | Stale grades/locks, privacy leak | Denylist + build gate + no runtime API caching |
| Outbox retry storm | Server load, rate limits | Single-flight, exponential backoff, batch caps, 429 handling |
| Local PII exposure on shared devices | Privacy incident | Per-user wipe, logout policy, opt-in persistence, no tokens in IDB |
| Feature increases complexity of every page | Regression risk | One data client, one outbox, feature flag, phased rollout |

---

## 13. Decisions and Remaining Questions

### Approved

1. **Locks:** blocked + edit-request workflow. No grace window.
2. **Conflicts:** teacher review. No silent overwrite.
3. **Session:** "Remember this device" opt-in, installed teacher app only, 30-day rotating remembered refresh token.
4. **Logout:** keep-on-device with same-user recovery, discard with typed confirmation, and automatic wipe when a different teacher signs in (Section 4.4).
5. **Offline writes:** per-cell scores, assessment details, add/remove task, HPS, attendance, save-and-next-day.
6. **Offline reads:** dashboard, schedule, classes, class records, advisory, student profiles, attendance reports.
7. **Online-only:** clear scores, Excel, AIMS, EnrollPro, school forms, printing, account settings.
8. **Multiple devices:** allowed, with version/revision checks and conflict review.

### Still required before coding

1. **Production serving:** confirm the school accesses the app over HTTPS and that production serves the built `dist`, not the Vite dev server.
2. **Icon and branding:** approve static SMART icons for the installed app (school logo stays dynamic inside the app).
3. **Remove-task backup:** confirm that a local 7-day backup of the removed column is acceptable (recommended).
4. **Shared-device policy:** confirm the 7-day same-user recovery window after sign-out with pending work (recommended), or choose immediate wipe.
5. **Remembered-session TTL:** confirm 30 days (recommended) versus keeping the current 7 days.

Until items 1-2 are answered, no implementation should start. The plan is intentionally conservative: preserve work, never overwrite silently, and keep admin/registrar untouched.
