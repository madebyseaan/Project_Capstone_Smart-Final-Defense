# Rollover Gap Fix Plan

## Executive Summary

SMART has 6 architectural gaps that prevent proper school year rollover. This document provides a phased approach to fix them, with priority ordering based on risk, effort, and dependency.

## How Rollover Actually Works (EnrollPro-Driven)

**EnrollPro drives the rollover as a batch process for ALL grade levels simultaneously:**

1. EnrollPro initiates rollover (batch, all grades at once)
2. EnrollPro calls SMART's grade outcomes API (`POST /api/integration/smart/sections/:sectionId/sync-grades`) for each section
3. SMART returns final grades + promotion status (PROMOTED/RETAINED)
4. EnrollPro validates all sections → approves rollover
5. EnrollPro archives old year (EOSY grades, enrollment history)
6. EnrollPro clones sections for new year (empty, no advisers/learners)
7. EnrollPro creates BOSY applications with PENDING_CONFIRMATION for promoted students
8. Grade 10 PROMOTED → JHS_COMPLETER (archived, no active target)
9. SMART syncs new year data from EnrollPro → auto-updates currentSchoolYear
10. Admin calls SMART `archive-year` endpoint for old year (optional cleanup)

**Key insight:** SMART does NOT initiate rollover. SMART provides data when asked, then cleans up after.

## Priority Decision: Historical Grades First, Then Gaps

**Do historical grades seeding FIRST** because:
- It's a one-time data operation (not code changes)
- It immediately enables SF10 for all students
- It has zero risk of breaking existing functionality
- The gap fixes are structural code changes that require development + testing time

**Then fix gaps in this order:**
1. Phase 1: Data Preservation (prevent data loss) ✅ DONE
2. Phase 2: Grade Archival (freeze old year grades) ✅ DONE
3. Phase 3: Year Lifecycle (manage year transitions)
4. Phase 4: Automation (auto-term, rollover readiness checks)

---

## Gap Analysis

### Gap 1: No Year-Based Data Archival
**Risk:** HIGH — Old year data is live and editable. Teachers can delete archived assignments, breaking SF10.
**Effort:** MEDIUM
**Fix:** Add archival flags to all time-scoped models. ✅ DONE

### Gap 2: No Grade Archival on Rollover
**Risk:** HIGH — Grades from old years can be modified after year-end.
**Effort:** LOW
**Fix:** Add `isArchived` flag to Grade model. Freeze grades when year closes. ✅ DONE

### Gap 3: ClassAssignment Hard-Delete Breaks SF10
**Risk:** HIGH — Teachers can permanently delete historical assignments.
**Effort:** LOW
**Fix:** Prevent hard-delete of archived assignments that have grades. ✅ DONE

### Gap 4: No School Year Lifecycle Management
**Risk:** MEDIUM — No concept of "year is closed." No status tracking.
**Effort:** MEDIUM
**Fix:** Add `SchoolYear` model with status enum (Draft/Active/Archived). EnrollPro drives the lifecycle, SMART just needs to track it.

### Gap 5: No autoTerm Advancement
**Risk:** LOW — Term changes are manual but work correctly.
**Effort:** LOW
**Fix:** Implement cron job that advances T1→T2→T3 based on term dates.

### Gap 6: GradeSnapshot is Write-Only
**Risk:** MEDIUM — Snapshots exist but are never used. If Grade records are lost, snapshots can't help.
**Effort:** MEDIUM
**Fix:** Use GradeSnapshot as fallback in SF10 when Grade records are missing.
**Risk:** MEDIUM — Snapshots exist but are never used. If Grade records are lost, snapshots can't help.
**Effort:** MEDIUM
**Fix:** Use GradeSnapshot as fallback in SF10 when Grade records are missing.

---

## Phase 1: Data Preservation (Do First)

### Goal
Prevent data loss. Ensure historical records cannot be destroyed.

### Changes

#### 1.1 Prevent Hard-Delete of Archived ClassAssignments
**File:** `server/src/routes/grades.ts` (L788-919)
**Change:** Block permanent deletion of ClassAssignments that have Grades or GradeSnapshots.

```typescript
// In DELETE /grades/class-assignments/archived/all
// Before hard delete, check if any grades reference these assignments
const assignmentIds = archived.map(a => a.id);
const gradeCount = await prisma.grade.count({
  where: { classAssignmentId: { in: assignmentIds } }
});
if (gradeCount > 0) {
  return res.status(400).json({ 
    message: `Cannot delete ${gradeCount} assignments with grades. Grades must be archived first.` 
  });
}
```

#### 1.2 Add Archival Fields to Grade Model
**File:** `server/prisma/schema.prisma`
**Change:** Add archival fields to Grade.

```prisma
model Grade {
  // ... existing fields ...
  isArchived    Boolean   @default(false)
  archivedAt    DateTime?
  archivedReason String?
}
```

#### 1.3 Add Archival Fields to Enrollment Model
**File:** `server/prisma/schema.prisma`
**Change:** Add archival fields to Enrollment.

```prisma
model Enrollment {
  // ... existing fields ...
  isArchived    Boolean   @default(false)
  archivedAt    DateTime?
  archivedReason String?
}
```

#### 1.4 Add Archival Fields to Section Model
**File:** `server/prisma/schema.prisma`
**Change:** Add lifecycle status to Section.

```prisma
model Section {
  // ... existing fields ...
  status        String    @default("ACTIVE") // ACTIVE, ARCHIVED, COMPLETED
  archivedAt    DateTime?
}
```

### Migration
```bash
cd server
npx prisma migrate dev --name add-archival-fields
```

---

## Phase 2: Grade Archival (Freeze Old Year)

### Goal
When a school year ends, freeze all grades so they cannot be modified.

### Changes

#### 2.1 Archive Grades Endpoint
**File:** `server/src/routes/admin.ts`
**New Endpoint:** `POST /api/admin/archive-year`

```typescript
router.post("/archive-year", authenticateToken, requireAdmin, async (req, res) => {
  const { schoolYear } = req.body;
  
  // 1. Archive all Grades for this school year
  await prisma.grade.updateMany({
    where: {
      classAssignment: { schoolYear }
    },
    data: {
      isArchived: true,
      archivedAt: new Date(),
      archivedReason: `Year ${schoolYear} archived`
    }
  });
  
  // 2. Archive all Enrollments
  await prisma.enrollment.updateMany({
    where: { schoolYear },
    data: {
      isArchived: true,
      archivedAt: new Date(),
      archivedReason: `Year ${schoolYear} archived`
    }
  });
  
  // 3. Mark Sections as COMPLETED
  await prisma.section.updateMany({
    where: { schoolYear },
    data: {
      status: "COMPLETED",
      archivedAt: new Date()
    }
  });
  
  // 4. Archive ClassAssignments
  await prisma.classAssignment.updateMany({
    where: { schoolYear },
    data: {
      isActive: false,
      archivedAt: new Date(),
      archivedReason: `Year ${schoolYear} archived`
    }
  });
  
  res.json({ success: true, message: `Year ${schoolYear} archived` });
});
```

#### 2.2 Block Grade Edits on Archived Grades
**File:** `server/src/routes/grades.ts`
**Change:** Check `isArchived` before allowing grade updates.

```typescript
// In POST /grade endpoint, before upsert:
const existingGrade = await prisma.grade.findFirst({
  where: { studentId, classAssignmentId, term }
});
if (existingGrade?.isArchived) {
  return res.status(403).json({ message: "Cannot edit archived grades" });
}
```

#### 2.3 Frontend: Show Archive Warning
**File:** `src/pages/teacher/components/ClassRecordTable.tsx`
**Change:** Show warning banner when viewing archived class records.

---

## Phase 3: Year Lifecycle Management

### Goal
Track school year status. Know which years are active, archived, or completed.

### Changes

#### 3.1 Add SchoolYear Model
**File:** `server/prisma/schema.prisma`

```prisma
model SchoolYear {
  id            String   @id @default(cuid())
  label         String   @unique // "2026-2027"
  status        String   @default("ACTIVE") // DRAFT, ACTIVE, ARCHIVED, COMPLETED
  startDate     DateTime?
  endDate       DateTime?
  archivedAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

#### 3.2 SchoolYear Admin UI
**File:** `src/pages/admin/SchoolYearManager.tsx` (new)
- List all school years with status
- Archive a school year (triggers Phase 2 archival)
- View year summary (total students, sections, grades)

#### 3.3 Update SystemSettings
**File:** `server/prisma/schema.prisma`
**Change:** Link `currentSchoolYear` to SchoolYear model.

```prisma
model SystemSettings {
  // ... existing fields ...
  currentSchoolYearId String?  // FK to SchoolYear
  currentSchoolYear   String   @default("2026-2027") // Keep for backward compat
}
```

---

## Phase 4: Automation

### Goal
Automate term advancement and year-end checks.

### Changes

#### 4.1 Implement autoAdvanceTerm
**File:** `server/src/lib/scheduler.ts` (new)
**Change:** Create a cron job that advances terms based on dates.

```typescript
// Check every hour
cron.schedule('0 * * * *', async () => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  if (!settings?.autoAdvanceTerm) return;
  
  const now = new Date();
  const { currentTerm, t1EndDate, t2EndDate, t3EndDate } = settings;
  
  if (currentTerm === 'T1' && t1EndDate && now > t1EndDate) {
    await prisma.systemSettings.update({
      where: { id: 'main' },
      data: { currentTerm: 'T2' }
    });
    logger.info('[Scheduler] Auto-advanced term T1 → T2');
  }
  // Similar for T2 → T3
});
```

#### 4.2 Year-End Readiness Check
**File:** `server/src/routes/admin.ts`
**New Endpoint:** `GET /api/admin/rollover-readiness`

```typescript
router.get("/rollover-readiness", authenticateToken, requireAdmin, async (req, res) => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  const sy = settings?.currentSchoolYear;
  
  // Check 1: All grades submitted
  const totalAssignments = await prisma.classAssignment.count({
    where: { schoolYear: sy, isActive: true }
  });
  const gradedAssignments = await prisma.classAssignment.count({
    where: {
      schoolYear: sy,
      isActive: true,
      grades: { some: { quarterlyGrade: { not: null } } }
    }
  });
  
  // Check 2: All sections have advisers
  const sectionsWithoutAdviser = await prisma.section.count({
    where: { schoolYear: sy, adviserId: null }
  });
  
  // Check 3: No pending enrollments
  const pendingEnrollments = await prisma.enrollment.count({
    where: { schoolYear: sy, status: 'PENDING' }
  });
  
  res.json({
    schoolYear: sy,
    ready: gradedAssignments === totalAssignments 
           && sectionsWithoutAdviser === 0 
           && pendingEnrollments === 0,
    checks: {
      gradesSubmitted: { total: totalAssignments, graded: gradedAssignments, pass: gradedAssignments === totalAssignments },
      sectionsAdvisered: { total: await prisma.section.count({ where: { schoolYear: sy } }), withoutAdviser: sectionsWithoutAdviser, pass: sectionsWithoutAdviser === 0 },
      enrollmentsComplete: { pending: pendingEnrollments, pass: pendingEnrollments === 0 }
    }
  });
});
```

#### 4.3 Use GradeSnapshot as SF10 Fallback
**File:** `server/src/routes/registrar.ts` (SF10 endpoint)
**Change:** When Grade records are missing, fall back to GradeSnapshot.

```typescript
// In SF10, after fetching grades:
if (grades.length === 0 && studentId) {
  // Fallback to snapshots
  const snapshots = await prisma.gradeSnapshot.findMany({
    where: { studentId, schoolYear: sy }
  });
  // Convert snapshots to grade-like objects
}
```

---

## Implementation Timeline

| Phase | Duration | Status | Dependencies |
|---|---|---|---|
| Historical Grades Seeding | 1 day | Pending | None |
| Phase 1: Data Preservation | 1 day | ✅ DONE | None |
| Phase 2: Grade Archival | 1 day | ✅ DONE | Phase 1 |
| Phase 3: Year Lifecycle | 2-3 days | Pending | Phase 2 |
| Phase 4: Automation | 1-2 days | Pending | Phase 3 |
| **Total** | **5-8 days** | | |

## Recommended Order

1. **Next:** Seed historical grades (enables SF10 immediately)
2. **Then:** Phase 3 — Year lifecycle (SchoolYear model, admin UI)
3. **Then:** Phase 4 — Automation (autoTerm cron, rollover readiness check)
4. **After EnrollPro rollover:** Call `POST /api/admin/archive-year` to freeze old year

## Rollover Sequence (EnrollPro-Driven)

When rollover happens in production:
```
1. EnrollPro initiates rollover (batch, ALL grades at once)
2. EnrollPro calls SMART grade outcomes API for each section
3. SMART returns final grades + promotion status
4. EnrollPro validates → approves rollover
5. EnrollPro archives old year, creates new year shells
6. EnrollPro generates BOSY applications (PENDING_CONFIRMATION)
7. Grade 10 PROMOTED → JHS_COMPLETER
8. SMART syncs new year data from EnrollPro
9. Admin calls SMART archive-year for old year (optional cleanup)
```

## Risk Assessment

| Change | Risk | Mitigation |
|---|---|---|
| Add archival fields | LOW | Additive, no breaking changes |
| Block hard-delete | LOW | Prevents data loss, no UX change |
| Archive endpoint | MEDIUM | Test thoroughly, add confirmation dialog |
| SchoolYear model | MEDIUM | Migration required, backward compat with string |
| autoAdvanceTerm cron | LOW | Only runs when flag is true |
| GradeSnapshot fallback | LOW | Read-only, no data modification |

## Testing Checklist

- [x] Teachers cannot delete archived assignments with grades
- [x] Archived grades cannot be edited
- [x] Archive year endpoint correctly freezes all data
- [x] Archive year blocks current active year
- [ ] SF10 shows historical grades after seeding
- [ ] School year status transitions work (Active → Archived)
- [ ] Term auto-advance works with configured dates
- [ ] Rollover readiness check returns accurate results
- [ ] GradeSnapshot fallback works when Grade records are missing
