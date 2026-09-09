# AIMS Phase 5 — Subject Name Alignment (Grade-Suffix Normalization) — Implementation Handoff

> **STATUS: GREEN-LIT — IMPLEMENT THIS DOCUMENT.**
> Read `AIMS_SMART_Integration_Guide.md` + Phase 1–4 reports first. All prior phases
> complete and verified. This is a small, backend-only fix — no migration, no AIMS changes.

## Context — the false-positive warning

Lead hit this live while connecting a course (screenshot):

> `Subject mismatch: AIMS course is "Developmental Reading", class is "Developmental Reading 8"`

**Root cause:** SMART appends a grade-level digit to every subject name (convention from
`resolveSubjectName()` in `server/src/lib/atlasUtils.ts:173-203` — e.g. `"Filipino 7"`,
`"Developmental Reading 8"`). AIMS and ATLAS carry the base DepEd subject name without the
suffix (`"Developmental Reading"`). The strict comparison in `computeCourseWarnings()`
(`server/src/routes/grades-sub/aims.ts:44-46`) therefore fires a warning for **every
correctly-matched course** — a false positive teachers must click through ("Connect Anyway").

**Decision (lead):** SMART normalizes its own comparison. AIMS must NOT change — base names
without grade suffixes are the DepEd-correct convention (SF10 permanent records use base
subject names; the grade is implied by form structure). This is a one-sided SMART fix.

**Goal:** grade-suffix-only differences no longer warn. Genuine subject mismatches
(including cross-grade links) still warn.

---

## Task 1 — New lib: `server/src/lib/aimsCourseMatch.ts`

Create this file. Move + upgrade the warning logic here (per AGENTS.md: routes thin,
logic in lib/; also makes it unit-testable — it currently lives unexported in the route file).

### 1a. Subject normalizer

```ts
/**
 * Strip a trailing standalone grade-level digit token (" 7".." 10") from a subject name.
 * "Developmental Reading 8" → { base: "developmental reading", grade: "8" }
 * "Developmental Reading"   → { base: "developmental reading", grade: null }
 * "Science - Chemistry"     → { base: "science - chemistry",   grade: null }
 */
export function normalizeSubjectName(name: string): { base: string; grade: string | null } {
  const m = name.trim().match(/^(.*\S)\s+(7|8|9|10)$/i);
  if (m) return { base: m[1].trim().toLowerCase(), grade: m[2] };
  return { base: name.trim().toLowerCase(), grade: null };
}
```

Rules:
- Only strip a **standalone trailing number** in 7–10 (the only valid JHS grade suffixes).
  Never strip digits embedded in words ("TLE7"? — SMART names use a space before the digit,
  so require the `\s+`). Never strip other numbers.
- Lowercase the base for comparison.

### 1b. Subject comparison with grade awareness

```ts
function subjectsMatch(courseSubject: string, smartSubject: string): boolean {
  const a = normalizeSubjectName(courseSubject);
  const b = normalizeSubjectName(smartSubject);
  if (a.base !== b.base) return false;      // different subjects → still a mismatch
  if (a.grade && b.grade && a.grade !== b.grade) return false; // Grade 7 course on Grade 8 class → still a mismatch
  return true;                              // suffix-only difference (or one side has none) → match
}
```

Cross-grade case: `"Filipino 7"` (AIMS) vs `"Filipino 8"` (SMART) → **warns** (correct —
that's a real mistake worth catching). `"Developmental Reading"` vs `"Developmental Reading 8"`
→ matches (no warning). `"Science - Chemistry"` vs `"Science 8"` → warns (correct —
different granularity is a genuine mismatch).

### 1c. Move `computeCourseWarnings` into this lib

Copy the existing function from `grades-sub/aims.ts:33-48` verbatim, then change ONLY the
subject branch:

```ts
if (course.subject && assignment.subjectName && !subjectsMatch(course.subject, assignment.subjectName)) {
  warnings.push(`Subject mismatch: AIMS course is "${course.subject}", class is "${assignment.subjectName}"`);
}
```

Export `computeCourseWarnings`. The school-year and section branches stay exactly as they
are (section compare is already case-insensitive; sections don't carry grade suffixes).

## Task 2 — Update the route file

**`server/src/routes/grades-sub/aims.ts`:**
- Delete the local `computeCourseWarnings` definition (lines ~29-48)
- Import it: `import { computeCourseWarnings } from "../../lib/aimsCourseMatch";`
- Both existing call sites stay untouched (grep `computeCourseWarnings` — the GET
  `/aims-scores` persistent-warnings call and the POST `/aims-link` call)

## Task 3 — Tests (`server/src/__tests__/aims-sync.test.ts`)

New `describe("computeCourseWarnings / subjectsMatch")` block — pure unit tests, no DB:

1. **Suffix-only match (the bug):** `("Developmental Reading", "Developmental Reading 8")` → no subject warning
2. **Base names equal:** `("English", "English")` → no warning
3. **Cross-grade still warns:** `("Filipino 7", "Filipino 8")` → subject warning present
4. **Different subjects still warn:** `("Science - Chemistry", "Science 8")` → warning present
5. **Grade 10 suffix:** `("Science", "Science 10")` → no warning (two-digit suffix handled)
6. **One-sided suffix on AIMS:** `("Mathematics 8", "Mathematics")` → no warning
7. **Section + schoolYear branches unchanged:** a section mismatch still warns; school-year
   mismatch still warns (one combined case is enough)

## Verification (required)

- `npm --prefix server run build` — zero errors
- `npm run build` (root) — zero errors (frontend untouched; run anyway per AGENTS.md)
- `npm run lint` (root) — zero NEW warnings (Phase 4 baseline: 1132, all pre-existing)
- `npm --prefix server run test` — all pass (Phase 4 baseline: 149 passed / 57 skipped, plus
  the new unit tests)

## Explicitly OUT of scope

- **No AIMS-side changes** (base names are DepEd-correct; AIMS keeps their naming)
- No Prisma migration, no schema changes, no frontend changes
- Do NOT touch section/school-year warning logic
- Do NOT rename subjects in the DB or change `resolveSubjectName` — display names keep the
  suffix; only the comparison normalizes
- No EnrollPro/ATLAS changes

## Report back

Write **`HANDOFF_AIMS_REPORT_PHASE5.md`** (repo root): files changed + line refs,
build/lint/test output, deviations, discoveries, open items.

---

## Appendix — Live repro data (for after-deploy sanity check)

The lead's live case: teacher `2000061` (Jose Gabriel Santos), course `EP-114-ENG`
("English - Makabansa") linked to a SMART class whose subject is e.g. "English 8".
After the fix, connecting this course must show NO subject warning (section/school-year
warnings may still appear legitimately — e.g. AIMS sandbox schoolYear is 2029-2030).
The original repro "Developmental Reading" vs "Developmental Reading 8" is covered by
test case 1.
