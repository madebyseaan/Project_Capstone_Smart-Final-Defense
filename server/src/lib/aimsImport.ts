/**
 * aimsImport.ts — Import AIMS scores into the grade ledger.
 *
 * Extracted from grades-sub/aims.ts so the core logic is testable.
 * The ROUTE keeps all guards (ownership, isActive, HG, locks, current-term).
 * This lib receives pre-validated input and does the data work.
 */

import { Term, AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { createAuditLog } from "./audit";
import { calculateGrades, createGradeSnapshot, resolveEffectiveWeightsForClassAssignment } from "../routes/grades-sub/helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportResult {
  savedCount: number;
  skipped: {
    finalized: number;
    notFound: number;
    alreadyImported: number;
    archived: number;
  };
  importedAssessments: string[];
}

export interface ImportInput {
  classAssignmentId: string;
  term: Term;
  assessmentIds?: string[];
  teacherId: string;
  teacherUserId: string;
}

// ---------------------------------------------------------------------------
// Core import logic
// ---------------------------------------------------------------------------

/**
 * Import AIMS scores into the grade ledger for a class assignment.
 *
 * Preconditions (enforced by the route, NOT by this function):
 *   - Caller owns the class assignment
 *   - Assignment is active (not archived)
 *   - Subject is not Homeroom Guidance
 *   - Grade edit locks pass (archived → year → term; approved edit request bypasses term)
 *   - Current-term or approved edit request for past/future terms
 *
 * This function does the data work:
 *   - Reads AimsScore rows for the term
 *   - Groups by student
 *   - Per-student: checks FINALIZED, isArchived, importedAt
 *   - Appends AIMS items to existing WW/PT arrays (never overwrites)
 *   - Recomputes grades via calculateGrades
 *   - Upserts Grade in a transaction
 *   - Marks AimsScore.importedAt
 *   - Creates grade snapshots and audit logs
 */
export async function importAimsScoresToGrades(input: ImportInput): Promise<ImportResult> {
  const { classAssignmentId, term, assessmentIds, teacherId, teacherUserId } = input;

  // Fetch class assignment with relations for snapshot/audit
  const classAssignment = await prisma.classAssignment.findUnique({
    where: { id: classAssignmentId },
    include: { subject: true, section: true },
  });
  if (!classAssignment) {
    return { savedCount: 0, skipped: { finalized: 0, notFound: 0, alreadyImported: 0, archived: 0 }, importedAssessments: [] };
  }

  // Fetch AimsScore rows (QA is read-only staging — never import into ledger)
  const aimsWhere: any = { classAssignmentId, term, category: { in: ['WW', 'PT'] } };
  if (assessmentIds && assessmentIds.length > 0) aimsWhere.assessmentId = { in: assessmentIds };
  const aimsScores = await prisma.aimsScore.findMany({
    where: aimsWhere,
    include: { student: { select: { id: true } } },
  });

  if (aimsScores.length === 0) {
    return { savedCount: 0, skipped: { finalized: 0, notFound: 0, alreadyImported: 0, archived: 0 }, importedAssessments: [] };
  }

  // Group by student
  const scoresByStudent = new Map<string, typeof aimsScores>();
  for (const s of aimsScores) {
    if (!scoresByStudent.has(s.studentId)) scoresByStudent.set(s.studentId, []);
    scoresByStudent.get(s.studentId)!.push(s);
  }

  // Resolve effective weights for grade computation
  const effectiveWeights = await resolveEffectiveWeightsForClassAssignment(classAssignmentId);

  let savedCount = 0;
  let finalizedSkipped = 0;
  let notFoundSkipped = 0;
  let alreadyImportedSkipped = 0;
  let archivedSkipped = 0;
  const importedAssessmentIds = new Set<string>();

  // Check enrollments for DROPPED/TRANSFERRED status
  const studentIds = Array.from(scoresByStudent.keys());
  const enrollments = await prisma.enrollment.findMany({
    where: {
      studentId: { in: studentIds },
      sectionId: classAssignment.sectionId,
      schoolYear: classAssignment.schoolYear,
    },
  });
  const enrollmentMap = new Map(enrollments.map(e => [e.studentId, e]));

  // Fetch user for audit logging
  const user = await prisma.user.findUnique({ where: { id: teacherUserId } });

  // Transaction: per-student import
  await prisma.$transaction(async (tx) => {
    for (const [studentId, studentScores] of scoresByStudent) {
      // Skip DROPPED/TRANSFERRED
      const enrollment = enrollmentMap.get(studentId);
      if (enrollment && (enrollment.status === "DROPPED" || enrollment.status === "TRANSFERRED")) {
        notFoundSkipped++;
        continue;
      }

      const existingGrade = await tx.grade.findUnique({
        where: { studentId_classAssignmentId_term: { studentId, classAssignmentId, term } },
      });

      // Skip FINALIZED
      if (existingGrade?.status === "FINALIZED") {
        finalizedSkipped++;
        continue;
      }

      // Skip archived (P0-3: per-student check for post-rollover mixed classes)
      if (existingGrade?.isArchived) {
        archivedSkipped++;
        continue;
      }

      // Filter to non-imported scores only
      const nonImported = studentScores.filter(s => s.importedAt == null);
      if (nonImported.length === 0) {
        alreadyImportedSkipped += studentScores.length;
        continue;
      }

      // Split into WW and PT
      const wwScores = nonImported.filter(s => s.category === "WW");
      const ptScores = nonImported.filter(s => s.category === "PT");
      const existingWW = (existingGrade?.writtenWorkScores as any[] ?? []);
      const existingPT = (existingGrade?.perfTaskScores as any[] ?? []);

      // Append (never overwrite)
      const mergedWW = [...existingWW, ...wwScores.map(s => ({
        name: s.assessmentTitle,
        score: s.pointsEarned,
        maxScore: s.maxPoints,
        date: s.gradedAt?.toISOString().slice(0, 10) ?? null,
      }))];
      const mergedPT = [...existingPT, ...ptScores.map(s => ({
        name: s.assessmentTitle,
        score: s.pointsEarned,
        maxScore: s.maxPoints,
        date: s.gradedAt?.toISOString().slice(0, 10) ?? null,
      }))];

      // Recompute grades (never trust AIMS-computed grades)
      const calculated = await calculateGrades(
        mergedWW, mergedPT,
        existingGrade?.quarterlyAssessScore ?? 0,
        existingGrade?.quarterlyAssessMax || 100,
        effectiveWeights.ww, effectiveWeights.pt, effectiveWeights.qa,
      );

      const gradePayload = {
        writtenWorkScores: mergedWW,
        perfTaskScores: mergedPT,
        quarterlyAssessScore: existingGrade?.quarterlyAssessScore ?? 0,
        quarterlyAssessMax: existingGrade?.quarterlyAssessMax ?? 100,
        qaDescription: existingGrade?.qaDescription ?? null,
        qaDate: existingGrade?.qaDate ?? null,
        writtenWorkPS: calculated.writtenWorkPS,
        perfTaskPS: calculated.perfTaskPS,
        quarterlyAssessPS: calculated.quarterlyAssessPS,
        initialGrade: calculated.initialGrade,
        quarterlyGrade: calculated.quarterlyGrade,
        qualitativeDescriptor: null,
      };

      const grade = await tx.grade.upsert({
        where: { studentId_classAssignmentId_term: { studentId, classAssignmentId, term } },
        update: gradePayload,
        create: { studentId, classAssignmentId, term, ...gradePayload },
      });

      // Mark imported
      await tx.aimsScore.updateMany({
        where: { id: { in: nonImported.map(s => s.id) } },
        data: { importedAt: new Date() },
      });

      for (const s of nonImported) importedAssessmentIds.add(s.assessmentId);

      // Snapshot + audit
      const student = await tx.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true } });
      if (user) {
        await createGradeSnapshot({
          gradeId: grade.id, studentId: grade.studentId, classAssignmentId: grade.classAssignmentId,
          teacherId, subjectCode: classAssignment.subject.code, subjectName: classAssignment.subject.name,
          sectionId: classAssignment.sectionId, sectionName: classAssignment.section.name,
          schoolYear: classAssignment.schoolYear, term: grade.term,
          snapshot: {
            writtenWorkScores: grade.writtenWorkScores, perfTaskScores: grade.perfTaskScores,
            quarterlyAssessScore: grade.quarterlyAssessScore, quarterlyAssessMax: grade.quarterlyAssessMax,
            qaDescription: grade.qaDescription, qaDate: grade.qaDate,
            writtenWorkPS: grade.writtenWorkPS, perfTaskPS: grade.perfTaskPS,
            quarterlyAssessPS: grade.quarterlyAssessPS, initialGrade: grade.initialGrade,
            quarterlyGrade: grade.quarterlyGrade, qualitativeDescriptor: grade.qualitativeDescriptor,
          },
        });
        await createAuditLog(
          existingGrade ? AuditAction.UPDATE : AuditAction.CREATE,
          { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
          `AIMS Import: ${student?.firstName || ""} ${student?.lastName || ""} — ${classAssignment.subject.name} (${term})`,
          "Grades", `Imported ${nonImported.length} AIMS score(s)`,
          undefined, AuditSeverity.INFO, grade.id,
        );
      }
      savedCount++;
    }
  });

  return {
    savedCount,
    skipped: {
      finalized: finalizedSkipped,
      notFound: notFoundSkipped,
      alreadyImported: alreadyImportedSkipped,
      archived: archivedSkipped,
    },
    importedAssessments: Array.from(importedAssessmentIds),
  };
}
