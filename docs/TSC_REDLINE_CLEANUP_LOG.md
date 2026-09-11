# TSC Redline Cleanup — Running Log

> Companion to `docs/TSC_REDLINE_CLEANUP_PLAN.md`.
> Purpose: a breadcrumb trail. If anything regresses, this says exactly what changed, when, and how to undo it.

## Checkpoint / rollback anchors

| Anchor | Commit | Meaning |
|---|---|---|
| **C0 — Safe checkpoint** | `b816593` | Guardrails work, pushed. Last known-good before redline cleanup. |
| C1 — plan+log committed | `9e94534` | This plan + this log. |
| C2 — Select + JSX fixed | `095f528` | Select API aligned to @base-ui v1.3; React 19 JSX namespace. tsc 216 → 157. |
| C2b — status filter fix | `8bb9aef` | User Management Active/Inactive filter case-insensitive (pre-existing bug). |
| C3 — unused vars (batches 1–4B) | `02cd1ee` | tsc 216 → 92. 65/68 unused removed; 3 intentional exceptions. |
| C4 — long-tail structural | _(pending)_ | Remaining TS2339/2345/2322 etc. |

**Full rollback to last known-good:** `git reset --hard b816593`

---

## Baseline (Step 0)

Captured with: `npx tsc -b --force` (frontend).

- **Total errors: 216**
- ESLint: 1 error + 1211 warnings (warnings out of scope)

### By error code
| Code | Count | Meaning |
|---|---|---|
| TS6133 | 63 | declared but never read (unused var) |
| TS2739 | 46 | missing props → **Select cascade** |
| TS2339 | 40 | property does not exist |
| TS2345 | 23 | argument type mismatch |
| TS2322 | 18 | type not assignable |
| TS6192 | 5 | all imports unused |
| TS7006 | 5 | implicit any param |
| TS18048 | 3 | possibly undefined |
| TS2503 | 2 | cannot find namespace `JSX` (ExcelRenderer) |
| TS7053 | 2 | implicit any index |
| TS1117 | 2 | duplicate object property |
| TS2344 | 1 | type constraint (select.tsx Pick) |
| other | ~10 | misc single occurrences |

### Top files
| Count | File |
|---|---|
| 21 | src/pages/registrar/SchoolForms.tsx |
| 19 | src/layouts/AdminLayout.tsx |
| 18 | src/pages/admin/SystemSettings.tsx |
| 11 | src/components/ui/select.tsx |
| 10 | src/pages/admin/ClassAssignments.tsx |
| 9 | src/pages/teacher/Dashboard.tsx |
| 9 | src/pages/registrar/EOSYFinalization.tsx |
| 8 | src/pages/registrar/StudentRecords.tsx |
| 6 | src/pages/teacher/Attendance.tsx |

---

## Step log

### Step 0 — Baseline
- Changes: none
- tsc errors: **216**
- Build/tests: n/a
- Commit: none

<!-- Append one block per step, in order. -->

### Unused-variable cleanup — batches 1–3 (commits `a2682be`, `a75d464`, `8f606df`)
- Batch 1 (layouts): AdminLayout, RegistrarLayout, TeacherLayout. tsc 157 → 147.
- Batch 2 (imports/helpers, 10 files): tsc 147 → 135.
- Batch 3 (misc, 6 files): tsc 135 → 125.
- Each batch: verified `tsc` count dropped by exactly the number removed, frontend
  build OK, no new errors, committed separately (revertable individually).
- Server untouched throughout (build + 197 tests unchanged).
- Playwright smoke test of batches 1–2: **24/24 pages pass**.

### Unused-variable cleanup — batch 4 (commits `7665b15`, `02cd1ee`)
- Batch 4A (admin: SchoolYears, SystemSettings, TransmutationTable, UserManagement): tsc 125 → 117.
  (Also removed newly-orphaned `useNavigate`/`useTheme` imports.)
- Batch 4B (registrar + teacher: AlumniStudents, SF1Form, EOSYFinalization, SchoolForms,
  ClassRecordMobileList, ClassRecordTable, GradeEditModal, teacher/Dashboard): tsc 117 → 92.
- Special cases handled carefully (not blind-deleted):
  - `AlumniStudents`: kept the API call, dropped only the unused binding.
  - `hasChanges`/`sectionMeta`/`finalizeStatus`/`eosyMessage`/`loading`: kept the `useState`
    setter, dropped the unused value.
  - Unused callback params → `_`.
- Final unused count: **3 intentional exceptions**:
  1. `DEPED_DIVISIONS` (SystemSettings) — 115-line unused array; low value, large diff.
  2. `openEditDialog` / `openDeleteDialog` (UserManagement) — **feature gap**: the Edit/Delete
     User dialogs have no button to open them. Kept pending a decision (restore vs drop).

### Remaining after unused cleanup
- Total tsc errors: **92** (was 216). All remaining are **structural**:
  TS2339 (34), TS2345 (23), TS2322 (17), TS7006 (5), TS18048 (3), TS1117 (2), +5 singles.
- **Playwright smoke test re-run after batches 3–4: 24/24 pages PASS, 0 hard failures,
  no network errors.** (Same pre-existing non-boolean-attribute + HTML-nesting console warnings.)

### Step A — Select API alignment + React 19 JSX (commit `095f528`)
- **Reordered ahead of the unused-var pass on purpose:** one file (`select.tsx`) caused 47 errors,
  so it was the smallest edit surface for the biggest win.
- **Files:** `src/components/ui/select.tsx`, `src/components/ExcelRenderer.tsx`
- **Changes:**
  - Removed obsolete `avoidCollisions` + `position` props (not present in `@base-ui/react` v1.3;
    they were already ignored at runtime). Behavior-neutral.
  - `Pick<Positioner.Props, ...>` → `Partial<Pick<..., valid keys>>` so consumers are **not forced**
    to pass positioner props (this was the 46-file cascade).
  - Cast element `props` to `Record<string, any>` for React 19 types (`child.props` is `unknown`).
  - `JSX.Element` → `React.JSX.Element`.
- **Verification:**
  - `npx tsc -b --force`: **216 → 157** errors. `TS2739` 46 → 0. `select.tsx` + `ExcelRenderer.tsx` clean.
    **No new error codes introduced.**
  - Frontend `npm run build`: OK (16.3s). Server `npm run build`: OK. Server `npm test`: **197 passed / 0 failed**.
  - **Manual dropdown smoke test: PENDING (needs a human — see below).**
- **Rollback:** `git revert 095f528`

#### Manual smoke test — PASSED (user-confirmed)
- Admin → **User Management** → **Role** filter: works.
- Admin → **Class Assignments** dropdowns: work.
- List-page **pagination page-size** selector: works.
- Found an *unrelated* pre-existing bug: the Status filter never matched (case
  mismatch) — fixed separately in `8bb9aef` (Step B).

### Step B — User Management status filter (commit `8bb9aef`)
- **Pre-existing bug, NOT from Step A.** DB stores `status = "ACTIVE"`, but the filter
  options/display compared against `"Active"` / `"Inactive"`, so Active/Inactive always
  returned an empty table and every row showed "Inactive".
- **Files:** `src/pages/admin/UserManagement.tsx` (3 comparisons made case-insensitive).
- **Verification:** `npx tsc -b --force` unchanged at **157** (none new); frontend build OK.
- **Rollback:** `git revert 8bb9aef`
- **Manual smoke test: PENDING user** — select **Active** → should show all users;
  **Inactive** → 0 (there are currently no suspended users).

### Automated Playwright smoke test — PASSED (2026-09-11)
- Commits under test: `a2682be`, `a75d464`.
- **24/24 pages rendered, 0 failures, no network errors.** Sidebar nav OK on all 3 portals.
  27 screenshots in `tests/screenshots/`.
- Two **pre-existing** console warnings (not regressions):
  - `/admin/grading`: React "non-boolean attribute" dev warning.
  - `/registrar/roster`: `<div>` inside `<tr>` HTML-nesting warning.
- **GAP:** the report confirmed the Status dropdown *opens* but did not confirm it
  *filters* (Step B fix). Follow-up test requested: select Active → count rows;
  select Inactive → count rows.

### Status filter — UI-verified (Step B closed)
- Driven headless (Playwright) against `/admin/users`:
  - All → **42 rows**; Active → **42 rows**; Inactive → **0 rows** (empty state
    "No users found. Try adjusting your search or filters.").
- Confirms the Step B case-insensitive fix works in the real UI.

### Side effects from the external smoke-test agent (to decide)
- `package.json` + `package-lock.json`: **`playwright` was added** (unapproved).
- `tests/smoke-test.mjs` was created and contains **hardcoded local dev credentials**.
  `tests/` has been added to `.gitignore` so these never get committed.
- DECISION PENDING: keep `playwright` as a devDependency, or revert it.
