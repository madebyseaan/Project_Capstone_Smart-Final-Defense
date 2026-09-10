# PLAN: E-Class-Record Import/Export + ClassRecord Decomposition

> **STATUS: PLAN ONLY — NOT IMPLEMENTED.**
> Executor ("workhorse"): implement phases A→E in order. One commit per phase.
> After completion: produce the Completion Report (template at bottom) and hand it back.

---

## 0. Context

Teachers may prefer the official DepEd E-Class-Record Excel over our ledger. We add a two-way bridge:

- **Download pre-filled Excel** — correct official template with school info + student roster already typed in. First-time UX: no manual name entry.
- **Import filled Excel** — teacher's offline scores land in our ledger via our canonical grade math (recompute, never trust Excel's computed columns).

Two template files already exist in **repo root** (verified byte-level, weights patched to match our `GradingConfig`):
- `E-Class-Record-CORE-Grades-2-10-3Term.xlsx` — WW/PT/EX = **20/50/30** (CORE, MATH_SCIENCE, STE, everything else)
- `E-Class-Record-TLE-MAPEH-Grades-2-10-3Term.xlsx` — WW/PT/EX = **20/60/20** (TLE, EPP, MAPEH components, SPA, SPS)

Subject-type classification already exists: `server/src/lib/atlasUtils.ts:36-48` and the startup reclassifier in `server/src/index.ts:95-121`.

### Verified template anatomy (do not re-derive; use this map)

Sheets: `INPUT DATA | TERM 1 | TERM 2 | TERM 3 | FINAL GRADES | HELPER`

**TERM sheets** (TERM 1 rows start at 18; TERM 2/3 start at 17 — offset differs, confirm per sheet by locating cell `B16` = "LEARNERS' NAMES"):
- Col B: row number 1..50; Col C: student name formula `=IF('INPUT DATA'!K11="","",'INPUT DATA'!K11)`
- Male block starts after `B17` = "MALE" label row (TERM1) / `B16` (TERM2/3); female block after a `FEMALE` label row (TERM1: B64; TERM2/3: B63 — verify by scanning col B for the literal "FEMALE")
- WW: F:J (5 tasks), Total K15 formulas, HPS row 15: K15 = `=IF(COUNT($F15:$J15)=0,"",SUM($F15:$J15))`
- PT: N:P (3 tasks), Total Q, HPS Q15
- Exams: T (ST1), U (ST2), V (TE); WS ST1 = W (30), WS ST2 = X (30), WS TE = Y (40); Z = PS, AA = WS
- Weights: M15 (WW=0.2), S15 (PT), AA15 (EX). Row 18 formulas: `M18 = ROUND(L18*$M$15,2)` etc.; `AB18 = ROUND(M18+S18+AA18,0)` (Initial Grade); `AC18` term grade via XLOOKUP to `HELPER!$C$8:$D$48`; `AD18` descriptor via `HELPER!$F$8:$G$48`
- Student rows run to 50 males + 50 females (rows up to 119/118)

**INPUT DATA sheet:** E10 region, E11 division, E13 school id, E14 school name, E15 school year, E23 teacher, E24 subject, E25 grade level, E26 section. Male names: K11:K60 (50 slots). Female names: N11:N60.

**FINAL GRADES:** C-col names, F/G/H = term grades via XLOOKUP from TERM sheets, I = average, J = descriptor. Untouched by us.

**HELPER:** transmutation table C/D (IG ranges) + F/G (grade→descriptor). Untouched.

### Math parity (verified)

Composite QA: `qaScore = round(ST1/T15*30,2) + round(ST2/U15*30,2) + round(TE/V15*40,2)`, `qaMax = 100`. Our `calculateGrades` then produces the same PS/initial as the Excel (±0.005 rounding on intermediates; accepted, document in code comment).

---

## 1. Hard rules (regression-free protocol)

1. **Additive only.** Every new backend file is new. Shared-file touches are EXACTLY: `server/src/routes/grades.ts` (import + mount line), `server/src/schemas/grades.ts` (one optional schema), `src/lib/api.ts` (2 methods appended inside `gradesApi`), `src/pages/teacher/ClassRecordView.tsx` (one panel render + later Phase E moves).
2. **Do not edit** `calculateGrades`, `transmute`, `resolveEffectiveWeightsForClassAssignment`, any existing route handler, any existing hook/component internals (Phase E is pure cut-paste moves).
3. **One commit per phase.** Never mix concerns.
4. **After every phase** run the full gate (section 6). Do not proceed on a failing gate.
5. **Import writes only via `prisma.grade.upsert`** on unique key `studentId_classAssignmentId_term` inside `$transaction`. No `deleteMany`/`updateMany` on grades.
6. **Guards before any write** — copy the exact sequence from `server/src/routes/grades-sub/aims.ts:340-412`: teacher profile → assignment ownership (`findFirst teacherId`) → `isActive === false` block (403 `ASSIGNMENT_ARCHIVED`) → Homeroom Guidance block (`isHomeroomGuidanceSubjectCode`) → `checkGradeEditLocks` (archived → year → term; approved edit request bypasses term only) → current-term check w/ approved `GradeEditRequest` fallback.
7. **Never trust Excel computed cells.** Read raw score cells only (F:J, N:P, T:V + HPS row 15). Ignore/validate AB/AC/AD etc. as sanity only (optional warn if mismatch > 2).
8. **PM2 log discipline** (user-mandated): after every phase and every manual test, run `pm2 logs <name> --lines 100 --nostream` and grep for `Error|error|unhandled|ECONNRESET|PrismaClient`. Fix ALL errors before concluding the phase. Include log findings in the phase report.
9. Concurrent agent may push to this repo. Before each phase, `git pull --rebase` and re-verify the gate if any of `grades.ts`, `api.ts`, `ClassRecordView.tsx`, `ClassRecordTable.tsx` changed.

---

## 2. Phase A — Backend import (new files + 2-line mount)

### A0. Move templates
- Create `server/assets/ecr/` (verify prisma/seed does not already use `server/assets` — if conflicts, use `server/src/assets/ecr`).
- `git mv` the two xlsx files from repo root into it.
- Add a `.gitkeep`-style comment or README line: files are load-bearing (export clones them).

### A1. `server/src/lib/ecrParser.ts` — PURE, no prisma, no express

```ts
export interface EcrTask { score: number; maxScore: number }          // maxScore from HPS row 15 (K15/Q15/T15/U15/V15 formulas are literal sums)
export interface EcrStudentRow {
  name: string;          // raw cell text, e.g. "CRUZ, JUAN DELA"
  row: number;           // 1-based sheet row
  gender: "MALE" | "FEMALE";
  ww: EcrTask[];         // 5 entries, F:J — score null-ish → 0 only if HPS>0? NO: keep score: number | null
  pt: EcrTask[];         // 3 entries, N:P
  exams: { st1: number|null; st2: number|null; te: number|null };
}
export interface EcrSheetData {
  termSheet: string;                  // "TERM 1" etc.
  hps: { ww: number[]; pt: number[]; st1: number; st2: number; te: number };
  rows: EcrStudentRow[];
}
export function parseEcrWorkbook(buffer: Buffer, term: "T1"|"T2"|"T3"): EcrSheetData
```

Implementation notes:
- Use `xlsx` (SheetJS) already in server deps: `XLSX.read(buffer, { cellFormula: false, cellDates: false })`.
- Find header row: scan column B for `LEARNERS' NAMES` (row 16 both variants). Student rows start next row after the `MALE` label row (which is the row directly below the header).
- Male block = rows until col B cell equals `FEMALE` (string match, trimmed, case-insensitive). Female block = 50 rows after (stop at first fully-empty col C AND col B empty; tolerate trailing numbered rows with blank names — the template shows numbered rows with formula-blank names; treat name `""` as no student).
- Name cell is a FORMULA (`=IF('INPUT DATA'!K11="","",...)`) — with `cellFormula:false` SheetJS gives the cached VALUE (string, possibly empty string). Use `sheet_to_json` or direct cell access `ws[XLSX.utils.encode_cell(...)]`, read `.v`. Empty string or undefined = empty slot.
- HPS row = header row + 1 (row 15): K15/Q15 are formulas summing the HPS row inputs — wait, K15 sums F15:J15 which are the input HPS cells. So HPS values to READ are **F15:J15, N15:P15, T15, U15, V15** (teacher-typed maxes), NOT K15/Q15. If a max cell is empty → HPS 0 → treat that task as "not used" (scores in that column must be empty too; if score present with 0 max → validation error).
- Score cells: numeric or empty. Non-numeric (e.g. "A"/"E" text) → capture as `null` + collect warning (import limitation: special marks skipped, reported to user).
- Validate: score > max → error (per student, per cell). Collect all errors, throw `EcrParseError` with list (route returns 400 with details).

### A2. `server/src/__tests__/ecr-parser.test.ts` (vitest, no DB)

- Fixture: programmatically fill the CORE template copy via jszip XML injection (same technique as weight patch: locate cells, inject `<v>` — or simpler: use `XLSX.utils` to build a minimal workbook mimicking the layout: same labels, same cell addresses). Simplest robust approach: keep a small fixture xlsx built by the test in a temp dir using `xlsx` write of a hand-built sheet with identical addresses/labels. 6 tests minimum:
  1. Parses 50+50 slots with names → correct gender split
  2. T1 header offset (rows 18) vs T2 (row 17) both parse
  3. HPS row read from F15:J15/N15:P15/T15/U15/V15
  4. Empty slots (blank name) skipped
  5. Score>max → error
  6. Text score cell → null + warning
- Run: `cd server && npm run test` — must pass alongside existing suites (aims-sync.test.ts etc.).

### A3. `server/src/lib/ecrImport.ts`

Mirror `aimsImport.ts` architecture:
```ts
export interface EcrImportReport {
  savedCount: number;
  unmatched: string[];            // raw names from Excel with no roster hit
  specialSkipped: string[];       // students whose A/E cells were dropped
  overwrittenCount: number;       // rows that had existing scores replaced
}
export async function importEcrToGrades(input: {
  classAssignmentId: string; term: Term; parsed: EcrSheetData;
  teacherId: string; teacherUserId: string;
}): Promise<EcrImportReport>
```
- Name matching: normalize both sides — `s.toUpperCase().trim().replace(/\s+/g," ").replace(/[^A-Z ,]/g,"")`. Roster source: enrollments for the section/SY (reuse aimsImport's enrollment query pattern, lines 117-126) → students with `firstName`/`lastName`; key = `LAST, FIRST`. Exact match only. Unmatched → skip + report.
- **Replace-term semantics:** per matched student, build `writtenWorkScores` (from `parsed.ww` where hps>0, `name: "WW n"`, `score`, `maxScore`), `perfTaskScores` similarly, `quarterlyAssessScore = round(st1/st1Max*30,2)+round(st2/st2Max*30,2)+round(te/teMax*40,2)` (any part null/0-max → that part 0; if ALL three null → QA null), `quarterlyAssessMax = 100`.
- Recompute via `calculateGrades(mergedWW, mergedPT, qa, 100, weights.ww, weights.pt, weights.qa)` — weights via `resolveEffectiveWeightsForClassAssignment`.
- If student has zero data in Excel (all scores empty): skip entirely (do not zero out existing grades) — count as `emptySkipped`, add to report.
- Transaction: `prisma.$transaction(async tx => { ... upsert ... createGradeSnapshot ... })` — copy snapshot/audit block from aimsImport.ts:407-440 (`createAuditLog` with `AuditAction` appropriate: use `GRADE_UPDATE`-equivalent used by aims import; check `audit.ts` enum, reuse the same one aimsImport uses, `AuditSeverity` same).
- SSE: after transaction, publish via `sseManager` same channel/events the AIMS import publishes (find in aims.ts after `importAimsScoresToGrades` returns — mirror it). If AIMS import does not SSE, skip this.

### A4. `server/src/routes/grades-sub/ecr.ts`

Two routes:

```ts
POST /grades/ecr-import/:classAssignmentId   // multipart/form-data: file, term, dryRun("true"|"false")
```
- multer **memoryStorage** (config locally in this file, like templates.ts:68 pattern; limits: 15MB, `fileFilter` xlsx/xlsm by mimetype + extension).
- Guards: exact aims.ts:340-412 sequence (teacher → ownership → archived → HG → `checkGradeEditLocks` → current-term/edit-request).
- Parse via `parseEcrWorkbook(req.file.buffer, term)` → 400 with error list on `EcrParseError`.
- Roster match is inside lib — but dryRun needs the report WITHOUT writing: refactor lib as `prepareEcrImport(parsed, roster, existing)` pure part + `commitEcrImport(...)` write part; dryRun = prepare only (report includes matched/unmatched/would-overwrite counts; overwrite detection = existing grade rows with any nonzero scores for that student/term).
- Response (dryRun or commit): `{ matched, unmatched: string[], emptySkipped, specialSkipped, overwrittenCount, savedCount, warnings: string[] }`.

```ts
GET /grades/ecr-export/:classAssignmentId?term=T1   // Phase D
```
(Phase D fills this; Phase A registers the file with ONLY the import route.)

### A5. Mount
`server/src/routes/grades.ts`: add `import registerEcr from "./grades-sub/ecr";` + `registerEcr(router);` (follow the exact pattern of the 4 existing register calls, lines 1-5).

### A6. Phase A gate
- `cd server && npm run build` (tsc) — zero errors
- `npm run test` — all green incl. new parser tests
- `npm run dev` (or pm2 dev instance) → manual curl: upload CORE fixture with 2 students via `curl -F` → expect dryRun report; then commit → verify DB row via `prisma studio` or a psql select
- **PM2 logs check (MANDATORY):** `pm2 logs --lines 100 --nostream` — zero new errors
- Commit message: `feat(grades): E-Class-Record Excel import backend (parser, lib, route + tests)`

---

## 3. Phase B — Frontend API methods

`src/lib/api.ts` — append inside `gradesApi` (after `syncAims`, ~line 539):

```ts
ecrImport: (classAssignmentId: string, term: string, file: File, dryRun: boolean) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("term", term);
  fd.append("dryRun", String(dryRun));
  return api.post(`/grades/ecr-import/${classAssignmentId}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
},
ecrExport: (classAssignmentId: string, term: string) =>
  api.get(`/grades/ecr-export/${classAssignmentId}`, { params: { term }, responseType: "blob" }),
```

Types: define `EcrImportReport` interface matching the route response (put next to other AIMS types, api.ts:542+ area).

Gate: `npm run build` + `npm run lint` (frontend) — clean. PM2 logs clean. Commit: `feat(api): ECR import/export client methods`.

---

## 4. Phase C — Import UI (new component + 1 render line)

### `src/pages/teacher/components/ExcelExchangePanel.tsx` (new, ~200 lines)

Props: `{ classAssignmentId, selectedTerm, isViewOnly, disabled }`.

Layout: Card matching `AimsPanel.tsx` visual conventions (read AimsPanel.tsx first, copy its card/section idioms, semantic tokens only — no raw grays, follow AGENTS.md design system).

Content:
- **Section "Official E-Class-Record":** one-line explanation + two actions:
  - `Download pre-filled Excel` button (always enabled, even view-only — read-only route). Handler: `gradesApi.ecrExport(...)` → blob → `URL.createObjectURL` → anchor click → revoke (copy Attendance.tsx:366 pattern). Filename: `ECR-{subjectCode}-{grade}-{section}-{term}.xlsx`.
  - `Import filled Excel` button (disabled when `isViewOnly` or `disabled`): hidden file input (`.xlsx` accept), on select → `dryRun: true` call → show results in an inline confirm block: matched / will-overwrite / unmatched names list / special-skipped note. Buttons: `Confirm Import` / `Cancel`. Confirm → `dryRun: false` → on success: `queryClient.invalidateQueries({ queryKey: ["class-record", classAssignmentId] })` + toast.success with savedCount. Errors → toast.error with server message (parse axios error body).
- Local state: `file`, `report`, `importing`, `downloading`. Reset on term change (useEffect on selectedTerm).

### Mount in `ClassRecordView.tsx` — exactly one render insertion after the `<AimsPanel ... />` block (line ~343):

```tsx
{classAssignmentId && !isArchivedAssignment && (
  <ExcelExchangePanel
    classAssignmentId={classAssignmentId}
    selectedTerm={selectedTerm}
    isViewOnly={editAccess.isViewOnly}
  />
)}
```
(Export inside the panel is unavailable for archived? No — keep panel visible for archived assignments too but import-only disabled: render panel always; pass `importDisabled={isArchivedAssignment || editAccess.isViewOnly}`. Simpler: always render, one prop.) Final: render unconditionally when classAssignmentId exists; panel internally disables import when `isViewOnly`.

Gate: build + lint + manual: dev servers up → download works (file opens in Excel, names present, formulas intact) → import dryRun + commit → ledger shows scores → **PM2 logs clean**. Commit: `feat(teacher): E-Class-Record exchange panel (download pre-filled + import with preview)`.

---

## 5. Phase D — Export backend (fills the GET route)

### `server/src/lib/ecrExport.ts`

```ts
export async function exportEcrWorkbook(input: {
  classAssignmentId: string; term: "T1"|"T2"|"T3";
}): Promise<{ buffer: Buffer; fileName: string }>
```
- Load classAssignment + subject + section + grades (all students, `term`) + admin settings (school info: reuse the same settings source `adminApi.getSettings` equivalent server-side — find how templates.ts or forms.ts read school name/region/division; reuse that).
- Template pick: `subject.type === "MAPEH" || subject.type === "TLE"` → TLE-MAPEH file, else CORE file. Path: `path.join(__dirname, "../../assets/ecr/<file>")` (adjust for dist build: check how templateService.ts resolves template paths and copy that pattern so it works compiled AND dev).
- Fill via **jszip direct XML injection** (byte-preserving, same technique as the verified weight patch):
  - `INPUT DATA`: values into E10/E11/E13/E14/E15/E23/E24/E25/E26, names K11+ (male), N11+ (female). Inject as `<c r="K11" t="str"><v>NAME</v></c>` — wait: shared strings. Safer: write as inline string `t="inlineStr"><is><t>NAME</t></is>` — jszip+XML: `<c r="K11" t="inlineStr"><is><t>CRUZ, JUAN</t></is></c>`. Verify Excel opens it (test in gate). Escape XML entities in names.
  - Replace the placeholder cells entirely (match existing `<c r="K11"...>...</c>` or self-closing, replace with inline-string cell, KEEP the style attribute `s="..."` from the existing cell).
  - HPS row: F15:J15/N15:P15/T15:U15/V15 — write maxScore per task; empty task (maxScore 0) → leave cell EMPTY (blank, `<c r="F15" s="..."/>` self-closing with style, no `<v>`).
  - Score cells per student row: numeric `<v>`; score null → empty cell with style preserved.
  - Style preservation: for each injected cell, capture the original cell's `s="N"` (if original exists) and reuse. If a cell doesn't exist in template XML (e.g. untouched empty score cells may be missing), clone the `s` from the same-row name cell (C column) or same-column HPS cell. **Verify in Excel after generation** (borders must show).
  - Sheet name from term: T1→"TERM 1", T2→"TERM 2", T3→"TERM 3".
- Route: guards = teacher + ownership ONLY (read-only; no lock checks). Stream: `res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')`, `Content-Disposition: attachment; filename="..."`, `res.send(buffer)`.
- Audit: `createAuditLog` GRADE_EXPORT-equivalent if enum has one; else reuse the action the templates download route uses (check templates.ts).

### Fallback plan (if inlineStr or style cloning misbehaves in Excel)
Switch to `xlsx-populate` (in server deps): `XlsxPopulate.fromFileAsync(template)`, `.cell("K11").value(name)`, `.outputAsync()`. It preserves styles/protection natively and writes shared strings correctly. Cost: it recompresses the zip (fine). **Prefer xlsx-populate as PRIMARY if jszip injection shows any visual/format issue in the gate's manual open** — decide at gate time, note the choice in the commit message.

Gate: build + test + manual: export from a class WITH scores → open in Excel → (1) names present, (2) HPS row filled, (3) scores present, (4) Initial Grade/Term Grade columns compute and MATCH our ledger's displayed grades for the same students (spot-check 5; transmutation differences expected ONLY if admin table ≠ DepEd table — then document, do not "fix"), (5) borders/protection intact. Re-import the exported file → 100% match, zero unmatched, grades identical after recompute. **PM2 logs clean.** Commit: `feat(grades): E-Class-Record export (template fill, byte-preserving)`.

---

## 6. Phase E — Decomposition (pure moves, zero logic edits)

### E1. `ClassRecordTable.tsx` (1018 lines) → 3 files
- NEW `src/pages/teacher/components/ledger/LedgerScoreCell.tsx`: move lines 26-116 (`LedgerScoreCellProps` interface + `LedgerScoreCell` memo component). Export both.
- NEW `src/pages/teacher/components/ledger/LedgerRow.tsx`: move lines 118-513 (`LedgerRowProps` + `LedgerRow`). Import `LedgerScoreCell` from sibling.
- `ClassRecordTable.tsx` keeps 515+ (header, scroll-sync refs, gender grouping, clear-scores timer, render) and imports the two new ones. Update import path only.
- Rule: **cut-paste verbatim.** No prop renames, no memoization changes, no className edits.

### E2. `ClassRecordView.tsx` (414) → ~300
- NEW `components/InheritedGradesNotice.tsx`: move JSX 345-382. Props: `{ inheritedFromTeachers, inheritedGrades, mergedRecords, selectedTerm }`.
- NEW `components/MobileWarningDialog.tsx`: move JSX 398-407. Props: `{ open, onOpenChange }`.
- NEW `hooks/useAimsData.ts`: move aimsQuery + `linkDialogSignal` effect (230-238) + `aimsAssessments`/`aimsAllAssessments`/`aimsByStudent` memos (240-267). Signature: `useAimsData({ classAssignmentId, selectedTerm, syncVersion, searchParams, setSearchParams })` returns `{ aimsData, aimsAssessments, aimsAllAssessments, aimsByStudent, aimsQuery, linkDialogSignal, setLinkDialogSignal }`.
- View file: replace moved blocks with component/hook calls; imports updated only.

### E3. Gate (strict — this is the regression-risk phase)
- `npm run build` + `npm run lint` — zero errors, zero NEW warnings vs before.
- Manual ledger smoke with dev servers: page loads, scores editable + persist after refetch, HPS edit, add/remove WW/PT task, AIMS panel still renders + import button works, tour opens, mobile list + GradeEditModal, gender separation toggle, sticky header scroll-sync, inherited grades notice (if any), clear scores (with its confirm timer).
- **PM2 logs clean.**
- Commit: `refactor(teacher): decompose ClassRecordTable/View under 1000-line limit (pure moves)`

---

## 7. Definition of Done (all phases)

1. All 5 phase gates green (build/lint/test + manual + PM2 logs clean).
2. Round trip verified: export → open in Excel (formulas compute) → edit a score → import → ledger matches recompute.
3. Locked-term import returns 403 with lock code; archived assignment: import blocked, export allowed.
4. DryRun writes nothing (verify via pm2/DB: no new audit rows when dryRun).
5. No file in the diff exceeds 1000 lines post-change.
6. `server/assets/ecr/` contains both templates; repo root xlsx files REMOVED (moved, not copied).

## 8. Known accepted limitations (state in report, do not "fix")

- A/E special marks cannot round-trip through Excel (numeric cells) — skipped + reported.
- Template intermediate rounding vs our unrounded pipeline: ≤0.005 PS drift; boundary flip possible (~1/20k cells).
- Excel's transmuted grades match ours ONLY if admin's TransmutationEntry table equals the DepEd HELPER table. Current DB uses the older DO-8 scale — flagged to user, out of scope.
- Import replaces the selected term wholesale (confirmed UX decision) — except students with fully-empty Excel rows (skipped, not zeroed).
- 5 WW / 3 PT / 3 exam columns only (template's capacity). Ledger arrays longer than 5 WW / 3 PT → first N imported, warning issued. Ledger QA exports as TE-combined (ST1/ST2 blank) — mathematically identical.

## 9. Mandatory testing checklist (run FULL list before concluding ANY phase done)

```
[ ] cd server && npm run build          → 0 errors
[ ] cd server && npm run test           → all pass (incl. ecr-parser.test.ts)
[ ] (root)  npm run build               → 0 errors
[ ] (root)  npm run lint                → 0 errors / no new warnings
[ ] dev servers up (or pm2 restart) → manual flows per phase section
[ ] pm2 logs --lines 100 --nostream → grep -i "error\|unhandled\|prisma" → ZERO new entries
[ ] git status clean, one commit per phase, no stray files
```

## 10. Completion Report template (workhorse fills, user relays back)

```
## ECR Import/Export — Completion Report
Phases completed: A B C D E (circle/mark)
Template engine chosen for export: jszip-XML | xlsx-populate   (reason: ...)
Commit SHAs: A=___ B=___ C=___ D=___ E=___
Gate results per phase (build/lint/test/pm2): ...
Round-trip test result: (export→edit→import→recompute) PASS/FAIL + details
Locked-term 403 check: ...
DryRun no-write check: ...
Unmatched-name handling observed: ...
Excel visual check (borders, protection, formulas computing): ...
PM2 log findings (any errors encountered + fixes applied): ...
Deviations from plan (any, with justification): ...
Known-limitation confirmations (section 8): ...
```
