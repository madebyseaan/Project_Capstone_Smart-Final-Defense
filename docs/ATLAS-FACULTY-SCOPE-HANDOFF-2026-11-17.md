# ATLAS Handoff — Faculty/Runtime 403 `SCHOOL_SCOPE_REQUIRED`

**Date:** 2026-11-17
**From:** SMART (Student Management and Records Tracking)
**To:** ATLAS engineering / ATLAS AI
**Scope:** school `1`, SY `2026-2027` (ATLAS `schoolYearId=5`)
**Related:** `docs/ATLAS-FACULTY-SCOPE-AND-ARCHIVED-SUBJECTS-HANDOFF-2026-10-26.md` (original ticket)

## TL;DR

SMART's ATLAS system token is valid, but ATLAS rejects school-scoped reads with
`403 SCHOOL_SCOPE_REQUIRED`:

- `GET /api/v1/faculty?schoolId=1`
- `GET /api/v1/runtime/context?schoolId=1&verifyUpstream=true`
- `GET /api/v1/faculty/advisers?schoolId=1&schoolYearId=5` (same guard — please confirm)

The token is a `SYSTEM_ADMIN` service token (`system-api@atlas.local`) that carries **no
school-scope claim**. SMART needs ATLAS to either:

1. issue a school-scoped system/integration token for school `1`, or
2. accept the existing system token with the `schoolId` query parameter on these reads, or
3. document the exact required header/scope claim.

SMART must not use or store a user password.

**No SMART code change is required if ATLAS issues a new token or accepts the query param.**
If ATLAS requires a header, SMART needs the canonical header name/value.

---

## Environment

| Item | Value |
|---|---|
| ATLAS base URL | `https://njgrm.buru-degree.ts.net/api/v1` |
| SMART `ATLAS_SCHOOL_ID` | `1` |
| ATLAS active school year | `5` (`2026-2027`) |
| SMART `ATLAS_SCHOOL_YEAR_ID` | `3` (stale pin; SMART probes and self-heals to `5`) |
| Auth header sent | `Authorization: Bearer <SMART system token>` |
| Token role | `SYSTEM_ADMIN` |
| Token identity | `system-api@atlas.local` |
| Token school claim | none (no `schoolId` / school-scope claim present) |

## Evidence

### 1. Faculty read returns 403

```http
GET /api/v1/faculty?schoolId=1
Authorization: Bearer <SMART system token>
```

```json
{
  "code": "SCHOOL_SCOPE_REQUIRED",
  "message": "Authenticated school scope is required for this action."
}
```

### 2. Runtime context returns 403

```http
GET /api/v1/runtime/context?schoolId=1&verifyUpstream=true
Authorization: Bearer <SMART system token>
```

Same `403 SCHOOL_SCOPE_REQUIRED`. SMART falls back to probing for the active year
(forward-only) and resolves year `5`.

### 3. Header probes (all still 403)

Read-only probes against `/faculty?schoolId=1`, same token:

| Header added | Result |
|---|---|
| none (baseline) | `403 SCHOOL_SCOPE_REQUIRED` |
| `X-School-Id: 1` | `403 SCHOOL_SCOPE_REQUIRED` |
| `X-Atlas-School-Id: 1` | `403 SCHOOL_SCOPE_REQUIRED` |
| `X-School: 1` | `403 SCHOOL_SCOPE_REQUIRED` |
| `X-School-Scope: 1` | `403 SCHOOL_SCOPE_REQUIRED` |
| `X-School-Id: 1` + `X-School-Scope: 1` | `403 SCHOOL_SCOPE_REQUIRED` |

### 4. No public API documentation

`GET /openapi.json`, `/docs`, `/api-docs`, `/swagger.json` all return `404`, so SMART
cannot discover the required scope contract from the service.

### 5. What still works with the same token

These reads succeed, so connectivity and the token itself are fine:

- `GET /subjects?schoolId=1`
- `GET /faculty-assignments/effective?schoolId=1&schoolYearId=5`
- `GET /schools/1/school-years/5/schedules/published?termIndex=active`

## Impact on SMART

SMART's current workaround is read-only and safe, so teacher class lists and schedules
are not blocked:

```
[AtlasSync] Faculty fetch failed: HTTP 403 .../faculty?schoolId=1:
  {"code":"SCHOOL_SCOPE_REQUIRED","message":"Authenticated school scope is required for this action."}
  — continuing with cached/empty faculty
[AtlasSync] Faculty directory unavailable; published-schedule fallback found 39 faculty candidate(s)
[AtlasSync] Faculty index source=published-schedule candidates=39 matched=39
  (externalId=39, employeeId=0, email=0)
[AtlasSync] Effective teaching load: state=POPULATED, assignments=224, version=585000001
[AtlasYear] runtime/context unavailable (HTTP 403) ... resolved active ATLAS school year 5 by probing
```

Degraded/unavailable while the 403 persists:

- Direct ATLAS faculty directory matching (fallback uses `faculty.atlasId` /
  `faculty.externalId` / `faculty.employeeId` from the published schedule)
- `/faculty/advisers` sync (same school-scope guard expected)
- ATLAS draft-preview faculty resolution (`faculty-external/:externalFacultyId`)
- Reliable stale-check coverage for teacher ownership changes

## Requests to ATLAS

1. Confirm whether `/faculty?schoolId=1` accepts a `SYSTEM_ADMIN` system token, or whether it
   requires a school-scoped credential.
2. If a header is required, provide the exact header name and value, or the required
   `aud` / `scope` / `schoolId` claim.
3. Confirm the same contract for:
   - `/runtime/context?schoolId=1&verifyUpstream=true`
   - `/faculty/advisers?schoolId=1&schoolYearId=5`
   - `/schools/1/school-years/5/schedules/draft/faculty-external/:externalFacultyId`
4. Either restore school-scope access for SMART's existing system token or issue a new
   scoped token. Do not require a user password.
5. Confirm whether `externalFacultyId` in the draft read is the EnrollPro teacher record id
   (the same value as published `faculty.externalId`).

## Acceptance criteria

- `GET /api/v1/faculty?schoolId=1` with SMART's system credential returns `200` with the
  school's faculty list (or ATLAS documents the exact alternative request).
- `GET /api/v1/runtime/context?schoolId=1&verifyUpstream=true` returns `200`.
- `GET /api/v1/faculty/advisers?schoolId=1&schoolYearId=5` returns `200`.
- SMART logs show `Faculty index source=directory` with no fallback warning.
- SMART logs show `ATLAS: 39 teachers matched` with no `SCHOOL_SCOPE_REQUIRED` errors.
- No user password or interactive login is required anywhere in the integration.

## Verification commands (run with ATLAS system credentials, do not paste tokens)

```http
GET /api/v1/faculty?schoolId=1
Authorization: Bearer <SMART system token>

GET /api/v1/runtime/context?schoolId=1&verifyUpstream=true
Authorization: Bearer <SMART system token>

GET /api/v1/faculty/advisers?schoolId=1&schoolYearId=5
Authorization: Bearer <SMART system token>

GET /api/v1/faculty-assignments/effective?schoolId=1&schoolYearId=5
Authorization: Bearer <SMART system token>

GET /api/v1/schools/1/school-years/5/schedules/published?termIndex=active
Authorization: Bearer <SMART system token>
```

## What SMART will do after the fix

1. If ATLAS issues a new token: replace `ATLAS_SYSTEM_TOKEN` and restart the backend.
2. If ATLAS requires a header: add it to `atlasAuthHeader()` in
   `server/src/lib/sync/httpClient.ts` and re-run the sync.
3. If ATLAS accepts the query parameter: no SMART change.
4. Verify logs and System Health, then remove/keep the fallback warning as appropriate.

---

## One-line summary for the ATLAS ticket

> SMART's valid `SYSTEM_ADMIN` ATLAS token has no school-scope claim and receives
> `403 SCHOOL_SCOPE_REQUIRED` on `/faculty?schoolId=1`, `/runtime/context`, and
> `/faculty/advisers`; common school headers do not help and no API docs are published.
> Please either restore school-scope access for this system token, issue a school-scoped
> token, or document the exact required header/claim. SMART's read-only published-schedule
> fallback is keeping sync alive in the meantime.
