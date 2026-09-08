# AIMS Integration Phase 2 — Implementation Handoff

> **READ FIRST:** Read `aims.md` (repo root) and `HANDOFF_AIMS_REPORT.md` (Phase 1 results) before
> touching anything. Phase 1 (P0+P1 fixes) is complete and verified — build on it, don't redo it.

## Context

AIMS granted our follow-up request (see **Appendix** below): `GET /public/courses` now returns a
`teacherUsername` field (employee number) and accepts it as a server-side query filter. This
unblocks reliable teacher→course matching without emails.

Two work items: **A (employee-number matching)** and **B (teacher refresh button)**. Both
independent; do A first.

Hard rules:
- **No Prisma migration. No schema.prisma changes. No new dependencies.**
- **Read-only towards AIMS — GET requests only.** Never write to AIMS.
- Do not touch unrelated code. Follow `AGENTS.md` (build verification, design tokens).
- Frontend is `src/`, backend is `server/src/`.

---

## Task A — Employee-number course matching

### A1. Schema — `server/src/schemas/aims.ts`

`aimsCourseSummarySchema` (~line 61): add

```ts
teacherUsername: z.string().nullable().optional(),
```

Null when unassigned — and per AIMS, **also null for a handful of legacy accounts** (old seeds,
pre-username era) despite having an assigned teacher. Validation must tolerate both.

### A2. Client — `server/src/lib/aimsClient.ts`

- `AimsCourseSummary` interface (~line 79): add `teacherUsername?: string | null;`
- `AimsCourseListOptions` (~line 93): add `teacherUsername?: string;`
- Query builder in `getAimsPublicCourses()` (~line 200): add

```ts
if (opts?.teacherUsername) params.set('teacherUsername', opts.teacherUsername);
```

### A3. Frontend type — `src/lib/api.ts`

`AimsCourseSummary` interface (~line 561): add `teacherUsername?: string | null;`

### A4. Route — `server/src/routes/grades-sub/aims.ts`, `GET /grades/aims-courses` (~line 186)

Current priority: teacherEmail → school-wide. **New priority:**

1. Load the teacher's employee number:

```ts
const teacher = await prisma.teacher.findUnique({
  where: { userId: req.user?.id },
  select: { employeeId: true },
});
const employeeId = teacher?.employeeId?.trim();
```

(`Teacher.employeeId` is `@unique`, non-null — always present for a TEACHER role user.)

2. **1st try:** `getAimsPublicCourses({ teacherUsername: employeeId, schoolYear })`
3. **2nd try (only if 1st returned empty):** `getAimsPublicCourses({ teacherEmail: user.email, schoolYear })`
   — catches legacy null-username accounts that happen to have an email
4. **3rd try (only if 2nd also empty):** `getAimsPublicCourses({ schoolYear })` → `scope: 'school'`
5. Matches from 1st or 2nd → `scope: 'teacher'`. All empty → `scope: 'none'`.
   Existing fail-soft catch-all (error → `{ courses: [], scope: 'none' }`) unchanged.

### ⚠️ CRITICAL — AND-semantics footgun

AIMS **AND-combines `teacherUsername` and `teacherEmail` when both are passed in one request**
(course must match both). We want either-or matching, so the attempts above must be
**sequential separate calls**. NEVER send `teacherUsername` + `teacherEmail` in the same
`getAimsPublicCourses()` call. Leave a code comment at the route stating this so nobody
"optimizes" it into one call later.

### A5. Legacy null-username behavior (no code)

Courses with `teacherName` set but `teacherUsername: null` (AIMS legacy accounts) will never
match steps 1–2 — they surface via the school-wide fallback, teacher picks by `teacherName`.
This is expected. If you spot any during testing, list them in the report (AIMS will backfill
on request).

---

## Task B — Teacher "Refresh from AIMS" button

### B1. Route — `server/src/routes/grades-sub/aims.ts`

New endpoint: `POST /grades/aims-sync/:classAssignmentId`

- `authenticateToken` + `authorizeRoles("TEACHER")` — no `validate` needed (no body)
- Ownership check: same pattern as every sibling route (teacher profile →
  `prisma.classAssignment.findFirst({ where: { id, teacherId } })`) → 403 if not owned
- If not linked (`aimsCourseId == null`): `400 { message: "No AIMS course linked" }`
- Call the **existing** `syncAimsScoresForAssignment(classAssignmentId)` from
  `../../lib/aimsScoreSync` — **do not write new sync logic**
- Success response:

```ts
{ status: 'ok', scoresUpserted: number, unmatchedCount: number }
```

- AIMS offline / not configured / sync returns nothing: `{ status: 'offline', scoresUpserted: 0, unmatchedCount: 0 }`
  with **HTTP 200** (soft), never a 500. (`syncAimsScoresForAssignment` already returns
  zeroed results when unconfigured/unlinked — handle thrown errors with a try/catch that maps
  to the offline shape, and log the real error.)
- Optional (small): in-memory 60s per-class cooldown (`Map<classAssignmentId, timestamp>` at
  module scope); if within cooldown return `429 { message: "Synced recently — try again in a moment" }`.
  Keep it tiny; no external cache.

### B2. API client — `src/lib/api.ts`

In `gradesApi` (~line 506, next to `getAimsCourses`):

```ts
syncAims: (classAssignmentId: string) =>
  api.post<{ status: 'ok' | 'offline'; scoresUpserted: number; unmatchedCount: number }>(
    `/grades/aims-sync/${classAssignmentId}`,
  ),
```

### B3. Frontend — `src/pages/teacher/components/AimsPanel.tsx` (linked state only)

- New "Refresh" button (lucide `RefreshCw` icon) in the header actions row, beside
  "Import to Ledger" (~line 313)
- `refreshing` state; spinner while running
- On response, toast:
  - `status: 'ok'` + `scoresUpserted > 0` → `toast.success(\`Synced ${n} new score(s)\`)`
  - `status: 'ok'` + `scoresUpserted === 0` → `toast.info('No new scores')`
  - `status: 'offline'` → `toast.info('AIMS offline — try again later')` (info, not error —
    it's a known state, not a failure)
  - HTTP error (403/400/429) → `toast.error(message)`
- After completion (success or offline): call `onImportComplete()` to refetch panel data
- **Enabled even when `isViewOnly` is true** — refresh only updates read-only staging columns,
  never official grades. (The Import button keeps its existing `isViewOnly` disable.)
- Unlinked state: no refresh button (that whole branch is the link dialog anyway)

---

## Tests & verification (required)

Route/client behavior is the change surface; the sync lib is untouched. If a route-level test
harness exists, add:

1. **Username-match priority:** mock `getAimsPublicCourses` — first call (username) returns
   courses → no email call made, `scope: 'teacher'`
2. **Fallback chain:** username empty → email returns courses → `scope: 'teacher'`; both empty →
   school-wide → `scope: 'school'`
3. **Never both params in one call:** assert the mock never receives an options object
   containing both `teacherUsername` and `teacherEmail`

If no route harness exists in the repo, say so in the report — a temporary supertest/curl
scratch script is acceptable, but state exactly what was exercised and include the transcript.

Then run and paste output into the report:
- `npm run build` in `server/` (must pass)
- `npm run build` in root (must pass)
- `npm run lint` in root (zero NEW warnings)
- Server test suite (`vitest run` in `server/`) — no regressions
  (Phase 1 baseline: 144 passed / 57 skipped)

---

## Explicitly OUT of scope (do not do these)

- Auto-import of scores into the ledger (deliberately rejected — import stays a manual click)
- `from=` watermark support; `sourceQuizId`/`forStudentId` persistence (P2 backlog)
- Any EnrollPro or ATLAS changes
- Any writes to AIMS (their API is read-only for us, by design)
- Phase 1 code refactors

---

## Report back

When implementation is complete, write **`HANDOFF_AIMS_REPORT_PHASE2.md`** (repo root) containing:

1. **Files changed** — with line references for every change
2. **Test/build/lint results** — actual output (or honest summary)
3. **Deviations** — anywhere you diverged from this doc and why
4. **Discoveries** — including any legacy null-username courses spotted (for AIMS backfill)
5. **Open items** — anything left for the lead to decide

The lead will verify the report against the AIMS contract notes (appendix below + `aims.md`).

**Ops reminder (no code):** the AIMS API key still needs OOB sharing + live curl verify after
their deploy. Until then, empty pickers and offline toasts are correct fail-soft behavior.

---

## Appendix — AIMS reply (source of truth for this task)

> Done — request granted, system untouched.
>
> **New row field:** `"teacherUsername": "1000003"` — source: `User.username`, the employee
> number written by EP/ATLAS sync (the same value behind ATLAS `faculty.employeeId` === AIMS
> `user.username` matching), so it lines up exactly with SMART `Teacher.employeeId` from the EP
> feed. Null when the course is unassigned — same pattern as `teacherEmail`. Honesty note: a
> handful of legacy accounts (old seeds, pre-username era) have `username: null` despite being
> assigned. If you hit a course with a teacher name but null username, that's why — flag it and
> we'll backfill.
>
> **New query param:** `GET /api/v1/public/courses?teacherUsername=1000003&schoolYear=2028-2029`
> — exact match (employee numbers are numeric strings — no case folding, deterministic).
> **AND-combined with `teacherEmail` when both are passed.** All existing params
> (`teacherEmail`, `schoolYear`, `includeArchived`) behave exactly as before.
