# SMART ATLAS SSO (Admin Only)

Last reviewed: 2026-11-10

Status: SMART side implemented on 2026-11-10. ATLAS side pending.

## Purpose

This contract lets a SMART administrator open the ATLAS admin workspace without a second password. SMART is the identity issuer. ATLAS is the relying party. Only SMART `ADMIN` accounts are eligible, and ATLAS accepts only its own administrative role.

This is a direct SMART-to-ATLAS launch. It follows the same one-time authorization-code pattern as `SMART-ENROLLPRO-SSO.md`, with the issuer and destination reversed. It does not use EnrollPro as an intermediary.

This is not cross-domain cookie sharing. ATLAS must never receive a SMART password, JWT, refresh token, session cookie, or full user row.

## Scope

In scope:

- SMART admin portal to ATLAS admin workspace, one direction only.
- SMART `ADMIN` to ATLAS `SYSTEM_ADMIN`.
- SMART-issued, 60-second, single-use authorization codes.
- ATLAS-owned account link and ATLAS-owned session.

Out of scope:

- ATLAS to SMART SSO.
- SMART `REGISTRAR` or `TEACHER` access to ATLAS.
- EnrollPro involvement in this exchange.
- Learner or student SSO.
- Shared sessions, shared cookies, coordinated logout.
- Account auto-creation from SSO.
- Data transfer beyond the minimized identity assertion.

This contract supersedes the "no direct companion-to-companion SSO" limitation for this single direction only. It does not authorize SMART-to-AIMS, ATLAS-to-SMART, or any other companion pair.

## Roles

| SMART role | ATLAS role | Allowed |
| --- | --- | --- |
| `ADMIN` | `SYSTEM_ADMIN` | Yes |
| `REGISTRAR` | none | No |
| `TEACHER` | none | No |
| any other | none | No |

ATLAS exposes one staff workspace (admin). The assertion must contain exactly one role, `SYSTEM_ADMIN`. ATLAS must reject any assertion that contains another role or no role.

`SYSTEM_ADMIN` in this contract means the ATLAS admin workspace only. It does not grant EnrollPro, SMART, or any other system role.

## Configuration

### SMART server

```text
ATLAS_SSO_START_URL=https://<atlas-host>/auth/smart/start
ATLAS_SSO_CALLBACK_URL=https://<atlas-host>/auth/smart/callback
ATLAS_SSO_CLIENT_SECRET=<random secret, at least 32 characters>
```

- `ATLAS_SSO_START_URL` is the same-tab entry point for the SMART admin sidebar.
- `ATLAS_SSO_CALLBACK_URL` is the exact ATLAS callback. SMART binds every code to this string and rejects any other `redirect_uri`.
- `ATLAS_SSO_CLIENT_SECRET` is the secret ATLAS presents as a Bearer token at the exchange. It must be distinct from `ATLAS_SYSTEM_TOKEN`, `ATLAS_API_KEY`, `SMART_SSO_REVERSE_CLIENT_SECRET`, `JWT_SECRET`, and every sync or SSE credential.

### ATLAS server

```text
SMART_SSO_AUTHORIZE_URL=https://<smart-host>/auth/atlas/authorize
SMART_SSO_EXCHANGE_URL=https://<smart-host>/api/auth/atlas/exchange
SMART_SSO_CALLBACK_URL=https://<atlas-host>/auth/smart/callback
SMART_SSO_CLIENT_ID=smart
SMART_SSO_CLIENT_SECRET=<same value as ATLAS_SSO_CLIENT_SECRET>
```

`SMART_SSO_AUTHORIZE_URL` and `SMART_SSO_EXCHANGE_URL` must share the same origin. `SMART_SSO_CALLBACK_URL` must be byte-for-byte identical to SMART's `ATLAS_SSO_CALLBACK_URL`.

HTTPS is required outside local development. Local development may use `http://localhost` or `http://127.0.0.1`.

## Flow

```text
SMART admin clicks ATLAS
  -> GET <ATLAS_SSO_START_URL>
  -> ATLAS sets a signed state cookie and redirects the browser to
     GET <SMART_SSO_AUTHORIZE_URL>?response_type=code&client_id=smart
         &redirect_uri=<ATLAS_SSO_CALLBACK_URL>&state=<state>
  -> SMART SPA confirms the ADMIN session and calls
     POST /api/auth/atlas/authorize  (SMART JWT)
  -> SMART issues a 60-second one-time code and returns
     <ATLAS_SSO_CALLBACK_URL>?code=<code>&state=<state>
  -> Browser hits GET /auth/smart/callback
  -> ATLAS validates state and cookie, then calls
     POST /api/auth/atlas/exchange  (Bearer shared secret)
  -> SMART atomically consumes the code and returns the identity assertion
  -> ATLAS validates the assertion, links the admin account, creates its own session
  -> Browser lands on the ATLAS admin dashboard
```

### 1. ATLAS start

`GET /auth/smart/start` is the SMART sidebar entry point. It does not require an ATLAS session.

ATLAS must:

1. Generate a cryptographically random `state` (1-2048 characters).
2. Sign it and store it in an HTTP-only, Secure, SameSite=Lax cookie with a five-minute lifetime. Do not put identity data in `state`.
3. Redirect the browser to the configured `SMART_SSO_AUTHORIZE_URL` with `response_type=code`, `client_id=smart`, the exact registered callback as `redirect_uri`, and the signed `state`.
4. Rate-limit the start endpoint.

### 2. SMART authorize route

`GET /auth/atlas/authorize` is a SMART SPA route. It only reads the query parameters; it never exchanges a code in the browser.

The page must:

1. Read `response_type`, `client_id`, `redirect_uri`, and `state`.
2. Use only the SMART `ADMIN` portal session. If no valid `ADMIN` session exists, send the browser to the SMART login page with the full authorize URL as `returnUrl` and resume it after sign-in.
3. Call `POST /api/auth/atlas/authorize` with the SMART access token.
4. Navigate the browser to the returned `redirectUrl`.
5. Show a plain error if the request is rejected. Do not render raw codes or URLs.

### 3. SMART authorize backend

`POST /api/auth/atlas/authorize`

Authentication: SMART access token (Bearer or SMART session cookie).

Request:

```json
{
  "responseType": "code",
  "clientId": "smart",
  "redirectUri": "https://<atlas-host>/auth/smart/callback",
  "state": "<unchanged-state>"
}
```

Response:

```json
{
  "redirectUrl": "https://<atlas-host>/auth/smart/callback?code=<43-character-code>&state=<unchanged-state>"
}
```

SMART must reject the request unless all of the following are true:

- The local session is valid and belongs to an `ADMIN`.
- The SMART account is `ACTIVE`.
- `responseType === "code"`.
- `clientId === "smart"`.
- `redirectUri` exactly equals `ATLAS_SSO_CALLBACK_URL`.
- `state` is a string of 1-2048 characters.
- The endpoint is rate-limited per IP and per user.

Code requirements:

- 32 random bytes, encoded as 43 base64url characters.
- Stored only as a SHA-256 hash.
- Audience `atlas`.
- Bound to the user, the exact `redirectUri`, and a 60-second expiry.
- Single-use, claimed atomically on first exchange.
- The response echoes `state` unchanged. SMART never interprets or logs it.

### 4. ATLAS callback

`GET /auth/smart/callback?code=<code>&state=<state>`

ATLAS must:

1. Validate the `code` shape before doing anything else: `^[A-Za-z0-9_-]{43}$`.
2. Validate the `state` signature, its five-minute expiry, and its match against the HTTP-only state cookie. Do this before calling the exchange.
3. Clear the state cookie after validation.
4. Guard against duplicate processing. A reload, double-mount, or back navigation must not exchange the same code twice.
5. Treat an ambiguous exchange result as consumed. Never retry the same code.
6. Exchange the code server-to-server. The browser must never call the exchange endpoint.
7. Create the ATLAS session only after every check in the validation section succeeds.
8. Redirect to the ATLAS admin dashboard and remove the code from browser history.

### 5. SMART exchange backend

`POST /api/auth/atlas/exchange`

Authentication: `Authorization: Bearer <ATLAS_SSO_CLIENT_SECRET>`.

Request:

```json
{
  "code": "<43-character-code>",
  "clientId": "smart",
  "redirectUri": "https://<atlas-host>/auth/smart/callback"
}
```

Response: the identity assertion in the next section.

SMART must:

1. Compare the Bearer secret with a constant-time comparison. Reject with `COMPANION_SSO_CLIENT_INVALID`.
2. Validate the code shape, audience, `redirectUri`, expiry, and unconsumed state.
3. Claim the code atomically. Unknown, expired, replayed, or mismatched codes must all return the same `COMPANION_SSO_CODE_INVALID`.
4. Re-read the SMART user and require `ADMIN` and `ACTIVE` at exchange time. A role or status change after authorize must deny the exchange.
5. Resolve the active school year. Fail closed if it cannot be resolved.
6. Return the minimized assertion.

## Identity Assertion

```json
{
  "success": true,
  "issuer": "SMART",
  "identity": {
    "subject": "SMART_USER:<id>",
    "employeeId": "<employee id or null>",
    "lrn": null,
    "accountName": "<username>",
    "email": "<email or null>",
    "firstName": "<first name>",
    "middleName": null,
    "lastName": "<last name>",
    "roles": ["SYSTEM_ADMIN"]
  },
  "activeSchoolYear": {
    "id": 3,
    "yearLabel": "2026-2027"
  },
  "authenticatedAt": "<ISO 8601 timestamp>"
}
```

Rules:

- `issuer` must be exactly `SMART`.
- `identity.subject` is the stable SMART identifier. It is never recycled. ATLAS must bind it once and look up by it on every later login.
- `identity.employeeId` may be null. SMART admin accounts may not have a teacher profile. ATLAS must not require it and must not fall back to `accountName` or `email` as the account key.
- `identity.roles` must be exactly `["SYSTEM_ADMIN"]`.
- `activeSchoolYear.id` is EnrollPro's numeric school-year ID as mirrored by SMART. It is not a SMART primary key.
- `activeSchoolYear.yearLabel` must match ATLAS's active year label.
- The assertion never includes a password, password hash, JWT, refresh token, cookie, or full database row.

## Required Validations

### SMART

- Authenticated `ADMIN` only. No code for `REGISTRAR` or `TEACHER`.
- Account `ACTIVE` at authorize and again at exchange.
- Exact callback binding.
- Exact client binding (`smart`).
- 60-second, single-use, hashed, audience-bound codes.
- Constant-time secret comparison.
- Active school year required.
- One public error for all invalid-code cases.
- Rate limits on authorize and exchange.

### ATLAS

- Start, callback, and exchange are all server-side except the two browser redirects.
- State signature, expiry, and cookie match are checked before exchange.
- Response schema is checked before any session is created.
- `success === true`, `issuer === "SMART"`, and the only role is `SYSTEM_ADMIN`.
- Exactly one linked ATLAS admin account. Inactive, duplicate, or conflicting links deny the session.
- No auto-creation of ATLAS accounts from SSO.
- No silent relinking when a subject is already bound to another account.
- No session before every check succeeds.
- The code and assertion never become the ATLAS session token.

## Account Linking

ATLAS must store the SMART subject on its admin account:

```text
smartSubject = "SMART_USER:<id>"   (unique, nullable until linked)
```

Binding rules:

1. The first binding is explicit. An ATLAS administrator pre-provisions the link, or a one-time approved match binds the subject. SSO must not create the account.
2. After binding, look up the account by `smartSubject` only.
3. A subject that is already bound to another account is a conflict. Deny it; do not relink.
4. An inactive or missing account denies the session.
5. A linked account that is not an ATLAS administrator denies the session.
6. Never bind by name, email, or employee ID alone.

## Error Contract

Use the shared reverse-flow codes from `INTEGRATED-SYSTEMS-SIDEBAR-SSO`. Branch on the HTTP status and stable code; never parse messages.

### SMART authorize and exchange

| HTTP | Code | Meaning | UI behavior |
| ---: | --- | --- | --- |
| 401 | `COMPANION_SSO_CLIENT_INVALID` | Wrong Bearer secret | Configuration error; do not retry |
| 401 | `COMPANION_SSO_CODE_INVALID` | Code is unknown, expired, replayed, or mismatched | "This sign-in link expired or was already used. Start again." |
| 403 | `COMPANION_REVERSE_SSO_ROLE_DENIED` | SMART user is not `ADMIN` | "ATLAS is available to administrators only." |
| 403 | `COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE` | SMART account is inactive or missing | Deny; contact the SMART administrator |
| 400 | `COMPANION_REVERSE_SSO_CALLBACK_INVALID` | Bad response type, client, redirect URI, or state | Do not retry the same request |
| 409 | `ACTIVE_SCHOOL_YEAR_REQUIRED` | No active school year to assert | No session; fix the school-year state |
| 503 | `COMPANION_REVERSE_SSO_NOT_CONFIGURED` | Callback or secret is missing | Disable the item; show configuration guidance |
| 503 | `COMPANION_SSO_UNREACHABLE` | SMART is unreachable or an unexpected failure occurred | Fail closed; allow a manual retry later |
| 429 | `COMPANION_SSO_RATE_LIMITED` | Rate limit hit | Ask the user to wait and start again |

### ATLAS local handling

| HTTP | Code | Meaning |
| ---: | --- | --- |
| 400 | `COMPANION_REVERSE_SSO_STATE_INVALID` | State is expired, altered, or does not match the cookie |
| 400 | `COMPANION_REVERSE_SSO_CALLBACK_INVALID` | Callback code is malformed |
| 502 | `COMPANION_REVERSE_SSO_UNAVAILABLE` | SMART could not complete the exchange |
| 502 | `COMPANION_REVERSE_SSO_RESPONSE_INVALID` | Response is malformed, has the wrong issuer, or has a non-admin role |
| 409 | `ACTIVE_SCHOOL_YEAR_CONFLICT` | SMART's active year does not match ATLAS's active year |
| 403 | `COMPANION_REVERSE_SSO_LINK_REQUIRED` | No linked ATLAS admin account exists |
| 403 | `COMPANION_REVERSE_SSO_IDENTITY_CONFLICT` | The subject is linked to another account |
| 403 | `COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE` | The linked ATLAS account is inactive |
| 403 | `COMPANION_REVERSE_SSO_ROLE_DENIED` | The linked ATLAS account is not an administrator |

## Sidebar Behavior

- The Integrated Systems group keeps the order AIMS, SMART, ATLAS, MRF.
- SMART admin portal: the ATLAS item is enabled only for `ADMIN`. It is a button with an accessible name "Open ATLAS". A click navigates same-tab to `ATLAS_SSO_START_URL`.
- SMART teacher and registrar portals: the ATLAS item is disabled with the visible reason "Admin only" and an equivalent screen-reader label. It must not call the start or authorize endpoint.
- If `ATLAS_SSO_START_URL`, `ATLAS_SSO_CALLBACK_URL`, or `ATLAS_SSO_CLIENT_SECRET` is missing, the item is disabled with a configuration reason.
- Expose the start URL through the same public settings response that exposes `enrollproPublicUrl`. Do not hardcode it in the SPA.
- Show a spinner only on the selected item. Prevent repeated clicks while launching.
- Never navigate directly to the ATLAS dashboard. A direct URL creates no ATLAS session.
- Keyboard and screen-reader behavior: every enabled item is reachable and activatable; disabled reasons are announced.

## School-Year Behavior

- SMART asserts its current active school year as `{ id, yearLabel }`, using the EnrollPro numeric ID it mirrors.
- ATLAS compares the assertion with its own mirrored active year before creating a session.
- If SMART has no active year, the exchange fails closed with `ACTIVE_SCHOOL_YEAR_REQUIRED`.
- If the IDs or labels differ, ATLAS denies the session with `ACTIVE_SCHOOL_YEAR_CONFLICT`.
- SSO never changes the active year and never writes grades, schedules, sections, faculty, or enrollment data.
- ATLAS must show its sync or drift state when the years conflict. It must not display an old year as current.

## Audit and Privacy

SMART records:

- authorize issued (SMART user ID, subject, result)
- exchange success (SMART user ID, subject, result)
- exchange denied (stable non-sensitive reason)
- request IP and user agent where applicable

ATLAS records:

- start, callback, and exchange results
- linked ATLAS account ID
- active school-year ID on success
- stable non-sensitive denial reason

No system may log:

- the plaintext authorization code
- the full callback URL containing the code
- the SSO client secret
- a SMART password, JWT, refresh token, or session cookie
- the full identity assertion payload
- the ATLAS session token
- the state signature or cookie value

## Sign-Out

Sign-out remains local.

- Signing out of SMART ends only the SMART session. The ATLAS session remains until it expires or the user signs out of ATLAS.
- Signing out of ATLAS ends only the ATLAS session.
- Coordinated logout is not part of this contract.

## Acceptance Tests

| # | Test | Expected result |
| ---: | --- | --- |
| 1 | SMART `ADMIN` clicks ATLAS | Lands on the ATLAS admin dashboard without a second password |
| 2 | SMART `REGISTRAR` or `TEACHER` calls the authorize endpoint | 403 `COMPANION_REVERSE_SSO_ROLE_DENIED`; no code issued |
| 3 | Teacher or registrar portal renders the sidebar | ATLAS is disabled with "Admin only"; no request is made |
| 4 | Code shape and lifetime | 43 base64url characters; expires after 60 seconds |
| 5 | Code reuse | Second exchange returns `COMPANION_SSO_CODE_INVALID` |
| 6 | Two concurrent exchanges | Exactly one succeeds |
| 7 | Wrong Bearer secret | 401 `COMPANION_SSO_CLIENT_INVALID` |
| 8 | Wrong client ID or redirect URI | 400 `COMPANION_REVERSE_SSO_CALLBACK_INVALID`; no code issued |
| 9 | Admin deactivated after authorize | Exchange returns `COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE` |
| 10 | Admin role removed after authorize | Exchange returns `COMPANION_REVERSE_SSO_ROLE_DENIED` |
| 11 | ATLAS callback state tampered or expired | 400 `COMPANION_REVERSE_SSO_STATE_INVALID`; no exchange |
| 12 | No linked ATLAS admin account | 403 `COMPANION_REVERSE_SSO_LINK_REQUIRED`; no session |
| 13 | Subject linked to another account | 403 `COMPANION_REVERSE_SSO_IDENTITY_CONFLICT`; no session |
| 14 | SMART year differs from ATLAS year | 409 `ACTIVE_SCHOOL_YEAR_CONFLICT`; no session |
| 15 | SMART unreachable from ATLAS | 502 `COMPANION_REVERSE_SSO_UNAVAILABLE`; no half-session |
| 16 | Browser reload or back after callback | No second exchange; no duplicate session |
| 17 | Logs reviewed | No code, secret, JWT, cookie, state, or full assertion present |
| 18 | Direct ATLAS dashboard URL | Does not create an ATLAS session; not presented as SSO |

## Implementation Sequence

> SMART steps 1-7 are complete as of 2026-11-10. The ATLAS steps remain.

### SMART

1. Add `ATLAS_SSO_START_URL`, `ATLAS_SSO_CALLBACK_URL`, and `ATLAS_SSO_CLIENT_SECRET`.
2. Add `POST /api/auth/atlas/authorize` with `ADMIN`-only authorization and audience `atlas`.
3. Add `POST /api/auth/atlas/exchange` with Bearer secret validation and an admin-only assertion.
4. Add the SPA route `/auth/atlas/authorize` that bridges the browser to the backend authorize call.
5. Enable the ATLAS item in the admin sidebar only; keep it disabled with "Admin only" in the teacher and registrar portals.
6. Emit audit events for authorize and exchange.
7. Add the exchange endpoint to the rate limiter and the shared error handler.

### ATLAS

1. Add `/auth/smart/start` with signed state and an HTTP-only state cookie.
2. Add `/auth/smart/callback` with state validation, single-exchange guard, and session creation.
3. Add a unique `smartSubject` field to the admin account model.
4. Add the `SMART_SSO_*` configuration.
5. Map `SYSTEM_ADMIN` to the ATLAS admin workspace and reject every other role.
6. Emit audit events for start, callback, and exchange.
7. Add automated tests for replay, expiry, state tampering, role denial, account deactivation, and year conflict.

## Before Implementation, Confirm with ATLAS

1. The exact ATLAS admin role name and the dashboard path.
2. The ATLAS admin account table and the column that will hold `smartSubject`.
3. The ATLAS active-year field that mirrors the EnrollPro numeric school-year ID.
4. The final start and callback URLs.
5. Whether the first SMART subject is pre-provisioned by seed or bound by an ATLAS administrator.

## SMART Implementation (2026-11-10)

The SMART side is implemented. ATLAS remains pending.

| Piece | Location |
| --- | --- |
| Config helpers, code issue, and exchange | `server/src/services/atlasSsoService.ts` |
| Authorize and exchange routes | `server/src/routes/atlasSso.ts` |
| Route mounts | `server/src/index.ts` |
| Public start URL | `server/src/routes/admin-sub/system.ts` (`/api/admin/settings/public`) |
| Admin-only SPA bridge | `src/pages/auth/AtlasAuthorizePage.tsx`, route `/auth/atlas/authorize` |
| Sidebar launch | `src/components/layout/IntegratedSystemsNav.tsx` |
| Public config context | `src/contexts/ThemeContext.tsx` |
| Tests | `server/src/__tests__/atlas-sso.test.ts` |

SMART-side behavior:

- `POST /api/auth/atlas/authorize` requires a SMART `ADMIN` and an active account.
- `POST /api/auth/atlas/exchange` requires `Authorization: Bearer <ATLAS_SSO_CLIENT_SECRET>`.
- Codes are audience `atlas`, 60-second, single-use, SHA-256 hashed, and bound to `ATLAS_SSO_CALLBACK_URL`.
- The assertion is always `roles: ["SYSTEM_ADMIN"]`.
- The ATLAS sidebar item is enabled only in the admin portal and only when `ATLAS_SSO_START_URL`, `ATLAS_SSO_CALLBACK_URL`, and `ATLAS_SSO_CLIENT_SECRET` are all set.

ATLAS must still implement `/auth/smart/start`, `/auth/smart/callback`, the admin account link, and its local session before the flow is operational.

## Prohibited Implementations

- Sending a SMART password, JWT, refresh token, or session cookie to ATLAS.
- Calling the exchange endpoint from browser JavaScript.
- Putting identity data (employee ID, name, role, email) in a URL.
- Reusable, non-expiring, or unhashed authorization codes.
- Retrying a possibly consumed code.
- One shared secret for SSO and data sync.
- Auto-creating an ATLAS account from SSO.
- Matching accounts by name, email, or employee ID alone.
- Accepting a non-admin role for the ATLAS session.
- Presenting a direct dashboard link as authenticated SSO.
- Logging codes, secrets, state, cookies, or full assertions.
- Coordinated logout claims.
