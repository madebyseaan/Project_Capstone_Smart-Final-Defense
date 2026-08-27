# SMART Rollover Remediation Plan — Comprehensive Implementation Guide

**Based on:** AUDIT_FINDINGS.md (2026-08-20)
**Purpose:** Detailed, dependency-aware implementation plan for rollover readiness
**Rule:** Every change must trace its connections — no孤立 fixes

---

## How to Read This Plan

Each task includes:
- **What:** The exact change
- **Files touched:** Every file that must be modified
- **Dependency chain:** What reads/writes/caches this — what breaks if we get it wrong
- **Risk level:** LOW / MEDIUM / HIGH / CRITICAL
- **Verification:** How to confirm the change works globally
- **Rollback:** How to undo if it breaks

---

## WAVE 1: STABILITY (Do First — Unblocks Everything)

### Task 1.1: Fix Server Crash Loop (ATLAS 502 Handling)

**What:** Add retry logic and graceful degradation to ATLAS sync so a 502 doesn't crash the server.

**Files touched:**
- `server/src/lib/sync/httpClient.ts` — Add retry with exponential backoff (3 attempts, 1s/2s/4s delays)
- `server/src/lib/atlasSync.ts` — Catch 502 errors, log warning, continue sync cycle (don't throw)
- `server/src/lib/syncCoordinator.ts` — If ATLAS fails, continue with EnrollPro + Branding (don't abort entire cycle)

**Dependency chain:**
```
syncCoordinator.ts calls runAtlasSync()
  → atlasSync.ts calls httpClient (get/post)
  → httpClient makes HTTP to ATLAS
  → On 502: currently throws → crashes sync cycle → PM2 restarts server
  → Fix: catch + retry + degrade gracefully
```

**Connected components affected:**
- PM2 process stability (49 restarts → 0)
- SSE connections (no more dropped connections mid-sync)
- In-memory cache (`syncCache.ts`) — no longer lost on restart
- Teacher login sync (`teacherSync.ts`) — depends on cached data from main sync

**Risk:** MEDIUM — Changing error handling behavior. Must not swallow real errors.

**Verification:**
1. Kill ATLAS tunnel → server should continue running
2. Check `pm2 logs` — should see warning, not crash
3. Verify EnrollPro sync still completes when ATLAS is down
4. Verify sync cycle time stays under 30 seconds

**Rollback:** Revert httpClient.ts and atlasSync.ts changes.

---

### Task 1.2: Set NODE_ENV=production

**What:** Change `ecosystem.config.cjs` from `NODE_ENV: 'development'` to `NODE_ENV: 'production'`.

**Files touched:**
- `ecosystem.config.cjs` — Change line 14

**Dependency chain:**
```
NODE_ENV=production affects:
  → tokens.ts: ACCESS_COOKIE_OPTIONS.httpOnly = true (secure)
  → auth.ts: isDevelopment() returns false (developer bypass disabled)
  → Express: production error handling (no stack traces)
  → Vite/proxy: client build mode
```

**Connected components affected:**
- `server/src/lib/tokens.ts:80-86` — Cookie becomes httpOnly (intentional security fix)
- `server/src/middleware/auth.ts` — Developer bypass (`isDeveloper` user) stops working
- `server/src/index.ts` — Error handler changes behavior
- Frontend dev server (`client` PM2 process) — may need separate config

**Risk:** HIGH — Developer bypass will stop working. Cookies change behavior. Must test all three portals.

**Verification:**
1. Test teacher login → should work normally
2. Test admin login → should work normally
3. Test registrar login → should work normally
4. Verify developer user (999999) can still login but cannot bypass role checks
5. Verify no stack traces leak to client responses

**Rollback:** Revert ecosystem.config.cjs, restart PM2.

---

### Task 1.3: Fix 6 TypeScript Errors

**What:** Fix `string | string[]` type mismatches in admin.ts and registrar.ts.

**Files touched:**
- `server/src/routes/admin.ts:2020,2032,2058,2069` — `req.query.*` can be `string | string[]`, needs cast
- `server/src/routes/registrar.ts:620,627` — Same pattern

**Dependency chain:**
```
req.query.param is typed as string | string[] by Express
  → Prisma expects string for where clauses
  → Currently passes string[] → TS error
  → ts-node-dev skips type checking (runs fine)
  → tsc --noEmit fails (6 errors)
  → Server build (tsc) fails
```

**Connected components affected:**
- Server build output (`npm run build` in server/) — will succeed
- No runtime behavior change (ts-node-dev already ignores these)

**Risk:** LOW — Type-only fix, no runtime behavior change.

**Verification:**
1. `cd server && npm run build` — should produce 0 errors
2. `npx tsc --noEmit` in server/ — should produce 0 errors
3. Test the affected endpoints (class assignments, enrollment status)

**Rollback:** Revert the two files.

---

### Task 1.4: Set ENROLLPRO_WEBHOOK_KEY + Startup Validation

**What:** Add a startup check that warns loudly if webhook key is not set, and document the key in .env.example.

**Files touched:**
- `server/src/index.ts` — Add startup validation after dotenv load
- `.env.example` — Add `ENROLLPRO_WEBHOOK_KEY=your-secret-key-here` (documentation only)

**Dependency chain:**
```
ENROLLPRO_WEBHOOK_KEY is checked in integration.ts:72-85
  → If not set: webhook endpoints are UNPROTECTED
  → Anyone can POST to trigger full sync (DoS vector)
  → Anyone can read student grades via sync-grades endpoint
  → Fix: startup warning + document required key
```

**Connected components affected:**
- `server/src/routes/integration.ts` — Already has the check, just needs env var set
- PM2 logs — Warning appears on every restart (50+ times currently)

**Risk:** LOW — Adding validation, not changing behavior.

**Verification:**
1. Remove key from .env → server should log WARNING at startup
2. Set key → warning should not appear
3. Test webhook endpoint with wrong key → should get 401
4. Test webhook endpoint with correct key → should work

**Rollback:** Remove startup check.

---

## WAVE 2: ROLLOVER CORE (The Actual Blocker)

### Task 2.1: SchoolYear Lifecycle (Phase 3 of ROLLOVER-GAP-FIX-PLAN)

**What:** Implement the full SchoolYear lifecycle: FK from SystemSettings, status transitions, admin UI.

**This is the BIGGEST task — touches the most files.**

#### 2.1a: Schema Change — Link SystemSettings to SchoolYear

**Files touched:**
- `server/prisma/schema.prisma` — Add `schoolYearId String?` FK to SystemSettings, add `@@index`

**Dependency chain:**
```
SystemSettings.currentSchoolYear (String) → SchoolYear.label (String)
  Currently: string comparison only (no referential integrity)
  Change: Add schoolYearId FK
  Read: SystemSettings is read by 29 locations across 12 files
  Write: SystemSettings is written by 3 writers (admin UI, branding sync, data sync)
  FK cascade: If SchoolYear deleted, what happens to SystemSettings?
    → Need: onDelete: SetNull (don't cascade delete settings)
```

**Connected components affected:**
- ALL routes that read `systemSettings.currentSchoolYear` (29 locations)
- `enrollproBrandingSync.ts` — writes `currentSchoolYear` string
- `enrollproSync.ts` — writes `currentSchoolYear` string
- Admin UI — `SystemSettings.tsx` dropdown
- Migration needed: `prisma migrate dev`

**Risk:** HIGH — Schema change affects every route that reads settings.

**Verification:**
1. Run migration → verify no data loss
2. Verify existing SystemSettings row still works
3. Test all three portals after migration

**Rollback:** Revert schema, run `prisma migrate reset` on dev only.

#### 2.1b: Server-Side SchoolYear Resolution Helper

**Files touched:**
- NEW: `server/src/lib/schoolYearResolver.ts` — Central helper that returns the active SchoolYear object
- `server/src/routes/grades.ts` — Replace 6 `?? '2026-2027'` with helper call
- `server/src/routes/advisory.ts` — Replace 2 fallbacks
- `server/src/routes/integration.ts` — Replace 4 fallbacks
- `server/src/routes/registrar.ts` — Replace 3 fallbacks + update `resolveCurrentSchoolYearLabel()`
- `server/src/routes/admin.ts` — Replace 3 fallbacks
- `server/src/lib/atlasSync.ts` — Replace 1 fallback
- `server/src/lib/enrollproClient.ts` — Replace 1 fallback
- `server/src/lib/teacherSync.ts` — Replace 1 fallback
- `server/src/lib/ensureDevAccount.ts` — Replace 1 fallback
- `server/src/lib/enrollproSync.ts` — Update school year resolution
- `server/src/lib/teacherDashboardComposer.ts` — Update school year resolution

**Dependency chain:**
```
NEW schoolYearResolver.ts:
  → Reads SystemSettings from DB (with cache, 5-min TTL)
  → Returns { id, label, status, startDate, endDate }
  → Throws if no active SchoolYear found
  → Used by: grades.ts, advisory.ts, integration.ts, registrar.ts,
             admin.ts, atlasSync.ts, enrollproClient.ts, teacherSync.ts,
             ensureDevAccount.ts, enrollproSync.ts, teacherDashboardComposer.ts

ALL 22 hardcoded fallbacks replaced with:
  const schoolYear = await getActiveSchoolYear();
  // Use schoolYear.label instead of '2026-2027'
```

**Connected components affected:**
- Every route that uses school year — they all call the same helper
- Cache invalidation: when SchoolYear changes, cache must invalidate
- `syncCache.ts` — may need to add school year to cache invalidation

**Risk:** HIGH — 12 files changed, one missed location = bug.

**Verification:**
1. All 22 hardcoded fallbacks removed (grep for `'2026-2027'` in server/src/)
2. Test teacher grade submission → should use active year
3. Test registrar forms → should use active year
4. Test admin class assignments → should use active year
5. Test ATLAS sync → should use active year
6. Test EnrollPro sync → should use active year
7. Change active year in admin → all endpoints should reflect change immediately

**Rollback:** Revert all files, restore hardcoded fallbacks.

#### 2.1c: Frontend School Year Resolution

**Files touched:**
- `src/pages/admin/ClassAssignments.tsx` — Replace hardcoded `SCHOOL_YEARS` array with API call
- `src/pages/admin/SystemSettings.tsx` — Replace hardcoded dropdown with API-driven options
- `src/pages/registrar/StudentRecords.tsx` — Replace hardcoded default with API response
- `src/pages/registrar/SchoolForms.tsx` — Replace hardcoded default with API response
- `src/pages/teacher/Dashboard.tsx` — Replace hardcoded display fallback
- `src/lib/api.ts` — Add `getSchoolYears()` API function if not exists

**Dependency chain:**
```
Frontend hardcoded years → Admin UI creates SchoolYears
  → Admin creates "2027-2028" via SchoolYears.tsx
  → Frontend dropdowns should show all years from API
  → Currently: hardcoded list only shows 2026-2027 and 2025-2026
```

**Risk:** MEDIUM — UI-only changes, no data integrity risk.

**Verification:**
1. Create new SchoolYear in admin → appears in all dropdowns
2. Set new year as active → all pages reflect change
3. Old year sections still accessible via filter

**Rollback:** Revert frontend files.

---

### Task 2.2: Seed SchoolYear Records in Production

**What:** Create SchoolYear records for all years that have data in the system.

**Files touched:**
- NEW: `server/scripts/seed-school-years.ts` — One-time migration script

**Dependency chain:**
```
Production DB has sections for: 2023-2024, 2024-2025, 2025-2026, 2026-2027
  → Create SchoolYear records for each
  → Set 2026-2027 as ACTIVE
  → Others as COMPLETED or ARCHIVED
  → Link SystemSettings.schoolYearId to 2026-2027 record
```

**Connected components affected:**
- SchoolYear CRUD in admin UI — will now show records
- `schoolYearResolver.ts` — will find active year
- Grade archival — will reference SchoolYear

**Risk:** LOW — One-time seed, read-only on existing data.

**Verification:**
1. Query SchoolYear table → 4 records
2. Query SystemSettings → schoolYearId points to 2026-2027
3. Admin UI → School Years page shows all years

**Rollback:** Delete SchoolYear records, set schoolYearId to null.

---

### Task 2.3: Fix clear-scores Archive Bypass (C3)

**What:** Add `isArchived` check to `POST /clear-scores` endpoint.

**Files touched:**
- `server/src/routes/grades.ts:733-797` — Before deleting grades, check if any are archived

**Dependency chain:**
```
POST /clear-scores deletes ALL grades for a classAssignment + term
  → Currently: no isArchived check
  → If grades are archived (post-EOSY), they can be wiped
  → Connected: GradeSnapshot (audit trail), SF10 (permanent records)
  → Fix: Query grades first, reject if any are archived
```

**Connected components affected:**
- Teacher ClassRecordView.tsx — "Clear Scores" button should show error if archived
- GradeSnapshot — won't be orphaned
- SF10 — historical grades preserved

**Risk:** LOW — Adding a guard, not changing existing behavior for non-archived grades.

**Verification:**
1. Create grades, archive them, try clear-scores → should get 403
2. Create grades (not archived), clear-scores → should work
3. Verify GradeSnapshot entries preserved

**Rollback:** Remove the check.

---

### Task 2.4: Seed Historical Grades (B5)

**What:** Run `seed-historical.ts` against production to populate SF10 Permanent Records.

**Files touched:**
- `server/prisma/seed-historical.ts` — Already exists, needs review
- Production DB: Grade, ClassAssignment, Enrollment, Section tables

**Dependency chain:**
```
seed-historical.ts creates:
  → Sections for 2023-2024, 2024-2025, 2025-2026 (Grade 7-9)
  → ClassAssignments (isActive=false) linked to those sections
  → Enrollments for 80 students across those sections
  → Grades (T1/T2/T3) for all subjects across all years

Connected:
  → SF10 (registrar:1498) reads multi-year grades
  → SF9 (registrar:1683) reads grade profiles
  → Alumni (registrar:573) reads historical enrollments
  → Grade outcomes endpoint (integration.ts) reads final averages
```

**Risk:** MEDIUM — Creates fake data that looks real. Must verify it doesn't conflict with EnrollPro-synced data.

**Verification:**
1. Run seed → check Grade count increased
2. Check SF10 for a student → shows multi-year grades
3. Check no duplicate enrollments with EnrollPro data
4. Verify grade calculations match expected values

**Rollback:** Delete seeded records (they have distinct schoolYear values).

---

### Task 2.5: Implement Auto-Term Cron (B6)

**What:** Implement the auto-term advancement scheduler that advances T1→T2→T3 based on SystemSettings dates.

**Files touched:**
- `server/src/index.ts:205` — Already has scheduler skeleton, implement logic
- `server/src/routes/admin.ts:1045` — Term advance endpoint (reference implementation)
- `server/src/routes/grades.ts` — `resolveTermDeadline` reads `currentTerm` (verify it works with auto-advance)

**Dependency chain:**
```
SystemSettings has:
  → autoAdvanceTerm: Boolean (currently false)
  → t1StartDate, t1EndDate, t2StartDate, t2EndDate, t3StartDate, t3EndDate
  → currentTerm: T1/T2/T3

Auto-term cron:
  → Checks every hour (already scheduled)
  → If autoAdvanceTerm=true AND current date > t1EndDate → advance to T2
  → If current date > t2EndDate → advance to T3
  → Writes: SystemSettings.currentTerm

Connected:
  → grades.ts uses currentTerm for deadline checks
  → Teacher dashboard shows current term
  → Grade submission uses term for quarter field
  → EOSY finalization depends on T3 completion
```

**Risk:** MEDIUM — Automated state change. Must not advance during active grading.

**Verification:**
1. Set t1EndDate to yesterday → should advance to T2
2. Set autoAdvanceTerm=false → should NOT advance
3. Check audit log for term advancement
4. Verify grades can still be submitted after advancement

**Rollback:** Set autoAdvanceTerm=false, manually reset currentTerm.

---

### Task 2.6: EOSY Grade Lock (B7)

**What:** Auto-lock grades after EOSY finalization (registrar marks section as finalized).

**Files touched:**
- `server/src/routes/grades.ts:477-479` — Add EOSY status check alongside isArchived check
- `server/src/routes/registrar.ts` — EOSYFinalization endpoints (if they write status)
- `server/prisma/schema.prisma` — Consider adding `eosyLocked` field to Section or Grade

**Dependency chain:**
```
Currently:
  → Grades are editable until admin runs archive-year
  → No EOSY-specific lock
  → Registrar views EOSY records but cannot lock them

Fix:
  → When registrar finalizes EOSY for a section → set eosyLocked=true
  → POST /grade checks eosyLocked → returns 403
  → clear-scores checks eosyLocked → returns 403

Connected:
  → Teacher ClassRecordView.tsx — "Save" button should be disabled when locked
  → Grade deadline banner — should show "EOSY finalized" status
  → SF9/SF10 — read-only after lock
```

**Risk:** MEDIUM — New state machine behavior. Must not lock grades prematurely.

**Verification:**
1. Teacher submits grades → should work
2. Registrar finalizes EOSY → teacher cannot edit
3. Admin runs archive-year → grades doubly locked
4. Teacher sees "EOSY finalized" message

**Rollback:** Remove eosyLocked check.

---

## WAVE 3: SECURITY & QUALITY

### Task 3.1: Global Rate Limiting (C2)

**What:** Add Express rate limiter middleware to all routes.

**Files touched:**
- NEW: `server/src/middleware/rateLimiter.ts` — Rate limiter middleware
- `server/src/index.ts` — Apply rate limiter globally

**Dependency chain:**
```
Currently: Only auth.ts has rate limiting (5/15min)
  → All other endpoints unprotected
  → Admin, grades, sync endpoints vulnerable

Fix:
  → Global: 100 req/min per IP
  → Auth: 5 req/15min (existing)
  → Sync: 10 req/min (prevent abuse)
  → Upload: 5 req/min (prevent storage exhaustion)
```

**Connected components affected:**
- All API consumers (frontend, webhooks, external systems)
- Webhooks need higher limits or separate bucket

**Risk:** LOW — Additive middleware, existing behavior preserved.

**Verification:**
1. Normal usage → no rate limiting triggered
2. Rapid requests → 429 response after limit
3. Webhooks → not affected (separate path or higher limit)

**Rollback:** Remove middleware.

---

### Task 3.2: CORS for Production (C3)

**What:** Add configurable CORS origin via environment variable.

**Files touched:**
- `server/src/index.ts:48-51` — Read CORS_ORIGIN from env
- `.env.example` — Document CORS_ORIGIN

**Dependency chain:**
```
Currently: CORS allows only localhost:5173/5174/5175/3000
  → Production deployment to any domain will fail
  → All API calls from browser will be blocked

Fix:
  → CORS_ORIGIN env var (comma-separated origins)
  → Default: localhost origins (development)
  → Production: set to deployed domain
```

**Risk:** LOW — Configuration change.

**Verification:**
1. Dev mode → localhost works
2. Production → set CORS_ORIGIN to domain → works
3. Cross-origin requests from wrong origin → blocked

**Rollback:** Revert index.ts.

---

### Task 3.3: Fix Error Message Leaks (C6)

**What:** Replace `error.message` in responses with generic messages; log details server-side.

**Files touched:**
- `server/src/routes/attendance.ts` — 6 locations
- `server/src/routes/admin.ts` — 5 locations
- `server/src/routes/sync.ts` — 3 locations
- `server/src/routes/templates.ts` — 10+ locations
- `server/src/routes/integration.ts` — 1 location

**Dependency chain:**
```
Currently: `res.status(500).json({ error: error.message })`
  → Leaks: DB error messages, file paths, internal stack info
  → Attacker can use to fingerprint DB type, find vulnerabilities

Fix:
  → Log error with logger.error(error)
  → Return: { error: "Internal server error" }
  → Keep specific messages for expected errors (400, 404, 403)
```

**Connected components affected:**
- Frontend error handling — currently may display error.message
- PM2 logs — will now have full error details

**Risk:** LOW — Improving security, no behavior change for valid requests.

**Verification:**
1. Trigger server error → client sees generic message
2. Check PM2 logs → full error details logged
3. Frontend still shows user-friendly error toasts

**Rollback:** Revert files.

---

### Task 3.4: Delete Dead Files (C9)

**What:** Remove unused files that cause 993 lint errors.

**Files to delete:**
- `server/src/lib/unused/aimsClient.ts`
- `server/src/lib/unused/enrollproClient.ts`
- `(unused files)/` directory (15+ scripts)
- `server/check-programs.ts`

**Dependency chain:**
```
These files are NOT imported by anything
  → Delete safe
  → Lint errors drop from 1008 to ~15
  → No runtime impact
```

**Risk:** LOW — Dead code removal.

**Verification:**
1. `npm run lint` — errors drop to <20
2. `npm run build` — still succeeds
3. Server starts normally

**Rollback:** Restore from git.

---

## WAVE 4: INTEGRATION VERIFICATION

### Task 4.1: Verify Grade Outcomes Endpoint (B8)

**What:** Test that `POST /api/integration/smart/sections/:sectionId/sync-grades` returns correct data.

**Files touched:**
- `server/src/routes/integration.ts:134-318` — The endpoint itself
- No code changes — verification only

**Dependency chain:**
```
EnrollPro calls this endpoint per section during EOSY
  → SMART must return: { finalGeneralAverage, finalOutcome, publishedAt }
  → finalOutcome must be one of: PROMOTED, CONDITIONALLY_PROMOTED, RETAINED, DROPPED_OUT, TRANSFERRED_OUT
  → Grade 10 PROMOTED → JHS_COMPLETER

Connected:
  → grades.ts — Grade records must exist with quarterlyGrade
  → advisory.ts — StudentGradeProfile computes finalOutcome
  → seed-historical.ts — Historical grades must be present
  → enrollment.status — Must reflect student status
```

**Verification:**
1. Call endpoint with a section that has grades → verify response shape
2. Call with section without grades → verify proper error
3. Verify all 80 students have grade outcomes
4. Cross-check with EnrollPro expected format

---

### Task 4.2: Fix STE/SPA/SPS Subject Types (B4)

**What:** Fix subject type detection in ATLAS sync so SPA/SPS subjects get correct weight groups.

**Files touched:**
- `server/src/lib/atlasSync.ts` — Add subject code prefix detection
- `server/src/lib/atlasUtils.ts` — Update subject type mapping

**Dependency chain:**
```
ATLAS sync creates Subject records with type field
  → Currently: ALL default to CORE (20/50/30 weights)
  → SPA subjects should be MAPEH (20/60/20)
  → SPS subjects should be MAPEH (20/60/20)
  → TLE subjects should be TLE (20/60/20)

Connected:
  → GradingConfig lookup: Subject.type → GradingConfig.subjectType
  → Grade calculation: weights applied per subject type
  → ECR generation: weights injected per subject type
  → SF9/SF10: display grades computed with wrong weights if type wrong
```

**Risk:** MEDIUM — Affects grade calculations for ~87 subjects.

**Verification:**
1. Check Subject table after sync — types are correct
2. Verify GradingConfig lookup returns correct weights
3. Calculate a sample grade manually → matches system output

**Rollback:** Revert atlasUtils.ts.

---

## IMPLEMENTATION ORDER (Dependency Graph)

```
Wave 1 (Stability):
  1.1 Fix crash loop ──────────────────────┐
  1.2 NODE_ENV=production ─────────────────┤
  1.3 Fix TS errors ───────────────────────┤
  1.4 Webhook key validation ──────────────┘
                                            │
                                            ▼
Wave 2 (Rollover Core):
  2.1a Schema change (FK) ─────────────────┐
  2.1b Server year resolver ───────────────┤ (depends on 2.1a)
  2.1c Frontend year resolution ───────────┤ (depends on 2.1b)
  2.2 Seed SchoolYear records ─────────────┤ (depends on 2.1a)
  2.3 Fix clear-scores bypass ─────────────┤ (independent)
  2.4 Seed historical grades ──────────────┤ (depends on 2.2)
  2.5 Auto-term cron ──────────────────────┤ (depends on 2.1b)
  2.6 EOSY grade lock ─────────────────────┘ (depends on 2.1b)
                                            │
                                            ▼
Wave 3 (Security & Quality):
  3.1 Global rate limiting ────────────────┐
  3.2 CORS production ─────────────────────┤
  3.3 Fix error leaks ─────────────────────┤
  3.4 Delete dead files ───────────────────┘
                                            │
                                            ▼
Wave 4 (Verification):
  4.1 Grade outcomes endpoint ─────────────┐
  4.2 Fix STE/SPA/SPS types ───────────────┘
```

---

## TESTING STRATEGY

### Before Each Wave
1. Run `npm run lint` — record error count
2. Run `cd server && npm run build` — must succeed
3. Run `pm2 list` — record restart counts
4. Run `pm2 logs --nostream --lines 20` — note current state

### After Wave 1 (Stability)
1. Kill ATLAS tunnel → server should NOT crash
2. Check PM2 → restart count should stabilize
3. Test all three login portals
4. Run full sync → verify no data corruption

### After Wave 2 (Rollover Core)
1. Grep for `'2026-2027'` in server/src/ → should find 0
2. Create new SchoolYear in admin → appears everywhere
3. Test teacher grade submission → uses active year
4. Test registrar SF10 → shows multi-year data
5. Test archive-year → grades locked
6. Try clear-scores on archived grades → blocked
7. Verify auto-term advancement (set date to yesterday)

### After Wave 3 (Security)
1. Rate limiting → rapid requests get 429
2. CORS → cross-origin blocked without proper origin
3. Error messages → generic on server errors
4. Lint errors → <20

### After Wave 4 (Verification)
1. Call sync-grades endpoint → verify response
2. Check subject types → correct weight groups
3. Full sync cycle → no errors

---

## RISK SUMMARY

| Wave | Tasks | Files Changed | Risk Level | Estimated Time |
|------|-------|---------------|------------|----------------|
| Wave 1 | 4 | 5 files | LOW-MEDIUM | 4-6 hours |
| Wave 2 | 6 | 25+ files | HIGH | 3-5 days |
| Wave 3 | 4 | 20+ files | LOW | 1-2 days |
| Wave 4 | 2 | 2 files | LOW | 2-4 hours |
| **Total** | **16** | **50+ files** | | **5-8 days** |

---

## CRITICAL PATH

The rollover CANNOT proceed until:
1. ✅ Wave 1 complete (server stable)
2. ✅ Task 2.1a-2.1b complete (SchoolYear lifecycle + resolver)
3. ✅ Task 2.2 complete (SchoolYear records seeded)
4. ✅ Task 2.4 complete (historical grades seeded)
5. ✅ Task 4.1 verified (grade outcomes endpoint works)
6. ✅ EnrollPro confirms they can pull grade outcomes

**Everything else can happen in parallel or after rollover.**

---

*Plan created 2026-08-20. All tasks verified against AUDIT_FINDINGS.md and codebase dependency analysis.*
