# SMART System Snapshot

**Date:** 2026-05-14

This document is a current-state map of the SMART codebase. It is meant to be handed to another AI for planning, so it focuses on structure, flow, data contracts, and the important business rules that are active right now.

## 1. What SMART Is

SMART is a school records system with three main user roles:

- **Teacher**: manages class records, grading, advisory views, attendance, and ECR flows.
- **Registrar**: manages student records, enrollment, and School Form outputs.
- **Admin**: manages users, templates, grading config, system settings, audit logs, and class assignments.

The system is split into a React frontend and an Express/Prisma backend. It integrates with external school systems for advisory, teaching load, student enrollment, and schedule data.

## 2. Hard Rules In The Repo

- External systems are read-only. SMART must never write to EnrollPro, ATLAS, or other third-party systems.
- SMART writes only to its own local database (`smart_db`).
- DepEd forms should prefer template-based Excel generation.
- If Prisma schema changes, run `prisma db push` and `prisma generate`.
- Keep backend, frontend, routes, and docs in sync when behavior changes.

## 3. Project Layout

### Root frontend
- `src/App.tsx`: route registration for the whole SPA.
- `src/layouts/`: role-based shell layouts for Teacher, Registrar, Admin.
- `src/pages/`: page-level UI.
- `src/lib/api.ts`: Axios client and typed API wrappers.
- `src/lib/utils.ts`: shared UI helpers.
- `src/contexts/ThemeContext.tsx`: branding/theme state.

### Server
- `server/src/index.ts`: Express bootstrap, middleware, route mounting, sync schedulers.
- `server/src/routes/`: route handlers for auth, grades, advisory, registrar, admin, attendance, templates, ECR templates, integration.
- `server/src/lib/`: sync logic, clients, Prisma wrapper, SSE, audit helpers, workload helper.
- `server/prisma/schema.prisma`: database schema.
- `server/prisma/seed.ts`: seed script.

## 4. Runtime Entry Points

### Frontend entry
- `src/main.tsx` mounts the React app.
- `src/App.tsx` wires all routes.

### Backend entry
- `server/src/index.ts`:
  - loads env from `server/.env`
  - enables CORS for local frontend origins
  - serves uploads statically
  - mounts API routers
  - starts ATLAS, EnrollPro, and branding sync schedulers
  - serves the built frontend in production

## 5. Frontend Route Map

### Public
- `/login`
- `/login/admin`
- `/login/registrar`

### Teacher
- `/teacher`
- `/teacher/classes`
- `/teacher/records`
- `/teacher/records/:classAssignmentId`
- `/teacher/advisory`
- `/teacher/advisory/student/:studentId`
- `/teacher/attendance`
- `/teacher/attendance-reports`

### Registrar
- `/registrar`
- `/registrar/students`
- `/registrar/enrollment`
- `/registrar/forms`

### Admin
- `/admin`
- `/admin/users`
- `/admin/logs`
- `/admin/grading`
- `/admin/settings`
- `/admin/templates`
- `/admin/ecr-templates`
- `/admin/assignments`

## 6. Layout Behavior

### Teacher layout
- Sidebar nav: Dashboard, Class Records, My Advisory, Attendance, Attendance Reports.
- Uses session token + user role gate.
- Shows school branding from ThemeContext.

### Registrar layout
- Sidebar nav: Dashboard, Student Records, Enrollment, School Forms.
- Uses session token + user role gate.

### Admin layout
- Sidebar nav: Dashboard, User Management, Class Assignments, Audit Logs, Grading Config, Template Managers, System Settings.
- Template Managers dropdown contains SF Forms and ECR Templates.

## 7. Main Backend Route Map

Mounted routers in `server/src/index.ts`:

- `/api/auth`
- `/api/grades`
- `/api/advisory`
- `/api/registrar`
- `/api/admin`
- `/api/attendance`
- `/api/templates`
- `/api/ecr-templates`
- `/api/integration`

Health check:
- `GET /api/health`

## 8. Core Data Model

The Prisma schema now includes these main entities and behaviors:

### People and school structure
- `User`
- `Teacher`
- `Student`
- `Section`
- `Enrollment`
- `Subject`
- `ClassAssignment`
- `Attendance`
- `Grade`
- `WorkloadEntry`

### Important schema updates
- `ClassAssignment.teachingMinutes Int?`
- `Grade.qualitativeDescriptor String?`
- `WorkloadEntry` tracks advisory-role credit separately.
- `WorkloadType` currently includes `ADVISORY_ROLE`.
- `Teacher` and `Section` now have inverse `workloadEntries` relations so Prisma validates the new model.

## 9. Current Business Rules

### HG / Homeroom Guidance
- HG is now treated as a normal subject assignment in the teaching load.
- HG is not filtered out of sync or admin teaching-load views.
- HG subject names are normalized to `Homeroom Guidance` during sync and manual admin creation.
- HG class assignments are stored with `teachingMinutes = 60`.
- HG grading is qualitative-only.
- ECR preview/import/status is blocked for HG classes.

### Advisory role
- Advisory is tracked separately from subject assignments.
- Advisory workload credit lives in `WorkloadEntry` with type `ADVISORY_ROLE`.
- Advisory role credit is upserted from EnrollPro sync and ATLAS adviser sync.

### Numeric grading
- Non-HG subjects still use the DepEd numeric flow:
  - Written Work
  - Performance Task
  - Quarterly Assessment
  - Transmutation to quarterly grade
- Generic fallback weights remain available when no exact ECR template is active.

## 10. Current Sync Flow

### A. Teacher login sync
File: `server/src/lib/teacherSync.ts`

Flow:
1. Teacher logs in.
2. SMART finds the teacher in EnrollPro and ATLAS.
3. SMART syncs advisory section and student roster from EnrollPro.
4. SMART pulls teaching assignments from ATLAS faculty assignments.
5. SMART creates or updates section/class assignment rows.
6. HG assignments are kept and labeled as Homeroom Guidance.
7. HG assignments get `teachingMinutes = 60`.
8. Advisory workload is synced via `WorkloadEntry`.
9. Teaching sections are populated with enrolled learners.

### B. ATLAS background sync
File: `server/src/lib/atlasSync.ts`

Flow:
1. Scheduler runs on interval.
2. Loads ATLAS faculty.
3. Matches ATLAS faculty to SMART teachers by email.
4. Pulls ATLAS faculty assignments.
5. Creates/updates class assignments.
6. HG assignments are kept, normalized, and assigned 60 minutes.
7. Advisers are synced from ATLAS `/faculty/advisers`.
8. Advisory workload is upserted into `WorkloadEntry`.

### C. EnrollPro background sync
File: `server/src/lib/enrollproSync.ts`

Flow:
1. Scheduler runs on interval.
2. Loads active school year from EnrollPro integration v1.
3. Loads teachers and sections.
4. Upserts sections, students, and enrollments.
5. Syncs advisory assignment onto sections.
6. Upserts advisory workload entries.

## 11. Current Teacher Grading Flow

File: `server/src/routes/grades.ts`

### Teacher class list
- `GET /api/grades/my-classes`
- Returns all teacher assignments, including HG.

### Class record view
- `GET /api/grades/class-record/:classAssignmentId`
- Returns roster + grades + effective weights.

### Save grade
- `POST /api/grades/grade`
- For normal subjects:
  - numeric score arrays are saved
  - percentage scores are computed
  - transmutation is applied
- For HG:
  - `qualitativeDescriptor` is required
  - numeric score fields are ignored
  - numeric grade fields are null

Allowed HG descriptors:
- No Improvement
- Needs Improvement
- Developing
- Sufficiently Developed

### Delete grade
- `DELETE /api/grades/grade/:gradeId`
- Allowed for HG and non-HG.

### Teacher dashboard endpoints
- `GET /api/grades/dashboard`
- `GET /api/grades/dashboard-stats`
- `GET /api/grades/mastery-distribution`

These now include HG classes in the assignment set, but HG is excluded from numeric averages, honors calculations, and mastery distributions where relevant.

### ECR flows
- `POST /api/grades/ecr/preview`
- `POST /api/grades/ecr/import`
- `GET /api/grades/ecr/status/:classAssignmentId`

These are blocked for HG classes.

## 12. Current Advisory Flow

File: `server/src/routes/advisory.ts`

### Advisory summary
- `GET /api/advisory/my-advisory`
- Returns teacher advisory section, roster, and subject list.

### Student grade profile
- `GET /api/advisory/student/:studentId/grades`
- Returns all subject grades for the student.
- HG grades show qualitative descriptors.
- HG is excluded from:
  - general average
  - promotion status calculations
  - honors computations

### Advisory section summary
- `GET /api/advisory/summary`
- Returns rankings and section stats for the advisory class.
- HG is excluded from numeric rank/average math.

## 13. Admin Class Assignments / Workload View

File: `server/src/routes/admin.ts`

### Admin class assignments
- `GET /api/admin/class-assignments`
- Returns raw class assignments plus a workload summary.

Workload summary buckets now show:
- Line 1: HG minutes
- Line 2: Advisory role minutes
- Line 3: Other subject minutes
- Total minutes

### Admin create class assignment
- `POST /api/admin/class-assignments`
- If the subject is HG, the subject name is normalized and `teachingMinutes` is set to 60.

### Admin UI
File: `src/pages/admin/ClassAssignments.tsx`
- Shows class assignment table.
- Shows workload summary table.
- Lets admin manually create/delete assignments.

## 14. Integration Endpoints

File: `server/src/routes/integration.ts`

### EnrollPro integration
- `/api/integration/enrollpro/my-advisory`
- `/api/integration/enrollpro/sections`
- `/api/integration/enrollpro/faculty`

### ATLAS integration
- `/api/integration/atlas/my-teaching-load`
- Now includes HG assignments.
- Returns local SMART assignments for the logged-in teacher.

### AIMS integration
- `/api/integration/aims/auth`
- `/api/integration/aims/gradebook/:courseId`

### Sync SSE
- `/api/integration/sync/stream`
- SSE channel for live sync updates.

## 15. Template And ECR System

### Template areas
- SF form template manager
- ECR template manager

### Relevant routes
- `/api/templates`
- `/api/ecr-templates`

### Frontend pages
- Admin template manager
- Admin ECR template manager

### Important behavior
- ECR generation is still the main pathway for numeric subjects.
- HG classes do not use ECR generation/import.

## 16. Frontend API Layer

File: `src/lib/api.ts`

Important wrappers include:
- auth API
- grades API
- advisory API
- admin API
- registrar API
- integration API helpers

Notable type updates:
- `ClassAssignment` now includes `teachingMinutes`
- `Grade` now includes `qualitativeDescriptor`
- `QuarterGrade` includes `qualitativeDescriptor`
- admin class assignment API returns workload summary data

## 17. Current UI Behavior For HG

### Teacher class record page
File: `src/pages/teacher/ClassRecordView.tsx`
- For HG classes, the page switches to qualitative descriptor mode.
- Numeric ledger and ECR buttons are hidden.
- A descriptor table is shown with per-student dropdowns.

### Student grade profile page
File: `src/pages/teacher/StudentGradeProfile.tsx`
- HG subject grades display descriptors instead of numeric grades.
- HG is excluded from the general average.

## 18. Current Known Build / Verification Status

What was verified:
- Prisma schema push and client generation succeeded.
- Type diagnostics on the changed files are clean.

What still fails in builds:
- Root build reports `vite` not found in PATH.
- Server build reports unrelated TypeScript/module issues involving `mongoose` and `./models/SmartCase`.

These are existing environment/repo problems outside the current HG refactor.

## 19. Key Files To Know First

If another AI needs to continue work, these are the first files to read:

- [src/App.tsx](src/App.tsx)
- [server/src/index.ts](server/src/index.ts)
- [server/src/routes/grades.ts](server/src/routes/grades.ts)
- [server/src/routes/advisory.ts](server/src/routes/advisory.ts)
- [server/src/routes/admin.ts](server/src/routes/admin.ts)
- [server/src/routes/integration.ts](server/src/routes/integration.ts)
- [server/src/lib/teacherSync.ts](server/src/lib/teacherSync.ts)
- [server/src/lib/atlasSync.ts](server/src/lib/atlasSync.ts)
- [server/src/lib/enrollproSync.ts](server/src/lib/enrollproSync.ts)
- [src/lib/api.ts](src/lib/api.ts)
- [src/pages/teacher/ClassRecordView.tsx](src/pages/teacher/ClassRecordView.tsx)
- [src/pages/teacher/StudentGradeProfile.tsx](src/pages/teacher/StudentGradeProfile.tsx)
- [src/pages/admin/ClassAssignments.tsx](src/pages/admin/ClassAssignments.tsx)
- [server/prisma/schema.prisma](server/prisma/schema.prisma)

## 20. Practical Summary

The current system is a school records app with three role-based portals, multiple external integrations, a template-driven ECR system, and a new DepEd-compliance refactor in progress. HG is now treated as a real subject for load tracking, but its grading is qualitative-only and advisory is tracked separately as a workload role.

If you want to plan future work on this codebase, the next major surfaces are likely:
- remaining frontend HG-aware edits outside the pages already updated
- cleanup of any lingering docs or UI labels that still describe HG filtering
- hardening around workload reporting and admin summaries
- fixing the unrelated build environment issues noted above
