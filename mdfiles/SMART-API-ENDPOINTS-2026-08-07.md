# SMART API Endpoints & Partner Integration Specification

Date: 2026-08-07  
Audience: EnrollPro, ATLAS, and AIMS developers  
Repository: `https://github.com/madebyseaan/smart-final-capstone`  

---

## 🌟 Overview

**SMART** (System for Monitoring & Academic Records Tracking) provides real-time grade computation, DepEd K-12 report card generation (SF9/SF10), attendance ledgers, and partner integration endpoints for the ecosystem.

- **Port / Protocol**: HTTP REST API (Default Port: `5003`)
- **Authentication**: JWT Bearer token in `Authorization` header (`Authorization: Bearer <token>`)
- **Identity SSOT**: EnrollPro JIT Authentication

---

## 🔗 Partner Integration & Rollover Endpoints

These endpoints are used by EnrollPro and ATLAS during school-year rollover and data synchronization.

### 1. Section Grade Outcomes Sync (EnrollPro Rollover Gate)

Called by EnrollPro during EOSY rollover validation to verify/pull final SMART academic outcomes per section.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/integration/smart/sections/:sectionId/sync-grades` | Optional / Internal | Returns learner final general averages and promotion outcomes for a section. |
| `POST` | `/api/integration/sections/:sectionId/sync-grades` | Optional / Internal | Compatibility alias for section grade outcomes sync. |

**Sample Response (HTTP 200)**:
```json
{
  "success": true,
  "ready": true,
  "sectionId": "1",
  "outcomesSynced": 4,
  "outcomes": [
    {
      "lrn": "123456789012",
      "studentName": "Bernier, Osbaldo",
      "finalGeneralAverage": 88,
      "finalOutcome": "PROMOTED",
      "publishedAt": "2026-08-07T05:43:00.000Z",
      "revision": 1
    }
  ]
}
```

### 2. EnrollPro Event Webhook

| Method | Endpoint | Auth Header | Purpose |
|---|---|---|---|
| `POST` | `/api/integration/enrollpro-webhook` | `X-API-Key: <key>` | Triggers immediate background sync in SMART when EnrollPro data changes. |

### 3. System Health & Partner Status

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | Public | Core SMART API health check. Returns `{ "status": "ok" }`. |
| `GET` | `/api/integration/status` | Bearer Token | Live reachability status of EnrollPro, ATLAS, and AIMS partners. |
| `GET` | `/api/integration/sync/stream` | Bearer Token | Server-Sent Events (SSE) stream for real-time sync notifications. |

---

## 🔐 Authentication & Session Endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Authenticates credentials live against EnrollPro (`POST /api/auth/login`), auto-provisions/updates local user role (`ADMIN`, `REGISTRAR`, or `TEACHER`), and issues SMART JWT token. |
| `POST` | `/api/auth/logout` | Bearer Token | Invalidates session. |
| `GET` | `/api/auth/me` | Bearer Token | Returns current authenticated user profile and assigned role. |

---

## 👩‍🏫 Teacher & Advisory Endpoints

| Method | Endpoint | Auth Role | Purpose |
|---|---|---|---|
| `GET` | `/api/advisory/my-advisory` | `TEACHER` | Returns the logged-in teacher's assigned advisory section and learner masterlist synced from EnrollPro. |
| `GET` | `/api/integration/atlas/my-teaching-load` | `TEACHER` | Returns the teacher's subject schedule teaching assignments synced from ATLAS. |
| `GET` | `/api/grades/class-record/:assignmentId` | `TEACHER` | Returns the complete class record (Written Work, Performance Tasks, Quarterly Assessments) for a section/subject. |
| `POST` | `/api/grades/grade` | `TEACHER` | Upserts student scores and triggers automatic score transmutation. |

---

## 📋 Registrar & Administrative Endpoints

| Method | Endpoint | Auth Role | Purpose |
|---|---|---|---|
| `GET` | `/api/registrar/applications` | `REGISTRAR` | Reads admissions intake queue from EnrollPro. |
| `GET` | `/api/registrar/students` | `REGISTRAR` | Reads active learner registry and enrollment history. |
| `GET` | `/api/registrar/atlas/teaching-loads` | `REGISTRAR` | Read-only proxy for ATLAS faculty teaching loads with local fallback. |
| `POST` | `/api/sync/all` | `ADMIN` | Manual trigger for full system synchronization (EnrollPro → ATLAS → Branding). |
| `POST` | `/api/sync/atlas` | `ADMIN` | Manual trigger to re-sync teaching loads from ATLAS. |
| `POST` | `/api/admin/settings/sync-enrollpro` | `ADMIN` | Manual trigger to sync school branding, logo, and active academic year from EnrollPro. |

---

## 📐 Required Field Formats

- **Learner LRN**: 12-digit numeric string (e.g., `"123456789012"`).
- **Employee ID**: Numeric or string identifier matching EnrollPro (`"2668428"`).
- **School Year Label**: Standard DepEd format `"YYYY-YYYY"` (e.g., `"2026-2027"`).
- **Section ID**: Canonical EnrollPro section identifier string or number.
