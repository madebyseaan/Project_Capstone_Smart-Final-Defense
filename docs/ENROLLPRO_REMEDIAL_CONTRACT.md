# ENROLLPRO–SMART Remedial Data Contract (Handoff)

**For:** EnrollPro team / AI agent
**From:** SMART team
**Date:** 2026-09-03
**Context:** SMART remedial logic is now complete. EnrollPro needs two guardrails.

---

## What SMART Does (for context)

- Students failing 1-2 subjects get `CONDITIONALLY_PROMOTED` status + `RemedialClass` rows (one per failed subject)
- Registrar enters Remedial Class Mark (RCM) per subject → system computes RFG = (original + RCM) / 2
- If all RFG ≥ 75 → status upgrades to `PROMOTED`
- If any RFG < 75 → stays `CONDITIONALLY_PROMOTED` or `RETAINED`
- Remedial records are SMART-local — never pushed to EnrollPro currently

**Key data on each remedial row:**
| Field | Description |
|---|---|
| `subjectCode` / `subjectName` | The failed learning area |
| `originalGrade` | Final rating from the school year the subject was failed |
| `remedialMark` (RCM) | Mark from remedial class (60-100) |
| `recomputedGrade` (RFG) | (original + RCM) / 2 |
| `outcome` | `PASSED` or `FAILED_TUTORIAL` |
| `status` | `PENDING` or `COMPLETED` |
| `conductedFrom` / `conductedTo` | Remedial class schedule |

---

## Guardrail 1 — Block Rollover if Unresolved Remedial Exists

**Requirement:** EnrollPro must NOT allow school year rollover if any student in the school has:
- `promotionStatus = CONDITIONALLY_PROMOTED` (SMART Enrollment table), AND
- At least one `RemedialClass` row with `status = PENDING`

**Why:** These students have not finished remedial. Their promotion is conditional. Rolling over before completion produces incorrect grade-level placement and breaks SF10 records.

**Implementation:**
1. Before executing rollover, query SMART's database (or API) for enrollments matching the above criteria
2. If count > 0, BLOCK rollover and return an error listing the affected students (name, LRN, grade level, failed subjects)
3. The registrar must complete remedial for all pending students before rollover can proceed

**Suggested API contract (SMART to provide):**

```
GET /api/registrar/remedial/rollover-block?schoolYear={SY}

Response 200: { blocked: false }
Response 409: {
  blocked: true,
  count: 3,
  students: [
    { lrn: "20260000017", name: "Jimenez, Christian Paul", grade: "GRADE_7", pendingSubjects: ["Mathematics 7"] },
    ...
  ]
}
```

SMART will implement this endpoint. EnrollPro calls it as a pre-rollover check.

---

## Guardrail 2 — Fetch Remedial Data for SF10

**Requirement:** EnrollPro fetches SF10 data from SMART. The SF10 form includes a "Remedial Classes" table section (per DepEd format). EnrollPro must include this section in the rendered SF10.

**Current state:** SMART's SF10 endpoint (`GET /api/registrar/sf10?studentId={id}`) already returns `remedialClasses` in the response payload per school year. EnrollPro likely ignores this field.

**What to do:**
1. In the SF10 response, look for `remedialClasses` array on each school year object
2. If non-empty, render the Remedial Classes table on that year's SF10 page with columns: Learning Area, Final Rating, Remedial Class Mark, Date Conducted (from/to)
3. If empty, render the standard blank remedial table (3 empty rows per DepEd format)

**Response shape (already in SMART's SF10 endpoint):**
```json
{
  "schoolYears": [
    {
      "schoolYear": "2026-2027",
      "gradeLevel": "GRADE_7",
      "remedialClasses": [
        {
          "learningAreas": "Mathematics 7",
          "finalRating": "72",
          "remedialClassMark": "85",
          "conductedFrom": "2027-06-01T00:00:00.000Z",
          "conductedTo": "2027-06-15T00:00:00.000Z",
          "status": "COMPLETED",
          "outcome": "PASSED"
        }
      ]
    }
  ]
}
```

**If remedial is PENDING (not yet completed):**
- `remedialClassMark` will be `undefined`
- `status` will be `"PENDING"`
- SF10 should still render the row with the learning area and final rating; RCM and date columns blank

---

## Summary of Actions for EnrollPro

| # | Action | Priority | Depends on |
|---|---|---|---|
| 1 | Call `GET /api/registrar/remedial/rollover-block` before every rollover | **P0** | SMART implements endpoint |
| 2 | Render `remedialClasses` from SF10 response in the form | **P1** | Already in response, just render it |
| 3 | Show remedial status on student profile/dashboard (optional) | P2 | — |

---

## Timeline

SMART will implement the rollover-block endpoint and notify EnrollPro. EnrollPro should begin SF10 remedial rendering in parallel — no dependency on the new endpoint for that work.

**Contact:** Reach out to SMART team for API access, test credentials, and sample payloads.
