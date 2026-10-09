# Request: Expose Transferee Detail Fields to SMART (Versioned Contract)

> **From:** SMART (Student Management and Records Tracking)
> **To:** EnrollPro development team / implementation AI
> **Date:** 2026-09-29
> **Re:** `GET /api/integration/v1/default/smart/transferees` — request for additional
> DPA-reviewed fields
> **Deliverable requested:** a completed Markdown contract/handoff file returned to SMART
> (see §8 "What we need back")

---

## 1. Context

SMART consumes the SMART transferee feed documented in
`SMART-TRANSFEREE-API.md` (last code verification 2026-09-11). That feed correctly tells
SMART **who** is a transferee and **when** they enrolled, and SMART uses it to:

- tag `Enrollment.transferInDate` from `enrolledAt`;
- retain `enrollmentApplicationId` as the EnrollPro application reference;
- show the transferee list on the registrar's Transferees page.

Today, the registrar must **manually type** the following into SMART for every transferee
because they are absent from the feed:

- Previous school
- Last grade completed
- Transfer Certificate (TC) number

Additionally, SMART cannot display or track SF9/PSA document status or SF9 eligibility,
which are needed for DepEd SF10 preparation, temporary-enrollment handling
(DO 017, s. 2025), and remedial/back-subject processing.

The EnrollPro team has confirmed that **EnrollPro stores this data** (it is captured during
the walk-in/transferee intake flow). This request asks EnrollPro to expose it to SMART
through the official integration surface, as required by the current handoff:

> "SMART must not infer, fabricate, or scrape them from another endpoint. A separate
> versioned contract and explicit data-minimization review are required before EnrollPro
> exposes them."
> — `SMART-TRANSFEREE-API.md`, "Data Deliberately Not Exposed"

---

## 2. Current state (verified live against the EnrollPro dev API, 2026-09-29)

| Surface | Result |
|---|---|
| `GET /api/integration/v1/default/smart/transferees` | Returns: `enrollmentApplicationId, enrollmentStatus, lrn, isPendingLrn, fullName, firstName, lastName, middleName, extensionName, gradeLevel, section, enrolledAt, eosyStatus, dropOutDate, dropOutReason, transferOutDate, schoolYear`. **No previous-school, TC, previous average, SF9/PSA flags, or eligibility fields.** |
| `GET /students/:id` (staff session) | Includes `birthDate`, `sex`, `applicantType`, `academicHistory`, `enrollment` — but **no previous-school / TC fields** at the levels inspected. |
| `GET /learner/lookup?lrn=` (staff walk-in lookup) | Returns `previousSchool`, `previousGenAve`, `previousSection`, `birthdate`, `sex`, `isMissingSf9`, `hasPsaBirthCertificate`, `promotionStatus`, `academicStatus`, etc. — the data exists, but this is a staff-facing endpoint that SMART must not use for integration (see §1). |

Note: `SMART-TRANSFEREE-API.md` and `SMART-TRANSFEREE-API (1)/(2).md` are identical; no
updated contract has been issued.

---

## 3. What we are requesting

Add the transferee detail fields below to the **official SMART integration surface**, under
a versioned contract with a documented DPA review. Two implementation options — EnrollPro
chooses:

**Option A (preferred — simplest for both sides): extend the existing feed rows.**
Add the fields to each row of `GET /api/integration/v1/default/smart/transferees`.
The feed is small and SMART already pages through it every sync cycle, so this avoids
per-learner N+1 calls.

**Option B: new detail endpoint keyed by LRN or application ID**, e.g.
`GET /api/integration/v1/default/smart/transferee-details?lrn=<12-digit>` or
`?enrollmentApplicationId=<id>`, scoped to the active year and protected by the same
`X-Integration-Key` authentication.

Either option is acceptable. Option A is strongly preferred.

---

## 4. Requested fields

| Field | Type | Null? | Notes / source in EnrollPro |
|---|---|---|---|
| `previousSchoolName` | string | no (when known) | `enrollment_previous_schools` — required at walk-in |
| `originatingSchoolId` | string | yes | `enrollment_previous_schools` — required at walk-in |
| `transferCertificateNo` | string | yes | `enrollment_previous_schools` — optional at walk-in |
| `previousGenAve` | number | yes | `enrollment_previous_schools`; 75–99.99, ≤2 decimals |
| `lastGradeCompleted` | string | yes | Free text ("Grade 6"). If EnrollPro stores only the incoming grade, confirm the exact field/derivation; do **not** silently derive if the value can differ (retained learners) |
| `sf9EligibilityStatus` | `"PROMOTED" \| "CONDITIONALLY_PROMOTED" \| "RETAINED"` | yes | `enrollment_applications` |
| `conditionalSubjectCodes` | string[] (max 2) | yes | `enrollment_back_subjects` |
| `hasSf9` | boolean | yes | `enrollment_applications` |
| `hasPsa` | boolean | yes | `enrollment_applications` |
| `isTemporarilyEnrolled` | boolean | yes | `enrollment_applications` (`true` when SF9 or PSA missing) |
| `birthdate` | string (ISO date) | yes | `learners` — already synced by SMART from the main learners feed; include only if free of DPA concerns (optional / low priority) |
| `sex` | `"MALE" \| "FEMALE"` | yes | `learners` — same note as `birthdate` (optional / low priority) |

**Stable schema rule:** return `null` for unknown values rather than omitting the key, so
SMART can rely on a fixed shape.

**Correlation:** SMART already stores `enrollmentApplicationId` on
`Enrollment.enrollproApplicationId`, so either option can key on it.

---

## 5. Scope, auth, and semantics (must match the existing feed)

- Endpoint scoped to the resolved active school year; `schoolYearId` / `schoolYearLabel`
  metadata must agree with the request (same behavior as the current feed).
- Authentication: `X-Integration-Key` (or `Authorization: Bearer <key>`), same as the
  existing feed. No staff JWT endpoints.
- Archived years: same behavior as the current feed (empty data + meta message is fine;
  SMART preserves its own history).
- On error or partial page set: retain last-known state semantics — the consumer is
  fail-soft.
- No writes from SMART. This is read-only.
- Do not log keys, headers, guardian data, or full response bodies (existing rule).

---

## 6. What SMART will do with the fields

| EnrollPro field | SMART destination |
|---|---|
| `previousSchoolName` | `Student.previousSchool` (fill only when null; registrar corrections win) |
| `lastGradeCompleted` | `Student.lastGradeCompleted` (fill only when null) |
| `transferCertificateNo` | `Student.transferCertNo` (fill only when null) |
| `previousGenAve`, `sf9EligibilityStatus`, `conditionalSubjectCodes`, `hasSf9`, `hasPsa`, `isTemporarilyEnrolled` | Display/tracking for SF10 preparation, temporary-enrollment monitoring, and remedial handling — exact storage to be decided after the contract is received |
| `birthdate`, `sex` | Already synced; no change |

SMART will keep manual entry as an **override**, not a requirement, once the feed provides
the values.

---

## 7. Acceptance criteria (please self-verify before returning the contract)

1. A transferee with previous-school data set returns the fields in the agreed response.
2. A transferee without a given value returns `null` for that key (not a missing key).
3. Response/meta school-year IDs agree with the requested year; mismatch behavior is
   documented.
4. Missing/incorrect integration key → `401 INVALID_INTEGRATION_KEY`.
5. Invalid `schoolYearId` → `400`; unknown year → `404`; active-year inconsistency → `409`
   (consistent with the existing feed's error table).
6. Archived-year request behaves like the existing feed (documented).
7. DPA review is documented for the newly exposed fields (why each is necessary for SMART's
   mandate: SF10, promotion, temporary-enrollment tracking).

---

## 8. What we need back (the requested Markdown deliverable)

Please return a single Markdown handoff/contract file (suggested name:
`SMART-TRANSFEREE-DETAILS-CONTRACT.md`) containing:

1. **Chosen option** (A or B) and final endpoint path(s), including `/v1`.
2. **Exact field names, types, nullability, and enum values** — copy-ready table.
3. **Sample request and response** for a transferee with all fields present, and for one
   with nulls.
4. **Inclusion rules** (which learners/statuses are returned) and **scope validation**
   behavior.
5. **Error table** (status codes and actions), consistent with the existing feed.
6. **Versioning marker** and effective date, plus the DPA review note.
7. **Implementation status** and any deviations from this request.
8. **Changelog entry** superseding the "Data Deliberately Not Exposed" list in
   `SMART-TRANSFEREE-API.md` for exactly these fields.

Once we receive that Markdown file, SMART will implement the sync and retire the manual
entry fields covered by the contract.
