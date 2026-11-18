# AIMS → SMART: Grading Weights Endpoint — Handoff

> **STATUS: IMPLEMENTED — NOT YET DEPLOYED.**
> Code is in the working tree and passes the server build + focused tests.
> The route is not live on `100.93.66.120:5003` until the API process is restarted with
> `AIMS_SERVICE_API_KEY` set. Live curl verification is still owed (Section 5).
>
> **Audience:** SMART backend implementer (Sections 4–6) and the AIMS consumer team
> (Sections 1–3).
>
> **Source:** AIMS report dated 2026-11-18 for course `EP-95-SCI_BIO`
> (`904bcd77-8950-4fb7-a373-9fecb80646d4`, Grade 9 - Rose, SY 2026-2027).

---

## 0. Implementation summary (2026-11-18)

**Built:**
- `GET /api/integration/aims/grading-weights` — single + batch lookup.
- Auth: `x-api-key` + `AIMS_SERVICE_API_KEY`, fail-closed.
- Live weight resolution via the existing class-record resolver; no cache, no new table.
- Response includes `source`, `isFallback`, `weightsSum`, `weightsValid`, `updatedAt`,
  `termScoped: false`.
- Errors are JSON `{ code, message }`.

**Files:**
| File | Change |
|---|---|
| `server/src/middleware/aimsServiceAuth.ts` | NEW — inbound AIMS auth |
| `server/src/routes/integration-sub/aimsGradingWeights.ts` | NEW — route + lookup + response |
| `server/src/routes/integration.ts` | EDIT — registers the sub-router |
| `server/src/schemas/aims.ts` | EDIT — `aimsGradingWeightsQuerySchema` |
| `server/src/routes/grades-sub/helpers.ts` | EDIT — `EffectiveWeights.updatedAt` metadata |
| `server/src/__tests__/aims-grading-weights.test.ts` | NEW — 11 focused tests |

**Verified:**
- `pnpm run build` (server) → `tsc` no errors.
- `pnpm exec vitest run src/__tests__/aims-grading-weights.test.ts` → **11 passed**.
- Full server suite was not run here (requires an isolated `*_test` database).
- Local running API (ts-node-dev) now serves the route and returns
  `401 {"code":"UNAUTHORIZED","message":"AIMS integration auth is not configured."}`
  because the local key is unset — the route is registered, not `404`.
- No Prisma migration required.

**Still owed before AIMS can consume it:**
1. Set `AIMS_SERVICE_API_KEY` in the SMART server environment and restart the API.
2. Share the key with AIMS out-of-band.
3. Run the curl checks in Section 5 on the direct Tailscale host and the funnel.
4. Compare the returned `weights` with the SMART Class Record UI for a linked class.

---

## 1. Reply to AIMS (short version)

| Question | Answer |
|---|---|
| Final route | `GET /api/integration/aims/grading-weights` |
| Full URL | `http://100.93.66.120:5003/api/integration/aims/grading-weights` |
| Relative to `SMART_BASE_URL=.../api` | `/integration/aims/grading-weights` |
| Auth header | `x-api-key: <shared key>` |
| Key on SMART side | `AIMS_SERVICE_API_KEY` (new env var, **separate** from SMART's outbound `AIMS_API_KEY`) |
| Missing/wrong key | `401` JSON `{ "code": "UNAUTHORIZED", "message": "..." }` — no HTML, no session, no redirect |
| Preferred identity | `aimsCourseId=<AIMS course UUID>` |
| `aimsCourseId` semantics | **Yes** — the exact UUID stored by SMART's `POST /api/grades/aims-link/:classAssignmentId` (`ClassAssignment.aimsCourseId`), not the course code |
| Legacy `GET /api/grades/weights/:courseCode` | **Not implemented.** Use the integration route above. |
| Term-scoped? | **No.** Weights are class-wide for the linked class assignment. `term` is ignored; response has `termScoped: false`. |
| `classAssignmentId` type | **String cuid**, not an integer |
| Unlinked AIMS course | `404 { "code": "AIMS_COURSE_NOT_LINKED", "message": "..." }` (not 200-with-`linked:false`) |
| Batch | `?aimsCourseIds=<uuid>,<uuid>,...` (max 50) → `{ "results": [...] }` |
| Response content | SMART's **effective class-record weights** (`ww`, `pt`, `qa`) + provenance |

### Critical correction to AIMS' assumptions

AIMS' report says SMART stores grading weights "on the class record / class assignment."
That is not accurate. SMART resolves weights at read time with this precedence:

1. **Per-subject override** — `Subject.writtenWorkWeight / perfTaskWeight / quarterlyAssessWeight`
   (set in Admin → Grading Config → **Per-Subject Weight Overrides**).
2. **Per-subject-group default** — `GradingConfig` row keyed by `Subject.type`
   (`CORE`, `MAPEH`, `TLE`, `MATH_SCIENCE`).
3. **Hardcoded generic fallback** — `ww=20, pt=50, qa=30`.

There is **no per-class weight override** in SMART today (`ClassAssignment` has no weight
columns; `ClassRecord` is not a weights table). Therefore:

- `CLASS_OVERRIDE` **will never appear** in the response unless SMART later adds
  class-level weights.
- AIMS must accept these source values:
  - `SUBJECT_DEFAULT` — SMART per-subject override
  - `GROUP_DEFAULT` — SMART subject-type default
  - `GENERIC_FALLBACK` — hardcoded fallback (treat as fallback)
  - (`CLASS_OVERRIDE` is reserved; do not require it)
- The weights returned are exactly what SMART's class-record ledger uses, so a value
  mismatch with the SMART UI should be treated as a SMART bug, not a mapping decision.

Also: `courseCode` alone is not a safe key. AIMS `Course.code` (`EP-95-SCI_BIO`) does not
match SMART's `Subject.code` (`SCI_BIO9`). Use `aimsCourseId`; `courseCode` is only a
best-effort fallback and is echoed for diagnostics.

---

## 2. Final contract

### 2.1 Route

```
GET /api/integration/aims/grading-weights
```

Mounted by `server/src/index.ts` (`app.use("/api/integration", integrationRoutes)`), so the
handler belongs in `server/src/routes/integration.ts`.

### 2.2 Auth

Server-to-server only. No JWT, no session cookie, no CSRF token.

**Same key value on both sides; only the variable names differ.**

| Side | Where it goes | Value |
|---|---|---|
| SMART server | env var `AIMS_SERVICE_API_KEY` | `<key>` |
| AIMS server | env var `SMART_API_KEY` | `<same key>` |
| AIMS request | header `x-api-key` | `<same key>` |

- Send AIMS **only the key value**, not SMART's variable name (`AIMS_SERVICE_API_KEY`).
- AIMS puts the key in its `SMART_API_KEY` env var and sends it as `x-api-key` on each request.
- `x-api-key` is only the header name — it is not a second key or an env var.
- Key comparison is constant-time and fail-closed when `AIMS_SERVICE_API_KEY` is unset.
- Missing/invalid key → `401` + JSON `{ "code": "UNAUTHORIZED", "message": "..." }`.
- Secret sharing is out-of-band only — never in this repo.

Do **not** reuse:
- `AIMS_API_KEY` — that is SMART's **outbound** key to AIMS.
- `ENROLLPRO_API_KEY` — the existing `serviceAuth` middleware reads
  `x-enrollpro-api-key`; AIMS must not share EnrollPro's secret.

A new middleware is required because the existing `serviceAuth`
(`server/src/middleware/serviceAuth.ts`) hardcodes the EnrollPro header and key.

CSRF is already safe: `csrfProtection` exempts all `GET` requests
(`server/src/middleware/csrf.ts:80-89`).

### 2.3 Query parameters

| Param | Required | Format | Behavior |
|---|---|---|---|
| `aimsCourseId` | Yes (single lookup) | UUID | Looks up `ClassAssignment.aimsCourseId` |
| `aimsCourseIds` | Yes (batch lookup) | Comma-separated UUIDs, max 50 | Batch mode; mutually exclusive with single lookup |
| `courseCode` | No | String | Echoed in response; only used as a fallback lookup when `aimsCourseId` is absent |
| `schoolYear` | No | `YYYY-YYYY` | Disambiguates multiple linked assignments; also scopes the `courseCode` fallback |
| `term` | No | `1`/`2`/`3` or `T1`/`T2`/`T3` | Accepted and echoed, **not used for resolution** |

Rules:
- At least one of `aimsCourseId`, `aimsCourseIds`, or `courseCode` must be present.
- `aimsCourseId` must be a valid UUID (`server/src/schemas/aims.ts` already uses
  `z.string().uuid()` for the link body).
- If `aimsCourseIds` is present, batch mode wins and `aimsCourseId` is ignored.
- Batch limit: 50. More than 50 → `400 TOO_MANY_COURSES`.

### 2.4 Success response

```json
{
  "linked": true,
  "aimsCourseId": "904bcd77-8950-4fb7-a373-9fecb80646d4",
  "classAssignmentId": "cm3aims9bio00000000000000",
  "courseCode": "EP-95-SCI_BIO",
  "subjectCode": "SCI_BIO9",
  "subjectName": "Science - Biology 9",
  "sectionName": "Rose",
  "gradeLevel": "GRADE_9",
  "schoolYear": "2026-2027",
  "teacherEmployeeId": "2000076",
  "isActive": true,
  "term": null,
  "termScoped": false,
  "source": "SUBJECT_DEFAULT",
  "isFallback": false,
  "weights": { "ww": 20, "pt": 50, "qa": 30 },
  "weightsSum": 100,
  "weightsValid": true,
  "updatedAt": "2026-11-18T08:00:00.000Z"
}
```

Field notes:

| Field | Notes |
|---|---|
| `linked` | Always `true` on 200; a 404 is used for unlinked courses |
| `aimsCourseId` | Echo of the lookup key |
| `classAssignmentId` | SMART cuid **string** (not an int) |
| `courseCode` | Echo of the `courseCode` query param; `null` when not supplied (SMART does not store AIMS' course code) |
| `subjectCode` | SMART `Subject.code` (e.g. `SCI_BIO9`) |
| `subjectName` | SMART `Subject.name` (display name, includes grade suffix) |
| `sectionName` | SMART `Section.name` |
| `gradeLevel` | Raw SMART enum: `GRADE_7` … `GRADE_10` |
| `teacherEmployeeId` | ATLAS employee ID, useful for AIMS diagnostics |
| `isActive` | Whether the linked assignment is currently active (historical links still resolve) |
| `term` | Echo of the supplied term, normalized to `T1`/`T2`/`T3`; `null` when omitted |
| `termScoped` | Always `false` |
| `source` | `SUBJECT_DEFAULT` \| `GROUP_DEFAULT` \| `GENERIC_FALLBACK` (see 2.5) |
| `isFallback` | `true` only for `GENERIC_FALLBACK` |
| `weights` | Percentages as numbers; do **not** divide by 100 |
| `weightsSum` | `ww + pt + qa`; normally `100` |
| `weightsValid` | `weightsSum === 100`; SMART does not normalize or clamp |
| `updatedAt` | Timestamp of the row that supplied the weights (subject / grading config / assignment); ISO-8601 UTC |

### 2.5 Source mapping

| SMART internal source | Response `source` | Meaning |
|---|---|---|
| `subject-override` | `SUBJECT_DEFAULT` | Admin set weights for this specific SMART subject |
| `subject-type` | `GROUP_DEFAULT` | Defaults for the subject group (`CORE`, `MAPEH`, `TLE`, `MATH_SCIENCE`) |
| `generic-fallback` | `GENERIC_FALLBACK` | No subject/group config row; hardcoded `20/50/30` |

`CLASS_OVERRIDE` is **not produced** by SMART today.

The per-subject overrides are the values on **Admin → Grading Config → Per-Subject Weight
Overrides**. AIMS does not need that table or a screenshot of it; the endpoint reads those
values live and returns them as `SUBJECT_DEFAULT`.

### 2.6 Term scope — explicit answer

**Effective weights do not vary by term.** The resolver signature is
`resolveEffectiveWeightsForClassAssignment(classAssignmentId)` and has no term argument
(`server/src/routes/grades-sub/helpers.ts:221`). The same class assignment yields the same
weights in T1, T2, and T3. AIMS may ignore `term`.

If a subject rotates by term, the *class assignment / subject* changes per term, but the
weight set for each linked assignment is still class-wide and term-independent.

### 2.6.1 Weight-change propagation

**SMART does not push weights to AIMS.** The integration is pull-only and read-only, so a
change in SMART propagates only when AIMS calls the endpoint again.

- The endpoint resolves weights live from `Subject` / `GradingConfig` on every request;
  there is no SMART-side cache to invalidate.
- If AIMS stores the weights, it must re-sync after an admin changes SMART's weights
  (Admin → Grading Config → **Per-Subject Weight Overrides** or group defaults). There is no
  webhook in v1.
- Use `updatedAt` plus `weights` / `source` to detect a change on each pull. AIMS can poll
  on its normal sync interval or expose a "Re-sync weights" action.
- Changing SMART weights also recomputes SMART's own stored grades; it does not change
  grades already computed/stored inside AIMS until AIMS re-syncs and re-weights.
- AIMS' current rule "only auto-sync when the course has no weight rows at all" is **not
  sufficient** for this contract. AIMS needs to re-sync when `updatedAt`/weights differ,
  not only when its weight rows are empty.

### 2.7 Error contract

All errors are JSON. Never HTML.

| Status | `code` | When |
|---|---|---|
| `400` | `INVALID_QUERY` | No lookup key; malformed UUID; invalid `term`/`schoolYear` |
| `400` | `TOO_MANY_COURSES` | More than 50 IDs in `aimsCourseIds` |
| `401` | `UNAUTHORIZED` | Missing/invalid `x-api-key`, or `AIMS_SERVICE_API_KEY` unset |
| `404` | `AIMS_COURSE_NOT_LINKED` | No `ClassAssignment` with that `aimsCourseId` (and no safe `courseCode` fallback) |
| `409` | `AMBIGUOUS_AIMS_COURSE_LINK` | Multiple plausible linked assignments and no `schoolYear` to disambiguate |
| `500` | `INTERNAL_ERROR` | Unexpected server failure |

Example:

```json
{
  "code": "AIMS_COURSE_NOT_LINKED",
  "message": "AIMS course 904bcd77-8950-4fb7-a373-9fecb80646d4 is not linked to any SMART class assignment."
}
```

### 2.8 Batch mode

```
GET /api/integration/aims/grading-weights?aimsCourseIds=<uuid>,<uuid>
```

Response:

```json
{
  "results": [
    { "linked": true, "aimsCourseId": "...", "source": "SUBJECT_DEFAULT", "weights": { "ww": 20, "pt": 50, "qa": 30 }, "...": "..." },
    { "aimsCourseId": "...", "error": { "code": "AIMS_COURSE_NOT_LINKED", "message": "..." } }
  ]
}
```

Per-course errors do not fail the whole batch. Batch results are ordered the same as the
input IDs. Duplicate IDs are processed and returned once.

---

## 3. Sample responses

### 3.1 Linked class, subject-level override (`SUBJECT_DEFAULT`)

Illustrative values — replace with the actual SMART class-record values:

```json
{
  "linked": true,
  "aimsCourseId": "904bcd77-8950-4fb7-a373-9fecb80646d4",
  "classAssignmentId": "cm3aims9bio00000000000000",
  "courseCode": "EP-95-SCI_BIO",
  "subjectCode": "SCI_BIO9",
  "subjectName": "Science - Biology 9",
  "sectionName": "Rose",
  "gradeLevel": "GRADE_9",
  "schoolYear": "2026-2027",
  "teacherEmployeeId": "2000076",
  "isActive": true,
  "term": "T1",
  "termScoped": false,
  "source": "SUBJECT_DEFAULT",
  "isFallback": false,
  "weights": { "ww": 20, "pt": 50, "qa": 30 },
  "weightsSum": 100,
  "weightsValid": true,
  "updatedAt": "2026-11-18T08:00:00.000Z"
}
```

### 3.2 Linked class, group default (`GROUP_DEFAULT`)

Same shape, with:

```json
{
  "source": "GROUP_DEFAULT",
  "weights": { "ww": 20, "pt": 60, "qa": 20 },
  "updatedAt": "2026-06-01T00:00:00.000Z"
}
```

### 3.3 Linked class, generic fallback (`GENERIC_FALLBACK`)

```json
{
  "source": "GENERIC_FALLBACK",
  "isFallback": true,
  "weights": { "ww": 20, "pt": 50, "qa": 30 },
  "weightsSum": 100,
  "weightsValid": true
}
```

### 3.4 Unlinked AIMS course

`404`:

```json
{
  "code": "AIMS_COURSE_NOT_LINKED",
  "message": "AIMS course 904bcd77-8950-4fb7-a373-9fecb80646d4 is not linked to any SMART class assignment."
}
```

### 3.5 Missing/invalid key

`401`:

```json
{
  "code": "UNAUTHORIZED",
  "message": "A valid x-api-key is required."
}
```

---

## 4. Implementation spec (SMART repo)

### 4.1 New middleware — `server/src/middleware/aimsServiceAuth.ts`

```ts
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function aimsServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.AIMS_SERVICE_API_KEY ?? "";
  if (!expected) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "AIMS integration auth is not configured." });
    return;
  }
  const provided = String(req.headers["x-api-key"] ?? "");
  if (!provided || !constantTimeCompare(provided, expected)) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "A valid x-api-key is required." });
    return;
  }
  next();
}
```

Mirror the fail-closed behavior of `server/src/middleware/serviceAuth.ts`. Do not reuse
`x-enrollpro-api-key`.

### 4.2 Route — `server/src/routes/integration-sub/aimsGradingWeights.ts`

The route is registered from `server/src/routes/integration.ts`:

```ts
import registerAimsGradingWeights from "./integration-sub/aimsGradingWeights";

registerAimsGradingWeights(router);
```

The full path is `/api/integration/aims/grading-weights`. Keeping the handler in a
sub-router keeps `integration.ts` under the 1000-line limit.

Recommended validation schema in `server/src/schemas/aims.ts`:

```ts
export const aimsGradingWeightsQuerySchema = z.object({
  aimsCourseId: z.string().uuid().optional(),
  aimsCourseIds: z.string().optional(),
  courseCode: z.string().trim().min(1).max(200).optional(),
  schoolYear: z.string().regex(/^\d{4}-\d{4}$/).optional(),
  term: z.string().optional(),
}).refine(
  (v) => !!v.aimsCourseId || !!v.aimsCourseIds || !!v.courseCode,
  { message: "aimsCourseId, aimsCourseIds, or courseCode is required" },
);
```

Use `validate()` (`server/src/middleware/validate.ts`) or parse `req.query` directly.
Note: `validate` wraps input as `{ body, query, params }`; the schema must be shaped
accordingly or use a local `safeParse`.

### 4.3 Weight resolution — single source of truth

Call the existing resolver; do not duplicate the precedence:

```ts
import { resolveEffectiveWeightsForClassAssignment } from "./grades-sub/helpers";
```

Extend the existing return type with metadata (backward-compatible):

```ts
export interface EffectiveWeights {
  ww: number;
  pt: number;
  qa: number;
  source: "subject-override" | "subject-type" | "generic-fallback";
  updatedAt?: Date | null;
}
```

In `resolveEffectiveWeightsForClassAssignment`, add `updatedAt: true` to the subject select
and `updatedAt: true` to the `GradingConfig` select, then return the matching row's
timestamp. For `generic-fallback`, return `classAssignment.updatedAt` (add it to the select)
or `null`.

Map:

```ts
const source =
  effective.source === "subject-override" ? "SUBJECT_DEFAULT" :
  effective.source === "subject-type"     ? "GROUP_DEFAULT" :
                                            "GENERIC_FALLBACK";
```

**Do not** use AIMS' own `weights` from `/public/courses/:id/scores`; those are AIMS'
WW/PT split, not SMART's WW/PT/QA ledger weights.

### 4.4 Link resolution

```ts
const assignment = await prisma.classAssignment.findFirst({
  where: {
    aimsCourseId,
    ...(schoolYear ? { schoolYear } : {}),
  },
  include: {
    subject: true,
    section: true,
    teacher: { select: { employeeId: true } },
  },
  orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
});
```

Rules:
- Do **not** filter `isActive: true` in the query. Historical links must still resolve;
  `isActive` is returned in the payload. Only prefer active rows when ordering.
- If `schoolYear` is supplied, filter by it.
- If more than one row remains after filtering (same course linked to multiple classes),
  return `409 AMBIGUOUS_AIMS_COURSE_LINK` and tell AIMS to retry with `schoolYear`.
- `courseCode` fallback (only when no `aimsCourseId`):
  - Match `Subject.code` case-insensitively within `schoolYear` when supplied.
  - If exactly one linked assignment matches, use it.
  - If none or multiple, return `404 AIMS_COURSE_NOT_LINKED`.
  - This is best-effort only; AIMS should always send `aimsCourseId`.

### 4.5 Response builder

```ts
const effective = await resolveEffectiveWeightsForClassAssignment(assignment.id);
const weightsSum = effective.ww + effective.pt + effective.qa;

res.json({
  linked: true,
  aimsCourseId: assignment.aimsCourseId,
  classAssignmentId: assignment.id,
  courseCode: courseCode ?? null,
  subjectCode: assignment.subject.code,
  subjectName: assignment.subject.name,
  sectionName: assignment.section.name,
  gradeLevel: assignment.section.gradeLevel,
  schoolYear: assignment.schoolYear,
  teacherEmployeeId: assignment.teacher.employeeId ?? null,
  isActive: assignment.isActive,
  term: normalizedTerm ?? null,
  termScoped: false,
  source,
  isFallback: source === "GENERIC_FALLBACK",
  weights: { ww: effective.ww, pt: effective.pt, qa: effective.qa },
  weightsSum,
  weightsValid: weightsSum === 100,
  updatedAt: effective.updatedAt ?? assignment.updatedAt,
});
```

`normalizedTerm`: accept `1`/`2`/`3` and map to `T1`/`T2`/`T3`; accept `T1`/`T2`/`T3`
as-is; anything else → `400 INVALID_QUERY`. The value is echoed only.

### 4.6 Files

| File | Change |
|---|---|
| `server/src/middleware/aimsServiceAuth.ts` | **NEW** — `x-api-key` + `AIMS_SERVICE_API_KEY` |
| `server/src/routes/integration.ts` | **EDIT** — add `GET /aims/grading-weights` (single + batch) |
| `server/src/routes/grades-sub/helpers.ts` | **EDIT** — add `updatedAt` metadata to `EffectiveWeights` (optional field) |
| `server/src/schemas/aims.ts` | **EDIT** — query schema |
| `server/src/__tests__/aims-grading-weights.test.ts` | **NEW** — auth, linked, unlinked, batch, term echo |

No Prisma migration is required. Optional index (not required; table is small):

```prisma
@@index([aimsCourseId])
```

**Ops:** set `AIMS_SERVICE_API_KEY` in the SMART server environment (not the frontend,
not the repo) and restart the API process. Generate it with
`openssl rand -hex 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
Share the value with AIMS out-of-band only.

### 4.7 What not to do

- Do not add `GET /api/grades/weights/:courseCode`; the integration route is the contract.
- Do not expose `AIMS_SERVICE_API_KEY` to the browser or frontend bundle.
- Do not return HTML or redirect on auth failure.
- Do not recompute weights from AIMS scores.
- Do not normalize or clamp `weights`; return exactly what SMART uses and expose
  `weightsValid` / `weightsSum`.

### 4.8 As-built behavior notes

- **Batch wins:** if `aimsCourseIds` is present, `aimsCourseId` is ignored.
- **Active row preference:** when a course is linked to two rows, exactly one active row is
  selected; otherwise `409 AMBIGUOUS_AIMS_COURSE_LINK`.
- **Course-code fallback:** strips a leading `EP-<number>-` prefix and tries exact
  `Subject.code`, then a `startsWith` prefix match. It can still be ambiguous because a
  subject code is shared by multiple sections; AIMS should send `aimsCourseId`.
- **`updatedAt`:** source row timestamp (`Subject.updatedAt`, `GradingConfig.updatedAt`, or
  `ClassAssignment.updatedAt` for the hardcoded fallback).
- **No caching:** every request resolves live weights; there is no cache to invalidate.

---

## 5. Acceptance checklist (curl)

Set the key in the shell (never commit it):

```bash
# PowerShell: $env:AIMS_SERVICE_API_KEY = "<key>"
export AIMS_SERVICE_API_KEY="<key>"
```

### 5.1 Linked class

```bash
curl -sS -i \
  -H "x-api-key: $AIMS_SERVICE_API_KEY" \
  "http://100.93.66.120:5003/api/integration/aims/grading-weights?aimsCourseId=904bcd77-8950-4fb7-a373-9fecb80646d4&courseCode=EP-95-SCI_BIO&schoolYear=2026-2027&term=1"
```

Expected: `200`, `source` is `SUBJECT_DEFAULT` or `GROUP_DEFAULT`, `weights` matches the
SMART Class Record ledger for Science - Biology 9 / Rose.

### 5.2 Unlinked course

```bash
curl -sS -i \
  -H "x-api-key: $AIMS_SERVICE_API_KEY" \
  "http://100.93.66.120:5003/api/integration/aims/grading-weights?aimsCourseId=00000000-0000-0000-0000-000000000000"
```

Expected: `404`, JSON `AIMS_COURSE_NOT_LINKED`.

### 5.3 Missing/invalid key

```bash
curl -sS -i \
  "http://100.93.66.120:5003/api/integration/aims/grading-weights?aimsCourseId=904bcd77-8950-4fb7-a373-9fecb80646d4"
```

Expected: `401`, JSON `UNAUTHORIZED`.

### 5.4 Funnel parity

```bash
curl -sS -i \
  -H "x-api-key: $AIMS_SERVICE_API_KEY" \
  "https://laptop-pfvh73qk.buru-degree.ts.net/api/integration/aims/grading-weights?aimsCourseId=904bcd77-8950-4fb7-a373-9fecb80646d4"
```

Expected: identical body/status to 5.1.

### 5.5 Batch

```bash
curl -sS -H "x-api-key: $AIMS_SERVICE_API_KEY" \
  "http://100.93.66.120:5003/api/integration/aims/grading-weights?aimsCourseIds=904bcd77-8950-4fb7-a373-9fecb80646d4,00000000-0000-0000-0000-000000000000"
```

Expected: `200`, `results[0]` success, `results[1]` per-course error.

### 5.6 Same AIMS course-id check

Confirm `GET /api/integration/aims/grading-weights?aimsCourseId=904bcd77-...`
returns the linked class. The `POST /api/grades/aims-link/:classAssignmentId` body stores
that UUID verbatim into `ClassAssignment.aimsCourseId`; the new route reads the same column.

---

## 6. Open items / decisions locked

1. **Env var name:** `AIMS_SERVICE_API_KEY` (inbound to SMART). `AIMS_API_KEY` remains
   SMART's outbound key to AIMS. Do not merge them.
2. **Header:** `x-api-key` (as AIMS requested). Existing `x-enrollpro-api-key` is not used.
3. **Unlinked response:** `404 AIMS_COURSE_NOT_LINKED` (not 200 + `linked:false`).
4. **Term:** `termScoped: false`; `term` echoed but ignored.
5. **Source vocabulary:** `SUBJECT_DEFAULT` / `GROUP_DEFAULT` / `GENERIC_FALLBACK`.
   `CLASS_OVERRIDE` is not produced today. AIMS must treat unknown `source` values as
   "SMART-defined" and still consume `weights`.
6. **Alias:** `GET /api/grades/weights/:courseCode` will not be added.

---

## 7. What AIMS should ship after SMART deploys

1. Set `SMART_API_KEY` (their name) and send it as `x-api-key`.
2. Point the sync service at
   `{SMART_BASE_URL}/integration/aims/grading-weights` (or the full `/api/...` URL).
3. Send `aimsCourseId` first; include `courseCode`, `schoolYear`, and `term` for diagnostics.
4. Map `weights.ww / weights.pt / weights.qa` to the course's WW/PT/QA weights and store
   `source`.
5. Show `SMART (class record)` for `SUBJECT_DEFAULT`, `SMART (subject group)` for
   `GROUP_DEFAULT`, and `DepEd fallback` for `GENERIC_FALLBACK` or any HTTP/JSON failure.
6. On `404 AIMS_COURSE_NOT_LINKED`, prompt the teacher to link the course in SMART's Class
   Records UI (AIMS cannot create the link; `POST /api/grades/aims-link` is teacher-JWT only).
7. On `401`, treat as a configuration error and surface it — do not silently apply defaults.
8. Re-sync when a course currently shows DepEd defaults and a SMART link now exists.
9. Re-sync when SMART's `updatedAt` or `weights` changes. SMART never pushes; AIMS must
   pull. Do not keep stale weights just because the course already has weight rows.
