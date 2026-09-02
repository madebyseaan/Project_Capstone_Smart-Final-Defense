# Plan: Remove Hardcoded Seed Data + Term-by-Term Grade Seeding for Rollover Testing

Status: PLANNED — not yet implemented
Date: 2026-09-01

## Goal

1. Remove all stale/hardcoded demo data from seeds (fake teachers, Section Diamond, 45 fake students, fake subjects, dev account `999999`/`dev123`). EnrollPro/ATLAS sync is the source of truth and already populates real data.
2. Add a new grade seeder that auto-detects **only sections that currently have enrolled learners**, and seeds grades for **ONE term at a time** (T1, then T2, then T3) so rollover and term-lock flows can be tested incrementally.
3. Fix remaining hardcoded-data leaks found during audit (wipe.sql, dead dev-account code, stale docs).

---

## Context (verified during research)

- No runtime code (`src/` or `server/src/`) references: Section "Diamond", usernames `teacher1`-`teacher5`, seed subjects MATH7/SCI7/ENG7/FIL7/AP7, employeeIds `EMP-T01`..`EMP-T05`, LRN prefix `1225167`, or the dev account `999999`/`dev123`/`Dev Sean Roma`. Removing seed data breaks NOTHING at runtime.
- Server startup auto-seeds the 41 DepEd transmutation entries independently (`server/src/index.ts:133-189`) — seed.ts does NOT need to seed them.
- EnrollPro-synced teachers log in with `username = employeeId` and default password `DEFAULT_SYNC_PASSWORD` env var, fallback `password123` (`server/src/lib/enrollproSync.ts:213`).
- Active school year resolution (`server/src/lib/schoolYearResolver.ts`): `SystemSettings.schoolYearId` FK -> SchoolYear record -> label string; throws loudly if missing (by design). First EnrollPro sync creates/links it via `ensureSchoolYearFromEnrollPro()`.
- Year rollover (`server/src/lib/rollover.ts`): triggered automatically when EnrollPro sync links a NEW school year. Archives only if ALL sections are EOSY-finalized; otherwise `locked_not_archived`.
- Grade locking precedence (from AGENTS.md + `gradeLocks.ts`): archived -> year lock -> term lock -> legacy system-wide `gradeLock`. An APPROVED GradeEditRequest bypasses TERM lock only.
- Rollover preconditions (`rollover.ts:56-95`): EOSY snapshots must exist for all FINALIZED grades (snapshot-gap check), and `listUnfinalizedSections()` must return empty (no DRAFT-grade blockers, every enrolled student must have a `promotionStatus`). Registrar EOSY finalize (`POST /api/registrar/eosy/finalize`) sets both.
- Term grade uniqueness: `@@unique([studentId, classAssignmentId, term])` on Grade — upsert-friendly.
- `server/scripts/wipe.ts` (the `db:wipe` command) already preserves school identity in SystemSettings; it does NOT depend on seed data.

---

## Task 1: Rewrite `server/prisma/seed.ts` (bootstrap-only)

Rewrite the file to contain ONLY:

1. Table cleanup (keep existing deleteMany order — respects FK constraints)
2. Admin user: username `admin`, password `AdminPassword123!`, role ADMIN, email `admin@school.edu.ph`
3. Registrar user: username `registrar`, password `RegistrarPassword123!`, role REGISTRAR, email `registrar@school.edu.ph`
4. SystemSettings upsert `id: "main"` with:
   - schoolName: `Hinigaran National High School`, schoolId: `300847`, division: `Division of Negros Occidental`, region: `Region VI - Western Visayas` (real school identity; needed by SF forms; `enrollproBrandingSync.ts:124` only overwrites schoolName)
   - `currentSchoolYear: ""` (explicitly empty — do NOT rely on the schema column default which is stale `2025-2026`; EnrollPro sync sets the real year on first sync)
   - `currentTerm: T1` (will be overwritten live from EnrollPro via `resolveCurrentTerm()`)
   - `schoolYearId: null` (set by `ensureSchoolYearFromEnrollPro` on first sync)

DELETE from seed.ts:
- Dev user `999999` / `dev123` / "Dev Sean Roma" / devTeacher / devTeacher class assignment (lines 41-62, 174-183)
- 5 fake teachers `teachersData` + creation loop (lines 90-121)
- Section "Diamond" + advisory (lines 123-133)
- 5 hardcoded subjects + creation loop (lines 135-158)
- Class assignments loop (lines 160-172)
- 45 students + enrollments + firstNames/lastNames arrays (lines 185-229)
- Transmutation table seeding (lines 247-303) — server auto-seeds at startup

Do NOT add comments beyond what exists; keep file structure/style of current seed.

---

## Task 2: New `server/prisma/seed-grades-term.ts`

Single-term grade seeder. CLI contract:

```
npx ts-node prisma/seed-grades-term.ts <T1|T2|T3> [flags]

Flags:
  --finalized    Set status=FINALIZED, finalizedAt=now, finalizedBy=admin user id (default: DRAFT)
  --section "Name"   Restrict to one section by name (optional)
  --clear        Delete existing grades+snapshots for this term/school year first
  --dry-run      Print what would be seeded, write nothing
```

### Requirements

1. **School year resolution (no hardcoding):**
   - Read `SystemSettings` (`id: "main"`), use `schoolYearId` FK to get active SchoolYear label
   - If FK is null or no SystemSettings row: exit with error `"No active school year. Run EnrollPro sync first (start the server or POST /api/sync/all)."`
   - NEVER fall back to a hardcoded year string

2. **Auto-detect sections with learners (core requirement):**
   - `prisma.section.findMany({ where: { schoolYear: <active label> } })`
   - For each section, load enrollments: `where: { sectionId, status: "ENROLLED", isArchived: false }`
   - **Skip sections with 0 enrolled learners** — log: `Skipping <gradeLevel> <name>: no enrolled learners`
   - Load active class assignments: `where: { sectionId, schoolYear: <label>, isActive: true }` (historical isActive rule: current-year seeding IS operational, so isActive filter is correct here)
   - Skip sections with 0 assignments — log reason
   - With `--section`, only process the matching section (error if not found)

3. **Grade generation — reuse math from `seed-grades-fresh.ts` (before deleting it, port these):**
   - `transmute()` DepEd table, `findInitialGradeForTarget()`, `calculateGrades()`, `genWW()`, `genPT()`, `buildGradeForTarget()`
   - Performance tiers + `TIER_QG` targets (per-term values: index 0=T1, 1=T2, 2=T3) and realistic distribution
   - Per-subject weights: `subject.writtenWorkWeight ?? 20`, `perfTaskWeight ?? 50`, `quarterlyAssessWeight ?? 30`
   - Rotation subjects (`rotationTermGroupId !== null`): still generate the requested term normally
   - HG subjects (`code.startsWith("HG")`): null scores + qualitativeDescriptor only
   - Deterministic per-student tier assignment (sorted by lastName, firstName; seeded RNG)

4. **Upsert** on `studentId_classAssignmentId_term` — safe to re-run. Set all fields fresh-seed sets: scores, PS values, initialGrade, quarterlyGrade, remarks (Passed/Failed by qg>=75), qualitativeDescriptor.

5. **GradeSnapshot:** create one per grade (same shape as fresh seed: gradeId, ids, subjectCode/Name, sectionId/Name, schoolYear, term, snapshot JSON).

6. **`--finalized`:** set `status: FINALIZED`, `finalizedAt: new Date()`, `finalizedBy: <admin user id>` — look up the admin user (`role: ADMIN`, username `admin`); error if missing. Default status stays DRAFT so the registrar finalize flow can be tested through the UI.

7. **`--clear`:** `prisma.grade.deleteMany({ where: { term, classAssignment: { schoolYear: label } } })` + matching GradeSnapshot delete (by schoolYear + term), before seeding.

8. **Summary output (console only, NO report file):** per-section students/assignments/grades seeded; totals; count of skipped sections.

9. Style: follow existing seed files — `import "dotenv/config"`, `PrismaPg` adapter from `DATABASE_URL`, `main().catch(...).finally(disconnect)`, explicit types, no `any` where avoidable, no comments unless necessary.

---

## Task 3: Delete stale files

- `server/prisma/seed-grades.ts` (hard-depends on Section Diamond — line 132 throws)
- `server/prisma/seed-grades-fresh.ts` (seeds all 3 terms at once — defeats term-by-term testing)
- `server/prisma/GRADE_SEED_REPORT.md`
- `server/prisma/GRADE_SEED_FRESH_REPORT.md`
- `server/scripts/wipe.sql` (re-inserts Hinigaran/`2025-2026`/T1 into SystemSettings — silently re-introduces stale identity; `db:wipe` uses `wipe.ts` instead, which correctly preserves identity)

---

## Task 4: `server/package.json` scripts

- Remove: `prisma:seed-grades`, `prisma:seed-fresh`
- Add: `"prisma:seed-term": "ts-node prisma/seed-grades-term.ts"`
- Keep `prisma:seed` (rewritten file) and the `prisma.seed` hook pointing at `prisma/seed.ts`
- Usage after change: `npm run prisma:seed-term -- T1 --finalized`

---

## Task 5: Hardcoded-data leak fixes

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 1 | Dead `shouldCreateDevAccount()` exported but never imported | `server/src/config/env.ts:79-81` | Delete the function |
| 2 | Stale `CREATE_DEV_ACCOUNT=` env var | `server/.env.example:55` | Delete the line |
| 3 | AGENTS.md file map lists `ensureDevAccount.ts` and `src/components/DevPortalSwitcher.tsx` — neither exists | `AGENTS.md` File Map section | Remove both entries; remove `prisma/seed.ts`-era entries if inaccurate (seed-grades files) |
| 4 | Schema column default `currentSchoolYear @default("2025-2026")` | `server/prisma/schema.prisma:409` | Optional (seed overrides it explicitly). If changed: requires migration — SKIP unless asked. Flagged for awareness only |

Do NOT touch `.env` (non-negotiable rule). `.env.example` edits are allowed.

---

## Rollover Test Workflow (after implementation)

1. Ensure DB is synced from EnrollPro/ATLAS (server running or `POST /api/sync/all`) — sections with learners + class assignments exist; SystemSettings has active school year
2. `npm run prisma:seed-term -- T1` (DRAFT) — then finalize via registrar UI (`POST /api/registrar/finalize-grades`) to test that flow, OR `--finalized` directly
3. Test T1: report cards, dashboards, term lock behavior, teacher edit-request flow
4. Advance term in EnrollPro → `resolveCurrentTerm()` picks up T2 → scheduler locks T1 on its end date
5. `npm run prisma:seed-term -- T2` → test; repeat for T3
6. **Registrar runs EOSY finalize per section** (`EOSYFinalization.tsx` / `POST /api/registrar/eosy/finalize`) — REQUIRED: sets `promotionStatus` on enrollments + creates `EOSY_FINALIZE` snapshots. Rollover aborts without these (snapshot-gap check + unfinalized-sections check in `rollover.ts:56-95`)
7. Advance school year in EnrollPro → next sync fires `handleYearChangeRollover` → previous year archived (grades/enrollments isArchived=true, sections COMPLETED, assignments deactivated, SchoolYear ARCHIVED)

---

## Acceptance Criteria / Verification

1. `cd server && npm run build` — zero type errors
2. `npm run lint` (root) — passes
3. `npx ts-node prisma/seed.ts` — creates only: 2 users (admin, registrar), 1 SystemSettings row; nothing else
4. `npx ts-node prisma/seed-grades-term.ts T1 --dry-run` — lists sections WITH learners, skips empty ones with logged reason, writes nothing
5. `npx ts-node prisma/seed-grades-term.ts T1 --finalized` — grades for exactly the detected sections/term; re-running is idempotent (upsert, counts unchanged)
6. Sections with learners but no class assignments are skipped with reason (no crash)
7. Running with no active school year (empty DB) exits with the sync-first error message
8. `grep -rn "Diamond\|teacher1\|EMP-T0\|dev123\|999999" server/prisma server/scripts` — no matches
9. `grep -rn "2025-2026" server/prisma server/scripts` — only schema.prisma column default remains (flagged, intentionally untouched)
10. Backend tests unaffected: direct-DB suites seed their own fixtures; HTTP suites skip without `SMART_TEST_*` env vars

## Out of Scope

- No changes to `.env` / `.env.*` values (only `.env.example` line deletion)
- No changes to rollover/promotion/gradeLocks logic
- No schema migration (column default left as-is)
- No frontend changes
