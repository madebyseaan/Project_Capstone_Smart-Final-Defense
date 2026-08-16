# SMART ↔ EnrollPro Grade Integration Guide

> **For:** EnrollPro Team
> **Date:** August 15, 2026
> **Purpose:** How to pull final student grades from SMART via API

---

## Overview

SMART exposes final grades via a REST API endpoint. EnrollPro calls this endpoint to fetch:

- Per-subject final ratings (averaged from available terms T1/T2/T3)
- General average across all subjects
- Remarks (Passed/Failed)
- Promotion status (Promoted/Retained)

**This is a READ-ONLY pull.** SMART never writes to EnrollPro.

---

## API Endpoint

### `POST /api/integration/sections/:sectionId/sync-grades`

Pull final grades for all students in a specific section.

### Authentication

```
Header: x-api-key: <your-webhook-key>
```

The API key is the same `ENROLLPRO_WEBHOOK_KEY` used for webhooks. If you don't have it, ask the SMART admin.

### Request

```
POST https://<smart-server>/api/integration/sections/{sectionId}/sync-grades?schoolYear=2026-2027
Header: x-api-key: your-api-key-here
```

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `sectionId` | string (URL) | Yes | Section database ID or section name |
| `schoolYear` | string (query) | No | Defaults to current school year (2026-2027) |

**The `sectionId` accepts:**
- Database ID: `cmstrjq4301jjoove28e4tisk`
- Section name: `Makatao`, `Pearl`, `Orchid`, etc.

### Response

```json
{
  "success": true,
  "ready": true,
  "sectionId": "cmstrjq4301jjoove28e4tisk",
  "sectionName": "Makatao",
  "gradeLevel": "GRADE_8",
  "schoolYear": "2026-2027",
  "adviser": "Maria Angela Aquino",
  "outcomesSynced": 4,
  "outcomes": [
    {
      "lrn": "100000000027",
      "studentName": "SANTOS, HANNAH THERESE",
      "subjectGrades": [
        {
          "subjectCode": "MATH8",
          "subjectName": "Mathematics 8",
          "teacher": "Maria Angela Aquino",
          "T1": null,
          "T2": null,
          "T3": null,
          "finalRating": null,
          "remarks": null,
          "status": "NG"
        },
        {
          "subjectCode": "FIL8",
          "subjectName": "Filipino 8",
          "teacher": "Carlo Miguel Aguilar",
          "T1": 77,
          "T2": 79,
          "T3": 75,
          "finalRating": 77,
          "remarks": "Passed",
          "status": "GRADED"
        },
        {
          "subjectCode": "SCI8",
          "subjectName": "Science 8",
          "teacher": "Jose Gabriel Mendoza",
          "T1": 78,
          "T2": 76,
          "T3": 81,
          "finalRating": 78,
          "remarks": "Passed"
        }
      ],
      "generalAverage": 77,
      "remarks": "Passed",
      "promotionStatus": "Promoted"
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `sectionId` | string | SMART section ID |
| `sectionName` | string | Section name (e.g., "Makatao") |
| `gradeLevel` | string | GRADE_7, GRADE_8, GRADE_9, or GRADE_10 |
| `schoolYear` | string | e.g., "2026-2027" |
| `adviser` | string | Advisory teacher name |
| `outcomesSynced` | number | Number of students returned |
| `outcomes[]` | array | Student grade records |

#### Per Student (`outcomes[]`)

| Field | Type | Description |
|-------|------|-------------|
| `lrn` | string | Student LRN |
| `studentName` | string | "LASTNAME, FIRSTNAME" |
| `subjectGrades[]` | array | Per-subject grade breakdown |
| `generalAverage` | number \| null | Average of all subject final ratings |
| `remarks` | string \| null | "Passed" (≥75) or "Failed" (<75) |
| `promotionStatus` | string \| null | "Promoted" or "Retained" |

#### Per Subject (`subjectGrades[]`)

| Field | Type | Description |
|-------|------|-------------|
| `subjectCode` | string | e.g., "MATH8", "FIL8", "SCI8" |
| `subjectName` | string | e.g., "Mathematics 8" |
| `teacher` | string | Subject teacher name |
| `T1` | number \| null | Quarter 1 grade (null = not yet graded) |
| `T2` | number \| null | Quarter 2 grade |
| `T3` | number \| null | Quarter 3 grade |
| `finalRating` | number \| null | Average of available T1/T2/T3 |
| `remarks` | string \| null | "Passed" (≥75) or "Failed" (<75) |
| `status` | string | `"GRADED"` (all 3 terms), `"PARTIAL"` (1-2 terms), or `"NG"` (no grades) |

**Status values:**
- `"GRADED"` — All 3 terms have grades. Final rating is computed.
- `"PARTIAL"` — Only 1 or 2 terms have grades. Final rating is averaged from available terms.
- `"NG"` (No Grade) — No grades entered for any term. Final rating is null. Exclude from general average.

---

## How Final Rating is Computed

The final rating is the **average of available terms**. It does NOT require all 3 terms.

| Scenario | T1 | T2 | T3 | Final Rating |
|----------|----|----|----|----|
| All terms present | 76 | 78 | 79 | 78 |
| T1 missing | - | 76 | 74 | 75 |
| T3 missing | 80 | 77 | - | 79 |
| Only T1 present | 85 | - | - | 85 |
| No grades | - | - | - | null |

**General Average** = Average of all subject final ratings (subjects with `status: "NG"` are excluded).

**Promotion Status:**
- `Promoted` — all graded subjects ≥ 75
- `Retained` — any graded subject < 75
- `null` — no grades available yet

---

## Example: Pulling All Sections

To get grades for all sections, loop through section IDs:

```bash
# Get all sections first (requires admin token)
GET /api/admin/class-assignments?schoolYear=2026-2027

# Then pull grades for each section
POST /api/integration/sections/{sectionId}/sync-grades
Header: x-api-key: YOUR_KEY
```

---

## Troubleshooting

### 401 Unauthorized
- Check that `x-api-key` header is set correctly
- The key must match `ENROLLPRO_WEBHOOK_KEY` on the SMART server

### 404 Section not found
- Verify the section ID or name is correct
- Make sure the `schoolYear` query param matches (defaults to current year)
- Section names are case-insensitive

### Empty outcomes (0 students)
- The section exists but has no enrolled students
- Check that students are synced from EnrollPro first (sync must run before grades are available)

### null finalRating for a student
- Check the `status` field on the subject
- If `status: "NG"` — the student has no grades for this subject (teacher hasn't entered them yet)
- If `status: "PARTIAL"` — only some terms are graded, finalRating is averaged from available terms
- If `status: "GRADED"` — all terms are graded, finalRating should not be null

### generalAverage is null
- The student has no grades in any subject yet
- General average is only computed when at least one subject has a final rating

---

## Available Sections (School Year 2026-2027)

| Grade Level | Section Name | Students |
|-------------|-------------|----------|
| GRADE_7 | Diamond | 4 |
| GRADE_7 | Section A | 4 |
| GRADE_8 | Makatao | 4 |
| GRADE_8 | Makabansa | 4 |
| GRADE_8 | Matapat | 4 |
| GRADE_9 | Orchid | 4 |
| GRADE_9 | Rose | 4 |
| GRADE_9 | Sunflower | 4 |
| GRADE_10 | Pearl | 4 |
| GRADE_10 | Diamond | 4 |

> Note: Section count and student count may vary after sync. Run the seed script to refresh.

---

## Test Data — Edge Cases

SMART has seeded test data with various scenarios for testing. Here are the students with edge cases:

### Section: GRADE_8 — Makatao (test section)

| Student | LRN | Subject | Scenario | What it means |
|---------|-----|---------|----------|---------------|
| HANNAH THERESE SANTOS | 100000000027 | Math | EMPTY_SCORES | No grades entered — all null |
| GABRIELA LUZ VALDEZ | 100000000026 | Math | MISSING_T3 | T3 not graded yet |
| VINCENT LORENZO SANTOS | 100000000025 | Math | FAILING | Scored 60 (below 75) |
| GABRIEL ENZO VALDEZ | 100000000024 | Math | PARTIAL_WW_ONLY | Only written work scores entered |

### Other sections (edge cases in Math only)

| Student | LRN | Section | Scenario |
|---------|-----|---------|----------|
| JOHN PAOLO AQUINO | 100000000072 | Pearl (Grade 10) | MISSING_T1 — no T1 grade |
| MIGUEL ANDRE VILLANUEVA | 100000000073 | Pearl (Grade 10) | MISSING_T3 — no T3 grade |
| JANELLA MARIE AQUINO | 100000000074 | Pearl (Grade 10) | FAILING — scored 60 |

### What you'll see in the API response

| Scenario | T1 | T2 | T3 | finalRating | status | remarks |
|----------|----|----|----|-------------|--------|---------|
| EMPTY_SCORES | null | null | null | null | "NG" | null |
| MISSING_T3 | 75 | 72 | null | 74 | "PARTIAL" | "Failed" |
| MISSING_T1 | null | 77 | 73 | 75 | "PARTIAL" | "Passed" |
| FAILING | 60 | 60 | 60 | 60 | "GRADED" | "Failed" |
| COMPLETE | 76 | 78 | 79 | 78 | "GRADED" | "Passed" |

---

## Quick Start (Copy-Paste for Testing)

```bash
# 1. Pull grades for Makatao section (Grade 8)
curl -X POST "http://localhost:5003/api/integration/sections/Makatao/sync-grades?schoolYear=2026-2027" \
  -H "x-api-key: YOUR_WEBHOOK_KEY" \
  -H "Content-Type: application/json"

# 2. Pull grades for Pearl section (Grade 10)
curl -X POST "http://localhost:5003/api/integration/sections/Pearl/sync-grades?schoolYear=2026-2027" \
  -H "x-api-key: YOUR_WEBHOOK_KEY" \
  -H "Content-Type: application/json"

# 3. Pull grades for a specific section by ID
curl -X POST "http://localhost:5003/api/integration/sections/cmstrjq4301jjoove28e4tisk/sync-grades?schoolYear=2026-2027" \
  -H "x-api-key: YOUR_WEBHOOK_KEY" \
  -H "Content-Type: application/json"
```

---

## Notes

- **School year** defaults to `2026-2027` if not specified
- **Homeroom Guidance** subjects are excluded from the response (they use qualitative descriptors, not numeric grades)
- **Rotation subjects** (e.g., Science split into Bio/Chem/EarthSci) are merged into a single row
- The endpoint is **unauthenticated** (no JWT required) — only the `x-api-key` header is needed
- Grades are **real-time** — once a teacher saves a grade, it's immediately available via this endpoint

---

*Generated by SMART Capstone Project — August 2026*
