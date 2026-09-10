# PLAN — EOSY / Rollover UX Simplification

## Goal
Make the end-of-school-year flow **simple and easy to understand** (UX priority)
while **not breaking the system**. A registrar should be able to answer
"is this year done?" from one card, and it should be impossible to miss the
EOSY promotion step (the exact bug that blocked rollover silently).

## The problem (what happened)
- `seed-grades.ts` writes grades directly as `FINALIZED`, **bypassing** the EOSY
  promotion finalize step.
- Result: 3,210 finalized grades, **0** `source="EOSY_FINALIZE"` snapshots,
  promotion status never set.
- Rollover archive guardrail (`rollover.ts` snapshot-gap check) blocked the year,
  and the system **silently reverted** the active-year pointer → registrar
  dashboard kept showing the old year's numbers.
- Root UX cause: **two "finalize" actions with confusing names** — "Finalize All"
  (locks grades, DRAFT→FINALIZED) vs "Finalize EOSY" (promotion snapshots + status).

## Target flow (after implementation)
```
Teacher          encodes grades all year (unchanged)
Registrar (EOSY) picks a section → ONE "EOSY Readiness" checklist card:
                 [1] Lock grades      → 210/210 locked   ✓
                 [2] Finalize EOSY    → promotion saved  ✓
                 Ready for rollover: YES
Admin            System Settings → "previous year ready" → [Archive Now]
EnrollPro        new year already active → enrollments flow in
```

## Phases & changes

### Phase A — Registrar EOSY page: guided checklist (UI)
- `src/pages/registrar/components/EOSYOverviewTab.tsx`
  - Add an **"EOSY Readiness"** checklist card at the top:
    - Step 1 "Lock grades" — shows drafts remaining; button runs `handleFinalizeAll`
      (which already locks grades **and** creates EOSY snapshots).
    - Step 2 "Finalize EOSY Promotion" — shows done/not-done; button runs
      `handleEosyFinalize`.
    - Green "Ready for rollover" when both steps complete.
  - New props: `onFinalizeAll`, `finalizingSubject`.
- `src/pages/registrar/EOSYFinalization.tsx`
  - Pass the new props; expose `eosyFinalized`/`eosyPending` already computed.

### Phase B — Visibility on Registrar Dashboard
- `server/src/routes/registrar/main.ts`
  - Add `GET /registrar/rollover-status` (REGISTRAR role) returning the same
    readiness data as the admin card: `currentSY`, `previousYear`,
    `unfinalizedCount`, `snapshotGapCount`, `canArchive`.
- `src/lib/api.ts`
  - Add `registrarApi.getRolloverStatus()`.
- `src/pages/registrar/components/RolloverReadinessCard.tsx` (new)
  - Card on the dashboard showing previous-year status with a link to the EOSY page.
- `src/pages/registrar/Dashboard.tsx`
  - Render the card; warn when the previous year is not archived.

### Phase C — Backend hardening (additive, safe)
- `server/src/routes/registrar/main.ts` (`POST /finalize-grades`)
  - After finalizing, if the section now has **zero DRAFT grades**, auto-run
    `finalizeSectionEosy` (best-effort, logged) → promotion snapshots can't be
    missed on the real finalize path.
- `server/prisma/seed-grades.ts`
  - After inserting grades, run `finalizeSectionEosy` for each seeded section so
    re-seeding produces an archivable state.

### Phase D — Data hygiene (post-implementation)
- Archive 2029-2030 (now EOSY-finalized and snapshot-complete).
- Optionally clean up leftover ACTIVE test years (2027-2028, 2028-2029).

## Files touched
- `server/src/routes/registrar/main.ts`
- `server/prisma/seed-grades.ts`
- `src/lib/api.ts`
- `src/pages/registrar/EOSYFinalization.tsx`
- `src/pages/registrar/components/EOSYOverviewTab.tsx`
- `src/pages/registrar/components/RolloverReadinessCard.tsx` (new)
- `src/pages/registrar/Dashboard.tsx`

## Already shipped (previous sessions)
- Dashboard/transferee queries filter `isArchived: false`
- `PUT /admin/settings` invalidates year cache
- `Finalize All` also runs EOSY finalize
- EOSY Grade Locking tab warning banner
- Admin `RolloverStatusCard` shows snapshot gaps; `canArchive` requires no gaps
- Rollover failures write audit logs; `/admin/rollover-status` reports gaps
- Backfill script `server/scripts/finalizeEosyForYear.ts` (ran for 2029-2030)

## Verification
- `npm run build` (root) and `npm run build` (server) pass.
- EOSY page shows the checklist; both steps reachable with one click each.
- Registrar dashboard shows previous-year readiness.
- Re-seeding (`npm run prisma:seed-grades`) produces EOSY snapshots.

---

## Appendix — Developer Tools (Demo Seeding)

### Goal
One-click simulated grades for every teacher in the active school year, for
testing/presentations — **without ever breaking rollover**.

### Prerequisite (external, operator)
EnrollPro must enroll students for the active year, ATLAS must load teaching
assignments, then run "Sync from EnrollPro". The endpoint pre-checks this and
warns if 0 enrolled students or 0 active class assignments.

### Changes
- `server/prisma/seed-teacher-scores.ts`
  - New: when run with `--finalized`, auto-runs `finalizeSectionEosy` for every
    section at the end → `EOSY_FINALIZE` snapshots + promotion status →
    archive guardrail passes. Remedial rows stay `PENDING`, RCM left blank
    (registrar demoes RCM entry live on RemedialTracker).
- `server/src/routes/admin-sub/system.ts`
  - `POST /admin/dev/seed-scores` (admin-only): `{ action: "seed"|"clear", finalized?, clearFirst? }`.
  - `seed`: pre-checks data, spawns `seed-teacher-scores.ts --all [--finalized] [--clear] --complete-transferees`.
  - `clear`: deletes grades/snapshots/remedial rows, resets promotion status.
- `src/lib/api.ts` — `adminApi.seedScores(...)`.
- `src/pages/admin/components/DeveloperToolsCard.tsx` (new) — "Developer Tools (Demo)"
  card on Admin → System Settings (below Rollover Status):
  - "Seed + Finalize (Demo Ready)" → finalized:true, clearFirst:true
  - "Clear Grades" → action:"clear"
  - Admin-only, confirm dialogs, spinner, result output.

### Rollover safety guarantee
- Draft seed → safe (finalize happens through the normal UI flow → auto-EOSY).
- Finalized seed → the seed script itself runs EOSY finalize → snapshots exist →
  `canArchive` stays true. RCM is intentionally blank (manual input by design).