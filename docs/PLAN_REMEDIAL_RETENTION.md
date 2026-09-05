# Remedial & Retention Logic — Implementation Plan (v2)

> **Status:** PLANNING ONLY — do not implement until approved.

## 1. DepEd Policy Summary (DO 8, s. 2015 + DO 13, s. 2018)

### Grades 1-10 (JHS) Promotion Rules:

| Failing Subjects | EOSY Status | Action | Next Grade? |
|---|---|---|---|
| 0 | `PROMOTED` | None | ✅ Yes |
| 1-2 | `CONDITIONALLY_PROMOTED` | Must take remedial classes | ✅ Yes (if RFG ≥ 75) |
| 3+ | `RETAINED` | Repeat same grade level | ❌ No |
| No grades | `RETAINED` | Repeat same grade level | ❌ No |

### Remedial Class Flow (happy path):
1. Student fails 1-2 subjects (final grade < 75)
2. EOSY finalization → status = `CONDITIONALLY_PROMOTED`, remedial records auto-created
3. Student takes remedial classes (summer / after EOSY)
4. Remedial teacher gives **Remedial Class Mark (RCM)** per subject
5. **Recomputed Final Grade (RFG)** = (Final Rating + RCM) / 2 — per subject
6. All RFG ≥ 75 → student confirmed promoted to next grade
7. Any RFG < 75 → **see §2.3 RFG < 75 Decision Matrix** (status transition required)
8. **Certificate of Recomputed Final Grade** issued → attached to SF10

### Retention Flow:
1. Student fails 3+ subjects (final grade < 75)
2. EOSY: status = `RETAINED`, `promotedToGradeLevel` = same grade
3. Student repeats the **entire grade level** next SY (all subjects retaken)
4. New `Enrollment` created next SY by EnrollPro (same gradeLevel)
5. SF10 shows both years as separate tables (already fixed — see §2.1)

---

## 2. Critical Design Decisions (NEW — must resolve before coding)

### 2.1 RFG < 75 Outcome — Status Transition Matrix

When registrar completes remedial and any subject RFG < 75:

| Scenario | `promotionStatus` | `promotedToGradeLevel` | Rationale |
|---|---|---|---|
| All RFG ≥ 75 | `PROMOTED` (upgraded from CONDITIONALLY_PROMOTED) | next grade | Remedial passed — full promotion |
| Any RFG < 75, school elects DO 13 tutorial path | `CONDITIONALLY_PROMOTED` (kept) | next grade | DO 13, s. 2018 §19: enroll next grade w/ tutorial services |
| Any RFG < 75, school elects strict path | `RETAINED` (downgraded) | same grade | DO 8, s. 2015 original rule |

**Decision required (user):** Which default? Recommendation: **DO 13 tutorial path** (keep `CONDITIONALLY_PROMOTED`, add `remedialOutcome: "FAILED_TUTORIAL"` flag on records). Registrar gets a per-student override toggle when completing remedial.

**Implementation impact:** Completing remedial is a **write to Enrollment** (`promotionStatus`, `promotedToGradeLevel`) — must run in a Prisma transaction with audit log.

### 2.2 EnrollPro Boundary (READ-ONLY constraint)

Per AGENTS.md non-negotiable: EnrollPro is read-only. Grades sync TO EnrollPro exists elsewhere, but:

- **Remedial records live ONLY in SMART** (new `RemedialClass` table) — never pushed to EnrollPro
- If EnrollPro's `/remedial/pending` feed already lists these learners (current RemedialTracker source), treat it as **display-only reference**. SMART's local table becomes source of truth for SF10
- Risk: EnrollPro's promotion decision for next-SY enrollment may disagree with SMART's post-remedial status. Mitigation: SMART's `Enrollment.promotionStatus` is what SF10/SF5 read; EnrollPro re-enrollment creates a NEW enrollment row regardless — no conflict at data level, only cosmetic in dashboards
- **Action:** Document in code comment + this plan that remedial outcomes are SMART-local

### 2.3 EOSY Auto-Create — Correct Data Source

`computeSectionPromotions()` returns `subjects: SubjectFinalRow[]` per enrollment. The failing list must be derived **inside `finalizeSectionEosy`'s existing transaction**:

```typescript
// Pseudocode — inside the per-student loop, after decision computed
const failingRows = ep.subjects.filter(
  (r) => r.finalRating !== null && r.finalRating < PASSING_GRADE
);
if (ep.decision.promotionStatus === "CONDITIONALLY_PROMOTED") {
  for (const row of failingRows) {
    remedialCreates.push({ studentId, enrollmentId, schoolYear, gradeLevel,
      subjectCode: row.subjectCode, subjectName: row.subjectName,
      originalGrade: row.finalRating, status: "PENDING" });
  }
}
// createMany inside the SAME prisma.$transaction — atomic with snapshots + status writes
```

Note: rotation subjects are already merged before `evaluatePromotion`, so failing rows are canonical (e.g., "TLE" not 3 TLE specs). No double-rows.

### 2.4 Historical Backfill (existing CONDITIONALLY_PROMOTED enrollments)

Past years already finalized have no `RemedialClass` rows. Options:

| Option | Pros | Cons |
|---|---|---|
| A: No backfill — blank remedial section for old years | Zero risk | SF10 for past years shows empty remedial (acceptable — most were never remediated) |
| B: One-time backfill script from live Grade rows | Complete history | Risky write to archived years; needs dry-run |

**Recommendation: Option A.** Old SF10s stay as-is; new EOSY cycles get records. Revisit only if registrar reports a past student needing a printed remedial entry — then a manual "add remedial record" endpoint (registrar-only) covers it.

### 2.5 Rollback / Unfinalize

EOSY unfinalize (`unfinalizeSectionEosy` path) must `deleteMany({ where: { enrollmentId: { in: [...] } } })` on `RemedialClass` — otherwise orphaned PENDING rows linger and re-finalize hits the unique constraint. Include in same transaction as unfinalize.

---

## 3. Current SMART Implementation

### ✅ Already Implemented:
| Component | File | Status |
|---|---|---|
| Promotion logic (0/1-2/3+) | `promotion.ts:135-170` | ✅ Working |
| `PROMOTED` / `CONDITIONALLY_PROMOTED` / `RETAINED` / `JHS_COMPLETER` | `promotion.ts:149-161` | ✅ Working |
| `promotedToGradeLevel` field | `Enrollment` model | ✅ Working |
| SF10 full history for retained students (filter fix) | `forms.ts:690-695` | ✅ Fixed this session |
| SF10 remedial table markup (placeholder rows) | `SchoolForms.tsx:952-968` | ✅ Exists — populate, don't rebuild |

### ❌ Not Implemented:
| Component | Location | Status |
|---|---|---|
| `RemedialClass` model | `schema.prisma` | ❌ No model |
| Remedial CRUD API | — | ❌ |
| Auto-create on EOSY | `promotion.ts` finalizeSectionEosy | ❌ |
| RFG computation + status transition | — | ❌ |
| SF10 remedial data feed | `forms.ts:940` returns `remedialClasses: []` | ❌ |
| Interactive RemedialTracker | `RemedialTracker.tsx` | ❌ Read-only EnrollPro view |
| Certificate of Recomputed Final Grade | — | ❌ |
| Zod schemas / audit logging for remedial | — | ❌ |

---

## 4. Database Schema (`server/prisma/schema.prisma`)

```prisma
model RemedialClass {
  id              String    @id @default(cuid())
  enrollmentId    String    // enrollment where student was CONDITIONALLY_PROMOTED
  schoolYear      String    // SY remedial conducted (usually the failed SY's summer)
  gradeLevel      GradeLevel

  subjectCode     String
  subjectName     String
  originalGrade   Float     // failing Final Rating (e.g., 65)

  remedialMark    Float?    // RCM — null until completed
  recomputedGrade Float?    // RFG = (originalGrade + remedialMark) / 2 — auto
  outcome         String?   // PASSED | FAILED_TUTORIAL | FAILED_RETAINED (per subject, set on completion)

  conductedFrom   DateTime?
  conductedTo     DateTime?

  status          String    @default("PENDING") // PENDING | COMPLETED

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  enrollment      Enrollment @relation(fields: [enrollmentId], references: [id])

  @@unique([enrollmentId, subjectCode]) // enrollmentId implies studentId
  @@index([status])
}
```

- **Unique:** `enrollmentId + subjectCode` (studentId derivable via relation — avoids the 3-col constraint from v1)
- **`outcome` per-subject** supports §2.1 decision matrix without extra table
- Migration: additive only → safe `prisma migrate dev --name add_remedial_class`

---

## 5. Backend Changes

### 5.1 New Routes — `server/src/routes/registrar/remedial.ts`

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/registrar/remedial/pending?schoolYear=&gradeLevel=` | REGISTRAR | Students with CONDITIONALLY_PROMOTED + their remedial rows (joins Student, Enrollment, Section) |
| `PATCH` | `/api/registrar/remedial/:id` | REGISTRAR | Update single remedial row (RCM, dates) — Zod validated |
| `POST` | `/api/registrar/remedial/:enrollmentId/complete` | REGISTRAR | Transaction: compute RFGs → set outcomes → **update Enrollment.promotionStatus** per §2.1 → audit log |
| `POST` | `/api/registrar/remedial/:enrollmentId/manual-create` | REGISTRAR | Escape hatch for backfill (§2.4 Option A) |
| `GET` | `/api/registrar/remedial/:enrollmentId/certificate` | REGISTRAR | Certificate of Recomputed Final Grade data (print-ready JSON) |

**Rules (AGENTS.md compliance):**
- Routes thin — logic in `server/src/lib/remedial.ts` (new): `computeRfg()`, `completeRemedial()`, `buildCertificate()`
- **Zod schemas** in `server/src/schemas/remedial.ts` (new): RCM bounds 60–100, dates `conductedTo >= conductedFrom`, status enum
- **Audit log** every mutation via existing `lib/audit.ts` (`action: "REMEDIAL_UPDATE" | "REMEDIAL_COMPLETE"`)
- Registrar-only via `authorizeRoles(["REGISTRAR"])` — same pattern as other registrar routes
- Central error handling — no try/catch business logic in routes

### 5.2 Update EOSY Finalization — `server/src/lib/promotion.ts`

Inside `finalizeSectionEosy` transaction (see pseudocode §2.3):
- After writing `promotionStatus` per enrollment, if `CONDITIONALLY_PROMOTED` → `remedialClass.createMany(failingRows)`
- **Atomicity:** same `prisma.$transaction` — if any snapshot/remedial write fails, all roll back

### 5.3 Update Unfinalize — same file

Delete remedial rows for unfinalized enrollments (§2.5) inside the unfinalize transaction.

### 5.4 Update SF10 — `server/src/routes/registrar/forms.ts`

Replace `remedialClasses: []` (line 940):

```typescript
const remedialRows = await prisma.remedialClass.findMany({
  where: { enrollment: { studentId, schoolYear: year.schoolYear } },
});
// map → { subjectName, originalGrade, remedialMark, recomputedGrade,
//         conductedFrom, conductedTo, status, outcome }
```

Query filters by `schoolYear` string only (AGENTS.md historical-query rule — never isArchived).

---

## 6. Frontend Changes

### 6.1 RemedialTracker.tsx — Rewrite

```
┌────────────────────────────────────────────────────────────┐
│ Remedial Tracker                                       🔄   │
│ [Total: 15] [Pending: 10] [Completed: 5]                   │
├────────────────────────────────────────────────────────────┤
│ ▶ LRN   │ Name            │ Grd/Sec │ Failed │ Status      │
├─────────┼─────────────────┼─────────┼────────┼─────────────┤
│ ▶ 1234  │ Dela Cruz, Juan │ 7-A     │ 2 subj │ PENDING     │
└─────────┴─────────────────┴─────────┴────────┴─────────────┘
  ↓ click expands (inline panel, not modal)
┌────────────────────────────────────────────────────────────┐
│ Dela Cruz, Juan — G7-A — SY 2024-2025                      │
│ Conducted from: [date] to: [date]                          │
│ Learning Area │ Final Rating │ RCM [input] │ RFG │ Outcome │
│ Mathematics   │ 65 (locked)  │ [80]        │ 72.5│ ❌      │
│ English       │ 70 (locked)  │ [75]        │ 72.5│ ❌      │
│ [Save Draft]  [Complete → transitions status per §2.1]    │
│ [🖨 Print Certificate] (enabled when COMPLETED)            │
└────────────────────────────────────────────────────────────┘
```

- Final Rating **locked** (from DB) — no manual entry, no 73→75 tampering via this screen
- RFG live-computed client-side, re-validated server-side
- Complete button calls `/complete` → confirmation dialog spelling out the status transition (per §2.1 matrix) before write
- Keep EnrollPro pending list as secondary reference tab (read-only)
- API client additions in `src/lib/api.ts`: `getRemedialPending`, `updateRemedialRow`, `completeRemedial`, `getRemedialCertificate`

### 6.2 SchoolForms.tsx — SF10

**Populate existing placeholder** (lines 952-968 already render the table shell):
- Map `record.remedialClasses` → rows (Learning Areas | Final Rating | RCM | RFG)
- Show "Conducted from/to" above table from first row's dates
- Empty state: leave blank rows (matches DepEd form — blank when no remedial)

---

## 7. Implementation Order

| # | Task | Files |
|---|---|---|
| 1 | Schema + migrate | `schema.prisma` |
| 2 | Zod schemas + lib logic (`computeRfg`, `completeRemedial`, audit) | `schemas/remedial.ts`, `lib/remedial.ts` |
| 3 | EOSY auto-create + unfinalize cleanup | `lib/promotion.ts` |
| 4 | Remedial CRUD routes | `routes/registrar/remedial.ts`, `main.ts` (register) |
| 5 | SF10 data feed | `routes/registrar/forms.ts` |
| 6 | RemedialTracker rewrite + api client | `RemedialTracker.tsx`, `lib/api.ts` |
| 7 | SF10 rendering | `SchoolForms.tsx` |
| 8 | Certificate endpoint + print view | lib + frontend print |
| 9 | Tests: promotion-with-remedial unit, complete-transition, unfinalize cleanup | `__tests__/` |
| 10 | `npm run build` + backend `npm run build` verify | — |

---

## 8. Files to Modify

| File | Type | Change |
|---|---|---|
| `server/prisma/schema.prisma` | Add | `RemedialClass` model |
| `server/src/schemas/remedial.ts` | New | Zod validation |
| `server/src/lib/remedial.ts` | New | RFG logic, complete transition, certificate builder |
| `server/src/lib/promotion.ts` | Update | Auto-create in finalize; delete in unfinalize |
| `server/src/routes/registrar/remedial.ts` | New | 5 endpoints |
| `server/src/routes/registrar/main.ts` | Update | Register routes |
| `server/src/routes/registrar/forms.ts` | Update | SF10 remedial feed |
| `src/pages/registrar/RemedialTracker.tsx` | Rewrite | Interactive tracker |
| `src/pages/registrar/SchoolForms.tsx` | Update | Populate existing remedial table |
| `src/lib/api.ts` | Update | 4 new client methods |

---

## 9. Open Questions (blocking)

1. **§2.1 default when RFG < 75:** DO 13 tutorial path (recommended) or strict retention? Per-student override needed either way?
2. **Who enters RCM:** registrar only, or also the subject teacher (would need teacher-side endpoint + role)?
3. **Certificate:** plain print view in browser, or Excel/xlsx template like other SF forms (TemplateManager pattern)?

## 10. Non-Goals

- No auto-bumping 73→75 (teacher's grade entry stays as-is)
- No EnrollPro writes (read-only integration)
- No backfill of historical years (§2.4 Option A)
- No changes to retention logic for 3+ failures (already correct)

---

## 11. Testing Checklist

- [ ] EOSY 0 failing → PROMOTED, no remedial rows
- [ ] EOSY 1-2 failing → CONDITIONALLY_PROMOTED + N remedial rows (N = failing count)
- [ ] EOSY 3+ failing → RETAINED, no remedial rows
- [ ] Rotation subject failed → ONE remedial row (merged, not per-spec)
- [ ] Unfinalize → remedial rows deleted; re-finalize recreates cleanly
- [ ] Complete w/ all RFG ≥ 75 → Enrollment upgraded to PROMOTED + audit entry
- [ ] Complete w/ any RFG < 75 → status per §2.1 chosen default + audit entry
- [ ] RCM validation rejects < 60 / > 100 / non-numeric
- [ ] SF10 shows remedial rows under correct school-year table; blank when none
- [ ] Retained student next-SY: SF10 shows both year tables (regression from this session's filter fix)
- [ ] Builds pass: frontend `npm run build`, backend `npm run build`
