# AIMS Phase 5 — Subject Name Alignment — Implementation Report

## 1. Files Changed

### Task 1 — New lib: `server/src/lib/aimsCourseMatch.ts` (created)
- `normalizeSubjectName(name)` — strips trailing standalone grade digit (7–10), returns `{ base, grade }`
- `subjectsMatch(courseSubject, smartSubject)` — grade-aware comparison: same base + compatible grades → match; cross-grade or different base → mismatch
- `computeCourseWarnings(course, assignment)` — moved from route file, subject branch now uses `subjectsMatch()` instead of strict `.toLowerCase()` equality

### Task 2 — Route update: `server/src/routes/grades-sub/aims.ts`
- Line 26: Added `import { computeCourseWarnings } from "../../lib/aimsCourseMatch";`
- Lines 29–48: Deleted local `computeCourseWarnings` function definition
- Both existing call sites (GET `/aims-scores` persistent warnings + POST `/aims-link` warnings) remain unchanged

### Task 3 — Tests: `server/src/__tests__/aims-sync.test.ts`
- Line 10: Added `import { computeCourseWarnings } from "../lib/aimsCourseMatch";`
- New `describe("computeCourseWarnings / subjectsMatch")` block with 7 pure unit tests:
  1. Suffix-only match: `"Developmental Reading"` vs `"Developmental Reading 8"` → no subject warning
  2. Base names equal: `"English"` vs `"English"` → no warning
  3. Cross-grade warns: `"Filipino 7"` vs `"Filipino 8"` → subject warning
  4. Different subjects warn: `"Science - Chemistry"` vs `"Science 8"` → warning
  5. Grade 10 suffix: `"Science"` vs `"Science 10"` → no warning
  6. One-sided AIMS suffix: `"Mathematics 8"` vs `"Mathematics"` → no warning
  7. Section + schoolYear branches unchanged: both still warn when mismatched

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

✓ built in 2.05s
```

### Lint (root)
```
✖ 1132 problems (0 errors, 1132 warnings)
```
Phase 4 baseline was 1132 warnings. No change — zero new warnings.

### Server Tests
```
> server@1.0.0 test
> vitest run

 Test Files  13 passed | 10 skipped (23)
      Tests  156 passed | 57 skipped (213)
```
Phase 4 baseline was 149 passed. 7 new tests added, all passing. No regressions.

---

## 3. Deviations

None. All changes follow the handoff document exactly.

---

## 4. Discoveries

1. **Regex handles Grade 10 correctly**: The pattern `\s+(7|8|9|10)$` matches "10" as a two-digit suffix. Verified by test case 5 ("Science 10").

2. **Case-insensitive comparison preserved**: The old code used `.toLowerCase()` comparison. The new `normalizeSubjectName()` lowercases the base, so case-insensitive matching is maintained.

3. **`subjectsMatch` is intentionally unexported**: The handoff shows it as a module-private function. Only `normalizeSubjectName` and `computeCourseWarnings` are exported. The tests exercise `subjectsMatch` indirectly through `computeCourseWarnings`.

---

## 5. Open Items

1. **Live verification**: After AIMS API key lands, connect teacher `2000061`'s course "English - Makabansa" to a SMART class with subject "English 8" — should show NO subject warning.
2. **Original repro**: "Developmental Reading" vs "Developmental Reading 8" — covered by test case 1.
