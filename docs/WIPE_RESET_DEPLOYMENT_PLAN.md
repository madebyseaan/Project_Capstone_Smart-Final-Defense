# Stale Data After Wipe — Investigation & Deployment Readiness Plan

Status: INVESTIGATION ONLY — nothing implemented.

## 1. Root cause of the stale data

**SMART is a read-only mirror. EnrollPro is the source of truth. Wiping SMART's DB does not wipe EnrollPro — the next sync re-imports whatever EnrollPro still returns.**

Mechanics (`server/src/lib/enrollproSync.ts`):
- Students upserted by `lrn` (line 571) — any student EnrollPro still lists comes back.
- Enrollments upserted on `@@unique([studentId, sectionId, schoolYear])` (schema.prisma:208).
- Teachers upserted by `employeeId` (line 274) — **every EnrollPro teacher gets a User account recreated** after a wipe. This explains the "new accounts."
- Teachers no longer in EnrollPro are deactivated/flagged (lines 298–335), but **students are never pruned** — Students left by a partial wipe persist forever.

Contributing factors:
1. **Partial wipe residue.** `Student.lrn` is global-unique. If the manual wipe hit `Enrollment`/`Grade` but missed `Student` (or vice versa), old students survive and re-link on next sync → "same year, different students."
2. **Hardcoded EnrollPro year fallback `38`.** `enrollproClient.ts:443` and `teacherSync.ts:50` default `ENROLLPRO_SCHOOL_YEAR_ID ?? '38'`. If the env var is unset and resolution falls back, sync pulls year 38's cohort — possibly the old year's students under the same label.
3. **ATLAS also creates teachers/subjects/sections** (`atlasSync.ts`) using `ATLAS_SCHOOL_ID` (default `1`) and `ATLAS_SCHOOL_YEAR_ID` (default `3`). Wrong env values → other school's / other year's data.
4. EnrollPro credentials can live in **SystemSettings (DB)** with env fallback (`enrollproClient.ts:49-66`) — after a wipe, settings rows may be gone, silently changing which EnrollPro account is used.
5. `syncCache.ts` is in-memory, 5-min TTL — NOT a stale source (cleared on restart).

Also note: rollover (`rollover.ts`) only **archives** (sets `isArchived`/`isActive=false`); it never deletes. A "fresh start" via rollover semantics ≠ a wipe.

## 2. Audit checklist for the current dirty state (run against DB)

```sql
-- Two cohorts under one year label?
SELECT "schoolYear", count(*) FROM "Enrollment" GROUP BY 1 ORDER BY 1;
-- Orphan students (partial-wipe residue)
SELECT count(*) FROM "Student" s WHERE NOT EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."studentId" = s.id);
-- Accounts not matching current EnrollPro faculty (cross-check manually)
SELECT u.email, u.role, t."employeeId" FROM "User" u LEFT JOIN "Teacher" t ON t."userId" = u.id;
-- What year the sync actually pulled
SELECT * FROM "SyncHistory" ORDER BY "createdAt" DESC LIMIT 10;
```
Plus verify: `SystemSettings.currentSchoolYear`, `enrollpro*` settings vs `.env` (`ENROLLPRO_SCHOOL_YEAR_ID`, `ATLAS_SCHOOL_ID`, `ATLAS_SCHOOL_YEAR_ID`).

## 3. Correct wipe/reset procedure (per school, pre-deployment)

Order matters — source first, mirror second:

1. **Stop the SMART server** (or disable the sync scheduler) so no sync runs mid-wipe.
2. **Fix the source first:** EnrollPro must contain only the correct, current-year data (their admin rolls over/promotes there; SMART cannot write). Verify ATLAS year/school IDs too.
3. **Full wipe, not table-by-table:** `prisma migrate reset` (or drop schema + re-run migrations + seed). Never delete individual tables — that's what produced orphans.
4. **Set env explicitly per school:** `ENROLLPRO_SCHOOL_YEAR_ID`, `ENROLLPRO_SCHOOL_YEAR_LABEL`, `ATLAS_SCHOOL_ID`, `ATLAS_SCHOOL_YEAR_ID`, EnrollPro creds in `.env` — do not rely on defaults `38`/`1`/`3`.
5. **Restart → seed → trigger one sync → verify:**
   - Enrollment counts per section match EnrollPro.
   - Teacher/User list matches EnrollPro faculty (no extras).
   - No rows for prior year labels.
   - `rollover-status` endpoint reports clean state.

## 4. Two-school deployment options

- **Option A (recommended, zero code change): two isolated deployments.** Each school gets its own server instance, own PostgreSQL DB, own `.env` (EnrollPro account, ATLAS_SCHOOL_ID, JWT_SECRET). No shared data, no cross-contamination. The schema is single-tenant — no `schoolId` on User/Student/Section/Enrollment — so this is the only safe topology today.
- **Option B (not recommended now): single multi-tenant instance.** Requires adding `schoolId` to every core model + scoping every query + per-school credentials. High-risk refactor; do not attempt before deployment.

## 5. Readiness gaps to address BEFORE deployment (proposed, not implemented)

1. **Wipe/reset script or admin endpoint** — one command that stops sync, wipes domain tables in FK-safe order, reseeds. Eliminates manual partial wipes.
2. **Remove/guard the hardcoded defaults** (`38`, ATLAS `1`/`3`) — fail fast in production if school-year env vars are unset instead of silently syncing the wrong year.
3. **Post-sync verification report** — diff student/teacher counts vs EnrollPro; flag orphans and unexpected accounts (would have caught this incident).
4. **Student pruning (or orphan detection)** — currently students removed in EnrollPro stay in SMART forever.
5. **Per-school env template** (`server/.env.example`-style) documenting every school-scoped variable for the 2 deployments.
