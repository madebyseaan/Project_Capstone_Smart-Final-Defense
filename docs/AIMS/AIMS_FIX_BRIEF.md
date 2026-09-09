# AIMS FIX BRIEF — Final Punch & Final Sweep

> **FOR THE IMPLEMENTER (workhorse).** A full code review of your AIMS integration was
> completed against `AIMS_INTEGRATION_PLAN.md`. The skeleton is solid — schema, sync step,
> route guards, ledger column invariant (`wwCount + ptCount + 14 + aimsCount` verified in
> every row type), append-only import, snapshot/audit — all correct.
>
> **But the review FOUND BUGS.** Three are critical (one is silent data loss, one is a live
> TypeScript compile error), plus missing plan items and tree-hygiene problems. This brief
> is the complete punch list. Fix everything in the priority order given.
>
> Reference: `AIMS_INTEGRATION_PLAN.md` (original plan) · `AIMS-PUBLIC-API.md` (AIMS API).
> The reviewer did NOT modify any files — everything below is unfixed as written.

---

## ⛔ PROTECTED — DO NOT TOUCH (read this first)

1. **`src/pages/LoginPage.tsx`, `src/pages/AdminLoginPage.tsx`, `src/pages/RegistrarLoginPage.tsx`**
   — These contain the OWNER's latest cosmetic updates (login background pattern/gradients).
   **Do not edit, do not revert, do not "fix", do not reformat, do not stage them.** They are
   intentionally NOT part of the AIMS work. Leave the working-tree diffs exactly as they are
   and keep them out of your commits (`git add` only the files you actually change — never
   `git add -A` / `git add .`).
2. **`server/backup-duplicates-2026-09-07T13-40-21-491Z.json` and
   `server/backup-duplicates-2026-09-07T13-50-25-421Z.json`** — pre-existing untracked files.
   Do not delete, do not commit. Ignore them.
3. **`server/.env` / `.env.*`** — never modify (AGENTS.md non-negotiable). `AIMS_API_KEY` is
   added by the owner.

**Commit discipline:** the AIMS fix work goes in commit(s) containing ONLY the files listed
in the manifest at the bottom. Anything not in the manifest (especially the login pages)
stays unstaged.

---

## P0 — CRITICAL BUGS (fix these first, before anything else)

### P0-1. Stale sweep silently deletes ALL synced scores (DATA LOSS)

**Where:** `server/src/lib/aimsScoreSync.ts:162-175` and `:260-275`.

**The bug:** `currentAssessmentIds` is populated only AFTER a row passes term-binning
(:175). Rows that can't be binned (`gradedAt` null → :167, or outside term windows →
:170-173) never register their `assessmentId`. The stale sweep (:261-275) then deletes
non-imported rows whose `assessmentId` is `notIn` that set.

**Two concrete loss scenarios (verified):**
- **Term dates unconfigured** — `binTerm` returns `null` for everything
  (`aimsScoreSync.ts:50-52`, normal at BOSY) → `currentAssessmentIds` is EMPTY →
  **every non-imported AimsScore row for every linked course is deleted on every 5-minute
  cycle**. The sync writes rows, the sweep erases them, forever.
- **Late retake** — an assessment whose T2 attempt synced fine, then a retake is graded
  after `t3EndDate` → dedup keeps the unbinned retake → its `assessmentId` never registers →
  the previously synced T2 row is swept.

**Fix:** build the sweep key-set from ALL deduped rows, before/independent of binning:

```ts
// aimsScoreSync.ts — replace :162-175 block
const dedupedRows = dedupLatestAttempt(validData.rows);

// Sweep membership = every assessmentId present in the current pull (deduped),
// regardless of binning outcome. Binning only decides WHERE a row lands, not
// whether it still exists upstream.
const currentAssessmentIds = new Set(dedupedRows.map(r => r.assessmentId));
let unbinnedCount = 0;

for (const row of dedupedRows) {
  // ... rest of loop unchanged (gradedAt check, binTerm, unmatched, upsert)
}
```

Keep the sweep deletion predicate otherwise as-is (`importedAt: null` guard is correct).

**Add regression test (see P1-5):** sync with term dates unset must NOT delete rows; late
retake must not sweep the earlier binned row.

### P0-2. TypeScript compile error — tour step lost its `id`

**Where:** `src/pages/teacher/components/ClassRecordTour.tsx:216-217`.

**The bug:** inserting the `aims-columns` step (:200-215) took over the `id: "cell-example"`
property — the NEXT step ("How Grading Works", target `tutorial-cell-example`) now has **no
`id`**. Verified live error: `error TS2741: Property 'id' is missing in type ... but required
in type 'TourStep'`. Knock-ons: `key={s.id}` becomes `undefined` (React key warning, :749)
and the placement branch `step.id === "cell-example"` (:496) never matches, so that step
loses its right-side positioning.

**This shipped silently because `npm run build` is vite-only (no tsc) — meaning no
typecheck was run.** Fix the step AND run the verification gates in P1-6.

**Fix:**
```ts
// ClassRecordTour.tsx:216 — restore the id
{
  id: "cell-example",          // ← add this line back
  targetId: "tutorial-cell-example",
  title: "How Grading Works",
  ...
```

### P0-3. Import can overwrite archived grades (missing per-student guard)

**Where:** `server/src/routes/grades-sub/aims.ts:316-330` (import transaction loop).

**The bug:** the guard chain checks `isArchived` only via ONE sampled grade row (:265-271).
The batch path you were told to clone has a **per-student** check —
`classes.ts:654-657`:
```ts
if (existing?.isArchived) {
  skipped.push({ studentId: update.studentId, reason: "Grade is archived" });
  return false;
}
```
Post-rollover classes can have MIXED archived/non-archived grades; if the sampled grade is
non-archived, the import rewrites archived (finalized-year) grades for other students.

**Fix:** inside the per-student loop in `grades-sub/aims.ts`, after the FINALIZED check
(:327), add:
```ts
if (existingGrade?.isArchived) { archivedSkipped++; continue; }
```
Track `archivedSkipped` alongside `finalizedSkipped` and include it in the response's
`skipped` object (frontend type update accordingly — see P2-9).

---

## P1 — HIGH (correctness + required-by-plan)

### P1-1. `enrollproId` backfill is broken in two ways

**Where:** `server/src/lib/enrollproSync.ts:642-643`, `:456-463`, `:571-577`;
`server/src/lib/sync/utils.ts:56-107`.

**Bug A — dead guard.** The "only when null" guard reads a field that is never fetched:
`enrollproId` is absent from the pre-fetch select (:456-463) and the fallback `findUnique`
select (:571-577), so `(existing as any).enrollproId` is always `undefined` → condition
always true → written on every hash-changed update, and it would silently overwrite a
changed EnrollPro ID.
**Fix A:** add `enrollproId: true` to BOTH select objects; keep the `== null` spread guard.

**Bug B — unchanged students never backfill.** Backfill only piggybacks on
hash-changed updates; students whose profile hash didn't change and whose `enrollproId`
is null are skipped forever. The plan promised "first full cycle after deploy backfills
the column."
**Fix B:** add a dedicated backfill pass at the END of the student sync (after the
update/create loops), using the already-built `lrnToEpStudentId` map (:489-497 — currently
dead code, this wires it in):
```ts
// after the student loop, before enrollment upserts (or right after the loop)
let backfilled = 0;
const nullEpStudents = await prisma.student.findMany({
  where: { enrollproId: null, lrn: { in: Array.from(lrnToEpStudentId.keys()) } },
  select: { id: true, lrn: true },
});
for (const s of nullEpStudents) {
  const epId = lrnToEpStudentId.get(s.lrn);
  if (epId == null) continue;
  await prisma.student.update({ where: { id: s.id }, data: { enrollproId: epId } }).catch(() => {});
  backfilled++;
}
if (backfilled > 0) logger.info(`[EnrollProSync] Backfilled enrollproId for ${backfilled} students`);
```
**Also:** add the update-when-null backfill to `sync/utils.ts` `upsertLearner` (create path
already writes it at :106) — add `enrollproId` to the update branch with the same null-guard.

### P1-2. AIMS payload consumed unvalidated in the link route (zod missing at the client boundary)

**Where:** `server/src/lib/aimsClient.ts:155-156` (cast, no `safeParse`);
`server/src/routes/grades-sub/aims.ts:144` (`let scoresData: any`).

**Fix:** validate inside `getAimsPublicScores` with `aimsPublicScoresSchema` (it exists in
`server/src/schemas/aims.ts` and is currently only used in the sync) — return a typed
result or throw a typed error; then the link route consumes validated data and can drop
the `any`. Also: `aimsCourseSummarySchema` (`schemas/aims.ts:61-71`) is currently DEAD —
use it in `getAimsPublicCourses` (P2-6) or delete it.

Also fix in the link route: an unconfigured AIMS key (`AimsError` 503) currently becomes a
generic 500 (`aims.ts:185-188`) — catch it and return
`503 { message: "AIMS integration not configured (EXTERNAL_API_KEY missing on AIMS)." }`.

### P1-3. Missing Prisma migration

**Where:** `server/prisma/migrations/` — latest is `20260908000000_atlas_applied_version`;
the schema edits (`Student.enrollproId`, `ClassAssignment.aimsCourseId`, `AimsScore` model)
have NO migration. Migrated deployments get drift errors and no table.

**Fix:**
```bash
cd server
npx prisma generate
npx prisma migrate dev --name add_aims_integration
```
Verify the generated SQL is additive only (two `ALTER TABLE ... ADD COLUMN` + one
`CREATE TABLE "AimsScore"` with the unique/index constraints) — nothing destructive.
**Commit the generated migration folder.**

### P1-4. Un-memoized EnrollPro live fallback (N× API calls per cycle)

**Where:** `server/src/lib/aimsScoreSync.ts:184-198` — `getEnrollProStudentDetail` is
called per ROW. A student with 15 assessments and no local match = 15 live EnrollPro calls
+ 15 backfill attempts, every course, every 5 minutes.

**Fix:** per-run `Map<number, ...>` cache before the row loop:
```ts
const epResolveCache = new Map<number, { studentId: string } | null>();
// inside the !student branch:
if (!epResolveCache.has(row.enrollproId)) {
  let resolved: { studentId: string } | null = null;
  try {
    const epDetail = await getEnrollProStudentDetail(row.enrollproId);
    if (epDetail?.lrn) {
      const found = await prisma.student.findUnique({ where: { lrn: epDetail.lrn }, select: { id: true } });
      if (found) {
        await prisma.student.update({ where: { id: found.id }, data: { enrollproId: row.enrollproId } }).catch(() => {});
        resolved = found;
      }
    }
  } catch { /* stays unmatched */ }
  epResolveCache.set(row.enrollproId, resolved);
}
const cached = epResolveCache.get(row.enrollproId);
if (cached) student = cached;
```

### P1-5. No tests (plan §9 required them)

**Where:** NEW `server/src/__tests__/aims-sync.test.ts`. The runner is **vitest**
(`npm run test` in `server/` = `vitest run`) — follow the style of the existing
`server/src/__tests__/*.test.ts` files. Cover at minimum:

1. `binTerm`: null dates → null; before/after each boundary; after all end dates → null.
2. `dedupLatestAttempt`: higher `attemptNumber` wins; tie → later `gradedAt`; null
   `gradedAt` skipped.
3. **Sweep regression (P0-1):** term dates unset → no rows deleted; late retake → earlier
   binned row retained; imported rows never swept.
4. **Import guard chain (P0-3):** archived grade row → skipped, not overwritten;
   FINALIZED → skipped; `importedAt` idempotency (second import = no new score items);
   append-only (existing items preserved).
   (Mock prisma + external calls the same way existing tests do.)

### P1-6. No typecheck/build/lint was run (the tour error proves it)

Run ALL of these and make them green before declaring done:
```bash
cd server && npx tsc --noEmit && npm run build && npx prisma generate
cd .. && npx tsc -p tsconfig.app.json --noEmit   # tour error must be gone
npm run build && npm run lint
cd server && npm run test
```
Note: `npm run build` at the root is vite-only — **tsc is a separate gate**, always run it.

---

## P2 — MEDIUM (plan violations / missing plan items)

### P2-1. Link triggers a full AIMS sync of ALL courses

**Where:** `server/src/routes/grades-sub/aims.ts:180-182` — calls `runAimsScoreSync()`
(syncs every linked course). Plan §5.7: per-course only.
**Fix:** export a single-course variant from `aimsScoreSync.ts`
(e.g. `syncAimsScoresForAssignment(classAssignmentId: string)`) and fire-and-forget that.

### P2-2. Course metadata becomes "Unknown" after restart / cache TTL

**Where:** `server/src/routes/grades-sub/aims.ts:61` (reads `syncCache`
`aims:course:<id>`, 1h TTL, in-memory) + `:112` (falls back to a stub without refetching).
**Fix:** on cache miss, refetch via `getAimsPublicScores(aimsCourseId)` (validated,
P1-2) and re-populate the cache before responding — degrade to the stub only if the
refetch fails. While there: **stop hardcoding `weights: null`** (:113) — return the
weights from the same payload (needed by P2-8).

### P2-3. `?term=` query param unvalidated

**Where:** `server/src/routes/grades-sub/aims.ts:38, 64` — `?term=garbage` hits the Prisma
enum → 500 instead of 400.
**Fix:** validate against `['T1','T2','T3']`, else `400 { message: "Invalid term" }`.

### P2-4. Frontend Phase 2 gaps — three untouched files (plan §6.7-6.8)

Implement now (they were in scope):
- **`ClassRecordHero.tsx`** — badge row (after the `Section ...` span, ~:53): when linked,
  cyan pill `AIMS · {course.code}` (title attr = course name + last synced); when unlinked
  and AIMS data exists, a subtle "Link AIMS Course" button that opens the AimsPanel link
  dialog. One optional prop. **Do not touch anything else in the file.**
- **`ClassRecordMobileList.tsx`** — after the TA chip (~:107): when `aimsCount > 0`, two
  read-only chips `AIMS WW` / `AIMS PT` (category averages), `text-[var(--ledger-aims)]`.
  Thread the data through new optional props from `ClassRecordView.tsx` (:319).
- **`GradeEditModal.tsx`** — **do NOT add a 4th tab** (the `"WW" | "PT" | "QA"` union
  ripples through `useMobileEditor`). Add a read-only "AIMS (read-only)" info block ABOVE
  the tabs (~:71): label/value rows per assessment. New optional prop from
  `ClassRecordView.tsx` (:323).

### P2-5. Tour doesn't skip when the class has no AIMS columns

**Where:** `src/pages/teacher/components/ClassRecordTour.tsx`.
**Fix:** accept a new optional prop (e.g. `hasAimsColumns?: boolean`) from
`ClassRecordView.tsx` (pass `aimsAssessments.length > 0`); filter `TOUR_STEPS` before
computing step index/dots (both already derive from the array length, so filtering is
safe). Unlinked classes must not see the AIMS step.

### P2-6. No course picker (plan §6.5: "picker behind the fallback from day one")

Manual UUID entry exists; the picker does not, and `getAimsPublicCourses` +
`AimsCourseSummary` are dead code.
**Fix:**
- Backend: NEW `GET /grades/aims-courses` (TEACHER, ownership n/a — it's a list call) in
  `grades-sub/aims.ts`: calls `getAimsPublicCourses(<teacher user email from JWT>)`,
  validates with `aimsCourseSummarySchema`, returns `{ courses }`. AIMS hasn't shipped
  `/public/courses` yet → client returns `[]` on 404 → endpoint returns an empty list, UI
  falls back to manual-only. Zero-risk.
- Frontend: `gradesApi.getAimsCourses()`; in the AimsPanel link dialog render the list
  (code, name, subject, gradeLevel, sectionName, schoolYear) when non-empty, radio-select,
  plus the existing manual-ID input ALWAYS visible as the fallback.

### P2-7. Link warnings are a vanishing toast (plan §6.5: persistent amber + confirm)

**Where:** `src/pages/teacher/components/AimsPanel.tsx:53-54`.
**Fix (server + client):**
- Server: add `warnings: string[]` to the GET `/aims-scores` response, recomputed the same
  way as the link route (schoolYear / sectionName / subject mismatch, case-insensitive) —
  this makes them persistent across reloads, not just a link-time flash.
- Client: render them as an amber inline block in AimsPanel (semantic tokens — see P2-9).
  On link, if the response carries warnings, show a confirm-style dialog ("Link anyway?")
  BEFORE finalizing.

### P2-8. AimsPanel raw palette classes (AGENTS.md violation + breaks dark mode)

**Where:** `src/pages/teacher/components/AimsPanel.tsx:131` (`border-slate-300 bg-white` —
also renders a white card in dark mode), `:132` (`bg-cyan-50 text-cyan-700` — the ledger
token exists and is used elsewhere in the same file), `:189` (amber offline badge),
`:217-230` (amber unmatched block).
**Fix:** swap to semantic tokens (`bg-card`, `text-foreground`, `text-muted-foreground`,
`bg-destructive/10`, `border-border`) and the sanctioned `var(--ledger-aims)` tokens for
AIMS-colored elements. `ClassRecordTour.tsx:206` and `ClassRecordTable.tsx:436`
(`text-slate-300`) may stay — both exact strings were specified by the plan and match
sibling patterns.

### P2-9. Import UX edge cases

**Where:** `AimsPanel.tsx:261, 268`.
- **"Any-student-imported" bug:** an assessment is marked Imported and its checkbox
  disabled if ANY student's row has `importedAt` — so a late-enrolled student's newly
  synced score can never be imported from the UI (the server would allow it; its check is
  per-student at `aims.ts:329-330`). **Fix:** since server-side re-import is idempotent
  per student, stop disabling the checkbox — replace the badge with
  "Imported — re-run adds newly synced scores" and always allow re-selection.
- **`skipped.notFound`** from the import response is never displayed (:83-85) — surface it
  (and the new `archived` count from P0-3) in the result toast/summary.
- **Unlink is not gated by `isViewOnly`** (:208) while Import is — gate it the same way
  (`disabled={isViewOnly}`).

### P2-10. Duplicated inline AIMS types + dead export

**Where:** the row/assessment/unmatched shapes are inlined 4× (`api.ts:508-537`,
`AimsPanel.tsx:26-31`, `ClassRecordTable.tsx:132-133, :491-492`); `AimsCourseSummary`
(`api.ts:539-548`) is exported but never imported.
**Fix:** extract named `AimsAssessmentInfo`, `AimsRowScore`, `AimsUnmatchedStudent` in
`api.ts` (plan §6.2 required them), import everywhere; `AimsCourseSummary` gets used by
P2-6 (keep it). Add the `archived` skip count to the import response type (P0-3).

---

## P3 — MINOR POLISH (do if time allows; safe to defer with a note)

1. **`checkAimsHealth` uses raw `fetch`** (`aimsClient.ts:129-131`) instead of `httpGet` —
   if `AIMS_URL` ever becomes https-on-Tailscale, health reports DOWN while scores sync
   fine (httpGet has `rejectUnauthorized: false`). Switch to `httpGet`.
2. **Dead `lrnToEpStudentId` map** (`enrollproSync.ts:489-497`) — P1-1 wires it in; if you
   implement P1-1 differently, DELETE the map instead of leaving it dead.
3. **SyncHistory doesn't persist the AIMS result** (memory + SSE only) — acceptable;
   plan wanted a note. Optional: log line is enough.
4. **Log cosmetics** in `syncCoordinator.ts`: "Step 5/5" vs step 4 still saying "Step 4/4".
5. **Assessment ordering** (`grades-sub/aims.ts:78-81`) — plan wanted `gradedAt`-of-first-
   appearance before title; current is title-only. Cosmetic.
6. **`quarterlyAssessMax ?? 100`** (`aims.ts:340`) vs `|| 100` in `classes.ts:689` — a
   stored max of `0` behaves differently. Align to `||` semantics.
7. **`schemas/integration.ts` is an empty husk** (zero exports after `aimsAuthSchema`
   removal) — either delete the file + its import, or leave a comment. Nothing imports it.
8. **`AimsPanel` import list is flat** instead of grouped WW/PT — acceptable deviation,
   keep unless trivial to group.

---

## Definition of Done — verification gates (ALL must pass)

```bash
# Backend
cd server
npx prisma generate
npx prisma migrate dev --name add_aims_integration   # migration folder committed
npx tsc --noEmit
npm run build
npm run test                                          # vitest — includes new aims-sync tests

# Frontend
cd ..
npx tsc -p tsconfig.app.json --noEmit                 # TS2741 in ClassRecordTour must be GONE
npm run build
npm run lint
```

**Manual smoke (once `AIMS_API_KEY` is in `.env` and AIMS is reachable):**
1. Link a course → `AimsScore` rows persist across ≥ 2 sync cycles (P0-1 proof: rows are
   NOT swept when term dates are unconfigured).
2. Ledger renders cyan rightmost group; HPS row shows `—`; gender separator spans align;
   Enter-key nav skips AIMS cells; tour runs clean with and without AIMS columns.
3. Import on current term → appends items, PS/initial/final recompute, snapshot + audit
   rows exist, re-import is a no-op (alreadyImported).
4. Import on a past term without an APPROVED edit request → 403; with one → succeeds.
5. A class with an archived grade mixture → import skips archived students (P0-3).
6. Dark mode: AimsPanel renders correctly (P2-8), tokens resolve.
7. AIMS down / wrong key → sync step skips, SMART endpoints still 200, panel shows
   offline + last synced.
8. `git status` — login pages still modified but UNSTAGED; no AIMS commit contains them.

---

## Fix manifest (files you will touch — nothing else)

| File | Fixes |
|---|---|
| `server/src/lib/aimsScoreSync.ts` | P0-1, P1-4, (P2-1 export) |
| `src/pages/teacher/components/ClassRecordTour.tsx` | P0-2, P2-5 |
| `server/src/routes/grades-sub/aims.ts` | P0-3, P1-2 (link 503), P2-1, P2-2, P2-3, P2-6 (backend), P2-7 (warnings in GET) |
| `server/src/lib/enrollproSync.ts` | P1-1 |
| `server/src/lib/sync/utils.ts` | P1-1 |
| `server/src/lib/aimsClient.ts` | P1-2, P2-6 (courses fn), P3-1 |
| `server/prisma/migrations/<ts>_add_aims_integration/` | P1-3 (generated) |
| `server/src/__tests__/aims-sync.test.ts` | P1-5 (NEW) |
| `src/lib/api.ts` | P2-6, P2-10 (named types, getAimsCourses, archived skip type) |
| `src/pages/teacher/components/AimsPanel.tsx` | P2-6, P2-7, P2-8, P2-9 |
| `src/pages/teacher/components/ClassRecordHero.tsx` | P2-4 (badge only — touch nothing else) |
| `src/pages/teacher/components/ClassRecordMobileList.tsx` | P2-4 (chips) |
| `src/pages/teacher/components/GradeEditModal.tsx` | P2-4 (read-only block, NO 4th tab) |
| `src/pages/teacher/ClassRecordView.tsx` | P2-4, P2-5, P2-6, P2-10 (prop threading) |
| `server/src/schemas/aims.ts` | P1-2 (use or remove dead schema) |
| `server/src/schemas/integration.ts` | P3-7 (optional delete) |
| `server/src/lib/syncCoordinator.ts` | P3-4 (log cosmetics only) |

**Explicitly NOT in the manifest:** the three login pages, `server/.env`, the two
`backup-duplicates-*.json` files, and `AIMS_*.md` docs.
