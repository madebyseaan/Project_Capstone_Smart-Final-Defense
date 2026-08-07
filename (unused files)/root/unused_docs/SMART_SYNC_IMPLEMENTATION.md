# SMART ↔ EnrollPro & Atlas — Sync Implementation Instructions

> **For:** Developer/Co-pilot implementing the external system connections  
> **Repo:** `latest-smart` (already cloned)  
> **Goal:** Make SMART automatically pull real student, enrollment, and class assignment data from EnrollPro and Atlas over Tailscale, so grades are always attached to the correct real students.

---

## Context: What Is Broken and Why

SMART currently has **zero connection** to EnrollPro or Atlas. All student, section, and enrollment data in the database right now came from `server/prisma/seed.ts` — randomly generated fake Filipino names. This is why grades are pulling wrong data: they are linked to fake seed records, not real students.

### Source of Truth Map

| Data | Owned By | Tailscale IP |
|---|---|---|
| Students (LRN, name, gender, birthdate) | **EnrollPro** (dev-jegs) | `https://dev-jegs.buru-degree.ts.net/api` |
| Sections (name, grade level, school year) | **EnrollPro** (dev-jegs) | `https://dev-jegs.buru-degree.ts.net/api` |
| Enrollments (which student is in which section) | **EnrollPro** (dev-jegs) | `https://dev-jegs.buru-degree.ts.net/api` |
| Advisory assignments (which teacher advises which section) | **EnrollPro** (dev-jegs) | `https://dev-jegs.buru-degree.ts.net/api` |
| Teacher → Subject assignments (who teaches what) | **Atlas** (njgrm) | `http://100.88.55.125:5001/api/v1` |
| **Grades** | **SMART** (you) | `http://100.93.66.120:5003/api` |

**SMART never sends data to EnrollPro or Atlas. It only reads from them. SMART only owns Grades and Attendance.**

---

## Files to Create and Edit

### Summary

| Action | File Path |
|---|---|
| **CREATE** | `server/src/services/syncService.ts` |
| **CREATE** | `server/src/routes/sync.ts` |
| **EDIT** | `server/src/index.ts` |
| **EDIT** | `server/.env` |

---

## Step 1 — Edit `server/.env`

Open `server/.env` and add these three lines. If the file doesn't exist yet, create it.

```env
# External system connections (Tailscale IPs)
ENROLLPRO_URL=https://dev-jegs.buru-degree.ts.net/api
ATLAS_URL=http://100.88.55.125:5001/api/v1

# How often to auto-sync in milliseconds (300000 = 5 minutes)
SYNC_INTERVAL_MS=300000
```

Keep your existing `DATABASE_URL`, `JWT_SECRET`, and `PORT` lines — do not remove them.

---

## Step 2 — Create `server/src/services/syncService.ts`

Create this file from scratch. This is the core sync engine. It talks to EnrollPro and Atlas, maps their data to your Prisma schema, and upserts records.

**Important rules baked into this file:**
- Syncs in order: Students → Sections/Enrollments → ClassAssignments
- **Never touches the `Grade` table** — grades are SMART's data only
- Uses `upsert` so re-running sync is always safe (no duplicates)
- Handles both `{ data: [...] }` and bare `[...]` API response shapes
- Logs clearly to the terminal so you can see what's happening

```typescript
import { GradeLevel } from "@prisma/client";
import { prisma } from "../lib/prisma";

const ENROLLPRO_URL = process.env.ENROLLPRO_URL || "https://dev-jegs.buru-degree.ts.net/api";
const ATLAS_URL     = process.env.ATLAS_URL     || "http://100.88.55.125:5001/api/v1";

// ─── Helper: map grade level strings to Prisma enum ──────────────────────────
// Handles whatever format EnrollPro/Atlas sends: "7", "Grade 7", "GRADE_7", etc.
function toGradeLevel(raw: string): GradeLevel {
  const map: Record<string, GradeLevel> = {
    "7": GradeLevel.GRADE_7, "grade 7": GradeLevel.GRADE_7,
    "grade_7": GradeLevel.GRADE_7, "grade7": GradeLevel.GRADE_7,
    "8": GradeLevel.GRADE_8, "grade 8": GradeLevel.GRADE_8,
    "grade_8": GradeLevel.GRADE_8, "grade8": GradeLevel.GRADE_8,
    "9": GradeLevel.GRADE_9, "grade 9": GradeLevel.GRADE_9,
    "grade_9": GradeLevel.GRADE_9, "grade9": GradeLevel.GRADE_9,
    "10": GradeLevel.GRADE_10, "grade 10": GradeLevel.GRADE_10,
    "grade_10": GradeLevel.GRADE_10, "grade10": GradeLevel.GRADE_10,
  };
  const result = map[String(raw || "").toLowerCase().trim()];
  if (!result) {
    console.warn(`[sync] Unknown gradeLevel "${raw}", defaulting to GRADE_7`);
    return GradeLevel.GRADE_7;
  }
  return result;
}

// ─── Helper: fetch from external URL, return array or null ───────────────────
async function safeFetch(url: string, label: string): Promise<any[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`[sync] ${label} responded ${res.status} ${res.statusText}`);
      return null;
    }
    const json = await res.json();
    return Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : null);
  } catch (err: any) {
    console.error(`[sync] Cannot reach ${label} (${url}):`, err.message);
    return null;
  }
}

// ─── 1. Sync Students from EnrollPro ─────────────────────────────────────────
// Calls: GET {ENROLLPRO_URL}/api/learners
// Expects each item to have: lrn, firstName, lastName, middleName, gender,
//   birthDate, address, guardianName, guardianContact
export async function syncStudentsFromEnrollPro(): Promise<{ synced: number; errors: number }> {
  console.log("[sync] Fetching students from EnrollPro...");
  const students = await safeFetch(`${ENROLLPRO_URL}/api/learners`, "EnrollPro /api/learners");
  if (!students) return { synced: 0, errors: 1 };

  let synced = 0, errors = 0;

  for (const s of students) {
    if (!s.lrn) { errors++; continue; }
    try {
      await prisma.student.upsert({
        where:  { lrn: String(s.lrn) },
        update: {
          firstName:       s.firstName       ?? undefined,
          middleName:      s.middleName      ?? undefined,
          lastName:        s.lastName        ?? undefined,
          suffix:          s.suffix          ?? undefined,
          birthDate:       s.birthDate ? new Date(s.birthDate) : undefined,
          gender:          s.gender          ?? undefined,
          address:         s.address         ?? undefined,
          guardianName:    s.guardianName    ?? undefined,
          guardianContact: s.guardianContact ?? undefined,
        },
        create: {
          lrn:             String(s.lrn),
          firstName:       s.firstName       || "Unknown",
          middleName:      s.middleName      ?? null,
          lastName:        s.lastName        || "Unknown",
          suffix:          s.suffix          ?? null,
          birthDate:       s.birthDate ? new Date(s.birthDate) : null,
          gender:          s.gender          ?? null,
          address:         s.address         ?? null,
          guardianName:    s.guardianName    ?? null,
          guardianContact: s.guardianContact ?? null,
        },
      });
      synced++;
    } catch (err: any) {
      console.error(`[sync] Student upsert failed LRN ${s.lrn}:`, err.message);
      errors++;
    }
  }

  console.log(`[sync] Students: ${synced} synced, ${errors} errors`);
  return { synced, errors };
}

// ─── 2. Sync Enrollments (and Sections) from EnrollPro ───────────────────────
// Calls: GET {ENROLLPRO_URL}/api/enrollments?schoolYear=2025-2026
// Expects each item to have: lrn, sectionName, gradeLevel, schoolYear, status
// Also creates Sections automatically if they don't exist yet.
export async function syncEnrollmentsFromEnrollPro(
  schoolYear = "2025-2026"
): Promise<{ synced: number; errors: number }> {
  console.log("[sync] Fetching enrollments from EnrollPro...");
  const enrollments = await safeFetch(
    `${ENROLLPRO_URL}/api/enrollments?schoolYear=${schoolYear}`,
    "EnrollPro /api/enrollments"
  );
  if (!enrollments) return { synced: 0, errors: 1 };

  let synced = 0, errors = 0;

  for (const e of enrollments) {
    if (!e.lrn || !e.sectionName || !e.gradeLevel) { errors++; continue; }
    try {
      const gradeLevel = toGradeLevel(e.gradeLevel);
      const sy = e.schoolYear || schoolYear;

      // Ensure the Section exists in SMART
      let section = await prisma.section.findFirst({
        where: { name: e.sectionName, gradeLevel, schoolYear: sy },
      });
      if (!section) {
        section = await prisma.section.create({
          data: { name: e.sectionName, gradeLevel, schoolYear: sy },
        });
      }

      // Look up the student by LRN
      const student = await prisma.student.findUnique({ where: { lrn: String(e.lrn) } });
      if (!student) {
        console.warn(`[sync] LRN ${e.lrn} not in SMART — run syncStudentsFromEnrollPro first`);
        errors++;
        continue;
      }

      // Upsert the enrollment
      await prisma.enrollment.upsert({
        where: {
          studentId_sectionId_schoolYear: {
            studentId: student.id,
            sectionId: section.id,
            schoolYear: sy,
          },
        },
        update: { status: e.status || "ENROLLED" },
        create: {
          studentId: student.id,
          sectionId: section.id,
          schoolYear: sy,
          status: e.status || "ENROLLED",
        },
      });
      synced++;
    } catch (err: any) {
      console.error(`[sync] Enrollment upsert failed LRN ${e.lrn}:`, err.message);
      errors++;
    }
  }

  console.log(`[sync] Enrollments: ${synced} synced, ${errors} errors`);
  return { synced, errors };
}

// ─── 3. Sync Class Assignments from Atlas ────────────────────────────────────
// Calls: GET {ATLAS_URL}/api/assignments?schoolYear=2025-2026
//   (falls back to /api/schedules then /api/class-assignments if that 404s)
// Expects each item to have: employeeId, subjectCode, subjectName,
//   sectionName, gradeLevel, schoolYear
// NEVER touches the Grade table.
export async function syncClassAssignmentsFromAtlas(
  schoolYear = "2025-2026"
): Promise<{ synced: number; errors: number }> {
  console.log("[sync] Fetching class assignments from Atlas...");

  // Try multiple likely endpoint names — update once njgrm confirms theirs
  let assignments =
    await safeFetch(`${ATLAS_URL}/api/assignments?schoolYear=${schoolYear}`,    "Atlas /api/assignments") ??
    await safeFetch(`${ATLAS_URL}/api/schedules?schoolYear=${schoolYear}`,      "Atlas /api/schedules") ??
    await safeFetch(`${ATLAS_URL}/api/class-assignments?schoolYear=${schoolYear}`, "Atlas /api/class-assignments");

  if (!assignments) return { synced: 0, errors: 1 };

  let synced = 0, errors = 0;

  for (const a of assignments) {
    if (!a.employeeId || !a.subjectCode || !a.sectionName) { errors++; continue; }
    try {
      // Teacher must already exist in SMART (created via admin or a future teacher sync)
      const teacher = await prisma.teacher.findUnique({
        where: { employeeId: String(a.employeeId) },
      });
      if (!teacher) {
        console.warn(`[sync] Teacher employeeId ${a.employeeId} not in SMART — create teacher account first`);
        errors++;
        continue;
      }

      // Upsert Subject
      const subject = await prisma.subject.upsert({
        where:  { code: String(a.subjectCode) },
        update: { name: a.subjectName || a.subjectCode },
        create: {
          code: String(a.subjectCode),
          name: a.subjectName || a.subjectCode,
          type: a.subjectType || "CORE",
        },
      });

      // Find the Section (must exist from EnrollPro sync)
      const gradeLevel = toGradeLevel(a.gradeLevel || "7");
      const sy = a.schoolYear || schoolYear;
      const section = await prisma.section.findFirst({
        where: { name: a.sectionName, gradeLevel, schoolYear: sy },
      });
      if (!section) {
        console.warn(`[sync] Section "${a.sectionName}" not found — run EnrollPro sync first`);
        errors++;
        continue;
      }

      // Upsert ClassAssignment — NEVER touches Grade table
      await prisma.classAssignment.upsert({
        where: {
          teacherId_subjectId_sectionId_schoolYear: {
            teacherId:  teacher.id,
            subjectId:  subject.id,
            sectionId:  section.id,
            schoolYear: sy,
          },
        },
        update: {},
        create: {
          teacherId:  teacher.id,
          subjectId:  subject.id,
          sectionId:  section.id,
          schoolYear: sy,
        },
      });
      synced++;
    } catch (err: any) {
      console.error(`[sync] ClassAssignment upsert failed:`, err.message);
      errors++;
    }
  }

  console.log(`[sync] ClassAssignments: ${synced} synced, ${errors} errors`);
  return { synced, errors };
}

// ─── Run everything in the correct order ─────────────────────────────────────
export async function runFullSync(schoolYear = "2025-2026") {
  console.log(`\n[sync] ===== Full sync started ${new Date().toISOString()} =====`);
  const students    = await syncStudentsFromEnrollPro();
  const enrollments = await syncEnrollmentsFromEnrollPro(schoolYear);
  const assignments = await syncClassAssignmentsFromAtlas(schoolYear);
  console.log(`[sync] ===== Full sync complete =====\n`);
  return { timestamp: new Date().toISOString(), students, enrollments, assignments };
}
```

---

## Step 3 — Create `server/src/routes/sync.ts`

Create this file from scratch. This exposes admin-only HTTP endpoints to trigger sync manually and check its status.

```typescript
import { Router, Response } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import {
  syncStudentsFromEnrollPro,
  syncEnrollmentsFromEnrollPro,
  syncClassAssignmentsFromAtlas,
  runFullSync,
} from "../services/syncService";
import { prisma } from "../lib/prisma";

const router = Router();

const requireAdmin = (req: AuthRequest, res: Response, next: () => void) => {
  if (!req.user || req.user.role !== "ADMIN") {
    res.status(403).json({ message: "Access denied. Admin only." });
    return;
  }
  next();
};

// In-memory store for last sync result (good enough for now)
let lastSyncResult: Record<string, any> = {};

// POST /api/sync/all — full sync (students + enrollments + assignments)
router.post("/all", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const schoolYear = (req.query.schoolYear as string) || "2025-2026";
    const result = await runFullSync(schoolYear);
    lastSyncResult = result;
    res.json({ message: "Full sync complete", result });
  } catch (err: any) {
    res.status(500).json({ message: "Sync failed", error: err.message });
  }
});

// POST /api/sync/enrollpro — sync students + enrollments only
router.post("/enrollpro", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const schoolYear = (req.query.schoolYear as string) || "2025-2026";
    const students    = await syncStudentsFromEnrollPro();
    const enrollments = await syncEnrollmentsFromEnrollPro(schoolYear);
    const result = { timestamp: new Date().toISOString(), students, enrollments };
    lastSyncResult.enrollpro = result;
    res.json({ message: "EnrollPro sync complete", result });
  } catch (err: any) {
    res.status(500).json({ message: "EnrollPro sync failed", error: err.message });
  }
});

// POST /api/sync/atlas — sync class assignments only
router.post("/atlas", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const schoolYear  = (req.query.schoolYear as string) || "2025-2026";
    const assignments = await syncClassAssignmentsFromAtlas(schoolYear);
    const result = { timestamp: new Date().toISOString(), assignments };
    lastSyncResult.atlas = result;
    res.json({ message: "Atlas sync complete", result });
  } catch (err: any) {
    res.status(500).json({ message: "Atlas sync failed", error: err.message });
  }
});

// GET /api/sync/status — show last sync result + live record counts
router.get("/status", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [studentCount, enrollmentCount, sectionCount, assignmentCount] = await Promise.all([
      prisma.student.count(),
      prisma.enrollment.count(),
      prisma.section.count(),
      prisma.classAssignment.count(),
    ]);
    res.json({
      lastSyncResult,
      liveCounts: { studentCount, enrollmentCount, sectionCount, assignmentCount },
      sources: {
        enrollpro: process.env.ENROLLPRO_URL || "https://dev-jegs.buru-degree.ts.net/api",
        atlas:     process.env.ATLAS_URL     || "http://100.88.55.125:5001/api/v1",
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch status", error: err.message });
  }
});

// GET /api/sync/ping — check if EnrollPro and Atlas are reachable right now
router.get("/ping", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const ENROLLPRO_URL = process.env.ENROLLPRO_URL || "https://dev-jegs.buru-degree.ts.net/api";
  const ATLAS_URL     = process.env.ATLAS_URL     || "http://100.88.55.125:5001/api/v1";

  async function ping(url: string, name: string) {
    try {
      const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5_000) });
      return { name, url, online: r.ok, httpStatus: r.status };
    } catch {
      try {
        await fetch(url, { signal: AbortSignal.timeout(5_000) });
        return { name, url, online: true, httpStatus: 200 };
      } catch {
        return { name, url, online: false, httpStatus: null };
      }
    }
  }

  const [enrollpro, atlas] = await Promise.all([
    ping(ENROLLPRO_URL, "EnrollPro (dev-jegs)"),
    ping(ATLAS_URL,     "Atlas (njgrm)"),
  ]);

  res.json({ enrollpro, atlas });
});

export default router;
```

---

## Step 4 — Edit `server/src/index.ts`

Make **two changes** to the existing `index.ts`.

### Change 1: Add two import lines

Find this existing line:
```typescript
import ecrTemplatesRoutes from "./routes/ecrTemplates";
```

Add these two lines **directly after** it:
```typescript
import syncRoutes from "./routes/sync";
import { runFullSync } from "./services/syncService";
```

### Change 2: Register the route and start auto-sync

Find this existing block:
```typescript
app.use("/api/ecr-templates", ecrTemplatesRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

Replace it with:
```typescript
app.use("/api/ecr-templates", ecrTemplatesRoutes);
app.use("/api/sync", syncRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Auto-sync from EnrollPro & Atlas on startup + every 5 minutes ───────────
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || "300000");

async function autoSync() {
  try {
    await runFullSync("2025-2026");
  } catch (err) {
    console.error("[auto-sync] Error:", err);
  }
}

autoSync();                              // run immediately on startup
setInterval(autoSync, SYNC_INTERVAL_MS); // then every 5 minutes
// ─────────────────────────────────────────────────────────────────────────────

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

---

## Step 5 — Verify the Full `index.ts` Looks Like This

After your edits, `server/src/index.ts` should look exactly like this from top to bottom:

```typescript
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import gradesRoutes from "./routes/grades";
import advisoryRoutes from "./routes/advisory";
import registrarRoutes from "./routes/registrar";
import adminRoutes from "./routes/admin";
import attendanceRoutes from "./routes/attendance";
import templateRoutes from "./routes/templates";
import ecrTemplatesRoutes from "./routes/ecrTemplates";
import syncRoutes from "./routes/sync";
import { runFullSync } from "./services/syncService";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:3000"],
  credentials: true,
}));
app.use(express.json());

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/grades", gradesRoutes);
app.use("/api/advisory", advisoryRoutes);
app.use("/api/registrar", registrarRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/ecr-templates", ecrTemplatesRoutes);
app.use("/api/sync", syncRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || "300000");

async function autoSync() {
  try {
    await runFullSync("2025-2026");
  } catch (err) {
    console.error("[auto-sync] Error:", err);
  }
}

autoSync();
setInterval(autoSync, SYNC_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

---

## Step 6 — Restart the Server

```bash
cd server
npm run dev
```

Watch the terminal. On startup you should see:

```
[sync] ===== Full sync started 2026-05-14T... =====
[sync] Fetching students from EnrollPro...
[sync] Students: X synced, 0 errors
[sync] Fetching enrollments from EnrollPro...
[sync] Enrollments: X synced, 0 errors
[sync] Fetching class assignments from Atlas...
[sync] ClassAssignments: X synced, 0 errors
[sync] ===== Full sync complete =====
```

---

## Step 7 — Test the Sync Endpoints

Use any REST client (Postman, Insomnia, Thunder Client in VS Code, or `curl`). You need an admin JWT token — log in as admin first.

### Get a token
```
POST http://localhost:5003/api/auth/login
Body: { "username": "admin", "password": "yourpassword" }
```
Copy the `token` from the response. Use it as `Authorization: Bearer <token>` on all sync requests.

---

### Test 1: Check connectivity
```
GET http://localhost:5003/api/sync/ping
Authorization: Bearer <token>
```
Expected response:
```json
{
  "enrollpro": { "name": "EnrollPro (dev-jegs)", "online": true, "httpStatus": 200 },
  "atlas":     { "name": "Atlas (njgrm)",         "online": true, "httpStatus": 200 }
}
```
If either shows `"online": false`, confirm with dev-jegs/njgrm that their server is running on Tailscale.

---

### Test 2: Trigger a full sync manually
```
POST http://localhost:5003/api/sync/all
Authorization: Bearer <token>
```
Expected response:
```json
{
  "message": "Full sync complete",
  "result": {
    "timestamp": "2026-05-14T...",
    "students":    { "synced": 240, "errors": 0 },
    "enrollments": { "synced": 240, "errors": 0 },
    "assignments": { "synced": 48,  "errors": 0 }
  }
}
```

---

### Test 3: Check live record counts
```
GET http://localhost:5003/api/sync/status
Authorization: Bearer <token>
```
This shows how many real records are now in the database and the result of the last sync.

---

## Step 8 — Confirm Exact Endpoint Names With the Other Teams

The sync service tries common endpoint patterns automatically, but confirm these with each team so you can hardcode the correct ones if needed.

### Ask dev-jegs (EnrollPro):

1. What is your exact endpoint for all learners/students?  
   → Is it `/api/learners`, `/api/students`, or something else?

2. What is your exact endpoint for enrollments?  
   → Is it `/api/enrollments`? Does it accept `?schoolYear=2025-2026`?

3. What exact field names do you send? We need:  
   `lrn`, `firstName`, `middleName`, `lastName`, `suffix`, `birthDate`, `gender`, `address`, `guardianName`, `guardianContact` for students  
   `lrn`, `sectionName`, `gradeLevel`, `schoolYear`, `status` for enrollments

4. What format is `gradeLevel`? (e.g. `"7"`, `"Grade 7"`, `"GRADE_7"`)

5. Do you send `adviserId` (teacher employee ID) in the enrollment or section data?

### Ask njgrm (Atlas):

1. What is your exact endpoint for class/subject assignments?  
   → Is it `/api/assignments`, `/api/schedules`, or something else?

2. What exact field names do you send? We need:  
   `employeeId`, `subjectCode`, `subjectName`, `sectionName`, `gradeLevel`, `schoolYear`

3. Does `employeeId` match the teacher employee IDs in EnrollPro?

4. Does `sectionName` exactly match what EnrollPro sends? (they must be identical for matching to work)

### If field names are different:

Update the mapping in `syncService.ts`. For example if EnrollPro sends `learner_id` instead of `lrn`:

```typescript
// In syncStudentsFromEnrollPro(), change:
where: { lrn: String(s.lrn) }
// to:
where: { lrn: String(s.learner_id) }
```

Same pattern for any other field name mismatch.

---

## Step 9 — Wire Up Advisory Teacher (Optional but Important)

EnrollPro may send an `adviserId` (the teacher's employee ID) in the section or enrollment data. If it does, update the section upsert in `syncEnrollmentsFromEnrollPro` to link it:

Find this block in `syncService.ts`:
```typescript
if (!section) {
  section = await prisma.section.create({
    data: { name: e.sectionName, gradeLevel, schoolYear: sy },
  });
}
```

If EnrollPro sends `e.adviserId` (employee ID of the adviser):
```typescript
if (!section) {
  // Look up teacher by employeeId
  const adviser = e.adviserId
    ? await prisma.teacher.findUnique({ where: { employeeId: String(e.adviserId) } })
    : null;

  section = await prisma.section.create({
    data: {
      name:       e.sectionName,
      gradeLevel,
      schoolYear: sy,
      adviserId:  adviser?.id ?? null,
    },
  });
}
```

---

## What the Sync Does NOT Do (By Design)

| Action | Reason |
|---|---|
| Write to the `Grade` table | Grades are SMART's data. Sync never touches them. |
| Write to the `Attendance` table | Attendance is SMART's data. |
| Delete students or enrollments | Sync only upserts. Deletions are handled manually. |
| Push data back to EnrollPro or Atlas | SMART is read-only from external systems. |
| Create User/Teacher accounts | Teacher accounts are created by admin in SMART. Sync only reads `employeeId` to match existing teachers. |

---

## Troubleshooting

### "Cannot reach EnrollPro / Atlas"
- Confirm the Tailscale VPN is connected on your machine
- Confirm dev-jegs and njgrm have their servers running (`npm run dev`)
- Test manually: open browser and go to `https://dev-jegs.buru-degree.ts.net/api` — should show something

### "Teacher employeeId X not in SMART"
- Atlas is sending an assignment for a teacher that doesn't have a SMART account yet
- Admin needs to create that teacher's user account in SMART admin panel first
- The `employeeId` in the Teacher record must match what Atlas sends

### "Section not found — run EnrollPro sync first"
- Atlas sync depends on EnrollPro sync having run first
- Always run in order: EnrollPro → Atlas
- `POST /api/sync/all` handles the order automatically

### "LRN X not in SMART — run syncStudents first"
- Enrollment sync depends on student sync having run first
- `POST /api/sync/all` handles the order automatically

### Grades not showing for correct students after sync
- Existing Grade records in the database are linked to old seed student IDs
- After the first real sync, old seed data and old grades may need to be cleared
- Run: `npx prisma studio` in the `server/` folder and manually inspect the Student and Grade tables
- Or run `npx prisma migrate reset` to wipe everything and start fresh with real data (⚠️ this deletes all grades)

---

## File Structure After Implementation

```
server/
└── src/
    ├── index.ts                  ← EDITED (added sync route + auto-sync)
    ├── routes/
    │   ├── sync.ts               ← NEW
    │   └── ...existing routes
    └── services/
        ├── syncService.ts        ← NEW
        └── ...existing services
```

---

## Quick Reference: New API Endpoints

All require `Authorization: Bearer <admin-token>`.

| Method | Endpoint | What it does |
|---|---|---|
| `GET` | `/api/sync/ping` | Check if EnrollPro + Atlas are reachable |
| `POST` | `/api/sync/all` | Full sync (students → enrollments → assignments) |
| `POST` | `/api/sync/enrollpro` | Sync students + enrollments from EnrollPro only |
| `POST` | `/api/sync/atlas` | Sync class assignments from Atlas only |
| `GET` | `/api/sync/status` | Last sync result + live DB record counts |
