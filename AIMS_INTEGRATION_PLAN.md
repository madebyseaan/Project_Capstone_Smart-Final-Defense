# AIMS LMS → SMART Class Record Integration — Implementation Plan

> **STATUS: PLANNING ONLY — nothing in this plan has been implemented yet.**
> This document is the build brief. External prerequisites are tracked in `AIMS_HANDOFF.md`.
> Reference doc for the AIMS API: `AIMS-PUBLIC-API.md` (repo root).

---

## 1. Goal

Pull per-student assessment scores (WW/PT) from the AIMS LMS into SMART class records, display them in the teacher ledger as a distinct read-only column group, and allow an explicit, lock-guarded "import into ledger" action.

## 2. Locked decisions (do not revisit without the owner)

| Decision | Choice |
|---|---|
| Score behavior | **Read-only reference columns + explicit Import action** (import goes through the full grade-write guard chain) |
| Column placement | **Separate "AIMS" group, rightmost** (after Grade Summary) |
| Course linking | **Teacher links the AIMS course in ClassRecordView** (picker + manual-ID fallback) |
| Attempt policy | **Latest graded attempt wins** per (student, assessment); remedial retakes override originals |
| Persistence | **Prisma migration** — DB-backed sync (`AimsScore` table), house pattern |
| API key storage | **`AIMS_API_KEY` env var only** (matches ATLAS token pattern). SystemSettings field + admin UI rotation = future enhancement, not in scope |
| Auth to AIMS | **`x-api-key` public endpoints only.** The old teacher-JWT flow (`POST /aims/auth`, `GET /aims/gradebook`) is dead code and gets removed in this work |

## 3. Critical facts discovered during investigation

These are verified against the current codebase. The implementer must not re-derive them:

1. **`server/src/routes/grades.ts` is a barrel** — real handlers live in `server/src/routes/grades-sub/` (`classes.ts`, `dashboard.ts`, `editRequests.ts`, `helpers.ts`). `classes.ts` is already 1167 lines (>1000-line rule) → **new AIMS endpoints go in a NEW file `grades-sub/aims.ts`**, registered from the barrel.
2. **`server/src/lib/aimsClient.ts` is a stub** — all functions return disabled/empty. Types are defined but nothing makes HTTP calls. Two dead routes exist: `server/src/routes/integration.ts:470-504` (`POST /aims/auth`, `GET /aims/gradebook/:courseId` via `x-aims-token`) + `aimsAuthSchema` in `server/src/schemas/integration.ts`. Remove all of these — they are replaced by this work.
3. **AIMS base URL env already exists**: `AIMS_URL` / `AIMS_BASE_URL` in `server/.env` (both = `http://100.92.245.14:5000/api/v1`). Health check precedent: `server/src/lib/systemHealth.ts:7`. No `AIMS_API_KEY` exists yet.
4. **The EnrollPro numeric learner ID is NOT stored anywhere in SMART.** Students are upserted by LRN only. The map `lrnToEpStudentId` at `server/src/lib/enrollproSync.ts:489-497` is **dead code** (built, logged, never consumed) — this plan makes it the writer for `Student.enrollproId` backfill. `EnrollProStudent.id` (numeric) is defined at `enrollproClient.ts:1072-1101`; the ID→LRN translation endpoint is `getEnrollProStudentDetail(epStudentId)` at `enrollproClient.ts:351-364`.
5. **AIMS gives NO QA category and NO term/quarter concept.** Category mapping is fixed: Quizzes→WW, `WRITTEN_WORK` tasks→WW, `PERFORMANCE_TASK` tasks→PT (AIMS-PUBLIC-API.md:1163). Scores must be **date-binned into T1/T2/T3** using `gradedAt` vs `SystemSettings` termDates (read pattern: `grades-sub/classes.ts:197, 274-281`).
6. **AIMS score row fields** (`AIMS-PUBLIC-API.md:1207-1283`): `enrollproId`, `studentEmail`, `studentName`, `assessmentId` (`"QUIZ:<uuid>"`/`"TASK:<uuid>"`), `quizTitle`, `type`, `category` (`WW|PT`), `isRemedial`, `score` (normalized 0–100), `maxPoints`, `pointsEarned` (raw), `status` (`GRADED|RETURNED`), `attemptNumber`, `gradedAt`. **We import/display RAW values** (`pointsEarned`/`maxPoints`) so ledger HPS/PS math stays consistent. Response envelope: `{ success, data }`.
7. **The existing `GET /dashboard/course/:id/gradebook` is NOT usable** — teacher-JWT only, no `enrollproId`, no raw points, no dates. Only `GET /public/courses/:courseId/scores` (`x-api-key`) has what we need.
8. **There is NO public course-list endpoint on AIMS** — `GET /public/courses` must be requested from the AIMS team (see `AIMS_HANDOFF.md`). Until it exists, course linking uses **manual course-ID entry** validated by a scores fetch. Build the picker behind this fallback from day one.
9. **House sync pattern**: unified cycle in `server/src/lib/syncCoordinator.ts` (`runUnifiedSync`, steps 1/1b/1c/2/3/4 at lines 112-444; `invalidateAllCaches()` at :382-385; `SYNC_COMPLETE` broadcast at :408-429; scheduler at :469-516). Shared HTTP client with retries/timeout/Tailscale-cert handling: `httpGet`/`httpPost` in `server/src/lib/sync/httpClient.ts` (404→null, 5xx retry ×3).
10. **SSE pattern**: `useSyncStream` (`src/hooks/useSyncStream.ts:159`) parses `data:` lines only and refetches on `SYNC_COMPLETE` via a `syncVersion` counter. **Option 1 (chosen): add an `aims` field to the `SYNC_COMPLETE` result payload** — zero frontend protocol changes; `ClassRecordView` (which does NOT currently consume `useSyncStream`) starts consuming it.
11. **NEVER store AIMS data inside `Grade.writtenWorkScores`/`perfTaskScores` JSON outside the guarded import.** `applyMetaToScores` (`src/pages/teacher/hooks/useAssessmentMeta.ts:29-36`) and `executeScoreUpdate`/`executeHpsUpdate`/`executeRemoveTask` (`classRecordActions.ts`) rebuild those arrays on every edit and would corrupt foreign fields. AIMS data lives in its own `AimsScore` table.
12. **Class record GET composition**: `grades-sub/classes.ts:118-293`. It returns the full `classAssignment` row — a new `aimsCourseId` column **automatically appears in API responses with zero handler changes**. The `ClassAssignment` ATLAS upsert (`atlasSync.ts:446-464`) only writes listed fields, so `aimsCourseId` survives syncs untouched.
13. **Grade write guard chain** (must be cloned for import): ownership → `isActive` → enrollment status → `checkGradeEditLocks` (archived → year → term; APPROVED `GradeEditRequest` bypasses TERM only) → current-term rule → FINALIZED skip → merge → server-side `calculateGrades` (never trust client/AIMS computed grades — SMART always transmutes locally) → `$transaction` upsert on `studentId_classAssignmentId_term`. Reference: single save `classes.ts:296-539`, batch `classes.ts:542-738`. **The batch path lacks grade snapshots + audit logs — the import endpoint MUST add both.**
14. **Frontend table invariants** (`src/pages/teacher/components/ClassRecordTable.tsx`, 916 lines): shared `renderColGroup()` at :610-633 (used by BOTH header and body tables — add `<col>` entries once); group header row :776-843; sub-header row :846-871; HPS row :874-891; gender separator colSpan at :568 and :585 = `wwCount + ptCount + 14`; Enter-key navigation uses DOM selectors `[data-row-index][data-cat][data-col]` at :100-102 (plain `<span>` cells are invisible to it — that's the safety property); `LedgerScoreCell` is an uncontrolled `<input>` remounted via `key` containing value. **Column-count invariant: every row (incl. HPS + separators) must equal `wwCount + ptCount + 14 + aimsCount`.**
15. **React.memo stability**: `LedgerRow` is memo'd — the `aimsByStudent` lookup map MUST be `useMemo`-stable in `ClassRecordView` or every row re-renders per keystroke.
16. **Existing ledger tokens** (`src/index.css`, light :34-42 / dark :507-515): WW=indigo, PT=purple, TA=amber, Grade=emerald. **Cyan is unclaimed → AIMS = cyan.**

---

## 4. Architecture

```
Unified Sync Cycle (every 5 min, syncCoordinator)
  1.  EnrollPro sync      ── MODIFIED: also writes Student.enrollproId (backfill)
  2.  ATLAS sync          ── untouched
  3.  Branding sync       ── untouched
  4.  Profile sync        ── untouched
  5.  AIMS sync (NEW)     ── for each ClassAssignment where aimsCourseId != null:
        GET /public/courses/:id/scores   (x-api-key)
        → date-bin gradedAt → T1/T2/T3
        → latest-attempt dedup per (student, assessment)
        → match students by Student.enrollproId
        → upsert AimsScore rows (idempotent)
        → SYNC_COMPLETE { result.aims } → SSE → ClassRecordView refetch

Teacher UI (ClassRecordView)
  ├─ useAimsScoresQuery(classAssignmentId, term, syncVersion)
  ├─ AimsPanel: link/unlink course · last-synced · unmatched list · Import dialog
  └─ ClassRecordTable: rightmost cyan read-only "AIMS" group
        Import → POST /grades/aims-import/:id  → full guard chain → Grade JSON + snapshot + audit
```

---

## 5. Phase 1 — Backend

### 5.1 Prisma migration (`server/prisma/schema.prisma`)

```prisma
model Student {
  // ... existing fields ...
  enrollproId Int? @unique   // EnrollPro numeric learner ID — AIMS↔SMART student align key
}

model ClassAssignment {
  // ... existing fields ...
  aimsCourseId String?       // linked AIMS course UUID — set via teacher link endpoint
}

model AimsScore {
  id               String    @id @default(cuid())
  classAssignmentId String
  studentId        String
  term             Term      // T1 | T2 | T3 — derived by date-binning gradedAt
  assessmentId     String    // "QUIZ:<uuid>" | "TASK:<uuid>" — AIMS composite ID
  assessmentTitle  String
  type             String    // "QUIZ" | "TASK"
  category         String    // "WW" | "PT"
  score            Float     // normalized 0-100 (AIMS `score`)
  pointsEarned     Float     // raw points
  maxPoints        Float     // raw max
  isRemedial       Boolean   @default(false)
  attemptNumber    Int       @default(1)
  gradedAt         DateTime?
  syncedAt         DateTime  @default(now())
  importedAt       DateTime? // set when this row has been imported into the ledger

  @@unique([classAssignmentId, studentId, assessmentId])
  @@index([classAssignmentId, term])
  @@index([studentId])
}
```

- Migration name: `add_aims_integration`. Run via `npm run prisma:migrate`.
- No data migration needed — `enrollproId` backfills automatically from the first EnrollPro sync after deploy (see 5.4).
- Follows the `SchoolYear.externalId Int? @unique` precedent (schema.prisma:362).

### 5.2 `server/src/lib/aimsClient.ts` — full rewrite

Delete all stub functions and the old JWT-based types (`aimsLogin`, `aimsRefreshToken`, `getAimsCourses`, `getAimsCourse`, `getAimsCourseStudents`, `getAimsGradebook`, `getAimsTeacherDashboard`). Keep/implement:

```ts
// Config
const AIMS_BASE = (process.env.AIMS_URL ?? process.env.AIMS_BASE_URL ?? 'http://100.92.245.14:5000/api/v1').replace(/\/$/, '');
const AIMS_API_KEY = process.env.AIMS_API_KEY ?? '';

// Types (mirror AIMS-PUBLIC-API.md exactly)
export interface AimsPublicScoreRow { /* submissionId, userId, studentName, studentEmail, enrollproId: number, assessmentId, quizId, quizTitle, type: 'QUIZ'|'TASK', category: 'WW'|'PT', isRemedial: boolean, sourceQuizId, forStudentId, passingScore: number|null, score: number, maxPoints: number, pointsEarned: number, status: 'GRADED'|'RETURNED', attemptNumber: number, startedAt: string|null, submittedAt: string|null, gradedAt: string|null */ }
export interface AimsPublicScoresData { course: { id, name, code, subject, gradeLevel, sectionName, schoolYear }, weights: { ww: number, pt: number }, rows: AimsPublicScoreRow[] }
export interface AimsCourseSummary { id: string; name: string; code: string; subject: string; gradeLevel: string; sectionName: string; schoolYear: string; archived: boolean; teacherEmail?: string | null }

// Functions
export function isAimsConfigured(): boolean            // AIMS_API_KEY non-empty
export async function checkAimsHealth(): Promise<boolean>  // GET /health, no auth (replaces stub; keep signature — used by systemHealth.ts + integration.ts /status)
export async function getAimsPublicScores(courseId: string): Promise<AimsPublicScoresData | null>
export async function getAimsPublicCourses(teacherEmail?: string): Promise<AimsCourseSummary[]>  // GET /public/courses?teacherEmail= — may 404 until AIMS ships it → return []
```

Rules:
- Use `httpGet` from `./sync/httpClient` (retries, 20s timeout, Tailsacle cert skip built in). Send `{ 'x-api-key': AIMS_API_KEY }`.
- Unwrap the `{ success, data }` envelope. Throw typed `AimsError` on `success: false`; `401` → "AIMS API key rejected", `503` → "AIMS EXTERNAL_API_KEY not configured", `404` → null.
- Validate the payload with a new zod schema (see 5.6) — house pattern from `atlasEffectiveTeachingLoadSchema`.
- Log via `./logger`.

### 5.3 `server/src/lib/aimsScoreSync.ts` — NEW (sync Step 5)

```
runAimsScoreSync(): Promise<AimsSyncResult>
```

Logic per cycle (fail-soft; AIMS offline = skipped step, never breaks the cycle — mirror the branding/profile step pattern, NOT the critical EnrollPro/Atlas pattern):

1. `if (!isAimsConfigured())` → `{ status: 'skipped', reason: 'not-configured' }`.
2. Query all `ClassAssignment` where `aimsCourseId != null` (include `section` for context).
3. For each: `getAimsPublicScores(assignment.aimsCourseId)`:
   - null/unreachable → record offline, continue (per-course isolation).
   - success → process rows:
     a. **Date-bin**: `gradedAt == null` → skip. Else bin by end dates from `SystemSettings` (`t1EndDate/t2EndDate/t3EndDate`): `gradedAt <= t1EndDate` → T1; `<= t2EndDate` → T2; `<= t3EndDate` → T3; else → skip + count as `unbinned`. (End-date-only binning tolerates missing start dates.)
     b. **Dedup**: keep only the latest attempt per `(enrollproId, assessmentId)` — max `attemptNumber`, tie-break `gradedAt`.
     c. **Match students**: `prisma.student.findUnique({ where: { enrollproId } })`. Unmatched → try live resolution once per unknown `enrollproId` (memoized in-run): `getEnrollProStudentDetail(epId)` → `lrn` → find student → **backfill `student.enrollproId`** → match. Still unmatched → collect into `unmatched[]` (persist nothing).
     d. **Upsert** `AimsScore` rows on `@@unique([classAssignmentId, studentId, assessmentId])` — `upsert` with update of all mutable fields; **never overwrite `importedAt`** (preserve provenance).
     e. **Stale sweep**: delete `AimsScore` rows for this classAssignment whose `assessmentId` is absent from the current pull **AND** whose `importedAt == null` (imported rows are provenance — never delete).
4. Result: `{ status: 'ok'|'partial'|'skipped'|'offline', coursesSynced, scoresUpserted, unmatched, lastSyncedAt }`.
5. Cache `lastSyncedAt` + `unmatched` per classAssignment for the read endpoint (either query `MAX(syncedAt)` from `AimsScore` or an in-memory `syncCache` key `aims:last:{classAssignmentId}` — prefer the DB `MAX(syncedAt)` query, no extra state).

### 5.4 `server/src/lib/enrollproSync.ts` — enrollproId backfill (small edit)

In the student upsert paths:
- `newStudentsToCreate` (~:582-594): add `enrollproId: Number(learner.id) || null`.
- `studentsToUpdate` (~:616-641): add `enrollproId` to `data` only when the existing value is null (don't churn on every sync).
- The dead `lrnToEpStudentId` map (:489-497) already has exactly the data needed — wire it in or read `learner.id` directly at the upsert sites.
- Also update `server/src/lib/sync/utils.ts` `upsertLearner` (:56-107) the same way (it creates students too).

First full cycle after deploy backfills the column → AIMS matching starts working.

### 5.5 `server/src/lib/syncCoordinator.ts` — Step 5 wiring

- Add `runAimsScoreSync()` after profile sync (Step 5), every cycle, fail-soft, **non-critical** (does NOT open the circuit breaker; AIMS stays out of `checkCriticalDependencies`).
- Include the AIMS result in the `SYNC_COMPLETE` broadcast payload as `result.aims` (alongside `enrollpro`/`atlas`, syncCoordinator.ts:408-429).
- Log a `SyncHistory` note consistent with existing step logging.

### 5.6 `server/src/schemas/aims.ts` — NEW (zod)

- `aimsPublicScoresSchema` — validates the `GET /public/courses/:id/scores` `data` envelope contents (course, weights, rows with the full field set from AIMS-PUBLIC-API.md:1207-1283).
- `aimsCourseSummarySchema` — for the (future) `/public/courses` list.
- Import/link request schemas (or place these in `schemas/grades.ts` next to the others):
  - `aimsLinkSchema = z.object({ body: z.object({ aimsCourseId: z.string().uuid() }) })`
  - `aimsImportSchema = z.object({ body: z.object({ term: z.enum(['T1','T2','T3']), assessmentIds: z.array(z.string()).optional() }) })`

### 5.7 `server/src/routes/grades-sub/aims.ts` — NEW endpoints

All: `authenticateToken` + `authorizeRoles('TEACHER')` + teacher ownership of the `classAssignmentId` (same pattern as `classes.ts:127-150`). Register from the `grades.ts` barrel.

**`GET /grades/aims-scores/:classAssignmentId?term=T1`**
Returns (200 even when unlinked):
```json
{
  "linked": true,
  "course": { "id": "...", "name": "...", "code": "AIMS-201", "subject": "...", "gradeLevel": "...", "sectionName": "...", "schoolYear": "2024-2025" },
  "weights": { "ww": 30, "pt": 70 },
  "lastSyncedAt": "2026-...",
  "aimsOffline": false,
  "unmatchedStudents": [{ "enrollproId": 21045, "studentName": "...", "studentEmail": "..." }],
  "assessments": [{ "assessmentId": "QUIZ:...", "title": "Q1 Summative", "type": "QUIZ", "category": "WW", "maxPoints": 100 }],
  "rows": [{ "studentId": "<smart id>", "scores": [{ "assessmentId": "QUIZ:...", "pointsEarned": 76, "maxPoints": 100, "score": 76, "isRemedial": false, "attemptNumber": 1, "gradedAt": "...", "importedAt": null }] }]
}
```
- When `linked: false`: everything else null/empty. When AIMS sync has never succeeded: `lastSyncedAt: null`, `aimsOffline: true` (derive from last cycle result), rows still served from DB if present.
- `assessments` ordered: WW first (by `gradedAt` of first appearance, then title), then PT.
- Course payload: cache the AIMS course block from the last successful pull (store on first pull in `syncCache` key `aims:course:{courseId}`, or snapshot into `AimsScore` rows via a `courseJson` — simplest: `syncCache` + refetch-on-miss).

**`POST /grades/aims-link/:classAssignmentId`** (body: `{ aimsCourseId }`)
- Ownership check → `prisma.classAssignment.update({ data: { aimsCourseId } })`.
- Validate the course exists: call `getAimsPublicScores(aimsCourseId)` — 404 → 400 "AIMS course not found".
- **Mismatch warnings in response** (non-blocking): course `schoolYear` ≠ `assignment.schoolYear`; course `sectionName` ≠ `section.name` (case-insensitive); course `subject` ≠ `subject.name`. Return `{ warnings: [...] }` so the UI can display them.
- **Trigger an immediate AIMS sync for this course** (fire-and-forget call into the aims sync internals for this one assignment — do NOT spin the whole unified cycle).
- Audit log entry (ACTION: `AIMS_COURSE_LINK`).

**`DELETE /grades/aims-link/:classAssignmentId`**
- Set `aimsCourseId = null`. **Do NOT delete AimsScore rows** (historical reference). Audit log entry.

**`POST /grades/aims-import/:classAssignmentId`** (body: `{ term, assessmentIds? }`)
- **Clone the full guard chain from the batch save** (`classes.ts:542-738`), in order: ownership → `isActive === false` → 403 → enrollment DROPPED/TRANSFERRED skip → `checkGradeEditLocks` (archived → YEAR → TERM; APPROVED unexpired `GradeEditRequest` bypasses TERM lock only) → current-term rule → FINALIZED grades skipped (reported in response).
- For each student in the roster with matching `AimsScore` rows for the term (filtered by `assessmentIds` when provided):
  - Skip rows with `importedAt != null` (idempotent; response reports `alreadyImported` count).
  - Read the existing `Grade` (term-scoped, unique `studentId_classAssignmentId_term`).
  - **Append** imported items: WW rows → `writtenWorkScores`, PT rows → `perfTaskScores`, each as `scoreItemSchema`-shaped `{ name: assessmentTitle, score: pointsEarned, maxScore: maxPoints, date: gradedAt?.slice(0,10) }`. Never overwrite existing items — append only.
  - Recompute via `calculateGrades(...)` with effective weights — **never persist AIMS's own `quarterlyGrade`/`categoryAverages`**; SMART always computes + transmutes locally.
  - `grade.upsert` in one `prisma.$transaction` per student batch.
  - Set `AimsScore.importedAt = now()` for imported rows (inside the same transaction).
  - **Write `createGradeSnapshot` per touched grade + `createAuditLog` (CREATE/UPDATE)** — the existing batch path lacks these; the import path MUST have them (import is a consequential write).
- Response: `{ savedCount, skipped: { finalized, notFound, alreadyImported }, importedAssessments: [...] }`.
- HG (honors grad) subjects: reject with the same message pattern as the single-save path if applicable.

### 5.8 Cleanup (same PR, in scope)

- Delete `POST /integration/aims/auth` + `GET /integration/aims/gradebook/:courseId` routes (`integration.ts:470-504`) and `aimsAuthSchema` (`schemas/integration.ts`).
- `server/.env.example`: add `AIMS_API_KEY=` under the AIMS section with a comment. **Do NOT touch `.env`** (non-negotiable; the human adds the real key).
- `checkAimsHealth()` stays signature-compatible (used at `integration.ts:322-338` and `systemHealth.ts`).

### 5.9 Env/config

| Var | Where | Notes |
|---|---|---|
| `AIMS_URL` / `AIMS_BASE_URL` | `.env` (exists) | Base URL — already set to `http://100.92.245.14:5000/api/v1` |
| `AIMS_API_KEY` | `.env` (human adds) | The AIMS `EXTERNAL_API_KEY` value. Absent → sync step skips, UI shows "not configured" |

No changes to `server/src/config/env.ts` validation (AIMS stays optional like ATLAS).

---

## 6. Phase 2 — Frontend

### 6.1 `src/index.css` — AIMS ledger tokens (sanctioned exception family)

Light (`:root`, after the grade tokens ~line 42):
```css
--ledger-aims: #0e7490;      /* cyan-700 */
--ledger-aims-bg: #ecfeff;   /* cyan-50  */
```
Dark (`.dark`, after dark grade tokens ~line 515):
```css
--ledger-aims: #22d3ee;               /* cyan-400 */
--ledger-aims-bg: rgba(6, 182, 212, 0.15);
```

### 6.2 `src/lib/api.ts` — types + API methods

Types: `AimsScoresResponse`, `AimsCourseSummary`, `AimsAssessmentInfo`, `AimsRowScore`, `AimsUnmatchedStudent` (mirror 5.7 response exactly).
`gradesApi`: `getAimsScores(classAssignmentId, term)`, `linkAims(classAssignmentId, aimsCourseId)`, `unlinkAims(classAssignmentId)`, `importAims(classAssignmentId, term, assessmentIds?)`.

### 6.3 `src/pages/teacher/hooks/useClassRecord.ts` — add query hook

```ts
useAimsScoresQuery(classAssignmentId, selectedTerm, syncVersion)
```
- `queryKey: ["aims-scores", classAssignmentId, selectedTerm, syncVersion]`, `enabled: !!classAssignmentId`, `staleTime: 60_000`, `placeholderData: (prev) => prev`. The `syncVersion` key makes it refetch on every `SYNC_COMPLETE` (house pattern).

### 6.4 `src/pages/teacher/ClassRecordView.tsx` — wiring

- `const { syncVersion } = useSyncStream();`
- `const aimsQuery = useAimsScoresQuery(classAssignmentId, selectedTerm, syncVersion);`
- **Memoized lookups** (React.memo stability for `LedgerRow`):
  - `aimsAssessments: AimsAssessmentInfo[]` — query data for the selected term, WW-then-PT order.
  - `aimsByStudent: Record<string, Record<string, AimsRowScore>>` — `studentId → assessmentId → score row`.
- Pass to `ClassRecordTable`, `ClassRecordMobileList`, `GradeEditModal` (see 6.5-6.7), render `<AimsPanel>` between `ClassRecordStats` and the ledger.
- Import flow: after `importAims` resolves → `queryClient.invalidateQueries(["class-record", classAssignmentId, selectedTerm])` + refetch aims query (importedAt markers refresh).
- Gate the Import button with `editAccess.isViewOnly` (UI-only; the backend guard chain is authoritative).

### 6.5 `src/pages/teacher/components/AimsPanel.tsx` — NEW

States:
- **Unlinked**: "Link AIMS Course" button → course picker dialog. Picker: `getAimsPublicCourses` list when available; **always** offers "Enter course ID manually" input (works before AIMS ships `/public/courses`). On link: show returned `warnings` (schoolYear/section/subject mismatch) as amber warnings with confirm.
- **Linked**: cyan badge row — course code/name, `lastSyncedAt` (relative, e.g. "synced 2m ago"), `aimsOffline` notice when true, weights note ("AIMS weights 30/70 — SMART uses subject weights"), unmatched-students warning list (name + enrollproId, "student not yet matched — EnrollPro backfill pending").
- **Import**: "Import to Ledger" button → dialog with term (defaults to `selectedTerm`), grouped WW/PT checkbox list of assessments (pre-checked, uncheck = skip), `importedAt` badges on already-imported ones, warning text ("Imported scores append as new ledger columns; existing scores are never overwritten"). Confirm → `importAims` → toast result + invalidations.
- Styling: semantic tokens (`text-foreground`, `bg-card`, etc.) for panel chrome; cyan ledger tokens only inside the ledger/assessment lists. No raw palette colors (AGENTS.md banned patterns).
- All AIMS icons from `lucide-react` (e.g. `CloudDownload`, `Link2`, `Info`).

### 6.6 `src/pages/teacher/components/ClassRecordTable.tsx` — rightmost AIMS group

**Invariant: every row's cell count = `wwCount + ptCount + 14 + aimsCount`.** Touch points (line numbers current, will drift):

1. `renderColGroup()` (:610-633): append after the last `<col ... 64px />`:
   `{aimsAssessments.map((a, i) => <col key={`col-aims-${i}`} style={{ width: "64px", minWidth: "64px", maxWidth: "64px" }} />)}`
2. Header row 1 (:776-843): after the Grade Summary head — group head `colSpan={aimsCount}`, className `` `${thBase} border-r text-[var(--ledger-aims)] bg-[var(--ledger-aims-bg)] z-20` ``, content "AIMS" + small "(read-only)" hint, `id="tutorial-aims-group"`. Render only when `aimsCount > 0` (all appended elements conditional on the same flag so unlinked classes render byte-identical to today).
3. Header row 2 (:846-871): per-assessment sub-headers — truncated title (`title` attr = full title + `maxPoints`), plus a tiny WW/PT tag under/next to it, `text-[var(--ledger-aims)]`. **No `onClick`** (no meta editor for read-only columns).
4. `LedgerRow` (after the FINAL cell, :403-412): read-only **`<span>`** cells (NEVER inputs — keeps them invisible to the Enter-key nav selectors at :100-102):
   - content: `aimsByStudent[studentId]?.[assessmentId]?.pointsEarned ?? <span className="text-slate-300">-</span>` (only when not `isHps`)
   - tooltip (`title`): `"76/100 · Q1 Summative · WW · attempt 1 · graded 2026-04-22"` + "(imported)" when `importedAt`
   - cell class: `` `text-center text-[11px] font-bold border-r border-slate-200 p-0 h-9 ${cellWidth}` `` with `text-[var(--ledger-aims)]`; already-imported rows may add `bg-[var(--ledger-aims-bg)]` tint
   - **HPS row renders the cells too** (as `—`, `bg-slate-800`-consistent styling) — mandatory under `table-fixed` or every column misaligns
   - add `aimsAssessments` + `aimsByStudent` to `LedgerRowProps` and pass through all `LedgerRow` call sites (:578, :595, :602, HPS :874-891)
5. Gender separator rows (:568, :585): `colSpan={wwCount + ptCount + 14}` → `+ aimsCount` (or extract a `totalColumns` const used in all three places).
6. If the file would exceed 1000 lines after these edits, extract the AIMS cell block into `components/AimsCells.tsx` (AGENTS.md file-size rule).

### 6.7 `src/pages/teacher/components/ClassRecordHero.tsx` — badge

In the badge row after the `Section ...` span (~line 53): when linked — cyan pill `"AIMS · {course.code}"` (title = course name + last synced); when unlinked and AIMS configured — subtle "Link AIMS Course" ghost button that opens the AimsPanel dialog. One optional prop + a few lines of JSX.

### 6.8 Mobile components

- `ClassRecordMobileList.tsx`: after the TA chip (~lines 90-113) — when `aimsCount > 0`, two read-only chips `AIMS WW` / `AIMS PT` showing category averages (computed from `aimsByStudent`), colored `text-[var(--ledger-aims)]`. No new editing surface.
- `GradeEditModal.tsx`: **do NOT add a 4th tab** (the `"WW" | "PT" | "QA"` tab union ripples through `useMobileEditor` + props). Instead a read-only "AIMS (read-only)" info block above the tabs (~line 71) — label/value rows per assessment. No inputs, no state.

### 6.9 `src/pages/teacher/components/ClassRecordTour.tsx` — one new step

Append to `TOUR_STEPS` after `task-controls` (~line 198):
```ts
{
  id: "aims-columns",
  targetId: "tutorial-aims-group",
  title: "AIMS Reference Columns (Read-Only)",
  category: "External Data",
  icon: CloudDownload,
  badgeColor: "bg-cyan-50 text-cyan-700 border-cyan-200",
  content: "Cyan columns show learner scores synced from the AIMS LMS. Read-only. Use Import to copy them into your ledger.",
  devTip: "AIMS columns come from the background AIMS sync and are never editable here.",
}
```
Counter/dots auto-derive from `TOUR_STEPS.length` (no other changes). Only visible when the group exists — the tour step should early-skip (or the step list filters) when `aimsCount === 0`; follow how other steps handle absent targets.

---

## 7. Edge-case rules (baked into the spec)

| Case | Rule |
|---|---|
| AIMS offline / key missing | DB serves last-synced data; panel shows `aimsOffline` + last-synced timestamp; sync step skip is non-critical |
| Unmatched student | Cell shows `—`; student listed in panel's unmatched list; auto-resolves after EnrollPro backfill or live `getEnrollProStudentDetail` fallback |
| Multiple attempts / remedial | Latest graded attempt (`max attemptNumber`, tie-break `gradedAt`) — enforced in sync, so consumers never see alternates |
| `gradedAt` outside term windows | Row skipped + counted `unbinned` (panel can surface the count later; not in v1 UI) |
| AIMS weights ≠ SMART weights | Informational note in panel only. SMART math NEVER consumes AIMS averages/quarterly grades |
| QA category | Does not exist in AIMS — never imported, never displayed |
| Import into locked term | Blocked by guard chain (TERM lock needs APPROVED edit request; archived/year locks are absolute). UI disables button with reason |
| Import into FINALIZED grade | Row skipped, reported in response |
| Re-import | Rows with `importedAt` skipped (idempotent). Teacher can `clear-scores` (existing endpoint) to reset the term if truly needed |
| Import vs manual scores | Import APPENDS new score items — never overwrites existing items |
| AIMS course unlinked | `AimsScore` rows retained (reference); columns disappear (aimsCount=0 renders today's exact table) |
| AIMS course schoolYear mismatch | Warning at link time, non-blocking |
| Course deleted/archived on AIMS | Pull fails → per-course offline; stale non-imported rows swept only when a successful pull happens |
| Weight display | Ledger group header shows SMART's effective weights as today; AIMS weights shown only in the panel |

## 8. Non-negotiables (from AGENTS.md / investigation)

- AIMS is **read-only** — no writes to any external system, ever.
- **Never edit `.env` / `.env.*`** — the human adds `AIMS_API_KEY` themselves.
- AIMS data never enters `writtenWorkScores`/`perfTaskScores` JSON except via the guarded import endpoint.
- Server always recomputes grades (`calculateGrades` + local transmutation) — never trust AIMS-computed grades.
- Semantic color tokens only; cyan ledger tokens are the sanctioned exception family for AIMS cells.
- Routes thin → logic in `lib/`; zod validation on all new inputs AND on external AIMS payloads.
- Run `npm run build` (root + server) before finishing; `npm run lint`.
- Do not refactor unrelated code in the same PR.

## 9. Verification checklist

**Automated:**
```bash
cd server && npm run prisma:migrate && npm run build
# new tests in server/src/__tests__/aims-sync.test.ts (or similar):
#   - date-binning: gradedAt vs term end dates (all branches incl. unbinned, null gradedAt)
#   - attempt policy: latest attempt wins, remedial overrides
#   - import guard chain: archived/year/term locks, edit-request bypass, FINALIZED skip, idempotency (importedAt)
cd .. && npm run build && npm run lint
```

**Manual (with the real AIMS host + key):**
1. Health: `GET http://100.92.245.14:5000/api/v1/health` online; `/api/integration/status` shows `aims.online: true`.
2. Link a course → `AimsScore` rows appear after one sync cycle; `lastSyncedAt` set.
3. ClassRecordView shows cyan rightmost group; HPS row renders `—`; gender separator spans correctly; Enter-key nav skips AIMS cells.
4. Import on current term → scores append to WW/PT arrays, PS/initial/final recompute, snapshot + audit rows exist.
5. Import on past term (no edit request) → 403; with APPROVED edit request → succeeds.
6. Dark mode + mobile list + tour step render.
7. AIMS down (stop AIMS or wrong key) → sync step skips, UI shows stale data + offline notice, no 5xx from SMART endpoints.

## 10. File manifest

| File | Action |
|---|---|
| `server/prisma/schema.prisma` | EDIT — `Student.enrollproId`, `ClassAssignment.aimsCourseId`, `AimsScore` model |
| `server/src/lib/aimsClient.ts` | REWRITE — public API client (`x-api-key`) |
| `server/src/lib/aimsScoreSync.ts` | NEW — Step 5 sync + binning + matching |
| `server/src/lib/syncCoordinator.ts` | EDIT — Step 5 + `result.aims` in SYNC_COMPLETE |
| `server/src/lib/enrollproSync.ts` | EDIT — enrollproId backfill |
| `server/src/lib/sync/utils.ts` | EDIT — enrollproId backfill (upsertLearner) |
| `server/src/schemas/aims.ts` | NEW — payload + request schemas |
| `server/src/schemas/integration.ts` | EDIT — remove dead `aimsAuthSchema` |
| `server/src/routes/grades-sub/aims.ts` | NEW — 4 endpoints |
| `server/src/routes/grades.ts` | EDIT — barrel register |
| `server/src/routes/integration.ts` | EDIT — remove 2 dead AIMS routes |
| `server/.env.example` | EDIT — add `AIMS_API_KEY=` |
| `server/src/__tests__/aims-sync.test.ts` | NEW — unit tests |
| `src/index.css` | EDIT — `--ledger-aims(-bg)` light + dark |
| `src/lib/api.ts` | EDIT — types + 4 methods |
| `src/pages/teacher/hooks/useClassRecord.ts` | EDIT — `useAimsScoresQuery` |
| `src/pages/teacher/ClassRecordView.tsx` | EDIT — wiring, memos, panel |
| `src/pages/teacher/components/AimsPanel.tsx` | NEW — link/import UI |
| `src/pages/teacher/components/ClassRecordTable.tsx` | EDIT — AIMS column group (extract `AimsCells.tsx` if >1000 lines) |
| `src/pages/teacher/components/ClassRecordHero.tsx` | EDIT — badge |
| `src/pages/teacher/components/ClassRecordMobileList.tsx` | EDIT — read-only chips |
| `src/pages/teacher/components/GradeEditModal.tsx` | EDIT — read-only info block |
| `src/pages/teacher/components/ClassRecordTour.tsx` | EDIT — 1 step |
