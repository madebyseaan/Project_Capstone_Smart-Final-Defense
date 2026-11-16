/**
 * backfill-active-assignment-grades.ts — copy stranded grades from an archived
 * predecessor assignment onto the active assignment for the same subject.
 *
 * Fixes the `ACTIVE_ASSIGNMENT_MISSING_GRADES` data-integrity anomaly without
 * changing any grade value. Default dry-run; --apply writes; undo deletes the
 * created rows.
 *
 * Usage:
 *   ts-node --transpile-only scripts/backfill-active-assignment-grades.ts --school-year 2026-2027 --report artifacts/backfill.json
 *   ts-node --transpile-only scripts/backfill-active-assignment-grades.ts --school-year 2026-2027 --apply --report artifacts/backfill.json
 *   ts-node --transpile-only scripts/backfill-active-assignment-grades.ts --undo artifacts/backfill.json
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { prisma } from "../src/lib/prisma";
import { createAuditLog } from "../src/lib/audit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { getActiveSchoolYearLabel } from "../src/lib/schoolYearResolver";

interface BackfillRow {
  activeAssignmentId: string;
  sourceAssignmentId: string;
  sectionName: string;
  subjectCode: string;
  studentId: string;
  term: string;
  quarterlyGrade: number | null;
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const undoPath = readArg("--undo");
  const reportPath = readArg("--report");
  const schoolYear = readArg("--school-year") ?? (await getActiveSchoolYearLabel());

  if (undoPath) {
    const report = JSON.parse(fs.readFileSync(path.resolve(undoPath), "utf8")) as { createdGradeIds: string[] };
    const deleted = await prisma.grade.deleteMany({ where: { id: { in: report.createdGradeIds } } });
    console.log(`[backfill] Undo: deleted ${deleted.count} backfilled grade row(s)`);
    await prisma.$disconnect();
    return;
  }

  const activeAssignments = await prisma.classAssignment.findMany({
    where: { schoolYear, isActive: true },
    include: {
      subject: { select: { id: true, code: true, name: true } },
      section: { select: { id: true, name: true } },
      _count: { select: { grades: true } },
    },
  });

  const rows: BackfillRow[] = [];

  for (const active of activeAssignments) {
    if (active._count.grades > 0) continue;

    const predecessors = await prisma.classAssignment.findMany({
      where: {
        sectionId: active.sectionId,
        schoolYear,
        subjectId: active.subjectId,
        isActive: false,
        id: { not: active.id },
        archivedReason: "ATLAS_STALE_WITH_GRADES",
      },
      include: { grades: true },
      orderBy: { archivedAt: "desc" },
    });
    const withGrades = predecessors.filter((predecessor) => predecessor.grades.length > 0);
    if (withGrades.length === 0) continue;

    for (const predecessor of withGrades) {
      for (const grade of predecessor.grades) {
        const key = `${grade.studentId}:${grade.term}`;
        if (rows.some((row) => row.activeAssignmentId === active.id && `${row.studentId}:${row.term}` === key)) continue;
        rows.push({
          activeAssignmentId: active.id,
          sourceAssignmentId: predecessor.id,
          sectionName: active.section.name,
          subjectCode: active.subject.code,
          studentId: grade.studentId,
          term: grade.term,
          quarterlyGrade: grade.quarterlyGrade,
        });
      }
    }
  }

  console.log(`[backfill] Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[backfill] School year: ${schoolYear}`);
  console.log(`[backfill] Active assignments scanned: ${activeAssignments.length}`);
  console.log(`[backfill] Grade rows to backfill: ${rows.length}`);
  if (rows.length > 0) {
    const byAssignment = rows.reduce<Record<string, number>>((acc, row) => {
      const key = `${row.sectionName}:${row.subjectCode}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`[backfill] By assignment: ${JSON.stringify(byAssignment)}`);
  }

  if (!apply) {
    if (reportPath) {
      fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
      fs.writeFileSync(path.resolve(reportPath), JSON.stringify({ generatedAt: new Date().toISOString(), schoolYear, applied: false, rows, createdGradeIds: [] }, null, 2));
    }
    console.log("[backfill] Dry-run only. Re-run with --apply to write.");
    await prisma.$disconnect();
    return;
  }

  const createdGradeIds: string[] = [];
  for (const row of rows) {
    const source = await prisma.grade.findFirst({
      where: { classAssignmentId: row.sourceAssignmentId, studentId: row.studentId, term: row.term as any },
    });
    if (!source) continue;
    const created = await prisma.grade.create({
      data: {
        studentId: source.studentId,
        classAssignmentId: row.activeAssignmentId,
        term: source.term,
        writtenWorkScores: source.writtenWorkScores as any,
        perfTaskScores: source.perfTaskScores as any,
        examScores: source.examScores as any,
        quarterlyAssessScore: source.quarterlyAssessScore,
        quarterlyAssessMax: source.quarterlyAssessMax,
        qaDescription: source.qaDescription,
        qaDate: source.qaDate,
        writtenWorkPS: source.writtenWorkPS,
        perfTaskPS: source.perfTaskPS,
        quarterlyAssessPS: source.quarterlyAssessPS,
        initialGrade: source.initialGrade,
        quarterlyGrade: source.quarterlyGrade,
        remarks: source.remarks,
        qualitativeDescriptor: source.qualitativeDescriptor,
        status: "DRAFT",
        isArchived: false,
      },
    });
    createdGradeIds.push(created.id);
  }

  if (createdGradeIds.length > 0) {
    await createAuditLog(
      AuditAction.UPDATE,
      { id: null, role: "SYSTEM", firstName: "Grade", lastName: "Backfill" },
      "Grades",
      "DATA_REPAIR",
      `Backfilled ${createdGradeIds.length} grade row(s) from archived predecessor assignments for ${schoolYear}`,
      undefined,
      AuditSeverity.WARNING,
    ).catch(() => {});
  }

  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(path.resolve(reportPath), JSON.stringify({ generatedAt: new Date().toISOString(), schoolYear, applied: true, rows, createdGradeIds }, null, 2));
    console.log(`[backfill] Report written to ${reportPath}`);
  }

  console.log(`[backfill] Applied: ${createdGradeIds.length} grade row(s) created.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[backfill] Failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});
