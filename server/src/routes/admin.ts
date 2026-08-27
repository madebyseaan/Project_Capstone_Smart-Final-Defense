import { Router, Request, Response } from "express";
import { Role, SubjectType, AuditAction, AuditSeverity, Term, WorkloadType } from "@prisma/client";
import { authenticateToken, authorizeRoles, AuthRequest } from "../middleware/auth";
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
import { getIntegrationV1ActiveSchoolYear, getIntegrationV1FacultyPage, getIntegrationV1LearnersPage, getEnrollProTeachers } from "../lib/enrollproClient";
import { getTransmutationTable, invalidateTransmutationCache } from "../lib/transmutationCache";
import { validateTransmutationEntries, validateTransmutationRowChange } from "../lib/transmutationValidation";
import { getActiveSchoolYearLabel, invalidateSchoolYearCache } from "../lib/schoolYearResolver";
import { logger } from "../lib/logger";
import { validate } from "../middleware/validate";
import {
  userCreateSchema,
  userUpdateSchema,
  userDeleteSchema,
  userSuspendSchema,
  settingsUpdateSchema,
  colorSettingsSchema,
  gradeLockSchema,
  gradingConfigSchema,
  classAssignmentCreateSchema,
  archiveYearSchema,
} from "../schemas/admin";

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
      logger.warn("[AdminDashboard] Failed to fetch live teacher count from EnrollPro, using local DB.", error.message);
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
      logger.warn("[AdminDashboard] Failed to fetch live student count from EnrollPro, falling back to local DB.", error.message);
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
    logger.error("Error fetching admin dashboard:", error);
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
    logger.error("Error fetching system health:", error);
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
    logger.error("Error fetching sync history:", error);
    res.status(500).json({ message: "Failed to fetch sync history" });
  }
});

// Trigger full unified sync from admin diagnostics.
router.post("/system/sync/run", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await runUnifiedSync({ source: 'admin-system-health', forceBranding: false });
    res.json({ message: "Unified sync complete", result });
  } catch (error: any) {
    logger.error("Error running unified sync:", error);
    res.status(500).json({ message: "Failed to run unified sync" });
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
        status: true,
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

    let enrollProTeachers: any[] = [];
    try {
      enrollProTeachers = await getEnrollProTeachers();
    } catch (err) {
      logger.error("Failed to fetch EnrollPro teachers for user management mapping:", err);
    }

    // Add status (we'll assume all users are active for now - could add isActive field later)
    const usersWithStatus = users.map((user) => {
      let resolvedEmployeeId = user.teacher?.employeeId || user.username;

      if (user.role === "TEACHER" && enrollProTeachers.length > 0) {
        const epTeacher = enrollProTeachers.find((et) => {
          const emailMatch = et.email && user.email && et.email.toLowerCase() === user.email.toLowerCase();
          const nameMatch = et.firstName && et.lastName && user.firstName && user.lastName &&
            et.firstName.toLowerCase().trim() === user.firstName.toLowerCase().trim() &&
            et.lastName.toLowerCase().trim() === user.lastName.toLowerCase().trim();
          const idMatch = String(et.id) === user.username || String(et.id) === user.teacher?.employeeId;
          const empIdMatch = et.employeeId && (et.employeeId === user.teacher?.employeeId || et.employeeId === user.username);
          return emailMatch || nameMatch || idMatch || empIdMatch;
        });

        if (epTeacher?.employeeId) {
          resolvedEmployeeId = epTeacher.employeeId;
        }
      }

      return {
        ...user,
        teacher: user.teacher
          ? { ...user.teacher, employeeId: resolvedEmployeeId }
          : { employeeId: resolvedEmployeeId },
        status: user.status || "Active",
        lastActive: user.updatedAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      };
    });

    res.json({ users: usersWithStatus });
  } catch (error) {
    logger.error("Error fetching users:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// Create new user
router.post("/users", authenticateToken, requireAdmin, validate(userCreateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
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
    logger.error("Error creating user:", error);
    res.status(500).json({ message: "Failed to create user" });
  }
});

// Update user
router.put("/users/:id", authenticateToken, requireAdmin, validate(userUpdateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
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
    logger.error("Error updating user:", error);
    res.status(500).json({ message: "Failed to update user" });
  }
});

// Delete user
router.delete("/users/:id", authenticateToken, requireAdmin, validate(userDeleteSchema), async (req: AuthRequest, res: Response): Promise<void> => {
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
    logger.error("Error deleting user:", error);
    res.status(500).json({ message: "Failed to delete user" });
  }
});

// Suspend user
router.post("/users/:id/suspend", authenticateToken, requireAdmin, validate(userSuspendSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { reason } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (user.id === req.user!.id) {
      res.status(400).json({ message: "Cannot suspend your own account" });
      return;
    }

    await prisma.user.update({
      where: { id },
      data: {
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspendedBy: req.user!.id,
        suspensionReason: reason || null,
      },
    });

    // Revoke all refresh tokens for immediate lockout
    await prisma.refreshToken.deleteMany({ where: { userId: id } });

    // Deactivate class assignments
    const teacher = await prisma.teacher.findUnique({ where: { userId: id } });
    if (teacher) {
      await prisma.classAssignment.updateMany({
        where: { teacherId: teacher.id, isActive: true },
        data: { isActive: false, archivedAt: new Date(), archivedReason: 'Teacher suspended' },
      });
    }

    await createAuditLog(
      AuditAction.UPDATE,
      req.user!,
      "User Account",
      "User",
      `Suspended user: ${user.firstName} ${user.lastName} (${user.username})${reason ? ` — Reason: ${reason}` : ''}`,
      req.ip,
      AuditSeverity.WARNING,
      id
    );

    res.json({ message: "User suspended successfully" });
  } catch (error) {
    logger.error("Error suspending user:", error);
    res.status(500).json({ message: "Failed to suspend user" });
  }
});

// Reactivate user
router.post("/users/:id/reactivate", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    await prisma.user.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null,
      },
    });

    await createAuditLog(
      AuditAction.UPDATE,
      req.user!,
      "User Account",
      "User",
      `Reactivated user: ${user.firstName} ${user.lastName} (${user.username})`,
      req.ip,
      AuditSeverity.INFO,
      id
    );

    res.json({ message: "User reactivated successfully" });
  } catch (error) {
    logger.error("Error reactivating user:", error);
    res.status(500).json({ message: "Failed to reactivate user" });
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
    logger.error("Error fetching audit logs:", error);
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
    logger.error("Error exporting audit logs:", error);
    res.status(500).json({ message: "Failed to export audit logs" });
  }
});

// ============================================
// SYSTEM SETTINGS ENDPOINTS
// ============================================

// Get system settings (public — theme data needed on login page)
router.get("/settings", async (req: Request, res: Response): Promise<void> => {
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
    logger.error("Error fetching settings:", error);
    res.status(500).json({ message: "Failed to fetch settings" });
  }
});

// Update system settings
router.put("/settings", authenticateToken, requireAdmin, validate(settingsUpdateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
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
      schoolYearId,
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
        schoolYearId: schoolYearId || null,
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
        schoolYearId: schoolYearId || null,
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
    logger.error("Error updating settings:", error);
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
            logger.warn("Failed to delete old logo file:", error);
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
      logger.error("Error uploading logo:", error);
      res.status(500).json({ message: "Failed to upload logo" });
    }
  }
);

// Update color scheme
router.put("/settings/colors", authenticateToken, requireAdmin, validate(colorSettingsSchema), async (req: AuthRequest, res: Response): Promise<void> => {
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
    logger.error("Error updating color scheme:", error);
    res.status(500).json({ message: "Failed to update color scheme" });
  }
});

// Toggle grade lock (EOSY lock)
router.post("/settings/grade-lock", authenticateToken, requireAdmin, validate(gradeLockSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { locked } = req.body;
    const settings = await prisma.systemSettings.update({
      where: { id: "main" },
      data: { gradeLock: Boolean(locked) },
    });
    await createAuditLog(
      AuditAction.CONFIG,
      req.user!,
      "Grade Lock",
      "Config",
      `Grade editing ${locked ? 'LOCKED' : 'UNLOCKED'} by admin`,
      req.ip,
      AuditSeverity.WARNING
    );
    broadcastSettingsUpdate(settings);
    res.json({ message: `Grade editing ${locked ? 'locked' : 'unlocked'}`, gradeLock: settings.gradeLock });
  } catch (error) {
    logger.error("Error toggling grade lock:", error);
    res.status(500).json({ message: "Failed to toggle grade lock" });
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
      logger.error("Error syncing from EnrollPro:", error instanceof Error ? error.message : error);
      res.status(500).json({
        message: "Failed to sync from EnrollPro",
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
    const defaultConfigs = [
      { subjectType: SubjectType.CORE, ww: 20, pt: 50, qa: 30 },
      { subjectType: SubjectType.MATH_SCIENCE, ww: 20, pt: 50, qa: 30 },
      { subjectType: SubjectType.MAPEH, ww: 20, pt: 60, qa: 20 },
      { subjectType: SubjectType.TLE, ww: 20, pt: 60, qa: 20 },
    ] as const;

    const existing = await prisma.gradingConfig.findMany({
      orderBy: { subjectType: "asc" },
    });

    const existingByType = new Map(existing.map((row) => [row.subjectType, row]));

    for (const config of defaultConfigs) {
      const current = existingByType.get(config.subjectType);

      // Self-heal legacy defaults: if config row is marked DepEd default but still has old weights,
      // normalize it to revised 2026 policy values.
      const shouldNormalizeDepEdDefaults =
        current &&
        current.isDepEdDefault &&
        (current.writtenWorkWeight !== config.ww ||
          current.performanceTaskWeight !== config.pt ||
          current.quarterlyAssessWeight !== config.qa);

      if (!current || shouldNormalizeDepEdDefaults) {
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
    }

    const configs = await prisma.gradingConfig.findMany({
      orderBy: { subjectType: "asc" },
    });

    res.json({ configs });
  } catch (error) {
    logger.error("Error fetching grading configs:", error);
    res.status(500).json({ message: "Failed to fetch grading configurations" });
  }
});

// Update grading configuration
router.put("/grading-config/:subjectType", authenticateToken, requireAdmin, validate(gradingConfigSchema), async (req: AuthRequest, res: Response): Promise<void> => {
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
    logger.error("Error updating grading config:", error);
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
    logger.error("Error resetting grading configs:", error);
    res.status(500).json({ message: "Failed to reset grading configurations" });
  }
});

// ── ATLAS Sync endpoints ─────────────────────────────────────────────────────

// GET /api/admin/atlas-sync/status — current sync state
router.get("/atlas-sync/status", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response) => {
  res.json(getSyncStatus());
});

// POST /api/admin/atlas-sync/run — manually trigger sync
router.post("/atlas-sync/run", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response) => {
  const result = await runAtlasSync();
  res.json({ message: "Sync complete", result });
});

// ── EnrollPro Advisory Sync endpoints ────────────────────────────────────────

// GET /api/admin/enrollpro-sync/status
router.get("/enrollpro-sync/status", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response) => {
  res.json(getEnrollProSyncStatus());
});

// POST /api/admin/enrollpro-sync/run — manually trigger sync
router.post("/enrollpro-sync/run", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response) => {
  const result = await runEnrollProSync();
  res.json({ message: "EnrollPro sync complete", result });
});

// POST /api/admin/templates/reindex — reindex SF/ECR templates from uploads folder into DB
router.post("/templates/reindex", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const target = String(req.body?.target || "all").toLowerCase();
    const includeSf = target === "all" || target === "sf";

    const result = {
      target,
      sf: {
        filesScanned: 0,
        formsDetected: 0,
        upserted: 0,
        skippedNoMatch: 0,
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
    logger.error("Error during template re-index:", error);
    res.status(500).json({ message: "Template re-index failed" });
  }
});

// ── Class Assignment Management ──────────────────────────────────────────────

// GET /api/admin/class-assignments/options — get teachers, subjects, sections for dropdowns
router.get("/class-assignments/options", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const schoolYear = (req.query.schoolYear as string) || await getActiveSchoolYearLabel();
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
    logger.error("Error fetching class assignment options:", err);
    res.status(500).json({ message: "Failed to fetch class assignment options" });
  }
});

// GET /api/admin/class-assignments — list all with teacher/subject/section
router.get("/class-assignments", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const schoolYear = (req.query.schoolYear as string) || await getActiveSchoolYearLabel();
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
        section: { select: { id: true, name: true, gradeLevel: true, program: true } },
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
    logger.error("Error fetching class assignments:", err);
    res.status(500).json({ message: "Failed to fetch class assignments" });
  }
});

// POST /api/admin/class-assignments — create a class assignment
router.post("/class-assignments", authenticateToken, authorizeRoles("ADMIN"), validate(classAssignmentCreateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
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
      logger.error("Error creating class assignment:", err);
      res.status(500).json({ message: "Failed to create class assignment" });
    }
  }
});

// DELETE /api/admin/class-assignments/:id — delete a class assignment
router.delete("/class-assignments/:id", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response): Promise<void> => {
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
      logger.error("Error archiving class assignment:", err);
      res.status(500).json({ message: "Failed to archive class assignment" });
    }
  }
});

// ─── Transmutation Table CRUD ─────────────────────────────────────────────

// GET /api/admin/transmutation-table — fetch all entries
router.get("/transmutation-table", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const table = await getTransmutationTable();
    res.json(table);
  } catch (err: any) {
    logger.error("Error fetching transmutation table:", err);
    res.status(500).json({ message: "Failed to fetch transmutation table" });
  }
});

// PUT /api/admin/transmutation-table — replace entire table
router.put("/transmutation-table", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ message: "entries array is required and must not be empty" });
      return;
    }

    const validationError = validateTransmutationEntries(entries);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.transmutationEntry.deleteMany({});
      await tx.transmutationEntry.createMany({
        data: entries.map((e: { minGrade: number; maxGrade: number; transmutedGrade: number }) => ({
          minGrade: e.minGrade,
          maxGrade: e.maxGrade,
          transmutedGrade: e.transmutedGrade,
          isDefault: true,
        })),
      });
    });

    invalidateTransmutationCache();

    await createAuditLog(
      AuditAction.UPDATE,
      { id: req.user?.id, firstName: req.user?.username, lastName: "", role: req.user?.role ?? "ADMIN" },
      "TransmutationTable",
      "CONFIG",
      `Replaced transmutation table with ${entries.length} entries`,
    );

    const table = await getTransmutationTable();
    res.json(table);
  } catch (err: any) {
    logger.error("Error updating transmutation table:", err);
    res.status(500).json({ message: "Failed to update transmutation table" });
  }
});

// POST /api/admin/transmutation-table/rows — add row(s)
router.post("/transmutation-table/rows", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { minGrade, maxGrade, transmutedGrade } = req.body;
    if (minGrade == null || maxGrade == null || transmutedGrade == null) {
      res.status(400).json({ message: "minGrade, maxGrade, and transmutedGrade are required" });
      return;
    }

    const existing = await prisma.transmutationEntry.findMany();
    const validationError = validateTransmutationRowChange(existing, { minGrade, maxGrade, transmutedGrade });
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const row = await prisma.transmutationEntry.create({
      data: { minGrade, maxGrade, transmutedGrade, isDefault: false },
    });

    invalidateTransmutationCache();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error("Error adding transmutation row:", err);
    res.status(500).json({ message: "Failed to add transmutation row" });
  }
});

// PUT /api/admin/transmutation-table/:id — update single row
router.put("/transmutation-table/:id", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { minGrade, maxGrade, transmutedGrade } = req.body;

    if (minGrade == null || maxGrade == null || transmutedGrade == null) {
      res.status(400).json({ message: "minGrade, maxGrade, and transmutedGrade are required" });
      return;
    }

    const existing = await prisma.transmutationEntry.findMany();
    const validationError = validateTransmutationRowChange(
      existing,
      { minGrade, maxGrade, transmutedGrade },
      id
    );
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const row = await prisma.transmutationEntry.update({
      where: { id },
      data: { minGrade, maxGrade, transmutedGrade },
    });

    invalidateTransmutationCache();
    res.json(row);
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ message: "Entry not found" });
    } else {
      logger.error("Error updating transmutation row:", err);
      res.status(500).json({ message: "Failed to update transmutation row" });
    }
  }
});

// DELETE /api/admin/transmutation-table/:id — remove row
router.delete("/transmutation-table/:id", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.transmutationEntry.findMany();
    const validationError = validateTransmutationRowChange(existing, null, id);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    await prisma.transmutationEntry.delete({ where: { id } });
    invalidateTransmutationCache();
    res.json({ message: "Deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ message: "Entry not found" });
    } else {
      logger.error("Error deleting transmutation row:", err);
      res.status(500).json({ message: "Failed to delete transmutation row" });
    }
  }
});

// POST /api/admin/transmutation-table/reset — reset to DepEd defaults
router.post("/transmutation-table/reset", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const defaultEntries = [
      { minGrade: 99.50, maxGrade: 100.00, transmutedGrade: 100 },
      { minGrade: 97.50, maxGrade: 99.49, transmutedGrade: 99 },
      { minGrade: 96.00, maxGrade: 97.49, transmutedGrade: 98 },
      { minGrade: 95.00, maxGrade: 95.99, transmutedGrade: 97 },
      { minGrade: 94.00, maxGrade: 94.99, transmutedGrade: 96 },
      { minGrade: 93.00, maxGrade: 93.99, transmutedGrade: 95 },
      { minGrade: 92.00, maxGrade: 92.99, transmutedGrade: 94 },
      { minGrade: 91.00, maxGrade: 91.99, transmutedGrade: 93 },
      { minGrade: 90.00, maxGrade: 90.99, transmutedGrade: 92 },
      { minGrade: 89.00, maxGrade: 89.99, transmutedGrade: 91 },
      { minGrade: 88.00, maxGrade: 88.99, transmutedGrade: 90 },
      { minGrade: 87.00, maxGrade: 87.99, transmutedGrade: 89 },
      { minGrade: 86.00, maxGrade: 86.99, transmutedGrade: 88 },
      { minGrade: 85.00, maxGrade: 85.99, transmutedGrade: 87 },
      { minGrade: 84.00, maxGrade: 84.99, transmutedGrade: 86 },
      { minGrade: 83.00, maxGrade: 83.99, transmutedGrade: 85 },
      { minGrade: 82.00, maxGrade: 82.99, transmutedGrade: 84 },
      { minGrade: 81.00, maxGrade: 81.99, transmutedGrade: 83 },
      { minGrade: 80.00, maxGrade: 80.99, transmutedGrade: 82 },
      { minGrade: 79.00, maxGrade: 79.99, transmutedGrade: 81 },
      { minGrade: 78.00, maxGrade: 78.99, transmutedGrade: 80 },
      { minGrade: 77.00, maxGrade: 77.99, transmutedGrade: 79 },
      { minGrade: 76.00, maxGrade: 76.99, transmutedGrade: 78 },
      { minGrade: 75.00, maxGrade: 75.99, transmutedGrade: 77 },
      { minGrade: 73.00, maxGrade: 74.99, transmutedGrade: 76 },
      { minGrade: 70.00, maxGrade: 72.99, transmutedGrade: 75 },
      { minGrade: 68.00, maxGrade: 69.99, transmutedGrade: 74 },
      { minGrade: 66.00, maxGrade: 67.99, transmutedGrade: 73 },
      { minGrade: 64.00, maxGrade: 65.99, transmutedGrade: 72 },
      { minGrade: 62.00, maxGrade: 63.99, transmutedGrade: 71 },
      { minGrade: 60.00, maxGrade: 61.99, transmutedGrade: 70 },
      { minGrade: 58.00, maxGrade: 59.99, transmutedGrade: 69 },
      { minGrade: 56.00, maxGrade: 57.99, transmutedGrade: 68 },
      { minGrade: 54.00, maxGrade: 55.99, transmutedGrade: 67 },
      { minGrade: 52.00, maxGrade: 53.99, transmutedGrade: 66 },
      { minGrade: 50.00, maxGrade: 51.99, transmutedGrade: 65 },
      { minGrade: 48.00, maxGrade: 49.99, transmutedGrade: 64 },
      { minGrade: 46.00, maxGrade: 47.99, transmutedGrade: 63 },
      { minGrade: 43.00, maxGrade: 45.99, transmutedGrade: 62 },
      { minGrade: 40.00, maxGrade: 42.99, transmutedGrade: 61 },
      { minGrade: 0.00, maxGrade: 39.99, transmutedGrade: 60 },
    ];

    await prisma.$transaction(async (tx) => {
      await tx.transmutationEntry.deleteMany({});
      await tx.transmutationEntry.createMany({
        data: defaultEntries.map((e) => ({ ...e, isDefault: true })),
      });
    });

    invalidateTransmutationCache();

    await createAuditLog(
      AuditAction.UPDATE,
      { id: req.user?.id, firstName: req.user?.username, lastName: "", role: req.user?.role ?? "ADMIN" },
      "TransmutationTable",
      "CONFIG",
      "Reset transmutation table to DepEd defaults (41 entries)",
    );

    const table = await getTransmutationTable();
    res.json(table);
  } catch (err: any) {
    logger.error("Error resetting transmutation table:", err);
    res.status(500).json({ message: "Failed to reset transmutation table" });
  }
});

// ─── Per-Subject Weight Overrides ─────────────────────────────────────────

// GET /api/admin/subject-weights — list all subjects with weights + override status
router.get("/subject-weights", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjects = await prisma.subject.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        writtenWorkWeight: true,
        perfTaskWeight: true,
        quarterlyAssessWeight: true,
      },
      orderBy: { name: 'asc' },
    });

    const result = subjects.map((s) => ({
      ...s,
      hasOverride: s.writtenWorkWeight !== null && s.perfTaskWeight !== null && s.quarterlyAssessWeight !== null,
    }));

    res.json(result);
  } catch (err: any) {
    logger.error("Error fetching subject weights:", err);
    res.status(500).json({ message: "Failed to fetch subject weights" });
  }
});

// PUT /api/admin/subject-weights/:subjectId — set per-subject override
router.put("/subject-weights/:subjectId", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = req.params.subjectId as string;
    const { writtenWorkWeight, perfTaskWeight, quarterlyAssessWeight } = req.body;

    if (writtenWorkWeight == null || perfTaskWeight == null || quarterlyAssessWeight == null) {
      res.status(400).json({ message: "writtenWorkWeight, perfTaskWeight, and quarterlyAssessWeight are required" });
      return;
    }

    const subject = await prisma.subject.update({
      where: { id: subjectId },
      data: {
        writtenWorkWeight: Number(writtenWorkWeight),
        perfTaskWeight: Number(perfTaskWeight),
        quarterlyAssessWeight: Number(quarterlyAssessWeight),
      },
    });

    res.json(subject);
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ message: "Subject not found" });
    } else {
      logger.error("Error updating subject weight:", err);
      res.status(500).json({ message: "Failed to update subject weight" });
    }
  }
});

// DELETE /api/admin/subject-weights/:subjectId — clear override (revert to group default)
router.delete("/subject-weights/:subjectId", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = req.params.subjectId as string;

    const subject = await prisma.subject.update({
      where: { id: subjectId },
      data: {
        writtenWorkWeight: null,
        perfTaskWeight: null,
        quarterlyAssessWeight: null,
      },
    });

    res.json(subject);
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ message: "Subject not found" });
    } else {
      logger.error("Error clearing subject weight:", err);
      res.status(500).json({ message: "Failed to clear subject weight" });
    }
  }
});

// POST /api/admin/subject-weights/bulk — bulk update
router.post("/subject-weights/bulk", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({ message: "updates array is required" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.subject.update({
          where: { id: u.subjectId },
          data: {
            writtenWorkWeight: u.writtenWorkWeight ?? null,
            perfTaskWeight: u.perfTaskWeight ?? null,
            quarterlyAssessWeight: u.quarterlyAssessWeight ?? null,
          },
        });
      }
    });

    res.json({ message: `Updated ${updates.length} subjects` });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ message: "One or more subjects not found" });
    } else {
      logger.error("Error bulk updating subject weights:", err);
      res.status(500).json({ message: "Failed to bulk update subject weights" });
    }
  }
});

// ---------------------------------------------------------------------------
// School Year Management
// ---------------------------------------------------------------------------

// List all school years
router.get("/school-years", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const years = await prisma.schoolYear.findMany({ orderBy: { label: "desc" } });
    res.json({ schoolYears: years });
  } catch (err: any) {
    logger.error("Error fetching school years:", err);
    res.status(500).json({ message: "Failed to fetch school years" });
  }
});

// Create a new school year
router.post("/school-years", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { label, startDate, endDate } = req.body;
    if (!label) {
      res.status(400).json({ message: "label is required (e.g. '2027-2028')" });
      return;
    }

    const existing = await prisma.schoolYear.findUnique({ where: { label } });
    if (existing) {
      res.status(409).json({ message: `School year ${label} already exists` });
      return;
    }

    const year = await prisma.schoolYear.create({
      data: {
        label,
        status: "DRAFT",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
    });
    invalidateSchoolYearCache();

    const user = req.user;
    if (user) {
      await createAuditLog(
        AuditAction.CREATE,
        user,
        `Created School Year ${label}`,
        "School Year",
        `Created new school year: ${label} (status: DRAFT)`,
        (req.ip as string) || req.socket?.remoteAddress,
        AuditSeverity.INFO
      );
    }

    res.status(201).json(year);
  } catch (err: any) {
    logger.error("Error creating school year:", err);
    res.status(500).json({ message: "Failed to create school year" });
  }
});

// Update school year status
router.patch("/school-years/:id", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { status, startDate, endDate } = req.body;

    const year = await prisma.schoolYear.findUnique({ where: { id } });
    if (!year) {
      res.status(404).json({ message: "School year not found" });
      return;
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate) updateData.endDate = new Date(endDate);
    if (status === "ARCHIVED" || status === "COMPLETED") updateData.archivedAt = new Date();

    const updated = await prisma.schoolYear.update({ where: { id }, data: updateData });
    invalidateSchoolYearCache();

    const user = req.user;
    if (user) {
      await createAuditLog(
        AuditAction.UPDATE,
        user,
        `Updated School Year ${year.label}`,
        "School Year",
        `Updated school year ${year.label}: status=${updated.status}`,
        (req.ip as string) || req.socket?.remoteAddress,
        AuditSeverity.INFO
      );
    }

    res.json(updated);
  } catch (err: any) {
    logger.error("Error updating school year:", err);
    res.status(500).json({ message: "Failed to update school year" });
  }
});

// Delete a school year (only DRAFT status)
router.delete("/school-years/:id", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const year = await prisma.schoolYear.findUnique({ where: { id } });
    if (!year) {
      res.status(404).json({ message: "School year not found" });
      return;
    }

    if (year.status !== "DRAFT") {
      res.status(400).json({ message: `Cannot delete ${year.label} (status: ${year.status}). Only DRAFT years can be deleted.` });
      return;
    }

    await prisma.schoolYear.delete({ where: { id } });
    invalidateSchoolYearCache();

    const user = req.user;
    if (user) {
      await createAuditLog(
        AuditAction.DELETE,
        user,
        `Deleted School Year ${year.label}`,
        "School Year",
        `Deleted draft school year: ${year.label}`,
        (req.ip as string) || req.socket?.remoteAddress,
        AuditSeverity.WARNING
      );
    }

    res.json({ message: `School year ${year.label} deleted` });
  } catch (err: any) {
    logger.error("Error deleting school year:", err);
    res.status(500).json({ message: "Failed to delete school year" });
  }
});

// ---------------------------------------------------------------------------
// Archive School Year — freeze all data for a completed year
// ---------------------------------------------------------------------------
router.post("/archive-year", authenticateToken, requireAdmin, validate(archiveYearSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { schoolYear } = req.body;
    if (!schoolYear) {
      res.status(400).json({ message: "schoolYear is required" });
      return;
    }

    // Verify the year exists in the data
    const sectionCount = await prisma.section.count({ where: { schoolYear } });
    if (sectionCount === 0) {
      res.status(404).json({ message: `No sections found for school year ${schoolYear}` });
      return;
    }

    // Prevent archiving the current active year
    const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
    if (settings?.currentSchoolYear === schoolYear) {
      res.status(400).json({ message: `Cannot archive the current active school year (${schoolYear}). Roll over to a new year first.` });
      return;
    }

    const archiveTime = new Date();
    const archiveReason = `Year ${schoolYear} archived`;

    // Run all archival in a transaction
    const results = await prisma.$transaction(async (tx) => {
      // 1. Archive all Grades for this school year
      const gradesResult = await tx.grade.updateMany({
        where: {
          classAssignment: { schoolYear }
        },
        data: {
          isArchived: true,
          archivedAt: archiveTime,
          archivedReason: archiveReason
        }
      });

      // 2. Archive all Enrollments
      const enrollmentsResult = await tx.enrollment.updateMany({
        where: { schoolYear },
        data: {
          isArchived: true,
          archivedAt: archiveTime,
          archivedReason: archiveReason
        }
      });

      // 3. Mark Sections as COMPLETED
      const sectionsResult = await tx.section.updateMany({
        where: { schoolYear },
        data: {
          status: "COMPLETED",
          archivedAt: archiveTime
        }
      });

      // 4. Archive ClassAssignments
      const assignmentsResult = await tx.classAssignment.updateMany({
        where: { schoolYear },
        data: {
          isActive: false,
          archivedAt: archiveTime,
          archivedReason: archiveReason
        }
      });

      return {
        grades: gradesResult.count,
        enrollments: enrollmentsResult.count,
        sections: sectionsResult.count,
        assignments: assignmentsResult.count
      };
    });

    // Audit log
    const user = req.user;
    if (user) {
      await createAuditLog(
        AuditAction.UPDATE,
        user,
        `Archive School Year ${schoolYear}`,
        "System Settings",
        `Archived year ${schoolYear}: ${results.grades} grades, ${results.enrollments} enrollments, ${results.sections} sections, ${results.assignments} assignments frozen`,
        (req.ip as string) || req.socket?.remoteAddress,
        AuditSeverity.WARNING
      );
    }

    // Auto-lock grades after archiving
    await prisma.systemSettings.update({
      where: { id: "main" },
      data: { gradeLock: true },
    });

    res.json({
      message: `School year ${schoolYear} archived successfully`,
      schoolYear,
      archived: results
    });
  } catch (err: any) {
    logger.error("Error archiving school year:", err);
    res.status(500).json({ message: "Failed to archive school year" });
  }
});

export default router;
