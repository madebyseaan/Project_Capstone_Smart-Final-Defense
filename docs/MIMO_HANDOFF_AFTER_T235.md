# SMART — Final Implementation Handoff

**Date:** 2026-08-29
**Completed tasks:** T2, T3, T4, T5, T6, T7, T8, A2/SF1, A3, A4
**Build status:** root build green, server build green, 49/49 tests green

---

## 1. Schema / Migration

**Applied via:** `prisma db push` (repo uses db push workflow; pre-existing migration drift)

**New tables (T2):**
- `YearGradeLock` — unique FK `schoolYearId` → `SchoolYear`, fields: `isLocked`, `lockedBy`, `lockedAt`, `unlockedBy`, `unlockedAt`
- `TermGradeLock` — unique compound `schoolYearId + term` (Term enum), same audit fields

**New columns:**
- `Enrollment.promotionStatus` — `PromotionStatus?` enum (`PROMOTED`, `CONDITIONALLY_PROMOTED`, `RETAINED`, `JHS_COMPLETER`)
- `Enrollment.promotedToGradeLevel` — `GradeLevel?`
- `Subject.isNonPromotional` — `Boolean @default(false)` (backfilled for HG codes)
- `SystemSettings.transitionLock` — `Boolean @default(false)` (T7)
- `SystemSettings.transitionNote` — `String?` (T7)
- `SystemSettings.auditLogRetentionDays` — `Int @default(365)` (A3)
- `SystemSettings.syncHistoryRetentionDays` — `Int @default(90)` (A3)
- `SystemSettings.gradeSnapshotRetentionDays` — `Int @default(0)` (A3, disabled by default)

**New enum:** `PromotionStatus`

**No new env vars required.** `ENROLLPRO_API_KEY` is optional (dev mode skips auth if unset).

---

## 2. New Files

| File | Lines | Purpose |
|------|-------|---------|
| `server/src/lib/gradeLocks.ts` | 169 | Per-year/per-term lock check, set, resolve helpers |
| `server/src/lib/promotion.ts` | 398 | Subject finals, rotation merge, promotion rules, EOSY finalize logic |
| `server/src/lib/rollover.ts` | 125 | Year rollover detection + guardrail + archive logic |
| `server/src/middleware/serviceAuth.ts` | 28 | ENROLLPRO_API_KEY header check (constant-time) |
| `server/src/__tests__/promotion.test.ts` | 146 | 15 pure unit tests |
| `server/src/__tests__/year-term-locks.test.ts` | 229 | 10 live-server tests |
| `src/pages/admin/components/GradeLocksPanel.tsx` | 146 | Admin year/term lock toggle UI |
| `src/pages/admin/components/RolloverStatusCard.tsx` | 105 | Admin rollover status + manual archive |
| `src/pages/registrar/components/SmartPromotionPanel.tsx` | 140 | EOSY promotion display + finalize button |
| `src/pages/registrar/components/SF1Form.tsx` | 135 | SF1 School Register rendering + print |
| `src/components/RolloverBanner.tsx` | 38 | Teacher-facing rollover notification (7-day dismissible) |

---

## 3. Modified Files

| File | What changed |
|------|-------------|
| `server/prisma/schema.prisma` | YearGradeLock, TermGradeLock, PromotionStatus, enrollment cols, Subject.isNonPromotional, SystemSettings retention + transitionLock |
| `server/src/routes/grades-sub/classes.ts` | Guard chain rewired (3 paths: POST /grade, DELETE, clear-scores); class-record includes lock payload |
| `server/src/routes/admin-sub/system.ts` | year-locks GET/POST, term-locks POST, transition-lock POST, rollover-status GET, archive-year POST |
| `server/src/routes/integration.ts` | sync-grades uses promotion lib; isActive filters removed (T5); serviceAuth applied (T8) |
| `server/src/routes/registrar/main.ts` | student-grades: isActive filter removed (T5) |
| `server/src/routes/registrar/eosy.ts` | POST /eosy/finalize, GET /eosy/promotion-status, GET /eosy/unfinalized-sections |
| `server/src/routes/registrar/exports.ts` | GET /export/year-backup (T6) |
| `server/src/index.ts` | Scheduler: per-term/year lock replaces legacy gradeLock; retention cleanup scheduler (A3) |
| `server/src/lib/schoolYearResolver.ts` | Rollover detection in ensureSchoolYearFromEnrollPro (T4) |
| `server/src/lib/sseManager.ts` | broadcastSseEvent generic function |
| `server/src/schemas/admin.ts` | yearLockToggleSchema, termLockToggleSchema, transitionLockSchema |
| `server/src/schemas/registrar.ts` | eosyFinalizeSchema |
| `server/vitest.config.ts` | dotenv.config(), include pattern for src tests only |
| `server/src/routes/auth.ts` | transitionLock check for TEACHER role (T7) |
| `src/lib/api.ts` | adminApi: getYearLocks, toggleYearLock, toggleTermLock, toggleTransitionLock, getRolloverStatus, archiveYear; registrarApi: getEosyPromotionStatus, finalizeEosySection, getEosyUnfinalizedSections, exportYearBackup, getSF1Data, exportSF1; SystemSettings interface: retention + transitionLock fields |
| `src/pages/admin/SystemSettings.tsx` | GradeLocksPanel + RolloverStatusCard + transition lock toggle + retention fields |
| `src/pages/registrar/EOSYFinalization.tsx` | SmartPromotionPanel + year backup download button |
| `src/layouts/TeacherLayout.tsx` | RolloverBanner mounted |
| `src/layouts/AdminLayout.tsx` | RolloverBanner mounted |
| `src/layouts/RegistrarLayout.tsx` | RolloverBanner mounted |
| `src/index.css` | SF1 print CSS (landscape legal) |
| `AGENTS.md` | isActive/isArchived query rule + grade lock precedence gotchas |
| `docs/ENROLLPRO_GRADE_FETCH_API.md` | Auth header spec (x-enrollpro-api-key) |

---

## 4. API Contracts

### Admin Lock API
```
GET  /api/admin/year-locks → { locks: [{schoolYearId, label, status, yearLock, termLocks}] }
POST /api/admin/year-locks/:schoolYearId { locked } → { message, locked }
POST /api/admin/term-locks/:schoolYearId/:term { locked } → { message, locked }
POST /api/admin/settings/transition-lock { locked, note? } → { transitionLock }
GET  /api/admin/rollover-status → { currentSY, previousYear, unfinalizedCount, canArchive }
POST /api/admin/archive-year { schoolYearId } → { message }
```

### EOSY API
```
POST /api/registrar/eosy/finalize { sectionId, schoolYear } → { processed, snapshotsCreated }
GET  /api/registrar/eosy/promotion-status/:sectionId?schoolYear= → { section, enrollments, draftBlockers }
GET  /api/registrar/eosy/unfinalized-sections?schoolYear= → { unfinalizedCount, sections }
```

### Export API
```
GET  /api/registrar/export/year-backup?schoolYear= → .xlsx blob
GET  /api/registrar/export/sf1/:sectionId?schoolYear= → .xlsx blob (existing, unchanged)
```

### Auth (T8)
```
POST /api/integration/smart/sections/:sectionId/sync-grades
  Header: x-enrollpro-api-key: <key>
  If ENROLLPRO_API_KEY env not set, header check skipped (dev mode).
  401 if missing/invalid key.
```

### Auth (T7)
```
POST /api/auth/login
  If transitionLock=true && role=TEACHER → 403 { code: "TRANSITION_LOCKED", message }
  ADMIN/REGISTRAR unaffected.
```

---

## 5. Deviations from Plan

1. **Migration via db push** (not migrate dev): pre-existing drift. Migration file exists for deploy.
2. **`isNonPromotional` flag on Subject** instead of hardcoding HG prefix.
3. **G10 with 1-2 failing → JHS_COMPLETER** (no separate CONDITIONAL_COMPLETER enum).
4. **Wire format for promotionStatus** changed: `"Conditionally Promoted"`, `"JHS Completer"` added. T8 doc updated.
5. **EOSYFinalization.tsx split** into SmartPromotionPanel.tsx (1000-line limit).
6. **SF1Form.tsx extracted** from SchoolForms.tsx (2177 lines, well over limit).
7. **Retention cleanup** uses batched SQL window function for snapshots (not row-by-row).
8. **Rollover detection** in `ensureSchoolYearFromEnrollPro` (schoolYearResolver.ts) — dynamic import of rollover.ts to avoid circular dependency.

---

## 6. Verification

- **Root build:** green (vite)
- **Server build:** green (tsc)
- **Tests:** 49/49 pass (7 test files)
  - `promotion.test.ts`: 15 pure unit tests
  - `year-term-locks.test.ts`: 10 live-server tests (admin API, A1 precedence, EOSY)
  - `auth.test.ts`: 7 tests
  - `grade-lock.test.ts`: 3 tests
  - `csrf.test.ts`: 4 tests
  - `validation.test.ts`: 5 tests
  - `sf10-snapshot.test.ts`: 5 tests
