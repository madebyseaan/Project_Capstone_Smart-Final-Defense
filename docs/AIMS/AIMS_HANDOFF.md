# AIMS ↔ SMART Integration — Requirements Handoff

> **Document for the AIMS team.** SMART (Student Management and Records Tracking) is integrating
> with AIMS as a **read-only consumer** of LMS assessment scores. This document states exactly
> what we need from your side, how we will use your API, and what we will never do.
> Your API reference as we received it: `AIMS-PUBLIC-API.md` (shared between both teams).

---

## 1. Who we are / what we're building

SMART is the school's records system (grading, attendance, enrollment, DepEd school forms).
Teachers keep official class-record ledgers (Written Work / Performance Task / Quarterly
Assessment) in SMART. AIMS is the LMS where quizzes and tasks are actually taken.

**Goal:** sync each AIMS course's per-student assessment scores into SMART so teachers can see
them next to their official ledger (distinctly color-coded, read-only), and optionally import
them into the official record through a guarded action.

**Our commitment (non-negotiable):**
- **Read-only.** SMART will never POST/PUT/DELETE anything to AIMS. Only `GET` calls.
- We only call the documented `/public/*` service endpoints with the `x-api-key` header.
- We do not use user JWTs, do not store teacher or student AIMS passwords, and do not
  impersonate users.
- The API key is stored server-side only (environment variable) and never exposed to browsers.
- All traffic stays on the Tailscale network (`100.92.245.14:5000`).

---

## 2. Requirement 1 — Enable the external API key (BLOCKING)

Configure the `EXTERNAL_API_KEY` environment variable on the AIMS server, per your
`External Integration (Service-to-Service)` section.

| Item | Detail |
|---|---|
| Env var on your side | `EXTERNAL_API_KEY` |
| Header we send | `x-api-key: <value>` |
| Share the value | Out-of-band (in person / secure channel). **Do not put it in this repo or chat.** |
| Our storage | `AIMS_API_KEY` in SMART's server `.env` — server-side only |

We rely on the documented behaviors:
- `401` when the key is missing/wrong → we treat as configuration error and stop syncing (surfaced to our admin UI).
- `503` when `EXTERNAL_API_KEY` is unset on your side → we treat as "integration not configured" and skip silently.
- `GET /health` requires no auth — we use it for status checks (already implemented on our side).

**Question for you:** is there any key rotation policy we should build for (e.g. graceful
re-auth after rotation), and can the key be scoped per school in a multi-tenant setup?

---

## 3. Requirement 2 — New endpoint: `GET /public/courses` (NEEDED)

Today the public surface only offers **per-course** endpoints
(`/public/courses/:courseId/scores`, `/public/students/:studentId/grades`). There is **no way
to list courses** with the API key, so SMART cannot render a course picker or validate that a
teacher is linking a course they actually own.

### Proposed contract

```
GET /api/v1/public/courses
Auth: x-api-key (same as other /public endpoints)

Optional query parameters:
  teacherEmail  string   Only courses taught by this teacher (null teacherEmail = unassigned)
  schoolYear    string   e.g. "2025-2026" — filter to that school year
  includeArchived boolean  default false
```

Response (following your envelope convention):

```json
{
  "success": true,
  "data": {
    "courses": [
      {
        "id": "4adeb111-7c78-49dd-bae3-e6721825b4a9",
        "name": "Grade 12 - Mabini",
        "code": "AIMS-201",
        "subject": "Animation",
        "gradeLevel": "Grade 12",
        "sectionName": "Mabini",
        "schoolYear": "2024-2025",
        "teacherEmail": "teacher@gmail.com",
        "teacherName": "Teacher One",
        "archived": false,
        "studentCount": 2
      }
    ]
  }
}
```

Minimum viable version: `id`, `name`, `code`, `schoolYear`, `teacherEmail`, `archived`.
Everything else is nice-to-have. If `teacherEmail` filtering is hard, return the school-wide
list and we will filter client-side — but we do need `teacherEmail` **in the response** to
validate ownership at link time.

**Until this ships**, SMART's fallback is manual course-ID entry (validated by a scores
fetch), so this endpoint is not blocking the integration start — but the picker UX depends on it.

---

## 4. Requirement 3 — Confirm `enrollproId` semantics (BLOCKING)

Every score row in `GET /public/courses/:courseId/scores` carries `enrollproId`
(e.g. `21045`). Per your docs: *"Use `enrollproId` to map back to the student's LRN in
EnrollPro/SMART records (AIMS does not store LRN directly)."*

Please confirm:

1. **`enrollproId` is the same numeric ID** as the learner `id` in EnrollPro's
   Integration v1 learners feed (the value SMART already receives from EnrollPro).
2. **It is always non-null** for students that were imported/synced from EnrollPro.
3. What value appears for students **created directly in AIMS** (never linked to EnrollPro)?
   `null`? `0`? omitted? We will treat null/0/absent as "unmatchable" and simply show those
   learners as unmatched (with name/email shown) — but we need to know what to expect.
4. Is `enrollproId` ever **reassigned** (e.g. a learner record merged in EnrollPro)?

This ID is our only reliable join key between AIMS learners and SMART students.
(We match on it because SMART students are keyed by LRN, and we are adding an
`enrollproId` column to our Student table populated from the EnrollPro feed.)

---

## 5. Requirement 4 — Clarifications on `/public/courses/:courseId/scores`

Assumptions we are coding against — please correct any that are wrong:

| # | Assumption (from your docs / examples) |
|---|---|
| 1 | Only `GRADED`/`RETURNED` rows are ever returned (no IN_PROGRESS). |
| 2 | Only `PUBLISHED` quizzes/tasks in **non-archived** courses are included. |
| 3 | `category` is always `"WW"` or `"PT"`; quizzes + `WRITTEN_WORK` tasks → WW, `PERFORMANCE_TASK` tasks → PT. There is **no QA/quarterly-exam category** in AIMS. |
| 4 | `score` is always normalized 0–100; `pointsEarned`/`maxPoints` are the raw rubric values (quizzes always `maxPoints: 100`). |
| 5 | `attemptNumber` is 1-based, ordered by `startedAt`, per student per assessment. |
| 6 | Remedial attempts have `isRemedial: true` and trace back via `sourceQuizId`/`forStudentId`. They are **separate rows** from the original attempt (same `assessmentId`? or a different one?). **Please clarify this one in particular** — our dedup logic keys on `assessmentId`. |
| 7 | There is **no term/quarter field** on rows — `gradedAt` is the only time anchor, so we date-bin scores into quarters ourselves. Correct? Do topics (e.g. "Quarter 1") have a stable quarter mapping we could use instead? |
| 8 | Query params `from`/`to` filter on `gradedAt` (ISO dates). |
| 9 | Course `schoolYear` in the response reflects the course's own school year, not the current one. |

**Nice-to-have for a future iteration:** include the topic name (and an explicit quarter
label if topics map to quarters) in each score row. Date-binning works without it, but a
canonical quarter label from your side would remove ambiguity for late/early submissions.

---

## 6. How SMART will call your API (load profile)

| Call | Frequency | Notes |
|---|---|---|
| `GET /health` | ~1/min (health checks) | No auth |
| `GET /public/courses` (when shipped) | On demand — teacher opens the link dialog | Plus optional cache |
| `GET /public/courses/:courseId/scores` | Every 5 minutes per **linked** course (our background sync cycle) | Full pull (no `from` watermark in v1). Typical payload: 1 course × 30–50 students × 10–40 assessments |

Expected volume at a small school: **tens of linked courses → a few hundred requests/day,
each < 100 KB**. All from one server (Tailscale IP of the SMART backend). If this is too
hot for you, tell us the rate limit you prefer and we will batch/back off — we can also move
to an every-Nth-cycle cadence (e.g. hourly) or adopt the `from=` watermark.

We treat any `5xx`/timeout as "AIMS offline" and fail soft (serve our last synced data).
We never hammer retries beyond the standard short backoff (3 attempts, exponential).

---

## 7. What SMART will never do

For the record, so it can be reviewed on your side:

- No writes: no `POST`, `PUT`, `PATCH`, `DELETE` to any AIMS endpoint, ever.
- No use of `/auth/*` user endpoints from our server (no password handling).
- No scraping of JWT-only endpoints (e.g. `/dashboard/course/:id/gradebook`) — public
  endpoints only.
- No redistribution: scores are used inside SMART for the school's own teachers/registrar,
  consistent with the multi-tenant scoping you already enforce per `SCHOOL_ID`.

---

## 8. Acceptance checklist (from our side)

We consider the handoff complete when:

- [ ] `EXTERNAL_API_KEY` set on AIMS; value shared out-of-band; verified with:
  ```bash
  curl -H "x-api-key: <KEY>" http://100.92.245.14:5000/api/v1/public/courses/<test-course-id>/scores
  ```
  returning `200 { "success": true, ... }`.
- [ ] `enrollproId` semantics confirmed (Section 4, esp. items 1–3).
- [ ] Assumptions in Section 5 confirmed or corrected (esp. #6 remedial `assessmentId`, #7 no quarter field).
- [ ] `GET /public/courses` either shipped or accepted as a tracked follow-up (manual-ID fallback unblocks us meanwhile).
- [ ] Load profile (Section 6) accepted, or your preferred limits stated.

---

## 9. Contact / coordination

- SMART side integration owner: Sean (SMART codebase, this repo).
- Questions about our consumption patterns, payloads, or scheduling → open an issue in this
  repo referencing `AIMS_INTEGRATION_PLAN.md`.
- Anything about the key value → in person / secure channel only.
