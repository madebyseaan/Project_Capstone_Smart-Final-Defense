# ARCHITECT PLAN: Rename "Quarterly" Terminology to "Term" (Full-Stack)

> **DOCUMENT TYPE:** Execution playbook for an implementing AI agent. Zero decisions required — every change is specified.
> **HARD RULES:**
> 1. Execute phases IN ORDER. Never skip a verification step.
> 2. NEVER edit files in `server/prisma/migrations/**` (immutable history).
> 3. NEVER touch `.env` or `.env.*`.
> 4. NEVER refactor anything not listed here (AGENTS.md rule).
> 5. Column renames MUST be `ALTER TABLE ... RENAME COLUMN` — never drop/create.
> 6. After every phase, run the phase's verification command before proceeding.
> 7. Final gate: `npm run build` + `npm run lint` in root AND `npm run build` + `npm test` in `server/` — all green.

---

## PART A — PRE-VERIFIED FACTS (do NOT re-investigate; architect already confirmed)

These were verified against the codebase on 2026-08-29. Treat as ground truth.

| # | Fact | Evidence |
|---|------|----------|
| F1 | **External API contract is SAFE.** The EnrollPro grade-outbound endpoint (`POST /api/integration/sections/:sectionId/sync-grades`, `integration.ts:72-228`) responds with `T1`/`T2`/`T3`/`generalAverage`/`remarks`/`promotionStatus` keys — **`quarterlyGrade` never appears in any external payload.** EnrollPro only *pulls* from SMART; SMART never parses `quarterly*` keys from external JSON. | `integration.ts:137-139,188-191,207-220` |
| F2 | **AIMS is a disabled stub** — `aimsClient.ts` functions all return empty/error literals. Its `AimsGradebookRow.quarterlyGrade` interface field (line 62) is internal-only; safe to rename. | `aimsClient.ts:62,72-102` |
| F3 | **Tests have ZERO `quarterly` references.** `server/src/__tests__/` grep = no matches. Tests must still pass after rename but need no edits. | grep verified |
| F4 | **EnrollPro sync/learner/section code has ZERO `quarterly` references** (all matches were `gradeLevel` — unrelated concept). No parse-site keeps. | grep verified |
| F5 | **`GradeSnapshot.snapshot` JSON in the DB contains legacy keys** (`quarterlyAssessScore`, `quarterlyAssessMax`, `quarterlyAssessPS`, `quarterlyGrade`) written by `promotion.ts:419-425`. These rows are immutable history → readers MUST fall back to legacy keys forever. | `promotion.ts:413-428`, `forms.ts:748-757` |
| F6 | **Test command:** `cd server && npm test` (runs `vitest run`). **Server build:** `cd server && npm run build` (runs `tsc`). Frontend: root `npm run build`, `npm run lint`. | `server/package.json` |
| F7 | **6 Prisma columns** to rename across 3 models (exact SQL in Phase 1). | `schema.prisma:129,221,222,227,229,441` |
| F8 | **Prisma 7 / PostgreSQL** — `ALTER TABLE ... RENAME COLUMN` is transactional and preserves all data and indexes. | package.json |
| F9 | The `term` field, `Term` enum (`T1/T2/T3`), and all term *logic* are already correct. This rename touches **names and labels only — zero behavioral change.** | schema.prisma |

---

## PART B — CANONICAL RENAME MAP (single source of truth)

### B1. Database / Prisma / API field names

| Old | New | Models / locations |
|---|---|---|
| `quarterlyGrade` | `termGrade` | `Grade`, all API types, all logic |
| `quarterlyAssessScore` | `termAssessScore` | `Grade`, API types, logic |
| `quarterlyAssessMax` | `termAssessMax` | `Grade`, API types, logic |
| `quarterlyAssessPS` | `termAssessPS` | `Grade`, API types, logic |
| `quarterlyAssessWeight` | `termAssessWeight` | `Subject`, `GradingConfig`, API types, admin logic |

### B2. TypeScript identifiers (variables, functions, interfaces)

| Old | New | File |
|---|---|---|
| `QuarterGrade` (interface) | `TermGrade` | `src/lib/api.ts:466` |
| `getQuarterGrade()` | `getTermGrade()` | `src/pages/teacher/components/classRecordMobileUtils.ts:37` |
| `displayQuarterlyGrade` | `displayTermGrade` | `src/pages/teacher/components/ClassRecordTable.tsx:147` |
| `mergedQuarterlyAssessScore` | `mergedTermAssessScore` | `server/src/routes/grades-sub/classes.ts:328` |
| `mergedQuarterlyAssessMax` | `mergedTermAssessMax` | `server/src/routes/grades-sub/classes.ts:334` |
| `existingQuarterly` | `existingTermGrade` | `server/src/lib/promotion.ts:398` |
| `nonNullQuarterCountByAssignment` | `nonNullTermCountByAssignment` | `server/src/routes/registrar/forms.ts:104,776` |

### B3. User-facing strings

| Old string | New string | File:line |
|---|---|---|
| `"Quarterly Grade"` (Excel header) | `"Term Grade"` | `server/src/routes/registrar/exports.ts:602` |
| `"Quarterly Rating"` (SF5 header) | `"Term Rating"` | `src/pages/registrar/SchoolForms.tsx:939` |
| `"Quarterly issued report card"` | `"Term-issued report card"` | `src/pages/registrar/StudentRecords.tsx:830` |
| `"initial grade to quarterly grade"` | `"initial grade to term grade"` | `src/pages/admin/TransmutationTable.tsx:261` |
| `"SF4 - Quarterly Assessment Report"` | `"SF4 - Term Assessment Report"` | `src/pages/admin/TemplateManager.tsx:68` |
| `"Quarter exam results and assessments"` | `"Term exam results and assessments"` | `src/pages/admin/TemplateManager.tsx:68` (description) |
| Tour strings — see Phase 5 table | term equivalents | `src/pages/teacher/components/ClassRecordTour.tsx` |
| Comment `"all quarters"` | `"all terms"` | `server/src/routes/advisory.ts:293` |
| Comment `"specific quarter"` | `"specific term"` | `server/src/routes/grades-sub/classes.ts:573` |
| `"no quarterly assessment"` | `"no term assessment"` | `server/prisma/GRADE_SEED_REPORT.md:28` |
| Seed comment `"target quarterly grade"` | `"target term grade"` | `server/prisma/seed-grades-fresh.ts:57` |

### B4. DELIBERATELY UNCHANGED (do not touch — guardrails)

- `Term` enum, `T1`/`T2`/`T3` values, `grade.term`, `termKey`, `terms[]` — already correct.
- Internal short names `qa`, `qaWeight`, `qa:` object keys (e.g., `helpers.ts:251,264`, `classes.ts:357-358`, `seed-grades-fresh.ts:304`) — contain no "quarter"; keep to minimize churn. (If a *type* defining the weight trio is renamed, only the `quarterlyAssessWeight`-named field changes → `termAssessWeight`; the `qa` key stays.)
- UI abbreviation `"TA"` (already used at `ClassRecordTable.tsx:855`, `GradingConfig.tsx:569`) — keep as-is; it now means "Term Assessment".
- Audit-log string `"QA ${quarterlyAssessWeight}%"` in `admin-sub/grading.ts:105` → becomes `"QA ${termAssessWeight}%"` (variable rename only; literal "QA" stays).
- Excel column `key: "qg"` in `exports.ts:602` — internal key; rename to `qg`→`tg` ONLY in the same statement pair (header + data at line 609) — keep them consistent.
- Historical migration SQL in `server/prisma/migrations/**` — immutable.
- Snapshot fallback reads `snapData?.quarterlyGrade` etc. — REQUIRED legacy-key reads (see Phase 2, site S1).

---

## PART C — PHASED EXECUTION

### Phase 0 — Preflight (10 min, read-only except branch)

```powershell
# 0.1 Confirm clean tree
git status                       # MUST be clean. If not: STOP, report to user.

# 0.2 Create branch
git checkout -b rename/quarterly-to-term

# 0.3 Baseline builds (must pass BEFORE any change)
npm run build                    # root frontend — expect PASS
npm run lint                     # root — expect PASS
cd server; npm run build         # backend — expect PASS
cd server; npm test              # vitest — record pass/fail baseline (F3 says no quarterly refs, but confirm suite state)

# 0.4 DB backup — CONFIRM WITH USER before Phase 1. If user unavailable and dev DB is disposable, proceed; production DB backup is MANDATORY before deploying migration.
```

**Gate 0:** All baselines pass (or pre-existing failures documented). Branch created.

---

### Phase 1 — Prisma schema + data-preserving migration

**File:** `server/prisma/schema.prisma`

1. Edit exactly these field declarations:

```prisma
# Subject model (~line 129)
-  quarterlyAssessWeight Int?
+  termAssessWeight Int?

# Grade model (~lines 221-229)
-  quarterlyAssessScore  Float?
-  quarterlyAssessMax    Float?          @default(100)
-  quarterlyAssessPS     Float?
-  quarterlyAssessGrade  # (actual: quarterlyGrade Float?)
+  termAssessScore       Float?
+  termAssessMax         Float?          @default(100)
+  termAssessPS          Float?
+  termGrade             Float?

# GradingConfig model (~line 441)
-  quarterlyAssessWeight Int
+  termAssessWeight Int
```

2. Generate migration with a blank slate so YOU control the SQL:
```powershell
cd server
npx prisma migrate dev --name rename_quarterly_to_term --create-only
```

3. **OPEN the generated `server/prisma/migrations/<ts>_rename_quarterly_to_term/migration.sql`.** If it contains `DROP COLUMN` / `ADD COLUMN` (data-destroying), REPLACE the entire file body with exactly:

```sql
-- Rename legacy "quarterly" columns to "term" (data-preserving)
ALTER TABLE "Grade" RENAME COLUMN "quarterlyAssessScore" TO "termAssessScore";
ALTER TABLE "Grade" RENAME COLUMN "quarterlyAssessMax" TO "termAssessMax";
ALTER TABLE "Grade" RENAME COLUMN "quarterlyAssessPS" TO "termAssessPS";
ALTER TABLE "Grade" RENAME COLUMN "quarterlyGrade" TO "termGrade";
ALTER TABLE "Subject" RENAME COLUMN "quarterlyAssessWeight" TO "termAssessWeight";
ALTER TABLE "GradingConfig" RENAME COLUMN "quarterlyAssessWeight" TO "termAssessWeight";
```

4. Apply + regenerate client:
```powershell
npx prisma migrate dev
npm run prisma:generate
```

5. **Data integrity check (MANDATORY):**
```sql
-- Run via psql / Prisma Studio / pg_dump comparison:
SELECT COUNT(*) FROM "Grade" WHERE "termGrade" IS NOT NULL;      -- must equal pre-migration COUNT WHERE "quarterlyGrade" IS NOT NULL
SELECT COUNT(*) FROM "Grade";                                     -- row count unchanged
SELECT COUNT(*) FROM "Subject" WHERE "termAssessWeight" IS NOT NULL;
SELECT COUNT(*) FROM "GradingConfig";                             -- row count unchanged
```

**Gate 1:** Migration applied, counts match, client regenerated. `cd server && npm run build` will now FAIL with ~130 errors about `quarterly*` not existing — **this is expected; proceed immediately to Phase 2.**

> GUARDRAIL: If `prisma migrate dev` reports drift or asks to reset the database — **STOP. Do not reset.** Report to user. (Reset = data loss.)

---

### Phase 2 — Backend rename (~14 files + 3 seeds)

**Method per file:** search `quarterly` (case-insensitive) in the file, apply map B1/B2/B4. Line numbers below are anchors (they shift as you edit — search, don't blindly navigate). Exact code for the 4 tricky sites follows the table.

| # | File | Anchors | What changes |
|---|------|---------|--------------|
| 2.1 | `server/src/routes/grades-sub/helpers.ts` | 160, 225, 246-264, 282-283, 302-325 | `calculateGrades()` params/locals/return: `quarterlyAssessScore`→`termAssessScore`, `quarterlyAssessMax`→`termAssessMax`, `quarterlyAssessPS`→`termAssessPS`, `quarterlyGrade`→`termGrade`; Prisma select `quarterlyAssessWeight: true`→`termAssessWeight: true`; weight reads → `termAssessWeight` (keep `qa:` object keys) |
| 2.2 | `server/src/routes/grades-sub/classes.ts` | 211-212, 307-309, 328-337, 357-396, 435-443, 453, 534-542, 573 | All B1 fields; `merged*` per B2; destructure `termAssessScore, termAssessMax` from body; audit string interpolates `termGrade`; comment at 573 |
| 2.3 | `server/src/routes/grades-sub/dashboard.ts` | 188-260, 439-448, 467, 483, 578 | All reads `g.quarterlyGrade`→`g.termGrade`; **Prisma `where:` filters** at 439/448: `quarterlyGrade: { not: null }`→`termGrade: { not: null }`; recalc destructure/return |
| 2.4 | `server/src/routes/advisory.ts` | 79-88, 293, 436-457, 520-521, 706-707 | B1 fields in inline types + logic; comment 293 |
| 2.5 | `server/src/routes/admin-sub/grading.ts` | 39-139, 394-450 | All `quarterlyAssessWeight`→`termAssessWeight` (zod-validated body field, upserts, overrides, clears); audit literal `"QA "` stays |
| 2.6 | `server/src/routes/registrar/forms.ts` | 104-111, 191-192, 536-537, 744-773, 776-787, 868-870, 1072-1074 | B1 fields; **CRITICAL SITE S1 (snapshot fallback) below**; `nonNullQuarterCountByAssignment`→`nonNullTermCountByAssignment` |
| 2.7 | `server/src/routes/registrar/main.ts` | 1321-1468 | Prisma selects + all logic per B1 |
| 2.8 | `server/src/routes/registrar/exports.ts` | 602, 609 | header `"Quarterly Grade"`→`"Term Grade"`; `qg: g.quarterlyGrade`→`tg: g.termGrade` (and header `key:"qg"`→`key:"tg"`) |
| 2.9 | `server/src/routes/integration.ts` | 189-190 | `grade.quarterlyGrade`→`grade.termGrade` (internal DB read; external response shape has no quarterly keys — F1) |
| 2.10 | `server/src/schemas/grades.ts` | 22-23 | `quarterlyAssessScore:`→`termAssessScore:`, `quarterlyAssessMax:`→`termAssessMax:` (**API request-body change** — frontend updated Phase 4) |
| 2.11 | `server/src/schemas/admin.ts` | 126 | `quarterlyAssessWeight:`→`termAssessWeight:` (API body change) |
| 2.12 | `server/src/lib/promotion.ts` | 288-289, 398-425 | Reads per B1; **CRITICAL SITES S2 (dedupe read) + S3 (snapshot writer) below** |
| 2.13 | `server/src/lib/sf5Composer.ts` | 158-159 | `g.quarterlyGrade`→`g.termGrade` |
| 2.14 | `server/src/lib/aimsClient.ts` | 62 | interface field → `termGrade: number \| null;` (F2: stub) |
| 2.15 | `server/prisma/seed.ts` | 154 | `quarterlyAssessWeight: null`→`termAssessWeight: null` |
| 2.16 | `server/prisma/seed-grades.ts` | 197-224 | locals + payload per B1 |
| 2.17 | `server/prisma/seed-grades-fresh.ts` | 57, 108, 128, 139, 304, 324-325, 332, 341-347, 355-361, 392-393, 400, 409-415, 423-429, 472, 475 | locals + payloads per B1; comment 57 per B3 |

#### CRITICAL SITE S1 — Snapshot fallback reader (`forms.ts:744-773`)

Legacy snapshots in DB keep `quarterly*` JSON keys (F5). The reconstructed object gets NEW keys; reads fall back to legacy:

```typescript
// BEFORE (line 749-770, abridged)
snapshotGrades.push({
  ...
  quarterlyGrade: snapData?.quarterlyGrade ?? null,
  writtenWorkPS: snapData?.writtenWorkPS ?? null,
  perfTaskPS: snapData?.perfTaskPS ?? null,
  quarterlyAssessPS: snapData?.quarterlyAssessPS ?? null,
  ...
});

// AFTER
snapshotGrades.push({
  ...
  termGrade: snapData?.termGrade ?? snapData?.quarterlyGrade ?? null,
  writtenWorkPS: snapData?.writtenWorkPS ?? null,
  perfTaskPS: snapData?.perfTaskPS ?? null,
  termAssessPS: snapData?.termAssessPS ?? snapData?.quarterlyAssessPS ?? null,
  ...
});
```

(All downstream consumers in this file read `.termGrade` after Phase 2.)

#### CRITICAL SITE S2 — Snapshot dedupe comparison (`promotion.ts:398-399`)

```typescript
// BEFORE
const existingQuarterly = existing ? (existing.snapshot as EosySnapshotPayload).quarterlyGrade : undefined;
if (existing && existingQuarterly === grade.quarterlyGrade) continue;

// AFTER — read BOTH key generations from stored snapshot JSON
const snap = existing ? (existing.snapshot as any) : null;
const existingTermGrade = snap ? (snap.termGrade ?? snap.quarterlyGrade) : undefined;
if (existing && existingTermGrade === grade.termGrade) continue;
```

(If `EosySnapshotPayload` type exists in this file, add the `term*` fields and mark `quarterly*` fields optional — both generations valid.)

#### CRITICAL SITE S3 — Snapshot writer (`promotion.ts:413-428`)

```typescript
// AFTER — write NEW keys only (legacy rows stay untouched; S1/S2 read old ones)
snapshot: {
  source: EOSY_SNAPSHOT_SOURCE,
  finalizedBy: opts.actor.id,
  finalizedAt: new Date().toISOString(),
  writtenWorkScores: grade.writtenWorkScores,
  perfTaskScores: grade.perfTaskScores,
  termAssessScore: grade.termAssessScore,
  termAssessMax: grade.termAssessMax,
  writtenWorkPS: grade.writtenWorkPS,
  perfTaskPS: grade.perfTaskPS,
  termAssessPS: grade.termAssessPS,
  initialGrade: grade.initialGrade,
  termGrade: grade.termGrade,
  remarks: grade.remarks,
  qualitativeDescriptor: grade.qualitativeDescriptor,
},
```

**Gate 2:**
```powershell
cd server; npm run build    # MUST compile clean
npm test                    # MUST match Phase 0 baseline (F3: no quarterly in tests)
git add -A; git commit -m "refactor(server): rename quarterly* to term* (DB fields already migrated)"
```

---

### Phase 3 — Frontend API types

**File:** `src/lib/api.ts` — anchors: 179 (`Subject`), 237-238/243/245 (`Grade`), 345-346 (`saveGrade` params), 466-484 (`QuarterGrade`→`TermGrade` interface + `SubjectGrade.grades.T1/T2/T3` types), 1166 (`GradingConfig`), 1351, 1407-1415 (admin weight APIs). Apply B1/B2 verbatim.

**Gate 3:** Root `npm run build` FAILS with unresolved `quarterly*` errors pointing at Phase 4 files — expected; proceed immediately.

---

### Phase 4 — Frontend logic & components (~10 files)

| # | File | Anchors | What changes |
|---|------|---------|--------------|
| 4.1 | `src/pages/admin/GradingConfig.tsx` | 76, 136-249, 417, 523-524, 555, 569, 680, 718-719 | All `quarterlyAssessWeight`→`termAssessWeight` (state, bindings, string-literal field names `"quarterlyAssessWeight"`→`"termAssessWeight"`, diffs, payloads); label `TA {..}%` unchanged |
| 4.2 | `src/pages/teacher/components/ClassRecordTable.tsx` | 140-147, 387-388, 470-474, 626, 855 | `displayQuarterlyGrade`→`displayTermGrade`; `grade?.quarterlyAssess*`→`termAssess*`; `subject.quarterlyAssessWeight`→`termAssessWeight`; header `TA (...)` unchanged |
| 4.3 | `src/pages/teacher/components/classRecordActions.ts` | 127-128, 150, 194, 238-239, 253, 287 | Defaults + API payload keys → `termAssessScore`/`termAssessMax` (must match Phase 2.10 zod schema) |
| 4.4 | `src/pages/teacher/components/classRecordMobileUtils.ts` | 37, 47, 61-63, 82, 92 | `getQuarterGrade`→`getTermGrade` (def + 2 calls); field reads per B1 |
| 4.5 | `src/pages/teacher/components/ClassRecordMobileList.tsx` | 73-74 | field reads per B1 |
| 4.6 | `src/pages/teacher/ClassRecordView.tsx` | 216, 778-779 | `grade.quarterlyAssessMax`→`termAssessMax`; `subject.quarterlyAssessWeight`→`termAssessWeight` |
| 4.7 | `src/pages/teacher/ClassRecordsList.tsx` | 106, 476, 568 | `subject.quarterlyAssessWeight`→`termAssessWeight` |
| 4.8 | `src/pages/teacher/StudentGradeProfile.tsx` | 412 | `subject.grades[term]?.quarterlyGrade`→`?.termGrade` |
| 4.9 | `src/pages/registrar/EOSYFinalization.tsx` | 1071-1072 | `subject.quarterlyGrade`→`subject.termGrade` |

**Gate 4:** Root `npm run build` → **clean**.

---

### Phase 5 — UI labels & prose

| File | Line | Old → New |
|---|---|---|
| `src/pages/registrar/SchoolForms.tsx` | 939 | `Quarterly Rating` → `Term Rating` |
| `src/pages/registrar/StudentRecords.tsx` | 830 | `Quarterly issued report card` → `Term-issued report card` |
| `src/pages/admin/TransmutationTable.tsx` | 261 | `...initial grade to quarterly grade` → `...initial grade to term grade` |
| `src/pages/admin/TemplateManager.tsx` | 68 | `SF4 - Quarterly Assessment Report` → `SF4 - Term Assessment Report`; `Quarter exam results and assessments` → `Term exam results and assessments` |
| `src/pages/teacher/components/ClassRecordTour.tsx` | 56 | `30% Quarterly Assessment` → `30% Term Assessment` |
| same | 74 | `quarterly finalization` → `term finalization` |
| same | 104 | `Quarterly Exams` → `Term Exams` |
| same | 155 | `Quarterly Periods & Score Safety` → `Term Periods & Score Safety` |
| same | 160 | `each quarter's records safely` → `each term's records safely` |
| same | 162 | `Scores are saved permanently per quarter` → `...per term` |
| same | 192 | `4 performance tasks this quarter` → `...this term` |
| `server/prisma/GRADE_SEED_REPORT.md` | 28 | `no quarterly assessment` → `no term assessment` |

---

### Phase 6 — Final sweep & verification (Definition of Done)

```powershell
# 6.1 Residual sweep — the ONLY allowed matches are listed below
rg -i "quarter" src/ server/src/ server/prisma/schema.prisma server/prisma/seed*.ts
# ALLOWED leftovers (exact set):
#   forms.ts S1:            snapData?.quarterlyGrade / snapData?.quarterlyAssessPS   (legacy fallback)
#   promotion.ts S2:        snap.quarterlyGrade                                      (legacy fallback)
#   promotion.ts S2:        EosySnapshotPayload legacy optional fields (if kept)
# ANY OTHER MATCH = fix it, re-run gates.

# 6.2 Full gate
npm run build          # root — clean
npm run lint           # root — clean
cd server; npm run build   # clean
cd server; npm test        # matches baseline

# 6.3 Diff hygiene
git diff --stat main...HEAD   # ONLY files in Parts B/C. Any unrelated file = investigate.

# 6.4 Manual smoke (if dev DB available; else list as user follow-up)
# - Teacher: open class record → edit WW/PT/TA score → save → grade recomputes & displays
# - Admin: GradingConfig loads; subject weight override saves
# - Registrar: SF9 + SF10 for a known student render IDENTICAL grades to pre-rename (spot-check numbers)
# - SF10 fallback proof: pick a student WITH pre-rename GradeSnapshot rows → grades still render (S1 works)
```

---

### Phase 7 — OPTIONAL, SEPARATE PR (do not bundle): snapshot JSON re-key

One-time script (new file `server/prisma/rekey-snapshots.ts`, run via `ts-node`): iterate `GradeSnapshot` rows where `snapshot->>'termGrade' IS NULL AND snapshot->>'quarterlyGrade' IS NOT NULL`, rewrite JSON keys per B1 inside a transaction. **Keep S1/S2 fallback readers regardless** (defense in depth). Only after Phase 6 is stable in dev.

---

## PART D — RISK REGISTER & GUARDRAILS

| Risk | Severity | Mitigation (already baked into phases) |
|---|---|---|
| Snapshot legacy keys unreadable after rename | HIGH | S1/S2 dual-key reads (Phase 2); writer uses new keys only (S3) |
| Prisma CLI generates destructive SQL | HIGH | Phase 1 step 3: `--create-only` + hand-verified `RENAME COLUMN` body |
| Migration drift / reset prompt | HIGH | Guardrail in Phase 1: STOP, never accept reset |
| FE/BE contract skew (zod body fields changed at 2.10/2.11) | MED | Atomic same-branch rename; Gate 2 (server builds) + Gate 4 (root builds) bracket the contract |
| Excel export header/key mismatch (`exports.ts`) | LOW | B4 rule: header label + `key` + data accessor renamed as one triplet (`"Term Grade"`, `tg`, `g.termGrade`) |
| Missed occurrences | LOW | Phase 6.1 exhaustive sweep with explicit allow-list |
| External integrations | ELIMINATED | F1/F2/F4: verified no external `quarterly*` contract exists |

## PART E — ROLLBACK

- **Code:** single branch `rename/quarterly-to-term`; revert PR/merge if issues surface post-deploy.
- **DB:** inverse migration (six `RENAME COLUMN` statements, old↔new swapped). Phase 0.4 backup is last resort.
- **Snapshots:** Phases 1-6 never rewrite snapshot rows → zero snapshot rollback risk.

## PART F — OPEN CONFIRMATIONS (defaults chosen; user may override before execution)

1. **SF4 label** deviates from official DepEd title "Quarterly Assessment Report". Default: rename (user said "we are terms now").
2. **`qa` short identifiers**: keep (no "quarter" in them). Default: keep.
3. **Phase 7 snapshot re-key**: defer to separate PR. Default: defer.
