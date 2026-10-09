# Presentation Wipe Plan — Emems Demo (Wednesday)

Status: PLAN LOCKED — scripts implemented, NOT executed. Awaiting EnrollPro go signal.
Context: SMART is presented to 2 beneficiaries (Hinigaran, Emems). EnrollPro will wipe + reseed
for Emems. SMART must end up with **zero Hinigaran/historical data** before the demo.

## Locked decisions

1. DB runs on this laptop → take a `pg_dump` backup before wiping.
2. EnrollPro (same instance) is wiped + reseeded by their team — SMART wipes **after** their go signal.
3. Emems uses ATLAS → `.env` needs Emems `ATLAS_SCHOOL_ID` / `ATLAS_SCHOOL_YEAR_ID` (owner: Sean, cannot edit `.env` via agent).
4. Keep branding / templates / uploads (branding already synced to Emems).
5. No seed run, no backup admin — admin/registrar/teacher logins come from EnrollPro (auto-created on first login).
6. Wipe must clear **all data including historical** (SchoolYear 2026-27 → 2031-32, grades, snapshots, audit logs) and **all users**.

## Verified mechanics (code-scanned, not assumed)

- Startup: server boots → sync scheduler starts (`server/src/index.ts:233`) → first sync after 5s, then every 5 min (`server/src/lib/syncCoordinator.ts:587-618`).
- EnrollPro sync creates/updates: SchoolYear, sections, students, enrollments, teacher Users + Teacher rows (`server/src/lib/enrollproSync.ts:215-306`). New teacher passwords default to `password123` unless `DEFAULT_SYNC_PASSWORD` is set (`enrollproSync.ts:227`).
- Teachers missing from EnrollPro are suspended (`enrollproSync.ts:309-359`); prune deletes orphan teacher users + stale students (`server/src/lib/prune.ts`).
- ATLAS sync creates class assignments + schedule entries (`server/src/lib/atlasSync.ts:174`).
- Branding (school name / logo / colors) syncs from EnrollPro on boot + hourly (`server/src/lib/enrollproBrandingSync.ts`, `syncCoordinator.ts:396-415`).
- Admin/registrar accounts are **not** created by sync — auto-created on first EnrollPro login (`server/src/routes/auth.ts:158-167` create, `:181-191` update).
- Grades/attendance are NOT pulled from EnrollPro. Grades flow SMART → EnrollPro (`server/src/routes/integration.ts:73 sync-grades`). Attendance is SMART-only. A wipe permanently deletes them → backup is mandatory.
- Live DB snapshot (read-only query, current state): users = 1 ADMIN (`1234501`) + 1 REGISTRAR (`1234502`) + 43 TEACHER; 5 archived school years + 1 active (2031-2032); 127 students, 120 sections, 387 enrollments, 11,712 grades, 21,177 grade snapshots, 2,211 audit logs.

## Wipe script — implemented (server-side, not yet run)

Existing: `server/scripts/wipe.ts` + `server/src/lib/wipe.ts` (`pnpm run db:wipe`, prod-gated, transaction-verified).

Implemented changes:
1. `WIPE_ORDER` (`wipe.ts`) now explicitly includes `AimsScore`, `RemedialClass`, `ExternalSubjectRecord`, `ExternalSchoolRecord`, `CompanionSsoCode` (previously cascade-covered only).
2. Verification is catalog-driven: every `BASE TABLE` in the database (except kept/skipped) must be 0 rows after the wipe — a future migration adding a table can never silently survive.
3. `pnpm run db:backup` added (`server/scripts/backup.ts`) — pg_dump to `server/backups/smart_db_<timestamp>.sql` (gitignored).
4. Default behavior preserved: keeps `SystemSettings` (branding/creds/term dates), `GradingConfig`, `TransmutationEntry`, ExcelTemplate + uploads.

## Execution sequence (on go signal)

1. **Stop SMART server** (scheduler must not run mid-wipe).
2. **Backup**: `pnpm run db:backup` (server) → timestamped dump in `server/backups/`.
3. **Confirm EnrollPro is wiped + reseeded** for Emems; collect Emems EnrollPro + ATLAS ids.
4. **Dry-run wipe**: `pnpm run db:wipe -- --dry-run` → review counts.
5. **Wipe**: full wipe (all users, all data, historical included; keep branding/templates).
6. **Update `.env`** (Sean): Emems EnrollPro URL/account/password/year id/label + `ATLAS_SCHOOL_ID` / `ATLAS_SCHOOL_YEAR_ID`.
7. **Start server** → boot sync pulls Emems data (school year, sections, students, enrollments, teachers, ATLAS assignments/schedules, branding).
8. **Verify**: `GET /api/admin/sync-verification` → `ok: true`; spot-check no Hinigaran names/LRNs; check users list matches EnrollPro faculty.
9. **Demo machines**: clear browser localStorage/sessionStorage (school identity is cached client-side) and hard refresh.

## Fallback

Nuclear option if zero-doubt needed: `npx prisma migrate reset --force --skip-seed` (recreates schema from migrations), then start server. Note: `prisma/seed.ts:68-70` hardcodes Hinigaran identity — do NOT run seed; sync/branding repopulates.

## Rollback

Restore from the pg_dump backup: `psql <database> < backup.sql`. Keep the backup file until after the demo.
