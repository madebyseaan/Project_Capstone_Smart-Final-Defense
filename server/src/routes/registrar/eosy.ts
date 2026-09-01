import { Router, Request, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { eosyFinalizeSchema } from "../../schemas/registrar";
import { createAuditLog } from "../../lib/audit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import {
  computeSectionPromotions,
  finalizeSectionEosy,
  listUnfinalizedSections,
} from "../../lib/promotion";
import {
  resolveEnrollProSchoolYear,
  getEnrollProEosySections,
  getEnrollProEosySectionRecords,
  getEnrollProEosySF5,
  getEnrollProEosySF6,
} from "../../lib/enrollproClient";
import { logger } from "../../lib/logger";
import { withSectionLock } from "../../lib/sectionLock";

export default function registerEosyRoutes(router: Router): void {

// GET /registrar/eosy/school-years — list school years from EnrollPro
router.get("/eosy/school-years", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const { getEnrollProSchoolYears } = require("../../lib/enrollproClient");
    const data = await getEnrollProSchoolYears();
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/school-years]", err.message);
    res.status(502).json({ message: "Failed to fetch school years from EnrollPro" });
  }
});

// GET /registrar/eosy/sections — sections available for EOSY
router.get("/eosy/sections", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    let schoolYearId = parseInt(String(req.query.schoolYearId), 10);
    if (isNaN(schoolYearId)) {
      const sy = await resolveEnrollProSchoolYear();
      schoolYearId = sy.id;
    }
    const data = await getEnrollProEosySections(schoolYearId);
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/sections]", err.message);
    res.status(502).json({ message: "Failed to fetch EOSY sections from EnrollPro" });
  }
});

// GET /registrar/eosy/sections/:sectionId/records — final grades for a section
router.get("/eosy/sections/:sectionId/records", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const sectionId = parseInt(String(req.params.sectionId), 10);
    if (isNaN(sectionId)) { res.status(400).json({ message: "Invalid section ID" }); return; }
    const data = await getEnrollProEosySectionRecords(sectionId);
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/records]", err.message);
    res.status(502).json({ message: "Failed to fetch EOSY records from EnrollPro" });
  }
});

// GET /registrar/eosy/sections/:sectionId/sf5 — SF5 export for a section
router.get("/eosy/sections/:sectionId/sf5", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const sectionId = parseInt(String(req.params.sectionId), 10);
    if (isNaN(sectionId)) { res.status(400).json({ message: "Invalid section ID" }); return; }
    const data = await getEnrollProEosySF5(sectionId);
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/sf5]", err.message);
    res.status(502).json({ message: "Failed to fetch SF5 from EnrollPro" });
  }
});

// GET /registrar/eosy/sf6 — SF6 school-wide EOSY summary
router.get("/eosy/sf6", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    let schoolYearId = parseInt(String(req.query.schoolYearId), 10);
    if (isNaN(schoolYearId)) {
      const sy = await resolveEnrollProSchoolYear();
      schoolYearId = sy.id;
    }
    const data = await getEnrollProEosySF6(schoolYearId);
    res.json(data);
  } catch (err: any) {
    logger.error("[registrar/eosy/sf6]", err.message);
    res.status(502).json({ message: "Failed to fetch SF6 from EnrollPro" });
  }
});

// POST /registrar/eosy/finalize — snapshot-first EOSY finalize (SMART DB)
// Creates/refreshes immutable EOSY GradeSnapshots THEN persists promotionStatus, one transaction, idempotent.
// Rejects when any grade for the section/year is still DRAFT.
router.post("/eosy/finalize", authenticateToken, validate(eosyFinalizeSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied. Registrar only." }); return; }
  try {
    const { sectionId, schoolYear } = req.body;

    const result = await withSectionLock(`eosy:${sectionId}:${schoolYear}`, () =>
      finalizeSectionEosy({
        sectionId,
        schoolYear,
        actor: { id: user.id, name: user.username, role: user.role },
      }),
    );

    if (result.ok === false) {
      if (result.error === "SECTION_NOT_FOUND") {
        res.status(404).json({ message: `Section not found for school year ${schoolYear}` });
        return;
      }
      res.status(400).json({
        message: `Cannot finalize EOSY: ${result.blockers.length} DRAFT grade(s) must be finalized first.`,
        blockers: result.blockers,
      });
      return;
    }

    await createAuditLog(
      AuditAction.UPDATE,
      user,
      `EOSY Finalize: ${sectionId} (${schoolYear})`,
      "EOSY",
      `EOSY finalize for section ${sectionId} SY ${schoolYear}: ${result.processed} enrollments, ${result.snapshotsCreated} snapshots created`,
      req.ip,
      AuditSeverity.WARNING
    );

    res.json({
      message: `EOSY finalize complete: ${result.processed} enrollment(s) processed`,
      sectionId,
      schoolYear,
      processed: result.processed,
      snapshotsCreated: result.snapshotsCreated,
    });
  } catch (err: any) {
    logger.error("[registrar/eosy/finalize]", err.message);
    res.status(500).json({ message: "Failed to finalize EOSY" });
  }
});

// GET /registrar/eosy/promotion-status/:sectionId?schoolYear= — computed + stored promotion per enrollment, with DRAFT blockers
router.get("/eosy/promotion-status/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied. Registrar only." }); return; }
  try {
    const sectionId = req.params.sectionId as string;
    const schoolYear = (req.query.schoolYear as string) || "";

    if (!schoolYear) {
      res.status(400).json({ message: "schoolYear query parameter is required" });
      return;
    }

    const promotions = await computeSectionPromotions(sectionId, schoolYear);
    if (!promotions) {
      res.status(404).json({ message: `Section not found for school year ${schoolYear}` });
      return;
    }

    res.json(promotions);
  } catch (err: any) {
    logger.error("[registrar/eosy/promotion-status]", err.message);
    res.status(500).json({ message: "Failed to compute promotion status" });
  }
});

// GET /registrar/eosy/unfinalized-sections?schoolYear= — sections not yet EOSY-finalized (T4 rollover guardrail input)
router.get("/eosy/unfinalized-sections", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied. Registrar only." }); return; }
  try {
    const schoolYear = (req.query.schoolYear as string) || "";
    if (!schoolYear) {
      res.status(400).json({ message: "schoolYear query parameter is required" });
      return;
    }
    const sections = await listUnfinalizedSections(schoolYear);
    res.json({ schoolYear, unfinalizedCount: sections.length, sections });
  } catch (err: any) {
    logger.error("[registrar/eosy/unfinalized-sections]", err.message);
    res.status(500).json({ message: "Failed to list unfinalized sections" });
  }
});

} // end registerEosyRoutes
