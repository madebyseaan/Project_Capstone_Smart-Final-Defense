# Term Finalization — Rotation UX Fix & Anti-Regression Plan

**Date:** 2026-11-18
**Status:** EXECUTED — all gates green (see `artifacts/term-finalization-rotation/final/EXECUTION-REPORT.md`)
**Defense:** Thursday — freeze all changes after the FINAL gate passes.
**Scope owner:** Registrar Term Finalization (`/registrar/term-finalization`)
**Related docs:** `docs/GRADE_PIPELINE_ALIGNMENT_FIX_PLAN_2026-11-16.md`, `docs/DEPLOYMENT_RUNBOOK.md`

---

## 0. Freeze rule (non-negotiable)

1. No schema changes, no Prisma migrations, no seed changes, no data repair in this plan.
2. No changes to promotion, EOSY, SF9, SF10, advisory, or the `student-grades` preview endpoint.
3. Every step is gated. A red gate stops the step; do not proceed.
4. If the FINAL gate is not fully green before the freeze cutoff, revert to the last known-good commit and defend the current build. Do not ship a partial fix.
5. Never run `pm2 restart all`. Restart `server` and `client` individually.
6. After deployment, no further code edits unless a gate fails. Any fix requires a new commit + full gate rerun.

**Defense timeline:**

| When | Action |
|---|---|
| Wed before cutoff | Step 0 → Step 5, all gates, deploy, smoke test |
| Wed freeze | No code changes after FINAL gate + PM2 soak |
| Thu morning | Re-run PM2 health + targeted Playwright only (no code changes) |
| If Thu smoke fails | Roll back immediately (Section 11), then re-run smoke |

---

## 1. Problem

Term Finalization shows rotation components (`Science - Biology`, `Science - Chemistry`, `Science - Earth Science`) as one grouped row labelled `Science 7`, but:

- The UI prints every component code in the subtitle:
  `Science 7 · SCI_BIO7, SCI_CHEM7, SCI_ES7`
  (`src/pages/registrar/components/TermFinalizationSectionCard.tsx:350-352`, `:409-411`).
- The overview counts every rotation component that has grades in the selected term:
  `server/src/lib/termFinalization.ts:303-336` (no `rotationTermRank` check).
- Therefore Aguinaldo and Bonifacio show `Science 7 — 15 drafts` in **T1, T2, and T3**, even though the curriculum offers only:
  - T1 = `SCI_BIO`
  - T2 = `SCI_CHEM`
  - T3 = `SCI_ES`
- Clicking **Finalize** on that row sends all component `subjectIds`, so it can finalize out-of-term Science grades (`termFinalization.ts:562-585`).
- The **View grades** preview already does this correctly: single-term mode selects the component whose `rotationTermRank` matches the term and merges it into one `Science` column (`server/src/routes/registrar/main.ts:1869-1893`). The list and the preview disagree.

**Observed (current DB, SY 2026-2027, all `DRAFT`):**

| Section | Program | T1 | T2 | T3 |
|---|---|---|---|---|
| Aguinaldo | REGULAR 7 | 8 rows / 50 drafts / Science 15 | same | same |
| Bonifacio | STE 7 | 10 rows / 60 drafts / Science 15 | same | same |

`Environmental Science 7` and `Research 7` are **not** rotation subjects. They correctly appear in all three terms.

**Out of scope:** BEC/ETC program scoping, seed cleanup, and the fact that the demo seed currently creates grades for all three Science components in all three terms. This plan makes the page correct regardless of that data.

---

## 2. Decisions (recorded)

| ID | Decision | Rationale |
|---|---|---|
| D1 | Term Finalization selects **only the term-ranked rotation component** (`rotationTermRank === termIndex`). | Matches ATLAS metadata, the preview endpoint, advisory, promotion, SF9/SF10 rules. |
| D2 | Registrar sees **one learning-area row** (`Science 7`) with the **human-readable term branch** (`Science - Biology 7`) and its **selected component code** (`SCI_BIO7`). | Registrar needs both the strand name and the exact code; only the selected term's component is shown. |
| D3 | If a rotation group has no component for the selected term, fall back exactly like the preview: first component with grades, else the first sorted component. | Prevents "No grades" phantom rows on legacy/incomplete metadata. |
| D4 | Finalize/Unfinalize filters rotation assignments by the selected term **server-side**, even when `subjectIds` comes from a stale tab. | Old UI payloads must not flip out-of-term strands. |
| D5 | Do **not** repair or delete the existing out-of-term grades in this change. | Data cleanup is separate; changing grades before defense adds risk. |
| D6 | Do **not** modify `GET /registrar/student-grades/:sectionId/:term` (preview). Use it as the parity oracle. | It is already correct; touching it is unnecessary risk. |

---

## 3. Desired behavior contract

| Surface | Before | After |
|---|---|---|
| Subject row name | `Science 7` | `Science 7` (unchanged) |
| Subject subtitle | `Science 7 · SCI_BIO7, SCI_CHEM7, SCI_ES7` | `Science 7` plus the term branch and its code (`Science - Biology 7 · SCI_BIO7`, etc.) |
| T1 Science drafts | 15 | 5 (SCI_BIO only) |
| T2 Science drafts | 15 | 5 (SCI_CHEM only) |
| T3 Science drafts | 15 | 5 (SCI_ES only) |
| Aguinaldo total drafts | 50 per term | 40 per term |
| Bonifacio total drafts | 60 per term | 50 per term |
| Env Sci / Research | 5 each term | unchanged |
| Science row Finalize | sends 3 subjectIds | sends only the term's component ID |
| Non-rotation subjects | unchanged | unchanged |
| Preview endpoint values | correct | unchanged |

Expected post-fix per term:

```text
Aguinaldo REGULAR 7: 8 subject rows, 40 draft grades (7 x 5 + Science 5)
Bonifacio STE 7:    10 subject rows, 50 draft grades (9 x 5 + Science 5)
Science row:        T1 = SCI_BIO7 (5), T2 = SCI_CHEM7 (5), T3 = SCI_ES7 (5)
```

---

## 4. Implementation steps

### Step 0 — Baseline and safety net (no behavior change)

**Files:** none

1. Confirm branch and clean tree:
   ```powershell
   git status
   git switch -c fix/term-finalization-rotation
   ```
2. Create artifact directory:
   ```powershell
   New-Item -ItemType Directory -Force artifacts\term-finalization-rotation\pre | Out-Null
   ```
3. Capture current behavior (read-only) for Aguinaldo and Bonifacio T1/T2/T3 using the existing dev server:
   - Playwright screenshots / count list, or the read-only overview helper.
   - Save to `artifacts/term-finalization-rotation/pre/`.
4. Capture PM2 baseline:
   ```powershell
   npx pm2 status
   npx pm2 logs server --lines 200 --nostream > artifacts\term-finalization-rotation\pre\pm2-baseline.log
   ```
5. Run baseline gate G0 (Section 6) and record any pre-existing failures explicitly.

**Exit criteria:** baseline captured; no pre-existing failure is in scope; tree clean except intended branch.

---

### Step 1 — Backend: term-aware rotation selection in the overview

**File:** `server/src/lib/termFinalization.ts`

**Changes:**

1. Add a pure helper (export for tests if useful):
   ```ts
   function termIndexNumber(term: TermName): number {
     return Number(term.slice(1)); // T1 -> 1
   }
   ```
2. Group rotation class assignments per section + `rotationTermGroupId` before building the grouped map.
3. For each rotation group, select the representative **once**:
   - Prefer `subject.rotationTermRank === termIndex`.
   - Else prefer a component with at least one grade for the selected term.
   - Else fall back to the lowest `rotationTermRank` / first sorted component.
   - This mirrors `main.ts:1869-1875` (preview oracle).
4. Include **only the selected component's class assignment(ies)** in the grouped row.
   - `subjectIds` = selected component ID(s) only.
   - `subjectCodes` = selected component code(s) only (diagnostics); the UI will hide them for rotation groups.
   - `draft` / `finalized` / `total` count only selected component grades for the selected term.
5. Add `rotationGroupId: string | null` to `TermFinalizationSubject`:
   - `row.rotationGroupId` set for rotation groups, `null` for standalone subjects.
6. Keep all existing exclusions and behavior:
   - `HG` skipped (`:304`).
   - Inactive assignment with zero total grades skipped (`:308`).
   - Grouping by `getBaseSubjectName()` retained.
   - Non-rotation subjects unchanged.
   - No change to year lock, EOSY flags, `canFinalize`, summary aggregation semantics.

**Expected result:** T1/T2/T3 overview returns Science 5 with only the term's component ID.

**Gate:** G0 + G1 (backend focused tests) + G2 (build) + G3 (PM2) after implementation.

---

### Step 2 — Backend: term-aware finalize/unfinalize

**File:** `server/src/lib/termFinalization.ts`

**Changes:**

1. Add a helper that filters a section's class assignments to term-appropriate rotation components:
   - Standalone subjects always kept.
   - For each rotation group, keep only the selected component (same selection as Step 1).
2. Apply it in `finalizeSectionTerm` and `unfinalizeSectionTerm`:
   - When `subjectIds` is omitted: filter the section's assignments by term before building `classAssignmentIds`.
   - When `subjectIds` is provided: intersect with the term-appropriate set. Stale callers sending all three IDs finalize only the valid term component.
3. Keep response shape unchanged. `subjectCount` and counts reflect the filtered set.
4. Do not add new error codes for defense unless a test proves the current `NO_ASSIGNMENTS` path is insufficient. Prefer the existing behavior.
5. Add audit-log text unchanged (it already reports finalized count).

**Must-not-change:**
- EOSY-finalized guard.
- Archived-year/section guards.
- Lock flags and response fields.
- No EOSY snapshots, promotion status, or grade value changes.

**Gate:** G1 + G2 + G3 after Step 2.

---

### Step 3 — Frontend: show term branch, hide rotation codes

**Files:**
- `src/lib/termFinalizationTypes.ts`
- `src/pages/registrar/components/TermFinalizationSectionCard.tsx`

**Changes:**

1. Add `rotationGroupId: string | null` and `rotationSubjectName: string | null` to `TermFinalizationSubject`.
2. In the desktop and mobile subject subtitle:
   - Render the `subjectCodes` suffix only when `!subject.rotationGroupId`.
   - Rotation group row shows the human-readable term branch and the selected component code (`Science - Biology 7 · SCI_BIO7`).
3. Do not change row grouping, actions, status badges, or counts.
4. Add stable test attributes for the E2E gate:
   - Row: `data-subject-name={subject.subjectName}`, `data-rotation-group={subject.rotationGroupId ?? ""}`.
   - Branch: `data-testid="term-finalization-subject-branch"`.
   - Codes line: `data-testid="term-finalization-subject-codes"` (render only when codes are shown).
   - Draft cell: `data-testid="term-finalization-subject-draft"`.
   - Mirror required attributes on the mobile row.

**Expected visible result:** `Science 7` with `Science - Biology 7` / `Science - Chemistry 7` / `Science - Earth Science 7` per term; no `SCI_*` text; counts 5 per term.

**Gate:** G2 + G3 + G4 after Step 3.

---

### Step 4 — Tests

**Files:**
- `server/src/__tests__/term-finalization.test.ts`
- `e2e/term-finalization.spec.ts`

**Backend cases (Vitest):**

1. Rotation overview selects only the term-ranked component:
   - Create a rotation group with ranks 1/2/3, same output label.
   - Create grades for **all three** components in **all three terms**.
   - Assert overview T1 includes one row for the group with `draft = 1` and `subjectIds = [rank1CA.subjectId]`.
   - Assert T2 → rank2, T3 → rank3; `rotationGroupId` is set; `subjectCodes` contains only the selected code.
2. Non-rotation subjects are unchanged (Env Sci/Research-style subject appears in every term with its own count).
3. Finalize section T1 flips only rank1 grades; rank2/rank3 grades remain `DRAFT`.
4. Unfinalize T1 reverts only rank1 grades.
5. Explicit `subjectIds` containing all three rotation components finalizes only the term-appropriate one (stale UI payload guard).
6. Existing contract tests remain green (single subject finalize, EOSY guards, archived year, preview).

**Playwright cases (read-only; never confirm finalize):**

1. Existing smoke test must remain green.
2. New term-switch test:
   - Login as registrar, open Term Finalization.
   - Find `Bonifacio` (STE 7). If absent, skip with a clear reason; do not silently pass.
   - Expand, then for each term T1/T2/T3:
     - Select the term in the Term combobox.
     - Locate `[data-subject-name="Science 7"]`.
     - Assert the row does **not** contain `SCI_BIO7|SCI_CHEM7|SCI_ES7`.
     - Assert `[data-testid="term-finalization-subject-draft"]` is `5`.
     - Assert `[data-testid="term-finalization-subject-codes"]` is absent in that row.
   - Assert section total drafts: Bonifacio 50 per term.
3. Repeat the same assertions for `Aguinaldo` (REGULAR 7): Science 5, total 40.
4. Preview parity:
   - Open View grades for the same section/term.
   - Assert exactly one `Science 7` subject card; no branch cards.
   - Assert no horizontal overflow (existing mobile test).
5. Every spec asserts `collectProblems(page)` is empty.

**Gate:** G1 + G4 after tests.

---

### Step 5 — Final verification, deploy, smoke

1. Run G6 (full verify + full Playwright).
2. Capture final PM2 logs and status.
3. Restart `server`, then `client` (frontend changed).
4. Run defense smoke on the deployed build:
   - Health 200.
   - Term Finalization T1/T2/T3 shows Science 5 for Aguinaldo and Bonifacio.
   - Term-specific branch name and code visible (`Science - Biology 7 · SCI_BIO7`, etc.).
   - View grades preview unchanged.
   - PM2 logs clean.
5. Freeze. No further code changes.

---

## 5. Anti-regression contract

### Allowed diffs (expected)

| Area | Allowed |
|---|---|
| Term Finalization subject rows | Rotation group rows (`Science`, `TLE Exploratory`) select one component per term; counts decrease by out-of-term components. |
| Term Finalization subtitle | Rotation group shows only the term branch and selected code. |
| Finalize/Unfinalize | Rotation groups only flip the selected term's component. |
| API shape | `TermFinalizationSubject.rotationGroupId` added; existing fields retained. |
| Tests | New rotation overview/finalize tests and new Playwright assertions. |
| Docs | This plan + any short implementation note. |

### Forbidden diffs (any = STOP, treat as regression)

- Any grade value change, status change on non-rotation subjects, or EOSY snapshot/promotion change.
- Any change to `GET /registrar/student-grades/:sectionId/:term` (preview) or its response.
- Any change to promotion/EOSY/SF9/SF10/advisory code.
- Schema/migration/seed/data writes or external system calls.
- Counts for non-rotation subjects changing.
- MORE than one rotation component included for a term.
- New console errors, API >= 400, or PM2 error lines.
- Files outside the planned list in `git diff --stat`.

### No-regression invariants

- `Aguinaldo`: 8 rows; 40 drafts per term; Science 5.
- `Bonifacio`: 10 rows; 50 drafts per term; Science 5; Env Sci 5; Research 5.
- T1/T2/T3 Science codes: `SCI_BIO7`, `SCI_CHEM7`, `SCI_ES7` respectively behind the scenes; never shown together.
- Preview: one `Science` column per term; values unchanged.
- HG remains hidden; inactive zero-grade assignments remain hidden; archived-year behavior unchanged.

---

## 6. Gates

Artifacts: `artifacts/term-finalization-rotation/<step>/`.
A step is complete only when all gates listed for it are green.

### G0 — Baseline gate

```powershell
git status
npx pm2 status
npx pm2 logs server --lines 200 --nostream > artifacts\term-finalization-rotation\pre\pm2-baseline.log
```

Pass: known baseline captured; no unexplained dirty files.

### G1 — Focused backend tests

```powershell
pnpm --prefix server exec vitest run src/__tests__/term-finalization.test.ts
```

Pass: all tests green, including every pre-existing test in the file. No skips inside the new rotation tests.

### G2 — Build, typecheck, lint

```powershell
pnpm run typecheck
pnpm run build
pnpm run lint
pnpm --prefix server run build
```

Pass: all exit 0; zero new ESLint errors; `TermFinalizationSubject.rotationGroupId` compiles on both sides.

### G3 — PM2 log gate (MANDATORY after every step)

```powershell
# 1. Capture current logs
npx pm2 logs server --lines 100 --nostream > artifacts\term-finalization-rotation\<step>\pm2-before.log

# 2. Restart ONLY the server
npx pm2 restart server --update-env

# 3. Health check (expect 200)
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health

# 4. Exercise the real read paths
#    - registrar Term Finalization T1/T2/T3
#    - View grades preview
#    Then capture logs again:
npx pm2 logs server --lines 300 --nostream > artifacts\term-finalization-rotation\<step>\pm2-after.log
```

Pass:
- `npx pm2 status` shows `server` and `client` `online`; no crash-restart loop.
- Health endpoint returns HTTP 200.
- `pm2-after.log` contains **zero new** lines matching:
  - `Error:`
  - `Unhandled`
  - `UnhandledPromiseRejection`
  - `PrismaClient` error blocks
  - `ECONNREFUSED` loops
  - HTTP 500 request lines
  - stack traces from `server/src`
- Any new error line is a gate failure. Fix it, restart, rerun the gate, attach logs to the PR/notes.

Restart the client only when the step touched frontend code:

```powershell
npx pm2 restart client --update-env
Invoke-WebRequest -UseBasicParsing http://localhost:5173
```

### G4 — Playwright gate (MANDATORY after every frontend/behavior step)

```powershell
# Targeted spec (new/updated) — always
pnpm exec playwright test e2e/term-finalization.spec.ts --trace=retain-on-failure

# Regression set (always after Step 2 and Step 3)
pnpm exec playwright test e2e/term-finalization.spec.ts e2e/eosy-finalization-status.spec.ts e2e/grades-alignment.spec.ts e2e/grading-mode-forms.spec.ts --trace=retain-on-failure

# Full suite — FINAL gate only
pnpm run test:e2e
```

Pass:
- Every spec green.
- No skipped new assertions (data-absence skips are allowed only with a clear `test.skip` reason).
- `collectProblems(page)` empty on every touched page: no console errors, no API >= 400.
- No horizontal overflow in the mobile term-finalization spec.
- No finalize action is confirmed by E2E (read-only guard preserved).

### G5 — Scope diff gate

```powershell
git diff --stat
```

Pass: only these files changed:

```text
server/src/lib/termFinalization.ts
server/src/__tests__/term-finalization.test.ts
src/lib/termFinalizationTypes.ts
src/pages/registrar/components/TermFinalizationSectionCard.tsx
e2e/term-finalization.spec.ts
docs/TERM-FINALIZATION-ROTATION-FIX-PLAN-2026-11-18.md
```

Anything else: STOP, inspect `git diff`, revert unintended changes.

### G6 — FINAL gate

```powershell
pnpm run verify
pnpm run test:e2e
```

Then 30 minutes of normal registrar/teacher usage (or equivalent smoke) followed by:

```powershell
npx pm2 status
npx pm2 logs server --lines 300 --nostream > artifacts\term-finalization-rotation\final\pm2-soak.log
```

Pass:
- `pnpm run verify` green (typecheck + build + PWA + server build + lint + server tests).
- Full Playwright suite green.
- PM2 soak has zero new error-level lines and no crash restarts.
- Expected values verified in the deployed UI for Aguinaldo and Bonifacio across T1/T2/T3.
- Preview parity verified.

### G7 — Deployment smoke gate

```powershell
npx pm2 restart server --update-env
npx pm2 restart client --update-env
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health
pnpm exec playwright test e2e/term-finalization.spec.ts e2e/eosy-finalization-status.spec.ts --trace=retain-on-failure
npx pm2 logs server --lines 200 --nostream > artifacts\term-finalization-rotation\final\pm2-deploy.log
```

Pass: health 200, both specs green, PM2 clean. Then freeze.

---

## 7. Test plan details

### Backend (Vitest) — required assertions

| Case | Arrange | Assert |
|---|---|---|
| Overview T1 | Rotation A/B/C (ranks 1/2/3), one learner, grades all three in T1 | One row; `draft=1`; `subjectIds=[A]`; `subjectCodes=[A.code]`; `rotationGroupId` set |
| Overview T2 | same, grades all three in T2 | One row; `subjectIds=[B]` |
| Overview T3 | same, grades all three in T3 | One row; `subjectIds=[C]` |
| Non-rotation | Plain subject with T1 grade | Row unchanged; appears in T1/T2/T3 per its grades |
| Finalize section T1 | all three rotation components have T1 drafts | A → FINALIZED; B/C remain `DRAFT` |
| Unfinalize T1 | A finalized | A → `DRAFT`; B/C untouched |
| Explicit stale IDs | `subjectIds=[A,B,C]`, term T1 | Only A finalized; response count = A's grade count |
| Existing guards | EOSY finalized, archived year, single-subject finalize | Unchanged behavior, all pre-existing tests green |

Cleanup must delete created grades, assignments, subjects, and enrollments in `afterEach`/`finally` even on failure.

### Playwright — required assertions

| Check | Assertion |
|---|---|
| Page loads | `term-finalization-page` visible; no console/API problems |
| Bonifacio T1/T2/T3 | `[data-subject-name="Science 7"]` draft = 5; row text has no `SCI_BIO7`, `SCI_CHEM7`, `SCI_ES7` |
| Aguinaldo T1/T2/T3 | same; section total = 40 |
| Section totals | Bonifacio = 50 per term; Aguinaldo = 40 per term |
| No duplicate rows | exactly one `Science 7` row per section |
| Preview parity | exactly one Science card in View grades; no branch cards |
| Responsive | mobile spec still has zero horizontal overflow |
| Read-only | no Finalize confirm is clicked |

---

## 8. Expected values (defense checklist)

Capture in `artifacts/term-finalization-rotation/final/expected-values.md`.

| Section | Term | Rows | Draft grades | Science row | Science code (hidden) |
|---|---|---|---|---|---|
| Aguinaldo | T1 | 8 | 40 | 5 | SCI_BIO7 |
| Aguinaldo | T2 | 8 | 40 | 5 | SCI_CHEM7 |
| Aguinaldo | T3 | 8 | 40 | 5 | SCI_ES7 |
| Bonifacio | T1 | 10 | 50 | 5 | SCI_BIO7 |
| Bonifacio | T2 | 10 | 50 | 5 | SCI_CHEM7 |
| Bonifacio | T3 | 10 | 50 | 5 | SCI_ES7 |
| Bonifacio | all | 10 | Env Sci = 5; Research = 5 | — | — |

If any value differs after the fix: STOP. Compare with the pre-fix baseline and the preview endpoint; do not proceed to deploy.

---

## 9. PM2 log checking reference

Commands:

```powershell
npx pm2 status
npx pm2 logs server --lines 100 --nostream
npx pm2 logs server --lines 300 --nostream --err
npx pm2 restart server --update-env
npx pm2 restart client --update-env
```

Failure patterns to inspect after each restart:

```powershell
Select-String -Path artifacts\term-finalization-rotation\<step>\pm2-after.log `
  -Pattern "Error:|Unhandled|UnhandledPromiseRejection|PrismaClient|ECONNREFUSED|HTTP 500|500 "
```

Rules:
- Capture `pm2-before.log` first so pre-existing noise can be distinguished.
- Only new lines after the restart marker count against the gate.
- A single genuine new `Error:` line fails the gate even if the UI looks fine.
- Keep the logs for the final report; do not delete or truncate them.

---

## 10. Deployment sequence

1. Ensure working tree contains only planned files (`G5`).
2. Run `G6` (full verify + full e2e + soak).
3. Deploy the exact commit that passed `G6`.
4. Restart `server`, then `client` individually.
5. Run `G7` smoke.
6. Verify the expected-values table in the browser.
7. Freeze. Record the commit hash in the final notes.

No installs, migrations, seeds, or data repairs during deployment.

---

## 11. Rollback

Triggers: any red `G7`, any unexpected count, any PM2 error, any preview divergence, any non-rotation change.

```powershell
git revert <fix-commit>
git status
pnpm run verify
npx pm2 restart server --update-env
npx pm2 restart client --update-env
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health
pnpm exec playwright test e2e/term-finalization.spec.ts e2e/eosy-finalization-status.spec.ts
npx pm2 logs server --lines 200 --nostream
```

Pass: health 200, targeted Playwright green, PM2 clean, pre-fix UI restored (Science 15 / branch codes visible). Document the rollback reason and commit.

Do not restore the DB: this plan performs no data writes.

---

## 12. Acceptance checklist

- [ ] Decision D1–D6 recorded and unchanged.
- [ ] Baseline captured (`G0`) with PM2 log and screenshots/counts.
- [ ] Backend selects only the term-ranked rotation component in overview.
- [ ] Finalize/Unfinalize use the same term filter (stale-payload safe).
- [ ] UI shows the term-specific branch name and selected code; one `Science 7` row only.
- [ ] New backend rotation tests pass.
- [ ] Updated Playwright spec passes (`collectProblems` empty).
- [ ] Aguinaldo T1/T2/T3 = 40 drafts; Science 5.
- [ ] Bonifacio T1/T2/T3 = 50 drafts; Science 5; Env Sci/Research 5.
- [ ] Preview endpoint unchanged and parity verified.
- [ ] Non-rotation subjects, HG skip, inactive skip, archived year, EOSY guards unchanged.
- [ ] `pnpm run verify` green.
- [ ] `pnpm run test:e2e` green.
- [ ] PM2 soak clean; no crash restarts.
- [ ] `G7` deploy smoke green.
- [ ] Commit hash recorded; defense build frozen.
- [ ] Rollback command rehearsed (not necessarily executed).

---

## 13. Appendix — artifact layout

```text
artifacts/term-finalization-rotation/
├── pre/
│   ├── pm2-baseline.log
│   ├── aguinaldo-before.json
│   └── bonifacio-before.json
├── step1-backend/
│   ├── pm2-before.log
│   ├── pm2-after.log
│   └── vitest-term-finalization.log
├── step3-frontend/
│   ├── playwright-term-finalization.log
│   ├── pm2-before.log
│   └── pm2-after.log
├── final/
│   ├── verify.log
│   ├── playwright-full.log
│   ├── pm2-soak.log
│   ├── pm2-deploy.log
│   └── expected-values.md
└── screenshots/
    ├── aguinaldo-t1.png
    ├── aguinaldo-t2.png
    ├── aguinaldo-t3.png
    ├── bonifacio-t1.png
    ├── bonifacio-t2.png
    └── bonifacio-t3.png
```

Environment quick reference:

| Item | Value |
|---|---|
| Backend PM2 app | `server` — `http://localhost:5003/api` |
| Health | `GET http://localhost:5003/api/health` |
| Frontend PM2 app | `client` — `http://localhost:5173` |
| Playwright config | `playwright.config.ts`, `testDir: ./e2e` |
| Registrar E2E spec | `e2e/term-finalization.spec.ts` |
| Preview oracle | `GET /api/registrar/student-grades/:sectionId/:term?schoolYear=<SY>` |
| PM2 rule | restart `server` / `client` individually; never `all` |
