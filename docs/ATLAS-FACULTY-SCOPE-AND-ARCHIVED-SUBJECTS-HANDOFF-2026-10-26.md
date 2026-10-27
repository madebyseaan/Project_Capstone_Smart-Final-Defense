# ATLAS Handoff — Faculty Scope + Archived Subject in Effective Load

**Date:** 2026-10-26
**From:** SMART (Student Management and Records Tracking)
**To:** ATLAS engineering / ATLAS AI
**Scope:** school `1`, school year `2026-2027` (`schoolYearId=5`)

## TL;DR — what we need from ATLAS

1. **Restore the SMART system token's access to `/faculty?schoolId=1`.** It currently returns
   `403 SCHOOL_SCOPE_REQUIRED`. Confirm the exact scope/header/token model expected for
   `/faculty`, `/runtime/context`, `/faculty/advisers`, and the draft
   `faculty-external/:externalFacultyId` read.
2. **Remove the archived COMED subject from the effective teaching load and publish a new
   effective version.** The subject is `isActive: false` in `/subjects`, but
   `/faculty-assignments/effective?schoolId=1&schoolYearId=5` is still version `18` with
   268 assignments, including 4 COMED rows.
3. **Confirm the semantics of `isActive: false` on `/subjects`.** If it means "archived /
   not current", should the effective load automatically exclude its assignments and bump
   `source.version`? If not, what is the canonical "archived for this school year" signal
   SMART should use?

SMART has a safe read-only workaround in production right now (see "What SMART changed"),
so this is not blocking teacher class lists anymore. The asks above remove the workaround
dependency and keep the two systems' data model aligned.

---

## Concern 1 — `/faculty` returns 403 `SCHOOL_SCOPE_REQUIRED`

### Evidence

- Request used by SMART: `GET /api/v1/faculty?schoolId=1`
  with `Authorization: Bearer <SMART system token>`.
- Response:
  ```json
  {
    "code": "SCHOOL_SCOPE_REQUIRED",
    "message": "Authenticated school scope is required for this action."
  }
  ```
- First observed: `2026-10-24T10:56:29Z`
- Observed continuously through the latest scheduler cycles (`2026-10-25T23:20:04Z`):
  141 consecutive 5-minute sync cycles with the same response.
- ATLAS health endpoint is `200`; the failure is authorization/scope, not connectivity.
- The same school-scoped token pattern works for the published schedule reads
  (`/schools/1/school-years/5/schedules/published?termIndex=...`) and for
  `/faculty-assignments/effective?schoolId=1&schoolYearId=5`.

### Impact on SMART

SMART uses `/faculty` to map ATLAS `faculty.id` to SMART teachers before applying the
effective teaching load. With the 403:

- `matched = 0` for the teaching-load sync.
- The stale-check block is skipped (it requires at least one matched teacher), so removed
  or archived ownership could not be reconciled.
- Teacher-login sync also cannot resolve the teacher's ATLAS faculty identity.
- The §8A draft preview cannot resolve the ATLAS external faculty id.

### What SMART changed as a workaround

SMART now reads the **published schedule** for the active term and builds the faculty index
from the `faculty.atlasId` / `faculty.externalId` / `faculty.employeeId` fields that are
already present on each published entry. This is read-only; SMART never writes to ATLAS.

Current result in SMART logs:

```
[AtlasSync] Faculty directory unavailable; published-schedule fallback found 39 faculty candidate(s)
[AtlasSync] Faculty index source=published-schedule candidates=39 matched=39
  (externalId=39, employeeId=0, email=0)
```

### Questions for ATLAS

1. Is `/faculty?schoolId=1` supposed to accept a system token, or does it require a
   school-scoped user token?
2. If a header is required, what is its exact name/value (e.g. `X-School-Id`, `X-Atlas-School`,
   an `aud`/`scope` claim)? Please provide the canonical header/scope contract, not an example
   token.
3. Do `/runtime/context?schoolId=1&verifyUpstream=true` and
   `/faculty/advisers?schoolId=1&schoolYearId=5` have the same scope requirement?
4. Does the draft read
   `/schools/1/school-years/5/schedules/draft/faculty-external/:externalFacultyId`
   accept the SMART system token with school scope, and is `externalFacultyId` the
   EnrollPro teacher record id (the same value as published `faculty.externalId`)?
5. Will ATLAS restore access for SMART's existing system token, or issue a new token/scoped
   credential? SMART must not have to guess or store a user password.

**Acceptance:** a SMART system-token request to `/faculty?schoolId=1` returns `200` with the
school's faculty list, or ATLAS documents the exact alternative request SMART must make.

---

## Concern 2 — COMED is archived in `/subjects` but still in the effective load

### Evidence

`/subjects?schoolId=1` contains the archived COMED subject:

```json
{
  "id": 2299,
  "schoolId": 1,
  "code": "COMED",
  "name": "Communication 10",
  "displayCode": "COMED",
  "gradeLevels": [7, 8, 9, 10],
  "ownerDepartment": "AP",
  "programScopes": ["STE"],
  "isActive": false,
  "updatedAt": "2026-10-06T16:48:55.290Z"
}
```

`/faculty-assignments/effective?schoolId=1&schoolYearId=5` still reports:

```json
{
  "source": {
    "state": "POPULATED",
    "version": 18
  },
  "assignments": 268
}
```

SMART's last successful apply was `2026-10-24T10:56:21Z`; `source.version` has remained
`18` since then. The effective load still contains four COMED rows. The corresponding
SMART/EnrollPro identifiers are:

| Subject code | ATLAS subjectId | EnrollPro sectionId | Section | Grade | ATLAS facultyId | Teacher employeeId | Teacher |
|---|---:|---:|---|---:|---:|---|---|
| COMED7 | 2299 | 82 | Bonifacio | 7 | 12 | 1000009 | DELA CRUZ, ELAINE MARIE |
| COMED8 | 2299 | 90 | Makatao | 8 | 24 | 1000017 | MERCADO, CAMILLE JOY |
| COMED9 | 2299 | 95 | Rose | 9 | 28 | 2000073 | RAMIREZ, CORAZON |
| COMED10 | 2299 | 99 | Silver | 10 | 29 | 1000001 | RAMOS, CAMILLE JOY |

SMART previously kept these four current-year `ClassAssignment` rows active because the
effective load still included them. On `2026-10-25T23:36:49Z` SMART applied a temporary
archived-subject filter:

```
[AtlasSync] Excluding 4 teaching-load row(s) for archived ATLAS subject(s): COMED
[AtlasSync] Stale-check: softArchived=4, reactivated=0, preserved=8
```

All four were soft-archived with reason `ATLAS_STALE_WITH_GRADES`; grades and historical
records were preserved. SMART's System Health now shows `264 / 268` applied
(268 effective rows minus the 4 archived-subject rows) with 0 consecutive failures.

### Questions for ATLAS

1. Does archiving a subject automatically remove its rows from the effective teaching load
   and increment `source.version`? If not, please remove the four COMED rows above and
   publish a new effective version.
2. What is the authoritative archived signal for a subject: `isActive: false`, a dedicated
   `archivedAt`/`status` field, or a year-scoped setting?
3. Is `/subjects` scoped to the current school year, or is `isActive` a global catalog flag?
   If a subject can be archived for the current year but remain valid historically, what
   field distinguishes that from a global archive?
4. Should SMART's teaching-load sync exclude all `isActive: false` subjects, or only those
   for the current year? Please confirm the expected consumer rule so SMART can remove the
   temporary filter when ATLAS publishes clean data.
5. Does `source.version` change only when assignment ownership changes, or also when the
   subject catalog changes? SMART uses `version` for idempotency, so a catalog-only change
   must still be reflected if it affects the effective load.

**Acceptance:** the effective load for school `1`, year `5` no longer contains
`subjectId=2299`, its `source.version` is greater than `18`, and `/subjects` documents the
archived semantics. SMART will then show `264 / 264` applied with no COMED rows.

---

## What SMART changed (for ATLAS awareness)

- **Faculty fallback:** when `/faculty` fails, SMART builds the faculty index from the
  published schedule's `faculty.atlasId`, `faculty.externalId`, and `faculty.employeeId`
  fields. It tries `externalId` (EnrollPro teacher record id) first, then `employeeId`, then
  email, matching the existing §7.3 contract.
- **Archived-subject filter:** when `/subjects` reports `isActive: false`, SMART excludes
  those rows from the desired teaching load. The global stale-check then soft-archives the
  corresponding current-year assignments. The same filter is applied in the per-teacher
  login sync so it cannot re-create them.
- **Draft preview:** SMART uses the caller's EnrollPro teacher record id as the ATLAS
  external faculty id when `/faculty` is unavailable, and hides raw integration errors from
  the teacher UI.
- **No writes:** SMART makes no writes to ATLAS. All changes above are local
  `ClassAssignment` state changes; grades and historical records are preserved.
- **No schema/contract change required from ATLAS** for the workaround. The asks are about
  restoring the documented faculty read and cleaning the effective load.

---

## Reproduction / verification requests

Please run these with the SMART system credentials (do not paste tokens into the handoff):

```http
GET /api/v1/faculty?schoolId=1
Authorization: Bearer <SMART system token>

GET /api/v1/subjects?schoolId=1
Authorization: Bearer <SMART system token>

GET /api/v1/faculty-assignments/effective?schoolId=1&schoolYearId=5
Authorization: Bearer <SMART system token>

GET /api/v1/schools/1/school-years/5/schedules/published?termIndex=active
Authorization: Bearer <SMART system token>
```

Expected after the fix:

- `/faculty` returns `200`.
- `/subjects` shows COMED `isActive: false` (or the documented archive field).
- The effective payload has no `subjectId=2299` rows, and its `source.version` is greater
  than `18`.
- The published schedule continues to include `faculty.externalId` / `faculty.employeeId`
  (SMART's fallback remains safe).

On the SMART side, after ATLAS republishes we will verify:

- PM2 log shows `Faculty index source=directory` (no fallback warning).
- `ATLAS: 39 teachers matched`.
- No `Excluding ... archived ATLAS subject(s): COMED` line.
- System Health `264 / 264` applied, 0 consecutive failures.
- Teacher Class Records and Schedule show no COMED rows; archived grades remain available
  for SF10/history.

---

## One-line summary for the ATLAS ticket

> SMART's system token gets `403 SCHOOL_SCOPE_REQUIRED` on `/faculty?schoolId=1`, and the
> effective teaching load for school 1 / SY 2026-2027 (version 18, 268 rows) still includes
> four rows for archived subject `COMED` (`subjectId=2299`, `isActive:false`). Please restore
> the faculty read with the documented scope/header, remove the four COMED rows from the
> effective load, publish a new effective version, and confirm the archived-subject
> semantics for `/subjects`.
