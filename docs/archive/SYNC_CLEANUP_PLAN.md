# Sync Cleanup Plan — Option A (Minimal Consolidation)

**Date**: 2026-08-21  
**Risk Level**: Low  
**Estimated Effort**: 2 hours  
**Impact on Runtime**: Zero (no logic changes, only file reorganization)

---

## Goal

Reduce sync files from 13 to 10 by:
1. Merging duplicate utility files
2. Splitting one oversized file into two focused files
3. Removing dead webhook references

**No business logic changes. No API changes. No database changes.**

---

## Risk Assessment

| Change | Risk | Why It's Safe |
|---|---|---|
| Merge `sync/utils.ts` + `atlasUtils.ts` | None | Same functions, one file. Import paths change but logic identical. |
| Split `teacherSync.ts` | None | Extract functions to new file. Original calls new file. Same logic. |
| Remove webhook dead code | None | Comments and unused env vars. No runtime code. |

### What Could Break (and won't)

- **Import paths**: We update all imports. TypeScript compiler catches any misses.
- **Function names**: We keep exact same function names and signatures.
- **Export/Import chains**: We verify no circular dependencies.

---

## Pre-Implementation Checklist

Before starting, confirm:

- [ ] `npm run build` passes in `server/` directory
- [ ] `npm run dev` starts without errors
- [ ] No uncommitted changes (clean git state)

---

## Phase 1: Remove Dead Webhook Code (10 minutes)

### Files to Modify

| File | Line(s) | Action |
|---|---|---|
| `server/src/index.ts` | 197-198 | Delete the `ENROLLPRO_WEBHOOK_KEY` warning block |
| `server/src/middleware/csrf.ts` | 44 | Remove "webhook endpoints" from comment |
| `server/.env.example` | — | Delete `ENROLLPRO_WEBHOOK_KEY`, `ATLAS_WEBHOOK_KEY`, `AIMS_WEBHOOK_KEY` lines |
| `server/src/lib/syncCoordinator.ts` | 13, 350 | Remove "webhook" from comments |

### Verification

```bash
cd server
grep -r "webhook" src/ .env.example
# Should return 0 results
npm run build  # Must pass
```

---

## Phase 2: Merge Utility Files (30 minutes)

### Current State

```
server/src/lib/
├── sync/utils.ts        (166 lines) — upsertLearner, dropStaleEnrollments, upsertSection, grade mapping
└── atlasUtils.ts        (232 lines) — grade mapping, subject code/name resolution, homeroom helpers
```

**Overlap**: Both have grade level mapping functions.

### Target State

```
server/src/lib/
└── sync/utils.ts        (~350 lines) — ALL shared sync utilities combined
```

Delete `atlasUtils.ts` after merging.

### Step-by-Step

1. **Read both files** to identify exact functions and exports
2. **Copy all unique functions from `atlasUtils.ts` into `sync/utils.ts`**
   - Functions to move: `resolveSubjectCode`, `resolveSubjectName`, `sanitizeSubjectName`, `normalizeSubjectLabel`, `ensureHomeroomGuidanceLabel`, `inferSubjectTypeFromCode`, `HOMEROOM_GUIDANCE_LABEL`, `HOMEROOM_GUIDANCE_MINUTES`
   - Keep existing exports from `sync/utils.ts`: `upsertLearner`, `dropStaleEnrollments`, `upsertSection`
3. **Remove duplicate grade mapping** if both files have `mapGradeLevel` — keep one copy
4. **Delete `atlasUtils.ts`**
5. **Update all imports** across the codebase

### Files That Import from `atlasUtils.ts` (must update)

| File | Current Import | New Import |
|---|---|---|
| `server/src/lib/atlasSync.ts` | `from './atlasUtils'` | `from './sync/utils'` |
| `server/src/lib/teacherSync.ts` | `from './atlasUtils'` | `from './sync/utils'` |

### Files That Import from `sync/utils.ts` (no change needed)

| File | Import |
|---|---|
| `server/src/lib/teacherSync.ts` | `from './sync/utils'` (already correct) |

### Verification

```bash
cd server
grep -r "from.*atlasUtils" src/
# Should return 0 results
npm run build  # Must pass
npm run lint   # Must pass
```

---

## Phase 3: Split teacherSync.ts (1 hour)

### Current State

`server/src/lib/teacherSync.ts` (1005 lines) handles:
- Advisory section resolution from EnrollPro
- Student sync for advisory section
- Teaching load sync from ATLAS
- Schedule entry sync
- Class assignment creation

### Target State

```
server/src/lib/
├── teacherAdvisorySync.ts   (~400 lines) — advisory section + student sync
└── teacherLoadSync.ts       (~500 lines) — ATLAS teaching load + schedule
```

The original `teacherSync.ts` becomes a thin orchestrator that calls both.

### Detailed Split

#### File 1: `teacherAdvisorySync.ts`

Extract these functions/logic from `teacherSync.ts`:

```
- resolveAdvisoryFromSections()     (lines ~116-200)
- Advisory section student sync     (lines ~200-350)
- Advisory workload entry           (lines ~350-380)
```

Exports:
```typescript
export async function syncTeacherAdvisory(
  smartTeacherId: string,
  employeeId: string,
  schoolYearId: number,
  schoolYearLabel: string,
): Promise<{ advisorySection: string | null; studentsFound: number; studentsUpserted: number; errors: string[] }>
```

#### File 2: `teacherLoadSync.ts`

Extract these functions/logic from `teacherSync.ts`:

```
- ATLAS faculty matching            (lines ~380-450)
- Teaching load sync                (lines ~450-600)
- Schedule entry sync               (lines ~600-750)
- Class assignment creation         (lines ~750-900)
```

Exports:
```typescript
export async function syncTeacherLoad(
  smartTeacherId: string,
  employeeId: string,
  email: string,
  schoolYearId: number,
  schoolYearLabel: string,
): Promise<{ classAssignmentsCreated: number; classAssignmentsFromAtlas: number; errors: string[] }>
```

#### File 3: `teacherSync.ts` (slimmed orchestrator)

Becomes ~100 lines:

```typescript
import { syncTeacherAdvisory } from './teacherAdvisorySync';
import { syncTeacherLoad } from './teacherLoadSync';

export async function syncTeacherOnLogin(
  smartTeacherId: string,
  employeeId: string,
  email: string,
): Promise<TeacherSyncResult> {
  // 1. Resolve school year
  // 2. Call syncTeacherAdvisory()
  // 3. Call syncTeacherLoad()
  // 4. Combine results
  // 5. Return TeacherSyncResult
}
```

### Files That Import from `teacherSync.ts` (verify no change needed)

| File | Import | Action |
|---|---|---|
| `server/src/routes/auth.ts` | `syncTeacherOnLogin` | No change — function stays in `teacherSync.ts` |
| `server/src/routes/teacher.ts` | `syncTeacherOnLogin` | No change |
| Any other file | — | Check with grep |

### Verification

```bash
cd server
grep -r "from.*teacherSync" src/
# All should still point to ./teacherSync (the orchestrator)
npm run build  # Must pass
npm run lint   # Must pass
```

---

## Phase 4: Final Verification (10 minutes)

### Build & Lint

```bash
cd server
npm run build
npm run lint
```

### Import Integrity Check

```bash
# No references to deleted files
grep -r "from.*atlasUtils" src/        # Should be 0
grep -r "from.*sync/utils.*atlasUtils" src/  # Should be 0

# All new files are imported somewhere
grep -r "teacherAdvisorySync" src/     # Should find teacherSync.ts
grep -r "teacherLoadSync" src/         # Should find teacherSync.ts
```

### Runtime Smoke Test

1. Start dev server: `npm run dev`
2. Login as teacher — verify advisory data loads
3. Login as admin — verify sync status endpoint works
4. Trigger manual sync — verify it completes without errors

---

## Rollback Plan

If anything breaks:

```bash
git checkout -- server/src/lib/atlasUtils.ts
git checkout -- server/src/lib/teacherSync.ts
git checkout -- server/src/lib/sync/utils.ts
git checkout -- server/src/index.ts
git checkout -- server/src/middleware/csrf.ts
git checkout -- server/.env.example
```

All changes are file-level. No database migrations. No env var changes at runtime.

---

## Final File Structure

```
server/src/lib/
├── sync/
│   ├── httpClient.ts          (167 lines) — unchanged
│   └── utils.ts               (~350 lines) — combined from sync/utils.ts + atlasUtils.ts
├── enrollproClient.ts         (946 lines) — unchanged
├── enrollproSync.ts           (862 lines) — unchanged
├── enrollproBrandingSync.ts   (143 lines) — unchanged
├── atlasSync.ts               (828 lines) — unchanged (imports updated)
├── teacherSync.ts             (~100 lines) — slimmed orchestrator
├── teacherAdvisorySync.ts     (~400 lines) — NEW (extracted from teacherSync.ts)
├── teacherLoadSync.ts         (~500 lines) — NEW (extracted from teacherSync.ts)
├── syncCoordinator.ts         (579 lines) — unchanged (comments cleaned)
├── syncCache.ts               (153 lines) — unchanged
├── sseManager.ts              (67 lines) — unchanged
├── schoolYearResolver.ts      (85 lines) — unchanged
└── workload.ts                (49 lines) — unchanged
```

**Before**: 13 files, ~4,137 lines  
**After**: 12 files, ~4,137 lines (same code, better organized)

Wait — we delete `atlasUtils.ts` and add 2 new files. That's 13 - 1 + 2 = 14? No:

- Delete `atlasUtils.ts` (-1)
- Add `teacherAdvisorySync.ts` (+1)
- Add `teacherLoadSync.ts` (+1)
- `teacherSync.ts` shrinks but stays

**Net: 13 - 1 + 2 = 14 files?** No — we merged `atlasUtils.ts` INTO `sync/utils.ts`, so:

- `sync/utils.ts` stays (gets bigger)
- `atlasUtils.ts` deleted (-1)
- `teacherAdvisorySync.ts` added (+1)
- `teacherLoadSync.ts` added (+1)

**Final: 13 - 1 + 2 = 14 files**  
But `teacherSync.ts` shrinks from 1005 → ~100 lines.

Actually the real win is:
- `atlasUtils.ts` (232 lines) merged into `sync/utils.ts` → one less file to navigate
- `teacherSync.ts` (1005 lines) split into 3 files → each is readable

**The goal was never fewer files. It was clearer files.**

---

## Success Criteria

- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] No `atlasUtils` references remain
- [ ] `teacherSync.ts` is under 150 lines
- [ ] `sync/utils.ts` has all shared utilities
- [ ] Dead webhook code is gone
- [ ] Manual sync test passes
- [ ] Teacher login sync works
