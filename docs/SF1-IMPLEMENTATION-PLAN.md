# SF1 (School Register) DepEd Compliance — Implementation Plan

## 1. Summary

Close the gap between SMART's SF1 output and the official DepEd School Form 1 specification. Today the registrar SF1 endpoints return 11 fields (core identity only). This plan adds the remaining DepEd-required fields — birthplace, mother tongue, IP membership, religion, full 4-part address, parent/guardian data, contact number, and coded remarks — plus the gender-separated row layout, totals rows, header (school info), and footer (remarks legend, signature lines, BoSY/EoSY dates). All data already exists locally in the Prisma Student model (hourly-synced by studentProfileSync.ts) and in Enrollment.profileSnapshot for historical point-in-time data. No new EnrollPro/ATLAS calls, no schema changes, no migrations.

**Scope:** 3 files. Backend route enhancements → shared types → frontend rendering/print/export.

## 2. Current State

| Aspect | Status |
|--------|--------|
| Data endpoint | Returns ~11 fields: LRN, name, sex, birth date, age, and basic enrollment info |
| Missing data fields | Birth place, mother tongue, IP community, religion, address components (house/barangay/municipality/province), father name, mother name, guardian name, guardian relationship, contact number, remarks |
| Layout | Flat student list — no gender separation, no TOTAL MALE / TOTAL FEMALE / TOTAL rows |
| Header | Incomplete school information block |
| Footer | No remarks legend, no Adviser/School Head signature lines, no BoSY/EoSY dates |
| Export | Export endpoint exists but emits the same 11 fields |
| Data availability | Not a blocker — Student model already holds every needed field; profileSnapshot on Enrollment holds historical values |

## 3. Target State

- Full column coverage (17 DepEd columns → 21 data fields) including sub-columns for name (3 parts) and address (4 parts).
- Gender-separated body: MALE block → TOTAL MALE → FEMALE block → TOTAL FEMALE → TOTAL. Totals computed server-side and verified in UI.
- Remarks rendered as DepEd codes (T/O, T/I, DRP, B/A, CCT, LWD, ACL, LE) — never long-form status strings.
- Age computed as of the first Friday of June of the school year's start year (DepEd age-cutoff rule), not "age today."
- Historical correctness: for past school years, read from Enrollment.profileSnapshot; for the current SY, read from live Student.
- Print-ready layout: landscape folio (DepEd standard), header with school identity, footer with legend + dual signature lines + date fields.
- Excel export parity: export endpoint emits the same 21 fields in the same order as on-screen/print.

## 4. Data Flow

```
Prisma Student (all fields, hourly-synced by studentProfileSync.ts)
Enrollment.profileSnapshot (point-in-time values for past SYs)
        │
        ▼
server/src/routes/registrar.ts
  GET  /api/registrar/forms/sf1/:sectionId    (enhanced: assembles SF1Data)
  GET  /api/registrar/export/sf1/:sectionId   (enhanced: xlsx with same fields)
        │   logic: pick snapshot vs live Student per SY,
        │   compute age vs first-Friday-of-June, map status → remarks codes,
        │   sort by gender (M first) then name, compute totals
        ▼
src/lib/api.ts  — SF1Student / SF1Data interfaces (single source of truth for FE)
        │
        ▼
src/pages/registrar/SchoolForms.tsx
  renderSF1Content() → header / gender blocks / totals / footer
  Print button  → print CSS (landscape folio)
  Export button → hits export endpoint, downloads file
```

**Rule:** historical SY → profileSnapshot; current SY → live Student; null-safe fallbacks everywhere (blank cell, never a crash).

## 5. Column Specification

### 5.1 Data Columns (order is contractual — match DepEd form left→right)

| # | Column | Source | Notes |
|---|--------|--------|-------|
| 1 | LRN | student.lrn | Blank if not yet issued |
| 2 | Name — Last, First, Middle | lastName, firstName, middleName | Display as "LAST, First Middlename" |
| 3 | Sex | sex | Drives gender block placement |
| 4 | Birth Date | birthDate | ISO in API; human format in render |
| 5 | Age (as of 1st Friday of June) | computed | Reference date = first Friday of June, SY start year |
| 6 | Birth Place | birthPlace | Province from student record |
| 7 | Mother Tongue | motherTongue | 19 recognized DepEd languages |
| 8 | IP (Indigenous People) | ipCommunity | Render checkmark/tribe name or blank |
| 9 | Religion | religion | |
| 10 | Address (4 sub-cols) | houseNoStreet, barangay, city, province | |
| 11 | Father's Name | fatherName | |
| 12 | Mother's Name | motherName | |
| 13 | Guardian's Name | guardianName | |
| 14 | Guardian Relationship | guardianRelationship | |
| 15 | Contact Number | contactNumber (guardian contact) | |
| 16 | Remarks | mapped code (§5.2) | Multiple codes allowed, comma-separated |

### 5.2 Remarks Code Mapping

| Code | Meaning | Source / derivation |
|------|---------|---------------------|
| T/O | Transferred Out | enrollment status = transferred out |
| T/I | Transferred In | enrollment status = transferred in |
| DRP | Dropped | enrollment status = dropped |
| B/A | Balik-Aral | balik-aral flag / prior enrollment gap |
| CCT | 4Ps Beneficiary | 4Ps/CCT beneficiary flag |
| LWD | Learner with Disability | disability field non-null |
| ACL | Accelerated | acceleration flag |
| LE | Late Enrollee | enrollment date after cutoff |

Codes with no direct DB field fall back to blank — never invent data.

### 5.3 Layout Specification

- **Header:** School name, school ID, DepEd region/division, school year, grade level, section, adviser name.
- **Body:** MALE label row → male students (sorted by last name) → TOTAL MALE → FEMALE label row → female students → TOTAL FEMALE → TOTAL row.
- **Footer:** Remarks legend (all 8 codes with meanings) · "Prepared by: Adviser" and "Certified correct by: School Head" signature lines · BoSY / EoSY date fields.
- **Print CSS:** landscape folio (8.5"×13"), fixed header/footer, condensed font for wide table.

## 6. File Changes

### 6.1 `src/lib/api.ts`

- Add `SF1Student` interface: 21 fields per §5.1 + remarks: string.
- Add `SF1Data` interface: students[], totals, school header info, adviser name, SY, BoSY/EoSY dates.
- Add typed API functions for the two SF1 endpoints.

### 6.2 `server/src/routes/registrar.ts`

**Endpoint 1 — SF1 data (enhance):**
- Expand Prisma query to select all §5.1 fields from Student, joined with Enrollment.
- Historical SYs: read from profileSnapshot (JSON) instead of live Student.
- Add age-as-of-first-Friday-June computation.
- Add status → remarks-code mapping.
- Sort: males first, then females; alphabetical by last name within each.
- Compute totals; return shape matching SF1Data.

**Endpoint 2 — SF1 export (enhance):**
- Reuse the same assembly logic (single code path — no drift).
- Emit xlsx with the 17 columns in §5.1 order, gender label rows, and totals rows.

**Cross-cutting:** Keep role guard (REGISTRAR only), keep audit logging. If registrar.ts approaches 1000-line limit, extract into `server/src/lib/sf1Composer.ts`.

### 6.3 `src/pages/registrar/SchoolForms.tsx`

- Add `renderSF1Content()`: header block, gender-separated table, totals rows, footer with legend + signature lines + dates.
- Null-safe rendering — empty fields render blank cells.
- Print button: triggers browser print with SF1-specific print CSS (landscape folio).
- Export button: calls export endpoint, triggers file download.
- If file exceeds 1000 lines, extract SF1 renderer into `src/pages/registrar/components/SF1Form.tsx`.

## 7. Execution Order

| Step | Task | Depends on |
|------|------|------------|
| 1 | Enhance SF1 data endpoint (query expansion, snapshot vs live logic, age calc, remarks mapping, totals) | — |
| 2 | Enhance SF1 export endpoint (reuse step-1 assembly) | 1 |
| 3 | Add SF1Student / SF1Data interfaces + API functions in api.ts | 1 (contract) |
| 4 | Implement renderSF1Content() in SchoolForms.tsx (header/body/footer/totals) | 3 |
| 5 | Add print button + print CSS (landscape folio) | 4 |
| 6 | Add export button + download flow | 2, 4 |
| 7 | Verification (§8) | all |

Backend-first ordering means the frontend always consumes a stable contract.

## 8. Verification Checklist

### Builds & lint
- [ ] `npm run build` (frontend) passes — no type errors
- [ ] `server/ npm run build` passes
- [ ] `npm run lint` clean on all touched files
- [ ] No touched file exceeds 1000 lines
- [ ] Existing backend test suite passes

### Data correctness
- [ ] API returns all 21 fields per §5.1 in the specified order
- [ ] Age = full years as of first Friday of June (SY start year)
- [ ] Historical SY pulls from profileSnapshot; current SY pulls live Student
- [ ] Remarks render as codes only (T/O, T/I, DRP, B/A, CCT, LWD, ACL, LE)
- [ ] Rows sorted: males → females, alphabetical within blocks
- [ ] TOTAL MALE + TOTAL FEMALE = TOTAL

### UI / print / export
- [ ] Gender-separated layout with label rows and totals rows renders correctly
- [ ] Header shows school info; footer shows legend + signature lines + BoSY/EoSY dates
- [ ] Print preview: landscape folio, fits width, header/footer intact
- [ ] Export downloads xlsx with identical columns/order/totals as screen
- [ ] Empty optional fields render blank — no crash

### Security / regression
- [ ] SF1 endpoints still REGISTRAR-role only (403 for teacher/admin tokens)
- [ ] Audit log entry written on export
- [ ] No EnrollPro/ATLAS calls introduced (local Prisma data only)
- [ ] Existing SF endpoints (SF10, etc.) unaffected
