# Rollover Fix — Round 3 Punch List (Post-Audit of Round 2)

> **Status:** PLANNING ONLY — no code here is final implementation.
> **Date:** 2026-08-31
> **Context:** Round 2 core fixes (C1/C2) are verified GOOD — rollover readiness is achieved. This is the final quality pass. It exists because the Round-2 audit found one live-breaking test bug (proven by incident, see D1) and three missing tests (T5 real, T8, T9, T11) plus pending verification items.
> **Executor:** Hand-off for implementation agent. Order matters: **D1 first, before any test run.**
> **Base documents:** `docs/ROLLOVER_READINESS_FIX_PLAN.md` (original specs) · `docs/ROLLOVER_FIX_CORRECTION_PLAN.md` (Round 2).

---

## ⚠️ 0. ENVIRONMENT CONTEXT — EnrollPro is OFFLINE right now

This changes priorities and constraints:

1. **D1 is now URGENT (proven live incident, 2026-08-31):** running `npm test` while EnrollPro is offline leaves the LIVE `SystemSettings` pointing at fake test years with **no sync to self-heal**. This actually happened during the Round-2 audit: after a test run, live `currentSchoolYear` = "2098-2099" (deleted fake year) and `schoolYearId` = null — every active-year lookup on the live server was failing. The owner manually restored it (2026-2027 re-linked). **Do not run `npm test` until D1 is fixed.**
2. **Expected offline behavior — NOT bugs:** `pm2 logs` shows `[TeacherSync] EnrollPro error: Timeout fetching ...` entries. EnrollPro-down is a designed-for state (term sync falls back to DB per project gotchas). Do not "fix" these or treat them as regressions in your report — list them as expected offline noise.
3. **No rollover detection while offline:** syncs can't reach EnrollPro → the rollover trigger chain is dormant until EnrollPro returns. Nothing to do about this; SMART-side readiness is already in place.
4. **Login caveat for HTTP tests:** SMART auth checks the LOCAL bcrypt password first; EnrollPro is only a fallback. If the test accounts have local passwords, env-gated HTTP tests still work offline. If they don't, those tests will visibly skip — acceptable; note it in the report.

**Offline-safe work (all of this plan):** D1, T5, T8, T9 (unit-test variant), C7 Playwright (route interception mocks — no EnrollPro needed). Only T11's full HTTP path *may* need credentials; visible-skip is acceptable.

---

## 1. Global Definition of Done (after EVERY item)

```powershell
# D1 fix must land FIRST, then for every item:
# Backend (server/)
npm run build
npm test              # twice — second run catches state leakage
npm test

# Runtime
pm2 restart server    # wait ~15s
pm2 list                                                       # online
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health   # 200
# CRITICAL NEW CHECK (D1 regression guard): after every npm test run —
# GET /api/admin/settings MUST return currentSchoolYear "2026-2027"
# and a non-null schoolYearId. If not: STOP, you reintroduced D1.

pm2 logs --lines 100 --nostream    # no NEW errors vs baseline
# (EnrollPro timeout entries are expected offline noise — see §0.2)
```

Frontend build only if frontend files touched. Commit per item: `D<n>/T<n>: <summary>`. Branch stays `rollover/readiness-fixes`, never pushed.

---

## 2. Round 3 Items

### D1 — Tests hijack live SystemSettings with no restore `P0 · CRITICAL — FIX BEFORE ANY TEST RUN`

**Location:** `server/src/__tests__/rollover-lib.test.ts` — `seedBase()` lines 73–77 upsert `SystemSettings.main` → `{ schoolYearId: fakeYearA, currentSchoolYear: "2098-2099" }`. `cleanup()` (lines 133–146) deletes fake years but NEVER restores the settings row.

**Proven failure (2026-08-31 incident):** test run → settings point at fake year → cleanup deletes the fake year → live settings left as `currentSchoolYear="2098-2099"` (nonexistent) + `schoolYearId=null` → every `getActiveSchoolYear()` call on the live server throws. With EnrollPro online, sync self-healed within ~30 min; with EnrollPro offline it stays broken indefinitely.

**Required change (preferred, cleanest):**
1. First TRY REMOVING the `systemSettings.upsert` from `seedBase()` entirely. Audit what actually needs it: `handleYearChangeRollover` and `archiveYearInTx` never read SystemSettings; `archiveSchoolYear`'s only dependency is `getActiveSchoolYearLabel()` inside a `try/catch` that already falls back to `"unknown"`. Run the suite — if all tests still pass (T1's `archivedReason` assertions don't depend on it), DELETE the upsert. Done — tests never touch live settings.
2. If some assertion genuinely needs it (verify first — do not assume), fall back to: capture original in `beforeAll` (`findUnique`), restore it in `afterAll` BEFORE deleting fake years, and add a final assertion that settings equal the original.
3. **Add a permanent regression guard** in `afterAll` (or a dedicated `it`): re-read `SystemSettings.main` and `expect(currentSchoolYear).toBe(originalYear)` — the suite FAILS if any test leaves live settings hijacked.

**Must NOT:** run `npm test` before this fix lands; wrap the restore in `catch(() => {})` (silent restore failure = D1 again); delete the upsert without running the suite to confirm.

**Acceptance criteria:** suite green twice; after the run, `GET /api/admin/settings` still returns `2026-2027` + non-null FK; grep the test file — no unpaired settings writes.

---

### T5 — Real failure-injection + FK-revert + retry test `P1 · HIGH`

**Location:** `server/src/__tests__/rollover-lib.test.ts` — current "T5" (lines 276–304) only passes a non-existent schoolYearId; it never exercises the resolver's revert path or a retry.

**Required change — replace with a true self-healing test, all offline-safe:**
1. **Seed:** two fake years (A active-linked via settings — D1's restore guard applies; if D1 option 1 removed the settings link entirely, link settings in THIS test's `beforeAll` and restore in its `afterAll`), finalized grades + snapshots for A.
2. **Inject failure:** use `vi.spyOn(prisma.schoolYear, "update").mockRejectedValueOnce(new Error("injected"))` (or spy on the grade updateMany — any write inside the archive tx). Ensure the spy is restored in `afterAll` even on failure.
3. **Call the RESOLVER, not just the rollover lib:** `ensureSchoolYearFromEnrollPro(yearB.externalId, YEAR_B)` — this function does not fetch EnrollPro itself (its caller does), so it is offline-safe.
4. **Assert the full chain:**
   - The call throws or logs the failure (the resolver's catch fires).
   - `SystemSettings.schoolYearId` REVERTED to year A's id (the guarded `updateMany` revert worked).
   - Year A's yearGradeLock exists and `isLocked = true` (fail-safe lock).
5. **Retry:** `mockRestore()` the spy → call `ensureSchoolYearFromEnrollPro(yearB.externalId, YEAR_B)` again → succeeds → year A now ARCHIVED, settings point at year B.
6. Keep the existing non-existent-ID tests as extra cases if desired, but the injection test above is the acceptance requirement.

**Must NOT:** spy without restoring (leaks into other suites — this is why `npm test` runs twice); assert only that something threw (the whole point is revert + retry).

**Acceptance criteria:** the test fails if (a) the rethrow in `handleYearChangeRollover` is removed, (b) the resolver's revert is removed, or (c) the retry doesn't archive. (Verify by temporarily breaking each during self-check, then unbreak.)

---

### T8 — Cross-year edit-request lock test `P1 · MEDIUM`

**Location:** `server/src/lib/gradeLocks.ts` (`hasApprovedEditRequest` — now schoolYear-scoped, code verified correct) — but `grade-lock.test.ts` has ZERO coverage of it (0 hits for schoolYear).

**Required change — direct unit test (offline-safe, no HTTP, no login):**
1. New test (in `grade-lock.test.ts` or a new `gradeLocks-lib.test.ts`) importing `hasApprovedEditRequest` / `checkGradeEditLocks` directly.
2. Seed: a teacher user, an APPROVED `GradeEditRequest` for `schoolYear: "2098-2099"`, `term: "T1"`, `expiresAt: future`.
3. Assert:
   - `hasApprovedEditRequest(teacherId, "T1", "2098-2099")` → true (same year).
   - `hasApprovedEditRequest(teacherId, "T1", "2099-2100")` → false (different year — the Round-1 bug would return true here).
   - `checkGradeEditLocks` with `schoolYearLabel: "2099-2100"` + locked T1 → returns `TERM_LOCKED` despite the stale approved request.
   - Expired request (`expiresAt: past`) → false even same-year.
4. Cleanup seeded rows in `afterAll` (scoped to fake years / test teacher only).

**Acceptance criteria:** test fails if the `schoolYear` filter is removed from `hasApprovedEditRequest`'s where clause (verify by temporarily removing during self-check).

---

### T9 — Attendance write-guard test `P1 · MEDIUM`

**Location:** `server/src/routes/attendance.ts` — guard helper `assertSectionAttendanceWritable` (verified correct) + the 409 wiring on `/bulk` and `/clear`. No test exists (the one "409" hit in validation.test.ts is a pre-existing invalid-status test).

**Required change — preferred unit-test variant (offline-safe):**
1. Export `assertSectionAttendanceWritable` from `attendance.ts` (export-only change — no behavior change) OR move it to `server/src/lib/attendanceGuard.ts` (pick whichever matches project convention for route helpers; keep the route thin).
2. Seed three sections in the ACTIVE real year label context: one `status: "COMPLETED"`, one `archivedAt: set`, one normal ACTIVE section in the current year, plus one section with a FAKE year label ("2099-2100").
3. Assert: guard returns the error string for completed / archived / wrong-year sections; returns `null` for the active-year section.
4. If (and only if) the HTTP layer is trivially testable with locally-authenticated teacher creds, add the 409 endpoint assertions; otherwise the unit coverage of the guard + existing route wiring review is sufficient — state which path you took in the report.

**Acceptance criteria:** guard unit test fails if any of the three guard conditions is removed (self-check by temporary removal).

---

### T11 — Alumni classification test `P1 · MEDIUM`

**Location:** `server/src/routes/registrar/main.ts` (`/alumni` exclusion logic — code verified correct, no test).

**Required change:**
1. Preferred: extract the classification predicate (the "is this enrollment alumni vs awaiting-re-enrollment" decision) into a small exported pure function in the same file or a lib module — additive refactor only, no behavior change — and unit-test it with seeded enrollments: JHS_COMPLETER → alumni; PROMOTED/RETAINED without current-year enrollment → NOT alumni; latest TRANSFERRED/DROPPED → alumni.
2. The full HTTP `/alumni` endpoint test is env-gated (registrar creds): add it behind `hasCredentials("registrar")` with the rollover-simulated assertion (new SY active, zero new enrollments → only completers/transfers/drops). It may visibly skip while offline — acceptable.
3. Cleanup all seeded rows (fake LRN prefix / fake year scoping).

**Acceptance criteria:** unit test fails if the `isContinuing` exclusion is removed (self-check).

---

### C7 — Playwright verification of RolloverBanner (finally) `P2 · LOW`

**Location:** `src/components/RolloverBanner.tsx` — code verified correct in two audits; the required Playwright evidence has never been produced.

**Required change (offline-safe — everything is mocked or local):**
1. Dev server must be running (`pm2 list` → server + client online).
2. Via Playwright (browser MCP tools or a script in `C:\Users\Sean\AppData\Local\Temp\opencode`):
   - Navigate to the login page; intercept `**/api/admin/settings` responses; for banner logic you need an authenticated layout — attempt login per role IF local accounts exist (see §0.4). If logins are impossible offline, document BLOCKED-partial and verify what's reachable (login page renders, zero fatal console errors).
   - If a layout is reachable: intercept settings → `currentSchoolYear: "2098-2099"` → banner appears; dismiss; reload → gone; intercept → `"2099-2100"` → banner appears exactly once. Clear `localStorage` between scenarios.
   - Toggle dark mode; screenshot both themes.
3. **Read-only rule stands:** no archive/finalize/delete/lock/approve clicks.
4. Append screenshots + console summary to the execution report.

**Acceptance criteria:** report contains show/dismiss/re-show evidence + clean console, or an honest BLOCKED-partial with the offline reason.

---

### C5 — Branch self-containment `OWNER ACTION — carry-over`

Still ~89 uncommitted files (owner WIP). Owner will commit them; after that, the workhorse verifies a fresh `git worktree`/clone of the branch builds + tests standalone and records it. Not blocking D1/T5/T8/T9/T11/C7 work.

---

## 3. Execution Order

| Step | Item | Why this order |
|---|---|---|
| 1 | **D1** | MUST land before any `npm test` run (live-system hazard while EnrollPro offline) |
| 2 | **T5** | Uses settings-link seeding pattern that D1's guard protects |
| 3 | **T8, T9, T11** | Independent; any order |
| 4 | **C7** | Playwright; independent of tests |
| 5 | Report regenerate + C5 verification (if owner has committed WIP) | Last |

## 4. Files Touched

| File | Items |
|---|---|
| `server/src/__tests__/rollover-lib.test.ts` | D1, T5 |
| `server/src/__tests__/grade-lock.test.ts` (or new lib test) | T8 |
| `server/src/routes/attendance.ts` (export-only or lib move) + its test | T9 |
| `server/src/routes/registrar/main.ts` (additive extract) + its test | T11 |
| `docs/ROLLOVER_FIX_EXECUTION_REPORT.md` | regenerate |

No Prisma schema changes. No rollover.ts / schoolYearResolver.ts changes (verified good — do not touch).

## 5. Owner Re-Audit Checklist (Round 3)

1. [ ] `npm test` (server/) twice → green; then `GET /api/admin/settings` still shows `2026-2027` + non-null FK (D1 proof).
2. [ ] T5 exists with failure-injection + revert + retry assertions (read the test — it must spy and restore).
3. [ ] T8/T9/T11 present and running (or visibly skipped with printed reason if env-gated and offline).
4. [ ] C7 evidence in report (screenshots/console or honest BLOCKED-partial).
5. [ ] Self-check traces: each new test was temporarily broken during development and actually failed (workhorse states this in report).
6. [ ] `git grep -i "deped.gov.ph"` still zero hits; branch still unpushed.
7. [ ] When EnrollPro returns: expect a burst of sync activity in pm2 logs; settings should REMAIN 2026-2027; no fake years in DB.

## 6. Out of Scope

- The ~89-file owner WIP (C5 owner action).
- EnrollPro offline errors in logs (expected noise, §0.2).
- 1121 pre-existing lint errors.
- Any change to rollover.ts / schoolYearResolver.ts — Round 2 state is correct and audited; do not touch.
