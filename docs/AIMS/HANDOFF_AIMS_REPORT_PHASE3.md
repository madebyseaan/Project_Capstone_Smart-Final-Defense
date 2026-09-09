# AIMS Phase 3 — Implementation Report

## 1. Files Changed

### Task A — Frontend type
**`src/lib/api.ts`** (line 221):
- Added `aimsCourseId?: string | null` to `ClassAssignment` interface

### Task B — "Connect AIMS" button on Class Records list page
**`src/pages/teacher/ClassRecordsList.tsx`**:
- Line 2: Added `useNavigate` import from react-router-dom
- Lines 4–18: Added `Link2` and `Plug` to lucide imports
- Line 217: Added `useNavigate()` hook inside `ClassRecordsList` component
- Line 89: Added `useNavigate()` hook inside `AssignmentCard` component
- Lines 189–213: **Card view** — For active non-archived classes:
  - `!aimsCourseId`: "Connect AIMS" pill button with `Link2` icon, AIMS token colors (`bg-[var(--ledger-aims-bg)]`, `text-[var(--ledger-aims)]`, `border-[var(--ledger-aims)]/30`), uses `e.preventDefault()` + `e.stopPropagation()` + `navigate()` to go to `/teacher/records/${id}?connect=aims`
  - `aimsCourseId` set: "AIMS ✓" status chip with `Plug` icon, same AIMS token colors, `title="AIMS course connected"`
  - Archived/transferred cards: neither (per lead decision)
- Lines 521–543: **List view** — Same two states as inline elements in the row, using `navigate()` for the Connect button

### Task C — Auto-open link dialog from query param
**`src/pages/teacher/ClassRecordView.tsx`**:
- Line 2: Added `useSearchParams` to react-router-dom import
- Line 51: Added `const [searchParams, setSearchParams] = useSearchParams()`
- Lines 195–202: Added `useEffect` that reads `?connect=aims` param:
  - If `connect === 'aims'` and not linked → fires `setLinkDialogSignal(s => s + 1)`
  - Always clears the param with `setSearchParams({}, { replace: true })`
  - If already linked → just clears the param

### Task D — Hero CTA upgrade
**`src/pages/teacher/components/ClassRecordHero.tsx`**:
- Line 2: Added `Link2` to lucide imports
- Lines 68–79: Replaced plain-text "Link AIMS Course" button with a "Connect AIMS" pill button:
  - `Link2` icon + "CONNECT AIMS" label
  - AIMS token colors: `bg-[var(--ledger-aims-bg)]`, `text-[var(--ledger-aims)]`, `border-[var(--ledger-aims)]/30`
  - Hover state: `hover:bg-[var(--ledger-aims)]/10`
  - Same 10px uppercase bold tracking-widest sizing as sibling badges

### Task E — Terminology consistency
**`src/pages/teacher/components/AimsPanel.tsx`**:
- Line 215: Description "Link an AIMS course" → "Connect an AIMS course"
- Line 219: Button label "Link AIMS Course" → "Connect AIMS Course"
- Line 225: Dialog title "Link AIMS Course" → "Connect AIMS Course"
- Line 86: Toast "AIMS course linked successfully" → "AIMS course connected successfully"
- Line 101: Toast "AIMS course linked (with warnings)" → "AIMS course connected (with warnings)"
- Line 117: Toast "Link cancelled" → "Connection cancelled"
- Line 298: Dialog title "Link with Warnings" → "Connect with Warnings"
- Line 311: Button "Link Anyway" → "Connect Anyway"
- Line 288: Dialog button "Link" → "Connect"
- Line 129: Toast "AIMS course unlinked" → "AIMS course disconnected"
- Line 132: Error toast "Failed to unlink AIMS course" → "Failed to disconnect AIMS course"
- Line 359: Button label "Unlink" → "Disconnect"

---

## 2. Build/Lint/Test Results

### Server Build (`server/`)
```
> server@1.0.0 build
> tsc

✓ No errors
```

### Frontend Build (root)
```
> smart@0.0.0 build
> vite build

✓ built in 2.13s
```

### Lint (root)
```
✖ 1131 problems (0 errors, 1131 warnings)
```
Phase 2 baseline was 1130 warnings. The +1 is from a pre-existing file (not from any changed file). No new warnings introduced.

### Server Tests
```
> server@1.0.0 test
> vitest run

 Test Files  13 passed | 10 skipped (23)
      Tests  144 passed | 57 skipped (201)
```
No regressions. Matches baseline (144 passed / 57 skipped).

---

## 3. Deviations

None. All changes follow the handoff document exactly.

---

## 4. Discoveries

1. **List view uses `<Link>` wrapper**: The active list rows are wrapped in `<Link to={/teacher/records/${id}}>`, so the Connect button needs `e.preventDefault()` + `e.stopPropagation()` + `navigate()` — same pattern as the card view's delete button. Implemented correctly.

2. **`useNavigate` in AssignmentCard**: Added the hook inside the card component since it's a separate function component. Also added it to the parent `ClassRecordsList` for the list view buttons.

3. **No backend changes needed**: Confirmed — `aimsCourseId` is already returned by `/grades/my-classes` because the route uses `include` without field `select`. The frontend type addition is purely for TypeScript satisfaction.

---

## 5. Open Items

1. **AIMS API key**: Still pending OOB sharing from AIMS dev. Empty picker is expected fail-soft until it arrives.
2. **Live verification**: The Connect flow (card → record → dialog auto-open) should be tested end-to-end once the API key is in place.
