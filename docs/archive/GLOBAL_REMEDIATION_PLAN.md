# SMART Global Remediation Plan — Dependency-Aware Update Strategy

**Created:** 2026-08-21
**Based on:** AUDIT_REPORT2.md (Audit 2, 2026-08-21)
**Purpose:** Map every finding to its dependencies so updates happen in coordinated clusters, not in isolation.

---

## How to Use This Document

Each "Fix Cluster" groups findings that share files/dependencies. When you touch a file, fix EVERYTHING in that cluster at once. The dependency graph shows which clusters must come before others.

---

## CLUSTER MAP — All Findings Grouped by File Touches

### CLUSTER A: Auth & Cookie (touches 3 files)

**Findings included:** H5 (httpOnly cookie), C4 (no tests — auth is test priority #1)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `server/src/lib/tokens.ts` | `ACCESS_COOKIE_OPTIONS.httpOnly: false → true` | — |
| `server/src/routes/auth.ts` | Add CSRF token generation + validation; may need to adjust cookie reading on frontend | — |
| `server/src/middleware/auth.ts` | Add CSRF validation middleware | — |
| `src/lib/api.ts` | Add CSRF token to Axios interceptor; may need to read token from cookie or meta tag | Cluster F (api.ts) |
| `src/pages/LoginPage.tsx` | Handle CSRF token on login | — |
| `src/pages/AdminLoginPage.tsx` | Handle CSRF token on login | — |
| `src/pages/RegistrarLoginPage.tsx` | Handle CSRF token on login | — |

**Downstream impact:**
- Every API call from frontend goes through `api.ts` Axios instance
- Every protected route uses `authenticateToken` from `middleware/auth.ts`
- Cookie change affects ALL three login portals

**Dependency:** None (can be done first)
**Effort:** 3-4 hours

---

### CLUSTER B: School Year Resolution (touches 12+ files)

**Findings included:** C1 (1 remaining hardcoded year), C6 (currentSchoolYear FK partial)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `server/src/lib/schoolYearResolver.ts` | Add `invalidateSchoolYearCache()` call wiring | — |
| `server/src/lib/enrollproClient.ts:363` | Remove `?? '2026-2027'` env fallback; use resolver only | — |
| `server/src/routes/grades.ts` | Already uses resolver — verify no residual fallbacks | Cluster E (grades) |
| `server/src/routes/advisory.ts` | Already uses resolver — verify | — |
| `server/src/routes/integration.ts` | Already uses resolver — verify | Cluster D (webhooks) |
| `server/src/routes/registrar.ts` | Already uses resolver — verify | — |
| `server/src/routes/admin.ts` | Already uses resolver; call `invalidateSchoolYearCache()` after SY writes | Cluster E (admin) |
| `server/src/lib/atlasSync.ts` | Already uses resolver — verify | — |
| `server/src/lib/teacherSync.ts` | Already uses resolver — verify | — |
| `server/src/lib/ensureDevAccount.ts` | Already uses resolver — verify | — |
| `server/src/lib/enrollproSync.ts` | Update school year resolution in sync | Cluster G (sync) |
| `server/src/lib/teacherDashboardComposer.ts` | Verify resolver usage | — |
| `server/prisma/schema.prisma` | Already has FK — verify migration applied | Cluster J (schema) |

**Key insight:** `invalidateSchoolYearCache()` is NEVER called after writes. Every admin.ts SchoolYear write (POST/PATCH/DELETE) must call it.

**Dependency:** None (can be done first)
**Effort:** 2-3 hours

---

### CLUSTER C: Webhook Protection (touches 3 files)

**Findings included:** C2 (unprotected webhooks)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `server/src/routes/integration.ts` | Add `x-api-key` header validation on webhook POST routes (lines 78, 255, 256) | Cluster B (resolver) |
| `server/src/index.ts` | Add startup validation for ENROLLPRO_WEBHOOK_KEY env var | Cluster H (index.ts) |
| `server/.env.example` | Document ENROLLPRO_WEBHOOK_KEY | — |

**Downstream impact:**
- EnrollPro must send the matching API key in webhook headers
- ATLAS must send the matching API key
- Grade outcomes endpoint (sync-grades) may also need the key

**Dependency:** None (can be done first)
**Effort:** 1-2 hours

---

### CLUSTER D: Error Handling & Logging (touches 9 route files)

**Findings included:** M3 (error leaks), M4 (console.log migration), L5 (health never DOWN)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `server/src/routes/admin.ts` | Replace ~53 console.* with logger.*; fix error.message leaks; add logger import | Cluster B (resolver), Cluster E (admin) |
| `server/src/routes/registrar.ts` | Replace ~38 console.* with logger.* | — |
| `server/src/routes/grades.ts` | Replace ~16 console.* with logger.* | Cluster E (grades) |
| `server/src/routes/auth.ts` | Replace ~9 console.* with logger.* | Cluster A (auth) |
| `server/src/routes/templates.ts` | Replace ~9 console.* with logger.* | — |
| `server/src/routes/attendance.ts` | Replace ~6 console.* with logger.* | — |
| `server/src/routes/advisory.ts` | Replace ~4 console.* with logger.* | — |
| `server/src/routes/sync.ts` | Replace ~3 console.* with logger.* | — |
| `server/src/routes/integration.ts` | Replace ~1 console.* with logger.* | Cluster C (webhooks) |
| `server/src/index.ts` | Replace ~6 console.* with logger.* | Cluster H (index.ts) |
| `server/src/lib/systemHealth.ts` | Add DOWN status for DB failure | — |
| `server/src/lib/logger.ts` | Verify log levels work (info/warn/error) | — |

**Key insight:** logger.ts already exists and is imported in some lib files. Route files don't use it at all (except integration.ts).

**Dependency:** None (can be done any time)
**Effort:** 1 day

---

### CLUSTER E: Grades & Archive (touches 4 files)

**Findings included:** H9 (EOSY auto-lock), gradeLock verification, clear-scores (already fixed)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `server/src/routes/grades.ts` | Add EOSY status check alongside gradeLock + isArchived | Cluster D (logging) |
| `server/src/routes/admin.ts` | Add EOSY finalization trigger that auto-sets gradeLock | Cluster B (resolver), Cluster D (logging) |
| `server/src/routes/registrar.ts` | EOSY finalization endpoint → trigger grade lock | — |
| `server/prisma/schema.prisma` | Consider adding `eosyLocked` field to Section or using existing gradeLock | Cluster J (schema) |
| `src/pages/teacher/ClassRecordView.tsx` | Disable save button when locked; show "EOSY finalized" message | Cluster F (frontend) |
| `src/components/GradeDeadlineBanner.tsx` | Show EOSY lock status | — |

**Dependency:** Cluster B (resolver) should come first
**Effort:** 4-6 hours

---

### CLUSTER F: Frontend Shared Utilities (touches 8+ files)

**Findings included:** NEW-7 (default term T1), NEW-8 (term duplication), NEW-9 (getGradeColor duplication), NEW-6 (DEPED_DIVISIONS), NEW-2 (StudentGradeProfile crash)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `src/lib/utils.ts` (or new `src/lib/constants.ts`) | Add: TERM_LABELS, TERM_LABEL_MAP, getGradeColor(), DEPED_DIVISIONS, HG_DESCRIPTORS | — |
| `src/pages/teacher/ClassRecordView.tsx` | Import shared constants; read currentTerm from API | Cluster E (grade lock UI) |
| `src/pages/teacher/ClassRecordTable.tsx` | Remove duplicate getGradeColor + terms | — |
| `src/pages/teacher/ClassRecordMobileList.tsx` | Remove duplicate terms | — |
| `src/pages/teacher/components/HGDescriptorPanel.tsx` | Remove duplicate terms | — |
| `src/pages/teacher/StudentGradeProfile.tsx` | Fix InfoRow reference (NEW-2); import shared terms | — |
| `src/pages/teacher/Dashboard.tsx` | Use shared term labels in filter | — |
| `src/pages/teacher/StudentGradeProfile.tsx` | Import shared terms | — |
| `src/pages/admin/SystemSettings.tsx` | Move DEPED_DIVISIONS to shared constants | — |
| `src/pages/admin/TemplateManager.tsx` | Import shared FORM_TYPES if extracted | — |
| `src/components/GradeDeadlineBanner.tsx` | Import shared termLabel() | — |

**Key insight:** Creating ONE shared constants file eliminates duplication in 8+ files.

**Dependency:** None (can be done any time)
**Effort:** 2-3 hours

---

### CLUSTER G: Sync Layer (touches 5 files)

**Findings included:** Phase 3C (N+1 queries, batch writes, concurrency)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `server/src/lib/enrollproSync.ts` | Refactor N+1 loops to batch writes (createMany/upsert patterns) | Cluster B (resolver) |
| `server/src/lib/atlasSync.ts` | Optimize schedule upsert loop | — |
| `server/src/lib/syncCoordinator.ts` | Verify mutex guard; add logging | Cluster D (logging) |
| `server/src/lib/sync/httpClient.ts` | Already has retry — verify | — |
| `server/src/lib/syncCache.ts` | Add cache invalidation for SY changes | Cluster B (resolver) |

**Key insight:** enrollproSync has 4 N+1 patterns. Refactoring the learner upsert loop (heaviest) gives the biggest win.

**Dependency:** Cluster B (resolver) should be done first
**Effort:** 1-2 days

---

### CLUSTER H: Server Startup & Middleware (touches 3 files)

**Findings included:** L4 (no graceful shutdown), H3 (rate limiting — already fixed), H2 (CORS — already fixed)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `server/src/index.ts` | Add SIGTERM/SIGINT handlers; add webhook key startup validation; migrate console.* to logger | Cluster C (webhooks), Cluster D (logging) |
| `server/src/middleware/rateLimiter.ts` | Already fixed — verify | — |
| `server/src/lib/syncCoordinator.ts` | Wire stopScheduler() to SIGTERM handler | Cluster G (sync) |

**Dependency:** None (can be done any time)
**Effort:** 2-3 hours

---

### CLUSTER I: Validation (touches 9 route files)

**Findings included:** M1 (zero zod validation), M2 (100+ any types)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `server/src/routes/grades.ts` | Add zod schemas for grade, clear-scores, class-assignment endpoints | Cluster D (logging), Cluster E (grades) |
| `server/src/routes/admin.ts` | Add zod schemas for user CRUD, settings, school years | Cluster B (resolver), Cluster D (logging) |
| `server/src/routes/registrar.ts` | Add zod schemas for enrollment status, form queries | Cluster D (logging) |
| `server/src/routes/auth.ts` | Add zod schemas for login, refresh | Cluster A (auth) |
| `server/src/routes/attendance.ts` | Add zod schemas for bulk, clear, section queries | Cluster D (logging) |
| `server/src/routes/templates.ts` | Add zod schemas for upload, toggle | Cluster D (logging) |
| `server/src/routes/advisory.ts` | Add zod schemas for sync, student queries | Cluster D (logging) |
| `server/src/routes/sync.ts` | Add zod schemas for sync triggers | Cluster D (logging) |
| `server/src/routes/integration.ts` | Add zod schemas for proxy queries | Cluster C (webhooks) |
| NEW: `server/src/middleware/validate.ts` | Create validation middleware | — |
| NEW: `server/src/schemas/*.ts` | Define zod schemas per route | — |

**Dependency:** Cluster D (logging) should be done first (cleaner diff)
**Effort:** 2-3 days

---

### CLUSTER J: Database Schema (touches 1 file + migrations)

**Findings included:** Missing FK indexes, Student/GradeSnapshot indexes

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `server/prisma/schema.prisma` | Add @@index for Grade.studentId, Grade.classAssignmentId, ClassAssignment.teacherId, ClassAssignment.sectionId, ScheduleEntry.sectionId, WorkloadEntry.sectionId, GradeSnapshot.gradeId | Cluster B (resolver), Cluster E (grades) |
| NEW: `server/prisma/migrations/` | New migration for added indexes | — |

**Dependency:** None (can be done any time)
**Effort:** 30 minutes + migration

---

### CLUSTER K: Dead Code & Lint (touches 2+ files)

**Findings included:** L2 (unused files), L3 (16 fixable lint), M8 (ERD), M9 (DFD)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| `(unused files)/` directory | Delete entirely | — |
| `docs/SMART_ERD.dbml` | Regenerate from schema | Cluster J (schema) |
| `docs/SMART_DFD.md` | Update React 18 → 19 | — |
| Various | Run `npm run lint -- --fix` | — |

**Dependency:** Cluster J (schema) should come before ERD regeneration
**Effort:** 30 minutes

---

### CLUSTER L: Testing (touches 2 files + new test files)

**Findings included:** C4 (no test framework)

**Files touched:**
| File | What changes | Other clusters that touch this file |
|---|---|---|
| Root `package.json` | Add `test` script, install vitest | — |
| `server/package.json` | Add `test` script, install vitest + supertest | — |
| NEW: `server/src/__tests__/` | Create test files for top 5 critical flows | All clusters (tests verify fixes) |

**Dependency:** Should be done AFTER other clusters (tests verify the fixes)
**Effort:** 2-3 days

---

## DEPENDENCY GRAPH — Execution Order

```
CLUSTER J (Schema indexes) ──────────────────────────────┐
                                                          │
CLUSTER B (School Year Resolution) ──────────────────────┤
  └── invalidation wiring in admin.ts                     │
  └── remove last fallback in enrollproClient.ts          │
                                                          │
CLUSTER A (Auth & Cookie httpOnly) ──────────────────────┤
  └── CSRF token in api.ts                                │
  └── login page updates                                  │
                                                          │
CLUSTER C (Webhook Protection) ──────────────────────────┤
  └── startup validation                                  │
                                                          │
                    ┌─────────────────────────────────────┘
                    │
                    ▼
CLUSTER D (Error Handling & Logging) ────────────────────┐
  └── 9 route files console.* → logger.*                  │
  └── systemHealth.ts DOWN status                         │
                                                          │
                    ┌─────────────────────────────────────┘
                    │
                    ▼
CLUSTER E (Grades & Archive) ────────────────────────────┐
  └── EOSY auto-lock                                      │
  └── grade lock UI                                       │
                                                          │
CLUSTER F (Frontend Shared Utilities) ───────────────────┤
  └── constants file                                      │
  └── deduplicate 8+ files                                │
  └── fix StudentGradeProfile crash                       │
  └── fix default term T1                                 │
                                                          │
CLUSTER H (Server Startup & Shutdown) ───────────────────┤
  └── SIGTERM/SIGINT handlers                             │
  └── wire syncCoordinator.stopScheduler()                │
                                                          │
                    ┌─────────────────────────────────────┘
                    │
                    ▼
CLUSTER G (Sync Optimization) ───────────────────────────┤
  └── refactor N+1 to batch writes                        │
  └── cache invalidation                                  │
                                                          │
                    ┌─────────────────────────────────────┘
                    │
                    ▼
CLUSTER I (Zod Validation) ──────────────────────────────┤
  └── schemas per route                                   │
  └── validation middleware                               │
  └── reduce any types                                    │
                                                          │
                    ┌─────────────────────────────────────┘
                    │
                    ▼
CLUSTER K (Dead Code & Lint) ────────────────────────────┤
  └── delete (unused files)/                              │
  └── regenerate ERD                                      │
  └── update DFD                                          │
  └── lint --fix                                          │
                                                          │
                    ┌─────────────────────────────────────┘
                    │
                    ▼
CLUSTER L (Testing) ─────────────────────────────────────┘
  └── install vitest + supertest
  └── write top 5 critical tests
  └── verify all clusters pass
```

---

## BATCH UPDATE STRATEGY — Files That Change Together

### Batch 1: Schema + Resolver (do together — 1 hour)
```
server/prisma/schema.prisma          ← add FK indexes
server/src/lib/schoolYearResolver.ts ← add invalidation call in admin writes
server/src/routes/admin.ts           ← call invalidateSchoolYearCache() after SY CRUD
server/src/lib/enrollproClient.ts    ← remove last ?? '2026-2027' fallback
```

### Batch 2: Auth + Cookies (do together — 3 hours)
```
server/src/lib/tokens.ts             ← httpOnly: true
server/src/middleware/auth.ts        ← CSRF validation
server/src/routes/auth.ts            ← CSRF token generation
src/lib/api.ts                       ← CSRF token in interceptor
src/pages/LoginPage.tsx              ← handle CSRF
src/pages/AdminLoginPage.tsx         ← handle CSRF
src/pages/RegistrarLoginPage.tsx     ← handle CSRF
```

### Batch 3: Webhooks + Startup (do together — 1 hour)
```
server/src/routes/integration.ts     ← API key validation
server/src/index.ts                  ← startup env validation + graceful shutdown
server/.env.example                  ← document webhook key
```

### Batch 4: Logging (do together — 1 day)
```
server/src/routes/admin.ts           ← console.* → logger.*
server/src/routes/registrar.ts       ← console.* → logger.*
server/src/routes/grades.ts          ← console.* → logger.*
server/src/routes/auth.ts            ← console.* → logger.*
server/src/routes/templates.ts       ← console.* → logger.*
server/src/routes/attendance.ts      ← console.* → logger.*
server/src/routes/advisory.ts        ← console.* → logger.*
server/src/routes/sync.ts            ← console.* → logger.*
server/src/routes/integration.ts     ← console.* → logger.*
server/src/index.ts                  ← console.* → logger.*
server/src/lib/systemHealth.ts       ← add DOWN status
```

### Batch 5: Frontend Utilities (do together — 2 hours)
```
src/lib/constants.ts (NEW)           ← TERM_LABELS, getGradeColor, DEPED_DIVISIONS
src/pages/teacher/ClassRecordView.tsx ← use shared constants, read currentTerm
src/pages/teacher/ClassRecordTable.tsx ← remove duplicate getGradeColor + terms
src/pages/teacher/ClassRecordMobileList.tsx ← remove duplicate terms
src/pages/teacher/components/HGDescriptorPanel.tsx ← remove duplicate terms
src/pages/teacher/StudentGradeProfile.tsx ← fix InfoRow, import shared terms
src/pages/teacher/Dashboard.tsx      ← use shared term labels
src/pages/admin/SystemSettings.tsx   ← import DEPED_DIVISIONS
src/components/GradeDeadlineBanner.tsx ← import termLabel()
```

### Batch 6: Grades + EOSY Lock (do together — 4 hours)
```
server/src/routes/grades.ts          ← add EOSY status check
server/src/routes/admin.ts           ← EOSY finalization → auto grade lock
server/src/routes/registrar.ts       ← EOSY finalization endpoint
src/pages/teacher/ClassRecordView.tsx ← disable save when locked
src/components/GradeDeadlineBanner.tsx ← show EOSY lock status
```

### Batch 7: Sync Optimization (do together — 1 day)
```
server/src/lib/enrollproSync.ts      ← refactor N+1 to batch
server/src/lib/atlasSync.ts          ← optimize schedule upsert
server/src/lib/syncCoordinator.ts    ← logging, verify mutex
server/src/lib/syncCache.ts          ← cache invalidation for SY changes
```

### Batch 8: Validation (do together — 2 days)
```
server/src/middleware/validate.ts (NEW) ← validation middleware
server/src/schemas/*.ts (NEW)          ← zod schemas
server/src/routes/grades.ts            ← add validation
server/src/routes/admin.ts             ← add validation
server/src/routes/registrar.ts         ← add validation
server/src/routes/auth.ts              ← add validation
server/src/routes/attendance.ts        ← add validation
server/src/routes/templates.ts         ← add validation
server/src/routes/advisory.ts          ← add validation
server/src/routes/sync.ts              ← add validation
server/src/routes/integration.ts       ← add validation
```

### Batch 9: Cleanup + Tests (do together — 1 day)
```
(unused files)/ directory              ← delete
docs/SMART_ERD.dbml                    ← regenerate
docs/SMART_DFD.md                      ← update React 18→19
npm run lint -- --fix                  ← auto-fix
Root package.json                      ← add test script
server/package.json                    ← add test script
server/src/__tests__/*.ts (NEW)        ← vitest tests
```

---

## PRIORITY MATRIX — What to Fix First

| Priority | Cluster | Effort | Risk | Impact | Blocker? |
|---|---|---|---|---|---|
| **P0** | A (Auth httpOnly) | 3-4h | HIGH | Security | Unblocks NODE_ENV=production safe |
| **P0** | C (Webhook protection) | 1-2h | HIGH | Security | DoS prevention |
| **P0** | F (StudentGradeProfile crash) | 15min | HIGH | UX | Teacher portal broken |
| **P1** | B (School Year) | 2-3h | HIGH | Rollover | Unblocks rollover readiness |
| **P1** | J (Schema indexes) | 30min | LOW | Performance | Foundation for queries |
| **P1** | E (EOSY lock) | 4-6h | MEDIUM | Data integrity | Grade protection |
| **P2** | D (Logging) | 1 day | LOW | Operations | observability |
| **P2** | F (Frontend utilities) | 2-3h | LOW | Code quality | Deduplication |
| **P2** | H (Graceful shutdown) | 2-3h | LOW | Stability | Clean shutdowns |
| **P3** | G (Sync optimization) | 1-2 days | MEDIUM | Performance | At scale |
| **P3** | I (Zod validation) | 2-3 days | LOW | Input safety | Prevention |
| **P4** | K (Dead code) | 30min | LOW | DX | Lint noise |
| **P4** | L (Testing) | 2-3 days | LOW | Regression safety | Verification |

---

## FILE HEAT MAP — Which Files Change Most

| File | Clusters | Total Changes | Priority |
|---|---|---|---|
| `server/src/routes/admin.ts` | B, D, E, I | 4 clusters | **HIGHEST** |
| `server/src/routes/grades.ts` | D, E, I | 3 clusters | HIGH |
| `server/src/routes/integration.ts` | B, C, D, I | 4 clusters | HIGH |
| `server/src/routes/auth.ts` | A, D, I | 3 clusters | HIGH |
| `server/src/routes/registrar.ts` | B, D, E, I | 4 clusters | HIGH |
| `server/src/index.ts` | C, D, H | 3 clusters | HIGH |
| `src/pages/teacher/ClassRecordView.tsx` | E, F | 2 clusters | MEDIUM |
| `src/lib/api.ts` | A, F | 2 clusters | MEDIUM |
| `server/prisma/schema.prisma` | B, J | 2 clusters | MEDIUM |
| `server/src/lib/schoolYearResolver.ts` | B | 1 cluster | MEDIUM |
| `server/src/lib/enrollproSync.ts` | B, G | 2 clusters | MEDIUM |
| `server/src/lib/syncCoordinator.ts` | D, G, H | 3 clusters | MEDIUM |

---

## RISK ASSESSMENT PER CLUSTER

| Cluster | Risk Level | What Could Go Wrong | Mitigation |
|---|---|---|---|
| A (Auth) | **HIGH** | Cookie change breaks all logins; CSRF token mismatch | Test all 3 login portals; keep old cookie path during transition |
| B (Resolver) | **HIGH** | Cache invalidation bug serves wrong year; 12 files changed | Grep for all fallbacks; test all routes after change |
| C (Webhooks) | **MEDIUM** | EnrollPro doesn't send API key; sync breaks | Document key in .env.example; test webhook with key |
| D (Logging) | **LOW** | Migrated log has different format | logger.ts already exists; verify format matches |
| E (Grades) | **MEDIUM** | EOSY lock triggers prematurely; grades frozen unexpectedly | Add admin override; test with mock EOSY flow |
| F (Frontend) | **LOW** | Shared constant import breaks one component | Each component already has the values; just swap local→import |
| G (Sync) | **MEDIUM** | Batch write breaks idempotency; N+1 refactor introduces bugs | Test with mock sync; compare before/after row counts |
| H (Startup) | **LOW** | Shutdown handler doesn't close DB connection | Prisma $disconnect() in handler |
| I (Validation) | **LOW** | Zod schema rejects valid input | Test each endpoint with valid + invalid payloads |
| J (Schema) | **LOW** | Index creation locks table | Use `CREATE INDEX CONCURRENTLY` via migration |
| K (Cleanup) | **LOW** | Accidentally delete needed file | Git tracks everything; restore from git if needed |
| L (Testing) | **LOW** | Tests pass locally but fail in prod | Tests verify logic, not environment |

---

## ESTIMATED TOTAL EFFORT

| Phase | Clusters | Effort |
|---|---|---|
| **Phase 1: Security** | A + C + F (crash fix) | 4-6 hours |
| **Phase 2: Core** | B + J + E | 6-9 hours |
| **Phase 3: Operations** | D + H | 1-1.5 days |
| **Phase 4: Quality** | F + G | 1.5-2.5 days |
| **Phase 5: Hardening** | I + K | 2.5-3.5 days |
| **Phase 6: Verification** | L | 2-3 days |
| **TOTAL** | All 12 clusters | **8-12 days** |

---

*Plan created 2026-08-21. Every finding from AUDIT_REPORT2.md is mapped to at least one cluster. No finding is addressed in isolation.*
