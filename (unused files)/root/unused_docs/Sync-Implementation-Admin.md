# Admin Sync & System Health Implementation Plan

This document outlines the strategy for resolving stale data on admin login, integrating with EnrollPro, and establishing a robust System Health monitoring architecture.

## 1. Auto-Sync on Admin Login
Currently, the system relies on a 5-minute background polling interval. To ensure administrators always see the most up-to-date data upon logging in, we will hook into the authentication flow.
*   **Implementation**: In the login route (likely `server/src/routes/auth.ts`), after successfully authenticating an `ADMIN` user, we will invoke the non-blocking `triggerImmediateSync('admin_login')` function from `syncCoordinator.ts`.
*   **Benefit**: Eliminates the "stale data window" (up to 5 minutes) when an admin first opens the dashboard.

## 2. EnrollPro Data Requirements
Based on the `ENROLLPRO-API.md` documentation, SMART acts as a downstream consumer of EnrollPro. During our synchronization cycles, we require the following read-only integration endpoints:
*   `GET /api/integration/v1/health`: To verify EnrollPro is online before attempting a data pull.
*   `GET /api/integration/v1/school-year`: To capture the active `schoolYearId` context.
*   `GET /api/integration/v1/faculty`: To create and update `Teacher` and `User` records in SMART.
*   `GET /api/integration/v1/sections`: To create `Section` definitions and assign advising teachers.
*   `GET /api/integration/v1/learners`: To maintain the global `Student` masterlist.
*   `GET /api/integration/v1/sections/:sectionId/learners`: To map students to their respective sections by creating `Enrollment` records.

## 3. System Health & Metrics Subsystem
We will implement or expand the `/api/admin/system/health` endpoint to serve as a comprehensive "pulse check" for the entire SMART ecosystem.

The response will aggregate:
*   **Local Server Metrics**: Node.js uptime, memory usage (`process.memoryUsage()`), and Prisma database connectivity (via a simple `SELECT 1`).
*   **EnrollPro Connectivity**: Ping `http://<enrollpro>/api/integration/v1/health`.
*   **Atlas Connectivity**: Ping `http://<atlas>/api/v1/health` (to ensure teacher load syncing is possible).
*   **AIMS Connectivity**: Ping `http://<aims>/api/v1/health` (LMS availability).

## 4. Senior Developer Recommendations (Production Hardening)
To elevate this system from a prototype to a highly resilient production environment, I strongly recommend adding the following architectural improvements:

### Persistent Sync History Table
Currently, `syncCoordinator.ts` stores `lastSyncResult` in memory. If the server restarts, all sync history is lost. We should create a `SyncHistory` Prisma model to log every sync attempt, its duration, the number of records mutated, and any errors. This is crucial for debugging.

### Circuit Breaker Pattern
If EnrollPro or Atlas goes offline, the 5-minute scheduled sync will repeatedly hang and timeout, potentially exhausting server memory or connection pools. We need a fail-fast mechanism (Circuit Breaker) that skips the sync cycle entirely if the `health` endpoints fail, and alerts the admin.

### Delta (Incremental) Synchronization
Pulling the *entire* student and teacher list every 5 minutes will eventually cause massive performance degradation as the school grows. We should update the EnrollPro endpoints to accept an `?updatedSince=` parameter, allowing SMART to only fetch records that changed since the last successful sync.

### Admin Diagnostics UI
The frontend should have a dedicated "System Health" page visualizing the uptime of all 3 companion systems (Atlas, AIMS, EnrollPro) using traffic light indicators (Green/Yellow/Red) alongside the persistent sync history logs.
