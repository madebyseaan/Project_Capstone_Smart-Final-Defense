# Zero-Based Grading Mode — Implementation Plan

> **Status:** Draft for review  
> **Created:** 2026-11-06  
> **Feature owner:** Admin / Grading  
> **DepEd basis:** DO 015, s. 2026 (effective SY 2026–2027); DO 8, s. 2015 (repealed)  
> **Primary surface:** `/admin/transmutation`  
> **Related:** `docs/TRANSMUTATION-VALIDATION-FIX-PLAN.md`, `docs/GRADING-SYSTEM-REDESIGN-PLAN.md`

---

## How to use this document

Treat each **gate** (G0–G5) as a hard stop. Do not start the next gate until the current gate's evidence is attached and reviewed. A gate passes only when its commands exit `0` and its evidence is saved under `artifacts/grading-mode/`.

This plan is intentionally split into two tracks:

- **Track A — Feature:** the grading-mode switch, computation, API, UI, and reports.
- **Track B — Policy alignment:** descriptor bands and any report wording that still uses DO 8 terminology.

Track A can be implemented first. Track B is **partially implemented** in this pass (teacher ledger, SF9, ECR, and teacher dashboards). SF5/SF6 still use the legacy official-form descriptor scale and must be completed or explicitly waived before a full policy sign-off.

---

## Implementation status (2026-11-06)

| Area | Status | Evidence |
|---|---|---|
| Schema: `SchoolYear.gradingMode` | Implemented | Migration `20261106000000_add_school_year_grading_mode`; Prisma client generated |
| Canonical math | Implemented | `server/src/lib/gradingMode.ts`; 6 unit tests pass |
| Grade save + recompute | Implemented | `calculateGrades` mode-aware; `recomputeStoredGrades` per-SY and scoped |
| Admin API + guards + audit | Implemented | `GET/PUT /api/admin/grading-mode`; `POST /api/admin/grading-mode/recompute`; 10 API tests pass |
| Admin switch UI | Implemented | Switch, badge, confirmation, read-only table, blocked/recommendation cards |
| Teacher ledger preview | Implemented | `gradeMath`, `ClassRecordView`, `ClassRecordTable`, `LedgerRow` mode-aware |
| SF9 / ECR / teacher dashboards | Implemented | DO 015 descriptor bands and mode-aware ECR identity helper |
| SF5 / SF6 descriptor scale | Pending | Still use the legacy official-form letters; separate form-template update required |
| Playwright read-only admin | Passed | 3/3 tests |
| Playwright read-only teacher | Passed | 1/1 test |
| Playwright offline write | Passed | Toggle OFF/ON, teacher TG 84→81 and 78→75, restored |
| Full server suite | Passed | 476 passed, 77 skipped |
| `pnpm run verify` | Passed | Typecheck + client build + server build + lint (0 errors) + server tests |
| PM2 log gate (G5) | Passed | `artifacts/grading-mode/G5-pm2-*.log` |
| Full Playwright suite | 27 passed / 1 pre-existing failure / 2 skipped | `E-16 print pagination` also fails after reverting the SF9 descriptor text, so it is not caused by this change |

### Known follow-ups

1. SF5/SF6 descriptor migration to DO 015 (or an explicit policy waiver).
2. The `E-16 print pagination` failure is data-dependent and pre-existing; investigate separately.
3. The forms Playwright spec currently skips when the SF9 preview is not open on the landing page; add a deterministic SF9 navigation helper.

---

## 1. Executive summary

SMART already uses the DepEd **Adjusted Transmutation Table** for SY 2026–2027. DepEd Order No. 015, s. 2026 removes transmutation beginning **SY 2027–2028** for Key Stages 2–4 (Grades 4–12). In zero-based grading:

- The **Initial Grade (IG)** is reported directly as the **Term Grade (TG)**.
- No transmutation table is applied.
- The TG is rounded to the nearest whole number.
- **75 remains the passing grade.**
- The minimum reportable grade is **60** (per DO 015 explainers; confirm in Annex D during G0).

This plan adds an admin-controlled **ON/OFF switch** on the Transmutation Table page:

| Switch | Mode | Behavior |
|---|---|---|
| ON | `TRANSMUTED` | Current behavior: IG → adjusted table → TG |
| OFF | `ZERO_BASED` | IG → rounded directly → TG |

The switch applies to the **active school year only**, is recorded per school year, and recomputes stored term grades for that year. Raw scores are never modified.

---

## 2. Policy basis

### 2.1 Official rules

**DO 8, s. 2015 (repealed):**

- Minimum grade to pass a learning area: **60 raw**.
- 60 raw was transmuted to **75** on the report card.
- Lowest mark on the report card: **60**.

**DO 015, s. 2026 (signed June 4, 2026):**

- **SY 2026–2027:** adjusted transmutation table.
- Raw **70.00** → transmuted passing grade **75**.
- **SY 2027–2028 onward:** zero-based grading for KS2–KS4.
- TG = computed IG directly; no transmutation; **75** minimum passing grade.
- TG and FG are rounded to the nearest whole number.
- DO 015 expressly repeals DO 8, s. 2015.

### 2.2 Descriptor bands under DO 015

| Numerical grade | Descriptor |
|---|---|
| 90–100 | Advancing |
| 80–89 | Benchmarking |
| 75–79 | Connecting |
| 65–74 | Developing |
| 0–64 | Emerging |

> **Important:** The current SMART code uses 85–89 / 80–84 / 75–79 / 60–74 in several places. That is not the DO 015 table. See Track B in §10.4.

### 2.3 What changes in SMART

| Area | Change |
|---|---|
| Data model | Add `SchoolYear.gradingMode` |
| Computation | Add `computeTermGrade()` and mode-aware `calculateGrades()` |
| Recompute | `recomputeStoredGrades()` respects each school year's mode |
| Admin UI | Add the ON/OFF switch, confirmation, and disabled-table state |
| Teacher ledger | Preview uses the class record's `gradingMode` |
| Reports | SF9/SF10 read stored TG; ECR export uses identity mapping when zero-based |
| Audit | Mode changes are written to the audit log |
| Tests | Unit, API, Playwright read-only, and offline-rig write tests |

### 2.4 Non-goals

- Changing WW/PT/EX weights.
- Automatically switching modes based on the school-year label.
- Rewriting archived or historical school years.
- Redesigning SF5/SF6 beyond descriptor alignment.
- Changing promotion, remedial, or honors policy beyond the grade values produced by the selected mode.
- Building a new grading-policy engine.

---

## 3. Locked decisions

| ID | Decision | Rationale |
|---|---|---|
| D1 | Store mode **per school year** on `SchoolYear.gradingMode` | Historical years keep their original mode; no global toggle can rewrite history |
| D2 | Passing grade is always **75** | DepEd passing is on the TG/FG, not the raw IG |
| D3 | Zero-based formula: `min(100, max(60, round(IG)))` | DO 015 explainers state a 60 floor; confirm in Annex D at G0 |
| D4 | Manual switch, with a **recommended mode** badge based on SY label | Avoids surprising automatic changes; the admin remains in control |
| D5 | Apply to the **active SY only**; block `ARCHIVED` years | Prevents historical rewrites |
| D6 | Block mode changes when the active SY has **finalized grades** or **EOSY snapshots** | A mode change is a policy change; unfinalize first |
| D7 | Recompute **only the active SY** on switch | Other years must not move |
| D8 | Main Playwright suite stays **read-only**; writes run in `e2e/offline` | Matches the existing `playwright.config.ts` contract |
| D9 | Default `gradingMode` is `TRANSMUTED` for all existing and new rows | Preserves current behavior and keeps test fixtures deterministic |
| D10 | Zero-based mode disables table editing in v1 | Prevents edits that have no effect; the table is retained for switching back |

### Open decisions (resolve at G0)

| ID | Question | Recommended default |
|---|---|---|
| O1 | Does DO 015 Annex D explicitly prescribe the 60 floor for zero-based TG? | Keep the 60 floor; remove only if Annex D says otherwise |
| O2 | Should term-finalized grades block the switch, or only EOSY-finalized? | Block both; require unfinalize first |
| O3 | Should table editing be allowed while zero-based is active? | No in v1; revisit later |
| O4 | Should SF5/SF6 DO 8 descriptor letters be migrated in this release? | Yes, or explicitly mark the forms as legacy and block G5 |
| O5 | Should a `GradingModeHistory` table be added? | No; the audit log is sufficient |

---

## 4. Current-state audit

### 4.1 Admin surface

| Path | Current behavior |
|---|---|
| `src/pages/admin/TransmutationTable.tsx:45` | Editable 41-row table; Save / Reset / Add Row; no mode switch |
| `src/pages/admin/TransmutationTable.tsx:147-192` | Client-side gap/overlap validation |
| `server/src/routes/admin-sub/grading.ts:210` | `GET /api/admin/transmutation-table` returns array |
| `server/src/routes/admin-sub/grading.ts:220` | `PUT /api/admin/transmutation-table` replaces the table |
| `server/src/routes/admin-sub/grading.ts:358` | `POST /api/admin/transmutation-table/reset` restores 41 adjusted-table rows |

### 4.2 Computation

| Path | Current behavior |
|---|---|
| `server/src/routes/grades-sub/helpers.ts:284` | `calculateGrades()` computes PS/IG, then always calls `transmute()` |
| `server/src/routes/grades-sub/helpers.ts:334` | `transmute()` loads the table and returns the matched TG, fallback `60` |
| `server/src/lib/gradeRecalc.ts:49` | `recomputeStoredGrades()` scans **all** grades; no school-year filter |
| `server/src/lib/gradeRecalc.ts:52` | `prisma.grade.findMany()` selects every grade |
| `server/src/routes/grades-sub/classes.ts:506`, `:790` | Grade save paths call `calculateGrades()` |
| `server/src/routes/grades-sub/dashboard.ts:237` | Dashboard recalculation calls `calculateGrades()` |
| `server/src/lib/aimsImport.ts:385` | AIMS import calls `calculateGrades()` |
| `server/src/lib/ecrImport.ts:327` | ECR import calls `calculateGrades()` |

### 4.3 Teacher preview

| Path | Current behavior |
|---|---|
| `src/lib/gradeMath.ts:25` | `transmuteGrade()` always uses the table |
| `src/lib/gradeMath.ts:128` | `getDisplayFinalGrade()` always transmutes |
| `src/pages/teacher/components/ledger/LedgerRow.tsx:117` | Ledger TG uses `transmuteGrade()` |
| `src/pages/teacher/ClassRecordView.tsx:264` | Preview TG uses `getDisplayFinalGrade()` |
| `src/pages/teacher/hooks/useClassRecord.ts:51` | Fetches the table; no mode |

### 4.4 Reports and exports

| Path | Current behavior |
|---|---|
| `server/src/lib/sf9Composer.ts` | Reads stored `quarterlyGrade` |
| `server/src/lib/sf10.ts` | Reads stored grades; snapshots only when no live grades |
| `server/src/lib/sf5Composer.ts:78-86` | Uses DO 8 O/VS/S/FS/DNME descriptors |
| `server/src/lib/sf6Composer.ts:116-123` | Uses DO 8 O/VS/S/FS/DNME descriptors |
| `server/src/lib/ecrExport.ts:159` | Injects the transmutation table into the Excel HELPER sheet |
| `server/src/lib/ecrExport.ts:269` | Loads the table for every export |

### 4.5 Data and seeds

| Path | Current behavior |
|---|---|
| `server/prisma/schema.prisma:512` | `SchoolYear` has no grading mode |
| `server/prisma/schema.prisma:628` | `TransmutationEntry` |
| `server/scripts/seed-test-base.ts:30` | Fixture year `2088-2089`; no grading mode |
| `server/scripts/seed-offline-fixtures.ts:47` | Rig year `2088-2089`; no grading mode |
| `server/prisma/check-grade-alignment.ts` | Recomputes with the table only |
| `server/prisma/recompute-stale-grades.ts` | Recomputes with the table only |
| `server/scripts/realign-seeded-grades.ts` | Recomputes with the table only |

### 4.6 Verification infrastructure

| Path | Current capability |
|---|---|
| `playwright.config.ts:8-9` | Main suite is **READ-ONLY** |
| `e2e/fixtures.ts:71` | `collectProblems()` captures console errors and API >= 400 |
| `e2e/offline/playwright.offline.config.ts` | Isolated test DB + loopback stubs; write-capable |
| `e2e/offline/guards.mjs:32` | Refuses non-`*_test` DB and remote integrations |
| `ecosystem.config.cjs:5` | PM2 `server` process |
| `.opencode/command/debug.md` | Manual PM2 log commands |
| `package.json:18` | `verify` gate |
| No `.github/workflows` | No CI; gates are local/manual |

### 4.7 Known policy inconsistencies (Track B)

| Path | Current bands/labels | DO 015 |
|---|---|---|
| `src/lib/gradeMath.ts:49-55` | 85–89 / 80–84 / 75–79 / 60–74 | 80–89 / 75–79 / 65–74 / 0–64 |
| `src/components/forms/sf9/SF9Form.tsx:167-171` | 85–89 / 80–84 / 75–79 / 60–74 | Same as above |
| `server/src/lib/ecrExport.ts:142-148` | 85–89 / 80–84 / 75–79 / 60–74 | Same as above |
| `src/pages/teacher/StudentGradeProfile.tsx:62-63`, `:688-691` | DO 8 labels | DO 015 labels |
| `src/pages/teacher/Dashboard.tsx:299-319` | DO 8 labels | DO 015 labels |
| `src/pages/teacher/components/MobileDashboard.tsx:79-81` | DO 8 labels | DO 015 labels |
| `src/pages/registrar/components/SF5Form.tsx:26-27`, `:275` | DO 8 labels | DO 015 labels |
| `server/src/lib/sf5Composer.ts:7`, `:78-86` | DO 8 letters | DO 015 descriptors |
| `server/src/lib/sf6Composer.ts:116-123` | DO 8 letters | DO 015 descriptors |

---

## 5. Data model

### 5.1 Prisma schema

```prisma
enum GradingMode {
  TRANSMUTED
  ZERO_BASED
}

model SchoolYear {
  // existing fields...
  gradingMode GradingMode @default(TRANSMUTED)
}
```

### 5.2 Migration

```powershell
pnpm --prefix server run prisma:migrate -- --name add_school_year_grading_mode
pnpm --prefix server run prisma:generate
```

The migration adds the column with a default. Existing rows become `TRANSMUTED`. No data backfill is required.

> Run migrations against the approved dev/test database first. Do not modify `.env` or `.env.*`; take a backup before applying to any shared database.

### 5.3 Seed and test determinism

- `server/scripts/seed-test-base.ts`: set `gradingMode: "TRANSMUTED"` explicitly on create and update.
- `server/scripts/seed-offline-fixtures.ts`: same.
- Do **not** auto-derive mode from the year label in code. The year `2088-2089` is used by tests and would otherwise become zero-based unexpectedly.
- The admin UI may show a **recommendation** based on the label, but the stored value remains explicit.

### 5.4 Migration rollback

Prisma does not generate down migrations. If a rollback is required after data has been written:

```sql
-- Only after confirming no code reads the column.
ALTER TABLE "SchoolYear" DROP COLUMN "gradingMode";
DROP TYPE "GradingMode";
```

Do not drop the column while zero-based mode is active. See §16.

---

## 6. Computation design

### 6.1 Pure functions

Create `server/src/lib/gradingMode.ts`. Prefer the generated Prisma `GradingMode` type in server code; the literal union below is illustrative.

```ts
export type GradingMode = "TRANSMUTED" | "ZERO_BASED";

export function roundGrade(value: number): number {
  return Math.round(value * 100) / 100;
}

export function lookupTransmutedGrade(
  table: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>,
  initialGrade: number,
): number | null {
  const ig = roundGrade(initialGrade);
  for (const entry of table) {
    if (ig >= entry.minGrade && ig <= entry.maxGrade) return entry.transmutedGrade;
  }
  return null;
}

export function computeTermGrade(
  initialGrade: number,
  mode: GradingMode,
  table: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>,
): number {
  if (mode === "ZERO_BASED") {
    return Math.min(100, Math.max(60, Math.round(roundGrade(initialGrade))));
  }
  const transmuted = lookupTransmutedGrade(table, initialGrade);
  if (transmuted === null) {
    // Keep the existing fallback, but log via the caller.
    return 60;
  }
  return transmuted;
}

export function recommendedModeForSchoolYear(label: string): GradingMode {
  const start = Number.parseInt(label.split("-")[0] ?? "", 10);
  return Number.isFinite(start) && start >= 2027 ? "ZERO_BASED" : "TRANSMUTED";
}
```

> The exact floor behavior is O1. If Annex D says no floor, change the zero-based branch to `Math.min(100, Math.round(roundGrade(initialGrade)))`.

### 6.2 Per-school-year mode resolution

Add to `server/src/lib/gradingMode.ts`:

```ts
export async function getGradingModeForSchoolYear(schoolYear: string): Promise<GradingMode>;
export function invalidateGradingModeCache(): void;
```

Rules:

- Query `SchoolYear.gradingMode` by `label`.
- Cache by label for 5 minutes.
- Fall back to `TRANSMUTED` and log a warning if the year is not found.
- Invalidate after a mode change and after a school-year rollover.
- Wire `invalidateGradingModeCache()` into `invalidateSchoolYearCache()` or the year-change path in `schoolYearResolver.ts` so a newly created/linked year never serves a stale mode.

### 6.3 `calculateGrades()` change

Add a required `gradingMode: GradingMode` parameter:

```ts
export async function calculateGrades(
  // existing params...
  gradingMode: GradingMode,
)
```

Callers resolve the mode from the class assignment's `schoolYear`:

- `classes.ts` grade save paths
- `dashboard.ts` recalculation
- `aimsImport.ts`
- `ecrImport.ts`

The build must fail if a caller is missed. Do not default the parameter to `TRANSMUTED`; a silent default would hide missed call sites.

### 6.4 `recomputeStoredGrades()` change

```ts
export interface RecomputeOptions {
  schoolYear?: string;
  modeOverride?: GradingMode;
}
```

Rules:

- Select `classAssignment.schoolYear` with each grade.
- If `schoolYear` is provided, filter to that year.
- Resolve the mode per school year unless `modeOverride` is provided.
- Compute `initialGrade` with the existing weights.
- Compute `quarterlyGrade` with `computeTermGrade(initial, mode, table)`.
- Return `{ scanned, updated, unrecomputable, durationMs, byMode }`.
- Keep the existing serialization queue.

This makes table/weight realignment respect each year's mode. A table edit must not re-transmute zero-based years.

### 6.5 Worked examples

Assumptions: WW 20%, PT 50%, QA 30%.

| Student | WW PS | PT PS | QA PS | IG | Transmuted (2026–27 table) | Zero-based |
|---|---:|---:|---:|---:|---:|---:|
| A | 70 | 80 | 90 | 81.00 | 84 | 81 |
| B | 70 | 75 | 78 | 74.90 | 79 | 75 |
| C | 60 | 60 | 60 | 60.00 | 72 | 60 |
| D | 50 | 50 | 50 | 50.00 | 70 | 60 (floor) |
| E | 100 | 100 | 100 | 100.00 | 100 | 100 |

Boundary rules:

- `74.49` → zero-based `74` (fail).
- `74.50` → zero-based `75` (pass; standard round-half-up).
- `75.00` → zero-based `75` (pass).
- `0.00` → zero-based `60` (floor), still failing because 60 < 75.

### 6.6 Passing and descriptors

- Pass/fail is evaluated on the **stored TG** (`quarterlyGrade`), not the IG.
- `PASSING_GRADE` stays `75` (`server/src/lib/promotion.ts:22`).
- Descriptors are derived from the TG using the DO 015 bands.
- Do not persist a separate descriptor unless a future audit requirement demands it. The existing `Grade.qualitativeDescriptor` is null; the forms compute descriptors.

---

## 7. API design

### 7.1 `GET /api/admin/grading-mode`

Auth: admin only.

Response:

```json
{
  "mode": "TRANSMUTED",
  "recommendedMode": "ZERO_BASED",
  "schoolYear": {
    "id": "cuid",
    "label": "2027-2028",
    "status": "ACTIVE"
  },
  "canChange": true,
  "blockedReason": null,
  "gradeCount": 1234
}
```

`blockedReason` values:

- `ARCHIVED_SCHOOL_YEAR`
- `FINALIZED_GRADES`
- `EOSY_FINALIZED`
- `NO_ACTIVE_SCHOOL_YEAR`

`gradeCount` is the number of grades in the active SY; use it in the confirmation dialog.

### 7.2 `PUT /api/admin/grading-mode`

Auth: admin only. Zod-validated.

Request:

```json
{ "mode": "ZERO_BASED" }
```

Response:

```json
{
  "mode": "ZERO_BASED",
  "schoolYear": { "id": "cuid", "label": "2027-2028" },
  "recompute": {
    "scanned": 1234,
    "updated": 1234,
    "unrecomputable": 0,
    "durationMs": 812,
    "byMode": { "TRANSMUTED": 0, "ZERO_BASED": 1234 }
  }
}
```

Errors:

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_MODE` | Not `TRANSMUTED` or `ZERO_BASED` |
| 403 | `FORBIDDEN` | Not an admin |
| 409 | `ARCHIVED_SCHOOL_YEAR` | Active year is archived |
| 409 | `FINALIZED_GRADES` | At least one grade is finalized/locked |
| 409 | `EOSY_FINALIZED` | EOSY snapshots exist for the active year |
| 409 | `INVALID_TRANSMUTATION_TABLE` | Switching ON but the table has gaps/overlaps |
| 500 | `RECOMPUTE_FAILED` | Mode changed but grade realignment failed; retry |

Idempotency: if the requested mode equals the current mode, return `200` with `updated: 0` and no audit entry.

### 7.3 `POST /api/admin/grading-mode/recompute`

Auth: admin only. Re-runs `recomputeStoredGrades({ schoolYear: active.label })` for recovery. Returns the same `recompute` summary. This endpoint is idempotent.

### 7.4 `GET /api/grades/class-record/:classAssignmentId`

Add to the response:

```json
{
  "gradingMode": "ZERO_BASED"
}
```

The teacher ledger uses this value; no extra round trip is needed.

`GET /api/grades/transmutation-table` remains an array for backward compatibility.

### 7.5 Audit log

Use the existing `createAuditLog` pattern from `server/src/routes/admin-sub/grading.ts:248`:

- Action: `UPDATE`
- Category: `CONFIG`
- Title: `GradingMode`
- Detail: `Changed grading mode from TRANSMUTED to ZERO_BASED for SY 2027-2028 (1234 grades recomputed)`
- Severity: `INFO`
- Entity ID: active school year ID

Audit failure must not roll back the mode change; log the audit failure separately.

### 7.6 Cache invalidation

After a successful mode change:

```ts
invalidateGradingModeCache();
invalidateSchoolYearCache();
invalidateTransmutationCache(); // if the table was validated/reloaded
```

After a table edit, `recomputeStoredGrades()` must respect each year's mode.

---

## 8. UI design — admin Transmutation Table page

### 8.1 Layout

Add a **Grading Mode** card above the existing Transmutation Ranges card.

```
PageHeader: "Transmutation Table"
Description: "DepEd grading mode and transmutation — initial grade to term grade"

[Grading Mode card]
  Title: "Grading Mode"
  Description: "Applies to SY 2026-2027. The passing grade remains 75."
  [Switch] ON = Transmutation (Adjusted Table) / OFF = Zero-Based
  [Badge] Transmuted | Zero-Based
  Helper text with DO 015 citation
  Warning when recommended mode differs
  Blocked-state message when canChange = false

[Existing Transmutation Ranges card]
  Disabled when mode = ZERO_BASED
```

### 8.2 Switch behavior

- ON = `TRANSMUTED`.
- OFF = `ZERO_BASED`.
- The switch is disabled when:
  - Loading or saving.
  - `canChange` is false.
  - The table has unsaved edits (`hasChanges`), to avoid losing edits.
- Clicking the switch opens a confirmation dialog; it does not change state immediately.
- On cancel: no API call, no state change.
- On confirm: call `PUT /api/admin/grading-mode`, then refresh the table and mode.
- On success: toast `Grading mode updated. 1,234 term grades recomputed.`
- On failure: keep the old mode; show the server message.

### 8.3 Confirmation dialog

Title:

- Switching to zero-based: `Switch to Zero-Based Grading?`
- Switching back: `Switch to Transmutation?`

Body:

- `This applies to SY 2026-2027.`
- `This will recompute 1,234 stored term grades from their existing category scores.`
- `Raw scores will not change.`
- `The passing grade remains 75.`
- If blocked: `This school year has finalized grades. Unfinalize them before changing the mode.`

Buttons:

- `Cancel`
- `Switch to Zero-Based` / `Switch to Transmutation`

Use the existing `ConfirmDialog` component for focus trapping.

### 8.4 Zero-based state

When `mode === "ZERO_BASED"`:

- Show a banner: `Zero-based grading is active. The transmutation table is retained but not applied.`
- Disable table inputs.
- Disable `Add Row`, `Save Changes`, and `Reset Defaults`.
- Keep the table visible for reference.
- Add `aria-disabled="true"` to the table container.

### 8.5 Accessibility

- Use a native `<button role="switch" aria-checked={checked}>` (new `src/components/ui/switch.tsx`).
- The switch has an accessible label: `Transmutation table` or `Zero-based grading`.
- Do not rely on color alone; the badge text states the mode.
- Keyboard: Space/Enter toggles; focus ring uses `focus-visible:ring-3 focus-visible:ring-ring/50`.
- The confirmation uses `role="dialog"` and returns focus to the switch.

### 8.6 Test IDs

| Element | `data-testid` |
|---|---|
| Grading mode card | `grading-mode-card` |
| Switch | `grading-mode-switch` |
| Mode badge | `grading-mode-badge` |
| Active SY label | `grading-mode-sy-label` |
| Blocked message | `grading-mode-blocked` |
| Confirmation dialog | `grading-mode-confirm-dialog` |
| Confirm button | `grading-mode-confirm-submit` |
| Read-only banner | `transmutation-table-readonly-banner` |
| Table card | `transmutation-table-card` |
| Table row | `transmutation-table-row` |
| Class record mode badge | `class-record-grading-mode-badge` |
| Ledger TG cell | `ledger-term-grade` (with `data-student-id` and `data-term`) |

### 8.7 Design-system compliance

- Use `PageHeader`, `Card`, `Button`, `Badge`, `ConfirmDialog`.
- Use semantic tokens only: `text-foreground`, `text-muted-foreground`, `bg-primary`, `bg-muted`, `border-border`.
- No raw palette classes for UI chrome.
- No inline color styles except theme-driven values.
- Page root: `space-y-6`.

---

## 9. Frontend data flow

### 9.1 API client types

Add to `src/lib/api.ts`:

```ts
export type GradingMode = "TRANSMUTED" | "ZERO_BASED";

export interface GradingModeResponse {
  mode: GradingMode;
  recommendedMode: GradingMode;
  schoolYear: { id: string; label: string; status: string };
  canChange: boolean;
  blockedReason: string | null;
  gradeCount: number;
}
```

`adminApi`:

```ts
getGradingMode: () => api.get<GradingModeResponse>("/admin/grading-mode"),
updateGradingMode: (mode: GradingMode) =>
  api.put<{ mode: GradingMode; schoolYear: { id: string; label: string }; recompute: RecomputeSummary }>(
    "/admin/grading-mode",
    { mode },
  ),
recomputeGradingMode: () => api.post<{ recompute: RecomputeSummary }>("/admin/grading-mode/recompute"),
```

`gradesApi`:

- Keep `getTransmutationTable()`.
- Add `gradingMode` to the `ClassRecordResponse` type in `useClassRecord.ts`.

### 9.2 React Query

Add:

```ts
useGradingMode() // queryKey: ["grading-mode"]
```

After a successful update:

```ts
queryClient.invalidateQueries({ queryKey: ["grading-mode"] });
queryClient.invalidateQueries({ queryKey: ["transmutation-table"] });
queryClient.invalidateQueries({ queryKey: ["class-record"] });
```

The class-record invalidation ensures teacher previews pick up the new mode on the next fetch.

### 9.3 `src/lib/gradeMath.ts`

Change:

```ts
export function computeTermGrade(
  initialGrade: number,
  table: TransmutationRow[] | undefined,
  mode: GradingMode,
): number;
```

Rules:

- `ZERO_BASED`: `Math.min(100, Math.max(60, Math.round(Math.round(initialGrade * 100) / 100)))`.
- `TRANSMUTED`: existing table lookup with the 2026–27 fallback.
- `getDisplayFinalGrade(record, term, weights, table, mode)` passes the mode through.
- Update `GRADE_DESCRIPTORS` to the DO 015 bands (Track B).

### 9.4 Teacher ledger

- `ClassRecordView` reads `gradingMode` from `useClassRecordQuery`.
- Pass `gradingMode` to `ClassRecordTable` and `LedgerRow`.
- `LedgerRow` calls `transmuteGrade(initial, table, gradingMode)`.
- `ClassRecordView`'s `getDisplayFinalGrade` passes the mode.
- Mobile list uses the same `getDisplayFinalGrade` prop; no separate logic.

### 9.5 Stale-page limitation

There is no grading-mode SSE event. A teacher page that is already open will keep the old mode until it refetches. The admin success toast should say: `Teachers will see the new mode on their next page load.` If this becomes a problem, add a grading-mode SSE event in a follow-up.

---

## 10. Reports and exports

### 10.1 SF9 and SF10

- Both read stored `quarterlyGrade`; no computation change.
- Update the hardcoded descriptor table in `src/components/forms/sf9/SF9Form.tsx:167-171` to DO 015 bands.
- Audit SF10 for the same descriptor table.
- Verify with Playwright that the SF9 term grades equal the teacher ledger and class-record API values.

### 10.2 ECR export

`ecrExport.ts` currently injects the transmutation table into the HELPER sheet. For zero-based mode:

- Add `buildIdentityHelperCells()`:
  - Rows 8–47 (`i = 0..39`): `C = 99.5 - i` (99.5 down to 60.5), `D = 100 - i` (100 down to 61).
  - Row 48 (`i = 40`): `C = 0`, `D = 60` (floor).
  - `F = 100 - i`, `G = descriptorForGrade(100 - i)` using DO 015 bands.
  - The half-point `C` thresholds preserve round-half-up (e.g. `74.50 → 75`, `74.49 → 74`); the last row preserves the 60 floor.
  - Validate the Excel `MATCH(..., -1)` / `XLOOKUP(..., -1)` behavior against a sample workbook during G4.
- Select the helper based on the class assignment's school year mode:
  - `TRANSMUTED` → `buildHelperCells(table)`
  - `ZERO_BASED` → `buildIdentityHelperCells()`
- Also write cached TG values with `computeTermGrade()` so non-recalculating viewers show the correct values.
- Add a Playwright download assertion: read the exported workbook with `xlsx`/`exceljs` and verify a known student's TG.

### 10.3 SF5 and SF6

These still use DO 8 O/VS/S/FS/DNME descriptors. Track B must either:

1. Migrate them to DO 015 descriptors, or
2. Mark them as legacy and block G5 until a separate approved plan exists.

Recommended: migrate the descriptor mapping and labels in the same release, because zero-based grades will otherwise be described with repealed terminology.

### 10.4 Descriptor alignment checklist (Track B)

- [ ] `src/lib/gradeMath.ts:49-55`
- [ ] `src/components/forms/sf9/SF9Form.tsx:167-171`
- [ ] `server/src/lib/ecrExport.ts:142-148`
- [ ] `src/pages/teacher/StudentGradeProfile.tsx:62-63`, `:688-691`
- [ ] `src/pages/teacher/Dashboard.tsx:299-319`
- [ ] `src/pages/teacher/components/MobileDashboard.tsx:79-81`
- [ ] `src/pages/registrar/components/SF5Form.tsx:26-27`, `:275`
- [ ] `server/src/lib/sf5Composer.ts:7`, `:78-86`
- [ ] `server/src/lib/sf6Composer.ts:116-123`
- [ ] Add a server test asserting the DO 015 bands
- [ ] Add a Playwright assertion for the SF9 descriptor table

---

## 11. Edge cases and guards

| Case | Behavior |
|---|---|
| Year `ARCHIVED` | `409 ARCHIVED_SCHOOL_YEAR`; switch disabled |
| Any `Grade.status = FINALIZED`/`LOCKED` in the active SY | `409 FINALIZED_GRADES`; ask registrar to unfinalize |
| EOSY snapshot exists for the active SY | `409 EOSY_FINALIZED`; unfinalize EOSY first |
| No active `SchoolYear` | `409 NO_ACTIVE_SCHOOL_YEAR`; page shows an error |
| No grades in the active SY | Allow the switch; `updated: 0` |
| Switching ON with an invalid table | `409 INVALID_TRANSMUTATION_TABLE` |
| Same mode requested | Idempotent `200`, no audit entry |
| Recompute fails | Mode persists; return `500 RECOMPUTE_FAILED`; UI offers retry |
| Teacher saves a grade during recompute | The save uses the new mode; recompute is serialized |
| Table edited while zero-based | Table editing disabled in v1 |
| Table edited while transmuted | Existing behavior; recompute respects each SY's mode |
| Historical years | Never touched by the switch; `recomputeStoredGrades` scoped to active SY |
| Imports (`aimsImport`, `ecrImport`) | Resolve the class assignment's mode; no silent transmute |
| Promotion/remedial | Read stored TG; no code change, but verify with tests |
| SF10 snapshot fallback | Snapshots are audit copies; live grades win |
| Low grade below 60 | Stored TG floor is 60; still failing |
| Honor/award thresholds | Unchanged (GA >= 90, no final grade below 80) |
| Grade lock | Mode switch is admin config; guard on finalized grades prevents surprises |
| Concurrent admin switches | Serialize with a module-level promise queue |

---

## 12. Test strategy

### 12.1 Test pyramid

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | `computeTermGrade`, `recommendedModeForSchoolYear`, descriptor bands |
| API | Vitest + Supertest | Mode GET/PUT, guards, audit, recompute scoping |
| Frontend read-only | Playwright main suite | Admin switch display, cancel dialog, teacher ledger, SF9 |
| Frontend write | Playwright offline rig | Toggle ON/OFF, persistence, recompute, rollback |
| Data integrity | Prisma scripts | `grades:check-alignment`, `grades:recompute` |
| Runtime logs | PM2 + terminal | No new errors after each gate |

### 12.2 New test files

| File | Purpose |
|---|---|
| `server/src/__tests__/grading-mode.test.ts` | Pure unit tests and descriptor bands |
| `server/src/__tests__/grading-mode-api.test.ts` | API/auth/guards/audit/recompute |
| `server/src/__tests__/grading-mode-recompute.test.ts` | `recomputeStoredGrades` scoping and per-SY modes |
| `e2e/grading-mode-admin.spec.ts` | Read-only admin UI + cancel + mobile |
| `e2e/grading-mode-teacher.spec.ts` | Teacher ledger matches API/expected TG |
| `e2e/grading-mode-forms.spec.ts` | SF9/SF10 descriptor table and TG |
| `e2e/offline/specs/offline-grading-mode.spec.ts` | Write toggle, persistence, recompute, rollback |
| `e2e/offline/specs/offline-grading-mode-guards.spec.ts` | Finalized/EOSY/archived guards |

### 12.3 Test data

**Server tests**

- Use the `2088-2089` base fixture from `seed-test-base.ts` as `TRANSMUTED`.
- Create a second year (`2087-2088`) and a third (`2086-2087`) inside the test for isolation.
- Create one section, one subject, one class assignment, and one student per year.
- Create grades with known PS values:
  - `writtenWorkPS: 70`, `perfTaskPS: 80`, `quarterlyAssessPS: 90` → IG `81.00`.
  - `initialGrade: 81.00`, `quarterlyGrade: 84` for TRANSMUTED.
  - Expected ZERO_BASED: `81`.
- Clean up by unique labels and IDs in `afterAll`.

**Offline rig**

Extend `server/scripts/seed-offline-fixtures.ts`:

- Set `SMART_TEST_ADMIN_EMAIL/PASSWORD`, `SMART_TEST_TEACHER_EMAIL/PASSWORD`, and `SMART_TEST_REGISTRAR_EMAIL/PASSWORD` in the process environment. `seed-offline-fixtures.ts` refuses to run without them.
- Set `gradingMode: "TRANSMUTED"` on the fixture year.
- Create a deterministic grade for at least two students:
  - Student 1: IG `81.00` → TRANSMUTED `84`, ZERO_BASED `81`.
  - Student 2: IG `74.50` → TRANSMUTED `78`, ZERO_BASED `75`.
- Keep grades `DRAFT` so the mode switch is allowed.
- Upsert by the unique `(studentId, classAssignmentId, term)` key so reruns are idempotent.

### 12.4 Existing tests that must still pass

- `server/src/__tests__/grade-lock.test.ts`
- `server/src/__tests__/sf10-snapshot.test.ts`
- `server/src/__tests__/validation.test.ts`
- `server/src/__tests__/admin-year-switch.test.ts`
- All current Playwright specs
- All current offline rig specs

### 12.5 Manual smoke (after G5)

1. Admin: switch OFF; confirm; reload; mode stays zero-based.
2. Teacher: open a class record; TG equals the zero-based value.
3. Registrar: open SF9; TG matches the ledger; descriptor uses DO 015.
4. Admin: switch ON; confirm; TG returns to the transmuted value.
5. Admin: try switching with a finalized grade; confirm the 409 message.
6. PM2: no new grading-related errors.

---

## 13. Implementation phases and gates

### Gate summary

| Gate | Name | Automated checks | Playwright | PM2 / terminal | Exit |
|---|---|---|---|---|---|
| G0 | Policy lock + baseline | None | None | Baseline capture | Decisions signed; baseline saved |
| G1 | Schema + core math | `server build`, `server test` | None | `G1-pm2.log` | Unit tests + build + PM2 pass |
| G2 | API + recompute | `server build`, `server test` | None | `G2-pm2.log` | API/guard/recompute tests + PM2 pass |
| G3 | Admin UI switch | Root build/lint (partial) | `grading-mode-admin.spec.ts`, `offline-grading-mode.spec.ts` | `G3-pm2.log`, `G3-offline-terminal.log` | Read-only + write specs pass |
| G4 | Teacher + reports | `server test` | `grading-mode-teacher.spec.ts`, `grading-mode-forms.spec.ts` | `G4-pm2.log` | Ledger/SF9/SF10/ECR agree; descriptors correct |
| G5 | Full regression + rollback | `pnpm run verify`, data checks | Full `test:e2e`, full offline rig | `G5-pm2.log`, rollback log | All green; rollback verified |

### PR slicing

| PR | Contents | Gate |
|---|---|---|
| PR 1 | Schema, `gradingMode.ts`, `calculateGrades`, `recomputeStoredGrades`, seeds, unit tests | G1 |
| PR 2 | Mode GET/PUT/recompute endpoints, guards, audit, class-record mode, API tests | G2 |
| PR 3 | Switch primitive, admin card, confirmation, disabled table, API client, admin Playwright specs | G3 |
| PR 4 | Teacher ledger mode, SF9/SF10/ECR, descriptor alignment, teacher/forms Playwright specs | G4 |
| PR 5 | Gate runner, docs, full regression, rollback evidence | G5 |

Keep each PR independently reviewable. Do not mix unrelated refactors.

### G0 — Policy lock and baseline

**Goal:** Resolve open decisions before writing code.

Steps:

- Review §2 and §3 with the product owner.
- Confirm the 60 floor in DO 015 Annex D (O1).
- Confirm the finalized/EOSY guard (O2).
- Confirm Track B scope (O4).
- Capture the PM2 baseline:
  ```powershell
  New-Item -ItemType Directory -Force artifacts\grading-mode | Out-Null
  pm2 list | Tee-Object artifacts\grading-mode\G0-pm2-list.txt
  pm2 logs server --lines 200 --nostream --timestamp | Tee-Object artifacts\grading-mode\G0-pm2-baseline.log
  Invoke-RestMethod http://localhost:5003/api/health | ConvertTo-Json -Depth 5 | Tee-Object artifacts\grading-mode\G0-health.json
  ```
- Record the decisions in `artifacts/grading-mode/G0-decisions.md`.

**Exit criteria:**

- Decisions signed off.
- Baseline artifacts saved.
- No code changes.

### G1 — Schema and core computation

**Goal:** Add the mode to the data model and make the pure computation correct.

Steps:

- Add the `GradingMode` enum and `SchoolYear.gradingMode`.
- Run the migration and regenerate Prisma.
- Create `server/src/lib/gradingMode.ts` with:
  - `computeTermGrade`
  - `lookupTransmutedGrade`
  - `recommendedModeForSchoolYear`
  - `getGradingModeForSchoolYear`
  - `invalidateGradingModeCache`
- Update `calculateGrades()` to require the mode.
- Update `recomputeStoredGrades()` with per-SY mode resolution and optional scoping.
- Update all `calculateGrades()` call sites.
- Update seed scripts to set `TRANSMUTED`.
- Add unit tests.

**Commands:**

```powershell
pnpm --prefix server run prisma:migrate -- --name add_school_year_grading_mode
pnpm --prefix server run prisma:generate
pnpm --prefix server run build
pnpm --prefix server test
```

**PM2 gate:**

```powershell
pm2 restart server --update-env
pm2 list
Invoke-RestMethod http://localhost:5003/api/health
pm2 logs server --lines 300 --nostream --timestamp | Tee-Object artifacts\grading-mode\G1-pm2.log
```

**Exit criteria:**

- Build and server tests pass.
- Unit tests cover 74.49, 74.50, 75.00, 60.00 floor, 100, and the transmuted table.
- PM2 log gate passes with the ignore list in §15.
- No new `[Transmutation]` warnings.

### G2 — API, audit, and recompute

**Goal:** Persist the mode and expose safe admin endpoints.

Steps:

- Add the zod schema.
- Add `GET /api/admin/grading-mode`.
- Add `PUT /api/admin/grading-mode`.
- Add `POST /api/admin/grading-mode/recompute`.
- Add the finalized/EOSY/archived guards.
- Add audit logging.
- Add cache invalidation.
- Add `gradingMode` to the class-record response.
- Add API and recompute tests.

**Commands:**

```powershell
pnpm --prefix server run build
pnpm --prefix server test
```

**PM2 gate:** same pattern as G1, artifact `G2-pm2.log`.

**Exit criteria:**

- API tests cover 200/400/403/409, idempotency, audit, and per-SY isolation.
- Recompute only touches the active SY.
- PM2 log gate passes.

### G3 — Admin UI switch

**Goal:** Implement the switch and confirmation flow.

Steps:

- Create `src/components/ui/switch.tsx`.
- Add the Grading Mode card to `TransmutationTable.tsx`.
- Add the confirmation dialog.
- Disable table editing when zero-based.
- Add test IDs.
- Add API client methods and React Query hooks.
- Add the read-only admin Playwright spec.
- Add the offline write spec.

**Commands:**

```powershell
pnpm run test:e2e -- e2e/grading-mode-admin.spec.ts
pnpm run test:e2e:offline -- e2e/offline/specs/offline-grading-mode.spec.ts
```

> If `run-playwright.mjs` does not accept extra args yet, add arg passthrough:
> `run("npx", ["playwright", "test", "-c", "e2e/offline/playwright.offline.config.ts", ...process.argv.slice(2)], ROOT)`.

**PM2 gate:** `G3-pm2.log` for the dev-stack spec. For the offline rig, save the terminal output to `G3-offline-terminal.log` and scan it.

**Exit criteria:**

- Read-only spec passes; cancel causes no API call.
- Offline write spec toggles OFF/ON, persists, recomputes, and restores.
- No console/API errors.
- PM2 log gate passes.

### G4 — Teacher ledger and reports

**Goal:** Make every surface agree with the stored TG.

Steps:

- Add `gradingMode` to the class-record response.
- Update `useClassRecordQuery` types.
- Update `gradeMath.ts`, `LedgerRow`, `ClassRecordView`, and `ClassRecordTable`.
- Update the SF9 descriptor table (Track B).
- Update `ecrExport.ts` with the identity helper.
- Add the teacher and forms Playwright specs.
- Add the ECR workbook assertion.

**Commands:**

```powershell
pnpm run test:e2e -- e2e/grading-mode-teacher.spec.ts e2e/grading-mode-forms.spec.ts
pnpm --prefix server test
```

**PM2 gate:** `G4-pm2.log`.

**Exit criteria:**

- Ledger TG equals the server-stored TG in both modes.
- SF9/SF10 TG equals the ledger.
- ECR export TG equals the ledger.
- Descriptor bands match DO 015.
- PM2 log gate passes.

### G5 — Full regression and rollback

**Goal:** Prove the change is safe end to end.

Steps:

- Run the full verify gate.
- Run the full Playwright suite.
- Run the full offline rig suite.
- Run the data-integrity checks.
- Toggle back to `TRANSMUTED`; verify the baseline grades.
- Capture all evidence.

**Commands:**

```powershell
pnpm run verify
pnpm run test:e2e
pnpm run test:e2e:offline
pnpm --prefix server run grades:check-alignment
pm2 logs server --lines 300 --nostream --timestamp | Tee-Object artifacts\grading-mode\G5-pm2.log
```

**Exit criteria:**

- `pnpm run verify` exits 0.
- Full E2E and offline suites pass.
- `grades:check-alignment` reports zero mismatches.
- Rollback restores the baseline.
- PM2 log gate passes.
- All evidence is attached.

---

## 14. Playwright verification matrix

| # | Function | Spec | Type | Key assertions |
|---|---|---|---|---|
| 1 | Admin page loads | `e2e/grading-mode-admin.spec.ts` | read-only | `grading-mode-card` visible; switch and badge visible; SY label visible |
| 2 | Mode reflects server | `e2e/grading-mode-admin.spec.ts` | read-only | `aria-checked` matches `GET /api/admin/grading-mode` |
| 3 | Cancel confirmation | `e2e/grading-mode-admin.spec.ts` | read-only | Dialog opens; Cancel closes; no `PUT /admin/grading-mode` request; mode unchanged |
| 4 | Zero-based table state | `e2e/grading-mode-admin.spec.ts` | read-only | If OFF: inputs disabled; banner visible; Save/Reset disabled |
| 5 | Admin permissions | `e2e/grading-mode-admin.spec.ts` | read-only | Teacher/registrar cannot open `/admin/transmutation` |
| 6 | Mobile layout | `e2e/grading-mode-admin.spec.ts` | read-only | 390×844; switch usable; no horizontal overflow |
| 7 | Toggle ON→OFF | `e2e/offline/specs/offline-grading-mode.spec.ts` | write | Confirm; toast; mode persists; table disabled |
| 8 | Toggle OFF→ON | same | write | Confirm; mode persists; table editable |
| 9 | Recompute | same | write | Class-record TG changes from 84 to 81 for the seeded grade; raw scores unchanged |
| 10 | Rollback | same | write | Restores `TRANSMUTED`; TG returns to 84; `afterAll` restores mode |
| 11 | Finalized guard | `e2e/offline/specs/offline-grading-mode-guards.spec.ts` | write | 409; switch disabled; message visible |
| 12 | EOSY guard | same | write | 409 `EOSY_FINALIZED`; message visible |
| 13 | Archived guard | same | write | 409 `ARCHIVED_SCHOOL_YEAR`; message visible |
| 14 | Teacher ledger | `e2e/grading-mode-teacher.spec.ts` | read-only | Ledger TG equals expected from class-record API; no console/API errors |
| 15 | SF9 | `e2e/grading-mode-forms.spec.ts` | read-only | SF9 TG equals ledger; descriptor table shows 90–100/80–89/75–79/65–74/0–64 |
| 16 | SF10 | same | read-only | SF10 TG equals ledger |
| 17 | ECR export | same | read-only/download | Workbook TG equals ledger; identity helper when zero-based |

### Read-only rule

`playwright.config.ts` states the main suite must never write to the database. The cancel-confirmation test is the only mode-related action in the main suite, and it must not send a `PUT`. All toggles and recomputes run in `e2e/offline` with the `*_test` database guard.

### Assertion helper for expected TG

In the teacher spec:

1. Fetch the class-record response with the page's token:
   ```ts
   const token = await page.evaluate(() => sessionStorage.getItem("token_teacher"));
   const res = await page.request.get(`/api/grades/class-record/${id}`, {
     headers: { Authorization: `Bearer ${token}` },
   });
   const body = await res.json();
   ```
2. Read `body.gradingMode` and the grade's `initialGrade`.
3. Compute the expected TG in the test:
   - `ZERO_BASED`: `Math.min(100, Math.max(60, Math.round(initial)))`
   - `TRANSMUTED`: look up the table from `GET /api/grades/transmutation-table`.
4. Assert the ledger's `data-term-grade` attribute equals the expected value.

---

## 15. PM2 log gate

### 15.1 Why a baseline is required

The current PM2 error log already contains unrelated integration noise:

```
[ExternalState] AIMS DOWN (connect ECONNREFUSED 100.92.245.14:5000)
[AimsSync] Failed ...
[AtlasSync] Faculty fetch failed: HTTP 403 ... SCHOOL_SCOPE_REQUIRED
[AtlasYear] runtime/context unavailable ...
[SyncCoordinator] Partial sync — Atlas offline ...
```

A naïve “no errors” check will always fail. The gate must compare against a baseline or explicitly ignore known noise.

### 15.2 Baseline and gate commands

```powershell
# Before the gate
pm2 list | Tee-Object artifacts\grading-mode\<Gate>-pm2-list.txt
pm2 logs server --lines 300 --nostream --timestamp |
  Tee-Object artifacts\grading-mode\<Gate>-pm2-baseline.log

# Run the gate's tests here

# After the gate
pm2 logs server --lines 300 --nostream --timestamp |
  Tee-Object artifacts\grading-mode\<Gate>-pm2.log
Invoke-RestMethod http://localhost:5003/api/health |
  ConvertTo-Json -Depth 5 |
  Tee-Object artifacts\grading-mode\<Gate>-health.json
```

### 15.3 Known-noise ignore list

```
AIMS DOWN
AimsSync
AtlasSync
AtlasYear
SCHOOL_SCOPE_REQUIRED
ECONNREFUSED 100.92.245.14:5000
Partial sync — Atlas offline
```

### 15.4 Fail patterns

```
UnhandledPromiseRejection
Uncaught
PrismaClientKnownRequestError
PrismaClientValidationError
\[GradingMode\].*error
\[Transmutation\].*did not match
status 500
Error: Cannot
```

### 15.5 Gate runner script (recommended)

Create `scripts/verify-grading-mode.ps1`:

```powershell
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("G0", "G1", "G2", "G3", "G4", "G5")]
  [string]$Gate
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$artifactDir = Join-Path $root "artifacts\grading-mode"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $artifactDir "$Gate-pm2-$stamp.log"
pm2 logs server --lines 300 --nostream --timestamp | Out-File -Encoding utf8 $logPath

$ignore = @(
  "AIMS DOWN",
  "AimsSync",
  "AtlasSync",
  "AtlasYear",
  "SCHOOL_SCOPE_REQUIRED",
  "ECONNREFUSED 100.92.245.14:5000",
  "Partial sync — Atlas offline"
)

$fail = @(
  "UnhandledPromiseRejection",
  "Uncaught",
  "PrismaClientKnownRequestError",
  "PrismaClientValidationError",
  "\[GradingMode\].*error",
  "\[Transmutation\].*did not match",
  "status 500",
  "Error: Cannot"
)

$lines = Get-Content $logPath
$bad = $lines | Where-Object {
  $line = $_
  $matchesFail = $fail | Where-Object { $line -match $_ }
  $matchesIgnore = $ignore | Where-Object { $line -match $_ }
  $matchesFail -and -not $matchesIgnore
}

if ($bad) {
  $bad | ForEach-Object { Write-Host "FAIL: $_" -ForegroundColor Red }
  exit 1
}

Write-Host "[$Gate] PM2 log gate PASSED" -ForegroundColor Green
```

Add to `package.json`:

```json
"verify:grading-mode": "powershell -ExecutionPolicy Bypass -File scripts/verify-grading-mode.ps1"
```

> This is a strict scan: it fails on any matching line, including a pre-existing unrelated error. Review the baseline before the gate. If an old unrelated error is present, add a **narrowly scoped** ignore entry with a ticket reference; never add a broad ignore for `Error`.
>
> Do not use `pm2 flush` in a normal gate. It destroys the evidence needed to compare before/after. Use it only in an isolated dev environment with explicit approval.

### 15.6 Offline-rig logs

The offline rig does not use PM2. It starts its own backend on port 5004 and frontend on 5174. For write gates:

```powershell
pnpm run test:e2e:offline 2>&1 |
  Tee-Object artifacts\grading-mode\G3-offline-terminal.log
```

Scan that log for the same fail patterns, excluding stub/known offline messages. The spec's `collectProblems()` still asserts zero console errors and zero API >= 400.

---

## 16. Rollback plan

### 16.1 Mode rollback

Before rolling back code:

1. Switch the active SY back to `TRANSMUTED`.
2. Run `POST /api/admin/grading-mode/recompute`.
3. Verify a sample grade returns to its transmuted value.
4. Then roll back the code.

Do **not** roll back the code while the DB is in `ZERO_BASED`; the old code's teacher preview would transmute an already-zero-based stored TG.

### 16.2 Code rollback

- Revert the feature branch.
- The `gradingMode` column is additive and ignored by old code.
- No data loss.
- If the column must be removed, use the SQL in §5.4 only after the code rollback is stable.

### 16.3 Data rollback

- The mode change is recoverable by switching back and recomputing.
- Raw scores are never touched.
- If a recompute fails mid-way, use `POST /api/admin/grading-mode/recompute` to retry idempotently.
- EOSY snapshots are not rewritten by the mode switch.

### 16.4 Rollback verification

```powershell
pnpm --prefix server run grades:check-alignment
pnpm run test:e2e -- e2e/grading-mode-admin.spec.ts
pm2 logs server --lines 300 --nostream --timestamp |
  Tee-Object artifacts\grading-mode\rollback-pm2.log
```

Expected: zero alignment mismatches; admin spec passes; PM2 gate passes.

---

## 17. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Historical grades rewritten | Medium | High | Per-SY mode + active-SY-only recompute + archived guard |
| Descriptor mismatch persists | High | High | Track B release blocker; single descriptor constants; tests |
| Main Playwright suite writes to live DB | Low | High | Keep read-only; writes only in offline rig |
| Test fixture year `2088-2089` auto-becomes zero-based | Medium | Medium | No label-based auto-default; explicit `TRANSMUTED` in seeds |
| PM2 noise hides a real error | High | Medium | Baseline + ignore list + fail patterns |
| ECR template mismatch | Medium | Medium | Identity helper + workbook assertion |
| Recompute partially fails | Low | Medium | Retry endpoint + idempotent recompute |
| Teacher page shows stale mode | Medium | Low | Invalidate `class-record`; toast; refetch on navigation |
| Concurrent admin switches | Low | Medium | Serialize with a promise queue |
| SF5/SF6 still show DO 8 labels | High | High | Track B migration or explicit legacy block |
| Grade lock interaction | Medium | Medium | Guard finalized grades; document unfinalize flow |
| Audit log failure | Low | Low | Log and continue; do not roll back the mode |
| Promotion/remedial surprises | Medium | High | Recompute stored TG; run regression tests; manual spot check |

---

## 18. File change map

| Path | Change | Phase |
|---|---|---|
| `server/prisma/schema.prisma` | Add `GradingMode` enum and `SchoolYear.gradingMode` | G1 |
| `server/src/lib/gradingMode.ts` | New: mode resolution, pure computation, cache | G1 |
| `server/src/lib/transmutationCache.ts` | No signature change; used by computation | G1 |
| `server/src/lib/schoolYearResolver.ts` | Invalidate grading-mode cache on year change | G1 |
| `server/src/routes/grades-sub/helpers.ts` | `calculateGrades` mode param; `computeTermGrade` | G1 |
| `server/src/routes/grades-sub/classes.ts` | Resolve mode for save paths; add mode to class-record response | G1/G2 |
| `server/src/routes/grades-sub/dashboard.ts` | Resolve mode for recalculation | G1 |
| `server/src/lib/aimsImport.ts` | Resolve mode | G1 |
| `server/src/lib/ecrImport.ts` | Resolve mode | G1 |
| `server/src/lib/gradeRecalc.ts` | Per-SY mode, scoped recompute, summary | G1 |
| `server/src/routes/admin-sub/grading.ts` | Mode GET/PUT/recompute endpoints; audit; invalidation | G2 |
| `server/src/schemas/admin.ts` | `gradingModeSchema` | G2 |
| `server/src/lib/ecrExport.ts` | Identity helper; mode-aware cached values | G4 |
| `server/src/lib/sf5Composer.ts` | DO 015 descriptors (Track B) | G4 |
| `server/src/lib/sf6Composer.ts` | DO 015 descriptors (Track B) | G4 |
| `server/prisma/check-grade-alignment.ts` | Respect per-SY mode | G2 |
| `server/prisma/recompute-stale-grades.ts` | Respect per-SY mode | G2 |
| `server/scripts/realign-seeded-grades.ts` | Respect per-SY mode | G2 |
| `server/scripts/seed-test-base.ts` | Explicit `TRANSMUTED` | G1 |
| `server/scripts/seed-offline-fixtures.ts` | Explicit mode + deterministic grades | G1/G3 |
| `src/lib/api.ts` | Grading mode types and endpoints | G3 |
| `src/components/ui/switch.tsx` | New accessible switch primitive | G3 |
| `src/pages/admin/TransmutationTable.tsx` | Mode card, switch, confirmation, disabled table | G3 |
| `src/lib/gradeMath.ts` | `computeTermGrade`, mode-aware preview, DO 015 bands | G3/G4 |
| `src/pages/teacher/hooks/useClassRecord.ts` | `gradingMode` in response type; mode query | G4 |
| `src/pages/teacher/ClassRecordView.tsx` | Pass mode to preview | G4 |
| `src/pages/teacher/components/ClassRecordTable.tsx` | Pass mode to rows | G4 |
| `src/pages/teacher/components/ledger/LedgerRow.tsx` | Mode-aware TG + test ID | G4 |
| `src/components/forms/sf9/SF9Form.tsx` | DO 015 descriptor table | G4 |
| `src/pages/teacher/StudentGradeProfile.tsx` | DO 015 labels (Track B) | G4 |
| `src/pages/teacher/Dashboard.tsx` | DO 015 labels (Track B) | G4 |
| `src/pages/teacher/components/MobileDashboard.tsx` | DO 015 labels (Track B) | G4 |
| `src/pages/registrar/components/SF5Form.tsx` | DO 015 labels (Track B) | G4 |
| `e2e/grading-mode-admin.spec.ts` | New read-only admin spec | G3 |
| `e2e/grading-mode-teacher.spec.ts` | New read-only teacher spec | G4 |
| `e2e/grading-mode-forms.spec.ts` | New read-only forms/ECR spec | G4 |
| `e2e/offline/specs/offline-grading-mode.spec.ts` | New write spec | G3 |
| `e2e/offline/specs/offline-grading-mode-guards.spec.ts` | New guard spec | G3 |
| `e2e/offline/run-playwright.mjs` | Optional arg passthrough | G3 |
| `scripts/verify-grading-mode.ps1` | New gate runner | G3/G5 |
| `package.json` | `verify:grading-mode` script | G3 |
| `server/src/__tests__/grading-mode.test.ts` | Unit tests for mode math | G1 |
| `server/src/__tests__/grading-mode-api.test.ts` | API, guard, audit, recompute tests | G2 |
| `e2e/grading-mode-admin.spec.ts` | Read-only admin switch/UI/mobile spec | G3 |
| `e2e/grading-mode-teacher.spec.ts` | Read-only teacher ledger spec | G4 |
| `e2e/grading-mode-forms.spec.ts` | Read-only SF9 descriptor smoke | G4 |
| `e2e/offline/specs/offline-grading-mode.spec.ts` | Write toggle/recompute/restore spec | G3/G5 |
| `scripts/verify-grading-mode.ps1` | PM2 log gate runner | G3/G5 |
| `package.json` | `verify:grading-mode` script | G3 |
| `docs/ZERO_BASED_GRADING_PLAN.md` | This document | G0 |

---

## 19. Acceptance criteria

- [x] `SchoolYear.gradingMode` exists with default `TRANSMUTED`.
- [x] The admin page shows a working ON/OFF switch.
- [x] Switching OFF persists `ZERO_BASED` for the active SY.
- [x] Switching ON persists `TRANSMUTED` for the active SY.
- [x] The table is read-only while zero-based is active.
- [x] Zero-based TG = `min(100, max(60, round(IG)))`.
- [x] Transmuted mode output is identical to the pre-change behavior.
- [x] The switch recomputes only the active SY.
- [x] Historical years are untouched.
- [x] Finalized/EOSY/archived states are blocked with clear messages.
- [x] The audit log records the mode change and recompute count.
- [x] The teacher ledger TG matches the server-stored TG in both modes.
- [ ] SF9 and SF10 TG match the ledger — SF9 verified by code/test; SF10 still needs a dedicated assertion.
- [ ] ECR export TG matches the ledger — identity helper implemented; workbook download assertion still needed.
- [ ] Descriptor bands match DO 015 on every surface — teacher/SF9/ECR/dashboards done; SF5/SF6 pending.
- [x] `pnpm run verify` passes.
- [ ] Full Playwright suite passes — 27 passed / 1 pre-existing failure (`E-16`) / 2 skipped.
- [x] New offline rig write spec passes.
- [x] PM2 log gate passes with the baseline/ignore list.
- [x] Rollback restores the baseline grades.
- [x] No new console errors or API >= 400 in the new happy paths.

---

## 20. Open questions

1. Does DO 015 Annex D explicitly state the 60 floor for zero-based TG? If not, remove the clamp.
2. Should term-finalized grades block the mode switch, or only EOSY-finalized? Recommended: both.
3. Should SF5/SF6 descriptors be migrated in this release or a separate one? Recommended: same release.
4. Should the admin be able to stage table edits while zero-based is active? Recommended: no in v1.
5. Should the switch be exposed on the Grading Config page instead of the Transmutation page? Recommended: keep it on the Transmutation page because that is what it controls.
6. Should a grading-mode SSE event be added for live teacher pages? Recommended: follow-up only if stale pages become a real issue.
7. Should `Grade.qualitativeDescriptor` be persisted? Recommended: no; compute on read.

---

## Appendix A — DO 015 reference values

### Adjusted transmutation table (SY 2026–2027)

Selected rows; the full 41-row table is in `src/lib/gradeMath.ts:11-23` and `server/src/routes/admin-sub/grading.ts:361-402`.

| Initial Grade | Transmuted Grade |
|---|---|
| 99.50–100.00 | 100 |
| 90.06–91.23 | 92 |
| 81.80–82.97 | 85 |
| 75.90–77.07 | 80 |
| 70.00–71.17 | 75 |
| 65.34–69.99 | 74 |
| 60.67–65.33 | 73 |
| 0.00–4.67 | 60 |

### Zero-based

| Input | Output |
|---|---|
| IG 81.00 | TG 81 |
| IG 74.49 | TG 74 |
| IG 74.50 | TG 75 |
| IG 59.00 | TG 60 (floor) |
| IG 100.00 | TG 100 |

### Passing

- TG/FG >= 75 = passed.
- TG/FG < 75 = failed.

---

## Appendix B — Example calculations

Assumptions: WW 20%, PT 50%, QA 30%.

| Student | WW | PT | QA | IG | Transmuted | Zero-based |
|---|---:|---:|---:|---:|---:|---:|
| A | 70 | 80 | 90 | 81.00 | 84 | 81 |
| B | 70 | 75 | 78 | 74.90 | 79 | 75 |
| C | 60 | 60 | 60 | 60.00 | 72 | 60 |
| D | 50 | 50 | 50 | 50.00 | 70 | 60 |
| E | 100 | 100 | 100 | 100.00 | 100 | 100 |

Calculations:

- A: `(70×0.20) + (80×0.50) + (90×0.30) = 14 + 40 + 27 = 81.00`
- B: `(70×0.20) + (75×0.50) + (78×0.30) = 14 + 37.5 + 23.4 = 74.90`
- C: `(60×0.20) + (60×0.50) + (60×0.30) = 12 + 30 + 18 = 60.00`
- D: `(50×0.20) + (50×0.50) + (50×0.30) = 10 + 25 + 15 = 50.00`
- E: `100`

---

## Appendix C — Test IDs

| Test ID | Element |
|---|---|
| `grading-mode-card` | Grading mode card |
| `grading-mode-switch` | ON/OFF switch (`role="switch"`) |
| `grading-mode-badge` | Current mode badge |
| `grading-mode-sy-label` | Active school year label |
| `grading-mode-blocked` | Blocked-state message |
| `grading-mode-confirm-dialog` | Confirmation dialog |
| `grading-mode-confirm-submit` | Confirm button |
| `transmutation-table-readonly-banner` | Zero-based banner |
| `transmutation-table-card` | Table card |
| `transmutation-table-row` | Table row |
| `class-record-grading-mode-badge` | Teacher ledger mode badge |
| `ledger-term-grade` | Ledger TG cell; add `data-student-id`, `data-term`, `data-term-grade` |
| `sf9-descriptor-table` | SF9 descriptor table |

---

## Appendix D — Command reference

### Build and test

```powershell
pnpm run typecheck
pnpm run build
pnpm run lint
pnpm run verify
pnpm --prefix server run build
pnpm --prefix server test
```

### Prisma

```powershell
pnpm --prefix server run prisma:generate
pnpm --prefix server run prisma:migrate -- --name add_school_year_grading_mode
pnpm --prefix server run prisma:push
```

### Playwright

```powershell
pnpm run test:e2e
pnpm run test:e2e -- e2e/grading-mode-admin.spec.ts
pnpm run test:e2e:offline
pnpm run test:e2e:offline -- e2e/offline/specs/offline-grading-mode.spec.ts
npx playwright test e2e/grading-mode-admin.spec.ts --trace on
```

### PM2

```powershell
pm2 list
pm2 restart server --update-env
pm2 logs server --lines 300 --nostream --timestamp
pm2 logs server --err --lines 100 --nostream
Invoke-RestMethod http://localhost:5003/api/health
```

### Data integrity

```powershell
pnpm --prefix server run grades:check-alignment
pnpm --prefix server run grades:recompute
```

> Run these against the `*_test` database or a verified backup. `grades:check-alignment` is read-only; `grades:recompute` writes derived grade columns.

---

## Appendix E — Gate evidence template

```markdown
# Gate <Gx> — <name>

- Date:
- Commit:
- Operator:
- Environment: dev / offline rig

## Commands

| # | Command | Exit code | Artifact |
|---|---|---|---|
| 1 | `...` | 0 | `artifacts/grading-mode/...` |
| 2 | `...` | 0 | `artifacts/grading-mode/...` |

## PM2 log gate

- Baseline: `artifacts/grading-mode/<Gx>-pm2-baseline.log`
- After: `artifacts/grading-mode/<Gx>-pm2.log`
- New fail patterns: none
- Known-noise matches: (list)

## Playwright

- Spec:
- Passed:
- Failed:
- Trace / screenshot:

## Result

- [ ] PASS
- [ ] FAIL — reason:

## Reviewer

- Name:
- Date:
```
