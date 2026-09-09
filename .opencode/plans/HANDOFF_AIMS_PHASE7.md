# HANDOFF_AIMS_PHASE7 — DepEd Integration, Metadata, Smart Allocation, Light Blue Styling

## Goal
Merge AIMS scores into their DepEd category sections (WW, PT, TA) instead of isolating them in a trailing "AIMS (READ-ONLY)" group. Add AIMS metadata to the assessment details panel. Enable QA import with skip-if-occupied logic. Tag imported scores with `isAims: true` for light blue (cyan) styling.

## Architecture Summary

**Before (Phase 1-6):** AIMS columns are a separate group at the far right of the table, after GRADE SUMMARY. Metadata panel has no AIMS awareness. QA is never imported.

**After (Phase 7):** AIMS columns are distributed into their DepEd category sections (WW/PT/TA) with light blue styling to distinguish them from manual entries. Metadata panel shows AIMS titles and dates. QA can be imported but skips if teacher already entered a score.

---

## Sub-Phase 7A: Backend - `isAims` Tag + QA Import

### File: `server/src/lib/aimsImport.ts`

**Change 1: Include QA in the query (line 75)**
```
BEFORE: category: { in: ['WW', 'PT'] }
AFTER:  category: { in: ['WW', 'PT', 'QA'] }
```

**Change 2: Split scores into WW/PT/QA groups (around lines 150-154)**
Currently splits into `wwScores` and `ptScores`. Add `qaScores`:
```ts
const wwScores = studentScores.filter(s => s.category === 'WW' && !s.importedAt);
const ptScores = studentScores.filter(s => s.category === 'PT' && !s.importedAt);
const qaScores = studentScores.filter(s => s.category === 'QA' && !s.importedAt);
```
Update the `nonImported` filter to be derived from the union of these three arrays (or keep the existing filter and add `qaScores` separately).

**Change 3: Tag all imported scores with `isAims: true` (lines 157-162, 163-168)**

For WW mapped scores:
```ts
const mappedWW = wwScores.map(s => ({
  name: s.assessmentTitle,
  score: s.pointsEarned,
  maxScore: s.maxPoints,
  date: s.gradedAt?.toISOString().slice(0, 10) ?? null,
  isAims: true,                   // NEW
  assessmentId: s.assessmentId,   // NEW - for dedup/stale tracking
}));
```

Same pattern for PT mapped scores.

**Change 4: QA import with skip-if-occupied (new block after PT merge)**

```ts
// QA import - skip if teacher already has a non-zero QA score
let finalQAScore = existingGrade?.quarterlyAssessScore ?? 0;
let finalQAMax = existingGrade?.quarterlyAssessMax ?? 100;
let finalQADescription = existingGrade?.qaDescription ?? null;
let finalQADate = existingGrade?.qaDate ?? null;
let qaImported = false;

if (qaScores.length > 0) {
  const existingQANonZero = existingGrade?.quarterlyAssessScore != null && existingGrade.quarterlyAssessScore > 0;
  if (!existingQANonZero) {
    // Use the latest QA score (by gradedAt)
    const latestQA = qaScores.reduce((latest, s) => {
      if (!latest) return s;
      return (s.gradedAt ?? '') > (latest.gradedAt ?? '') ? s : latest;
    }, qaScores[0] as typeof qaScores[0] | undefined);
    if (latestQA) {
      finalQAScore = latestQA.pointsEarned;
      finalQAMax = latestQA.maxPoints;
      finalQADescription = latestQA.assessmentTitle;
      finalQADate = latestQA.gradedAt?.toISOString().slice(0, 10) ?? null;
      qaImported = true;
    }
  }
}
```

**Change 5: Update the payload to use final QA values (lines 178-191)**
```
BEFORE: quarterlyAssessScore: existingGrade?.quarterlyAssessScore ?? 0,
AFTER:  quarterlyAssessScore: finalQAScore,
```
Same for `quarterlyAssessMax`, `qaDescription`, `qaDate`.

**Change 6: Update `nonImported` to include QA rows for marking**
Ensure `nonImported` includes the QA rows so their `importedAt` gets set:
```ts
const nonImported = studentScores.filter(s => s.importedAt == null);
// This already includes QA rows since we changed the category filter
```

**Change 7: Update audit log message**
Include QA count: `Imported ${nonImported.length} AIMS score(s)${qaImported ? ' (incl. QA)' : ''}`

**Change 8: Update result to include QA in `importedAssessments`**
Add QA assessment IDs to the returned list.

---

### File: `src/lib/api.ts` - `ScoreItem` type extension (line 234)

```ts
export interface ScoreItem {
  name: string;
  score: number;
  maxScore: number;
  description?: string;
  date?: string;
  isAims?: boolean;       // NEW - true for AIMS-imported scores
  assessmentId?: string;  // NEW - AIMS assessment ID for provenance
}
```

---

## Sub-Phase 7B: Desktop Table - Distribute AIMS into DepEd Sections

### File: `src/pages/teacher/components/ClassRecordTable.tsx`

This is the most complex change. The AIMS columns currently render as a trailing block. They need to be distributed into the WW, PT, and TA sections.

**Step 1: Partition AIMS assessments by category (add near line 160)**

```ts
const aimsWW = aimsAssessments.filter(a => a.category === 'WW');
const aimsPT = aimsAssessments.filter(a => a.category === 'PT');
const aimsQA = aimsAssessments.filter(a => a.category === 'QA');
```

**Step 2: Update colSpan calculations**

| Category | Before | After |
|----------|--------|-------|
| WW | `wwCount + 3` | `wwCount + aimsWW.length + 3` |
| PT | `ptCount + 3` | `ptCount + aimsPT.length + 3` |
| TA | `3` | `3 + aimsQA.length` |
| Grade Summary | `2` | `2` (unchanged) |
| AIMS header | `aimsAssessments.length` | **REMOVE entirely** |

Gender separator colSpan: `wwCount + ptCount + aimsWW.length + aimsPT.length + aimsQA.length + 14`

**Step 3: Update `renderColGroup()` (lines 642-668)**

Insert AIMS `<col>` elements inside each category group:
```tsx
{/* WW cols */}
{Array.from({ length: wwCount }).map(...)}
{aimsWW.map((_, i) => (
  <col key={`col-aims-ww-${i}`} style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
))}
<col ... /> {/* WW Total */}
<col ... /> {/* WW PS */}
<col ... /> {/* WW WS */}

{/* PT cols */}
{Array.from({ length: ptCount }).map(...)}
{aimsPT.map((_, i) => (
  <col key={`col-aims-pt-${i}`} style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
))}
<col ... /> {/* PT Total */}
<col ... /> {/* PT PS */}
<col ... /> {/* PT WS */}

{/* TA cols */}
<col ... /> {/* TA Score */}
{aimsQA.map((_, i) => (
  <col key={`col-aims-qa-${i}`} style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />
))}
<col ... /> {/* TA PS */}
<col ... /> {/* TA WS */}
```

**Step 4: Update Row 1 category headers (lines 819-887)**

- WW header: `colSpan={wwCount + aimsWW.length + 3}` - keep same styling
- PT header: `colSpan={ptCount + aimsPT.length + 3}` - keep same styling
- TA header: `colSpan={3 + aimsQA.length}` - keep same styling
- **REMOVE** the AIMS header entirely (lines 879-887)

**Step 5: Update Row 2 sub-headers (lines 891-927)**

After WW numbered columns, insert AIMS WW sub-headers:
```tsx
{aimsWW.map((a) => (
  <TableHead key={`h-aims-ww-${a.assessmentId}`}
    className="w-16 min-w-[64px] max-w-[64px] px-1 text-center text-[11px] font-bold text-[var(--ledger-aims)] uppercase border-r border-b border-slate-200 bg-[var(--ledger-aims-bg)] bg-clip-padding">
    <span className="truncate block max-w-[56px]" title={a.title}>
      {a.title.length > 8 ? a.title.slice(0, 8) + "\u2026" : a.title}
    </span>
    <span className="text-[9px] font-normal opacity-60">AIMS</span>
  </TableHead>
))}
```

Same pattern for PT (after PT numbered columns) and QA (after TA Score column, before TA PS).

**Step 6: Update LedgerRow data cells (lines 251-439)**

After WW score cells (line 274), insert AIMS WW cells:
```tsx
{aimsWW.map((a) => {
  const score = !isHps ? aimsByStudent[studentId]?.[a.assessmentId] : undefined;
  return (
    <TableCell key={`aims-ww-${a.assessmentId}`}
      className={`text-center text-[11px] font-bold border-r border-b border-slate-200 p-0 h-9 w-16 min-w-[64px] max-w-[64px] ${
        isHps ? "bg-slate-800 border-y border-slate-700 bg-clip-padding text-slate-500"
          : `text-[var(--ledger-aims)] ${score?.importedAt ? "bg-[var(--ledger-aims-bg)]" : ""}`
      }`}
      style={rowStyle}
      title={!isHps && score ? `${score.pointsEarned}/${score.maxPoints} \u00b7 ${a.title} \u00b7 WW \u00b7 attempt ${score.attemptNumber} \u00b7 graded ${score.gradedAt?.slice(0,10) ?? "?"}` : undefined}
    >
      {isHps ? "\u2014" : score?.pointsEarned ?? <span className="text-slate-300">-</span>}
    </TableCell>
  );
})}
```

Same pattern for AIMS PT cells (after PT score cells, before PT Total) and AIMS QA cells (after the existing QA Score cell, before QA PS).

**Step 7: Remove the trailing AIMS block (lines 418-439)**

Delete the entire `{/* AIMS read-only cells */}` block - it has been redistributed above.

**Step 8: Remove the AIMS header from Row 1 (lines 879-887)**

Delete the `{aimsAssessments.length > 0 && (...)}` block that renders the "AIMS (read-only)" header.

**Step 9: Remove AIMS sub-headers from Row 2 (lines 917-926)**

Delete the `{aimsAssessments.map(...)}` block - redistributed into category sections.

**Step 10: Remove AIMS `<col>` elements from the end of colgroup (lines 917-926)**

Delete `{aimsAssessments.map((_, i) => (...))}` from the end of `renderColGroup()` - redistributed into category sections.

**Step 11: Update HPS row for AIMS cells**

The HPS row currently shows `"\u2014"` for AIMS cells. Keep this behavior - AIMS cells in HPS mode should show `"\u2014"` (or `"-"`) since HPS is teacher-managed.

---

## Sub-Phase 7C: Metadata Panel - AIMS-Aware Assessment Details

### File: `src/pages/teacher/hooks/useAssessmentMeta.ts`

**No code changes required.** Here is why:

AIMS scores are imported with `isAims: true`, `name: assessmentTitle`, and `date: gradedAt` (from Phase 7A). The existing metadata initialization at lines 72-78 reads:
```ts
description: wwSource[i]?.description || wwSource[i]?.name || prev[i]?.description || `WW ${i + 1}`,
date: wwSource[i]?.date || prev[i]?.date || "",
```

Since AIMS scores carry `name` (the assessment title) and `date` (the graded date), the "Optional Assessment Details" panel will automatically display AIMS titles and dates without any hook changes.

### File: `src/pages/teacher/components/AssessmentHeader.tsx`

**No changes required.** The metadata panel reads from `wwMeta`/`ptMeta`/`qaMeta` state, which is hydrated from Grade score arrays. AIMS-populated fields will show the AIMS title and date naturally.

**Optional follow-up:** Add a small cyan badge next to AIMS-populated fields in the assessment details panel to indicate they came from AIMS. This is cosmetic and can be done in a later phase.

---

## Sub-Phase 7D: Mobile Views - Distribute AIMS into DepEd Tabs

### File: `src/pages/teacher/components/GradeEditModal.tsx`

**Change 1: Accept `aimsAssessments` prop (line 33-36)**
```ts
aimsScores?: Record<string, AimsRowScore>;
aimsAssessmentTitles?: Record<string, string>;
aimsAssessments?: AimsAssessmentInfo[];  // NEW - for category grouping
```

**Change 2: Group AIMS scores by category (add before the render)**
```ts
const aimsWW = aimsAssessments?.filter(a => a.category === 'WW') ?? [];
const aimsPT = aimsAssessments?.filter(a => a.category === 'PT') ?? [];
const aimsQA = aimsAssessments?.filter(a => a.category === 'QA') ?? [];
```

**Change 3: Remove the standalone AIMS block (lines 78-93)**

Delete the `{aimsScores && Object.keys(aimsScores).length > 0 && (...)}` block.

**Change 4: Add AIMS scores inside each tab**

In the WW tab (after the existing WW score editors, around line 157):
```tsx
{aimsWW.map((a) => {
  const score = aimsScores?.[a.assessmentId];
  if (!score) return null;
  return (
    <div key={a.assessmentId} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-[var(--ledger-aims-bg)]">
      <span className="text-xs font-medium text-[var(--ledger-aims)]">{a.title}</span>
      <span className="text-sm font-bold text-[var(--ledger-aims)]">{score.pointsEarned}/{score.maxPoints}</span>
    </div>
  );
})}
```

Same pattern for PT tab and QA tab.

### File: `src/pages/teacher/components/ClassRecordMobileList.tsx`

**Change 1: Accept `aimsAssessments` prop (line 13-22)**
```ts
aimsByStudent?: Record<string, Record<string, { pointsEarned: number; maxPoints: number; score: number }>>;
aimsAssessments?: AimsAssessmentInfo[];  // NEW
```

**Change 2: Group AIMS scores by category and add to WW/PT/TA chips**

Replace the standalone "AIMS N item(s)" chip with per-category indicators:

```tsx
{/* WW chip - existing */}
<span className="text-[var(--ledger-ww)]">{wwTotal}/{wwMax}</span>
{aimsWWItems.length > 0 && (
  <span className="text-[9px] text-[var(--ledger-aims)] ml-0.5">+{aimsWWItems.length} AIMS</span>
)}
```

Same for PT and TA chips.

**Change 3: Remove the standalone "AIMS N item(s)" chip (lines 114-129)**

Delete the entire AIMS chip block - AIMS is now distributed into the category chips.

### File: `src/pages/teacher/ClassRecordView.tsx`

**Change: Pass `aimsAssessments` to mobile components (line 332)**

```tsx
<ClassRecordMobileList
  ...
  aimsByStudent={aimsByStudent}
  aimsAssessments={aimsAssessments}  // NEW
/>
```

And to GradeEditModal (line 336):
```tsx
<GradeEditModal
  ...
  aimsScores={...}
  aimsAssessmentTitles={...}
  aimsAssessments={aimsAssessments}  // NEW
/>
```

---

## Sub-Phase 7E: AimsPanel - Enable QA Import

### File: `src/pages/teacher/components/AimsPanel.tsx`

**Change 1: Remove QA disable logic (line 433)**
```
BEFORE: disabled={isQA}
AFTER:  disabled={false}
```

**Change 2: Remove QA opacity/cursor styles (line 429)**
```
BEFORE: className={`flex items-center gap-3 p-2.5 rounded-lg border border-border ${isQA ? "opacity-70 cursor-not-allowed" : "hover:bg-accent/50 cursor-pointer"}`}
AFTER:  className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-accent/50 cursor-pointer"
```

**Change 3: Update QA hint text (lines 446-449)**
```
BEFORE: "QA scores stay read-only \u2014 record the Quarterly Assessment manually in the TA column."
AFTER:  "QA imports to the TA column. If the teacher already entered a QA score, it will be preserved (not overwritten)."
```

**Change 4: Update summary text (line 409)**
```
BEFORE: "WW/PT scores shown as read-only cyan columns in the ledger"
AFTER:  "Imported scores appear as light blue columns in their DepEd category sections (WW, PT, TA)"
```

---

## Sub-Phase 7F: Tests

### File: `server/src/__tests__/aims-sync.test.ts`

**New test: "P7-1: import includes QA"**
- Create AimsScore rows for a student: WW, PT, QA
- Run import
- Verify: Grade has WW scores, PT scores, and `quarterlyAssessScore` = QA pointsEarned
- Verify: `qaDescription` = assessmentTitle, `qaDate` = gradedAt

**New test: "P7-2: QA import skips if teacher QA already exists"**
- Create Grade with `quarterlyAssessScore: 85`
- Create AimsScore QA row
- Run import
- Verify: `quarterlyAssessScore` still 85 (not overwritten)

**New test: "P7-3: imported scores have isAims tag"**
- Import WW and PT scores
- Verify: each mapped score in `writtenWorkScores` and `perfTaskScores` has `isAims: true` and `assessmentId`

**New test: "P7-4: idempotency with QA"**
- Import once (QA imported)
- Import again
- Verify: QA not duplicated, `quarterlyAssessScore` unchanged

**Update existing test: "P4-5" (import excludes QA)**
- Remove or update this test since QA is now included

---

## No-Go Reminders
- NEVER add `?termIndex=` to the AIMS scores pull endpoint
- NEVER write to AIMS - read-only integration
- No Prisma migrations - JSON columns are flexible
- No new DB tables - AimsScore staging + Grade JSON is sufficient
- Keep tests passing: `npm --prefix server run test` must pass

## Verification Checklist
- [ ] `npm --prefix server run build` - no type errors
- [ ] `npm run build` - no type errors
- [ ] `npm --prefix server run test` - all tests pass (including new P7 tests)
- [ ] `npm run lint` - no lint errors
- [ ] Manual: AIMS WW columns appear under WRITTEN WORKS section (light blue)
- [ ] Manual: AIMS PT columns appear under PERF. TASKS section (light blue)
- [ ] Manual: AIMS QA column appears under TA section (light blue)
- [ ] Manual: "AIMS (read-only)" trailing group is completely gone
- [ ] Manual: "Optional Assessment Details" shows AIMS titles and dates
- [ ] Manual: Import dialog allows QA selection (no longer disabled)
- [ ] Manual: QA import skips if teacher already has a non-zero QA score
- [ ] Manual: Mobile modal shows AIMS scores inside WW/PT/TA tabs
- [ ] Manual: Mobile list shows AIMS item counts per category (not a separate block)
- [ ] Manual: Grade computation works correctly with AIMS scores in the arrays
- [ ] Manual: HPS row still shows "\u2014" for AIMS cells

## Estimated Complexity
- **7A (Backend):** Medium - mostly additive logic in aimsImport.ts
- **7B (Table):** High - column redistribution touches colgroup, headers, data cells, colSpans
- **7C (Metadata):** Low - mostly works automatically from isAims-tagged scores
- **7D (Mobile):** Medium - restructure modal tabs and mobile list chips
- **7E (AimsPanel):** Low - remove QA disable, update text
- **7F (Tests):** Medium - 4 new tests, 1 updated
