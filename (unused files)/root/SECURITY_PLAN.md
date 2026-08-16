# SMART Security Hardening Plan

**Date:** August 16, 2026  
**Status:** Planning — Do Not Implement Yet  
**Scope:** Full security audit, attack scenario analysis, and remediation plan

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Critical Vulnerabilities Found](#2-critical-vulnerabilities-found)
3. [Attack Scenarios](#3-attack-scenarios)
4. [OWASP Top 10:2025 Mapping](#4-owasp-top-102025-mapping)
5. [Remediation Plan](#5-remediation-plan)
6. [Implementation Phases](#6-implementation-phases)
7. [Research: Best Practices](#7-research-best-practices)

---

## 1. Executive Summary

A full security audit of the SMART system (React + Express + PostgreSQL) identified **4 CRITICAL**, **8 HIGH**, **12 MEDIUM**, and **7 LOW** severity vulnerabilities. The most dangerous issues are: a hardcoded developer backdoor, JWT fallback secret, no rate limiting on login, and no mechanism to enforce account suspensions when EnrollPro is offline.

### Risk Summary

| Severity | Count | Immediate Action Required |
|----------|-------|--------------------------|
| CRITICAL | 4 | Yes — deploy-blocking |
| HIGH | 8 | Yes — before production |
| MEDIUM | 12 | Recommended |
| LOW | 7 | Optional hardening |

---

## 2. Critical Vulnerabilities Found

### C1: Hardcoded Developer Backdoor
- **File:** `server/src/lib/ensureDevAccount.ts:5-12`
- **Issue:** Dev account (`username: "999999"`, `password: "dev123"`, `role: ADMIN`) is hardcoded in source and auto-created on every server start. The `isDeveloper` flag grants **universal role bypass** across all endpoints.
- **File:** `server/src/middleware/auth.ts:49` — three redundant bypass checks (`isDeveloper`, `role === "DEVELOPER"`, `username === "999999"`).
- **Impact:** Anyone with repo access gets full admin access. If deployed to production, this is a permanent backdoor.

### C2: JWT Fallback Secret
- **File:** `server/src/routes/auth.ts:167` and `server/src/middleware/auth.ts:31`
- **Issue:** `process.env.JWT_SECRET || "fallback-secret"` — if `JWT_SECRET` is unset, tokens are signed with the literal string `"fallback-secret"`. Any attacker can forge valid admin tokens.
- **Impact:** Complete auth bypass. Trivial to exploit.

### C3: All Secrets in `.env` Committed to Git
- **File:** `server/.env` (entire file)
- **Issue:** `DATABASE_URL` (with plaintext password), `JWT_SECRET`, `ATLAS_SYSTEM_TOKEN`, `ENROLLPRO_PASSWORD` are all committed. No `.env.example` exists.
- **Impact:** Full database access, token forgery, external API impersonation.

### C4: No Rate Limiting on Login
- **File:** `server/src/routes/auth.ts:15`
- **Issue:** No `express-rate-limit` or any rate-limiting middleware anywhere in the server. Login endpoint is exposed to brute-force and credential stuffing. bcrypt at cost 10 makes flooding expensive but not impossible.
- **Impact:** Account compromise via brute force.

---

## 3. Attack Scenarios

### Scenario 1: Suspended Teacher Logs In During EnrollPro Outage
**Severity:** CRITICAL  
**Prerequisites:** Teacher was deleted/suspended in EnrollPro; EnrollPro goes offline  
**Chain:**
1. Admin suspends teacher in EnrollPro
2. EnrollPro goes offline (or SMART server restarts before sync runs)
3. Teacher's local User record still exists in PostgreSQL
4. Teacher enters credentials → local DB check passes (Step 1 of auth cascade)
5. EnrollPro live check is skipped (Step 2 skipped because offline)
6. Teacher receives 24-hour JWT with full access
7. **Teacher can access all data, grades, attendance, student records**

**Root Cause:** No `isActive` status field on User model. Auth middleware never checks DB. Sync never deactivates removed users.

### Scenario 2: Attacker Forges JWT from Leaked `.env`
**Severity:** CRITICAL  
**Prerequisites:** `.env` is in git history (or accessible)  
**Chain:**
1. Attacker obtains `JWT_SECRET` from git history
2. Attacker crafts JWT with `{ id: "any", role: "ADMIN", isDeveloper: true }`
3. Attacker signs with stolen secret
4. Attacker sends requests with `Authorization: Bearer <forged-token>`
5. **Full admin access to entire system**

### Scenario 3: Brute Force Login Attack
**Severity:** CRITICAL  
**Prerequisites:** Server is publicly accessible  
**Chain:**
1. Attacker targets `/api/auth/login` with credential list
2. No rate limiting, no account lockout, no CAPTCHA
3. bcrypt at cost 10 slows but doesn't prevent attacks
4. **Accounts compromised within hours/days**

### Scenario 4: XSS Token Theft via sessionStorage
**Severity:** HIGH  
**Prerequisites:** Any XSS vulnerability exists (e.g., via CSV export, SVG upload, or React rendering)  
**Chain:**
1. Attacker finds XSS vector (e.g., malicious SVG logo, CSV injection in audit logs)
2. Script runs in browser context
3. Script reads `sessionStorage.getItem("token")`
4. **Attacker exfiltrates JWT to external server**
5. **Full impersonation for 24 hours**

### Scenario 5: Developer Backdoor Exploitation
**Severity:** CRITICAL  
**Prerequisites:** Dev credentials are in source code  
**Chain:**
1. Attacker discovers hardcoded dev credentials (easy to find in source)
2. Attacker logs in as `999999` / `dev123`
3. Developer bypass grants access to ALL endpoints regardless of role
4. **Full system compromise**

### Scenario 6: SSRF via EnrollPro/Atlas URL Manipulation
**Severity:** HIGH  
**Prerequisites:** Attacker can modify `.env` or exploit DNS rebinding  
**Chain:**
1. Attacker modifies `ENROLLPRO_URL` to point to internal service
2. TLS verification is disabled (`rejectUnauthorized: false`)
3. Server makes requests to internal hosts (database, metadata, admin panels)
4. **Internal network reconnaissance and data exfiltration**

### Scenario 7: IDOR — Any User Accesses Any Student's Data
**Severity:** HIGH  
**Prerequisites:** Authenticated user (teacher or registrar)  
**Chain:**
1. Teacher or registrar authenticates normally
2. They modify the `studentId` or `sectionId` parameter in API calls
3. No ownership check — server returns any student's data
4. **Full student PII exposure (grades, personal info, guardian contacts)**

### Scenario 8: Malicious SVG Upload Stored XSS
**Severity:** MEDIUM  
**Prerequisites:** Admin uploads malicious SVG as school logo  
**Chain:**
1. Attacker (or compromised admin) uploads SVG with embedded `<script>` tag
2. SVG is served from `/uploads/logo-*.svg` with `Content-Type: image/svg+xml`
3. Browser executes JavaScript in SVG context
4. **Session hijacking, token theft, or defacement**

### Scenario 9: Unauthenticated Webhook Triggering Sync
**Severity:** MEDIUM  
**Prerequisites:** `ENROLLPRO_WEBHOOK_KEY` env var is not set  
**Chain:**
1. Attacker sends POST to `/api/webhook/enrollpro-webhook`
2. Auth check is `if (process.env.ENROLLPRO_WEBHOOK_KEY && ...)` — when key is unset, the condition is `false`
3. Sync is triggered with no authentication
4. **Repeated calls can cause resource exhaustion or sync flooding**

### Scenario 10: Log Injection via User-Controlled Fields
**Severity:** MEDIUM  
**Prerequisites:** Authenticated user with admin access  
**Chain:**
1. Admin creates user with `firstName` containing newlines or fake log entries
2. Audit log stores unsanitized input
3. If logs are shipped to SIEM or monitoring, fake events are injected
4. **Audit trail integrity compromised**

### Scenario 11: SSE Connection Exhaustion (DoS)
**Severity:** MEDIUM  
**Prerequisites:** Authenticated user  
**Chain:**
1. Attacker opens thousands of SSE connections to `/settings/stream` or `/sync/stream`
2. No connection limit per user or globally
3. Server memory and file descriptors exhausted
4. **Denial of service for all users**

### Scenario 12: Token in Query String Leaks
**Severity:** MEDIUM  
**Prerequisites:** SSE/EventSource usage  
**Chain:**
1. JWT is passed via `?token=xxx` query parameter for SSE connections
2. Token appears in server access logs, browser history, proxy logs, Referer headers
3. **Token exposure to third parties**

### Scenario 13: Supply Chain Attack via `xlsx` Package
**Severity:** MEDIUM  
**Prerequisites:** `xlsx` (SheetJS) v0.18.5 has known vulnerabilities  
**Chain:**
1. Attacker uploads malicious spreadsheet
2. `xlsx` parses it with prototype pollution or ReDoS vulnerability
3. **Server-side code execution or denial of service**

### Scenario 14: CSV Injection in Audit Export
**Severity:** LOW  
**Prerequisites:** Admin exports audit logs to CSV  
**Chain:**
1. Audit log contains user-controlled fields (email, name)
2. Exported CSV includes formula characters (`=`, `+`, `-`, `@`)
3. User opens CSV in Excel
4. **Formula execution on user's machine**

---

## 4. OWASP Top 10:2025 Mapping

| OWASP # | Vulnerability | Our Findings | Severity |
|---------|---------------|--------------|----------|
| A01 | Broken Access Control | IDOR on student data, no RBAC on settings, developer bypass | HIGH |
| A02 | Security Misconfiguration | CORS localhost, no security headers, fallback JWT secret | CRITICAL |
| A03 | Supply Chain Failures | `xlsx` v0.18.5 vulnerable, no `npm audit` in CI | MEDIUM |
| A04 | Cryptographic Failures | Weak JWT secret fallback, no token binding | CRITICAL |
| A05 | Injection | Log injection, CSV injection, potential XSS via SVG | MEDIUM |
| A06 | Insecure Design | No account suspension mechanism, stateless auth middleware | HIGH |
| A07 | Authentication Failures | No rate limiting, no lockout, 24h token with no revocation | CRITICAL |
| A08 | Integrity Failures | Auto-provisioning with weak validation, no input schemas | HIGH |
| A09 | Logging Failures | Audit logs store raw user input, no alerting on auth failures | MEDIUM |
| A10 | Exceptional Conditions | Error messages leak internals to clients | MEDIUM |

---

## 5. Remediation Plan

### 5.1 — Authentication Hardening

#### 5.1.1: Account Status System
**Problem:** No `isActive` field, no suspension mechanism, deleted EnrollPro users can still log in.

**Solution:**
- Add `status` enum field to User model: `ACTIVE`, `SUSPENDED`, `DEACTIVATED`
- Add `deletedAt` nullable timestamp for soft-delete
- Auth middleware queries DB on every request to verify `status === 'ACTIVE'`
- Login checks `status` before issuing JWT
- Sync deactivates users removed from EnrollPro (set `status: 'SUSPENDED'`)
- Include `status` in JWT claims for fast-path rejection

**Files to modify:**
- `server/prisma/schema.prisma` — add fields to User model
- `server/src/middleware/auth.ts` — add DB status check
- `server/src/routes/auth.ts` — check status on login
- `server/src/lib/enrollproSync.ts` — deactivate removed users
- `server/src/lib/teacherSync.ts` — deactivate removed teachers

#### 5.1.2: JWT Token Revocation
**Problem:** 24-hour token with no revocation. Stolen/deleted user tokens remain valid.

**Solution:**
- Reduce access token expiry to **15 minutes**
- Add refresh token (7-day) stored in **httpOnly/Secure/SameSite=Strict cookie**
- Create `refresh_tokens` table in PostgreSQL (tracked per-user, per-device)
- On logout: delete refresh token from DB → immediate revocation
- On suspension: delete all user's refresh tokens → immediate lockout
- Rotate refresh token on each use (sliding window)

**Files to modify:**
- `server/prisma/schema.prisma` — add `RefreshToken` model
- `server/src/routes/auth.ts` — issue refresh token, handle rotation
- `server/src/middleware/auth.ts` — verify access token + refresh if expired
- Frontend `src/lib/api.ts` — handle token refresh, store in memory not sessionStorage
- Frontend login pages — redirect to login on 401

#### 5.1.3: Remove Hardcoded Dev Backdoor
**Problem:** Dev credentials in source code with universal bypass.

**Solution:**
- Gate dev account creation behind `NODE_ENV === 'development'`
- Move dev credentials to env vars (or remove entirely from production)
- Remove the three redundant bypass checks in `authorizeRoles`
- Dev account should use normal role checks, not special flags

**Files to modify:**
- `server/src/lib/ensureDevAccount.ts` — gate behind NODE_ENV
- `server/src/middleware/auth.ts` — remove developer bypass logic
- `server/src/routes/auth.ts` — remove hardcoded developer detection

#### 5.1.4: JWT Secret Enforcement
**Problem:** Fallback secret allows token forgery.

**Solution:**
- Remove `|| "fallback-secret"` from both locations
- Crash on startup if `JWT_SECRET` is not set
- Add startup validation in `server/src/index.ts`

**Files to modify:**
- `server/src/routes/auth.ts:167` — remove fallback
- `server/src/middleware/auth.ts:31` — remove fallback
- `server/src/index.ts` — add startup check

#### 5.1.5: Rate Limiting & Account Lockout
**Problem:** No rate limiting on login or any endpoint.

**Solution:**
- Install `express-rate-limit`
- Login endpoint: 5 attempts per 15 minutes per IP
- API endpoints: 100 requests per 15 minutes per user
- Admin endpoints: 50 requests per 15 minutes per user
- Implement exponential lockout after 5 failed attempts (1min, 5min, 15min, 1hr)
- Log all rate-limited requests for monitoring

**Files to modify:**
- `server/src/index.ts` — add global rate limiter
- `server/src/routes/auth.ts` — add login-specific rate limiter
- `server/prisma/schema.prisma` — add `login_attempts` tracking (or use in-memory)

### 5.2 — Input Validation & Authorization

#### 5.2.1: Zod Validation on All Endpoints
**Problem:** No input validation on any endpoint. Mass assignment, injection, and invalid data possible.

**Solution:**
- Create Zod schemas for every request body and params
- Add validation middleware that runs before route handlers
- Sanitize all string inputs (strip HTML, limit length)
- Validate numeric ranges for scores, IDs, pagination

**Priority endpoints:**
- `POST /api/auth/login` — email/password validation
- `POST /api/admin/users` — user creation validation
- `PUT /api/grades/*` — score validation (0-max, required fields)
- `POST /api/attendance/*` — attendance record validation
- All registrar form endpoints — student data validation

#### 5.2.2: IDOR Protection
**Problem:** Any authenticated user can access any student/section data.

**Solution:**
- Add ownership verification middleware
- Teachers can only access their assigned sections/students
- Registrars can only access their school's data
- Admins can access all data
- Add `schoolId` scoping to all queries

**Files to modify:**
- `server/src/routes/registrar.ts` — add section/school ownership checks
- `server/src/routes/advisory.ts` — add teacher-section assignment checks
- `server/src/routes/grades.ts` — add class assignment ownership checks

#### 5.2.3: Remove Token from Query String
**Problem:** JWT accepted via `?token=` leaks in logs and history.

**Solution:**
- Replace EventSource with `fetch` + `ReadableStream` for SSE
- Pass `Authorization` header via fetch
- Remove `req.query.token` fallback from middleware

**Files to modify:**
- `server/src/middleware/auth.ts:21` — remove query param fallback
- Frontend SSE consumers — switch to fetch-based EventSource

### 5.3 — Infrastructure Hardening

#### 5.3.1: Security Headers
**Problem:** No security headers (CSP, HSTS, X-Frame-Options, etc.).

**Solution:**
- Install `helmet`
- Configure CSP for React + Vite
- Enable HSTS for production
- Set X-Frame-Options: DENY
- Set X-Content-Type-Options: nosniff
- Set Referrer-Policy: strict-origin-when-cross-origin
- Set Permissions-Policy (disable camera, microphone, etc.)

**Files to modify:**
- `server/src/index.ts` — add helmet middleware
- `server/package.json` — add helmet dependency

#### 5.3.2: CORS Hardening
**Problem:** CORS allows multiple localhost origins.

**Solution:**
- Make CORS origins env-configurable
- In production, only allow the deployed domain
- Remove hardcoded localhost origins from production code

**Files to modify:**
- `server/src/index.ts` — env-based CORS config

#### 5.3.3: TLS Verification
**Problem:** `rejectUnauthorized: false` disables TLS verification.

**Solution:**
- Enable TLS verification in production
- Use proper CA certificates
- Keep `rejectUnauthorized: false` only for development (gated by NODE_ENV)

**Files to modify:**
- `server/src/lib/enrollproClient.ts:45` — conditional TLS
- `server/src/lib/sync/httpClient.ts:47` — conditional TLS

#### 5.3.4: Static File Access Control
**Problem:** `/uploads` served without authentication.

**Solution:**
- Add auth middleware to static file serving
- Or move uploads behind an authenticated proxy route
- Validate file types on upload (no SVG, or sanitize SVGs)

**Files to modify:**
- `server/src/index.ts:33` — add auth to static serving
- `server/src/routes/admin.ts` — validate uploaded file types

#### 5.3.5: Request Size Limits
**Problem:** `express.json()` has no explicit body size limit.

**Solution:**
- Set `express.json({ limit: '1mb' })`
- Configure multer limits per upload type

**Files to modify:**
- `server/src/index.ts:30` — add limit option

#### 5.3.6: SSE Connection Limits
**Problem:** No connection limit on SSE endpoints.

**Solution:**
- Add max connections per user (5) and globally (100)
- Add heartbeat/ping every 30 seconds
- Close connections on token expiry

**Files to modify:**
- `server/src/lib/sseManager.ts` — add limits and heartbeat

### 5.4 — Secret Management

#### 5.4.1: Remove Secrets from Git
**Problem:** `.env` committed with all secrets.

**Solution:**
- Add `.env` to `.gitignore` (verify it's there)
- Create `.env.example` with placeholder values
- Rotate all exposed secrets (JWT_SECRET, DATABASE_PASSWORD, ENROLLPRO_PASSWORD, ATLAS_SYSTEM_TOKEN)
- Consider using a secrets manager (dotenv-vault, AWS SSM, etc.)

#### 5.4.2: Environment-Based Configuration
**Problem:** Dev/test/prod not separated.

**Solution:**
- Create `.env.development`, `.env.production` templates
- Gate dev-only features behind `NODE_ENV === 'development'`
- Document all required env vars in `.env.example`

### 5.5 — Dependency Security

#### 5.5.1: Upgrade Vulnerable Packages
**Problem:** `xlsx` (SheetJS) v0.18.5 has known vulnerabilities.

**Solution:**
- Upgrade `xlsx` to latest version or replace with safer alternative
- Run `npm audit` and fix all critical/high vulnerabilities
- Add `npm audit` to CI pipeline

#### 5.5.2: Lockfile Integrity
**Problem:** No supply chain protection.

**Solution:**
- Use `npm ci` in deployment (not `npm install`)
- Commit `package-lock.json`
- Enable Dependabot or Renovate for automated updates
- Review `package.json` scripts before installing new packages

### 5.6 — Monitoring & Logging

#### 5.6.1: Security Event Logging
**Problem:** No alerting on security events.

**Solution:**
- Log all failed login attempts with IP and timestamp
- Log all rate-limited requests
- Log all 403/401 responses
- Log all admin actions (user creation, deletion, suspension)
- Alert on: 10+ failed logins in 5 minutes, admin actions, sync failures

#### 5.6.2: Audit Log Sanitization
**Problem:** User input stored raw in audit logs.

**Solution:**
- Sanitize all user input before storing in audit logs
- Strip newlines, control characters
- Use structured logging (JSON) instead of string interpolation

---

## 6. Implementation Phases

### Phase 1: Critical Fixes (Deploy-Blocking)
**Timeline:** Before any production deployment  
**Effort:** 2-3 days

| Task | Files | Priority |
|------|-------|----------|
| Remove hardcoded dev credentials | `ensureDevAccount.ts`, `auth.ts` | P0 |
| Remove JWT fallback secret | `auth.ts`, `middleware/auth.ts` | P0 |
| Add startup JWT_SECRET validation | `index.ts` | P0 |
| Add `express-rate-limit` to login | `auth.ts`, `index.ts` | P0 |
| Rotate all exposed secrets | `.env` | P0 |
| Add `.env` to `.gitignore`, create `.env.example` | root | P0 |

### Phase 2: Auth System Overhaul
**Timeline:** 1-2 weeks  
**Effort:** 5-7 days

| Task | Files | Priority |
|------|-------|----------|
| Add `status` field to User model | `schema.prisma` | P0 |
| Auth middleware DB status check | `middleware/auth.ts` | P0 |
| Login status check | `auth.ts` | P0 |
| Add refresh token system | `schema.prisma`, `auth.ts`, `middleware/auth.ts` | P0 |
| Move JWT to httpOnly cookie | `auth.ts`, frontend `api.ts` | P0 |
| Sync deactivation of removed users | `enrollproSync.ts`, `teacherSync.ts` | P0 |
| Reduce JWT expiry to 15 minutes | `auth.ts` | P0 |

### Phase 3: Input Validation & Authorization
**Timeline:** 1-2 weeks  
**Effort:** 5-7 days

| Task | Files | Priority |
|------|-------|----------|
| Zod schemas on all endpoints | All route files | P1 |
| IDOR protection on student data | `registrar.ts`, `advisory.ts`, `grades.ts` | P1 |
| Remove token from query string | `middleware/auth.ts`, frontend | P1 |
| Sanitize audit log inputs | `auth.ts`, `admin.ts` | P1 |
| CSV injection prevention | `admin.ts` | P1 |

### Phase 4: Infrastructure Hardening
**Timeline:** 1 week  
**Effort:** 3-5 days

| Task | Files | Priority |
|------|-------|----------|
| Add `helmet` security headers | `index.ts` | P1 |
| CORS hardening | `index.ts` | P1 |
| TLS verification in production | `enrollproClient.ts`, `httpClient.ts` | P1 |
| Static file auth | `index.ts` | P1 |
| Request size limits | `index.ts` | P1 |
| SSE connection limits | `sseManager.ts` | P2 |

### Phase 5: Monitoring & Supply Chain
**Timeline:** Ongoing  
**Effort:** 2-3 days initial + maintenance

| Task | Files | Priority |
|------|-------|----------|
| Security event logging | Multiple | P2 |
| `npm audit` in CI | CI config | P2 |
| Upgrade `xlsx` | `package.json` | P2 |
| Dependabot/Renovate setup | GitHub settings | P2 |
| SVG upload sanitization or removal | `admin.ts` | P2 |

---

## 7. Research: Best Practices

### 7.1: JWT Strategy (No Redis)

**Recommended:** Short-lived access tokens (15min) + refresh tokens in httpOnly cookies, tracked in PostgreSQL.

| Component | Value | Rationale |
|-----------|-------|-----------|
| Access token expiry | 15 minutes | Minimizes exposure window |
| Refresh token expiry | 7 days | User convenience |
| Signing algorithm | HS256 | Single-service app, simpler key management |
| Secret length | >= 256 bits | OWASP minimum for HS256 |
| Storage | httpOnly/Secure/SameSite=Strict cookie | Prevents XSS theft |
| Revocation | Delete refresh token from DB | Immediate effect, no Redis needed |
| Token binding | Include `jti` claim | Enables per-token revocation |

**Trade-off:** This adds a DB query on token refresh, but that's acceptable for a school management system. The alternative (stateless 24h tokens) is insecure.

### 7.2: Account Suspension Pattern

**Recommended:** Status flag + soft-delete + immediate effect.

| Aspect | Recommendation |
|--------|---------------|
| Status field | `ACTIVE`, `SUSPENDED`, `DEACTIVATED` enum |
| Soft-delete | `deletedAt` timestamp, never hard-delete users |
| Middleware check | Query DB on every request (or cache with 30s TTL) |
| Suspension speed | Immediate — delete all refresh tokens |
| Error message | Generic: "Account is not active" (no enumeration) |
| Audit log | Record who suspended and why |

### 7.3: OWASP-Aligned Defense Layers

```
Layer 1: Input Validation (Zod schemas)
Layer 2: Authentication (JWT + refresh token + rate limiting)
Layer 3: Authorization (RBAC + ownership checks)
Layer 4: Security Headers (Helmet)
Layer 5: CORS (strict origins)
Layer 6: Rate Limiting (per-IP and per-user)
Layer 7: Logging & Monitoring (security events)
```

### 7.4: Password Policy (NIST SP800-63B)

- Minimum 15 characters (without MFA) or 8 characters (with MFA)
- Maximum >= 64 characters (allow passphrases)
- No composition rules (allow all characters)
- Block breached passwords (HaveIBeenPwned API)
- No periodic rotation — only on compromise
- bcrypt cost factor >= 12 (current: 10)

### 7.5: MFA for Admin Accounts

**Recommended:** TOTP (Google Authenticator / Authy) for admin accounts.

- Use `speakeasy` or `otplib` for Node.js TOTP
- Store shared secret encrypted in DB
- Require MFA setup on first admin login
- Provide backup codes (10 one-time-use codes)
- OWASP: "MFA would have stopped 99.9% of account compromises"

### 7.6: Supply Chain Security

- Use `npm ci` in CI/CD (clean install from lockfile)
- Enable `npm audit` in CI pipeline
- Pin exact versions for critical dependencies
- Review `package.json` scripts before installing
- Consider Snyk or Socket.dev for runtime analysis
- Use `npm provenance` for package verification

---

## Appendix A: All Vulnerability Files Reference

| ID | Severity | File | Lines |
|----|----------|------|-------|
| C1 | CRITICAL | `server/src/lib/ensureDevAccount.ts` | 5-12 |
| C2 | CRITICAL | `server/src/routes/auth.ts` | 167 |
| C2 | CRITICAL | `server/src/middleware/auth.ts` | 31 |
| C3 | CRITICAL | `server/.env` | all |
| C4 | CRITICAL | `server/src/routes/auth.ts` | 15 |
| H1 | HIGH | `server/src/middleware/auth.ts` | 21 |
| H2 | HIGH | `server/src/routes/auth.ts` | 237-261 |
| H3 | HIGH | `server/src/routes/auth.ts` | 168 |
| H4 | HIGH | `server/src/routes/auth.ts` | 78-110 |
| H5 | HIGH | `server/src/middleware/auth.ts` | 49 |
| H6 | HIGH | `server/src/lib/enrollproClient.ts` | 45 |
| H7 | HIGH | `server/src/lib/enrollproSync.ts` | 155 |
| H8 | HIGH | `server/src/routes/registrar.ts` | 504-536, 591-898, 901-1021, 1169-1404 |
| M1 | MEDIUM | `server/src/routes/auth.ts` | 20-23 |
| M2 | MEDIUM | `server/src/routes/auth.ts` | 137-139 |
| M3 | MEDIUM | `server/src/routes/auth.ts` | 84 |
| M4 | MEDIUM | `server/src/routes/admin.ts` | 441-508 |
| M5 | MEDIUM | `server/src/routes/grades.ts` | 428-646 |
| M6 | MEDIUM | `server/src/routes/admin.ts` | 39-48 |
| M7 | MEDIUM | `server/src/routes/admin.ts` | 773-778 |
| M8 | MEDIUM | `server/src/routes/integration.ts` | 72-114 |
| M9 | MEDIUM | `server/src/lib/sseManager.ts` | 12-33 |
| M10 | MEDIUM | `server/src/middleware/auth.ts` | 21 |
| M11 | MEDIUM | `server/src/index.ts` | 30 |
| M12 | MEDIUM | Multiple route files | Multiple |
| L1 | LOW | `server/src/routes/auth.ts` | 58, 113 |
| L2 | LOW | `server/src/routes/auth.ts` | 74 |
| L3 | LOW | `server/prisma/schema.prisma` | 16 |
| L4 | LOW | `server/src/routes/admin.ts` | 662 |
| L5 | LOW | `server/src/routes/registrar.ts` | 1812 |
| L6 | LOW | Multiple files | Multiple |
| L7 | LOW | `server/src/routes/admin.ts` | 795, 1057 |

---

## Appendix B: Recommended Dependencies to Add

| Package | Purpose | Phase |
|---------|---------|-------|
| `helmet` | Security headers | 4 |
| `express-rate-limit` | Rate limiting | 1 |
| `zod` | Input validation (already in frontend) | 3 |
| `otplib` | TOTP MFA for admins | 5 |
| `bcrypt` (upgrade cost) | Stronger password hashing | 2 |

## Appendix C: Recommended Dependencies to Upgrade/Remove

| Package | Current | Issue | Action |
|---------|---------|-------|--------|
| `xlsx` | v0.18.5 | Prototype pollution, ReDoS | Upgrade or replace |
