import { Router, Response } from "express";
import { SubjectType, AuditAction, AuditSeverity } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { getTransmutationTable, invalidateTransmutationCache } from "../../lib/transmutationCache";
import { validateTransmutationEntries, validateTransmutationRowChange } from "../../lib/transmutationValidation";
import { getActiveTermLabels } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { validate } from "../../middleware/validate";
import { gradingConfigSchema } from "../../schemas/admin";
import { requireAdmin } from "./helpers";

export default function (router: Router) {
  // ── Grading Config ─────────────────────────────────────────────────────

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

      let termLabels = { T1: "Quarterly 1", T2: "Quarterly 2", T3: "Quarterly 3" };
      try {
        termLabels = await getActiveTermLabels();
      } catch (e: any) {
        logger.warn("[GradingConfig] Failed to resolve term labels, using defaults.", e.message);
      }

      res.json({ configs, termLabels });
    } catch (error) {
      logger.error("Error fetching grading configs:", error);
      res.status(500).json({ message: "Failed to fetch grading configurations" });
    }
  });

  router.put("/grading-config/:subjectType", authenticateToken, requireAdmin, validate(gradingConfigSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { subjectType } = req.params;
      const { writtenWorkWeight, performanceTaskWeight, quarterlyAssessWeight } = req.body;

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

  router.post("/grading-config/reset", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
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

      let termLabels = { T1: "Quarterly 1", T2: "Quarterly 2", T3: "Quarterly 3" };
      try {
        termLabels = await getActiveTermLabels();
      } catch (e: any) {
        logger.warn("[GradingConfig] Failed to resolve term labels, using defaults.", e.message);
      }

      res.json({ message: "Grading configurations reset to defaults", configs, termLabels });
    } catch (error) {
      logger.error("Error resetting grading configs:", error);
      res.status(500).json({ message: "Failed to reset grading configurations" });
    }
  });

  // ── Transmutation Table CRUD ─────────────────────────────────────────────

  router.get("/transmutation-table", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const table = await getTransmutationTable();
      res.json(table);
    } catch (err: any) {
      logger.error("Error fetching transmutation table:", err);
      res.status(500).json({ message: "Failed to fetch transmutation table" });
    }
  });

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

  // ── Per-Subject Weight Overrides ─────────────────────────────────────────

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
}
