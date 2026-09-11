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
| C3 — unused vars fixed | _(pending)_ | TS6133/TS6192 pass. |
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
