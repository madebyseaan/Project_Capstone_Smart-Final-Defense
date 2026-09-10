/**
 * ecrImport.ts — Import official E-Class-Record Excel scores into the grade ledger.
 *
 * Mirrors aimsImport.ts architecture:
 *   - The ROUTE owns all guards (ownership, archived, HG, grade locks, current-term).
 *   - This lib receives pre-validated input and does the data work.
 *
 * Semantics: REPLACE the selected term's WW/PT/QA for every matched learner.
 * Learners whose Excel row has no scores at all are skipped (never zeroed out).
 * Grades are ALWAYS recomputed with canonical math — Excel computed cells are ignored.
 */

import { Term, AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { createAuditLog } from "./audit";
import {
  calculateGrades,
  createGradeSnapshot,
  resolveEffectiveWeightsForClassAssignment,
} from "../routes/grades-sub/helpers";
import type { EcrSheetData, EcrTask } from "./ecrParser";

export interface EcrImportReport {
  matched: number;
  savedCount: number;
  unmatched: string[];
  emptySkipped: number;
  specialSkipped: string[];
  overwrittenCount: number;
  warnings: string[];
}

export interface EcrImportInput {
  classAssignmentId: string;
  term: Term;
  parsed: EcrSheetData;
  teacherId: string;
  teacherUserId: string;
  dryRun: boolean;
}

// ─── Name matching ────────────────────────────────────────────────────────────

function normToken(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RosterEntry {
  studentId: string;
  last: string;
  first: string;
}

/**
 * Match an Excel "LAST, FIRST [MIDDLE...]" name to the roster.
 * Handles multi-word first names on either side ("JOHN PAOLO" vs "JOHN"),
 * and middle names/initials present in only one side.
 */
export function findStudentId(excelName: string, roster: RosterEntry[]): string | undefined {
  const idx = excelName.indexOf(",");
  if (idx === -1) return undefined;
  const last = normToken(excelName.slice(0, idx));
  const rest = normToken(excelName.slice(idx + 1));
  if (!last || !rest) return undefined;

  const candidates = roster.filter((r) => r.last === last);
  if (candidates.length === 0) return undefined;

  const first = rest.split(" ")[0];
  const hit = candidates.find(
    (r) =>
      r.first === first ||
      r.first.startsWith(first + " ") ||
      first.startsWith(r.first + " "),
  );
  return hit?.studentId;
}

// ─── Score mapping ────────────────────────────────────────────────────────────

export function buildTasks(
  scores: EcrTask[],
  prefix: "WW" | "PT",
  existing: Array<Record<string, unknown>> = [],
): Array<{ name: string; score: number; maxScore: number; description?: string | null; date?: string | null }> {
  const out: Array<{ name: string; score: number; maxScore: number; description?: string | null; date?: string | null }> = [];
  scores.forEach((t, i) => {
    if (t.maxScore <= 0) return;
    const prev = existing[i];
    const item: { name: string; score: number; maxScore: number; description?: string | null; date?: string | null } = {
      name: (typeof prev?.name === "string" && prev.name.trim()) ? prev.name : `${prefix} ${i + 1}`,
      score: t.score ?? 0,
      maxScore: t.maxScore,
    };
    // Only carry metadata through when it actually exists (keeps round-trips byte-identical).
    if (typeof prev?.description === "string" && prev.description) item.description = prev.description;
    if (typeof prev?.date === "string" && prev.date) item.date = prev.date;
    out.push(item);
  });
  return out;
}

/**
 * Composite QA score that reproduces the template's exam math exactly:
 *   qaScore = round(ST1/max*30, 2) + round(ST2/max*30, 2) + round(TE/max*40, 2), max 100.
 * Returns null when no exam HPS is set.
 */
export function computeQaScore(
  exams: { st1: number | null; st2: number | null; te: number | null },
  hps: EcrSheetData["hps"],
): number | null {
  const parts = [
    { s: exams.st1, max: hps.st1, w: 30 },
    { s: exams.st2, max: hps.st2, w: 30 },
    { s: exams.te, max: hps.te, w: 40 },
  ];
  if (!parts.some((p) => p.max > 0)) return null;
  return parts.reduce((sum, p) => sum + (p.max > 0 ? Math.round(((p.s ?? 0) / p.max) * p.w * 100) / 100 : 0), 0);
}

function gradeHasData(g: { writtenWorkScores: unknown; perfTaskScores: unknown; quarterlyAssessScore: number | null }): boolean {
  const ww = Array.isArray(g.writtenWorkScores) ? (g.writtenWorkScores as Array<Record<string, unknown>>) : [];
  const pt = Array.isArray(g.perfTaskScores) ? (g.perfTaskScores as Array<Record<string, unknown>>) : [];
  return (
    ww.some((i) => Number(i?.score) > 0) ||
    pt.some((i) => Number(i?.score) > 0) ||
    (g.quarterlyAssessScore ?? 0) > 0
  );
}

// ─── Core import ──────────────────────────────────────────────────────────────

export async function importEcrToGrades(input: EcrImportInput): Promise<EcrImportReport> {
  const { classAssignmentId, term, parsed, teacherId, teacherUserId, dryRun } = input;

  const warnings = [...parsed.warnings];

  const emptyReport = (): EcrImportReport => ({
    matched: 0,
    savedCount: 0,
    unmatched: [],
    emptySkipped: 0,
    specialSkipped: [],
    overwrittenCount: 0,
    warnings,
  });

  const classAssignment = await prisma.classAssignment.findUnique({
    where: { id: classAssignmentId },
    include: { subject: true, section: true },
  });
  if (!classAssignment) {
    logger.warn(`[ECR Import] Class assignment ${classAssignmentId} not found`);
    return emptyReport();
  }
  if (parsed.rows.length === 0) return emptyReport();

  // Roster: enrolled learners in this section/year (exclude dropped/transferred)
  const enrollments = await prisma.enrollment.findMany({
    where: { sectionId: classAssignment.sectionId, schoolYear: classAssignment.schoolYear },
    include: { student: { select: { id: true, firstName: true, lastName: true } } },
  });
  const roster: RosterEntry[] = [];
  for (const e of enrollments) {
    if (e.status === "DROPPED" || e.status === "TRANSFERRED") continue;
    roster.push({
      studentId: e.student.id,
      last: normToken(e.student.lastName),
      first: normToken(e.student.firstName),
    });
  }

  const existingGrades = await prisma.grade.findMany({
    where: { classAssignmentId, term },
    select: {
      studentId: true,
      writtenWorkScores: true,
      perfTaskScores: true,
      quarterlyAssessScore: true,
      quarterlyAssessMax: true,
      qaDescription: true,
      qaDate: true,
    },
  });
  const existingMap = new Map(existingGrades.map((g) => [g.studentId, g]));

  // QA preservation rule: if the file has no exam HPS configured, leave the
  // existing QA untouched (teacher hasn't held exams yet).
  const hasExamHps = parsed.hps.st1 > 0 || parsed.hps.st2 > 0 || parsed.hps.te > 0;

  const effectiveWeights = await resolveEffectiveWeightsForClassAssignment(classAssignmentId);
  const user = await prisma.user.findUnique({ where: { id: teacherUserId } });

  interface Prepared {
    studentId: string;
    studentName: string;
    ww: Array<{ name: string; score: number; maxScore: number; description?: string | null; date?: string | null }>;
    pt: Array<{ name: string; score: number; maxScore: number; description?: string | null; date?: string | null }>;
    qaScore: number | null;
    qaMax: number;
    qaDescription: string | null;
    qaDate: string | null;
  }

  const prepared: Prepared[] = [];
  const unmatched: string[] = [];
  let emptySkipped = 0;
  let overwrittenCount = 0;
  let truncatedWW = 0;
  let truncatedPT = 0;

  for (const row of parsed.rows) {
    const studentId = findStudentId(row.name, roster);
    if (!studentId) {
      unmatched.push(row.name);
      continue;
    }

    const existing = existingMap.get(studentId);
    const existingWW = Array.isArray(existing?.writtenWorkScores) ? (existing.writtenWorkScores as Array<Record<string, unknown>>) : [];
    const existingPT = Array.isArray(existing?.perfTaskScores) ? (existing.perfTaskScores as Array<Record<string, unknown>>) : [];
    if (existingWW.length > 5) truncatedWW++;
    if (existingPT.length > 3) truncatedPT++;

    const ww = buildTasks(row.ww, "WW", existingWW);
    const pt = buildTasks(row.pt, "PT", existingPT);

    let qaScore: number | null = null;
    let qaMax = 100;
    const qaDescription: string | null = existing?.qaDescription ?? null;
    const qaDate: string | null = existing?.qaDate ?? null;
    if (hasExamHps) {
      qaScore = computeQaScore(row.exams, parsed.hps);
    } else if (existing && existing.quarterlyAssessScore != null) {
      qaScore = existing.quarterlyAssessScore;
      qaMax = existing.quarterlyAssessMax ?? 100;
    }

    const hasAny = ww.some((t) => t.score > 0) || pt.some((t) => t.score > 0) || (qaScore ?? 0) > 0;
    if (!hasAny) {
      emptySkipped++;
      continue;
    }

    const wasOverwrite = existing ? gradeHasData(existing) : false;
    if (wasOverwrite) overwrittenCount++;

    prepared.push({ studentId, studentName: row.name, ww, pt, qaScore, qaMax, qaDescription, qaDate });
  }

  if (truncatedWW > 0) warnings.push(`The official template supports only 5 WW columns — ${truncatedWW} learner(s) had more and the extras will be removed on import.`);
  if (truncatedPT > 0) warnings.push(`The official template supports only 3 PT columns — ${truncatedPT} learner(s) had more and the extras will be removed on import.`);

  if (dryRun || prepared.length === 0) {
    return {
      matched: prepared.length,
      savedCount: prepared.length,
      unmatched,
      emptySkipped,
      specialSkipped: parsed.specialSkipped,
      overwrittenCount,
      warnings,
    };
  }

  let savedCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of prepared) {
      const calculated = await calculateGrades(
        item.ww,
        item.pt,
        item.qaScore,
        100,
        effectiveWeights.ww,
        effectiveWeights.pt,
        effectiveWeights.qa,
      );

      const existing = existingMap.get(item.studentId);
      const payload = {
        writtenWorkScores: item.ww,
        perfTaskScores: item.pt,
        quarterlyAssessScore: item.qaScore,
        quarterlyAssessMax: item.qaMax,
        qaDescription: item.qaDescription,
        qaDate: item.qaDate,
        writtenWorkPS: calculated.writtenWorkPS,
        perfTaskPS: calculated.perfTaskPS,
        quarterlyAssessPS: calculated.quarterlyAssessPS,
        initialGrade: calculated.initialGrade,
        quarterlyGrade: calculated.quarterlyGrade,
        qualitativeDescriptor: null,
      };

      const grade = await tx.grade.upsert({
        where: { studentId_classAssignmentId_term: { studentId: item.studentId, classAssignmentId, term } },
        update: payload,
        create: { studentId: item.studentId, classAssignmentId, term, ...payload },
      });

      const student = await tx.student.findUnique({
        where: { id: item.studentId },
        select: { firstName: true, lastName: true },
      });

      if (user) {
        await createGradeSnapshot({
          gradeId: grade.id,
          studentId: grade.studentId,
          classAssignmentId: grade.classAssignmentId,
          teacherId,
          subjectCode: classAssignment.subject.code,
          subjectName: classAssignment.subject.name,
          sectionId: classAssignment.sectionId,
          sectionName: classAssignment.section.name,
          schoolYear: classAssignment.schoolYear,
          term: grade.term,
          snapshot: {
            writtenWorkScores: grade.writtenWorkScores,
            perfTaskScores: grade.perfTaskScores,
            quarterlyAssessScore: grade.quarterlyAssessScore,
            quarterlyAssessMax: grade.quarterlyAssessMax,
            qaDescription: grade.qaDescription,
            qaDate: grade.qaDate,
            writtenWorkPS: grade.writtenWorkPS,
            perfTaskPS: grade.perfTaskPS,
            quarterlyAssessPS: grade.quarterlyAssessPS,
            initialGrade: grade.initialGrade,
            quarterlyGrade: grade.quarterlyGrade,
            qualitativeDescriptor: grade.qualitativeDescriptor,
          },
        });
        await createAuditLog(
          existing ? AuditAction.UPDATE : AuditAction.CREATE,
          { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
          `E-Class-Record Import: ${student?.firstName || ""} ${student?.lastName || ""} — ${classAssignment.subject.name} (${term})`,
          "Grades",
          `Imported offline scores (${item.ww.length} WW, ${item.pt.length} PT${item.qaScore !== null ? ", QA" : ""})`,
          undefined,
          AuditSeverity.INFO,
          grade.id,
        );
      }
      savedCount++;
    }
  });

  return {
    matched: prepared.length,
    savedCount,
    unmatched,
    emptySkipped,
    specialSkipped: parsed.specialSkipped,
    overwrittenCount,
    warnings,
  };
}
