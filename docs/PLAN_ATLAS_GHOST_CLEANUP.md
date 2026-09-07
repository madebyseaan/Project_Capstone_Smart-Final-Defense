# ONE-TIME CLEANUP — Duplicate Assignment Records (Atlas Data Issue)

**Status:** Ready for implementation (workhorse) — reviewed/locked with user
**Date planned:** 2026-09-07
**Trigger:** Atlas experienced a database issue causing subject codes to alternate between proper names (e.g., `SPA_SPEC7`) and numeric identifiers (e.g., `107`). Each sync cycle created new records with one encoding and flagged the other encoding's records as stale. This produced 265 duplicate "ghost" records in SY 2029-2030 that have zero grades and zero workload data. Teachers see misleading warning banners as a result.

**One additional correction:** 1 record (Developmental Reading 8 / Maka-Diyos, 2 grades) was flagged as "removed" before the transfer-detection feature was deployed. It's actually a teacher reassignment — correct its reason to "transferred".

---

## SAFETY GUARANTEES (read before touching anything)

### What IS touched
| Records | Action | Grades affected |
|---|---|---|
| 265 numeric ghost rows (SY 2029-2030 only) | Remove from DB | **ZERO** — each has 0 grades, 0 workload entries (verified) |
| 1 with-grades row (DevRead 8, SY 2029-2030) | Update reason field only (not removed) | **ZERO** — grades stay, reason changes to `ATLAS_REASSIGNED` |
| Total Grade rows in DB | Verified identical before and after | 4,754 → 4,754 |

### What is NEVER touched
- Historical school years (2026-2027, 2027-2028, 2028-2029) — not even queried
- Grade records — zero modification, zero removal
- Enrollment, Student, Attendance, Section, Subject, Teacher records
- ScheduleEntry records (no ClassAssignment FK — unaffected)
- `.env` or any configuration files
- Any school year other than 2029-2030

### Defense-in-depth
- `deleteMany` targets 265 specific record IDs (not a broad filter)
- Assertions verify schoolYear = `2029-2030` for every targeted record
- Assertions verify zero grades AND zero workload entries on every targeted record
- Assertions verify subject codes are numeric (`/^\d+$/`)
- Full backup JSON created before any changes
- Single transaction — all changes succeed or all roll back

---

## Pre-flight (MUST confirm before any changes)

1. Run `POST /admin/atlas-sync/run` (admin token required)
2. Check the latest audit log entry:
   - If the latest sync flagged new records as stale → Atlas is still unstable → **STOP, do not proceed**
   - If the latest sync flagged 0 records → Atlas is stable with proper codes → proceed

---

## Script: `server/scripts/cleanup-duplicate-assignments.mjs`

Plain Node ESM — dotenv + PrismaClient + PrismaPg adapter (pattern from `server/src/lib/prisma.ts`).

### Step 0 — Backup (REQUIRED before any changes)

Fetch and write to `server/backup-duplicates-<ISO-timestamp>.json`:
- All 266 flagged ClassAssignment records for SY 2029-2030 (full records + `_count: { grades, workloadEntries }`)
- The 2 Grade records attached to the with-grades row
- Any WorkloadEntry records tied to SY 2029-2030 assignments
- File is NOT committed, NOT removed after script

### Step 1 — Assertions (STOP if any fail)

| Check | Expected |
|---|---|
| `systemSettings.currentSchoolYear` | `'2029-2030'` |
| Active records (SY 2029-2030, isActive true) | 265 |
| Flagged without grades (isActive false, reason `ATLAS_STALE_NO_GRADES`) | 265 |
| All 265: grades count = 0 AND workloadEntries count = 0 | true |
| All 265: subject code matches `/^\d+$/` (numeric) | true |
| All 265: schoolYear = `2029-2030` | true |
| Flagged with grades (reason `ATLAS_STALE_WITH_GRADES`) | 1 |
| That record's ID | `cmtn2uu4q01rd14ve802hftsu` |
| That record's grades count | 2 |
| That record's schoolYear | `2029-2030` |
| Total Grade count in entire DB | 4754 |

Print all values. If ANY mismatch → print `STOP: state has changed since planning` and exit 1.

### Step 2 — Execute (single `prisma.$transaction`)

**Operation 1: Remove 265 numeric duplicate records**

```js
await tx.classAssignment.deleteMany({
  where: { id: { in: ghostIds } }  // 265 specific IDs
});
```

Each record: zero grades, zero workload entries, zero cascade impact.

**Operation 2: Correct the 1 reassignment record's reason**

```js
await tx.classAssignment.update({
  where: { id: 'cmtn2uu4q01rd14ve802hftsu' },
  data: {
    archivedReason: 'ATLAS_REASSIGNED',
    successorTeacherId: 'cmtkxi8p30vnak0vepx3lxw07'  // active DevRead8 Maka-Diyos teacher
  }
});
```

Grades untouched — only the reason and successor fields change.

**Operation 3: Write audit log entry**

```js
await tx.auditLog.create({
  data: {
    action: 'UPDATE',
    severity: 'WARNING',
    userName: 'Manual Cleanup',
    userRole: 'SYSTEM',
    userId: null,
    target: 'ClassAssignment',
    targetType: 'SYNC',
    details: 'Cleaned up 265 numeric-code duplicate assignments (Atlas data issue, 2029-2030). Corrected 1 reassignment reason to ATLAS_REASSIGNED.',
    metadata: {
      schoolYear: '2029-2030',
      cleaned: 265,
      correctedToTransferred: 1,
      reason: 'Atlas subject code corruption — alternating between proper codes and numeric IDs'
    }
  }
});
```

### Step 3 — Post-verify (PASS/FAIL per check)

| Check | Expected |
|---|---|
| Active records (SY 2029-2030) | 265 |
| Flagged-without-grades count (SY 2029-2030) | 0 |
| With-grades record reason | `ATLAS_REASSIGNED` |
| With-grades record successorTeacherId | `cmtkxi8p30vnak0vepx3lxw07` |
| Total Grade count (entire DB) | 4754 |
| Total flagged records (SY 2029-2030) | 1 |
| Audit log last entry | matches cleanup details |
| Other school year counts (2026-2027 / 2027-2028 / 2028-2029) | 257 / 267 / 265 (unchanged) |

Print a summary table with PASS/FAIL per check.

### Step 4 — Cleanup

- Remove `server/scripts/cleanup-duplicate-assignments.mjs`
- Keep `server/backup-duplicates-<ISO>.json`
- No commits, no pushes

---

## Expected Outcome

- ~42 teachers: warning banner clears (no more ghost subjects listed)
- Camille's teacher: warning changes from "removed" to "transferred to [name]" (1 entry, informational)
- All grade data: preserved (4,754 before = 4,754 after)
- Historical school years: completely untouched

## Contingency

If Atlas's data alternates again after cleanup → sync re-creates the duplicate records → re-run cleanup (or wait for Atlas to resolve their database issue). The cleanup is safe to repeat.

## Non-negotiables

- DO NOT remove the 1 record that has grades (2 grade records attached — removing it would cascade)
- DO NOT touch any school year other than 2029-2030
- DO NOT modify Grade, Enrollment, Student, Attendance, or .env
- DO NOT skip the backup step
- DO NOT commit the script or backup file
- STOP if assertions fail (state has changed)
- STOP if the last Atlas sync created new stale records (Atlas still unstable)
- ABORT immediately if any post-verify check fails

## Verification Commands

```bash
cd server && node scripts/cleanup-duplicate-assignments.mjs
# All checks should print PASS
# Then remove the script file
```

## Key Data Points (from live DB query, 2026-09-07)

| Metric | Value |
|---|---|
| Current school year | 2029-2030 |
| Active ClassAssignment records | 265 |
| Archived without grades (`ATLAS_STALE_NO_GRADES`) | 265 |
| Archived with grades (`ATLAS_STALE_WITH_GRADES`) | 1 |
| Total Grade rows | 4,754 |
| `atlasEmptyLoadSeenAt` | null (EMPTY guard not triggered) |
| Numeric ghost subject codes | `107`, `109`, `89`, `99`, etc. |
| Proper subject codes (active) | `SPA_SPEC7`, `DEVL_READING8`, `ENGLISH7`, etc. |
| With-grades record ID | `cmtn2uu4q01rd14ve802hftsu` |
| With-grades record: subject | Developmental Reading 8 (`DEVL_READING8`) |
| With-grades record: section | Maka-Diyos |
| With-grades record: teacher | Camille Joy Ramos |
| With-grades record: grades count | 2 |
| Active duplicate: teacher ID | `cmtkxi8p30vnak0vepx3lxw07` |
| Last sync audit (stable) | 0 records flagged (Atlas returned proper codes) |
