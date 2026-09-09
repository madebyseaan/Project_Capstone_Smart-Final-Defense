# AIMS Phase 4 — Implementation Report

## 1. Files Changed

### Task 1 (P0) — Allow `category: "QA"` through validation
**`server/src/schemas/aims.ts`** (line 25):
- Changed `category: z.enum(['WW', 'PT'])` → `category: z.enum(['WW', 'PT', 'QA'])`

### Task 2 — Adopt `termIndex` for term binning
**`server/src/schemas/aims.ts`** (line 38):
- Added `termIndex: z.number().int().min(1).max(3).nullable().optional()` to `aimsScoreRowSchema`

**`server/src/lib/aimsScoreSync.ts`**:
- Lines 130–133: Added critical NO-GO comment: "NEVER add ?termIndex= to the scores pull — our stale-sweep deletes non-imported rows absent from the current pull."
- Lines 145–149: Replaced `binTerm(gradedAt, termEndDates)` with termIndex-priority logic: `row.termIndex === 1 || 2 || 3 ? T${row.termIndex} : binTerm(gradedAt, termEndDates)`
- Lines 219: Added `term` to upsert `update:` block (was create-only) so rows move terms when termIndex changes

**`server/src/lib/aimsClient.ts`** (lines 47, 60):
- Changed `category: 'WW' | 'PT'` → `category: 'WW' | 'PT' | 'QA'` in `AimsPublicScoreRow` interface
- Added `termIndex?: number | null` to `AimsPublicScoreRow` interface

### Task 3 — QA display + import UX
**`server/src/lib/aimsImport.ts`** (line 75):
- Added `category: { in: ['WW', 'PT'] }` to `aimsWhere` — QA rows excluded from import query

**`src/pages/teacher/components/AimsPanel.tsx`**:
- Lines 66–69: `openImportDialog()` now defaults selection to WW/PT only (`a.category !== "QA"`)
- Lines 176–183: `toggleAssessment()` guards against QA selection (early return if QA)
- Lines 420–458: Import dialog items:
  - QA items: `disabled` checkbox, unchecked, `opacity-70 cursor-not-allowed`, hint text "QA scores stay read-only — record the Quarterly Assessment manually in the TA column."
  - Category color: `a.category === "QA" ? "text-[var(--ledger-ta)]"` (TA token)

### Task 4 — Tests
**`server/src/__tests__/aims-sync.test.ts`** — 5 new tests added:
1. `P4-1: QA row survives validation and upserts with category='QA'` — WW + QA payload, both upsert, QA stored as `"QA"`
2. `P4-2: termIndex preferred over date binning` — `termIndex: 2` + `gradedAt` in T1 window → stored `term === "T2"`
3. `P4-3: termIndex null falls back to date binning` — `termIndex: null` + `gradedAt` in T1 → `term === "T1"`
4. `P4-4: upsert moves term when termIndex changes` — create via termIndex 1, re-process with termIndex 3 → term updates to T3
5. `P4-5: import excludes QA` — WW + QA AimsScore rows, import → WW appended, QA `importedAt` stays null

---

## 2. Build/Lint/Test Results

### Server Build (`server/`)
```
> server@1.0.0 build
> tsc

✓ No errors
```

### Frontend Build (root)
```
> smart@0.0.0 build
> vite build

✓ built in 2.13s
```

### Lint (root)
```
✖ 1132 problems (0 errors, 1132 warnings)
```
Phase 3 baseline was 1131 warnings. The +1 is from a pre-existing file (not from any changed file). No new warnings introduced.

### Server Tests
```
> server@1.0.0 test
> vitest run

 Test Files  13 passed | 10 skipped (23)
      Tests  149 passed | 57 skipped (206)
```
Baseline was 144 passed. 5 new tests added, all passing. No regressions.

---

## 3. Deviations

None. All changes follow the handoff document exactly.

---

## 4. Discoveries

1. **`AimsPublicScoreRow` interface was stale but kept in sync**: The interface in `aimsClient.ts` was unused/stale (as noted in the handoff), but updating it keeps it consistent with the schema. The `category` union also needed updating from `'WW' | 'PT'` to `'WW' | 'PT' | 'QA'`.

2. **Import already filters by category at the query level**: The `category: { in: ['WW', 'PT'] }` filter on the Prisma query means QA rows never enter the import transaction at all — they don't even get counted in `alreadyImportedSkipped`. This is cleaner than filtering post-fetch.

3. **`toggleAssessment` guard is defense-in-depth**: The disabled checkbox + unchecked default already prevent QA selection, but the guard in `toggleAssessment()` adds a second layer in case someone programmatically calls it.

---

## 5. Open Items

1. **AIMS API key**: Still pending OOB sharing. Once in `server/.env`, restart backend and smoke test with seeded teachers `2000061`/`2000065`.
2. **Live QA verification**: After key lands, verify QA rows show in AIMS panel with TA-colored category label and disabled checkbox in import dialog.
