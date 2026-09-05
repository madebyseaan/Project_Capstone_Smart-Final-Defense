# HANDOFF — SF Forms grade disconnect + Edit Request broken on locked terms

Investigated, not implemented. All refs are `file:line`.

## Bug A — Cannot request edit when term is locked (T1)

The feature exists FOR locked terms (`gradeLocks.ts:4-7`: APPROVED `GradeEditRequest` bypasses TERM lock only), but every entry point refuses when a lock is active.

### A1. Frontend hides the "Request Access" button when locked — PRIMARY
- `src/pages/teacher/ClassRecordView.tsx:935` — `onRequestEdit` requires `isPastTerm && !gradeLock && editRequestStatus === "idle"`. Term lock sets `gradeLock=true` → button gone exactly when needed.
- Root enabler: `server/src/routes/grades-sub/classes.ts:187` — API folds TERM lock into single boolean `gradeLock: systemLocked || yearLocked || queriedTermLocked`. Granular `locks` object IS returned (line 188) but frontend never reads it.
- `src/components/GradeStatusBanner.tsx:44-51` — `if (gradeLock)` branch renders lock banner with NO request button (button only at lines 108-116 in past-term branch). Also mislabels term lock as "Grades locked for EOSY".

### A2. Backend rejects requests for current-but-locked term — PRIMARY
- `server/src/routes/grades-sub/editRequests.ts:48-52` — guard `termOrder[term] >= termOrder[currentTerm]` → 400 "Can only request edit access for past terms". Uses term order, NOT lock state. If admin locks T1 while `resolveCurrentTerm()` = T1, request is impossible (hard dead end).
- Scenario: scheduler also auto-locks T1 on its end date (`server/src/index.ts:285-295`); if EnrollPro hasn't advanced the term, T1 is locked AND current.

### A3. Approved request never recognized in UI — SECONDARY
- `src/pages/teacher/ClassRecordView.tsx:130-145` — status fetch requires `isPastTerm && !gradeLock`. While term-locked, `editRequestStatus` stays `"idle"` → `isViewOnly` (line 105-107) stays true → all edit surfaces disabled (`ClassRecordTable.tsx:218,226,307,315,394,402`; `classRecordActions.ts:83,221,319`; `GradeEditModal.tsx:95,144,152,164`; `HGDescriptorPanel.tsx:74`). Backend bypass works (`gradeLocks.ts:98-107`); frontend never discovers it. Countdown timer (lines 110-127) also never activates.

### A4. Minor
- `editRequests.ts:55-61` — duplicate-PENDING check has no `schoolYear` filter → stale request from prior year blocks new requests for that term forever.
- `isPastTerm` (ClassRecordView.tsx:105) never true for current-but-locked terms.

### Fix direction (workhorse decides)
1. Use granular lock state: classes.ts already returns `locks.termLocks[term]`; frontend should allow Request Access when the TERM is locked (hide only for year/archived/system locks).
2. `editRequests.ts:48-52`: allow requests when the target term is locked even if it's the current term (check `getGradeLockState`).
3. `ClassRecordView.tsx:131`: fetch edit-request status when term-locked too, so APPROVED unlocks the UI.
4. Add `schoolYear` to the duplicate-PENDING query.

## Bug B — Teacher grade updates not reaching registrar SF forms

### Likely user-visible story (compounding)
T1 locked → `POST /api/grades/grade` returns 403 TERM_LOCKED (`classes.ts:257-266` → `gradeLocks.ts:98-107`) → grades never save → SF forms stay stale. Combined with Bug A, there is NO path to update. Fix A first, then verify B.

### Ranked root causes for "saved but not on SF forms"
1. **Prune engine deletes grades after every EnrollPro sync** — `server/src/lib/prune.ts:357-416` (Phases C/D/E: stale sections cascade-delete Section→ClassAssignment→Grade; stale students; stale enrollment pairs). Runs every ~5 min (`syncCoordinator.ts:253-270`) and on registrar student-list staleness trigger (`registrar/main.ts:472-475`). If EnrollPro data disagrees, current grades vanish from ALL forms simultaneously.
2. **Subject-grade alignment filter silently drops grades** — `isSubjectAlignedWithGrade` (`server/src/routes/registrar/helpers.ts:109-117`): subject code trailing digit must equal section gradeLevel. Applied on SF9 (`forms.ts:141-143,169-171`) and SF10 (`forms.ts:815-817,851-853`). Known trap: `ATLAS_SUBJECT_OVERRIDES` maps all env-sci to `ENVIRONMENTAL_SCIENCE7` (`atlasUtils.ts:58-66`) → dropped in GRADE_8/9/10 sections.
3. **Duplicate-CA priority loss** — ClassAssignment unique key allows same subject/section/year across two teachers (`schema.prisma:159`). `gradePriority` (forms.ts:113-118, 785-790) weights density (100/quarter) over freshness (~0.0017) → replaced teacher's denser old rows beat the new teacher's fresh updates.
4. **Snapshot fallback crashes SF10** — `forms.ts:767` reconstructs `section: { name }` WITHOUT `gradeLevel` → `gradeLevel.replace('GRADE_','')` (helpers.ts:110) throws on undefined → 500 for whole SF10 whenever student has zero live Grade rows and snapshot subject codes end in digits (seeded codes do: `MATH7`, `FIL7`).
5. **Null `quarterlyGrade`** — `calculateGrades` (`grades-sub/helpers.ts:288-318`) requires ALL of WW/PT/QA non-null; null grades save fine but never render on SF9/SF10/SF5 (`forms.ts:191,868-870`; `sf5Composer.ts:158`). Inverse bug: `applyMetaToScores` pads score arrays with 0/10 entries (`ClassRecordView.tsx:270-292`) → phantom grades from metadata-only saves.
6. **R7/R8: non-ENROLLED students invisible** — SF5/SF8/SF1 ENROLLED-only (`sf5Composer.ts:111-114`; `forms.ts:361,1021-1034`); registrar student picker ENROLLED-only (`registrar/main.ts:478-481`).

### Verified NOT the cause
- No push-to-EnrollPro on save (read-only; EnrollPro pulls via `integration.ts:78-239`).
- SF9/SF10/SF5 read LIVE Grade rows — no `status`/`isArchived`/`isActive` filter on grade queries; EOSY snapshots never shadow live grades (fallback only when zero live grades, `forms.ts:738`).
- FINALIZED status irrelevant for form display (matters only for EOSY/promotion/EnrollPro pull).
- No frontend caching (SchoolForms.tsx uses plain useState, fresh GETs).
- Dead code: `AlumniStudents.tsx:166-171` writes `sessionStorage.sf10Data` + nav params that `SchoolForms.tsx` never reads — alumni SF10 handoff broken (fails loud, not stale).

## Suggested fix order for workhorse
1. Bug A1+A2+A3 (edit request flow) — unblocks grade updates on locked terms.
2. Bug B1 — audit prune.ts Phase C/D/E against current-year data before enabling in prod.
3. Bug B4 — snapshot fallback crash (add `gradeLevel` to reconstruction or make `isSubjectAlignedWithGrade` null-safe).
4. Bug B2 + B3 — alignment trap and priority tie-breaking (freshness should beat density for same subject).
5. Bug B5 — partial-category grade visibility (product decision: show partial or require all 3).

## Test files to update/extend
- `server/src/__tests__/grade-lock.test.ts` — covers lock precedence; add: edit-request creation for current-but-locked term; APPROVED request flips teacher UI flags.
- `server/src/__tests__/sf10-snapshot.test.ts` — add: snapshot fallback with digit-suffixed codes (currently 500s).
- Verify after: `npm run build` in root AND `server/` (per AGENTS.md).
