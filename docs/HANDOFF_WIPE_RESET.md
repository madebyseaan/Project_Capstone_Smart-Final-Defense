# HANDOFF: Stale-Data Remediation + Two-School Deployment Readiness

> **Document type:** Implementation handoff / work order.
> **Status:** PLANNING COMPLETE — no code has been written yet. You (the implementer) will build everything in this doc.
> **Related docs:** `docs/WIPE_RESET_DEPLOYMENT_PLAN.md` (the investigation that produced this plan — read it first).
> **Repo:** `C:\Users\Sean\Desktop\SMART_FINAL_CAPSTONE` — read `AGENTS.md` before touching anything.

---

## 0. MISSION

SMART (this repo) is a read-only mirror of an external system called **EnrollPro** (with a secondary source **ATLAS**). The team manually wiped the database for a "fresh rollover" (4 cohorts, Grades 7–10). After the wipe, the next sync re-imported stale data: **same school-year label, wrong students, plus unexpected user accounts.**

Root cause (already investigated, confirmed):
1. SMART never deletes — sync **upserts** whatever EnrollPro returns. Wiping SMART does not wipe EnrollPro, so everything EnrollPro still serves comes back.
2. The manual wipe was **partial** (some tables cleared, others missed) → orphaned `Student` rows re-linked to new enrollments → "same year, different students."
3. Teachers are auto-recreated with `User` accounts on every sync (`enrollproSync.ts:274`) → "new accounts."
4. **Hardcoded fallback IDs** silently point at the wrong school year if env vars are unset: `ENROLLPRO_SCHOOL_YEAR_ID` defaults to `'38'`, `ATLAS_SCHOOL_ID` defaults to `'1'`, `ATLAS_SCHOOL_YEAR_ID` defaults to `'3'`.

The team will deploy SMART to **2 schools**, each deployment will start from a wiped DB. Your job: make wipe → re-sync → verify a **safe, repeatable, one-command process** and eliminate every silent wrong-source failure mode.

**Deliverables (6 tasks):**
1. Fail-fast environment guards (kill the hardcoded defaults).
2. `db:wipe` CLI script (FK-safe full reset).
3. Post-sync verification report (lib + admin endpoint).
4. Orphan/stale data detection report (detects exactly the incident's symptom).
5. `.env.example` per-school template + deployment runbook.
6. Tests + build verification.

---

## 1. GROUND TRUTH — FACTS YOU MUST NOT REDISCOVER

### 1.1 The sync pipeline (who writes what)

| File | Role |
|---|---|
| `server/src/lib/enrollproSync.ts` | Master EnrollPro sync. Upserts Teachers (by `employeeId`, creates `User` accounts), Sections, Students (by `lrn`), Enrollments, Subjects. **Deactivates teachers missing from EnrollPro (lines ~298–335) but NEVER prunes students.** |
| `server/src/lib/atlasSync.ts` | ATLAS sync. Creates Subjects, ClassAssignments, ScheduleEntries, Advisory links. Uses `ATLAS_SCHOOL_ID`, `ATLAS_SCHOOL_YEAR_ID`. |
| `server/src/lib/syncCoordinator.ts` | Scheduler that runs both syncs every N minutes. Exports `startUnifiedSyncScheduler()`, `stopUnifiedSyncScheduler()`, `runUnifiedSync()`, `getUnifiedSyncStatus()`. Started from `index.ts:209`. |
| `server/src/lib/enrollproClient.ts` | EnrollPro HTTP client. Credentials resolve **DB-first, env-fallback** (lines 49–66: `SystemSettings.enrollpro*` → `process.env.ENROLLPRO_*`). School year fallback `?? '38'` at **line 443**. |
| `server/src/lib/sync/httpClient.ts` | ATLAS HTTP client. `ATLAS_SCHOOL_ID ?? '1'` at **line 141**, `ATLAS_SCHOOL_YEAR_ID ?? '3'` at **line 171**. |
| `server/src/lib/teacherSync.ts` | Teacher login-time sync. Second hardcoded `ENROLLPRO_SCHOOL_YEAR_ID ?? '38'` at **line 50**. |
| `server/src/lib/syncCache.ts` | In-memory TTL cache (5 min). NOT a stale-data source — cleared on restart. Exposes `invalidateAllCaches()`. |
| `server/src/lib/schoolYearResolver.ts` | Resolves current year live from EnrollPro; triggers `handleYearChangeRollover`. |
| `server/src/lib/rollover.ts` | Year rollover. **Only archives (sets flags) — never deletes.** |

### 1.2 Key schema facts (`server/prisma/schema.prisma`)

- `Student.lrn` — **globally unique** (line 66). This is why partial wipes poison future syncs.
- `Section` unique on `([name, gradeLevel, schoolYear])` (line 117).
- `Enrollment` unique on `([studentId, sectionId, schoolYear])` (line 208).
- `ClassAssignment` unique on `([teacherId, subjectId, sectionId, schoolYear])` (line 159).
- `Teacher` — `userId` unique, `employeeId` unique; `Teacher→User` is **Cascade**.
- `GradeSnapshot` — **no FK relations at all** (plain string columns). Safe to bulk delete anytime.
- `AuditLog.userId`, `ExcelTemplate.uploadedBy`, `GradeEditRequest.teacherId` — relations to `User` **without cascade** (Prisma default: SetNull for optional, Restrict for required). You MUST delete these tables' rows before deleting `User` rows or the wipe will fail on FK constraints.
- `SystemSettings` is a singleton row `id: "main"` holding `currentSchoolYear`, `schoolYearId` FK, EnrollPro credentials, and all term/lock config.
- `YearGradeLock` / `TermGradeLock` cascade from `SchoolYear`.

### 1.3 FK-safe deletion order (derived from schema — use exactly this)

Leaf tables first, roots last:

```
1.  Attendance          (FK → Student, Section)
2.  Grade               (FK → ClassAssignment, Student; finalizedBy → User, no cascade)
3.  GradeSnapshot       (no FKs)
4.  GradeEditRequest    (FK → User ×2, no cascade)
5.  WorkloadEntry       (FK → Teacher, Section, ClassAssignment)
6.  ScheduleEntry       (FK → Teacher, Subject, Section)
7.  Enrollment          (FK → Student, Section)
8.  ClassAssignment     (FK → Teacher, Subject, Section)
9.  RefreshToken        (FK → User, cascade — delete anyway for speed)
10. Teacher             (FK → User, cascade)
11. Section
12. Subject
13. Student
14. YearGradeLock       (cascade from SchoolYear — delete explicitly anyway)
15. TermGradeLock
16. SchoolYear
17. SyncHistory        (no FKs)
18. AuditLog           (FK → User, no cascade)
19. ExcelTemplate      (FK → User, no cascade)  ← keep by default, see flags
20. User               (root)
```

**Config tables — DO NOT delete:** `SystemSettings` (reset selected fields instead), `GradingConfig`, `TransmutationEntry` (auto-reseeded on startup by `autoSeedTransmutationTable()` in `index.ts:133`).

### 1.4 Conventions (from AGENTS.md — non-negotiable)

- Backend: routes thin, business logic in `server/src/lib/` and `services/`. Centralized errors. Zod for input validation.
- TypeScript strict, no `any` where avoidable, async/await.
- **Max 1000 lines per file.**
- **NEVER modify `.env` or `.env.*`** (creating `.env.example` is allowed — it is a new file, not a modification of `.env`).
- **NEVER write to EnrollPro/ATLAS** — integrations are read-only.
- Frontend is `src/`, backend is `server/src/`.
- Match existing file header-comment style (see any file in `server/src/lib/`).
- Always finish with `npm run build` in BOTH root and `server/`.

### 1.5 Test infrastructure

- Vitest (`server/package.json` → `"test": "vitest run"`), config at `server/vitest.config.ts`.
- Existing patterns to copy:
  - `server/src/__tests__/rollover-lib.test.ts` — direct function tests against the real DB with cleanup in `beforeEach`/`afterEach`.
  - `server/src/__tests__/rollover.test.ts` — route-level tests using `fetch` against a running server (`BASE` constant).
- Tests hit the **real PostgreSQL** DB (no testcontainers). Clean up after yourself — stale test rows poison future runs (this is literally the bug class you're fixing).

---

## 2. TASK 1 — FAIL-FAST ENV GUARDS (kill the hardcoded defaults)

**Priority: HIGH. This is the silent-wrong-year failure mode. Do this first.**

### 2.1 Problem

| File:Line | Current code | Danger |
|---|---|---|
| `server/src/lib/enrollproClient.ts:443` | `parseInt(process.env.ENROLLPRO_SCHOOL_YEAR_ID ?? '38', 10)` | Unset env → silently syncs EnrollPro year 38 (possibly another school's / last year's cohort). |
| `server/src/lib/teacherSync.ts:50` | `parseInt(process.env.ENROLLPRO_SCHOOL_YEAR_ID ?? '38', 10)` | Same. |
| `server/src/lib/sync/httpClient.ts:141` | `Number(process.env.ATLAS_SCHOOL_ID ?? '1')` | Unset env → silently syncs ATLAS school 1. |
| `server/src/lib/sync/httpClient.ts:171` | `parseInt(process.env.ATLAS_SCHOOL_YEAR_ID ?? '3', 10)` | Unset env → silently syncs ATLAS year 3. |

### 2.2 Required behavior

- **Development** (`NODE_ENV !== 'production'`): keep current fallback behavior BUT log a loud one-time warning: `[CONFIG] ENROLLPRO_SCHOOL_YEAR_ID not set — using dev default 38. NEVER do this in production.`
- **Production** (`NODE_ENV === 'production'`): if any of the four vars is unset → **throw** at first use (do not crash startup for vars only used lazily; throw inside the resolver functions where they're read). Error message must name the missing var and the remedy.

### 2.3 Implementation spec

1. Create `server/src/config/schoolEnv.ts`:
   ```ts
   export function getEnrollProSchoolYearId(): number      // reads ENROLLPRO_SCHOOL_YEAR_ID
   export function getAtlasSchoolId(): number              // reads ATLAS_SCHOOL_ID
   export function getAtlasSchoolYearId(): number          // reads ATLAS_SCHOOL_YEAR_ID
   ```
   Each function: parse env → if missing: dev mode → warn-once (module-level `Set` of warned keys) + return legacy default (`38` / `1` / `3`); prod mode → `throw new Error("[FATAL] ...")`.
   Reuse `isProduction()` from `server/src/config/env.ts`.
2. Replace the four hardcoded reads (2.1 table) with calls to these helpers.
3. Extend `validateEnv()` in `server/src/config/env.ts`: in production, if any of the 4 vars is missing, `console.error` a clear table of ALL missing school-scoped vars and `process.exit(1)` at startup (startup check is fine for these — they're needed within minutes of boot).
4. Add the 4 vars to the Task 5 `.env.example` with per-school comments.

### 2.4 Acceptance criteria

- `grep -rn "?? '38'" server/src` and `grep -rn "?? '1'" server/src/lib/sync` return nothing (all replaced by helpers).
- With `NODE_ENV=production` and vars unset: server exits at startup with a message naming every missing var.
- With `NODE_ENV=development` and vars unset: server boots, syncs still work (defaults applied), warning logged once.
- `cd server && npm run build` passes.

---

## 3. TASK 2 — `db:wipe` CLI SCRIPT (safe full reset)

**Priority: HIGH. This replaces the manual partial wipes that caused the incident.**

### 3.1 Requirements

- New file: `server/scripts/wipe.ts` (note: `server/scripts/` already exists — `generate-dbdiogram-dbml.ts` lives there; copy its import/bootstrap style).
- New npm script in `server/package.json`: `"db:wipe": "ts-node scripts/wipe.ts"`.
- Runs **offline-safe**: the script must NOT call any external API. It only clears the local DB.
- Wrap the entire wipe in **one `prisma.$transaction`** with the exact deletion order from §1.3. Use `deleteMany` per table in that order. After deletes, run count-verification inside the same transaction (all domain tables must be 0) — abort (throw) if any count > 0.
- **Post-wipe reset of `SystemSettings`** (NOT deletion — it's referenced everywhere):
  ```ts
  await tx.systemSettings.update({
    where: { id: "main" },
    data: {
      currentSchoolYear: "UNSET",   // forces schoolYearResolver to re-resolve from EnrollPro
      schoolYearId: null,
      currentTerm: "T1",
      gradeLock: false,
      transitionLock: false,
      lastEnrollProSync: null,
      // KEEP: schoolName, branding, credentials (enrollproUrl/AccountName/Password/IntegrationKey),
      //       retention policies, term dates (they get refreshed by resolveCurrentTerm)
    },
  });
  ```
  ⚠️ Verify enum value: `currentSchoolYear` is a plain `String` — `"UNSET"` is fine. `currentTerm` is enum `Term` → `"T1"`.
- **Production safety gate:** if `NODE_ENV === 'production'`, require the literal flag `--i-know-this-wipes-production` (exact string) plus an interactive-free confirmation: env var `WIPE_CONFIRM=yes`. If either is missing → print refusal + what would have been wiped → exit 1. No exceptions.
- **Flags:**
  - `--keep-templates` (DEFAULT ON): skip `ExcelTemplate` deletion (school form templates are re-uploadable config; wiping them silently breaks the Print Center). Counterpart `--wipe-templates` to include them.
  - `--keep-users`: skip `User` + `Teacher` + `RefreshToken` deletion entirely (for "reset student data, keep logins" scenarios). When used, `AuditLog`/`GradeEditRequest`/`ExcelTemplate` rows referencing users survive automatically (they'd FK-fail otherwise — handle by also skipping their deletion OR nulling FKs; choose: skip deletion, simpler and auditable).
  - `--dry-run`: print what would be deleted (per-table counts via `count()`) and exit without touching anything.
- **Before deleting:** snapshot pre-wipe counts per table and print them (this doubles as the incident-forensics record).
- **After committing:** call `invalidateAllCaches()` from `lib/syncCache.ts` (harmless in CLI, correctness if ever imported) and print next-step instructions:
  ```
  [wipe] Done. Next steps:
    1. Verify server/.env school-scoped vars (ENROLLPRO_SCHOOL_YEAR_ID, ATLAS_SCHOOL_ID, ATLAS_SCHOOL_YEAR_ID)
    2. Start the server (scheduler will auto-sync) OR POST /api/sync/... for immediate sync
    3. Run the sync verification report (Task 3) and confirm zero anomalies
  ```
- Exit code 0 on success, 1 on any failure.

### 3.2 What the script must look like (structure)

```
wipe.ts
├── parseArgs()              // --dry-run, --keep-users, --wipe-templates, --i-know-this-wipes-production
├── guardProduction()        // NODE_ENV + confirmation gate
├── collectCounts()          // per-table counts (printed pre-wipe)
├── WIPE_ORDER               // const array from §1.3 (single source of truth)
├── runWipe(tx)              // deleteMany loop + SystemSettings reset + count verification
└── main()                   // transaction wrapper, logging, exit codes
```

### 3.3 Acceptance criteria

- `npm run db:wipe -- --dry-run` on the current (dirty) DB prints counts, changes nothing.
- Full wipe on a seeded dev DB → every domain table count 0; `SystemSettings` still exists with `currentSchoolYear: "UNSET"`, credentials preserved; `GradingConfig`/`TransmutationEntry` untouched.
- Running it twice in a row succeeds (idempotent).
- `--keep-users` run leaves `User`/`Teacher`/`RefreshToken`/`AuditLog`/`GradeEditRequest`/`ExcelTemplate` intact, everything else empty.
- In prod mode without the confirmation flags → refuses, exits 1, deletes nothing.
- Unit test (see Task 6): seed → wipe → assert counts.

---

## 4. TASK 3 — POST-SYNC VERIFICATION REPORT

**Priority: HIGH. This is the tripwire that would have caught the incident at deploy time.**

### 4.1 Requirements

- New file: `server/src/lib/syncVerification.ts` (business logic — keep the route thin, per AGENTS.md).
- Exported function:
  ```ts
  export interface SyncVerificationReport {
    generatedAt: string;
    activeSchoolYear: string | null;          // from schoolYearResolver
    ok: boolean;                               // true iff zero anomalies
    anomalies: SyncAnomaly[];
    metrics: {
      dbStudents: number;      epStudents: number;
      dbSections: number;      epSections: number;
      dbTeachers: number;      epTeachers: number;
      dbEnrollmentsByYear: Record<string, number>;   // key = schoolYear label — catches "two cohorts under different labels"
      epEnrollments: number;
    };
  }
  export interface SyncAnomaly {
    code: string;          // machine-readable, see 4.2
    severity: "INFO" | "WARNING" | "CRITICAL";
    message: string;
    detail?: unknown;
  }
  export async function buildSyncVerificationReport(): Promise<SyncVerificationReport>
  ```
- Data sources: DB via prisma; EnrollPro via existing client functions in `enrollproClient.ts` (reuse `getEnrollProTeachers()`, section/learner fetchers — find the exact exports used by `enrollproSync.ts`). **Read-only.** If EnrollPro is unreachable, return a report with a single `WARNING` anomaly `"ENROLLPRO_UNREACHABLE"` and `ok: false` (never crash).
- After a wipe+fresh sync, this report must be able to answer: *"Is the DB a faithful mirror of EnrollPro for the current year?"*

### 4.2 Anomaly codes to implement (the incident's fingerprints)

| Code | Severity | Trigger |
|---|---|---|
| `STUDENT_COUNT_MISMATCH` | CRITICAL | `dbStudents` (with enrollment in active year) != `epStudents` for the active year. |
| `MULTIPLE_YEARS_IN_ENROLLMENTS` | WARNING | `dbEnrollmentsByYear` has >1 key (expected exactly 1 right after a wipe+resync). |
| `TEACHER_COUNT_MISMATCH` | WARNING | DB active teachers != EnrollPro faculty count. |
| `UNEXPECTED_USER_ACCOUNTS` | CRITICAL | `User` rows with `role=TEACHER` but no `Teacher` row, or `Teacher` rows whose `employeeId` is absent from EnrollPro's current faculty (these are the "new accounts" from the incident). |
| `ORPHAN_STUDENTS` | WARNING | `Student` rows with zero `Enrollment` rows (partial-wipe residue — see Task 4). |
| `SECTION_ENROLLMENT_MISMATCH` | WARNING | Any section whose DB enrollment count != EnrollPro's count for that section. |
| `ENROLLPRO_UNREACHABLE` | WARNING | Client threw. |

`ok === (anomalies.filter(a => a.severity !== "INFO").length === 0)`.

### 4.3 Admin endpoint

- In `server/src/routes/admin-sub/system.ts` (follow the existing `router.get("/rollover-status", authenticateToken, requireAdmin, ...)` pattern at line 347):
  ```
  GET /api/admin/sync-verification
  ```
  → `res.json(report)`. Wrap in try/catch like every other route there; 500 with message on unexpected error. Zod-validate nothing (GET, no params) but keep the handler thin — all logic lives in the lib.
- Also record a `SyncHistory` row? **No** — verification is read-only; don't pollute sync history.

### 4.4 Frontend (minimal, optional — only if time permits)

- Add a "Sync Verification" card/section to `src/pages/admin/SystemHealth.tsx` that fetches the endpoint and renders anomalies with severity colors. Keep it a simple list — no charts. Use existing React Query patterns from neighboring admin pages. **If frontend work risks scope, skip it — the endpoint returning JSON is the deliverable.**

### 4.5 Acceptance criteria

- After a clean wipe + successful sync on consistent data: `ok: true`, no anomalies.
- Seeded mismatch test (Task 6): injected extra student / extra TEACHER user / second-year enrollment each produce the matching anomaly code.
- Endpoint requires admin JWT (403 otherwise).

---

## 5. TASK 4 — ORPHAN / STALE DATA DETECTION (integrated into Task 3 + a standalone checker)

**Priority: MEDIUM-HIGH. This diagnoses the CURRENT dirty DB without wiping it.**

### 5.1 Requirements

- Add to `syncVerification.ts` a second export:
  ```ts
  export async function findOrphanedData(): Promise<OrphanReport>
  // OrphanReport: {
  //   orphanStudents: { id, lrn, name, lastEnrollmentYear: string | null }[],
  //   staleEnrollmentYears: string[],            // year labels != active year
  //   usersWithoutTeacherProfile: { id, username, role, createdAt }[],
  //   teachersMissingFromEnrollPro: { employeeId, name }[],
  // }
  ```
- SQL shapes (Prisma equivalents):
  - Orphan students: `Student` where `NOT EXISTS (Enrollment)` — also include students whose only enrollments are in non-active year labels (that's "stale," not strictly orphan; put them in the same list with `lastEnrollmentYear` populated).
  - `usersWithoutTeacherProfile`: `User.role = TEACHER` with no `Teacher` row.
  - `teachersMissingFromEnrollPro`: `Teacher` rows whose `employeeId` ∉ current EnrollPro faculty list.
- **DO NOT auto-delete anything.** Read-only. The remedy for orphans is: run `db:wipe` + resync (clean), not surgical deletes. This is a deliberate decision — surgical pruning of students is risky because `Student.lrn` history feeds SF10/registrar historical forms; wiping is the sanctioned operation at deployment time.

### 5.2 Wire into Task 3

`buildSyncVerificationReport()` should internally call `findOrphanedData()` and surface counts in `anomalies` (`ORPHAN_STUDENTS`, `UNEXPECTED_USER_ACCOUNTS`, `TEACHER_COUNT_MISMATCH` as specced).

### 5.3 Acceptance criteria

- Running the checker against the **current dirty DB** (after the team's manual wipe) produces a non-empty report — this is literally the incident diagnosis tool. Capture its output and paste it into the PR description as evidence.
- Zero false positives on a clean post-wipe DB.

---

## 6. TASK 5 — `.env.example` + DEPLOYMENT RUNBOOK (2 schools)

**Priority: HIGH for docs, trivial effort.**

### 6.1 `server/.env.example` (NEW file — allowed; do not touch `.env`)

Document every var, grouped, with the 2-school warnings. Minimum content (verify against actual usage via `grep -rn "process.env" server/src`):

```
# ── Core (REQUIRED) ─────────────────────────────
JWT_SECRET=            # 64+ hex chars: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
DATABASE_URL=          # per-school PostgreSQL instance
CSRF_SECRET=
PORT=5003
NODE_ENV=production

# ── School-scoped (REQUIRED IN PRODUCTION — server refuses to start without these) ──
# ⚠️ Each school deployment MUST set these to ITS OWN values. Wrong values = wrong students silently synced.
ENROLLPRO_SCHOOL_YEAR_ID=      # numeric EnrollPro year id for THIS school's current year
ENROLLPRO_SCHOOL_YEAR_LABEL=   # e.g. 2026-2027
ATLAS_SCHOOL_ID=               # THIS school's ATLAS id (do not leave as 1)
ATLAS_SCHOOL_YEAR_ID=          # THIS school's ATLAS year id (do not leave as 3)

# ── EnrollPro connection (can also be set via Admin > System Settings — DB wins) ──
ENROLLPRO_URL=
ENROLLPRO_ACCOUNT_NAME=
ENROLLPRO_PASSWORD=
ENROLLPRO_INTEGRATION_KEY=
ENROLLPRO_DELTA_SYNC_ENABLED=

# ── ATLAS ────────────────────────────────────────
ATLAS_URL=
ATLAS_SYSTEM_TOKEN=

# ── Sync tuning (optional) ──────────────────────
SYNC_CACHE_TTL_MS=300000
CORS_ORIGIN=https://school-a.example.edu.ph

# ── Bootstrap (optional) ────────────────────────
CREATE_DEV_ACCOUNT=   # leave UNSET in production
```

### 6.2 `docs/DEPLOYMENT_RUNBOOK.md` (NEW file)

Step-by-step, per school. Content outline:

1. **Pre-flight (per school):** collect EnrollPro URL/credentials/year id, ATLAS school id/year id/token, domain name, DB credentials. Provision isolated PostgreSQL DB.
2. **Deploy:** build (`npm run build` root + server), set `.env` (from `.env.example`), run migrations (`npx prisma migrate deploy`), start server.
3. **First-run sequence:** server boots (env guards from Task 1 confirm school vars) → scheduler syncs (or trigger manual sync via admin UI) → run Task 3 verification (`GET /api/admin/sync-verification`) → **`ok: true` required before go-live**. If not ok → diagnose with Task 4 report → if contaminated: `npm run db:wipe -- --i-know-this-wipes-production` (+ `WIPE_CONFIRM=yes`) → resync → re-verify.
4. **Mid-year reset procedure (the "fresh rollover" case):** ① fix EnrollPro first (it's the source of truth — SMART cannot write to it), ② `db:wipe` with prod flags, ③ restart server, ④ verify. **Never wipe per-table manually — that's what caused the incident.**
5. **Two-school topology:** two fully isolated stacks (own server, own DB, own `.env`, own domain). The schema is single-tenant (no `schoolId` on any model) — NEVER point two deployments at one DB or one EnrollPro account.
6. **Rollback:** redeploy previous build; DB rollback is NOT scripted (documented risk — DB backups are the school's ops responsibility; recommend pg_dump before each wipe).

### 6.3 Acceptance criteria

- `.env.example` documents every var found by `grep -rn "process.env\." server/src --include="*.ts" -o | sort -u` (do that grep, close any gaps in the list above).
- Runbook is executable by a non-author following it literally.

---

## 7. TASK 6 — TESTS + BUILD VERIFICATION

### 7.1 New test files (in `server/src/__tests__/`, vitest, follow `rollover-lib.test.ts` style)

1. **`wipe.test.ts`** — seed minimal fixture (1 SchoolYear, 1 Section, 1 Subject, 1 Teacher+User, 1 Student, 1 Enrollment, 1 Grade, 1 GradeSnapshot, 1 Attendance, 1 AuditLog) → run the wipe core (export the transaction function from `scripts/wipe.ts` or move it to `server/src/lib/wipe.ts` and have the script call it — **preferred: logic in `lib/`, script is a thin CLI wrapper**, per AGENTS.md) → assert all domain tables count 0, `SystemSettings.currentSchoolYear === "UNSET"`, credentials preserved, `TransmutationEntry` untouched. Test `--keep-users` variant. Test production-refusal path (set `NODE_ENV=production` in test env, call guard, expect exit/throw).
2. **`syncVerification.test.ts`** — seed a deliberately inconsistent DB (extra orphan Student; a `User(role=TEACHER)` with no Teacher; an Enrollment with a second year label) → assert `buildSyncVerificationReport()` returns exactly the anomaly codes `ORPHAN_STUDENTS`, `UNEXPECTED_USER_ACCOUNTS`, `MULTIPLE_YEARS_IN_ENROLLMENTS`, `ok === false`. Then clean the seeded anomalies → `ok === true` (this half may need EnrollPro reachable — if CI/offline, mock the client module with `vi.mock` for the EnrollPro-dependent counts and mark the DB-only anomalies as the unmocked assertions).
3. **`schoolEnv.test.ts`** — helper returns defaults + warns in dev; throws in prod (`process.env.NODE_ENV` stubbed per test, restore after).

### 7.2 Cleanup discipline

Every test file: `beforeEach`/`afterEach` deletes only rows it created (scoped `where` clauses — see `rollover-lib.test.ts:141-151`). Never truncate tables wholesale in tests.

### 7.3 Definition of done (run in this order, all must pass)

```bash
cd server && npx prisma generate
cd server && npm test
cd server && npm run build
cd .. && npm run lint
cd .. && npm run build
```

Plus: `grep -rn "?? '38'" server/src` → empty; manual `--dry-run` wipe output pasted in PR; verification report against current dirty DB pasted in PR.

---

## 8. EXECUTION ORDER & EFFORT

| Order | Task | Est. | Depends on |
|---|---|---|---|
| 1 | Task 1 (env guards) | small | — |
| 2 | Task 2 (wipe script) | medium | — |
| 3 | Task 4 (orphan detection lib) | medium | — |
| 4 | Task 3 (verification report + endpoint) | medium | Task 4 |
| 5 | Task 5 (env example + runbook) | small | Tasks 1–3 (references them) |
| 6 | Task 6 (tests + builds) | medium | all |

Tasks 1 and 2 are independent — can be parallelized.

## 9. OUT OF SCOPE (do NOT do)

- No multi-tenancy refactor (`schoolId` columns) — two isolated deployments is the chosen topology.
- No student auto-pruning during sync — orphans are detected (Task 4) and cured by wipe+resync, not surgically deleted.
- No changes to EnrollPro/ATLAS clients beyond the school-year-id reads in Task 1.
- No frontend work beyond the optional SystemHealth card in §4.4.
- No touching `.env`, `.env.*`, or credentials.
- No commits unless the operator explicitly asks.
