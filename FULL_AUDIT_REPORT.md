# Full System & Flow Audit Report

**Project:** SMART — Student Management and Records Tracking (DepEd JHS management system)
**Repo:** `C:\Users\Sean\Desktop\SMART_FINAL_CAPSTONE`
**Audit date:** 2026-09-15
**Mode:** Strict read-only. No source, config, or test file was edited, deleted, or refactored.
**Only file written into the repository:** this report.

### Scope, method, and compliance notes

- Static review of the whole repo with focused verification of `server/src` (routes, middleware, lib, schemas), `src` (React), Prisma schema, env handling, and tests.
- Terminal checks executed: frontend `tsc --noEmit` (72 errors), backend `tsc --noEmit` (0 errors), `eslint .` (2 errors / 1111 warnings), backend Vitest pure-logic subset (83/83 pass), and `npx playwright test --reporter=list`.
- Dynamic audit executed against the running dev stack: frontend `http://localhost:5173`, backend `http://localhost:5003` (both were listening; backend runs under PM2 + `ts-node-dev`).
- Playwright note: the repo has **no Playwright Test config or spec files**. `npx playwright test` mis-collects the backend Vitest files (`server/src/__tests__/*.test.ts`) and dies at import. It also created a transient `test-results/` directory, which was removed immediately to restore the working tree. The dynamic flow audit was therefore executed with an equivalent Node Playwright harness (script and output written to `C:\Users\Sean\AppData\Local\Temp\opencode\`, outside the repo). The MCP browser could not reach port 5003 (`net::ERR_FAILED`) while curl and Node Playwright could — this is a tooling-level anomaly, not an application defect; all dynamic results below were produced through Node Playwright.
- The full backend Vitest suite (40 files) was **not executed**: it targets the live `smart_db` database that the running server uses and includes wipe/rollover tests. Only the 9 DB-free test files were run. See §4.
- `npm run build` was not executed because `vite build` writes `dist/`; typecheck evidence is provided instead. Note that `npm run build` is only `vite build` and does **not** typecheck; `npm run typecheck` (`tsc -b`) is the failing gate.

---

## 1. Executive Summary

### Overall health score: **58 / 100** (weighted judgment)

| Area | Score | Basis |
|---|---|---|
| Backend type integrity | 9/10 | `tsc -p server/tsconfig.json --noEmit` → 0 errors |
| Frontend type integrity | 1/10 | 72 TypeScript errors, incl. broken imports and duplicate object keys |
| Backend unit tests (pure subset) | 8/10 | 83/83 pass; full suite not runnable safely on live DB |
| E2E test infrastructure | 1/10 | No Playwright config/spec; `npx playwright test` picks up vitest tests and fails |
| Audit-log coverage | 5/10 | Good on users/settings/grades; major holes on finalize/unfinalize, attendance, edit-request creation, sync, SSO, refresh |
| Input validation | 5/10 | Many mutating routes unvalidated; zod schemas silently strip fields three separate times |
| Secrets / PII handling | 4/10 | Refresh token exposed to JS, EnrollPro TLS verify disabled, plaintext upstream credentials, LRN/email in logs |
| Runtime behavior (dynamic) | 7/10 | 0 rollback pages, 0 uncaught exceptions, 0 HTTP 5xx; but 2 root causes generate 26 observed 403s and invalid DOM |
| Code health / maintainability | 4/10 | Dead app module, unbounded caches, SSE leaks, 6 files > 1000 lines, widespread duplication |

### Primary risk vectors

1. **Frontend is red on typecheck** — 72 TS errors including a missing module import (`RotationBanner.tsx:3`) and duplicate object keys (`Schedule.tsx:124-125`). Some are from the uncommitted SSO work in the working tree (see `git status`), but many are pre-existing.
2. **Authorization endpoint misuse** — teacher and registrar pages call the admin-only `GET /api/admin/settings`, producing 403 floods (26 observed across the session) and degrading term-label/current-term data on teacher class records and registrar EOSY.
3. **Audit-trail holes on the highest-integrity operations** — grade finalize/unfinalize, attendance clear/bulk, edit-request creation, refresh-token rotation, SSO session bootstrap, and sync-triggered student/enrollment writes have no audit rows. Failed 401/403/CSRF/validation attempts are almost never recorded as `outcome: "failure"`.
4. **Secret/PII exposure** — refresh+access tokens returned in JSON bodies and stored in JS-readable storage; access token accepted in URLs; EnrollPro TLS verification disabled on every outbound call (including credential validation); EnrollPro credentials stored plaintext; `DEFAULT_SYNC_PASSWORD || 'password123'` fallback; LRNs and teacher emails written to info/debug logs.
5. **Fail-open security controls** — `serviceAuth` passes every request when `ENROLLPRO_API_KEY` is unset (it is unset locally), and CSRF exemptions cover `/admin/settings` and `/sync-grades`.
6. **No real E2E safety net** — zero Playwright specs; the only end-to-end artifact (`tests/smoke-test.mjs`) has no assertions, writes screenshots into the repo, and contains hardcoded demo credentials.

### Quick stats

| Metric | Result |
|---|---|
| Playwright Test specs found / runnable | **0 / 0** — `npx playwright test` fails collecting backend Vitest files (`server/src/__tests__/aims-sync.test.ts:8` etc.) |
| Dynamic route passes | **24 / 27 page loads PASS** (88.9%); 3 are phantom routes that bounce to `/login` |
| Login flow pass rate | **3 / 3** (admin, teacher, registrar) |
| Blank pages / error boundaries / uncaught page errors | **0 / 0 / 0** |
| HTTP 5xx observed | **0** |
| HTTP 4xx observed | **26 × 403** (2 root causes), 0 × 401/404 on tested pages |
| Backend pure-logic tests | **83 / 83 pass** (9 files); 31 further test files not run (live-DB risk) |
| Frontend `tsc --noEmit` | **72 errors** |
| Backend `tsc --noEmit` | **0 errors** |
| ESLint | **2 errors**, **1111 warnings** (971 `no-explicit-any`, 87 unused-vars) |
| Files exceeding AGENTS.md 1000-line limit | **6** (worst: `src/lib/api.ts` 2012 lines) |
| Critical security findings | 5 critical, 6 high (see §3.3) |

---

## 2. Playwright E2E Flow Audit

### 2.1 Test infrastructure status

| Item | Finding |
|---|---|
| Playwright config (`playwright.config.*`) | **None anywhere in the repo.** |
| `@playwright/test` dependency | **Not installed.** Root devDependencies only include the `playwright` library (`package.json:55`). |
| Spec files (`*.spec.ts`) | **None.** |
| `npx playwright test --reporter=list` | Fails: it globs `server/src/__tests__/**/*.test.ts` (Vitest files) as Playwright tests and crashes with `Vitest cannot be imported in a CommonJS module using require()` at `server/src/__tests__/aims-sync.test.ts:8` (same for `alumniClassifier-lib.test.ts:5`, `atlas-effective-load.test.ts:12`, …). Also created `test-results/.last-run.json` (removed after the audit). |
| Only E2E artifact | `tests/smoke-test.mjs` (395 lines) — raw Playwright script, no test runner, **no assertions**, writes 30+ screenshots into `tests/screenshots/`, hardcoded demo credentials at `tests/smoke-test.mjs:7-9`. Not executable under the read-only constraint (overwrites repo screenshots). |
| npm scripts | No `test`/`e2e` script in root `package.json`; backend has Vitest only (`server/package.json:21-22`). |

### 2.2 Flow Status Matrix

Status legend: **PASS** = page rendered meaningful content, no login bounce, no error boundary; **FAIL** = blank/error/broken; **REDIRECT** = route not registered, wildcard sends to `/login`; **UNCOVERED** = no automated spec exists and no dynamic journey was executed for the flow.

| Flow | Status | Spec File | Evidence / Notes |
|---|---|---|---|
| Admin login (`/login/admin`) | PASS | — (none) | Dynamic login PASS; session established; `AdminLoginPage.tsx` |
| Teacher login (`/login`) | PASS | — (none) | Dynamic login PASS; `LoginPage.tsx` |
| Registrar login (`/login/registrar`) | PASS | — (none) | Dynamic login PASS; `RegistrarLoginPage.tsx` |
| Admin dashboard `/admin` | PASS | — (none) | 2.6 s load; `src/pages/admin/Dashboard.tsx` |
| Admin user management `/admin/users` | PASS | — (none) | 10 table rows; row action menu opens |
| Admin class assignments `/admin/assignments` | PASS | — (none) | rendered |
| Admin edit requests `/admin/edit-requests` | PASS | — (none) | rendered |
| Admin school years `/admin/school-years` | PASS | — (none) | rendered |
| Admin grading config `/admin/grading` | PASS | — (none) | grading content detected |
| Admin transmutation `/admin/transmutation` | PASS | — (none) | rendered |
| Admin system settings `/admin/settings` | PASS | — (none) | rendered |
| Admin system health `/admin/health` | PASS | — (none) | rendered |
| Admin audit logs `/admin/logs` | PASS | — (none) | 10 rows rendered, filters present |
| Admin template manager `/admin/templates` | REDIRECT | — (none) | Route not registered in `App.tsx`; wildcard `*` → `/login` (`src/App.tsx:125-126`). No source file `TemplateManager.tsx` exists. |
| Teacher dashboard `/teacher` | PASS | — (none) | rendered |
| Teacher class list `/teacher/classes` | PASS (with console/network errors) | — (none) | 7 × `GET /api/admin/settings` 403 (see F1) |
| Teacher class record detail `/teacher/records/:id` | PASS (with errors) | — (none) | drill-down works; 11 × `GET /api/admin/settings` 403 (F1); `rotationSiblings` type error at `ClassRecordView.tsx:93` |
| Teacher attendance `/teacher/attendance` | PASS | — (none) | class selector opens, 12 options |
| Teacher attendance reports `/teacher/attendance-reports` | PASS | — (none) | rendered |
| Teacher schedule `/teacher/schedule` | PASS | — (none) | rendered |
| Teacher advisory `/teacher/advisory` | PASS (empty data) | — (none) | rendered; 0 student rows (data-dependent) |
| Registrar dashboard `/registrar` | PASS | — (none) | rendered |
| Registrar student records `/registrar/students` | PASS | — (none) | rendered; row click did **not** open a dialog (dialog=0) — interaction trigger unclear |
| Registrar section roster `/registrar/roster` | PASS (with console errors) | — (none) | 2 React DOM-nesting errors (F3) |
| Registrar school forms `/registrar/forms` | PASS | — (none) | SF list detected |
| Registrar EOSY `/registrar/eosy` | PASS (with errors) | — (none) | 4 × `GET /api/admin/settings` 403 (F2) |
| Registrar alumni `/registrar/alumni` | PASS | — (none) | rendered |
| Registrar remedial `/registrar/remedial` | PASS | — (none) | rendered |
| Registrar transferees `/registrar/transferees` | PASS | — (none) | rendered |
| Registrar teaching load `/registrar/teaching-load` | REDIRECT | — (none) | Route not registered; no `TeachingLoad.tsx` exists |
| Registrar print center `/registrar/print` | REDIRECT | — (none) | Route not registered; `PrintCenter.tsx` exists but is dead code |
| Form viewer | UNCOVERED | — (none) | `FormViewer.tsx` exists, not routed, not linked, untested |
| Grade submission / editing | UNCOVERED | — (none) | Core business flow has zero E2E |
| Attendance save / clear / bulk | UNCOVERED | — (none) | Zero E2E; unaudited backend paths (§3.1) |
| Grade edit request create → approve/reject | UNCOVERED | — (none) | Zero E2E |
| EOSY finalize / unfinalize | UNCOVERED | — (none) | Zero E2E; unaudited backend paths (§3.1) |
| User CRUD (create/suspend/reactivate/delete) | UNCOVERED | — (none) | Zero E2E |
| Settings mutations (grade lock, term lock, branding, credentials) | UNCOVERED | — (none) | Zero E2E |
| School-year rollover / archive | UNCOVERED | — (none) | Zero E2E; lib-only tests exist |
| SF form generation / printing | UNCOVERED | — (none) | Zero E2E |
| AIMS import / ECR import / Excel export | UNCOVERED | — (none) | Zero E2E |
| EnrollPro/ATLAS sync triggers | UNCOVERED | — (none) | Zero E2E; no audit on trigger |
| Companion SSO (session, authorize, exchange) | UNCOVERED | — (none) | New uncommitted feature; unit tests exist (`server/src/__tests__/companion-sso*.test.ts`) but no E2E |
| Token refresh / logout-all | UNCOVERED | — (none) | Zero E2E |

### 2.3 Detailed breakdown of dynamic failures

**F1 — Teacher pages call an admin-only endpoint; 403 flood, data degrades**
- **Failing step:** any teacher visit to `/teacher/classes` or a class-record detail. Browser console: `Failed to load resource: the server responded with a status of 403 (Forbidden)`; network: repeated `GET /api/admin/settings` → 403. Route sweep: 7 on `/teacher/classes`; drill-down journey: 11 on a single class-record open.
- **Source:** `src/pages/teacher/ClassRecordsList.tsx:295` (`adminApi.getSettings().catch(...)`) and `src/pages/teacher/ClassRecordView.tsx:136-143` (`useQuery` → `adminApi.getSettings()`).
- **Server gate:** `GET /api/admin/settings` requires ADMIN (`server/src/routes/admin-sub/helpers.ts:8-14`, applied in `server/src/routes/admin-sub/system.ts`), so teachers always receive 403.
- **Verified root cause:** the frontend reuses the admin settings API to obtain `termLabels`/`currentTerm`. `ClassRecordsList` swallows the error and falls back to hardcoded labels; `ClassRecordView` leaves term labels at defaults. Request repetition comes from React Query retries plus multiple components/StrictMode mounts.
- **Impact:** noisy console/network on every teacher page; incorrect term-label/current-term display whenever teacher-visible labels differ from defaults; misleading admin 403 dashboards.
- **Recommended direction (not applied):** expose a role-appropriate read endpoint (e.g., extend `GET /api/admin/settings/public` or add `GET /api/settings/term-info`) and use it from teacher pages.

**F2 — Registrar EOSY calls the admin-only settings endpoint**
- **Failing step:** `/registrar/eosy` load → 4 × `GET /api/admin/settings` → 403 (`EOSYFinalization.tsx:194` `loadLocalSections`, `:214` `fetchCurrentTerm`; doubled by StrictMode).
- **Verified root cause:** same endpoint misuse as F1. Both catches are silent `console.error` (`EOSYFinalization.tsx:206-208, 219-221`), so `currentSY` stays null (local sections reset to `[]`) and `currentTerm` silently defaults to `"T3"` (`:218`).
- **Impact:** EOSY page can silently present the wrong term and hide local sections if term labels/finalization depend on it. EOSY is a high-integrity workflow.

**F3 — Invalid DOM nesting on `/registrar/roster` (React hydration warning)**
- **Failing step:** roster page load or "View Roster". Console: `In HTML, <tr> cannot be a child of <div>` and `<div> cannot contain a nested <tr>`.
- **Source:** `src/pages/registrar/SectionRosterViewer.tsx:385-397` wraps `LoadingSkeleton` / `EmptyState` in plain `<div className="py-8">`.
- **Verified root cause:** `LoadingSkeleton` (`src/components/data-table/TableStates.tsx:28-48`) and `EmptyState` (`:59-94`) render bare `<tr>` (`<TableRow>`) intended for use inside `<tbody>`. Outside a table they produce invalid HTML that browsers hoist out of the wrapper.
- **Impact:** React DOM-validity/hydration warnings; skeleton/empty markup position can break visually; the same misuse pattern is a latent bug for any future use of these components outside a `TableBody`.

**F4 — SSE stream churn and JWT in the query string**
- **Failing step:** every visited page issued 2–3 `GET /api/integration/sync/stream?token=<JWT>` requests, reported as `net::ERR_ABORTED` at navigation.
- **Source:** `src/hooks/useSyncStream.ts` (one EventSource per hook instance, mounted in `TeacherLayout.tsx:66` plus page-level hooks such as `ClassRecordsList.tsx:252`, `StudentRecords.tsx:82`, `Schedule.tsx:163`, `Dashboard.tsx:136`, `MyAdvisory.tsx:42`), and `src/contexts/ThemeContext.tsx:285`, `src/pages/admin/SystemSettings.tsx:75`, `src/pages/admin/AuditLogs.tsx:130`.
- **Verified root cause:** multiple concurrent EventSource instances per page plus close/reopen on navigation; the raw access token is passed as `?token=` and is accepted by `server/src/middleware/auth.ts:24-26`. ERR_ABORTED on unmount is expected; the churn and URL exposure are not.
- **Impact:** token appears in browser history, proxy/access logs, and `Referer`; wasted SSE connections; server-side stale-client retention risk (see §4 SSE leak).

**F5 — Phantom routes redirect to `/login`**
- **Failing step:** `/admin/templates`, `/registrar/teaching-load`, `/registrar/print` → redirected to `http://localhost:5173/login`.
- **Verified root cause:** none of these routes exist in `src/App.tsx:83-123`; the wildcard `*` routes to `/login` (`src/App.tsx:125-126`). `PrintCenter.tsx` and `FormViewer.tsx` exist on disk but are never imported/routed; `TestManager`/`TeachingLoad` files do not exist at all, though `AGENTS.md` documents them.
- **Impact:** dead pages, stale documentation, and a confusing fallback: an authenticated user landing on any unknown URL is bounced to a login screen instead of their portal (or a 404 view).

### 2.4 Missing E2E coverage (highest priority)

Every write path and every high-integrity workflow is uncovered. In priority order:

1. Grade entry → save → batch save → clear scores (`server/src/routes/grades-sub/classes.ts`).
2. Grade edit request lifecycle: create (`editRequests.ts:18`) → approve/reject/revoke (`:176/:221/:264`).
3. Attendance take/save/clear/bulk (`server/src/routes/attendance.ts:119,162`).
4. EOSY finalize/unfinalize and auto-promotion (`server/src/routes/registrar/main.ts:1226,1330`; `lib/promotion.ts`).
5. School-year rollover/archive (`lib/rollover.ts`; `POST /api/admin/archive-year`).
6. User lifecycle incl. suspend/reactivate/delete (`server/src/routes/admin-sub/users.ts`).
7. Settings mutations: grade lock, transition lock, year/term locks, credentials, term labels (`server/src/routes/admin-sub/system.ts`).
8. Auth session lifecycle: refresh rotation, reuse detection, logout-all (`server/src/routes/auth.ts:330,505`).
9. Substitute/transition-lock behavior for grades.
10. Companion SSO end-to-end (session bootstrap, authorize, exchange, replayed code).
11. Template upload/bundle/delete (`server/src/routes/templates.ts`; currently bundle mode is broken by validation — see §3.2).
12. SF form generation/print (plus the missing `PrintCenter`/`FormViewer` routes).
13. AIMS/ECR imports and Excel export.
14. Sync triggers and their guardrails (cancellation, offline fallback).

Recommended minimal safety net: role-scoped Playwright projects with storageState per portal, a `webServer` block targeting 5173/5003, and smoke specs for login + grade save + attendance save + edit-request approve + EOSY finalize; run against an isolated test DB.

---

## 3. Data Quality & Audit Logging Audit

### 3.1 Critical missing audit logs

The central helper `server/src/lib/audit.ts:9-106` is solid (request context enrichment at `:23-46`, FK-safe fallback at `:55-61`, best-effort behavior at `:66-71`). Coverage, however, is uneven.

Audited well (for contrast): user CRUD (`admin-sub/users.ts:188,285,336,390,429`), most settings mutations (`admin-sub/system.ts:282-904`), grade save/batch/delete/clear (`grades-sub/classes.ts:582,839,959,1115,1198,1282`), edit-request approve/reject/revoke (`grades-sub/editRequests.ts:176,221,264`), login success/failure (`auth.ts:215,236,246,255`), logout (`auth.ts:486`), EOSY finalize route (`eosy.ts:134`), external records (`externalRecords.ts:190,265,320,367`).

Missing or partial, ranked by integrity impact:

| # | Action | File/line | Missing context |
|---|---|---|---|
| 1 | Grade **unfinalize** (reopens finalized grades) | `server/src/routes/registrar/main.ts:1330` (`grade.updateMany` at `:1357`) | No audit row at all; only registrar unfinalize should open term locks |
| 2 | Grade **finalize** incl. auto-EOSY | `server/src/routes/registrar/main.ts:1226` (`grade.updateMany` `:1268`, auto-EOSY `:1293`) | `lib/promotion.ts` audits only `unfinalizeSectionEosy` (`:596`); finalize is silent |
| 3 | Grade **edit-request creation** | `server/src/routes/grades-sub/editRequests.ts:18` | Request why/how is absent while approve/reject/revoke are audited |
| 4 | **Attendance clear** (`deleteMany`) | `server/src/routes/attendance.ts:119` (`deleteMany` `:142`) | Whole file has zero `createAuditLog`; deletion unaudited |
| 5 | **Attendance bulk upsert** | `server/src/routes/attendance.ts:162` (`:191-216`) | No audit; section/date/record count unknown |
| 6 | **Enrollment status change** (dropped/transferred) | `server/src/routes/registrar/main.ts:1191` (`enrollment.update` `:1213`) | Learner-status change unaudited |
| 7 | **Sync-inactive-students** (creates/updates students + enrollments) | `server/src/routes/registrar/main.ts:720` (`student.create` `:813/:869`, `enrollment.*` `:834-932`) | Mass data mutation unaudited |
| 8 | Class-assignment **create/archive** | `server/src/routes/admin-sub/classAssignments.ts:308,351` | Restore is audited (`:442`); create/archive are not |
| 9 | Transmutation **row add/edit/delete** | `server/src/routes/admin-sub/grading.ts:237,264,302` | Whole-table replace/reset are audited; row-level edits are not |
| 10 | Subject-weight **override set/clear/bulk** | `server/src/routes/admin-sub/grading.ts:427,457,481` | Grading configuration changes unaudited |
| 11 | **Refresh-token rotation + reuse detection family revoke** | `server/src/routes/auth.ts:330` (`updateMany` `:356-359`) | Only `logger.warn` at `:360`; token-family compromise invisible in audit |
| 12 | **Logout-all** (bulk revocation) | `server/src/routes/auth.ts:505` | No audit (contrast `/logout` `:486`) |
| 13 | **SSO session bootstrap / authorize / exchange** | `server/src/routes/sso.ts:140,197,225` (refresh token create `:168`) | No audit; services `enrollproSsoService.ts`/`enrollproReverseSsoService.ts` never call `createAuditLog` |
| 14 | AIMS sync staging writes | `server/src/routes/grades-sub/aims.ts:419` → `lib/aimsScoreSync.ts:211,265` | Upserts/deletes unaudited |
| 15 | Sync-triggered mutations (students, sections, assignments) | `routes/sync.ts:27,66`, `admin-sub/system.ts:76`, `admin-sub/classAssignments.ts:29,50`, `routes/advisory.ts:764`, `routes/integration.ts:518` | Only safety events are audited (`enrollproSync.ts:322,920,970`, `atlasSync.ts:322-711`); the resulting data changes are not |
| 16 | DB wipe (CLI) | `server/scripts/wipe.ts:169`; `lib/wipe.ts:34` deletes `AuditLog` | No trace by design; document operational guard instead |
| 17 | Scheduler auto-expiry of approved edit requests | `server/src/index.ts:384-393` | No audit (manual revoke is audited) |
| 18 | Read-side side effects: settings row create, `currentTerm` persistence | `admin-sub/system.ts:146-150`, `grades-sub/helpers.ts:82-86` | Silent state writes |

**Failure auditing:** only 5 writable `outcome: "failure"` sites exist in the entire backend (`auth.ts:88,215,236,255`, `sso.ts:115`). Not audited anywhere:
- 401/403 in `server/src/middleware/auth.ts:29,35,46,61`
- CSRF rejection `server/src/middleware/csrf.ts:86-88`
- rate-limit rejections (`server/src/middleware/rateLimiter.ts`)
- validation failures (`server/src/middleware/validate.ts:34-42`)
- refresh-token reuse detection (`auth.ts:354-362`)
- all route-level 500s (e.g., `classes.ts:595`, `users.ts:210`, `system.ts:295`) — `logger.error` only.

### 3.2 Data ingress & validation weaknesses

`validate` middleware behavior (`server/src/middleware/validate.ts:20-44`): on failure returns HTTP 400 `{ message: "Validation failed", errors: [{ path, message }] }` — no stack/schema/values leaked (good). On success it **replaces** `req.body/params` and rebinds `req.query`; zod's default unknown-key stripping then causes real field loss:

1. **Attendance `remarks` silently dropped** — schema allows only `studentId`/`status` (`server/src/schemas/attendance.ts:9-12`) but the handler reads `record.remarks` (`routes/attendance.ts:202,210`); the frontend sends remarks (`src/pages/teacher/Attendance.tsx:335`). Remarks are never persisted.
2. **Template bundle uploads broken and mappings dropped** — schema requires `formType ∈ SF1–SF15` and `uploadMode ∈ replace|add` (`schemas/templates.ts:12-20`) while the handler supports `SF1_10_BUNDLE`/`uploadMode:"bundle"` and reads `formTypes`/`sheetMappings` (`routes/templates.ts:489,523-529`). Bundle uploads 400; even accepted uploads lose `formTypes`/`sheetMappings`.
3. **Grade extras dropped** — no `qualitativeDescriptor`/`remarks` in `schemas/grades.ts:20-33` though the client sends them (`src/lib/api.ts:454`).

Mutating routes with **no schema validation** (33 total; highest-risk sample):

| File:line | Route | Risk |
|---|---|---|
| `server/src/routes/admin-sub/system.ts:821` | `PUT /api/admin/settings/enrollpro-credentials` | Raw strings written to plaintext credential columns; no URL/format validation |
| `server/src/routes/admin-sub/system.ts:483` | `POST /api/admin/dev/seed-scores` | Unvalidated body spawns a `ts-node` child process; no NODE_ENV/demo gate |
| `server/src/routes/admin-sub/grading.ts:427,481` | subject-weight set/bulk | `Number()` with no bounds → `NaN`/negative/>100 reach `Int` columns |
| `server/src/routes/admin-sub/classAssignments.ts:472,517` | school-year create/patch | Arbitrary `status`, `new Date(unvalidated)` |
| `server/src/routes/registrar/main.ts:466,681,720` | sync triggers + inactive reconcile | No body validation; heavy DB writes |
| `server/src/routes/registrar/main.ts:1226,1330` | finalize/unfinalize grades | No body validation on a term/annual-lock operation |
| `server/src/routes/attendance.ts:119,162` | clear/bulk | Section/date/student arrays only inline-checked |
| `server/src/routes/grades-sub/ecr.ts:36` | ECR import | Term check only; file parsed without MIME check (extension-only, `:24-32`) |
| `server/src/routes/sync.ts:27,66` · `admin-sub/classAssignments.ts:29,50` | sync run | No validation; trigger unaudited |
| `server/src/routes/auth.ts:330` | refresh | `refreshSchema` exists (`schemas/auth.ts:14`) but is never imported |
| `server/src/routes/sso.ts:197,225` | SSO authorize/exchange | `String()` coercion without length caps; service allowlist is the only guard |

Weak coercions and guards (ranked):
- `server/src/middleware/csrf.ts:68-71` — blanket CSRF exemption for any path containing `/admin/settings`, including credential and logo writes.
- `server/src/middleware/serviceAuth.ts:14-17` — **fails open** when `ENROLLPRO_API_KEY` is unset (it is not set in `server/.env`), and CSRF also exempts `/sync-grades` (`csrf.ts:62-65`), so those integration endpoints are effectively unauthenticated locally.
- `server/src/routes/admin-sub/audit.ts:64-65`, `registrar/main.ts:963-964`, `admin-sub/system.ts:66-68` — `parseInt`/`Number` on query params without `Number.isFinite`; `offset` uncapped; `?limit=abc` → 500.
- `server/src/routes/attendance.ts:361-366` — `year` not range-checked → `Invalid Date` → Prisma error.
- `req.user!` non-null assertions used 39× (e.g., `admin-sub/system.ts:615`) — safe only while auth middleware ordering holds.
- `server/src/middleware/auth.ts:24-26` — access token accepted from `req.query.token` (SSE convenience) → URL/log/referrer leakage.

Uploads / paths (verified): `express.static(server/uploads)` is mounted unauthenticated (`server/src/index.ts:75`); logo upload allows SVG served same-origin (stored-XSS if admin account is abused) and its MIME/extension regexes are unanchored (`admin-sub/helpers.ts:57-83`); old-logo cleanup unlinks a DB-derived path without containment (`admin-sub/system.ts:313,319-327`). No request-derived `path.join` was found.

Prisma schema gaps of note: `User.email` not unique (`prisma/schema.prisma:24`) while login resolves with `findFirst` (`auth.ts:68-70`) → duplicate emails can authenticate the wrong account; `GradeEditRequest.term/schoolYear` are free-form strings with no FKs (`:763-766`); `AimsScore` unique key omits `attemptNumber` (`:725`); `SystemSettings.enrollproPassword` plaintext (`:555`); `SystemSettings.currentSchoolYear` default drifts from the live term resolver (`:522-525`).

### 3.3 Sensitive data leaks

Critical:
1. **Refresh + access tokens returned in JSON bodies and stored in JS-readable storage.** `server/src/routes/auth.ts:310-313,416`; `server/src/routes/sso.ts:175-186`; stored at `src/pages/LoginPage.tsx:56-58`, `AdminLoginPage.tsx:54-56`, `RegistrarLoginPage.tsx:53-55`, `SsoSessionPage.tsx:50-52`, `src/lib/api.ts:136-138`; registrar EOSY also reads `localStorage` first (`EOSYFinalization.tsx:163,179`). This defeats the httpOnly cookie protection (`lib/tokens.ts:67-98`).
2. **EnrollPro TLS verification disabled on every outbound call** — `server/src/lib/enrollproClient.ts:120` (`rejectUnauthorized: false`), including credential validation (`:904-912`). MITM can capture teacher passwords and upstream tokens.
3. **EnrollPro integration credentials stored plaintext** in `SystemSettings.enrollproPassword` / `enrollproIntegrationKey` (`prisma/schema.prisma:555`; read at `enrollproClient.ts:52-53`), with no encryption at rest.
4. **Fail-open integration auth** — `serviceAuth.ts:14-17`; `ENROLLPRO_API_KEY` absent from `server/.env`.
5. **Default sync password fallback** — `DEFAULT_SYNC_PASSWORD || 'password123'` auto-creates teacher accounts with a known password (`server/src/lib/enrollproSync.ts:216`); the var is unset in `server/.env`.

High:
6. **Access token in URLs** — `middleware/auth.ts:24-26`; emitted by `useSyncStream.ts:107`, `SystemSettings.tsx:75`, `ThemeContext.tsx:285`, `AuditLogs.tsx:130`.
7. **PII in logs** — LRNs at `server/src/routes/integration.ts:254,298` and `registrar/main.ts:935`; login email/employee ID at `auth.ts:115,78,194`; teacher email at `teacherSync.ts:404,410`; `advisory.ts:818` returns `result.errors` strings that embed LRNs to the client. Full error objects (with prod stacks) logged at `auth.ts:324,418,446,499,528`, `sso.ts:188,214,242`, `syncCoordinator.ts:493,527,549,707`.
8. **Live error handler is dead code** — `server/src/app.ts:71-75` contains a safe generic-500 handler but `app.ts` is never imported; the live entry `server/src/index.ts` registers no error middleware. Behavior then depends on `NODE_ENV`: `server/.env` does not set it, so non-PM2 starts are treated as development by Express and unhandled errors return HTML with stack traces. `ecosystem.config.cjs:14` sets production only for the PM2 path.
9. **Unauthenticated static `/uploads`** — `index.ts:75` (templates/logos downloadable if filename known); no security headers anywhere (no Helmet/CSP/HSTS/X-Frame-Options).
10. **Hardcoded demo credentials** in `tests/smoke-test.mjs:7-9` (admin/teacher/registrar), readable on disk (file is gitignored, not committed).
11. **Frontend `console.error(err)` of Axios errors** can print student PII payloads (e.g., `StudentRecords.tsx:166,228`, `AttendanceReports.tsx:181`, `SchoolForms.tsx:221-278`).

Env/secrets hygiene (good): `.env` is ignored (`server/.gitignore:5`, root `.gitignore:32`); only `server/.env.example` is tracked and contains placeholders; `JWT_SECRET` (128 chars) and `CSRF_SECRET` (128 chars, distinct) are strong; `"fallback-secret"` is explicitly rejected (`config/env.ts:28-32`); refresh tokens and SSO codes are SHA-256-hashed at rest (`lib/tokens.ts:40-42`, `lib/companionSso.ts:109-115`); SSO secrets use timing-safe compare (`companionSso.ts:122-128`).
Cookie/CORS: allowlist-only CORS with credentials (`index.ts:50-62`), cookies `httpOnly` + `sameSite=lax` + `secure` only under `NODE_ENV=production` (unset by default) — `lib/tokens.ts:67-98`; `CORS_ORIGIN` unset, localhost fallback is used.

---

## 4. Code Quality & Static Analysis

### 4.1 Static check results

| Check | Command | Result |
|---|---|---|
| Frontend typecheck | `npx tsc -p tsconfig.app.json --noEmit` | **72 errors** |
| Backend typecheck | `npx tsc -p tsconfig.json --noEmit` (server/) | **0 errors** |
| Lint | `npx eslint .` | **2 errors, 1111 warnings** |
| Backend pure tests | `npx vitest run src/__tests__/<9 pure files>` | **83/83 pass** |
| Full backend tests | `npm test` (40 files) | **Not run** — targets live `smart_db`; includes `wipe.test.ts`, `rollover.test.ts`, `prune.test.ts`; unsafe under read-only |
| Playwright | `npx playwright test --reporter=list` | **FAIL (collection)** — imports Vitest files; no specs/config |
| Build | `npm run build` | Not run (writes `dist/`); note it is `vite build` only — it does **not** typecheck |

**Frontend TS error groups (72 total):**
- Uncommitted SSO work / `LoginResponse` drift: `refreshToken` missing on type at `AdminLoginPage.tsx:54-55`, `LoginPage.tsx:56-57`, `RegistrarLoginPage.tsx:53-54`.
- `AdminLayout.tsx` nav-item typing: 17 errors at `:32,138-139,241-247,271,317,335,397,418` (`children`, `disabled`, `isDropdown`, `inDevelopment` not on the item type).
- Base UI `Select` `onValueChange` null-signature mismatches: `ClassAssignments.tsx:351`, `SubjectWeightsPanel.tsx:183`, `TransmutationTable.tsx:321`, `FormViewer.tsx:102,133`, `Dashboard.tsx:1001,1019`.
- Stale API response types: `ClassRecordView.tsx:93,294,299,323` (`rotationSiblings`, stat `total`, term labels, `derived`), `ClassRecordsList.tsx:300,387-388`, `AimsPanel.tsx:147` (`qaSkippedOccupied`), `teacher/Dashboard.tsx:236`, `StudentRecords.tsx:163,499`, `SF9Form.tsx:23-54` (`schoolSettings`, `age`), `SF10Editor.tsx:177`, `SF10Form.tsx:162`.
- Real code bugs: `src/pages/teacher/Schedule.tsx:124-125` — **duplicate object properties** (`TS1117`); `src/pages/teacher/components/RotationBanner.tsx:3` — **missing module** `'../../lib/api'` (`TS2307`); `Schedule.tsx:241` — `schedule` possibly null; `RemedialHistoryTable.tsx:144,148` — `.reduce` called with a function where a number is expected.
- Misc: `ThemeContext.tsx:262,285` (`currentSchoolYear` and null cookie value), `RegistrarStudent` vs `StudentWithEnrollment` type divergence, `AttendanceReports.tsx:536,538` (`string | 0`), `CompleteRemedialDialog.tsx:118` (missing required `children`).

**ESLint summary:** 2 errors — `server/src/lib/aimsImport.ts:141` (`prefer-const`), `server/src/lib/sf10Scan/parser.ts:53` (`no-useless-escape`). Warnings by rule: `no-explicit-any` 971, `no-unused-vars` 87, `react-hooks/exhaustive-deps` 26, `set-state-in-effect` 14, `react-refresh/only-export-components` 13.

**Backend tests not executed (31 files)** include the high-value integration suites (`auth`, `csrf`, `grade-lock`, `rollover`, `prune`, `sf10-snapshot`, `external-records-api`, `companion-sso`). Running them requires an isolated test database; the current `vitest.config.ts` has no DB guard (`server/vitest.config.ts:6-17`) and would exercise the same `smart_db` the dev server is using.

### 4.2 High-severity technical debt

**Dead code / duplication**
- `server/src/app.ts` (77 lines) is never imported; its safe error handler (`:71-75`) never runs. `server/src/index.ts:44-105` duplicates app construction.
- Never-imported files: `server/src/lib/teacherDashboardComposer.ts` (290 lines), `src/lib/constants.ts` (147 lines), `src/components/RolloverBanner.tsx`, `src/pages/registrar/PrintCenter.tsx`, `src/pages/registrar/FormViewer.tsx`, `src/pages/registrar/components/SF1Form.tsx`, `src/components/ui/breadcrumb.tsx`, `src/components/ui/pagination.tsx`.
- Unused exports: `refreshSchema` (`schemas/auth.ts:14`), `syncLimiter` (`middleware/rateLimiter.ts:26`), `invalidateEffectiveTeachingLoad` (`lib/syncCache.ts:202`), ~11 EnrollPro client getters, `getGradeColor` in dead `constants.ts`, unused teacher hooks.
- Duplicated logic: `mapGradeLevel` copied 4× (`enrollproSync.ts:45`, `atlasUtils.ts:7`, `prune.ts:666`, `registrar/main.ts:696`); subject-code canonicalizers 5×; exam math duplicated across API boundary (`server/src/lib/examMath.ts:33-52` vs `src/lib/gradeMath.ts:109-126`); 41-row transmutation table triplicated (`server/src/index.ts:152-194`, `prisma/seed.ts:80-120`, `src/lib/gradeMath.ts:11-23`); `formatDate` reimplemented 5× in frontend.

**Resource leaks / unbounded growth**
- `server/src/lib/sseManager.ts:36-85` — clients are removed only when `write()` throws synchronously; dead sockets (write returns false / async error) can accumulate in the module-level client maps forever.
- `server/src/index.ts:402,448` — hourly term scheduler and daily cleanup `setInterval`s are never cleared; shutdown (`index.ts:243-269`) doesn't await `server.close()` and `process.exit(0)` runs immediately (the 10 s guard timer is unreachable).
- `server/src/lib/syncCoordinator.ts:525-529` — boot-sync `setTimeout` not tracked/cleared.
- `server/src/lib/syncCache.ts:38-78,157` — TTL swept only on `get()`; stale keys never evicted, no size cap; `atlasTLVersionByScope` only grows.
- `enrollproClient.ts:128-140` / `sync/httpClient.ts:85-107` — upstream response bodies concatenated without size cap.
- Frontend: `AuditLogs.tsx:187` re-creates the SSE connection on every filter keystroke; multiple `useSyncStream` instances per page; unrevoked object URL `src/pages/teacher/Attendance.tsx:366`; untracked `setTimeout`s (`ClassRecordTour.tsx:351-352`, `SystemSettings.tsx:139`, `Schedule.tsx:186`, `Attendance.tsx:317,342`); `afterprint` listeners + 60 s fallbacks never removed (`Sf10RecordsPage.tsx:394-395`, `SchoolForms.tsx:207-208`).

**Unhandled rejections / silent failures**
- Floating async in `app.listen` callback (`index.ts:206-230`), async signal handlers (`index.ts:272-273`), dynamic import without `.catch` (`grades-sub/aims.ts:289-291`), audit writes with `.catch(() => {})` (`atlasSync.ts:330,343,525,551,654`, `enrollproSync.ts:330,928,978`).
- Empty/comment-only catches that hide failures: `lib/remedial.ts:457`, `lib/aimsScoreSync.ts:186`, `lib/enrollproSync.ts:780`, `routes/grades-sub/helpers.ts:86`, `routes/auth.ts:103,136`, `routes/attendance.ts:25`, `lib/teacherSync.ts:446`, `routes/registrar/main.ts:519,1891`, `lib/prune.ts:524,549`.

**Layer inconsistencies**
- `server/src/lib/aimsImport.ts:13` and `lib/ecrImport.ts:17-21` import the grading engine from `routes/grades-sub/helpers`; `lib/sf10.ts:19` imports from `routes/registrar/helpers` — inverted dependencies.
- Core grading engine (`resolveEffectiveWeightsForClassAssignment`, `calculateGrades`, `transmute`, `createGradeSnapshot`) lives in `server/src/routes/grades-sub/helpers.ts:220-386`; attendance write-guard lives in `routes/attendance.ts:14`.
- Static circular import between `lib/schoolSettingsSnapshot.ts:15` and `lib/schoolYearResolver.ts:23` (worked around elsewhere with lazy imports).
- HTTP handler spawns a child process (`admin-sub/system.ts:541-551`).

**React/UI**
- `MyAdvisory.tsx:264,338,415` injects `<style>` via `dangerouslySetInnerHTML` interpolating theme colors with no sanitization.
- `window.location` hard navigations bypass the router: `src/lib/api.ts:144`, `useSyncStream.ts:133`, `AlumniStudents.tsx:163`, `IntegratedSystemsNav.tsx:41`; full `window.location.reload()` at `MyAdvisory.tsx:126`, `StudentRecords.tsx:277`, `teacher/Dashboard.tsx:353`.

**File size violations (AGENTS.md 1000-line rule)**

| Lines | File |
|---|---|
| 2012 | `src/lib/api.ts` |
| 1981 | `server/src/routes/registrar/main.ts` |
| 1323 | `server/src/lib/enrollproSync.ts` |
| 1301 | `server/src/routes/grades-sub/classes.ts` |
| 1280 | `server/src/lib/enrollproClient.ts` |
| 1085 | `src/pages/teacher/Dashboard.tsx` |

---

## 5. Prioritized Remediation Roadmap

*Listed only — no fixes were applied.*

### P0 — Critical (do first)

1. **Restore frontend type integrity.** Fix the 72 `tsc` errors: duplicate keys and missing import first (`src/pages/teacher/Schedule.tsx:124-125`; `src/pages/teacher/components/RotationBanner.tsx:3`), then the `LoginResponse.refreshToken` drift (`src/lib/api.ts` type + login pages), `AdminLayout` nav types, Base UI select handler signatures, and stale response interfaces. Gate CI on `npm run typecheck`.
2. **Stop returning tokens in response bodies.** `server/src/routes/auth.ts:310-313,416`; `server/src/routes/sso.ts:175-186` — rely on the httpOnly cookies; migrate `src/lib/api.ts:136-138` and login pages off `sessionStorage` refresh tokens; remove the `localStorage` token read in `EOSYFinalization.tsx:163,179`.
3. **Re-enable TLS verification for EnrollPro** (`server/src/lib/enrollproClient.ts:120`) and validate the upstream certificate/CA configuration. This call path transmits user credentials.
4. **Fix `serviceAuth` fail-open** (`server/src/middleware/serviceAuth.ts:14-17`): reject when `ENROLLPRO_API_KEY` is unset; set the key in `server/.env` (do not edit env in this audit — operational task).
5. **Set a real `DEFAULT_SYNC_PASSWORD`** or fail account creation when unset (`server/src/lib/enrollproSync.ts:216`); audit existing accounts created with `password123`.
6. **Encrypt or externalize the EnrollPro credential at rest** (`SystemSettings.enrollproPassword`, `prisma/schema.prisma:555`) and gate `PUT /settings/enrollpro-credentials` behind stricter validation + re-auth.
7. **Register the live error handler and set `NODE_ENV`.** Import/duplicate `server/src/app.ts:71-75` into the live bootstrap (`server/src/index.ts`) so production never returns Express default stack pages; ensure non-PM2 production starts set `NODE_ENV=production`.
8. **Fix the teacher/registrar 403 endpoint misuse** (F1/F2): add a role-appropriate term/settings read endpoint and switch `ClassRecordsList.tsx:295`, `ClassRecordView.tsx:139`, `EOSYFinalization.tsx:194,214` off `/api/admin/settings`.
9. **Add guardrails to destructive ops:** `POST /admin/dev/seed-scores` (`admin-sub/system.ts:483`) must require an explicit dev/demo flag; `wipe` CLI must require a confirmation token; document/limit `/admin/prune` and `/archive-year`.

### P1 — High

10. **Close audit-trail gaps on integrity actions:** finalize/unfinalize grades (`registrar/main.ts:1226,1330`), attendance clear/bulk (`attendance.ts:119,162`), edit-request create (`editRequests.ts:18`), enrollment status (`registrar/main.ts:1191`), class-assignment create/archive (`classAssignments.ts:308,351`), transmutation rows and subject weights (`grading.ts:237-481`), refresh/reuse/logout-all (`auth.ts:330,505`), SSO session/authorize/exchange (`sso.ts:140-225`).
11. **Record failed security events as `outcome: "failure"`:** 401/403 (`middleware/auth.ts:29-61`), CSRF rejects (`csrf.ts:86-88`), rate limits, validation failures (`validate.ts:34-42`), refresh-token reuse (`auth.ts:354-362`).
12. **Fix schema/route mismatches:** add `remarks` to `schemas/attendance.ts:9-12`; support bundle fields in `schemas/templates.ts:12-20` (`formTypes`, `sheetMappings`, `SF1_10_BUNDLE`, `uploadMode:"bundle"`); add grade extras to `schemas/grades.ts:20-33`.
13. **Validate the unvalidated mutating routes** (§3.2 table): introduce zod schemas for credentials, seed-scores, subject weights (with bounds), school years, sync triggers, finalize/unfinalize, attendance clear/bulk, refresh (wire the unused `refreshSchema`).
14. **Fix query-param hardening:** finite/range checks for `limit/offset/month/year` (`admin-sub/audit.ts:64`, `registrar/main.ts:963`, `admin-sub/system.ts:66`, `attendance.ts:361`); stop accepting tokens via `req.query.token` for non-stream routes (`middleware/auth.ts:24-26`) or issue short-lived stream-scoped tokens.
15. **Reduce PII in logs:** remove LRN/email from `integration.ts:254,298`, `registrar/main.ts:935`, `auth.ts:78,115,194`, `teacherSync.ts:404,410`; stop returning LRN-bearing `result.errors` to clients (`advisory.ts:818`); add redaction/denylist support to `lib/logger.ts`.
16. **Add security headers and protect `/uploads`** (`server/src/index.ts:75`): Helmet or equivalent, CSP, HSTS in prod; move uploads behind auth or serve via signed URLs.
17. **CSRF exemptions:** drop the blanket `/admin/settings` exemption (`csrf.ts:68-71`); keep only the specific safe methods, and verify `/sync-grades` protection is enforced by a fail-closed `serviceAuth`.
18. **Fix SSE lifecycle and connection churn:** single shared EventSource per portal (dedupe `useSyncStream` instances), remove dead clients in `lib/sseManager.ts:36-85` (listen for `close`/`error`, check `writableEnded/destroyed`), stop re-creating the stream on filter changes (`AuditLogs.tsx:187`).
19. **Stand up the E2E safety net:** add `@playwright/test`, a `playwright.config.ts` with `testDir: './e2e'` and `webServer`, isolated test DB, and specs for login, grade save, attendance save, edit-request lifecycle, EOSY finalize. Restrict the config so Vitest files are never collected.
20. **Fix the roster DOM nesting** (F3): use `LoadingSkeleton`/`EmptyState` inside a `<tbody>` in `SectionRosterViewer.tsx:385-397`, or add table-less variants to `TableStates.tsx:28-94`.
21. **Unique constraint on `User.email`** (`prisma/schema.prisma:24`) + deterministic login lookup (`auth.ts:68-70`).

### P2 — Maintenance

22. **Dead code removal:** delete `server/src/app.ts` (after wiring the handler), `lib/teacherDashboardComposer.ts`, `src/lib/constants.ts`, unrouted `PrintCenter.tsx`/`FormViewer.tsx` (or route them), `supertest` deps; reconcile AGENTS.md with reality.
23. **Deduplicate helpers:** single `mapGradeLevel`, single subject canonicalizer, single exam-math module, single transmutation seed source, shared `formatDate`/`formatGradeLevel` utilities.
24. **Fix leaks/unbounded maps:** size-capped TTL cache in `lib/syncCache.ts`, cap upstream response bodies in `enrollproClient.ts`/`httpClient.ts`, clear scheduler intervals and await `server.close()` on shutdown (`index.ts:243-269,402,448`), track boot-sync timer (`syncCoordinator.ts:525`).
25. **Handle floating promises:** `void`/`.catch` at `index.ts:206-230,272-273`, `grades-sub/aims.ts:289-291`; replace silent `.catch(() => {})` audit calls with logged failures.
26. **Frontend cleanup:** revoke object URLs, clear timers on unmount (`ClassRecordTour.tsx:351`, `SystemSettings.tsx:139`, `Schedule.tsx:186`, `Attendance.tsx:317,342,366`), remove `afterprint` listeners on unmount, sanitize `dangerouslySetInnerHTML` color injection in `MyAdvisory.tsx`.
27. **Split files over 1000 lines** (`src/lib/api.ts`, `registrar/main.ts`, `enrollproSync.ts`, `classes.ts`, `enrollproClient.ts`, `teacher/Dashboard.tsx`) along the module seams already present (e.g., registrar sync vs records vs finalization; api client by domain).
28. **Fix layer inversions:** move the grading engine out of `routes/grades-sub/helpers.ts` into `lib/`, break the `schoolSettingsSnapshot` ⇄ `schoolYearResolver` cycle, move `assertSectionAttendanceWritable` to `lib/`.
29. **Add DB-level integrity where codes assume it:** FKs for `GradeEditRequest.classAssignmentId`/`Attendance.recordedBy`, status enums, `AimsScore` unique including `attemptNumber`, guards against duplicate active enrollments/assignments.
30. **Wire a real test DB and CI:** guard `vitest.config.ts` against `smart_db`, run the full 40-file suite plus `tsc`, `eslint`, and Playwright in CI; enforce the 1000-line and no-`any` budgets incrementally to burn down the 971 existing `no-explicit-any` warnings.

---

### Appendix A — Audit evidence inventory

| Evidence | Location |
|---|---|
| Dynamic route sweep (30 visits, console/network capture) | `C:\Users\Sean\AppData\Local\Temp\opencode\audit-artifacts\audit-run.json` |
| Interactive journey sweep (11 journeys) | `C:\Users\Sean\AppData\Local\Temp\opencode\audit-artifacts\audit-journeys.json` |
| Frontend `tsc` full output (72 errors) | `C:\Users\Sean\AppData\Local\Temp\opencode\tsc-app.txt` |
| ESLint full output (1113 problems) | `C:\Users\Sean\AppData\Local\Temp\opencode\eslint.txt` |
| Audit harness scripts | `C:\Users\Sean\AppData\Local\Temp\opencode\audit-harness.mjs`, `audit-journeys.mjs` |

### Appendix B — Verified-clean items (no findings)

- Backend TypeScript compiles with 0 errors (`tsc -p server/tsconfig.json --noEmit`).
- No SQL injection/request-built filesystem paths found (no `path.join(..., req.*)`; Prisma parameterization throughout).
- Zod validation middleware does not leak schemas, values, or stacks on 400s; unknown keys are stripped (the stripping itself causes the field-loss bugs above).
- Refresh tokens and SSO authorization codes are SHA-256 hashed at rest with reuse/family revoke logic; SSO secrets use timing-safe comparison.
- `.env` files are gitignored; no secret is committed; `.env.example` contains placeholders only; JWT/CSRF secrets are strong and distinct.
- All three role logins work end-to-end; 24/27 routed pages render meaningful content; 0 blank pages, 0 error boundaries, 0 uncaught page exceptions, 0 HTTP 5xx in the tested journeys.
- 83/83 DB-free backend unit tests pass.
- `ThemeContext` SSE/reconnect cleanup and several other hooks (`useEditAccess`, `useElementHeight`, `ClassRecordTable`, `sectionLock`) correctly clean up.
