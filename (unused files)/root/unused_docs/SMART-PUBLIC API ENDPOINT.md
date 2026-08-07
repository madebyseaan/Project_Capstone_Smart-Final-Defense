# SMART Public API Endpoint Reference

Welcome to the comprehensive API reference for the **SMART (Student Monitoring and Reporting Tool)** system. This document provides technical details for all endpoints, including authentication, external system integrations, and core school operations.

## General Information
- **Base URL:** `http://<host>:5003/api`
- **Tailscale Host:** `100.93.66.120` (laptop-pfvh73qk)
- **Content-Type:** `application/json`
- **Auth:** All protected endpoints require an `Authorization: Bearer <token>` header.

---

## 1. Authentication
Endpoints for login, user profiles, and session management.

### `POST /auth/login`
Authenticate and receive a JWT token. SMART supports multi-provider login (Local, EnrollPro).

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

**Request body:**
```json
{
  "email": "teacher@school.edu.ph",
  "password": "yourpassword"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "<jwt_token>",
  "user": {
    "id": "user-uuid",
    "email": "teacher@school.edu.ph",
    "username": "TEACHER001",
    "role": "TEACHER",
    "firstName": "Juan",
    "lastName": "Dela Cruz"
  }
}
```

### `GET /auth/me`
Return the authenticated user's profile.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

---

## 2. Integration & System Health
Connectivity status and proxy data from external systems.

### `GET /integration/status`
Check the health and connectivity status of external systems (EnrollPro, ATLAS, AIMS).

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

### `GET /admin/system/health`
Get a detailed snapshot of system health, database status, and API latencies.

| | |
|---|---|
| **Auth** | Required — `ADMIN` only |
| **Success** | `200 OK` |

### `GET /admin/system/sync-history`
Get the history of data synchronizations from EnrollPro and ATLAS.

| | |
|---|---|
| **Auth** | Required — `ADMIN` only |
| **Success** | `200 OK` |

---

## 3. Advisory & Student Records
Teacher advisory sections and detailed student grade profiles.

### `GET /advisory/my-advisory`
Get details about the teacher's advisory section and student subjects.

| | |
|---|---|
| **Auth** | Required — `TEACHER` only |
| **Success** | `200 OK` |

### `GET /advisory/student/:studentId/grades`
Get the complete grade profile for a specific student across all subjects and quarters.

| | |
|---|---|
| **Auth** | Required — Adviser or Teacher |
| **Success** | `200 OK` |

**Response:**
```json
{
  "student": { "id": "stud-uuid", "lrn": "123456789012", "firstName": "Juan" },
  "grades": [
    { 
      "subject": "Mathematics",
      "q1": 88, 
      "q2": 90, 
      "q3": null, 
      "q4": null,
      "final": 89
    }
  ]
}
```

---

## 4. Attendance
Daily attendance tracking and DepEd SF2 exports.

### `GET /attendance/section/:sectionId?date=YYYY-MM-DD`
Get the attendance status for all students in a section on a specific date.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

### `POST /attendance/bulk`
Save or update attendance records for multiple students.

| | |
|---|---|
| **Auth** | Required — `TEACHER/ADMIN` |
| **Success** | `200 OK` |

---

## 5. Grades & Class Records
Class records, quarterly grades, and ECR imports.

### `GET /grades/my-classes`
List all class assignments for the authenticated teacher in the current school year.

| | |
|---|---|
| **Auth** | Required — `TEACHER` only |
| **Success** | `200 OK` |

### `GET /grades/class-record/:classAssignmentId`
Get the full class record (students and grades) for a specific assignment.

| | |
|---|---|
| **Auth** | Required — `TEACHER` only |
| **Success** | `200 OK` |

---

## 6. Admin & School Calendar
System settings, audit logs, and academic calendar.

### `GET /admin/settings`
**Fetch School Information and Academic Calendar.** This endpoint provides the official school year, current quarter, and start/end dates for each quarter.

| | |
|---|---|
| **Auth** | Required — All Roles |
| **Success** | `200 OK` |

**Response:**
```json
{
  "settings": {
    "schoolName": "Example National High School",
    "currentSchoolYear": "2026-2027",
    "currentQuarter": "Q1",
    "q1StartDate": "2026-06-01T00:00:00.000Z",
    "q1EndDate": "2026-08-15T23:59:59.000Z",
    "q2StartDate": "2026-08-16T00:00:00.000Z",
    "q2EndDate": "2026-10-30T23:59:59.000Z",
    "q3StartDate": "2026-11-01T00:00:00.000Z",
    "q3EndDate": "2027-01-20T23:59:59.000Z",
    "q4StartDate": "2027-01-21T00:00:00.000Z",
    "q4EndDate": "2027-04-05T23:59:59.000Z",
    "autoAdvanceQuarter": true
  }
}
```

### `PUT /admin/settings`
Update school profile and calendar dates. (Admin only)

---

## 7. Registrar & Forms
Student master list and DepEd School Form generation.

### `GET /registrar/students`
List all enrolled students with optional filtering (LRN, name, status).

| | |
|---|---|
| **Auth** | Required — `REGISTRAR/ADMIN` |
| **Success** | `200 OK` |

### `GET /registrar/forms/sf9/:studentId`
Generate data for **School Form 9 (Progress Report Card)**.

| | |
|---|---|
| **Auth** | Required — `REGISTRAR/TEACHER` |
| **Success** | `200 OK` |

---

## Error Responses

All errors follow a standard format:

```json
{ "success": false, "message": "Error description" }
```

| HTTP Status | Meaning |
|---|---|
| `400` | Bad request — missing or invalid fields |
| `401` | Unauthorized — missing or expired token |
| `403` | Forbidden — insufficient role permissions |
| `404` | Not found |
| `500` | Internal server error |
