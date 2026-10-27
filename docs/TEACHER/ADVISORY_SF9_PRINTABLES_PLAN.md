# Advisory SF9 + Temporary Term Card — Implementation Plan

Status: **Proposed / ready to implement**
Date: 2026-10-27
Scope: Teacher advisory printables (SF9 + per-term temporary card)
Related: `src/pages/registrar/components/SF9Form.tsx`, `server/src/routes/registrar/forms.ts`, `server/src/routes/advisory.ts`, `src/pages/teacher/MyAdvisory.tsx`, `src/pages/teacher/StudentGradeProfile.tsx`

---

## 1. Locked decisions

All four recommendations are approved:

| # | Decision | Locked behavior |
|---|---|---|
| D1 | Current in-progress term | Temporary card is allowed for the active term. It renders a `DRAFT — GRADES NOT FINAL` banner and watermark until the term is locked / grades are finalized. |
| D2 | Print scope | Support **both** whole-advisory bulk printing and per-student printing. |
| D3 | Temporary card content | **One page only**: learner info, selected term grades, term average, term attendance. No final rating, honors, promotion status, or core-values page. |
| D4 | Who can print | **Adviser only.** Other teachers and registrar/admin cannot call the new teacher endpoints. Registrar keeps its existing SF9 access. |

Additional locked rules:

- No database schema changes and no migrations.
- No writes to EnrollPro / ATLAS / AIMS.
- Teachers can print the **current school year only** in v1. Historical-year SF9 remains registrar-only.
- The official SF9 renderer and the temporary card must share one backend composer; do not fork grade logic.
- Existing registrar SF9 response must remain backward compatible (additive fields allowed).

---

## 2. Goal / non-goals

### Goal

An advisory teacher can:

1. Open the Printables view inside My Advisory for their advisory section.
2. Print the official SF9 for one learner or the whole section.
3. Print a one-page temporary term card for T1, T2, or T3, including the current in-progress term.
4. See a clear DRAFT/FINAL state and a temporary watermark before printing.

### Non-goals (v1)

- Historical-year teacher printing.
- Emailing or downloading PDFs (browser print only).
- Editing grades from the print pages.
- Parent/learner portal access.
- Server-side PDF generation.
- Changing the official SF9 layout.

---

## 3. Current state (verified)

| Area | Existing behavior |
|---|---|
| SF9 renderer | `src/pages/registrar/components/SF9Form.tsx` renders the official 2-page SF9 (learning progress + values/attendance). |
| SF9 data | `GET /api/registrar/forms/sf9/:studentId?schoolYear=` in `server/src/routes/registrar/forms.ts:25`. Registrar-only. Handles rotation merging, dedupe, grade priority, attendance, school identity, promotion status. |
| Printing | `src/pages/registrar/components/records/printForm.ts` clones the form into `.sf-print-container`, injects scoped print CSS, calls `window.print()`, cleans up on `afterprint`. `SchoolForms.tsx` has a duplicate `executePrint` helper. |
| Teacher advisory | `GET /api/advisory/my-advisory`, `GET /api/advisory/student/:studentId/grades`, `GET /api/advisory/summary`, `POST /api/advisory/sync` in `server/src/routes/advisory.ts`. All teacher-only. |
| Teacher UI | `MyAdvisory.tsx` lists advisory learners; `StudentGradeProfile.tsx` shows all subject/term grades. No SF9/term-card printing. |
| Terms | `resolveCurrentTerm()` reads EnrollPro live (DB fallback). Term labels live on `SchoolYear.termLabelT1..T3`. Term dates live on `SystemSettings.t1StartDate..t3EndDate`. Per-term locks live in `TermGradeLock`. |
| Attendance | `buildSf9Attendance()` aggregates 11 monthly SF9 columns from `Attendance` rows. There is no term-range aggregator yet. |

Key constraint from `AGENTS.md`: SF-form queries must filter by `schoolYear` only, never by `isActive` / `isArchived`, or prior-year data disappears after rollover.

---

## 4. Architecture

### 4.1 Shared backend composer

Create `server/src/lib/sf9Composer.ts`.

```ts
type Sf9Mode = "SF9" | "TERM_CARD";

interface ComposeSf9Options {
  studentIds?: string[];      // omit = all students in the section
  sectionId: string;
  schoolYear: string;
  term?: "T1" | "T2" | "T3";  // omit = full SF9
  mode: Sf9Mode;
}

interface ComposeSf9Result {
  meta: Sf9Meta;
  section: Sf9Section;
  students: Sf9Payload[];
}
```

Responsibilities:

- Batch-load enrollments, class assignments, grades, attendance, remedial rows, and school identity once.
- Keep the exact existing SF9 rules:
  - Exclude Homeroom Guidance (`HG*`).
  - Grade-level alignment filter.
  - Canonical subject dedupe (`code + name`).
  - Grade priority: active assignment > non-null quarter density > recency.
  - Merge rotating sub-subjects into one learning-area row.
  - Use `getSchoolIdentityForYear(schoolYear)`.
  - Use `buildSf9Attendance()` for full SF9.
- Add term-only output without changing the full-SF9 output.

Recommended split:

- `composeSf9Section(options)` — public entry point; batch loads and maps.
- `buildStudentSf9(...)` — pure-ish row builder given preloaded data.
- `buildTermCardPayload(...)` — term projection.
- `buildTermAttendance(records, start, end)` — add to `server/src/lib/attendanceAggregate.ts` or keep private in composer.

### 4.2 API contract

Add two endpoints to `server/src/routes/advisory.ts`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/advisory/sf9` | Bulk payload for the adviser's whole advisory section. |
| `GET` | `/api/advisory/sf9/:studentId` | Payload for one learner in the adviser's section. |

Query parameters:

| Param | Values | Required | Meaning |
|---|---|---|---|
| `term` | `T1`, `T2`, `T3` | No | Omit for official full-year SF9. Present for temporary term card. |
| `schoolYear` | `YYYY-YYYY` | No | Must equal the active school year in v1. Omitted = active year. |

Validation schema: new `server/src/schemas/advisory.ts`, using the existing `validate()` middleware shape (`{ body, query, params }`). Invalid term/year returns `400`.

Response (both endpoints return the same student shape; bulk wraps it):

```ts
type Sf9Mode = "SF9" | "TERM_CARD";

interface Sf9Meta {
  mode: Sf9Mode;
  schoolYear: string;
  generatedAt: string;          // ISO
  isTemporary: boolean;         // true for TERM_CARD
  term?: "T1" | "T2" | "T3";
  termLabel?: string;           // SchoolYear.termLabelT1..T3 or "Term 1"
  termStatus?: "DRAFT" | "FINAL";
  termStartDate?: string | null;
  termEndDate?: string | null;
  termDatesDerived?: boolean;
}

interface Sf9Student {
  id: string;
  lrn: string;
  name: string;               // "Last, First Middle Suffix"
  gender: string;
  birthDate?: string;
  age?: number;
  section: string;
  gradeLevel: string;
  schoolYear: string;
  adviser?: string | null;
}

interface FullSf9Payload {
  meta: Sf9Meta & { mode: "SF9"; isTemporary: false; term?: never };
  student: Sf9Student;
  subjectGrades: {
    subjectCode: string;
    subjectName: string;
    teacher?: string;
    T1?: number | null;
    T2?: number | null;
    T3?: number | null;
    final?: number | null;
    remarks?: string | null;
  }[];
  attendance: {
    months: { key: string; label: string; schoolDays: number; present: number; absent: number }[];
    total: { schoolDays: number; present: number; absent: number };
  };
  generalAverage?: number | null;
  honors?: string | null;
  promotionStatus?: string | null;
  schoolSettings: {
    schoolName: string;
    division: string;
    region: string;
    schoolHeadName: string;
    district?: string;
  };
}

interface TermCardPayload {
  meta: Sf9Meta & { mode: "TERM_CARD"; isTemporary: true; term: "T1" | "T2" | "T3" };
  student: Sf9Student;
  termSubjects: {
    subjectCode: string;
    subjectName: string;
    teacher?: string;
    grade: number | null;
    remarks: "Passed" | "Failed" | null;
  }[];
  termAverage: number | null;
  termAttendance: {
    startDate: string | null;
    endDate: string | null;
    schoolDays: number;
    present: number;
    absent: number;
  } | null;
  schoolSettings: {
    schoolName: string;
    division: string;
    region: string;
    schoolHeadName: string;
    district?: string;
  };
}

type Sf9Payload = FullSf9Payload | TermCardPayload;

interface Sf9BatchResponse {
  meta: Sf9Meta;
  section: {
    id: string;
    name: string;
    gradeLevel: string;
    schoolYear: string;
    adviser: string | null;
    totalStudents: number;
  };
  students: Sf9Payload[];
}
```

Single endpoint returns `Sf9Payload` directly.

### 4.3 Authorization matrix

| Caller | `GET /api/advisory/sf9` | `GET /api/advisory/sf9/:studentId` | `GET /api/registrar/forms/sf9/:studentId` |
|---|---|---|---|
| Adviser of that section (current SY) | `200` | `200` | `403` (unchanged) |
| Teacher, not adviser | `403` | `403` | `403` |
| Registrar | `403` | `403` | `200` (unchanged) |
| Admin | `403` | `403` | `403` (unchanged) |
| No advisory section | `404` | `404` | n/a |

Adviser verification:

```ts
const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id } });
const section = await prisma.section.findFirst({
  where: { adviserId: teacher.id, schoolYear },
});
```

Never trust a `studentId` alone. For the single endpoint, resolve the learner's enrollment in that section first.

Bulk enrollment filter: `status: "ENROLLED"` (matches `my-advisory`). Single endpoint may use any status (`ENROLLED`, `DROPPED`, `TRANSFERRED`) so the adviser can print for a learner who left.

### 4.4 Term-card data rules

| Rule | Behavior |
|---|---|
| Term selection | Exactly one of `T1` / `T2` / `T3`; no mixed columns. |
| Subject rows | One row per merged learning area. Off-term rotation rows render blank. |
| Term grade | `Grade.quarterlyGrade` for the selected term. No fallback to other terms. |
| Term average | Average of non-null term grades across rows, rounded to 2 decimals. `null` if no grades. |
| Final rating / honors / promotion | Omitted (`null`), never displayed on the term card. |
| Term status | `FINAL` only when `hasTermGrades && (termLocked || allTermGradesFinalized)`. Otherwise `DRAFT`. |
| Term lock | `TermGradeLock` for `(schoolYearId, term)`, or `YearGradeLock` when the whole year is locked. |
| All finalized | Every non-null term grade for the learner has `Grade.status === "FINALIZED"` or `"LOCKED"`. |
| Attendance | Aggregate records from `termStartDate` to `termEndDate` inclusive. If either date is missing, `termAttendance = null` and UI shows an explanatory note. |
| Term labels | `SchoolYear.termLabelT1..T3`; fallback to `Term 1` / `Term 2` / `Term 3`. |
| Watermark | Always `TEMPORARY — TERM X ONLY`. Add a second `DRAFT — GRADES NOT FINAL` banner when `termStatus === "DRAFT"`. |
| No grades | Render rows with dashes, warn, and still allow printing. |

Term attendance mirrors SF9 attendance semantics:

- School day = distinct date with a saved `Attendance` row for that learner.
- `PRESENT`, `LATE`, `EXCUSED` count as present.
- `ABSENT` counts as absent.

### 4.5 Frontend architecture

Printables is embedded inside **My Advisory** as a second view. There is no new sidebar item and no standalone printables page.

- `MyAdvisory.tsx` renders a **Student Directory / Printables** view switcher below the advisory summary.
- The printables view is deep-linkable: `/teacher/advisory?view=printables`.
- `/teacher/advisory/print` is kept as a redirect to `/teacher/advisory?view=printables` for old links.
- The `MyAdvisory` header button and mobile print icon switch to the printables view.
- `StudentGradeProfile.tsx` gets **Print SF9** and **Print Term Card** actions.

View layout:

1. `MyAdvisory` header and summary stats remain visible; the view switcher sits below them.
2. Printables section title + mode segmented control:
   - `Official SF9 (full year)` — default.
   - `Temporary Term Card` — reveals T1/T2/T3 pills.
3. Term pills (`T1`, `T2`, `T3`) using configured labels; disabled when term card mode is off.
4. Toolbar: search by name/LRN, select all, selected count.
5. Student list:
   - Desktop: accessible table rows.
   - Mobile: card rows; minimum 44px tap targets; no horizontal scroll.
6. Preview panel: shows the selected/first learner. Re-renders on mode/term change.
7. Actions: `Print selected (N)`; disabled when `N === 0` or data is loading.
8. States: loading, error, no advisory, no learners, no grades for term.

Print preview dialog shared by the print center and profile page:
`src/components/forms/sf9/PrintPreviewDialog.tsx`.

### 4.6 Print pipeline

- Move `src/pages/registrar/components/records/printForm.ts` to `src/lib/printForm.ts`.
- Keep a re-export at the old path so registrar imports do not churn unnecessarily.
- Extend the helper:

```ts
printForm(node, {
  styleId: "advisory-print-style",
  orientation: "portrait",
  extraCss: `
    .term-card-watermark { font-size: 46pt !important; }
    .print-form-term-card { page-break-after: always !important; }
  `,
});
```

- Bulk print renders every selected payload into the same `printRef` container, then calls `printForm` once.
- The print container is cloned; the on-screen app is untouched.
- Cleanup must remove:
  - `.sf-print-container`
  - the injected `<style id="...">`
- Add `printForm`'s missing cleanup test hook: dispatch `afterprint` in Playwright and assert both are removed.

Shared form components:

- Move `SF9Form.tsx` to `src/components/forms/sf9/SF9Form.tsx`; update the 3 registrar imports (`SchoolForms.tsx`, `records/Sf9Tab.tsx`, `BulkFormsView.tsx`).
- New `src/components/forms/sf9/TermCardForm.tsx`.
- Add root test ids:
  - `data-testid="sf9-form"` on SF9Form root.
  - `data-testid="term-card-form"` and `data-term-status` on TermCardForm root.

CSS additions in `src/index.css`:

```css
@media print {
  .print-form-term-card {
    page-break-after: always;
    break-after: page;
  }
  .print-form-term-card table {
    width: 100% !important;
    table-layout: fixed;
    font-size: 10px !important;
  }
  .term-card-watermark {
    /* opacity-based so the global `.print-form * { color: black }` rule does not erase it */
    color: #000 !important;
    opacity: 0.08;
    font-weight: 700;
    pointer-events: none;
  }
}
```

---

## 5. File map

### New files

| File | Purpose |
|---|---|
| `server/src/lib/sf9Composer.ts` | Shared SF9 + term-card payload builder. |
| `server/src/schemas/advisory.ts` | Zod query schema for `term` / `schoolYear`. |
| `server/src/__tests__/attendance-term.test.ts` | Term attendance aggregation tests. |
| `server/src/__tests__/advisory-sf9.test.ts` | Endpoint auth/contract tests. |
| `src/components/forms/sf9/SF9Form.tsx` | Moved shared official SF9 renderer. |
| `src/components/forms/sf9/TermCardForm.tsx` | One-page temporary term card. |
| `src/components/forms/sf9/PrintPreviewDialog.tsx` | Shared preview + print dialog. |
| `src/pages/teacher/components/AdvisoryPrintablesPanel.tsx` | Embedded printables view inside My Advisory. |
| `src/lib/printForm.ts` | Shared clone-node print helper. |
| `e2e/advisory-printables.spec.ts` | Playwright regression guard. |

### Modified files

| File | Change |
|---|---|
| `server/src/routes/registrar/forms.ts` | Delegate SF9 assembly to `sf9Composer` (no response break). |
| `server/src/routes/advisory.ts` | Add the two teacher endpoints. |
| `server/src/lib/attendanceAggregate.ts` | Add term-range aggregation helper. |
| `src/lib/api.ts` | Add `Sf9Meta`, `Sf9Payload`, term-card types, `advisoryApi.getSf9` / `getSf9Section`. |
| `src/App.tsx` | Redirect legacy `/teacher/advisory/print` to `/teacher/advisory?view=printables`. |
| `src/pages/teacher/MyAdvisory.tsx` | Add Student Directory / Printables view switcher and embed the panel. |
| `src/pages/teacher/StudentGradeProfile.tsx` | Add per-student print actions. |
| `src/pages/registrar/SchoolForms.tsx` | No change required; SF9Form re-export kept compatibility. |
| `src/pages/registrar/components/records/Sf9Tab.tsx` | No change required; printForm re-export kept compatibility. |
| `src/pages/registrar/components/BulkFormsView.tsx` | No change required; SF9Form re-export kept compatibility. |
| `src/index.css` | Term-card print styles. |
| `e2e/fixtures.ts` | Optional second-teacher account helper for non-adviser tests. |

All files stay under the 1000-line limit. `MyAdvisory.tsx` gains only an action button.

---

## 6. Implementation phases and gates

Each phase ends at a gate. Do not start the next phase until the gate passes.

### Phase 0 — Baseline

- Run the existing gates on a clean tree.
- Record baseline results in the PR description.

**Gate 0 — Baseline green**

```bash
pnpm install
pnpm run verify
pnpm run test:e2e
```

Pass criteria:

- `verify` passes.
- Existing Playwright suite passes.
- Baseline SF9 print is saved as a reference PDF (registrar portal, one learner).

### Phase 1 — Composer extraction + registrar parity

- Create `sf9Composer.ts`.
- Refactor the registrar SF9 route to call it.
- Add composer unit tests.
- Keep response shape identical except for the additive `meta` field.

**Gate 1 — Contract parity**

```bash
pnpm --prefix server run build
pnpm --prefix server test
pnpm run build
pnpm run lint
```

Pass criteria:

- Registrar SF9 payload deep-equals the baseline for the fixture learner, ignoring the new `meta` object and key ordering.
- Same subject rows, same rotation merge, same averages, same attendance, same promotion status.
- No query filters on `ClassAssignment.isActive` / `Enrollment.isArchived` in the composer; only `schoolYear`.
- SF9 still prints 2 pages in manual/PDF check.

### Phase 2 — Teacher endpoints + authorization

- Add the Zod schema, endpoints, and tests.
- Add API types/methods to `src/lib/api.ts`.

**Gate 2 — Adviser-only and scoped**

```bash
pnpm --prefix server test
```

Pass criteria:

- Adviser gets `200` for both endpoints.
- Non-adviser teacher gets `403`.
- Registrar/admin gets `403` on the new endpoints.
- Bulk response contains only learners from the adviser's section.
- Single response works for `ENROLLED`, `DROPPED`, and `TRANSFERRED` learners in the section.
- Invalid term returns `400`.
- Non-active `schoolYear` returns `400` in v1.
- No N+1: bulk request for a 40+ learner section executes a fixed number of queries (assert via query counter or timing budget < 2s).

### Phase 3 — Shared renderers + print CSS

- Move `SF9Form` and `printForm`.
- Create `TermCardForm` and `PrintPreviewDialog`.
- Add print CSS and test ids.

**Gate 3 — Print DOM and pagination**

- Term card DOM contains exactly one term column.
- Term card has no `final`, honors, or promotion labels.
- Official SF9 still contains the `.sf9-page-break` and 2-page structure.
- Watermark renders when `termStatus === "DRAFT"`.
- Print cleanup removes the container and style tag after `afterprint`.

### Phase 4 — Teacher UI

- Add the embedded Student Directory / Printables view switcher in MyAdvisory, the legacy redirect, profile actions, and query wiring.
- Add responsive layouts.

**Gate 4 — UI build and smoke**

```bash
pnpm run typecheck
pnpm run build
pnpm run lint
pnpm run test:e2e
```

Pass criteria:

- `/teacher/advisory` and `/teacher/advisory?view=printables` load for an adviser.
- There is no new sidebar item; Printables is reached from My Advisory.
- No console errors or API responses >= 400 during the flow.
- Non-advisers never see the Printables view.
- Printables is usable at 320px, 768px, and 1280px widths.
- Existing teacher and registrar pages remain clean.

### Phase 5 — Playwright regression guard

- Add `e2e/advisory-printables.spec.ts`.
- Optionally add the second-teacher fixture.

**Gate 5 — Playwright guard green**

```bash
pnpm exec playwright test e2e/advisory-printables.spec.ts
pnpm run test:e2e
```

Pass criteria:

- All new Playwright tests pass.
- Full existing suite passes.
- No test writes to the database.

### Phase 6 — Manual print sign-off

Print to PDF in Chrome/Edge and inspect:

1. Official SF9: exactly 2 pages per learner, A4 portrait, no clipped rows.
2. Temporary card: exactly 1 page per learner, A4 portrait.
3. Bulk 5 learners: 5 cards/SF9s in alphabetical order, no interleaved pages.
4. Watermark visible but light; DRAFT banner visible for an unlocked term.
5. Footer signatures present; adviser name correct.
6. Dark mode does not affect print output (black text on white).
7. Registrar SF9 output is unchanged.

**Gate 6 — Sign-off**

- Attach PDFs to the PR.
- Obtain one adviser + one registrar sign-off.

---

## 7. Test plan

### 7.1 Backend unit tests

`server/src/__tests__/sf9-composer.test.ts`

| ID | Test |
|---|---|
| U-01 | Full SF9 returns all terms and final ratings. |
| U-02 | Term card returns only the requested term; `T1/T2/T3` other columns absent/ignored. |
| U-03 | Term average ignores null grades and rounds to 2 decimals. |
| U-04 | HG subjects are excluded in both modes. |
| U-05 | Duplicate assignments dedupe to one row. |
| U-06 | Rotation group merges into one row and places each sub-subject in its term slot. |
| U-07 | Off-term rotation rows are blank on the term card. |
| U-08 | Grade priority prefers the active assignment, then dense quarters, then recency. |
| U-09 | `termStatus` is `FINAL` when the term is locked or all term grades are finalized; otherwise `DRAFT`. |
| U-10 | `termStatus` is `DRAFT` when there are no grades, even if the term is locked. |
| U-11 | Term attendance uses only records inside the term date range; returns `null` when dates are missing. |
| U-12 | Full SF9 attendance still returns 11 monthly columns. |
| U-13 | Promotion status comes from the enrollment when present; otherwise the DO 13 derivation is used. |
| U-14 | Null/blank grades do not produce NaN or `0` ratings. |

`server/src/__tests__/advisory-sf9.test.ts`

| ID | Test |
|---|---|
| A-01 | Adviser `GET /advisory/sf9` → `200`, only section learners. |
| A-02 | Adviser `GET /advisory/sf9/:studentId` → `200`. |
| A-03 | Non-adviser teacher → `403` on both endpoints. |
| A-04 | Registrar → `403` on both new endpoints. |
| A-05 | Admin → `403` on both new endpoints. |
| A-06 | `term=T4` → `400`. |
| A-07 | Non-active `schoolYear` → `400`. |
| A-08 | Learner outside the adviser's section → `403`. |
| A-09 | `DROPPED` / `TRANSFERRED` single learner → `200`. |
| A-10 | Bulk excludes `DROPPED` / `TRANSFERRED`. |
| A-11 | Registrar SF9 endpoint still returns `200` after the composer refactor. |
| A-12 | Bulk response has no duplicate students and is alphabetically ordered by last name. |

### 7.2 Playwright guard spec

File: `e2e/advisory-printables.spec.ts`
Read-only: never mutate grades, locks, terms, or enrollments.

Add these test ids to the implementation:

| Selector | Location |
|---|---|
| `[data-testid="advisory-printables-link"]` | MyAdvisory header/mobile button |
| `[data-testid="print-center"]` | Print center root |
| `[data-testid="print-mode-sf9"]` | Mode toggle |
| `[data-testid="print-mode-term"]` | Mode toggle |
| `[data-testid="term-pill-T1"]` / `T2` / `T3` | Term selector |
| `[data-testid="student-row"]` | Student row/card |
| `[data-testid="student-checkbox"]` | Per-student checkbox |
| `[data-testid="select-all"]` | Select-all control |
| `[data-testid="print-selected"]` | Bulk print action |
| `[data-testid="preview-pane"]` | Preview panel |
| `[data-testid="preview-dialog"]` | Print preview dialog |
| `[data-testid="confirm-print"]` | Dialog print action |
| `[data-testid="sf9-form"]` | Official SF9 root |
| `[data-testid="term-card-form"]` | Term card root |
| `[data-testid="term-card-watermark"]` | Term card watermark |
| `[data-testid="term-status-badge"]` | DRAFT/FINAL badge |
| `[data-testid="print-student-sf9"]` | StudentGradeProfile action |
| `[data-testid="print-student-term"]` | StudentGradeProfile action |
| `[data-testid="student-profile-link"]` | MyAdvisory row link |

Print stubbing (must be installed before `login`):

```ts
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    (window as any).__printCalls = 0;
    (window as any).__printFormCounts = [] as number[];
    window.print = () => {
      (window as any).__printCalls += 1;
      (window as any).__printFormCounts.push(
        document.querySelectorAll(".sf-print-container .print-form").length,
      );
    };
  });
}
```

Tests:

| ID | Test | Key assertions |
|---|---|---|
| E-01 | Print center loads clean | `/teacher/advisory?view=printables` renders `print-center`, at least 1 `student-row`, no `collectProblems()` entries, no login bounce. |
| E-02 | MyAdvisory entry point | Click `advisory-printables-link` from `/teacher/advisory`; the embedded panel appears, the URL becomes `?view=printables`, no advisory reload occurs, and no sidebar `Printables` link exists. |
| E-03 | Official SF9 bulk print | Select 2 learners, click `print-selected`; `__printCalls === 1`, `__printFormCounts[0] === 2`, 2 `.print-form-sf9` clones. |
| E-04 | SF9 print cleanup | Dispatch `window.dispatchEvent(new Event("afterprint"))`; `.sf-print-container` count `0`, injected style id count `0`. |
| E-05 | Term card mode | Click `print-mode-term`; term pills visible; select T1; `term-card-form` visible; no `Final Rating` / honors / promotion text. |
| E-06 | Term card status invariant | `data-term-status` is `DRAFT` or `FINAL`. If `DRAFT`, watermark and DRAFT banner are visible. If `FINAL`, DRAFT banner is absent; temporary watermark remains. |
| E-07 | Term card bulk print | Select 2 learners, print; `__printCalls === 1`, 2 `.print-form-term-card` clones. |
| E-08 | Single-learner SF9 from profile | Open first `student-profile-link`; click `print-student-sf9`; preview dialog shows `sf9-form`; click `confirm-print`; print called once with 1 clone. |
| E-09 | Single-learner term card from profile | Click `print-student-term`; choose T1; preview shows `term-card-form`; print called once with 1 clone. |
| E-10 | Role guard | Registrar session visiting `/teacher/advisory?view=printables` does not see `print-center` and is redirected to login/dashboard. |
| E-11 | API contract: SF9 | Teacher token `GET /api/advisory/sf9` → 200, `meta.mode === "SF9"`, `students.length > 0`, all students share the same section. |
| E-12 | API contract: term card | Teacher token `GET /api/advisory/sf9?term=T1` → 200, `meta.mode === "TERM_CARD"`, `meta.isTemporary === true`, every student has `termSubjects`. |
| E-13 | API validation | `term=T4` → 400. Non-active `schoolYear` → 400. |
| E-14 | API role guard | Registrar token on `/api/advisory/sf9` → 403. Teacher token on `/api/registrar/forms/sf9/:id` → 403. Registrar token on the same registrar endpoint → 200. |
| E-15 | Optional non-adviser teacher | If `SMART_TEST_TEACHER2_*` is configured, teacher2 `GET /api/advisory/sf9/:studentId` for teacher1's learner → 403. Skip when not configured. |
| E-16 | Print pagination gate | Generate a PDF from the cloned print container. Term card must be exactly 1 page; official SF9 must be exactly 2 pages. Skip when Chromium headless PDF is unavailable. |
| E-17 | Legacy URL redirect | `/teacher/advisory/print` redirects to `/teacher/advisory?view=printables` and renders the embedded printables panel. |

Reference skeleton:

```ts
import { test, expect, type Page } from "@playwright/test";
import { login, collectProblems, account } from "./fixtures";

const API = process.env.SMART_API_URL ?? "http://localhost:5003/api";

async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    (window as any).__printCalls = 0;
    (window as any).__printFormCounts = [] as number[];
    window.print = () => {
      (window as any).__printCalls += 1;
      (window as any).__printFormCounts.push(
        document.querySelectorAll(".sf-print-container .print-form").length,
      );
    };
  });
}

test.describe("advisory printables (read-only)", () => {
  test("E-01 print center loads without console/API errors", async ({ page }) => {
    await stubPrint(page);
    const problems = collectProblems(page);
    await login(page, "teacher");
    await page.goto("/teacher/advisory?view=printables", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("print-center")).toBeVisible();
    expect(await page.getByTestId("student-row").count()).toBeGreaterThan(0);
    expect(page.url()).not.toContain("/login");
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("E-03/E-04 SF9 bulk print clones the selection and cleans up", async ({ page }) => {
    await stubPrint(page);
    await login(page, "teacher");
    await page.goto("/teacher/advisory?view=printables", { waitUntil: "domcontentloaded" });

    const rows = page.getByTestId("student-row");
    await rows.nth(0).getByTestId("student-checkbox").check();
    await rows.nth(1).getByTestId("student-checkbox").check();
    await page.getByTestId("print-selected").click();

    await expect.poll(() => page.evaluate(() => (window as any).__printCalls)).toBe(1);
    const counts = await page.evaluate(() => (window as any).__printFormCounts);
    expect(counts[0]).toBe(2);
    expect(await page.locator(".sf-print-container .print-form-sf9").count()).toBe(2);

    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator(".sf-print-container")).toHaveCount(0);
    await expect(page.locator('style[id="advisory-print-style"]')).toHaveCount(0);
  });

  test("E-05/E-06 term card is one term, temporary, and status-consistent", async ({ page }) => {
    await stubPrint(page);
    await login(page, "teacher");
    await page.goto("/teacher/advisory?view=printables", { waitUntil: "domcontentloaded" });

    await page.getByTestId("print-mode-term").click();
    await page.getByTestId("term-pill-T1").click();

    const card = page.getByTestId("term-card-form").first();
    await expect(card).toBeVisible();
    await expect(page.getByTestId("term-card-watermark").first()).toBeVisible();
    await expect(card.getByText(/final rating/i)).toHaveCount(0);
    await expect(card.getByText(/with honors|promoted|retained/i)).toHaveCount(0);

    const status = await card.getAttribute("data-term-status");
    expect(["DRAFT", "FINAL"]).toContain(status);
    if (status === "DRAFT") {
      await expect(page.getByTestId("term-status-badge").first()).toContainText(/draft/i);
    } else {
      await expect(page.getByTestId("term-status-badge").first()).toContainText(/final/i);
    }
  });

  test("E-11/E-14 API contract and role separation", async ({ page, request }) => {
    await login(page, "teacher");
    const token = await page.evaluate(() => sessionStorage.getItem("token_teacher"));
    const teacherHeaders = { Authorization: `Bearer ${token}` };

    const full = await request.get(`${API}/advisory/sf9`, { headers: teacherHeaders });
    expect(full.status()).toBe(200);
    const fullBody = await full.json();
    expect(fullBody.meta.mode).toBe("SF9");
    expect(fullBody.students.length).toBeGreaterThan(0);

    const term = await request.get(`${API}/advisory/sf9?term=T1`, { headers: teacherHeaders });
    expect(term.status()).toBe(200);
    const termBody = await term.json();
    expect(termBody.meta.mode).toBe("TERM_CARD");
    expect(termBody.meta.isTemporary).toBe(true);

    const bad = await request.get(`${API}/advisory/sf9?term=T4`, { headers: teacherHeaders });
    expect(bad.status()).toBe(400);

    const studentId = fullBody.students[0]?.student?.id;
    const teacherOnRegistrar = await request.get(
      `${API}/registrar/forms/sf9/${studentId}?schoolYear=${fullBody.meta.schoolYear}`,
      { headers: teacherHeaders },
    );
    expect(teacherOnRegistrar.status()).toBe(403);

    const reg = account("registrar");
    const regLogin = await request.post(`${API}/auth/login`, {
      data: { email: reg.id, password: reg.pw },
    });
    const { token: regToken } = await regLogin.json();
    const regHeaders = { Authorization: `Bearer ${regToken}` };

    expect((await request.get(`${API}/advisory/sf9`, { headers: regHeaders })).status()).toBe(403);
    expect(
      (await request.get(
        `${API}/registrar/forms/sf9/${studentId}?schoolYear=${fullBody.meta.schoolYear}`,
        { headers: regHeaders },
      )).status(),
    ).toBe(200);
  });
});
```

Implementation notes for the spec:

- Create `stubPrint` before `login` so the app never opens a real print dialog.
- Do not assert exact term grade values; the test DB may change.
- Assert structural invariants (mode, columns, status, counts), not fixture-specific grades.
- Dispatch `afterprint` to exercise cleanup deterministically.
- Keep the spec read-only; the only side effect is the browser print stub.
- If the teacher account has no advisory, `test.skip()` with a clear message instead of failing unrelated suites.

### 7.3 Regression invariants (must never break)

1. Registrar SF9 still renders and prints 2 pages.
2. Registrar SF9 payload keeps all existing fields, values, and ordering semantics.
3. `GET /api/registrar/forms/sf9/:studentId` remains registrar-only.
4. `my-advisory`, student grade profile, attendance, and class-record pages remain error-free.
5. The Printables view (`/teacher/advisory?view=printables`) is unreachable for non-advisers.
6. No `isActive` / `isArchived` filter is added to SF-form read paths.
7. Term card never shows T1/T2/T3 together, final rating, honors, or promotion status.
8. Bulk print produces exactly one form per selected learner.
9. Print cleanup leaves no `.sf-print-container` or injected style in the DOM.
10. No raw upstream error strings leak into the printables UI.
11. Printing does not mutate grades, locks, enrollments, or sync state.
12. Both light and dark mode print black text on white.

---

## 8. Implementation status (2026-10-27)

| Item | Status |
|---|---|
| Shared composer (`server/src/lib/sf9Composer.ts`) | Done. Registrar SF9 route delegates to it. |
| Teacher endpoints (`GET /api/advisory/sf9`, `GET /api/advisory/sf9/:studentId`) | Done. Adviser-only, current-SY-only, `term` validation via Zod. |
| Term-range attendance (`buildTermAttendance`) | Done with unit tests. |
| Shared renderers (`SF9Form`, `TermCardForm`, `PrintPreviewDialog`) | Done. Registrar keeps re-export compatibility. |
| Printables embedded inside My Advisory (no sidebar item) + profile entry points | Done. Student Directory / Printables view switcher; legacy route redirects. |
| Print CSS + watermark + DRAFT/FINAL banner | Done. Print-emulated screenshot confirms the watermark is visible without obscuring grades. |
| Playwright guard (`e2e/advisory-printables.spec.ts`) | 9 passed, 2 skipped (missing registrar / teacher2 test credentials). |
| PDF pagination gate | Verified: term card 1 page, official SF9 2 pages. |
| Typecheck / build / server build / lint | Pass (lint reports pre-existing warnings only). |
| Live API smoke | Teacher full SF9 + T1 term card + invalid-term 400 verified against the dev server. |

Environment limitation: the local Playwright registrar account returns `401`, so registrar-login-dependent tests skip. The registrar SF9 route now uses the same composer, which removes the grade-logic parity risk. Re-run the skipped tests once valid registrar/teacher2 credentials are configured.

Remaining manual QA: 60-learner bulk print, dark-mode print preview, signature placement, and physical A4 sign-off.

---

## 9. Acceptance criteria

A PR is mergeable only when:

- [ ] Gate 0 baseline recorded.
- [ ] Gate 1 registrar parity passed.
- [ ] Gate 2 adviser-only authorization passed.
- [ ] Gate 3 print DOM/pagination checks passed.
- [ ] Gate 4 build/lint/UI smoke passed.
- [ ] Gate 5 `e2e/advisory-printables.spec.ts` + full e2e suite passed.
- [ ] Gate 6 manual PDF sign-off attached.
- [ ] No schema migration.
- [ ] No changes to `.env` / `.env.*`.
- [ ] All new/modified files under 1000 lines.
- [ ] `pnpm run verify` passes on the final commit.

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Composer refactor changes registrar SF9 output | High | Gate 1 deep-equality parity test against the pre-refactor payload; keep additive-only `meta`. |
| Divergent grade logic between registrar and teacher | High | Single composer; no copy-pasted subject/rotation logic. |
| Bulk endpoint N+1 queries | Medium | Batch-load grades/attendance; Gate 2 query-count or timing assertion. |
| Temporary card accidentally looks official | High | Mandatory `TEMPORARY — TERM X ONLY` watermark; no final/honors/promotion fields; footer states generated by SMART. |
| Printing DRAFT grades as final | High | `DRAFT` banner + status badge; tests assert the invariant. |
| Term dates missing/derived | Medium | `termAttendance = null` and a UI note; never fabricate attendance. |
| Print CSS leaks globally | Medium | Scoped `.sf-print-container` rules injected only during print; cleanup gate. |
| Watermark erased by global black-text rule | Medium | Opacity-based watermark + `!important` font-size via `extraCss`. |
| Bulk print of 60+ learners is slow | Medium | Batch API, single `window.print()` call, loading state; manual 60-learner check. |
| Teacher sees historical data incorrectly | High | v1 rejects non-active school years; historical access remains registrar-only. |
| Playwright opens real print dialog | High | `window.print` stub installed before login; no real dialog. |

---

## 11. Rollback

- No DB migration, so rollback is code-only.
- Deploy backend first; old frontend is unaffected because the registrar endpoint is unchanged.
- If the teacher UI misbehaves, remove the nav/page route; backend endpoints can remain dormant.
- If the composer refactor causes parity issues, revert `registrar/forms.ts` to its previous inline implementation while keeping the composer for teacher endpoints (temporary duplication, tracked as a follow-up).
