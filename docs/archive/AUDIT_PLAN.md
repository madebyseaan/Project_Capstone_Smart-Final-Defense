# SMART System Audit 2 Plan — Rollover Readiness (SY 2026-2027)

**Status:** Approved — ready to execute on user's command ("go")
**Created:** 2026-08-20 (revised 2026-08-21 for Audit 2)
**Purpose:** FULL RE-AUDIT of the SMART system + EnrollPro/ATLAS integrations, PLUS remediation verification against `AUDIT_FINDINGS.md` (Audit 1, 2026-08-20) and `ROLLOVER_REMEDIATION_PLAN.md`. Produces **`AUDIT_REPORT2.md`** at repo root.

---

## 0. Execution Mode: AUTONOMOUS (user is asleep — same as Audit 1)

- [ ] User is SLEEPING during execution → **do NOT ask questions, do NOT wait for input**. Every decision needed is locked in this plan.
- [ ] **Pre-approved by user:** all phases, mock servers, isolated `smart_audit_test` DB creation/migration/seeding, lint/build/tsc runs, PM2 log reads (read-only), read-only SELECT queries on `smart_db`.
- [ ] **Hard bans (never do, even if it seems helpful):** modify `.env`/`.env.*`, write/insert/update/delete on `smart_db`, contact real EnrollPro/ATLAS/AIMS, apply any code fix, `npm install`/`npm ci` (would alter package-lock.json), `git commit`/`push`, delete files.
- [ ] **If blocked or uncertain:** STOP that step, document exactly what blocked you and why in the report's verification log, continue with non-blocked steps, and flag it clearly in the final summary. Never improvise a workaround.
- [ ] **Final deliverable when user wakes:** complete `AUDIT_REPORT2.md` + a concise wake-up summary: remediation status (each Audit 1 finding → FIXED / PARTIAL / NOT FIXED / REGRESSED / UNVERIFIABLE), new findings, current readiness scores vs Audit 1, what could NOT be verified, and what the user must decide next.
- [ ] The dry-run approval step (Phase 0) is hereby pre-granted for this autonomous run.

---

## 1. Scope — 3 Systems, 1 Full Re-Audit + 1 Delta Track

| System | Role | Audit angle |
|---|---|---|
| **SMART** (this repo) | Core app (React 19 + Vite + Express 5 + Prisma/PostgreSQL) | Everything: code, DB, UI, routes, sync — re-audited from scratch |
| **EnrollPro** | Source of truth: users, students, advisers, sections, enrollment | Contract verification of every endpoint SMART consumes |
| **ATLAS** | Teaching load / teacher assignments | Same treatment: load → schedule → ECR chain |

**Two parallel tracks:**

1. **DELTA TRACK (new for Audit 2):** Every finding from `AUDIT_FINDINGS.md` (C1–C7, H1–H10, M1–M9, L1–L6 = 32 items) and every wave/task from `ROLLOVER_REMEDIATION_PLAN.md` (Waves 1–4, 16 tasks) is re-checked against current code → status per item.
2. **FULL RE-AUDIT TRACK:** All Audit 1 phases are re-executed completely (triple inventory, flows, quality, provenance, QA, simulations, readiness) because the codebase changed substantially since Audit 1 (see §3 "Known Changes Since Audit 1").

**HARD RULE (unchanged):** SMART only ever *reads* from EnrollPro/ATLAS. The audit must verify there are no write paths toward them. External systems are **never contacted** — mocks only.

---

## 2. Safety Guarantees (non-negotiable, unchanged from Audit 1)

1. **EnrollPro/ATLAS never contacted.** Mocks only, on localhost (`localhost:4100` / `localhost:4200`).
2. **Existing DB never touched for writes.** Isolated `smart_audit_test` DB on localhost:5432. `smart_db` is SELECT-only.
3. **No source code changes.** lint/build/tsc are read-only. Findings are proposals only.
4. **Dry run first** (pre-granted per §0).
5. **Internet research is READ-ONLY** (web search + doc fetches only). Sources are cited in the report appendix; no external systems or credentials are touched by research.

---

## 3. Locked Decisions

| Question | Decision |
|---|---|
| Deliverable | **`AUDIT_REPORT2.md`** at repo root (new filename per user; Audit 1's `AUDIT_FINDINGS.md` remains untouched as baseline) |
| Baseline for remediation | `AUDIT_FINDINGS.md` findings + `ROLLOVER_REMEDIATION_PLAN.md` waves |
| Scope | FULL re-audit + delta verification (user-confirmed) |
| Execution mode | AUTONOMOUS (user-confirmed) |
| DB tooling | Prisma CLI only (no psql/docker on PATH — confirmed Audit 1) |
| Test framework | Still absent (no `test` script in either package.json — verified 2026-08-21) → Phase 4 gap stands |

### Known Changes Since Audit 1 (verified 2026-08-21 — audit must confirm each)

- **C1 (hardcoded years):** `schoolYearResolver.ts` created; `getActiveSchoolYearLabel` imported by 9 files (admin, advisory, atlasSync, registrar, integration, grades, enrollproClient, ensureDevAccount, teacherSync). Only 1 hardcoded `'2026-2027'` fallback remains (enrollproClient.ts:363). **Verify**: resolver correctness, cache behavior, whether SystemSettings.schoolYearId FK exists (2.1a) or only the label helper was done.
- **H3 (rate limiting):** `middleware/rateLimiter.ts` created; `globalLimiter` imported in index.ts. **Verify**: applied to all routes, webhook bypass, limits, 429 behavior.
- **M5 (6 TS errors):** commit `e7cf992` claims fixed. **Verify**: `cd server && npm run build` + `npx tsc --noEmit` → 0 errors.
- **L1/L2 (dead files):** `server/src/lib/unused/*` deleted; `(unused files)/` trimmed; `ecrTemplates.ts` route, `ECRTemplateManager.tsx`, ECR uploads, `ecrSubjectMapping.ts` deleted. **Verify**: lint error count (was 1008 → expect <50), no dangling imports.
- **ECR system REMOVED** (was "untested" in Audit 1 Flow 3): templates now aligned to DepEd weights (commit `0f6085f`), grading redesign doc updated. **Verify**: no dead ECR code remains in routes/pages; grading config + transmutation flow intact; new `transmutationCache.ts`/`transmutationValidation.ts` correctness.
- **New migration:** `20260818000000_make_subject_weights_nullable`. **Verify**: schema drift vs models, seed scripts still run against new schema.
- **New files since Audit 1:** `seed-historical.ts`, `schoolYearResolver.ts`, `rateLimiter.ts`, `transmutationCache.ts`, `transmutationValidation.ts`, `src/pages/admin/SchoolYears.tsx`, `TransmutationTable.tsx`, `AlumniStudents.tsx`, `scripts/` dir, `server/check-*.ts` scripts. All must be inventoried.
- **C6/C7 (SchoolYear lifecycle):** Admin `SchoolYears.tsx` page now exists. **Verify**: is `currentSchoolYear` still a String (no FK)? Is SchoolYear table still empty in production? Is there a seed-school-years script? (Audit 1: table empty = C7 critical.)

---

## 4. Audit Phases

### Phase 0 — Prerequisites
- [ ] Read AGENTS.md (rules of engagement)
- [ ] Read `AUDIT_FINDINGS.md` (Audit 1 baseline) + `ROLLOVER_REMEDIATION_PLAN.md` (remediation baseline)
- [ ] Read all docs: `mdfiles/ROLLOVER-GAP-FIX-PLAN.md`, `SYNC_OPTIMIZATION_PLAN.md`, `docs/GRADING-SYSTEM-REDESIGN-PLAN.md`, `docs/GRADING-SYSTEM-STATUS.md`, `docs/SMART_DFD.md`, `docs/SMART_ERD.dbml`, `docs/ERD_CARDINALITY_NOTES.md`, `mdfiles/ENROLLPRO-API.md`, `mdfiles/ENROLLPRO-DEV-HANDOFF-2026-08-07.md`, `mdfiles/ATLAS-DEV-HANDOFF-2026-08-07.md`, `mdfiles/atlas-smart-rollover-api-endpoints-2026-08-07.md`, `mdfiles/SMART-API-ENDPOINTS-2026-08-07.md`, `mdfiles/ENROLLPRO-SCHOOL-YEAR-LIFECYCLE.md`, `mdfiles/HISTORICAL-GRADES-SEED-PLAN.md`, `mdfiles/PROGRAM-SUPPORT-PLAN.md`, `mdfiles/REGISTRAR-NEXT-STEPS-PLAN.md`, `mdfiles/TEACHER-SCHEDULE-FEATURE-PLAN.md`, `mdfiles/ARCHITECTURE_MICROSERVICES.md`, `docs/TRANSMUTATION-VALIDATION-FIX-PLAN.md`, `ECR_REMOVAL_PLAN.md`, `ROLLOVER_REMEDIATION_PLAN.md`
- [ ] Record environment facts (see §6) without exposing secrets
- [ ] Dry-run step list presented (pre-granted per §0)

### Phase 0B — Remediation Verification (NEW — the delta track)
For EACH of the 32 Audit 1 findings and 16 remediation tasks, produce a row in `AUDIT_REPORT2.md`:

| # | Finding | Audit 1 state | Current state | Status | Evidence (file:line) |
|---|---|---|---|---|---|
| C1 | 25 hardcoded years | Open | Resolver in 9 files, 1 fallback left | PARTIAL | grep + resolver read |
| ... | ... | ... | ... | ... | ... |

- **Statuses:** FIXED / PARTIAL / NOT FIXED / REGRESSED (was fixed, broken again) / UNVERIFIABLE (blocked)
- **Verification methods per item:** grep for the exact code pattern, read the file:line cited in Audit 1, run the command (build/tsc/lint), query `smart_db` (SELECT only) where the finding was DB-state based (C7 SchoolYear count, H4 NODE_ENV, M7 token leaks in logs)
- **Full coverage list (32 findings):** C1–C7, H1–H10, M1–M9, L1–L6 (see AUDIT_FINDINGS.md §2). The report's Findings section must cite the Audit 1 ID (e.g. "C3 → FIXED") or "NEW" for anything new.

### Phase 0C — Best-Practices Research (internet research — NEW, user-requested)

**Goal:** Before executing the audit phases, RESEARCH current industry best practices on the internet (web search + docs) for each specialized audit area, then apply the researched criteria to SMART. The report must cite what was researched, what was applied, and any deviations (with rationale).

**Research areas (each → findings applied to the corresponding phase):**
- [ ] **Stale data management** (for Phase 3D): how mature systems detect/orphan/deprecate stale records without destroying legitimate history (soft-delete, archival, source-of-truth reconciliation, ETL-style reconciliation windows). Sources: Postgres/SQL community, ERP/school-system patterns.
- [ ] **Database health & indexing** (for Phase 3E): Postgres indexing best practices (FK indexes, composite indexes, partial indexes), query performance fundamentals, schema integrity checks, migration hygiene, JSON column tradeoffs.
- [ ] **Sync pipeline optimization** (for Phase 3C): incremental/delta sync patterns, batch vs streaming writes, idempotency, mutex/in-flight guards, backpressure, retry with exponential backoff, pagination best practices for large datasets.
- [ ] **Concurrency & load resilience** (for Phase 3C): connection pool sizing math, race-condition prevention (optimistic vs pessimistic locking), Node.js single-threaded throughput limits, Express rate limiting tiers, PM2 cluster vs singleton tradeoffs.
- [ ] **Hardcoded data / dynamic configuration** (for Phase 1C): config-driven UIs, feature flags, environment-driven school year/term resolution patterns.

**Rules:**
- Research is READ-ONLY (web search + doc fetches only). No code changes.
- Timebox research: ~30–60 min total across areas; capture the top 3–5 best practices per area in the report (§ Research appendix) with source names.
- Every researched best practice that IS applied to SMART → mark in the relevant phase output (e.g. "Index check: FK indexes — best practice says X → SMART has Y → status Z").
- If research contradicts an existing Audit 1 recommendation → note the conflict in the report, do NOT silently drop the old recommendation.

### Phase 1 — Triple Inventory (full re-run — nothing unchecked)
**SMART:**
- [ ] Every route in `server/src/routes` (NOTE: `ecrTemplates.ts` deleted since Audit 1 — confirm no orphaned frontend calls) → method, purpose, input validation, error handling, frontend caller (flag DEAD endpoints)
- [ ] Every page/component in `src/pages` + every button/form → its API call (flag UI actions with no backend support and vice versa; **check for dangling ECR UI references**)
- [ ] Every Prisma model in `server/prisma/schema.prisma` → fields read/written anywhere (flag DEAD schema; verify `subjectWeights` nullable migration impact)
- [ ] Every service in `server/src/services`, every lib in `server/src/lib` (incl. NEW: `schoolYearResolver.ts`, `transmutationCache.ts`, `transmutationValidation.ts`, `rateLimiter.ts`) → purpose, caller, failure behavior
- [ ] All API clients/config (EnrollPro, ATLAS, AIMS) → base URLs, auth, timeouts, retries
- [ ] All seed/utility scripts (incl. NEW: `seed-historical.ts`, `server/check-*.ts`, `scripts/`) → data created, when run, production safety

**EnrollPro (docs only):** every consumed endpoint → method, payload, pagination, filters, auth — field-by-field vs handoff docs.
**ATLAS (docs only):** every consumed endpoint → same treatment; teaching load → schedule → ECR chain.
**Sync layer:** every job → pull, trigger, interval, delta vs full, partial-failure, dedup, idempotency (incl. webhook protection state post-Audit-1).

### Phase 1C — Frontend Hardcoded Data Audit (teacher / registrar / admin) (NEW — user-requested)

**Goal:** The system must be DYNAMIC — every displayed value must come from an API call, never a hardcoded constant. Only pull what is actually needed.

**Method:** For EVERY page in each portal, list every hardcoded value and trace it:

| Portal | Check pattern | Examples of offenders |
|---|---|---|
| **teacher/** | Dashboard, ClassRecordsList, ClassRecordView, MyAdvisory, StudentGradeProfile, Schedule, Attendance, AttendanceReports | hardcoded SY labels (`'2026-2027'`), hardcoded term, student names/IDs, section names, subject lists, mock/demo data, "looks-live" fixture arrays |
| **registrar/** | Dashboard, StudentRecords, AlumniStudents, TeachingLoad, SectionRosterViewer, SchoolForms, PrintCenter, FormViewer, ApplicationTracker, BOSYQueue, RemedialTracker, EOSYFinalization | hardcoded school year dropdowns, section lists, status enums rendered as strings, LRNs, student IDs |
| **admin/** | Dashboard, UserManagement, AuditLogs, SystemSettings, GradingConfig, ClassAssignments, TemplateManager, SystemHealth, TransmutationTable, SchoolYears | hardcoded `SCHOOL_YEARS` arrays (known offender: ClassAssignments.tsx), hardcoded role lists, settings defaults, subject type lists |

- [ ] Grep `src/pages/` for: `'2026-2027'`, `'2025-2026'`, `2025-2026`, `2026-2027`, `T1|T2|T3` hardcodes, `const [A-Z_]+ = [` fixture arrays, `mock`, `dummy`, `sample`, `fake`
- [ ] Every hit → trace: should this come from an API? (school years → `adminApi.getSchoolYears`; sections → `registrarApi.getSections`; current term → `getSettings`; students → `getStudents`) → classify: **HARDCODED (bad)** vs legitimately static UI copy (labels, role names from system constants) vs **unused code**
- [ ] Verify each portal page only fetches data it renders (no over-fetching that would break under load)
- [ ] Flag any hardcoded value that could go STALE across a rollover (SY labels especially) as HIGH severity
- [ ] Also scan `src/lib/api.ts` and shared components for hardcoded API response fallbacks

### Phase 2 — Cross-System Flow Verification (full re-run)
Trace each chain end-to-end; report ANY break, mis-wire, or partial implementation:
1. EnrollPro users/sections → SMART provisioning → login → roles/permissions
2. Advisory (EnrollPro) → adviser sees correct advisory on SMART
3. Teaching load (ATLAS) → teacher schedule → ECR creation → grading (**re-verify post-ECR-removal: ECR now template-based via ExcelTemplate + templateService**)
4. Grades → SF2/SF10 → transmutation → historical records (verify math per `docs/TRANSMUTATION-VALIDATION-FIX-PLAN.md`; verify new transmutationCache/Validation integration)
5. **Rollover across all three systems** (order of operations, SY boundary data)
6. Compare `docs/SMART_DFD.md` against actual implementation (audit whether DFD needs updating post-ECR-removal)
7. **TEACHER → REGISTRAR → ADMIN yearly pipeline** — same deep treatment as Audit 1: status state machine, return path, locking (is `clear-scores` isArchived check present now? C3), audit trail, permission boundaries, full yearly lifecycle chain (BOSYQueue → TeachingLoad → ECR → grading → EOSYFinalization → rollover → next SY BOSY)

### Phase 3 — Code Quality Audit (full re-run)
- [ ] `npm run lint` (root) + `server` lint if present → record every warning/error by file (compare vs Audit 1: 1008)
- [ ] `npm run build` (root) + `server npm run build` → record errors (Audit 1: 6 TS errors; expect 0 post `e7cf992`)
- [ ] `npx tsc --noEmit` both tsconfigs
- [ ] Dead code / unused imports / `any` types / unhandled promises
- [ ] console.logs in production paths (Audit 1: 100+; `logger.ts` migration partially done via commits `42eafc4`, `e55fed9`)
- [ ] Hardcoded secrets; `.env` gitignored; committed env files
- [ ] Auth middleware coverage on EVERY route; input validation (zod) coverage; CORS, rate limiting (verify globalLimiter actually applies), error handling centralization, error response leaks (M3)
- [ ] Race conditions in React Query / Zustand; React 19 / Express 5 idioms; error boundaries
- [ ] **PM2 production logs** (read-only): restart counts vs Audit 1 (server 49, client 32), NODE_ENV (H4), recurring errors, sync failures, token leaks in logs (M7), ATLAS 502s (H7)

### Phase 3B — Data Provenance / Hardcoded Data Audit (full re-run)
- [ ] Source-of-truth map per entity (EP-synced / ATLAS-synced / SMART-owned) — verify no NEW local authoring crept in
- [ ] Hardcoded names/IDs/section names/SY IDs scan in `src/` + `server/src/` (Audit 1: 25 year fallbacks → now 1; re-scan for anything else)
- [ ] Mock/fixture data rendering as real
- [ ] `(unused files)/` remnants
- [ ] Production contamination: can seed scripts hit production? Dev accounts gone? Historical grades legitimate? (re-query `smart_db` SELECT-only; 26 users, 50 sections, 80 students, 11004 grades, 618 CAs, 0 SchoolYears was Audit 1 baseline — re-measure)

### Phase 3C — Sync Optimization & Concurrency Resilience Audit (NEW — user-requested)

**Goal:** Answer: "Are the sync files optimized, and with many concurrent users, will it crash?"

**A. Sync efficiency scan (per sync job in `server/src/lib/sync*`):**
- [ ] N+1 query patterns (e.g. per-student upsert loop hitting Prisma one-by-one → count DB calls per sync run)
- [ ] Batch vs row-by-row writes (`createMany`/`updateMany`/`upsert` bulk vs loop) — measure write amplification
- [ ] Pagination handling of EnrollPro/ATLAS payloads (page size, page-through vs single fetch; 500-student scale test)
- [ ] Redundant sync work: full re-sync where delta suffices, re-fetching unchanged entities (hash/delta effectiveness — Audit 1 said hash-based; verify hashes actually skip work)
- [ ] In-memory cache usage (`syncCache.ts`, `transmutationCache.ts`): TTL, invalidation, what happens when cache misses under load
- [ ] Sequential vs parallelizable steps in `syncCoordinator.ts` (EP + ATLAS + branding run in series? could they run in parallel safely?)
- [ ] Timeouts/retries/backoff in `sync/httpClient.ts` (Audit 1 remediation 1.1 claimed retry added — verify)
- [ ] Memory: are large payloads held fully in RAM? (500 students × grades JSON — object churn, GC pressure)

**B. Concurrency crash-resistance analysis:**
- [ ] **Overlapping sync runs:** can a scheduled sync + manual sync + webhook-triggered sync run SIMULTANEOUSLY? Is there a mutex/lock/in-flight guard in `syncCoordinator.ts`? (double-run → duplicate upserts, deadlocks, or worse) → test by firing 3 syncs concurrently in simulation
- [ ] **DB connection pool:** Prisma pool size vs sync's per-item queries — can 100 concurrent users + a sync exhaust the pool? (count max concurrent DB connections in a worst-case sync path)
- [ ] **Deadlock risk:** upsert-heavy transactions across User/Student/Section/Enrollment rows; verify transaction isolation & locking order
- [ ] **Race conditions:** two teachers grading the same class concurrently (Grade upsert vs clear-scores vs archive); concurrent login sync (`teacherSync.ts`) for the same teacher
- [ ] **PM2 concurrency:** single instance? If cluster mode later, do in-memory caches + SSE break? (document the constraint)
- [ ] **Load test (simulated, isolated):** against `smart_audit_test` + mocks — run N concurrent simulated users (e.g. 25/50/100 concurrent API calls via a small Node script — NO Playwright) + a sync at the same time → measure: response time, error rate, DB connection count, completion time. Record hard numbers in report. Scale is bounded by what localhost can do — report as indicative, not production-grade.

**C. Output:** per-sync-job table: items synced, DB calls per run, writes batched?, delta working?, lock present?, crash risk under load (LOW/MED/HIGH) + recommendation. Any finding where concurrent users could crash the server → HIGH/CRITICAL.

### Phase 3D — Stale Data Audit, Provenance-Aware (NEW — user-requested)

**Goal:** Find stale/orphaned data that will poison rollover — WITHOUT flagging legitimate history.

**CRITICAL EXCEPTION (the historical-grades rule):** Historical grades ARE the permanent record (SF10). Any entity tied to a PAST school year with status COMPLETED/ARCHIVED (Grades, GradeSnapshots, archived Sections, historical ClassAssignments, past enrollments) is **LEGITIMATE by design** — never flagged as stale. Stale = data that should have been updated/synced/deactivated per the source-of-truth map but wasn't, OR data that will survive rollover incorrectly.

**Stale check matrix (each via SELECT-only Prisma queries on `smart_db` + isolated checks on `smart_audit_test`):**

| # | Stale pattern | Why it matters | Severity if found |
|---|---|---|---|
| S1 | Students/Teachers/Users in SMART missing from current EnrollPro payload (mock fixtures) | Orphaned roster data rolls into new SY | HIGH |
| S2 | Sections with status ACTIVE for a PAST school year | Wrong-year sections survive rollover | HIGH |
| S3 | Enrollments with status ENROLLED for a PAST school year | Students look enrolled in old SY | MEDIUM |
| S4 | ClassAssignments with isActive=true for a PAST school year | Teachers still assigned to dead classes | MEDIUM |
| S5 | Users with role TEACHER but no linked Teacher record (or vice versa) | Login/sync broken records | MEDIUM |
| S6 | Orphan rows: Grade with no Student/ClassAssignment, Attendance with no Section, Enrollment with no Section, GradeSnapshot with no Grade | Corruption + SF10 errors | HIGH |
| S7 | GradeSnapshot vs current Grade drift (snapshot ≠ live grade for non-archived records) | Tampering or broken snapshot logic | MEDIUM |
| S8 | `isArchived=true` on records for the CURRENT school year | Accidental early archival | MEDIUM |
| S9 | Duplicate records: duplicate LRNs, duplicate (studentId, sectionId, schoolYear) enrollments, duplicate sections with same name+year | Rollover duplication risk | HIGH |
| S10 | Seeded/fake data that would survive rollover into new SY rosters | Fake students in new rosters (Audit 1 raised this) | HIGH |
| S11 | Inactive/stale data bloating hot queries (huge AuditLog/SyncHistory with no retention policy) | DB growth, slow queries | LOW |
| S12 | EnrollPro/ATLAS source rows deleted but SMART copy still ACTIVE (mock-deleted scenario) | Sync reconciliation gap — does SMART deactivate? | HIGH |

- [ ] Each pattern → run the query on `smart_db` (read-only) → record counts → classify FOUND / CLEAN / UNVERIFIABLE
- [ ] **Reconciliation behavior test:** in the mock environment, delete a student/section from mock EnrollPro → run sync → does SMART deactivate/remove it? (If sync only upserts and never deactivates, stale data is BY DESIGN — flag as HIGH design gap with the historical-grades exception explicitly carved out)
- [ ] Rollover interaction: after the Phase 5 rollover drill, re-run S1–S10 checks → did stale data carry into the new SY? (the real test)

### Phase 3E — Database Health Audit (NEW — user-requested)

**Goal:** "Is the database good?" — schema quality, integrity, indexes, and performance, checked properly.

**A. Schema quality (from `server/prisma/schema.prisma` + migration files):**
- [ ] FK constraints on every relation (Prisma does NOT auto-index FKs → flag every relation missing an index on the FK column)
- [ ] Index coverage on hot query paths: Grade (studentId, classAssignmentId, schoolYear), Enrollment (studentId, sectionId, schoolYear), ClassAssignment (teacherId, sectionId, schoolYear), Attendance (sectionId, date), AuditLog (userId, createdAt), SyncHistory (startedAt), GradeSnapshot (studentId, classAssignmentId) — per best-practice research in Phase 0C
- [ ] Status fields: String vs enum — data integrity implications
- [ ] JSON columns (Grade.scores, AuditLog.metadata, SyncHistory.enrollpro/atlas/branding) — queryability, size growth, validation gaps
- [ ] `currentSchoolYear` String vs FK (C6 recurrence check)
- [ ] Migration hygiene: both migrations apply cleanly to a fresh DB (`smart_audit_test` creation from scratch = migration test), `quarter_to_term.sql` — is it applied/managed?
- [ ] Missing constraints: unique constraints where needed (unique LRN? unique username? unique section name+schoolYear?), onDelete behavior (cascade risk of mass-deleting history)

**B. Data integrity (SELECT-only on `smart_db`):**
- [ ] Orphan counts (cross-check with Phase 3D S6/S9 findings)
- [ ] NULL violations in required fields, malformed rows, impossible dates (endDate < startDate), term values outside T1–T3
- [ ] Duplicate LRNs / usernames / section+year combos
- [ ] Row-count reality vs Audit 1 baseline (26 users, 50 sections, 80 students, 11004 grades, 618 CAs, 0 SchoolYears) — re-measure ALL tables (incl. new: GradeSnapshot, Attendance, AuditLog, SyncHistory, TransmutationEntry, ExcelTemplate)

**C. Performance signals:**
- [ ] Table sizes + growth (AuditLog/SyncHistory/GradeSnapshot growth rates from row counts + timestamps)
- [ ] Slow-query signatures from PM2 logs (any Prisma query timing warnings? API timeouts?)
- [ ] N+1 query patterns in route code (same shape as sync audit but for hot user-facing routes — registrar dashboard, SF9/SF10, teacher dashboard)
- [ ] `EXPLAIN`-style analysis where possible via read-only `$queryRaw` (SELECT-only queries are allowed; no writes)
- [ ] Index recommendations → each with expected impact (e.g. "add index on Grade.schoolYear → SF10 query")

**D. Output:** DB health scorecard table: area → status OK/ISSUE/CRITICAL → evidence → recommendation (index additions, constraints, retention policy for logs). 

### Phase 4 — QA Architecture Audit (full re-run)
- [ ] No `test` script in either package.json — re-confirm the gap
- [ ] Required suite definition: unit (transmutation math, grade computations, rollover logic), API integration, contract tests. **Playwright e2e: OUT OF SCOPE** (static code tracing only)
- [ ] Top 20 critical flows that MUST be covered before rollover (re-derive if flows changed post-ECR-removal)
- [ ] User-facing error messages: user-friendly vs raw stack trace

### Phase 5 — Testing Simulation (isolated)
**Mock servers:** localhost mock EnrollPro + ATLAS with fixture payloads from mdfiles; SMART sync pointed at mocks via temp env override (NEVER real URLs).
**Scenario matrix (re-run):** role CRUD chains; teacher → registrar → admin handoff (incl. negative 403 tests, audit log checks); 500-student sync; duplicate data; mid-sync failure; empty SY; concurrent grading; idempotent double sync; double rollover.
**Rollover drill (re-run, the critical one):** seed `smart_audit_test` with SY 2025-2026 data → execute rollover → verify student/section counts, grade preservation, archives, no orphans, new SY correctness, mid-rollover sessions, backup/archive.
**Checksums:** count + sum before/after EVERY simulation (as Audit 1).

### Phase 6 — Rollover Readiness (full re-run + delta)
- [ ] Order of operations across systems; idempotency, transactionality, backups
- [ ] Pre-rollover data-loss/corruption risk assessment
- [ ] Rollover runbook draft (production step-by-step)
- [ ] **Production health baseline re-measured from PM2** — compare against Audit 1 baseline table (§6 of AUDIT_FINDINGS.md): uptime, restarts, memory, NODE_ENV, sync cycle time, error signatures. Any REGRESSION (e.g. restart count went UP) must be a new HIGH/CRITICAL finding.

---

## 5. Deliverables — `AUDIT_REPORT2.md` (11 sections + appendix)

1. **Remediation status table** — all 32 Audit 1 findings × status (FIXED/PARTIAL/NOT FIXED/REGRESSED/UNVERIFIABLE) + evidence
2. **Triple inventory tables** (re-run) — item → status: OK / DEAD / BROKEN / UNTESTED
3. **Frontend hardcoded-data table (teacher/registrar/admin)** — per portal: hardcoded value → page → should be API-driven → severity (from Phase 1C)
4. **Sync optimization & concurrency table** — per sync job: efficiency metrics, lock status, load-test numbers, crash risk under concurrent users (from Phase 3C)
5. **Stale-data matrix** — S1–S12 patterns → found/clean/unverifiable → counts → rollover impact, with the historical-grades exception stated (from Phase 3D)
6. **Database health scorecard** — schema quality, integrity, indexes, performance → OK/ISSUE/CRITICAL → evidence → recommendations (from Phase 3E)
7. **Findings by severity** — CRITICAL / HIGH / MEDIUM / LOW, each tagged with Audit 1 ID (recurring/regressed/new) or NEW, with `file:line`, impact, fix
8. **Flow chain diagrams** — text lists of flows → pass/fail per link
9. **Readiness scores** — per system + overall (0–100%), with explicit DELTA vs Audit 1 scores (SMART 69, EP 56, ATLAS 63, overall 42)
10. **Prioritized remediation plan** — dependency-ordered, effort estimates, blockers vs nice-to-haves, carried-over vs new items
11. **Verification log** — what was simulated vs read vs assumed; explicit "what could NOT be verified and why"; PM2 baseline comparison table
12. **Appendix: Best-practices research** — per area (stale data, DB health, sync, concurrency, dynamic config): sources consulted, top practices, which were applied to SMART's assessment and which were not (with rationale)

---

## 6. Environment Facts (re-recorded 2026-08-21, no secrets)

- Postgres: `localhost:5432`, db `smart_db` (SELECT-only) → audit db `smart_audit_test` (Prisma CLI only)
- No psql/docker on PATH → all DB work through Prisma CLI
- ATLAS remote: `https://njgrm.buru-degree.ts.net/api/v1` (dev tunnel — never call)
- EnrollPro remote: `https://dev-jegs.buru-degree.ts.net/api` (dev tunnel — never call)
- Env vars: same set as Audit 1 (+ check for NEW: `CORS_ORIGIN`?, `ENROLLPRO_WEBHOOK_KEY`?, `NODE_ENV`?)
- Migrations present: `20260511091431_init_consolidated`, `20260818000000_make_subject_weights_nullable` (+ `quarter_to_term.sql` — verify if applied)
- **Known since Audit 1:** `schoolYearResolver.ts` used by 9 files; `globalLimiter` wired; 1 hardcoded `'2026-2027'` remains (enrollproClient.ts:363); no `test` script anywhere; ECR system deleted

---

## 7. Execution Checklist (must tick every box)

- [ ] Phase 0 prereqs read (incl. Audit 1 baseline + remediation plan)
- [ ] Phase 0B remediation verification — all 32 findings + 16 tasks statused with evidence
- [ ] Phase 0C best-practices research completed — internet research done per area, sources captured, applied criteria recorded
- [ ] Phase 1 triple inventory complete (3 systems, incl. new files)
- [ ] Phase 1C frontend hardcoded-data audit — teacher/registrar/admin portals, all offenders traced to API sources
- [ ] Phase 2 all 7 flow chains traced (incl. post-ECR-removal chain)
- [ ] Phase 3 lint/build/tsc run, PM2 baseline re-measured, compared vs Audit 1
- [ ] Phase 3B provenance + production contamination re-checked
- [ ] Phase 3C sync optimization + concurrency resilience — efficiency scan, overlapping-run lock check, concurrency load test with numbers
- [ ] Phase 3D stale-data audit — S1–S12 matrix run, historical grades exempted by design, reconciliation behavior tested
- [ ] Phase 3E database health audit — schema/index/integrity/performance scorecard complete
- [ ] Phase 4 QA gap re-documented
- [ ] Phase 5 mocks + isolated DB + scenario matrix + rollover drill with checksums
- [ ] Phase 6 readiness scores with deltas + runbook draft
- [ ] `AUDIT_REPORT2.md` written with all sections + research appendix
- [ ] Final wake-up summary: remediation status, new findings, score deltas, unverifiables, decisions needed

**Reminder to executor:** NEVER modify `.env`, NEVER write to `smart_db`, NEVER contact real EnrollPro/ATLAS, NEVER apply code fixes without explicit approval — in autonomous mode (§0), that approval can only come from the plan itself, never from improvisation.

**Token efficiency rules:** NO browser automation; no screenshots; targeted reads/greps; inventory tables go directly into the report file; each scenario: execute → record → move on.