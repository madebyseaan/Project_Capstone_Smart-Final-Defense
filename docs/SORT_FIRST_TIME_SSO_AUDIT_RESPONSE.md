# SORT First-Time SSO Audit — SMART Team AI Response

**To:** SORT / MRF engineering
**From:** SMART team AI
**Reviewed:** `SORT_FIRST_TIME_SSO_AUDIT_FOR_SMART.md` (2026-10-25)
**Scope:** SORT login, first-time behavior, EnrollPro companion SSO, and the minimal safe implementation path

> **Verdict:** the audit is credible and evidence-rich. We accept its main findings. Two corrections change the implementation order: (1) SORT does not have an SSO route yet, so the 404 is the first SSO blocker; (2) the evidence suggests the “first-time verification” is EnrollPro's `mustChangePassword` / `requiresPasswordReset` flag, not a separate SORT verification subsystem. Confirm that definition before building a new verification system.

---

## 0. Summary

1. **Confirmed:** SORT has no EnrollPro companion SSO routes. `GET /api/auth/enrollpro/callback` returns 404 because no handler exists.
2. **Confirmed and urgent:** SORT receives EnrollPro's default-password flags but still issues a full session. This is a real pre-existing auth bug, independent of SSO.
3. **Clarify before building:** “first-time verification” may mean the EnrollPro default-password flag. If so, SORT needs a password-change gate, not a new verification subsystem.
4. **Correction:** SMART does not enforce `mustChangePassword` either. SMART's `PASSWORD_CHANGE_REQUIRED` is part of the shared error vocabulary but is not emitted by its current services. Do not use SMART's omission as approval.
5. **Correction:** do not copy SMART's cookie session model blindly. SORT's Bearer-token model can remain, but it needs separate hardening: hash refresh tokens, add reuse detection, and re-check account status.
6. **Missing prerequisite:** the audit's proposed SSO flow omits EnrollPro's `activeSchoolYear` validation and SORT's token handoff from callback to SPA. Both are required.

---

## 1. Findings we confirm

| Audit finding | Verdict | Note |
|---|---|---|
| No `companion-sso` callback, bootstrap, authorize, or exchange routes | Confirmed | The 404 is definitive for the paths probed. A valid 43-char code would also fail if no route exists. |
| No first-time verification state | Confirmed | Only `AccountStatus` exists. |
| `mustChangePassword` / `requiresPasswordReset` is not enforced | Confirmed | Full access + refresh session is issued anyway. Fix this first. |
| No `externalSubject`; `enrollproId` is a synthetic sync key | Confirmed | Do not use `enrollproId` as the canonical SSO subject. |
| Sync role mapping is broad and defaults unknown to `TEACHER` | Confirmed | Do not reuse it for SSO. Add an exact allowlist. |
| No httpOnly cookies, no refresh-token family/reuse detection, no per-request DB status check, no general login audit | Confirmed | These are real gaps, but they are session-hardening work, not SSO prerequisites. |
| Offline password fallback can issue a 24-hour session | Confirmed | Keep it as a deliberate password-login policy decision; never use it for SSO. |
| Plan/code contradictions (`PASSWORD_CHANGE_REQUIRED`, `requiresPasswordReset`, local password storage, expiry env vars) | Confirmed | Resolve the docs and code in the same change. |

---

## 2. Corrections and clarifications

### 2.1 “First-time verification” may be EnrollPro's default-password flag

The audit found no SORT verification state, no OTP/email/admin-approval flow, and no verification endpoints. The only first-login signal is EnrollPro's `mustChangePassword` (staff) / `requiresPasswordReset` (learner).

Therefore:

- If MRF means **“first login must change the default password,”** the fix is a **password-change gate**, not a new verification subsystem.
- If MRF means **email verification, OTP, document upload, or admin approval,** then SORT needs a separate verification state and ticket.

Ask MRF to confirm before implementing. Building both would be unnecessary scope.

### 2.2 SMART does not enforce `mustChangePassword` either

SMART's current login route does not check `mustChangePassword`; it has no self-service password-change endpoint; and `PASSWORD_CHANGE_REQUIRED` is defined in `server/src/lib/companionSso.ts:48` but is not emitted by the current SSO services. SORT should follow the **contract**, not SMART's current omission.

The handoff's §6 verification pattern is a generic safe design for a separate first-time verification requirement. It is not evidence that SORT has one.

### 2.3 A local verification ticket cannot fix `mustChangePassword`

SORT delegates passwords to EnrollPro. It has no local password-change endpoint. A restricted SORT ticket could gate SORT features, but it cannot change the EnrollPro password.

On `mustChangePassword` / `requiresPasswordReset`, the correct minimal behavior is:

```http
HTTP/1.1 403 Forbidden

{
  "error": "Password change required",
  "code": "PASSWORD_CHANGE_REQUIRED",
  "passwordChangeUrl": "<EnrollPro password-change URL>"
}
```

Then the user changes the password in EnrollPro and logs in again. Do **not** issue a SORT access token or refresh token while the default password is still in use.

If MRF wants an in-app password change, SORT needs an EnrollPro password-change API to call. That is an EnrollPro contract question, not a SORT-only change.

### 2.4 Missing CSRF is not automatically a bug in SORT's current model

SORT uses `Authorization: Bearer` tokens and `credentials: false`; there are no cookies for business APIs. In that model, classic CSRF is not the primary risk. The bigger risks are:

- refresh token in `localStorage` (XSS/persistence),
- refresh token stored plaintext in the database,
- no reuse/family detection,
- no per-request status check.

If SORT adds a cookie for the SSO bootstrap handoff, then add `SameSite`/Origin checks and CSRF protection for cookie-authenticated routes. Do not add CSRF middleware just for parity while the API remains Bearer-only.

### 2.5 `enrollproId` is not the SSO subject

Add a dedicated `externalSubject` column and bind EnrollPro's `identity.subject` (for example `ENROLLPRO_USER:<id>`). Use `employeeId` (staff) or `lrn` (learner, if a learner SSO contract ever exists) only for first-login reconciliation.

`enrollproId` values like `learner-…`, `faculty-…`, `staff-…` are sync keys. They may be useful as a secondary hint, but they are not the canonical subject and must not be parsed as one.

### 2.6 The audit's proposed callback-to-SPA handoff is incomplete

SORT uses Bearer JSON, not cookies. If the callback “issues a session,” the access and refresh tokens must reach the SPA somehow. Do **not** put them in a redirect URL.

Use one of these:

1. **Recommended:** the callback sets a short-lived `httpOnly` `sso_bootstrap` cookie (random one-time ticket, hashed at rest), redirects to the SPA, and the SPA calls `POST /api/auth/enrollpro/session` with credentials. The bootstrap endpoint re-checks status/verification and returns the SORT access + refresh tokens.
2. **No-cookie alternative:** the callback redirects with a one-time `bootstrapTicket` in the URL; the SPA posts it to the bootstrap endpoint, which consumes it and returns tokens. Use a short TTL, hash at rest, single use, `Referrer-Policy: no-referrer`, and remove it from browser history.

Never forward the EnrollPro authorization code to the SPA URL, and never put the SORT access token or refresh token in any URL. The code arrives in the server callback URL by design; it must stop there.

### 2.7 Active school year is missing from the audit's flow

The companion exchange returns:

```json
"activeSchoolYear": { "id": 1, "yearLabel": "2029-2030" }
```

SORT must validate that `id` and `yearLabel` match its own active school year, mirrored from EnrollPro. If SORT has no `SchoolYear.externalId` (or equivalent), add one or store the active EnrollPro year ID in settings. Otherwise:

- no active year → `ACTIVE_SCHOOL_YEAR_REQUIRED`
- mismatched year → `ACTIVE_SCHOOL_YEAR_CONFLICT`
- no session in either case

The audit's proposed flow omits this prerequisite. Do not add SSO routes without it.

### 2.8 SSO role mapping must be exact, not the sync mapper

The sync `mapRole` uses substring matching, maps `HEAD_REGISTRAR`/`REGISTRAR` to `ADMIN`, and defaults unknown roles to `TEACHER`. That is too broad for SSO.

For MRF companion SSO, use:

| EnrollPro role | SORT role | Action |
|---|---|---|
| `SYSTEM_ADMIN` | `ADMIN` | Allow only if the local account is already `ADMIN` |
| `MRF` | `MRF` | Allow only if the local account is already `MRF` |
| `HEAD_REGISTRAR`, `SCHOOL_REGISTRAR`, `REGISTRAR`, `REGISTRATION_OFFICER` | — | Deny |
| `TEACHER`, `CLASS_ADVISER` | — | Deny |
| `LEARNER` | — | Deny; use `/learner/auth` |
| Unknown | — | Deny |

Rules:

- Normalize the role list to uppercase and test exact membership, not `includes`.
- The local role is authoritative. SSO must not auto-promote.
- If the assertion role and local role disagree, return `ROLE_NOT_ALLOWED` or require admin approval.
- Do not apply `ENROLLPRO_ROLE_OVERRIDES` to SSO.

### 2.9 Name reconciliation with SORT's single `name` field

SORT has `User.name`, not `firstName`/`lastName`. Build a normalized full name from the assertion's `firstName`, `middleName`, and `lastName`, and compare it to the normalized `User.name`.

- `employeeId` is the primary first-login key for staff.
- Supplied names must agree; missing names on either side do not disprove the match.
- If names disagree, deny or require admin review. Do not auto-bind on a weak match.

### 2.10 Check more than `SUSPENDED`

The audit's proposed flow checks only `accountStatus`. SSO must also check:

- `syncSource === 'ENROLLPRO'` (unless MRF explicitly allows local accounts),
- `archivedAt` is null,
- `portalAccountActive` is true,
- for students, `enrollmentStatus` is active and not alumni,
- the local role matches the assertion role.

### 2.11 `mustChangePassword` at the SSO exchange

The public companion exchange response documented in `docs/COMPANION-SSO-INTEGRATION-GUIDE.md` §5.3 does **not** include `mustChangePassword` or `requiresPasswordReset`. If EnrollPro does not enforce the default-password rule at exchange, SORT cannot know about it from the assertion.

Ask EnrollPro to either:

- reject the exchange with `PASSWORD_CHANGE_REQUIRED` for default-password users, or
- include a verified `mustChangePassword` / `requiresPasswordReset` flag in the assertion.

Until then, SORT cannot enforce the flag for SSO users.

### 2.12 In-memory guard is acceptable today, but use DB state

SORT runs one PM2 fork today, so an in-memory processed-code set works. It does not survive restarts and will break under future scale. For Flow A, EnrollPro owns the authorization code; SORT only needs an idempotency record. For Flow B, a `CompanionSsoCode` table is required. Do not store security state only in memory.

---

## 3. Answers to the audit's §9 questions

1. **Is `enrollproId` sufficient as an SSO subject?**
   No. Add `externalSubject` unique nullable; bind `identity.subject`. Use `employeeId`/`lrn` only for first-login reconciliation.

2. **Should SORT use companion SSO at all?**
   For staff, yes if MRF wants it. For students, no — keep `/learner/auth` until EnrollPro defines a learner SSO contract. If MRF's immediate pain is default passwords, fix the password gate first; SSO can follow.

3. **Which assertion fields should SORT bind on first login?**
   `identity.subject` (stable), `identity.employeeId` (staff), exact `identity.roles`, and `activeSchoolYear.id` + `yearLabel`. Use names only for reconciliation. Do not bind `userId` or `lrn` for staff; `lrn` is null in staff assertions. Store the EnrollPro numeric user ID as a secondary key if useful, but bind `subject`.

4. **How should `SYSTEM_ADMIN` and `MRF` map to local roles?**
   `SYSTEM_ADMIN` → `ADMIN`; `MRF` → `MRF`. Reject all other roles. The local account must already have the matching role. Do not auto-promote, do not use substring matching, and do not apply env overrides.

5. **Should first-time verification be staff-only or also students?**
   Clarify with MRF. If it means `mustChangePassword`/`requiresPasswordReset`, gate both staff and learner password logins. If it is a separate verification, start staff-only; students keep EnrollPro's password-reset flow.

6. **What if MRF uses a shared Admin/MRF account?**
   Reject SSO for it or explicitly mark it as a shared/kiosk account. A single `externalSubject` binding cannot represent multiple humans, and per-user audit becomes impossible. Recommended: one SORT account per staff member.

7. **What is the exact callback URL and test identity?**
   Need the exact `SORT_SSO_CALLBACK_URL` configured in EnrollPro and the identity/role EnrollPro sent. If it was `/api/auth/enrollpro/callback`, the 404 is definitive. Note: the audit's probe used `code=test`, which is not a valid 43-char code; a working route would have returned 400/401, not 404.

8. **Does verification come before SSO?**
   Fix the password gate first; it is a pre-existing auth bug. Then add SSO. The 404 is the first SSO-specific blocker; the unenforced default-password flag is the first first-time-login blocker.

---

## 4. Minimal safe implementation plan

### Phase 0 — Decide the requirement

- Is “first-time verification” the EnrollPro default-password flag, or a separate SORT verification?
- If separate: method, state, approver, staff vs students.
- Get the EnrollPro password-change URL/endpoint.
- Get the exact EnrollPro SSO callback configuration and test identity.
- Confirm SORT's school-year model and external ID.

### Phase 1 — Fix the password login gate (P0, no SSO needed)

- On `mustChangePassword` / `requiresPasswordReset`: clear the cached offline password, do not issue a session, return `403 PASSWORD_CHANGE_REQUIRED` with a `passwordChangeUrl` to EnrollPro.
- Apply to staff `/auth/login` and learner `/learner/auth`.
- Frontend: handle the code, show a plain message, link to EnrollPro password change, then re-login.
- Add audit records for blocked logins.
- Add tests for staff and learner flags.

### Phase 2 — Add verification state only if the requirement is separate

- Add `verificationStatus` (`PENDING`, `VERIFIED`, `FAILED`, `EXPIRED`), `verificationMethod`, `verifiedAt`, `verifiedBy`.
- Keep `AccountStatus` for suspension; do not overload it.
- Add `verification_tickets` (hashed token, TTL, single-use, bound to account + subject + method).
- Add a shared `finishLogin(account, identitySource)` gate used by password and SSO.
- Add verify/resend/cancel endpoints scoped only to verification.
- Do not mark all existing synced accounts as unverified by default; migration needs an explicit policy.

### Phase 3 — Flow A SSO (staff)

- Add callback + exchange + session bootstrap.
- Resolve by `externalSubject` first, then `employeeId` + name + `syncSource`.
- No auto-create. Return `ACCOUNT_NOT_PROVISIONED`, trigger a sync, and let the user retry.
- Check status, archived, portal active, enrollment (students), role, school year.
- Enforce default-password gate.
- Enforce separate verification gate if it exists.
- Bind `externalSubject` atomically with a unique constraint and `P2002` handling.
- Hand off tokens via short-lived bootstrap cookie or one-time bootstrap ticket.
- Re-check status/verification at bootstrap and refresh.
- Add audit, rate limits, and stable error codes.
- Do not implement Flow B yet.

### Phase 4 — Session hardening (separate from SSO)

- Hash refresh tokens at rest.
- Add `familyId`, `revokedAt`, `replacedBy`; detect reuse and revoke the family.
- Add a DB status check (or short-TTL cache) in middleware or at least on sensitive routes.
- Add login/SSO audit fields: `actorId`, `result`, `severity`, `code`.
- Add SSO rate limits.
- Address refresh-token storage in `localStorage` (XSS) and add a CSP; consider httpOnly refresh cookies later.

### Phase 5 — Tests

Use the handoff §8 plus the extra cases in §9 below.

---

## 5. Corrected first-time SSO flow for SORT

```text
EnrollPro -> GET /api/auth/enrollpro/callback?code=<43-char>&state=<opaque>
1. Validate code shape; rate-limit; claim the callback once in DB.
2. Exchange server-to-server with EnrollPro (Bearer outbound secret).
   Never exchange from browser JavaScript.
3. Validate:
   - success === true
   - companion/system matches SORT
   - identity.subject present
   - at least one allowed role
   - activeSchoolYear.id + yearLabel present
4. Resolve local User:
   a. externalSubject === identity.subject
   b. else employeeId exact + name reconcile + syncSource === ENROLLPRO
   c. no match -> 403 ACCOUNT_NOT_PROVISIONED; trigger sync; no auto-create
5. Check:
   - accountStatus === ACTIVE
   - archivedAt is null
   - portalAccountActive is true
   - enrollmentStatus (students only)
   - local role matches the assertion role
6. If mustChangePassword / requiresPasswordReset:
   -> redirect to EnrollPro password change; no SORT session.
7. If a separate verificationStatus != VERIFIED:
   -> issue a short-lived verification ticket; redirect to /verify; no SORT session.
8. Bind externalSubject atomically (unique + P2002 handling).
9. Issue a short-lived SORT bootstrap cookie/ticket (not the EnrollPro code,
   not the access token, not the refresh token); redirect to the SPA bootstrap.
10. SPA POST /api/auth/enrollpro/session:
    -> re-check status, role, school year, verification
    -> issue SORT access + refresh tokens
    -> store in the existing SORT session mechanism.
```

Why this shape:

- The EnrollPro code is consumed exactly once.
- The verification ticket is the continuation of the first-time flow.
- The bootstrap ticket is SORT-owned and short-lived.
- No secret or token appears in the URL.
- Account state is re-checked after the exchange.

---

## 6. Minimal data model for SORT

| Model / field | Change | Notes |
|---|---|---|
| `users.externalSubject` | Add `String? @unique` | Bind `identity.subject`; not `enrollproId`. |
| `users.verificationStatus` | Add enum nullable/default | Only if verification is separate. Existing synced users need an explicit migration policy. |
| `users.verificationMethod` | Add enum | `PASSWORD_SETUP`, `EMAIL`, `OTP`, `ADMIN_APPROVAL`, `NONE`. |
| `users.verifiedAt` / `verifiedBy` | Add | For audit. |
| `verification_tickets` | Add table | `id`, `userId`, `tokenHash @unique`, `method`, `expiresAt`, `consumedAt`, `createdAt`. |
| `sso_bootstrap_tickets` | Add table or cookie-only | `id`, `userId`, `tokenHash @unique`, `expiresAt`, `consumedAt`, `createdAt`. |
| `user_sessions` | Add `familyId`, `revokedAt`, `replacedBy` | Hash `refreshToken`; detect reuse. |
| `audit_logs` | Add `actorId`, `result`, `severity`, `code` | Login/SSO/verification events. |
| `school_years` | Ensure `externalId @unique` | Validate EnrollPro's `activeSchoolYear`. |

Do not add `PENDING_VERIFICATION` to `AccountStatus` if you keep verification separate. Suspension and verification are independent states.

---

## 7. What to copy from SMART, and what not to

| Copy | Do not copy |
|---|---|
| No auto-create on SSO; resolve to one existing account | Cookie-based session model, unless SORT deliberately adopts it |
| Subject-first binding, then exact identifier + name reconciliation | `enrollproSubject` naming (adapt to SORT) |
| Exact role allowlist; local role is authoritative | SMART's current lack of `mustChangePassword` enforcement |
| One-time code hashed at rest, short TTL, atomic consume | SMART's session storage details (SORT uses Bearer) |
| Callback/session split and post-exchange status re-check | Any assumption that SMART's role matrix is SORT's |
| Stable error codes and plain user messages | Logging secrets, codes, or identity payloads |
| Audit of login/SSO outcomes | Blind duplication of SMART's cookie/CSRF stack |

**Fix in SORT regardless of SSO:** plaintext refresh tokens, missing reuse detection, missing per-request status check, missing login audit, over-broad sync role mapping, and missing school-year validation.

---

## 8. Open questions for MRF / EnrollPro

1. Does “first-time verification” mean EnrollPro's `mustChangePassword` / `requiresPasswordReset`, or a separate SORT verification (email, OTP, document, admin approval)?
2. What is EnrollPro's exact password-change URL or API for staff and learners?
3. Does EnrollPro's companion SSO exchange reject default-password users with `PASSWORD_CHANGE_REQUIRED`, or include a flag in the assertion? The documented assertion does not.
4. What exact callback URL is configured in EnrollPro for SORT?
5. What test identity/role did EnrollPro send: `SYSTEM_ADMIN`, `MRF`, or a learner?
6. Does SORT have a `SchoolYear` model with EnrollPro's numeric `externalId`? If not, where will the active-year mirror live?
7. Is the shared “Admin MRF” account real in operations, or only a test convenience?
8. Do students need SSO, or should they remain on `/learner/auth`?
9. Are the SPA and API same-origin in production and development? This decides whether the SSO bootstrap cookie is feasible or whether a one-time URL ticket is needed.
10. If a bootstrap cookie is used, can SORT enable CORS credentials with an exact origin allowlist?
11. Is the offline cached-password fallback an approved policy, or should it be removed? It conflicts with the “no local password storage” document.
12. Is the audited commit `HEAD 926d0a9` the same build EnrollPro is configured to launch? If not, re-run the probes against the deployed host.

---

## 9. Additional acceptance tests

Add these to the handoff §8:

| # | Scenario | Expected |
|---:|---|---|
| 19 | Staff login with `mustChangePassword=true` | `403 PASSWORD_CHANGE_REQUIRED`; no token/cookie; `passwordChangeUrl` present |
| 20 | Learner login with `requiresPasswordReset=true` | Same gate; no token |
| 21 | SSO user with default password (if EnrollPro flags it) | No SORT session; redirect to EnrollPro password change |
| 22 | SSO user with no local account | `ACCOUNT_NOT_PROVISIONED`; sync triggered; retry succeeds after sync |
| 23 | SSO user with conflicting `externalSubject` | `IDENTITY_CONFLICT`; no session |
| 24 | SSO role mismatch (`SYSTEM_ADMIN` vs local `MRF`) | `ROLE_NOT_ALLOWED`; no session |
| 25 | SSO user archived / portal inactive / not enrolled | `ACCOUNT_UNAVAILABLE`; no session |
| 26 | SSO active school year mismatch | `ACTIVE_SCHOOL_YEAR_CONFLICT`; no session |
| 27 | Bootstrap ticket replay or expiry | `VERIFICATION_TICKET_INVALID` / `SSO_BOOTSTRAP_INVALID`; no session |
| 28 | Callback double-mount (React StrictMode) | Exactly one exchange |
| 29 | EnrollPro unreachable during SSO | Fail closed with `SSO_UNREACHABLE`; no fabricated session |
| 30 | Logs reviewed | No code, secret, token, cookie, or full identity payload |

---

## 10. Bottom line

- **Agree with the audit:** SORT has no SSO route, no verification state, and does not enforce the default-password flag. The 404 is not a verification bug.
- **Do not build a verification subsystem yet.** Confirm whether “verification” means the EnrollPro default-password flag. If yes, fix the password gate now.
- **Fix the password gate before SSO.** It is a pre-existing security bug and applies to staff and learner password logins.
- **Then add Flow A SSO** with `externalSubject`, exact role mapping, school-year validation, no auto-create, and a safe callback-to-SPA token handoff.
- **Keep students on `/learner/auth`** until EnrollPro defines a learner SSO contract.
- **Do not copy SMART's session model.** Harden SORT's Bearer model separately.
