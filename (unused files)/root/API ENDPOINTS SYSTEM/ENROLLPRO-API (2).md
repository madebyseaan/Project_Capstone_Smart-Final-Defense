# EnrollPro REST API Reference

This document provides a comprehensive reference for the EnrollPro backend API. It is aligned with the current routing structure in the `server` package.

## Runtime Endpoints

- **Local Base:** `http://localhost:5002/api`
- **Production Base:** `https://dev-jegs.buru-degree.ts.net/api`
- **Static Assets:** `/uploads/*` (e.g., `https://dev-jegs.buru-degree.ts.net/uploads/logo.png`)

## Auth Model

- **Protected Endpoints:** Require an `Authorization: Bearer <jwt>` header.
- **JWT Issuance:** Staff JWT obtained via `POST /api/auth/login`. Learner JWT obtained via `POST /api/auth/learner-login`.
- **Role-Based Access Control (RBAC):** Enforced at the router/route level using the following roles:
  - `SYSTEM_ADMIN`: Full system access, management of users, settings, and school years.
  - `HEAD_REGISTRAR`: Management of admissions, enrollments, sections, and reports.
  - `TEACHER`: Read-only access to relevant stats, student lists, and school year data.
  - `LEARNER`: Limited self-service access (confirm BOSY intent). Isolated JWT payload — no `userId`, uses `learnerId` + `enrollmentApplicationId`.

## Response Conventions

- **Success:** JSON objects with descriptive keys. Some endpoints return envelope-style `{ "data": ... }`.
- **Errors:** Standard HTTP status codes with a JSON body:
  ```json
  { "message": "Error description", "code": "ERROR_CODE" }
  ```
- **Validation Failures:** Return `400 Bad Request` or `422 Unprocessable Entity` with details on specific field failures.

---

## 1) Platform Health

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| GET | `/api/health` | None | Basic health check. Returns `{ "ok": true }`. |
| GET | `/api/ping` | None | Returns "pong". |

---

## 2) Authentication (`/api/auth`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/api/auth/login` | None | - | Authenticates staff user and returns JWT + profile. |
| POST | `/api/auth/learner-login` | None | - | Authenticates a returning learner by LRN + portal PIN. Returns a `LEARNER`-role JWT. |
| POST | `/api/auth/verify` | None | - | Verifies credentials without establishing a session. |
| POST | `/api/auth/logout` | None | - | Invalides current session (if applicable). |
| GET | `/api/auth/me` | Required | All Staff | Returns current user profile from JWT. |
| PATCH | `/api/auth/change-password` | Required | All Staff | Updates user password. |

### Sample: `POST /api/auth/login`
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "firstName": "SYSTEM",
    "lastName": "ADMINISTRATOR",
    "email": "admin@deped.edu.ph",
    "role": "SYSTEM_ADMIN",
    "sex": "MALE",
    "employeeId": "SYSADMIN-001",
    "mustChangePassword": false
  }
}
```

### Sample: `POST /api/auth/learner-login`

**Request body:**
```json
{ "lrn": "123456789012", "pin": "082915" }
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "learner": {
    "id": 101,
    "lrn": "123456789012",
    "firstName": "JUAN",
    "lastName": "DELA CRUZ",
    "middleName": "SAMSON",
    "enrollmentApplicationId": 45,
    "schoolYear": { "id": 2, "yearLabel": "2026-2027" },
    "gradeLevel": { "name": "Grade 8" },
    "applicationStatus": "PENDING_CONFIRMATION"
  }
}
```

> **PIN dual-state:** Admin-reset PINs are stored as plain text and must match exactly. Learner-personalized PINs are bcrypt-hashed. The login handler uses `verifyPin()` for bcrypt hashes automatically.

---

## 3) Settings (`/api/settings`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/settings/public` | None | - | Public branding and active SY context. |
| GET | `/api/settings/scp-config` | None | - | Active Special Curricular Program configs. |
| PUT | `/api/settings/identity` | Required | ADMIN | Update school name, email, and social links. |
| POST | `/api/settings/logo` | Required | ADMIN | Upload school logo (extracts accent color). |
| DELETE | `/api/settings/logo` | Required | ADMIN | Resets logo and theme to defaults. |
| PUT | `/api/settings/accent` | Required | ADMIN | Manually override the theme accent color. |

### Sample: `GET /api/settings/public`
```json
{
  "schoolName": "EnrollPro Integrated School",
  "logoUrl": "/uploads/logo_1715380000.png",
  "colorScheme": {
    "palette": [{ "hsl": "221 83% 53%", "count": 1200 }],
    "accent_foreground": "white"
  },
  "selectedAccentHsl": "221 83% 53%",
  "activeSchoolYearId": 1,
  "activeSchoolYearLabel": "2026-2027",
  "enrollmentPhase": "OPEN",
  "systemStatus": "ACTIVE",
  "portalControl": "AUTO"
}
```

---

## 4) Dashboard (`/api/dashboard`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/dashboard/stats` | Required | ALL STAFF | Aggregated enrollment and admission metrics. |

### Sample: `GET /api/dashboard/stats`
```json
{
  "stats": {
    "totalPending": 12,
    "totalEnrolled": 145,
    "totalPreRegistered": 28,
    "sectionsAtCapacity": 3,
    "enrollmentTarget": {
      "current": 145,
      "target": 560,
      "seatsRemaining": 415,
      "progressPercent": 25.9
    },
    "gradeLevelBreakdown": [
      { "id": 1, "name": "Grade 7", "current": 40, "target": 160, "progressPercent": 25.0 }
    ],
    "earlyRegistration": {
      "submitted": 45,
      "verified": 32,
      "examScheduled": 10,
      "readyForEnrollment": 5,
      "total": 92
    }
  }
}
```

---

## 5) School Years (`/api/school-years`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/school-years` | Required | ALL STAFF | List all academic years. |
| GET | `/api/school-years/next-defaults` | Required | ADMIN | Get suggested dates for the next SY. |
| GET | `/api/school-years/:id` | Required | ADMIN | Detailed SY configuration. |
| POST | `/api/school-years/activate` | Required | ADMIN | Create and activate a new academic year. |
| POST | `/api/school-years/rollover` | Required | ADMIN | Clone data from previous year to new year. |
| PUT | `/api/school-years/:id` | Required | ADMIN | Update SY settings. |
| PATCH | `/api/school-years/:id/status` | Required | ADMIN | Transition SY status (e.g., ACTIVE -> ARCHIVED). |

### Sample: `GET /api/school-years/1`
```json
{
  "year": {
    "id": 1,
    "yearLabel": "2026-2027",
    "status": "ACTIVE",
    "classOpeningDate": "2026-06-01",
    "classEndDate": "2027-03-31",
    "earlyRegOpenDate": "2026-01-15",
    "earlyRegCloseDate": "2026-02-28",
    "enrollOpenDate": "2026-05-01",
    "enrollCloseDate": "2026-05-31"
  }
}
```

---

## 6) Curriculum (`/api/curriculum`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/curriculum/:ayId/grade-levels` | Required | ADMIN | List grade levels for a specific year. |
| GET | `/api/curriculum/:ayId/scp-config` | Required | REGISTRAR | List SCP configurations (STE, SPA, etc.). |
| PUT | `/api/curriculum/:ayId/scp-config` | Required | ADMIN | Update SCP admission requirements. |

---

## 7) Sections (`/api/sections`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/sections` | Required | REGISTRAR | List all sections for the active year. |
| GET | `/api/sections/teachers` | Required | REGISTRAR | List teachers eligible for advisership. |
| POST | `/api/sections` | Required | REGISTRAR | Create a new section. |
| GET | `/api/sections/:id/roster` | Required | REGISTRAR | List all learners enrolled in a section. |
| POST | `/api/sections/:id/handover-adviser`| Required | REGISTRAR | Transfer advisership to another teacher. |

### Sample: `GET /api/sections/1/roster`
```json
{
  "section": { "id": 1, "name": "7-A", "gradeLevel": "Grade 7" },
  "learners": [
    { "id": 101, "lrn": "123456789012", "firstName": "JUAN", "lastName": "DELA CRUZ", "sex": "MALE" }
  ],
  "total": 1
}
```

---

## 8) Students & Masterlist (`/api/students`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/students` | Required | ALL STAFF | List all active/enrolled learners. |
| GET | `/api/students/:id` | Required | ALL STAFF | Detailed learner profile. |
| GET | `/api/students/:id/health-records` | Required | ALL STAFF | BMI and physical assessment history. |
| POST | `/api/students/:id/health-records` | Required | REGISTRAR | Add a new health measurement. |
| POST | `/api/students/:id/verify-psa` | Required | REGISTRAR | Mark PSA Birth Certificate as verified. |

### Sample: `GET /api/students/101`
```json
{
  "student": {
    "id": 101,
    "lrn": "123456789012",
    "firstName": "JUAN",
    "lastName": "DELA CRUZ",
    "birthdate": "2013-05-20",
    "sex": "MALE",
    "status": "ACTIVE",
    "currentEnrollment": {
      "sectionName": "7-A",
      "gradeLevel": "Grade 7"
    }
  }
}
```

---

## 9) Admissions & Enrollment (`/api/applications`)

Manages Phase 2 (BEEF/Enrollment applications).

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/api/applications` | None | - | Public enrollment application submission. |
| GET | `/api/applications/track/:no` | None | - | Track status by tracking number. |
| GET | `/api/applications` | Required | REGISTRAR | List and filter applications. |
| PATCH | `/api/applications/:id/verify` | Required | REGISTRAR | Verify documents/identity. |
| PATCH | `/api/applications/:id/enroll` | Required | REGISTRAR | Finalize enrollment into a section. |
| GET | `/api/applications/exports/sf1` | Required | REGISTRAR | Export School Form 1 data. |

---

## 10) Early Registration (`/api/early-registrations`)

Manages Phase 1 (BEERF submission and screening).

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/api/early-registrations` | None | - | Public BEERF submission. |
| GET | `/api/early-registrations` | Required | ALL STAFF | List pre-registrations. |
| GET | `/api/early-registrations/:id/detailed`| Required | ALL STAFF | Expanded profile for screening. |
| PATCH | `/api/early-registrations/:id/verify` | Required | REGISTRAR | Mark documents as verified. |
| PATCH | `/api/early-registrations/:id/pass` | Required | REGISTRAR | Mark as PASSED (for SCP programs). |

---

## 11) Teachers & Faculty (`/api/teachers`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/teachers` | Required | REGISTRAR | List all faculty members. |
| GET | `/api/teachers/:id` | Required | REGISTRAR | Single teacher profile. |
| POST | `/api/teachers` | Required | ADMIN | Create new teacher profile. |
| PUT | `/api/teachers/:id/designation` | Required | ADMIN | Set advisory or ancillary roles. |

---

## 12) EOSY - End of School Year (`/api/eosy`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/eosy/sections` | Required | REGISTRAR | List sections for EOSY processing. |
| GET | `/api/eosy/sections/:id/records` | Required | REGISTRAR | Final grades and promotion status list. |
| PATCH | `/api/eosy/records/:id` | Required | REGISTRAR | Update learner's final EOSY status. |
| POST | `/api/eosy/sections/:id/finalize`| Required | REGISTRAR | Lock section records for the year. |
| POST | `/api/eosy/school-year/finalize` | Required | ADMIN | Close academic year and promote all. |
| GET | `/api/eosy/sections/:id/exports/sf5` | Required | REGISTRAR | **SF5** — Section-scoped learner promotion & proficiency report (JSON). |
| GET | `/api/eosy/exports/sf6` | Required | REGISTRAR | **SF6** — School-wide enrollment summary by grade level (JSON). Requires `?schoolYearId=`. |

### Sample: `GET /api/eosy/sections/10/exports/sf5`
```json
{
  "generatedAt": "2026-04-01T08:00:00Z",
  "section": {
    "id": 10, "name": "8-A",
    "gradeLevel": { "id": 8, "name": "Grade 8" },
    "schoolYear": { "id": 2, "yearLabel": "2026-2027" },
    "adviser": { "firstName": "MARIA", "lastName": "SANTOS" },
    "isEosyFinalized": true
  },
  "totalLearners": 40,
  "learners": [
    {
      "no": 1, "learnerId": 101, "lrn": "123456789012",
      "lastName": "DELA CRUZ", "firstName": "JUAN", "middleName": "SAMSON",
      "sex": "MALE", "birthdate": "2013-05-20",
      "finalAverage": 88.5, "eosyStatus": "PROMOTED"
    }
  ]
}
```

### Sample: `GET /api/eosy/exports/sf6?schoolYearId=2`
```json
{
  "generatedAt": "2026-04-01T08:00:00Z",
  "schoolYear": { "id": 2, "yearLabel": "2026-2027" },
  "rows": [
    {
      "gradeId": 7, "gradeName": "Grade 7",
      "initialEnrollment": { "male": 80, "female": 70, "total": 150 },
      "promoted": { "male": 78, "female": 69, "total": 147 },
      "retained": { "male": 2, "female": 1, "total": 3 },
      "dropOut": { "male": 0, "female": 0, "total": 0 },
      "transferOut": { "male": 0, "female": 0, "total": 0 },
      "irregular": { "male": 0, "female": 0, "total": 0 },
      "noStatus": { "male": 0, "female": 0, "total": 0 }
    }
  ],
  "grandTotal": { "male": 320, "female": 290, "total": 610, "promoted": 595, "retained": 10, "dropOut": 3, "transferOut": 2 }
}
```

---

## 13) Admin & System (`/api/admin`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/admin/users` | Required | ADMIN | Manage system user accounts. |
| GET | `/api/admin/system/health` | Required | ADMIN | Detailed server and DB metrics. |
| GET | `/api/admin/dashboard/stats` | Required | ADMIN | High-level system overview. |
| GET | `/api/admin/atlas/health` | Required | ADMIN | ATLAS Sync subsystem status. |

---

## 14) Audit Logs (`/api/audit-logs`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/audit-logs` | Required | REGISTRAR | View system activity trail. |
| GET | `/api/audit-logs/export` | Required | ADMIN | Export logs to CSV for compliance. |

---

## 15) Integration v1 (`/api/integration/v1`)

Public read-only feeds for companion systems (ATLAS, SMART, AIMS).

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| GET | `/api/integration/v1/health` | None | Connectivity and DB health check. |
| GET | `/api/integration/v1/school-year` | None | EnrollPro's active school year `id` and `yearLabel`. Use to confirm which year faculty/section data belongs to. |
| GET | `/api/integration/v1/learners` | None | Paginated list of learners. **Requires `schoolYearId`**. Supports `page`/`limit`. |
| GET | `/api/integration/v1/faculty` | None | List of all faculty members. Defaults to active school year if `schoolYearId` is omitted. Active-year context available in `meta.scope`. |
| GET | `/api/integration/v1/sections` | None | List of sections with occupancy. Defaults to active school year if `schoolYearId` is omitted. Active-year context available in `meta.scope`. |
| GET | `/api/integration/v1/sections/:sectionId/learners` | None | Paginated roster for a specific section. Supports `page`/`limit`. |

### Sample: `GET /api/integration/v1/health`
```json
{
  "data": {
    "status": "ok",
    "db": "connected",
    "dbLatencyMs": 12,
    "timestamp": "2026-05-11T12:00:00Z"
  }
}
```

### Sample: `GET /api/integration/v1/school-year`
```json
{
  "data": {
    "id": 1,
    "yearLabel": "2026-2027"
  }
}
```

### Sample: `GET /api/integration/v1/learners?schoolYearId=1&page=1&limit=50`
```json
{
  "data": [
    {
      "enrollmentApplicationId": 45,
      "status": "ENROLLED",
      "learnerType": "NEW_ENROLLEE",
      "applicantType": "REGULAR",
      "learner": {
        "id": 101,
        "externalId": "550e8400-e29b-41d4-a716-446655440000",
        "lrn": "123456789012",
        "firstName": "JUAN",
        "lastName": "DELA CRUZ",
        "middleName": "SAMSON",
        "extensionName": null,
        "birthdate": "2013-05-20",
        "sex": "MALE"
      },
      "schoolYear": { "id": 1, "yearLabel": "2025-2026" },
      "gradeLevel": { "id": 7, "name": "Grade 7", "displayOrder": 1 },
      "section": { "id": 10, "name": "7-A", "programType": "REGULAR" },
      "enrolledAt": "2025-05-15T08:30:00Z"
    }
  ],
  "meta": {
    "schoolYearId": 1,
    "total": 1240,
    "page": 1,
    "limit": 50,
    "totalPages": 25
  }
}
```

### Sample: `GET /api/integration/v1/faculty`
```json
{
  "data": [
    {
      "teacherId": 1,
      "employeeId": "100001",
      "firstName": "MARIA",
      "lastName": "SANTOS",
      "middleName": "SOLIS",
      "fullName": "SANTOS, MARIA S.",
      "email": "maria.santos@deped.edu.ph",
      "isClassAdviser": true,
      "advisorySectionId": 10,
      "advisorySectionName": "10-A",
      "schoolYearId": 1,
      "schoolYearLabel": "2025-2026"
    }
  ],
  "meta": {
    "generatedAt": "2026-05-11T12:00:00Z",
    "scope": {
      "schoolId": 1,
      "schoolName": "EnrollPro",
      "schoolYearId": 1,
      "schoolYearLabel": "2025-2026"
    },
    "total": 142
  }
}
```

### Sample: `GET /api/integration/v1/sections/:sectionId/learners`
```json
{
  "data": {
    "section": {
      "id": 10,
      "name": "7-A",
      "programType": "REGULAR",
      "maxCapacity": 40,
      "gradeLevel": { "id": 7, "name": "Grade 7", "displayOrder": 1 },
      "advisingTeacher": { "id": 1, "name": "SANTOS, MARIA S." }
    },
    "learners": [
      {
        "enrollmentRecordId": 500,
        "enrolledAt": "2025-05-15T08:30:00Z",
        "enrollmentApplicationId": 45,
        "status": "ENROLLED",
        "learner": { "id": 101, "lrn": "123456789012", "firstName": "JUAN", "lastName": "DELA CRUZ" }
      }
    ]
  },
  "meta": {
    "scope": { "schoolYearId": 1, "schoolYearLabel": "2025-2026" },
    "total": 40,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

---

## Notes & Guidelines

1. **Date Format:** All dates in requests/responses follow ISO-8601 (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss.sssZ`).
2. **Numeric IDs:** Primary keys are autoincrementing integers.
3. **Upper Case Names:** Learner and Teacher names (First, Middle, Last) are strictly stored and returned in UPPERCASE as per DepEd standards.
4. **Rate Limiting:** Public endpoints (Tracking, Submission) are subject to rate limiting (typically 100 requests per 15 minutes per IP).

---

## 16) BOSY — Beginning of School Year (`/api/bosy`)

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/api/bosy/readiness` | Required | REGISTRAR | BOSY readiness checklist for a given SY. |
| GET | `/api/bosy/queue` | Required | REGISTRAR | Learners in the PENDING_CONFIRMATION queue. |
| POST | `/api/bosy/confirm-return/:applicationId` | Required | REGISTRAR | Staff confirms a single learner's return. |
| POST | `/api/bosy/bulk-confirm` | Required | REGISTRAR | Staff bulk-confirms a batch of returns. |
| GET | `/api/bosy/completers` | Required | REGISTRAR | JHS completers ready for SHS transition. |
| **POST** | **`/api/bosy/confirm-intent`** | **Learner JWT** | **LEARNER** | **Self-service: learner signals intent to return.** |
| **GET** | **`/api/bosy/expected-queue`** | **Required** | **REGISTRAR** | **Prior-year PROMOTED learners not yet in current SY pipeline.** |

### Sample: `POST /api/bosy/confirm-intent`

**Authorization:** `Bearer <learner-jwt>` (from `POST /api/auth/learner-login`)

**Request body:**
```json
{ "schoolYearId": 2 }
```

**Response:**
```json
{
  "message": "Intent to return confirmed successfully.",
  "enrollmentApplicationId": 45
}
```

### Sample: `GET /api/bosy/expected-queue?priorSchoolYearId=1&currentSchoolYearId=2`
```json
{
  "items": [
    {
      "enrollmentRecordId": 500,
      "learnerId": 101,
      "lrn": "123456789012",
      "firstName": "JUAN",
      "lastName": "DELA CRUZ",
      "sex": "MALE",
      "priorGradeLevel": { "id": 7, "name": "Grade 7" },
      "priorSection": { "id": 10, "name": "7-A" },
      "priorSchoolYear": { "id": 1, "yearLabel": "2025-2026" },
      "finalAverage": 88.5
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

---

## 17) Remedial Processing (`/api/remedial`)

Handles learners flagged as `CONDITIONALLY_PROMOTED` who must pass a summer remedial exam before the new school year.

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | **`/api/remedial/pending`** | **Required** | **REGISTRAR** | **List all applications with remedial pending.** |
| **PATCH** | **`/api/remedial/:learnerId/resolve`** | **Required** | **REGISTRAR** | **Mark remedial as passed; set final average and EOSY status.** |

### Sample: `GET /api/remedial/pending?schoolYearId=1`
```json
{
  "items": [
    {
      "checklistId": 77,
      "enrollmentApplicationId": 45,
      "learnerId": 101,
      "lrn": "123456789012",
      "firstName": "JUAN",
      "lastName": "DELA CRUZ",
      "sex": "MALE",
      "gradeLevel": { "id": 7, "name": "Grade 7" },
      "schoolYear": { "id": 1, "yearLabel": "2025-2026" },
      "academicStatus": "CONDITIONALLY_PROMOTED",
      "isRemedialRequired": true,
      "currentFinalAverage": 73.5,
      "eosyStatus": null
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

### Sample: `PATCH /api/remedial/101/resolve`

**Request body:**
```json
{ "schoolYearId": 1, "summerGrade": 78.0 }
```

**Response:**
```json
{
  "message": "Remedial case resolved successfully.",
  "checklistId": 77,
  "enrollmentRecordId": 500,
  "finalAverage": 78,
  "eosyStatus": "PROMOTED"
}
```

---

## 18) Integration Triggers (`/api/integration`)

Staff-initiated pull/push triggers for external companion systems. These complement the read-only Integration v1 feeds (Section 15).

**All endpoints require `SYSTEM_ADMIN` role.**

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| **POST** | **`/api/integration/smart/sections/:id/sync-grades`** | **Required** | **SYSTEM_ADMIN** | **Pull final averages from S.M.A.R.T. for a section; persist to `EnrollmentRecord.finalAverage`.** |
| **POST** | **`/api/integration/atlas/sync-faculty`** | **Required** | **SYSTEM_ADMIN** | **Pull faculty list from ATLAS and upsert `Teacher` records by `employeeId`.** |

### Environment Variables

| Variable | Required for | Description |
| :--- | :--- | :--- |
| `SMART_API_BASE_URL` | SMART sync | Base URL of the S.M.A.R.T. Tailscale node. |
| `SMART_API_KEY` | SMART sync | API key sent in `X-API-KEY` header. |
| `SMART_SYNC_FALLBACK_ENABLED` | SMART sync | Set `true` to use mock data when SMART is unreachable (demo/offline mode). |
| `ATLAS_API_BASE_URL` | ATLAS sync | Base URL of the ATLAS teacher data endpoint. |
| `ATLAS_API_KEY` | ATLAS sync | API key sent in `X-API-KEY` header. |

### Sample: `POST /api/integration/smart/sections/10/sync-grades`

**Response:**
```json
{
  "success": true,
  "sectionId": 10,
  "sectionName": "8-A",
  "syncedCount": 38,
  "missingCount": 2,
  "missingLrns": ["999999999901", "999999999902"],
  "isFallbackEngaged": false,
  "message": "Synced 38 grade(s) from S.M.A.R.T."
}
```

### Sample: `POST /api/integration/atlas/sync-faculty`

**Response:**
```json
{
  "success": true,
  "synced": 45,
  "skipped": 1,
  "errors": [
    { "employeeId": "BADID99", "error": "Missing email." }
  ],
  "message": "Synced 45 faculty record(s) from ATLAS."
}
```


