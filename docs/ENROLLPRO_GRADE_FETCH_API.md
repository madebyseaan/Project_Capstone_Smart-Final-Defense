# SMART → EnrollPro: Finalized EOSY Grades API

## Purpose

This API allows EnrollPro to fetch **finalized End-of-School-Year (EOSY) grades** from SMART. It returns per-student quarterly grades, computed final ratings, general averages, remarks, and promotion status for all enrolled students in a given section.

SMART is the source of truth for finalized grades. This is the only data SMART sends to EnrollPro — all other data (student profiles, sections, programs) originates from EnrollPro.

---

## Endpoint

```
POST /api/integration/smart/sections/{sectionId}/sync-grades
POST /api/integration/sections/{sectionId}/sync-grades
```

Both paths are identical aliases.

### Path Parameters

| Parameter   | Type   | Required | Description                                                    |
|-------------|--------|----------|----------------------------------------------------------------|
| `sectionId` | string | Yes      | SMART section ID **or** section name (case-insensitive match). |

### Query Parameters

| Parameter    | Type   | Required | Description                                                        |
|--------------|--------|----------|--------------------------------------------------------------------|
| `schoolYear` | string | No       | School year label (e.g. `"2025-2026"`). Defaults to active year. |

### Request Example

```bash
curl -X POST \
  "https://smart.example.com/api/integration/smart/sections/10-Aurelio/sync-grades?schoolYear=2025-2026" \
  -H "Content-Type: application/json" \
  -H "x-enrollpro-api-key: YOUR_API_KEY"
```

---

## Authentication

This endpoint requires a service-level API key passed via the `x-enrollpro-api-key` request header.

| Header              | Type   | Required | Description                           |
|---------------------|--------|----------|---------------------------------------|
| `x-enrollpro-api-key` | string | Yes*   | EnrollPro service API key.           |

*If the `ENROLLPRO_API_KEY` environment variable is not set on the SMART server, the header check is skipped (development mode). In production, the header is **mandatory**.

**Error responses:**
- `401 Unauthorized` — missing or invalid API key.

**Key coordination:** The API key value is set via the `ENROLLPRO_API_KEY` environment variable on the SMART server. Coordinate the shared secret with the EnrollPro team before deploying to production. The header name is `x-enrollpro-api-key` (lowercase, hyphenated).

---

## Response Schema

### Top-Level Response (`200 OK`)

```json
{
  "success": true,
  "ready": true,
  "sectionId": "clxyz123...",
  "sectionName": "10-Aurelio",
  "gradeLevel": 10,
  "program": "REGULAR",
  "schoolYear": "2025-2026",
  "adviser": "Juan Dela Cruz",
  "outcomesSynced": 45,
  "outcomes": []
}
```

| Field            | Type    | Description                                                  |
|------------------|---------|--------------------------------------------------------------|
| `success`        | boolean | Always `true` on success.                                    |
| `ready`          | boolean | Always `true` — grades are available.                        |
| `sectionId`      | string  | Resolved internal section ID.                                |
| `sectionName`    | string  | Human-readable section name.                                 |
| `gradeLevel`     | number  | Grade level (7–10).                                          |
| `program`        | string  | `"REGULAR"`, `"SPA"`, `"SPS"`, or `"STE"`.                 |
| `schoolYear`     | string  | Resolved school year label.                                  |
| `adviser`        | string  | Section adviser full name, or `null`.                       |
| `outcomesSynced` | number  | Total enrolled students returned.                            |
| `outcomes`       | array   | Per-student grade outcomes (see below).                      |

---

### `outcomes[]` — Per-Student

```json
{
  "lrn": "123456789012",
  "studentName": "Dela Cruz, Juan",
  "subjectGrades": [],
  "generalAverage": 88,
  "remarks": "Passed",
  "promotionStatus": "Promoted"
}
```

| Field             | Type              | Description                                                       |
|-------------------|-------------------|-------------------------------------------------------------------|
| `lrn`             | string            | Learner Reference Number.                                         |
| `studentName`     | string            | `"LastName, FirstName"` format.                                   |
| `subjectGrades`   | array             | Per-subject grade objects (see below). Sorted by `subjectName`.   |
| `generalAverage`  | number \| null    | Average of all `finalRating` values. `null` if no grades exist.  |
| `remarks`         | string \| null    | `"Passed"` (≥75) or `"Failed"` (<75). `null` if no grades.      |
| `promotionStatus` | string \| null    | `"Promoted"`, `"Retained"`, or `null`.                           |

---

### `subjectGrades[]` — Per-Subject

```json
{
  "subjectCode": "ENG",
  "subjectName": "English",
  "teacher": "Maria Santos",
  "T1": 85,
  "T2": 88,
  "T3": 90,
  "finalRating": 88,
  "remarks": "Passed",
  "status": "GRADED"
}
```

| Field         | Type           | Description                                                             |
|---------------|----------------|-------------------------------------------------------------------------|
| `subjectCode` | string         | Subject code (e.g. `"ENG"`, `"MATH"`, `"SCI"`).                       |
| `subjectName` | string         | Full subject name.                                                      |
| `teacher`     | string         | Assigned teacher's full name.                                           |
| `T1`          | number \| null | Quarter 1 grade (0–100). `null` if not finalized.                     |
| `T2`          | number \| null | Quarter 2 grade.                                                       |
| `T3`          | number \| null | Quarter 3 grade.                                                       |
| `finalRating` | number \| null | Average of available terms (rounded to nearest integer).               |
| `remarks`     | string \| null | `"Passed"` (≥75) or `"Failed"` (<75).                                |
| `status`      | string         | `"GRADED"` (3 terms), `"PARTIAL"` (1–2 terms), `"NG"` (no grades).   |

---

## Grade Status Lifecycle

Every grade in SMART has a `status` field that controls what EnrollPro can see:

```
┌─────────┐      Teacher submits       ┌───────┐     Registrar clicks      ┌────────────┐
│  (none)  │  ──────────────────────►  │ DRAFT  │  ──── "Finalize" ────►  │ FINALIZED  │
└─────────┘                            └───────┘                          └────────────┘
                                            ▲                                  │
                                            │      Registrar clicks           │
                                            └──────── "Unfinalize" ◄─────────┘
```

| Status      | Description                                                | Visible to EnrollPro |
|-------------|------------------------------------------------------------|----------------------|
| `DRAFT`     | Teacher has submitted grades. Not yet locked by registrar. | **No**               |
| `FINALIZED` | Registrar has locked grades. Immutable until unfinalized.  | **Yes**              |

### Key Rules

1. **Only `FINALIZED` grades are returned** by the sync endpoint. `DRAFT` grades are excluded from the query entirely.
2. **Unfinalizing reverts to `DRAFT`** — once unfinalized, grades disappear from EnrollPro's view on the next fetch.
3. **Registrar controls finalization** — only users with the `REGISTRAR` role can finalize or unfinalize grades.
4. **Grade lock** — when the admin enables `gradeLock` (EOSY lock), teachers cannot edit any grades, but the registrar can still finalize/unfinalize.

---

## Computation Logic

### Final Rating (per subject)

```
finalRating = round(average of all non-null terms: T1, T2, T3)
```

| Terms Available | `status`    |
|-----------------|-------------|
| 3               | `"GRADED"`  |
| 1–2             | `"PARTIAL"` |
| 0               | `"NG"`      |

### General Average (per student)

```
generalAverage = round(average of all non-null finalRating values across subjects)
```

`null` if no subjects have a `finalRating`.

### Remarks

| Condition             | `remarks`   |
|-----------------------|-------------|
| `value >= 75`         | `"Passed"`  |
| `value < 75`          | `"Failed"`  |
| `value is null`       | `null`      |

Applies at both subject and student level.

### Promotion Status

| Condition                                                    | `promotionStatus` |
|--------------------------------------------------------------|--------------------|
| `generalAverage ≥ 75` AND no subject `finalRating < 75`     | `"Promoted"`       |
| Any subject `finalRating < 75` (and `generalAverage` set)   | `"Retained"`       |
| `generalAverage is null`                                     | `null`             |

---

## Behavior Notes

### What Gets Returned

- Only `FINALIZED` grades. `DRAFT` grades are invisible to this endpoint.
- Homeroom Guidance subjects (code starts with `"HG"`) are excluded.
- Duplicate subjects (same code + name across multiple teachers) are merged into a single row.
- `program` is included from the local section record (originally synced from EnrollPro).

### What Does NOT Get Returned

- Student personal data beyond LRN and name.
- Attendance records.
- Individual assessment scores (written work, performance tasks, quarterly assessments).
- Only the computed `quarterlyGrade` per term is included.

### Section Lookup

- `sectionId` accepts the SMART internal ID **or** the section name.
- Name matching is case-insensitive: `"10-Aurelio"`, `"10-aurelio"`, `"10-AURELIO"` all resolve identically.

### School Year Resolution

- If `?schoolYear=2025-2026` is provided, uses that value.
- Otherwise, defaults to the active school year in SMART's system settings.

### Timing

- EnrollPro should call this endpoint **after** the registrar has finalized grades for the section.
- If some subjects are still `DRAFT`, they appear with `status: "NG"` and `finalRating: null`.

---

## Error Responses

| HTTP Status | Condition                   | Response                                                    |
|-------------|-----------------------------|-------------------------------------------------------------|
| `200`       | Success                     | JSON with `outcomes[]` array.                               |
| `404`       | Section not found           | `{ "success": false, "error": "Section not found..." }`    |
| `500`       | Internal server error       | `{ "success": false, "error": "Failed to sync grades" }`   |

---

## Complete Example

### Request

```bash
curl -X POST \
  "https://smart.example.com/api/integration/smart/sections/10-Aurelio/sync-grades?schoolYear=2025-2026" \
  -H "Content-Type: application/json"
```

### Response

```json
{
  "success": true,
  "ready": true,
  "sectionId": "clxyz123abc",
  "sectionName": "10-Aurelio",
  "gradeLevel": 10,
  "program": "REGULAR",
  "schoolYear": "2025-2026",
  "adviser": "Juan Dela Cruz",
  "outcomesSynced": 45,
  "outcomes": [
    {
      "lrn": "123456789012",
      "studentName": "Dela Cruz, Juan",
      "subjectGrades": [
        {
          "subjectCode": "ENG",
          "subjectName": "English",
          "teacher": "Maria Santos",
          "T1": 85,
          "T2": 88,
          "T3": 90,
          "finalRating": 88,
          "remarks": "Passed",
          "status": "GRADED"
        },
        {
          "subjectCode": "MATH",
          "subjectName": "Mathematics",
          "teacher": "Pedro Reyes",
          "T1": 72,
          "T2": 70,
          "T3": 74,
          "finalRating": 72,
          "remarks": "Failed",
          "status": "GRADED"
        }
      ],
      "generalAverage": 80,
      "remarks": "Passed",
      "promotionStatus": "Retained"
    }
  ]
}
```

---

## Data Flow Summary

```
Teacher submits grades          Grade.status = DRAFT
                                       │
                                       ▼
Registrar finalizes grades       Grade.status = FINALIZED
                                       │
                                       ▼
EnrollPro calls sync endpoint    Only FINALIZED grades returned
                                       │
                                       ▼
Registrar unfinalizes (optional) Grade.status = DRAFT (hidden from EnrollPro)
```

**SMART only sends finalized grades. All other data originates from EnrollPro.**
