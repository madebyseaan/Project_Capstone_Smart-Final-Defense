# EnrollPro Dev Fix Request: Enable Full School-Year Rollover to 2027-2028

## Context

ATLAS tested the destructive rollover path against the EnrollPro dev Tailnet environment:

- EnrollPro dev URL: https://dev-jegs.buru-degree.ts.net
- Admin credential used: `1234501 / DepEdSY2026!`
- Current active school year: `1 / 2026-2027`
- Target rollover year: `2027-2028`

The destructive EOSY preparation already succeeded:

- System phase changed to `EOSY_CLOSING`
- Incoming calendar policy `1` for `2027-2028` was created and approved
- `80` EOSY records were updated
- `20/20` sections were finalized
- `20/20` SF5 artifacts were recorded
- School-wide SF6 was recorded, version `1`

## Current Blocker

Final rollover call still fails:

```http
POST /api/school-years/rollover
```

Body:

```json
{
  "sourceSchoolYearId": 1,
  "calendarPolicyId": 1,
  "pin": "123456"
}
```

Response:

```json
{
  "code": "ROLLOVER_NOT_READY",
  "message": "Complete Grade 7 - Rizal before starting the new school year.",
  "ready": false,
  "blockers": [
    {
      "sectionId": 1,
      "gradeLevel": "Grade 7",
      "sectionName": "Rizal",
      "unfinishedLearnerCount": 4,
      "reasons": ["SMART_OUTCOME_MISSING"]
    }
  ]
}
```

All `20` sections are blocked only by:

```text
SMART_OUTCOME_MISSING
```

There are no remaining global blockers. SF5/SF6 readiness is complete.

## Confirmed Failing Dependency

This endpoint returns `503`:

```http
POST /api/integration/smart/sections/1/sync-grades
```

Expected behavior: EnrollPro should pull final published SMART outcomes for each section and write `SmartAcademicOutcome` rows that match each learner LRN.

Actual behavior: SMART sync is unavailable, so rollover cannot satisfy the required SMART outcome gate.

## Required Fix

Please do one of these in the EnrollPro dev environment:

### Option A — Configure real SMART dev integration

Set/verify these server env vars for EnrollPro dev:

```env
SMART_API_BASE_URL=<working SMART dev API base>
SMART_API_KEY=<valid SMART integration key>
```

Then verify:

```http
POST /api/integration/smart/sections/:sectionId/sync-grades
```

passes for all `20` current-year sections.

### Option B — Add guarded dev-only SMART outcome fixture

If real SMART dev is unavailable, add a guarded dev/test-only endpoint or script that publishes valid final SMART outcomes for all active 2026-2027 enrollment records.

Requirements:

- Must be unavailable in production.
- Must require `SYSTEM_ADMIN`.
- Must require explicit confirmation text.
- Must write outcomes compatible with EnrollPro rollover validation.
- Must match learners by valid LRN.
- Must set final outcome to match existing `EnrollmentRecord.eosyStatus`.
- Must include:
  - `finalGeneralAverage`
  - `finalOutcome`
  - learning area results
  - `publishedAt`
  - `revision`

Suggested endpoint:

```http
POST /api/dev-tools/eosy/smart-outcomes/seed
```

Body:

```json
{
  "schoolYearId": 1,
  "confirmationText": "SEED_DEV_SMART_OUTCOMES"
}
```

Expected effect:

- Create/update `SmartAcademicOutcome` for every non-departed active current-year enrollment record.
- Use each record’s current EOSY status as the SMART final outcome.
- Return counts:
  - sections processed
  - learners processed
  - outcomes written
  - skipped records
  - blockers

## Validation Steps After Fix

Run these against EnrollPro dev:

```http
GET /api/system/rollover-readiness?calendarPolicyId=1
```

Expected:

```json
{
  "ready": true,
  "globalBlockers": [],
  "blockers": []
}
```

Then run:

```http
POST /api/school-years/rollover
```

Body:

```json
{
  "sourceSchoolYearId": 1,
  "calendarPolicyId": 1,
  "pin": "123456"
}
```

Expected:

- HTTP `201`
- active school year changes to `2027-2028`
- source year `2026-2027` becomes archived
- target year has cloned empty section structures
- continuing learners are carried forward per rollover rules

Then verify partner feeds:

```http
GET /api/integration/v1/school-year
GET /api/settings/public
GET /api/integration/v1/sections
GET /api/integration/v1/default/faculty
```

Expected:

- active year label is `2027-2028`
- sections resolve under the new active year
- faculty feed remains available
- ATLAS can then detect active-year drift and run its rollover sync
```

My recommendation: if SMART dev is not already stable, ask them for Option B. It is the fastest way to unblock ATLAS rollover testing while still respecting EnrollPro’s real production rule that SMART outcomes must exist before rollover.