import { Router, Response } from "express";
import { AuditAction, AuditSeverity, Prisma } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { addSseClient, removeSseClient } from "../../lib/sseManager";
import { logger } from "../../lib/logger";
import { requireAdmin } from "./helpers";

export default function (router: Router) {
  // Get audit logs with filtering
  router.get("/logs", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { action, severity, network, deviceType, outcome, from, to, search, limit = "50", offset = "0" } = req.query;

      const where: Prisma.AuditLogWhereInput = {};

      if (action && action !== "all") {
        where.action = (action as string).toUpperCase() as AuditAction;
      }

      if (severity && severity !== "all") {
        where.severity = (severity as string).toUpperCase() as AuditSeverity;
      }

      if (network && network !== "all") {
        where.network = network as string;
      }

      if (deviceType && deviceType !== "all") {
        where.deviceType = deviceType as string;
      }

      if (outcome && outcome !== "all") {
        where.outcome = outcome as string;
      }

      // Date range — `to` is inclusive of the whole day
      const fromDate = from ? new Date(from as string) : null;
      const toDate = to ? new Date(to as string) : null;
      if ((fromDate && !isNaN(fromDate.getTime())) || (toDate && !isNaN(toDate.getTime()))) {
        where.createdAt = {};
        if (fromDate && !isNaN(fromDate.getTime())) where.createdAt.gte = fromDate;
        if (toDate && !isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          where.createdAt.lte = toDate;
        }
      }

      if (search) {
        where.OR = [
          { userName: { contains: search as string, mode: "insensitive" } },
          { target: { contains: search as string, mode: "insensitive" } },
          { details: { contains: search as string, mode: "insensitive" } },
          { ipAddress: { contains: search as string, mode: "insensitive" } },
          { browser: { contains: search as string, mode: "insensitive" } },
          { os: { contains: search as string, mode: "insensitive" } },
          { deviceType: { contains: search as string, mode: "insensitive" } },
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

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [actionCounts, severityCounts, todayCount, failedCount, deviceGroups] = await Promise.all([
        prisma.auditLog.groupBy({ by: ["action"], _count: true }),
        prisma.auditLog.groupBy({ by: ["severity"], _count: true }),
        prisma.auditLog.count({ where: { createdAt: { gte: startOfToday } } }),
        prisma.auditLog.count({ where: { outcome: "failure" } }),
        prisma.auditLog.groupBy({ by: ["ipAddress"], where: { ipAddress: { not: null } } }),
      ]);

      res.json({
        logs: logs.map((log) => ({
          id: log.id,
          action: log.action.toLowerCase(),
          user: log.userName,
          userRole: log.userRole,
          userId: log.userId,
          target: log.target,
          targetType: log.targetType,
          details: log.details,
          ipAddress: log.ipAddress,
          browser: log.browser,
          os: log.os,
          deviceType: log.deviceType,
          network: log.network,
          outcome: log.outcome,
          requestMethod: log.requestMethod,
          requestPath: log.requestPath,
          userAgent: log.userAgent,
          metadata: log.metadata,
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
          total: await prisma.auditLog.count(),
          creates: actionCounts.find((c) => c.action === "CREATE")?._count || 0,
          updates: actionCounts.find((c) => c.action === "UPDATE")?._count || 0,
          deletes: actionCounts.find((c) => c.action === "DELETE")?._count || 0,
          logins:
            (actionCounts.find((c) => c.action === "LOGIN")?._count || 0) +
            (actionCounts.find((c) => c.action === "LOGOUT")?._count || 0),
          critical: severityCounts.find((c) => c.severity === "CRITICAL")?._count || 0,
          today: todayCount,
          failed: failedCount,
          uniqueDevices: deviceGroups.filter((g) => g.ipAddress).length,
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
        take: 1000
      });

      const escape = (value: unknown) => String(value ?? "").replace(/"/g, '""');

      const csv = [
        "ID,Action,User,Role,Target,Details,IP Address,Network,Device Type,Browser,OS,Outcome,Method,Path,Severity,Date/Time",
        ...logs.map(
          (log) =>
            `"${escape(log.id)}","${escape(log.action)}","${escape(log.userName)}","${escape(log.userRole)}","${escape(log.target)}","${escape(log.details)}","${escape(log.ipAddress)}","${escape(log.network)}","${escape(log.deviceType)}","${escape(log.browser)}","${escape(log.os)}","${escape(log.outcome)}","${escape(log.requestMethod)}","${escape(log.requestPath)}","${escape(log.severity)}","${escape(log.createdAt.toISOString())}"`
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
}
