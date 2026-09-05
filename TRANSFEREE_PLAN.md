# Transferee Handling — Implementation Plan

> **Status:** PLANNING — Do not implement until approved.
> **Audience:** Implementation agent. Read this file top-to-bottom before writing code.
> **Source API doc:** `C:\Users\Sean\Downloads\SMART-TRANSFEREE-API.md`
> All file:line references below were verified against the codebase on 2026-09-04.

---

## 1. Executive Summary

SMART needs to recognize students who transferred INTO the school (transferees). EnrollPro now exposes a dedicated transferee feed (`GET /api/integration/default/smart/transferees`) that tells us who the transferees are and when they enrolled (`enrolledAt`).

**Revised architecture (three pillars):**

1. **Enrichment pass, not a parallel sync.** A transferee is first an enrolled learner — the existing main sync (`runEnrollProSync`) already creates their `Student` + `Enrollment`. The new `syncTransferees()` is a lightweight tagging pass that runs AFTER the main sync and sets `transferInDate` on matching enrollments.
2. **No new `EnrollmentStatus` enum value.** `transferInDate != null` IS the transferee marker. Adding a `TRANSFERRED_IN` enum would silently exclude transferees from every query filtering `status: "ENROLLED"` (promotion, rosters, EOSY, dashboards) — a large, dangerous blast radius.
3. **Registrar completes data, doesn't create records.** The transferee feed omits previous school, TC number, and some demographics (DPA data minimization). The registrar fills these in on students the sync already brought in. Manual Student/Enrollment creation is REJECTED — see §3.1 (prune engine conflict).

### Why the original plan was revised

| Original plan said | Reality (verified) | Consequence |
|---|---|---|
| "Cannot create Student without birthDate/gender" | Both are nullable (schema.prisma:71-72) | Minimal-data students are fine; `dataCompleteness` stats already exist (routes/registrar/main.ts:583-587) |
| zod enum `KINDER`…`GRADE_10` | `GradeLevel` enum is GRADE_7–10 only (schema.prisma:519-524) | Schema wouldn't compile. Grade-7 transferees completed Grade 6 — store as free text |
| "promotion.ts assumes all terms exist" | Already partial-tolerant (promotion.ts:122-125): averages non-null terms, marks PARTIAL; draft blockers only count DRAFT rows (promotion.ts:240-251) | No promotion changes needed — do NOT refactor |
| Add `TRANSFERRED_IN` to enum, recommended | `computeSectionPromotions` filters `status: "ENROLLED"` (promotion.ts:223); dashboard counts, alumni filters, sync dedup also filter status | Enum change breaks everything silently. Use date marker instead |
| `POST /transferees` creates Student+Enrollment | Prune engine (prune.ts) runs every sync cycle and deletes local records not present in EnrollPro (syncCoordinator.ts:253-265) | Manually-created transferees would be deleted within 5 minutes |

---

## 2. Verified Current State

| Feature | Status | Evidence |
|---------|--------|----------|
| Transfer-OUT handling | ✅ Works | `EnrollmentStatus.TRANSFERRED`, `transferOutDate` (schema.prisma:201), alumni page, dashboard stat |
| Transferee API endpoint | ✅ Documented | EnrollPro `GET /api/integration/default/smart/transferees` (see §5) |
| Main sync creates transferee records | ✅ Already happens | Transferees are enrolled learners; `runEnrollProSync` (enrollproSync.ts:143) creates their Student+Enrollment with status ENROLLED |
| `TRANSFERRED_IN` → ENROLLED mapping | ⚠️ Strips transfer context | `mapEpEnrollmentStatus` (enrollproSync.ts:66-76) AND duplicated `classifyEpStatus` (routes/registrar/main.ts:629-639) — two places to keep in sync |
| SF1 T/O + T/I remark codes | ❌ **Dead code** | `mapRemarksCodes` (routes/registrar/helpers.ts:78-89) checks strings `"TRANSFERRED_OUT"` / `"TRANSFERRED_IN"` but `enrollment.status` is the enum (`TRANSFERRED`, not `TRANSFERRED_OUT`) — T/O never renders either. Callers pass DB records: routes/registrar/forms.ts:416, exports.ts:454 |
| SF10 transfer info | ❌ Not covered previously | `buildSf10Records` (lib/sf10.ts:397-410) student block + per-year records (sf10.ts:356-384) expose no transfer fields. Rendered via `GET /forms/sf10/:studentId` (routes/registrar/forms.ts:633) → `SchoolForms.tsx` (viewMode sf10/bulk_sf10) and `AlumniStudents.tsx:165-172` |
| `transferInDate` field | ❌ Missing | schema.prisma:189-214 |
| Previous school / TC fields | ❌ Missing | schema.prisma:64-97 |
| Partial-term promotion | ✅ Already works | promotion.ts:122-125 (PARTIAL averaging), promotion.ts:143-178 |
| EOSY blocked by missing grades | ✅ Not blocked | Draft blockers only count `status: "DRAFT"` rows (promotion.ts:240-251); missing rows are just null |

---

## 3. Design Decisions (DECIDED — do not relitigate without owner approval)

### D1: No `TRANSFERRED_IN` enum value — `transferInDate` is the marker

- "Is this student a transferee?" → `enrollment.transferInDate != null`
- SF1 T/I remark → `transferInDate != null` (any time during the SY)
- "Mid-year transferee" (missing prior terms) → `transferInDate > term1.endDate`
- Existing `status` stays `ENROLLED` → zero changes to promotion queries, dashboards, alumni filters, sync dedup, attendance reports.
- Symmetric with the existing `transferOutDate` design.

### D2: No manual Student/Enrollment creation — EnrollPro is SSOT

The prune engine (`runPruneFromLiveSources`, prune.ts:481) enforces EnrollPro as source of truth every sync cycle (syncCoordinator.ts:253-265). It deletes local enrollments/students not present in the EnrollPro learners feed. A registrar-created Student would be pruned within one cycle.

**Workflow implication:** the registrar enrolls the transferee in EnrollPro first (normal DepEd process — the student needs an EnrollPro record anyway for LRN/ESC/records). SMART picks them up via sync, then the registrar completes the missing details in SMART.

**Rejected alternative (do not implement):** marking local records prune-exempt via a `source: MANUAL` flag. It fights the SSOT architecture and creates drift EnrollPro can never correct. If the owner later demands offline registration, that requires a separate design discussion.

### D3: `syncTransferees()` is a post-main-sync enrichment pass

It never creates Students or Enrollments. It:
1. Fetches the transferee feed (paginated).
2. For each record: resolves Student by LRN, finds their current-SY ENROLLED Enrollment.
3. Sets `transferInDate = enrolledAt` **only if currently null** (never overwrite a registrar-corrected date).
4. Reports records that couldn't be matched (unknown LRN, no enrollment) as warnings for the registrar UI.

### D4: `lastGradeCompleted` is `String?`, not `GradeLevel?`

`GradeLevel` enum is GRADE_7–10 only. A Grade-7 transferee completed Grade 6 — not representable. Free text ("Grade 6", "Grade 6 (Sto. Niño ES)") is correct and SF-form-friendly.

### D5: New routes go in a NEW file

`routes/registrar/main.ts` is 1877 lines (AGENTS.md max is 1000). Create `server/src/routes/registrar/transferees.ts`, mirroring how remedial.ts / forms.ts / eosy.ts are split. Mount it wherever the existing registrar sub-routers are mounted (check how main/forms/eosy/remedial are wired, follow the same pattern).

---

## 4. Phase 1 — Database Changes

### 4.1 `Student` additions (schema.prisma, model at line 64)

```prisma
model Student {
  // ... existing fields ...
  previousSchool      String?   // Name of school transferred from
  lastGradeCompleted  String?   // Free text — see D4. NOT GradeLevel enum.
  transferCertNo      String?   // Transfer Certificate / SF10 reference no.
}
```

### 4.2 `Enrollment` additions (schema.prisma, model at line 189)

```prisma
model Enrollment {
  // ... existing fields ...
  transferInDate  DateTime?   // Set by transferee sync or registrar. Null = not a transferee.
}
```

No `previousSchoolSnapshot` — the existing `profileSnapshot` (schema.prisma:203) already freezes the student profile at enrollment time; add the new Student fields to the snapshot builder instead (§4.4).

### 4.3 No enum changes

`EnrollmentStatus` stays `ENROLLED | PENDING | DROPPED | TRANSFERRED` (schema.prisma:544-549).

### 4.4 Snapshot + change-detection maintenance

- **`studentSnapshot.ts` (`snapshotForDb`):** add the three new Student fields to the snapshot output so **future-year** snapshots (student re-enrolls next SY) carry prior-school info for SF forms.
- **IMPORTANT — frozen snapshots cannot serve current-year transferee data:** `profileSnapshot` is frozen at enrollment time (schema.prisma:203, immutable). The registrar completes `previousSchool` / `transferCertNo` **after** enrollment, so the current year's snapshot will never contain them. SF10 (and any current-year form) must read these fields from the **live `Student` record**, exactly like `name`/`gender`/`birthDate` already do (sf10.ts:397-410). Do not read them from `profileSnapshot`.
- **`enrollproSync.ts` `hashStudentFields` (line 82-104):** do **NOT** add the new fields. This hash covers EnrollPro-sourced fields only; registrar-only fields would never match the EP payload and would break the change-detection/skip logic.

### 4.5 Migration

```bash
cd server
npx prisma migrate dev --name add-transferee-fields
npm run prisma:generate
```

All new fields are nullable — no data migration needed, no default backfill.

**Acceptance:** `npm run build` (server) passes; `npx prisma validate` clean.

---

## 5. EnrollPro Transferee API — Data Mapping (from API doc)

### Endpoint

```
GET /api/integration/default/smart/transferees
Header: x-api-key (same integration key as smart/students)
Query: page (default 1), limit (default 100, max 500)
```

- Returns learners with `learnerType: "TRANSFEREE"` for the **active** school year.
- Includes all enrollment statuses (ENROLLED, DROPPED, TRANSFERRED_OUT…) so status changes flow through.
- Archived SYs return `[]` with a meta message — not an error; treat as empty.
- Data minimization: **no birthDate, no gender, no credentials**.

### Field mapping

| EnrollPro field | Maps to | Notes |
|---|---|---|
| `lrn` | `Student.lrn` | Lookup key (unique) |
| `firstName` / `middleName` / `lastName` / `extensionName` | `Student.*` | Match only; main sync owns writes |
| `gradeLevel.name` | — | Cross-check only (section lookup already done by main sync) |
| `section.id` / `section.name` | — | Same — main sync already created Section + Enrollment |
| `enrolledAt` | `Enrollment.transferInDate` | **The transfer-in date** |
| `enrollmentStatus` | `Enrollment.status` | Only mirror DROPPED/TRANSFERRED_OUT changes if main feed hasn't already |
| `schoolYear.yearLabel` | scope check vs `getActiveSchoolYearLabel()` | Skip records from other years |
| `dropOutDate` / `dropOutReason` / `transferOutDate` | `Enrollment.*` | Same lifecycle pass as main feed (enrollproSync.ts:958-971) — main sync already handles; syncTransferees should NOT duplicate these writes |
| `eosyStatus` | — | Ignore in tagging pass (EOSY is computed locally by promotion.ts) |
| `enrollmentApplicationId` | — | Not stored; log-only correlation |
| `isPendingLrn` | — | If true and LRN looks placeholder, log a warning, skip tagging |

### Explicitly NOT provided (registrar must complete in SMART)

`previousSchool`, `lastGradeCompleted`, `transferCertNo`, `birthDate`, `gender` — the last two may already exist on the Student from the main learners feed; the registrar completion UI flags whichever are still null.

---

## 6. Phase 2 — Backend: Client + Sync

### 6.1 `server/src/lib/enrollproClient.ts` — new fetcher

Add `getSmartTransferees()` directly below `getSmartStudentsFeed()` (line 627-644) and mirror it exactly — same pagination loop (limit 200, walk `meta.totalPages`), same `getIntegrationHeaders()`, same base URL resolution via `getEnrollProBase()`:

```typescript
export async function getSmartTransferees(): Promise<any[]> {
  // Identical pagination loop to getSmartStudentsFeed, endpoint:
  // ${await getEnrollProBase()}/integration/v1/default/smart/transferees
}
```

### 6.2 `server/src/lib/enrollproSync.ts` — new enrichment pass

Add `syncTransferees()` (new export; do not touch `runEnrollProSync` internals):

```
syncTransferees()
├── resolve current SY via getActiveSchoolYearLabel()  (schoolYearResolver.ts:80)
├── records = await getSmartTransferees()
├── for each record where schoolYear.yearLabel === currentSY:
│   ├── lrn = record.lrn.trim(); skip if empty or isPendingLrn
│   ├── student = prisma.student.findUnique({ where: { lrn } })
│   │   └── if null → collect into unmatched[] (registrar visibility), continue
│   ├── enrollment = prisma.enrollment.findFirst({
│   │     where: { studentId, schoolYear: currentSY, status: "ENROLLED" },
│   │     orderBy: { updatedAt: "desc" },   // handles mid-year section moves
│   │   })
│   │   └── if null → unmatched[], continue
│   └── if enrollment.transferInDate == null && record.enrolledAt:
│         prisma.enrollment.update({ data: { transferInDate: new Date(record.enrolledAt) } })
│         (NEVER overwrite an existing transferInDate — registrar may have corrected it)
├── return { transfereesTagged, unmatched: [{lrn, reason}] }
└── fail-soft: catch + log via logger, never throw into the sync cycle
```

Notes:
- Matching `status: "ENROLLED"` only is correct: DROPPED/TRANSFERRED_OUT transferees have already left; the T/I remark should not apply to their final record, and their lifecycle is owned by the existing drop/transfer logic.
- **Do not** also write dropOutDate/transferOutDate here — the main feed lifecycle pass (enrollproSync.ts:958-971) owns those.
- Section moves mid-year: main sync's cross-section dedup (enrollproSync.ts:740-769) deletes the old enrollment and the new one is created; this pass re-tags by (studentId, schoolYear) so `transferInDate` follows the student naturally.

### 6.3 `server/src/lib/syncCoordinator.ts` — wire into the cycle

Call `syncTransferees()` inside the unified cycle immediately after the EnrollPro step, fail-soft (wrap in try/catch like the branding/profile steps). Consider gating it every N cycles using the existing `STUDENT_PROFILE_SYNC_EVERY_N_CYCLES` pattern (syncCoordinator.ts:38) if the feed turns out to be heavy — default: run every cycle, it's a small feed.

Also include the result in `UnifiedSyncResult` (syncCoordinator.ts:58-79) as a new optional `transferees` field so the admin health dashboard can show it.

**Acceptance:** with a real or mocked feed, a student enrolled in EnrollPro as TRANSFEREE gets `transferInDate` set after one sync cycle; nothing else changes; sync never fails when the endpoint 404s/times out (fail-soft verified).

---

## 7. Phase 3 — Backend: Registrar API

### 7.1 New router `server/src/routes/registrar/transferees.ts`

All routes REGISTRAR-only (mirror the role check used in main.ts:606-610), `authenticateToken`, audit-logged via `createAuditLog` (lib/audit.ts) for writes.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/registrar/transferees` | List current-SY transferees (`transferInDate != null`), incl. completion flags |
| `PATCH` | `/api/registrar/transferees/:enrollmentId` | Complete/correct transfer details |
| `POST` | `/api/registrar/transferees/:enrollmentId/tag` | Manually tag an ENROLLED student as transferee (sets `transferInDate`) — for when EnrollPro's `learnerType` wasn't set |

**Query rule (AGENTS.md gotcha):** the list endpoint is a current-year operational view — filtering by `schoolYear` label string is sufficient and required. Never filter by `Enrollment.isArchived` here.

### 7.2 `GET /transferees` response shape

```
{ transferees: [{
    enrollmentId, lrn, studentName, section: { id, name, gradeLevel },
    transferInDate,
    details: { previousSchool, lastGradeCompleted, transferCertNo },
    completeness: { missingBirthDate, missingGender, missingPreviousSchool, missingTransferCertNo },
    matchedBySync: boolean   // transferInDate set by sync (vs registrar)
  }],
  unmatchedFromLastSync: [{ lrn, reason }],   // surfaced from last syncTransferees result
  schoolYear }
```

Completeness derives from null-checks on Student fields — same style as the existing `dataCompleteness` stats (routes/registrar/main.ts:583-587).

### 7.3 `PATCH /transferees/:enrollmentId` — zod schema

Follow the codebase's wrapped zod pattern (see `enrollmentStatusSchema`, schemas/registrar.ts:10-17):

```typescript
export const transfereeUpdateSchema = z.object({
  params: z.object({ enrollmentId: z.string().min(1) }),
  body: z.object({
    previousSchool: z.string().min(1).max(200).optional(),
    lastGradeCompleted: z.string().max(100).optional(),
    transferCertNo: z.string().max(100).optional(),
    birthDate: z.string().datetime().optional(),       // completion of demographics
    gender: z.enum(['MALE', 'FEMALE']).optional(),
    transferInDate: z.string().datetime().optional(),  // registrar correction
  }),
});
```

Route: validate → verify enrollment exists + current SY + belongs to a transferee (or include `transferInDate` in body) → update Student (previousSchool/lastGradeCompleted/transferCertNo/birthDate/gender) and/or Enrollment (transferInDate) in a `prisma.$transaction` (AGENTS.md: multi-step writes use transactions) → `createAuditLog` (action UPDATE, target student LRN).

### 7.4 `POST /transferees/:enrollmentId/tag`

Body: `{ transferInDate: datetime }`. Guards: enrollment must be current-SY and status ENROLLED. Sets `transferInDate` (overwrite allowed here — explicit manual action). Audit-log with tag reason if provided.

### 7.5 `PUT /enrollment/:enrollmentId/status` — no change

The existing status endpoint (routes/registrar/main.ts:1114, `enrollmentStatusSchema` schemas/registrar.ts:7-17) keeps ENROLLED/DROPPED/TRANSFERRED. Transferee-ness is orthogonal to status.

**Acceptance:** `npm run build` passes; manual curl/REST run of all three routes works; audit rows appear.

---

## 8. Phase 4 — SF Forms: SF1 Remarks Fix + SF10 Transfer Info

### 8.1 SF1 remarks (latent bug, fix as part of this feature)

`mapRemarksCodes` (routes/registrar/helpers.ts:78-89) currently compares `enrollment.status` against strings that can never occur (`"TRANSFERRED_OUT"`, `"TRANSFERRED_IN"`) — T/O and T/I remarks are dead code today. Replace with date/enum-driven logic:

```typescript
export function mapRemarksCodes(enrollment: any, student: any): string[] {
  const codes: string[] = [];
  const status = String(enrollment?.status ?? "").toUpperCase();
  if (status === "TRANSFERRED" || enrollment?.transferOutDate) codes.push("T/O");
  if (enrollment?.transferInDate) codes.push("T/I");
  if (status === "DROPPED") codes.push("DRP");
  // ... isBalikAral / is4PsBeneficiary / disability unchanged ...
}
```

Keep the function signature `(enrollment, student)` — callers are routes/registrar/forms.ts:416 and routes/registrar/exports.ts:454, both already pass DB enrollment rows (now including `transferInDate` since it's on the model). Verify both SF1 render paths show T/I for a tagged transferee.

### 8.2 SF10 (Permanent Record) — transfer information

`buildSf10Records` (lib/sf10.ts:47) builds the SF10 payload consumed by `GET /forms/sf10/:studentId` (routes/registrar/forms.ts:633), the bulk SF10 path, and the EnrollPro service-level endpoint (`/api/integration/students/:studentId/sf10-grades`, per sf10.ts:5-6 header).

**Backend changes — `lib/sf10.ts` only** (route passes through; no forms.ts change):

1. **Student block (sf10.ts:397-410)** — add, read from the LIVE `Student` record (see §4.4 warning: frozen `profileSnapshot` won't have registrar-completed values):
   - `previousSchool`, `lastGradeCompleted`, `transferCertNo`
   - `isTransferee` + `transferInDate` (from the student's current/most-recent enrollment)
2. **Per-year `schoolRecords` entries (sf10.ts:356-384)** — add `transferInDate` for that school year (the field lives on each `Enrollment` row and survives rollover archival, so prior-year transfer-ins render on historical SF10s too). `enrollmentForYear` is already resolved at sf10.ts:351 — reuse it.
3. **Extend the `Sf10Response` interface** (sf10.ts:22-45) accordingly.

**Non-issues in sf10.ts (verified — do NOT "fix"):**
- Partial terms: T1/T2/T3 are null-slots, final computed from non-null terms only (sf10.ts:322-325), generalAverage from non-null finals (sf10.ts:338-341). A mid-year transferee renders correctly with blank pre-transfer terms — same partial-tolerant pattern as promotion.
- Canonical enrollment resolution (sf10.ts:71-90) prioritizes `status === 'ENROLLED'` — under D1 transferees stay ENROLLED, so scoring is unaffected.
- Historical queries already filter by schoolYear only — compliant with the AGENTS.md rollover rule.

**Frontend changes:**
- `src/lib/api.ts` — extend `SF10Data` type with the new student-level + per-year fields.
- `src/pages/registrar/SchoolForms.tsx` SF10 view (viewMode `"sf10"` / `"bulk_sf10"`) — render previous school / last grade completed / TC no. in the student header area, and a transfer-in indicator per year row (design: semantic tokens, follow the existing SF10 layout patterns in that file). `AlumniStudents.tsx` needs no change — it stores the same API payload to sessionStorage and routes to SchoolForms for rendering.
- Verify the Excel print path (`templateService.ts` placeholders for SF10): if the official template has an eligibility/transfer block fed by placeholders, map the new fields to the existing placeholder mechanism; if placeholders don't exist for these fields, leave the Excel template unchanged and surface the info in the on-screen view only — template regeneration is out of scope.

### 8.3 What is explicitly OUT of scope for SF10

**Previous-school grades.** A Grade-9 transferee's SF10 should ideally show their Grade 7–8 records from the previous school. SMART has no data source for those grades (EnrollPro transferee feed provides no historical grades, and the DPA-minimized payload won't). Options:
- (a) **Default / recommended:** SF10 shows SMART-local years only. DepEd practice: the receiving school consolidates records from the previous school's SF10 (paper/manual). Registrar keeps the paper TC/SF10 on file — `transferCertNo` gives the paper trail.
- (b) Manual previous-school grade entry in SMART — a separate feature (new model, new UI, EOSY interplay), significant scope. Only if owner demands it.

Do not silently attempt (b).

### 8.4 Status-classification duplication — leave alone

Do not "fix" `classifyEpStatus` (routes/registrar/main.ts:629-639) / `mapEpEnrollmentStatus` (enrollproSync.ts:66-76) mapping TRANSFERRED_IN→ENROLLED — that behavior is now CORRECT under D1 (status stays ENROLLED; the tagging pass records transfer-ness). Optionally add a comment noting the mapping is intentional.

---

## 9. Phase 5 — Frontend (Registrar portal)

### 9.1 New page `src/pages/registrar/Transferees.tsx` — route `/registrar/transferees`

- Page root `space-y-6`, `PageHeader` (title "Transferees", description, sync-status hint).
- **DataTable** (src/components/data-table/) of `GET /transferees` rows: name, LRN, section, transfer-in date, completion badges, row action "Complete details".
- "Unmatched from last sync" callout (LRNs EnrollPro reported that SMART couldn't match — action: trigger sync / verify enrollment).
- Complete-details dialog: form fields per §7.3, react-hook-form + zod, `useMutation` → PATCH; toast on save.
- Design rules: semantic tokens only, no raw palette colors (AGENTS.md banned patterns).

### 9.2 Existing page updates

| Page | Change |
|------|--------|
| `src/pages/registrar/Dashboard.tsx` | StatCard: "Transferees (this SY)" + "Incomplete transferee records" — counts from a small backend addition to the existing dashboard stats endpoint |
| `src/pages/registrar/StudentRecords.tsx` | "Transferee" chip/badge on rows where `transferInDate` set; "Tag as transferee" row action → POST tag |
| `src/layouts/RegistrarLayout.tsx` | Sidebar: "Transferees" → `/registrar/transferees` (follow existing nav item pattern) |
| `src/pages/registrar/components/SF1Form.tsx` | No code change expected — remarks come from backend; verify T/I renders |

### 9.3 `src/lib/api.ts`

Add types + API functions for the three endpoints, following existing axios client patterns.

**Acceptance:** `npm run build` (root) + `npm run lint` pass; full manual flow below works.

---

## 10. Edge Cases & Explicit Non-Issues

### Verified non-issues (do NOT "fix" these)

1. **Partial-term promotion:** `finalizeSubjectRows` averages only non-null terms and marks PARTIAL (promotion.ts:122-125); `evaluatePromotion` counts only subjects with non-null finals (promotion.ts:143-149). A T2 transferee with T2+T3 grades promotes normally.
2. **Partial-term SF10:** subject finals average non-null terms (sf10.ts:322-325), generalAverage uses non-null finals (sf10.ts:338-341). Pre-transfer terms render blank — correct behavior.
3. **EOSY draft blockers:** only `status: "DRAFT"` grade rows block (promotion.ts:240-251). Missing rows (transferee's absent T1) do not block EOSY finalization.
4. **SF10 canonical enrollment:** resolution scores ENROLLED highest (sf10.ts:71-90); transferees remain ENROLLED under D1, so no scoring change needed.
5. **Grade locks:** transferees follow the standard lock precedence (archived → year → term → legacy). No special-casing.
6. **Rollover/archival:** `transferInDate` lives on the Enrollment row and survives `archiveSchoolYear` (rollover.ts:132) untouched. Historical SF queries filter by schoolYear string only (AGENTS.md rule) — prior-year transferees remain visible after rollover.

### Real edge cases to handle/verify

1. **Zero-grade transferee policy (OPEN — needs owner decision):** a student who arrives during T3 and receives no grades hits `graded.length === 0 → RETAINED` (promotion.ts:154-156). DepEd-wise a late transferee with no recorded grades is usually a registrar/admin intervention case, not automatic retention. Options: (a) leave as-is, flag for manual review in EOSY UI; (b) exclude enrollments with `transferInDate` after T2 end from auto-RETAINED and surface them as "NEEDS REVIEW". Default if unanswerable: (a) + warning banner.
2. **SF2 attendance totals:** verify attendance reports don't count pre-enrollment school days as absences for late joiners (check the SF2/totals computation in attendance routes — likely computed from recorded rows, which is safe, but VERIFY).
3. **Teacher class rosters:** a mid-term transferee appears in class records via enrollment; teachers enter grades normally. Verify ClassRecordView roster picks up new enrollees without a cache staleness issue (React Query invalidation on sync SSE — `useSyncStream`).
4. **Mid-year section move of a transferee:** handled by main sync dedup + re-tagging (§6.2). `Enrollment` has `@@unique([studentId, sectionId, schoolYear])` (schema.prisma:210) — a second enrollment for a new section in the same year is only possible after the old one is dropped by dedup; never upsert blindly, always findFirst + conditional create.
5. **`isPendingLrn` records:** skip tagging, surface in unmatched list.
6. **Feed returns archived-SY empty array:** normal — log at debug, not warn.

---

## 11. Implementation Order

1. Phase 1 schema + migration (server) → build
2. Phase 2 client + `syncTransferees` + coordinator wiring → build, manual sync test
3. Phase 3 registrar API (new router file, zod, audit) → build, REST test
4. Phase 4 SF1 remarks fix + SF10 transfer info (§8) → verify SF1 export shows T/I for tagged transferee; verify SF10 (single + bulk + alumni path) renders transfer fields
5. Phase 5 frontend page + dashboard + badges → root `npm run build` + `npm run lint`
6. Full flow smoke test: mark a test student as TRANSFEREE in EnrollPro (or mock) → sync → appears in Transferees page with missing-data badges → registrar completes details → SF1 shows T/I → SF10 shows previous school + transfer-in date → EOSY runs → partial grades promote correctly.

---

## 12. File Change Summary

| File | Action |
|------|--------|
| `server/prisma/schema.prisma` | +3 Student fields (String?), +1 Enrollment field (`transferInDate DateTime?`) |
| `server/src/lib/enrollproClient.ts` | + `getSmartTransferees()` (mirror `getSmartStudentsFeed`, line 627) |
| `server/src/lib/enrollproSync.ts` | + exported `syncTransferees()` enrichment pass (no changes to existing functions) |
| `server/src/lib/syncCoordinator.ts` | wire `syncTransferees()` post-EnrollPro step, fail-soft; + result field in `UnifiedSyncResult` |
| `server/src/lib/studentSnapshot.ts` | include 3 new Student fields in snapshot output |
| `server/src/routes/registrar/transferees.ts` | **NEW** router: GET list, PATCH details, POST tag |
| `server/src/schemas/registrar.ts` | + `transfereeUpdateSchema`, `transfereeTagSchema` (wrapped body/params pattern) |
| `server/src/routes/registrar/helpers.ts` | fix `mapRemarksCodes` dead T/O + T/I logic (§8.1) |
| `server/src/lib/sf10.ts` | extend `Sf10Response` + student block + per-year records with transfer fields (§8.2); read live Student, not profileSnapshot |
| `src/pages/registrar/Transferees.tsx` | **NEW** list + complete-details UI |
| `src/pages/registrar/Dashboard.tsx` | transferee StatCards |
| `src/pages/registrar/StudentRecords.tsx` | transferee badge + tag action |
| `src/pages/registrar/SchoolForms.tsx` | SF10 view: render previous school / last grade completed / TC no. + per-year transfer-in indicator (§8.2) |
| `src/layouts/RegistrarLayout.tsx` | sidebar entry |
| `src/lib/api.ts` | types + API functions for new endpoints; extend `SF10Data` |

Not touched: `promotion.ts`, `rollover.ts`, `enrollproSync.ts` existing functions, `enrollmentStatusSchema`, prune engine.

---

## 13. Guardrails for the Implementer (from AGENTS.md — binding)

- **Read-only EnrollPro.** Never write to EnrollPro/ATLAS. `syncTransferees` only reads the feed and writes to smart_db.
- **Do not refactor unrelated code** (incl. the duplicated `classifyEpStatus` — leave it, comment only if anything).
- **Query rule:** operational views may filter `schoolYear` + status; historical/SF-form queries filter by `schoolYear` string ONLY — never `isActive`/`isArchived`.
- **Zod schemas:** wrapped `{ body, params }` objects, validated via the `validate` middleware.
- **Multi-step writes:** `prisma.$transaction`.
- **Writes to student/grade data:** audit-log via `createAuditLog`.
- **File size:** ≤1000 lines per file; new router file, not additions to main.ts.
- **Frontend:** function components + hooks, React Query patterns, DataTable for lists, PageHeader/StatCard, semantic tokens (`text-foreground` etc.), no inline colors, `space-y-6` page roots.
- **Always run `npm run build`** (root AND server) before finishing; run root `npm run lint` too.
- No comments in code unless asked; English; keep types explicit (no `any` beyond existing feed-record patterns).

---

## 14. Open Questions (owner decision required)

1. **Zero-grade late transferee policy** — see §10.1. Default: leave RETAINED, add EOSY review banner.
2. **Previous-school grades on SF10** — see §8.3. Default: out of scope (paper-based DepEd consolidation; `transferCertNo` provides the paper trail). Manual entry of previous-school grades is a separate future feature.
3. **Should the transferee list page also show DROPPED/TRANSFERRED_OUT transferees** (they left after transferring in)? Default: no — current ENROLLED only; alumni page covers leavers.
4. **Sync cadence for the transferee feed** — every cycle (default) vs cycle-gated. Decide after seeing real feed size.
5. **Dashboard stat placement** — which existing card group the transferee counts join (registrar Dashboard layout owner's call).
6. **SF10 Excel template placeholders** — if the official SF10 template has an eligibility/transfer block with placeholders, map new fields there; otherwise on-screen view only (see §8.2).

---

*Revised 2026-09-04 — codebase-verified; superseded earlier draft (which contained the errors listed in §1). SF10 coverage + snapshot-staleness correction added after SF10 path audit (sf10.ts, forms.ts:633, SchoolForms.tsx, AlumniStudents.tsx).*
