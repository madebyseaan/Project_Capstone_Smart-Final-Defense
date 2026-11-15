# SMART - Full-System QA Plan (All Roles, Evidence-Based)

**Status:** Planning - v2, code-grounded
**Owner:** QA
**Last updated:** 2026-11-15
**Method:** Full scan of frontend pages/components, backend routes, Prisma schema, core libs, and existing tests. No assumptions; every risk below cites source.
**Approach:** Hybrid - automated route/API sweeps + manual write-flow and lifecycle verification
**Data:** Dedicated QA school years with fixtures and a reset script. Never write test data into the live/current year.
**Deadline:** Finish QA by Tuesday Nov 17, 2026; Wednesday Nov 18 is a buffer/freeze day. Defense Thursday Nov 19. Execute the compressed sprint in section 8, not the full plan.

---

## 0. Evidence base (what was scanned)

| Area | Count |
|---|---|
| Frontend pages | 31 role pages (TEACHER 10, REGISTRAR 10, ADMIN 11) + login/SSO pages |
| Frontend route entries | 12 public/auth, 11 teacher, 10 registrar, 11 admin |
| Backend route files | 41 (15 top-level modules + sub-routers) |
| Backend endpoints parsed | 221 handlers |
| Endpoints with `validate(...)` in handler | 62 / 221 (28%) |
| Backend test files | 79 (`server/src/__tests__/*.test.ts`) |
| Playwright specs | 13 read-only specs in `e2e/` |
| Prisma models / enums | 31 models / 17 enums (`server/prisma/schema.prisma`) |
| Core libs reviewed | gradeLocks, gradeRecalc, gradingMode, termLockPolicy, termFinalization, promotion, remedial, rollover, teacherYearArchive, syncGuard/Coordinator, sf5/sf9/sf10 composers, attendanceAggregate, ecr import/export, prune |

Guard styles found:
- ADMIN: `authenticateToken` + `requireAdmin` or `authorizeRoles("ADMIN")` (78 handlers).
- TEACHER: `authenticateToken` + `authorizeRoles("TEACHER")` (40 handlers).
- REGISTRAR: `authenticateToken` plus a manual `if (user.role !== "REGISTRAR")` inside each handler (58 handlers). One SF1 read/export path also allows ADMIN.
- SERVICE: `serviceAuth` shared-secret (5 handlers).
- Public/SSO/auth-only or router-level middleware: 21 handlers.

---

## 1. System inventory

### 1.1 Frontend surfaces

| Role | Pages |
|---|---|
| Public/Auth | `/login`, `/login/admin`, `/login/registrar`, EnrollPro SSO (`callback`, `session`, `authorize`, `error`), AIMS (`/sso/aims`), ATLAS (`authorize`, `session`, `error`), 404 |
| TEACHER | Dashboard, Schedule, Class Records list, Class Record View, Attendance, Attendance Reports, My Advisory (Directory/Printables/Observed Values), Student Grade Profile, My Archives, Archive Detail |
| REGISTRAR | Dashboard, Section Roster, Term Finalization, Remedial, EOSY, Student Records + Records Vault, Transferees, SF10 Records, Former Students, School Forms |
| ADMIN | Dashboard, Class Assignments, Grade Edit Requests, User Management, Grading Config, Transmutation Table, School Years, Teacher Archives, System Settings, System Health, Audit Logs |

### 1.2 State machines that QA must exercise

| Entity | States / transitions |
|---|---|
| Grade | DRAFT -> FINALIZED; FINALIZED -> DRAFT (unfinalize). `LOCKED` enum exists but is not written anywhere. Locks are separate rows. |
| Grade lock precedence | archived -> YEAR lock -> TERM lock (APPROVED edit request bypasses TERM only) -> legacy `SystemSettings.gradeLock` (`gradeLocks.ts:4-7,84-125`) |
| Grade edit request | PENDING -> APPROVED / REJECTED; APPROVED -> EXPIRED (scheduler or revoke) |
| Enrollment | ENROLLED / PENDING / DROPPED / TRANSFERRED + `isArchived`; promotionStatus PROMOTED / CONDITIONALLY_PROMOTED / RETAINED / JHS_COMPLETER |
| Remedial | PENDING -> COMPLETED with outcome PASSED / FAILED_TUTORIAL; RCM 60-100; RFG = round((original + RCM)/2, 1) |
| School year | DRAFT / ACTIVE / COMPLETED / ARCHIVED; archival writes grades, enrollments, sections, assignments, year, lock |
| Teacher archive | PENDING / COMPLETE / FAILED; COMPLETE required for download |
| Grading mode | TRANSMUTED / ZERO_BASED; active-year switch blocked by finalized grades or EOSY snapshots |
| Sync | scheduled every 5 min; circuit breaker after 3 critical failures (5 min cooldown); prune runs each cycle |
| Schedulers | hourly term/year lock + edit-request expiry; daily retention cleanup; boot teacher-archive resume |

### 1.3 Key integration invariants

- EnrollPro/ATLAS/AIMS are read-only. SMART never pushes.
- EnrollPro pulls FINALIZED grades only via `POST /api/integration/smart/sections/:sectionId/sync-grades` (`integration.ts:246-247`, filtered at `:120-121`).
- Historical reads must filter by `schoolYear` only, never `isActive`/`isArchived` (SF1/SF5/SF10, registrar year views, EOSY, archives).
- `serviceAuth` fails closed when `ENROLLPRO_API_KEY` is unset (`middleware/serviceAuth.ts`).
- Destructive sync reconciliation is guarded by empty/ratio/coverage checks (`syncGuard.ts`).

---

## 2. Existing automated coverage (do not redo)

### 2.1 Backend (79 files, high-value groups)

| Domain | Test files |
|---|---|
| Auth / SSO / CSRF / security | `auth`, `auth-prune`, `csrf`, `service-auth`, `redact`, `requestContext`, `error-handler`, `settings-schema`, `companion-sso*`, `aims-sso`, `atlas-sso`, `atlas-reverse-sso` |
| Grades / locks / edit requests | `grade-lock`, `gradeLocks-lib`, `grade-batch`, `year-term-locks`, `edit-request-flow`, `grading-mode*`, `transmutation*`, `exam-math`, `ecr-parser` |
| Finalization / promotion / EOSY | `term-finalization`, `promotion`, `promotion-empty-section`, `registrar-finalize-year`, `eosy-finalization-status`, `termLockPolicy` |
| Remedial | `remedial-guard`, `remedial-reconcile` |
| Rollover / archives | `rollover`, `rollover-lib`, `archive-year-route`, `teacher-archives-*`, `data-integrity` |
| Sync / offline | `sync-outage-guard`, `syncVerification`, `cache-swr`, `external-state`, `rig-offline`, `prune`, `prune-year-guard`, `wipe` |
| Forms / records | `sf10-*`, `external-record-*`, `transferee-validation`, `attendance*`, `alumniClassifier-lib`, `schoolSettingsSnapshot`, `public-settings` |

### 2.2 E2E (13 specs, read-only)

Currently covered: login + all route render smoke per role (`portals`), 404, advisory printables and observed values, alumni vault, EOSY status board, grading mode (admin/teacher/forms), PWA install/offline banner, teacher archives, teacher error sanitization, term finalization UI cancel paths.

### 2.3 Coverage gaps (the QA focus)

1. UI write flows: grade entry/save, attendance save, edit-request approval, finalize/unfinalize clicks, remedial completion, settings save, school-year actions, SF10 CRUD.
2. API authorization matrix: every endpoint x anon / wrong role / correct role.
3. Cross-year and cross-section authorization (attendance, edit requests).
4. Historical data mutation when grading config changes.
5. Pagination/search state interactions across DataTable pages.
6. Legacy finalization endpoints vs new term-finalization behavior.
7. External sync UI states and queued-sync semantics.
8. Print/export correctness for all forms, not just route load.

---

## 3. Confirmed risk register (verify in QA)

Severity is the impact if the code path behaves as read. "Verify" means confirm intended behavior before filing.

| ID | Sev | Risk | Evidence | QA test |
|---|---|---|---|---|
| R-01 | P0 | Global weight/transmutation/subject-override edits recompute stored grades for ALL years, including FINALIZED and archived grades. SF5/SF10/archives read those stored values, so historical records can change after an admin edits a global config. | `gradeRecalc.ts:58-72` selects all grades with no status/year filter; `:119-135` updates every differing row. `grading.ts:149,196,479,509,544,569,645,703,729,763` call `realignStoredGrades` without a schoolYear. SF10: `sf10.ts:141-205`; SF5: `sf5Composer.ts:124-161`; archives: `teacherYearArchive.ts:120+`. | LC-01, ADM-GRD-06, LC-08 |
| R-02 | P0 | Attendance write auth is role-only, not section-ownership. Any TEACHER/ADMIN can clear or bulk-save attendance for any active section; any TEACHER can read any section/student attendance. Bulk save also accepts student IDs without verifying they belong to the section. | `attendance.ts:16-30` guard checks only section status/year; `POST /clear` `:139-166`; `POST /bulk` `:191-260`; GETs `:59,268,338,391,456`; no adviser/teacher check. | API-03, API-04, TCH-ATT-07 |
| R-03 | P0 | Legacy `POST /registrar/finalize-grades` and `/unfinalize-grades` bypass the new term-finalization guard. They do not check EOSY-finalized, archived year, or completed sections, so they can unfinalize after EOSY and break snapshot consistency. | `registrar/main.ts:1328-1489`; compare `termFinalization.ts:539-657`, where finalize blocks ARCHIVED/COMPLETED/EOSY and unfinalize blocks ARCHIVED only (`:641`). | REG-TERM-07, LC-04 |
| R-04 | P1 | Cross-year edit-request bypass: the term-bypass query checks teacher + term + APPROVED + expiry, but not schoolYear. A stale approval from another year can authorize editing a past term in the current year when the term is not locked. | `grades-sub/classes.ts` POST `/grade` and `/grade/batch` bypass queries; `grades-sub/ecr.ts` import bypass; `gradeLocks.ts:70-82` does check same year, but only when a term lock exists. | LC-03, TCH-CRV-11 |
| R-05 | P1 | Grades can be written for students who are not enrolled in the section. Single and batch saves only skip dropped/transferred when an enrollment row exists; missing enrollment is allowed. | `classes.ts` POST `/grade` enrollment lookup; batch `validUpdates` filter in `/grade/batch`. | API-11, TCH-CRV-12 |
| R-06 | P1 | DataTable pagination can show an empty page after filtering. `slice()` uses the internal unclamped page while the returned page is clamped; filters/search do not reset page. Affects every DataTable view. | `src/components/data-table/usePagination.ts:45-55`. | UX-01, ADM-USR-* , ADM-LOG-* |
| R-07 | P1 | Subject weight overrides accept arbitrary values: no sum-to-100 and no range validation. Effective weights are used directly in grading. | `admin-sub/grading.ts:684-780`; `grades-sub/helpers.ts:249-260`. UI has no sum check. | ADM-GRD-07 |
| R-08 | P1 | Validation coverage is uneven: 62/221 handlers use `validate()`. Several mutations are manual (school-year PATCH, subject weights, transmutation rows, some settings). Negative-input behavior must be tested endpoint by endpoint. | Route matrix; e.g. `classAssignments.ts:517`, `grading.ts:489-579,684-780`. | API-05 |
| R-09 | P2 | Authenticated-only endpoints with no role restriction: settings SSE stream, enrollpro sections, teacher transmutation read. Any authenticated role can subscribe/read. | `admin-sub/system.ts:1140`; `integration.ts:394`; `grades-sub/dashboard.ts:755`. | API-06 |
| R-10 | P2 | CSRF is explicitly exempt for all paths containing `/admin/settings`, all auth routes, and `sync-grades`/webhooks. Verify each state-changing settings endpoint still requires a bearer token and cannot be driven cross-site. | `middleware/csrf.ts:47-72`. | API-07 |
| R-11 | P2 | Access tokens are accepted from `?token=` on every authenticated route, not only SSE. Tokens can leak into logs/referrers. | `middleware/auth.ts:24-26`. | API-08 |
| R-12 | P2 | School Years "Activate" only flips `status`; it does not update `SystemSettings.schoolYearId/currentSchoolYear`. The real active year used everywhere remains unchanged, and multiple years can be ACTIVE. | `admin-sub/classAssignments.ts:517-580`; active-year resolver `schoolYearResolver.ts:30-70`. | ADM-SY-03 |
| R-13 | P1 | EOSY finalize/unfinalize do not check whether the school year is archived. UI `eosyDone` also ignores snapshot gaps, and the EOSY learner grade expansion fetches the active year, not the selected EOSY year. | `registrar/eosy.ts:167-307`; `EOSYFinalization.tsx` learner expansion; `eosyStatus.ts:60-100`. | REG-EOSY-02, REG-EOSY-07 |
| R-14 | P2 | Term unfinalize blocks ARCHIVED but not COMPLETED sections, while finalize blocks both. A completed section can be reopened through one path. | `termFinalization.ts:551` vs `:641`. | REG-TERM-08 |
| R-15 | P2 | UI says User Management and Class Assignments are read-only, but backend CRUD exists. Decide whether direct API mutation is supported; otherwise it is a security/consistency gap. | `UserManagement.tsx` notice; `admin-sub/users.ts`; `classAssignments.ts:308-455`. | ADM-USR-09, ADM-ASG-07 |
| R-16 | P2 | Grading Config hides MATH_SCIENCE when CORE exists and TLE when MAPEH exists, so not all four subject-type configs are editable from the UI. | `GradingConfig.tsx:396-398`; backend supports four. | ADM-GRD-08 |
| R-17 | P2 | Transmutation table can be replaced through the API while grading mode is ZERO_BASED (UI disables it). Every save also marks all rows `isDefault: true`, losing source distinction. | `admin-sub/grading.ts:443-487`; no mode guard; `isDefault: true` at `:457-467`. | ADM-TRN-06 |
| R-18 | P2 | Sync buttons report success when work is merely queued. Only Student Records and Transferees subscribe to SSE; other pages can show stale data after "successful" sync. | `registrar/main.ts:560-575`; `admin-sub/system.ts:79-87`; page-specific SSE usage. | RES-04, REG-DASH-02 |
| R-19 | P2 | Destructive maintenance is reachable by any admin without environment gating: `/api/admin/prune`, `dev/seed-scores`, `dev/seed-attendance`. Prune also runs after every sync cycle. | `admin-sub/system.ts:100,552,667`; `syncCoordinator.ts:322`. | ADM-SET-07, ADM-HLT-04 |
| R-20 | P2 | SF1/SF2 downloads do not check `res.ok`, so an auth/error JSON body can be saved as `.xlsx`. Bulk print is all-or-nothing; SF5 export exists in the API but is not wired in the UI. | `SchoolForms.tsx:668-683,726-740,413-435`; `api.ts:1752`. | REG-FORM-09, REG-FORM-10 |
| R-21 | P3 | Attendance "Save & next day" advances even if the save failed; reset shows success after a failed delete; changing date silently discards unsaved marks. | `Attendance.tsx` save/reset handlers. | TCH-ATT-05 |
| R-22 | P3 | Settings "Discard" can claim success without reloading; manual EnrollPro sync can overwrite unsaved edits; SSE reconnect churn due to unstable `refreshTheme` dependency. | `SystemSettings.tsx`; `ThemeContext.tsx`. | ADM-SET-06 |
| R-23 | P2 | EOSY status board shows "ready for archive" based on EOSY finalization + snapshot gaps but does not include pending remedial rows, while the archive core does. | `RolloverReadinessCard.tsx`; `rollover.ts:183-198`. | LC-06, REG-DASH-03 |
| R-24 | P2 | Admin sign-out is client-only: it does not call `/auth/logout`, revoke refresh tokens, or create a logout audit row. | `AdminLayout.tsx:127-134`. | AUTH-09 |

---

## 4. QA strategy

### 4.1 Layers

| Layer | What | Execution |
|---|---|---|
| L0 | Typecheck, lint, build, server tests, PWA checks | `pnpm run verify` |
| L1 | API authorization/validation matrix (auth x role x endpoint) | Automated script/spec against QA backend |
| L2 | Route render sweep for every role/page + console/API-error capture | Extend `e2e/portals.spec.ts` |
| L3 | Write-flow functional testing with DB assertions | Manual + targeted Playwright |
| L4 | Lifecycle chains across years | Manual on isolated QA school years |
| L5 | Resilience: integration outage, queued sync, SSE, PWA offline, concurrency | Manual + offline rig |
| L6 | UX, responsive, print, a11y, dark/light, text scale | Manual matrix |

### 4.2 Operating rules

- One risk/question per run; reset fixtures before each destructive scenario.
- Capture console, network status, request/response body, DB before/after, audit log row.
- Never test writes in the live/current school year.
- Never write to EnrollPro/ATLAS/AIMS; use stubs/outage modes.
- Any P0 failure blocks the rest of that phase and requires a triage decision.

---

## 5. Test environment and fixtures

### 5.1 Accounts

| Account | Role | Purpose |
|---|---|---|
| QA-ADMIN-1 | ADMIN | Primary admin; owns settings/locks/approvals |
| QA-ADMIN-2 | ADMIN | Two-admin race tests (approve/reject, archive/sync) |
| QA-REG-1 | REGISTRAR | Finalization, remedial, forms, records |
| QA-TCH-1 | TEACHER | Adviser + classes, full grade entry |
| QA-TCH-2 | TEACHER | No advisory; other section; cross-teacher authorization |
| QA-TCH-3 | TEACHER | Same section as TCH-1 for inherited-grade scenarios (optional) |
| QA-SUSPENDED | Any | Suspended/deactivated login and token rejection |

### 5.2 School years

| Year | Status | Contents |
|---|---|---|
| QA-A | ACTIVE | Current-year sections/assignments/grades in every state |
| QA-B | ARCHIVED | Prior year with finalized grades, EOSY snapshots, teacher archives, SF10 history |
| QA-C | DRAFT | Empty year for create/activate/rollover tests |
| QA-D | ACTIVE after switch | Used only for rollover drills; reset afterwards |

### 5.3 Fixture matrix (minimum)

- Sections: with adviser (TCH-1), without adviser, empty, complete, archived, EOSY-finalized, partial EOSY.
- Class assignments: active, archived `ATLAS_REASSIGNED` with successor, predecessor with grades for inheritance, HG subject, rotation subject with T1/T2/T3 siblings, subject with weight override.
- Grades: none, partial terms, all terms, finalized, locked term, locked year, archived; scores including A/E special marks and missing HPS.
- Edit requests: pending, approved current term, approved prior year (R-04), expired, rejected.
- Enrollments: enrolled, transferee, former student, dropped, transferred, CP with PENDING remedial, CP with conducted remedial, retained, JHS completer.
- Remedial: untouched PENDING (rollover blocker), PENDING with marks/dates, COMPLETED passed, COMPLETED failed, orphan PENDING on non-CP.
- Forms: at least one active template per SF1/SF2/SF5/SF6/SF8/SF9/SF10.
- Integration modes: all online, EnrollPro down, ATLAS down, AIMS down, partial sync, circuit breaker open.

### 5.4 Reset

- Snapshot QA database before any write phase.
- Reset script restores only QA-A/QA-B/QA-C/QA-D and reseeds fixtures.
- Document the exact reset command here before execution starts: `TBD`.

---

## 6. Test cases

Status values: `Not run`, `Pass`, `Fail`, `Blocked`, `N/A`.

### 6.1 AUTH / session / SSO

| ID | Case | Pri |
|---|---|---|
| AUTH-01 | Teacher, admin, registrar each log in on their own portal and land on the correct home | P0 |
| AUTH-02 | Wrong portal (e.g. teacher credentials on `/login/admin`) returns `WRONG_PORTAL` and no session | P0 |
| AUTH-03 | Suspended/deactivated user cannot log in; existing access token is rejected on next request | P0 |
| AUTH-04 | Invalid password returns generic error; failed attempts hit the configured lockout and recover | P0 |
| AUTH-05 | Transition lock blocks TEACHER login only; already-issued teacher token behavior is explicitly verified | P0 |
| AUTH-06 | Refresh rotates; reuse of an old/revoked refresh token fails | P0 |
| AUTH-07 | Logout revokes refresh tokens and creates a logout audit row (check all three layouts, including R-24) | P1 |
| AUTH-08 | Portal session keys are isolated; logging out of one portal does not destroy the others | P1 |
| AUTH-09 | EnrollPro SSO callback/session lands in the correct portal; replay and expired code fail | P1 |
| AUTH-10 | AIMS SSO launch/exchange works only for allowed roles; registrar is refused | P1 |
| AUTH-11 | ATLAS authorize/session works only for linked active admin; inactive/mismatched year denied | P1 |
| AUTH-12 | Access token in `?token=` works for SSE; determine whether it works for other endpoints and decide policy (R-11) | P2 |

### 6.2 API / authorization / validation

| ID | Case | Pri |
|---|---|---|
| API-01 | Every protected endpoint returns 401 without a token | P0 |
| API-02 | Every role-scoped endpoint returns 403 for each wrong role (admin/teacher/registrar) | P0 |
| API-03 | Teacher cannot read another teacher's class record, grades, AIMS data, or ECR export | P0 |
| API-04 | Teacher cannot write attendance for a section they do not advise or teach (R-02) | P0 |
| API-05 | Registrar endpoints reject teacher/admin callers except documented SF1 read/export | P0 |
| API-06 | Auth-only endpoints (settings stream, enrollpro sections, teacher transmutation) are reviewed and least-privileged (R-09) | P2 |
| API-07 | CSRF: missing/invalid token fails on non-exempt mutations; settings endpoints verified per R-10 | P0 |
| API-08 | API-key service endpoints fail closed when the key is unconfigured or wrong | P0 |
| API-09 | Malformed, extra, and oversized bodies return 400 without stack traces | P0 |
| API-10 | Rate limits trigger and recover for login and sync | P1 |
| API-11 | Grade save/batch rejects a student not enrolled in the section (R-05) | P1 |
| API-12 | Pagination/list endpoints honor limits and do not leak cross-scope rows | P1 |

### 6.3 TEACHER

| ID | Case | Pri |
|---|---|---|
| TCH-DASH-01 | Dashboard loads assignments, stats, schedule, honors; no console/API errors | P1 |
| TCH-DASH-02 | Honors card only appears when grading is complete; term selector changes data | P1 |
| TCH-DASH-03 | Teacher without advisory sees no advisory-only actions and no attendance nav | P1 |
| TCH-SCHED-01 | Schedule renders per term; refresh, historical/conflict/snapshot-gap notices behave | P1 |
| TCH-CRL-01 | List shows only own assignments; term filter and archived section work | P0 |
| TCH-CRL-02 | Search/filter/pagination boundaries and empty-state recovery | P1 |
| TCH-CRL-03 | Delete archived record and delete-all require confirmation; only archived rows removed | P1 |
| TCH-CRV-01 | Ledger loads correct learners/subjects/terms; desktop and mobile | P0 |
| TCH-CRV-02 | WW/PT/TA entry computes PS, initial grade, transmuted/zero-based grade correctly | P0 |
| TCH-CRV-03 | A/E marks, empty-as-zero, invalid/over-max/negative input behavior | P0 |
| TCH-CRV-04 | Save persists; queued writes retry and do not duplicate; reload matches | P0 |
| TCH-CRV-05 | Clear scores confirmation, scope, and post-clear state | P1 |
| TCH-CRV-06 | ECR download/import dry-run/confirm; unmatched and overwritten counts | P1 |
| TCH-CRV-07 | Term lock blocks edit; approved current-term request opens it; year/system lock never opens (R-04) | P0 |
| TCH-CRV-08 | Archived/reassigned class is read-only; inherited grades display correctly | P0 |
| TCH-CRV-09 | Future-term editing is blocked without approval; verify server rule | P1 |
| TCH-CRV-10 | AIMS link/import/sync/offline states; import is idempotent | P1 |
| TCH-CRV-11 | Approved edit request from a prior year does NOT unlock a past term (R-04) | P0 |
| TCH-CRV-12 | Grade cannot be saved for a student outside the section (R-05) | P1 |
| TCH-ATT-01 | Non-advisory teacher is blocked from attendance routes | P0 |
| TCH-ATT-02 | Mark P/A/L/E, remarks, mark-all, save; reload persists | P0 |
| TCH-ATT-03 | Date change, future date, weekend, and empty roster behavior | P1 |
| TCH-ATT-04 | Save-and-next advances only after success; reset reports failure truthfully (R-21) | P1 |
| TCH-ATT-05 | Attendance reports/SF2 month/year totals and Excel export | P1 |
| TCH-ATT-06 | Teacher cannot read/save another section via API (R-02) | P0 |
| TCH-ADV-01 | Advisory directory, search, gender toggle, student profile link | P1 |
| TCH-ADV-02 | Printables: SF9 vs term card, term pills, select all/search interaction | P1 |
| TCH-ADV-03 | Observed values: save, clear/remove rating, locked/archived read-only | P1 |
| TCH-SGP-01 | Student profile shows all terms, GWA, remarks, promotion status | P0 |
| TCH-SGP-02 | SF9 and term-card print output matches screen data | P1 |
| TCH-ARCH-01 | My Archives lists only own COMPLETE archives; other teacher denied | P1 |
| TCH-ARCH-02 | Archive detail downloads Excel/year backup; zero-term rows disabled | P2 |

### 6.4 REGISTRAR

| ID | Case | Pri |
|---|---|---|
| REG-DASH-01 | Dashboard counts, trends, completeness match fixtures | P1 |
| REG-DASH-02 | Sync status/freshness; queued sync semantics; readiness card does not promise archive when remedial is pending (R-23) | P1 |
| REG-STU-01 | Student list filters/search/pagination; Export button behavior (currently inert) | P1 |
| REG-STU-02 | Records Vault tabs: overview, SF10, SF9 years, prior records, remedial | P1 |
| REG-STU-03 | Archived-year students remain visible after rollover (schoolYear-only filter) | P0 |
| REG-ROSTER-01 | Sections/rosters for active year; EnrollPro-mapping failure is explained | P1 |
| REG-ROSTER-02 | Roster search/pagination; sync refresh; no duplicate learners | P1 |
| REG-TERM-01 | Overview statuses per section/subject; filters/search/bulk scope | P0 |
| REG-TERM-02 | Finalize section/subject: DRAFT -> FINALIZED; counts and reload | P0 |
| REG-TERM-03 | Unfinalize: FINALIZED -> DRAFT; audit row | P0 |
| REG-TERM-04 | Fully EOSY-finalized section blocks finalize and unfinalize | P0 |
| REG-TERM-05 | Archived year and COMPLETED section behavior (R-14) | P1 |
| REG-TERM-06 | Bulk "Finalize all"/"Unfinalize all" apply only to filtered sections | P1 |
| REG-TERM-07 | Legacy `/finalize-grades` and `/unfinalize-grades` honor EOSY/archived guards or are removed (R-03) | P0 |
| REG-TERM-08 | Partial EOSY + draft blockers produce the documented warnings/blocks | P1 |
| REG-EOSY-01 | Status board sections/state/filters/pagination match fixtures | P0 |
| REG-EOSY-02 | Finalize blocked by DRAFT grades; succeeds when none; idempotent | P0 |
| REG-EOSY-03 | Unfinalize blocked when completed remedial exists; otherwise restores DRAFT state | P0 |
| REG-EOSY-04 | Unfinalize-all targets only the selected SY and reports blocked sections | P1 |
| REG-EOSY-05 | Archived-year finalize/unfinalize is rejected (R-13) | P1 |
| REG-EOSY-06 | Year backup workbook contains sections, enrollments, grades, attendance | P1 |
| REG-EOSY-07 | Learner Records expansion shows grades for the selected SY, not the active SY (R-13) | P1 |
| REG-REM-01 | Pending/history tabs, SY filter, search, pagination; >100-row cap behavior | P1 |
| REG-REM-02 | RCM validation 60-100, RFG computation, required conducted dates | P0 |
| REG-REM-03 | Complete remedial: all pass -> PROMOTED; fail -> CP or RETAINED override | P0 |
| REG-REM-04 | PENDING remedial on CP blocks rollover; completed rows release it (R-23) | P0 |
| REG-REM-05 | Sync from EnrollPro is idempotent; no duplicate rows | P1 |
| REG-TRF-01 | Transferee list filters/all-years/missing-docs/sync | P1 |
| REG-TRF-02 | Complete-details validation and persistence; empty values do not clear fields | P1 |
| REG-SF10-01 | Prior records list/add/edit/delete/lock; duplicate key 409 | P1 |
| REG-SF10-02 | Scan and Excel import: single draft review, multi-draft auto-save, invalid drafts skipped | P1 |
| REG-SF10-03 | Back subjects display only; SF10 print includes prior records | P1 |
| REG-ALUM-01 | Former-student tabs/counts/search/sync; vault opens correctly | P1 |
| REG-FORM-01 | SF1 preview/print/download for a section; historical year works | P0 |
| REG-FORM-02 | SF2 month/year grid, totals, print orientation, Excel export | P0 |
| REG-FORM-03 | SF5 promotion/descriptor/incomplete columns; print; missing export wiring | P0 |
| REG-FORM-04 | SF6 template render/fallback/print | P1 |
| REG-FORM-05 | SF9 single/bulk print; values match term grades and observed values | P0 |
| REG-FORM-06 | SF10 single/bulk print; prior years and remedial block | P0 |
| REG-FORM-07 | Failed preview/print/download surfaces an error; downloads do not save JSON as xlsx (R-20) | P1 |
| REG-FORM-08 | Bulk print all vs selected vs search-filtered semantics | P1 |

### 6.5 ADMIN

| ID | Case | Pri |
|---|---|---|
| ADM-DASH-01 | Dashboard counts/system status match source; poll failure does not wipe stale data | P1 |
| ADM-ASG-01 | Assignments/workload/archived tabs and SY filter | P1 |
| ADM-ASG-02 | Direct API create/delete/restore honors read-only UI intent or is blocked (R-15) | P2 |
| ADM-ER-01 | Pending/approved/rejected/expired filters; search; max-50 limit | P1 |
| ADM-ER-02 | Approve for N hours; teacher can edit current term only | P0 |
| ADM-ER-03 | Reject with reason; audit stores reason; teacher still blocked | P0 |
| ADM-ER-04 | Revoke marks EXPIRED; teacher loses access immediately | P1 |
| ADM-ER-05 | Two admins approve/reject same request: second action fails safely | P1 |
| ADM-USR-01 | User list role/status/search; EnrollPro profile match | P1 |
| ADM-USR-02 | Direct API create/update/delete/suspend/reactivate behavior and guards (R-15) | P2 |
| ADM-GRD-01 | Weight config loads all four subject types; UI visibility gap (R-16) | P1 |
| ADM-GRD-02 | Save enforces sum 100; reset restores defaults; audit | P0 |
| ADM-GRD-03 | Weight change updates current grades as intended; verify archived/finalized grades (R-01) | P0 |
| ADM-GRD-04 | Subject override accepts only valid totals/ranges (R-07) | P1 |
| ADM-GRD-05 | Subject override change/recompute behavior for current vs historical years (R-01) | P0 |
| ADM-TRN-01 | Table validates contiguous 0-100 ranges, no gaps/overlaps | P0 |
| ADM-TRN-02 | Save/replace realigns grades; check effect on archived years (R-01) | P0 |
| ADM-TRN-03 | Row add/update/delete and reset behavior; neighbor deletion edge | P1 |
| ADM-TRN-04 | Mode switch blocked by finalized grades/EOSY/archived; recompute scope | P0 |
| ADM-TRN-05 | API replace in ZERO_BASED is blocked or documented (R-17) | P2 |
| ADM-SY-01 | Create/activate/complete/archive/delete; activation actually changes active year (R-12) | P0 |
| ADM-SY-02 | Archive blocked by unfinalized sections, snapshot gaps, pending remedial | P0 |
| ADM-SY-03 | Concurrent archive requests: one succeeds, other idempotent | P0 |
| ADM-SET-01 | School identity/branding save, theme refresh, SSE update | P1 |
| ADM-SET-02 | Term dates/labels, demo mode, retention settings | P1 |
| ADM-SET-03 | Year/term lock actions take effect immediately and audit | P0 |
| ADM-SET-04 | Transition lock blocks teacher login; existing token behavior verified | P0 |
| ADM-SET-05 | EnrollPro credential save masks secrets on read; no secret in responses/SSE | P0 |
| ADM-SET-06 | Discard/sync/SSE unsaved-edit behavior (R-22) | P3 |
| ADM-SET-07 | Dev seed tools and prune are gated or clearly marked destructive (R-19) | P1 |
| ADM-HLT-01 | Health/sync history/circuit breaker reflect backend | P1 |
| ADM-HLT-02 | Run Sync Now reports queued/completed truthfully (R-18) | P2 |
| ADM-LOG-01 | Filters/pagination/detail; 100-row cap and export 1,000-row cap | P1 |
| ADM-LOG-02 | Mutations across the plan produce audit rows; note missing audits (class assignments, subject weights, single transmutation rows, sync run) | P1 |
| ADM-TA-01 | Archived-year coverage, detail, downloads, backfill | P1 |
| ADM-TA-02 | Failed archive reason visible; >100 archives reachable | P2 |

### 6.6 Lifecycle chains

| ID | Chain | Pri |
|---|---|---|
| LC-01 | Grade math across CORE/MAPEH/TLE, override weights, raw vs transmuted vs zero-based | P0 |
| LC-02 | Lock precedence: archived > year > term (approved request bypasses term only) > legacy system lock | P0 |
| LC-03 | Edit request current-year approval opens the term; prior-year approval does not (R-04) | P0 |
| LC-04 | Finalize term -> EnrollPro pull returns only FINALIZED; legacy endpoint cannot reopen after EOSY (R-03) | P0 |
| LC-05 | EOSY guard: fully EOSY-finalized blocks term finalize/unfinalize | P0 |
| LC-06 | Remedial: CP + pending blocks rollover; completion updates promotion; re-EOSY clears orphan rows | P0 |
| LC-07 | Rollover A -> B: archive writes, year lock, audit, archives queued; B usable | P0 |
| LC-08 | Historical freeze: archived grade values do not change after current-year config edits (R-01) | P0 |
| LC-09 | Historical visibility: SF1/SF5/SF9/SF10 and registrar year views survive archiving (schoolYear-only) | P0 |
| LC-10 | Teacher archive bundles contain the expected year data and download after rollover | P1 |

### 6.7 Resilience

| ID | Case | Pri |
|---|---|---|
| RES-01 | EnrollPro down: reads fall back to DB, banners show, writes still work locally | P1 |
| RES-02 | ATLAS down: no destructive stale-check, no wiped assignments; circuit breaker opens/recovers | P0 |
| RES-03 | AIMS down: link/import disabled with clear message; grades unaffected | P1 |
| RES-04 | Queued sync: UI does not claim completion early; SSE refresh reaches subscribed pages | P2 |
| RES-05 | SSE reconnect resumes updates; expired token does not loop forever | P2 |
| RES-06 | Concurrent archive, finalize, and grade-save operations serialize safely | P0 |
| RES-07 | Double-submit on save/finalize/approve does not duplicate or corrupt | P1 |
| RES-08 | PWA offline: shell loads, cached read-only data available, writes blocked clearly | P2 |

### 6.8 UX / print / accessibility

| ID | Case | Pri |
|---|---|---|
| UX-01 | DataTable filter/search after being on page N does not show an empty page (R-06) | P1 |
| UX-02 | 375/768/1280 widths: no horizontal overflow, no clipped actions | P1 |
| UX-03 | Dark/light and max text scale: no truncation/overlap | P2 |
| UX-04 | Keyboard-only operation of dialogs, menus, ledger, and pagination | P2 |
| UX-05 | Form errors are announced and associated with fields | P2 |
| UX-06 | No raw stack traces/tokens/internal IDs in UI errors | P1 |
| UX-07 | Print SF1/SF2/SF5/SF6/SF9/SF10/ECR: page breaks, headers, totals, signatures | P1 |
| UX-08 | Notification bell counts/dismissals and offline flags behave | P3 |

---

## 7. Scripted critical journeys

### J1. School year setup and activation
1. As ADMIN, create QA-C with a valid label.
2. Activate it. Confirm whether the active-year badge, term labels, and teacher pages switch (R-12). Record expected behavior.
3. Attempt to archive the active year; expect 400.
4. Try a second ACTIVE year; expect a guard or documented behavior.

### J2. Grade -> lock -> edit request -> approval -> audit
1. TCH-1 enters complete T1 scores; verify calculated grades.
2. Admin locks the T1 term.
3. TCH-1 saves; expect TERM_LOCKED.
4. TCH-1 requests edit access; ADMIN approves 4 hours.
5. TCH-1 edits T1; verify save succeeds and audit rows exist.
6. Expire/revoke; edit fails again.
7. Repeat with a prior-year approval to confirm R-04 is not exploitable.

### J3. Attendance and SF2
1. TCH-1 marks attendance for the advisory section and saves.
2. Verify reload and monthly summary.
3. Attempt to write attendance for a different section via API (R-02); expect 403.
4. Open Attendance Reports and compare SF2 totals; export Excel and inspect.

### J4. Term finalization and EOSY guard
1. Finalize one subject; verify only that subject's DRAFT grades change.
2. Finalize the rest; verify counts and audit.
3. Run EOSY finalize; then attempt term unfinalize; expect EOSY_FINALIZED.
4. Unfinalize EOSY; then unfinalize the term.
5. Call the legacy unfinalize endpoint after a fresh EOSY finalize (R-03); verify it is blocked or file a bug.

### J5. Remedial chain
1. Create a CP learner with failing subjects in QA-A; EOSY finalize creates PENDING rows.
2. Attempt rollover; expect a pending-remedial block.
3. Enter RCM and conducted dates; complete remedial.
4. Verify promotion status changes per outcome; re-run EOSY.
5. Rollover again; expect success when no pending rows remain.

### J6. Rollover and historical freeze
1. Record checksums/values of QA-B grades, SF5, SF10, and teacher archives.
2. In QA-A, change grading weights, then the transmutation table, then a subject override.
3. Recheck QA-B values (R-01). If they changed, determine whether that is intended; if not, file P0.
4. Archive QA-A only when EOSY is finalized, no snapshot gaps, no pending remedial.
5. Verify year lock, archived flags, teacher archive generation, and that all historical pages still load.

### J7. EnrollPro pull contract
1. Finalize a term for a section.
2. Call `POST /api/integration/smart/sections/:id/sync-grades` with the service key.
3. Verify only FINALIZED grades appear, promotion status and GAs are correct, and DRAFT grades are excluded.
4. Replay with a missing/wrong API key; expect 401.

### J8. Forms across years
1. Generate SF1/SF2/SF5 for an active-year section.
2. Generate SF9/SF10 for a learner with current and prior-year grades.
3. Switch to the archived year and repeat.
4. Print each form; verify learned data, descriptors, attendance, promotion, remedial, and signatures.
5. Force a form API failure; ensure the UI shows an error, not a blank form or JSON download.

### J9. Sync outage
1. Put EnrollPro and ATLAS into outage mode via the offline rig.
2. Load dashboards across roles; verify banners, DB fallback, and no 5xx loops.
3. Trigger sync; verify circuit breaker opens and later recovers.
4. Verify ATLAS stale-check does NOT archive assignments when EP sections are unavailable.

### J10. Settings and destructive tools
1. Save school identity/colors; verify theme and SSE propagation.
2. Test Discard with unsaved edits and with a failed reload (R-22).
3. Save EnrollPro credentials; verify masked read and no secret in SSE.
4. Review visibility of Developer Tools/Attendance Tools; run only in QA, then reset.
5. Verify audit rows for each mutation.

---

## 8. Defense sprint (finish Tue Nov 17; Wed Nov 18 buffer)

The full plan above is the post-defense reference. With defense on **Thursday Nov 19** and a Tuesday finish, the rule is simple: test only what will be shown, protect the demo data, and freeze early. Wednesday is a spare day, not a work day.

### 8.1 Defense-critical scope (must pass)

| ID | Case | Maps to |
|---|---|---|
| DEF-01 | Login for teacher, admin, registrar; correct landing pages | AUTH-01 |
| DEF-02 | Wrong-portal and suspended-user refusal; clean logout/relogin | AUTH-02, AUTH-03, AUTH-07 |
| DEF-03 | Every role route loads with zero console/API errors | L2 sweep |
| DEF-04 | Teacher dashboard and schedule render with demo data | TCH-DASH-01, TCH-SCHED-01 |
| DEF-05 | Class record loads the demo class and term | TCH-CRV-01 |
| DEF-06 | Enter scores, save, reload; computed grade matches expected | TCH-CRV-02, TCH-CRV-04 |
| DEF-07 | Term lock blocks save; approve edit request; edit succeeds; lock again | TCH-CRV-07, ADM-ER-02 |
| DEF-08 | Attendance save/reload for the advisory section | TCH-ATT-02 |
| DEF-09 | Attendance report/SF2 totals (if demoed) | TCH-ATT-05 |
| DEF-10 | Advisory SF9/term-card preview and print | TCH-ADV-02, TCH-SGP-02 |
| DEF-11 | Registrar dashboard, student records, records vault | REG-DASH-01, REG-STU-01/02 |
| DEF-12 | Term finalization finalize/unfinalize on a demo section | REG-TERM-02/03 |
| DEF-13 | EOSY status board and draft-blocker guard | REG-EOSY-01/02 |
| DEF-14 | Remedial pending view (and completion if demoed) | REG-REM-01/03 |
| DEF-15 | School Forms preview/print: SF1, SF5, SF9, SF10 (SF2 if demoed) | REG-FORM-01/03/05/06 |
| DEF-16 | Admin dashboard, edit requests, locks, audit logs | ADM-DASH-01, ADM-ER-*, ADM-LOG-01 |
| DEF-17 | Class assignments/teaching load view | ADM-ASG-01 |
| DEF-18 | Two full timed demo rehearsals with a data reset between | J2, J5, J8 |
| DEF-19 | Final build, DB backup, screenshots/recording, printed forms pack | - |
| DEF-20 | 30-minute smoke on the demo machine before defense | - |

### 8.2 Day-by-day (finish Tuesday)

**Sun Nov 15 (today) - Make it safe to test**
1. Copy/back up the database and prepare known-good demo accounts and demo data.
2. Run `pnpm run verify` and open every page for all three roles.
3. Write down anything broken. Fix only login, blank-page, or 5xx problems.
4. Save the reset steps so the demo can be restored in minutes.
Exit: the app builds, every page opens, and we have a restore point.

**Mon Nov 16 - Test the actual demo path**
1. Teacher: load the class record, enter scores, save, reload; take attendance; save; reload.
2. Admin: approve an edit request; apply a term lock; check the audit log.
3. Registrar: finalize a term; check the EOSY blocker; open remedial; open student records.
4. Fix only what blocks this path. Everything else goes on the after-defense list.
Exit: one complete practice run: grade -> lock -> approval -> finalize -> EOSY -> forms.

**Tue Nov 17 - Prove it twice and freeze**
1. Morning: print/preview SF1, SF5, SF9, SF10 and check the values.
2. Reset the demo data.
3. Practice the full defense demo twice, timed, exactly as it will be presented.
4. Fix only problems that would make the demo fail.
5. End of day: freeze the code, take a final DB backup, print the forms, and record a fallback video/screenshots.
Exit: two clean practice runs and a frozen build. After tonight, no more code changes.

**Wed Nov 18 - Buffer day (no changes)**
1. Only run a short smoke test and confirm the backup/video/prints exist.
2. Do not edit code, settings, or demo data. This day is for rest and safety.

**Thu Nov 19 - Defense day**
1. Run a 30-minute smoke test on the actual demo machine.
2. Use the practiced path exactly. No new features, settings, or data.

### 8.3 Demo safety rules

- Do **not** edit Grading Config, Transmutation Table, or subject weights during the demo. R-01 can rewrite stored historical grades.
- Do **not** use School Years "Activate" to switch the active year. R-12 does not update the resolver; use the pre-linked active year.
- Do **not** call legacy `/registrar/finalize-grades` or `/unfinalize-grades`. R-03 bypasses EOSY guards.
- Do **not** demo attendance for a section other than the adviser's; R-02 permits it via API but it is not an intended workflow.
- Do **not** use prune, wipe, dev seed, or archive tools live.
- Pre-check EnrollPro/ATLAS/AIMS availability; know the DB-fallback behavior if they are down.
- Reset demo data after every rehearsal; keep a database backup and a recorded fallback demo.
- Clear browser storage and use the rehearsed accounts for a clean login.

### 8.4 Stop-the-line (fix immediately)

- Cannot log in, or wrong portal admits a user.
- Any demo route crashes or returns 5xx.
- Grade save fails or arithmetic is wrong.
- Attendance save fails.
- Term finalize/unfinalize or EOSY finalize crashes.
- SF1/SF5/SF9/SF10 print is broken or shows wrong values.
- Edit-request approve/reject fails.

### 8.5 Deferred until after defense

Full API authorization matrix, CSRF/rate-limit deep dive, R-01 historical mutation drill, concurrency, outage/offline rig, PWA, accessibility, archives, SF6/SF8, bulk print edge cases, audit completeness, pagination bug (R-06), User Management/Class Assignments API mutation checks.

### 8.6 Full plan (post-defense reference)

| Phase | Work | Estimate | Exit |
|---|---|---|---|
| P0 Prep | QA DB snapshot, fixtures, accounts, reset script, bug tracker | 0.5d | Reset reproducible |
| P1 Static + API | `pnpm run verify`; endpoint auth/validation matrix; CSRF/rate/service auth | 1.5d | API-01..12 pass or triaged |
| P2 Route sweep | Extend read-only route sweep to every role/page; catch console/API errors | 0.5d | 100% routes clean |
| P3 Write flows | Teacher grade/attendance/ECR/AIMS; admin requests/locks/settings; registrar finalize/remedial/records/forms | 2d | P0 write cases pass |
| P4 Lifecycle | J2-J8; R-01 historical freeze; rollover/remedial/EOSY | 1.5d | LC-01..09 pass |
| P5 Resilience | J9; outage rig; concurrency; PWA | 0.5d | RES-01..08 pass |
| P6 UX/print | Viewports, dark/light, text scale, keyboard, all prints | 0.5d | UX-01..07 pass |
| P7 Regression | Rerun all P0, triage, sign-off report | 0.5d | No open S1/S2 |

Total: roughly 7 tester-days, excluding fixes. Use this only after Nov 19.

---

## 9. Severity, priority, and bug reporting

| Severity | Definition |
|---|---|
| S1 Critical | Data loss/corruption, security bypass, wrong grades, blocked school operation |
| S2 High | Primary workflow broken, no workaround |
| S3 Medium | Workaround exists, degraded UX |
| S4 Low | Cosmetic |

Priority: P0 release blocker, P1 must fix before sign-off, P2 should fix, P3 polish.

Bug template:

```md
### BUG-<n>: <title>
- Severity / Priority:
- Role / Page / Endpoint:
- Case ID:
- Environment: QA-A, browser, commit:
- Preconditions:
- Steps:
- Expected:
- Actual:
- Evidence: screenshot, network response, DB before/after, audit row
- Data impact:
- Workaround:
```

---

## 10. Open decisions (resolve before execution)

1. Is retroactive recomputation of archived/finalized grades intended when weights/transmutation change (R-01)? If yes, document; if no, fix before QA.
2. Should teachers be restricted to their own advisory/sections for attendance, or is any-section access by design (R-02)?
3. Should legacy `/finalize-grades` and `/unfinalize-grades` be removed, or brought under the new guards (R-03)?
4. Are User Management and Class Assignments intentionally read-only in UI while APIs mutate (R-15)?
5. Should School Years "Activate" change the active school year (R-12), or is activation owned by EnrollPro sync only?
6. Should EOSY finalization require no drafts only, or also all terms finalized/locked? Should archived years be blocked (R-13)?
7. Is the CSRF exemption for `/admin/settings` acceptable (R-10)?
8. Should `?token=` be accepted outside SSE (R-11)?
9. Which destructive tools (prune, dev seeds, wipe) are allowed in QA, and who authorizes them?
10. Which browsers/viewports are in scope for sign-off?

---

## 11. Sign-off checklist

**Defense sprint (finish Tue Nov 17; freeze):**
- [ ] DEF-01..DEF-17 pass
- [ ] Two clean timed rehearsals (DEF-18)
- [ ] Frozen build + DB backup + printed forms pack (DEF-19)
- [ ] Wednesday buffer smoke passed (no changes)
- [ ] Demo-machine smoke passed (DEF-20)
- [ ] Demo safety rules reviewed with the presenter

**Post-defense full QA:**
- [ ] QA fixtures and reset script verified
- [ ] `pnpm run verify` green
- [ ] Endpoint authorization matrix 100% pass (API-01..05)
- [ ] Route sweep clean for all roles
- [ ] All P0 cases pass
- [ ] R-01 historical freeze decision resolved and verified
- [ ] R-02 attendance authorization resolved and verified
- [ ] R-03 legacy finalization resolved and verified
- [ ] Lifecycle chains LC-01..LC-09 pass
- [ ] Rollover/remedial/EOSY guards verified
- [ ] Print outputs reviewed for all required forms
- [ ] Zero open S1/S2 bugs
- [ ] Final report and bug log published
