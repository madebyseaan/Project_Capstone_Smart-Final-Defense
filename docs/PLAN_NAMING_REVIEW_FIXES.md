# Plan — Workhorse Review Fixes: Subject Naming Follow-ups

**Status:** READY FOR IMPLEMENTATION
**Date:** 2026-09-04
**Context:** `PLAN_SUBJECT_NAMING.md` was implemented. Review verified most work complete but found 3 bugs. This plan fixes them.

---

## BUG 1 (CRITICAL) — Remedial backfill reads grades from the wrong school year

**Symptom:** The 2 orphan students (SY 2026-2027 CONDITIONALLY_PROMOTED with zero RemedialClass rows) are now completely invisible in the Remedial Tracker pending view. The new `remedialClasses: { some: { status: "PENDING" } }` filter (added to `GET /registrar/remedial/pending`) excludes enrollments with zero rows — correct for completed-only students, but it also hides orphans that NEED rows created.

**Root cause:** `backfillMissingRemedialRows()` in `server/src/lib/remedial.ts` (~line 497) reads finalized grades from `previousSchoolYear(enrollment.schoolYear)` (2025-2026). But these students have ZERO grades in 2025-2026 — their failing grades are in their OWN enrollment year (2026-2027, 36 and 42 finalized grades respectively).

This contradicts how EOSY finalization creates remedial rows: `promotion.ts:526` stamps `schoolYear: opts.schoolYear` (the enrollment's own year) and grades come from that same year's class assignments.

**Fix — `server/src/lib/remedial.ts`, function `backfillMissingRemedialRows()` (~lines 480-554):**

1. Change the grade query to use the enrollment's own school year:

```ts
const prevGrades = await prisma.grade.findMany({
  where: {
    studentId: enrollment.studentId,
    status: "FINALIZED",
    classAssignment: { schoolYear: enrollment.schoolYear },  // was: prevSY
  },
  include: { classAssignment: { include: { subject: true } } },
});
```

2. Remove the `prevSY` computation and the `previousSchoolYear` import/usage if no longer referenced.
3. Remove the `prevEnrollment` lookup (~lines 530-533) — use `enrollment.section.gradeLevel` directly (already included in the orphan query at ~line 485):

```ts
const gradeLevel = enrollment.section.gradeLevel;
```

4. Keep everything else identical: `canonicalSubjectKey` grouping, `finalizeSubjectRows`, failing filter, `createMany` with `schoolYear: enrollment.schoolYear`, `status: "PENDING"`.

**Script wrapper (`server/prisma/backfill-missing-remedial.ts`):** the existing script creates its own PrismaClient and imports via `await import("../src/lib/remedial")`. It previously hung/timed out when run via `npx ts-node prisma/backfill-missing-remedial.ts` (dynamic import + adapter combo). Safe invocation that worked in review:

```bash
cd server && npx ts-node --files -e "require('dotenv/config'); const {prisma} = require('./src/lib/prisma'); const {backfillMissingRemedialRows} = require('./src/lib/remedial'); backfillMissingRemedialRows().then(r => { console.log('fixed=' + r.enrollmentsFixed + ' rows=' + r.rowsCreated + ' scanned=' + r.enrollmentsScanned); return prisma.\$disconnect(); }).catch(e => { console.error(e); process.exit(1); });"
```

(Or fix the script itself to use `import { prisma } from '../src/lib/prisma'` statically + `ts-node --files` — recommended, then run `npx ts-node --files prisma/backfill-missing-remedial.ts`.)

**Expected result:** `fixed=2, rowsCreated≈5-7` (JIMENEZ/RAMOS failing subjects from 2026-2027), and the two students reappear in the SY 2026-2027 pending view with their failed subjects listed.

---

## BUG 2 (MINOR) — Science sorts last on SF10 web preview

**Symptom:** SF10 web preview shows "Science" at the bottom of the learning areas table instead of position 4 (after Mathematics).

**Root cause:** The backend rotation merge now emits merged rows with `subjectCode: "SCIENCE"` (the `rotationOutputLabel`, e.g. from `mergeRotationSubjects` → `subjectCode: representative.rotationOutputLabel`). The frontend grouping map `SF10_GROUP_MAP` in `src/pages/registrar/SchoolForms.tsx` (~line 704) has no `SCIENCE` key, so `sf10GroupCode('SCIENCE')` returns `'SCIENCE'`, which misses `DEPED_AREA_ORDER` (only `SCI: 4` exists) → `order: 99` → sorts last.

**Fix — `src/pages/registrar/SchoolForms.tsx`, `SF10_GROUP_MAP` (~line 704):**

```ts
const SF10_GROUP_MAP: Record<string, string> = {
  SCI_BIO: 'SCI', SCI_CHEM: 'SCI', SCI_ES: 'SCI', SCI: 'SCI',
  SCIENCE: 'SCI',                              // NEW — backend rotation merge output label
  TLE: 'TLE',
  MUSIC: 'MAPEH', ARTS: 'MAPEH', PE: 'MAPEH', HEALTH: 'MAPEH', MAPEH: 'MAPEH',
};
```

Note: the TLE entries (`TLE_AFA` etc.) can stay — the backend emits `"TLE"` for that group, which maps via the existing `TLE: 'TLE'` entry. Verify by checking what `sf10Code('TLE')` produces after the backend merge: the merged code is the raw `rotationOutputLabel` (e.g. `"TLE"`), and `sf10Code` strips non-letters — `"TLE"` stays `"TLE"`, which is in the map and in `DEPED_AREA_ORDER` (position 7). Only Science is broken.

**Expected result:** SF10 preview learning areas order: Filipino, English, Mathematics, Science, Araling Panlipunan, EsP, TLE, MAPEH.

---

## BUG 3 (DEPLOYMENT RISK) — Missing migration file for `displayName`

**Symptom:** `Subject.displayName` column exists in the local DB (applied via `db push` during implementation), but there is NO migration file in `server/prisma/migrations/`. `prisma migrate status` reports "up to date" only because the `_prisma_migrations` table happens to be consistent — any environment deployed via `prisma migrate deploy` (prod, teammates, CI) will NOT get the column, and every `displayName`-reading query will fail at runtime.

Verified: only these migrations exist — `20260818…make_subject_weights_nullable`, `20260829120000_t2_t3…`, `20260829130000_school_year_term_labels`, `20260902000000_school_settings_snapshot`, `20260511091431_init_consolidated`. None adds `displayName`.

**Fix:**

1. Generate the migration from current schema (do NOT run `migrate dev` if it prompts to reset — use `--create-only`):

```bash
cd server && npx prisma migrate dev --name add_subject_display_name --create-only
```

2. Inspect the generated SQL — it must contain ONLY:

```sql
ALTER TABLE "Subject" ADD COLUMN "displayName" TEXT;
```

If Prisma generates anything else (drift corrections, other tables), delete the folder and instead create the migration manually:
- New folder `server/prisma/migrations/20260904000000_add_subject_display_name/`
- `migration.sql` with the single ALTER line above

3. Apply it:

```bash
npx prisma migrate deploy
```

(On the local DB where the column already exists, `migrate deploy` may fail with "column already exists". If so: check `_prisma_migrations` — if the new migration is recorded as failed, mark it applied manually:

```bash
npx prisma migrate resolve --applied 20260904000000_add_subject_display_name
```

4. Re-run `npx prisma migrate status` → must show the new migration as applied, and NO drift warnings.

---

## Execution Order

1. BUG 1 — remedial.ts backfill fix + run backfill → verify 2 students fixed
2. BUG 2 — SF10_GROUP_MAP one-liner
3. BUG 3 — migration file + apply
4. `cd server && npm run build`
5. `cd .. && npm run build`
6. Re-run `npx vitest run` in server — expect 88 passed / 38 skipped (no regressions)

## Verification Checklist

1. Backfill output: `fixed=2`, rows created > 0
2. `GET /registrar/remedial/pending?schoolYear=2026-2027` → JIMENEZ and RAMOS appear with failed subjects (Mathematics 7, English 7, Filipino 7, etc. — canonical names, no grade suffixes)
3. Orphan count query returns 0: enrollments with `CONDITIONALLY_PROMOTED` + zero remedial rows
4. SY 2028-2029 pending view unchanged (6 students, no regression)
5. SF10 preview for any student: Science appears at position 4, TLE at 7, MAPEH at 8 (DepEd order)
6. SF10 API payload: rotation groups arrive as ONE merged row (`subjectCode: "SCIENCE"`, `subjectName: "Science"`)
7. `npx prisma migrate status` — new migration applied, no drift
8. Remedial history view: rows still display with old internal names if they were created before this fix (expected — SF10 render computes canonical names at read time via `computeDisplayName`)

## Files Touched

| File | Change |
|---|---|
| `server/src/lib/remedial.ts` | Backfill uses own-year grades + enrollment's section gradeLevel |
| `server/prisma/backfill-missing-remedial.ts` | (optional) static import fix for reliable execution |
| `src/pages/registrar/SchoolForms.tsx` | Add `SCIENCE: 'SCI'` to SF10_GROUP_MAP |
| `server/prisma/migrations/20260904000000_add_subject_display_name/migration.sql` | NEW — single ALTER TABLE |
