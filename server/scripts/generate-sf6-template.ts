import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";

const BASE_TEMPLATE = path.join(__dirname, "../assets/forms/SF6-official.xlsx");
const OUTPUT_TEMPLATE = path.join(__dirname, "../assets/forms/SF6-Summarized-Report-on-Promotion.xlsx");
const SHEET_NAME = "School Form 6 (SF6)";

const HEADER_PLACEHOLDERS: Array<{ cell: string; token: string }> = [
  { cell: "E5", token: "SCHOOL_ID" },
  { cell: "J5", token: "REGION" },
  { cell: "O5", token: "DIVISION" },
  { cell: "D7", token: "SCHOOL_NAME" },
  { cell: "O7", token: "DISTRICT" },
  { cell: "V7", token: "SCHOOL_YEAR" },
];

interface GradeColumn {
  key: string;
  male: number;
  female: number;
  total: number;
}

const GRADE_COLUMNS: GradeColumn[] = [
  { key: "G7", male: 3, female: 4, total: 5 },
  { key: "G8", male: 6, female: 7, total: 8 },
  { key: "G9", male: 9, female: 10, total: 11 },
  { key: "G10", male: 12, female: 13, total: 14 },
  { key: "TOTAL", male: 21, female: 22, total: 23 },
];

const DATA_ROWS: Array<{ key: string; row: number }> = [
  { key: "PROMOTED", row: 11 },
  { key: "CONDITIONAL", row: 12 },
  { key: "RETAINED", row: 13 },
  { key: "DNME", row: 15 },
  { key: "FS", row: 17 },
  { key: "S", row: 19 },
  { key: "VS", row: 22 },
  { key: "O", row: 24 },
  { key: "TOTAL", row: 26 },
];

async function main(): Promise<void> {
  if (!fs.existsSync(BASE_TEMPLATE)) {
    throw new Error(`Missing official SF6 base template: ${BASE_TEMPLATE}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(BASE_TEMPLATE);

  const worksheet =
    workbook.getWorksheet(SHEET_NAME) ??
    workbook.worksheets.find((sheet) => sheet.name.trim() === SHEET_NAME);

  if (!worksheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in ${BASE_TEMPLATE}`);
  }

  if (worksheet.name !== SHEET_NAME) {
    worksheet.name = SHEET_NAME;
  }

  let placeholderCount = 0;

  for (const { cell, token } of HEADER_PLACEHOLDERS) {
    worksheet.getCell(cell).value = `{{${token}}}`;
    placeholderCount += 1;
  }

  for (const row of DATA_ROWS) {
    for (const grade of GRADE_COLUMNS) {
      worksheet.getCell(row.row, grade.male).value = `{{${grade.key}_${row.key}_M}}`;
      worksheet.getCell(row.row, grade.female).value = `{{${grade.key}_${row.key}_F}}`;
      worksheet.getCell(row.row, grade.total).value = `{{${grade.key}_${row.key}_T}}`;
      placeholderCount += 3;
    }
  }

  await workbook.xlsx.writeFile(OUTPUT_TEMPLATE);

  console.log(`Wrote ${OUTPUT_TEMPLATE}`);
  console.log(`Inserted ${placeholderCount} placeholders into sheet "${SHEET_NAME}"`);
}

main().catch((error) => {
  console.error("Failed to generate SF6 template:", error);
  process.exit(1);
});
