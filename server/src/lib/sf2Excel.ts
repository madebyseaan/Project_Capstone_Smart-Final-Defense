/**
 * sf2Excel.ts
 *
 * Builds the DepEd SF2 (Daily Attendance Report of Learners) workbook from a
 * pre-computed `Sf2Grid`. Kept separate from the route so the attendance route
 * stays thin and the layout is testable/reusable.
 */

import ExcelJS from "exceljs";
import type { Sf2Grid } from "./attendanceAggregate";

export interface Sf2WorkbookOptions {
  grid: Sf2Grid;
  section: {
    name: string;
    gradeLevel: string;
    schoolYear: string;
    adviserName?: string | null;
  };
  schoolSettings?: {
    schoolId?: string;
    schoolName?: string;
    division?: string;
    region?: string;
    schoolHeadName?: string;
  } | null;
  year: number;
}

/** 0-based column index -> Excel column letter (A, B, ... Z, AA, AB...). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const THIN = {
  top: { style: "thin" as const },
  left: { style: "thin" as const },
  bottom: { style: "thin" as const },
  right: { style: "thin" as const },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD6EAF8" },
};

export function buildSf2Workbook({
  grid,
  section,
  schoolSettings,
  year,
}: Sf2WorkbookOptions): ExcelJS.Workbook {
  const { schoolDays, groups, dailyPresent, summary, monthLabel } = grid;
  const dayCount = schoolDays.length;

  // ExcelJS cells are 1-based; columnLetter() is 0-based.
  const NAME_COL = 2; // B
  const DAY_START_COL = 3; // C
  const ABSENT_COL = DAY_START_COL + dayCount;
  const TARDY_COL = ABSENT_COL + 1;
  const REMARKS_COL = TARDY_COL + 1;
  const LAST_COL = REMARKS_COL;
  const col = (oneBased: number) => columnLetter(oneBased - 1);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SMART Attendance System";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(monthLabel || "SF2", {
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
    },
  });

  // ── HEADER ────────────────────────────────────────────────────────────
  sheet.getCell("A1").value = "School Form 2 (SF2) - Daily Attendance Report of Learners";
  sheet.getCell("A1").font = { bold: true, size: 12 };
  sheet.mergeCells(`A1:${col(LAST_COL)}1`);
  sheet.getCell("A1").alignment = { horizontal: "center" };

  sheet.getCell("A2").value = `School ID: ${schoolSettings?.schoolId || ""}`;
  sheet.getCell("A3").value = `Name of School: ${schoolSettings?.schoolName || ""}`;
  sheet.getCell("A4").value =
    `School Year: ${section.schoolYear}    Grade Level: ${(section.gradeLevel || "").replace("GRADE_", "")}    Section: ${section.name}`;
  sheet.getCell("A5").value = `Report for the Month of: ${monthLabel} ${year}`;
  sheet.getCell("A5").font = { bold: true };

  // ── COLUMN HEADERS ────────────────────────────────────────────────────
  const headerRow1 = 7;
  const headerRow2 = 8;

  const nameHeader = sheet.getCell(headerRow1, NAME_COL);
  nameHeader.value = "LEARNER'S NAME (Last Name, First Name, Middle Name)";
  sheet.mergeCells(headerRow1, NAME_COL, headerRow2, NAME_COL);
  nameHeader.alignment = { vertical: "middle", horizontal: "center" };
  nameHeader.font = { bold: true, size: 9 };

  sheet.getCell(headerRow1, 1).value = "No.";

  const absentHeader = sheet.getCell(headerRow1, ABSENT_COL);
  absentHeader.value = "Total for the Month";
  sheet.mergeCells(headerRow1, ABSENT_COL, headerRow1, TARDY_COL);
  absentHeader.alignment = { horizontal: "center" };
  absentHeader.font = { bold: true, size: 8 };
  sheet.getCell(headerRow2, ABSENT_COL).value = "ABSENT";
  sheet.getCell(headerRow2, TARDY_COL).value = "TARDY";

  const remarksHeader = sheet.getCell(headerRow1, REMARKS_COL);
  remarksHeader.value = "REMARKS";
  sheet.mergeCells(headerRow1, REMARKS_COL, headerRow2, REMARKS_COL);
  remarksHeader.alignment = { vertical: "middle", horizontal: "center" };
  remarksHeader.font = { bold: true, size: 8 };

  for (let d = 0; d < dayCount; d++) {
    const c = DAY_START_COL + d;
    sheet.getCell(headerRow1, c).value = schoolDays[d].dayNum;
    sheet.getCell(headerRow2, c).value = schoolDays[d].dayLetter;
  }
  for (let c = 1; c <= LAST_COL; c++) {
    for (const r of [headerRow1, headerRow2]) {
      const cell = sheet.getCell(r, c);
      cell.fill = HEADER_FILL;
      cell.font = { bold: true, size: 8 };
      cell.alignment = { horizontal: "center", ...(cell.alignment || {}) };
    }
  }

  // ── ROWS ──────────────────────────────────────────────────────────────
  let row = headerRow2 + 1;
  let counter = 0;

  for (const group of groups) {
    row += 1;
    sheet.getCell(row, 1).value = group.label;
    sheet.mergeCells(row, 1, row, LAST_COL);
    sheet.getCell(row, 1).font = { bold: true, size: 9 };
    sheet.getCell(row, 1).fill = HEADER_FILL;

    for (const student of group.students) {
      row += 1;
      counter += 1;
      sheet.getCell(row, 1).value = counter;
      sheet.getCell(row, 1).alignment = { horizontal: "center" };
      sheet.getCell(row, NAME_COL).value =
        `${student.lastName}, ${student.firstName} ${student.middleName || ""}`.trim().toUpperCase();

      for (let d = 0; d < dayCount; d++) {
        const key = schoolDays[d].date;
        const cell = sheet.getCell(row, DAY_START_COL + d);
        cell.value = student.marks[key] ?? "";
        cell.alignment = { horizontal: "center" };
      }

      sheet.getCell(row, ABSENT_COL).value = student.absent;
      sheet.getCell(row, TARDY_COL).value = student.tardy;
      sheet.getCell(row, REMARKS_COL).value = student.remarks;
      sheet.getCell(row, ABSENT_COL).alignment = { horizontal: "center" };
      sheet.getCell(row, TARDY_COL).alignment = { horizontal: "center" };
    }

    // Per-gender "TOTAL Per Day"
    row += 1;
    sheet.getCell(row, NAME_COL).value = "TOTAL Per Day";
    sheet.getCell(row, NAME_COL).font = { bold: true, size: 8 };
    for (let d = 0; d < dayCount; d++) {
      const key = schoolDays[d].date;
      const count = group.students.reduce((n, s) => n + (s.marks[key] === "x" ? 0 : 1), 0);
      const cell = sheet.getCell(row, DAY_START_COL + d);
      cell.value = count;
      cell.alignment = { horizontal: "center" };
    }
  }

  // Combined TOTAL PER DAY
  row += 1;
  sheet.getCell(row, NAME_COL).value = "Combined TOTAL PER DAY";
  sheet.getCell(row, NAME_COL).font = { bold: true, size: 8 };
  for (let d = 0; d < dayCount; d++) {
    const key = schoolDays[d].date;
    const cell = sheet.getCell(row, DAY_START_COL + d);
    cell.value = dailyPresent[key] ?? 0;
    cell.alignment = { horizontal: "center" };
  }

  // ── BORDERS ───────────────────────────────────────────────────────────
  for (let r = headerRow1; r <= row; r++) {
    for (let c = 1; c <= LAST_COL; c++) {
      sheet.getCell(r, c).border = THIN;
    }
  }

  // ── GUIDELINES + SUMMARY ──────────────────────────────────────────────
  const summaryRow = row + 2;
  const sumLabelCol = ABSENT_COL;
  const sumValueCol = REMARKS_COL;

  sheet.getCell(summaryRow, 1).value = "GUIDELINES:";
  sheet.getCell(summaryRow, 1).font = { bold: true, size: 9 };
  sheet.getCell(summaryRow + 1, 1).value =
    "1. (blank) - Present; (x) - Absent; (/) - Tardy; (E) - Excused. 2. This report covers the month indicated.";
  sheet.getCell(summaryRow + 1, 1).font = { size: 8 };

  const summaryRows: Array<[string, string | number]> = [
    ["No. of Days of Classes:", summary.noOfDaysOfClasses],
    [`Enrolment as of ${monthLabel}:`, ""],
    ["Male:", summary.enrolmentMale],
    ["Female:", summary.enrolmentFemale],
    ["Total:", summary.enrolmentTotal],
    ["Average Daily Attendance:", summary.averageDailyAttendance],
    ["Percentage of Attendance for the month:", `${summary.percentageAttendance}%`],
    ["Number of students absent for 5 consecutive days:", summary.studentsAbsent5Consecutive],
  ];

  summaryRows.forEach(([label, value], i) => {
    sheet.getCell(summaryRow + i, sumLabelCol).value = label;
    sheet.getCell(summaryRow + i, sumLabelCol).font = { bold: i === 0, size: 9 };
    if (value !== "") {
      sheet.getCell(summaryRow + i, sumValueCol).value = value;
      sheet.getCell(summaryRow + i, sumValueCol).font = { size: 9 };
    }
  });

  // ── SIGNATURES ────────────────────────────────────────────────────────
  const sigRow = summaryRow + summaryRows.length + 2;
  sheet.getCell(sigRow, sumLabelCol).value = "________________________";
  sheet.getCell(sigRow + 1, sumLabelCol).value = `Signature of Teacher: ${section.adviserName || ""}`;
  sheet.getCell(sigRow + 1, sumLabelCol).font = { italic: true, size: 8 };

  sheet.getCell(sigRow + 3, sumLabelCol).value = "Attested by:";
  sheet.getCell(sigRow + 3, sumLabelCol).font = { bold: true, size: 9 };
  sheet.getCell(sigRow + 4, sumLabelCol).value = "________________________";
  sheet.getCell(sigRow + 5, sumLabelCol).value =
    `Signature of School Head: ${schoolSettings?.schoolHeadName || ""}`;
  sheet.getCell(sigRow + 5, sumLabelCol).font = { italic: true, size: 8 };

  // ── WIDTHS ────────────────────────────────────────────────────────────
  sheet.getColumn(1).width = 4;
  sheet.getColumn(NAME_COL).width = 32;
  for (let d = 0; d < dayCount; d++) sheet.getColumn(DAY_START_COL + d).width = 4;
  sheet.getColumn(ABSENT_COL).width = 8;
  sheet.getColumn(TARDY_COL).width = 8;
  sheet.getColumn(REMARKS_COL).width = 24;

  return workbook;
}
