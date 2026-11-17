# PLAN — Demo Seeding Consolidation + Controlled Failure Profile

## Implementation status (2026-11-17) — DONE
- One card: `src/pages/admin/components/DemoDataToolsCard.tsx` (Seed Demo Data / Clear Demo Data, Finalize toggle, staged progress).
- Seed: `seedTeacherScoresCore.ts` now writes 3 WW / 2 PT (capped) + ST1/ST2/TE; `seed-teacher-scores.ts` adds `--program-fail` / `--program-fail-grade` with a G7-G9 picker (`seedProgramFailure.ts`); SPA/SPS/STE are pinned to 85+ tiers.
- Dev endpoint passes the 1/1/1 profile (G9 retained, G8 remedial, 1 program failure) and surfaces `PROGRAM FAIL` in the result.
- Added a **min-85 enforcement loop** in `buildGradeForTarget`: item-score rounding (e.g. 8.2 → 8) could undershoot the 85 target and land program learners at 83; the loop raises the target until the stored QG is ≥85 (verified across weight sets; remedial 70/71 stays exact).
- Added **grading-mode detection**: the seed reads the active `SchoolYear.gradingMode` and uses `computeTermGrade` — `ZERO_BASED` stores the rounded initial grade (60 floor), `TRANSMUTED` uses the DB table. Verified both modes; the active SY 2026-2027 is ZERO_BASED, so the old seed's transmuted QGs were wrong (2,217/2,706 mismatches). Legacy `seed-grades*.ts` remain transmutation-only; the dev tool uses the fixed seed.
- Added a **pass floor** for non-designated subjects: every subject that is not an intentional failure now builds to at least **75** (program learners remain ≥85). Without it, zero-based item rounding could turn a passing `BELOW_AVG` tier into an accidental failure (observed once: a G10 ESP grade).
- Legacy scripts' counts aligned (`seed-grades-term.ts` 3/2, `seed-grades.ts` PT cap 3).
- Verified: `pnpm run typecheck`, `pnpm run build`, `pnpm --prefix server run build`, `pnpm run lint` (0 errors), `pnpm run check:pwa`, and a read-only seed dry-run (20 sections, 2,706 grades, program fail picked in G7 STE, retained G9, remedial G8). Server unit tests require a `*_test` DB and could not run in this environment.

## Goal
1. Merge the two Dev Tools cards (Grades + Attendance) into **one card with one seed button**.
2. Seed a **controlled failure profile** that is safe for rollover and easy to demo.
3. Keep the whole flow usable for the Thursday defense.

---

## Verified current state

### Dev tools
- Two cards in Admin → System Settings → Advanced:
  - `DeveloperToolsCard.tsx` — Seed + Finalize / Clear Grades
  - `AttendanceToolsCard.tsx` — Seed Attendance / Clear Attendance
- Two endpoints, no combined endpoint:
  - `POST /admin/dev/seed-scores` (up to 15 min)
  - `POST /admin/dev/seed-attendance` (up to 10 min)
- Both scoped to the **active school year**, all terms.

### What clearing actually does
- A `Grade` row holds **both raw scores and computed grade** (`schema.prisma:366-401`).
- Clearing scores = clearing computed grades (same row), for **all T1/T2/T3**, whole SY.
- Clear Grades also deletes `GradeSnapshot`, `RemedialClass`, and resets `Enrollment.promotionStatus`.
- Clear does **not** delete: attendance (separate stage in the new card), class assignments,
  enrollments, users, audit logs, edit requests, `TermGradeLock` / `YearGradeLock`.

### Current seed profile (`seed-teacher-scores.ts`)
- 2 RETAINED + 2 REMEDIAL students, **REGULAR sections only** (`pickSpecialStudents`, line 39).
- STE learners pinned at 85+ in every subject (`assignNormalTiers`, line 192).
- **Zero** special-program students fail today.

### Grade computation
- Seed writes raw scores, then runs the same formula as the class record:
  scores → PS → initial grade → transmuted quarterly grade (`seedTeacherScoresCore.ts` + `canonicalGrade.ts`).
- Nothing is hardcoded; ledger and SF9/SF10 show the same computed values.

---

## Part 1 — One Dev Tools card (UI-only, no new backend route)

New `src/pages/admin/components/DemoDataToolsCard.tsx`:

- **Toggle: "Finalize grades (EOSY-ready)"** (default ON)
  - ON → `seedScores({ action:"seed", finalized:true, clearFirst:true })`
  - OFF → `seedScores({ action:"seed", finalized:false, clearFirst:true })` (draft grades, teacher can still encode)
  - The toggle does **not** change what is seeded — only the ending status.
- **Button: "Seed Demo Data"**
  - Stage 1: seed scores/grades (shows `1/2`).
  - Stage 2: on success, seed attendance (shows `2/2`).
  - If stage 1 fails → stop and show error.
  - If stage 2 fails → keep stage 1 success and show partial result.
- **Button: "Clear Demo Data"**
  - Clears scores/grades (+ snapshots, remedial, promotion status) then attendance.
  - Confirm dialog states exact scope: active SY, all terms.
- Clear and Seed stay **separate buttons** so the admin can clear, inspect the empty
  state, and then seed. Seed still runs its own clear-first internally.
- Disable both buttons while either stage is running; warn "do not close this tab".
- `SystemSettings.tsx`: render the single card; remove both old cards.
- Delete `DeveloperToolsCard.tsx` and `AttendanceToolsCard.tsx`.
- Reuse existing `adminApi.seedScores` / `adminApi.seedAttendance` — no `api.ts` changes.

---

## Part 2 — Controlled failure profile (seed script changes)

Target profile for the demo seed:

| Student | Section | Failure | Expected EOSY result |
|---|---|---|---|
| 1 RETAINED | REGULAR, G7-G9 preferred | 4 subjects | `RETAINED`, no remedial rows |
| 1 REMEDIAL | REGULAR, **G7-G9 only** | 1-2 subjects (final 70-71) | `CONDITIONALLY_PROMOTED` + PENDING remedial row(s) |
| 1 PROGRAM FAIL | Special program, **G7-G9 only** | **exactly 1 subject** (final 70-71) | `CONDITIONALLY_PROMOTED` + 1 remedial row; after rollover EnrollPro moves learner to BEC/Regular |
| Everyone else | All sections | None | Promoted, programs stay intact |

### Grade-level constraint (important)
- `evaluatePromotion` (`promotion.ts:157-159`): Grade 10 with 1-2 failures = `JHS_COMPLETER`, **not** `CONDITIONALLY_PROMOTED`.
- `finalizeSectionEosy` only creates remedial rows for `CONDITIONALLY_PROMOTED` (`promotion.ts:611-628`).
- Therefore:
  - The **remedial example must be G7-G9** or no PENDING remedial row exists for the tracker demo.
  - The **program-failure example must be G7-G9** or it becomes a completer, not the BEC/Regular demotion scenario.
  - Retained (4 failures) still maps to `RETAINED` in G10, but pin to G7-G9 for a clean demo.
- Default pins for the dev seed: retained = Grade 9, remedial = Grade 8, program failure = Grade 7 (all configurable via flags).

### Grade 10 policy (decided)
- **G10 is seeded all-passing by default** in the demo seed:
  - 1-2 failures in G10 produce `JHS_COMPLETER`, not `CONDITIONALLY_PROMOTED`,
    and `finalizeSectionEosy` creates **no remedial row** for completers.
  - The BEC/Regular demotion scenario also does not apply to G10 completers.
  - In practice some teachers adjust G10 grades internally so learners still pass;
    SMART should not seed fake adjustments to imitate that. Seeding stays rules-accurate.
- If a G10 failure/completer demo is ever needed, add an explicit opt-in flag later —
  expected output is `JHS_COMPLETER` with no remedial row.
- Retained/remedial/program-failure examples therefore come only from G7-G9.

### Script changes — `server/prisma/seed-teacher-scores.ts`
- New flag: `--program-fail N` (script default `0`; dev tool passes `1`).
- New picker: `pickProgramFailureStudents(...)`
  - Pool: learners in **G7-G9** sections where `normalizeProgramCode(program) !== "REGULAR"`.
  - Exclude **SPED** sections and transferees.
  - Only sections that are not archived and have **active class assignments** (otherwise no grades get seeded there).
  - Deterministic order: grade level → section name → student last name.
  - Pick exactly N (1) learners; assign **1 failed subject** each.
  - Prefer a **non-rotation** subject so the failure stays visibly one subject (fallback: any subject).
  - Append to `specialStudents` (type `REMEDIAL`) so the existing tier pipeline,
    rotation expansion, and EOSY logic apply unchanged.
- Tier handling:
  - Failed subject gets `REMEDIAL_FAIL_70` / `REMEDIAL_FAIL_71` (final 70/71 across T1-T3).
  - Other subjects keep passing tiers.
  - If the learner is in STE, keep non-failed subjects at `STE_ELIGIBLE` (85+).
  - SPA/SPS learners (all of them): pin to the **85+ tier pool** (same pool as STE),
    not the ordinary pattern tiers — see "Program retention rules" below.
- Log line in seed output: `PROGRAM FAIL: <last>, <first> | <program> | Grade X - <section> | failed: <subject>`.
- Pin demo picks via endpoint flags: `--retained 1 --remedial 1 --program-fail 1 --retained-grade 9 --remedial-grade 8` (program-fail picker defaults to G7-G9; pin its grade with an optional `--program-fail-grade` if needed).

### Program retention rules (researched)
These are the DepEd rules EnrollPro is expected to apply after reading final grades:

| Program | Retention requirement | Source |
|---|---|---|
| **SPA** | 85% in specialization, **no failing grade in all subjects**; other subjects at least 80% (some issuances also cite general average 82%) | DepEd SPA policy guidelines / regional SPA standards |
| **SPS** | Final grade of at least **85% in the specialized subject**, at least **80% in all other subjects**, no failing grade in any subject | DepEd Order No. 25, s. 2015; DECS Memo No. 242, s. 2000 |
| **STE** | General average **85% in Science, Math, English**, **83% in the rest**, no grade lower than **80%** in any grading period; miss → 1-year probation, then transfer to regular class | DepEd Order No. 55, s. 2010 |

**Implication:** the current ordinary tier pattern (`BELOW_AVG` → QG 76-78) would put many SPA/SPS learners below the 80% rule and could mass-demote them in EnrollPro. So the seed must keep **all SPA/SPS learners at 85+ in every subject**, with only the intentionally picked program-failure learner exiting. This also matches what the user wants: only 1 program student leaves.


### Dev endpoint — `server/src/routes/admin-sub/system.ts`
- In the `action === "seed"` branch, pass explicit profile flags:
  `--retained 1 --remedial 1 --retained-grade 9 --remedial-grade 8 --program-fail 1`
  (script defaults stay 2/2/0 for manual runs).
- Add `PROGRAM FAIL` to the summary-line filter so the picked learner/section/subject
  is visible in the UI result (currently the filter only keeps `GRAND SUMMARY`,
  `Total grades`, `EOSY finalize`, `sections OK`).
- Update the card description/copy: "1 retained (G9), 1 remedial (G8), 1 program failure (G7-9)".

### Notes
- "Demoted to BEC/Regular" is **not modeled inside SMART** — EnrollPro decides this
  after fetching final grades during rollover. The seed only produces the failing
  final grade needed for that outcome.
- Rotation subjects: existing logic expands a picked failure to its whole rotation
  group (one merged learning area, e.g. TLE). Picker avoids rotation subjects when possible.

---

## Part 2b — Assessment column limits (new class record rule)

### Verified rule (already enforced in the app)
- Backend: `MAX_WW_COLUMNS = 5`, `MAX_PT_COLUMNS = 3` (`server/src/lib/assessmentColumns.ts`)
- Frontend: `MAX_WW_TASKS = 5`, `MAX_PT_TASKS = 3` (`src/pages/teacher/components/classRecordLimits.ts`)
- Exam columns unchanged: ST1 (max 10), ST2 (max 10), TE (max 30)

### Problem — seed is outdated
- Dev seed (`seedTeacherScoresCore.ts:177-178`) writes **WW = 4 items × 10** and
  **PT = 4 items × 20** → PT exceeds the new max of 3.
- Exam breakdown is already seeded correctly (`ST1/ST2/TE`), no change needed.

### Change
- WW: seed **3 items × max 10** (leave 2 of the 5 columns empty).
- PT: seed **2 items × max 20** (leave 1 of the 3 columns empty).
- Exam: keep seeding **ST1, ST2, TE** as-is.
- Name items `WW 1..3` / `PT 1..2` so the ledger reads clearly.
- Import `MAX_WW_COLUMNS` / `MAX_PT_COLUMNS` in the seed and assert
  seeded counts never exceed the caps.

### Same stale counts elsewhere (fix for consistency)
- `seed-grades-term.ts:117-118` — WW 4 / PT 4 → change to 3 / 2.
- `seed-grades.ts:436-437` — WW 5/4 and PT 4/3 → cap PT at 3 (WW stays ≤ 5).
- Note: these legacy scripts also **do not write `examScores`** (no ST1/ST2/TE).
  Only `seed-teacher-scores.ts` seeds the exam breakdown. Do not use the legacy
  scripts for the defense demo; treat them as out of scope beyond count alignment.

### Regression check (simulated)
- With the default DepEd 2026 transmutation table, seeding **3 WW / 2 PT**
  produces the same computed QG per target tier as the old 4/4 counts
  (verified across targets 75-95 and 70/71 under 30/50/20, 20/50/30, 20/60/20 weights).
- The seed still recomputes QG from the actual rounded item scores, so stored
  grades always match the ledger (`check-grade-alignment.ts` must pass).

### Review findings (other checks)
- **Grade locks:** seed writes directly through Prisma and EOSY finalize does not
  check locks, so seeding works even with `TermGradeLock` / `YearGradeLock` present.
  Clear does **not** remove locks — demo may still show lock banners. Decide whether
  to demo locks separately.
- **AIMS rows:** the seed skips class assignments that already have AIMS scores
  (`hasAimsScores`). The dev tool always clears first, so seeded rows replace any
  AIMS-derived grade values. Raw `AimsScore` records are not deleted; a later AIMS
  sync may overwrite the seeded values.
- **Program retention thresholds:** SPA/SPS/STE all have minimum-grade rules beyond "passed" (SPS: 85 specialization + 80 others; SPA: 85 specialization + no failures/80 others; STE: 85 Sci/Math/Eng + 83 others + no grade <80). The seed must pin SPA/SPS learners to 85+ tiers, not ordinary patterns, or EnrollPro could demote many of them after rollover.
- **Clear partial failure:** report per-stage results if clear-grades succeeds but
  clear-attendance fails (same pattern as the seed stages).
- **Archived sections:** `allSections` has no `archivedAt` filter, but grade seeding
  only uses `isActive` class assignments. The program-failure picker must filter to
  non-archived sections with active assignments so it cannot pick a learner with no seeded grades.
- **Summary visibility:** the dev endpoint currently filters only a few summary
  lines; add `PROGRAM FAIL` so the chosen learner is shown in the card output.
- **Partial failure UX:** if scores seed succeeds and attendance fails, show both
  outcomes and allow retrying attendance without re-seeding grades.
- **Long-running requests:** combined worst case is ~25 minutes (15 + 10). The card
  must warn "do not close this tab"; no client timeout exists, but a reverse proxy
  timeout could drop the response while the script keeps running.
- **Docs:** `docs/PLAN-eosy-ux-simplification.md` appendix still references the old
  two-card layout; update the appendix names after implementation.

---

## Part 3 — Defense runbook

**Night before**
1. Confirm active SY is the year to demo.
2. Sync EnrollPro enrollments + ATLAS teaching loads.
3. Seed Demo Data with **Finalize ON**; time it.
4. Verify:
   - Teacher class records show scores + computed grades for T1/T2/T3.
   - Exactly 1 retained, 1 remedial, 1 program failure (seeded log line).
   - All other special-program learners pass every subject.
   - SF9/SF10 render; EOSY readiness has no snapshot gaps; rollover `canArchive: true`.
   - Attendance reports/SF2 populated; RemedialTracker shows PENDING rows.
5. Rehearse the draft path separately (Finalize OFF) if live encoding will be shown.

**Day of**
- If data is already seeded, do not re-seed; run the verification checklist only.
- Otherwise Seed Demo Data once and keep the tab open until both stages finish.
- If demoing live teacher encoding (Finalize OFF), make sure **grade locks are off**
  for the current term — otherwise the teacher edit UI is blocked even for draft grades.

**Caveat**
- Finalize ON sets `status=FINALIZED` + EOSY snapshots, but does **not** create
  `TermGradeLock` / `YearGradeLock`. Set locks manually if the demo needs lock banners.

---

## Files touched
- `server/prisma/seed-teacher-scores.ts` — program-failure flag + SPA/SPS/STE tier policy
- `server/prisma/seedProgramFailure.ts` — new G7-G9 single-subject picker (keeps seed under 1000 lines)
- `server/prisma/seedTeacherScoresCore.ts` — WW 3 / PT 2 counts, exam stays ST1/ST2/TE
- `server/prisma/seed-grades-term.ts` — align counts to 3 WW / 2 PT (consistency)
- `server/prisma/seed-grades.ts` — cap PT at 3 (consistency)
- `server/src/routes/admin-sub/system.ts` — pass demo profile flags
- `src/pages/admin/components/DemoDataToolsCard.tsx` — new combined card
- `src/pages/admin/SystemSettings.tsx` — swap cards
- Delete `DeveloperToolsCard.tsx`, `AttendanceToolsCard.tsx`
- (Optional) `src/lib/api.ts` — unchanged (existing types already cover `finalized`)

## Verification
- `pnpm run build` (root) and `pnpm run build` (server) pass; `pnpm run lint` clean.
- Manual seed run:
  `cd server && npx ts-node --transpile-only prisma/seed-teacher-scores.ts --all --finalized --clear --retained 1 --remedial 1 --retained-grade 9 --remedial-grade 8 --program-fail 1 --complete-transferees`
- Data checks after seed:
  - Every seeded grade row has **3 WW items**, **2 PT items**, and **ST1/ST2/TE** exam rows.
  - No row exceeds 5 WW / 3 PT columns.
  - Class record ledger shows 3/5 WW, 2/3 PT, and populated ST1/ST2/TE.
  - Program failure: learner is in **G7-G9**, has exactly **1 subject below 75** (final 70/71), and no other special-program learner has a failing subject.
  - SPA/SPS learners: every subject **≥85** in all terms (except the single picked program-failure learner).
  - STE learners: **≥80** in every subject and **≥85** in Science/Math/English (satisfied by the 85+ tier pool).
  - Retained example → `RETAINED`; remedial example → `CONDITIONALLY_PROMOTED` with a PENDING remedial row.
  - No G10 learner was used for the remedial or program-failure examples.
- `npx ts-node prisma/check-teacher-scores.ts` → confirm profiles and no unexpected failures.
- `npx ts-node prisma/check-grade-alignment.ts` → stored grades equal recomputed grades.
- Confirm EOSY output: 1 RETAINED, 2 CONDITIONALLY_PROMOTED (1 regular remedial + 1 program failure), rest promoted.

## Assumptions to confirm
1. Program-failure learner fails **exactly 1 subject** (not 4) — matches the BEC/Regular demotion scenario.
2. The 1 program failure is picked deterministically from the **first eligible G7-G9 special section**
   (STE first if sorted first; SPED excluded). Say if you want it pinned to a specific program/grade.
3. Retained/remedial examples are exactly **1 each**, both from REGULAR sections; defaults pinned to Grade 9 (retained) and Grade 8 (remedial) so the demo is predictable.
4. Per-item max scores stay **10 for WW** and **20 for PT** (the new rule limits column counts, not max scores).
5. SPA/SPS/STE learners are seeded at **85+ everywhere** (except the one intentional program failure) to satisfy the researched retention rules and prevent accidental program exits on rollover.

