# AIMS → SMART: Grading Weights — Addendum (Per-Subject Weight Overrides)

> **Supplements:** `HANDOFF_AIMS_GRADING_WEIGHTS_2026-11-18.md`
> **Contract change:** None. Same route, same auth, same response shape.
> **Purpose:** Clarify how SMART's **Per-Subject Weight Overrides** page affects the
> `source` field. AIMS does **not** need that page, its table, or a screenshot.

---

## 0. What this is about (plain English)

SMART has an admin page where you can change the grading weights for one specific subject.
When you change it, SMART uses the new weights for that subject.

AIMS does not copy that page. AIMS asks SMART for the weights using the same connection as
before. So if you change the weights in SMART, AIMS gets the new numbers the next time AIMS
syncs. It is **not instant**, and SMART does not push the change.

If AIMS never syncs again, it keeps the old numbers. So after any weight change, re-sync
AIMS.

**Direct answer:** changing a subject override in SMART **will** reflect in AIMS — after
AIMS re-syncs.

---

## 1. Short answer

SMART already exposes the per-subject overrides through the existing endpoint:

```
GET /api/integration/aims/grading-weights
```

Do not send or scrape the **Admin → Grading Config → Per-Subject Weight Overrides** table.
The endpoint reads those values live and returns them as:

```json
"source": "SUBJECT_DEFAULT",
"weights": { "ww": 20, "pt": 50, "qa": 30 }
```

The table is only the SMART admin UI that edits the values. The endpoint is the contract.

---

## 2. Resolution order (unchanged)

SMART resolves weights in this order:

1. **Per-subject override** — values on
   **Admin → Grading Config → Per-Subject Weight Overrides**
   → `source: "SUBJECT_DEFAULT"`
2. **Subject-group default** — `CORE`, `MAPEH`, `TLE`, `MATH_SCIENCE`
   → `source: "GROUP_DEFAULT"`
3. **Generic fallback** — hardcoded `20 / 50 / 30`
   → `source: "GENERIC_FALLBACK"`, `isFallback: true`

`CORE`, `MAPEH`, `TLE`, and `MATH_SCIENCE` are **subject-group categories**, not subjects.
A subject belongs to one group via its `Subject.type`. For example, Science - Biology 9 is
`CORE`, so it uses the `CORE` group default; `MATH_SCIENCE` is a different group.

There is still **no `CLASS_OVERRIDE`** in SMART. `CLASS_OVERRIDE` will not appear.

---

## 3. What AIMS should do

1. Keep calling `GET /api/integration/aims/grading-weights?aimsCourseId=<uuid>`.
2. Use `weights.ww`, `weights.pt`, `weights.qa` as returned. Do not read the admin table.
3. Use `source` to label the weights:
   - `SUBJECT_DEFAULT` → "SMART (subject override)"
   - `GROUP_DEFAULT` → "SMART (subject group default)"
   - `GENERIC_FALLBACK` → "SMART fallback"
4. Re-pull weights after a SMART admin changes the page. SMART does not push, and there is
   no webhook. Compare `updatedAt` / `weights` on each pull.
5. If a subject has no override, SMART returns the group default with
   `source: "GROUP_DEFAULT"` — this is valid, not an error.

---

## 4. Example

Subject: **Science - Biology 9** (`SCI_BIO9`)

**Case A — admin set a subject override of 25 / 45 / 30:**

```json
{
  "aimsCourseId": "904bcd77-8950-4fb7-a373-9fecb80646d4",
  "subjectCode": "SCI_BIO9",
  "source": "SUBJECT_DEFAULT",
  "isFallback": false,
  "weights": { "ww": 25, "pt": 45, "qa": 30 },
  "weightsSum": 100,
  "weightsValid": true,
  "termScoped": false,
  "updatedAt": "2026-11-18T08:00:00.000Z"
}
```

**Case B — no subject override, uses the `CORE` group default (Science - Biology 9 is `CORE`):**

```json
{
  "aimsCourseId": "904bcd77-8950-4fb7-a373-9fecb80646d4",
  "subjectCode": "SCI_BIO9",
  "source": "GROUP_DEFAULT",
  "isFallback": false,
  "weights": { "ww": 20, "pt": 50, "qa": 30 },
  "weightsSum": 100,
  "weightsValid": true,
  "termScoped": false,
  "updatedAt": "2026-06-01T00:00:00.000Z"
}
```

Values are illustrative. Use the values returned by the endpoint.

---

## 5. Key setup (reminder)

Same key value on both sides; only variable names differ:

| Side | Where it goes | Value |
|---|---|---|
| SMART server | env `AIMS_SERVICE_API_KEY` | `<key>` |
| AIMS server | env `SMART_API_KEY` | `<same key>` |
| AIMS request | header `x-api-key` | `<same key>` |

Send AIMS only the key value, not the `AIMS_SERVICE_API_KEY=` variable name.

---

## 6. No action needed for the admin page

AIMS does not need:

- a screenshot of the Per-Subject Weight Overrides page
- an export of the subject table
- a new endpoint
- a new auth key

The existing endpoint already reflects the page's values. If the values change, re-pull.
