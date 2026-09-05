# EnrollPro Request — SF10 Service Endpoint: Implementation Report

> **Date:** 2026-09-03
> **Request:** Implement service-level SF10 grades endpoint per `SMART_AGENT_INSTRUCTIONS.md` / `docs/ENROLLPRO_SF10_HANDOFF.md` (Section 3, previously PROPOSED).
> **Status:** ✅ Implemented, type-checked (`tsc` clean), test suite passing.

---

## What Was Implemented

### New Endpoints

```
GET /api/integration/smart/students/:studentId/sf10-grades
GET /api/integration/students/:studentId/sf10-grades
```

Previously these URLs fell through to the SPA HTML fallback (200 with HTML), which broke EnrollPro's data fetch. Both are now registered Express routes and return JSON.

### Authentication

- **Service-level API key** via the existing `serviceAuth` middleware (same as `/sync-grades`).
- Validates `X-EnrollPro-API-Key` header against `ENROLLPRO_API_KEY` env var (constant-time compare). Missing/invalid key → `401`.
- No JWT / registrar auth involved.

### Student Lookup (LRN)

- `:studentId` is matched against `Student.lrn` first (LRN is how EnrollPro queries).
- Falls back to SMART internal UUID for robustness.
- Not found → `404 { "success": false, "error": "Student not found" }`.

### Query Parameter

- `?schoolYear=2024-2025` filters `schoolRecords` to that year. Omit → all years.

### Response (200)

Exactly the schema EnrollPro specified:

```json
{
  "success": true,
  "student": {
    "id": "...", "lrn": "...", "firstName": "...", "lastName": "...",
    "middleName": "...", "nameExtension": "...", "gender": "...", "birthDate": "..."
  },
  "schoolRecords": [
    {
      "schoolYear": "2024-2025", "gradeLevel": "GRADE_7", "section": "Aguinaldo",
      "adviserName": "...", "subjectGrades": [ { "subjectCode": "...", "subjectName": "...", "T1": 99, "T2": 100, "T3": 99, "final": 99, "remarks": "Passed" } ],
      "generalAverage": 99, "honors": "...", "promotionStatus": "Promoted"
    }
  ],
  "schoolSettings": { "schoolName": "...", "schoolId": "..." }
}
```

`schoolRecords` additionally carries `program`, `school`, `schoolId`, `district`, `division`, `region`, `remedialClasses` (superset of the required fields — safe for consumers that read only known keys).

---

## How It Was Built

| File | Change |
|---|---|
| `server/src/lib/sf10.ts` | **New** — extracted the ~380-line SF10 permanent-record builder (all-years history, canonical enrollments, GradeSnapshot fallback, rotation merging, honors/promotion computation) out of the registrar route into a shared lib: `buildSf10Records(studentId)` |
| `server/src/routes/integration.ts` | Added `handleStudentSf10Grades` + both route registrations behind `serviceAuth` |
| `server/src/routes/registrar/forms.ts` | `/api/registrar/forms/sf10/:studentId` now delegates to the same `buildSf10Records()` — identical behavior, single source of truth |
| `docs/ENROLLPRO_SF10_HANDOFF.md` | Section 3 marked IMPLEMENTED; `studentId` param documented as LRN (preferred) |

### Behavior (unchanged from the documented SF10 semantics)

- Returns grades across **all JHS school years** (Grades 7–10 history).
- `GradeSnapshot` fallback when `Grade` records were archived/purged.
- Rotation subjects (Science, TLE) merged to single rows.
- `final` = rounded average of available T1/T2/T3; `remarks` = Passed/Failed at 75.
- `honors`: ≥98 Highest, ≥95 High, ≥90 With Honors.
- `promotionStatus`: Promoted if all subject finals ≥75, else Retained.
- Historical queries filter by `schoolYear` string only (no `isActive`/`isArchived`) — prior-year data survives rollover archiving.
- **Read-only** — no writes to grade data, no writes to EnrollPro.

### Verification

- `npm run build` (server): clean.
- `npm test` (vitest): 88 passed / 36 skipped (pre-existing DB-dependent skips).
- Registrar SF10 endpoint regression: same builder, same response shape as before extraction.

---

## EnrollPro Integration Notes

- Send `X-EnrollPro-API-Key` header with every request.
- Query by LRN: `GET {SMART_BASE_URL}/api/integration/students/{lrn}/sf10-grades`.
- `404` means the LRN has no SMART student record.
- Full contract: `docs/ENROLLPRO_SF10_HANDOFF.md`.
