# AIMS → SMART Integration Guide

> **Audience:** SMART developers (Sean + AI agent).  
> **Purpose:** Everything SMART needs to pull assessment scores from AIMS.  
> **Auth model:** service-to-service via static API key (`x-api-key`), no JWT.  
> **Tailscale host:** `100.92.245.14:5000`  
> **API reference:** `docs/api/AIMS-PUBLIC-API.md` (canonical source)

---

## 1. Setup

### API Key

| Item | Detail |
|---|---|
| Header | `x-api-key: <EXTERNAL_API_KEY>` |
| AIMS env var | `EXTERNAL_API_KEY` (set, live) |
| Share | Out-of-band only — never in repo/chat |
| Key rotation | Not supported yet; restart AIMS server after env change |

### Error Behavior

| HTTP | Meaning | SMART action |
|---|---|---|
| `200` | Success | Process response |
| `401` | Missing or wrong key | Stop syncing; surface config error to admin |
| `403` | Insufficient role | N/A (external endpoints skip role checks) |
| `404` | Resource not found | Skip — course/student doesn't exist |
| `503` | `EXTERNAL_API_KEY` not set on AIMS | Treat as "integration not configured"; skip silently |
| `5xx` / timeout | AIMS offline | Serve last synced data; retry with 3× exponential backoff |

### Health Check (no auth)

```bash
curl http://100.92.245.14:5000/api/v1/health
# → { "success": true, "data": { "status": "ok" } }
```

---

## 2. Score Fetching Flow

```
Step 1:  GET /health                          (liveness, ~1/min)
Step 2:  GET /public/courses                   (course picker, on demand)
Step 3:  GET /public/courses/:id/scores        (per-course sync, every 5 min)
Step 4:  GET /public/school/term-context        (resolve current term, on demand)
Step 5:  GET /public/students/:id/grades        (optional — student quarterly profile)
```

---

## 3. Endpoint Reference

### 3.1 `GET /public/courses` — Course Picker

```bash
curl -H "x-api-key: <KEY>" \
  "https://100.92.245.14:5000/api/v1/public/courses?teacherUsername=1000003&schoolYear=2028-2029"
```

**Query params (all optional):**

| Param | Description |
|---|---|
| `teacherUsername` | Employee number (exact match, most reliable join key) |
| `teacherEmail` | Case-insensitive email match (often null for EP-synced teachers) |
| `schoolYear` | Exact label, e.g. `2028-2029` |
| `includeArchived` | `true`/`1` includes archived courses (default: active only) |

**Response shape:**
```json
{
  "success": true,
  "data": {
    "courses": [{
      "id": "uuid",
      "name": "Science - Chemistry - MAKABANSA",
      "code": "EP-2726-SCI_CHEM",
      "subject": "Science - Chemistry",
      "gradeLevel": "Grade 8",
      "sectionName": "MAKABANSA",
      "schoolYear": "2028-2029",
      "teacherEmail": "teacher@gmail.com",     // null if unassigned
      "teacherName": "Teacher One",             // null if unassigned
      "teacherUsername": "1000003",             // null if unassigned or legacy seed
      "archived": false,
      "studentCount": 32                        // active enrollments only
    }]
  }
}
```

**Ownership validation:** match `teacherUsername` against `Teacher.employeeId` from the EP feed. Fall back to `teacherEmail` (often null), then school-wide list. Report any courses with `teacherName` but `teacherUsername: null` for AIMS backfill.

---

### 3.2 `GET /public/courses/:courseId/scores` — Per-Course Score Pull

```bash
curl -H "x-api-key: <KEY>" \
  "https://100.92.245.14:5000/api/v1/public/courses/<courseId>/scores?termIndex=2"
```

**Query params (all optional):**

| Param | Description |
|---|---|
| `studentId` | UUID — limit to one student |
| `type` | `QUIZ` or `TASK` — filter by assessment type |
| `from` | ISO date — `gradedAt >= from` |
| `to` | ISO date — `gradedAt <= to` |
| `termIndex` | `1`, `2`, or `3` — only scores stamped with this active term |

**Response shape:**
```json
{
  "success": true,
  "data": {
    "course": {
      "id": "uuid",
      "name": "...",
      "code": "...",
      "subject": "...",
      "gradeLevel": "...",
      "sectionName": "...",
      "schoolYear": "2028-2029"
    },
    "weights": { "ww": 30, "pt": 70 },
    "rows": [{
      "submissionId": "uuid",
      "userId": "student-uuid",
      "studentName": "Juan Dela Cruz",
      "studentEmail": "student@school.edu",
      "enrollproId": 21045,
      "assessmentId": "QUIZ:<uuid>",
      "quizId": "<uuid>",
      "quizTitle": "Q1 Summative",
      "type": "QUIZ",
      "category": "WW",
      "isRemedial": false,
      "sourceQuizId": null,
      "forStudentId": null,
      "passingScore": 75,
      "score": 76,
      "maxPoints": 100,
      "pointsEarned": 76,
      "status": "GRADED",
      "attemptNumber": 1,
      "termIndex": 2,
      "startedAt": "2026-04-22T10:00:00.000Z",
      "submittedAt": "2026-04-22T10:15:00.000Z",
      "gradedAt": "2026-04-22T10:16:00.000Z"
    }]
  }
}
```

---

## 4. Field Semantics — What SMART Must Know

### `category` — the grade bucket

| Value | Meaning | Source |
|---|---|---|
| `WW` | Written Work | Quiz (default), Task (`ASSIGNMENT`, `WRITTEN_WORK`) |
| `PT` | Performance Task | Task (`PERFORMANCE_TASK`) |
| `QA` | Quarterly Assessment | Quiz (`QUARTERLY_ASSESSMENT`), Task (`QUARTERLY_ASSESSMENT`) |

Grade computation: WW and PT feed the weighted quarterly formula. QA is labeled but currently computes as WW in AIMS — SMART should treat QA as its own bucket if the school uses it.

### `termIndex` — which term the score belongs to

| Value | Meaning |
|---|---|
| `1`, `2`, `3` | Active EP term when this submission was graded |
| `null` | Pre-term-aware submission (graded before this feature shipped) or EP was unreachable at grade time |

**Important:** `termIndex` = "active term when graded", NOT "which term the work belonged to." AIMS has no concept of which term work belongs to — it only knows the current active term at grading time. For finer date-binning, use `gradedAt`.

### `enrollproId` — joining to EP/SMART

| Value | Meaning |
|---|---|
| numeric | EP enrollment-record ID for the current school year (set by roster sync or student login) |
| `null` | AIMS-native account (never linked to EP) — treat as "unmatchable" |

**Not immutable:** `enrollproId` is reassigned when EP reseeds sections (year-scoped IDs). Re-resolve from the EP feed per school year. SMART's `Teacher.employeeId` column populated from the same EP feed matches AIMS `teacherUsername`.

### `assessmentId` — dedup key

Format: `QUIZ:<uuid>` or `TASK:<uuid>`. Each quiz has its own UUID, so remedial quizzes get a **different** `assessmentId` than the original. Link original ↔ remedial via `sourceQuizId` + `forStudentId` (`isRemedial: true`).

### `score` vs `pointsEarned` / `maxPoints`

- `score` — normalized 0–100 (quizzes: stored %; tasks: `pointsEarned / maxPoints × 100`)
- `pointsEarned` / `maxPoints` — raw rubric points (quizzes always `maxPoints: 100`)
- `passingScore` — quiz passing threshold (null for tasks)

### `attemptNumber`

1-based per student per assessment, ordered by `startedAt` (quizzes) or `gradedAt` (tasks). Remedial quizzes restart at attempt 1 (separate `assessmentId`).

### `status`

Only `GRADED` or `RETURNED` rows appear. `IN_PROGRESS` / `SUBMITTED` / `MISSING` / `EXCUSED` are excluded.

---

## 5. Term Context

```bash
curl -H "x-api-key: <KEY>" \
  "https://100.92.245.14:5000/api/v1/public/school/term-context"
# → { "success": true, "data": { "termIndex": 2, "activeTerm": "T2" } }
```

Use this to:
- Know which term is currently active
- Interpret `termIndex` values on score rows
- Decide whether to filter by `?termIndex=N` or use all-term reads

If `termIndex: null` (EP unreachable), fall back to date-based binning using `gradedAt`.

---

## 6. Student Quarterly Profile (optional)

```bash
curl -H "x-api-key: <KEY>" \
  "https://100.92.245.14:5000/api/v1/public/students/<studentId>/grades"
```

Returns per-course: `categoryAverages` (ww, pt), `quarterlyGrade`, `assessmentCount`, `completedAssessmentCount`. Courses without a teacher are omitted.

Quarterly grade formula: `(WW_avg × w_ww + PT_avg × w_pt) / (w_ww + w_pt)` — only categories with ≥1 graded submission participate.

---

## 7. Load Profile

| Endpoint | Frequency | Notes |
|---|---|---|
| `GET /health` | ~1/min | No auth |
| `GET /public/courses` | On demand (dialog open) | Cache locally |
| `GET /public/courses/:id/scores` | Every 5 min per linked course | Full pull; typical payload < 100 KB |
| `GET /public/school/term-context` | On demand (session init) | Cache for session duration |

Expected volume: tens of linked courses → few hundred req/day. All from one Tailscale IP. No rate limits on AIMS side.

---

## 8. Sync Cycle Recommendation

```
1. On session init:
   GET /public/school/term-context → cache { termIndex, activeTerm }

2. On teacher opens link dialog:
   GET /public/courses?teacherUsername=<empId> → populate picker

3. Every 5 min per linked course:
   GET /public/courses/:id/scores?termIndex=<current>
   → diff against last pull → update changed rows

4. On term change (termIndex differs from cached):
   Re-pull all linked courses with new termIndex
   OR pull all-term (no termIndex param) for historical reconciliation

5. Fallback:
   5xx/timeout → serve last synced data
   401 → stop syncing, alert admin
   503 → skip silently (integration not configured)
```

---

## 9. What SMART Will Never Do (contract)

- No writes: no `POST`, `PUT`, `PATCH`, `DELETE` to any AIMS endpoint
- No use of `/auth/*` user endpoints (no password handling)
- No scraping of JWT-only endpoints (e.g. `/dashboard/course/:id/gradebook`)
- No redistribution of scores outside the school's own teachers/registrar
- API key stored server-side only, never exposed to browsers

---

## 10. Files Changed (AIMS repo, for reference)

| File | What changed |
|---|---|
| `server/prisma/schema.prisma` | `TaskType.QUARTERLY_ASSESSMENT` enum; `Submission.termIndex`; `TaskSubmission.termIndex` |
| `server/prisma/migrations/20260908000001_*` | Adds QUARTERLY_ASSESSMENT to TaskType enum |
| `server/prisma/migrations/20260908000002_*` | Adds termIndex to submissions + task_submissions |
| `server/src/services/dashboard.service.ts` | `GradeCategory` includes QA; quiz/task category mapping checks taskType |
| `server/src/services/public-integration.service.ts` | `getPublicCourses` (new); score rows include termIndex + category QA; termIndex filter |
| `server/src/services/submission.service.ts` | Stamps termIndex at grade time (4 grading paths) |
| `server/src/services/task.service.ts` | Stamps termIndex at grade time (2 grading paths) |
| `server/src/services/enrollpro.service.ts` | `resolveCurrentTermIndex()` helper |
| `server/src/controllers/public.controller.ts` | `listCourses`, `schoolTermContext`, termIndex param in courseScores |
| `server/src/routes/public.routes.ts` | `GET /courses`, `GET /school/term-context` |
| `docs/api/AIMS-PUBLIC-API.md` | Full endpoint docs for all public endpoints |
| `docs/AIMS-SMART-INTEGRATION.md` | This file |

---

## 11. Test Data (seeded on dev)

Run `npm run seed:smart-scores` (or `npx tsx scripts/seed-real-smart-scores.ts`) to seedgraded scores on real EP-synced classes. Idempotent.

### Teacher 1: Jose Gabriel Santos (2000061)
- **Course:** `EP-114-ENG` — English - Makabansa (5 students)
- **Quizzes:**
  - "Reading Comprehension - Short Story Analysis" — `category: "WW"` (WRITTEN_WORK)
  - "Quarterly Assessment - English Communication Skills" — `category: "QA"` (QUARTERLY_ASSESSMENT)
- **Task:** "Persuasive Essay - Should Homework Be Abolished?" — `category: "PT"` (PERFORMANCE_TASK)
- **Submissions:** 5 students × 3 assessments = 15 graded rows, all `termIndex: 2`

### Teacher 2: Ricardo Santos (2000065)
- **Course:** `EP-108-SCI_CHEM` — Science - Chemistry - Aguinaldo (5 students)
- **Quizzes:**
  - "Cell Structure and Function Quiz" — `category: "WW"` (WRITTEN_WORK)
  - "Quarterly Assessment - Ecology and Biodiversity" — `category: "QA"` (QUARTERLY_ASSESSMENT)
- **Task:** "Science Investigation - Plant Growth Experiment" — `category: "PT"` (PERFORMANCE_TASK)
- **Submissions:** 5 students × 3 assessments = 15 graded rows, all `termIndex: 2`

### Verify with:
```bash
# Teacher 1 courses
curl -H "x-api-key: <KEY>" "http://100.92.245.14:5000/api/v1/public/courses?teacherUsername=2000061"
# Teacher 1 scores
curl -H "x-api-key: <KEY>" "http://100.92.245.14:5000/api/v1/public/courses/3f748629-fd7b-43d3-9237-86331791790d/scores"
# Teacher 2 scores
curl -H "x-api-key: <KEY>" "http://100.92.245.14:5000/api/v1/public/courses/2626f42e-d5e4-49f7-935c-98c0ee147aff/scores"
# Current term
curl -H "x-api-key: <KEY>" "http://100.92.245.14:5000/api/v1/public/school/term-context"
```

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` | Wrong key or not set | Check `EXTERNAL_API_KEY` in AIMS `.env` |
| `503 External API key not configured` | AIMS has no `EXTERNAL_API_KEY` set | AIMS admin sets the env var and restarts |
| `404 Course not found` | courseId doesn't exist or is from wrong school | Re-fetch course list; verify school scope |
| Courses show `teacherUsername: null` | Teacher account predates username field | Send list to AIMS for backfill |
| `termIndex: null` on recent scores | EP was unreachable when those were graded | Normal — future grades will have termIndex |
| Scores missing for a student | Student enrollment may be archived | Check with `includeArchived=true` on course list |
| `category: "WW"` on a QA quiz | Quiz taskType not set to QUARTERLY_ASSESSMENT | Teacher needs to set Category in quiz settings |
