# SMART ↔ EnrollPro ↔ Atlas Data Alignment

SMART is a read-only consumer of EnrollPro and Atlas.  
It only writes **Grades** back to its own database (`smart_db`).

---

## Systems at a Glance

| System | Role | Base URL | Auth |
|---|---|---|---|
| **EnrollPro** | Student enrollment & teacher registry | `https://dev-jegs.buru-degree.ts.net/api` | Admin JWT / Integration v1 (no auth) |
| **Atlas** | Schedule & teaching load management | `http://100.88.55.125:5001/api/v1` | `ATLAS_SYSTEM_TOKEN` |
| **SMART** | Grading, attendance, class records | `http://localhost:5003/api` | SMART JWT |

---

## What SMART Fetches from EnrollPro

### Endpoint: `GET /integration/v1/faculty` (no auth)

Used to: identify the logged-in teacher's advisory assignment.

| EnrollPro Field | Type | → SMART Field | Notes |
|---|---|---|---|
| `teacherId` | `number` | Used to match Atlas `externalId` | EnrollPro's internal teacher integer ID |
| `employeeId` | `string` | `Teacher.employeeId` | DepEd employee ID (e.g. `"3179586"`) |
| `email` | `string` | Used as fallback Atlas match | |
| `isClassAdviser` | `boolean` | Triggers advisory section sync | |
| `advisorySectionId` | `number \| null` | EnrollPro section ID → used to fetch learners | |
| `advisorySectionName` | `string \| null` | `Section.name` | Full section name (e.g. `"BEC 8-3. MAKAKALIKASAN"`) |
| `advisorySectionGradeLevelName` | `string \| null` | Used to derive `Section.gradeLevel` | e.g. `"Grade 8"` → `GRADE_8` |
| `schoolYearId` | `number` | Passed to learner fetch calls | |
| `schoolYearLabel` | `string` | `Section.schoolYear` / `Enrollment.schoolYear` | e.g. `"2026-2027"` |

### Endpoint: `GET /integration/v1/sections/:sectionId/learners` (no auth)

Used to: populate students in advisory + teaching sections.

| EnrollPro Field | Type | → SMART Field | Notes |
|---|---|---|---|
| `learner.lrn` | `string` | `Student.lrn` (**unique key**) | 12-digit LRN |
| `learner.firstName` | `string` | `Student.firstName` | UPPERCASE per DepEd |
| `learner.lastName` | `string` | `Student.lastName` | |
| `learner.middleName` | `string \| null` | `Student.middleName` | |
| `learner.extensionName` | `string \| null` | `Student.suffix` | Jr., Sr., II, III |
| `learner.birthdate` | `string` | `Student.birthDate` | ISO date `"YYYY-MM-DD"` |
| `learner.sex` | `"MALE" \| "FEMALE"` | `Student.gender` | stored as-is |

Each learner also creates/updates an `Enrollment` record:

| Derived | → SMART `Enrollment` Field |
|---|---|
| `student.id` | `studentId` |
| Matching SMART section | `sectionId` |
| `schoolYearLabel` | `schoolYear` |
| `"ENROLLED"` (fixed) | `status` |

### Endpoint: `GET /integration/v1/school-year` (no auth)

| EnrollPro Field | → SMART Use |
|---|---|
| `data.id` | `schoolYearId` passed to other EP calls |
| `data.yearLabel` | `schoolYear` string used in all SMART records |

### Endpoint: `GET /integration/v1/sections` (no auth)

Used to: map Atlas `sectionId` integers back to section names when building class assignments.

| EnrollPro Field | → SMART Use |
|---|---|
| `id` | Matches Atlas `section.id` (they share the same integer IDs) |
| `name` | Used to find `Section.name` in SMART |
| `gradeLevel.name` | Used to derive `Section.gradeLevel` |

---

## What SMART Fetches from Atlas

### Endpoint: `GET /faculty?schoolId=1` 🔒

Used to: find the Atlas-internal faculty ID for the logged-in teacher.

| Atlas Field | Type | → SMART Use | Notes |
|---|---|---|---|
| `id` | `number` | Atlas faculty ID — used to fetch assignments | Atlas-internal ID |
| `externalId` | `number` | **Primary match** — equals EnrollPro `teacherId` | Most reliable match |
| `contactInfo` | `string` | Fallback match via email | May differ from SMART email |
| `firstName` | `string` | Name-based fallback match | |
| `lastName` | `string` | Name-based fallback match | |

**Matching Strategy (in order):**
1. `atlas.externalId === epFaculty.teacherId` ← PRIMARY (integer ID match, always reliable)
2. `atlas.contactInfo.toLowerCase() === teacher.email.toLowerCase()` ← FALLBACK

### Endpoint: `GET /faculty-assignments/:atlasId?schoolYearId=8` 🔒

Used to: determine which subjects the teacher teaches and in which sections.

| Atlas Field | Type | → SMART Field | Notes |
|---|---|---|---|
| `assignments[].subject.code` | `string` | Used to find `Subject.code` | Requires grade-level suffix (see table below) |
| `assignments[].subject.name` | `string` | Reference only | |
| `assignments[].sections[].id` | `number` | Matches EnrollPro section ID | Same ID space as EnrollPro |
| `assignments[].sections[].name` | `string` | Match `Section.name` | Full section name |
| `assignments[].sections[].gradeLevelName` | `string` | Derive `Section.gradeLevel` | e.g. `"Grade 7"` → `GRADE_7` |

Each valid (subject + section) pair creates a `ClassAssignment`:

| Derived | → SMART `ClassAssignment` Field |
|---|---|
| `Teacher.id` | `teacherId` |
| Matched `Subject.id` | `subjectId` |
| Matched `Section.id` | `sectionId` |
| `schoolYearLabel` | `schoolYear` |

### Endpoint: `GET /schools/1/schedules/published/faculty/:atlasId` (no auth)

Used to: get teaching load from the published timetable (if available).

> **Note:** If no published schedule exists (Atlas returns `PUBLISHED_RUN_NOT_FOUND`), SMART falls back to `faculty-assignments` above.

| Atlas Field | → SMART Use |
|---|---|
| `entries[].sectionId` | EnrollPro section ID → look up section name |
| `entries[].subjectCode` | Subject code → apply grade-level suffix |
| `entries[].facultyId` | Confirms this entry belongs to this teacher |

---

## Subject Code Mapping (Atlas → SMART)

Atlas uses base subject codes without grade level. SMART codes include the grade level as suffix.

| Atlas Code | Grade 7 | Grade 8 | Grade 9 | Grade 10 |
|---|---|---|---|---|
| `ENG` | `ENG7` | `ENG8` | `ENG9` | `ENG10` |
| `FIL` | `FIL7` | `FIL8` | `FIL9` | `FIL10` |
| `MATH` | `MATH7` | `MATH8` | `MATH9` | `MATH10` |
| `SCI` | `SCI7` | `SCI8` | `SCI9` | `SCI10` |
| `AP` | `AP7` | `AP8` | `AP9` | `AP10` |
| `TLE` | `TLE7` | `TLE8` | `TLE9` | `TLE10` |
| `MAPEH` | `MAPEH7` | `MAPEH8` | `MAPEH9` | `MAPEH10` |
| `ESP` | `ESP7` | `ESP8` | `ESP9` | `ESP10` |
| `ENVIRONMENTAL_SCIENCE` | `ENVIRONMENTAL_SCIENCE7` | *(n/a)* | *(n/a)* | *(n/a)* |
| `ENV_SCI` | `ENVIRONMENTAL_SCIENCE7` | *(n/a)* | *(n/a)* | *(n/a)* |

**Rule applied in code:** `SMART_CODE = ATLAS_CODE + gradeNumber`  
e.g. `"FIL"` + `"7"` (from `"GRADE_7"`) → `"FIL7"`

Special overrides (different naming between Atlas and SMART):
- `ENV_SCI` → `ENVIRONMENTAL_SCIENCE7`
- `ENVIRONMENTAL_SCIENCE` → `ENVIRONMENTAL_SCIENCE7`

---

## Grade Level Mapping

| EnrollPro / Atlas String | SMART `GradeLevel` enum |
|---|---|
| `"Grade 7"` / `"GRADE_7"` / section name contains `"7"` | `GRADE_7` |
| `"Grade 8"` / `"GRADE_8"` / section name contains `"8"` | `GRADE_8` |
| `"Grade 9"` / `"GRADE_9"` / section name contains `"9"` | `GRADE_9` |
| `"Grade 10"` / `"GRADE_10"` / section name contains `"10"` | `GRADE_10` |

---

## Sync Flow Summary

```
Teacher logs in to SMART
    ↓
syncTeacherOnLogin(smartTeacherId, employeeId, email)
    │
    ├─ [EnrollPro] GET /integration/v1/school-year
    │       → schoolYearId, schoolYearLabel
    │
    ├─ [EnrollPro] GET /integration/v1/faculty → find by employeeId
    │       → epFaculty.teacherId, isClassAdviser, advisorySectionId
    │
    ├─ [If isClassAdviser] GET /integration/v1/sections/:advisorySectionId/learners
    │       → upsert Students + Enrollments in advisory section
    │
    ├─ [Atlas] GET /faculty?schoolId=1
    │       → match by externalId == epFaculty.teacherId (fallback: contactInfo)
    │       → atlasFacultyId
    │
    ├─ [Atlas] GET /faculty-assignments/:atlasFacultyId?schoolYearId=8
    │       → assignments[].subject.code + sections[].name
    │       → upsert ClassAssignments in SMART
    │
    └─ [EnrollPro] GET /integration/v1/sections/:epSectionId/learners
            → for each teaching section in class assignments
            → upsert Students + Enrollments
```

---

## Notes

- **SMART never writes to EnrollPro or Atlas.** Read-only.
- **Atlas section IDs = EnrollPro section IDs** — they share the same integer ID space.
- **Atlas `schoolYearId = 8`** corresponds to `"2026-2027"` in SMART.
- **If EnrollPro shows 0 learners** for a section — that section genuinely has no students enrolled yet. The class ledger will be empty until the registrar processes enrollments in EnrollPro.
- **If Atlas has no published schedule** — SMART falls back to `faculty-assignments` which Atlas updates as the scheduling officer assigns subjects.
