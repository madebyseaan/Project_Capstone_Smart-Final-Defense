# Fix-Registrar-Sync: Comprehensive Data Fix Plan

**Status**: PLANNING — DO NOT implement until user approves  
**Scope**: Full audit of every data path in the Registrar module  
**Goal**: Every piece of data the Registrar sees comes from EnrollPro/ATLAS/AIMS (live or synced), never stale local-only data

---

## Architecture: How It Should Work

```
Registrar Logs In
  → auth.ts triggers triggerImmediateSync("registrar_login")
  → syncCoordinator.ts → enrollproSync.ts runs
      → Fetches ALL sections (paginated) from EnrollPro
      → Fetches ALL learners (paginated) from EnrollPro
      → Upserts into SMART local DB (Student, Section, Enrollment)
      → Gender stored as EnrollPro's raw `sex` field ("MALE"/"FEMALE")
  → Dashboard loads → Fetches LIVE metrics from EnrollPro for display
  → Student Records loads → Reads from SMART local DB (populated by sync)
  → School Forms loads → Reads grades from SMART local DB (SMART is source of truth for grades)
```

**Key Principle**: EnrollPro is the source of truth for student identity (name, LRN, sex, birthdate, section, enrollment status). SMART is the source of truth for grades (quarterly grades, final averages). ATLAS is the source of truth for teacher assignments. AIMS is the source of truth for quiz/task scores (read-only cross-check).

---

## BUGS FOUND — Full Scan Results

### 🔴 BUG 1: Background Sync Only Fetches 50 of 66 Sections

**File**: `server/src/lib/enrollproSync.ts` — Line 148  
**Code**:
```ts
const epSections = await getIntegrationV1Sections(schoolYearId);
```

**Problem**: `getIntegrationV1Sections()` without pagination params hits EnrollPro's default limit of 50. There are 66 sections in EnrollPro. The background sync only creates 50 sections in SMART's local DB. This means:
- 16 sections are never created locally
- Students enrolled in those 16 sections are orphaned (their enrollment upsert fails silently because `resolvedSectionId` is undefined)
- Student Records, SF9, SF10, SF1 exports are all incomplete

**Fix**: Change to `getAllIntegrationV1Sections(schoolYearId)` which paginates automatically.

**Impact**: HIGH — This is the root cause of most stale data. Fixing this alone will cascade-fix many downstream issues.

---

### 🔴 BUG 2: Dashboard Male/Female Count Reads Stale Local DB

**File**: `server/src/routes/registrar.ts` — Lines 122-123  
**Code**:
```ts
let maleCount = localEnrolledStudents.filter((row) => normalizeSex(row.student.gender) === "male").length;
let femaleCount = localEnrolledStudents.filter((row) => normalizeSex(row.student.gender) === "female").length;
```

**Problem**: These values are set from `prisma.enrollment.findMany()` (local DB), and they are **never overwritten** by the EnrollPro live-fetch block (lines 144-178). The EnrollPro block only updates `totalStudents` and `totalSections` — it never touches `maleCount` or `femaleCount`.

The `normalizeSex()` function (line 71-76) does handle `"MALE"` → `"male"` correctly (it lowercases first). But because the background sync only synced 50 of 66 sections, ~200+ students were never synced, so their gender is missing entirely.

**Fix**: After the EnrollPro sections are fetched, compute male/female from the section data, OR fetch a full learner page with sex breakdown from EnrollPro. The lightest fix: fetch learners with `limit=500` and count `learner.sex` values directly from the response.

---

### 🔴 BUG 3: Student Records Page Reads SMART Local DB Only

**File**: `server/src/routes/registrar.ts` — Lines 308-432 (`GET /registrar/students`)  
**Code**:
```ts
const enrollments = await prisma.enrollment.findMany({
  where: enrollmentWhere,
  include: { student: true, section: { ... } },
});
```
**Response**: `source: "smart-db-fallback"` (line 426)

**Problem**: There is no EnrollPro live path at all. This route ONLY reads from the local SMART DB. Because the background sync missed 16 sections (Bug #1), ~200+ students are completely absent from this page. The gender field shows whatever was stored during sync — raw `"MALE"`/`"FEMALE"` from EnrollPro's `learner.sex`.

**Fix**: After Bug #1 is fixed, the local DB will have all students. But the `/students` route should also normalize gender for display and add an `enrollproId` or `externalId` field for cross-referencing.

---

### 🟠 BUG 4: Gender Badge Always Shows Pink on Frontend

**File**: `src/pages/registrar/StudentRecords.tsx` — Lines 204-205, 413, 477  
**Code**:
```tsx
male: filteredStudents.filter((s) => s.gender === "Male").length,
female: filteredStudents.filter((s) => s.gender === "Female").length,
```
And:
```tsx
className={student.gender === "Male" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}
```

**Problem**: EnrollPro sends `"MALE"` (uppercase). The sync stores it as-is. The frontend checks for `"Male"` (title-case). It never matches → male count is always 0, all badges are pink.

**Also in**: `src/pages/registrar/SchoolForms.tsx` — Line 404 (same `=== "Male"` check)

**Fix**: Backend should normalize gender to title-case (`"Male"` / `"Female"`) before sending to the frontend. Add a `normalizeDisplaySex()` helper to `registrar.ts` that converts `"MALE"` → `"Male"`.

---

### 🟠 BUG 5: School Year Hardcoded in Multiple Frontend Pages

**File**: `src/pages/registrar/StudentRecords.tsx` — Line 97  
```tsx
const [selectedSchoolYear, setSelectedSchoolYear] = useState("2026-2027");
```
Lines 313-316: Hardcoded `<SelectItem>` values.

**File**: `src/pages/registrar/SchoolForms.tsx` — Line 98  
```tsx
const [schoolYear, setSchoolYear] = useState("2026-2027");
```
Lines 262-265: Hardcoded `<SelectItem>` values.

**File**: `server/src/routes/registrar.ts` — Line 777  
```ts
const currentSchoolYear = (schoolYear as string) || "2026-2027";  // SF8 route
```
Line 926:
```ts
const currentSchoolYear = (schoolYear as string) || "2024-2025";  // Sections route — DIFFERENT default!
```

**Problem**: Different hardcoded defaults across routes. Frontend doesn't fetch from `GET /registrar/school-years`. If the active SY changes in EnrollPro, these won't update.

**Fix**: Frontend must call `registrarApi.getSchoolYears()` on mount and use the first result as default. Backend should use `resolveCurrentSchoolYearLabel()` consistently (it already exists and reads from system settings).

---

### 🟠 BUG 6: Enrollment.tsx Is Wrong Concept — Remove It

**File**: `src/pages/registrar/Enrollment.tsx` (275 lines)

**Problem**: This page shows a student masterlist with a "Synced Student Masterlist" title and a sync badge. It duplicates `StudentRecords.tsx` and implies SMART manages enrollments. EnrollPro owns enrollments.

**Fix**: Remove `Enrollment.tsx` entirely. Remove its route from the router. Remove its nav link from the sidebar. `StudentRecords.tsx` is the canonical student list.

---

### 🟡 BUG 7: SF9/SF10 Show Raw Gender from Local DB

**File**: `server/src/routes/registrar.ts` — Line 585 (SF9) and Line 752 (SF10)  
```ts
gender: student.gender,  // Raw value from DB, e.g., "MALE"
```

**Problem**: The SF9 form at SchoolForms.tsx line 549 displays this directly:
```tsx
{sf9Data.student.gender || "____"}
```
So the form shows "MALE" instead of "Male". For an official DepEd form, this should be "Male" or "Female".

**Fix**: Normalize in the SF9/SF10 backend responses using `normalizeDisplaySex()`.

---

### 🟡 BUG 8: SF1 Export Uses Local DB Gender Without Normalization

**File**: `server/src/routes/registrar.ts` — Line 1036 (SF1 template), Line 1089 (fallback)  
```ts
GENDER: enrollment.student.gender || "",
```

**Problem**: Exports "MALE" instead of "Male" in the Excel file.

**Fix**: Apply `normalizeDisplaySex()` before passing to template data.

---

### 🟡 BUG 9: `enrollproSync.ts` Imports Old `getIntegrationV1Sections` 

**File**: `server/src/lib/enrollproSync.ts` — Line 23  
```ts
import { getIntegrationV1Sections, ... } from './enrollproClient';
```

**Problem**: Uses the single-page version. Must switch to `getAllIntegrationV1Sections`.

**Fix**: Change import and call on line 148.

---

## WHAT DATA COMES FROM WHERE — Complete Map

### From EnrollPro (Source of Truth for Student Identity)

| Data | EnrollPro Endpoint | Where Used | Current Status |
|------|-------------------|------------|----------------|
| Total students count | `GET /integration/v1/learners?limit=1` → `meta.total` | Dashboard card | ✅ Working |
| All sections + enrolled counts | `GET /integration/v1/sections` (paginated) | Dashboard, section lists | ⚠️ Fixed in registrar.ts but NOT in enrollproSync.ts |
| Student name, LRN, sex, birthdate | `GET /integration/v1/learners` (paginated) | Background sync → local DB | ⚠️ Only 50/66 sections synced |
| Gender (sex) | `learner.sex` field ("MALE"/"FEMALE") | Dashboard, Student Records, SF9, SF10, SF1 | 🔴 Not normalized for display |
| Section learner roster | `GET /integration/v1/sections/:id/learners` | Section Roster page | ✅ Working (live proxy) |
| School year | `GET /integration/v1/school-year` | School year resolver | ✅ Working |
| Faculty/advisers | `GET /integration/v1/faculty` | Sync for adviser assignment | ✅ Working |
| Enrollment applications | `GET /api/applications` | Applications page | ✅ Wired (proxy) |
| BOSY queue | `GET /api/bosy/queue` | BOSY page | ✅ Wired (proxy) |
| Remedial pending | `GET /api/remedial/pending` | Remedial page | ✅ Wired (proxy) |
| EOSY sections/records/SF5/SF6 | `GET /api/eosy/*` | EOSY pages | ✅ Wired (proxy) |

### From ATLAS (Source of Truth for Teacher Assignments)

| Data | ATLAS Endpoint | Where Used | Current Status |
|------|---------------|------------|----------------|
| Teaching load summary | `GET /faculty-assignments/summary` | Teaching Load page | ✅ Wired (proxy) |
| Subject coverage stats | `GET /subjects/stats/:schoolId` | Subject Coverage page | ✅ Wired (proxy) |
| Faculty sync (background) | `POST /faculty/sync` | syncCoordinator → atlasSync | ✅ Working |

### From AIMS (Source of Truth for Quiz/Task Scores)

| Data | AIMS Endpoint | Where Used | Current Status |
|------|-------------|------------|----------------|
| Course gradebook | `GET /dashboard/course/:id/gradebook` | Not used yet | ❌ Not integrated |
| Health check | `GET /health` | Admin system health | ✅ Working |

**AIMS Note**: AIMS is a teacher/student LMS. The Registrar does NOT directly need AIMS data. The only potential use is cross-checking a student's quarterly grade against the AIMS gradebook for SF9 verification, but SMART already computes grades from its own synced data.

### From SMART Local DB (Source of Truth for Grades)

| Data | Table/Model | Where Used | Status |
|------|-------------|------------|--------|
| Quarterly grades (Q1-Q4) | `Grade` model | SF9, SF10, SF8, Class Records | ✅ Correct source |
| Class assignments | `ClassAssignment` model | SF8, grade computation | ✅ Correct source |
| Subjects | `Subject` model | SF9, SF10, SF8 | ✅ Correct source |
| System settings (school name, SY) | `SystemSettings` model | All forms, headers | ✅ Correct source |

---

## FIX EXECUTION PLAN — Step by Step Instructions

### Step 1: Fix Background Sync Pagination (Critical)

**File**: `server/src/lib/enrollproSync.ts`

1. **Line 23**: Change import:
   ```diff
   - import { getIntegrationV1Sections, ... } from './enrollproClient';
   + import { getAllIntegrationV1Sections, ... } from './enrollproClient';
   ```

2. **Line 148**: Change call:
   ```diff
   - const epSections = await getIntegrationV1Sections(schoolYearId);
   + const epSections = await getAllIntegrationV1Sections(schoolYearId);
   ```

**Verification**: After restarting, force sync and check console: `[EnrollProSync] Loaded 66 sections from EnrollPro` (was 50).

---

### Step 2: Add `normalizeDisplaySex()` Helper

**File**: `server/src/routes/registrar.ts`

Add after the existing `normalizeSex()` function (line 76):
```ts
/** Normalize raw sex/gender values for display on frontend and official forms. */
function normalizeDisplaySex(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "MALE" || value === "M") return "Male";
  if (value === "FEMALE" || value === "F") return "Female";
  return "Unknown";
}
```

---

### Step 3: Fix Dashboard Gender Counts

**File**: `server/src/routes/registrar.ts` — Dashboard route

Inside the `try` block (after line 176 where `totalSections` is set), add gender computation from EnrollPro learner data:

```ts
// Fetch a page of learners (up to 500) for gender breakdown
try {
  const learnersForGender = await getIntegrationV1LearnersPage(resolvedSchoolYear.id, 1, 500);
  const learnerData = learnersForGender.data ?? [];
  const totalPages = learnersForGender.meta?.totalPages ?? 1;
  
  let allLearnerData = [...learnerData];
  // If more than 500 students, fetch remaining pages
  for (let p = 2; p <= totalPages; p++) {
    const page = await getIntegrationV1LearnersPage(resolvedSchoolYear.id, p, 500);
    allLearnerData.push(...(page.data ?? []));
  }
  
  maleCount = allLearnerData.filter((r: any) => 
    normalizeSex(r.learner?.sex) === "male"
  ).length;
  femaleCount = allLearnerData.filter((r: any) => 
    normalizeSex(r.learner?.sex) === "female"
  ).length;
  
  // Also recompute grade stats from EnrollPro sections
  Object.keys(gradeStats).forEach(k => gradeStats[k] = 0);
  epSections.forEach((section: any) => {
    const gl = normalizeGradeLevel(section?.gradeLevel?.name);
    if (gl && gradeStats[gl] !== undefined) {
      gradeStats[gl] += Number(section?.enrolledCount ?? 0);
    }
  });
} catch (genderErr) {
  console.warn("[RegistrarDashboard] Gender count fallback to local DB:", (genderErr as Error).message);
}
```

---

### Step 4: Fix `/registrar/students` Route — Normalize Gender

**File**: `server/src/routes/registrar.ts` — Lines 364-382

In the transform map, change:
```diff
- gender: e.student.gender,
+ gender: normalizeDisplaySex(e.student.gender),
```

And in the stats block (lines 411-412):
```diff
- male: students.filter(s => s.gender?.toLowerCase() === "male").length,
- female: students.filter(s => s.gender?.toLowerCase() === "female").length,
+ male: students.filter(s => s.gender === "Male").length,
+ female: students.filter(s => s.gender === "Female").length,
```

---

### Step 5: Fix SF9 and SF10 Gender Display

**File**: `server/src/routes/registrar.ts`

**SF9** (line 585):
```diff
- gender: student.gender,
+ gender: normalizeDisplaySex(student.gender),
```

**SF10** (line 753):
```diff
- gender: student.gender,
+ gender: normalizeDisplaySex(student.gender),
```

---

### Step 6: Fix SF1 Export Gender

**File**: `server/src/routes/registrar.ts`

**Template path** (line 1036):
```diff
- GENDER: enrollment.student.gender || "",
+ GENDER: normalizeDisplaySex(enrollment.student.gender),
```

**Fallback path** (line 1089):
```diff
- student.gender || "",
+ normalizeDisplaySex(student.gender),
```

---

### Step 7: Fix SF8 Class Record Gender

**File**: `server/src/routes/registrar.ts` — Line 869

```diff
- gender: e.student.gender,
+ gender: normalizeDisplaySex(e.student.gender),
```

---

### Step 8: Fix Hardcoded School Years in Frontend

**File**: `src/pages/registrar/StudentRecords.tsx`

1. Add state for school years:
   ```ts
   const [schoolYears, setSchoolYears] = useState<string[]>([]);
   ```

2. Fetch on mount:
   ```ts
   useEffect(() => {
     registrarApi.getSchoolYears().then(res => {
       const years = res.data.schoolYears;
       setSchoolYears(years);
       if (years.length > 0) setSelectedSchoolYear(years[0]);
     }).catch(console.error);
   }, []);
   ```

3. Replace hardcoded `<SelectItem>` (lines 313-316) with dynamic:
   ```tsx
   {schoolYears.map(sy => (
     <SelectItem key={sy} value={sy}>{sy}</SelectItem>
   ))}
   ```

**Same fix for**: `src/pages/registrar/SchoolForms.tsx` — Lines 98, 262-265

---

### Step 9: Fix Backend Hardcoded School Year Defaults

**File**: `server/src/routes/registrar.ts`

**SF8 route** (line 777):
```diff
- const currentSchoolYear = (schoolYear as string) || "2026-2027";
+ const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();
```

**Sections route** (line 926):
```diff
- const currentSchoolYear = (schoolYear as string) || "2024-2025";
+ const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();
```

---

### Step 10: Remove Enrollment.tsx

1. Delete file: `src/pages/registrar/Enrollment.tsx`
2. Remove its route from the router (in the file that defines registrar routes in App.tsx or the layout)
3. Remove its nav link from the sidebar (the nav array that contains `{ name: "Enrollment", ... }` — if it still exists)
4. Verify `StudentRecords.tsx` is the only student list page

---

### Step 11: Fix Frontend Gender Comparison (Defense-in-Depth)

Even after backend normalization, add case-insensitive checks as safety:

**File**: `src/pages/registrar/StudentRecords.tsx` — Lines 204-205
```diff
- male: filteredStudents.filter((s) => s.gender === "Male").length,
- female: filteredStudents.filter((s) => s.gender === "Female").length,
+ male: filteredStudents.filter((s) => (s.gender ?? "").toLowerCase() === "male").length,
+ female: filteredStudents.filter((s) => (s.gender ?? "").toLowerCase() === "female").length,
```

Lines 413, 477 (badge class):
```diff
- className={student.gender === "Male" ? "bg-blue-100 ..." : "bg-pink-100 ..."}
+ className={(student.gender ?? "").toLowerCase() === "male" ? "bg-blue-100 ..." : "bg-pink-100 ..."}
```

**Same fix for**: `src/pages/registrar/SchoolForms.tsx` — Line 404

---

## VERIFICATION CHECKLIST

After all fixes are applied:

- [ ] Restart server, force sync → Console shows `Loaded 66 sections from EnrollPro`
- [ ] Dashboard → Total Students shows EnrollPro real-time count
- [ ] Dashboard → Male/Female counts are non-zero and sum to ~total
- [ ] Dashboard → Sections shows 66 (not 50)
- [ ] Dashboard → Grade distribution sums to total students
- [ ] Student Records → Shows all students (not just from 50 sections)
- [ ] Student Records → Gender badges show correct blue/pink colors
- [ ] Student Records → School year dropdown is dynamic (not hardcoded)
- [ ] School Forms → SF9 shows "Male" or "Female" (not "MALE")
- [ ] School Forms → SF10 shows normalized gender
- [ ] School Forms → School year dropdown is dynamic
- [ ] SF1 Export → Gender column shows "Male"/"Female" in Excel
- [ ] Enrollment.tsx page is removed, nav link gone
- [ ] No TypeScript compilation errors

---

## FILES MODIFIED (Summary)

| File | Changes |
|------|---------|
| `server/src/lib/enrollproSync.ts` | Import + call `getAllIntegrationV1Sections` |
| `server/src/routes/registrar.ts` | Add `normalizeDisplaySex()`, fix dashboard gender, fix `/students` gender, fix SF9/SF10/SF8/SF1 gender, fix hardcoded school years |
| `src/pages/registrar/StudentRecords.tsx` | Dynamic school years, case-insensitive gender checks |
| `src/pages/registrar/SchoolForms.tsx` | Dynamic school years, case-insensitive gender check |
| `src/pages/registrar/Enrollment.tsx` | DELETE |
| Router/Nav file | Remove Enrollment route and nav link |

---

> ✅ **Approve this plan before any code changes are made.**
