# External-System Offline Resilience — Regression-Proof Implementation & Verification Plan

**Systems in scope:** EnrollPro (primary), ATLAS, AIMS
**Status:** Proposed — not started
**Date:** 2026-09-23
**Scope:** `server/src/lib/enrollproClient.ts`, `server/src/lib/syncCache.ts`, `server/src/lib/syncCoordinator.ts`, `server/src/lib/sync/httpClient.ts`, `server/src/lib/aimsClient.ts`, `server/src/lib/teacherSync.ts`, `server/src/routes/grades-sub/helpers.ts`, request-path callers in `server/src/routes/**`, test harness under `e2e/offline/**`
**Related:** `AGENTS.md`, `docs/SYNC_OUTAGE_GUARDRAIL_FIX_PLAN.md` (2026-09-10 incident), `docs/ARCHITECTURE_QA_FOR_GLM.md:92`

> **How to use this document.** Work top-to-bottom. Phase H builds the simulation rig **before any production change**. Every phase ends at a **gate** (exact commands + pass criteria). A gate that fails stops the line — fix, re-run, do not proceed. Every new guard test must pass a **revert drill** (§9.1) proving it catches the regression it claims to catch. Where this plan states a fact, it cites a verified file (§0.1). Where it does not know something, it is listed in §0.2 as an assumption with the exact verification step.

---

## 0. Ground truth

### 0.1 Verified facts (inspected 2026-09-23)

| # | Fact | Evidence |
|---|---|---|
| F1 | Request-path EP calls wait 20 s per HTTP attempt before falling back | `server/src/lib/enrollproClient.ts:143` (`req.setTimeout(20000, ...)`) |
| F2 | EP fallback chains are sequential and repeat the timeout | `getEnrollProTeachers` `enrollproClient.ts:198-221`; `getEnrollProSections` `:277-315`; `getEnrollProSectionStudents` `:324-352` |
| F3 | Sync flushes **all** caches in `finally`, including skipped/partial cycles | `server/src/lib/syncCoordinator.ts:438`; `invalidateAllCaches()` `syncCache.ts:215-217` |
| F4 | Sync interval defaults to 5 min | `syncCoordinator.ts:32-37` |
| F5 | No connectivity breaker guards request-path EP calls (breaker only gates background cycles) | `syncCoordinator.ts:139-166` vs. `fetchJSON` |
| F6 | `checkEnrollProHealth` makes two sequential 20 s attempts | `enrollproClient.ts:944-958` |
| F7 | Admin dashboard probes health on page load | `server/src/routes/admin-sub/dashboard.ts:146` |
| F8 | Login faculty gate can block on a cache miss | `server/src/routes/auth.ts:86, 135` |
| F9 | `resolveCurrentTerm` has a 60 s TTL, persists to DB, and falls back to DB | `server/src/routes/grades-sub/helpers.ts:52, 60-99` |
| F10 | Rollover guardrails exist: advisory lock, snapshot-gap check, year lock, fail-safe revert | `server/src/lib/rollover.ts:95-178, 240-355`; `schoolYearResolver.ts:114-215` |
| F11 | Vitest is guarded to `*_test` databases and serializes test files | `server/vitest.config.ts:8-20, 32` |
| F12 | `npm test` (server) runs DB guard → `seed-test-base.ts` → vitest | `server/package.json:21`; `server/scripts/require-test-db.js`; `server/scripts/seed-test-base.ts` |
| F13 | Test fixtures already use a synthetic year `2088-2089` (externalId `900003`) | `server/scripts/seed-test-base.ts:30-41` |
| F14 | Integration tests fetch a **running** server at `http://localhost:5003/api` and skip without `SMART_TEST_*` credentials | `server/src/__tests__/test-helpers.ts:6, 29-36` |
| F15 | Playwright is installed; config expects manually running dev servers; specs are declared READ-ONLY | root `package.json:19,46-58`; `playwright.config.ts:3-25` |
| F16 | Existing Playwright specs: portal smoke + records vault, with `collectProblems()` (console errors / API ≥ 400) | `e2e/portals.spec.ts`, `e2e/alumni-records.spec.ts`, `e2e/fixtures.ts:59-70` |
| F17 | E2E credentials come from env `SMART_TEST_*` or gitignored `tests/playwright-accounts.json` | `e2e/fixtures.ts:32-48`; `.gitignore:37` |
| F18 | Vite proxies `/api` → `http://localhost:5003`; port is not pinned | `vite.config.ts:17-34` |
| F19 | Server entry is `server/src/index.ts`; `app.ts` was deliberately removed | `git log` commit `1f9d7fa`; `server/src/index.ts:45,214` |
| F20 | Fail-closed sync guard helpers + tests already exist (incident class) | `server/src/lib/syncGuard.ts`; `server/src/__tests__/sync-outage-guard.test.ts` |
| F21 | Rollover/year-guard test suites already exist | `__tests__/rollover.test.ts`, `rollover-lib.test.ts`, `admin-year-switch.test.ts`, `teacherSync-year-guard.test.ts`, `prune-year-guard.test.ts`, `termLockPolicy.test.ts`, `demo-term-mode.test.ts`, `enrollpro-year-pick.test.ts` |
| F22 | `wipe.ts` supports `--dry-run`/`--keep-users`; production requires `--i-know-this-wipes-production`; it does **not** enforce a `*_test` name by itself | `server/scripts/wipe.ts:14-25` |
| F23 | Root `verify` script = typecheck + build + server build + lint + server test | root `package.json:18` |
| F24 | `tests/` (credentials, smoke script, screenshots) is gitignored; `e2e/` is tracked | `.gitignore:37` |
| F25 | AIMS course/weights cache entries request a **1 h TTL** (`3600_000`) but are wiped every cycle by `invalidateAllCaches()` — effective TTL ≈ 5 min | `server/src/routes/grades-sub/aims.ts:73, 83-84, 93, 274-275` vs. `syncCoordinator.ts:438` |
| F26 | ATLAS request-path cache miss triggers a **live** effective-load fetch with shared defaults: 3 retries × 20 s + backoff (up to ~87 s) | `server/src/lib/teacherSync.ts:439-471`; `sync/httpClient.ts:25-27, 459-496` |
| F27 | ATLAS year resolution on the request path can chain runtime-context (default retries) + an 8 s-per-candidate discovery probe loop (up to 25 candidates on `missing`/`inactive`/`rejected`) | `teacherSync.ts:135`; `sync/httpClient.ts:305-377` |
| F28 | `/api/integration/status` pings all three systems in parallel; the EP leg can take ~40 s (two 20 s attempts), ATLAS/AIMS legs are 5 s | `server/src/routes/integration.ts:314-330`; `enrollproClient.ts:944-958`; `aimsClient.ts:140-148` |
| F29 | AIMS live calls (`scores`, `courses`) use shared defaults 20 s × 3 retries; only the AIMS health check uses a 5 s timeout | `aimsClient.ts:161, 209` vs. `:143`; `sync/httpClient.ts:25-27` |
| F30 | ATLAS effective-load payloads are validated against a zod contract before use; the stub must produce schema-valid payloads | `sync/httpClient.ts:18-23, 478-496`; `server/src/schemas/atlas.ts` |
| F31 | AIMS is optional: absent `AIMS_API_KEY` → client throws 503 immediately and the sync step is skipped | `aimsClient.ts:132-134, 156-158`; `.env.example:28-29` |
| F32 | Today, EP outages produce **per-request** warnings (no transition dedupe): `[EnrollProClient] /students endpoint failed…` `:336`; `[Grades] Live term fetch from EnrollPro failed` `helpers.ts:91`; plus a partial-sync warn per cycle `syncCoordinator.ts:219`. Logger defaults to INFO, so all are visible (`logger.ts:20-22`) | verified in source |

### 0.2 Assumptions to verify in Phase H (do not guess)

| # | Assumption | Verification step | Fallback if false |
|---|---|---|---|
| A1 | PostgreSQL client tools (`createdb`/`dropdb`) are available on the dev machine | H0: `createdb --version`, `psql --version` | Create `smart_e2e_offline_test` once manually; rig only wipes+seeds it |
| A2 | Playwright browsers are installed | H0: `npx playwright --version` then a trivial launch check | `npx playwright install chromium` |
| A3 | Ports 5004 (rig backend), 5174 (rig frontend), 5999 (EP stub), 5998 (ATLAS stub), 5997 (AIMS stub) are free | H0: `Test-NetConnection`/bind check | Pick from 5104/5274/6099/6098/6097 and record in rig config |
| A4 | `webServer.env` merges with `process.env` reliably across platforms | H3: assert server boots with the rig DB name (logged by guard) | Pass `env: { ...process.env, ...overrides }` explicitly |
| A5 | UI exposes the active school year in an assertable element | H4: inspect teacher/registrar dashboard during stub-year switch | Assert via API response (`/api/grades/dashboard`, public settings) instead of UI text |
| A6 | `server/.env` currently points at a non-test DB (dev data) | H0: read DB name (never print credentials) | Guards already refuse non-`*_test` DBs — keep them |
| A7 | ATLAS stub can satisfy the effective-load zod contract with synthetic fixtures | H2: run `fetchEffectiveTeachingLoad` against the stub in a T1 test | Copy fixture shape from `schemas/atlas.ts` and the existing `atlas-effective-load.test.ts` |
| A8 | AIMS stub can satisfy `aimsPublicScoresSchema` / course-list parsing | H2: T1 test against the stub with `AIMS_API_KEY` set | Skip AIMS scenarios until contract is confirmed |

---

## 1. Goals, non-goals, safety contract

### 1.1 Performance goals

| Condition | Today | Target |
|---|---|---|
| EP down, warm cache | 20–60 s | < 1 s |
| EP down, cold cache (fresh restart) | 20–60 s | < 5 s (one fast-fail wait, then fallback) |
| ATLAS down, teacher advisory sync (cache miss) | up to ~95 s (F26 + F27) | < 5 s, DB fallback |
| AIMS down, AIMS panel / sync | up to ~87 s per call (F29) | < 3 s degrade to stub/skip |
| Any external down, health/status page | up to ~40 s | < 5 s (parallel probes, bounded) |
| All systems up | normal | no regression (p95 within +10 % of baseline) |

### 1.2 Rollover safety goals

- The cache never decides the active school year; only `ensureSchoolYearFromEnrollPro` + `handleYearChangeRollover` do (F10).
- Scope (year/term) is never served stale while the source system is reachable; ≤60 s TTL (F9).
- EP offline→online transition invalidates scope **before** serving new responses, then triggers sync.
- ATLAS year resolution keeps its existing self-heal + fail-closed behavior (F20, F21, F30); caching changes must not weaken it.

### 1.3 Data safety contract (hard rules)

1. **No automated test, script, or stub may connect to the production database.** Every rig entry point refuses unless the effective `DATABASE_URL` database name matches `/(^|_)test(_|$)/i` (same rule as F11/F12) and the value comes from the process environment (not `server/.env`).
2. **No automated test may connect to real EnrollPro/ATLAS/AIMS.** The rig refuses unless `ENROLLPRO_URL`, `ATLAS_URL`, and (when set) `AIMS_URL` are loopback (`127.0.0.1` / `localhost`).
3. **No test writes to historical years.** All fixtures use synthetic years ≥ 2088 (`2088-2089` existing, `2090-2091`, `2091-2092` for rollover sims). Real years (`2026-2027`, etc.) never appear in rig fixtures.
4. **`wipe.ts` runs only after rule 1 is asserted by the rig launcher** (it does not self-guard, F22).
5. The existing read-only Playwright suite (F16) stays read-only. Offline simulation runs exclusively on the rig, never against the dev stack.

---

## 2. Root causes (verified)

| ID | Cause | Location | Fix phase |
|---|---|---|---|
| R1 | 20 s request-path timeout | `enrollproClient.ts:143` | P0-1 |
| R2 | Sequential EP fallback chains repeat the timeout | `enrollproClient.ts:198-221, 277-315, 324-352` | P0-1 |
| R3 | Full cache flush every cycle, including skipped/partial | `syncCoordinator.ts:438` | P0-2 |
| R4 | No request-path connectivity breaker (EP or ATLAS) | `syncCoordinator.ts:139-166` | P2-1 |
| R5 | Slow health probes (EP: 2 × 20 s) | `enrollproClient.ts:944-958`; `admin-sub/dashboard.ts:146` | P0-3 |
| R6 | Login faculty gate blocks on cache miss | `auth.ts:86, 135` | P0-1 + P1 |
| R7 | N+1 external loops multiply timeouts | `registrar/main.ts:154-159`; `teacherSync.ts:726-780`; `studentProfileSync.ts:152-231`; `aimsScoreSync.ts:140-197` | P3-1 |
| R8 | ATLAS request-path retries up to ~87 s | `sync/httpClient.ts:25-27, 93-118` | P3-2 |
| R9 | ATLAS cache miss on request path triggers live fetch with 3 × 20 s retries | `teacherSync.ts:439-471` (F26) | P0-1 |
| R10 | ATLAS year discovery chain (runtime-context + up to 25 × 8 s probes) on request path | `teacherSync.ts:135`; `httpClient.ts:305-377` (F27) | P0-1 + P3-2 |
| R11 | Cache flush also destroys ATLAS and AIMS caches — the AIMS 1 h TTL is effectively 5 min | `syncCoordinator.ts:438` vs. `aims.ts:73-93` (F25) | P0-2 |
| R12 | AIMS request-path calls use 20 s × 3 retries (only health is fast) | `aimsClient.ts:161, 209` (F29) | P0-1 |

---

## 3. Design: Scope vs Bulk

| | **Scope** (freshness-critical) | **Bulk** (stale-tolerant) |
|---|---|---|
| Examples | Active school year, active term, rollover state, branding term dates | Teachers, faculty, sections, rosters, learners, EOSY lists, remedial lists, ATLAS teaching load, AIMS course metadata |
| EP up | Live resolve, ≤60 s cache | Fresh TTL 5 min; stale served + background refresh |
| EP down | DB last-known (documented correct behavior) | Last-known served, labeled with age |
| Cache key prefix | `enrollpro:schoolYear:*`; module `cachedTerm` | `enrollpro:teachers`, `enrollpro:sections:*`, `atlas:faculty`, `atlas-teaching-load:*`, `aims:course:*`, `aims:weights:*` |
| Invalidation | On EP offline→online transition (P2-2) | Only after a **successful** sync step of the owning system (P0-2) |

Notes:

- ATLAS teaching load is keyed by `{schoolId}:{schoolYearId}` and versioned (contract) — it is bulk, but the year key means a year change naturally invalidates it; no stale-year mixing (F30, `syncCache.ts:157-197`).
- AIMS cache entries are bulk and currently over-invalidated (F25); per-source invalidation gives them their intended 1 h TTL.

**Log hygiene contract (outage readability):**

- One line per system state transition: `[EP] DOWN` (warn) / `[EP] UP after 4m12s` (info), emitted only by `externalState.ts` on change — never per request.
- Repeated fast-fail failures log at `debug`; only the first failure of a cooldown window logs `warn` with error detail.
- Stale-cache serves log at `debug` (`[Cache] stale enrollpro:teachers age=6m`); visible only with `LOG_LEVEL=debug`.
- Background sync already logs one cycle summary; skip reasons stay one line per cycle.
- Production JSON logs carry structured context `{ system, status, durationMs }` (logger supports a context object — `logger.ts:32-45`).
- Error messages must not include credentials/tokens; body snippets stay truncated (existing `slice(0, 300)`).

**Invariants (enforced by tests):**

- I1: Only sync writes the active year (F10 paths).
- I2: Scope TTL ≤60 s; no stale-window serving for scope keys.
- I3: Reconnect invalidates scope before any response, then `triggerImmediateSync`.
- I4: Bulk data carries its year label; responses never merge years.
- I5: No silent scope fallback — responses expose source/age (P1-3).
- I6: Fail-closed sync guardrails (`syncGuard.ts`) and ATLAS contract validation are unchanged by this work.
- I7: During an outage, warn/error log volume is bounded (transition lines only), regardless of request count.

---

## 4. Simulation & test architecture

### 4.1 Tier map

| Tier | Tool | What it proves | DB / network | Runs via |
|---|---|---|---|---|
| T1 Unit | vitest | Timeout selection, cache semantics (fresh/stale/expired/single-flight/prefix invalidation), connectivity-state transitions, scope-invalidation logic, stub contracts | No DB, no network (module mocks) | `npm --prefix server test` |
| T2 Rig integration | vitest + stubs + real test-DB server | Latency budgets (cold/warm) for EP/ATLAS/AIMS, cache survival across skipped cycles, reconnect scope invalidation, log-noise bounds, partial-sync behavior | `*_test` DB + loopback stubs | NEW `npm run test:offline` |
| T3 Playwright offline | Playwright + stubs + rig backend + rig frontend | UI behavior under offline/reconnect/rollover: no hangs, correct year, offline indicators, no console/API errors | `*_test` DB + loopback stubs | NEW `npm run test:e2e:offline` |
| T4 Playwright read-only (existing) | Playwright | Portal smoke + records vault on the dev stack | Dev stack (read-only, F16) | `npm run test:e2e` |
| T5 Backend suites (existing) | vitest | Rollover, year guards, prune, auth, ATLAS contract, etc. (F20/F21) | `*_test` DB | `npm --prefix server test` |

### 4.2 Isolation guarantees

- **Process env wins over `server/.env`** (dotenv does not override pre-set vars — verified pattern in `server/scripts/require-test-db.js:13` which loads `.env` then checks the effective value). Rig launchers set `DATABASE_URL`, `PORT`, `ENROLLPRO_URL`, `ATLAS_URL`, `AIMS_URL`, `AIMS_API_KEY`, `SYNC_INTERVAL_MS`, `SYNC_INITIAL_DELAY_MS` explicitly and assert them before spawning anything.
- **Fail-closed guard** (new `e2e/offline/guards.mjs`) — used by every rig entry point:
  - refuse if `DATABASE_URL` missing or DB name fails `*_test`
  - refuse if `ENROLLPRO_URL` host is not loopback
  - refuse if `ATLAS_URL` host is not loopback
  - refuse if `AIMS_URL` is set and not loopback
  - print resolved values (DB name, stub URLs, ports) for the run log
- **No production writes possible by construction:** all rig traffic goes to loopback stubs; all DB traffic goes to the test DB. All three integrations are read-only by policy.

### 4.3 Stub contracts

#### EnrollPro stub (new `e2e/offline/enrollpro-stub.mjs`)

Serves the endpoints SMART actually calls (verified against `enrollproClient.ts`):

| Endpoint | Response |
|---|---|
| `POST /api/auth/login` | `{ token, user }` |
| `GET /api/teachers` (Bearer) | `{ teachers: [...] }` |
| `GET /api/integration/v1/health` | `200 {}` |
| `GET /api/integration/v1/school-year` | `{ data: { id, yearLabel } }` |
| `GET /api/integration/v1/active-term` | `{ data: { activeTerm, schoolYearId } }` |
| `GET /api/integration/v1/faculty?page&limit` | `{ data, meta }` |
| `GET /api/integration/v1/sections?page&limit&schoolYearId` | `{ data, meta }` |
| `GET /api/integration/v1/learners?page&limit&schoolYearId` | `{ data, meta }` |
| `GET /api/integration/v1/sections/:id/learners?page&limit` | `{ data: { section, learners }, meta }` |
| `GET /api/settings/public` | branding payload (`schoolName`, `logoUrl`, `colorScheme`, year fields) |
| `GET /api/school-years`, `GET /api/school-years/:id` | year list / year with term dates |

#### ATLAS stub (new `e2e/offline/atlas-stub.mjs`)

Base URL `http://127.0.0.1:5998/api/v1`. Payloads must satisfy `schemas/atlas.ts` (F30):

| Endpoint | Response |
|---|---|
| `GET /api/v1/health` | `200 {}` |
| `GET /api/v1/runtime/context?schoolId&verifyUpstream=true` | `{ activeSchoolYearId, ... }` |
| `GET /api/v1/faculty-assignments/effective?schoolId&schoolYearId` | schema-valid `{ source, assignments, coverageTotals }` |
| `GET /api/v1/faculty?schoolId` | `{ faculty: [...] }` |

#### AIMS stub (new `e2e/offline/aims-stub.mjs`)

Base URL `http://127.0.0.1:5997/api/v1`; `AIMS_API_KEY` set to a rig-only value (F31):

| Endpoint | Response |
|---|---|
| `GET /health` | `200 {}` |
| `GET /public/courses?teacherEmail&schoolYear` | course list (schema-valid) |
| `GET /public/courses/:courseId/scores` | scores payload (schema-valid) or 404 |

#### Control API (all stubs)

| Control | Effect |
|---|---|
| `POST /_control/mode` `{ mode }` | `online` \| `hang` (accept, never respond) \| `refuse` (close immediately) \| `error500` |
| `POST /_control/year` `{ id, label, activeTerm }` | Atomically switch the served year/term — this **is** the simulated rollover |
| `GET /_control/state` | Current mode/year + per-route request counters (for assertions) |
| `POST /_control/reset` | Back to `online`, fixture year A |

### 4.4 Database lifecycle

Rig DB: `smart_e2e_offline_test` (name satisfies the `*_test` guard).

1. H0 verifies the DB exists (A1). If missing and `createdb` is available: create it. Otherwise one-time manual creation (documented).
2. Every rig run: `npx prisma db push` (schema) → `ts-node scripts/wipe.ts` (with rig env) → `ts-node scripts/seed-test-base.ts` → NEW `ts-node scripts/seed-offline-fixtures.ts`.
3. `seed-offline-fixtures.ts` creates, with synthetic years only:
   - admin / teacher / registrar users (passwords from `SMART_TEST_*` env, bcrypt-hashed)
   - one section, subject, class assignment, 5–10 students/enrollments (enough for dashboards to render)
   - `SystemSettings` term dates for the fixture year
4. No `pg_dump`/restore needed because the DB is wiped and reseeded each run. Production/dev DBs are never in scope.

### 4.5 Ports & wiring

| Process | Port | Config |
|---|---|---|
| EP stub | 5999 | `e2e/offline/enrollpro-stub.mjs` |
| ATLAS stub | 5998 | `e2e/offline/atlas-stub.mjs` |
| AIMS stub | 5997 | `e2e/offline/aims-stub.mjs` |
| Rig backend | 5004 | `server` with rig env (`PORT=5004`, `ENROLLPRO_URL=http://127.0.0.1:5999/api`, `ATLAS_URL=http://127.0.0.1:5998/api/v1`, `AIMS_URL=http://127.0.0.1:5997/api/v1`, `AIMS_API_KEY=rig-test-key`) |
| Rig frontend | 5174 | `vite --port 5174 --strictPort` with `VITE_PROXY_TARGET=http://127.0.0.1:5004` |
| Dev stack (untouched) | 5003 / 5173 | unchanged |

Required wiring change (test-infra only, defaults preserved): `vite.config.ts` reads `process.env.VITE_PORT` (default 5173) and `process.env.VITE_PROXY_TARGET` (default `http://localhost:5003`). Existing `npm run dev` behavior is byte-identical when env vars are unset.

### 4.6 Fixtures

| Year | ID (externalId) | Use |
|---|---|---|
| `2088-2089` | 900003 | Existing base fixture (F13); year A in offline specs |
| `2090-2091` | 900004 | Year B for reconnect/rollover simulation |
| `2091-2092` | 900005 | Reserved for multi-rollover edge cases |

---

## 5. Phase H — Build the simulation rig (do this first)

**No production code changes before G-H passes.**

### H0 — Tooling verification (no code)

Run and record results:

```powershell
psql --version; createdb --version          # A1
npx playwright --version                    # A2
Test-NetConnection -ComputerName 127.0.0.1 -Port 5004   # A3 (repeat for 5174, 5999, 5998, 5997)
node -e "const u=new URL(process.env.DATABASE_URL||'');console.log(u.pathname)"  # A6 (with server env loaded)
```

Record outcomes in the run log. Apply the §0.2 fallbacks where needed.

### H1 — Guards (`e2e/offline/guards.mjs`)

Implements §4.2 fail-closed checks. Unit-tested itself (T1): given fake env inputs, asserts refuse/allow behavior.

### H2 — Stubs (EP + ATLAS + AIMS)

Implement §4.3. ATLAS and AIMS payloads must pass the real zod contracts (A7, A8) — validate them in T1 tests before trusting any T2/T3 result. Stubs have their own T1 tests for the control API (mode/year switching is deterministic).

### H3 — DB lifecycle + fixtures

Implement §4.4 and `seed-offline-fixtures.ts`. Verification: run the lifecycle twice in a row; second run must be idempotent and leave exactly the fixture rows.

### H4 — Rig integration suite (T2)

New `server/src/__tests__/enrollpro-fastfail.test.ts` (gated: skips unless `SMART_OFFLINE_RIG=1`, same convention as F14's `skipIf`). Orchestrated by NEW `e2e/offline/run-rig.mjs`:

1. guards → 2. wipe+seed → 3. start EP/ATLAS/AIMS stubs + rig backend → 4. wait for `/api/health` → 5. run `vitest run` with rig env → 6. teardown (kill child processes, record exit codes).

Root script: `npm run test:offline`.

### H5 — Playwright offline suite (T3)

New `e2e/offline/playwright.offline.config.ts`:

- `testDir: e2e/offline/specs`, `workers: 1`, `retries: 0` (mirror `playwright.config.ts` policy)
- `webServer: [...]` for the three stubs, rig backend, rig frontend (explicit `env: { ...process.env, ...overrides }`, A4)
- `baseURL: http://localhost:5174`

Root script: `npm run test:e2e:offline`.

### H6 — Baseline capture (G0)

Script `e2e/offline/capture-baseline.mjs`: with the rig running, issues N=20 requests per endpoint (login, teacher dashboard, registrar dashboard, admin dashboard, integration status, schedule) in five conditions — all online, EP `hang`, EP `refuse`, ATLAS `hang`, AIMS `hang` — and writes p50/p95 to `e2e/offline/baselines/baseline-<date>.json` (committed). This is the **before** evidence; every later gate compares against it. Record the machine spec alongside (timings are machine-dependent; budgets are the hard gate, baseline deltas are advisory).

### Gate G-H (harness ready)

| Check | Command | Pass criteria |
|---|---|---|
| Guards refuse bad env | `node e2e/offline/guards.mjs --selftest` | refuses non-`*_test` DB and non-loopback EP/ATLAS/AIMS URLs; allows valid rig env |
| Stub contracts | stub T1 tests | EP/ATLAS/AIMS payloads pass the real zod schemas; control API deterministic |
| Rig starts & tears down | `npm run test:offline` | rig boots, one smoke test passes, all child processes exit; no stray listeners on 5004/5174/5999/5998/5997 |
| Offline Playwright boots | `npm run test:e2e:offline` | one smoke spec passes against the rig |
| Baseline captured | `npm run baseline:offline` | JSON written with all 5 conditions × 6 endpoints |
| **Safety** | inspect run log | DB name printed = `smart_e2e_offline_test`; EP/ATLAS/AIMS URLs = loopback |

---

## 6. Phases 0–3 (production changes, each behind a gate)

### Phase 0 — Fast-fail + stop cache shredding (~6 h)

**P0-1 Request-path fast-fail timeouts (EP + ATLAS + AIMS)**

- EP (`enrollproClient.ts`): add `timeoutMs` option through the public surface; default = `EP_REQUEST_TIMEOUT_MS` (3000). Background callers (`enrollproSync.ts`, `prune.ts`, `atlasSync.ts`, `studentProfileSync.ts`, `syncVerification.ts`, `enrollproBrandingSync.ts`) pass `EP_SYNC_TIMEOUT_MS` (20000). Fallback calls inside `getEnrollPro*` inherit the same timeout.
- ATLAS (`teacherSync.ts` + `sync/httpClient.ts`): request-path calls pass `{ retries: 0, timeoutMs: ATLAS_REQUEST_TIMEOUT_MS }` (default 5000, tuned in H6). Applies to the cache-miss live fetch (`teacherSync.ts:443`) and to `resolveAtlasSchoolYear` when called from the request path (`teacherSync.ts:135, 448`). Background `atlasSync.ts` keeps 20 s + 3 retries. Shared `httpClient` defaults unchanged.
- AIMS (`aimsClient.ts`): request-path `getAimsPublicScores` / `getAimsPublicCourses` accept `{ retries: 0, timeoutMs: AIMS_REQUEST_TIMEOUT_MS }` (default 3000). Background `aimsScoreSync.ts` keeps defaults. Health stays 5 s.
- Tests:
  - T1: timeout selection per call site (mock `fetchJSON`/`httpGet`; assert fast vs sync values).
  - T2: EP `hang` → registrar dashboard cold < 5 s, warm < 1 s; EP `refuse` → < 2 s; ATLAS `hang` → advisory sync < 5 s; AIMS `hang` → AIMS scores endpoint < 3 s.
  - T2 (log noise): 30 requests during one outage window → ≤ 5 warn/error lines mentioning the system; details beyond the transition line only at `debug`.
- Rollback: set the three `*_REQUEST_TIMEOUT_MS` vars to 20000 (or `0` = disabled fast-fail, depending on final implementation).

**P0-2 Per-source cache invalidation** — `syncCache.ts`, `syncCoordinator.ts`

- Add `invalidatePrefix(prefix)`; replace the unconditional `finally { invalidateAllCaches(); }` (`:438`) with per-source invalidation: `enrollpro:` only on successful EP step; `atlas:` only on successful ATLAS step; `aims:` **never** (AIMS writes its own keys on read/sync and relies on TTL); nothing on skipped/partial cycles.
- Tests:
  - T1: prefix invalidation (EP keys removed, ATLAS/AIMS keys kept, and vice versa); AIMS 1 h TTL now observable (F25 regression guard).
  - T2: one skipped cycle (EP `hang` + ATLAS unreachable) → `syncCache.stats().keys` still contains `enrollpro:teachers` and `aims:*`; successful EP cycle → EP key gone, AIMS key remains.
- Rollback: revert coordinator change (cache flush restored).

**P0-3 Health probes** — `enrollproClient.ts`, `admin-sub/dashboard.ts`

- Single probe, 3 s timeout; only try the second path on a 404 from the first.
- Admin dashboard reads the last dependency snapshot (`getSyncCircuitBreakerStatus().lastDependencyHealth`) instead of probing live.
- `/api/integration/status` stays parallel but each leg is bounded: EP 3 s (new), ATLAS/AIMS already 5 s (F28).
- Tests: T2 EP `hang` → `/api/admin/dashboard` < 3 s; `/api/integration/status` < 6 s in all modes; health snapshot present.

### Gate G-P0

| Check | Command | Pass criteria |
|---|---|---|
| Existing backend suites | `npm --prefix server test` | all green (F11/F12 guard active) |
| Rig suite | `npm run test:offline` | latency budgets met in all 5 stub conditions |
| Existing e2e | `npm run test:e2e` (dev stack running) | green, no console/API errors |
| All-online non-regression | baseline compare | p95 within +10 % of G0 |
| Build/lint | `npm run typecheck && npm run build && npm --prefix server run build && npm run lint` | zero errors |
| Log noise | T2 log-noise test | ≤ 5 warn/error lines per system during a 30-request outage; exactly one DOWN transition line |
| Revert drill | §9.1 for each P0 guard test | test fails when fix is reverted |

### Phase 1 — Stale-while-revalidate (bulk only) (~6 h)

**P1-1** `syncCache` gains `staleTtlMs`, `getWithStatus()`, `getOrRevalidate(key, fetcher, opts)` with single-flight refresh. Expired-beyond-window falls back to fast-fail fetch, then to stale if fetch fails. Stale serves log at `debug` with key + age (never `warn`).
**P1-2** Apply to bulk keys only (`enrollpro:teachers`, `enrollpro:sections:*`, `atlas:faculty`, `atlas-teaching-load:*`, `aims:course:*`, `aims:weights:*`, plus new wrappers for rosters/learners). Scope keys excluded.
**P1-3** Surface `cacheAgeMs`/`asOf` where the offline banner already renders.
**Kill switch:** `SYNC_CACHE_STALE_MS=0` disables stale serving (behaves exactly like today).

Tests:
- T1: fresh/stale/expired/beyond-window; single-flight (N concurrent misses → 1 fetch); stale-served-on-fetch-failure; kill switch.
- T2: warm cache + EP `hang` → < 1 s; background refresh observed via stub request counter after TTL expiry; ATLAS teaching load survives an EP-down cycle.
- T3: offline banner shows cached-age text; no console errors.

### Gate G-P1

Same shape as G-P0 plus: kill-switch run (`SYNC_CACHE_STALE_MS=0`) reproduces pre-phase behavior; scope keys never served from stale in any T1/T2 test; AIMS keys keep their 1 h TTL across cycles.

### Phase 2 — Connectivity state + reconnect guard (~4 h)

**P2-1** New `server/src/lib/externalState.ts`: per-system `{ status: 'up'|'down'|'unknown', lastCheckAt, lastError, changedAt }` for EP and ATLAS (AIMS optional, fail-soft). Updated by request outcomes, scheduler health checks, and manual syncs. Request path skips live calls to a system that is `down` and checked within `EP_BREAKER_COOLDOWN_MS` (60000); one probe per window may flip it up. Emits exactly one `warn` on DOWN and one `info` on UP per transition, with structured context `{ system, status, durationMs }`; no per-request state logs.
**P2-2** On EP `down → up`: invalidate `enrollpro:schoolYear:*`, reset module `cachedTerm` (`grades-sub/helpers.ts`), `triggerImmediateSync('enrollpro-reconnect')`, broadcast `DEPENDENCY_RECONNECTED`.
**P2-3** (optional) UI toast on reconnect.

Tests:
- T1: state transitions incl. flapping; cooldown probe behavior; ATLAS breaker independent of EP breaker.
- T2: EP reconnect same year → scope re-resolved, sync triggered, no stale scope; EP reconnect new year (stub `/_control/year`) → new year applied within one sync; assert via API. ATLAS reconnect → teaching-load cache repopulated, no year mixing, fail-closed guards untouched (test-DB counts unchanged).
- T3 (S2, S3, S9, §7): full browser reconnect/rollover simulation.

### Gate G-P2

G-P0 shape plus: S2, S3, S9 scenarios pass; flapping test shows no request storm (stub request count bounded); scope source is live/DB, never stale, after reconnect; ATLAS fail-closed guard tests (F20) still green; exactly one UP transition line per system per reconnect, and no per-request warning growth.

### Phase 3 — N+1 guards + discovery bounds + full matrix (~8 h)

**P3-1** When a system's connectivity state is `down`, skip external loops and use DB: `registrar/main.ts:154-159`, `teacherSync.ts:726-780`, `studentProfileSync.ts:152-231`, `aimsScoreSync.ts:140-197`.
**P3-2** Bound ATLAS year discovery on the request path: cap probes (e.g. 3) or skip discovery entirely when ATLAS is `down` (use cached/env year + log loudly), keeping the verified-discovery behavior for background sync (`httpClient.ts:305-377`).
**P3-3** Run the complete scenario matrix S1–S10; finalize baselines.

### Gate G-Final (release gate)

| Check | Command | Pass criteria |
|---|---|---|
| Full verify | `npm run verify` | green |
| Rig | `npm run test:offline` | green |
| Offline e2e | `npm run test:e2e:offline` | green |
| Read-only e2e | `npm run test:e2e` | green |
| Scenario matrix S1–S10 | offline specs | all pass |
| Revert drills | §9.1 | every guard test fails on revert |
| Safety audit | run logs | no non-test DB, no non-loopback EP/ATLAS/AIMS, no real years in fixtures |
| Kill switches | `EP_REQUEST_TIMEOUT_MS=20000`, `SYNC_CACHE_STALE_MS=0` | each disables its feature cleanly |

---

## 7. Offline & rollover simulation scenarios (Playwright)

| ID | Scenario | Steps | Assertions |
|---|---|---|---|
| S1 | EP down, no year change | Stub EP `hang` → load teacher/registrar/admin dashboards | Pages render < budget; offline banner; data = fixture year A; no console/API errors |
| S2 | EP reconnect, same year | `hang` → `online` (same year) | Scope refreshed; sync triggered; year A unchanged; request counters bounded |
| S3 | **EP reconnect with new year (rollover)** | `hang` → `POST /_control/year {year B}` → `online` | Within one sync: API returns year B; UI shows year B; no year-A labels after reconnect; prior-year lock/archive state matches existing guardrails (registrar rollover-status API); audit entry exists (test-DB read) |
| S4 | Partial outage (EP down, ATLAS up) | EP stub `hang`; ATLAS stub `online` | EP bulk cache survives cycle; ATLAS step still runs; no destructive writes (counts unchanged in test DB) |
| S5 | EP flapping | `hang` → `refuse` → `online` in quick succession | No request storm (stub counters); no cache wipe; ≤ 2 transition log lines per system; final state correct |
| S6 | EP up, bulk stale | Populate cache; expire fresh TTL; load dashboard | Stale served instantly; background refresh observed; age label shown |
| S7 | Manual archive unaffected | Run existing `rollover.test.ts` + `archive-year-route.test.ts` | Green — no behavior change from caching work |
| S8 | **ATLAS down, EP up** | ATLAS stub `hang` → teacher login/advisory sync; open schedule | Advisory sync < budget; class list served from cache/DB; no destructive writes; no year mixing |
| S9 | **ATLAS reconnect** | ATLAS `hang` → `online` | Teaching-load cache repopulated; contract validation passes; fail-closed guard tests green; no stale year |
| S10 | **AIMS down** | AIMS stub `hang` → open AIMS panel; trigger `aims-sync` | AIMS scores endpoint < 3 s (stub degrade); sync step skipped fail-soft; no console/API errors; grades data unaffected |

---

## 8. Master gate rules

1. **Order:** G-H → G-P0 → G-P1 → G-P2 → G-Final. No skipping.
2. **Stop the line** if: any test red; any latency budget missed; any safety guard logs a violation; any all-online baseline regression > 10 %; any flake (see below).
3. **Flake policy:** a test that fails twice non-deterministically is quarantined and investigated before the gate can pass. Timing assertions use server-side measurements (T2) for hard budgets; browser timings use generous margins and assert behavior (no hang, correct state) rather than exact numbers.
4. **Evidence:** each gate writes a run log (command, env, DB name, stub modes, results) to `e2e/offline/runs/<date>-<phase>.log` (gitignored). Gate sign-off = run log + green commands.
5. **No gate may be passed by weakening a test.** Changing a budget or assertion requires a documented reason in the run log and a re-run of the previous gate.

---

## 9. Regression-proofing mechanics

### 9.1 Revert drill (mandatory per guard test)

For every new test that claims to prevent a regression:

1. `git stash` the production change (keep tests).
2. Run the test → it **must fail**.
3. `git stash pop` → it must pass.

Record the drill in the phase run log. A guard test that passes with the fix reverted is invalid and must be rewritten.

### 9.2 Traceability matrix

| Root cause | Change | T1 tests | T2 tests | T3 specs | Gate |
|---|---|---|---|---|---|
| R1, R2 | P0-1 (EP) | `enrollpro-fastfail.test.ts` (unit) | latency budgets, EP modes | S1 | G-P0 |
| R9, R10 | P0-1 + P3-2 (ATLAS) | timeout/probe-cap units | advisory sync budget, ATLAS modes | S8, S9 | G-P0/P3 |
| R12 | P0-1 (AIMS) | timeout units | AIMS scores budget | S10 | G-P0 |
| R3, R11 | P0-2 | `cache-prefix.test.ts` | skipped-cycle cache survival (EP/ATLAS/AIMS) | S4, S6 | G-P0 |
| R5 | P0-3 | health unit | admin dashboard + status budgets | S1 | G-P0 |
| R6 | P0-1 + P1 | login gate unit | login latency | S1 | G-P0/P1 |
| — | P1-1/2/3 | `cache-swr.test.ts` | warm/cold budgets, refresh counter, AIMS TTL | S6 | G-P1 |
| R4 | P2-1/2 | `external-state.test.ts` | reconnect scope, flapping, ATLAS breaker | S2, S3, S5, S9 | G-P2 |
| R7 | P3-1 | loop-guard units | DB-fallback counts | S1, S10 | G-Final |
| I1–I7 | P2-2 | scope invalidation, transition logging | rollover transition, log-noise test | S3, S5, S7, S9 | G-P2 |

### 9.3 Golden baseline

`e2e/offline/baselines/baseline-<date>.json` (committed) holds p50/p95 per endpoint per condition (all online, EP `hang`/`refuse`, ATLAS `hang`, AIMS `hang`) from G0. Later phases re-capture and compare. Hard gates use absolute budgets; baseline deltas catch silent regressions on the all-online path.

---

## 10. Risks & unknowns

| Risk | Mitigation |
|---|---|
| Timing flake on Windows dev machines | Server-side T2 budgets; generous browser margins; N=20 p95, not single runs |
| Rig DB accidentally left seeded/dirty | Wipe+seed every run; guard prints DB name; run log evidence |
| `webServer.env` semantics differ (A4) | Explicit `{ ...process.env, ...overrides }`; assert guard log line |
| ATLAS/AIMS stub payloads drift from zod contracts (A7/A8) | Contract validation in T1 before any T2/T3 result is trusted |
| Fast-fail defaults too aggressive for healthy systems | Measure in H6 baseline; tune `*_REQUEST_TIMEOUT_MS` from all-online p95 |
| Stale window masks a real year change while a system is reachable | Scope keys excluded from SWR (I2); reconnect guard (I3) |
| P0-2 weakens ATLAS fail-closed incident guardrails | S4/S8/S9 assert no destructive writes; F20/F21 suites must stay green; revert drill |
| AIMS keys accidentally invalidated again | Dedicated T1 regression test for the 1 h TTL (F25) |

---

## 11. Effort

| Phase | Work | Estimate |
|---|---|---|
| H | Guards, three stubs + contracts, DB lifecycle, rig, Playwright config, baseline | ~10 h |
| 0 | Fast-fail (EP/ATLAS/AIMS) + per-source invalidation + health | ~6 h |
| 1 | SWR cache + surfacing + kill switch | ~6 h |
| 2 | Connectivity state (EP/ATLAS) + reconnect guard | ~4 h |
| 3 | N+1 guards + discovery bounds + log-noise test + matrix + final gates | ~9 h |
| **Total** | | **~35 h** |

---

## 12. Non-goals

- No browser/PWA offline mode; SMART still requires the server.
- No writes to EnrollPro/ATLAS/AIMS (read-only policy).
- No changes to rollover/archive guardrails, grade-lock precedence, term advancement, or ATLAS fail-closed sync guards (`syncGuard.ts`).
- AIMS stays optional/fail-soft; no new AIMS features.
- No `app.ts` re-extraction (deliberately removed in `1f9d7fa`, F19).
- No production DB snapshots or restores — test DBs only.
- No CI cloud setup in this plan (local rig first; CI wiring is a follow-up).
- Normal-path performance items (healthy-system speed) are deferred and tracked in §14.

---

## 13. Open questions

1. Fast-fail defaults: EP 3 s / ATLAS 5 s / AIMS 3 s — confirm from H6 all-online p95.
2. Stale window: 24 h for all bulk, or shorter for EOSY-adjacent lists?
3. Should the cached-age indicator be global (banner) or per-page?
4. Do we want a persistent `smart_e2e_offline_test` DB (wipe+seed per run) or per-run scratch DBs (requires A1 tooling)?
5. ATLAS discovery cap on request path: 3 probes or zero (use cached/env year when down)?

---

## 14. Deferred — Normal-Path Performance Backlog (do later, separate effort)

These are **not** part of this plan (outage resilience). They improve speed when all systems are healthy. Each item requires its own measurement first, then a change under the same rules: gate + revert drill + baseline compare. None of these block Phases H–3.

| # | Item | Why it matters | Evidence / starting point | Est. | Needs measurement first? |
|---|---|---|---|---|---|
| N1 | Cache size caps + TTL sweep | `syncCache` is an unbounded in-memory map; long uptimes can grow it (and a TTL sweep is already noted as audit P2-4) | `server/src/lib/syncCache.ts:38-78`; `DEFENSE_READINESS_PLAN.md` P2-4 | ~3 h | No |
| N2 | Boot pre-warm from DB | First request after every restart pays one fast-fail wait because caches start empty | would populate `syncCache` from DB after `prisma` connects in `index.ts` | ~4 h | No |
| N3 | Batch N+1 external loops | We currently ask about students/sections one at a time (50 calls instead of 1); P3-1 only *skips* them during outages | `teacherSync.ts:726-780`; `registrar/main.ts:154-159`; `studentProfileSync.ts:152-231`; `aimsScoreSync.ts:140-197` | ~8 h | Yes — count real call volume |
| N4 | Cache repeated scope calls | `resolveEnrollProSchoolYear` is called directly (uncached) by several routes; `teacherSync` already uses a cached wrapper | `integration.ts:365`; `registrar/main.ts:121, 542, 1941` vs. `syncCache.getCachedSchoolYear` | ~2 h | No |
| N5 | De-duplicate health probes | Admin dashboard and `/status` can each probe the same systems; a single shared snapshot per cooldown suffices (P0-3 fixes the EP leg only) | `admin-sub/dashboard.ts:159-162`; `integration.ts:314-330` | ~2 h | No |
| N6 | DB query / index tuning | Dashboard and SF-form queries may scan more than needed; no audit done yet | needs a query-log review (not yet performed) | ? | Yes — investigate first |
| N7 | Frontend React Query tuning | Retry/staleTime/refetch intervals are per-page defaults; could reduce refetch storms on slow links | needs a frontend audit (not yet performed) | ? | Yes — investigate first |
| N8 | Connection reuse for EP/ATLAS/AIMS HTTP calls | Each call builds a raw `http(s).request`; a keep-alive agent may cut TLS handshakes | `enrollproClient.ts:106-149`; `sync/httpClient.ts:50-132` | ~2 h | Yes — verify Node version keep-alive defaults |

**Rule:** N1–N5 are ready to schedule once H–3 ships. N6–N8 are investigations, not commitments — do not start them without a measured baseline.

---

## 15. Autonomous Overnight Run — Protocol (authorized 2026-09-23)

**Scope:** Execute Phases H → 0 → 1 (continue to 2–3 only if every gate passes). Work happens in the repo; the live PM2 processes are never touched.

**Order & gates:** exact gate commands from §8. Never proceed past a failed gate after 2 fix attempts — write the handoff note and stop.

**Bug intake (PM2 logs, read-only):**
- At run start and at every phase boundary: `pm2 logs server --lines 100 --nostream --err`.
- Classify each distinct issue:
  - **In-scope bug** (EP/ATLAS/AIMS request-path latency, caching, log noise) → fix **before proceeding**, with a test + revert drill.
  - **Out-of-scope bug** → document in the bug log; do not touch.
  - **Caused by our change** → stop the line, fix, re-run the gate.
- Bug log: `e2e/offline/runs/bugs-<date>.md` (run evidence, gitignored).

**Known findings at run start (2026-09-23, from PM2 error log):**
1. `[AimsSync] Failed for course … Timeout` — repeating every sync cycle, one per course. **In scope** (P0-1/P1: bounded AIMS timeouts, fail-soft, quieter logs). *Not yet fixed — ATLAS/AIMS half of P0-1 deferred.*
2. `[AtlasYear] runtime/context unavailable (HTTP 403 SCHOOL_SCOPE_REQUIRED)` then successful probe resolve. Documented self-heal. **Out of scope** — do not "fix".
3. `[Auth] Refresh token reuse detected … family revoked` bursts. Auth behavior, unrelated to this plan. **Out of scope** — document only.

**Run result (2026-09-23, overnight):** Phase H rig built and passing; **Phase 0 complete (EP + ATLAS + AIMS)**; **P1 complete** (stale-while-revalidate, bulk only, with login-gate stale opt-out); **P2 complete** (connectivity state + reconnect guard: scope invalidation + `DEPENDENCY_RECONNECTED` + immediate resync). **Playwright offline suite built** (S1/S2/S5/S6 passing, 4/4) with ATLAS/AIMS loopback stubs; ATLAS connectivity reporting wired.
`registrar/dashboard` on the isolated test DB: EP online 84→57 ms · EP **hang 80,109→3,056 ms (~26x)** · EP refuse 70→12 ms.
Revert drill passed (fix stashed → hang 80,064 ms → rig test fails as designed). Server build + root typecheck/build/lint green.
Server suite: 384 passed / 3 failed in `external-records-api.test.ts` — pre-existing, hits the live :5003 server (which never loaded this code); unrelated. 45/46 files pass.
New T1 units (`cache-swr`, `external-state`) 14/14 — they caught one real SWR bug (existing entry's stale window was ignored), fixed.
Deviations from plan: (a) the request-path breaker (P2-1) was pulled into Phase 0 because fast-fail alone cannot stop sequential fallback chains from re-dialing; (b) sync/request timeout split uses `AsyncLocalStorage` (`runWithSyncTimeout`) instead of per-call options — same behavior, smaller diff; (c) login faculty gate explicitly opts out of stale data for security.
**COMPLETE.** All plan items done and verified: P0-1/2/3, P1 (bulk + roster/learner SWR + "cached data" badge), P2, P3 (N+1 down-guards in registrar/teacherSync/studentProfileSync; ATLAS request-path discovery skip + probe cap), T1/T2/T3 harness, AIMS fail-soft skip, trigger debounce, admin-dashboard snapshot read. Playwright S1–S10: 9/9 passing (S3 rollover guardrail verified live; S4 partial outage with cached roster served <3s). Remaining known: pre-existing `external-records-api.test.ts` 3 failures (targets a stale live :5003 process, unrelated), and the deferred §14 normal-speed backlog (N1–N8). Details: `e2e/offline/runs/MORNING-2026-09-23.md`.

**Safety rules (non-negotiable):**
- PM2 is read-only: no restart/stop/delete; the live server keeps running the current code. The rig runs on separate ports (5004/5174/5997–5999).
- No `.env` edits. No production DB access. Test DB only — `smart_test_db` already exists (A1 resolved: no `createdb` needed), wiped + seeded per run.
- No commits/pushes; work stays in the working tree.
- No writes to EnrollPro/ATLAS/AIMS.

**Stop conditions:** guard violation; test DB unreachable; gate red after 2 fix attempts; a change that would need a schema migration or touch rollover/archive logic; any uncertainty about data safety. On stop: write `e2e/offline/runs/HANDOFF-<date>.md` (state, blocker, exact next command).

**Morning report:** `e2e/offline/runs/MORNING-<date>.md` — phases completed, gates passed/failed, bugs found/fixed/deferred, files changed, baseline numbers, recommended next step.

---

## Appendix A — New artifacts (all tracked, no credentials)

```
e2e/offline/
├── guards.mjs                    # fail-closed env guards
├── enrollpro-stub.mjs            # EP fixture server + control API
├── atlas-stub.mjs                # ATLAS fixture server (schema-valid) + control API
├── aims-stub.mjs                 # AIMS fixture server (schema-valid) + control API
├── run-rig.mjs                   # wipe/seed/start/run/teardown for T2
├── capture-baseline.mjs          # G0 metrics
├── playwright.offline.config.ts  # T3 config (webServer array, port 5174)
├── specs/
│   ├── offline-load.spec.ts      # S1, S2, S6
│   ├── offline-rollover.spec.ts  # S3, S4, S5
│   ├── offline-atlas.spec.ts     # S8, S9
│   ├── offline-aims.spec.ts      # S10
│   └── offline-ui-states.spec.ts # banners, no console errors
└── baselines/                    # committed JSON baselines
server/scripts/seed-offline-fixtures.ts
server/src/lib/externalState.ts             # P2-1 (new)
server/src/__tests__/enrollpro-fastfail.test.ts
server/src/__tests__/cache-swr.test.ts
server/src/__tests__/cache-prefix.test.ts
server/src/__tests__/external-state.test.ts
server/src/__tests__/reconnect-scope.test.ts
```

Modified: `server/src/lib/enrollproClient.ts`, `server/src/lib/syncCache.ts`, `server/src/lib/syncCoordinator.ts`, `server/src/lib/sync/httpClient.ts`, `server/src/lib/aimsClient.ts`, `server/src/lib/teacherSync.ts`, `server/src/routes/grades-sub/helpers.ts`, `server/src/routes/admin-sub/dashboard.ts`, `vite.config.ts`, root `package.json` (scripts below).

## Appendix B — Command cheat sheet

| Purpose | Command | Status |
|---|---|---|
| Existing backend tests | `npm --prefix server test` | exists |
| Existing read-only e2e | `npm run test:e2e` | exists |
| Full verify | `npm run verify` | exists |
| Rig integration (T2) | `npm run test:offline` | NEW |
| Offline Playwright (T3) | `npm run test:e2e:offline` | NEW |
| Baseline capture | `npm run baseline:offline` | NEW |
| Guard self-test | `node e2e/offline/guards.mjs --selftest` | NEW |

## Appendix C — Verified file index

| File | Lines referenced |
|---|---|
| `server/src/lib/enrollproClient.ts` | 106-149 (timeout 143), 198-221, 277-315, 324-352, 509-551, 589-594, 944-958 |
| `server/src/lib/syncCache.ts` | 27, 44-59, 90-132, 157-197, 215-217 |
| `server/src/lib/syncCoordinator.ts` | 32-44, 139-225, 438, 511-515, 651-689 |
| `server/src/lib/sync/httpClient.ts` | 25-27, 50-132, 305-377, 459-496 |
| `server/src/lib/aimsClient.ts` | 132-148, 155-190, 197-219 |
| `server/src/lib/teacherSync.ts` | 135, 400-471, 726-780 |
| `server/src/routes/grades-sub/helpers.ts` | 52, 60-99 |
| `server/src/routes/grades-sub/aims.ts` | 73, 83-84, 93, 274-275 |
| `server/src/routes/integration.ts` | 312-330 |
| `server/src/lib/schoolYearResolver.ts` | 35-84, 114-215 |
| `server/src/lib/rollover.ts` | 95-178, 240-355 |
| `server/src/routes/auth.ts` | 84-108, 111-197 |
| `server/src/routes/admin-sub/dashboard.ts` | 146, 159-162 |
| `server/src/lib/syncGuard.ts` | fail-closed guard helpers |
| `server/src/schemas/atlas.ts` | effective-load contract |
| `server/scripts/seed-test-base.ts` | 30-41 |
| `server/scripts/require-test-db.js` | 13-33 |
| `server/vitest.config.ts` | 8-20, 32 |
| `playwright.config.ts` | 3-25 |
| `e2e/fixtures.ts` | 32-48, 59-70 |
| `vite.config.ts` | 17-34 |
