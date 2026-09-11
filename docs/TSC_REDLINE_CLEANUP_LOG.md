# TSC Redline Cleanup — Running Log

> Companion to `docs/TSC_REDLINE_CLEANUP_PLAN.md`.
> Purpose: a breadcrumb trail. If anything regresses, this says exactly what changed, when, and how to undo it.

## Checkpoint / rollback anchors

| Anchor | Commit | Meaning |
|---|---|---|
| **C0 — Safe checkpoint** | `b816593` | Guardrails work, pushed. Last known-good before redline cleanup. |
| C1 — plan+log committed | _(pending)_ | This plan + this log. |
| C2 — Step 1 done | _(pending)_ | Unused variables fixed. |
| C3 — Step 2 done | _(pending)_ | React 19 JSX namespace fixed. |
| C4 — Step 3 done | _(pending)_ | Select API alignment. |

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
