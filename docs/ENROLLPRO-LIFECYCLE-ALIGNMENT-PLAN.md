# EnrollPro Lifecycle Alignment Plan — SMART Handoff

Date: 2026-08-31
Source document: `mdfiles/ENROLLPRO-SCHOOL-YEAR-LIFECYCLE.md` (sent by EnrollPro dev, "Last reviewed: 2026-08-31")
Status: **1 implementable task, 1 blocked task, several no-ops**

---

## 0. Context — Read This First

EnrollPro sent us their School Year Lifecycle reference doc. It defines the
coordinated EOSY/rollover contract between EnrollPro (identity/enrollment),
SMART (grades/attendance/promotion), ATLAS (schedules), AIMS (LMS), and MRF.

We audited SMART against that doc. Result:

| # | Item | Verdict |
|---|------|---------|
| 1 | `sync-grades` endpoint contract (path, auth, section matching, payload fields) | ALIGNED — no changes |
| 2 | Only FINALIZED grades sync; unpublished grades stay null (blockers on EnrollPro side) | ALIGNED — no changes |
| 3 | Never self-advance school year / term (resolve live from EnrollPro, DB fallback) | ALIGNED — no changes |
| 4 | Historical queries filter by `schoolYear` string only (survive rollover archiving) | ALIGNED — no changes |
| 5 | **Publication time missing from `sync-grades` response** (EnrollPro doc "Code-Verified Release-Safety Gap" #8) | **FIX — Task 1 below** |
| 6 | **Remedial-result contract for `REMEDIAL_HOLD` learners** | **BLOCKED — Task 2 below, do NOT implement yet** |

EnrollPro's doc lists 8 "release-safety gaps". Seven of them are EnrollPro-side
code problems (their code, their fix). Only gap #8 implicates SMART's response
schema: *"SMART publication time is optional in the current response schema and
is not required by rollover matching. The production contract requires
published final outcomes, so a missing publication time must not be treated as
final."*

When EnrollPro remediates their side and starts enforcing publication time,
every SMART `sync-grades` call with the current response shape will fail and
EOSY/rollover will block. We fix our side first. It is a small, safe change.

---

## 1. Task 1 — Add Publication Time to `sync-grades` Response

### 1.1 Objective

Emit a publication timestamp in the `POST /api/integration/smart/sections/:sectionId/sync-grades`
response so EnrollPro can (a) require it, and (b) stamp the versioned
`__smartOutcome` envelope with it.

### 1.2 Files To Touch

| File | Change |
|------|--------|
| `server/src/routes/integration.ts` | Modify `handleSmartSectionSyncGrades` (lines 78–227) |
| `server/prisma/` (conditional) | Backfill migration ONLY IF legacy NULLs found (see 1.6) |

**No frontend changes. No schema model changes. No new routes.**

### 1.3 Data Source — `Grade.finalizedAt`

The Prisma `Grade` model already has everything needed
(`server/prisma/schema.prisma:214-248`):

```prisma
model Grade {
  quarterlyGrade  Float?
  status          GradeStatus @default(DRAFT)   // DRAFT | FINALIZED | ...
  finalizedAt     DateTime?                      // ← line 237, already exists
  updatedAt       DateTime   @updatedAt
}
```

`finalizedAt` is already maintained correctly by existing flows:

- Set on finalize: `server/src/routes/registrar/main.ts:1196`
  (`finalize-grades` sets `finalizedAt: new Date()` when DRAFT → FINALIZED)
- Nulled on unfinalize: `server/src/routes/registrar/main.ts:1258`
  (`unfinalize-grades` sets `finalizedAt: null`)

**Semantics decision (already made — do not relitigate):** publication time =
the moment the grade became FINALIZED. Per-student publication time is the
MAX(`finalizedAt`) across that student's FINALIZED grades in the section.
Section-level publication time is the MAX across all of them.

### 1.4 Exact Edits in `server/src/routes/integration.ts`

All edits are inside `handleSmartSectionSyncGrades`.

#### Edit A — capture finalizedAt in the grades query (line ~122-130)

Current:

```ts
const grades = await prisma.grade.findMany({
  where: {
    classAssignment: { sectionId: section.id, schoolYear },
    status: 'FINALIZED',
  },
  include: {
    classAssignment: { include: { subject: true, teacher: { include: { user: true } } } },
  },
});
```

Change: add `finalizedAt: true` is NOT needed (findMany returns all scalars by
default). **No change to the query itself.** Just note `g.finalizedAt` is
available on every row.

#### Edit B — per-student `publishedAt` in the outcomes map (lines 147-207)

Inside `const outcomes = enrollments.map((enr) => { ... })`, after
`studentGrades` is computed (line 148) and before the `return` (line 197), add:

```ts
const finalizedTimes = studentGrades
  .map((g) => g.finalizedAt)
  .filter((t): t is Date => t !== null);
const publishedAt = finalizedTimes.length > 0
  ? new Date(Math.max(...finalizedTimes.map((t) => t.getTime())))
  : null;
```

Then add to the returned object (after `promotionStatus`, line ~205):

```ts
publishedAt: publishedAt ? publishedAt.toISOString() : null,
```

#### Edit C — section-level fields in the response envelope (lines 209-222)

Add after `outcomesSynced` (line ~220):

```ts
publishedAt: outcomes.every((o: any) => o.publishedAt !== null) && outcomes.length > 0
  ? /* max publishedAt across outcomes */ maxPublishedAtISO
  : null,
```

Implementation detail — compute once, before `res.json`:

```ts
const sectionPublishedTimes = outcomes
  .map((o: any) => o.publishedAt)
  .filter((t: string | null): t is string => t !== null);
const sectionPublishedAt = sectionPublishedTimes.length === outcomes.length && outcomes.length > 0
  ? sectionPublishedTimes.reduce((a, b) => (a > b ? a : b))
  : null;
```

Design rule baked into that expression: **section `publishedAt` is null unless
EVERY learner outcome is published.** A section with one unpublished learner is
not fully published; EnrollPro's readiness gate should see that.

#### Edit D — tighten `ready` semantics (line 211)

Current response always sends `ready: true`. Keep the field for backward
compatibility but make it honest:

```ts
ready: sectionPublishedAt !== null,
```

Rationale: doc gap #8 says missing publication time must not be treated as
final. EnrollPro currently validates per-field anyway (their gate), but we
should not assert readiness we cannot back with a publication time. EnrollPro's
older code ignores `ready` (it re-validates everything), so this is safe.

**IMPORTANT — do NOT drop learners from `outcomes` when unpublished.** EnrollPro's
contract explicitly wants `PARTIAL`, `NG`, missing, and unpublished results
returned as blockers (doc §EOSY Closing, item 5: "remain blockers. EnrollPro
does not create fallback grades"). A learner with zero finalized grades keeps
its outcome row with null grades and `publishedAt: null`. Only the
section-level `ready`/`publishedAt` fields reflect completeness.

### 1.5 Response Shape After The Change

```jsonc
{
  "success": true,
  "ready": true,                        // false if any learner unpublished
  "sectionId": "ck...",
  "sectionName": "Rizal",
  "gradeLevel": "7",
  "program": "...",
  "schoolYear": "2025-2026",
  "adviser": "Juan Dela Cruz",
  "outcomesSynced": 42,
  "publishedAt": "2026-03-27T02:15:00.000Z",   // NEW — section-level
  "outcomes": [
    {
      "lrn": "123456789012",
      "studentName": "Dela Cruz, Maria",
      "subjectGrades": [ /* unchanged */ ],
      "generalAverage": 85,
      "remarks": "Passed",
      "promotionStatus": "Promoted",
      "publishedAt": "2026-03-27T02:15:00.000Z"  // NEW — per-learner
    }
  ]
}
```

Backward compatible: existing consumers (EnrollPro's current sync service) read
known fields and ignore new ones. Two new fields + corrected `ready`.

### 1.6 Legacy Data Check — `finalizedAt` Backfill (CONDITIONAL)

`finalizedAt` does NOT appear in any file under
`server/prisma/migrations/` (verified by grep, 2026-08-31), even though it is in
`schema.prisma`. The column was added out-of-band (likely `prisma db push`
during the T2/T3 batch, see migration `20260829120000_t2_t3_year_term_locks_promotion`).
Consequence: **FINALIZED rows created before that column existed may have
`finalizedAt = NULL`**, and Task 1 would report them as unpublished.

Steps for the implementer:

1. Run this read-only check against the DB (use `server/prisma/query-check.ts`
   as a template, or a one-off script via `npx ts-node`):

   ```sql
   SELECT COUNT(*) FROM "Grade"
   WHERE "status" = 'FINALIZED' AND "finalizedAt" IS NULL;
   ```

2. **If count = 0:** do nothing. Skip to 1.7.
3. **If count > 0:** create a proper migration
   (`server/prisma/migrations/<timestamp>_backfill_finalized_at/migration.sql`):

   ```sql
   UPDATE "Grade"
   SET "finalizedAt" = "updatedAt"
   WHERE "status" = 'FINALIZED' AND "finalizedAt" IS NULL;
   ```

   `updatedAt` is the best available proxy for legacy rows (last write ≈ the
   finalize write). Document the approximation in a SQL comment inside the
   migration. Do NOT touch non-FINALIZED rows.

4. Note: this repo historically uses `prisma db push` (see
   `npm run prisma:push` in AGENTS.md). If the team prefers push over
   migrations, an equivalent one-off backfill script is acceptable — but it
   must be idempotent and committed.

### 1.7 Verification — Task 1

1. `cd server && npm run build` — must pass with zero TS errors.
2. Start backend (`npm run dev` in `server/`).
3. Functional check of the endpoint. Auth note: `serviceAuth`
   (`server/src/middleware/serviceAuth.ts`) requires header
   `x-enrollpro-api-key` matching `ENROLLPRO_API_KEY` **only if that env var is
   set**; if unset it passes through. CSRF already exempts this path
   (`server/src/middleware/csrf.ts:61`).

   ```powershell
   # replace section name/id and school year with real seeded values
   curl.exe -X POST "http://localhost:4000/api/integration/smart/sections/<sectionNameOrId>/sync-grades?schoolYear=2025-2026" -H "x-enrollpro-api-key: <key-if-set>"
   ```

   Expected: response contains `publishedAt` (section + per outcome), and
   `ready` is `true` only when all outcomes have finalized grades.

4. Negative check: unfinalize one subject for one learner
   (registrar unfinalize flow or direct DB `status='DRAFT'` on one grade),
   re-call the endpoint → that learner's `publishedAt` is `null`, section
   `publishedAt` is `null`, `ready` is `false`, learner still present in
   `outcomes` with null grades. Then restore.
5. Run existing backend tests: `cd server && npm test` (if configured — check
   `package.json`; `__tests__/` exists with vitest/jest suites).
6. `cd .. && npm run build` (frontend) — should be a no-op but confirms no
   accidental breakage.

### 1.8 Out of Scope — Task 1 (Do NOT Do)

- Do not add `publishedAt` to any other endpoint.
- Do not change `GradeSnapshot` / promotion / EOSY finalize logic.
- Do not "improve" the response by omitting unpublished learners (contract
  violation, see 1.4 Edit D).
- Do not modify `.env` / `.env.*` (repo non-negotiable).
- Do not refactor neighboring code in the same change.

---

## 2. Task 2 — Remedial-Result Contract (ON HOLD — Decision 2026-08-31)

**Decision: ON HOLD. Prio is rollover.**

Rationale (verified against live DB 2026-08-31 by recomputing promotion for all
80 enrolled learners in SY 2025-2026 using `evaluatePromotion` on FINALIZED
grades): **RETAINED: 80, CONDITIONALLY_PROMOTED: 0**. Per EnrollPro's outcome
matrix, G7-9 RETAINED → same grade `PENDING_CONFIRMATION` with no remedial
flag, so rollover creates zero REMEDIAL_HOLD records and needs no remedial
contract. Implementer: **skip this task entirely.** The contract questions below
remain queued for whenever remedial learners first appear
(`mdfiles/ENROLLPRO-REMEDIAL-CONTRACT-QUESTIONS-2026-08-31.md`).

### 2.1 Original blocker (for when this is unblocked)

EnrollPro's doc requires: `REMEDIAL_HOLD` learners (Grade 10
CONDITIONALLY_PROMOTED, and G7-9 remedial-flag retained) are excluded from
active intake "pending an approved SMART remedial-result contract". That means
EnrollPro must be able to PULL remedial class results (subject, summer class
rating, pass/fail) from SMART — analogous to how it pulls final outcomes via
`sync-grades`.

**The wire contract for this does not exist yet.** The EnrollPro doc does not
specify the remedial endpoint shape, and SMART has no remedial data model to
expose. Building it now means guessing the API shape and likely redoing it.
Before any code: the EnrollPro dev must send us the remedial-result API
contract (or we co-design it).

### 2.2 Current SMART State (Inventory For The Future Implementer)

- `server/src/lib/enrollproClient.ts:873` — `getEnrollProRemedialPending()`:
  SMART READS EnrollPro's `/remedial/pending` list. Read-only, correct
  direction (EnrollPro owns enrollment state).
- `src/pages/registrar/RemedialTracker.tsx` — registrar UI, display-only.
- `server/src/routes/registrar/forms.ts:945` — SF10 generation has
  `remedialClasses: []` hardcoded empty placeholder. (SF10 remedial rendering
  is a separate known gap; the DepEd SF10 form has a remedial section.)
- No `RemedialClass` / `RemedialResult` Prisma models exist.
- No remedial grade entry UI exists for teachers.

### 2.3 Questions To Send The EnrollPro Dev (Owner: Sean)

1. What endpoint will EnrollPro call to pull SMART remedial results?
   (Propose mirroring the existing pattern:
   `POST /api/integration/smart/sections/:sectionId/sync-remedial` or a
   learner-scoped variant.)
2. Payload shape: per-learner subject list with summer rating + pass/fail +
   publication time? Same validation posture as sync-grades (reject PARTIAL /
   missing)?
3. Does the remedial window happen AFTER rollover (target year) or before
   (source year)? This decides which `schoolYear` the query filters — and per
   repo gotcha, remedial is a historical query: filter by `schoolYear` string
   only, never `isActive`/`isArchived`.
4. Expected data model: remedial classes attached to source-year enrollment?
   Who encodes results — SMART teachers or SMART registrar?
5. Timeline: is this needed for THIS EOSY cycle or next year?

### 2.4 Sketch Only — Future Shape (No Code Yet)

When unblocked, expected scope: new Prisma models (`RemedialClass`,
`RemedialResult` with `publishedAt`), teacher/registrar encoding UI, one new
service-auth integration route, CSRF exemption entry in
`server/src/middleware/csrf.ts` (follow the `/sync-grades` `-webhook` pattern),
tests, and SF10 `remedialClasses` population. Estimated a full multi-day
feature — plan it properly when the contract arrives.

---

## 3. Explicit No-Op Confirmations (Do Not "Fix" These)

These were audited and are ALREADY compliant with the lifecycle doc. Listed so
the implementer doesn't burn tokens re-checking or "aligning" them:

1. **Endpoint + auth** — `integration.ts:229-230`, dual paths
   (`/smart/sections/:id/sync-grades` and `/sections/:id/sync-grades`),
   `serviceAuth` with constant-time compare. Matches doc §SMART Final Outcomes.
2. **Section matching** — by id OR case-insensitive name + `schoolYear` label
   (`integration.ts:92-99`). Doc says EnrollPro calls "by shared section name
   and school-year label". Compliant.
3. **Only FINALIZED grades** included (`integration.ts:125`). Unpublished →
   nulls → EnrollPro-side blocker. Matches doc: "EnrollPro does not create
   fallback grades."
4. **Term/year never self-advanced** — `resolveCurrentTerm()` /
   `schoolYearResolver.ts` always hits EnrollPro live, DB fallback when
   offline. Scheduler only locks grades on term end dates. Matches doc §Companion
   Refresh + gotcha about `/active-term` T1-default fallback (gap #6 —
   EnrollPro-side; SMART displays EnrollPro's term as-is, which is all the doc
   asks of consumers).
5. **Historical queries use `schoolYear` string only** — `integration.ts:115-119`
   (comment in code says exactly this). Matches doc §Current And Archived Data.
6. **JHS completer mapping** — `integration.ts:203-205` maps JHS_COMPLETER to
   "Promoted" label in payload; EnrollPro's outcome matrix keeps completers out
   of active target applications on their side. No SMART session is created for
   them because EnrollPro's feeds exclude them. Compliant.
7. **Read-only integration posture** — SMART never writes to EnrollPro
   (doc §Ownership: SMART "publishes" = EnrollPro PULLS via sync-grades; SMART
   only reads EnrollPro feeds). Direction of all existing calls verified.

---

## 4. Guardrails For The Implementer (From AGENTS.md — Binding)

- Max 1000 lines per file. `integration.ts` is ~534 lines; Task 1 keeps it
  well under.
- TypeScript: explicit types, no `any` where avoidable (the handler already
  uses `any` for req/res — follow existing local style, don't churn it).
- Run `npm run build` (root AND `server/`) before finishing.
- Do not modify `.env*`, do not write to external systems, do not refactor
  unrelated code.
- Grade-lock precedence gotcha (archived → year → term → legacy) is untouched
  by Task 1 — don't touch lock logic.
- Keep English, terse code, no comments unless asked (existing file has
  comments — match surrounding density, minimal).

## 5. Definition Of Done

- [ ] Task 1 edits applied (Edits B, C, D in `integration.ts`)
- [ ] Legacy `finalizedAt` NULL check executed; backfill applied only if needed
- [ ] `server/` build passes
- [ ] Functional curl verification (positive + negative) per §1.7
- [ ] Backend tests pass
- [ ] Root `npm run build` passes
- [ ] Task 2 questions (§2.3) sent to EnrollPro dev — Sean's action, not the
      implementer's
- [ ] No other files changed
