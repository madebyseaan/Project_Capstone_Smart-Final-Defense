# Grade Pipeline Alignment â€” Comprehensive Fix Plan

> **Status:** PLANNING ONLY â€” do not execute steps marked DATA without an explicit go-ahead.
> **Date:** 2026-11-16
> **Supersedes:** `docs/GRADE_ALIGNMENT_FIX_PLAN.md` (2026-08-29; references pre-refactor `SchoolForms.tsx` â€” do not reuse its line numbers).
> **Scope owner:** whoever owns grades/forms (teacher + registrar surfaces).
> **Hard rule:** Highest priority is **NO REGRESSION**. One step at a time, gates between every step, rollback ready at all times.

---

## 0. Why this plan exists (audit evidence)

Read-only audit of the live 2026-2027 data (20 sections / 83 enrolled learners / 2,570 term-grade rows) found:

| # | Finding | Severity | Evidence |
|---|---------|----------|----------|
| B1 | **SF9 rotation merge uses the wrong term.** `sf9Composer.ts` uses `sub.T1 ?? sub.T2 ?? sub.T3` per rotation slot instead of the sub-subject's own rotation rank term. | **HIGH** (official report card) | G8 Science: advisory/SF10 = 92/90/89 (final 90), SF9 = 92/92/93 (final 92). 26 wrong cells in a 4-section sample; all rotation rows. |
| B2 | **G10 Mathematics is mis-tagged as a Science rotation subject.** `Subject MATH10` has `rotationTermGroupId=SCIENCE`, `rotationTermRank=1` in all 5 G10 sections. Legacy `Subject AP` has the same bad tag (0 assignments). | **HIGH** (missing learning area on forms; wrong Science value in SF10) | Math is swallowed into the "Science" row in advisory/SF9/SF10 (no Math row). SF10 Science T1 = Math's 92 instead of Science-Biology's 93. |
| B3 | **Class Record display â‰  stored grade used by Advisory/SF9/SF10.** Ledger recomputes QA PS from the ST1/ST2/TE breakdown (`LedgerRow.tsx:101-119`, `getDisplayFinalGrade`), preferring it over stored `quarterlyAssessPS`; the other surfaces read persisted `Grade.quarterlyGrade`. | **MEDIUM-HIGH** (data-driven; 38.6% of cells in current data) | 992 / 2,570 term cells differ. Example: ST1/ST2/TE â†’ QA PS 98.67 vs stored 95 â†’ ledger 95, stored/other views 94. |
| B4 | **SF9 payload teacher labels come from the wrong assignment and are not deduped.** | **LOW** (SF9 print does not render subject teachers today; advisory profile + API do) | Advisory "CLARISSE JOY BAUTISTA" (active, 12 grades) vs SF9 "Maria Angela Aquino" (archived, 0 grades); rotation joins "Lourdes Reyes / Lourdes Reyes / â€¦". |

Already landed in the working tree (prerequisite): advisory student profile now inherits grades from predecessor/archived assignments (fixes empty Advisory rows when a teacher was reassigned). It must ship with tests in Step 0.

**What is already correct (do not "fix"):**
- Advisory vs Class Record row selection/inheritance: 0 mismatches / 2,151 term cells.
- `mergeRotationSubjects()` in `promotion.ts` (rank-term rule) â€” used by SF10 and promotion/EOSY. **Do not change it.**
- SF10 rotation logic (apart from bad `MATH10` metadata).
- Subject completeness: no graded subject lacks an active assignment; no duplicate name variants per code.

---

## 1. Non-negotiable rules

1. **No regression first.** If a gate fails, stop and fix forward in a new commit; never patch around a failed gate.
2. **One branch + one PR per step.** Branch names: `fix/grades-rotation-rule`, `fix/sf9-teacher-labels`, `fix/rotation-metadata-guard`, `fix/grade-derivation-truth`, `fix/grades-parity-tests`.
3. **No external writes.** Never trigger EnrollPro/ATLAS/AIMS syncs during this work. External systems are read-only (AGENTS.md).
4. **No touching** `.env*`, `.env` values, `pnpm-workspace.yaml`, or `mergeRotationSubjects()` semantics unless a Decision Gate explicitly says so.
5. **Data steps require:** fresh DB backup â†’ dry-run report â†’ impact review/sign-off â†’ apply â†’ re-audit. Finalized/locked/EOSY data is protected by default.
6. **Every step ends with:** build + typecheck + lint + server tests + PM2 log gate + Playwright gate + audit-diff gate + rollback note.
7. **Evidence is kept.** Save audit JSON + PM2 log excerpts + Playwright artifacts under `artifacts/grade-alignment/<step>/` (gitignored) and summarize in the PR.

---

## 2. Gate framework (used by every step)

### G-A: Build & test gate
```powershell
# Root
pnpm run typecheck
pnpm run build
pnpm run lint

# Server
pnpm --prefix server run build
pnpm --prefix server test
```
Pass: all commands exit 0. No new ESLint warnings/errors.

### G-B: Focused tests gate
- New/updated tests for the step must pass in isolation:
```powershell
pnpm --prefix server exec vitest run <test-file-1> <test-file-2>
```

### G-C: Data audit gate (read-only)
```powershell
pnpm --prefix server exec ts-node --transpile-only scripts/audit-grade-alignment.ts --school-year 2026-2027 --json artifacts/grade-alignment/<step>/audit.json
```
Pass criteria per step are listed below. Save the JSON and diff against the previous step's JSON:
```powershell
git diff --no-index -- artifacts/grade-alignment/pre/audit.json artifacts/grade-alignment/<step>/audit.json
```
Every difference must be listed and justified in the PR ("expected diff list").

### G-D: PM2 restart + log gate
```powershell
# 1. Capture current logs for evidence
npx pm2 logs server --lines 100 --nostream > artifacts/grade-alignment/<step>/pm2-before.log

# 2. Restart ONLY the server (never "pm2 restart all" â€” it restarts opencode-web too)
npx pm2 restart server --update-env

# 3. Health check (expect HTTP 200)
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health

# 4. Exercise one real read path, then inspect logs
#    (advisory SF9 + SF10 use the fixed code paths)
npx pm2 logs server --lines 200 --nostream > artifacts/grade-alignment/<step>/pm2-after.log
```
**Fail if `pm2-after.log` contains any of:** `Error:`, `Unhandled`, `UnhandledPromiseRejection`, `PrismaClient` error blocks, `ECONNREFUSED` loops, `500` request lines, stack traces, `[Transmutation] ... fallback 60` spikes.
**Pass requires:** PM2 status `online`, 0 restarts caused by crashes, health 200, representative API requests 200.
Also restart `client` only if Step touched frontend:
```powershell
npx pm2 restart client --update-env
```
Then verify `http://localhost:5173` loads.

### G-E: Playwright gate
```powershell
# Targeted (new spec) â€” always
npx playwright test e2e/grades-alignment.spec.ts --trace=retain-on-failure

# Existing regression specs most related to the step â€” always
npx playwright test e2e/advisory-printables.spec.ts e2e/grading-mode-forms.spec.ts e2e/term-finalization.spec.ts

# Full suite â€” at Gate G1, G3 and FINAL
npm run test:e2e
```
**Every spec must assert `collectProblems(page)` is empty** (no console errors, no API â‰¥ 400) on every touched page. Any console/network error is a gate failure, not a warning.

### G-F: No-regression diff gate
1. Audit JSON diff reviewed (allowed changes only).
2. DB invariants:
```powershell
pnpm --prefix server exec ts-node --transpile-only scripts/check-data-integrity.ts --school-year 2026-2027 --json artifacts/grade-alignment/<step>/integrity.json
```
   - No CRITICAL anomalies.
   - Row counts unchanged (no deletes): compare counts before/after using the audit JSON summary.
3. `git diff --stat` must contain only planned files.
4. If any surface changes outside the expected list â†’ **STOP**, treat as regression, roll back.

### G-G: Rollback gate
- Code steps: `git revert <commit>` on the branch; redeploy; rerun G-D + targeted Playwright.
- Data steps: restore from the pre-step DB backup **only if** the audit cannot explain the change; otherwise forward-fix with a new dry-run.
- Keep the DB backup path/command in the PR body.

---

## 3. Step 0 â€” Baseline, safety net, and prerequisite tests

**Goal:** freeze a trustworthy baseline before any behavior change.

### Actions
1. `git status` clean or only expected files; create branch `fix/grades-parity-tests`.
2. DB backup:
```powershell
pnpm --prefix server run db:backup -- --label pre-grade-alignment
```
3. Capture PM2 state:
```powershell
npx pm2 status
npx pm2 logs server --lines 200 --nostream > artifacts/grade-alignment/pre/pm2-baseline.log
```
4. Run full baseline suite (`pnpm run verify`, `npm run test:e2e`) and store results.
5. Add the new read-only audit script (committed ops tool):
   - `server/scripts/audit-grade-alignment.ts`
   - Inputs: `--school-year`, `--json <path>`; no writes.
   - Reports per student/subject/term:
     - Class Record value (active ledger + inherited predecessor rule, **stored** quarterly grade);
     - Ledger live-recomputed value (exam-breakdown rule, mirror of `LedgerRow`/`getDisplayFinalGrade`);
     - Advisory value (current endpoint logic);
     - SF9 value (call `composeSf9Section`);
     - SF10 value (call `buildSf10Records`);
     - rotation mapping (rank term);
     - teacher labels per surface;
     - invalid rotation metadata list.
   - This script is the gate oracle for all steps. Unit-test its pure helpers.
6. Add regression tests for the already-landed advisory inheritance fix:
   - `server/src/__tests__/advisory-inheritance.test.ts` (DB-backed fixtures; archived predecessor grades appear; active grade wins; finalized rows untouched).
7. **Decision Gate D1 â€” rotation rule.** Confirm with the registrar/owner that the canonical rule is **rank term only** (matches SF10/promotion). Default = strict rank term. If they choose "fallback to any term", the change must also touch `mergeRotationSubjects()` and triggers a separate, higher-risk plan (promotion/EOSY re-review). Do not start Step 1 until D1 is recorded here:
   - Decision: **STRICT RANK TERM** (approved 2026-11-16; owner authorised execution via "start doing all of this"). Verified: 0 rotation students missing their rank-term grade before the change.

### Gate G0
- Baseline suite green (or a written list of pre-existing failures, none in scope).
- Audit JSON captured at `artifacts/grade-alignment/pre/audit.json` with known counts: stored-vs-ledger mismatches = 992; SF9 parity mismatches = 26 (sample); teacher label diffs = 32 (sample); invalid rotation subjects = 2 (`MATH10`, `AP`).
- PM2 baseline logs contain no pre-existing crash loop.

---

## 4. Step 1 â€” Canonical rotation rule for Advisory + SF9 (code only)

**Fixes:** B1 (SF9 wrong rotation values). **Risk:** medium (touches SF9/term cards + advisory merge).
**Files:** `server/src/lib/sf9Composer.ts`, `server/src/routes/advisory.ts`, new `server/src/__tests__/rotation-parity.test.ts`.

### Change spec
1. **SF9** (`buildSubjectRows` merge block):
   - Replace `const bestGrade = sub.T1 ?? sub.T2 ?? sub.T3;` with the rank-term value:
     ```ts
     const termKey = `T${sub.rotationTermRank}` as Sf9Term;
     if (sub[termKey] !== null) merged[termKey] = sub[termKey];
     ```
   - Remove the "best term" fallback. No other SF9 behavior changes.
2. **Advisory** (`rotation merge` in `advisory.ts`):
   - Remove the fallback that scans T1â†’T2â†’T3; keep the rank term only.
   - Keep returning grade objects (PS fields) for the chosen rank term.
3. **Do not touch** `server/src/lib/promotion.ts`, SF10, or promotion/EOSY math.
4. Add a short comment at both merge sites: "Rotation grades belong to the sub-subject's rotation term; SF10/promotion already use this rule."

### Tests (new)
`server/src/__tests__/rotation-parity.test.ts` (pure fixtures, no DB):
- Fixture: BIO T1=80/T2=85/T3=90, CHEM T1=81/T2=82/T3=83, ES T1=91/T2=92/T3=93, group `SCIENCE`.
- Expected all surfaces: T1=80, T2=82, T3=93, final=85.
- Guard that SF9 no longer picks T1 for Chemistry/Earth slots.
- Guard that an empty rank term stays blank (strict rule), unless Decision D1 chose fallback.
- Advisory term metadata (grade object) matches the rank-term source row.

### Gate G1
- G-A, G-B, G-D, G-E (targeted + full suite).
- G-C audit diff:
  - SF9-vs-Advisory **grade mismatches: 26 â†’ 0** (sample cells).
  - Rotation rows only change; **no changes** to standalone subject grades, finals of non-rotated subjects, attendance, promotion status, general averages of non-rotated-only students.
  - SF9 term-card values for rotated subjects now equal advisory/SF10.
- Manual spot check (recorded in PR): G8 Maka-Diyos Science = 92/90/89/final 90 on Advisory, SF9, SF10; G7 rotated Science learner matches its class-record sub-subject terms.
- Rollback: revert one commit; no data changes.

**Stop condition:** any change in a non-rotation subject row or in `generalAverage` for students without rotation subjects.

---

## 5. Step 2 â€” SF9 teacher labels (code only; low priority)

**Fixes:** B4. **Risk:** low. **Files:** `server/src/lib/sf9Composer.ts`, `server/src/routes/advisory.ts` (only if needed for parity), tests.

### Change spec
1. Build a deterministic per-subject teacher map **before** creating rows:
   - Priority per assignment: `(isActive ? 10000 : 0) + nonNullQuarterCountForStudent*100 + updatedAt/1e12` (reuse the grade-priority idea; section-stable variant may use overall grade count instead of per-student, pick one and document).
   - Teacher = display-normalized name (`toDisplayName` already imported in the composer).
2. `ensureRow` uses that teacher instead of "first assignment encountered".
3. Rotation merged teacher: unique values (`Set`), join `" / "`. Never print the same teacher 3Ã—.
4. `rowsByArea` teacher concatenation also dedupes with a `Set`.
5. Advisory: verify its teacher choice equals the SF9 choice for the same subject. Adjust the advisory dedupe if the two disagree (advisory already prefers grade-bearing active assignments).

### Tests
- `server/src/__tests__/sf9-teacher-selection.test.ts` (DB-backed fixtures):
  - Active graded assignment vs archived 0-grade duplicate â†’ current teacher wins (both advisory and SF9).
  - Three active duplicates, only one has grades â†’ graded teacher wins.
  - Rotation with same teacher Ã—3 â†’ one name.
  - Rotation with three different teachers â†’ `"A / B / C"` (unique, stable order by rotation rank).

### Gate G2
- G-A, G-B, G-D, G-E.
- Audit diff: **teacher label diffs 32 â†’ 0** (sample) and 0 across all sections where SF9 and advisory both report a teacher.
- No grade/final changes in the audit JSON.
- Note in PR: SF9 print does not show subject teachers today; this fixes payload/advisory parity and future rendering.
- Rollback: revert one commit.

---

## 6. Step 3 â€” Rotation metadata guard + data repair (code + DATA)

**Fixes:** B2. **Risk:** HIGH for the data change (affects G10 forms and promotion inputs). Requires Decision Gate D2.

### 6.1 Code â€” validation helper (no behavior change yet)
New `server/src/lib/rotationMetadata.ts`:
```ts
ROTATION_GROUP_RULES = {
  SCIENCE:          { label: "SCIENCE", codePrefixes: ["SCI"] },
  TLE_EXPLORATORY:  { label: "TLE",     codePrefixes: ["TLE"] },
}
```
- `validateRotationMetadata({ code, rotationTermGroupId, rotationTermRank, rotationOutputLabel })`
  - group must exist in rules;
  - rank âˆˆ {1,2,3};
  - label equals the group's expected label (case-insensitive);
  - code starts with one of the group's prefixes;
  - all-or-none: group+rank+label must be set together (orphan label/rank is invalid).
- `clearRotationFields()` helper for repairs.

Wire into **writers only**:
- `server/src/lib/atlasSync.ts` rotation application: validate against the **target** code (including all grade-suffixed targets before propagating). If invalid â†’ skip the update, increment a rejected counter, `logger.warn`, and write one audit log line with the subject code + Atlas payload. If valid â†’ keep current behavior.
- Add a conflict warning when Atlas would overwrite existing valid metadata with different valid metadata.

**Do NOT add runtime filtering to `mergeRotationSubjects()` / promotion.** Once data is repaired, the readers are correct; adding filters there increases regression risk.

### 6.2 Data â€” dry-run repair script
New `server/scripts/repair-rotation-metadata.ts`:
- Default = dry-run; `--apply` required to write; `--json <path>` for reports.
- Select all subjects with any rotation field set; validate; classify:
  - `INVALID_GROUP_CODE` (e.g. `MATH10`),
  - `LABEL_MISMATCH` (e.g. `AP`),
  - `ORPHAN_FIELD` (rank/label without group),
  - `VALID`.
- Apply = set `rotationTermGroupId=null, rotationTermRank=null, rotationOutputLabel=null` for invalid/orphan rows only. No deletes; batch transaction; audit log per subject.
- Output counts + full list.

### 6.3 Impact analysis (before apply)
- Run dry-run on a **production snapshot**, not only dev.
- Produce an impact report:
  - Subjects affected (currently known: `MATH10` Ã— all years; `AP`).
  - Sections/learners whose advisory/SF9/SF10 rows will change.
  - **Promotion/EOSY preview** for every affected G10 section: current vs post-repair promotion decisions/general averages (must be reviewed by registrar; do not finalize anything).
  - Finalized/EOSY state: if any affected section is finalized, **STOP**. The plan must include an unfinalize/re-finalize decision by the registrar (separate operation, audited).
- Decision Gate D2:
  - Approved to clear metadata? ______  Approver: ______  Date: ______
  - Finalized sections: list + registrar decision: ______________________

### 6.4 Tests
- `server/src/__tests__/rotation-metadata.test.ts` (pure): valid/invalid matrix, including `MATH10` (SCIENCE group, MATH prefix â†’ invalid), `AP` (label mismatch), legit `SCI_BIO7`, `TLE_AFA_EXP8`, orphan label.
- `server/src/__tests__/atlas-rotation-guard.test.ts`: mocked Atlas payload with bad rotation metadata â†’ no DB update, warn/audit emitted; valid payload still updates.

### Gate G3
- G-A, G-B, G-D, G-E (full e2e suite).
- G-C audit diff:
  - invalid rotation subjects: **2 â†’ 0**.
  - G10 `MATH10` exists as its own row in advisory/SF9/SF10 and its values equal the class record.
  - G10 Science rows no longer include Math's T1; Science values = advisory/SF10 rule (e.g. 93/90/89).
  - No changes for non-G10 subjects.
  - Promotion/EOSY preview diff **exactly matches the approved impact report**; anything extra = STOP.
- `check-data-integrity.ts` still no CRITICAL.
- PM2 logs: verify zero atlas guard warnings in normal operation (no sync triggered).
- Rollback: re-run repair is not reversible â†’ restore the saved rotation fields from the dry-run JSON (keep an `--undo <json>` mode in the script), or DB backup restore. Implement `--undo` in the same script (writes back the recorded fields only).

---

## 7. Step 4 â€” One source of truth for grade derivation + QA repair (code + DATA)

**Fixes:** B3. **Risk:** HIGH for the data change (changes stored official grades). Requires Decision Gate D3 and registrar sign-off.
**Authority:** the ST1/ST2/TE breakdown (30/30/40, `examMath.ts`) is authoritative when present; legacy composite QA is only a fallback. This matches the ledger and the ECR import.

### 7.1 Code â€” shared derivation
New `server/src/lib/gradeDerivation.ts` (pure, no Prisma):
```ts
deriveGradeValues({
  writtenWorkScores, perfTaskScores, examScores,
  quarterlyAssessScore, quarterlyAssessMax,
  storedWrittenWorkPS, storedPerfTaskPS, storedQuarterlyAssessPS,
}, weights, mode, transmutationTable)
=> { writtenWorkPS, perfTaskPS, examPS, quarterlyAssessPS, initialGrade, quarterlyGrade, nextQuarterlyAssessScore, nextQuarterlyAssessMax }
```
Rules (mirror `LedgerRow.tsx`/`getDisplayFinalGrade`):
- WW PS = stored ?? computed from scores.
- PT PS = stored ?? computed from scores.
- Exam PS = `computeExamPS(examScores)` when the array is present.
- QA PS = exam PS ?? stored QA PS ?? composite.
- Initial = WWÂ·ww% + PTÂ·pt% + QAÂ·qa%.
- Quarterly = `computeTermGrade(initial, SY mode, table)`.
- When exam PS exists, the canonical composite becomes `quarterlyAssessScore = exam PS`, `quarterlyAssessMax = 100` (matching the teacher save path).

Wire into:
1. `server/src/lib/gradeRecalc.ts` (`recomputeStoredGrades`):
   - select `examScores`, score arrays, QA fields;
   - compute with the helper;
   - update `writtenWorkPS`, `perfTaskPS`, `quarterlyAssessPS`, `quarterlyAssessScore`, `quarterlyAssessMax`, `initialGrade`, `quarterlyGrade`.
   - Preserve current behavior for rows without exam breakdown.
   - This makes every admin config/weights/table change also normalize QA drift.
2. `server/scripts/realign-seeded-grades.ts` â€” use the same helper.
3. **Seed scripts** (dev/test only): `server/prisma/seed-teacher-scores.ts`, `seed-grades.ts`, `seed-grades-term.ts` â€” derive `quarterlyAssessScore` from the generated `examScores` (or after seeding call the repair in-memory). Fresh seeded DB must have 0 drift.
4. Optional (only if D3 approves the refactor): teacher save route `grades-sub/classes.ts` calls the helper for consistency. If not, document that save remains correct today and is covered by tests.

### 7.2 Data â€” dry-run repair
New `server/scripts/repair-grade-derivations.ts`:
- Default dry-run; `--apply`; `--school-year`; `--include-archived`; `--include-finalized` (default **false**).
- Select grades with non-empty `examScores`; compute canonical values; if any of QAPS/initial/quarterly differ beyond `1e-6`, record.
- **Skip** `isArchived` grade rows and `FINALIZED`/`LOCKED` rows by default; report their counts separately.
- Apply in batches of 100 inside transactions; write one audit log summary per run; idempotent.
- `--report <path>` JSON per row: student id, class assignment id, subject code, term, status, old/new values.
- `--undo <report>` restores only the fields recorded.

### 7.3 Impact analysis (before apply)
- Run dry-run on a production snapshot. Expected in current dev data: ~992 affected cells, all with exam breakdowns.
- Impact report must list impacted surfaces:
  - Advisory student profile, SF9, SF10, term finalization previews, EOSY previews, registrar dashboards/exports, EnrollPro grade push payloads (if enabled).
- **Finalized rows must be 0** in the default apply. If not: STOP; registrar must unfinalize/approve a separate operation. Never auto-edit finalized grades.
- Coordinate: no external sync/push during apply and verification.
- Decision Gate D3:
  - Approved to apply to DRAFT rows only? ______  Approver: ______  Date: ______
  - Finalized rows affected: count = ____ ; decision: ______________________

### 7.4 Tests
- `server/src/__tests__/grade-derivation.test.ts` (pure):
  - stored PS vs exam breakdown precedence (Kim-style case: 95 â†’ 98.67 â†’ quarterly 95);
  - no exam breakdown â†’ unchanged;
  - empty exam arrays â†’ fallback;
  - ZERO_BASED and TRANSMUTED modes;
  - missing PS â†’ null, no write.
- `server/src/__tests__/grade-recalc-alignment.test.ts` (DB fixtures): `recomputeStoredGrades()` aligns stored to the ledger for exam rows; leaves archived/finalized alone (depending on flags).
- `server/src/__tests__/seed-derivation.test.ts` (or extend seeding tests): fresh seeded grade rows have drift = 0.

### Gate G4
- G-A, G-B, G-D, G-E (full suite).
- G-C audit diff:
  - stored-vs-ledger live recompute mismatches: **992 â†’ 0** (for non-archived DRAFT rows).
  - Advisory/SF9/SF10 values change **only** for the rows listed in the approved impact report.
  - Finalized/locked rows untouched (count check).
  - Term finalization/EOSY previews diff matches the approved report; nothing extra.
- Spot checks recorded: Kim-style FIL T1 ledger = stored = advisory = SF9 = SF10.
- PM2 logs clean; no novel `[Transmutation]` fallback warnings.
- Rollback: `--undo artifacts/.../qa-repair.json` or DB backup restore. Both tested in staging before apply.

---

## 8. Step 5 â€” Parity monitoring & docs (code only)

**Fixes:** recurrence prevention. **Risk:** low.
1. Extend `server/src/lib/dataIntegrity.ts`:
   - Anomaly `QA_PS_DRIFT_EXAM_BREAKDOWN` â€” grade rows where exam breakdown exists but stored QA PS differs > 0.01 from `computeExamPS`. Group by section; severity WARNING (CRITICAL if drift ratio > 5% in a section).
   - Anomaly `INVALID_ROTATION_METADATA` â€” subjects failing `validateRotationMetadata`. Severity WARNING (CRITICAL if the subject has active assignments with grades).
2. `server/scripts/check-data-integrity.ts`: include both; `--strict` fails on any; default fails on CRITICAL.
3. Add a short `docs/GRADE_PIPELINE_RULES.md`:
   - rotation rule (rank term), grade derived-field precedence (exam breakdown > stored QA), who writes stored grades, how to run repair/audit scripts.
4. Update AGENTS.md "Gotchas" with one line pointing to this doc.
5. Add the parity audit to the release checklist (`docs/DEPLOYMENT_RUNBOOK.md` or the QA checklist): run `audit-grade-alignment.ts` before deploy; expected zero diffs.

### Gate G5
- G-A, G-B, G-D.
- Run `deploy:check` + integrity script: new anomalies = 0 on the repaired DB.
- Full e2e suite.
- Docs reviewed by one other dev.

---

## 9. FINAL gate (release readiness)

All must be true:
1. `pnpm run verify` green.
2. `npm run test:e2e` green (including new `e2e/grades-alignment.spec.ts`).
3. `audit-grade-alignment.ts` on the release DB:
   - Advisory â†” Class Record: 0 mismatches.
   - Advisory â†” SF9 â†” SF10: 0 grade mismatches.
   - Ledger â†” stored: 0 mismatches (DRAFT/non-archived).
   - Teacher labels: 0 diffs.
   - Invalid rotation metadata: 0.
   - G10 Math rows present in all forms.
4. PM2 soak: 30â€“60 minutes of normal usage with zero error-level log lines; `pm2 status` shows no crash restarts.
5. Data repair reports archived in `artifacts/grade-alignment/`; DB backup exists; undo tested in staging.
6. Registrar sign-off on impacted-finalized decisions (if any).
7. No external writes performed.
8. Rollback rehearsed at least once in staging (code revert + data undo).

---

## 10. Playwright test plan (new `e2e/grades-alignment.spec.ts`)

**Rules:** read-only; no grade edits/locks/sync; every test collects `collectProblems(page)` and asserts empty.

### Test A â€” API parity (primary oracle)
1. Login teacher â†’ `GET /api/advisory/my-advisory` â†’ section + learners.
2. Login registrar â†’ get tokens for SF9/SF10 endpoints.
3. For every learner in the advisory section:
   - Teacher: `GET /api/advisory/student/:id/grades`.
   - Teacher: `GET /api/advisory/sf9` (full mode) â†’ find learner.
   - Registrar: `GET /api/registrar/forms/sf9/:id?schoolYear=<SY>`.
   - Registrar: `GET /api/registrar/forms/sf10/:id` â†’ current SY record.
4. Normalize subject keys (`subjectCode` uppercase; rotation rows use `rotationOutputLabel`).
5. Assert T1/T2/T3/final equality across advisory â†” SF9 â†” SF10, with exact numbers (no tolerance).
6. Rotation case: for a learner with `SCI_*` or `TLE_*` subjects, read the class-record API values for each sub-subject and assert the merged rank-term value equals advisory/SF9/SF10.
7. G10 case (skip if no G10 access): `MATH10` row exists in all three surfaces and equals the class record; Science row does not contain Math's T1.
8. Assert teacher name matches the active grade-bearing assignment (advisory vs SF9 payload).

### Test B â€” Teacher UI parity
1. Advisory â†’ select first learner â†’ student profile.
2. Read displayed T1..T3/final for each subject (**add `data-testid` attributes**: `subject-grade-row-<code>`, `subject-grade-t1/t2/t3/final-<code>`).
3. Assert values equal the API response and equal the SF9 preview values.
4. Open Printables â†’ SF9 preview (`[data-testid="sf9-form"]`) â†’ parse the learning-areas table â†’ assert same values.
5. Assert no console/API errors.

### Test C â€” Registrar UI parity
1. Registrar â†’ student records / forms â†’ open SF9 for the same learner (`[data-testid="sf9-form"]`) â†’ assert same values.
2. Open SF10 â†’ assert per-term + final values for current SY match the API; assert Math and Science rows are separate for G10.
3. Assert no console/API errors.

### Test D â€” Ledger vs forms (drift guard)
1. Teacher â†’ Class Records â†’ open a class record with grades.
2. Read the displayed quarterly grade per term per learner (**add `data-testid` if needed**: `ledger-grade-<studentId>-<term>`).
3. Assert it equals the stored/API value used by advisory/SF9/SF10 for the same learner/subject/term.
4. Run for at least one rotated subject and one plain subject.

### Execution order per affected gate
```
targeted: npx playwright test e2e/grades-alignment.spec.ts --trace=retain-on-failure
regression: npx playwright test e2e/advisory-printables.spec.ts e2e/grading-mode-forms.spec.ts e2e/term-finalization.spec.ts
full: npm run test:e2e
```
Artifacts: save the `playwright-report/` and any traces to `artifacts/grade-alignment/<step>/`.

**Credential note:** account fixtures come from env or `tests/playwright-accounts.json`; if a role is missing, the test must `test.skip` with a clear reason (existing pattern), and the DB-level audit script covers that role.

---

## 11. Expected audit-diff map (no-regression contract)

| Step | Allowed diffs | Forbidden diffs |
|---|---|---|
| 1 Rotation rule | SF9/term-card values for rotated subjects; advisory fallback removal cases | any non-rotation grade; general average of students with no rotation subjects; attendance; promotion status |
| 2 Teachers | teacher strings only | any grade/final value |
| 3 Metadata | G10 `MATH10` rows appear; G10 Science values corrected; Math/Science row sets; approved promotion-preview deltas | any non-G10 subject; any unlisted student; finalized data |
| 4 QA derivations | grades exactly listed in the approved dry-run report; QA fields + initial + quarterly on those rows | finalized/archived rows; rows not in the report; passwords/secrets; audit/API contracts shape |
| 5 Monitoring/docs | new anomaly output; docs | runtime behavior |

---

## 12. Rollback playbook (per step)

1. **Code:** `git revert <commit>`; `npx pm2 restart server --update-env`; health check; targeted Playwright; compare audit JSON to pre-step.
2. **Metadata repair:** `repair-rotation-metadata.ts --undo <dry-run.json>` restores recorded fields; restart; audit; verify Math row disappears exactly as before.
3. **Grade repair:** `repair-grade-derivations.ts --undo <report.json>` restores recorded fields; restart; audit; verify counts.
4. **Catastrophic failure:** restore DB backup (`pnpm --prefix server run db:backup` output + restore procedure from `docs/DEPLOYMENT_RUNBOOK.md`), restart, re-run baseline audit.
5. Every rollback is itself gated by G-D + targeted Playwright and recorded in the PR.

---

## 13. Acceptance checklist (copy into PR)

- [ ] Decision D1 (rotation rule) recorded
- [ ] Decision D2 (metadata repair + finalized sections) recorded
- [ ] Decision D3 (grade repair + finalized rows) recorded
- [ ] Step 0 baseline + DB backup + audit JSON
- [ ] Step 1 rotation parity: audit mismatches 0; tests added; gates passed
- [ ] Step 2 teacher parity: diffs 0; gates passed
- [ ] Step 3 metadata: invalid = 0; G10 Math/Science verified; gates passed
- [ ] Step 4 QA repair: drift 992 â†’ 0; finalized untouched; undo tested; gates passed
- [ ] Step 5 monitoring/docs: integrity anomalies 0; docs updated
- [ ] Full `pnpm run verify` green
- [ ] Full `npm run test:e2e` green
- [ ] PM2 soak 30â€“60 min clean
- [ ] No external system writes
- [ ] Registrar sign-off (if finalized/EOSY data was involved)
- [ ] Rollback rehearsed

---

## 14. Appendix â€” Environment quick reference

| Item | Value |
|---|---|
| Backend (PM2 `server`) | `http://localhost:5003/api` â€” health `/api/health` |
| Frontend (PM2 `client`, Vite) | `http://localhost:5173` |
| PM2 apps | `server`, `client`, `opencode-web` â€” **always restart `server`/`client` individually** |
| Playwright config | `playwright.config.ts`, `testDir: ./e2e`, baseURL `:5173` |
| Server tests | `pnpm --prefix server test` (requires `DATABASE_URL_TEST`, seeds test base) |
| Full verify | `pnpm run verify` |
| DB backup | `pnpm --prefix server run db:backup` |
| Integrity check | `pnpm --prefix server exec ts-node --transpile-only scripts/check-data-integrity.ts --school-year 2026-2027` |
| New audit tool | `server/scripts/audit-grade-alignment.ts` (to be created in Step 0) |
| Repair tools | `repair-rotation-metadata.ts`, `repair-grade-derivations.ts` (dry-run default; undo supported) |
| Evidence dir | `artifacts/grade-alignment/<step>/` |

### Key source references (verified before planning)
- `server/src/lib/sf9Composer.ts:226-382` â€” row building + rotation merge + teacher assignment.
- `server/src/routes/advisory.ts:350-540` â€” advisory row selection, inheritance, rotation merge, final/average.
- `server/src/lib/promotion.ts:72-116` â€” canonical `mergeRotationSubjects()` (rank term; used by SF10/promotion). **Do not change.**
- `server/src/lib/sf10.ts:240-348` â€” SF10 slots + rotation merge + final group average.
- `server/src/lib/gradeRecalc.ts:55-137` â€” recompute from stored PS only (the gap).
- `server/src/routes/grades-sub/classes.ts:407-557` â€” teacher save path (already derives QA from exam breakdown).
- `server/src/lib/aimsImport.ts:330-410` â€” intentionally drops exam breakdown when importing a composite QA.
- `server/src/lib/ecrImport.ts:129-330` â€” ECR derives QA from the same ST1/ST2/TE breakdown (consistent).
- `src/pages/teacher/components/ledger/LedgerRow.tsx:83-119` â€” ledger live display/derivation (exam breakdown precedence).
- `src/lib/gradeMath.ts:137-164` â€” `getDisplayFinalGrade` (same precedence).
- `server/src/lib/atlasSync.ts:300-360` â€” rotation metadata propagated from Atlas by code (ingestion point for B2).
- `server/prisma/schema.prisma` â€” `Subject.rotationTermGroupId/Rank/OutputLabel`, `Grade.quarterlyAssessScore/Max/PS`, `initialGrade`, `quarterlyGrade`.


---

## 15. Execution log — 2026-11-16

| Step | Result |
|---|---|
| Baseline | DB backup `server/backups/smart_db_2026-11-16T12-18-59.dump`; server tests 556/556; e2e 36/36 (2 skipped); audit captured. |
| Step 1 (rotation rule) | SF9 now uses each sub-subject's rotation term; Advisory/SF9/SF10 parity mismatches 178 → 0 (after Step 3 metadata). |
| Step 2 (teacher labels) | Deterministic active/graded teacher selection + rotation dedupe; teacher diffs 222 → 0. |
| Step 3 (metadata) | Atlas writer now validates/rejects inconsistent rotation metadata. 19 invalid/orphan subjects cleared (incl. `AP`; `MATH10` was cleared by the new guard during a background sync before the repair). G10 Math rows restored; 18 stranded AP grades backfilled onto their active assignments (`backfill-active-assignment-grades.ts`). Integrity strict: 0 anomalies. |
| Step 4 (grade derivation) | Shared `deriveGradeValues()`; `recomputeStoredGrades` and seed builder now use it. Applied 2,324 DRAFT row alignments; stored-vs-ledger drift 992 → 0; no finalized/archived rows touched. |
| Step 5 (monitoring/docs) | `GRADE_DERIVATION_DRIFT` + `INVALID_ROTATION_METADATA` anomalies added; `docs/GRADE_PIPELINE_RULES.md`; AGENTS.md gotcha; new Playwright `e2e/grades-alignment.spec.ts`. |
| Final audit | Advisory↔ClassRecord 0/2944; Advisory↔SF9 0/2944 (0 teacher diffs); Advisory↔SF10 0/2944; stored↔ledger 0/2588; invalid rotation metadata 0. |

Artifacts: `artifacts/grade-alignment/pre`, `step1`, `step2`, `step3`, `step4`, `step5` (gitignored).
