/**
 * sf10Profile.ts — Registrar-editable SF10 profile fields.
 *
 * Covers the SF10 "Eligibility for JHS Enrolment" block (SMART/registrar-owned;
 * EnrollPro does not provide it) plus registrar-completable identity/transfer
 * fields (birth date, sex, previous school, last grade completed, TC no.,
 * transfer-in date). Names and LRN remain EnrollPro-owned and are rejected.
 *
 * All routes REGISTRAR-only. Writes are audit-logged and transactional.
 */

import { Router, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sf10ProfileUpdateSchema } from "../../schemas/registrar";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { logger } from "../../lib/logger";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";

export default function registerSf10ProfileRoutes(router: Router): void {
  router.patch(
    "/students/:studentId/sf10-profile",
    authenticateToken,
    validate(sf10ProfileUpdateSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const user = req.user;
      if (!user || user.role !== "REGISTRAR") {
        res.status(403).json({ message: "Access denied. Registrar only." });
        return;
      }

      try {
        const studentId = req.params.studentId as string;
        const body = req.body as Record<string, unknown>;

        const student = await prisma.student.findUnique({ where: { id: studentId } });
        if (!student) {
          res.status(404).json({ message: "Student not found" });
          return;
        }

        const studentData: Record<string, unknown> = {};
        const setDate = (field: string, value: unknown) => {
          if (value === undefined) return;
          studentData[field] = value === null || value === "" ? null : new Date(value as string);
        };
        const setValue = (field: string, value: unknown) => {
          if (value === undefined) return;
          studentData[field] = value;
        };

        setDate("birthDate", body.birthDate);
        setValue("gender", body.gender);
        setValue("previousSchool", body.previousSchool);
        setValue("lastGradeCompleted", body.lastGradeCompleted);
        setValue("transferCertNo", body.transferCertNo);
        setValue("elementarySchoolCompleter", body.elementarySchoolCompleter);
        setValue("elementarySchoolName", body.elementarySchoolName);
        setValue("elementaryGeneralAverage", body.elementaryGeneralAverage);
        setValue("peptPasser", body.peptPasser);
        setValue("peptRating", body.peptRating);
        setDate("peptExamDate", body.peptExamDate);
        setValue("alsAePasser", body.alsAePasser);

        const hasTransferInDate = body.transferInDate !== undefined;

        if (Object.keys(studentData).length === 0 && !hasTransferInDate) {
          res.status(400).json({ message: "No changes provided" });
          return;
        }

        let enrollmentUpdate = null;
        if (hasTransferInDate) {
          const currentSchoolYear = await getActiveSchoolYearLabel();
          const enrollment = await prisma.enrollment.findFirst({
            where: { studentId, schoolYear: currentSchoolYear },
            orderBy: { updatedAt: "desc" },
          });
          if (enrollment) {
            const value = body.transferInDate;
            enrollmentUpdate = prisma.enrollment.update({
              where: { id: enrollment.id },
              data: { transferInDate: value === null || value === "" ? null : new Date(value as string) },
            });
          }
        }

        await prisma.$transaction([
          ...(Object.keys(studentData).length > 0
            ? [prisma.student.update({ where: { id: studentId }, data: studentData })]
            : []),
          ...(enrollmentUpdate ? [enrollmentUpdate] : []),
        ]);

        await createAuditLog(
          AuditAction.UPDATE,
          user,
          `SF10 profile: LRN ${student.lrn}`,
          "Student",
          `Updated SF10 profile fields: ${[...Object.keys(studentData), ...(hasTransferInDate ? ["transferInDate"] : [])].join(", ")}`,
          req.ip,
          AuditSeverity.INFO,
          studentId
        );

        res.json({ message: "SF10 profile updated" });
      } catch (err: any) {
        logger.error("[registrar/sf10-profile PATCH]", err.message);
        res.status(500).json({ message: "Failed to update SF10 profile" });
      }
    }
  );
}
