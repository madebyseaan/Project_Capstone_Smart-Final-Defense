# Rollover Readiness — Fix Execution Plan

> **Status:** PLANNING ONLY — do not treat any code snippet below as final implementation.
> **Date:** 2026-08-30
> **Scope:** All defects and hardening items required for SMART to safely survive an EnrollPro school-year rollover.
> **Executor:** Hand-off document for implementation agent. Implement phase-by-phase, in order.
> **Related docs:** `docs/ROLLOVER_READINESS_PLAN.md`, `mdfiles/ROLLOVER-GAP-FIX-PLAN.md`, `mdfiles/ENROLLPRO-SCHOOL-YEAR-LIFECYCLE.md`, `mdfiles/ENROLLPRO-API.md` (code-verified endpoint catalog — basis of Appendix A)

---

## 1. Objective & Success Criteria

SMART must be in a state where, **whenever EnrollPro proceeds with rollover** (this can happen at any time — it is outside our control), all of the following hold:

1. SMART's auto-detected rollover (`handleYearChangeRollover`) is **race-free** — concurrent syncs can never double-process or interleave archive operations.
2. If any section is unfinalized, the old year is **locked (never archived)** and admins are clearly informed.
3. If a rollover attempt **fails mid-flight**, the system self-heals on the next sync (retry) and never ends in a silent half-state.
4. **No hardcoded school-year strings** exist anywhere in runtime code paths (backend or frontend).
5. Old-year data (grades, attendance, enrollments) is preserved, queryable for SF forms, and **write-protected**.
6. Manual admin archive and automatic rollover produce **byte-identical outcomes** (same archive semantics, locks, audit, SSE events).
7. All existing tests pass, plus new tests covering every fix in this plan.

**Global Definition of Done (must pass at the end of EVERY phase):**
```bash
# Frontend (repo root)
npm run build
npm run lint

# Backend (server/)
npm run build
npm test          # vitest run
```

---

## 2. Ground Rules (Non-Negotiables)

- **DO NOT** modify `.env` or `.env.*` files.
- **DO NOT** write to external systems (EnrollPro/ATLAS/AIMS are READ-ONLY integrations).
- **DO NOT** refactor unrelated code. Each issue touches only the files listed.
- **Query rule invariant:** Operational queries (dashboards, teacher current classes) filter `ClassAssignment.isActive` / `Enrollment.isArchived`. Historical/SF-form queries (SF1/SF5/SF10, registrar year-scoped views, sync-grades pull, promotion/EOSY libs) filter by `schoolYear` string ONLY — never by `isActive`/`isArchived`. All changes in this plan must respect this split. (Note: SMART-side BOSY pages are dead code — re-enrollment lives entirely in EnrollPro; see R14.)
- **Grade lock precedence invariant (T2/A1):** `archived → year lock → term lock → legacy system-wide gradeLock`. An APPROVED `GradeEditRequest` bypasses the TERM lock only — never archived or year locks.
- **Never hardcode a school year.** The only acceptable source of the active year is `getActiveSchoolYear()` / `getActiveSchoolYearLabel()` from `server/src/lib/schoolYearResolver.ts` (backend) and API-provided settings (frontend).
- Max 1000 lines per file. Keep types explicit; no `any` additions (this plan actually REMOVES existing `any` casts — see R11).
- Every behavioral fix in this plan ships with a test (see §7 Test Plan).

---

## 3. Background — How Rollover Works Today

### Trigger chain
```
EnrollPro rollover (external, unscheduled)
  → SMART EnrollPro sync runs (every 30 min) OR branding sync OR admin manual sync
    → ensureSchoolYearFromEnrollPro()            [schoolYearResolver.ts:111]
      → detects SystemSettings.schoolYearId changed
      → handleYearChangeRollover()               [rollover.ts:28]
        → listUnfinalizedSections(prevYear)      [promotion.ts:345]
        → 0 unfinalized  → clean ARCHIVE (tx) + year lock + audit + SSE
        → N unfinalized  → LOCK ONLY + audit + SSE (admin must resolve)
```

### Entry points that can trigger rollover (concurrency sources)
| # | Entry point | Location |
|---|-------------|----------|
| 1 | Scheduled/manual unified EnrollPro sync | `server/src/lib/enrollproSync.ts:176` |
| 2 | Branding sync | `server/src/lib/enrollproBrandingSync.ts:203` |
| 3 | Admin manual archive (separate code path) | `server/src/routes/admin-sub/system.ts:374` |

### What a clean archive does (target semantics — must be identical everywhere)
- `Grade.isArchived = true`, `archivedReason = "Rollover: {label} archived"` (scoped via `classAssignment.schoolYear`)
- `Enrollment.isArchived = true`, same reason pattern
- `Section.status = "COMPLETED"`, `archivedAt = now`
- `ClassAssignment.isActive = false`, `archivedAt = now`, `archivedReason`
- `SchoolYear.status = "ARCHIVED"`, `archivedAt = now`
- Year grade lock set, legacy `SystemSettings.gradeLock` reset to `false`
- Audit log + `SCHOOL_YEAR_ROLLOVER` SSE broadcast

---

## 4. Issue Catalog

Priorities: **P0 = must fix before EnrollPro rollover** · P1 = strongly recommended hardening · P2 = polish · EXT = external dependency (verify only).

---

### R1 — Advisory lock is a no-op (race condition) `P0 · CRITICAL`

**Location:** `server/src/lib/rollover.ts:39`

**Current code:**
```ts
await prisma.$executeRaw`SELECT pg_advisory_xact_lock(${ROLLOVER_ADVISORY_KEY})`;
```

**Root cause:** `pg_advisory_xact_lock` is released at the **end of the current transaction**. `$executeRaw` outside an explicit transaction runs as a single auto-committed statement, so the lock is acquired and released **instantly**. It provides zero mutual exclusion. Two overlapping syncs (EnrollPro sync + branding sync can overlap; admins can also trigger `/system/sync/run`) can both pass the "lock", both run `listUnfinalizedSections`, and both execute archive transactions concurrently → duplicated audit logs, duplicated SSE events, and race window between the unfinalized-check and the archive (TOCTOU: a section could finalize between check and archive, or the check could see stale data while the other transaction is mid-archive).

**Required change:**
1. Move the **entire** rollover decision + archive into ONE interactive Prisma transaction:
   - Inside the transaction, FIRST execute the advisory lock via `tx.$executeRaw` (`pg_advisory_xact_lock`) — now the lock is held until the transaction commits/rolls back.
   - Inside the same transaction (using `tx`, not `prisma`): re-read the previous `SchoolYear` row and short-circuit if its `status` is already `"ARCHIVED"` (idempotency guard — makes double-invocation harmless).
   - Inside the same transaction: run the unfinalized check and, if clean, all `updateMany` archive steps with `tx`.
   - Keep `setYearLock`, audit log, and SSE broadcast AFTER the transaction (they manage their own transactions/side channels).
2. `listUnfinalizedSections` currently uses the global `prisma` client. For transactional consistency either (a) add an optional `tx` parameter (Prisma transaction client type) threaded into `getSectionEosyStatus`/`computeSectionPromotions`, or (b) accept a documented read-committed approximation. **Prefer (a)** — pass `tx` through. Do not duplicate the promotion logic.
3. The `locked_not_archived` branch must also run its unfinalized check under the same lock+transaction pattern (lock-only outcome, no writes inside tx besides none — the tx exists purely to serialize the check).

**Must NOT:**
- Do not switch to `pg_advisory_lock` (session-level) — Prisma pools connections; session locks can leak across pool reuse.
- Do not remove the short-circuit when `previousSchoolYearId === newSchoolYearId`.

**Acceptance criteria:**
- A single transaction contains: advisory lock → idempotency check → unfinalized check → all archive writes.
- Two concurrent invocations with identical inputs produce exactly ONE archive (second returns `no_change` due to idempotency guard or lock serialization).
- Zero behavior change in the `locked_not_archived` outcome.

**Verification:** unit/integration test invoking `handleYearChangeRollover` twice concurrently (Promise.all) against a test DB — assert one `ARCHIVED` audit row, one SSE event, `SchoolYear.status === "ARCHIVED"` once.

**Regression risks:** long transaction hold time if `listUnfinalizedSections` is slow — mitigated by R9. Ensure `setYearLock` is NOT called inside the interactive transaction (it opens its own `$transaction` — Prisma cannot nest).

---

### R2 — Hardcoded school-year fallbacks `P0 · HIGH`

**Locations:**
| File | Line | Current code |
|------|------|--------------|
| `server/src/routes/grades-sub/editRequests.ts` | 62 | `schoolYear: settings?.currentSchoolYear ?? "2026-2027",` |
| `src/pages/registrar/EOSYFinalization.tsx` | 199 | `const currentSY = settingsData?.settings?.currentSchoolYear \|\| "2026-2027";` |

**Root cause / failure scenario:** If `SystemSettings` is momentarily unreadable (DB blip, settings row recreated, or `currentSchoolYear` string lags the FK during sync), the code silently substitutes a **wrong year**. A `GradeEditRequest` stamped with the wrong `schoolYear` breaks the term-lock bypass lookup (see R7) and audit trail. The EOSY page could silently compute/display the wrong year's finalization data — during a rollover window this is exactly when settings are in flux.

**Required change:**
1. **Backend (`editRequests.ts`):** delete the direct `systemSettings.findUnique` + fallback. Import `getActiveSchoolYearLabel` from `../../lib/schoolYearResolver` and use its result for `schoolYear`. If it throws (no active year), return `503` `{ message: "School year not resolved; try again shortly" }` — fail loudly, never guess.
2. **Frontend (`EOSYFinalization.tsx`):** remove the `|| "2026-2027"` fallback. If settings query fails or returns no `currentSchoolYear`, render an explicit error/empty state ("Unable to resolve active school year") instead of assuming. Follow the page's existing error-state pattern.

**Must NOT:** add any other literal year string as a replacement.

**Acceptance criteria:** `rg "\?\? ['\"]20[0-9]{2}-20[0-9]{2}['\"]" server/src` and `rg "\|\| ['\"]20[0-9]{2}-20[0-9]{2}['\"]" src` return zero runtime hits (doc comments excluded). Backend test: when resolver throws, endpoint returns 503, not a request stamped with a wrong year.

---

### R3 — RolloverBanner hardcoded year check + non-year-scoped dismissal `P0 · HIGH`

**Location:** `src/components/RolloverBanner.tsx` (check at line 24: `if (sy && sy !== "2025-2026")`). Mounted in all three layouts: `TeacherLayout.tsx:142`, `RegistrarLayout.tsx:138`, `AdminLayout.tsx:163`.

**Root cause / failure scenario:** The banner's condition is "active year ≠ 2025-2026". Consequences:
- In EVERY year after 2025-2026 the condition is permanently true, so after each 7-day dismissal expiry the banner re-appears forever, in every school year, for all roles.
- The dismissal key (`rolloverBannerDismissed`) stores a timestamp only — it is not scoped to the year, so it cannot distinguish "dismissed for 2026-2027" from "dismissed for 2027-2028".

**Required change (show-once-per-year semantics):**
1. Replace the hardcoded comparison with a **last-seen year** mechanism:
   - localStorage key `rolloverBannerLastSeenYear` storing the year label the user has already acknowledged.
   - Show the banner only when fetched `settings.currentSchoolYear` is non-empty AND differs from `rolloverBannerLastSeenYear`.
   - On dismiss (X button), write the CURRENT active year into `rolloverBannerLastSeenYear` (so dismissal acknowledges the year, not just hides for 7 days).
2. Remove the 7-day timestamp logic and `SEVEN_DAYS_MS` / old `DISMISS_KEY` entirely (they become dead code). Optionally migrate: if old `rolloverBannerDismissed` exists, delete it.
3. Keep `.catch(() => {})` resilience (banner must never break layouts when the API fails).

**Acceptance criteria:**
- Fresh browser + active year X ≠ lastSeen → banner shows "School Year X is now active."
- Dismiss → reload → no banner (for year X).
- Simulated rollover to X+1 → banner shows again, exactly once.
- No literal year strings remain in the component.

**Verification:** manual check in dev server across two fake years (temporarily mock the settings response in devtools), plus a lightweight component test if a frontend test runner exists — otherwise document manual QA steps in the PR.

---

### R4 — Manual `/admin/archive-year` is non-atomic and diverges from auto-rollover `P0 · HIGH`

**Location:** `server/src/routes/admin-sub/system.ts:374-421`

**Root cause:** The endpoint performs six separate top-level awaits (`setYearLock`, 4× `updateMany`, `schoolYear.update`) with **no transaction and no advisory lock**. Versus the auto path it also: does not reset legacy `SystemSettings.gradeLock` to `false`, does not broadcast `SCHOOL_YEAR_ROLLOVER` SSE, does not share code with `rollover.ts`. Failure between awaits leaves a half-archived year (e.g., grades archived but sections still ACTIVE) that nothing detects or repairs.

**Required change:**
1. Extract the archive core into a shared exported function in `server/src/lib/rollover.ts`, e.g. `archiveSchoolYear(opts: { schoolYearId, yearLabel, actor: {id, name}, reason: string })`, implementing EXACTLY the R1 transactional pattern (advisory lock + idempotency check + all writes in one `tx`) plus year-lock, audit log, SSE broadcast, and legacy `gradeLock` reset.
2. `handleYearChangeRollover`'s clean-archive branch calls this shared function (reason: `Rollover: {label} archived`).
3. The admin endpoint keeps its existing guards (year exists, not already archived, `unfinalized === 0`, not the active year) and then calls the shared function (reason: `Manual archive by {username}`). Remove the inline updateMany block.
4. SSE payload should carry `action: "archived"`, previous year label, and the current active label so frontends can react identically for both paths.

**Acceptance criteria:**
- Both paths produce identical end-state for: Grade/Enrollment/Section/ClassAssignment flags, SchoolYear.status, year lock row, legacy gradeLock=false, audit entry, one SSE event.
- Killing the process mid-archive (test via injected throw) leaves NO partial state — all-or-nothing.
- Endpoint responses unchanged in shape (message + schoolYearId) to avoid frontend breakage (`RolloverStatusCard.tsx` consumer).

**Regression risks:** `RolloverStatusCard.tsx` depends on `/rollover-status` response shape — do not change that endpoint's contract in this issue.

---

### R5 — Failed rollover is swallowed and never retried `P0 · HIGH`

**Location:** `server/src/lib/schoolYearResolver.ts:148-167`

**Current behavior:** `SystemSettings.schoolYearId` FK is upserted to the NEW year **before** `handleYearChangeRollover` runs. Rollover errors are caught and logged as `(non-fatal)`. On the next sync, `prevSettings.schoolYearId === year.id` → rollover is never re-triggered. Result: old year sits unarchived AND unlocked, grades editable, no admin notification — a silent half-state persisting forever.

**Required change:**
1. **Fail-safe ordering inside `handleYearChangeRollover` (rollover.ts):** set the year lock on the previous year FIRST (before any archive attempt). If the archive transaction later throws, the old year is at least locked (safe, conservative state).
2. **Revert-on-failure (schoolYearResolver.ts):** in the existing `catch` around the rollover call, conditionally revert the FK: `systemSettings.updateMany({ where: { id: "main", schoolYearId: year.id }, data: { schoolYearId: prevSettings.schoolYearId } })` — the `where` guard prevents clobbering if another process legitimately advanced it. Then re-invalidate the cache and rethrow (or mark the sync as failed) so the failure is visible in sync history — do NOT silently swallow.
3. With (2), the next sync sees the FK still pointing at the old year, detects the delta again, and retries the rollover — self-healing.
4. Ensure idempotency from R1 (already-archived short-circuit) makes the retry safe when the archive actually succeeded but a post-step (audit/SSE) threw.

**Acceptance criteria:**
- Injected failure in the archive tx → FK reverts, year lock present, sync history records the error.
- Next `ensureSchoolYearFromEnrollPro` call retries and succeeds.
- Injected failure AFTER successful archive (e.g., in audit logging) → retry is a no-op (`no_change`/already-archived), no duplicate archive effects.

**Regression risks:** transient revert could surprise in-flight readers — acceptable: resolver cache is invalidated and 5-min TTL bounds staleness. Keep the revert update STRICTLY conditional (see `where` above).

---

### R6 — Attendance writes are not guarded against archived/old-year sections `P1 · HIGH`

**Locations:**
- `server/src/routes/attendance.ts:101` (`POST /clear`) and `attendance.ts:138` (`POST /bulk`)
- Schema: `Attendance` model (`server/prisma/schema.prisma:271-288`) has NO `isArchived` / `schoolYear` — it is section-scoped only.

**Root cause / failure scenario:** After rollover, an open teacher tab (or a crafted request) can still POST attendance for a section of the PREVIOUS year (`sectionId` still exists; `status = "COMPLETED"`, `archivedAt` set). Attendance for an archived year gets silently mutated/deleted. There is no read problem (historical attendance resolves year via `Section.schoolYear`) — this is purely a write-guard gap.

**Required change:**
1. In BOTH write endpoints, before mutating: load the section (`prisma.section.findUnique`) and reject with `409` if `section.status === "COMPLETED"` or `section.archivedAt != null` **or** `section.schoolYear !== await getActiveSchoolYearLabel()`. Error message should say attendance can only be recorded for the active school year.
2. Extract the guard into a small helper (e.g., `assertSectionAttendanceWritable(sectionId)`) used by both endpoints — keep routes thin per project convention.
3. Do NOT add an `isArchived` column to Attendance (unnecessary migration; section-scoped guard is sufficient). Historical reads keep working untouched.

**Acceptance criteria:** POST `/bulk` and `/clear` against a completed/archived or wrong-year section → 409, zero rows written/deleted. Active-year section → unchanged behavior.

**Verification:** extend server test suite (see §7) with attendance guard cases.

---

### R7 — `hasApprovedEditRequest` ignores `schoolYear` `P1 · MEDIUM`

**Location:** `server/src/lib/gradeLocks.ts:62-73`

**Root cause / failure scenario:** The TERM-lock bypass query filters only `teacherId + term + status + expiresAt`. `GradeEditRequest.schoolYear` is stored (see `editRequests.ts:62`) but not matched. Scenario: teacher gets a 168h-max APPROVED T1 edit request near the end of a year; rollover happens within that window; the new year's T1 gets term-locked late (scheduler locks on term end dates); the stale request from the PREVIOUS year still bypasses the NEW year's T1 lock. Narrow window, but it violates the lock-precedence invariant.

**Required change:**
1. Add `schoolYear` to the `where` clause of `hasApprovedEditRequest`; thread the label from `checkGradeEditLocks` (it already receives `opts.schoolYearLabel` — use that, which is the year of the grade being edited, not necessarily the active year).
2. Update any other direct callers of `hasApprovedEditRequest` (grep first) to pass the label.

**Acceptance criteria:** APPROVED request for year A/T1 does NOT unlock year B/T1; still unlocks year A/T1 within expiry. Extend `server/src/__tests__/grade-lock.test.ts`.

---

### R8 — Archive trusts promotion flags without verifying snapshots exist `P1 · MEDIUM`

**Locations:** archive decision in `rollover.ts` (via `listUnfinalizedSections`) and the guards in `system.ts:392`.

**Root cause:** `finalized` is computed from stored `enrollment.promotionStatus` + zero draft blockers (`promotion.ts:327-353`). `GradeSnapshot` rows are created by `finalizeSectionEosy` — but nothing verifies they still exist at archive time (retention cleanup `gradeSnapshotRetentionDays`, older code paths, or manual DB edits could have removed them). Archiving without snapshots can degrade SF10/SF-form reproduction for that year.

**Required change (defense in depth):**
1. Inside the shared archive function from R4 (i.e., inside the same transaction), for the year being archived: for each section, compare `count(Grade where classAssignment.sectionId = s, classAssignment.schoolYear = label, status = "FINALIZED")` vs `count(GradeSnapshot where sectionId = s, schoolYear = label, snapshot.path('source') = "EOSY_FINALIZE")`.
2. If any section has snapshots < finalized grades → ABORT the archive with an explicit result/HTTP error listing the section names ("snapshot gap"). This turns a silent data-loss risk into a visible admin action item.
3. Sections with zero finalized grades pass trivially.
4. Use aggregate/groupBy queries (no N+1 — see R9 note).

**Acceptance criteria:** year with a deliberate snapshot gap cannot be archived (auto or manual) and the error names the offending sections; year with complete snapshots archives as before.

---

### R9 — `listUnfinalizedSections` is N+1 and called on hot paths `P1 · MEDIUM`

**Location:** `server/src/lib/promotion.ts:345-353` (loops sections → `getSectionEosyStatus` → `computeSectionPromotions`, which loads enrollments + grades per section).

**Root cause:** With S sections this issues O(S) heavy query batches. It runs during rollover (inside the R1 transaction — holding the advisory lock longer) and on every admin dashboard poll of `/rollover-status`.

**Required change:**
1. Refactor to two bulk queries per year: one for all enrollments (with students), one for all FINALIZED grades (with classAssignment), then compute per-section promotion status in memory using the SAME decision logic as `computeSectionPromotions` (reuse the pure decision function — do NOT duplicate/copy the promotion rules).
2. Preserve the exact `SectionEosyStatus` output shape (consumers: `system.ts` rollover-status + archive guards, `rollover.ts`).
3. If R1 threading `tx` through is implemented, the bulk version must accept the transaction client too.

**Acceptance criteria:** identical outputs vs old implementation on a seeded dataset (write a parity test — see §7 T6); `/rollover-status` latency with a realistic section count stays well under 2s in dev.

---

### R10 — `/rollover-status` previous-year detection edge case `P2 · LOW`

**Location:** `server/src/routes/admin-sub/system.ts:354` — `years.find(y => y.id !== currentSY?.id && y.status !== "ARCHIVED")`.

**Issue:** If more than one non-archived, non-active year ever exists (e.g., a failed R5-style scenario left two pendings), it silently picks the first by label-desc order with no indication. Low likelihood after R5, but the endpoint should be deterministic.

**Required change:** select the single most recent qualifying year (label-desc, take first — already implicit) AND include a `pendingYearsCount` field when > 1 so the admin UI (`RolloverStatusCard.tsx`) can surface "multiple unarchived years detected". Backward-compatible additive change only.

**Acceptance criteria:** response shape unchanged except optional new field; card still renders when field absent.

---

### R11 — Type-unsafe audit logging in rollover.ts `P2 · LOW`

**Location:** `server/src/lib/rollover.ts:79, 85, 108, 114` — `"CONFIG" as any`, `"WARNING" as any`, synthetic actor `as any`.

**Root cause:** `AuditAction.CONFIG` and `AuditSeverity.WARNING` already exist (used in `system.ts`) — the casts are leftover shortcuts that defeat type-checking of audit arguments.

**Required change:** import `AuditAction, AuditSeverity` from `@prisma/client` and use the real enum members; type the synthetic system actor to match `createAuditLog`'s expected user shape (or extend `createAuditLog` with an explicit system-actor overload in `lib/audit.ts` if the shape demands it — additive only). No behavior change to the audit payloads (same action/severity values).

**Acceptance criteria:** zero `as any` in `rollover.ts`; `server npm run build` clean; audit rows unchanged.

---

### R12 — RolloverBanner light-theme-only styling `P2 · LOW`

**Location:** `src/components/RolloverBanner.tsx:34-47` — hardcoded `bg-blue-50 border-blue-200 text-blue-800` etc.

**Issue:** In dark mode (ThemeContext) the banner renders as a jarring light strip. Cosmetic only.

**Required change:** swap fixed classes for the project's existing theme-aware tokens/patterns (inspect neighboring banner components like `GradeDeadlineBanner.tsx` and follow the same convention). No logic changes.

**Acceptance criteria:** visually correct in both themes; no functional diff.

---

### R13 — ATLAS runtime rollover-sync/apply returns HTTP 500 `EXT · VERIFY ONLY`

**Context (from prior audit findings):** EnrollPro-side `POST /api/v1/runtime/rollover-sync/apply` fails with a `facultyMirror.upsert` constraint error, so ATLAS teaching-load propagation after rollover cannot be validated end-to-end. **This is NOT SMART code** — SMART must not attempt to fix or write to it (read-only integration rule).

**SMART-side actions (allowed):**
1. Verify SMART's ATLAS teaching-load consumer (`server/src/lib/atlasSync.ts`, `atlasUtils.ts`, `workload.ts`) handles a post-rollover payload gracefully: new-year sections with no assignments yet, missing adviser data, empty loads. No crashes, no phantom old-year writes.
2. Confirm sync failure visibility: a 500 from ATLAS must surface in `SyncHistory` + System Health (`systemHealth.ts`) rather than being swallowed — if gaps found, file as a NEW issue; do not bundle fixes here.
3. Track the external fix with the EnrollPro team; re-run the rollover rehearsal (§8) once unblocked.

**Acceptance criteria:** SMART degrades safely (logs + health status) when the external endpoint 500s; documented in the rehearsal checklist.

---

### R14 — Alumni list misclassifies continuing students during rollover window `P0 · HIGH (registrar-facing)`

**Locations:**
- `server/src/routes/registrar/main.ts:899-918` (`GET /alumni` classification logic)
- Context: `BOSYQueue.tsx` and `ApplicationTracker.tsx` are **orphaned dead code** (no route/nav). Re-enrollment happens entirely in EnrollPro; SMART learns about new-year enrollments only via sync.

**Root cause / failure scenario:** `/alumni` defines alumni as "students whose latest enrollment is NOT in the current school year with status ENROLLED." Between EnrollPro rollover and the sync that pulls new-year enrollments, EVERY continuing student (PROMOTED, CONDITIONALLY_PROMOTED, RETAINED) matches that definition. The window is not seconds — it lasts until EnrollPro-side enrollment + sectioning completes and SMART syncs it (could be days/weeks at BOSY). During this window the registrar's Alumni list shows the whole continuing population mixed with genuine JHS completers/transfers/drops — a trust-destroying defect for the primary consumer of that page.

**Required change:**
1. Refine the alumni classification: a student whose LATEST enrollment has `promotionStatus` in (`PROMOTED`, `CONDITIONALLY_PROMOTED`, `RETAINED`) and is NOT `JHS_COMPLETER` should be classified as **"awaiting re-enrollment"** (continuing), NOT alumni — unless the current school year has advanced AND a newer enrollment exists that marks them TRANSFERRED/DROPPED, or a configurable grace period has passed.
2. Suggested concrete rule (implementer may refine with registrar input, but must preserve these invariants):
   - `JHS_COMPLETER` latest enrollment → alumni (genuine completer).
   - Latest enrollment TRANSFERRED/DROPPED → alumni (feeds already handle this).
   - PROMOTED/CONDITIONALLY_PROMOTED/RETAINED with no current-year enrollment → **excluded from alumni**; optionally surfaced in a separate "Awaiting Re-enrollment" count/filter on the alumni page (additive query param, e.g. `?include=continuing`) so registrars can still find them deliberately.
3. Keep the EnrollPro merge feeds (TRANSFERRED/DROPPED/GRADUATED) unchanged.
4. Add tests covering: completer → alumni; promoted-with-no-new-enrollment → NOT alumni; retained → NOT alumni; promoted + later TRANSFERRED enrollment → alumni.

**Acceptance criteria:** after a simulated rollover (new SY active, no new enrollments synced), the alumni list contains only completers/transfers/drops — zero continuing students. AlumniStudents.tsx renders without changes (backend-only fix preferred); any frontend additions are additive.

**Dead-code cleanup (bundle with this issue, delete-only):**
- `src/pages/registrar/BOSYQueue.tsx` (orphaned page)
- `src/pages/registrar/ApplicationTracker.tsx` (orphaned page — verify no dynamic/lazy import string references before deleting; grep `ApplicationTracker` and `bosy` in `src/` after removal)
- `bosyApi` block in `src/lib/api.ts:1010-1015` (only consumer was the orphaned page)
- `server/src/routes/registrar/bosy.ts` + its mount in `server/src/routes/registrar.ts:6` + `getEnrollProBosyExpectedQueue` in `enrollproClient.ts` (deprecated upstream) — remove route registration; keep or remove the client function with the route. Confirm no other backend callers first.
- AGENTS.md file-map references to BOSYQueue/ApplicationTracker (update doc lines only).

---

## 5. Phased Execution Order

| Phase | Issues | Rationale / Dependency |
|-------|--------|------------------------|
| **0 — Baseline** | none | Run all DoD commands; record existing test state; tag/branch from clean `git status`. Any pre-existing failures are documented, not silently absorbed. |
| **1 — Core rollover correctness** | **R1 → R4 → R5** | R1 introduces the transactional pattern + `tx` threading; R4's shared `archiveSchoolYear` builds on it; R5 depends on R1's idempotency + R4's shared path. Strict order. |
| **2 — Data & code hygiene** | **R2, R3, R7, R14** | Independent of each other; R7 pairs naturally with R2 (both touch edit-request year semantics). R14 is registrar-facing P0 but backend-only + deletions — no dependency on Phase 1. |
| **3 — Hardening** | **R6, R8, R9** | R8 and R9 both touch archive/promotion queries — do R9 first if implementing the bulk refactor, then R8 rides the bulk queries. |
| **4 — Polish** | **R10, R11, R12** | Independent; trivial; R11 keeps builds honest for everything else. |
| **5 — External verify + rehearsal** | **R13** + §8 runbook | Execute only the verification steps; fix nothing external. |

**Cross-cutting rule:** after EACH issue, run the full DoD command set. Do not batch verification.

---

## 6. Files Touched (Summary Map)

| File | Issues |
|------|--------|
| `server/src/lib/rollover.ts` | R1, R4, R5 (ordering), R8, R11 |
| `server/src/lib/schoolYearResolver.ts` | R5 |
| `server/src/lib/promotion.ts` | R1 (`tx` threading), R8, R9 |
| `server/src/lib/gradeLocks.ts` | R7 |
| `server/src/routes/admin-sub/system.ts` | R4, R10 |
| `server/src/routes/grades-sub/editRequests.ts` | R2 |
| `server/src/routes/attendance.ts` | R6 (new guard helper, likely `server/src/lib/` or route-local per convention) |
| `src/components/RolloverBanner.tsx` | R3, R12 |
| `src/pages/registrar/EOSYFinalization.tsx` | R2 |
| `server/src/routes/registrar/main.ts` | R14 (`/alumni` classification) |
| `server/src/routes/registrar/bosy.ts` (+ mount in `registrar.ts`) | R14 (delete) |
| `server/src/lib/enrollproClient.ts` | R14 (delete deprecated BOSY client fn) |
| `src/lib/api.ts` | R14 (delete orphaned `bosyApi`) |
| `src/pages/registrar/BOSYQueue.tsx`, `src/pages/registrar/ApplicationTracker.tsx` | R14 (delete orphaned pages) |
| `AGENTS.md` | R14 (file-map line updates only) |
| `server/src/__tests__/` (new + extended) | all |

No Prisma schema migrations are required by this plan (explicitly avoids R6-column and any enum changes).

---

## 7. Test Plan (vitest — `server/`, `npm test`)

| ID | Test | Covers |
|----|------|--------|
| T1 | `rollover.test.ts` — clean archive: seed finalized year → run `handleYearChangeRollover` → assert all six archive effects + year lock + audit + SSE payload | R1, R4 |
| T2 | Concurrent double-invoke (Promise.all, same inputs) → exactly one archive, second is `no_change` | R1 |
| T3 | Unfinalized path: seed draft grades → run → assert NOTHING archived, year locked, SSE carries `unfinalizedSections` | R1 |
| T4 | Manual `/admin/archive-year` parity: same seeds as T1 → identical end-state diff vs auto path (compare table flags/locks/audit) | R4 |
| T5 | Failure injection: archive tx throws → FK reverted, year locked, error visible; next call retries; post-archive failure → retry is a safe no-op | R5 |
| T6 | Parity test: old vs new `listUnfinalizedSections` outputs identical on seeded multi-section dataset | R9 |
| T7 | Snapshot gap: delete a snapshot row → archive (auto + manual) rejected, error names the section; complete snapshots pass | R8 |
| T8 | Extend `grade-lock.test.ts`: cross-year APPROVED request does not bypass new year's term lock; same-year does | R7 |
| T9 | `attendance` guard: POST bulk/clear on completed/archived/wrong-year section → 409, zero writes; active year → works | R6 |
| T10 | Edit-request creation: resolver failure → 503; success → stamped with resolved label (no literal year) | R2 |
| T11 | Alumni classification: JHS_COMPLETER → alumni; PROMOTED/RETAINED with no current-year enrollment → NOT alumni (excluded or "awaiting re-enrollment"); latest TRANSFERRED/DROPPED → alumni. Simulate rollover state: new SY active, zero new enrollments → alumni list contains only completers/transfers/drops | R14 |

Testing notes for the implementer:
- Follow conventions of existing tests in `server/src/__tests__/` (e.g., `grade-lock.test.ts`) for DB setup/teardown.
- SSE assertions: `broadcastSseEvent` is importable — spy/mock it; never assert on real sockets.
- Tests must not depend on wall-clock years. Seed explicit labels ("2098-2099", "2099-2100").

---

## 8. Pre-Rollover Go/No-Go Runbook (for the day EnrollPro proceeds)

Complete IN ORDER. Do not skip gates.

1. [ ] All phases 0–4 merged; full DoD green (`npm run build`, `npm run lint`, `npm test` in both roots).
2. [ ] Every section of the current year: EOSY finalized (registrar → `EOSYFinalization`), zero DRAFT grades.
3. [ ] Admin → Rollover status: `unfinalizedCount === 0`, `canArchive === true`.
4. [ ] EnrollPro side: confirm they will run their rollover; note the exact time (for audit correlation).
   - **Take a full SMART DB backup (`pg_dump`) BEFORE EnrollPro executes rollover** and store it off-host. This is the recovery point referenced by the Rollback posture below.
   - **Critical dependency (verified in `mdfiles/ENROLLPRO-DEV-HANDOFF-2026-08-07.md`):** EnrollPro's `POST /api/school-years/rollover` is gated by `GET /api/system/rollover-readiness`, which blocks with `SMART_OUTCOME_MISSING` until it can pull grade outcomes from SMART's inbound endpoints (`POST /api/integration/{smart/}sections/:sectionId/sync-grades`, `serviceAuth`-protected). **SMART must be ONLINE and reachable from EnrollPro at rollover time**, with all sections' EOSY outcomes pullable — otherwise EnrollPro devs may fall back to seeding dev fixtures (handoff Option B), which decouples their rollover from real SMART data. Confirm with the EnrollPro operator which path they will take.
5. [ ] Trigger a SMART unified sync (Admin → System Health → Run sync) immediately after EnrollPro rollover — do not wait for the 30-min scheduler.
6. [ ] Verify in SMART: new `SchoolYear` ACTIVE + linked; previous year ARCHIVED; grades/enrollments flagged; year lock ON; admin/teacher dashboards render the NEW year; `RolloverBanner` shows once, then dismisses cleanly.
7. [ ] **Registrar check — Alumni list:** contains ONLY completers/transfers/drops. Zero continuing (promoted/retained) students visible there. Continuing students remain findable via StudentRecords/history queries until EnrollPro re-enrollment sync lands.
8. [ ] Spot-check one archived section: SF-form view (schoolYear-string query) still returns complete data; grade edit attempts blocked with `ARCHIVED`/`YEAR_LOCKED` messages.
9. [ ] If step 6 shows `locked_not_archived`: open `/rollover-status`, resolve listed sections (finalize or admin decision), then use manual archive — with R4 it is now identical to the auto path.
10. [ ] Post-check ATLAS teaching loads (R13): failures must appear in System Health, not silently vanish.
11. [ ] Archive the audit log entries + sync history screenshots to the rollover incident record.

**Rollback posture:** this plan changes no external systems and requires no schema migration; the recovery path for any failed step is the R5 retry semantics + manual admin archive. Keep the pre-rollover DB backup taken in step 4 regardless.

---

## 9. Out of Scope / Adjacent Observations (do NOT fix in this effort)

- `GET /api/admin/settings` (`system.ts:65`) has no `authenticateToken` middleware — likely intentional (login-page branding) but worth a separate security review; not a rollover blocker.
- `SystemSettings.currentSchoolYear` string vs `schoolYearId` FK dual-write — already mitigated by resolver priority; consolidation is a separate refactor.
- Grade 10 → `JHS_COMPLETER` end-to-end verification with EnrollPro (separate integration test effort).
- Any EnrollPro/ATLAS-side defects (R13 root cause lives there).
- **Stale `currentTerm` DB fallback after rollover:** `resolveCurrentTerm()` prefers EnrollPro's live `/integration/v1/active-term` and self-corrects to the new year's T1 on first successful call. Only if EnrollPro is unreachable immediately post-rollover does the DB fallback hold the OLD year's last term (T3), which could prematurely allow new-year T1/T2 edit requests until connectivity returns. Edge case (requires EnrollPro down + teacher filing edit requests in that window); handle separately if it materializes.

---

## Appendix A — EnrollPro API Alignment Audit (2026-08-30, live-probed)

Method: every SMART→EnrollPro call site in `server/src/lib/enrollproClient.ts` cross-checked against the code-verified catalog (`mdfiles/ENROLLPRO-API.md`) AND live-probed against `https://dev-jegs.buru-degree.ts.net/api` (unauthenticated GET; 401 = route mounted + key-gated, 404 = unmounted).

### Verdict: SMART is ALIGNED. No code changes required from this audit.

| SMART calls | Live probe | Key sent? | Status |
|---|---|---|---|
| `GET /integration/v1/health` | 200 | yes | ✅ aligned |
| `GET /integration/v1/school-year` | 401 (mounted) | yes | ✅ aligned |
| `GET /integration/v1/active-term` | 401 (mounted) | yes | ✅ works — **but missing from the API catalog** (see A1) |
| `GET /integration/v1/learners` (+pagination) | 401 (mounted) | yes | ✅ aligned |
| `GET /integration/v1/sections` | 401 (mounted) | yes | ✅ aligned |
| `GET /integration/v1/faculty` | 401 (mounted) | yes | ✅ aligned |
| `GET /integration/v1/sections/:id/learners` | 401 (mounted) | yes | ✅ aligned |
| `GET /integration/v1/default/smart/students` | 401 (mounted) | yes | ✅ aligned |
| `GET /settings/public` | 200 | n/a (public) | ✅ aligned |
| `POST /auth/login` (admin token + teacher SSO) | documented | n/a | ✅ aligned |
| Internal: `/api/teachers`, `/api/sections`, `/api/students(/:id)`, `/api/school-years` | documented (role-gated) | admin JWT | ✅ aligned — client falls back to partner feed on failure |
| Internal: `/api/eosy/sections(/:id/records, /:id/exports/sf5)`, `/api/eosy/exports/sf6` | documented (Registrar/Admin) | admin JWT | ✅ aligned |
| Internal: `/api/remedial/pending` | documented | admin JWT | ✅ aligned (RemedialTracker) |
| `GET /api/bosy/queue` | 401 (mounted) | admin JWT | mounted but only consumed by dead BOSY code — removed by R14 |
| `GET /api/bosy/expected-queue` | **404 — CONFIRMED UNMOUNTED** | n/a | dead; SMART call site already `@deprecated`, removed by R14 |

### Findings

- **A1 (doc fix, no code):** `/integration/v1/active-term` is mounted and key-gated on the live instance but absent from `ENROLLPRO-API.md`'s Partner v1 table (which claims those feeds are "public" — they are key-gated in reality). SMART depends on this endpoint for ALL term resolution (`resolveCurrentTerm()`, branding sync). Action: ask EnrollPro team to add it to the official catalog (or update `mdfiles/ENROLLPRO-API.md` locally with a note that it requires `X-Integration-Key`), so a future EnrollPro refactor doesn't silently drop an endpoint SMART's grading system depends on.
- **A2 (config risk, no code):** The API catalog marks ALL partner v1 feeds "Public", but live probing shows they return 401 without `X-Integration-Key`. SMART already sends the key everywhere — alignment is fine — but the catalog is stale. If EnrollPro ever rotates or removes the key, SMART's syncs degrade to DB fallback silently. Covered by runbook step 5 (sync verification) — no code change needed.
- **A3 (account role dependency):** Internal-route pulls (`/api/eosy/*`, `/api/remedial/pending`, `/api/bosy/queue`) depend on the `ENROLLPRO_ACCOUNT_NAME` integration account having Registrar/Admin-level role on EnrollPro. Cannot be verified from SMART's side; roles are enforced by EnrollPro. If pulls start failing with 403, escalate to the EnrollPro operator.
- **A4 (rollover gate — good news):** EnrollPro's own rollover is blocked (`SMART_OUTCOME_MISSING`) until it successfully pulls grade outcomes from SMART's inbound `sync-grades` endpoints. This means EnrollPro CANNOT silently roll over without SMART's finalized EOSY data (unless they bypass via dev fixture seeding). This significantly narrows the R5 race window — but SMART uptime at rollover time becomes a hard dependency (see runbook step 4).
