# HANDOFF_AIMS_PHASE7 — DepEd Category Integration, Smart Column Allocation, Metadata, Light Blue Styling

## Goal
Replace the trailing "AIMS (READ-ONLY)" column group with AIMS columns distributed INTO their DepEd category sections (WW under WRITTEN WORKS, PT under PERF. TASKS, QA under TA), styled light blue (cyan tokens). Import QA (skip-if-occupied). Tag imported scores `isAims: true`. Smart column allocation: occupy untouched placeholder slots, never overwrite teacher data.

## No-Gos
- NEVER add `?termIndex=` to the AIMS scores pull (stale-sweep would delete other terms' rows)
- NEVER write to AIMS (read-only integration)
- No Prisma migrations, no new tables — `isAims`/`assessmentId` live in existing JSON columns
- Do not touch `.env`
- All builds/tests/lint must pass before reporting done

---

## 7A — Backend: `server/src/lib/aimsImport.ts`

### A1. Include QA in query (line 75)
```ts
const aimsWhere: any = { classAssignmentId, term, category: { in: ['WW', 'PT', 'QA'] } };
```
Update the JSDoc/comment that says "QA is read-only staging — never import".

### A2. Tag imported scores (WW/PT mapping, lines ~157-168)
```ts
name: s.assessmentTitle,
score: s.pointsEarned,
maxScore: s.maxPoints,
date: s.gradedAt?.toISOString().slice(0, 10) ?? null,
isAims: true,                  // NEW
assessmentId: s.assessmentId,  // NEW
```
Same for PT. This is what drives ledger cyan styling + metadata panel auto-population (7C).

### A3. Smart column allocation (NEW — replaces plain append)

**Before the per-student loop**, fetch all grades for the class/term and compute a global per-category allocation map:

```ts
const allGrades = await prisma.grade.findMany({
  where: { classAssignmentId, term },
  select: { studentId: true, writtenWorkScores: true, perfTaskScores: true },
});

const DEFAULT_NAME = /^((WW|PT)\s*\d+)$/i;
const isFreeItem = (it: any) =>
  !it || (
    (!it.name || DEFAULT_NAME.test(it.name.trim())) &&
    (!it.description || DEFAULT_NAME.test(it.description.trim())) &&
    !it.date &&
    (it.score ?? 0) === 0 &&
    (it.maxScore ?? 10) <= 10 &&
    !it.isAims
  );

// Column i is FREE only if EVERY student's item at i is an untouched placeholder (or missing).
const freeIndices = (key: 'writtenWorkScores' | 'perfTaskScores') => {
  const arrs = allGrades.map(g => (g[key] as any[]) ?? []);
  if (arrs.length === 0) return [] as number[];
  const maxLen = Math.max(...arrs.map(a => a.length));
  const free: number[] = [];
  for (let i = 0; i < maxLen; i++) if (arrs.every(a => isFreeItem(a[i]))) free.push(i);
  return free;
};

const maxLenOf = (key: 'writtenWorkScores' | 'perfTaskScores') =>
  Math.max(0, ...allGrades.map(g => ((g[key] as any[]) ?? []).length));
```

**Allocation:** collect this import's assessments per category (distinct `assessmentId` across all students' non-imported rows, sorted deterministically by `gradedAt` then `assessmentId`). Assign each to a target index:
- Take free indices in ascending order first (slot reuse)
- Overflow appends: `maxLenOf(key)`, `maxLenOf(key)+1`, ...

```ts
// allocation: assessmentId -> column index, per category
```

**Per-student placement** (inside the transaction loop, replacing the `[...existing, ...mapped]` append):

```ts
const place = (arr: any[], idx: number, item: any | null, cat: 'WW' | 'PT') => {
  const out = [...arr];
  // PS-neutral padding for gaps below idx (maxScore 0 adds nothing to totals)
  while (out.length < idx) out.push({ name: `${cat} ${out.length + 1}`, score: 0, maxScore: 0 });
  if (out.length === idx) out.push(item ?? { name: `${cat} ${idx + 1}`, score: 0, maxScore: 0 });
  else if (item) out[idx] = item; // student HAS an AIMS score -> replace placeholder
  // if no item and placeholder exists at idx -> leave untouched
  return out;
};
```

Rules:
- Student HAS an AIMS score for the assessment → place mapped item at allocated index (replacing placeholder if present).
- Student has NO score → pad gaps only if needed for students that have scores (see below); otherwise leave their array shorter — the UI already renders blanks for short arrays (current behavior for manual columns). **Do not pad score:0/maxScore:10** — that would penalize PS. Gap padding uses `maxScore: 0`.
- Defensive dedupe: if the student's array already contains an item with same `assessmentId` and `isAims`, skip that assessment for that student (count as already-imported skip).
- If an AIMS item lands on a free index that the student occupies with a placeholder → replace is safe (placeholder is all-0 default; totals unchanged for them, then improved by real score).

### A4. QA import — skip-if-occupied, and do NOT mark skipped rows

Per student (QA is a scalar, not an array):

```ts
const qaScores = studentScores.filter(s => s.category === 'QA' && s.importedAt == null);
let finalQAScore = existingGrade?.quarterlyAssessScore ?? 0;
let finalQAMax = existingGrade?.quarterlyAssessMax ?? 100;
let finalQADesc = existingGrade?.qaDescription ?? null;
let finalQADate = existingGrade?.qaDate ?? null;
let qaApplied = false;
let qaSkippedOccupied = false;

if (qaScores.length > 0) {
  const occupied = (existingGrade?.quarterlyAssessScore ?? 0) > 0;
  if (occupied) {
    qaSkippedOccupied = true; // preserve teacher's QA — do NOT mark staging rows imported
  } else {
    const latest = qaScores.reduce((l, s) => ((s.gradedAt ?? '') >= (l?.gradedAt ?? '') ? s : l), qaScores[0]);
    finalQAScore = latest.pointsEarned;
    finalQAMax = latest.maxPoints;
    finalQADesc = latest.assessmentTitle;
    finalQADate = latest.gradedAt?.toISOString().slice(0, 10) ?? null;
    qaApplied = true;
  }
}
```

**Critical:** the `importedAt` stamping (`tx.aimsScore.updateMany`, lines ~200-203) must mark ONLY rows actually written: placed WW/PT rows + applied QA rows. **Skipped-QA rows keep `importedAt: null`** so they can import later if the teacher clears their manual QA. Build an explicit `rowsToMark: string[]` (AimsScore ids) instead of marking all `nonImported`.

### A5. Payload + recalc
- Payload uses `finalQAScore/finalQAMax/finalQADescription/finalQADate` instead of passthrough of existing values.
- `calculateGrades(mergedWW, mergedPT, finalQAScore, finalQAMax, ...)` — everything else unchanged. PS/WS/initial/transmuted grade compute automatically.
- Audit message: `Imported N AIMS score(s)${qaApplied ? ' (incl. QA)' : ''}`.
- Result object: add `qaSkippedOccupied` count; include QA assessmentIds in `importedAssessments` (only when applied for ≥1 student).

---

## 7A-FE — Type: `src/lib/api.ts` (line 234)
```ts
export interface ScoreItem {
  name: string;
  score: number;
  maxScore: number;
  description?: string;
  date?: string;
  isAims?: boolean;       // NEW
  assessmentId?: string;  // NEW
}
```
Verify no backend zod schema validates Grade JSON score items strictly (they are passthrough `Json` — confirm; if any schema strict-validates, extend it the same way).

---

## 7B — Desktop table: `src/pages/teacher/components/ClassRecordTable.tsx`

### B1. Partition + hide fully-imported staging columns
```ts
const aimsWW = aimsAssessments.filter(a => a.category === 'WW');
const aimsPT = aimsAssessments.filter(a => a.category === 'PT');
const aimsQA = aimsAssessments.filter(a => a.category === 'QA');
```
`aimsAssessments` prop will ALREADY be filtered by ClassRecordView (see B5) — do not re-filter here.

### B2. Ledger column AIMS flags (cyan styling of imported columns)
Derive per-column flags from ALL grades (not just the first sample — students without a score keep a placeholder at that index):
```ts
// inside component, from sortedRecords + selectedTerm
const gradeList = sortedRecords.map(r => r.grades.find(g => g.term === selectedTerm)).filter(Boolean);
const wwColIsAims = Array.from({ length: wwCount }, (_, i) => gradeList.some(g => (g?.writtenWorkScores as any[])?.[i]?.isAims));
const ptColIsAims = Array.from({ length: ptCount }, (_, i) => gradeList.some(g => (g?.perfTaskScores as any[])?.[i]?.isAims));
```

### B3. Distribute staging columns into DepEd sections
Apply to ALL FOUR sync points — colgroup (`renderColGroup`, ~642-668), Row-1 group headers (~819-887), Row-2 sub-headers (~891-927), LedgerRow cells (~251-439):

| Where | Change |
|---|---|
| WW `<col>`s + sub-headers + cells | after the `wwCount` manual columns, BEFORE WW Total/PS/WS: render `aimsWW` columns (64px, cyan) |
| PT | after `ptCount` manual columns, BEFORE PT Total/PS/WS: render `aimsPT` columns |
| TA | after QA Score cell, BEFORE QA PS: render `aimsQA` columns |
| Row-1 colSpans | WW: `wwCount + aimsWW.length + 3` · PT: `ptCount + aimsPT.length + 3` · TA: `3 + aimsQA.length` |
| Gender separator colSpan (~600, ~617) | `wwCount + ptCount + aimsWW.length + aimsPT.length + aimsQA.length + 14` |
| Trailing AIMS block | **DELETE** Row-1 AIMS header (~879-887), Row-2 AIMS sub-headers (~917-926), trailing `<col>`s, LedgerRow AIMS cells (~418-439) |

Staging column cell/sub-header rendering: reuse the current AIMS cell markup (cyan text, `importedAt` bg tint, tooltip) — just relocated. Sub-header shows truncated title + `AIMS` label (keep existing markup).

### B4. Cyan styling for imported LEDGER columns (isAims)
- `LedgerScoreCell`: add optional prop `aims?: boolean`. When true and not HPS: value class `text-[var(--ledger-aims)] font-bold` (instead of `text-slate-600`) + subtle `bg-[var(--ledger-aims-bg)]`. Keep editable — cyan marks provenance only.
- HPS row for AIMS ledger columns: pass `hpsColorClass="text-[var(--ledger-aims)] font-bold"` (instead of category color).
- Row-2 numbered header for AIMS ledger column `i`: cyan tint (`text-[var(--ledger-aims)] bg-[var(--ledger-aims-bg)]`) + `title={sampleItemName}` tooltip (the AIMS assessment title from any student's item at that index).
- QA ledger cell (scalar): cyan when `aimsAllAssessments` (see B5) contains a QA assessment whose row for this student has `importedAt` — `aimsByStudent[studentId]?.[qaAim.assessmentId]?.importedAt != null`. Apply to the QA `LedgerScoreCell` (aims prop) and its HPS color.
- Colgroup: no width change needed (AIMS ledger columns are normal 56px manual-width columns).

### B5. Hide fully-imported staging columns — `src/pages/teacher/ClassRecordView.tsx`
In the `aimsAssessments` useMemo (~204-207): hide an assessment iff every staged row for it has `importedAt` (zero staged rows → also hidden, cannot occur in practice since assessments derive from staged rows):
```ts
const visible = (aimsData?.assessments ?? []).filter(a => {
  const rows = (aimsData?.rows ?? []).flatMap(r => r.scores.filter(s => s.assessmentId === a.assessmentId));
  return rows.length === 0 || rows.some(s => !s.importedAt);
});
```
- `aimsAssessments` (visible) → passed to `ClassRecordTable`, `ClassRecordMobileList`, `GradeEditModal` (staging display).
- NEW prop `aimsAllAssessments` (unfiltered) → passed to `ClassRecordTable` and `GradeEditModal` for QA-provenance detection only (B4).
- Rationale: fully-imported staging column would duplicate the cyan ledger column that now holds the same value.

### B6. Table invariants
- Colgroup order must match header + cell order exactly (rendered twice — sticky header + body).
- HPS row staging cells keep `"—"`; HPS ledger AIMS columns show real maxScore in cyan.
- `wwCount`/`ptCount` already derive from max array length — they grow automatically after import. Verify `hpsData` (ClassRecordView ~127-139) picks up AIMS item maxScores per column (it scans grades; should need no change — verify manually).

---

## 7C — Metadata panel: NO code changes
Imported items carry `name` = AIMS title and `date` = gradedAt. `useAssessmentMeta` init (lines 72-78) already reads `description || name` and `date`, so "Optional Assessment Details" auto-populates. `applyMetaToScores` spreads `...existing` so `isAims`/`assessmentId` survive meta saves. Verify manually; do not refactor.

---

## 7D — Mobile

### `GradeEditModal.tsx`
- New props: `aimsAssessments?: AimsAssessmentInfo[]` (visible), `aimsAllAssessments?: AimsAssessmentInfo[]` (provenance).
- DELETE the standalone "AIMS (Read-Only)" block (~78-93).
- Inside each tab (WW/PT/QA), after the manual editors, render that category's visible staging assessments:
```tsx
<div className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-[var(--ledger-aims-bg)]">
  <span className="text-xs font-medium text-[var(--ledger-aims)] truncate">{a.title}</span>
  <span className="text-sm font-bold text-[var(--ledger-aims)]">{score.pointsEarned}/{score.maxPoints}</span>
</div>
```
- QA tab: if the student's QA was AIMS-imported (via `aimsAllAssessments` + `aimsScores[qaId]?.importedAt`), tint the QA score input row cyan (badge "AIMS" ok) — value stays editable.
- WW/PT manual editors for isAims columns: add a tiny cyan dot/badge on items where the grade array item has `isAims` (provenance hint).

### `ClassRecordMobileList.tsx`
- New prop `aimsAssessments?: AimsAssessmentInfo[]`.
- DELETE the standalone "AIMS N item(s)" chip (~114-129).
- Per category chip, append count indicator when that category has visible staging items:
```tsx
{aimsWWItems.length > 0 && <span className="text-[9px] text-[var(--ledger-aims)] ml-0.5">+{aimsWWItems.length} AIMS</span>}
```
(same for PT; QA chip gets it only while the QA staging column is visible).

### `ClassRecordView.tsx`
- Pass the new props per B5/7D to all three child components.

---

## 7E — AimsPanel: `src/pages/teacher/components/AimsPanel.tsx`
- Remove QA disable: `disabled={isQA}` → delete; remove `opacity-70 cursor-not-allowed` branch (~429, ~433).
- QA hint (~446-449): "Imports to the TA column. If you already entered a QA score, yours is kept (AIMS QA stays available to import later)."
- Summary text (~409): "Imported scores appear as light blue columns in their DepEd sections (WW, PT, TA)".
- Import result toast: if response includes `qaSkippedOccupied > 0`, append "· {n} QA kept (teacher score exists)".

---

## 7F — Tests: `server/src/__tests__/aims-sync.test.ts`
Update/extend (follow existing P4/P5/P6 block style):
- **P7-1:** import includes QA → `quarterlyAssessScore` = pointsEarned, `qaDescription` = title, `qaDate` = gradedAt; PS/initial/grade recomputed.
- **P7-2:** QA skip-if-occupied → existing teacher QA (85) preserved AND the QA staging row still has `importedAt: null` (re-importable after teacher clears QA).
- **P7-3:** imported items have `isAims: true` + `assessmentId` in both arrays.
- **P7-4:** idempotency incl. QA — second import changes nothing.
- **P7-5:** smart allocation — (a) placeholder-only column (all students default/0) gets REPLACED at its index by the AIMS item; (b) column with any real teacher data is untouched, AIMS appends after maxLen; (c) student without that AIMS score keeps placeholder/short array (PS unchanged).
- **P7-6:** free-column detection respects `isAims` (previously imported AIMS column is NOT free) and custom names/dates (renamed column is NOT free).
- Update old **P4-5** ("import excludes QA") to assert QA now imports.

## Verification Checklist
- [ ] `npm --prefix server run build` && root `npm run build` — clean
- [ ] `npm --prefix server run test` — all pass (baseline 157/57 + new P7)
- [ ] `npm run lint` — clean
- [ ] Manual: AIMS WW/PT/QA staging columns render INSIDE their DepEd sections (cyan), no trailing AIMS group
- [ ] Manual: after import — ledger columns cyan (isAims), fully-imported staging columns hidden, partially-imported stay tinted
- [ ] Manual: import beside untouched WW 1 placeholder → occupies the slot, no abandoned blank column; import beside teacher data → new column appended
- [ ] Manual: QA import fills empty TA; teacher-entered QA wins; skipped QA re-importable after clearing
- [ ] Manual: Optional Assessment Details shows AIMS titles + dates; grade math (PS/WS/Initial/Grade) computes
- [ ] Manual: mobile modal shows AIMS per tab; mobile list has per-category "+N AIMS", no detached AIMS block
- [ ] Manual: `pm2 restart` backend after changes; dark mode cyan tokens (`--ledger-aims` dark variant) look right
