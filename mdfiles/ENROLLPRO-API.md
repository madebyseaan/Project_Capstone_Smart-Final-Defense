# EnrollPro API Reference

## Purpose and Source of Truth

This is the code-verified catalog of routes mounted by `server/src/app.ts`. EnrollPro is the single source of truth for learner and personnel identity, enrollment, grade and section placement, and school-year context.

For the operational sequence from BOSY through EOSY and rollover, see [ENROLLPRO-SCHOOL-YEAR-LIFECYCLE.md](./ENROLLPRO-SCHOOL-YEAR-LIFECYCLE.md).

## Runtime Bases

- Local API: `http://localhost:5002/api`
- Tailnet API: `https://dev-jegs.buru-degree.ts.net/api`
- Partner API: `https://dev-jegs.buru-degree.ts.net/api/integration/v1`
- Uploaded assets: `https://dev-jegs.buru-degree.ts.net/uploads/*`

Companion systems call the HTTP API. They must never connect directly to the EnrollPro PostgreSQL database.

## Authentication and School-Year Scope

| Mode | Transport | Used by |
| --- | --- | --- |
| Staff JWT | `Authorization: Bearer <token>`, `enrollpro_session` cookie, or compatibility `token` query parameter | Protected staff and teacher routes |
| Learner JWT | `Authorization: Bearer <learner-token>` | `/api/learner` self-service routes |
| MRF service key | `X-Integration-Key: <secret>` | `/api/integration/v1/default/mrf/identities` |
| Public | No credential | Public application, reference-data, and compatibility integration feeds |

Protected API calls may send `x-school-year-context-id: <positive integer>`. If absent, EnrollPro resolves `SchoolSetting.activeSchoolYearId`, then the latest active school year. Partner v1 feeds use `schoolYearId`; feeds documented as optional fall back to the active year.

Role names used below are `SYSTEM_ADMIN`, `HEAD_REGISTRAR`, `REGISTRAR` compatibility role, `CLASS_ADVISER`, `TEACHER`, `LEARNER`, and `MRF`.

## Response, Pagination, and Error Conventions

Partner feeds normally return:

```json
{
  "data": [],
  "meta": {
    "generatedAt": "2026-07-11T00:00:00.000Z"
  }
}
```

Internal routes may return a resource directly or a feature-specific envelope. Common partner query parameters are `schoolYearId`, `page`, and `limit`; integration lists default to 50 and cap at 200 unless stated otherwise.

Common errors are:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "schoolYearId must be a positive integer"
  }
}
```

| Status | Meaning |
| --- | --- |
| `400` | Invalid path, query, or body value |
| `401` | Missing or invalid session, JWT, or integration key |
| `403` | Authenticated identity lacks the required role |
| `404` | Resource does not exist in the selected school year |
| `409` | Duplicate or concurrent-state conflict |
| `422` | Valid request cannot be applied in the current lifecycle state |
| `500` | Unexpected server failure |
| `503` | External subsystem or required dependency is unavailable |

## Consumer Matrix

| Consumer | Primary EnrollPro endpoints | Purpose |
| --- | --- | --- |
| SMART | `/integration/v1/default/smart/students`, `/integration/v1/sections`, `/integration/v1/sections/:sectionId/learners` | Grade-encoding masterlists and archived EOSY reconciliation |
| AIMS | `/integration/v1/default/aims/context`, `/integration/v1/sections`, `/integration/v1/default/faculty` | LMS classrooms, learner program context, and remedial flags |
| ATLAS | `/integration/v1/default/faculty`, `/integration/v1/sections`, `/integration/v1/school-year` | Scheduling, faculty load, advisership, and section context |
| MRF | `/integration/v1/default/mrf/identities` | Keyed learner, teacher, staff, and MRF-role identity reconciliation |
| EnrollPro frontend | All protected feature routes and `/events/stream` | Registrar, teacher, learner, and administration workflows |

## Platform and Realtime

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | Basic EnrollPro liveness response |
| GET | `/api/ping` | Public | Plain-text `pong` probe |
| GET | `/api/debug-server` | Public diagnostic | Returns request and CORS diagnostics; do not expose in hardened production deployments |
| GET | `/api/events/stream` | Staff JWT | Browser SSE invalidation stream with 25-second heartbeat |
| GET | `/uploads/*` | Public asset | School logo and uploaded document assets |

The SSE stream emits `invalidate` events with typed topics and optional school-year, learner, teacher, and section IDs. It supports browser cache invalidation; companion systems should use their own scheduled or event-driven synchronization.

## Authentication

Base path: `/api/auth`

| Method | Path | Auth and roles | Purpose |
| --- | --- | --- | --- |
| POST | `/login` | Public | Authenticate an active staff account and issue staff session data |
| POST | `/verify` | Public | Verify staff credentials without creating the normal session workflow |
| POST | `/logout` | Public | Clear the staff authentication cookie |
| GET | `/me` | Staff JWT | Return the authenticated staff profile |
| PATCH | `/change-password` | Staff cookie or bearer fallback | Change the authenticated staff password |

Learner authentication is mounted under `/api/learner`, not `/api/auth`.

## Public System Configuration

Base path: `/api/system`

| Method | Path | Auth and roles | Purpose |
| --- | --- | --- | --- |
| GET | `/public-config` | Public | Learner-login branding and public system context |
| GET | `/rollover-readiness` | `SYSTEM_ADMIN` | Class-level rollover blockers and school EOSY readiness |

## Settings

Base path: `/api/settings`

| Method | Path | Auth and roles | Purpose |
| --- | --- | --- | --- |
| GET | `/public` | Public | Branding, active/viewing school year, phase, dates, and enrollment availability |
| GET | `/scp-config` | Public | Enabled Special Curricular Program configuration |
| GET | `/programs` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN`, `TEACHER` | Active academic programs for filters and intake |
| PUT | `/identity` | `SYSTEM_ADMIN` | Update school identity and contact details |
| POST | `/logo` | `SYSTEM_ADMIN` | Upload logo and derive brand colors |
| DELETE | `/logo` | `SYSTEM_ADMIN` | Remove logo and reset derived theme data |
| PUT | `/accent` | `SYSTEM_ADMIN` | Select a configured accent color |
| PATCH | `/programs` | `SYSTEM_ADMIN` | Enable or configure academic programs |
| PATCH | `/phase` | `SYSTEM_ADMIN` | Change academic phase |
| PATCH | `/algorithm` | `SYSTEM_ADMIN` | Update sectioning algorithm settings |

## Dashboard

Base path: `/api/dashboard`

| Method | Path | Auth and roles | Purpose |
| --- | --- | --- | --- |
| GET | `/stats` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN`, `TEACHER` | School-year-scoped enrollment, section, and operational metrics |
| POST | `/stats/lock` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Lock the active dashboard phase and export SF1 data |

## School Years

Base paths: `/api/school-years` and backward-compatible `/api/school-year`

| Method | Path | Auth and roles | Purpose |
| --- | --- | --- | --- |
| GET | `/` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN`, `TEACHER` | List school years |
| GET | `/next-defaults` | `SYSTEM_ADMIN` | Suggested next-year dates and label |
| GET | `/grade-levels` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN`, `TEACHER` | List configured grade levels |
| GET | `/:id` | `SYSTEM_ADMIN` | Read one school-year configuration |
| POST | `/activate` | `SYSTEM_ADMIN` | Create or activate a school year, optionally cloning structure |
| POST | `/rollover-draft` | `SYSTEM_ADMIN` | Save the next-year shell and proposed dates |
| POST | `/rollover` | `SYSTEM_ADMIN` | Execute complete EOSY-to-BOSY rollover after readiness validation |
| PUT | `/:id` | `SYSTEM_ADMIN` | Update editable school-year settings |
| PATCH | `/:id/status` | `SYSTEM_ADMIN` | Change active or archived lifecycle status |
| PATCH | `/:id/dates` | `SYSTEM_ADMIN` | Update class and enrollment dates |
| DELETE | `/:id` | `SYSTEM_ADMIN` | Delete an allowed school-year record |

## Class Sections and Advisership

Base path: `/api/sections`

| Method | Path | Auth and roles | Purpose |
| --- | --- | --- | --- |
| GET | `/teachers` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Eligible class advisers |
| GET | `/batch-sectioning/prerequisites/:gradeLevelId` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Validate grade-level batch prerequisites |
| POST | `/batch-sectioning/run` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Generate batch sectioning results |
| POST | `/batch-sectioning/commit` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Commit generated batch results |
| POST | `/auto-distribute` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Legacy immediate automatic distribution |
| GET | `/` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | List sections in resolved school-year context |
| GET | `/:ayId` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | List sections for explicit school year |
| POST | `/` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Create a section |
| POST | `/:id/handover-adviser` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Revoke prior advisership and assign a replacement |
| PUT | `/:id` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Update section and adviser details |
| DELETE | `/:id` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Delete an eligible section |
| GET | `/:id/masterlist` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Read section SF1 masterlist |
| GET | `/:id/masterlist/sf1` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Export section SF1 data |
| GET | `/unsectioned-pool/:gradeLevelId` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Learners ready but not assigned to a section |
| POST | `/:id/inline-slot` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Insert one eligible learner into a section |
| POST | `/transfer-learner` | `HEAD_REGISTRAR`, `SYSTEM_ADMIN` | Transfer an enrolled learner between sections |

## Reviewed Sectioning Workspace

Base path: `/api/sectioning`; all routes require `HEAD_REGISTRAR` or `SYSTEM_ADMIN`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/sections-summary` | Section capacity and roster summary |
| GET | `/pool` | `READY_FOR_SECTIONING` applications without enrollment records |
| POST | `/assign-bulk` | Validate and assign selected learners atomically |
| POST | `/commit-draft` | Commit valid reviewed draft placements and return skipped conflicts |

Draft commit accepts grouped assignments, an application override map, and `allowCapacityOverride`. It writes `BATCH_ALGORITHM` or `MANUAL_OVERRIDE` sectioning methods.

## Learner Registry

Base path: `/api/students`; all routes require staff authentication.

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/` | Registrar, admin, teacher | Active and historical learner registry |
| GET | `/summary` | Registrar, admin, teacher | Learner registry summary cards |
| GET | `/:id` | Registrar, admin, teacher | Complete learner profile |
| GET | `/:id/record-history` | Registrar, admin | Historical enrollment ledger |
| PUT | `/:id` | Registrar, admin | Update learner profile |
| GET | `/:id/health-records` | Registrar, admin, teacher | BOSY and EOSY health measurements |
| POST | `/:id/health-records` | Registrar, admin | Add health measurement |
| PUT | `/:id/health-records/:recId` | Registrar, admin | Correct health measurement |
| POST | `/:id/reset-portal-pin` | Registrar, admin | Reset legacy learner portal PIN |
| PATCH | `/:id/portal-access` | Registrar, admin | Enable or disable portal access |
| POST | `/:id/reset-password` | Registrar, admin | Reset learner portal password |
| POST | `/:id/clear-deficiency` | Registrar, admin | Clear documentary deficiency state |
| POST | `/:id/verify-psa` | Registrar, admin | Verify PSA Birth Certificate |
| POST | `/:id/lifecycle/dropout` | Registrar, admin | Record dropout lifecycle transition |
| POST | `/:id/lifecycle/transfer-out` | Registrar, admin | Record transfer-out lifecycle transition |
| POST | `/:id/lrn` | Registrar, admin | Assign or correct LRN |

## Learner Portal and Lookup

Base path: `/api/learner`

| Method | Path | Auth and roles | Purpose |
| --- | --- | --- | --- |
| POST | `/auth` | Public | Authenticate learner and issue learner JWT |
| POST | `/setup-password` | Learner JWT | Replace temporary learner password |
| POST | `/change-password` | Learner JWT | Alias for learner password change |
| GET | `/me` | Learner JWT | Legacy learner self-profile |
| GET | `/dashboard-unified` | Learner JWT | Unified learner portal dashboard |
| GET | `/lookup` | `HEAD_REGISTRAR`, `REGISTRAR`, `SYSTEM_ADMIN` | DPA-protected LRN lookup |
| POST | `/check-duplicate` | `HEAD_REGISTRAR`, `REGISTRAR`, `SYSTEM_ADMIN` | Duplicate learner sentinel |

## Public Applications and Assisted Enrollment

Base path: `/api/applications`

| Method | Path | Auth and roles | Purpose |
| --- | --- | --- | --- |
| POST | `/` | Public | Submit online enrollment application |
| POST | `/update-existing` | Public | Update an existing learner application |
| GET | `/lookup-lrn/:lrn` | Registrar or admin | Assisted intake lookup by LRN |
| POST | `/special-enrollment` | Registrar or admin | Authorized special enrollment for an existing learner |

The currently mounted application router does not expose generic application listing, tracking-number lookup, verify, enroll, or SF1 export paths. Consumers must not rely on older documentation that listed those routes.

## Enrollment Intake

Base path: `/api/enrollment`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| POST | `/sync-smart-grades` | Registrar, admin | Intake-related SMART grade synchronization |
| POST | `/confirm-slip` | Registrar, admin | Confirm one intake slip |
| POST | `/batch-confirm` | Registrar, admin | Confirm multiple intake slips |
| POST | `/finalize-intake` | Registrar, admin | Move a cleared application to sectioning readiness |
| GET | `/pending-verifications` | Registrar, admin | Document verification queue |
| PATCH | `/:applicationId/flag-deficient` | Registrar, admin | Record missing documentary requirements |
| POST | `/walk-in` | Registrar or admin | Directly encode a walk-in learner |

## Enrollment Listings and Intake Queues

Base path: `/api/enrollment-listings`; routes allow registrar, admin, and teacher roles.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | List intake pre-listing records |
| POST | `/` | Create pre-listing record |
| PATCH | `/:id/status` | Update listing status |
| DELETE | `/:id` | Delete listing record |
| GET | `/reading-queue` | Reading assessment queue |
| GET | `/confirmation-queue` | Confirmation queue |
| PATCH | `/:id/assess` | Record listing assessment |
| PATCH | `/applications/:applicationId/intake-assess` | Assess application intake |
| PATCH | `/:id/intake-confirm` | Confirm listing intake |
| GET | `/enrolled-learners` | Legacy enrolled learner intake list |
| PATCH | `/applications/:applicationId/reading-profile` | Update application reading profile |
| PATCH | `/applications/:applicationId/confirmation-slip` | Update confirmation slip |
| PATCH | `/applications/:applicationId/officialize` | Officialize a cleared application |

## BOSY Continuing Learners

Base path: `/api/bosy`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/readiness` | Registrar, admin | Pending, confirmed, temporary, and rollover readiness metrics |
| GET | `/queue` | Registrar, admin | Filtered continuing learner queue |
| GET | `/previous-sections` | Registrar, admin | Prior-year section filter values |
| GET | `/phase2-queue` | Registrar or admin | Phase 2 documentary and enrollment queue |
| POST | `/sync` | Registrar, admin | Idempotently repair missing rollover applications |
| POST | `/confirm-return/:applicationId` | Registrar, admin, teacher | Confirm continuing enrollment and classify documents |
| POST | `/transfer-request/:applicationId` | Registrar or admin | Tag pending learner as not returning |
| POST | `/revoke-confirmation/:applicationId` | Registrar or admin | Return an unsectioned confirmed learner to pending |
| POST | `/confirmed-transfer-out/:applicationId` | Registrar or admin | Remove an unsectioned confirmed learner from intake |
| POST | `/bulk-confirm` | Registrar, admin | Confirm multiple continuing learners |
| GET | `/completers` | Registrar, admin | JHS completer registry |

## Reading Assessment

Base path: `/api/reading-assessment`; routes allow registrar, admin, and teacher roles.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/queue` | General reading assessment queue |
| GET | `/adviser-queue` | Adviser-scoped queue |
| GET | `/continuing-queue` | Continuing learner queue |
| PUT | `/:applicationId` | Record reading profile level and notes |

## Remedial Processing

Base path: `/api/remedial`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/pending` | Registrar, admin | Conditionally promoted and remedial-hold cases |
| PATCH | `/:learnerId/resolve` | Registrar, admin | Apply summer grade and `PROMOTED` or `RETAINED` outcome |

## EOSY

Base path: `/api/eosy`

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/stream` | Registrar, admin, adviser, teacher | EOSY-specific SSE stream |
| GET | `/workspace` | Registrar, admin | Unified grade, section, record, and export-lock payload |
| GET | `/sections` | Registrar, admin | Sections available for EOSY processing |
| GET | `/sections/:id/records` | Registrar, admin | Section EOSY records |
| PATCH | `/records/:id` | Registrar, admin | Update one EOSY result |
| POST | `/records/:id/override` | Registrar, admin | Authorized historical or locked-record correction |
| POST | `/sections/:id/finalize` | Registrar, admin | Lock section EOSY results |
| GET | `/grade/:gradeLevelId/records` | Registrar, admin | Grade-level EOSY records |
| PUT | `/grade/:gradeLevelId/batch-status` | Registrar, admin | Batch update grade-level results |
| POST | `/grade/:gradeLevelId/finalize` | Registrar, admin | Finalize grade-level EOSY |
| POST | `/grade/:gradeLevelId/unlock` | Registrar, admin | Unlock grade-level EOSY |
| POST | `/batch-update` | Registrar, admin | Batch update selected EOSY records |
| POST | `/sections/:id/reopen` | `SYSTEM_ADMIN` | Reopen section before school-level lock |
| GET | `/school-year/:schoolYearId/export-lock` | Registrar, admin | School EOSY lock and finalization readiness |
| GET | `/school-year/:schoolYearId/final-lis-export` | Registrar, admin | Download locked final LIS export |
| POST | `/school-year/finalize` | `SYSTEM_ADMIN` | Archive and lock school EOSY, write history, and create next-year shell |
| POST | `/school-year/unlock` | `SYSTEM_ADMIN` | Emergency school EOSY unlock |
| POST | `/sections/:id/unlock` | Registrar, admin | Unlock section EOSY |
| GET | `/sections/:id/exports/sf5` | Registrar, admin | Section SF5 JSON export |
| GET | `/exports/sf6` | Registrar, admin | School-wide SF6 JSON export |

EOSY finalization creates the next-year shell. Full learner carryover remains the separate `/api/school-years/rollover` operation described in the lifecycle guide.

## Teacher EOSY

Base path: `/api/teacher-eosy`; routes allow adviser, teacher, registrar, and admin roles.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/advisory` | Load the authenticated teacher's advisory EOSY workspace |
| POST | `/advisory/submit` | Submit and finalize advisory EOSY results |

## Personnel Directory

Base path: `/api/teachers`; all routes require `HEAD_REGISTRAR` or `SYSTEM_ADMIN`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Personnel directory |
| GET | `/:id/designation` | School-year designation details |
| POST | `/:id/designation/validate` | Validate proposed designation |
| PUT | `/:id/designation` | Create or update designation |
| GET | `/:id` | Personnel profile |
| POST | `/` | Create personnel profile |
| PATCH | `/:id` | Update personnel profile |
| PATCH | `/:id/portal-access` | Toggle personnel portal access |
| POST | `/:id/reset-password` | Reset personnel password |
| PATCH | `/:id/deactivate` | Deactivate personnel with reason |
| PATCH | `/:id/reactivate` | Reactivate personnel |
| PATCH | `/:id/service-status` | Update leave, transfer, retirement, or other service status |

## Administration and Audit

Base path: `/api/admin`

| Method | Path | Auth and roles | Purpose |
| --- | --- | --- | --- |
| GET | `/system/status` | Any authenticated staff | Current system and BOSY lock status |
| POST | `/system/lock-bosy` | `SYSTEM_ADMIN` | Lock BOSY and SF1 operations |
| POST | `/system/unlock-bosy` | `SYSTEM_ADMIN` | Emergency BOSY unlock |
| GET | `/users/metrics` | `SYSTEM_ADMIN` | Account metrics |
| GET | `/users/roles` | `SYSTEM_ADMIN` | Available role metadata |
| GET | `/users` | `SYSTEM_ADMIN` | Account list |
| POST | `/users` | `SYSTEM_ADMIN` | Create account |
| PATCH | `/users/:id` | `SYSTEM_ADMIN` | Update account |
| PATCH | `/users/:id/deactivate` | `SYSTEM_ADMIN` | Deactivate account |
| PATCH | `/users/:id/reactivate` | `SYSTEM_ADMIN` | Reactivate account |
| PATCH | `/users/:id/reset-password` | `SYSTEM_ADMIN` | Reset staff password |
| POST | `/learners/:id/reset-password` | `SYSTEM_ADMIN` | Reset learner password |
| POST | `/historical-correction/authorize` | `SYSTEM_ADMIN` | Open a time-limited historical correction window |
| POST | `/historical-correction/relock` | `SYSTEM_ADMIN` | Relock historical records |
| GET | `/system/health` | `SYSTEM_ADMIN` | Server, database, and runtime health |
| GET | `/dashboard/stats` | `SYSTEM_ADMIN` | Administration dashboard metrics |

Base path: `/api/audit-logs`; all routes require `SYSTEM_ADMIN`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Paginated audit trail |
| GET | `/filters` | Available actors, actions, and subjects |
| GET | `/export` | CSV audit export |

## Exports

Base path: `/api/export`; routes require `HEAD_REGISTRAR` or `SYSTEM_ADMIN`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/sf1/:sectionId` | Export section SF1 |
| GET | `/lis-master` | Export LIS masterlist |

## Integration Triggers

Base path: `/api/integration`

| Method | Path | Auth and roles | Direction | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/smart/sections/:id/sync-grades` | `SYSTEM_ADMIN` | SMART to EnrollPro | Pull section grades and update final averages by LRN |
| POST | `/atlas/sync-faculty` | `SYSTEM_ADMIN` | EnrollPro to ATLAS trigger | Ask ATLAS to reconcile EnrollPro faculty |
| GET | `/atlas/faculty/:id/teaching-load` | Staff JWT | ATLAS to EnrollPro proxy | Read a teacher's ATLAS assignments |
| POST | `/broadcast/phase1` | `SYSTEM_ADMIN` | Orchestration | Trigger phase-one integration actions |
| POST | `/broadcast/phase2` | `SYSTEM_ADMIN` | Orchestration | Record phase-two roster distribution actions |

## Partner Integration v1

Base path: `/api/integration/v1`

Existing ATLAS, SMART, and AIMS endpoints remain public and read-only for compatibility. The MRF feed is service-key protected. All payloads are DPA-minimized for their stated consumer.

| Method | Path | Auth | School-year scope | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/health` | Public | None | EnrollPro DB plus ATLAS, AIMS, and SMART connectivity |
| GET | `/school-year` | Public | Optional `schoolYearId` | Resolve school-year ID and label |
| GET | `/learners` | Public | Optional `schoolYearId` | Paginated current or archived learner roster |
| GET | `/students` | Public alias | Optional `schoolYearId` | Alias of `/learners` |
| GET | `/faculty` | Public | Optional `schoolYearId` | Paginated faculty and designation context |
| GET | `/teachers` | Public alias | Optional `schoolYearId` | Alias of `/faculty` |
| GET | `/staff` | Public | Not school-year bound | Active EnrollPro staff accounts, excluding MRF compatibility role |
| GET | `/sections` | Public | Optional `schoolYearId` | Sections, grade levels, capacity, count, and adviser |
| GET | `/sections/:sectionId/learners` | Public | Optional `schoolYearId` | Current or archived section roster |
| GET | `/default/faculty` | Public | Optional `schoolYearId` | ATLAS-ready active faculty feed |
| GET | `/default/smart/students` | Public | Optional `schoolYearId` | SMART-ready current or archived grade roster |
| GET | `/default/aims/context` | Public | Optional `schoolYearId` | AIMS-ready current or archived learner context |
| GET | `/default/mrf/identities` | `X-Integration-Key` | Optional `schoolYearId` | MRF learner, teacher, staff, and MRF-role identity groups |

### MRF Identity Feed

Configure the EnrollPro server with `MRF_INTEGRATION_API_KEY` and send the value in `X-Integration-Key`. Missing, unconfigured, or incorrect keys return `401 INVALID_INTEGRATION_KEY`.

```bash
curl "https://dev-jegs.buru-degree.ts.net/api/integration/v1/default/mrf/identities?schoolYearId=12" \
  -H "X-Integration-Key: <service-key>"
```

The response groups `learners`, `teachers`, and `staff`. It includes stable identifiers, names, roles, account status, employee ID or LRN, and current grade and section where applicable. It excludes passwords, birthdates, family details, medical information, and audit-security fields.

### Current and Archived Rosters

Current feeds include applications in `OFFICIALLY_ENROLLED`, `ENROLLED`, or `SECTIONED` status that have an `EnrollmentRecord`. For an archived school year, learner, SMART, AIMS, section roster, and MRF feeds read `EnrollmentHistory` and identify the historical source in metadata.

## Public Address Reference

Base path: `/api/address`

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/regions` | PSGC regions |
| GET | `/provinces/:regionCode` | Provinces for region |
| GET | `/cities/:provinceCode` | Cities and municipalities for province |
| GET | `/barangays/:cityCode` | Barangays for city or municipality |

Compatibility base path: `/api/geography`

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/regions` | Region list |
| GET | `/provinces` | Provinces filtered by query parameters |
| GET | `/municipalities` | Cities and municipalities filtered by query parameters |
| GET | `/barangays` | Barangays filtered by query parameters |

## Unsupported Legacy Paths

The following route families appear in older documents but are not mounted by the current server and must not be used:

- `/api/curriculum/*`
- `/api/early-registrations/*`
- `/api/auth/learner-login`
- `/api/auth/logout-learner`
- `/api/applications/track/:trackingNumber`
- generic `/api/applications/:id/verify` and `/api/applications/:id/enroll`
- `/api/bosy/tle-programs`
- `/api/bosy/expected-queue`
- `/api/learner/confirm-return`
- `/api/learner/request-transfer`
- `/api/sections/:id/roster`

Use only the mounted alternatives documented above.
