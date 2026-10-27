# SMART Login, Session, and First-Time Verification Handoff for SORT (MRF)

**Audience:** the SORT / MRF engineering team and the SORT AI agent.
**Purpose:** explain how SMART implements login, session handling, and EnrollPro companion SSO, then define the safe pattern for adding SORT's **first-time login verification** to an SSO flow.
**Status:** SMART behavior below is taken from the current source on 2026-10-25. SORT behavior is unknown to us; §9 lists what SORT must answer.

> **Instructions for the SORT AI:** read this whole document before changing SORT's login or SSO code. Do not copy SMART's session model blindly — map each concept to SORT's stack. Answer §9 with file/line evidence from the SORT codebase. If a question cannot be answered from code, mark it `UNKNOWN` and ask the MRF team.

**Copy-paste prompt for the SORT AI:**

> Read this file end to end. Then answer every question in §9 using `file:line` evidence from the SORT codebase. Fill in §11. Do not change login or SSO code before that. Report the exact first-time SSO failure (HTTP status, error code/message, stack trace, URL) and state whether the test identity is a staff account (`SYSTEM_ADMIN`/`MRF`) or a student/learner account.

---

## 1. The one-page model

SMART separates four concerns. Most first-time-login breakage happens because two of them are merged.

| Layer | Question it answers | SMART implementation |
|---|---|---|
| Credential check | Are these credentials valid? | Local bcrypt first, then live EnrollPro `POST /auth/login` as fallback |
| Identity source | Who is this user in the school? | Local `User` row, optionally linked to an EnrollPro subject |
| First-time verification | Has this account completed onboarding? | **SMART has no first-time verification gate.** Its only first-login-specific logic is SSO account linking |
| Session | How do subsequent API calls prove identity? | 15-minute JWT access token + 7-day rotating refresh token |
| Authorization | What may this user do? | Local `role` (`TEACHER`, `ADMIN`, `REGISTRAR`) checked per route |

**Key point for SORT:** SMART's login is not a template for first-time verification. SMART assumes accounts are already valid when credentials succeed. SORT needs an explicit **verification state** between “identity proven” and “full session issued.” Do not hide that state inside the password handler — SSO will bypass it.

---

## 2. SMART password login API

### 2.1 Request

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "1234501",
  "password": "********",
  "portal": "TEACHER"
}
```

- Despite the field name, `email` accepts an **employee ID, username, or email**. The three login pages label it “Employee ID or Email.”
- `portal` is optional. When present it must be `ADMIN`, `TEACHER`, or `REGISTRAR`, and the authenticated user must have exactly that role.
- Validation: both fields required; identifier max 255 chars; password max 128 chars (`server/src/schemas/auth.ts:7-15`).

### 2.2 Decision order

This exact order matters. A verification gate must be inserted into the same pipeline, not bolted onto only one branch.

```
1. Rate-limit check (failed attempts only)
2. Local credential check
   a. If identifier has no "@": look up Teacher.employeeId, then User.username
   b. Otherwise / fallback: look up User.email or User.username
   c. bcrypt.compare(password, user.password)
3. If local failed: live EnrollPro credential check
   a. POST {ENROLLPRO_BASE}/auth/login { accountName, password }
   b. On success, create or update the local User (password hash, role, names)
   c. NEVER modify User.status from this path
4. Teacher-only faculty gate
   a. Locally authenticated teacher must exist in EnrollPro's faculty list
   b. If EnrollPro is unreachable, allow the local account (fallback)
5. Ensure Teacher profile exists; trigger background sync
6. Reject invalid credentials with one generic 401
7. Reject non-ACTIVE users (403)
8. Teacher-only school-year transition lock (403, code TRANSITION_LOCKED)
9. Portal gate: user.role must equal req.body.portal if supplied (403, code WRONG_PORTAL)
10. Issue access JWT + refresh token pair
11. Set cookies and return tokens + user in JSON
12. Write audit log (success or failure)
```

Source: `server/src/routes/auth.ts:41-351`.

### 2.3 Response

```json
{
  "message": "Login successful",
  "token": "<15-minute JWT>",
  "refreshToken": "<opaque 80-char hex token>",
  "user": {
    "id": "cuid",
    "email": "user@deped.gov.ph",
    "username": "1234501",
    "role": "TEACHER",
    "firstName": "Jose",
    "lastName": "Rizal"
  }
}
```

The refresh token is also set as an `httpOnly` cookie scoped to `/api/auth`; the access token is set as an `httpOnly` cookie scoped to `/` (`server/src/routes/auth.ts:299-321`, `server/src/lib/tokens.ts:67-86`).

### 2.4 Failure matrix

| Status | When | Body |
|---:|---|---|
| 400 | Missing identifier/password | `{ "message": "Email and password are required" }` |
| 401 | Invalid credentials | `{ "message": "Invalid username or password" }` — never reveals which field was wrong |
| 401 | Teacher authenticated locally but not in EnrollPro faculty | `{ "message": "Account is not enrolled in EnrollPro for the current school year" }` |
| 401 | EnrollPro-authenticated teacher not a current faculty member | `{ "message": "Authenticated on EnrollPro but not a current faculty member. Contact your school administrator." }` |
| 403 | Suspended/deactivated account | Plain status message + audit log |
| 403 | Teacher during school-year transition | `{ "code": "TRANSITION_LOCKED", "message": "..." }` |
| 403 | Wrong portal for role | `{ "code": "WRONG_PORTAL", "role": "...", "message": "..." }` |
| 429 | Too many failed attempts | `{ "message": "Too many login attempts. Please try again in 15 minutes." }` |
| 500 | Unexpected server error | `{ "message": "Internal server error" }` |

### 2.5 Important behaviors to preserve in any port

- **Local-first.** Existing local accounts still work when EnrollPro is down. EnrollPro is consulted only when local authentication fails.
- **Status is owned by the local system.** The live EnrollPro authentication path may update names, role, and password hash, but never `User.status`. Status changes come from the Sync/Prune engine or an admin.
- **Generic credential errors.** “Invalid username or password” is used for all credential failures. Do not introduce enumeration via different messages.
- **Status is checked on every request**, not only at login (`server/src/middleware/auth.ts:39-48`).
- **The portal gate is authorization, not authentication.** It runs after credentials succeed, before tokens are issued.
- **Audit every outcome** with IP, actor, action, severity, and result. Never log passwords, tokens, codes, or identity payloads (`server/src/routes/auth.ts:89-100`, `server/src/routes/auth.ts:324-332`).

---

## 3. SMART session model

### 3.1 Access token

- JWT signed with `JWT_SECRET`.
- Payload: `{ id, username, email?, role }`.
- Lifetime: **15 minutes** (`server/src/lib/tokens.ts:9`).
- Accepted from:
  1. `Authorization: Bearer <token>`
  2. `?token=<token>` (needed for EventSource/SSE, which cannot set headers)
  3. `accessToken` cookie
  (`server/src/middleware/auth.ts:21-26`).
- On every request, middleware re-reads the user's `status` from the database. Non-`ACTIVE` users are rejected immediately (`server/src/middleware/auth.ts:39-48`).
- Role is read from the JWT, not re-read from the database. A role change therefore requires a token refresh or re-login; refresh re-reads the role (`server/src/routes/auth.ts:408-424`).

### 3.2 Refresh token

- Opaque, 40 random bytes encoded as 80 hex characters (`server/src/lib/tokens.ts:49-62`).
- Stored in the database **only as SHA-256 hash**.
- Lifetime: **7 days**.
- Rotating, with a `familyId`:
  - Every refresh revokes the used token and issues a new one in the same family.
  - Reuse of an already-used token revokes the **entire family** and returns 401 (`server/src/routes/auth.ts:366-399`).
  - This is theft detection. Do not remove it.
- Accepted from `x-refresh-token` header, request body `refreshToken`, or `refreshToken` cookie (`server/src/routes/auth.ts:357-359`).

### 3.3 Browser storage in SMART

SMART supports three simultaneous portals, so storage is role-scoped:

```text
sessionStorage.token_admin          sessionStorage.user_admin
sessionStorage.token_teacher        sessionStorage.user_teacher
sessionStorage.token_registrar      sessionStorage.user_registrar
sessionStorage.refreshToken_admin   ...
```

The Axios client attaches the token for the **current portal** (`src/lib/api.ts:26-66`). On a 401/403 it refreshes once, queues concurrent requests, and redirects to that portal's login if refresh fails (`src/lib/api.ts:91-175`).

### 3.4 CSRF

- Double-submit cookie pattern.
- GET/HEAD/OPTIONS set the readable `x-csrf-token` cookie.
- POST/PUT/PATCH/DELETE must send `x-csrf-token` matching the signed cookie.
- Auth routes are exempt because no session exists before login (`server/src/middleware/csrf.ts:50-91`).
- SMART's Axios interceptor reads the cookie and sends the header; on a 403 containing “CSRF” it re-issues the cookie with `GET /api/health` and retries once (`src/lib/api.ts:80-123`).

### 3.5 Rate limits and audit

| Endpoint | Limit |
|---|---|
| `POST /api/auth/login` | 5 failed attempts per 15 min per IP + identifier (admin-configurable) |
| Global `/api` | 300 requests/min/IP; auth paths exempt from the global limiter |
| `POST /api/auth/sso/authorize` | 20/min/IP |
| `POST /api/auth/sso/exchange` | 60/min/IP |

Source: `server/src/routes/auth.ts:27-38`, `server/src/middleware/rateLimiter.ts`.

### 3.6 Logout

- `POST /api/auth/logout`: revokes the refresh token **from the cookie**, clears both cookies, writes audit log (`server/src/routes/auth.ts:476-526`).
- `POST /api/auth/logout-all`: deletes every refresh token for the user (`server/src/routes/auth.ts:529-555`).
- Frontend layouts clear the role-scoped `sessionStorage` keys after calling logout (`src/layouts/TeacherLayout.tsx:105-109` and the Admin/Registrar equivalents).

---

## 4. SMART's EnrollPro SSO (the pattern SORT is integrating with)

### 4.1 Hub model

EnrollPro is the identity hub. There is **no direct companion-to-companion SSO**. SORT reaches SMART only through `SORT → EnrollPro → SMART`. Each system creates and owns its own session.

### 4.2 Flow A — EnrollPro launches SORT (the important direction for first-time login)

```
EnrollPro authenticated browser
  -> POST /api/auth/companion-sso/<system>/launch        (EnrollPro, cookie-authed)
  -> 302 to <SORT callback>?code=<43-char>&state=<...>
  -> SORT server exchanges the code server-to-server:
       POST <ENROLLPRO_API>/auth/companion-sso/<system>/exchange
       Authorization: Bearer <SORT outbound secret>
       { "code": "<43-char>" }
  -> SORT validates the identity assertion
  -> SORT resolves/links a local account
  -> SORT creates its own session
  -> SORT redirects to its role dashboard
```

SMART implementation:

| Step | Endpoint | File |
|---|---|---|
| Browser callback | `GET /api/auth/enrollpro/callback` | `server/src/routes/sso.ts:68-132` |
| SPA session bootstrap | `POST /api/auth/enrollpro/session` | `server/src/routes/sso.ts:140-191` |
| Code exchange + response validation | server-to-server | `server/src/services/enrollproSsoService.ts:129-182` |
| Identity → local account | resolver | `server/src/services/enrollproSsoService.ts:191-260` |

SMART deliberately splits Flow A into two steps:

1. **Callback** exchanges the code, resolves the local user, and sets a short-lived access cookie. It does **not** create a refresh token yet.
2. **Session bootstrap** is called by the SPA with that cookie. It re-reads the user, checks `status === ACTIVE`, then issues the full access + refresh pair and returns the user object.

This second check is a TOCTOU guard: a user could be suspended between callback and bootstrap. SORT should keep an equivalent re-check.

### 4.3 Flow B — SORT launches EnrollPro (reverse)

```
SORT authenticated browser
  -> SORT authorize endpoint issues a 43-char one-time code (60s TTL, SHA-256 at rest)
  -> 302 to EnrollPro reverse callback with code + state
  -> EnrollPro backend calls SORT exchange exactly once:
       POST <SORT exchange>
       Authorization: Bearer <SORT reverse secret>
       { "code": "...", "clientId": "enrollpro", "redirectUri": "<exact callback>" }
  -> SORT atomically consumes the code and returns the identity assertion
  -> EnrollPro creates its own session
```

SMART implementation: `server/src/routes/sso.ts:197-255`, `server/src/services/enrollproReverseSsoService.ts`.

### 4.4 Identity reconciliation rules (critical for first-time login)

SMART resolves the EnrollPro identity to a local account in this order:

1. **Bound stable subject**: `User.enrollproSubject === identity.subject`.
2. **First login only**: exact `employeeId` match against `User.username` and `Teacher.employeeId`.
3. The match must resolve to **exactly one** local account.
4. Names must reconcile (case/spacing/punctuation-insensitive). Missing names on either side do not disprove the match; supplied names must agree.
5. Account must be `ACTIVE`.
6. If the account is already linked to a different subject, reject.
7. Bind `enrollproSubject` with a unique-constrained update; a concurrent first login is caught as `P2002` and rejected.

**SMART does not auto-create accounts from SSO.** A first-time SSO user with no local account is denied. By contrast, the password-login fallback *can* create a local user from live EnrollPro credentials, but only for the staff roles and only after the faculty check (`server/src/routes/auth.ts:148-192`).

### 4.5 Role mapping

| EnrollPro role | SMART role |
|---|---|
| `SYSTEM_ADMIN`, `SUPER_ADMIN`, `ADMIN` | `ADMIN` |
| `HEAD_REGISTRAR`, `SCHOOL_REGISTRAR`, `REGISTRAR`, `REGISTRATION_OFFICER` | `REGISTRAR` |
| `TEACHER`, `CLASS_ADVISER` | `TEACHER` |

The SSO exchange also requires an **active school year** from EnrollPro (`id` + `yearLabel`). SMART mirrors the numeric `externalId` for reverse assertions.

### 4.6 Stable error codes

Branch on codes, never on user-facing strings:

`COMPANION_SSO_CLIENT_INVALID`, `COMPANION_SSO_CODE_INVALID`, `COMPANION_SSO_ACCOUNT_UNAVAILABLE`, `COMPANION_SSO_ROLE_DENIED`, `COMPANION_SSO_COMPLETER_BLOCKED`, `COMPANION_SSO_IDENTITY_INCOMPLETE`, `COMPANION_SSO_SYSTEM_NOT_FOUND`, `COMPANION_SSO_NOT_CONFIGURED`, `COMPANION_SSO_UNREACHABLE`, `ACTIVE_SCHOOL_YEAR_REQUIRED`, `ACTIVE_SCHOOL_YEAR_CONFLICT`, `PASSWORD_CHANGE_REQUIRED`, and the reverse-flow equivalents (`server/src/lib/companionSso.ts:32-53`).

Some codes are reserved by the broader contract but not emitted by SMART's current services: `COMPANION_SSO_COMPLETER_BLOCKED` and `PASSWORD_CHANGE_REQUIRED`. Treat them as reserved codes if SORT's onboarding or password policy needs them.

### 4.7 The MRF-specific constraint you must not miss

The multi-system contract makes only the `SYSTEM_ADMIN` and `MRF` staff roles visible to MRF; the registrar and teacher roles are hidden:

| EnrollPro role | SMART | MRF |
|---|---|---|
| `SYSTEM_ADMIN` | Visible | Visible |
| `HEAD_REGISTRAR` | Visible | Hidden |
| `TEACHER` | Visible | Hidden |
| `CLASS_ADVISER` | Visible | Hidden |
| `MRF` | Hidden | Visible |
| `LEARNER` | Hidden | Hidden |

Source: `docs/COMPANION-SSO-INTEGRATION-GUIDE.md:20-27`.

Consequences:

- EnrollPro companion SSO is a **staff** identity flow. It does not assert learner/student identities.
- If SORT's users are students, EnrollPro companion SSO cannot authenticate them today. Do not fake a student as `SYSTEM_ADMIN`.
- If SORT uses one shared “Admin MRF” account, SSO can prove “this is the shared admin”, but it cannot tell you which human is using it. That breaks per-user verification, audit, and subject binding.

---

## 5. Why first-time verification breaks an SSO flow

| Symptom | Likely cause | Correct fix |
|---|---|---|
| SSO skips verification entirely | Verification lives inside the password-login handler | Move verification to a post-identity gate that both password and SSO call |
| First SSO login fails “no account” | SSO callback expects a pre-existing local account, but SORT only creates accounts at password signup | Define provisioning: pre-provision, just-in-time pending account, or deny |
| Verification page loops or expires | SSO code was consumed before verification; the page retries the code | Consume the code once; carry a separate short-lived **verification ticket** |
| Replay/concurrent first login creates duplicates | No unique external-subject constraint; read-then-write | Unique `externalSubject` + atomic update / `P2002` handling |
| Verification succeeds but dashboard still blocked | Session token was issued before verification and never re-issued | Issue a restricted ticket first; issue the full session only after verification |
| Student cannot use SSO | EnrollPro asserts staff roles only; learner role is hidden | Keep a separate student login path, or define a learner SSO contract |
| Two staff share one “Admin MRF” account | Shared account cannot map one EnrollPro subject to one human | Use per-user accounts, or explicitly accept shared identity (not recommended) |
| Works locally, fails in production | In-memory code guard works on one instance only | Use a DB-backed single-use code table with atomic claim |
| Works on first click, fails on refresh | Callback is not idempotent, or session bootstrap is missing | Split callback (exchange) from session bootstrap (issue tokens), as SMART does |
| Role denied | SORT expects a student/teacher role, but EnrollPro sent `SYSTEM_ADMIN` | Confirm the role matrix and local role mapping before testing |

---

## 6. Recommended SORT architecture

### 6.1 Core principle

```
Authentication  ->  Account resolution  ->  Verification gate  ->  Session issuance
(prove identity)    (find/link account)     (first-time only)       (full tokens)
```

Verification is an **authorization gate**, not part of the SSO code exchange. The SSO exchange answers “who is this?” The verification gate answers “may this account start working yet?”

### 6.2 Account state machine

```text
                    +-----------------------------+
   SSO identity --->| resolve by externalSubject  |
                    | or unique identifier        |
                    +-------------+---------------+
                                  |
              +-------------------+-------------------+
              |                                       |
        account exists                          account missing
              |                                       |
     status = SUSPENDED                     auto-provision allowed?
              |                                       |
           DENY                            +----------+----------+
                                           |                     |
                                          yes                    no
                                           |                     |
                              create PENDING_VERIFICATION      DENY
                                           |
                              verificationStatus = PENDING
                                           |
                              issue verification ticket
                                           |
                              user completes verification
                                           |
                              status = ACTIVE + bind subject
                                           |
                                   issue full session
```

Suggested states:

| State | Meaning | Can log in? |
|---|---|---|
| `INVITED` | Account pre-created by admin; no credentials yet | Only through verification/invite flow |
| `PENDING_VERIFICATION` | Identity known; first-time verification not complete | Only a restricted verification ticket |
| `ACTIVE` | Verified and enabled | Yes, full session |
| `SUSPENDED` | Disabled by admin/EnrollPro sync | No |

Suggested fields:

```text
User/Account
  id
  role
  status                 // INVITED | PENDING_VERIFICATION | ACTIVE | SUSPENDED
  externalSubject        // unique, nullable
  identityProvider       // ENROLLPRO | LOCAL
  verificationMethod     // EMAIL | OTP | ADMIN_APPROVAL | PASSWORD_SETUP | NONE
  verificationStatus     // PENDING | VERIFIED | FAILED | EXPIRED
  verifiedAt
  verifiedBy             // for admin approval
```

### 6.3 Callback flow with verification

```ts
// 1. Exchange the one-time code. The code is consumed exactly once.
const assertion = await exchangeCompanionCode(code);

// 2. Resolve the local account. Never trust browser-supplied identity.
let account = await resolveAccount(assertion.identity);

if (!account) {
  if (!provisioningPolicyAllows(assertion.identity)) {
    return redirectToError("ACCOUNT_NOT_PROVISIONED");
  }
  account = await createPendingAccount(assertion.identity);
}

if (account.status === "SUSPENDED") {
  return redirectToError("ACCOUNT_UNAVAILABLE");
}

// 3. First-time verification gate.
if (account.verificationStatus !== "VERIFIED") {
  // Do NOT issue a full session. Issue a short-lived, single-use ticket
  // bound to account.id + identity.subject + verification method.
  const ticket = await issueVerificationTicket(account.id);
  return redirect(`/verify?ticket=${ticket}`);
}

// 4. Already verified: bind the external subject if not bound yet.
if (!account.externalSubject) {
  await bindExternalSubject(account.id, assertion.identity.subject); // unique + conflict handling
}

// 5. Issue SORT's own session.
return issueSession(account);
```

Rules embedded in that flow:

- **Do not create the full session before verification.**
- **Do not put verification inside the code exchange.** The exchange must stay a pure identity operation.
- **Do not re-exchange the SSO code after a verification step.** The code is gone; the verification ticket is the continuation.
- **Do not bind `externalSubject` on an unverified auto-provisioned account** unless the identifier match is already strong (pre-provisioned employee ID/student ID + name). Otherwise bind after verification, inside a transaction with a unique constraint.
- **Re-check `status` and `verificationStatus`** at session bootstrap and at refresh, not only at callback. State can change during onboarding.
- **Make verification resumable.** A new EnrollPro launch must resolve the same pending account and return to the same verification step, not create a second account.

### 6.4 Verification ticket rules

- Opaque random token, stored hashed.
- TTL: 10-15 minutes.
- Single-use.
- Bound to: `accountId`, `identity.subject`, `verificationMethod`, `expiresAt`.
- Scope: only the verification endpoints (`GET /verify`, `POST /verify/email`, `POST /verify/otp`, etc.).
- Cannot call business APIs.
- On success: mark verified, bind subject if needed, revoke ticket, issue full session.
- On failure/expiry: allow resend/re-issue through the normal login or SSO launch; never reuse the old ticket.

### 6.5 Password login and SSO must share the gate

Both entry points should call the same function:

```ts
async function finishLogin(account, identitySource) {
  if (account.status === "SUSPENDED") throw new AuthError("ACCOUNT_UNAVAILABLE");
  if (account.verificationStatus !== "VERIFIED") {
    return { kind: "verification_required", ticket: await issueVerificationTicket(account.id) };
  }
  return { kind: "session", session: await issueSession(account) };
}
```

If verification is implemented only in the password handler, SSO will skip it. If it is implemented only in the SSO callback, password users will skip it.

### 6.6 Per-verification-method guidance

| Verification method | Where it belongs | SSO behavior | Notes |
|---|---|---|---|
| Email verification link | After identity resolution | If EnrollPro already verified the email, mark verified-on-first-SSO; otherwise send link | Do not require a local password to verify |
| Email/SMS OTP | After identity resolution | Issue restricted ticket; OTP screen; then session | Ticket must not be a full session |
| Admin approval | After account creation/link | Create `PENDING_VERIFICATION`; deny full session with a stable code; admin approves; user retries | Do not block the SSO exchange itself |
| Password setup / first-login password change | After identity resolution | SSO-only users may have no password; make password optional or separate the “set password” step | Do not force password change on a federated identity unless policy requires it |
| ID/document upload | After identity resolution | Pending state until reviewed; user can resume | Same pending-account pattern |
| Device binding / 2FA | After identity resolution, before session | Challenge after SSO, then issue session | Keep it separate from the SSO code |
| None | n/a | No gate | Still require account resolution and status checks |

### 6.7 Student and shared-account cases

**Student accounts.** EnrollPro's companion SSO contract asserts staff roles. `LEARNER` is hidden/denied. SORT therefore has three options:

1. Keep students on SORT's local login (recommended until a learner SSO contract exists).
2. Have students authenticate against EnrollPro's password endpoint (`POST /auth/login`) if EnrollPro returns a student identity and SORT can verify the role safely. Confirm this with EnrollPro; do not assume it.
3. Define a new learner SSO contract with EnrollPro. Do not repurpose `SYSTEM_ADMIN`.

**Shared “Admin MRF” account.** If all MRF staff share one account:

- SSO can prove the shared account, but not the human.
- `externalSubject` will bind to the first EnrollPro subject that uses it, blocking other staff or creating a conflict.
- Audit logs cannot attribute actions to a person.
- First-time verification becomes meaningless because it verifies the shared account, not the person.

Recommended: one SORT account per staff member, linked to that person's EnrollPro subject. If a shared kiosk account is unavoidable, mark it explicitly, skip per-user verification, and never use it for privileged actions.

### 6.8 Error codes for SORT

Keep stable machine codes; render plain text in the UI:

| Code | HTTP | When |
|---|---:|---|
| `ACCOUNT_NOT_PROVISIONED` | 403 | No local account and auto-provisioning is disabled |
| `ACCOUNT_PENDING_VERIFICATION` | 403 | Identity valid; verification incomplete |
| `VERIFICATION_TICKET_INVALID` | 401 | Ticket expired, reused, or wrong account |
| `VERIFICATION_FAILED` | 400/403 | Wrong OTP/code or rejected document |
| `IDENTITY_CONFLICT` | 409 | External subject already bound to another account |
| `ROLE_NOT_ALLOWED` | 403 | EnrollPro role not mapped for SORT |
| `ACCOUNT_UNAVAILABLE` | 403 | Suspended/deactivated |
| `SSO_CODE_INVALID` | 401 | Expired, replayed, malformed, or wrong-system code |
| `SSO_NOT_CONFIGURED` | 503 | Secret/callback missing |
| `SSO_UNREACHABLE` | 503 | EnrollPro unreachable |

Never branch on user-facing messages; branch on code + HTTP status.

---

## 7. What SMART already does that SORT can reuse

| Pattern | Why it matters | SMART reference |
|---|---|---|
| Local-first credential check | Survives EnrollPro outages; keeps local accounts working | `server/src/routes/auth.ts:54-81` |
| Generic credential errors | Prevents account enumeration | `server/src/routes/auth.ts:214-230` |
| Status check on every request | Suspension takes effect immediately, not at token expiry | `server/src/middleware/auth.ts:39-48` |
| Short access token + rotating refresh token | Limits stolen-token damage | `server/src/lib/tokens.ts:9-10`, `server/src/routes/auth.ts:353-445` |
| Refresh reuse detection | Detects stolen refresh tokens and revokes the family | `server/src/routes/auth.ts:377-387` |
| One-time code hashed at rest, 60s TTL, atomic consume | Prevents replay and race conditions | `server/src/services/enrollproReverseSsoService.ts:147-161` |
| No auto-create on SSO | Prevents a valid EnrollPro identity from claiming an arbitrary local account | `server/src/services/enrollproSsoService.ts:191-260` |
| Name + identifier reconciliation | Prevents wrong-person linking on first login | `server/src/services/enrollproSsoService.ts:66-84`, `:206-246` |
| Callback/session split | Re-checks status after exchange; avoids issuing tokens from a possibly stale callback state | `server/src/routes/sso.ts:68-191` |
| Stable error codes | Safe to branch on; safe to show plain messages | `server/src/lib/companionSso.ts:32-53`, `src/lib/ssoMessages.ts` |
| Never log secrets/codes | Keeps logs safe to share | `server/src/routes/sso.ts:13-15`, `:226-228` |
| Audit login outcomes | Supports investigation and compliance | `server/src/lib/audit.ts`, `server/src/routes/auth.ts` |

---

## 8. First-time SSO acceptance tests (run these on SORT)

| # | Scenario | Expected |
|---:|---|---|
| 1 | First-time EnrollPro launch, no local account, provisioning enabled | A `PENDING_VERIFICATION` account is created; user lands on verification, not the dashboard |
| 2 | First-time launch, no local account, provisioning disabled | Denied with `ACCOUNT_NOT_PROVISIONED`; no session, no account |
| 3 | First-time launch, pre-provisioned account, verification pending | Verification screen; no full session |
| 4 | Verification succeeds | Account becomes `ACTIVE`; subject binds once; full session issued; role dashboard loads |
| 5 | Verification abandoned, user relaunches from EnrollPro | Same pending account resumes; no duplicate account; no code replay |
| 6 | Same SSO code replayed | Rejected with `SSO_CODE_INVALID` |
| 7 | Two simultaneous first-time launches for the same person | Exactly one account/binding; the other gets a benign retry/conflict response |
| 8 | Already verified user launches again | Direct session; no verification screen |
| 9 | Suspended user launches | Denied with `ACCOUNT_UNAVAILABLE`; no session |
| 10 | EnrollPro role not mapped for SORT | Denied with `ROLE_NOT_ALLOWED`; no session |
| 11 | Student/learner identity sent through companion SSO | Denied; learner flow is not silently mapped to an admin role |
| 12 | Shared Admin MRF account used by two different EnrollPro subjects | Defined behavior: per-user accounts should prevent this; if shared, no per-user binding |
| 13 | EnrollPro unreachable | Existing password logins still work; SSO fails closed with `SSO_UNREACHABLE`; no fabricated session |
| 14 | Verification ticket expired/reused | Denied with `VERIFICATION_TICKET_INVALID`; no full session |
| 15 | Role/verification state changes during onboarding | Session bootstrap/refresh re-checks and denies if no longer eligible |
| 16 | Callback double-mount (React StrictMode) | Only one exchange; no duplicate session or account |
| 17 | Cold full-page load of the authorize/verification page | Waits for auth hydration; no premature redirect loop; `returnUrl` resumes |
| 18 | Logs reviewed | No password, SSO code, client secret, JWT, cookie, or full identity payload in logs |

---

## 9. Questions SORT must answer (feed this section to the SORT AI)

> **Answer format:** a table with columns `# | Question | Answer | Evidence (path:line) | Confidence`. If the answer is not in code, write `UNKNOWN — need MRF confirmation`. Do not guess. Then provide the code excerpts and schema requested in §9.7.

### 9.1 Account and role model

1. What entities represent login accounts in SORT? Are students, teachers, and admin/staff separate tables or one table with roles?
2. What is the “Admin MRF account”? Is it one shared account, or one account per staff member? Which table/row/role represents it?
3. Which unique identifiers exist for each account type: student ID/LRN, employee ID, username, email?
4. Which roles can log in through the public SORT login, and which roles use the admin portal?
5. Does SORT already have an `externalSubject`-style column for EnrollPro? Is it unique? Is it nullable?
6. How are accounts provisioned today: self-signup, admin creation, CSV import, EnrollPro sync, or first-login auto-create?

### 9.2 First-time verification semantics

7. What exactly triggers “first time”? First-ever login, first login after enrollment, first login on a new device, first login after password reset, or an unverified email/phone?
8. What is the verification method: email link, email OTP, SMS OTP, admin approval, ID/document upload, password setup/change, security questions, or something else?
9. Where is the verification state stored today? Give the table, column, enum values, and default.
10. Is verification state per account, per email/phone, per device, or per enrollment?
11. What happens today after a successful password login when verification is pending? Redirect, limited session, token claim, or hard error? Give the exact route/handler/status.
12. Is verification resumable? Is there a ticket/token? What is its TTL, storage, and scope?
13. What endpoints exist for verify, resend, and cancel? What are their request/response shapes?
14. Can an unverified account access any SORT API or page? If yes, which ones?
15. Does verification activate the account, or only unlock features? Can an account be `ACTIVE` but unverified?
16. What happens when verification fails or expires? Retry, lockout, admin escalation?

### 9.3 Current SSO setup

17. Which SSO direction does SORT implement today: EnrollPro launches SORT (Flow A), SORT launches EnrollPro (Flow B), or both?
18. List SORT's exact SSO endpoints and their auth: callback, session bootstrap, authorize, exchange.
19. What identity fields does EnrollPro send SORT? Provide a redacted sample payload.
20. How does SORT map EnrollPro roles to local roles? Provide the mapping table and code path.
21. On first SSO login with no local account, what does SORT do today: create, deny, or crash? Provide the code path.
22. Where exactly does the first-time verification break? Paste the error, status code, stack trace, and the route/page where it occurs.
23. Does the SSO callback create a session before verification? If yes, what token/session is issued?
24. Does SORT bind the EnrollPro subject on first login? Where, with what uniqueness and concurrency handling?
25. Does SORT re-check account status after the callback (at session bootstrap or refresh)?
26. Are students expected to log in through EnrollPro SSO? If yes, what EnrollPro role/identity represents a student, and which contract supports it?
27. Has SORT confirmed with EnrollPro that its test accounts carry a role visible to MRF (`SYSTEM_ADMIN` or `MRF`)? What identity did EnrollPro actually send?

### 9.4 Session and security

28. What is SORT's session mechanism: JWT in localStorage, httpOnly cookies, server sessions, or a mix?
29. What are the access-token and refresh-token lifetimes? Is refresh rotation implemented? Is reuse detected?
30. Where are tokens stored in the browser, and how are they attached to API calls?
31. How does SORT revoke sessions on logout, suspension, or password change?
32. Does SORT enforce CSRF on state-changing routes? What about the SSO callback?
33. What rate limits exist on login, verification, and SSO endpoints?
34. Are there multiple SORT instances behind a load balancer? If yes, is the SSO code guard DB-backed or in-memory?
35. What are SORT's callback URL, authorize URL, exchange URL, and the **names** of the configured secrets (never paste secret values)?
36. How does SORT handle EnrollPro outages? Does it fail closed?

### 9.5 Product decisions needed from MRF

37. For a first-time SSO user with no local account, should SORT auto-create a pending account, require pre-provisioning, or require admin approval?
38. Which roles may be auto-approved, and which must be admin-approved?
39. If a student logs in through the student flow, should SORT create a pending account automatically or require the registrar/admin to enroll them first?
40. If the shared Admin MRF account remains, who is accountable for actions taken through it, and should it bypass first-time verification?
41. What should the user see when verification is pending: a dedicated verification page, a “contact admin” page, or a return to EnrollPro with a plain message?
42. Should verification be required again after a long inactivity period, role change, or school-year rollover?

### 9.6 What to send back

Please return:

1. The filled answer table from §9.1-§9.5.
2. The relevant code excerpts (redacted): login handler, verification handler, SSO callback, account resolver, session issuer.
3. The account/session/verification schema (table + columns + enums).
4. A sequence diagram or numbered flow for **first-time SSO login** in SORT, showing exactly where verification runs.
5. The exact failure: HTTP status, error code/message, stack trace, and the URL/page where it happens.
6. Confirmation of whether SORT's test identity is a staff `SYSTEM_ADMIN` or a student/learner identity.
7. Any logs with secrets, codes, tokens, and personal data removed.

---

## 10. SMART source references

| Concern | Path |
|---|---|
| Login route, fallback, gates, token issuance | `server/src/routes/auth.ts:41-351` |
| Refresh rotation + reuse detection | `server/src/routes/auth.ts:353-445` |
| Logout / logout-all | `server/src/routes/auth.ts:475-555` |
| Login validation schema | `server/src/schemas/auth.ts:7-15` |
| JWT + refresh token helpers | `server/src/lib/tokens.ts` |
| Request authentication + role check | `server/src/middleware/auth.ts:16-68` |
| CSRF double-submit | `server/src/middleware/csrf.ts:50-91` |
| Login/SSO rate limits | `server/src/routes/auth.ts:27-38`, `server/src/middleware/rateLimiter.ts` |
| Flow A callback + session bootstrap | `server/src/routes/sso.ts:68-191` |
| Flow B authorize + exchange routes | `server/src/routes/sso.ts:197-255` |
| Flow A exchange + identity validation | `server/src/services/enrollproSsoService.ts:90-182` |
| Flow A account resolution / first-login link | `server/src/services/enrollproSsoService.ts:191-260` |
| Flow B code issue/consume + identity assertion | `server/src/services/enrollproReverseSsoService.ts` |
| SSO settings, secrets, error codes | `server/src/lib/companionSso.ts` |
| User / Teacher / RefreshToken schema | `server/prisma/schema.prisma:9-64` |
| Route mounts / aliases | `server/src/index.ts:79-85` |
| Frontend API client, refresh queue, CSRF | `src/lib/api.ts:26-175` |
| SSO session bootstrap page | `src/pages/auth/SsoSessionPage.tsx:34-64` |
| SSO plain-language messages | `src/lib/ssoMessages.ts` |
| Multi-system contract + MRF role matrix | `docs/COMPANION-SSO-INTEGRATION-GUIDE.md` |
| Existing SMART SSO contract | `docs/SMART-ENROLLPRO-SSO.md` |

---

## 11. Fill-in mapping template for SORT

Complete this before implementing. It prevents “SMART does X” from being copied into a place where SORT does not have X.

| SMART concept | SORT equivalent | Present? | Notes |
|---|---|---|---|
| `User.username` / employee ID | | | |
| `User.email` | | | |
| `User.role` (`TEACHER`/`ADMIN`/`REGISTRAR`) | | | |
| `User.status` (`ACTIVE`/`SUSPENDED`) | | | |
| `User.enrollproSubject` (unique) | | | |
| `Teacher.employeeId` | | | |
| `RefreshToken` family/rotation | | | |
| Access JWT 15 min | | | |
| Refresh token 7 days | | | |
| `CompanionSsoCode` hash/TTL/consume | | | |
| First-time verification state | | | |
| Verification ticket | | | |
| SSO callback endpoint | | | |
| SSO session bootstrap | | | |
| SSO authorize endpoint | | | |
| SSO exchange endpoint | | | |
| Role mapping table | | | |
| Audit log | | | |

**Bottom line for SORT:** keep the SSO exchange pure, resolve the account deterministically, add an explicit pending-verification state, issue only a restricted verification ticket before verification, and issue the full session only after verification. Answer §9 first so the fix is based on SORT's real account model, not on SMART's assumptions.
