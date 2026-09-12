# SF10 / SF9 Import for Transferees — Implementation Plan

> **Status:** PLANNING — Do not implement until approved.
> **Audience:** Implementation agent. Read top-to-bottom before writing code.
> **Companion doc:** `docs/REGISTRAR/TRANSFEREE_PLAN.md` (transferee detection + tagging).
> This plan implements the item that `TRANSFEREE_PLAN.md` §8.3 and §14 deferred: previous-school grades.
> **Scope decision:** Grade 7–10 only. Elementary records are out of scope.

---

## 1. Problem

SMART recognizes transferees (`Enrollment.transferInDate != null`) and stores transfer metadata
(`Student.previousSchool` / `lastGradeCompleted` / `transferCertNo`), but it has **no mechanism to
store grades from the previous school**.

`buildSf10Records` (`server/src/lib/sf10.ts:52`) builds the SF10 from SMART-local `Enrollment` /
`Grade` / `GradeSnapshot` only. So:

- A **Grade 8/9/10 transferee** (between-year) has blank prior JHS years on their SF10.
- A **mid-year transferee** has no way to credit the partial current-year grades earned at the
  previous school (they are on the previous school's **SF9**).

This plan adds manual entry + optional photo scanning of prior SF10/SF9 records, stores them
as structured data, and merges them into SMART's SF10 output.

---

## 2. Decisions (locked)

| # | Decision |
|---|---|
| D1 | **Manual entry is the core.** Scanning is an optional accelerator. |
| D2 | **Scan → review → edit → save.** OCR never auto-saves. The human-verified record is the source of truth. |
| D3 | **No cloud OCR.** Runs on SMART's server (`tesseract.js`, free, self-hosted). Student data never leaves SMART. |
| D4 | **Format-change resilient.** Parse by labels/anchors, rules live in config files, keep raw OCR text + image for re-parsing. |
| D5 | **Mobile-first scan flow.** Registrar uses a phone camera. The Transferees page must become responsive. |
| D6 | **Mid-year transferees in scope** → SF9 import + term-level merge of the transfer-in year. |
| D7 | **Scope = Grade 7–10.** Elementary records are not stored as grade records (metadata only). |
| D8 | Prior records are **display-only** — never touch `Grade`, `GradeSnapshot`, promotion, EOSY, or dashboards. |

---

## 3. Document roles

| Document | Covers | When used |
|---|---|---|
| **SF10** | Completed prior JHS years (e.g. a Grade 9 transferee's G7 + G8) | Between-year and mid-year transfers |
| **SF9** | Partial **current** year at the previous school (mid-year transfers) | Mid-year transfers only |
| **Elementary Form 137 / SF10** | Grades 6 and below | **Out of scope** (D7) |

The scanner auto-detects the document by title/anchors. The UI also lets the registrar pick
"Scan SF10" or "Scan SF9" explicitly.

**What EnrollPro does / does not provide (handoff 2026-09-11).** EnrollPro owns learner identity,
enrollment, incoming grade/curriculum, official section placement, and the SF9 eligibility decision
(`sf9EligibilityStatus`) plus conditional-promotion back subjects. But the SMART transferee feed is
DPA-minimized and exposes **none** of: previous school / originating school ID / transfer certificate
/ previous average, `hasSf9` / `hasPsa` flags, `sf9EligibilityStatus`, or `conditionalSubjectCodes`.
SMART must not infer, fabricate, or scrape them from another endpoint — the registrar captures them
here (SF9 scan/manual). A separate versioned EnrollPro contract is required before these can be pulled.

---

## 4. User flows

### Flow A — Manual (always available)
Transferee row → "Add previous SF10" → choose year/grade → enter school, section, subjects,
grades → Save.

### Flow B — Scan (mobile, primary)
1. Transferee card → "Scan SF10" / "Scan SF9".
2. Camera opens via `<input type="file" accept="image/*" capture="environment">`.
3. Client resizes to ≤2000px and re-encodes to JPEG on a `<canvas>` (solves iPhone HEIC + large photos).
4. Upload → server OCR (~2–10s, single-item queue) → returns draft + per-field confidence + image URL.
5. **Review screen**: photo on top, editable form below; low-confidence cells amber, missing cells blank.
6. Sticky bottom bar: **Save** / **Discard**. Only Save writes to the DB.

### Flow C — Desktop
Same review screen in a two-column layout (image left, form right).

### Flow D — SF10 output
Prior years (extracted/completed) render alongside SMART-local years, labeled "From previous school".
For a mid-year transfer, the transfer-in year prints once with both schools' terms credited.

### Flow E — Graceful degradation
If OCR finds nothing or the layout is unknown, the review form opens blank. Manual entry still works.

---

## 5. Data model

Two tables + one enum (additive only). Do **not** reuse `Grade` / `GradeSnapshot` — their
`classAssignmentId` is required and prior schools have none.

```prisma
enum ExternalRecordSource {
  MANUAL
  SF10_SCAN
  SF9_SCAN
  SF10_XLSX
}

model ExternalSchoolRecord {
  id               String   @id @default(cuid())
  studentId        String
  student          Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  schoolYear       String                 // "2024-2025"
  gradeLevel       GradeLevel              // GRADE_7..GRADE_10
  schoolName       String
  schoolId         String?
  sectionName      String?
  adviserName      String?
  generalAverage   Float?
  promotionStatus  String?                // free text — prior-school wording varies
  formType         String                 // "SF10" | "SF9"
  isPartialYear    Boolean  @default(false) // true for a mid-year transfer-in year
  source           ExternalRecordSource @default(MANUAL)
  imagePath        String?                // /uploads/sf10-scans/...
  ocrRawText       String?                // for re-parsing after parser upgrades
  ocrParserVersion String?
  confidence       Float?
  verifiedById     String?
  verifiedAt       DateTime?
  subjects         ExternalSubjectRecord[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  // schoolName in the key allows the previous school's partial year to coexist
  // with any other record for the same year/grade (mid-year + re-transfer cases).
  @@unique([studentId, schoolYear, gradeLevel, schoolName])
  @@index([studentId])
}

model ExternalSubjectRecord {
  id               String  @id @default(cuid())
  recordId         String
  record           ExternalSchoolRecord @relation(fields: [recordId], references: [id], onDelete: Cascade)
  subjectCode      String?
  subjectName      String
  terms            Json?   // [{ "label": "Q1", "value": 88 }, ...] — any term structure
  finalRating      Float?
  remarks          String? // Passed / Failed
  isNonPromotional Boolean @default(false)
  confidence       Float?
  needsReview      Boolean @default(false)
  @@index([recordId])
}
```

**Why `terms` is JSON:** SMART uses 3 terms (T1/T2/T3); previous SF10s may use 4 quarters, and
SF9s are quarterly. JSON stores the structure as recorded; the renderer maps known labels.
This is the main open decision (see §13).

**Why `isPartialYear`:** distinguishes a mid-year transfer-in year (merged with local terms)
from a completed prior year (used as-is).

---

## 6. Expected-records rule

- Between-year transferee: expected prior years = `GRADE_7`..`(gradeLevel - 1)`.
  - G8 ⇒ [7]; G9 ⇒ [7,8]; G10 ⇒ [7,8,9].
- Mid-year transferee: expected prior years **plus** a partial record for the current grade level.
- Grade 7 scope boundary:
  - **Mid-year Grade 7** → partial **Grade 7** (JHS) from the old school ⇒ in scope (SF9).
  - **Start-of-year Grade 7** → prior record is elementary (Grade 6) ⇒ out of scope; metadata
    only (`lastGradeCompleted`).

This powers a "missing prior records" badge on the Transferees page.

---

## 7. Backend

### 7.1 Routes — new router `server/src/routes/registrar/externalRecords.ts`

| Method | Path | Purpose |
|---|---|---|
| POST | `/registrar/external-records/scan` | Upload image → OCR → draft (nothing saved) |
| GET | `/registrar/students/:studentId/external-records` | List saved prior records |
| POST | `/registrar/students/:studentId/external-records` | Save confirmed record(s) |
| PATCH | `/registrar/external-records/:id` | Edit a record |
| DELETE | `/registrar/external-records/:id` | Delete a record |

- Registrar-only (mirror `routes/registrar/transferees.ts:24-28`).
- Wrapped zod schemas in `server/src/schemas/registrar.ts`; validated via `validate` middleware.
- `createAuditLog` on every write; `prisma.$transaction` for record + subjects.
- Keep the new router separate so `transferees.ts` stays small (1000-line rule).

### 7.2 Existing endpoint additions

- `GET /registrar/transferees` (`server/src/routes/registrar/transferees.ts:22`) — add:
  - `studentId` to each row (needed for the records route).
  - `priorRecords: { expectedYears, savedYears, missingYears }`.
- `src/lib/api.ts` `TransfereeRow` — add the same fields.

### 7.3 Scan pipeline — `server/src/lib/sf10Scan/`

```
sf10Scan/
├── index.ts        orchestration: queue (one OCR at a time), timeout, fail-soft
├── preprocess.ts   resize / grayscale / deskew (jimp — pure JS, no native install)
├── ocr.ts          tesseract.js wrapper, language data cached on disk
├── parser.ts       anchor/label extraction + confidence scoring
├── subjects.ts     DepEd JHS subject list (from DB Subject table, static fallback)
└── layouts/
    ├── deped-jhs-sf10-v1.json
    └── deped-jhs-sf9-v1.json
```

- **Concurrency:** in-process mutex so only one OCR runs at a time; prevents server stalls.
- **Failure:** OCR errors return `{ draft: empty, reason }` — the UI shows the blank manual form.
- **Limits:** 10 MB; `image/jpeg | image/png | image/webp`; auth + rate limit.
- **Storage:** `server/uploads/sf10-scans/{studentId}/{uuid}.jpg`, served at `/uploads`.
- **Cleanup:** orphan images (never saved to a record) swept after 24h (phase 3).
- New packages: `tesseract.js`, `jimp`.

### 7.4 Parser behaviour

1. Preprocess image.
2. OCR → text + word bounding boxes.
3. Try each layout config; score the match by anchor hits.
4. Extract: school name / ID, school year, grade level, section, adviser.
5. Match subject names against the DepEd JHS subject list.
6. Read numeric tokens on each subject's row; validate range (60–100 DepEd scale, or 0–100).
7. Flag low-confidence / unmatched items as `needsReview`.

### 7.5 Format-change resilience

| Layer | Survives a format change because… |
|---|---|
| Parsing | Label/anchor-based; rules in `layouts/*.json`, not code |
| Layout detection | Scored per known layout; no match ⇒ blank form (manual still works) |
| Retention | `ocrRawText` + `imagePath` stored ⇒ bulk re-parse old scans |
| Digital shortcut | Phase 3 exact `.xlsx` import (no OCR guessing) |

---

## 8. Frontend (mobile-first)

### 8.1 Transferees list — responsive rework

`src/pages/registrar/Transferees.tsx` is desktop-only today:
- The table (`:285`) is `table-fixed` in `overflow-x-auto` — sideways scroll on phones.
- Header actions (`:185-207`) overflow at 360px.

Changes:
- **Mobile** (`block md:hidden`): card list — name, LRN, section+grade, T/I date, completeness badge,
  "Scan / View SF10" button. Follow the existing pattern in `StudentRecords.tsx:410`
  (and `SectionRosterViewer.tsx:346`).
- **Desktop** (`hidden md:block`): keep the table; add a "Prior records" column (e.g. "G7, G8 ✓"
  or "2 missing").
- Header actions: `flex-wrap gap-2`; collapse Sync/Refresh into a dropdown on mobile.
- Stats grid (`grid-cols-2`) stays.

### 8.2 Scan / review screen — new route

`/registrar/transferees/:studentId/sf10-records` — a dedicated page, **not** a dialog
(mobile back button + no modal scroll traps).

- Mobile: stacked — image viewer (collapsible), tabs (Header / Subjects), sticky Save bar.
- Desktop: `grid-cols-2` — image left, form right.
- Subject grid: add/remove rows; amber = low confidence; blank = missing.
- "Enter manually" toggle skips upload.
- Reuse `Tabs` (`src/components/ui/tabs.tsx`).

### 8.3 Other touches

- `Transferees.tsx` dialog → "Add previous SF10" button routes to the new page.
- `src/pages/registrar/SchoolForms.tsx` SF10 view (`~847-876`, `~907-912`) → render external years
  with a "From previous school" label + that school's name/ID. SMART letterhead only for local years.
- `src/pages/registrar/components/StudentDetailDialog.tsx` → prior-school academic history section.
- `src/lib/api.ts` → new types + API functions; extend `SF10Data` with `external`.
- `src/App.tsx` → new route.

---

## 9. SF10 / SF9 merge rules (`server/src/lib/sf10.ts`)

1. Fetch `ExternalSchoolRecord` rows for the student.
2. Map each to the `schoolRecords[]` shape with `external: true`.
3. Sort all years by `schoolYear` (local + external together).
4. **Completed prior years:** render from the external record as-is; school identity comes from
   that record, not SMART.
5. **Mid-year transfer-in year (same `schoolYear` + `gradeLevel` as a local enrollment):**
   merge at the **term level** —
   - terms present at the previous school (from SF9) fill the early terms;
   - local terms fill the rest;
   - the year prints once, with both schools credited (note or combined header).
   Do **not** drop either side.
6. External data bypasses `mergeRotationSubjects` and never feeds local-year
   `generalAverage`, promotion, or the certification block.
7. Grade 7 / elementary: not represented (D7).

---

## 10. Guardrails (binding)

- OCR never auto-saves; the registrar always confirms.
- No third-party cloud OCR. Uploads stay on the SMART server.
- Prior records never touch `Grade`, `GradeSnapshot`, `promotion.ts`, EOSY, attendance, dashboards.
- Audit every write (who, when, source, confidence).
- EnrollPro remains READ-ONLY.
- Query rule (AGENTS.md): historical/SF reads filter by `schoolYear` string only — never
  `isActive`/`isArchived`.
- File size ≤1000 lines; new router + new `sf10Scan/` module.
- Multi-step writes use `prisma.$transaction`.
- Frontend: function components + hooks, semantic tokens, no raw palette colors, `space-y-6` roots.
- Always run `npm run build` (root AND server) and root `npm run lint`.

---

## 11. Phases

| Phase | Deliverable | Size |
|---|---|---|
| **0** | Lock term-structure mapping from a redacted sample SF10/SF9; confirm `tesseract.js` + `jimp` | S |
| **1** | Tables + migration; manual-entry API; SF10/SF9 merge; mobile Transferees list + manual editor | M |
| **2** | Scan pipeline (upload, OCR, parser, layouts) + mobile review screen | M–L |
| **3** | Excel SF10 import; orphan-image cleanup; re-parse stored scans; polish | S–M |

Phase 1 alone produces a correct, complete SF10/SF9-merged record. Phase 2 only reduces typing.

---

## 12. Test plan

- **Parser unit tests** (vitest): OCR-text fixtures per layout → expected draft; range/confidence rules.
- **API tests** (supertest, existing pattern): auth, validation, transactions, audit.
- **SF10 builder tests**: external merge, ordering, collision (completed vs partial), proof that
  promotion outputs are unchanged.
- **Manual mobile**: 375px viewport, camera capture, iOS HEIC, save/discard, back button.
- **Regression**: transferee with zero external records renders as today; EOSY/promotion untouched.

---

## 13. Open decisions

1. **Term structure** — do incoming SF10s use 4 quarters or 3 terms? Lock the parser + renderer mapping.
2. **Phase 2 timing** — ship manual (phase 1) first, or bundle scanning from the start?
3. **Image retention** — keep scans forever, or purge after N months (record stays)?
4. **Verification lock** — should a saved record be "verified" and locked, or always editable with audit?
5. **Term fidelity** — store final ratings only, or full per-term values? (Recommend full.)
6. **Re-transfer same year** — if a learner transfers A → B → SMART within one school year,
   `schoolName` in the unique key allows multiple partial records. Confirm the merge can pick
   the relevant previous school.
7. **SF9 eligibility / back subjects** — EnrollPro decides `sf9EligibilityStatus`
   (`PROMOTED` / `CONDITIONALLY_PROMOTED` / `RETAINED`) and conditional-promotion back subjects, but
   does **not** expose them to SMART. Confirm whether the registrar should capture the eligibility
   status and up to two back subjects in SMART (per prior-school year), since these affect
   remediation/EOSY handling.

---

## 14. File change summary

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | + `ExternalSchoolRecord`, `ExternalSubjectRecord`, `ExternalRecordSource`; `Student` relation |
| `server/src/routes/registrar/externalRecords.ts` | **NEW** router (scan + CRUD) |
| `server/src/lib/sf10Scan/*` | **NEW** OCR + parser + layout configs |
| `server/src/routes/registrar/transferees.ts` | add `studentId` + prior-record completeness |
| `server/src/lib/sf10.ts` | merge external records (incl. mid-year term merge) |
| `server/src/schemas/registrar.ts` | new zod schemas |
| `src/pages/registrar/Transferees.tsx` | mobile cards, header fix, prior-record column, route button |
| `src/pages/registrar/Sf10RecordsPage.tsx` | **NEW** scan/review page |
| `src/pages/registrar/SchoolForms.tsx` | external / merged year rendering |
| `src/pages/registrar/components/StudentDetailDialog.tsx` | prior-school history |
| `src/lib/api.ts` | types + API functions; extend `SF10Data` |
| `src/App.tsx` | new route |

Not touched: `promotion.ts`, `rollover.ts`, existing `enrollproSync.ts` functions, prune engine.

---

*Created 2026-09-12. Extends `TRANSFEREE_PLAN.md` §8.3 / §14 (previous-school grades).*
*Updated 2026-09-12 — aligned to the EnrollPro "SMART Transferee Enrollment Handoff" (2026-09-11): the transferee feed is the publish boundary and exposes no previous-school, SF9/PSA, eligibility, or back-subject data; those are registrar-captured here.*
