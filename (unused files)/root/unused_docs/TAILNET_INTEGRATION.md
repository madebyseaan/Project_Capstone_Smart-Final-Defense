# SMART System — Tailscale Integration Reference

**System:** Grading & Academic Records (SMART)  
**Tailscale IP:** `100.93.66.120`  
**Backend Port:** `3000`  
**Base URL:** `http://100.93.66.120:5003`  

> **Tested:** ✅ Reachable over Tailnet on 2026-05-11  
> `GET http://100.93.66.120:5003/api/health` → `200 OK`

---

## Auth

All endpoints (except health) require:
```
Authorization: Bearer <token>
```

Get token via:
```http
POST http://100.93.66.120:5003/api/auth/login
Content-Type: application/json

{
  "username": "<username>",
  "password": "<password>"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "token": "<jwt>",
    "user": { "id": "...", "username": "...", "role": "TEACHER" }
  }
}
```

---

## Health Check

```http
GET http://100.93.66.120:5003/api/health
```
No auth required.

```json
{ "status": "ok", "timestamp": "2026-05-11T03:33:14.809Z" }
```

---

## Grades API

### Get Student Grades by LRN
```http
GET http://100.93.66.120:5003/api/grades/student/:lrn
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "data": [
    {
      "subject": "Mathematics",
      "subjectCode": "MATH7",
      "quarter": "Q1",
      "schoolYear": "2025-2026",
      "writtenWorkPs": 85.5,
      "perfTaskPs": 88.0,
      "quarterlyAssessPs": 82.0,
      "initialGrade": 85.35,
      "quarterlyGrade": 86,
      "remarks": "Passed"
    }
  ]
}
```

---

### Get Section Grades
```http
GET http://100.93.66.120:5003/api/grades/section/:sectionId?quarter=Q1
Authorization: Bearer <token>
```

| Param | Where | Example |
|---|---|---|
| `sectionId` | URL | `section-123` |
| `quarter` | Query | `Q1`, `Q2`, `Q3`, `Q4` |

```json
{
  "success": true,
  "data": {
    "sectionId": "section-123",
    "sectionName": "Einstein",
    "gradeLevel": "GRADE_7",
    "quarter": "Q1",
    "students": [
      {
        "lrn": "123456789012",
        "firstName": "Juan",
        "lastName": "Dela Cruz",
        "initialGrade": 85.35,
        "quarterlyGrade": 86,
        "remarks": "Passed"
      }
    ]
  }
}
```

---

### Get Full Class Record
```http
GET http://100.93.66.120:5003/api/class-records/:classAssignmentId
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "data": {
    "teacher": "Mr. John Doe",
    "subject": "Mathematics",
    "section": "Einstein - Grade 7",
    "schoolYear": "2025-2026",
    "students": [
      {
        "lrn": "123456789012",
        "name": "Dela Cruz, Juan C.",
        "quarters": {
          "Q1": { "initialGrade": 85.35, "quarterlyGrade": 86 },
          "Q2": { "initialGrade": 87.20, "quarterlyGrade": 88 },
          "Q3": null,
          "Q4": null
        },
        "finalGrade": null
      }
    ]
  }
}
```

---

## Attendance API

### Get Section Attendance by Date
```http
GET http://100.93.66.120:5003/api/attendance/section/:sectionId?date=YYYY-MM-DD
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "data": {
    "section": { "id": "section-123", "name": "Einstein", "gradeLevel": "GRADE_7" },
    "date": "2026-05-11",
    "attendance": [
      {
        "studentId": "student-abc",
        "lrn": "123456789012",
        "firstName": "Juan",
        "lastName": "Dela Cruz",
        "status": "PRESENT",
        "remarks": null
      }
    ]
  }
}
```

---

### Get Student Attendance History
```http
GET http://100.93.66.120:5003/api/attendance/student/:studentId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "att-xyz-123",
        "date": "2026-05-11",
        "status": "PRESENT",
        "remarks": null,
        "section": { "id": "section-123", "name": "Einstein", "gradeLevel": "GRADE_7" }
      }
    ],
    "summary": { "present": 20, "absent": 2, "late": 1, "excused": 1, "total": 24 }
  }
}
```

---

### Get Attendance Summary (Date Range)
```http
GET http://100.93.66.120:5003/api/attendance/summary/:sectionId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "data": {
    "sectionId": "section-123",
    "summary": [
      {
        "studentId": "student-abc",
        "lrn": "123456789012",
        "firstName": "Juan",
        "lastName": "Dela Cruz",
        "present": 18,
        "absent": 1,
        "late": 1,
        "excused": 0,
        "total": 20
      }
    ]
  }
}
```

---

## Registrar API

### Get All Students
```http
GET http://100.93.66.120:5003/api/registrar/students
Authorization: Bearer <token>
```

### Get Student by LRN
```http
GET http://100.93.66.120:5003/api/registrar/students?lrn=:lrn
Authorization: Bearer <token>
```

### Get All Sections
```http
GET http://100.93.66.120:5003/api/registrar/sections
Authorization: Bearer <token>
```

### Get All Subjects
```http
GET http://100.93.66.120:5003/api/registrar/subjects
Authorization: Bearer <token>
```

---

## Advisory API

### Get Advisory Class
```http
GET http://100.93.66.120:5003/api/advisory/class/:teacherId
Authorization: Bearer <token>
```

---

## Error Responses

All errors:
```json
{ "success": false, "error": "Human-readable message" }
```

| Status | Meaning |
|---|---|
| `400` | Bad request / missing fields |
| `401` | Missing or expired token |
| `403` | Insufficient role |
| `404` | Not found |
| `500` | Server error |

---

## Tailnet Status (as of 2026-05-11)

| Machine | Tailscale IP | Port | System | Status |
|---|---|---|---|---|
| **SMART (us)** | `100.93.66.120` | `3000` | Grading & Academic Records | ✅ Online |
| **AIMS (tfrog)** | `100.92.245.14` | `5000` | Learning Management System | ⚠️ Ping OK, HTTP timeout — server may be down |

---

## Quick Test (PowerShell)

```powershell
# Health check
Invoke-WebRequest -Uri "http://100.93.66.120:5003/api/health" -UseBasicParsing | Select-Object StatusCode, Content

# With auth token
$token = "your-jwt-here"
$headers = @{ Authorization = "Bearer $token" }
Invoke-WebRequest -Uri "http://100.93.66.120:5003/api/grades/student/123456789012" -Headers $headers -UseBasicParsing | Select-Object Content
```

## Quick Test (JS/Fetch)

```js
// Health
const res = await fetch('http://100.93.66.120:5003/api/health');
const data = await res.json();

// Grades with auth
const grades = await fetch('http://100.93.66.120:5003/api/grades/student/123456789012', {
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json());
```
