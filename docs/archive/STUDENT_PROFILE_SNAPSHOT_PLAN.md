# Student Profile Snapshot — Implementation Plan

**Created:** 2026-08-22
**Status:** COMPLETE
**Purpose:** Preserve student profile data at enrollment time for historical accuracy in forms (SF1, SF5, SF8, SF9, SF10/Form 137)

**Implementation mode:** User is sleeping. Implement autonomously. Check pm2 logs after every change to catch bugs early. Always check connected components when updating a file — if you update one thing, update everything connected to it.

---

## 1. Problem Statement

Student profile data (address, guardian, parents, religion, etc.) is synced from EnrollPro every hour. When EnrollPro updates a student's info (e.g., family moves to a new address), the hourly sync **overwrites** the old data in our `students` table.

**The problem:** Forms like SF10 (Permanent Record / Form 137) need the student's profile **at the time of enrollment**, not the current profile. If a Grade 7 student moved in Grade 9, SF10 should still show the Grade 7 address.

**Example:**
- Grade 7 enrollment: address = "123 Main St", guardian = "Juan Dela Cruz"
- Grade 9: student moves to "456 Oak Ave", guardian changes to "Pedro Dela Cruz"
- SF10 for Grade 7 should show "123 Main St" + "Juan Dela Cruz"
- Currently: SF10 shows "456 Oak Ave" + "Pedro Dela Cruz" (wrong)

---

## 2. Solution Overview

Add a `profileSnapshot` JSON field to the `Enrollment` model. When a student enrolls, copy their current profile into the snapshot. The snapshot is **immutable** — it never changes after creation.

```
Student record    → always has CURRENT profile (updated by hourly sync)
Enrollment record → has PROFILE SNAPSHOT at enrollment time (frozen forever)
```

**When EnrollPro updates a student:**
1. Hourly sync updates `students` table (current data)
2. Enrollment snapshots are untouched
3. Forms pull from snapshots, not the current student

---

## 3. Schema Changes

### 3.1 Enrollment Model — Add `profileSnapshot`

```prisma
model Enrollment {
  id               String           @id @default(cuid())
  studentId        String
  sectionId        String
  schoolYear       String
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
  status           EnrollmentStatus @default(ENROLLED)
  isArchived       Boolean          @default(false)
  archivedAt       DateTime?
  archivedReason   String?
  profileSnapshot  Json?            // NEW — student profile at enrollment time
  section          Section          @relation(...)
  student          Student          @relation(...)

  @@unique([studentId, sectionId, schoolYear])
  // ... existing indexes
}
```

### 3.2 Snapshot Shape (TypeScript type)

```typescript
interface StudentProfileSnapshot {
  // Identity
  lrn: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  birthDate: string | null;       // ISO date string
  gender: string | null;

  // Address
  address: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;

  // Guardian
  guardianName: string | null;
  guardianContact: string | null;

  // Parents
  fatherName: string | null;
  fatherContact: string | null;
  motherName: string | null;
  motherContact: string | null;

  // Demographics
  religion: string | null;
  motherTongue: string | null;
  ipCommunity: boolean | null;
  is4PsBeneficiary: boolean | null;
  disability: string | null;
  isBalikAral: boolean | null;
}
```

### 3.3 Migration

```sql
ALTER TABLE "enrollments" ADD COLUMN "profileSnapshot" JSONB;
```

No data migration needed — existing enrollments get `NULL` snapshots. Forms fall back to current student data for legacy records.

---

## 4. Connected Components Map

### 4.1 Files That Create Enrollments (Must Snapshot)

| File | Line(s) | Operation | Change Needed |
|------|---------|-----------|---------------|
| `server/src/lib/enrollproSync.ts` | 739 | `upsert` enrollment | Add snapshot on create |
| `server/src/lib/sync/utils.ts` | 110 | `upsert` enrollment | Add snapshot on create |
| `server/src/routes/registrar.ts` | 121, 391 | Create enrollment | Add snapshot on create |
| `server/src/routes/admin.ts` | 2277 | Bulk enroll | Add snapshot on create |

### 4.2 Files That Read Enrollment Data (May Use Snapshot)

| File | Line(s) | Operation | Change Needed |
|------|---------|-----------|---------------|
| `server/src/routes/registrar.ts` | 1443 | SF10 query | Use `profileSnapshot` if available |
| `server/src/routes/registrar.ts` | 1034 | SF1 query | Use `profileSnapshot` if available |
| `server/src/routes/registrar.ts` | 1157 | SF5 query | Use `profileSnapshot` if available |
| `server/src/routes/registrar.ts` | 1767 | SF8 query | Use `profileSnapshot` if available |
| `server/src/routes/registrar.ts` | 724 | SF9 query | Use `profileSnapshot` if available |
| `server/src/routes/advisory.ts` | 290 | Student profile | Use `profileSnapshot` if available |
| `server/src/routes/grades.ts` | 358 | Grade query | No change needed (uses student, not enrollment) |

### 4.3 Files That Sync Students (Must Snapshot on New Enrollment)

| File | Line(s) | Operation | Change Needed |
|------|---------|-----------|---------------|
| `server/src/lib/enrollproSync.ts` | 527 | Create student | No change (student only) |
| `server/src/lib/enrollproSync.ts` | 633 | Batch create students | No change (student only) |
| `server/src/lib/enrollproSync.ts` | 689 | Batch update students | No change (student only) |
| `server/src/lib/enrollproSync.ts` | 900 | Enrichment update | No change (student only) |

### 4.4 Frontend Components (No Change Needed)

| File | What It Displays | Change Needed |
|------|------------------|---------------|
| `src/pages/teacher/StudentGradeProfile.tsx` | Student profile card | No change — reads from student, not enrollment |
| `src/pages/teacher/MyAdvisory.tsx` | Advisory list | No change — reads from student |
| `src/pages/registrar/SF10Form.tsx` | SF10 form | May need to accept snapshot data |

---

## 5. Implementation Steps

### Phase 1: Schema + Migration (30 min)

1. Add `profileSnapshot Json?` to `Enrollment` model in `schema.prisma`
2. Create `StudentProfileSnapshot` TypeScript interface in `server/src/types/student.ts`
3. Create helper function `createProfileSnapshot(student)` in `server/src/lib/studentSnapshot.ts`
4. Run `npx prisma db push` to apply schema change
5. **Verify:** `npx prisma studio` — check enrollments table has new column

### Phase 2: Snapshot on Enrollment Creation (2 hours)

6. **`server/src/lib/enrollproSync.ts`** — line 739 (enrollment upsert):
   - On create (not update), call `createProfileSnapshot(student)` and include in upsert data
   - On update, do NOT touch existing snapshot

7. **`server/src/lib/sync/utils.ts`** — line 110 (upsertLearner):
   - On create, call `createProfileSnapshot(student)` and include in upsert data

8. **`server/src/routes/registrar.ts`** — lines 121, 391 (manual enrollment):
   - On create, call `createProfileSnapshot(student)` and include in create data

9. **`server/src/routes/admin.ts`** — line 2277 (bulk enroll):
   - On create, call `createProfileSnapshot(student)` for each enrollment

10. **Verify:** Create a test enrollment, check `profileSnapshot` is populated in DB

### Phase 3: Use Snapshot in Forms (2 hours)

11. **`server/src/routes/registrar.ts`** — SF10 endpoint (line 1431):
    - When building SF10 data, prefer `enrollment.profileSnapshot` over `student.*`
    - Fallback: if snapshot is null (legacy enrollment), use current student data

12. **`server/src/routes/registrar.ts`** — SF1 endpoint (line 1034):
    - Same pattern: prefer snapshot, fallback to student

13. **`server/src/routes/registrar.ts`** — SF5, SF8, SF9 endpoints:
    - Same pattern: prefer snapshot, fallback to student

14. **`server/src/routes/advisory.ts`** — student profile endpoint:
    - Return snapshot data alongside current student data
    - Frontend can show "Profile at enrollment" vs "Current profile"

15. **Verify:** Generate SF10 for a student with snapshot — verify historical data shown

### Phase 4: Backfill Existing Enrollments (1 hour)

16. Create backfill script: `server/src/scripts/backfillSnapshots.ts`
    - For each enrollment with `profileSnapshot = NULL`:
      - Fetch current student data
      - Create snapshot from current data
      - Update enrollment
    - This captures current state for all legacy enrollments
    - Not perfectly historical, but better than NULL

17. Run backfill: `npx ts-node src/scripts/backfillSnapshots.ts`

18. **Verify:** Check all enrollments have snapshots in DB

### Phase 5: Remove On-Demand Enrichment (30 min)

19. **`server/src/lib/enrichment.ts`** — DELETE entire file
20. **`server/src/lib/enrollproSync.ts`** — Remove enrichment pass (lines 756-911)
21. **`server/src/routes/advisory.ts`** — Remove `enrichStudentIfNeeded` call
22. **Verify:** `npx tsc --noEmit` — zero errors

### Phase 6: Student Profile Sync (3 hours)

23. **NEW: `server/src/lib/studentProfileSync.ts`**:
    - Fetch all learners from EnrollPro Integration v1 (paginated)
    - Map LRN → EnrollPro student ID
    - Fetch `/students/:id` for each student (concurrency limit 10)
    - Batch update `students` table with enrichment fields
    - Run hourly (every 12th sync cycle)

24. **`server/src/lib/syncCoordinator.ts`** — Add Step 4:
    - Import `runStudentProfileSync`
    - Add `STUDENT_PROFILE_SYNC_EVERY_N_CYCLES = 12`
    - Run after EnrollPro + Atlas sync

25. **Verify:** Watch pm2 logs — profile sync runs hourly, enriches students

### Phase 7: Testing (1 hour)

26. Test: Create enrollment → verify snapshot populated
27. Test: Update student profile → verify enrollment snapshot unchanged
28. Test: Generate SF10 → verify snapshot data used (not current)
29. Test: Legacy enrollment (NULL snapshot) → verify fallback to current student
30. Test: Backfill → verify all enrollments have snapshots
31. Test: Profile sync → verify students enriched, no 429 errors
32. Test: Advisory page → verify instant load (no EnrollPro API calls)

---

## 6. Error Handling

| Scenario | Handling |
|----------|----------|
| Student not found during snapshot creation | Skip, log warning, enrollment created without snapshot |
| EnrollPro API down during profile sync | Skip cycle, retry next hour |
| 429 rate limit during profile sync | Exponential backoff: 1s → 2s → 4s → 8s |
| DB write fails during backfill | Log error, continue with next enrollment |
| Snapshot is NULL on form generation | Fallback to current student data |
| Snapshot shape changes (new fields) | Add `snapshotVersion` field, handle migration on read |

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Snapshot not created on enrollment | Low | High | Verify in sync logs, add creation check |
| Snapshot overwrites on update | Low | High | Code review: only create on enrollment, never update |
| Forms show wrong data | Medium | High | Test SF10 with snapshot vs without |
| Storage bloat | Low | Low | 26MB for 52K snapshots — negligible |
| Migration breaks existing data | Low | High | `db push` is additive (new nullable column) |
| Backfill creates incorrect snapshots | Medium | Medium | Backfill uses current data, not historical — best effort |

---

## 8. Dependencies

- **Prisma 7.6** — supports `Json` type natively
- **PostgreSQL** — supports JSONB storage
- **Existing sync** — already creates students with all profile fields
- **Existing enrichment** — currently populates the fields we're snapshotting

---

## 9. Success Criteria

- [ ] Every new enrollment has a `profileSnapshot` populated
- [ ] SF10 (Form 137) shows historical profile data from snapshot
- [ ] Existing enrollments backfilled with current profile data
- [ ] On-demand enrichment removed — zero EnrollPro API calls on student view
- [ ] Student profile sync runs hourly — enriches all students
- [ ] No 429 rate limit errors
- [ ] Advisory page loads in <500ms (was 2-5s with on-demand enrichment)
- [ ] All forms (SF1, SF5, SF8, SF9, SF10) work correctly

---

## 10. Estimated Total Effort

| Phase | Hours |
|-------|-------|
| Schema + Migration | 0.5h |
| Snapshot on Enrollment | 2h |
| Use Snapshot in Forms | 2h |
| Backfill Existing | 1h |
| Remove On-Demand Enrichment | 0.5h |
| Student Profile Sync | 3h |
| Testing | 1h |
| **Total** | **~10 hours** |
