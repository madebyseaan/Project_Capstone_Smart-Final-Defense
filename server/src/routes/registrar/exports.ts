import { Router, Request, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { createAuditLog } from "../../lib/audit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import {
  resolveCurrentSchoolYearLabel,
  normalizeDisplaySex,
  computeAgeAsOfJune,
  mapRemarksCodes,
} from "./helpers";

export default function registerExportRoutes(router: Router): void {

// Export SF5 (Report on Promotion) as Excel
router.get("/export/sf5/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const rawSectionId = req.params.sectionId;
    const sectionId = Array.isArray(rawSectionId) ? rawSectionId[0] : rawSectionId;
    if (!sectionId) {
      res.status(400).json({ message: "Section ID is required" });
      return;
    }

    const { schoolYear } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    const { composeSF5 } = await import("../../lib/sf5Composer");
    const data = await composeSF5(sectionId, currentSchoolYear);

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("SF5", {
      pageSetup: { orientation: "landscape", paperSize: 5 }, // Legal
    });

    // Column widths
    sheet.columns = [
      { width: 18 },  // LRN
      { width: 40 },  // Name
      { width: 22 },  // General Average
      { width: 25 },  // Action Taken
      { width: 25 },  // Incomplete Prev SY
      { width: 25 },  // Incomplete Current SY
    ];

    const school = data.schoolSettings;
    const section = data.section;

    // --- Header rows ---
    let row = 1;
    sheet.getRow(row).getCell(1).value = "SF5";
    sheet.getRow(row).getCell(1).font = { bold: true };
    row++;

    sheet.getRow(row).getCell(1).value = "Republic of the Philippines";
    sheet.getRow(row).getCell(1).font = { bold: true };
    sheet.getRow(row).getCell(1).alignment = { horizontal: "center" };
    sheet.mergeCells(row, 1, row, 6);
    row++;

    sheet.getRow(row).getCell(1).value = "Department of Education";
    sheet.getRow(row).getCell(1).font = { bold: true };
    sheet.getRow(row).getCell(1).alignment = { horizontal: "center" };
    sheet.mergeCells(row, 1, row, 6);
    row++;

    sheet.getRow(row).getCell(1).value = `Region ${school.region} • Division ${school.division}`;
    sheet.getRow(row).getCell(1).alignment = { horizontal: "center" };
    sheet.mergeCells(row, 1, row, 6);
    row++;

    row++; // blank row

    sheet.getRow(row).getCell(1).value = "School Form 5 (SF 5)";
    sheet.getRow(row).getCell(1).font = { bold: true, size: 12 };
    sheet.getRow(row).getCell(1).alignment = { horizontal: "center" };
    sheet.mergeCells(row, 1, row, 6);
    row++;

    sheet.getRow(row).getCell(1).value = "Report on Promotion and Learning Progress & Achievement";
    sheet.getRow(row).getCell(1).font = { bold: true };
    sheet.getRow(row).getCell(1).alignment = { horizontal: "center" };
    sheet.mergeCells(row, 1, row, 6);
    row++;

    sheet.getRow(row).getCell(1).value = "(Revised to conform with the instructions of DepEd Order 8, s. 2015)";
    sheet.getRow(row).getCell(1).font = { italic: true };
    sheet.getRow(row).getCell(1).alignment = { horizontal: "center" };
    sheet.mergeCells(row, 1, row, 6);
    row++;

    row++; // blank row

    // School info fields
    sheet.getRow(row).getCell(1).value = "School ID:";
    sheet.getRow(row).getCell(1).font = { bold: true };
    sheet.getRow(row).getCell(2).value = school.schoolId;
    sheet.getRow(row).getCell(4).value = "School Year:";
    sheet.getRow(row).getCell(4).font = { bold: true };
    sheet.getRow(row).getCell(5).value = section.schoolYear;
    row++;

    sheet.getRow(row).getCell(1).value = "District:";
    sheet.getRow(row).getCell(1).font = { bold: true };
    sheet.getRow(row).getCell(2).value = school.district;
    sheet.getRow(row).getCell(4).value = "School Name:";
    sheet.getRow(row).getCell(4).font = { bold: true };
    sheet.getRow(row).getCell(5).value = school.schoolName;
    sheet.mergeCells(row, 5, row, 6);
    row++;

    sheet.getRow(row).getCell(1).value = "Curriculum:";
    sheet.getRow(row).getCell(1).font = { bold: true };
    sheet.getRow(row).getCell(2).value = "K to 12 BEC";
    sheet.getRow(row).getCell(3).value = "Grade Level:";
    sheet.getRow(row).getCell(3).font = { bold: true };
    sheet.getRow(row).getCell(4).value = section.gradeLevel.replace("_", " ");
    sheet.getRow(row).getCell(5).value = "Section:";
    sheet.getRow(row).getCell(5).font = { bold: true };
    sheet.getRow(row).getCell(6).value = section.name;
    row++;

    row++; // blank row

    // --- Column headers ---
    const headerRow = row;
    const headers = ["LRN", "LEARNER'S NAME\n(Last Name, First Name, Middle Name)", "GENERAL AVERAGE", "ACTION TAKEN\n(Promoted, Conditional, or Retained)", "INCOMPLETE SUBJECT/S\n(From previous SY)", "INCOMPLETE SUBJECT/S\n(As of end of current SY)"];
    headers.forEach((h, i) => {
      const cell = sheet.getRow(row).getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    });
    sheet.getRow(row).height = 45;
    row++;

    // --- Helper to write a student row ---
    const writeStudentRow = (student: typeof data.students[0]) => {
      const r = sheet.getRow(row);
      r.getCell(1).value = student.lrn;
      r.getCell(2).value = student.name;
      r.getCell(3).value = student.generalAverage !== null
        ? `${student.generalAverage >= 90 ? student.generalAverage.toFixed(3) : student.generalAverage.toFixed(2)} (${student.descriptor || ""})`
        : "";
      r.getCell(3).alignment = { horizontal: "center" };
      r.getCell(4).value = student.promotionStatus === "Promoted" ? "PROMOTED"
        : student.promotionStatus === "Conditional" ? "*CONDITIONAL"
        : student.promotionStatus === "Retained" ? "RETAINED" : "No Grades";
      r.getCell(4).alignment = { horizontal: "center" };
      r.getCell(5).value = student.incompleteSubjects.prevSY.join(", ");
      r.getCell(5).alignment = { wrapText: true };
      r.getCell(6).value = student.incompleteSubjects.currentSY.join(", ");
      r.getCell(6).alignment = { wrapText: true };

      for (let c = 1; c <= 6; c++) {
        r.getCell(c).border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
      }
      row++;
    };

    // --- Subtotal helper ---
    const writeSubTotal = (label: string, count: number) => {
      const r = sheet.getRow(row);
      r.getCell(1).value = `SUB TOTAL — ${label}:`;
      r.getCell(1).font = { bold: true };
      r.getCell(1).alignment = { horizontal: "right" };
      r.getCell(6).value = count;
      r.getCell(6).font = { bold: true };
      r.getCell(6).alignment = { horizontal: "center" };
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
        r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F3" } };
      }
      row++;
    };

    // --- Male students ---
    const maleStudents = data.students.filter(
      (s: typeof data.students[0]) => s.gender?.toUpperCase() === "MALE" || s.gender?.toUpperCase() === "M"
    );
    const femaleStudents = data.students.filter(
      (s: typeof data.students[0]) => s.gender?.toUpperCase() === "FEMALE" || s.gender?.toUpperCase() === "F"
    );

    maleStudents.forEach(writeStudentRow);
    if (maleStudents.length > 0) writeSubTotal("MALE", maleStudents.length);

    femaleStudents.forEach(writeStudentRow);
    if (femaleStudents.length > 0) writeSubTotal("FEMALE", femaleStudents.length);

    // Grand total
    const totalRow = sheet.getRow(row);
    totalRow.getCell(1).value = "TOTAL:";
    totalRow.getCell(1).font = { bold: true };
    totalRow.getCell(1).alignment = { horizontal: "right" };
    totalRow.getCell(6).value = data.students.length;
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(6).alignment = { horizontal: "center" };
    for (let c = 1; c <= 6; c++) {
      totalRow.getCell(c).border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
      totalRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    }
    row++;

    row++; // blank row

    // --- Summary Table 1: Promotion Status ---
    sheet.getRow(row).getCell(1).value = "SUMMARY TABLE";
    sheet.getRow(row).getCell(1).font = { bold: true };
    row++;

    const sumHeaders = ["STATUS", "MALE", "FEMALE", "TOTAL"];
    const sumHeaderRow = sheet.getRow(row);
    sumHeaders.forEach((h, i) => {
      const cell = sumHeaderRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    });
    row++;

    const sumData = [
      ["PROMOTED", data.summary.male.promoted, data.summary.female.promoted, data.summary.promoted],
      ["*CONDITIONAL", data.summary.male.conditional, data.summary.female.conditional, data.summary.conditional],
      ["RETAINED", data.summary.male.retained, data.summary.female.retained, data.summary.retained],
    ];
    sumData.forEach((rd) => {
      const dataRow = sheet.getRow(row);
      rd.forEach((v, i) => {
        const cell = dataRow.getCell(i + 1);
        cell.value = v;
        cell.alignment = { horizontal: i === 0 ? "left" : "center" };
        cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      });
      row++;
    });

    row++; // blank row

    // --- Summary Table 2: Learning Progress ---
    sheet.getRow(row).getCell(1).value = "LEARNING PROGRESS AND ACHIEVEMENT";
    sheet.getRow(row).getCell(1).font = { bold: true };
    sheet.mergeCells(row, 1, row, 4);
    row++;

    sheet.getRow(row).getCell(1).value = "(Based on Learners' General Average)";
    sheet.getRow(row).getCell(1).font = { italic: true };
    sheet.mergeCells(row, 1, row, 4);
    row++;

    const lpHeaders = ["DESCRIPTORS & GRADING SCALE", "MALE", "FEMALE", "TOTAL"];
    const lpHeaderRow = sheet.getRow(row);
    lpHeaders.forEach((h, i) => {
      const cell = lpHeaderRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    });
    row++;

    const lpData = [
      [`Outstanding (90-100)`, data.summary.descriptors.O.male, data.summary.descriptors.O.female, data.summary.descriptors.O.total],
      [`Very Satisfactory (85-89)`, data.summary.descriptors.VS.male, data.summary.descriptors.VS.female, data.summary.descriptors.VS.total],
      [`Satisfactory (80-84)`, data.summary.descriptors.S.male, data.summary.descriptors.S.female, data.summary.descriptors.S.total],
      [`Fairly Satisfactory (75-79)`, data.summary.descriptors.FS.male, data.summary.descriptors.FS.female, data.summary.descriptors.FS.total],
      [`Did Not Meet Expectations (74 & below)`, data.summary.descriptors.DNME.male, data.summary.descriptors.DNME.female, data.summary.descriptors.DNME.total],
    ];
    lpData.forEach((rd) => {
      const dataRow = sheet.getRow(row);
      rd.forEach((v, i) => {
        const cell = dataRow.getCell(i + 1);
        cell.value = v;
        cell.alignment = { horizontal: i === 0 ? "left" : "center" };
        cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      });
      row++;
    });

    row++; // blank row

    // --- Signature lines ---
    sheet.getRow(row).getCell(1).value = "PREPARED BY:";
    sheet.getRow(row).getCell(1).font = { bold: true };
    sheet.getRow(row).getCell(4).value = "CERTIFIED CORRECT & SUBMITTED:";
    sheet.getRow(row).getCell(4).font = { bold: true };
    row += 2;

    sheet.getRow(row).getCell(1).value = "_________________________";
    sheet.getRow(row).getCell(4).value = "_________________________";
    row++;

    sheet.getRow(row).getCell(1).value = section.adviser || "";
    sheet.getRow(row).getCell(4).value = school.schoolName;
    row++;

    sheet.getRow(row).getCell(1).value = "Class Adviser";
    sheet.getRow(row).getCell(4).value = "School Head";
    row += 2;

    sheet.getRow(row).getCell(1).value = "REVIEWED BY:";
    sheet.getRow(row).getCell(1).font = { bold: true };
    row += 2;

    sheet.getRow(row).getCell(1).value = "_________________________";
    row++;

    sheet.getRow(row).getCell(1).value = "Division Representative";
    row += 2;

    // --- Guidelines ---
    sheet.getRow(row).getCell(1).value = "GUIDELINES:";
    sheet.getRow(row).getCell(1).font = { bold: true };
    sheet.mergeCells(row, 1, row, 6);
    row++;

    const guidelines = [
      "1. Do not include Dropouts and Transferred Out (D.O. 4, s. 2014)",
      "2. To be prepared by the Adviser. The Adviser should indicate the General Average based on the learner's Form 138.",
      "3. On the summary table, reflect the total number of learners PROMOTED (Final Grade of at least 75 in ALL learning areas), RETAINED (Did Not Meet Expectations in three (3) or more learning areas) and *CONDITIONAL (*Did Not Meet Expectations in not more than two (2) learning areas).",
      "4. Did Not Meet Expectations of the Learning Areas. This refers to learning area/s that the learner had failed as of end of current SY.",
      "5. Protocols of validation & submission is under the discretion of the Schools Division Superintendent.",
    ];
    guidelines.forEach((g) => {
      sheet.getRow(row).getCell(1).value = g;
      sheet.mergeCells(row, 1, row, 6);
      row++;
    });

    // --- Page footer ---
    sheet.getRow(row).getCell(1).value = "School Form 5: Page 1 of 1";
    sheet.getRow(row).getCell(1).alignment = { horizontal: "center" };
    sheet.mergeCells(row, 1, row, 6);

    // Send file
    const filename = `SF5_${section.name.replace(/\s+/g, "_")}_${section.schoolYear}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Error exporting SF5:", error);
    res.status(500).json({ message: "Failed to export SF5" });
  }
});

// Export SF1 - School Register (Student Master List) — Real DepEd Template
router.get("/export/sf1/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || (user.role !== "REGISTRAR" && user.role !== "ADMIN")) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    const rawSectionId = req.params.sectionId;
    const sectionId = Array.isArray(rawSectionId) ? rawSectionId[0] : rawSectionId;

    if (!sectionId) {
      res.status(400).json({ message: "Section ID is required" });
      return;
    }

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: {
        enrollments: { where: { status: "ENROLLED" }, include: { student: true } },
        adviser: { include: { user: true } },
      },
    }) as any;

    if (!section) {
      res.status(404).json({ message: "Section not found" });
      return;
    }

    const schoolSettings = await (prisma as any).systemSettings.findUnique({
      where: { id: "main" },
      select: { schoolName: true, schoolId: true, division: true, region: true },
    });

    const schoolYear = section.schoolYear;

    // Helper: prefer snapshot, then live student, then empty
    const field = (snap: Record<string, any> | null, student: any, key: string): any => {
      if (snap && snap[key] !== undefined && snap[key] !== null) return snap[key];
      if (student[key] !== undefined && student[key] !== null) return student[key];
      return null;
    };

    // Build sorted student rows: males first, then females
    const allEnrollments = section.enrollments.map((enrollment: any) => {
      const snap = enrollment.profileSnapshot as Record<string, any> | null;
      const s = enrollment.student;
      const g = (key: string) => field(snap, s, key);
      const birthDate = g("birthDate");
      const gender = normalizeDisplaySex(g("gender"));
      const addr = (key: string) => g(key) || "";

      return {
        lrn: g("lrn") || "",
        lastName: g("lastName") || "",
        firstName: g("firstName") || "",
        middleName: g("middleName") || "",
        suffix: g("suffix") || "",
        birthDate,
        ageAsOfJune: computeAgeAsOfJune(birthDate, schoolYear),
        gender,
        birthPlace: g("province") || "",
        motherTongue: g("motherTongue") || "",
        ip: g("ipCommunity") ? "IP" : "-",
        religion: g("religion") || "-",
        houseStreet: addr("address"),
        barangay: addr("barangay"),
        municipality: addr("city"),
        province: addr("province"),
        fatherName: g("fatherName") || "",
        motherName: g("motherName") || "",
        guardianName: g("guardianName") || "",
        guardianContact: g("guardianContact") || "",
        remarks: mapRemarksCodes(enrollment, s).join(", "),
        _gender: gender,
      };
    });

    const males = allEnrollments.filter((r: any) => r._gender === "Male").sort((a: any, b: any) => a.lastName.localeCompare(b.lastName));
    const females = allEnrollments.filter((r: any) => r._gender === "Female").sort((a: any, b: any) => a.lastName.localeCompare(b.lastName));
    const sortedStudents = [...males, ...females];

    const path = await import("path");
    const ExcelJS = await import("exceljs");

    // Load real SF1 template
    const templatePath = path.resolve(__dirname, "../../../School Form 1 (SF 1) School Register.xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.worksheets[0];

    // === FILL HEADER CELLS (value cells next to labels) ===
    // Row 4: School ID (F4), Region (J4), Division (M4), District (S4)
    sheet.getCell("F4").value = schoolSettings?.schoolId || "";
    sheet.getCell("J4").value = schoolSettings?.region || "";
    sheet.getCell("M4").value = schoolSettings?.division || "";
    sheet.getCell("S4").value = "";
    // Row 6: School Name (F6:K6 merged), School Year (O6:P6 merged), Grade Level (S6:T6 merged), Section (V6:X6 merged)
    sheet.getCell("F6").value = schoolSettings?.schoolName || "";
    sheet.getCell("O6").value = schoolYear;
    sheet.getCell("S6").value = section.gradeLevel.replace("_", " ");
    sheet.getCell("V6").value = section.name;

    // === FILL STUDENT DATA ROWS (rows 10-27, 18 slots) ===
    const STUDENT_START_ROW = 10;
    const MAX_STUDENTS_PER_PAGE = 18;

    const studentsToFill = sortedStudents.slice(0, MAX_STUDENTS_PER_PAGE);

    studentsToFill.forEach((student: any, idx: number) => {
      const row = STUDENT_START_ROW + idx;

      sheet.getCell(`A${row}`).value = idx + 1;
      sheet.getCell(`B${row}`).value = student.lrn;

      const fullName = student.suffix
        ? `${student.lastName}, ${student.firstName} ${student.middleName} ${student.suffix}`
        : `${student.lastName}, ${student.firstName} ${student.middleName}`;
      sheet.getCell(`C${row}`).value = fullName;

      sheet.getCell(`G${row}`).value = student.gender === "Male" ? "M" : "F";

      if (student.birthDate) {
        const bd = new Date(student.birthDate);
        sheet.getCell(`H${row}`).value = `${(bd.getMonth() + 1).toString().padStart(2, "0")}/${bd.getDate().toString().padStart(2, "0")}/${bd.getFullYear()}`;
      }

      sheet.getCell(`I${row}`).value = student.ageAsOfJune;
      sheet.getCell(`J${row}`).value = student.birthPlace;
      sheet.getCell(`K${row}`).value = student.motherTongue;
      sheet.getCell(`L${row}`).value = student.ip;
      sheet.getCell(`M${row}`).value = student.religion;
      sheet.getCell(`N${row}`).value = student.houseStreet;
      sheet.getCell(`O${row}`).value = student.barangay;
      sheet.getCell(`P${row}`).value = student.municipality;
      sheet.getCell(`Q${row}`).value = student.province;
      sheet.getCell(`R${row}`).value = student.fatherName;
      sheet.getCell(`T${row}`).value = student.motherName;
      sheet.getCell(`V${row}`).value = student.guardianName;
      sheet.getCell(`X${row}`).value = student.guardianContact;
      sheet.getCell(`Y${row}`).value = student.remarks;
    });

    // === FILL FOOTER COUNTS ===
    sheet.getCell("Q30").value = males.length;
    sheet.getCell("Q31").value = females.length;
    sheet.getCell("Q32").value = sortedStudents.length;
    sheet.getCell("Q33").value = sortedStudents.length;

    // === WRITE BUFFER ===
    const buffer = await workbook.xlsx.writeBuffer() as unknown as Buffer;

    res.setHeader("Content-Disposition", `attachment; filename="SF1_${section.name}_${schoolYear}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (error: any) {
    logger.error("Error exporting SF1:", error);
    res.status(500).json({ message: "Failed to export school register" });
  }
});

router.get("/export/year-backup", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }
    const schoolYear = (req.query.schoolYear as string) || await resolveCurrentSchoolYearLabel();

    const sections = await prisma.section.findMany({ where: { schoolYear }, orderBy: [{ gradeLevel: "asc" }, { name: "asc" }] });
    const enrollments = await prisma.enrollment.findMany({ where: { schoolYear }, include: { student: true, section: true } });
    const classAssignments = await prisma.classAssignment.findMany({ where: { schoolYear }, include: { subject: true, teacher: { include: { user: true } } } });
    const grades = await prisma.grade.findMany({ where: { classAssignment: { schoolYear } }, include: { classAssignment: { include: { subject: true } } } });
    const attendance = await prisma.attendance.findMany({ where: { section: { schoolYear } } });

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SMART System";

    const sectionSheet = workbook.addWorksheet("Sections");
    sectionSheet.columns = [
      { header: "Section ID", key: "id", width: 36 },
      { header: "Name", key: "name", width: 30 },
      { header: "Grade Level", key: "gradeLevel", width: 15 },
      { header: "Program", key: "program", width: 15 },
      { header: "Status", key: "status", width: 12 },
    ];
    for (const s of sections) {
      sectionSheet.addRow({ id: s.id, name: s.name, gradeLevel: s.gradeLevel, program: s.program, status: s.status });
    }

    const enrollmentSheet = workbook.addWorksheet("Enrollments");
    enrollmentSheet.columns = [
      { header: "Enrollment ID", key: "id", width: 36 },
      { header: "Student ID", key: "studentId", width: 36 },
      { header: "LRN", key: "lrn", width: 15 },
      { header: "Student Name", key: "name", width: 35 },
      { header: "Section", key: "section", width: 25 },
      { header: "Grade Level", key: "gradeLevel", width: 12 },
      { header: "Status", key: "status", width: 12 },
      { header: "Promotion Status", key: "promotionStatus", width: 22 },
      { header: "Promoted To", key: "promotedTo", width: 15 },
    ];
    for (const e of enrollments) {
      enrollmentSheet.addRow({
        id: e.id, studentId: e.studentId, lrn: e.student.lrn,
        name: `${e.student.lastName}, ${e.student.firstName}`,
        section: e.section.name, gradeLevel: e.section.gradeLevel,
        status: e.status, promotionStatus: e.promotionStatus ?? "", promotedTo: e.promotedToGradeLevel ?? "",
      });
    }

    const gradeSheet = workbook.addWorksheet("Grades");
    gradeSheet.columns = [
      { header: "Grade ID", key: "id", width: 36 },
      { header: "Student ID", key: "studentId", width: 36 },
      { header: "Subject", key: "subject", width: 25 },
      { header: "Term", key: "term", width: 8 },
      { header: "Quarterly Grade", key: "qg", width: 15 },
      { header: "Status", key: "status", width: 12 },
    ];
    for (const g of grades) {
      gradeSheet.addRow({
        id: g.id, studentId: g.studentId,
        subject: g.classAssignment.subject.name, term: g.term,
        qg: g.quarterlyGrade ?? "", status: g.status,
      });
    }

    const attendanceSheet = workbook.addWorksheet("Attendance Summary");
    attendanceSheet.columns = [
      { header: "Student ID", key: "studentId", width: 36 },
      { header: "Section", key: "section", width: 25 },
      { header: "Date", key: "date", width: 12 },
      { header: "Status", key: "status", width: 12 },
    ];
    for (const a of attendance) {
      attendanceSheet.addRow({ studentId: a.studentId, section: a.sectionId, date: a.date, status: a.status });
    }

    const buffer = await workbook.xlsx.writeBuffer() as unknown as Buffer;

    await createAuditLog(
      AuditAction.CONFIG,
      user,
      `Year Backup Export: ${schoolYear}`,
      "Export",
      `Exported year backup for ${schoolYear}: ${sections.length} sections, ${enrollments.length} enrollments, ${grades.length} grades`,
      req.ip as string | undefined,
      AuditSeverity.INFO
    );

    res.setHeader("Content-Disposition", `attachment; filename="YearBackup_${schoolYear}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (error: any) {
    logger.error("Error exporting year backup:", error);
    res.status(500).json({ message: "Failed to export year backup" });
  }
});

} // end registerExportRoutes
