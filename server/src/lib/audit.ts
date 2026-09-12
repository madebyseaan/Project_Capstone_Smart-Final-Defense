import { AuditAction, AuditSeverity, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { broadcastLog } from "./sseManager";
import { getAuditContext } from "./requestContext";
import { logger } from "./logger";

export type AuditOutcome = "success" | "failure";

export async function createAuditLog(
  action: AuditAction,
  user: { id?: string | null; firstName?: string | null; lastName?: string | null; role: string },
  target: string,
  targetType: string,
  details: string,
  ipAddress?: string,
  severity: AuditSeverity = AuditSeverity.INFO,
  targetId?: string,
  metadata?: object,
  outcome: AuditOutcome = "success"
) {
  // Request-scoped context (IP / device / network / route) captured by
  // auditContextMiddleware. Existing call sites get this for free.
  const ctx = getAuditContext();

  const userId = user.id && user.id !== "unknown" ? user.id : undefined;
  const data = {
    action,
    userId,
    userName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.role,
    userRole: user.role,
    target,
    targetType,
    targetId,
    details,
    ipAddress: ipAddress || ctx?.ip,
    severity,
    metadata: metadata || undefined,
    userAgent: ctx?.userAgent ?? undefined,
    browser: ctx?.browser ?? undefined,
    os: ctx?.os ?? undefined,
    deviceType: ctx?.deviceType ?? undefined,
    network: ctx?.network ?? undefined,
    outcome,
    requestMethod: ctx?.method ?? undefined,
    requestPath: ctx?.path ?? undefined,
  };

  let log;

  try {
    try {
      log = await prisma.auditLog.create({ data });
    } catch (error) {
      // If a caller passes an ID that no longer exists, keep auth/actions working and write an anonymous audit log.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        log = await prisma.auditLog.create({
          data: {
            ...data,
            userId: undefined,
          },
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    // Audit logging is best-effort: it must NEVER fail or delay the business
    // action it is recording. Swallow and report instead of throwing.
    logger.error("[audit] Failed to write audit log:", error);
    return;
  }

  // Push to all connected SSE admin clients
  try {
    broadcastLog({
      id: log.id,
      action: log.action.toLowerCase(),
      user: log.userName,
      userRole: log.userRole,
      target: log.target,
      targetType: log.targetType,
      details: log.details,
      ipAddress: log.ipAddress,
      browser: log.browser,
      os: log.os,
      deviceType: log.deviceType,
      network: log.network,
      outcome: log.outcome,
      requestPath: log.requestPath,
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
    });
  } catch (error) {
    logger.error("[audit] Failed to broadcast audit log:", error);
  }
}
