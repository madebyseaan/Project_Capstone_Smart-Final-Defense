# AIMS → SMART — Quiz scores missing from the public scores endpoint

**From:** SMART (Student Management and Records Tracking)
**To:** AIMS dev
**Date:** 2026-09-30
**Subject:** `GET /public/courses/:id/scores` does not return a graded quiz that is visible in the AIMS gradebook — SMART cannot import it.

---

## Summary

For course **`EP-84-AP` (Araling Panlipunan - Aguinaldo, id `f5ede360-145d-47a4-87fb-8c3f7e964db3`)**, the AIMS gradebook shows **two** assessments with graded scores:

- **Quiz 1** — WW, online, out of 8 (Valerie 7/8 · Joanna 5/8 · Ryan 3/8 · Eugene 2/8)
- **Performance Task 1** — out of 100 (100/100 ×4)

The public scores endpoint returns **only the Performance Task**. No quiz rows are returned for any of the 4 students, so SMART has nothing to import for WW. This is not a SMART-side filter — SMART stores and shows exactly what the endpoint returns.

We need AIMS to confirm which filter excludes the quiz and resolve it. Based on your own integration guide, it is one of:

1. **Publish/return filter** — only PUBLISHED assessments with `GRADED`/`RETURNED` submissions are exposed (§3.2, §4.10). The quiz has visible scores in the gradebook but may not be published/returned yet.
2. **Shared-quiz limitation (§4.4)** — a quiz assigned from another class is only returned under its owning course (Canto 22 fix pending).

---

## Evidence (verified live 2026-09-30 02:49 +08:00)

Health and term context OK:

```
GET /api/v1/health → 200 { "success": true, "data": { "status": "ok" } }
GET /api/v1/public/school/term-context → 200 { "termIndex": 1, "activeTerm": "T1" }
```

Scores pull for the course:

```
GET /api/v1/public/courses/f5ede360-145d-47a4-87fb-8c3f7e964db3/scores → 200
course: "Araling Panlipunan - Aguinaldo" (EP-84-AP), Grade 7, Section Aguinaldo, SY 2026-2027
weights: { "ww": 40, "pt": 40, "qa": 20 }
rows: 4
```

All 4 returned rows are the TASK:

```json
{
  "assessmentId": "TASK:b98739cc-6be5-46fd-af07-c5d8698b0bff",
  "quizId": null,
  "quizTitle": "Performance Task 1",
  "type": "TASK",
  "category": "PT",
  "gradingWeightId": "0bd7e42b-a5b9-4c96-9e9a-e63cf4cae2f0",
  "score": 100, "maxPoints": 100, "pointsEarned": 100,
  "status": "RETURNED", "attemptNumber": 1, "termIndex": 1
}
```

There are **zero `QUIZ:*` rows** in the response. The gradebook meanwhile shows Quiz 1 for the same 4 students (scores above).

Student AIMS user IDs for tracing quiz submissions:

```
Ryan Cruz     198ab1bd-3bf9-462e-9ab6-712eec43855b
Valerie Cruz  2e08ece4-d060-4d27-98ed-24b66da576ce
Joanna Cruz   a4d5ea77-b1c2-4819-9c1b-846458d0969f
Eugene Cruz   aafebdca-2b0a-41bf-85cc-181a4d1a397c
```

SMART's background sync has been pulling this course every 5 minutes; every pull returns the same 4 TASK rows only. The import dialog consequently lists only "Performance Task 1".

---

## Related observation (pointer to §4.4)

- `EP-81-AP` (Luna, `dbd529dc-4bfa-49bc-950c-6765a1c81a0e`) returns **only** `QUIZ:413ca4a2-aef3-4673-934b-f59f277c179f` "Quiz 1" with `maxPoints: 23`, `passingScore: 60`.
- Aguinaldo's gradebook shows its own "Quiz 1" as **out of 8** — same title, different points.

That pattern (one class returns the quiz with the owner's points, the other class returns nothing) matches the documented **shared-quiz behavior in §4.4** — per-class overrides are not applied and non-owning classes get no rows. If that is the case here, please confirm the owning course and the Canto 22 timeline; otherwise, please check why Quiz 1 in `f5ede360…` is not returned.

---

## Reproduction

```bash
curl -H "x-api-key: <KEY>" \
  "http://100.92.245.14:5000/api/v1/public/courses/f5ede360-145d-47a4-87fb-8c3f7e964db3/scores"
```

Expected (per §3.2): rows for **both** assessments (QUIZ + TASK) with `status` `GRADED`/`RETURNED`.
Actual: TASK rows only; the quiz is absent.

---

## Impact

The teacher cannot import Written Work (Quiz 1) scores into the SMART class record; only the Performance Task imports. If this is the §4.4 limitation, every shared quiz has the same gap for every assigned class.

## Questions for AIMS

1. Why is Quiz 1 (out of 8) in `f5ede360…` absent from `/public/courses/:id/scores`? (Not published? Submissions not RETURNED? QuizAssignment/shared quiz?)
2. If it is a publish/return issue: the gradebook shows graded scores — can you verify the submission statuses for the 4 user IDs above?
3. If it is the §4.4 shared-quiz case: please confirm the owning course and how the assigned class is expected to receive those grades (points override included). ETA for Canto 22?
4. If neither: this is a data/filter bug on the AIMS side we need fixed, since the teacher's graded WW work is unreachable via the public API.

**Contract references (from AIMS → SMART Integration Guide):** §3.2 "What is included", §3.3, §4.4 Shared quizzes, §4.10 `status`, §12 Troubleshooting ("Shared-quiz grades missing").
