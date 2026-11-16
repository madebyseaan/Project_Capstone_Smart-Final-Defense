# Grade Pipeline Rules

Single reference for how grades are derived, merged and repaired. Owner: grades/forms.

## 1. Rotation subjects (Science, TLE Exploratory)

- A subject may belong to a rotation group (`Subject.rotationTermGroupId`) with a rank (`1..3`).
- **Each sub-subject's grade belongs to its own rotation term** (`rank 1 → T1`, `2 → T2`, `3 → T3`).
  Grades recorded in other terms are ignored by merged views.
- The same rule is used by Advisory, SF9, SF10 and `mergeRotationSubjects()` (promotion/EOSY).
- Merged display labels use `rotationOutputLabel` (e.g. `SCIENCE` → "Science").
- Metadata is validated (`server/src/lib/rotationMetadata.ts`). Invalid metadata (e.g. `MATH10` tagged `SCIENCE`) is rejected by the Atlas sync and flagged by the data-integrity check.

## 2. Derived grade fields

Source of truth when an exam breakdown exists: **ST1/ST2/TE (30/30/40)**.

```
WW PS = stored WW PS ?? scores-derived PS
PT PS = stored PT PS ?? scores-derived PS
QA PS = exam breakdown PS ?? stored QA PS ?? composite QA
Initial = WW·ww% + PT·pt% + QA·qa%
Quarterly = computeTermGrade(Initial, school-year mode, transmutation table)
```

- Teacher saves, ECR imports and AIMS (composite) imports already follow this.
- Admin config changes call `recomputeStoredGrades()`, which now uses the same rule.
- `server/scripts/repair-grade-derivations.ts` aligns legacy/seeded rows. Dry-run by default; `--apply`; `--undo <report>`.
- Archived and FINALIZED/LOCKED rows are skipped unless explicitly opted in.

## 3. Row selection / inheritance

- Advisory and Class Record show the active assignment; grades missing there are inherited from the most recent archived predecessor.
- SF9/SF10 include archived assignments only when they still carry grades (no blank stale rows).
- Teacher labels come from the assignment that holds the grades (active first), deduplicated for rotation groups.

## 4. Operational commands

```powershell
# Parity audit (read-only) — Advisory vs Class Record vs SF9 vs SF10 + drift
pnpm --prefix server exec ts-node --transpile-only scripts/audit-grade-alignment.ts --school-year 2026-2027 --json artifacts/audit.json

# Data-integrity check (deploy preflight)
pnpm --prefix server exec ts-node --transpile-only scripts/check-data-integrity.ts --school-year 2026-2027

# Repairs (dry-run first; keep the JSON; undo is supported)
pnpm --prefix server exec ts-node --transpile-only scripts/repair-rotation-metadata.ts --json artifacts/rotation.json
pnpm --prefix server exec ts-node --transpile-only scripts/repair-grade-derivations.ts --school-year 2026-2027 --report artifacts/qa.json
```

**Expected healthy state:** parity audit reports `0` mismatches for Advisory↔Class Record, Advisory↔SF9, Advisory↔SF10, and stored↔ledger; `invalidRotationSubjects = 0`.

See `docs/GRADE_PIPELINE_ALIGNMENT_FIX_PLAN_2026-11-16.md` for the full verification/rollback playbook.
