import { Router, Response } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../../middleware/auth";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { createAuditLog } from "../../lib/audit";
import { validate } from "../../middleware/validate";
import {
  advisoryObservedValuesQuerySchema,
  advisoryObservedValuesUpdateSchema,
} from "../../schemas/advisory";
import { type Sf9Term } from "../../lib/sf9Composer";
import {
  OBSERVED_VALUE_BEHAVIORS,
  OBSERVED_VALUE_CODES,
  OBSERVED_VALUE_GROUPS,
  OBSERVED_VALUE_RATINGS,
} from "../../lib/observedValues";
import type { ObservedValueRating } from "@prisma/client";

export default function registerObservedValueRoutes(router: Router): void {
  // Teacher-editable SF9 observed values (Report on Learner's Observed Values).
  router.get(
    "/observed-values",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(advisoryObservedValuesQuerySchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
          select: { id: true },
        });
  
        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }
  
        const activeSchoolYear = await getActiveSchoolYearLabel();
        const requestedSchoolYear = (req.query.schoolYear as string | undefined) ?? activeSchoolYear;
  
        if (requestedSchoolYear !== activeSchoolYear) {
          res.status(400).json({
            message: "Historical school years are not editable from the teacher portal yet.",
          });
          return;
        }
  
        const section = await prisma.section.findFirst({
          where: { adviserId: teacher.id, schoolYear: requestedSchoolYear },
          select: { id: true },
        });
  
        if (!section) {
          res.status(404).json({ message: "No advisory section assigned for this school year" });
          return;
        }
  
        const term = req.query.term as Sf9Term;
        const [yearRow, enrollments] = await Promise.all([
          prisma.schoolYear.findUnique({
            where: { label: requestedSchoolYear },
            select: {
              status: true,
              termLabelT1: true,
              termLabelT2: true,
              termLabelT3: true,
            },
          }),
          prisma.enrollment.findMany({
            where: {
              sectionId: section.id,
              schoolYear: requestedSchoolYear,
              status: "ENROLLED",
            },
            include: { student: true },
            orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
          }),
        ]);
  
        const studentIds = enrollments.map((enrollment) => enrollment.studentId);
        const observedRows = studentIds.length === 0
          ? []
          : await prisma.studentObservedValue.findMany({
              where: {
                studentId: { in: studentIds },
                schoolYear: requestedSchoolYear,
                term,
              },
              select: { studentId: true, behaviorCode: true, rating: true },
            });
  
        const ratingsByStudent = new Map<string, Record<string, ObservedValueRating>>();
        for (const row of observedRows) {
          if (!OBSERVED_VALUE_CODES.has(row.behaviorCode)) continue;
          const ratings = ratingsByStudent.get(row.studentId) ?? {};
          ratings[row.behaviorCode] = row.rating;
          ratingsByStudent.set(row.studentId, ratings);
        }
  
        const termLabel =
          term === "T1"
            ? yearRow?.termLabelT1 || "Term 1"
            : term === "T2"
              ? yearRow?.termLabelT2 || "Term 2"
              : yearRow?.termLabelT3 || "Term 3";
  
        const students = enrollments.map((enrollment) => {
          const snapshot = enrollment.profileSnapshot as Record<string, any> | null;
          const student = enrollment.student;
          const ratings = ratingsByStudent.get(student.id) ?? {};
          const markedCount = Object.keys(ratings).filter((code) => OBSERVED_VALUE_CODES.has(code)).length;
  
          return {
            id: student.id,
            lrn: snapshot?.lrn ?? student.lrn,
            name: `${snapshot?.lastName ?? student.lastName}, ${snapshot?.firstName ?? student.firstName} ${snapshot?.middleName ?? student.middleName ?? ""} ${snapshot?.suffix ?? student.suffix ?? ""}`.trim(),
            ratings,
            markedCount,
            totalCount: OBSERVED_VALUE_BEHAVIORS.length,
          };
        });
  
        res.json({
          schoolYear: requestedSchoolYear,
          term,
          termLabel,
          isLocked: yearRow?.status === "ARCHIVED",
          ratings: OBSERVED_VALUE_RATINGS,
          groups: OBSERVED_VALUE_GROUPS,
          students,
        });
      } catch (error) {
        logger.error("Error fetching observed values:", error);
        res.status(500).json({ message: "Failed to load observed values" });
      }
    }
  );
  
  router.put(
    "/observed-values/:studentId",
    authenticateToken,
    authorizeRoles("TEACHER"),
    validate(advisoryObservedValuesUpdateSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const teacher = await prisma.teacher.findUnique({
          where: { userId: req.user?.id },
          select: { id: true },
        });
  
        if (!teacher) {
          res.status(404).json({ message: "Teacher profile not found" });
          return;
        }
  
        const body = req.body as {
          term: Sf9Term;
          schoolYear?: string;
          values: Array<{ behaviorCode: string; rating: ObservedValueRating }>;
        };
  
        const activeSchoolYear = await getActiveSchoolYearLabel();
        const requestedSchoolYear = body.schoolYear ?? activeSchoolYear;
  
        if (requestedSchoolYear !== activeSchoolYear) {
          res.status(400).json({
            message: "Historical school years are not editable from the teacher portal yet.",
          });
          return;
        }
  
        const section = await prisma.section.findFirst({
          where: { adviserId: teacher.id, schoolYear: requestedSchoolYear },
          select: { id: true },
        });
  
        if (!section) {
          res.status(404).json({ message: "No advisory section assigned for this school year" });
          return;
        }
  
        const studentId = req.params.studentId as string;
        const enrollment = await prisma.enrollment.findFirst({
          where: { studentId, sectionId: section.id, schoolYear: requestedSchoolYear },
          select: { id: true },
        });
  
        if (!enrollment) {
          res.status(403).json({ message: "Not authorized to edit this student" });
          return;
        }
  
        const yearRow = await prisma.schoolYear.findUnique({
          where: { label: requestedSchoolYear },
          select: { status: true },
        });
  
        if (yearRow?.status === "ARCHIVED") {
          res.status(403).json({ message: "This school year is archived and observed values are read-only." });
          return;
        }
  
        const invalidCodes = body.values
          .map((value) => value.behaviorCode)
          .filter((code) => !OBSERVED_VALUE_CODES.has(code));
  
        if (invalidCodes.length > 0) {
          res.status(400).json({
            message: "Unknown observed-value behavior code(s)",
            codes: [...new Set(invalidCodes)],
          });
          return;
        }
  
        const ratingByCode = new Map<string, ObservedValueRating>();
        for (const value of body.values) {
          ratingByCode.set(value.behaviorCode, value.rating);
        }
  
        await prisma.$transaction(async (tx) => {
          await tx.studentObservedValue.deleteMany({
            where: {
              studentId,
              schoolYear: requestedSchoolYear,
              term: body.term,
            },
          });
  
          if (ratingByCode.size > 0) {
            await tx.studentObservedValue.createMany({
              data: [...ratingByCode.entries()].map(([behaviorCode, rating]) => ({
                studentId,
                schoolYear: requestedSchoolYear,
                term: body.term,
                behaviorCode,
                rating,
                updatedById: req.user?.id,
              })),
            });
          }
        });
  
        const student = await prisma.student.findUnique({
          where: { id: studentId },
          select: { firstName: true, lastName: true },
        });
  
        await createAuditLog(
          AuditAction.UPDATE,
          {
            id: req.user?.id,
            firstName: req.user?.username,
            lastName: "",
            role: req.user?.role ?? "TEACHER",
          },
          `Observed Values: ${student?.lastName ?? studentId}, ${student?.firstName ?? ""} (${body.term})`,
          "ObservedValue",
          `Saved ${ratingByCode.size} behavior rating(s)`,
          undefined,
          AuditSeverity.INFO,
          studentId,
        );
  
        res.json({
          message: "Observed values saved",
          values: [...ratingByCode.entries()].map(([behaviorCode, rating]) => ({ behaviorCode, rating })),
        });
      } catch (error) {
        logger.error("Error saving observed values:", error);
        res.status(500).json({ message: "Failed to save observed values" });
      }
    }
  );
}
