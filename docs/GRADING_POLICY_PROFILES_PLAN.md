# Grading Policy Profiles — Future-Proof Architecture Plan

> **Status:** Draft for review
> **Created:** 2026-11-12
> **Goal:** Adopt any future DepEd grading memo without changing application code
> **Related:** `docs/ZERO_BASED_GRADING_PLAN.md`, `docs/GRADE_DESCRIPTORS_CONFIG_PLAN.md`, `docs/AIMS_GRADING_PARAMETERS_EVALUATION.md`

---

## 1. Plain-language explanation

Today SMART has:

- One grading mode per school year (`TRANSMUTED` / `ZERO_BASED`)
- One global 41-row transmutation table
- Hardcoded descriptors
- Hardcoded passing grade `75`

To be future-proof, do not hardcode any of those as the only option. Instead, treat a grading policy like a **saved template**:

1. Admin opens **Grading Policies**.
2. Admin duplicates an existing template (for example, "DO 015 Adjusted Table").
3. Admin edits the name, mode, conversion rules, and descriptors.
4. Admin assigns the template to a school year.

When DepEd releases a new memo, the admin creates or edits a template. No code deployment is needed.

AIMS's six parameters become **fields inside a template**, not the whole system. The template can use either:

- A **table** (the official chart, row by row), or
- A **formula** (the six-value linear model AIMS proposed).

This is more flexible than either approach alone.

---

## 2. Why a single table or six knobs is not enough

| Approach | Strength | Weakness |
|---|---|---|
| One global table | Exact official values | Cannot represent a different table per year without code/global edits |
| Six scalar parameters | Simple, formula-driven | Does not exactly match published 2-decimal tables; not every future memo will be linear |
| **Policy profiles** | Each year can have its own exact table or formula; admin-editable | Slightly more data modeling |

The policy-profile approach keeps the exactness of a table and adds the convenience of a formula when a future policy is truly linear.

---

## 3. Core model

### 3.1 `GradingPolicy`

```prisma
enum GradingEngine {
  TABLE
  LINEAR
}

enum RoundingMode {
  FLOOR
  ROUND
}

model GradingPolicy {
  id               String          @id @default(cuid())
  name             String          @unique
  description      String?
  engine           GradingEngine   @default(TABLE)
  mode             GradingMode     // TRANSMUTED | ZERO_BASED
  passingGrade     Int             @default(75)
  passingRawScore  Float?
  floorGrade       Int             @default(60)
  ceilingRawScore  Float?
  roundingMode     RoundingMode    @default(FLOOR)
  gradeLevelModes  Json?           // future: { "GRADE_7": "NUMERICAL", ... }
  isBuiltIn        Boolean         @default(false)
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  schoolYears      SchoolYear[]
  bands            TransmutationBand[]
  descriptors      GradeDescriptor[]
}
```

### 3.2 `TransmutationBand` (renamed/derived from `TransmutationEntry`)

```prisma
model TransmutationBand {
  id              String        @id @default(cuid())
  policyId        String
  policy          GradingPolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)
  minGrade        Float
  maxGrade        Float
  transmutedGrade Int
  isDefault       Boolean       @default(false)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@unique([policyId, minGrade])
  @@index([policyId, minGrade])
}
```

### 3.3 `GradeDescriptor`

Move descriptors from `schoolYear` to `policyId`:

```prisma
model GradeDescriptor {
  id          String        @id @default(cuid())
  policyId    String
  policy      GradingPolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)
  label       String
  minGrade    Int
  maxGrade    Int
  description String?
  sortOrder   Int
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@unique([policyId, sortOrder])
  @@unique([policyId, minGrade])
}
```

### 3.4 `SchoolYear` link

```prisma
model SchoolYear {
  // existing fields...
  gradingPolicyId String?
  gradingPolicy   GradingPolicy? @relation(fields: [gradingPolicyId], references: [id], onDelete: SetNull)
}
```

Resolution:

- If `gradingPolicyId` is set, use that policy.
- Otherwise, fall back to the built-in policy for the year's `gradingMode` and label.
- If no built-in matches, fall back to the global DO 015 adjusted policy.

---

## 4. Engine design

### 4.1 Strategy interface

```ts
export interface ResolvedGradingPolicy {
  id: string;
  name: string;
  engine: "TABLE" | "LINEAR";
  mode: "TRANSMUTED" | "ZERO_BASED";
  passingGrade: number;
  passingRawScore: number | null;
  floorGrade: number;
  ceilingRawScore: number | null;
  roundingMode: "FLOOR" | "ROUND";
  bands: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>;
  descriptors: Array<{ label: string; minGrade: number; maxGrade: number; description: string | null }>;
}

export interface GradeConversionEngine {
  compute(initialGrade: number, policy: ResolvedGradingPolicy): number;
}

export const TABLE_ENGINE: GradeConversionEngine;
export const LINEAR_ENGINE: GradeConversionEngine;

export function computeTermGrade(initialGrade: number, policy: ResolvedGradingPolicy): number;
```

### 4.2 TABLE engine

- Zero-based mode: `min(100, max(floorGrade, round(initialGrade)))`.
- Transmuted mode: lookup `bands` where `minGrade <= IG <= maxGrade`; return `transmutedGrade`.
- If no band matches: log a warning and return `floorGrade`.
- This is the authoritative engine for official published tables.

### 4.3 LINEAR engine (AIMS proposal, corrected)

- Zero-based mode: `min(100, max(floorGrade, round(initialGrade)))`.
- Transmuted mode:
  - If `IG >= ceilingRawScore`: return 100.
  - If `IG >= passingRawScore`: `passingStep = (ceilingRawScore - passingRawScore) / (100 - passingGrade)`; result = `passingGrade + (IG - passingRawScore) / passingStep`; apply rounding.
  - Else: `failingStep = passingRawScore / (passingGrade - floorGrade)`; result = `floorGrade + IG / failingStep`; apply rounding; clamp to `floorGrade`.
- Correct ceilings: **99.50** for SY 2026-2027, **100** for DO 8, **100** for zero-based.
- Use this only when a policy is explicitly created with `engine = LINEAR` and passes a parity test (see §8).

### 4.4 Fixed values

- `passingGrade` is stored per policy for transparency but validated to **75** unless an explicit future policy allows otherwise.
- `floorGrade` is stored per policy but validated to **60** for current policy profiles.
- Problem: allowing these to be edited freely risks non-compliance. Add a `isBuiltIn` flag; built-in profiles are read-only. Custom profiles can vary, with an audit warning.
- In v1 of policy profiles, only admins with a deliberate "advanced" acknowledgement can change them.

---

## 5. Resolution and caching

Create `server/src/lib/gradingPolicy.ts`:

```ts
export async function getGradingPolicyForYear(schoolYear?: string | null): Promise<ResolvedGradingPolicy>;
export function invalidateGradingPolicyCache(schoolYear?: string): void;
```

Rules:

- Cache per school year for 5 minutes.
- Load the school year row, its `gradingPolicyId`, or the built-in fallback.
- Load bands and descriptors in one query each.
- On DB error, return the built-in DO 015 policy.
- Invalidate on policy edit, policy assignment, table edit, or mode change.

### 5.1 Not found fallback

| Situation | Behavior |
|---|---|
| School year not found | Return built-in DO 015 policy; log warning |
| School year has no policy | Return built-in policy for its `mode` |
| Policy has no bands (TABLE) | Return built-in table; log warning |
| Policy has no descriptors | Return built-in DO 015 descriptors |
| Empty/invalid DB | Return hardcoded built-in fallback |

---

## 6. Admin experience

### 6.1 Page

Add **Grading Policies** under Admin, or extend `/admin/transmutation` with a policy selector.

Recommended layout:

```
PageHeader: "Grading Policies"
Description: "Define the grading rules for each school year."

[Policy list]
  - DO 015 Adjusted Table (SY 2026-2027)   [Built-in]
  - DO 015 Zero-Based (SY 2027-2028+)       [Built-in]
  - Custom: SY 2028-2029 Policy             [Custom]
  [Create policy] [Duplicate]

[Selected policy editor]
  Name
  Engine: Table | Formula
  Mode: Transmuted | Zero-Based
  Passing grade (read-only unless advanced)
  Floor grade
  Passing raw score
  Ceiling raw score
  Rounding: Floor | Round

  [Table editor] or [Formula preview]
  [Descriptor editor]

  [Assign to school year]
```

### 6.2 Rules

- Built-in profiles cannot be deleted or edited; admins can duplicate them.
- `Create policy` copies the selected profile.
- `Assign to school year` sets `SchoolYear.gradingPolicyId`.
- Changing a policy assignment triggers `recomputeStoredGrades` for that school year (same guard as grading mode changes).
- Archived years cannot be reassigned.
- Every action is audit-logged.

### 6.3 Preview

Add a conversion preview:

```
Initial Grade: [84.50]
Result: [87]  (Advancing)
```

Show both engines side by side when editing a LINEAR policy to compare against the reference table.

---

## 7. API

### 7.1 Read

- `GET /api/grades/grading-policy?schoolYear=` — resolved policy for all authenticated roles.
- `GET /api/admin/grading-policies` — list policies.
- `GET /api/admin/grading-policies/:id` — policy details with bands + descriptors.

### 7.2 Write (admin only)

- `POST /api/admin/grading-policies` — create a policy (copy from an existing one or from a built-in template).
- `PUT /api/admin/grading-policies/:id` — update name, engine, params, bands, descriptors.
- `DELETE /api/admin/grading-policies/:id` — only custom, unassigned policies.
- `POST /api/admin/grading-policies/:id/assign` — assign to a school year (body: `{ schoolYear }`).
- `POST /api/admin/grading-policies/:id/preview` — preview conversion for sample IGs.

### 7.3 AIMS-compatible metadata

Expose on the resolved policy:

```json
{
  "schoolYear": "2026-2027",
  "policyId": "cuid",
  "engine": "TABLE",
  "isTransmuted": true,
  "passingRawScore": 70,
  "passingTransmutedGrade": 75,
  "floorGrade": 60,
  "ceilingRawScore": 99.5,
  "roundingMode": "FLOOR",
  "descriptors": [ ... ]
}
```

This gives AIMS the six values in a read-only form without letting their formula replace SMART's exact table.

---

## 8. Validation and parity

### 8.1 TABLE policy validation

- Bands cover 0-100 with no gaps/overlaps.
- Each band has integer `transmutedGrade` 0-100.
- A band exists whose `transmutedGrade` equals the policy passing grade.
- The lowest band's `transmutedGrade` equals `floorGrade`.
- The highest band's `transmutedGrade` equals 100.
- `passingRawScore` equals the minimum `minGrade` of a band whose `transmutedGrade` equals `passingGrade`.
- `ceilingRawScore` equals the minimum `minGrade` of the band whose `transmutedGrade` equals 100.

### 8.2 LINEAR policy validation

- `passingRawScore < ceilingRawScore`.
- `floorGrade < passingGrade <= 100`.
- `passingRawScore` is between `floorGrade` and `ceilingRawScore`.
- Compute results with the corrected formula and compare to the reference table from the policy the admin copied.
- If any boundary differs, reject with a message naming the first mismatch.
- Require an explicit acknowledgement when the custom policy diverges from a built-in reference.

### 8.3 Descriptor validation

- Same rules as `docs/GRADE_DESCRIPTORS_CONFIG_PLAN.md`.
- A boundary must start at the passing grade.
- Labels unique, 2-10 rows, full 0-100 coverage.

---

## 9. Migration path

### Phase A — Safe refactor (no behavior change)

1. Add `GradingPolicy`, `TransmutationBand`, `GradeDescriptor` tables.
2. Seed two built-in policies:
   - `DO 015 Adjusted Table (SY 2026-2027)` with the current 41 rows.
   - `DO 015 Zero-Based (SY 2027-2028+)` with no bands.
3. Copy existing `TransmutationEntry` rows into the adjusted built-in policy's `TransmutationBand` rows.
4. Set `SchoolYear.gradingPolicyId`:
   - Years with `gradingMode = ZERO_BASED` -> zero-based built-in.
   - All others -> adjusted built-in.
5. Update `getTransmutationTable()` to read the school year's policy bands. Keep the old export for compatibility.
6. Update `computeTermGrade`, `recomputeStoredGrades`, `ecrExport`, and grade save paths to pass the resolved policy.
7. Keep the old `TransmutationEntry` table read-only for one release, then drop it.

### Phase B — Admin policy UI

1. Policy list and editor.
2. Assign policy to school year.
3. Duplicate/reset.
4. Audit and recompute.

### Phase C — LINEAR engine

1. Add formula engine and preview.
2. Add parity tests.
3. Allow creating a LINEAR policy only after the admin views a parity report.

---

## 10. Impact map

| Area | Change |
|---|---|
| `server/prisma/schema.prisma` | New models + `SchoolYear.gradingPolicyId` |
| `server/src/lib/gradingMode.ts` | Wrap mode in resolved policy; keep mode helpers for compatibility |
| `server/src/lib/transmutationCache.ts` | Policy-aware cache |
| `server/src/lib/gradeRecalc.ts` | Use the resolved policy instead of the global table/mode |
| `server/src/routes/grades-sub/helpers.ts` | `calculateGrades` uses the policy |
| `server/src/routes/admin-sub/grading.ts` | Keep existing mode/table APIs; delegate to policy profiles |
| `server/src/lib/ecrExport.ts` | Use the policy's table/engine and descriptors |
| `server/src/routes/grades-sub/dashboard.ts` | Descriptor buckets from the policy |
| `src/pages/admin/TransmutationTable.tsx` | Add policy selector/editor, or new page |
| `src/pages/admin/GradingConfig.tsx` | Weights remain separate |
| `src/lib/gradeMath.ts` | Pure helpers accept a resolved policy |
| Teacher/registrar surfaces | Use resolved descriptors/policy from the hook |
| AIMS/EnrollPro sync | Expose read-only policy metadata + descriptors |

---

## 11. Why this is future-proof

- A new DepEd memo = a new policy profile, not a code release.
- A future policy can be a table, a formula, or a mix.
- Each school year keeps its historical policy.
- Descriptors, passing thresholds, ceilings, floors, and rounding are all data.
- AIMS gets consistent metadata without controlling SMART's computation.
- Validation and parity tests prevent silent differences from official tables.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Over-engineering before the next memo | Implement policies in phases; Phase A is a safe refactor |
| Admin edits break compliance | Built-in policies read-only; advanced fields require acknowledgement; audit |
| Historical grades change | Policy assignment is per year; archived years immutable |
| Table/formula divergence | Parity tests; TABLE engine remains authoritative |
| Too many policies | Limit to a manageable list; deletion only when unassigned and custom |
| UI complexity | Start with list + duplicate + assign; full editor in Phase B |

---

## 13. Recommendation

1. Ship the **descriptor editor** first (already planned).
2. Then ship **policy profiles with the TABLE engine** as a safe refactor.
3. Add the **LINEAR engine** only when needed, behind parity tests.
4. Expose the six AIMS values as **read-only metadata** from the assigned policy.

This gives the future-proof behavior the school wants without replacing the official table with an unverified formula.
