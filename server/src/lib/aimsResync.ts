/**
 * aimsResync.ts — Detect and apply score changes made in AIMS after import.
 *
 * Import is append-only. This module adds the explicit review/apply path:
 *   computeAimsDrift()  — compare staged AIMS rows with the last imported snapshot
 *   applyAimsUpdates()  — write selected changes into the ledger, recompute, audit
 */

import { Term, AuditAction, AuditSeverity, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { createAuditLog } from "./audit";
import { getGradingModeForSchoolYear } from "./gradingMode";
import {
  calculateGrades,
  createGradeSnapshot,
  resolveEffectiveWeightsForClassAssignment,
} from "../routes/grades-sub/helpers";

type LedgerItem = {
  name: string;
  score: number;
  maxScore: number;
  date?: string | null;
  isAims?: boolean;
  assessmentId?: string;
  [key: string]: unknown;
};

export interface AimsScoreSnapshot {
  pointsEarned: number;
  maxPoints: number;
  attemptNumber: number;
  gradedAt: string | null;
}

export type AimsDriftKind = "changed" | "term_moved";

export interface AimsDriftChange {
  studentId: string;
  studentName: string;
  assessmentId: string;
  assessmentTitle: string;
  category: string;
  type: string;
  term: Term;
  importedTerm: Term | null;
  kind: AimsDriftKind;
  previous: AimsScoreSnapshot | null;
  current: AimsScoreSnapshot;
  ledgerValue: number | null;
  teacherEdited: boolean;
  blockReason: string | null;
}

export interface AimsDriftReport {
  changes: AimsDriftChange[];
  lastSyncedAt: string | null;
  checkedAt: string;
}

export interface AimsResyncInput {
  classAssignmentId: string;
  term: Term;
  changes: Array<{ studentId: string; assessmentId: string }>;
  teacherId: string;
  teacherUserId: string;
}

export interface AimsResyncResult {
  appliedCount: number;
  updatedStudents: number;
  skipped: Array<{ studentId: string; assessmentId: string; reason: string }>;
}

const toSnapshot = (row: {
  pointsEarned: number;
  maxPoints: number;
  attemptNumber: number;
  gradedAt: Date | null;
}): AimsScoreSnapshot => ({
  pointsEarned: row.pointsEarned,
  maxPoints: row.maxPoints,
  attemptNumber: row.attemptNumber,
  gradedAt: row.gradedAt?.toISOString() ?? null,
});

const sameSnapshot = (a: AimsScoreSnapshot, b: AimsScoreSnapshot): boolean =>
  a.pointsEarned === b.pointsEarned &&
  a.maxPoints === b.maxPoints &&
  a.attemptNumber === b.attemptNumber;

const ledgerItemFor = (
  grade: { writtenWorkScores: unknown; perfTaskScores: unknown },
  category: string,
  assessmentId: string,
): LedgerItem | null => {
  const arr = category === "WW" ? grade.writtenWorkScores : category === "PT" ? grade.perfTaskScores : null;
  if (!Array.isArray(arr)) return null;
  return (arr as LedgerItem[]).find((it) => it?.isAims && it?.assessmentId === assessmentId) ?? null;
};

const qaOwnedByAssessment = (
  grade: { qaSource: string | null; qaAssessmentId: string | null },
  assessmentId: string,
): boolean => grade.qaSource === "AIMS" && grade.qaAssessmentId === assessmentId;

const applyDateOf = (row: { gradedAt: Date | null }): string | null =>
  row.gradedAt?.toISOString().slice(0, 10) ?? null;

export async function computeAimsDrift(
  classAssignmentId: string,
  term: Term,
): Promise<AimsDriftReport> {
  const [classAssignment, grades, aimsRows, lastSyncAgg] = await Promise.all([
    prisma.classAssignment.findUnique({
      where: { id: classAssignmentId },
      select: { sectionId: true, schoolYear: true },
    }),
    prisma.grade.findMany({
      where: { classAssignmentId, term },
      select: {
        studentId: true,
        writtenWorkScores: true,
        perfTaskScores: true,
        quarterlyAssessScore: true,
        qaSource: true,
        qaAssessmentId: true,
        status: true,
        isArchived: true,
      },
    }),
    prisma.aimsScore.findMany({
      where: {
        classAssignmentId,
        importedAt: { not: null },
        OR: [{ term }, { importedTerm: term }],
      },
      include: { student: { select: { firstName: true, lastName: true } } },
    }),
    prisma.aimsScore.aggregate({
      where: { classAssignmentId },
      _max: { syncedAt: true },
    }),
  ]);

  const checkedAt = new Date().toISOString();
  const lastSyncedAt = lastSyncAgg._max?.syncedAt?.toISOString() ?? null;
  if (!classAssignment || aimsRows.length === 0) {
    return { changes: [], lastSyncedAt, checkedAt };
  }

  const gradeMap = new Map(grades.map((g) => [g.studentId, g]));

  const studentIds = Array.from(new Set(aimsRows.map((r) => r.studentId)));
  const enrollments = await prisma.enrollment.findMany({
    where: {
      studentId: { in: studentIds },
      sectionId: classAssignment.sectionId,
      schoolYear: classAssignment.schoolYear,
    },
    select: { studentId: true, status: true },
  });
  const enrollmentMap = new Map(enrollments.map((e) => [e.studentId, e.status]));

  const changes: AimsDriftChange[] = [];

  for (const row of aimsRows) {
    const grade = gradeMap.get(row.studentId);
    if (!grade) continue;

    const current = toSnapshot(row);
    const isQa = row.category === "QA";

    if (row.term !== term) {
      if (row.importedTerm !== term) continue;
      changes.push({
        studentId: row.studentId,
        studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
        assessmentId: row.assessmentId,
        assessmentTitle: row.assessmentTitle,
        category: row.category,
        type: row.type,
        term: row.term,
        importedTerm: row.importedTerm,
        kind: "term_moved",
        previous: null,
        current,
        ledgerValue: null,
        teacherEdited: false,
        blockReason: `Moved to ${row.term} in AIMS — import it in ${row.term}`,
      });
      continue;
    }

    const ledgerItem = isQa ? null : ledgerItemFor(grade, row.category, row.assessmentId);
    const qaOwned = isQa && qaOwnedByAssessment(grade, row.assessmentId);
    if (!isQa && !ledgerItem) continue;
    if (isQa && !qaOwned) continue;

    const ledgerValue = isQa ? (grade.quarterlyAssessScore ?? null) : (ledgerItem?.score ?? null);

    const hasStoredBaseline =
      row.importedPointsEarned !== null &&
      row.importedMaxPoints !== null &&
      row.importedAttemptNumber !== null;

    const baseline: AimsScoreSnapshot | null = hasStoredBaseline
      ? {
          pointsEarned: row.importedPointsEarned as number,
          maxPoints: row.importedMaxPoints as number,
          attemptNumber: row.importedAttemptNumber as number,
          gradedAt: row.importedTerm === row.term ? (row.gradedAt?.toISOString() ?? null) : null,
        }
      : ledgerValue !== null
        ? {
            pointsEarned: ledgerValue,
            maxPoints: isQa ? row.maxPoints : ((ledgerItem?.maxScore as number | undefined) ?? row.maxPoints),
            attemptNumber: row.attemptNumber,
            gradedAt: null,
          }
        : null;

    if (!baseline) continue;
    if (sameSnapshot(baseline, current)) continue;

    const teacherEdited = hasStoredBaseline && ledgerValue !== null && ledgerValue !== baseline.pointsEarned;

    let blockReason: string | null = null;
    if (grade.status === "FINALIZED") blockReason = "Grade is finalized";
    else if (grade.isArchived) blockReason = "Grade is archived";
    else {
      const status = enrollmentMap.get(row.studentId);
      if (status === "DROPPED") blockReason = "Student is dropped";
      else if (status === "TRANSFERRED") blockReason = "Student is transferred";
    }

    changes.push({
      studentId: row.studentId,
      studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
      assessmentId: row.assessmentId,
      assessmentTitle: row.assessmentTitle,
      category: row.category,
      type: row.type,
      term: row.term,
      importedTerm: row.importedTerm,
      kind: "changed",
      previous: baseline,
      current,
      ledgerValue,
      teacherEdited,
      blockReason,
    });
  }

  changes.sort(
    (a, b) =>
      a.studentName.localeCompare(b.studentName) ||
      a.assessmentTitle.localeCompare(b.assessmentTitle),
  );

  return { changes, lastSyncedAt, checkedAt };
}

export async function countPendingAimsUpdates(
  classAssignmentId: string,
  term: Term,
): Promise<number> {
  const rows = await prisma.aimsScore.findMany({
    where: {
      classAssignmentId,
      term,
      importedAt: { not: null },
      importedPointsEarned: { not: null },
      importedMaxPoints: { not: null },
      importedAttemptNumber: { not: null },
    },
    select: {
      pointsEarned: true,
      maxPoints: true,
      attemptNumber: true,
      importedPointsEarned: true,
      importedMaxPoints: true,
      importedAttemptNumber: true,
    },
  });

  return rows.filter(
    (r) =>
      r.pointsEarned !== r.importedPointsEarned ||
      r.maxPoints !== r.importedMaxPoints ||
      r.attemptNumber !== r.importedAttemptNumber,
  ).length;
}

export async function applyAimsUpdates(input: AimsResyncInput): Promise<AimsResyncResult> {
  const { classAssignmentId, term, changes: rawChanges, teacherId, teacherUserId } = input;
  const changes = Array.from(
    new Map(rawChanges.map((c) => [`${c.studentId}:${c.assessmentId}`, c])).values(),
  );

  const skipped: AimsResyncResult["skipped"] = [];
  if (changes.length === 0) return { appliedCount: 0, updatedStudents: 0, skipped };

  const classAssignment = await prisma.classAssignment.findUnique({
    where: { id: classAssignmentId },
    include: { subject: true, section: true },
  });
  if (!classAssignment) {
    for (const c of changes) skipped.push({ ...c, reason: "Class assignment not found" });
    return { appliedCount: 0, updatedStudents: 0, skipped };
  }

  const pairs = changes.map((c) => ({ studentId: c.studentId, assessmentId: c.assessmentId }));
  const [rows, user] = await Promise.all([
    prisma.aimsScore.findMany({
      where: {
        classAssignmentId,
        term,
        importedAt: { not: null },
        OR: pairs,
      },
    }),
    prisma.user.findUnique({ where: { id: teacherUserId } }),
  ]);

  const rowMap = new Map(rows.map((r) => [`${r.studentId}:${r.assessmentId}`, r]));
  const studentIds = Array.from(new Set(changes.map((c) => c.studentId)));

  const [grades, enrollments] = await Promise.all([
    prisma.grade.findMany({
      where: { classAssignmentId, term, studentId: { in: studentIds } },
    }),
    prisma.enrollment.findMany({
      where: {
        studentId: { in: studentIds },
        sectionId: classAssignment.sectionId,
        schoolYear: classAssignment.schoolYear,
      },
      select: { studentId: true, status: true },
    }),
  ]);

  const gradeMap = new Map(grades.map((g) => [g.studentId, g]));
  const enrollmentMap = new Map(enrollments.map((e) => [e.studentId, e.status]));

  const effectiveWeights = await resolveEffectiveWeightsForClassAssignment(classAssignmentId);
  const gradingMode = await getGradingModeForSchoolYear(classAssignment.schoolYear);

  let appliedCount = 0;
  let updatedStudents = 0;

  await prisma.$transaction(async (tx) => {
    for (const studentId of studentIds) {
      const grade = gradeMap.get(studentId);
      const studentChanges = changes.filter((c) => c.studentId === studentId);
      if (!grade) {
        for (const c of studentChanges) skipped.push({ ...c, reason: "Grade not found" });
        continue;
      }
      if (grade.status === "FINALIZED") {
        for (const c of studentChanges) skipped.push({ ...c, reason: "Grade is finalized" });
        continue;
      }
      if (grade.isArchived) {
        for (const c of studentChanges) skipped.push({ ...c, reason: "Grade is archived" });
        continue;
      }
      const enrollmentStatus = enrollmentMap.get(studentId);
      if (enrollmentStatus === "DROPPED" || enrollmentStatus === "TRANSFERRED") {
        for (const c of studentChanges) skipped.push({ ...c, reason: `Student is ${enrollmentStatus.toLowerCase()}` });
        continue;
      }

      let mergedWW = [...((grade.writtenWorkScores as LedgerItem[] | null) ?? [])];
      let mergedPT = [...((grade.perfTaskScores as LedgerItem[] | null) ?? [])];
      let qaScore = grade.quarterlyAssessScore ?? 0;
      let qaMax = grade.quarterlyAssessMax ?? 100;
      let qaDesc = grade.qaDescription ?? null;
      let qaDate = grade.qaDate ?? null;
      let qaChanged = false;
      let qaAssessmentId = grade.qaAssessmentId ?? null;
      const appliedRows: typeof rows = [];
      const auditParts: string[] = [];

      for (const c of studentChanges) {
        const row = rowMap.get(`${c.studentId}:${c.assessmentId}`);
        if (!row) {
          skipped.push({ ...c, reason: "AIMS score not found" });
          continue;
        }

        const current = toSnapshot(row);
        const hasStoredBaseline =
          row.importedPointsEarned !== null &&
          row.importedMaxPoints !== null &&
          row.importedAttemptNumber !== null;
        const baseline: AimsScoreSnapshot | null = hasStoredBaseline
          ? {
              pointsEarned: row.importedPointsEarned as number,
              maxPoints: row.importedMaxPoints as number,
              attemptNumber: row.importedAttemptNumber as number,
              gradedAt: null,
            }
          : null;

        if (baseline && sameSnapshot(baseline, current)) {
          skipped.push({ ...c, reason: "No longer changed" });
          continue;
        }

        if (row.category === "QA") {
          if (!qaOwnedByAssessment(grade, row.assessmentId)) {
            skipped.push({ ...c, reason: "TA is not AIMS-sourced" });
            continue;
          }
          const prevScore = qaScore;
          qaScore = row.pointsEarned;
          qaMax = row.maxPoints;
          qaDesc = row.assessmentTitle;
          qaDate = row.gradedAt?.toISOString().slice(0, 10) ?? null;
          qaChanged = true;
          qaAssessmentId = row.assessmentId;
          appliedRows.push(row);
          auditParts.push(`${row.assessmentTitle} (TA) ${prevScore} → ${row.pointsEarned}`);
          continue;
        }

        const target = row.category === "WW" ? mergedWW : row.category === "PT" ? mergedPT : null;
        if (!target) {
          skipped.push({ ...c, reason: `Unsupported category ${row.category}` });
          continue;
        }

        const idx = target.findIndex((it) => it?.isAims && it?.assessmentId === row.assessmentId);
        if (idx < 0) {
          skipped.push({ ...c, reason: "Column not found in ledger" });
          continue;
        }

        const prevScore = target[idx].score ?? 0;
        target[idx] = {
          ...target[idx],
          name: row.assessmentTitle,
          score: row.pointsEarned,
          maxScore: row.maxPoints,
          date: applyDateOf(row),
          isAims: true,
          assessmentId: row.assessmentId,
        };
        if (row.category === "WW") mergedWW = target;
        else mergedPT = target;

        appliedRows.push(row);
        auditParts.push(
          `${row.assessmentTitle} ${prevScore} → ${row.pointsEarned}` +
            (row.maxPoints !== row.importedMaxPoints ? ` (max ${row.importedMaxPoints ?? "?"} → ${row.maxPoints})` : "") +
            (row.attemptNumber !== row.importedAttemptNumber ? ` (attempt ${row.importedAttemptNumber ?? "?"} → ${row.attemptNumber})` : ""),
        );
      }

      if (appliedRows.length === 0) continue;

      const calculated = await calculateGrades(
        mergedWW,
        mergedPT,
        qaScore,
        qaMax,
        effectiveWeights.ww,
        effectiveWeights.pt,
        effectiveWeights.qa,
        gradingMode,
      );

      const gradePayload: Prisma.GradeUpdateInput = {
        writtenWorkScores: mergedWW as any,
        perfTaskScores: mergedPT as any,
        quarterlyAssessScore: qaScore,
        quarterlyAssessMax: qaMax,
        qaDescription: qaDesc,
        qaDate: qaDate,
        writtenWorkPS: calculated.writtenWorkPS,
        perfTaskPS: calculated.perfTaskPS,
        quarterlyAssessPS: calculated.quarterlyAssessPS,
        initialGrade: calculated.initialGrade,
        quarterlyGrade: calculated.quarterlyGrade,
        qualitativeDescriptor: null,
      };
      if (qaChanged) {
        gradePayload.examScores = Prisma.DbNull;
        gradePayload.qaSource = "AIMS";
        gradePayload.qaAssessmentId = qaAssessmentId;
      }

      const updated = await tx.grade.update({
        where: { id: grade.id },
        data: gradePayload,
      });

      for (const row of appliedRows) {
        await tx.aimsScore.update({
          where: { id: row.id },
          data: {
            importedPointsEarned: row.pointsEarned,
            importedMaxPoints: row.maxPoints,
            importedAttemptNumber: row.attemptNumber,
            importedTerm: row.term,
          },
        });
        appliedCount++;
      }
      updatedStudents++;

      const student = await tx.student.findUnique({
        where: { id: studentId },
        select: { firstName: true, lastName: true },
      });

      if (user) {
        await createGradeSnapshot({
          gradeId: updated.id,
          studentId: updated.studentId,
          classAssignmentId: updated.classAssignmentId,
          teacherId,
          subjectCode: classAssignment.subject.code,
          subjectName: classAssignment.subject.name,
          sectionId: classAssignment.sectionId,
          sectionName: classAssignment.section.name,
          schoolYear: classAssignment.schoolYear,
          term: updated.term,
          snapshot: {
            writtenWorkScores: updated.writtenWorkScores,
            perfTaskScores: updated.perfTaskScores,
            quarterlyAssessScore: updated.quarterlyAssessScore,
            quarterlyAssessMax: updated.quarterlyAssessMax,
            qaDescription: updated.qaDescription,
            qaDate: updated.qaDate,
            writtenWorkPS: updated.writtenWorkPS,
            perfTaskPS: updated.perfTaskPS,
            quarterlyAssessPS: updated.quarterlyAssessPS,
            initialGrade: updated.initialGrade,
            quarterlyGrade: updated.quarterlyGrade,
            qualitativeDescriptor: updated.qualitativeDescriptor,
          },
        });
        await createAuditLog(
          AuditAction.UPDATE,
          { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
          `AIMS Resync: ${student?.firstName || ""} ${student?.lastName || ""} — ${classAssignment.subject.name} (${term})`,
          "Grades",
          `Updated ${appliedRows.length} AIMS score(s): ${auditParts.join("; ")}`,
          undefined,
          AuditSeverity.INFO,
          updated.id,
        );
      }
    }
  });

  return { appliedCount, updatedStudents, skipped };
}
