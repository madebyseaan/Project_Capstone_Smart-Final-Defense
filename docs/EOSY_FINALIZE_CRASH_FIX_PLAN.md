# FIX PLAN: EOSY Finalize Spam Crash (Registrar Portal)

> Handoff document for implementation agent. Read fully before starting.
> Verified against codebase on 2026-08-31. All file:line references confirmed.

---

## 1. Problem Statement

Registrar users spamming the "Finalize" buttons on the EOSY Finalization page (`src/pages/registrar/EOSYFinalization.tsx`) sometimes crashes/hangs the backend server. Observed symptoms:

- Server processes some finalizations, then client receives **429 Too Many Requests** on unrelated endpoints (`/api/admin/settings`, `/api/registrar/eosy/school-years`)
- Page breaks (theme/settings fail to load)
- Server becomes unresponsive or crashes under sustained spam

## 2. Root Cause (Verified)

Four issues combine into a cascade:

### 2.1 Frontend request burst — `handleFinalizeAll`
**File:** `src/pages/registrar/EOSYFinalization.tsx:293-352`

Triple nested loop fires sequential raw `fetch()` POSTs to `/api/registrar/finalize-grades`:

```
for subject in draftSubjects        (~10 subjects)
  for term in [T1, T2, T3]          (3 terms)
    for subjectId in subjectIds     (up to 3 rotational IDs)
      await fetch(...)              ← one POST each
```

Up to **~90 unthrottled POSTs** per click. Each POST triggers 3 Prisma queries (find classAssignment, find draftGrades, updateMany) = ~270 queries against a **10-connection pool** (`server/src/lib/prisma.ts:16-17`).

Also uses raw `fetch()` instead of the Axios `api` instance (`src/lib/api.ts`) — bypasses interceptors, no 429 handling, no retry.

### 2.2 No re-entry guard
**File:** `src/pages/registrar/EOSYFinalization.tsx:263-291, 293-352`

`handleEosyFinalize` and `handleFinalizeAll` set `eosyFinalizing` / `finalizingSubject` state (which may disable buttons) but **do not early-return if already running**. Rapid clicks / confirm-dialog races can stack concurrent runs.

### 2.3 Global shared rate limiter
**File:** `server/src/middleware/rateLimiter.ts:4-16`, applied at `server/src/app.ts:38`

Single `globalLimiter` = 300 req/min per IP shared across **all** `/api/*`. The finalize burst exhausts the bucket, so EVERY endpoint 429s — including `/api/admin/settings` (theme) and `/api/registrar/eosy/school-years`. Frontend has no 429 retry (Axios interceptor only handles 401, `src/lib/api.ts:93-140`).

### 2.4 No server-side concurrency protection
**File:** `server/src/routes/registrar/eosy.ts:106-151`, `server/src/routes/registrar/main.ts:1144-1209`

- `/eosy/finalize` calls `finalizeSectionEosy` (`server/src/lib/promotion.ts:427-511`): 4 heavy queries via `computeSectionPromotions` + a `$transaction` doing up to **~800+ queries** for a 40-student section (snapshot check + create per grade, enrollment updates). Spamming = many concurrent giant transactions on a 10-conn pool → pool timeout (P2024), deadlocks, memory pressure.
- No per-section in-flight lock: concurrent calls for the SAME section race on snapshot-exists-check → duplicate snapshot creation / unique constraint errors.
- No Express global error handler (`server/src/app.ts` ends at line 57 — nothing catches errors thrown outside route-level try/catch, e.g. from `validate()` middleware or async audit logging).

## 3. Fix Plan

Implement in phases. Phases 1-2 are mandatory; 3-4 strongly recommended. Do NOT refactor unrelated code (AGENTS.md rule).

---

### PHASE 1 — Backend: in-flight locking + global error handler

#### Task 1.1: Per-section in-flight lock utility
**Create:** `server/src/lib/sectionLock.ts`

```typescript
const locks = new Map<string, Promise<unknown>>();

export function withSectionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = locks.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => locks.delete(key));
  locks.set(key, p);
  return p;
}
```

- If a call for the same key is in-flight, the new caller awaits (and returns) the SAME promise — effectively dedupes concurrent spam. Idempotent operations make this safe.
- Key format: `eosy:{sectionId}:{schoolYear}` and `finalize-grades:{sectionId}:{term}:{subjectId}`.

#### Task 1.2: Wrap `/eosy/finalize` with the lock
**File:** `server/src/routes/registrar/eosy.ts:106-151`

Wrap the `finalizeSectionEosy(...)` call (line 112) in `withSectionLock(`eosy:${sectionId}:${schoolYear}`, ...)`. Route's existing try/catch and response shape stay unchanged.

#### Task 1.3: Wrap `/finalize-grades` with the lock
**File:** `server/src/routes/registrar/main.ts:1144-1209`

Wrap the DB work (findFirst + findMany + updateMany) in `withSectionLock(`finalize-grades:${sectionId}:${term}:${subjectId}`, ...)`.

#### Task 1.4: Express global error handler
**File:** `server/src/app.ts`

Add AFTER all routes (before `export default app`):

```typescript
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("[global-error-handler]", err?.message ?? err);
  if (res.headersSent) return;
  res.status(err?.status ?? 500).json({ message: "Internal server error" });
});
```

Import `logger` from `./lib/logger`. This guarantees no error escapes as an unhandled rejection / hanging connection.

---

### PHASE 2 — Frontend: guards + throttle + replace raw fetch

#### Task 2.1: Re-entry guards
**File:** `src/pages/registrar/EOSYFinalization.tsx`

- `handleEosyFinalize` (line 263): add `if (eosyFinalizing) return;` as first line.
- `handleFinalizeAll` (line 293): add `if (finalizingSubject) return;` as first line.
- `handleUnfinalizeAll` (line 354): same guard (`if (finalizingSubject) return;`).
- Verify the Finalize buttons render as `disabled` while `eosyFinalizing`/`finalizingSubject` are truthy (check `src/pages/registrar/components/EOSYOverviewTab.tsx:153` and `EOSYGradeLockingTab.tsx:67-94`). If not disabled, add it.

#### Task 2.2: Throttle the finalize loop
**File:** `src/pages/registrar/EOSYFinalization.tsx:320-339`

Insert `await new Promise(r => setTimeout(r, 100));` inside the innermost loop (after each fetch). ~90 requests × 100ms = ~9s worst case — acceptable for a bulk finalize, keeps well under rate limit and gives the DB pool breathing room.

#### Task 2.3: Switch raw `fetch` to the shared Axios instance
**File:** `src/pages/registrar/EOSYFinalization.tsx:315-339` (and the equivalent block in `handleUnfinalizeAll`, lines 354-412)

- Import the existing registrar API client (check how `registrarApi.finalizeEosySection` is imported — same module, likely `src/lib/api.ts` or a registrar api helper) and use it for the finalize/unfinalize POSTs. The Axios instance already attaches Authorization + CSRF headers.
- If no existing axios method exists for `POST /registrar/finalize-grades`, add one next to `finalizeEosySection` following the same pattern.
- Remove the manual `sessionStorage.getItem("token_registrar")` / cookie parsing once switched.

#### Task 2.4: Handle partial failures
**File:** `src/pages/registrar/EOSYFinalization.tsx:318-343`

Track failures in the loop instead of aborting on first throw:

```typescript
let failed = 0;
// inside loop:
try { ... } catch { failed++; }
// after loop:
setFinalizeMessage(failed > 0
  ? `Finalized ${totalFinalized} grades, ${failed} request(s) failed — try again for remaining`
  : `Finalized ${totalFinalized} grades across ${draftSubjects.length} subjects (all terms)`);
```

---

### PHASE 3 — Rate limiter tuning

#### Task 3.1: Skip low-cost GET endpoints
**File:** `server/src/middleware/rateLimiter.ts:10-14`

Add to the `skip` function:

```typescript
if (req.path.startsWith('/api/admin/settings')) return true;   // theme + term, needed by every page
if (req.path === '/api/health') return true;
```

Rationale: `/api/admin/settings` is fetched by ThemeContext on every mount; blocking it breaks the whole UI. It is a cheap read.

#### Task 3.2: Raise global limit (optional, small)
**File:** `server/src/middleware/rateLimiter.ts:6`

Consider `max: 600` if 300 proves tight with the throttled loop. With Phase 2's 100ms throttle this is likely unnecessary — decide after testing. Default: leave at 300.

---

### PHASE 4 — Optional hardening (only if time permits)

#### Task 4.1: Axios 429 retry with backoff
**File:** `src/lib/api.ts:93-140`

In the response interceptor, on `error.response?.status === 429` with no prior `_retry429` flag: wait ~2s (respect `Retry-After` header if present), set flag, retry once. Keep it minimal — single retry only.

#### Task 4.2: Bulk finalize endpoint (larger change — needs user sign-off)
A single `POST /api/registrar/finalize-grades-bulk` accepting `{ sectionId, items: [{term, subjectId}][]` and doing ONE `updateMany` per term would collapse ~90 requests into 1-3. Only do this if the user approves scope expansion; otherwise Phase 2 throttling suffices.

## 4. Constraints (from AGENTS.md)

- Do NOT modify `.env` or `.env.*` files
- Do not write to external systems (EnrollPro/ATLAS are read-only)
- Do not refactor unrelated code
- Types explicit, no `any` where avoidable; async/await only
- **Run `npm run build` in BOTH root (frontend) and `server/` before finishing** — zero type errors required
- Frontend dev check: `npm run dev`; backend: `cd server && npm run dev`
- Existing tests live in `server/src/__tests__/` — run them (`cd server && npm test` if a test script exists; check `server/package.json` first)

## 5. Acceptance Criteria

1. Rapidly clicking "Finalize EOSY" (Overview tab) 10+ times: only ONE concurrent `finalizeSectionEosy` executes per section; repeated clicks coalesce; UI stays responsive; no server crash.
2. "Finalize All" (Grade Locking tab): requests are visibly throttled; loop completes without tripping the 300/min limiter; `/api/admin/settings` and `/api/registrar/eosy/school-years` never 429 during the operation.
3. Buttons disabled + function guards prevent re-entry while an operation is in-flight.
4. A deliberately thrown error in any route (e.g., temporary throw in a dev branch) results in a clean 500 JSON response, not a hang or process crash.
5. `npm run build` passes in root and `server/`.
6. No changes to `.env*`, no unrelated refactors in the diff.

## 6. Verification Steps (manual)

1. `cd server && npm run dev`; root `npm run dev`
2. Login as registrar → EOSY Finalization page
3. Select a section with draft grades
4. Spam "Finalize EOSY" on Overview tab → expect: single operation, spam clicks ignored
5. Spam "Finalize All" on Grade Locking tab → expect: throttled progress, no 429s in network tab on settings/school-years, completes with success message
6. Watch server console: no unhandled rejection/crash; `ts-node-dev` does not restart
7. Re-run finalize on already-finalized section → idempotent success message (existing behavior preserved)

## 7. Files Touched Summary

| File | Change |
|---|---|
| `server/src/lib/sectionLock.ts` | NEW — in-flight dedup lock |
| `server/src/routes/registrar/eosy.ts` | Wrap finalize in lock |
| `server/src/routes/registrar/main.ts` | Wrap finalize-grades in lock |
| `server/src/app.ts` | Add global error handler |
| `src/pages/registrar/EOSYFinalization.tsx` | Guards, throttle, axios, partial-failure handling |
| `src/pages/registrar/components/EOSYOverviewTab.tsx` | Verify/add disabled state |
| `src/pages/registrar/components/EOSYGradeLockingTab.tsx` | Verify/add disabled state |
| `server/src/middleware/rateLimiter.ts` | Skip settings/health |
| `src/lib/api.ts` | (Phase 4 only) 429 retry; possibly finalize-grades method |
