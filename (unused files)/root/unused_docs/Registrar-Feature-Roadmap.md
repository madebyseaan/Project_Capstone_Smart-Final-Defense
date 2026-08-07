# Registrar Feature Roadmap
**System**: SMART — School Management and Reporting Tool  
**Role**: REGISTRAR  
**Status**: Planning — DO NOT implement until approved  
**Data Sources**: EnrollPro (Source of Truth), SMART (grades/reports), ATLAS (teacher loads), AIMS (LMS)

---

## Current State

| Page | Status | Notes |
|------|--------|-------|
| Dashboard | ⚠️ Partial | Stats live-fetched from EnrollPro but gender counts broken (Bug #1) |
| Student Records | ⚠️ Broken | Reads local SMART DB, not EnrollPro. Gender detection wrong |
| School Forms (SF9/SF10/SF8) | ✅ Exists | Reads local SMART grades — correct source |
| Print Center | ✅ Exists | Works |
| Enrollment.tsx | ❌ Remove | Wrong concept — EnrollPro owns enrollments |
| Sync Status Badge | ✅ Exists | On dashboard, works |
| Force Sync Button | ✅ Exists | On dashboard, works |

---

## Phase 0 — Bug Fixes (Fix-Registrar-Sync.md)
Must be done first before adding new features.

- [ ] Fix Male/Female count on Dashboard (fetch from EnrollPro learners feed)
- [ ] Fix Student Records to read from EnrollPro (not local DB)
- [ ] Fix gender badge — always shows pink because of case mismatch ("MALE" vs "Male")
- [ ] Fix hardcoded school years in Student Records
- [ ] Remove `Enrollment.tsx` and its nav link

---

## Phase 1 — Core Missing Pages (EnrollPro-Powered)

### 1.1 Enrollment Application Tracker
**Source**: EnrollPro `GET /api/applications`  
**Why**: Registrar needs to see the real-time enrollment pipeline — who applied, who is confirmed, who is pending. This replaces the old `Enrollment.tsx`.  
**Read-Only**: YES. No approvals or rejections from SMART.

**Content**:
- Table: Application tracking number, student name, LRN, grade level, status (PENDING / ENROLLED / REJECTED)
- Filter by: status, grade level, school year
- Badge counts: Pending, Enrolled, Rejected
- "Refresh from EnrollPro" button

---

### 1.2 BOSY Queue (Beginning of School Year)
**Source**: EnrollPro `GET /api/bosy/queue`, `GET /api/bosy/expected-queue`  
**Why**: At the start of every SY, returning students pile up in the BOSY queue. The Registrar manually confirms their return. Without this page, they have no visibility in SMART.  
**Read-Only**: YES (confirmation actions stay in EnrollPro).

**Content**:
- Queue table: LRN, Name, Prior Grade Level, Prior Section, Confirmation status
- "Expected but not yet confirmed" list — pulled from `expected-queue`
- Total count of pending confirmations
- Link to EnrollPro to take action (since writes stay in EnrollPro)

---

### 1.3 Remedial Processing Tracker
**Source**: EnrollPro `GET /api/remedial/pending`  
**Why**: Conditionally promoted students must complete a remedial exam before the new SY begins. This is a legal/compliance requirement under DepEd. The Registrar tracks this.  
**Read-Only**: YES.

**Content**:
- Table: Student name, LRN, Grade Level, School Year, Final Average, Remedial status
- Status badges: Pending Remedial / Resolved
- Filter by grade level
- Alert counter on Dashboard: "X students pending remedial resolution"

---

### 1.4 Section Roster Viewer
**Source**: EnrollPro `GET /api/sections/:id/roster`  
**Why**: Registrar assigns teachers to sections and prepares official class lists for SF1. They need to see exactly who is enrolled in each section — not just counts.  
**Read-Only**: YES.

**Content**:
- Section list with grade level, adviser, enrolled count
- Click-through to full roster per section (paginated)
- Print/export roster to PDF or CSV

---

## Phase 2 — EOSY (End of School Year) Features

### 2.1 EOSY Section Finalization
**Source**: EnrollPro `GET /api/eosy/sections`, `POST /api/eosy/sections/:id/finalize`  
**Why**: Before generating SF5, the Registrar must lock/finalize each section's EOSY records. Without this, SF5 generation is blocked.

**Content**:
- List all sections for the current SY
- Status per section: Not Started / Grades Complete / Finalized
- "Finalize" action button per section (triggers EnrollPro `POST /api/eosy/sections/:id/finalize`)
- Progress bar: X of Y sections finalized

---

### 2.2 SF5 Export (Section Promotion Report)
**Source**: EnrollPro `GET /api/eosy/sections/:id/exports/sf5`  
**Why**: Official DepEd form for end-of-year section promotion and proficiency report.

**Content**:
- Section picker
- Preview table: Student, sex, birthdate, final average, EOSY status (Promoted/Retained/etc.)
- Export to PDF / Excel

---

### 2.3 SF6 Export (School-Wide Enrollment Summary)
**Source**: EnrollPro `GET /api/eosy/exports/sf6?schoolYearId=`  
**Why**: Official DepEd form for school-wide enrollment by grade level.

**Content**:
- Grade level breakdown: Male / Female / Total / Promoted / Retained / Dropout / Transfer Out
- Grand total row
- Export to PDF / Excel

---

## Phase 3 — ATLAS Integration (Teacher Load & Coverage)

### 3.1 Teaching Load Summary
**Source**: ATLAS `GET /faculty-assignments/summary?schoolId=&schoolYearId=`  
**Why**: Registrar must verify that each teacher has an appropriate load before locking sections for the SY. Overloaded or unassigned teachers cause SF1 errors.

**Content**:
- Table: Teacher name, Assigned subjects, Total minutes/week
- Highlight overloaded teachers (> max hours)
- Filter by grade level

---

### 3.2 Section Coverage Report (Unassigned Subjects Alert)
**Source**: ATLAS `GET /subjects/stats/:schoolId`  
**Why**: Before SY begins, every section must have a teacher assigned for every subject. ATLAS's `unassignedCount` tells the Registrar which subjects have no teacher — a critical pre-SY check.

**Content**:
- Alert banner on Dashboard: "X subjects have no assigned teacher"
- List: Subject name, Grade levels affected
- Link to ATLAS to assign a teacher

---

## Phase 4 — Dashboard Enhancements

### 4.1 Add to Dashboard
The Registrar Dashboard should surface:
- **Pending BOSY confirmations count** (from EnrollPro `/api/bosy/queue`)
- **Pending remedial students count** (from EnrollPro `/api/remedial/pending`)
- **EOSY finalization progress** (X of Y sections finalized)
- **Unassigned subjects count** (from ATLAS `/subjects/stats`)

### 4.2 Data Completeness Alert
Already on dashboard — keep and improve:
- Missing LRN count (from enrolled students in EnrollPro)
- Missing Birthdate count
- Flag these individually in Student Records table

---

## What AIMS Provides the Registrar (Read-Only)
AIMS is primarily a teacher/student LMS. The Registrar has **no write access** to AIMS. However:

- **Gradebook verification**: Before printing SF9, the Registrar can cross-check the student's quarterly average against the AIMS gradebook (`GET /dashboard/course/:id/gradebook`). This is optional — SMART already computes grades from synced data.
- AIMS is NOT integrated into the Registrar workflow beyond this read-only check.

---

## Implementation Order

```
Phase 0 (Bug Fixes) → Phase 1.1 (Application Tracker) → Phase 1.2 (BOSY)
→ Phase 1.3 (Remedial) → Phase 1.4 (Section Roster)
→ Phase 2 (EOSY) → Phase 3 (ATLAS) → Phase 4 (Dashboard Upgrades)
```

---

> ✅ **Review and approve this roadmap before implementation begins.**
