# REGISTRAR PORTAL — NEXT STEPS PLAN

**Date:** 2026-08-20
**Status:** PLANNING
**Author:** Senior Developer Review
**School:** HINIGARAN NATIONAL HIGH SCHOOL

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Current State](#2-current-state)
3. [Gap Analysis](#3-gap-analysis)
4. [Phase 1: Alumni Access](#4-phase-1-alumni-access)
5. [Phase 2: SF6 Summary](#5-phase-2-sf6-summary)
6. [File Change Manifest](#6-file-change-manifest)
7. [Testing Strategy](#7-testing-strategy)
8. [Open Questions](#8-open-questions)

---

## 1. EXECUTIVE SUMMARY

### Problem
After completing program support (SPA/SPS/STE) and SF10 dynamic rendering, the registrar portal has two critical gaps:
1. **Graduated students become inaccessible** after rollover — no UI to find/print their SF10
2. **SF6 (Summary Promotion Report)** can be derived from existing SF5 data but is not implemented

### Solution
1. Add "Alumni / Graduated Students" section to registrar portal
2. Implement SF6 as aggregate of SF5 data

### Scope
- Focus ONLY on system-aligned features (forms where SMART has data)
- Skip SF3 (Books), SF7 (Personnel), SF8 (Health) — out of scope

---

## 2. CURRENT STATE

### 2.1 DepEd JHS School Forms

| Form | Name | In SMART Scope? | Status |
|------|------|-----------------|--------|
| SF1 | School Register | ✅ Yes | ✅ Implemented |
| SF2 | Daily Attendance | ✅ Yes | ✅ Implemented |
| SF3 | Books Issued & Returned | ❌ No (Library) | Skip |
| SF4 | Monthly Learner Movement | ⚠️ Partial | Skip for now |
| SF5 | Promotion & Proficiency | ✅ Yes | ✅ Implemented |
| SF6 | Summary Promotion Report | ✅ Yes (derivable) | 🔜 Next |
| SF7 | School Personnel Profile | ❌ No (HR) | Skip |
| SF8 | Learner's Health & Nutrition | ❌ No (Clinic) | Skip |
| SF9 | Progress Report Card | ✅ Yes | ✅ Implemented |
| SF10 | Permanent Record | ✅ Yes | ✅ Implemented |

### 2.2 Database Schema

```prisma
// Enrollment statuses
enum EnrollmentStatus {
  ENROLLED
  PENDING
  DROPPED
  TRANSFERRED
}

// Student statuses (from admin route)
// ACTIVE, ARCHIVED, COMPLETED

// Section statuses
// ACTIVE, ARCHIVED, COMPLETED
```

### 2.3 Current API Endpoints

| Endpoint | Purpose | Filter |
|----------|---------|--------|
| `GET /registrar/students` | List students | `schoolYear`, `gradeLevel`, `sectionId`, `search` — only `ENROLLED` status |
| `GET /registrar/student/:id` | Get student details | Works for any student |
| `GET /registrar/forms/sf9/:studentId` | Get SF9 data | Works for any student |
| `GET /registrar/forms/sf10/:studentId` | Get SF10 data | Works for any student |
| `GET /registrar/forms/sf5/:sectionId` | Get SF5 data | Per-section, current year |

---

## 3. GAP ANALYSIS

### 3.1 Critical Gap: Graduated Students Inaccessible

**Problem:**
- `/registrar/students` filters by `status: "ENROLLED"` and `schoolYear: currentYear`
- After rollover, graduated students have no enrollment in new year → invisible
- SF10 API works (takes student ID), but no UI to find them

**Impact:**
- Registrar cannot print final SF10 for graduated students
- Transferring students cannot get their permanent record

**Solution:**
- New endpoint: `GET /registrar/alumni` — searches ALL students with enrollments in ANY past year
- New page: `AlumniStudents.tsx` — search + SF10 view/print

### 3.2 Medium Gap: SF6 Summary Promotion Report

**Problem:**
- SF6 is school-wide promotion summary by grade level
- SF5 already returns per-section promotion data with `summary` field
- SF6 can aggregate SF5 across all sections

**Impact:**
- Registrar must manually compile promotion statistics

**Solution:**
- New endpoint: `GET /registrar/forms/sf6` — aggregates SF5 across all sections
- Add SF6 to SchoolForms.tsx form list

---

## 4. PHASE 1: ALUMNI ACCESS

### 4.1 API Endpoint

**New endpoint:** `GET /registrar/alumni`

```
Query params:
- search?: string (name or LRN)
- gradeLevel?: string (GRADE_7, GRADE_8, GRADE_9, GRADE_10)
- limit?: number (default 50)
- offset?: number (default 0)

Response:
{
  students: [
    {
      id: string,
      lrn: string,
      firstName: string,
      middleName: string,
      lastName: string,
      suffix: string,
      gender: string,
      lastGradeLevel: string,  // highest grade completed
      lastSection: string,
      lastSchoolYear: string,
      lastProgram: string,
      enrollmentStatus: string  // ENROLLED, DROPPED, TRANSFERRED
    }
  ],
  total: number
}
```

**Logic:**
1. Query ALL enrollments (not just current year)
2. Group by student, keep the latest enrollment
3. Include students with ANY status (ENROLLED, DROPPED, TRANSFERRED)
4. Search by name or LRN
5. Sort by last name

### 4.2 Frontend Page

**New page:** `AlumniStudents.tsx`

**Contents:**
- Search bar (name or LRN)
- Grade level filter dropdown
- Table with columns: LRN, Name, Gender, Last Grade, Last Section, Last SY, Status, Actions
- "View SF10" button per student
- "Print SF10" button per student
- Pagination

**UI Components needed:**
- `Card` — main container
- `Input` — search bar
- `Select` — grade level filter
- `Table` — student list
- `Button` — view/print SF10
- `Badge` — status indicator (Graduated, Transferred, Dropped)

### 4.3 Sidebar Navigation

**Add to `RegistrarLayout.tsx`:**
```
MANAGEMENT
├── Student Records (current students)
├── Alumni Students (graduated/transferred)  ← NEW
├── Teaching Load
└── School Forms
```

---

## 5. PHASE 2: SF6 SUMMARY

### 5.1 API Endpoint

**New endpoint:** `GET /registrar/forms/sf6`

```
Query params:
- schoolYear?: string (default: current)

Response:
{
  schoolYear: string,
  sections: [
    {
      sectionId: string,
      sectionName: string,
      gradeLevel: string,
      program: string,
      adviser: string,
      totalStudents: number,
      promoted: number,
      retained: number,
      dropped: number,
      transferred: number,
      promotionRate: number  // percentage
    }
  ],
  summary: {
    totalStudents: number,
    promoted: number,
    retained: number,
    dropped: number,
    transferred: number,
    overallPromotionRate: number
  },
  byGradeLevel: {
    GRADE_7: { total: number, promoted: number, retained: number },
    GRADE_8: { total: number, promoted: number, retained: number },
    GRADE_9: { total: number, promoted: number, retained: number },
    GRADE_10: { total: number, promoted: number, retained: number }
  }
}
```

**Logic:**
1. Get all sections for the school year
2. For each section, get enrollments and grades
3. Calculate promotion status per student (same logic as SF5)
4. Aggregate by section and grade level
5. Calculate promotion rates

### 5.2 Frontend Rendering

**Add to `SchoolForms.tsx`:**

**SF6 Card:**
```
┌─────────────────────────────────────┐
│ SF6                                 │
│ Summary Promotion Report            │
│                                     │
│ School-wide promotion statistics    │
│ by grade level.                     │
│                                     │
│ [View]                              │
└─────────────────────────────────────┘
```

**SF6 View:**
```
SF6 - Summary Promotion Report
School Year: 2026-2027

┌─────────────┬───────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ Grade Level │ Total │Promoted │ Retained│ Dropped │Transfer │ Rate    │
├─────────────┼───────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Grade 7     │ 20    │ 18      │ 2       │ 0       │ 0       │ 90%     │
│ Grade 8     │ 20    │ 17      │ 3       │ 0       │ 0       │ 85%     │
│ Grade 9     │ 20    │ 19      │ 1       │ 0       │ 0       │ 95%     │
│ Grade 10    │ 20    │ 20      │ 0       │ 0       │ 0       │ 100%    │
├─────────────┼───────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ TOTAL       │ 80    │ 74      │ 6       │ 0       │ 0       │ 92.5%   │
└─────────────┴───────┴─────────┴─────────┴─────────┴─────────┴─────────┘
```

---

## 6. FILE CHANGE MANIFEST

### Phase 1: Alumni Access

| File | Change Type | Description |
|------|-------------|-------------|
| `server/src/routes/registrar.ts` | Modify | Add `GET /registrar/alumni` endpoint |
| `src/pages/registrar/AlumniStudents.tsx` | **New** | Alumni search page |
| `src/App.tsx` | Modify | Add `/registrar/alumni` route |
| `src/layouts/RegistrarLayout.tsx` | Modify | Add sidebar link |
| `src/lib/api.ts` | Modify | Add `getAlumniStudents()` function |

### Phase 2: SF6 Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `server/src/routes/registrar.ts` | Modify | Add `GET /registrar/forms/sf6` endpoint |
| `src/pages/registrar/SchoolForms.tsx` | Modify | Add SF6 form card + rendering |
| `src/lib/api.ts` | Modify | Add `getSF6()` function |

---

## 7. TESTING STRATEGY

### Phase 1: Alumni Access

| Test Case | Expected Result |
|-----------|-----------------|
| Navigate to Alumni tab | Shows all students from all years |
| Search by name | Returns matching students |
| Search by LRN | Returns exact student |
| Filter by grade level | Shows only students from that grade |
| Click "View SF10" | Opens SF10 with all historical data |
| Print SF10 | Generates printable PDF |
| View student from previous year | Shows correct grade/section/SY |

### Phase 2: SF6 Summary

| Test Case | Expected Result |
|-----------|-----------------|
| Select school year | Shows SF6 for that year |
| View by grade level | Shows promotion stats per grade |
| Verify totals match SF5 | Aggregate matches sum of SF5 sections |
| Print SF6 | Generates printable summary |

---

## 8. OPEN QUESTIONS

1. **Alumni data retention:** How long should graduated students' data be kept in the system?
2. **SF6 format:** Should SF6 be per-section or school-wide aggregate? (Recommendation: school-wide with drill-down)
3. **SF4 priority:** Is SF4 (Learner Movement) needed, or skip it?

---

## APPROVAL

- [ ] Phase 1: Alumni Access
- [ ] Phase 2: SF6 Summary
