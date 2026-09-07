# SMART Developer Handoff — ATLAS Annual Teaching Load Integration

Date: 2026-09-07  
Prepared by: ATLAS team  
Audience: SMART backend/integration developers  
Reference clone inspected: `D:/smart-final-capstone`  
Inspected SMART source: `main` at `ea9700ad656bd45385aab13fff11507f651724f1`  
ATLAS policy: SMART is an external read-only reference; ATLAS made no SMART edits

## Executive summary

SMART currently synchronizes teacher load through legacy per-faculty calls,
numeric year defaults, an operator summary, and published-schedule fallbacks.
Those paths can disagree with the annual Teaching Load approved in ATLAS.

SMART should resolve the active scope once, fetch one versioned annual
ownership snapshot, validate it, and group it locally for all consumers:

```text
GET /api/v1/faculty-assignments/effective?schoolId={atlasSchoolId}&schoolYearId={activeSchoolYearId}
```

Published schedules remain timetable/time-slot truth only.

## Verified ATLAS baseline

Tailnet API base:

```text
https://njgrm.buru-degree.ts.net/api/v1
```

Read-only verification on 2026-09-07 resolved ATLAS school `1`, active school
year `8` (`2029-2030`), and returned:

- HTTP 200 from `/faculty-assignments/effective?schoolId=1&schoolYearId=8`
- `source.state=POPULATED`
- `source.version=4`
- `source.isActiveSchoolYear=true`
- 265 assigned ownership pairs
- 0 synthetic-placeholder pairs
- 0 unassigned pairs
- 0 duplicate `(subjectId, sectionId)` pairs

These values are evidence, not hardcoded configuration.

## Required request sequence

1. Resolve an explicit SMART-tenant-to-ATLAS-school mapping server-side.
2. Call:

   ```text
   GET /api/v1/runtime/context?schoolId={atlasSchoolId}&verifyUpstream=true
   ```

3. Require an aligned/verified context and obtain `activeSchoolYearId`.
4. Fetch the annual effective payload for that exact scope.
5. Validate the returned school, year, active flag, state, version, and unique
   ownership keys.
6. Cache only by:

   ```text
   atlas-teaching-load:{schoolId}:{schoolYearId}:{version}
   ```

7. Group the one snapshot by external faculty identity for teacher views.
8. Treat `EMPTY` as valid current-year truth; never fall back to another year.
9. Keep the ATLAS system integration token server-side and secret-free in logs.

## Current SMART defects found

### SMART-01 — Global/manual sync uses a numeric year and per-faculty reads (`HIGH`)

- `server/src/lib/atlasSync.ts:32`
- `server/src/lib/atlasSync.ts:129-131`
- `server/src/lib/atlasSync.ts:268`

Defaults/fallbacks include fixed year values, and the sync obtains Teaching
Load per faculty. Replace this with dynamic runtime-context resolution and one
annual snapshot grouped locally. Remove published-schedule and unscoped-section
fallbacks from ownership synchronization.

### SMART-02 — Teacher-login sync uses the legacy per-faculty contract (`HIGH`)

- `server/src/lib/teacherSync.ts:47`
- `server/src/lib/teacherSync.ts:523`

Use the same validated annual snapshot as global/manual sync. Resolve the
teacher through explicit external identity and select that teacher's rows from
the versioned snapshot.

### SMART-03 — Registrar proxy consumes an operator summary (`HIGH`)

- `server/src/lib/atlasSync.ts:562-569`
- `server/src/routes/registrar.ts:1783-1844`

Build registrar presentation from the annual effective snapshot plus explicit
metadata. Do not expose an unversioned SMART-local fallback as current ATLAS
truth, and do not depend on an operator-oriented summary response.

### SMART-04 — Automatic scheduler is currently disabled (`INFO`)

`server/src/index.ts:61-62` comments out unified scheduler startup. Manual,
admin, and other routes still make `runAtlasSync()` production-reachable.

Whether to enable recurring synchronization is a SMART operational decision.
Do it only after the annual contract, failure behavior, idempotency, and secret
handling are verified.

## Identity contract

Cross-system joins must use external identity:

- faculty: `FacultyMirror.externalId`
- section: `SectionMirror.externalId` within school and school year
- subject: ATLAS `subjectCode` within school, unless a separately maintained
  stable mapping exists

Never assume SMART, EnrollPro, and ATLAS internal primary keys coincide.

The currently deployed annual endpoint exposes internal IDs. ATLAS plans an
additive v2 response containing `facultyExternalId`, `sectionExternalId`,
section metadata, subject code/name, and rotation metadata. Until deployment,
SMART must use explicit scoped metadata joins and reject ambiguity.

## Rotation and term semantics

- Preserve `rotationFamily`, `termGroupId`, `termCount`, and published-entry
  `termIndex`.
- Do not hardcode a fixed number of specialization subjects.
- Annual ownership determines who owns a subject-section pair; the published
  schedule determines concrete dates/times/rooms.
- Rotating family workload is term-aware; do not blindly sum all family members
  as concurrent load.

## Failure behavior

| Condition | Required SMART behavior |
|---|---|
| `POPULATED`, exact scope/version | Apply idempotently |
| `EMPTY`, exact active scope | Represent zero current ownership; no fallback |
| ATLAS 401/403 | Fail closed; redact token; surface integration alert |
| Runtime context unverified/misaligned | Do not apply current ownership |
| Wrong school/year or inactive source | Reject payload |
| Duplicate ownership key | Reject payload and keep prior scoped version |
| Missing/ambiguous external identity | Quarantine row; never guess |
| ATLAS unavailable | Retain prior version as stale or no-op; fabricate nothing |

## Acceptance tests for SMART

1. Active year rollover requires no source-code numeric change.
2. Global/manual, teacher-login, and registrar paths consume one annual
   snapshot contract.
3. A `POPULATED` payload is applied exactly once per version.
4. An `EMPTY` payload creates no fallback assignments and is represented as
   current truth.
5. Internal IDs deliberately different from external IDs still map correctly.
6. Wrong-school, wrong-year, inactive, malformed-version, duplicate, missing,
   and ambiguous fixtures fail closed.
7. ATLAS unavailability creates no synthetic load or current ownership.
8. No current ownership path calls legacy per-faculty assignments, operator
   summary, unscoped section reads, or published schedules as competing truth.
9. No integration token appears in logs, browser payloads, or test artifacts.
10. Focused integration tests and SMART build pass without writing ATLAS or
    EnrollPro data.

## Suggested SMART implementation order

1. Add typed runtime-context and annual-effective clients.
2. Add explicit tenant mapping and strict response validation.
3. Build one versioned ownership index and faculty grouping layer.
4. Migrate global/manual sync.
5. Migrate teacher-login and registrar paths.
6. Remove or isolate stale-year and published-schedule ownership fallbacks.
7. Add rollover, EMPTY, unavailable, and identity-collision tests.
8. Decide separately whether to enable the recurring scheduler.

## Questions for the SMART team

- Which SMART records currently retain EnrollPro faculty and section external
  IDs?
- Should a valid `EMPTY` annual snapshot deactivate current SMART load rows or
  retain them as explicitly stale history?
- Is recurring synchronization intended, or are manual/admin triggers the
  desired production model?
- Who owns SMART-to-ATLAS tenant mapping and integration-token rotation?

## Non-goals

- No direct ATLAS database access.
- No modification of EnrollPro or AIMS.
- No curriculum-count hardcoding.
- No published timetable as Teaching Load ownership.
- No ATLAS-side edits are requested from the SMART developer.

Suggested commit message for the SMART repository:

```text
fix(atlas-sync): consume versioned annual teaching-load snapshot

Resolve active ATLAS scope dynamically and unify global, teacher, and registrar
ownership on the effective annual contract.
```
