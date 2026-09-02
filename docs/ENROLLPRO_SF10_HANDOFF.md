# EnrollPro ↔ SMART — SF10 Grade Data API Handoff

> **Purpose:** Enable EnrollPro to fetch Term 1, Term 2, Term 3 grades and final averages per student for any school year, for SF10 (Permanent Academic Record) generation.

---

## Authentication

All external endpoints use **service-level API key** authentication via the `serviceAuth` middleware.

| Header | Value |
|--------|-------|
| `X-EnrollPro-API-Key` | `{ENROLLPRO_API_KEY}` |

The key is shared out-of-band. If the header is missing or invalid, the endpoint returns `401`.

```
HTTP/1.1 401 Unauthorized
{ "error": "Unauthorized" }
```

> **Note:** If the `ENROLLPRO_API_KEY` env var is not set on the SMART server, auth is bypassed (open access). This is a dev convenience — production must have it set.

---

## Base URL

```
{SMART_BASE_URL}/api/integration
```

---

## Endpoints

### 1. Per-Section Grade Sync (EXISTING)

Pulls **finalized** grades for all students in a section for a given school year. Already in production — EnrollPro uses this during EOSY.

```
POST /api/integration/smart/sections/:sectionId/sync-grades
POST /api/integration/sections/:sectionId/sync-grades
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `sectionId` | string | Yes | Section ID or section name (case-insensitive) |
| `schoolYear` | query | No | e.g. `2025-2026`. Defaults to active school year. |

#### Response — 200

```json
{
  "success": true,
  "ready": true,
  "sectionId": "clxyz...",
  "sectionName": "Aguinaldo",
  "gradeLevel": "GRADE_7",
  "program": "REGULAR",
  "schoolYear": "2026-2027",
  "adviser": "Dela Cruz Juan",
  "outcomesSynced": 45,
  "publishedAt": "2026-03-15T00:00:00.000Z",
  "outcomes": [
    {
      "lrn": "202600000016",
      "studentName": "Gomez Angelo Rafael",
      "subjectGrades": [
        {
          "subjectCode": "FIL7",
          "subjectName": "Filipino",
          "teacher": "Santos Maria",
          "T1": 99,
          "T2": 100,
          "T3": 99,
          "isNonPromotional": false,
          "final": 99,
          "remarks": "Passed"
        }
      ],
      "generalAverage": 99,
      "remarks": "Passed",
      "promotionStatus": "Promoted",
      "publishedAt": "2026-03-15T00:00:00.000Z"
    }
  ]
}
```

#### Response — 404

```json
{ "success": false, "error": "Section not found for school year 2025-2026" }
```

#### Behavior Notes

- Only returns grades with `status: FINALIZED`. Draft/locked grades are excluded.
- `subjectGrades` are merged using rotation logic (Science/TLE sub-subjects collapse to single rows).
- `final` = average of available term grades (not transmuted).
- `ready` = `true` only when all student grades in the section are finalized.
- `schoolYear` resolves to active year if omitted and the section doesn't exist for the default year, a 404 is returned.

---

### 2. Per-Student SF10 Data (EXISTING — REGISTRAR JWT only)

Returns **all historical grades** (all school years) for a single student. This is the SF10 permanent record endpoint.

```
GET /api/registrar/forms/sf10/:studentId
```

> ⚠️ **This endpoint currently requires REGISTRAR JWT auth** — not service-level API key. A new service-level endpoint is proposed below to expose this data to EnrollPro.

#### Response — 200

```json
{
  "student": {
    "id": "clxyz...",
    "lrn": "202600000016",
    "name": "Gomez, Angelo Rafael Domingo",
    "firstName": "Angelo Rafael",
    "lastName": "Gomez",
    "middleName": "Domingo",
    "nameExtension": "",
    "gender": "Male",
    "birthDate": "2013-12-31T00:00:00.000Z",
    "address": "...",
    "guardianName": "...",
    "guardianContact": "..."
  },
  "schoolRecords": [
    {
      "schoolYear": "2024-2025",
      "gradeLevel": "GRADE_7",
      "section": "Aguinaldo",
      "program": "REGULAR",
      "school": "Hinigaran National High School",
      "schoolId": "123456",
      "district": "...",
      "division": "...",
      "region": "...",
      "adviserName": "Dela Cruz Juan",
      "subjectGrades": [
        {
          "subjectCode": "FIL7",
          "subjectName": "Filipino",
          "T1": 99,
          "T2": 100,
          "T3": 99,
          "final": 99,
          "remarks": "Passed"
        }
      ],
      "generalAverage": 99,
      "honors": "With Highest Honors",
      "promotionStatus": "Promoted",
      "remedialClasses": []
    },
    {
      "schoolYear": "2025-2026",
      "gradeLevel": "GRADE_8",
      "section": "Mabini",
      "subjectGrades": [ "..." ],
      "generalAverage": 97,
      "honors": "With High Honors",
      "promotionStatus": "Promoted"
    }
  ],
  "schoolSettings": {
    "schoolName": "Hinigaran National High School",
    "schoolId": "123456",
    "division": "...",
    "region": "..."
  }
}
```

#### Behavior Notes

- Returns grades across **all JHS school years** the student was enrolled in (Grade 7–10 range based on current grade level).
- Falls back to `GradeSnapshot` table if `Grade` records were archived/deleted.
- Rotation subjects (Science, TLE) are merged into single rows.
- `final` = average of available `T1/T2/T3` values (rounded to nearest integer).
- `honors` = computed from `generalAverage` (≥98 Highest, ≥95 High, ≥90 Honors).
- `promotionStatus` = "Promoted" if all subject finals ≥75, else "Retained".

---

## New Endpoint (PROPOSED)

To give EnrollPro service-level access to per-student SF10 data, add this endpoint to `server/src/routes/integration.ts`:

### 3. Student SF10 Grades — Service Auth

```
GET /api/integration/smart/students/:studentId/sf10-grades
GET /api/integration/students/:studentId/sf10-grades
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `studentId` | string | Yes | SMART student ID |
| `schoolYear` | query | No | Filter to a specific year. Omit for all years. |

**Auth:** `serviceAuth` (X-EnrollPro-API-Key header)

#### Response — 200

```json
{
  "success": true,
  "student": {
    "id": "clxyz...",
    "lrn": "202600000016",
    "firstName": "Angelo Rafael",
    "lastName": "Gomez",
    "middleName": "Domingo",
    "nameExtension": "",
    "gender": "Male",
    "birthDate": "2013-12-31T00:00:00.000Z"
  },
  "schoolRecords": [
    {
      "schoolYear": "2024-2025",
      "gradeLevel": "GRADE_7",
      "section": "Aguinaldo",
      "adviserName": "Dela Cruz Juan",
      "subjectGrades": [
        {
          "subjectCode": "FIL7",
          "subjectName": "Filipino",
          "T1": 99,
          "T2": 100,
          "T3": 99,
          "final": 99,
          "remarks": "Passed"
        }
      ],
      "generalAverage": 99,
      "honors": "With Highest Honors",
      "promotionStatus": "Promoted"
    }
  ],
  "schoolSettings": {
    "schoolName": "Hinigaran National High School",
    "schoolId": "123456"
  }
}
```

#### Response — 404

```json
{ "success": false, "error": "Student not found" }
```

---

## Lookup Endpoints

### 4. List Sections (for discovering sectionId)

```
GET /api/integration/smart/sections?schoolYear=2025-2026
```

**Auth:** `serviceAuth`

#### Response — 200

```json
{
  "success": true,
  "sections": [
    {
      "id": "clxyz...",
      "name": "Aguinaldo",
      "gradeLevel": "GRADE_7",
      "program": "REGULAR",
      "schoolYear": "2025-2026",
      "adviser": "Dela Cruz Juan",
      "studentCount": 45
    }
  ]
}
```

### 5. List Students in a Section

```
GET /api/integration/smart/sections/:sectionId/students?schoolYear=2025-2026
```

**Auth:** `serviceAuth`

#### Response — 200

```json
{
  "success": true,
  "section": { "id": "...", "name": "Aguinaldo", "gradeLevel": "GRADE_7" },
  "students": [
    {
      "id": "clxyz...",
      "lrn": "202600000016",
      "firstName": "Angelo Rafael",
      "lastName": "Gomez",
      "middleName": "Domingo"
    }
  ]
}
```

### 6. Search Students

```
GET /api/integration/smart/students?search=Gomez&schoolYear=2025-2026
```

**Auth:** `serviceAuth`

#### Response — 200

```json
{
  "success": true,
  "students": [
    {
      "id": "clxyz...",
      "lrn": "202600000016",
      "firstName": "Angelo Rafael",
      "lastName": "Gomez",
      "middleName": "Domingo",
      "gradeLevel": "GRADE_7",
      "section": "Aguinaldo",
      "schoolYear": "2025-2026"
    }
  ]
}
```

---

## Data Model Reference

### How Grades Are Stored

```
SchoolYear (label: "2025-2026")
  └── Section (name, gradeLevel, schoolYear)
        └── Enrollment (studentId, sectionId, schoolYear, status)
        └── ClassAssignment (teacherId, subjectId, sectionId, schoolYear)
              └── Grade (studentId, classAssignmentId, term: T1|T2|T3)
                    └── quarterlyGrade: Float  ← THE GRADE VALUE
```

**Key rules:**
- One `Grade` row per **student + class assignment + term**. Unique constraint: `[studentId, classAssignmentId, term]`.
- School year is on `ClassAssignment`, NOT on `Grade`. Join through `classAssignment.schoolYear`.
- `quarterlyGrade` is the computed final grade after applying component weights (Written Work + Performance Task + Quarterly Assessment).
- Rotation subjects (Science, TLE) have `rotationTermGroupId` and `rotationTermRank` (1=T1, 2=T2, 3=T3) indicating which term they appear in.

### Grade Status Lifecycle

```
DRAFT → FINALIZED (by registrar) → LOCKED (by system)
```

- The sync-grades endpoint only returns `FINALIZED` grades.
- The SF10 endpoint returns all grades regardless of status.

### Term Enum

```
T1  — Term 1 / Quarterly 1
T2  — Term 2 / Quarterly 2
T3  — Term 3 / Quarterly 3
```

### Passing Grade

- **75** is the minimum passing grade (DepEd standard).
- `remarks` = `"Passed"` if final ≥ 75, else `"Failed"`.

---

## Sample Integration Flow

### EnrollPro fetching grades for SF10 generation:

```
1. POST /api/integration/smart/sections/{sectionId}/sync-grades?schoolYear=2025-2026
   → Get all students + T1/T2/T3/final per subject for one section+year

2. (Or) GET /api/integration/students/{studentId}/sf10-grades?schoolYear=2025-2026
   → Get all historical grades for one student across years
```

### EnrollPro discovering available data:

```
1. GET /api/integration/smart/sections?schoolYear=2025-2026
   → List all sections for a school year

2. GET /api/integration/smart/sections/{sectionId}/students?schoolYear=2025-2026
   → List all students in a section

3. GET /api/integration/smart/students?search=Gomez
   → Search students by name
```

---

## Error Codes

| Status | Meaning |
|--------|---------|
| `401` | Missing or invalid `X-EnrollPro-API-Key` header |
| `404` | Section, student, or school year not found |
| `500` | Internal server error |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ENROLLPRO_API_KEY` | Shared API key for service-level auth. Must be set in production. |
| `SMART_BASE_URL` | Base URL of the SMART backend (e.g. `https://smart.school.gov.ph`) |

---

## Implementation Notes

- **READ-ONLY:** EnrollPro should never write to SMART. All endpoints are GET/POST with no side effects on grade data.
- **Historical data:** The SF10 endpoint and grade queries do NOT filter by `isActive` on `ClassAssignment` — this is intentional so prior-year data survives rollover archiving.
- **Snapshot fallback:** If `Grade` records are missing (purged/archived), the SF10 endpoint falls back to `GradeSnapshot` table.
- **Rotation merging:** Science and TLE sub-subjects are collapsed into single rows using `mergeRotationSubjects()` from `server/src/lib/promotion.ts`.
- **Rate limiting:** All `/api` routes are subject to `globalLimiter` middleware.

---

## Files Reference

| File | Purpose |
|------|---------|
| `server/src/routes/integration.ts` | External integration endpoints (sync-grades, status) |
| `server/src/routes/registrar/forms.ts` | SF10 endpoint (line 624) |
| `server/src/middleware/serviceAuth.ts` | API key auth middleware |
| `server/src/lib/promotion.ts` | Grade merging, rotation logic, promotion evaluation |
| `server/src/lib/schoolYearResolver.ts` | Active school year resolution |
| `server/prisma/schema.prisma` | Database schema (Grade, ClassAssignment, Student, etc.) |
