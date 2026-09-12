# EnrollPro ↔ SMART — Back-Subjects Fetch Handoff

> **For:** EnrollPro team / AI agent
> **From:** SMART team
> **Date:** 2026-09-12
> **Re:** Fetching conditionally-promoted learners and their back-subjects from SMART
> **Direction:** SMART serves → EnrollPro fetches (read-only)
> **Status:** Contract specified below. SMART is implementing this endpoint to this exact shape — EnrollPro can build the client against it in parallel.

---

## 1. What this is for

EnrollPro needs the **back-subjects** (a.k.a. remedial / deficiency) data for every
conditionally-promoted JHS learner so it can drive its `REMEDIAL_HOLD` flow and
release learners once remedial is resolved.

SMART is the source of truth for remedial records:
- It computes failing subjects from its own **FINALIZED** grades.
- The registrar encodes the **Remedial Class Mark (RCM)** per subject.
- SMART computes the **Recomputed Final Grade (RFG)** and the per-subject outcome.
- These records are **SMART-local** — SMART never writes remedial data back to EnrollPro.

This is the same shape of data shown in the SMART Registrar → **Remedial** page
(learner, grade/section, failed subjects, final rating, RCM, RFG, outcome).

This endpoint is the reciprocal of SMART pulling EnrollPro's `/remedial/pending`
feed: EnrollPro tells SMART who is conditionally promoted; SMART tells EnrollPro
the back-subjects and their resolution status.

---

## 2. Matching, identity, and scope

- **Match on `lrn` only.** Never on name. Names can collide or change.
- One learner appears once per `schoolYear`, with a `backSubjects[]` array
  (one entry per failed learning area).
- **`schoolYear` is the remedial year** — the year in which the remedial class is
  being conducted (the newly promoted year), e.g. `2030-2031`.
- The **source year** in which the subject was failed is `schoolYear - 1` and is
  returned as `failedSchoolYear`.
- `originalGrade` is the learner's final rating **from the source year**.
- `gradeLevel` on each back-subject is the grade level **at which the subject was
  failed** (source year), not the learner's current grade.

---

## 3. Business rules (SMART computes these — do not recompute on your side)

| Rule | Value |
|---|---|
| Passing grade | `75` |
| Failing subject | FINALIZED final rating `< 75` (final = average of T1–T3 per subject) |
| 1–2 failing subjects | `CONDITIONALLY_PROMOTED` → remedial track, **appears in this feed** |
| 3+ failing subjects | `RETAINED` → repeats the grade level, **does not appear in this feed** |
| Remedial Class Mark (RCM) | integer `60`–`100`, entered by the SMART registrar |
| Recomputed Final Grade (RFG) | `round(((originalGrade + RCM) / 2) * 10) / 10` |
| Outcome | `PASSED` if `RFG >= 75`, else `FAILED_TUTORIAL` |
| Row status | `PENDING` (RCM not yet encoded) or `COMPLETED` (finalized) |

Wire label for `promotionStatus` (same Title Case strings as `sync-grades`):

| Wire value | SMART internal enum |
|---|---|
| `"Promoted"` | `PROMOTED` |
| `"Conditionally Promoted"` | `CONDITIONALLY_PROMOTED` |
| `"Retained"` | `RETAINED` |
| `"JHS Completer"` | `JHS_COMPLETER` (reserved — currently mapped to `"Promoted"` on `sync-grades`; never present in this feed) |

`gradeLevel` is the Prisma enum string: `GRADE_7` | `GRADE_8` | `GRADE_9` | `GRADE_10`.

---

## 4. Endpoint

```
GET /api/integration/smart/back-subjects?schoolYear={SY}
GET /api/integration/back-subjects?schoolYear={SY}        # alias, same handler
```

### Auth

```
X-EnrollPro-API-Key: <ENROLLPRO_API_KEY>
```

- This is SMART's `serviceAuth` middleware. The header name is
  `X-EnrollPro-API-Key` (hyphenated). This is **different** from the
  `X-Integration-Key` header SMART sends when it calls EnrollPro.
- If SMART's `ENROLLPRO_API_KEY` env var is unset (local dev only), auth is
  bypassed. Production **always** requires the key.
- The key is constant-time compared; wrong/missing key → `401`.

### Query parameters

| Param | Required | Description |
|---|---|---|
| `schoolYear` | No | School year label, e.g. `2030-2031`. Defaults to SMART's active school year. |
| `lrn` | No | Scope to a single learner by LRN. Useful for per-learner polling. |
| `gradeLevel` | No | Filter by the learner's **current** grade level (`GRADE_7`…`GRADE_10`). |
| `page` | No | 1-based. Default `1`. |
| `limit` | No | Default `100`, max `500`. |

---

## 5. Response

```jsonc
{
  "success": true,
  "schoolYear": "2030-2031",
  "failedSchoolYear": "2029-2030",
  "generatedAt": "2031-04-15T01:00:00.000Z",
  "count": 2,
  "meta": { "total": 2, "page": 1, "limit": 100, "totalPages": 1 },
  "learners": [
    {
      "lrn": "202600000016",
      "studentName": "Gomez, Angelo Rafael Domingo",
      "firstName": "Angelo Rafael",
      "middleName": "Domingo",
      "lastName": "Gomez",
      "sex": "MALE",
      "schoolYear": "2030-2031",
      "gradeLevel": "GRADE_10",
      "section": "Pearl",
      "promotionStatus": "Conditionally Promoted",
      "resolved": false,
      "overallOutcome": null,
      "backSubjects": [
        {
          "subjectCode": "TLE10",
          "subjectName": "Technology and Livelihood Education (TLE)",
          "gradeLevel": "GRADE_9",
          "originalGrade": 70,
          "remedialMark": null,
          "recomputedGrade": null,
          "outcome": null,
          "status": "PENDING",
          "conductedFrom": null,
          "conductedTo": null
        }
      ]
    },
    {
      "lrn": "202600000017",
      "studentName": "Jimenez, Christian Paul Perez",
      "firstName": "Christian Paul",
      "middleName": "Perez",
      "lastName": "Jimenez",
      "sex": "MALE",
      "schoolYear": "2030-2031",
      "gradeLevel": "GRADE_10",
      "section": "Pearl",
      "promotionStatus": "Conditionally Promoted",
      "resolved": false,
      "overallOutcome": null,
      "backSubjects": [
        {
          "subjectCode": "MATH10",
          "subjectName": "Mathematics",
          "gradeLevel": "GRADE_9",
          "originalGrade": 71,
          "remedialMark": null,
          "recomputedGrade": null,
          "outcome": null,
          "status": "PENDING",
          "conductedFrom": null,
          "conductedTo": null
        },
        {
          "subjectCode": "SCI10",
          "subjectName": "Science",
          "gradeLevel": "GRADE_9",
          "originalGrade": 72,
          "remedialMark": null,
          "recomputedGrade": null,
          "outcome": null,
          "status": "PENDING",
          "conductedFrom": null,
          "conductedTo": null
        }
      ]
    }
  ]
}
```

### Completed example (one learner, fully passed)

```jsonc
{
  "lrn": "202600000001",
  "studentName": "Mendoza, Jose Gabriel",
  "schoolYear": "2030-2031",
  "gradeLevel": "GRADE_8",
  "section": "Maka-Diyos",
  "promotionStatus": "Promoted",
  "resolved": true,
  "overallOutcome": "PASSED",
  "backSubjects": [
    {
      "subjectCode": "ESP8",
      "subjectName": "Edukasyon sa Pagpapakatao 8",
      "gradeLevel": "GRADE_7",
      "originalGrade": 71,
      "remedialMark": 82,
      "recomputedGrade": 76.5,
      "outcome": "PASSED",
      "status": "COMPLETED",
      "conductedFrom": "2031-06-01T00:00:00.000Z",
      "conductedTo": "2031-06-15T00:00:00.000Z"
    }
  ]
}
```

### Learner field reference

| Field | Type | Notes |
|---|---|---|
| `lrn` | string | Primary join key. |
| `studentName` | string | `"Last, First Middle"` display form. |
| `firstName` / `middleName` / `lastName` | string | `middleName` may be `""`. |
| `sex` | string | Learner's recorded gender (mirrors `Student.gender`; free-form). |
| `schoolYear` | string | Remedial year (target year). |
| `gradeLevel` | string | Learner's **current** grade level enum. |
| `section` | string | Learner's current section name. |
| `promotionStatus` | string | Title Case wire label (see §3). |
| `resolved` | boolean | `true` when **every** back-subject is `COMPLETED` **and** `PASSED` (SMART has upgraded the enrollment to `PROMOTED`). |
| `overallOutcome` | string \| null | `PASSED` if all passed; `FAILED_TUTORIAL` if any failed; `null` while any row is still `PENDING`. |
| `backSubjects[]` | array | One entry per failed learning area. |

### Back-subject field reference

| Field | Type | Notes |
|---|---|---|
| `subjectCode` | string | SMART subject code, e.g. `MATH10`. |
| `subjectName` | string | Display name, e.g. `Mathematics`. |
| `gradeLevel` | string | Grade level **at which the subject was failed** (source year). |
| `originalGrade` | number | Final rating from the source year (`< 75`). |
| `remedialMark` | number \| null | RCM, `60`–`100`. `null` while `PENDING`. |
| `recomputedGrade` | number \| null | RFG = `(originalGrade + remedialMark) / 2`. `null` while `PENDING`. |
| `outcome` | string \| null | `PASSED` / `FAILED_TUTORIAL`. `null` while `PENDING`. |
| `status` | string | `PENDING` or `COMPLETED`. |
| `conductedFrom` | string \| null | ISO 8601 date (`YYYY-MM-DDT00:00:00.000Z`). |
| `conductedTo` | string \| null | ISO 8601 date. |

---

## 6. How EnrollPro should use it

1. **Hold:** Learner in the feed with `resolved: false` → keep the `REMEDIAL_HOLD`.
   The learner is legally promoted to the next grade level but still owes remedial
   on the listed `backSubjects`.
2. **Release:** Learner absent from the feed, or `resolved: true` → the remedial
   obligation is settled; move the application to the next state
   (`READY_FOR_SECTIONING` for G7–9, target-year application for G10).
3. **Partial:** Some rows `COMPLETED`/`PASSED`, others `PENDING` → keep the hold.
   Do **not** release on a partial pass.
4. **`FAILED_TUTORIAL`:** The learner did not pass the remedial for that subject.
   Keep the hold and handle per your retention rules — SMART does not silently
   promote on failure.
5. **Polling cadence:** The list is cheap and read-only. Re-fetch per learner (via
   `?lrn=`) or per school year (default) after the registrar marks remedial
   `COMPLETED`. There is currently **no webhook/push** — pull-based only.

---

## 7. Errors

| Status | Body | When |
|---|---|---|
| `401` | `{ "error": "Unauthorized" }` | Missing/invalid `X-EnrollPro-API-Key`. |
| `400` | `{ "success": false, "error": "Invalid schoolYear" }` | Malformed `schoolYear` label (not `YYYY-YYYY`). |
| `404` | `{ "success": false, "error": "Student not found" }` | `lrn` provided but unknown to SMART. |
| `500` | `{ "success": false, "error": "Failed to fetch back-subjects" }` | Internal error. |

Empty result is **not** an error:

```json
{ "success": true, "schoolYear": "2030-2031", "count": 0, "learners": [], "meta": { "total": 0, "page": 1, "limit": 100, "totalPages": 0 } }
```

---

## 8. Test data (SMART dev environment, SY 2028-2029)

Use these to validate your client once the endpoint is live. LRNs are real seed
values; failing-subject names/ratings are illustrative.

| Learner | LRN | Section | Failed subjects | Expected |
|---|---|---|---|---|
| Mendoza, Jose Gabriel | `202600000001` | G8 Maka-Diyos | 1 (`ESP8`, final 71) | `promotionStatus: "Conditionally Promoted"`, 1 PENDING row |
| Mendoza, Justin | `202800000000` | G7 Mabini | 1 (`MAPEH7`, final 71) | `promotionStatus: "Conditionally Promoted"`, 1 PENDING row |
| Fernandez, John Paolo | `202600000008` | G9 Daisy | 4 | `RETAINED` → **absent from feed** |
| Fernandez, Kenneth | `202800000005` | G7 Bonifacio | 4 | `RETAINED` → **absent from feed** |

---

## 9. Out of scope / guarantees

- **Read-only.** SMART never writes to EnrollPro from this endpoint.
- **No fabricated values.** A `PENDING` row returns `null` for RCM/RFG/outcome
  rather than a fallback.
- **Finalized grades only.** `originalGrade` comes from FINALIZED grades in the
  source year; unfinalized subjects do not create back-subject rows.
- **G10 completers** never receive remedial (grades are adjusted instead) and are
  excluded. `JHS_COMPLETER` is reserved but not yet emitted on the wire.
- **Historical reads** are scoped by the `schoolYear` string only — prior-year
  back-subjects remain queryable after rollover archiving.

---

## 10. Implementation status

| Item | Status |
|---|---|
| SMART `RemedialClass` data model | ✅ built |
| SMART registrar encoding UI (RCM, conducted dates, complete) | ✅ built |
| RFG/outcome computation | ✅ built |
| `GET /api/integration/smart/back-subjects` | ⏳ implementing to this spec |
| EnrollPro client + `REMEDIAL_HOLD` release wiring | ⏳ your side |

**Contact:** SMART team for the production `ENROLLPRO_API_KEY`, base URL, and a
live sample payload.
