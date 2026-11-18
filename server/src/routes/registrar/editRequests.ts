/**
 * registrar/editRequests.ts — Registrar-owned correction windows for
 * finalized grades. Admin approves the request; the registrar opens, closes,
 * reviews, declines, or re-finalizes it.
 */

import { Router, Response } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import {
  closeCorrectionWindow,
  declineCorrectionWindow,
  getCorrectionSummary,
  listCorrectionRequests,
  openCorrectionWindow,
  refinalizeCorrectionWindow,
  reviewCorrectionWindow,
  type CorrectionActionResult,
} from "../../lib/editRequestWindows";
import {
  correctionWindowDeclineSchema,
  correctionWindowIdSchema,
  correctionWindowQuerySchema,
} from "../../schemas/registrar";

function requireRegistrar(req: AuthRequest, res: Response): boolean {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") {
    res.status(403).json({ message: "Access denied. Registrar only." });
    return false;
  }
  return true;
}

function actorOf(req: AuthRequest) {
  const user = req.user!;
  return {
    id: user.id,
    name: user.username,
    audit: {
      id: user.id,
      firstName: user.username,
      lastName: "",
      role: user.role,
      username: user.username,
    },
  };
}

function sendError(res: Response, result: Extract<CorrectionActionResult<unknown>, { ok: false }>): void {
  switch (result.code) {
    case "NOT_FOUND":
      res.status(404).json({ message: result.message, code: result.code });
      return;
    case "YEAR_ARCHIVED":
    case "EOSY_STARTED":
    case "INVALID_STATE":
      res.status(409).json({ message: result.message, code: result.code });
      return;
    case "NOT_WINDOW_REQUEST":
    case "NO_FINALIZED_GRADES":
    case "NO_ASSIGNMENT":
      res.status(400).json({ message: result.message, code: result.code });
      return;
    default:
      res.status(400).json({ message: result.message });
  }
}

export default function registerRegistrarEditRequests(router: Router): void {
  // GET /registrar/edit-requests?schoolYear=&includeClosed=
  router.get(
    "/edit-requests",
    authenticateToken,
    validate(correctionWindowQuerySchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      if (!requireRegistrar(req, res)) return;
      try {
        const query = req.query as { schoolYear?: string; includeClosed?: string };
        const schoolYear = query.schoolYear || (await getActiveSchoolYearLabel());
        const result = await listCorrectionRequests({
          schoolYear,
          includeClosed: query.includeClosed === "true",
        });
        res.json({ schoolYear, ...result });
      } catch (err: any) {
        logger.error("[registrar/edit-requests]", err.message);
        res.status(500).json({ message: "Failed to load correction windows" });
      }
    },
  );

  // GET /registrar/edit-requests/summary?schoolYear=
  router.get(
    "/edit-requests/summary",
    authenticateToken,
    async (req: AuthRequest, res: Response): Promise<void> => {
      if (!requireRegistrar(req, res)) return;
      try {
        const schoolYear =
          (req.query.schoolYear as string | undefined) || (await getActiveSchoolYearLabel());
        const summary = await getCorrectionSummary(schoolYear);
        res.json({ schoolYear, ...summary });
      } catch (err: any) {
        logger.error("[registrar/edit-requests/summary]", err.message);
        res.status(500).json({ message: "Failed to load correction window summary" });
      }
    },
  );

  // GET /registrar/edit-requests/:id/review
  router.get(
    "/edit-requests/:id/review",
    authenticateToken,
    validate(correctionWindowIdSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      if (!requireRegistrar(req, res)) return;
      try {
        const result = await reviewCorrectionWindow(String(req.params.id));
        if (!result.ok) {
          sendError(res, result);
          return;
        }
        res.json(result.data);
      } catch (err: any) {
        logger.error("[registrar/edit-requests/review]", err.message);
        res.status(500).json({ message: "Failed to review correction window" });
      }
    },
  );

  // POST /registrar/edit-requests/:id/open-window
  router.post(
    "/edit-requests/:id/open-window",
    authenticateToken,
    validate(correctionWindowIdSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      if (!requireRegistrar(req, res)) return;
      try {
        const actor = actorOf(req);
        const result = await openCorrectionWindow({
          requestId: String(req.params.id),
          actor: { id: actor.id, name: actor.name },
        });
        if (!result.ok) {
          sendError(res, result);
          return;
        }
        await createAuditLog(
          AuditAction.CONFIG,
          actor.audit,
          `Correction window opened: ${result.data.teacherName} — ${result.data.section ?? "Section"} ${result.data.subject ?? ""} (${result.data.term})`,
          "Grade Edit Request",
          `Opened a ${result.data.approvedHours ?? 24}h edit window. ${result.data.unfinalizedGradeCount} grade(s) temporarily unfinalized.`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.WARNING,
          result.data.id,
          { term: result.data.term, schoolYear: result.data.schoolYear },
        );
        res.json({ message: "Correction window opened", request: result.data });
      } catch (err: any) {
        logger.error("[registrar/edit-requests/open]", err.message);
        res.status(500).json({ message: "Failed to open correction window" });
      }
    },
  );

  // POST /registrar/edit-requests/:id/close-window
  router.post(
    "/edit-requests/:id/close-window",
    authenticateToken,
    validate(correctionWindowIdSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      if (!requireRegistrar(req, res)) return;
      try {
        const actor = actorOf(req);
        const result = await closeCorrectionWindow({
          requestId: String(req.params.id),
          actor: { id: actor.id, name: actor.name },
        });
        if (!result.ok) {
          sendError(res, result);
          return;
        }
        await createAuditLog(
          AuditAction.UPDATE,
          actor.audit,
          `Correction window closed: ${result.data.teacherName} — ${result.data.term}`,
          "Grade Edit Request",
          "Window closed early. Grades remain DRAFT until re-finalized.",
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.WARNING,
          result.data.id,
        );
        res.json({ message: "Correction window closed", request: result.data });
      } catch (err: any) {
        logger.error("[registrar/edit-requests/close]", err.message);
        res.status(500).json({ message: "Failed to close correction window" });
      }
    },
  );

  // POST /registrar/edit-requests/:id/decline
  router.post(
    "/edit-requests/:id/decline",
    authenticateToken,
    validate(correctionWindowDeclineSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      if (!requireRegistrar(req, res)) return;
      try {
        const actor = actorOf(req);
        const result = await declineCorrectionWindow({
          requestId: String(req.params.id),
          actor: { id: actor.id, name: actor.name },
          reason: (req.body as { reason?: string }).reason,
        });
        if (!result.ok) {
          sendError(res, result);
          return;
        }
        await createAuditLog(
          AuditAction.UPDATE,
          actor.audit,
          `Correction window declined: ${result.data.teacherName} — ${result.data.term}`,
          "Grade Edit Request",
          result.data.declineReason
            ? `Declined by registrar: ${result.data.declineReason}`
            : "Declined by registrar",
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.INFO,
          result.data.id,
        );
        res.json({ message: "Correction request declined", request: result.data });
      } catch (err: any) {
        logger.error("[registrar/edit-requests/decline]", err.message);
        res.status(500).json({ message: "Failed to decline correction request" });
      }
    },
  );

  // POST /registrar/edit-requests/:id/refinalize
  router.post(
    "/edit-requests/:id/refinalize",
    authenticateToken,
    validate(correctionWindowIdSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      if (!requireRegistrar(req, res)) return;
      try {
        const actor = actorOf(req);
        const result = await refinalizeCorrectionWindow({
          requestId: String(req.params.id),
          actor: { id: actor.id, name: actor.name },
        });
        if (!result.ok) {
          sendError(res, result);
          return;
        }
        await createAuditLog(
          AuditAction.CONFIG,
          actor.audit,
          `Correction window re-finalized: ${result.data.teacherName} — ${result.data.section ?? "Section"} ${result.data.subject ?? ""} (${result.data.term})`,
          "Grade Edit Request",
          `Re-finalized ${result.data.unfinalizedGradeCount} grade(s) after the correction window.`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.WARNING,
          result.data.id,
        );
        res.json({ message: "Grades re-finalized", request: result.data });
      } catch (err: any) {
        logger.error("[registrar/edit-requests/refinalize]", err.message);
        res.status(500).json({ message: "Failed to re-finalize correction window" });
      }
    },
  );
}
