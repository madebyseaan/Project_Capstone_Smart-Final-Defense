import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../middleware/auth";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { logger } from "../lib/logger";
import { createAuditLog } from "../lib/audit";
import { validate } from "../middleware/validate";
import { attendanceBulkSchema, attendanceClearSchema } from "../schemas/attendance";
import { getActiveSchoolYearLabel } from "../lib/schoolYearResolver";
import { buildSf2Grid } from "../lib/attendanceAggregate";
import { buildSf2Workbook } from "../lib/sf2Excel";
import { getSchoolIdentityForYear } from "../lib/schoolSettingsSnapshot";

const router = Router();

export async function assertSectionAttendanceWritable(sectionId: string): Promise<string | null> {
  const section = await prisma.section.findUnique({ where: { id: sectionId } });
  if (!section) return "Section not found";
  if (section.status === "COMPLETED" || section.archivedAt !== null) {
    return "Attendance can only be recorded for the active school year";
  }
  try {
    const activeYear = await getActiveSchoolYearLabel();
    if (section.schoolYear !== activeYear) {
      return "Attendance can only be recorded for the active school year";
    }
  } catch {
    return "Unable to resolve active school year";
  }
  return null;
}

function resolveMonthYear(query: Record<string, unknown>): { month: number; year: number } | null {
  const month = query.month ? parseInt(String(query.month)) : new Date().getMonth() + 1;
  const year = query.year ? parseInt(String(query.year)) : new Date().getFullYear();
  if (!Number.isFinite(month) || !Number.isFinite(year) || month < 1 || month > 12) return null;
  return { month, year };
}

function monthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Parse a "YYYY-MM-DD" calendar date to UTC midnight. Attendance is a
 * date-only value; using local-time Date construction shifts the stored
 * @db.Date by a day on non-UTC servers (e.g. UTC+8), so all attendance
 * dates are normalized to UTC.
 */
function parseDateOnly(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Date(value);
}

// Get attendance for a section on a specific date
router.get(
  "/section/:sectionId",
  authenticateToken,
  authorizeRoles("TEACHER", "ADMIN", "REGISTRAR"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const sectionId = String(req.params.sectionId);
      const { date } = req.query;

      if (!date || typeof date !== "string") {
        res.status(400).json({ message: "Date parameter is required" });
        return;
      }

      const targetDate = parseDateOnly(date);

      // Get all students in the section
      const section = await prisma.section.findUnique({
        where: { id: sectionId },
        include: {
          enrollments: {
            where: { status: "ENROLLED" },
            include: { student: true },
            orderBy: { student: { lastName: "asc" } },
          },
        },
      });

      if (!section) {
        res.status(404).json({ message: "Section not found" });
        return;
      }

      // Get attendance records for this date
      const attendanceRecords = await prisma.attendance.findMany({
        where: {
          sectionId,
          date: targetDate,
        },
        include: { student: true },
      });

      // Map attendance to students (default PRESENT if no record)
      const attendanceData = section.enrollments.map((enrollment: any) => {
        const record = attendanceRecords.find(
          (a: any) => a.studentId === enrollment.student.id
        );
        return {
          studentId: enrollment.student.id,
          lrn: enrollment.student.lrn,
          firstName: enrollment.student.firstName,
          middleName: enrollment.student.middleName,
          lastName: enrollment.student.lastName,
          status: record?.status || "PRESENT",
          remarks: record?.remarks || null,
          attendanceId: record?.id || null,
        };
      });

      res.json({
        success: true,
        data: {
          section: {
            id: section.id,
            name: section.name,
            gradeLevel: section.gradeLevel,
            program: section.program,
          },
          date: targetDate.toISOString().split("T")[0],
          attendance: attendanceData,
        },
      });
    } catch (error: any) {
      logger.error("Error fetching attendance:", error);
      res.status(500).json({ message: "Failed to fetch attendance" });
    }
  }
);

// Delete attendance records for a section on a specific date
router.post(
  "/clear",
  authenticateToken,
  authorizeRoles("TEACHER", "ADMIN"),
  validate(attendanceClearSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { sectionId, date } = req.body;

      if (!sectionId || !date) {
        res.status(400).json({ message: "sectionId and date are required" });
        return;
      }

      const guardError = await assertSectionAttendanceWritable(sectionId);
      if (guardError) {
        res.status(409).json({ message: guardError });
        return;
      }

      const targetDate = parseDateOnly(date);

      const result = await prisma.attendance.deleteMany({
        where: {
          sectionId,
          date: targetDate,
        },
      });

      await createAuditLog(
        AuditAction.DELETE,
        req.user!,
        `Attendance cleared: section ${sectionId} on ${date}`,
        "Attendance",
        `Deleted ${result.count} attendance record(s) for section ${sectionId} on ${date}.`,
        (req.ip as string) || req.socket?.remoteAddress,
        AuditSeverity.WARNING,
      );

      res.json({
        success: true,
        message: `Deleted ${result.count} attendance record(s)`,
        deleted: result.count,
      });
    } catch (error: any) {
      logger.error("Error deleting attendance:", error);
      res.status(500).json({ message: "Failed to delete attendance" });
    }
  }
);

// Save/update attendance for multiple students
router.post(
  "/bulk",
  authenticateToken,
  authorizeRoles("TEACHER", "ADMIN"),
  validate(attendanceBulkSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { sectionId, date, attendance } = req.body;

      if (!sectionId || !date || !Array.isArray(attendance)) {
        res.status(400).json({ message: "Invalid request body" });
        return;
      }

      const guardError = await assertSectionAttendanceWritable(sectionId);
      if (guardError) {
        res.status(409).json({ message: guardError });
        return;
      }

      const targetDate = parseDateOnly(date);

      // Get teacher info for recordedBy
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user?.id },
      });

      // Upsert attendance records
      const operations = attendance.map((record: any) =>
        prisma.attendance.upsert({
          where: {
            studentId_sectionId_date: {
              studentId: record.studentId,
              sectionId: sectionId,
              date: targetDate,
            },
          },
          update: {
            status: record.status,
            remarks: record.remarks || null,
            recordedBy: teacher?.id || req.user?.id,
          },
          create: {
            studentId: record.studentId,
            sectionId: sectionId,
            date: targetDate,
            status: record.status,
            remarks: record.remarks || null,
            recordedBy: teacher?.id || req.user?.id,
          },
        })
      );

      await prisma.$transaction(operations);

      await createAuditLog(
        AuditAction.UPDATE,
        req.user!,
        `Attendance saved: section ${sectionId} on ${date}`,
        "Attendance",
        `Saved ${attendance.length} attendance record(s) for section ${sectionId} on ${date}.`,
        (req.ip as string) || req.socket?.remoteAddress,
        AuditSeverity.INFO,
      );

      res.json({
        success: true,
        message: "Attendance saved successfully",
      });
    } catch (error: any) {
      logger.error("Error saving attendance:", error);
      res.status(500).json({ message: "Failed to save attendance" });
    }
  }
);

// Get attendance summary for a section (date range)
router.get(
  "/summary/:sectionId",
  authenticateToken,
  authorizeRoles("TEACHER", "ADMIN", "REGISTRAR"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const sectionId = String(req.params.sectionId);
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate || typeof startDate !== "string" || typeof endDate !== "string") {
        res.status(400).json({ message: "Start date and end date are required" });
        return;
      }

      const start = parseDateOnly(startDate);
      const end = parseDateOnly(endDate);
      end.setUTCHours(23, 59, 59, 999);

      // Get all attendance records in the date range
      const attendanceRecords = await prisma.attendance.findMany({
        where: {
          sectionId,
          date: {
            gte: start,
            lte: end,
          },
        },
        include: { student: true },
        orderBy: { date: "asc" },
      });

      // Group by student
      const studentSummary = attendanceRecords.reduce((acc: any, record: any) => {
        const key = record.studentId;
        if (!acc[key]) {
          acc[key] = {
            studentId: record.studentId,
            lrn: record.student.lrn,
            firstName: record.student.firstName,
            middleName: record.student.middleName,
            lastName: record.student.lastName,
            present: 0,
            absent: 0,
            late: 0,
            excused: 0,
            total: 0,
          };
        }
        acc[key][record.status.toLowerCase()]++;
        acc[key].total++;
        return acc;
      }, {});

      res.json({
        success: true,
        data: {
          sectionId,
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
          summary: Object.values(studentSummary),
        },
      });
    } catch (error: any) {
      logger.error("Error fetching attendance summary:", error);
      res.status(500).json({ message: "Failed to fetch summary" });
    }
  }
);

// Get attendance for a specific student (date range)
router.get(
  "/student/:studentId",
  authenticateToken,
  authorizeRoles("TEACHER", "ADMIN", "REGISTRAR"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { studentId } = req.params;
      const { startDate, endDate, sectionId } = req.query;

      const whereClause: any = { studentId };

      if (sectionId && typeof sectionId === "string") {
        whereClause.sectionId = sectionId;
      }

      if (startDate && endDate && typeof startDate === "string" && typeof endDate === "string") {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        whereClause.date = { gte: start, lte: end };
      }

      const records = await prisma.attendance.findMany({
        where: whereClause,
        include: { section: true },
        orderBy: { date: "desc" },
      });

      // Calculate summary
      const summary = {
        present: records.filter((r) => r.status === "PRESENT").length,
        absent: records.filter((r) => r.status === "ABSENT").length,
        late: records.filter((r) => r.status === "LATE").length,
        excused: records.filter((r) => r.status === "EXCUSED").length,
        total: records.length,
      };

      res.json({
        success: true,
        data: {
          records,
          summary,
        },
      });
    } catch (error: any) {
      logger.error("Error fetching student attendance:", error);
      res.status(500).json({ message: "Failed to fetch attendance" });
    }
  }
);

// DepEd SF2 (Daily Attendance Report of Learners) — month grid
router.get(
  "/sf2/:sectionId",
  authenticateToken,
  authorizeRoles("TEACHER", "ADMIN", "REGISTRAR"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const sectionId = String(req.params.sectionId);
      const my = resolveMonthYear(req.query);
      if (!my) {
        res.status(400).json({ message: "Invalid month or year parameter" });
        return;
      }
      const { month, year } = my;

      const section = await prisma.section.findUnique({
        where: { id: sectionId },
        include: {
          enrollments: {
            where: { status: "ENROLLED" },
            include: { student: true },
          },
          adviser: { include: { user: true } },
        },
      });

      if (!section) {
        res.status(404).json({ message: "Section not found" });
        return;
      }

      const { start, end } = monthRange(year, month);
      const records = await prisma.attendance.findMany({
        where: { sectionId, date: { gte: start, lte: end } },
        orderBy: { date: "asc" },
      });

      const students = section.enrollments.map((e: any) => e.student);
      const grid = buildSf2Grid(students, records, year, month);
      const schoolIdentity = await getSchoolIdentityForYear(section.schoolYear);

      res.json({
        success: true,
        data: {
          section: {
            id: section.id,
            name: section.name,
            gradeLevel: section.gradeLevel,
            program: section.program,
            schoolYear: section.schoolYear,
            adviserName: section.adviser
              ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}`.trim()
              : null,
          },
          schoolSettings: schoolIdentity,
          ...grid,
        },
      });
    } catch (error: any) {
      logger.error("Error building SF2:", error);
      res.status(500).json({ message: "Failed to build SF2" });
    }
  }
);

// Export attendance to Excel (DepEd SF2 - Daily Attendance)
router.get(
  "/export/:sectionId",
  authenticateToken,
  authorizeRoles("TEACHER", "ADMIN", "REGISTRAR"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const sectionId = String(req.params.sectionId);
      const my = resolveMonthYear(req.query);
      if (!my) {
        res.status(400).json({ message: "Invalid month or year parameter" });
        return;
      }
      const { month, year } = my;

      const section = await prisma.section.findUnique({
        where: { id: sectionId },
        include: {
          enrollments: {
            where: { status: "ENROLLED" },
            include: { student: true },
          },
          adviser: { include: { user: true } },
        },
      });

      if (!section) {
        res.status(404).json({ message: "Section not found" });
        return;
      }

      const { start, end } = monthRange(year, month);
      const records = await prisma.attendance.findMany({
        where: { sectionId, date: { gte: start, lte: end } },
        orderBy: { date: "asc" },
      });

      const students = section.enrollments.map((e: any) => e.student);
      const grid = buildSf2Grid(students, records, year, month);
      const schoolIdentity = await getSchoolIdentityForYear(section.schoolYear);

      const workbook = buildSf2Workbook({
        grid,
        section: {
          name: section.name,
          gradeLevel: section.gradeLevel,
          schoolYear: section.schoolYear,
          adviserName: section.adviser
            ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}`.trim()
            : null,
        },
        schoolSettings: schoolIdentity,
        year,
      });

      const filename = `SF2_${section.name}_${grid.monthLabel}_${year}.xlsx`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      const buffer = await workbook.xlsx.writeBuffer();
      res.send(Buffer.from(buffer));
    } catch (error: any) {
      logger.error("Error exporting attendance:", error);
      res.status(500).json({ message: "Failed to export attendance" });
    }
  }
);

export default router;
