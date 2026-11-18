# AIMS Subject Grading Weights — Investigation & Plan

**Date:** 2026-11-18
**Status:** DRAFT — blocked on AIMS reply
**Scope:** Expose SMART's grading weights to AIMS at the **subject** level, without requiring an AIMS course ↔ SMART class link.
**Related:** `docs/AIMS/HANDOFF_AIMS_GRADING_WEIGHTS_2026-11-18.md`, `docs/AIMS/HANDOFF_AIMS_GRADING_WEIGHTS_ADDENDUM_2026-11-18.md`

---

## 1. Why this plan exists

The first handoff implemented `GET /api/integration/aims/grading-weights` keyed by
`ClassAssignment.aimsCourseId`. That works technically, but it couples weight sync to a
teacher-created AIMS link.

Actual state: AIMS has 441 active courses and only 2 linked SMART classes. That means 439
courses cannot receive weights even though the weights are known from the subject alone.

AIMS asked for **the grading weights of subjects**. In SMART, weights are already a
subject-level property. The class link is only needed to map AIMS students/scores to a SMART
ledger. Requiring the link for weight sync is a contract coupling, not a data requirement.

---

## 2. Investigation findings

### 2.1 Weight resolution is NOT hardcoded at runtime

`server/src/routes/grades-sub/helpers.ts:222` — `resolveEffectiveWeightsForClassAssignment`

Precedence:

| Tier | Source | Response `source` |
|---|---|---|
| 1 | `Subject.writtenWorkWeight / perfTaskWeight / quarterlyAssessWeight` (all three set) | `subject-override` |
| 2 | `GradingConfig` row for `Subject.type` | `subject-type` |
| 3 | `GENERIC_FALLBACK_WEIGHTS` = 20/50/30 (`helpers.ts:48`) | `generic-fallback` |

The resolver takes a `ClassAssignment` id only to reach its `Subject`; the weights themselves
do not depend on section, teacher, term, or class.

Current pre-wipe database snapshot:

| `GradingConfig.subjectType` | WW | PT | QA/TE | `isDepEdDefault` |
|---|---|---|---|---|
| CORE | 20 | 50 | 30 | true |
| MATH_SCIENCE | 20 | 50 | 30 | true |
| MAPEH | 20 | 60 | 20 | true |
| TLE | 20 | 60 | 20 | true |

- `Subject` rows with any weight override: **0**.
- Subject type distribution: 130 CORE (includes `STE_*`), 15 MAPEH (includes `SPA_*`/`SPS_*`), 16 TLE, 0 MATH_SCIENCE.
- All subjects currently resolve via tier 2 (`subject-type`).

### 2.2 Hardcoded parts (and the traps)

| Location | What is hardcoded | Impact |
|---|---|---|
| `helpers.ts:48` | Generic fallback 20/50/30 | Only used if no `GradingConfig` row exists for the subject type |
| `server/src/routes/admin-sub/grading.ts:44` | Default configs seeded on `GET /grading-config`: CORE/MATH_SCIENCE 20/50/30, MAPEH/TLE 20/60/20 | These are the canonical DepEd defaults |
| `server/src/routes/admin-sub/grading.ts:58` | GET rewrites any row still flagged `isDepEdDefault` back to the hardcoded defaults | Direct DB edits can silently revert; Admin UI saves set the flag false, so UI edits persist |
| `src/pages/admin/components/SubjectWeightsPanel.tsx:92,116,231,247` | Display fallbacks `?? 20`, `?? 50`, `?? 30` | UI only; not the calculation source |
| `server/prisma/seed.ts` | Deletes `GradingConfig` but does not recreate rows | See wipe trap below |

**Wipe trap:** `server/scripts/wipe-academic.ts` deletes `GradingConfig`. Until an admin
opens Admin → Grading Config (the GET re-seeds defaults), all subjects resolve to the generic
fallback 20/50/30. MAPEH/TLE subjects would temporarily get the wrong group values and AIMS
would report `GENERIC_FALLBACK`.

### 2.3 Admin UI grouping caveat

`src/pages/admin/GradingConfig.tsx:32` groups CORE + MATH_SCIENCE into one visible card and
MAPEH + TLE into another (`groupWith`). However:

- `handleWeightChange` only edits the selected `subjectType`.
- `handleSave` only PUTs rows whose values changed.
- The hidden sibling group is never updated.

Today this is masked because the paired defaults are identical and no subject is typed
`MATH_SCIENCE`. If an admin customizes CORE or MAPEH, the hidden sibling group keeps the old
values, so subjects in that group silently diverge.

### 2.4 Per-subject override panel caveat

`src/pages/admin/components/SubjectWeightsPanel.tsx` dedupes rows by base code:

```ts
const baseCode = s.code.replace(/\d+$/, "").replace(/_$/, "").toUpperCase();
```

`SCI_BIO7`, `SCI_BIO8`, `SCI_BIO9`, `SCI_BIO10` collapse to one visible row, so per-grade
overrides cannot be managed reliably. If AIMS later receives grade-specific weights, admins
must be able to see and edit the exact subject row.

### 2.5 Program handling

Weights do not read `Section.program`. The program effect is applied once at subject creation
through `inferSubjectTypeFromCode` (`server/src/lib/atlasUtils.ts:34`):

| Subject code | Type | Weight group |
|---|---|---|
| `STE_*` | CORE | 20/50/30 |
| `SPA_*`, `SPS_*` | MAPEH | 20/60/20 |
| `TLE_*`, `EPP*` | TLE | 20/60/20 |
| `MAPEH*`, `ARTS*`, `MUSIC*`, `PE*`, `HEALTH*` | MAPEH | 20/60/20 |
| everything else | CORE | 20/50/30 |

This matches `docs/GRADING-SYSTEM-STATUS.md` and `docs/PROGRAM-SUPPORT-PLAN.md` (STE follows
core weights, SPA/SPS follow MAPEH weights). Program-level weight profiles are not implemented
and are not currently required by DepEd policy in this repo.

### 2.6 Link coupling and the broken `courseCode` fallback

`server/src/routes/integration-sub/aimsGradingWeights.ts`:

- `aimsCourseId` lookup → `ClassAssignment.aimsCourseId` (`:67`). No linked row → `404 AIMS_COURSE_NOT_LINKED`.
- `courseCode` lookup → `findByCourseCode` (`:87`) searches all class assignments by `Subject.code`.
  - `EP-95-SCI_BIO` strips to `SCI_BIO` (`:80`).
  - Exact match hits the base `SCI_BIO` subject, which has no class assignments.
  - Prefix `SCI_BIO*` matches multiple sections (Rose, Sampaguita, Tulip…) → ambiguous / `409`.
  - Even `SCI_BIO9` matches three sections → ambiguous.
- Therefore, in practice, the only successful path today is a teacher-created link.

This is the mismatch: weights are subject-wide, but lookup is class-wide.

### 2.7 QA vs TE terminology (the screenshot question)

The labels in the screenshot are hardcoded UI strings:

- `src/pages/admin/GradingConfig.tsx:458` — "Written Work (WW)"
- `src/pages/admin/GradingConfig.tsx:477` — "Performance Task (PT)"
- `src/pages/admin/GradingConfig.tsx:496` — "Term Examination (TE)"

Data/API keys are not renamed:

- DB model: `quarterlyAssessWeight`, `quarterlyAssessScore`, `quarterlyAssessMax`, `qaDescription`, `qaDate`
- API weights: `{ ww, pt, qa }`
- AIMS public score category: `WW | PT | QA` (`server/src/schemas/aims.ts:25`)

So `QA` (Quarterly Assessment) and `TE` (Term Examination) are the **same bucket**. AIMS does
not need to fetch the label. It should keep sending/fetching `qa` as the key; "Term
Examination" is a SMART display label only.

Additional nuance: SMART's TE is a composite of ST1 30% / ST2 30% / TE 40% (see the helper
text under the TE input). AIMS imports one QA score into the composite bucket and does not
need the ST1/ST2/TE breakdown. On QA import, SMART clears the breakdown so the composite
remains authoritative (`server/src/lib/aimsImport.ts`).

**Optional improvement:** add a `categoryLabels` object to the weights response
(`{ ww: "Written Work (WW)", pt: "Performance Task (PT)", qa: "Term Examination (TE)" }`) so
AIMS can render SMART's labels. This is cosmetic; the keys must remain `ww/pt/qa`.

---

## 3. Proposed contract (subject-first, link optional)

### 3.1 Route and auth

Keep the existing route and key:

```
GET /api/integration/aims/grading-weights
x-api-key: <AIMS_SERVICE_API_KEY>
```

Extend the query so a subject can be resolved without an AIMS course link.

### 3.2 Query parameters

| Param | Required | Meaning |
|---|---|---|
| `subjectCode` | Preferred (subject mode) | SMART canonical code, e.g. `SCI_BIO9` |
| `subjectName` + `gradeLevel` | Alternative (subject mode) | e.g. `Science - Biology` + `Grade 9`; resolved with `normalizeSubjectName` |
| `aimsCourseId` | Optional | Existing class-linked mode; returns class context when linked |
| `aimsCourseIds` | Optional (batch) | Existing batch mode, max 50 |
| `courseCode` | Optional fallback | Best-effort `EP-<n>-<BASE>` normalization; never authoritative |
| `schoolYear` | Optional | Scopes class lookups and disambiguates duplicate subject rows |
| `term` | Optional | Echo only; weights are term-independent |

At least one subject key or `aimsCourseId`/`aimsCourseIds` must be present.

### 3.3 Resolution algorithm (subject mode)

1. Resolve the `Subject` row:
   - exact `subjectCode` (case-insensitive), or
   - `subjectName` + grade extracted from `gradeLevel` / trailing name suffix.
2. If zero matches → `404 SUBJECT_NOT_FOUND`.
3. If multiple matches and no `schoolYear`/grade disambiguation → `409 AMBIGUOUS_SUBJECT`.
4. Resolve weights with the same precedence as the ledger:
   - subject override → group default → generic fallback.
5. Return the subject payload. No `ClassAssignment` read is required.

### 3.4 Response — subject mode

```json
{
  "resolvedBy": "SUBJECT",
  "linked": false,
  "subjectCode": "SCI_BIO9",
  "subjectName": "Science - Biology 9",
  "subjectType": "CORE",
  "schoolYear": "2026-2027",
  "source": "GROUP_DEFAULT",
  "isFallback": false,
  "weights": { "ww": 20, "pt": 50, "qa": 30 },
  "weightsSum": 100,
  "weightsValid": true,
  "term": "T1",
  "termScoped": false,
  "updatedAt": "2026-11-11T17:46:45.102Z"
}
```

### 3.5 Response — class mode (unchanged, additive)

Existing fields stay. Add `resolvedBy: "CLASS_LINK"`. When the AIMS course is unlinked but a
subject key is also supplied, resolve by subject and return `linked: false` instead of 404.

### 3.6 Error codes

| Status | Code | When |
|---|---|---|
| `400` | `INVALID_QUERY` | No usable lookup key; malformed UUID/term/schoolYear |
| `400` | `TOO_MANY_COURSES` | More than 50 IDs in a batch |
| `401` | `UNAUTHORIZED` | Missing/wrong key, or `AIMS_SERVICE_API_KEY` unset |
| `404` | `SUBJECT_NOT_FOUND` | No matching SMART subject |
| `404` | `AIMS_COURSE_NOT_LINKED` | No link **and** no subject key supplied |
| `409` | `AMBIGUOUS_SUBJECT` | Multiple subjects match; send `subjectCode` or `gradeLevel` |
| `409` | `AMBIGUOUS_AIMS_COURSE_LINK` | Existing class-link ambiguity |
| `500` | `INTERNAL_ERROR` | Unexpected failure |

### 3.7 AIMS course → SMART subject mapping

Preferred: AIMS sends `subjectCode` using the SMART canonical code. If AIMS cannot store it,
support a best-effort derivation:

```
EP-<number>-<BASE>  +  course.gradeLevel  →  <BASE><grade>
EP-95-SCI_BIO       +  Grade 9            →  SCI_BIO9
```

Fallbacks in order:

1. `subjectCode` from AIMS mapping table (authoritative).
2. Derived `<BASE><grade>`.
3. `subjectName` + `gradeLevel` match via `normalizeSubjectName`.

Ambiguity must fail closed (`409`), never guess.

---

## 4. Implementation plan

### Phase 0 — AIMS decisions (blocking)

- Confirm AIMS can send `subjectCode` (and whether it can store a mapping).
- Confirm grade-specific subject identity (`SCI_BIO9`) vs base (`SCI_BIO`).
- Confirm they want `categoryLabels` in the response or only the `ww/pt/qa` keys.
- Confirm whether unlinked class lookups should fall back to subject resolution in the same call.

### Phase 1 — Subject resolver (no behavior change)

- Add `resolveEffectiveWeightsForSubject(subject)` in `server/src/routes/grades-sub/helpers.ts`.
- Make `resolveEffectiveWeightsForClassAssignment` delegate to it.
- Keep `EffectiveWeights` shape (`ww`, `pt`, `qa`, `source`, `updatedAt`).

**Files:** `server/src/routes/grades-sub/helpers.ts`

### Phase 2 — Endpoint subject mode

- Extend `aimsGradingWeightsQuerySchema` with `subjectCode`, `subjectName`, `gradeLevel`.
- Add subject lookup and response builder in `server/src/routes/integration-sub/aimsGradingWeights.ts`.
- Keep `aimsCourseId` / batch behavior intact.
- Add `resolvedBy` and optional `categoryLabels`.

**Files:** `server/src/schemas/aims.ts`, `server/src/routes/integration-sub/aimsGradingWeights.ts`

### Phase 3 — Tests

- Unit: subject resolver precedence and `updatedAt`.
- Route: subject-mode 200, unknown 404, ambiguous 409, auth 401, batch mixed results.
- Regression: existing linked-class responses unchanged.
- No-link weight sync test with a real seeded subject.

**Files:** `server/src/__tests__/aims-grading-weights.test.ts`

### Phase 4 — Docs and AIMS handoff

- Update both handoff docs: weights do not require a link; link is for score sync only.
- Document `QA = Term Examination (TE)` alias.
- Provide one curl example per mode and one batch example.

### Phase 5 — Config hygiene (separate, recommended)

- Ensure `GradingConfig` rows exist at server start or in seed after a wipe.
- Fix admin group save so CORE/MATH_SCIENCE and MAPEH/TLE cannot diverge.
- Fix `SubjectWeightsPanel` dedupe so grade-specific overrides are visible.

**Files:** `server/prisma/seed.ts` / `server/src/index.ts`, `src/pages/admin/GradingConfig.tsx`,
`src/pages/admin/components/SubjectWeightsPanel.tsx`

---

## 5. Test plan

| Case | Expected |
|---|---|
| `subjectCode=SCI_BIO9`, no link | `200`, `source: GROUP_DEFAULT`, 20/50/30 |
| `subjectCode=MAPEH7`, no link | `200`, 20/60/20 |
| `subjectCode=STE_RESEARCH9`, no link | `200`, CORE weights |
| Subject override set | `200`, `source: SUBJECT_DEFAULT`, override values |
| Unknown subject | `404 SUBJECT_NOT_FOUND` |
| `subjectName=Science - Biology`, `gradeLevel=Grade 9` | Resolves `SCI_BIO9` |
| Ambiguous name without grade | `409 AMBIGUOUS_SUBJECT` |
| `aimsCourseId` linked | Existing response + `resolvedBy: CLASS_LINK` |
| `aimsCourseId` unlinked, no subject key | `404 AIMS_COURSE_NOT_LINKED` |
| Missing/wrong key | `401 UNAUTHORIZED` |
| Batch of 50 | Per-item results, order preserved |
| Batch of 51 | `400 TOO_MANY_COURSES` |
| After wipe, before config reseed | `GENERIC_FALLBACK` (documented, not treated as correct) |

Manual verification:

```bash
curl -sS -H "x-api-key: $AIMS_SERVICE_API_KEY" \
  "http://<smart-host>:5003/api/integration/aims/grading-weights?subjectCode=SCI_BIO9&schoolYear=2026-2027"
```

---

## 6. Operational notes

1. After `db:wipe-academic`, open Admin → Grading Config once (or add startup seeding) so
   `GradingConfig` rows exist. Otherwise MAPEH/TLE resolve to 20/50/30.
2. SMART never pushes weights. AIMS must re-pull on `updatedAt` / `weights` change; their
   "only sync when no weight rows exist" rule will keep stale values.
3. The link remains required for score/roster sync, not for weights. AIMS should treat
   `AIMS_COURSE_NOT_LINKED` as "scores not linked", not "weights unavailable" — when a subject
   key is supplied, weights resolve regardless of link state.
4. Do not reuse `AIMS_API_KEY` (outbound) or `ENROLLPRO_API_KEY`. Inbound key stays
   `AIMS_SERVICE_API_KEY` / `x-api-key`.

---

## 7. Open questions

1. Does AIMS store a SMART `subjectCode` mapping per course, or should SMART derive it?
2. Should base-subject queries (`SCI_BIO`) return a per-grade map, or require a grade?
3. Should `categoryLabels` be returned, or is the `QA` alias enough?
4. Do we need program-level weight profiles (e.g., different weights for STE vs regular
   Science), or is the current `Subject.type` grouping sufficient?
5. Is the admin UI group-divergence and per-subject dedupe in scope for this change, or a
   separate fix?

---

## 8. Non-goals

- No Prisma migration for the weights contract.
- No change to `WW | PT | QA` category keys or AIMS score import semantics.
- No SMART → AIMS push/webhook.
- No per-class weight overrides.
- No automatic AIMS link creation; linking stays teacher-JWT only.
