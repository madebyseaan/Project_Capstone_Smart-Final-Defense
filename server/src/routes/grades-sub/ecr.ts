/**
 * grades-sub/ecr.ts — Official E-Class-Record Excel import/export endpoints.
 *
 * Guard sequence mirrors grades-sub/aims.ts:
 *   teacher profile → assignment ownership → archived → Homeroom Guidance
 *   → grade edit locks (archived/year/term) → current-term (approved edit request bypass).
 */

import { Router, Response } from "express";
import multer from "multer";
import path from "path";
import { Term } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../../middleware/auth";
import { logger } from "../../lib/logger";
import { resolveCurrentTerm, isHomeroomGuidanceSubjectCode } from "./helpers";
import { checkGradeEditLocks } from "../../lib/gradeLocks";
import { parseEcrWorkbook, EcrParseError, type EcrTerm } from "../../lib/ecrParser";
import { importEcrToGrades } from "../../lib/ecrImport";
import { exportEcrWorkbook } from "../../lib/ecrExport";

const VALID_TERMS = ["T1", "T2", "T3"] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm") cb(null, true);
    else cb(new Error("Only Excel files (.xlsx, .xls, .xlsm) are allowed"));
  },
});

export default function registerEcr(router: Router): void {
  // POST /ecr-import/:classAssignmentId  (multipart: file, term, dryRun)
  router.post(
    "/ecr-import/:classAssignmentId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    upload.single("file"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const classAssignmentId = String(req.params.classAssignmentId);
        const termRaw = String(req.body?.term ?? "");
        if (!VALID_TERMS.includes(termRaw as (typeof VALID_TERMS)[number])) {
          res.status(400).json({ message: "Invalid term. Must be T1, T2, or T3." });
          return;
        }
        const term = termRaw as Term;
        const dryRun = String(req.body?.dryRun ?? "false") === "true";

        const teacher = await prisma.teacher.findUnique({ where: { userId: req.user?.id } });
        if (!teacher) { res.status(404).json({ message: "Teacher profile not found" }); return; }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: { id: classAssignmentId, teacherId: teacher.id },
          include: { subject: true, section: true },
        });
        if (!classAssignment) { res.status(403).json({ message: "Not authorized for this class" }); return; }

        if (classAssignment.isActive === false) {
          res.status(403).json({
            code: "ASSIGNMENT_ARCHIVED",
            message: classAssignment.archivedReason === "ATLAS_REASSIGNED"
              ? "This class was transferred to another teacher."
              : "This class assignment is no longer active.",
          });
          return;
        }

        if (isHomeroomGuidanceSubjectCode(classAssignment.subject.code)) {
          res.status(400).json({ message: "Cannot import grades for HG." });
          return;
        }

        const sampleGrade = await prisma.grade.findFirst({
          where: { classAssignmentId, term },
          select: { isArchived: true },
        });
        const lockBlock = await checkGradeEditLocks({
          teacherUserId: teacher.userId,
          schoolYearLabel: classAssignment.schoolYear,
          term,
          isArchived: sampleGrade?.isArchived ?? false,
        });
        if (lockBlock) { res.status(403).json({ code: lockBlock.code, message: lockBlock.message }); return; }

        const termOrder: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
        const currentTerm = await resolveCurrentTerm();
        const currentTermNum = termOrder[currentTerm] ?? 1;
        const requestTermNum = termOrder[term] ?? 0;
        if (requestTermNum > 0 && requestTermNum !== currentTermNum) {
          const editRequest = await prisma.gradeEditRequest.findFirst({
            where: { teacherId: teacher.userId, term, status: "APPROVED", expiresAt: { gt: new Date() } },
          });
          if (!editRequest) {
            const relation = requestTermNum < currentTermNum ? "past" : "future";
            res.status(403).json({ message: `Cannot edit grades for ${term} (${relation} term).` });
            return;
          }
        }

        const file = req.file;
        if (!file) { res.status(400).json({ message: "No file uploaded." }); return; }

        let parsed: ReturnType<typeof parseEcrWorkbook>;
        try {
          parsed = parseEcrWorkbook(file.buffer, term as EcrTerm);
        } catch (err) {
          if (err instanceof EcrParseError) {
            res.status(400).json({ message: err.message, details: err.details });
            return;
          }
          throw err;
        }

        const report = await importEcrToGrades({
          classAssignmentId,
          term,
          parsed,
          teacherId: teacher.id,
          teacherUserId: teacher.userId,
          dryRun,
        });

        res.json(report);
      } catch (error) {
        logger.error("Error importing ECR Excel:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // GET /ecr-export/:classAssignmentId?term=T1 — read-only, no lock checks
  router.get(
    "/ecr-export/:classAssignmentId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const classAssignmentId = String(req.params.classAssignmentId);
        const termRaw = String(req.query.term ?? "T1");
        if (!VALID_TERMS.includes(termRaw as (typeof VALID_TERMS)[number])) {
          res.status(400).json({ message: "Invalid term. Must be T1, T2, or T3." });
          return;
        }
        const term = termRaw as Term;

        const teacher = await prisma.teacher.findUnique({ where: { userId: req.user?.id } });
        if (!teacher) { res.status(404).json({ message: "Teacher profile not found" }); return; }

        const classAssignment = await prisma.classAssignment.findFirst({
          where: { id: classAssignmentId, teacherId: teacher.id },
        });
        if (!classAssignment) { res.status(403).json({ message: "Not authorized for this class" }); return; }

        const { buffer, fileName } = await exportEcrWorkbook({ classAssignmentId, term });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.send(buffer);
      } catch (error) {
        logger.error("Error exporting ECR Excel:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );
}
