# SORT Local-First Login — Matching SMART's Fast Path

**Audience:** SORT / MRF engineering and the SORT AI agent
**Purpose:** answer “can SORT log in like SMART does, without calling EnrollPro first on every login?”
**Short answer:** yes. SORT already has the pieces — `User.passwordHash` and an offline bcrypt check. The change is to use the cached hash as the **primary** credential check, with EnrollPro as the fallback, instead of the reverse.

---

## 1. Why SMART's login is fast

SMART checks the local database first. On a normal login it never calls EnrollPro:

```text
POST /api/auth/login
1. Find local User by employee ID / username / email
2. bcrypt.compare(password, user.password)
3. If it matches:
     -> check local status, role, portal, locks
     -> issue SMART access + refresh tokens
     -> return
4. Only if the local check fails:
     -> call EnrollPro POST /auth/login
     -> on success, cache the password hash and create/update the local User
     -> then issue SMART tokens
```

Source: `server/src/routes/auth.ts:54-81` for the local check; `:110-197` for the EnrollPro fallback; `:232-321` for the status/portal gates and token issuance.

Consequences:

- Normal login latency is local bcrypt (roughly 50–150 ms), not an EnrollPro network round trip.
- Existing local accounts still work when EnrollPro is down.
- EnrollPro is still the source of truth for first-time users and password changes, because a local miss falls back to EnrollPro.

---

## 2. What SORT does today

From the SORT audit:

```text
POST /api/auth/login
1. Find local User by enrollproLrn / employeeId / email
2. If no user -> 401 INVALID_CREDENTIALS (no fallback, no auto-create)
3. Require syncSource = ENROLLPRO
4. Call EnrollPro /auth/login (staff) or /learner/auth (student)
5. Only if EnrollPro is unreachable -> try the cached bcrypt hash
6. Issue tokens
```

That is **EnrollPro-first, local-fallback**. The cached hash exists (`User.passwordHash`, `offline-auth.service.ts`), but it is only used during an outage. That is why every normal login pays the EnrollPro network cost.

---

## 3. The minimal change: flip the order

SORT should keep its own endpoint, payload, roles, and token model. Only the credential-check order changes.

```ts
const user = await findLocalUser(identifier);

if (!user) {
  return res.status(401).json({ code: "INVALID_CREDENTIALS" });
}

// 1. Local-first: fast path.
const localMatch = user.passwordHash
  ? await bcrypt.compare(password, user.passwordHash)
  : false;

if (localMatch) {
  // Do NOT call EnrollPro on the happy path.
  // Continue with local status, portal, verification, and session issuance.
  return finishLogin(user, "LOCAL");
}

// 2. Fallback: EnrollPro validates, then SORT caches the hash.
const ep = await validateWithEnrollPro(user, password); // /auth/login or /learner/auth

if (ep.ok) {
  await cachePasswordHash(user.id, password);
  return finishLogin(user, "ENROLLPRO");
}

// 3. EnrollPro unreachable: decide policy.
if (ep.unreachable) {
  return res.status(503).json({ code: "AUTH_SERVICE_UNREACHABLE" });
}

return res.status(401).json({ code: "INVALID_CREDENTIALS" });
```

This mirrors SMART's order:

| Step | SMART | SORT after the change |
|---|---|---|
| Local lookup | Yes | Yes (already exists) |
| Local bcrypt first | Yes | **Add this** |
| EnrollPro call | Only on local miss | Only on local miss |
| Cache hash after EnrollPro success | Yes | Yes (already caches) |
| Status/role/portal gate | Local DB + role | Local DB + role |
| Session issuance | SMART JWT + refresh | SORT JWT + refresh (unchanged) |

---

## 4. First login vs later logins

- **First login for a user with no cached hash:** still calls EnrollPro. That is unavoidable if the password only exists in EnrollPro. After success, SORT caches the hash.
- **Every later login:** local bcrypt only. Fast, and works during EnrollPro downtime.
- **If the user changes their password in EnrollPro:** the next SORT login with the old password fails locally, falls back to EnrollPro, and EnrollPro rejects it. The new password succeeds through the fallback and replaces the cached hash.
- **If the user has a cached hash but EnrollPro is down:** local login succeeds. This is the availability benefit, but see §6 for the stale-password tradeoff.

If MRF wants the **first** login to be fast too, the options are:

1. Pre-provision accounts and hashes during sync — normally impossible because EnrollPro should not export password hashes.
2. Use companion SSO for staff — no password round trip, but the first login still contacts EnrollPro for the code exchange.
3. Accept that only the first login (or first login after a password change) pays the EnrollPro cost.

It is not possible to make a first-ever password login local-only unless SORT already has a usable local credential.

---

## 5. Do not call EnrollPro for status on every login

Local-first only works if SORT trusts its own local state for the fast path. Keep it fast:

- Check `accountStatus`, `archivedAt`, `portalAccountActive`, and student enrollment locally.
- Keep those fields fresh through the existing EnrollPro sync.
- Do not make a live EnrollPro call just to confirm status or faculty membership on every login.
- If SORT needs a faculty gate like SMART's, use synced local data or a short-lived cache, not a live call per login.

SMART's teacher faculty gate uses a cached EnrollPro faculty list; it is not a live call on every login (`server/src/routes/auth.ts:83-108`).

---

## 6. Critical rules for the local-first path

### 6.1 Enforce `mustChangePassword` locally

This is the biggest trap. If SORT only learns `mustChangePassword` from an EnrollPro response, local-first would skip EnrollPro and bypass the flag.

Store the flag locally when EnrollPro returns it:

```text
users.passwordChangeRequired = true
users.passwordResetRequired   = true   // learners
```

Then, before issuing a session:

```ts
if (user.passwordChangeRequired || user.passwordResetRequired) {
  // Force the EnrollPro path so the flag can be re-checked after the change.
  return res.status(403).json({
    code: "PASSWORD_CHANGE_REQUIRED",
    passwordChangeUrl: "<EnrollPro password-change URL>",
  });
}
```

Do not issue a SORT access or refresh token while the flag is true. Clear the local flag only after EnrollPro confirms the password was changed (usually on the next login).

### 6.2 Enforce separate first-time verification locally

If MRF has a verification step separate from the default-password flag, store its state locally (`verificationStatus`, `verificationMethod`, etc.). Check it after the credential check and before session issuance. Do not fetch it from EnrollPro on every login.

### 6.3 Keep the local role authoritative

Do not let a local-first success or an EnrollPro fallback silently promote a user. The local role should be checked against the portal, as SORT already does. If EnrollPro returns a different role, either deny or route through admin approval.

### 6.4 Audit the credential source

Log `authSource: "LOCAL"` vs `"ENROLLPRO"` with the user ID, IP, result, and stable code. This makes latency and fallback behavior observable.

### 6.5 Keep rate limits and account enumeration protections

- Keep the failed-login rate limit.
- Use one generic `INVALID_CREDENTIALS` for wrong password and unknown account.
- Do not reveal whether the local hash or EnrollPro rejected the password.

---

## 7. Tradeoffs and how to mitigate them

### 7.1 Stale local password

If the password changes in EnrollPro, SORT's cached hash still accepts the old password until a local failure triggers the EnrollPro fallback. That is the cost of local-first.

Options:

- **Accept it** (SMART's current behavior). The next password change or failed login corrects the hash.
- **Add a revalidation TTL:** if `passwordVerifiedAt` is older than N days, force an EnrollPro check even when the local hash matches. This adds latency occasionally but keeps EnrollPro authoritative.
- **Clear the cache on password-change events** from EnrollPro, if such a webhook or sync signal exists.
- **Clear the cache on suspension/role changes** from sync.

Pick one explicitly. Do not leave it implicit.

### 7.2 Local password storage policy conflict

The audit notes that one SORT document says “no local password storage,” while the code already stores a bcrypt hash for offline login. Local-first makes that hash a first-class credential, not just an outage fallback.

Resolve the policy:

- If local hashes are allowed: document that they are bcrypt, cleared on must-change, and refreshed after EnrollPro verification.
- If they are not allowed: remove the offline cache and accept that every login requires EnrollPro. Then local-first is not possible for passwords.

You cannot have both “no local password storage” and “fast local-first login.”

### 7.3 Status and suspension

Local-first can authenticate a user that EnrollPro has suspended if the local status is stale. Keep the existing sync prompt, and consider a short status-check TTL. At minimum, check local status on every request and refresh it on login.

### 7.4 First-time verification and the 404 SSO issue

Local-first does not fix the missing SSO route. It fixes **password-login latency**. The SSO 404 is a separate implementation gap. Do not conflate them.

---

## 8. Recommended rollout

1. **Add local-first password check** using the existing `passwordHash` cache.
2. **Persist and enforce `mustChangePassword` / `requiresPasswordReset` locally**, with a 403 + EnrollPro password-change URL. This closes the existing bypass.
3. **Keep the EnrollPro fallback** for local misses, first logins, and password changes.
4. **Add `authSource` audit logging**.
5. **Decide the stale-password policy** (accept, TTL, or event-based clearing).
6. **Measure login latency** before/after: local success vs fallback.
7. **Only then add SSO** (Flow A) if MRF still needs it.

---

## 9. Acceptance tests

| # | Scenario | Expected |
|---:|---|---|
| 1 | Existing user, correct password, EnrollPro up | Local success; no EnrollPro call; fast login |
| 2 | Existing user, correct password, EnrollPro down | Local success; login still works |
| 3 | Existing user, wrong password, EnrollPro up | Local miss → EnrollPro rejects → generic 401 |
| 4 | Existing user, password changed in EnrollPro | Old password fails local → EnrollPro rejects; new password succeeds via fallback and refreshes hash |
| 5 | First login, no cached hash, EnrollPro up | EnrollPro success → cache hash → session |
| 6 | First login, no cached hash, EnrollPro down | 503 `AUTH_SERVICE_UNREACHABLE`; no session |
| 7 | `mustChangePassword=true` | 403 `PASSWORD_CHANGE_REQUIRED`; no session; password-change URL present |
| 8 | `requiresPasswordReset=true` (learner) | Same gate |
| 9 | Separate verification pending | Verification ticket only; no full session |
| 10 | Suspended/archived/portal-inactive account | Denied even if local password matches |
| 11 | Wrong portal | `WRONG_PORTAL`; no session |
| 12 | Logs | `authSource` recorded; no password/hash/token logged |

---

## 10. Bottom line

**Yes, SORT can log in like SMART.** It already has the cached bcrypt hash and the offline verification path. Change the order to:

```text
local password first  ->  EnrollPro fallback  ->  local status/verification gate  ->  session
```

Keep the first-login fallback, enforce `mustChangePassword` locally, and decide the stale-password policy. That removes the EnrollPro round trip from normal logins without changing SORT's token model or its SSO work.
