# SMART System — Copilot Implementation Instructions
**Branch:** `master` | Read `Smart.Md` first before touching any file.

---

## BEFORE YOU START — HARD RULES

1. Never write to EnrollPro, ATLAS, or AIMS. SMART is read-only from those systems.
2. SMART writes only to its own database (`smart_db` via Prisma).
3. If you change `schema.prisma`, always run `prisma db push` then `prisma generate` before touching routes.
4. Keep backend routes, frontend pages, and `src/lib/api.ts` in sync — if you add a backend endpoint, add its typed wrapper in `api.ts`.
5. HG (Homeroom Guidance) subjects are qualitative-only. Never compute numeric averages for HG. ECR is blocked for HG.
6. Quarter end dates (`q1EndDate`…`q4EndDate`) and `currentQuarter` already exist in the `SystemSettings` Prisma model. Use them.

---

## SECTION 1 — QUARTER DEADLINE NOTIFICATION SYSTEM (Teacher)

### What to build

When a quarter's end date is near, teachers need to be warned that they should finish entering grades. The system already stores `q1EndDate`, `q2EndDate`, `q3EndDate`, `q4EndDate`, and `currentQuarter` in `SystemSettings`.

### Notification logic (3 tiers)

| State | Condition | Style | Message |
|---|---|---|---|
| **Reminder** | 7–4 days before quarter end | Blue info banner | "Quarter ends in X days. Make sure grades are complete." |
| **Warning** | 3–2 days before quarter end | Amber warning banner | "⚠ X days left. Unsubmitted grades will be locked soon." |
| **Urgent** | 1 day or same day | Red urgent banner | "🔴 Grades due TODAY. Submit all grades immediately." |
| **Overdue** | Past the end date but grades missing | Red persistent banner | "Grade submission period has ended. Contact your admin." |

---

### Step 1 — Backend: Add deadline endpoint

**File:** `server/src/routes/grades.ts`

Add this endpoint (authenticated, teacher only):

```
GET /api/grades/deadline-status
```

**Logic:**

```typescript
router.get("/deadline-status", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  if (!settings) { res.json({ notification: null }); return; }

  const now = new Date();
  const currentQuarter = settings.currentQuarter; // "Q1" | "Q2" | "Q3" | "Q4"

  // Map current quarter to its end date
  const endDateMap: Record<string, Date | null> = {
    Q1: settings.q1EndDate,
    Q2: settings.q2EndDate,
    Q3: settings.q3EndDate,
    Q4: settings.q4EndDate,
  };
  const endDate = endDateMap[currentQuarter];

  if (!endDate) { res.json({ notification: null }); return; }

  const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  let tier: "reminder" | "warning" | "urgent" | "overdue" | null = null;
  if (daysLeft < 0) tier = "overdue";
  else if (daysLeft === 0 || daysLeft === 1) tier = "urgent";
  else if (daysLeft <= 3) tier = "warning";
  else if (daysLeft <= 7) tier = "reminder";

  if (!tier) { res.json({ notification: null }); return; }

  // Count how many of the teacher's class assignments have incomplete grades
  // for the current quarter (enrolled students with no grade record)
  const teacherId = req.user?.teacherId;
  let classesWithMissingGrades = 0;
  if (teacherId) {
    const assignments = await prisma.classAssignment.findMany({
      where: { teacherId, schoolYear: settings.currentSchoolYear },
      include: {
        subject: true,
        section: { include: { enrollments: { where: { status: "ENROLLED" } } } },
        grades: { where: { quarter: currentQuarter as any } },
      },
    });
    for (const a of assignments) {
      const isHG = /homeroom|hg/i.test(a.subject.name);
      if (isHG) continue; // HG grading is optional/qualitative, skip for deadline count
      const enrolled = a.section.enrollments.length;
      const graded = a.grades.length;
      if (graded < enrolled) classesWithMissingGrades++;
    }
  }

  res.json({
    notification: {
      tier,
      daysLeft,
      quarter: currentQuarter,
      endDate: endDate.toISOString(),
      classesWithMissingGrades,
    },
  });
});
```

---

### Step 2 — Frontend: Add API wrapper

**File:** `src/lib/api.ts` — inside `gradesApi`:

```typescript
getDeadlineStatus: () =>
  api.get<{
    notification: {
      tier: "reminder" | "warning" | "urgent" | "overdue";
      daysLeft: number;
      quarter: string;
      endDate: string;
      classesWithMissingGrades: number;
    } | null;
  }>("/grades/deadline-status"),
```

---

### Step 3 — Frontend: Create the notification banner component

**New file:** `src/components/QuarterDeadlineBanner.tsx`

```tsx
import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Bell, X } from "lucide-react";
import { gradesApi } from "@/lib/api";

interface DeadlineNotification {
  tier: "reminder" | "warning" | "urgent" | "overdue";
  daysLeft: number;
  quarter: string;
  endDate: string;
  classesWithMissingGrades: number;
}

export default function QuarterDeadlineBanner() {
  const [notification, setNotification] = useState<DeadlineNotification | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    gradesApi.getDeadlineStatus()
      .then(res => setNotification(res.data.notification))
      .catch(() => {});
  }, []);

  if (!notification || dismissed) return null;
  // Urgent and overdue cannot be dismissed
  const canDismiss = notification.tier === "reminder" || notification.tier === "warning";

  const config = {
    reminder: {
      bg: "bg-blue-50 border-blue-200",
      icon: <Bell className="w-5 h-5 text-blue-600" />,
      title: `Reminder: ${notification.quarter} ends in ${notification.daysLeft} day${notification.daysLeft !== 1 ? "s" : ""}`,
      text: notification.classesWithMissingGrades > 0
        ? `You have ${notification.classesWithMissingGrades} class${notification.classesWithMissingGrades !== 1 ? "es" : ""} with incomplete grades. Please finish encoding before the quarter closes.`
        : "All your classes are graded. You're on track!",
      textColor: "text-blue-800",
    },
    warning: {
      bg: "bg-amber-50 border-amber-300",
      icon: <AlertTriangle className="w-5 h-5 text-amber-600" />,
      title: `⚠ Warning: Only ${notification.daysLeft} day${notification.daysLeft !== 1 ? "s" : ""} left for ${notification.quarter} grade submission`,
      text: notification.classesWithMissingGrades > 0
        ? `${notification.classesWithMissingGrades} class${notification.classesWithMissingGrades !== 1 ? "es" : ""} still have missing grades. Unsubmitted grades may be locked after the deadline.`
        : "All grades submitted. Great work!",
      textColor: "text-amber-800",
    },
    urgent: {
      bg: "bg-red-50 border-red-400",
      icon: <Clock className="w-5 h-5 text-red-600 animate-pulse" />,
      title: notification.daysLeft === 0
        ? `🔴 URGENT: ${notification.quarter} grade deadline is TODAY`
        : `🔴 URGENT: ${notification.quarter} grade deadline is TOMORROW`,
      text: notification.classesWithMissingGrades > 0
        ? `${notification.classesWithMissingGrades} class${notification.classesWithMissingGrades !== 1 ? "es" : ""} still have missing grades. Submit all grades immediately.`
        : "All grades submitted before the deadline!",
      textColor: "text-red-800",
    },
    overdue: {
      bg: "bg-red-100 border-red-500",
      icon: <AlertTriangle className="w-5 h-5 text-red-700" />,
      title: `Grade submission period for ${notification.quarter} has ended`,
      text: "If you still have missing grades, contact your administrator immediately.",
      textColor: "text-red-900",
    },
  };

  const c = config[notification.tier];

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${c.bg} mb-4`}>
      <div className="mt-0.5 shrink-0">{c.icon}</div>
      <div className="flex-1">
        <p className={`font-semibold text-sm ${c.textColor}`}>{c.title}</p>
        <p className={`text-sm mt-0.5 ${c.textColor} opacity-80`}>{c.text}</p>
      </div>
      {canDismiss && (
        <button onClick={() => setDismissed(true)} className="shrink-0 mt-0.5 opacity-50 hover:opacity-100">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
```

---

### Step 4 — Mount the banner in teacher pages

**File:** `src/pages/teacher/Dashboard.tsx`

Import and place the banner at the top of the page content, before the stats cards:

```tsx
import QuarterDeadlineBanner from "@/components/QuarterDeadlineBanner";

// Inside the return, before the first stats grid:
<QuarterDeadlineBanner />
```

**File:** `src/pages/teacher/ClassRecordsList.tsx`

Same import and placement — put the banner at the top of the page, above the header section.

**File:** `src/pages/teacher/ClassRecordView.tsx`

Same import. Place it at the top of the page content area.

---

### Step 5 — Add notification dot to sidebar (TeacherLayout)

**File:** `src/layouts/TeacherLayout.tsx`

Add a notification dot on the "Class Records" nav item when a deadline is near:

```tsx
// Add state at top of component:
const [deadlineTier, setDeadlineTier] = useState<string | null>(null);

// Fetch on mount:
useEffect(() => {
  import("@/lib/api").then(({ gradesApi }) => {
    gradesApi.getDeadlineStatus()
      .then(res => setDeadlineTier(res.data.notification?.tier ?? null))
      .catch(() => {});
  });
}, []);

// In the nav item for "Class Records", add a dot indicator:
// If deadlineTier is "warning", "urgent", or "overdue", show a colored dot
const dotColor = {
  reminder: "bg-blue-500",
  warning: "bg-amber-500",
  urgent: "bg-red-500",
  overdue: "bg-red-600",
}[deadlineTier ?? ""] ?? null;

// On the nav item JSX, add alongside the icon:
{dotColor && <span className={`w-2 h-2 rounded-full ${dotColor} animate-pulse`} />}
```

---

---

## SECTION 2 — TEACHER PORTAL (additional fixes)

### 2A — Teacher Dashboard: fix hardcoded school year

**File:** `src/pages/teacher/Dashboard.tsx`

The dashboard currently fetches data but the school year context comes from the backend. No change needed — the backend resolves school year from `SystemSettings`.

**What to fix:** The dashboard summary shows `gradeSubmissionRate` (what % of students have grades this quarter). Verify this number uses `settings.currentQuarter` on the backend, not a hardcoded "Q1". Check `server/src/routes/grades.ts` endpoint `/dashboard-stats` and confirm it reads `currentQuarter` from `SystemSettings`.

---

### 2B — Class Records List: show current quarter badge

**File:** `src/pages/teacher/ClassRecordsList.tsx`

Each class card should show a small badge with the current active quarter (Q1/Q2/Q3/Q4). Fetch `adminApi.getSettings()` once on mount and display `settings.currentQuarter` as a badge in the page header. Example: `"Now encoding: Q2 grades"`

---

### 2C — ClassRecordView: HG classes block numeric input

**File:** `src/pages/teacher/ClassRecordView.tsx`

Already implemented per master branch. Verify:
- HG classes show the qualitative descriptor dropdown (No Improvement / Needs Improvement / Developing / Sufficiently Developed)
- HG classes hide the ECR import/preview buttons
- HG classes hide the written work and performance task numeric columns

If any of these are missing, check the `isHG` flag logic in the component. The backend already returns `isHG` as part of the class record response.

---

### 2D — Teacher: MyAdvisory page grade profile

**File:** `src/pages/teacher/StudentGradeProfile.tsx`

Already implemented per master branch. Verify:
- HG grades display qualitative descriptors, not numbers
- HG subject is excluded from the general average computation
- General average shows clearly in the student profile header

---

---

## SECTION 3 — REGISTRAR PORTAL

### 3A — Enrollment page — FULL REWRITE REQUIRED

**File:** `src/pages/registrar/Enrollment.tsx`

**Current problem:** Entire page uses a hardcoded `mockEnrollments` array. The approve/reject actions and "New Enrollment" button violate the system rule (EnrollPro owns enrollment).

**Rewrite instructions:**

1. Delete the `mockEnrollments` array and all mock-related constants.
2. Remove the "New Enrollment" button from the header.
3. Remove the approve/reject dropdown actions.
4. Replace with a real data fetch:

```typescript
// On mount, fetch:
const [enrollments, setEnrollments] = useState([]);
const [syncInfo, setSyncInfo] = useState<{ lastSync: string | null }>({ lastSync: null });
const [syncing, setSyncing] = useState(false);

useEffect(() => {
  // Fetch real enrollments
  registrarApi.getStudents({ schoolYear: selectedYear })
    .then(res => {
      const students = res.data.students || res.data;
      setEnrollments(students);
    });
  // Fetch last sync time from settings
  adminApi.getSettings()
    .then(res => setSyncInfo({ lastSync: res.data.settings.lastEnrollProSync }));
}, [selectedYear]);
```

5. Add a sync status banner at the top:
```
┌──────────────────────────────────────────────────────┐
│  🔄 EnrollPro  Connected                             │
│  Students and enrollment data are synced from        │
│  EnrollPro automatically every 5 minutes.            │
│  Last synced: [timestamp]    [Sync Now]              │
└──────────────────────────────────────────────────────┘
```

6. The "Sync Now" button calls `advisoryApi.syncFromEnrollPro()` (already exists in `api.ts`) then re-fetches.

7. The table columns change to: LRN | Student Name | Grade Level | Section | Enrollment Status | School Year

8. Enrollment Status badge maps to real `EnrollmentStatus` values:
   - `ENROLLED` → green "Enrolled"
   - `PENDING` → amber "Pending"
   - `DROPPED` → gray "Dropped"
   - `TRANSFERRED` → blue "Transferred"

9. Keep the search and school year filter. Keep the tab structure (All / Enrolled / Pending / Dropped) but filter the real data.

---

### 3B — School Forms — SF1 backend + frontend

**File to create:** `server/src/routes/registrar.ts` (add the endpoint — check if the route file already exists first)

**New endpoint:**
```
GET /api/registrar/sf1/:sectionId?schoolYear=2026-2027
```

**Backend query:**
```typescript
router.get("/sf1/:sectionId", authenticateToken, requireRegistrar, async (req, res) => {
  const { sectionId } = req.params;
  const { schoolYear } = req.query as { schoolYear?: string };
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  const sy = schoolYear || settings?.currentSchoolYear;

  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: {
      adviser: { include: { user: true } },
      enrollments: {
        where: { schoolYear: sy, status: "ENROLLED" },
        include: { student: true },
        orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
      },
    },
  });

  if (!section) return res.status(404).json({ message: "Section not found" });

  res.json({
    section: {
      id: section.id,
      name: section.name,
      gradeLevel: section.gradeLevel,
      schoolYear: sy,
      adviser: section.adviser
        ? `${section.adviser.user.lastName}, ${section.adviser.user.firstName}`
        : null,
    },
    students: section.enrollments.map((e, i) => ({
      no: i + 1,
      lrn: e.student.lrn,
      lastName: e.student.lastName,
      firstName: e.student.firstName,
      middleName: e.student.middleName ?? "",
      suffix: e.student.suffix ?? "",
      gender: e.student.gender ?? "",
      birthDate: e.student.birthDate?.toISOString().split("T")[0] ?? "",
      address: e.student.address ?? "",
    })),
  });
});
```

**Frontend — `src/pages/registrar/SchoolForms.tsx`:**

Wire the existing SF1 "View Form" button to call this endpoint, then render a print-ready HTML table in the same style as SF9/SF10. The form should show:
- DepEd header (school name, region, division, school year)
- Section name, grade level, adviser name
- Student table: No. | LRN | Last Name | First Name | Middle Name | Sex | Birth Date | Address
- Print button using `window.print()`

---

### 3C — School Forms — SF2 backend + frontend

**New endpoint:**
```
GET /api/registrar/sf2/:sectionId?schoolYear=2026-2027&month=2026-10
```

**Backend query:**
```typescript
router.get("/sf2/:sectionId", authenticateToken, requireRegistrar, async (req, res) => {
  const { sectionId } = req.params;
  const { schoolYear, month } = req.query as { schoolYear?: string; month?: string };
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  const sy = schoolYear || settings?.currentSchoolYear;

  // Parse month or default to current month
  const targetMonth = month ? new Date(month + "-01") : new Date();
  const startDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
  const endDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
  const daysInMonth = endDate.getDate();

  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: {
      adviser: { include: { user: true } },
      enrollments: {
        where: { schoolYear: sy, status: "ENROLLED" },
        include: {
          student: true,
          // Attendance is on Student, not Enrollment — query separately
        },
        orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
      },
    },
  });

  if (!section) return res.status(404).json({ message: "Section not found" });

  // Fetch attendance for all enrolled students in this section for the month
  const studentIds = section.enrollments.map(e => e.studentId);
  const attendanceRecords = await prisma.attendance.findMany({
    where: {
      sectionId,
      studentId: { in: studentIds },
      date: { gte: startDate, lte: endDate },
    },
  });

  // Build attendance grid: studentId -> day -> status
  const attendanceMap: Record<string, Record<number, string>> = {};
  for (const record of attendanceRecords) {
    const day = new Date(record.date).getDate();
    if (!attendanceMap[record.studentId]) attendanceMap[record.studentId] = {};
    attendanceMap[record.studentId][day] = record.status; // PRESENT|ABSENT|LATE|EXCUSED
  }

  res.json({
    section: {
      name: section.name,
      gradeLevel: section.gradeLevel,
      schoolYear: sy,
      adviser: section.adviser
        ? `${section.adviser.user.lastName}, ${section.adviser.user.firstName}`
        : null,
    },
    month: month || targetMonth.toISOString().slice(0, 7),
    daysInMonth,
    students: section.enrollments.map((e, i) => ({
      no: i + 1,
      id: e.student.id,
      name: `${e.student.lastName}, ${e.student.firstName}`,
      attendance: attendanceMap[e.student.id] ?? {}, // day -> status
      totals: {
        present: Object.values(attendanceMap[e.student.id] ?? {}).filter(s => s === "PRESENT").length,
        absent: Object.values(attendanceMap[e.student.id] ?? {}).filter(s => s === "ABSENT").length,
        late: Object.values(attendanceMap[e.student.id] ?? {}).filter(s => s === "LATE").length,
        excused: Object.values(attendanceMap[e.student.id] ?? {}).filter(s => s === "EXCUSED").length,
      },
    })),
  });
});
```

**Frontend — `src/pages/registrar/SchoolForms.tsx`:**

Add a month picker `<input type="month">` to the filters card. Wire the SF2 "View Form" button to call this endpoint. Render a print-ready attendance grid:
- Columns: No. | Name | Day 1 | Day 2 | … | Day N | Total Present | Total Absent | Total Late | Total Excused
- Cell values: P (Present), A (Absent), L (Late), E (Excused), or empty
- Print button using `window.print()`

---

### 3D — Registrar Dashboard: fix fake Recent Activities

**File:** `src/pages/registrar/Dashboard.tsx`

The "Recent Activities" card contains a hardcoded array of fake activity strings. Replace it with real data:

```typescript
// Fetch recent audit logs on mount
const [recentActivity, setRecentActivity] = useState([]);

useEffect(() => {
  // adminApi.getLogs is accessible to registrars too if the endpoint allows it
  // If not, add a registrar-accessible logs endpoint or just remove this card
  adminApi.getLogs({ limit: 5 })
    .then(res => setRecentActivity(res.data.logs))
    .catch(() => setRecentActivity([])); // silently fail — the card is non-critical
}, []);
```

If `adminApi.getLogs` returns 403 for registrars, just **remove the "Recent Activities" card** from the registrar dashboard entirely. It's better to have no card than fake data.

---

### 3E — Add SF1/SF2 API wrappers

**File:** `src/lib/api.ts` — add to `registrarApi`:

```typescript
getSF1: (sectionId: string, schoolYear?: string) =>
  api.get(`/registrar/sf1/${sectionId}`, { params: { schoolYear } }),

getSF2: (sectionId: string, schoolYear?: string, month?: string) =>
  api.get(`/registrar/sf2/${sectionId}`, { params: { schoolYear, month } }),
```

---

### 3F — Remove PrintCenter from registrar nav

**File:** `src/layouts/RegistrarLayout.tsx`

The PrintCenter page (`/registrar/print-center` if it exists in nav) is entirely mocked. Remove it from the `navigation` array. The SF forms already use `window.print()` directly — no print queue needed.

---

---

## SECTION 4 — ADMIN PORTAL

### 4A — Add System Monitor page (NEW PAGE)

#### 4A-1 — Backend endpoint

**File:** `server/src/routes/admin.ts`

Add this endpoint (requireAdmin):

```
GET /api/admin/system-status
```

```typescript
import { getSyncStatus as getAtlasSyncStatus } from "../lib/atlasSync";

// Cache external ping results for 30 seconds to avoid hammering external systems
let pingCache: { data: any; cachedAt: number } | null = null;

router.get("/system-status", authenticateToken, requireAdmin, async (req, res) => {
  // Server info
  const uptimeSec = Math.floor(process.uptime());
  const uptimeFormatted = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;
  const memUsed = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const memHeap = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);

  // DB latency
  let dbStatus = "connected";
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
  } catch {
    dbStatus = "error";
  }

  // Atlas sync status (already exported from atlasSync.ts)
  const atlasSyncStatus = getAtlasSyncStatus();

  // External system pings (cached 30s)
  const now = Date.now();
  if (!pingCache || now - pingCache.cachedAt > 30000) {
    const ping = async (url: string | undefined, name: string) => {
      if (!url) return { status: "not_configured", name };
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        return { status: "reachable", latencyMs: Date.now() - start, name, checkedAt: new Date().toISOString() };
      } catch (e: any) {
        return { status: "unreachable", error: e.message ?? "timeout", name, checkedAt: new Date().toISOString() };
      }
    };

    const [enrollpro, atlas, aims] = await Promise.all([
      ping(process.env.ENROLLPRO_URL, "EnrollPro"),
      ping(process.env.ATLAS_URL, "ATLAS"),
      ping(process.env.AIMS_URL, "AIMS"),
    ]);
    pingCache = { data: { enrollpro, atlas, aims }, cachedAt: now };
  }

  res.json({
    server: {
      uptimeSeconds: uptimeSec,
      uptimeFormatted,
      nodeVersion: process.version,
      memoryUsedMB: memUsed,
      memoryHeapMB: memHeap,
      environment: process.env.NODE_ENV ?? "development",
    },
    database: { status: dbStatus, latencyMs: dbLatencyMs },
    sync: {
      atlas: {
        lastSyncAt: atlasSyncStatus.lastSyncAt,
        result: atlasSyncStatus.result,
      },
    },
    externalSystems: pingCache.data,
  });
});
```

Also add a manual sync trigger endpoint:
```
POST /api/admin/sync/atlas    → calls runAtlasSync() from atlasSync.ts
POST /api/admin/sync/enrollpro → calls runEnrollProSync() from enrollproSync.ts
```

---

#### 4A-2 — Frontend: SystemMonitor page

**New file:** `src/pages/admin/SystemMonitor.tsx`

**Sections:**

**A. Page header**
- Title: "System Monitor"
- Subtitle: "Real-time health of the server, database, and connected external systems"
- "Refresh All" button that re-fetches everything

**B. Server health stat cards (top row, 5 cards)**
- Uptime
- Memory used / heap (e.g., "128 MB used")
- Node.js version
- Environment badge (green "production" or amber "development")
- DB status (green "Connected • 12ms" or red "Error")

**C. External Systems (3 cards, one per system)**

```
┌────────────────────────────────────────────────┐
│  🔗 EnrollPro                    ● Connected   │
│  Student enrollment & advisory data             │
│  Latency: 45ms                                  │
│  Last checked: 30 seconds ago                   │
│  [Ping Now]  [Trigger Sync]                     │
└────────────────────────────────────────────────┘
```

Status badge:
- `reachable` → green "Connected"
- `unreachable` → red "Unreachable"
- `not_configured` → gray "Not Configured"

"Ping Now" re-fetches the `system-status` endpoint and updates only the external systems section.
"Trigger Sync" calls the appropriate `POST /api/admin/sync/atlas` or `POST /api/admin/sync/enrollpro`.

**D. Sync Status table**

| System | Last Sync | Status | |
|---|---|---|---|
| ATLAS Teaching Load | 8 min ago | ✅ 14 matched, 2 created, 0 errors | [Run Now] |
| EnrollPro Advisory | 2 min ago | ✅ 320 students | [Run Now] |

**E. 7-day Audit Activity Chart**

Small bar chart using `recharts` (already installed) showing audit log counts per day for the last 7 days. Data: call `adminApi.getLogs({ limit: 500 })` on mount, group by `log.date` in the frontend, split by severity (info = themed color, warning = amber, critical = red). Use a stacked `BarChart`.

---

#### 4A-3 — Wire into nav and router

**File:** `src/layouts/AdminLayout.tsx`

Add to the `navigation` array (before System Settings):
```typescript
{ name: "System Monitor", href: "/admin/system", icon: Activity },
```

**File:** `src/App.tsx`

```tsx
const SystemMonitor = lazy(() => import('./pages/admin/SystemMonitor'))
// Inside Admin routes:
<Route path="system" element={<SystemMonitor />} />
```

**File:** `src/lib/api.ts` — add to `adminApi`:
```typescript
getSystemStatus: () => api.get<SystemStatusResponse>("/admin/system-status"),
triggerAtlasSync: () => api.post("/admin/sync/atlas"),
triggerEnrollProSync: () => api.post("/admin/sync/enrollpro"),
```

---

### 4B — Fix Admin Dashboard: replace hardcoded uptime

**File:** `server/src/routes/admin.ts` — inside the `/dashboard` endpoint:

Find this line:
```typescript
uptime: "99.9%",
```

Replace with:
```typescript
uptime: (() => {
  const s = Math.floor(process.uptime());
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
})(),
```

---

### 4C — Add password reset for users

**File:** `server/src/routes/admin.ts`

```
POST /api/admin/users/:id/reset-password
```

```typescript
router.post("/users/:id/reset-password", authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ message: "User not found" });

  // Generate temp password: 3 random words + 2 digits
  const words = ["Cloud", "Rain", "Star", "Blue", "Moon", "Fire", "Tree", "Stone"];
  const word1 = words[Math.floor(Math.random() * words.length)];
  const word2 = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  const tempPassword = `${word1}${word2}${num}`;

  const bcrypt = await import("bcryptjs");
  const hashed = await bcrypt.hash(tempPassword, 10);
  await prisma.user.update({ where: { id }, data: { password: hashed } });
  await createAuditLog({
    userId: req.user!.id,
    action: AuditAction.UPDATE,
    severity: AuditSeverity.WARNING,
    targetType: "User",
    target: `${user.firstName} ${user.lastName}`,
    details: `Password reset by admin`,
  });

  res.json({ message: "Password reset successful", tempPassword });
});
```

**File:** `src/pages/admin/UserManagement.tsx`

In the user dropdown menu, add a "Reset Password" item. On click, call the endpoint and show the generated password in a dialog with a copy button. Warn the admin to give this to the user immediately.

**File:** `src/lib/api.ts`:
```typescript
resetUserPassword: (id: string) =>
  api.post<{ message: string; tempPassword: string }>(`/admin/users/${id}/reset-password`),
```

---

### 4D — Fix Grading Config: persist change history to audit log

**File:** `server/src/routes/admin.ts` — in the grading config update handler

After saving the new weights, call `createAuditLog()`:
```typescript
await createAuditLog({
  userId: req.user!.id,
  action: AuditAction.CONFIG,
  severity: AuditSeverity.INFO,
  targetType: "Config",
  target: `GradingConfig:${subjectType}`,
  details: `Updated grading weights for ${subjectType}: WW ${writtenWorkWeight}% / PT ${performanceTaskWeight}% / QA ${quarterlyAssessWeight}%`,
});
```

---

### 4E — Fix System Settings: wire "Test Connection" button

**File:** `src/pages/admin/SystemSettings.tsx`

The "Test Connection" button in the Security & Backup card is a stub. Wire it:

```typescript
const handleTestConnection = async () => {
  try {
    await api.get("/health");
    alert("✅ Database connection is healthy.");
  } catch {
    alert("❌ Could not reach the server. Check your connection.");
  }
};
```

---

---

## SECTION 5 — SHARED BACKEND: EnrollPro sync status tracking

**File:** `server/src/lib/enrollproSync.ts`

The ATLAS sync already has `getSyncStatus()` exported. Do the same for EnrollPro — add these at the module level:

```typescript
let lastEnrollProSyncAt: Date | null = null;
let lastEnrollProSyncResult: { studentsUpserted: number; sectionsUpserted: number; errors: string[] } | null = null;

export function getEnrollProSyncStatus() {
  return {
    lastSyncAt: lastEnrollProSyncAt?.toISOString() ?? null,
    result: lastEnrollProSyncResult,
  };
}
```

Update the result at the end of each sync run. This is used by the System Monitor endpoint.

---

## SECTION 6 — IMPLEMENTATION ORDER

Do these tasks in this exact order to avoid broken dependencies:

**Sprint 1 — Quick wins, no schema changes:**
1. Fix `server/src/routes/admin.ts` dashboard endpoint: replace hardcoded uptime with `process.uptime()`
2. Fix `src/pages/registrar/Dashboard.tsx`: remove fake Recent Activities, optionally wire to audit logs
3. Fix `src/pages/admin/SystemSettings.tsx`: wire Test Connection button to `/api/health`
4. Add `getEnrollProSyncStatus()` to `enrollproSync.ts`

**Sprint 2 — Quarter deadline notification:**
5. Add `GET /api/grades/deadline-status` to `server/src/routes/grades.ts`
6. Add `getDeadlineStatus` wrapper to `src/lib/api.ts` gradesApi
7. Create `src/components/QuarterDeadlineBanner.tsx`
8. Mount banner in Dashboard.tsx, ClassRecordsList.tsx, ClassRecordView.tsx
9. Add notification dot to TeacherLayout.tsx sidebar

**Sprint 3 — Registrar SF forms:**
10. Add `GET /api/registrar/sf1/:sectionId` to registrar routes
11. Add `GET /api/registrar/sf2/:sectionId` to registrar routes
12. Add `getSF1` and `getSF2` to `src/lib/api.ts` registrarApi
13. Wire SF1 button in SchoolForms.tsx
14. Wire SF2 button in SchoolForms.tsx (add month picker)

**Sprint 4 — Registrar Enrollment page rewrite:**
15. Rewrite `src/pages/registrar/Enrollment.tsx` with real API data + sync status banner

**Sprint 5 — Admin System Monitor:**
16. Add `GET /api/admin/system-status` to admin routes
17. Add `POST /api/admin/sync/atlas` and `POST /api/admin/sync/enrollpro`
18. Add API wrappers to `src/lib/api.ts`
19. Create `src/pages/admin/SystemMonitor.tsx`
20. Add route in `App.tsx` and nav item in `AdminLayout.tsx`

**Sprint 6 — Admin polish:**
21. Add `POST /api/admin/users/:id/reset-password`
22. Add Reset Password UI in UserManagement.tsx
23. Add audit logging to grading config save handler

---

## SECTION 7 — WHAT NOT TO TOUCH

- Do not modify the ECR import/preview logic — it is working correctly.
- Do not modify `atlasSync.ts` or `enrollproSync.ts` sync logic — only add the status export to enrollproSync.
- Do not write to EnrollPro, ATLAS, or AIMS in any new endpoint.
- Do not add new Prisma models without running `prisma db push` + `prisma generate` first.
- Do not change the HG subject grading logic — it is complete and correct.
- Do not remove or break the SSE streams (`/api/admin/logs/stream`, `/api/admin/settings/stream`, `/api/integration/sync/stream`) — they are live and working.
