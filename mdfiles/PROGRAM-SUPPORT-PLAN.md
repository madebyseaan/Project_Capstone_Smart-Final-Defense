# PROGRAM SUPPORT PLAN (SPA, SPS, STE) — COMPREHENSIVE

**Date:** 2026-08-19
**Status:** COMPLETED (v1.1 — all 10 phases done + SF10 grade-level filtering fix)
**Author:** Senior Developer Review
**School:** HINIGARAN NATIONAL HIGH SCHOOL

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Research Findings](#2-research-findings)
3. [Current State Analysis](#3-current-state-analysis)
4. [Requirements](#4-requirements)
5. [Architecture Decisions](#5-architecture-decisions)
6. [Implementation Plan](#6-implementation-plan)
7. [File Change Manifest](#7-file-change-manifest)
8. [Edge Cases & Risks](#8-edge-cases--risks)
9. [Testing Strategy](#9-testing-strategy)
10. [Questions & Answers](#10-questions--answers)
11. [Operational Guidelines](#11-operational-guidelines)
12. [Open Questions](#12-open-questions)
13. [Approval](#13-approval)

---

## 1. EXECUTIVE SUMMARY

### Problem
The SF10 (Form 137) permanent record currently assumes all sections follow the regular curriculum. Special programs (SPA, SPS, STE) have additional subjects that must appear on SF10, but the system has no way to distinguish which section is which program.

### Solution
Add a `program` field to the Section model, sync it from EnrollPro (the source of truth), and update SF10 rendering to show program-appropriate subjects.

### Key Findings
- **EnrollPro already provides** `programType` on sections — we just need to sync it
- **General Average includes ALL subjects** — specializations count toward GA (per DepEd)
- **MAPEH still exists** — SPA/SPS Specialization are ADDITIONAL rows, not replacements
- **Section names are unique** per grade level — no need to change unique constraint
- **Teachers don't need to change** how they enter grades — program is display metadata only

### Impact
- **20+ files** need changes (mostly display/UI)
- **Grade calculation pipeline** — NO changes needed
- **Grade entry/submission** — NO changes needed
- **Attendance system** — NO changes needed

---

## 2. RESEARCH FINDINGS

### 2.1 DepEd Policy on Special Programs

**Source:** DepEd Order No. 21, s. 2019 (Policy Guidelines on K to 12 Basic Education Program)

> "In JHS, the SCPs will no longer take the place of TLE; instead, the SCP will be treated as an **additional subject**. The delivery of TLE shall be contextualized to the SCP being taken up by the learners."

**Implication:** SPA/SPS/STE subjects are ADDITIONAL, not replacements. TLE still exists.

### 2.2 General Average Calculation

**Source:** DepEd Order No. 8, s. 2015 and DO 015, s. 2026

> "The General Average (GA) shall be computed by averaging the FGs in **all learning areas** taken throughout the SY. Each learning area has **equal weight**."

**Formula:**
```
General Average = Sum of Final Grades of ALL Learning Areas / Total Number of Learning Areas
```

**Implication:** SPA Specialization, SPS Specialization, Research, and STE Specialized subjects ALL count toward General Average.

### 2.3 MAPEH Handling

**Source:** DepEd SF10-JHS Guidelines (TeacherPH, 2019)

> "The rating for MAPEH shall be the average of the ratings for the said learning areas (Music, Arts, PE, Health)."

**Implication:** MAPEH is a separate row that averages Music + Arts + PE + Health. SPA/SPS Specialization are additional rows.

### 2.4 EnrollPro Programs

**Verified from EnrollPro Integration v1 API:**

| EnrollPro `programType` | Short Code | Description |
|------------------------|------------|-------------|
| `REGULAR` | REGULAR | Standard curriculum |
| `SPECIAL_PROGRAM_IN_THE_ARTS` | SPA | Arts specialization |
| `SPECIAL_PROGRAM_IN_SPORTS` | SPS | Sports specialization |
| `SCIENCE_TECHNOLOGY_AND_ENGINEERING` | STE | Science, Technology & Engineering |

### 2.5 Section Names Uniqueness

**Verified from EnrollPro:**

| Grade | Sections | Unique? |
|-------|----------|---------|
| Grade 7 | Aguinaldo, Bonifacio, Luna, Mabini, Rizal | ✅ Yes |
| Grade 8 | Maka-Diyos, Makabansa, Makakalikasan, Makatao, Matapat | ✅ Yes |
| Grade 9 | Daisy, Orchid, Rose, Sampaguita, Tulip | ✅ Yes |
| Grade 10 | Diamond, Gold, Jade, Pearl, Silver | ✅ Yes |

**Decision:** Keep current unique constraint `[name, gradeLevel, schoolYear]`.

### 2.6 ATLAS Teaching Loads

**Verified from ATLAS API:**

ATLAS provides these special program subjects:
```
SPA_SPEC       — Special Program in the Arts: Specialization
SPS_SPEC       — Special Program in Sports: Specialization
STE_RESEARCH   — Research
STE_ENV_SCI    — Environmental Science
STE_BIOTECH    — Biotechnology
STE_APPLIED_CHEM — Applied Chemistry
STE_APPLIED_PHYS — Applied Physics
STE_ROBOTICS   — Robotics
```

**Implication:** These are ADDITIONAL subjects, not replacements.

---

## 3. CURRENT STATE ANALYSIS

### 3.1 Sections by Program (SY 2026-2027)

| Program | Grade 7 | Grade 8 | Grade 9 | Grade 10 |
|---------|---------|---------|---------|----------|
| **SPA** | Rizal | Maka-Diyos | Sampaguita | Gold |
| **SPS** | Mabini | Makakalikasan | Daisy | Diamond |
| **STE** | Bonifacio | Makatao | Rose | Silver |
| **Regular** | Aguinaldo, Luna | Makabansa, Matapat | Orchid, Tulip | Jade, Pearl |

### 3.2 Current Database Schema

**Section Model (server/prisma/schema.prisma:82-101):**
```prisma
model Section {
  id               String            @id @default(cuid())
  name             String
  gradeLevel       GradeLevel
  schoolYear       String
  adviserId        String?
  status           String            @default("ACTIVE")
  archivedAt       DateTime?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  // ... relations

  @@unique([name, gradeLevel, schoolYear])
  @@index([gradeLevel, schoolYear])
}
```

**Missing:** `program` field

### 3.3 EnrollPro Sync Gap

**File:** `server/src/lib/enrollproSync.ts` (lines 265-280)

Current upsert does NOT include `programType`:
```typescript
const section = await prisma.section.upsert({
  where: { name_gradeLevel_schoolYear: { ... } },
  update: { adviserId: teacherId },
  create: { name, gradeLevel, schoolYear, adviserId: teacherId },
});
```

### 3.4 SF10 Rendering Gap

**File:** `src/pages/registrar/SchoolForms.tsx`

- `SF10_JHS_LEARNING_AREAS` (lines 638-651): Hardcoded 12 subjects
- `matchSubjectToSF10` (lines 654-669): No program awareness
- `renderSF10Content` (lines 719-1037): No program-aware rows

---

## 4. REQUIREMENTS

### 4.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Section model shall have a `program` field | HIGH |
| FR-2 | EnrollPro sync shall populate `program` from `programType` | HIGH |
| FR-3 | SF10 shall show 12 subjects for Regular sections | HIGH |
| FR-4 | SF10 shall show 13 subjects for SPA sections (Regular + SPA Specialization) | HIGH |
| FR-5 | SF10 shall show 13 subjects for SPS sections (Regular + SPS Specialization) | HIGH |
| FR-6 | SF10 shall show 14-15 subjects for STE sections (Regular + Research + Specialized) | HIGH |
| FR-7 | General Average shall include ALL subjects (including specializations) | HIGH |
| FR-8 | MAPEH shall average Music + Arts + PE + Health (same for all programs) | HIGH |
| FR-9 | Student transferring REGULAR → STE shall show different rows per year | MEDIUM |
| FR-10 | Section dropdown shall show program label | MEDIUM |
| FR-11 | Dashboard shall show program distribution | LOW |

### 4.2 Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-1 | Backward compatible — existing sections default to REGULAR | HIGH |
| NFR-2 | No changes to grade calculation pipeline | HIGH |
| NFR-3 | No changes to grade entry/submission workflow | HIGH |
| NFR-4 | Transmutation table same for all programs | HIGH |

---

## 5. ARCHITECTURE DECISIONS

### AD-1: Unique Constraint

**Decision:** Keep current `[name, gradeLevel, schoolYear]` constraint.

**Rationale:** Section names are already unique per grade level in EnrollPro. Adding `program` to the constraint would complicate all upsert operations without providing value.

### AD-2: General Average Calculation

**Decision:** Include ALL subjects in General Average (per DepEd policy).

**Rationale:** DepEd Order states "all learning areas" have equal weight. Specializations count.

### AD-3: MAPEH Handling

**Decision:** MAPEH remains as average of Music + Arts + PE + Health. SPA/SPS Specialization are additional rows.

**Rationale:** DepEd policy states SCPs are ADDITIONAL, not replacements.

### AD-4: Transmutation Table

**Decision:** Use same transmutation table for all programs.

**Rationale:** DepEd transmutation table is universal. No program-specific variations.

### AD-5: Grade Calculation

**Decision:** No changes to grade calculation pipeline.

**Rationale:** Grades are per-class-assignment, not per-program. The program is display metadata only.

---

## 6. IMPLEMENTATION PLAN

### Phase 1: Database Schema (LOW effort)

| Task | File | Description |
|------|------|-------------|
| 1.1 | `server/prisma/schema.prisma` | Add `program String? @default("REGULAR")` to Section model |
| 1.2 | `server/prisma/schema.prisma` | Run `prisma migrate dev --name add-section-program` |
| 1.3 | `server/prisma/schema.prisma` | Run `prisma generate` |

### Phase 2: EnrollPro Sync (LOW effort)

| Task | File | Description |
|------|------|-------------|
| 2.1 | `server/src/lib/enrollproSync.ts` | Add `mapProgramType()` function |
| 2.2 | `server/src/lib/enrollproSync.ts` | Update section upsert to include `program` |

### Phase 3: TypeScript Interface (LOW effort)

| Task | File | Description |
|------|------|-------------|
| 3.1 | `src/lib/api.ts` | Add `program?: string` to `Section` interface |

### Phase 4: SF10 API Endpoint (MEDIUM effort)

| Task | File | Lines | Description |
|------|------|-------|-------------|
| 4.1 | `server/src/routes/registrar.ts` | 1314-1444 | Include `program` in `academicHistory` per year |
| 4.2 | `server/src/routes/registrar.ts` | 1396-1444 | Include `program` in `schoolRecords` output |
| 4.3 | `server/src/routes/registrar.ts` | 1678-1688 | Include `program` in sections endpoint |

### Phase 5: SF10 Frontend Rendering (HIGH effort)

| Task | File | Lines | Description |
|------|------|-------|-------------|
| 5.1 | `src/pages/registrar/SchoolForms.tsx` | 638-651 | Make `SF10_JHS_LEARNING_AREAS` dynamic per program |
| 5.2 | `src/pages/registrar/SchoolForms.tsx` | 654-669 | Update `matchSubjectToSF10` for SPA/SPS/STE subjects |
| 5.3 | `src/pages/registrar/SchoolForms.tsx` | 719-1037 | Update `renderSF10Content` for program-aware rows |
| 5.4 | `src/pages/registrar/SchoolForms.tsx` | 141-150, 1131-1146 | Section dropdown — show program label |

### Phase 6: Other API Endpoints (LOW effort)

| Task | File | Description |
|------|------|-------------|
| 6.1 | `server/src/routes/registrar.ts` | Include `program` in dashboard, students, SF1, SF5, SF8 responses |
| 6.2 | `server/src/routes/advisory.ts` | Include `program` in section responses |
| 6.3 | `server/src/routes/admin.ts` | Include `program` in section options |
| 6.4 | `server/src/routes/grades.ts` | Include `program` in section responses |
| 6.5 | `server/src/routes/attendance.ts` | Include `program` in Excel export |

### Phase 7: Sync Utilities (LOW effort)

| Task | File | Description |
|------|------|-------------|
| 7.1 | `server/src/lib/atlasSync.ts` | Update section key maps |
| 7.2 | `server/src/lib/teacherSync.ts` | Update section lookup maps |
| 7.3 | `server/src/lib/ensureDevAccount.ts` | Add `program` to fallback section |

### Phase 8: Historical Seeding (LOW effort)

| Task | File | Description |
|------|------|-------------|
| 8.1 | `server/prisma/seed-historical.ts` | Add `program` to section upsert |

### Phase 9: Frontend Components (MEDIUM effort)

| Task | File | Description |
|------|------|-------------|
| 9.1 | `src/pages/admin/ClassAssignments.tsx` | Show program in section dropdown + table |
| 9.2 | `src/pages/teacher/Dashboard.tsx` | Add program filter + badge display |
| 9.3 | `src/pages/teacher/MyAdvisory.tsx` | Display program in header |
| 9.4 | `src/pages/teacher/Attendance.tsx` | Section label — show program |
| 9.5 | `src/pages/teacher/AttendanceReports.tsx` | Section label — show program |
| 9.6 | `src/pages/registrar/SectionRosterViewer.tsx` | Section label — show program |
| 9.7 | `src/pages/registrar/StudentRecords.tsx` | Section filter — add program |

---

## 7. FILE CHANGE MANIFEST

### 7.1 Backend Files

| # | File | Change Type | Effort |
|---|------|-------------|--------|
| 1 | `server/prisma/schema.prisma` | Schema change | LOW |
| 2 | `server/src/lib/enrollproSync.ts` | Sync logic | LOW |
| 3 | `server/src/routes/registrar.ts` | API responses | MEDIUM |
| 4 | `server/src/routes/advisory.ts` | API responses | LOW |
| 5 | `server/src/routes/admin.ts` | API responses | LOW |
| 6 | `server/src/routes/grades.ts` | API responses | LOW |
| 7 | `server/src/routes/attendance.ts` | API responses | LOW |
| 8 | `server/src/lib/atlasSync.ts` | Section key maps | LOW |
| 9 | `server/src/lib/teacherSync.ts` | Section lookup maps | LOW |
| 10 | `server/src/lib/ensureDevAccount.ts` | Fallback section | LOW |
| 11 | `server/prisma/seed-historical.ts` | Historical seeding | LOW |

### 7.2 Frontend Files

| # | File | Change Type | Effort |
|---|------|-------------|--------|
| 12 | `src/lib/api.ts` | TypeScript interface | LOW |
| 13 | `src/pages/registrar/SchoolForms.tsx` | SF10 rendering | **HIGH** |
| 14 | `src/pages/admin/ClassAssignments.tsx` | Admin UI | MEDIUM |
| 15 | `src/pages/teacher/Dashboard.tsx` | Teacher UI | MEDIUM |
| 16 | `src/pages/teacher/MyAdvisory.tsx` | Teacher UI | LOW |
| 17 | `src/pages/teacher/Attendance.tsx` | Teacher UI | LOW |
| 18 | `src/pages/teacher/AttendanceReports.tsx` | Teacher UI | LOW |
| 19 | `src/pages/registrar/SectionRosterViewer.tsx` | Registrar UI | LOW |
| 20 | `src/pages/registrar/StudentRecords.tsx` | Registrar UI | LOW |

### 7.3 Files That Do NOT Change

| File | Reason |
|------|--------|
| `server/src/routes/grades.ts` (grade calculation) | Uses SubjectType, not program |
| `server/src/lib/workload.ts` | Workload minutes based on subject type |
| `server/src/routes/admin.ts` (transmutation) | Same table for all programs |
| `server/src/routes/admin.ts` (grading config) | Already handles SPA/SPS/STE weights |
| `src/pages/admin/TransmutationTable.tsx` | Same table for all programs |
| `src/pages/admin/GradingConfig.tsx` | Already documents weight groups |

---

## 8. EDGE CASES & RISKS

### 8.1 Student Transfers Between Programs

**Scenario:** Student moves from REGULAR Grade 7 to STE Grade 9.

**Impact:** SF10 must show different learning areas per year.

**Solution:** API returns `program` per year in `academicHistory`. Frontend renders different rows per year.

### 8.2 Historical Data Migration

**Scenario:** Existing sections have no `program` value.

**Impact:** Prisma migration must set default for all existing rows.

**Solution:** Migration sets `program = 'REGULAR'` for all existing sections.

### 8.3 EnrollPro Program Type Mapping

**Scenario:** EnrollPro sends `SCIENCE_TECHNOLOGY_AND_ENGINEERING` but we need `STE`.

**Impact:** Inconsistent program codes.

**Solution:** `mapProgramType()` function normalizes EnrollPro codes to short codes.

### 8.4 SF10 Layout for STE

**Scenario:** STE sections have 14-15 rows (Regular + Research + Specialized).

**Impact:** SF10 table may need landscape orientation.

**Solution:** Handle dynamically in `renderSF10Content`. May need condensed layout for STE.

### 8.5 MAPEH Sub-Area Aggregation

**Scenario:** SPA sections may not have individual Music/Arts grades.

**Impact:** MAPEH average calculation may fail.

**Solution:** DepEd says SCPs are ADDITIONAL. MAPEH still exists. Individual Music/Arts/PE/Health grades must be entered.

### 8.6 General Average with Additional Subjects

**Scenario:** SPA student has 13 subjects, Regular has 12.

**Impact:** General Average may differ due to additional subject.

**Solution:** This is correct per DepEd. GA = sum of ALL final grades / total number of learning areas.

---

## 9. TESTING STRATEGY

### 9.1 Unit Tests

| Test | Description |
|------|-------------|
| `mapProgramType()` | Verify correct mapping of EnrollPro codes to short codes |
| `matchSubjectToSF10()` | Verify correct matching for each program |
| `SF10_JHS_LEARNING_AREAS` | Verify correct subject list per program |

### 9.2 Integration Tests

| Test | Description |
|------|-------------|
| EnrollPro sync | Verify `program` field is populated from EnrollPro |
| SF10 API | Verify `program` is included in academicHistory |
| SF10 rendering | Verify correct number of rows per program |

### 9.3 E2E Tests

| Test | Description |
|------|-------------|
| Regular SF10 | Verify 12 subjects, correct grades, correct GA |
| SPA SF10 | Verify 13 subjects (includes SPA Specialization) |
| SPS SF10 | Verify 13 subjects (includes SPS Specialization) |
| STE SF10 | Verify 14-15 subjects (includes Research + Specialized) |
| Student transfer | Verify different rows per year for REGULAR → STE |
| MAPEH average | Verify correct calculation for all programs |
| General Average | Verify includes all subjects (including specializations) |

### 9.4 Manual Testing Checklist

- [ ] Prisma migration runs without errors
- [ ] EnrollPro sync populates `program` field
- [ ] Regular section SF10 shows 12 subjects
- [ ] SPA section SF10 shows 13 subjects
- [ ] SPS section SF10 shows 13 subjects
- [ ] STE section SF10 shows 14-15 subjects
- [ ] Student transferring REGULAR → STE shows different rows per year
- [ ] MAPEH average calculates correctly for all programs
- [ ] General Average includes all subjects (including specializations)
- [ ] Transmutation applies correctly for all programs
- [ ] Section dropdown shows program label
- [ ] Dashboard shows program distribution
- [ ] Attendance export includes program
- [ ] Teacher grade entry works unchanged
- [ ] Admin class assignments show program

---

## 10. QUESTIONS & ANSWERS

### Q1: Does General Average include special program subjects?
**A:** YES. Per DepEd, "all learning areas" have equal weight. Specializations count.

### Q2: Does MAPEH still exist alongside SPA/SPS?
**A:** YES. MAPEH is the average of Music + Arts + PE + Health. SPA/SPS Specialization are additional rows.

### Q3: Are section names unique per grade level?
**A:** YES. Verified from EnrollPro. Keep current unique constraint.

### Q4: Do teachers need to change how they enter grades?
**A:** NO. Grade entry is per-class-assignment. Program is display metadata only.

### Q5: Does the transmutation table change per program?
**A:** NO. Same DepEd transmutation table for all programs.

### Q6: What happens if a student transfers from REGULAR to STE?
**A:** SF10 shows different learning areas per year. API returns `program` per year.

### Q7: How many subjects does each program have?
**A:**
- Regular: 12 subjects
- SPA: 13 subjects (+ SPA Specialization)
- SPS: 13 subjects (+ SPS Specialization)
- STE: 14-15 subjects (+ Research + Specialized Subject)

---

## 11. OPERATIONAL GUIDELINES

### 11.1 Error Checking Protocol

**After EVERY phase or significant change:**
1. Run `pm2 restart all`
2. Run `pm2 logs --lines 50` to check for errors
3. If errors found → fix BEFORE proceeding to next phase
4. If no errors → proceed

**Never skip error checking. This is how we prevent bugs.**

### 11.2 Playwright Testing

**Use Playwright to verify UI changes:**

| Role | URL | Credentials |
|------|-----|-------------|
| Teacher | `http://localhost:5173/login` | `1000002` / `DepEd2026!` |
| Admin | `http://localhost:5173/login/admin` | `1234501` / `DepEdSY2026!` |
| Registrar | `http://localhost:5173/login/registrar` | `1234502` / `DepEd2026!` |

**Note:** Teacher ID `1000002` is all-purpose. For other teacher IDs, access EnrollPro to get them — password is the same for all.

### 11.3 Source of Truth

| System | What It Owns |
|--------|--------------|
| **EnrollPro** | Sections, Students, Enrollments, Program Types, School Year |
| **ATLAS** | Teaching Loads, Subject Assignments, Teacher Workloads |
| **SMART** | Grades, Attendance, SF Forms, Reports |

**Always verify against EnrollPro/ATLAS when unsure about data.**

### 11.4 Testing Protocol

**Before concluding ANY phase:**
1. Test the specific change with Playwright
2. Verify the API response includes the new field
3. Verify the UI renders correctly
4. Check for regressions (things that worked before still work)

### 11.5 Decision-Making

- Make decisions independently — don't block on clarification unless critical
- Align all decisions to DepEd 3-term system
- When in doubt, check the DepEd policy references in Section 2

### 11.6 Step-by-Step Approach

- Complete each phase fully before moving to next
- No rushing — working code > fast code
- Re-read this planning MD before each phase to stay on track

### 11.7 Checkpoint Protocol

**If something critical needs clarification:**
1. STOP work
2. Document the question in this MD under "Open Questions"
3. Wait for user response before proceeding

**But as much as possible — choose the correct decision and keep moving.**

### 11.8 Communication

- User is available for questions — don't hesitate to ask
- But prioritize making good decisions over asking questions
- The goal is a WORKING system, not a fast finish

---

## 12. OPEN QUESTIONS

*None currently — will be populated if blockers arise during implementation.*

---

## 13. APPROVAL

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| Tech Lead | | | |
| Project Manager | | | |
| School Registrar | | | |

---

*Document Version: 1.1*
*Last Updated: 2026-08-19*
*Added: Operational Guidelines, Checkpoint Protocol*
