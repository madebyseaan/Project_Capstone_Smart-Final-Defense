# AIMS 6-Parameter Grading Proposal — Evaluation

> **Status:** Review
> **Created:** 2026-11-12
> **Source:** AIMS proposal for future-proofing DepEd grading across DO 8, s. 2015, DO 015, s. 2026, and zero-based grading
> **Related:** `docs/GRADE_DESCRIPTORS_CONFIG_PLAN.md`, `docs/ZERO_BASED_GRADING_PLAN.md`

---

## 1. Verdict

The direction is good, but the proposal should **not replace** SMART's existing transmutation table without corrections and tests.

| Proposal item | Verdict | Reason |
|---|---|---|
| `is_transmuted` boolean | **Adopt conceptually** | SMART already has `SchoolYear.gradingMode` (`TRANSMUTED` / `ZERO_BASED`); no new column needed |
| `passing_raw_score` | **Adopt as derived, read-only metadata** | Correct values: 60.00 (DO 8), 70.00 (SY 2026-2027), 75.00 (zero-based) |
| `passing_transmuted_grade` | **Keep fixed at 75** | DepEd policy; SMART uses `PASSING_GRADE = 75` in promotion, remedial, SF5/SF6/SF9/SF10. Making it editable risks lowering the passing standard |
| `floor_grade` | **Keep fixed at 60 for now** | Correct per DO 015; no need to expose unless policy changes |
| `ceiling_raw_score` | **Correct the values** | SY 2026-2027 is **99.50**, not 99.40; legacy DO 8 is **100**, not 99.99 |
| `rounding_mode` | **Adopt as metadata** | `FLOOR` for table lookup; `ROUND` for zero-based |
| Derived formula | **Do not replace the table in v1** | Does not exactly reproduce the published 2-decimal failing bands |
| `descriptor_scale` JSON | **Adopt** | Matches the editable descriptor plan; derive `remarks` from 75 instead of storing it |
| `grade_level_display_mode` | **Defer** | SMART currently serves Grades 7-10 only; K-3 descriptive rollout is outside scope |

---

## 2. Parameter-by-parameter review

### 2.1 `is_transmuted`

SMART already stores this as `SchoolYear.gradingMode`:

```prisma
enum GradingMode {
  TRANSMUTED
  ZERO_BASED
}
```

AIMS can map `TRANSMUTED` -> `is_transmuted = true`, `ZERO_BASED` -> `false`. Do not add a second boolean; two flags could disagree.

### 2.2 `passing_raw_score`

This is the minimum Initial Grade that maps to the passing term grade.

| Regime | Correct value | Source |
|---|---:|---|
| DO 8, s. 2015 | 60.00 | Repealed table: 60.00-61.59 -> 75 |
| DO 015, SY 2026-2027 | 70.00 | Adjusted table: 70.00-71.17 -> 75 |
| Zero-based, SY 2027-2028+ | 75.00 | No transmutation; 75 is the passing term grade |

The values in the AIMS proposal are correct. This should be **derived from the active table**, not independently editable, so it cannot drift from the table.

### 2.3 `passing_transmuted_grade`

Always **75**. It is a policy constant, not a school-level setting. SMART hardcodes it in:

- `server/src/lib/promotion.ts:22` (`PASSING_GRADE`)
- `server/src/lib/remedial.ts:19` (`REMEDIAL_PASSING_GRADE`)
- SF5/SF6/SF9/SF10 composers
- Promotion, remedial, and EOSY logic

Making it editable would allow a passing grade below DepEd policy and would require changing promotion, remedial, forms, and audit rules. Reject as an editable setting. Expose it as read-only metadata if AIMS needs it.

### 2.4 `floor_grade`

Always **60** under current policy. Keep it as a fixed constant for now; expose it as read-only metadata. If a future DepEd memo changes it, that is a deliberate policy change, not an everyday admin setting.

### 2.5 `ceiling_raw_score`

**Correct values:**

| Regime | Correct value | Meaning |
|---|---:|---|
| DO 8, s. 2015 | 100.00 | Only an Initial Grade of exactly 100 maps to 100; 98.40-99.99 maps to 99 |
| DO 015, SY 2026-2027 | 99.50 | 99.50-100.00 maps to 100 |
| Zero-based | 100.00 | No table; ceiling is only relevant as a safety cap |

The AIMS proposal uses **99.40** for SY 2026-2027 and **99.99** for DO 8. Both are wrong and would change results at the top of the scale.

Concrete failure example with the AIMS formula:

- AIMS `ceiling_raw_score = 99.40`
- Initial Grade `99.45`
- AIMS formula: `99.45 > 99.40`, so it returns **100**
- Official DO 015 table: `99.45` falls in `98.32-99.49`, so the term grade is **99**

### 2.6 `rounding_mode`

Directionally correct:

- Transmuted modes reproduce the official table with `FLOOR` (drop the fractional part).
- Zero-based uses `ROUND` (nearest whole number).

However, `FLOOR` alone does not reproduce every failing-band boundary in the adjusted table. See §3.

---

## 3. Formula check against the official tables

### 3.1 Passing range, SY 2026-2027

Using corrected ceiling `99.50`:

```text
passingStep = (99.50 - 70.00) / (100 - 75) = 1.18
```

Examples:

| Initial Grade | Formula result (FLOOR) | Official table | Match |
|---:|---:|---:|---|
| 70.00 | 75 | 75 | Yes |
| 71.17 | 75 | 75 | Yes |
| 71.18 | 76 | 76 | Yes |
| 99.49 | 99 | 99 | Yes |
| 99.50 | 100 | 100 | Yes |

The passing range works with the corrected ceiling.

### 3.2 Failing range, SY 2026-2027

Using `failingStep = 70 / (75 - 60) = 4.6667`:

| Initial Grade | Formula result (FLOOR) | Official table | Match |
|---:|---:|---:|---|
| 0.00 | 60 | 60 | Yes |
| 4.67 | 61 | 60 | **No** |
| 9.34 | 62 | 61 | **No** |
| 14.00 | 63 | 62 | **No** |
| 65.33 | 74 | 73 | **No** |
| 65.34 | 74 | 74 | Yes |
| 69.99 | 74 | 74 | Yes |

The published adjusted table uses 2-decimal bracket boundaries that do not exactly match the unrounded step formula. A lookup table is the safer source of truth.

### 3.3 Legacy DO 8 formula

Using `passingRaw = 60`, `passingTransmuted = 75`, `ceiling = 100`, `floor = 60`:

- Passing step = `(100 - 60) / 25 = 1.60`
- Failing step = `60 / 15 = 4.00`
- `FLOOR` reproduces the DO 8 table boundaries exactly in the sampled cases (4.00-7.99 -> 61, 60.00-61.59 -> 75, etc.).

The AIMS legacy values are correct except `ceiling_raw_score` (should be 100, not 99.99).

### 3.4 Zero-based

`Math.max(floor_grade, Math.round(IG))` is correct for current policy. Add a `Math.min(100, ...)` safety cap. Initial Grade is already bounded by 0-100 in SMART's computation, so this is defensive only.

---

## 4. Descriptor scale review

AIMS proposes:

```json
[
  { "min": 90, "max": 100, "descriptor": "Advancing", "remarks": "Passed" },
  { "min": 80, "max": 89, "descriptor": "Benchmarking", "remarks": "Passed" },
  { "min": 75, "max": 79, "descriptor": "Connecting", "remarks": "Passed" },
  { "min": 65, "max": 74, "descriptor": "Developing", "remarks": "Failed" },
  { "min": 0, "max": 64, "descriptor": "Emerging", "remarks": "Failed" }
]
```

Assessment:

- The labels and ranges match DO 015.
- **Do not store `remarks` per band.** Derive remarks from the fixed passing grade (75). Storing them allows contradictions, e.g. a `70-79` band labeled both `Passed` and `Failed`.
- Validate that a band boundary starts at 75, so the static SF9 grading-scale table never shows a mixed band.
- This matches `docs/GRADE_DESCRIPTORS_CONFIG_PLAN.md` §6-§9.

Recommended shape:

```json
[
  { "min": 90, "max": 100, "descriptor": "Advancing", "description": "..." },
  { "min": 80, "max": 89, "descriptor": "Benchmarking", "description": "..." },
  { "min": 75, "max": 79, "descriptor": "Connecting", "description": "..." },
  { "min": 65, "max": 74, "descriptor": "Developing", "description": "..." },
  { "min": 0, "max": 64, "descriptor": "Emerging", "description": "..." }
]
```

Remarks are computed as `grade >= 75 ? "Passed" : "Failed"`.

---

## 5. `grade_level_display_mode`

AIMS proposes mapping grade levels to `DESCRIPTOR_ONLY` or `NUMERICAL`:

- SY 2026-2027: K, G1 descriptor-only; G2-G12 numerical
- SY 2027-2028: K, G1, G2 descriptor-only; G3-G12 numerical

Assessment:

- This is a valid long-term DepEd rollout concern.
- SMART currently serves **Junior High School only**: `GradeLevel` enum is `GRADE_7` to `GRADE_10` (`server/prisma/schema.prisma:736`).
- SMART does not currently handle Kindergarten or Grades 1-3.
- Defer this until SMART expands to elementary. Do not add an unused mapping now.

---

## 6. Recommended integration approach

### 6.1 Keep the table authoritative

SMART already has:

- 41-row `TransmutationEntry` table
- Admin editing and reset
- Validation for gaps/overlaps
- Stored term grades recomputed on table/mode changes

Do not replace this with a scalar formula in v1. The formula is useful as a **derived summary**, not as the engine.

### 6.2 Expose read-only grading-scale metadata

If AIMS needs the six values, expose them as derived metadata:

```http
GET /api/integration/grading-scale?schoolYear=2026-2027
```

Response:

```json
{
  "schoolYear": "2026-2027",
  "isTransmuted": true,
  "passingRawScore": 70.0,
  "passingTransmutedGrade": 75,
  "floorGrade": 60,
  "ceilingRawScore": 99.5,
  "roundingMode": "FLOOR",
  "descriptors": [ ... ]
}
```

Rules:

- Derive all values from the active `TransmutationEntry` table and `SchoolYear.gradingMode`.
- Do not allow AIMS or an admin to set them independently.
- Cache for 5 minutes; invalidate when the table or mode changes.
- Validate derived values against the table (e.g. `passingRawScore` must be the minimum `minGrade` whose `transmutedGrade` equals 75).
- If derivation fails (empty table, gap, no passing row), return `409 INVALID_TRANSMUTATION_TABLE`.

### 6.3 If a formula mode is ever adopted

Only adopt it if all 41 table rows pass a parity test:

1. For each `TransmutationEntry`, compute the formula result at `minGrade`, `maxGrade`, and the midpoint.
2. Compare with `transmutedGrade`.
3. Fail the build on any mismatch.
4. Repeat for the DO 8 table and the zero-based mode.
5. Store the parity test output as release evidence.

Until then, keep the table lookup.

---

## 7. Open questions for AIMS

1. Which exact response shape do they need: six scalar fields, descriptor array, or both?
2. Do they compute their own term grade from Initial Grade, or do they only display SMART's stored term grade?
3. Should `descriptor` be attached per term grade, per subject final grade, per general average, or all three?
4. Do they need the legacy DO 8 table, or only the active school year?
5. How will they handle AIMS's own `On Track / At Risk / Needs Help / Locked` status? That is AIMS-specific and should remain separate from DepEd descriptors.
6. Confirm the field names and casing they expect before implementation.

---

## 8. Bottom line

- Adopt the **descriptor configuration** and the **read-only six-value metadata**.
- Keep the **transmutation table** as the computation source.
- Fix the proposal's `ceiling_raw_score` values: **99.50** for SY 2026-2027, **100** for DO 8.
- Keep **75** fixed as the passing grade.
- Derive **remarks** from 75; do not store them in descriptor JSON.
- Defer `grade_level_display_mode` until SMART serves elementary grades.
