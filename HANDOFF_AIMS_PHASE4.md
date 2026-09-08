# AIMS Phase 4 — QA Category + termIndex Binning — Implementation Handoff

> **STATUS: GREEN-LIT — IMPLEMENT THIS DOCUMENT.**
> Read `AIMS_SMART_Integration_Guide.md` (repo root, from the AIMS dev — the NEW canonical
> contract), plus the Phase 1–3 reports first. All prior phases are complete and verified.

## Context

The AIMS dev shipped upgrades on his side (see guide §4, §10):

1. **`category: "QA"`** — Quarterly Assessment items are now their own bucket (previously
   folded into WW). Our zod schema only allows `WW | PT` — **one QA row fails validation and
   silently skips the ENTIRE course sync** (same failure class as the Phase 1 null-enrollproId
   bug). Their seeded test data already contains QA quizzes, so this WILL fire in production.
2. **`termIndex`** — every score row now carries the active EP term (1/2/3) at grade time.
   More accurate than our date-binning. `null` for pre-feature rows or when EP was offline at
   grade time (fallback needed).
3. Seeded test data exists (guide §11): teachers `2000061` / `2000065`, courses with WW + QA
   quizzes + PT tasks, all `termIndex: 2`.

Hard rules:
- **No Prisma migration.** `AimsScore.category` is already a plain `String` — stores `"QA"`
  fine. `term` is already the derived field. Zero schema.prisma changes.
- **No new dependencies. Read-only towards AIMS (GET only).**
- Do not touch unrelated code. Follow `AGENTS.md`.

---

## ⚠️ CRITICAL NO-GO — never filter the scores pull by termIndex

The guide's §8 suggests `GET /public/courses/:id/scores?termIndex=<current>`. **DO NOT DO
THIS.** Our stale-sweep (`processAimsCourseData` step 7) deletes non-imported rows absent
from the current pull — a term-filtered pull would make the sweep **wipe all other terms'
rows**. Always pull ALL rows (no filter) and bin locally. Leave a code comment stating this
at the sync function so nobody "optimizes" it later.

---

## Task 1 (P0) — Allow `category: "QA"` through validation

**`server/src/schemas/aims.ts`** (~line 25):

```ts
category: z.enum(['WW', 'PT', 'QA']),
```

That's the whole P0 fix — everything downstream (Prisma `category: String`, sync upsert,
panel grouping) already tolerates the value.

## Task 2 — Adopt `termIndex` for term binning (date-binning becomes fallback)

### 2a. Schema — `server/src/schemas/aims.ts`

Add to `aimsScoreRowSchema`:

```ts
termIndex: z.number().int().min(1).max(3).nullable().optional(),
```

### 2b. Binning logic — `server/src/lib/aimsScoreSync.ts`, `processAimsCourseData()` (~line 136)

Replace the current `binTerm(gradedAt, termEndDates)` call with priority logic:

```ts
// termIndex is authoritative when present (active EP term at grade time).
// Null = pre-feature row or EP offline at grade time → fall back to date binning.
const term = row.termIndex === 1 || row.termIndex === 2 || row.termIndex === 3
  ? (`T${row.termIndex}` as Term)
  : binTerm(gradedAt, termEndDates);
```

Semantics note (guide §4): `termIndex` = "active term WHEN GRADED," not "term the work
belonged to" — identical semantics to our date-binning, just authoritative. Keep
`binTerm()` and its date windows exactly as they are (fallback path).

### 2c. Upsert must update `term` — `processAimsCourseData()` upsert (~line 203)

The current `update:` block does NOT set `term` (create-only). Add `term` to the update
block so a row binned differently after a termIndex arrives (or term dates change) moves to
the correct term instead of sticking in the old one.

### 2d. Type ripple

`AimsPublicScoreRow` in `server/src/lib/aimsClient.ts` (~line 47): add
`termIndex?: number | null;` for hygiene (this interface is currently unused/stale but
keep it in sync with the schema).

## Task 3 — QA display + import UX (frontend, small)

**Design decision (locked):** QA AIMS scores are **read-only staging forever** — they display
in the panel and ledger's cyan AIMS columns, but NEVER import into the ledger. The ledger's
TA (Quarterly Assessment) column stays manual teacher entry. (AIMS's own guide notes QA
"currently computes as WW in AIMS" — their QA math is not trustworthy for our ledger, and
our QA slot is a single score, not an item array.)

### 3a. `server/src/lib/aimsImport.ts` — exclude QA from import (~line 75)

Add to `aimsWhere`:

```ts
category: { in: ['WW', 'PT'] },
```

QA rows then never enter the import flow, never get `importedAt` stamped, and remain
permanently visible as un-imported staging (correct — they're not importable).

### 3b. `src/pages/teacher/components/AimsPanel.tsx` — category color (~line 434)

Change the WW/PT ternary to include QA with the TA token:

```tsx
a.category === "WW" ? "text-[var(--ledger-ww)]"
  : a.category === "QA" ? "text-[var(--ledger-ta)]"
  : "text-[var(--ledger-pt)]"
```

### 3c. `AimsPanel.tsx` import dialog — QA items not selectable (~lines 384-412)

- QA assessments render with the TA-colored category label (3b) but their checkbox is
  **disabled + unchecked**, with a small hint: "QA scores stay read-only — record the
  Quarterly Assessment manually in the TA column."
- `openImportDialog()` (~line 65): default selection = WW/PT assessments only
  (`a.category !== "QA"`).
- Import button count reflects only selectable items.

### 3d. No changes needed (verified — do not touch)

- `ClassRecordTable.tsx` AIMS cells (~line 418-439): renders ALL aimsAssessments uniformly
  in AIMS cyan — QA flows through automatically. Tooltip already prints `a.category`.
- `ClassRecordMobileList.tsx` AIMS chip (~line 114-129): counts items, category-agnostic.
- `GradeEditModal.tsx`: displays AIMS scores per assessment, category-agnostic.

## Task 4 — Tests (`server/src/__tests__/aims-sync.test.ts`)

1. **QA row survives (P0):** payload mixing WW + QA rows → parse succeeds, both upsert,
   `category` stored as `"QA"` for the QA row.
2. **termIndex preferred:** row with `termIndex: 2` but `gradedAt` inside T1 window →
   stored `term === "T2"`.
3. **termIndex null falls back:** row with `termIndex: null` + `gradedAt` in T1 window →
   `term === "T1"` (existing binning path).
4. **Upsert moves term:** create row via termIndex 1, re-process same assessmentId with
   termIndex 3 → term updates to T3 (validates 2c).
5. **Import excludes QA:** AimsScore rows WW + QA for a student, run
   `importAimsScoresToGrades` → WW appended to ledger, QA row NOT appended and
   `importedAt` stays null.

Existing tests must stay green (some `mkRow` payloads may need `termIndex` omitted —
optional field, no breakage expected).

## Verification (required)

- `npm --prefix server run build` — zero errors
- `npm run build` (root) — zero errors
- `npm run lint` (root) — zero NEW warnings (Phase 3 baseline: 1131, all pre-existing)
- `npm --prefix server run test` — all pass incl. new tests
- Manual sanity (build-level): AimsPanel typechecks with QA branch; import dialog logic

## Explicitly OUT of scope

- **NEVER add `?termIndex=` to the scores pull** (critical no-go above)
- No Prisma migration / schema.prisma changes
- `GET /public/school/term-context` endpoint — NOT adopted (SMART resolves terms from
  EnrollPro per AGENTS.md; each row carries its own termIndex anyway)
- `GET /public/students/:id/grades` — not adopted (AIMS-computed grades; we compute our own)
- `from=`/`to=` watermarks (backlog)
- Any EnrollPro/ATLAS changes, any writes to AIMS

## Report back

Write **`HANDOFF_AIMS_REPORT_PHASE4.md`** (repo root): files changed + line refs,
build/lint/test output, deviations, discoveries, open items. The lead's checker agent will
verify against this doc and the integration guide.

---

## Appendix A — termIndex semantics (from guide §4)

- `1`/`2`/`3` = active EP term when the submission was graded.
- `null` = pre-term-aware submission, or EP unreachable at grade time → date-binning fallback.
- NOT "which term the work belonged to" — AIMS has no such concept.

## Appendix B — QA category mapping (from guide §4)

| Value | Source in AIMS |
|---|---|
| `WW` | Quiz (default), Task (`ASSIGNMENT`, `WRITTEN_WORK`) |
| `PT` | Task (`PERFORMANCE_TASK`) |
| `QA` | Quiz or Task (`QUARTERLY_ASSESSMENT`) |

AIMS's internal QA computation currently treats QA as WW — another reason we keep QA
read-only and let the teacher record TA manually.

## Appendix C — Live verification data (once the API key is in place)

Seeded on AIMS dev (guide §11): teachers `2000061` (EP-114-ENG, 5 students) and `2000065`
(EP-108-SCI_CHEM, 5 students); each course has 1 WW quiz + 1 QA quiz + 1 PT task, 15 graded
rows, all `termIndex: 2`. Known course IDs: `3f748629-fd7b-43d3-9237-86331791790d` (ENG),
`2626f42e-d5e4-49f7-935c-98c0ee147aff` (SCI_CHEM). After the key lands, a live sync of a
linked course should show WW + QA + PT staging columns with QA in TA colors.

## Appendix D — Ops (lead, not workhorse): API key activation

The AIMS dev has shared the EXTERNAL_API_KEY out-of-band. Lead steps:
1. Add `AIMS_API_KEY=<value>` to `server/.env` (lead-only file — agents must not touch it)
2. Restart the backend
3. Smoke test: `curl -H "x-api-key: <KEY>" "http://100.92.245.14:5000/api/v1/public/courses?teacherUsername=2000061"`
   → expect `200` with the ENG course
4. Log in as a teacher, open Class Records → Connect AIMS → picker should list courses
