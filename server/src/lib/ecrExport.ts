/**
 * ecrExport.ts — Generate the official DepEd E-Class-Record Excel pre-filled
 * from the ledger for a class assignment + term.
 *
 * Engine: jszip XML injection into a pristine copy of the official template.
 * This is byte-preserving: formulas, styles, merges, sheet protection, the
 * HELPER table and FINAL GRADES formulas all remain untouched (xlsx-populate
 * was rejected because it drops every formula on round-trip).
 *
 * QA encoding: the template's exam category is 3 sub-tests (ST1/ST2/TE) weighted
 * 30/30/40 via fixed W15/X15/Y15. We encode the ledger's single composite QA so
 * the round trip is EXACT:
 *   T15=30, U15=30, V15=40 (HPS = sub-test weight)
 *   st1 = round(0.3*qa), st2 = round(0.3*qa), te = qa - st1 - st2
 * Template computes Z = st1 + st2 + te = qa, and re-import recomputes the same.
 */

import path from "path";
import fs from "fs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { Term, AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { createAuditLog } from "./audit";

const CORE_TEMPLATE = "E-Class-Record-CORE-Grades-2-10-3Term.xlsx";
const TLE_TEMPLATE = "E-Class-Record-TLE-MAPEH-Grades-2-10-3Term.xlsx";

const INPUT_SHEET = "xl/worksheets/sheet1.xml";
const TERM_SHEET: Record<Term, string> = {
  T1: "xl/worksheets/sheet2.xml",
  T2: "xl/worksheets/sheet3.xml",
  T3: "xl/worksheets/sheet4.xml",
};
const FINAL_GRADES_SHEET = "xl/worksheets/sheet5.xml";

const WW_COLS = ["F", "G", "H", "I", "J"] as const;
const PT_COLS = ["N", "O", "P"] as const;

const MALE_START_ROW = 18;
const FEMALE_START_ROW = 69;
const MAX_PER_GENDER = 50;

function templateDir(): string {
  return path.join(__dirname, "../../assets/ecr");
}

function splitQa(qa: number): { st1: number; st2: number; te: number } {
  const clamped = Math.max(0, Math.min(100, qa));
  const st1 = Math.round(0.3 * clamped);
  const st2 = Math.round(0.3 * clamped);
  const te = clamped - st1 - st2;
  return { st1, st2, te };
}

function byName(a: { student: { lastName: string; firstName: string } }, b: { student: { lastName: string; firstName: string } }): number {
  return `${a.student.lastName}, ${a.student.firstName}`.localeCompare(`${b.student.lastName}, ${b.student.firstName}`);
}

function prettifyGradeLevel(level: string): string {
  return level.replace(/^GRADE_/, "Grade ").replace(/_/g, "-");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Force Excel to recalculate all formulas on open. The template's TERM/FINAL
 * GRADES sheets display school info + student names via formulas whose cached
 * values are empty; without fullCalcOnLoad Excel shows the stale blanks.
 */
function forceFullCalcOnLoad(workbookXml: string): string {
  const re = /<calcPr\b([^>]*?)(\/?)>/;
  return workbookXml.replace(re, (_m, attrs: string, selfClose: string): string => {
    const withFlag = /fullCalcOnLoad=/.test(attrs) ? attrs : `${attrs} fullCalcOnLoad="1"`;
    return `<calcPr${withFlag}${selfClose}>`;
  });
}

/** Inject values into a sheet XML, replacing only the addressed cells. */
function injectCells(xml: string, cells: Record<string, string | number>): string {
  let out = xml;
  for (const [addr, value] of Object.entries(cells)) {
    const re = new RegExp(`<c r="${addr}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    if (!re.test(out)) {
      throw new Error(`ECR export: cell ${addr} not found in template.`);
    }
    out = out.replace(re, (_m, attrs: string): string => {
      if (typeof value === "number") return `<c r="${addr}"${attrs}><v>${value}</v></c>`;
      return `<c r="${addr}"${attrs} t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
    });
  }
  return out;
}

/**
 * Write a CACHED value into a formula cell's <v> slot, keeping the formula intact.
 * Handles regular formulas AND shared formulas (<f t="shared" si="N"> / <f t="shared" si="N"/>).
 * Non-recalculating viewers (Windows preview, some readers) show cached values,
 * so names, school header and FINAL GRADES display correctly even there. Excel
 * still recalculates on open (fullCalcOnLoad) and overwrites the cache.
 * Silently skips cells that don't exist (cache-only, not load-bearing).
 */
function setFormulaCache(xml: string, addr: string, value: string | number): string {
  const re = new RegExp(`(<c r="${addr}"[^>]*>)([\\s\\S]*?)(</c>)`);
  if (!re.test(xml)) return xml;
  return xml.replace(re, (_m, head: string, body: string, tail: string): string => {
    const fMatch = body.match(/<f[^>]*>[\s\S]*?<\/f>|<f[^>]*\/>/);
    const f = fMatch ? fMatch[0] : "";
    let safeHead = head;
    if (typeof value === "number") {
      safeHead = head.replace(/\s+t="str"/, "");
    } else if (!/ t="str"/.test(head)) {
      safeHead = head.replace(/>$/, ' t="str">');
    }
    const v = typeof value === "number" ? `<v>${value}</v>` : `<v>${escapeXml(value)}</v>`;
    return `${safeHead}${f}${v}${tail}`;
  });
}

/** Read the template's HELPER sheet (numerical grade -> descriptor) for FINAL GRADES cache. */
function buildDescriptorMap(templateBuffer: Buffer): Map<number, string> {
  const wb = XLSX.read(templateBuffer, { cellFormula: false });
  const sheet = wb.Sheets["HELPER"];
  const map = new Map<number, string>();
  if (!sheet) return map;
  for (let r = 8; r <= 48; r++) {
    const grade = Number(sheet[`F${r}`]?.v);
    const desc = sheet[`G${r}`]?.v;
    if (Number.isFinite(grade) && typeof desc === "string" && desc.trim()) map.set(grade, desc.trim());
  }
  return map;
}

export async function exportEcrWorkbook(input: {
  classAssignmentId: string;
  term: Term;
}): Promise<{ buffer: Buffer; fileName: string }> {
  const { classAssignmentId, term } = input;

  const ca = await prisma.classAssignment.findUnique({
    where: { id: classAssignmentId },
    include: { subject: true, section: true },
  });
  if (!ca) throw new Error("Class assignment not found");

  const teacher = await prisma.teacher.findUnique({ where: { id: ca.teacherId } });
  const teacherUser = teacher
    ? await prisma.user.findUnique({ where: { id: teacher.userId }, select: { firstName: true, lastName: true } })
    : null;
  const teacherName = teacherUser ? `${teacherUser.firstName ?? ""} ${teacherUser.lastName ?? ""}`.trim() : "";

  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });

  const enrollments = await prisma.enrollment.findMany({
    where: { sectionId: ca.sectionId, schoolYear: ca.schoolYear },
    include: { student: { select: { id: true, firstName: true, lastName: true, gender: true } } },
  });
  const active = enrollments.filter((e) => e.status !== "DROPPED" && e.status !== "TRANSFERRED");
  const males = active.filter((e) => (e.student.gender ?? "").toLowerCase() === "male").sort(byName);
  const females = active.filter((e) => (e.student.gender ?? "").toLowerCase() === "female").sort(byName);

  const grades = await prisma.grade.findMany({ where: { classAssignmentId, term } });
  const gradeByStudent = new Map(grades.map((g) => [g.studentId, g]));

  // All terms — used for FINAL GRADES cached term grades + average
  const allTermGrades = await prisma.grade.findMany({ where: { classAssignmentId } });
  const gradeByKey = new Map(allTermGrades.map((g) => [`${g.studentId}:${g.term}`, g]));

  const templateName = ca.subject.type === "MAPEH" || ca.subject.type === "TLE" ? TLE_TEMPLATE : CORE_TEMPLATE;
  const templatePath = path.join(templateDir(), templateName);
  const templateBuffer = fs.readFileSync(templatePath);
  const descriptorByGrade = buildDescriptorMap(templateBuffer);

  const zip = await JSZip.loadAsync(templateBuffer);

  // ── INPUT DATA ──────────────────────────────────────────────────────────────
  const inputCells: Record<string, string> = {
    E10: settings?.region ?? "",
    E11: settings?.division ?? "",
    E13: settings?.schoolId ?? "",
    E14: settings?.schoolName ?? "",
    E15: ca.schoolYear,
    E16: settings?.schoolHeadName ?? "",
    E23: teacherName,
    E24: ca.subject.name,
    E25: prettifyGradeLevel(String(ca.section.gradeLevel)),
    E26: ca.section.name,
  };
  males.slice(0, MAX_PER_GENDER).forEach((e, i) => { inputCells[`K${11 + i}`] = `${e.student.lastName}, ${e.student.firstName}`; });
  females.slice(0, MAX_PER_GENDER).forEach((e, i) => { inputCells[`N${11 + i}`] = `${e.student.lastName}, ${e.student.firstName}`; });

  const inputXml = await zip.file(INPUT_SHEET)?.async("string");
  if (!inputXml) throw new Error("ECR export: INPUT DATA sheet missing from template.");
  zip.file(INPUT_SHEET, injectCells(inputXml, inputCells));

  // ── TERM sheet ──────────────────────────────────────────────────────────────
  const termCells: Record<string, string | number> = {};

  // Class-wide HPS per WW/PT slot
  const slotMax = (key: "writtenWorkScores" | "perfTaskScores", limit: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < limit; i++) {
      out.push(Math.max(0, ...grades.map((g) => {
        const arr = Array.isArray(g[key]) ? (g[key] as Array<Record<string, unknown>>) : [];
        return Number(arr[i]?.maxScore) || 0;
      })));
    }
    return out;
  };
  const wwMax = slotMax("writtenWorkScores", 5);
  const ptMax = slotMax("perfTaskScores", 3);
  wwMax.forEach((m, i) => { if (m > 0) termCells[`${WW_COLS[i]}15`] = m; });
  ptMax.forEach((m, i) => { if (m > 0) termCells[`${PT_COLS[i]}15`] = m; });

  // Detailed ST1/ST2/TE breakdown (new) takes precedence over the legacy composite QA.
  const hasExamBreakdown = grades.some((g) => Array.isArray((g as any).examScores) && (g as any).examScores.length > 0);
  const hasAnyQA = grades.some((g) => Number(g.quarterlyAssessScore) > 0);
  const EXAM_DEFAULT_HPS = [10, 10, 30];
  if (hasExamBreakdown) {
    const examHps = [0, 0, 0];
    grades.forEach((g) => {
      const es = (g as any).examScores as Array<{ maxScore?: number }> | null;
      if (!Array.isArray(es)) return;
      for (let i = 0; i < 3; i++) examHps[i] = Math.max(examHps[i], Number(es[i]?.maxScore) || 0);
    });
    termCells.T15 = examHps[0] > 0 ? examHps[0] : EXAM_DEFAULT_HPS[0];
    termCells.U15 = examHps[1] > 0 ? examHps[1] : EXAM_DEFAULT_HPS[1];
    termCells.V15 = examHps[2] > 0 ? examHps[2] : EXAM_DEFAULT_HPS[2];
  } else if (hasAnyQA) {
    termCells.T15 = 30;
    termCells.U15 = 30;
    termCells.V15 = 40;
  }

  const writeRow = (studentId: string, row: number): void => {
    const g = gradeByStudent.get(studentId);
    const gWW = Array.isArray(g?.writtenWorkScores) ? (g.writtenWorkScores as Array<Record<string, unknown>>) : [];
    const gPT = Array.isArray(g?.perfTaskScores) ? (g.perfTaskScores as Array<Record<string, unknown>>) : [];

    for (let i = 0; i < 5; i++) {
      if (wwMax[i] > 0) termCells[`${WW_COLS[i]}${row}`] = Number(gWW[i]?.score) || 0;
    }
    for (let i = 0; i < 3; i++) {
      if (ptMax[i] > 0) termCells[`${PT_COLS[i]}${row}`] = Number(gPT[i]?.score) || 0;
    }
    if (hasExamBreakdown) {
      const es = (g as any)?.examScores as Array<{ score?: number }> | null;
      termCells[`T${row}`] = Number(es?.[0]?.score) || 0;
      termCells[`U${row}`] = Number(es?.[1]?.score) || 0;
      termCells[`V${row}`] = Number(es?.[2]?.score) || 0;
    } else if (hasAnyQA) {
      const { st1, st2, te } = splitQa(Number(g?.quarterlyAssessScore) || 0);
      termCells[`T${row}`] = st1;
      termCells[`U${row}`] = st2;
      termCells[`V${row}`] = te;
    }
  };

  males.slice(0, MAX_PER_GENDER).forEach((e, i) => writeRow(e.student.id, MALE_START_ROW + i));
  females.slice(0, MAX_PER_GENDER).forEach((e, i) => writeRow(e.student.id, FEMALE_START_ROW + i));

  // ── All TERM sheets: cached header + names (so non-recalculating previews
  //    show them; Excel recalcs on open regardless) ─────────────────────────────
  const headerValues: Record<string, string> = {
    F5: settings?.region ?? "",
    R5: settings?.division ?? "",
    Z5: settings?.schoolId ?? "",
    F7: settings?.schoolName ?? "",
    Z7: ca.schoolYear,
    J10: prettifyGradeLevel(String(ca.section.gradeLevel)),
    Q10: teacherName,
    AA10: ca.subject.name,
    J11: ca.section.name,
  };
  const termKeys: Term[] = ["T1", "T2", "T3"];
  for (const sheetKey of termKeys) {
    const xml = await zip.file(TERM_SHEET[sheetKey])?.async("string");
    if (!xml) continue;
    let out = xml;
    for (const [addr, val] of Object.entries(headerValues)) out = setFormulaCache(out, addr, val);
    males.slice(0, MAX_PER_GENDER).forEach((e, i) => {
      out = setFormulaCache(out, `C${MALE_START_ROW + i}`, `${e.student.lastName}, ${e.student.firstName}`);
    });
    females.slice(0, MAX_PER_GENDER).forEach((e, i) => {
      out = setFormulaCache(out, `C${FEMALE_START_ROW + i}`, `${e.student.lastName}, ${e.student.firstName}`);
    });
    zip.file(TERM_SHEET[sheetKey], out);
  }

  // ── Selected TERM sheet: scores ──────────────────────────────────────────────
  const termXml = await zip.file(TERM_SHEET[term])?.async("string");
  if (!termXml) throw new Error(`ECR export: sheet ${TERM_SHEET[term]} missing from template.`);
  zip.file(TERM_SHEET[term], injectCells(termXml, termCells));

  // ── FINAL GRADES: cached header + names + term grades + average + descriptor ─
  const fgXml = await zip.file(FINAL_GRADES_SHEET)?.async("string");
  if (fgXml) {
    let out = fgXml;
    const fgHeader: Record<string, string> = {
      D5: settings?.region ?? "",
      G5: settings?.division ?? "",
      J5: settings?.schoolId ?? "",
      D6: settings?.schoolName ?? "",
      J6: ca.schoolYear,
      D9: prettifyGradeLevel(String(ca.section.gradeLevel)),
      I9: ca.subject.name,
      D10: ca.section.name,
      I10: teacherName,
    };
    for (const [addr, val] of Object.entries(fgHeader)) out = setFormulaCache(out, addr, val);

    const writeFgRow = (studentId: string, row: number, name: string): void => {
      out = setFormulaCache(out, `C${row}`, name);
      const t1 = Number(gradeByKey.get(`${studentId}:T1`)?.quarterlyGrade);
      const t2 = Number(gradeByKey.get(`${studentId}:T2`)?.quarterlyGrade);
      const t3 = Number(gradeByKey.get(`${studentId}:T3`)?.quarterlyGrade);
      const terms = [t1, t2, t3].filter((t) => Number.isFinite(t) && t > 0);
      if (terms.length > 0) {
        out = setFormulaCache(out, `F${row}`, t1);
        out = setFormulaCache(out, `G${row}`, t2);
        out = setFormulaCache(out, `H${row}`, t3);
        const avg = Math.round((terms.reduce((a, b) => a + b, 0) / terms.length) * 100) / 100;
        out = setFormulaCache(out, `I${row}`, avg);
        const desc = descriptorByGrade.get(Math.round(avg));
        if (desc) out = setFormulaCache(out, `J${row}`, desc);
      }
    };

    males.slice(0, MAX_PER_GENDER).forEach((e, i) => writeFgRow(e.student.id, 14 + i, `${e.student.lastName}, ${e.student.firstName}`));
    females.slice(0, MAX_PER_GENDER).forEach((e, i) => writeFgRow(e.student.id, 65 + i, `${e.student.lastName}, ${e.student.firstName}`));

    zip.file(FINAL_GRADES_SHEET, out);
  }

  // ── Force recalculation on open + drop stale calc chain ─────────────────────
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (workbookXml) zip.file("xl/workbook.xml", forceFullCalcOnLoad(workbookXml));
  zip.remove("xl/calcChain.xml");

  const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  const fileName = `E-Class-Record-${ca.subject.code}-${prettifyGradeLevel(String(ca.section.gradeLevel))}-${ca.section.name}-${term}.xlsx`;

  // Audit (read-only action; no grade locks apply)
  const user = teacher ? await prisma.user.findUnique({ where: { id: teacher.userId }, select: { id: true, firstName: true, lastName: true, role: true } }) : null;
  if (user) {
    await createAuditLog(
      AuditAction.CREATE,
      user,
      `E-Class-Record Export — ${ca.subject.name} (${term})`,
      "Grades",
      `Downloaded ${fileName}`,
      undefined,
      AuditSeverity.INFO,
    ).catch((err) => logger.warn(`[ECR Export] audit failed: ${err.message}`));
  }

  return { buffer, fileName };
}