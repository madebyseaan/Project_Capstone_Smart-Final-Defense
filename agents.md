# SMART — Agent Guide

## Project
SMART (Student Management and Records Tracking) is a DepEd public school management system for Junior High School (Grades 7-10). Handles grading, attendance, enrollment, and school forms. Three roles: TEACHER, ADMIN, REGISTRAR.

## Tech Stack
- **Frontend:** React 19, Vite, React Router, React Query, Tailwind CSS, shadcn/ui
- **Backend:** Node.js, Express 5, Prisma (PostgreSQL), ts-node-dev
- **Tooling:** ESLint, TypeScript, Vite, Prisma CLI
- **Package manager:** npm (package-lock.json)

## Commands
```bash
# Frontend (root)
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # Lint check

# Backend (server/)
npm run dev          # Start backend
npm run build        # TypeScript compile
npm run prisma:generate
npm run prisma:migrate
npm run prisma:push
npm run prisma:seed
```

## Coding Rules

### TypeScript
- Keep types explicit, avoid `any`
- Use `zod` for validation schemas
- Use async/await, validate inputs centrally

### React
- Function components with hooks only
- Keep components small and focused
- Use existing React Query patterns for data fetching

### Backend
- Keep routes thin — business logic in `lib/` and `services/`
- Centralize error handling
- Use Prisma transactions for multi-step writes

### File Size
- **1000 lines max per file.** If exceeded, split into smaller modules.

## File Map
```
src/                              # Frontend (React)
├── App.tsx                       # Root component, routes
├── main.tsx                      # Entry point
├── components/                   # Reusable UI
│   ├── ui/                       # shadcn/ui primitives
│   ├── layout/                   # Shared layout components
│   │   ├── PageHeader.tsx        # Page header (title + description + actions)
│   │   └── StatCard.tsx          # Stat card for dashboards
│   ├── data-table/               # DataTable system
│   │   ├── DataTable.tsx         # Generic <T> table component
│   │   ├── TableToolbar.tsx      # Search + filter toolbar
│   │   ├── TablePagination.tsx   # Canonical pagination footer
│   │   ├── TableStates.tsx       # Empty, loading, error states
│   │   ├── usePagination.ts      # 1-based pagination hook
│   │   ├── types.ts              # TableColumn, TableFilter types
│   │   └── index.ts              # Barrel export
│   ├── ExcelRenderer.tsx         # Excel file viewer
│   ├── GradeDeadlineBanner.tsx   # Grade deadline warnings
│   └── GradeStatusBanner.tsx     # Grade status display
├── contexts/
│   └── ThemeContext.tsx           # Dark/light theme
├── hooks/
│   └── useSyncStream.ts          # SSE sync streaming
├── layouts/                      # Role-based layouts
│   ├── AdminLayout.tsx           # Admin portal wrapper
│   ├── RegistrarLayout.tsx       # Registrar portal wrapper
│   └── TeacherLayout.tsx         # Teacher portal wrapper
├── lib/
│   ├── api.ts                    # Axios API client, interceptors
│   ├── constants.ts              # App constants
│   ├── useTemplate.ts            # Template fetching hook
│   └── utils.ts                  # Utility functions
└── pages/
    ├── LoginPage.tsx              # Main login page
    ├── AdminLoginPage.tsx        # Admin login
    ├── RegistrarLoginPage.tsx    # Registrar login
    ├── admin/                    # Admin pages
    │   ├── Dashboard.tsx         # Admin overview
    │   ├── UserManagement.tsx    # CRUD users
    │   ├── ClassAssignments.tsx  # Assign teachers to classes
    │   ├── GradingConfig.tsx     # Grading periods config
    │   ├── TransmutationTable.tsx # Grade transmutation
    │   ├── SchoolYears.tsx       # School year management
    │   ├── EditRequests.tsx      # Teacher edit requests
    │   ├── AuditLogs.tsx         # System audit trail
    │   ├── SystemSettings.tsx    # App settings
    │   ├── SystemHealth.tsx      # Server health
    │   ├── TemplateManager.tsx   # School form templates
    │   └── components/           # Admin-specific components
    ├── teacher/                  # Teacher pages
    │   ├── Dashboard.tsx         # Teacher overview
    │   ├── ClassRecordsList.tsx  # List of class records
    │   ├── ClassRecordView.tsx   # View/edit class record
    │   ├── Attendance.tsx        # Take attendance
    │   ├── AttendanceReports.tsx # Attendance reports
    │   ├── MyAdvisory.tsx        # Advisory class
    │   ├── Schedule.tsx          # Teacher schedule
    │   ├── StudentGradeProfile.tsx # Student grades
    │   └── components/           # Teacher-specific components
    └── registrar/                # Registrar pages
        ├── Dashboard.tsx         # Registrar overview
        ├── StudentRecords.tsx    # Student master list
        ├── SectionRosterViewer.tsx # Section rosters
        ├── EOSYFinalization.tsx  # End-of-school-year
        ├── RemedialTracker.tsx   # Remedial classes
        ├── TeachingLoad.tsx      # Teacher load
        ├── SchoolForms.tsx       # Form generation
        ├── PrintCenter.tsx       # Print forms
        ├── AlumniStudents.tsx    # Archived students
        └── FormViewer.tsx        # View forms

server/src/                       # Backend (Express)
├── index.ts                      # Server entry, port config
├── app.ts                        # Express app setup, middleware
├── config/
│   └── env.ts                    # Environment variable loader
├── middleware/
│   ├── auth.ts                   # JWT verification, role check
│   ├── csrf.ts                   # CSRF token validation
│   ├── rateLimiter.ts            # Request rate limiting
│   └── validate.ts               # Zod schema validation
├── routes/                       # API endpoints
│   ├── auth.ts                   # POST /api/auth/login, logout, refresh
│   ├── admin.ts                  # /api/admin/* (users, settings)
│   ├── grades.ts                 # /api/grades/* (class records, grading)
│   ├── attendance.ts             # /api/attendance/* (take, report)
│   ├── advisory.ts               # /api/advisory/* (advisory class)
│   ├── registrar.ts              # /api/registrar/* (students, forms)
│   ├── sync.ts                   # /api/sync/* (EnrollPro/ATLAS sync)
│   ├── integration.ts            # /api/integration/* (external APIs)
│   └── templates.ts              # /api/templates/* (school forms)
├── schemas/                      # Zod validation schemas
│   ├── auth.ts                   # Login, token schemas
│   ├── admin.ts                  # User CRUD schemas
│   ├── grades.ts                 # Grade submission schemas
│   ├── attendance.ts             # Attendance schemas
│   ├── registrar.ts              # Student record schemas
│   ├── integration.ts            # Integration schemas
│   └── templates.ts              # Template schemas
├── lib/                          # Business logic
│   ├── prisma.ts                 # Prisma client instance
│   ├── logger.ts                 # Winston logger
│   ├── tokens.ts                 # JWT generation/verification
│   ├── audit.ts                  # Audit logging
│   ├── schoolYearResolver.ts     # Current school year logic
│   ├── transmutationValidation.ts # Grade transmutation rules
│   ├── transmutationCache.ts     # Cache for transmutation tables
│   ├── teacherSync.ts            # Sync teachers from EnrollPro
│   ├── teacherDashboardComposer.ts # Compose teacher dashboard data
│   ├── studentProfileSync.ts     # Sync student profiles
│   ├── studentSnapshot.ts        # Student data snapshots
│   ├── workload.ts               # Teacher workload calc
│   ├── systemHealth.ts           # Health check endpoints
│   ├── sseManager.ts             # Server-Sent Events manager
│   ├── syncCache.ts              # Sync data cache
│   ├── syncCoordinator.ts        # Orchestrate multiple syncs
│   ├── enrollproClient.ts        # EnrollPro API client
│   ├── enrollproSync.ts          # EnrollPro data sync
│   ├── enrollproBrandingSync.ts  # EnrollPro branding sync
│   ├── atlasSync.ts              # ATLAS integration sync
│   ├── atlasUtils.ts             # ATLAS helper functions
│   ├── aimsClient.ts             # AIMS API client
│   └── sync/                     # Sync utilities
│       ├── httpClient.ts         # HTTP client for syncs
│       └── utils.ts              # Sync utility functions
├── services/
│   ├── templateService.ts        # School form template logic
│   └── excelStyleParser.ts       # Excel style parsing
├── __tests__/                    # Backend tests
│   ├── auth.test.ts
│   ├── csrf.test.ts
│   ├── grade-lock.test.ts
│   ├── sf10-snapshot.test.ts
│   └── validation.test.ts
└── types/
    └── xlsx-populate.d.ts        # Type definitions

server/prisma/
└── schema.prisma                 # Database schema
```

## Architecture

### Multi-Session System
Each portal (admin/teacher/registrar) has its own sessionStorage keys:
- `token_admin`, `user_admin`, `refreshToken_admin`
- `token_teacher`, `user_teacher`, `refreshToken_teacher`
- `token_registrar`, `user_registrar`, `refreshToken_registrar`

### Role Authorization (Two Layers)
1. **Frontend:** Layout components check `sessionStorage` role → redirect if mismatch
2. **Backend:** `authorizeRoles()` middleware checks JWT role → 403 if not allowed

### Term Sync
- Current term always fetched live from EnrollPro (`resolveCurrentTerm()`)
- Falls back to DB if EnrollPro unreachable
- Never hardcode or manually set the term
- The scheduler does NOT auto-advance terms — only `resolveCurrentTerm()` writes `currentTerm` to DB
- The scheduler only handles grade locking (when term end date passes)

### Data Flow Patterns
- **Auth:** Login → JWT token → sessionStorage → Axios interceptor adds header → Backend verifies
- **Grades:** Teacher submits → validate with zod → check gradeLock → save to DB → sync to EnrollPro
- **Attendance:** Teacher takes → save to DB → can generate reports
- **Sync:** EnrollPro/ATLAS → background job → cache → DB fallback if offline

### Key Database Tables (Prisma)
- `User` — all users (admin, teacher, registrar)
- `SchoolYear` — academic years
- `Term` — semesters within school year
- `Section` — class sections
- `Subject` — subjects offered
- `ClassRecord` — teacher's class record
- `StudentGrade` — individual student grades
- `Attendance` — daily attendance
- `GradeLock` — prevents edits after deadline
- `AuditLog` — system audit trail

### External Integrations (READ-ONLY)
- **EnrollPro:** Student data, school years, terms
- **ATLAS:** Additional student records
- **AIMS:** School information system

## Design System

### Type Scale
| Role | Classes |
|---|---|
| Page title | `text-2xl font-bold tracking-tight text-foreground` |
| Page subtitle | `text-sm text-muted-foreground` |
| Card/section title | `text-base font-semibold text-foreground` |
| Card description | `text-sm text-muted-foreground` |
| Table header | `text-xs font-medium uppercase tracking-wide text-muted-foreground` |
| Table cell | `text-sm text-foreground` |
| Stat label | `text-xs font-medium text-muted-foreground` |
| Stat value | `text-2xl font-bold text-foreground` |

### Banned Patterns
- `style={{ color: ... }}` (inline color styles) — except ThemeContext dynamic colors
- `text-gray-*`, `text-slate-*`, `text-zinc-*` — use `text-foreground`, `text-muted-foreground`
- `bg-blue-600` and other raw palette colors for UI chrome — use `bg-primary`, `bg-destructive`, etc.
- `font-black`, `font-light` — use `font-medium`, `font-semibold`, `font-bold`
- `tracking-wider` on body text (table headers only)
- `space-y-8` on page roots — use `space-y-6`

### Page Scaffolding
- Page root: `<div className="space-y-6">`
- Use `PageHeader` component for all page headers (title + description + actions)
- Table containers: `Card` with `p-0` + `overflow-x-auto` wrapper
- Use `DataTable` system for standard list views (NOT for exotic layouts like ClassRecordTable ledger or SF form grids)

### DataTable System
- Components: `DataTable`, `TableToolbar`, `TablePagination`, `TableStates`
- Hook: `usePagination` (always 1-based externally)
- Rows per page: `[10, 25, 50, 100]`, default: **25**
- All table views must use semantic tokens, never hardcoded grays

### Shared Components
- `PageHeader` — `src/components/layout/PageHeader.tsx`
- `StatCard` — `src/components/layout/StatCard.tsx`
- `DataTable` family — `src/components/data-table/`

## Non-Negotiables
- Do not modify `.env` or `.env.*` files
- Do not write to external systems (EnrollPro/ATLAS) — read-only integrations only
- Do not refactor unrelated code in the same PR
- Always run `npm run build` before finishing to verify no type errors

## Gotchas
- EnrollPro offline = term sync uses DB fallback (correct behavior)
- `gradeLock` prevents edits even for current term
- Past terms are view-only unless teacher has approved edit request
- Frontend is in `src/` (not `client/src/`)
- Backend is in `server/src/`
- **isActive/isArchived query rule:** operational queries (current dashboards, teacher current classes, BOSY) filter `ClassAssignment.isActive` / `Enrollment.isArchived`. Historical/SF-form queries (SF1/SF5/SF10, registrar year-scoped views, EnrollPro sync-grades pull, promotion/EOSY libs) must filter by `schoolYear` string ONLY — never by isActive/isArchived, or prior-year data disappears after rollover archiving.
- **Grade lock precedence (T2/A1):** archived → year lock → term lock → legacy system-wide `gradeLock`. An APPROVED `GradeEditRequest` bypasses the TERM lock only; it never bypasses archived/year locks (only registrar unfinalize + admin unlock open those). Scheduler locks terms on their end dates and the year on T3 end.

## Communication
- English, terse responses
- No preamble before tool calls
- Minimal explanation unless asked for detail
