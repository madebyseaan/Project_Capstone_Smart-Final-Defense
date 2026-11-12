# SMART ↔ AIMS SSO — SMART Implementation Report

**Date:** 2026-11-11
**From:** SMART
**To:** AIMS
**Status:** SMART code implemented and configured. Live joint testing completed; one AIMS-side TTL mismatch remains (see §7.1).
**Reference contract:** `SMART-SSO-HANDOFF.md` (AIMS, approved; Canto 22 / Canto 23)

---

## 1. Summary

SMART has implemented both directions of the SSO contract:

- **Part A — AIMS → SMART:** AIMS issues the one-time code; SMART redeems it server-to-server, creates its own SMART session, and deep-links the user.
- **Part B — SMART → AIMS:** SMART issues the one-time code; AIMS redeems it server-to-server and creates its own AIMS session.

No shared cookies, reused user JWTs, or identity data in URLs are used. SMART's data-sync `x-api-key` remains unchanged.

**Current runtime state:** the AIMS sidebar item is safely disabled because the shared secrets are not present in SMART's environment yet. It becomes active after the configuration in §10 is applied.

---

## 2. Part A — AIMS → SMART

### 2.1 Browser flow

```text
AIMS button
  -> GET http://100.93.66.120:5003/sso/aims?code=<opaque>
  -> SMART SPA calls POST /api/auth/aims/exchange  (same origin)
  -> SMART backend calls AIMS:
       POST AIMS_SSO_EXCHANGE_URL
       x-smart-client-id: smart
       x-smart-client-secret: <shared secret>
       { "code": "<opaque>" }
  -> SMART creates its own JWT + refresh session
  -> SMART redirects to the resolved landing page
```

The code is consumed by AIMS during the exchange. SMART never parses or trusts the code contents.

### 2.2 SMART-side endpoint

```http
POST /api/auth/aims/exchange
Content-Type: application/json

{ "code": "<opaque>" }
```

This endpoint is called by SMART's own SPA, not by AIMS. It is rate-limited and exempt from CSRF because it is under `/api/auth`.

**Success `200`:**

```json
{
  "success": true,
  "token": "<smart access JWT>",
  "refreshToken": "<smart refresh token>",
  "user": {
    "id": "<smart user id>",
    "username": "<smart username>",
    "role": "TEACHER",
    "firstName": "Janella Marie",
    "lastName": "Fernandez",
    "email": null
  },
  "redirectTo": "/teacher/records/<classAssignmentId>?term=T2"
}
```

**Failure shape:**

```json
{
  "success": false,
  "code": "AIMS_ACCOUNT_NOT_PROVISIONED",
  "error": "No SMART account matches this AIMS identity.",
  "identity": {
    "id": "8c1f0f7e-...",
    "role": "TEACHER",
    "firstName": "Janella Marie",
    "lastName": "Fernandez",
    "email": null,
    "username": "1000003",
    "lrn": null
  }
}
```

The optional `identity` block is returned for provisioning failures so the user can see which AIMS identity needs linking. It is never created automatically.

### 2.3 AIMS exchange request made by SMART

```http
POST http://100.92.245.14:5000/api/v1/integrations/smart/sso/exchange
Content-Type: application/json
x-smart-client-id: smart
x-smart-client-secret: <shared secret>

{ "code": "<opaque>" }
```

SMART validates the full response shape before creating a session. Timeout: 10 seconds.

### 2.4 AIMS error mapping

| AIMS response | SMART result |
| --- | --- |
| `400 INVALID_CODE` | Shown as invalid code |
| `401 INVALID_CLIENT` | Shown as configuration error |
| `409 CODE_ALREADY_USED` | Shown as reused link |
| `410 CODE_EXPIRED` | Shown as expired link |
| `503 SSO_NOT_CONFIGURED` | AIMS SSO shown as not configured |
| Network/timeout | “AIMS could not complete sign-in” |
| Malformed body | “AIMS returned an invalid sign-in response” |

No code or secret is logged.

### 2.5 Identity mapping and account rules

SMART matches the AIMS identity in this order:

1. `User.aimsUserId` (AIMS UUID, preferred)
2. `User.email`
3. `User.username`
4. `Teacher.employeeId` (same string as AIMS teacher `username`)

Additional rules:

- The SMART account must be `ACTIVE`.
- The AIMS role must match the SMART role:
  - AIMS `TEACHER` → SMART `TEACHER`
  - AIMS `ADMIN` → SMART `ADMIN`
  - AIMS `STUDENT` → **not supported** (see §9)
- First/last names are checked when both sides provide them.
- A successful first match binds `User.aimsUserId`.
- If the SMART account is already linked to a different AIMS UUID, the exchange is denied.
- No SMART account is ever created from an assertion.

### 2.6 Deep-link mapping

| AIMS launch | SMART landing |
| --- | --- |
| `role=ADMIN` | `/admin` |
| `role=TEACHER`, class present | `/teacher/records/<classAssignmentId>?term=<T1/T2/T3>` |
| `role=TEACHER`, class absent | `/teacher/records` |
| `role=STUDENT` | Rejected; no SMART student portal |
| `role=REGISTRAR` | Rejected; AIMS does not issue this role |

Class resolution order inside SMART:

1. `context.class.courseId` → `ClassAssignment.aimsCourseId`
2. `context.class.sectionId` → `Section.enrollproSectionId` (year-scoped)
3. `context.class.sectionName` + `gradeLevel` + `schoolYear`
4. Subject match uses SMART's grade-suffix-aware normalization
   (`Araling Panlipunan` matches `Araling Panlipunan 7`).

If no class can be resolved, SMART lands on the teacher's class-record list rather than failing the sign-in.

`context.term.termIndex` is mapped to `T1/T2/T3` and passed to the class-record page so the correct term opens.

### 2.7 Existing-session behavior

SMART supports up to three simultaneous portal sessions (admin, teacher, registrar). After exchange:

- If the target portal is empty, SMART stores the new session.
- If the target portal already has the **same** user, SMART refreshes it.
- If the target portal has a **different** user, SMART refuses to overwrite it and tells the user to sign out of that portal first.

This preserves SMART's multi-session design while blocking unintended account switching.

### 2.8 AIMS profile change required

SMART currently has **no student accounts, student role, or student portal**.
The AIMS student launch button should be hidden or disabled for SMART, or changed to a
clear “Student sign-in is not available in SMART” message.

This is the only Part A flow that cannot be implemented without a separate SMART
student-portal project.

---

## 3. Part B — SMART → AIMS

### 3.1 Browser flow

```text
SMART sidebar AIMS button
  -> POST /api/auth/aims/reverse/authorize   (SMART JWT)
  -> SMART returns launchUrl:
       http://100.92.245.14:5000/api/v1/auth/smart/callback?code=<opaque>
  -> Browser opens AIMS callback
  -> AIMS backend calls SMART:
       POST http://100.93.66.120:5003/sso/aims/exchange
       x-aims-client-id: aims
       x-aims-client-secret: <shared secret>
       { "code": "<opaque>" }
  -> SMART consumes the code and returns identity + context
  -> AIMS creates its own session and redirects to its role home
```

### 3.2 SMART authorize endpoint

```http
POST /api/auth/aims/reverse/authorize
Authorization: Bearer <SMART access token>
Content-Type: application/json

{}
```

**Success:**

```json
{
  "success": true,
  "launchUrl": "http://100.92.245.14:5000/api/v1/auth/smart/callback?code=<43-char-code>"
}
```

The code is minted only for an authenticated SMART `ADMIN` or `TEACHER`.
`REGISTRAR` is refused.

### 3.3 SMART exchange endpoints

AIMS can call either of these; both use the same handler:

```http
POST http://100.93.66.120:5003/sso/aims/exchange
POST http://100.93.66.120:5003/api/auth/aims/reverse/exchange
```

Headers:

```http
Content-Type: application/json
x-aims-client-id: aims
x-aims-client-secret: <shared secret>
```

Body:

```json
{ "code": "<opaque>" }
```

**Success `200`:**

```json
{
  "success": true,
  "data": {
    "identity": {
      "id": "8c1f0f7e-2d3b-4b8e-9a6e-1f2b3c4d5e6f",
      "role": "TEACHER",
      "firstName": "Janella Marie",
      "lastName": "Fernandez",
      "email": null,
      "username": "1000003",
      "lrn": null
    },
    "context": {
      "school": { "id": "1" },
      "term": {
        "schoolYear": "2026-2027",
        "termIndex": 2
      },
      "class": null
    }
  }
}
```

**Error shape:**

```json
{
  "success": false,
  "error": "Invalid AIMS SSO client credentials.",
  "code": "INVALID_CLIENT"
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_CODE` | Missing, malformed, expired, or unknown code |
| `401` | `INVALID_CLIENT` | Wrong client id or secret |
| `403` | `ACCOUNT_UNAVAILABLE` | SMART account missing/inactive |
| `403` | `ROLE_UNSUPPORTED` | SMART registrar or unsupported role |
| `409` | `CODE_ALREADY_USED` | Replay of a consumed code |
| `410` | `CODE_EXPIRED` | Past 60-second TTL |
| `503` | `SSO_NOT_CONFIGURED` | SMART reverse SSO env is missing |

### 3.4 Identity echo rules

- `identity.id` is `User.aimsUserId` when SMART received an AIMS UUID in Part A.
  Otherwise it is `null`.
- `identity.role` is exactly `TEACHER` or `ADMIN`.
- `identity.username` is the teacher employee number, or the SMART username for admins.
- `identity.lrn` is always `null`.
- AIMS should continue its normal fallback matching when `identity.id` is `null`:
  email → username (employee ID / LRN).

### 3.5 Context rules

- `context.school.id` comes from SMART env `AIMS_SSO_SCHOOL_ID`.
  **Set this to AIMS's `SCHOOL_ID` (the current deployment uses `1`).**
  If unset, SMART falls back to `SystemSettings.schoolId`, which may not match AIMS.
- `context.term.schoolYear` is SMART's active school year.
- `context.term.termIndex` is SMART's live current term (`1/2/3`).
- `context.class` is `null` for the general sidebar launch. AIMS should land on its
  role home (`/dashboard` or `/home`).
- A class-scoped reverse launch is not currently implemented because SMART's sidebar
  button has no class context. If AIMS wants a class-specific reverse launch, SMART
  needs a separate button on the class-record page; that is future work.

### 3.6 Code rules

- 32 random bytes → 43 base64url characters.
- 60-second TTL.
- Stored only as a SHA-256 hash.
- Single-use, claimed atomically.
- Audience `aims`.
- Bound to the exact AIMS callback URL.
- Replay returns `409`; expiry returns `410`.
- Codes and secrets are never logged.

---

## 4. Configuration

### 4.1 SMART server

Add to SMART `server/.env` (out of band; never commit):

```dotenv
AIMS_SSO_EXCHANGE_URL=http://100.92.245.14:5000/api/v1/integrations/smart/sso/exchange
AIMS_SSO_CLIENT_ID=smart
AIMS_SSO_CLIENT_SECRET=<same value as AIMS SMART_SSO_CLIENT_SECRET>

AIMS_SSO_REVERSE_CALLBACK_URL=http://100.92.245.14:5000/api/v1/auth/smart/callback
AIMS_SSO_REVERSE_CLIENT_ID=aims
AIMS_SSO_REVERSE_CLIENT_SECRET=<same value as AIMS SMART_SSO_REVERSE_CLIENT_SECRET>
AIMS_SSO_SCHOOL_ID=1
```

Restart SMART after applying:

```bash
pm2 restart server
```

Verify:

```bash
curl http://localhost:5003/api/admin/settings/public
```

`settings.aimsSsoEnabled` must be `true` before the AIMS sidebar button enables.

### 4.2 AIMS server

AIMS must have these set by the AIMS admin:

```dotenv
SMART_BASE_URL="http://100.93.66.120:5003/api"
SMART_SSO_ENABLED="true"
SMART_SSO_CLIENT_ID="smart"
SMART_SSO_CLIENT_SECRET="<secret A>"
SMART_SSO_CODE_SECRET="<AIMS-only HMAC key>"
SMART_SSO_TTL_SECONDS="60"
SMART_SSO_LAUNCH_PATH="/sso/aims"

SMART_SSO_REVERSE_ENABLED="true"
SMART_SSO_REVERSE_EXCHANGE_URL="http://100.93.66.120:5003/sso/aims/exchange"
SMART_SSO_REVERSE_CLIENT_ID="aims"
SMART_SSO_REVERSE_CLIENT_SECRET="<secret B>"
```

### 4.3 Secret ownership

| Secret | AIMS env | SMART env | Notes |
| --- | --- | --- | --- |
| AIMS → SMART | `SMART_SSO_CLIENT_SECRET` | `AIMS_SSO_CLIENT_SECRET` | Same value on both sides |
| SMART → AIMS | `SMART_SSO_REVERSE_CLIENT_SECRET` | `AIMS_SSO_REVERSE_CLIENT_SECRET` | Same value on both sides |
| AIMS code signing | `SMART_SSO_CODE_SECRET` | **not used** | AIMS-only; SMART never needs it |

Per the contract, the **AIMS admin sets both shared secrets** and shares them with SMART
through the secure ops channel. If AIMS asks SMART to generate the reverse secret,
SMART may do so and return only that reverse secret to AIMS. SMART must never receive
or request `SMART_SSO_CODE_SECRET`.

**Do not use:** `AIMS_API_KEY`, `JWT_SECRET`, database passwords, or EnrollPro credentials.

---

## 5. Database changes on SMART

The following additive, nullable changes were applied:

| Table | Column | Purpose |
| --- | --- | --- |
| `User` | `aimsUserId` (unique) | Persistent AIMS UUID link |
| `Section` | `enrollproSectionId` (indexed with `schoolYear`) | AIMS/EP section deep-link key |

No destructive migration was performed. Existing rows are unaffected.

`enrollproSectionId` is populated by the normal EnrollPro section sync. Until a section
has been refreshed, SMART falls back to `sectionName + gradeLevel + schoolYear`.

### First-time account linking

If an AIMS admin cannot be matched automatically:

```bash
cd server
npx ts-node prisma/link-aims-user.ts --list
npx ts-node prisma/link-aims-user.ts --username <smart-username> --aims-user-id <aims-identity-uuid>
npx ts-node prisma/link-aims-user.ts --username <smart-username> --unlink
```

The tool refuses `REGISTRAR` accounts and never creates users.

---

## 6. Security notes

- The AIMS exchange secret is server-side only.
- Constant-time comparison is used for the reverse secret.
- Part B codes are hashed at rest and claimed atomically.
- Part A codes are treated as opaque; AIMS is the authority.
- SMART keeps an in-memory duplicate-code guard for Part A.
- The root `/sso/aims/exchange` alias is exempt from CSRF only for that exact path;
  it is authenticated by the AIMS shared secret, not a browser cookie.
- SMART does not log codes, secrets, or full assertions.
- SMART does not share cookies or JWTs with AIMS.
- Role and account status are re-checked at exchange time.
- No account is auto-created from SSO.
- The AIMS sidebar launch requires an authenticated SMART `ADMIN` or `TEACHER`.

---

## 7. Test evidence (SMART side)

| Gate | Result |
| --- | --- |
| Server TypeScript build | Pass |
| Frontend typecheck | Pass |
| Frontend production build | Pass |
| PWA build/scope checks | Pass |
| Full backend suite | **519 passed, 77 skipped** |
| New AIMS SSO suite | **19 passed** |
| Existing portal Playwright smoke (admin/teacher/registrar) | **4 passed** |
| Playwright AIMS checks | Launch page, not-configured error, account-not-linked, sidebar button, JWT header, root alias, `?term=T2` |
| Prisma migration status | Up to date |
| Health endpoint | `200 OK` |
| PM2 logs | No AIMS runtime errors after config gating; only expected `SSO_NOT_CONFIGURED` probes |

Playwright also caught and fixed a real issue: the sidebar AIMS call originally used raw
`axios`, which skipped SMART's JWT interceptor. It now uses SMART's authenticated API client.

### 7.1 Live joint test results (2026-11-11)

The AIMS-provided configuration was applied to SMART. `aimsSsoEnabled` is now `true`.

| Check | Result |
| --- | --- |
| AIMS health | `200 OK` |
| Part A: AIMS-issued code → SMART exchange | **Pass** (temporary SMART fixture; session issued; fixture deleted) |
| Part A: browser launch URL → SMART SPA | **Pass** (real AIMS code; SMART session stored; landed on `/teacher/records`; code stripped) |
| Part A: unlinked AIMS teacher | **Pass** (clear `AIMS_ACCOUNT_NOT_PROVISIONED` page data; no account created) |
| Part A: replay same AIMS code | **Pass** (`409 CODE_ALREADY_USED`) |
| Part A: wrong SMART client secret | **Pass** (`401 INVALID_CLIENT` on AIMS) |
| Part A: AIMS code expiry | **Mismatch** — code was still accepted after 62s and expired by 125s; contract says 60s |
| Part B: SMART browser sidebar → AIMS | **Pass** — SMART teacher landed on AIMS `/home` |
| Part B: exchange success | **Pass** (`200`, identity + context returned) |
| Part B: replay same SMART code | **Pass** (`409 CODE_ALREADY_USED`) |
| Part B: expired SMART code | **Pass** (`410 CODE_EXPIRED` at 62s) |
| Part B: wrong AIMS client secret | **Pass** (`401 INVALID_CLIENT`) |
| No codes/secrets in logs | **Pass** (no code or secret material was logged) |

**Action for AIMS:** confirm `SMART_SSO_TTL_SECONDS=60` is actually loaded and restart AIMS.
If AIMS intentionally uses a longer TTL, the contract and SMART UI copy must be updated;
SMART currently describes the link as a 60-second code.

**Provisioning note:** the documented AIMS dev teacher `teacher@gmail.com` has no SMART
account. Positive Part A exchange was therefore verified with a temporary SMART fixture
that was deleted immediately afterward. A real AIMS teacher must either match an existing
SMART `Teacher.employeeId` / `User.username` / `User.email`, or be explicitly linked with
`prisma/link-aims-user.ts`. The SMART teacher used for the live Part B browser test
(`1000001`) is already linked successfully on the AIMS side and landed on AIMS `/home`.

**Remaining class-launch check:** the documented AIMS test teacher has no AIMS course
list in this dev tenant, so a real class-specific AIMS → SMART launch is still pending
a teacher/course pair that maps to a SMART class. SMART's class resolver is covered by
tests, and the browser `?term=T2` class-record deep link was verified directly.

---

## 8. Joint test plan

### Part A — AIMS → SMART

1. AIMS teacher launches from a class Grades tab.
   - Expect SMART exchange `200`.
   - Expect correct teacher identity and class context.
   - Expect the class record to open on the AIMS term.
2. AIMS admin launches from the sidebar.
   - Expect SMART admin home.
3. AIMS student launch.
   - Expect a clear “SMART does not provide student sign-in” message.
4. Sidebar launch with no class.
   - Expect the SMART teacher class-record list.
5. Wrong/absent client secret.
   - Expect `401 INVALID_CLIENT`; SMART shows the configuration fallback.
6. Wait more than 60 seconds.
   - Expect `410 CODE_EXPIRED`.
7. Reuse the same code.
   - Expect `409 CODE_ALREADY_USED`.
8. AIMS user with no SMART account.
   - Expect the “SMART account not linked” page with AIMS name/username/LRN.
   - No SMART user is created.
9. Confirm no code or secret appears in SMART logs or browser history.

### Part B — SMART → AIMS

1. SMART teacher clicks AIMS.
   - Expect AIMS to sign in and land on the teacher home.
2. SMART admin clicks AIMS.
   - Expect AIMS admin home.
3. SMART registrar views the sidebar.
   - Expect the AIMS item disabled with “Teachers and admins only.”
4. Replay the same code.
   - Expect SMART `409`; AIMS shows `exchange_failed`.
5. Expired code (>60 seconds).
   - Expect SMART `410`; AIMS shows `exchange_failed`.
6. Wrong client secret.
   - Expect SMART `401`; AIMS shows `exchange_failed`.
7. No matching AIMS account.
   - Expect AIMS `account_not_provisioned`; no AIMS account is created.
8. Role mismatch.
   - Expect AIMS denial.
9. Confirm no code or secret appears in SMART logs or browser history.

---

## 9. Contract deviations and clarifications requested

These are the points where the implementation intentionally differs from, or clarifies,
the original handoff:

1. **Student Part A launch is not available.**
   SMART has no student accounts, student role, or student portal.
   AIMS should hide/disable the student SMART button or label it unavailable.
2. **`Section.enrollproSectionId` did not exist before this work.**
   It was added and is populated by the EnrollPro sync. Until populated, SMART uses
   `sectionName + gradeLevel + schoolYear`; `courseId` matching uses
   `ClassAssignment.aimsCourseId`.
3. **SMART has no `Course` model.**
   `courseCode` is informational; the actual class link is
   `ClassAssignment.aimsCourseId` plus `Subject`/`Section`.
4. **Part B exchange URL must be pinned.**
   SMART exposes both:
   - `http://100.93.66.120:5003/sso/aims/exchange` (root alias, matching B4)
   - `http://100.93.66.120:5003/api/auth/aims/reverse/exchange` (canonical API path)
   AIMS should use the exact value configured in
   `SMART_SSO_REVERSE_EXCHANGE_URL`.
5. **`context.class` is `null` for the general sidebar launch.**
   AIMS will land on its role home. A class-specific reverse launch needs a separate
   class-scoped button on SMART's class-record page.
6. **`context.school.id` needs AIMS's school ID.**
   SMART reads `AIMS_SSO_SCHOOL_ID`; set it to AIMS's `SCHOOL_ID` (`1` in the current
   deployment). Otherwise SMART falls back to its own `SystemSettings.schoolId`, which
   may not match AIMS.
7. **Part A failure fallback is an in-app SMART page.**
   It shows the reason and a “Go to SMART sign in” button. For account-not-provisioned,
   it shows the AIMS identity details per §8 instead of redirecting immediately.
8. **`identity.id` may be `null` in Part B.**
   If SMART never received an AIMS UUID for that user, AIMS must fall back to email or
   username matching, as its B3 reconciliation already specifies.
9. **The original SMART §10 config block omitted `AIMS_SSO_REVERSE_CLIENT_SECRET`.**
   It is required and is documented in §4.1 above.
10. **Document path mismatch (minor).**
    The handoff references `docs/AIMS-SMART-INTEGRATION.md`; the SMART repo contains
    `docs/AIMS/AIMS_Smart_Integration_Guide.md`.

---

## 10. Rollback

SMART code changes are isolated and can be reverted without touching AIMS.

- Rollback script:
  `C:\Users\Sean\AppData\Local\Temp\opencode\aims-sso-rollback\rollback-aims.ps1`
- Full tracked diff snapshot:
  `C:\Users\Sean\AppData\Local\Temp\opencode\aims-sso-rollback\aims-sso-final.patch`

The rollback intentionally leaves the additive nullable database columns in place to
avoid a destructive down-migration. The columns are harmless if the AIMS code is removed.

---

## 11. What AIMS needs to confirm before go-live

1. Confirm the two shared secrets through the secure ops channel.
2. Confirm `SMART_SSO_REVERSE_EXCHANGE_URL` is exactly
   `http://100.93.66.120:5003/sso/aims/exchange`.
3. Confirm AIMS `SCHOOL_ID` for `AIMS_SSO_SCHOOL_ID`.
4. Confirm the teacher and admin AIMS identities exist in SMART, or provide the AIMS UUIDs
   for explicit linking.
5. Confirm the student SMART button is hidden/disabled.
6. Run the joint test plan in §8.
7. Confirm no codes, secrets, or full assertions appear in either system's logs.
