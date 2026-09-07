# PLAN — Atlas Removal Transparency & Mid-SY Transfer Handling

**Status:** Ready for implementation (workhorse) — reviewed/locked with user
**Date planned:** 2026-09-07
**Scope:** Teacher dashboard "Atlas removal detected" banner transparency + reassignment (transfer) handling + admin resolution path + sync guards
**Rule:** This is the implementation contract. Follow it. Do NOT refactor unrelated code. Do NOT modify `.env` files. Line numbers below are accurate at planning time; the quoted code anchors are the source of truth if lines have drifted.

---

## 1. Problem Statement

Teachers see an opaque red banner on their dashboard:

> "Atlas removal detected — N subject assignment(s) were removed from the current Atlas load"

Problems:
1. **No details** — the banner shows only a count. The teacher cannot see WHICH subject/section was removed, when, or why.
2. **Misleading label** — the count conflates 5+ different archive causes (Atlas stale, EnrollPro removal, teacher suspension, admin manual removal, year rollover) under a single "Atlas removal" message.
3. **No resolution path** — "CONTACT ADMIN" badge is static (not a button). No admin restore endpoint exists. Manual admin re-creation is futile: the next Atlas sync re-archives it (30-min cycle).
4. **Transfers are misclassified** — when Atlas reassigns a subject+section to a DIFFERENT teacher mid-SY (e.g., English 7–Aguinaldo moves Teacher A → Teacher B), Teacher A's assignment is archived and shown as a "removal" even though the class still exists under Teacher B.
5. **Incoming teacher gets a blank ledger** — Teacher B's new ClassAssignment has no grades; the class-record endpoint only queries B's assignment, so B cannot see the T1 grades Teacher A already encoded (risk: B re-encodes, competing rows).
6. **Write hole** — grade save endpoints verify `teacherId` ownership but NOT `isActive`. Teacher A can still write grades to an archived (transferred/removed) class → two teachers concurrently grading the same class.
7. **Hard-deletes hide history** — AtlasSync hard-deletes stale assignments with no grades and purges previously archived no-grade rows. Those removals are invisible to everyone.

## 2. Key Facts (from investigation — read before coding)

### Archive reasons that exist today (all set `ClassAssignment.isActive = false`)

| archivedReason value | Writer | File:line |
|---|---|---|
| `ATLAS_STALE_WITH_GRADES` | AtlasSync stale-check | `server/src/lib/atlasSync.ts:461` |
| `Teacher removed from EnrollPro` | EnrollPro sync | `server/src/lib/enrollproSync.ts:319` |
| `Teacher suspended` | Admin user suspend | `server/src/routes/admin-sub/users.ts:338` |
| `Manually removed in SMART` | Admin archive endpoint | `server/src/routes/admin-sub/classAssignments.ts:325` |
| `Year {SY} archived` | Admin year archive + rollover | `admin-sub/classAssignments.ts:497`, `server/src/lib/rollover.ts:113` |

### Where the banner data comes from
- Backend: `server/src/routes/grades-sub/dashboard.ts:67-73` (`/grades/dashboard`) and `:375-381` (`/grades/dashboard-stats`) — both do a bare `prisma.classAssignment.count({ where: { teacherId, schoolYear: currentSY, isActive: false } })`.
- Frontend: `src/pages/teacher/Dashboard.tsx:529-542` renders the banner when `archivedClassesCount > 0`.

### AtlasSync stale-check (the thing that archives/removes)
`server/src/lib/atlasSync.ts:391-528`:
- Builds `desiredAssignmentPairs` — Set of `${teacherId}:${subjectId}:${sectionId}` for the current school year from the Atlas "effective teaching load".
- For every current-year assignment of an Atlas-matched teacher: if pair NOT in desired set → stale.
- Stale + no grades → **hard DELETE** (lines 447-451).
- Stale + has grades → soft archive with `ATLAS_STALE_WITH_GRADES` (lines 455-463) + admin audit log.
- Lines 496-503: purge pass deletes previously-archived rows with no grades.
- Lines 512-521: reactivates archived assignments that ARE in the desired set.
- **EMPTY-load contract:** if Atlas reports effective load state `EMPTY`, ALL current-year assignments of Atlas-matched teachers are archived (lines 316-319, 419-421). This is trusted in a single cycle today.
- Upsert of desired assignments: lines 536-579 (sets `isActive: true`, clears archived fields).

### Grade save endpoints (write hole)
`server/src/routes/grades-sub/classes.ts`:
- `POST /grade` single save — ownership check at lines 227-231 (`findFirst where id, teacherId`) — **no isActive check**.
- Bulk save (`{ classAssignmentId, term, updates }`) — ownership check at lines 452-459 — **no isActive check**.
- `GET /class-record/:classAssignmentId` — lines 120-129, also no isActive check (reads OK to keep — A may view history).
- Grade delete + clear-scores endpoints (~lines 645, 736) also lack the check.

### SF10 merge (already handles transfers — DO NOT change)
`server/src/lib/sf10.ts:210-214` `gradePriority` prefers ACTIVE assignments; `:298-301` fills term slots first-come from highest priority. So SF10 stitches A's archived T1 + B's active T2. Keep this behavior; this plan's read-only inheritance for B is the class-record analogue.

### Class Records list (frontend already has dead archived UI)
`src/pages/teacher/ClassRecordsList.tsx`:
- Lines 296-299: partitions active vs archived (`isActive === false || archivedAt`).
- Lines 425-457, 551-581: renders archived cards + `archivedReason` + delete buttons.
- **Currently starved:** `GET /grades/my-classes` filters `isActive: true` at `server/src/routes/grades-sub/classes.ts:46-51`, so archived rows never arrive.
- Verified: `gradesApi.getMyClasses()` (`src/lib/api.ts:330`) is consumed ONLY by `ClassRecordsList.tsx` (lines 225, 243). Feeding archived rows is safe.

### Admin side
- `GET /admin/class-assignments` (`admin-sub/classAssignments.ts:161-172`) returns ALL rows (incl. archived) but the admin UI (`src/pages/admin/ClassAssignments.tsx`) never badges/filters them, and workloadSummary (lines 223-237) **counts archived rows** (bug).
- Admin manual create (`:287`) does not set any source flag → next sync re-archives it (futile today).
- Admin delete endpoint `DELETE /admin/class-assignments/:id` (`:312-337`) = soft archive. No restore endpoint exists anywhere.

### Auth/role conventions
- Teacher endpoints: `authenticateToken, authorizeRoles("TEACHER")`; admin: `ADMIN"`. Follow `createAuditLog(AuditAction, user, target, targetType, details, ip, severity, targetId?, metadata?)` — see `server/src/lib/audit.ts`.

## 3. Locked Design Decisions (do not revisit)

1. **Atlas stays read-only SSOT** — no writes to external systems. Resolution happens in SMART via admin restore with `source: MANUAL` protection.
2. **TRANSFERRED ≠ REMOVED** — reassignment detection at archive time via desired-pairs; transfers get a separate informational banner, never the red removal banner.
3. **No grade migration** — incoming Teacher B gets **read-only inherited grades** (Option A). Grades stay attached to the original (archived) assignment; authorship/audit preserved; SF10 merge unchanged.
4. **Soft-archive everything** — no more hard-deletes in AtlasSync; every removal stays visible. Teachers keep their existing delete buttons for no-grade archived rows.
5. **Two-banner UI** — rose removal banner (action needed) + amber transfer notice (informational, persistent, collapsible with `sessionStorage` acknowledgment).
6. **EMPTY-load safety guard** — mass-archive requires two consecutive EMPTY sync cycles.
7. **Schema changes** — single Prisma migration adding `successorTeacherId` and `source` to `ClassAssignment`.

## 4. Implementation

### Phase 0 — Migration (do first)

**File:** `server/prisma/schema.prisma` — `model ClassAssignment` (line 145).

Add:
```prisma
  successorTeacherId String?   // set when Atlas reassigns this class to another teacher (transfer)
  source             String   @default("SYNC") // SYNC | MANUAL — MANUAL survives Atlas stale-check
```
Optionally a relation `successorTeacher Teacher? @relation("ClassAssignmentSuccessor")` with matching back-relation on `Teacher` — only if the workhorse is comfortable adding the Prisma relation; otherwise resolve names via a follow-up query in the endpoints (preferred, less schema churn). **Decision: no Prisma relation — resolve names at query time.**

Migration: run `npm run prisma:migrate -- --name atlas_removal_transparency` from `server/`. Then `npm run prisma:generate`.

**Acceptance:** migration applies cleanly; existing rows default `source = "SYNC"`, `successorTeacherId = null`; `npm run build` in `server/` passes.

---

### Phase 1 — Backend transparency + honest classification

#### Task 1.1 — AtlasSync: reassignment detection + no more hard deletes
**File:** `server/src/lib/atlasSync.ts`, stale-check block (lines 391-528).

a) **Reassignment detection:** inside the stale loop, before archiving, determine whether the same `subjectId:sectionId` exists in `desiredAssignmentPairs` under a DIFFERENT teacherId. Practical approach: build a secondary set `desiredSubjectSectionPairs = new Set(desiredAssignmentPairs keys with teacherId stripped)` from the already-computed pairs (pairs are built at lines 352-363 pre-resolution + 557-558 upsert loop — collect both places or recompute after upserts; simplest: after the upsert loop at 6.5 finishes, do the archive pass — reorder if needed so desired pairs are complete first. **Note the current order: stale-check (step 6) runs BEFORE upserts (6.5) but uses pairs pre-resolved at 5.2/352-363; verify pairs include ALL desired loads before relying on them — if the pre-resolved set misses pairs due to section/subject resolution gaps, recompute desired pairs from the `loads` array after section/subject mapping in 6.5, then run the stale pass.**).

   If `assignment.subjectId:assignment.sectionId` is in the desired set under another teacher → transfer:
   - `archivedReason: 'ATLAS_REASSIGNED'`
   - `successorTeacherId: <that teacher's id>` (if multiple, pick any one — log a warning)
   - still `isActive: false` (Teacher A loses write access — enforced in Phase 2)

   Else → existing behavior: `ATLAS_STALE_WITH_GRADES` when grades exist, NEW reason `ATLAS_STALE_NO_GRADES` when no grades.

b) **Kill hard-deletes:** remove the `deleteMany` at lines 447-451 — ALL stale assignments soft-archive instead. Remove the purge pass at lines 496-503 entirely (legacy cleanup of no-grade archives). Keep the reactivation pass (512-521) and extend it to ALSO clear `successorTeacherId` on reactivation.

c) **Audit message:** in the soft-archive audit log (lines 467-478), include human-readable subject/section names in the `details` string (query subject+section names for `archiveIds` before logging) — the AuditLogs page renders `details` only, never metadata.

**Acceptance:**
- A stale assignment WITH grades → soft-archived, reason set, no DB delete.
- A stale assignment WITHOUT grades → soft-archived with `ATLAS_STALE_NO_GRADES`, still exists in DB.
- A stale assignment whose subject+section moved to Teacher B → `ATLAS_REASSIGNED` + `successorTeacherId = B`.
- `reactivateIds` path clears `successorTeacherId`.
- No `deleteMany` on ClassAssignment remains in this file (workload/schedule upserts untouched).

#### Task 1.2 — Dashboard endpoints return classified details
**File:** `server/src/routes/grades-sub/dashboard.ts`

Replace both count queries (lines 67-73 in `/dashboard`; lines 375-381 in `/dashboard-stats`) with `findMany`:

```ts
const archivedAssignments = await prisma.classAssignment.findMany({
  where: { teacherId: teacher.id, schoolYear: currentSY, isActive: false },
  select: {
    id: true, archivedAt: true, archivedReason: true, successorTeacherId: true,
    subject: { select: { code: true, name: true } },
    section: { select: { name: true, gradeLevel: true } },
    _count: { select: { grades: true } },
  },
});
```
Resolve successor teacher name (one query: `prisma.teacher.findMany({ where: { id: { in: successorIds } }, include: { user: { select: { firstName, lastName } } } })`).

Classify each row into `kind`:
| archivedReason | kind |
|---|---|
| `ATLAS_REASSIGNED` | `TRANSFERRED` |
| `ATLAS_STALE_WITH_GRADES` / `ATLAS_STALE_NO_GRADES` | `REMOVED` |
| `Teacher removed from EnrollPro` | `ENROLLPRO_REMOVED` |
| `Teacher suspended` | `SUSPENDED` |
| `Manually removed in SMART` | `ADMIN_REMOVED` |
| anything else (year archive etc.) | `YEAR_ARCHIVE` |

Response shape (add to BOTH endpoints; keep old fields for compat):
```ts
archivedClassesCount: number,            // total (compat)
removedCount: number,                    // excludes TRANSFERRED
transferredCount: number,                // TRANSFERRED only
archivedClasses: Array<{
  id, kind, subjectName, subjectCode, sectionName, gradeLevel,
  archivedAt, archivedReason, hasGrades,
  successorTeacherName: string | null,
}>
```
`YEAR_ARCHIVE` rows: exclude from `removedCount` (expected behavior at rollover) but include in the array.

**Acceptance:** both endpoints return the arrays; a teacher with a transferred class gets `transferredCount: 1, removedCount: 0`.

#### Task 1.3 — Feed archived rows to my-classes
**File:** `server/src/routes/grades-sub/classes.ts`, `GET /my-classes` (lines 29-99).

- Remove `isActive: true` from the `where` (line 50). Order archived last (`orderBy: [{ isActive: 'desc' }, ...]` — note Prisma sorts booleans asc=false first, so `desc` puts active first).
- Include `successorTeacherId` + resolved `successorTeacherName` in the response mapping (add alongside `effectiveWeights`).
- Enrollment include can stay (archived cards show `0 Learners` fallback already handled by `|| 0` in the UI).

**Verified safe:** only `ClassRecordsList.tsx` consumes this endpoint.

**Acceptance:** teacher with 1 archived + 3 active assignments gets 4 rows; frontend partitions correctly (no UI change needed in ClassRecordsList for basic display — it already renders `archivedReason`).

#### Task 1.4 — Frontend: two honest banners + detail lists
**File:** `src/pages/teacher/Dashboard.tsx` (replace lines 529-542 block), `src/lib/api.ts` (extend DashboardData/Stats types lines ~294-330 with `removedCount`, `transferredCount`, `archivedClasses`).

**Removal banner (rose — action needed):** shows when `removedCount > 0`.
- Header button (count + "Atlas removal detected") toggles an expandable list, `aria-expanded`, keyboard accessible.
- Each row: `subjectName — sectionName (gradeLevelLabel)` + date (`archivedAt`, `toLocaleDateString`) + human reason:
  - `REMOVED` → "Removed from the Atlas teaching load"
  - `ENROLLPRO_REMOVED` → "Removed in EnrollPro (teacher unassigned)"
  - `SUSPENDED` → "Teacher account suspended"
  - `ADMIN_REMOVED` → "Removed by a SMART administrator"
  - `YEAR_ARCHIVE` → "School year archived"
- Body text: grade history preserved; contact admin if unintended.
- Replace the static "CONTACT ADMIN" badge with a `Link` to `/teacher/classes` (archived section) labeled "VIEW ARCHIVED RECORDS".

**Transfer notice (amber — informational):** shows when `transferredCount > 0`.
- Same expandable pattern; each row: `"English 7 — Aguinaldo was transferred to Teacher B on [date]"` (use `successorTeacherName`).
- Persistent; collapsible state in `sessionStorage` key `teacher_transfer_notice_ack` (acknowledged → renders collapsed).
- Copy: "This is normal administrative action. Your grades for earlier terms are preserved and already included in the student's permanent record (SF10). The new teacher continues from the current term."

**Style rules (AGENTS.md):** semantic tokens only (`text-foreground`, `bg-card`, etc.), no raw `text-rose-600`-style classes — note the CURRENT banner already violates this (`text-rose-600`, `bg-rose-50/70`); replace with `text-destructive` / `bg-destructive/10` and amber equivalents (`text-amber-600` → keep ledger-exception-free: use `text-warning` if the design system defines one, else `text-amber-600` is acceptable ONLY if consistent with existing banner components — check `GradeDeadlineBanner.tsx` for the established warning-banner pattern and mirror it).

**Acceptance:** removal case renders rose banner with per-subject details; transfer case renders amber notice with successor name; both cases together render both banners; zero archived classes renders neither.

#### Task 1.5 — Class Records archived cards show transfer info
**File:** `src/pages/teacher/ClassRecordsList.tsx` (archived card component ~lines 82-190, and mobile list ~551-581).

- When `assignment.archivedReason === 'ATLAS_REASSIGNED'` (or successorTeacherName present): badge "TRANSFERRED" + subtitle "Transferred to {successorTeacherName}" instead of generic "Backup"/ARCHIVED styling (keep rose styling only for actual removals; transfers use neutral/amber).
- Existing `archivedReason` display stays for other kinds.

**Acceptance:** a transferred card visually differs from a removed card and names the successor.

---

### Phase 2 — Resolution & write guards

#### Task 2.1 — Admin restore endpoint
**File:** `server/src/routes/admin-sub/classAssignments.ts` (add after the delete endpoint ~line 337).

`POST /class-assignments/:id/restore` — `ADMIN` only:
1. Load assignment; 404 if missing; 400 if already active.
2. **Reassignment guard:** query `prisma.classAssignment.findFirst({ where: { subjectId, sectionId, schoolYear, isActive: true, id: { not: id } } })` — if found → **409** `{ message: "Cannot restore: this class is currently assigned to {teacher name}. Reassignment must be corrected in Atlas first." }` (prevents two active teachers on one class; the DB unique index doesn't cover this because teacherId differs).
3. Restore: `{ isActive: true, archivedAt: null, archivedReason: null, successorTeacherId: null, source: 'MANUAL' }`.
4. `createAuditLog(AuditAction.UPDATE, req.user, 'Restore Class Assignment', 'ClassAssignment', "Restored {subject} for {teacher} in {section} ({SY}) — protected from Atlas sync (MANUAL)", ip, AuditSeverity.WARNING)`.
5. Return the updated assignment with relations (teacher/subject/section) so the UI can update in place.

#### Task 2.2 — source: MANUAL protection
**Files:**
- `server/src/lib/atlasSync.ts` stale-check: skip `source === 'MANUAL'` rows in the archive decision (both the stale classification AND any remaining archive path). Also exclude `MANUAL` rows from `allAtlasMatchedTeacherIds`-scoped operations that would archive/purge them. MANUAL rows are still reactivated-clearing-safe (reactivation only touches rows in the desired set).
- `server/src/routes/admin-sub/classAssignments.ts` manual create (~line 287): add `source: 'MANUAL'` to the `create` data — fixes the currently-futile manual creation path.

**Acceptance:** a MANUAL assignment survives `runAtlasSync()` with a load that doesn't include it; a SYNC assignment in the same situation gets archived.

#### Task 2.3 — Write enforcement on archived assignments
**File:** `server/src/routes/grades-sub/classes.ts`

For `POST /grade` (single, ~line 227), bulk save (~line 452), grade delete (~line 645), clear-scores (~line 736) — after the teacherId ownership check, add:
```ts
if (classAssignment.isActive === false) {
  res.status(403).json({
    code: 'ASSIGNMENT_ARCHIVED',
    message: classAssignment.archivedReason === 'ATLAS_REASSIGNED'
      ? 'This class was transferred to another teacher. You can view grades but no longer edit them.'
      : 'This class assignment is no longer active and cannot be edited.',
  });
  return;
}
```
Keep `GET /class-record/:id` readable (A can view history) — frontend must handle read-only display (Task 2.5).

**Acceptance:** Teacher A gets 403 saving to a transferred/removed assignment; GET still returns the record.

#### Task 2.4 — Admin UI: archived badges + restore
**File:** `src/pages/admin/ClassAssignments.tsx` (+ `src/lib/api.ts` adminApi: `restoreClassAssignment: (id) => api.post(...)`).

- Filter: `Select` All / Active / Archived (default Active).
- Archived rows: ARCHIVED badge (rose) or TRANSFERRED badge (amber, with successor name if API returns it — extend `GET /admin/class-assignments` select to include `archivedReason, archivedAt, successorTeacherId` + resolved successor name).
- Restore button on archived rows → calls endpoint → success toast + reload; on 409 show the message prominently.
- "Manual" badge for `source === 'MANUAL'` rows (indicates sync-protected).
- Workload summary table: ensure it uses only active assignments (see Task 2.6).

**Acceptance:** admin can restore an admin-removed assignment in one click; restore of a transferred assignment shows the 409 explanation; workload table excludes archived rows.

#### Task 2.5 — Frontend read-only state for archived class record
**Files:** `src/pages/teacher/ClassRecordView.tsx` (+ `ClassRecordTable.tsx` / `ClassRecordHero.tsx` as needed).

- If `classAssignment.isActive === false`: render a clear banner at top ("This class was {transferred to X / removed} — viewing grade history; editing is disabled") and disable all editing controls (inputs, save buttons). The backend 403 is the backstop; the UI must not offer dead controls.

#### Task 2.6 — Side fix: workload summary excludes archived
**File:** `server/src/routes/admin-sub/classAssignments.ts` lines 164-172 — add `isActive: true` to the assignments `where` (workload minutes must reflect active load only). Advisory `workloadEntry` query is separate (unchanged).

---

### Phase 2b — Read-only grade inheritance for incoming teacher (Option A)

#### Task 2b.1 — Backend: inherited grades in class-record
**File:** `server/src/routes/grades-sub/classes.ts`, `GET /class-record/:classAssignmentId` (lines 102-196).

After fetching the assignment (keep teacherId ownership check; allow archived read):
1. Find predecessor assignments: `prisma.classAssignment.findMany({ where: { subjectId: classAssignment.subjectId, sectionId: classAssignment.sectionId, schoolYear: classAssignment.schoolYear, isActive: false, id: { not: classAssignment.id }, grades: { some: {} } }, include: { teacher: { include: { user: { select: { firstName, lastName } } } } } })`.
2. Fetch their grades (all terms).
3. Build `inheritedRecord`: per student per term — include predecessor grade ONLY for (student, term) pairs where the current assignment has NO grade row for that student. Shape:
```ts
inheritedGrades: Array<{
  studentId: string;
  term: 'T1' | 'T2' | 'T3';
  quarterlyGrade: number | null;
  inheritedFrom: string;          // "Teacher B" display name
  classAssignmentId: string;      // predecessor id
}>
inheritedFromTeachers: Array<{ name: string; termsCovered: string[] }>  // for the notice card
```
4. Response gains `inheritedGrades` + `inheritedFromTeachers`; existing `classRecord` unchanged.

**Do not mutate any Grade rows.** Inherited rows are never valid save targets (Task 2.3 blocks writes to their archived assignments anyway — defense in depth).

#### Task 2b.2 — Frontend: render inherited grades read-only
**Files:** `src/pages/teacher/ClassRecordView.tsx`, `src/pages/teacher/components/ClassRecordTable.tsx`.

- Notice card when `inheritedFromTeachers.length > 0`: "Grade history inherited from {names} ({terms}). These cells are read-only; continue encoding from the current term."
- Inherited term cells render the grade value read-only (no input, no click-to-edit) with a subtle "Handled by {name}" indicator (tooltip or small chip). Use `text-muted-foreground` styling; do NOT use ledger category color tokens for inherited cells beyond the existing column tinting.
- Inherited rows MUST NOT be included in any save payload (save uses B's `classAssignmentId` + only current-assignment rows).
- ClassRecordTable is a complex ledger (~large file) — keep the change surgical: gate the edit affordances for inherited cells, don't restructure the table.

**Acceptance:** Teacher B opens the class record; T1 cells show A's grades read-only with attribution; B can edit only the current term; saving works; SF10 output unchanged (spot-check via existing SF10 flow).

---

### Phase 3 — EMPTY-load safety guard

#### Task 3.1 — Two-consecutive-EMPTY requirement
**Files:** `server/src/lib/atlasSync.ts` (EMPTY branch lines 316-319 + stale-check EMPTY path 419-421), `server/prisma/schema.prisma` (SystemSettings model — add optional field `atlasEmptyLoadSeenAt DateTime?` — include in the SAME migration as Phase 0; if the model is `SystemSettings` with id 'main', a nullable datetime column is a safe additive change).

Logic:
- On effective-load state `EMPTY`:
  - If `atlasEmptyLoadSeenAt` is null → set it to now, **skip the mass-archive** (treat as no-op for archiving; still allow upserts/reactivations), log `logger.warn` + audit log (WARNING): "Atlas reports EMPTY teaching load — first observation; archiving deferred until confirmed on next cycle."
  - If set and older than ~20 minutes (i.e., a subsequent cycle, not the same run) → proceed with the EMPTY mass-archive, then clear the flag.
- On `POPULATED` (or any successful load fetch): clear the flag.
- UNAVAILABLE (fetch failed): never archive due to EMPTY (already the case — EMPTY only applies when `effectiveLoad` was fetched).

**Acceptance:** first EMPTY cycle archives nothing and logs the warning; second consecutive EMPTY cycle archives; a POPULATED cycle in between resets; sync of a POPULATED load behaves exactly as before.

---

## 5. Files Touched (summary)

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | + `successorTeacherId`, `source` (ClassAssignment); + `atlasEmptyLoadSeenAt` (SystemSettings) |
| `server/src/lib/atlasSync.ts` | reassignment detection, soft-archive only, no purge, MANUAL protection, audit names, EMPTY guard, clear successor on reactivate |
| `server/src/routes/grades-sub/dashboard.ts` | classified `archivedClasses[]`, split counts |
| `server/src/routes/grades-sub/classes.ts` | my-classes archived rows, write enforcement, class-record inheritance |
| `server/src/routes/admin-sub/classAssignments.ts` | restore endpoint, MANUAL on create, workload isActive fix, list select extras |
| `src/lib/api.ts` | types + `restoreClassAssignment` |
| `src/pages/teacher/Dashboard.tsx` | two banners, expandable lists, links |
| `src/pages/teacher/ClassRecordsList.tsx` | transfer badge/successor on archived cards |
| `src/pages/teacher/ClassRecordView.tsx` | archived read-only banner, inherited notice, edit gating |
| `src/pages/teacher/components/ClassRecordTable.tsx` | read-only inherited cells |
| `src/pages/admin/ClassAssignments.tsx` | filter, badges, restore button, 409 handling |

## 6. Edge Cases (workhorse must handle)

1. **Multiple predecessors** (A → C → B): inheritance unions across all archived assignments for the subject+section+SY; per (student, term) prefer the most recent `archivedAt` predecessor with a non-null grade.
2. **Successor teacher unmatched/unresolvable** at archive time → classify `REMOVED` (honest: SMART cannot prove a transfer). No successor name shown.
3. **A↔B flip-flop** (Atlas reverts the reassignment): reactivation pass (atlasSync 512-521) reactivates A's assignment and MUST clear `successorTeacherId` + archived fields; B's assignment becomes stale and archives with `ATLAS_REASSIGNED` + successor = A. Inheritance symmetric.
4. **Teacher B already encoded grades before inheritance shipped** (pre-deploy transfers): per-term merge means B's own rows win for those terms; inherited only fills (student, term) gaps — matches SF10's existing precedence.
5. **Rotational subjects** (TLE/Science components share students): subject+section match is exact per component — no cross-contamination; but verify `resolveSubjectCode` maps the same Atlas subject to the same SMART subject for both teachers (it does — deterministic per code+gradeLevel).
6. **Delete-all archived endpoint** (`/grades/class-assignments/archived/all`, classes.ts:863+): still blocks rows WITH grades; with hard-deletes removed in AtlasSync, this teacher endpoint becomes the sanctioned cleanup path for no-grade rows. No changes needed — but confirm the 409/400 message still fits (`ATLAS_STALE_NO_GRADES` rows without grades remain deletable here).
7. **`YEAR_ARCHIVE` rows** must not appear in the rose banner's count (only in the expandable list) — expected rollover behavior, not an alarm.
8. **suspend → reactivate teacher** (enrollproSync 345-359 restores assignments): restored rows keep their archivedReason cleared — fine; ensure reactivation there also clears `successorTeacherId` if set.
9. **Concurrent sync + restore race**: admin restores (MANUAL) while a sync is mid-flight — the sync's already-fetched `currentAssignments` snapshot may archive it. Non-fatal: next cycle's reactivate… no — MANUAL isn't in desired pairs so nothing reactivates it. Acceptable: document in the endpoint response that protection takes effect on the next completed sync cycle; the admin UI reloads and shows the row active.

## 7. Testing Plan

**Unit/integration (vitest, `server/src/__tests__/`):**
- New `atlas-removal.test.ts`:
  - stale + grades → soft-archive, reason, no delete
  - stale + no grades → soft-archive `ATLAS_STALE_NO_GRADES`, row exists
  - stale + pair moved to other teacher → `ATLAS_REASSIGNED` + successor
  - MANUAL survives stale-check
  - EMPTY first cycle defers, second archives, POPULATED resets
- Extend `grade-lock.test.ts` (or new file): write 403 on archived assignment for single + bulk + delete + clear-scores; GET class-record 200 on archived.
- Restore endpoint: happy path, 409 guard, audit log written.

**Build/lint gates (MUST pass before handoff):**
```
root:     npm run build && npm run lint
server/:  npm run build && npm test
```

**Manual E2E script (checker will run this):**
1. Seed/arrange: Teacher A with a graded class; Teacher B exists.
2. Simulate Atlas load change (or directly invoke the stale logic via a crafted `desiredAssignmentPairs`): transfer case → verify A's banner (amber, successor name), A's archived card "TRANSFERRED", A's save → 403, A's view still works; B's class record shows inherited T1 read-only; SF10 unchanged.
3. Removal case: admin archives via existing endpoint → A's rose banner lists subject/section/date/reason → admin restores → row active, `source: MANUAL` → run `POST /admin/atlas-sync/run` (with a load excluding it) → row still active → banner gone.
4. Restore guard: attempt restore of the transferred assignment → 409 with teacher name.
5. Workload page: archived rows excluded from minutes.

## 8. Out of Scope (explicitly)

- No teacher→admin "request restore" workflow (may be added later).
- No changes to SF10 composer, promotion, remedial, registrar queries.
- No changes to EnrollPro sync's teacher-removal archiving (its reason mapping only).
- No notification/email system (banners + audit logs are the surface).
- No refactor of ClassRecordTable beyond read-only gating.
- No writes to Atlas/EnrollPro (read-only integrations — non-negotiable).

## 9. Checker's Review Checklist (final gate)

- [ ] Migration additive-only; existing data unaffected (`source` defaults `SYNC`)
- [ ] No `deleteMany` on ClassAssignment remains in atlasSync.ts
- [ ] `ATLAS_REASSIGNED` never appears under the rose removal banner (transfer ≠ removal)
- [ ] Teacher A: 403 on all 4 write paths for archived assignments; GET class-record still 200
- [ ] Teacher B: inherited cells read-only, never in save payload, attributed to predecessor
- [ ] SF10 output byte-identical before/after for a transfer scenario
- [ ] Restore: happy path + 409 guard + MANUAL survives sync + audit log present
- [ ] Workload summary excludes archived rows
- [ ] Design system compliance: no new raw palette classes outside sanctioned ledger tokens; semantic tokens used
- [ ] `npm run build` + `npm run lint` (root), `npm run build` + `npm test` (server) all green
- [ ] No `.env` changes; no external-system writes; no unrelated refactors
