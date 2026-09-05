# SMART ↔ EnrollPro: Remedial-Result Contract — Needed Before Implementation

From: SMART team (Sean)
Re: `ENROLLPRO-SCHOOL-YEAR-LIFECYCLE.md` (2026-08-31) — follow-up on the REMEDIAL_HOLD requirement
Date: 2026-08-31

---

## Where we stand after reviewing your lifecycle doc

We audited SMART against the doc. Everything on our side is aligned except two items:

1. **Publication time in the `sync-grades` response** — we're adding `publishedAt`
   (section-level + per-learner, derived from our FINALIZED timestamps). This is
   in progress on our side; it addresses your release-safety gap #8.

2. **Remedial results** — this one we **cannot start** yet, because the wire
   contract between our systems doesn't exist. That's what this message is about.

## The gap

Your doc says (§Outcome Matrix / §Official Enrollment):

> `REMEDIAL_HOLD` means the learner is excluded from active intake pending an
> **approved SMART remedial-result contract**.

and Grade 10 `CONDITIONALLY_PROMOTED` → Grade 10 `REMEDIAL_HOLD`, plus G7–9
conditionally promoted learners retain a remedial flag into the target year.

So at some point EnrollPro must be able to **pull remedial outcomes from SMART**
(like you pull final outcomes via
`POST /api/integration/smart/sections/:id/sync-grades`) to decide when a
REMEDIAL_HOLD learner can proceed. That endpoint and its payload are not defined
anywhere — not in the lifecycle doc, not in the API docs we have.

## What SMART currently has for remedial (honest inventory)

| Capability | Status |
|---|---|
| Read EnrollPro's `/remedial/pending` list | ✅ works (read-only, as required) |
| Registrar remedial tracker UI | ✅ display-only |
| Remedial class / result data model in SMART DB | ❌ does not exist |
| Teacher/registrar UI to encode remedial ratings | ❌ does not exist |
| Endpoint exposing remedial results to EnrollPro | ❌ does not exist |
| SF10 remedial section | ❌ hardcoded empty placeholder |

## Questions we need answered before we build

1. **Endpoint + direction.** We assume you want to PULL from SMART (same pattern
   as `sync-grades`), e.g.
   `POST /api/integration/smart/sections/:sectionId/sync-remedial` or a
   learner-scoped variant. Confirm, or tell us your preferred shape.
2. **Payload.** Per learner: subject(s) taken in remedial/summer class, final
   rating, pass/fail, publication time, and source school year? Same validation
   posture as `sync-grades` (you reject PARTIAL / missing / unpublished rather
   than us sending fallback values)?
3. **Timing.** Does the remedial window run **after** rollover (learner is
   already in the target year on hold) or **before** (source year, EOSY phase)?
   This decides which school year our queries filter, and when you'd call the
   endpoint.
4. **Data ownership questions:**
   - Who creates the remedial class roster in SMART — does it come from your
     `/remedial/pending` feed, or does our registrar create it manually?
   - Who encodes the remedial rating — SMART teacher, SMART registrar, or both?
   - Is there a deadline concept (e.g., must resolve before a date or the
     learner is dropped)?
5. **What happens on your side when we report "passed"?** Presumably the
   REMEDIAL_HOLD application moves to `READY_FOR_SECTIONING` (G7–9) or the G10
   learner gets a target-year application. And on "failed" — retained with a new
   hold, or dropped? We need the exact state transitions so our audit logs and
   your readiness gates agree.
6. **Timeline.** Is this required for the current EOSY cycle, or is it a
   next-year feature? This decides whether we build it now or after rollover.

## Our proposed starting point (react to this, don't treat as final)

Mirroring the contract that already works for final grades:

```
POST /api/integration/smart/sections/:sectionId/sync-remedial
    ?schoolYear=<source year label>
Auth: same service key as sync-grades (X-EnrollPro-API-Key)
```

```jsonc
{
  "success": true,
  "sectionId": "...",
  "sectionName": "Rizal",          // remedial class group, source-year scope
  "schoolYear": "2025-2026",
  "publishedAt": "2026-04-15T01:00:00.000Z",
  "outcomes": [
    {
      "lrn": "123456789012",
      "studentName": "Dela Cruz, Maria",
      "remedialSubjects": [
        { "subjectCode": "MATH7", "subjectName": "Mathematics", "finalRating": 78, "result": "PASSED" }
      ],
      "overallResult": "PASSED",     // PASSED | FAILED
      "publishedAt": "2026-04-15T01:00:00.000Z"
    }
  ]
}
```

Same rules as `sync-grades`: unpublished/partial learners stay in the array as
blockers with nulls; we never fabricate values; matching is by LRN + school
year, never by name alone.

## Ask

Reply with answers (or corrections to the proposal) for questions 1–6. Once we
agree on the shape, we'll scope and schedule the build on our side — it's a
real feature for us (data model + encoding UI + endpoint), not a quick patch,
so lead time matters.

Everything else from the lifecycle doc: confirmed aligned on our side.
