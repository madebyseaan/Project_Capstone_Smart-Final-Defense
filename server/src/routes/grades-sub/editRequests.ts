import { Router, Response } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../../middleware/auth";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { validate } from "../../middleware/validate";
import {
  editRequestSchema,
  editRequestApproveSchema,
  editRequestRejectSchema,
} from "../../schemas/grades";
import { resolveCurrentTerm } from "./helpers";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";

export default function registerEditRequests(router: Router): void {
  // Teacher: Create edit request for past term
  router.post(
    "/edit-request",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(editRequestSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { term, reason, classAssignmentId, gradeLevel, section, subject } = req.body;
        if (!term || !reason) {
          res.status(400).json({ message: "term and reason are required" });
          return;
        }

        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
          include: { user: true },
        });
        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const currentTerm = await resolveCurrentTerm();
        let schoolYearLabel: string;
        try {
          schoolYearLabel = await getActiveSchoolYearLabel();
        } catch {
          res.status(503).json({ message: "School year not resolved; try again shortly" });
          return;
        }
        const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
        if (termOrder[term] >= termOrder[currentTerm]) {
          res.status(400).json({ message: "Can only request edit access for past terms" });
          return;
        }

        // Check for existing pending request
        const existing = await prisma.gradeEditRequest.findFirst({
          where: { teacherId: teacher.userId, term, status: "PENDING" },
        });
        if (existing) {
          res.status(409).json({ message: "You already have a pending request for this term" });
          return;
        }

        const user = req.user!;
        const request = await prisma.gradeEditRequest.create({
          data: {
            teacherId: teacher.userId,
            teacherName: `${teacher.user?.firstName || ""} ${teacher.user?.lastName || ""}`.trim() || req.user!.username,
            term,
            schoolYear: schoolYearLabel,
            gradeLevel: gradeLevel || null,
            section: section || null,
            subject: subject || null,
            classAssignmentId: classAssignmentId || null,
            reason,
          },
        });

        // Broadcast to admin SSE
        const { broadcastSettingsUpdate } = await import("../../lib/sseManager");
        const updatedSettings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
        if (updatedSettings) broadcastSettingsUpdate(updatedSettings);

        res.status(201).json({ message: "Edit request submitted", request });
      } catch (err: any) {
        logger.error("Error creating edit request:", err);
        res.status(500).json({ message: "Failed to create edit request" });
      }
    }
  );

  // Teacher: Get own edit requests
  router.get(
    "/edit-requests",
    authenticateToken,
    authorizeRoles("TEACHER"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const teacher = await prisma.teacher.findUnique({ where: { userId: req.user?.id } });
        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }

        const requests = await prisma.gradeEditRequest.findMany({
          where: { teacherId: teacher.userId },
          orderBy: { createdAt: "desc" },
          take: 20,
        });

        res.json({ requests });
      } catch (err: any) {
        logger.error("Error fetching edit requests:", err);
        res.status(500).json({ message: "Failed to fetch edit requests" });
      }
    }
  );

  // Admin: Get all edit requests
  router.get(
    "/admin/edit-requests",
    authenticateToken,
    authorizeRoles("ADMIN"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { status } = req.query;
        const where = status ? { status: status as any } : {};
        const requests = await prisma.gradeEditRequest.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        res.json({ requests });
      } catch (err: any) {
        logger.error("Error fetching edit requests:", err);
        res.status(500).json({ message: "Failed to fetch edit requests" });
      }
    }
  );

  // Admin: Approve edit request
  router.post(
    "/admin/edit-requests/:id/approve",
    authenticateToken,
    authorizeRoles("ADMIN"),
    validate(editRequestApproveSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const id = req.params.id as string;
        const { hours } = req.body;
        const durationHours = Math.min(Math.max(Number(hours) || 24, 1), 168);

        const request = await prisma.gradeEditRequest.findUnique({ where: { id } });
        if (!request) {
          res.status(404).json({ message: "Request not found" });
          return;
        }
        if (request.status !== "PENDING") {
          res.status(400).json({ message: `Request is already ${request.status.toLowerCase()}` });
          return;
        }

        const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
        const user = req.user!;
        const adminUser = await prisma.user.findUnique({ where: { id: user.id } });

        const updated = await prisma.gradeEditRequest.update({
          where: { id },
          data: {
            status: "APPROVED",
            approvedById: user.id,
            approvedByName: `${adminUser?.firstName || ""} ${adminUser?.lastName || ""}`.trim() || user.username,
            expiresAt,
          },
        });

        await createAuditLog(
          AuditAction.UPDATE,
          user,
          `Approved grade edit request for ${request.teacherName} - ${request.term}`,
          "Grade Edit Request",
          `Approved edit access for ${durationHours}h. Expires: ${expiresAt.toISOString()}`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.INFO
        );

        res.json({ message: "Request approved", request: updated });
      } catch (err: any) {
        logger.error("Error approving edit request:", err);
        res.status(500).json({ message: "Failed to approve request" });
      }
    }
  );

  // Admin: Reject edit request
  router.post(
    "/admin/edit-requests/:id/reject",
    authenticateToken,
    authorizeRoles("ADMIN"),
    validate(editRequestRejectSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const id = req.params.id as string;
        const { reason } = req.body;

        const request = await prisma.gradeEditRequest.findUnique({ where: { id } });
        if (!request) {
          res.status(404).json({ message: "Request not found" });
          return;
        }
        if (request.status !== "PENDING") {
          res.status(400).json({ message: `Request is already ${request.status.toLowerCase()}` });
          return;
        }

        const user = req.user!;
        const updated = await prisma.gradeEditRequest.update({
          where: { id },
          data: { status: "REJECTED" },
        });

        await createAuditLog(
          AuditAction.UPDATE,
          user,
          `Rejected grade edit request for ${request.teacherName} - ${request.term}`,
          "Grade Edit Request",
          `Rejected. Reason: ${reason || "No reason provided"}`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.INFO
        );

        res.json({ message: "Request rejected", request: updated });
      } catch (err: any) {
        logger.error("Error rejecting edit request:", err);
        res.status(500).json({ message: "Failed to reject request" });
      }
    }
  );

  // Admin: Revoke (immediately expire) an approved edit request
  router.post(
    "/admin/edit-requests/:id/revoke",
    authenticateToken,
    authorizeRoles("ADMIN"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const id = req.params.id as string;

        const request = await prisma.gradeEditRequest.findUnique({ where: { id } });
        if (!request) {
          res.status(404).json({ message: "Request not found" });
          return;
        }
        if (request.status !== "APPROVED") {
          res.status(400).json({ message: `Cannot revoke a request with status ${request.status.toLowerCase()}` });
          return;
        }

        const user = req.user!;
        const updated = await prisma.gradeEditRequest.update({
          where: { id },
          data: { status: "EXPIRED", expiresAt: new Date() },
        });

        await createAuditLog(
          AuditAction.UPDATE,
          user,
          `Revoked grade edit access for ${request.teacherName} - ${request.term}`,
          "Grade Edit Request",
          `Admin manually revoked edit access`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.INFO
        );

        res.json({ message: "Edit access revoked", request: updated });
      } catch (err: any) {
        logger.error("Error revoking edit request:", err);
        res.status(500).json({ message: "Failed to revoke request" });
      }
    }
  );
}
