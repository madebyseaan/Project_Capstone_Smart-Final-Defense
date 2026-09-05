# SMART EnrollPro SSO

Last reviewed: 2026-09-01

## Purpose

This contract lets an eligible EnrollPro user open SMART without entering another password. EnrollPro transfers a minimized identity assertion; SMART owns the resulting SMART session, grades, promotion outcomes, and attendance.

This is not cross-domain cookie sharing. SMART must never receive an EnrollPro password, JWT, or session cookie.

## EnrollPro Configuration

```text
SMART_SSO_CALLBACK_URL=https://configured-smart-host/auth/enrollpro/callback
SMART_SSO_CLIENT_SECRET=<distinct random secret of at least 32 characters>
```

The callback must use HTTPS outside local development. The secret must not be reused for grade synchronization, SMART SSE, or any other integration.

## SMART Callback Flow

1. Accept `GET /auth/enrollpro/callback?code=<authorization-code>` on the SMART server.
2. Read the code on the server. Do not exchange it from browser JavaScript.
3. Send `POST <ENROLLPRO_BASE_URL>/api/auth/companion-sso/smart/exchange` with `Authorization: Bearer <SMART_SSO_CLIENT_SECRET>` and the JSON body `{ "code": "<authorization-code>" }`.
4. Require `success: true`, `companion: "SMART"`, an active identity, at least one permitted role, and a valid active school-year object.
5. Map `identity.subject` as the stable external identifier. Reconcile the employee ID and name without changing EnrollPro-owned identity.
6. Create a SMART-owned HTTP-only, Secure, SameSite session cookie.
7. Remove the code from browser history by redirecting to the role dashboard.

## Role Routing

- `SYSTEM_ADMIN` redirects to `https://laptop-pfvh73qk.buru-degree.ts.net/admin`.
- `HEAD_REGISTRAR`, `TEACHER`, and `CLASS_ADVISER` redirect to the matching SMART workspace selected by SMART.
- All other roles are denied.

## Required Rejections

SMART must reject expired, replayed, wrong-system, malformed, inactive, default-password, JHS-completer, and unauthorized identities. A failed exchange must return the user to EnrollPro with a plain retry message; it must not retry the same code.

Do not log the callback query, authorization code, Bearer secret, identity payload, or session token. Security logs may retain the event result, EnrollPro subject, SMART account ID, time, and non-sensitive denial code.

Signing out of SMART ends only the SMART session. Coordinated logout is not part of this contract.
