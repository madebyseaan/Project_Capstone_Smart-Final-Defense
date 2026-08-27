# SMART ECR — Grading System Redesign Status & Next Steps

**Date:** August 18, 2026  
**Status:** Phases 0–7 COMPLETE (core implementation)  
**Remaining:** Data alignment fixes for STE/SPA/SPS special programs

---

## Summary of What Was Done

### Phases 0–7: COMPLETED ✅

| Phase | What | Status |
|-------|------|--------|
| **0** | Bug fixes: seed weights, ECR import, class record list, ECR template mapping | ✅ |
| **1** | Schema: TransmutationEntry model, nullable Subject weights, seed 41 rows | ✅ |
| **2** | Backend: DB-backed transmutation cache, async transmute(), 6 CRUD endpoints | ✅ |
| **3** | Backend: 3-tier weight resolution (subject override → group config → fallback), per-subject weight CRUD | ✅ |
| **4** | Backend: ECR generation injects effective weights into Excel (M10/S10/Y10) | ✅ |
| **5** | Frontend: TransmutationTable admin page, per-subject weight editor, sidebar route | ✅ |
| **6** | Frontend: ClassRecordTable fetches transmutation from API instead of hardcoded | ✅ |
| **7** | Final verification: all builds pass, zero runtime errors | ✅ |

### New Files Created
- `server/src/lib/transmutationCache.ts` — 5-min TTL cache for transmutation table
- `src/pages/admin/TransmutationTable.tsx` — Admin UI for editing transmutation table

### Key Files Modified
- `server/prisma/schema.prisma` — TransmutationEntry model, nullable Subject weights
- `server/src/routes/grades.ts` — async transmute(), exported resolveEffectiveWeightsForClassAssignment, public transmutation API
- `server/src/routes/admin.ts` — 6 transmutation CRUD endpoints, 4 per-subject weight endpoints
- `server/src/routes/ecrTemplates.ts` — Injects weights into ECR Excel generation
- `server/src/lib/ecrSubjectMapping.ts` — Updated to SMART-ECR template filenames
- `server/src/lib/transmutationCache.ts` — New cache module
- `server/prisma/seed.ts` — Fixed WW weight (30→20), seeded 41 transmutation rows
- `src/pages/admin/GradingConfig.tsx` — Merged MAPEH+TLE, merged Core+MathSci, per-subject weight editor
- `src/pages/teacher/components/ClassRecordTable.tsx` — Fetches transmutation from API
- `src/pages/teacher/components/ClassRecordHero.tsx` — Weight source indicators
- `src/pages/teacher/components/classRecordMobileUtils.ts` — Optional transmutation table parameter
- `src/pages/teacher/ClassRecordsList.tsx` — Fixed weight display with effectiveWeights fallback
- `src/lib/api.ts` — New API functions for transmutation and subject weights
- `src/App.tsx` — TransmutationTable route
- `src/layouts/AdminLayout.tsx` — Transmutation Table sidebar item

---

## Known Issues to Fix

### Issue 1: STE/SPA/SPS Subject Type Misclassification

**Problem:** Atlas sync defaults ALL new subjects to `CORE` type. This means:
- STE subjects (Research, Biotech, etc.) → typed as CORE → ✅ correct (follows Science 20/50/30)
- SPA subjects (arts specialization) → typed as CORE → ❌ should be MAPEH (20/60/20)
- SPS subjects (sports specialization) → typed as CORE → ❌ should be MAPEH (20/60/20)

**Root cause:** `atlasSync.ts` line 237 defaults to `type: 'CORE'`. The SubjectType enum has no STE/SPA/SPS values.

**Data impact:** 87 subjects typed as CORE, only 4 as MAPEH, 3 as TLE. SPA/SPS are collapsed into single "Specialization" records instead of individual subjects.

### Issue 2: SPA/SPS Subject Granularity

**Problem:** SPA and SPS are single records (`SPA_SPEC`, `SPS_SPEC`) instead of individual subjects (Music, Dance, Visual Arts for SPA; Basketball, Swimming, etc. for SPS).

**Root cause:** Atlas sends them as single specialization codes.

### Issue 3: Transmutation Table Empty on First Load

**Problem:** The `TransmutationEntry` table exists but has no rows until "Reset to DepEd Default" is clicked or seed is run.

**Root cause:** Seed was run before the table was created via `prisma db push`.

---

## Remaining Work Plan

### Phase 8: Fix STE/SPA/SPS Subject Types

**Goal:** Correctly classify special program subjects so they follow the right weight groups.

#### Step 8.1: Research DepEd weight guidelines for special programs
- Confirm STE subjects follow Science/Core weights (20/50/30)
- Confirm SPA subjects follow MAPEH weights (20/60/20)  
- Confirm SPS subjects follow MAPEH weights (20/60/20)
- Check if DepEd has specific guidelines for STE/SPA/SPS grading

#### Step 8.2: Fix Atlas sync to correctly type subjects
- **File:** `server/src/lib/atlasSync.ts`
- When creating subjects, check if code starts with `SPA_` or `SPS_` → set type to `MAPEH`
- STE subjects keep type `CORE` (already correct)
- Add logic to detect program type from subject code prefix

#### Step 8.3: Fix existing data
- Create a migration script or update seed to reclassify existing subjects
- `SPA_SPEC*` subjects → change type from CORE to MAPEH
- `SPS_SPEC*` subjects → change type from CORE to MAPEH
- Verify MAPEH7-9 are typed as MAPEH (currently some may be CORE)

#### Step 8.4: Update GradingConfig admin UI
- Add note showing which parent group each specialization follows
- Example: "STE Research → follows Core Academic (20/50/30)"
- Example: "SPA Specialization → follows MAPEH & TLE (20/60/20)"

#### Step 8.5: Build & Test
```bash
cd server && npm run build     # Server builds
npm run build                  # Frontend builds
pm2 restart all                # Restart services
pm2 logs server --lines 20     # Check for runtime errors
```

**Testing Gate:**
- [ ] `npm run build` (server) passes
- [ ] `npm run build` (frontend) passes
- [ ] `pm2 logs server` shows no errors after restart
- [ ] SPA subjects show as MAPEH type in admin UI
- [ ] SPS subjects show as MAPEH type in admin UI
- [ ] STE subjects remain as CORE type
- [ ] Per-subject override toggle works for all types
- [ ] Grade calculation uses correct weights for each type

---

### Phase 9: Auto-Seed Transmutation Table

**Goal:** Transmutation table auto-populates on first server start.

#### Step 9.1: Add auto-seed logic
- **File:** `server/src/index.ts` or `server/src/lib/transmutationCache.ts`
- On server start, check if TransmutationEntry table is empty
- If empty, insert 41 default DepEd rows
- Log the action

#### Step 9.2: Build & Test
```bash
cd server && npm run build
pm2 restart all
pm2 logs server --lines 20     # Should see "Seeded 41 transmutation entries"
```

**Testing Gate:**
- [ ] Fresh DB → server starts → transmutation table has 41 rows
- [ ] Existing DB → server starts → no duplicate rows
- [ ] `pm2 logs server` shows seed confirmation

---

### Phase 10: Full Regression Test

**Goal:** Verify everything works end-to-end.

#### Step 10.1: Build verification
```bash
npm run build                  # Frontend
cd server && npm run build     # Backend
npx prisma generate            # Prisma client
```

#### Step 10.2: Runtime verification
```bash
pm2 restart all
pm2 logs server --lines 30     # Check for errors
```

#### Step 10.3: Manual testing checklist
- [ ] Admin → Grading Config → shows 2 groups (Core, MAPEH&TLE)
- [ ] Admin → Grading Config → per-subject overrides work
- [ ] Admin → Transmutation Table → shows 41 rows
- [ ] Admin → Transmutation Table → edit/save/reset works
- [ ] Teacher → Class Record → weights display correctly
- [ ] Teacher → Class Record → weight source indicator shows
- [ ] Teacher → ECR Export → Excel has correct weights in M10/S10/Y10
- [ ] Teacher → ECR Import → grades use correct weights
- [ ] Grade calculation → matches manual computation
- [ ] Mobile view → same grades as desktop

---

## Architecture Notes

### Weight Resolution Chain
```
1. Subject.writtenWorkWeight (if not null) → "subject-override"
2. GradingConfig by SubjectType → "subject-type"  
3. GENERIC_FALLBACK_WEIGHTS (20/50/30) → "generic-fallback"
```

### SubjectType Mapping
| Type | Weight Group | ECR Template | Subjects |
|------|-------------|--------------|----------|
| CORE | 20/50/30 | Group 1 (AP/Eng/Fil/Math/Sci/GMRC/ValEd) | Core + STE |
| MAPEH | 20/60/20 | Group 2 (EPP/TLE/MAPEH) | MAPEH + SPA + SPS |
| TLE | 20/60/20 | Group 2 (EPP/TLE/MAPEH) | TLE exploratory |
| MATH_SCIENCE | 20/50/30 | Group 1 | Math & Science (merged with CORE in UI) |

### PM2 Management
```bash
pm2 restart all                # Restart all services
pm2 logs server --lines 30     # Check server logs
pm2 logs client --lines 30     # Check client/vite logs
pm2 status                     # Check process status
pm2 stop all                   # Stop all
pm2 start all                  # Start all
pm2 delete all                 # Remove all (need to re-add)
```

### Build Commands
```bash
# Frontend
npm run build                  # Vite production build
npm run dev                    # Vite dev server (port 5173)

# Backend  
cd server && npm run build     # TypeScript compile
cd server && npm run dev       # ts-node-dev (port 5003)

# Prisma
cd server && npx prisma generate    # Generate client
cd server && npx prisma db push     # Sync schema to DB
cd server && npx prisma db seed     # Run seed file
```

---

## Files Changed Summary

| File | Phase | Change |
|------|-------|--------|
| `server/prisma/schema.prisma` | P1 | TransmutationEntry model, nullable weights |
| `server/prisma/seed.ts` | P0,P1 | Fixed WW weight, seed transmutation rows |
| `server/src/lib/transmutationCache.ts` | P2 | NEW: 5-min TTL cache |
| `server/src/routes/grades.ts` | P0,P2,P3,P6 | async transmute(), weight resolution, public API |
| `server/src/routes/admin.ts` | P2,P3 | Transmutation CRUD, subject weight CRUD |
| `server/src/routes/ecrTemplates.ts` | P4 | Inject weights into ECR Excel |
| `server/src/lib/ecrSubjectMapping.ts` | P0 | SMART-ECR template filenames |
| `src/pages/admin/TransmutationTable.tsx` | P5 | NEW: Admin transmutation editor |
| `src/pages/admin/GradingConfig.tsx` | P5 | Per-subject weight editor, merged groups |
| `src/pages/teacher/components/ClassRecordTable.tsx` | P6 | Fetch transmutation from API |
| `src/pages/teacher/components/ClassRecordHero.tsx` | P6 | Weight source indicators |
| `src/pages/teacher/components/classRecordMobileUtils.ts` | P6 | Optional transmutation parameter |
| `src/pages/teacher/ClassRecordsList.tsx` | P0 | Fixed weight display |
| `src/lib/api.ts` | P5,P6 | New API functions |
| `src/App.tsx` | P5 | TransmutationTable route |
| `src/layouts/AdminLayout.tsx` | P5 | Sidebar menu item |
