import { Router, Request, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { eosyFinalizeSchema } from "../../schemas/registrar";
import { createAuditLog } from "../../lib/audit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import {
  computeSectionPromotions,
  finalizeSectionEosy,
  unfinalizeSectionEosy,
  listUnfinalizedSections,
} from "../../lib/promotion";
import {
  resolveEnrollProSchoolYear,
  getEnrollProEosySF5,
  getEnrollProEosySF6,
} from "../../lib/enrollproClient";
import {
  getEosySchoolYearsResilient,
  getEosySectionsResilient,
  getEosySectionRecordsResilient,
} from "../../lib/syncCache";
import { logger } from "../../lib/logger";
import { withSectionLock } from "../../lib/sectionLock";
import { prisma } from "../../lib/prisma";

export default function registerEosyRoutes(router: Router): void {

// GET /registrar/eosy/school-years — list school years (SWR cache + SMART DB fallback)
router.get("/eosy/school-years", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const { years, stale, ageMs, source } = await getEosySchoolYearsResilient();
    res.json({ schoolYears: years, stale, ageMs, source });
  } catch (err: any) {
    logger.error("[registrar/eosy/school-years]", err.message);
    res.status(502).json({ message: "Failed to fetch school years from EnrollPro" });
  }
});

// GET /registrar/eosy/sections — sections available for EOSY (SWR cache + SMART DB fallback)
router.get("/eosy/sections", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  let schoolYearId = parseInt(String(req.query.schoolYearId), 10);
  try {
    if (isNaN(schoolYearId)) {
      const sy = await resolveEnrollProSchoolYear();
      schoolYearId = sy.id;
    }
    const force = String(req.query.force) === "1";
    const { payload, stale, ageMs } = await getEosySectionsResilient(schoolYearId, force);
    const sections = Array.isArray(payload) ? payload : (payload?.sections ?? payload?.data ?? []);
    res.json({ sections, stale, ageMs, source: "enrollpro" });
  } catch (err: any) {
    logger.warn("[registrar/eosy/sections] EnrollPro unavailable, trying SMART DB fallback", err.message);
    try {
      if (!isNaN(schoolYearId)) {
        const sy = await prisma.schoolYear.findFirst({ where: { externalId: schoolYearId }, select: { label: true } });
        if (sy) {
          const rows = await prisma.section.findMany({
            where: { schoolYear: sy.label },
            orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
            select: { id: true, name: true, gradeLevel: true },
          });
          if (rows.length > 0) {
            const sections = rows.map((s) => ({
              id: s.id,
              name: s.name,
              gradeLevel: { name: s.gradeLevel.replace("GRADE_", "Grade ") },
            }));
            res.json({ sections, stale: true, ageMs: 0, source: "db" });
            return;
          }
        }
      }
    } catch (dbErr: any) {
      logger.error("[registrar/eosy/sections] SMART DB fallback failed", dbErr.message);
    }
    res.status(502).json({ message: "Failed to fetch EOSY sections from EnrollPro" });
  }
});

// GET /registrar/eosy/sections/:sectionId/records — final grades for a section (SWR cache)
router.get("/eosy/sections/:sectionId/records", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied." }); return; }
  try {
    const sectionId = parseInt(String(req.params.sectionId), 10);
    if (isNaN(sectionId)) { res.status(400).json({ message: "Invalid section ID" }); return; }
    const force = String(req.query.force) === "1";
    const { payload, stale, ageMs } = await getEosySectionRecordsResilient(sectionId, force);
    if (Array.isArray(payload)) {
      res.json({ records: payload, stale, ageMs });
    } else {
      res.json({ ...(payload ?? {}), stale, ageMs });
    }
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
      `EOSY finalize for section ${sectionId} SY ${schoolYear}: ${result.processed} enrollments, ${result.snapshotsCreated} snapshots created, ${result.remedialRowsCleared} orphaned remedial row(s) cleared`,
      req.ip,
      AuditSeverity.WARNING
    );

    res.json({
      message: `EOSY finalize complete: ${result.processed} enrollment(s) processed`,
      sectionId,
      schoolYear,
      processed: result.processed,
      snapshotsCreated: result.snapshotsCreated,
      remedialRowsCleared: result.remedialRowsCleared,
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

// POST /registrar/eosy/unfinalize — undo EOSY finalization for a section
router.post("/eosy/unfinalize", authenticateToken, validate(eosyFinalizeSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") { res.status(403).json({ message: "Access denied. Registrar only." }); return; }
  try {
    const { sectionId, schoolYear } = req.body;

    const result = await withSectionLock(`eosy:${sectionId}:${schoolYear}`, () =>
      unfinalizeSectionEosy({
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
      if (result.error === "NOT_FINALIZED") {
        res.status(400).json({ message: "Section is not finalized" });
        return;
      }
      if (result.error === "HAS_COMPLETED_REMEDIAL") {
        res.status(409).json({
          message: `Unfinalize blocked: ${result.completedCount} completed remedial record(s) exist. Registrar must resolve remedial records first.`,
          completedCount: result.completedCount,
        });
        return;
      }
      res.status(400).json({ message: "Cannot unfinalize" });
      return;
    }

    res.json({
      message: `EOSY unfinalize complete: ${result.deletedSnapshots} snapshots, ${result.deletedRemedial} remedial records deleted`,
      sectionId,
      schoolYear,
      deletedSnapshots: result.deletedSnapshots,
      deletedRemedial: result.deletedRemedial,
    });
  } catch (err: any) {
    logger.error("[registrar/eosy/unfinalize]", err.message);
    res.status(500).json({ message: "Failed to unfinalize EOSY" });
  }
});

} // end registerEosyRoutes
