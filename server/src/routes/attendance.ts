import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest, authorizeRoles } from "../middleware/auth";
import type { Attendance, Student, Section, Enrollment } from "@prisma/client";
import ExcelJS from "exceljs";
import templateService from "../services/templateService";
import { logger } from "../lib/logger";
import { validate } from "../middleware/validate";
import { attendanceBulkSchema, attendanceClearSchema } from "../schemas/attendance";

const router = Router();

// Type definitions
type AttendanceWithStudent = Attendance & { student: Student };
type SectionWithDetails = Section & { 
  enrollments: Array<Enrollment & { student: Student }> 
};

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

      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);

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

      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);

      const result = await prisma.attendance.deleteMany({
        where: {
          sectionId,
          date: targetDate,
        },
      });

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

      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);

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

      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

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

// Export attendance to Excel (SF2 Format - Daily Attendance)
router.get(
  "/export/:sectionId",
  authenticateToken,
  authorizeRoles("TEACHER", "ADMIN", "REGISTRAR"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const sectionId = String(req.params.sectionId);
      const monthParam = req.query.month ? parseInt(req.query.month as string) : new Date().getMonth() + 1;
      const yearParam = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();

      if (!Number.isFinite(monthParam) || !Number.isFinite(yearParam) || monthParam < 1 || monthParam > 12) {
        res.status(400).json({ message: "Invalid month or year parameter" });
        return;
      }

      // Get section details
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

      // Fetch school settings
      const schoolSettings = await (prisma as any).systemSettings.findUnique({
        where: { id: "main" },
        select: { schoolName: true, schoolId: true, division: true, region: true },
      });

      // Calculate month range
      const monthStart = new Date(yearParam, monthParam - 1, 1);
      const monthEnd = new Date(yearParam, monthParam, 0); // last day of month

      // Get all attendance records for the month
      const attendanceRecords = await prisma.attendance.findMany({
        where: {
          sectionId,
          date: { gte: monthStart, lte: monthEnd },
        },
        orderBy: { date: "asc" },
      });

      // Build map: studentId -> date -> status
      const attendanceMap = new Map<string, Map<string, string>>();
      for (const record of attendanceRecords) {
        const dateKey = record.date.toISOString().split("T")[0];
        if (!attendanceMap.has(record.studentId)) {
          attendanceMap.set(record.studentId, new Map());
        }
        attendanceMap.get(record.studentId)!.set(dateKey, record.status);
      }

      // Get school days in the month (exclude weekends)
      const schoolDays: Array<{ date: Date; dayNum: number; dayLetter: string }> = [];
      const dayLetters = ["S", "M", "T", "W", "TH", "F", "S"];
      const current = new Date(monthStart);
      while (current <= monthEnd) {
        const dow = current.getDay();
        if (dow !== 0 && dow !== 6) {
          // Skip weekends
          schoolDays.push({
            date: new Date(current),
            dayNum: current.getDate(),
            dayLetter: dayLetters[dow],
          });
        }
        current.setDate(current.getDate() + 1);
      }

      const monthNames = [
        "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
        "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
      ];
      const monthLabel = monthNames[monthParam - 1];

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "SMART Attendance System";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet(monthLabel, {
        pageSetup: {
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          paperSize: 9, // A4
        },
      });

      // ── HEADER SECTION ──────────────────────────────────────────
      // Row 5: School ID, School Year, Report for the Month
      sheet.getCell("B5").value = "School ID";
      sheet.getCell("B5").font = { bold: true, size: 10 };
      sheet.getCell("G5").value = schoolSettings?.schoolId || "";
      sheet.getCell("G5").font = { size: 10 };
      sheet.getCell("M5").value = "School Year";
      sheet.getCell("M5").font = { bold: true, size: 10 };
      sheet.getCell("N5").value = section.schoolYear;
      sheet.getCell("N5").font = { size: 10 };
      sheet.getCell("T5").value = "Report for the";
      sheet.getCell("T5").font = { bold: true, size: 10 };
      sheet.getCell("AA5").value = monthLabel;
      sheet.getCell("AA5").font = { bold: true, size: 10 };

      // Row 6: Name of School, Grade Level, Section
      sheet.getCell("B6").value = "Name of School";
      sheet.getCell("B6").font = { bold: true, size: 10 };
      sheet.getCell("G6").value = schoolSettings?.schoolName || "";
      sheet.getCell("G6").font = { size: 10 };
      sheet.getCell("W6").value = "Grade Level";
      sheet.getCell("W6").font = { bold: true, size: 10 };
      sheet.getCell("AA6").value = section.gradeLevel.replace("GRADE_", "");
      sheet.getCell("AA6").font = { size: 10 };
      sheet.getCell("AC6").value = "Section";
      sheet.getCell("AC6").font = { bold: true, size: 10 };
      sheet.getCell("AE6").value = section.name;
      sheet.getCell("AE6").font = { bold: true, size: 10 };

      // ── COLUMN HEADERS ──────────────────────────────────────────
      // Row 8: Main headers
      sheet.getCell("A8").value = "LEARNER'S NAME";
      sheet.getCell("A8").font = { bold: true, size: 9 };

      // Row 9: Day numbers (starting at column G = index 6)
      // Row 10: Day letters
      const dayStartCol = 6; // Column G
      for (let i = 0; i < schoolDays.length; i++) {
        const colIdx = dayStartCol + i;
        const colLetter = String.fromCharCode(65 + colIdx);

        sheet.getCell(`${colLetter}9`).value = schoolDays[i].dayNum;
        sheet.getCell(`${colLetter}9`).font = { size: 8 };
        sheet.getCell(`${colLetter}9`).alignment = { horizontal: "center" };

        sheet.getCell(`${colLetter}10`).value = schoolDays[i].dayLetter;
        sheet.getCell(`${colLetter}10`).font = { bold: true, size: 8 };
        sheet.getCell(`${colLetter}10`).alignment = { horizontal: "center" };
      }

      // Summary column headers
      const absentCol = String.fromCharCode(65 + dayStartCol + schoolDays.length); // AF
      const presentCol = String.fromCharCode(66 + dayStartCol + schoolDays.length); // AG
      const remarksCol = String.fromCharCode(67 + dayStartCol + schoolDays.length); // AH
      const schoolDaysCol = String.fromCharCode(75 + dayStartCol); // AO
      const schoolDaysValCol = String.fromCharCode(77 + dayStartCol); // AQ

      sheet.getCell(`${absentCol}9`).value = "Total for the Month";
      sheet.getCell(`${absentCol}9`).font = { bold: true, size: 8 };
      sheet.getCell(`${absentCol}10`).value = "ABSENT";
      sheet.getCell(`${absentCol}10`).font = { bold: true, size: 8 };

      sheet.getCell(`${presentCol}10`).value = "PRESENT";
      sheet.getCell(`${presentCol}10`).font = { bold: true, size: 8 };

      sheet.getCell(`${remarksCol}8`).value = "REMARKS (If NLS, state reason, please refer to legend number 2. If TRANSFERRED IN/OUT, write the name of School.)";
      sheet.getCell(`${remarksCol}8`).font = { size: 7 };

      sheet.getCell(`${schoolDaysCol}8`).value = "No of School Days:";
      sheet.getCell(`${schoolDaysCol}8`).font = { bold: true, size: 9 };
      sheet.getCell(`${schoolDaysValCol}8`).value = schoolDays.length;
      sheet.getCell(`${schoolDaysValCol}8`).font = { bold: true, size: 10 };

      // ── STUDENT ROWS ──────────────────────────────────────────
      const students = section.enrollments.map((e) => e.student);
      for (let i = 0; i < students.length; i++) {
        const student = students[i];
        const row = 12 + i; // Start at row 12
        const studentDates = attendanceMap.get(student.id) || new Map();

        // Row number
        sheet.getCell(`A${row}`).value = i + 1;
        sheet.getCell(`A${row}`).font = { size: 9 };
        sheet.getCell(`A${row}`).alignment = { horizontal: "center" };

        // Student name (LAST, FIRST MIDDLE)
        const fullName = `${student.lastName}, ${student.firstName} ${student.middleName || ""}`.toUpperCase();
        sheet.getCell(`B${row}`).value = fullName;
        sheet.getCell(`B${row}`).font = { size: 9 };

        // Attendance marks for each school day
        let absentCount = 0;
        let presentCount = 0;
        for (let d = 0; d < schoolDays.length; d++) {
          const colIdx = dayStartCol + d;
          const colLetter = String.fromCharCode(65 + colIdx);
          const dateKey = schoolDays[d].date.toISOString().split("T")[0];
          const status = studentDates.get(dateKey);

          let mark = ""; // blank = present
          if (status === "ABSENT") {
            mark = "x";
            absentCount++;
          } else if (status === "LATE") {
            mark = "/";
            presentCount++;
          } else if (status === "EXCUSED") {
            mark = "E";
            presentCount++;
          } else {
            // PRESENT or no record (default present)
            presentCount++;
          }

          sheet.getCell(`${colLetter}${row}`).value = mark;
          sheet.getCell(`${colLetter}${row}`).font = { size: 9 };
          sheet.getCell(`${colLetter}${row}`).alignment = { horizontal: "center" };
        }

        // Absent count
        sheet.getCell(`${absentCol}${row}`).value = absentCount;
        sheet.getCell(`${absentCol}${row}`).font = { bold: true, size: 9 };
        sheet.getCell(`${absentCol}${row}`).alignment = { horizontal: "center" };

        // Present count
        sheet.getCell(`${presentCol}${row}`).value = presentCount;
        sheet.getCell(`${presentCol}${row}`).font = { bold: true, size: 9 };
        sheet.getCell(`${presentCol}${row}`).alignment = { horizontal: "center" };
      }

      // ── SUMMARY SECTION (Bottom) ──────────────────────────────
      const summaryStartRow = 12 + students.length + 3;

      // Enrollment stats
      sheet.getCell(`A${summaryStartRow}`).value = "GUIDELINES:";
      sheet.getCell(`A${summaryStartRow}`).font = { bold: true, size: 9 };

      sheet.getCell(`AF${summaryStartRow}`).value = "Month:";
      sheet.getCell(`AF${summaryStartRow}`).font = { bold: true, size: 9 };
      sheet.getCell(`AH${summaryStartRow}`).value = monthLabel;
      sheet.getCell(`AH${summaryStartRow}`).font = { size: 9 };

      sheet.getCell(`AF${summaryStartRow + 1}`).value = "No. of Days of Class:";
      sheet.getCell(`AF${summaryStartRow + 1}`).font = { bold: true, size: 9 };
      sheet.getCell(`AH${summaryStartRow + 1}`).value = schoolDays.length;
      sheet.getCell(`AH${summaryStartRow + 1}`).font = { size: 9 };

      sheet.getCell(`AF${summaryStartRow + 2}`).value = "Enrolment as of " + monthLabel;
      sheet.getCell(`AF${summaryStartRow + 2}`).font = { bold: true, size: 9 };

      sheet.getCell(`AF${summaryStartRow + 3}`).value = "Male";
      sheet.getCell(`AF${summaryStartRow + 3}`).font = { size: 9 };
      const maleCount = students.filter((s) => s.gender?.toUpperCase() === "MALE").length;
      sheet.getCell(`AH${summaryStartRow + 3}`).value = maleCount;
      sheet.getCell(`AH${summaryStartRow + 3}`).font = { size: 9 };

      sheet.getCell(`AF${summaryStartRow + 4}`).value = "Female";
      sheet.getCell(`AF${summaryStartRow + 4}`).font = { size: 9 };
      const femaleCount = students.filter((s) => s.gender?.toUpperCase() === "FEMALE").length;
      sheet.getCell(`AH${summaryStartRow + 4}`).value = femaleCount;
      sheet.getCell(`AH${summaryStartRow + 4}`).font = { size: 9 };

      sheet.getCell(`AF${summaryStartRow + 5}`).value = "Total";
      sheet.getCell(`AF${summaryStartRow + 5}`).font = { bold: true, size: 9 };
      sheet.getCell(`AH${summaryStartRow + 5}`).value = students.length;
      sheet.getCell(`AH${summaryStartRow + 5}`).font = { bold: true, size: 9 };

      // Attendance rate
      const totalAbsentAll = attendanceRecords.filter((r) => r.status === "ABSENT").length;
      const totalPossible = students.length * schoolDays.length;
      const attendanceRate = totalPossible > 0 ? ((totalPossible - totalAbsentAll) / totalPossible * 100).toFixed(2) : "0.00";

      sheet.getCell(`AF${summaryStartRow + 7}`).value = "Average Daily Attendance:";
      sheet.getCell(`AF${summaryStartRow + 7}`).font = { bold: true, size: 9 };
      sheet.getCell(`AH${summaryStartRow + 7}`).value = `${attendanceRate}%`;
      sheet.getCell(`AH${summaryStartRow + 7}`).font = { size: 9 };

      // Signature lines
      const sigRow = summaryStartRow + 10;
      sheet.getCell(`AF${sigRow}`).value = "I certify that this report is correct and accurate.";
      sheet.getCell(`AF${sigRow}`).font = { italic: true, size: 9 };

      sheet.getCell(`AF${sigRow + 2}`).value = "________________________";
      sheet.getCell(`AF${sigRow + 2}`).font = { size: 9 };
      sheet.getCell(`AF${sigRow + 3}`).value = "Signature of Adviser";
      sheet.getCell(`AF${sigRow + 3}`).font = { italic: true, size: 8 };

      sheet.getCell(`AF${sigRow + 5}`).value = "Attested by:";
      sheet.getCell(`AF${sigRow + 5}`).font = { bold: true, size: 9 };

      sheet.getCell(`AF${sigRow + 6}`).value = "________________________";
      sheet.getCell(`AF${sigRow + 6}`).font = { size: 9 };
      sheet.getCell(`AF${sigRow + 7}`).value = "Signature of School Head";
      sheet.getCell(`AF${sigRow + 7}`).font = { italic: true, size: 8 };

      // ── FORMATTING ──────────────────────────────────────────
      // Set column widths
      sheet.getColumn("A").width = 5;   // No.
      sheet.getColumn("B").width = 30;  // Name
      for (let i = 0; i < schoolDays.length; i++) {
        sheet.getColumn(String.fromCharCode(65 + dayStartCol + i)).width = 4; // Day columns
      }
      sheet.getColumn(absentCol).width = 8;   // ABSENT
      sheet.getColumn(presentCol).width = 8;  // PRESENT
      sheet.getColumn(remarksCol).width = 25; // REMARKS

      // Add borders to all cells in the grid
      const lastStudentRow = 12 + students.length - 1;
      const lastDayCol = String.fromCharCode(65 + dayStartCol + schoolDays.length - 1);
      for (let r = 8; r <= lastStudentRow; r++) {
        for (let c = 0; c <= dayStartCol + schoolDays.length + 2; c++) {
          const colLetter = String.fromCharCode(65 + c);
          const cell = sheet.getCell(`${colLetter}${r}`);
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        }
      }

      // Header row styling
      for (let c = 0; c <= dayStartCol + schoolDays.length + 2; c++) {
        const colLetter = String.fromCharCode(65 + c);
        const cell = sheet.getCell(`${colLetter}8`);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFD6EAF8" }, // Light blue
        };
        cell.font = { bold: true, size: 9 };
      }

      // Alternating row colors for student rows
      for (let r = 12; r <= lastStudentRow; r++) {
        if ((r - 12) % 2 === 1) {
          for (let c = 0; c <= dayStartCol + schoolDays.length + 2; c++) {
            const colLetter = String.fromCharCode(65 + c);
            sheet.getCell(`${colLetter}${r}`).fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF8F9FA" }, // Light gray
            };
          }
        }
      }

      // Set response headers
      const filename = `SF2_${section.name}_${monthLabel}_${yearParam}.xlsx`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      // Generate and send buffer
      const buffer = await workbook.xlsx.writeBuffer();
      res.send(Buffer.from(buffer));
    } catch (error: any) {
      logger.error("Error exporting attendance:", error);
      res.status(500).json({ message: "Failed to export attendance" });
    }
  }
);

export default router;
