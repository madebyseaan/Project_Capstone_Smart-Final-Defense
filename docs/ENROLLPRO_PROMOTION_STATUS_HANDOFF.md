# EnrollPro ↔ SMART — Promotion Status Fix Request: "Conditionally Promoted" missing on your side

> **Date:** 2026-09-03
> **From:** SMART team
> **Re:** `outcomes[].promotionStatus` in `POST /api/integration/smart/sections/:sectionId/sync-grades`
> **Status:** Action needed on the EnrollPro side. SMART's contract is live and unchanged.

---

## 1. Problem

EnrollPro pulls grade outcomes from SMART during EOSY via `sync-grades`. SMART
computes and sends a per-learner promotion status. Learners who failed **1–2
subjects** are sent as `"Conditionally Promoted"` — but that value never shows
up anywhere in EnrollPro. It appears your side has no "Conditionally Promoted"
value in its status handling at all (not in the mapping, not in learner
profiles, not in EOSY views/exports).

**Why this matters:** Conditionally Promoted IS the remedial track. Under DepEd
rules (DO 8, s. 2015 as amended by DO 55, s. 2016), a JHS learner with 1–2
failed subjects is promoted to the next grade level but must pass remedial
classes for the failed subjects. SMART calls these learners
CONDITIONALLY_PROMOTED and manages their remedial records locally
(`RemedialClass`: original grade, remedial class mark, recomputed final grade,
conducted dates). If EnrollPro cannot represent the status, the remedial
population on your side — the `REMEDIAL_HOLD` concept from your own school-year
lifecycle doc — has no trigger and these learners silently look fully promoted.

## 2. The wire contract (already live, no SMART changes needed)

`outcomes[].promotionStatus` carries one of these **exact Title Case strings**:

| Wire value | Meaning | SMART internal enum |
|---|---|---|
| `"Promoted"` | 0 failed subjects | `PROMOTED` |
| `"Conditionally Promoted"` | 1–2 failed subjects → remedial track | `CONDITIONALLY_PROMOTED` |
| `"Retained"` | 3+ failed subjects (or no graded subjects at all) | `RETAINED` |

Rules of the field:

- **Always non-null** for every learner in `outcomes[]` — SMART computes it live
  from FINALIZED grades on every call (even a learner with zero grades gets
  `"Retained"`).
- Match on the **full string**. Do not normalize, substring-match, or
  lowercase-compare against partial values.
- SMART does the subject counting (one subject = one row, final = average of
  T1–T3, failing = final < 75, rotation subjects merged). EnrollPro just
  consumes the field — do not recompute.
- `remarks` (per-learner) is the general-average verdict (`"Passed"`/`"Failed"`)
  and is independent of `promotionStatus` — a Conditionally Promoted learner
  can have `remarks: "Passed"`.

## 3. Real examples from the current SMART dev environment (SY 2028-2029)

Pull these sections with `sync-grades` and you will see the exact values:

**Maka-Diyos (GRADE_8)** — LRN `202600000001`, Mendoza, Jose Gabriel:

```json
{
  "lrn": "202600000001",
  "studentName": "Mendoza, Jose Gabriel",
  "subjectGrades": [
    { "subjectCode": "ESP8", "subjectName": "Edukasyon sa Pagpapakatao 8", "T1": 71, "T2": 71, "T3": 71, "final": 71, "remarks": "Failed" },
    { "subjectCode": "MATH8", "subjectName": "Mathematics 8", "T1": 83, "T2": 86, "T3": 82, "final": 84, "remarks": "Passed" }
    // ... 12 more subjects, all passing 83-85
  ],
  "generalAverage": 83,
  "remarks": "Passed",
  "promotionStatus": "Conditionally Promoted",
  "publishedAt": "..."
}
```

Test matrix (all four seeded learners):

| Learner | LRN | Section | Failed subjects | Expected `promotionStatus` |
|---|---|---|---|---|
| Mendoza, Jose Gabriel | `202600000001` | G8 Maka-Diyos | 1 (ESP8, final 71) | `"Conditionally Promoted"` |
| Mendoza, Justin | `202800000000` | G7 Mabini | 1 (MAPEH7, final 71) | `"Conditionally Promoted"` |
| Fernandez, John Paolo | `202600000008` | G9 Daisy | 4 | `"Retained"` |
| Fernandez, Kenneth | `202800000005` | G7 Bonifacio | 4 | `"Retained"` |

The remaining 56 learners in those sections return `"Promoted"`.

## 4. What we need you to fix on the EnrollPro side

1. **Add `"Conditionally Promoted"` as a first-class status value** wherever
   `sync-grades` results land: import/mapping layer, learner profile, EOSY
   views, reports and exports.
2. **Preserve the string end-to-end** — do not collapse it to `"Promoted"`
   (loses the remedial obligation) or `"Retained"` (blocks promotion the
   learner legally has).
3. **Wire it to your remedial hold flow.** Per your lifecycle doc, G7–9
   conditionally promoted learners should carry a remedial flag into the
   target year (`REMEDIAL_HOLD` or equivalent) — that is exactly this
   population, and it should drive your `/remedial/pending` feed that SMART
   reads back.
4. If you keep a display-label map, suggested short label: `"Cond. Promoted"`.

## 5. Heads-up: Grade 10 "JHS Completer" (no action yet)

SMART's internal enum has a fourth value, `JHS_COMPLETER` (Grade 10 finisher).
Today the integration layer maps it to `"Promoted"` on the wire, so you have
never received it. We may expose it as `"JHS Completer"` later so you can
distinguish completers-with-conditions — design your enum to hold **4** values,
not 3. We will coordinate before any change; this is only so the data model
doesn't hard-code three.

## 6. Related open item — remedial results contract

This request is only about the *status label*. Pulling remedial *results*
(subject, remedial class mark, recomputed final grade, pass/fail, conducted
dates) from SMART into EnrollPro is still pending the contract questions we
sent in `mdfiles/ENROLLPRO-REMEDIAL-CONTRACT-QUESTIONS-2026-08-31.md`.

Inventory update since that message — items 3 and 4 of our capability table
have moved from ❌ to ✅ on the SMART side:

| Capability | Status now |
|---|---|
| Read EnrollPro's `/remedial/pending` list | ✅ works (read-only) |
| Registrar remedial tracker UI | ✅ display-only |
| Remedial class / result data model in SMART DB | ✅ **built** (`RemedialClass`) |
| Registrar UI to encode remedial ratings + completion | ✅ **built** (RFG = (original + RCM)/2, DO 13 §2.1) |
| Endpoint exposing remedial results to EnrollPro | ❌ still pending contract answers (Q1–Q6) |
| SF10 remedial section | ⚠️ partial placeholder |

The remaining build on our side is the pull endpoint — send the answers and
we'll scope it.
