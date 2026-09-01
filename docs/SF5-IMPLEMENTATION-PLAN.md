# SF5 Implementation Plan — Full DepEd Layout

## Overview
Upgrade SF5 (Report on Promotion) from a basic 4-column table to a full DepEd-aligned form with gender-split layout, summary tables, print support, and Excel export.

## Key Corrections from Review (already applied below)
- **Descriptive letters were wrong.** DO 8, s. 2015 scale is O / VS / S / FS / DNME — not A / P / AP / D / B (that is the pre-2015 DO 73 scale).
- **`incompleteSubjects` ≠ failing subjects.** Split into `failingSubjects` (drives Action Taken) and `incompleteSubjects` (missing/null grades → the 2 Incomplete sub-columns). The original plan conflated both.
- **Incomplete columns need prev SY + current SY data** — one array is insufficient.
- **Retained learners still show a General Average.** GA is blank only when there are no grades at all.
- **Single sequential table** (males → females), not side-by-side.
- **File-size rule (AGENTS.md: 1000 lines max).** `registrar.ts` (~1690 lines) and `SchoolForms.tsx` (~1800 lines) already exceed it — extract new code into `sf5Composer.ts` and `SF5Form.tsx`.
- **Phase 5 merged forward** — types must exist before Phase 2 renders; `exportSF5` belongs with Phase 4.

---

## Architecture Note — Extraction (Phase 0)

| New file | Purpose |
|---|---|
| `server/src/lib/sf5Composer.ts` | All SF5 assembly logic: student query, GA + descriptor, Action Taken, failing/incomplete detection, summaries, school settings. Both the data endpoint and export endpoint call it — one code path, zero drift. Mirrors existing `teacherDashboardComposer.ts` pattern. |
| `src/pages/registrar/components/SF5Form.tsx` | `renderSF5Content` + print CSS + export button as a self-contained component. Keeps `SchoolForms.tsx` from growing further. |

No logic in `registrar.ts` beyond route + guard + zod + composer call.

---

## Phase 1: Backend — Enhance SF5 Data Response

**File:** `server/src/routes/registrar.ts` (lines 1541-1688) — logic extracted to `server/src/lib/sf5Composer.ts`

### 1.1 Add School Settings to Response
Currently returns no school info. Add `systemSettings` query:
```ts
const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
```
Include in response: `schoolName`, `schoolId`, `division`, `region`, `district`.
- Null-safe: if settings row is missing, return empty strings — never crash the form.

### 1.2 Fix Attendance Filtering
**Bug:** Line 1587 — attendance query uses `sectionId` only, not filtered by school year.
**Fix:** Add `date` filter to only count attendance within the school year's date range (June 1 of start year → March/April of end year).
- Note: attendance is not an official SF5 column; keep it in the payload only if another view consumes it, otherwise drop to reduce response size.

### 1.3 Add TypeScript Interfaces
**File:** `src/lib/api.ts` (defined here, consumed in Phase 2 — do not redefine in Phase 5)
```ts
interface SF5Data {
  section: {
    id: string; name: string; gradeLevel: string;
    program: string; schoolYear: string; adviser: string | null;
  };
  students: SF5Student[];
  summary: {
    totalStudents: number; promoted: number;
    conditional: number; retained: number; noGrades: number;
    male: { promoted: number; conditional: number; retained: number; noGrades: number };
    female: { promoted: number; conditional: number; retained: number; noGrades: number };
    descriptors: Record<"O" | "VS" | "S" | "FS" | "DNME", { male: number; female: number; total: number }>;
  };
  schoolSettings: {
    schoolName: string; schoolId: string;
    division: string; region: string; district: string;
  };
}
interface SF5Student {
  lrn: string; name: string; firstName: string; lastName: string;
  middleName: string; gender: string;
  subjectDetails: Array<{
    subjectCode: string; subjectName: string;
    finalGrade: number | null; termGrades: Record<string, number | null>; // keyed T1..T3
  }>;
  generalAverage: number | null;
  descriptor: "O" | "VS" | "S" | "FS" | "DNME" | null;
  promotionStatus: "Promoted" | "Conditional" | "Retained" | "No Grades";
  failingSubjects: string[]; // finalGrade < 75 — drives Action Taken
  incompleteSubjects: { prevSY: string[]; currentSY: string[] }; // finalGrade == null
  attendance: { present: number; absent: number; late: number; excused: number; total: number };
}
```
- **Term count:** Curriculum uses **3 terms per SY** (confirmed). `termGrades` keyed `T1`/`T2`/`T3`. Read the distinct terms from the `Term` model for the active school year rather than hardcoding, so a future term-count change is a config change, not a code change.
- Summary must be gender-disaggregated — the two summary tables need per-gender counts (add `male`/`female`/`descriptors` to summary; the original flat summary cannot render them).

### 1.4 Enhance Backend Computation
- Add `failingSubjects` array per student (subjects where finalGrade < 75) — drives Action Taken and the conditional/retained counts
- Add `incompleteSubjects` per student, split `prevSY` / `currentSY` — subjects with **missing/null** final grades (transfers-in mid-year, unsubmitted grades). Distinct from failing.
  - Prev-SY incompletes come from the learner's prior-year enrollment record (if available; otherwise empty array — never guess)
- Add `firstName`, `lastName`, `middleName` to response (not just combined `name`)
- Add `termGrades` per subject (T1–T3 breakdown)
- Add `conditional` count to summary (1-2 failing subjects = conditional)
- **Grade source:** read finalized/locked grades only. If EOSY finalization has run, prefer snapshot data (same pattern as SF10 snapshot) so historical reprints stay identical.
- **Sorting:** males first, then females; alphabetical by last name within each block.
- Learners with `T/O` (transferred out) or `DRP` status: include with their last-known promotion status and remark in Action Taken column? — **decide explicitly**; DepEd SF5 counts them in totals. Confirm against official template in TemplateManager.

---

## Phase 2: Frontend — `renderSF5Content` (DepEd Layout)

**File:** `src/pages/registrar/components/SF5Form.tsx` (new component; wired into `SchoolForms.tsx`)

### 2.1 Add Ref and View Section
```ts
const sf5PrintRef = useRef<HTMLDivElement | null>(null);
```
Update SF5 view (lines 1726-1799) to use ref + print button (same pattern as SF10).

### 2.2 Create `renderSF5Content(data: SF5Data)`
Full DepEd layout structure:

#### Header (top of form)
```
Republic of the Philippines
Department of Education
Region [___] Division [___]

School Form 5 (SF 5)
Report on Promotion and Learning Progress & Achievement
(Revised to conform with the instructions of DepEd Order 8, s. 2015)

School ID: [___]  School Year: [___ - ___]
District: [___]   School Name: [___]
Curriculum: [___]  Grade Level: [__]  Section: [___]
```

#### Main Table — Single Sequential Table, Gender-Split
One table, **males first then females** (no side-by-side columns — "left side" layout in the original plan is not the DepEd format):
| LRN | Learner's Name | General Average (w/ Descriptive Letter) | Action Taken | Incomplete Subjects (prev SY) | Incomplete Subjects (current SY) |
Rows for each male student (alphabetical by last name), then **SUB TOTAL — MALE: [N]** row, then female students, then **SUB TOTAL — FEMALE: [N]** row, then **TOTAL: [N]**.
- Invariant: male + female = TOTAL = student count.
- Empty LRN / null GA / empty lists render blank — never "undefined" or "null".

#### General Average Formatting
- All GAs: 2 decimal places + descriptor — e.g., `85.75 (VS)`, `76.39 (FS)`
- Honor-level GA (≥ 90): 3 decimal places only if matching the existing SF10 GA convention (rank transparency) — otherwise 2; keep both forms consistent
- Blank **only** when the learner has no grades at all. Retained learners still show their GA.

#### Descriptive Letters (DO 8, s. 2015 — corrected)
| Range | Letter |
|-------|--------|
| 90-100 | O (Outstanding) |
| 85-89 | VS (Very Satisfactory) |
| 80-84 | S (Satisfactory) |
| 75-79 | FS (Fairly Satisfactory) |
| 74 and below | DNME (Did Not Meet Expectations) |

Note: A/P/AP/D/B is the superseded DO 73, s. 2012 scale — do not use.

#### Action Taken Logic
| Failing Subjects | Status |
|------------------|--------|
| 0 | PROMOTED (or WITH HONORS if GA >= 90) |
| 1-2 | *CONDITIONAL |
| 3+ | RETAINED |
| No grades | No Grades |

- `*CONDITIONAL` footnote: "Conditional — pending passing of remedial classes in the failed learning areas."
- Computed from `failingSubjects`, NOT `incompleteSubjects` (incomplete subjects do not fail a learner).

#### Summary Table — Promotion Status
```
                 MALE  FEMALE  TOTAL
PROMOTED         [N]    [N]    [N]
*CONDITIONAL     [N]    [N]    [N]
RETAINED         [N]    [N]    [N]
TOTAL            [N]    [N]    [N]
```

#### Summary Table — Learning Progress & Achievement
```
                                MALE  FEMALE  TOTAL
Outstanding (90-100)             [N]    [N]    [N]
Very Satisfactory (85-89)        [N]    [N]    [N]
Satisfactory (80-84)             [N]    [N]    [N]
Fairly Satisfactory (75-79)      [N]    [N]    [N]
Did Not Meet Expectations (74 & below)  [N]  [N]  [N]
```
- Cross-check against the official SF5 template in TemplateManager — some versions include an "Incomplete Grades" row.

#### Signature Lines
```
PREPARED BY:              CERTIFIED CORRECT & SUBMITTED:
_____________________     _____________________
Class Adviser             School Head
(Name and Signature)      (Name and Signature)

REVIEWED BY:
_____________________
Division Representative
(Name and Signature)
```
- Pre-fill Adviser and School Head names from `section.adviser` and system settings (render signature line above printed name).

#### Guidelines (bottom)
Print the 5 official DepEd guidelines for SF5 — pull text from TemplateManager if available rather than hardcoding.

### 2.3 CSS Classes
Root div: `bg-white border-2 border-gray-400 shadow-xl print-form p-6 mb-8 text-[11px] leading-tight`
Table: `w-full text-[10px] border-collapse`
Cells: `border border-black p-0.5`
- `@page { size: legal landscape; margin: 0.5in; }` in print stylesheet — SF5 is landscape Legal per DepEd.

---

## Phase 3: Print Support

### 3.1 Add Print Button to SF5 View
Same pattern as SF10:
```tsx
<Button onClick={() => executePrint(sf5PrintRef, "sf5-print-style")}>
  <Printer className="w-4 h-4 mr-2" /> Print Form
</Button>
```

### 3.2 Page Break Handling
- Gender-split tables may span multiple pages
- Use `page-break-inside: avoid` on summary tables and signature block
- Use `sf5-page-break` class for forced breaks between male/female sections
- Repeat column header row on each printed page (`thead { display: table-header-group; }`)
- Verify on a 60+ learner section (multi-page), not only a small one

---

## Phase 4: Excel Export

### 4.1 Add Export Endpoint
**File:** `server/src/routes/registrar.ts` — thin route calling `sf5Composer.ts` (same assembly as data endpoint; no duplicated logic)
```
GET /registrar/export/sf5/:sectionId?schoolYear=YYYY-YYYY
```
Returns `.xlsx` file using ExcelJS.
- Zod-validate `schoolYear` query param (`^\d{4}-\d{4}$`)
- REGISTRAR role guard via existing `authorizeRoles` middleware — 403 otherwise
- Audit-log the export (match other form exports)
- `Content-Disposition: attachment; filename="SF5_<section>_<SY>.xlsx"` + correct content type
- Confirm `exceljs` is in `server/package.json`; if the codebase standardizes on xlsx-populate, use that instead

### 4.2 Excel Layout
- **Paper:** Legal (8.5" x 13") landscape (`pageSetup.orientation = "landscape"`)
- **Header rows (1-8):** School info, form title
- **Column header row:** LRN, Name, GA + Descriptive Letter, Action Taken, Incomplete (prev SY), Incomplete (current SY)
- **Data rows:** Males first, then females, with SUB TOTAL rows per gender + TOTAL
- **Summary rows:** Two summary tables at bottom
- **Signature rows:** 3 signatories
- **Guidelines:** Text block at very bottom
- **Page footer:** "School Form 5: Page ___ of ___"
- **Parity requirement:** every value comes from the composer — screen, print, and xlsx show identical GAs, descriptors, statuses, and totals

### 4.3 Column Widths (Legal paper)
| Column | Width (chars) |
|--------|--------------|
| LRN | 18 |
| Learner's Name | 40 |
| General Average | 22 |
| Action Taken | 25 |
| Incomplete - Prev SY | 25 |
| Incomplete - Current SY | 25 |

---

## Phase 5: Frontend API Integration

(Types already defined in Phase 1.3 — wiring only; do not redeclare.)

### 5.1 `api.ts`
- Type `getSF5` return: `api.get<SF5Data>(...)`
- Add `exportSF5(sectionId, schoolYear)` — hits Phase 4 endpoint, blob download (match existing SF export helper pattern)

### 5.2 Update SchoolForms.tsx SF5 View
- Replace basic table with `<SF5Form data={sf5Data} printRef={sf5PrintRef} />`
- Add print button + Excel download button (loading + error states per existing React Query patterns)

---

## Execution Order

| Step | Task | Depends on |
|---|---|---|
| 0 | Extract `sf5Composer.ts` scaffold; move existing SF5 query into it | — |
| 1 | Phase 1 backend: settings, attendance fix, failing/incomplete split, summaries, sorting | 0 |
| 2 | Phase 1.3 + 5.1: types in `api.ts`, type `getSF5` | 1 (contract) |
| 3 | Phase 2: `SF5Form.tsx` render, wire into SchoolForms view | 2 |
| 4 | Phase 3: print button + print CSS | 3 |
| 5 | Phase 4: export endpoint (reuses composer) + `exportSF5` + download button | 1, 3 |
| 6 | Verification | all |

---

## Files to Modify

| File | Changes |
|------|---------|
| `server/src/lib/sf5Composer.ts` | **NEW** — SF5 assembly logic (query, GA, descriptors, Action Taken, summaries) |
| `server/src/routes/registrar.ts` | Thin SF5 routes: enhanced data endpoint + export endpoint (guards, zod, audit) |
| `src/lib/api.ts` | Add SF5Data/SF5Student interfaces, type getSF5, add exportSF5 |
| `src/pages/registrar/components/SF5Form.tsx` | **NEW** — renderSF5Content, print CSS, export button |
| `src/pages/registrar/SchoolForms.tsx` | Replace SF5 table with SF5Form component, add print ref |

---

## Verification

**Builds & lint**
1. `npm run build` (frontend) — must pass
2. `cd server && npm run build` (backend) — must pass
3. `npm run lint` — clean on all touched files
4. No touched file exceeds 1000 lines (extraction is mandatory, not optional)

**Data correctness**
5. Test SF5 data endpoint — all fields returned; descriptor mapping matches DO 8 s. 2015 (O/VS/S/FS/DNME)
6. `failingSubjects` (grade < 75) vs `incompleteSubjects` (null grade) are distinct and correct
7. Action Taken: 0 fails → PROMOTED, 1-2 → *CONDITIONAL, 3+ → RETAINED, none graded → No Grades
8. Summary tables: gender counts reconcile — promoted + conditional + retained + noGrades = total per gender and overall
9. SUB TOTAL MALE + SUB TOTAL FEMALE = TOTAL = student count
10. Historical SY reprint returns identical data to original run (snapshot/finalized grades)

**UI / print / export**
11. Test SF5 print — layout matches DepEd format, landscape Legal, headers repeat on multi-page sections
12. Test SF5 Excel export — file downloads, opens, and matches screen values exactly
13. Empty LRN / null GA / empty subject lists render blank — no "undefined"

**Security / regression**
14. SF5 endpoints REGISTRAR-only (403 for teacher/admin tokens); export writes an audit log entry
15. Existing SF endpoints (SF1, SF10, etc.) unaffected; attendance SY fix does not regress attendance reports
