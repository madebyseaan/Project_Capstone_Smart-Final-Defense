# SMART Gap Remediation — Implementation Plan for MiMo 2.5

**Role:** You are implementing this plan. Planning is final; do not redesign. Follow AGENTS.md rules (read-only integrations, 1000-line file max, `npm run build` before finishing, no `.env` changes).

**Context docs:** `docs/ARCHITECTURE_QA_FOR_GLM.md` (investigation results at top), `docs/ROLLOVER_READINESS_PLAN.md` (review corrections v2), `docs/ENROLLPRO_GRADE_FETCH_API.md`.

---

## 0. Verified Facts (do not re-investigate)

| Fact | Evidence |
|---|---|
| EOSY grades: EnrollPro **PULLS** from SMART via `POST /api/integration/smart/sections/:sectionId/sync-grades`; no push exists or is needed | `server/src/routes/integration.ts:71-257` |
| Curriculum = **3 terms (T1–T3)** per SY | term schema + resolver |
| `gradeLock` is a **system-wide boolean**, not per-year | `server/prisma/schema.prisma:390` |
| Promotion status is computed in the pull payload but **never persisted** on `Enrollment` | integration.ts; no `promotionStatus` column |
| Registrar unfinalize exists: `POST /api/registrar/unfinalize-grades` | `server/src/routes/registrar/main.ts:634` |
| Manual sync exists: `POST /api/sync/all` + `triggerImmediateSync('manual')` | `server/src/routes/sync.ts:26`, `server/src/lib/syncCoordinator.ts:372` |
| Hardcoded SY fallbacks remain | `server/src/routes/grades-sub/editRequests.ts:62`, `server/prisma/seed-grades-fresh.ts:207` |
| Local grade-level maps duplicated in 13 files | see Task 1 list |
| School-year single-writer resolver exists | `server/src/lib/schoolYearResolver.ts` (`getActiveSchoolYearLabel()`) |
| Historical/archived guards already exist on grade writes | `server/src/routes/grades-sub/classes.ts:249,291,490` |

---

## Task 1 — Kill Hardcoded School Years + Dedupe Grade-Level Map (no migration)

1. `editRequests.ts:62` and `seed-grades-fresh.ts:207`: replace `settings?.currentSchoolYear ?? "2026-2027"` with `await getActiveSchoolYearLabel()` from `schoolYearResolver`. Test fixtures with literal years are fine — leave them.
2. Create shared map in `src/lib/constants.ts` (`GRADE_LEVEL_MAP`, `GRADE_LEVELS`, `GRADE_LEVEL_OPTIONS`). Replace local copies in:
   `src/pages/teacher/{Attendance,StudentGradeProfile,MyAdvisory,Dashboard,ClassRecordsList,AttendanceReports}.tsx`, `src/pages/teacher/components/ClassRecordHero.tsx`, `src/pages/registrar/{Dashboard,ApplicationTracker,AlumniStudents,StudentRecords}.tsx`, `src/pages/registrar/BOSYQueue.tsx` (inline options), `server/src/routes/registrar/bosy.ts`.
3. `schema.prisma:368`: `currentSchoolYear @default("")` + migration.

**Accept:** grep `2026-2027|2025-2026` in `server/src` returns only tests/comments; grep `GRADE_7: "Grade 7"` returns only `constants.ts`; builds pass.

---

## Task 2 — Per-Year Grade Lock (3-term aware)

**Problem:** system-wide `gradeLock` boolean (schema.prisma:390); a year-level lock must not block T2/T3 after T1 ends.

1. New Prisma model `YearGradeLock { id, schoolYearId (unique FK), lockedBy, lockedAt, unlockedBy, unlockedAt, isLocked }`. No extra `@@index` (unique covers it). Keep `gradeLock` column temporarily as legacy.
2. New `TermGradeLock { id, schoolYearId+term unique, ...same audit fields }`.
3. Grade save/delete/clear paths (`routes/grades-sub/classes.ts`): check per-year lock (via classAssignment → schoolYear) AND per-term lock for the target term; keep existing archived-grade 403s. Lock check order: archived → year lock → term lock → existing gradeLock.
4. Scheduler (`server/src/index.ts`): on **term end date** → lock that term only. On **T3 (final term) end** → lock the year. Never write term state (AGENTS.md: only `resolveCurrentTerm()` writes terms).
5. Admin API (`routes/admin-sub/system.ts`): `GET /admin/year-locks`, `POST /admin/year-locks/:schoolYearId` (toggle), term-lock equivalents. Zod-validate body, 404 unknown year, audit-log every toggle, transactional.
6. Admin UI (`src/pages/admin/SystemSettings.tsx` or new `GradeLocksPanel`): table of years × terms with lock toggles.
7. Migration: create tables + backfill `YearGradeLock(isLocked=true)` for all `SchoolYear` with status ARCHIVED.

**Accept:** saving a T2 grade after T1 locked succeeds; after T3+year lock, 403 for teacher but admin override path works; teacher/admin tokens enforced on lock endpoints.

---

## Task 3 — Persist Promotion Status + Snapshot-First EOSY

**Problem:** promotion computed only on-the-fly for EnrollPro pull; SF forms and rollover need it stored. Wrong counting logic (term grades ≠ subjects) must not be reproduced.

1. Schema: `Enrollment.promotionStatus` enum `{ PROMOTED, CONDITIONALLY_PROMOTED, RETAINED, JHS_COMPLETER }?` + `promotedToGradeLevel?`. Migration.
2. New `server/src/lib/promotion.ts` — single source of truth:
   - Per-subject final grade across T1–T3 (average of term finals), then count failing subjects (< 75). Do NOT count individual term grades as subjects.
   - Exclude non-promotional subjects via the Subject model's flag (verify field; do not hardcode `'HG'` prefix).
   - Rules: 0 fails → PROMOTED (+next grade); ≤2 fails → CONDITIONALLY_PROMOTED; ≥3 → RETAINED; no grades → RETAINED; Grade 10 + completer conditions → JHS_COMPLETER. Decide + document G10-with-1-2-fails (DepEd: completer with conditions) — do not leave it falling through.
   - Export for reuse by `integration.ts` sync-grades response (replace its inline computation with this lib).
3. EOSY finalize (`routes/registrar/eosy.ts` or main.ts): per section — for each enrollment: create/refresh immutable `GradeSnapshot` records **then** write promotionStatus. One transaction. Idempotent (re-run recomputes, never duplicates). REGISTRAR guard + zod `{ sectionId, schoolYear }`. Reject finalize if any grade still DRAFT (list blockers in response).
4. UI (`src/pages/registrar/EOSYFinalization.tsx`): promotion status + next-grade columns; block Finalize with reason when DRAFT grades remain.

**Accept:** re-running finalize changes nothing; SF5/EnrollPro pull and stored statuses agree 100%; DRAFT grades block finalize with actionable message.

---

## Task 4 — Rollover Detection with Guardrail (lock-and-alert, never blind-archive)

**Problem:** EnrollPro can roll over anytime; auto-archiving unfinalized years silently freezes incomplete data.

1. Put detection in `schoolYearResolver.ts` (single writer) — brandingsync calls it, no inline duplicate.
2. On detected year change, in a transaction + Postgres advisory lock (two overlapping syncs must not double-run):
   1. **Guardrail check:** previous year fully finalized? (all sections have EOSY finalize / snapshots complete)
   2. **If yes:** lock previous year (YearGradeLock), archive per ROLLOVER_READINESS_PLAN §5.2, flip `SystemSettings` to new year, clear legacy `gradeLock`.
   3. **If no:** still switch to the new year (school must operate) BUT: lock previous year, keep status ACTIVE, write audit `SCHOOL_YEAR_ROLLOVER_BLOCKED_ARCHIVE`, SSE broadcast, and flag for admin dashboard ("2025-2026 archived skipped — N sections unfinalized"). **Never** archive/flag `isArchived` on unfinalized data.
3. Audit every outcome; broadcast SSE (`sseManager.ts` — add `SCHOOL_YEAR_ROLLOVER` event type).
4. Admin UI: rollover status card (year, archived yes/no, unfinalized sections list, manual "Archive Now" button enabled only when guardrail passes).

**Accept:** simulation with unfinalized old year → new year active, old year locked-not-archived, alert visible; with finalized old year → clean archive; concurrent sync triggers run exactly once.

---

## Task 5 — Query Audit: `isActive`/`isArchived` vs Historical Reads

**Problem:** Task 4 sets `classAssignment.isActive=false` and `enrollment.isArchived=true` on old year; historical views (SF forms, registrar past-year views, teacher view-only) must still see those rows.

1. Grep every Prisma query filtering `isActive` on ClassAssignment / `isArchived` on Enrollment/Grade.
2. Rule: **operational** queries (current dashboards, teacher current classes) → filter; **historical/form** queries (SF1/SF5/SF10, registrar year-scoped views) → filter by `schoolYear` string only.
3. Document the rule in AGENTS.md Gotchas.

**Accept:** after simulated rollover, SF10 for a student includes prior-year grades; teacher current-classes list shows only new year.

---

## Task 6 — Excel Backup of Closing Year

1. `GET /api/registrar/export/year-backup?schoolYear=` — REGISTRAR + audit-logged. One workbook: sections, enrollments, grades (per subject per term), attendance summary, promotion statuses (Task 3 output). Use the existing Excel toolchain in `server/` (verify which lib: ExcelJS vs xlsx-populate — match it).
2. Registrar UI (`SchoolForms.tsx` or `EOSYFinalization.tsx`): "Download Year Backup" before archive step in Task 4 flow; store backup timestamp in audit log.

**Accept:** backup for a test year contains every enrollment and grade row; file opens; counts match DB.

---

## Task 7 — Teacher Login Lock During Transition (narrow scope)

1. `SystemSettings.transitionLock Boolean @default(false)` + `transitionNote String?`.
2. Auth (`routes/auth.ts`): after auth succeeds, if `transitionLock && role === TEACHER` → 403 `{ code: "TRANSITION_LOCKED", message }`. ADMIN/REGISTRAR never locked.
3. Task 4 sets it during the unfinalized-guardrail window; clears when resolved or admin overrides. Admin toggle in SystemSettings UI.

**Accept:** teacher blocked with clear message during lock; admin/registrar unaffected; lock clears automatically on clean archive.

---

## Task 8 — `sync-grades` Endpoint Auth (security)

**Problem:** EnrollPro-facing endpoint `POST /api/integration/*/sections/:sectionId/sync-grades` — verify its auth mechanism.

1. Read `routes/integration.ts:71-257` and app.ts middleware. Determine: API key header? shared secret? none?
2. If none: add service-auth middleware (env-based `ENROLLPRO_API_KEY` header check, constant-time compare), applied to EnrollPro-facing write-ish endpoints only. Do NOT put behind teacher JWT.
3. Document the contract in `ENROLLPRO_GRADE_FETCH_API.md` (add auth header spec) and coordinate the header name with the EnrollPro team before enforcing.

**Accept:** request without key → 401; with key → payload unchanged; doc updated.

---

## Addendum — Gaps Found in Review (2026-08-29, verified)

### A1. Task 2 spec gap: lock × edit-request × FINALIZED precedence (MUST define before coding)
`classes.ts:225-296` order today: gradeLock → past-term check (APPROVED `GradeEditRequest` bypasses) → archived 403 → FINALIZED 403. New locks must slot in explicitly:
- **Year-lock / archived:** APPROVED edit request does NOT bypass. Only path = registrar unfinalize + admin unlock.
- **Term-lock:** APPROVED edit request DOES bypass (preserves existing workflow for correcting finalized terms).
- Add tests for all three × both lock levels.

### A2. SF1 is NOT implemented (SF5 is)
`sf5Composer.ts` exists; no `sf1Composer`. Execute `docs/SF1-IMPLEMENTATION-PLAN.md` as **Task 9** — it is a capstone deliverable, independent of T1-T8 (can run in parallel).

### A3. Data retention dropped from this plan
Was ROLLOVER_READINESS_PLAN Phase 7. As **Task 10**: retention settings + daily cleanup scheduler. Batched SQL keep-latest (window function), NOT row-by-row. Snapshot retention **default OFF** until DepEd records policy confirmed.

### A4. Teacher-facing rollover communication
Task 4 only alerts admin. Teachers will see empty/new classes with no explanation. Add `RolloverBanner` (ROLLOVER plan §9.3): "SY X is now active" for 7 days after rollover, all portals.

### A5. Rehearsal & demo readiness (Task 11 — ops, not code)
- Confirm a staging EnrollPro + ATLAS exist for the joint rollover rehearsal; if not, coordinate with their teams NOW (longest lead time).
- Demo seed data spanning TWO school years (so historical views + rollover demo are possible).
- Scheduled DB backups (pg_dump cron or managed backups) — plan only has pre-migration backups. Rollover week = daily backups minimum.

### A6. Corrected fact for Section 0
`server/package.json` has `"test": "vitest run"` + vitest/supertest installed. Tests ARE runnable; add new tests to `server/src/__tests__/` and run `npm test` in `server/` (not the aspirational commands in the older rollover doc).

## Execution Order & Dependencies

```
T1 (independent)  ─┐
T8 (independent)  ─┤
T9/SF1 (independent, parallel track)
T2 ─→ T5 ─→ T4 ─→ T6, T7   (A1 precedence rules are part of T2)
T3 ─→ T4 (guardrail needs finalization status)
T4 ─→ A4 (banner)
T10 (independent, after T2 migrations)
T11 (ops — start NOW, longest lead time)
```
Migrations: T2+T3 schema can be one `prisma migrate` batch; T4/T7 after backfills. Every migration: staging first, backup, rollback note.

## Constraints / Gotchas for Implementer

- SMART never writes to EnrollPro/ATLAS. EOSY = pull model. Don't build a push.
- 3 terms (T1–T3). Year lock only after T3.
- `resolveCurrentTerm()` is the only term-state writer; scheduler only locks.
- Promotion counting: per-subject finals across terms, never raw term grades.
- Snapshot before promotion write. Idempotent finalize.
- Migration FK ordering: add nullable → backfill → enforce. No big-bang NOT NULL.
- Run `npm run build` (root + server) after each task; keep files < 1000 lines (extract libs/components per existing patterns: `sf5Composer.ts`, `teacherDashboardComposer.ts`).
- No comments unless asked; terse code; zod-validate every new endpoint; audit-log every state-changing action.

## Final Verification Checklist

- [ ] Builds + lint pass (root & server) after every task
- [ ] T1: no hardcoded SY fallbacks outside tests; single grade-level constant
- [ ] T2: term-level and year-level locks independently enforceable; admin UI works
- [ ] T3: finalize idempotent; snapshots written before status; DRAFT blocks; G10 completer edge cases documented and correct
- [ ] T4: unfinalized rollover → lock-and-alert (no archive); finalized → clean archive; concurrent sync safe
- [ ] T5: SF10/SF5 historical reads survive rollover; current views exclude old year
- [ ] T6: year backup exports and matches DB counts
- [ ] T7: teacher login lock engages/releases correctly; admin/registrar unaffected
- [ ] T8: sync-grades authenticated; contract doc updated; EnrollPro team informed
- [ ] Existing tests (`server/src/__tests__/`) still pass; add tests for promotion rules + lock enforcement + rollover guardrail (follow `sf10-snapshot.test.ts` live-server pattern)
- [ ] Full flow demo: grade entry → T1 lock → T2/T3 still editable → finalize → snapshot+promotion → EnrollPro pull → rollover (both branches) → new year grading
