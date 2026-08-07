# Registrar Sync & Frontend Refactoring Plan

This document outlines the strategy for resolving stale data for the Registrar, removing manual data entry forms that conflict with EnrollPro, and establishing a robust read-only synchronization architecture.

## 1. Auto-Sync on Registrar Login
Just like the Admin, the Registrar is highly dependent on having the most accurate student masterlist and section assignments.
*   **Implementation**: Hook into the authentication flow so that when a user logs in with the `REGISTRAR` role, the server triggers `triggerImmediateSync('registrar_login')`.
*   **Benefit**: This ensures that before the Registrar even loads the dashboard, the 5-minute stale data window is eliminated, and all students admitted in EnrollPro are immediately pulled into SMART.

## 2. Refactoring `Enrollment.tsx` (Removing "Add Enrollment")
Currently, `src/pages/registrar/Enrollment.tsx` contains mock data and buttons for manual enrollment ("New Enrollment", "Approve", "Reject"). Since EnrollPro is the absolute Source of Truth for admissions, keeping these buttons creates dangerous data conflicts.
*   **Remove "New Enrollment" Button**: Registrars should no longer add students directly into SMART.
*   **Remove Action Dropdowns**: Remove the "Approve", "Reject", and "Edit" options from the table rows.
*   **Wire to Real Data**: Replace the `mockEnrollments` array with an API call to `/api/registrar/students` (which pulls the enrollments that were background-synced from EnrollPro).
*   **Rename the UI Context**: Change the title from "Enrollment Management" to "Synced Student Masterlist" to clarify that this is a read-only view of EnrollPro data.

## 3. EnrollPro Data Requirements for the Registrar
For the Registrar to do their job (printing ECRs, SF1, SF5, SF10), they rely on the following integration endpoints from EnrollPro:
*   `GET /api/integration/v1/learners`: To maintain the global `Student` masterlist.
*   `GET /api/integration/v1/sections/:sectionId/learners`: To accurately build the section rosters so that Teachers can generate the Electronic Class Record (ECR).
*   *Note on Grades*: For SF5 and SF10, SMART calculates the grades locally. EnrollPro will *pull* these grades from SMART using `POST /api/integration/smart/sections/:id/sync-grades`.

## 4. Senior Developer Recommendations (Value-Adds)
To make the Registrar's workflow flawless, I recommend adding the following features:

### Manual "Force Sync" Button on the Dashboard
While the system syncs every 5 minutes and on login, Registrars often deal with immediate requests (e.g., a student just finalized enrollment in the other office and the teacher needs them on the class list *now*). Adding a manual "Sync with EnrollPro" button specifically on the Registrar dashboard provides peace of mind and immediate resolution.

### Sync Status Indicator
Add a small "Last Synced: 2 minutes ago" badge next to the Masterlist. If the sync fails or is stale (e.g., > 10 minutes old), the badge should turn yellow or red to warn the Registrar that they might be looking at outdated data.

### Data Validation Warnings (SF1 / SF5 Prep)
Sometimes data pulled from external systems has missing fields. We should add a "Data Completeness" check that highlights students with missing LRNs or birthdates, as these will cause the official DepEd School Forms (SF1/SF5) to generate incorrectly.

## 5. Bypassing Stale Local Metrics (Real-Time Stats)
To completely avoid the stale data issue seen in the Admin dashboard (where `totalStudents` relied on out-of-date local DB counts), the Registrar's dashboard must rely on **real-time HTTP requests to EnrollPro** for top-level metrics.
*   **Implementation**: When rendering dashboard counts (like Total Students), the backend `/api/registrar/dashboard` will make a direct `GET /api/integration/v1/learners?limit=1` request to EnrollPro.
*   **Extraction**: We will extract the exact count directly from the EnrollPro response `meta.total`.
*   **Resiliency**: If EnrollPro is offline, the backend will gracefully fallback to the local DB count. This guarantees 100% accuracy without waiting for background sync cycles.

---

## User Review Required
Please review this updated plan. Let me know if you approve so we can execute it without any stale data mistakes!
