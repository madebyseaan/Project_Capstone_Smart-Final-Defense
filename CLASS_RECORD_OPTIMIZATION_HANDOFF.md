# CLASS RECORD OPTIMIZATION HANDOFF

**Target:** `src/pages/teacher/ClassRecordView.tsx` and its component family
**Author:** Planning agent (research complete, zero code changed)
**Executor:** WorkHorse AI
**Status:** Ready for implementation

---

## 1. How to use this document

Work phase-by-phase, in order. Each phase is independently shippable and ends with the
verification commands green. **Commit once per phase** so any regression is a single
`git revert`. Do not start a phase until the previous phase's acceptance criteria pass.

Line numbers reference the current codebase at time of writing; if code has moved,
findings include anchors (function/variable names) to relocate them.

---

## 2. Context

ClassRecordView is the teacher's core grading surface: a DepEd-style class ledger
(Written Work / Performance Tasks / Term Assessment columns, PS/WS/Initial/Final Grade
computation, transmutation). It is the most-used page in the system.

- Page: `src/pages/teacher/ClassRecordView.tsx` — **1072 lines (violates the 1000-line rule in AGENTS.md)**
- Child components: `src/pages/teacher/components/` — 10 files, ~4,100 lines total
- Backend: `server/src/routes/grades-sub/classes.ts` (840 lines) serves the endpoints
- Stack facts: React 19, Vite, Tailwind v4, shadcn/ui. **`@tanstack/react-query@5` and
  `zustand` are installed but never used anywhere in `src/`** (no QueryClientProvider).
  `sonner` Toaster is mounted in `src/main.tsx` and a wrapper exists at `src/lib/toast.ts`.
- **`npm run build` is `vite build` only — it does NOT typecheck.** Type errors are
  currently invisible (see Finding F2).

---

## 3. Non-negotiables (read before touching anything)

1. **Do not break the backend contract.** Existing endpoints (`POST /grades/grade`,
   `GET /grades/class-record/:id`, `POST /grades/clear-scores`, edit-request routes)
   keep their exact paths, payloads, responses, and status codes. The ONLY backend
   additions allowed: one new route (`POST /grades/grade/batch`), one new zod schema,
   optional additive fields on `scoreItemSchema` (see F21 — verify first), one new test file.
2. **Do not change grade-lock precedence.** Chain (from `server/src/lib/gradeLocks.ts`):
   `archived → YEAR lock → TERM lock → legacy system-wide gradeLock`. An APPROVED
   `GradeEditRequest` bypasses the TERM lock only — never archived/year locks.
   Mirror this exactly in the batch endpoint.
3. **Do not change grade math semantics.** Rounding (`Math.round(x * 100) / 100`),
   PS/WS formulas, weight application, DepEd fallback transmutation ranges, and the
   "60 floor" stay byte-identical. Refactors move code; they do not alter outputs.
4. **Do not change term resolution.** `resolveCurrentTerm()` is the only source of
   truth for the current term. Never hardcode.
5. **Do not touch** `.env` / `.env.*`, EnrollPro/ATLAS sync logic, Prisma schema,
   other pages, or `sessionStorage` key names (`token_teacher`, `user_teacher`, ...).
6. **File size max 1000 lines** after refactors. Target: ClassRecordView < 600.
7. Preserve DOM contract for Enter-key navigation: score inputs must keep
   `data-row-index`, `data-cat`, `data-col` attributes and the `document.querySelector`
   focus-chaining in `ClassRecordTable.tsx` (`onKeyDown` handlers).
8. Preserve tutorial DOM ids: `tutorial-hps-row`, `tutorial-cell-example`,
   `tutorial-hps-cell`, `tutorial-gender-toggle`, `tutorial-optional-details`,
   `tutorial-period-controls`, `tutorial-task-controls`, `tutorial-ledger-scores`,
   `tutorial-column-meta-editor`, `tutorial-assessment-details-panel`.
   `ClassRecordTour.tsx` targets these by id.
9. Run `npm run build` (root) plus the new typecheck script before finishing any phase.

---

## 4. Current state inventory

| File | Lines | Role |
|---|---|---|
| `src/pages/teacher/ClassRecordView.tsx` | 1072 | Page orchestrator, ~15 useState, manual fetching |
| `src/pages/teacher/components/ClassRecordTable.tsx` | 964 | Desktop ledger, sticky header stack, LedgerRow |
| `src/pages/teacher/components/ClassRecordTour.tsx` | 744 | Guided tour (functional; out of scope except imports) |
| `src/pages/teacher/components/classRecordActions.ts` | 385 | executeScoreUpdate / executeHpsUpdate / executeRemoveTask |
| `src/pages/teacher/components/AssessmentHeader.tsx` | 276 | Column meta editor + bulk details panel |
| `src/pages/teacher/components/GradeEditModal.tsx` | 233 | Mobile per-student editor |
| `src/pages/teacher/components/ClassRecordMobileList.tsx` | 131 | Mobile list view |
| `src/pages/teacher/components/classRecordMobileUtils.ts` | 94 | Grade math (duplicated) + mobile draft keys |
| `src/pages/teacher/components/ClassRecordHero.tsx` | 90 | Header |
| `src/pages/teacher/components/EditRequestModal.tsx` | 120 | Edit-request form |
| `src/pages/teacher/components/ClassRecordStats.tsx` | 35 | Stats strip |
| `src/lib/api.ts` | 1557 | `gradesApi` at lines 286–423 |
| `server/src/routes/grades-sub/classes.ts` | 840 | GET class-record (~100–195), POST /grade (198+) |

---

## 5. Findings catalog

Referenced by tasks below as F1, F2, etc.

### Correctness bugs

- **F1 — Transmutation inconsistency.** Desktop ledger fetches the admin-configured
  transmutation table (`ClassRecordTable.tsx:566–572`, used in `LedgerRow`), but
  `ClassRecordStats` and the mobile list compute final grades via
  `classRecordMobileUtils.getDisplayFinalGrade` with the **hardcoded DepEd fallback**
  (`classRecordMobileUtils.ts:6–35`, called from `ClassRecordView.tsx:761–762` without
  a table arg). If admin customized transmutation, stats/mobile show different final
  grades than the ledger for the same student.
- **F2 — Response type drift.** `gradesApi.getClassRecord` return type
  (`src/lib/api.ts:332–345`) omits `termDates`, `gradeLock`, and `locks`, which the
  backend returns (`server/src/routes/grades-sub/classes.ts:174–189`) and the component
  consumes (`ClassRecordView.tsx:309–313`). Compiles only because `vite build` never
  typechecks.
- **F3 — Invalid Tailwind class `bg-rose-55`.** 3 occurrences (A/E status highlight)
  in `ClassRecordTable.tsx` (~lines 221, 310, 396 — search `bg-rose-55`). The class
  does not exist; the highlight never renders.
- **F4 — Stale uncontrolled cells.** Ledger inputs are uncontrolled (`defaultValue`,
  e.g. `ClassRecordTable.tsx:217, 305, 393`). If query data changes underneath
  (background refetch), displayed values silently diverge from state. Currently masked
  because every save triggers a full refetch + the A/E local-state write. Becomes a
  real hazard once React Query lands (Phase 3) — explicit mitigation required.
- **F5 — Effect missing dependency.** `ClassRecordView.tsx:529–531`:
  `useEffect(() => { fetchClassRecord(); }, [classAssignmentId, selectedTerm])` omits
  `fetchClassRecord`. Works today; a trap after any refactor.

### Performance / reliability

- **F6 — N+1 write bursts.** `saveColumnMeta` (`ClassRecordView.tsx:391–407`),
  `applyColumnMetaFromMobile` (458–474), `saveAssessmentDetails` (705–726),
  `executeHpsUpdate` (`classRecordActions.ts:265–293`), `executeRemoveTask`
  (352–377) each fire **one POST per student via `Promise.all`** — 40–50 requests in
  a burst. Global rate limit is **300 req/min per IP** (`server/src/middleware/rateLimiter.ts:4`).
  Partial failure leaves the class half-saved with one generic error.
- **F7 — Full class refetch after every single-cell commit.**
  `classRecordActions.ts:199` (`await fetchClassRecord(true)` inside
  `executeScoreUpdate`) — refetches ~50 students to persist one edited cell.
- **F8 — `weights` object recreated every render.** `ClassRecordTable.tsx:604–608`
  builds a fresh object per render; it is passed to every memoized `LedgerRow`,
  defeating `React.memo` on all rows each render.
- **F9 — Term-init double fetch.** `ClassRecordView.tsx:290–300`: first fetch may
  `setSelectedTerm(...)` and `return` early, discarding the fetched payload; the term
  change re-triggers the effect → second fetch.
- **F10 — 3x copy-pasted ResizeObserver effects.** `ClassRecordView.tsx:543–562,
  564–584, 586–606` (ledger header, assessment details, meta editor).

### Duplication

- **F11 — `transmuteGrade` duplicated.** `ClassRecordTable.tsx:35–64` and
  `classRecordMobileUtils.ts:6–35` (identical fallback tables).
- **F12 — `getGradeColor` duplicated.** `ClassRecordView.tsx:42–49` and
  `ClassRecordTable.tsx:24–31`.
- **F13 — `saveColumnMeta` ≈ `applyColumnMetaFromMobile`.** `ClassRecordView.tsx:356–418`
  vs `420–482` — same next-meta construction + same save loop, two copies.
- **F14 — LedgerRow WW/PT/QA cell blocks x3.** `ClassRecordTable.tsx:202–261,
  292–350, 381–436` — ~230 lines of near-identical inline IIFE cell renderers.

### Latent backend bug (verify first — Phase 2)

- **F21 — Zod strips ScoreItem extras on every save.** `validate()`
  (`server/src/middleware/validate.ts:25`) replaces `req.body` with parsed output, and
  `scoreItemSchema` (`server/src/schemas/grades.ts:9–13`) declares only
  `name/score/maxScore`. Zod's default strips unknown keys → **`description`, `date`,
  and A/E `status` sent by the frontend are silently dropped** before the handler runs.
  In-session the UI masks this: the meta-derivation effect keeps `prev` values
  (`ClassRecordView.tsx:237–249`), and optimistic local state hides A/E loss until
  refetch. Cross-session, assessment metadata and A/E marks likely do not persist.
  VERIFY with a vitest or manual test (save a description + an "A" score via UI →
  refresh → check DB/API response). If confirmed, fixing = add optional
  `description`/`date`/`status` fields to `scoreItemSchema` (additive; see Phase 2 task 2).

### Design system violations

- **F15 — Hand-rolled toast** (`ClassRecordView.tsx:871–878`) instead of the app
  standard `@/lib/toast` (sonner, already mounted — `src/main.tsx:12`).
- **F16 — Banned patterns:** `font-black` (40+ occurrences across the family),
  `space-y-8` page root (`ClassRecordView.tsx:870`), emoji in UI chrome
  (`ClassRecordTable.tsx:695` — `View Only` badge), `tracking-widest` on non-table-header
  text, raw `text-slate-*`/`bg-gray-100` for chrome, no dark-mode support (ledger is
  light-only: `bg-white`, `text-slate-*` hardcoded).
- **F17 — Zero ARIA on score inputs.** No labels, no `aria-invalid` despite an
  existing `invalidCells` error map.
- **F18 — Dead computation.** `stats.lowest` computed (`ClassRecordView.tsx:774`) but
  never rendered (`ClassRecordStats` receives only avg/passed/total/highest).
- **F19 — `any` typing on API surfaces.** `getMyEditRequests` returns `requests: any[]`
  (`src/lib/api.ts:409–410`); edit-request effect uses `(r: any)` (`ClassRecordView.tsx:124–125`).

---

## 6. Approved decisions (confirmed by owner)

| # | Decision |
|---|---|
| D1 | **Batch endpoint allowed** — additive `POST /api/grades/grade/batch`; existing endpoints untouched; frontend falls back to per-student saves if batch returns 404 (deployment-order independent). |
| D2 | **React Query migration approved** — wire `QueryClientProvider` in `main.tsx`; this page becomes the reference implementation. |
| D3 | **Ledger category colors become CSS custom-property tokens** (`--ledger-ww/pt/ta/grade` + dark variants) — a documented exception to the semantic-token rule. Keeps WW=indigo / PT=purple / TA=amber / Grade=emerald coding, fixes dark mode. |
| D4 | **Unify transmutation source** — parent fetches the admin table once; ledger, stats, and mobile all use it (fixes F1). |

---

## 7. Phase 0 — Safety net

**Goal:** make type errors visible; make the API client honest; establish a green baseline.

- [ ] **0.1** Add to root `package.json` scripts: `"typecheck": "tsc -b"`.
      (Verify `tsconfig.json` has `references` to `tsconfig.app.json` / `tsconfig.node.json`;
      both sub-configs carry `noEmit: true` — `tsc -b` will typecheck without emitting.)
- [ ] **0.2** Fix `gradesApi.getClassRecord` return type (`src/lib/api.ts:332–345`):
      add `termDates: { t1StartDate?: string | null; t1EndDate?: string | null; t2StartDate?: string | null; t2EndDate?: string | null; t3StartDate?: string | null; t3EndDate?: string | null }`,
      `gradeLock?: boolean`, and `locks` mirroring `getGradeLockState()` from
      `server/src/lib/gradeLocks.ts` (read it and copy the shape; at minimum
      `{ systemLocked: boolean; yearLocked: boolean; termLocks: { T1: boolean; T2: boolean; T3: boolean } }`).
- [ ] **0.3** **Baseline reality (verified by the planning agent — do not be alarmed):**
      - `npm run build` (vite): **GREEN.** This is the only fully green gate today.
      - `npx tsc -b`: **RED — 100+ pre-existing errors across ~40 files.** The app has
        never been typechecked (`vite build` skips it). Two big categories:
        1. `src/components/ui/select.tsx` has type drift against `@base-ui/react`
           (TS2339/TS2739/TS2344 inside the primitive itself), which propagates
           `TS2739 SelectContent` errors into dozens of pages. **OUT OF SCOPE — do not
           fix `select.tsx`** (it is a shared primitive; fixing it touches half the app
           and violates non-negotiable 5). These errors are pre-existing noise.
        2. Everything else — record, don't fix.
      - `npm run lint`: **904 problems (24 errors, 880 warnings), pre-existing, app-wide.**
      - **Procedure:** snapshot both baselines before changing anything:
        `npx tsc -b > typecheck-baseline.txt 2>&1` and
        `npm run lint > lint-baseline.txt 2>&1` (root). Do not commit the snapshots;
        keep them for the duration of the work as the comparison reference.
- [ ] **0.4** **Fix the module-family type errors (in scope, fix now or during Phase 1):**
      - `ClassRecordView.tsx:1` — unused `React` default import (also
        `ClassRecordHero.tsx:1`, `ClassRecordMobileList.tsx:1`, `ClassRecordStats.tsx:1`,
        `ClassRecordTour.tsx:1`, `GradeEditModal.tsx:1`)
      - `ClassRecordView.tsx:85` — `termLabels` missing from the `getSettings()` response
        type in `api.ts` (additive type fix there)
      - `ClassRecordView.tsx:308–312` — `termDates` / `gradeLock` (this is F2, fixed by 0.2)
      - `classRecordActions.ts:88` — `newValue` narrowed to `never` because the param is
        typed `number` but A/E are strings. Type it as `number | "A" | "E"` and let the
        `isSpecial` branch narrow correctly.
      - `ClassRecordTable.tsx:212, 301, 388` — TS2367 number-vs-string comparisons: the
        fallback A/E checks `wwScores[i]?.score === "A"` compare a numeric field to a
        string and are always false (the real signal is `.status`). This is dead code —
        remove the dead comparisons in Phase 1.7's cell extraction; keep the `.status` check.
      - `ClassRecordTable.tsx:564` — `NodeJS.Timeout` does not exist in browser code →
        `ReturnType<typeof setTimeout>`
      - `ClassRecordTable.tsx:732` and `ClassRecordMobileList.tsx:44` — SelectContent
        prop errors caused by `select.tsx` drift (out of scope; leave as baseline noise)
      - `ClassRecordsList.tsx:249, 332–333` — pre-existing errors in the ADJACENT list
        page. Out of scope; record only.

**Acceptance:**
- `npm run typecheck` — zero errors in the module family; error count elsewhere
  identical to `typecheck-baseline.txt` (no new errors introduced).
- `npm run lint` — no NEW errors/warnings in any file touched by the phase
  (pre-existing warnings in family files may survive until Phases 3–5 remove them
  naturally, e.g. `any` cleanup).
- `npm run build` (root) and `npm run build` + `npm test` in `server/` — green.
- Commit (include baseline error counts in the message).

---

## 8. Phase 1 — Shared domain module + deduplication (pure refactor, fixes F1)

**Goal:** single sources of truth for grade math, measurement, and meta-saving.
No behavior change except D4 (transmutation consistency), which is the point.

- [ ] **1.1** Create `src/lib/gradeMath.ts` (pure functions, no React):
      - `TransmutationRow` type
      - `DEPED_FALLBACK_TRANSMUTATION` constant (the existing fallback ranges)
      - `transmuteGrade(initialGrade, table?)` — logic identical to
        `ClassRecordTable.tsx:35–64`
      - `getGradeColor(grade)` — from `ClassRecordView.tsx:42–49`
      - `getDisplayFinalGrade(record, term, weights, table?)` — from
        `classRecordMobileUtils.ts:41–70`, now honoring the `table` param
      - score helpers: `totalScores`, `maxScores`, `percentageScore`
- [ ] **1.2** Rewire imports (delete the duplicated copies):
      - `ClassRecordTable.tsx`: delete local `getGradeColor` + `transmuteGrade`
        (lines 24–64), import from `@/lib/gradeMath`.
      - `classRecordMobileUtils.ts`: delete local `transmuteGrade` +
        `getDisplayFinalGrade`; re-export `getDisplayFinalGrade` from `@/lib/gradeMath`
        (keeps `ClassRecordView.tsx:31–35` import path stable), keep
        `getMobileDraftKey` / `getScoreFromGrade` in place.
      - `ClassRecordView.tsx`: delete local `getGradeColor` (42–49), import instead.
- [ ] **1.3** **Unify transmutation source (D4):** move the table fetch from
      `ClassRecordTable.tsx:566–572` up to `ClassRecordView` (plain state + effect for
      now; becomes a query in Phase 3). Pass `transmutationTable` down as a prop to
      `ClassRecordTable` and use it in `getDisplayFinalGrade` /
      `computeDisplayFinalGrade` calls (`ClassRecordView.tsx:761–762`) so ledger,
      stats (`stats` memo, 764–776), and mobile list all share one table.
- [ ] **1.4** Create `src/hooks/useElementHeight.ts`:
      `useElementHeight(ref: RefObject<HTMLElement | null>, enabled?: boolean): number`
      — encapsulates the observe/measure/resize-listen pattern. Replace the three
      copy-pasted effects in `ClassRecordView.tsx:543–606` (F10). Keep behavior
      identical (0 when disabled/absent).
- [ ] **1.5** Merge `saveColumnMeta` + `applyColumnMetaFromMobile` (F13): extract
      `saveMetaToAllStudents({ classAssignmentId, classRecord, term, wwMeta, ptMeta,
      qaMeta, wwCount, ptCount, applyMetaToScores })` into
      `src/pages/teacher/components/classRecordActions.ts` returning
      `{ ok: boolean; error?: string }`. Both call sites (desktop quick editor,
      mobile `onApplyColumnMeta`) become thin wrappers. In Phase 2/3 this helper's
      internals swap to the batch endpoint — the call sites never change again.
- [ ] **1.6** Add `getErrorMessage(err: unknown, fallback: string): string` to
      `src/lib/utils.ts` (check first whether one exists; do not duplicate).
      Reads `err.response.data.message` when present. Replace every
      `err?.response?.data?.message || '...'` pattern in the module family.
- [ ] **1.7** Extract `LedgerScoreCell` inside `ClassRecordTable.tsx` (F14): one
      memoized component with props
      `{ cat: 'WW'|'PT'|'QA'; index: number; value: string|number; isHps: boolean;
      invalid?: string; disabled?: boolean; hpsClass?: string; onCommit(inputEl, ...);
      onHps(val); onFocus(cat, idx); dataRowIndex: number; ariaLabel: string }`
      replacing the three inline IIFE blocks (202–261, 292–350, 381–436).
      **Preserve exactly:** `data-row-index` / `data-cat` / `data-col`, Enter-key
      focus chaining, `dataset.prev` restore-on-invalid, placeholder, inputMode,
      special A/E class branches (fixing `bg-rose-55` happens in Phase 5 — keep it
      verbatim here so the refactor diff stays pure).

**Acceptance:** no behavior change (except stats/mobile now matching ledger
transmutation — verify with a custom admin table); all Phase 0 commands green;
`ClassRecordTable.tsx` drops meaningfully below 900 lines. Commit.

---

## 9. Phase 2 — Backend batch endpoint (additive only; D1)

**Goal:** one request replaces the 40–50-request bursts (F6); never half-save a class.

- [ ] **2.1 — VERIFY F21 FIRST.** Write a quick vitest in
      `server/src/__tests__/scoreitem-strip.test.ts`: parse a sample
      `gradeSaveSchema` body where a writtenWorkScores item includes
      `description`, `date`, `status: "A"`; assert what survives. 
      - **If stripped (expected):** extend `scoreItemSchema` in
        `server/src/schemas/grades.ts` with optional fields:
        `description: z.string().optional()`, `date: z.string().optional()`,
        `status: z.enum(['A','E']).optional()`. This is additive — existing payloads
        behave identically, and previously-dropped data now persists (bug fix).
      - Include the test permanently (documents the behavior).
- [ ] **2.2** Add `batchGradeSaveSchema` to `server/src/schemas/grades.ts`:
      ```ts
      export const batchGradeSaveSchema = z.object({
        body: z.object({
          classAssignmentId: z.string().min(1),
          term: termEnum,
          updates: z.array(
            z.object({
              studentId: z.string().min(1),
              writtenWorkScores: z.array(scoreItemSchema).optional(),
              perfTaskScores: z.array(scoreItemSchema).optional(),
              quarterlyAssessScore: z.number().min(0).optional(),
              quarterlyAssessMax: z.number().positive().optional(),
              qaDescription: z.string().optional(),
              qaDate: z.string().optional(),
            })
          ).min(1).max(200),
        }),
      });
      ```
- [ ] **2.3** Add `POST /grade/batch` in `server/src/routes/grades-sub/classes.ts`,
      next to the existing `POST /grade`. Same middleware chain:
      `authenticateToken, authorizeRoles("TEACHER"), validate(batchGradeSaveSchema)`.
      Handler must run, **in this order** (mirroring the single-save handler at
      lines 198–330 — read it first and copy its guard semantics exactly):
      1. Teacher lookup (`prisma.teacher.findUnique({ where: { userId: req.user?.id } })`).
      2. ClassAssignment ownership: `findFirst({ where: { id, teacherId: teacher.id } })`
         → 403 `Not authorized for this class`.
      3. HG subject guard (`isHomeroomGuidanceSubjectCode`) → 400.
      4. **Term policy:** load `existingGrades` for the (classAssignmentId, term);
         run `checkGradeEditLocks({ teacherUserId, schoolYearLabel, term, isArchived })`
         per distinct isArchived value among targets → 403 with lock code on block
         (class-level: abort whole batch).
      5. Current-term check with APPROVED-edit-request bypass (mirror lines 267–291;
         one lookup for the teacher's APPROVED request covering this term) → 403.
      6. **Per-student pre-checks (skip, don't abort):** enrollment status
         DROPPED/TRANSFERRED → skip with reason; existing grade `status === 'FINALIZED'`
         → skip with reason; archived grade → skip with reason (registrar unfinalize /
         admin unlock are the only paths that open those).
      7. `prisma.$transaction`: upsert every non-skipped update. **Reuse the exact
         PS/WS/initial/quarterly computation from the single-save handler** — extract
         it into a shared function (e.g. `computeGradeMetrics(scores, weights)` in
         `server/src/lib/` or a local helper module) used by BOTH endpoints so the
         math can never drift.
      8. Respond `200 { savedCount: number, skipped: Array<{ studentId: string,
         reason: string }> }`. Any DB error inside the transaction → 500, batch rolled
         back atomically.
- [ ] **2.4** Test file `server/src/__tests__/grade-batch.test.ts`, modeled on
      `grade-lock.test.ts` and `year-term-locks.test.ts` (supertest against the app):
      - happy path saves all, returns savedCount
      - TERM lock set → 403 for whole batch
      - year lock / archived → 403 (APPROVED edit request does NOT bypass year/archived)
      - dropped student → appears in `skipped`, others still saved
      - FINALIZED student → skipped with reason
      - past term + APPROVED unexpired edit request → saves
      - past term without edit request → 403
      - >200 updates → 400
- [ ] **2.5** Frontend API client (no behavior change yet): add to `gradesApi` in
      `src/lib/api.ts`:
      ```ts
      saveGradeBatch: (data: {
        classAssignmentId: string;
        term: string;
        updates: Array<{ studentId: string; writtenWorkScores?: ScoreItem[];
          perfTaskScores?: ScoreItem[]; quarterlyAssessScore?: number;
          quarterlyAssessMax?: number; qaDescription?: string; qaDate?: string; }>;
      }) => api.post<{ savedCount: number; skipped: Array<{ studentId: string; reason: string }> }>("/grades/grade/batch", data),
      ```
      Wire the batch call into `saveMetaToAllStudents` (Phase 1.5), `executeHpsUpdate`,
      `executeRemoveTask`, and `saveAssessmentDetails` **with fallback**: if
      `err.response?.status === 404` (older backend deployed), fall back to the
      existing per-student loop. Surface `skipped` reasons in the success toast
      (e.g. "Saved 43 — 2 skipped (dropped)").

**Acceptance:** `cd server && npm run build && npm test` green including the new
tests; root `typecheck`/`lint`/`build` green; manual: edit column meta on a class →
ONE network request; kill backend mid-save → no partial state (transaction).
Commit.

---

## 10. Phase 3 — React Query migration (D2)

**Goal:** server state via React Query; optimistic single-cell saves; kill F4/F5/F7/F9.

- [ ] **3.1** `src/main.tsx`: create and mount
      ```tsx
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      });
      ```
      Wrap `<App />` with `<QueryClientProvider client={queryClient}>`. Keep the diff
      minimal (Toaster/router untouched).
- [ ] **3.2** Create `src/pages/teacher/hooks/useClassRecord.ts` exporting:
      - `useClassRecordQuery(classAssignmentId, selectedTerm)` —
        `queryKey: ['class-record', classAssignmentId, selectedTerm]`,
        `queryFn: () => gradesApi.getClassRecord(...)`,
        `placeholderData: keepPreviousData` (no flash on term switch).
        **No polling, no window-focus refetch on this key** (protects uncontrolled
        cells — refetches only on mount, term change, and invalidation).
      - `useTransmutationTable()` — `queryKey: ['transmutation-table']`,
        `staleTime: 5 * 60_000` (admin-configured, rarely changes). Replaces the
        Phase 1.3 manual fetch.
      - `useEditRequests(enabled)` — `queryKey: ['edit-requests']`,
        `refetchInterval: 60_000`, `enabled`. Derives `{ status, expiresAt }` with
        the same matching logic as `ClassRecordView.tsx:121–136` (PENDING /
        unexpired APPROVED for selectedTerm). Type the request shape (fixes F19).
      - `useSaveScore(classAssignmentId, selectedTerm)` — `useMutation` on
        `gradesApi.saveGrade`:
        - `onMutate`: `await queryClient.cancelQueries({ queryKey: ['class-record', classAssignmentId] })`;
          snapshot previous data; `setQueryData` patching ONLY the target student's
          grade (port the optimistic block from `classRecordActions.ts:111–160`);
          return snapshot.
        - `onError`: restore snapshot, `toast.error(getErrorMessage(...))`.
        - `onSuccess`: patch the saved `Grade` from the response into the cache for
          that student (server response is authoritative). **No full invalidate** —
          this kills F7.
      - `useBatchSave(classAssignmentId, selectedTerm)` — mutation on
        `gradesApi.saveGradeBatch` (with the 2.5 fallback);
        `onSettled: () => queryClient.invalidateQueries({ queryKey: ['class-record', classAssignmentId] })`
        (batch ops are class-wide → full refetch is correct here).
- [ ] **3.3** Refactor `classRecordActions.ts`: keep the exported function names and
      call-site contracts stable where possible, swap internals —
      `setClassRecord(prev => ...)` becomes `queryClient.setQueryData(...)`,
      `Promise.all` saves become `useBatchSave`/`saveGradeBatch`, and the
      setState-setter props (`setClassRecord`, `setWwMeta`, ...) shrink to what's
      still genuinely local UI state.
- [ ] **3.4 — F4 mitigation (REQUIRED, do not skip):** rows must remount when server
      data changes so uncontrolled `defaultValue` refreshes. In `ClassRecordTable`,
      key each `LedgerRow` with the query's `dataUpdatedAt`:
      `key={`${r.student.id}-${dataUpdatedAt}`}` (pass `dataUpdatedAt` down from the
      page). Combined with no-polling/no-focus-refetch (3.2), remounts only happen at
      safe moments (mount, term switch, post-batch invalidation). Verify focus is not
      lost while typing (onMutate cancels in-flight refetches).
- [ ] **3.5** Term initialization (fixes F9): drop `termInitialized` early-return
      dance (`ClassRecordView.tsx:290–300`). Initialize `selectedTerm` from the first
      successful query response in a single effect:
      `if (!termInitialized && data?.currentTerm) setSelectedTerm(forcedTerm ?? data.currentTerm)`.
      The initial extra fetch (default T1 → actual term) is acceptable and
      `keepPreviousData` hides it.
- [ ] **3.6** Delete from the page: `classRecord`/`classAssignment`/
      `effectiveWeights`/`currentTerm`/`termDates`/`gradeLock`/`loading`/`error`
      useState + `fetchClassRecord` + the manual edit-requests effect + the
      auto-dismiss toast timer effect (`ClassRecordView.tsx:533–541`). All sourced
      from queries now. Keep `error`/`success` toasts via sonner (Phase 5 removes
      the remaining hand-rolled toast block).
- [ ] **3.7** Fix F8 while touching `ClassRecordTable`: memoize `weights` with
      `useMemo` on `[effectiveWeights, classAssignment]`.

**Acceptance:** editing one cell fires exactly ONE POST and no GET; batch ops fire
one POST; switching terms shows cached-then-fresh without loading flash; after a
background invalidation, changed server values appear in cells (F4 check); Phase 0
commands green. Commit.

---

## 11. Phase 4 — Decompose the page

**Goal:** `ClassRecordView.tsx` under 600 lines, page = pure composition.

- [ ] **4.1** `src/pages/teacher/hooks/useAssessmentMeta.ts` — owns `wwMeta`, `ptMeta`,
      `qaMeta`, memoized `applyMetaToScores` (from `ClassRecordView.tsx:260–282`),
      the derive-from-query effect (226–258, minus the `prev` masking once F21 fix is
      confirmed — keep `prev` fallback for safety, it is harmless when server
      persists meta), `addTask`/`removeTask` wrappers (658–688), and the merged
      column-meta save (Phase 1.5) via `useBatchSave`.
- [ ] **4.2** `src/pages/teacher/hooks/useEditAccess.ts` — `editRequestStatus`,
      `editRequestExpiresAt`, countdown interval (101–118), `isPastTerm`,
      `isViewOnly` derivation (96–98), modal open state.
- [ ] **4.3** `src/pages/teacher/hooks/useMobileEditor.ts` — modal state, drafts,
      `handleMobileDraftChange` (791–820), `commitMobileScore` (822–842),
      `openMobileEditor` (778–784), `selectedMobileRecord` memo (786–789).
- [ ] **4.4** `src/pages/teacher/hooks/useStickyLayout.ts` — the three
      `useElementHeight` uses + `topNavHeight`/`metaEditorTop`/`assessmentDetailsTop`/
      `stickyOffset` math (`ClassRecordView.tsx:858–867`).
- [ ] **4.5** Page keeps only: param parsing, term state, query hook calls, layout
      composition, tour + warning dialogs. Delete dead code (unused imports; `React`
      default import if unused under `verbatimModuleSyntax`).
- [ ] **4.6** While in the neighborhood: type the `userName` memo (56–61) without
      `any` (`JSON.parse(...) as { firstName?: string; lastName?: string }`).

**Acceptance:** page < 600 lines; every hook file < 200 lines; behavior identical
(all Phase 6 QA scenarios still pass); Phase 0 commands green. Commit.

---

## 12. Phase 5 — Polish, tokens, accessibility (D3)

**Goal:** design-system compliance with the sanctioned ledger-token exception.

- [ ] **5.1** Define ledger tokens in `src/index.css`:
      ```css
      :root {
        --ledger-ww: #4f46e5;        /* indigo-600 */
        --ledger-ww-bg: #eef2ff;     /* indigo-50  */
        --ledger-pt: #9333ea;        /* purple-600 */
        --ledger-pt-bg: #faf5ff;
        --ledger-ta: #d97706;        /* amber-600 */
        --ledger-ta-bg: #fffbeb;
        --ledger-grade: #059669;     /* emerald-600 */
        --ledger-grade-bg: #ecfdf5;
      }
      .dark { /* pick Tailwind dark palette equivalents, e.g. 300/400-shade fg, 950-shade bg */ }
      ```
      Replace the category colors in `ClassRecordTable.tsx`, `ClassRecordMobileList.tsx`,
      `AssessmentHeader.tsx`, `GradeEditModal.tsx` with
      `text-[var(--ledger-ww)]` / `bg-[var(--ledger-ww-bg)]` etc. The HPS row's
      slate-800 base may stay (it is chrome, token it to `bg-muted`-equivalent if
      straightforward, otherwise leave and note it).
- [ ] **5.2** Document the exception: add a short "Ledger category tokens" note to the
      Design System section of `AGENTS.md` (these vars are the sanctioned way to color
      WW/PT/TA/Grade columns; raw palette classes remain banned elsewhere).
- [ ] **5.3** Fix banned patterns (F16): `font-black` → `font-bold`; `space-y-8` →
      `space-y-6` (page root); `tracking-widest` → `tracking-wide` on non-table-header
      text (table headers may keep it per AGENTS.md); emoji badge
      (`ClassRecordTable.tsx:695`) → `<Eye className="w-3 h-3" />` + text; raw
      `text-slate-*`/`bg-gray-100` on **chrome** (dialogs, banners, buttons, toasts)
      → `text-foreground`/`text-muted-foreground`/`bg-muted`. Ledger cells use the
      5.1 tokens.
- [ ] **5.4** Fix `bg-rose-55` (F3): A/E highlight becomes
      `bg-rose-500/10` (A) and `bg-[var(--ledger-ww-bg)]` or `bg-indigo-500/10` (E)
      with `font-bold` text — verify A/E marks now visibly highlight.
- [ ] **5.5** Toasts (F15): replace the fixed-position toast block
      (`ClassRecordView.tsx:871–878`) with `toast.success` / `toast.error` /
      `toast.warning` from `@/lib/toast`. Include batch `skipped` summary in the
      success message. Remove leftover error/success state.
- [ ] **5.6** Accessibility (F17): in `LedgerScoreCell` add
      `aria-label` (e.g. `WW 2 score for Dela Cruz, Juan, max 15`),
      `aria-invalid={!!invalid}`, and `title={invalid}` for the error message.
      HPS inputs: `aria-label="WW 2 highest possible score"`.
- [ ] **5.7** Empty state: when `classRecord.length === 0`, render a friendly empty
      card ("No learners enrolled in this class for this school year") instead of an
      empty table shell.
- [ ] **5.8** Resolve F18: pass `lowest` to `ClassRecordStats` and render it, or
      delete the computation. Prefer rendering.
- [ ] **5.9** Dark-mode pass: ledger must be legible with tokens; check the sticky
      corner masks (`ClassRecordTable.tsx:645–647`, hardcoded `bg-slate-100`) —
      they must match the page background in both themes (use `bg-background`).

**Acceptance:** `npm run lint` clean of banned patterns in touched files; visual QA
in light + dark; A/E marks visibly styled; screen-reader labels present (React DevTools
or axe spot-check). Phase 0 commands green. Commit.

---

## 13. Phase 6 — Verification (gate before handback)

### Commands

```
# root
npm run typecheck     # gate: family = 0 errors; app-wide count <= baseline snapshot
npm run lint          # gate: no NEW issues vs baseline snapshot
npm run build         # gate: green (this is the only gate green today)

# server
cd server
npm run build
npm test
```

**Pre-existing baseline (verified):** `tsc -b` has 100+ errors app-wide (~40 files,
largest source: `src/components/ui/select.tsx` Base UI prop drift — out of scope);
`npm run lint` reports 904 problems (24 errors, 880 warnings). These predate this work.
The gates are "zero family errors" and "no NEW issues" — not a fully clean app.
`ClassRecordView` is currently the heaviest page chunk at **94.99 kB (gzip 23.46 kB)** —
Phases 3–5 should not materially grow it (React Query adds ~12–13 kB gzip shared
across all pages once wired).

### Manual QA matrix (run dev stack: root `npm run dev`)

| # | Scenario | Expected |
|---|---|---|
| 1 | Open class record, current term | Loads, scores/PS/WS/Initial/Final all render |
| 2 | Edit one WW cell, tab away | Optimistic update, ONE POST, no full GET, value persists after F5 |
| 3 | Edit PT + QA cells | Same as 2 |
| 4 | Enter score > MAX | Rejected, prev value restored, cell flagged, error toast |
| 5 | Enter `A`, then `E` in a cell | Saved with status; highlight renders (5.4); persists after refresh (F21 fix) |
| 6 | Change HPS (MAX) | ONE batch request, applies class-wide, totals/PS update |
| 7 | Add task (+), remove task (−) | Counts change, batch save, meta arrays stay aligned |
| 8 | Column meta editor: set description + date, Apply | One batch request, all students updated |
| 9 | Bulk assessment details panel: Save All | One batch request |
| 10 | Clear Scores (click twice, confirm) | Clears term, success message |
| 11 | Switch to past term | View-only banner, inputs disabled, edit-request button available |
| 12 | Submit edit request | Pending badge; approve as admin → countdown shows; edits allowed; after expiry reverts to view-only |
| 13 | Rotating subject (`rotationTermRank` set) | Term selector locked to that term |
| 14 | Gendered toggle | Male/female groups render, numbering continuous |
| 15 | Mobile viewport (<1024px) | Mobile list + per-student editor; term selector; A/E entry |
| 16 | Tour | Opens on desktop, highlights all `tutorial-*` targets; mobile warning dialog on small screens |
| 17 | Transmutation consistency | As admin, customize a transmutation row → ledger Final, stats average, and mobile grade all use the custom table |
| 18 | Dark mode | Entire page legible; ledger tokens switch |
| 19 | Backend stopped | Error states, no crash; recovery on restart |
| 20 | Batch fallback | Simulate 404 (rename route temporarily) → per-student fallback saves still work |
| 21 | Keyboard flow | Enter in a cell commits and focuses the same column next row |
| 22 | Dropped student in class | Batch save reports them in `skipped`, others saved |

### Definition of done
All commands green; all 22 scenarios pass; `ClassRecordView.tsx` < 600 lines; no file
> 1000 lines; AGENTS.md token exception documented; final commit.

---

## 14. Rollback strategy

One commit per phase → `git revert` the phase commit. Phases are ordered so the
riskiest-to-revert (Phase 2 backend, Phase 3 data layer) are independently revertible:
the batch endpoint has zero callers if the frontend commit is reverted, and the
React Query provider is inert for pages that don't use hooks.

## 15. Out of scope (do not do)

- Any other page (including `ClassRecordsList`, `StudentGradeProfile`)
- `ClassRecordTour.tsx` redesign (744 lines — only fix imports if they break)
- Prisma schema changes, migrations, seed changes
- EnrollPro/ATLAS sync code, SSE manager
- Global `any` cleanup outside this module family
- Replacing the uncontrolled-input ledger with controlled inputs (the `dataUpdatedAt`
  key technique is the chosen approach; controlled inputs are a future option)
- Removing the DepEd fallback transmutation table (it is the correct offline default)

## 16. Key risks for the implementer

1. **Lock-check parity in the batch endpoint** — the #1 way this could break the
   system is a lock check that behaves differently from `POST /grades/grade`.
   Copy the guards, don't re-interpret them. The Phase 2.4 tests exist to prove parity.
2. **Background refetch vs. uncontrolled inputs (F4)** — if you skip 3.4, cells will
   silently show stale values. The mitigation is mandatory, not optional.
3. **F21 schema change** — verify with the test BEFORE changing `scoreItemSchema`;
   if for any reason it is confirmed not stripping, leave the schema alone and
   simply include the optional fields in the batch schema only.
4. **Sticky-offset math** — the header stack measurement chain
   (`topNavHeight → ledgerHeaderHeight → metaEditorHeight → assessmentDetailsHeight`)
   is fragile. `useElementHeight` must preserve the exact enable/disable conditions
   (`showAssessmentDetails`, `selectedColumn`, `classAssignment?.id` deps) or the
   sticky columns will drift.
