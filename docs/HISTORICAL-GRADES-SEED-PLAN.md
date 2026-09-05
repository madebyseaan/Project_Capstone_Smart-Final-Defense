# Historical Grades Seed Plan for SF10 Permanent Records

## Problem

SF10 (Permanent Record) displays a student's academic history across all school years (Grade 7-10). After a school year rollover, SMART only has data for the current year. Previous year's grades are not automatically preserved.

**Impact:** SF10 will show incomplete academic history for Grade 8-10 students.

## How EnrollPro Rollover Works (Context)

EnrollPro drives rollover as a **batch process for ALL grade levels simultaneously**:
- EOSY grades for all grade levels are archived at once
- Sections are cloned but empty (no advisers/learners)
- BOSY applications created for promoted students
- Grade 10 PROMOTED → JHS_COMPLETER

**SMART's role:** Provide grades when EnrollPro asks, then sync new year data. SMART does NOT initiate rollover.

## Current State

- EnrollPro has only **1 school year**: 2026-2027 (ACTIVE)
- No previous school years exist in EnrollPro
- SMART's Grade table stores grades linked to `classAssignment.schoolYear`
- SF10 code (`registrar.ts:1168-1403`) fetches grades across ALL school years — it works IF data exists
- After EnrollPro rollover, old year data remains in SMART (not deleted)
- SMART's `archive-year` endpoint freezes old year data as cleanup

## What Needs to Be Seeded

For each past school year (e.g., 2025-2026), create the full dependency chain:

### 1. Sections

```prisma
Section {
  name: string          // e.g., "Mabini", "Bonifacio"
  gradeLevel: int       // 7, 8, 9, or 10
  schoolYear: string    // e.g., "2025-2026"
  capacity: int         // default 50
}
```

### 2. ClassAssignments

```prisma
ClassAssignment {
  teacherId: string     // FK to existing teacher
  subjectId: string     // FK to existing subject
  sectionId: string     // FK to section above
  schoolYear: string    // e.g., "2025-2026"
  isActive: false       // archived since it's a past year
}
```

### 3. Enrollments

```prisma
Enrollment {
  studentId: string     // FK to existing student
  sectionId: string     // FK to section above
  schoolYear: string    // e.g., "2025-2026"
  status: ENROLLED
}
```

### 4. Grades

```prisma
Grade {
  studentId: string
  classAssignmentId: string
  term: T1 | T2 | T3
  quarterlyGrade: float
  writtenWorksScore: float
  performanceTasksScore: float
  quarterlyAssessmentScore: float
}
```

## Seed Script Requirements

### Input Data Format (CSV or JSON)

```csv
schoolYear,gradeLevel,section,studentLRN,subjectCode,term,T1_grade,T2_grade,T3_grade
2025-2026,7,Mabini,123456789012,FILIPINO7,T1,85,88,90
2025-2026,7,Mabini,123456789012,MATH7,T1,78,80,82
...
```

### Script Logic

```
1. Read seed data file
2. For each unique section:
   a. Upsert Section (schoolYear = past year)
3. For each unique class assignment:
   a. Upsert ClassAssignment (isActive = false)
4. For each enrollment:
   a. Upsert Enrollment
5. For each grade:
   a. Upsert Grade with T1/T2/T3 values
6. Calculate final grades (average of T1+T2+T3)
7. Verify SF10 returns correct historical data
```

### Validation Queries

```sql
-- Check sections exist for past year
SELECT * FROM "Section" WHERE "schoolYear" = '2025-2026';

-- Check grades exist for past year
SELECT g.*, ca."schoolYear"
FROM "Grade" g
JOIN "ClassAssignment" ca ON g."classAssignmentId" = ca.id
WHERE ca."schoolYear" = '2025-2026';

-- Check SF10 would return historical data
SELECT DISTINCT ca."schoolYear"
FROM "Grade" g
JOIN "ClassAssignment" ca ON g."classAssignmentId" = ca.id
WHERE g."studentId" = '<student-id>';
```

## DepEd Grade-Level Subject Mapping

Use existing subject codes from the database. Required subjects per grade level:

| Grade 7 | Grade 8 | Grade 9 | Grade 10 |
|---------|---------|---------|----------|
| FILIPINO7 | FILIPINO8 | FILIPINO9 | FILIPINO10 |
| MATH7 | MATH8 | MATH9 | MATH10 |
| SCIENCE7 | SCIENCE8 | SCIENCE9 | SCIENCE10 |
| ENGLISH7 | ENGLISH8 | ENGLISH9 | ENGLISH10 |
| MAPEH7 | MAPEH8 | MAPEH9 | MAPEH10 |
| VALUES7 | VALUES8 | VALUES9 | VALUES10 |
| TLE7 | TLE8 | TLE9 | TLE10 |
| ARALPAN7 | ARALPAN8 | ARALPAN9 | ARALPAN10 |

## Timeline

1. **Now:** Export current year (2026-2027) grades as seed data
2. **Seed past years:** Import 2025-2026 data (if available from manual records)
3. **Verify SF10:** Test that Permanent Records show multi-year history
4. **After EnrollPro rollover:** EnrollPro archives old year, creates new year
5. **Verify again:** SF10 should show 2025-2026 + 2026-2027 data
6. **Optional:** Call SMART `archive-year` endpoint to freeze old year

## Notes

- Seeded grades are READ-ONLY in SMART (no edit UI for past years)
- `ClassAssignment.isActive = false` prevents past year data from appearing in teacher dashboards
- The `schoolYear` string is the only link between years — no FK relationship
- Grade calculation: `finalGrade = round(avg(T1, T2, T3))`
- Honors threshold: ≥98 Highest Honors, ≥95 High Honors, ≥90 Honors
