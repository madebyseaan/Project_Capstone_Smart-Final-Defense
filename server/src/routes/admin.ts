import { Router, Request, Response } from "express";
import { Role, SubjectType, AuditAction, AuditSeverity, Term, WorkloadType } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import * as XLSX from "xlsx";
import { prisma } from "../lib/prisma";
import { createAuditLog } from "../lib/audit";
import { addSseClient, removeSseClient, addSettingsSseClient, removeSettingsSseClient, broadcastSettingsUpdate } from "../lib/sseManager";
import { syncEnrollProBranding } from "../lib/enrollproBrandingSync";
import { getSyncStatus, runAtlasSync } from "../lib/atlasSync";
import { getEnrollProSyncStatus, runEnrollProSync } from "../lib/enrollproSync";
import { getRecentSyncHistory, runUnifiedSync } from "../lib/syncCoordinator";
import { getSystemHealthSnapshot } from "../lib/systemHealth";
import { getIntegrationV1ActiveSchoolYear, getIntegrationV1FacultyPage, getIntegrationV1LearnersPage } from "../lib/enrollproClient";

const router = Router();

// Configure multer for logo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype) || file.mimetype === "image/svg+xml";
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// Middleware to check if user is admin
const requireAdmin = (req: AuthRequest, res: Response, next: () => void) => {
  if (!req.user || req.user.role !== "ADMIN") {
    res.status(403).json({ message: "Access denied. Admin only." });
    return;
  }
  next();
};

const SF_FORM_LABELS: Record<string, string> = {
  SF1: "School Form 1 - School Register",
  SF2: "School Form 2 - Daily Attendance",
  SF3: "School Form 3 - Books Issued and Returned",
  SF4: "School Form 4 - Monthly Learner Movement and Attendance",
  SF5: "School Form 5 - Promotion and Proficiency",
  SF6: "School Form 6 - Summary Promotion Report",
  SF7: "School Form 7 - School Personnel Profile",
  SF8: "School Form 8 - Learner's Basic Health and Nutrition Report",
  SF9: "School Form 9 - Progress Report (JHS/SHS)",
  SF10: "School Form 10 - Permanent Record",
};

const SF_SHEET_MATCHERS: Record<string, RegExp[]> = {
  SF1: [/\bsf\s*1\b/i, /school\s*form\s*1/i, /school\s*register/i],
  SF2: [/\bsf\s*2\b/i, /school\s*form\s*2/i, /attendance/i],
  SF3: [/\bsf\s*3\b/i, /school\s*form\s*3/i, /books\s*issued/i],
  SF4: [/\bsf\s*4\b/i, /school\s*form\s*4/i, /movement/i],
  SF5: [/\bsf\s*5\b/i, /school\s*form\s*5/i, /promotion/i],
  SF6: [/\bsf\s*6\b/i, /school\s*form\s*6/i, /summarized\s*report/i],
  SF7: [/\bsf\s*7\b/i, /school\s*form\s*7/i, /personnel/i],
  SF8: [/\bsf\s*8\b/i, /school\s*form\s*8/i, /health/i, /nutrition/i, /nutritional\s*status/i],
  SF9: [/\bsf\s*9\b/i, /school\s*form\s*9/i, /report\s*card/i, /progress\s*report/i, /learner'?s\s*progress/i],
  SF10: [/\bsf\s*10\b/i, /school\s*form\s*10/i, /permanent\s*record/i, /form\s*137/i, /front/i, /back/i],
};

function detectSfSheetMappings(filePath: string): Array<{ formType: string; sheetName: string }> {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetNames = workbook.SheetNames || [];
  const mappings: Array<{ formType: string; sheetName: string }> = [];

  for (const [formType, patterns] of Object.entries(SF_SHEET_MATCHERS)) {
    const sheetName = sheetNames.find((candidate) => patterns.some((pattern) => pattern.test(candidate)));
    if (sheetName) {
      mappings.push({ formType, sheetName });
    }
  }

  return mappings;
}

function deriveEcrSubjectName(fileName: string): string {
  const withoutExt = fileName.replace(/\.(xlsx|xls)$/i, "");
  const withoutPrefix = withoutExt.replace(/^ECR_/i, "");
  const withoutTimestamp = withoutPrefix.replace(/_\d+$/, "");
  const normalized = withoutTimestamp.replace(/[_-]+/g, " ").trim();
  const withoutGenericToken = normalized.replace(/\becr\b/gi, " ").replace(/\s+/g, " ").trim();

  if (!withoutGenericToken) {
    return "Unlabeled Subject";
  }

  return withoutGenericToken
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function inferEcrSubjectType(subjectName: string, fileName: string): SubjectType | null {
  const source = `${subjectName} ${fileName}`.toLowerCase();

  if (/(math|algebra|geometry|science|biology|chemistry|physics)/i.test(source)) {
    return 'MATH_SCIENCE' as SubjectType;
  }

  if (/(mapeh|music|arts|physical\s*education|pe\b|health)/i.test(source)) {
    return SubjectType.MAPEH;
  }

  if (/(tle|technology|livelihood|home\s*economics|ict|cookery|industrial\s*arts|agri|entrepreneurship)/i.test(source)) {
    return SubjectType.TLE;
  }

  if (/(english|filipino|esp|edukasyon|araling\s*panlipunan|ap\b|values)/i.test(source)) {
    return SubjectType.CORE;
  }

  return null;
}

// ============================================
// DASHBOARD ENDPOINTS
// ============================================

// Get admin dashboard stats
router.get("/dashboard", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Get system settings first to resolve the active school year for enrollment-based stats
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "main" },
    });

    // Get user counts by role
    const userCounts = await prisma.user.groupBy({
      by: ["role"],
      _count: true,
    });

    const totalUsers = userCounts.reduce((sum, item) => sum + item._count, 0);
    let totalTeachers = userCounts.find((u) => u.role === "TEACHER")?._count || 0;
    const totalAdmins = userCounts.find((u) => u.role === "ADMIN")?._count || 0;
    const totalRegistrars = userCounts.find((u) => u.role === "REGISTRAR")?._count || 0;

    try {
      const activeSy = await getIntegrationV1ActiveSchoolYear();
      if (activeSy?.id) {
        // Fetch just 1 record to get the meta.total count efficiently
        const { meta } = await getIntegrationV1FacultyPage(activeSy.id, 1, 1);
        if (meta?.total) {
          totalTeachers = meta.total;
        }
      }
    } catch (error: any) {
      console.warn("[AdminDashboard] Failed to fetch live teacher count from EnrollPro, using local DB.", error.message);
    }

    // Count active enrolled students from EnrollPro-synced enrollment records.
    // Prefer current configured school year, but fall back to latest synced year when needed.
    const configuredSchoolYear = settings?.currentSchoolYear ?? null;
    const countDistinctEnrolledStudents = async (schoolYear: string) => {
      const enrolledStudents = await prisma.enrollment.findMany({
        where: {
          schoolYear,
          status: "ENROLLED",
        },
        distinct: ["studentId"],
        select: { studentId: true },
      });
      return enrolledStudents.length;
    };

    let totalStudents = 0;
    let studentCountSchoolYear: string | null = null;

    // First attempt: Fetch real-time total directly from EnrollPro Integration API
    try {
      const activeSy = await getIntegrationV1ActiveSchoolYear();
      if (activeSy && activeSy.id) {
        // Fetch just 1 record to get the meta.total count efficiently
        const page = await getIntegrationV1LearnersPage(activeSy.id, 1, 1);
        totalStudents = page.meta?.total || 0;
        studentCountSchoolYear = activeSy.yearLabel;
      }
    } catch (error: any) {
      console.warn("[AdminDashboard] Failed to fetch live student count from EnrollPro, falling back to local DB.", error.message);
    }

    // Fallback: Use local DB if EnrollPro is unreachable or returned 0
    if (totalStudents === 0) {
      if (configuredSchoolYear) {
        totalStudents = await countDistinctEnrolledStudents(configuredSchoolYear);
        studentCountSchoolYear = configuredSchoolYear;
      }

      if (totalStudents === 0) {
        const latestEnrollment = await prisma.enrollment.findFirst({
          where: { status: "ENROLLED" },
          orderBy: { updatedAt: "desc" },
          select: { schoolYear: true },
        });

        if (latestEnrollment?.schoolYear && latestEnrollment.schoolYear !== studentCountSchoolYear) {
          totalStudents = await countDistinctEnrolledStudents(latestEnrollment.schoolYear);
          studentCountSchoolYear = latestEnrollment.schoolYear;
        }
      }

      if (totalStudents === 0) {
        totalStudents = await prisma.student.count();
      }
    }

    // Get today's login count from audit logs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogins = await prisma.auditLog.count({
      where: {
        action: AuditAction.LOGIN,
        createdAt: { gte: today },
      },
    });

    // Get recent audit logs
    const recentLogs = await prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
    });

    // Get active sessions (logins in last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const activeUsers = await prisma.auditLog.count({
      where: {
        action: AuditAction.LOGIN,
        createdAt: { gte: oneHourAgo },
      },
    });

    res.json({
      stats: {
        totalUsers,
        totalTeachers,
        totalStudents,
        totalAdmins,
        totalRegistrars,
        activeUsers,
        todayLogins,
        studentCountSchoolYear,
      },
      recentLogs: recentLogs.map((log) => ({
        id: log.id,
        action: log.action.toLowerCase(),
        user: log.userName,
        userRole: log.userRole,
        target: log.target,
        targetType: log.targetType,
        details: log.details,
        ipAddress: log.ipAddress,
        severity: log.severity.toLowerCase(),
        timestamp: log.createdAt.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        date: log.createdAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      })),
      systemStatus: {
        database: "healthy",
        lastBackup: "N/A",
        uptime: "99.9%",
      },
      settings: settings
        ? {
            schoolName: settings.schoolName,
            currentSchoolYear: settings.currentSchoolYear,
            currentTerm: settings.currentTerm,
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching admin dashboard:", error);
    res.status(500).json({ message: "Failed to fetch dashboard data" });
  }
});

// ============================================
// SYSTEM HEALTH & SYNC DIAGNOSTICS ENDPOINTS
// ============================================

// Get complete local + external system health status.
router.get("/system/health", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const health = await getSystemHealthSnapshot();
    res.json(health);
  } catch (error) {
    console.error("Error fetching system health:", error);
    res.status(500).json({ message: "Failed to fetch system health" });
  }
});

// Get persistent sync history for diagnostics UI.
router.get("/system/sync-history", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requestedLimit = Number(req.query.limit ?? 25);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 25;
    const history = await getRecentSyncHistory(limit);
    res.json({ history, count: history.length });
  } catch (error) {
    console.error("Error fetching sync history:", error);
    res.status(500).json({ message: "Failed to fetch sync history" });
  }
});

// Trigger full unified sync from admin diagnostics.
router.post("/system/sync/run", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await runUnifiedSync({ source: 'admin-system-health', forceBranding: false });
    res.json({ message: "Unified sync complete", result });
  } catch (error: any) {
    console.error("Error running unified sync:", error);
    res.status(500).json({ message: "Failed to run unified sync", error: error?.message ?? String(error) });
  }
});

// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================

// Get all users with filtering
router.get("/users", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, role, status } = req.query;

    const where: any = {};

    if (search) {
      where.OR = [
        { username: { contains: search as string, mode: "insensitive" } },
        { firstName: { contains: search as string, mode: "insensitive" } },
        { lastName: { contains: search as string, mode: "insensitive" } },
        { email: { contains: search as string, mode: "insensitive" } },
      ];
    }

    if (role && role !== "all") {
      where.role = role as Role;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
        updatedAt: true,
        teacher: {
          select: {
            employeeId: true,
            specialization: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Add status (we'll assume all users are active for now - could add isActive field later)
    const usersWithStatus = users.map((user) => ({
      ...user,
      status: "Active", // In production, this would come from a field in the database
      lastActive: user.updatedAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    res.json({ users: usersWithStatus });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// Create new user
router.post("/users", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, password, role, firstName, lastName, email, employeeId, specialization } = req.body;

    // Check if username already exists
    const existing = await prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      res.status(400).json({ message: "Username already exists" });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: role as Role,
        firstName,
        lastName,
        email,
      },
    });

    // If teacher, create teacher record
    if (role === "TEACHER" && employeeId) {
      await prisma.teacher.create({
        data: {
          userId: user.id,
          employeeId,
          specialization,
        },
      });
    }

    // Create audit log
    await createAuditLog(
      AuditAction.CREATE,
      req.user!,
      "User Account",
      "User",
      `Created new ${role.toLowerCase()} account: ${firstName} ${lastName}`,
      req.ip,
      AuditSeverity.INFO,
      user.id
    );

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ message: "Failed to create user" });
  }
});

// Update user
router.put("/users/:id", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { username, password, role, firstName, lastName, email, employeeId, specialization } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { id },
      include: { teacher: true },
    });

    if (!existingUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Check if new username conflicts with another user
    if (username !== existingUser.username) {
      const conflict = await prisma.user.findUnique({
        where: { username },
      });
      if (conflict) {
        res.status(400).json({ message: "Username already taken" });
        return;
      }
    }

    // Prepare update data
    const updateData: any = {
      username,
      role: role as Role,
      firstName,
      lastName,
      email,
    };

    // Only update password if provided
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    // Update user
    const user = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    // Handle teacher record
    if (role === "TEACHER") {
      if (existingUser.teacher) {
        // Update existing teacher record
        await prisma.teacher.update({
          where: { userId: id },
          data: { employeeId, specialization },
        });
      } else if (employeeId) {
        // Create new teacher record
        await prisma.teacher.create({
          data: {
            userId: id,
            employeeId,
            specialization,
          },
        });
      }
    } else if (existingUser.teacher) {
      // User is no longer a teacher, delete teacher record
      await prisma.teacher.delete({
        where: { userId: id },
      });
    }

    // Create audit log
    await createAuditLog(
      AuditAction.UPDATE,
      req.user!,
      "User Account",
      "User",
      `Updated user account: ${firstName} ${lastName}`,
      req.ip,
      AuditSeverity.INFO,
      user.id
    );

    res.json({
      message: "User updated successfully",
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Failed to update user" });
  }
});

// Delete user
router.delete("/users/:id", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Don't allow deleting yourself
    if (user.id === req.user!.id) {
      res.status(400).json({ message: "Cannot delete your own account" });
      return;
    }

    // Delete user (cascade will handle teacher record)
    await prisma.user.delete({
      where: { id },
    });

    // Create audit log
    await createAuditLog(
      AuditAction.DELETE,
      req.user!,
      "User Account",
      "User",
      `Deleted user account: ${user.firstName} ${user.lastName} (${user.username})`,
      req.ip,
      AuditSeverity.WARNING,
      id
    );

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Failed to delete user" });
  }
});

// ============================================
// AUDIT LOG ENDPOINTS
// ============================================

// Get audit logs with filtering
router.get("/logs", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { action, severity, search, limit = "50", offset = "0" } = req.query;

    const where: any = {};

    if (action && action !== "all") {
      where.action = (action as string).toUpperCase() as AuditAction;
    }

    if (severity && severity !== "all") {
      where.severity = (severity as string).toUpperCase() as AuditSeverity;
    }

    if (search) {
      where.OR = [
        { userName: { contains: search as string, mode: "insensitive" } },
        { target: { contains: search as string, mode: "insensitive" } },
        { details: { contains: search as string, mode: "insensitive" } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Get counts by action type
    const actionCounts = await prisma.auditLog.groupBy({
      by: ["action"],
      _count: true,
    });

    const severityCounts = await prisma.auditLog.groupBy({
      by: ["severity"],
      _count: true,
    });

    res.json({
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action.toLowerCase(),
        user: log.userName,
        userRole: log.userRole,
        target: log.target,
        targetType: log.targetType,
        details: log.details,
        ipAddress: log.ipAddress,
        severity: log.severity.toLowerCase(),
        timestamp: log.createdAt.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        date: log.createdAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        createdAt: log.createdAt,
      })),
      total,
      counts: {
        total,
        creates: actionCounts.find((c) => c.action === "CREATE")?._count || 0,
        updates: actionCounts.find((c) => c.action === "UPDATE")?._count || 0,
        deletes: actionCounts.find((c) => c.action === "DELETE")?._count || 0,
        logins:
          (actionCounts.find((c) => c.action === "LOGIN")?._count || 0) +
          (actionCounts.find((c) => c.action === "LOGOUT")?._count || 0),
        critical: severityCounts.find((c) => c.severity === "CRITICAL")?._count || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    res.status(500).json({ message: "Failed to fetch audit logs" });
  }
});

// Real-time SSE stream for audit logs
router.get("/logs/stream", authenticateToken, requireAdmin, (req: AuthRequest, res: Response): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send a heartbeat comment every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30000);

  addSseClient(res);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeSseClient(res);
  });
});

// Export audit logs (CSV)
router.get("/logs/export", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000 // Limit export to last 1000 entries
    });

    const csv = [
      "ID,Action,User,Role,Target,Details,IP Address,Severity,Date/Time",
      ...logs.map(
        (log) =>
          `"${log.id}","${log.action}","${log.userName}","${log.userRole}","${log.target}","${log.details.replace(/"/g, '""')}","${log.ipAddress || ""}","${log.severity}","${log.createdAt.toISOString()}"`
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error("Error exporting audit logs:", error);
    res.status(500).json({ message: "Failed to export audit logs" });
  }
});

// ============================================
// SYSTEM SETTINGS ENDPOINTS
// ============================================

// Get system settings (readable by all authenticated users for theme/branding)
router.get("/settings", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let settings = await prisma.systemSettings.findUnique({
      where: { id: "main" },
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.systemSettings.create({
        data: { id: "main" },
      });
    }

    res.json({ settings });
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ message: "Failed to fetch settings" });
  }
});

// Update system settings
router.put("/settings", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      schoolName,
      schoolId,
      division,
      region,
      address,
      contactNumber,
      email,
      currentSchoolYear,
      currentTerm,
      primaryColor,
      secondaryColor,
      accentColor,
      sessionTimeout,
      maxLoginAttempts,
      passwordMinLength,
      requireSpecialChar,
      // Academic calendar dates
      t1StartDate,
      t1EndDate,
      t2StartDate,
      t2EndDate,
      t3StartDate,
      t3EndDate,
      autoAdvanceTerm,
    } = req.body;

    const settings = await prisma.systemSettings.upsert({
      where: { id: "main" },
      update: {
        schoolName,
        schoolId,
        division,
        region,
        address,
        contactNumber,
        email,
        currentSchoolYear,
        currentTerm: currentTerm as Term,
        primaryColor,
        secondaryColor,
        accentColor,
        sessionTimeout,
        maxLoginAttempts,
        passwordMinLength,
        requireSpecialChar,
        t1StartDate: t1StartDate ? new Date(t1StartDate) : undefined,
        t1EndDate: t1EndDate ? new Date(t1EndDate) : undefined,
        t2StartDate: t2StartDate ? new Date(t2StartDate) : undefined,
        t2EndDate: t2EndDate ? new Date(t2EndDate) : undefined,
        t3StartDate: t3StartDate ? new Date(t3StartDate) : undefined,
        t3EndDate: t3EndDate ? new Date(t3EndDate) : undefined,
        autoAdvanceTerm,
      },
      create: {
        id: "main",
        schoolName,
        schoolId,
        division,
        region,
        address,
        contactNumber,
        email,
        currentSchoolYear,
        currentTerm: currentTerm as Term,
        primaryColor,
        secondaryColor,
        accentColor,
        sessionTimeout,
        maxLoginAttempts,
        passwordMinLength,
        requireSpecialChar,
        t1StartDate: t1StartDate ? new Date(t1StartDate) : undefined,
        t1EndDate: t1EndDate ? new Date(t1EndDate) : undefined,
        t2StartDate: t2StartDate ? new Date(t2StartDate) : undefined,
        t2EndDate: t2EndDate ? new Date(t2EndDate) : undefined,
        t3StartDate: t3StartDate ? new Date(t3StartDate) : undefined,
        t3EndDate: t3EndDate ? new Date(t3EndDate) : undefined,
        autoAdvanceTerm,
      },
    });

    // Create audit log
    await createAuditLog(
      AuditAction.CONFIG,
      req.user!,
      "System Settings",
      "Config",
      "Updated system settings",
      req.ip,
      AuditSeverity.CRITICAL
    );

    // Broadcast settings update to all connected clients
    broadcastSettingsUpdate(settings);

    res.json({ message: "Settings updated successfully", settings });
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ message: "Failed to update settings" });
  }
});

// Upload logo
router.post(
  "/settings/logo",
  authenticateToken,
  requireAdmin,
  upload.single("logo"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No file uploaded" });
        return;
      }

      const logoUrl = `/uploads/${req.file.filename}`;

      // Get current settings to find old logo
      const currentSettings = await prisma.systemSettings.findUnique({
        where: { id: "main" }
      });

      // Delete old logo file if it exists
      if (currentSettings?.logoUrl) {
        const oldLogoPath = path.join(__dirname, "../../", currentSettings.logoUrl);
        if (fs.existsSync(oldLogoPath)) {
          try {
            fs.unlinkSync(oldLogoPath);
          } catch (error) {
            console.warn("Failed to delete old logo file:", error);
            // Continue even if deletion fails
          }
        }
      }

      const settings = await prisma.systemSettings.update({
        where: { id: "main" },
        data: { logoUrl },
      });

      // Create audit log
      await createAuditLog(
        AuditAction.UPDATE,
        req.user!,
        "School Logo",
        "Config",
        "Uploaded new school logo",
        req.ip,
        AuditSeverity.INFO
      );

      // Broadcast settings update for realtime sync
      broadcastSettingsUpdate(settings);

      res.json({ message: "Logo uploaded successfully", logoUrl });
    } catch (error) {
      console.error("Error uploading logo:", error);
      res.status(500).json({ message: "Failed to upload logo" });
    }
  }
);

// Update color scheme
router.put("/settings/colors", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { primaryColor, secondaryColor, accentColor } = req.body;

    const settings = await prisma.systemSettings.update({
      where: { id: "main" },
      data: {
        primaryColor,
        secondaryColor,
        accentColor,
      },
    });

    // Create audit log
    await createAuditLog(
      AuditAction.CONFIG,
      req.user!,
      "Color Scheme",
      "Config",
      `Updated color scheme: Primary ${primaryColor}, Secondary ${secondaryColor}, Accent ${accentColor}`,
      req.ip,
      AuditSeverity.INFO
    );

    // Broadcast settings update for realtime sync
    broadcastSettingsUpdate(settings);

    res.json({
      message: "Color scheme updated successfully",
      colors: {
        primaryColor: settings.primaryColor,
        secondaryColor: settings.secondaryColor,
        accentColor: settings.accentColor,
      },
    });
  } catch (error) {
    console.error("Error updating color scheme:", error);
    res.status(500).json({ message: "Failed to update color scheme" });
  }
});

// Sync branding and school info from EnrollPro
router.post(
  "/settings/sync-enrollpro",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const settings = await syncEnrollProBranding(
        path.join(__dirname, "../../uploads")
      );

      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        "System Settings",
        "Config",
        "Synced branding and school info from EnrollPro",
        req.ip,
        AuditSeverity.INFO
      );

      res.json({ message: "Successfully synced from EnrollPro", settings });
    } catch (error) {
      console.error("Error syncing from EnrollPro:", error instanceof Error ? error.message : error);
      res.status(500).json({
        message: "Failed to sync from EnrollPro",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
);


// Real-time SSE stream for settings updates
router.get("/settings/stream", authenticateToken, (req: AuthRequest, res: Response): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send a heartbeat comment every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30000);

  addSettingsSseClient(res);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeSettingsSseClient(res);
  });
});

// ============================================
// GRADING CONFIG ENDPOINTS
// ============================================

// Get grading configurations
router.get("/grading-config", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const configs = await prisma.gradingConfig.findMany({
      orderBy: { subjectType: "asc" },
    });

    // If no configs exist, create defaults
    if (configs.length === 0) {
      const defaultConfigs = [
        { subjectType: SubjectType.CORE, ww: 20, pt: 50, qa: 30 },
        { subjectType: 'MATH_SCIENCE' as SubjectType, ww: 20, pt: 50, qa: 30 },
        { subjectType: SubjectType.MAPEH, ww: 20, pt: 60, qa: 20 },
        { subjectType: SubjectType.TLE, ww: 20, pt: 60, qa: 20 },
      ];

      for (const config of defaultConfigs) {
        await prisma.gradingConfig.create({
          data: {
            subjectType: config.subjectType,
            writtenWorkWeight: config.ww,
            performanceTaskWeight: config.pt,
            quarterlyAssessWeight: config.qa,
            isDepEdDefault: true,
          },
        });
      }

      const newConfigs = await prisma.gradingConfig.findMany({
        orderBy: { subjectType: "asc" },
      });
      res.json({ configs: newConfigs });
      return;
    }

    res.json({ configs });
  } catch (error) {
    console.error("Error fetching grading configs:", error);
    res.status(500).json({ message: "Failed to fetch grading configurations" });
  }
});

// Update grading configuration
router.put("/grading-config/:subjectType", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subjectType } = req.params;
    const { writtenWorkWeight, performanceTaskWeight, quarterlyAssessWeight } = req.body;

    // Validate weights sum to 100
    const total = writtenWorkWeight + performanceTaskWeight + quarterlyAssessWeight;
    if (total !== 100) {
      res.status(400).json({ message: `Weights must sum to 100%. Current sum: ${total}%` });
      return;
    }

    const config = await prisma.gradingConfig.upsert({
      where: { subjectType: subjectType as SubjectType },
      update: {
        writtenWorkWeight,
        performanceTaskWeight,
        quarterlyAssessWeight,
        isDepEdDefault: false,
      },
      create: {
        subjectType: subjectType as SubjectType,
        writtenWorkWeight,
        performanceTaskWeight,
        quarterlyAssessWeight,
        isDepEdDefault: false,
      },
    });

    // Create audit log
    await createAuditLog(
      AuditAction.CONFIG,
      req.user!,
      "Grading Weights",
      "Config",
      `Updated ${subjectType} grading weights: WW ${writtenWorkWeight}%, PT ${performanceTaskWeight}%, QA ${quarterlyAssessWeight}%`,
      req.ip,
      AuditSeverity.CRITICAL
    );

    res.json({ message: "Grading configuration updated successfully", config });
  } catch (error) {
    console.error("Error updating grading config:", error);
    res.status(500).json({ message: "Failed to update grading configuration" });
  }
});

// Reset grading configuration to DepEd defaults
router.post("/grading-config/reset", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // DepEd default weights (Revised Guidelines 2026)
    const defaults = [
      { subjectType: SubjectType.CORE, ww: 20, pt: 50, qa: 30 },
      { subjectType: 'MATH_SCIENCE' as SubjectType, ww: 20, pt: 50, qa: 30 },
      { subjectType: SubjectType.MAPEH, ww: 20, pt: 60, qa: 20 },
      { subjectType: SubjectType.TLE, ww: 20, pt: 60, qa: 20 },
    ];

    for (const config of defaults) {
      await prisma.gradingConfig.upsert({
        where: { subjectType: config.subjectType },
        update: {
          writtenWorkWeight: config.ww,
          performanceTaskWeight: config.pt,
          quarterlyAssessWeight: config.qa,
          isDepEdDefault: true,
        },
        create: {
          subjectType: config.subjectType,
          writtenWorkWeight: config.ww,
          performanceTaskWeight: config.pt,
          quarterlyAssessWeight: config.qa,
          isDepEdDefault: true,
        },
      });
    }

    // Create audit log
    await createAuditLog(
      AuditAction.CONFIG,
      req.user!,
      "Grading Weights",
      "Config",
      "Reset all grading weights to DepEd defaults",
      req.ip,
      AuditSeverity.CRITICAL
    );

    const configs = await prisma.gradingConfig.findMany({
      orderBy: { subjectType: "asc" },
    });

    res.json({ message: "Grading configurations reset to defaults", configs });
  } catch (error) {
    console.error("Error resetting grading configs:", error);
    res.status(500).json({ message: "Failed to reset grading configurations" });
  }
});

// ── ATLAS Sync endpoints ─────────────────────────────────────────────────────

// GET /api/admin/atlas-sync/status — current sync state
router.get("/atlas-sync/status", authenticateToken, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Forbidden" });
  res.json(getSyncStatus());
});

// POST /api/admin/atlas-sync/run — manually trigger sync
router.post("/atlas-sync/run", authenticateToken, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Forbidden" });
  const result = await runAtlasSync();
  res.json({ message: "Sync complete", result });
});

// ── EnrollPro Advisory Sync endpoints ────────────────────────────────────────

// GET /api/admin/enrollpro-sync/status
router.get("/enrollpro-sync/status", authenticateToken, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Forbidden" });
  res.json(getEnrollProSyncStatus());
});

// POST /api/admin/enrollpro-sync/run — manually trigger sync
router.post("/enrollpro-sync/run", authenticateToken, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Forbidden" });
  const result = await runEnrollProSync();
  res.json({ message: "EnrollPro sync complete", result });
});

// POST /api/admin/templates/reindex — reindex SF/ECR templates from uploads folder into DB
router.post("/templates/reindex", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const target = String(req.body?.target || "all").toLowerCase();
    const includeSf = target === "all" || target === "sf";
    const includeEcr = target === "all" || target === "ecr";

    const result = {
      target,
      sf: {
        filesScanned: 0,
        formsDetected: 0,
        upserted: 0,
        skippedNoMatch: 0,
      },
      ecr: {
        filesScanned: 0,
        created: 0,
        updatedExisting: 0,
        skippedExisting: 0,
      },
    };

    if (includeSf) {
      const sfDir = path.join(__dirname, "../../uploads/templates");
      if (fs.existsSync(sfDir)) {
        const sfFiles = fs
          .readdirSync(sfDir)
          .filter((f) => /\.(xlsx|xls)$/i.test(f));

        for (const fileName of sfFiles) {
          result.sf.filesScanned++;
          const filePath = path.join(sfDir, fileName);
          const stat = fs.statSync(filePath);
          const mappings = detectSfSheetMappings(filePath);

          if (mappings.length === 0) {
            result.sf.skippedNoMatch++;
            continue;
          }

          result.sf.formsDetected += mappings.length;

          for (const mapping of mappings) {
            await prisma.excelTemplate.upsert({
              where: { formType: mapping.formType as any },
              create: {
                formType: mapping.formType as any,
                formName: SF_FORM_LABELS[mapping.formType] || `${mapping.formType} Template`,
                description: "Re-indexed from uploads/templates",
                filePath,
                fileName,
                fileSize: Number(stat.size),
                placeholders: [],
                instructions: "Re-indexed automatically by admin endpoint",
                isActive: true,
                uploadedBy: req.user!.id,
                uploadedByName: "Admin",
                sheetName: mapping.sheetName,
              } as any,
              update: {
                formName: SF_FORM_LABELS[mapping.formType] || `${mapping.formType} Template`,
                description: "Re-indexed from uploads/templates",
                filePath,
                fileName,
                fileSize: Number(stat.size),
                placeholders: [],
                instructions: "Re-indexed automatically by admin endpoint",
                isActive: true,
                uploadedBy: req.user!.id,
                uploadedByName: "Admin",
                sheetName: mapping.sheetName,
                updatedAt: new Date(),
              } as any,
            });
            result.sf.upserted++;
          }
        }
      }
    }

    if (includeEcr) {
      const ecrDir = path.join(__dirname, "../../uploads/ecr-templates");
      if (fs.existsSync(ecrDir)) {
        const ecrFiles = fs
          .readdirSync(ecrDir)
          .filter((f) => /\.(xlsx|xls)$/i.test(f));

        for (const fileName of ecrFiles) {
          result.ecr.filesScanned++;
          const filePath = path.join(ecrDir, fileName);
          const inferredSubjectName = deriveEcrSubjectName(fileName);
          const inferredSubjectType = inferEcrSubjectType(inferredSubjectName, fileName);
          const existing = await prisma.eCRTemplate.findFirst({ where: { filePath } });
          if (existing) {
            const shouldRefreshName =
              !existing.subjectName ||
              /^\s*ecr\s*$/i.test(existing.subjectName) ||
              /^\s*ecr[\s_-]*\d+\s*$/i.test(existing.subjectName);

            const shouldUpdate =
              shouldRefreshName ||
              !existing.subjectType ||
              existing.uploadedByName !== "Admin";

            if (shouldUpdate) {
              await prisma.eCRTemplate.update({
                where: { id: existing.id },
                data: {
                  ...(shouldRefreshName ? { subjectName: inferredSubjectName } : {}),
                  ...(!existing.subjectType && inferredSubjectType ? { subjectType: inferredSubjectType } : {}),
                  uploadedByName: "Admin",
                  uploadedBy: req.user!.id,
                  updatedAt: new Date(),
                } as any,
              });
              result.ecr.updatedExisting++;
            } else {
              result.ecr.skippedExisting++;
            }
            continue;
          }

          const stat = fs.statSync(filePath);
          await prisma.eCRTemplate.create({
            data: {
              subjectName: inferredSubjectName,
              subjectType: inferredSubjectType,
              description: "Re-indexed from uploads/ecr-templates",
              filePath,
              fileName,
              fileSize: Number(stat.size),
              placeholders: [],
              instructions: "Re-indexed automatically by admin endpoint",
              isActive: true,
              uploadedBy: req.user!.id,
              uploadedByName: "Admin",
            } as any,
          });
          result.ecr.created++;
        }
      }
    }

    await createAuditLog(
      AuditAction.CONFIG,
      req.user!,
      "Template Re-index",
      "Template",
      `Re-indexed templates from uploads (target=${target})`,
      req.ip,
      AuditSeverity.INFO,
      undefined,
      result as any
    );

    res.json({ message: "Template re-index completed", result });
  } catch (error: any) {
    console.error("Error during template re-index:", error);
    res.status(500).json({ message: "Template re-index failed", error: error.message });
  }
});

// ── Class Assignment Management ──────────────────────────────────────────────

// GET /api/admin/class-assignments/options — get teachers, subjects, sections for dropdowns
router.get("/class-assignments/options", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }
  try {
    const schoolYear = (req.query.schoolYear as string) || "2026-2027";
    const [teachers, subjects, sections] = await Promise.all([
      prisma.teacher.findMany({
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { user: { lastName: "asc" } },
      }),
      prisma.subject.findMany({ orderBy: { name: "asc" } }),
      prisma.section.findMany({
        where: { schoolYear },
        orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
      }),
    ]);
    res.json({ teachers, subjects, sections });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/class-assignments — list all with teacher/subject/section
router.get("/class-assignments", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }
  try {
    const schoolYear = (req.query.schoolYear as string) || "2026-2027";
    const assignments = await prisma.classAssignment.findMany({
      where: { schoolYear },
      include: {
        teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
        subject: true,
        section: true,
      },
      orderBy: [{ section: { gradeLevel: "asc" } }, { section: { name: "asc" } }],
    });

    const advisoryEntries = await prisma.workloadEntry.findMany({
      where: {
        schoolYear,
        type: WorkloadType.ADVISORY_ROLE,
      },
      include: {
        teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
        section: { select: { id: true, name: true, gradeLevel: true } },
      },
    });

    type WorkloadBucket = {
      teacherId: string;
      teacherName: string;
      sectionId: string;
      sectionName: string;
      gradeLevel: string;
      hgMinutes: number;
      advisoryRoleMinutes: number;
      otherSubjectMinutes: number;
      totalMinutes: number;
    };

    const summaryMap = new Map<string, WorkloadBucket>();
    const ensureBucket = (
      teacherId: string,
      teacherName: string,
      sectionId: string,
      sectionName: string,
      gradeLevel: string,
    ) => {
      const key = `${teacherId}|${sectionId}`;
      const existing = summaryMap.get(key);
      if (existing) return existing;
      const bucket: WorkloadBucket = {
        teacherId,
        teacherName,
        sectionId,
        sectionName,
        gradeLevel,
        hgMinutes: 0,
        advisoryRoleMinutes: 0,
        otherSubjectMinutes: 0,
        totalMinutes: 0,
      };
      summaryMap.set(key, bucket);
      return bucket;
    };

    for (const assignment of assignments) {
      const teacherName = `${assignment.teacher.user.lastName}, ${assignment.teacher.user.firstName}`;
      const bucket = ensureBucket(
        assignment.teacherId,
        teacherName,
        assignment.sectionId,
        assignment.section.name,
        assignment.section.gradeLevel,
      );
      if (assignment.subject.code.startsWith('HG')) {
        bucket.hgMinutes += assignment.teachingMinutes ?? 60;
      } else {
        bucket.otherSubjectMinutes += assignment.teachingMinutes ?? 60;
      }
    }

    for (const entry of advisoryEntries) {
      if (!entry.section) continue;
      const teacherName = `${entry.teacher.user.lastName}, ${entry.teacher.user.firstName}`;
      const bucket = ensureBucket(
        entry.teacherId,
        teacherName,
        entry.section.id,
        entry.section.name,
        entry.section.gradeLevel,
      );
      bucket.advisoryRoleMinutes += entry.minutes;
    }

    const workloadSummary = [...summaryMap.values()]
      .map((item) => ({
        ...item,
        totalMinutes: item.hgMinutes + item.advisoryRoleMinutes + item.otherSubjectMinutes,
      }))
      .sort((a, b) => {
        if (a.gradeLevel !== b.gradeLevel) return a.gradeLevel.localeCompare(b.gradeLevel);
        if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
        return a.teacherName.localeCompare(b.teacherName);
      });

    res.json({ assignments, workloadSummary });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/class-assignments — create a class assignment
router.post("/class-assignments", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }
  try {
    const { teacherId, subjectId, sectionId, schoolYear } = req.body;
    if (!teacherId || !subjectId || !sectionId || !schoolYear) {
      res.status(400).json({ message: "teacherId, subjectId, sectionId, and schoolYear are required" });
      return;
    }
    const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { code: true, name: true } });
    if (!subject) {
      res.status(404).json({ message: "Subject not found" });
      return;
    }
    if (subject.code.startsWith('HG') && subject.name !== 'Homeroom Guidance') {
      await prisma.subject.update({ where: { id: subjectId }, data: { name: 'Homeroom Guidance' } });
    }

    const assignment = await prisma.classAssignment.create({
      data: {
        teacherId,
        subjectId,
        sectionId,
        schoolYear,
        teachingMinutes: subject.code.startsWith('HG') ? 60 : null,
      },
      include: {
        teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
        subject: true,
        section: true,
      },
    });
    res.status(201).json(assignment);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(409).json({ message: "This teacher is already assigned to that subject and section for this school year." });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
});

// DELETE /api/admin/class-assignments/:id — delete a class assignment
router.delete("/class-assignments/:id", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ message: "Forbidden" }); return; }
  try {
    const assignmentId = String(req.params.id ?? '');
    if (!assignmentId) {
      res.status(400).json({ message: "Missing class assignment id" });
      return;
    }

    await prisma.classAssignment.update({
      where: { id: assignmentId },
      data: {
        isActive: false,
        archivedAt: new Date(),
        archivedReason: 'Manually removed in SMART',
      },
    });
    res.json({ message: "Archived" });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ message: "Assignment not found" });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
});

export default router;
