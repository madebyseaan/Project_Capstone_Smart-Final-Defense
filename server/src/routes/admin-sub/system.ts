import { Router, Request, Response } from "express";
import { AuditAction, AuditSeverity, Term } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import path from "path";
import fs from "fs";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { addSettingsSseClient, removeSettingsSseClient, broadcastSettingsUpdate } from "../../lib/sseManager";
import { syncEnrollProBranding } from "../../lib/enrollproBrandingSync";
import { getRecentSyncHistory, runUnifiedSync } from "../../lib/syncCoordinator";
import { getSystemHealthSnapshot } from "../../lib/systemHealth";
import { getActiveTermLabels, invalidateSchoolYearCache } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { validate } from "../../middleware/validate";
import { setYearLock, setTermLock } from "../../lib/gradeLocks";
import { listUnfinalizedSections } from "../../lib/promotion";
import { archiveSchoolYear, handleYearChangeRollover } from "../../lib/rollover";
import {
  settingsUpdateSchema,
  colorSettingsSchema,
  gradeLockSchema,
  transitionLockSchema,
  yearLockToggleSchema,
  termLockToggleSchema,
} from "../../schemas/admin";
import { requireAdmin, upload } from "./helpers";

export default function (router: Router) {
  // ── System Health & Sync Diagnostics ─────────────────────────────────────

  router.get("/system/health", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const health = await getSystemHealthSnapshot();
      res.json(health);
    } catch (error) {
      logger.error("Error fetching system health:", error);
      res.status(500).json({ message: "Failed to fetch system health" });
    }
  });

  router.get("/system/sync-history", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const requestedLimit = Number(req.query.limit ?? 25);
      const limit = Number.isFinite(requestedLimit) ? requestedLimit : 25;
      const history = await getRecentSyncHistory(limit);
      res.json({ history, count: history.length });
    } catch (error) {
      logger.error("Error fetching sync history:", error);
      res.status(500).json({ message: "Failed to fetch sync history" });
    }
  });

  router.post("/system/sync/run", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await runUnifiedSync({ source: 'admin-system-health', forceBranding: false });
      res.json({ message: "Unified sync complete", result });
    } catch (error: any) {
      logger.error("Error running unified sync:", error);
      res.status(500).json({ message: "Failed to run unified sync" });
    }
  });

  // ── System Settings ──────────────────────────────────────────────────────

  router.get("/settings", async (req: Request, res: Response): Promise<void> => {
    try {
      let settings = await prisma.systemSettings.findUnique({
        where: { id: "main" },
      });

      if (!settings) {
        settings = await prisma.systemSettings.create({
          data: { id: "main" },
        });
      }

      let termLabels = { T1: "Quarterly 1", T2: "Quarterly 2", T3: "Quarterly 3" };
      try {
        termLabels = await getActiveTermLabels();
      } catch {
        // Non-fatal: use defaults if school year not linked yet
      }

      res.json({ settings, termLabels });
    } catch (error) {
      logger.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  router.put("/settings", authenticateToken, requireAdmin, validate(settingsUpdateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const {
        schoolName,
        schoolId,
        division,
        region,
        address,
        contactNumber,
        email,
        currentSchoolYear,
        schoolYearId,
        currentTerm,
        primaryColor,
        secondaryColor,
        accentColor,
        sessionTimeout,
        maxLoginAttempts,
        passwordMinLength,
        requireSpecialChar,
        t1StartDate,
        t1EndDate,
        t2StartDate,
        t2EndDate,
        t3StartDate,
        t3EndDate,
        autoAdvanceTerm,
        auditLogRetentionDays,
        syncHistoryRetentionDays,
        gradeSnapshotRetentionDays,
      } = req.body;

      const settings = await prisma.systemSettings.upsert({
        where: { id: "main" },
        update: {
          schoolName,
          schoolId,
          division,
          region,
          address,
          contactNumber,
          email,
          currentSchoolYear,
          schoolYearId: schoolYearId || null,
          currentTerm: currentTerm as Term,
          primaryColor,
          secondaryColor,
          accentColor,
          sessionTimeout,
          maxLoginAttempts,
          passwordMinLength,
          requireSpecialChar,
          t1StartDate: t1StartDate ? new Date(t1StartDate) : undefined,
          t1EndDate: t1EndDate ? new Date(t1EndDate) : undefined,
          t2StartDate: t2StartDate ? new Date(t2StartDate) : undefined,
          t2EndDate: t2EndDate ? new Date(t2EndDate) : undefined,
          t3StartDate: t3StartDate ? new Date(t3StartDate) : undefined,
          t3EndDate: t3EndDate ? new Date(t3EndDate) : undefined,
          autoAdvanceTerm,
          auditLogRetentionDays,
          syncHistoryRetentionDays,
          gradeSnapshotRetentionDays,
        },
        create: {
          id: "main",
          schoolName,
          schoolId,
          division,
          region,
          address,
          contactNumber,
          email,
          currentSchoolYear,
          schoolYearId: schoolYearId || null,
          currentTerm: currentTerm as Term,
          primaryColor,
          secondaryColor,
          accentColor,
          sessionTimeout,
          maxLoginAttempts,
          passwordMinLength,
          requireSpecialChar,
          t1StartDate: t1StartDate ? new Date(t1StartDate) : undefined,
          t1EndDate: t1EndDate ? new Date(t1EndDate) : undefined,
          t2StartDate: t2StartDate ? new Date(t2StartDate) : undefined,
          t2EndDate: t2EndDate ? new Date(t2EndDate) : undefined,
          t3StartDate: t3StartDate ? new Date(t3StartDate) : undefined,
          t3EndDate: t3EndDate ? new Date(t3EndDate) : undefined,
          autoAdvanceTerm,
          auditLogRetentionDays,
          syncHistoryRetentionDays,
          gradeSnapshotRetentionDays,
        },
      });

      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        "System Settings",
        "Config",
        "Updated system settings",
        req.ip,
        AuditSeverity.CRITICAL
      );

      broadcastSettingsUpdate(settings);

      res.json({ message: "Settings updated successfully", settings });
    } catch (error) {
      logger.error("Error updating settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  router.post(
    "/settings/logo",
    authenticateToken,
    requireAdmin,
    upload.single("logo"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        if (!req.file) {
          res.status(400).json({ message: "No file uploaded" });
          return;
        }

        const logoUrl = `/uploads/${req.file.filename}`;

        const currentSettings = await prisma.systemSettings.findUnique({
          where: { id: "main" }
        });

        if (currentSettings?.logoUrl) {
          const oldLogoPath = path.join(__dirname, "../../", currentSettings.logoUrl);
          if (fs.existsSync(oldLogoPath)) {
            try {
              fs.unlinkSync(oldLogoPath);
            } catch (error) {
              logger.warn("Failed to delete old logo file:", error);
            }
          }
        }

        const settings = await prisma.systemSettings.update({
          where: { id: "main" },
          data: { logoUrl },
        });

        await createAuditLog(
          AuditAction.UPDATE,
          req.user!,
          "School Logo",
          "Config",
          "Uploaded new school logo",
          req.ip,
          AuditSeverity.INFO
        );

        broadcastSettingsUpdate(settings);

        res.json({ message: "Logo uploaded successfully", logoUrl });
      } catch (error) {
        logger.error("Error uploading logo:", error);
        res.status(500).json({ message: "Failed to upload logo" });
      }
    }
  );

  router.put("/settings/colors", authenticateToken, requireAdmin, validate(colorSettingsSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { primaryColor, secondaryColor, accentColor } = req.body;

      const settings = await prisma.systemSettings.update({
        where: { id: "main" },
        data: {
          primaryColor,
          secondaryColor,
          accentColor,
        },
      });

      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        "Color Scheme",
        "Config",
        `Updated color scheme: Primary ${primaryColor}, Secondary ${secondaryColor}, Accent ${accentColor}`,
        req.ip,
        AuditSeverity.INFO
      );

      broadcastSettingsUpdate(settings);

      res.json({
        message: "Color scheme updated successfully",
        colors: {
          primaryColor: settings.primaryColor,
          secondaryColor: settings.secondaryColor,
          accentColor: settings.accentColor,
        },
      });
    } catch (error) {
      logger.error("Error updating color scheme:", error);
      res.status(500).json({ message: "Failed to update color scheme" });
    }
  });

  router.post("/settings/grade-lock", authenticateToken, requireAdmin, validate(gradeLockSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { locked } = req.body;
      const settings = await prisma.systemSettings.update({
        where: { id: "main" },
        data: { gradeLock: Boolean(locked) },
      });
      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        "Grade Lock",
        "Config",
        `Grade editing ${locked ? 'LOCKED' : 'UNLOCKED'} by admin`,
        req.ip,
        AuditSeverity.WARNING
      );
      broadcastSettingsUpdate(settings);
      res.json({ message: `Grade editing ${locked ? 'locked' : 'unlocked'}`, gradeLock: settings.gradeLock });
    } catch (error) {
      logger.error("Error toggling grade lock:", error);
      res.status(500).json({ message: "Failed to toggle grade lock" });
    }
  });

  router.post("/settings/transition-lock", authenticateToken, requireAdmin, validate(transitionLockSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { locked, note } = req.body as { locked: boolean; note?: string };
      const settings = await prisma.systemSettings.update({
        where: { id: "main" },
        data: { transitionLock: Boolean(locked), transitionNote: locked ? (note || null) : null },
      });
      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        "Transition Lock",
        "Config",
        `Teacher login ${locked ? 'LOCKED' : 'UNLOCKED'} by admin${note ? `: ${note}` : ''}`,
        req.ip as string | undefined,
        AuditSeverity.WARNING
      );
      broadcastSettingsUpdate(settings);
      res.json({ message: `Teacher login ${locked ? 'locked' : 'unlocked'}`, transitionLock: settings.transitionLock });
    } catch (error) {
      logger.error("Error toggling transition lock:", error);
      res.status(500).json({ message: "Failed to toggle transition lock" });
    }
  });

  router.get("/rollover-status", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const settings = await prisma.systemSettings.findUnique({
        where: { id: "main" },
        include: { schoolYear: true },
      });
      const currentSY = settings?.schoolYear;
      const years = await prisma.schoolYear.findMany({ orderBy: { label: "desc" } });
      const previousYear = years.find((y) => y.id !== currentSY?.id && y.status !== "ARCHIVED");
      const pendingYearsCount = years.filter((y) => y.id !== currentSY?.id && y.status !== "ARCHIVED").length;

      let unfinalized: any[] = [];
      if (previousYear) {
        unfinalized = await listUnfinalizedSections(previousYear.label);
      }

      res.json({
        currentSY: currentSY ? { id: currentSY.id, label: currentSY.label, status: currentSY.status } : null,
        previousYear: previousYear ? { id: previousYear.id, label: previousYear.label, status: previousYear.status } : null,
        unfinalizedCount: unfinalized.length,
        unfinalizedSections: unfinalized.map((s) => ({ sectionId: s.sectionId, sectionName: s.sectionName, gradeLevel: s.gradeLevel, draftBlockerCount: s.draftBlockerCount })),
        canArchive: unfinalized.length === 0 && !!previousYear,
        pendingYearsCount: pendingYearsCount > 1 ? pendingYearsCount : undefined,
      });
    } catch (error) {
      logger.error("Error fetching rollover status:", error);
      res.status(500).json({ message: "Failed to fetch rollover status" });
    }
  });

  router.post("/archive-year", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { schoolYearId } = req.body as { schoolYearId?: string };
      const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      const targetId = schoolYearId || settings?.schoolYearId;
      if (!targetId) {
        res.status(400).json({ message: "No school year to archive" });
        return;
      }
      const year = await prisma.schoolYear.findUnique({ where: { id: targetId } });
      if (!year) {
        res.status(404).json({ message: "School year not found" });
        return;
      }
      if (year.status === "ARCHIVED") {
        res.status(400).json({ message: "Year is already archived" });
        return;
      }
      const unfinalized = await listUnfinalizedSections(year.label);
      if (unfinalized.length > 0) {
        res.status(400).json({
          message: `Cannot archive: ${unfinalized.length} section(s) still unfinalized`,
          unfinalizedSections: unfinalized.map((s) => ({ sectionId: s.sectionId, sectionName: s.sectionName, draftBlockerCount: s.draftBlockerCount })),
        });
        return;
      }

      const currentSYId = settings?.schoolYearId;
      if (currentSYId === targetId) {
        res.status(400).json({ message: "Cannot archive the currently active school year" });
        return;
      }

      const result = await archiveSchoolYear({
        schoolYearId: targetId,
        yearLabel: year.label,
        actor: { id: req.user!.id, name: req.user!.username },
        reason: `Manual archive by ${req.user!.username}`,
      });

      if (!result.ok) {
        res.status(500).json({ message: result.error || "Failed to archive school year" });
        return;
      }

      res.json({ message: `School year ${year.label} archived successfully`, schoolYearId: targetId });
    } catch (error) {
      logger.error("Error archiving year:", error);
      res.status(500).json({ message: "Failed to archive school year" });
    }
  });

  router.get("/year-locks", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const years = await prisma.schoolYear.findMany({
        orderBy: { label: "desc" },
        include: { yearGradeLock: true, termGradeLocks: true },
      });

      const locks = years.map((year) => ({
        schoolYearId: year.id,
        label: year.label,
        status: year.status,
        yearLock: year.yearGradeLock
          ? {
              isLocked: year.yearGradeLock.isLocked,
              lockedBy: year.yearGradeLock.lockedBy,
              lockedAt: year.yearGradeLock.lockedAt,
              unlockedBy: year.yearGradeLock.unlockedBy,
              unlockedAt: year.yearGradeLock.unlockedAt,
            }
          : { isLocked: false, lockedBy: null, lockedAt: null, unlockedBy: null, unlockedAt: null },
        termLocks: (["T1", "T2", "T3"] as const).map((term) => {
          const row = year.termGradeLocks.find((t) => t.term === term);
          return {
            term,
            isLocked: row?.isLocked ?? false,
            lockedBy: row?.lockedBy ?? null,
            lockedAt: row?.lockedAt ?? null,
            unlockedBy: row?.unlockedBy ?? null,
            unlockedAt: row?.unlockedAt ?? null,
          };
        }),
      }));

      res.json({ locks });
    } catch (error) {
      logger.error("Error fetching year locks:", error);
      res.status(500).json({ message: "Failed to fetch year locks" });
    }
  });

  router.post("/year-locks/:schoolYearId", authenticateToken, requireAdmin, validate(yearLockToggleSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const schoolYearId = req.params.schoolYearId as string;
      const { locked } = req.body;

      const year = await prisma.schoolYear.findUnique({ where: { id: schoolYearId } });
      if (!year) {
        res.status(404).json({ message: "School year not found" });
        return;
      }

      const actor = { id: req.user!.id, name: req.user!.username };
      await setYearLock(schoolYearId, locked, actor);

      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        `Year Grade Lock: ${year.label}`,
        "Config",
        `Year grade lock for ${year.label} ${locked ? "LOCKED" : "UNLOCKED"} by admin`,
        req.ip as string | undefined,
        AuditSeverity.WARNING
      );

      res.json({ message: `Year grade lock for ${year.label} ${locked ? "locked" : "unlocked"}`, schoolYearId, locked });
    } catch (error) {
      logger.error("Error toggling year lock:", error);
      res.status(500).json({ message: "Failed to toggle year lock" });
    }
  });

  router.post("/term-locks/:schoolYearId/:term", authenticateToken, requireAdmin, validate(termLockToggleSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { schoolYearId: syId, term } = req.params as { schoolYearId: string; term: string };
      const { locked } = req.body;

      const year = await prisma.schoolYear.findUnique({ where: { id: syId } });
      if (!year) {
        res.status(404).json({ message: "School year not found" });
        return;
      }

      const actor = { id: req.user!.id, name: req.user!.username };
      await setTermLock(syId, term as Term, locked, actor);

      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        `Term Grade Lock: ${year.label} ${term}`,
        "Config",
        `Term grade lock for ${term} of ${year.label} ${locked ? "LOCKED" : "UNLOCKED"} by admin`,
        req.ip as string | undefined,
        AuditSeverity.WARNING
      );

      res.json({ message: `Term grade lock for ${term} of ${year.label} ${locked ? "locked" : "unlocked"}`, schoolYearId: syId, term, locked });
    } catch (error) {
      logger.error("Error toggling term lock:", error);
      res.status(500).json({ message: "Failed to toggle term lock" });
    }
  });

  router.post(
    "/settings/sync-enrollpro",
    authenticateToken,
    requireAdmin,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const settings = await syncEnrollProBranding(
          path.join(__dirname, "../../uploads")
        );

        await createAuditLog(
          AuditAction.CONFIG,
          req.user!,
          "System Settings",
          "Config",
          "Synced branding and school info from EnrollPro",
          req.ip,
          AuditSeverity.INFO
        );

        res.json({ message: "Successfully synced from EnrollPro", settings });
      } catch (error) {
        logger.error("Error syncing from EnrollPro:", error instanceof Error ? error.message : error);
        res.status(500).json({
          message: "Failed to sync from EnrollPro",
        });
      }
    }
  );

  // ── Term Display Labels ──────────────────────────────────────────────────

  router.get("/term-labels", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const labels = await getActiveTermLabels();
      res.json({ termLabels: labels });
    } catch (error) {
      logger.error("Error fetching term labels:", error);
      res.status(500).json({ message: "Failed to fetch term labels" });
    }
  });

  router.put("/term-labels", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { termLabelT1, termLabelT2, termLabelT3 } = req.body;

      const settings = await prisma.systemSettings.findUnique({
        where: { id: "main" },
        select: { schoolYearId: true },
      });

      if (!settings?.schoolYearId) {
        res.status(400).json({ message: "No active school year linked. Set a school year first." });
        return;
      }

      const updates: Record<string, string> = {};
      if (typeof termLabelT1 === "string" && termLabelT1.trim()) updates.termLabelT1 = termLabelT1.trim();
      if (typeof termLabelT2 === "string" && termLabelT2.trim()) updates.termLabelT2 = termLabelT2.trim();
      if (typeof termLabelT3 === "string" && termLabelT3.trim()) updates.termLabelT3 = termLabelT3.trim();

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ message: "No valid term labels provided" });
        return;
      }

      const updatedYear = await prisma.schoolYear.update({
        where: { id: settings.schoolYearId },
        data: updates,
      });

      invalidateSchoolYearCache();

      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        "Term Labels",
        "Config",
        `Updated term labels: T1="${updatedYear.termLabelT1}", T2="${updatedYear.termLabelT2}", T3="${updatedYear.termLabelT3}"`,
        req.ip as string | undefined,
        AuditSeverity.CRITICAL
      );

      res.json({
        message: "Term labels updated",
        termLabels: {
          T1: updatedYear.termLabelT1,
          T2: updatedYear.termLabelT2,
          T3: updatedYear.termLabelT3,
        },
      });
    } catch (error) {
      logger.error("Error updating term labels:", error);
      res.status(500).json({ message: "Failed to update term labels" });
    }
  });

  router.get("/settings/stream", authenticateToken, (req: AuthRequest, res: Response): void => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 30000);

    addSettingsSseClient(res);

    req.on("close", () => {
      clearInterval(heartbeat);
      removeSettingsSseClient(res);
    });
  });
}
