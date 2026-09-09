# ClassRecordView Performance Fix Plan

## Objective

Reduce lag in the teacher class-record page without changing grading behavior, validation rules, API contracts, or user-facing functionality.

Primary target:

- `src/pages/teacher/ClassRecordView.tsx`
- `src/pages/teacher/components/ClassRecordTable.tsx`
- `src/pages/teacher/components/classRecordActions.ts`
- `src/pages/teacher/hooks/useAssessmentMeta.ts`

The implementation must preserve:

- Score validation
- `A` means Absent, must remain score `0`
- `E` means Excused, must display `E` and contribute score `0` to totals — preserve current behavior exactly (see "Known Discrepancies" below)
- Optimistic updates
- Grade calculations
- Grade-lock behavior
- Edit-request behavior
- Term switching
- Assessment metadata editing
- Mobile editor behavior
- Gender-separated table mode
- Clear-scores behavior
- Server synchronization

---

## Confirmed Root Causes

### 1. Unstable `LedgerRow` keys

File:

`src/pages/teacher/components/ClassRecordTable.tsx`

Current pattern:

```tsx
key={`${r.student.id}-${dataUpdatedAt}`}
```

`dataUpdatedAt` changes after a successful refetch. React interprets every row as a new component and remounts the entire ledger.

This defeats the existing `React.memo(LedgerRow)` optimization and recreates all row inputs after every save.

### Safety restriction

`LedgerScoreCell` currently uses uncontrolled inputs with `defaultValue`. Do **not** replace the key with `studentId` alone until input synchronization is solved.

The first safe key option is:

```tsx
key={`${r.student.id}-${selectedTerm}`}
```

This prevents remounts after normal saves while still remounting inputs when the teacher changes terms. Do not remove `dataUpdatedAt` from the key and use `studentId` alone unless controlled inputs or an explicit synchronization mechanism has been implemented and tested.

### 2. Full record refetch after every individual score save

Current flow:

```text
Score blur
-> optimistic update
-> POST /api/grades/grade
-> GET /api/grades/class-record/:id
-> replace entire classRecord array
-> recompute page data
-> remount all rows
```

The optimistic update already updates the visible score. The full refetch causes unnecessary page-wide work.

### 3. `commitScoreInput` is recreated on every render

File:

`src/pages/teacher/ClassRecordView.tsx`

The function is passed down to `ClassRecordTable` and every `LedgerRow`, but it is not wrapped with `useCallback`.

### 4. Broad callback dependencies

`handleScoreUpdate`, `handleHpsUpdate`, and `removeTask` depend on the complete `classRecord` array.

Whenever one score changes, the array reference changes, causing callback identities to change and propagating re-renders through the table.

### 5. Assessment metadata is recalculated after score changes

File:

`src/pages/teacher/hooks/useAssessmentMeta.ts`

The metadata effect depends on the entire `classRecord` array and updates WW, PT, and QA metadata state after every class-record reference change.

A score-only update should not require metadata derivation.

### 6. Full row array is constructed during every table render

File:

`src/pages/teacher/components/ClassRecordTable.tsx`

The IIFE from lines approximately 856-904 rebuilds the complete row array during every render.

This is secondary to the unstable key issue but should be addressed after behavior is protected.

### 7. Optimistic update preserves stale server-derived grade fields

File:

`src/pages/teacher/components/classRecordActions.ts`

When `executeScoreUpdate` performs its optimistic update, it changes raw scores but **preserves stale server-calculated fields**:

- `writtenWorkPS`
- `perfTaskPS`
- `quarterlyAssessPS`
- `initialGrade`
- `quarterlyGrade`

The table (`ClassRecordTable.tsx` lines 174, 179, 184) reads these stale fields first:

```tsx
const displayWWPS = grade?.writtenWorkPS ?? (wwMaxTotal > 0 ? calcPS(wwTotal, wwMaxTotal) : null);
```

Because the stale `writtenWorkPS` from the previous server response is still present, the `??` fallback never runs. The displayed grade stays at its old value (e.g. 60) until the full refetch overwrites these fields with correct server values.

This is the direct cause of the "grade stays at 60 for 5 seconds after entering WW scores" symptom.

### 8. Server does not handle `A`/`E` status in grade calculation

File:

`server/src/routes/grades-sub/helpers.ts` (lines 273-321)

The server's `calculateGrades` function sums `item.score` without checking `item.status`. Both `A` and `E` items are sent with `score: 0` from the client. The `status` field is a display indicator only — it does not affect the server-side grade calculation.

The current behavior is:

- `A` (Absent): score `0` is summed → contributes `0` to totals
- `E` (Excused): score `0` is summed → contributes `0` to totals
- `status` is preserved on the score item for UI display only

This is pre-existing behavior. The plan must preserve it exactly. Do not change how `A` or `E` affects grade calculations.

---

## Known Discrepancies — Do NOT Fix Before the Check

### `E` (Excused) as a perfect score

The product owner intends `E` to eventually count as a perfect score (excused assessments should not penalize the learner). The current code does not do this:

- Client sends `E` items with `score: 0` (`classRecordActions.ts`)
- Server `calculateGrades` (`server/src/routes/grades-sub/helpers.ts`) sums `item.score` without reading `item.status`
- Result: `E` contributes `0` to totals today, same as `A`

**This plan does NOT change that.** Grading semantics must stay frozen through tomorrow's system check. Implementing `E = perfect` would alter every affected learner's WW/PT percentage scores, initial grades, final grades, mastery distribution, SF10 outputs, and promotion results.

Post-check task (separate change, separate verification):

1. Decide the exact rule (e.g. `E` item contributes `maxScore` to both total and max, or is excluded from both)
2. Implement in the server's `calculateGrades` first
3. Mirror in client ledger math (`ClassRecordTable.tsx`, `gradeMath.ts`)
4. Re-run full regression on grades, reports, SF10, promotion
5. Update this plan's guardrails after the behavior change is accepted

---

## Implementation Strategy

## Phase 0: Fix Stale Derived Fields in Optimistic Update (HIGHEST PRIORITY)

This phase directly fixes the "grade stays at 60 for 5 seconds" symptom. It is the safest and most impactful change.

### File

`src/pages/teacher/components/classRecordActions.ts`

### Problem

`executeScoreUpdate` (lines 183-232) does an optimistic update that changes raw scores but preserves stale server-calculated fields from the previous fetch:

```tsx
const newRecord = { ...record, grades: [...record.grades] };
const targetGrade = { ...newRecord.grades[gradeIdx] };
// Changes scores but keeps stale: writtenWorkPS, perfTaskPS, quarterlyAssessPS, initialGrade, quarterlyGrade
```

The table then reads stale fields first:

```tsx
const displayWWPS = grade?.writtenWorkPS ?? (wwMaxTotal > 0 ? calcPS(wwTotal, wwMaxTotal) : null);
```

The `??` fallback never runs because the stale field is still present.

### Fix

After updating scores in the optimistic update, null out the derived fields so the table falls through to client-side calculation:

```tsx
// After updating scores in the optimistic update, add:
targetGrade.writtenWorkPS = null;
targetGrade.perfTaskPS = null;
targetGrade.quarterlyAssessPS = null;
targetGrade.initialGrade = null;
targetGrade.quarterlyGrade = null;
```

This forces the table to recalculate from raw scores immediately, using the same math the server uses (`calculateGrades` in `helpers.ts`).

### Why this is safe

- The table already has fallback calculation: `grade?.writtenWorkPS ?? calcPS(total, max)`
- Nulling the fields triggers the same calculation the server performs
- The refetch still runs and replaces with authoritative server values
- If the refetch is slow, the client-calculated values are shown immediately
- No API contract changes
- No grading logic changes

### Required checks

- After entering a WW score, the WW PS and weighted score update immediately
- After entering a PT score, the PT PS and weighted score update immediately
- After entering a QA score, the QA PS and weighted score update immediately
- The final grade updates as soon as enough data is present
- `A` still displays as "A" with score 0
- `E` still displays as "E" with score 0
- The refetch still runs and corrects any calculation differences

### Acceptance criteria

- Grade updates visually within 100ms of score entry (no 5-second wait)
- Server and client calculations match for all test cases
- No data corruption on failed saves

---

## Phase 1: Stabilize Row Identity

### Files

- `src/pages/teacher/components/ClassRecordTable.tsx`
- Any parent component passing `dataUpdatedAt`

### Changes

Do not blindly replace row keys using `dataUpdatedAt` with `studentId` alone. Because score inputs use `defaultValue`, that can leave stale values visible after server updates or term changes.

Preferred first change:

```tsx
key={`${r.student.id}-${selectedTerm}`}
```

Apply this consistently in:

- Alphabetical rendering
- Male group rendering
- Female group rendering

Remove the `dataUpdatedAt` prop from `ClassRecordTable` if it is no longer required elsewhere.

### Required checks

- Score inputs retain focus correctly
- Unchanged rows are not remounted after another student's score changes
- Inputs display the correct values after term changes
- Inputs display server-corrected values after save/refetch
- `A` displays as absent with score `0`
- `E` displays as excused and contributes `0` to totals exactly as today
- Gender-separated mode still renders unique keys
- No duplicate React key warnings appear

### Acceptance criteria

- `LedgerRow` identity remains stable after a score save within the same term
- Inputs refresh correctly when the selected term changes
- Existing `React.memo` can prevent unaffected rows from rendering
- No grading behavior changes

---

## Phase 2: Memoize Score Commit Handler

### File

`src/pages/teacher/ClassRecordView.tsx`

### Changes

Wrap `commitScoreInput` in `useCallback`.

All values used by the function must be included in its dependency list, including:

- `getCellKey`
- `getMaxForCell`
- `handleScoreUpdate`
- `setError`
- `setInvalidCells` if required by the implementation

Do not remove dependencies merely to force callback stability.

### Required checks

- Numeric scores still validate against the correct maximum
- Empty values still become zero
- Invalid values restore the previous input value
- `A` and `E` still save correctly
- `A` remains score `0` and does not contribute points
- `E` behavior is unchanged from today: displays `E`, saves `score: 0`, contributes `0` to totals
- Invalid-cell styling still appears and clears correctly

### Acceptance criteria

- `commitScoreInput` has stable identity when unrelated parent state changes
- Score validation behavior remains unchanged

---

## Phase 3: Optimize Single-Score Cache Updates

### Files

- `src/pages/teacher/components/classRecordActions.ts`
- `src/pages/teacher/hooks/useClassRecord.ts`
- `src/pages/teacher/ClassRecordView.tsx`

### Goal

Preserve the optimistic update but clone only the affected student and selected term.

For unaffected students:

```text
Return the existing record object.
```

For the affected student:

```text
Clone the record.
Clone the selected term grade.
Clone only the changed score array.
```

Avoid rebuilding unrelated student records and unrelated terms.

### Important behavior

The update must support:

- WW score changes
- PT score changes
- QA score changes
- `A`: absent, score `0`
- `E`: excused, saves `score: 0` and contributes `0` to totals (display-only status)
- Existing metadata application behavior
- Correct recalculation of displayed values

### Failure handling

If the API save fails:

- Restore the previous affected record
- Display the existing error toast
- Do not leave the optimistic value visible as if it were saved

### Acceptance criteria

- Only the edited student's row receives a changed record reference
- Unaffected rows retain their original record references
- Existing error and rollback behavior continues to work

---

## Phase 4: Remove the Immediate Full Refetch for Single Score Saves

### Files

- `src/pages/teacher/components/classRecordActions.ts`
- `src/pages/teacher/hooks/useClassRecord.ts`

### Goal

Do not immediately call `fetchClassRecord()` after a successful individual score save if the cache already contains the correct optimistic/server result.

Preferred flow:

```text
Apply optimistic cache update
-> save score
-> keep successful cache update
-> show success state if currently supported
```

### Full refetch may remain for

- Failed or uncertain server responses
- Bulk metadata saves
- HPS changes if server-side calculations require confirmation
- Clear-scores
- Manual refresh
- Term changes
- Explicit synchronization actions

### Important caution

Before removing the refetch, verify whether the server returns values that the client cannot calculate locally.

If the server recalculates any of these values:

- Initial grade
- Final grade
- Transmuted grade
- Percentage score
- Descriptor
- Grade status

then do **not** remove the refetch until one of these safe approaches is implemented:

1. Apply the server response directly to the cache, or
2. Keep a targeted refetch only when server-calculated values are required.

Do not sacrifice grade accuracy for performance.

### Mandatory safety rule

The first implementation must keep the existing refetch path. Removing or narrowing it requires a separate verified change after confirming the server response and grade calculations for normal scores, `A`, and `E`.

### Acceptance criteria

- A single score edit causes only one save request in the normal success path
- The edited row displays the correct grade values
- No stale server data overwrites the optimistic value
- A failed save still recovers correctly

---

## Phase 5: Stabilize Callback Dependencies

### Files

- `src/pages/teacher/ClassRecordView.tsx`
- `src/pages/teacher/components/classRecordActions.ts`
- `src/pages/teacher/hooks/useClassRecord.ts`

### Goal

Prevent the complete `classRecord` array from unnecessarily changing callback identities.

Do not use refs or reduced dependency arrays to hide stale values. Any callback optimization must pass the selected term, view-only state, score limits, metadata, and latest record data tests.

Preferred options, in order:

1. Move mutation/cache logic into React Query mutation handlers
2. Read the latest query data from the query client inside the mutation
3. Use a ref only for event handlers that need the latest data without affecting render output

Do not use refs to hide values that should be reactive in the UI.

### Callbacks to review

- `handleScoreUpdate`
- `handleHpsUpdate`
- `addTask`
- `removeTask`
- `handleClearScores`
- `commitScoreInput`
- Mobile score commit callbacks

### Acceptance criteria

- Callback identities remain stable when unrelated students change
- No stale closure bugs occur
- Selected term and view-only state remain correct

---

## Phase 6: Prevent Metadata Derivation on Score-Only Changes

### File

`src/pages/teacher/hooks/useAssessmentMeta.ts`

### Goal

Do not regenerate WW/PT/QA metadata after every score update.

Do not remove the metadata derivation effect until tests prove that score display, HPS values, `A`, `E`, and term changes remain correct. This phase is optional and must not be combined with save-flow changes.

Metadata should be derived when:

- The class record initially loads
- The selected term changes
- The number of assessment columns changes
- Assessment metadata is explicitly saved
- A new task is added or removed

Metadata should not be regenerated solely because a score changed.

### Preferred state shape

Consider combining:

```tsx
wwMeta
ptMeta
qaMeta
```

into one metadata state object if this does not complicate existing APIs.

Example:

```tsx
type AssessmentMetaState = {
  ww: AssessmentMeta[];
  pt: AssessmentMeta[];
  qa: AssessmentMeta;
};
```

Use one state update when metadata genuinely changes.

### Required checks

- Existing descriptions remain visible
- Existing dates remain visible
- Switching terms loads the correct metadata
- Metadata save still applies to all students
- Mobile metadata editing still works

### Acceptance criteria

- Score-only saves do not trigger unnecessary metadata state updates
- Metadata remains synchronized after explicit metadata operations

---

## Phase 7: Memoize Table Row Construction

### File

`src/pages/teacher/components/ClassRecordTable.tsx`

### Goal

Replace the render-time IIFE with a memoized row list or a smaller focused row-rendering component.

The memoized result must account for:

- `sortedRecords`
- `maleRecords`
- `femaleRecords`
- `separateByGender`
- `selectedTerm`
- `wwCount`
- `ptCount`
- `weights`
- `isViewOnly`
- `transmutationTable`
- Stable callback references

Do not memoize using incomplete dependencies.

### Additional review

Review `renderColGroup()` as it is also called inline during render. Memoize only if profiling shows it contributes meaningfully to render cost.

### Acceptance criteria

- Row construction is not repeated for unrelated state updates
- Gender-separated mode remains correct
- Row indexes used by keyboard navigation remain correct

---

## Phase 8: Reduce Metadata Save Churn

### Files

- `src/pages/teacher/components/AssessmentHeader.tsx`
- `src/pages/teacher/components/GradeEditModal.tsx`
- `src/pages/teacher/hooks/useAssessmentMeta.ts`

### Goal

Editing metadata locally should not trigger a batch API request on every blur.

Preferred flow:

```text
User edits fields
-> update local draft
-> user clicks Save
-> one batch request
-> one cache update or refetch
```

If autosave is a product requirement:

- Debounce saves
- Cancel or replace pending saves
- Ensure only the latest draft is submitted

### Acceptance criteria

- Tabbing through metadata inputs does not create multiple batch requests
- Explicit Save still persists all fields
- Mobile editor behavior remains functional

---

## Phase 9: Share Cached Settings Data

### Files

- `src/pages/teacher/ClassRecordView.tsx`
- Relevant layout/settings hooks

### Goal

Avoid repeated `adminApi.getSettings()` calls from multiple components.

Use an existing React Query pattern or create a shared settings hook if one does not already exist.

Configure a reasonable `staleTime` because term labels and school settings do not change frequently.

### Acceptance criteria

- Settings are fetched once per stale period
- Term labels still appear correctly
- No settings-related behavior changes

---

## Phase 10: Review ResizeObserver Usage

### Files

- `src/pages/teacher/hooks/useStickyLayout.ts`
- `src/hooks/useElementHeight.ts`

### Goal

Review the three independent observers for unnecessary state updates.

Possible improvements:

- Update height state only when the value changes
- Share one observer where practical
- Confirm cleanup on unmount
- Avoid observer/state feedback loops

This is a secondary optimization and should not delay the row-key or save-flow fixes.

### Acceptance criteria

- Sticky header positions remain correct
- Window resizing remains functional
- No observer leaks occur
- No visual layout regression occurs

---

## Testing Plan

## Automated tests

Add or update tests for:

- Stable row keys
- Optimistic score updates
- Failed score-save rollback
- WW score updates
- PT score updates
- QA score updates
- `A` status
- `E` status
- `A` stores/displays score `0`
- `E` stores/displays `score: 0` and contributes `0` to totals (current behavior)
- A failed save does not leave an optimistic `A` or `E` state behind
- Term switching
- View-only and locked terms
- Assessment metadata saving
- Clear scores
- Gender-separated rendering

## Browser tests

Use Playwright to verify:

1. Open a class record
2. Record baseline DOM and network metrics
3. Edit one score
4. Confirm only the expected save request is sent
5. Confirm the edited score and grade display update
6. Confirm unaffected rows remain stable
7. Switch terms
8. Open and close Assessment Details
9. Edit metadata and save once
10. Test mobile editor behavior
11. Test gender-separated mode
12. Test locked/view-only behavior

Every browser test must start from a clean page state and must verify both the visible value and the network result. Do not use artificial waits as proof of correctness.

## Performance targets

For a class with approximately 40 learners:

| Metric | Current | Target |
|---|---:|---:|
| Grade visual update after score entry | ~5 seconds (waits for refetch) | Under 100 ms (client-side recalc) |
| Normal score-save requests | 2 | 1 |
| DOM mutations per score edit | 142 observed at 6 learners | Under 50 |
| Full row remounts after score edit | All rows | Edited row or affected rows only |
| Score edit visual response | Approximately 3.2 seconds including refetch | Under 500 ms optimistic response |
| Assessment panel toggle | Must be measured without artificial wait | Under 200 ms actual UI update |
| Console React errors | Existing prop warning should be reviewed | 0 new errors |

Do not use artificial test waits as the measured interaction duration. Separate:

- Actual event-to-render time
- API response time
- Test polling/wait duration

---

## Verification Commands

Run from the project root:

```bash
npm run lint
npm run build
```

Run backend verification from `server/` when relevant:

```bash
npm run build
```

Run the relevant test suite if configured:

```bash
npm test
```

Do not modify `.env` or `.env.*` files.

---

## Implementation Order

0. Fix stale derived fields in optimistic update (Phase 0). This is the highest-priority fix and directly addresses the "grade stays at 60" symptom.
1. Create a baseline: build, tests, clean Playwright run, and record current score/grade behavior.
2. Change only the row key to `studentId + selectedTerm`; keep the existing refetch.
3. Verify term switching, focus, normal scores, `A`, `E`, clear scores, locks, and edit access.
4. Memoize `commitScoreInput`; rerun the same checks.
5. Verify row identity/render behavior before any cache or API change.
6. Optimize optimistic updates only if rollback tests pass.
7. Do **not** remove the full refetch until server-returned grade calculations are verified.
8. Apply callback, metadata, row-list, settings, and observer optimizations one isolated change at a time.
9. Run lint, frontend build, backend build, tests, and clean Playwright verification after every phase.

### No-improvisation rule

Do not combine phases, redesign the API, change grading formulas, change `A`/`E` semantics, convert inputs to controlled inputs, or remove refetches unless explicitly covered by this plan and verified by the safety checks.

---

## Rollback Criteria

Stop and review the implementation if any of the following occur:

- Saved scores disappear after a refetch
- Server-calculated grades differ from the previous behavior
- Input focus is lost unexpectedly
- Term switching shows data from the wrong term
- Locked terms become editable
- Approved edit requests stop working
- Metadata is applied to the wrong term
- Mobile editing stops committing scores
- Clear Scores no longer clears all expected records
- React key warnings appear
- API requests are duplicated or race with each other
- `A` is assigned points or changes the final grade unexpectedly
- `E` stops displaying or saving (zero contribution is the current, correct behavior — not a regression)
- An input shows a previous term's score
- Server and displayed final grades differ

### Stop conditions

If any safety check fails, stop implementation at that phase. Keep the last passing change and do not proceed to performance-only phases.

---

## Definition of Done

The work is complete when:

- `LedgerRow` uses stable student-based keys
- Uncontrolled inputs never display stale term data
- A normal single-score edit does not remount the entire table
- The existing full refetch remains until server-grade equivalence is proven
- Optimistic updates remain accurate and rollback safely
- `A` remains absent with score `0`
- `E` remains excused: displays `E`, saves `score: 0`, contributes `0` to totals — byte-for-byte unchanged from today
- Grade calculations match existing behavior
- Assessment metadata remains correct
- Locked and view-only rules remain unchanged
- Mobile and desktop flows work
- Playwright confirms measurable improvement
- `npm run lint` passes
- `npm run build` passes
- Relevant tests pass
- No unrelated files are refactored
