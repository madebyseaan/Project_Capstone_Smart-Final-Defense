# Sync Outage Guardrail — Research & Proposed Fix Plan

> Status: **PHASES 1–5 IMPLEMENTED** (guards + tests; SystemHealth banner; audit hygiene; audit cleanup; 2026-2027 reconciled) — deployed & verified
> Author: AI research pass (for review)
> Date: 2026-09-11

## TL;DR

The 2026-09-10 incident (257 class records soft-archived during an EnrollPro outage) was caused by our own sync code running a "cleanup" step with **incomplete data**. The DB is already our offline cache — reads work fine during outages. The fix is to make every **destructive** sync step (archive / suspend / drop / delete) fail-closed: **never act on data we can't trust**.

This plan:
1. Documents the confirmed root cause.
2. Lists **6 latent bugs** found in the same class during the research pass.
3. Proposes a layered fix that **does not change behavior when EP/Atlas are healthy** (no regression).
4. Includes tests and a recovery/observability story.

---

## 1. The Incident (confirmed root cause)

### Timeline from pm2 logs (sync cycle #22, 2026-09-10 19:23:53–19:24:06)

| Time | Log | Meaning |
|---|---|---|
| 19:23:53 | `[EnrollProSync] Fatal error: HTTP 500 .../sections?schoolYearId=5` | EP sections feed failed |
| 19:23:53 | `[syncTransferees] Failed: HTTP 500` | EP transferees feed failed |
| 19:23:55 | `[AtlasSync] Effective teaching load: state=POPULATED, assignments=265, version=2` | **Atlas was fine** |
| 19:23:56 | `Version 2 already applied for scope 1:9 — skipping upserts` | idempotency guard |
| 19:23:56 | **`Soft-archived 257 stale ClassAssignment(s) (effectiveLoadState=POPULATED)`** | **the damage** |
| 19:24:06 | `Sync cycle #22 complete ... EnrollPro: 0 learners, 0 advisories` | EP contributed nothing |

### Root-cause chain (the bug)

1. Coordinator sees EP "offline" and Atlas "online" → **partial sync** → runs AtlasSync (`syncCoordinator.ts:318-340`).
2. AtlasSync fetches the effective load fine — **POPULATED, 265 assignments** (`atlasSync.ts:278-287`).
3. But each assignment must be resolved against **EnrollPro sections**. EP is down, so `getAllIntegrationV1Sections()` throws → `epSectionById` stays **empty** (`atlasSync.ts:141-153`).
4. Every effective-load row fails resolution (`atlasSync.ts:304-307`) → `loads = []` → `desiredAssignmentPairs = {}`.
5. The stale-check compares DB assignments against an **empty desired set** and treats all 257 as stale → soft-archives them (`atlasSync.ts:565-598`).

### Why the existing guards didn't help

- There IS a 2-cycle guard for `EMPTY` load state (`atlasSync.ts:495-532`) — but the load was `POPULATED`, so it never applied.
- There IS an idempotency guard that skipped upserts — but the **stale-check still runs** even when upserts are skipped (`atlasSync.ts:414`).
- There is **no guard** for the case: *"load is POPULATED, but we could not resolve it against EP sections."* The resolution errors are recorded but never consulted before archiving.

---

## 2. Research Pass — Bugs found in the same class

While scanning every destructive-write path, I found the incident bug plus **6 latent bugs**. All share one pattern: **a cleanup step trusts external data without verifying that the data is complete.**

| # | Location | Risk | Detail |
|---|---|---|---|
| **B1** | `atlasSync.ts:565-598` | 🔴 **CONFIRMED INCIDENT** | POPULATED load + unresolvable EP sections → mass-archive |
| **B2** | `enrollproSync.ts:868-917` | 🔴 HIGH | **Stale-enrollment drop has NO empty-learner guard.** If the learners fetch fails/returns `[]` (health check passed, data endpoint 500s), `allSyncedStudentIds` is empty → **every ENROLLED enrollment is marked TRANSFERRED**. This is the enrollment twin of the incident. |
| **B3** | `enrollproSync.ts:919-961` | 🔴 HIGH | **Orphaned-section cleanup has NO empty-section guard.** If EP returns `[]` sections, every SMART section looks orphaned → enrollments DROPPED + sections deleted. |
| **B4** | `enrollproSync.ts:295-327` | 🟠 MED | Teacher deactivation has an **empty-list guard** (`epEmpIds.size===0` → skip) ✅ but **no ratio circuit breaker**. A *partial* EP faculty response (10 of 40 teachers) would suspend 30 legitimate teachers + archive their assignments. Prune has a ratio breaker; this path doesn't. |
| **B5** | `teacherSync.ts:732` (`dropStaleEnrollments` in `sync/utils.ts:135-162`) | 🟠 MED | Runs **on every teacher login**. If a roster fetch returns `[]` (EP blip), `dropStaleEnrollments` drops ALL currently enrolled students in that section. No empty-roster guard. |
| **B6** | `atlasSync.ts:820-824` (ScheduleEntry cleanup) | 🟡 LOW | Deletes schedule entries not in the current resolved set. If section resolution fails, the resolved set is smaller than reality. Mitigated: only runs when `filteredScheduleEntries.length > 0`, so a full resolution failure is safe — but a *partial* resolution isn't. |
| **B7** | `syncCoordinator.ts:642-656` | 🟡 DESIGN | **Health check is a single endpoint ping.** `/health` returned OK while data endpoints 500'd (that's exactly how the incident ran). The health ping is a weak gate; real safety must live in the data-consuming steps. |

### What's already correct (keep, don't break)

- `prune.ts:606-647` — **empty-set guards** (teachers/learners/sections all `===0` → abort).
- `prune.ts:690-720` — **shape guards** (empty enrollment-pair / section-key sets → abort).
- `prune.ts:215-248` — **ratio circuit breaker** (`maxDeletionRatio`).
- `enrollproSync.ts:297-301` — teacher deactivation empty-list guard.
- `rollover.ts:263-275` — unfinalized-section guard (worked: it locked 2030-2031 instead of archiving).
- `atlasSync.ts:495-532` — EMPTY-load 2-cycle confirmation guard.
- `atlasSync.ts:566-570` — `MANUAL` assignments protected from stale-check.
- `teacherSync.ts:550-564` — teacher-level sync never deactivates assignments (global sync owns that).
- `auth.ts:99-102` — login gate falls back to local status when EP unreachable.

These are the **existing guardrail patterns** we should replicate, not remove.

---

## 2A. Full Dependency Matrix — every combination

I enumerated **all** combinations of the 4 systems (EnrollPro, Atlas, AIMS, SMART-local). The coordinator gates only EP and Atlas; AIMS is independent/fail-soft; SMART (our DB) is always online by definition (if our DB is down, nothing works — separate infra concern).

Legend: ✅ safe · ⚠️ guard needed · 🔴 must-fix

| # | EP | Atlas | AIMS | Coordinator behavior | Destructive steps that run | Verdict |
|---|---|---|---|---|---|---|
| 1 | ✅ | ✅ | ✅ | **Full sync** | EP sync (teacher deact B4, learner sync, orphaned sections B3, stale enroll drop B2) + Atlas sync (stale-check B1) + prune + AIMS | ⚠️ all guards apply but inputs are complete → safe |
| 2 | ✅ | ✅ | ❌ | **Full sync**, AIMS fail-soft | Same as #1 | ⚠️ safe |
| 3 | ✅ | ❌ | ✅ | **Partial sync** (Atlas offline) | EP steps only: teacher deact B4, section sync, learner sync, orphaned-section drop B3, stale-enroll drop B2, prune. **Atlas stale-check skipped.** AIMS runs. | ⚠️ needs B2/B3/B4 guards (empty + ratio) — **without them, a partial/empty EP response is destructive** |
| 4 | ✅ | ❌ | ❌ | **Partial sync** (Atlas offline) | Same as #3, no AIMS | ⚠️ same as #3 |
| 5 | ❌ | ✅ | ✅ | **Partial sync** (EP offline) | **Atlas stale-check runs (B1)** ← THE INCIDENT. EP steps skipped. AIMS runs (harmless, no matchable students). | 🔴 **B1 incident path** — must-fix |
| 6 | ❌ | ✅ | ❌ | **Partial sync** (EP offline) | Same as #5 | 🔴 same as #5 |
| 7 | ❌ | ❌ | ✅ | **Both offline → skip cycle**, circuit breaker opens. **AIMS also skipped** (early-return at `:208` before step 5). | None | ✅ safe (minor: AIMS not attempted even though it's independent) |
| 8 | ❌ | ❌ | ❌ | **Both offline → skip cycle** | None | ✅ safe |

### Additional entry points (bypass the coordinator's gating!)

These call the sync functions **directly** and don't go through the `epOffline`/`atlasOffline` gates — so internal guards (5.2–5.5) are mandatory, not optional:

| Entry point | Calls | Outage risk |
|---|---|---|
| `POST /api/sync/all` | `runUnifiedSync` (gated) | safe (gated) |
| `POST /api/sync/atlas` (`sync.ts:67`) | **`runAtlasSync()` direct** | 🔴 B1 if EP down |
| `POST /api/admin/atlas-sync/run` (`classAssignments.ts:29`) | **`runAtlasSync()` direct** | 🔴 B1 if EP down |
| `POST /api/admin/enrollpro-sync/run` (`classAssignments.ts:40`) | **`runEnrollProSync()` direct** | ⚠️ B2/B3/B4 if EP partial |
| Teacher login (`auth.ts:203`) | `triggerImmediateSync('login')` | gated ✅ |
| Advisory page load (`advisory.ts:788`) | `syncTeacherOnLogin()` → `dropStaleEnrollments` | ⚠️ B5 if roster fetch returns `[]` |
| Registrar page load (`registrar/main.ts`) | `triggerImmediateSync(...)` | gated ✅ |

### Key takeaways from the matrix

1. **#5/#6 are the must-fix** — exactly the incident. Fix = 5.1 (coordinator skips Atlas when EP offline) + 5.2 (internal fail-closed guard), so direct triggers are also safe.
2. **#3/#4 need B2/B3/B4** — EP is "online" but a partial/empty EP response is just as destructive as a full outage. Empty-set + ratio guards cover this.
3. **#7/#8 are safe** by design (nothing runs), but AIMS is skipped even when it's up — optional future improvement, not a bug.
4. **Login/advisory paths (B5)** are outside the coordinator entirely — the `dropStaleEnrollments` guard (5.4) must live inside the function, not in the coordinator.

---

## 3. Recovery path (what happens after EP comes back)

- AtlasSync stale-check **does** reactivate assignments that reappear in the desired set (`atlasSync.ts:575-579`, `:677-687`). The 257 archived records should **auto-restore** on the first good sync once EP sections resolve.
- The `atlasAppliedVersion` idempotency guard keeps upserts skipped, but the stale-check still runs and reactivates. ✅
- Admin can also restore manually: `POST /api/admin/class-assignments/:id/restore` (`classAssignments.ts:357`) — sets `source: 'MANUAL'` which then permanently protects it from stale-check.
- **To verify:** add a test asserting archived-but-desired assignments are reactivated on the next successful sync (currently untested).

---

## 4. Proposed Fix — Design Principles

**Principle 1 — Fail-closed reconciliation.** A destructive sync step (archive / suspend / drop / delete) may only run when the source data is **confidently complete**. "Complete" means: non-empty EP sections, non-empty EP learners, and effective-load resolution coverage above a threshold. Any doubt → **skip the destructive phase**, log it, audit it, and surface it in the UI.

**Principle 2 — The safety lives at the data step, not the health ping.** Never trust a single `/health` endpoint to decide "safe to reconcile." Each data-consuming step verifies its own inputs (the prune-engine pattern).

**Principle 3 — Coverage + ratio circuit breakers.** Where a path has no empty-guard, add both:
- *Empty-set guard*: input list is empty → abort.
- *Ratio breaker*: fraction to be destroyed vs. total active is too high (e.g. > 50%) → abort. (Partial EP responses can't mass-wipe us.)

**Principle 4 — Zero behavior change when healthy.** All guards only trip on **empty / partial / unresolvable / high-ratio** inputs. When EP and Atlas respond fully, behavior is identical to today. This is the anti-regression guarantee.

**Principle 5 — Defense in depth.** Both the coordinator **and** the sync module itself must guard (manual triggers like `POST /api/sync/atlas` or `/api/admin/atlas-sync/run` must be just as safe as scheduled runs).

---

## 5. Proposed Fix — Concrete Changes

### 5.1 Coordinator: dependency-aware Atlas gating (`syncCoordinator.ts`)

- **Change:** Skip AtlasSync when EnrollPro is offline, because Atlas ownership resolution depends on EP sections (`:318-340`).
- Why not just rely on B1's internal guard? Because running AtlasSync during an EP outage is wasted work, and the internal guard is still the backstop for manual triggers.
- **Anti-regression:** when EP is online, AtlasSync runs exactly as today. When EP is offline AND Atlas is offline, the existing "both offline → skip" path already applies.
- **Matrix coverage:** fixes rows #5 and #6 (EP-off/Atlas-on). Rows #7/#8 already skip via the both-offline branch.

### 5.1b Direct-trigger hardening (`sync.ts`, `classAssignments.ts`)

- The direct endpoints (`POST /api/sync/atlas`, `/api/admin/atlas-sync/run`, `/api/admin/enrollpro-sync/run`) bypass the coordinator gates.
- **Change:** wrap them in a lightweight health check (reuse `checkCriticalDependencies()`), returning a friendly error like `"Atlas sync skipped — EnrollPro offline (fail-closed)"` instead of running the destructive path. These are admin-only manual buttons; returning a clear message is safe and expected.
- **Anti-regression:** when dependencies are healthy, the buttons behave exactly as today.
- **Matrix coverage:** closes the "direct entry point" rows for #3–#6.

### 5.2 AtlasSync: fail-closed stale-check (`atlasSync.ts`)

Introduce a **resolution-confidence flag** computed right after the effective-load processing:

```ts
// NEW: after section 5.1
const sectionResolutionFailed =
  epSectionById.size === 0 ||                          // EP sections unavailable
  (effectiveLoad.assignments.length > 0 && loads.length === 0); // POPULATED but 0 resolved
const resolutionCoverage =
  effectiveLoad.assignments.length > 0
    ? loads.length / effectiveLoad.assignments.length
    : 1;
const confidentToReconcile =
  effectiveLoadState !== 'POPULATED' ||
  (!sectionResolutionFailed && resolutionCoverage >= MIN_RESOLUTION_COVERAGE);
```

- **If `!confidentToReconcile`:** skip the entire stale-check archive block, log `[AtlasSync] Archive skipped — EP sections unresolvable (fail-closed)`, and write an audit warning. Upserts/reactivations may still proceed (they only add/restore, never destroy).
- Add a **ratio circuit breaker** on the archive set itself: if `archiveIds.length / currentAssignments.length > MAX_ARCHIVE_RATIO` (e.g. 0.5), abort the archive (mirrors prune's `maxDeletionRatio`).
- **Anti-regression:** when sections resolve and coverage is normal, behavior is unchanged.
- **Matrix coverage:** the primary fix for #5/#6, and also protects the direct-trigger rows.

### 5.3 EnrollProSync: empty-set guards for drops (`enrollproSync.ts`)

- **Stale-enrollment drop (`:868-917`):** abort the drop when `allSyncedStudentIds.size === 0` (i.e., learners fetch failed or returned empty). Log + audit instead.
- **Orphaned-section cleanup (`:919-961`):** abort when `epSections.length === 0`. Log + audit.
- **Teacher deactivation (`:295-327`):** keep the existing empty-guard ✅ and **add a ratio breaker** — if `deactivatedTeacherIds.length / localTeachers.length > MAX_DEACTIVATION_RATIO`, skip and audit (mirrors prune).
- **Anti-regression:** when EP returns full data, all three behave exactly as today.
- **Matrix coverage:** fixes #3/#4 (EP-on/Atlas-off) where EP "online" but partial/empty data would still be destructive.

### 5.4 TeacherSync: empty-roster guard (`teacherSync.ts` + `sync/utils.ts`)

- **`dropStaleEnrollments` (`utils.ts:135-162`):** add an explicit guard — if `freshLearners.length === 0`, return `0` without touching any enrollment (a fetch failure/empty must never look like "everyone left").
- Callers (`teacherSync.ts:318`, `:732`) already wrap in try/catch; the guard inside the function is the single-point fix.
- **Anti-regression:** a genuinely empty section (nobody enrolled) is already the same no-op; a real roster still drops correctly.
- **Matrix coverage:** covers the login/advisory path (B5) which runs **outside** the coordinator — rows #1–#8 all have login, so this guard matters in every combination.

### 5.5 AtlasSync schedule cleanup (`atlasSync.ts:820-824`)

- Only delete stale `ScheduleEntry` rows when section resolution succeeded (`epSectionById.size > 0`). Skip cleanup otherwise.
- **Anti-regression:** with healthy data, identical behavior.
- **Matrix coverage:** closes the low-severity B6 in #5/#6.

### 5.6 Coordinator health check (optional, `syncCoordinator.ts:642-656`)

- Optionally broaden the ping set (e.g., ping `/integration/v1/health` **and** confirm at least the sections endpoint). This is a UX nicety, not the safety mechanism. **Defer to a later iteration** — Principles 1–5 are the real safety.
- **Matrix coverage:** improves gate accuracy for every row, but is NOT load-bearing.

---

## 6. New Shared Guard Utility (optional)

To avoid duplicating ratio/coverage logic, add a small helper (e.g. `server/src/lib/syncGuard.ts`):

```ts
export function exceedsRatio(destroyCount: number, totalActive: number, maxRatio: number): boolean
export function isConfidentData(count: number): boolean  // count > 0
```

Keep it tiny. Only use it in the destructive paths above. No existing behavior changes.

---

## 7. Proposed Tests (vitest, `server/src/__tests__/`)

| Test | Asserts |
|---|---|
| `sync-outage-guard.test.ts` | POPULATED load + EP sections unavailable → **no** assignment archived, audit written |
| `sync-outage-guard.test.ts` | POPULATED load, sections resolve normally → archive still works (anti-regression) |
| `sync-outage-guard.test.ts` | archive ratio > threshold → aborted (no mass wipe) |
| `sync-outage-guard.test.ts` | stale-check reactivates previously-archived desired assignments on next good sync (recovery) |
| `enrollpro-sync-guard.test.ts` | learners fetch empty/fail → **no** enrollment marked TRANSFERRED |
| `enrollpro-sync-guard.test.ts` | sections fetch empty → **no** orphaned-section drop |
| `enrollpro-sync-guard.test.ts` | partial teacher list → deactivation ratio breaker trips, no suspension |
| `teacher-sync-guard.test.ts` | empty roster → `dropStaleEnrollments` returns 0, no drops |
| `sync-matrix.test.ts` | coordinator: EP off/Atlas on → AtlasSync skipped; both off → cycle skipped; EP on/Atlas off → EP steps only (matrix rows #3–#8) |
| `direct-trigger.test.ts` | `POST /api/sync/atlas` with EP offline → fails closed, no archive (direct entry point) |

Follow the existing pattern in `atlas-removal.test.ts` / `prune.test.ts` (use `test-helpers`, gate on credentials).

---

## 8. Observability (so this is visible next time)

- Admin **SystemHealth** already surfaces dependency health via `getUnifiedSyncStatus()`. Add: "⚠ using data from last successful sync at HH:MM" when a dependency is down.
- When a destructive phase is skipped by a guard, write an **AuditLog** entry (`AuditSeverity.WARNING`) so admins can see *why* nothing was reconciled.
- The sync-verification report (`syncVerification.ts`) already lists teachers/sections missing from EP — keep it as the human-readable source of truth.

---

## 9. Rollout Plan (when approved)

1. **Phase 1 — Guards (5.1–5.5):** implement + unit tests. Run `npm run build` in `server/`, run `vitest run`.
2. **Phase 2 — Observability (8):** wire stale-data banner + guard audit logs.
3. **Phase 3 — Recovery verification:** confirm the 257 already-archived records auto-restore on the next healthy sync, or restore via admin endpoint.
4. **Phase 4 — Optional:** webhooks from EP/ATLAS for near-real-time updates (keep 5-min polling as the safe floor).

---

## 10. Layman's Explanation of the Fix

Imagine SMART as a filing cabinet. Every 5 minutes, a clerk (the sync) checks with EnrollPro (the master roster) and Atlas (the teaching-load book) to make sure the cabinet matches.

**What went wrong:** EnrollPro's phone line was down. The clerk still answered Atlas's call, got a perfectly good list of 265 classes — but couldn't check which classroom each class belonged to because that info comes from EnrollPro. So the clerk decided the classroom info was "missing," and to be tidy, filed 257 records into the "archived" drawer. Our data wasn't lost, but it was wrongly hidden.

**The fix, in plain terms:** *"Don't reorganize the cabinet unless you're sure you have the full picture."*

- If EnrollPro is down, the clerk **doesn't move anything to archive** — he leaves the cabinet as-is and just notes "couldn't check today."
- If EnrollPro answers but seems to have forgotten half the teachers or students, the clerk **stops and asks a human** instead of assuming everyone left.
- If Atlas hands him a list but he can't match it to any classrooms, he **does nothing destructive** — he only adds records, never hides them.
- When the phone line comes back, the clerk **re-checks and restores** anything he wrongly filed away, automatically.

The key rule we keep everywhere: **"If you're not sure, don't delete or hide anything."** That rule only applies in uncertain situations — on a normal day nothing changes, so there's no regression.

---

## 11. Open Questions for Review

1. Should the coordinator hard-skip AtlasSync when EP is offline (5.1), or rely on the internal guard (5.2) only? My recommendation: **both** (defense in depth).
2. `MIN_RESOLUTION_COVERAGE` threshold: propose **0.9** (≥90% of effective-load rows must resolve) — or make it configurable via `SystemSettings`.
3. `MAX_ARCHIVE_RATIO` / `MAX_DEACTIVATION_RATIO`: propose **0.5** (mirror prune's default `maxDeletionRatio`).
4. Do we want a "Restore all sync-archived" admin action, or is auto-reactivation on next good sync sufficient?

---

## 12. Post-Presentation Cleanup — Audit Log Artifacts (separate from the guardrail plan)

Found while investigating the incident. **Does not** affect historical data or rollover — audit log is write-only; rollover/forms/dashboards never read it to make decisions.

### 12a. Audit-log noise

| Item | Count | Source | Safe to remove? |
|---|---|---|---|
| Test-artifact rows (fake years `2098-2099`, `2099-2100`, "Test archive", "Injected archive") | 672 | vitest runs leave `AuditLog` rows; tests clean seeded data but not audit rows | ✅ Yes |
| `prune-engine` DELETE rows | 2427 | `prune.ts:433` logs `action: DELETE` on **every** cycle even with 0 deletions | ✅ Yes (log noise) |

**Fix (code):**
1. `prune.ts` — only write the audit row when `totalActualDeletions > 0` (or log at `INFO` / non-DELETE action). ~5 lines.
2. Test suites (`rollover-lib`, `prune`, `wipe`, etc.) — delete their own `AuditLog` rows in `cleanup()`. ~3 lines per suite.

### 12b. One-time DB cleanup (manual, after review)

- Delete audit rows matching the test-artifact patterns above (read-only preview first, then targeted delete).
- **Do NOT** touch `Grade`, `Enrollment`, `Section`, `SchoolYear`, or `ClassAssignment` — those are real historical data.

### 12c. Real-data state (handle carefully — NOT part of artifact cleanup)

Observed dev-DB state:
- `2026-2027` is `ARCHIVED` in `SchoolYear.status`, but its data is **not** archived (grades=792 archived=0, enrollments=20 archived=0, sections=20 COMPLETED=0). The admin archive endpoint would have refused this (unfinalized sections) — flag was changed outside the normal path.
- The 257 incident assignments (`archivedReason=ATLAS_STALE*`) still sit in `2026-2027`.
- Only `2030-2031` is `ACTIVE`; `settings.currentSchoolYear=2030-2031`.

These need a **separate plan** after the presentation (decide: restore 2026-2027 to a clean archived state properly, or reconcile the 257). Do not bundle into the audit cleanup.

---

## 13. Rollout Order (updated)

1. **Phase 1 — Guards (5.1–5.5):** implement + unit tests. `npm run build` in `server/`, `vitest run`.
2. **Phase 2 — Observability (8):** stale-data banner + guard audit logs.
3. **Phase 3 — Audit hygiene (12a):** prune no-op logging + test audit cleanup.
4. **Phase 4 — One-time audit cleanup (12b):** targeted delete of test-artifact rows (preview first).
5. **Phase 5 — Real-data reconciliation (12c):** plan and resolve the `2026-2027` half-archived state + the 257 records (separate, careful).
6. **Phase 6 — Optional:** webhooks from EP/ATLAS for near-real-time updates.