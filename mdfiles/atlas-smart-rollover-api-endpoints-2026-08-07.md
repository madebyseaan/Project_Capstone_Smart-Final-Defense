# ATLAS API Endpoints for SMART / EnrollPro Rollover Stability

Date: 2026-08-07  
Audience: SMART and EnrollPro developers coordinating school-year rollover with ATLAS.

## Summary

This is the current ATLAS endpoint handoff for rollover stability. The short API list in `README.md` is not enough for SMART rollover work because it mostly covers public subjects and published schedules.

ATLAS does not write to EnrollPro or SMART. During rollover, ATLAS reads EnrollPro active-year, section, faculty, and public settings data; mirrors the active school-year state locally; blocks stale-year generation; and keeps timetable, Teaching Load, policy, generation, and published schedule artifacts inside ATLAS.

Important: SMART and ATLAS clients must not hard-code the EnrollPro school-year ID or source counts. The 2026-08-07 live sanity check reports EnrollPro active year `3 / 2026-2027`, `20` sections, and `23` faculty; previous 2026-08-06 proof saw `1 / 2026-2027` and `24` faculty.

## Base URLs

| Service | Tailnet URL | Notes |
|---|---|---|
| ATLAS | `https://njgrm.buru-degree.ts.net` | Current ATLAS QA/runtime target. |
| ATLAS API prefix | `https://njgrm.buru-degree.ts.net/api/v1` | All ATLAS API routes are versioned under `/api/v1`. |
| EnrollPro dev | `https://dev-jegs.buru-degree.ts.net` | Upstream source for school-year/faculty/section/public settings during rollover testing. |

## Authentication

Most rollover and setup-readiness routes require:

```http
Authorization: Bearer <ATLAS JWT or bridge JWT>
Content-Type: application/json
```

Privileged write actions require an ATLAS `admin`, `officer`, or `SYSTEM_ADMIN` user. Rollover `verifyUpstream=true` and sync routes may forward the upstream bearer token only when the ATLAS session was created through the bridge-auth path.

## Current Rollover Contract

| Domain | Owner | ATLAS behavior |
|---|---|---|
| Active school-year identity | EnrollPro | ATLAS mirrors the EnrollPro active year and uses the EnrollPro numeric school-year ID directly. |
| Sections | EnrollPro | ATLAS stores section snapshots/mirrors for scheduling. |
| Faculty identity and active scheduling status | EnrollPro | ATLAS stores faculty mirrors/snapshots and prunes inactive dummy candidates during rollover reset/sync. |
| Teaching Load ownership | ATLAS | New-year Teaching Load starts empty/review-required; it is not auto-copied from the previous year. |
| Scheduling policy | ATLAS | ATLAS creates/verifies a baseline policy for the active school year. |
| Generation runs and draft timetables | ATLAS | Stale-year generation is blocked when EnrollPro is reachable. |
| Published schedules and revisions | ATLAS | Historical published reads stay available; published records are not rewritten by rollover sync. |

## ATLAS Rollover and Runtime Endpoints

### Health preflight

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/health` | None | Verify the ATLAS API process is reachable before any rollover probe. |

Expected use:

```bash
curl https://njgrm.buru-degree.ts.net/api/v1/health
```

### Runtime context

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/runtime/context?schoolId=1` | Required | Return ATLAS selected year, saved runtime state, and persisted drift evidence without forcing a live EnrollPro probe. |
| `GET` | `/api/v1/runtime/context?schoolId=1&verifyUpstream=true` | Required | Re-check EnrollPro and return current active-year drift state. Use this for rollover coordination. |

Important response fields:

- `activeYearDrift.status`: `aligned`, `atlas-stale`, `enrollpro-unreachable`, or `mapping-conflict`
- `activeYearDrift.enrollProSchoolYearId`
- `activeYearDrift.enrollProSchoolYearLabel`
- `activeYearDrift.atlasSchoolYearId`
- `activeYearDrift.recommendedAction`

### Rollover status

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/runtime/rollover-status?schoolId=1` | Required | Read current drift and mirror state. |
| `GET` | `/api/v1/runtime/rollover-status?schoolId=1&includeCounts=true` | Required | Include local count evidence for sections, faculty, generation runs, policies, and Teaching Load readiness. |

Use this as the primary SMART/EnrollPro stability check. It is read-only.

### Rollover preview and apply

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/runtime/rollover-sync/preview` | Required | Read EnrollPro active-year, faculty, sections, and settings; return what ATLAS would sync; performs no writes. |
| `POST` | `/api/v1/runtime/rollover-sync/apply` | Privileged | Upsert the active-year mirror, section/faculty snapshots, and baseline policy in ATLAS; does not delete historical data; does not copy Teaching Load. |

Request body:

```json
{
  "schoolId": 1
}
```

### Dummy-data reset for dev rollover alignment

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/runtime/rollover-sync/reset-dummy-year` | Privileged | Development-only cleanup for confirmed dummy data that conflicts with EnrollPro's canonical school-year ID. |

Preview/default body:

```json
{
  "schoolId": 1
}
```

Destructive apply body:

```json
{
  "schoolId": 1,
  "confirmReset": true,
  "confirmationText": "RESET_DUMMY_SCHOOL_YEAR_1"
}
```

Safety behavior:

- Blocks if published generation runs or published revisions exist for the reset target.
- Does not write to EnrollPro.
- Clears dummy ATLAS scheduling artifacts for the conflicting year.
- Clears current school-level Teaching Load ownership because the present Teaching Load schema is school-scoped.
- Runs normal rollover sync after cleanup.

SMART/EnrollPro developers should not call this route unless the ATLAS team explicitly asks for a coordinated dev reset.

## Setup Readiness Endpoints After Rollover

These endpoints let SMART/EnrollPro developers confirm ATLAS is reading the new-year data correctly after EnrollPro rollover.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/sections/summary/:schoolYearId?schoolId=1` | Required | Verify synced section count, grade/program distribution, and section source status. |
| `POST` | `/api/v1/sections/sync` | Privileged | Sync sections from EnrollPro. Body: `{ "schoolId": 1, "schoolYearId": 1 }`; if `schoolYearId` is omitted, ATLAS resolves EnrollPro active year. |
| `GET` | `/api/v1/faculty?schoolId=1&includeStale=false` | Required | Verify active faculty mirrors available to scheduling. |
| `POST` | `/api/v1/faculty/sync` | Privileged | Reconcile faculty from EnrollPro. Body: `{ "schoolId": 1, "schoolYearId": 1 }`. |
| `POST` | `/api/v1/faculty/sync/reset` | Privileged | Prune/reset faculty mirrors from EnrollPro. Body requires `{ "schoolId": 1, "schoolYearId": 1, "confirmPrune": true }`. |
| `GET` | `/api/v1/faculty-assignments/summary?schoolId=1&schoolYearId=<activeSchoolYearId>` | Required | Verify Teaching Load readiness. Empty new-year Teaching Load is expected immediately after rollover. |
| `GET` | `/api/v1/faculty-assignments/coverage/summary?schoolId=1&schoolYearId=<activeSchoolYearId>` | Required | Verify subject/faculty coverage readiness after officers build Teaching Load. |

## Generation and Timetable Guard Endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/generation/:schoolId/:schoolYearId/runs?limit=20` | Required | List generation-run metadata without pulling the full timetable payload. |
| `GET` | `/api/v1/generation/:schoolId/:schoolYearId/runs/latest` | Required | Return latest run metadata. |
| `GET` | `/api/v1/generation/:schoolId/:schoolYearId/runs/latest/timetable` | Required | Return latest timetable entries when a current-year run exists. Clients should check run metadata before calling this route. |
| `GET` | `/api/v1/generation/:schoolId/:schoolYearId/runs/latest/violations` | Required | Return latest validation report. |
| `POST` | `/api/v1/generation/:schoolId/:schoolYearId/runs` | Privileged | Create a generation run. Blocks stale years and empty Teaching Load. |

Expected guard responses:

```json
{
  "code": "ACTIVE_YEAR_DRIFT",
  "message": "EnrollPro is now on the active school year. Sync the new school year before generating schedules.",
  "nextAction": "RUN_ROLLOVER_SYNC"
}
```

```json
{
  "code": "TEACHING_LOAD_REVIEW_REQUIRED",
  "message": "Build and review Teaching Load before creating the first timetable for this school year."
}
```

Historical review remains allowed through read endpoints even when generation is blocked for stale-year creation.

## Public Published Schedule Endpoints

These are downstream/public-facing endpoints, not rollover-control routes. They remain relevant once a schedule has been published.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/schools/:schoolId/schedules/published` | Public | Current published schedule truth. Accepts optional `date=YYYY-MM-DD` or `asOfDate=YYYY-MM-DD` for revision-effective reads. |
| `GET` | `/api/v1/schools/:schoolId/schedules/published/sections/:sectionId` | Public | Current published section schedule. |
| `GET` | `/api/v1/schools/:schoolId/schedules/published/faculty/:facultyId` | Public | Current published faculty schedule. |
| `GET` | `/api/v1/schools/:schoolId/schedules/published/rooms/:roomId` | Public | Current published room schedule. |
| `GET` | `/api/v1/schools/:schoolId/schedules/published/:termId` | Public | Published schedule for a specific term. |
| `GET` | `/api/v1/schools/:schoolId/schedules/published/:termId/sections/:sectionId` | Public | Term-specific section schedule. |
| `GET` | `/api/v1/schools/:schoolId/schedules/published/:termId/faculty/:facultyId` | Public | Term-specific faculty schedule. |
| `GET` | `/api/v1/schools/:schoolId/schedules/published/:termId/rooms/:roomId` | Public | Term-specific room schedule. |

## EnrollPro Feeds ATLAS Expects

ATLAS currently expects these EnrollPro-side feeds to remain stable during rollover:

| EnrollPro feed | Required? | ATLAS usage |
|---|---|---|
| `GET /api/integration/v1/school-year` | Required | Active school-year ID and label. |
| `GET /api/integration/v1/sections` | Required | Section identity, grade/program, capacity/count when available, adviser linkage when available. |
| `GET /api/integration/v1/default/faculty` | Required, preferred | Faculty identity, display name, active scheduling status, department/specialization when available. |
| `GET /api/integration/v1/faculty` | Fallback | Faculty identity fallback when default feed is unavailable. |
| `GET /api/settings/public` | Required | Branding/public settings and source heartbeat. |
| Subject-offerings feed | Optional | Probed only if EnrollPro documents a replacement route. Missing subject-offerings must not block rollover sync. |

Required field contract:

- Active school year: numeric ID and readable label, for example the latest live probe returned `3 / 2026-2027`.
- Section: numeric ID, display name, grade/program identifiers, and active membership state.
- Faculty: numeric ID, display name, active scheduling state, and department/specialization where available.

If EnrollPro changes these field shapes, ATLAS should surface an integration-contract drift warning instead of silently syncing incomplete data.

## Recommended Rollover Stability Sequence

1. `GET /api/v1/health`
2. `GET /api/v1/runtime/context?schoolId=1&verifyUpstream=true`
3. `GET /api/v1/runtime/rollover-status?schoolId=1&includeCounts=true`
4. Confirm EnrollPro active-year feed has completed its own rollover and is stable.
5. `POST /api/v1/runtime/rollover-sync/preview`
6. Review section/faculty/settings counts.
7. `POST /api/v1/runtime/rollover-sync/apply`
8. Re-run `GET /api/v1/runtime/rollover-status?schoolId=1&includeCounts=true`
9. Confirm:
   - drift is `aligned`;
   - EnrollPro active year and ATLAS selected year match;
   - section and faculty counts match EnrollPro;
   - Teaching Load is empty/review-required for the new year.
10. Confirm generation blocks with `TEACHING_LOAD_REVIEW_REQUIRED` until officers build Teaching Load.

## Stable Rollover States SMART Should Expect

| State | Meaning | SMART/EnrollPro action |
|---|---|---|
| `aligned` | ATLAS and EnrollPro agree on active year. | Continue normal setup or generation-readiness checks. |
| `atlas-stale` | EnrollPro has advanced; ATLAS has not synced yet. | Allow ATLAS rollover preview/apply after EnrollPro data is stable. |
| `enrollpro-unreachable` | ATLAS cannot verify EnrollPro. | Restore EnrollPro/API connectivity before rollover apply. |
| `mapping-conflict` | ATLAS has local data using EnrollPro's active-year ID in an incompatible way. | Use coordinated migration/reset decision; do not auto-apply rollover. |

## Current Known Coordination Caveat

The latest destructive EnrollPro dev rollover attempt did not complete because EnrollPro blocked final rollover without SMART final-outcome data. ATLAS was not the blocker in that attempt.

The 2026-08-07 ATLAS live probe confirmed the documented runtime routes are reachable, but EnrollPro now reports active `3 / 2026-2027` while ATLAS remains selected to `schoolYearId=1`; ATLAS correctly reports `atlas-stale` and recommends `RUN_ROLLOVER_SYNC`. Once EnrollPro exposes a stable completed active-year transition, the ATLAS sequence above is the expected validation path.
