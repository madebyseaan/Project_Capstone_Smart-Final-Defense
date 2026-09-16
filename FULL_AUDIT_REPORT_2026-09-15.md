# Full System & Flow Audit Report — Post-Fix

**Date:** 2026-09-15
**Branch:** `main` (commit `bb132c8`) · worktree clean
**Mode:** Read-only audit. No code, config, or test file was modified. The only file created is this report.
**Scope:** Whole codebase (`src/`, `server/src/`, `server/prisma/`, `e2e/`, tests, config) + live dynamic verification of all system flows.

---

## 1. Executive Summary

**Overall: ~85/100. Defense-ready: ~95/100.**

The system is functional, tested, merged to `main`, and backed up. All demo-critical and rollover-critical defects found in the original audit have been fixed and verified. The remaining ~15 points are post-defense hardening (security, validation, cleanup) plus two untested-but-built items (SSO live round-trip, full rollover practice).

**Verified tonight (fresh, on merged `main`):**

| Metric | Result |
|---|---|
| Backend test suite (isolated `smart_test_db`) | **42 files passed / 10 skipped by design / 0 failed** (52 total) |
| Frontend typecheck | **0 errors** |
| Backend typecheck | **0 errors** |
| ESLint | **0 errors** (1,105 warnings — tracked) |
| Production build (`vite build`) | **passes** |
| Playwright E2E specs (in-repo, read-only) | **4/4 passed** |
| Live flow rehearsal | **14/14 flows passed**, 0 console errors, 0 API ≥ 400 |
| Page sweep | **24/24 pages OK** (admin 10, teacher 6, registrar 8) |
| Write flows (grade save, attendance save) | **HTTP 200**, then rolled back |
| Data integrity | grades 7,970 (7,962 archived) · enrollments 295 (201 archived) · students 104 — unchanged |

**Quick stats**

| Item | Value |
|---|---|
| Backend endpoints | 186 |
| Routes with `validate(...)` | 48 |
| Files > 1,000 lines (AGENTS limit) | 7 |
| Test files | 52 |
| E2E specs | 1 (4 tests) |
| TODO/FIXME/HACK | 5 |
| Empty `catch {}` blocks | 0 |
| Uncommitted changes | none |

---

## 2. System Flow Map (whole flow)

### 2.1 Authentication & session
1. Login page → `POST /api/auth/login` validates the user locally; for teachers it cross-checks the EnrollPro faculty gate.
2. On success: access token (15 min) + refresh token (7 days, SHA-256 hashed at rest) issued as httpOnly cookies; the SPA stores role-scoped keys (`token_teacher`, etc.) in `sessionStorage`.
3. Every API request: Axios interceptor attaches `Authorization` + `x-csrf-token`; `authenticateToken` verifies JWT and user status.
4. Refresh: `POST /api/auth/refresh` rotates the token and detects reuse (revokes the token family). Logout / logout-all revoke tokens.
5. Role guard: frontend layouts check the role; backend `authorizeRoles` / `requireAdmin` enforce it.

### 2.2 Teacher flow
`/teacher` dashboard → `/teacher/classes` (class list, current year, active only) → `/teacher/records/:id` ledger (WW/PT/TA columns, HPS, auto-save via `POST /api/grades/grade/batch`) → `/teacher/attendance` (mark + `POST /api/attendance/bulk`, clear via `/clear`) → `/teacher/attendance-reports` (SF2 + export) → `/teacher/schedule` → `/teacher/advisory` (advisory roster + sync).

### 2.3 Registrar flow
Students master list → section roster (list + roster dialog) → school forms (SF1/SF2/SF5/SF6/SF9/SF10 open + print) → EOSY finalization (readiness, grade locking, per-section finalize/unfinalize) → remedial tracker → transferees (prior-school records, OCR/Excel import, SF10 records) → alumni.

### 2.4 Admin flow
Dashboard → users CRUD (create/edit/suspend/reactivate/delete) → class assignments (create/archive/restore, ATLAS/EnrollPro sync) → edit requests (approve/reject/revoke) → grading config (weights per subject type) → transmutation table → school years (create/patch/archive) → system settings (branding, academic calendar, credentials, locks) → system health → audit logs (SSE live stream).

### 2.5 Background sync & rollover
Unified scheduler (5-min cycles):
EnrollPro sync (teachers, sections, students, enrollments) → prune (SSOT enforcement) → transferees → ATLAS teaching load → branding (term/dates) → student profiles → AIMS scores.
School-year change:
`resolveEnrollProSchoolYear` (ACTIVE year wins) → `ensureSchoolYearFromEnrollPro` (creates/links year) → `handleYearChangeRollover` (lock previous → archive if fully finalized; unlock + revert on failure) → dependent steps skipped when rollover is blocked.

### 2.6 SSO flow (restored)
- **Companion/reverse SSO:** `/api/auth/sso/authorize` (code issue, hashed at rest, 60s TTL, single-use) → `/api/auth/sso/exchange` (timing-safe secret compare) → session.
- **EnrollPro session launch:** `/api/auth/enrollpro/session` bootstraps a session with the access cookie.
- **UI:** "Integrated Systems" sidebar in all portals (admin/teacher/registrar) plus `/auth/enrollpro/*` pages (callback forward, session, authorize, error).

---

## 3. What Was Fixed (this session) & Evidence

| Commit | Fix | Verified by |
|---|---|---|
| `38bb7ee` | Atomic rollover; prune year-mismatch guard; unlock-on-failure; fail-closed teacher year sync | 4 tests (rollover T5/T8, prune guard, teacher-sync guard) |
| `373c761` | Public term/settings endpoint (kills 403s); EOSY no silent "T3" | live: 0×403; supertest |
| `07a504e` | Explicit-year finalize/unfinalize; empty-section archive unblock; term-lock policy | 3 test files |
| `948b367` | Attendance save/clear CSRF 403 fixed | live save 200 |
| `20f6c64` | Frontend typecheck 72→0; roster DOM nesting fix | tsc 0, build, smoke |
| `37f9301` | `npm run verify` gate; 2 lint errors fixed | gate exit 0 |
| `221a798` | Archived classes hidden; dashboard fallback excludes archived years | live class list |
| `436f3ca` | Manual year switch runs safe rollover; School Years archive is real | 3 tests |
| `1f9d7fa` | Global error handler + JSON 404; dead `app.ts` removed | test + live 404 |
| `ebc1851` | Integration auth fails closed | 3 tests |
| `5e84a42` | LRN/employeeId/email masked in logs | 4 tests |
| `a26c707` | Audit rows: attendance clear/bulk, finalize/unfinalize, edit-request create | live audit row |
| `a26cdca` | CSS color sanitization; real 404 page | live |
| `7395960` | 7 dead files removed (1,316 lines) | build + tests |
| `ee8c398` | In-repo Playwright specs + `test:e2e` | 4/4 pass |
| `6ba387e` | Edit-request create→approve flow test (term mocked) | 3 tests |
| `ccd7a63` | SSO restored onto fixed main (conflicts resolved) | 41 tests, UI check |
| `bb132c8` | RL-10a: prefer EnrollPro ACTIVE year over pinned label | 5 tests |

---

## 4. Static Scan Results

### 4.1 Endpoints (186 total)
Largest route surfaces: `admin-sub/system.ts` (25), `registrar/main.ts` (18), `admin-sub/classAssignments.ts` (14), `admin-sub/grading.ts` (13), `integration.ts` (12).
Mutation endpoints are protected by `authenticateToken` + role middleware; `serviceAuth` guards the 4 external integration endpoints (now fail-closed).

### 4.2 Validation coverage
- **48** `validate(...)` usages across 186 endpoints.
- Unvalidated mutating routes remain (documented, not demo-blocking): seed-scores, prune, archive-year body is now validated, credential/term-label writes, several sync triggers, registry reconcile routes, attendance already validated.
- Known field-loss issues still open: attendance `remarks` stripped by schema, template bundle fields stripped, some grade extras stripped.

### 4.3 Audit-log coverage
Audited actions (per route file): system 13, grades 6, auth 6, users 5, class assignments 5, external records 4, edit requests 4, grading 4, templates 3, aims 2, SSO 2, attendance 2, transferees 2, registrar main 2, remedial 2, exports 1, sf10 profile 1, eosy 1.
Still missing audit rows: token refresh / logout-all, SSO authorize/exchange, class-assignment create/archive, transmutation row edits, subject weights, sync-triggered writes, and most 401/403/CSRF/validation failures (failure auditing).

### 4.4 Code health
- **Files > 1,000 lines (7):** `src/lib/api.ts` (2,047), `server/src/routes/registrar/main.ts` (2,006), `server/src/lib/enrollproSync.ts` (1,336), `server/src/routes/grades-sub/classes.ts` (1,304), `server/src/lib/enrollproClient.ts` (1,292), `src/pages/teacher/Dashboard.tsx` (1,085), `server/src/routes/admin-sub/system.ts` (1,005).
- Dead code removed (7 files); known duplication remains (grade-level mappers ×4, date formatters ×5, exam math duplicated API↔client, transmutation table triplicated).
- TODO/FIXME/HACK: 5.
- Empty `catch {}` blocks: 0 remaining (previously ~20 identified; remaining silent catches are comment-only `catch { /* ... */ }`).

### 4.5 Static checks
- Frontend `tsc -b`: **0 errors**
- Backend `tsc`: **0 errors**
- ESLint: **0 errors**, 1,105 warnings (mostly `no-explicit-any` on pre-existing code)
- `npm run build`: passes
- Tests: 52 files (42 pass, 10 skipped — HTTP suites requiring live credentials by design)

---

## 5. Dynamic Verification (Playwright, live app)

| Flow | Result |
|---|---|
| Login admin / teacher / registrar | PASS |
| Admin pages (10) · Teacher pages (6) · Registrar pages (8) | PASS (24/24) |
| Teacher: class list → class record ledger (26 inputs) | PASS |
| Teacher: save grade (`POST /grades/grade/batch`) | PASS (200) |
| Teacher: save attendance (`POST /attendance/bulk`) | PASS (200) |
| Registrar: roster + roster dialog (10 rows) | PASS |
| Registrar: SF10 open + print (1 print target, PDF generated) | PASS |
| Registrar: EOSY readiness (Overview/Grade Locking/Learner Records, "NOT READY YET") | PASS |
| Admin: edit-requests row | PASS |
| Unknown URL → 404 page | PASS |
| Console errors / API errors during rehearsal | 0 / 0 |
| DB after writes | rolled back to baseline (verified counts) |

---

## 6. Security Posture

### Fixed
- Integration endpoints fail closed without the key.
- Global error handler returns generic JSON (no stack/internal messages); unknown `/api/*` → JSON 404.
- LRN / employee ID / email masked in logs.
- Interpolated CSS colors sanitized (no style injection).
- CSRF header sent on attendance writes; error handler + audit rows added.

### Remaining (measured, not demo-blocking)
| Risk | Evidence | Severity |
|---|---|---|
| Refresh/access tokens stored in JS-readable storage; refresh token also returned in login JSON | 28 `sessionStorage.setItem` sites; `auth.ts` returns refreshToken | High |
| EnrollPro TLS verification disabled | 4 × `rejectUnauthorized` (incl. credential validation path) | High |
| Default sync password fallback (`DEFAULT_SYNC_PASSWORD` unset → known value) | 1 site in `enrollproSync.ts` | High |
| Access token accepted in URL query (SSE) | `middleware/auth.ts`; 4 frontend call sites | Medium |
| No security headers (no Helmet/CSP/HSTS) | `helmet` absent from `index.ts` | Medium |
| `/uploads` served unauthenticated | `express.static` on uploads | Medium |
| Missing validation on several mutating routes; three field-loss schema mismatches | 48/186 validated | Medium |
| Failure events (401/403/CSRF/validation) not audited | middleware has no audit write | Medium |
| Refresh/SSO/class-assignment actions lack audit rows | coverage map §4.3 | Medium |
| Email not unique in DB | `schema.prisma` | Medium |
| No database-level range/constraint checks (grade bounds enforced API-only) | schema | Low |

---

## 7. Rollover Readiness

**Ready for a planned rollover: yes.** All correctness gaps fixed; only a full practice flip remains.

Protected now:
- Failure is atomic: both active-year settings revert and the sync cycle aborts (no mixed-year data).
- Prune refuses to run when SMART and EnrollPro disagree on the active year (prevents old-year data deletion).
- Failed archive unlocks the still-active previous year (no stuck lock).
- Empty sections no longer block archive.
- Stale term dates cannot lock the new year's future terms; active/future terms auto-unlock.
- Registrar can finalize an outgoing year via explicit `schoolYear`.
- Manual year switch runs the safe rollover and refuses if the old year is unfinished.
- "Archive year" performs the real archive; archived classes stop appearing as current.
- Teacher sync fails closed rather than writing under a placeholder year.
- Year resolution prefers EnrollPro's ACTIVE year over a pinned label (partial-outage guard).

Remaining:
- Full practice flip end-to-end (not yet simulated).
- Pre-flight still required: finalize all sections, no drafts, rollover screen shows 0 problems, DB backup.

---

## 8. SSO Status

- **Restored and merged to `main`** (`ccd7a63`), conflicts resolved with all fixes intact.
- 2 SSO unit-test suites pass; SSO routes and the Integrated Systems sidebar render; live smoke shows 0 errors.
- Database already contains `CompanionSsoCode` and `User.enrollproSubject` (schema drift noted; harmless, restore skips it).
- **Gap:** the live sign-in round-trip with EnrollPro was not exercised (depends on EnrollPro completing the redirect). Pages/services are in place and unit-tested.

---

## 9. Data Safety & Backups

- Live data verified unchanged: **grades 7,970** (7,962 archived across 2026-27…2029-30), **enrollments 295** (201 archived), **students 104**, **attendance 0**.
- No DELETE audit rows today; only test-created rows were removed during rehearsals.
- Full database backup created (29 tables, 32,662 rows, ~32 MB) and **restore verified** (all table counts matched).
- Rollback points: old `main` = `f9dbd52`; current `main` = `bb132c8`. Feature branches retained: `feature/companion-sso`, `restore/companion-sso`, `feat/rollover-readiness`.
- Automated tests always run against `smart_test_db` (guard refuses the live DB).

---

## 10. Remaining Work (prioritized)

**P0 (none blocking the defense).**

**P1 — post-defense hardening (with rehearsal windows):**
1. Tokens out of JS storage; stop returning refresh token in the login body.
2. Re-enable EnrollPro TLS verification.
3. Require `DEFAULT_SYNC_PASSWORD` (no fallback).
4. Fix the 3 field-loss schema mismatches (attendance remarks, template bundle, grade extras).
5. Validate the remaining mutating routes.
6. Security headers (Helmet/CSP/HSTS); protect `/uploads`; short-lived stream tokens instead of access token in URL.
7. Audit failure events and the remaining unaudited actions; unique email constraint.

**P2 — maintenance:**
8. Deduplicate helpers; split the 7 files > 1,000 lines; reduce lint warnings.
9. Extend E2E coverage to write flows and SSO.
10. Full rollover practice drill.

---

## 11. Recommended Defense Checklist

1. Copy the DB backup out of the Windows temp folder.
2. Rehearse the demo script once (logins → class record → save grade → attendance → print → EOSY).
3. Do not deploy new changes on defense day; if anything looks wrong, restore the backup or revert to `f9dbd52`.
4. Know the honest limitations: SSO round-trip and full rollover are built but not live-rehearsed.

---

## Appendix — Evidence Commands

- Gate: `npm run verify` → exit 0 (frontend tsc, build, backend tsc, eslint, backend tests on `smart_test_db`)
- E2E: `npx playwright test` → 4 passed
- Live flow rehearsal: temp Playwright harness → 14/14 flows, 0 console/API errors
- Data checks: direct PostgreSQL queries (grades/enrollments/students/attendance/AuditLog)
- Backup/restore: full-table JSON export + restore verified by count comparison against `smart_test_db`
