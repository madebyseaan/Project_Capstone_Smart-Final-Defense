# PLAN ADDENDUM — G10 Decision (Handoff)

Decision recorded 2026-09-03 (user):
- **JHS_COMPLETER (G10, 0-2 failures): NO remedial.** Completers adjust grades instead; remedial is impossible for them.
- **RETAINED (G10, 3+ failures): strictly returns to Grade 10.** No remedial, no promotion.

Parent plan: `PLAN_REMEDIAL_FIXES.md` P2 — now resolved. Scope below is the only code delta needed.

## Current behavior (verified — mostly correct already)
- `evaluatePromotion` (`server/src/lib/promotion.ts:150-152`): G10 0-2 fail → `JHS_COMPLETER` (`promotedToGradeLevel: null`); 3+ fail → `RETAINED` (`promotedToGradeLevel: GRADE_10`). ✓ matches decision — **do not change these branches.**
- EOSY auto-create only fires for `CONDITIONALLY_PROMOTED` (`promotion.ts:511`) → G10 never gets auto rows. ✓
- `completeRemedial` rejects non-`CONDITIONALLY_PROMOTED` (`remedial.ts:64`). ✓

## Remaining gaps to fix

### GAP 1 — manual-create escape hatch has no status guard
`server/src/routes/registrar/remedial.ts` `POST /:enrollmentId/manual-create` creates rows for ANY enrollment, including `JHS_COMPLETER` / `RETAINED` G10 (or any status). Orphaned PENDING rows would pollute the tracker, history view, and SF10 remedial table, and can never be completed.

**Fix:** after the enrollment lookup (line ~238), add:
```ts
if (enrollment.promotionStatus !== "CONDITIONALLY_PROMOTED") {
  res.status(400).json({ message: "Manual remedial records can only be created for conditionally promoted enrollments" });
  return;
}
```
Add a unit-style test mirroring existing `__tests__` patterns: create + assert 400 for `JHS_COMPLETER`, `RETAINED`, `PROMOTED`, `null` statuses; 201 for `CONDITIONALLY_PROMOTED`.

### GAP 2 — sync can re-tag a RETAINED enrollment
`syncBackSubjectsFromEnrollPro` (`server/src/lib/remedial.ts:314-315`) skips `PROMOTED` / `JHS_COMPLETER` but NOT `RETAINED`. If EnrollPro ever lists a learner SMART holds as `RETAINED` (G10 or otherwise), sync would overwrite them to `CONDITIONALLY_PROMOTED` — violating "retained strictly goes back to Grade 10".

**Fix:** add `|| currentEnrollment.promotionStatus === "RETAINED"` to the skip condition. Count via existing `skippedResolved`. Update the JSDoc comment block (already exists — edit, don't add new).

### GAP 3 — comment-level doc of the policy
`remedial.ts` header comment (line ~4) states outcomes support DO 13 §2.1. Append one sentence to the existing header: G10 completers never receive remedial (grades adjusted instead); retained learners repeat the grade level.

## Verification
1. `cd server && npm run build` — zero errors.
2. Run new GAP 1 test + existing `__tests__` (grade-lock, sf10-snapshot) — all pass.
3. `cd .. && npm run build` — frontend unaffected.
4. Manual smoke (seed: `server/prisma/seed-grades.ts`):
   - G10 student, 1 failing subject → EOSY finalize → status `JHS_COMPLETER`, zero `RemedialClass` rows, manual-create returns 400.
   - G10 student, 3 failing subjects → `RETAINED`, `promotedToGradeLevel = GRADE_10`, zero rows.
   - Re-run EnrollPro sync with a RETAINED learner listed → lands in `skippedResolved`, status unchanged.

## Rules
- No changes to `evaluatePromotion` branches, `.env*`, or EnrollPro write behavior (read-only).
- Keep diffs minimal — three small edits + one test file.
