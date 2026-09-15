# Companion SSO Integration Guide (Multi-System)

**Audience:** SMART, ATLAS, MRF (and any future companion) engineering teams.
**Status:** AIMS implementation verified end-to-end on 2026-09-11 (admin clicked EnrollPro → landed on the EnrollPro dashboard).
**Reference implementation:** AIMS. File paths and env names below are AIMS's; substitute your system's names.

This guide is self-contained. It documents the two flows, the exact endpoints and payloads, the configuration to exchange with EnrollPro, the security rules, the error contract, and the pitfalls we hit so you do not repeat them.

---

## 1. What SSO Does (and Does Not Do)

- **Identity transfer only.** SSO proves who the user is. It does not move business data, grant database access, or transfer ownership.
- **Each system keeps its own DB, session, and authorization.** After identity exchange you create **your own** session and enforce **your own** roles.
- **EnrollPro is the hub.** Today there is **no direct companion-to-companion SSO.** "AIMS → SMART" means AIMS → EnrollPro (reverse) → SMART (EnrollPro launch). See §3.3.
- **Never trust browser-supplied identity.** No employee ID, LRN, role, or name in a URL. The server-to-server exchange is the only source of identity.

### Role matrix (EnrollPro-defined)

| EnrollPro role | AIMS | SMART | ATLAS | MRF |
| --- | --- | --- | --- | --- |
| `SYSTEM_ADMIN` | Visible | Visible | Visible | Visible |
| `HEAD_REGISTRAR` | Visible | Visible | Visible | Hidden |
| `TEACHER` | Visible | Visible | Visible | Hidden |
| `CLASS_ADVISER` | Visible | Visible | Visible | Hidden |
| `MRF` | Hidden | Hidden | Hidden | Visible |
| `LEARNER` | Hidden | Hidden | Hidden | Hidden |

Visibility is not authorization. Every launch and exchange must repeat the role check on the server.

---

## 2. Two Flows

| Flow | Direction | Who initiates | Result |
| --- | --- | --- | --- |
| **A. Outbound (launch)** | EnrollPro → Companion | User clicks your item in EnrollPro's sidebar | You create a local session, land on your dashboard |
| **B. Reverse** | Companion → EnrollPro | User clicks EnrollPro in your sidebar | EnrollPro creates a session, lands on its dashboard |

A complete integration implements **both**. Flow A makes you launchable from EnrollPro. Flow B makes EnrollPro reachable from your sidebar (and, through EnrollPro, makes every other companion reachable).

---

## 3. Architecture

### 3.1 Flow A — EnrollPro launches the companion

```
EnrollPro authenticated browser
  → POST /api/auth/companion-sso/<system>/launch        (EnrollPro, cookie-authed)
  → 302 redirect to your callback with ?code=<43-char>&state?
  → your callback handler (server-to-server)
  → POST <ENROLLPRO_API>/auth/companion-sso/<system>/exchange
        Authorization: Bearer <YOUR_SSO_CLIENT_SECRET>
        { "code": "<43-char>" }
  → validate payload, map identity, create YOUR session
  → redirect to your role dashboard
```

### 3.2 Flow B — Companion initiates EnrollPro (reverse)

```
Your authenticated browser
  → GET <ENROLLPRO_PUBLIC>/api/auth/companion-sso/<system>/reverse/start
  → EnrollPro sets a signed state cookie and 302s to YOUR authorize URL:
        <YOUR_AUTHORIZE_URL>?response_type=code
          &client_id=enrollpro
          &redirect_uri=<ENROLLPRO reverse callback>
          &state=<signed opaque state>
  → your authorize handler issues a 43-char one-time code, stores only its hash,
    and 302s the browser back to:
        <ENROLLPRO reverse callback>?code=<code>&state=<unchanged state>
  → EnrollPro backend calls YOUR exchange endpoint exactly once:
        POST <YOUR_EXCHANGE_URL>
        Authorization: Bearer <YOUR_REVERSE_CLIENT_SECRET>
        { "code": "...", "clientId": "enrollpro", "redirectUri": "<exact callback>" }
  → you atomically consume the code and return the identity assertion
  → EnrollPro links/validates identity and creates its session
  → lands on EnrollPro /dashboard (admin/registrar) or /teacher/advisory
```

### 3.3 Why not companion → companion directly?

EnrollPro's `reverse/start` only returns the user to **EnrollPro**. There is no shared cookie, no shared JWT, and no central IdP yet. Therefore:

- Your sidebar shows **EnrollPro** as an enabled launch item (Flow B).
- Do **not** enable AIMS/SMART/ATLAS links as if they were authenticated. A raw dashboard URL creates no session.
- To reach another companion: `Your system → EnrollPro → target companion` (two clicks).
- **Phase 3 (future):** a central OpenID Connect provider with Authorization Code + PKCE. Only then may companions link each other directly. Do not build insecure shortcuts in the meantime.

This is a hard requirement in `INTEGRATED-SYSTEMS-SIDEBAR-SSO.md`.

---

## 4. What Every Companion Must Implement

### 4.1 Flow A endpoints (you are the destination)

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET <your callback>` | none (short-lived code only) | Browser callback; validate code shape, exchange server-side, create session, redirect |
| `POST <your callback>` (optional) | none | JSON variant for SPA-mediated callbacks |

Rules:
- Validate the code shape `^[A-Za-z0-9_-]{43}$` before exchanging.
- Process the callback **once**. Guard against React StrictMode / double-mount re-exchanging the same code (module-level `Set` keyed by code, or an equivalent idempotency guard).
- Treat ambiguous network results as consumed; **never retry the same code**.
- Validate the full exchange response (see §5.3) and require `companion` to equal your system name.

### 4.2 Flow B endpoints (you are the issuer)

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET <your authorize URL>` | your local session | EP redirects the browser here; issue code, redirect to EP callback |
| `POST <your exchange URL>` | `Bearer <your reverse client secret>` | EP trades the code for the identity assertion |

Rules:
- **Authorize:** require a valid local session. If the user is not logged in, send them through your login and **resume the authorize request afterward** (preserve the full authorize URL as a `returnUrl`; see §10 for the pitfall).
- **Authorize:** reject unknown `client_id` or `redirect_uri`; only redirect to the pre-registered EP callback; echo `state` unchanged.
- **Exchange:** validate the Bearer secret with a **constant-time** compare.
- **Exchange:** atomically consume the code (see §4.3). One code → one success, ever.
- **Exchange:** validate `clientId === "enrollpro"` and `redirectUri` equals your configured EP callback.

### 4.3 One-time code store

Generate **32 random bytes → 43 base64url chars**. Store **only the SHA-256 hash**.

Minimum columns (AIMS model `CompanionSsoCode`, table `companion_sso_codes`):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text (uuid) | PK |
| `codeHash` | text unique | SHA-256 hex of the plaintext code |
| `userId` | text | local user id (FK, cascade delete) |
| `audience` | text | `"enrollpro"` |
| `redirectUri` | text | exact EP callback binding |
| `expiresAt` | timestamp | `now + 60s` |
| `consumedAt` | timestamp nullable | set once on first successful exchange |
| `createdAt` | timestamp | default now |

**Atomic consume pattern** (do not read-then-update):

```ts
const claimed = await tx.companionSsoCode.updateMany({
  where: { codeHash, consumedAt: null, expiresAt: { gt: now }, audience, redirectUri },
  data: { consumedAt: now },
})
if (claimed.count !== 1) throw new Error('INVALID_CODE')
```

Two concurrent exchanges then race on the row lock and exactly one wins.

### 4.4 Local session

Create **your own** session after the exchange succeeds:

- HTTP-only cookie (or your existing auth mechanism), Secure in production, explicit SameSite.
- Session ID rotation on login (fixation protection).
- The EP code and identity response must never become your session token.

### 4.5 Integrated Systems sidebar

- Group placed after primary nav, before system administration.
- Order: AIMS, SMART, ATLAS, MRF. Mark your own system as `Current system` (non-clickable).
- Your **EnrollPro** item navigates same-tab to `<ENROLLPRO_PUBLIC>/api/auth/companion-sso/<your-system>/reverse/start`.
- Companion items (other than EnrollPro) stay **disabled / "unavailable until federation"**.
- Show plain messages; never render raw HTTP responses, codes, secrets, or callback URLs.
- AIMS gates the EnrollPro item to `ADMIN`; contract matrix allows all staff roles — decide per your least-privilege policy.

---

## 5. Contracts

### 5.1 Flow A launch request (EnrollPro side, for context)

```http
POST /api/auth/companion-sso/<system>/launch
Cookie: <EnrollPro session>
```

Response `201`: `{ "launchUrl": "https://you/auth/enrollpro/callback?code=<one-time-code>&state=<signed-state>", "expiresAt": "..." }`

The callback is server-configured in EnrollPro; the browser cannot override it.

### 5.2 Flow A exchange (you call EnrollPro)

```http
POST <ENROLLPRO_API>/auth/companion-sso/<system>/exchange
Authorization: Bearer <YOUR_SSO_CLIENT_SECRET>
Content-Type: application/json

{ "code": "<43-char-one-time-code>" }
```

> AIMS note: `ENROLLPRO_BASE_URL` may include a trailing `/api`, so the effective path is `https://dev-jegs.../api/auth/companion-sso/aims/exchange`. The `aims` segment is case-insensitive in practice, but keep it consistent with EnrollPro's config.

### 5.3 Flow A exchange response (EnrollPro returns)

```json
{
  "success": true,
  "companion": "AIMS",
  "identity": {
    "subject": "ENROLLPRO_USER:1",
    "userId": 1,
    "employeeId": "1234501",
    "lrn": null,
    "firstName": "Jose",
    "middleName": null,
    "lastName": "Rizal",
    "roles": ["SYSTEM_ADMIN"]
  },
  "activeSchoolYear": { "id": 1, "yearLabel": "2029-2030" },
  "authenticatedAt": "2026-09-07T10:00:15.000Z"
}
```

Validate: `success === true`, `companion` matches your system, at least one allowed role, identity present, active school year present. Map by `userId`/`employeeId` to a local account; **never** auto-create without an approved matching policy, and never let a staff SSO claim a learner account.

### 5.4 Flow B authorize request (EP → you)

```http
GET <YOUR_AUTHORIZE_URL>
  ?response_type=code
  &client_id=enrollpro
  &redirect_uri=<registered EnrollPro reverse callback>
  &state=<opaque signed state>
```

Redirect success (browser):

```
<ENROLLPRO_CALLBACK>?code=<43-char>&state=<unchanged-state>
```

### 5.5 Flow B exchange (EP → you)

```http
POST <YOUR_EXCHANGE_URL>
Authorization: Bearer <YOUR_REVERSE_CLIENT_SECRET>
Content-Type: application/json

{ "code": "<43-char>", "clientId": "enrollpro", "redirectUri": "<exact EP callback>" }
```

### 5.6 Flow B exchange response (you return)

```json
{
  "success": true,
  "issuer": "AIMS",
  "identity": {
    "subject": "AIMS_USER:<stable-id>",
    "employeeId": "1234501",
    "lrn": null,
    "firstName": "Jose",
    "middleName": null,
    "lastName": "Rizal",
    "roles": ["SYSTEM_ADMIN"]
  },
  "activeSchoolYear": { "id": 1, "yearLabel": "2029-2030" },
  "authenticatedAt": "2026-09-07T12:00:00.000Z"
}
```

Critical:
- `issuer` must equal your system name exactly.
- `identity.subject` is your stable, non-recycled identifier — **do not copy EnrollPro's subject**.
- `activeSchoolYear.id` is **EnrollPro's** school-year id (mirrored), not your local PK. The id **and** label must match EnrollPro's current active year.
- EnrollPro uses its own roles for the resulting session; your roles cannot elevate it.

---

## 6. Configuration Matrix

### 6.1 Values to exchange with EnrollPro

Request/confirm these from the EnrollPro team:

| # | Value | Example | Used by |
| --- | --- | --- | --- |
| 1 | EnrollPro public origin | `https://dev-jegs.buru-degree.ts.net` | reverse/start link, callback construction |
| 2 | EnrollPro API base | `https://dev-jegs.buru-degree.ts.net/api` | Flow A exchange |
| 3 | Your registered **callback** URL (EP stores it) | `https://you/api/auth/enrollpro/callback` or `https://you/auth/sso/callback` | EP launch redirect |
| 4 | Your **outbound client secret** (EP stores it) | 32+ random chars | Flow A: you send as Bearer |
| 5 | Your **reverse authorize URL** (EP stores it) | `https://you/auth/enrollpro/authorize` | Flow B step 1 |
| 6 | Your **reverse exchange URL** (EP stores it) | `https://you/api/v1/auth/sso/exchange` | Flow B step 3 |
| 7 | Reverse client id | `enrollpro` | both sides |
| 8 | Your **reverse client secret** (you generate, give to EP) | 32+ random chars | Flow B: EP sends as Bearer |
| 9 | EnrollPro reverse callback (EP generates from `ENROLLPRO_PUBLIC_URL`) | `https://enrollpro/api/auth/companion-sso/<system>/reverse/callback` | you validate `redirectUri` |
| 10 | Accepted roles + school-year semantics | see §1, §5.6 | both sides |

Also confirm with EnrollPro:
- EP callback-origin reachability check passes for your callback URL (HTTPS outside localhost).
- Your authorize/exchange URLs share the same origin.
- Outbound and reverse secrets are **different** credentials.

### 6.2 Per-system env names (EnrollPro side)

EnrollPro requires six server-only settings per companion:

```text
<SYSTEM>_SSO_CALLBACK_URL=<exact callback>
<SYSTEM>_SSO_CLIENT_SECRET=<outbound secret, >= 32 chars>
<SYSTEM>_SSO_REVERSE_AUTHORIZE_URL=<exact authorize URL>
<SYSTEM>_SSO_REVERSE_EXCHANGE_URL=<exact exchange URL>
<SYSTEM>_SSO_REVERSE_CLIENT_ID=enrollpro
<SYSTEM>_SSO_REVERSE_CLIENT_SECRET=<reverse secret, >= 32 chars>
ENROLLPRO_PUBLIC_URL=<EnrollPro origin>
```

### 6.3 Per-system env names (companion side)

AIMS names (rename for your system):

```text
ENROLLPRO_BASE_URL=https://dev-jegs.buru-degree.ts.net/api
ENROLLPRO_SSO_CLIENT_SECRET=<outbound secret>            # AIMS also accepts AIMS_SSO_CLIENT_SECRET
ENROLLPRO_SSO_CALLBACK_URL=<EP reverse callback>          # validate redirectUri
AIMS_SSO_REVERSE_CLIENT_SECRET=<reverse secret>           # canonical inbound secret
# legacy alias accepted by AIMS; pick one naming and be consistent
ENROLLPRO_REVERSE_CLIENT_SECRET=<same value as above>
# informational (share with EP; AIMS code does not read these):
AIMS_SSO_REVERSE_AUTHORIZE_URL=https://you/auth/enrollpro/authorize
AIMS_SSO_REVERSE_EXCHANGE_URL=https://you/api/v1/auth/sso/exchange
AIMS_SSO_REVERSE_CLIENT_ID=enrollpro
```

> **Pitfall:** the inbound secret must be the **exact** value EP sends. AIMS originally validated a differently-named env var and every valid reverse exchange failed with `COMPANION_SSO_CLIENT_INVALID`. Validate against a single canonical name (accepting a legacy alias is fine) and log which name matched (never the value).

---

## 7. Security Requirements

- Secrets live **server-side only**. Never expose to the browser; never log them.
- Constant-time secret comparison. AIMS uses `crypto.timingSafeEqual` with a length guard.
- Codes: 43 base64url chars, 60s TTL, single-use, hashed at rest, bound to audience + redirect URI.
- Reject unknown/expired/consumed/wrong-system codes with **one** identical public error.
- Never retry a possibly-consumed code.
- Remove the code from browser history after session creation.
- Logging ban: authorization code, full callback URL, client secret, password, JWT/cookie, full identity payload, destination session token, reverse code + signed state.
- Callback validation: HTTPS outside local dev, absolute URL, no credentials, no fragment.

---

## 8. Error Contract

Flow A exchange (EnrollPro → you) uses stable codes:

| HTTP | Code | UI behavior |
| ---: | --- | --- |
| 401 | `COMPANION_SSO_CLIENT_INVALID` | Service config error; do not auto-retry with same secret |
| 401 | `COMPANION_SSO_CODE_INVALID` | "This sign-in link expired or was already used. Start again." |
| 401 | `COMPANION_SSO_ACCOUNT_UNAVAILABLE` | Deny; direct to admin |
| 403 | `COMPANION_SSO_ROLE_DENIED` | "You do not have access to this system." |
| 403 | `COMPANION_SSO_COMPLETER_BLOCKED` | No operational workspace |
| 403 | `COMPANION_SSO_IDENTITY_INCOMPLETE` | Direct to account correction |
| 409 | `ACTIVE_SCHOOL_YEAR_REQUIRED` / `_CONFLICT` | No session; admin correction |
| 428 | `PASSWORD_CHANGE_REQUIRED` | Route through EnrollPro password change |
| 503 | `COMPANION_SSO_NOT_CONFIGURED` / `_UNREACHABLE` | Disable item / allow retry |

Flow B (you → EP) error shape — the exchange must return this exact JSON on any invalid code:

```json
{ "code": "COMPANION_SSO_CODE_INVALID", "message": "The SSO authorization code is invalid, expired, or already used." }
```

Reverse-flow errors surface at EnrollPro as `/personnel/login?ssoError=<stable-code>&source=<companion>`.
Never parse user-facing messages as control logic — branch on HTTP status + stable code.

---

## 9. Testing & Acceptance Checklist

**Flow A**
- [ ] EnrollPro catalog lists your system as enabled/eligible.
- [ ] Clicking it in EnrollPro lands on your dashboard with a local session.
- [ ] Replaying the same code fails; concurrent exchanges yield exactly one success.
- [ ] A code for your system fails on another system's exchange route.
- [ ] Wrong/missing secret fails; inactive/default-password/completer identities fail.
- [ ] Callback runs once under React StrictMode / remount.
- [ ] No secret, code, or identity dump in logs.

**Flow B**
- [ ] Your sidebar EnrollPro item hits `/api/auth/companion-sso/<system>/reverse/start`.
- [ ] EP sets its state cookie and redirects to your authorize URL.
- [ ] Your authorize issues a code and redirects to EP callback with unchanged state.
- [ ] EP backend calls your exchange once; identity assertion validates; EP lands on its dashboard.
- [ ] Altered/expired/cross-source state is rejected.
- [ ] First-time linking requires one exact employee ID/LRN + matching names.
- [ ] Mirrored EnrollPro school-year id **and** label match.
- [ ] An admin → EnrollPro click works from a **cold full page load** (no login bounce).

**Cross-system navigation**
- [ ] Direct companion items are disabled (hub model only).
- [ ] No shared cookie/JWT shortcut anywhere.

---

## 10. Reference Implementation: AIMS (copy this shape)

| Concern | AIMS path |
| --- | --- |
| Outbound service (exchange + validate + reconcile) | `server/src/services/enrollpro-sso.service.ts` |
| Reverse service (code issue/consume, identity assertion) | `server/src/services/enrollpro-reverse-sso.service.ts` |
| SSO controllers (outbound callback, reverse authorize/exchange) | `server/src/controllers/auth.controller.ts` |
| Routes | `server/src/routes/auth.routes.ts` — mounted at `/api/v1/auth` |
| Code model | `server/prisma/schema.prisma` → `CompanionSsoCode` / `companion_sso_codes` |
| SPA callback page (Flow A) | `client/src/pages/auth/SsoCallback.tsx` (`/auth/sso/callback`) |
| SPA authorize page (Flow B) | `client/src/pages/auth/EnrollProAuthorize.tsx` (`/auth/enrollpro/authorize`) |
| Sidebar item | `client/src/components/layout/Sidebar.tsx` (`ENROLLPRO_REVERSE_START_URL`) |

AIMS endpoints (post-`/api/v1`):

```text
GET|POST /auth/enrollpro/callback     # Flow A callback
POST     /auth/sso/authorize          # Flow B authorize (JWT-authed, SPA-mediated)
POST     /auth/sso/exchange           # Flow B exchange (Bearer reverse secret)
```

AIMS uses JWT-in-localStorage, so its authorize endpoint is **SPA-mediated**: EP redirects the browser to `/auth/enrollpro/authorize`; the SPA calls `POST /api/v1/auth/sso/authorize` with the JWT and navigates to the returned EP callback URL. A cookie-based system can instead expose `GET /auth/sso/authorize` directly. The contract only requires that EP's redirect lands on an endpoint that (a) confirms local auth and (b) issues the code.

### Pitfalls we hit (do not repeat)

1. **Inbound secret env name mismatch.** EP sends one specific reverse secret; validating a differently-named variable fails every exchange. AIMS now compares against `AIMS_SSO_REVERSE_CLIENT_SECRET` (canonical) plus a legacy alias, constant-time.
2. **DB column naming drift.** A hand-written migration created `code_hash` while the ORM expected `codeHash` → `P2022: column "codeHash" does not exist` on authorize. Keep migration column names identical to your ORM model (or map them explicitly).
3. **Auth-hydration race on the authorize page.** EP delivers Flow B via a **full page load**; on first render the local session is still loading. If your authorize page checks `!user` without waiting for the auth `isLoading` flag, it bounces to `/login` (and React StrictMode double-wrapping `returnUrl` produces a nested `/login?returnUrl=/login?returnUrl=...`). Wait for auth to finish before deciding the user is logged out.
4. **Honor `returnUrl` after login.** If the user must log in first, resume the authorize URL afterward — otherwise clicking EnrollPro silently drops them on your dashboard and EP never gets a code.
5. **Never fabricate on outage.** If EnrollPro is unreachable, preserve existing state and report unavailability — do not invent sessions or records.

---

## 11. Onboarding a New Companion (Checklist)

1. Confirm the role matrix and local role mapping.
2. Register the exact HTTPS callback with EnrollPro and provision the outbound secret.
3. Implement Flow A (callback + exchange + local session + role routing).
4. Generate the reverse secret; give EnrollPro your authorize URL, exchange URL, client id (`enrollpro`), and reverse secret.
5. Implement Flow B (authorize + exchange + atomic code store + identity assertion).
6. Add the Integrated Systems sidebar: EnrollPro enabled; other companions disabled.
7. Ensure the authorize page waits for auth hydration and resumes after login.
8. Test every item in §9, including replay, expiry, role denial, deactivation, year conflict, and cold-load authorize.
9. Enable the EnrollPro item only after all checks pass.
10. Add your system to EnrollPro's catalog/sidebar and confirm the reverse callback is reachable.

---

## 12. Appendix — Example Per-System Settings

Replace `<SYSTEM>` with `SMART`, `ATLAS`, or `MRF`.

**EnrollPro stores (per system):**

```text
<SYSTEM>_SSO_CALLBACK_URL=https://<system>.buru-degree.ts.net/api/v1/auth/enrollpro/callback
<SYSTEM>_SSO_CLIENT_SECRET=<outbound secret>
<SYSTEM>_SSO_REVERSE_AUTHORIZE_URL=https://<system>.buru-degree.ts.net/auth/enrollpro/authorize
<SYSTEM>_SSO_REVERSE_EXCHANGE_URL=https://<system>.buru-degree.ts.net/api/v1/auth/sso/exchange
<SYSTEM>_SSO_REVERSE_CLIENT_ID=enrollpro
<SYSTEM>_SSO_REVERSE_CLIENT_SECRET=<reverse secret>
```

**Companion stores:**

```text
ENROLLPRO_BASE_URL=https://dev-jegs.buru-degree.ts.net/api
ENROLLPRO_PUBLIC_URL=https://dev-jegs.buru-degree.ts.net
ENROLLPRO_SSO_CLIENT_SECRET=<outbound secret>
ENROLLPRO_SSO_CALLBACK_URL=https://dev-jegs.buru-degree.ts.net/api/auth/companion-sso/<system>/reverse/callback
<SYSTEM>_SSO_REVERSE_CLIENT_SECRET=<reverse secret>
```

**Sidebar link:** `https://dev-jegs.buru-degree.ts.net/api/auth/companion-sso/<system>/reverse/start`

---

## 13. Related Documents

- `docs/new api/INTEGRATED-SYSTEMS-SIDEBAR-SSO.md` — authoritative multi-system contract
- `docs/new api/AIMS-REVERSE-SSO-IMPLEMENTATION-GUIDE.md` — reverse flow requirements + error format
- `docs/new api/AIMS-SSO-Integration.md` — outbound (EnrollPro → AIMS) exchange
- `docs/new api/aims-sso-implementation-guide.md` — Node/Express reference snippet
