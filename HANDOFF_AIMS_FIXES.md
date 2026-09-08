# AIMS Integration Fixes — Implementation Handoff

> **READ FIRST:** Read `aims.md` (repo root) before touching anything. It contains the AIMS team's
> contract answers that this work is based on. This doc tells you what to change in SMART.

## Context

AIMS shipped `GET /api/v1/public/courses` and answered our integration questions. A reconciliation
of their answers against SMART's existing AIMS code found **2 contract-breaking bugs (P0)** and
**picker improvements (P1)**. The core sync pipeline (term binning, dedup, import math, fail-soft)
is already correct — do not refactor it.

**Scope: P0 + P1 only.**

Hard rules:
- **No Prisma migration. No schema.prisma changes.**
- **No new dependencies.**
- **Do not touch unrelated code.** No drive-by refactors.
- Follow `AGENTS.md` (TypeScript rules, design system tokens, file size limits, build verification).
- Frontend is `src/`, backend is `server/src/` (see AGENTS.md Gotchas).

---

## Task 1 (P0) — Fix envelope unwrap bug in course list fetch

**File:** `server/src/lib/aimsClient.ts` — `getAimsPublicCourses()` (~line 186)

**Bug:** AIMS `GET /public/courses` responds with:

```json
{ "success": true, "data": { "courses": [ ... ] } }
```

The current code calls `unwrapEnvelope()` (which returns `raw.data`), then checks
`Array.isArray(data)` — but `data` is the **object** `{ courses: [...] }`, not an array.
The check fails, so the function returns `[]` **every time**, even when AIMS returns a
valid course list. The teacher's course picker will always appear empty once AIMS deploys.

**Fix:** After unwrapping, read the nested array:

```ts
const list = Array.isArray(data) ? data : Array.isArray(data?.courses) ? data.courses : [];
```

(Tolerating a bare array keeps the client resilient if AIMS ever simplifies the envelope.)

---

## Task 2 (P0) — Null-safe `enrollproId` (AIMS-native students)

**Files:**
- `server/src/schemas/aims.ts` — `aimsScoreRowSchema` (~line 20)
- `server/src/lib/aimsScoreSync.ts` — `processAimsCourseData()` (~line 112)
- Type ripples: `AimsSyncResult.unmatched` in `aimsScoreSync.ts`, `src/lib/api.ts`, `src/pages/teacher/components/AimsPanel.tsx`

**Bug:** Per `aims.md` §2: AIMS-native accounts (manual create, Google self-reg) serialize
`"enrollproId": null` — never 0, never omitted. Our `aimsScoreRowSchema` requires
`z.number()`. One such student in a course fails `safeParse` for the **entire course payload**,
and `processAimsCourseData` / `runAimsScoreSync` silently skip the whole course's scores.
One ID-less student must not break sync for their whole class.

**Fix:**

1. **Schema** (`server/src/schemas/aims.ts`):
   - `enrollproId: z.number().nullable()`
   - Also make `studentEmail: z.string().nullable()` (defensive; same class of issue).

2. **Sync logic** (`server/src/lib/aimsScoreSync.ts`, `processAimsCourseData()`):
   - Rows with `row.enrollproId == null` must go **straight to `unmatched`**
     (with `studentName` / `studentEmail` so the panel can display them, per the doc:
     "unmatchable, show name/email").
   - **Never** call `prisma.student.findUnique({ where: { enrollproId: null } })` and never
     invoke the `getEnrollProStudentDetail` fallback with null — skip that path entirely.
   - Place the null check before the existing `findUnique` lookup (~line 147).

3. **Widen types** (null ripples):
   - `AimsSyncResult.unmatched[].enrollproId` → `number | null` (both the interface at
     ~line 34 and `CourseProcessResult.unmatched` at ~line 47 in `aimsScoreSync.ts`).
   - `unmatched[].studentEmail` → `string | null`.
   - `AimsUnmatchedStudent` in `src/lib/api.ts` (~line 530): same widening.
   - `AimsPanel.tsx` unmatched chips (~lines 348-351): the chip currently renders
     `EP #{u.enrollproId}` and uses `u.enrollproId` as the React key. Make both null-safe:
     display `EP #…` when present, `no EP ID` (or similar) when null; use a stable key
     (e.g. index or `enrollproId ?? studentName + idx`).

---

## Task 3 (P1) — Course picker: params, fields, school-wide fallback

**Why:** `aims.md` §1 contract notes:
- `teacherEmail` / `teacherName` are **null** for unassigned courses — and teacher emails are
  **often null even for assigned teachers** (EP publishes no faculty emails). So filtering the
  picker by the logged-in teacher's email will frequently return nothing.
- `schoolYear` is "the year this course was last active" — stable across rollovers. Filtering
  by it keeps the list scoped to the current year (no bloat from past years).
- `studentCount` counts active enrollments only.
- Load guidance: cache on dialog-open (current behavior), no timer.

### 3a. Client signature — `server/src/lib/aimsClient.ts`

Replace `getAimsPublicCourses(teacherEmail?: string)` with:

```ts
export interface AimsCourseListOptions {
  teacherEmail?: string;
  schoolYear?: string;
  includeArchived?: boolean;
}
export async function getAimsPublicCourses(opts?: AimsCourseListOptions): Promise<AimsCourseSummary[]>
```

- Build the query string from **defined params only** (`includeArchived=true` when set;
  do not send `includeArchived=false` — omit it, the AIMS default is already false).
- Update the single existing caller (`server/src/routes/grades-sub/aims.ts` ~line 198).

### 3b. Schema + types — new response fields

- `server/src/schemas/aims.ts` — `aimsCourseSummarySchema`: add
  `teacherName: z.string().nullable().optional()` and `studentCount: z.number().optional()`.
- `server/src/lib/aimsClient.ts` — `AimsCourseSummary` interface: add
  `teacherName?: string | null` and `studentCount?: number`.
- `src/lib/api.ts` — frontend `AimsCourseSummary` (~line 561): same two fields.

### 3c. Route — `GET /grades/aims-courses` (`server/src/routes/grades-sub/aims.ts` ~line 186)

Current behavior: fetches by teacher email only. New behavior:

1. Resolve the current school year label via `getActiveSchoolYear()` from
   `server/src/lib/schoolYearResolver.ts` (see how other routes import/use it —
   do not hardcode a year).
2. Fetch with `{ teacherEmail: user?.email, schoolYear }` (when email exists).
3. **Auto-retry fallback:** if the result is empty **and** a teacherEmail was sent, re-fetch
   school-wide for the same school year (`{ schoolYear }` only). Rationale: AIMS teacher
   emails are often null, so an empty teacher-scoped list is the *common* case, not an error.
   The teacher then identifies their course by `teacherName` + subject/section. Safety is
   unchanged — linking already validates ownership on our side and shows mismatch warnings.
4. Respond with a scope flag so the frontend can explain the list:

```json
{ "courses": [...], "scope": "teacher" | "school" | "none" }
```

- `teacher` = teacher-scoped list (non-empty)
- `school` = fallback school-wide list (non-empty)
- `none` = both empty, or AIMS unconfigured/offline (keep existing fail-soft `[]` behavior)

### 3d. Frontend — `src/pages/teacher/components/AimsPanel.tsx`

- `openLinkDialog()` / `availableCourses` state: capture `scope` from the response
  (`gradesApi.getAimsCourses` return type in `src/lib/api.ts` needs the `scope` field too).
- Picker row metadata line (~line 230): append teacher attribution and size, e.g.
  `{c.subject} · {c.sectionName} · {c.schoolYear} · {c.gradeLevel}` → add
  `· {c.teacherName ?? 'Unassigned'}` and `· {c.studentCount} students`
  (omit cleanly when `studentCount` is undefined).
- When `scope === 'school'`: show a small hint above the list:
  "Couldn't match your courses by email — showing all current school-year courses."
  Use muted foreground styling per the design system (`text-xs text-muted-foreground`).
- When `scope === 'none'` and AIMS is configured: keep the existing
  "No courses available… enter ID manually" message.

---

## Tests (required, not optional)

Extend `server/src/__tests__/aims-sync.test.ts` (it already has the harness patterns —
fabricated payloads into `processAimsCourseData`, see existing tests around lines 70-190):

1. **Null `enrollproId`:** a course payload containing one row with `enrollproId: null`
   plus normal rows → parse succeeds, the null row lands in `unmatched`, normal rows
   still upsert (proves one bad student doesn't kill the course).
2. **Null `studentEmail`:** row with `enrollproId: <valid>` and `studentEmail: null`
   → matches student fine, no crash.
3. **Remedial dedup sanity:** rows `QUIZ:<remedialId>` vs `QUIZ:<sourceId>` for the same
   student → both survive dedup (different `assessmentId`s — per `aims.md` §3 item 6).

Run and paste output into the report:
- `npm run build` in `server/` (must pass with zero errors)
- `npm run build` in root (must pass)
- `npm run lint` in root
- Server test suite (however it's run in `server/` — check `server/package.json` scripts;
  if there's no test script, say so in the report and note how tests were executed, e.g. ts-node)

---

## Explicitly OUT of scope (do not do these)

- `sourceQuizId` / `forStudentId` persistence on `AimsScore` (P2 — needs Prisma migration)
- `from=` watermark support on the AIMS client
- Any EnrollPro (`enrollproSync.ts`, `enrollproClient.ts`) or ATLAS sync code changes
- Any refactor of the sync pipeline (binning, dedup, stale sweep, import math — all correct)
- UI redesign of the picker beyond what Task 3 specifies

---

## Report back

When implementation is complete, write **`HANDOFF_AIMS_REPORT.md`** (repo root) containing:

1. **Files changed** — with line references for every change
2. **Test/build/lint results** — actual output (or honest summary), including both builds
3. **Deviations** — anywhere you diverged from this doc and why
4. **Discoveries** — anything found during implementation that this doc missed or got wrong
5. **Open items** — anything left for the human/lead to decide (e.g. ops tasks below)

The lead will return to the planning session with this report for verification against
`aims.md` contract notes.

**Ops notes (no code — just awareness):** AIMS API key still needs OOB sharing + live curl
verify after their deploy; `from=` watermarks come later ("once seeded" per AIMS).
