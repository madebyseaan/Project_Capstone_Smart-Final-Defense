# PLAN PHASE 0: One-Time Purge of Stale Current-Year ClassAssignments

**Status:** PLANNING ONLY — execute exactly as written. Any deviation = STOP and report back.
**Prepared by:** GLM (audit/planning) — execution by workhorse, verification by GLM.
**One-time operation:** the script file is DELETED after use. Nothing permanent is added to the codebase.

---

## 1. Background (verified via DB queries — not assumptions)

- ATLAS confirmed it currently has NO teaching loads for SY 2029-2030 ("None yet").
- On 2026-09-04 14:56 UTC, during a brief ATLAS window (sync cycle 13), 265 ClassAssignment
  rows were created for schoolYear `2029-2030`. ATLAS's own DB has since lost that data —
  all 265 rows are confirmed stale ("ghost classes").
- ATLAS has been unreachable (health timeouts) since 2026-09-06 ~14:38 UTC. The outage
  resilience design (UNAVAILABLE = preserve) correctly kept these rows, but they are now
  verified-stale and must be purged manually.
- Teacher impact: 37 of 42 teachers see ghost classes. Term 1 grades are due 2026-09-10 —
  teachers are actively encoding against classes that do not exist in ATLAS.

### Verified data snapshot (2026-09-06)
| Metric | Value |
|---|---|
| Current-year (2029-2030) assignments | 265 |
| — with grades | 1 (`id: cmtn2uu4q01rd14ve802hftsu`, DEVL_READING8 / Maka-Diyos / CAMILLE JOY RAMOS, 2 grades) |
| — without grades | 264 |
| ScheduleEntry, schoolYear 2029-2030 | 0 |
| Other years (2026-2027 / 2027-2028 / 2028-2029) | 257 / 267 / 265 assignments — MUST REMAIN UNTOUCHED |
| Total Grade rows in DB | 4,754 — count MUST BE IDENTICAL after purge |

---

## 2. Purge semantics (mirrors Phase B design)

- No grades → hard delete (safe, zero cascade risk)
- Has grades → soft-archive (`isActive: false, archivedAt, archivedReason:
  'ATLAS_CONFIRMED_EMPTY_MANUAL_PURGE'`) — grades preserved for registrar review
- If ATLAS later re-publishes its Sep 4 data, the next sync cycle re-creates everything via
  upsert (verified: upsert `update` resets `isActive: true, archivedAt: null`). Fully reversible.

---

## 3. Script specification

Create `server/scripts/purge-stale-assignments.mjs` (plain Node ESM — avoid ts-node/TS build
entanglement; the pattern `require('dotenv').config()` + `PrismaClient` + `PrismaPg` adapter is
proven working in this repo, see `server/src/lib/prisma.ts` for pool config).

The script MUST, in order:

### Step 0 — Backup (MANDATORY, before any write)
1. Fetch ALL 265 rows for `schoolYear: '2029-2030'` as full records PLUS
   `_count: { select: { grades: true, workloadEntries: true } }`.
2. Also fetch the 2 Grade rows attached to the archived assignment (full records).
3. Also fetch any WorkloadEntry rows tied to current-year assignments (see §5 caveat).
4. Write everything to `server/backup-ca-2029-2030-<ISO-timestamp>.json`.
   This file is the manual rollback path — it must NOT be committed, NOT deleted.

### Step 1 — Pre-flight assertions (abort if any fail)
- `systemSettings.currentSchoolYear === '2029-2030'`
- Current-year assignment count === 265
- Exactly 1 assignment has `grades > 0` and its id is `cmtn2uu4q01rd14ve802hftsu`
- Other-year counts: 2026-2027=257, 2027-2028=267, 2028-2029=265
- Total Grade count === 4754
- Print all values. If ANY mismatch → print `ABORT: state drifted from plan snapshot` and exit 1.

### Step 2 — Purge (single transaction)
Inside `prisma.$transaction`:
1. One `findMany` on current-year assignments selecting `{ id, _count: { grades } }`.
2. Split: `safeDeleteIds` (grades === 0), `preserveIds` (grades > 0).
3. `deleteMany({ where: { id: { in: safeDeleteIds } } })`
4. `updateMany({ where: { id: { in: preserveIds } }, data: { isActive: false,
   archivedAt: new Date(), archivedReason: 'ATLAS_CONFIRMED_EMPTY_MANUAL_PURGE' } })`
5. Direct `prisma.auditLog.create` (do NOT import the TS helper — replicate the row):
   - action: `UPDATE`, severity: `WARNING`
   - userName: `Manual Purge`, userRole: `SYSTEM`, userId: null
   - target: `ClassAssignment`, targetType: `SYNC`
   - details: `"Manual purge: hard-deleted X stale assignment(s), soft-archived Y with grades
     preserved (ATLAS confirmed empty for 2029-2030)"`
   - metadata: `{ schoolYear: '2029-2030', deleted: <X>, archived: <Y>,
     reason: 'ATLAS confirmed empty — one-time purge', backupFile: '<filename>' }`

### Step 3 — Post-verify (report PASS/FAIL per check)
- Current-year active assignments === 0
- Current-year total assignments === 1 (the archived one)
- Grades on archived assignment === 2
- Total Grade count === 4754 (identical)
- Other-year counts unchanged (257 / 267 / 265)
- Print a summary table of all checks with PASS/FAIL.

### Idempotency
Re-running the script must be a no-op (deleteMany/updateMany find nothing new; Step 1
assertions will ABORT because counts changed — that is correct and desired behavior).

---

## 4. Execution

1. `cd server && node scripts/purge-stale-assignments.mjs`
2. Confirm all Step 3 checks print PASS
3. **Delete the script file** (`purge-stale-assignments.mjs`) — one-time use only
4. Keep the backup JSON file
5. No commits, no pushes, unless user explicitly says so

---

## 5. Known caveats (accepted, documented)

- `WorkloadEntry.classAssignmentId` is `onDelete: Cascade` — any current-year workload
  entries tied to the 264 deleted rows are cascade-removed. These are derived metrics
  (advisory-minute equivalents, recomputed by sync), acceptable loss. Step 0 backs them up
  and the script prints the cascade count.
- The archived assignment stays in the DB (isActive: false). Per repo convention, SF/historical
  queries filter by schoolYear string only, so its 2 grades remain visible to registrar review.
  Teacher operational queries filter `isActive: true`, so the ghost class disappears from teacher view.

---

## 6. DO NOT (non-negotiables)

- DO NOT touch assignments of any other school year
- DO NOT delete or modify ANY Grade row (Grade count must be 4754 before AND after)
- DO NOT touch ScheduleEntry, Attendance, Enrollment, Student, or .env
- DO NOT skip the backup step
- DO NOT commit the script or the backup JSON
- DO NOT "clean up" or refactor anything else while in there

## 7. Acceptance criteria (GLM will verify all)

- [ ] Backup JSON exists, parses, and contains 265 assignments + 2 grades + workload entries
- [ ] DB: 0 active current-year assignments; 1 archived (`ATLAS_CONFIRMED_EMPTY_MANUAL_PURGE`)
- [ ] Grade count 4754 before === after
- [ ] Other years: 257 / 267 / 265 unchanged
- [ ] AuditLog WARNING row exists with correct metadata
- [ ] Script file deleted
- [ ] Teacher portal (Camille): class list empty; amber ATLAS banner still visible
- [ ] No new commits in git log
