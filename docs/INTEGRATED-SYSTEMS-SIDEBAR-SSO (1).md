# Integrated Systems Sidebar and SSO Implementation Guide

Last reviewed: 2026-09-14

## Purpose

This guide defines how EnrollPro, AIMS, SMART, ATLAS, and MRF must present the **Integrated Systems** sidebar and establish a secure local session when a user opens another system.

It covers:

- sidebar information architecture and interaction behavior
- role-based visibility and availability
- EnrollPro launch, exchange, and persistence components
- companion callback controllers and local session creation
- authorization-code validation and error handling
- current limitations on companion-to-companion navigation
- the required federation architecture for fully bidirectional SSO
- privacy, audit, deployment, and verification requirements

The screenshot supplied with the request is a visual reference for the sidebar location and hierarchy. It is not an API contract.

## Authoritative Boundaries

The ownership rules in `ARCHITECTURE_MICROSERVICES.md` continue to apply after SSO:

| System | Authoritative domain |
| --- | --- |
| EnrollPro | identity, enrollment, official section placement, school-year context, and school-form workflow |
| AIMS | intervention, learning activity, assessments, submissions, and mastery records |
| SMART | grades, learning-area results, promotion outcomes, and attendance |
| ATLAS | schedules, teaching loads, room assignments, and timetable publication |
| MRF | maintenance, facilities, and waste-management operations |

SSO transfers a verified, minimized identity. It does not transfer ownership of business data or authorize direct access to another system's database.

Each system must:

- keep a separate database
- create and own its own browser session
- enforce its own local permissions after identity exchange
- consume only documented APIs
- avoid copying another system's credentials, cookies, tokens, or domain records

## Implementation Status

### Implemented today

EnrollPro can launch AIMS, SMART, ATLAS, or MRF through a 60-second, single-use authorization code. The destination backend exchanges the code with EnrollPro and creates its own session.

The following EnrollPro components are implemented:

- `GET /api/auth/companion-sso/catalog`
- `POST /api/auth/companion-sso/:system/launch`
- `POST /api/auth/companion-sso/:system/exchange`
- `GET /api/auth/companion-sso/:system/reverse/start`
- `GET /api/auth/companion-sso/:system/reverse/callback`
- role-aware EnrollPro sidebar items
- callback availability checks
- hashed authorization-code persistence
- atomic one-time code consumption
- active-account and active-school-year checks
- staff employee-ID resolution through either the user or linked teacher profile
- launch and exchange audit events
- signed reverse-flow state cookies
- server-to-server exchange of companion-issued one-time codes
- stable companion identity links and EnrollPro session issuance
- retirement of the legacy embedded `/smart` route and its browser-stored bypass token

Reverse SSO is source-complete on the EnrollPro side but is not operational for a companion until its reverse authorization and exchange endpoints are implemented, the new migration is applied, and all reverse settings are configured.

### Still not implemented

The current contract does not directly launch one companion from another companion in a single operation.

There is currently no:

- direct AIMS-to-SMART or SMART-to-ATLAS SSO contract
- shared cross-domain cookie
- shared OpenID Connect provider
- coordinated single logout

Therefore, a companion may enable its **EnrollPro** item after reverse SSO is configured and verified. It must not enable direct links to other companions merely by linking to their dashboards. A direct URL does not create a session and must not be presented as completed SSO.

## Required Architecture

### Phase 1: EnrollPro-originated SSO

Use the existing EnrollPro authorization-code flow for users who start in EnrollPro:

```text
EnrollPro authenticated browser
  -> EnrollPro launch endpoint
  -> destination callback with one-time code
  -> destination backend exchange
  -> destination-owned session
  -> destination role dashboard
```

This phase supports the EnrollPro sidebar shown in the reference image.

### Phase 2: Companion-to-EnrollPro reverse SSO

Use the implemented EnrollPro reverse flow for a user who starts inside a companion:

```text
Companion authenticated browser
  -> EnrollPro reverse/start endpoint
  -> companion authorization endpoint with signed state
  -> companion-issued one-time code
  -> EnrollPro reverse callback and server-side exchange
  -> EnrollPro identity-link validation
  -> EnrollPro-owned session
  -> EnrollPro role dashboard
```

The EnrollPro `reverse/start` endpoint creates a signed state value and an HTTP-only SameSite Lax state cookie before redirecting to the companion. The callback requires an exact cookie and query-state match. EnrollPro never accepts an identity payload directly from browser JavaScript.

### Phase 3: Federated cross-system navigation

To support the same sidebar inside every companion, use a central OpenID Connect identity provider with Authorization Code Flow and PKCE. EnrollPro, AIMS, SMART, ATLAS, and MRF become separate relying parties.

The central identity provider must provide:

- one stable, issuer-neutral subject per person
- registered redirect URIs for every system
- signed ID tokens with issuer and audience validation
- short-lived authorization codes
- PKCE, state, and nonce validation
- account status and role claims from the identity authority
- refresh and signing-key rotation policies
- logout behavior defined separately from local logout
- auditable consent-free first-party school-system navigation

Until Phase 3 is deployed, companion-to-companion items must be disabled or labeled as unavailable. Reverse SSO may be used to return to EnrollPro, where the user can launch another configured companion. Do not implement an insecure shortcut using shared cookies, copied JWTs, URL identity fields, employee IDs alone, or reusable integration keys.

## Sidebar Information Architecture

### Section placement

Add an **Integrated Systems** group after the host system's primary operational navigation and before system administration links.

Use this order consistently:

1. AIMS
2. SMART
3. ATLAS
4. MRF

When implemented in a companion application, the host system may remain visible as the current item. It must be non-clickable and marked `Current system`. The other items represent launch actions, not ordinary internal links.

### Labels and descriptions

| System | Primary label | Supporting text | Suggested icon |
| --- | --- | --- | --- |
| AIMS | `AIMS` | `Academic interventions` | Database or learning-record icon |
| SMART | `SMART` | `Grades and attendance` | Check-circle or grade-record icon |
| ATLAS | `ATLAS` | `Teaching loads and schedules` | Calendar-clock icon |
| MRF | `MRF` | `Maintenance requests` | Wrench icon |

Supporting text must remain visible when the sidebar has enough width and become a tooltip in collapsed icon mode. Use the host application's established icon library. Do not introduce custom decorative SVG artwork.

### Role visibility

The current EnrollPro role matrix is:

| EnrollPro role | AIMS | SMART | ATLAS | MRF |
| --- | --- | --- | --- | --- |
| `SYSTEM_ADMIN` | Visible | Visible | Visible | Visible |
| `HEAD_REGISTRAR` | Visible | Visible | Visible | Hidden |
| `TEACHER` | Visible | Visible | Visible | Hidden |
| `CLASS_ADVISER` | Visible | Visible | Visible | Hidden |
| `MRF` | Hidden | Hidden | Hidden | Visible |
| `LEARNER` | Hidden | Hidden | Hidden | Hidden |

Visibility is not authorization. Every launch and exchange must repeat authorization on the server.

Companion systems must apply the same least-privilege principle using verified identity claims and local role mappings. They must not expose a destination that the user cannot enter.

### UI states

Every item must support these states:

| State | Presentation | Behavior |
| --- | --- | --- |
| Loading catalog | Neutral disabled item or skeleton | No launch allowed |
| Available | Normal icon and label | Launch allowed |
| Launching | Spinner replaces only the selected icon; label becomes `Opening <system>` | All companion launch items temporarily disabled |
| Current system | Active visual treatment with `Current system` tooltip | No action |
| Not configured | Disabled with reduced emphasis | Tooltip explains configuration is incomplete |
| Role denied | Hidden by default | If shown for administration, disabled with a plain reason |
| Password change required | Disabled or intercepted | Send user to EnrollPro password change before launch |
| Destination unavailable | Item remains visible | Show a non-destructive error and allow a later retry |
| Session expired | No navigation | Prompt the user to sign in again to the identity authority |

### Interaction rules

- Preserve the host application's unsaved-change guard before leaving the page.
- Use same-tab navigation unless the user explicitly chooses a new tab through normal browser controls.
- Prevent repeated clicks while a launch is pending.
- Show loading only on the selected system.
- Keep the remaining sidebar stable to avoid layout shift.
- Do not mark an external destination as active after the browser has left the host application.
- Use plain messages such as `Could not open SMART` or `MRF login is not configured`.
- Never display raw HTTP responses, tokens, codes, secrets, stack traces, or callback URLs.
- Use `text-sm` or larger for visible labels and messages.
- Preserve keyboard navigation, visible focus, and screen-reader names.

## EnrollPro Frontend Behavior

EnrollPro implements the sidebar in `client/src/shared/layouts/AppLayout.tsx`.

### Catalog loading

On authenticated application-shell mount, EnrollPro requests:

```http
GET /api/auth/companion-sso/catalog
```

The response is stored as typed `CompanionSsoCatalogItem` records:

```json
{
  "systems": [
    {
      "system": "AIMS",
      "enabled": true,
      "eligible": true,
      "disabledReason": null
    }
  ]
}
```

The client combines the server catalog with role-based visibility. The server result remains authoritative for enabled and eligible state.

### Launch action

After the unsaved-change guard permits navigation, the client sends:

```http
POST /api/auth/companion-sso/aims/launch
```

No request body or browser-supplied `redirect_uri` is permitted.

On HTTP `201`, the client performs:

```text
window.location.assign(launchUrl)
```

On failure, the selected spinner stops and a plain error notification appears. `PASSWORD_CHANGE_REQUIRED` routes the user to EnrollPro's password-change page.

## EnrollPro Backend Components

### Router

`server/src/features/auth/auth.router.ts` mounts the SSO routes below `/api/auth`.

| Route | Middleware | Limit |
| --- | --- | ---: |
| `GET /companion-sso/catalog` | EnrollPro authentication | Standard API policy |
| `POST /companion-sso/:system/launch` | Launch rate limiter, then EnrollPro authentication | 10 requests per minute per default IP key |
| `POST /companion-sso/:system/exchange` | Exchange rate limiter and strict body validation | 60 requests per minute per default IP key |
| `GET /companion-sso/:system/reverse/start` | Launch rate limiter and signed-state creation | 10 requests per minute per default IP key |
| `GET /companion-sso/:system/reverse/callback` | Exchange rate limiter, state verification, and companion exchange | 60 requests per minute per default IP key |

### Controller

`server/src/features/auth/companion-sso.controller.ts` performs transport-level work only:

- reads and normalizes the `system` path parameter
- obtains the authenticated EnrollPro user ID for catalog and launch
- reads the companion Bearer secret for exchange
- sets and clears the reverse-flow state cookie
- redirects the browser to the companion authorization endpoint
- accepts the reverse callback without exposing the companion exchange secret
- issues the EnrollPro session cookie after successful reverse validation
- redirects to `/dashboard` for administrators and registrars or `/teacher/advisory` for teachers and class advisers
- passes validated input to the service
- returns HTTP `201` for launch and HTTP `200` for exchange

Business rules must remain in the service rather than being duplicated in controllers.

### Service

`server/src/features/auth/companion-sso.service.ts` owns:

- supported-system parsing
- callback and secret configuration validation
- role filtering
- default-password, completer, account, and identifier checks
- callback-origin reachability check
- authorization-code generation and hashing
- serializable, atomic code consumption
- active-school-year resolution
- minimized identity response creation
- SSO audit events

`server/src/features/auth/companion-sso-reverse.service.ts` owns:

- reverse authorization and exchange configuration validation
- signed five-minute state creation and verification
- fixed EnrollPro callback construction
- server-to-server companion code exchange with no ambiguous retry
- strict companion identity assertion validation
- authoritative active-school-year matching
- external-subject link resolution
- guarded first-time linking by exact employee ID or LRN and matching name
- current EnrollPro account, password, completer, and role checks
- reverse-login audit events and role-appropriate landing selection

### Shared contract

`shared/src/schemas/companion-sso.schema.ts` is the runtime and TypeScript contract source for:

- `CompanionSystem`
- catalog items and catalog response
- authorization-code request body
- launch response
- exchange response
- reverse callback query
- reverse token request
- reverse exchange response

All systems should reproduce these schemas in their native validation library rather than trusting parsed JSON.

### Persistence

The Prisma `CompanionSsoAuthorizationCode` model stores:

- unique SHA-256 code hash
- EnrollPro user ID
- destination companion
- expiration time
- consumption time
- request IP address
- user agent
- creation time

The plaintext authorization code is never stored. Code rows are security records and should be removed later by an approved expiry-retention job without deleting audit logs.

The Prisma `CompanionIdentityLink` model stores one stable external subject per companion and EnrollPro user. Both `(companion, externalSubject)` and `(companion, userId)` are unique. The model records the most recent successful reverse authentication without storing a companion token or session.

## EnrollPro SSO API Contract

### Catalog

```http
GET /api/auth/companion-sso/catalog
Cookie: <EnrollPro session>
```

### Launch

```http
POST /api/auth/companion-sso/:system/launch
Cookie: <EnrollPro session>
```

Successful response, HTTP `201`:

```json
{
  "launchUrl": "https://companion.example/auth/enrollpro/callback?code=<one-time-code>",
  "expiresAt": "2026-09-07T10:01:00.000Z"
}
```

The callback is server-configured. The launch request cannot override it.

### Exchange

```http
POST /api/auth/companion-sso/:system/exchange
Authorization: Bearer <system-specific SSO secret>
Content-Type: application/json

{
  "code": "<43-character-one-time-code>"
}
```

Successful response, HTTP `200`:

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
  "activeSchoolYear": {
    "id": 1,
    "yearLabel": "2029-2030"
  },
  "authenticatedAt": "2026-09-07T10:00:15.000Z"
}
```

The canonical response uses `activeSchoolYear`. It does not include `identity.isActive` or `schoolYear.isActive`. EnrollPro validates account activity and school-year consistency before returning success.

## Reverse SSO API Contract

### Start from a companion sidebar

The companion's **EnrollPro** sidebar item navigates in the same tab to:

```http
GET <ENROLLPRO_PUBLIC_URL>/api/auth/companion-sso/:source/reverse/start
```

`:source` is `aims`, `smart`, `atlas`, or `mrf`. The request does not require an existing EnrollPro session.

EnrollPro:

1. Loads the source-specific reverse configuration.
2. Creates a signed state token containing the source and a random nonce.
3. Stores the state in a five-minute HTTP-only, Secure in production, SameSite Lax cookie.
4. Redirects to the configured companion authorization endpoint with `response_type=code`, fixed `client_id`, fixed EnrollPro `redirect_uri`, and `state`.

### Companion authorization endpoint

Each companion must expose its configured authorization URL and accept:

```http
GET /auth/enrollpro/authorize
  ?response_type=code
  &client_id=enrollpro
  &redirect_uri=<registered EnrollPro callback>
  &state=<opaque signed state>
```

The companion must:

- require its own valid local user session
- reject an unknown client ID or redirect URI
- recheck local account activity and authorization
- issue a cryptographically random 43-character one-time code
- store only the code hash, EnrollPro audience, user, redirect URI, expiry, and consumption time
- use a lifetime of no more than 60 seconds
- redirect only to the pre-registered EnrollPro callback
- return the state unchanged

Successful redirect:

```text
<ENROLLPRO_CALLBACK>?code=<one-time-code>&state=<unchanged-state>
```

### EnrollPro reverse callback

The fixed callback is:

```http
GET /api/auth/companion-sso/:source/reverse/callback?code=...&state=...
```

EnrollPro verifies the callback state against both the signature and the HTTP-only state cookie before making any exchange request. State is source-bound and expires after five minutes.

### Companion reverse exchange endpoint

Each companion must expose a backend exchange endpoint matching its configured reverse exchange URL. EnrollPro calls it exactly once:

```http
POST <configured *_SSO_REVERSE_EXCHANGE_URL>
Authorization: Bearer <source-specific reverse client secret>
Content-Type: application/json

{
  "code": "<43-character-one-time-code>",
  "clientId": "enrollpro",
  "redirectUri": "<exact registered EnrollPro callback>"
}
```

The path is companion-owned and must not be inferred by EnrollPro. For the current AIMS contract, `AIMS_SSO_REVERSE_EXCHANGE_URL` points to AIMS `/api/v1/auth/sso/exchange`. SMART, ATLAS, and MRF must publish their exact backend exchange URLs through their corresponding configuration keys.

This is the same authorization-code pattern used by EnrollPro-to-AIMS SSO with the issuer and destination reversed: the source system authenticates its local user and issues a short-lived single-use code; the destination backend exchanges the code using a dedicated client secret, validates the minimized identity, and creates its own local session. Cookies, passwords, JWTs, and plaintext secrets are never shared between systems.

The companion must atomically consume the code and validate the code, client, audience, redirect URI, expiry, account state, and role before returning identity. Unknown, expired, replayed, or mismatched codes must share one public error.

### Canonical companion response

```json
{
  "success": true,
  "issuer": "AIMS",
  "identity": {
    "subject": "AIMS_USER:42",
    "employeeId": "1234501",
    "lrn": null,
    "accountName": "1234501",
    "email": "jose.rizal@example.edu.ph",
    "firstName": "Jose",
    "middleName": null,
    "lastName": "Rizal",
    "roles": ["SYSTEM_ADMIN"]
  },
  "activeSchoolYear": {
    "id": 1,
    "yearLabel": "2029-2030"
  },
  "authenticatedAt": "2026-09-07T10:00:15.000Z"
}
```

Rules:

- `issuer` must exactly match the source route.
- `identity.subject` is a stable, source-namespaced identifier and must never be recycled.
- At least one exact EnrollPro identifier must be present for first-time reconciliation: employee ID for staff or LRN for learners.
- `activeSchoolYear.id` is the mirrored EnrollPro school-year ID, not the companion's local database ID.
- The year ID and label must both match EnrollPro's authoritative active year.
- EnrollPro uses its local account roles for the resulting session. Companion roles cannot elevate EnrollPro permissions.

### Identity linking

EnrollPro first looks up `(companion, externalSubject)` in `CompanionIdentityLink`.

For a first successful reverse login only, EnrollPro may create the link when:

- the asserted employee ID or LRN resolves to exactly one EnrollPro user
- a staff employee ID may resolve through either the EnrollPro user record or its linked teacher profile
- first and last names match after whitespace and case normalization
- all supplied identifiers match that same account
- the EnrollPro account is active
- the account does not require a default-password change
- the learner is not a JHS completer
- the account has an EnrollPro staff-workspace role

No match produces `COMPANION_REVERSE_SSO_LINK_REQUIRED`. Conflicting identifiers, names, subjects, or existing links produce `COMPANION_REVERSE_SSO_IDENTITY_CONFLICT`.

After linking, every reverse login rechecks the current EnrollPro account and identifiers. EnrollPro creates its own session cookie and redirects according to its local roles.

## Authorization-Code Rules

- Generate 32 cryptographically random bytes and encode them as 43 base64url characters.
- Set expiry to 60 seconds after creation.
- Bind the code to one user and one destination companion.
- Store only a SHA-256 hash.
- Consume the code exactly once in a serializable transaction.
- Reject unknown, expired, consumed, and wrong-system codes with the same public error.
- Never retry the same code after an ambiguous network result.
- Never place the code anywhere except the short-lived callback query and exchange body.
- Remove the callback code from browser history immediately after local session creation.

## Companion Callback Implementation

Each companion must implement a browser callback and a backend exchange operation.

### Required callback

Recommended callback path:

```text
GET /auth/enrollpro/callback?code=<authorization-code>
```

The exact callback must match the EnrollPro server configuration. It must not support arbitrary forwarding URLs.

### Required controller responsibilities

The companion callback controller must:

1. Read the code without logging the complete request URL.
2. Validate the 43-character base64url shape.
3. Ensure the browser callback is processed once. React development double-mounts must not trigger duplicate exchanges.
4. Send the code from the companion backend to the matching EnrollPro exchange endpoint.
5. Authenticate with only that companion's SSO client secret.
6. Apply a strict timeout and treat ambiguous exchange results as consumed until the user starts again.
7. Validate the complete exchange response.
8. Require the `companion` field to match the receiving system.
9. Require at least one allowed role.
10. Map one EnrollPro subject to exactly one active local account.
11. Create the companion's own session only after every check succeeds.
12. Redirect to the appropriate local dashboard and remove the code from browser history.

### Required local account mapping

Use `identity.subject` as the stable external key:

```text
ENROLLPRO_USER:<positive-user-id>
```

Do not map accounts by name. Employee ID may support reconciliation but must not silently bind two accounts. If an old local account has no subject binding, require an administrator-approved one-time match before enabling SSO.

The mapping must enforce a unique pair of identity issuer and external subject. A single external subject must not resolve to multiple local accounts.

### Required local session

After successful mapping, each companion creates its own session using:

- HTTP-only cookie
- Secure flag in production
- an explicit SameSite policy compatible with its callback flow
- narrow cookie domain and path
- server-side expiration and revocation
- session fixation protection through ID rotation

The EnrollPro code and identity response must not become the companion session token.

## System-Specific Instructions

### AIMS

Use:

```text
AIMS_SSO_CALLBACK_URL
AIMS_SSO_CLIENT_SECRET
POST /api/auth/companion-sso/aims/exchange
AIMS_SSO_REVERSE_AUTHORIZE_URL
AIMS_SSO_REVERSE_EXCHANGE_URL
AIMS_SSO_REVERSE_CLIENT_ID
AIMS_SSO_REVERSE_CLIENT_SECRET
GET /api/auth/companion-sso/aims/reverse/start
```

AIMS accepts these EnrollPro roles:

- `SYSTEM_ADMIN`
- `HEAD_REGISTRAR`
- `TEACHER`
- `CLASS_ADVISER`

AIMS must route users to its own role-specific dashboard. SSO does not grant AIMS permission to change EnrollPro enrollment, promotion, school-year, or section records. AIMS retains ownership of interventions and learning activity.

The AIMS callback must retain its existing duplicate-exchange protection. A consumed code must produce a clean `Start again from EnrollPro` state.

For AIMS-to-EnrollPro, AIMS must implement `/auth/enrollpro/authorize` and the backend exchange endpoint configured in `AIMS_SSO_REVERSE_EXCHANGE_URL` (currently AIMS `/api/v1/auth/sso/exchange`). Its Integrated Systems sidebar must use EnrollPro's `/aims/reverse/start` URL rather than linking directly to an EnrollPro dashboard.

### SMART

Use:

```text
SMART_SSO_CALLBACK_URL
SMART_SSO_CLIENT_SECRET
POST /api/auth/companion-sso/smart/exchange
SMART_SSO_REVERSE_AUTHORIZE_URL
SMART_SSO_REVERSE_EXCHANGE_URL
SMART_SSO_REVERSE_CLIENT_ID
SMART_SSO_REVERSE_CLIENT_SECRET
GET /api/auth/companion-sso/smart/reverse/start
```

SMART accepts these EnrollPro roles:

- `SYSTEM_ADMIN`
- `HEAD_REGISTRAR`
- `TEACHER`
- `CLASS_ADVISER`

SMART must route the user to its own administrator, registrar, teacher, or adviser workspace. SSO does not replace the SMART grade API or SMART SSE integration. SMART remains authoritative for grades, subject results, promotion outcomes, and attendance.

The SSO secret must be distinct from `SMART_API_KEY` and every grade synchronization credential.

For SMART-to-EnrollPro, SMART must implement the reverse authorization and exchange endpoints. Its Integrated Systems sidebar must use EnrollPro's `/smart/reverse/start` URL.

### ATLAS

Use:

```text
ATLAS_SSO_CALLBACK_URL
ATLAS_SSO_CLIENT_SECRET
POST /api/auth/companion-sso/atlas/exchange
ATLAS_SSO_REVERSE_AUTHORIZE_URL
ATLAS_SSO_REVERSE_EXCHANGE_URL
ATLAS_SSO_REVERSE_CLIENT_ID
ATLAS_SSO_REVERSE_CLIENT_SECRET
GET /api/auth/companion-sso/atlas/reverse/start
```

ATLAS accepts these EnrollPro roles:

- `SYSTEM_ADMIN`
- `HEAD_REGISTRAR`
- `TEACHER`
- `CLASS_ADVISER`

ATLAS must route the user to its own schedule workspace. SSO does not replace faculty, section, adviser, schedule, or SF7 integration contracts. ATLAS remains authoritative for teaching loads and schedules.

The SSO secret must be distinct from ATLAS feed and schedule-publication credentials.

For ATLAS-to-EnrollPro, ATLAS must implement the reverse authorization and exchange endpoints. Its Integrated Systems sidebar must use EnrollPro's `/atlas/reverse/start` URL.

### MRF

Use:

```text
MRF_SSO_CALLBACK_URL
MRF_SSO_CLIENT_SECRET
POST /api/auth/companion-sso/mrf/exchange
MRF_SSO_REVERSE_AUTHORIZE_URL
MRF_SSO_REVERSE_EXCHANGE_URL
MRF_SSO_REVERSE_CLIENT_ID
MRF_SSO_REVERSE_CLIENT_SECRET
GET /api/auth/companion-sso/mrf/reverse/start
```

MRF accepts only:

- `SYSTEM_ADMIN`
- `MRF`

MRF remains disabled in the EnrollPro catalog until both callback and secret are valid. MRF owns final routing to its maintenance workspace. SSO does not expose broad learner data and does not transfer maintenance records into EnrollPro.

The SSO secret must be distinct from the minimized MRF identity-feed key.

For MRF-to-EnrollPro, MRF must implement the reverse authorization and exchange endpoints. A linked active `MRF` account receives an EnrollPro session and lands on `/my-activity`; system administrators land on `/dashboard`. MRF access does not grant registrar, learner-record, or teacher-workspace permissions.

## Configuration Requirements

EnrollPro requires two outbound and four reverse-flow server-only settings per companion:

```text
AIMS_SSO_CALLBACK_URL=<exact AIMS callback>
AIMS_SSO_CLIENT_SECRET=<distinct random secret, at least 32 characters>
AIMS_SSO_REVERSE_AUTHORIZE_URL=<exact AIMS authorization endpoint>
AIMS_SSO_REVERSE_EXCHANGE_URL=<exact AIMS backend exchange endpoint>
AIMS_SSO_REVERSE_CLIENT_ID=enrollpro
AIMS_SSO_REVERSE_CLIENT_SECRET=<distinct reverse secret, at least 32 characters>

SMART_SSO_CALLBACK_URL=<exact SMART callback>
SMART_SSO_CLIENT_SECRET=<distinct random secret, at least 32 characters>
SMART_SSO_REVERSE_AUTHORIZE_URL=<exact SMART authorization endpoint>
SMART_SSO_REVERSE_EXCHANGE_URL=<exact SMART backend exchange endpoint>
SMART_SSO_REVERSE_CLIENT_ID=enrollpro
SMART_SSO_REVERSE_CLIENT_SECRET=<distinct reverse secret, at least 32 characters>

ATLAS_SSO_CALLBACK_URL=<exact ATLAS callback>
ATLAS_SSO_CLIENT_SECRET=<distinct random secret, at least 32 characters>
ATLAS_SSO_REVERSE_AUTHORIZE_URL=<exact ATLAS authorization endpoint>
ATLAS_SSO_REVERSE_EXCHANGE_URL=<exact ATLAS backend exchange endpoint>
ATLAS_SSO_REVERSE_CLIENT_ID=enrollpro
ATLAS_SSO_REVERSE_CLIENT_SECRET=<distinct reverse secret, at least 32 characters>

MRF_SSO_CALLBACK_URL=<exact MRF callback>
MRF_SSO_CLIENT_SECRET=<distinct random secret, at least 32 characters>
MRF_SSO_REVERSE_AUTHORIZE_URL=<exact MRF authorization endpoint>
MRF_SSO_REVERSE_EXCHANGE_URL=<exact MRF backend exchange endpoint>
MRF_SSO_REVERSE_CLIENT_ID=enrollpro
MRF_SSO_REVERSE_CLIENT_SECRET=<distinct reverse secret, at least 32 characters>
```

### Token and integration key purposes

The following names identify server-side credentials. Documentation and logs may name the configuration key, but must never contain its actual value.

| System | EnrollPro-issued code exchange | Companion-issued code exchange | Non-SSO integration key |
| --- | --- | --- | --- |
| AIMS | `AIMS_SSO_CLIENT_SECRET` | `AIMS_SSO_REVERSE_CLIENT_SECRET` | `AIMS_API_KEY` |
| SMART | `SMART_SSO_CLIENT_SECRET` | `SMART_SSO_REVERSE_CLIENT_SECRET` | `SMART_API_KEY` |
| ATLAS | `ATLAS_SSO_CLIENT_SECRET` | `ATLAS_SSO_REVERSE_CLIENT_SECRET` | `ATLAS_API_KEY` |
| MRF | `MRF_SSO_CLIENT_SECRET` | `MRF_SSO_REVERSE_CLIENT_SECRET` | `MRF_INTEGRATION_API_KEY` |

- `*_SSO_CLIENT_SECRET` authenticates a companion backend when it exchanges a code issued by EnrollPro.
- `*_SSO_REVERSE_CLIENT_SECRET` authenticates EnrollPro when it exchanges a code issued by that companion.
- The API keys authenticate non-SSO data feeds or domain integrations only. They must never authorize an SSO exchange.
- Every outbound SSO secret, reverse SSO secret, and non-SSO API key must be independently generated and independently rotatable.

`ENROLLPRO_PUBLIC_URL` is also required so EnrollPro can construct a fixed reverse callback. The reverse authorization and exchange URLs for one companion must use the same origin. Outbound and reverse secrets are different credentials.

Callback validation requires:

- HTTPS outside local development
- no embedded username or password
- no URL fragment
- a valid absolute URL
- HTTP permitted only for `localhost` or `127.0.0.1` outside production

Secrets must:

- contain at least 32 characters
- be random and unique per companion
- not look like an example or placeholder
- exist only in server-side secret storage
- support a documented rotation procedure
- never be reused for APIs, JWT signing, SSE, grade sync, schedule sync, or password changes

## Error and Recovery Contract

### Validation error

A malformed code returns HTTP `400`:

```json
{
  "message": "Validation failed",
  "errors": {
    "code": ["Authorization code is invalid"]
  }
}
```

### Application errors

| HTTP | Code | Companion UI behavior |
| ---: | --- | --- |
| `401` | `COMPANION_SSO_CLIENT_INVALID` | Show service configuration error; do not retry with the same secret automatically |
| `401` | `COMPANION_SSO_CODE_INVALID` | Show `This sign-in link expired or was already used. Start again.` |
| `401` | `COMPANION_SSO_ACCOUNT_UNAVAILABLE` | Deny session creation and direct the user to an EnrollPro administrator |
| `403` | `COMPANION_SSO_ROLE_DENIED` | Show `You do not have access to this system.` |
| `403` | `COMPANION_SSO_COMPLETER_BLOCKED` | Do not open an active operational workspace |
| `403` | `COMPANION_SSO_IDENTITY_INCOMPLETE` | Direct the user to EnrollPro account correction |
| `404` | `COMPANION_SSO_SYSTEM_NOT_FOUND` | Treat as configuration or version mismatch |
| `409` | `ACTIVE_SCHOOL_YEAR_REQUIRED` | Do not create a session for an operational dashboard |
| `409` | `ACTIVE_SCHOOL_YEAR_CONFLICT` | Stop and require EnrollPro administrator correction |
| `428` | `PASSWORD_CHANGE_REQUIRED` | Route through EnrollPro password change, then start a fresh launch |
| `503` | `COMPANION_SSO_NOT_CONFIGURED` | Disable the sidebar item and show configuration guidance |
| `503` | `COMPANION_SSO_UNREACHABLE` | Preserve the current page and allow a later manual retry |
| `429` | `COMPANION_SSO_RATE_LIMITED` | Disable repeated clicks briefly and show a retry-later message |

Do not parse user-facing messages as control logic. Use HTTP status and stable error code.

### Reverse-flow errors

Reverse callback failures clear the state cookie and redirect to:

```text
/personnel/login?ssoError=<stable-code>&source=<companion>
```

The login page converts the stable code into a plain message and removes the query from browser history.

| Code | Meaning |
| --- | --- |
| `COMPANION_REVERSE_SSO_NOT_CONFIGURED` | Required reverse endpoints or credentials are missing or invalid |
| `COMPANION_REVERSE_SSO_CALLBACK_INVALID` | Callback code or state is malformed |
| `COMPANION_REVERSE_SSO_STATE_INVALID` | Signed state is expired, altered, source-mismatched, or does not match the HTTP-only cookie |
| `COMPANION_REVERSE_SSO_CODE_INVALID` | Companion rejected the one-time code as unknown, expired, replayed, or mismatched |
| `COMPANION_REVERSE_SSO_UNAVAILABLE` | Companion exchange could not complete; the same code is not retried |
| `COMPANION_REVERSE_SSO_RESPONSE_INVALID` | Companion returned malformed data or the wrong issuer |
| `COMPANION_REVERSE_SSO_ACCESS_DENIED` | Companion account cannot authenticate to EnrollPro |
| `COMPANION_REVERSE_SSO_LINK_REQUIRED` | No unique EnrollPro account can be reconciled |
| `COMPANION_REVERSE_SSO_IDENTITY_CONFLICT` | Subject, identifiers, names, or an existing link conflict |
| `COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE` | Linked EnrollPro account is inactive or missing |
| `COMPANION_REVERSE_SSO_ROLE_DENIED` | Linked user has no EnrollPro staff-workspace role |
| `COMPANION_REVERSE_SSO_COMPLETER_BLOCKED` | Linked learner is a JHS completer |
| `COMPANION_REVERSE_SSO_SCHOOL_YEAR_MISMATCH` | Companion's mirrored EnrollPro year does not exactly match the current EnrollPro year |

## School-Year Behavior

The exchange response includes the current EnrollPro school-year ID and label. The destination must:

- display the supplied current-year context after reconciling it with its local data
- never show an old year as current while reconciliation is pending
- keep archived data read-only
- show a clear synchronization state if local year context is stale
- avoid creating grades, schedules, interventions, or maintenance records solely because SSO succeeded

SSO is allowed only when EnrollPro can resolve one authoritative active year. The exchange fails closed when the active-year pointer is missing or conflicts with active rows.

Reverse SSO additionally requires the companion to return the mirrored EnrollPro school-year ID and label. A companion-local school-year primary key must not be placed in this field.

## Audit and Privacy

EnrollPro records:

- successful launch
- denied launch and non-sensitive reason
- successful exchange
- denied or replayed exchange and non-sensitive reason
- destination companion
- active school-year ID on successful exchange
- successful reverse login and source companion
- denied reverse login and stable non-sensitive reason
- request metadata such as IP address and user agent where applicable

No system may log:

- plaintext authorization code
- full callback URL containing the code
- SSO client secret
- EnrollPro password
- EnrollPro JWT or session cookie
- complete identity exchange payload
- destination session token
- companion-issued reverse code and signed state value

Companions may audit the EnrollPro subject, mapped local account ID, destination, timestamp, result, and stable non-sensitive error code.

## Sign-Out Behavior

Sign-out is local today:

- signing out of AIMS ends only the AIMS session
- signing out of SMART ends only the SMART session
- signing out of ATLAS ends only the ATLAS session
- signing out of MRF ends only the MRF session
- signing out of EnrollPro ends only the EnrollPro session

Do not claim global logout until a central identity provider and coordinated logout protocol are implemented.

## Accessibility and Responsive Requirements

- Every sidebar button must have an accessible name containing the system name.
- Disabled reasons must be available through tooltip and screen-reader text.
- Loading state must be announced without repeatedly interrupting assistive technology.
- Icons must not be the only identification mechanism in expanded mode.
- Collapsed mode must expose system names through tooltips.
- Keyboard users must be able to reach every enabled item and activate it with standard controls.
- Focus must remain visible.
- On mobile, close the navigation drawer only after the launch request succeeds or the browser begins navigation.
- Do not allow long descriptions to overlap or clip adjacent controls.

## Implementation Sequence

### Outbound EnrollPro-to-companion flow

1. Confirm the role matrix and local role mapping.
2. Register the exact HTTPS callback.
3. Provision a unique SSO client secret through a secure channel.
4. Apply the EnrollPro authorization-code migration during an approved deployment window.
5. Implement the companion callback controller and strict response schema.
6. Add unique external-subject mapping to the companion account model.
7. Implement companion-owned secure session creation.
8. Add role-specific destination routing.
9. Add the Integrated Systems sidebar states.
10. Test launch, exchange, replay, expiry, role denial, account deactivation, and school-year conflict.
11. Enable the EnrollPro-originated item after verification.

### Reverse companion-to-EnrollPro flow

1. Apply the `companion_identity_links` migration during an approved deployment window.
2. Configure `ENROLLPRO_PUBLIC_URL`.
3. Configure the source's reverse authorization URL, exchange URL, client ID, and unique reverse secret.
4. Implement the companion authorization endpoint with local-session validation and fixed redirect registration.
5. Implement the companion exchange endpoint with hashed, 60-second, audience-bound, single-use codes.
6. Return the strict reverse identity assertion and mirrored EnrollPro school-year ID.
7. Add the EnrollPro item to the companion's Integrated Systems sidebar using the EnrollPro `reverse/start` URL.
8. Verify first-time identity linking and subsequent subject-based lookup.
9. Test state tampering, code replay, issuer mismatch, account deactivation, role change, and year mismatch.
10. Enable the reverse EnrollPro item only after all checks pass.
11. Keep direct companion-to-companion items disabled until Phase 3 federation is available.

### Phase 3 federation

1. Select and approve the central OpenID Connect provider.
2. Define the canonical issuer-neutral subject and role claims.
3. Register every system as a separate client.
4. Implement Authorization Code Flow with PKCE in every system.
5. Define session duration, reauthentication, account disablement, and logout behavior.
6. Migrate existing EnrollPro subject mappings without creating duplicate users.
7. Run cross-system navigation and security testing.
8. Enable companion-to-companion sidebar actions only after all relying parties pass acceptance.

## Acceptance Tests

### Sidebar

- The Integrated Systems group appears in the correct location.
- Only role-eligible systems are visible.
- The host system is marked current and is not clickable.
- Unconfigured systems are disabled with a clear reason.
- Only the selected item shows a spinner.
- Repeat clicks cannot create parallel launches.
- Unsaved work is protected before navigation.
- The browser navigates in the same tab after launch succeeds.
- Mobile, collapsed, keyboard, and screen-reader behavior works.

### Security

- Codes contain 43 valid base64url characters.
- Codes expire after 60 seconds.
- The same code succeeds only once.
- Concurrent exchange attempts produce one success.
- An AIMS code fails on SMART, ATLAS, and MRF exchange routes.
- Missing or wrong companion secrets fail.
- Inactive users, default-password users, unsupported roles, JHS completers, and incomplete identities fail.
- Active-school-year conflicts fail closed.
- Redirect URIs cannot be supplied by the browser.
- No code, secret, password, JWT, cookie, or session token appears in logs.

### Companion behavior

- Each companion validates `companion` against its own system name.
- One EnrollPro subject maps to exactly one local active account.
- A local session is created only after all validation succeeds.
- The callback code is removed from browser history.
- React StrictMode or callback remounting cannot cause a second exchange.
- Ambiguous network failures never resend the same code.
- Role-specific dashboard routing works.
- Local sign-out does not falsely claim global sign-out.

### Reverse flow

- The companion sidebar starts at EnrollPro's source-specific `reverse/start` route.
- EnrollPro sets the state cookie before redirecting to the companion authorization endpoint.
- Altered, missing, expired, or cross-source state is rejected.
- The companion code contains 43 base64url characters, expires within 60 seconds, and succeeds once.
- EnrollPro sends the code only from its backend and never retries an ambiguous exchange.
- The companion response issuer matches the route source.
- The mirrored EnrollPro school-year ID and label both match.
- First-time linking requires one exact employee ID or LRN match and matching first and last names.
- Conflicting links never change ownership automatically.
- The EnrollPro session contains current EnrollPro roles rather than companion-supplied privileges.
- Administrators and registrars land on `/dashboard`.
- Teachers and class advisers land on `/teacher/advisory`.
- Reverse errors return to `/personnel/login` with no code or state in the URL.

### Cross-companion federation readiness

- Direct companion-to-companion items remain disabled before Phase 3.
- No system uses another system's cookie or JWT as a shortcut.
- Every future cross-system launch validates issuer, audience, state, nonce, PKCE, expiry, and signature.
- Account deactivation takes effect across newly created sessions according to the approved federation policy.

## Prohibited Implementations

Do not implement any of the following:

- cross-domain sharing of EnrollPro cookies
- SSO by placing employee ID, LRN, role, or name in a URL
- browser-side use of an SSO client secret
- exchange requests directly from browser JavaScript
- reusable authorization codes
- retrying a possibly consumed code
- one shared secret for all companions
- reuse of grade, schedule, SSE, feed, JWT, or password-change keys
- automatic local-account creation without an approved identity-matching policy
- companion database access to EnrollPro tables
- direct dashboard links presented as authenticated SSO
- undocumented acceptance of arbitrary companion JWTs
- reverse callbacks that omit signed state and HTTP-only cookie matching
- automatic relinking when a companion subject conflicts with an existing user

## Related Documents

- [EnrollPro Microservice Architecture](../../../ARCHITECTURE_MICROSERVICES.md)
- [EnrollPro Companion SSO Flow](ENROLLPRO-COMPANION-SSO-FLOW.md)
- [AIMS EnrollPro SSO](AIMS-ENROLLPRO-SSO.md)
- [SMART EnrollPro SSO](SMART-ENROLLPRO-SSO.md)
- [ATLAS EnrollPro SSO](ATLAS-ENROLLPRO-SSO.md)
- [MRF EnrollPro SSO](MRF-ENROLLPRO-SSO.md)
- [Response to AIMS SSO Questions](ENROLLPRO-RESPONSE-TO-AIMS-SSO.md)

## Final Implementation Rule

The EnrollPro sidebar may use the existing outbound one-time-code flow now. EnrollPro now implements the protected reverse start, callback, identity-link, and local-session flow. AIMS, SMART, ATLAS, and MRF must implement the documented reverse authorization and exchange endpoints before enabling their EnrollPro sidebar item. Direct companion-to-companion items remain disabled until Phase 3 central federation is implemented. Visual completion of a sidebar is not sufficient evidence that SSO is secure or operational.
