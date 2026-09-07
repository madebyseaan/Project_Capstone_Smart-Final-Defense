# PLAN: ATLAS Outage Resilience — Grade-Safe Sync, Staleness Banner, Decoupled Health Checks

**Status:** PLANNING ONLY — do not implement without this plan approved.
**Author context:** ATLAS is currently having DB issues. Investigation found a **data-loss risk** and several coupling bugs. This plan is ordered by safety priority.
**Prime directive:** REGRESS-FREE. Every phase must end with a green build and zero behavior change outside its stated scope. When in doubt, preserve existing behavior and flag.

---

## 1. Background (why this plan exists)

### Current architecture facts
- Teaching loads flow: ATLAS → background sync (every ~5 min via `syncCoordinator.ts`) → local `ClassAssignment` table → teacher endpoints read DB.
- ATLAS "Effective Annual Teaching Load" contract: `GET /faculty-assignments/effective` returns `source.state` of `EMPTY` (valid truth: nothing published) or `POPULATED`. Unreachable = fetch throws → `fetchEffectiveTeachingLoad()` returns `null` → `effectiveLoadState = 'UNAVAILABLE'`.
- `server/src/lib/atlasSync.ts` stale-check (approx. lines 390–470) reconciles DB against ATLAS truth each cycle.

### Bugs found

| # | Bug | Location | Severity |
|---|-----|----------|----------|
| B1 | **Grade cascade data loss.** `Grade.classAssignment` has `onDelete: Cascade` (schema.prisma:246). Stale-check `deleteMany` on ClassAssignment silently deletes all Grades tied to it. Sequence: ATLAS down → teachers encode grades against stale classes → ATLAS recovers saying those classes don't exist → grades vanish. | `server/src/lib/atlasSync.ts:431-444` | **CRITICAL** |
| B2 | **Purge kills soft-archives.** Every cycle purges ALL `isActive: false` ClassAssignments for matched teachers (`deleteMany` approx. lines 446–460). Any soft-archive we add would be purged next cycle → same cascade loss. | `server/src/lib/atlasSync.ts:446-460` | **CRITICAL** (blocks B fix) |
| B3 | **Coupled health check.** If EITHER EnrollPro OR Atlas is offline, the ENTIRE sync cycle is skipped (line 164). An Atlas outage freezes EnrollPro student/section freshness too. | `server/src/lib/syncCoordinator.ts:164` | HIGH |
| B4 | **Orphaned registrar ATLAS endpoints** with zero frontend consumers; one falsely reports `EMPTY` when ATLAS is unreachable (`data ?? { source: { state: 'EMPTY' } }` — "unreachable" is NOT "confirmed empty"). | `server/src/routes/registrar/atlas.ts:18` | LOW (dead code) |
| B5 | **Teachers have no idea ATLAS is down.** They see last-synced classes as if current and encode grades against them. (Directly enables B1.) | frontend | HIGH |

### Decision already made (do not relitigate)
Stale assignments **with grades** → **soft-archive** (`isActive: false` + reason), grades preserved. Rationale:
- Teacher operational queries filter `isActive: true` → ghost classes vanish from teacher view → no NEW grades against them.
- SF-form/historical queries filter by `schoolYear` ONLY (per AGENTS.md gotcha) → preserved grades still surface in SF10/SF5 for registrar reconciliation.
- Fields `isActive`/`archivedAt`/`archivedReason` already exist on `ClassAssignment` (schema.prisma:152-154) — **no migration needed**.

---

## 2. Phase B — Grade-safe stale reconciliation (DO FIRST)

**File:** `server/src/lib/atlasSync.ts`, stale-check section (approx. lines 390–470). Read the full function before editing; line numbers are approximate and will drift.

### B1. Split deletion candidates by grade presence

Current code builds `archiveIds: string[]` then `deleteMany({ where: { id: { in: archiveIds } } })`.

Change to:
1. After `archiveIds` is built, fetch grade counts in ONE query:
   ```ts
   const withGradeCounts = await prisma.classAssignment.findMany({
     where: { id: { in: archiveIds } },
     select: { id: true, _count: { select: { grades: true } } },
   });
   ```
   (Reverse relation is `grades` — confirmed in schema.prisma:160.)
2. Split:
   - `safeDeleteIds` — `_count.grades === 0` → existing `deleteMany` behavior, unchanged.
   - `preserveArchiveIds` — `_count.grades > 0` → soft-archive instead:
   ```ts
   await prisma.classAssignment.updateMany({
     where: { id: { in: preserveArchiveIds } },
     data: {
       isActive: false,
       archivedAt: new Date(),
       archivedReason: 'ATLAS_STALE_WITH_GRADES',
     },
   });
   ```
3. Log counts distinctly (keep existing `console.log` style):
   `[AtlasSync] Deleted X stale ClassAssignment(s); soft-archived Y with grades preserved (effectiveLoadState=..., schoolYear=...)`.

### B2. Fix the purge step (BLOCKER — must ship with B1)

Current purge (approx. lines 446–460) deletes ALL `isActive: false` rows for matched teachers. After B1, this would purge our preserved soft-archives next cycle and cascade-delete grades.

Change the purge `where` to exclude assignments that have grades:
```ts
const purged = await prisma.classAssignment.deleteMany({
  where: {
    teacherId: { in: allAtlasMatchedTeacherIds },
    schoolYear: schoolYearLabel,
    isActive: false,
    grades: { none: {} },
  },
});
```
(Prisma supports relation filters on `deleteMany` where clauses — verify against the installed Prisma version; if unsupported, do a `findMany` with `grades: { none: {} }` select ids first, then `deleteMany` by id list.)

### B3. Admin audit alert when grades are preserved

When `preserveArchiveIds.length > 0`, write a WARNING audit log using the existing helper (`server/src/lib/audit.ts:5` `createAuditLog`):
- `action`: `AuditAction.UPDATE` (enum has no ALERT value — do NOT add an enum value, that requires a migration; use UPDATE + WARNING severity)
- `severity`: `AuditSeverity.WARNING`
- `user`: a system-shaped user object, e.g. `{ id: null, role: 'SYSTEM', firstName: 'Atlas', lastName: 'Sync' }` — matches the param shape `{ id?, firstName?, lastName?, role: string }`
- `target`: `'ClassAssignment'`, `targetType`: `'SYNC'`
- `details`: human summary, e.g. `"Atlas sync soft-archived 3 stale class assignment(s) with existing grades; grades preserved for registrar review"`
- `metadata`: `{ assignmentIds: preserveArchiveIds, schoolYear, effectiveLoadState }`
- Wrap in try/catch — an audit failure must never fail the sync cycle.

### B4. Verify the upsert/reactivate path handles soft-archives

The `@@unique([teacherId, subjectId, sectionId, schoolYear])` constraint means a soft-archived row blocks naive `create` if ATLAS republishes the same assignment later. The existing reactivate logic (`reactivateIds`, approx. lines 462–470) sets `isActive: true, archivedAt: null, archivedReason: null` — confirm:
1. The stale-check "shouldBeActive" branch adds soft-archived rows to `reactivateIds` (it should — it queries `isActive: true AND false` rows alike; verify the `findMany` at approx. line 395 does NOT filter `isActive`).
2. The upsert path for new/desired assignments (later in the function) uses upsert-or-update, not create-only. If it is create-only, a soft-archived row will cause P2002 unique violations. Fix by adding the conflict key to the reactivate set before upserts run.

### B5. Do NOT change
- The `UNAVAILABLE` preservation behavior (else-branch `preservedMissingCount++`) — already correct.
- The `EMPTY`-deletes-all semantics — already correct per ATLAS contract.
- Any schema file. No migrations in this plan.

---

## 3. Phase A — Teacher staleness banner

**Goal:** teachers must know when ATLAS is down so they stop encoding against possibly-stale classes (prevention layer over Phase B's safety net).

### A1. Backend — already done, verify only
`syncCoordinator.ts:179` already broadcasts via `broadcastSyncStatus`:
```ts
{ type: 'SYNC_SKIPPED', source, timestamp, reason, dependencies: { enrollpro: {...}, atlas: {...} } }
```
Verify the SSE route (`/api/integration/sync/stream`, uses `addSyncSseClient`) is authorized for TEACHER role, not admin-only. If teacher-role tokens are rejected, widen the route's `authorizeRoles` to include TEACHER — that is the only backend change permitted in this phase.

### A2. Frontend — extend `useSyncStream` (`src/hooks/useSyncStream.ts`)
Currently only parses `SYNC_COMPLETE` (line 143). Extend:
1. Add to the return type: `atlasOffline: boolean` (and optionally `enrollproOffline`, `lastSkippedReason: string | null`).
2. Parse `SYNC_SKIPPED` payloads the same way `SYNC_COMPLETE` is parsed; set `atlasOffline` from `payload.dependencies?.atlas?.online === false`.
3. On the next `SYNC_COMPLETE`, clear the flags (dependencies recovered).
4. Do NOT alter `syncVersion` semantics — many pages depend on it for refetch triggers. `SYNC_SKIPPED` must NOT increment `syncVersion`.

**Known landmine — verify, do not blindly fix:** line 76 reads `sessionStorage.getItem('user')`, but the multi-session system uses `user_teacher` / `user_admin` / `user_registrar` keys. If the hook currently never connects for teachers, this is why. If confirmed broken, change ONLY this key resolution (e.g. check `user_teacher` too, or rely on `getPortalToken()` presence) and note it in the PR. If it already works (some layouts may set a plain `user` key), leave it alone.

### A3. Frontend — banner in `TeacherLayout.tsx` (`src/layouts/TeacherLayout.tsx`)
- Consume `useSyncStream()`, render a banner when `atlasOffline`:
  - Copy: `"Class list may be outdated — ATLAS is unreachable. Avoid encoding new grades until this banner disappears."`
  - Use the design-system pattern of the existing `GradeDeadlineBanner.tsx` / `GradeStatusBanner.tsx` (`src/components/`) as the visual reference — semantic tokens only (`text-foreground`, `text-muted-foreground`, `bg-destructive`-family or an existing warning treatment). NO raw palette classes, no inline styles.
  - Dismissible per session (useState is enough — it reappears on reload, which is intended).
  - Keep it OUT of admin/registrar layouts in this phase (scope control).

---

## 4. Phase 2 — Decouple EnrollPro/Atlas sync health

**File:** `server/src/lib/syncCoordinator.ts:164`

### 2.1 New skip semantics
Replace the either-offline-skips-everything gate with:
- **Both offline** → skip entire cycle (current behavior). Increment `consecutiveCriticalFailures`, circuit breaker counts as today.
- **Exactly one offline** → run the healthy dependency's sync portion; mark the offline one as skipped in the result; DO NOT increment `consecutiveCriticalFailures` (partial service is not a critical failure). Emit `SYNC_SKIPPED`-style SSE only for the dead half, or a `SYNC_PARTIAL` event — but ONLY if frontend consumers are updated in the same phase; otherwise reuse existing event shape with per-dependency fields.

### 2.2 Read the full cycle body first
Before editing, read lines ~215–380 to find where `runEnrollProSync` and `runAtlasSync` are invoked within the cycle. Gate each invocation on its own dependency's `online` flag. Preserve:
- `invalidateAllCaches()` post-cycle behavior
- `persistSyncHistory` shape (add metadata fields, don't remove)
- `UnifiedSyncResult` structure — set the skipped dependency's result to `null` or a `{ skipped: true, reason }` object; check `getLastUnifiedSyncResult` consumers (SystemHealth admin page) tolerate nulls before choosing.

### 2.3 Verify Atlas-sync's EnrollPro dependency
`atlasSync.ts` maps ATLAS sectionIds via `epSectionById` and reads `prisma.section` directly (line 352). Determine where `epSectionById` is populated:
- If from local DB (`prisma.section`) → Atlas-only sync works when EnrollPro is down. Proceed.
- If from a live EnrollPro fetch inside the cycle → when EnrollPro is down and Atlas is up, Atlas sync will partially fail (errors pushed, data preserved — acceptable). Document this in the sync result errors; do NOT add cross-dependency fetching.

---

## 5. Phase 1 — Remove orphaned registrar ATLAS code (cleanup, do LAST)

Zero frontend consumers confirmed (grep: only definitions, no usages).

1. Delete `server/src/routes/registrar/atlas.ts` (entire file).
2. `server/src/routes/registrar.ts` — remove the import (line 6) and `registerAtlasRoutes(router)` call (line 16).
3. `src/lib/api.ts` — remove `getAtlasTeachingLoads` (line 1161) and `getAtlasSubjectCoverage` (line 1166).
4. `server/src/lib/atlasSync.ts` — remove `getAtlasEffectiveTeachingLoad` (line 730) and `getAtlasSubjectStats` (line 742) ONLY IF grep confirms the deleted route was their sole consumer.
5. Remove now-unused imports (`resolveAtlasSchoolYear`, `DEFAULT_ATLAS_SCHOOL_YEAR_ID` in the deleted file's importers) — let `tsc` noUnusedLocals catch strays; do not remove anything still referenced.

---

## 6. Execution order & gates

| Order | Phase | Gate before next phase |
|---|---|---|
| 1 | B (grade-safe reconciliation + purge fix + audit + upsert verification) | `cd server && npm run build` green; scenario tests in §7 pass |
| 2 | A (banner: hook + layout) | root `npm run build` + `npm run lint` green |
| 3 | 2 (decouple) | server build green; both-down and one-down scenarios in §7 pass |
| 4 | 1 (dead code removal) | root + server builds green; grep clean |

Commit per phase. Never batch phases into one commit.

## 7. Verification matrix (run after each phase as applicable)

| Scenario | Expected behavior |
|---|---|
| ATLAS up, state=POPULATED | Fresh assignments; reactivation of archived rows works; NO unique violations |
| ATLAS up, state=EMPTY | All current-year assignments for matched teachers: no-grades → deleted; with-grades → soft-archived, grades intact, WARNING audit log written |
| ATLAS up, assignment removed but grades exist | Soft-archive (NOT delete); grades survive; assignment gone from teacher view; grades still visible in schoolYear-scoped (SF) queries |
| ATLAS unreachable | No deletions, no archives (UNAVAILABLE branch); EnrollPro sync still runs (after Phase 2); teacher banner visible (after Phase A) |
| Both unreachable | Whole cycle skipped; circuit breaker after 3 consecutive; SMART logins/grading/attendance/forms still function on local DB |
| ATLAS recovers after outage | Next cycle self-heals: reconciles to ATLAS truth; banner clears on SYNC_COMPLETE |
| Next cycle after soft-archive | Soft-archived rows NOT purged (purge excludes has-grades); no grade cascade |

Data-level check (Phase B): before/after counts of `Grade` rows across a forced stale-check cycle must show zero grade loss in every scenario.

## 8. Regression checklist
- [ ] Teacher login sync (`teacherSync.ts`) unaffected
- [ ] Grade save/finalize flows unaffected (grade-lock precedence rules intact)
- [ ] Attendance unaffected (Attendance has no ClassAssignment FK — verify untouched)
- [ ] SF1/SF5/SF10 generation still sees grades on soft-archived assignments (schoolYear-only filters)
- [ ] Admin AuditLogs page renders the new WARNING entries without error
- [ ] `syncVersion` refetch triggers unchanged (SYNC_SKIPPED must not increment it)
- [ ] SystemHealth page tolerates per-dependency null/skipped sync results (Phase 2)

## 9. Non-negotiables / DO NOT
- DO NOT modify `server/prisma/schema.prisma` (no migrations in this plan)
- DO NOT touch `.env` / `.env.*`
- DO NOT write to EnrollPro/ATLAS (read-only integrations)
- DO NOT refactor unrelated code, rename variables, or "improve" adjacent logic
- DO NOT increment `syncVersion` on SYNC_SKIPPED
- DO NOT delete or archive anything when `effectiveLoadState === 'UNAVAILABLE'`
- DO NOT let audit-log failures break the sync cycle (try/catch)
- DO NOT add new AuditAction enum values (migration)
- DO NOT remove the `TeachingLoad.tsx` entry from AGENTS.md in this plan (file already absent; doc cleanup is out of scope)

## 10. Deferred (explicitly out of scope)
- Staleness banners for admin/registrar portals
- DB fallback for registrar live ATLAS views (endpoints being deleted in Phase 1 anyway)
- Optional one-time manual purge of current stale assignments while ATLAS is down (data decision, not code — requires owner approval)
- `atlasTLVersionByScope` dead code in `syncCache.ts:157`
- Duplicate `/subjects` fetch in `atlasSync.ts` (lines ~288 and ~190)
