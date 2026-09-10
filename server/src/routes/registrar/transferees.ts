/**
 * transferees.ts — Transferee (transfer-IN) registrar routes.
 *
 * A transferee is an enrolled learner with `Enrollment.transferInDate != null`
 * (no separate EnrollmentStatus enum value — see TRANSFEREE_PLAN.md D1).
 * All routes are REGISTRAR-only. Writes are audit-logged.
 */

import { Router, Request, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { transfereeUpdateSchema, transfereeTagSchema } from "../../schemas/registrar";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { logger } from "../../lib/logger";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { getSyncTaggedTransfereeLrns } from "../../lib/enrollproSync";

export default function registerTransfereeRoutes(router: Router): void {

// GET /registrar/transferees?schoolYear= — current-SY transferees, a specific SY, or all years
router.get("/transferees", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") {
    res.status(403).json({ message: "Access denied. Registrar only." });
    return;
  }
  try {
    const currentSchoolYear = await getActiveSchoolYearLabel();
    const requested = (req.query.schoolYear as string) || "";

    // Available years: ALL school years (newest first) with transferee counts,
    // so the filter dropdown shows every year including ones with no transferees.
    const [allYears, transfereeCounts] = await Promise.all([
      prisma.schoolYear.findMany({ orderBy: { label: "desc" }, select: { label: true } }),
      prisma.enrollment.groupBy({
        by: ["schoolYear"],
        where: { transferInDate: { not: null }, status: "ENROLLED" },
        _count: true,
      }),
    ]);
    const countByYear = new Map(transfereeCounts.map((g) => [g.schoolYear, g._count]));
    const availableYears = allYears.map((y) => ({ label: y.label, count: countByYear.get(y.label) ?? 0 }));

    // Scope: default = current SY (operational, exclude archived). Specific year /
    // all = historical (schoolYear only, include archived rows per AGENTS.md).
    const where: any =
      requested === "all"
        ? { transferInDate: { not: null }, status: "ENROLLED" }
        : requested
          ? { schoolYear: requested, transferInDate: { not: null }, status: "ENROLLED" }
          : { schoolYear: currentSchoolYear, transferInDate: { not: null }, status: "ENROLLED", isArchived: false };

    const enrollments = await prisma.enrollment.findMany({
      where,
      include: {
        student: true,
        section: true,
      },
      orderBy: [{ schoolYear: "desc" }, { student: { lastName: "asc" } }],
    });

    const syncTaggedLrns = getSyncTaggedTransfereeLrns();

    const transferees = enrollments.map((e) => ({
      enrollmentId: e.id,
      schoolYear: e.schoolYear,
      lrn: e.student.lrn,
      studentName: `${e.student.lastName}, ${e.student.firstName}${e.student.middleName ? " " + e.student.middleName : ""}`.trim(),
      section: {
        id: e.section.id,
        name: e.section.name,
        gradeLevel: e.section.gradeLevel,
      },
      transferInDate: e.transferInDate,
      birthDate: e.student.birthDate,
      gender: e.student.gender,
      details: {
        previousSchool: e.student.previousSchool,
        lastGradeCompleted: e.student.lastGradeCompleted,
        transferCertNo: e.student.transferCertNo,
      },
      completeness: {
        missingBirthDate: !e.student.birthDate,
        missingGender: !e.student.gender,
        missingPreviousSchool: !e.student.previousSchool,
        missingTransferCertNo: !e.student.transferCertNo,
      },
      matchedBySync: syncTaggedLrns.has(e.student.lrn),
    }));

    const syncStatus = (await import("../../lib/syncCoordinator")).getUnifiedSyncStatus();
    const unmatchedFromLastSync = syncStatus.lastResult?.transferees?.unmatched ?? [];

    res.json({
      transferees,
      unmatchedFromLastSync,
      schoolYear: requested === "all" ? "ALL" : requested || currentSchoolYear,
      currentSchoolYear,
      availableYears,
    });
  } catch (err: any) {
    logger.error("[registrar/transferees]", err.message);
    res.status(500).json({ message: "Failed to fetch transferees" });
  }
});

// PATCH /registrar/transferees/:enrollmentId — complete/correct transfer details
router.patch("/transferees/:enrollmentId", authenticateToken, validate(transfereeUpdateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") {
    res.status(403).json({ message: "Access denied. Registrar only." });
    return;
  }
  try {
    const enrollmentId = req.params.enrollmentId as string;
    const { previousSchool, lastGradeCompleted, transferCertNo, birthDate, gender, transferInDate } = req.body;

    const currentSchoolYear = await getActiveSchoolYearLabel();
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { student: true, section: true },
    });
    if (!enrollment) {
      res.status(404).json({ message: "Enrollment not found" });
      return;
    }
    if (enrollment.schoolYear !== currentSchoolYear) {
      res.status(400).json({ message: "Only current school year transferees can be updated" });
      return;
    }
    const isTransferee = enrollment.transferInDate != null;
    if (!isTransferee && !transferInDate) {
      res.status(400).json({ message: "Enrollment is not tagged as a transferee. Provide transferInDate or use the tag endpoint." });
      return;
    }

    const studentData: Record<string, any> = {};
    if (previousSchool !== undefined) studentData.previousSchool = previousSchool;
    if (lastGradeCompleted !== undefined) studentData.lastGradeCompleted = lastGradeCompleted;
    if (transferCertNo !== undefined) studentData.transferCertNo = transferCertNo;
    if (birthDate !== undefined) studentData.birthDate = new Date(birthDate);
    if (gender !== undefined) studentData.gender = gender;

    const enrollmentData: Record<string, any> = {};
    if (transferInDate !== undefined) enrollmentData.transferInDate = new Date(transferInDate);

    await prisma.$transaction([
      ...(Object.keys(studentData).length > 0
        ? [prisma.student.update({ where: { id: enrollment.studentId }, data: studentData })]
        : []),
      ...(Object.keys(enrollmentData).length > 0
        ? [prisma.enrollment.update({ where: { id: enrollmentId }, data: enrollmentData })]
        : []),
    ]);

    await createAuditLog(
      AuditAction.UPDATE,
      user,
      `Transferee details: LRN ${enrollment.student.lrn}`,
      "Student",
      `Updated transferee details${Object.keys(studentData).length > 0 ? ` (student fields: ${Object.keys(studentData).join(", ")})` : ""}${Object.keys(enrollmentData).length > 0 ? ` (enrollment fields: ${Object.keys(enrollmentData).join(", ")})` : ""}`,
      req.ip,
      AuditSeverity.INFO,
      enrollment.studentId
    );

    res.json({ message: "Transferee details updated" });
  } catch (err: any) {
    logger.error("[registrar/transferees PATCH]", err.message);
    res.status(500).json({ message: "Failed to update transferee details" });
  }
});

// POST /registrar/transferees/:enrollmentId/tag — manually tag an ENROLLED student as transferee
router.post("/transferees/:enrollmentId/tag", authenticateToken, validate(transfereeTagSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== "REGISTRAR") {
    res.status(403).json({ message: "Access denied. Registrar only." });
    return;
  }
  try {
    const enrollmentId = req.params.enrollmentId as string;
    const { transferInDate, reason } = req.body;

    const currentSchoolYear = await getActiveSchoolYearLabel();
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { student: true },
    });
    if (!enrollment) {
      res.status(404).json({ message: "Enrollment not found" });
      return;
    }
    if (enrollment.schoolYear !== currentSchoolYear) {
      res.status(400).json({ message: "Only current school year enrollments can be tagged" });
      return;
    }
    if (enrollment.status !== "ENROLLED") {
      res.status(400).json({ message: "Only ENROLLED students can be tagged as transferees" });
      return;
    }

    const tagDate = transferInDate ? new Date(transferInDate) : new Date();
    const updated = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { transferInDate: tagDate },
    });

    await createAuditLog(
      AuditAction.UPDATE,
      user,
      `Tag as transferee: LRN ${enrollment.student.lrn}`,
      "Enrollment",
      `Set transferInDate=${tagDate.toISOString()}${reason ? ` (${reason})` : ""}`,
      req.ip,
      AuditSeverity.INFO,
      enrollmentId
    );

    res.json({ message: "Student tagged as transferee", enrollment: updated });
  } catch (err: any) {
    logger.error("[registrar/transferees/:id/tag]", err.message);
    res.status(500).json({ message: "Failed to tag transferee" });
  }
});

}
