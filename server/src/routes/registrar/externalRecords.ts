/**
 * externalRecords.ts — Prior-school (SF10/SF9) records for transferees.
 *
 * Registrar-only, manual entry. These records are DISPLAY-ONLY and never
 * feed Grade / promotion / EOSY math. All writes are audit-logged.
 * See docs/REGISTRAR/SF10_SF9_IMPORT_PLAN.md.
 */

import { Router, Response } from "express";
import multer from "multer";
import { Prisma, AuditAction, AuditSeverity } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  externalRecordCreateSchema,
  externalRecordUpdateSchema,
  externalRecordIdSchema,
  externalRecordStudentSchema,
  externalRecordLockSchema,
} from "../../schemas/registrar";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import {
  sanitizeTerms,
  computeFinalFromTerms,
  deriveRemarks,
} from "../../lib/externalRecordValidation";
import { scanSf10Document } from "../../lib/sf10Scan";

// Scanned images are processed in memory only — never written to disk (D9).
const IMAGE_MIME = /^image\/(jpeg|png|webp)$/;
const SHEET_MIME = /spreadsheetml|ms-excel/;
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, IMAGE_MIME.test(file.mimetype) || SHEET_MIME.test(file.mimetype));
  },
});

type UploadedRequest = AuthRequest & { file?: { buffer: Buffer; mimetype: string; originalname: string } };

interface SubjectInput {
  subjectCode: string | null;
  subjectName: string;
  terms?: Prisma.InputJsonValue;
  finalRating: number | null;
  remarks: string | null;
  isNonPromotional: boolean;
}

interface SubjectBody {
  subjectCode?: string;
  subjectName: string;
  terms?: Array<{ label: string; value: number }>;
  finalRating?: number;
  remarks?: string;
  isNonPromotional?: boolean;
}

function buildSubjects(subjects: SubjectBody[]): SubjectInput[] {
  return subjects.map((s) => {
    const terms = sanitizeTerms(s.terms);
    const finalRating = s.finalRating ?? computeFinalFromTerms(terms);
    return {
      subjectCode: s.subjectCode ?? null,
      subjectName: s.subjectName,
      ...(terms.length > 0 ? { terms: terms as unknown as Prisma.InputJsonValue } : {}),
      finalRating: finalRating ?? null,
      remarks: s.remarks ?? deriveRemarks(finalRating),
      isNonPromotional: s.isNonPromotional ?? false,
    };
  });
}

export default function registerExternalRecordRoutes(router: Router): void {
  // GET /registrar/students/:studentId/external-records
  router.get(
    "/students/:studentId/external-records",
    authenticateToken,
    validate(externalRecordStudentSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const user = req.user;
      if (!user || user.role !== "REGISTRAR") {
        res.status(403).json({ message: "Access denied. Registrar only." });
        return;
      }
      try {
        const studentId = String(req.params.studentId);
        const student = await prisma.student.findUnique({
          where: { id: studentId },
          select: { id: true, lrn: true },
        });
        if (!student) {
          res.status(404).json({ message: "Student not found" });
          return;
        }
        const records = await prisma.externalSchoolRecord.findMany({
          where: { studentId },
          include: { subjects: true },
          orderBy: [{ schoolYear: "asc" }, { gradeLevel: "asc" }],
        });
        res.json({ lrn: student.lrn, records });
      } catch (err: any) {
        logger.error("[registrar/external-records GET]", err.message);
        res.status(500).json({ message: "Failed to fetch prior-school records" });
      }
    }
  );

  // POST /registrar/external-records/scan — OCR a prior SF10/SF9 photo (nothing persisted)
  router.post(
    "/external-records/scan",
    authenticateToken,
    scanUpload.single("file"),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const user = req.user;
      if (!user || user.role !== "REGISTRAR") {
        res.status(403).json({ message: "Access denied. Registrar only." });
        return;
      }
      const file = (req as UploadedRequest).file;
      if (!file) {
        res.status(400).json({ message: "No image uploaded" });
        return;
      }
      try {
        const result = await scanSf10Document(file.buffer, file.mimetype);
        res.json({
          draft: result.draft,
          drafts: result.drafts,
          rawText: result.rawText,
          confidence: result.confidence,
          method: result.method,
          ...(result.reason ? { reason: result.reason } : {}),
        });
      } catch (err: any) {
        logger.error("[registrar/external-records/scan]", err.message);
        res.status(500).json({ message: "Failed to scan document" });
      }
    }
  );

  // POST /registrar/students/:studentId/external-records
  router.post(
    "/students/:studentId/external-records",
    authenticateToken,
    validate(externalRecordCreateSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const user = req.user;
      if (!user || user.role !== "REGISTRAR") {
        res.status(403).json({ message: "Access denied. Registrar only." });
        return;
      }
      try {
        const studentId = String(req.params.studentId);
        const body = req.body;

        const student = await prisma.student.findUnique({
          where: { id: studentId },
          select: { id: true, lrn: true },
        });
        if (!student) {
          res.status(404).json({ message: "Student not found" });
          return;
        }

        const created = await prisma.externalSchoolRecord.create({
          data: {
            studentId,
            schoolYear: body.schoolYear,
            gradeLevel: body.gradeLevel,
            schoolName: body.schoolName,
            schoolId: body.schoolId ?? null,
            sectionName: body.sectionName ?? null,
            adviserName: body.adviserName ?? null,
            generalAverage: body.generalAverage ?? null,
            promotionStatus: body.promotionStatus ?? null,
            formType: body.formType ?? "SF10",
            isPartialYear: body.isPartialYear ?? false,
            source: body.source ?? "MANUAL",
            ocrRawText: body.ocrRawText ?? null,
            verifiedById: user.id ?? null,
            verifiedAt: new Date(),
            subjects: { create: buildSubjects(body.subjects) },
          },
          include: { subjects: true },
        });

        await createAuditLog(
          AuditAction.CREATE,
          user,
          `Prior-school record: LRN ${student.lrn} ${body.schoolYear} ${body.gradeLevel}`,
          "ExternalSchoolRecord",
          `Added ${body.subjects.length} subject(s) from "${body.schoolName}" (${body.schoolYear} ${body.gradeLevel})`,
          req.ip,
          AuditSeverity.INFO,
          created.id,
          { studentId, schoolYear: body.schoolYear, gradeLevel: body.gradeLevel },
        );

        res.status(201).json({ message: "Prior-school record saved", record: created });
      } catch (err: any) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          res.status(409).json({
            message: "A record for this school year and grade level already exists for this school.",
          });
          return;
        }
        logger.error("[registrar/external-records POST]", err.message);
        res.status(500).json({ message: "Failed to save prior-school record" });
      }
    }
  );

  // PATCH /registrar/external-records/:id
  router.patch(
    "/external-records/:id",
    authenticateToken,
    validate(externalRecordUpdateSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const user = req.user;
      if (!user || user.role !== "REGISTRAR") {
        res.status(403).json({ message: "Access denied. Registrar only." });
        return;
      }
      try {
        const id = String(req.params.id);
        const body = req.body;

        const existing = await prisma.externalSchoolRecord.findUnique({ where: { id } });
        if (!existing) {
          res.status(404).json({ message: "Prior-school record not found" });
          return;
        }
        if (existing.locked) {
          res.status(409).json({ message: "Record is locked. Unlock it to make changes." });
          return;
        }
        const student = await prisma.student.findUnique({
          where: { id: existing.studentId },
          select: { lrn: true },
        });

        const data: Prisma.ExternalSchoolRecordUpdateInput = {};
        const scalarKeys = [
          "schoolYear", "gradeLevel", "schoolName", "schoolId",
          "sectionName", "adviserName", "generalAverage", "promotionStatus",
          "formType", "isPartialYear",
        ] as const;
        for (const key of scalarKeys) {
          if (body[key] !== undefined) (data as Record<string, unknown>)[key] = body[key];
        }

        const subjectsData = body.subjects ? buildSubjects(body.subjects) : null;

        await prisma.$transaction(async (tx) => {
          if (subjectsData) {
            await tx.externalSubjectRecord.deleteMany({ where: { recordId: id } });
            data.subjects = { create: subjectsData };
          }
          await tx.externalSchoolRecord.update({ where: { id }, data });
        });

        await createAuditLog(
          AuditAction.UPDATE,
          user,
          `Prior-school record: LRN ${student?.lrn ?? existing.studentId} ${existing.schoolYear} ${existing.gradeLevel}`,
          "ExternalSchoolRecord",
          `Updated prior-school record${subjectsData ? ` (replaced ${subjectsData.length} subject(s))` : ""}`,
          req.ip,
          AuditSeverity.INFO,
          id,
          { studentId: existing.studentId },
        );

        res.json({ message: "Prior-school record updated" });
      } catch (err: any) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          res.status(409).json({
            message: "A record for this school year and grade level already exists for this school.",
          });
          return;
        }
        logger.error("[registrar/external-records PATCH]", err.message);
        res.status(500).json({ message: "Failed to update prior-school record" });
      }
    }
  );

  // DELETE /registrar/external-records/:id
  router.delete(
    "/external-records/:id",
    authenticateToken,
    validate(externalRecordIdSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const user = req.user;
      if (!user || user.role !== "REGISTRAR") {
        res.status(403).json({ message: "Access denied. Registrar only." });
        return;
      }
      try {
        const id = String(req.params.id);
        const existing = await prisma.externalSchoolRecord.findUnique({ where: { id } });
        if (!existing) {
          res.status(404).json({ message: "Prior-school record not found" });
          return;
        }
        if (existing.locked) {
          res.status(409).json({ message: "Record is locked. Unlock it to make changes." });
          return;
        }
        const student = await prisma.student.findUnique({
          where: { id: existing.studentId },
          select: { lrn: true },
        });

        await prisma.externalSchoolRecord.delete({ where: { id } });

        await createAuditLog(
          AuditAction.DELETE,
          user,
          `Prior-school record: LRN ${student?.lrn ?? existing.studentId} ${existing.schoolYear} ${existing.gradeLevel}`,
          "ExternalSchoolRecord",
          `Deleted prior-school record from "${existing.schoolName}" (${existing.schoolYear} ${existing.gradeLevel})`,
          req.ip,
          AuditSeverity.WARNING,
          id,
          { studentId: existing.studentId },
        );

        res.json({ message: "Prior-school record deleted" });
      } catch (err: any) {
        logger.error("[registrar/external-records DELETE]", err.message);
        res.status(500).json({ message: "Failed to delete prior-school record" });
      }
    }
  );

  // PATCH /registrar/external-records/:id/lock — lock/unlock a reviewed record
  router.patch(
    "/external-records/:id/lock",
    authenticateToken,
    validate(externalRecordLockSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const user = req.user;
      if (!user || user.role !== "REGISTRAR") {
        res.status(403).json({ message: "Access denied. Registrar only." });
        return;
      }
      try {
        const id = String(req.params.id);
        const locked = Boolean(req.body.locked);

        const existing = await prisma.externalSchoolRecord.findUnique({ where: { id } });
        if (!existing) {
          res.status(404).json({ message: "Prior-school record not found" });
          return;
        }
        const student = await prisma.student.findUnique({
          where: { id: existing.studentId },
          select: { lrn: true },
        });

        await prisma.externalSchoolRecord.update({ where: { id }, data: { locked } });

        await createAuditLog(
          AuditAction.UPDATE,
          user,
          `Prior-school record ${locked ? "locked" : "unlocked"}: LRN ${student?.lrn ?? existing.studentId} ${existing.schoolYear} ${existing.gradeLevel}`,
          "ExternalSchoolRecord",
          `${locked ? "Locked (verified)" : "Unlocked"} prior-school record`,
          req.ip,
          AuditSeverity.INFO,
          id,
          { studentId: existing.studentId },
        );

        res.json({ message: locked ? "Record locked" : "Record unlocked" });
      } catch (err: any) {
        logger.error("[registrar/external-records/lock]", err.message);
        res.status(500).json({ message: "Failed to update lock" });
      }
    }
  );
}
