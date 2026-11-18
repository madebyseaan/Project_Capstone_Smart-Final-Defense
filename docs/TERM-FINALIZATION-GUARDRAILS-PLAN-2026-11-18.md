# Term Finalization Guardrails + Correction Windows — Anti-Regression Plan

**Date:** 2026-11-18
**Status:** IMPLEMENTED (pending final G6 full-suite gate). This supersedes the earlier guard-only draft.
**Scope owner:** Registrar Term Finalization + Teacher grade write paths + Admin edit requests
**Evidence dir:** `artifacts/term-finalization-guard/` (gitignored)
**Implementation notes:** schema/API/UI/permission split implemented; see Section 10 for the as-built summary and known test-data caveat.
**Related:**
- `docs/TERM-FINALIZATION-ROTATION-FIX-PLAN-2026-11-18.md`
- `docs/GRADE_PIPELINE_RULES.md`
- `docs/DEPLOYMENT_RUNBOOK.md`

---

## 0. Freeze rules

1. Every step is gated. A red gate stops the step; do not continue.
2. Never run `pm2 restart all`. Restart `server` or `client` individually.
3. Backend tests run **only** against an isolated `*_test` database.
4. Playwright specs stay **read-only**. No finalize/unfinalize/window actions are confirmed in E2E.
5. No changes to EOSY, promotion, SF9, SF10, advisory, or the scheduler's term-advance behavior.
6. Correction windows do **not** create a `TermGradeLock`. Locks stay admin/scheduler-owned.
7. Any file outside the G5 allowed list is a stop-and-review condition.
8. If a gate stays red, revert to the last known-good commit and re-run G0. Do not ship a partial feature.

**Existing tree warning:** the working tree already contains the rotation hotfix changes. Record them in `pre-existing-files.txt` before starting; do not mix them with correction-window commits.

---

## 1. Problem

Term finalization is a row-level seal only. Verified gaps:

| # | Gap | Location |
|---|---|---|
| G1 | Deleting a single finalized grade is allowed. | `server/src/routes/grades-sub/classes.ts:876-988` |
| G2 | ECR import overwrites finalized scores while leaving `FINALIZED`. | `server/src/lib/ecrImport.ts:198-210`, `:334-338` |
| G3 | New grade rows can be created in a finalized term. | `classes.ts:459` checks only an existing row |
| G4 | Teacher UI does not show finalized/read-only state. | `src/pages/teacher/hooks/useEditAccess.ts:57` |
| G5 | Edit requests only work for past terms and bypass term locks only. | `server/src/routes/grades-sub/editRequests.ts:49`; `server/src/lib/gradeLocks.ts:106` |
| G6 | No registrar visibility, notification, or review/re-finalize step. | no registrar edit-request route/UI |

---

## 2. Product flow (approved)

**Teacher → Admin → Registrar → Teacher → Registrar**

1. Registrar finalizes T1 for a section/subject. Grades become `FINALIZED`.
2. Teacher sees read-only + **Request Correction** for that class + term (even if the term is current).
3. Teacher submits a scoped request: SY, term, class assignment, section, subject, reason.
4. Admin reviews and approves with a duration (1–168h), as today. The timer does **not** start yet.
5. Registrar sees the approved request on the dashboard, the notification bell, and the Term Finalization page.
6. Registrar clicks **Open edit window**:
   - Baseline snapshots of the scoped `FINALIZED` grades are captured.
   - Scoped grades become `DRAFT`.
   - Timer starts now.
   - Audit log records the action.
7. Teacher edits normally while the window is open; UI shows the countdown.
8. Window ends (timer or registrar closes early):
   - Request becomes `EXPIRED`.
   - Grades stay `DRAFT`.
   - Registrar is notified: “Needs re-finalization.”
9. Registrar opens **View grades → Review changes**:
   - Before (baseline) vs After (current) values.
   - Changed fields are highlighted.
   - If nothing changed: “No changes were made.”
10. Registrar clicks **Re-finalize**:
    - Scoped `DRAFT` rows become `FINALIZED`.
    - Request becomes `REFINALIZED`.
    - Audit log records the action.
11. Registrar may **Decline** an approved request before opening the window. No grades change.

### Authority split (recorded)

| Action | Owner |
|---|---|
| Request correction | Teacher |
| Approve exception + duration | Admin |
| Open/close window, review, re-finalize, decline | Registrar |
| Encode grades | Teacher |

The system has only `TEACHER`, `ADMIN`, `REGISTRAR` (`server/prisma/schema.prisma:701`). There is no PRINCIPAL role. If deployment maps ADMIN to the School Head/Principal, document that assumption. Do not describe ADMIN as principal in code copy.

---

## 3. Decisions

| ID | Decision | Rationale |
|---|---|---|
| D1 | No automatic `TermGradeLock` on finalize. | Locks are global per SY + term; finalization is per section/subject. |
| D2 | A class assignment + term is **sealed** when any `FINALIZED` row exists. Once sealed: no save, new row, delete, clear, or import. | Closes all write-path holes. |
| D3 | Sealed is bypassed only by an **open correction window** (`WINDOW_OPEN` + valid `expiresAt`) for that exact class + term. Approved-but-not-opened does **not** bypass. | Timer starts when the registrar opens the window. |
| D4 | ECR and AIMS imports are hard-blocked while sealed. | Bulk writes must not partially drift. |
| D5 | A correction window captures a baseline JSON of the scoped grades before unfinalizing. | Registrar review must show exactly what changed. |
| D6 | Expiry leaves grades `DRAFT`; no auto-re-finalize. | Registrar must review before sealing again. |
| D7 | Lock precedence unchanged: archived → year lock → term lock → system lock → finalization/window. | Existing error codes stay stable. |
| D8 | Approved/window edit requests remain scoped to teacher + SY + term + class assignment. | Prevents one approval from unlocking every class. |
| D9 | `LOCKED` grade status remains out of scope. Only `FINALIZED` is sealed. | No writer creates `LOCKED`. |
| D10 | Registrar cannot edit grades directly, only open/close/re-finalize/decline. | Preserves teacher ownership of encoding. |

---

## 4. Data model changes

**File:** `server/prisma/schema.prisma`

### `GradeEditRequest`

Add:

```prisma
windowRequired      Boolean   @default(false)
approvedHours       Int?
windowOpenedAt      DateTime?
windowOpenedById    String?
windowOpenedByName  String?
windowClosedAt      DateTime?
refinalizedAt       DateTime?
refinalizedById     String?
refinalizedByName   String?
declineReason       String?
unfinalizedGradeCount Int     @default(0)
baseline            Json?
```

`expiresAt` semantics:
- Legacy request: set at admin approval (existing behavior).
- Correction window: `null` at approval; set when the registrar opens the window.

### `EditRequestStatus`

Add:

```prisma
WINDOW_OPEN
REFINALIZED
DECLINED
```

Existing values: `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`.

### Migration

Create one additive migration:
- New enum values.
- New nullable/defaulted columns.
- No destructive changes, no seed changes.

---

## 5. Backend changes

### 5.1 Seal helper

**New file:** `server/src/lib/gradeFinalization.ts`

```ts
export async function isClassTermFinalized(classAssignmentId: string, term: Term): Promise<boolean>
export async function getTermFinalizationBlock(classAssignmentId: string, term: Term): Promise<{
  code: "TERM_FINALIZED";
  message: string;
  finalizedCount: number;
} | null>
```

Message: `Grades for ${term} are finalized. Request a correction or contact the registrar.`

### 5.2 Teacher write paths

**File:** `server/src/routes/grades-sub/classes.ts`

- Single save: after existing lock/current-term checks, block when sealed unless the teacher has an active `WINDOW_OPEN` request for that class + term.
- Batch save: same; return `savedCount: 0`, all updates in `skipped`.
- Delete grade: block when sealed unless active window.
- Clear scores: keep existing finalized block; also block when sealed.
- Do not change lock precedence, response shapes, or audit success paths.

**Files:** `server/src/routes/grades-sub/ecr.ts`, `server/src/routes/grades-sub/aims.ts`

- Add seal guard before parsing/importing. Block unless active window.
- Keep existing per-row skip logic in libs.

**File:** `server/src/lib/gradeLocks.ts`

- Add `hasActiveEditWindow(teacherUserId, term, schoolYear, classAssignmentId)`.
- `hasApprovedEditRequest` remains for legacy term-lock bypass.
- `checkGradeEditLocks` accepts `classAssignmentId?` and treats `WINDOW_OPEN` with valid `expiresAt` as bypass for the TERM lock.

**Current-term checks** in `classes.ts`, `ecr.ts`, `aims.ts`:
- Treat both `APPROVED` (legacy) and `WINDOW_OPEN` (correction) as valid access.
- Use one shared helper to avoid four divergent queries.

### 5.3 Teacher request creation

**File:** `server/src/routes/grades-sub/editRequests.ts`

- Allow a request when:
  - term is past (legacy path), OR
  - the exact class assignment + term is sealed.
- For a sealed class, require `classAssignmentId`; verify it belongs to the teacher; set `windowRequired: true`.
- Legacy past-term requests keep `windowRequired: false`.
- Duplicate pending check includes `schoolYear` + `classAssignmentId`.
- Reject if an active request already exists for the same scope:
  - `PENDING`, `APPROVED`, `WINDOW_OPEN`.
- Response includes `windowRequired`.

### 5.4 Admin approval/rejection

**File:** `server/src/routes/grades-sub/editRequests.ts`

- Approve:
  - `windowRequired: true` → status `APPROVED`, `approvedHours = durationHours`, `expiresAt = null`.
  - legacy → existing behavior (`expiresAt = now + hours`).
- Reject: only `PENDING`; status `REJECTED`.
- Revoke: only legacy `APPROVED` or `WINDOW_OPEN`? For correction windows, do **not** allow admin revoke. Registrar closes windows. Return 400 with a clear message.
- Add audit-log details.

### 5.5 Registrar correction-window APIs

**New file:** `server/src/routes/registrar/editRequests.ts`, registered in `server/src/routes/registrar.ts`.

All require `authenticateToken` + `REGISTRAR` role.

| Method | Path | Purpose |
|---|---|---|
| GET | `/registrar/edit-requests` | List correction-window requests for a SY; returns counts + items |
| GET | `/registrar/edit-requests/summary` | Counts only (dashboard/bell) |
| POST | `/registrar/edit-requests/:id/open-window` | Capture baseline, unfinalize scoped grades, start timer |
| POST | `/registrar/edit-requests/:id/close-window` | Close early; grades stay DRAFT |
| POST | `/registrar/edit-requests/:id/decline` | Decline approved request; no grade change |
| POST | `/registrar/edit-requests/:id/refinalize` | Re-finalize DRAFT rows, close request |
| GET | `/registrar/edit-requests/:id/review` | Baseline vs current, changed fields |

**Open-window rules:**
- Request must be `APPROVED`, `windowRequired`, with `classAssignmentId`, `term`, `schoolYear`.
- Year not archived; EOSY not finalized; class assignment exists.
- Capture baseline for all `FINALIZED` grades for that CA + term.
- Transaction: `FINALIZED → DRAFT`, clear `finalizedAt/finalizedBy`, update request to `WINDOW_OPEN`, set `windowOpenedAt`, `expiresAt`, `unfinalizedGradeCount`, `baseline`.
- Audit `CONFIG`/`UPDATE` with counts.

**Close-window / expiry rules:**
- `WINDOW_OPEN → EXPIRED`; set `windowClosedAt`.
- Grades remain `DRAFT`.
- No auto-refinalize.

**Refinalize rules:**
- Request must be `EXPIRED` (or `WINDOW_OPEN` closed first).
- Only scoped `DRAFT` grades → `FINALIZED`.
- Set `refinalizedAt`, `refinalizedById/Name`, status `REFINALIZED`.
- Respect EOSY/archived guards.
- Audit.

**Review response:**

```ts
{
  request: { ... },
  students: Array<{
    studentId: string;
    studentName: string;
    before: GradeSnapshotFields;
    after: GradeSnapshotFields;
    changedFields: string[];
  }>,
  changedCount: number,
  unchangedCount: number,
}
```

### 5.6 Expiry

**File:** `server/src/index.ts` scheduler

- Existing: auto-expire legacy `APPROVED` requests with `expiresAt < now`.
- Add: `WINDOW_OPEN` with `expiresAt < now` → `EXPIRED`, set `windowClosedAt`.
- Never auto-refinalize.
- Keep logs concise; no new error-level lines.

---

## 6. Frontend changes

### 6.1 Types/API

**File:** `src/lib/api.ts`

- Extend edit request status union.
- Add correction-window request type and API methods:
  - `getRegistrarEditRequests(params)`
  - `getRegistrarEditRequestSummary()`
  - `openEditWindow(id)`
  - `closeEditWindow(id)`
  - `declineEditWindow(id, reason?)`
  - `refinalizeEditWindow(id)`
  - `reviewEditWindow(id)`
- Add `status` to `Grade`.

### 6.2 Teacher

**File:** `src/pages/teacher/hooks/useEditAccess.ts`

- Accept `isTermFinalized` and `classAssignmentId`.
- Track request states: `idle`, `pending`, `awaiting_window`, `window_open`, `approved` (legacy).
- `isViewOnly`:
  - sealed and no active window → true.
  - active window → false.
  - hard locks → true.
  - legacy past-term rules unchanged.
- `canRequestEdit` true when sealed and no active/pending request.
- Do not show the request button when a request is already pending/approved/open.

**File:** `src/pages/teacher/ClassRecordView.tsx`

- Compute `isTermFinalized` from raw current class assignment grades.
- Pass to hook and banner.
- Banner states:
  - sealed → “Term X is finalized — read-only” + Request Correction.
  - pending → “Correction request pending admin approval”.
  - awaiting window → “Approved — waiting for registrar to open the edit window”.
  - window open → “Correction window open — Xh remaining”.
  - legacy approved → existing countdown.

**File:** `src/components/GradeStatusBanner.tsx`

- Add finalized, pending-correction, awaiting-window, window-open branches.
- Priority: hard locks → window open → sealed/finalized → legacy past-term/term-lock branches.
- Add `data-testid` for Playwright.

**File:** `src/pages/teacher/components/EditRequestModal.tsx`

- Copy adapts to finalized vs past term.
- Sends class assignment scope.
- API error surface uses toast, not `alert`.

### 6.3 Registrar dashboard

**File:** `src/pages/registrar/Dashboard.tsx`

Add a **Grade Correction Windows** card near Rollover Readiness:

- Counts: Awaiting window, Open windows, Needs re-finalization.
- Table/list of up to 5 items: teacher, section · subject, term, status, countdown.
- Actions:
  - `Open window` for approved.
  - `Close` for open.
  - `Review` for expired.
- Empty state: “No correction windows. All finalized grades are sealed.”
- Links to `/registrar/term-finalization?sectionId=...&term=...` and `?filter=corrections`.
- Poll every 30s, matching the dashboard's existing poll.
- Add `data-testid="registrar-correction-windows"`.

### 6.4 Notification bell

**File:** `src/hooks/useNotifications.ts`

- Registrar branch calls `getRegistrarEditRequestSummary()`.
- Notifications:
  - `correction-awaiting-window:{count}` → “N approved correction request(s) awaiting window”, href `/registrar/term-finalization?filter=corrections`.
  - `correction-needs-refinalize:{count}` → “N correction window(s) need re-finalization”, same href.
- Admin branch unchanged (pending requests).
- Teacher branch: show approved/window-open request status if available (optional; use class view banner as source of truth).

### 6.5 Term Finalization page

**Files:** `TermFinalization.tsx`, `TermFinalizationSectionCard.tsx`, new `CorrectionWindowsPanel.tsx`, new `CorrectionReviewModal.tsx`.

- Top panel “Correction windows” when `filter=corrections` or count > 0.
- Section card badges:
  - “Correction approved” (approved, not opened)
  - “Edit window open · Xh left”
  - “Needs re-finalization · N drafts”
- Subject row action logic:
  - While window open, show `Close window` instead of Finalize/Unfinalize.
  - After expiry, show `Re-finalize`.
  - After re-finalized, normal Finalized badge.
- Review modal:
  - Student table with Before / After / Changed.
  - Changed cells highlighted.
  - Actions: Close window (if open), Re-finalize (if expired).
- Existing finalize/unfinalize actions stay unchanged for non-correction flows.

---

## 7. Anti-regression gates

Artifacts: `artifacts/term-finalization-guard/<step>/`.

### G0 — Baseline

```powershell
git status --short
npx pm2 status
npx pm2 logs server --lines 300 --nostream --timestamp | Out-File -Encoding utf8 artifacts\term-finalization-guard\pre\pm2-baseline.log
npx pm2 logs server --err --lines 100 --nostream --timestamp | Out-File -Encoding utf8 artifacts\term-finalization-guard\pre\pm2-error-baseline.log
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health
pnpm run verify
pnpm run test:e2e
```

Pass: baseline captured, health 200, verify green, full E2E green or documented unrelated baseline failure.

### G1 — Backend tests

```powershell
$env:DATABASE_URL="<TEST_DATABASE_URL>"
pnpm --prefix server exec ts-node --transpile-only scripts/seed-test-base.ts
pnpm --prefix server exec vitest run `
  src/__tests__/term-finalization-guard.test.ts `
  src/__tests__/term-finalization.test.ts `
  src/__tests__/gradeLocks-lib.test.ts `
  src/__tests__/aims-sync.test.ts `
  src/__tests__/grading-mode-api.test.ts
```

Required cases:
1. DRAFT class save works.
2. Sealed class blocks save/new row/delete/clear/ECR/AIMS.
3. Batch returns `savedCount: 0`.
4. Teacher can create a correction request for a sealed current term.
5. Admin approval leaves grades `FINALIZED` and `expiresAt` null.
6. Registrar open-window: grades `DRAFT`, baseline captured, `WINDOW_OPEN`, expiry set.
7. During window, teacher save succeeds.
8. Close/expiry: grades stay `DRAFT`, status `EXPIRED`.
9. Review returns changed fields.
10. Re-finalize: grades `FINALIZED`, status `REFINALIZED`.
11. Decline: no grade change.
12. Legacy past-term edit request still works.
13. Legacy approved request still bypasses term lock.
14. Year/archived locks cannot be bypassed by window.
15. EOSY-finalized section cannot open a window.
16. Existing finalization suite green.

### G2 — Typecheck/build/lint

```powershell
pnpm run typecheck
pnpm run build
pnpm run lint
pnpm --prefix server run build
pnpm --prefix server run prisma:generate
```

Pass: all exit 0.

### G3 — PM2 log gate (after every backend step)

```powershell
npx pm2 logs server --lines 100 --nostream --timestamp | Out-File -Encoding utf8 artifacts\term-finalization-guard\<step>\pm2-before.log
npx pm2 restart server --update-env
Start-Sleep -Seconds 5
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health
npx pm2 logs server --lines 300 --nostream --timestamp | Out-File -Encoding utf8 artifacts\term-finalization-guard\<step>\pm2-after.log
npx pm2 logs server --err --lines 100 --nostream --timestamp | Out-File -Encoding utf8 artifacts\term-finalization-guard\<step>\pm2-error.log
Select-String -Path artifacts\term-finalization-guard\<step>\pm2-after.log `
  -Pattern "Error:|Unhandled|UnhandledPromiseRejection|PrismaClient|ECONNREFUSED|HTTP 500|status.:\s*500"
```

Pass: no new error signatures vs baseline; `server`/`client` online; health 200.

### G4 — Playwright gate

```powershell
pnpm exec playwright test `
  e2e/term-finalization.spec.ts `
  e2e/term-finalization-guard.spec.ts `
  e2e/eosy-finalization-status.spec.ts `
  e2e/grades-alignment.spec.ts `
  e2e/grading-mode-teacher.spec.ts `
  e2e/teacher-ux-guard.spec.ts `
  --trace=retain-on-failure
```

Playwright coverage:
- Teacher finalized class shows banner + Request Correction.
- Teacher DRAFT class remains editable.
- Registrar dashboard correction card renders (empty or populated) with no console/API errors.
- Registrar term-finalization page loads correction panel without errors.
- Notification bell renders registrar correction notification when summary is stubbed.
- Mobile finalized class: read-only, no horizontal overflow.
- No non-GET `/api/grades/*` or `/api/registrar/edit-requests/*` actions in E2E; use route interception for data.

### G5 — Scope diff

Allowed files:

```text
server/prisma/schema.prisma
server/prisma/migrations/<new>_grade_correction_windows/migration.sql
server/src/lib/gradeFinalization.ts
server/src/lib/gradeLocks.ts
server/src/lib/editRequestWindows.ts
server/src/routes/grades-sub/classes.ts
server/src/routes/grades-sub/ecr.ts
server/src/routes/grades-sub/aims.ts
server/src/routes/grades-sub/editRequests.ts
server/src/routes/registrar.ts
server/src/routes/registrar/editRequests.ts
server/src/routes/registrar/termFinalization.ts
server/src/schemas/grades.ts
server/src/schemas/registrar.ts
server/src/index.ts
server/src/__tests__/term-finalization-guard.test.ts
server/src/__tests__/aims-sync.test.ts
src/lib/api.ts
src/lib/termFinalizationTypes.ts
src/hooks/useNotifications.ts
src/components/GradeStatusBanner.tsx
src/pages/teacher/hooks/useEditAccess.ts
src/pages/teacher/ClassRecordView.tsx
src/pages/teacher/components/EditRequestModal.tsx
src/pages/teacher/components/ExcelExchangePanel.tsx
src/pages/admin/components/EditRequestModals.tsx
src/pages/admin/EditRequests.tsx
src/pages/registrar/Dashboard.tsx
src/pages/registrar/TermFinalization.tsx
src/pages/registrar/components/TermFinalizationSectionCard.tsx
src/pages/registrar/components/CorrectionWindowsPanel.tsx
src/pages/registrar/components/CorrectionReviewModal.tsx
e2e/term-finalization-guard.spec.ts
e2e/term-finalization.spec.ts
docs/TERM-FINALIZATION-GUARDRAILS-PLAN-2026-11-18.md
```

### G6 — FINAL

```powershell
$env:DATABASE_URL="<TEST_DATABASE_URL>"
pnpm run verify
pnpm run test:e2e
```

Then 30-minute read-only registrar/teacher soak + PM2 log capture as in G3.

### G7 — Deploy smoke

```powershell
npx pm2 restart server --update-env
npx pm2 restart client --update-env
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health
pnpm exec playwright test e2e/term-finalization-guard.spec.ts e2e/term-finalization.spec.ts --trace=retain-on-failure
npx pm2 logs server --lines 200 --nostream --timestamp | Out-File -Encoding utf8 artifacts\term-finalization-guard\final\pm2-deploy.log
```

Pass: health 200, targeted specs green, PM2 clean. Then freeze.

---

## 8. Rollback

1. Revert code + migration commit; run the down migration only if the migration was applied to a disposable DB. Live DB: restore backup.
2. Restart `server` and `client` individually.
3. Re-run G4 targeted Playwright.
4. No data repair: grades remain as they were before the reverted flow.

---

## 9. Definition of done

- [ ] Schema + additive migration applied and generated.
- [ ] Sealed class blocks all teacher write paths.
- [ ] Correction request works for sealed current terms.
- [ ] Admin approval starts no timer for correction windows.
- [ ] Registrar open-window captures baseline, unfinalizes scoped grades, starts timer.
- [ ] During-window teacher edits succeed.
- [ ] Expiry/close leaves grades DRAFT and notifies registrar.
- [ ] Review shows before/after and changed fields.
- [ ] Re-finalize seals grades again and closes the request.
- [ ] Decline changes no grades.
- [ ] Registrar dashboard card, notification bell, and term-finalization queue are live.
- [ ] Teacher UI shows the correct state at every step.
- [ ] Legacy past-term edit requests and term-lock bypass still work.
- [ ] Year/archived/EOSY guards unchanged.
- [ ] G0–G7 green with evidence.
- [ ] No `pm2 restart all`; no live-DB test writes; no E2E mutations.

---

## 10. As-built summary (2026-11-18)

### Schema
- `GradeEditRequest` now stores `windowRequired`, `approvedHours`, window open/close/refinalize timestamps and actor names, `declineReason`, `unfinalizedGradeCount`, and the `baseline` JSON snapshot.
- `EditRequestStatus` now includes `WINDOW_OPEN`, `REFINALIZED`, `DECLINED`.
- Additive migration: `server/prisma/migrations/20261118120000_add_grade_correction_windows/migration.sql`.

### Backend
- `server/src/lib/gradeFinalization.ts` � seal helper and active-window bypass.
- `server/src/lib/editRequestWindows.ts` � open/close/decline/refinalize/review/list/summary.
- `server/src/routes/registrar/editRequests.ts` � registrar correction-window API.
- `server/src/routes/grades-sub/editRequests.ts` � teacher requests for sealed classes; admin approval stores duration without starting the timer.
- Teacher write paths reject sealed/expired-window classes but allow an open window:
  - `classes.ts` single save, batch save, delete, clear.
  - `ecr.ts` import.
  - `aims.ts` import.
- Scheduler closes expired `WINDOW_OPEN` requests without re-finalizing.

### Frontend
- Teacher: finalized banner + Request Correction; pending, awaiting-window, open-window countdown, awaiting-refinalize states; inputs/import/clear disabled by the existing `isViewOnly` plumbing.
- Admin: approve copy distinguishes correction windows; revoke hidden for window requests; new status badges.
- Registrar:
  - `CorrectionWindowsCard` on the dashboard and Term Finalization page.
  - `CorrectionReviewModal` with Before/After/Changed columns.
  - Open/Close/Decline/Re-finalize actions.
  - Notification bell derives �awaiting window� and �needs re-finalization� alerts.

### Verification run
- `pnpm --prefix server run build` � green.
- `pnpm run typecheck` � green.
- `pnpm run build` � green.
- Focused backend suites: `term-finalization-guard.test.ts` (13 tests), `term-finalization.test.ts`, `gradeLocks-lib.test.ts`, `aims-sync.test.ts`, `grading-mode-api.test.ts` � 95 tests green.
- `e2e/term-finalization-guard.spec.ts` � 4/4 green.
- `e2e/term-finalization.spec.ts` � data-dependent rotation assertion currently expects `data-draft=5` but dev data has T1 finalized (`draft=0`, `finalized=5`). This is a pre-existing fixture-data mismatch, not a guard regression. Re-seed or relax the fixture before the G6 full-suite gate.

### Known caveat
The dev database currently has T1 finalized for Aguinaldo/Bonifacio, so the older rotation E2E spec fails on its hard-coded draft count. Final G6 must either re-seed the expected draft state or make that assertion state-aware.

### Transparency + early end (follow-up, 2026-11-18)
- Teachers can end an open correction session early from the class-record banner (`End editing`). The server closes the window, keeps grades `DRAFT`, audits the action, and leaves the request awaiting registrar re-finalization.
- Registrar review now shows:
  - The teacher's stated reason.
  - Human-readable changes (for example `Added WW 4 (9/10)`, `WW 2: 8/10 ? 9/10`).
  - Changed areas and an amber warning when an input category changed outside the stated reason (for example reason says Written Work, but Performance Task also changed).
  - Derived grades (Initial/Quarterly) remain visible but do not trigger the outside-reason warning.
- Dashboard cards also show the teacher's reason inline.
- Review modal redesigned for readability:
  - widened to `xl`, one card per student instead of a cramped table;
  - **Encoded changes** (WW/PT/TA inputs) separated from **Computed changes** (percentages, Initial, Quarterly);
  - unchanged students collapsed behind a �Show N unchanged� toggle;
  - the teacher�s reason and the outside-reason warning remain pinned above the list.
