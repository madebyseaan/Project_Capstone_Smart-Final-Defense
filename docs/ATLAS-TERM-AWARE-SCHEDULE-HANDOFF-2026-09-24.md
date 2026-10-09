# AIMS / SMART handoff — consuming ATLAS's term-aware published schedule

**To:** the AIMS and SMART owners. **From:** ATLAS (Lane A); first issued 2026-09-22,
**re-pinned 2026-09-24**.
**Pinned to deployed ATLAS release:** `70a5160819349f5ea0742b839c11606e8408185d`
(short `70a51608`; release dir `E:\ATLAS-runtime-supervised-70a51608-20260924`; served on
`https://njgrm.buru-degree.ts.net`). The previous pin was the superseded
`5a333c74de03df11e0d0bf9ec6839c1916798896`. The **published read contract is unchanged**
by the re-pin; §5A is the new draft-read family, authored on this pin's lineage
(repository base `530e3b19`).

**This replaces a deleted document.** `docs/reference/aims-smart-term-aware-api-context-2026-08-27.md`
and `docs/guides/AIMS_FETCH_PUBLISHED_SCHEDULES_GUIDE.md` were removed from tracking on 2026-08-28 by
`4794bd9e` (`docs/*` is gitignored and `docs/guides/` was not whitelisted). **Do not code against them.**
The contract has since changed in ways that would break a caller written from that doc — see §6.

Everything below was verified against the **live payload** at that pin and the **source** at the same
commit. Where a claim comes from source only, it says so.

---

## 1. Base URL and authentication

- Base: `https://njgrm.buru-degree.ts.net/api/v1`
- **The schedule-read endpoints are public** — no token. Verified: an unauthenticated
  `GET /schools/1/schedules/published` returns `200`.
- The **only** authenticated route in this family is the change-feed
  `GET /schools/:schoolId/:schoolYearId/schedules/published-events` (Server-Sent Events), which
  requires a JWT (`extractSseToken`; `401 NO_TOKEN` / `401 INVALID_TOKEN`). Treat it as optional.

## 2. Endpoint family

Read routes (all public, all `GET`, all mounted at `/api/v1`):

| Purpose | Path |
| --- | --- |
| Whole-school schedule | `/schools/:schoolId/schedules/published` |
| Section | `/schools/:schoolId/schedules/published/sections/:sectionId` |
| Faculty (ATLAS id) | `/schools/:schoolId/schedules/published/faculty/:facultyId` |
| **Faculty (external id)** | `/schools/:schoolId/schedules/published/faculty-external/:externalFacultyId` |
| Room | `/schools/:schoolId/schedules/published/rooms/:roomId` |
| Explicit school year (whole school) | `/schools/:schoolId/school-years/:schoolYearId/schedules/published` |
| Explicit school year (section / faculty / room / faculty-external) | `…/school-years/:schoolYearId/schedules/published/{sections/:sectionId,faculty/:facultyId,rooms/:roomId,faculty-external/:externalFacultyId}` |

`faculty-external/:externalFacultyId` is the companion-friendly lookup: it resolves by the **external**
faculty identifier you already hold, not by an ATLAS surrogate id.

There are also legacy `:termId` path variants (`/schools/:schoolId/schedules/published/:termId`, and
`:termId/{sections,faculty,rooms}/…`). **Prefer the `termIndex` query form** (§3) — the path form is
kept for compatibility and is not the shape this handoff documents.

## 3. Request contract

| Param | Where | Values | Notes |
| --- | --- | --- | --- |
| `termIndex` | query | `1`, `2`, `3`, `4`, or `active` | `4` is `MAX_ACADEMIC_TERM_INDEX` (`QUARTER_TERM_COUNT = 4`). Anything else → `400 INVALID_TERM_INDEX`. |
| `date` (or `asOfDate`) | query | an ISO date string | Optional; resolves the schedule as of a date. Echoed as `source.requestedDate` / `source.resolvedForDate`. |

**On the whole-school and `faculty-external` read routes, omitting `termIndex` resolves to
`active`** — it does **not** return all terms. Some route variants instead return
`400 TERM_SELECTION_REQUIRED` when no term is chosen (`requireTermSelection` in
`atlas-server/src/routes/published-schedule.router.ts`). **Always send an explicit `termIndex`.**

## 4. Response contract

Top level: `source`, `timeSlots`, `specialEvents`, `entries`.

### 4.1 `source` — the provenance and term-scope block

Live example (`?termIndex=1`, run 315):

```json
{
  "runId": 315, "schoolId": 1, "schoolYearId": 10, "schoolYearLabel": "2031-2032",
  "isActiveSchoolYear": true, "isHistorical": false,
  "publishedAt": "2026-09-18T05:38:27.923Z", "generatedAt": "2026-09-18T05:35:28.968Z",
  "requestedDate": null, "resolvedForDate": "2026-09-22T12:54:32.337Z",
  "activeRevisionId": 42, "activeRevisionEffectiveDate": "2026-09-18T05:38:27.923Z",
  "appliedRevisionIds": [42],
  "revisionMarker": "run=315|published=2026-09-18T05:38:27.923Z|revision=42|effective=2026-09-18T05:38:27.923Z|date=2026-09-22",
  "snapshotState": "FROZEN", "snapshotGaps": [],
  "termScope": "active", "termIndex": 1, "activeTermVerified": true,
  "orderedTerms": [
    { "order": 1, "identity": "T1", "displayLabel": "TERM 1" },
    { "order": 2, "identity": "T2", "displayLabel": "TERM 2" },
    { "order": 3, "identity": "T3", "displayLabel": "TERM 3" }
  ]
}
```

- **`orderedTerms` is the authoritative term list.** Use `displayLabel` for anything a human reads and
  `identity`/`order` as the stable key. Do **not** hardcode "Term 1/2/3" — the count and labels come
  from the upstream ordered-term authority, and the school year is `TRIMESTER` here (T1/T2/T3) while
  `termIndex` still ranges to 4.
- **`termScope` + `termIndex`** state what the payload actually covers. `"active"` means the resolved
  active term, with `termIndex` naming it.
- **`revisionMarker` is the cheapest change-detection key.** Store it and re-fetch when it differs.
  `activeRevisionId` / `appliedRevisionIds` / `activeRevisionEffectiveDate` give the revision detail.
- **`snapshotState` / `snapshotGaps`** describe whether the underlying generation input snapshot is
  frozen or has gaps. Treat `snapshotGaps` non-empty as "this payload may be incomplete" and surface
  it rather than silently rendering.
- `isHistorical` / `isActiveSchoolYear` let you label an archived year correctly.

### 4.2 `entries[]` — the schedule rows

Each entry carries its own `termIndex`, so a multi-term consumer can filter client-side without
guessing:

```json
{
  "entryId": "entry-1::t1", "day": "THURSDAY", "startTime": "06:00", "endTime": "06:45",
  "durationMinutes": 45, "termIndex": 1,
  "subject":  { "id": 4, "code": "AP", "name": "Araling Panlipunan" },
  "section":  { "atlasId": 1350, "externalId": 143, "id": 143, "name": "Aguinaldo",
                "gradeLevel": 17, "gradeLevelName": "Grade 7",
                "programType": "REGULAR", "programCode": "REGULAR", "programName": "Regular" },
  "faculty":  { "atlasId": 39, "externalId": "72", "employeeId": "1000011", "id": 39,
                "name": "VALDEZ, GABRIELA LUZ", "isPlaceholder": false },
  "room":     { "id": 65, "name": "G10 Room 101", "type": "CLASSROOM", "floor": "1",
                "buildingId": 4, "buildingName": "Grade 10 Academic Wing" },
  "entryKind": "SECTION", "cohortCode": null, "cohortName": null,
  "specializationCode": null, "specializationLabel": null
}
```

**Join keys for you:** `faculty.externalId` (string) and `faculty.employeeId` are the identifiers to
match against your own faculty records — prefer those over `faculty.id`/`faculty.atlasId`, which are
ATLAS surrogates. `section.externalId` is the upstream section id. `faculty.isPlaceholder` marks a
non-real assignment; do not present a placeholder as a person.

`timeSlots[]` is `{ "startTime": "06:00", "endTime": "06:45" }`. `specialEvents[]` is a list of the
school's configured non-teaching windows (including breaks); use both to render a correct grid rather
than inferring periods from entry times. Breaks are **only** in `specialEvents[]` — a consumer that
builds a grid from `entries[]` alone will show **no break bands at all**. See §4.4.

### 4.3 Room identity and the room-lookup trap

**Each entry's room is the nested `room` object** (`entry.room.id` is the **ATLAS** `Room.id`, not an
upstream id):

```json
"room": { "id": 65, "name": "G10 Room 101", "type": "CLASSROOM", "floor": "1",
          "buildingId": 4, "buildingName": "Grade 10 Academic Wing" }
```

- **ATLAS `Room` has no external id, and there is no room external-id lookup endpoint** (unlike
  `faculty-external/:externalFacultyId`). The only room identifier ATLAS exposes is the surrogate
  `room.id`.
- `GET …/published/rooms/:roomId` expects the **ATLAS `Room.id`**. Passing an *external/upstream*
  room id is a silent trap: if no ATLAS room has that integer the response is still **200 with an
  empty `entries[]`**, and if the integer happens to collide with a different ATLAS room you get
  **another room's schedule**. Neither case errors.
- **Safe mapping path.** Do not construct a room id from your own records. Read the whole-school
  payload (`GET …/school-years/:schoolYearId/schedules/published?termIndex=<n>`), collect the distinct
  `entries[].room` objects, and key them by `room.id` (deduplicate by `room.name` + `buildingName`
  where it helps a human). Only then call `…/rooms/:roomId` with that ATLAS `room.id`. If your own
  system holds a different room identifier, maintain your own room crosswalk — ATLAS cannot resolve
  it for you.

### 4.4 `specialEvents[]`, breaks, and the break-scope ambiguity

Each `specialEvents[]` element has exactly this shape — **there is no `eventType` field**:

```json
{ "eventName": "Lunch Break", "startTime": "11:30", "endTime": "12:15",
  "dayOfWeek": null, "days": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] }
```

- **Breaks are never in `entries[]`.** If you render only `entries`, break bands disappear.
- `dayOfWeek: null` (with `days` = the five weekdays) is the normal school-wide case. A day-scoped
  event (e.g. a Monday-only flag ceremony) carries a concrete `dayOfWeek` and a single-entry `days`.
- **Duplicate windows are real and are NOT duplicates to be de-duplicated away.** At the pinned live
  release, term 1 carries **two `"Lunch Break"` windows** (`11:30–12:15`, `12:15–13:00`) and **two
  `"Health Break"` windows** (`09:00–09:15`, `15:15–15:30`); the whole payload has 5 special events
  (the four break windows plus the flag ceremony). Different grade/shift groups legitimately have
  different break boundaries, and the published union keeps each distinct window.
- **Break scope is genuinely ambiguous in this projection — do not assume it.** ATLAS's canonical
  class-program rows do carry `(gradeLevel, programType)`, but the display grid unions every scope's
  break rows and de-duplicates them by `startTime–endTime` alone, so the grade/shift scope is lost
  before the payload is built. A single emitted window may belong to one grade group, several, or
  **none** (a policy flag overlay or the legacy policy fallback). ATLAS therefore does **not** emit a
  `scope`/`gradeGroup` field on `specialEvents[]` (adding one would either change the event count or
  assert a scope the union cannot prove). **Consumers that need a grade/shift-attributed break band
  must derive it from the owning class-program rows**, not from `specialEvents[]`; treat this array
  as the school-wide union of non-teaching windows. (This is the resolved outcome of the
  SMART-DRAFT-READ-S3 Deliverable-2 investigation; the in-source note is at
  `atlas-server/src/services/published-schedule.service.ts` `buildSpecialEventsPayload`.)

### 4.5 Verified counts at the 2026-09-24 pin

`GET /schools/1/school-years/<active>/schedules/published?termIndex=1` → **200**, **920 entries**,
every entry `termIndex: 1`, run **317** / revision **43**, `snapshotState: FROZEN`. `timeSlots`
non-empty; `specialEvents` count 5 (two `Lunch Break`, two `Health Break`, one flag ceremony) as
described in §4.4.

## 5. Error contract

| Status | `code` | When |
| --- | --- | --- |
| `400` | `INVALID_TERM_INDEX` | `termIndex` is not `1..4` and not `active` |
| `400` | `TERM_SELECTION_REQUIRED` | the route requires an explicit term and none was supplied |
| `400` | `INVALID_PARAM` | a path id is non-numeric / non-positive |
| `409` | `ACTIVE_SCHOOL_YEAR_AMBIGUOUS` | more than one active school year is configured — the scope cannot be resolved |
| `404`-family | `CURRENT_PUBLISHED_RUN_NOT_FOUND`, `FACULTY_NOT_FOUND` | no published run / unknown faculty |
| `401` | `NO_TOKEN` / `INVALID_TOKEN` | SSE change-feed only |

**Handle `409 ACTIVE_SCHOOL_YEAR_AMBIGUOUS` explicitly** — it means "ask a human which year", not
"retry".

## 6. Migration warning — what changed since the deleted 2026-08-27 doc

If you have a caller written against the deleted doc, these are the breaking differences:

1. **Omitting `termIndex` no longer means "all terms".** It resolves `termScope = "active"` with a
   concrete `termIndex` (observed `1`). The old doc promised a null/all-term read.
2. **The response gained `source.termScope`, `source.orderedTerms`, `source.snapshotState`,
   `source.snapshotGaps`, `source.revisionMarker`, `source.activeRevisionId`,
   `source.appliedRevisionIds`, `source.activeRevisionEffectiveDate`, `source.activeTermVerified`** —
   none of which the old doc described. Use `revisionMarker` for change detection instead of
   re-fetching blindly.
3. **`entries[].termIndex` is now present on every row.**
4. **Term labels must come from `source.orderedTerms`**, not from a hardcoded list.

## 7. Recommended integration

1. `GET …/schedules/published?termIndex=<n>` per term you display, always explicit.
2. Persist `source.revisionMarker`; poll or SSE on change, then refetch.
3. Join faculty on `faculty.externalId` / `faculty.employeeId`; skip `isPlaceholder: true`.
4. Label terms from `source.orderedTerms[].displayLabel`.
5. Surface `snapshotGaps` and `ACTIVE_SCHOOL_YEAR_AMBIGUOUS` to a human rather than degrading silently.

## 8. Acceptance tests

1. **Term scoping:** `?termIndex=1|2|3` each return 200 and every entry's `termIndex` equals the
   requested value.
2. **No implicit all-term read:** omitting `termIndex` must not be treated as "all terms" — assert the
   response declares `source.termScope` and a concrete `source.termIndex`.
3. **Typed rejection:** `?termIndex=0`, `?termIndex=5` and `?termIndex=abc` return
   `400 INVALID_TERM_INDEX`; a non-numeric `:schoolId` returns `400 INVALID_PARAM`.
4. **Change detection:** two successive reads with no regeneration return the same
   `source.revisionMarker`.
5. **Faculty mapping:** `faculty-external/:externalFacultyId` resolves the same person as the
   corresponding `faculty.externalId` in the whole-school payload.
6. **Label authority:** a term whose `displayLabel` differs from `TERM <order>` renders the
   `displayLabel`.

## 8A. Draft schedule read (new — share-gated, term-scoped)

Companions can read a teacher's **draft** (not-yet-published) schedule through a separate,
read-only family. Draft reads are **never public**: they require a credential and are gated by
an explicit per-run sharing switch that defaults OFF.

### Routes (mounted at `/api/v1`)

| Purpose | Path |
| --- | --- |
| Teacher (external id) | `GET /schools/:schoolId/school-years/:schoolYearId/schedules/draft/faculty-external/:externalFacultyId?termIndex=<n>` |
| Section | `GET /schools/:schoolId/school-years/:schoolYearId/schedules/draft/sections/:sectionId?termIndex=<n>` |
| Share toggle (scheduler) | `PATCH /generation/:schoolId/:schoolYearId/runs/:runId/draft-sharing` body `{ "enabled": true\|false }` |

**A whole-run / whole-school draft read is deliberately NOT offered.** There is no
`GET …/schedules/draft` route; that path returns the app's plain `404`. This is the
locked decision **D3 ("Never expose whole-school drafts")**: a single run-wide
response would hand every teacher's unpublished draft to any authenticated caller,
which D3 forbids. Only the two **param-scoped** reads exist, and both are still
gated by the per-run sharing toggle (default OFF). The section read is kept because
it is the published-family section mirror for a section-scoped integration client
and it returns exactly one section in a single response; it cannot return
whole-school data. For a teacher's own view, use `faculty-external`.

`school-years/:schoolYearId` is explicit on every read, so this family has no active-year
election and therefore no `ACTIVE_SCHOOL_YEAR_AMBIGUOUS`.

### Authentication (fail-closed)

- Reads accept the ATLAS **system token / integration key** (`X-Integration-Key` or
  `Authorization: Bearer <ATLAS_SYSTEM_TOKEN>`) or a valid ATLAS JWT. No credential → `401 NO_TOKEN`.
- The toggle is **JWT-only** and additionally requires the `timetable:edit` capability and
  actor-school equality; the system token is rejected there (`401`).

### The sharing switch (default OFF)

- A run's draft is readable **only** while `summary.draftSharedWithTeachers === true`. Otherwise
  every read fails `403 DRAFT_SHARING_DISABLED` with **zero payload**.
- Only a **`COMPLETED`, `FULL`, unpublished** run can be shared. A published run is never a draft:
  reading returns `404 DRAFT_RUN_NOT_FOUND` (details `reason: PUBLISHED_RUN_IS_NOT_A_DRAFT`) and
  sharing returns `409 RUN_ALREADY_PUBLISHED`.
- The toggle is a version-CAS update of the run summary plus a `DRAFT_SHARING_ENABLED` /
  `DRAFT_SHARING_DISABLED` audit row, committed together. Re-applying the current value is a
  zero-write `changed: false` response.

### Term scoping (mandatory)

`termIndex` is required and validated against the verified ordered-term contract, exactly like the
published family. `active` resolves through the verified active term.

### Payload

The producer is the existing term-normalized draft report plus an additive `source` block:

| Field | Meaning |
| --- | --- |
| `source.runId`, `source.schoolYearId` | run/year identity |
| `source.isDraft` | always `true` |
| `source.termScope`, `source.termIndex` | what the payload actually covers |
| `source.orderedTerms` | authoritative term list (`order` / `identity` / `displayLabel`) |
| `source.runStatus` | generation run status |
| `source.draftSharedWithTeachers` | `true` (a read is only possible while shared) |
| `source.inputFingerprint`, `source.inputStateStatus` | change-detection basis (`null` when unavailable) |
| `entries[]` | the **term-filtered**, scope-filtered draft rows (raw draft entry shape: `entryId`, `facultyId`, `sectionId`, `subjectId`, `roomId`, `day`, `startTime`, `endTime`, `durationMinutes`, `termIndex`) |
| `unassignedItems[]` | always `[]` — unassigned demand is run-wide and not attributable to one teacher/section, and there is no whole-run read to carry it |
| `summary`, `inputState`, `version`, `finishedAt`, `createdAt`, `status`, `runId` | reused producer fields |

The draft entry shape is **raw** (`roomId` / `sectionId` / `subjectId` are surrogate ids, not the
published nested objects). A companion that needs human-readable names must map them from the
published whole-school payload or its own mirrors.

### Scope enforcement

- `faculty-external` returns only that teacher's entries; `sections` returns only that section's
  entries (including cohort member sections). No route returns a whole run.
- A caller whose identity is faculty-scoped (a resolvable faculty identity, non-scheduler role) may
  read only its **own** teacher draft — otherwise `403 CROSS_FACULTY_DENIED`. Scheduler/officer/
  system-token callers are exempt.

### Draft error contract

| Status | `code` | When |
| --- | --- | --- |
| `400` | `TERM_INDEX_REQUIRED` | no `termIndex` supplied |
| `400` | `INVALID_TERM_INDEX` | not `1..4` and not `active` |
| `400` | `TERM_INDEX_OUTSIDE_CONTRACT` | index outside the verified contract (e.g. `4` on a trimester) |
| `400` | `INVALID_PARAM` / `INVALID_BODY` | bad path id / non-boolean toggle body |
| `401` | `NO_TOKEN` | no credential on a read; also a system token on the JWT-only toggle |
| `403` | `DRAFT_SHARING_DISABLED` | the run is not shared (default) |
| `403` | `CROSS_FACULTY_DENIED` | a self-identified teacher reading another teacher's draft |
| `403` | `FORBIDDEN` / `SCHOOL_SCOPE_REQUIRED` / `CROSS_SCHOOL_DENIED` | toggle capability / actor-school guards |
| `404` | `DRAFT_RUN_NOT_FOUND` | no completed FULL draft run, or the latest run is published |
| `404` | `FACULTY_NOT_FOUND` | unknown `externalFacultyId` |
| `409` | `TERM_STRUCTURE_UNAVAILABLE` / `TERM_SELECTION_REQUIRED` | unresolved ordered term |
| `409` | `RUN_ALREADY_PUBLISHED` | attempting to share a published run |
| `409` | `DRAFT_SHARING_UNAVAILABLE` / `DRAFT_SHARING_CONFLICT` | non-FULL/completed run / concurrent write |
| `501` | `TERM_FILTER_NOT_READY` | entries lack a reliable `termIndex` |

### Draft acceptance tests

1. **Scope:** a shared `faculty-external` read returns only that teacher's entries for the requested
   term; `sections` returns only that section's.
2. **Toggle OFF:** reads fail `403 DRAFT_SHARING_DISABLED` with no `entries` and no writes.
3. **Unauthenticated:** `401 NO_TOKEN`.
4. **Unknown faculty:** `404 FACULTY_NOT_FOUND`.
5. **Term:** missing → `400 TERM_INDEX_REQUIRED`; malformed → `400 INVALID_TERM_INDEX`;
   out-of-contract → `400 TERM_INDEX_OUTSIDE_CONTRACT`.
6. **Published run:** cannot be read as a draft (`404`) nor shared (`409 RUN_ALREADY_PUBLISHED`).
7. **Cross-faculty:** a self-identified teacher reading another teacher's shared draft → `403 CROSS_FACULTY_DENIED`.
8. **D3:** the whole-run path `GET …/schedules/draft` is **absent** — the app returns a plain `404`
   (no scoped payload), never a `200` and never a `401`.

Executable matrix: `atlas-server/src/__tests__/smart-draft-read-s3.test.ts`.
SMART-facing summary: `docs/handoffs/smart-draft-read-s3-2026-09-24.md`.

## 9. Scope and open items

- **The API contract is stable at the pin.** ATLAS has two pending *client-side* term-scope lanes
  (`work/timetable-live-term-authority-c01`, `work/public-published-view-term-merge-c01`); **neither
  touches `atlas-server/**`**, so neither moves this contract. You do not need to wait for them.
- **Known ATLAS-side defect (flagged, not fixed here) — official Teacher Program DOCX omits
  `Lunch Break`.** Measured on the live run: the **Teacher Program** DOCX renders `Lunch Break: 0`,
  `Health Break: 2`, while the **Section/Grade** DOCX renders `Lunch Break: 5`, `Health Break: 10`.
  Root cause is **not yet pinned** (QA flagged the first draft of this lead as imprecise): the teacher
  program builds its display slots from `frozenSnapshot.displaySlots` **else**
  `run.summary.timetableDisplaySlots`. Two candidate paths must be reproduced and distinguished before
  any fix: (a) the *frozen* branch maps only `slot.kind === 'SPECIAL_EVENT'`, so a canonical BREAK row
  stored with a different `kind` would lose its `isSpecialEvent` flag; (b) the *fallback* branch reads
  `run.summary.timetableDisplaySlots`, which per `buildUnionDisplaySlots`
  (`schedule-constructor.ts`) **does** persist `isSpecialEvent`/`eventName`, so the fallback may instead
  *add* the break — meaning the two branches disagree about the same row. This is a **bounded successor**
  to schedule separately (`TEACHER-PROGRAM-LUNCH-BREAK-C01`); it does not change this read contract and
  must not be "fixed" from a companion lane. Until it is fixed, do not treat the Teacher Program DOCX
  break labels as authoritative.
- **Break-window scope is deliberately not exposed** (§4.4). The precise successor, if a
  grade/shift-attributed break band is ever required, is **`SPECIAL-EVENT-SCOPE-C01`**: the canonical
  BREAK rows (`classProgramSlot`) DO carry `(gradeLevel, programType)`, but
  `buildCanonicalDisplayGrid` unions every scope's BREAK rows and `dedupeIntervalSlots` (in
  `schedule-constructor.ts`) keys them by `startTime-endTime` alone, discarding the scope before the
  payload. Attributing each duplicate `Lunch Break` / `Health Break` window to its grade/shift group
  therefore requires **emitting per-scope events** rather than one unioned window — a
  **cardinality-changing, additive** contract change (`specialEvents[]` would grow, even though every
  existing field value is preserved). That trade-off was judged out of scope for
  SMART-DRAFT-READ-S3. Until it lands, keep the §4.4 ambiguity warning: treat `specialEvents[]` as the
  school-wide union and derive any grade/shift attribution from the owning class-program rows.
- **Not covered here:** writing schedules back to ATLAS, Teaching Load, enrolment, and the SSO
  federation handshakes (those are separate handoffs:
  `docs/handoffs/aims-direct-federation-c04.md`, `docs/handoffs/smart-direct-federation-c04.md`).
- **Ask before depending on the legacy `:termId` path variants** — they are compatibility surfaces,
  not the recommended contract.
