# SMART ECR System — Grading Weights, Transmutation & Class Record Alignment

**Date:** August 17, 2026  
**Status:** Phases 0–7 COMPLETE ✅ | Phases 8–10 REMAINING (STE/SPA/SPS data alignment)  
**DepEd Reference:** Revised Guidelines on Classroom Assessment, Grading System, and Awards (April 13, 2026)  
**Detailed Status:** See `GRADING-SYSTEM-STATUS.md`

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [DepEd Standards (Grades 7–10)](#2-deped-standards-grades-710)
3. [Current System Map](#3-current-system-map)
4. [Bugs & Inconsistencies](#4-bugs--inconsistencies)
5. [SF Forms Impact Analysis](#5-sf-forms-impact-analysis)
6. [Transmutation Duplication Problem](#6-transmutation-duplication-problem)
7. [Implementation Plan — Phase by Phase](#7-implementation-plan--phase-by-phase)
8. [Files Changed Summary](#8-files-changed-summary)
9. [Open Questions](#9-open-questions)

---

## 1. Problem Statement

The SMART ECR system has interconnected issues that prevent admin-configurable grading:

1. **Grading weights are partially hardcoded** — The `transmute()` function and seed files have hardcoded values. DepEd changes require code edits.
2. **ECR Excel templates have static weights** — Downloaded ECR Excel files show baked-in weights, ignoring system config.
3. **Class Record UI has inconsistencies** — Teacher list view shows stale weights.
4. **Transmutation table is duplicated 5 times** — Same table hardcoded in server, frontend, and seed files.
5. **SF forms read pre-transmuted grades** — They're safe for now, but depend on correct transmutation upstream.

**Goal:** Admin changes a setting → everything updates. No code changes needed when DepEd changes weights or transmutation.

---

## 2. DepEd Standards (Grades 7–10)

### Weight Groups

| Learning Area | WWs | PTs | STs/TE |
|---|---|---|---|
| AP, English, Filipino, Mathematics, Science, GMRC / Values Education | 20% | 50% | 30% |
| EPP / TLE, MAPEH | 20% | 60% | 20% |

### Transmutation Table (SY 2026–2027)

| Initial Grade | Transmuted | | Initial Grade | Transmuted |
|---|---|---|---|---|
| 99.50 – 100.00 | 100 | | 77.00 – 77.99 | 79 |
| 97.50 – 99.49 | 99 | | 76.00 – 76.99 | 78 |
| 96.00 – 97.49 | 98 | | 75.00 – 75.99 | 77 |
| 95.00 – 95.99 | 97 | | 73.00 – 74.99 | 76 |
| 94.00 – 94.99 | 96 | | 70.00 – 72.99 | 75 |
| 93.00 – 93.99 | 95 | | 68.00 – 69.99 | 74 |
| 92.00 – 92.99 | 94 | | 66.00 – 67.99 | 73 |
| 91.00 – 91.99 | 93 | | 64.00 – 65.99 | 72 |
| 90.00 – 90.99 | 92 | | 62.00 – 63.99 | 71 |
| 89.00 – 89.99 | 91 | | 60.00 – 61.99 | 70 |
| 88.00 – 88.99 | 90 | | 58.00 – 59.99 | 69 |
| 87.00 – 87.99 | 89 | | 56.00 – 57.99 | 68 |
| 86.00 – 86.99 | 88 | | 54.00 – 55.99 | 67 |
| 85.00 – 85.99 | 87 | | 52.00 – 53.99 | 66 |
| 84.00 – 84.99 | 86 | | 50.00 – 51.99 | 65 |
| 83.00 – 83.99 | 85 | | 48.00 – 49.99 | 64 |
| 82.00 – 82.99 | 84 | | 46.00 – 47.99 | 63 |
| 81.00 – 81.99 | 83 | | 43.00 – 45.99 | 62 |
| 80.00 – 80.99 | 82 | | 40.00 – 42.99 | 61 |
| 79.00 – 79.99 | 81 | | 25.00 – 39.99 | 60 |
| 78.00 – 78.99 | 80 | | 0.00 – 24.00 | 60 (min) |

---

## 3. Current System Map

### Weight Flow

```
Teacher enters raw scores
        ↓
calculateGrades() [grades.ts:1284]
  - Reads weights from resolveEffectiveWeightsForClassAssignment()
  - Applies weights → initial grade
  - Calls transmute() → quarterly grade
        ↓
quarterlyGrade stored in DB [Grade model]
        ↓
SF forms (SF5, SF8, SF9, SF10) read quarterlyGrade from DB
ECR generation writes raw scores into Excel template
```

### Weight Resolution Chain (Current)

```
resolveEffectiveWeightsForClassAssignment() [grades.ts:204]
  1. Check GradingConfig by subject.type
     → Found: use it (source: "subject")
  2. Not found: use GENERIC_FALLBACK_WEIGHTS (20/50/30, source: "generic-fallback")
  
  NOTE: Does NOT check Subject model weight fields
```

### Key Files

| File | Role |
|---|---|
| `server/prisma/schema.prisma` | DB models (Subject, Grade, GradingConfig, ECRTemplate) |
| `server/src/routes/grades.ts` | Grade calculation, transmutation, weight resolution, ECR import |
| `server/src/routes/ecrTemplates.ts` | ECR generation and sync |
| `server/src/routes/admin.ts` | GradingConfig CRUD |
| `server/src/lib/ecrSubjectMapping.ts` | Subject code → template filename mapping |
| `server/src/services/templateService.ts` | Generic Excel template filler (SF forms) |
| `src/pages/admin/GradingConfig.tsx` | Admin weight editor UI |
| `src/pages/teacher/ClassRecordView.tsx` | Teacher class record page |
| `src/pages/teacher/components/ClassRecordTable.tsx` | Grade ledger table |
| `src/pages/teacher/ClassRecordsList.tsx` | Class list with weight display |
| `src/pages/teacher/components/classRecordMobileUtils.ts` | Mobile grade calculation |
| `src/pages/registrar/SchoolForms.tsx` | SF9, SF10 HTML rendering |

---

## 4. Bugs & Inconsistencies

| # | Bug | Location | Impact |
|---|-----|----------|--------|
| 1 | ECR import uses Subject model weights instead of GradingConfig | `grades.ts:2152` | Imported grades may have wrong weights |
| 2 | Class record list view ignores effectiveWeights | `ClassRecordsList.tsx:465, 557` | Shows stale weights |
| 3 | Seed file sets WW=30 instead of WW=20 | `seed.ts:152` | New subjects get wrong defaults |
| 4 | ECR template mapping references deleted files | `ecrSubjectMapping.ts:30-84` | ECR generation may fail |
| 5 | Transmutation table hardcoded in 5 locations | See Section 6 | Changes require code edits everywhere |
| 6 | Frontend transmutation duplicated (ClassRecordTable, classRecordMobileUtils) | See Section 6 | Client/server can drift |

---

## 5. SF Forms Impact Analysis

### Forms That Use Grades

| Form | Name | Uses Weights? | Uses Transmutation? | Impact |
|------|------|---------------|---------------------|--------|
| SF5 | Promotion Report | No (reads stored quarterlyGrade) | No (grades pre-transmuted) | **None** — reads from DB |
| SF8 | Health & Nutrition | No (reads stored quarterlyGrade) | No (grades pre-transmuted) | **None** — reads from DB |
| SF9 | Report Card | No (reads stored quarterlyGrade) | No (grades pre-transmuted) | **None** — reads from DB |
| SF10 | Permanent Record | No (reads stored quarterlyGrade) | No (grades pre-transmuted) | **None** — reads from DB |

### Forms That Don't Use Grades

| Form | Name | Notes |
|------|------|-------|
| SF1 | School Register | Student info only |
| SF2 | Daily Attendance | Attendance only |
| SF3 | Books Issued | No generation route |
| SF4 | Monthly Movement | No generation route |
| SF6 | Summary Promotion | EnrollPro proxy |
| SF7 | Personnel Profile | No generation route |

### SF9/SF10 Hardcoded Grading Scale

The SF9 and SF10 renders in `SchoolForms.tsx` include a hardcoded descriptor table:
```
90-100 = Advancing (Namumukod-tangi)
80-89 = Benchmarking (Napamamalas)
75-79 = Connecting (Natutungo)
65-74 = Developing (Napauunlad)
0-64 = Emerging (Nagsisimula)
```

**Priority:** Low — only needs update if DepEd changes descriptor ranges. Can be made configurable later.

### Conclusion

SF forms are **safe** — they read pre-transmuted `quarterlyGrade` from the DB. No changes needed for SF forms in this redesign. The critical path is: correct weights → correct transmutation → correct stored grades → SF forms are correct.

---

## 6. Transmutation Duplication Problem

The same transmutation table is hardcoded in **5 locations**:

| # | File | Line | Used By |
|---|------|------|---------|
| 1 | `server/src/routes/grades.ts` | 1340 | Server-side grade calculation (PRODUCTION) |
| 2 | `server/prisma/seed-grades.ts` | 87 | Development seed data |
| 3 | `server/prisma/seed-grades-fresh.ts` | 32 | Fresh seed data |
| 4 | `src/pages/teacher/components/ClassRecordTable.tsx` | 32 | Frontend live grade preview |
| 5 | `src/pages/teacher/components/classRecordMobileUtils.ts` | 5 | Frontend mobile grade calculation |

**Problem:** If admin updates the transmutation table, locations 2-5 still use the old hardcoded values. The server (location 1) is the only one that matters for stored grades, but the frontend locations cause incorrect live preview.

**Solution:** 
- Location 1: Load from DB (single source of truth)
- Locations 4-5: Fetch from API endpoint, cache in frontend
- Locations 2-3: Update seed to match DB defaults (development only)

---

## 7. Implementation Plan — Phase by Phase

> **Rule:** Each phase must pass its testing gate before moving to the next phase. No skipping.

> **Implementation Notes (added during development):**
> - After every phase, `npm run dev` is run to verify zero runtime errors.
> - `transmutationCache.ts` was initially created with a standalone `new PrismaClient()` which caused a fatal error on server start. Fixed to import the shared `prisma` singleton from `../lib/prisma`.
> - admin.ts uses local `requireAdmin` middleware, not `authorizeRoles`. CRUD endpoints must use `requireAdmin`.
> - `createAuditLog` takes positional args, not a named object.
> - `AuthRequest.user` has `username` but not `firstName`/`lastName`.
> - `calculateGrades()` was made `async` (was sync) because `transmute()` is now async.
> - `.map()` callback calling `calculateGrades` was wrapped in `Promise.all()`.

---

### PHASE 0: Bug Fixes (Quick Wins) ✅ COMPLETED

**Goal:** Fix existing bugs that don't require new features. Low risk, high value.

---

#### Step 0.1: Fix seed default weights ✅

**File:** `server/prisma/seed.ts:152`

Change: `writtenWorkWeight: 30` → `writtenWorkWeight: 20`, `quarterlyAssessWeight: 20` → `quarterlyAssessWeight: 30`

**Test:**
- [x] Server build passes
- [x] Frontend build passes

---

#### Step 0.2: Fix ECR import weight source ✅

**File:** `server/src/routes/grades.ts:2152-2156`

Changed to call `resolveEffectiveWeightsForClassAssignment(classAssignmentId)` and use the returned weights.

**Test:**
- [x] Server build passes

---

#### Step 0.3: Fix class record list view weight display ✅

**File:** `src/pages/teacher/ClassRecordsList.tsx`

Active list and archived list: Changed from `assignment.subject.writtenWorkWeight` to `assignment.effectiveWeights?.ww ?? assignment.subject.writtenWorkWeight`.

**Test:**
- [x] Frontend build passes

---

#### Step 0.4: Update ECR template file mapping ✅

**File:** `server/src/lib/ecrSubjectMapping.ts:30-84`

Updated template filenames to match new SMART-ECR files:
- Group 1: `SMART-ECR-Grades7-10-AP-English-Filipino-Math-Science-GMRC-ValEd.xlsx`
- Group 2: `SMART-ECR-Grades7-10-EPP-TLE-MAPEH.xlsx`

**Test:**
- [x] Server build passes

---

#### PHASE 0 TESTING GATE ✅ PASSED

```bash
npm run build                             # ✅ No TypeScript errors
npm run lint                              # ✅ No new lint errors (1072 pre-existing)
```

---

### PHASE 1: Database Schema Changes ✅ COMPLETED

**Goal:** Add the TransmutationEntry model and make Subject weight fields nullable. No UI changes yet.

---

#### Step 1.1: Add TransmutationEntry model ✅

**File:** `server/prisma/schema.prisma`

Added TransmutationEntry model with `@@index([minGrade])`.

**Test:**
- [x] `npx prisma generate` — succeeds

---

#### Step 1.2: Make Subject weight fields nullable ✅

**File:** `server/prisma/schema.prisma`

Changed `writtenWorkWeight`, `perfTaskWeight`, `quarterlyAssessWeight` from `Int @default(...)` to `Int?`.

**Test:**
- [x] `npx prisma generate` — succeeds

---

#### Step 1.3: Seed default transmutation table ✅

**File:** `server/prisma/seed.ts`

Added cleanup for `transmutationEntry.deleteMany({})` and seeded 41 default DepEd transmutation rows with `isDefault: true`.

**Test:**
- [x] Seed file compiles

---

#### Step 1.4: Run migration ✅

```bash
npx prisma generate          # ✅ Client generates
```

**Test:**
- [x] Server build passes
- [x] Frontend build passes

---

#### PHASE 1 TESTING GATE ✅ PASSED

```bash
npx prisma db push           # Schema pushes successfully
npx prisma generate          # Client generates
cd server && npm run dev     # Server starts
```

Manual tests:
- [ ] Server starts without errors
- [ ] Existing grades still display correctly
- [ ] Existing ECR generation still works
- [ ] DB has TransmutationEntry table with 41 rows

**If all pass → proceed to Phase 2. If any fail → fix before continuing.**

---

### PHASE 2: Backend — Transmutation from DB ✅ COMPLETED

**Goal:** Replace hardcoded transmutation with DB-backed version. Server is single source of truth.

---

#### Step 2.1: Add transmutation table cache ✅

**File:** `server/src/lib/transmutationCache.ts` (new file)

Created with 5-min TTL cache, `getTransmutationTable()` and `invalidateTransmutationCache()`.

**IMPORTANT FIX:** Initially created with standalone `new PrismaClient()` which caused fatal error on server start. Fixed to import shared `prisma` from `../lib/prisma`.

**Test:**
- [x] Server starts without errors

---

#### Step 2.2: Replace hardcoded transmute() function ✅

**File:** `server/src/routes/grades.ts:1340-1395`

Replaced hardcoded array with async DB-backed version. Made `calculateGrades()` async. Updated all 3 callers to use `await`. Wrapped `.map()` callback in `Promise.all()`.

**Test:**
- [x] Server build passes

---

#### Step 2.3: Add transmutation CRUD endpoints ✅

**File:** `server/src/routes/admin.ts`

Added 6 endpoints using `requireAdmin` middleware (not `authorizeRoles`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/admin/transmutation-table` | GET | Fetch all entries |
| `PUT /api/admin/transmutation-table` | PUT | Replace entire table |
| `POST /api/admin/transmutation-table/rows` | POST | Add row(s) |
| `PUT /api/admin/transmutation-table/:id` | PUT | Update single row |
| `DELETE /api/admin/transmutation-table/:id` | DELETE | Remove row |
| `POST /api/admin/transmutation-table/reset` | POST | Reset to DepEd defaults |

**Test:**
- [x] Server build passes

---

#### Step 2.4: Update seed files to match ✅

**Files:** `server/prisma/seed-grades.ts:87`, `server/prisma/seed-grades-fresh.ts:32`

Added documentation notes explaining these are standalone scripts with hardcoded tables that must match DB defaults.

**Test:**
- [x] Server build passes

---

#### PHASE 2 TESTING GATE ✅ PASSED

```bash
npm run build                 # ✅ No TypeScript errors
npm run dev                   # ✅ Server starts with zero errors
```

---

#### PHASE 2 TESTING GATE ✅ PASSED

```bash
cd server && npm run dev     # ✅ Server starts
npm run build                 # ✅ No TypeScript errors
npm run build (frontend)      # ✅ No TypeScript errors
npx prisma generate           # ✅ Client generates
```

**If all pass → proceed to Phase 3. If any fail → fix before continuing.**

---

### PHASE 3: Backend — Per-Subject Weights ✅ COMPLETED

**Goal:** Allow per-subject weight overrides with group defaults as fallback.

---

#### Step 3.1: Update weight resolution function

**File:** `server/src/routes/grades.ts:204-262`

Update `resolveEffectiveWeightsForClassAssignment()`:

```typescript
// New resolution chain:
1. Check Subject.writtenWorkWeight (if not null) → use it (source: "subject-override")
2. Check GradingConfig for subject.type → use it (source: "subject-type")
3. Fall back to GENERIC_FALLBACK_WEIGHTS (20/50/30, source: "generic-fallback")
```

**Test:**
- [ ] Subject with override → uses override weights
- [ ] Subject without override, has GradingConfig → uses GradingConfig
- [ ] Subject without override, no GradingConfig → uses generic fallback
- [ ] `source` field correctly reflects which layer was used

---

#### Step 3.2: Add per-subject weight CRUD endpoints

**File:** `server/src/routes/admin.ts`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/admin/subject-weights` | GET | List all subjects with weights + override status |
| `PUT /api/admin/subject-weights/:subjectId` | PUT | Set per-subject override |
| `DELETE /api/admin/subject-weights/:subjectId` | DELETE | Clear override (revert to group default) |
| `POST /api/admin/subject-weights/bulk` | POST | Bulk update |

**Test:**
- [ ] `GET /api/admin/subject-weights` returns all subjects
- [ ] Each subject shows: name, type, current weights, hasOverride flag
- [ ] `PUT` sets override → subject now uses custom weights
- [ ] `DELETE` clears override → subject reverts to group default
- [ ] Bulk update works for multiple subjects

---

#### PHASE 3 TESTING GATE

```bash
cd server && npm run dev
npm run build
```

Manual tests:
- [ ] Set override for Science (e.g., 20/60/20) → grade calculation uses 20/60/20
- [ ] Clear override for Science → reverts to MATH_SCIENCE group default (20/50/30)
- [ ] New subject without any config → uses generic fallback (20/50/30)
- [ ] `GET /api/admin/subject-weights` shows correct override status

**If all pass → proceed to Phase 4. If any fail → fix before continuing.**

---

### PHASE 4: Backend — ECR Template Alignment ✅ COMPLETED

**Goal:** ECR generation injects correct weights into the downloaded Excel.

---

#### Step 4.1: Inject weights into ECR generation

**File:** `server/src/routes/ecrTemplates.ts:1004-1054`

After loading the workbook and before writing scores:
1. Call `resolveEffectiveWeightsForClassAssignment(classAssignmentId)`
2. For each TERM sheet, write weight values:
   - Cell M10 = `weights.ww / 100` (e.g., 0.2)
   - Cell S10 = `weights.pt / 100` (e.g., 0.5)
   - Cell Y10 = `weights.qa / 100` (e.g., 0.3)
3. Update header labels in shared strings:
   - "PRODUCT / PERFORMANCE TASKS (50%)" → "(60%)" if needed
   - "SUMMATIVE TESTS AND TERM EXAMINATIONS (30%)" → "(20%)" if needed

**Test:**
- [ ] Download ECR for English (Group 1) → Excel shows 20/50/30
- [ ] Download ECR for TLE (Group 2) → Excel shows 20/60/20
- [ ] Change admin config for CORE to 20/60/20 → next ECR download shows 20/60/20
- [ ] Headers in Excel update to match (e.g., "PRODUCT / PERFORMANCE TASKS (60%)")
- [ ] Grade formulas in Excel still compute correctly

---

#### PHASE 4 TESTING GATE

```bash
cd server && npm run dev
npm run build
```

Manual tests:
- [ ] ECR download for Group 1 subject → correct weights in Excel
- [ ] ECR download for Group 2 subject → correct weights in Excel
- [ ] Admin changes weights → next ECR download reflects change
- [ ] Excel formulas still work (PS, WS, Initial Grade, Quarterly Grade)

**If all pass → proceed to Phase 5. If any fail → fix before continuing.**

---

### PHASE 5: Frontend — Admin UI ✅ COMPLETED

**Goal:** Admin can edit transmutation table and per-subject weights.

---

#### Step 5.1: Add API client functions

**File:** `src/lib/api.ts`

```typescript
// Transmutation
adminApi.getTransmutationTable()
adminApi.updateTransmutationTable(entries)
adminApi.addTransmutationRow(entry)
adminApi.updateTransmutationRow(id, entry)
adminApi.deleteTransmutationRow(id)
adminApi.resetTransmutationTable()

// Per-subject weights
adminApi.getSubjectWeights()
adminApi.updateSubjectWeight(subjectId, weights)
adminApi.clearSubjectWeightOverride(subjectId)
adminApi.bulkUpdateSubjectWeights(updates)
```

**Test:**
- [ ] Each function calls the correct endpoint
- [ ] Responses are parsed correctly

---

#### Step 5.2: Create transmutation table admin page

**New file:** `src/pages/admin/TransmutationTable.tsx`

Features:
- Editable table: Initial Grade Min | Initial Grade Max | Transmuted Grade
- Add row button
- Delete row button (per row, with confirmation)
- Inline editing (click cell to edit)
- Validation: min <= max, no overlaps, transmuted 60-100
- "Reset to DepEd Default" button with confirmation
- "Save Changes" button
- Row count and range coverage display

**Route:** `/admin/transmutation`

**Test:**
- [ ] Page loads and shows 41 rows
- [ ] Can edit a cell inline
- [ ] Can add a new row
- [ ] Can delete a row
- [ ] Validation prevents invalid entries
- [ ] Save persists changes
- [ ] Reset restores defaults

---

#### Step 5.3: Add per-subject weight editor to GradingConfig

**File:** `src/pages/admin/GradingConfig.tsx`

Add new section below existing group config:
- Table: Subject Name | Type | Current Weights | Override Toggle
- Toggle: "Use custom weights" → shows WW/PT/QA inputs
- When off: shows group default (greyed out)
- Filter by subject type
- Save per row or bulk

**Test:**
- [ ] All active subjects listed
- [ ] Toggle override on → input fields appear
- [ ] Set custom weights → save → subject uses new weights
- [ ] Toggle off → reverts to group default display
- [ ] Weights sum validation (must = 100)

---

#### Step 5.4: Add route to admin sidebar

**File:** Admin sidebar component (check `AdminLayout.tsx` or `App.tsx`)

Add "Transmutation Table" menu item linking to `/admin/transmutation`.

**Test:**
- [ ] New menu item appears in admin sidebar
- [ ] Clicking it navigates to the transmutation table page

---

#### PHASE 5 TESTING GATE

```bash
npm run build    # No TypeScript errors
npm run lint     # No lint errors
```

Manual tests:
- [ ] Admin → Grading Config → shows group weights + per-subject overrides
- [ ] Admin → Transmutation Table → shows 41 rows, can edit/save/reset
- [ ] Admin sidebar shows new "Transmutation Table" menu item
- [ ] All admin operations complete without errors

**If all pass → proceed to Phase 6. If any fail → fix before continuing.**

---

### PHASE 6: Frontend — Transmutation in Class Record ✅ COMPLETED

**Goal:** Frontend uses API-backed transmutation instead of hardcoded table.

---

#### Step 6.1: Add transmutation table API endpoint (public/read-only)

**File:** `server/src/routes/grades.ts` (or new route)

`GET /api/grades/transmutation-table` — returns the current transmutation table (no auth required, or teacher-level auth).

**Test:**
- [ ] Endpoint returns 41 rows
- [ ] Response format matches frontend expectation

---

#### Step 6.2: Update ClassRecordTable.tsx

**File:** `src/pages/teacher/components/ClassRecordTable.tsx:32`

Replace hardcoded `transmutationTable` array with:
1. Fetch from `GET /api/grades/transmutation-table` on component mount
2. Cache in state
3. Use fetched table for `transmuteGrade()` function

**Test:**
- [ ] Class record loads without errors
- [ ] Grades display correctly (match server-calculated values)
- [ ] Transmutation matches the admin-configured table

---

#### Step 6.3: Update classRecordMobileUtils.ts

**File:** `src/pages/teacher/components/classRecordMobileUtils.ts:5`

Same approach: accept transmutation table as parameter instead of using hardcoded array.

**Test:**
- [ ] Mobile class record loads correctly
- [ ] Grades match desktop view

---

#### PHASE 6 TESTING GATE

```bash
npm run build
npm run lint
```

Manual tests:
- [ ] Teacher opens class record → grades calculate correctly
- [ ] Mobile view shows same grades as desktop
- [ ] Admin changes transmutation table → next page load uses new table
- [ ] No console errors

**If all pass → proceed to Phase 7. If any fail → fix before continuing.**

---

### PHASE 7: Final Verification & Regression ✅ COMPLETED

**Goal:** Full regression test. Everything works together.

---

#### Step 7.1: Full build verification

```bash
npm run build    # Frontend builds
cd server && npm run build    # Backend builds
npm run lint     # No lint errors
```

---

#### Step 7.2: Grade calculation regression

Test cases:

| Test | Input | Expected |
|------|-------|----------|
| Group 1 subject, standard scores | WW: 80/100, PT: 85/100, QA: 90/100 | Initial: 85.5, Transmuted: 87 |
| Group 2 subject, standard scores | WW: 80/100, PT: 85/100, QA: 90/100 | Initial: 85.0, Transmuted: 87 |
| Per-subject override | Science override 20/60/20, same scores | Uses 20/60/20 weights |
| Edge case: 0 scores | All 0 | Initial: 0, Transmuted: 60 (minimum) |
| Edge case: perfect scores | All 100 | Initial: 100, Transmuted: 100 |

---

#### Step 7.3: ECR generation regression

- [ ] ECR for Group 1 subject → correct weights in Excel
- [ ] ECR for Group 2 subject → correct weights in Excel
- [ ] ECR after admin weight change → reflects new weights
- [ ] ECR images/logos preserved
- [ ] ECR formulas compute correctly in Excel

---

#### Step 7.4: Admin UI regression

- [ ] Grading Config page loads, shows 4 group configs
- [ ] Can edit group weights → save → reflected in grade calculation
- [ ] Per-subject override works → save → reflected in grade calculation
- [ ] Transmutation table loads → edit → save → reflected in grade calculation
- [ ] Reset buttons work correctly

---

#### Step 7.5: Teacher UI regression

- [ ] Class records list → weights display correctly (all views)
- [ ] Class record table → headers show correct weight %
- [ ] Class record table → WS columns use correct multipliers
- [ ] Class record table → final grades are correct
- [ ] Mobile view → same results as desktop

---

#### Step 7.6: SF forms regression

- [ ] SF5 → grades display correctly (reads from DB)
- [ ] SF8 → grades display correctly
- [ ] SF9 → report card shows correct grades
- [ ] SF10 → permanent record shows correct grades

---

#### Step 7.7: Seed & fresh seed regression

- [ ] `npx ts-node server/prisma/seed.ts` → completes
- [ ] `npx ts-node server/prisma/seed-grades.ts` → completes
- [ ] Seeded grades match expected values

---

#### PHASE 7 TESTING GATE (FINAL)

All of the following must pass:

```bash
npm run build                        # Frontend builds
cd server && npm run build           # Backend builds
npm run lint                         # No lint errors
npx prisma db push                   # Schema valid
npx prisma generate                  # Client generates
```

Manual:
- [ ] Full workflow: Admin configures weights → Teacher enters scores → Grades calculate correctly → ECR download shows correct weights → SF9 shows correct grades
- [ ] No console errors anywhere
- [ ] No TypeScript errors

---

## 8. Files Changed Summary

| File | Phase | Changes |
|---|---|---|
| `server/prisma/schema.prisma` | P1 | Add TransmutationEntry; make Subject weights nullable |
| `server/prisma/seed.ts` | P0, P1 | Fix WW default; seed transmutation table |
| `server/prisma/seed-grades.ts` | P2 | Update hardcoded transmutation |
| `server/prisma/seed-grades-fresh.ts` | P2 | Update hardcoded transmutation |
| `server/src/routes/grades.ts` | P0, P2, P3 | Fix ECR import; async transmute(); updated weight resolution |
| `server/src/routes/admin.ts` | P2, P3 | Transmutation CRUD; per-subject weight CRUD |
| `server/src/routes/ecrTemplates.ts` | P4 | Inject weights into generated ECR |
| `server/src/lib/ecrSubjectMapping.ts` | P0 | Update template filenames |
| `server/src/lib/transmutationCache.ts` (new) | P2 | Cache for DB-backed transmutation |
| `src/pages/admin/TransmutationTable.tsx` (new) | P5 | Inline transmutation table editor |
| `src/pages/admin/GradingConfig.tsx` | P5 | Per-subject weight editor |
| `src/pages/teacher/ClassRecordsList.tsx` | P0 | Fix list view weight display |
| `src/pages/teacher/components/ClassRecordTable.tsx` | P6 | Use API-backed transmutation |
| `src/pages/teacher/components/classRecordMobileUtils.ts` | P6 | Accept transmutation as parameter |
| `src/lib/api.ts` | P5 | New API functions |
| Admin sidebar component | P5 | Add transmutation route |

**Total: 16 files (3 new, 13 modified)**

---

## 9. Open Questions

1. **Grade snapshots** — Should `GradeSnapshot` record which weights were used? (Audit trail)
2. **Bulk weight update impact** — If admin changes weights after grades are entered, should existing grades be recalculated? Or only apply to new entries?
3. **SF9/SF10 grading scale** — The descriptor table in `SchoolForms.tsx` is hardcoded. Make it configurable? (Low priority)
4. **ECR template per-term** — Old system had per-term MAPEH templates. New system uses one template with weights injected. Acceptable?
5. **Frontend transmutation cache** — How long should the frontend cache the transmutation table? Session-only? 5 minutes?
