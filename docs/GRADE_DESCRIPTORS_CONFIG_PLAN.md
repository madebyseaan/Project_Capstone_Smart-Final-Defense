# Editable Grade Descriptors — Implementation Plan

> **Status:** Draft for review
> **Created:** 2026-11-12
> **Feature owner:** Admin / Grading
> **Primary surface:** `/admin/transmutation` (new card below Grading Mode)
> **DepEd basis:** DO 015, s. 2026 (current); DO 8, s. 2015 (repealed)
> **Related:** `docs/ZERO_BASED_GRADING_PLAN.md`, `docs/GRADING-SYSTEM-REDESIGN-PLAN.md`
> **AIMS proposal review:** `docs/AIMS_GRADING_PARAMETERS_EVALUATION.md`

---

## 1. Plain-language summary

Right now the words **Advancing / Benchmarking / Connecting / Developing / Emerging** and their score ranges are typed directly into many screens. There is no single settings page for them.

This plan makes them editable by an admin, in one place, and makes every screen read from that one source:

- Class record descriptor column
- Teacher dashboard mastery chart
- Mobile class record descriptor pills
- Student Grade Profile
- SF9 grading scale table
- ECR Excel export
- AIMS / EnrollPro grade sync payload

The passing grade stays fixed at **75**. "Passed / Failed" stays derived from 75 and is **not** editable. Descriptors are only the labels for score bands.

Without this refactor, editing one screen would create mismatches (for example: class record says "Advancing" while the dashboard chart still says "90-100 Outstanding").

---

## 2. Background and policy

### 2.1 DepEd descriptor sets

**DO 015, s. 2026 (current, effective SY 2026-2027):**

| Numerical grade | Descriptor |
|---|---|
| 90-100 | Advancing |
| 80-89 | Benchmarking |
| 75-79 | Connecting |
| 65-74 | Developing |
| 0-64 | Emerging |

**DO 8, s. 2015 (repealed):**

| Numerical grade | Descriptor |
|---|---|
| 90-100 | Outstanding |
| 85-89 | Very Satisfactory |
| 80-84 | Satisfactory |
| 75-79 | Fairly Satisfactory |
| 74 and below | Did Not Meet Expectations |

Rules that do **not** change:

- Passing grade is **75**.
- Remarks are `Passed` when the grade is at least 75, else `Failed`.
- "Failed" is a remark, not a descriptor.
- Descriptors are labels only. They do not affect promotion, remedial, EOSY, or grade math.

### 2.2 Why "scalable" matters

DepEd changes grading policy between school years. SMART needs one configurable, year-scoped source of truth so historical years keep their labels, new years adopt new bands without a code change, and AIMS/EnrollPro can request a learner's descriptor.

---

## 3. Current-state audit

### 3.1 Shared frontend descriptor list

| File | Current behavior |
|---|---|
| `src/lib/gradeMath.ts:58` | Hardcoded `GRADE_DESCRIPTORS` (DO 015 bands with descriptions) |
| `src/lib/gradeMath.ts:66` | `getDescriptorInfo()` looks up the hardcoded list |
| `src/lib/gradeMath.ts:71` | `getDescriptor()` returns the hardcoded label |

### 3.2 Teacher-facing surfaces

| File | Current behavior | Descriptor source |
|---|---|---|
| `src/pages/teacher/components/ledger/LedgerRow.tsx:440` | Descriptor column in class record ledger | `getDescriptor()` -> hardcoded list |
| `src/pages/teacher/components/ClassDescriptorFooter.tsx:2` | Desktop class descriptor footer | `GRADE_DESCRIPTORS` |
| `src/pages/teacher/components/MobileClassDescriptor.tsx:3` | Mobile class descriptor pills + description | `GRADE_DESCRIPTORS` |
| `src/pages/teacher/StudentGradeProfile.tsx:59` | Inline `if` thresholds for descriptor label | Local hardcoded thresholds |
| `src/pages/teacher/StudentGradeProfile.tsx:687` | Static descriptor legend with ranges | Local hardcoded ranges |
| `src/pages/teacher/Dashboard.tsx:289` | Mastery chart labels + ranges | Local hardcoded labels/ranges |
| `src/pages/teacher/components/MobileDashboardTokens.ts:10` | Mobile dashboard legend labels | Local hardcoded labels |
| `server/src/routes/grades-sub/dashboard.ts:713` | Mastery distribution buckets | Hardcoded ranges mapped to old bucket keys |

### 3.3 Forms, exports, and stored data

| File | Current behavior |
|---|---|
| `src/components/forms/sf9/SF9Form.tsx:160` | Static SF9 `Descriptors / Grading Scale / Remarks` table |
| `server/src/lib/ecrExport.ts:142` | Duplicate hardcoded DO 015 list |
| `server/src/lib/ecrExport.ts:241` | `descriptorForGrade()` uses the duplicate list |
| `server/prisma/seed-grades.ts:47` | Seed helper writes descriptors to `Grade.qualitativeDescriptor` |
| `server/prisma/seed-teacher-scores.ts:612` | Seeds descriptor values |
| `server/prisma/seed-grades-term.ts:329` | Seeds descriptor values |
| `server/src/routes/advisory.ts:431` | Returns stored `qualitativeDescriptor` in SF9 payload |
| `server/src/routes/grades-sub/classes.ts:586` | Returns stored `qualitativeDescriptor` in class record payload |
| `server/src/lib/aimsImport.ts:426` | Copies stored descriptor during AIMS import |
| `server/src/lib/ecrImport.ts:370` | Copies stored descriptor during ECR import |

`Grade.qualitativeDescriptor` is currently **not displayed by any React page** (no UI reads it). It is effectively a legacy snapshot field.

### 3.4 Legacy SF5/SF6

| File | Current behavior |
|---|---|
| `server/src/lib/sf5Composer.ts:79` | DO 8 O/VS/S/FS/DNME mapping |
| `server/src/lib/sf6Composer.ts:116` | DO 8 O/VS/S/FS/DNME mapping |
| `server/src/routes/registrar/exports.ts:298` | DO 8 descriptor summary rows |
| `src/pages/registrar/components/SF5Form.tsx:23` | DO 8 descriptor labels |

These forms are tied to official DO 8-era templates. They are **out of scope for v1** (see §8.2) and need a separate policy/form-template decision.

### 3.5 AIMS / integration

| File | Current behavior |
|---|---|
| `server/src/routes/integration.ts:205` | `sync-grades` returns numeric grades, general average, remarks, promotion status |
| `server/src/routes/integration.ts` | No descriptor field anywhere in the payload |
| `src/pages/teacher/components/AimsLinkForm.tsx` | AIMS course matching UI; no descriptor dependency |

AIMS currently receives no DepEd descriptor labels from SMART.

---

## 4. Goals and non-goals

### 4.1 Goals

1. Admin can edit descriptor **name**, **minimum grade**, **maximum grade**, and optional **description**.
2. One saved change propagates to every modern surface (teacher, registrar forms/exports, AIMS payload).
3. Descriptor configuration is **per school year**, with DO 015 defaults for any year that has no custom rows.
4. Validation prevents gaps, overlaps, duplicate labels, and ambiguous pass/fail bands.
5. All changes are audit-logged.
6. Historical years never change unless explicitly edited by an admin.
7. The app still works when the backend/DB is temporarily unavailable (built-in defaults as fallback).
8. No changes to grade math, promotion, remedial, EOSY, or passing-grade rules.

### 4.2 Non-goals

- Changing the passing grade (fixed at 75).
- Making "Passed / Failed" editable.
- Changing WW/PT/QA weights or transmutation math.
- Migrating SF5/SF6 to DO 015 in this release.
- Editing grades or recomputing stored term grades when descriptors change.
- Building a general-purpose report-template engine.
- Auto-detecting DepEd policy changes.

---

## 5. Locked decisions and open questions

### 5.1 Locked decisions

| ID | Decision | Rationale |
|---|---|---|
| D1 | One config source stored in the SMART DB, with per-school-year overrides and DO 015 defaults as fallback | Historical correctness and scalability |
| D2 | Passing grade remains `PASSING_GRADE = 75` | DepEd policy; used by promotion/remedial/forms |
| D3 | Remarks are derived from 75, never stored per descriptor | Avoids contradictory config |
| D4 | Validation rejects bands that cross 75 | Keeps the SF9 static Remarks column unambiguous |
| D5 | Bands are whole numbers covering 0-100 contiguously | Term grades are whole numbers |
| D6 | Admin-only writes; all authenticated roles can read | Teachers/registrars only display |
| D7 | Descriptor edits do **not** recompute grades | Labels only |
| D8 | Frontend falls back to built-in defaults while loading/offline | Prevents blank labels |
| D9 | Archived school years are read-only for descriptor edits | Prevents historical rewrites |
| D10 | The admin card lives on `/admin/transmutation` below Grading Mode | Same grading-scale settings area |
| D11 | `Grade.qualitativeDescriptor` is not made authoritative for display | It is legacy, partially populated, and stale-prone |
| D12 | AIMS/EnrollPro sync payload gets additive `descriptor` fields | Answer AIMS without breaking existing consumers |

### 5.2 Open questions

| ID | Question | Recommended answer |
|---|---|---|
| O1 | Should admins edit archived years? | No. Read-only; clone/edit must happen on an active year |
| O2 | Should descriptors be inherited from the previous year when a new year is created? | No. Defaults on first read; explicit edits per year |
| O3 | Should descriptions be editable? | Yes, optional. They appear in mobile/footer UI |
| O4 | Should SF5/SF6 use this config in the same release? | No. Keep legacy DO 8 mapping; separate approved migration |
| O5 | Should admin be able to add/remove bands freely? | Yes, with 2-10 rows and full 0-100 coverage validation |
| O6 | Should the admin page get a school-year selector in v1? | Optional. v1 edits the active year; API already accepts any year |

---

## 6. Data model

### 6.1 Recommended Prisma model

```prisma
model GradeDescriptor {
  id          String   @id @default(cuid())
  schoolYear  String   // "2026-2027"; historical-safe string filter
  label       String
  minGrade    Int
  maxGrade    Int
  description String?
  sortOrder   Int
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([schoolYear, sortOrder])
  @@unique([schoolYear, minGrade])
  @@index([schoolYear, minGrade])
}
```

### 6.2 Semantics

- Rows exist **only** when an admin customizes a school year.
- If no rows exist for a year, the resolver returns the built-in DO 015 defaults.
- `PUT` replaces all rows for one school year in a single transaction.
- `POST .../reset` deletes the year's rows, reverting to defaults.
- `sortOrder` is assigned by the server after sorting bands by `minGrade`.
- No FK to `SchoolYear` is required. Using the label string matches the existing historical-query convention and lets config survive a year row rebuild.
- `description` is optional and only used by teacher-facing helper UI.

### 6.3 Why not a JSON column?

A table follows the existing `TransmutationEntry` pattern, is easier to validate/query/audit, and does not hide invalid ranges inside a blob.

### 6.4 Why year-scoped?

Historical report cards must not silently change when a future policy update is applied, and SMART already stores `SchoolYear.gradingMode` per year. If the project later prefers a single global set, the `schoolYear` column can be dropped without changing the resolved API shape.

---

## 7. Backend design

### 7.1 New library: `server/src/lib/gradeDescriptors.ts`

Responsibilities:

```ts
export interface GradeDescriptorConfig {
  label: string;
  minGrade: number;
  maxGrade: number;
  description?: string | null;
}

export const DEFAULT_GRADE_DESCRIPTORS: readonly GradeDescriptorConfig[];

export function validateGradeDescriptors(
  descriptors: GradeDescriptorConfig[],
): string | null;

export function descriptorForGrade(
  grade: number | null,
  descriptors?: readonly GradeDescriptorConfig[],
): GradeDescriptorConfig | null;

export async function getGradeDescriptorsForYear(
  schoolYear?: string | null,
): Promise<{ descriptors: GradeDescriptorConfig[]; isDefault: boolean }>;

export function invalidateGradeDescriptorCache(schoolYear?: string): void;
```

### 7.2 Defaults

Seed defaults from DO 015:

| label | minGrade | maxGrade | description |
|---|---:|---:|---|
| Advancing | 90 | 100 | Consistently demonstrates advanced skills, understanding, and values beyond expectations; performs with confidence, accuracy, and independence. |
| Benchmarking | 80 | 89 | Demonstrates expected grade-level skills, understanding, and values with consistency; performs tasks accurately and independently. |
| Connecting | 75 | 79 | Demonstrates foundational skills, understanding, and values; applies learning in familiar tasks with minimal guidance. |
| Developing | 65 | 74 | Demonstrates partial understanding and inconsistent application of skills and values; requires targeted support and regular practice. |
| Emerging | 0 | 64 | Does not yet demonstrate foundational skills and understanding; requires structured and sustained intervention. |

The same defaults must exist in the frontend fallback (`src/lib/gradeMath.ts`). Keep them in a clearly labeled `DEFAULT_GRADE_DESCRIPTORS` constant. Add a script or test note to keep both lists in sync.

### 7.3 Validation rules

A candidate list is valid only if all rules pass:

1. Between **2 and 10** descriptors.
2. `label` is non-empty after trimming, max 40 characters, unique case-insensitively.
3. `minGrade` and `maxGrade` are integers from 0 to 100.
4. `minGrade <= maxGrade`.
5. After sorting by `minGrade`:
   - First band starts at **0**.
   - Last band ends at **100**.
   - Every band starts exactly one point after the previous band ends (`next.minGrade === prev.maxGrade + 1`).
6. **No band crosses 75.** This means some band must start at exactly 75 (e.g. `75-79`), or all bands are entirely below/above 75. This keeps the static SF9 Remarks column deterministic.
7. `description` max 300 characters; empty string becomes `null`.

Return a user-facing error string on failure; the route returns HTTP 400 with that message.

### 7.4 Resolver and cache

```ts
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: ResolvedDescriptors }>();
let defaultCache: { expiresAt: number; value: ResolvedDescriptors } | null = null;
```

Rules:

- `GET` resolves by `schoolYear` label.
- If no rows exist for the year, return defaults with `isDefault: true`.
- On DB error, log a warning and return defaults.
- Cache key: `schoolYear ?? "__default__"`.
- Invalidate on successful `PUT` and `reset`.
- No SSE event in v1. Teacher pages see the new config on next page load/refetch (5-minute stale window). Document this.

### 7.5 Pure helpers

`descriptorForGrade(grade, descriptors)`:

- Return `null` for `null`/`undefined`.
- Normalize the grade to a whole number only if the caller already does; do not round internally to avoid masking mismatches. Callers pass the stored whole-number term grade.
- Find the band where `grade >= minGrade && grade <= maxGrade`.
- Return `null` if no band matches (should not happen after validation).

`remarksForGrade(grade)`:

- Keep the existing `PASSING_GRADE` logic. Do not duplicate 75 in the descriptor table.

### 7.6 Migration

```powershell
pnpm --prefix server run prisma:migrate -- --name add_grade_descriptors
pnpm --prefix server run prisma:generate
```

Migration is additive. No backfill is required because absence of rows means defaults.

Rollback:

```sql
DROP TABLE IF EXISTS "GradeDescriptor";
```

Safe after code rollback; no other table references it.

---

## 8. API design

### 8.1 Shared read endpoint

`GET /api/grades/grade-descriptors?schoolYear=YYYY-YYYY`

- Auth: any authenticated role (teachers, registrars, admins).
- `schoolYear` optional; resolved from `SystemSettings.currentSchoolYear` when omitted.
- Read-only.

Response:

```json
{
  "schoolYear": "2026-2027",
  "isDefault": false,
  "descriptors": [
    {
      "label": "Advancing",
      "minGrade": 90,
      "maxGrade": 100,
      "description": "Consistently demonstrates advanced skills..."
    }
  ]
}
```

Errors:

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid query |
| 401 | `UNAUTHENTICATED` | Missing/expired token |
| 404 | `SCHOOL_YEAR_NOT_FOUND` | Active/queried year does not exist |

### 8.2 Admin read endpoint

`GET /api/admin/grade-descriptors?schoolYear=YYYY-YYYY`

- Auth: admin only.
- Same response shape plus `canEdit` and `blockedReason`.
- `canEdit` is false when the year is `ARCHIVED`.

```json
{
  "schoolYear": "2026-2027",
  "isDefault": true,
  "canEdit": true,
  "blockedReason": null,
  "descriptors": [ ... ]
}
```

`blockedReason` values: `ARCHIVED_SCHOOL_YEAR`, `SCHOOL_YEAR_NOT_FOUND`.

### 8.3 Admin update endpoint

`PUT /api/admin/grade-descriptors`

Auth: admin only. Zod-validated.

Request:

```json
{
  "schoolYear": "2026-2027",
  "descriptors": [
    { "label": "Advancing", "minGrade": 90, "maxGrade": 100, "description": "..." },
    { "label": "Benchmarking", "minGrade": 80, "maxGrade": 89, "description": "..." },
    { "label": "Connecting", "minGrade": 75, "maxGrade": 79, "description": "..." },
    { "label": "Developing", "minGrade": 65, "maxGrade": 74, "description": "..." },
    { "label": "Emerging", "minGrade": 0, "maxGrade": 64, "description": "..." }
  ]
}
```

Behavior:

1. Reject archived years with `409 ARCHIVED_SCHOOL_YEAR`.
2. Validate the full set (`400 INVALID_DESCRIPTOR_SET` with message).
3. In one transaction: `deleteMany({ schoolYear })`, then `createMany` sorted rows with server-assigned `sortOrder`.
4. Invalidate the cache for that year.
5. Audit log.
6. Return the saved response.

Response: same shape as admin GET with `isDefault: false`.

### 8.4 Admin reset endpoint

`POST /api/admin/grade-descriptors/reset`

Request:

```json
{ "schoolYear": "2026-2027" }
```

Behavior:

1. Reject archived years.
2. Delete rows for the year.
3. Invalidate cache.
4. Audit log.
5. Return the default set with `isDefault: true`.

### 8.5 Zod schema

Add to `server/src/schemas/admin.ts` or a new `server/src/schemas/gradeDescriptors.ts`:

```ts
const gradeDescriptorRowSchema = z.object({
  label: z.string().trim().min(1).max(40),
  minGrade: z.number().int().min(0).max(100),
  maxGrade: z.number().int().min(0).max(100),
  description: z.string().trim().max(300).nullable().optional(),
});

export const gradeDescriptorsQuerySchema = z.object({
  query: z.object({
    schoolYear: z.string().min(1).optional(),
  }),
});

export const gradeDescriptorsUpdateSchema = z.object({
  body: z.object({
    schoolYear: z.string().min(1),
    descriptors: z.array(gradeDescriptorRowSchema).min(2).max(10),
  }),
});

export const gradeDescriptorsResetSchema = z.object({
  body: z.object({
    schoolYear: z.string().min(1),
  }),
});
```

### 8.6 Audit logging

Use the existing `createAuditLog()`:

- Action: `UPDATE`
- Category: `CONFIG`
- Title: `Grade Descriptors`
- Detail: `Updated grade descriptors for SY 2026-2027: 5 bands (Advancing 90-100, ...)`
- Severity: `WARNING`
- Entity: the school year id when available

Audit failure must not roll back the config change; log the audit error separately.

### 8.7 Route placement

- Shared read: `server/src/routes/grades-sub/descriptors.ts` registered from `server/src/routes/grades.ts`.
- Admin CRUD: `server/src/routes/admin-sub/gradeDescriptors.ts` registered from `server/src/routes/admin.ts`.
- Keeping them separate avoids bloating `grading.ts` and makes the read endpoint available to non-admin roles.

---

## 9. Frontend design

### 9.1 Admin UI placement

Add a new card to `src/pages/admin/TransmutationTable.tsx`, below the existing Grading Mode card and above/below the Transmutation Ranges card:

```
PageHeader: "Transmutation Table"
Description: "DepEd grading mode, transmutation, and grade descriptors"

[Grading Mode card]                     (existing)
[Transmutation Ranges card]             (existing)
[Grade Descriptors card]                (new)
```

Recommended file: `src/pages/admin/components/GradeDescriptorsCard.tsx` to keep `TransmutationTable.tsx` below the 1000-line limit.

Card contents:

- Title: `Grade Descriptors`
- Description: `Labels and score bands shown on class records, SF9, and exports. The passing grade remains 75.`
- Badge: `Default` or `Customized`
- Table columns:
  - Descriptor name (text input)
  - Min grade (number input)
  - Max grade (number input)
  - Description (optional text input or expandable row)
  - Remove (trash icon, disabled when only 2 rows remain)
- Footer actions:
  - `Add descriptor`
  - `Reset to defaults` (confirm dialog)
  - `Save changes` (disabled when unchanged or invalid)
- Inline validation summary above the table.
- Loading, error, and retry states.
- Read-only state when `canEdit` is false (archived year).

The card edits the **active school year** in v1. The API supports any year so a year selector can be added later without a migration.

### 9.2 Admin data flow

- Query keys:
  - `["grade-descriptors", "admin", schoolYear]`
- Mutations:
  - `adminApi.updateGradeDescriptors({ schoolYear, descriptors })`
  - `adminApi.resetGradeDescriptors({ schoolYear })`
- After success:
  - Invalidate `["grade-descriptors"]` for all scopes.
  - Toast: `Grade descriptors updated for SY 2026-2027. 5 bands saved.`
  - Teacher screens pick the change up on next load/refetch.
- Use the existing `ConfirmDialog` for reset.
- Disable Save while saving; keep the user's draft on error.

### 9.3 Frontend API client

Add to `src/lib/api.ts`:

```ts
export interface GradeDescriptorConfig {
  label: string;
  minGrade: number;
  maxGrade: number;
  description?: string | null;
}

export interface GradeDescriptorsResponse {
  schoolYear: string;
  isDefault: boolean;
  descriptors: GradeDescriptorConfig[];
}

gradesApi.getGradeDescriptors: (schoolYear?: string) =>
  api.get<GradeDescriptorsResponse>("/grades/grade-descriptors", {
    params: schoolYear ? { schoolYear } : {},
  });

adminApi.getGradeDescriptors: (schoolYear: string) =>
  api.get<GradeDescriptorsResponse & { canEdit: boolean; blockedReason: string | null }>(
    "/admin/grade-descriptors",
    { params: { schoolYear } },
  );

adminApi.updateGradeDescriptors: (data: {
  schoolYear: string;
  descriptors: GradeDescriptorConfig[];
}) => api.put<GradeDescriptorsResponse>("/admin/grade-descriptors", data);

adminApi.resetGradeDescriptors: (schoolYear: string) =>
  api.post<GradeDescriptorsResponse>("/admin/grade-descriptors/reset", { schoolYear });
```

### 9.4 Shared hook

Create `src/hooks/useGradeDescriptors.ts`:

```ts
export function useGradeDescriptors(schoolYear?: string): {
  descriptors: GradeDescriptorConfig[];
  isDefault: boolean;
  loading: boolean;
  source: "server" | "fallback";
};
```

Rules:

- If `schoolYear` is not passed, read `currentSchoolYear` from `ThemeContext`.
- React Query key: `["grade-descriptors", "shared", schoolYear ?? "active"]`.
- `staleTime`: 5 minutes.
- While loading or on error, return `DEFAULT_GRADE_DESCRIPTORS` so labels never disappear.
- Do not fetch when `schoolYear` is empty; use defaults.

### 9.5 `src/lib/gradeMath.ts` changes

Keep functions pure by accepting an optional list:

```ts
export function getDescriptorInfo(
  grade: number | null,
  descriptors: readonly GradeDescriptorConfig[] = DEFAULT_GRADE_DESCRIPTORS,
): GradeDescriptorConfig | null;

export function getDescriptor(
  grade: number | null,
  descriptors: readonly GradeDescriptorConfig[] = DEFAULT_GRADE_DESCRIPTORS,
): string;
```

Do not remove `DEFAULT_GRADE_DESCRIPTORS`. It is the offline/first-render fallback.

### 9.6 Teacher surface changes

| Surface | Change |
|---|---|
| `LedgerRow.tsx:440` | Accept `descriptors` prop; call `getDescriptor(grade, descriptors)`. Parent `ClassRecordTable` receives them from `ClassRecordView`. |
| `ClassDescriptorFooter.tsx:2` | Use `useGradeDescriptors()`; render fetched pills and descriptions. |
| `MobileClassDescriptor.tsx:3` | Use `useGradeDescriptors()`; render fetched pills and descriptions. |
| `StudentGradeProfile.tsx:59` | Replace local `if` chain with `getDescriptorInfo(grade, descriptors)` from the hook. |
| `StudentGradeProfile.tsx:687` | Replace static legend with `descriptors.map(...)`. |
| `Dashboard.tsx:289` | Build chart data from API-provided descriptor buckets plus labels/ranges from the hook. |
| `MobileDashboardTokens.ts:10` | Replace static label list with a mapping over descriptors; keep the color/stroke palette by index. |
| `server/src/routes/grades-sub/dashboard.ts:713` | Return `distributionByDescriptor: [{ label, minGrade, maxGrade, count }]` using the year's config. Keep old named counts for backward compatibility until the frontend migration is complete. |

Colors: descriptor colors are presentational, not configurable in v1. Assign colors by band index from a stable palette.

### 9.7 Registrar and forms changes

| Surface | Change |
|---|---|
| `src/components/forms/sf9/SF9Form.tsx:160` | Render the grading-scale table from `useGradeDescriptors()` (fallback defaults). Remarks per band computed as `minGrade >= 75 ? "Passed" : maxGrade < 75 ? "Failed" : "Mixed"`; validation prevents `Mixed`. |
| `src/pages/registrar/components/SF9Form.tsx`, `SF9Inspector.tsx`, `records/Sf9Tab.tsx` | No data changes; they render the shared `SF9Form` component. |
| `server/src/lib/ecrExport.ts:142` | Remove the duplicate list; pass descriptors for the class assignment's school year into `descriptorForGrade()`. |
| `server/src/lib/ecrExport.ts:241` | Change signature to `descriptorForGrade(grade, descriptors)`; load via `getGradeDescriptorsForYear()`. |
| `server/src/lib/sf9Composer.ts` | No descriptor computation today; no change unless SF9 needs a server-side descriptor field. Prefer client hook for v1. |
| SF5/SF6 | Out of scope. Keep legacy DO 8 mapping. Document in release notes. |

### 9.8 Print and offline behavior

- Print views use the same React component and hook; when offline, they fall back to the built-in defaults.
- If a printed form is generated while the backend is unavailable, it may show defaults rather than a custom year config. Document this limitation.
- ECR export is server-side; on DB error it falls back to defaults and logs a warning.

---

## 10. Surface-by-surface change matrix

| # | File | Change | Phase |
|---|---|---|---|
| 1 | `server/prisma/schema.prisma` | Add `GradeDescriptor` model | 1 |
| 2 | `server/src/lib/gradeDescriptors.ts` | Defaults, validation, resolver, cache | 1 |
| 3 | `server/src/schemas/gradeDescriptors.ts` | Zod schemas | 1 |
| 4 | `server/src/routes/grades-sub/descriptors.ts` | Shared GET endpoint | 2 |
| 5 | `server/src/routes/admin-sub/gradeDescriptors.ts` | Admin GET/PUT/reset + audit | 2 |
| 6 | `server/src/routes/grades.ts` | Register shared route | 2 |
| 7 | `server/src/routes/admin.ts` | Register admin route | 2 |
| 8 | `src/lib/api.ts` | Types + API methods | 3 |
| 9 | `src/hooks/useGradeDescriptors.ts` | Shared read hook | 3 |
| 10 | `src/pages/admin/components/GradeDescriptorsCard.tsx` | Admin editor UI | 3 |
| 11 | `src/pages/admin/TransmutationTable.tsx` | Mount the card | 3 |
| 12 | `src/lib/gradeMath.ts` | Optional descriptor list params + fallback | 4 |
| 13 | `src/pages/teacher/components/ledger/LedgerRow.tsx` | Use runtime descriptors | 4 |
| 14 | `src/pages/teacher/ClassRecordView.tsx` / `ClassRecordTable.tsx` | Thread descriptors to ledger | 4 |
| 15 | `src/pages/teacher/components/ClassDescriptorFooter.tsx` | Use hook | 4 |
| 16 | `src/pages/teacher/components/MobileClassDescriptor.tsx` | Use hook | 4 |
| 17 | `src/pages/teacher/StudentGradeProfile.tsx` | Remove local thresholds/legend | 4 |
| 18 | `server/src/routes/grades-sub/dashboard.ts` | Dynamic descriptor buckets | 4 |
| 19 | `src/pages/teacher/Dashboard.tsx` | Dynamic chart labels/ranges | 4 |
| 20 | `src/pages/teacher/components/MobileDashboardTokens.ts` | Dynamic labels | 4 |
| 21 | `src/components/forms/sf9/SF9Form.tsx` | Dynamic grading-scale table | 5 |
| 22 | `server/src/lib/ecrExport.ts` | Dynamic descriptor column/helper | 5 |
| 23 | `server/src/routes/integration.ts` | Add descriptor fields to sync-grades | 5 |
| 24 | `server/prisma/seed-*.ts` | Use shared defaults; stop relying on stale stored descriptors | 5 |
| 25 | `e2e/grading-mode-forms.spec.ts` | Keep default assertions; add config assertions | 6 |
| 26 | `server/src/__tests__/grade-descriptors*.test.ts` | Unit/API tests | 1-2 |
| 27 | `e2e/offline/specs/offline-grade-descriptors.spec.ts` | Write test for admin edit/reset | 6 |

---

## 11. AIMS / EnrollPro integration

`POST /api/integration/sections/:sectionId/sync-grades` is the shared grade-outcomes endpoint. Additive fields:

Per subject row inside `subjectGrades`:

```json
{
  "subjectCode": "MATH",
  "finalRating": 87,
  "remarks": "Passed",
  "descriptor": "Benchmarking"
}
```

Per student:

```json
{
  "lrn": "123456789012",
  "generalAverage": 88,
  "generalAverageDescriptor": "Benchmarking",
  "remarks": "Passed",
  "promotionStatus": "Promoted"
}
```

Rules:

- Use the resolved descriptor set for the section's school year.
- `descriptor` is `null` when the final rating is `null`.
- Keep all existing fields unchanged. This is backward-compatible.
- Document the new fields in the integration contract for AIMS/EnrollPro.

If AIMS only needs its own `On Track / At Risk / Needs Help / Locked` status, that remains AIMS-computed. SMART supplies the DepEd descriptor; AIMS supplies its own risk status. Do not conflate them.

---

## 12. Historical data policy

- Descriptor rows are scoped by `schoolYear`.
- A year with no rows always shows DO 015 defaults in v1. If a historical year should show DO 8 labels, an admin must create rows for that year (future UI enhancement) or the system must ship a one-time seed/backfill for known historical years.
- Recommended follow-up: after v1, add a "copy from year" or "seed legacy DO 8 for years before 2026-2027" action.
- `Grade.qualitativeDescriptor`:
  - Keep the column for imported legacy data.
  - Do not use it as the display source.
  - Do not backfill or rewrite it.
  - Add a code comment marking it legacy/snapshot-only.
- Descriptor edits never touch `Grade` rows.

---

## 13. Edge cases

| Case | Behavior |
|---|---|
| No rows for the year | Return DO 015 defaults, `isDefault: true` |
| DB unavailable | Return defaults; log warning; UI still renders |
| Admin edits archived year | HTTP 409; UI read-only |
| Admin creates a gap | HTTP 400 with a message naming the gap |
| Admin creates an overlap | HTTP 400 with a message naming the overlap |
| Admin crosses 75 | HTTP 400: `A descriptor band must start at 75` |
| Duplicate labels | HTTP 400: `Descriptor labels must be unique` |
| Fewer than 2 rows | HTTP 400 |
| Empty label | HTTP 400 |
| Non-integer grade bounds | Zod 400 |
| Grade is null | Descriptor is `null`; UI shows `-`/`—` |
| Grade below first band or above last | Should be impossible after validation; return `null` and log a warning |
| Concurrent admin saves | Transaction plus a per-year process queue; last write wins, audit records both |
| Teacher page open during edit | Shows old labels until next refetch/page load |
| Offline print | Falls back to defaults; note in release notes |
| AIMS asks for a descriptor for a null final grade | Return `null`, not `Failed` |

---

## 14. Security and permissions

- Shared GET requires authentication; admin writes require `authenticateToken` + `requireAdmin`, with the existing CSRF middleware.
- Validate server-side only; never trust client ranges.
- Derive `sortOrder`, limit arrays to 10 entries, cap string lengths, and audit every write.
- No secrets or external calls.

---

## 15. Testing strategy

### 15.1 Unit tests

`server/src/__tests__/grade-descriptors.test.ts`:

- Default list covers 0-100 with no gaps/overlaps.
- `validateGradeDescriptors()` rejects:
  - gap
  - overlap
  - duplicate label
  - non-zero start
  - non-100 end
  - band crossing 75
  - >10 rows
  - <2 rows
  - non-integer bounds
- `descriptorForGrade()` boundaries:
  - 0 -> Emerging
  - 64 -> Emerging
  - 65 -> Developing
  - 74 -> Developing
  - 75 -> Connecting
  - 79 -> Connecting
  - 80 -> Benchmarking
  - 89 -> Benchmarking
  - 90 -> Advancing
  - 100 -> Advancing
  - null -> null
- Custom set lookup works.

### 15.2 API tests

`server/src/__tests__/grade-descriptors-api.test.ts`:

- GET requires auth; teacher/registrar/admin all succeed.
- GET unknown year -> 404.
- GET returns defaults when no rows.
- PUT non-admin -> 403.
- PUT archived year -> 409.
- PUT invalid set -> 400 and no rows written.
- PUT valid set -> 200; rows persisted; second GET returns custom set.
- PUT is atomic: a failed write leaves the previous set intact.
- Reset -> defaults; rows deleted.
- Audit log row created with title/category.
- Cache invalidation: GET after PUT returns new data without a 5-minute wait.
- Year isolation: customizing SY A does not change SY B.

### 15.3 Frontend tests

- `pnpm run build` and `pnpm run lint` must pass.
- Read-only Playwright:
  - Admin card renders default descriptors.
  - Teacher ledger descriptor matches the API's current config.
  - SF9 grading-scale table renders the configured labels/ranges.
- Offline-rig Playwright (write-capable):
  - Edit a label and range, save, reload, verify persistence.
  - Verify teacher ledger and SF9 reflect the change.
  - Reset to defaults, verify restoration.
  - Error state: gap/overlap shows an inline message and Save stays disabled.
  - Archived year: card read-only.

### 15.4 Manual smoke

1. Admin edits `Benchmarking` -> `Proficient`, `80-89` -> `82-89`, and `Connecting` -> `75-81`.
2. Save. Reload. Values persist.
3. Teacher opens a class record: descriptor column shows `Proficient` for an 85.
4. Teacher dashboard chart shows the new label/range.
5. Registrar opens SF9: grading-scale table shows the new label/range; remarks still Passed/Failed.
6. Export ECR: descriptor column uses the new label.
7. AIMS sync payload includes the new descriptor.
8. Reset to defaults. All surfaces return to DO 015 labels.
9. Confirm grade values, averages, and promotion statuses did not change.

---

## 16. Delivery phases and PR slicing

### Phase 0 — Decisions

- Confirm per-year scope (D1).
- Confirm descriptions are editable (O3).
- Confirm SF5/SF6 stay legacy for v1 (O4).
- Confirm archived-year writes are blocked (D9).
- Confirm AIMS field names.

**Exit:** decisions recorded in this document.

### Phase 1 — Schema and backend library (PR 1)

- Add `GradeDescriptor` model and migration.
- Add `server/src/lib/gradeDescriptors.ts` with defaults, validation, resolver, cache.
- Add unit tests.
- Run:
  ```powershell
  pnpm --prefix server run prisma:migrate -- --name add_grade_descriptors
  pnpm --prefix server run prisma:generate
  pnpm --prefix server run build
  pnpm --prefix server test
  ```

**Exit:** build + unit tests pass; default boundaries covered.

### Phase 2 — API endpoints (PR 2)

- Add Zod schemas.
- Add shared GET.
- Add admin GET/PUT/reset.
- Add audit + cache invalidation + archived guard.
- Add API tests.

**Exit:** API tests cover auth, validation, persistence, reset, audit, and year isolation.

### Phase 3 — Admin UI (PR 3)

- Add API client methods and `useGradeDescriptors`.
- Add `GradeDescriptorsCard`.
- Mount it on `/admin/transmutation`.
- Add loading/error/read-only states and test IDs.
- Add read-only Playwright coverage.

**Exit:** admin can view and validate changes; save path covered by offline rig later.

### Phase 4 — Teacher surfaces (PR 4)

- Update `gradeMath` helpers.
- Thread descriptors through ledger.
- Update footer/mobile/profile/dashboard/tokens.
- Make dashboard distribution dynamic on the server.
- Add Playwright checks for teacher surfaces.

**Exit:** every teacher descriptor display agrees with the API.

### Phase 5 — Forms, exports, integration (PR 5)

- SF9 dynamic grading-scale table.
- ECR export dynamic descriptor list.
- AIMS/EnrollPro sync payload fields.
- Seed scripts use defaults or stop writing stale descriptors.
- Add form/export/integration tests.

**Exit:** SF9/ECR/AIMS show the same labels as the class record.

### Phase 6 — Regression and rollout (PR 6)

- `pnpm run verify`
- Full Playwright and offline rig.
- Update docs and release notes.
- Rollback rehearsal.

**Exit:** all gates green; rollback verified.

---

## 17. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| One surface still uses hardcoded labels | Medium | High | Surface-by-surface checklist plus Playwright assertions |
| Frontend/server default lists drift | Medium | Medium | Keep both constants clearly named; add a parity check script or PR checklist item |
| Historical report cards change | Low | High | Year-scoped rows; archived years read-only |
| Admin creates ambiguous pass/fail bands | Medium | High | Validation requires a boundary at 75 |
| Teacher page shows stale labels until reload | Medium | Low | Document; optional SSE in a future phase |
| Offline/print falls back to defaults | Medium | Low | Built-in defaults match DO 015; document limitation |
| SF5/SF6 remain on repealed DO 8 labels | Medium | Medium | Explicitly out of scope; track as a follow-up with policy sign-off |
| AIMS contract mismatch | Low | Medium | Publish exact field names before implementation |
| File size creep in `TransmutationTable.tsx` | Medium | Low | Extract `GradeDescriptorsCard.tsx` |
| DB error during read | Low | Medium | Fall back to defaults and log a warning |

---

## 18. Rollout and rollback

### Rollout

Apply the migration and deploy the additive read endpoint first, then the admin UI and teacher/registrar surfaces. Verify defaults match the current hardcoded DO 015 labels before enabling editing.

### Rollback

- Code rollback is safe: the table is additive and old code ignores it.
- No grade data is touched.
- If the table must be dropped:
  ```sql
  DROP TABLE IF EXISTS "GradeDescriptor";
  ```
- Revert frontend to the built-in defaults; no student data loss.

---

## 19. Acceptance criteria

- [ ] Admin can edit descriptor name, min, max, and optional description on `/admin/transmutation`.
- [ ] Save is blocked with clear messages for gaps, overlaps, duplicate names, non-integer bounds, or a band crossing 75.
- [ ] Reset restores DO 015 defaults.
- [ ] Teacher class record descriptor column uses the configured labels.
- [ ] Teacher dashboard chart and mobile descriptor UI use the configured labels/ranges.
- [ ] Student Grade Profile uses the configured labels/ranges.
- [ ] SF9 grading-scale table uses the configured labels/ranges; remarks remain derived from 75.
- [ ] ECR export descriptor column uses the configured labels.
- [ ] AIMS/EnrollPro sync payload includes `descriptor` and `generalAverageDescriptor`.
- [ ] Historical years are isolated; editing one year does not affect another.
- [ ] Archived years are read-only.
- [ ] All changes are audit-logged.
- [ ] `pnpm run verify` passes.
- [ ] Offline/no-backend rendering still shows defaults.
- [ ] No grade value, average, promotion status, or EOSY state changes because of a descriptor edit.

---

## 20. Follow-ups (not v1)

1. SF5/SF6 migration to DO 015 descriptors (requires policy/form-template approval).
2. School-year selector inside the admin card (API already supports it).
3. "Copy descriptors from another year" action.
4. Seed legacy DO 8 descriptors for pre-2026-2027 years.
5. SSE event so open teacher pages refresh immediately after an admin edit.
6. Remove or formally deprecate `Grade.qualitativeDescriptor` after all imports stop writing it.
7. Shared defaults parity checker between root and server projects.
