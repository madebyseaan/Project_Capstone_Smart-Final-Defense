# Plan: School Settings Snapshot per School Year

> Status: IMPLEMENTED (see "Implementation Review" at bottom). All file/line references verified against the codebase as of this writing.

## Problem

All SF forms (SF1, SF5, SF9, SF10) fetch school identity data from the **live** `SystemSettings` table on every request. When EnrollPro updates school settings (e.g., school head changes from "PATRICK SAGUM" to a new principal next year), the branding sync overwrites the single global record — and **all historical SF forms show the new data** instead of what was accurate at the time.

### Current data flow (broken for historical records)

```
EnrollPro /settings/public
  → branding sync (enrollproBrandingSync.ts) → SystemSettings (single global row)
    → SF10 backend (forms.ts:882) fetches live → all years get current schoolHeadName
    → SF5 composer (sf5Composer.ts:109) fetches live → all years get current schoolName
    → SF9 frontend uses useTheme() → always shows current settings
    → SF1 (forms.ts:424) + SF1 Excel export (exports.ts:412) fetch live
```

### What works correctly today

- `adviserName` — already per-year (resolved from enrollment's section adviser)
- `Enrollment.profileSnapshot` — student demographics frozen at enrollment time
- `GradeSnapshot` — grade data frozen at save/finalization time

### What's broken (all read from live `SystemSettings`)

- `schoolName`, `schoolId`, `division`, `region`, `schoolHeadName`, `address` — global, not per-year

---

## Proposed Solution

Add a `schoolSettingsSnapshot Json?` field to the existing `SchoolYear` model. Capture school identity at year creation; keep the **active** year's snapshot in sync with live settings; freeze the snapshot when a year is archived. All SF forms read from the year's snapshot instead of live settings.

This follows the same immutable-snapshot pattern already proven by `Enrollment.profileSnapshot` and `GradeSnapshot`.

### Snapshot schema (zod — per repo rules, no `any`)

**File:** `server/src/lib/schoolSettingsSnapshot.ts` (NEW shared module)

```typescript
import { z } from "zod";

export const SchoolSettingsSnapshotSchema = z.object({
  schoolName: z.string().default(""),
  schoolId: z.string().default(""),
  division: z.string().default(""),
  region: z.string().default(""),
  schoolHeadName: z.string().default(""),
  address: z.string().default(""),
});

export type SchoolSettingsSnapshot = z.infer<typeof SchoolSettingsSnapshotSchema>;

// Response shape consumed by SF forms (district is NOT in SystemSettings —
// hardcoded "" everywhere today; keep for form compatibility)
export interface SchoolIdentity extends SchoolSettingsSnapshot {
  district: string;
}
```

### Write-rule invariants (the core of this design)

| # | Invariant | Enforcement |
|---|---|---|
| W1 | A year's snapshot is set **once** at creation (from live settings) | Only the `create` branch sets it |
| W2 | Only the **active** year's snapshot may be updated afterwards | `syncActiveYearSnapshot()` reads `SystemSettings.schoolYearId` |
| W3 | **Never** overwrite an `ARCHIVED` year's snapshot | Guard in `syncActiveYearSnapshot()`: skip if `status === 'ARCHIVED'` |
| W4 | Never replace a non-null snapshot with an all-empty one (settings row missing → keep old) | Guard: skip if every field is `""` and existing snapshot is non-null |
| W5 | All writes idempotent — re-running sync/backfill is safe | Upserts / null-only backfill |
| W6 | Reads never trust JSON shape — zod-parse, fall back to live on failure | `parseSnapshot()` returns `null` on invalid |

### Behavior matrix

| Scenario | Behavior |
|---|---|
| New school year created (any path) | Snapshot captured from current `SystemSettings` at create time (W1) |
| Active year, branding sync runs | Snapshot updated to match post-upsert live settings (W2) |
| Active year, admin edits System Settings | Snapshot updated (W2) — otherwise admin edits drift from snapshots |
| Year archived (rollover / manual admin archive) | Snapshot frozen forever (W3) |
| Missing/invalid snapshot (backward compat) | Falls back to live `SystemSettings` (W6) |
| Year label not in `SchoolYear` table (migrated SF10 history) | Falls back to live `SystemSettings` |

---

## Implementation Phases

### Phase 0: Shared helper module (do this FIRST)

**File:** `server/src/lib/schoolSettingsSnapshot.ts` (NEW)

> **Why a lib module, not inline in `forms.ts`:** `forms.ts` is already 1155 lines (over the 1000-line file cap). The helper is needed by `forms.ts`, `exports.ts`, `sf5Composer.ts`, `enrollproBrandingSync.ts`, and `admin-sub/system.ts`. One source of truth.

```typescript
// 1. captureSchoolSettingsSnapshot(settings): SchoolSettingsSnapshot
//    Pure mapper from SystemSettings row (or partial EP payload) → snapshot.

// 2. syncActiveYearSnapshot(): Promise<void>
//    - Read SystemSettings (id 'main') → resolve active year via schoolYearId
//    - Skip if year missing, ARCHIVED (W3), or new snapshot all-empty vs non-null old (W4)
//    - prisma.schoolYear.update({ where: { id }, data: { schoolSettingsSnapshot } })

// 3. getSchoolIdentityForYear(label: string): Promise<SchoolIdentity>
//    - findUnique SchoolYear by label → zod-parse snapshot (W6) → live fallback
//    - Always returns district: ""

// 4. getSchoolIdentityByYears(labels: string[]): Promise<Map<string, SchoolIdentity>>
//    - Batch version for SF10 (one findMany, no N+1). Live fallback per missing year.
```

Live-fallback query (shared, `select` only identity fields):
```typescript
const LIVE_SELECT = {
  schoolName: true, schoolId: true, division: true,
  region: true, schoolHeadName: true, address: true,
} as const;
```

---

### Phase 1: Schema Change

**File:** `server/prisma/schema.prisma` — `SchoolYear` model (line 352)

> NOTE — actual model differs from earlier drafts: `id String @default(cuid())`, align key is `externalId Int?` (NOT `enrollproSchoolYearId`), and it has `termLabelT1-T3` / `archivedAt`.

```prisma
model SchoolYear {
  id          String    @id @default(cuid())
  label       String    @unique // "2026-2027"
  externalId  Int?      @unique // EnrollPro numeric ID — primary align key
  status      String    @default("ACTIVE") // DRAFT, ACTIVE, ARCHIVED, COMPLETED
  // ... termLabelT1-T3, startDate, endDate, archivedAt, timestamps, relations ...
  schoolSettingsSnapshot Json?   // ← NEW: frozen school identity for this year
}
```

**Migration:** `npm run prisma:migrate` (preferred: `--name add-school-year-settings-snapshot`) or `npm run prisma:push`. Additive nullable column — zero downtime, no data backfill required by the migration itself.

---

### Phase 2: Snapshot Capture Points

#### 2a. EnrollPro branding sync — ⚠️ fix the ordering bug

**File:** `server/src/lib/enrollproBrandingSync.ts`

**Problem with the naive approach:** `ensureSchoolYearFromEnrollPro()` is called at line ~204, but the `systemSettings.upsert` that writes the NEW `schoolName`/`schoolHeadName` from EnrollPro runs at line ~210. Snapshotting "current SystemSettings" inside `ensure()` would freeze the **previous** branding into the new year.

**Fix — reorder + sync:**
1. Move the `ensureSchoolYearFromEnrollPro(activeSY.id, activeSY.yearLabel)` block (lines ~190-208) to **after** the `systemSettings.upsert` (line ~210). The block is independent of `updateData`; `ensure()` performs its own `systemSettings` FK upsert internally, so ordering is safe.
2. After the upsert + ensure, add:
```typescript
await syncActiveYearSnapshot(); // keeps active year in step with new branding (W2)
```

#### 2b. schoolYearResolver — year creation

**File:** `server/src/lib/schoolYearResolver.ts` — `ensureSchoolYearFromEnrollPro()` (line 111, create branch at line 136)

```typescript
year = await prisma.schoolYear.create({
  data: {
    label: yearLabel,
    externalId: enrollProId,
    status,
    schoolSettingsSnapshot: await readLiveSnapshot(), // from Phase 0 module
  },
});
```

With 2a's reordering, this reads post-upsert settings — correct. The `year` found/updated branches never touch the snapshot (W1).

#### 2c. Admin manual year creation (MISSED capture point)

**File:** `server/src/routes/admin-sub/classAssignments.ts` (line ~363)

`prisma.schoolYear.create(...)` here (admin assigning classes to a year that doesn't exist yet) must also include `schoolSettingsSnapshot: await readLiveSnapshot()`.

#### 2d. Admin System Settings edits

**File:** `server/src/routes/admin-sub/system.ts` (settings PUT handlers, lines ~246-352)

After any update that touches `schoolName` / `schoolId` / `division` / `region` / `schoolHeadName` / `address`, call `await syncActiveYearSnapshot()`. Otherwise admin edits drift out of the active year's snapshot and historical forms generated mid-year would show stale identity.

> **Audit note:** grep for `systemSettings.update|systemSettings.upsert` before finishing — every writer of identity fields must trigger `syncActiveYearSnapshot()`. Known writers today: `enrollproBrandingSync.ts:210`, `admin-sub/system.ts` (multiple), `enrollproSync.ts:1009` (verify which fields it writes), `rollover.ts:119` (only `gradeLock` — safe to skip), `wipe.ts:114` (destructive reset — acceptable to skip; wipe nukes years anyway).

#### 2e. Backfill existing records (one-time script)

**File:** `server/scripts/backfillSchoolYearSnapshots.ts`

```typescript
import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const apply = process.argv.includes("--apply"); // dry-run by default
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const settings = await prisma.systemSettings.findUnique({
    where: { id: "main" },
    select: { schoolName: true, schoolId: true, division: true,
              region: true, schoolHeadName: true, address: true },
  });
  if (!settings) throw new Error("SystemSettings row 'main' missing — nothing to backfill from");

  const snapshot = { /* map settings → snapshot, "" for nulls */ };

  // Json null filtering must use Prisma.DbNull (NOT bare null — ambiguous with JSON null)
  const targets = await prisma.schoolYear.findMany({
    where: { schoolSettingsSnapshot: { equals: Prisma.DbNull } },
    select: { id: true, label: true, status: true },
  });

  console.log(`Years without snapshot: ${targets.length} -> ${targets.map(t => `${t.label} (${t.status})`).join(", ")}`);
  if (!apply) { console.log("Dry run — pass --apply to write."); await prisma.$disconnect(); return; }

  const result = await prisma.schoolYear.updateMany({
    where: { schoolSettingsSnapshot: { equals: Prisma.DbNull } },
    data: { schoolSettingsSnapshot: snapshot },
  });
  console.log(`Backfilled ${result.count} school years`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

> **Documented caveat (accepted risk):** backfill stamps CURRENT live settings onto all past years. Historical per-year values no longer exist anywhere, so current values are the best available guess. This is still strictly better than the status quo (past years would otherwise show *future* drift too). Per-year correction is a future enhancement (admin UI).

---

### Phase 3: Backend Read-Path Changes

#### 3a. SF10 route

**File:** `server/src/routes/registrar/forms.ts` (live fetch at line 882; per-year map used at lines ~938-947; top-level `schoolSettings` response at lines ~984-989)

1. Delete the live `systemSettings.findUnique` (line 882).
2. Build the per-year map via Phase 0 batch helper:
```typescript
const yearLabels = [...new Set(filteredCanonicalEnrollments.map((e: any) => e.schoolYear))];
const identityByYear = await getSchoolIdentityByYears(yearLabels); // Map<label, SchoolIdentity>
```
3. In `schoolRecords.map()` (~line 938): `const yearSettings = identityByYear.get(year.schoolYear)` → use its fields for `school`, `schoolId`, `district`, `division`, `region` (helper already returns `district: ""`, so drop the `division → district` aliasing bug source).
4. Top-level `schoolSettings` (certification block, ~line 984): use the snapshot of the student's **most recent** year in the record (sort labels, take last; fallback `getSchoolIdentityForYear(activeLabel)` → live). Rationale: certification reflects the school identity at the time the record was last certified, not today.

#### 3b. SF1 route

**File:** `server/src/routes/registrar/forms.ts` (line ~424)

Replace live fetch with `const settings = await getSchoolIdentityForYear(schoolYear);` and return `schoolSettings: settings` (helper already includes `district: ""`, matching current line 439 behavior).

#### 3c. SF9 route — add schoolSettings to response

**File:** `server/src/routes/registrar/forms.ts` (route starts line 23)

SF9 response currently has NO `schoolSettings`. Add `schoolSettings: await getSchoolIdentityForYear(currentSchoolYear)` to `res.json(...)`.

#### 3d. SF5 composer

**File:** `server/src/lib/sf5Composer.ts` (line ~109)

Replace live fetch with `getSchoolIdentityForYear(schoolYearLabel)` — same fallback semantics, typed result.

#### 3e. Excel exports

**File:** `server/src/routes/registrar/exports.ts`

- SF1 export (line ~412): replace live fetch with `getSchoolIdentityForYear(schoolYear)`.
- SF5 export (line ~55): already consumes `data.schoolSettings` from the composer — fixed by 3d.

---

### Phase 4: Frontend Changes

#### 4a. SF9 (Report Card) — stop using `useTheme()` for identity

**File:** `src/pages/registrar/SchoolForms.tsx`

SF9 header currently reads `schoolName`/`schoolRegion`/`schoolDivision` from `useTheme()`. Replace with `data.schoolSettings?.region` etc. from the API (added in 3c).

**Scope note:** `useTheme()` remains for logo/colors (branding, intentionally live). Only identity text fields (name/division/region/school head) switch to the year snapshot.

#### 4b. SF10 — no frontend changes

Per-record `school`, `schoolId`, `division`, `region` now come from year snapshots via backend (3a).

#### 4c. SF5 — no frontend changes

`data.schoolSettings` now comes from the year snapshot via the composer (3d).

---

## Affected SF Forms

| Form | School Data Fields | Broken? | Fix |
|---|---|---|---|
| **SF1** (School Register) | schoolName, schoolId, division, region | Yes | 3b, 3e |
| **SF5** (Promotion Report) | schoolName, schoolId, division, region, schoolHeadName | Yes | 3d |
| **SF9** (Report Card) | schoolName, division, region, schoolHeadName | Yes | 3c, 4a |
| **SF10** (Permanent Record) | schoolName, schoolId, division, region, schoolHeadName (per-year + certification) | Yes | 3a |
| **SF6** (Summary Promotion) | None embedded | No | — |

---

## Edge Cases (explicitly handled)

| Edge case | Handling |
|---|---|
| SF10 history contains a year label with no `SchoolYear` row | Batch helper falls back to live identity for that label |
| Snapshot JSON malformed / manually edited | zod parse fails → live fallback (W6) |
| `SystemSettings` row missing entirely | Helper returns all-`""` identity — same as current behavior when settings row is absent |
| Branding sync runs while year transition/rollover in progress | `syncActiveYearSnapshot()` reads `schoolYearId` at call time; rollover advisory lock serializes the archive itself; worst case snapshot syncs one cycle late |
| Rollover reverts FK after failed rollover (schoolYearResolver self-heal) | Snapshot untouched — revert only affects `SystemSettings.schoolYearId` |
| Concurrent branding sync + admin settings edit | Last-writer-wins on the active year snapshot; both converge on live settings — benign |
| `schoolHeadName` is null in settings | Snapshot stores `""`; forms already render `|| ""` |

---

## Testing Plan

### Unit tests (new file: `server/src/__tests__/schoolSettingsSnapshot.test.ts`, follow existing vitest patterns)

- [ ] `getSchoolIdentityForYear` — snapshot present → returns snapshot values
- [ ] `getSchoolIdentityForYear` — snapshot null → falls back to live settings
- [ ] `getSchoolIdentityForYear` — snapshot malformed JSON → falls back to live (W6)
- [ ] `syncActiveYearSnapshot` — active year updated to match live (W2)
- [ ] `syncActiveYearSnapshot` — ARCHIVED year never updated (W3)
- [ ] `syncActiveYearSnapshot` — all-empty new snapshot vs non-null old → skipped (W4)
- [ ] Batch helper — missing labels get live fallback; present labels get snapshots

### Manual / integration checklist

- [ ] `npm run prisma:migrate` (or `prisma:push`) — schema migrates cleanly
- [ ] Backfill dry-run prints expected years; `--apply` fills them; re-run is a no-op (W5)
- [ ] Trigger EnrollPro branding sync with a NEW school year — new year's snapshot matches post-sync settings (ordering fix verified: not the previous branding)
- [ ] SF10 for student with multi-year history — each year shows correct school name, ID, division, region, school head
- [ ] SF10 certification block — shows most recent attended year's identity
- [ ] SF1 / SF5 / SF9 for current year — current settings; for past years — snapshotted settings
- [ ] Change `schoolHeadName` in EnrollPro → branding sync → active year snapshot updates, past years don't
- [ ] Edit schoolName via Admin > System Settings → active year snapshot updates (2d)
- [ ] Archive a year (rollover or admin) → its snapshot is frozen thereafter (W3)
- [ ] `npm run build` passes in root AND `server/`
- [ ] No regressions in existing form generation (run existing `server/src/__tests__/` suite)

---

## Rollback Plan

If the snapshot approach causes issues:

1. Revert backend routes/composer to fetch from live `SystemSettings` (read-path revert — forms immediately behave as today because of the null-fallback design)
2. Optionally drop the column: remove `schoolSettingsSnapshot` from schema + `prisma db push` (leaving it in place is harmless — nothing reads it once read-paths are reverted)
3. Delete `schoolSettingsSnapshot.ts` and its call sites

The fallback logic (`if snapshot is null/invalid → live settings`) makes this backward compatible end-to-end.

---

## Out of Scope / Future Enhancements

1. **Admin UI for year snapshots** — view/edit historical school settings per year (also the remediation path for the backfill caveat in 2e)
2. **Audit trail** — log snapshot writes via `lib/audit.ts` (which year, what changed, who triggered)
3. **GradeSnapshot school context** — embed `schoolSettingsSnapshot` in `GradeSnapshot` for finer granularity
4. **EnrollPro webhook** — push notification on school head change → immediate active-year snapshot refresh

---

## Implementation Review (post-review of workhorse's work)

> Reviewed after implementation. `npm run build` passes (root + `server/`), full suite 88 tests pass, all 3 review bugs fixed. Feature is COMPLETE — only cosmetic minors remain.

### ✅ Verified correct

| Item | Location |
|---|---|
| Phase 0 lib module — zod schema, W2-W6 enforced | `server/src/lib/schoolSettingsSnapshot.ts` |
| Branding sync ordering fix (upsert BEFORE year-create snapshot, then `syncActiveYearSnapshot()`) | `enrollproBrandingSync.ts:197-219` |
| Capture at resolver year-create | `schoolYearResolver.ts:137` |
| Capture at admin manual year-create | `admin-sub/classAssignments.ts:370` |
| `syncActiveYearSnapshot()` after admin settings edits | `admin-sub/system.ts:215` |
| Other `systemSettings.update` writers correctly skipped (logo/colors/gradeLock/transitionLock/enrollproSync — non-identity fields) | — |
| SF10 per-year batch map + cert block uses most recent attended year | `registrar/forms.ts:888, 976-982` |
| SF1 / SF9 / SF5 composer / SF1 Excel export read from snapshots | `registrar/forms.ts:433`, `forms.ts:296+`, `sf5Composer.ts:109`, `exports.ts:414` |
| Backfill script — `Prisma.DbNull`, dry-run default | `server/scripts/backfillSchoolYearSnapshots.ts` |
| Bonus: `SystemSettings.schoolHeadName` column added + SF5 export cert line | `schema.prisma`, `exports.ts:329` |

### 🐛 BUG 1 (must fix) — SF9 single-print view still uses live theme — ✅ FIXED

`SchoolForms.tsx:1880-1883` now reads `sf9Data.schoolSettings?.region/division/schoolName`. Verified.

### 🐛 BUG 2 (must fix) — missing Prisma migration — ✅ FIXED

Migration SQL now contains both statements (`SchoolYear.schoolSettingsSnapshot` + `SystemSettings.schoolHeadName`), both columns verified present in DB, and the migration is recorded as applied in `_prisma_migrations`. Fresh/production `migrate deploy` will produce the correct schema.

### 🐛 BUG 3 (must fix) — plan's unit tests never written — ✅ FIXED

`server/src/__tests__/schoolSettingsSnapshot.test.ts` created — 9 tests covering W2/W3/W4/W6, malformed-JSON fallback, and batch helper. All pass; full suite 88 passed / 0 failed.

### 🧹 Minor (optional)

- `SchoolForms.tsx:163` still destructures `schoolRegion` / `schoolDivision` from `useTheme()` — both now unused (only remaining occurrence is the destructure itself). Remove them from the destructure (keep `colors: themeColors`, `schoolName` — still used as SF10 fallback at line ~1028 — and `logoUrl`).
- 3× `as any` casts on Prisma Json writes (`schoolSettingsSnapshot.ts:139`, `schoolYearResolver.ts:137`, `backfillSchoolYearSnapshots.ts:67`) — works, but typing as `Prisma.InputJsonValue` removes the casts.

### Fix order

~~1. BUG 2 (migration SQL + `migrate resolve`) — only remaining blocker~~
~~2. 🧹 minors if touching those files anyway~~
~~3. Re-run: `cd server && npm run build && npm test`, then root `npm run build`~~

**All resolved. Remaining optional cleanups only:** remove dead `schoolRegion`/`schoolDivision` destructure at `SchoolForms.tsx:163`; optionally type the 3 `as any` Json casts as `Prisma.InputJsonValue`.
