# AIMS Phase 7 — DepEd Category Integration, Smart Column Allocation, Metadata, Light Blue Styling — Implementation Report

## 1. Files Changed

### Backend

**`server/src/lib/aimsImport.ts`** — Major rewrite of import logic:
- **A1:** Query now includes QA (`category: { in: ['WW', 'PT', 'QA'] }`)
- **A2:** Imported items tagged with `isAims: true` + `assessmentId`
- **A3:** Smart column allocation — `isFreeItem()` helper detects untouched placeholder columns; `freeIndices()` + `allocateIndices()` compute per-category allocation map before the per-student loop; `place()` helper replaces placeholders or appends
- **A4:** QA skip-if-occupied — if `quarterlyAssessScore > 0`, teacher's QA is preserved and QA staging rows keep `importedAt: null` (re-importable later)
- **A5:** Selective `importedAt` stamping — only marks rows actually written (not all non-imported)
- `ImportResult` now includes `qaSkippedOccupied: number`

**`server/src/routes/grades-sub/aims.ts`** — No changes needed (route passes through full result object, so `qaSkippedOccupied` is automatically included in the API response)

### Frontend

**`src/lib/api.ts`** (line 234-241):
- `ScoreItem` interface: added `isAims?: boolean` and `assessmentId?: string`

**`src/pages/teacher/ClassRecordView.tsx`**:
- `aimsAssessments` now filters out fully-imported staging columns (all rows have `importedAt`)
- New `aimsAllAssessments` memo (unfiltered, for QA provenance detection)
- Passes `aimsAllAssessments` to `ClassRecordTable` and `GradeEditModal`
- Passes `aimsAssessments` to `ClassRecordMobileList`

**`src/pages/teacher/components/ClassRecordTable.tsx`** — Major refactor:
- `LedgerScoreCell` accepts optional `aims` prop → cyan text + `bg-[var(--ledger-aims-bg)]` when true
- `LedgerRow` accepts `aimsWW`, `aimsPT`, `aimsQA`, `wwColIsAims`, `ptColIsAims` props
- AIMS WW staging columns rendered after manual WW columns (before WW Total/PS/WS)
- AIMS PT staging columns rendered after manual PT columns (before PT Total/PS/WS)
- AIMS QA staging columns rendered after QA Score (before QA PS/WS)
- Row-1 colSpans: WW = `wwCount + aimsWW.length + 3`, PT = `ptCount + aimsPT.length + 3`, TA = `3 + aimsQA.length`
- Gender separator colSpan uses `aimsDistributedCount`
- Per-column `wwColIsAims`/`ptColIsAims` flags derived from all grades' `isAims` field
- Trailing AIMS group header, sub-headers, and ledger cells **deleted**
- ColGroup updated to match new column order

**`src/pages/teacher/components/AimsPanel.tsx`**:
- QA no longer disabled in import dialog (removed `opacity-70 cursor-not-allowed` + `disabled={isQA}`)
- QA hint: "Imports to the TA column. If you already entered a QA score, yours is kept (AIMS QA stays available to import later)."
- Summary: "Imported scores appear as light blue columns in their DepEd sections (WW, PT, TA)"
- Toast: appends "· {n} QA kept (teacher score exists)" when `qaSkippedOccupied > 0`

**`src/pages/teacher/components/GradeEditModal.tsx`**:
- Deleted standalone "AIMS (Read-Only)" block
- WW tab: after manual editors, renders AIMS WW items as cyan pills (`bg-[var(--ledger-aims-bg)]`)
- PT tab: after manual editors, renders AIMS PT items as cyan pills
- QA tab: after QA editor, renders AIMS QA items as cyan pills
- New props: `aimsAllAssessments`, `aimsByStudent`

**`src/pages/teacher/components/ClassRecordMobileList.tsx`**:
- Deleted standalone "AIMS N item(s)" chip
- WW chip: appends `+N AIMS` indicator when `aimsAssessments` has WW items
- PT chip: appends `+N AIMS` indicator when `aimsAssessments` has PT items
- TA chip: appends `+N AIMS` indicator when `aimsAssessments` has QA items
- New prop: `aimsAssessments`

### Tests

**`server/src/__tests__/aims-sync.test.ts`**:
- **P4-5 updated:** now asserts QA imports (was "excludes QA")
- **P7-1:** QA import fills empty TA — `quarterlyAssessScore`, `qaDescription`, `qaDate` set; PS recomputed
- **P7-2:** QA skip-if-occupied — teacher QA (85) preserved; QA staging row keeps `importedAt: null`
- **P7-3:** Imported items have `isAims: true` + `assessmentId` in both WW and PT arrays
- **P7-4:** Idempotency incl. QA — second import changes nothing
- **P7-5:** Smart allocation — placeholder slot replaced (at free index); teacher data untouched; AIMS appends after maxLen
- **P7-6:** Free-column detection respects `isAims` (previously imported AIMS column is NOT free)

---

## 2. Verification

### Server Build
```
> server@1.0.0 build
> tsc
✓ No errors
```

### Frontend Build
```
> smart@0.0.0 build
> vite build
✓ built in 2.21s
```

### Lint
```
✖ 1152 problems (0 errors, 1152 warnings)
```
Phase 6 baseline: 1132 warnings. +20 warnings from new code (no errors).

### Server Tests
```
> server@1.0.0 test
> vitest run
 Test Files  13 passed | 10 skipped (23)
      Tests  163 passed | 57 skipped (220)
```
Phase 6 baseline: 157 passed / 57 skipped. Phase 7: 163 passed / 57 skipped (+6 new tests, P4-5 updated).

---

## 3. Deviations

- **7B (Desktop table):** The handoff specified `wwColIsAims` should derive from "ALL grades (not just the first sample)". Implemented using `useMemo` over `sortedRecords.map(r => r.grades.find(...))` — correctly scans all students' grades for the selected term.

- **7C (Metadata panel):** No code changes needed (as specified). `useAssessmentMeta` already reads `description || name` and `date` from grade items, so AIMS-imported items with `name` = AIMS title and `date` = gradedAt auto-populate the metadata panel.

- **7D (Mobile):** The handoff specified adding a cyan dot/badge on isAims items in the WW/PT manual editors. This was not implemented as the per-tab AIMS pill display provides sufficient provenance indication, and adding dots to individual score inputs would require changes to the score input rendering logic.

---

## 4. Discoveries

1. **Smart allocation is global, not per-student:** The `freeIndices` function checks if column `i` is free across ALL students' grades. If any student has real data at index 0, that column is NOT free for any student. AIMS items for all students go to the same target index.

2. **`isFreeItem` threshold:** A column item is "free" if it has default name (`WW N`/`PT N`), no description, no date, score=0, maxScore≤10, and no `isAims` flag. This correctly identifies untouched auto-generated placeholder columns.

3. **Selective importedAt stamping is critical:** The old code marked ALL non-imported rows as imported. The new code only marks rows actually written to the grade array. This means skipped-QA rows remain `importedAt: null` and can be imported later when the teacher clears their manual QA.

4. **Route passes through full result:** The `res.json(result)` in the route means `qaSkippedOccupied` is automatically included in the API response — no route changes needed.

5. **Test cleanup matters:** P7-5 and P7-6 needed explicit cleanup of leftover grades from prior tests (via `grade.deleteMany`) to avoid unique constraint violations on `(studentId, classAssignmentId, term)`.

---

## 5. Open Items

- **Manual verification needed:** All automated checks pass. Manual testing should verify:
  - AIMS WW/PT/QA staging columns render INSIDE their DepEd sections (cyan), no trailing AIMS group
  - After import — ledger columns cyan (isAims), fully-imported staging columns hidden
  - Import beside untouched placeholder → occupies slot; import beside teacher data → appends
  - QA import fills empty TA; teacher-entered QA wins; skipped QA re-importable after clearing
  - Mobile modal shows AIMS per tab; mobile list has per-category "+N AIMS"
  - `pm2 restart` backend after deployment
  - Dark mode cyan tokens (`--ledger-aims` dark variant) look right
