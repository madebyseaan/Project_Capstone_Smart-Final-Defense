# SMART Rollover Readiness Plan

## Executive Summary

SMART is a DepEd school management system for Junior High School (Grades 7-10). It integrates with EnrollPro as the upstream source of truth for students, teachers, sections, and school years. When EnrollPro triggers a school year rollover, SMART must:

1. **Preserve** all historical data (grades, enrollments, attendance)
2. **Detect** the new school year from EnrollPro
3. **Sync** new sections, students, and teachers
4. **Lock** old year data from edits
5. **Allow** grading in the new year
6. **Track** student promotion/retention outcomes

**Current Status:** ~60% ready. Database schema supports multi-year data, but automated rollover workflow is not implemented.

---

## Architecture Context

### Data Flow During Rollover

```
EnrollPro "Rollover" Button
  │
  ├─→ Creates new SchoolYear record in EnrollPro
  ├─→ Creates new Sections with new students
  ├─→ Updates student grade levels (Grade 7→8, 8→9, 9→10)
  │
  ▼
SMART Branding Sync (hourly)
  │
  ├─→ Detects new activeSchoolYear from EnrollPro
  ├─→ Calls ensureSchoolYearFromEnrollPro() to create/update local record
  ├─→ Updates SystemSettings.currentSchoolYear
  │
  ▼
SMART EnrollPro Sync (every 5 minutes)
  │
  ├─→ Syncs new Sections (upsert by name+gradeLevel+schoolYear)
  ├─→ Syncs new Students (upsert by LRN)
  ├─→ Syncs new Enrollments
  ├─→ Syncs new ClassAssignments
  │
  ▼
SMART Teacher Sync (on login)
  │
  ├─→ Resolves advisory section for new year
  ├─→ Fetches students for teaching sections
  │
  ▼
Admin Actions
  │
  ├─→ Archives old year data (POST /admin/archive-year)
  ├─→ Locks grades (gradeLock=true)
  ├─→ Creates ClassAssignments for new year
```

### Key Database Tables

| Table | Year-Scoped? | Notes |
|-------|-------------|-------|
| `SchoolYear` | N/A | Year records with status (DRAFT/ACTIVE/ARCHIVED/COMPLETED) |
| `SystemSettings` | N/A | Single row with `currentSchoolYear` string + `schoolYearId` FK |
| `Section` | Yes | `schoolYear` string field, unique per name+gradeLevel+schoolYear |
| `ClassAssignment` | Yes | `schoolYear` string field, unique per teacher+subject+section+year |
| `Enrollment` | Yes | `schoolYear` string field, unique per student+section+year |
| `Grade` | Indirect | Linked via `classAssignment.schoolYear` |
| `GradeSnapshot` | Yes | `schoolYear` string field, immutable grade records |
| `Attendance` | Indirect | Linked via `sectionId` → `Section.schoolYear` |
| `GradeEditRequest` | Yes | `schoolYear` string field |

### Current Gaps

1. **No automated rollover** — Fully delegated to EnrollPro
2. **System-wide grade lock** — Single boolean, not per-year
3. **Hardcoded fallbacks** — `"2026-2027"` strings in production code
4. **No student promotion tracking** — Computed but never persisted
5. **No JHS completer handling** — Grade 10 graduation path missing
6. **No data retention policy** — AuditLog/SyncHistory grow indefinitely

---

## Review Corrections (v2) — READ FIRST

Critical fixes to the phases below. Where a correction conflicts with a phase section, the correction wins.

### CRITICAL — Logic Bugs

- **§3.2 Auto-lock locks the whole YEAR at any term end — WRONG.** Curriculum has **3 terms (T1–T3)**; locking the year after T1 ends blocks T2/T3 grading. Lock per-term, and only auto-lock the *year* when the **final term (T3)** of the SY ends. Keep the existing scheduler behavior per AGENTS.md (scheduler only handles grade locking; `resolveCurrentTerm()` remains the only writer of term state).
- **§6.2 Promotion counts each term grade as a subject — WRONG.** `subjectFinals = grades.map(g => g.quarterlyGrade)` counts T1/T2/T3 of one subject as 3 entries. Must first compute a **per-subject final grade across the 3 terms**, then count failing subjects (< 75). Filter must use the subject's promotional flag (verify `Subject` model), not a hardcoded `'HG'` prefix.
- **§5.1 `req.user?.id` does not exist** in a scheduled/hourly sync — there is no request. Use `'system-branding-sync'`.
- **§5.1 Auto-archive is dangerous without a guardrail.** Never auto-archive if the previous year's **EOSY finalization (GradeSnapshots) is incomplete** — instead: lock the old year, keep it ACTIVE-flagged for admin attention, emit SSE + audit log, and surface in Admin Dashboard. Archiving unfinalized data silently freezes incomplete grades forever.
- **§6.3 EOSY finalize must create GradeSnapshots** (immutable, per student) *before* writing `promotionStatus`. SF10 reads snapshots; promotion without snapshot breaks historical reprints. Also: wrap in a transaction (currently N+1 + non-transactional), add REGISTRAR role guard, zod-validate `{ sectionId, schoolYear }`, and make idempotent (re-finalize = recompute + overwrite, not duplicate).

### Correctness / Consistency

- **§2.3 making `schoolYearId` required is a breaking migration.** Order must be: (1) add nullable FK + migrate, (2) backfill (§10.2 script moves to Phase 2), (3) add NOT NULL constraint in a follow-up migration. The current phase order deploys required-FK code before backfill exists.
- **§2.1 `@@index([schoolYearId])` is redundant** — `@@unique` already creates an index. Drop it.
- **§4.1 resolve the active year label ONCE** (code calls `getActiveSchoolYearLabel()` twice). `isViewOnly` is a UI hint only — actual enforcement is the §3 per-year lock returning 403 on save. State this explicitly so frontend-only enforcement is never assumed safe.
- **§4.1 + §5.2 conflict:** Phase 5 sets `classAssignment.isActive = false` and `enrollment.isArchived = true` for the old year, but Phase 4 historical queries must still return those rows. Historical queries must filter by `schoolYear` only (ignore `isActive`/`isArchived`) — audit every existing query that filters on `isActive` before shipping Phase 5.
- **§5.1 single-writer rule:** school-year resolution logic belongs in `schoolYearResolver.ts` (it already exists and warns against `?? "2026-2027"` patterns — verified at `server/src/lib/schoolYearResolver.ts:30`). Branding sync should *call* the resolver, not duplicate detection logic inline. Wrap the rollover step in a transaction + Postgres advisory lock so two overlapping hourly syncs can't double-archive.
- **§6.2 Grade 10 + conditional:** decide and document the `JHS_COMPLETER` + 1–2 failing subjects case (DepEd allows completion with conditions). Current code marks any G10 with 0 fails as completer and everything else falls through to CONDITIONALLY_PROMOTED/RETAINED — the completer-with-conditions path is unhandled.

### Scope / Verification Updates

- **§1.1 add:** `server/prisma/seed-grades-fresh.ts:207` (same hardcoded `?? "2026-2027"` — verified). Test fixtures using `2026-2027` in `__tests__/sf10-snapshot.test.ts` are fine (fixture data, not logic).
- **§1.2 verified:** 13 files carry local grade-level maps (grep-confirmed list matches, plus variants in `StudentRecords.tsx` `"7": "Grade 7"` and `BOSYQueue.tsx` inline options). Extract to shared `constants.ts` and import everywhere.
- **§3.3** add: zod-validate `{ locked: boolean }` body, 404 unknown year, audit-log every toggle, transaction.
- **§7.2 snapshot cleanup is O(n) memory + row-by-row deletes** — replace with batched SQL keep-latest (window function `ROW_NUMBER() OVER (PARTITION BY "studentId", "schoolYear" ORDER BY "createdAt" DESC)`), log deletion counts to audit. Also flag: 5-year retention of learner records must be confirmed against DepEd records-retention policy before enabling — default it OFF.
- **§8.3 test commands are aspirational** — AGENTS.md lists no `npm test` script for server; existing tests hit a live server via `fetch`. Replace with the actual runner command once confirmed; keep rollover tests as integration-style (same pattern as `sf10-snapshot.test.ts`).
- **§9.2 verify first:** confirm which routes are actually missing from `App.tsx` before adding (don't add duplicates).
- **§10.2 backfill row-by-row updates won't scale** to production row counts — batch per table using raw SQL `UPDATE ... FROM` against a label→id map, add `--dry-run` mode (prints counts only), progress logging, and a post-run verification query (counts of remaining `schoolYearId IS NULL` must be 0). Backfill runs after nullable-FK migration, before NOT NULL constraint, before app code relying on FKs deploys.
- **§10 add explicit rollback plan:** pre-deploy DB backup + restore procedure, down-migration for each new migration, and a "repoint `SystemSettings.schoolYearId` to previous year" step if rollover misfires. Coordinate timing with the EnrollPro team (their rollover button triggers ours).

### Effort / Ordering Updates

- Corrected critical path: **Phase 1 → Phase 2 (nullable FK + backfill) → Phase 2b (NOT NULL constraint) → Phase 3 → Phase 5 → Phase 6 → Phase 8 → Phase 10**. Add ~1–2 days for guardrails + snapshot-on-EOSY → **17–21 days total**.
- New risk (add to Risk table): *Rollover fires while EOSY unfinalized* — HIGH — guardrail above (lock + alert, no auto-archive).

---

## Phase 1: Fix Hardcoded Data

**Goal:** Remove all hardcoded school year strings, extract duplicated constants.

### 1.1 Replace Hardcoded School Year Fallback

**Problem:** `server/src/routes/grades-sub/editRequests.ts:62` uses `"2026-2027"` as fallback.

**Before:**
```typescript
schoolYear: settings?.currentSchoolYear ?? "2026-2027",
```

**After:**
```typescript
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
// ...
schoolYear: await getActiveSchoolYearLabel(),
```

**Files to change:**
- `server/src/routes/grades-sub/editRequests.ts` (line 62)
- `src/pages/registrar/EOSYFinalization.tsx` (line 192)

### 1.2 Extract Grade Level Constants

**Problem:** `GRADE_LEVEL_MAP` is copy-pasted in 12 files.

**Create shared constant:**
```typescript
// src/lib/constants.ts
export const GRADE_LEVEL_MAP: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

export const GRADE_LEVELS = Object.keys(GRADE_LEVEL_MAP);

export const GRADE_LEVEL_OPTIONS = GRADE_LEVELS.map((key) => ({
  value: key,
  label: GRADE_LEVEL_MAP[key],
}));
```

**Files to update (replace local definitions):**
- `src/pages/teacher/Attendance.tsx`
- `src/pages/teacher/StudentGradeProfile.tsx`
- `src/pages/teacher/MyAdvisory.tsx`
- `src/pages/teacher/Dashboard.tsx`
- `src/pages/teacher/ClassRecordsList.tsx`
- `src/pages/teacher/AttendanceReports.tsx`
- `src/pages/teacher/components/ClassRecordHero.tsx`
- `src/pages/registrar/Dashboard.tsx`
- `src/pages/registrar/ApplicationTracker.tsx`
- `src/pages/registrar/AlumniStudents.tsx`
- `src/pages/registrar/StudentRecords.tsx`
- `server/src/routes/registrar/bosy.ts`

### 1.3 Move Default Sync Password to Env

**Problem:** `server/src/lib/enrollproSync.ts:194` has hardcoded fallback `password123`.

**Before:**
```typescript
const defaultPassword = process.env.DEFAULT_SYNC_PASSWORD || 'password123';
```

**After:**
```typescript
const defaultPassword = process.env.DEFAULT_SYNC_PASSWORD;
if (!defaultPassword) {
  logger.warn('[EnrollProSync] DEFAULT_SYNC_PASSWORD not set — teacher accounts will use temp passwords');
}
```

### 1.4 Update Schema Default

**Problem:** `schema.prisma` line 368 defaults `currentSchoolYear` to `"2025-2026"`.

**After:**
```prisma
currentSchoolYear  String    @default("")
```

This forces explicit configuration instead of silent wrong-year default.

---

## Phase 2: Schema Fixes for Multi-Year Integrity

**Goal:** Add proper foreign keys and per-year locking.

### 2.1 Create YearGradeLock Model

```prisma
model YearGradeLock {
  id            String    @id @default(cuid())
  schoolYearId  String
  schoolYear    SchoolYear @relation(fields: [schoolYearId], references: [id], onDelete: Cascade)
  lockedBy      String?
  lockedAt      DateTime  @default(now())
  unlockedBy    String?
  unlockedAt    DateTime?
  isLocked      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([schoolYearId])
  @@index([schoolYearId])
}
```

### 2.2 Add schoolYearId FK to Key Tables

```prisma
model Grade {
  // ... existing fields ...
  schoolYearId  String?
  schoolYear    SchoolYear? @relation(fields: [schoolYearId], references: [id], onDelete: SetNull)
}

model Enrollment {
  // ... existing fields ...
  schoolYearId  String?
  schoolYear    SchoolYear? @relation(fields: [schoolYearId], references: [id], onDelete: SetNull)
}

model Attendance {
  // ... existing fields ...
  schoolYearId  String?
  schoolYear    SchoolYear? @relation(fields: [schoolYearId], references: [id], onDelete: SetNull)
}
```

### 2.3 Make SystemSettings.schoolYearId Required

```prisma
model SystemSettings {
  // ... existing fields ...
  currentSchoolYear  String    @default("")
  schoolYearId       String    // Remove ? — now required
  schoolYear         SchoolYear @relation(fields: [schoolYearId], references: [id], onDelete: Restrict)
}
```

### 2.4 Migration Script

```bash
# Create migration
npx prisma migrate dev --name add-year-lock-and-fks

# Backfill schoolYearId on existing records
npx ts-node prisma/migrations/backfill-school-year-ids.ts
```

**Backfill script logic:**
```typescript
// For each Grade, find ClassAssignment.schoolYear → resolve SchoolYear by label → set schoolYearId
// For each Enrollment, resolve SchoolYear by enrollment.schoolYear string → set schoolYearId
// For each Attendance, resolve via Section → set schoolYearId
```

---

## Phase 3: Per-Year Grade Locking

**Goal:** Lock grades per school year, not system-wide.

### 3.1 Update Grade Save Endpoint

**File:** `server/src/routes/grades-sub/classes.ts`

```typescript
// Before saving a grade, check per-year lock
const yearLock = await prisma.yearGradeLock.findUnique({
  where: { schoolYearId: classAssignment.schoolYearId }
});

if (yearLock?.isLocked) {
  res.status(403).json({
    message: `Grades for ${classAssignment.schoolYear} are locked.`
  });
  return;
}
```

### 3.2 Update Auto-Lock Scheduler

**File:** `server/src/index.ts`

```typescript
// When a term end date passes, lock THAT year's grades
async function autoLockExpiredTermGrades() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  const currentTerm = await resolveCurrentTerm();
  const termEndDate = getTermEndDate(settings, currentTerm);

  if (new Date() > termEndDate) {
    // Lock the CURRENT year's grades
    await prisma.yearGradeLock.upsert({
      where: { schoolYearId: settings.schoolYearId },
      update: { isLocked: true },
      create: {
        schoolYearId: settings.schoolYearId,
        lockedBy: 'system-auto-lock',
        isLocked: true
      }
    });
  }
}
```

### 3.3 Admin UI for Per-Year Lock

**File:** `server/src/routes/admin-sub/system.ts`

Add endpoint:
```typescript
// GET /admin/year-locks — list all year lock statuses
router.get('/year-locks', authenticateToken, requireAdmin, async (req, res) => {
  const locks = await prisma.yearGradeLock.findMany({
    include: { schoolYear: true }
  });
  res.json({ locks });
});

// POST /admin/year-locks/:schoolYearId — toggle lock for a year
router.post('/year-locks/:schoolYearId', authenticateToken, requireAdmin, async (req, res) => {
  const { schoolYearId } = req.params;
  const { locked } = req.body;

  const lock = await prisma.yearGradeLock.upsert({
    where: { schoolYearId },
    update: {
      isLocked: locked,
      lockedBy: locked ? req.user.id : null,
      lockedAt: locked ? new Date() : null,
      unlockedBy: locked ? null : req.user.id,
      unlockedAt: locked ? null : new Date()
    },
    create: {
      schoolYearId,
      lockedBy: req.user.id,
      isLocked: locked
    }
  });

  res.json({ lock });
});
```

---

## Phase 4: Historical Data Access for Teachers

**Goal:** Let teachers view (but not edit) past year class records.

### 4.1 Add schoolYear Query Param to Teacher Endpoints

**File:** `server/src/routes/grades-sub/classes.ts`

```typescript
// GET /my-classes — add optional schoolYear param
router.get('/my-classes', authenticateToken, authorizeRoles('TEACHER'),
  async (req: AuthRequest, res: Response) => {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: req.user?.id }
    });

    // Accept optional schoolYear param, default to current
    const schoolYear = (req.query.schoolYear as string) || await getActiveSchoolYearLabel();
    const isHistorical = schoolYear !== await getActiveSchoolYearLabel();

    const classes = await prisma.classAssignment.findMany({
      where: {
        teacherId: teacher.id,
        schoolYear: schoolYear,
        // ... rest of query
      }
    });

    // If historical, mark as view-only
    const result = classes.map(c => ({
      ...c,
      isViewOnly: isHistorical
    }));

    res.json(result);
  }
);
```

### 4.2 Frontend: Add Year Selector to Teacher Portal

**File:** `src/pages/teacher/ClassRecordsList.tsx`

```tsx
// Add school year dropdown at top of page
<Select value={selectedYear} onValueChange={setSelectedYear}>
  <SelectTrigger>
    <SelectValue placeholder="Select School Year" />
  </SelectTrigger>
  <SelectContent>
    {schoolYears.map(year => (
      <SelectItem key={year} value={year}>{year}</SelectItem>
    ))}
  </SelectContent>
</Select>

// Pass to API call
const { data: classes } = useQuery({
  queryKey: ['my-classes', selectedYear],
  queryFn: () => gradesApi.getMyClasses(selectedYear)
});
```

### 4.3 View-Only Mode for Historical Data

**File:** `src/pages/teacher/ClassRecordView.tsx`

```tsx
// Check if viewing historical year
const isHistorical = classRecord?.isViewOnly;

// Disable edit buttons in historical mode
<Button
  disabled={isHistorical}
  title={isHistorical ? "Cannot edit past year grades" : ""}
>
  Save Grades
</Button>

// Show banner for historical view
{isHistorical && (
  <Banner type="info">
    Viewing historical data — grades are read-only
  </Banner>
)}
```

---

## Phase 5: Rollover Detection & Auto-Archive

**Goal:** Automatically detect EnrollPro rollover and archive old year.

### 5.1 Detect New School Year in Branding Sync

**File:** `server/src/lib/enrollproBrandingSync.ts`

```typescript
async function syncEnrollProBranding(uploadDir: string) {
  // ... existing branding sync ...

  // Check if school year changed
  const currentSettings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  const newSchoolYearLabel = activeSchoolYear?.yearLabel;

  if (newSchoolYearLabel && newSchoolYearLabel !== currentSettings.currentSchoolYear) {
    logger.info(`[BrandingSync] School year changed: ${currentSettings.currentSchoolYear} → ${newSchoolYearLabel}`);

    // 1. Create/get SchoolYear record
    const newSchoolYear = await ensureSchoolYearFromEnrollPro(
      activeSchoolYear.id,
      newSchoolYearLabel
    );

    // 2. Auto-archive old year data
    await autoArchivePreviousYear(currentSettings.schoolYearId, req.user?.id);

    // 3. Update settings
    await prisma.systemSettings.update({
      where: { id: 'main' },
      data: {
        currentSchoolYear: newSchoolYearLabel,
        schoolYearId: newSchoolYear.id,
        gradeLock: false // Unlock for new year
      }
    });

    // 4. Broadcast SSE event
    broadcastSettingsUpdate(await prisma.systemSettings.findUnique({ where: { id: 'main' } }));

    // 5. Log audit
    await createAuditLog({
      action: 'SCHOOL_YEAR_ROLLOVER',
      userId: 'system',
      target: 'SchoolYear',
      details: `Auto-archived ${currentSettings.currentSchoolYear}, activated ${newSchoolYearLabel}`
    });
  }
}
```

### 5.2 Auto-Archive Function

**File:** `server/src/lib/schoolYearResolver.ts`

```typescript
async function autoArchivePreviousYear(previousSchoolYearId: string, triggeredBy?: string) {
  const previousYear = await prisma.schoolYear.findUnique({
    where: { id: previousSchoolYearId }
  });

  if (!previousYear || previousYear.status === 'ARCHIVED') {
    return; // Already archived or not found
  }

  logger.info(`[AutoArchive] Archiving school year: ${previousYear.label}`);

  await prisma.$transaction(async (tx) => {
    // 1. Archive grades
    await tx.grade.updateMany({
      where: {
        classAssignment: { schoolYear: previousYear.label }
      },
      data: {
        isArchived: true,
        archivedAt: new Date(),
        archivedReason: `Auto-archived during ${previousYear.label} → rollover`
      }
    });

    // 2. Archive enrollments
    await tx.enrollment.updateMany({
      where: { schoolYear: previousYear.label },
      data: {
        isArchived: true,
        archivedAt: new Date(),
        archivedReason: `Auto-archived during rollover`
      }
    });

    // 3. Mark sections as completed
    await tx.section.updateMany({
      where: { schoolYear: previousYear.label },
      data: {
        status: 'COMPLETED',
        archivedAt: new Date()
      }
    });

    // 4. Deactivate class assignments
    await tx.classAssignment.updateMany({
      where: { schoolYear: previousYear.label },
      data: {
        isActive: false,
        archivedAt: new Date(),
        archivedReason: 'Year rolled over'
      }
    });

    // 5. Lock old year grades
    await tx.yearGradeLock.upsert({
      where: { schoolYearId: previousSchoolYearId },
      update: { isLocked: true },
      create: {
        schoolYearId: previousSchoolYearId,
        lockedBy: triggeredBy || 'system-auto-archive',
        isLocked: true
      }
    });

    // 6. Update school year status
    await tx.schoolYear.update({
      where: { id: previousSchoolYearId },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date()
      }
    });
  });

  logger.info(`[AutoArchive] Completed archiving ${previousYear.label}`);
}
```

### 5.3 Broadcast Rollover Event

**File:** `server/src/lib/sseManager.ts`

```typescript
// Add new event type for rollover
export function broadcastRolloverEvent(data: {
  previousYear: string;
  newYear: string;
  archivedCount: number;
}) {
  const payload = JSON.stringify({
    type: 'SCHOOL_YEAR_ROLLOVER',
    data,
    timestamp: new Date().toISOString()
  });

  // Broadcast to all connected clients
  for (const client of settingsSseClients) {
    client.write(`data: ${payload}\n\n`);
  }
}
```

---

## Phase 6: Student Promotion & Year Transition

**Goal:** Track student promotion outcomes and handle Grade 10 completion.

### 6.1 Add Promotion Status to Schema

```prisma
enum PromotionStatus {
  PROMOTED
  CONDITIONALLY_PROMOTED
  RETAINED
  JHS_COMPLETER
}

model Enrollment {
  // ... existing fields ...
  promotionStatus    PromotionStatus?
  promotedToGradeLevel GradeLevel?
}
```

### 6.2 Compute Promotion During EOSY

**File:** `server/src/routes/registrar/eosy.ts`

```typescript
async function computePromotionStatus(
  studentId: string,
  schoolYear: string,
  grades: Grade[]
): Promise<{ status: PromotionStatus; nextGrade?: GradeLevel }> {

  // Get all subject final grades (excluding HG)
  const subjectFinals = grades
    .filter(g => !g.classAssignment.subject.code.startsWith('HG'))
    .map(g => g.quarterlyGrade)
    .filter(Boolean);

  const failingCount = subjectFinals.filter(g => g < 75).length;
  const hasGrades = subjectFinals.length > 0;

  // Get current grade level
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, schoolYear },
    include: { section: true }
  });

  const currentGrade = enrollment?.section.gradeLevel;
  const gradeOrder = ['GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_10'];
  const currentGradeIdx = gradeOrder.indexOf(currentGrade);

  // Determine promotion status
  let status: PromotionStatus;
  let nextGrade: GradeLevel | undefined;

  if (currentGrade === 'GRADE_10' && hasGrades && failingCount === 0) {
    status = 'JHS_COMPLETER';
    nextGrade = undefined;
  } else if (!hasGrades) {
    status = 'RETAINED';
    nextGrade = currentGrade as GradeLevel;
  } else if (failingCount === 0) {
    status = 'PROMOTED';
    nextGrade = gradeOrder[currentGradeIdx + 1] as GradeLevel;
  } else if (failingCount <= 2) {
    status = 'CONDITIONALLY_PROMOTED';
    nextGrade = currentGrade as GradeLevel; // Stay in same grade
  } else {
    status = 'RETAINED';
    nextGrade = currentGrade as GradeLevel;
  }

  return { status, nextGrade };
}
```

### 6.3 Persist Promotion Status

**File:** `server/src/routes/registrar/eosy.ts`

```typescript
// POST /registrar/eosy/finalize — finalize EOSY for a section
router.post('/eosy/finalize', authenticateToken, async (req, res) => {
  const { sectionId, schoolYear } = req.body;

  const enrollments = await prisma.enrollment.findMany({
    where: { sectionId, schoolYear },
    include: {
      student: true,
      section: true
    }
  });

  for (const enrollment of enrollments) {
    const grades = await prisma.grade.findMany({
      where: {
        studentId: enrollment.studentId,
        classAssignment: { sectionId, schoolYear }
      },
      include: { classAssignment: { include: { subject: true } } }
    });

    const { status, nextGrade } = await computePromotionStatus(
      enrollment.studentId,
      schoolYear,
      grades
    );

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        promotionStatus: status,
        promotedToGradeLevel: nextGrade
      }
    });
  }

  res.json({ message: 'EOSY finalized', processedCount: enrollments.length });
});
```

### 6.4 Display Promotion Status in UI

**File:** `src/pages/registrar/EOSYFinalization.tsx`

```tsx
// Add promotion status column to EOSY table
<TableHead>Promotion Status</TableHead>
<TableHead>Next Grade</TableHead>

<TableCell>
  <Badge variant={getPromotionBadgeVariant(enrollment.promotionStatus)}>
    {enrollment.promotionStatus}
  </Badge>
</TableCell>
<TableCell>
  {enrollment.promotedToGradeLevel
    ? GRADE_LEVEL_MAP[enrollment.promotedToGradeLevel]
    : 'N/A (JHS Completer)'}
</TableCell>
```

---

## Phase 7: Data Retention & Cleanup

**Goal:** Prevent unbounded growth of audit and sync history tables.

### 7.1 Add Retention Config

```prisma
model SystemSettings {
  // ... existing fields ...
  auditLogRetentionDays    Int     @default(365)
  syncHistoryRetentionDays Int     @default(90)
  gradeSnapshotRetentionDays Int   @default(1825) // 5 years
}
```

### 7.2 Cleanup Scheduler

**File:** `server/src/index.ts`

```typescript
// Run daily at 2 AM
schedule.scheduleJob('0 2 * * *', async () => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });

  // Clean audit logs older than retention period
  const auditCutoff = new Date();
  auditCutoff.setDate(auditCutoff.getDate() - settings.auditLogRetentionDays);

  const deletedAudit = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: auditCutoff } }
  });

  logger.info(`[Cleanup] Deleted ${deletedAudit.count} audit logs older than ${settings.auditLogRetentionDays} days`);

  // Clean sync history older than retention period
  const syncCutoff = new Date();
  syncCutoff.setDate(syncCutoff.getDate() - settings.syncHistoryRetentionDays);

  const deletedSync = await prisma.syncHistory.deleteMany({
    where: { createdAt: { lt: syncCutoff } }
  });

  logger.info(`[Cleanup] Deleted ${deletedSync.count} sync history records`);

  // Clean grade snapshots older than retention period (but keep at least one per student per year)
  const snapshotCutoff = new Date();
  snapshotCutoff.setDate(snapshotCutoff.getDate() - settings.gradeSnapshotRetentionDays);

  // Keep latest snapshot per student per year, delete older ones
  const oldSnapshots = await prisma.gradeSnapshot.findMany({
    where: { createdAt: { lt: snapshotCutoff } },
    orderBy: { createdAt: 'desc' }
  });

  // Group by student+year, keep only latest
  const keepSnapshots = new Set<string>();
  for (const snap of oldSnapshots) {
    const key = `${snap.studentId}-${snap.schoolYear}`;
    if (!keepSnapshots.has(key)) {
      keepSnapshots.add(key);
    } else {
      await prisma.gradeSnapshot.delete({ where: { id: snap.id } });
    }
  }
});
```

### 7.3 Update Admin Settings UI

**File:** `src/pages/admin/SystemSettings.tsx`

Add fields:
```tsx
<div className="grid grid-cols-3 gap-4">
  <div>
    <Label>Audit Log Retention (days)</Label>
    <Input
      type="number"
      value={settings.auditLogRetentionDays}
      onChange={(e) => updateSetting('auditLogRetentionDays', parseInt(e.target.value))}
    />
  </div>
  <div>
    <Label>Sync History Retention (days)</Label>
    <Input
      type="number"
      value={settings.syncHistoryRetentionDays}
      onChange={(e) => updateSetting('syncHistoryRetentionDays', parseInt(e.target.value))}
    />
  </div>
  <div>
    <Label>Grade Snapshot Retention (days)</Label>
    <Input
      type="number"
      value={settings.gradeSnapshotRetentionDays}
      onChange={(e) => updateSetting('gradeSnapshotRetentionDays', parseInt(e.target.value))}
    />
  </div>
</div>
```

---

## Phase 8: Testing & Verification

### 8.1 Unit Tests

**File:** `server/src/__tests__/grade-calculation.test.ts`

```typescript
describe('Grade Calculation', () => {
  test('calculateGrades computes correct DepEd grades', () => {
    // Test written work PS, perf task PS, QA PS, initial grade, transmuted grade
  });

  test('transmute returns correct grade from table', () => {
    // Test transmutation lookup
  });

  test('resolveEffectiveWeights falls back correctly', () => {
    // Test weight resolution chain
  });
});
```

### 8.2 Integration Tests

**File:** `server/src/__tests__/rollover.test.ts`

```typescript
describe('School Year Rollover', () => {
  test('auto-archives previous year data', async () => {
    // 1. Create test data for Year 1
    // 2. Trigger rollover
    // 3. Verify Year 1 data is archived
    // 4. Verify Year 2 data exists
  });

  test('locks grades for archived year', async () => {
    // 1. Archive year
    // 2. Attempt to save grade for archived year
    // 3. Verify 403 response
  });

  test('allows grading in new year', async () => {
    // 1. Archive Year 1, activate Year 2
    // 2. Save grade for Year 2
    // 3. Verify success
  });

  test('preserves historical grade data', async () => {
    // 1. Save grades for Year 1
    // 2. Archive Year 1
    // 3. Query SF10 for student
    // 4. Verify Year 1 grades present
  });
});
```

### 8.3 Test Commands

```bash
# Run all tests
npm test

# Run rollover-specific tests
npm test -- --grep "rollover"

# Run with coverage
npm run test:coverage

# Run integration tests against live server
npm run test:integration
```

---

## Phase 9: Frontend UI Updates

### 9.1 Replace PrintCenter Mock Data

**File:** `src/pages/registrar/PrintCenter.tsx`

```tsx
// Remove hardcoded printJobs array
// Add API call
const { data: printJobs, isLoading } = useQuery({
  queryKey: ['print-jobs'],
  queryFn: () => registrarApi.getPrintJobs()
});

// Replace mock data with API response
if (isLoading) return <LoadingSpinner />;
if (!printJobs?.length) return <EmptyState message="No print jobs yet" />;
```

### 9.2 Wire Orphaned Pages

**File:** `src/App.tsx`

```tsx
// Add routes for orphaned pages
<Route path="/registrar/applications" element={<ApplicationTracker />} />
<Route path="/registrar/bosy" element={<BOSYQueue />} />
<Route path="/registrar/print-center" element={<PrintCenter />} />
<Route path="/registrar/form-viewer" element={<FormViewer />} />
```

### 9.3 Rollover Complete Banner

**File:** `src/components/RolloverBanner.tsx`

```tsx
export function RolloverBanner() {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => adminApi.getSettings()
  });

  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !settings?.lastRolloverAt) return null;

  const rolloverDate = new Date(settings.lastRolloverAt);
  const isNewRollover = Date.now() - rolloverDate.getTime() < 7 * 24 * 60 * 60 * 1000; // 7 days

  if (!isNewRollover) return null;

  return (
    <Banner type="success" onDismiss={() => setDismissed(true)}>
      <strong>School Year {settings.currentSchoolYear}</strong> is now active.
      Previous year data has been archived and grades are locked.
    </Banner>
  );
}
```

---

## Phase 10: Migration & Deployment

### 10.1 Prisma Migration

```bash
# Create migration
npx prisma migrate dev --name rollover-readiness

# Review generated SQL
cat prisma/migrations/YYYYMMDD_rollover_readiness/migration.sql

# Apply to staging
npx prisma migrate deploy
```

### 10.2 Backfill Script

**File:** `prisma/migrations/backfill-school-year-ids.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting backfill of schoolYearId on existing records...');

  // Get all school years
  const schoolYears = await prisma.schoolYear.findMany();
  const yearLabelToId = new Map(schoolYears.map(sy => [sy.label, sy.id]));

  // Backfill Grade records
  const grades = await prisma.grade.findMany({
    where: { schoolYearId: null },
    include: { classAssignment: true }
  });

  for (const grade of grades) {
    const schoolYearId = yearLabelToId.get(grade.classAssignment.schoolYear);
    if (schoolYearId) {
      await prisma.grade.update({
        where: { id: grade.id },
        data: { schoolYearId }
      });
    }
  }

  console.log(`Backfilled ${grades.length} grade records`);

  // Backfill Enrollment records
  const enrollments = await prisma.enrollment.findMany({
    where: { schoolYearId: null }
  });

  for (const enrollment of enrollments) {
    const schoolYearId = yearLabelToId.get(enrollment.schoolYear);
    if (schoolYearId) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { schoolYearId }
      });
    }
  }

  console.log(`Backfilled ${enrollments.length} enrollment records`);

  // Backfill Attendance records (via section)
  const attendances = await prisma.attendance.findMany({
    where: { schoolYearId: null },
    include: { section: true }
  });

  for (const attendance of attendances) {
    const schoolYearId = yearLabelToId.get(attendance.section.schoolYear);
    if (schoolYearId) {
      await prisma.attendance.update({
        where: { id: attendance.id },
        data: { schoolYearId }
      });
    }
  }

  console.log(`Backfilled ${attendances.length} attendance records`);

  // Lock archived years
  const archivedYears = schoolYears.filter(sy => sy.status === 'ARCHIVED');
  for (const year of archivedYears) {
    await prisma.yearGradeLock.upsert({
      where: { schoolYearId: year.id },
      update: {},
      create: {
        schoolYearId: year.id,
        lockedBy: 'migration-backfill',
        isLocked: true
      }
    });
  }

  console.log(`Locked ${archivedYears.length} archived years`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

### 10.3 Deployment Checklist

```markdown
## Pre-Deployment
- [ ] Run migration on staging: `npx prisma migrate deploy`
- [ ] Run backfill script on staging
- [ ] Verify all tests pass
- [ ] Test rollover simulation on staging
- [ ] Verify SF10 still shows historical data
- [ ] Verify teacher historical view works
- [ ] Check admin year-lock UI

## Deployment
- [ ] Create database backup
- [ ] Run migration on production: `npx prisma migrate deploy`
- [ ] Run backfill script on production
- [ ] Deploy application code
- [ ] Verify application starts successfully
- [ ] Monitor error logs for 15 minutes

## Post-Deployment
- [ ] Test login as teacher, registrar, admin
- [ ] Test grade save in current year
- [ ] Test grade save in archived year (should fail)
- [ ] Test SF10 generation
- [ ] Test SF9 with historical year selector
- [ ] Verify sync status page shows correct year
```

---

## Effort Summary

| Phase | Description | Days | Dependencies |
|-------|-------------|------|--------------|
| 1 | Hardcoded Data Fixes | 1-2 | None |
| 2 | Schema Fixes | 2-3 | Phase 1 |
| 3 | Per-Year Grade Locking | 1 | Phase 2 |
| 4 | Historical Access | 1 | Phase 2 |
| 5 | Rollover Detection | 2-3 | Phase 2, 3 |
| 6 | Student Promotion | 2-3 | Phase 2 |
| 7 | Data Retention | 1 | Phase 2 |
| 8 | Testing | 2 | All phases |
| 9 | Frontend UI | 2 | Phase 4, 5 |
| 10 | Migration & Deploy | 1 | All phases |
| **TOTAL** | | **15-19 days** | |

### Critical Path

```
Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 6 → Phase 8 → Phase 10
```

### Parallel Work

- Phase 4 (Historical Access) can run with Phase 5
- Phase 7 (Data Retention) can run with Phase 5-6
- Phase 9 (Frontend UI) can run with Phase 5-7

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| EnrollPro rollover returns `SMART_OUTCOME_MISSING` | HIGH | Test with EnrollPro team, add SMART-side promotion tracking |
| Schema migration fails on production | HIGH | Test on staging first, create backup, have rollback plan |
| Teachers lose access to historical data during migration | MEDIUM | Run backfill before deploying teacher historical access |
| Grade lock prevents legitimate edits | MEDIUM | Add admin override capability, clear error messages |
| Performance impact of per-year lock queries | LOW | Add index on YearGradeLock.schoolYearId |

---

## Success Criteria

After implementation, SMART will:

- [ ] Automatically detect EnrollPro school year rollover
- [ ] Archive previous year data without data loss
- [ ] Lock grades for archived years (per-year, not system-wide)
- [ ] Allow grading in new school year immediately
- [ ] Show teachers historical class records (view-only)
- [ ] Track student promotion/retention outcomes
- [ ] Handle Grade 10 JHS completers
- [ ] Generate SF10 with multi-year historical data
- [ ] Clean up old audit/sync history data
- [ ] Pass all rollover integration tests

---

## References

- [SMART Architecture](./DEVELOPER_MODE_REMOVAL_GUIDE.md)
- [EnrollPro API Documentation](./ENROLLPRO_GRADE_FETCH_API.md)
- [SF10 Implementation](./SF1-IMPLEMENTATION-PLAN.md)
- [SF5 Implementation](./SF5-IMPLEMENTATION-PLAN.md)
- [Audit Findings](./archive/AUDIT_FINDINGS.md)

---

*Last Updated: 2026-08-29*
*Author: SMART Development Team*
