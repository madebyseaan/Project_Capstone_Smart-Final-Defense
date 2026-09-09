# ClassRecordView.tsx Performance Audit Report

**File:** `src/pages/teacher/ClassRecordView.tsx` (238 lines)
**Audit Date:** September 5, 2026
**Auditor:** Automated + Playwright Live Testing
**Test Class:** Developmental Reading 8 (6 students, 1 WW, 1 PT, 1 QA)

---

## Executive Summary

ClassRecordView exhibits **significant lag** caused by a cascade of re-render amplification patterns. A single score edit triggers approximately **142 DOM mutations** and multiple long tasks (up to 324ms). The root cause is a combination of a defeated React.memo key pattern, excessive state propagation, and missing memoization — not the table size itself. With only 6 students and 23 inputs the page already feels sluggish; at 40+ students the lag becomes severe.

---

## Live Playwright Test Results

| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
| DOM total elements | 616–663 | < 500 ideal | WARN |
| Total inputs | 23 (base) / 31 (w/ Assessment panel) | — | OK |
| JS heap usage | 35 MB | < 100 MB | OK |
| DOM complete time | 714 ms | < 500 ms | WARN |
| Score edit → DOM mutations | 142 | < 20 | **CRITICAL** |
| Long tasks observed | 8 (max 324 ms) | 0 ideal | **CRITICAL** |
| Score commit cycle (type→save→refetch→render) | ~3.2 seconds | < 500 ms | **CRITICAL** |
| Assessment Details panel toggle | 1.5 seconds (adds 47 DOM nodes, 8 inputs) | < 200 ms | HIGH |
| Network requests on page load | 177+ (including 3x admin/settings calls) | < 20 | **CRITICAL** |
| API calls per score edit | 2 (saveGrade + full class-record refetch) | 1 | HIGH |
| SSE stream connection | Reconnects on navigation (ERR_ABORTED → 200) | — | LOW |

---

## Critical Issues (Severity: CRITICAL)

### 1. React Key Defeats Memoization — Full Row Remount on Every Update

**File:** `ClassRecordTable.tsx:874, 891, 898`
**Impact:** Every data update forces ALL LedgerRow components to unmount and remount, completely negating React.memo.

```tsx
// CURRENT (BROKEN)
<LedgerRow key={`${r.student.id}-${dataUpdatedAt}`} ... />

// LedgerRow is wrapped in React.memo (line 129), but the key changes
// every time dataUpdatedAt changes (every score save + refetch).
// React treats changed keys as new components → full unmount/remount.
```

**Why it's critical:** Even though `LedgerRow` is memoized, the changing key forces React to destroy and recreate every row. This is the single largest contributor to lag. For 40 students with 30 columns each, this means ~1200 input elements are destroyed and recreated on every score edit.

**Fix:** Remove `dataUpdatedAt` from the key. Use `r.student.id` alone. If you need to force re-render on data update, use a separate mechanism (e.g., a version counter in a context, or let React's normal reconciliation handle it).

---

### 2. Triple State Setter Cascade in useAssessmentMeta

**File:** `hooks/useAssessmentMeta.ts:56-85`

```tsx
useEffect(() => {
  // ... derives meta from classRecord ...
  setWwMeta(...);   // State update 1
  setPtMeta(...);   // State update 2
  setQaMeta(...);   // State update 3
}, [classRecord, selectedTerm, wwCount, ptCount]);
```

**Impact:** Every time `classRecord` reference changes (every score save), this effect fires and triggers 3 sequential state updates. While React 18 batches these, the resulting re-render propagates `wwMeta`, `ptMeta`, and `qaMeta` as new references to `ClassRecordTable`, `AssessmentHeader`, and `GradeEditModal`.

**Fix:** Combine into a single state setter or use `useRef` for mutable metadata that doesn't trigger re-renders.

---

### 3. commitScoreInput Not Memoized

**File:** `ClassRecordView.tsx:167-190`

```tsx
// This is a plain function, NOT wrapped in useCallback
const commitScoreInput = (inputEl, studentId, category, index): boolean => {
  // ... validation + handleScoreUpdate call ...
};
```

**Impact:** `commitScoreInput` is passed as `onScoreCommit` to `ClassRecordTable` → `LedgerRow`. Since it's recreated every render, every `LedgerRow` receives a new `onScoreCommit` prop, which would normally cause re-render — except the key remount issue (#1) already forces it. Once #1 is fixed, this becomes the next bottleneck.

**Fix:** Wrap in `useCallback` with appropriate dependencies.

---

## High Severity Issues

### 4. Full Class Record Refetch After Every Score Save

**File:** `components/classRecordActions.ts:260-276`

After `gradesApi.saveGrade()` succeeds, `executeScoreUpdate` calls `fetchClassRecord(true)` which triggers a full query refetch. This means:

1. POST `/api/grades/grade` (~389 ms)
2. GET `/api/grades/class-record/:id` (~18 ms but triggers full re-render)

The optimistic update already updated local state. The refetch then replaces the entire `classRecord` array with a new reference from the server, triggering the full cascade (hpsData → sortedRecords → stats → meta derivation → triple state setter → LedgerRow remount).

**Fix:** After successful save, merge the saved data into the existing cache instead of refetching. Use `queryClient.setQueryData` to patch the specific student's grade in-place.

---

### 5. Redundant API Calls on Page Load

**Network trace showed:**
- `GET /api/admin/settings` called **3 times** on initial load (requests #72, #73, and later #143, #147, #150, etc.)
- `GET /api/grades/my-classes` called **4 times**
- `GET /api/grades/deadline-status` called **4 times**
- `GET /api/grades/dashboard` + `dashboard-stats` + `mastery-distribution` + `advisory-honors` called **3 times each**

This is caused by:
- `useEffect(() => { adminApi.getSettings() }, [])` in ClassRecordView (L91-93)
- Layout components (AdminLayout/TeacherLayout) also fetching settings
- React Query `refetchOnWindowFocus` and `refetchOnMount` defaults
- Multiple components independently fetching the same data

**Fix:** Consolidate settings into a single provider/context. Use React Query's `staleTime` to prevent redundant refetches of shared data.

---

### 6. Massive useCallback Dependency Arrays

**File:** `ClassRecordView.tsx:127-146`

```tsx
const handleScoreUpdate = useCallback(async (...) => {
  // ...
}, [editAccess.isViewOnly, classAssignmentId, classRecord, selectedTerm,
    metaHook.qaMeta, getCellKey, getMaxForCell, metaHook.applyMetaToScores,
    fetchClassRecord]);

const handleHpsUpdate = useCallback(async (...) => {
  // ...
}, [editAccess.isViewOnly, classAssignmentId, classRecord, selectedTerm,
    metaHook.qaMeta, metaHook.applyMetaToScores, fetchClassRecord]);
```

**Impact:** These callbacks include `classRecord` (the entire array) as a dependency. Any score change creates a new `classRecord` reference → these callbacks are recreated → children receive new function references.

**Fix:** Remove `classRecord` from dependencies. Instead, read the latest value inside the callback via a ref (`classRecordRef.current`).

---

### 7. IIFE Row Builder Runs Every Render

**File:** `ClassRecordTable.tsx:856-904`

```tsx
{(() => {
  const rows: React.ReactNode[] = [];
  // ... iterates all records, builds JSX ...
  return rows;
})()}
```

**Impact:** This immediately-invoked function expression rebuilds the entire rows array on every render of `ClassRecordTable`. Combined with the key remount issue, this means all JSX is recreated and then immediately discarded by React.

**Fix:** Memoize with `useMemo` keyed on `[sortedRecords, maleRecords, femaleRecords, selectedTerm, ...]`.

---

## Medium Severity Issues

### 8. useEditAccess Polling Runs Unconditionally

**File:** `hooks/useEditAccess.ts:24-39`

A 60-second interval timer updates `editTimeRemaining` even when the user is not viewing a past term. This triggers a re-render of ClassRecordView every minute.

**Fix:** Only start the interval when `editRequestStatus === "approved"` (which it already does conditionally, but the effect re-evaluates unnecessarily when `isPastTerm` is false).

---

### 9. hpsData Recomputes on Every classRecord Change

**File:** `ClassRecordView.tsx:105-117`

```tsx
const hpsData = useMemo(() => {
  const wwScores = Array.from({ length: metaHook.wwCount }, ...);
  const ptScores = Array.from({ length: metaHook.ptCount }, ...);
  classRecord.forEach((record) => { /* iterates all scores */ });
  return { wwScores, ptScores, qaMax };
}, [classRecord, selectedTerm, metaHook.wwCount, metaHook.ptCount]);
```

**Impact:** For 40 students with 5 WW + 5 PT each, this iterates 400 score items on every render.

**Fix:** HPS data rarely changes (only when teacher edits HPS). Store it separately and only recompute when HPS actually changes, not on every classRecord update.

---

### 10. stats useMemo Recomputes Entire Grade Distribution

**File:** `ClassRecordView.tsx:154-159`

```tsx
const stats = useMemo(() => {
  const grades = classRecord.map((r) => getDisplayFinalGrade(r)).filter(...);
  return { avg, passed, highest, lowest };
}, [classRecord, selectedTerm, activeWeights]);
```

**Impact:** `getDisplayFinalGrade` calls `transmuteGrade` (O(41) scan) per student. For 40 students, that's 1640 comparison operations per render.

**Fix:** Consider incremental computation or only recompute when a score in the displayed term actually changes.

---

### 11. 46 Inline Styles

**Playwright measurement:** 46 elements have `style.cssText` set directly.

**Impact:** Inline styles bypass CSS class optimization and prevent browser style caching. Each inline style forces a style recalculation.

**Fix:** Migrate inline styles to Tailwind utility classes or CSS custom properties where possible.

---

## Low Severity Issues

### 12. Assessment Header onChange Creates New Arrays Per Keystroke

**File:** `components/AssessmentHeader.tsx:148-173`

Each keystroke in the Assessment Details description/date fields creates a new array via `[...prev]` spread + while loop fill. This triggers a re-render of the entire `ClassRecordTable` parent.

**Fix:** Debounce or only update on blur.

---

### 13. GradeEditModal onApplyColumnMeta Fires on Blur

**File:** `components/GradeEditModal.tsx`

Blur events on description/date inputs call `onApplyColumnMeta` which triggers a batch save API call. Rapid tabbing through fields causes multiple unnecessary API calls.

**Fix:** Debounce or require explicit "Save" button click.

---

### 14. SSE Stream Reconnection on Navigation

**Network trace:** The `/api/integration/sync/stream` connection aborts on page navigation and reconnects. This causes a brief loading delay.

**Fix:** Consider a shared SSE connection outside of React component lifecycle.

---

## Re-Render Cascade Diagram

Here is the full re-render chain triggered by a single score edit:

```
User types score + blurs
  │
  ├── commitScoreInput() [NOT MEMOIZED]
  │     └── handleScoreUpdate()
  │           ├── setClassRecord() [optimistic update → maps all records O(n)]
  │           ├── gradesApi.saveGrade() [POST ~389ms]
  │           └── fetchClassRecord() [GET → full refetch]
  │                 │
  │                 └── classRecordQuery.data changes
  │                       │
  │                       ├── classRecord = new reference
  │                       │     ├── hpsData useMemo → recomputes (O students × tasks)
  │                       │     ├── sortedRecords useMemo → sorts (O n log n)
  │                       │     ├── maleRecords useMemo → filters
  │                       │     ├── femaleRecords useMemo → filters
  │                       │     ├── stats useMemo → maps all through getDisplayFinalGrade
  │                       │     │     └── transmuteGrade × N students (O 41 × N)
  │                       │     └── metaHook deps change
  │                       │           ├── wwCount/ptCount useMemo → recomputes
  │                       │           ├── useEffect → setWwMeta() [STATE 1]
  │                       │           ├── useEffect → setPtMeta() [STATE 2]
  │                       │           └── useEffect → setQaMeta() [STATE 3]
  │                       │
  │                       ├── activeWeights useMemo → may recompute
  │                       ├── getDisplayFinalGrade useCallback → recreated
  │                       ├── handleScoreUpdate useCallback → recreated
  │                       ├── handleHpsUpdate useCallback → recreated
  │                       ├── addTask useCallback → recreated
  │                       ├── removeTask useCallback → recreated
  │                       └── mobileEditor deps change → callbacks recreated
  │
  └── ClassRecordTable re-renders
        ├── LedgerRow key includes dataUpdatedAt → ALL ROWS REMOUNT
        │     └── Each LedgerRow computes calcTotal, calcMax, calcPS, grades
        ├── IIFE rebuilds entire rows array
        ├── renderColGroup() called inline
        └── 46 inline styles force style recalculation
```

---

## Recommendations (Priority Order)

| # | Fix | Impact | Effort |
|---|-----|--------|--------|
| 1 | Remove `dataUpdatedAt` from LedgerRow key | Eliminates full row remount | 5 min |
| 2 | Wrap `commitScoreInput` in useCallback | Prevents child re-render cascade | 5 min |
| 3 | Use ref for `classRecord` in callbacks | Breaks unnecessary dependency chain | 30 min |
| 4 | Merge saved grade into cache instead of refetching | Eliminates refetch + re-render cascade | 2 hrs |
| 5 | Combine triple state setter into single state | Reduces 3 re-renders to 1 | 1 hr |
| 6 | Memoize IIFE row builder with useMemo | Prevents row array rebuild every render | 30 min |
| 7 | Deduplicate API calls (settings, my-classes) | Reduces 177 requests to ~30 on load | 2 hrs |
| 8 | Separate HPS data from classRecord refetch | Prevents unnecessary HPS recomputation | 1 hr |
| 9 | Debounce AssessmentHeader onChange | Prevents per-keystroke array creation | 30 min |

---

## Current vs Expected Performance

| Scenario | Current (6 students) | Expected After Fixes (6 students) | Expected After Fixes (40 students) |
|----------|---------------------|-----------------------------------|------------------------------------|
| Page load | ~714 ms | ~400 ms | ~800 ms |
| Score edit cycle | ~3.2 sec | <500 ms | <800 ms |
| Assessment panel toggle | ~1.5 sec | <200 ms | <300 ms |
| DOM mutations per edit | 142 | <30 | <50 |
| Network requests per edit | 2 | 1 | 1 |
| Memory (heap) | 35 MB | ~30 MB | ~60 MB |

---

## Files Analyzed

| File | Lines | Issues Found |
|------|-------|-------------|
| `ClassRecordView.tsx` | 238 | commitScoreInput not memoized, massive useCallback deps |
| `ClassRecordTable.tsx` | 911 | **Key prop defeats memo**, IIFE row builder, inline renderColGroup |
| `hooks/useClassRecord.ts` | 153 | Optimistic update maps all records, batch invalidation on settle |
| `hooks/useAssessmentMeta.ts` | 198 | Triple state setter cascade, saveColumnMeta large deps |
| `hooks/useEditAccess.ts` | 72 | Polling runs unconditionally |
| `hooks/useMobileEditor.ts` | 90 | commitMobileScore recreated per draft change |
| `hooks/useStickyLayout.ts` | 36 | 3× ResizeObservers active simultaneously |
| `components/classRecordActions.ts` | 486 | Double array map per score update, full refetch after save |
| `components/ClassRecordMobileList.tsx` | 131 | No memoization, inline grade computation |
| `components/AssessmentHeader.tsx` | 276 | Per-keystroke array creation |
| `components/ClassRecordTour.tsx` | 797 | 5 useEffects, complex positioning (only during tour) |
| `lib/gradeMath.ts` | 90 | transmuteGrade O(41) linear scan per call |
| `src/lib/api.ts` | 1585 | N/A (API client) |
