# ATLAS Dev Handoff: Faculty Mirror Upsert Constraint Fix & Rollover Status

Date: 2026-08-07  
Audience: ATLAS developers & AI assistant  

---

## 1. Issue Description

When executing the ATLAS rollover sync endpoint against live EnrollPro data:

```http
POST https://njgrm.buru-degree.ts.net/api/v1/runtime/rollover-sync/apply
Authorization: Bearer <SYSTEM_ADMIN token>
Content-Type: application/json

{
  "schoolId": 1
}
```

The ATLAS backend returns **HTTP 500** with a Prisma unique constraint violation:

```json
{
  "code": "P2002",
  "message": "Invalid `prisma.facultyMirror.upsert()` invocation in D:\\ATLAS\\atlas-server\\src\\services\\faculty.service.ts:555:45\n\nUnique constraint failed on the fields: (`employee_id`)"
}
```

---

## 2. Root Cause & Required Fix in ATLAS Server

In `D:\ATLAS\atlas-server\src\services\faculty.service.ts` around line 555:
- `prisma.facultyMirror.upsert()` fails when EnrollPro returns faculty members whose `employee_id` already exists in `facultyMirror` under a different `id` or primary key.
- Update the `upsert` logic or `where` clause in `faculty.service.ts` to match on `employeeId` (or perform clean deduplication before `upsert`) so existing faculty mirrors update cleanly.

---

## 3. SMART Integration Verification

SMART has verified full compatibility with ATLAS endpoints on Tailscale (`https://njgrm.buru-degree.ts.net/api/v1`):
- `GET /api/v1/health` (Verified `status: "ok"`)
- `GET /api/v1/runtime/context?schoolId=1&verifyUpstream=true` (Verified context & drift status)
- `GET /api/v1/schools/1/schedules/published` (Verified 3,440 published entries)

Once ATLAS resolves the `facultyMirror.upsert` constraint error in `faculty.service.ts`, `POST /api/v1/runtime/rollover-sync/apply` will complete and status will advance from `atlas-stale` to `aligned`.
