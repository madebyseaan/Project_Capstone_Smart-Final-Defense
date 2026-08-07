# Sync Optimization & Stale Data Audit
**Author**: Senior Dev Investigation  
**Scope**: Admin & Registrar dashboards, background sync scheduler, EnrollPro data fetching pipeline  
**Status**: Planning — DO NOT implement until approved

---

## Executive Summary

The system has a **single unified sync scheduler** (`syncCoordinator.ts`) that runs every **5 minutes** for all roles. The Registrar dashboard already has the right structure (fallback to EnrollPro real-time), but calling `getAllIntegrationV1Learners()` on every page load fetches **all 500+ student records** on every dashboard visit — this is the root cause of lagging. Several other stale data vectors were found in both Admin and Registrar.

---

## Issue Inventory

### ISSUE-01 — Registrar Dashboard Fetches ALL Learners on Every Page Load (🔴 Critical — Root Cause of Lag)

**File**: `server/src/routes/registrar.ts` lines 141–199  
**Problem**: The `GET /api/registrar/dashboard` endpoint calls **three separate EnrollPro requests in parallel** on every single dashboard load:
```
getAllIntegrationV1Learners(schoolYearId)   ← fetches ALL students (500+ records, paginated)
getIntegrationV1LearnersPage(id, 1, 1)     ← just for meta.total
getIntegrationV1Sections(schoolYearId)     ← all sections
```
`getAllIntegrationV1Learners` paginates through EnrollPro until it has every record. If there are 500 students at 200/page, that's **3 HTTP round trips to EnrollPro per dashboard visit**. This blocks the dashboard response, causing the lag.

**Fix**:
- Use **only** `getIntegrationV1LearnersPage(id, 1, 1)` to get `meta.total` (1 request).
- Use **only** `getIntegrationV1Sections(id)` for section counts (1 request).
- For gender/grade breakdown — use local DB data only (already computed as fallback). These numbers will be accurate from the last sync, not from a live full-fetch. This is acceptable.
- Remove `getAllIntegrationV1Learners()` from the dashboard route entirely.

---

### ISSUE-02 — Registrar Sync Runs Every 5 Minutes (Too Aggressive)

**File**: `server/src/lib/syncCoordinator.ts` line 27  
**Problem**: `SYNC_INTERVAL_MINUTES` defaults to `5`. This means the full EnrollPro + Atlas sync pipeline runs 12 times per hour for all roles. For the Registrar use case (read-only school forms, masterlist), this is excessive and wastes EnrollPro API capacity.

**Fix**:
- Change background sync to **60 minutes** (`SYNC_INTERVAL_MINUTES=60` in `.env`).
- On **page load/refresh**: If the data is older than 10 minutes, automatically trigger an incremental sync (`triggerImmediateSync('registrar_page_load')`).  
- On **manual force sync button**: Trigger `POST /api/registrar/sync/run` (endpoint already exists).
- This means: idle = 1 hr, active = syncs on page load if stale.

---

### ISSUE-03 — Change Detection Skips Already Work, But Skip Count Is Not Surfaced

**File**: `server/src/lib/enrollproSync.ts` lines 283–301  
**Problem**: The `hashStudentFields()` delta check works correctly — unchanged students are skipped. However, the `studentsSkipped` count is not being passed up through `runEnrollProSync()` return value to the `syncCoordinator.ts`. The `UnifiedSyncResult` shape declares `studentsSkipped` but `runEnrollProSync` must populate it.

**Verification needed**: Confirm the return value of `runEnrollProSync()` includes `studentsSkipped`. If not, the admin sync status panel will always show `0 unchanged` even when 500 students are correctly skipped. This hides efficiency data.

---

### ISSUE-04 — Admin Dashboard Has No Auto-Refresh / Polling

**File**: `src/pages/admin/Dashboard.tsx` lines 89–91  
**Problem**: The Admin dashboard only fetches once on mount (`useEffect(() => fetchDashboard(), [])`). There is **no polling interval**. In contrast, the Registrar dashboard polls every 30 seconds. This means the Admin's "Today's Logins", "Active Users", and "Total Students" numbers freeze after initial load — the admin has to manually navigate away and back to get fresh numbers.

**Fix**: Add a **60-second polling interval** to `adminDashboard.tsx` (not 30s — admin metrics don't need to be as fresh as registrar's enrollment view).

---

### ISSUE-05 — Admin Dashboard Does Not Trigger Sync on Login Yet

**File**: `server/src/routes/auth.ts` lines 192–194  
**Status**: This exists in code (`triggerImmediateSync('admin_login')`) — ✅ already implemented.  
**Gap**: The **Registrar** login does NOT yet trigger `triggerImmediateSync`. The auth.ts block only checks for `ADMIN` role.

**Fix**: Extend the block to also call `triggerImmediateSync('registrar_login')` when `user.role === 'REGISTRAR'`.

---

### ISSUE-06 — Registrar `GET /students` Real-Time Mode Still Fetches All Learners

**File**: `server/src/routes/registrar.ts` lines 337–380  
**Problem**: When `?realtime=true` is passed to `GET /api/registrar/students`, it again calls `getAllIntegrationV1Learners()` — fetching all paginated records from EnrollPro. The Student Records page likely uses this. Filtering by grade level / section is done in-memory after fetching everything.

**Fix**: Server-side filtering is not available in EnrollPro's integration v1 API, so we should **not use real-time mode on the student list page**. The student list should always read from the local synced SMART DB. Only the dashboard header counts should attempt a live ping.

---

### ISSUE-07 — `school-years` Endpoint Returns Hardcoded Years

**File**: `server/src/routes/registrar.ts` lines 308–312  
**Problem**: The `/api/registrar/school-years` endpoint always injects `"2026-2027"`, `"2025-2026"`, and `"2024-2025"` as hardcoded fallbacks regardless of what's in the database or EnrollPro. If the school is in year `"2027-2028"`, these hardcodes will be misleading.

**Fix**: Remove hardcoded years. Read available years only from `prisma.section.findMany({ distinct: ['schoolYear'] })` and supplement with the active year from `resolveEnrollProSchoolYear()`.

---

### ISSUE-08 — Admin Dashboard Still Depends on Local DB for `totalTeachers`, `totalAdmins`, `totalRegistrars`

**File**: `server/src/routes/admin.ts` lines 151–160  
**Status**: `totalStudents` now correctly pings EnrollPro first (fixed in previous session). However, `totalTeachers` still reads from the local SMART DB `User` table — which is only updated when the EnrollPro sync runs.

**Severity**: Low-Medium. Teacher records change infrequently so 60-minute staleness is acceptable. But newly onboarded teachers in EnrollPro will not appear in the count until the next sync.

**Fix**: Add a lightweight real-time ping for `totalTeachers` using `getIntegrationV1Faculty()` with a `meta.total` (if the EnrollPro integration endpoint supports it). If not supported, document this as acceptable local-DB behavior.

---

## Proposed Implementation Plan

### Phase 1 — Fix the Lag (ISSUE-01, ISSUE-06) ← Highest Priority

1. **`server/src/routes/registrar.ts`** — Registrar Dashboard:
   - Remove `getAllIntegrationV1Learners()` call.
   - Keep only `getIntegrationV1LearnersPage(id, 1, 1)` for `meta.total`.
   - Keep `getIntegrationV1Sections(id)` for section counts.
   - Use local DB for gender/grade breakdown (already computed).

2. **`server/src/routes/registrar.ts`** — Student List:
   - Remove `?realtime=true` mode or gate it behind an explicit admin action only.
   - Default student list to always read from local SMART DB.

### Phase 2 — Tune Sync Frequency (ISSUE-02, ISSUE-05)

3. **`.env` / `syncCoordinator.ts`**:
   - Change `SYNC_INTERVAL_MINUTES` to `60`.
   - Add page-load sync trigger: if `lastSyncAt` is older than 10 minutes, call `triggerImmediateSync('registrar_page_load')` from the `/dashboard` route (non-blocking, fire-and-forget).

4. **`server/src/routes/auth.ts`**:
   - Add `REGISTRAR` to the login trigger block.

### Phase 3 — Fix Admin Staleness (ISSUE-04, ISSUE-07, ISSUE-08)

5. **`src/pages/admin/Dashboard.tsx`**:
   - Add 60-second `setInterval` polling for dashboard refresh.

6. **`server/src/routes/registrar.ts`** — School Years:
   - Remove hardcoded year injection.
   - Pull active year from `resolveEnrollProSchoolYear()`.

7. **`server/src/routes/admin.ts`** — Teacher Count:
   - Investigate if `getIntegrationV1Faculty()` returns a `meta.total`.
   - If yes, use it for a real-time teacher count.
   - If no, document as acceptable.

### Phase 4 — Observability (ISSUE-03)

8. **`server/src/lib/enrollproSync.ts`**:
   - Confirm `studentsSkipped` is correctly returned from `runEnrollProSync()` and surfaced in the sync status panel.

---

## Summary Table

| Issue | Severity | File(s) | Fix |
|-------|----------|---------|-----|
| ISSUE-01 | 🔴 Critical | `registrar.ts` dashboard | Remove `getAllIntegrationV1Learners` from dashboard |
| ISSUE-02 | 🟠 High | `syncCoordinator.ts` | Change interval to 60 min + page-load trigger |
| ISSUE-03 | 🟡 Medium | `enrollproSync.ts` | Verify `studentsSkipped` is surfaced |
| ISSUE-04 | 🟡 Medium | `admin/Dashboard.tsx` | Add 60s polling interval |
| ISSUE-05 | 🟠 High | `auth.ts` | Add REGISTRAR login sync trigger |
| ISSUE-06 | 🟠 High | `registrar.ts` students | Remove `?realtime=true` from default student list |
| ISSUE-07 | 🟡 Medium | `registrar.ts` school-years | Remove hardcoded year values |
| ISSUE-08 | 🟢 Low | `admin.ts` | Real-time teacher count from EnrollPro |

---

## User Review Required

> Please review and approve. Once approved, implementation will be done **in order**, one file at a time, with verification between each phase to avoid the mistake of jumping ahead.
