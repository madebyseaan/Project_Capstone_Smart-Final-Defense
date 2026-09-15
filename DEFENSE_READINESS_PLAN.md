# Defense Readiness Plan — Road to 100/100

**Project:** SMART — Student Management and Records Tracking
**Created:** 2026-09-15
**Status:** Planning only. No fixes in this document have been applied.
**Companion document:** `FULL_AUDIT_REPORT.md` (audit evidence and file:line references)
**Owner:** (assign) · **Target defense date:** (fill in)

---

## 0. How this plan works — the one rule

> **RULE: TEST BEFORE CONCLUDING.**
> No item is complete until its *Verification* section has been executed and its output recorded in the Evidence Log (§10). "It should work" is not evidence. Every fix must be proven by at least one automated check plus, for user-facing flows, one E2E or manual rehearsal.

Definition of **100/100** used in this plan: *every acceptance gate in §8 passes, verified and recorded, on the frozen defense build.* It is a gate, not a vibe. Perfectionism beyond the gates (e.g., 0 ESLint warnings, every file <1000 lines) is tracked as P3 stretch and is **not required** to claim 100.

### Decisions needed before Phase 1 (recommended defaults)

| # | Decision | Recommended default | Why |
|---|---|---|---|
| D1 | Is Companion SSO demoed at defense? | **No — park it** | Work-in-progress, failing typecheck, not needed to show the capstone's core value. Move to a feature branch. |
| D2 | Is a deployed production build part of the defense? | **Yes — deploy or preview build** | Panels respect a working build; also forces the type/build gates to be real. |
| D3 | Defense date / dry-run date | Fill in; reserve last full day for rehearsal only | Rollover-first track is 8 days (§7). If a defense is within 72 h, the §2.5 T-minus track takes precedence for that window, then Phase R resumes. |
| D4 | Acceptable ESLint warning budget at freeze | **≤ 200 warnings, 0 errors** | 1111 today; burning to 0 is 971 `no-explicit-any` fixes and not defense-critical. |
| D5 | Is the demo DB seeded with the same data as prior demos? | Freeze a `pg_dump` snapshot after seeding | Guarantees repeatable demo; restore instantly if a rehearsal mutates data. |

### Priority order (effective immediately)

1. **Phase R — Rollover Readiness (§13) is the top priority.** It protects live student data. Within Phase R: **R0** (data-loss guards) → **R1** (stuck-state fixes) → **R2** (UI/cross-year correctness) → **R3** (tests).
2. **Defense demo protection (§2.5)** — only if a defense is within ~72 h. It is a time box, not a replacement; Phase R resumes right after.
3. **Plan to 100 (§3–§6)** — starts only after Phase R's R0/R1 gates are green, with T0-2 (isolated test DB) pulled forward as Phase R's Day-0 prerequisite.
4. Rule of thumb: **any change touching the rollover path or year/term resolution outranks every score improvement. If it cannot be tested on the isolated DB, it does not ship.**

---

## 1. Scoreboard: where we are → what 100 means

| Area | Now | 100 means (acceptance gate) | Workstream |
|---|---|---|---|
| Overall | 58 | All gates below green on frozen build | All phases |
| Backend type integrity | 90 | `tsc -p server/tsconfig.json --noEmit` → 0 errors | P2-9 |
| Frontend type integrity | 10 | `npx tsc -b` → 0 errors | P0-3 |
| Backend tests | 80 | Full 40-file Vitest suite green on an **isolated test DB**; new tests for every P0/P1 fix | P0-2, all items |
| E2E infrastructure | 10 | Playwright config + ≥6 role specs; **100% pass** on frozen build; zero console errors / zero ≥400 responses in happy paths | P0-1 |
| Audit-log coverage | 50 | All integrity actions listed in P1-6 emit audit rows; failure events recorded | P1-6 |
| Input validation | 50 | Zero mutating routes without schema; the 3 field-loss bugs fixed; coercion guards in place | P1-7, P1-8 |
| Secrets / PII | 40 | P1-1…P1-5, P1-9, P1-10 verified (tokens, TLS, fail-open, passwords, logs, headers) | P1-1…P1-10 |
| Runtime behavior | 70 | 27/27 routed pages PASS; 0 403/5xx in demo flows; 0 DOM-nesting warnings; write flows rehearsed | P0-4…P0-7 |
| Code health | 40 | P2 items done (dead code, leaks, timers, layer moves, splits started); ESLint 0 errors, warnings ≤ 200 | P2 |
| **Rollover readiness** | **35** | Phase R gates green: atomic rollover, no prune data-loss path, explicit-year finalize, zero-enrollment handling, forced term refresh, new-year lock safety, dead handler removed | **Phase R (top priority)** |

---

## 2. What can embarrass you at defense — and the counter

| # | Landmine | Where it shows | Countermeasure (item ref) |
|---|---|---|---|
| E1 | 26 × `403 /api/admin/settings` floods on teacher/registrar pages | Network tab if panel opens DevTools; broken term labels/current term in UI | P0-4, P0-5 |
| E2 | Registrar EOSY silently shows **"T3"** as current term | Visible wrong data during EOSY demo | P0-5 |
| E3 | `npm run build` / typecheck fails if panel asks | Live terminal | P0-3, P0-6 |
| E4 | Half-finished SSO code in working tree + dead links | Repo questions, broken nav | D1, P0-8 |
| E5 | Any write flow (grade save, attendance, edit request) breaks mid-demo | Demo dies | P0-7 |
| E6 | Print layout (SF9/SF10) breaks or paginates badly | Printed handouts | P0-7 manual checklist |
| E7 | Empty advisory/class list from stale demo data | Blank-looking page | P0-2 (demo data seed/reset) |
| E8 | Slow pages > 5 s with SSE refetch storms | Awkward silence | P1-9, §8 perf gate |
| E9 | Security question you can't answer (tokens, PII) | Q&A | P1-1…P1-5 make the story clean: httpOnly cookies, TLS on, fail-closed |
| E10 | Offline EnrollPro/ATLAS during demo | Sync pages stall/error | P0-7: pre-warm cache, demo with backend up, note fallback behavior |
| E11 | **EnrollPro hits school-year rollover during defense week** | System flips years mid-demo; locked grades; new-year data invisible | §13: do not demo rollover day; run the pre-flight checklist; if it already flipped, follow §13.4 |

---

## 2.5 T-minus tonight track (if defense is TOMORROW)

> If defense is **Friday**, use this tonight-only track + the 3-day minimal path in §7. If defense is tomorrow, do **only** this, in this order. Stop coding at T-10 hours; rehearse twice and freeze.

| When | Action | Done when (TEST BEFORE CONCLUDE) |
|---|---|---|
| T-7h | **Snapshot the demo DB** (`pg_dump`), confirm both servers up (5173/5003), note restore command | Snapshot file exists; restore drill attempted once |
| T-6.5h | **Rehearse the exact demo script** on all 3 portals, including every write you plan to show (grade save, attendance save, edit request, EOSY view, SF print) | Every step either works or is written on the break-list |
| T-5h | **Fix only rehearsal breaks**, smallest possible change | The broken step passes on re-run, immediately after the fix |
| T-4h | **P0-4 + P0-5 minimal fix**: teacher/registrar term data via public settings endpoint; remove EOSY `?? "T3"` fallback | See correct term on screen; DevTools Network shows **0 × 403** on teacher classes / registrar EOSY |
| T-3h | **Park SSO**: commit to a feature branch, confirm demo path has no SSO entry points | `git status` has no half-wired SSO in the demo build; nav has no dead SSO link |
| T-2.5h | **Seed/reset demo data**; verify non-empty advisory/class/student lists per portal | Counts visible: teacher has classes, registrar has students, admin has audit rows |
| T-2h | **Print check**: SF9 + SF10 single and bulk | Printed output has logo, correct term, sane page breaks |
| T-1h | **Second full rehearsal** on restored snapshot, no interventions | Two consecutive clean runs |
| T-0.5h | **Freeze**: write the known-issues list (≤5) with one-line answers | Demo PC ready; no more code changes |
| T-0 | If anything breaks that was working: **restore snapshot**, do not debug live | — |

**Do NOT touch tonight:** auth/token refactor, TLS changes, error-handler wiring, audit gaps, the 72 type errors, file splits, rollover fixes. They are high-risk with zero demo value.

---

## 3. Phase 0 — Test foundation (T0-2 is Phase R's Day 0; T0-1/T0-3/T0-4 follow)

**Why this phase exists:** the audit could not run a single E2E spec, so every "verified" claim would otherwise be manual. **T0-2 (isolated test DB) is pulled forward as Phase R's Day-0 prerequisite** (§7). T0-1/T0-3/T0-4 are needed before the P0/P1 gates but do not block Phase R.

### T0-1 · Playwright Test infrastructure
- **Problem:** no `playwright.config.*`, no specs, `@playwright/test` not installed; `npx playwright test` collects backend Vitest files and crashes on `server/src/__tests__/aims-sync.test.ts:8`.
- **Fix:**
  - Add `@playwright/test` to root devDependencies.
  - Create `playwright.config.ts` with `testDir: './e2e'`, `baseURL: 'http://localhost:5173'`, `webServer` block (or documented "servers already running" mode), `trace: 'on-first-retry'`, video off, screenshots to `test-results/`.
  - Add `e2e/fixtures.ts` with per-role `storageState` setup (admin/teacher/registrar logins via UI once) and an **assertion helper that fails on any console error or API response ≥400** during a test.
  - Specs (initial set):
    - `e2e/auth.spec.ts` — 3 role logins, logout, redirect-on-protected-route.
    - `e2e/admin.spec.ts` — dashboard, users list, audit logs, settings load, no 4xx.
    - `e2e/teacher.spec.ts` — classes, class record detail, term label correctness, no 403s (regression for P0-4).
    - `e2e/attendance.spec.ts` — take attendance, save, reload, verify persisted.
    - `e2e/grades.spec.ts` — enter a score, save, reload, verify.
    - `e2e/registrar.spec.ts` — students, roster (no DOM warnings), forms list, EOSY term label correct.
  - **Session accounts (owner-mandated, dev-only):** every Playwright run uses the accounts stored in `tests/playwright-accounts.json` (gitignored; same pattern as `tests/smoke-test.mjs`): admin `1234501` (`/login/admin`), teacher `1000001` (`/login`), registrar `1234502` (`/login/registrar`). `SMART_TEST_*` env vars take precedence when set. Verified working in the 2026-09-15 audit. Never commit; never use outside development.
  - Add npm scripts: `test:e2e`, `test:e2e:ui`.
- **Verification (before checkbox):**
  1. `npx playwright test --list` lists only the 6 spec files (no `server/**`).
  2. `npx playwright test` → 100% pass on current dev servers.
  3. Intentionally break one selector and confirm the suite **fails** (proves it can fail).
- **Effort:** ~1 day. **Blocks everything.**
- **Risk:** storageState with multi-session storage (sessionStorage keys are per-portal) — capture via `page.evaluate` after login; accounts must exist in demo data (T0-4).

### T0-2 · Isolated test database for the backend suite
- **Problem:** `server/vitest.config.ts` has no DB guard; the suite targets live `smart_db` and includes destructive tests (`lib/wipe.ts`, rollover, prune).
- **Constraint:** AGENTS.md forbids modifying `.env` / `.env.*`. Do **not** create `.env.test`. Use process env override (dotenv does not overwrite existing env vars).
- **Fix:**
  - Create DB `smart_test_db` (local PostgreSQL), run `prisma db push` against it.
  - Add a guard at the top of `server/vitest.config.ts` (or a setup file): read `DATABASE_URL` from `process.env`; **abort with a clear message unless the database name ends in `_test`**.
  - Add npm script that fails loudly if the guard is not satisfied:
    - `"test": "node scripts/require-test-db.js && vitest run"` (new small guard script; no secrets in repo).
  - Document the operator command in README/AGENTS:
    `$env:DATABASE_URL='postgresql://...smart_test_db'; npm --prefix server test`.
- **Verification:**
  1. `DATABASE_URL` pointing at `smart_db` → suite refuses to start (prove guard works).
  2. Pointing at `smart_test_db` → full 40-file suite runs; record pass/fail counts (expect some pre-existing failures — they become backlog items; fix or quarantine with reason).
  3. Confirm `smart_db` row counts unchanged after the run (quick before/after counts on `User`/`Grade`).
- **Effort:** ~3 h. **Risk:** local Postgres availability; flyway-style schema drift (use `db push` to match `schema.prisma`).

### T0-3 · `npm run verify` — one command, all gates
- **Fix:** add root script:
  `"verify": "npm run typecheck && npm --prefix server run build && npm run lint && npm --prefix server test && npm run test:e2e"`
  - `typecheck` = `tsc -b` (frontend, both projects).
  - `lint` = `eslint .` (0 errors gate).
- **Verification:** run it; it must fail today (proves it detects the current red state), then turn green as items land. Record the first red output in the Evidence Log.
- **Effort:** ~1 h.

### T0-4 · Demo data seed + reset + snapshot
- **Problem:** demo data drift (e.g., empty advisory list); no reset mechanism.
- **Fix:**
  - Add `server/scripts/seed-demo.ts` (idempotent: wipe demo tables → seed 2 school years, 3 sections per level, 20 students, teacher accounts, one finalized term + one open term, a pending grade-edit request, attendance for the current week).
  - Add `npm run demo:seed` / `demo:reset`.
  - After first successful seed: take a `pg_dump` snapshot `demo-snapshot.sql` (stored outside git, path documented) so restore is one command.
- **Verification:** seed → login as each role → expected counts visible (teacher has classes, registrar has students, admin has audit rows); reset → re-seed → same counts (idempotence).
- **Effort:** ~4 h. **Risk:** matching the exact demo narrative; iterate once with the presenter.

---

## 4. Phase 1 — P0 defense blockers

**Sequencing note:** if a defense is within 72 h, P0-4/P0-5/P0-8 run per the §2.5 T-minus track. Otherwise **P0-4 ships as RL-4a inside Phase R (R2)**, and the rest of P0 resumes after Phase R's R1 gates are green.

### P0-4 · Kill the 403 floods: role-appropriate term/settings read ✦ (E1)
- **Evidence:** `GET /api/admin/settings` → 403 on teacher pages (`ClassRecordsList.tsx:295`, `ClassRecordView.tsx:139`) and registrar EOSY (`EOSYFinalization.tsx:194,214`); 26 occurrences observed.
- **Fix (recommended option A — extend the existing public endpoint):**
  - Inspect the public projection handler (`server/src/routes/admin-sub/system.ts`, `GET /api/admin/settings/public`, projection around `:38-45`).
  - Add **only safe fields** to it: `currentSchoolYear`, `currentTerm`, `termLabels` (no credentials, no lock config).
  - Add `publicSettingsApi` in `src/lib/api.ts` (or reuse the fetch used by `ThemeContext.tsx:5`).
  - Switch the four call sites to the public endpoint; keep admin pages on `/admin/settings`.
- **Alternative B:** new `GET /api/settings/term-info` (any authenticated role). More explicit, slightly more code.
- **Verification (TEST BEFORE CONCLUDE):**
  1. Unit test on the public handler asserts payload contains exactly the allowlisted fields (no `enrollproPassword`, no integration keys).
  2. E2E teacher spec asserts **zero** responses ≥400 while loading `/teacher/classes` and a class record; term labels equal admin's configured labels.
  3. E2E registrar spec asserts `/registrar/eosy` shows the configured current term.
  4. Manual: open DevTools Network on both pages → no 403s.
- **Effort:** ~3 h. **Risk:** low. **Blocks defense: yes.**

### P0-5 · EOSY never silently defaults to "T3" ✦ (E2)
- **Evidence:** `src/pages/registrar/EOSYFinalization.tsx:218` `setCurrentTerm(data.settings?.currentTerm ?? "T3")`; silent catch `:219-221`.
- **Fix:** remove the fallback; render an explicit "Unavailable — retry" state when term fetch fails; surface a toast. Keep "T3" only if an explicit, documented reason exists (none found).
- **Verification:** E2E with current term = T1 (demo snapshot) → page shows T1; simulate failure (point fetch at a 500 via route interception in the spec) → page shows the unavailable state, not T3.
- **Effort:** ~1 h. **Blocks defense: yes.**

### P0-6 · Frontend typecheck to 0 (72 errors) ✦ (E3)
Break into sub-items; each is a commit with `npx tsc -b` evidence.

| ID | Group | Files (evidence) | Fix approach |
|---|---|---|---|
| 6a | Missing module | `src/pages/teacher/components/RotationBanner.tsx:3` imports `'../../lib/api'` | Verify if dead (not imported anywhere); delete file or fix path to `@/lib/api` |
| 6b | Duplicate object keys | `src/pages/teacher/Schedule.tsx:124-125` | Merge duplicate properties; add null guard at `:241` |
| 6c | LoginResponse drift | `src/pages/LoginPage.tsx:56-57`, `AdminLoginPage.tsx:54-55`, `RegistrarLoginPage.tsx:53-54` | Add `refreshToken` to the response type **or** (better, after P1-1) remove frontend usage entirely |
| 6d | Layout nav typing | `src/layouts/AdminLayout.tsx:32,138-139,241-247,271,317,335,397,418` | Define recursive `NavItem` type with `children?`, `disabled?`, `isDropdown?`, `inDevelopment?`; annotate the nav array |
| 6e | Base UI select signatures | `ClassAssignments.tsx:351`, `SubjectWeightsPanel.tsx:183`, `TransmutationTable.tsx:321`, `FormViewer.tsx:102,133`, `teacher/Dashboard.tsx:1001,1019` | Wrap handlers: `(v) => setX(v ?? "")` (match Base UI's `string \| null` signature) |
| 6f | Stale API response types | `ClassRecordView.tsx:93,294,299,323`; `ClassRecordsList.tsx:300,387-388`; `AimsPanel.tsx:147`; `teacher/Dashboard.tsx:236`; `StudentRecords.tsx:163,499`; `SF9Form.tsx:23-54`; `SF10Editor.tsx:177`; `SF10Form.tsx:162`; `ThemeContext.tsx:262,285`; `AttendanceReports.tsx:536,538`; `CompleteRemedialDialog.tsx:118`; `RemedialHistoryTable.tsx:144,148`; `AlumniStudents.tsx:306`; registrar components | For each: capture the **actual** server payload (curl the endpoint; print JSON), update the interface to match, or guard with optional chaining where the field is truly optional. Do not cast with `any`. |
- **Verification:** after each sub-item, `npx tsc -b` errors strictly decrease; sub-item done at 0 remaining errors. Then run T0-1 E2E suite to confirm no runtime regression.
- **Effort:** ~1.5 days total. **Blocks defense: yes.**

### P0-7 · Write-flow rehearsal (grades, attendance, edit requests, EOSY, print) ✦ (E5, E6)
- **Problem:** audit was read-only; zero evidence that writes work end-to-end.
- **Fix:** automate where possible, manual where not:
  - Playwright: grade entry → save → reload → value persists; attendance → save → reload → persists; edit request create → admin approve → teacher can edit past term (on demo DB).
  - Manual checklist (print): SF9/SF10 single + bulk print, headers/footers, page breaks, school logo present.
- **Verification:** each scripted write flow green in E2E; print checklist signed with a photo/PDF of output; re-run after every subsequent change that touches grades/attendance.
- **Effort:** ~1 day (0.5 automation + 0.5 manual). **Blocks defense: yes.**

### P0-8 · Scope freeze and cleanup ✦ (E4)
- **Fix:**
  - Decide D1: park SSO. Move uncommitted SSO files to a branch (`git stash`/worktree is not enough — commit on a feature branch) or explicitly finish and type it if D1=yes. Do not leave a half-wired SSO in the demo build.
  - Remove or hide any SSO nav entries from the demo build (verify `IntegratedSystemsNav.tsx` not rendered when parked).
  - Replace the wildcard route (`src/App.tsx:125-126`) with a role-aware redirect or a simple NotFound page; stop bouncing authenticated users to `/login`.
  - Fix the roster DOM-nesting warning (E8-adjacent, cheap): move `LoadingSkeleton`/`EmptyState` inside a `<tbody>` in `SectionRosterViewer.tsx:385-397`, or add table-less variants in `TableStates.tsx:28-94`.
- **Verification:** E2E run shows zero console errors on all specs; `git status` clean of unrelated work at freeze; manual: unknown URL while logged in → sensible page.
- **Effort:** ~3 h. **Blocks defense: yes.**

---

## 5. Phase 2 — P1 security, integrity, and validation (the "100" substance)

Each item is a fixed format: Fix → Verification → Effort/Risk.

### P1-1 · Stop exposing refresh/access tokens to JavaScript
- **Evidence:** refresh token returned in JSON (`server/src/routes/auth.ts:310-313,416`; `server/src/routes/sso.ts:175-186`); stored in `sessionStorage` (`src/lib/api.ts:136-138`, login pages); registrar EOSY reads `localStorage` first (`EOSYFinalization.tsx:163,179`).
- **Fix (staged, test each step):**
  1. Server: stop returning `refreshToken` in the body; keep the httpOnly cookie (`lib/tokens.ts:67-98`) as the single refresh transport. Keep access token in the body for now (15 min TTL).
  2. Frontend: remove refresh-token storage; `POST /auth/refresh` already accepts the cookie — verify (`api.ts` interceptor).
  3. Remove `localStorage` token reads; delete on-login writes of `refreshToken_*` keys.
  4. Optionally move access token to memory-only and rehydrate via refresh on load (nice-to-have; only if time).
- **Verification:**
  1. Backend test: login response contains no `refreshToken`; refresh works with cookie only; reuse of an old cookie still triggers family revoke.
  2. E2E: login → force access expiry (or call refresh directly) → page still works; logout clears session.
  3. Manual: `sessionStorage`/`localStorage` inspect → no `refreshToken_*`.
- **Effort:** ~4 h. **Risk:** medium (auth flow regressions) — ship behind a feature branch with E2E auth spec green.

### P1-2 · Re-enable EnrollPro TLS verification
- **Evidence:** `server/src/lib/enrollproClient.ts:120` `rejectUnauthorized: false` on every outbound call, including credential validation (`:904-912`).
- **Fix:** default `rejectUnauthorized: true`; optional `ENROLLPRO_INSECURE_TLS=true` only for local dev with a warning log; support `ENROLLPRO_CA_PATH` if the dev host uses a private CA.
- **Verification:** login as teacher with EnrollPro reachable → success; unit test asserts transport config respects the env (and never defaults to insecure); run `npm run verify`.
- **Effort:** ~1 h. **Risk:** medium if the dev host has a bad cert — test immediately; document the fallback env if needed.

### P1-3 · Fail-closed service auth + set the key
- **Evidence:** `server/src/middleware/serviceAuth.ts:14-17` calls `next()` when `ENROLLPRO_API_KEY` is unset (it is unset in `server/.env`); CSRF exempts `/sync-grades` (`csrf.ts:62-65`).
- **Fix:** return 401 when the key is unset; set `ENROLLPRO_API_KEY` in the environment (operational; do not edit `.env` per AGENTS — set in PM2/ecosystem/env config or request owner to add it).
- **Verification:** unset key → integration endpoints return 401 (test); with key → authorized request works; CSRF exemption alone no longer grants access.
- **Effort:** ~1 h. **Risk:** may break the external integration callers — coordinate with the integration owner before flipping.

### P1-4 · Remove default sync password
- **Evidence:** `server/src/lib/enrollproSync.ts:216` `DEFAULT_SYNC_PASSWORD || 'password123'`.
- **Fix:** require the env var; skip + audit-skip account creation when unset; run a one-time query for existing accounts created with the default and force-reset them.
- **Verification:** unit test: creation refused without env; with env: account created; audit log emitted. Query result attached to Evidence Log.
- **Effort:** ~2 h. **Risk:** medium (may lock out demo teacher accounts if they were auto-created) — check demo accounts first.

### P1-5 · Wire the real error handler + production mode
- **Evidence:** `server/src/app.ts:71-75` is dead code; live entry `server/src/index.ts` has no error middleware; `server/.env` lacks `NODE_ENV`.
- **Fix:** duplicate/import the generic error handler into the live app bootstrap; set `NODE_ENV=production` for production/PM2 (already in `ecosystem.config.cjs:14`, confirm) and in `start` scripts.
- **Verification:** hit a route with a forced throw in a test (`/api/health?boom` behind a test-only flag or a unit test on the handler) → response is `{ message: "Internal server error" }` with no stack; server log contains the stack. Test both dev and prod modes.
- **Effort:** ~1 h. **Risk:** low.

### P1-6 · Close high-integrity audit gaps
- **Evidence (ranked):** finalize `registrar/main.ts:1226`, unfinalize `:1330`, edit-request create `editRequests.ts:18`, attendance clear/bulk `attendance.ts:119,162`, enrollment status `registrar/main.ts:1191`, class-assignment create/archive `classAssignments.ts:308,351`, transmutation rows `grading.ts:237,264,302`, subject weights `:427,457,481`, refresh `auth.ts:330`, logout-all `:505`, SSO session/authorize/exchange `sso.ts:140,197,225`, sync-inactive `registrar/main.ts:720`, sync triggers `sync.ts:27,66` etc.
- **Fix pattern per site:** `await createAuditLog(action, req.user, target, targetType, details, ..., metadata, outcome)` — reuse `AuditAction` enum values; extend the enum + admin filter labels where new actions are needed; record before/after for destructive ops (counts, old/new values).
- **Failure auditing:** add `outcome: "failure"` writes for 401/403 (`middleware/auth.ts:29-61`), CSRF rejects (`csrf.ts:86-88`), rate limits, validation failures (`validate.ts:34-42`), refresh reuse (`auth.ts:354-362`).
- **Verification:** scripted API tests that perform each action, then query `AuditLog` (via `GET /api/admin/logs` or Prisma in a test) asserting the row exists with the expected action/outcome/target. Add an E2E admin-logs check that a just-performed action appears.
- **Effort:** ~1.5 days. **Risk:** low (additive), but enum/migration if new actions are added.

### P1-7 · Fix the 3 schema/route field-loss bugs
- **Evidence:** attendance `remarks` stripped (`schemas/attendance.ts:9-12` vs `routes/attendance.ts:202,210`, frontend sends at `Attendance.tsx:335`); template bundle rejected/fields stripped (`schemas/templates.ts:12-20` vs `routes/templates.ts:489,523-529`); grade extras dropped (`schemas/grades.ts:20-33` vs `api.ts:454`).
- **Fix:** extend schemas (`remarks` optional string; bundle variant with `formTypes`/`sheetMappings`/`uploadMode:"bundle"`; `qualitativeDescriptor`/`remarks` on grades). Prefer discriminated-union schemas over loosening.
- **Verification:** unit tests: parse valid payloads and assert fields survive; attendance E2E saves remarks and reload shows them; template bundle upload succeeds (test fixture); grade extras round-trip via API test.
- **Effort:** ~4 h. **Risk:** low.

### P1-8 · Validation and coercion hardening on mutating routes
- **Evidence:** ~33 unvalidated mutating routes, incl. `admin-sub/system.ts:483,821`, `admin-sub/grading.ts:427,481`, `registrar/main.ts:1226,1330`, `attendance.ts:119,162`, `auth.ts:330` (unused `refreshSchema`). Query coercions: `admin-sub/audit.ts:64`, `registrar/main.ts:963`, `admin-sub/system.ts:66`, `attendance.ts:361`.
- **Fix:** add zod schemas per route (batch them per file); add a shared `parseIntParam` helper with finite/range checks; bounds for weights (`0–100`), month (`1–12`), year (reasonable range); wire `refreshSchema`.
- **Verification:** per-schema unit tests (valid + invalid); API tests assert 400 for junk (`?limit=abc`, weight `9999`); no 500s from bad input.
- **Effort:** ~1 day. **Risk:** low-medium (could reject previously accepted calls — coordinate with frontend payloads).

### P1-9 · PII-safe logging
- **Evidence:** LRNs (`integration.ts:254,298`, `registrar/main.ts:935`), emails/IDs (`auth.ts:78,115,194`, `teacherSync.ts:404,410`), LRN-bearing `result.errors` returned to clients (`advisory.ts:818`).
- **Fix:** remove/mask identifiers in log messages (use DB ids or `lrn.slice(-4)` masks); keep full values only in audit metadata where required (audit rows are access-controlled). Add a small `redact()` in `lib/logger.ts` for known keys.
- **Verification:** unit test on `redact`; run a scripted login + advisory sync and grep captured server logs for raw LRN/email patterns → zero hits.
- **Effort:** ~3 h. **Risk:** low.

### P1-10 · Transport hardening
- **Evidence:** tokens in URLs (`middleware/auth.ts:24-26` + 4 SPA call sites); no Helmet/security headers; unauthenticated `/uploads` (`index.ts:75`); CSRF exemptions for `/admin/settings` (`csrf.ts:68-71`), `CORS_ORIGIN` unset.
- **Fix:**
  - Add `POST /api/auth/stream-token` (60 s JWT, scope=`stream`) and use it for EventSource; stop accepting the general access token from query on non-stream routes (or remove the query fallback entirely).
  - Add Helmet (or manual headers): CSP, HSTS (prod), `X-Content-Type-Options`, `X-Frame-Options`/frame-ancestors.
  - Serve `/uploads` behind auth or move templates/logos to an authenticated route; SVG uploads either disallowed or served with `Content-Disposition: attachment` + `Content-Security-Policy`.
  - Narrow CSRF exemptions to exact safe paths; set `CORS_ORIGIN` for deployed origins.
- **Verification:** curl shows headers; E2E teacher page loads with a stream-token (no JWT in URL — assert URL pattern); unauthenticated `/uploads/...` returns 401; credential PUT without CSRF header returns 403.
- **Effort:** ~1 day. **Risk:** medium (CSP can break inline styles/print) — iterate with the print checklist.

### P1-11 · SSE lifecycle + connection dedupe
- **Evidence:** multiple EventSource instances per page (`useSyncStream.ts` + Layout + pages); stale clients in `lib/sseManager.ts:36-85` only removed on synchronous write throw; scheduler intervals never cleared (`index.ts:402,448`).
- **Fix:** export a single shared connection (module-level singleton with refcount) from `useSyncStream`; in `sseManager`, listen for `res.on('close'|'error')` and check `destroyed/writableEnded` before writing; add `stopAutoTermScheduler`/`stopRetentionScheduler` and clear on shutdown; await `server.close()` before exit (`index.ts:243-269`).
- **Verification:** E2E counts stream requests per page load = 1 (route interception counter); kill the server mid-stream → client reconnects cleanly, no duplicate clients (server debug counter); shutdown releases the port promptly and no timer keeps the process alive.
- **Effort:** ~4 h. **Risk:** medium (SSE powers live updates — verify admin logs still update).

### P1-12 · Unique email + deterministic login
- **Evidence:** `prisma/schema.prisma:24` no unique on `User.email`; login `findFirst` (`auth.ts:68-70`).
- **Fix:** data cleanup query (list duplicates), resolve manually, add `@unique` + migration, change login to `findUnique`/ordered match.
- **Verification:** migration applies on test DB; duplicate insert rejected; login test for both email and username paths; full suite green.
- **Effort:** ~3 h. **Risk:** medium (existing dupes) — run the query first and report before migrating.

### P1-13 · Sanitize theme-color style injection
- **Evidence:** `MyAdvisory.tsx:264,338,415` `dangerouslySetInnerHTML` with interpolated theme colors.
- **Fix:** validate/whitelist color format (`#RGB`/`#RRGGBB`/CSS var) at the settings boundary and before interpolation.
- **Verification:** unit test for the validator; E2E advisory page with normal settings; attempt a malicious color in settings (test-only input) → rejected.
- **Effort:** ~2 h. **Risk:** low.

---

## 6. Phase 3 — P2 code health (do after P0/P1; trims the last points)

| ID | Item | Verification | Effort |
|---|---|---|---|
| P2-1 | Delete dead code: `server/src/app.ts` (after P1-5 wires the handler), `lib/teacherDashboardComposer.ts`, `src/lib/constants.ts`, unused exports (`refreshSchema` replaced by P1-8, `syncLimiter`, `invalidateEffectiveTeachingLoad`, unused API getters) | grep shows zero imports before delete; `tsc -b` + suite green after | ~4 h |
| P2-2 | Route or delete `PrintCenter.tsx`/`FormViewer.tsx`; update `AGENTS.md` file map to reality | E2E (if routed) or repo docs updated; no phantom routes | ~2 h |
| P2-3 | Deduplicate `mapGradeLevel` (4×), subject canonicalizers (5×), exam-math, transmutation seed (3×), `formatDate` (5×) | Unit tests on the shared helpers; callers switched; `tsc` green | ~1 day |
| P2-4 | Fix unbounded caches and body accumulation: `syncCache.ts` (size/TTL sweep), `enrollproClient.ts:128-140` & `httpClient.ts:85-107` (max body size), `syncCoordinator.ts:525` (track boot timer) | Unit test for cache eviction; load test (fire 500 unique keys → size capped); shutdown clears timers | ~4 h |
| P2-5 | Frontend leak cleanup: object URL revoke (`Attendance.tsx:366`), timer cleanup (`ClassRecordTour.tsx:351`, `SystemSettings.tsx:139`, `Schedule.tsx:186`, `Attendance.tsx:317,342`), `afterprint` listener removal (`Sf10RecordsPage.tsx:394`, `SchoolForms.tsx:207`) | Manual unmount checks + memory snapshot before/after a navigation loop; eslint react-hooks clean | ~3 h |
| P2-6 | Split files >1000 lines (`api.ts` 2012, `registrar/main.ts` 1981, `enrollproSync.ts` 1323, `classes.ts` 1301, `enrollproClient.ts` 1280, teacher `Dashboard.tsx` 1085) | Each split is pure moves behind unchanged public functions; `tsc` + suite + E2E green after each | ~2–3 days (start with 2 files) |
| P2-7 | Fix layer inversions: move grading engine out of `routes/grades-sub/helpers.ts` into `lib/`; break `schoolSettingsSnapshot` ⇄ `schoolYearResolver` cycle; move `assertSectionAttendanceWritable` | Import graph assertion (no `lib → routes` imports); tests green | ~1 day |
| P2-8 | Burn down ESLint warnings toward D4 budget (≤200): prioritize `no-unused-vars` (87) and `set-state-in-effect` (14) over the 971 `any`s | `eslint .` warning count recorded each pass | ~1 day to budget |
| P2-9 | Backend warnings/typing + any remaining `tsc` (already 0) | 0 errors maintained | — |

---

## 7. Schedule — rollover-first

> Effective immediately: **Phase R (§13) first, then the Plan to 100 (§3–§6).** If a defense is within ~72 h, the T-minus track (§2.5) runs tonight first — it is a time box, not a replacement; R0 resumes immediately after.

### Rollover-first track (8 working days)
| Day | Work |
|---|---|
| 0 | **T0-2 first** — create `smart_test_db`, wire the `_test` guard, take a `pg_dump` snapshot. Prerequisite for every Phase R fix. |
| 1 | **R0a:** RL-5a atomic rollover (revert both settings, abort the sync cycle, block prune on year mismatch) + forced-failure test |
| 2 | **R0b:** RL-6a (unlock on failed archive), RL-9a (delete dead handler, validate live), RL-10a (fail-closed year resolution) + tests |
| 3 | **R1a:** RL-1a explicit-`schoolYear` finalize/unfinalize + integration test after FK flip |
| 4 | **R1b:** RL-2a zero-enrollment sections, RL-3a forced term-date refresh on rollover + tests |
| 5 | **R2a:** RL-4a (= P0-4 public term endpoint), RL-7a manual bypasses routed through the archive core |
| 6 | **R2b:** RL-8a cross-year query fixes; full Phase R regression suite (RL-11a) green on `smart_test_db` |
| 7 | **Rollover drill:** simulate an EnrollPro flip on a restored snapshot using fixtures; run the §13.4 runbook end-to-end; fix anything that fails with a test |
| 8 | **Plan to 100 resumes:** T0-1/T0-3/T0-4 if not already done, then P0-5…P0-8, P1, P2, final gate (§8) |

### Minimal path (if defense is within ~3 days)
1. **Tonight:** run the T-minus track (§2.5) — demo protection only.
2. **If defense is Friday:** Day 1 → rollover R0a/R0b (contained, testable); Day 2 → freeze + rehearsal; everything else after defense.
3. **If defense is tomorrow:** no Phase R work before the defense. Resume the rollover-first track at Day 0 afterward.
4. Rationale: Phase R is backend/data-safety work; landing it in panic mode before a defense adds demo risk without improving the demo.

---

## 8. Final acceptance checklist (the 100/100 gate)

Run on the **frozen** build, twice, with fresh logins. Every line needs recorded evidence.

**Build & static**
- [ ] `npx tsc -b` → 0 errors
- [ ] `npm --prefix server run build` → 0 errors
- [ ] `npm run build` → succeeds; `npm run preview` serves the app
- [ ] `npx eslint .` → 0 errors, warnings ≤ D4 budget

**Tests**
- [ ] Backend full suite on `smart_test_db` → 100% of non-quarantined tests pass (quarantine list documented with reasons)
- [ ] `npx playwright test` → 100% pass, ≥6 specs
- [ ] E2E assertion: **zero** console errors and **zero** API responses ≥400 on all happy paths
- [ ] E2E assertion: stream requests per page = 1; no JWT in any URL
- [ ] Regression: `npm run verify` green end-to-end

**Flows (E2E-covered)**
- [ ] 3 role logins + logout
- [ ] Teacher: class list → class record → term label correct → save a grade → persists after reload
- [ ] Teacher: attendance save → persists after reload
- [ ] Grade edit request: create → admin approve → teacher edit unlocked for the approved term
- [ ] Registrar: students, roster (no DOM warnings), forms load; EOSY shows correct current term
- [ ] Admin: users, logs, settings load with 0 4xx; a performed action appears in audit logs
- [ ] Print: SF9 + SF10 single and bulk produce correct PDFs (manual, signed)

**Security & integrity**
- [ ] Login response has no `refreshToken`; no `refreshToken_*` in storage
- [ ] TLS verification on for EnrollPro (or documented CA); serviceAuth returns 401 when key unset
- [ ] Default sync password absent; no account uses it
- [ ] A forced 500 returns generic JSON; stack only in server log
- [ ] Security headers present; unauthenticated `/uploads` blocked
- [ ] Audit rows verified for: finalize, unfinalize, attendance clear/bulk, edit-request create, refresh, logout-all
- [ ] Failed 401/403/CSRF/validation attempt appears as `outcome: "failure"`
- [ ] Log capture shows no raw LRN/email

**Demo**
- [ ] Demo snapshot restored; seed idempotent
- [ ] Two consecutive full rehearsals with zero manual interventions
- [ ] Known-issues list (≤5) prepared for Q&A with answers

**Rollover (Phase R) — the real-world gate, required before any EnrollPro rollover**
- [ ] Forced archive-failure test: both settings revert, no prune deletes, no new-year writes in the failed cycle
- [ ] Failed archive leaves old-year grades editable (no stuck year lock)
- [ ] Registrar finalize/unfinalize accepts explicit `schoolYear`; old-year finalization works after FK flip
- [ ] Zero-enrollment section does not block archive (or admin override verified)
- [ ] Rollover forces term-date refresh; new-year T2/T3/year stay unlocked (scheduler simulation)
- [ ] Prune refuses to run when SMART-active label ≠ EnrollPro-active year
- [ ] Dead `/archive-year` handler removed; live handler validates its body
- [ ] Manual year switch (`PUT /admin/settings`) and SchoolYears `status=ARCHIVED` route through the archive core
- [ ] Year-switch fixture: zero cross-year violations from the audited query list (`classes.ts:48`, `teacherSync.ts:656`, `dashboard.ts:78`, `transferees.ts:38`)
- [ ] Full Phase R suite green on `smart_test_db` + rollover drill on a restored snapshot

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Auth refactor (P1-1) breaks refresh/logout near freeze | Medium | High | Land early (Day 6), E2E auth spec must be green before proceeding; feature branch; revert plan |
| TLS fix (P1-2) breaks dev EnrollPro | Medium | Medium | Test immediately; keep `ENROLLPRO_INSECURE_TLS` escape hatch with warning; coordinate with integration owner |
| Playwright flakiness (SSE keeps network busy) | High | Medium | Use state-based waits, not `networkidle`; assertion helper ignores aborted streams; retries=1 locally |
| Type fixes reveal deeper API mismatches | Medium | Medium | Fix interfaces to match server payload; never `any`; add response tests where cheap |
| Demo DB mutated during rehearsal | Medium | High | Snapshot + restore script; re-seed before defense; keep a second machine ready |
| Audit-gap work adds Prisma enum/migration | Low | Medium | Batch enum additions in one migration; test on test DB first |
| Scope creep during Phase 1 | High | High | Gate: only P0 until all P0 gates pass; new requests go to a backlog list |

---

## 10. Evidence Log (fill as items complete)

> Format: `Item | Date | Command/step | Result | Evidence (file path / pasted output) | Done by`

| Item | Date | Verification executed | Result | Evidence | Done |
|---|---|---|---|---|---|
| T0-1 Playwright | | `npx playwright test` | | | [ ] |
| T0-2 test DB guard | | suite on `smart_test_db` | | | [ ] |
| T0-3 verify script | | `npm run verify` | | | [ ] |
| T0-4 demo seed | | seed → counts → reset → counts | | | [ ] |
| P0-4 term endpoint | | E2E zero-4xx assertions | | | [ ] |
| P0-5 EOSY term | | E2E T1 + failure-state | | | [ ] |
| P0-6 typecheck | | `npx tsc -b` → 0 | | | [ ] |
| P0-7 write flows | | E2E + print checklist | | | [ ] |
| P0-8 freeze/cleanup | | E2E console clean; git status | | | [ ] |
| P1-1 tokens | | API + storage inspection | | | [ ] |
| P1-2 TLS | | live login + unit test | | | [ ] |
| P1-3 serviceAuth | | 401 without key | | | [ ] |
| P1-4 password | | unit + account query | | | [ ] |
| P1-5 error handler | | forced 500 response | | | [ ] |
| P1-6 audit gaps | | row assertions per action | | | [ ] |
| P1-7 schemas | | round-trip tests | | | [ ] |
| P1-8 validation | | junk-input 400s | | | [ ] |
| P1-9 PII logs | | grep capture | | | [ ] |
| P1-10 transport | | header + URL assertions | | | [ ] |
| P1-11 SSE | | connection-count test | | | [ ] |
| P1-12 unique email | | migration + login tests | | | [ ] |
| P1-13 style injection | | validator test | | | [ ] |
| P2 items | | see §6 | | | [ ] |
| Final gate §8 | | full pass ×2 | | | [ ] |

---

## 11. Explicitly out of scope for the 100 gate (backlog)

- Migrating tokens fully to memory-only (nice-to-have after P1-1).
- Rewriting all 971 `no-explicit-any` warnings to typed code.
- Splitting all six >1000-line files (P2-6 starts the two worst; the rest is backlog).
- Full EnrollPro/ATLAS contract tests against the live external systems (they are read-only and sometimes offline; behavior is covered via guards/fallbacks).
- SSO feature completion unless D1 changes.

---

## 12. Immediate next actions (rollover-first)

1. **Decide D1–D5** and fill in the defense date at the top. If the defense is within 72 h, stop here and run §2.5 tonight.
2. **Day 0 — T0-2:** create `smart_test_db`, wire the `_test` guard, and take a `pg_dump` of the live DB. Nothing in Phase R merges until it can be tested here.
3. **Day 1 — R0a (RL-5a):** make rollover atomic (revert both settings, abort the sync cycle, block prune on year mismatch) and land the forced-failure test. This is the only item that prevents irreversible data loss.
4. **Day 2 — R0b:** RL-6a (unlock on failure), RL-9a (delete dead handler), RL-10a (fail-closed year resolution) — each with its test.
5. Then continue the rollover-first track in §7; the Plan to 100 resumes only after R1 is green.

> Reminder: nothing in this plan is complete until its Verification section is executed and pasted into §10. If you cannot test it, you cannot claim it.

---

## 13. Rollover Readiness — what happens when EnrollPro flips school year

**Investigated 2026-09-15.** Verdict: **NOT fully ready.** SMART auto-creates the new local `SchoolYear`, auto-locks the old year, and auto-archives **only when the old year is 100% EOSY-finalized with zero snapshot gaps**. Any unfinished state creates stuck conditions; two failure modes risk data loss.

### 13.1 What IS automatic when EnrollPro's active year changes

- New local `SchoolYear` row created (or matched by `externalId`/label) and set active; `SystemSettings.schoolYearId` + `currentSchoolYear` re-pointed — `server/src/lib/schoolYearResolver.ts:137-165`.
- Previous year **immediately year-locked** — `server/src/lib/rollover.ts:253`.
- Full archive (grades/enrollments/sections/assignments archived, year ARCHIVED, statuses set, legacy `gradeLock` cleared) — `rollover.ts:95-178` — only if: zero unfinalized sections (`:263-272`) **and** no finalized-grade/snapshot gap (`:109-149`).
- New-year sections + enrollments created from the EnrollPro feed — `server/src/lib/enrollproSync.ts:411-427,829-841`; new-year `ClassAssignment`s created by ATLAS sync — `server/src/lib/atlasSync.ts:449-467` (fail-closed if ATLAS has not published the new load).
- Prune runs after a clean sync — `server/src/lib/syncCoordinator.ts:283-298`.
- Audit + SSE `SCHOOL_YEAR_ROLLOVER` on archive/blocked rollover — `rollover.ts:215-229,288-334` (frontend ignores the event; `src/hooks/useSyncStream.ts:162-181`).

### 13.2 Critical gaps (fix before any real rollover)

**RL-1 · Old-year DRAFT grades become unfinalizable after the flip.**
`finalize-grades`/`unfinalize-grades` are hard-scoped to the *active* year with no `schoolYear` input (`server/src/routes/registrar/main.ts:1237,1341`; `server/src/schemas/registrar.ts:19-33`), EOSY finalize refuses while drafts exist (`promotion.ts:449-451`), the old year is locked (`rollover.ts:253`), and teachers are blocked (`gradeLocks.ts:99-104`). Result: `locked_not_archived` can deadlock indefinitely.
Fix: accept an explicit `schoolYear` (registrar-confirmed) on finalize/unfinalize, or allow EOSY finalize to snapshot+lock per draft policy. Verify: integration test that flips the FK, then finalizes the old year via API.

**RL-2 · Zero-ENROLLED sections permanently block archive.**
`listUnfinalizedSections` marks any section with 0 `ENROLLED` enrollments as unfinalized (`promotion.ts:412-427`); both auto and manual archive reject (`rollover.ts:263-275`; `admin-sub/system.ts:597-604`); `finalizeSectionEosy` cannot change it (`promotion.ts:349-353`). Common cause: late transferee leaves a section empty.
Fix: treat zero-enrollment sections as finalized, or add an explicit admin "skip empty section" override. Verify: test with an empty section → rollover archives.

**RL-3 · Stale term dates can prematurely lock the NEW year.**
Term dates are global on `SystemSettings` and refresh only via branding sync, which runs every 12th cycle (`syncCoordinator.ts:38`) or on demand; the hourly scheduler locks terms whose end dates passed and can set a year lock (`server/src/index.ts:334-378`). After rollover on a non-branding cycle, old dates lock new-year T2/T3 (and possibly the year) with no auto-unlock.
Fix: force branding/term-date refresh as part of rollover before the scheduler can run; add reconciliation test. Verify: simulate rollover mid-cycle → new year remains open at T1.

**RL-4 · Registrar EOSY UI cannot fix blockers (same root as P0-4).**
`EOSYFinalization.tsx:191-209` calls admin-only `/api/admin/settings` → 403 → `localSections` empty → "Section not found in SMART database" (`:262-263,294-298`). The very flow needed to clear rollover blockers is broken from the UI.
Fix: P0-4 public term/settings endpoint; E2E asserts EOSY finalize path is reachable.

### 13.3 High-severity gaps

**RL-5 · Split-brain after failed rollover + prune data loss (worst outcome).**
On archive failure, `schoolYearId` reverts but `currentSchoolYear` does not (`schoolYearResolver.ts:183-193`), and the same sync continues writing new-year sections/enrollments and re-writes `currentSchoolYear` (`enrollproSync.ts:1085-1094`). Prune can then compare SMART's old active label with EnrollPro's new year ID (`prune.ts:523,547`) and delete old-year enrollments/grades/attendance (`prune.ts:182-213,388-421`) — gated only by an error list that the rollover error never enters (`syncCoordinator.ts:283` vs `schoolYearResolver.ts:166`).
Fix (P0-class, do not skip): make rollover failure atomic/abort the cycle; always revert both fields; block prune whenever SMART-active ≠ EnrollPro-active. Verify: test that forces archive failure and asserts (a) both fields old-year, (b) zero deletes, (c) new-year data not created that cycle.

**RL-6 · Old-year lock sticks when archive fails.** `rollover.ts:253` locks before the gap check; the failure path never unlocks. Fix: unlock on failure or lock only inside the archive transaction. Verify: failure test asserts old-year editing still works.

**RL-7 · Manual bypasses.** `PUT /api/admin/settings` can repoint `schoolYearId`/`currentSchoolYear` without rollover (`admin-sub/system.ts:214-267`); School Years "Archive" is status-only, archives no data, and the resolver ignores `status` (`classAssignments.ts:517-555`; `schoolYearResolver.ts:51-55`; `SchoolYears.tsx:188-197`). Fix: route manual year switches through `handleYearChangeRollover`; make status=ARCHIVED perform/verify the data archive. Verify: API tests.

**RL-8 · Cross-year query violations (post-rollover ghosts).** Teacher "My Classes" lists archived assignments (`grades-sub/classes.ts:48-52` misses `isActive`); teacherSync keeps syncing rosters for archived sections (`teacherSync.ts:656`); admin dashboard "latest enrollment" can select an archived year (`admin-sub/dashboard.ts:78`); transferee counts include archived years (`registrar/transferees.ts:38`). Fix per the AGENTS rule; verify with year-switch test data.

**RL-9 · Dual `/archive-year` handlers.** Live: `admin-sub/system.ts:579` (delegates to the guarded `archiveSchoolYear`, but accepts an unvalidated body); dead weaker twin: `admin-sub/classAssignments.ts:597-693` (no snapshot check, no advisory lock, sets `gradeLock:true`). Registration order `admin.ts:13` vs `:17` decides behavior. Fix: delete the dead one, add zod validation to the live one. Verify: both a schema test and a test asserting only one handler exists.

**RL-10 · Label-only / fallback year resolution.** Rollover auto-trigger requires a previously linked FK (`schoolYearResolver.ts:157`); partial EnrollPro outages can re-pin the old label (`enrollproClient.ts:506-519`); `ATLAS_SCHOOL_YEAR_ID`/`ENROLLPRO_SCHOOL_YEAR_ID` defaults (3/38) can serve stale fallbacks (`schoolEnv.ts:14-18`); `teacherSync.ts:95` can write under `"loading..."`. Fix: require resolved IDs, fail closed on mismatch. Verify: outage simulation test.

### 13.4 Pre-flight + rollover-day runbook (operational, do this regardless of code fixes)

**Before rollover day (while old year is active):**
1. Registrar: EOSY-finalize every section; check `GET /api/registrar/rollover-status` → `unfinalizedCount = 0`, `snapshotGapCount = 0`.
2. Clear all DRAFT grades **before** the flip (after the flip they are unfinalizable — RL-1).
3. Resolve zero-enrollment sections (restore an enrollment or accept the block; RL-2).
4. Confirm `SystemSettings.schoolYearId` points at the outgoing year (rollover only auto-triggers from a linked FK; RL-10).
5. Confirm ATLAS has published the new-year teaching load; otherwise new-year teachers have no classes.
6. Snapshot the DB (`pg_dump`) immediately before rollover.

**Rollover day:**
7. Force a sync (`POST /api/admin/system/sync/run`), then check Admin → Settings → Grade Locks → Rollover Status (or `GET /api/admin/rollover-status`).
8. If `locked_not_archived`: fix blockers via registrar, then click "Archive Now" (live handler, snapshot-gap-checked).
9. Immediately verify the **new** year is unlocked: `GET /api/admin/year-locks`; if T2/T3/year got locked from stale dates (RL-3), run `POST /api/admin/settings/sync-enrollpro`, then unlock.
10. Confirm `currentTerm = T1`, new-year sections/enrollments/class assignments exist.
11. Do **not** use the School Years page status buttons as the archive mechanism (RL-7).
12. Post-rollover: monitor for prune deletions if any sync failed during the window (RL-5).

### 13.5 Defense Q&A talking points (rollover)

- "Does SMART handle EnrollPro rollover automatically?" → *Yes for the happy path: it auto-creates the new school year, locks the old one, archives it once EOSY is complete; a pre-flight EOSY sweep is required, and admin verifies new-year locks after the flip.*
- "What if there are unfinished grades?" → *They must be finalized before the flip; a known limitation (tracked in RL-1) is that late finalization needs the registrar API year-scoping fix.*
- "What if EnrollPro and SMART disagree mid-rollover?" → *Known risk (RL-5); the safeguard is to freeze writes, reconcile via rollover-status, and snapshot the DB before rollover day. The atomicity fix (R0a) is the first item in Phase R and ships before any real rollover.*
- Recommended: **demo on a stable year; do not demo rollover day itself.**

### 13.6 Phase R work items (TOP PRIORITY — before any real rollover)

Execution order: **R0** = RL-5a, RL-6a, RL-9a, RL-10a (data loss + safety) → **R1** = RL-1a, RL-2a, RL-3a (stuck states) → **R2** = RL-4a, RL-7a, RL-8a (UI / cross-year correctness) → **R3** = RL-11a (tests + drill). **R0 blocks everything**: if rollover is imminent, ship R0 even if nothing else lands.

| ID | Item | Verify (test before conclude) | Effort |
|---|---|---|---|
| RL-5a | Make rollover atomic: revert both settings on failure; abort sync cycle; block prune on year mismatch | Forced-failure test asserts both fields reverted, no deletes, no new-year writes | ~4 h |
| RL-6a | Don't leave old year locked on failed archive | Failure test: old-year grades still editable | ~2 h |
| RL-1a | Registrar finalize/unfinalize accepts explicit `schoolYear` | Integration test finalizing old year after FK flip | ~4 h |
| RL-2a | Zero-enrollment sections don't block archive (or admin override) | Rollover test with empty section succeeds | ~3 h |
| RL-3a | Force term-date refresh during rollover; never auto-lock new year from stale dates | Scheduler+rollover simulation test | ~4 h |
| RL-4a | P0-4 public term endpoint + EOSY UI path | E2E EOSY finalize reachable | (covered by P0-4) |
| RL-7a | Route manual year switches/status-archive through the archive core | API tests for both paths | ~2 h |
| RL-8a | Fix cross-year query violations (`classes.ts:48`, `teacherSync.ts:656`, `dashboard.ts:78`, `transferees.ts:38`) | Year-switch fixture tests | ~4 h |
| RL-9a | Delete dead archive handler; validate live one | Handler-count + schema tests | ~1 h |
| RL-10a | Fail-closed year resolution; no `"loading..."` writes; require IDs | Outage simulation test | ~3 h |
| RL-11a | Tests for the above + scheduler lock behavior | Suite green on `smart_test_db` | ~1 day |

Total Phase R: ~3–4 focused days. **R0 alone is ~7–8 h and is the must-ship set** — it removes the irreversible data-loss paths. RL-5a and RL-6a are P0 the moment rollover becomes imminent.
