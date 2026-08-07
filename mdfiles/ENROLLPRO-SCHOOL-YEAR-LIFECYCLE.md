# EnrollPro School Year Lifecycle for SMART, AIMS, ATLAS, and MRF

## Purpose

This guide explains how EnrollPro handles learner intake, class placement, End of School Year processing, archival, and transition to the next school year. It is intended for developers integrating SMART, AIMS, ATLAS, and MRF.

The implementation sources of truth are:

1. `server/prisma/schema.prisma`
2. `shared/src/constants/index.ts` and shared schemas
3. Mounted routes in `server/src/app.ts`
4. School-year, BOSY, sectioning, remedial, and EOSY services and controllers

The complete route catalog is in [ENROLLPRO-API.md](./ENROLLPRO-API.md).

## System Ownership

| System | Authoritative data | Data received from EnrollPro |
| --- | --- | --- |
| EnrollPro | Learner and personnel identity, enrollment applications, grade and section placement, school-year context, BOSY and EOSY lifecycle state | SMART final grades and ATLAS teaching-load context are pulled when required |
| SMART | Quarterly grades, final grades, attendance, and class records | Official section rosters, learner identity, grade level, and school year |
| AIMS | Courses, assessments, submissions, mastery, and remediation activities | Official learner context, section placement, program, and remedial requirement flag |
| ATLAS | Schedules, rooms, subjects, teaching loads, and faculty assignments | Faculty, designation, section, adviser, and school-year context |
| MRF | Maintenance and waste reports, dispatch, collection, and operational status | DPA-minimized learner and personnel identity context |

Companion systems must use EnrollPro identifiers and school-year scope. They must not create a competing enrollment or section masterlist.

## Academic Phases

`SchoolSetting.systemPhase` controls available workflows.

| Phase | EnrollPro behavior | Integration guidance |
| --- | --- | --- |
| `PRE_REGISTRATION` | Preparatory intake configuration | Do not treat applications as official enrollment |
| `BOSY_ENROLLMENT` | Beginning-of-year intake may be opened | Pull only records that have reached official section placement |
| `OFFICIAL_ENROLLMENT` | Regular enrollment, continuing confirmation, verification, and sectioning | Refresh sections and identity context frequently |
| `CLASSES_ONGOING` | Regular public intake is closed; authorized staff may encode late enrollees | Late additions become visible after section assignment |
| `EOSY_CLOSING` | Enrollment mutations are restricted and EOSY records are processed | SMART grade reconciliation must finish before final lock |

The public configuration endpoints expose the current phase and active school year. Internal EnrollPro requests may also carry `x-school-year-context-id`.

## BOSY Intake and Enrollment

### Continuing Learners

Full rollover creates a current-year `EnrollmentApplication` for eligible prior-year learners.

1. Eligible records enter `PENDING_CONFIRMATION`.
2. A registrar confirms the learner through `POST /api/bosy/confirm-return/:applicationId` or bulk confirmation.
3. EnrollPro checks SF9, accepted certification, PSA Birth Certificate, and the learner missing-requirements list.
4. Complete records move to `READY_FOR_SECTIONING` with `isTemporarilyEnrolled=false`.
5. Records with missing documents also move to `READY_FOR_SECTIONING`, but `isTemporarilyEnrolled=true` and `complianceStatus=PENDING`.
6. A learner who will not return moves to `TRANSFERRING_OUT` and is removed from the active intake and sectioning queues.

Confirmation does not create an `EnrollmentRecord`. It only makes the learner eligible for class placement.

### Incoming Grade 7, Transferees, and Walk-in Learners

1. Public applications enter through `POST /api/applications` or existing-learner updates through `POST /api/applications/update-existing`.
2. Authorized staff may use `POST /api/applications/special-enrollment` or `POST /api/enrollment/walk-in` for assisted intake.
3. Documentary review uses the enrollment verification and intake endpoints.
4. Cleared learners move to `READY_FOR_SECTIONING`.
5. Missing-document cases may be marked temporarily enrolled or deficient without delaying class placement.

### Section Assignment Boundary

The unassigned pool contains `READY_FOR_SECTIONING` applications with no `EnrollmentRecord`.

Class placement may use bulk assignment, reviewed draft commit, inline slotting, transfer, or batch sectioning. EnrollPro validates:

- the learner is still ready for sectioning
- the learner and section belong to the same school year
- grade level and curricular program match
- the learner does not already have an enrollment record
- section capacity is respected unless an authorized reviewed-draft override is used

Successful placement creates `EnrollmentRecord`, records the sectioning method, and changes the application to `OFFICIALLY_ENROLLED`. Legacy records may use `ENROLLED` or `SECTIONED`; integration feeds treat all three as officially sectioned.

After placement, SMART and AIMS may ingest the learner, ATLAS may use the updated section structure, and MRF may reconcile the learner identity.

## Classes Ongoing

When the phase becomes `CLASSES_ONGOING`:

- regular public intake is closed according to enrollment-window rules
- authorized staff may encode late enrollees
- confirmed or directly encoded applications are marked as late where applicable
- class placement still creates the authoritative enrollment record
- transfers and dropouts update learner lifecycle state and must be reflected in downstream systems

Partner systems should refresh EnrollPro feeds after sectioning, transfer, dropout, adviser, personnel, or school-year events. EnrollPro browser clients use authenticated SSE invalidation through `GET /api/events/stream`; this SSE stream is not a cross-service event bus.

## EOSY Processing

### Entering EOSY Closing

System administrators set the phase through `PATCH /api/settings/phase`. Entering `EOSY_CLOSING` restricts enrollment and learner-profile mutations that would invalidate year-end records.

### Grade and Status Reconciliation

1. EnrollPro may pull section grades from SMART through `POST /api/integration/smart/sections/:id/sync-grades`.
2. SMART records are matched to EnrollPro by LRN.
3. Registrars or advisers review final averages and set one EOSY result per learner:
   - `PROMOTED`
   - `CONDITIONALLY_PROMOTED`
   - `RETAINED`
   - `DROPPED_OUT`
   - `TRANSFERRED_OUT`
4. Conditionally promoted records may include an academic deficiency note and remedial requirement.
5. A section cannot be considered rollover-ready while learners lack EOSY results.

### Locking and Reports

1. Advisers may submit their advisory class through `/api/teacher-eosy`.
2. Registrars may update individual, batch, section, or grade-level EOSY records.
3. Sections and grade levels are finalized and locked.
4. SF5 is exported per section and SF6 is exported school-wide.
5. School-level finalization requires every section to be finalized.
6. Finalization activates the EOSY export lock and writes `EnrollmentHistory` snapshots.
7. Emergency reopening and historical correction require authorized administrative actions and audit records.

Grade 10 learners marked `PROMOTED` become `JHS_COMPLETER`. Companion portals must not grant active learner access to JHS completers.

## Full School Year Rollover

### Readiness Gate

`GET /api/system/rollover-readiness` and the rollover service require:

- school-level EOSY finalization
- every section locked
- no enrollment record with a missing EOSY status

If the gate fails, rollover returns `422` with class-level blockers.

### Atomic Rollover Work

`POST /api/school-years/rollover` performs the complete transition in a Prisma transaction:

1. Resolve the finalized source school year and the target year label and schedule.
2. Create or clean the target school-year shell.
3. Clone grade-level section structure, capacity, program, ordering, and section rank.
4. Do not copy learners, enrollment records, or active advisers into target sections.
5. Snapshot source enrollment records into `EnrollmentHistory`.
6. Carry forward learner academic outcomes and previous-year context.
7. Create target-year BOSY applications for eligible continuing learners.
8. Revoke active source-year adviserships.
9. Remove live source applications and enrollment records after history is written.
10. Archive the source year, activate the target year, set `OFFICIAL_ENROLLMENT`, write an audit log, and broadcast realtime invalidations.

### Rollover Outcome Matrix

| Source learner | Target result |
| --- | --- |
| Grade 7 to 9 `PROMOTED` | Next grade, `PENDING_CONFIRMATION` |
| Grade 7 to 9 `CONDITIONALLY_PROMOTED` | Next grade, `PENDING_CONFIRMATION`, remedial flag retained |
| Grade 7 to 9 `RETAINED` | Same grade, `PENDING_CONFIRMATION` |
| Grade 10 `PROMOTED` | `JHS_COMPLETER`; no active target application |
| Grade 10 `CONDITIONALLY_PROMOTED` | Hidden Grade 10 `REMEDIAL_HOLD` |
| Grade 10 `RETAINED` | Grade 10 `PENDING_CONFIRMATION` |
| `TRANSFERRED_OUT` | Archived as transferred; no target application |
| `DROPPED_OUT` | Archived as dropped; no automatic target application |

Returning dropouts must use a manual Balik-Aral or returning learner intake path.

### Remedial Hold Resolution

`PATCH /api/remedial/:learnerId/resolve` accepts a summer grade and final outcome.

- `PROMOTED` updates historical EOSY data, marks the learner as JHS completer, and closes the hold as `REMEDIAL_RESOLVED`.
- `RETAINED` updates historical EOSY data and converts the hold to Grade 10 `PENDING_CONFIRMATION`.

Remedial holds are excluded from active intake, class placement, and official population feeds until resolved.

## Important Current Implementation Boundary

The current code exposes two separate school-closing operations:

- `POST /api/eosy/school-year/finalize` locks and archives EOSY, writes history, and creates or activates a next-school-year shell.
- `POST /api/school-years/rollover` performs the complete learner carryover, source cleanup, section cloning, adviser revocation, and BOSY queue creation.

A next-year shell is not proof that rollover is complete. Companion systems must wait until the full rollover endpoint succeeds and the new-year feeds contain the expected section and learner context. Do not synchronize solely because a new school year is marked active.

## Companion-System Synchronization Sequence

### Before EOSY Finalization

- SMART publishes complete section grades and resolves unmatched LRNs.
- EnrollPro pulls SMART grades and finalizes all EOSY statuses.
- ATLAS may continue serving current-year schedules but must not infer next-year assignments.
- AIMS closes current-year intervention work against the current school-year ID.
- MRF continues operational work but must retain the school-year identifier attached to identity snapshots.

### After Full Rollover

1. Check `GET /api/integration/v1/health`.
2. Resolve the target year with `GET /api/integration/v1/school-year`.
3. ATLAS refreshes faculty and new empty section structures.
4. EnrollPro completes BOSY confirmations and class placement.
5. SMART and AIMS refresh only officially sectioned learners.
6. MRF refreshes `/default/mrf/identities` with its service key.
7. Each system stores `schoolYearId`, generated time, and its last successful synchronization result.

### Archived-Year Reconciliation

When `schoolYearId` points to an archived year, learner, SMART, AIMS, section roster, and MRF identity feeds use `EnrollmentHistory` where live applications and records have been removed. Consumers should expect `source: ENROLLMENT_HISTORY`, nullable live record identifiers, and final EOSY values.

## Reliability, Privacy, and Audit Rules

- Always scope synchronization by `schoolYearId`; never merge records from different years.
- Use learner `externalId` as the stable cross-system identity and LRN as the DepEd identifier.
- Treat retries as idempotent upserts keyed by stable identity plus school year.
- Preserve the last successful snapshot if EnrollPro is temporarily unreachable.
- Do not connect companion systems directly to the EnrollPro PostgreSQL database.
- Do not synchronize passwords, parent details, health records, or unrelated learner PII.
- Keep integration keys outside source control and rotate them after exposure.
- Record synchronization time, source endpoint, school-year scope, row count, and failures.
- Do not write grades, schedules, interventions, or maintenance records back into EnrollPro unless a mounted, documented endpoint explicitly owns that operation.
