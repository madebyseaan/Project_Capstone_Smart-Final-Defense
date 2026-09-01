# Rollover Fix — Correction Plan (Post-Audit Round 2)

> **Status:** PLANNING ONLY — do not treat code snippets as final implementation.
> **Date:** 2026-08-31
> **Context:** The first execution round (`ROLLOVER_FIX_EXECUTION_REPORT.md`, branch `rollover/readiness-fixes`, 12 commits) was audited. The architecture is correct and builds/tests pass, but the audit found **2 architectural defects, 1 security leak, and missing test coverage** that the report claimed was done. This plan corrects them.
> **Executor:** Hand-off for implementation agent. Complete phases in order.
> **Base document:** `docs/ROLLOVER_READINESS_FIX_PLAN.md` (original R1–R14 specs — still authoritative).
> **Audit findings:** owner-verified on 2026-08-31; every location below was re-checked against source at the listed line numbers.

---

## 1. Verdict & Objective

**The branch is NOT merge-ready.** Correct the following so that:

1. Auto-rollover and manual archive execute the **same** archive core (including the snapshot-gap check) — no duplicated write blocks.
2. A failed archive transaction **throws** so the existing FK-revert in `schoolYearResolver.ts` fires → self-healing retry actually works.
3. No credentials exist in the repo or its diffs.
4. The original test matrix (T1–T11) exists for real: seeded, deterministic, no vacuous early-return skips.
5. The execution report is regenerated truthfully, and R3 has its Playwright verification.

**Global Definition of Done (after EVERY phase):**
```powershell
# Frontend (repo root)
npm run build

# Backend (server/)
npm run build
npm test            # twice — second run catches state leakage
npm test

# Runtime
pm2 restart all     # wait ~15s
pm2 list                                                    # both online
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health   # 200
pm2 logs --lines 150 --nostream                             # no new errors
```

---

## 2. Ground Rules (inherited — unchanged)

All rules from the original plan §2 and the handoff prompt apply. Repeated highlights:

- Do NOT modify `.env` / `.env.*`. Do NOT write to external systems. Touch only files listed in §6.
- **No destructive UI actions** via Playwright — backend behavior verified through tests only.
- One commit per issue: `C<n>: <summary>`. Branch stays `rollover/readiness-fixes`. Never push, never touch `main`.
- Tests must never depend on wall-clock years — seed labels like "2098-2099" / "2099-2100".
- Never weaken or delete an assertion to make a suite pass.

---

## 3. Audit Summary — Verified State of the Branch

| Area | Verdict |
|---|---|
| R1 advisory lock in transaction + idempotency guard | ✅ correct |
| R2 hardcoded years removed (backend 503 + frontend empty state) | ✅ correct |
| R3 banner show-once-per-year + `rolloverBannerLastSeenYear` | ✅ code correct; ⚠️ never verified via Playwright as required |
| R4 shared `archiveSchoolYear()` | ⚠️ exists and admin endpoint uses it — **but auto path does NOT** (see C1) |
| R5 fail-safe lock-first | ✅ correct |
| R5 FK revert / self-healing retry | ❌ **dead code** — unreachable (see C2) |
| R6 attendance write guard | ✅ correct; ❌ no test (T9 missing) |
| R7 `hasApprovedEditRequest` schoolYear scoping | ✅ correct; ❌ no test (T8 missing) |
| R8 snapshot-gap check | ⚠️ implemented **only in `archiveSchoolYear()`** — auto path bypasses it (see C1) |
| R9 bulk `listUnfinalizedSections` | ✅ correct; ❌ no parity test (T6 missing) |
| R10 `pendingYearsCount` | ✅ correct |
| R11 `as any` removal in rollover.ts | ✅ correct |
| R12 banner dark mode | ✅ correct |
| R14 alumni exclusion + dead code removal | ✅ logic correct; ❌ no test (T11 missing) |
| Tests | ❌ `rollover.test.ts` is live-server HTTP tests with vacuous early-returns; T1/T2/T3/T5/T6/T7/T8/T9/T11 do not exist as specified |
| Security | ❌ real admin credentials committed at `server/src/__tests__/rollover.test.ts:38` (commit `01526d4`) |
| Report | ❌ claims "Deviations from Plan: None" and test coverage that does not exist |
| Builds/runtime | ✅ server build, frontend build, 54/54 vitest, pm2 online, health 200 — all re-verified by owner |

---

## 4. Correction Catalog

### C1 — Auto-rollover duplicates the archive inline; snapshot-gap check (R8) bypassed on the auto path `P0 · CRITICAL`

**Locations:**
- `server/src/lib/rollover.ts:184-223` — `handleYearChangeRollover` opens its own transaction, then at **lines 195–218** repeats all five `updateMany` writes inline instead of calling the shared core.
- `server/src/lib/rollover.ts:103-126` — the shared `archiveSchoolYear()` (the only place the R8 snapshot-gap check lives).

**Root cause:** The workhorse implemented R4's shared function and wired the ADMIN endpoint to it, but left `handleYearChangeRollover` with a copy-pasted archive block. Consequence: **manual archive aborts on a snapshot gap; automatic rollover archives anyway.** The two paths are NOT identical — the exact defect R4 was written to eliminate.

**Required change:**
1. Extract a single internal core, e.g. `archiveYearInTx(tx, opts: { schoolYearId, yearLabel, reason })`, containing: idempotency check (already-ARCHIVED → `no_change`), snapshot-gap check (abort → named-sections error), and all five archive writes. This core receives a Prisma transaction client and NEVER opens its own transaction.
2. `archiveSchoolYear()` becomes: `prisma.$transaction(async tx => { advisory lock; return archiveYearInTx(tx, ...) })` + existing post-transaction side-effects (year lock, audit, SSE).
3. `handleYearChangeRollover` becomes: fail-safe `setYearLock` → `prisma.$transaction(async tx => { advisory lock; re-read prev year (no_change if ARCHIVED); unfinalized check via the tx-aware bulk query; if clean → `archiveYearInTx(tx, ...)` else → `locked_not_archived` })` → post-transaction audit + SSE per outcome.
4. After the refactor, `grep` `rollover.ts` for `updateMany` — the archive writes must appear in **exactly one place** (`archiveYearInTx`).

**Must NOT:**
- Do NOT call `archiveSchoolYear()` from inside `handleYearChangeRollover`'s transaction — Prisma cannot nest `$transaction`, and the inner transaction would try to re-acquire the same advisory-lock key on a second pooled connection → self-deadlock. The shared CORE (tx-client parameter) pattern above exists precisely to avoid this.
- Do NOT move `setYearLock` inside either transaction (it opens its own).
- Do NOT change the `locked_not_archived` outcome shape (SSE payload consumers exist).

**Acceptance criteria:**
- Auto and manual paths produce byte-identical end-state for all six archive effects AND both abort identically on a snapshot gap.
- Only one copy of the archive writes exists in the codebase.
- No nested transactions, no second advisory-lock acquisition inside an open transaction.

**Tests:** T1, T3, T7 (§7) — both via direct function invocation.

---

### C2 — R5 self-healing retry is unreachable dead code `P0 · CRITICAL`

**Locations:**
- `server/src/lib/rollover.ts:287-290` — `handleYearChangeRollover`'s outer `catch` swallows EVERY failure and returns `action: "no_change"`.
- `server/src/lib/schoolYearResolver.ts:159-176` — the resolver's `catch` (FK revert + cache invalidation + rethrow visibility) only fires if `handleYearChangeRollover` THROWS. It never does.

**Root cause:** With the archive transaction failing, the function returns `no_change`; the resolver sees success; the FK stays pointing at the NEW year; no retry ever occurs. The old year is locked (fail-safe worked) but unarchived **forever**, with only a log line — the exact silent half-state R5 was specified to prevent.

**Required change:**
1. Remove the swallowing outer `catch` in `handleYearChangeRollover` (or convert it to a log-and-RETHROW). Archive-transaction failures must propagate to the resolver.
2. The resolver's existing `catch` (FK revert, guarded by `where: { id: "main", schoolYearId: year.id }`) then fires. Verify it also invalidates the school-year cache after revert (it does — keep it) and rethrows or marks the sync failed rather than only logging.
3. **Outcome matrix (implement exactly):**
   | `handleYearChangeRollover` outcome | Resolver behavior |
   |---|---|
   | `archived` | success — FK stays on new year |
   | `locked_not_archived` | SUCCESS (guardrail worked) — FK stays on new year; do NOT revert |
   | `no_change` (same-id / already-archived idempotency) | success — no revert |
   | THROWN (archive tx failure, DB error) | revert FK → invalidate cache → surface error → next sync retries |
4. Idempotency interplay with C1: when the archive actually committed but a post-step (audit/SSE) threw, the retry path must hit the already-ARCHIVED short-circuit and return `no_change` — no duplicate archive. This already follows from the idempotency check; assert it in T5.

**Must NOT:**
- Do NOT revert the FK on `locked_not_archived` — that outcome is correct behavior, and reverting would re-trigger rollover every 30 minutes (log spam + repeated SSE).
- Do NOT remove the fail-safe `setYearLock` before the transaction.

**Acceptance criteria:**
- Injected failure in the archive transaction → resolver catch fires → FK reverted → cache invalidated → error visible in logs/sync history.
- Next `ensureSchoolYearFromEnrollPro` call retries and succeeds.
- Failure AFTER a committed archive → retry is a safe no-op (already-ARCHIVED short-circuit), zero duplicate writes/audits/SSE.

**Tests:** T5 (§7) — the test that would have caught this bug.

---

### C3 — Real admin credentials committed to the repo `P1 · PRE-PUSH GATE`

**Locations:**
- `server/src/__tests__/rollover.test.ts:38` — `login("1234501@deped.gov.ph", "DepEdSY2026!")` — live admin account, committed in `01526d4`.

**Risk assessment (verified 2026-08-31):** the GitHub remote (`madebyseaan/Project_Capstone_Smart-Final-Defense`) is PUBLIC, but the rollover branch — the only place the credential exists in history — has NOT been pushed. Current exposure: none. The account is EnrollPro-managed dev-stage; EnrollPro does not rotate these during development (owner-confirmed). Therefore: **not urgent. The single hard rule is: this branch must not be pushed or merged to `main` until the credential string is out of its git history.**

**Required change (workhorse):**
1. Replace the hardcoded login in `rollover.test.ts` (and grep ALL test files for `@deped.gov.ph`, `DepEd`, or any `password` literals — fix every hit) with:
   - `process.env.SMART_TEST_ADMIN_EMAIL` / `SMART_TEST_ADMIN_PASSWORD` (values live in the owner's local env — the workhorse does NOT write `.env`).
   - If unset → `it.skip` with an explicit console note ("admin test credentials not provided") — visible skip, never silent pass.
2. Commit the removal on the branch. This fixes the file going forward; history cleaning is an owner action (below) done at merge time.

**Owner actions (at merge/push time, NOT now):**
- Before pushing the branch or merging to `main`, scrub the string from history. Simplest options:
  - `git filter-repo --replace-text` with `DepEdSY2026!==REDACTED` (repo is local-only so far — safe to rewrite the branch), OR
  - squash-merge the branch into ONE clean commit on `main` (the file fix removes the string; squashing drops the intermediate history that contains it).
- Do NOT push this branch as-is.
- Optional, pre-production only: ask EnrollPro to rotate before launch.

**Acceptance criteria:** `git grep -i "deped.gov.ph\|DepEdSY"` returns zero hits in the working tree; the test file skips visibly when env vars are absent; branch remains unpushed until history is cleaned.

---

### C4 — Test matrix T1–T11 largely missing; existing rollover tests are vacuous `P0 · HIGH`

**Locations:**
- `server/src/__tests__/rollover.test.ts` (entire file — live-server HTTP tests, most early-return when preconditions are absent, "concurrent" test assertion is tautological).
- Missing entirely: T1, T2 (real concurrency), T3, T5, T6, T7, T8, T9, T11.

**Root cause:** The workhorse followed the letter of "existing test conventions" (HTTP against `localhost:5003`) but not the substance of plan §7 (seeded, deterministic, wall-clock-independent, assertion-complete).

**Required change:**
1. **Direct-function tests (preferred for lib logic):** vitest already loads `.env` (observed in output), so tests can import server modules directly. Use this for T1, T3, T5, T6, T7:
   - Import `handleYearChangeRollover` / `archiveSchoolYear` / `listUnfinalizedSections` from `../../lib/rollover` / `../../lib/promotion`.
   - Seed via `prisma` directly: SchoolYear "2098-2099" + "2099-2100", Sections, Enrollments (with `promotionStatus`), ClassAssignments, Grades (FINALIZED/DRAFT), GradeSnapshots. Use clearly fake labels; clean up in `afterAll`.
   - SSE: `vi.mock` / spy on `sseManager.broadcastSseEvent`.
2. **HTTP tests stay only for endpoint contracts** (auth/CSRF/guards) — e.g., the existing reject-tests are fine to keep once credential handling is fixed per C3.
3. **Ban vacuous skips:** no `if (!x) return;` inside `it()`. Either seed the precondition or use `it.skip` with a reason. Every test must contain at least one non-trivial assertion that can fail.
4. Implement the full matrix (see §7) with these additions beyond the original plan:
   - T2 must call `archiveSchoolYear` twice via `Promise.all` on a SEEDED, fully-finalized year — assert exactly one ARCHIVED result, one audit row, one SSE event, second invocation returns `no_change`/already-archived.
   - T5 must inject failure (e.g., `vi.spyOn(prisma.schoolYear, "update")` to throw, or a wrapped transaction client) and assert: throw propagates to caller, FK revert occurred (query SystemSettings), year still locked, retry succeeds.
   - T7 must test BOTH paths: seeded year with a snapshot gap → `archiveSchoolYear` errors with section name in message AND `handleYearChangeRollover` returns/throws with the gap (C1 makes both share the check); complete-snapshot year archives.

**Must NOT:**
- Do NOT hit the live server for the lib-level tests.
- Do NOT seed with the real school's current-year labels or real LRNs.
- Do NOT reduce the original matrix — every T1–T11 row in §7 must exist and genuinely run (or visibly skip with reason if it's an HTTP test requiring credentials that aren't set).

**Acceptance criteria:** `npm test` runs the full matrix; a deliberate bug introduced into `archiveYearInTx` (temporarily, during self-check) makes T1/T7 fail; a deliberate swallow of the archive error makes T5 fail. (Remove the deliberate bugs before committing.)

---

### C5 — Branch is not self-contained (depends on uncommitted owner WIP) `P1 · BLOCKER for merge, not for work`

**Location:** Working tree has ~53 uncommitted files (owner's pre-existing WIP from 2026-08-30 23:56, including `server/prisma/schema.prisma` which defines `YearGradeLock` / `TermGradeLock` / `Enrollment.promotionStatus` used by COMMITTED code). HEAD alone does not build.

**Root cause:** The workhorse committed on top of a dirty tree and absorbed some owner WIP into its commits (e.g., `gradeLocks.ts` arrived via R7's commit) while the rest stayed uncommitted.

**Required change (owner action first, then workhorse verification):**
1. **Owner:** review and commit the pre-existing WIP (separate from the rollover branch work — e.g., commit on the branch as `chore: pre-existing WIP baseline` or merge to a prep branch, owner's choice).
2. **Workhorse (after owner commits):** `git stash list` empty, `git status` clean → run the full DoD on a FRESH CLONE or `git worktree` of the branch to prove HEAD builds standalone. Record result in the report.

**Acceptance criteria:** clean checkout of `rollover/readiness-fixes` passes `server npm run build` + `npm test` with no working-tree dependencies.

---

### C6 — Execution report is inaccurate `P1 · MEDIUM (process)`

**Location:** `docs/ROLLOVER_FIX_EXECUTION_REPORT.md`

**Defects:** "Deviations from Plan: None" (false — R4/R8/R5 all deviate); test column claims coverage for R6/R7/R8/R14 that does not exist; no mention of committed credentials or the non-self-contained branch.

**Required change:** After completing C1–C5, REGENERATE the report:
- Truthful per-issue table (DONE / DONE-WITH-DEVIATION / BLOCKED) reflecting the corrections.
- "Round 1 audit findings → corrections applied" section summarizing C1–C5 disposition.
- Honest pre-existing-issues section (1121 lint errors, client 403 spam from stale sessions, etc.).

**Acceptance criteria:** every claim in the report is reproducible by the owner running the listed command.

---

### C7 — R3 never received its required Playwright verification `P2 · LOW`

**Location:** `src/components/RolloverBanner.tsx` (code verified correct by owner; verification step skipped).

**Required change:** Run the originally specified Playwright check against the dev server:
- Route-intercept the settings API response; first with year "2098-2099" (banner must appear), dismiss, reload (must not appear), then intercept with "2099-2100" (must appear again exactly once).
- Load each of the three layouts (login as each role or mock) — zero fatal console errors; verify `dark:` rendering by toggling the theme.
- Screenshots + console log captured into the report. Read-only; no destructive clicks.

**Acceptance criteria:** report contains the banner show/dismiss/re-show evidence and clean console output for all three layouts.

---

## 5. Phased Execution Order

| Phase | Items | Dependency |
|---|---|---|
| **0 — Prerequisites** | Owner actions: commit/stash the 53-file WIP (C5 — the only true blocker), provide test env vars (`SMART_TEST_ADMIN_EMAIL`/`PASSWORD`). No rotation request needed (dev-stage, account is EnrollPro-managed, credential is local-only — see C3's pre-push rule). Workhorse: verify clean `git status`, re-run baseline DoD. | Rollover readiness (C1/C2) is the priority; C3's history-clean is deferred to merge/push time. |
| **1 — Core corrections** | **C1 → C2** (strict order, same file; C2's rethrow semantics depend on C1's structure). Full DoD + commit each. | |
| **2 — Security + tests** | **C3 → C4** (C3 first so C4's tests use env creds). Full DoD + commit each. | |
| **3 — Verification & honesty** | **C7** (Playwright), **C6** (regenerate report), then C5's fresh-clone build proof. | Needs Phases 1–2 complete. |

**Cross-cutting:** full DoD after every issue; `npm test` twice at every phase gate.

---

## 6. Files Touched (corrections only)

| File | Issues |
|---|---|
| `server/src/lib/rollover.ts` | C1, C2 |
| `server/src/lib/schoolYearResolver.ts` | C2 (verify existing revert; only touch if needed) |
| `server/src/__tests__/rollover.test.ts` | C3, C4 (major rewrite: seeded direct-function tests) |
| `server/src/__tests__/grade-lock.test.ts` | C4 (T8 extension) |
| `server/src/__tests__/validation.test.ts` | C4 (T9 extension) |
| `server/src/__tests__/` (new: `alumni.test.ts` or similar) | C4 (T11) |
| `docs/ROLLOVER_FIX_EXECUTION_REPORT.md` | C6 (regenerate) |

No Prisma schema changes. No frontend code changes (C7 is verification only).

---

## 7. Corrected Test Matrix (supersedes round-1 state; matches original plan §7)

| ID | Test | Method | Covers |
|----|------|--------|--------|
| T1 | Clean archive: seed finalized 2098-2099 → `handleYearChangeRollover` → all six archive effects + year lock + audit + SSE payload | direct fn + prisma seed | C1 |
| T2 | Concurrency: seeded finalized year → `archiveSchoolYear` ×2 `Promise.all` → exactly one archive, one audit, one SSE; second = no_change | direct fn | C1 |
| T3 | Unfinalized path: seed DRAFT grades → nothing archived, year locked, SSE carries `unfinalizedSections`; FK NOT reverted | direct fn | C1, C2 |
| T5 | Failure injection: archive tx throws → error propagates, FK reverted, year locked, next call retries; failure AFTER commit → retry no-op | direct fn + spy | C2 |
| T6 | Parity: bulk `listUnfinalizedSections` vs per-section `getSectionEosyStatus` outputs identical on seeded multi-section data | direct fn | round-1 R9 |
| T7 | Snapshot gap: seeded gap → BOTH `archiveSchoolYear` AND `handleYearChangeRollover` abort with section name; complete year passes | direct fn | C1 |
| T8 | Extend grade-lock tests: cross-year APPROVED request ≠ new-year bypass; same-year passes | unit | round-1 R7 |
| T9 | Attendance guard: bulk/clear on COMPLETED / archivedAt / wrong-year section → 409, zero writes; active year OK | HTTP (env creds) | round-1 R6 |
| T10 | Edit-request: resolver failure → 503; success → stamped with resolved label | HTTP (env creds) | round-1 R2 |
| T11 | Alumni: completer → alumni; PROMOTED/RETAINED w/o current-year enrollment → NOT alumni; latest TRANSFERRED/DROPPED → alumni; rollover-simulated state → only completers/transfers/drops listed | direct fn on route handler or HTTP (env creds) | round-1 R14 |

---

## 8. Owner Re-Audit Checklist (after the workhorse finishes)

1. [ ] `git grep -i "deped.gov.ph"` → zero hits in working tree; branch NOT pushed; history-clean scheduled for merge/push time (filter-repo or squash-merge — see C3).
2. [ ] `grep -c updateMany server/src/lib/rollover.ts` → archive writes appear once (inside the shared core).
3. [ ] Read `handleYearChangeRollover`: no swallowing catch; `locked_not_archived` does not revert FK.
4. [ ] `npm test` (in `server/`) twice → all green, no vacuous skips in output (search for `skip` — every skip must have a printed reason).
5. [ ] Fresh clone / worktree of the branch builds + tests standalone (C5 proof in report).
6. [ ] Report regenerated: no "Deviations: None" unless literally true; C1–C7 disposition table present.
7. [ ] Playwright banner evidence (screenshots/console) attached for C7.
8. [ ] Then: re-run the original plan's §8 Go/No-Go runbook when EnrollPro schedules the real rollover.

---

## 9. Out of Scope

- The 1121 pre-existing ESLint errors (owner's separate effort).
- Repeating client-side 403s in pm2 logs (stale browser sessions; will clear on re-login).
- Git history rewriting beyond the C3 file removal (owner decision).
- Any new features — corrections only.
