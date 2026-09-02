/**
 * remedial.ts — Remedial class CRUD routes.
 *
 * All routes are REGISTRAR-only.
 * Remedial records are SMART-local (never pushed to EnrollPro).
 */

import { Router, Request, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  remedialUpdateSchema,
  remedialCompleteSchema,
  remedialManualCreateSchema,
  remedialPendingQuerySchema,
} from "../../schemas/remedial";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { completeRemedial, buildCertificate, computeRfg, determineOutcome } from "../../lib/remedial";
import { logger } from "../../lib/logger";

export default function registerRemedialRoutes(router: Router): void {

// GET /registrar/remedial/pending — students with CONDITIONALLY_PROMOTED + their remedial rows
router.get("/remedial/pending", authenticateToken, validate(remedialPendingQuerySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") {
    res.status(403).json({ message: "Access denied. Registrar only." });
    return;
  }
  try {
    const { schoolYear, gradeLevel, page, limit } = req.query as {
      schoolYear?: string;
      gradeLevel?: string;
      page?: string;
      limit?: string;
    };

    const where: any = {
      promotionStatus: "CONDITIONALLY_PROMOTED",
    };
    if (schoolYear) where.schoolYear = schoolYear;
    if (gradeLevel) where.gradeLevel = gradeLevel;

    const pageNum = Math.max(1, parseInt(page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit || "25", 10)));
    const skip = (pageNum - 1) * pageSize;

    const [enrollments, total] = await Promise.all([
      prisma.enrollment.findMany({
        where,
        include: {
          student: true,
          section: true,
          remedialClasses: { orderBy: { subjectName: "asc" } },
        },
        orderBy: { student: { lastName: "asc" } },
        skip,
        take: pageSize,
      }),
      prisma.enrollment.count({ where }),
    ]);

    const items = enrollments.map((e) => ({
      enrollmentId: e.id,
      studentId: e.studentId,
      lrn: e.student.lrn,
      firstName: e.student.firstName,
      lastName: e.student.lastName,
      middleName: e.student.middleName,
      sex: e.student.gender,
      gradeLevel: e.section.gradeLevel,
      section: { name: e.section.name },
      schoolYear: e.schoolYear,
      promotionStatus: e.promotionStatus,
      remedialClasses: e.remedialClasses.map((rc) => ({
        id: rc.id,
        subjectCode: rc.subjectCode,
        subjectName: rc.subjectName,
        originalGrade: rc.originalGrade,
        remedialMark: rc.remedialMark,
        recomputedGrade: rc.recomputedGrade,
        outcome: rc.outcome,
        status: rc.status,
        conductedFrom: rc.conductedFrom,
        conductedTo: rc.conductedTo,
      })),
    }));

    res.json({
      items,
      meta: {
        total,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("[registrar/remedial/pending]", err.message);
    res.status(500).json({ message: "Failed to fetch pending remedial list" });
  }
});

// PATCH /registrar/remedial/:id — update single remedial row (RCM, dates)
router.patch("/remedial/:id", authenticateToken, validate(remedialUpdateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") {
    res.status(403).json({ message: "Access denied. Registrar only." });
    return;
  }
  try {
    const id = String(req.params.id);
    const { remedialMark, conductedFrom, conductedTo } = req.body;

    const existing = await prisma.remedialClass.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Remedial record not found" });
      return;
    }
    if (existing.status === "COMPLETED") {
      res.status(400).json({ message: "Cannot edit a completed remedial record" });
      return;
    }

    const updated = await prisma.remedialClass.update({
      where: { id },
      data: {
        remedialMark,
        ...(conductedFrom ? { conductedFrom: new Date(conductedFrom) } : {}),
        ...(conductedTo ? { conductedTo: new Date(conductedTo) } : {}),
      },
    });

    await createAuditLog(
      AuditAction.UPDATE,
      user,
      `Remedial Update: ${existing.subjectName}`,
      "RemedialClass",
      `Updated RCM for ${existing.subjectName}: ${existing.remedialMark ?? "null"} -> ${remedialMark}`,
      req.ip,
      AuditSeverity.INFO,
      id
    );

    res.json({ message: "Remedial record updated", remedial: updated });
  } catch (err: any) {
    logger.error("[registrar/remedial/:id]", err.message);
    res.status(500).json({ message: "Failed to update remedial record" });
  }
});

// POST /registrar/remedial/:enrollmentId/complete — finalize remedial for enrollment
router.post("/remedial/:enrollmentId/complete", authenticateToken, validate(remedialCompleteSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") {
    res.status(403).json({ message: "Access denied. Registrar only." });
    return;
  }
  try {
    const enrollmentId = req.params.enrollmentId as string;
    const { retentionOverride } = req.body;

    const result = await completeRemedial(
      enrollmentId,
      { id: user.id, name: user.username, role: user.role },
      { retentionOverride }
    );

    res.json({
      message: `Remedial completed: ${result.previousStatus} -> ${result.newStatus}`,
      ...result,
    });
  } catch (err: any) {
    if (err.message?.startsWith("MISSING_RCM")) {
      res.status(400).json({ message: err.message });
      return;
    }
    if (err.message === "ENROLLMENT_NOT_CONDITIONALLY_PROMOTED") {
      res.status(400).json({ message: "Enrollment is not conditionally promoted" });
      return;
    }
    if (err.message === "NO_PENDING_REMEDIAL_RECORDS") {
      res.status(400).json({ message: "No pending remedial records for this enrollment" });
      return;
    }
    logger.error("[registrar/remedial/complete]", err.message);
    res.status(500).json({ message: "Failed to complete remedial" });
  }
});

// POST /registrar/remedial/:enrollmentId/manual-create — escape hatch for manual entry
router.post("/remedial/:enrollmentId/manual-create", authenticateToken, validate(remedialManualCreateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") {
    res.status(403).json({ message: "Access denied. Registrar only." });
    return;
  }
  try {
    const enrollmentId = req.params.enrollmentId as string;
    const { subjectCode, subjectName, originalGrade } = req.body;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { section: true },
    });
    if (!enrollment) {
      res.status(404).json({ message: "Enrollment not found" });
      return;
    }

    const existing = await prisma.remedialClass.findUnique({
      where: { enrollmentId_subjectCode: { enrollmentId, subjectCode } },
    });
    if (existing) {
      res.status(409).json({ message: "Remedial record already exists for this subject" });
      return;
    }

    const remedial = await prisma.remedialClass.create({
      data: {
        enrollmentId,
        schoolYear: enrollment.schoolYear,
        gradeLevel: enrollment.section.gradeLevel,
        subjectCode,
        subjectName,
        originalGrade,
        status: "PENDING",
      },
    });

    await createAuditLog(
      AuditAction.CREATE,
      user,
      `Remedial Manual Create: ${subjectName}`,
      "RemedialClass",
      `Manually created remedial record for enrollment ${enrollmentId}: ${subjectName} (grade: ${originalGrade})`,
      req.ip,
      AuditSeverity.WARNING,
      remedial.id
    );

    res.status(201).json({ message: "Remedial record created", remedial });
  } catch (err: any) {
    logger.error("[registrar/remedial/manual-create]", err.message);
    res.status(500).json({ message: "Failed to create remedial record" });
  }
});

// GET /registrar/remedial/:enrollmentId/certificate — certificate data for print
router.get("/remedial/:enrollmentId/certificate", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") {
    res.status(403).json({ message: "Access denied. Registrar only." });
    return;
  }
  try {
    const enrollmentId = req.params.enrollmentId as string;
    const cert = await buildCertificate(enrollmentId);
    if (!cert) {
      res.status(404).json({ message: "No completed remedial records found" });
      return;
    }
    res.json(cert);
  } catch (err: any) {
    logger.error("[registrar/remedial/certificate]", err.message);
    res.status(500).json({ message: "Failed to build certificate" });
  }
});

}
