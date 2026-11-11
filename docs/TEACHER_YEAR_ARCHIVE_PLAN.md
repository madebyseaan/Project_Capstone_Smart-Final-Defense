# Teacher Year Archives — Planning & Implementation

Status: PLAN (not implemented)
Scope: per-teacher, per-school-year compressed data snapshot for admin backup/download
Related: `docs/ROLLOVER_READINESS_PLAN.md`, `docs/ENROLLPRO_REMEDIAL_CONTRACT.md`

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
| Storage | Compressed `Bytes` (gzip) in a new Prisma table (recommended) |
| Payload scope | Lean: full grades, advisory attendance, roster identity; no raw AIMS/ECR, no full snapshot duplication |
| Generation timing | Metadata rows created in the archive transaction; compression after commit |
| Access | Admin only (v1); registrar read can be added later |
| Retention | Keep indefinitely; no automatic cleanup |

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
2. Within the same transaction, insert one `TeacherYearArchive` row per expected teacher
   with `status = PENDING`, metadata, and `source`.
   This is cheap and keeps the archive atomic with the year close.
3. After the transaction commits, `archiveSchoolYear` and `handleYearChangeRollover`
   trigger `generateTeacherYearArchives(schoolYearId)`.
   - Do **not** build/gzip inside the archive transaction: production payloads are
     ~100–300 MB of source rows per year; the transaction holds the rollover advisory
     lock and Prisma's default timeout is 5 seconds.
   - Fire-and-forget with error logging (`void generate...().catch(...)`) so a slow
     backup does not block the sync response. PENDING rows make the missing work visible
     and retryable.
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
- `pg_dump` plain SQL writes `bytea` as hex (2× size). If archives stay in the DB,
  switch `server/scripts/backup.ts` to `pg_dump -Fc` or add a compressed backup variant.
  This is a separate change; see §12.

---

## 9. API

New `server/src/routes/admin-sub/teacherArchives.ts`, registered in
`server/src/routes/admin.ts`. Admin authentication only.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/admin/teacher-archives?schoolYearId=&status=&search=&page=&pageSize=` | Metadata list; never selects `payload`. Returns coverage counts and total sizes. |
| GET | `/api/admin/teacher-archives/:id` | Metadata + preview (`summary`, per-section/per-term counts, data quality). |
| GET | `/api/admin/teacher-archives/:id/download?format=json\|json.gz` | Decompress and stream JSON, or stream the gzip bytes directly. Sets filename `TeacherArchive_<year>_<employeeId>.json[.gz]`. |
| POST | `/api/admin/teacher-archives/backfill` | Body `{ schoolYearId, regenerate?, includeSnapshots?, includeProfile?, includeRawImports? }`. Creates missing rows / regenerates. |

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

### Phase 4 — Operational follow-ups (separate approval)

- `server/scripts/backup.ts`: add `pg_dump -Fc` support (compressed custom format) and
  update restore docs, or keep plain SQL and accept ~2× dump growth.
- Document off-site backup in a separate plan (`docs/BACKUP_AND_RECOVERY_PLAN.md`).
- Optional: "download all archives for year" ZIP.

---

## 12. Backup and security relationship (important)

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

## 13. Tests

- `server/src/__tests__/teacher-archives-lib.test.ts`
  - expected teacher set includes advisory-only and inactive-assignment teachers,
  - attendance scope excludes non-advisory sections unless recorded by the teacher,
  - payload stats match row counts,
  - gzip round-trip returns identical JSON; checksum matches.
- Extend `rollover-lib.test.ts` / `rollover.test.ts`
  - successful archive creates one PENDING row per expected teacher,
  - blocked archive creates none,
  - generation completion marks COMPLETE and is idempotent on rerun.
- Extend `archive-year-route.test.ts`
  - admin archive response/audit includes archive count,
  - backfill requires admin and is idempotent.
- Extend `wipe.test.ts` for cascade deletion.
- Frontend: page renders empty/backfill state and sizes without payload.
- Commands: `pnpm --prefix server run build`, `pnpm run build`, `pnpm run verify`.

---

## 14. Rollout

1. Apply migration (additive; safe to deploy before any generation code).
2. Deploy Phase 1 code and run backfill for each archived year, oldest first:
   `pnpm --prefix server exec ts-node scripts/backfillTeacherYearArchives.ts 2022-2023`
   (repeat for 2023-2024 … 2025-2026).
3. Verify per-year: expected teacher count, complete count, total compressed size,
   spot-check one download.
4. Deploy Phase 2 so future rollovers generate automatically.
5. Deploy Phase 3 UI.
6. Record baseline sizes and monitor per-year growth.

## 15. Acceptance criteria

- Every archived year has exactly one archive per expected teacher.
- Current DB backfill: all four archived years present; old-year bundles include grades
  and show `NO_ATTENDANCE_ROWS` where applicable.
- Re-running backfill does not duplicate rows; `--force` replaces payloads.
- Rollover success creates PENDING rows that become COMPLETE; blocked rollover creates
  none; generation failure never blocks or unarchives the year.
- List API/UI never loads payloads.
- Average compressed archive ≤ ~300 KB per teacher-year; total ≤ ~15 MB per 50 teachers.

## 16. Open decisions

1. Storage: DB `bytea` (recommended) vs files on disk + metadata.
2. Backup script: switch to `pg_dump -Fc` now or defer.
3. Brotli instead of gzip (30–40% smaller, more CPU).
4. Registrar read access to archives, or admin-only.
5. Allow manual archive generation for the active year (preview/export) or only
   archived years.
