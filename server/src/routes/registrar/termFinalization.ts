/**
 * termFinalization.ts — Registrar term-end grade finalization.
 *
 * This is the dedicated home for DRAFT -> FINALIZED per section + term.
 * EOSY finalization stays in registrar/eosy.ts and is never triggered here.
 */

import { Router, Response } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { withSectionLock } from "../../lib/sectionLock";
import {
  termFinalizationQuerySchema,
  termFinalizeSchema,
} from "../../schemas/registrar";
import {
  buildTermFinalizationOverview,
  finalizeSectionTerm,
  unfinalizeSectionTerm,
  TERMS,
  type TermFinalizationActionResult,
  type TermName,
} from "../../lib/termFinalization";

function asTermName(value: unknown, fallback: TermName): TermName {
  if (typeof value === "string" && (TERMS as readonly string[]).includes(value)) {
    return value as TermName;
  }
  return fallback;
}

function sendActionError(res: Response, result: Extract<TermFinalizationActionResult, { ok: false }>): void {
  switch (result.error) {
    case "SECTION_NOT_FOUND":
      res.status(404).json({ message: "Section not found for this school year", code: result.error });
      return;
    case "YEAR_ARCHIVED":
      res.status(409).json({ message: "This school year is archived and cannot be changed", code: result.error });
      return;
    case "SECTION_ARCHIVED":
      res.status(409).json({ message: "This section is archived/completed and cannot be changed", code: result.error });
      return;
    case "NO_ASSIGNMENTS":
      res.status(404).json({ message: "No class assignments found for this section and school year", code: result.error });
      return;
    case "EOSY_FINALIZED":
      res.status(409).json({
        message: "EOSY promotion is already finalized for this section. Unfinalize EOSY first.",
        code: result.error,
      });
      return;
    default:
      res.status(400).json({ message: "Unable to complete term finalization" });
  }
}

export default function registerTermFinalizationRoutes(router: Router): void {
  // GET /registrar/term-finalization?schoolYear=&term=
  // Term-first overview: every section in the year with per-subject status.
  router.get(
    "/term-finalization",
    authenticateToken,
    validate(termFinalizationQuerySchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const user = req.user;
        if (!user || user.role !== "REGISTRAR") {
          res.status(403).json({ message: "Access denied. Registrar only." });
          return;
        }

        const query = req.query as { schoolYear?: string; term?: string };
        const settings = await prisma.systemSettings.findUnique({
          where: { id: "main" },
          select: { currentTerm: true, currentSchoolYear: true },
        });
        const schoolYear = query.schoolYear || (await getActiveSchoolYearLabel());
        const term = asTermName(query.term ?? settings?.currentTerm, "T1");

        const overview = await buildTermFinalizationOverview(schoolYear, term);
        if (!overview) {
          res.status(404).json({ message: `School year ${schoolYear} was not found` });
          return;
        }

        res.json(overview);
      } catch (error) {
        logger.error("Error loading term finalization overview:", error);
        res.status(500).json({ message: "Failed to load term finalization overview" });
      }
    },
  );

  // POST /registrar/term-finalization/finalize
  // Flips DRAFT -> FINALIZED for one section + term (all subjects or subjectIds).
  router.post(
    "/term-finalization/finalize",
    authenticateToken,
    validate(termFinalizeSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const user = req.user;
        if (!user || user.role !== "REGISTRAR") {
          res.status(403).json({ message: "Access denied. Registrar only." });
          return;
        }

        const { sectionId, term, schoolYear, subjectIds } = req.body as {
          sectionId: string;
          term: TermName;
          schoolYear: string;
          subjectIds?: string[];
        };

        const result = await withSectionLock(
          `term-finalization:${sectionId}:${term}`,
          () =>
            finalizeSectionTerm({
              sectionId,
              term,
              schoolYear,
              subjectIds,
              actorId: user.id,
            }),
        );

        if (result.ok === false) {
          sendActionError(res, result);
          return;
        }

        await createAuditLog(
          AuditAction.UPDATE,
          { id: user.id, firstName: user.username, lastName: "", role: user.role },
          `Term finalize: ${result.sectionName} ${term} (${schoolYear})`,
          "Grade",
          `${user.username} finalized ${result.finalizedCount} grade(s) across ${result.subjectCount} subject(s) for section ${result.sectionName}, ${term} (SY ${schoolYear}). ${result.remainingTermDrafts} draft grade(s) remain in this term.`,
          req.ip,
          AuditSeverity.WARNING,
        );

        res.json({
          message:
            result.finalizedCount > 0
              ? `Finalized ${result.finalizedCount} grade(s) for ${result.sectionName} (${term}).`
              : `No draft grades to finalize for ${result.sectionName} (${term}).`,
          ...result,
        });
      } catch (error) {
        logger.error("Error finalizing term grades:", error);
        res.status(500).json({ message: "Failed to finalize term grades" });
      }
    },
  );

  // POST /registrar/term-finalization/unfinalize
  // Reverts FINALIZED -> DRAFT for one section + term. Blocked once EOSY has
  // promotion data so term rows can never drift out from under EOSY snapshots.
  router.post(
    "/term-finalization/unfinalize",
    authenticateToken,
    validate(termFinalizeSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const user = req.user;
        if (!user || user.role !== "REGISTRAR") {
          res.status(403).json({ message: "Access denied. Registrar only." });
          return;
        }

        const { sectionId, term, schoolYear, subjectIds } = req.body as {
          sectionId: string;
          term: TermName;
          schoolYear: string;
          subjectIds?: string[];
        };

        const result = await withSectionLock(
          `term-finalization:${sectionId}:${term}`,
          () =>
            unfinalizeSectionTerm({
              sectionId,
              term,
              schoolYear,
              subjectIds,
            }),
        );

        if (result.ok === false) {
          sendActionError(res, result);
          return;
        }

        await createAuditLog(
          AuditAction.UPDATE,
          { id: user.id, firstName: user.username, lastName: "", role: user.role },
          `Term unfinalize: ${result.sectionName} ${term} (${schoolYear})`,
          "Grade",
          `${user.username} unfinalized ${result.unfinalizedCount} grade(s) across ${result.subjectCount} subject(s) for section ${result.sectionName}, ${term} (SY ${schoolYear}).`,
          req.ip,
          AuditSeverity.WARNING,
        );

        const locksStillActive = result.termLocked || result.yearLocked;

        res.json({
          message:
            result.unfinalizedCount > 0
              ? `Unfinalized ${result.unfinalizedCount} grade(s) for ${result.sectionName} (${term}).`
              : `No finalized grades to unfinalize for ${result.sectionName} (${term}).`,
          warning: locksStillActive
            ? "Grades were unfinalized, but the term/year lock is still active. Teachers still need an approved edit request or an admin unlock."
            : undefined,
          ...result,
        });
      } catch (error) {
        logger.error("Error unfinalizing term grades:", error);
        res.status(500).json({ message: "Failed to unfinalize term grades" });
      }
    },
  );
}
