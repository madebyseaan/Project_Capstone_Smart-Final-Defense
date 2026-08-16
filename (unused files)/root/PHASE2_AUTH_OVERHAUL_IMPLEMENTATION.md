# Phase 2: Auth System Overhaul — Implementation Plan

**Date:** August 16, 2026  
**Status:** Planning — Do Not Implement Yet  
**Scope:** Account status system, refresh tokens, httpOnly cookies, sync deactivation

---

## Summary of Understanding

Phase 2 fixes the core security gap: **deleted/suspended EnrollPro users can still log in when EnrollPro is offline.** This is done by:

1. **Account status system** — Add `ACTIVE`/`SUSPENDED`/`DEACTIVATED` status to User model
2. **Middleware DB check** — Verify user status on every request (not just at login)
3. **Login status check** — Reject suspended users even with correct credentials
4. **Refresh token system** — Short-lived access tokens (15min) + long-lived refresh tokens (7 days) in httpOnly cookies
5. **httpOnly cookies** — Move JWT from sessionStorage to httpOnly cookies (XSS-proof)
6. **Sync deactivation** — When EnrollPro is online, deactivate teachers removed from EnrollPro

### What This Fixes

| Before Phase 2 | After Phase 2 |
|----------------|---------------|
| Deleted teacher can log in when EnrollPro offline | Deleted teacher gets 403 — status checked on every request |
| 24-hour token with no revocation | 15-minute access token, revocable refresh token |
| JWT in sessionStorage (XSS-vulnerable) | JWT in httpOnly cookie (XSS-proof) |
| Logout doesn't invalidate token | Logout deletes refresh token → immediate revocation |
| Sync never cleans up users | Sync deactivates removed teachers |

---

## Research Findings

### Account Status (from OWASP + Prisma docs)
- **Enum over string** — Type-safe, matches existing pattern (`Role`, `Term`, `GradeLevel`)
- **On User model directly** — No separate table needed for this scale
- **`@default(ACTIVE)`** — Backwards-compatible migration, all existing users stay active
- **Audit fields** — `suspendedAt`, `suspendedBy`, `suspensionReason` for compliance
- **Cascading** — Don't cascade-delete grades/attendance; deactivate class assignments instead

### Refresh Tokens (from Auth0 + OWASP)
- **Store hash in DB** — SHA-256 of the raw token, never plaintext
- **httpOnly cookie for transport** — XSS-proof, auto-sent with requests
- **Rotate on every refresh** — Limits stolen token lifetime
- **Family tracking** — Detect stolen tokens via reuse detection
- **7-day expiry** — Good balance of security and UX

### httpOnly Cookies (from MDN + OWASP)
- **`httpOnly: true`** — JS cannot access (XSS protection)
- **`secure: true`** — HTTPS only (except localhost for dev)
- **`sameSite: 'lax'`** — CSRF protection, works with navigation
- **`path: '/'`** — Available on all routes
- **CORS `credentials: true`** — Required for cross-origin cookies
- **Frontend: `credentials: 'include'`** — Required for fetch/XHR

### Sync Deactivation (from integration best practices)
- **Soft-deactivate** — Never hard-delete users with dependent data
- **Grace period** — 7 days before deactivation (prevents false positives from outages)
- **Audit trail** — Log every deactivation event
- **Re-activation** — Restore status when user reappears in EnrollPro

---

## Step-by-Step Implementation

### Step 1: Install dependencies

**What:** Add `cookie-parser` for reading httpOnly cookies.  
**Why:** Express needs this to parse `Cookie` header into `req.cookies`.  
**File:** `server/package.json`

**Action:**
```bash
cd server && npm install cookie-parser
cd server && npm install -D @types/cookie-parser
```

**Verify:** Check `package.json` has `cookie-parser` in dependencies.

---

### Step 2: Add UserStatus enum and RefreshToken model to Prisma schema

**What:** Add status field to User model and create RefreshToken model.  
**Why:** Core of the account status system and refresh token infrastructure.  
**File:** `server/prisma/schema.prisma`

**Changes to User model:**
```prisma
enum UserStatus {
  ACTIVE
  SUSPENDED
  DEACTIVATED
}

model User {
  id                   String          @id @default(cuid())
  username             String          @unique
  password             String
  role                 Role
  status               UserStatus      @default(ACTIVE)    // NEW
  suspendedAt          DateTime?       // NEW
  suspendedBy          String?         // NEW — admin userId
  suspensionReason     String?         // NEW
  deactivatedAt        DateTime?       // NEW
  deactivatedBy        String?         // NEW
  deactivationReason   String?         // NEW
  firstName            String?
  lastName             String?
  email                String?
  createdAt            DateTime        @default(now())
  updatedAt            DateTime        @updatedAt
  refreshTokens        RefreshToken[]  // NEW
  auditLogs            AuditLog[]
  uploadedEcrTemplates ECRTemplate[]
  uploadedExcelForms   ExcelTemplate[]
  teacher              Teacher?
}
```

**New RefreshToken model:**
```prisma
model RefreshToken {
  id        String    @id @default(uuid())
  token     String    @unique   // SHA-256 hash of the raw token
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  familyId  String              // Links tokens from same login session
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
  @@index([familyId])
  @@index([expiresAt])
}
```

**Action:** Run `npx prisma migrate dev --name add-user-status-and-refresh-tokens`

**Verify:** Migration succeeds, all existing users have `status: ACTIVE`.

---

### Step 3: Create token utility functions

**What:** Centralized functions for signing/verifying JWT, hashing refresh tokens, generating tokens.  
**Why:** Avoids duplicating crypto logic across auth.ts and middleware.  
**File:** `server/src/lib/tokens.ts` (NEW)

**Contents:**
- `signAccessToken(userId, username, email, role)` — Signs 15-minute JWT
- `hashToken(rawToken)` — SHA-256 hash for DB storage
- `generateRefreshToken()` — Returns `{ raw, hashed, expiresAt, familyId }`
- `verifyAccessToken(token)` — Verifies JWT and returns payload

**Verify:** TypeScript compiles.

---

### Step 4: Add cookie-parser and CORS credentials to server

**What:** Register cookie-parser middleware and update CORS for credentials.  
**Why:** Required for reading httpOnly cookies and sending cross-origin cookies.  
**File:** `server/src/index.ts`

**Changes:**
1. Import `cookieParser` from `cookie-parser`
2. Add `app.use(cookieParser())` before routes
3. Update CORS: add `credentials: true` (already there), ensure origin is specific

**Verify:** Server starts, cookies are readable.

---

### Step 5: Update auth middleware to check user status

**What:** Middleware now queries DB to verify user is still `ACTIVE`.  
**Why:** A suspended user's old JWT should be rejected immediately.  
**File:** `server/src/middleware/auth.ts`

**Changes:**
1. After JWT verification, look up user in DB: `prisma.user.findUnique({ where: { id } })`
2. If user not found or `status !== 'ACTIVE'`, return 403
3. If valid, attach full user object to `req.user` (including status)

**Trade-off:** This adds a DB query per request. For a school system with <100 concurrent users, this is acceptable. For larger scale, add a 30-second cache.

**Verify:**
1. Login works, token is valid
2. Suspended user gets 403 on any protected route
3. Performance is acceptable (test with 10 rapid requests)

---

### Step 6: Update login to check status and issue refresh token

**What:** Login checks `status === 'ACTIVE'` before issuing tokens. Issues access + refresh token pair.  
**Why:** Suspended users can't get new tokens. Refresh token enables token renewal.  
**File:** `server/src/routes/auth.ts`

**Changes:**
1. After finding user (local or EnrollPro), check `user.status !== 'ACTIVE'` → reject with appropriate message
2. Sign access token with 15-minute expiry (was 24h)
3. Generate refresh token, store hash in DB
4. Set refresh token as httpOnly cookie
5. Return access token in JSON body (frontend needs it for initial setup)

**Verify:**
1. Active user can log in → gets access token + refresh cookie
2. Suspended user gets "Account suspended" message
3. Access token expires in 15 minutes

---

### Step 7: Create refresh token endpoint

**What:** POST /api/auth/refresh — exchanges refresh token for new access token.  
**Why:** Enables seamless token renewal without re-login.  
**File:** `server/src/routes/auth.ts` (add new route)

**Logic:**
1. Read refresh token from httpOnly cookie
2. Hash it, look up in DB
3. If not found, expired, or revoked → 401
4. If reuse detected (already revoked) → revoke entire family, 401
5. Revoke current token, issue new pair
6. Set new refresh cookie, return new access token

**Verify:**
1. After 15 minutes, frontend can refresh without re-login
2. Revoked refresh token returns 401
3. Stolen refresh token reuse revokes entire family

---

### Step 8: Update logout to revoke refresh token

**What:** Logout deletes refresh token from DB and clears cookie.  
**Why:** Immediate session revocation (was: token stayed valid for 24h).  
**File:** `server/src/routes/auth.ts`

**Changes:**
1. Delete current refresh token from DB
2. Clear refresh token cookie
3. (Optional) Add "logout all devices" — delete all user's refresh tokens

**Verify:**
1. After logout, refresh token is invalid
2. Old access token still works until expiry (15min max)

---

### Step 9: Update frontend API client for cookie-based auth

**What:** Switch from sessionStorage token to httpOnly cookie with automatic refresh.  
**Why:** XSS-proof token storage, automatic renewal.  
**File:** `src/lib/api.ts`

**Changes:**
1. Remove `sessionStorage.getItem("token")` logic
2. Add `credentials: 'include'` to all requests
3. Add 401 interceptor that calls `/api/auth/refresh` and retries
4. Queue concurrent 401s to avoid multiple refresh calls

**Verify:**
1. Login stores token in httpOnly cookie (not visible in JS)
2. Protected routes work (cookie auto-sent)
3. After access token expires, 401 triggers refresh automatically
4. After logout, cookie is cleared

---

### Step 10: Update frontend login/logout flows

**What:** Update login pages and logout to work with cookie-based auth.  
**Why:** Login now returns access token in body (for initial use) + refresh in cookie. Logout clears cookies.  
**Files:** `src/pages/LoginPage.tsx`, `src/pages/AdminLoginPage.tsx`, `src/pages/RegistrarLoginPage.tsx`

**Changes:**
1. Login: store access token in memory (not sessionStorage) for initial requests
2. Logout: call `/api/auth/logout` to clear server-side refresh token
3. Remove all `sessionStorage.setItem("token", ...)` calls
4. Remove all `sessionStorage.getItem("token")` calls

**Verify:**
1. Login works, token not visible in sessionStorage
2. Logout clears everything
3. Page refresh triggers re-login (access token in memory is gone, refresh cookie handles renewal)

---

### Step 11: Add sync deactivation of removed teachers

**What:** During EnrollPro sync, deactivate teachers no longer in EnrollPro.  
**Why:** Propagates deletions from EnrollPro to SMART.  
**File:** `server/src/lib/enrollproSync.ts`

**Changes:**
1. After fetching EnrollPro teachers, compare with local teachers
2. Teachers in local DB but NOT in EnrollPro → set `status: 'SUSPENDED'`
3. Teachers reappearing in EnrollPro → restore to `status: 'ACTIVE'`
4. Log all deactivation/reactivation events to audit
5. Deactivate class assignments for suspended teachers

**Grace period option:** For v1, deactivate immediately. Add grace period later if needed.

**Verify:**
1. Remove a teacher from EnrollPro → sync deactivates them in SMART
2. Re-add teacher → sync reactivates them
3. Suspended teacher's class assignments are deactivated
4. Audit log records all events

---

### Step 12: Add admin endpoints for manual suspension

**What:** Admin can manually suspend/reactivate users.  
**Why:** Admins need to suspend users independent of EnrollPro.  
**File:** `server/src/routes/admin.ts`

**Endpoints:**
- `POST /api/admin/users/:id/suspend` — Set status to SUSPENDED with reason
- `POST /api/admin/users/:id/reactivate` — Set status to ACTIVE
- `POST /api/admin/users/:id/deactivate` — Set status to DEACTIVATED

**Each endpoint:**
1. Validates admin role
2. Updates user status + audit fields
3. Deactivates class assignments (for suspend/deactivate)
4. Revokes all refresh tokens (immediate lockout)
5. Logs to audit

**Verify:**
1. Admin can suspend a teacher → teacher immediately loses access
2. Admin can reactivate → teacher can log in again
3. Refresh tokens are revoked on suspension

---

### Step 13: Full integration test

**What:** End-to-end test of all Phase 2 features.

**Test Sequence:**
1. Server starts with new schema
2. Active user can log in → gets access + refresh token
3. Suspended user gets "Account suspended" at login
4. Access token works for 15 minutes
5. Refresh token renews access token seamlessly
6. Logout revokes refresh token → 401 on next refresh
7. Admin suspends user → immediate lockout (all tokens revoked)
8. Sync deactivates removed EnrollPro teacher
9. Re-activated teacher can log in again
10. Frontend works with cookie-based auth (no sessionStorage)

---

## Files Modified/Created Summary

| Action | File | Purpose |
|--------|------|---------|
| MODIFY | `server/package.json` | Add cookie-parser dependency |
| CREATE | `server/src/lib/tokens.ts` | Token utility functions |
| MODIFY | `server/prisma/schema.prisma` | Add UserStatus enum, status field, RefreshToken model |
| CREATE | `server/prisma/migrations/...` | Database migration |
| MODIFY | `server/src/index.ts` | Add cookie-parser middleware |
| MODIFY | `server/src/middleware/auth.ts` | DB status check on every request |
| MODIFY | `server/src/routes/auth.ts` | Login status check, refresh token, cookie-based auth |
| MODIFY | `server/src/routes/admin.ts` | Suspend/reactivate/deactivate endpoints |
| MODIFY | `server/src/lib/enrollproSync.ts` | Deactivate removed teachers |
| MODIFY | `src/lib/api.ts` | Cookie-based auth, 401 interceptor |
| MODIFY | `src/pages/LoginPage.tsx` | Remove sessionStorage |
| MODIFY | `src/pages/AdminLoginPage.tsx` | Remove sessionStorage |
| MODIFY | `src/pages/RegistrarLoginPage.tsx` | Remove sessionStorage |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DB query per request slows performance | Low | Medium | <100 concurrent users; add cache later if needed |
| Migration breaks existing data | Low | High | `@default(ACTIVE)` ensures backwards compatibility |
| Frontend breaks with cookie auth | Medium | High | Test thoroughly; keep sessionStorage fallback option |
| Sync false-positive deactivation | Medium | Medium | Add grace period in v2 if needed |
| Multiple tabs conflict with refresh | Low | Low | Cookies shared across tabs automatically |

---

## Rollback Plan

If any change breaks the system:
1. Revert the specific file using `git checkout HEAD -- <file>`
2. For schema changes: `npx prisma migrate reset` (destructive — only in dev)
3. All changes are in separate commits for individual rollback
