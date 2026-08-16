# Phase 1: Security Implementation Plan

**Date:** August 16, 2026  
**Status:** Planning — Do Not Implement Yet  
**Scope:** Critical fixes only (deploy-blocking vulnerabilities)

---

## Summary of Understanding

Phase 1 fixes the **4 CRITICAL vulnerabilities** that make the system unsafe to deploy:

1. **Remove hardcoded dev backdoor** — The dev account (`999999`/`dev123`) with universal bypass is hardcoded in source. Must be gated behind `NODE_ENV=development` and credentials moved to env vars.
2. **Remove JWT fallback secret** — `process.env.JWT_SECRET || "fallback-secret"` allows token forgery. Must crash on startup if missing.
3. **Add rate limiting** — No rate limiting anywhere. Login endpoint is vulnerable to brute force. Add `express-rate-limit`.
4. **Secret hygiene** — `.env` is not gitignored, no `.env.example` exists. Fix gitignore, create documentation file.

**Approach:** Step-by-step, test after each change, verify server starts and login works before concluding.

---

## Step-by-Step Implementation

### Step 1: Install `express-rate-limit`

**What:** Add rate limiting dependency to server.  
**Why:** Prevents brute-force attacks on login endpoint.  
**File:** `server/package.json`

**Action:**
```bash
cd server && npm install express-rate-limit
```

**Verify:** Check `package.json` has `"express-rate-limit"` in dependencies.

---

### Step 2: Create `.env.example`

**What:** Create a documentation file showing all required env vars with placeholder values.  
**Why:** New developers know what vars are needed. Secrets are not documented in code.  
**File:** `server/.env.example` (NEW)

**Action:** Create file with all env vars from `.env`, replacing real values with placeholders:

```bash
# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/smart_db

# JWT Secret Key (generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=

# Server Port
PORT=5003

# ATLAS Integration
ATLAS_BASE_URL=http://your-atlas-host/api/v1
ATLAS_URL=http://your-atlas-host/api/v1
ATLAS_SCHOOL_ID=1
ATLAS_SCHOOL_YEAR_ID=3
ATLAS_SYSTEM_TOKEN=your-atlas-token

# EnrollPro Integration
ENROLLPRO_BASE_URL=http://your-enrollpro-host/api
ENROLLPRO_ACCOUNT_NAME=your-account-name
ENROLLPRO_PASSWORD=your-password
ENROLLPRO_SCHOOL_YEAR_ID=38
ENROLLPRO_SCHOOL_YEAR_LABEL=2026-2027
CURRENT_SCHOOL_YEAR=2026-2027

# AIMS Integration
AIMS_BASE_URL=http://your-aims-host/api/v1
AIMS_URL=http://your-aims-host/api/v1

# Sync Configuration
SYNC_INTERVAL_MS=300000
LOG_LEVEL=info

# Development (set to "true" only in development)
CREATE_DEV_ACCOUNT=false
```

**Verify:** File exists, no real secrets in it.

---

### Step 3: Fix `.gitignore`

**What:** Add `.env` and `.env.*` (except `.env.example`) to `.gitignore`.  
**Why:** Prevent secrets from being committed to git.  
**File:** `.gitignore` (root)

**Action:** Append to `.gitignore`:

```gitignore
# Environment variables (secrets)
.env
.env.*
!.env.example
```

**Verify:** Run `git status` — `.env` should not appear as a tracked file going forward.  
**Note:** If `.env` is already tracked, run `git rm --cached server/.env` to untrack it (does not delete the local file).

---

### Step 4: Create env validation module

**What:** Create a centralized env var validation function that runs at startup.  
**Why:** App crashes immediately if critical vars are missing, instead of running insecurely.  
**File:** `server/src/config/env.ts` (NEW)

**Action:** Create file:

```typescript
/**
 * Environment variable validation.
 * Runs at startup — crashes the process if required vars are missing.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n[FATAL] Missing required environment variable: ${name}`);
    console.error(`Add it to server/.env or set it in your environment.\n`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

// Validate required vars on import
export function validateEnv(): void {
  requireEnv("JWT_SECRET");
  requireEnv("DATABASE_URL");

  // Warn if JWT_SECRET looks weak
  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) {
    console.warn(`[WARN] JWT_SECRET is only ${jwtSecret.length} characters. Recommended: 64+ characters.`);
  }
  if (jwtSecret === "fallback-secret") {
    console.error("\n[FATAL] JWT_SECRET is set to the insecure default 'fallback-secret'.");
    console.error("Generate a secure secret: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"\n");
    process.exit(1);
  }
}

export function getJwtSecret(): string {
  return requireEnv("JWT_SECRET");
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function shouldCreateDevAccount(): boolean {
  // Only create dev account in development mode or when explicitly enabled
  return isDevelopment() || process.env.CREATE_DEV_ACCOUNT === "true";
}
```

**Verify:** File compiles (check with `npx tsc --noEmit`).

---

### Step 5: Add startup env validation to `index.ts`

**What:** Call `validateEnv()` before the server starts listening.  
**Why:** Server crashes immediately if `JWT_SECRET` is missing.  
**File:** `server/src/index.ts`

**Changes:**
1. Import `validateEnv` from `./config/env`
2. Call `validateEnv()` at the top of the file, after `dotenv.config()` but before creating the Express app
3. Add `trust proxy` setting for rate limiter accuracy

**Resulting structure:**
```typescript
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { validateEnv } from "./config/env";

// Validate environment variables — crashes if critical vars are missing
validateEnv();

import express from "express";
// ... rest of imports

const app = express();
const PORT = process.env.PORT || 5003;

// Trust proxy (needed for accurate req.ip behind reverse proxy)
app.set("trust proxy", 1);

// ... rest of middleware and routes
```

**Verify:** Server starts without errors when `.env` is valid. Server crashes with clear message if `JWT_SECRET` is removed.

---

### Step 6: Add rate limiting to auth routes

**What:** Add `express-rate-limit` to the login endpoint.  
**Why:** Prevents brute-force attacks.  
**File:** `server/src/routes/auth.ts`

**Changes:**
1. Import `rateLimit` from `express-rate-limit`
2. Create a `loginLimiter` with:
   - Window: 15 minutes
   - Max attempts: 5 per IP+username combo
   - Skip successful requests (don't count logins that succeed)
   - Custom error message
3. Apply `loginLimiter` to the `/login` route

**Resulting code at top of file:**
```typescript
import { rateLimit } from "express-rate-limit";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window per key
  skipSuccessfulRequests: true, // only count failed attempts
  keyGenerator: (req) => {
    const identifier = req.body?.email || req.body?.username || "unknown";
    return `login:${req.ip}:${identifier}`;
  },
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
```

**Apply to route:**
```typescript
router.post("/login", loginLimiter, async (req: Request, res: Response): Promise<void> => {
```

**Verify:** 
1. Start server, try logging in 6 times with wrong password — 6th attempt should return 429
2. Try with correct password on attempt 3 — should succeed (skipSuccessfulRequests)
3. Try a different username — should have fresh attempts (key includes username)

---

### Step 7: Remove JWT fallback secret

**What:** Replace `process.env.JWT_SECRET || "fallback-secret"` with `getJwtSecret()`.  
**Why:** Prevents token forgery if env var is missing (though Step 5 already crashes).  
**Files:** `server/src/routes/auth.ts`, `server/src/middleware/auth.ts`

**Changes in `auth.ts` (line 166):**
```typescript
// Before:
process.env.JWT_SECRET || "fallback-secret"

// After:
import { getJwtSecret } from "../config/env";
// ...
getJwtSecret(),
```

**Changes in `middleware/auth.ts` (line 31):**
```typescript
// Before:
process.env.JWT_SECRET || "fallback-secret"

// After:
import { getJwtSecret } from "../config/env";
// ...
getJwtSecret(),
```

**Verify:** 
1. Server starts normally with valid `JWT_SECRET`
2. Login works, token is issued
3. Protected routes accept the token

---

### Step 8: Gate dev account behind `NODE_ENV`

**What:** Only create dev account when `NODE_ENV !== 'production'` or `CREATE_DEV_ACCOUNT=true`.  
**Why:** Dev backdoor should never exist in production.  
**File:** `server/src/lib/ensureDevAccount.ts`

**Changes:**
1. Import `shouldCreateDevAccount` from `../config/env`
2. Add early return at the top of `ensureDevAccount()` if not allowed
3. Remove hardcoded `DEV_CREDENTIALS` — use env vars instead

**Resulting code:**
```typescript
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { Role, GradeLevel, SubjectType, Term } from "@prisma/client";
import { shouldCreateDevAccount } from "../config/env";

export async function ensureDevAccount(): Promise<void> {
  // Only create dev account in development or when explicitly enabled
  if (!shouldCreateDevAccount()) {
    console.log("[DevAccount] Skipped — not in development mode. Set CREATE_DEV_ACCOUNT=true to enable.");
    return;
  }

  // Dev credentials from env vars (with safe defaults for development only)
  const devUsername = process.env.DEV_USERNAME || "999999";
  const devEmail = process.env.DEV_EMAIL || "dev.sean@smart.local";
  const devPassword = process.env.DEV_PASSWORD || "dev123";
  const devFirstName = process.env.DEV_FIRST_NAME || "Dev Sean";
  const devLastName = process.env.DEV_LAST_NAME || "Roma";
  const devEmployeeId = process.env.DEV_EMPLOYEE_ID || "999999";

  try {
    const hashedPassword = await bcrypt.hash(devPassword, 10);

    // ... rest of function uses these variables instead of DEV_CREDENTIALS
```

**Remove:** The `DEV_CREDENTIALS` export object (line 5-12).

**Verify:**
1. `NODE_ENV=development` — dev account is created (check server logs)
2. `NODE_ENV=production` — dev account is NOT created (check logs: "Skipped")
3. Dev account can still log in when created

---

### Step 9: Remove hardcoded developer bypass in `auth.ts`

**What:** Remove the hardcoded `isDeveloper` detection based on username/email/name patterns.  
**Why:** These hardcoded checks are a security risk — they can be spoofed.  
**File:** `server/src/routes/auth.ts`

**Changes:**
1. Remove lines 53-57 (the `isDeveloper` detection based on username/email/name patterns)
2. Remove lines 150-155 (the second `isDeveloper` detection block)
3. The `isDeveloper` flag should only come from the database (via a `User.isDeveloper` field in the future) or from env-based dev account creation

**For now (Phase 1):** Keep the developer bypass in `middleware/auth.ts:49` but make it depend on `NODE_ENV`:

```typescript
// In middleware/auth.ts — only bypass in development
if (process.env.NODE_ENV !== "production" && 
    (req.user.isDeveloper || req.user.role === "DEVELOPER" || req.user.username === "999999")) {
  return next();
}
```

**Verify:**
1. Dev account can access all role-protected endpoints in development
2. In production mode, dev account gets normal role-based access (no bypass)

---

### Step 10: Test everything

**What:** Full integration test to verify all changes work together.

**Test Sequence:**
1. **Server starts** — `npm run dev` in `server/` should start without errors
2. **Env validation works** — Remove `JWT_SECRET` from `.env`, server should crash with clear message
3. **Dev account gating** — With `NODE_ENV=production`, dev account should NOT be created
4. **Rate limiting works** — Login 6 times with wrong password, 6th returns 429
5. **Login works** — Correct credentials return JWT token
6. **Protected routes work** — Token from login works on `/api/auth/me`
7. **Dev bypass works (dev mode)** — Dev account can access admin/teacher/registrar endpoints
8. **Dev bypass blocked (prod mode)** — With `NODE_ENV=production`, dev account gets 403 on unauthorized endpoints

**Commands to run:**
```bash
cd server
npm run dev                    # Start server
curl http://localhost:5003/api/health  # Health check
# Test login, rate limiting, etc.
```

---

## Files Modified/Created Summary

| Action | File | Purpose |
|--------|------|---------|
| MODIFY | `server/package.json` | Add `express-rate-limit` dependency |
| CREATE | `server/.env.example` | Env var documentation |
| MODIFY | `.gitignore` | Add `.env` exclusion |
| CREATE | `server/src/config/env.ts` | Env validation module |
| MODIFY | `server/src/index.ts` | Add startup validation, trust proxy |
| MODIFY | `server/src/routes/auth.ts` | Rate limiting, remove fallback secret, remove dev detection |
| MODIFY | `server/src/middleware/auth.ts` | Remove fallback secret, conditional dev bypass |
| MODIFY | `server/src/lib/ensureDevAccount.ts` | Gate behind NODE_ENV, remove hardcoded credentials |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Rate limiter blocks legitimate users | Low | Medium | `skipSuccessfulRequests: true` + generous 5-attempt window |
| Dev account breaks in dev mode | Low | Low | Env var defaults match current hardcoded values |
| Server crashes on missing env var | Medium | High | Clear error message tells developer exactly what's missing |
| `.env` already tracked in git | Medium | Medium | `git rm --cached` untracks without deleting local file |

---

## Rollback Plan

If any change breaks the system:
1. Revert the specific file using `git checkout HEAD -- <file>`
2. All changes are in separate commits, so individual rollback is possible
3. The `.env` file itself is never modified (only `.env.example` is created)
