# Subject Naming Standardization Plan

**Status:** PLANNING — READY FOR IMPLEMENTATION
**Date:** 2026-09-04
**Scope:** Whole system — SF forms, teacher views, dashboards, audit logs
**Verified against codebase:** Yes (all line refs checked 2026-09-04)

---

## Problem Statement

Subject names in the DB are stored with grade suffixes and specializations baked in:

| Stored Name | Code |
|---|---|
| Filipino 7 | FIL7 |
| Science - Biology 7 | SCI_BIO7 |
| TLE Exploratory - ICT 7 | TLE_ICT_EXP7 |

SF forms (SF1/SF5/SF9/SF10) require canonical DepEd names — NO grade number, NO specialization:

| SF Display Name |
|---|
| Filipino |
| Science (merged from SCI_BIO/SCI_CHEM/SCI_ES) |
| Technology and Livelihood Education (TLE) (merged from TLE_AFA/TLE_FCS/TLE_ICT) |
| Edukasyon sa Pagpapakatao |

**Current bugs:**
1. SF10 frontend regex `subjectName.replace(/\s*\d+$/, '')` — works for "Filipino 7" → "Filipino" but breaks compound names ("Science - Biology 7" → "Science - Biology", wrong)
2. TLE never rendered as full "Technology and Livelihood Education (TLE)" on backend-rendered forms
3. **SF10 backend rotation merge is a NO-OP** — `sf10.ts:299-308` reads `(subject as any).rotationTermGroupId` from `academicHistory[sy].subjects`, but that map (built at lines 238-248) never stores rotation fields. They're always `undefined` → `null`. Branch subjects stay as separate rows in the API payload. The frontend grouping (`SchoolForms.tsx` `SF10_GROUP_MAP`) masks this for the web preview, but any API consumer (EnrollPro fetches SF10) receives unmerged rows
4. No single source of truth — names scattered across `DEPED_AREA_NAMES` (frontend), `SUBJECT_BASE_NAMES` (backend), `rotationOutputLabel` (DB)

**Two name formats, two contexts:**

| Context | Format | Example |
|---|---|---|
| SF forms (SF1/SF5/SF9/SF10) | Canonical DepEd, no grade, no specialization | "Filipino", "Science" |
| Teacher views, dashboards, audit logs, remedial tracker | Full internal name WITH grade + specialization | "Filipino 7", "Science - Biology 7" |

---

## Solution: Add `displayName` Field to Subject Model

New field stores the canonical DepEd name. `name` keeps the full internal name.

```prisma
model Subject {
  ...
  name         String   // Internal: "Filipino 7", "Science - Biology 7"
  displayName  String?  // SF forms: "Filipino", "Science"
  ...
}
```

- SF forms read `displayName` (fallback to computed name if null)
- Internal views unchanged — still use `name`
- Auto-generated at creation + backfilled for existing rows
- Fixes backend rotation merge as part of the same pass

---

## Implementation Steps (execute in order)

### Step 1: Schema Change

**File:** `server/prisma/schema.prisma`

Add to `Subject` model:
```prisma
displayName  String?
```

Run: `cd server && npm run prisma:migrate` (name: `add_subject_display_name`)

### Step 2: Create Shared Display-Name Resolver

**File:** `server/src/lib/subjectDisplay.ts` (NEW)

Single source of truth for canonical DepEd names. Exported functions:

```ts
// Canonical DepEd learning-area names for SF forms
export const DEPED_AREA_NAMES: Record<string, string> = {
  FIL: 'Filipino',
  ENG: 'English',
  MATH: 'Mathematics',
  SCI: 'Science',
  AP: 'Araling Panlipunan',
  ESP: 'Edukasyon sa Pagpapakatao',
  TLE: 'Technology and Livelihood Education (TLE)',
  MAPEH: 'MAPEH',
  MUSIC: 'Music',
  ARTS: 'Arts',
  PE: 'Physical Education',
  HEALTH: 'Health',
  DEVL_READING: 'Developmental Reading',
  SPA_SPEC: 'Special Program in the Arts: Specialization',
  SPS_SPEC: 'Special Program in Sports: Specialization',
  STE_RESEARCH: 'Research',
  STE_ENV_SCI: 'Environmental Science',
  STE_BIOTECH: 'Biotechnology',
  STE_APPLIED_CHEM: 'Applied Chemistry',
  STE_APPLIED_PHYS: 'Applied Physics',
  STE_ROBOTICS: 'Robotics',
};

// Branch codes → parent learning area
export const SF10_GROUP_MAP: Record<string, string> = {
  SCI_BIO: 'SCI', SCI_CHEM: 'SCI', SCI_ES: 'SCI', SCI: 'SCI',
  TLE_AFA: 'TLE', TLE_AFA_EXP: 'TLE',
  TLE_FCS: 'TLE', TLE_FCS_EXP: 'TLE',
  TLE_ICT: 'TLE', TLE_ICT_EXP: 'TLE', TLE: 'TLE',
  MUSIC: 'MAPEH', ARTS: 'MAPEH', PE: 'MAPEH', HEALTH: 'MAPEH', MAPEH: 'MAPEH',
};

// Official SF10 learning-area order (lower = earlier)
export const DEPED_AREA_ORDER: Record<string, number> = {
  FIL: 1, ENG: 2, MATH: 3, SCI: 4, AP: 5, ESP: 6, TLE: 7, MAPEH: 8,
  DEVL_READING: 9, SPA_SPEC: 10, SPS_SPEC: 11,
  STE_RESEARCH: 12, STE_ENV_SCI: 13, STE_BIOTECH: 14,
  STE_APPLIED_CHEM: 15, STE_APPLIED_PHYS: 16, STE_ROBOTICS: 17,
};

// Strip grade digits from a subject code: "SCI_BIO7" → "SCI_BIO"
export function baseSubjectCode(code: string): string {
  return code.toUpperCase().replace(/\d+$/, '').replace(/[^A-Z_]/g, '');
}

// Compute canonical SF display name from any code/name pair
export function computeDisplayName(code: string, name: string): string {
  const base = baseSubjectCode(code);
  if (DEPED_AREA_NAMES[base]) return DEPED_AREA_NAMES[base];
  const group = SF10_GROUP_MAP[base];
  if (group && DEPED_AREA_NAMES[group]) return DEPED_AREA_NAMES[group];
  // Fallback: strip trailing grade from name ("Filipino 7" → "Filipino")
  return name.replace(/\s*\d+$/, '').trim();
}
```

### Step 3: Backfill Script

**File:** `server/prisma/backfill-display-names.ts` (NEW, one-time)

```ts
import { PrismaClient } from '@prisma/client';
import { computeDisplayName } from '../src/lib/subjectDisplay';

const prisma = new PrismaClient();

async function main() {
  const subjects = await prisma.subject.findMany();
  let updated = 0;
  for (const s of subjects) {
    const dn = computeDisplayName(s.code, s.name);
    if (dn !== s.displayName) {
      await prisma.subject.update({ where: { id: s.id }, data: { displayName: dn } });
      updated++;
    }
  }
  console.log(`Backfill done: ${updated}/${subjects.length} subjects updated`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

Run: `cd server && npx ts-node prisma/backfill-display-names.ts`

**IMPORTANT — verify expected output.** Before running, log the computed names for all subjects and eyeball them. Known mappings that MUST hold:
- `FIL7` → "Filipino"
- `SCI_BIO7` / `SCI_CHEM7` / `SCI_ES7` → all "Science"
- `TLE_ICT_EXP7` (and all TLE variants) → "Technology and Livelihood Education (TLE)"
- `MAPEH7` → "MAPEH"
- `ESP7` → "Edukasyon sa Pagpapakatao"
- Any unknown subject → grade-stripped name (acceptable fallback)

### Step 4: Set `displayName` on Subject Creation (Sync Path)

**Files:**
- `server/src/lib/atlasSync.ts` — subject create sites (~lines 238, 495, 611): add `displayName: computeDisplayName(code, properName)` to `create` data
- `server/src/lib/atlasUtils.ts` — no change to `resolveSubjectName()` itself (it stays the internal-name resolver)
- `server/scripts/fix-subject-names.ts` — also fix `displayName` alongside `name`

### Step 5: SF10 Backend — Display Names + Rotation Merge Fix

**File:** `server/src/lib/sf10.ts`

**5a. Store rotation fields in academicHistory (FIXES the no-op merge).**

Where subjects map entries are built (lines 238-248 from classAssignments, and 274-284 from grades), the source `ca.subject` / `grade.classAssignment.subject` (Prisma include) HAS `rotationTermGroupId`, `rotationTermRank`, `rotationOutputLabel`. The subject entry init must carry them:

```ts
academicHistory[sy].subjects[key] = {
  subjectCode: ca.subject.code,
  subjectName: ca.subject.displayName ?? ca.subject.name,
  T1: null, T2: null, T3: null, finalGrade: null,
  rotationTermGroupId: ca.subject.rotationTermGroupId ?? null,
  rotationTermRank: ca.subject.rotationTermRank ?? null,
  rotationOutputLabel: ca.subject.rotationOutputLabel ?? null,
};
```

Same for the grade-sourced init (~line 276) using `grade.classAssignment.subject`.

Check the Prisma query in `sf10.ts` actually includes `rotationTermGroupId`/`rotationTermRank`/`rotationOutputLabel` on the subject include — scalar fields come back by default in Prisma includes, so no query change needed, but VERIFY.

Snapshot-sourced entries (~lines 181-185, reconstructed from `GradeSnapshot`): snapshots don't store rotation fields. Leave them `null` — snapshot rows are non-rotating fallbacks; the frontend grouping still handles them.

**5b. Use displayName in the rotation merge input** (~line 301):

```ts
subjectName: subject.subjectName,  // already displayName from 5a
```

The merge output name (`rotationOutputLabel` → "SCIENCE" → "Science") stays — it's already correct.

**5c. Remedial section** (~line 367):

```ts
learningAreas: computeDisplayName(rc.subjectCode, rc.subjectName),
```

Note: `RemedialClass.subjectName` is historical free text. Compute at render — do NOT rewrite remedial rows.

### Step 6: SF9 Backend

**File:** `server/src/routes/registrar/forms.ts`

- Line ~150: `subjectName: ca.subject.displayName ?? ca.subject.name`
- Line ~179: `subjectName: subject.displayName ?? subject.name`
- Line ~233 (rotation merge output): keep `toTitleCase(rotationOutputLabel)` — already correct. Only fallback (`sorted[0].subjectName`) is now displayName from upstream
- Line ~550 (SF10 build input): `subjectName: ca.subject.displayName ?? ca.subject.name`
- Line ~769 (SF8 subjects): `name: ca.subject.displayName ?? ca.subject.name`

**Verify the Prisma include for subject selects in this file — `displayName` is a scalar so it returns automatically.**

### Step 7: SF5 Backend

**File:** `server/src/lib/sf5Composer.ts`

- Line ~166: `subjectName: ca.subject.displayName ?? ca.subject.name`
- Rotation merge call (~line 176) — `rotationTermGroupId` etc. already populated from Prisma include. Merge works. Output label naming stays.

### Step 8: SF1/Exports Backend

**File:** `server/src/routes/registrar/exports.ts`

- Line ~606: `subject: g.classAssignment.subject.displayName ?? g.classAssignment.subject.name`

### Step 9: Frontend SF10

**File:** `src/pages/registrar/SchoolForms.tsx`

The frontend already has local `DEPED_AREA_NAMES`, `SF10_GROUP_MAP`, `DEPED_AREA_ORDER`, `buildSF10Areas`, `getAreaDisplayValues` (~lines 677-756). Backend now sends displayName + properly merged rows.

Changes:
- Line ~730: `name: DEPED_AREA_NAMES[groupCode] ?? sg.subjectName.replace(/\s*\d+$/, '')` — keep as-is (backend rows are now already correct; the frontend map is a second safety net — harmless duplication)
- **Keep the frontend grouping intact.** Since the backend merge now works, each rotation group arrives as ONE row (subjectCode "SCIENCE") and the frontend `getAreaDisplayValues` single-subCode path handles it. The grouped path stays for MAPEH component data and any snapshot-era unmerged rows.

Optional cleanup (only if trivially safe): import the shared maps from a frontend copy of the constants instead of duplicating. NOT required — skip if it risks churn.

### Step 10: Rotation Merge Output in promotion.ts

**File:** `server/src/lib/promotion.ts` (~lines 98-100)

Current merged name: `rotationOutputLabel` ("SCIENCE") → "Science". Correct already.

**Add `displayName` passthrough on `SubjectFinalRow`** so remedial creation (Step 11) can use it:
- `SubjectTermInput` interface (~line 25): add optional `displayName?: string | null`
- `mergeRotationSubjects` (~line 98): set `displayName` on merged row:
  ```ts
  displayName: representative.rotationOutputLabel
    ? DEPED_AREA_NAMES[representative.rotationOutputLabel.toUpperCase()] ?? null
    : representative.displayName ?? null,
  ```
- `finalizeSubjectRows` (~line 122): passthrough `displayName: row.displayName`

### Step 11: Remedial Creation — Store Canonical Names for NEW Rows

**Files:**
- `server/src/lib/promotion.ts` ~line 522 (EOSY auto-create): `subjectName: row.displayName ?? row.subjectName`
- `server/src/lib/remedial.ts` ~lines 424, 435 (EnrollPro sync write): compute via `computeDisplayName(subj.subjectCode, subj.subjectName)`
- `server/src/routes/registrar/remedial.ts` ~line 362 (manual create): leave `req.body.subjectName` as-is (user-provided; frontend dropdown already lists `rc.subjectName` from remedial rows which will now be canonical for new rows)

**Existing remedial rows: do NOT rewrite history.** SF10 render computes at read time (Step 5c) — old "Mathematics 7" rows still display as "Mathematics".

### Step 12: Internal Views — NO CHANGES

These keep using `name` (full internal, with grade + specialization):

| View | File |
|---|---|
| Teacher ClassRecordList | `src/pages/teacher/ClassRecordsList.tsx:135` |
| Teacher ClassRecordHero | `src/pages/teacher/components/ClassRecordHero.tsx:58` |
| Teacher Dashboard | `src/pages/teacher/Dashboard.tsx:688` |
| Teacher Schedule | `src/pages/teacher/Schedule.tsx:425` |
| Teacher StudentGradeProfile | `src/pages/teacher/StudentGradeProfile.tsx:407` |
| Remedial Tracker (pending/history tables) | `src/pages/registrar/RemedialTracker.tsx:616,710` |
| Remedial History Table | `src/pages/registrar/components/RemedialHistoryTable.tsx:106` |
| EOSY Finalization / tabs | `src/pages/registrar/EOSYFinalization.tsx:283` + EOSY tab components |
| Registrar StudentRecords | `src/pages/registrar/StudentRecords.tsx:762` |
| Admin GradingConfig | `src/pages/admin/GradingConfig.tsx:772` |
| Audit logs (all sites) | `server/src/routes/grades-sub/classes.ts` etc. |
| Grade snapshots (all creation sites) | `server/src/routes/grades-sub/helpers.ts:344` etc. |

**Grade snapshots stay unchanged** — they store `subjectName` (internal). SF10 computes display at read time. No snapshot schema change.

---

## Rotation/Branching Reference

| Learning Area | Branch Subjects | Rotation Group | Rank→Term | SF Display |
|---|---|---|---|---|
| Science | SCI_BIO, SCI_CHEM, SCI_ES | `SCIENCE` | 1→T1, 2→T2, 3→T3 | "Science" |
| TLE | TLE_AFA, TLE_FCS, TLE_ICT (+`_EXP`) | `TLE_EXPLORATORY` | 1→T1, 2→T2, 3→T3 | "Technology and Livelihood Education (TLE)" |
| MAPEH | MUSIC, ARTS, PE, HEALTH | N/A — NOT rotation | averaged (parallel) | "MAPEH" |

- Science/TLE: one branch per term, merged into one row on SF forms (T1/T2/T3 slots from rotationTermRank)
- MAPEH: components taught in parallel, averaged per term — grouped by frontend `SF10_GROUP_MAP`, NOT by rotation fields
- Teacher views: branches stay separate (teacher needs to know which branch); term selector locked by `rotationTermRank` (`ClassRecordView.tsx:155-157`)

## DepEd Official SF10-JHS Learning Area Order

```
1. Filipino          2. English           3. Mathematics    4. Science
5. Araling Panlipunan 6. Edukasyon sa Pagpapakatao
7. Technology and Livelihood Education (TLE)
8. MAPEH (Music, Arts, Physical Education, Health)
General Average
```

Grade level belongs in the form header ("Classified as Grade: ___"), never in subject names.

---

## Affected Files Summary

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | Add `displayName String?` to Subject |
| `server/prisma/backfill-display-names.ts` | NEW — one-time backfill |
| `server/src/lib/subjectDisplay.ts` | NEW — shared canonical name resolver |
| `server/src/lib/atlasSync.ts` | Set `displayName` on subject create (~238, ~495, ~611) |
| `server/scripts/fix-subject-names.ts` | Also fix `displayName` |
| `server/src/lib/sf10.ts` | 5a rotation fields in academicHistory (CRITICAL FIX), 5b, 5c remedial names |
| `server/src/routes/registrar/forms.ts` | ~150, ~179, ~550, ~769 use displayName |
| `server/src/lib/sf5Composer.ts` | ~166 use displayName |
| `server/src/routes/registrar/exports.ts` | ~606 use displayName |
| `server/src/lib/promotion.ts` | displayName on SubjectTermInput/SubjectFinalRow + remedial create ~522 |
| `server/src/lib/remedial.ts` | ~424, ~435 compute canonical for EnrollPro sync rows |
| `src/pages/registrar/SchoolForms.tsx` | No required change (verify only) |

---

## Non-Negotiables / Safety Rules

1. Do NOT modify `resolveSubjectName()` behavior — it stays the internal-name resolver
2. Do NOT rewrite existing RemedialClass or GradeSnapshot rows
3. Do NOT touch teacher-facing views, dashboards, audit logs — internal names stay
4. Do NOT modify the SF10 frontend grouping — it's the second safety net
5. Run migration BEFORE backfill
6. `displayName` is nullable everywhere — always `?? fallback` pattern
7. If a subject code isn't in any map → grade-stripped name fallback (acceptable)

---

## Execution Order

1. Schema change + migrate
2. Create `subjectDisplay.ts`
3. Backfill script → run → verify expected mappings
4. `atlasSync.ts` + `fix-subject-names.ts` set displayName on create
5. `sf10.ts` — rotation fields fix (5a) + display names (5b) + remedial (5c)
6. `forms.ts`, `sf5Composer.ts`, `exports.ts` — display names
7. `promotion.ts` + `remedial.ts` — displayName passthrough + new remedial rows
8. Frontend verify only
9. Build + verify

---

## Verification Checklist

1. `cd server && npm run build` — clean
2. `npm run build` (frontend) — clean
3. Backfill output matches expected mappings (see Step 3)
4. **SF10 API payload** (curl or EnrollPro fetch): rotation groups arrive as ONE merged row — `subjectGrades` contains `subjectCode: "SCIENCE"`, `subjectName: "Science"` — NOT three separate SCI_BIO/SCI_CHEM/SCI_ES rows
5. SF10 web preview: learning areas read "Filipino", "English", "Mathematics", "Science", "Araling Panlipunan", "Edukasyon sa Pagpapakatao", "Technology and Livelihood Education (TLE)", "MAPEH" — in DepEd order, no grade numbers
6. SF9 report card + SF5 report: same canonical names
7. SF10 remedial section: "Mathematics" not "Mathematics 7" (for old rows — computed at read time)
8. Teacher ClassRecordList still shows "Filipino 7", "Science - Biology 7" (no regression)
9. Teacher Dashboard/Schedule: internal names (no regression)
10. Remedial Tracker pending list: internal names (no regression)
11. Audit log entries: internal names (no regression)
12. Grade snapshot rows unchanged: `subjectName` still internal format
