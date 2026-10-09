# EnrollPro → SMART: Transfer Certificate (TC) is missing from the transferee feed

Date: **2026-09-29**
From: **SMART**
To: **EnrollPro development**
Re: `transferCertificateNo` is `null` for every learner in SY 2022-2023
Status: **CONFIRMED / CLOSED (2026-09-29)** — EnrollPro verified the field location and audited its
database: `null` is expected source data (no TC was ever encoded). No API/contract change required.

---

## Resolution (EnrollPro response, 2026-09-29)

EnrollPro's `SMART-TRANSFER-CERTIFICATE-API-LOCATION.md` confirms:

- The official source is `GET /api/integration/v1/default/smart/transferees` and the value is a
  **top-level** `data[i].transferCertificateNo` — which is exactly how SMART reads it.
- The value comes from `application_previous_schools.transfer_certificate_no`; the feed returns the
  stored value or explicit `null`. It never derives a certificate number.
- EnrollPro's read-only DB audit agrees with SMART's checks: **0 non-null TC values** across all
  20 previous-school records in SY 2022-2023. `null` is expected source data, not a missing API field.
- Guidance matches SMART's implementation: fill `Student.transferCertNo` only when it has no
  registrar-entered value, never overwrite a corrected value with `null`, and keep the manual-entry
  path.
- SMART additionally verified live that `meta.contractVersion === "1.1"` and now captures/logs it
  (`SmartTransfereeFeedResult.contractVersion`).

**Remaining action is data capture only:** EnrollPro staff encode the TC on the walk-in/previous-school
record (or SMART's registrar types it in the Transferees → Complete details field). Once a non-null
value exists in EnrollPro, the next sync fills it automatically.

**CLOSED (2026-09-29, final verification):** EnrollPro encoded TCs for all 10 transferees
(`TC-2022-00000001` …). SMART's feed read returned 10/10 non-null values and the sync filled
`Student.transferCertNo` automatically; a subsequent sync reported **0 changes**, confirming
fill-nulls-only completed without touching stored values. Meets every requirement in the
verification checklist above.

---

## TL;DR

SMART's consumption of the v1.1 transferee-details contract is implemented and verified.
However, the feed returns `"transferCertificateNo": null` for every row because **EnrollPro's own
database has `null` for every learner's `previousSchool.transferCertificateNo`**.

`transferCertificateNo` is optional in the walk-in intake, and it was never captured for these
records. The feed faithfully projects the stored value — there is no projection/mapper bug.
EnrollPro needs to (a) confirm whether TC can be edited for already-enrolled learners, and
(b) backfill the test records (or provide staff a way to).

---

## Evidence (read-only checks performed 2026-09-29)

### 1. The integration feed SMART consumes

```http
GET /api/integration/v1/default/smart/transferees?schoolYearId=1
```

- Scope: SY `2022-2023` (EnrollPro school-year id `1`), 10 transferee rows.
- Rows with non-null `transferCertificateNo`: **0 / 10**.
- Every other v1.1 field is populated (`previousSchoolName`, `originatingSchoolId`,
  `previousGenAve`, `lastGradeCompleted`, `sf9EligibilityStatus`, `conditionalSubjectCodes`,
  `hasSf9`, `hasPsa`, `isTemporarilyEnrolled`).

Example row (LRN `202200000001`, `enrollmentApplicationId: 2`):

```json
{
  "previousSchoolName": "Talisay Hope GK Sibol Elementary School",
  "originatingSchoolId": "112331",
  "transferCertificateNo": null,
  "previousGenAve": 78.1,
  "lastGradeCompleted": "Grade 6"
}
```

### 2. EnrollPro's own backend endpoints return the same null

`GET /api/learner/lookup?lrn=202200000001` (staff session, read-only):

```json
"previousSchool": {
  "id": 1,
  "enrollmentId": 2,
  "schoolName": "Talisay Hope GK Sibol Elementary School",
  "schoolId": "112331",
  "schoolAddress": "Talisay City, Negros Occidental",
  "schoolType": "PUBLIC",
  "lastGradeCompleted": "Grade 6",
  "schoolYearLastAttended": "2021-2022",
  "generalAverage": 78.1,
  "transferCertificateNo": null,
  "scpAdmissionId": null
}
```

- `GET /api/students/2` → `student.previousSchool.transferCertificateNo: null` (same record).
- Loop over all learners (`GET /api/learner/lookup?lrn=202200000001` … `202200000019`):
  **19 / 19 records have `transferCertificateNo: null`**.

### 3. EnrollPro UI shows no TC either

- **Learner Directory → learner profile → "Previous School" block** displays: School Name,
  School ID, Grade Completed, Year Attended, School Address, School Type, General Average.
  There is no TC field.
- **Learner Enrollment → transferee verification pane** displays previous school name, final
  general average, and required documents (Physical SF9, PSA Birth Certificate). No TC field.

---

## Root cause

Per the v1.1 contract, `transferCertificateNo` is **optional** in the walk-in intake
(`WalkInEncodePanel` → persisted on the learner's previous-school record). The demo/test records
were created without it, and the value is `null` at the source. The feed correctly sends the
stored null.

(Note: `SMART-TRANSFEREE-API (2).md` names the table `enrollment_previous_schools`, while the v1.1
contract names it `application_previous_schools`. Worth confirming that the walk-in form, the
learner lookup endpoint, and the SMART feed all read/write the **same** record — currently they
all agree, so no mismatch was observed.)

---

## Requested actions (EnrollPro)

1. **Confirm TC capture:** verify the walk-in encode form stores `transferCertificateNo` on the
   same previous-school record that `/api/learner/lookup` and the SMART feed project.
2. **Editability:** can TC be edited for already-enrolled learners? If yes, backfill the test
   learners and tell staff where. If no, decide how existing records get corrected (edit UI,
   admin backfill, or accept registrar entry in SMART).
3. **Policy:** decide whether TC stays optional or becomes required for transferee intake.
4. **No API change requested.** Do not change the field mapping — SMART already consumes
   `transferCertificateNo` and will fill it automatically once a non-null value exists.

---

## What happens on the SMART side after the data exists

- SMART's local `Student.transferCertNo` is `null` for these learners, and the sync is
  fill-nulls-only, so the next scheduled/manual sync **fills it automatically**.
- Registrar-entered values in SMART are never overwritten by the feed.
- The Transferees page flags the record as "1 missing" while TC is absent; the flag clears once
  the feed sends a value.

## Verification after backfill

1. `GET /api/learner/lookup?lrn=<lrn>` → `previousSchool.transferCertificateNo` is non-null.
2. `GET /api/integration/v1/default/smart/transferees?schoolYearId=1` → the same value appears in
   `transferCertificateNo`.
3. SMART sync → the value appears in Registrar → Transferees → "Complete details" dialog.

---

## Notes

- All checks above were read-only (`GET`); no EnrollPro data was created, updated, or deleted.
- The SMART integration key was never printed, logged, or included in this document.
