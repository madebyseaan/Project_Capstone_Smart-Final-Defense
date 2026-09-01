import { Router, Response } from "express";
import { AuditAction, AuditSeverity, WorkloadType } from "@prisma/client";
import { authenticateToken, authorizeRoles, AuthRequest } from "../../middleware/auth";
import path from "path";
import fs from "fs";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { getSyncStatus, runAtlasSync } from "../../lib/atlasSync";
import { getEnrollProSyncStatus, runEnrollProSync } from "../../lib/enrollproSync";
import { getActiveSchoolYearLabel, invalidateSchoolYearCache } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { validate } from "../../middleware/validate";
import {
  classAssignmentCreateSchema,
  archiveYearSchema,
} from "../../schemas/admin";
import { requireAdmin, SF_FORM_LABELS, detectSfSheetMappings } from "./helpers";

export default function (router: Router) {
  // ── ATLAS Sync ─────────────────────────────────────────────────────────

  router.get("/atlas-sync/status", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response) => {
    res.json(getSyncStatus());
  });

  router.post("/atlas-sync/run", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response) => {
    const result = await runAtlasSync();
    res.json({ message: "Sync complete", result });
  });

  // ── EnrollPro Advisory Sync ────────────────────────────────────────────

  router.get("/enrollpro-sync/status", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response) => {
    res.json(getEnrollProSyncStatus());
  });

  router.post("/enrollpro-sync/run", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response) => {
    const result = await runEnrollProSync();
    res.json({ message: "EnrollPro sync complete", result });
  });

  // ── Templates ──────────────────────────────────────────────────────────

  router.post("/templates/reindex", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const target = String(req.body?.target || "all").toLowerCase();
      const includeSf = target === "all" || target === "sf";

      const result = {
        target,
        sf: {
          filesScanned: 0,
          formsDetected: 0,
          upserted: 0,
          skippedNoMatch: 0,
        },
      };

      if (includeSf) {
        const sfDir = path.join(__dirname, "../../uploads/templates");
        if (fs.existsSync(sfDir)) {
          const sfFiles = fs
            .readdirSync(sfDir)
            .filter((f) => /\.(xlsx|xls)$/i.test(f));

          for (const fileName of sfFiles) {
            result.sf.filesScanned++;
            const filePath = path.join(sfDir, fileName);
            const stat = fs.statSync(filePath);
            const mappings = detectSfSheetMappings(filePath);

            if (mappings.length === 0) {
              result.sf.skippedNoMatch++;
              continue;
            }

            result.sf.formsDetected += mappings.length;

            for (const mapping of mappings) {
              await prisma.excelTemplate.upsert({
                where: { formType: mapping.formType as any },
                create: {
                  formType: mapping.formType as any,
                  formName: SF_FORM_LABELS[mapping.formType] || `${mapping.formType} Template`,
                  description: "Re-indexed from uploads/templates",
                  filePath,
                  fileName,
                  fileSize: Number(stat.size),
                  placeholders: [],
                  instructions: "Re-indexed automatically by admin endpoint",
                  isActive: true,
                  uploadedBy: req.user!.id,
                  uploadedByName: "Admin",
                  sheetName: mapping.sheetName,
                } as any,
                update: {
                  formName: SF_FORM_LABELS[mapping.formType] || `${mapping.formType} Template`,
                  description: "Re-indexed from uploads/templates",
                  filePath,
                  fileName,
                  fileSize: Number(stat.size),
                  placeholders: [],
                  instructions: "Re-indexed automatically by admin endpoint",
                  isActive: true,
                  uploadedBy: req.user!.id,
                  uploadedByName: "Admin",
                  sheetName: mapping.sheetName,
                  updatedAt: new Date(),
                } as any,
              });
              result.sf.upserted++;
            }
          }
        }
      }

      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        "Template Re-index",
        "Template",
        `Re-indexed templates from uploads (target=${target})`,
        req.ip,
        AuditSeverity.INFO,
        undefined,
        result as any
      );

      res.json({ message: "Template re-index completed", result });
    } catch (error: any) {
      logger.error("Error during template re-index:", error);
      res.status(500).json({ message: "Template re-index failed" });
    }
  });

  // ── Class Assignment Management ──────────────────────────────────────────

  router.get("/class-assignments/options", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const schoolYear = (req.query.schoolYear as string) || await getActiveSchoolYearLabel();
      const [teachers, subjects, sections] = await Promise.all([
        prisma.teacher.findMany({
          include: { user: { select: { firstName: true, lastName: true, email: true } } },
          orderBy: { user: { lastName: "asc" } },
        }),
        prisma.subject.findMany({ orderBy: { name: "asc" } }),
        prisma.section.findMany({
          where: { schoolYear },
          orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
        }),
      ]);
      res.json({ teachers, subjects, sections });
    } catch (err: any) {
      logger.error("Error fetching class assignment options:", err);
      res.status(500).json({ message: "Failed to fetch class assignment options" });
    }
  });

  router.get("/class-assignments", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const schoolYear = (req.query.schoolYear as string) || await getActiveSchoolYearLabel();
      const assignments = await prisma.classAssignment.findMany({
        where: { schoolYear },
        include: {
          teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
          subject: true,
          section: true,
        },
        orderBy: [{ section: { gradeLevel: "asc" } }, { section: { name: "asc" } }],
      });

      const advisoryEntries = await prisma.workloadEntry.findMany({
        where: {
          schoolYear,
          type: WorkloadType.ADVISORY_ROLE,
        },
        include: {
          teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
          section: { select: { id: true, name: true, gradeLevel: true, program: true } },
        },
      });

      type WorkloadBucket = {
        teacherId: string;
        teacherName: string;
        sectionId: string;
        sectionName: string;
        gradeLevel: string;
        hgMinutes: number;
        advisoryRoleMinutes: number;
        otherSubjectMinutes: number;
        totalMinutes: number;
      };

      const summaryMap = new Map<string, WorkloadBucket>();
      const ensureBucket = (
        teacherId: string,
        teacherName: string,
        sectionId: string,
        sectionName: string,
        gradeLevel: string,
      ) => {
        const key = `${teacherId}|${sectionId}`;
        const existing = summaryMap.get(key);
        if (existing) return existing;
        const bucket: WorkloadBucket = {
          teacherId,
          teacherName,
          sectionId,
          sectionName,
          gradeLevel,
          hgMinutes: 0,
          advisoryRoleMinutes: 0,
          otherSubjectMinutes: 0,
          totalMinutes: 0,
        };
        summaryMap.set(key, bucket);
        return bucket;
      };

      for (const assignment of assignments) {
        const teacherName = `${assignment.teacher.user.lastName}, ${assignment.teacher.user.firstName}`;
        const bucket = ensureBucket(
          assignment.teacherId,
          teacherName,
          assignment.sectionId,
          assignment.section.name,
          assignment.section.gradeLevel,
        );
        if (assignment.subject.code.startsWith('HG')) {
          bucket.hgMinutes += assignment.teachingMinutes ?? 60;
        } else {
          bucket.otherSubjectMinutes += assignment.teachingMinutes ?? 60;
        }
      }

      for (const entry of advisoryEntries) {
        if (!entry.section) continue;
        const teacherName = `${entry.teacher.user.lastName}, ${entry.teacher.user.firstName}`;
        const bucket = ensureBucket(
          entry.teacherId,
          teacherName,
          entry.section.id,
          entry.section.name,
          entry.section.gradeLevel,
        );
        bucket.advisoryRoleMinutes += entry.minutes;
      }

      const workloadSummary = [...summaryMap.values()]
        .map((item) => ({
          ...item,
          totalMinutes: item.hgMinutes + item.advisoryRoleMinutes + item.otherSubjectMinutes,
        }))
        .sort((a, b) => {
          if (a.gradeLevel !== b.gradeLevel) return a.gradeLevel.localeCompare(b.gradeLevel);
          if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
          return a.teacherName.localeCompare(b.teacherName);
        });

      res.json({ assignments, workloadSummary });
    } catch (err: any) {
      logger.error("Error fetching class assignments:", err);
      res.status(500).json({ message: "Failed to fetch class assignments" });
    }
  });

  router.post("/class-assignments", authenticateToken, authorizeRoles("ADMIN"), validate(classAssignmentCreateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { teacherId, subjectId, sectionId, schoolYear } = req.body;
      if (!teacherId || !subjectId || !sectionId || !schoolYear) {
        res.status(400).json({ message: "teacherId, subjectId, sectionId, and schoolYear are required" });
        return;
      }
      const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { code: true, name: true } });
      if (!subject) {
        res.status(404).json({ message: "Subject not found" });
        return;
      }
      if (subject.code.startsWith('HG') && subject.name !== 'Homeroom Guidance') {
        await prisma.subject.update({ where: { id: subjectId }, data: { name: 'Homeroom Guidance' } });
      }

      const assignment = await prisma.classAssignment.create({
        data: {
          teacherId,
          subjectId,
          sectionId,
          schoolYear,
          teachingMinutes: subject.code.startsWith('HG') ? 60 : null,
        },
        include: {
          teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
          subject: true,
          section: true,
        },
      });
      res.status(201).json(assignment);
    } catch (err: any) {
      if (err.code === "P2002") {
        res.status(409).json({ message: "This teacher is already assigned to that subject and section for this school year." });
      } else {
        logger.error("Error creating class assignment:", err);
        res.status(500).json({ message: "Failed to create class assignment" });
      }
    }
  });

  router.delete("/class-assignments/:id", authenticateToken, authorizeRoles("ADMIN"), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const assignmentId = String(req.params.id ?? '');
      if (!assignmentId) {
        res.status(400).json({ message: "Missing class assignment id" });
        return;
      }

      await prisma.classAssignment.update({
        where: { id: assignmentId },
        data: {
          isActive: false,
          archivedAt: new Date(),
          archivedReason: 'Manually removed in SMART',
        },
      });
      res.json({ message: "Archived" });
    } catch (err: any) {
      if (err.code === "P2025") {
        res.status(404).json({ message: "Assignment not found" });
      } else {
        logger.error("Error archiving class assignment:", err);
        res.status(500).json({ message: "Failed to archive class assignment" });
      }
    }
  });

  // ── School Year Management ──────────────────────────────────────────────

  router.get("/school-years", authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const years = await prisma.schoolYear.findMany({ orderBy: { label: "desc" } });
      res.json({ schoolYears: years });
    } catch (err: any) {
      logger.error("Error fetching school years:", err);
      res.status(500).json({ message: "Failed to fetch school years" });
    }
  });

  router.post("/school-years", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { label, startDate, endDate } = req.body;
      if (!label) {
        res.status(400).json({ message: "label is required (e.g. '2027-2028')" });
        return;
      }

      const existing = await prisma.schoolYear.findUnique({ where: { label } });
      if (existing) {
        res.status(409).json({ message: `School year ${label} already exists` });
        return;
      }

      const year = await prisma.schoolYear.create({
        data: {
          label,
          status: "DRAFT",
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
        },
      });
      invalidateSchoolYearCache();

      const user = req.user;
      if (user) {
        await createAuditLog(
          AuditAction.CREATE,
          user,
          `Created School Year ${label}`,
          "School Year",
          `Created new school year: ${label} (status: DRAFT)`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.INFO
        );
      }

      res.status(201).json(year);
    } catch (err: any) {
      logger.error("Error creating school year:", err);
      res.status(500).json({ message: "Failed to create school year" });
    }
  });

  router.patch("/school-years/:id", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { status, startDate, endDate } = req.body;

      const year = await prisma.schoolYear.findUnique({ where: { id } });
      if (!year) {
        res.status(404).json({ message: "School year not found" });
        return;
      }

      const updateData: any = {};
      if (status) updateData.status = status;
      if (startDate) updateData.startDate = new Date(startDate);
      if (endDate) updateData.endDate = new Date(endDate);
      if (status === "ARCHIVED" || status === "COMPLETED") updateData.archivedAt = new Date();

      const updated = await prisma.schoolYear.update({ where: { id }, data: updateData });
      invalidateSchoolYearCache();

      const user = req.user;
      if (user) {
        await createAuditLog(
          AuditAction.UPDATE,
          user,
          `Updated School Year ${year.label}`,
          "School Year",
          `Updated school year ${year.label}: status=${updated.status}`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.INFO
        );
      }

      res.json(updated);
    } catch (err: any) {
      logger.error("Error updating school year:", err);
      res.status(500).json({ message: "Failed to update school year" });
    }
  });

  router.delete("/school-years/:id", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;

      const year = await prisma.schoolYear.findUnique({ where: { id } });
      if (!year) {
        res.status(404).json({ message: "School year not found" });
        return;
      }

      if (year.status !== "DRAFT") {
        res.status(400).json({ message: `Cannot delete ${year.label} (status: ${year.status}). Only DRAFT years can be deleted.` });
        return;
      }

      await prisma.schoolYear.delete({ where: { id } });
      invalidateSchoolYearCache();

      const user = req.user;
      if (user) {
        await createAuditLog(
          AuditAction.DELETE,
          user,
          `Deleted School Year ${year.label}`,
          "School Year",
          `Deleted draft school year: ${year.label}`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.WARNING
        );
      }

      res.json({ message: `School year ${year.label} deleted` });
    } catch (err: any) {
      logger.error("Error deleting school year:", err);
      res.status(500).json({ message: "Failed to delete school year" });
    }
  });

  // ── Archive School Year ─────────────────────────────────────────────────

  router.post("/archive-year", authenticateToken, requireAdmin, validate(archiveYearSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { schoolYear } = req.body;
      if (!schoolYear) {
        res.status(400).json({ message: "schoolYear is required" });
        return;
      }

      const sectionCount = await prisma.section.count({ where: { schoolYear } });
      if (sectionCount === 0) {
        res.status(404).json({ message: `No sections found for school year ${schoolYear}` });
        return;
      }

      const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      if (settings?.currentSchoolYear === schoolYear) {
        res.status(400).json({ message: `Cannot archive the current active school year (${schoolYear}). Roll over to a new year first.` });
        return;
      }

      const archiveTime = new Date();
      const archiveReason = `Year ${schoolYear} archived`;

      const results = await prisma.$transaction(async (tx) => {
        const gradesResult = await tx.grade.updateMany({
          where: {
            classAssignment: { schoolYear }
          },
          data: {
            isArchived: true,
            archivedAt: archiveTime,
            archivedReason: archiveReason
          }
        });

        const enrollmentsResult = await tx.enrollment.updateMany({
          where: { schoolYear },
          data: {
            isArchived: true,
            archivedAt: archiveTime,
            archivedReason: archiveReason
          }
        });

        const sectionsResult = await tx.section.updateMany({
          where: { schoolYear },
          data: {
            status: "COMPLETED",
            archivedAt: archiveTime
          }
        });

        const assignmentsResult = await tx.classAssignment.updateMany({
          where: { schoolYear },
          data: {
            isActive: false,
            archivedAt: archiveTime,
            archivedReason: archiveReason
          }
        });

        return {
          grades: gradesResult.count,
          enrollments: enrollmentsResult.count,
          sections: sectionsResult.count,
          assignments: assignmentsResult.count
        };
      });

      const user = req.user;
      if (user) {
        await createAuditLog(
          AuditAction.UPDATE,
          user,
          `Archive School Year ${schoolYear}`,
          "System Settings",
          `Archived year ${schoolYear}: ${results.grades} grades, ${results.enrollments} enrollments, ${results.sections} sections, ${results.assignments} assignments frozen`,
          (req.ip as string) || req.socket?.remoteAddress,
          AuditSeverity.WARNING
        );
      }

      await prisma.systemSettings.update({
        where: { id: "main" },
        data: { gradeLock: true },
      });

      res.json({
        message: `School year ${schoolYear} archived successfully`,
        schoolYear,
        archived: results
      });
    } catch (err: any) {
      logger.error("Error archiving school year:", err);
      res.status(500).json({ message: "Failed to archive school year" });
    }
  });
}
