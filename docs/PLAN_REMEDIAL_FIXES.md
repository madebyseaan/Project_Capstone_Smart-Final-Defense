# PLAN — Remedial Logic Fixes + History View (Handoff)

Source investigation: conversation 2026-09-03. All line numbers verified as of that date.
Related: `PLAN_REMEDIAL_RETENTION.md`, `mdfiles/ENROLLPRO-REMEDIAL-CONTRACT-QUESTIONS-2026-08-31.md`

## System Flow (verified)

- EOSY finalization (`server/src/lib/promotion.ts:511-528`): student with 1-2 failing subjects (final < 75) → `CONDITIONALLY_PROMOTED` + `RemedialClass` rows (`PENDING`, one per failed subject, `originalGrade` = failing final rating, rows stamped with the SY just finalized).
- EnrollPro sync path (`server/src/lib/remedial.ts:236-420`, used after rollover): pulls conditionally promoted learners from EnrollPro, matches by LRN, tags the **current-SY** enrollment `CONDITIONALLY_PROMOTED`, computes failed subjects from **previous-SY** finalized grades, upserts remedial rows onto the **current-SY** enrollment.
- Registrar enters RCM (60-100) per subject → "Complete Remedial" → `RFG = (originalGrade + RCM)/2` (`computeRfg`), outcome `PASSED` if `RFG >= 75`.
- Remedial is SMART-local; never pushed to EnrollPro. Tracker page: `src/pages/registrar/RemedialTracker.tsx`.

---

## P0 — Correctness bugs (fix first, in this order)

### BUG 1 — Sync path double-promotes student's grade level
`completeRemedial()` (`server/src/lib/remedial.ts:93-107`) computes `newGradeLevel = NEXT_GRADE_LEVEL[enrollment.section.gradeLevel]`.

- EOSY path: remedial rows live on the **old** enrollment (Grade 8, SY24-25) → promoted to Grade 9. Correct.
- Sync path: remedial rows live on the **new** enrollment (Grade 9, SY25-26) → completing remedial sets `promotedToGradeLevel = GRADE_10`. **Wrong** — student is already placed in Grade 9; completing remedial confirms that placement.

Also: sync stamps remedial rows with the NEW grade level (`remedial.ts:388` `gradeLevel: currentEnrollment.section.gradeLevel`). The row should record the grade at which the subject was failed.

**Fix:**
1. In `syncBackSubjectsFromEnrollPro()`: stamp new rows with the **previous-SY** enrollment's `section.gradeLevel` (lookup `enrollment.findFirst({ where: { studentId, schoolYear: prevSY } }, include section)`, fallback: leave null-safe — derive from `currentEnrollment` grade minus one; if underivable, use current and log a warning). Fix BOTH the `create` (line ~388) and keep `update` branch untouched (update only refreshes name/grade).
2. In `completeRemedial()`: derive grade level from the remedial rows, not the section — `const failedGradeLevel = enrollment.remedialClasses[0].gradeLevel ?? enrollment.section.gradeLevel;` then `NEXT_GRADE_LEVEL[failedGradeLevel]`. Verify EOSY path unchanged (row gradeLevel === section gradeLevel there).

**Acceptance:**
- G8 student (SY24-25) synced into G9 enrollment (SY25-26); complete remedial → `promotedToGradeLevel = GRADE_9`, status `PROMOTED`.
- EOSY-finalized G8 student completes remedial → `promotedToGradeLevel = GRADE_9` (no regression).

### BUG 2 — Sync downgrades resolved students
`syncBackSubjectsFromEnrollPro()` (`remedial.ts:300-306`) unconditionally sets `promotionStatus: "CONDITIONALLY_PROMOTED"`. Re-running sync after a student completed remedial (upgraded to `PROMOTED`) re-tags them `CONDITIONALLY_PROMOTED`, and the upsert at `remedial.ts:374-394` resets `originalGrade` (mutating a completed record's inputs).

**Fix:** before the status update, skip enrollment when ANY of:
- `promotionStatus === "PROMOTED" || promotionStatus === "JHS_COMPLETER"` (resolved),
- any existing remedial row for the enrollment has `status: "COMPLETED"`.

For skipped-but-matched learners, count them in a new `result.skippedResolved` counter (add to `BackSubjectsSyncResult` + audit log). For the upsert `update` branch: only apply when the existing row is `PENDING`.

**Acceptance:** run sync twice after completing one student's remedial → second run reports that student in `skippedResolved`, their status stays `PROMOTED`, completed row's `originalGrade`/`remedialMark`/`outcome` untouched.

### BUG 3 — SF10 shows "Retained" for remedial-passed students
`server/src/lib/sf10.ts:363` recomputes: `subjectGrades.every(s => !s.final || s.final >= 75) ? "Promoted" : "Retained"` — ignores `enrollment.promotionStatus` and remedial outcomes. A `CONDITIONALLY_PROMOTED` student who passed remedial (now `PROMOTED`) still prints "Retained".

**Fix:** replace the computed value with the stored status:
```ts
promotionStatus: promotionStatusLabel(enrollmentForYear?.promotionStatus ?? null)
  ?? (generalAverage ? (subjectGrades.every((s: any) => !s.final || s.final >= 75) ? "Promoted" : "Retained") : null),
```
Import `promotionStatusLabel` from `./promotion`. Keep the recompute only as fallback for pre-finalization years (status null). Note: with this fix a `CONDITIONALLY_PROMOTED` learner prints "Conditionally Promoted" even after passing remedial only if their enrollment status wasn't upgraded — BUG 1/2 fixes ensure the status IS upgraded at completion, so the chain is consistent.

**Acceptance:** student with Math 72 (all others ≥75), RCM 80 → RFG 76 → completed. SF10 for that SY shows "Conditionally Promoted" until completion, "Promoted" after (enrollment status now `PROMOTED`).

---

## P1 — Scoping, safety, small fixes

### BUG 4 — Pending query unscoped by school year
`server/src/routes/registrar/remedial.ts:41-45` — `where: { promotionStatus: "CONDITIONALLY_PROMOTED" }` with no default `schoolYear`. After rollover, stale prior-year enrollments mix into the list (and resolved ones vanish mid-work). The `schoolYear` query param already exists in `remedialPendingQuerySchema` but the frontend never sends it.

**Fix (backend):** if `schoolYear` query param is absent, default to `getActiveSchoolYearLabel()` (lazy import, same pattern as the sync route at line 118). Optional `allYears=true` param for history (see FEATURE). Keep `gradeLevel` param behavior.

**Fix (frontend):** add an SY `Select` in the tracker toolbar (options: active SY + distinct `RemedialClass.schoolYear` values from a new lightweight endpoint or reuse registrar school-years list if one exists — check `src/lib/api.ts` registrar section first before inventing an endpoint). Pass `schoolYear` to `getRemedialPending`. Default = active SY.

### BUG 5 — Unfinalize can destroy completed remedial records
`promotion.ts:566-568` — `unfinalizeSectionEosy` deletes ALL remedial rows for the section's enrollments, including `COMPLETED` ones with RCM/RFG outcomes, and resets promotion status. If a registrar completed remedial, then an admin unfinalizes EOSY (e.g., to fix one grade), remedial history is lost.

**Fix:** guard at top of `unfinalizeSectionEosy`: count `remedialClass.findMany({ where: { enrollmentId: { in: enrollmentIds }, status: "COMPLETED" } })`; if > 0, return `{ ok: false, error: "HAS_COMPLETED_REMEDIAL" }`. Map that error to HTTP 409 in the calling route (search `routes/registrar.ts` / EOSY route for the unfinalize handler; add a clear message: "Unfinalize blocked: N completed remedial records exist. Registrar must resolve remedial records first."). Unfinalizing with only `PENDING` rows remains allowed (rows deleted + recreated on re-finalize — that flow is fine).

### BUG 6 — Auto-sync fires without confirmation and ignores SY scoping
`src/pages/registrar/RemedialTracker.tsx:107-120` — when the list is empty on first load, it silently POSTs the sync (which writes enrollment tags + rows) without the confirm dialog the manual button requires. After BUG 4's SY selector lands, a registrar viewing an empty past-SY list would trigger a current-SY sync unexpectedly.

**Fix:** only auto-sync when the selected SY is the active SY AND the list is empty AND `!silent`; surface a toast afterwards ("Synced N learners from EnrollPro") instead of silent ignore. If selected SY is historical, never auto-sync.

### BUG 7 — Missing cross-field date validation
`server/src/schemas/remedial.ts` — `conductedTo >= conductedFrom` is never validated (plan doc `PLAN_REMEDIAL_RETENTION.md:175` called for it). Add `.refine()` on the update schema when both dates present. Mirror check in `completeRemedial` opts handling (`remedial.ts` route schema) if a combined schema exists; otherwise validate in route before calling lib.

### FEATURE — Remedial history view (previous years)
Registrar needs to see remedials from prior SYs (your ask). Design:

- Backend: extend `GET /registrar/remedial/pending` with `includeCompleted: "true"` OR (cleaner) new `GET /registrar/remedial/history?schoolYear=&page=&limit=` in `routes/registrar/remedial.ts`: query `prisma.remedialClass` grouped by enrollment — `findMany({ where: { schoolYear }, include: { enrollment: { include: { student: true, section: true } } } })`, group in JS by enrollmentId (small row counts per SY; add `take`/pagination by enrollment via distinct enrollmentIds first if needed). Return the same `RemedialStudent` shape the frontend already uses so the UI can reuse rendering; add `promotionStatus` from the enrollment. **Historical query rule: filter by `schoolYear` string only — never `isActive`/`isArchived`** (AGENTS.md).
- Frontend: tabs or a `Select` above the tracker: "Pending (current SY)" | "History". History list = read-only (no RCM inputs, no Complete button; keep Save Dates only for rows missing dates if desired — simplest: fully read-only, expanded row shows final table). Search + pagination reuse existing client-side logic.

---

## P2 — Decision required BEFORE coding (do not guess)

### Grade 10 remedial gap
`evaluatePromotion` (`promotion.ts:150-152`): G10 with 1-2 failures → `JHS_COMPLETER`, never `CONDITIONALLY_PROMOTED`, so no remedial rows and `completeRemedial` rejects them (`ENROLLMENT_NOT_CONDITIONALLY_PROMOTED`). Whether G10 completers should get remedial classes is a **school policy / DepEd DO question** (JHS completion vs conditional promotion). Options:
a) Keep as-is (JHS completer, no remedial) — current behavior, arguably correct.
b) Create remedial rows for JHS_COMPLETER too, and relax `completeRemedial` to accept both statuses (completing remedial must NOT change `JHS_COMPLETER` status, only fill RCM/RFG on SF10).

**Do not implement until user picks.** Record the answer in this file before coding.

### SF10 remedial table year placement (minor, flag only)
Sync path attaches rows to the current-SY enrollment, so SF10 renders them under the CURRENT year page; the failure happened in the prior year. DepEd practice varies. Current behavior is defensible ("remedial conducted this SY"). Leave as-is unless user objects; note in PR description.

---

## Execution order
1. BUG 1 (lib changes + sync grade stamp)
2. BUG 2 (skip resolved in sync)
3. BUG 3 (SF10 status)
4. BUG 5 (unfinalize guard — protects data before history work)
5. BUG 4 (SY scoping: backend default + frontend selector)
6. FEATURE (history endpoint + tab)
7. BUG 6, BUG 7 (small frontend/schema)
8. P2 — only after user decisions.

## Rules (from AGENTS.md — non-negotiable)
- Historical/SF queries: filter by `schoolYear` string ONLY, never `isActive`/`isArchived`.
- Routes thin, logic in `lib/`; Zod for all new params (`includeCompleted`, `allYears`, history query schema in `server/src/schemas/remedial.ts`).
- Use Prisma transactions for multi-step writes (BUG 1 touches `completeRemedial`'s existing transaction — keep it atomic).
- No comments added; follow existing style; `PageHeader`/`StatCard`/semantic tokens in UI.
- Do not touch `.env*`; EnrollPro stays read-only.
- File max 1000 lines (`RemedialTracker.tsx` is 827 — the history tab must not push it over; if it would, extract a `RemedialHistoryTable.tsx` component into `src/pages/registrar/components/`).

## Verification (must pass before handoff)
```bash
# Backend
cd server && npm run build && npx ts-node-dev --respawn src/__tests__/grade-lock.test.ts 2>$null; npm run dev  # smoke: login registrar, hit /api/registrar/remedial/pending
# Frontend
cd .. && npm run build && npm run lint
```
- Existing tests: `server/src/__tests__/` (sf10-snapshot, grade-lock) must still pass.
- Manual scenario matrix (seed data exists: `server/prisma/seed-grades.ts` `REMEDIAL_STUDENTS`, `check-remedial.ts`):
  1. EOSY-finalize a section with 1-2 failures → rows created on old enrollment.
  2. Sync path (new SY) → rows created on new enrollment, `gradeLevel` on rows = prior grade.
  3. Complete remedial (all RFG ≥ 75) → `PROMOTED`, correct `promotedToGradeLevel` for both paths.
  4. Re-run sync → resolved student skipped, nothing downgraded.
  5. SF10 for that student → "Promoted" (post-completion).
  6. Empty tracker on historical SY → no auto-sync POST (check network tab).
  7. Unfinalize with completed remedial → 409, records intact.
