# HANDOFF: Strict EnrollPro SSOT — Auto-Prune + Login Enforcement

> **Document type:** Implementation handoff / work order.
> **Status:** PLANNING COMPLETE — no code written yet. You (the implementer) build everything in this doc.
> **Repo:** `C:\Users\Sean\Desktop\SMART_FINAL_CAPSTONE` — read `AGENTS.md` first. Non-negotiables apply (1000-line max/file, logic in `lib/`, no `.env` edits, no EP/ATLAS writes, `npm run build` before finishing).
> **Related docs:** `docs/HANDOFF_WIPE_RESET.md` (previous work — wipe CLI, env guards, sync verification — ALL SHIPPED), `docs/DEPLOYMENT_RUNBOOK.md`.
> **Test discipline:** vitest files run SERIALLY against the SHARED dev DB (`fileParallelism: false` already set in `server/vitest.config.ts`). Tests must NEVER commit destructive writes — use the rollback pattern from `src/__tests__/wipe.test.ts` (throw a sentinel error inside the transaction to force ROLLBACK).

---

## 0. MISSION — THE SSOT CONTRACT

The operator's directive, verbatim intent:

> "If accounts, students, grades, sections, etc. are not in EnrollPro anymore — unless it's archived SY data — automatically delete them locally. No stales at all. Dynamic fetching all the time. If an account doesn't exist on EnrollPro = cannot log in anymore."

Formalized as **The Contract**:

1. **EnrollPro is the single source of truth for PEOPLE in the ACTIVE school year**: teachers, students, enrollments, and sections. Anything active-year that EnrollPro no longer returns is **deleted locally, automatically, every sync cycle** (~5 min, `SYNC_INTERVAL_MINUTES`).
2. **ATLAS is the authority for SUBJECTS/class assignments/schedules** in the active year. ATLAS data must never leak from OTHER school years into the current one (remove cross-year fallbacks).
3. **Archived/past school-year data is IMMUTABLE.** The prune NEVER touches rows whose `schoolYear != activeYear`. Historical SF10/registrar/alumni data survives forever. This matches the AGENTS.md gotcha: historical queries filter by `schoolYear` string only.
4. **Login gate:** a TEACHER who is not in EnrollPro's current faculty list cannot log in — not via local password, not via EnrollPro live-auth resurrection.
5. **Everything is guarded.** Outage safeguards + a deletion circuit breaker + audit logging + dry-run mode. This is an auto-deleting system; the guardrails ARE the feature.

### Why (incident context — already investigated, do not re-investigate)

After a manual partial wipe, the system re-grew stale data via three holes:
- **Hole 1 — sync re-imports:** wipe doesn't touch EnrollPro; sync re-upserts teachers (creating `User` accounts) and students. Removed-in-EP teachers only get SUSPENDED if they have a `Teacher` row — orphan users (no `Teacher` row) are invisible to the deactivation query (`enrollproSync.ts:303`). Students are never pruned at all.
- **Hole 2 — login resurrection:** `auth.ts:80-131` — EnrollPro live-auth CREATES a local user if none exists, and OVERWRITES password/role of existing users without checking status or faculty membership. Deleted teachers resurrect on next login.
- **Hole 3 — ATLAS cross-year fallbacks:** `teacherSync.ts` (~lines 423–430 and ~780–794) probes ALTERNATE ATLAS school years (`[DEFAULT, 2, 5, 6, 1, 8]`) when the current year has no data for a teacher, importing old-year assignments/advisories into the CURRENT year. Login sync also never deactivates CAs (`teacherSync.ts:748-763`, deliberate policy that this work order supersedes for the active year).

---

## 1. GROUND TRUTH — SCHEMA & CODE FACTS YOU MUST NOT REDISCOVER

### 1.1 Critical cascade behavior (`server/prisma/schema.prisma`)

| Fact | Consequence |
|---|---|
| `ClassAssignment.teacherId` → FK `Teacher` **Cascade**; `Grade.classAssignmentId` → FK **Cascade** | **Deleting a `Teacher` row cascades ALL their ClassAssignments and Grades across ALL school years** — including archived years. This is why teachers WITH history get SUSPENDED, never deleted (§3 Phase A). |
| `Section` deletion cascades `ClassAssignment`, `Enrollment`, `Attendance`, `WorkloadEntry`, `ScheduleEntry` | Deleting an active-year Section cleans its active-year graph automatically (sections are year-scoped rows — `@@unique([name, gradeLevel, schoolYear])`). |
| `Student` deletion cascades `Enrollment`, `Grade`, `Attendance` | Fine — but ONLY delete a Student with no historical presence. |
| `GradeSnapshot` has **NO FK relations** (plain string columns: `studentId`, `classAssignmentId`, `teacherId`, `sectionId`, `schoolYear`, `term`) | **Snapshots are NEVER auto-cascaded. Every prune path that deletes Students/CAs/Teachers/Sections MUST also `gradeSnapshot.deleteMany()` explicitly**, filtered by `schoolYear: activeYear` AND the entity id. |
| `AuditLog.userId` → optional FK to `User`, NO cascade | Deleting a `User` with audit rows **FK-fails**. Before user delete: `auditLog.updateMany({ where: { userId }, data: { userId: null } })`. |
| `ExcelTemplate.uploadedBy` → REQUIRED FK to `User`, NO cascade | If the user uploaded form templates, user deletion FK-fails. Rule: **skip deletion, SUSPEND instead** (templates are re-uploadable config; the account stays blocked — Contract satisfied). |
| `RefreshToken` cascades from `User` | Free cleanup. |
| `Teacher.user` → `User` Cascade; `Teacher.userId` unique | Deleting `User` deletes the `Teacher` row. |

### 1.2 Key code locations (verify line numbers may have drifted ±20; locate by pattern)

| File | What |
|---|---|
| `server/src/lib/enrollproSync.ts` | Master EP sync. Teacher upsert/deactivate/reactivate at ~180–366. **Already 1059 lines — OVER the 1000-line rule. Prune logic MUST go in a NEW file.** Empty-teacher-list safeguard pattern at ~300 (`epEmpIds.size === 0` → skip). |
| `server/src/lib/syncCoordinator.ts` | Scheduler, `SYNC_INTERVAL_MINUTES` (default 5, line ~30). Calls `runUnifiedSync`. Hook point for prune = end of successful EP sync. |
| `server/src/lib/enrollproClient.ts` | `getEnrollProTeachers()`, `getAllIntegrationV1Learners(schoolYearId?)` (auto-scopes to ACTIVE year when no arg), `getAllIntegrationV1Sections(schoolYearId?)`, `resolveEnrollProSchoolYear()`. |
| `server/src/lib/syncCache.ts` | In-memory 5-min TTL cache. `getCachedEnrollProTeachers()` — reuse for login faculty check. |
| `server/src/lib/teacherSync.ts` | Login-time sync. Cross-year ATLAS fallbacks ~423–430 and ~780–794 (DELETE THESE). Never-deactivate comment ~747–763. |
| `server/src/lib/schoolYearResolver.ts` | `getActiveSchoolYearLabel()` — resolve active year label for prune scoping. |
| `server/src/routes/auth.ts` | Login. Status check exists at 165 (`user.status !== "ACTIVE"` → 403). Live-auth resurrection hole at 80–131. |
| `server/src/lib/syncVerification.ts` | Already-shipped verification report + orphan checker. Prune stats feed into this (§6). |
| `server/src/lib/wipe.ts` + `scripts/wipe.ts` | Already-shipped full wipe. DO NOT modify except if extracting shared FK-order helpers. |
| `server/src/lib/audit.ts` | `createAuditLog(action, actor, target, targetType, details, targetId, severity)` — use for prune runs. |

### 1.3 EP data shapes for the "desired sets"

- Faculty identity key: `employeeId` (string, trimmed). Source: `getEnrollProTeachers()`.
- Learner identity key: `lrn`. Source: `getAllIntegrationV1Learners()` — **no-arg call auto-resolves the ACTIVE school year** (verified). Each learner record carries section info (use the same section-name/gradeLevel extraction pattern `teacherSync.ts` uses: `mapGradeLevel(s.gradeLevel?.name ?? s.gradeLevelName)`).
- Section identity key: `(name.trim(), gradeLevel)` composite — EP splits one logical section across multiple ids; SMART's `Section` unique is `(name, gradeLevel, schoolYear)`.

---

## 2. TASK 1 — PRUNE ENGINE (new file `server/src/lib/prune.ts`)

**Priority: HIGH. The core of the Contract.**

### 2.1 Architecture — dependency-injected core (MANDATORY for testability)

Two exported layers:

```ts
// CORE — pure DB logic, all inputs injected. Tests call THIS with a fake year
// label (e.g. "2105-2106") and fixture EP sets. Real DB data (2026-2027) is
// never in scope because activeYearLabel is a parameter.
export interface PruneInputs {
  activeYearLabel: string;
  epFacultyEmployeeIds: Set<string>;      // trimmed employeeIds
  epLearnerLrns: Set<string>;             // LRNs enrolled in active year
  epSectionKeys: Set<string>;             // "NAME:GRADE_LEVEL" keys
  epEnrollmentPairs: Set<string>;         // "LRN:NAME:GRADE_LEVEL" keys
  dryRun: boolean;
  maxDeletionRatio: number;               // 0..1, circuit breaker
}
export interface PruneResult { /* per-phase counts, aborted?, abortReason? */ }
export async function runPrune(inputs: PruneInputs): Promise<PruneResult>

// WRAPPER — fetches real EP data, resolves real active year, calls core.
// Called by syncCoordinator after each successful EP sync, and by the admin
// endpoint (§5).
export async function runPruneFromLiveSources(opts?: { dryRun?: boolean }): Promise<PruneResult>
```

**NEVER hardcode-fetch EP data inside the core.** If any EP fetch in the wrapper returns an **empty list** (teachers/learners/sections) → ABORT the whole prune with `abortReason: "EP_EMPTY_<WHICH>"`, change nothing, log WARNING. (Pattern: `enrollproSync.ts:300`.) An EP outage returning empty must never look like "everyone left."

### 2.2 Two-pass execution (MANDATORY)

**Pass 1 — PLAN (read-only):** compute every planned deletion id per phase. Run the **circuit breaker**: for each of {students, teachers, sections, enrollments}, if `plannedDeletes > maxDeletionRatio * currentActiveYearCount` → ABORT everything, write a CRITICAL audit log (`AuditAction.DELETE`, `AuditSeverity.CRITICAL`, message naming the entity class, counts, and ratio). Default ratio `0.5`. This protects against a partial EP response that passes the non-empty check.

**Pass 2 — EXECUTE:** only if Pass 1 fully passes. All deletes in ONE `prisma.$transaction`. If `dryRun` → return the plan with counts, write nothing (still audit-log the dry-run).

### 2.3 Prune phases (exact spec)

`activeYear` below = `inputs.activeYearLabel`. **Every delete/write WHERE clause must include the year scoping exactly as written. Historical data is untouchable.**

**Phase A — Teachers (authority: EP faculty)**

For each `Teacher` whose `user.status === 'ACTIVE'` and `employeeId NOT IN epFacultyEmployeeIds`:
- `hasHistory` = exists `ClassAssignment { teacherId, schoolYear != activeYear }` OR exists `GradeSnapshot { teacherId, schoolYear != activeYear }`.
- If `hasHistory`:
  - Suspend the User: `status: 'SUSPENDED', suspendedBy: 'prune-engine', suspendedAt: now, suspensionReason: 'Removed from EnrollPro faculty'`. (Existing 403 at `auth.ts:165` then blocks login — Contract satisfied.)
  - Delete active-year footprint: `classAssignment.deleteMany({ where: { teacherId, schoolYear: activeYear } })` (cascades active-year grades + workload), `scheduleEntry.deleteMany({ where: { teacherId, schoolYear: activeYear } })`, `gradeSnapshot.deleteMany({ where: { teacherId, schoolYear: activeYear } })`.
- Else (no history):
  - `auditLog.updateMany({ where: { userId }, data: { userId: null } })`.
  - If `excelTemplate.count({ where: { uploadedBy: userId } }) > 0` → SUSPEND instead of delete (FK would fail; account still blocked).
  - Else `user.delete({ where: { id: userId } })` (cascades Teacher, RefreshToken, ALL remaining CAs/schedules/workload — safe because no history), then `gradeSnapshot.deleteMany({ where: { teacherId } })` (manual — no FK, any remaining snapshots are active-year).

**Phase B — Orphan TEACHER users**

`User` where `role = 'TEACHER'` and `teacher = null` (no Teacher row) and `username NOT IN epFacultyEmployeeIds` → same delete procedure as Phase A's no-history branch (audit-null, template check, delete). *This catches the `test-teacher-*` leak class and any half-created accounts.*

**Phase C — Sections (authority: EP active-year sections)**

For each `Section { schoolYear: activeYear }` where `("name:gradeLevel") NOT IN epSectionKeys`:
- `section.delete(...)` (cascades CAs, enrollments, attendance, workload, schedule — all active-year by construction).
- `gradeSnapshot.deleteMany({ where: { sectionId, schoolYear: activeYear } })`.

**Phase D — Students not in EP (authority: EP active-year learners)**

For each `Student` having `Enrollment { studentId, schoolYear: activeYear }` where `lrn NOT IN epLearnerLrns`:
- Delete active-year footprint first: `enrollment.deleteMany({ where: { studentId, schoolYear: activeYear } })`; `attendance.deleteMany({ where: { studentId, section: { schoolYear: activeYear } } })`; `grade.deleteMany({ where: { studentId, classAssignment: { schoolYear: activeYear } } })`; `gradeSnapshot.deleteMany({ where: { studentId, schoolYear: activeYear } })`.
- `hasHistory` = remaining enrollment OR remaining grade (after active-year deletes) in any other year.
- If `!hasHistory` → `student.delete(...)` (cascades whatever's left). If `hasHistory` → keep (alumni; their active-year enrollment was stale).

**Phase E — Stale enrollment pairs (student in EP, wrong section locally)**

For each `Enrollment { schoolYear: activeYear }` where `"lrn:sectionName:gradeLevel" NOT IN epEnrollmentPairs`:
- Delete that enrollment, plus the student's `grade` rows for CAs of THAT section (`classAssignment: { sectionId }`), `attendance { studentId, sectionId }`, and active-year `gradeSnapshot { studentId, sectionId }`.
- (The upsert side — creating enrollments for students who MOVED sections — is existing sync behavior; prune only removes.)

### 2.4 Ordering & transaction

Execute phases A→E in order inside one transaction. After all deletes, re-verify no `Enrollment/ClassAssignment/Section` remains for `activeYear` entities that were planned for deletion (cheap sanity: planned ids no longer exist). Throw on mismatch → rollback.

### 2.5 Audit + history

- One `AuditLog` per run: action `DELETE`, severity `WARNING` (CRITICAL on abort), details = JSON of per-phase counts + `activeYearLabel` + dry-run flag.
- Append prune stats to the current `SyncHistory` row's `metadata` if one exists in scope (do NOT create a SyncHistory row just for the prune).

---

## 3. TASK 2 — LOGIN ENFORCEMENT (`server/src/routes/auth.ts`)

**Priority: HIGH. Closes the resurrection holes.**

### 3.1 Local-auth path (teacher)

After local password match and BEFORE issuing tokens, for `role === 'TEACHER'`:
1. If `user.status !== 'ACTIVE'` → existing 403 at line 165 stands; extend the SUSPENDED message to: `"Your account was removed from EnrollPro and can no longer access SMART."`
2. **Faculty check (the 5-minute staleness closer):** resolve `employeeId = user.username` (or Teacher row). Check membership via `getCachedEnrollProTeachers()` (5-min TTL in-memory cache — cheap, "dynamic"). If EP list is available AND `employeeId ∉ list` → **401 `Account is not enrolled in EnrollPro for the current school year`** (do NOT suspend here — the prune owns writes; just deny).
3. If EP unreachable / cache empty → fall back to local status check only (step 1). **Never lock out the whole school during an EP outage.**

ADMIN/REGISTRAR: exempt from the faculty check — they are locally managed via Admin > User Management. (Operator decision documented; if the operator later wants EP-gated admins, it's a one-line extension.)

### 3.2 Live-auth path (the resurrection hole, lines 80–131)

Before creating/updating ANY local user from an EnrollPro auth success:
1. `empId = String(epUser.employeeId ?? epUser.accountName ?? email).trim()`.
2. Faculty check: `empId ∈ (await getCachedEnrollProTeachers()).map(t => t.employeeId)`. If NOT in faculty → **401** `"Authenticated on EnrollPro but not a current faculty member. Contact your school administrator."` — do NOT create the user, do NOT update anything.
3. If in faculty: keep existing create/update logic, but the `update` branch must **NEVER modify `status`** and must never un-suspend (only the prune engine or an admin changes status).
4. If EP faculty list is unreachable → allow live-auth to proceed ONLY for users that already exist locally and are ACTIVE; do NOT create brand-new users while the faculty list is unavailable (can't verify membership).

### 3.3 Refresh path

Line ~293 already rejects tokens whose user is not ACTIVE — prune suspensions automatically invalidate sessions on next refresh. No change needed; add a test.

---

## 4. TASK 3 — KILL ATLAS CROSS-YEAR FALLBACKS (`server/src/lib/teacherSync.ts`)

**Priority: HIGH. These are the stale-CA importers.**

1. **Faculty-assignments fallback (~423–430):** currently retries other schoolYearIds when the active year returns nothing for the teacher. DELETE the fallback loop — use the resolved active `atlasSchoolYearId` only. No match → log debug "no assignments in active Atlas year" and move on.
2. **Advisory fallback (~780–794):** currently probes `[DEFAULT_ATLAS_SCHOOL_YEAR_ID, 2, 5, 6, 1, 8]`. DELETE the probe array and loop — active year only.
3. Update the "Never archive/deactivate" comment block (~747–763): reword to state the new policy — *teacher login sync still never deactivates (per-teacher Atlas responses are partial), but active-year reconciliation is owned by the prune engine + global Atlas sync stale-check.*
4. **Global atlasSync stale-check scope (`atlasSync.ts` ~282–290, ~523–533):** currently only stale-checks teachers with ≥1 resolved load. Extend cautiously: teachers with ZERO resolved loads this cycle are now also stale-check candidates **only if** the Atlas published-schedule fetch itself succeeded (not an outage) — their active-year CAs get archived. If you find this too risky to determine cleanly, leave atlasSync untouched and note it in the PR — Phases A/C of the prune already remove the worst stale-CA classes (removed teachers, removed sections).

---

## 5. TASK 4 — ADMIN TRIGGER + CONFIG + VERIFICATION WIRING

1. **Endpoint** in `server/src/routes/admin-sub/system.ts` (follow the existing `/sync-verification` pattern at line 64):
   ```
   POST /api/admin/prune          → runs runPruneFromLiveSources({})
   POST /api/admin/prune?dryRun=true  (or JSON body { dryRun: true }) → plan only
   ```
   `authenticateToken, requireAdmin`. Returns the full `PruneResult`. Log errors 500 like neighbors.
2. **Sync hook:** in `syncCoordinator.ts`'s unified sync flow, after a successful EnrollPro leg, call `runPruneFromLiveSources()` (fire-and-forget with `.catch` logging, or awaited — follow how the EP/Atlas legs sequence). Gate on `PRUNE_ENABLED`.
3. **Config (env, with `.env.example` additions — do NOT touch `.env`):**
   - `PRUNE_ENABLED` (default `true`)
   - `PRUNE_DRY_RUN` (default `false`)
   - `PRUNE_MAX_DELETION_RATIO` (default `0.5`)
   Read them via a small helper in `server/src/config/schoolEnv.ts` (dev-warn-free, these have safe defaults in all environments — do NOT fail-fast these).
4. **Verification wiring:** extend `buildSyncVerificationReport()` metrics with `lastPruneAt` + `lastPruneCounts` (read the latest prune AuditLog). Existing anomaly codes (`ORPHAN_STUDENTS`, `UNEXPECTED_USER_ACCOUNTS`, `MULTIPLE_YEARS_IN_ENROLLMENTS`) must read `ok: true` after a healthy prune on the dev DB.

---

## 6. TASK 5 — HYGIENE FIXES (small, do together)

1. **`src/__tests__/rollover-lib.test.ts` User leak:** its `cleanup()` deletes Teacher/SchoolYear/etc. but never the created `User`. Add `await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {})` (mirror `gradeLocks-lib.test.ts:66` which does this correctly). This class of leak is also auto-healed by prune Phase B, but tests must not pollute in the first place.
2. **`DEFAULT_SYNC_PASSWORD`:** add to `.env.example` with a strong comment (unset ⇒ new sync-created teacher accounts get `'password123'` — unacceptable for deployment). The login faculty-gate mitigates the risk; still document it in the runbook's pre-flight checklist.
3. **Runbook addendum:** add a "Strict SSOT / auto-prune" section to `docs/DEPLOYMENT_RUNBOOK.md`: what the prune does, the circuit breaker, how to dry-run (`POST /api/admin/prune` with dryRun), and that removing a teacher from EnrollPro blocks their SMART login within one sync cycle.

---

## 7. TASK 6 — TESTS

All in `server/src/__tests__/`, vitest, **rollback pattern mandatory** (sentinel-throw inside transaction — copy `runWipeAndRollback` from `wipe.test.ts`), scoped fixtures under a **fake year label** (e.g. `2105-2106`), cleanup in `beforeAll`/`afterAll` scoped to created ids. Mock EP via top-level `vi.mock("../lib/enrollproClient", ...)` where needed (pattern in `syncVerification.test.ts`).

**`prune.test.ts` (core — inject fake year + fixture sets, NEVER the real 2026-2027):**
1. Stale student, no history → Student deleted (all active-year data gone).
2. Stale student, WITH history (enrollment in `2104-2105`) → active-year data deleted, Student + historical enrollment intact.
3. Removed teacher, no history → User deleted, cascades clean, GradeSnapshots (active-year, manual) gone.
4. Removed teacher, WITH history → User SUSPENDED (not deleted), active-year CAs deleted, historical CAs intact.
5. Removed teacher who uploaded an ExcelTemplate → SUSPENDED not deleted (FK guard).
6. Stale active-year section → deleted + snapshots cleaned.
7. Stale enrollment pair (student in EP, wrong section) → enrollment + that section's grades/attendance deleted, student kept.
8. Empty EP set injection → ABORT, nothing changed.
9. Circuit breaker: inject sets that would delete > ratio (e.g. 90% of students) → ABORT, nothing changed, CRITICAL audit written.
10. Dry-run → identical plan counts, zero writes.
11. Orphan TEACHER user (no Teacher row) not in EP → deleted.

**`auth-prune.test.ts` (mock `enrollproClient` + `syncCache` getters):**
12. Active teacher in cached faculty list → login proceeds.
13. Teacher NOT in faculty list (list available) → 401, no token.
14. EP faculty unreachable → ACTIVE local teacher still logs in (outage fallback).
15. SUSPENDED teacher with correct password → 403 with the new message.
16. Live-auth path: valid EP credentials but employeeId not in faculty → 401, NO user created (count unchanged).
17. Live-auth path: existing SUSPENDED user in faculty → still 403 (status never flipped by auth).

**Regression:** full `npm test` (all existing files must stay green — serial execution already configured), `npm run build` in `server/` AND root, lint clean on all new/modified files.

---

## 8. ACCEPTANCE — LIVE VALIDATION ON THE DEV DB (paste outputs into the PR)

After implementation, with the dev server running and one sync cycle completed:

1. `GET /api/admin/sync-verification` → `ok: true`. The 12 `test-teacher-*` orphan users (leaked 2026-08-31) must be GONE (Phase B).
2. No `Enrollment`/active `ClassAssignment` referencing a teacher absent from EP faculty.
3. Historical preservation probe: seed (in a transaction, then rollback) a `2104-2105` enrollment + CA + grade, run prune scoped to `2026-2027` → historical rows untouched.
4. Login probe: attempt login with a removed employeeId → 401/403.
5. `POST /api/admin/prune` (dry-run) → returns a clean plan with zero planned deletions on a healthy DB (second run after a real prune = no-op — idempotence).
6. grep checks: no `[DEFAULT_ATLAS_SCHOOL_YEAR_ID, 2, 5, 6, 1, 8]` array in teacherSync.ts; no `2, 5, 6, 1, 8` fallback probing; `rollover-lib.test.ts` cleanup includes the user delete.

## 9. OUT OF SCOPE (do NOT do)

- No multi-tenancy / `schoolId` columns.
- No writes to EnrollPro or ATLAS (read-only integrations — hard rule).
- No pruning of SUBJECTS (catalog config, not roster), `GradingConfig`, `TransmutationEntry`, `SystemSettings`, `ExcelTemplate` rows themselves.
- No touching archived/past-year data anywhere, ever.
- No frontend work (endpoint only; a UI card can come later).
- No modification of `.env` / `.env.*` (only `.env.example` additions).
- No commits unless the operator explicitly asks.

## 10. EXECUTION ORDER

| # | Task | Size | Depends on |
|---|---|---|---|
| 1 | Task 1 prune engine + tests | large | — |
| 2 | Task 2 login enforcement + tests | medium | — (parallelizable with 1) |
| 3 | Task 3 ATLAS fallback removal | small | — |
| 4 | Task 4 endpoint/config/wiring | small | Task 1 |
| 5 | Task 5 hygiene | small | — |
| 6 | Task 6 full regression + live validation | medium | all |
