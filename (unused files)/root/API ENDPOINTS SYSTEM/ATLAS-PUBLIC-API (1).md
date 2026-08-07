# ATLAS REST API Reference

**Base URL:** `http://<host>:5001/api/v1`  
**Tailscale host:** `100.88.55.125`  
**Auth:** All protected endpoints require `Authorization: Bearer <token>` — the JWT issued by EnrollPro.  
**Content-Type:** `application/json` (all request bodies)

---

## Authentication

### `GET /auth/me`
Verify the bearer token and return the authenticated identity.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{
  "user": {
    "userId": 12,
    "role": "SYSTEM_ADMIN"
  }
}
```

---

## Health

### `GET /health`
Service liveness probe. No auth required.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

```json
{ "status": "ok", "service": "atlas" }
```

---

## Subjects

Public read endpoints are available; write and stats endpoints are protected.

### `GET /subjects?schoolId=<id>`
List all subjects for a school.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

```json
{
  "subjects": [
    {
      "id": 1,
      "code": "ENG",
      "name": "English",
      "minMinutesPerWeek": 240,
      "preferredRoomType": "REGULAR",
      "gradeLevels": ["GRADE_7", "GRADE_8"],
      "schoolId": 1
    }
  ]
}
```

---

### `GET /subjects/:id`
Get a single subject by ID.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

```json
{ "subject": { "id": 1, "code": "ENG", "name": "English", ... } }
```

---

### `GET /subjects/stats/:schoolId`
Subject dashboard counts for a school.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{
  "count": 9,
  "unassignedCount": 2,
  "unassigned": [{ "id": 5, "code": "AP", "name": "Araling Panlipunan" }]
}
```

---

### `POST /subjects` 🔒
Create a custom subject.

**Body:**
```json
{
  "schoolId": 1,
  "code": "HG",
  "name": "Homeroom Guidance",
  "minMinutesPerWeek": 60,
  "preferredRoomType": "REGULAR",
  "gradeLevels": ["GRADE_7"]
}
```

| | |
|---|---|
| **Auth** | Required |
| **Success** | `201 Created` |

```json
{ "subject": { "id": 10, "code": "HG", ... } }
```

---

### `PATCH /subjects/:id` 🔒
Update subject fields.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{ "subject": { "id": 10, "code": "HG", "name": "Homeroom Guidance", ... } }
```

---

### `DELETE /subjects/:id` 🔒
Delete a subject (blocked if it has active assignments).

| | |
|---|---|
| **Auth** | Required |
| **Success** | `204 No Content` 
---

### `POST /subjects/seed` 🔒
Seed the 9 default DepEd JHS subjects for a school (idempotent).

**Body:** `{ "schoolId": 1 }`

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{ "subjects": [ ... ] }
```

---

## Faculty

### `GET /faculty?schoolId=<id>` 🔒
List all faculty members mirrored for a school.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{
  "faculty": [
    {
      "id": 1,
      "externalId": 42,
      "firstName": "Maria",
      "lastName": "Santos",
      "employmentStatus": "PERMANENT",
      "isActiveForScheduling": true,
      "maxHoursPerWeek": 6,
      "version": 1
    }
  ],
  "lastSyncedAt": "2026-04-18T10:00:00.000Z"
}
```

---

### `GET /faculty/:id` 🔒
Get one faculty member by ATLAS internal ID.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{ "faculty": { "id": 1, "firstName": "Maria", ... } }
```

---

### `PATCH /faculty/:id` 🔒
Update local scheduling metadata for a faculty member. Requires `version` for optimistic locking.

**Body:**
```json
{
  "isActiveForScheduling": true,
  "maxHoursPerWeek": 5,
  "isClassAdviser": true,
  "advisoryEquivalentHours": 1,
  "version": 3
}
```

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{ "faculty": { "id": 1, "version": 4, ... } }
```

> Returns `409 Conflict` if `version` is stale.

---

### `POST /faculty/sync` 🔒
Trigger a full sync of faculty data from the EnrollPro adapter.

**Body:**
```json
{ "schoolId": 1, "schoolYearId": 1, "mode": "reconcile" }
```

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{
  "synced": true,
  "source": "enrollpro",
  "fetchedAt": "2026-05-11T03:12:56.956Z",
  "mode": "reconcile",
  "activeCount": 141,
  "staleCount": 0,
  "deactivatedCount": 0,
  "reconciliation": {
    "inserted": 0,
    "updated": 0,
    "removed": 0,
    "skipped": 141,
    "deactivated": 0
  }
}
```

### `POST /faculty/sync/reset` 🔒
Trigger deterministic prune reset from source-of-truth.

**Body:**
```json
{ "schoolId": 1, "schoolYearId": 1, "confirmPrune": true }
```

---

## Faculty Assignments (Subject-to-Faculty)

### `GET /faculty-assignments/summary?schoolId=<id>&schoolYearId=<id>` 🔒
Teaching load summary for all faculty in a school.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{
  "faculty": [
    {
      "facultyId": 1,
      "name": "Maria Santos",
      "assignedSubjects": ["ENG", "FIL"],
      "totalMinutesPerWeek": 480
    }
  ]
}
```

---

### `GET /faculty-assignments/:facultyId?schoolYearId=<id>` 🔒
Get all subject assignments for one faculty member.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{
  "assignments": [
    { "id": 1, "subjectId": 2, "subjectCode": "ENG", "gradeLevel": "GRADE_7" }
  ]
}
```

---

### `PUT /faculty-assignments/:facultyId` 🔒
Replace all subject assignments for a faculty member (full replace).

**Body:**
```json
{
  "schoolId": 1,
  "schoolYearId": 1,
  "version": 3,
  "assignments": [
    { "subjectId": 2, "gradeLevel": "GRADE_7" },
    { "subjectId": 3, "gradeLevel": "GRADE_8" }
  ]
}
```

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{ "assignments": [ ... ] }
```

---

## Sections

### `GET /sections/summary/:schoolYearId?schoolId=<id>` 🔒
Section counts and list for a school year, sourced from EnrollPro or stub.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{
  "totalSections": 12,
  "byGradeLevel": {
    "GRADE_7": 3,
    "GRADE_8": 3,
    "GRADE_9": 3,
    "GRADE_10": 3
  },
  "sections": [
    { "id": "ep-101", "name": "7-Rizal", "gradeLevel": "GRADE_7", "enrolled": 45 }
  ],
  "sourceMode": "enrollpro"
}
```

> Returns `503 Service Unavailable` if the upstream section source is unreachable.

---

## Faculty Preferences

### `GET /preferences/:schoolId/:schoolYearId/faculty/:facultyId` 🔒
Get a faculty member's time-slot preferences.

| | |
|---|---|
| **Auth** | Required (officer, admin, or own faculty ID) |
| **Success** | `200 OK` |

```json
{
  "preference": {
    "id": 5,
    "schoolId": 1,
    "schoolYearId": 2,
    "facultyId": 1,
    "status": "SUBMITTED",
    "notes": "Prefer mornings",
    "timeSlots": [
      { "day": "MONDAY", "startTime": "07:00", "endTime": "12:00", "preference": "PREFERRED" }
    ],
    "version": 2
  }
}
```

---

### `PUT /preferences/:schoolId/:schoolYearId/faculty/:facultyId/draft` 🔒
Save a draft preference (does not submit).

**Body:**
```json
{
  "timeSlots": [
    { "day": "MONDAY", "startTime": "07:00", "endTime": "12:00", "preference": "PREFERRED" },
    { "day": "FRIDAY", "startTime": "13:00", "endTime": "17:00", "preference": "UNAVAILABLE" }
  ],
  "notes": "Available Mon–Thu only",
  "version": 1
}
```

| | |
|---|---|
| **Auth** | Required (officer, admin, or own faculty ID) |
| **Success** | `200 OK` |

```json
{ "preference": { "id": 5, "status": "DRAFT", "version": 2, ... } }
```

---

### `POST /preferences/:schoolId/:schoolYearId/faculty/:facultyId/submit` 🔒
Submit preference (locks it; requires preference window to be open).

**Body:** Same as draft body + `"version": <n>`.

| | |
|---|---|
| **Auth** | Required (officer, admin, or own faculty ID) |
| **Success** | `200 OK` |

```json
{ "preference": { "id": 5, "status": "SUBMITTED", "version": 3, ... } }
```

> Returns `409 Conflict` if `version` is stale.  
> Returns `423 Locked` if the preference window is not open.

---

### `GET /preferences/:schoolId/:schoolYearId/summary` 🔒
Officer view: submission status for all faculty in a school year.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{
  "summary": [
    { "facultyId": 1, "name": "Maria Santos", "status": "SUBMITTED" },
    { "facultyId": 2, "name": "Jose Cruz", "status": "MISSING" }
  ]
}
```

---

### `PATCH /preferences/:schoolId/:schoolYearId/status` 🔒
Set the preference collection lifecycle status (officer/admin only).

**Body:** `{ "status": "PREFERENCE_COLLECTION" }` — one of `SETUP`, `PREFERENCE_COLLECTION`, `GENERATION`, `REVIEW`, `PUBLISHED`.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{ "status": "PREFERENCE_COLLECTION" }
```

---

## Scheduling Policy

### `GET /policies/scheduling/:schoolId/:schoolYearId` 🔒
Fetch scheduling policy for a school year (creates default if none exists).

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{
  "policy": {
    "id": 1,
    "schoolId": 1,
    "schoolYearId": 2,
    "dailyStartTime": "07:00",
    "dailyEndTime": "17:00",
    "periodDurationMinutes": 60,
    "lunchStartTime": "12:00",
    "lunchEndTime": "13:00",
    "enforceLunchWindow": true,
    "targetFacultyDailyVacantMinutes": 60,
    "targetSectionDailyVacantPeriods": 1,
    "maxCompressedTeachingMinutesPerDay": 360
  }
}
```

---

### `PUT /policies/scheduling/:schoolId/:schoolYearId` 🔒
Create or update scheduling policy.

**Body:** Any subset of policy fields.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{ "policy": { ... } }
```

---

## Schedule Generation

### `POST /generation/:schoolId/:schoolYearId/runs` 🔒
Trigger a new schedule generation run.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `201 Created` |

```json
{
  "run": {
    "id": 5,
    "schoolId": 1,
    "schoolYearId": 2,
    "status": "RUNNING",
    "triggeredBy": 12,
    "startedAt": "2026-04-18T10:05:00.000Z"
  }
}
```

---

### `GET /generation/:schoolId/:schoolYearId/runs/latest` 🔒
Get the most recent generation run.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{
  "run": {
    "id": 5,
    "status": "COMPLETED",
    "hardViolations": 0,
    "softViolations": 3,
    "fitnessScore": 0.94,
    "completedAt": "2026-04-18T10:05:42.000Z"
  }
}
```

---

### `GET /generation/:schoolId/:schoolYearId/runs/latest/violations` 🔒
Get constraint violations for the latest run.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{
  "violations": [
    {
      "type": "SOFT",
      "code": "FACULTY_PREFERENCE_VIOLATED",
      "message": "Maria Santos is scheduled on Friday afternoon (UNAVAILABLE preference).",
      "entityId": "entry-abc123"
    }
  ],
  "hardCount": 0,
  "softCount": 3
}
```

---

### `GET /generation/:schoolId/:schoolYearId/runs/latest/timetable` 🔒
Full timetable entries for the latest run.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{
  "entries": [
    {
      "id": "entry-abc123",
      "sectionId": "ep-101",
      "sectionName": "7-Rizal",
      "gradeLevel": "GRADE_7",
      "subjectCode": "ENG",
      "subjectName": "English",
      "facultyId": 1,
      "facultyName": "Maria Santos",
      "roomId": 3,
      "roomName": "Room 101",
      "day": "MONDAY",
      "startTime": "07:00",
      "endTime": "08:00"
    }
  ]
}
```

---

### `GET /generation/:schoolId/:schoolYearId/runs/latest/fix-suggestions` 🔒
AI-assisted suggestions for resolving hard violations.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{
  "suggestions": [
    {
      "entryId": "entry-abc123",
      "violationCode": "ROOM_CONFLICT",
      "suggestion": "Move 7-Rizal English to Room 102 at the same time."
    }
  ]
}
```

---

## Manual Edits (Timetable Review)

### `POST /generation/:schoolId/:schoolYearId/runs/:runId/manual-edits/preview` 🔒
Preview the effect of a manual edit without committing.

**Body:**
```json
{
  "editType": "REASSIGN_ROOM",
  "entryId": "entry-abc123",
  "newRoomId": 4
}
```

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{
  "conflicts": [],
  "newViolations": [],
  "resolvedViolations": ["entry-abc123:ROOM_CONFLICT"],
  "canCommit": true
}
```

---

### `POST /generation/:schoolId/:schoolYearId/runs/:runId/manual-edits/commit` 🔒
Commit a manual edit to the timetable (with optimistic lock check).

**Body:**
```json
{
  "proposal": { "editType": "REASSIGN_ROOM", "entryId": "entry-abc123", "newRoomId": 4 },
  "expectedVersion": 3,
  "allowSoftOverride": false
}
```

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{ "entry": { "id": "entry-abc123", "roomId": 4, ... }, "version": 4 }
```

> Returns `409 Conflict` if `expectedVersion` is stale (another editor changed the timetable).

---

## Follow-Up Flags

### `GET /follow-up-flags/:schoolId/:schoolYearId/runs/:runId/flags` 🔒
List all follow-up flags for a generation run.

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{
  "flags": [
    {
      "entryId": "entry-abc123",
      "flagged": true,
      "note": "Needs room change — waiting on principal approval",
      "flaggedBy": 12,
      "flaggedAt": "2026-04-18T11:00:00.000Z"
    }
  ]
}
```

---

### `PUT /follow-up-flags/:schoolId/:schoolYearId/runs/:runId/flags/:entryId` 🔒
Toggle or update a follow-up flag on a timetable entry.

**Body:** `{ "flagged": true, "note": "Optional note" }`

| | |
|---|---|
| **Auth** | Required (officer or admin) |
| **Success** | `200 OK` |

```json
{ "flag": { "entryId": "entry-abc123", "flagged": true, "note": "Optional note" } }
```

---

## Room Schedules

### `GET /room-schedules/:schoolId/:schoolYearId/rooms/:roomId?source=latest` 🔒
Get full weekly schedule for a room.

| Query `source` | |
|---|---|
| `latest` | Use the most recent committed timetable (default) |
| `run&runId=<id>` | Use a specific generation run |
| `draft` | Use currently staged manual draft entries |

| | |
|---|---|
| **Auth** | Required (faculty/teacher/officer/admin) |
| **Success** | `200 OK` |

```json
{
  "room": { "id": 3, "name": "Room 101", "buildingName": "Main Building" },
  "slots": [
    {
      "day": "MONDAY",
      "startTime": "07:00",
      "endTime": "08:00",
      "sectionName": "7-Rizal",
      "subjectCode": "ENG",
      "facultyName": "Maria Santos"
    }
  ]
}
```

---

## Published Schedules

**Public endpoints** (no auth required). These return only `Published` schedules.

### `GET /schools/:schoolId/schedules/published`
Get the current published schedule payload for a school.

### `GET /schools/:schoolId/schedules/published/:termId`
Get published schedule payload for a specific term.

### `GET /schools/:schoolId/schedules/published/sections/:sectionId`
Get current published schedule view for a section.

### `GET /schools/:schoolId/schedules/published/:termId/sections/:sectionId`
Get term-specific published schedule view for a section.

### `GET /schools/:schoolId/schedules/published/faculty/:facultyId`
Get current published schedule view for a faculty member.

### `GET /schools/:schoolId/schedules/published/:termId/faculty/:facultyId`
Get term-specific published schedule view for a faculty member.

### `GET /schools/:schoolId/schedules/published/rooms/:roomId`
Get current published schedule view for a room.

### `GET /schools/:schoolId/schedules/published/:termId/rooms/:roomId`
Get term-specific published schedule view for a room.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

```json
{
  "schoolId": 1,
  "termId": 1,
  "publishedAt": "2026-05-11T03:30:00.000Z",
  "entries": [
    {
      "sectionId": 101,
      "facultyId": 7947,
      "roomId": 3,
      "day": "MONDAY",
      "startTime": "07:00",
      "endTime": "08:00",
      "subjectCode": "ENG"
    }
  ]
}
```

---

## Campus Map

**Public endpoints** (no auth required).

### `GET /map/schools/:schoolId/buildings`
Get all buildings and their rooms for a school.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

```json
{
  "buildings": [
    {
      "id": 1,
      "name": "Main Building",
      "shortCode": "MB",
      "x": 100, "y": 80, "width": 200, "height": 150,
      "color": "#3B82F6",
      "rotation": 0,
      "floorCount": 3,
      "isTeachingBuilding": true,
      "rooms": [
        { "id": 3, "name": "Room 101", "floor": 1, "type": "REGULAR", "capacity": 45 }
      ]
    }
  ]
}
```

---

### `GET /map/schools/:schoolId/campus-image`
Get the campus image URL.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

```json
{ "campusImageUrl": "/uploads/campus-abc123.jpg" }
```

---

### `POST /map/schools/:schoolId/campus-image` 🔒
Upload a campus image (multipart/form-data, field name: `image`, max 5 MB, PNG/JPEG/WebP).

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{ "campusImageUrl": "/uploads/campus-newfile.png" }
```

---

### `POST /map/schools/:schoolId/buildings` 🔒
Create a building.

**Body:**
```json
{
  "name": "Science Wing",
  "shortCode": "SW",
  "x": 300, "y": 100, "width": 160, "height": 120,
  "color": "#10B981",
  "rotation": 0,
  "floorCount": 2,
  "isTeachingBuilding": true
}
```

| | |
|---|---|
| **Auth** | Required |
| **Success** | `201 Created` |

```json
{ "building": { "id": 2, "name": "Science Wing", ... } }
```

---

### `PATCH /map/buildings/:id` 🔒
Update building properties.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{ "building": { "id": 2, "name": "Science Wing", "color": "#F59E0B", ... } }
```

---

### `DELETE /map/buildings/:id` 🔒
Delete a building and all its rooms.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `204 No Content` |

---

### `POST /map/buildings/:buildingId/rooms` 🔒
Add a room to a building.

**Body:**
```json
{
  "name": "Room 201",
  "floor": 2,
  "type": "LABORATORY",
  "capacity": 40,
  "isTeachingSpace": true,
  "floorPosition": 1
}
```

| | |
|---|---|
| **Auth** | Required |
| **Success** | `201 Created` |

```json
{ "room": { "id": 10, "name": "Room 201", "floor": 2, ... } }
```

---

### `PATCH /map/rooms/:id` 🔒
Update room properties.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

```json
{ "room": { "id": 10, "name": "Room 201", "capacity": 42, ... } }
```

---

### `DELETE /map/rooms/:id` 🔒
Delete a room.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `204 No Content` |

---

## Common Error Responses

| Status | `code` | Meaning |
|--------|--------|---------|
| `400` | `INVALID_PARAM` | Path/query parameter invalid (type, range) |
| `400` | `MISSING_FIELDS` | Required body field absent |
| `400` | `INVALID_BODY` | Body shape/value invalid |
| `401` | `NO_USER` | Authenticated user identity missing |
| `403` | `FORBIDDEN` | Role not permitted for this endpoint |
| `404` | `NOT_FOUND` | Requested resource does not exist |
| `409` | `CONFLICT` | Optimistic lock version mismatch |
| `409` | `DUPLICATE` | Unique constraint violation |
| `423` | `WINDOW_CLOSED` | Lifecycle phase gate blocks the action |
| `503` | `UPSTREAM_UNAVAILABLE` | Upstream service (EnrollPro) unreachable |
| `500` | — | Unhandled server error |

All error responses follow the shape:
```json
{ "code": "ERROR_CODE", "message": "Human-readable description." }
```

---

## Connectivity (Tailscale)

```powershell
# ATLAS Backend API
Test-NetConnection -ComputerName 100.88.55.125 -Port 5001   # ✅ TCP Open

# PostgreSQL (direct — for DBA access only)
Test-NetConnection -ComputerName 100.88.55.125 -Port 5432   # ✅ TCP Open
```

> The ATLAS client dev server (`port 5174`) binds to `0.0.0.0` and is accessible at `http://100.88.55.125:5174` on the Tailscale network.
