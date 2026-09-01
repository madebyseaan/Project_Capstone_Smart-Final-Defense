# SMART Architecture Q&A — For GLM Investigation

## INVESTIGATION RESULTS (GLM, verified against codebase 2026-08-29)

Supersedes any conflicting claims below.

### RESOLVED: Gap #1 "EOSY push to EnrollPro" — wrong premise, NOT a gap
- The flow is **PULL, not PUSH**. EnrollPro calls SMART:
  `POST /api/integration/smart/sections/:sectionId/sync-grades` — `server/src/routes/integration.ts:71-257` (both alias paths at :256-257)
- Returns per-student quarterly grades, final ratings, GWA, remarks, promotion status. **Only FINALIZED grades are included** (integration.ts:120-121).
- Fully documented in `docs/ENROLLPRO_GRADE_FETCH_API.md` (318 lines, incl. payload schema).
- `enrollproClient.ts` correctly has NO push function — its only POSTs are token acquisition (:95) and login validation (:680). This preserves the AGENTS.md invariant: integrations are read-only; SMART never writes to EnrollPro.
- **Flow 3 above is therefore wrong:** the Finalize button only flips `Grade.status` locally — nothing is pushed at finalize time. EnrollPro pulls later.
- **Open security question:** what authenticates EnrollPro on `sync-grades`? Endpoint has no visible `authenticateToken` — verify the API-key/shared-secret mechanism and document it.

### RESOLVED: Q4-2 — YES, registrar can unfinalize
- `POST /api/registrar/unfinalize-grades` — `server/src/routes/registrar/main.ts:634` (finalize at :566), zod-validated via `finalizeGradesSchema` (`schemas/registrar.ts:19,27`).

### RESOLVED: Gap #5 "Manual sync button" — ALREADY IMPLEMENTED
- Backend: `POST /api/sync/all` (admin-guarded, `routes/sync.ts:26`) + `triggerImmediateSync('manual')` (`lib/syncCoordinator.ts:372`).
- Frontend: "Run Sync Now" button — `src/pages/admin/SystemHealth.tsx:137`. Additional EnrollPro advisory sync trigger: `routes/admin-sub/classAssignments.ts:38`.

### VERIFIED ACCURATE
- Flow 1 (login): local-first, EnrollPro fallback — `routes/auth.ts:55-130`. JWT 15m access (`lib/tokens.ts:9`).
- Flow 2 (grade entry): gradeLock + archived + term checks — `routes/grades-sub/classes.ts:249,291,490`; `createGradeSnapshot` on save — `classes.ts:405,494` (`helpers.ts:344`).
- Endpoint inventory tables (READ from EnrollPro / ATLAS) match `enrollproClient.ts` / `atlasSync.ts` exports.

### STILL OPEN (genuinely unimplemented — see ROLLOVER_READINESS_PLAN.md)
- Gap #2/#3/#10: rollover race condition + finalization guardrail (SMART-side lock-and-alert is the realistic mitigation; EnrollPro-side guardrail requires EnrollPro team).
- Gap #4/Q6: promotion status — included in the `sync-grades` pull payload (computed by SMART), but **not persisted** on `Enrollment` (no `promotionStatus` column today).
- Gap #6: Excel backup of old year before frontend deletion.
- Gap #7: teacher login lock during transition.
- Gap #9: per-year grade lock (`gradeLock` is a system-wide boolean — `schema.prisma:390`).
- Q1-3/Q2-3/Q2-4: EnrollPro-internal behavior — cannot be answered from SMART's code; ask EnrollPro team.
- Q5-1 "Finalize All": only per-section/subject finalization exists; no bulk endpoint.

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EnrollPro (TOP SYSTEM)                       │
│  Source of Truth for:                                               │
│  • Student enrollments (grade level, section, school year)          │
│  • User accounts (login credentials — if not in EP, can't login)   │
│  • Term calendar (T1/T2/T3 start/end dates)                        │
│  • Advisory assignments (teacher → section)                         │
│  • EOSY grades (receives finalized grades from SMART)              │
│  • Rollover (creates new year, promotes students)                   │
│                                                                     │
│  SMART never writes to EnrollPro except:                            │
│  • Push finalized EOSY grades (via Finalize button)                 │
└───────────────┬─────────────────────────┬───────────────────────────┘
                │                         │
         READ from EP               READ from EP
         (students,                  (subjects,
          teachers,                   schedules,
          sections,                   teaching loads)
          terms)
                │                         │
                ▼                         ▼
┌──────────────────────────┐   ┌──────────────────────────────────────┐
│         SMART            │   │              ATLAS                    │
│   Our System:            │   │   Source of Truth for:                │
│   • Stores EP data       │   │   • Subject assignments to teachers   │
│   • Grade calculation    │   │   • Schedule/timetable                │
│   • Attendance tracking  │   │   • Which subjects per grade/section  │
│   • School forms SF1-10  │   │   • Special program subjects         │
│   • Pushes EOSY grades   │   │                                      │
│     back to EnrollPro    │   │   Connects directly to EnrollPro     │
│   • ClassRecord system   │   │   (not through SMART)                │
│   • Partial Registrar    │   │                                      │
└──────────────────────────┘   └──────────────────────────────────────┘
```

---

## Critical Data Flows

### Flow 1: Login

```
Teacher enters email + password
  → SMART checks local DB
  → If no match → SMART calls EnrollPro POST /api/auth/login
  → If EP success → creates/updates local User
  → Issues JWT (15 min access + 7 day refresh)
  → If teacher → triggers async sync (advisory + teaching load from EP + ATLAS)
```

**Gap:** If EnrollPro is down, teacher cannot login. No offline login capability.

---

### Flow 2: Grade Entry (Teacher)

```
Teacher enters scores for student
  → POST /api/grades/grade
  → Checks gradeLock (system-wide boolean)
  → Checks term access (current term only, or approved edit request)
  → Verifies ClassAssignment ownership
  → Calculates: WW PS → PT PS → QA PS → Initial Grade → Transmute → Quarterly Grade
  → Saves Grade record
  → Creates GradeSnapshot (immutable audit trail)
```

**Status:** WORKING

---

### Flow 3: Grade Finalization (Registrar) — CRITICAL

```
Registrar clicks "Finalize" for a section/subject/term
  → POST /api/registrar/finalize-grades
  → Changes Grade.status from DRAFT → FINALIZED
  → SMART pushes finalized grades to EnrollPro
  → EnrollPro can now see the grades
```

**Key Detail:** Finalization is per GRADE LEVEL, per SECTION, per SUBJECT.

**Gap:** Need to verify the exact EnrollPro API endpoint that receives finalized grades.

---

### Flow 4: EOSY Grade Push to EnrollPro — CRITICAL

```
When registrar finalizes grades:
  1. SMART changes Grade.status = FINALIZED
  2. SMART calls EnrollPro API to push grades
  3. EnrollPro receives: student LRN, final average, section, school year
  4. EnrollPro uses this for promotion decisions
```

**Current Status:** NEEDS INVESTIGATION

- The `enrollproClient.ts` has functions to FETCH from EnrollPro EOSY
- Need to verify if there's a function to PUSH grades TO EnrollPro
- If not built, this is a CRITICAL GAP

---

### Flow 5: Rollover — CRITICAL

```
EnrollPro clicks "Rollover" (ANYTIME — SMART has no control)
  │
  ├─→ Creates new SchoolYear in EnrollPro
  ├─→ Promotes students to new grade levels/sections
  ├─→ Old year data status = ?
  │
  ▼
SMART detects new school year (every 5 min sync)
  │
  ├─→ Updates SystemSettings.currentSchoolYear
  ├─→ Fetches new sections, students, enrollments
  │
  ▼
ATLAS assigns teaching loads (after rollover)
  │
  ├─→ New ClassAssignments for new year
  ├─→ New schedule entries
  │
  ▼
SMART fetches new ClassAssignments from ATLAS
  │
  ├─→ Teachers see their new classes
  │
  ▼
SMART is "ready" for new SY
```

**Critical Race Condition:** EnrollPro can rollover BEFORE SMART finalizes grades.

**Guardrail Needed:** SMART must check if all grades are finalized before allowing year transition.

---

### Flow 6: Post-Rollover — Teacher View

```
After rollover completes (EnrollPro + ATLAS done):
  │
  ├─→ Old year classes: DELETED from frontend
  ├─→ Backup: Excel export of old year data (official DepEd records)
  ├─→ New year classes: VISIBLE to teachers
  ├─→ Teacher login: LOCKED until EnrollPro + ATLAS are ready
  │
  └─→ Teachers see their new assignments and can start grading
```

**Gap:** Need Excel backup system for old year data before deletion.

---

## Answers to GLM Investigation Questions

### Q1: What exactly does SMART push to EnrollPro?

**Answer from Sean:**
- Per student, per subject, per term
- Final Average = Finalized grades
- Transmuted grades (T1-T3 are auto-transmuted)
- EnrollPro may pull from SF9 Report Card (official record)

**GLM Needs to Investigate:**
1. What is the exact EnrollPro API endpoint for receiving finalized grades?
2. What's the payload structure expected by EnrollPro?
3. Is it already implemented in `enrollproClient.ts`? Or needs to be built?
4. Does EnrollPro expect SF9 data or just final averages?

---

### Q2: How does EnrollPro handle rollover?

**Answer from Sean:**
- EnrollPro can rollover ANYTIME
- SMART has no control over when
- EnrollPro assigns new grade levels and sections to promoted students
- EnrollPro needs to add guardrail: don't rollover if SMART grades not finalized

**GLM Needs to Investigate:**
1. Does EnrollPro have an API to check if SMART grades are finalized?
2. Can EnrollPro query SMART's grade finalization status?
3. What's the EnrollPro rollover sequence? (create year → assign sections → assign teachers?)
4. Does EnrollPro notify SMART after rollover? Or SMART must poll?

---

### Q3: What happens if EnrollPro rolls over before SMART finalizes?

**Answer from Sean:**
- This is a risk — need guardrail on EnrollPro side
- If it happens, SMART needs a recovery plan
- EnrollPro cannot see grades if not finalized yet

**GLM Needs to Investigate:**
1. If EnrollPro rolls over with unfinalized SMART grades, what happens to those grades?
2. Can EnrollPro still pull unfinalized grades after rollover?
3. What's the recovery procedure if this happens?
4. Should SMART lock grades immediately when it detects rollover?

---

### Q4: Grade finalization workflow

**Answer from Sean:**
- Per grade level, per section, per subject
- Each subject has its own grades
- Registrar finalizes per section/subject combination

**GLM Needs to Investigate:**
1. Is there a "Finalize All" button? Or section-by-section?
2. Can registrar unfinalize if mistake was made?
3. What's the audit trail for finalization?
4. Is there a deadline for finalization?

---

### Q5: Minimum Viable Features for Capstone Demo

**Answer from Sean:**

| Feature | Needed? | Priority |
|---------|---------|----------|
| Grade entry by teacher | YES | CRITICAL |
| Grade finalization by registrar | YES | CRITICAL |
| Push finalized grades to EnrollPro | YES | CRITICAL |
| Auto-detect new school year | YES | HIGH |
| Manual sync button (for demo) | YES | HIGH |
| Archive old year | YES | HIGH |
| Grade locking | YES | HIGH |
| Student promotion tracking | YES | HIGH |
| Teacher historical view | NO | LOW (registrar only) |
| Excel backup of old year data | YES | MEDIUM |
| Teacher login lock during transition | YES | MEDIUM |

---

## Gaps Requiring GLM Investigation

### CRITICAL GAPS

| # | Gap | Question for GLM |
|---|-----|------------------|
| 1 | **EOSY grade push to EnrollPro** | Is this implemented? What's the API endpoint? What's the payload? |
| 2 | **Rollover race condition** | How to prevent EnrollPro from rolling over before SMART finalizes? |
| 3 | **Grade finalization before rollover** | What happens if grades are DRAFT when rollover occurs? |
| 4 | **Promotion status push** | Does SMART send promotion status to EnrollPro? Or does EnrollPro compute it? |

### HIGH PRIORITY GAPS

| # | Gap | Question for GLM |
|---|-----|------------------|
| 5 | **Manual sync button** | Implement for capstone demo — triggers immediate EnrollPro + ATLAS sync |
| 6 | **Excel backup system** | Export old year data to Excel before deleting from frontend |
| 7 | **Teacher login lock** | Lock teacher login if EnrollPro/ATLAS not ready after rollover |
| 8 | **Auto-detect rollover** | Detect new school year from EnrollPro sync, update SystemSettings |

### MEDIUM PRIORITY GAPS

| # | Gap | Question for GLM |
|---|-----|------------------|
| 9 | **Grade lock per year** | Replace system-wide boolean with per-year locking |
| 10 | **EOSY finalization guardrail** | Block rollover if grades not finalized (EnrollPro side) |
| 11 | **Promotion status tracking** | Store promotion status on Enrollment record |
| 12 | **Historical data access** | Registrar can view past year data (teacher view not needed yet) |

---

## EnrollPro API Endpoints — Current vs Needed

### Currently Implemented (READ from EnrollPro)

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/api/auth/login` | Teacher login validation | IMPLEMENTED |
| `/api/teachers` | Fetch all teachers | IMPLEMENTED |
| `/api/sections` | Fetch all sections | IMPLEMENTED |
| `/api/students` | Fetch students per section | IMPLEMENTED |
| `/api/school-years` | Fetch available school years | IMPLEMENTED |
| `/api/settings/public` | Fetch branding (logo, colors) | IMPLEMENTED |
| `/api/integration/v1/school-year` | Fetch active school year | IMPLEMENTED |
| `/api/integration/v1/active-term` | Fetch active term (T1/T2/T3) | IMPLEMENTED |
| `/api/integration/v1/learners` | Fetch all enrolled learners | IMPLEMENTED |
| `/api/integration/v1/sections` | Fetch all sections | IMPLEMENTED |
| `/api/integration/v1/faculty` | Fetch all faculty | IMPLEMENTED |
| `/api/eosy/sections` | Fetch EOSY sections | IMPLEMENTED |
| `/api/eosy/sections/:id/records` | Fetch EOSY records | IMPLEMENTED |
| `/api/eosy/sections/:id/exports/sf5` | Fetch EOSY SF5 | IMPLEMENTED |
| `/api/eosy/exports/sf6` | Fetch EOSY SF6 | IMPLEMENTED |

### NEEDS INVESTIGATION (PUSH to EnrollPro)

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `???` | Push finalized grades | **NOT SURE IF IMPLEMENTED** |
| `???` | Push promotion status | **NOT SURE IF IMPLEMENTED** |
| `???` | Signal "EOSY Ready" | **NOT IMPLEMENTED** |
| `???` | Query rollover status | **NOT IMPLEMENTED** |

**GLM Action:** Investigate EnrollPro API documentation to find:
1. Which endpoint receives finalized grades from SMART
2. What payload structure it expects
3. Whether SMART already has this implemented
4. Whether there's a callback/webhook mechanism (Sean says no, but verify)

---

## ATLAS API Endpoints — Current

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/faculty?schoolId=` | Fetch all faculty | IMPLEMENTED |
| `/faculty-assignments/:id` | Fetch faculty assignments | IMPLEMENTED |
| `/faculty-assignments/summary` | Fetch teaching load summary | IMPLEMENTED |
| `/faculty/advisers` | Fetch section advisers | IMPLEMENTED |
| `/subjects?schoolId=` | Fetch all subjects | IMPLEMENTED |
| `/subjects/stats/:schoolId` | Fetch subject coverage | IMPLEMENTED |
| `/schools/:id/schedules/published` | Fetch published schedule | IMPLEMENTED |

**Note:** ATLAS connects directly to EnrollPro (not through SMART). SMART fetches from ATLAS after ATLAS has synced with EnrollPro.

---

## Recommended Implementation Order

### Phase 1: Capstone Demo Ready (2 days)
1. Manual sync button (force immediate EnrollPro + ATLAS sync)
2. Verify EOSY grade push to EnrollPro is working
3. Test full flow: grade entry → finalize → push to EnrollPro

### Phase 2: Rollover Guardrails (3 days)
1. Auto-detect new school year from EnrollPro sync
2. Check grade finalization status before allowing year transition
3. Lock grades for old year after transition
4. Excel backup of old year data

### Phase 3: Production Ready (5 days)
1. Per-year grade locking (replace system-wide boolean)
2. Promotion status tracking
3. Teacher login lock during transition
4. Historical data access for registrar
5. Data retention policy

---

## Questions for GLM to Investigate

1. **EnrollPro EOSY API:** What endpoint receives finalized grades from SMART? Is it already implemented?
2. **EnrollPro Rollover Sequence:** What's the exact order of operations during rollover?
3. **EnrollPro Guardrails:** Can EnrollPro check SMART's finalization status before rolling over?
4. **ATLAS Timing:** How long after EnrollPro rollover does ATLAS complete teaching load assignment?
5. **Grade Finalization:** Can registrar unfinalize grades if mistake was made?
6. **Promotion Logic:** Does EnrollPro compute promotion status, or does SMART send it?
7. **SF9 as Source of Truth:** Does EnrollPro pull from SF9 data, or just final averages?

---

*Document created: 2026-08-29*
*Purpose: GLM investigation of microservices architecture gaps*
