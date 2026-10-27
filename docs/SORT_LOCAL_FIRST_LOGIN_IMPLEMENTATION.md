# SORT Local-First Login — Implementation Spec for the SORT AI

**Audience:** SORT / MRF engineering and the SORT AI agent
**Goal:** make SORT's normal login as fast as SMART's by checking the local password hash first and calling EnrollPro only as a fallback.
**Scope:** password login only. **Do not add SSO in this change.** The missing `/api/auth/enrollpro/callback` route is a separate task.
**Source of SORT facts:** `SORT_FIRST_TIME_SSO_AUDIT_FOR_SMART.md` (HEAD `926d0a9`). Verify paths and line numbers before editing; they may have shifted.

---

## 0. The answer in one page

**Yes, SORT can log in like SMART.** SORT already has the two pieces needed:

- `User.passwordHash` — the cached bcrypt hash.
- `server/src/services/offline-auth.service.ts` — an existing cached-password verifier.

The problem is the **order**. SORT currently:

```text
local user lookup -> require syncSource -> call EnrollPro -> issue session
```

SMART does:

```text
local user lookup -> bcrypt compare -> issue session
                                  \-> only on local miss: call EnrollPro
```

Change SORT to SMART's order:

```text
local user lookup
  -> local bcrypt check
      -> success and no gate: issue session (NO EnrollPro call)
      -> miss / first login / password-change gate: call EnrollPro
          -> success: cache hash, issue session
          -> must-change: 403 PASSWORD_CHANGE_REQUIRED, no session
```

Expected result:

| Login case | Today | After |
|---|---|---|
| Existing user, correct password, EnrollPro up | EnrollPro network call | Local bcrypt only |
| Existing user, correct password, EnrollPro down | Cached hash fallback | Local bcrypt only |
| First login / no cached hash | EnrollPro call | EnrollPro call, then cache |
| Password changed in EnrollPro | EnrollPro call | Local miss, then EnrollPro fallback |
| Default password / must-change | Full session issued (bug) | `403 PASSWORD_CHANGE_REQUIRED`, no session |
| Normal login latency | EnrollPro round trip | Local bcrypt (~50–150 ms target) |

**First-ever login still needs EnrollPro** because the password only exists there. After that one successful login, normal logins are local.

---

## 1. Definition of done

The change is complete only when all of these are true:

- [ ] An existing user with a verified local hash and the correct password logs in **without any EnrollPro HTTP call**.
- [ ] The same user can log in while EnrollPro is down.
- [ ] A first-time user with no local hash still authenticates through EnrollPro and gets a local hash cached.
- [ ] A wrong password triggers exactly one EnrollPro fallback and returns a generic `401 INVALID_CREDENTIALS`.
- [ ] `mustChangePassword` / `requiresPasswordReset` prevents session issuance and returns `403 PASSWORD_CHANGE_REQUIRED` with a password-change URL.
- [ ] Suspended, archived, portal-inactive, not-enrolled, and wrong-portal users are still blocked.
- [ ] Login audit records `authSource: "LOCAL"` or `"ENROLLPRO"`.
- [ ] No password, hash, token, or secret is written to logs.
- [ ] Unit, integration, and E2E tests pass.
- [ ] A before/after latency measurement is included in the handoff.
- [ ] No SSO route, SSO page, or verification-ticket code is added in this change.

---

## 2. Current flow vs target flow

### 2.1 Current SORT flow (from the audit)

```text
POST /api/auth/login { identifier, password, portal? }
1. Find local User by enrollproLrn | employeeId | email.
   No user -> 401 INVALID_CREDENTIALS. No auto-create.
2. Require syncSource = ENROLLPRO -> otherwise 401 NOT_PROVISIONED.
3. Student enrollment gate -> 403 NOT_ENROLLED if archived/not enrolled.
4. Call EnrollPro /auth/login (staff) or /learner/auth (student).
5. Only if EnrollPro is unreachable -> verify cached bcrypt hash.
6. Check suspension.
7. Portal role gate.
8. Cache the verified password hash (unless offline or must-change).
9. Issue access JWT + refresh token.
```

Reference: `server/src/routes/auth.routes.ts:76-270`.

### 2.2 Target SORT flow

```text
POST /api/auth/login { identifier, password, portal? }
1. Find local User by enrollproLrn | employeeId | email.
   No user -> dummy bcrypt compare -> 401 INVALID_CREDENTIALS.
2. Require syncSource = ENROLLPRO -> otherwise 401 NOT_PROVISIONED.
3. Student enrollment gate -> 403 NOT_ENROLLED if archived/not enrolled.
4. Local-first credential check:
   a. If passwordHash exists, bcrypt.compare(password, passwordHash).
   b. If match AND passwordVerifiedAt is set AND no password-change flag
      AND no optional revalidation is due:
        -> skip EnrollPro.
        -> continue to local status/portal/verification gates.
        -> issue session.
5. Fallback to EnrollPro only when the local fast path is not eligible:
   a. no local hash,
   b. local compare failed,
   c. passwordVerifiedAt is null (first login after migration),
   d. password-change flag is set (must re-check with EnrollPro),
   e. optional revalidation TTL expired.
6. EnrollPro success:
   a. cache the password hash,
   b. set passwordVerifiedAt = now,
   c. clear password-change flags,
   d. issue session.
7. EnrollPro says must-change:
   a. set the local flag,
   b. clear the cached hash and passwordVerifiedAt,
   c. return 403 PASSWORD_CHANGE_REQUIRED; no tokens.
8. EnrollPro unreachable:
   a. if local hash matched and the user is not in a must-change state:
        allow local login (availability), log AUTH_LOCAL_UNVERIFIED only if
        a revalidation was due;
   b. if passwordVerifiedAt is null or a must-change flag is set:
        return 503 AUTH_SERVICE_UNAVAILABLE;
   c. if no usable local hash:
        return 503 AUTH_SERVICE_UNAVAILABLE;
   d. if a local hash exists but the password did not match:
        return 401 INVALID_CREDENTIALS (do not reveal the outage).
9. Local status, portal, optional verification, and session issuance are unchanged.
```

The important difference from today: **step 4 completes the login without step 5** for normal users.

---

## 3. Schema changes

Add these fields to SORT's `User` model (`server/prisma/schema.prisma`, currently around `:129-182`):

```prisma
model User {
  // existing fields...
  passwordHash           String?
  passwordCachedAt       DateTime?
  passwordVerifiedAt     DateTime?   // NEW: last time EnrollPro confirmed the password
  passwordChangeRequired Boolean   @default(false) // NEW: staff mustChangePassword
  passwordResetRequired  Boolean   @default(false) // NEW: learner requiresPasswordReset
}
```

Notes:

- `passwordVerifiedAt` is not the same as `passwordCachedAt`. `passwordCachedAt` says when SORT stored a hash. `passwordVerifiedAt` says when EnrollPro last confirmed the credential. Local-first must require the latter.
- `passwordChangeRequired` and `passwordResetRequired` are separate because staff and learner endpoints use different flags.
- Do not add a `verificationStatus` / ticket table in this change. That is for a separate first-time verification feature. This change only stops the existing default-password bypass.
- Do not store plaintext passwords or reversible encryption.

### 3.1 Migration

```sql
ALTER TABLE "users"
  ADD COLUMN "passwordVerifiedAt" TIMESTAMP,
  ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordResetRequired" BOOLEAN NOT NULL DEFAULT false;

-- Force one EnrollPro validation after deployment so any existing
-- must-change state is captured before local-first starts trusting hashes.
UPDATE "users" SET "passwordVerifiedAt" = NULL;
```

Why set `passwordVerifiedAt = NULL` for existing rows:

- Existing cached hashes have never been checked against EnrollPro's current must-change flags.
- If SORT starts trusting them immediately, a user still on a default password could bypass the gate.
- The first login after deployment calls EnrollPro once, captures the flag, and then local-first works.

If forcing one EnrollPro login per user is unacceptable during the rollout window, the alternative is to keep `AUTH_LOCAL_FIRST` disabled until a maintenance window, then deploy the migration. Do not backfill `passwordVerifiedAt` with `passwordCachedAt`; that defeats the safety check.

---

## 4. Backend implementation

### 4.1 File-by-file

| File | Change |
|---|---|
| `server/src/routes/auth.routes.ts` | Replace the EnrollPro-first credential branch with the local-first algorithm in §4.2. Add the 403 must-change response. Add `authSource` audit. |
| `server/src/services/offline-auth.service.ts` | Extract a reusable `verifyLocalPassword(user, password)` from the existing cached-hash verifier. Keep `cachePasswordHash` and `clearCachedPassword`; make them update `passwordVerifiedAt`. |
| `server/src/services/enrollpro-auth.service.ts` | Ensure both staff and learner responses expose `mustChangePassword` / `requiresPasswordReset` and a stable reason. No network behavior change. |
| `server/prisma/schema.prisma` | Add the four fields from §3. |
| Prisma migration | Add columns and the `passwordVerifiedAt = NULL` backfill. |
| `.env.example` | Add `AUTH_LOCAL_FIRST=true`, `AUTH_LOCAL_REVALIDATE_DAYS=0`, `ENROLLPRO_PASSWORD_CHANGE_URL=`. |
| `src/components/auth/PortalLogin.tsx` | Handle `PASSWORD_CHANGE_REQUIRED`: clear auth state, show the message, show the EnrollPro password-change link. |
| `src/hooks/useAuthState.ts` | Only mark authenticated when the response contains a token. Never persist a token from a 403. |
| `src/utils/loginErrors.ts` | Keep the existing `PASSWORD_CHANGE_REQUIRED` message; add the URL handling. |
| Tests | Add the cases in §8. |

### 4.2 Login algorithm

```ts
const AUTH_LOCAL_FIRST = process.env.AUTH_LOCAL_FIRST !== "false";
const REVALIDATE_DAYS = Number(process.env.AUTH_LOCAL_REVALIDATE_DAYS ?? "0");

router.post("/login", async (req, res) => {
  const { identifier, password, portal } = req.body;

  const user = await findLocalUser(identifier); // existing lookup
  if (!user) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH); // timing equalization
    await auditLoginFailure(null, identifier, "INVALID_CREDENTIALS");
    return res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" });
  }

  if (user.syncSource !== "ENROLLPRO") {
    return res.status(401).json({
      error: "Account not provisioned. Contact your administrator.",
      code: "NOT_PROVISIONED",
    });
  }

  if (user.role === "STUDENT" && !isActivelyEnrolled(user)) {
    return res.status(403).json({ error: "Not enrolled", code: "NOT_ENROLLED" });
  }

  const hasLocalHash = Boolean(user.passwordHash);
  const localMatches = hasLocalHash
    ? await bcrypt.compare(password, user.passwordHash!)
    : false;

  const passwordChangeGate =
    user.passwordChangeRequired || user.passwordResetRequired;

  const neverVerified = !user.passwordVerifiedAt;

  const revalidationDue =
    REVALIDATE_DAYS > 0 &&
    user.passwordVerifiedAt != null &&
    Date.now() - user.passwordVerifiedAt.getTime() >
      REVALIDATE_DAYS * 24 * 60 * 60 * 1000;

  // FAST PATH: no EnrollPro call.
  const canUseLocalFastPath =
    AUTH_LOCAL_FIRST &&
    localMatches &&
    !passwordChangeGate &&
    !neverVerified &&
    !revalidationDue;

  if (canUseLocalFastPath) {
    return finishLogin(user, "LOCAL");
  }

  // FALLBACK PATH: EnrollPro is required or the local attempt failed.
  let ep;
  try {
    ep =
      user.role === "STUDENT"
        ? await enrollProLearnerAuth(identifier, password)
        : await enrollProStaffAuth(identifier, password);
  } catch (err) {
    // EnrollPro unreachable.
    if (localMatches && !passwordChangeGate && !neverVerified) {
      // Availability path. This is the SMART behavior: a verified local
      // credential still works during an outage.
      await auditLoginSuccess(user, "LOCAL_STALE");
      return finishLogin(user, "LOCAL_STALE");
    }
    if (neverVerified || passwordChangeGate) {
      return res.status(503).json({
        error: "Authentication service unavailable",
        code: "AUTH_SERVICE_UNAVAILABLE",
      });
    }
    if (!hasLocalHash) {
      return res.status(503).json({
        error: "Authentication service unavailable",
        code: "AUTH_SERVICE_UNAVAILABLE",
      });
    }
    // A local hash existed but the password did not match.
    await auditLoginFailure(user, identifier, "INVALID_CREDENTIALS");
    return res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" });
  }

  if (ep.invalid) {
    await auditLoginFailure(user, identifier, "INVALID_CREDENTIALS");
    return res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" });
  }

  if (ep.mustChangePassword || ep.requiresPasswordReset) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordChangeRequired: Boolean(ep.mustChangePassword),
        passwordResetRequired: Boolean(ep.requiresPasswordReset),
        passwordHash: null,
        passwordVerifiedAt: null,
      },
    });
    await auditLoginBlocked(user, "PASSWORD_CHANGE_REQUIRED");
    return res.status(403).json({
      error: "Password change required",
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "Please change your password in EnrollPro before signing in.",
      passwordChangeUrl: process.env.ENROLLPRO_PASSWORD_CHANGE_URL ?? null,
    });
  }

  // EnrollPro verified the password and no change is required.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordChangeRequired: false,
      passwordResetRequired: false,
      passwordHash: await bcrypt.hash(password, 10),
      passwordCachedAt: new Date(),
      passwordVerifiedAt: new Date(),
    },
  });

  await auditLoginSuccess(user, "ENROLLPRO");
  return finishLogin(user, "ENROLLPRO");
});
```

`finishLogin` is the existing local post-credential pipeline, extracted so both paths share it:

```ts
async function finishLogin(user, authSource) {
  if (user.accountStatus === "SUSPENDED") {
    return res.status(403).json({ error: "Account unavailable", code: "ACCOUNT_UNAVAILABLE" });
  }
  if (user.archivedAt) {
    return res.status(403).json({ error: "Account unavailable", code: "ACCOUNT_UNAVAILABLE" });
  }
  if (!user.portalAccountActive) {
    return res.status(403).json({ error: "Account unavailable", code: "ACCOUNT_UNAVAILABLE" });
  }
  if (!portalAllows(user.role, portal)) {
    return res.status(403).json({ error: "Wrong portal", code: "WRONG_PORTAL" });
  }
  // If a separate verification feature exists later, add its gate here.
  // Do not add it in this change.

  const accessToken = signAccessToken(user);
  const refreshToken = await createUserSession(user, req);
  await auditLoginSuccess(user, authSource);

  return res.json({
    token: accessToken,
    accessToken,
    refreshToken,
    expiresIn: `${ACCESS_EXPIRY_SECONDS}s`,
    user: safeUser(user),
  });
}
```

### 4.3 Why the `neverVerified` check exists

Without it, a user who has a cached hash from before this deployment would skip EnrollPro immediately, and SORT would never discover that the user still has a default password. `passwordVerifiedAt = NULL` forces exactly one EnrollPro check after deployment. After that, local-first is safe for that user until the optional revalidation window.

### 4.4 Revalidation TTL

- `AUTH_LOCAL_REVALIDATE_DAYS=0` means “never revalidate while the hash matches” — this is exact SMART parity and the fastest behavior.
- `AUTH_LOCAL_REVALIDATE_DAYS=7` means each user goes through EnrollPro once a week. This catches password changes and stale must-change flags sooner, at the cost of one slower login per user per week.
- Pick one policy explicitly. Do not leave it undocumented.
- If a revalidation is due and EnrollPro is down, the algorithm above allows a verified local login and logs `LOCAL_STALE`. If security policy requires a hard failure instead, change that branch to `503`.

### 4.5 First-time users and no local account

SORT currently returns `401 INVALID_CREDENTIALS` when no local `User` exists. Keep that behavior. Do **not** add login auto-create in this change.

- The existing EnrollPro sync must provision the account first.
- If MRF wants a first-time user to log in before sync, that is a separate provisioning decision and a separate change.
- This is different from SMART's password fallback, which can create a local staff user from EnrollPro. SORT's sync-only policy is safer; keep it unless MRF explicitly changes it.

---

## 5. Must-change handling

### 5.1 Server

- Never return a token when `mustChangePassword` or `requiresPasswordReset` is true.
- Clear `passwordHash` and `passwordVerifiedAt` so the next attempt cannot use the local fast path.
- Persist the flag so a later local attempt knows to force EnrollPro.
- Return:

```json
{
  "error": "Password change required",
  "code": "PASSWORD_CHANGE_REQUIRED",
  "message": "Please change your password in EnrollPro before signing in.",
  "passwordChangeUrl": "https://<enrollpro>/personnel/change-password"
}
```

- If `ENROLLPRO_PASSWORD_CHANGE_URL` is not configured, return `passwordChangeUrl: null`; the frontend must show a plain “Contact your administrator” message.
- If EnrollPro is unreachable while the flag is true, return `503 AUTH_SERVICE_UNAVAILABLE`. Do not bypass the gate.

### 5.2 Frontend

In `src/components/auth/PortalLogin.tsx`:

```ts
if (err.response?.status === 403 && err.response.data?.code === "PASSWORD_CHANGE_REQUIRED") {
  clearStoredAuth(); // remove token/refreshToken from sessionStorage/localStorage
  setError(err.response.data.message);
  setPasswordChangeUrl(err.response.data.passwordChangeUrl ?? null);
  return;
}
```

- Do not call `useAuthState`'s success path.
- Do not store `passwordChangeUrl` as a token.
- Show a “Change password in EnrollPro” button when the URL exists.
- After the user changes the password in EnrollPro, they return and log in normally. The next login goes through EnrollPro once, sees the flag cleared, caches the new hash, and starts local-first again.

In `src/hooks/useAuthState.ts`:

- Only set `token` / `authenticated` when the response has a token.
- Clear stale storage before a login attempt, or at least on the 403 path.
- Do not use the `mustChangePassword` field from a 200 response as a soft warning; the server must not produce that response.

---

## 6. Error matrix

| Status | Code | When | Tokens? |
|---:|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing identifier/password | No |
| 401 | `INVALID_CREDENTIALS` | Unknown user, wrong local password + EnrollPro reject, or local miss during outage | No |
| 401 | `NOT_PROVISIONED` | `syncSource !== ENROLLPRO` | No |
| 403 | `NOT_ENROLLED` | Student archived/not enrolled/alumni | No |
| 403 | `ACCOUNT_UNAVAILABLE` | Suspended, archived, portal inactive | No |
| 403 | `WRONG_PORTAL` | Role not allowed in requested portal | No |
| 403 | `PASSWORD_CHANGE_REQUIRED` | EnrollPro default-password flag | No |
| 429 | `RATE_LIMITED` | Failed-attempt limit exceeded | No |
| 503 | `AUTH_SERVICE_UNAVAILABLE` | EnrollPro required but unreachable | No |
| 500 | `INTERNAL_ERROR` | Unexpected failure | No |

Do not return a token on any error path.

---

## 7. Audit and observability

Add an `authSource` value to the existing login audit details:

```text
authSource: LOCAL | LOCAL_STALE | ENROLLPRO
result: success | failure | blocked
code: INVALID_CREDENTIALS | PASSWORD_CHANGE_REQUIRED | ...
durationMs
```

- Do not log the identifier if the existing logger masks it; keep that masking.
- Do not log passwords, hashes, tokens, or EnrollPro responses.
- Counters to monitor:
  - local successes,
  - EnrollPro fallback successes,
  - EnrollPro failures,
  - must-change blocks,
  - `AUTH_SERVICE_UNAVAILABLE`,
  - p50/p95 login duration by `authSource`.

If `LOCAL` successes drop or `ENROLLPRO` fallbacks spike, local-first is not working as intended.

---

## 8. Tests

### 8.1 Unit / integration

| # | Scenario | Expected |
|---:|---|---|
| 1 | Local hash matches, `passwordVerifiedAt` set, flags false | Session; EnrollPro mock not called |
| 2 | Local hash matches, `passwordVerifiedAt` set, EnrollPro down | Session; `authSource=LOCAL` or `LOCAL_STALE` |
| 3 | Local hash matches, `passwordVerifiedAt` null | EnrollPro called; on success hash cached and `passwordVerifiedAt` set |
| 4 | Local hash matches, `passwordVerifiedAt` null, EnrollPro down | 503; no session |
| 5 | Local hash missing, EnrollPro success | Hash cached; session |
| 6 | Local hash missing, EnrollPro down | 503; no session |
| 7 | Local hash exists, password wrong, EnrollPro rejects | 401 generic; no session |
| 8 | Local hash exists, password wrong, EnrollPro down | 401 generic; no session |
| 9 | `mustChangePassword=true` | 403 `PASSWORD_CHANGE_REQUIRED`; hash cleared; no tokens |
| 10 | `requiresPasswordReset=true` | 403; hash cleared; no tokens |
| 11 | Flag true, EnrollPro down | 503; no session |
| 12 | Flag true, user changes password, EnrollPro returns false | Flag cleared; new hash cached; session |
| 13 | Password changed in EnrollPro, old password used | Local miss → EnrollPro reject → 401 |
| 14 | Password changed in EnrollPro, new password used | Local miss → EnrollPro success → cache → session |
| 15 | Suspended user with correct local password | 403; no session |
| 16 | Archived / portal-inactive / not-enrolled | 403; no session |
| 17 | Wrong portal | 403 `WRONG_PORTAL`; no session |
| 18 | Rate limit exceeded | 429; no session |
| 19 | Unknown user | 401; dummy bcrypt compare; no EnrollPro call |
| 20 | Logs inspected | No password/hash/token/secret |

### 8.2 E2E

- Log in with a pre-provisioned staff account twice. First login may call EnrollPro; second must be visibly faster and must not call EnrollPro.
- Repeat for a learner account.
- Force EnrollPro offline and log in with a verified local account.
- Log in with a default-password account; confirm the 403 page and password-change link.
- Confirm the browser does not retain a token after the 403.

### 8.3 Performance

Measure and record:

```text
Before: p50 / p95 login duration (current EnrollPro-first)
After:  p50 / p95 local login duration
Fallback: p50 / p95 EnrollPro login duration
```

Target: local p95 under 300 ms on the deployment host. Do not claim a target without measuring it there.

---

## 9. Rollout and rollback

1. **Migrate first.** Add the columns and set `passwordVerifiedAt = NULL`.
2. **Deploy backend with `AUTH_LOCAL_FIRST=false`.** Behavior stays EnrollPro-first; the new columns are inert.
3. **Enable for test accounts** (`AUTH_LOCAL_FIRST=true` or a per-account allowlist). Verify the must-change gate and the local fast path.
4. **Enable for all.** Watch `authSource` counts, 403s, 503s, and latency.
5. **Rollback:** set `AUTH_LOCAL_FIRST=false`. The new columns remain; no data loss. Do not drop them during the rollback window.

If the rollout is during a school day, expect the first login after enabling to call EnrollPro once per user because `passwordVerifiedAt` is null. That is intentional.

---

## 10. Security review checklist

- [ ] Bcrypt cost is at least 10 (match the existing SORT cost).
- [ ] Local compare uses `bcrypt.compare`, never `===`.
- [ ] Unknown-user path performs a dummy bcrypt compare to reduce timing differences.
- [ ] `passwordHash` is never logged or returned.
- [ ] Must-change clears `passwordHash` and `passwordVerifiedAt` in the same transaction as setting the flag.
- [ ] A 403 never includes access or refresh tokens.
- [ ] The frontend clears stale tokens on the 403 path.
- [ ] Local status/portal/archived/enrollment checks remain before token issuance.
- [ ] Rate limiting remains per IP + identifier.
- [ ] Failed logins use one generic message.
- [ ] The stale-password policy (TTL or accept) is documented and approved.
- [ ] The “no local password storage” document is reconciled with the cached hash policy.
- [ ] EnrollPro suspension/password-reset events reach SORT via sync or revalidation.
- [ ] No SSO code is added in this change.

---

## 11. What not to do

- Do not remove the EnrollPro fallback. It is required for first login, password changes, and must-change checks.
- Do not add login auto-create.
- Do not add SSO routes or pages in this change.
- Do not copy SMART's cookie session model.
- Do not add a verification subsystem in this change; only enforce the existing default-password flag.
- Do not trust the client's `mustChangePassword` field.
- Do not call EnrollPro for status or faculty checks on every login.
- Do not cache a hash when EnrollPro says must-change.
- Do not set `passwordVerifiedAt` on a local success that was never verified.
- Do not backfill `passwordVerifiedAt` from `passwordCachedAt`.
- Do not log secrets, codes, tokens, or full identity payloads.

---

## 12. Evidence to return to MRF/SMART

1. `git diff --stat` and the migration name.
2. The changed login handler excerpt.
3. The schema diff.
4. Test output (unit + integration + E2E).
5. Before/after p50/p95 login latency, with the EnrollPro call count.
6. A redacted sample audit row showing `authSource=LOCAL` and one showing `authSource=ENROLLPRO`.
7. Confirmation that no SSO file was changed.
8. Any open questions:
   - Exact EnrollPro password-change URL.
   - Whether EnrollPro sync exposes must-change flags.
   - Approved stale-password policy.
   - Approval for local password-hash storage.

---

## 13. Bottom line

SORT does not need a new auth model. It needs the same order SMART uses:

```text
local password check -> EnrollPro fallback -> local gates -> session
```

That removes the EnrollPro round trip from normal logins and keeps the first-login and password-change checks correct. Implement the local-first path, enforce the must-change gate, run the tests, and measure the latency. SSO remains a separate task.
