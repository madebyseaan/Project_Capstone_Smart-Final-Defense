# Read-Path Resilience & Performance Plan

> Status: **PROPOSAL — NOT IMPLEMENTED (for review)**
> Related: `docs/SYNC_OUTAGE_GUARDRAIL_FIX_PLAN.md` (that one fixed destructive *writes*; this one is about slow *reads*)

## TL;DR — why the system lags when EnrollPro is offline

The guardrails fixed *writes*. But **read paths still call EnrollPro synchronously and wait** for the network
to time out before falling back. Specifically:

1. Several page-load API endpoints `await` EnrollPro directly.
2. Each EP HTTP call has a **20-second timeout** and **no retry cap on the chain** — and
   `getEnrollProTeachers()` chains **two** such calls (admin-token login → faculty feed), so one call can
   block **~40s**; the shared Atlas client (20s × 3 retries) can block **~80s**.
3. The in-memory cache exists but **fetches live on a miss** and is **wiped after every sync cycle**,
   including failed/partial ones — so the cache is useless exactly when EP is down.
4. There is **no request coalescing**, so N concurrent page loads = N × timeout waits.
5. The result: pages that should render instantly from the DB instead hang for 20–90s during an outage.

**Principle (mirrors the write-side guardrail):** *a read must never block on a dead dependency —
serve last-known data immediately, refresh in the background.*

---

## 1. Investigation — evidence

### 1.1 Where reads block on EnrollPro

| Endpoint / code | File:line | Blocks on |
|---|---|---|
| `GET /api/admin/users` | `routes/admin-sub/users.ts:66` | `getEnrollProTeachers()` |
| Teacher dashboard compose | `lib/teacherDashboardComposer.ts:185-189` | `getEnrollProTeachers()` + `getEnrollProSections()` + Atlas faculty |
| Grades pages / deadline | `routes/grades-sub/helpers.ts:76` | `getIntegrationV1ActiveTerm()` (live) |
| Login gate | `routes/auth.ts:85,134` | `getCachedEnrollProTeachers()` (good — uses cache, but still fetches on miss) |
| Integration proxies | `routes/integration.ts:349,399` | `getEnrollProTeachers()` |
| `syncVerification` report | `lib/syncVerification.ts:149,255` | `getEnrollProTeachers()` |
| Background sync only | `enrollproSync.ts:182`, `atlasSync.ts:114`, `prune.ts:575` | (fine — background) |

Endpoints most felt by users: **User Management** (`/admin/users`) and the **dashboards**.

### 1.2 Timeout / retry configuration

| Client | File:line | Timeout | Retries | Worst case |
|---|---|---|---|---|
| EnrollPro `fetchJSON` | `enrollproClient.ts:135` | **20 000 ms** | none per call | — |
| `getEnrollProTeachers` chain | `enrollproClient.ts:190-213` | 20s login + 20s faculty | — | **~40 s** |
| `getAllIntegrationV1Faculty` | `enrollproClient.ts:821-833` | pages via `fetchJSON` | — | ~20s/page |
| Atlas/EP shared `httpClient` | `sync/httpClient.ts:24-26,121` | **20 000 ms** | **3** (backoff 1+2+4s) | **~87 s** |
| EP health ping | `syncCoordinator.ts:634` | 5 000 ms | — | 5s |

So user-facing EP reads can hang **20–90 seconds** before the DB fallback runs.

### 1.3 Cache behaviour (the real problem)

- `syncCache.ts:90-100` `getCachedEnrollProTeachers()` → returns cache if fresh, **otherwise fetches live**.
  There is **no "serve stale on error"** path → an outage = guaranteed long wait, not a cache hit.
- `syncCoordinator.ts:418` calls **`invalidateAllCaches()` in the `finally` block of every cycle** —
  including **partial** cycles (EP down, Atlas up). So the cache is emptied every ~5 min during an outage.
- Several endpoints **bypass the cache** entirely and call `getEnrollProTeachers()` directly (§1.1).
- No **in-flight de-duplication**: concurrent requests each fire their own EP call.

### 1.4 `resolveCurrentTerm()` (grades)

- `helpers.ts:60-99`: 60s in-memory cache; on miss calls EP (20s); on failure falls back to DB
  (and caches the fallback 60s). Works, but **one cold request per minute still pays ~20s**,
  and concurrent cold requests stampede.

### 1.5 General performance observations (separate from EP)

- **Sync cycle cost:** every 5 min, `runUnifiedSync` does EnrollPro sync (learners/sections/teachers/
  enrollments) + prune + transferees + Atlas + AIMS + (hourly) branding/student-profiles. Observed
  cycles take **~18 s**. During that window the event loop and DB connection pool are busy → a
  perceptible periodic lag spike. `invalidateAllCaches()` at the end makes the next requests
  rebuild caches from scratch.
- **Background N+1:** `prune.ts:200-213` does `findUnique` per enrollment (background only).
- **Frontend:** routes are already `React.lazy`-split (good). Largest chunks: `BarChart` (recharts)
  337 kB, `index` 338 kB, `ClassRecordView` 149 kB, `SchoolForms` 132 kB. Recharts is heavy and
  loads with dashboards.
- **React Query:** `staleTime: 30s, retry: 1, refetchOnWindowFocus: false` (`main.tsx`) — reasonable.
- **DB indexes:** generally good on hot tables (Grade, ClassAssignment, Enrollment, Attendance).
  No blocking gap identified in the schema.

---

## 2. Root causes (ranked)

1. **Synchronous external reads on page-load paths** (blocking by design).
2. **Cache wiped every cycle** → cold misses during outages.
3. **No stale-while-error fallback** in the cache.
4. **20s timeouts + unbounded chains** for user-facing reads.
5. **No request coalescing** (stampede on cache miss).
6. **Heavy 5-min sync cycle** causing periodic contention.

---

## 3. Proposed fixes

> Same rules as before: small steps, one concern per change, `tsc` + build + tests +
> Playwright smoke test, commit each step, revertable independently. No dependency changes.

### R1 — Stale-while-error for the EP cache (highest impact, smallest change)
- In `syncCache.ts`, keep a **last-good** copy that survives TTL expiry.
- New helper `getEnrollProTeachersWithFallback()`:
  1. fresh cache → return it;
  2. stale cache present → return it **immediately** and refresh in the background;
  3. no cache → fetch with the **short timeout** and, on failure, return `[]` (never throw/hang).
- Same pattern for sections / school year / active term.
- **Evidence check:** user pages should return in <100 ms during an outage.

### R2 — Stop invalidating caches on failed/partial cycles
- `syncCoordinator.ts:418`: only `invalidateAllCaches()` when the cycle **completed with EP healthy**
  (e.g., `!epOffline` and no fatal error). Keep last-good data through outages.
- **Anti-regression:** when everything is healthy, behaviour is identical.

### R3 — Route page loads through the cached getter (no direct EP)
- Replace direct `getEnrollProTeachers()` in **request paths** with the cache-first helper:
  - `routes/admin-sub/users.ts:66`
  - `lib/teacherDashboardComposer.ts:186`
  - `routes/integration.ts:349,399`
  - `lib/syncVerification.ts:149,255`
- Leave the **background** callers (`enrollproSync`, `atlasSync`, `prune`) using the live client.

### R4 — Short timeouts + request coalescing for user-facing reads
- Add a `timeoutMs` override (default **2 500 ms**) for synchronous read paths; keep 20s for background sync.
- Add **in-flight de-duplication** (single promise per key) so concurrent requests share one EP call.
- Applies to `resolveCurrentTerm()` too: coalesce + short timeout + DB fallback.

### R5 — Keep the long timeout only for background work
- Verify background sync (EnrollPro/Atlas/AIMS) still uses the full 20s + retries; that's where
  robustness matters and no user is waiting.

### P1 — Sync-cycle & general performance (lower priority)
- Consider **splitting the 5-min cycle**: fast "essential" steps (sections/teachers) vs slow
  occasional steps (student profiles, branding, AIMS) scheduled less often.
- Add timing logs per phase to identify the heavy step (measure before optimizing).
- Review `prune.ts` N+1 (background, low user impact).
- Frontend: confirm dashboards don't eagerly import recharts on non-chart pages; consider
  `Suspense`-gating the chart chunk (already split, so likely minor).

---

## 4. Verification plan (per change)

- **Unit/behaviour:** add tests that simulate EP unreachable → assert the read returns **cached/DB data**
  and does **not** wait (e.g., resolve under a mocked timeout).
- `server: npm run build` + `npm test` (must stay 197 passed).
- Frontend build (if touched).
- **Playwright:** load `/admin/users`, a dashboard, and a grades page **while EP is unreachable**;
  assert pages render **fast** and show data (not a spinner/blank).
- Compare response times before/after (target: user-facing EP reads **< 200 ms** offline).

## 5. Rollback

- One commit per change; `git revert <commit>`. Safe checkpoint: current `main`.

---

## 6. Honest assessment: "are we optimized?"

**Mostly yes, with one real gap and a few nits.**

- The **architecture is sound**: DB is the offline cache, background sync keeps it fresh, routes are
  code-split, indexes are in place, React Query is configured sensibly.
- The **real gap** is that **read paths never got the "fall back to last-good" treatment** the write
  paths got. During an EP outage they block on 20–90s timeouts instead of serving the data SMART
  already has. That is the single biggest cause of the lag you're feeling right now.
- Secondary: the **5-min sync cycle** (~18s) causes periodic contention, and `invalidateAllCaches()`
  after every cycle makes caches colder than necessary.

Fix order that gives the most relief for the least risk: **R1 → R2 → R3 → R4/R5**, then measure
before touching P1.

## 7. Open questions

1. Acceptable staleness for reads during an outage? (Proposed: serve last-good with the existing
   SystemHealth "cached data" banner; refresh in background.)
2. Should `resolveCurrentTerm()` prefer the DB value immediately when EP is known-offline (circuit
   breaker), instead of trying EP each TTL?
3. Is `PRUNE_ENABLED` / sync frequency tunable for the demo (e.g., 10 min) to reduce periodic spikes?
