import { Response } from "express";
import { AuditAction, AuditSeverity, EditRequestStatus } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { getIntegrationV1ActiveSchoolYear, getIntegrationV1FacultyPage, getIntegrationV1LearnersPage } from "../../lib/enrollproClient";
import { getActiveTermLabels } from "../../lib/schoolYearResolver";
import { getSystemHealthSnapshot } from "../../lib/systemHealth";
import { getUnifiedSyncStatus } from "../../lib/syncCoordinator";
import { listUnfinalizedSections } from "../../lib/promotion";
import { logger } from "../../lib/logger";
import { requireAdmin } from "./helpers";
import { Router } from "express";

export default function (router: Router) {
  router.get("/dashboard", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const settings = await prisma.systemSettings.findUnique({
        where: { id: "main" },
        include: { schoolYear: true },
      });

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
          const { meta } = await getIntegrationV1FacultyPage(activeSy.id, 1, 1);
          if (meta?.total) {
            totalTeachers = meta.total;
          }
        }
      } catch (error: any) {
        logger.warn("[AdminDashboard] Failed to fetch live teacher count from EnrollPro, using local DB.", error.message);
      }

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

      try {
        const activeSy = await getIntegrationV1ActiveSchoolYear();
        if (activeSy && activeSy.id) {
          const page = await getIntegrationV1LearnersPage(activeSy.id, 1, 1);
          totalStudents = page.meta?.total || 0;
          studentCountSchoolYear = activeSy.yearLabel;
        }
      } catch (error: any) {
        logger.warn("[AdminDashboard] Failed to fetch live student count from EnrollPro, falling back to local DB.", error.message);
      }

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

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayLogins = await prisma.auditLog.count({
        where: {
          action: AuditAction.LOGIN,
          createdAt: { gte: today },
        },
      });

      const recentLogs = await prisma.auditLog.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
      });

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const activeUsers = await prisma.auditLog.count({
        where: {
          action: AuditAction.LOGIN,
          createdAt: { gte: oneHourAgo },
        },
      });

      // ── Real 7-day login trend (bucketed from AuditLog) ───────────────
      const trendStart = new Date();
      trendStart.setHours(0, 0, 0, 0);
      trendStart.setDate(trendStart.getDate() - 6);
      const recentLoginLogs = await prisma.auditLog.findMany({
        where: { action: AuditAction.LOGIN, createdAt: { gte: trendStart } },
        select: { createdAt: true },
      });
      const loginTrend: Array<{ date: string; count: number }> = [];
      for (let i = 0; i < 7; i++) {
        const day = new Date(trendStart);
        day.setDate(trendStart.getDate() + i);
        const next = new Date(day);
        next.setDate(day.getDate() + 1);
        loginTrend.push({
          date: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          count: recentLoginLogs.filter((log) => log.createdAt >= day && log.createdAt < next).length,
        });
      }

      // ── Operational signals ───────────────────────────────────────────
      const [pendingEditRequests, activeClassAssignments] = await Promise.all([
        prisma.gradeEditRequest.count({ where: { status: EditRequestStatus.PENDING } }),
        configuredSchoolYear
          ? prisma.classAssignment.count({ where: { schoolYear: configuredSchoolYear, isActive: true } })
          : Promise.resolve(0),
      ]);

      const years = await prisma.schoolYear.findMany({ orderBy: { label: "desc" } });
      const currentSY = settings?.schoolYear ?? null;
      const previousYear = years.find((y) => y.id !== currentSY?.id && y.status !== "ARCHIVED") ?? null;

      let unfinalizedCount = 0;
      if (previousYear) {
        try {
          const unfinalized = await listUnfinalizedSections(previousYear.label);
          unfinalizedCount = unfinalized.length;
        } catch (e: any) {
          logger.warn("[AdminDashboard] Failed to compute unfinalized sections.", e.message);
        }
      }

      let offlineServices: string[] = [];
      let integrationsChecked = false;
      let overallStatus = "HEALTHY";
      const syncState = getUnifiedSyncStatus();
      const lastSyncAt: string | null = syncState.lastSyncAt ?? null;
      let minutesSinceLastSync: number | null = null;
      if (lastSyncAt) {
        minutesSinceLastSync = Math.max(0, Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 60000));
      }
      const syncStatus = minutesSinceLastSync === null ? "never" : minutesSinceLastSync <= 60 ? "fresh" : "stale";

      try {
        // Best-effort: never let external health pings block the dashboard.
        const health = await Promise.race([
          getSystemHealthSnapshot(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (health) {
          offlineServices = [health.external.enrollpro, health.external.atlas]
            .filter((service) => !service.online)
            .map((service) => service.name);
          overallStatus = health.status;
          integrationsChecked = true;
        }
      } catch (e: any) {
        logger.warn("[AdminDashboard] Failed to fetch system health snapshot.", e.message);
      }

      let termLabels = { T1: "Term 1", T2: "Term 2", T3: "Term 3" };
      try {
        termLabels = await getActiveTermLabels();
      } catch (e: any) {
        logger.warn("[AdminDashboard] Failed to resolve term labels, using defaults.", e.message);
      }

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
          overall: overallStatus,
          syncStatus,
          lastSyncAt,
          minutesSinceLastSync,
          integrationsChecked,
        },
        attention: {
          pendingEditRequests,
          unfinalizedCount,
          unfinalizedSections: [],
          previousYearLabel: previousYear?.label ?? null,
          previousYearStatus: previousYear?.status ?? null,
          offlineServices,
          activeClassAssignments,
        },
        loginTrend,
        settings: settings
          ? {
              schoolName: settings.schoolName,
              currentSchoolYear: settings.currentSchoolYear,
              currentTerm: settings.currentTerm,
              gradeLock: settings.gradeLock ?? false,
              transitionLock: settings.transitionLock ?? false,
            }
          : null,
        termLabels,
      });
    } catch (error) {
      logger.error("Error fetching admin dashboard:", error);
      res.status(500).json({ message: "Failed to fetch dashboard data" });
    }
  });
}
