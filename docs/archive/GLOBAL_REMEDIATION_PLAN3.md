# GLOBAL REMEDIATION PLAN 3

**Generated:** 2026-08-22
**Baseline:** AUDIT_REPORT3.md (70 findings, 4 severity levels)
**Rule:** Never modify .env, never write to smart_db, never commit, never contact real EnrollPro/ATLAS, never apply without user approval.

---

## Cluster T: Critical Security Fixes (5 CRITICAL)

**Finds:** N1, N2, N3, N4, N5

### Files to modify

| File | Change |
|------|--------|
| `lib/enrollproSync.ts:190` | Replace `bcrypt.hash('password123', 10)` with random password or force-change flag |
| `MyAdvisory.tsx:270,344,423` | Sanitize `colors.primary` before injecting into dangerouslySetInnerHTML (regex validate ^#[0-9A-Fa-f]{6}$) |
| `csrf.ts:61,67` | Change `path.includes()` to `path.startsWith()` for exemptions |
| `routes/admin.ts:869` | Add `authenticateToken, requireAdmin` to GET /settings |
| `useSyncStream.ts:88` | Remove ?token= from EventSource URL, use httpOnly cookie |
| `ThemeContext.tsx:265` | Same |
| `SystemSettings.tsx:238` | Same |
| `AuditLogs.tsx:150` | Same |
| `middleware/auth.ts:27` | Remove req.query.token fallback |

### Implementation

1. enrollproSync.ts: Generate `crypto.randomBytes(12).toString('hex')` as temp password. Set `mustChangePassword: true` on user record (add field to schema if needed, or use existing mechanism).
2. MyAdvisory.tsx: Add `const safeColor = /^#[0-9A-Fa-f]{6}$/.test(colors.primary) ? colors.primary : '#3B82F6';` before each injection.
3. csrf.ts: `path.startsWith('/sync-grades')`, `path.startsWith('-webhook')`, `path.startsWith('/admin/settings')`.
4. admin.ts: Add `authenticateToken, requireAdmin` before the handler.
5. SSE: Change all EventSource URLs to remove `?token=`. The httpOnly cookie is sent with `credentials: 'include'`.
6. auth.ts middleware: Remove `|| (req.query.token as string | undefined)` from token extraction.

### Verification
- npx tsc --noEmit clean
- PM2 restart, login works
- GET /admin/settings without token -> 401
- GET /admin/settings with admin token -> 200
- CSRF: POST to /admin/settings without CSRF token -> 403
- SSE streams connect without token in URL

---

## Cluster U: Auth & Access Control (5 HIGH)

**Finds:** N9, N13, N14, N6, N21

### Files to modify

| File | Change |
|------|--------|
| `routes/integration.ts:75-86` | Validate webhook key with timing-safe compare; crash if key not set |
| `routes/registrar.ts` | Add `authorizeRoles('REGISTRAR')` to all 28 endpoints, remove manual checks |
| `config/env.ts` | Add CSRF_SECRET to required env vars validation |
| `routes/attendance.ts:21,101,138` | Add section ownership check (verify teacher teaches section) |
| `routes/admin.ts:1158` | Add requireAdmin to settings SSE endpoint |

### Implementation

1. integration.ts: Add startup check `if (!process.env.ENROLLPRO_WEBHOOK_KEY) throw new Error(...)`. In validateWebhookKey: use `crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(configured))` with length pre-check.
2. registrar.ts: Add `router.use(authenticateToken, authorizeRoles('REGISTRAR'))` at top of router, remove manual role checks from handlers.
3. config/env.ts: Add `requireEnv('CSRF_SECRET')` or at minimum requireEnv in non-development.
4. attendance.ts: Add `const section = await prisma.section.findUnique({ where: { id: sectionId }, include: { classAssignments: { include: { teacher: true } } } })` and verify `section.classAssignments.some(ca => ca.teacher.userId === req.user.id)`.
5. admin.ts: Add `requireAdmin` to the settings stream handler.

### Verification
- Login as TEACHER, try registrar endpoints -> 403
- Login as REGISTRAR, try registrar endpoints -> 200
- Webhook without key set -> server crashes on startup (expected)
- Attendance: teacher cannot modify another teacher's section

---

## Cluster V: Scheduler & Infrastructure (4 HIGH)

**Finds:** N11, N12, N16, N17

### Files to modify

| File | Change |
|------|--------|
| `index.ts:266-338` | Convert auto-term scheduler to setTimeout pattern, store timer ref |
| `index.ts:236-241` | Clear auto-term timer in graceful shutdown |
| `routes/admin.ts:827,1166` | Add .unref() to SSE heartbeat intervals |
| `routes/integration.ts:54` | Add .unref() to SSE heartbeat interval |
| `lib/enrollproSync.ts:89` | Replace syncRunning boolean with async-mutex or simple lock |
| `lib/atlasSync.ts:48` | Same |
| `lib/enrollproSync.ts:686` | Chunk transactions (500 per batch) |

### Implementation

1. index.ts: Store timer in module-level variable, use setTimeout with self-reschedule. Clear in gracefulShutdown.
2. SSE: `const timer = setInterval(sendHeartbeat, 30000); timer.unref();`
3. Sync locks: Use `let syncRunning = false;` with try/finally to ensure reset. Or install `async-mutex` package.
4. Transactions: `const chunks = [...Array(Math.ceil(updates.length / 500))].map((_, i) => updates.slice(i * 500, (i + 1) * 500)); for (const chunk of chunks) { await prisma.$transaction(chunk); }`

### Verification
- PM2 restart, auto-term scheduler starts
- pm2 stop server -> clean shutdown, no timer errors
- Concurrent sync calls -> second one returns "already running"

---

## Cluster W: Pagination & HTTP Safety (3 HIGH)

**Finds:** N15, N10, N7

### Files to modify

| File | Change |
|------|--------|
| `lib/enrollproClient.ts:461,519,564,615` | Add maxPages limit (100) to pagination loops |
| `lib/enrollproClient.ts:47` | Remove rejectUnauthorized: false, use CA cert or keep with warning |
| `lib/enrollproBrandingSync.ts:71` | Same |
| `lib/teacherDashboardComposer.ts:95` | Same |
| `routes/sync.ts:54` | Remove ENROLLPRO_URL/ATLAS_URL from response |

### Implementation

1. Pagination: Add `const MAX_PAGES = 100; let pageCount = 0;` and `if (++pageCount >= MAX_PAGES) { logger.error('Pagination exceeded MAX_PAGES'); break; }`
2. TLS: Best option is to keep `rejectUnauthorized: false` for Tailscale but add a prominent comment and TODO. Or create a shared `getHttpsAgent()` function that's used everywhere.
3. sync.ts: Remove `enrollproUrl: process.env.ENROLLPRO_URL` and `atlasUrl: process.env.ATLAS_URL` from response body.

### Verification
- If API returns bad totalPages, sync stops at page 100 instead of infinite loop
- sync/status no longer returns internal URLs

---

## Cluster X: Missing Validation & Error Handling (10 MEDIUM)

**Finds:** N22, N23, N24, N25, N26, N40, N41, N42, N43, N44

### Files to modify

| File | Change |
|------|--------|
| `schemas/admin.ts` | Add transmutation, subjectWeight, schoolYear schemas |
| `schemas/attendance.ts` | Add date format validation (.regex(/^\d{4}-\d{2}-\d{2}$/)), array max(100) |
| `schemas/integration.ts` | Add .max(256) to aimsPassword |
| `routes/grades.ts:1784` | Add authenticateToken to transmutation-table GET |
| `routes/integration.ts:391,438,455` | Return proper HTTP status codes (404, 400, 400) |
| `routes/admin.ts:840` | Add null guard: `(log.details ?? '').replace(...)` |
| `app.ts` | Add CORS production guard |

### Verification
- npx tsc --noEmit clean
- Invalid date in attendance -> 400
- 200+ attendance records -> 400
- GET /grades/transmutation-table without auth -> 401

---

## Cluster Y: Frontend Data Integrity (5 MEDIUM)

**Finds:** N46, N47, N48, N49, N50

### Files to modify

| File | Change |
|------|--------|
| `Attendance.tsx:358` | Add URL.revokeObjectURL after download |
| `Attendance.tsx:309,334` | Store setTimeout IDs, clear on unmount |
| `Schedule.tsx:159` | Same |
| `GradingConfig.tsx` | Same (6 instances) |
| `ClassAssignments.tsx:98,112` | Same |
| `TransmutationTable.tsx:67` | Same |
| Multiple files | Add AbortController to data-fetching |
| Multiple files | Remove eslint-disable suppressions |
| `Attendance.tsx:282-309` | Only reset UI if server response is ok |

### Verification
- npm run build clean
- npm run lint (reduced errors)
- Navigate away during attendance load -> no console errors

---

## Cluster Z: Code Quality & Cleanup (20 LOW)

**Finds:** N51-N70

### Files to modify

| File | Change |
|------|--------|
| index.ts + lib/* | Migrate remaining console.* to logger |
| routes/auth.ts:292 | Remove dead newAccessToken variable |
| advisory.ts + registrar.ts | Extract shared utilities to lib/utils.ts |
| routes/integration.ts:82 | Use crypto.timingSafeEqual |
| index.ts:291 | Replace `as any` with `as Term` |
| lib/ensureDevAccount.ts | Delete file or remove import |
| lib/aimsClient.ts | Mark as deprecated with comment |
| routes/sync.ts | Use authorizeRoles('ADMIN') instead of custom requireAdmin |

### Verification
- npx tsc --noEmit clean
- npm run lint clean
- PM2 restart, all routes work

---

## Execution Order

```
Cluster T (Critical Security)  <- CRITICAL, do first
  |
  v
Cluster U (Auth & Access)      <- HIGH
  |
  v
Cluster V (Scheduler & Infra)  <- HIGH
  |
  v
Cluster W (Pagination & HTTP)  <- HIGH
  |
  v
Cluster X (Validation)         <- MEDIUM
  |
  v
Cluster Y (Frontend Data)      <- MEDIUM
  |
  v
Cluster Z (Code Quality)       <- LOW
```

**Total: 7 clusters, 70 findings, est. 3-4 days effort**
