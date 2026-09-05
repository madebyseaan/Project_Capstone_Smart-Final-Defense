# HANDOFF: Remove Homeroom Guidance (HG) as a Subject

**Status:** PLAN ONLY — do not execute without reading Risk section.
**Goal:** HG = a room/location, not a subject. Remove HG from all write paths, dashboards, class records, and schedules. Keep read paths for archived-year history.

---

## 1. Current state (inventoried)

HG is deeply integrated but always as a *special case*, never load-bearing:

| Layer | Location | What it does |
|---|---|---|
| Sync ingestion | `server/src/lib/atlasSync.ts:27-30,497-509`, `server/src/lib/teacherSync.ts:39-41,525-531,628-631,730-731`, `server/src/lib/sync/utils.ts:19-21` | Auto-creates `HG*` Subjects + ClassAssignments from ATLAS loads (`ensureHomeroomGuidanceLabel`, 60 teachingMinutes) |
| Subject mapping | `server/src/lib/atlasUtils.ts:31,99,162,218-230` | Maps `HG` prefix → "Homeroom Guidance" CORE subject |
| Grade write path | `server/src/routes/grades-sub/classes.ts:295-300,384-398` | HG uses `qualitativeDescriptor` instead of WW/PT/QA scores |
| Descriptors | `server/src/routes/grades-sub/helpers.ts:51,209-211` | `HG_QUALITATIVE_DESCRIPTORS`, `isHomeroomGuidanceSubjectCode()` |
| Dashboards/deadlines | `server/src/routes/grades-sub/dashboard.ts:76,181,460,612`, `helpers.ts:153` | Excludes HG from stats |
| Advisory views | `server/src/routes/advisory.ts:29,162,340,637` | Local `isHomeroomGuidanceCode` filter + qualitative passthrough (81,412-423) |
| SF forms (READ) | `server/src/routes/registrar/forms.ts:138,166,820,856` + `registrar/helpers.ts:104-105` | Renders HG descriptor rows in SF10/SF5 — **queries historical years too** |
| Promotion | `server/src/lib/promotion.ts:494` | Passes `qualitativeDescriptor` through; `isNonPromotional` flag (schema:130) is separate and stays |
| Admin | `server/src/routes/admin-sub/classAssignments.ts:280-281` | Renames HG subject on create |
| Zod | `server/src/schemas/grades.ts:26` | `qualitativeDescriptor` field |
| Frontend | `src/pages/teacher/ClassRecordView.tsx:155,161,813,912-1053`, `components/GradeEditModal.tsx:22-84`, `ClassRecordHero.tsx:28-92`, `ClassRecordMobileList.tsx:16-120`, `HGDescriptorPanel.tsx` (whole file), `StudentGradeProfile.tsx:414-421`, `Dashboard.tsx:738`, `ClassRecordTour.tsx:56` | isHG branches, HG tab, HG descriptor panel |
| Data | `Subject` rows `HG7/HG8...`, `ClassAssignment` (current SY has ~10 HG rows), `Grade` (qualitative only), `ScheduleEntry` for HG, `GradeSnapshot` (no FK — plain `classAssignmentId` String, schema:251) | See cleanup plan |
| Tests | `server/src/__tests__/promotion.test.ts:43` | HG fixture |

Advisory = `Section.adviserId` (schema:104) — **independent of HG, unaffected**.

---

## 2. Verdict: will removal break the system?

**No — if phased correctly.** HG is excluded from every aggregate already (dashboards, promotion, rates). The two real breakage risks:

1. **Sync recreation:** ATLAS still sends HG loads. If you only delete code/rows, the next `atlasSync`/`teacherSync` run recreates everything. Ingestion filter (Phase 1) MUST ship before/with data cleanup.
2. **Archived-year SF10/SF5 regeneration:** `registrar/forms.ts` HG branches read `GradeSnapshot`/`Grade` rows from *past* years. If you delete those branches + historical rows, regenerated forms for archived years lose their HG row. Keep read paths; only delete current-SY data.

Safe to delete: Grade write-path HG logic, all frontend HG UI, current-SY HG data, HG ingestion. The `Grade.qualitativeDescriptor` column and `Subject.isNonPromotional` flag are nullable/independent — leave both in schema (zero-migration-risk; column just goes unused).

---

## 3. Execution plan (ordered)

### Phase 1 — Block ingestion (backend, ship first)
- `atlasSync.ts`, `teacherSync.ts`, `sync/utils.ts`: skip any load whose resolved subject code starts with `HG` (before subject upsert / ClassAssignment upsert / ScheduleEntry creation). Log skipped count once per sync.
- `atlasSync.ts:6.6` schedule persistence: skip entries whose subject code starts with `HG`.
- `admin-sub/classAssignments.ts:280-281`: reject manual creation of `HG*` subject assignments (400: "Homeroom is a location, not a subject").
- Do NOT touch `atlasUtils.ts` mapping yet (harmless once callers filter, and less churn).

### Phase 2 — Remove write path (backend)
- `grades-sub/classes.ts`: remove `isHG` branch (295-300 validation, 371-385 payload split) — always use numeric path.
- `schemas/grades.ts:26`: drop `qualitativeDescriptor`.
- `helpers.ts`: delete `HG_QUALITATIVE_DESCRIPTORS`.
- KEEP `isHomeroomGuidanceSubjectCode()` in `helpers.ts` + `registrar/helpers.ts` — repurpose as legacy read-filter for archived years (comment it as such). All `dashboard.ts`/`advisory.ts` call sites stay; they already exclude HG and become no-ops on fresh data.
- `promotion.ts:494`: drop descriptor passthrough.

### Phase 3 — Remove frontend HG UI
- Delete `src/pages/teacher/components/HGDescriptorPanel.tsx`.
- `ClassRecordView.tsx`: remove `isHGClass` + HG tab type (`'WW'|'PT'|'QA'` only) + all `{isHGClass && ...}` blocks (939-944) + `mobileEditorTab` HG init (813).
- `GradeEditModal.tsx`, `ClassRecordHero.tsx`, `ClassRecordMobileList.tsx`: remove `isHGClass` prop + branches.
- `StudentGradeProfile.tsx:414-421`: remove isHG branch.
- `Dashboard.tsx:738`: keep the `startsWith('HG')` filter (harmless no-op) or remove — either fine.
- `ClassRecordTour.tsx:56`: remove Homeroom mention from copy.

### Phase 4 — Data cleanup (one script, current SY only)
```
DELETE Grade          WHERE classAssignment.subject.code LIKE 'HG%' AND classAssignment.schoolYear = <current>
DELETE ClassAssignment WHERE subject.code LIKE 'HG%' AND schoolYear = <current>        -- cascades remaining Grades
DELETE ScheduleEntry   WHERE subject.code LIKE 'HG%' AND schoolYear = <current>
-- Subject rows HG*: KEEP (historical ClassAssignments FK to them)
-- GradeSnapshot with subjectCode LIKE 'HG%': KEEP (archived-year SF10 regeneration)
-- Past-year HG Grades/ClassAssignments: KEEP (view-only history)
```
Prisma-equivalent or raw SQL; run inside a transaction; take a DB backup first.

### Phase 5 — Verification
1. `cd server && npm run build` — zero TS errors.
2. Root `npm run build` — frontend clean.
3. `cd server && npm test` — promotion test still passes (HG fixture uses kept helper).
4. Trigger/observe one full `atlasSync` run → log shows HG loads skipped, no new HG rows (`SELECT count(*) FROM "ClassAssignment" JOIN "Subject" ... WHERE code LIKE 'HG%' AND schoolYear = current`).
5. Teacher portal: Class Records list has no HG record; schedule shows no HG entries; dashboard stats unchanged (HG was already excluded).
6. Registrar: regenerate an *archived-year* SF10 → HG descriptor row still renders (read path intact).
7. Teacher takes attendance / advisory page — unaffected.

---

## 4. Decision points (defaults chosen, confirm with Sean if changing)

| Decision | Default | Rationale |
|---|---|---|
| Delete historical (archived-year) HG grades? | **No** | SF10 history regeneration breaks |
| Drop `qualitativeDescriptor` column / migration? | **No** | Nullable, unused after Phase 2; avoids migration risk |
| Remove `isHomeroomGuidanceSubjectCode` helper entirely? | **No — keep as legacy filter** | Registrar/advisory read paths + tests depend on it |
| Remove `atlasUtils` HG mapping? | **No** | Callers filter first; less churn |
| HG in ATLAS external system? | **Not our problem — read-only integration; we just stop ingesting** | AGENTS.md non-negotiable |

## 5. Non-negotiables
- No `.env` changes. No writes to EnrollPro/ATLAS. Run `npm run build` (root + server) before finishing.
- Scope: only HG removal — do not refactor neighbors in the same PR.
