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

      let termLabels = { T1: "Term 1", T2: "Term 2", T3: "Term 3" };
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

      let termLabels = { T1: "Term 1", T2: "Term 2", T3: "Term 3" };
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
      // Adjusted Transmutation Table (DepEd Order No. 015, s. 2026) — SY 2026-2027.
      const defaultEntries = [
        { minGrade: 0.00, maxGrade: 4.67, transmutedGrade: 60 },
        { minGrade: 4.68, maxGrade: 9.34, transmutedGrade: 61 },
        { minGrade: 9.35, maxGrade: 14.00, transmutedGrade: 62 },
        { minGrade: 14.01, maxGrade: 18.67, transmutedGrade: 63 },
        { minGrade: 18.68, maxGrade: 23.34, transmutedGrade: 64 },
        { minGrade: 23.35, maxGrade: 28.00, transmutedGrade: 65 },
        { minGrade: 28.01, maxGrade: 32.67, transmutedGrade: 66 },
        { minGrade: 32.68, maxGrade: 37.33, transmutedGrade: 67 },
        { minGrade: 37.34, maxGrade: 42.00, transmutedGrade: 68 },
        { minGrade: 42.01, maxGrade: 46.66, transmutedGrade: 69 },
        { minGrade: 46.67, maxGrade: 51.33, transmutedGrade: 70 },
        { minGrade: 51.34, maxGrade: 56.00, transmutedGrade: 71 },
        { minGrade: 56.01, maxGrade: 60.66, transmutedGrade: 72 },
        { minGrade: 60.67, maxGrade: 65.33, transmutedGrade: 73 },
        { minGrade: 65.34, maxGrade: 69.99, transmutedGrade: 74 },
        { minGrade: 70.00, maxGrade: 71.17, transmutedGrade: 75 },
        { minGrade: 71.18, maxGrade: 72.35, transmutedGrade: 76 },
        { minGrade: 72.36, maxGrade: 73.53, transmutedGrade: 77 },
        { minGrade: 73.54, maxGrade: 74.71, transmutedGrade: 78 },
        { minGrade: 74.72, maxGrade: 75.89, transmutedGrade: 79 },
        { minGrade: 75.90, maxGrade: 77.07, transmutedGrade: 80 },
        { minGrade: 77.08, maxGrade: 78.25, transmutedGrade: 81 },
        { minGrade: 78.26, maxGrade: 79.43, transmutedGrade: 82 },
        { minGrade: 79.44, maxGrade: 80.61, transmutedGrade: 83 },
        { minGrade: 80.62, maxGrade: 81.79, transmutedGrade: 84 },
        { minGrade: 81.80, maxGrade: 82.97, transmutedGrade: 85 },
        { minGrade: 82.98, maxGrade: 84.15, transmutedGrade: 86 },
        { minGrade: 84.16, maxGrade: 85.33, transmutedGrade: 87 },
        { minGrade: 85.34, maxGrade: 86.51, transmutedGrade: 88 },
        { minGrade: 86.52, maxGrade: 87.69, transmutedGrade: 89 },
        { minGrade: 87.70, maxGrade: 88.87, transmutedGrade: 90 },
        { minGrade: 88.88, maxGrade: 90.05, transmutedGrade: 91 },
        { minGrade: 90.06, maxGrade: 91.23, transmutedGrade: 92 },
        { minGrade: 91.24, maxGrade: 92.41, transmutedGrade: 93 },
        { minGrade: 92.42, maxGrade: 93.59, transmutedGrade: 94 },
        { minGrade: 93.60, maxGrade: 94.77, transmutedGrade: 95 },
        { minGrade: 94.78, maxGrade: 95.95, transmutedGrade: 96 },
        { minGrade: 95.96, maxGrade: 97.13, transmutedGrade: 97 },
        { minGrade: 97.14, maxGrade: 98.31, transmutedGrade: 98 },
        { minGrade: 98.32, maxGrade: 99.49, transmutedGrade: 99 },
        { minGrade: 99.50, maxGrade: 100.00, transmutedGrade: 100 },
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
