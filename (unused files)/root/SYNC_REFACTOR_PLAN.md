# Sync System Refactor Plan

## Current State Analysis

### Active Sync Files (server/src/lib/)

| File | Lines | Purpose |
|------|-------|---------|
| `syncCoordinator.ts` | 555 | Unified coordinator — single entry point, scheduler, circuit breaker, SSE |
| `enrollproSync.ts` | 567 | EnrollPro → students, sections, enrollments, teachers |
| `atlasSync.ts` | 657 | Atlas → teaching loads, class assignments, subjects, advisers |
| `teacherSync.ts` | 1102 | Per-teacher login sync (EnrollPro advisory + Atlas load + student upsert) |
| `syncCache.ts` | 153 | In-memory TTL cache for external data |
| `enrollproBrandingSync.ts` | 143 | School branding (logo, colors) from EnrollPro |
| `syncService.ts` | 740 | **DEAD WEIGHT** — older sync service, partially redundant with enrollproSync.ts |

**Total: ~3,900 lines across 7 files**

### Unused Scripts (unused files/server/scripts/)

`force-sync.ts`, `reset-sync.ts`, `reset-sync.js`, `run-atlas-sync.ts`, `simulate-elpidio-sync-logic.cjs` — all dead code.

---

## Problems Identified

### 1. Massive Duplication
- `syncService.ts` and `enrollproSync.ts` both sync teachers, students, and enrollments from EnrollPro with **different implementations**.
- `syncService.ts` is NOT used by `syncCoordinator.ts` (which uses `enrollproSync.ts` instead). It's orphaned.
- Grade level mapping exists in 3 places: `enrollproSync.ts:mapGradeLevel()`, `atlasSync.ts` (imports from `atlasUtils`), `syncService.ts:toGradeLevel()`.

### 2. teacherSync.ts is a God Function (1102 lines)
Single `syncTeacherOnLogin()` function handles:
- EnrollPro advisory section resolution (3 fallback paths)
- Student upsert for advisory section
- Stale enrollment cleanup
- Atlas faculty matching (4 identity resolution strategies)
- Atlas teaching load sync (published schedule, nested, flat, facultySubjects — 4 data shapes)
- Teaching section student sync
- Advisory class assignment verification

This is unmaintainable and hard to debug.

### 3. Duplicated HTTP Clients
Each file re-implements HTTP fetching:
- `atlasSync.ts` → `get()` and `post()` using raw `http`/`https`
- `teacherSync.ts` → `atlasGet()` using raw `http`/`https`
- `syncService.ts` → `atlasRequest()` and `safeFetch()` using raw `http`/`https` + `fetch`
- `enrollproSync.ts` → uses `enrollproClient` (the only proper abstraction)

### 4. Console.log Noise
- Both `console.log` and `logger.debug` used inconsistently
- Per-record logging in loops (e.g., `console.log` for every student upsert)
- No way to silence verbose output in production

### 5. No Batch Operations
- Students are upserted one-by-one in a loop
- Sections are upserted one-by-one
- Could use Prisma `createMany` with `skipDuplicates` for bulk inserts

---

## Proposed Architecture

### Target: 4 files instead of 7

```
server/src/lib/
├── sync/
│   ├── index.ts              — Public API (re-exports)
│   ├── coordinator.ts        — Scheduler, circuit breaker, SSE (from syncCoordinator.ts)
│   ├── enrollpro.ts          — EnrollPro sync (from enrollproSync.ts, cleaned up)
│   ├── atlas.ts              — Atlas sync (from atlasSync.ts, cleaned up)
│   ├── branding.ts           — Branding sync (from enrollproBrandingSync.ts, unchanged)
│   ├── teacherLogin.ts       — Per-teacher login sync (extracted from teacherSync.ts)
│   ├── cache.ts              — TTL cache (from syncCache.ts, unchanged)
│   ├── httpClient.ts         — SHARED HTTP client for Atlas + EnrollPro
│   └── utils.ts              — SHARED utilities (grade mapping, subject normalization)
```

### Files to DELETE
- `server/src/services/syncService.ts` — redundant, unused by coordinator
- `server/src/lib/syncCoordinator.ts` — moved to `sync/coordinator.ts`
- `server/src/lib/enrollproSync.ts` — moved to `sync/enrollpro.ts`
- `server/src/lib/atlasSync.ts` — moved to `sync/atlas.ts`
- `server/src/lib/teacherSync.ts` — split into `sync/teacherLogin.ts`
- `server/src/lib/syncCache.ts` — moved to `sync/cache.ts`
- `server/src/lib/enrollproBrandingSync.ts` — moved to `sync/branding.ts`
- All files in `(unused files)/server/scripts/` — dead code

### Routes Update
- `server/src/routes/sync.ts` — update imports to point to `sync/` directory

---

## Implementation Steps

### Phase 1: Extract Shared Utilities (Low Risk)

**Step 1.1** — Create `sync/httpClient.ts`
- Single `atlasGet()`, `atlasPost()`, `enrollproGet()` functions
- Shared timeout, error handling, retry logic
- Remove duplicate HTTP code from `atlasSync.ts`, `teacherSync.ts`, `syncService.ts`

**Step 1.2** — Create `sync/utils.ts`
- Single `mapGradeLevel()` (canonical implementation)
- Single `normalizeSubjectCode()` / `resolveSubjectCode()`
- Single `normalizeEmail()`
- Re-export from `atlasUtils.ts` where appropriate

### Phase 2: Split teacherSync.ts (Medium Risk)

**Step 2.1** — Extract `resolveAdvisory()` from `syncTeacherOnLogin()`
- Handles EnrollPro advisory section resolution (3 fallback paths)
- Returns `{ advisorySection, advisorySectionSmartId, advisorySectionGradeLevel, studentsFound, errors }`

**Step 2.2** — Extract `syncAtlasTeachingLoad()` from `syncTeacherOnLogin()`
- Handles Atlas faculty matching + teaching load sync
- Returns `{ classAssignmentsCreated, classAssignmentsFromAtlas, errors }`

**Step 2.3** — Extract `syncTeachingSectionStudents()` from `syncTeacherOnLogin()`
- Handles student upsert for non-advisory teaching sections
- Returns `{ studentsUpserted, errors }`

**Step 2.4** — Rewrite `syncTeacherOnLogin()` as a thin orchestrator
```typescript
export async function syncTeacherOnLogin(...) {
  const advisory = await resolveAdvisory(...);
  const atlasLoad = await syncAtlasTeachingLoad(...);
  const teachingStudents = await syncTeachingSectionStudents(...);
  return mergeResults(advisory, atlasLoad, teachingStudents);
}
```

### Phase 3: Clean Up enrollproSync.ts and atlasSync.ts (Low Risk)

**Step 3.1** — Remove `syncService.ts` entirely
- Verify no imports reference it (grep for `syncService`)
- The `syncCoordinator.ts` already uses `enrollproSync.ts` instead

**Step 3.2** — Clean up console.log noise
- Replace `console.log` in hot loops with `logger.debug`
- Add a `VERBOSE` env var to control per-record logging
- Keep `logger.info` for checkpoint summaries only

**Step 3.3** — Batch student upserts where possible
- Collect all students in a batch, then use `prisma.student.createMany({ skipDuplicates: true })`
- Follow with individual upserts only for records that need updates

### Phase 4: Move to sync/ Directory (Low Risk)

**Step 4.1** — Create `server/src/lib/sync/` directory
**Step 4.2** — Move files with updated imports
**Step 4.3** — Create `sync/index.ts` re-exporting public API
**Step 4.4** — Update all import paths across the codebase

### Phase 5: Cleanup (No Risk)

**Step 5.1** — Delete `(unused files)/server/scripts/` sync-related files
**Step 5.2** — Delete old `syncService.ts`
**Step 5.3** — Update `routes/sync.ts` imports

---

## What NOT to Change

- `syncCoordinator.ts` architecture (scheduler, circuit breaker, SSE) — it's well designed
- `syncCache.ts` — small, clean, works
- `enrollproBrandingSync.ts` — small, focused, works
- The dependency order: EnrollPro → Atlas → Branding
- The `syncHistory` persistence pattern

---

## Risk Assessment

| Phase | Risk | Reason |
|-------|------|--------|
| Phase 1: Extract utils | Low | Additive, no behavior change |
| Phase 2: Split teacherSync | Medium | Most complex file, many edge cases |
| Phase 3: Clean up | Low | Mostly removing dead code |
| Phase 4: Move files | Low | Import path changes only |
| Phase 5: Cleanup | None | Deleting unused files |

---

## Success Criteria

1. **teacherSync.ts reduced from 1102 lines to ~300 lines** (orchestrator only)
2. **syncService.ts deleted** (740 lines of dead code removed)
3. **Zero duplicate HTTP client code** (single httpClient.ts)
4. **Zero duplicate grade/subject mapping** (single utils.ts)
5. **Console noise reduced by ~70%** (logger.debug for per-record, logger.info for checkpoints)
6. **All existing tests pass** (no behavior change)
7. **Total sync code reduced from ~3,900 to ~2,800 lines** (~28% reduction)
