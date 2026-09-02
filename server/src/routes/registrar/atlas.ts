import { Router, Request, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { getAtlasEffectiveTeachingLoad, getAtlasSubjectStats } from "../../lib/atlasSync";
import { resolveAtlasSchoolYear, DEFAULT_ATLAS_SCHOOL_YEAR_ID } from "../../lib/sync/httpClient";

export default function registerAtlasRoutes(router: Router): void {

  // GET /registrar/atlas/teaching-loads
  // Returns effective annual teaching load from ATLAS (contract-compliant endpoint)
  router.get("/atlas/teaching-loads", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const atlasSchoolYearId = req.query.atlasSchoolYearId
        ? Number(req.query.atlasSchoolYearId)
        : undefined;

      const syId = atlasSchoolYearId ?? (await resolveAtlasSchoolYear()).id;
      const data = await getAtlasEffectiveTeachingLoad(syId);
      res.json(data ?? { source: { state: 'EMPTY' }, assignments: [], coverageTotals: {} });
    } catch (err: any) {
      console.error("[RegistrarAtlas] Teaching loads fetch failed:", err.message);
      res.status(500).json({ error: "Failed to fetch teaching loads from ATLAS" });
    }
  });

  // GET /registrar/atlas/subject-coverage
  // Returns subject coverage stats from ATLAS
  router.get("/atlas/subject-coverage", authenticateToken, async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = await getAtlasSubjectStats();
      res.json(data ?? {});
    } catch (err: any) {
      console.error("[RegistrarAtlas] Subject coverage fetch failed:", err.message);
      res.status(500).json({ error: "Failed to fetch subject coverage from ATLAS" });
    }
  });
}
