# Teacher Year Archives — Planning & Implementation

Status: IMPLEMENTED — G0–G8 evidence recorded (2026-11-11); pre-existing Playwright E-16 failure allowlisted
Scope: per-teacher, per-school-year compressed data snapshot for admin backup/download
Related: `docs/ROLLOVER_READINESS_PLAN.md`, `docs/ENROLLPRO_REMEDIAL_CONTRACT.md`

Locked decisions (2026-11-11):

- Storage: gzip-compressed `bytea` in `TeacherYearArchive` (DB-portable).
- Compression: gzip level 9 via Node `zlib` (no new dependency).
- Access: ADMIN only in v1.
- Backup: add `pg_dump -Fc` support and verify a restore before making it the default.
- Generation is fail-open for the year: archive outcome never depends on archive-bundle generation.
- Implementation is gated (see §12); no gate may be skipped and no new PM2 error may ship.

---

## 1. Summary

Create one compressed archive per **teacher × school year**. Archives are generated
automatically when a year is archived (manual archive or EnrollPro rollover), and can be
backfilled for years that were already archived before this feature existed.

Each archive is a single gzip-compressed JSON document containing that teacher's year:
class assignments, full grade rows, advisory attendance, roster/enrollment status,
schedule, workload, observed values, and edit requests. Admins can list, preview counts,
and download individual archives.

This feature is **record-keeping and convenience**. It is **not** a disaster-recovery
backup. Protecting the database (and these archives) from a hacked/deleted server is a
separate backup feature — see §12.

---

## 2. Goals / Non-goals

### Goals

- One archive per teacher per school year, generated automatically at archive time.
- Backfill existing archived years (`2022-2023` … `2025-2026` in the current DB).
- Keep storage small: gzip-compressed payload, lean scope, no duplicated snapshot data.
- Admin UI: filter by year, see coverage/status/size, download, regenerate missing.
- Idempotent: re-running generation never duplicates; failures are retryable.
- Preserve original IDs so a future restore/import is possible.

### Non-goals

- Replacing `pg_dump` or implementing automated/off-site backup.
- Restoring a bundle into live tables (future work; payload is designed to allow it).
- Storing Excel/XLSX as the archive format (generate on demand later if needed).
- Teacher-facing historical browsing (separate feature; see archived class records gap).
- Protecting against an attacker with full server/database control.

---

## 3. Current state

- Archiving is year-based soft freezing, not deletion: `server/src/lib/rollover.ts`.
- All archive paths share `archiveYearInTx` (`server/src/lib/rollover.ts:95`):
  - `POST /api/admin/archive-year` (`server/src/routes/admin-sub/system.ts:793`)
  - `PATCH /api/admin/school-years/:id` (`server/src/routes/admin-sub/classAssignments.ts:517`)
  - EnrollPro auto-rollover (`server/src/lib/rollover.ts:257`)
- Archive writes set `Grade.isArchived`, `Enrollment.isArchived`, `Section.COMPLETED`,
  `ClassAssignment.isActive=false`, `SchoolYear.ARCHIVED`, and enable the year lock.
- Existing year-level Excel export: `GET /api/registrar/export/year-backup`
  (`server/src/routes/registrar/exports.ts:542`) — sections, enrollments, grades,
  attendance only. No per-teacher archive.
- Database backup is manual: `server/scripts/backup.ts` (`pg_dump` plain SQL).
- Current DB years:

| Label | Status | Notes |
|---|---|---|
| 2022-2023 | ARCHIVED | Grades/assignments/enrollments exist |
| 2023-2024 | ARCHIVED | Grades/assignments/enrollments exist |
| 2024-2025 | ARCHIVED | Grades/assignments/enrollments exist |
| 2025-2026 | ARCHIVED | Grades/assignments/enrollments exist |
| 2026-2027 | ACTIVE | Attendance data exists only for this year in the current DB |

**Historical years can be backfilled** because archiving never deletes source rows.
Attendance before 2026-2027 is absent in the current DB, so those bundles will contain
zero attendance rows and a `dataQuality` warning. Production deployments that used
attendance in prior years will have those rows and they will be included.

---

## 4. Key decisions

| Decision | Choice |
|---|---|
| Granularity | One archive per teacher per school year |
| Trigger | Automatic after archive; backfill for already-archived years |
| Storage | **Locked:** gzip-compressed `Bytes` (`bytea`) in a new Prisma table |
| Payload scope | Lean: full grades, advisory attendance, roster identity; no raw AIMS/ECR, no full snapshot duplication |
| Compression | **Locked:** gzip level 9 (`zlib.gzipSync`) |
| Generation timing | Metadata rows created in the archive transaction; compression after commit |
| Failure behavior | **Fail-open for the year:** generation failure marks `FAILED`; the year stays archived and the archive is retried |
| Access | **Locked:** ADMIN only in v1; registrar read deferred |
| Backup dump | **Locked:** implement `pg_dump -Fc` variant, prove restore, then make it the default |
| Retention | Keep indefinitely; no automatic cleanup |
| Feature switch | `TEACHER_ARCHIVE_ENABLED` (default `true`); `false` disables generation only, never archive |

Uncompressed `Json`/`jsonb` storage is rejected: measured raw payloads would add roughly
150–400 MB per school year at production scale, versus ~10–15 MB gzipped.

---

## 5. Data model

Add to `server/prisma/schema.prisma` and create migration
`add_teacher_year_archives`.

```prisma
model TeacherYearArchive {
  id              String    @id @default(cuid())
  schoolYearId    String
  schoolYear      String    // label, denormalized for filtering/display
  teacherId       String    // no FK: archive must outlive Teacher/User rows
  teacherUserId   String?
  employeeId      String?
  teacherName     String
  status          String    @default("PENDING") // PENDING | COMPLETE | FAILED
  error           String?   // last failure, truncated
  schemaVersion   Int       @default(1)
  encoding        String    @default("gzip")    // gzip | br
  payload         Bytes?    // compressed JSON (PostgreSQL bytea)
  rawBytes        Int?
  compressedBytes Int?
  checksum        String?   // sha256 of uncompressed JSON
  stats           Json?     // counts for list UI (no payload read)
  dataQuality     Json?     // warnings/snapshot coverage
  source          String    @default("ROLLOVER") // ROLLOVER | MANUAL_ARCHIVE | BACKFILL
  createdBy       String?   // admin id or "system"
  createdAt       DateTime  @default(now())
  completedAt     DateTime?
  updatedAt       DateTime  @updatedAt

  schoolYearRef SchoolYear @relation(fields: [schoolYearId], references: [id], onDelete: Cascade)

  @@unique([schoolYearId, teacherId])
  @@index([schoolYear, status])
  @@index([teacherId])
}
```

Add the reverse relation on `SchoolYear`:

```prisma
teacherYearArchives TeacherYearArchive[]
```

Notes:

- `Bytes` maps to PostgreSQL `bytea`; do not use `@db.Bytea` unless required by the
  installed Prisma version.
- No FK to `Teacher`: employee deletion/merge must not erase archive history.
- `@@unique` provides idempotency and supports `skipDuplicates` / `upsert`.
- List endpoints must never `select` `payload`.

---

## 6. Payload contract (`schemaVersion: 1`)

The payload is built from live rows at generation time, then gzipped. Original IDs are
preserved.

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-11T...",
  "source": "ROLLOVER | MANUAL_ARCHIVE | BACKFILL",
  "dataQuality": {
    "backfilled": true,
    "warnings": ["NO_ATTENDANCE_ROWS", "NO_EOSY_SNAPSHOTS"],
    "snapshotCoverage": { "grades": 240, "eosySnapshots": 240 }
  },

  "schoolYear": {
    "id": "...", "label": "2025-2026", "gradingMode": "TRANSMUTED",
    "termLabels": { "T1": "Term 1", "T2": "Term 2", "T3": "Term 3" },
    "startDate": "...", "endDate": "...",
    "schoolSettingsSnapshot": { }
  },

  "teacher": {
    "id": "...", "userId": "...", "employeeId": "...",
    "name": "Juan Dela Cruz", "specialization": "..."
  },

  "summary": {
    "sections": 2, "subjects": 4, "students": 45, "assignments": 6,
    "grades": 810, "attendanceRows": 9000, "schedules": 40,
    "workloadEntries": 8, "observedValues": 1350, "editRequests": 0
  },

  "sections": [
    { "id": "...", "name": "...", "gradeLevel": "7", "program": "REGULAR",
      "status": "COMPLETED", "role": "ADVISER" }
  ],

  "students": [
    { "id": "...", "lrn": "...", "name": "...", "sectionId": "...",
      "enrollment": {
        "id": "...", "status": "ENROLLED", "promotionStatus": "PROMOTED",
        "promotedToGradeLevel": "8", "isArchived": true
      },
      "remedialClasses": [] }
  ],

  "classAssignments": [
    { "id": "...", "subject": { "id": "...", "code": "...", "name": "...",
        "displayName": "..." },
      "sectionId": "...", "teachingMinutes": 240,
      "isActive": false, "archivedAt": "...", "archivedReason": "...",
      "successorTeacherId": null, "source": "SYNC" }
  ],

  "grades": [
    { "id": "...", "studentId": "...", "classAssignmentId": "...", "term": "T1",
      "writtenWorkScores": [], "perfTaskScores": [], "examScores": [],
      "quarterlyAssessScore": 0, "quarterlyAssessMax": 100,
      "writtenWorkPS": 0, "perfTaskPS": 0, "quarterlyAssessPS": 0,
      "initialGrade": 0, "quarterlyGrade": 0, "remarks": "...",
      "qualitativeDescriptor": "...", "status": "FINALIZED",
      "finalizedBy": "...", "finalizedAt": "...", "isArchived": true }
  ],

  "eosyFinalization": [
    { "studentId": "...", "classAssignmentId": "...", "term": "T1",
      "quarterlyGrade": 90, "finalizedAt": "...", "source": "EOSY_FINALIZE" }
  ],

  "attendance": [
    { "id": "...", "studentId": "...", "sectionId": "...", "date": "2025-08-01",
      "status": "PRESENT", "remarks": null, "recordedBy": "..." }
  ],
  "attendanceScope": "ADVISORY_SECTIONS + RECORDED_BY_TEACHER",

  "schedules": [
    { "id": "...", "subjectId": "...", "sectionId": "...", "termIndex": 1,
      "day": "MONDAY", "startTime": "07:30", "endTime": "08:30", "roomId": 1 }
  ],

  "workload": [
    { "id": "...", "sectionId": "...", "classAssignmentId": "...",
      "type": "TEACHING", "minutes": 240 }
  ],

  "editRequests": [
    { "id": "...", "term": "T2", "status": "APPROVED", "reason": "...",
      "createdAt": "...", "expiresAt": "..." }
  ],

  "observedValues": [
    { "studentId": "...", "term": "T1", "behaviorCode": "...", "rating": "..." }
  ]
}
```

### Inclusion rules

- **Teacher set** = union of:
  - `ClassAssignment.teacherId` for the year
  - `ScheduleEntry.teacherId` for the year
  - `WorkloadEntry.teacherId` for the year
  - `Section.adviserId` for the year
  Include teachers whose assignments are already `isActive: false` — they may still have
  grades.
- **Sections** = all sections taught plus advisory sections.
- **Students** = enrollments in those sections for the year. Student identity fields only;
  `Enrollment.profileSnapshot` is omitted by default (already stored in the live
  `Enrollment` row and in SF data).
- **Attendance** = all rows for advisory sections + rows where `recordedBy` matches the
  teacher's `Teacher.id` or `User.id`. Never duplicate the full attendance of every
  taught section into every subject teacher's archive.
- **Grades** = all `Grade` rows under the teacher's assignments for the year.
- **EOSY finalization** = compact records derived from `GradeSnapshot` rows with
  `source = EOSY_FINALIZE`. Do **not** store the full `GradeSnapshot.snapshot` JSON: it
  duplicates grade data and measured 1.54 KB/row vs 1.12 KB for the grade itself.
- **AIMS/ECR raw data** excluded by default; grades already reflect imported results.
  Optional `includeRawImports` flag for special backfills.
- **Observed values** = rows for students in advisory sections.
- **Remedial classes** = rows linked to the advisory students (small, useful context).

---

## 7. Generation flow

### 7.1 Automatic on archive

1. `archiveYearInTx` (`server/src/lib/rollover.ts:95`) runs guards and archive writes
   as today.
2. After the transaction commits, `ensureTeacherArchivesQueued` inserts one
   `TeacherYearArchive` row per expected teacher with `status = PENDING`, metadata, and
   `source`. This runs **outside** the archive transaction, so the legacy archive writes
   remain byte-for-byte unchanged. The insert is awaited (fast) so the work is recoverable
   if the process stops.
3. The same post-commit helper triggers `generateTeacherYearArchives(schoolYearId)` unless
   `TEACHER_ARCHIVE_ENABLED === "false"`.
   - Do **not** build/gzip inside the archive transaction: production payloads are
     ~100–300 MB of source rows per year; the transaction holds the rollover advisory
     lock and Prisma's default timeout is 5 seconds.
   - Fire-and-forget with error logging (`void generate...().catch(...)`) so a slow
     backup does not block the sync response. PENDING rows make the missing work visible
     and retryable.
   - **Regression contract:** the `try/catch` around generation must never rethrow into
     `archiveSchoolYear` or `handleYearChangeRollover`. The year remains `ARCHIVED`, the
     year lock remains set, and the active-year switch is never reverted because a bundle
     failed to compress.
   - Every failure is logged with a stable prefix `[TeacherArchive]` so the PM2 log gate
     (§12.4) can detect new errors unambiguously.
4. `generateTeacherYearArchives`:
   - Guard against concurrent runs for the same year (in-process `Set<schoolYearId>`).
   - Bulk-read all year data once, group in memory by teacher.
   - For each PENDING/FAILED teacher, build the payload object, stringify, gzip
     (`zlib.gzipSync(buffer, { level: 9 })`), compute sha256, and update the row:
     `payload`, `rawBytes`, `compressedBytes`, `checksum`, `stats`, `dataQuality`,
     `status = COMPLETE`, `completedAt`.
   - On failure: set `status = FAILED`, `error` (truncated), continue with other teachers.
   - Write an audit log summary and log totals.
5. Startup recovery: call `resumePendingTeacherArchives()` from `server/src/index.ts`
   after DB init. It picks `PENDING`/`FAILED` rows for archived years and retries.
6. Admin backfill endpoint/script also retries.

### 7.2 Backfill of existing years

Because archiving never deletes source rows, all four archived years in the current DB can
be backfilled:

- `2022-2023`, `2023-2024`, `2024-2025`, `2025-2026`.
- Attendance for years before `2026-2027` is absent in the current DB; mark
  `dataQuality.warnings: ["NO_ATTENDANCE_ROWS"]`. Grades, assignments, enrollments, and
  schedules are present and will be packed.
- Backfills run against live rows, not the historical state. Global grading-config
  recomputes may have rewritten `Grade.initialGrade`/`quarterlyGrade` since the year
  closed. To reduce drift:
  - Prefer `GradeSnapshot` finalized values in `eosyFinalization` and flag any mismatch.
  - Set `dataQuality.backfilled = true` and `source = BACKFILL`.
- Default behavior: create missing rows only. `regenerate: true` replaces payloads for
  complete rows.
- Optional `includeSnapshots`, `includeProfile`, `includeRawImports` flags.

### 7.3 Idempotency / retry

- Unique `(schoolYearId, teacherId)` prevents duplicates.
- `createMany({ skipDuplicates: true })` for metadata.
- Generation updates only `PENDING`/`FAILED` rows unless `regenerate` is requested.
- A year already `ARCHIVED` and without rows can be backfilled at any time.

---

## 8. Size and storage analysis (measured)

Measured on the current database (demo scale: 101 students, 42 teachers, 10,212 grades,
20,304 snapshots):

| Data | Raw JSON | gzip | Ratio |
|---|---:|---:|---:|
| Grade row | 1.12 KB | 49 B | 23.6× |
| Attendance row | 301 B | 14.6 B | 20.8× |
| GradeSnapshot row | 1.54 KB | 86 B | 18× |
| Student + enrollment | 2.25 KB | 333 B | 6.6× |
| Schedule row | 340 B | 30 B | 11.5× |

Measured teacher-year bundles (top 4 teachers, 200–290 grades):

| Variant | Raw | gzip |
|---|---:|---:|
| Full (grades + roster + full EOSY snapshots) | 0.8–1.1 MB | 44–60 KB |
| Lean (grades + roster, compact finalization) | 0.26–0.37 MB | 14–19 KB |

Production projection per teacher-year (45 students/section, 200 school days, 3 terms,
6 classes):

| Included | Raw | gzip |
|---|---:|---:|
| 810 grades | 0.91 MB | 40 KB |
| 9,000 advisory attendance rows | 2.64 MB | 128 KB |
| Roster identities (up to 270 students) | 0.6 MB | 20 KB |
| Schedules/workload/assignments/observed | 0.25 MB | 11 KB |
| **Lean total** | **~4.3 MB** | **~200 KB** |
| + full snapshots | +1.25 MB | +70 KB |
| + raw AIMS | +1.9 MB | +120 KB |
| + attendance for all taught sections (6×) | +15 MB | +770 KB |

Whole-school target:

| Scenario | 50 teachers | 100 teachers |
|---|---:|---:|
| Lean gzip per year | ~10 MB | ~20 MB |
| Lean + snapshots | ~13 MB | ~26 MB |
| 10-year lean total | ~100 MB | ~200 MB |
| Uncompressed `jsonb` per year | ~55–95 MB disk | ~110–190 MB disk |

Storage rules:

- Store gzip `bytea`, not `jsonb`.
- Bulk reads are fine; compress one teacher at a time to cap memory.
- Never select `payload` in list queries.
- Optional brotli (`zlib.brotliCompressSync`) yields ~30–40% smaller files at higher CPU
  cost; default gzip for predictability.
- `pg_dump` plain SQL writes `bytea` as hex (2× size). Locked follow-up: add a
  `pg_dump -Fc` (compressed custom format) variant, prove a restore into a scratch
  database, compare dump sizes, then make it the default and update the restore runbook.
  This change has its own gate (§12, G7) and must not ship unverified.

---

## 9. API

New `server/src/routes/admin-sub/teacherArchives.ts` (admin) and
`server/src/routes/teacherArchives.ts` (teacher self-service). Admin endpoints are
ADMIN-only; teacher endpoints are TEACHER-only and filter by the JWT user id.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/admin/teacher-archives?schoolYearId=&status=&search=&page=&pageSize=` | Metadata list; never selects `payload`. Returns coverage counts and total sizes. |
| GET | `/api/admin/teacher-archives/:id` | Metadata + preview (`summary`, per-section/per-term counts, data quality). |
| GET | `/api/admin/teacher-archives/:id/download?format=xlsx\|json\|json.gz` | Default is Excel (`.xlsx`); JSON and gzip remain available for backup. Excel sheets: Summary, Grades, Attendance, Students, Classes, Schedule, Workload. |
| POST | `/api/admin/teacher-archives/backfill` | Body `{ schoolYearId, regenerate?, includeSnapshots?, includeProfile?, includeRawImports? }`. Creates missing rows / regenerates. |
| GET | `/api/teacher-archives` | Teacher's own COMPLETE archives (metadata only, no `payload`). |
| GET | `/api/teacher-archives/:id/classes` | Teacher-only class-record list for one archive (subject, section, terms). Used by the year drill-down page. |
| GET | `/api/teacher-archives/:id/download?format=xlsx\|json\|json.gz` | Teacher download (default Excel); returns 404 for any archive not owned by the signed-in user. |

Class-record ECR export: `/api/grades/ecr-export/:classAssignmentId?term=ALL` fills the
T1, T2, T3, and Final Grades sheets in one workbook. `term=T1|T2|T3` remains available for
single-term exports.

Response shape for list:

```jsonc
{
  "schoolYear": { "id": "...", "label": "2025-2026", "status": "ARCHIVED" },
  "counts": {
    "expectedTeachers": 42, "complete": 42, "pending": 0, "failed": 0,
    "totalRawBytes": 180000000, "totalCompressedBytes": 9000000
  },
  "teachers": [
    { "id": "...", "teacherName": "...", "employeeId": "...",
      "status": "COMPLETE", "compressedBytes": 210000,
      "stats": { "grades": 810, "students": 45, "sections": 2 },
      "completedAt": "..." }
  ]
}
```

Validation: add zod schemas in `server/src/schemas/admin.ts`.

Audit logs:

- Download: `AuditAction.EXPORT` (or existing export action), target
  `Teacher Archive Download: <year> / <teacher>`.
- Backfill/regenerate: `AuditAction.CONFIG`, target
  `Teacher Archives Backfill: <year>`, severity `WARNING` for regenerate.

---

## 10. Admin UI

New page `src/pages/admin/TeacherArchives.tsx`:

- Route `/admin/teacher-archives` (lazy in `src/App.tsx`) and nav item in
  `src/layouts/AdminLayout.tsx` next to School Years.
- `PageHeader`, `StatCard`s: Teachers archived, Missing/Failed, Total compressed size.
- Archived-year selector from `adminApi.getSchoolYears()`, default latest archived year.
- `DataTable` columns: Teacher, Employee ID, Advisory, Classes, Students, Grades,
  Attendance, Size, Status, Generated, Actions (View / Download).
- Detail dialog: counts by section/term, data-quality warnings, size, checksum,
  download buttons (JSON / JSON.GZ).
- If missing or failed > 0: "Generate missing backups" button with confirmation and
  progress feedback (poll or refetch).
- Empty state explains that old years must be backfilled.
- Add a "Backups" shortcut on archived rows in `src/pages/admin/SchoolYears.tsx`.
- Add methods to `adminApi` in `src/lib/api.ts` near the school-years methods.

Do not render raw JSON in the browser; downloads only.

### Teacher self-service UI

New pages:

- `src/pages/teacher/TeacherArchives.tsx` (`/teacher/archives`)
- `src/pages/teacher/TeacherArchiveDetail.tsx` (`/teacher/archives/:archiveId`)

Behavior:

- Shows only the signed-in teacher's COMPLETE archives; never exposes another teacher's
  row, size, checksum, or download.
- The year list has a single **Open** action. The drill-down page lists that year's
  class records by subject + section.
- Each class record has one **Download Excel** action that generates the **official
  class-record workbook with Term 1, Term 2, Term 3, and Final Grades filled in**
  (`/api/grades/ecr-export/:classAssignmentId?term=ALL`). No per-term buttons; teachers
  get a complete, aligned workbook in one click.
- The whole-year summary workbook remains available as **Year backup** on the drill-down
  page. JSON/gzip backups remain available from the admin page.
- `teacherArchivesApi` in `src/lib/api.ts` enforces ownership from the JWT `user.id`, not
  from a request parameter.
- Empty state explains that records appear after a school year is archived.

---

## 11. File map / implementation phases

### Phase 0 — Schema

- `server/prisma/schema.prisma`: add model + relation.
- Migration: `server/prisma/migrations/<timestamp>_add_teacher_year_archives/`.
- Run `pnpm --prefix server run prisma:generate`.
- Update `server/src/lib/wipe.ts` only if cascade behavior needs an explicit delete
  (SchoolYear cascade should cover it); extend `server/src/__tests__/wipe.test.ts`.

### Phase 1 — Builder + backfill (smallest useful slice)

- `server/src/lib/teacherYearArchive.ts`
  - `collectExpectedTeachers(db, yearLabel)`
  - `buildTeacherArchivePayload(db, yearLabel, teacherId, opts)`
  - `generateTeacherYearArchives(schoolYearId, opts)`
  - `resumePendingTeacherArchives()`
  - `teacherArchiveChecksum(raw)`
- `server/scripts/backfillTeacherYearArchives.ts [yearLabel] [--force]`
  - Default: all `ARCHIVED`/`COMPLETED` years.
  - Prints per-teacher raw/gzip sizes and totals.
- Verify on current DB: backfill 2022-2023 through 2025-2026, inspect sizes and counts.

### Phase 2 — Rollover integration

- `server/src/lib/rollover.ts`: enqueue PENDING rows in `archiveYearInTx`; trigger
  generation after commit in both `archiveSchoolYear` and `handleYearChangeRollover`.
- `server/src/index.ts`: call `resumePendingTeacherArchives()` after startup.
- Ensure blocked rollover (`locked_not_archived`) creates no archive rows.
- Ensure a generation failure never rolls back or unlocks the archived year.

### Phase 3 — API + UI

- Routes, schemas, audit, API client, page, route, nav.
- Backfill action wired from UI.

### Phase 4 — Operational follow-ups (locked, gated)

- `server/scripts/backup.ts`: add `pg_dump -Fc` support, verify a restore, then make it
  the default and update restore docs (gate G7).
- Document off-site backup in a separate plan (`docs/BACKUP_AND_RECOVERY_PLAN.md`).
- Optional: "download all archives for year" ZIP.

---

## 12. Strict implementation gates

Rules:

- Gates run in order. A failed gate stops the line; do not start the next gate.
- Every gate records evidence: command, commit SHA, result, and the relevant PM2 excerpt.
- No gate is waived. Type errors, failing tests, new console errors, and new PM2 errors
  are release blockers.
- Database changes are additive only. No existing table/column is dropped or renamed.
- The feature must be independently disableable (`TEACHER_ARCHIVE_ENABLED=false`) without
  changing archive behavior.

### 12.1 Gate matrix

| Gate | Scope | Primary commands | Pass criteria |
|---|---|---|---|
| **G0** | Baseline before any code | `pnpm run verify`; `pnpm test:e2e`; `pm2 list`; `pm2 logs server --lines 500 --nostream`; `pnpm --prefix server run db:backup` | Baseline is green; pre-existing PM2 warnings are recorded and allowlisted; backup file exists |
| **G1** | Prisma model + migration | `pnpm --prefix server run prisma:generate`; migrate on test DB; `pnpm --prefix server run build`; `pnpm --prefix server test` | Migration is additive; existing tests pass; no runtime code enabled yet |
| **G2** | Payload builder + compression (read-only) | new unit tests; `ts-node scripts/reportTeacherArchives.ts` on test DB | Inclusion rules/stats/checksum/gzip round-trip pass; size budget met; no writes outside the new archive table |
| **G3** | Historical backfill dry run | restore a live DB copy into `smart_test_db`; run backfill for 2022-2023 → 2025-2026 | One row per expected teacher per year; rerun creates no duplicates; `--force` replaces; counts match source; size budget met |
| **G4** | Rollover integration | rollover/guard tests; generation failure injection; feature-flag-off test | Blocked rollover creates zero bundles; success creates PENDING→COMPLETE; generation failure never alters archive state; flag off behaves exactly as today |
| **G5** | Admin API | route/integration tests on test DB | 401/403 enforced; list never selects `payload`; download checksum correct; backfill idempotent; audit written |
| **G6** | Admin UI + Playwright | `pnpm test:e2e`; page added to portal smoke; console/API problem collector | Page loads, year filter works, empty/missing state works, no console/API errors |
| **G7** | `pg_dump -Fc` backup variant | dump, restore into scratch DB, compare counts and sizes | Restore succeeds; key table counts match; dump size benefit measured; runbook updated; only then make default |
| **G8** | Staged release + post-deploy | production backfill; restart PM2; 15-minute log watch; rollover-status check | All historical years complete; no new PM2 errors; no restart loop; rollover still reports correctly |

### 12.2 Regression-prevention contract

These are invariants, not suggestions:

1. `archiveYearInTx` behavior is unchanged except inserting `TeacherYearArchive`
   metadata rows. Guard order, archive writes, and return outcomes stay identical.
2. The snapshot-gap guard, pending-remedial guard, and unfinalized-section guard remain
   untouched and still run before any archive/bundle work.
3. Bundle generation is wrapped so no exception can escape into
   `archiveSchoolYear` or `handleYearChangeRollover`; the year must remain archived and
   locked even if every bundle fails.
4. `TEACHER_ARCHIVE_ENABLED=false` results in zero new work and zero new rows, while
   archive behavior is byte-for-byte the previous contract.
5. No existing route response shape, status code, or authorization rule changes.
6. The list endpoint must never load `payload`; verify with a query-shape test.
7. Historical years are never mutated by backfill; only `TeacherYearArchive` rows are
   created/updated.
8. The schema change is additive and cascade-deletes only through `SchoolYear`.
9. No change to `Grade`, `Enrollment`, `ClassAssignment`, `Section`, or `SchoolYear`
   status is introduced by this feature.
10. `pnpm run verify` must pass at the end of every implementation phase, not only at the
    end of the project.

### 12.3 Playwright gates

The existing `playwright.config.ts` suite is read-only against the dev database and uses
`e2e/fixtures.ts` credentials. Respect that contract.

Add `e2e/teacher-archives.spec.ts`:

1. Login as admin and open `/admin/teacher-archives`.
2. Assert the page renders with the latest archived year selected.
3. Assert either archive rows or the explicit empty/backfill state is visible.
4. Assert the yearly selector lists archived years and switching years refetches.
5. Assert no browser console errors and no `/api/*` response >= 400 via
   `collectProblems(page)`.
6. Assert the list network response does not contain a `payload` field.
7. Do **not** click download or backfill in the read-only suite (both write audit logs).
   Download/backfill are covered by API integration tests on the test database.
8. Add `/admin/teacher-archives` to the admin page list in `e2e/portals.spec.ts`.

Commands and evidence:

```bash
pnpm test:e2e
pnpm test:e2e:pwa
```

Save the list output to the gate evidence file. A flaky test is a failed gate; fix the
selector/waiter, do not retry it into passing.

### 12.4 PM2 log gates

Run after every backend gate, after the migration, and after the final deploy:

```powershell
pm2 list
pm2 logs server --lines 500 --nostream
```

Baseline allowlist (observed 2026-11-11, pre-existing and unrelated):

- `[AtlasYear]` 403 / `SCHOOL_SCOPE_REQUIRED` / ATLAS probe fallback
- `[AtlasSync]` faculty 403, published schedule HTTP 500, adviser sync HTTP 500
- `[ExternalState] ATLAS DOWN/UP`
- EnrollPro active-term / learner timeouts
- `[AimsSSO]` `SSO_NOT_CONFIGURED`, `AIMS_ACCOUNT_NOT_PROVISIONED`
- `[AimsReverseSSO]` expired/used-code test probes

Fail the gate on any of:

- uncaught exception or unhandled rejection,
- Prisma/database error,
- any `[TeacherArchive]` error,
- new `5xx` from an internal route,
- `pm2 list` showing `errored`, `stopped`, or a restart count that keeps increasing,
- `unstable restarts > 0`.

Record before/after restart counts and uptime. If the server must be restarted, restart
it once, wait for `wait_ready`, then re-read logs.

### 12.5 Rollover-readiness gates

On the isolated `*_test` database:

1. Create a fully finalized synthetic year and verify `GET /api/admin/rollover-status`
   reports `canArchive: true`.
2. Archive it and verify:
   - `SchoolYear.status = ARCHIVED`, `archivedAt` set,
   - `YearGradeLock.isLocked = true`,
   - existing grade/enrollment/assignment flags match today's behavior,
   - one `TeacherYearArchive` row per expected teacher.
3. Repeat archive call: `no_change`, no duplicate archive rows.
4. Create the three blocked states (unfinalized section, snapshot gap, pending remedial)
   and verify archive is refused and **zero** archive rows are created.
5. Inject a generation failure and verify the year is still archived/locked and the row is
   `FAILED` with a retry path.
6. Run with `TEACHER_ARCHIVE_ENABLED=false` and verify archive behavior + zero rows.
7. Only after all six pass may G4 be marked complete.

Never simulate rollover against the live database. The test harness guard
(`server/scripts/require-test-db.js`) must remain in force.

### 12.6 Size and performance budgets

Hard budgets for the gate report:

| Metric | Budget | Failure action |
|---|---:|---|
| Average compressed archive | ≤ 400 KB per teacher-year | Review scope/compression before release |
| Whole-year compressed total | ≤ 20 MB per 50 teachers | Review attendance scope and excluded fields |
| Single archive payload | ≤ 10 MB uncompressed | Log warning and mark `dataQuality` oversized |
| Generation wall time | ≤ 60 s for 50 teachers | Move generation further off the request path |
| Node RSS increase during generation | ≤ 512 MB | Reduce concurrency / process one teacher at a time |

The report script must print: teacher count, total raw bytes, total compressed bytes,
average ratio, largest bundle, and generation duration.

### 12.7 Rollback plan

- **Code rollback:** set `TEACHER_ARCHIVE_ENABLED=false`; no schema rollback needed.
- **Schema rollback (dev/test only):** the table is additive and unused by other
  features; drop it only after a backup and only outside production.
- **Bad bundles:** delete the affected `TeacherYearArchive` rows and re-run backfill.
  Live grades/attendance are never touched by archive generation, so no student data is
  at risk.
- **Backup-script regression:** keep the plain-SQL command as a fallback until the `-Fc`
  restore drill passes; revert the default if restore verification fails.

---

## 13. Backup and security relationship (important)

Teacher archives are stored in the same database as the live data. They protect against
**accidental loss of a teacher's year view** and make records requests easy, but they do
**not** protect against:

- an attacker with database/admin access deleting rows,
- ransomware deleting server files,
- server loss without an off-site copy.

Protection requires a separate backup feature:

- automated nightly database dump (replace manual-only `server/scripts/backup.ts`),
- retention (e.g. 30 daily + 12 monthly),
- copy to a different machine/cloud/offline drive,
- at least one copy that is hard to delete (immutable/versioned storage or offline drive),
- periodic restore tests,
- visible "last successful backup" on the admin dashboard (currently hardcoded `N/A` in
  `server/src/routes/admin-sub/dashboard.ts:226`).

This plan does not implement those items; they are a prerequisite for real disaster
recovery.

---

## 14. Tests

- `server/src/__tests__/teacher-archives-lib.test.ts`
  - expected teacher set includes advisory-only and inactive-assignment teachers,
  - attendance scope excludes non-advisory sections unless recorded by the teacher,
  - payload stats match row counts,
  - gzip round-trip returns identical JSON; checksum matches,
  - synthetic production-size bundle stays under the size budget.
- Extend `rollover-lib.test.ts` / `rollover.test.ts`
  - successful archive creates one PENDING row per expected teacher,
  - blocked archive (unfinalized, snapshot gap, pending remedial) creates none,
  - generation completion marks COMPLETE and is idempotent on rerun,
  - generation failure leaves the year archived/locked and the row FAILED,
  - `TEACHER_ARCHIVE_ENABLED=false` creates no rows and preserves archive behavior.
- Extend `archive-year-route.test.ts`
  - admin archive response/audit includes archive count,
  - backfill requires admin and is idempotent.
- API tests
  - teacher/registrar receive 403; unauthenticated 401,
  - list response never contains `payload`,
  - download decompression matches checksum and filename,
  - backfill `regenerate` replaces payloads only when requested.
- Extend `wipe.test.ts` for cascade deletion.
- Playwright
  - new `e2e/teacher-archives.spec.ts` (read-only checks from §12.3),
  - add the page to `e2e/portals.spec.ts`.
- Size/performance
  - `scripts/reportTeacherArchives.ts` asserts the budgets in §12.6 and prints a
    per-year/per-teacher report.
- Gate commands:
  `pnpm run verify`, `pnpm --prefix server test`, `pnpm test:e2e`,
  `pm2 logs server --lines 500 --nostream`.

---

## 15. Rollout

Staged and gated; do not skip a step.

1. **G0 baseline** — record `pnpm run verify`, Playwright, PM2 log baseline, and a fresh
   database backup.
2. **G1** — apply the additive migration on the test database, then production.
3. **G2** — deploy the builder/compressor with `TEACHER_ARCHIVE_ENABLED=false`.
   No automatic generation yet.
4. **G3** — restore a production copy into the test database, run the backfill dry run for
   2022-2023 → 2025-2026, and verify counts, sizes, and idempotency.
5. **G4** — validate all rollover scenarios on the test database, including blocked years
   and injected generation failure.
6. **G5/G6** — deploy the admin API/UI, run Playwright, and record evidence.
7. **Production backfill** — run the backfill per archived year, oldest first:
   `pnpm --prefix server exec ts-node scripts/backfillTeacherYearArchives.ts 2022-2023`
   (repeat for 2023-2024 … 2025-2026). Verify each year before moving on.
8. **Enable generation** — set `TEACHER_ARCHIVE_ENABLED=true`, restart the server once,
   and complete G8 (15-minute PM2 log watch, rollover-status check).
9. **G7 backup change** — add the `-Fc` variant, prove restore, then switch the default and
   update the runbook.
10. Record baseline sizes and monitoring thresholds for future years.

## 16. Acceptance criteria

- Every archived year has exactly one archive per expected teacher.
- Current DB backfill: all four archived years present; old-year bundles include grades
  and show `NO_ATTENDANCE_ROWS` where applicable.
- Re-running backfill does not duplicate rows; `--force` replaces payloads.
- Rollover success creates PENDING rows that become COMPLETE; blocked rollover creates
  none; generation failure never blocks, unarchives, or unlocks the year.
- `TEACHER_ARCHIVE_ENABLED=false` produces zero new rows and no archive-behavior change.
- List API/UI never loads payloads.
- Average compressed archive ≤ 400 KB per teacher-year; total ≤ 20 MB per 50 teachers.
- All gates G0–G8 have recorded evidence; no gate is skipped.
- No new PM2 error signatures after deploy; no restart loop; no unstable restarts.
- Playwright suite passes, including the new admin page and no-console-error checks.
- Existing tests (`rollover`, `remedial`, `grade-lock`, `term-finalization`,
  `wipe`, `archive-year-route`) all pass unchanged.

## 17. Resolved decisions and remaining choices

Resolved:

1. Storage: gzip-compressed `bytea` in the database.
2. Compression: gzip level 9.
3. Access: ADMIN full access; TEACHER self-service read/download of their own archives.
4. Backup: add `pg_dump -Fc`, prove restore, then make it the default.
5. Failure behavior: fail-open for the year; bundles retry independently.

Deferred intentionally:

1. Brotli compression (smaller files, higher CPU).
2. Registrar read access.
3. Manual archive generation for the active year (preview/export).
4. "Download all archives for year" ZIP.
5. Restore/import of a bundle back into live tables.
6. Automated off-site backup and retention (separate `docs/BACKUP_AND_RECOVERY_PLAN.md`).

---

## 18. Implementation evidence (2026-11-11)

### Delivered

| Area | Files |
|---|---|
| Schema + migration | `server/prisma/schema.prisma`, `server/prisma/migrations/20261111140000_add_teacher_year_archives/migration.sql` |
| Builder/generator | `server/src/lib/teacherYearArchive.ts`, `server/src/lib/teacherYearArchiveExcel.ts` |
| Rollover hook | `server/src/lib/rollover.ts` (post-commit queue + generation), `server/src/index.ts` (startup resume) |
| API | `server/src/routes/admin-sub/teacherArchives.ts`, `server/src/routes/teacherArchives.ts` (teacher self-service), `server/src/routes/admin.ts`, `server/src/schemas/admin.ts` |
| Scripts | `server/scripts/backfillTeacherYearArchives.ts`, `server/scripts/reportTeacherArchives.ts`, `server/scripts/backup.ts` |
| Admin UI | `src/pages/admin/TeacherArchives.tsx`, `src/App.tsx`, `src/layouts/AdminLayout.tsx`, `src/lib/api.ts` |
| Teacher UI | `src/pages/teacher/TeacherArchives.tsx`, `src/pages/teacher/TeacherArchiveDetail.tsx`, `src/App.tsx`, `src/layouts/TeacherLayout.tsx`, `src/lib/api.ts` |
| Tests | `server/src/__tests__/teacher-archives-lib.test.ts`, `teacher-archives-rollover.test.ts`, `teacher-archives-failure.test.ts`, `teacher-archives-api.test.ts`, `teacher-archives-self-api.test.ts`, `e2e/teacher-archives.spec.ts`, `e2e/portals.spec.ts` |
| Wipe coverage | `server/src/lib/wipe.ts` |

### Gate results

| Gate | Result |
|---|---|
| **G0** | `pnpm run verify` passed on clean `*_test` DB. Playwright baseline: 34 passed, 2 skipped, **1 pre-existing failure** (`E-16` print pagination expected 2 pages, got 3). PM2 baseline recorded; external ATLAS/EnrollPro/AIMS warnings allowlisted. Fresh backup taken. |
| **G1** | Additive migration applied on the test DB and live DB. Server build passed. Existing suite passed. **Caveat:** replaying all migrations from an empty DB fails at pre-existing `20260829120000_t2_t3_year_term_locks_promotion` (`type "Term" does not exist`); fresh dev/test DBs use `prisma db push`, live DB uses `migrate deploy`. |
| **G2** | Builder tests passed: inclusion rules, advisory-only teacher, attendance scope, stats, gzip round-trip, checksum, queue idempotency. Size report passed budget. |
| **G3** | Dry run on a restored live-DB copy: 2022-2023 = 20, 2023-2024 = 20, 2024-2025 = 39, 2025-2026 = 39 archives. 0 failed. Compressed total 782 KB. Rerun queued 0; `--force` regenerated successfully. |
| **G4** | Rollover success creates PENDING?COMPLETE; blocked rollover creates zero rows; `TEACHER_ARCHIVE_ENABLED=false` creates zero rows and preserves archive behavior; mocked generation rejection leaves the year archived and locked. |
| **G5** | Admin API tests passed: 401 unauthenticated, 403 non-admin, list has no `payload`, detail has no `payload`, JSON/gzip/Excel downloads, idempotent backfill, active-year backfill refused. Teacher self-service tests passed: 401 unauthenticated, 403 non-teacher, own list only, own class-record list, own download works, all-terms ECR workbook contains T1/T2/T3 scores, another teacher's download returns 404. |
| **G6** | New Playwright spec passed for admin (2/2) and teacher self-service (1/1); both pages added to portal smoke. Full suite: 35 passed, 2 skipped, only pre-existing `E-16` failed � no new failures. |
| **G7** | `db:backup` now defaults to `pg_dump -Fc`; `db:backup:plain` keeps the legacy `.sql`. Custom dump 2.79 MB vs 39.49 MB plain. Restore into `smart_restore_test` succeeded; key table counts matched live exactly. |
| **G8** | Live backfill: 118 archives across 4 archived years, 118 unique `(schoolYearId, teacherId)` pairs, 782 KB compressed, 0 failed. Server restarted once; no `[TeacherArchive]` errors after migration. Pre-existing ATLAS/EnrollPro/AIMS warnings only. |

### Operational notes

- Live ECR check: the 2025-2026 archive drill-down returned 6 class records; downloading
  `term=ALL` returned HTTP 200 with a 240 KB `.xlsx` whose TERM 1, TERM 2, and TERM 3
  sheets all contain scores, and Final Grades is populated. Single-term blank-sheet
  misalignment is fixed by the all-terms export.

- Admin UI: `/admin/teacher-archives` (SYSTEM group). The page lists archived years, coverage, sizes, data-quality warnings, and download actions.
- Default whole-year download is `.xlsx`; JSON and `.json.gz` remain available. Every download writes an audit log.
- `TEACHER_ARCHIVE_ENABLED=false` is the kill switch; it does not change archive behavior.
- Backfill is safe to rerun; use `--force` only when regenerating a year intentionally.
- Existing archived years must be backfilled once. Future years generate automatically at archive/rollover time.
- Off-site/disaster-recovery backup remains a separate plan; this feature is record-keeping, not attack protection.

### Post-release PM2 verification

- `pm2 restart server` completed; server stayed `online` with no restart loop.
- PM2 logs were flushed, the server restarted, and the logs were re-read after the 120-second
  clean window: **zero** `[TeacherArchive]`, uncaught, unhandled, Prisma, `TableDoesNotExist`,
  or `EADDRINUSE` matches.
- The only recurring warnings are the pre-existing ATLAS/EnrollPro/AIMS integration warnings
  recorded in the G0 allowlist.
