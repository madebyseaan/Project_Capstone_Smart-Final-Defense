# TSC Redline Cleanup Plan

> Status: **PROPOSAL — NOT STARTED**
> Safety checkpoint: commit `b816593` (pushed to `origin/main`)
> Author: AI planning pass

## TL;DR — is this safe?

- The redlines are **pre-existing TypeScript type errors**. The app **runs fine** because the build (`vite build` → esbuild) **skips type-checking**. The editor (and `tsc`) does check types, which is why you see red.
- Fixing them is **mostly type-only** — it changes how the code is *described*, not how it *behaves*.
- There is **one runtime-relevant part** (the Select component: two obsolete props). Those props are **already ignored** by the installed library version, so behavior should not change — but we will **smoke-test dropdowns by hand** anyway.
- We work on the pushed checkpoint, **one root cause at a time**, verify after **every** edit, and commit after every green step. Any step can be undone with `git revert`.

**Rule we never break: if a step doesn't reduce errors without changing behavior, we revert it.**

---

## 1. Root causes (measured, not guessed)

### R1 — Select API drift (`@base-ui/react` v1.3) — the big one (~50 files)
`src/components/ui/select.tsx` was written for an older Base UI API:

| Old (in our code) | New (installed v1.3) |
|---|---|
| `avoidCollisions` (boolean) | `collisionAvoidance` (object: `SideFlipMode \| SideShiftMode`) |
| `position` (string) | **removed** |

Two effects:
1. `Pick<SelectPrimitive.Positioner.Props, "...avoidCollisions...|...position...">` — those keys **don't exist** → TS2344.
2. Because the `Pick` is invalid, the picked props become **required**, so every page using `<SelectContent>` errors “missing avoidCollisions, position” → TS2739. **That is the cascade across ~50 pages.**

### R2 — React 19 JSX namespace
`src/components/ExcelRenderer.tsx` uses the global `JSX` namespace, which React 19 removed. Fix: `React.JSX.Element`.

### R3 — Unused variables (`noUnusedLocals`)
Examples: `debouncedSearch` (TableToolbar), `colors` (GradeStatusBanner), `entry` (teacher/Dashboard). Trivial.

### R4 — Long tail
Remaining errors after R1–R3 (e.g. `classStats` shape mismatch). Handle individually, same loop.

---

## 2. Baseline to capture before starting (no changes)

- `npx tsc -b` → **total error count + per-file counts** (record in this doc).
- Known: SchoolForms 21, AdminLayout 19, SystemSettings 18, select.tsx 11, ClassAssignments 10, teacher/Dashboard 9, EOSYFinalization 9, StudentRecords 8 …
- `npx eslint .` → 1 error + 1211 warnings (warnings are out of scope).

---

## 3. Ground rules (non-negotiable)

1. **Never change dependencies.** No `npm install`, no version bumps, no lockfile edits. Alignment happens in *our* component code only.
2. **One root cause per step.** Never batch unrelated edits.
3. **After every edit:** run `npx tsc -b`, record the error count. It must go **down** (or stay equal for structural refactors) — never up.
4. **Commit after each green step** so rollback is one command.
5. **Touch only the files listed in the step.** No drive-by changes.
6. **UI steps require a manual smoke test** (open the page, use the widget).
7. **When unsure → stop and ask** rather than guess.

---

## 4. Steps (lowest risk → highest)

### Step 0 — Baseline snapshot (no code change)
- Run `npx tsc -b`, save the error list, record total + per-file counts here.
- **Verify:** recorded. **Commit:** none.

### Step 1 — Unused variables (LOW / type-only)
- Files: `TableToolbar.tsx`, `GradeStatusBanner.tsx`, `teacher/Dashboard.tsx` (`entry`), plus any other TS6133.
- Fix: delete the unused declaration or rename to `_name`.
- **Verify:** `tsc` count drops; frontend build OK.

### Step 2 — React 19 JSX namespace (LOW)
- File: `ExcelRenderer.tsx` (~lines 174, 177).
- Fix: `JSX.Element` → `React.JSX.Element`.
- **Verify:** `tsc` count drops; build OK.

### Step 3 — Select API alignment (MEDIUM — the big fix)
- File: `src/components/ui/select.tsx` **only** (consumers should then compile unchanged).
- Changes:
  a. Replace `avoidCollisions` with `collisionAvoidance` (object). Use a default that preserves “avoid collisions”
     (flip on side, shift on align) per v1.3 semantics.
  b. Remove the obsolete `position` prop + default.
  c. Change `Pick<...>` → `Partial<Pick<..., valid keys>>` (valid keys: `align`, `alignOffset`, `side`, `sideOffset`, `alignItemWithTrigger`) so consumers are **not forced** to pass them.
- **Verify:**
  - `tsc` error count drops by the whole cascade (should clear most of the ~50 files).
  - frontend build OK.
  - **Manual smoke test:** open pages with dropdowns (User Management, Class Assignments, list-page filters) — popup opens, positions correctly, closes, selection works.
- **If the cascade is not cleared:** revert this step and re-investigate. Do not pile on more changes.
- **Commit** once green.

### Step 4 — Re-measure + long tail (R4)
- Re-run `tsc`, list remaining errors, categorize, fix one-by-one with the same loop.
- If any fix would require a dependency change → **stop and ask**.

### Step 5 — Final verification
- `npx tsc -b` clean (or documented, justified remainder).
- Frontend `npm run build` OK.
- Server `npm run build` + `npm test` still **197 passed / 0 failed** (server is untouched, but confirm).
- One pass through the main pages (login, admin, teacher, registrar) to confirm nothing visual broke.
- **Commit.**

---

## 5. Per-step verification checklist (copy for every step)

- [ ] Only the intended file(s) changed (`git diff --stat`)
- [ ] `npx tsc -b` error count **decreased** (or unchanged for structural steps)
- [ ] `npm run build` (frontend) succeeds
- [ ] `server: npm run build` + `npm test` = 197 passed / 0 failed
- [ ] Manual smoke test of any UI touched
- [ ] Step committed (rollback point exists)

---

## 6. Rollback

- **One step:** `git revert <step-commit>` (safe, keeps history).
- **All the way back to checkpoint:** `git reset --hard b816593`.
- If a bad commit was already pushed: `git push --force-with-lease` only after confirming with the user.

---

## 7. Explicitly OUT of scope

- Upgrading or installing dependencies.
- Redesigning/refactoring UI behavior or layout.
- Fixing the 1211 ESLint **warnings** (only the 1 ESLint **error** may be addressed later).
- The optional script-organization work (READMEs / safety guards) — separate effort.

---

## 8. Why this cannot "regress"/Mimo-repeat

The previous regression likely came from a large, batched change with no per-step verification.
This plan makes that impossible:
- every step is small and verified against a **numeric** error count,
- every step is committed (revertable),
- UI changes get a **human smoke test**,
- dependencies are frozen,
- and we start from a known-good pushed checkpoint.
