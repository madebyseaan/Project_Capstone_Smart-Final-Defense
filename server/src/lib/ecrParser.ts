/**
 * ecrParser.ts — PURE parser for the official DepEd E-Class-Record Excel.
 *
 * No prisma / express imports: takes a workbook buffer, returns structured data.
 * This keeps the parsing logic fully unit-testable (see __tests__/ecr-parser.test.ts).
 *
 * Template layout (verified, identical on TERM 1/2/3):
 *   row 15  : HIGHEST POSSIBLE SCORE  — inputs F15:J15 (WW), N15:P15 (PT), T15/U15/V15 (ST1/ST2/TE)
 *   row 16  : LEARNERS' NAMES
 *   row 17  : MALE
 *   rows 18-67  : 50 male learners   (col C = name)
 *   row 68  : FEMALE
 *   rows 69-118 : 50 female learners
 *   WW score cols F:J (5) · PT score cols N:P (3) · Exam cols T (ST1), U (ST2), V (TE)
 *
 * We read RAW score cells only. Computed columns (K, L, M, Q, R, S, W, X, Y, Z, AA, AB, AC, AD)
 * are intentionally ignored — the system recomputes all grades with canonical math.
 */

import * as XLSX from "xlsx";

export type EcrTerm = "T1" | "T2" | "T3";

export interface EcrTask {
  /** Raw score; null when the cell is blank or holds a non-numeric special mark (A/E). */
  score: number | null;
  /** Highest possible score from row 15; 0 means the task slot is unused. */
  maxScore: number;
}

export interface EcrStudentRow {
  /** Raw name text from column C, trimmed. */
  name: string;
  /** 1-based sheet row. */
  row: number;
  gender: "MALE" | "FEMALE";
  ww: EcrTask[]; // 5 entries (F:J)
  pt: EcrTask[]; // 3 entries (N:P)
  exams: { st1: number | null; st2: number | null; te: number | null };
}

export interface EcrSheetData {
  termSheet: string;
  hps: { ww: number[]; pt: number[]; st1: number; st2: number; te: number };
  rows: EcrStudentRow[];
  warnings: string[];
  /** Names of learners who had at least one non-numeric (A/E) cell that was dropped. */
  specialSkipped: string[];
}

export class EcrParseError extends Error {
  details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "EcrParseError";
    this.details = details;
  }
}

const WW_COLS = ["F", "G", "H", "I", "J"] as const;
const PT_COLS = ["N", "O", "P"] as const;
const EXAM_COLS = { st1: "T", st2: "U", te: "V" } as const;
const MAX_LEARNERS_PER_GENDER = 50;

function cellValue(sheet: XLSX.WorkSheet, addr: string): unknown {
  const cell = sheet[addr];
  return cell ? cell.v : undefined;
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readHps(sheet: XLSX.WorkSheet, addr: string): number {
  const n = toNumberOrNull(cellValue(sheet, addr));
  return n !== null && n > 0 ? n : 0;
}

function findRowByColumnB(sheet: XLSX.WorkSheet, label: string, from: number, to: number): number | null {
  for (let r = from; r <= to; r++) {
    const v = cellValue(sheet, `B${r}`);
    if (typeof v === "string" && v.trim().toUpperCase() === label) return r;
  }
  return null;
}

/**
 * Parse an E-Class-Record workbook for a given term.
 * @throws EcrParseError when the sheet is missing, the layout is unrecognizable, or a score exceeds its HPS.
 */
export function parseEcrWorkbook(buffer: Buffer, term: EcrTerm): EcrSheetData {
  const wb = XLSX.read(buffer, { type: "buffer", cellFormula: false, cellDates: false });

  const wanted = new RegExp(`^TERM\\s*${term[1]}$`, "i");
  const sheetName = wb.SheetNames.find((n) => wanted.test(n.trim()));
  if (!sheetName) {
    throw new EcrParseError(
      `Could not find sheet for ${term}. Expected a sheet named "TERM ${term[1]}".`,
      [`Sheets found: ${wb.SheetNames.join(", ")}`],
    );
  }
  const sheet = wb.Sheets[sheetName];

  // Fallback name source: INPUT DATA (K11..K60 male, N11..N60 female). The TERM
  // sheet name cells are formulas whose cached value is empty until Excel
  // recalculates; reading INPUT DATA makes import robust for any saved file.
  const inputSheet = wb.Sheets["INPUT DATA"];
  const inputName = (col: string, slot: number): string => {
    if (!inputSheet) return "";
    const v = cellValue(inputSheet, `${col}${11 + slot}`);
    return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
  };

  const headerRow = findRowByColumnB(sheet, "LEARNERS' NAMES", 1, 60);
  if (headerRow === null) {
    throw new EcrParseError(
      "Unrecognized E-Class-Record layout: could not find the \"LEARNERS' NAMES\" header.",
      [`Sheet: ${sheetName}`],
    );
  }

  const maleLabelRow = findRowByColumnB(sheet, "MALE", headerRow, headerRow + 5);
  if (maleLabelRow === null) {
    throw new EcrParseError("Unrecognized layout: could not find the MALE label row.", [`Sheet: ${sheetName}`]);
  }
  const femaleLabelRow = findRowByColumnB(sheet, "FEMALE", maleLabelRow + 1, maleLabelRow + MAX_LEARNERS_PER_GENDER + 10);
  if (femaleLabelRow === null) {
    throw new EcrParseError("Unrecognized layout: could not find the FEMALE label row.", [`Sheet: ${sheetName}`]);
  }

  const maleStart = maleLabelRow + 1;
  const maleEnd = femaleLabelRow - 1;
  const femaleStart = femaleLabelRow + 1;
  const femaleEnd = femaleStart + MAX_LEARNERS_PER_GENDER - 1;

  const hps = {
    ww: WW_COLS.map((c) => readHps(sheet, `${c}15`)),
    pt: PT_COLS.map((c) => readHps(sheet, `${c}15`)),
    st1: readHps(sheet, `${EXAM_COLS.st1}15`),
    st2: readHps(sheet, `${EXAM_COLS.st2}15`),
    te: readHps(sheet, `${EXAM_COLS.te}15`),
  };

  const warnings: string[] = [];
  const specialSkipped: string[] = [];
  const errors: string[] = [];

  const parseBlock = (start: number, end: number, gender: "MALE" | "FEMALE"): EcrStudentRow[] => {
    const rows: EcrStudentRow[] = [];
    const inputCol = gender === "MALE" ? "K" : "N";
    for (let r = start; r <= end; r++) {
      const slot = r - start; // 0-based within gender block
      const rawName = cellValue(sheet, `C${r}`);
      let name = typeof rawName === "string" ? rawName.trim() : rawName != null ? String(rawName).trim() : "";
      if (!name) name = inputName(inputCol, slot); // fallback to INPUT DATA
      if (!name) continue;

      let rowHasSpecial = false;
      const readTask = (col: string, maxScore: number): EcrTask => {
        const raw = cellValue(sheet, `${col}${r}`);
        const score = toNumberOrNull(raw);
        if (score === null && raw !== null && raw !== undefined && String(raw).trim() !== "") {
          rowHasSpecial = true;
          warnings.push(`Row ${r} (${name}): non-numeric value "${String(raw)}" in ${col}${r} was ignored.`);
        }
        if (score !== null && maxScore > 0 && score > maxScore) {
          errors.push(`${name} (row ${r}): score ${score} in ${col}${r} exceeds the highest possible score ${maxScore}.`);
        }
        return { score, maxScore };
      };

      const ww = WW_COLS.map((c, i) => readTask(c, hps.ww[i]));
      const pt = PT_COLS.map((c, i) => readTask(c, hps.pt[i]));

      const exams = {
        st1: hps.st1 > 0 ? readTask(EXAM_COLS.st1, hps.st1).score : null,
        st2: hps.st2 > 0 ? readTask(EXAM_COLS.st2, hps.st2).score : null,
        te: hps.te > 0 ? readTask(EXAM_COLS.te, hps.te).score : null,
      };

      if (rowHasSpecial && !specialSkipped.includes(name)) specialSkipped.push(name);
      rows.push({ name, row: r, gender, ww, pt, exams });
    }
    return rows;
  };

  const rows = [...parseBlock(maleStart, maleEnd, "MALE"), ...parseBlock(femaleStart, femaleEnd, "FEMALE")];

  if (errors.length > 0) {
    throw new EcrParseError("Some scores exceed their highest possible score.", errors);
  }

  return { termSheet: sheetName, hps, rows, warnings, specialSkipped };
}
