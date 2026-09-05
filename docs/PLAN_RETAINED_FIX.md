# Plan — Fix RETAINED Students in Remedial Tracker

**Status:** READY FOR IMPLEMENTATION
**Date:** 2026-09-04

---

## Problem

JIMENEZ (CHRISTIAN PAUL) and RAMOS (MARK ANGELO) in SY 2026-2027 fail ALL subjects (36/42 failing, 0 passing). They should be RETAINED, but the EnrollPro sync tagged them as CONDITIONALLY_PROMOTED and created 26 remedial rows. They now appear in the Remedial Tracker pending view — they shouldn't be there.

## Root Cause

`syncBackSubjectsFromEnrollPro` (remedial.ts:333-338) blindly tags enrollments as CONDITIONALLY_PROMOTED when EnrollPro lists them, without checking local failing count. EnrollPro sent wrong status for these students.

## Fix (3 parts)

### Part A — Immediate Data Fix

**Script:** `server/prisma/fix-retained-students.ts` (NEW, one-time)

```ts
import "dotenv/config";
import { prisma } from "./src/lib/prisma";

async function main() {
  // Find enrollments that have 3+ failing subjects but are tagged CONDITIONALLY_PROMOTED
  const conditionals = await prisma.enrollment.findMany({
    where: { promotionStatus: "CONDITIONALLY_PROMOTED" },
    include: {
      section: true,
      remedialClasses: true,
      student: true,
    },
  });

  let fixed = 0;
  for (const enrollment of conditionals) {
    // Compute failing count from current-year finalized grades
    const grades = await prisma.grade.findMany({
      where: {
        studentId: enrollment.studentId,
        status: "FINALIZED",
        classAssignment: { schoolYear: enrollment.schoolYear },
      },
      include: { classAssignment: { select: { subject: true } } },
    });
    const failing = grades.filter((g) =>
      !g.classAssignment.subject.isNonPromotional &&
      !g.classAssignment.subject.code.toUpperCase().startsWith("HG") &&
      g.quarterlyGrade !== null && g.quarterlyGrade < 75,
    );
    const uniqueSubjects = new Set(failing.map((g) => g.classAssignment.subject.code));
    
    if (uniqueSubjects.size >= 3) {
      // Should be RETAINED — delete remedial rows and fix status
      await prisma.remedialClass.deleteMany({ where: { enrollmentId: enrollment.id } });
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { promotionStatus: "RETAINED" },
      });
      console.log(`FIXED: ${enrollment.student.lastName} — ${uniqueSubjects.size} failing → RETAINED, ${enrollment.remedialClasses.length} remedial rows deleted`);
      fixed++;
    }
  }
  console.log(`\nDone: ${fixed} enrollments fixed`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

Run: `cd server && npx ts-node --files prisma/fix-retained-students.ts`

**Expected:** JIMENEZ (36 failing) and RAMOS (42 failing) → RETAINED, 26 remedial rows deleted.

### Part B — Guard in EnrollPro Sync

**File:** `server/src/lib/remedial.ts`, function `syncBackSubjectsFromEnrollPro` (~line 333)

After computing failing subjects (~line 380-393), add a check BEFORE tagging CONDITIONALLY_PROMOTED:

```ts
// After finalizeSubjectRows + failing filter (~line 393)
const failingCount = failing.length;

// 3+ failing subjects = RETAINED, not conditionally promoted
if (failingCount >= 3) {
  if (currentEnrollment.promotionStatus !== "RETAINED") {
    await prisma.enrollment.update({
      where: { id: currentEnrollment.id },
      data: { promotionStatus: "RETAINED" },
    });
    result.enrollmentsUpdated++;
  }
  // Delete any existing remedial rows (shouldn't exist for retained)
  await prisma.remedialClass.deleteMany({ where: { enrollmentId: currentEnrollment.id } });
  continue; // skip remedial creation
}
```

Move the existing CONDITIONALLY_PROMOTED tag (lines 333-338) to AFTER this check, so it only runs for 1-2 failures:

```ts
// Only tag CP for 1-2 failing subjects
if (failingCount >= 1 && failingCount <= 2) {
  if (currentEnrollment.promotionStatus !== "CONDITIONALLY_PROMOTED") {
    await prisma.enrollment.update({
      where: { id: currentEnrollment.id },
      data: { promotionStatus: "CONDITIONALLY_PROMOTED" },
    });
    result.enrollmentsUpdated++;
  }
}
```

### Part C — Guard in Backfill

**File:** `server/src/lib/remedial.ts`, function `backfillMissingRemedialRows` (~line 522)

After computing `failing` (~line 523), add:

```ts
if (failing.length >= 3) {
  // Too many failures — should be RETAINED, not conditionally promoted
  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: { promotionStatus: "RETAINED" },
  });
  continue;
}
```

This prevents the backfill from creating rows for students who should be retained.

---

## Execution Order

1. Part A script → fix 2 students immediately
2. Part B → guard in sync (prevents future wrong CP tags)
3. Part C → guard in backfill (prevents future wrong row creation)
4. `cd server && npm run build`
5. `npm run build` (frontend)
6. Verify: Remedial Tracker SY 2026-2027 → empty (JIMENEZ/RAMOS no longer appear)

## Verification

1. Part A script output: "FIXED: JIMENEZ — 36 failing → RETAINED", "FIXED: RAMOS — 42 failing → RETAINED"
2. DB check: `promotionStatus = RETAINED` for both, `remedialClasses = 0`
3. Remedial Tracker pending SY 2026-2027 → 0 students
4. Sync test: re-sync from EnrollPro → students with 3+ failures tagged RETAINED, not CP
5. Backfill test: run backfill → skips students with 3+ failures
6. `npm run build` passes
