# Cluster G — Sync Optimization Plan

**Created:** 2026-08-21
**Goal:** Reduce sync cycle DB queries from ~4,400–8,800 to ~300–600 by eliminating N+1 patterns
**Effort:** 1–2 days
**Risk:** MEDIUM — sync layer is critical infrastructure, changes must be idempotent

---

## 1. Problem Summary

Every 5-minute sync cycle executes ~4,400–8,800 individual DB queries. The majority come from:

1. **Student upsert loop** (`enrollproSync.ts:364–648`) — ~800 iterations × 2–5 queries = **2,000–4,000 queries**
2. **Enrichment pass** (`enrollproSync.ts:654–757`) — ~750 iterations with network + DB calls = **1,500–3,000 queries**
3. **Schedule entry upserts** (`atlasSync.ts:650–695`) — ~200–600 individual upserts
4. **Class assignment upserts** (`atlasSync.ts:533–582`) — ~100–300 individual upserts

---

## 2. Files That Will Change

| File | Changes | Connected To |
|------|---------|-------------|
| `server/src/lib/enrollproSync.ts` | Batch student upserts, batch enrollment ops, batch stale cleanup, pre-fetch students for enrichment | `syncCoordinator.ts`, `enrollproClient.ts`, `syncCache.ts`, `prisma/schema.prisma` |
| `server/src/lib/atlasSync.ts` | Batch classAssignment upserts, batch scheduleEntry upserts, batch reactivation, batch subject updates | `syncCoordinator.ts`, `enrollproClient.ts`, `prisma/schema.prisma` |
| `server/src/lib/syncCoordinator.ts` | Minor — verify mutex still works, no structural changes needed | `enrollproSync.ts`, `atlasSync.ts` |
| `server/src/lib/sync/utils.ts` | Verify batch helpers work correctly | `enrollproSync.ts`, `teacherSync.ts` |
| `server/src/lib/teacherSync.ts` | May benefit from shared batch helpers (lower priority — runs per login, not per cycle) | `enrollproClient.ts`, `syncCache.ts` |

### Files NOT Changing
- `server/src/lib/enrollproClient.ts` — HTTP client stays the same (no rate limiting needed for internal calls)
- `server/src/lib/syncCache.ts` — Cache pattern stays the same
- `server/prisma/schema.prisma` — No schema changes needed (all unique constraints already support upsert)
- `server/src/routes/*.ts` — API routes unchanged
- `src/**/*.tsx` — Frontend unchanged

---

## 3. Prisma Batch Operation Best Practices

### 3.1 createMany with skipDuplicates
```typescript
// BEFORE: N individual creates
for (const item of items) {
  await prisma.student.create({ data: item }); // N queries
}

// AFTER: 1 batch create
await prisma.student.createMany({
  data: items,
  skipDuplicates: true, // Ignores unique constraint violations
}); // 1 query
```
**Use when:** Inserting new records that might already exist. `skipDuplicates` silently ignores conflicts.

### 3.2 updateMany with `id: { in: [...] }`
```typescript
// BEFORE: N individual updates
for (const id of ids) {
  await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } }); // N queries
}

// AFTER: 1 batch update
await prisma.user.updateMany({
  where: { id: { in: ids } },
  data: { status: 'SUSPENDED' },
}); // 1 query
```
**Use when:** Updating multiple records with the same data. No unique constraint check needed.

### 3.3 Pre-fetch into Map for Change Detection
```typescript
// BEFORE: N individual findUnique calls
for (const epItem of epItems) {
  const existing = await prisma.student.findFirst({ where: { lrn: epItem.lrn } }); // N queries
  if (!existing) { /* create */ } else { /* check hash, update if changed */ }
}

// AFTER: 1 batch fetch + Map lookup
const existingStudents = await prisma.student.findMany({
  where: { lrn: { in: epItems.map(e => e.lrn) } },
});
const studentMap = new Map(existingStudents.map(s => [s.lrn, s]));
for (const epItem of epItems) {
  const existing = studentMap.get(epItem.lrn);
  if (!existing) { /* create */ } else { /* check hash, update if changed */ }
} // 1 query + N Map lookups (in-memory, instant)
```

### 3.4 Transaction Batching
```typescript
// For operations that must be atomic:
await prisma.$transaction([
  prisma.student.createMany({ data: newStudents, skipDuplicates: true }),
  prisma.enrollment.createMany({ data: newEnrollments, skipDuplicates: true }),
]); // 1 round-trip
```

### 3.5 Composite Unique Key Upserts
```typescript
// Prisma supports upsert on composite unique keys:
await prisma.classAssignment.upsert({
  where: {
    teacherId_subjectId_sectionId_schoolYear: {
      teacherId, subjectId, sectionId, schoolYear,
    },
  },
  create: { teacherId, subjectId, sectionId, schoolYear, isActive: true },
  update: { isActive: true },
});
```

---

## 4. Step-by-Step Implementation

### Phase 1: enrollproSync.ts — Student Upsert Loop (BIGGEST WIN)

**Current:** `enrollproSync.ts:364–648` — 800 iterations × 2–5 queries each
**Target:** ~5–10 batch queries total

#### Step 1.1: Pre-fetch all existing students into Map
```typescript
// BEFORE line 364 (inside the allLearners loop setup):
const allLrn = allLearners.map(l => l.lrn).filter(Boolean);
const existingStudents = await prisma.student.findMany({
  where: { lrn: { in: allLrn } },
  select: { id: true, lrn: true, dataHash: true },
});
const studentByLrn = new Map(existingStudents.map(s => [s.lrn, s]));
```

#### Step 1.2: Collect new students for batch create
```typescript
// Inside the loop, instead of prisma.student.create:
const newStudentsToCreate: StudentCreateInput[] = [];
// ... push to array instead of creating individually

// After the loop:
if (newStudentsToCreate.length > 0) {
  await prisma.student.createMany({
    data: newStudentsToCreate,
    skipDuplicates: true,
  });
  // Re-fetch to get IDs for enrollment creation
  const createdStudents = await prisma.student.findMany({
    where: { lrn: { in: newStudentsToCreate.map(s => s.lrn) } },
  });
  // Merge into studentByLrn map
}
```

#### Step 1.3: Batch enrollment operations
```typescript
// Collect all enrollment operations during the loop:
const enrollmentCreates: EnrollmentCreateInput[] = [];
const enrollmentUpdates: { where: EnrollmentWhereUnique; data: EnrollmentUpdateInput }[] = [];

// After the loop:
if (enrollmentCreates.length > 0) {
  await prisma.enrollment.createMany({
    data: enrollmentCreates,
    skipDuplicates: true,
  });
}
// For updates, batch with $transaction:
if (enrollmentUpdates.length > 0) {
  await prisma.$transaction(
    enrollmentUpdates.map(u => prisma.enrollment.update(u))
  );
}
```

#### Step 1.4: Batch stale enrollment drops
```typescript
// BEFORE: Per-section enrollment.findMany + enrollment.updateMany
// AFTER: Single query across all sections
const allSyncedStudentIds = new Set(allLearners.map(l => l.studentId).filter(Boolean));
await prisma.enrollment.updateMany({
  where: {
    sectionId: { in: allSectionIds },
    schoolYear: schoolYearLabel,
    status: 'ENROLLED',
    studentId: { notIn: [...allSyncedStudentIds] },
  },
  data: { status: 'DROPPED' },
});
```

### Phase 2: enrollproSync.ts — Enrichment Pass

**Current:** `enrollproSync.ts:654–757` — per-section × per-student DB calls
**Target:** Pre-fetch all students, batch updates

#### Step 2.1: Pre-fetch all students by LRN (reuse Map from Phase 1)
The `studentByLrn` Map from Phase 1 is still in scope. Reuse it for the enrichment pass.

#### Step 2.2: Batch student updates
```typescript
// Instead of individual student.update per student:
const studentsToUpdate: { where: { id: string }; data: StudentUpdateInput }[] = [];
// ... collect during enrichment loop

if (studentsToUpdate.length > 0) {
  await prisma.$transaction(
    studentsToUpdate.map(u => prisma.student.update(u))
  );
}
```

### Phase 3: enrollproSync.ts — Teacher Sync Loop

**Current:** `enrollproSync.ts:164–208` — per-teacher user.findFirst
**Target:** Pre-fetch users into Map

#### Step 3.1: Pre-fetch existing users
```typescript
const allUsernames = epTeachers.map(t => t.username || t.email);
const allEmails = epTeachers.map(t => t.email);
const existingUsers = await prisma.user.findMany({
  where: {
    OR: [
      { username: { in: allUsernames } },
      { email: { in: allEmails } },
    ],
  },
  select: { id: true, username: true, email: true },
});
const userByUsername = new Map(existingUsers.map(u => [u.username, u]));
const userByEmail = new Map(existingUsers.map(u => [u.email, u]));
```

### Phase 4: atlasSync.ts — Class Assignment Upserts

**Current:** `atlasSync.ts:533–582` — per-load upsert (~100–300/cycle)
**Target:** Pre-fetch existing, batch creates, batch updates

#### Step 4.1: Pre-fetch existing class assignments
```typescript
const existingAssignments = await prisma.classAssignment.findMany({
  where: { schoolYear: schoolYearLabel },
  select: { id: true, teacherId: true, subjectId: true, sectionId: true, schoolYear: true, isActive: true },
});
const assignmentKey = (t: string, s: string, sec: string, sy: string) => `${t}:${s}:${sec}:${sy}`;
const assignmentMap = new Map(existingAssignments.map(a => [
  assignmentKey(a.teacherId, a.subjectId, a.sectionId, a.schoolYear), a
]));
```

#### Step 4.2: Separate creates from updates
```typescript
const creates: ClassAssignmentCreateInput[] = [];
const updates: { where: { id: string }; data: ClassAssignmentUpdateInput }[] = [];
const reactivateIds: string[] = [];

for (const load of loads) {
  const key = assignmentKey(load.teacherId, load.subjectId, load.sectionId, schoolYearLabel);
  const existing = assignmentMap.get(key);
  if (!existing) {
    creates.push({ teacherId: load.teacherId, subjectId: load.subjectId, sectionId: load.sectionId, schoolYear: schoolYearLabel, isActive: true });
  } else if (!existing.isActive) {
    reactivateIds.push(existing.id);
  }
}

// Batch operations:
if (creates.length > 0) {
  await prisma.classAssignment.createMany({ data: creates, skipDuplicates: true });
}
if (reactivateIds.length > 0) {
  await prisma.classAssignment.updateMany({
    where: { id: { in: reactivateIds } },
    data: { isActive: true, archivedAt: null, archivedReason: null },
  });
}
```

### Phase 5: atlasSync.ts — Schedule Entry Upserts

**Current:** `atlasSync.ts:650–695` — per-entry upsert (~200–600/cycle)
**Target:** Pre-fetch existing, batch creates only

#### Step 5.1: Pre-fetch existing schedule entries (already done at line 642–648)
The existing code already builds a Map for dedup. Extend it to also track IDs for batch creates.

#### Step 5.2: Batch new schedule entries
```typescript
const newEntries: ScheduleEntryCreateInput[] = [];
// ... collect during loop

if (newEntries.length > 0) {
  await prisma.scheduleEntry.createMany({
    data: newEntries,
    skipDuplicates: true,
  });
}
```

### Phase 6: atlasSync.ts — Batch Reactivations

**Current:** `atlasSync.ts:716–747` — per-assignment reactivation check
**Target:** Single updateMany

```typescript
const reactivableIds = currentAssignments
  .filter(a => !a.isActive && matchedTeacherIds.has(a.teacherId))
  .map(a => a.id);

if (reactivableIds.length > 0) {
  await prisma.classAssignment.updateMany({
    where: { id: { in: reactivableIds } },
    data: { isActive: true, archivedAt: null, archivedReason: null },
  });
}
```

---

## 5. Dependency Graph — What Must Change Together

```
enrollproSync.ts (Phase 1-3)
  ├── Pre-fetch students Map ── used by student upsert loop AND enrichment pass
  ├── Batch student creates ── must re-fetch to get IDs for enrollment creates
  ├── Batch enrollment ops ── depends on student IDs
  └── Batch stale cleanup ── depends on allSyncedStudentIds set

atlasSync.ts (Phase 4-6)
  ├── Pre-fetch classAssignments ── used by upsert loop AND reactivation check
  ├── Batch creates + reactivations ── independent
  └── Batch scheduleEntry creates ── independent

teacherSync.ts (Optional)
  └── May reuse batch helpers from enrollproSync (lower priority)
```

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `createMany` skips silently on conflict | LOW | MEDIUM | `skipDuplicates: true` is intentional — log count of skipped records |
| Missing student IDs after batch create | MEDIUM | HIGH | Re-fetch by LRN after createMany, verify all IDs present |
| Race condition with concurrent sync cycles | LOW | LOW | Mutex boolean already prevents concurrent runs |
| Stale enrollment cleanup drops wrong records | LOW | HIGH | Use `studentId: { notIn: [...] }` with complete synced set; add logging |
| Transaction timeout on large batches | LOW | MEDIUM | Batch in chunks of 500 if needed; default Prisma timeout is 5s |
| Enrichment pass makes too many EP API calls | MEDIUM | LOW | Already has try/catch per section; network failures are non-fatal |

---

## 7. Testing Strategy

### 7.1 Before Changes
1. Run a full sync cycle: `pm2 logs server --lines 20`
2. Log the sync duration and query count (add temporary `console.time`/`console.timeEnd`)
3. Record the baseline: "Full sync completed in Xms | EnrollPro: Y learners"

### 7.2 After Each Phase
1. Restart server: `pm2 restart server`
2. Wait for auto-sync (5 min) or trigger manual sync via admin API
3. Check `pm2 logs server` for errors
4. Verify sync completed successfully
5. Check database counts: students, enrollments, classAssignments, scheduleEntries should match pre-change counts

### 7.3 Verification Queries
```sql
-- Students should match EP count
SELECT COUNT(*) FROM "Student" WHERE "lrn" IS NOT NULL;

-- Enrollments should match
SELECT COUNT(*) FROM "Enrollment" WHERE "schoolYear" = '2026-2027' AND "status" = 'ENROLLED';

-- Class assignments should match
SELECT COUNT(*) FROM "ClassAssignment" WHERE "schoolYear" = '2026-2027';

-- Schedule entries should match
SELECT COUNT(*) FROM "ScheduleEntry" WHERE "schoolYear" = '2026-2027';
```

### 7.4 Final Verification
1. Run 3 consecutive sync cycles (15 min)
2. All 3 should complete without errors
3. Data counts should be stable (no duplicates, no missing records)
4. Teacher login should still work (teacherSync uses same data)
5. Grade saving should still work (end-to-end test)

---

## 8. Implementation Order

| Step | File | What | Estimated Time |
|------|------|------|---------------|
| 1 | `enrollproSync.ts` | Pre-fetch students Map + batch student creates | 2 hours |
| 2 | `enrollproSync.ts` | Batch enrollment operations | 1 hour |
| 3 | `enrollproSync.ts` | Batch stale enrollment cleanup | 30 min |
| 4 | `enrollproSync.ts` | Pre-fetch users for teacher sync | 30 min |
| 5 | `enrollproSync.ts` | Batch enrichment updates | 1 hour |
| 6 | `atlasSync.ts` | Pre-fetch classAssignments + batch creates/reactivations | 1.5 hours |
| 7 | `atlasSync.ts` | Batch scheduleEntry creates | 1 hour |
| 8 | Testing | Verify all phases, run 3 sync cycles | 1 hour |
| **Total** | | | **~8.5 hours** |

---

## 9. Success Criteria

- [ ] Sync cycle completes without errors
- [ ] All data counts match pre-change baseline
- [ ] DB queries reduced from ~4,400–8,800 to ~300–600
- [ ] No duplicate records created
- [ ] No orphaned enrollments or missing students
- [ ] Teacher login and class loading still work
- [ ] Grade saving still works end-to-end
- [ ] 3 consecutive sync cycles pass without issues
