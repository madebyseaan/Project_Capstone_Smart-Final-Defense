# SMART — Full Audit Remediation Plan (Autonomous Run)

Status: PLANNED — do not implement until the scheduled Friday autonomous run.
Created: 2026-10-06 from the full codebase audit (static review + gates: server vitest, offline Playwright rig, builds, lint).
Executor: autonomous agent. This document is self-contained; **no questions may be asked**. All ambiguous decisions are pinned below.

---

## 1. Mission

Fix the verified CRITICAL/HIGH audit findings plus a selected MEDIUM set, without regressions, using the repository's own gates:

- Isolated `smart_test_db` for all DB tests (fail-closed guards already exist).
- Offline Playwright rig for UI/E2E (loopback stubs, ports 5174/5004).
- Never touch live/demo data (`smart_db`), never modify `.env`, never push.

Every phase must end green before the next phase starts. Any file created must stay under 1000 lines (AGENTS.md). Files already over 1000 lines that a phase touches must move the modified logic into new modules and/or be scheduled in Phase 8.

**The plan is law** (Section 2.6): no improvisation, no invented APIs/dependencies, every PASS backed by raw command output, and every bug encountered — fixed or reverted — recorded in the punch list (Section 2.7).

---

## 2. Autonomous execution protocol

1. **Branch**: `git checkout -b audit-remediation` from current HEAD. Commit ALL pre-existing uncommitted changes first as `chore: pre-remediation snapshot` on that branch (so a phase revert never loses prior work). Do not touch the original branch.
2. **Phase loop** (Phases 0–9):
   a. Implement the phase exactly as specified (no scope creep; no unrelated refactors).
   b. Run the phase's Gate commands (Section 4).
   c. "Scan" after each fix: run the phase's targeted test(s) first, then the full phase gate set. Grep for the old pattern to prove it is gone.
   d. On failure: fix and re-run. **Max 3 fix iterations per phase.**
   e. On 3rd failure: `git reset --hard <phase-start-sha>`, mark the phase `FAILED` in the run log with the failing output, and continue to the next phase (except Phase 0, which stops the run).
   f. On success: run the A9 phase-end self-audit, commit `phase N: <summary>` (citing the plan anchor per A1), attach evidence logs, update `docs/AUDIT_REMEDIATION_PUNCHLIST.md` (every error encountered, see E6), and append the phase result block to `docs/AUDIT_REMEDIATION_RUN_LOG.md` (commands, raw-result paths, commit sha, deviations).
3. **Never**: `pnpm run test:e2e` (live stack :5003/:5173 with real credentials/data), `db:wipe` without `DATABASE_URL=*_test`, edits to `.env*`, `git push`, `git rebase`, force pushes, or deleting tests to make gates pass.
4. **Stop-and-report conditions**: env guard refuses to run; test DB unreachable; Phase 0 baseline not green; 3 straight phase failures.
5. **Definition of done (whole run)**: all phases PASS or `PASS_WITH_PUNCHLIST`; full gate suite green; run log complete with raw evidence; punch list exported with every item status; working tree clean (except untracked run-log/punchlist/evidence).

### 2.6 Anti-hallucination / strict-execution protocol (mandatory)

The executor is a deterministic implementer, not a designer. **The plan is law.** Every rule below is a gate-level requirement, not advice.

- **A1 — Plan anchoring**: every commit message and run-log entry cites a plan anchor (`Phase N/x` or pinned decision `P#`). Work not traceable to a plan step must not be performed.
- **A2 — Evidence or it didn't happen**: a gate may only be marked PASS when the raw command output is saved under `docs/audit-run/phase-N-<gate>.log` and the exact command line is recorded in the run log. No paraphrased counts, no memory-based claims. Missing/unreadable output = gate NOT passed.
- **A3 — Re-read before write**: before editing any file, re-open it and re-confirm the plan's line anchors/snippets. If the code does not match the plan (drift in lines/signatures/behavior), do **not** improvise: log a `PLAN_DRIFT` punch item, skip that step, and continue with non-conflicting steps (fail the phase if the drifted step is its core).
- **A4 — No invention**: no new npm dependencies, no new endpoints/routes, no Prisma schema or migration changes, no new `.env` keys, no new UI features. If a step appears to need one, log a `PLAN_GAP` punch item and stop the step.
- **A5 — Mechanical verification only**: run the exact greps, line counts, `git diff --stat`, and test commands listed for the phase and paste the outputs. File sizes must come from `[System.IO.File]::ReadAllLines(...).Length`.
- **A6 — No test weakening**: never delete, skip, `.todo`, or loosen existing tests or assertions. Test edits are additive unless the plan explicitly directs a behavior re-pin (only Phase 4E rollover tests may re-pin). Any relaxation is a run failure.
- **A7 — Determinism**: run each new/modified test file twice. A flake counts as failure; record a `FLAKE` punch item with both outputs.
- **A8 — Contradiction tripwire**: if any output contradicts the plan (counts, status codes, error strings, file sizes), stop the step and record the contradiction verbatim. Never round a failure up to green.
- **A9 — Phase-end self-audit** (recorded in the run log before the phase commit): every planned step touched or explicitly skipped; every gate output attached; scan greps executed; `git diff --stat` matches the phase's file list; no OPEN blocker punch items for this phase; no weakened tests.
- **A10 — Zero undisclosed deviations**: deviations from pinned decisions fail the phase. Deviations in undecided details must appear under `Deviations` in the run log with justification.

### 2.7 Error handling and the punch list (nothing is silently dropped)

- **E1 — Error classes**:
  - (a) *Implementation error* (your change fails a gate): fix loop, max 3 iterations.
  - (b) *Pre-existing/environmental failure*: compare against the Phase 0 baseline; if pre-existing, do not fix it — record a `PRE_EXISTING` punch item.
  - (c) *Plan drift/gap*: record `PLAN_DRIFT`/`PLAN_GAP`; no improvisation (A3/A4).
  - (d) *External-dependency failure* (EnrollPro/ATLAS/AIMS stub or live outage during rig): retry once; then record an `EXTERNAL` punch item.
- **E2 — Punch list file**: `docs/AUDIT_REMEDIATION_PUNCHLIST.md`, created in Phase 0, entries append-only. Required fields per entry: `ID`, `Discovered (phase/date)`, `Title`, `Severity (BLOCKER | HIGH | MED | LOW)`, `Repro`, `Evidence (exact command + log file path)`, `Root cause (or suspected)`, `Attempts (1–3 with outcomes)`, `Status (OPEN | FIXED_VERIFIED | REVERTED | DEFERRED | PRE_EXISTING)`, `Phase`, `Next action`.
- **E3 — Revert policy**: on the 3rd failed attempt, `git reset --hard <phase-start-sha>`; set the phase to `FAILED`; set the punch item to `REVERTED` with the failing raw output attached; continue to the next phase (Phase 0 failure stops the run).
- **E4 — No silent passes**: a phase with an OPEN `BLOCKER`/`HIGH` punch item created in that phase cannot be marked `PASS`. Use `PASS_WITH_PUNCHLIST` only for non-blocking `MED`/`LOW` items. The final report must enumerate every OPEN/DEFERRED item with reproduction commands.
- **E5 — Systemic stop**: if the same root cause fails in two different phases, stop the run and report; do not thrash. Leave the branch at the last good commit.
- **E6 — Punch-list guarantee ("punch bag")**: every bug or error encountered mid-fix is captured in the punch list with full evidence, even when the phase succeeds — fixed bugs get `FIXED_VERIFIED` with proof, reverted bugs get `REVERTED` with the failing output. Nothing encountered during the run is dropped or forgotten.

---

## 3. Global constraints and pinned decisions

- Roles: TEACHER/ADMIN/REGISTRAR. Existing middleware: `authenticateToken`, `authorizeRoles`, `validate`, `serviceAuth`, `checkGradeEditLocks`.
- Historical reads filter by `schoolYear` only; operational reads may use `isActive`/`isArchived` (AGENTS.md rule).
- Grade lock precedence (archived → year → term → legacy) must not change.
- Rollover/remedial contract (`docs/ENROLLPRO_REMEDIAL_CONTRACT.md`) must not change: archive is blocked while a `CONDITIONALLY_PROMOTED` enrollment has a `PENDING` remedial row; `GET /api/registrar/remedial/rollover-block` stays service-auth.
- **Survival rule when EnrollPro rolls over:** SMART must never get stuck on the old year because of the remedial/snapshot guards. The EnrollPro-initiated rollover path degrades to `locked_not_archived` (new year active, outgoing year locked but not archived) so remedial can still be completed and the year archived later; only the manual archive action hard-fails (P25).
- Response shapes consumed by the frontend must stay backwards compatible; new fields are additive.
- File-size rule: new files < 1000 lines; do not grow an oversized file by more than ~100 lines without extracting a module (Phase 8 does the full splits).

Pinned policy decisions (implement exactly):

| # | Decision |
|---|---|
| P1 | Attendance: TEACHER access = section adviser OR holder of an active ClassAssignment for that section; ADMIN bypasses all; REGISTRAR bypasses GETs only. Unauthorized = 403, missing teacher profile = 404. |
| P2 | ECR import: if ANY targeted grade is FINALIZED or archived, reject the WHOLE import (403 `{code:"GRADE_FINALIZED"}`), including dry-run previews. Do not skip rows. |
| P3 | Synced teacher password: use `DEFAULT_SYNC_PASSWORD` when set; otherwise a cryptographically random password + warning log. No startup hard-fail (demo laptop must keep working). |
| P4 | New-teacher sync: remove the placeholder filter so placeholders resolve after batch create; unresolved placeholders still dropped before the Teacher upsert. |
| P5 | Login limiter: run `validate(loginSchema)` BEFORE the limiter; key = IP + normalized (trim/lowercase, max 255) email; drop the dead `username` fallback. Keep identifier+IP keying (not IP-only, NAT-safe). |
| P6 | Auto-EOSY only when the section-year is complete (every enrolled learner has FINALIZED grades for every required subject/term; rotation subjects require only their rank term). Manual EOSY route stays permissive. |
| P7 | Re-finalize (still CP): refresh never-conducted rows for still-failing subjects, delete never-conducted rows for now-passing subjects, keep+flag rows with data; return `remedialRowsFlagged`. |
| P8 | Sync coordinator: claim `syncRunning` before the first `await`; single outer `try/finally`; overlap returns the current skipped-result shape. |
| P9 | Grade writes: atomic conditional write; FINALIZED/archived = 403/`skipped`; batch creates rows via `createMany({skipDuplicates:true})` (no in-tx P2002); batch writes GradeSnapshots via one `createMany`. |
| P10 | completeRemedial: re-read + validate + compute inside one transaction with a `FOR UPDATE` row lock; preserve error strings/messages the route maps. |
| P11 | syncBackSubjects: per-learner transaction + `upsert` on the compound unique; RETAINED sets `promotedToGradeLevel = remedialGradeLevel`; keep existing RETAINED `deleteMany` semantics. |
| P12 | unfinalize-grades: preflight `unfinalizeSectionEosy`; `HAS_COMPLETED_REMEDIAL` = 409 before any grade write. |
| P13 | Enrollment status update: only non-archived enrollments in the active school year; otherwise 409 `ENROLLMENT_YEAR_LOCKED`; always audit. |
| P14 | Suspension: wrap user+token+assignment writes in one transaction; scope assignment archival to the active school year. |
| P15 | Advisory historical grades (`advisory.ts:341-345`): remove `isActive:true` (schoolYear already filters). Leave `/my-advisory` and `/summary` current-year filters unchanged. |
| P16 | sectionLock: document as in-process-only (Option A). Advisory-lock upgrade (Option B) is deferred backlog. |
| P17 | Score queue: each queued edit carries its own `classAssignmentId` + term + qaMeta/applyMeta snapshot; on class change, flush old edits to the OLD class; term init resets on class change and gates on the loaded payload matching the route param. |
| P18 | Logout: call `authApi.logout()` (best-effort, 3 s bound), then clear only the portal's sessionStorage keys and `queryClient.clear()`; navigate to the portal login path. |
| P19 | SSE refresh: use portal-aware token/refresh keys (`getPortalToken`/`getPortalRefreshToken`), send `x-refresh-token`, redirect to `getPortalLoginPath(portal)`, no duplicate reconnect after refresh. |
| P20 | Dashboards: background poll failures keep last-good data + stale banner; full-page error only when there is no data. |
| P21 | Pagination: slice with the clamped effective page; clamp state when `totalPages` shrinks. |
| P22 | Error boundary: single top-level `RouteErrorBoundary` keyed by `location.key`; "Try again" + "Reload" actions. |
| P23 | api.ts split uses a barrel at `src/lib/api.ts`; all existing import sites unchanged. |
| P24 | A11y: rewrite `SyncProgressModal` on the existing `Dialog` primitives; add `aria-label`/`aria-pressed` to the listed icon-only buttons. |
| P25 | EnrollPro-initiated rollover (`handleYearChangeRollover`): if the outgoing year still has `CONDITIONALLY_PROMOTED` + `PENDING` remedial rows, return `locked_not_archived` with `blockReason: "pending_remedial"` and `pendingRemedialCount` (do NOT throw/revert). SMART follows EnrollPro to the new year; the outgoing year stays locked and unarchived; remedial completion and later archive remain possible. Manual archive (`archiveSchoolYear` and the admin manual year switch) stays strict: hard error/400 with a clear message. |
| P26 | Registrar `GET /registrar/rollover-status` adds `pendingRemedialCount` + `pendingRemedialStudents` (lrn/name/grade/pendingSubjects, cap 20) and includes them in `canArchive`; admin year-switch message distinguishes `pending_remedial` from `unfinalized`. |
| P27 | PM2 gates default to READ-ONLY (`pm2 list`, `pm2 logs --nostream`, log-file tails). `pm2 reload`/`restart` only when `AUDIT_ALLOW_PM2_RELOAD=1` is set, and never while a presentation/test is in progress. Live PM2 apps: `server` (live DB), `client`. Never point PM2 at the test DB; never run `pm2 delete`. |
| P28 | Playwright is a mandatory bug-catching gate: every frontend/behavior phase adds rig specs, and Phase 9 runs a full portal sweep that fails on console errors, `pageerror`, and API responses >= 400 (documented allowlist only: expected EnrollPro/ATLAS/AIMS offline warnings are server-side, not client). |

---

## 4. Environment setup and gate commands (validated in the audit)

Prerequisite: PostgreSQL running with the live `smart_db`; test DB `smart_test_db` (checked by guards below). PowerShell 5.1.

### 4.1 Build a `*_test` DATABASE_URL without printing secrets

```powershell
# run from repo root
$raw = (Select-String -Path "server\.env" -Pattern '^DATABASE_URL=' | Select-Object -First 1).Line.Substring('DATABASE_URL='.Length).Trim().Trim('"')
$q = if ($raw -match '\?') { $raw.Substring($raw.IndexOf('?')) } else { '' }
$bare = $raw -replace '\?.*$',''
$prefix = $bare.Substring(0, $bare.IndexOf('@')+1)
$hostPart = ($bare.Substring($bare.IndexOf('@')+1) -split '/')[0]
$env:DATABASE_URL = "$prefix$hostPart/smart_test_db$q"
```

If `smart_test_db` is missing, create it with a one-off Node script using the `pg` package from `server/node_modules` (`CREATE DATABASE smart_test_db`), then `cd server; npx prisma db push`.

### 4.2 Gates

| Gate | Command | Notes |
|---|---|---|
| G-SRV | `cd server; pnpm test` (with 4.1 env) | Runs guard + seed-test-base + vitest. Baseline: 426 passed / 0 failed / 67 skipped. |
| G-BLD | `pnpm run build` (root) and `cd server; pnpm run build` | tsc must exit 0. |
| G-LINT | `pnpm run lint` (root) | Must stay **0 errors**; warnings allowed (baseline 1147). Do not add new error-level violations. |
| G-RIG | from root, with env from 4.1 plus the following, then `pnpm run test:e2e:offline` | Baseline 9/9 passed. Isolated ports; safe. |
| G-LOG | Tee G-SRV and G-RIG output to `docs/AUDIT_REMEDIATION_RUN_LOG.md` (or a `.log` beside it) and scan for error signatures: `"level":"error"`, `Unhandled`, `UnhandledPromiseRejection`, `PrismaClientKnownRequestError`, `P2002`, `P2003`, `P2028`, `25P02`, `Rollover handling failed`, `Active-year revert`. SyntaxError/TypeError in server logs fail the phase. External-offline warnings are allowed (allowlist below). |
| G-PM2 | `pm2 list` and `pm2 logs server --nostream --lines 300` (read-only) + tail `C:\Users\Sean\.pm2\logs\server-error.log` | Baseline recorded in Phase 0. Any NEW `"level":"error"` / `Rollover handling failed` / `Active-year revert` compared to baseline fails the phase. Reload is gated by `AUDIT_ALLOW_PM2_RELOAD=1` (P27) and only used in the Phase 9 smoke; note PM2 runs the pre-change code until reloaded, so this gate detects environmental regressions, not new-code errors (G-LOG covers those). |
| G-TYPECHECK | `pnpm run typecheck` | Optional convenience; `G-BLD` includes it. |

Rig env:
```powershell
$env:ENROLLPRO_URL="http://127.0.0.1:5999/api"
$env:ATLAS_URL="http://127.0.0.1:5998/api/v1"
$env:SMART_TEST_ADMIN_EMAIL="rig.admin@example.test";    $env:SMART_TEST_ADMIN_PASSWORD="RigPass123!"
$env:SMART_TEST_TEACHER_EMAIL="rig.teacher@example.test"; $env:SMART_TEST_TEACHER_PASSWORD="RigPass123!"
$env:SMART_TEST_REGISTRAR_EMAIL="rig.registrar@example.test"; $env:SMART_TEST_REGISTRAR_PASSWORD="RigPass123!"
```

`pnpm run verify` is NOT usable as-is (it needs the test-DB env and skips the rig); use the gates above explicitly.

### 4.3 Per-phase scan rule

After each phase: (1) run the phase's targeted test file(s); (2) run G-SRV (backend phases) or G-RIG (frontend phases); (3) run G-BLD + G-LINT; (4) run G-LOG (backend phases) and G-PM2 (once per phase, read-only); (5) grep to confirm the old pattern is gone; (6) `git diff --stat` must show only phase-intended files.

### 4.4 Runtime bug-catching specifics (Playwright + PM2)

**PM2 (live deployment, read-only by default)**

- Apps (verified now): `server` (ts-node-dev, cwd `server/`, live `smart_db`, out/error logs below, 0 restarts) and `client` (vite supervisor, **1500 restarts — known defect**, see Phase 4F).
- Log files: `C:\Users\Sean\.pm2\logs\server-out.log`, `server-error.log`, `client-out.log`, `client-error.log`.
- Scan patterns per phase: `"level":"error"`, `UnhandledPromiseRejection`, `PrismaClientKnownRequestError`, `P2002/P2003/P2028`, `25P02`, `Rollover handling failed`, `Reverted active year`. Compare against the Phase 0 baseline snapshot; new occurrences fail the phase.
- Allowlisted (expected, do not fail): `EnrollPro is marked unreachable`, `Timeout fetching .../active-term`, `[AtlasYear] runtime/context unavailable`, `Partial sync — EnrollPro offline`, `AIMS DOWN (Timeout...)`, `fast-fail mode active`.
- Reload policy: `AUDIT_ALLOW_PM2_RELOAD=1` only; use `pm2 reload server` (zero-downtime), then wait for `GET /api/health`, then G-PM2 again plus the Phase 9 smoke. Never reload while a demo/test runs and never while the user says hands-off.

**Playwright (isolated rig + Phase 9 sweep)**

- Per-phase specs as listed; all run through `pnpm run test:e2e:offline` (isolated DB + stubs, never the live stack).
- Phase 9 adds `e2e/offline/specs/portal-sweep.spec.ts`: log into teacher, admin, registrar; visit every top-level page (routes from `src/App.tsx`: dashboards, class records, attendance, advisory, schedule, student grade profile; admin users/classes/grading/school years/edit requests/audit/health/settings/templates; registrar students/rosters/EOSY/remedial/teaching load/forms/print/alumni); attach console-error + `pageerror` + API >= 400 collectors (reuse `collectProblems` from `e2e/fixtures.ts`, extend it with `pageerror`); assert no unexpected errors. If collection fails on a known-benign message, add it to an explicit allowlist array with a comment — never blanket-disable.

---

## 5. Baseline (recorded 2026-10-06)

- G-SRV: 426 passed / 0 failed / 67 skipped; one file (`external-records-api.test.ts`) now gated behind `SMART_LIVE_API=1` (pre-existing failure when the live server is up; it could write live data).
- G-RIG: 9/9 passed.
- G-BLD: both builds pass. G-LINT: 0 errors / 1147 warnings.
- Working tree contains pending pre-remediation work (remedial rollover guard, dashboards fix, etc.); Phase 0 snapshots it.
- PM2 baseline (2026-10-06): `server` online (0 restarts); log tail shows only allowlisted external-offline warnings. `client` online but **1500 restarts** (restart-loop defect, fix scheduled in Phase 4F). No `"level":"error"` entries in the server log tail.
- Rollover baseline risk (to be fixed in Phase 4E): today a pending-remedial block inside `archiveYearInTx` makes `handleYearChangeRollover` throw, so `schoolYearResolver` reverts the active year (schoolYearResolver.ts:166-210) and SMART stays on the old year with an audit-spam retry loop if EnrollPro has already rolled. Phase 4E converts this to `locked_not_archived`.

---

## 6. Phase overview

| Phase | Scope | Gate |
|---|---|---|
| 0 | Baseline + harness + snapshot commit | All gates green, no code changes |
| 1 | Security critical: attendance ownership, ECR finalized guard, sync password, login limiter, teacher-upsert placeholder | G-SRV, G-BLD, G-LINT |
| 2 | EOSY/promotion integrity: completeness gate for auto-EOSY, stale remedial row cleanup | G-SRV, G-BLD, G-LINT |
| 3 | Write-path integrity: sync lock, guarded grade writes + batch snapshots, completeRemedial tx, syncBackSubjects tx, aimsImport defer | G-SRV, G-BLD, G-LINT |
| 4 | Registrar/admin correctness: unfinalize EOSY invalidation, enrollment status guard, suspension tx, advisory historical filter | G-SRV, G-BLD, G-LINT |
| 4E | Rollover resilience when EnrollPro rolls over: pending-remedial block degrades to locked_not_archived; rollover-status/admin messaging | G-SRV, G-RIG, G-BLD, G-LINT, G-LOG |
| 4F | PM2 supervisor fix: stop the `client` restart loop (config-only) | G-PM2 (gated reload), G-LOG |
| 5 | Frontend critical: score queue class binding, logout revocation + cache clear, SSE refresh loop | G-RIG, G-BLD, G-LINT |
| 6 | Frontend robustness: attendance API/errors, error boundary, pagination, dashboard stale polls, remedial tracker, audit-log SSE | G-RIG, G-BLD, G-LINT |
| 7 | A11y + targeted design hygiene | G-RIG, G-BLD, G-LINT |
| 8 | File-size compliance splits (mechanical moves only) | G-SRV, G-RIG, G-BLD, G-LINT |
| 9 | Full verification + Playwright portal sweep + rollover drill + gated PM2 smoke + final report | All gates + run log |

Dependencies: Phase 1 independent; Phase 2 depends on nothing but must land before any EOSY touch in Phase 4; Phase 3 independent; Phase 4 uses helpers from Phase 2 (completeness) and adds 4E (rollover resilience — should land after 2B so stale PENDING rows cannot block the degraded path) and 4F (PM2 config, independent); Phases 5–7 independent of 1–4; Phase 8 after all logic phases (analyzes final line counts); Phase 9 last.

---

## 7. Phase details

### Phase 0 — Baseline and harness

Goal: prove the environment before touching code.

Steps:
1. `git status`; create branch and snapshot commit (Section 2.1).
2. Create `docs/AUDIT_REMEDIATION_RUN_LOG.md` (baseline section: commit sha, date, tool versions) and `docs/AUDIT_REMEDIATION_PUNCHLIST.md` with the E2 header/table skeleton (no entries yet).
3. Create the evidence directory `docs/audit-run/` and capture raw baseline outputs: `phase-0-gsrv.log`, `phase-0-grig.log`, `phase-0-gbld-root.log`, `phase-0-gbld-server.log`, `phase-0-glint.log`, `phase-0-pm2.txt` (`pm2 list` + server error-log tail).
4. Run G-SRV, G-RIG, G-BLD, G-LINT (G-PM2 read-only). Record exact commands + attached log paths in the run log per A2/A5. Do NOT proceed if any gate fails.
5. Verify `smart_test_db` isolation: `pnpm test` output must print `[test-guard] Using isolated test database: smart_test_db`.
6. Record the PM2 baseline rules: expected allowlisted lines and the current `server`/`client` restart counters (Section 5).

Acceptance: baseline matches Section 5 (allowing pre-existing warning count drift); run log + punchlist + evidence dir exist; zero punch entries.

### Phase 1 — Security critical

#### 1A. Attendance ownership (`server/src/routes/attendance.ts`, 523 lines)

Files: modify `server/src/routes/attendance.ts`; add `server/src/__tests__/attendance-ownership-lib.test.ts`.

Design (pin P1):
- Add exported helpers after `assertSectionAttendanceWritable` (line 31):
  - `teacherCanAccessSection(teacherId, sectionId): Promise<boolean>` — true if `Section.adviserId === teacherId`, else true if an active (`isActive: true`, matching `section.schoolYear`) `ClassAssignment` exists for `(teacherId, sectionId)`.
  - `teacherCanAccessStudent(teacherId, studentId, sectionId?)` — set of the teacher's adviser section ids + active assignment section ids; if `sectionId` given and not in set → false; then check an `Enrollment` for `(studentId, sectionId in set)`.
- In every route, when `req.user?.role === "TEACHER"`:
  - resolve `prisma.teacher.findUnique({ where: { userId: req.user.id } })`; missing → 404 `"Teacher profile not found"`.
  - call the helper; false → 403 `"Not authorized for this section"` (student route: `"Not authorized to view this student"`).
  - Placement and call sites:
    - `GET /section/:sectionId` after line 66, before the date 400.
    - `POST /clear` after body destructure (line 146), before `assertSectionAttendanceWritable`.
    - `POST /bulk` after body validation (line 203), before the writable guard.
    - `GET /summary/:sectionId` after line 274.
    - `GET /student/:studentId` after line 345 (pass optional `sectionId` query).
    - `GET /sf2/:sectionId` after line 397.
    - `GET /export/:sectionId` after line 462.
- ADMIN skips all checks; REGISTRAR skips GETs (writes already exclude REGISTRAR via `authorizeRoles`).
- Optional hardening (include): in `/bulk`, reject when any submitted `studentId` is not enrolled in the section (400 `"Attendance contains students not enrolled in this section"`).

Tests (`attendance-ownership-lib.test.ts`, real Prisma, unique names + cleanup): adviser allowed; active-assignment teacher allowed; other teacher denied; `isActive:false` assignment denied; missing section denied; cross-year assignment denied; student in own advisory allowed; student in other section denied; explicit `sectionId` mismatch denied.

Scan: `Select-String attendance.ts -Pattern "teacherCanAccessSection"` appears in all 7 routes.

#### 1B. ECR import guard (`server/src/lib/ecrImport.ts`, `server/src/routes/grades-sub/ecr.ts`)

Files: modify both; add `server/src/__tests__/ecr-import-conflict.test.ts`.

Design (pin P2):
- Export `EcrImportBlockedError extends Error` with `code: "GRADE_FINALIZED"` from `ecrImport.ts` (after the `EcrImportReport` type, ~line 32).
- In `importEcrToGrades`, after `prepared` is built and before the dry-run early return (~line 283), run:
  `prisma.grade.findMany({ where: { studentId: { in: prepared.map(p=>p.studentId) }, classAssignmentId, term, OR: [{status:"FINALIZED"},{isArchived:true}] }, select:{studentId,status,isArchived} })`; if non-empty throw the typed error with counts + message `"...Contact the registrar to unfinalize before importing."`. This also blocks dry-run previews.
- In `ecr.ts`: replace the single-sample lock check (76-86) with `prisma.grade.count({ where: { classAssignmentId, term, isArchived: true } })` feeding `checkGradeEditLocks({..., isArchived: archivedCount > 0})`; wrap the `importEcrToGrades` call (117-124) in try/catch mapping `EcrImportBlockedError` → `403 { code, message }`.

Tests: targeted FINALIZED → rejects + no writes; targeted archived → rejects; non-targeted FINALIZED → succeeds; dry-run + conflict → rejects; DRAFT control → succeeds. No external calls; no rig needed.

#### 1C. Default sync password + teacher upsert (`server/src/lib/enrollproSync.ts`)

Files: modify `enrollproSync.ts` (~lines 1 imports, 213-241, 283); optionally update `server/.env.example` comment (not `.env`); add `server/src/__tests__/enrollproSync-teacher-upsert.test.ts`.

Design (pins P3, P4):
- Import `randomBytes` from `crypto`. Before the teacher loop (~line 214): read `DEFAULT_SYNC_PASSWORD`; `syncPassword = configured ?? randomBytes(32).toString("hex")`; warn once when unset ("new teacher accounts receive random passwords; sign in via EnrollPro or admin reset").
- Line 227: hash `syncPassword` (keep per-user salt; hashing once outside the loop is acceptable).
- Line 235: change the condition to `if (targetUserId) {` (remove the `startsWith('__pending_user__')` filter) so placeholders enter `teacherUpserts`; the existing resolution loop (254-260) fills real ids; the filter at 283 still drops truly unresolved placeholders.

Tests (mock `../lib/enrollproClient` per `aims-sync.test.ts` pattern; real test DB):
- New teacher gets a `Teacher` row in the same sync cycle.
- With `DEFAULT_SYNC_PASSWORD` unset, `bcrypt.compare("password123", hash) === false`; with it set, compare true.
- Pre-existing teacher: hash unchanged, Teacher row updated.

#### 1D. Login limiter (`server/src/routes/auth.ts`)

Files: modify `auth.ts`; add `server/src/__tests__/auth-login-limiter.test.ts`.

Design (pin P5):
- Export `normalizeLoginIdentifier(raw: unknown): string` — non-string/empty → `"unknown"`; else `trim().toLowerCase().slice(0,255)`.
- Key generator: `` `login:${ipKeyGenerator(req.ip || "127.0.0.1")}:${normalizeLoginIdentifier(req.body?.email)}` ``; remove the `username` fallback.
- Reorder the route middleware: `validate(loginSchema)` BEFORE `loginLimiter`.
- Keep window/limit/`skipSuccessfulRequests`/headers unchanged.

Tests: pure unit for `normalizeLoginIdentifier` (null/number/array/object/whitespace/case/oversize); integration optional (unique identifier per run): mixed-case failures share a bucket → 429.

Phase 1 gate: targeted tests → G-SRV → G-BLD → G-LINT → commit.

### Phase 2 — EOSY / promotion integrity

#### 2A. Completeness helper + auto-EOSY guard (`server/src/lib/promotion.ts`, `server/src/routes/registrar/main.ts`, `server/src/routes/registrar/eosy.ts`)

Files: modify `promotion.ts` (add helper after `computeSectionPromotions` ~line 364; extend `finalizeSectionEosy` signature/result), `registrar/main.ts` (auto-EOSY block 1345-1368 + response fields), `registrar/eosy.ts` (error mapping 122-132); modify `src/lib/api.ts` types only if needed (additive); tests: new `server/src/__tests__/promotion-completeness.test.ts`, extend `server/src/__tests__/registrar-finalize-year.test.ts`.

Design (pin P6):
- Add `computeSectionYearCompleteness(sectionId, schoolYear, opts?: {maxGaps?: number})`: loads ENROLLED enrollments, all class assignments (schoolYear only), and all grades; builds required pairs keyed by `(studentId, canonicalSubjectKey(subjectCode, subjectName), term)`; required terms = `T{rotationTermRank}` when `rotationTermGroupId` set and rank 1..3, else T1/T2/T3; skips `isNonPromotional` and `HG*`; missing/non-FINALIZED produce gaps `{studentId, studentName, subjectCode, subjectName, term, reason}` (cap default 50). Returns `{complete, gaps}` or null when the section is absent.
- `finalizeSectionEosy` gains `requireCompleteYear?: boolean` and a new failure `{ok:false, error:"YEAR_INCOMPLETE", gaps}` checked before `DRAFT_BLOCKED`; existing callers unchanged (flag defaults off).
- `registrar/main.ts` auto-EOSY: after `remainingDrafts === 0`, call completeness; incomplete → set `eosySkippedReason = "YEAR_INCOMPLETE"` (log gaps count), do not call EOSY; complete → call `finalizeSectionEosy({..., requireCompleteYear:true})`. Add `eosySkippedReason` to the response body (additive). Catch sets `"ERROR"`.
- `registrar/eosy.ts`: map `SECTION_NOT_FOUND` → 404, `YEAR_INCOMPLETE` → 409 `{ message, gaps }`, then existing 400 `DRAFT_BLOCKED`.

Tests:
- `promotion-completeness.test.ts`: rotations complete with only rank term; transfer case (archived predecessor + active successor for the same canonical subject) is complete; non-promotional/HG never required; `requireCompleteYear` on a gap returns YEAR_INCOMPLETE with **zero** enrollment/snapshot writes.
- Extend `registrar-finalize-year.test.ts`: T1-only section → response `eosyFinalized === false`, `eosySkippedReason === "YEAR_INCOMPLETE"`, `promotionStatus` stays null, `gradeSnapshot.count === 0`; complete fixture → `eosyFinalized === true`.

#### 2B. Stale PENDING remedial rows on re-finalize (`server/src/lib/promotion.ts:559-595`)

Files: modify `promotion.ts`; extend `server/src/__tests__/remedial-reconcile.test.ts`.

Design (pin P7):
- CP branch: compute `failingCodes` (canonical codes produced by `finalizeSubjectRows`).
- Refresh never-conducted rows for still-failing subjects (`subjectName`, `originalGrade`, `gradeLevel`) via `updateMany`.
- Keep the existing `createMany({skipDuplicates:true})` for failing subjects.
- Delete never-conducted PENDING rows whose `subjectCode` is not in `failingCodes` (count into `remedialRowsCleared`).
- Count data-entered (`remedialMark`/`conductedFrom`/`conductedTo`) stale rows into a new `remedialRowsFlagged` (add `let` next to `remedialRowsCleared` ~line 499; return it). Update `registrar/eosy.ts` audit/message additively.
- Never touch COMPLETED rows; never run when `failingCodes` is empty.

Tests: still-CP two failing subjects, fix one → exactly one pending row remains and `remedialRowsCleared === 1`; originalGrade refresh; data-entered row survives + `remedialRowsFlagged === 1`; rotation merged TLE stale delete + preserve; existing PROMOTED-branch tests stay green.

Phase 2 gate: targeted tests → G-SRV → G-BLD → G-LINT → commit.

### Phase 3 — Write-path integrity

#### 3A. Sync coordinator lock (`server/src/lib/syncCoordinator.ts`)

Files: modify `syncCoordinator.ts` (~140-260, 463-470); add `server/src/__tests__/sync-coordinator-lock.test.ts`.

Design (pin P8): claim `syncRunning = true` immediately after the overlap check (before `checkCriticalDependencies`); wrap the entire body in one outer `try/finally` that resets `syncRunning` and invalidates caches only for steps that ran; remove the old inner `finally` and the later `syncRunning = true`; preserve skipped-result and all early-return shapes, broadcasts, history persists.

Tests (mocked prisma + modules, `vi.resetModules()` because the flag is module state): two concurrent calls with a deferred dependency check → EnrollPro step runs once, second returns skipped; a throwing cycle resets the flag.

#### 3B. Guarded grade writes (`server/src/routes/grades-sub/helpers.ts`, `classes.ts`)

Files: modify `helpers.ts` (new exported helper), `classes.ts` (single ~537-552; batch 754-833; response/audit 835-859); add `server/src/__tests__/grade-write-race.test.ts`.

Design (pin P9):
- Helper `applyGuardedGradeWrite(db, unique, payload, opts?)`:
  `updateMany({where:{...unique,status:"DRAFT",isArchived:false},data:payload})`; `count>0` → return the row; else `findUnique`: archived → `{ok:false,code:"ARCHIVED", message:"Cannot edit archived grades. This school year has been finalized."}`; `LOCKED` → `{ok:false,code:"LOCKED"}`; `FINALIZED` → `{ok:false,code:"FINALIZED", message:"Grade is finalized and cannot be edited. Contact registrar to unfinalize."}`; missing → `create` (unless `allowCreate:false`).
- Single: call helper on the global client; on `P2002` (create race) retry once with `allowCreate:false` **outside any transaction** (Postgres aborts txs on constraint errors). Return 403 with the existing `message` (and `code` when ARCHIVED) → `res.json(grade)` unchanged.
- Batch: inside one `$transaction` (`{timeout:15000}` if needed): `findMany` authoritative rows; for missing rows `createMany({skipDuplicates:true})` then re-read; per update check current archive/status (append to `skipped` with reasons `"Grade is archived"`, `"Grade is finalized"`, `"Grade row unavailable"`), `updateMany({where:{id,status:"DRAFT",isArchived:false}})`; count 0 → re-read and skip; accumulate `Prisma.GradeSnapshotCreateManyInput` using the same field list as the single-save snapshot (including rotation/QA fields) and one `gradeSnapshot.createMany` at the end. Response `{savedCount, skipped}` with real counts; audit metadata uses real count.
- Extract the shared batch payload builder if it reduces duplication; keep lock checks outside the tx (fast path) with the in-tx checks authoritative.

Tests: FINALIZED single → 403 + unchanged; archived single → 403; batch mix → `savedCount===1`, correct `skipped` reasons, snapshot count +1 with the written grade; finalize-then-batch → skipped.

#### 3C. completeRemedial transaction (`server/src/lib/remedial.ts:57-139`)

Files: modify `remedial.ts`; add `server/src/__tests__/remedial-complete.test.ts`.

Design (pin P10): move read/validate/compute into `prisma.$transaction(async tx => {...}, {timeout:30000})` with `await tx.$queryRaw\`SELECT id FROM "Enrollment" WHERE id = ${enrollmentId} FOR UPDATE\`` first; re-read enrollment + PENDING rows; throw the exact existing error strings; perform row updates and enrollment update inside; audit post-commit with the same payload shape. `retentionOverride`/conducted dates behavior unchanged.

Tests: MISSING_RCM prefix; non-CP; no-pending; concurrent `Promise.allSettled` completes exactly once; post-commit marks/status/audit assertions.

#### 3D. syncBackSubjects transaction + RETAINED placement (`server/src/lib/remedial.ts:240-481`)

Files: modify `remedial.ts`; extend `remedial-reconcile.test.ts` or add `remedial-sync-tx.test.ts`.

Design (pin P11): per learner, run one `$transaction` (timeout 15000) around the enrollment status write + remedial row writes; re-read the enrollment inside; RETAINED → set `promotionStatus:"RETAINED"` AND `promotedToGradeLevel: remedialGradeLevel`, keep existing `deleteMany`; CP → tag and `upsert` per failing subject on `enrollmentId_subjectCode`; try/catch outside the tx per learner so one failure does not abort the whole sync. Keep counters and friendly messages; no N+1 change required beyond removing the pre-loop `findUnique` race (optional batching may remain).

Tests: 3+ failures → RETAINED + repeat grade + no rows; 1–2 failures → CP rows; run twice → idempotent; one learner's injected failure doesn't stop the rest.

#### 3E. AIMS import transaction hygiene (`server/src/lib/aimsImport.ts`)

Files: modify `aimsImport.ts`; extend `aims-sync.test.ts`.

Design: keep one data transaction with `{maxWait: 10_000, timeout: 120_000}`; collect snapshot/audit payloads during the tx and run `createGradeSnapshot`/`createAuditLog` post-commit (best-effort, failure-swallowing semantics unchanged). Do not pass `createAuditLog` a tx. Optional: add an optional `db` param to `createGradeSnapshot` only if the team prefers atomic snapshots; default plan is deferral.

Tests: spy on `$transaction` options; 25-student import completes with one snapshot per committed grade, no orphan snapshot `gradeId`; calls occur after tx resolution.

Phase 3 gate: targeted tests → G-SRV → G-BLD → G-LINT → commit.

### Phase 4 — Registrar/admin correctness

#### 4A. unfinalize-grades invalidates EOSY (`server/src/routes/registrar/main.ts:1392-1459`)

Design (pin P12): before flipping grades, count FINALIZED rows for the target; if >0 call `unfinalizeSectionEosy({sectionId, schoolYear: schoolYearLabel, actor})`. Map: `SECTION_NOT_FOUND` → 404; `HAS_COMPLETED_REMEDIAL` → 409 `{code, completedCount, message}` before any write; `NOT_FINALIZED` → proceed (no-op). Response additively includes `eosyUnfinalized`, `deletedSnapshots`, `deletedRemedial`. Keep the existing section lock key.

Tests: finalized grades + EOSY snapshots → unfinalize removes snapshots/promotion/remedial; with a COMPLETED remedial row → 409 and grades untouched; non-promotional subject path still works (EOSY invalidation is conservative; acceptable).

#### 4B. Enrollment status guard (`registrar/main.ts:1241-1273`)

Design (pin P13): 404 when missing; 409 `ENROLLMENT_YEAR_LOCKED` when `isArchived` or `schoolYear !== getActiveSchoolYearLabel()`; audit `UPDATE` with previous/new status + schoolYear. (Optionally null drop/transfer fields when returning to `ENROLLED` — include only if type-safe.)

Tests: active-year update + audit row exists; archived/other-year → 409 + unchanged.

#### 4C. Suspension transaction (`server/src/routes/admin-sub/users.ts:370-388`)

Design (pin P14): one `$transaction` for user update + refresh token delete + assignment archival; scope assignment archival with `schoolYear: await getActiveSchoolYearLabel()`. Audit stays post-transaction.

Tests: current-year assignment archived, old-year untouched, tokens deleted, status SUSPENDED; forced failure rolls back.

#### 4D. Advisory historical filter (`server/src/routes/advisory.ts:341-345`)

Design (pin P15): remove `isActive: true` from that query only. Confirm downstream dedup (subjectDedupKey/gradeSignalScore) handles archived predecessor rows.

Tests: route-level historical-year test with `isActive:false` CA still returns subject + grade.

Phase 4 gate: targeted tests → G-SRV → G-BLD → G-LINT → commit.

#### 4E. Rollover resilience when EnrollPro initiates the rollover

Problem: `archiveYearInTx` (lib/rollover.ts:151-166) hard-errors on pending remedial; `handleYearChangeRollover` therefore throws, and `schoolYearResolver.ts:166-210` reverts the active year ("Active-year revert") and throws into the sync cycle. If EnrollPro has already moved to a new year, SMART stays stuck on the old year, retries every sync, and logs a rollover-failure audit every cycle. Conversely, the manual path should still refuse to archive uncleanly.

Files: modify `server/src/lib/rollover.ts` (RolloverResult + pre-archive gate + keep in-tx guard), `server/src/routes/registrar/main.ts` (rollover-status), `server/src/routes/admin-sub/system.ts` (message), `server/src/routes/registrar/remedial.ts` only if needed for the rollover-block endpoint (unchanged); tests: extend `server/src/__tests__/rollover-lib.test.ts`, extend `server/src/__tests__/remedial-reconcile.test.ts` (or new `remedial-rollover-guard.test.ts`), extend `e2e/offline/specs/offline-zz-rollover.spec.ts` or add `offline-rollover-remedial.spec.ts`; extend `server/scripts/seed-offline-fixtures.ts` with one synthetic CP+PENDING learner (see tests).

Design (pins P25, P26):
- Add a helper `countPendingRemedialLearners(yearLabel): Promise<number>` (in `lib/remedial.ts`, next to `getRemedialRolloverBlock`) returning the number of enrollments in that year with `promotionStatus: "CONDITIONALLY_PROMOTED"` and a `PENDING` remedial row.
- In `handleYearChangeRollover`, before the archive decision (same transaction, after `listUnfinalizedSections`): if `unfinalized.length === 0` and pending count > 0 → return `{ action: "locked_not_archived", pendingRemedialCount: n, blockReason: "pending_remedial" }`. Do not call `archiveYearInTx`. Keep the existing `setYearLock(previousYearId, true)` fail-safe so the outgoing year is locked. Post-transaction audit + SSE reuse the existing blocked-rollover branches and add the reason/count to the payload.
- Extend `RolloverResult` with `blockReason?: "unfinalized" | "pending_remedial"` and `pendingRemedialCount?: number` (additive).
- `archiveSchoolYear` (manual) and `archiveYearInTx` keep the hard guard: before archiving, if pending count > 0 return `{ ok:false, error: "N learner(s) still have pending remedial classes. Complete remedial before archiving." }` (do not change the existing message text; tests may pin it). Keep the in-tx guard as defense-in-depth.
- `admin-sub/system.ts` year-switch branch: on `locked_not_archived`, unlock the previous year (existing) and return 400 with a message that distinguishes reasons: `blockReason === "pending_remedial"` → "... N learner(s) have pending remedial classes in <prev>. Complete remedial before switching."; else the existing unfinalized message.
- `registrar/main.ts` `/rollover-status`: add `pendingRemedialCount` + `pendingRemedialStudents` (lrn, name, grade, pendingSubjects; cap 20) using `getRemedialRolloverBlock(previousYear.label)`; `canArchive` must also require `pendingRemedialCount === 0`.
- `getRemedialRolloverBlock`/`GET /registrar/remedial/rollover-block` behavior unchanged (EnrollPro contract).

Tests:
- Backend (rollover-lib): outgoing year with one CP+PENDING learner → `handleYearChangeRollover` returns `action: "locked_not_archived"`, `blockReason: "pending_remedial"`, `pendingRemedialCount: 1`; new year is active in settings; outgoing year `status !== "ARCHIVED"`; its enrollments/class assignments are NOT archived; year lock applied; then complete the remedial (or delete the pending row) and call `handleYearChangeRollover` again → `action: "archived"` with all archive writes. Same fixture → `archiveSchoolYear` returns `ok:false` with the remedial error.
- Registrar rollover-status: `pendingRemedialCount` 1, `canArchive:false`, learner listed; after completion → `canArchive:true` (assuming no unfinalized/gaps).
- Rig: extend `seed-offline-fixtures.ts` to create one synthetic CP enrollment + one PENDING remedial row in the fixture year (unique LRN, e.g. `99000000100`, name `Rig Remedial`). Run the whole rig; fix any count-sensitive specs that the new learner legitimately affects. In the rollover spec (extend `offline-zz-rollover.spec.ts` or add a sibling spec that reuses its `setMode`/`switchStubYear` helpers): after SMART converges on `2090-2091`, call registrar `GET /api/registrar/rollover-status` and assert `pendingRemedialCount >= 1` and `canArchive === false`; then complete remedial for the old-year enrollment via the registrar API (or direct `PATCH`/`POST complete` with an RCM) and assert a subsequent rollover-status (or sync retry) reports `canArchive === true`. If completing via API is not reachable in the rig, assert only the locked/not-archived + status contract and leave completion to the backend test (fallback path, record in the run log).

Gate: targeted tests → G-SRV → G-RIG → G-BLD → G-LINT → G-LOG (scan for absence of `Rollover handling failed` / `Active-year revert` in rig output for this scenario) → commit.

#### 4F. PM2 client supervisor fix (config-only)

Problem (verified now): `ecosystem.config.cjs` defines `client` as `scripts/wait-for-server.cjs`, which `spawn`s Vite as a child and exits when the child exits; PM2 records the wrapper as the app and restarts it constantly (1500 restarts observed). This can leave multiple Vite instances and masks real client errors.

Files: modify `ecosystem.config.cjs` only (script `client` → run Vite directly: `script: './node_modules/vite/bin/vite.js'`, `args: '--host'`, `cwd: '.'`, `interpreter: 'node'`, keep `autorestart: true`). Do not touch `scripts/wait-for-server.cjs` (kept for `npm run dev`-style usage elsewhere) and do not change `server`.

Gate: config-only; no code tests. With `AUDIT_ALLOW_PM2_RELOAD=1`: `pm2 reload client` (or `pm2 delete client && pm2 start ecosystem.config.cjs --only client` — prefer reload), then `pm2 list` shows `client` restart count stable (`↺` unchanged) for at least 60 s, `curl http://localhost:5173` returns the SPA, and `client-error.log` gains no new errors. Without the flag: implement the config change, note it in the run log as "pending reload", and skip the runtime verification (do not disturb the live demo).

Phase 4E/4F gate: targeted tests → G-SRV → G-RIG → G-BLD → G-LINT → G-LOG → commit (each separately).

### Phase 5 — Frontend critical

#### 5A. Score queue class binding (`src/pages/teacher/hooks/useScoreWriteQueue.ts`, `src/pages/teacher/ClassRecordView.tsx`)

Design (pin P17):
- Extend `QueuedScoreEdit` with `classAssignmentId`, `qaMeta`, `applyMetaToScores`; include the class id in the enqueue dedup key; `enqueue` no-ops without a class id.
- `runFlush` groups by `classAssignmentId|term|studentId`; reads cache and builds payload from the edit's own class/term/meta (never `optsRef`). When the old class cache is missing, fetch `gradesApi.getClassRecord(classAssignmentId, term)` once, store it, then proceed.
- Add a change/detection effect: on `opts.classAssignmentId` change, `void flushNow()` (saves old edits to the OLD class). Do not discard or remap. Unmount cleanup keeps its behavior (now correct).
- `ClassRecordView`: reset `termInitialized` when `classAssignmentId` changes; init the term only when `classRecordQuery.data?.classAssignment?.id === classAssignmentId`; apply rotation rank term else `currentTerm`. Optional: early-return edits while `isPlaceholderData`.

Tests: new `e2e/offline/specs/score-queue.spec.ts` — intercept two class-record endpoints + `/grades/grade`; edit A then navigate to sibling B before debounce; assert payloads only ever carry class A's id for A's edit; B opens on its own term.

#### 5B. Logout revocation + cache clear (`src/lib/session.ts` new, three layouts, `src/lib/api.ts`, login pages)

Design (pin P18):
- New `src/lib/session.ts`: per-portal key map; `clearPortalSession(role)` removes only that portal's keys + legacy `user`/`token`; `logoutPortal(role, queryClient?)` races `authApi.logout()` against a 3 s timer, always clears local state + `queryClient.clear()` in `finally`, returns the portal login path.
- Wire all three layouts: `useQueryClient()`, disable the sign-out button while logging out, navigate to the returned path.
- `authApi.logout`: send `x-refresh-token` from `getPortalRefreshToken()` when present (additive header).
- Server `auth.ts` logout: prefer `req.headers["x-refresh-token"]` over the cookie (mirror refresh precedence).
- Login pages (teacher/admin/registrar/SSO): call `queryClient.clear()` after storing tokens, before navigation.

Tests: new `e2e/offline/specs/logout.spec.ts` — logout POST observed with auth header; storage cleared; captured refresh token rejected by `/auth/refresh` (401) after logout; failure/timeout path still logs out locally; admin/registrar variants land on their own login paths.

#### 5C. SSE refresh loop (`src/hooks/useSyncStream.ts`)

Design (pin P19): derive portal via `getPortalRole()`; on 403 refresh with `POST AUTH_REFRESH_URL` and `x-refresh-token` header; store `data.token`/`data.refreshToken` under portal keys (`getTokenKey`/`getRefreshTokenKey`); on success abort the failed reader, `skipReconnect = true`, reset backoff, reconnect immediately (no duplicate scheduled reconnect); on failure navigate to `getPortalLoginPath(portal)`. Guard the `finally` reconnect with `skipReconnect`. Preserve backoff constants and public hook behavior.

Tests: new `e2e/offline/specs/sse-refresh.spec.ts` — 403 → refresh called with the captured refresh token → token stored under `token_<portal>`; no redirect; admin failure redirects to `/login/admin`.

Phase 5 gate: G-RIG (includes new specs) → G-BLD → G-LINT → targeted spec re-run → commit.

### Phase 6 — Frontend robustness

#### 6A. Attendance API + error paths (`src/lib/attendanceApi.ts` new; `src/pages/teacher/Attendance.tsx`)

Design: move all raw axios calls to a small interceptor-aware `attendanceApi` (getAdvisory/getSection/getSummary/getStudentRecords/saveBulk/clear/exportMonth). Add sequence refs for `fetchAttendance` + `fetchMonthlySF2Stats`; drop stale responses (including inner absence checks). `saveAttendance` returns `boolean`; `saveAndNextDay` only advances on `true`. `confirmClear` resets UI only after a successful delete; error message from the server preserved. Payload uses `attendanceData.section.id`/`date`. Keep all date math untouched.

Tests: `e2e/offline/specs/attendance-errors.spec.ts` per the investigation (save 500 → date unchanged + error; save 200 → success; clear 500 → roster unchanged; clear 200 → reset; race optional).

#### 6B. Error boundary (`src/components/RouteErrorBoundary.tsx` new; `src/App.tsx`)

Design (pin P22): class component with `getDerivedStateFromError`/`componentDidCatch`; resets when `resetKey={location.key}` changes while in error; fallback uses design tokens (`bg-destructive/10`, `text-destructive`, `text-muted-foreground`) with "Try again" + "Reload"; mount wrapping `<Suspense>` inside a small `AppRoutes` using `useLocation`. Keep < 100 lines.

Tests: `e2e/offline/specs/ui-hardening.spec.ts` — abort a lazy page chunk / module, assert fallback, navigate away → reset.

#### 6C. Pagination clamp (`src/components/data-table/usePagination.ts`)

Design (pin P21): compute `effectivePage = min(page, totalPages)`; use it in `slice`; add an effect clamping state when `totalPages` shrinks; return `page: effectivePage`. Do not reset to page 1 on every filter change; callers unchanged.

Tests: `ui-hardening.spec.ts` — page 2 then search that yields 1 row → row visible + footer "Showing 1 to 1 of 1".

#### 6D. Dashboard stale polls (`src/pages/registrar/Dashboard.tsx`, `src/pages/admin/Dashboard.tsx`)

Design (pin P20): add `staleError`; silent poll failures set it and keep data; render guard becomes `if (!dashboard)` / `if (!data)`; show a `role="status"` amber banner; clear on success. Keep intervals.

Tests: `ui-hardening.spec.ts` with `page.clock` — fast-forward polls with a 500 → data still visible, no full-page error, banner present.

#### 6E. RemedialTracker stat + race (`src/pages/registrar/RemedialTracker.tsx`)

Design: `completed` requires `remedialClasses.length > 0 && every(...)`; add per-loader sequence refs for `load`/`loadHistory`, re-checking after every await (including the auto-sync retry) before setting state.

Test: extend `ui-hardening.spec.ts` or manual only; at minimum assert no crash and stats consistent via intercepted data (optional).

#### 6F. AuditLogs SSE (`src/pages/admin/AuditLogs.tsx`)

Design: `filtersRef` holds current filters/search; strip them from the EventSource effect deps (`[]` for the stream); wrap `JSON.parse` in try/catch (skip counters on malformed); keep reconnect backoff.

Test: optional; assert via Playwright that typing in search does not open a second `/logs/stream` request (count network calls).

Phase 6 gate: G-RIG → G-BLD → G-LINT → commit.

### Phase 7 — A11y + targeted design hygiene

1. `src/components/common/SyncProgressModal.tsx`: rebuild on `Dialog`/`DialogContent`/`DialogTitle`/`DialogDescription` (sr-only title/description), controlled `open`, close blocked while `status === "syncing"`, preserve inner markup and `showCloseButton={false}`. All six call sites unchanged.
2. Add `aria-label` to `src/layouts/TeacherLayout.tsx:208-213` ("Close sidebar") and `:321-332` ("Toggle sidebar"); `aria-label` + `aria-pressed` to `src/pages/teacher/ClassRecordsList.tsx:454-469` ("Grid view"/"List view").
3. Replace dynamic Tailwind color classes in `src/pages/teacher/Attendance.tsx` (the template-literal `bg-${color}-*`/`text-${color}-*` usages) with explicit static class maps so JIT generates them. Keep visuals identical.

Tests: add assertions to `ui-hardening.spec.ts` or new `a11y.spec.ts`: `getByRole("dialog")` on sync modal; `getByLabelText` for the three buttons; Escape ignored while syncing, closes after.

Phase 7 gate: G-RIG → G-BLD → G-LINT → commit.

### Phase 8 — File-size compliance (mechanical moves only)

Rule: pure move/rename; no logic edits; each new file < 1000 lines; all imports adjusted; gates after EACH split.

Current violators (physical line counts): `server/src/routes/registrar/main.ts` 2056; `server/src/lib/enrollproSync.ts` 1439; `server/src/lib/enrollproClient.ts` 1400; `server/src/routes/grades-sub/classes.ts` 1304; `server/src/routes/admin-sub/system.ts` 1024; `src/lib/api.ts` 2295; `src/pages/teacher/Dashboard.tsx` 1080.

Order (highest-value first), each as its own commit:

8A. **`src/lib/api.ts` → `src/lib/api/` barrel** (design already mapped):
- `client.ts` (lines 1–175, axios + interceptors + token/portal helpers + `SERVER_URL` + `getCsrfToken`; keep interceptor closure state together; `export default api` + named `api`).
- `types.ts` (178–357); `grades.ts` (371–683); `advisory.ts` (685–839); `registrar.ts` (841–1682); `schedule.ts` (1684–1810); `admin.ts` (1812–2293 + publicSettingsApi + adminApi).
- Barrel `src/lib/api.ts` re-exports all modules + `export { default } from "./api/client"`. 84 importers / 93 import statements unchanged. Use `import type` for type-only cross-module imports (`verbatimModuleSyntax`).

8B. **`server/src/routes/registrar/main.ts`** — extract route groups into `routes/registrar/` submodules registered from `registrar.ts` (aggregator exists): e.g. `finalizeGrades.ts` (1276–1461 + finalize-status 1462–1649), `students.ts` (584–1003), `studentRecords.ts` (1650–2000), `enrollmentStatus.ts` (1241–1275), `sync.ts` (494–583 + 731–769), leaving `main.ts` with dashboard/rollover-status/school-years/alumni/sections. Aim: every resulting file < 1000 lines. Move helpers verbatim; export shared utility functions if two modules need them. If a target still exceeds 1000, split further along the route boundaries.
8C. **`server/src/routes/grades-sub/classes.ts`** — extract the guarded-write/helper payload builders and route groups into `grades-sub/` submodules (e.g., `gradeWrite.ts`, `gradeBatch.ts`, `clearScores.ts`) wired from `grades.ts`.
8D. **`server/src/lib/enrollproSync.ts`** — extract teacher/user sync (~145–430) and transferee sync (1207–end) into `lib/sync/` modules; keep `runEnrollProSync` as a thin orchestrator.
8E. **`server/src/lib/enrollproClient.ts`** — split by API area (teachers/learners/sections/remedial/auth) into `lib/enrollpro/` files re-exported by `enrollproClient.ts`.
8F. **`server/src/routes/admin-sub/system.ts`** — extract settings vs year-lock vs rollover-status handlers if still > 1000.
8G. **`src/pages/teacher/Dashboard.tsx`** — extract the honors section + micro-metric hero + class-card list into `pages/teacher/components/` files.

After each split: `git grep` for the moved symbols to confirm import sites updated; run G-SRV + G-RIG + G-BLD + G-LINT. Any split that cannot be made green within 3 iterations is reverted and deferred with a note (the line-count rule still applies to all NEW files).

### Phase 9 — Full verification, runtime sweeps, and report

1. Run the complete gate suite: G-SRV, G-RIG, G-BLD, G-LINT (and `pnpm run typecheck`).
2. **Playwright portal sweep** (P28): add and run `e2e/offline/specs/portal-sweep.spec.ts` (Section 4.4). It must finish with zero unallowlisted console errors, `pageerror`s, or API >= 400. Re-run the whole G-RIG suite; all specs (baseline 9 + phase specs + sweep) pass.
3. **Rollover drill** (EnrollPro-initiated): run the extended S3 spec plus the Phase 4E spec; assert SMART converges on the new year AND the outgoing year is `locked_not_archived` with `pendingRemedialCount` reported; assert no `Rollover handling failed` / `Active-year revert` appear in the captured server output. Capture the relevant log lines in the run log as evidence.
4. **PM2 smoke (gated, P27)**: only if `AUDIT_ALLOW_PM2_RELOAD=1`: `pm2 reload server` → wait for `/api/health` → read-only GET smoke (`/api/health`, `/api/admin/settings/public`) → scan `pm2 logs server --nostream --lines 300` for 2 minutes for NEW error signatures vs baseline. Never run authenticated write flows against live data. If the flag is unset, record "PM2 smoke deferred (no reload signal)".
5. Verify every phase's targeted tests exist and pass; verify the run log lists commit SHAs.
6. Re-run the audit's static checks that the fixes should have changed:
   - `attendance.ts` has ownership checks on all 7 routes.
   - `ecrImport.ts` throws the typed error; `ecr.ts` maps it.
   - `overallPassingRate` denominator/numerator consistency unchanged.
   - `Select-String "password123"` only in `.env.example` comments/tests.
   - `Select-String "sessionStorage.setItem('token'"` gone from SSE.
   - `Select-String "isActive: true" -- advisory.ts` only in current-year routes.
   - `handleYearChangeRollover` returns `locked_not_archived` (not throw) for pending remedial; `archiveSchoolYear` still errors.
   - All files < 1000 lines (`Get-ChildItem -Recurse` line count sweep).
7. **Punch-list review and export**: reopen every entry in `docs/AUDIT_REMEDIATION_PUNCHLIST.md`; every item must have a terminal status or an explicit `DEFERRED` with a next-action recommendation. Any `BLOCKER`/`HIGH` item still `OPEN` at the end is called out at the top of the final report. No item may be deleted.
8. Update `docs/AUDIT_REMEDIATION_RUN_LOG.md` with the final summary: phase statuses, commits, gate outputs, runtime-sweep evidence, punch-list export, deferred items, and any follow-ups discovered.
9. Leave the `audit-remediation` branch checked out; do not merge/push.

---

## Appendix A — Findings traceability

| Finding (severity) | Evidence | Phase |
|---|---|---|
| Attendance IDOR (CRITICAL) | routes/attendance.ts:16-31,59-521 | 1A |
| ECR overwrites FINALIZED/archived (CRITICAL) | lib/ecrImport.ts:326-330; routes/grades-sub/ecr.ts:76-86 | 1B |
| Default sync password (CRITICAL) | lib/enrollproSync.ts:227 | 1C |
| New teachers never get Teacher row (HIGH) | enrollproSync.ts:235,254-260,283 | 1C |
| Login limiter key from raw body (MEDIUM) | routes/auth.ts:31-38 | 1D |
| Auto-EOSY mid-year (HIGH) | registrar/main.ts:1351-1365; promotion.ts:122-125,341-342 | 2A |
| Stale PENDING rows on re-finalize (HIGH) | promotion.ts:559-595; rollover.ts:154-166 | 2B |
| Sync coordinator TOCTOU (HIGH) | syncCoordinator.ts:145-157,188,247 | 3A |
| Grade write check-then-upsert race (HIGH) | classes.ts:404-411,537,741-751,816 | 3B |
| Batch writes no GradeSnapshots (MEDIUM) | classes.ts:754-833 vs 558-583 | 3B |
| completeRemedial untransactional (HIGH) | remedial.ts:57-139 | 3C |
| syncBackSubjects non-tx + RETAINED field (HIGH) | remedial.ts:397-459 | 3D |
| aimsImport out-of-tx snapshots/long tx (MEDIUM) | aimsImport.ts:245-436; helpers.ts:363 | 3E |
| unfinalize-grades leaves EOSY state (HIGH) | registrar/main.ts:1420-1431; promotion.ts:602-666 | 4A |
| Enrollment status unguarded/unaudited (MEDIUM) | registrar/main.ts:1241-1273 | 4B |
| Suspension multi-write (MEDIUM) | admin-sub/users.ts:370-388 | 4C |
| Advisory historical isActive (MEDIUM) | advisory.ts:341-345 | 4D |
| Score queue wrong class (CRITICAL) | hooks/useScoreWriteQueue.ts:46-56,147-152; ClassRecordView.tsx:128-135 | 5A |
| Logout no revocation (CRITICAL) | layouts; lib/api.ts:366; routes/auth.ts:476-526 | 5B |
| SSE refresh loop (HIGH) | hooks/useSyncStream.ts:97,117-135 | 5C |
| Attendance errors lie (HIGH) | pages/teacher/Attendance.tsx:290-353 | 6A |
| No error boundary (MEDIUM) | App.tsx; ClassRecordsList.tsx:344-349 | 6B |
| Pagination raw page slice (MEDIUM) | data-table/usePagination.ts:28-54 | 6C |
| Poll errors blank dashboards (MEDIUM) | registrar/Dashboard.tsx:330-394; admin/Dashboard.tsx:115-146 | 6D |
| Remedial stat/race (MEDIUM) | RemedialTracker.tsx:216-218,130-136 | 6E |
| AuditLogs SSE reconnect/parse (MEDIUM) | AuditLogs.tsx:136,188 | 6F |
| A11y dialog/icon buttons (LOW) | SyncProgressModal.tsx:63-80; TeacherLayout.tsx:208-213,321-332; ClassRecordsList.tsx:454-469 | 7 |
| Dynamic Tailwind classes (LOW) | pages/teacher/Attendance.tsx dynamic `bg-${...}` | 7 |
| Files > 1000 lines (rule) | api.ts 2295; registrar/main.ts 2056; etc. | 8 |
| **EnrollPro rollover + pending remedial gets SMART stuck (CRITICAL operational)** | rollover.ts:151-166; schoolYearResolver.ts:166-210; admin-sub/system.ts:243-269 | 4E |
| Registrar rollover-status blind to remedial blockers (MEDIUM) | registrar/main.ts:447-491 | 4E |
| PM2 `client` restart loop / supervisor defect (ops) | ecosystem.config.cjs:21-27; `pm2 list` 1500 restarts | 4F |

## Appendix B — Quality backlog (no fix in this run)

Counts from the audit (in-scope src/): `text-gray-*` 259, `text-slate-*` 188, `text-zinc-*` 4, `bg-blue-600` 2, `space-y-8` 1, `font-black` 4, inline `style` color ~148 (many theme-driven and allowed). Lint warnings 1147 (mostly `no-explicit-any`). These are cosmetic/consistency items; a future design-token sweep should exclude `components/ui/*` shadcn primitives and ThemeContext-driven colors.

## Appendix C — Explicit deferrals

- `sectionLock` process-safety: documented only (P16). Advisory-lock upgrade is backlog.
- Login limiter spray bound (optional extra IP limiter): backlog.
- `StudentRecords.tsx` / `SchoolForms.tsx` SY-switch races and silent form fetch failures: backlog (same pattern as fixed pages; add when touched).
- `EOSYFinalization.tsx` UI surfacing of completeness gaps beyond the server error message: backlog.
- Anything not resolvable inside a phase goes to `docs/AUDIT_REMEDIATION_PUNCHLIST.md` with status/next action (E4/E6); deferred punch items are the authoritative follow-up list after the run.
- Live-API test files remain gated behind credentials/`SMART_LIVE_API`; they are never part of the gates.
- Snapshot-gap archive guard on the auto-rollover path keeps its existing hard-revert behavior (pinned by `rollover-lib.test.ts` T8); Phase 2A + 4E substantially reduce the chance of it firing. Degrading it to `locked_not_archived` is a follow-up that requires re-pinning those tests.
- PM2 smoke is read-only; authenticated write flows against live data are never run (G-PM2 covers health + logs only).
- Frontend `Dashboard.tsx` (teacher, 1080 lines) content refactors beyond the needed hero/stat edits: covered by Phase 8G only for size.

## Appendix D — Gate expectations quick reference

| Gate | Expected | Failure handling |
|---|---|---|
| G-SRV | 0 failed; passed count ≥ baseline | fix within phase; 3 strikes → revert phase |
| G-RIG | 9+ phase specs pass | same |
| G-BLD | exit 0 both projects | same |
| G-LINT | 0 errors | same |
| G-LOG | no unallowlisted error signatures in captured server output | same |
| G-PM2 | no NEW `"level":"error"`/rollover-revert lines vs baseline (read-only) | same |
| Scan greps | old pattern absent | same |
| A9 self-audit | checklist complete, evidence attached | phase cannot commit without it |
| Punch list | every error has an entry + terminal status | phase cannot be PASS with OPEN BLOCKER/HIGH (E4) |
| Portal sweep | 0 console/page/API errors | same |
| Rollover drill | SMART converges; outgoing year locked_not_archived; no revert logs | same |

End of plan.
