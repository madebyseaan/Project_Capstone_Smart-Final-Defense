# SMART System Audit 3 Report

**Audit Date:** 2026-08-22
**Auditor:** Autonomous (opencode) — Full line-by-line review
**Scope:** 9 route files, 20+ lib files, 12 middleware/schema files, 12 frontend page files

---

## 1. Executive Summary

**70 findings: 5 CRITICAL, 15 HIGH, 30 MEDIUM, 20+ LOW**

Key metrics after Clusters A-L:

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| TS errors | 0 | 0 | -- |
| ESLint | 1011 | 856 | -155 |
| Zod endpoints | 0 | 25 | +25 |
| Tests | 0 | 24 | +24 |
| console.* | ~100 | ~30 | -70 |
| FK indexes | 0 | 7 | +7 |
| Dead files | 70+ | 0 | -70 |

---

## 2. Audit 2 Findings Status (32 Items)

| # | Finding | Cluster | Status |
|---|---------|---------|--------|
| C1 | Hardcoded '2026-2027' | B | FIXED |
| C2 | Webhook unprotected | C | FIXED |
| C3 | clear-scores no isArchived | Pre | FIXED |
| C4 | No test framework | L | FIXED |
| C5 | Server crash loop | G | FIXED |
| C6 | currentSchoolYear not FK | B | FIXED |
| C7 | SchoolYear table empty | -- | UNVERIFIABLE |
| H1 | STE/SPA/SPS misclassification | Pre | FIXED |
| H2 | CORS only localhost | Pre | FIXED |
| H3 | No rate limiting | Pre | FIXED |
| H4 | PM2 NODE_ENV=development | Pre | FIXED |
| H5 | Token cookie not httpOnly | A | FIXED |
| H6 | No auto-advance-term | Pre | FIXED |
| H7 | ATLAS 502 crashes | G | FIXED |
| H8 | Grade 10 PROMOTED untested | -- | UNVERIFIABLE |
| H9 | No EOSY grade lock | E | FIXED |
| H10 | useSyncStream 403 | -- | UNVERIFIABLE |
| M1 | Zero Zod validation | I | FIXED |
| M2 | 100+ any types | K | PARTIAL |
| M3 | Error messages leak | D | FIXED |
| M4 | 100+ console.* | D | PARTIAL |
| M5 | 6 TS errors | Pre | FIXED |
| M6 | Crash restart counts | G | FIXED |
| M7 | Token in error.log | -- | OPEN |
| M8 | ERD outdated | -- | OPEN |
| M9 | DFD React 18 | -- | OPEN |
| L1 | Dead lib/unused/ | K | FIXED |
| L2 | Dead (unused files)/ | K | FIXED |
| L3 | 16 fixable lint | K | FIXED |
| L4 | No graceful shutdown | H | FIXED |
| L5 | Health never DOWN | -- | OPEN |
| L6 | SF3/SF4/SF7 missing | -- | OPEN |

**21 FIXED, 2 PARTIAL, 5 OPEN, 3 UNVERIFIABLE**

---

## 3. New Findings — Audit 3

### 3.1 CRITICAL (5)

| # | File | Line | Description |
|---|------|------|-------------|
| N1 | enrollproSync.ts | 190 | **HARDCODED DEFAULT PASSWORD.** `bcrypt.hash('password123', 10)` used for ALL new teacher accounts. Universal credential if never changed. |
| N2 | MyAdvisory.tsx | 270, 344, 423 | **XSS via dangerouslySetInnerHTML.** Three style blocks inject `colors.primary` unsanitized. Admin can set `primaryColor` to `</style><script>alert(1)</script>`. |
| N3 | csrf.ts | 61, 67 | **CSRF bypass via path substring.** `path.includes('/admin/settings')` etc. too permissive. Should use `path.startsWith()`. |
| N4 | routes/admin.ts | 869 | **GET /admin/settings unauthenticated.** Exposes schoolName, division, region, address, contactNumber, email, currentTerm, gradeLock, colors. |
| N5 | useSyncStream.ts, ThemeContext.tsx, SystemSettings.tsx, AuditLogs.tsx | 88, 265, 238, 150 | **JWT in URL query string.** All SSE connections send `?token=<jwt>`. Logged by servers, proxies, browsers, Referer header. |

### 3.2 HIGH (15)

| # | File | Line | Description |
|---|------|------|-------------|
| N6 | routes/attendance.ts | 21, 101, 138 | **No section ownership on attendance.** Any teacher can view/modify/delete attendance for ANY section. |
| N7 | routes/sync.ts | 54 | **Leaked env vars.** Response body includes `process.env.ENROLLPRO_URL` and `process.env.ATLAS_URL`. |
| N8 | routes/attendance.ts | 462 | **Excel column overflow.** `String.fromCharCode(65 + colIdx)` breaks for columns > 26 (Z). Months with >20 school days produce wrong columns. |
| N9 | routes/integration.ts | 75-86 | **Webhook auth bypass.** When `ENROLLPRO_WEBHOOK_KEY` unset, middleware passes through with no auth. Also no timing-safe compare on key check. |
| N10 | lib/enrollproClient.ts | 47, enrollproBrandingSync.ts:71, teacherDashboardComposer.ts:95 | **rejectUnauthorized: false (3 locations).** Disables TLS certificate verification for Tailscale HTTPS. |
| N11 | index.ts | 337 | **Auto-term setInterval drift.** After machine sleep, fires missed ticks rapidly causing concurrent DB writes. syncCoordinator already solved with setTimeout pattern. |
| N12 | index.ts | 217, 236 | **Auto-term timer not stopped in shutdown.** gracefulShutdown never clears the setInterval. Fires after Prisma disconnects. |
| N13 | routes/registrar.ts | 28 endpoints | **Manual role checks instead of middleware.** Each handler manually checks `if (role !== 'REGISTRAR')`. If any handler forgets, it is an auth bypass. |
| N14 | config/env.ts | 20-33 | **CSRF_SECRET not validated at startup.** Falls back to JWT_SECRET or hardcoded string. Missing env var goes undetected. |
| N15 | lib/enrollproClient.ts | 461, 519, 564, 615 | **Unbounded pagination loops.** No max page limit. If API returns wrong totalPages, loops forever or accumulates duplicates. |
| N16 | lib/enrollproSync.ts | 89, lib/atlasSync.ts:48 | **syncRunning race condition.** Module-level boolean with no mutex. Concurrent calls can both enter sync body. |
| N17 | lib/enrollproSync.ts | 686 | **Unbounded transaction size.** `prisma.$transaction(updates.map(...))` for all students. 5000 students = one massive transaction. |
| N18 | routes/admin.ts | 827, 1166, routes/integration.ts:54 | **SSE heartbeat setInterval not unref'd.** Blocks Node.js shutdown. |
| N19 | lib/enrollproSync.ts | 756-788 | **Snapshot query filters in code instead of DB.** Fetches ALL enrollments then filters `profileSnapshot == null` in JS. |
| N20 | src/lib/api.ts | 66-69, src/pages/LoginPage.tsx:64 | **sessionStorage token storage.** Tokens stored in sessionStorage alongside httpOnly cookies. XSS = full account compromise. Legacy "token" key creates cross-session contamination. |

### 3.3 MEDIUM (30)

| # | File | Line | Description |
|---|------|------|-------------|
| N21 | routes/admin.ts | 1158 | Settings SSE missing admin role check. Any authenticated user can listen. |
| N22 | routes/admin.ts | 1686+ (11 endpoints) | Missing Zod on transmutation, subject weights, school years endpoints. |
| N23 | routes/grades.ts | 1784 | Public transmutation-table endpoint (no auth). |
| N24 | routes/attendance.ts, registrar.ts | 357, 1693, 2054 | Unnecessary `(prisma as any)` casts. |
| N25 | lib/enrollproClient.ts | 70 | 20s HTTP timeout too aggressive, no retry logic. |
| N26 | app.ts + index.ts | 32-35 | No production guard on CORS default origins. |
| N27 | lib/systemHealth.ts | 71-89 | Promise.all for health checks. One slow service blocks all. |
| N28 | lib/teacherDashboardComposer.ts | 84-120 | Duplicated fetchJSON from enrollproClient.ts. |
| N29 | lib/atlasSync.ts | 209-222, 552, 567 | N+1 queries: subject.update per code, classAssignment.upsert in loop. |
| N30 | lib/teacherSync.ts | 127, 134 | force=true on cache reads bypasses cache on every login. |
| N31 | lib/teacherSync.ts | 534, 639, 734 | Silent error swallowing: `catch { /* concurrent duplicate */ }` hides real errors. |
| N32 | lib/syncCache.ts | 151 | invalidateAllCaches after every sync causes cold cache for next login. |
| N33 | lib/studentProfileSync.ts | 136-139 | Single-parent families perpetually flagged for enrichment (fatherName=null). |
| N34 | lib/studentProfileSync.ts | 236 | Unbounded transaction size for enrichment updates. |
| N35 | lib/sseManager.ts | 4-10 | No max size on SSE client Sets. |
| N36 | lib/sseManager.ts | 37 | JSON.stringify crash on circular reference kills all SSE clients. |
| N37 | schemas/admin.ts | 12 | Password minimum 6 chars (NIST recommends 8+). |
| N38 | schemas/admin.ts | 65-66, 78-80 | Color fields not validated as #RRGGBB format. |
| N39 | schemas/admin.ts | 90-99 | Grading weights not cross-validated to sum to 100. |
| N40 | schemas/attendance.ts | 17 | Date field is free string, no format validation. |
| N41 | schemas/attendance.ts | 18 | No max on attendance records array (DoS risk). |
| N42 | schemas/integration.ts | 7 | AIMS password has no max length. |
| N43 | routes/integration.ts | 391, 438, 455 | Empty response bodies (200 with no body) on error paths. |
| N44 | routes/admin.ts | 840 | CSV export: `log.details.replace(...)` crashes if null. |
| N45 | routes/admin.ts | 1614 | Hidden subject name mutation during assignment creation. |
| N46 | src/pages/teacher/Attendance.tsx | 358 | Object URL memory leak (revokeObjectURL never called). |
| N47 | Multiple files | Various | 10+ setTimeout calls not cleaned up on unmount. |
| N48 | Multiple files | Various | 6+ data-fetching effects without AbortController. |
| N49 | Multiple files | Various | 6 eslint-disable react-hooks/exhaustive-deps suppressions. |
| N50 | src/pages/teacher/Attendance.tsx | 282-309 | confirmClear resets UI regardless of server response. |

### 3.4 LOW (20)

| # | File | Line | Description |
|---|------|------|-------------|
| N51 | index.ts + lib/* | Various | ~30 console.* not migrated to logger. |
| N52 | routes/auth.ts | 292 | Dead newAccessToken placeholder variable. |
| N53 | advisory.ts + registrar.ts | 55-69, 702-723 | Duplicated toDisplayName, toTitleCase, normalizeWhitespace. |
| N54 | routes/integration.ts | 82 | Non-constant-time API key comparison (!==). |
| N55 | index.ts | 291 | `as any` enum bypass for currentTerm. |
| N56 | routes/registrar.ts | 2188 | Unbounded in-memory applicationsCache. |
| N57 | lib/ensureDevAccount.ts | 1-10 | Entire function is `return;`. Dead code. |
| N58 | lib/aimsClient.ts | 1-102 | Entire file is stubs. Dead code. |
| N59 | routes/sync.ts | 16-23 | Custom requireAdmin instead of authorizeRoles. |
| N60 | lib/atlasUtils.ts | 58-66 | ENV_SCI8/9/10 all map to ENVIRONMENTAL_SCIENCE7. |
| N61 | lib/atlasUtils.ts | 221-232 | ensureHomeroomGuidanceLabel mutates subject in-place AND writes to DB. |
| N62 | lib/atlasSync.ts | 243-245 | `prisma.subject.create(...).catch(() => {})` swallows ALL errors. |
| N63 | lib/enrollproClient.ts | 109 | invalidateEnrollProToken: `token` param is dead (unused). |
| N64 | lib/enrollproClient.ts | 374 | Magic default `38` for school year ID. |
| N65 | LoginPage.tsx, AdminLoginPage.tsx, RegistrarLoginPage.tsx | Various | ~1500 lines of duplicated login code (95% identical). |
| N66 | LoginPage.tsx | 449-451 | "Remember me" checkbox has no implementation. |
| N67 | SchoolForms.tsx, api.ts, TemplateManager.tsx, ClassRecordView.tsx | Various | 4 files over 1000 lines. |
| N68 | routes/admin.ts | 1601 | Redundant manual validation after Zod. |
| N69 | lib/atlasSync.ts | 650-709 | Schedule entry upserts in loop, should batch. |
| N70 | lib/teacherSync.ts | 76-1014 | 938-line function, should be decomposed. |

---

## 4. Server Route File Inventory

| File | Lines | Endpoints | Auth Pattern | Issues |
|------|-------|-----------|-------------|--------|
| auth.ts | 455 | 6 | Rate limit, JWT, CSRF exempt | Refresh dead code, rate limiter key edge case |
| grades.ts | 2058 | 20 | authenticateToken + authorizeRoles | N+1 on class records, as any casts |
| advisory.ts | 957 | 5 | authenticateToken + authorizeRoles | Duplicated utilities, manual checks |
| registrar.ts | 2625 | 30 | authenticateToken + manual role check | 28 endpoints without middleware auth |
| admin.ts | 2336 | 48 | requireAdmin (custom) | /settings public, SSE no admin check |
| attendance.ts | 686 | 6 | authenticateToken + authorizeRoles | No section ownership, Excel overflow |
| templates.ts | 834 | 9 | router.use(authenticateToken) | Clean |
| sync.ts | 75 | 3 | requireAdmin (custom) | Leaked env vars |
| integration.ts | 579 | 12 | authenticateToken / webhook key | Webhook bypass, empty responses |

---

## 5. Test Coverage Gaps

| Route | Endpoints | Tested | Coverage |
|-------|-----------|--------|----------|
| auth.ts | 6 | 1 (login) | 17% |
| grades.ts | 20 | 1 (save validation) | 5% |
| registrar.ts | 30 | 3 (sections, sf8, sf10) | 10% |
| admin.ts | 48 | 2 (CSRF, validation) | 4% |
| attendance.ts | 6 | 1 (bulk validation) | 17% |
| advisory.ts | 5 | 0 | 0% |
| templates.ts | 9 | 0 | 0% |
| sync.ts | 3 | 0 | 0% |
| integration.ts | 12 | 0 | 0% |

**Overall: 24 tests covering ~8% of endpoints**

---

## 6. Shared Code Duplication

| Function | Files | Recommendation |
|----------|-------|----------------|
| `toDisplayName` / `toTitleCase` | advisory.ts, registrar.ts | Extract to lib/utils.ts |
| `normalizeWhitespace` | advisory.ts, registrar.ts | Extract to lib/utils.ts |
| `isHomeroomGuidanceSubjectCode` | grades.ts, advisory.ts, registrar.ts, integration.ts | Extract to lib/utils.ts |
| `isSubjectAlignedWithGrade` | advisory.ts, registrar.ts, integration.ts | Extract to lib/utils.ts |
| `requireAdmin` middleware | admin.ts, sync.ts (custom) vs auth.ts (authorizeRoles) | Use authorizeRoles('ADMIN') |
| `fetchJSON` HTTP helper | enrollproClient.ts, teacherDashboardComposer.ts | Extract to lib/http.ts |
| Login page components | LoginPage, AdminLoginPage, RegistrarLoginPage | Single component with portal prop |

---

## 7. Security Priority Matrix

| Priority | # | Finding | Impact | Effort |
|----------|---|---------|--------|--------|
| P0 | N1 | Hardcoded teacher password | Account takeover | Low |
| P0 | N2 | XSS via dangerouslySetInnerHTML | Script injection | Low |
| P0 | N3 | CSRF path substring bypass | CSRF bypass | Low |
| P1 | N4 | GET /admin/settings public | Info disclosure | Low |
| P1 | N5 | JWT in SSE URLs | Token leakage | Medium |
| P1 | N9 | Webhook auth bypass | Unauthorized writes | Low |
| P1 | N10 | rejectUnauthorized: false | MITM risk | Medium |
| P1 | N14 | CSRF_SECRET not validated | Weak CSRF | Low |
| P1 | N20 | sessionStorage tokens | XSS token theft | High |
| P2 | N6 | Attendance no ownership | Data tampering | Medium |
| P2 | N7 | Leaked env vars | Info disclosure | Low |
| P2 | N13 | Manual role checks | Auth bypass risk | Medium |
| P2 | N15 | Unbounded pagination | DoS | Low |
