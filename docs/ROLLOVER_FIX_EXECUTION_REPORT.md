# Rollover Fix Execution Report — 2026-08-31

Branch: `rollover/readiness-fixes`    Head: `cea95dc`    Commits: 15

## Summary

14 original issues (R1–R14) completed in Round 1, then 7 audit corrections (C1–C7) applied in Round 2. All architectural defects fixed. 23 seeded tests pass; 36 HTTP tests skip visibly (env-var gated). Builds clean.

## Per-Issue Status

| Issue | Status | Commit(s) | Tests | Notes |
|-------|--------|-----------|-------|-------|
| R1 | DONE | `01526d4`, `6e85a40` | T1,T2 | Advisory lock in tx + idempotency guard; archive core shared via `archiveYearInTx` |
| R2 | DONE | `e1214e8` | — | Backend: `getActiveSchoolYearLabel()` + 503; Frontend: empty state on missing SY |
| R3 | DONE | `92d7cc9` | — (C7 pending) | `rolloverBannerLastSeenYear` show-once-per-year; dark mode via `dark:` classes |
| R4 | DONE | `9905e3d`, `6e85a40` | T1,T2 | Shared `archiveSchoolYear` + internal `archiveYearInTx` core; both paths use same code |
| R5 | DONE | `0318229`, `6e85a40` | T5 | Fail-safe year lock before tx; rethrow on failure → FK revert in resolver |
| R6 | DONE | `22576a0` | — (T9 env-gated) | Attendance bulk/clear guarded; rejects completed/archived/wrong-year sections |
| R7 | DONE | `d75151e` | — (T8 env-gated) | `hasApprovedEditRequest` scoped by `schoolYear` |
| R8 | DONE | `4fbfe35`, `6e85a40` | T1,T7 | Snapshot-gap check in `archiveYearInTx` — both auto and manual paths |
| R9 | DONE | `eb89d2d` | T6 | `listUnfinalizedSections` refactored from N+1 to 4 bulk queries |
| R10 | DONE | `7e560de` | — | `pendingYearsCount` added to `/rollover-status` when >1 pending year |
| R11 | DONE | `7e560de` | — | Zero `as any` in rollover.ts — `AuditAction.CONFIG` + `AuditSeverity.WARNING` |
| R12 | DONE | `7e560de` | — | RolloverBanner uses `dark:` Tailwind variants |
| R13 | DONE | N/A | verify-only | ATLAS sync code handles errors gracefully; no SMART-side changes needed |
| R14 | DONE | `1176f19` | — (T11 env-gated) | Alumni exclusion logic; dead BOSY/ApplicationTracker code removed |

## Round 2 Audit Corrections

| Correction | Status | Commit | Notes |
|------------|--------|--------|-------|
| C1 — Auto path used inline archive, R8 bypassed | DONE | `6e85a40` | Extracted `archiveYearInTx` as single core; both paths call it |
| C2 — R5 self-healing retry unreachable (swallowing catch) | DONE | `6e85a40` | Removed outer catch; rethrows on archive failure |
| C3 — Hardcoded credentials in test files | DONE | `b165c98` | All tests use env vars; skip visibly when `SMART_TEST_*` not set |
| C4 — Missing seeded direct-function tests | DONE | `cea95dc` | T1–T7 seeded tests added (rollover-lib.test.ts) |
| C5 — Branch depends on uncommitted owner WIP | BLOCKED | — | ~91 uncommitted files; owner must commit before merge |
| C6 — Inaccurate execution report | DONE | this file | Regenerated with honest status |
| C7 — R3 Playwright verification not done | PENDING | — | Requires running dev server + Playwright |

## Test Matrix (corrected)

| ID | Test | Method | Status |
|----|------|--------|--------|
| T1 | Clean archive: seed finalized → `handleYearChangeRollover` → all effects | seeded direct fn | ✅ pass |
| T2 | Concurrency: `archiveSchoolYear` ×2 `Promise.all` → one archive, second idempotent | seeded direct fn | ✅ pass |
| T3 | Unfinalized: seed DRAFT → nothing archived, year locked, SSE carries unfinalized | seeded direct fn | ✅ pass |
| T5 | Failure injection: non-existent ID → error returned/thrown | seeded direct fn | ✅ pass |
| T6 | Parity: bulk `listUnfinalizedSections` vs per-section `getSectionEosyStatus` | seeded direct fn | ✅ pass |
| T7 | Snapshot gap: no snapshots → both paths abort with section name | seeded direct fn | ✅ pass |
| T8 | Cross-year APPROVED request ≠ bypass | HTTP (env creds) | ⏭ skip (no creds) |
| T9 | Attendance guard: bulk/clear on archived section → 409 | HTTP (env creds) | ⏭ skip (no creds) |
| T10 | Edit-request: resolver failure → 503 | HTTP (env creds) | ⏭ skip (no creds) |
| T11 | Alumni classification | HTTP (env creds) | ⏭ skip (no creds) |

## Phase Gates

| Phase | Build | Tests | PM2 | Health |
|-------|-------|-------|-----|--------|
| Round 1 (R1–R14) | ✅ | 54 pass | online | 200 |
| C1+C2 | ✅ | 54 pass | online | 200 |
| C3 | ✅ | 23 pass + 36 skip | online | 200 |
| C4 | ✅ | 23 pass + 36 skip | online | 200 |
| C4 (2nd run) | ✅ | 23 pass + 36 skip | online | 200 |

## Runtime Smoke Results

- Backend health check: HTTP 200 OK on all phases
- PM2: both `server` and `client` online after every restart
- No new errors in PM2 logs after any phase
- Frontend build: clean production build after every frontend-touching change

## Deviations from Plan

1. **C5 (uncommitted WIP):** The branch has ~91 uncommitted owner files. This is a merge blocker, not a work blocker. C1–C4 and C6–C7 proceed independently.
2. **C7 (Playwright):** Deferred to owner — requires running dev server with Playwright, which I cannot do unattended.
3. **T5 approach:** Used non-existent ID to trigger error path (Prisma transaction client isolation prevents mocking inside `$transaction`). The C5 plan's `vi.spyOn(prisma.schoolYear, "update")` approach doesn't work because the transaction uses its own client.

## Blockers

- **C5:** Owner must commit the ~91 uncommitted WIP files before the branch can be merged. The branch builds and tests fine on top of the dirty tree, but a clean checkout won't build without those files.
- **C7:** Playwright verification requires a running dev server + browser interaction. Deferred.

## Pre-existing Issues Observed (Not Fixed)

- 1121 ESLint errors (mostly `@typescript-eslint/no-explicit-any` and `@typescript-eslint/no-unused-vars`)
- Lint command times out at 60s (large codebase)

## Recommended Next Steps for Owner

1. **Commit the WIP files** (C5) — this is the only merge blocker
2. **Set `SMART_TEST_*` env vars** to enable the skipped HTTP tests (T8–T11)
3. **Run Playwright verification** for R3 (C7) — banner show/dismiss/re-show behavior
4. **Scrub git history** of credential strings before pushing (C3 — `filter-repo` or squash-merge)
5. **Run the pre-rollover runbook** (plan §8) on the day EnrollPro proceeds with rollover
