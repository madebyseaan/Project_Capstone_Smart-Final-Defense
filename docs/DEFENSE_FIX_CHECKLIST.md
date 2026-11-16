# Defense Fix Checklist

Pre-defense QA findings from Playwright end-to-end testing (Teacher, Registrar, Admin).
Target: fix one by one, verify after each, leave demo data unchanged unless explicitly decided.

## Code Fixes

- [x] **1. Registrar → Student Records → Export button is dead**
  - File: `src/pages/registrar/StudentRecords.tsx`
  - Behavior now: button shows a CSV/Excel tooltip but has no `onClick`.
  - Fix: export the currently filtered student list as CSV (LRN, Name, Gender, Grade Level, Section, Status).
  - Verify: click Export, file downloads, rows match filters/search.

- [x] **2. Teacher → Class Record → Import filled Excel opens two file pickers**
  - File: `src/pages/teacher/components/ExcelExchangePanel.tsx`
  - Cause: `autoStartImport` effect fires twice under React StrictMode in dev.
  - Fix: one-shot ref guard so the OS picker opens exactly once per mount.
  - Verify: click Import filled Excel once → exactly one file chooser.

- [x] **3. Teacher dashboard count text is misleading**
  - Files: `src/pages/teacher/Dashboard.tsx`, `server/src/routes/grades-sub/dashboard.ts`, `src/lib/api.ts`
  - Behavior now: "13 Enrolled Learners across 4 Sections" — 13 includes advisory learners, 4 excludes advisory.
  - Fix: add `stats.totalSections` (sections with enrollments, including advisory) in the server response; use it in the hero text.
  - Verify: text matches actual sections (should read 5 for the demo teacher).

- [x] **4. EOSY drawer progress denominator includes subjects with no grades**
  - File: `src/pages/registrar/components/EOSYOverviewTab.tsx`
  - Behavior now: "0/11 subjects finalized" while only 9 subjects have grades; progress can never reach 100%.
  - Fix: denominator = subjects with `totalGrades > 0`; keep draft count separate.
  - Verify: drawer shows consistent numbers (draft count and finalized progress).

- [x] **5. System Health shows "Resolved ATLAS Year 5" (raw id)**
  - Files: `server/src/lib/atlasSync.ts`, `server/src/lib/systemHealth.ts`, `src/lib/api.ts`, `src/pages/admin/SystemHealth.tsx`
  - Behavior now: displays numeric `atlasSchoolYearId` (e.g. 5) instead of the school year label.
  - Fix: track and expose `atlasSchoolYearLabel` alongside the id; display label first, id as fallback.
  - Verify: System Health shows "2026-2027", not "5".

- [x] **6. Audit log shows actor "TEACHER" for attendance saves**
  - File: `server/src/routes/attendance.ts`
  - Cause: attendance audit calls pass `req.user` (JWT has no first/last name); grade routes pass an enriched user.
  - Fix: look up user first/last name and pass the enriched object to `createAuditLog` for both bulk save and clear.
  - Verify: new attendance save logs show "CAMILLE JOY RAMOS", not "TEACHER".

- [x] **7. Run full verification after fixes**
  - Commands: `pnpm run typecheck`, `pnpm run build`, `pnpm run lint`, `pnpm --prefix server run build`
  - Note: `pnpm --prefix server test` is blocked unless `DATABASE_URL` points to a `*_test` database.
  - Verify: 0 TypeScript errors, 0 lint errors.

## Decisions / Data Cleanup (no code needed unless chosen)

- [x] **8. Future-term grades already exist (T2, T3) while current term is T1 — NOT AN ISSUE**
  - Decision: this is intentional development seed data from the project seed script, created so grades do not need manual entry for demos/tests.
  - No action required. Keep as-is for the defense.

- [ ] **9. Junk demo data in Grading Config / Users**
  - Subjects named `1010` and `M`, user `TEACHERONE TEACHERONE`, and `Science` without grade level.
  - These come from EnrollPro/ATLAS demo data; clean at the source or avoid opening those tables during the demo.

- [ ] **10. Test database for server test suite**
  - Set `DATABASE_URL` to a `*_test` database if a fully green `pnpm run verify` is required.

## Defense Operations

- [ ] **11. Restart backend and frontend the morning of the defense**
  - Avoids stale hot-reload state; several console warnings only appear during HMR.
- [ ] **12. Do not open Admin → Settings → Advanced during the demo**
  - Contains destructive demo controls: Seed/Clear Grades, Seed/Clear Attendance.
- [ ] **13. Be ready to explain edit requests**
  - Edit requests apply to PAST terms only; current-term locks are opened by an admin unlock.
- [ ] **14. Suggested demo path**
  - Teacher grade edit → Admin audit log → Registrar term finalize → SF9 preview → Admin unlock/finalize reversal.

## Verification Results (Nov 15, 2026)

- **#1 Export**: downloaded `student-records-2026-2027-2026-11-15.csv` with 83 rows and correct headers.
- **#2 File picker**: one click on Import filled Excel opened exactly one file chooser (was two).
- **#3 Dashboard text**: now reads "13 Enrolled Learners across 5 Sections".
- **#4 EOSY counts**: drawer now reads "10 subject(s) still have draft grades", Draft Subjects 10, and "0/10 subjects finalized" — consistent.
- **#5 ATLAS year**: System Health now reads "2026-2027" with "ATLAS id: 5" below.
- **#6 Audit actor**: new attendance save log shows "CAMILLE JOY RAMOS / TEACHER".
- **Typecheck**: passed.
- **Client build**: passed (`vite build`, 3337 modules).
- **PWA checks**: passed (`check-pwa-build`, `check-pwa-scope`).
- **Server build**: passed.
- **Lint**: 0 errors (1180 pre-existing warnings).
- **Server tests**: not run (test-DB guard requires a `*_test` database).

## Regression Pass (post-fix, Nov 15)

- Teacher: login, dashboard (13 learners / 5 sections), class record opens with T1 editable, grade values intact (WW1 = 8, class average 85.8), one file chooser on import, attendance page loads, advisory printables + temporary term card render, schedule loads.
- Registrar: login, dashboard (83 active / 20 sections), Student Records search + SF10 drawer, CSV export downloads, roster (20 sections), term finalization (20 sections / 897 drafts / 0 finalized), EOSY drawer counts consistent (10 draft / 0 of 10), SF1 preview (1 male, 1 female, 2 total), transferees (3), former students (19).
- Admin: login, dashboard (83 students, grades open, all online), users (43), teaching load (39 teachers / 224 assignments), edit requests (0 pending), grading config, transmutation (Zero-Based), school years (5), teacher archives (39/39), settings tabs, health (HEALTHY, ATLAS year 2026-2027), audit logs (attendance actor = CAMILLE JOY RAMOS).
- Console errors during the pass: 0 on every visited page.
- Note: two 502s in the aggregate console log came from the short backend restart window while applying server fixes; they did not recur on any page load after the restart. Live health check is green.
- No grade, lock, finalization, or attendance values were changed by this regression pass; sessions signed out at the end.

## Fixed In This Pass

- Registrar Student Records CSV Export implemented.
- Excel import one-shot picker guard.
- Teacher dashboard section count now includes advisory sections.
- EOSY progress denominator now excludes subjects without grades.
- System Health shows the ATLAS school year label (id retained as secondary).
- Attendance audit logs now record the actual teacher name.
