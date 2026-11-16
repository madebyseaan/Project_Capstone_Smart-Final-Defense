/**
 * repair-grade-derivations.ts — align stored Grade derived fields with the
 * exam-breakdown rule used by the class record.
 *
 * Default is DRY-RUN. Use --apply to write. Saves an undo report.
 *
 * Protected by default:
 *   - archived grade rows (--include-archived to opt in)
 *   - FINALIZED / LOCKED grade rows (--include-finalized to opt in)
 *
 * Usage:
 *   ts-node --transpile-only scripts/repair-grade-derivations.ts --school-year 2026-2027 --report artifacts/qa-repair.json
 *   ts-node --transpile-only scripts/repair-grade-derivations.ts --school-year 2026-2027 --apply --report artifacts/qa-repair.json
 *   ts-node --transpile-only scripts/repair-grade-derivations.ts --undo artifacts/qa-repair.json
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { prisma } from "../src/lib/prisma";
import { createAuditLog } from "../src/lib/audit";
import { AuditAction, AuditSeverity, GradingMode } from "@prisma/client";
import { getActiveSchoolYearLabel } from "../src/lib/schoolYearResolver";
import { getTransmutationTable } from "../src/lib/transmutationCache";
import { getGradingModeForSchoolYear } from "../src/lib/gradingMode";
import { deriveGradeValues } from "../src/lib/gradeDerivation";
import { resolveEffectiveWeightsForClassAssignment } from "../src/routes/grades-sub/helpers";

interface GradeSnapshotValues {
  writtenWorkPS: number | null;
  perfTaskPS: number | null;
  quarterlyAssessPS: number | null;
  quarterlyAssessScore: number | null;
  quarterlyAssessMax: number | null;
  initialGrade: number | null;
  quarterlyGrade: number | null;
}

interface RepairRow {
  gradeId: string;
  studentId: string;
  classAssignmentId: string;
  sectionId: string;
  schoolYear: string;
  subjectCode: string;
  term: string;
  status: string;
  isArchived: boolean;
  old: GradeSnapshotValues;
  next: GradeSnapshotValues;
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function approx(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= 1e-9;
}

function sameValues(a: GradeSnapshotValues, b: GradeSnapshotValues): boolean {
  return (
    approx(a.writtenWorkPS, b.writtenWorkPS) &&
    approx(a.perfTaskPS, b.perfTaskPS) &&
    approx(a.quarterlyAssessPS, b.quarterlyAssessPS) &&
    approx(a.quarterlyAssessScore, b.quarterlyAssessScore) &&
    approx(a.quarterlyAssessMax, b.quarterlyAssessMax) &&
    approx(a.initialGrade, b.initialGrade) &&
    a.quarterlyGrade === b.quarterlyGrade
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const reportPath = readArg("--report");
  const undoPath = readArg("--undo");
  const includeArchived = process.argv.includes("--include-archived");
  const includeFinalized = process.argv.includes("--include-finalized");
  const schoolYear = readArg("--school-year") ?? (await getActiveSchoolYearLabel());

  if (undoPath) {
    const report = JSON.parse(fs.readFileSync(path.resolve(undoPath), "utf8")) as { rows: RepairRow[] };
    let restored = 0;
    for (const row of report.rows) {
      await prisma.grade.update({ where: { id: row.gradeId }, data: row.old }).catch(() => {});
      restored += 1;
    }
    console.log(`[grade-repair] Restored derived fields on ${restored} grade row(s)`);
    await prisma.$disconnect();
    return;
  }

  const grades = await prisma.grade.findMany({
    where: { classAssignment: { is: { schoolYear } } },
    include: {
      classAssignment: {
        select: {
          id: true,
          sectionId: true,
          schoolYear: true,
          subject: { select: { code: true } },
        },
      },
    },
    orderBy: [{ studentId: "asc" }, { term: "asc" }],
  });

  const weightsCache = new Map<string, { ww: number; pt: number; qa: number }>();
  const modeByYear = new Map<string, GradingMode>();
  const table = await getTransmutationTable();
  const rows: RepairRow[] = [];
  let skippedArchived = 0;
  let skippedFinalized = 0;
  let skippedNoExam = 0;
  let skippedUnrecomputable = 0;

  for (const grade of grades) {
    if (grade.isArchived && !includeArchived) {
      skippedArchived += 1;
      continue;
    }
    if ((grade.status === "FINALIZED" || grade.status === "LOCKED") && !includeFinalized) {
      skippedFinalized += 1;
      continue;
    }

    const examScores = Array.isArray(grade.examScores) ? grade.examScores : [];
    if (examScores.length === 0) {
      skippedNoExam += 1;
      continue;
    }

    let mode = modeByYear.get(grade.classAssignment.schoolYear);
    if (!mode) {
      mode = await getGradingModeForSchoolYear(grade.classAssignment.schoolYear);
      modeByYear.set(grade.classAssignment.schoolYear, mode);
    }

    let weights = weightsCache.get(grade.classAssignmentId);
    if (!weights) {
      const resolved = await resolveEffectiveWeightsForClassAssignment(grade.classAssignmentId);
      weights = { ww: resolved.ww, pt: resolved.pt, qa: resolved.qa };
      weightsCache.set(grade.classAssignmentId, weights);
    }

    const derived = deriveGradeValues(
      {
        writtenWorkScores: grade.writtenWorkScores,
        perfTaskScores: grade.perfTaskScores,
        examScores: grade.examScores,
        quarterlyAssessScore: grade.quarterlyAssessScore,
        quarterlyAssessMax: grade.quarterlyAssessMax,
        storedWrittenWorkPS: grade.writtenWorkPS,
        storedPerfTaskPS: grade.perfTaskPS,
        storedQuarterlyAssessPS: grade.quarterlyAssessPS,
      },
      weights,
      mode,
      table,
    );

    if (
      !derived.hasExamBreakdown ||
      derived.writtenWorkPS === null ||
      derived.perfTaskPS === null ||
      derived.quarterlyAssessPS === null ||
      derived.initialGrade === null ||
      derived.quarterlyGrade === null
    ) {
      skippedUnrecomputable += 1;
      continue;
    }

    const oldValues: GradeSnapshotValues = {
      writtenWorkPS: grade.writtenWorkPS,
      perfTaskPS: grade.perfTaskPS,
      quarterlyAssessPS: grade.quarterlyAssessPS,
      quarterlyAssessScore: grade.quarterlyAssessScore,
      quarterlyAssessMax: grade.quarterlyAssessMax,
      initialGrade: grade.initialGrade,
      quarterlyGrade: grade.quarterlyGrade,
    };
    const nextValues: GradeSnapshotValues = {
      writtenWorkPS: derived.writtenWorkPS,
      perfTaskPS: derived.perfTaskPS,
      quarterlyAssessPS: derived.quarterlyAssessPS,
      quarterlyAssessScore: derived.nextQuarterlyAssessScore,
      quarterlyAssessMax: derived.nextQuarterlyAssessMax,
      initialGrade: derived.initialGrade,
      quarterlyGrade: derived.quarterlyGrade,
    };

    if (sameValues(oldValues, nextValues)) continue;

    rows.push({
      gradeId: grade.id,
      studentId: grade.studentId,
      classAssignmentId: grade.classAssignmentId,
      sectionId: grade.classAssignment.sectionId,
      schoolYear: grade.classAssignment.schoolYear,
      subjectCode: grade.classAssignment.subject.code,
      term: grade.term,
      status: grade.status,
      isArchived: grade.isArchived,
      old: oldValues,
      next: nextValues,
    });
  }

  const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`[grade-repair] Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[grade-repair] School year: ${schoolYear}`);
  console.log(`[grade-repair] Scanned grade rows: ${grades.length}`);
  console.log(`[grade-repair] Rows needing alignment: ${rows.length}`);
  console.log(`[grade-repair] By status: ${JSON.stringify(byStatus)}`);
  console.log(`[grade-repair] Skipped archived=${skippedArchived} finalized/locked=${skippedFinalized} noExam=${skippedNoExam} unrecomputable=${skippedUnrecomputable}`);
  for (const row of rows.slice(0, 20)) {
    console.log(`  - ${row.subjectCode} ${row.term} ${row.status}: quarterly ${row.old.quarterlyGrade} -> ${row.next.quarterlyGrade}, QA PS ${row.old.quarterlyAssessPS} -> ${row.next.quarterlyAssessPS}`);
  }
  if (rows.length > 20) console.log(`  ... ${rows.length - 20} more`);

  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(path.resolve(reportPath), JSON.stringify({
      generatedAt: new Date().toISOString(),
      schoolYear,
      applied: apply,
      includeArchived,
      includeFinalized,
      summary: {
        scanned: grades.length,
        rows: rows.length,
        byStatus,
        skippedArchived,
        skippedFinalized,
        skippedNoExam,
        skippedUnrecomputable,
      },
      rows,
    }, null, 2));
    console.log(`[grade-repair] Report written to ${reportPath}`);
  }

  if (!apply) {
    console.log("[grade-repair] Dry-run only. Re-run with --apply to write.");
    await prisma.$disconnect();
    return;
  }

  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((row) =>
        prisma.grade.update({ where: { id: row.gradeId }, data: row.next }),
      ),
    );
  }

  if (rows.length > 0) {
    await createAuditLog(
      AuditAction.UPDATE,
      { id: null, role: "SYSTEM", firstName: "Grade", lastName: "Repair" },
      "Grades",
      "DATA_REPAIR",
      `Aligned ${rows.length} stored grade row(s) with the exam-breakdown rule for ${schoolYear} (statuses: ${JSON.stringify(byStatus)})`,
      undefined,
      AuditSeverity.WARNING,
    ).catch(() => {});
  }

  console.log(`[grade-repair] Applied: ${rows.length} grade row(s) updated.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[grade-repair] Failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});
