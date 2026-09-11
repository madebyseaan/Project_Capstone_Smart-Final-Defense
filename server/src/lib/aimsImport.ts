/**
 * aimsImport.ts — Import AIMS scores into the grade ledger.
 *
 * Extracted from grades-sub/aims.ts so the core logic is testable.
 * The ROUTE keeps all guards (ownership, isActive, HG, locks, current-term).
 * This lib receives pre-validated input and does the data work.
 */

import { Term, AuditAction, AuditSeverity, Prisma } from "@prisma/client";
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
  qaSkippedOccupied: number;
}

export interface ImportInput {
  classAssignmentId: string;
  term: Term;
  assessmentIds?: string[];
  teacherId: string;
  teacherUserId: string;
}

// ---------------------------------------------------------------------------
// Helpers for smart column allocation
// ---------------------------------------------------------------------------

const DEFAULT_NAME_RE = /^((WW|PT)\s*\d+)$/i;

const isFreeItem = (it: any): boolean =>
  !it || (
    (!it.name || DEFAULT_NAME_RE.test(it.name.trim())) &&
    (!it.description || DEFAULT_NAME_RE.test(it.description.trim())) &&
    !it.date &&
    (it.score ?? 0) === 0 &&
    (it.maxScore ?? 10) <= 10 &&
    !it.isAims
  );

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
 *   - Grade edit locks pass (archived -> year -> term; approved edit request bypasses term)
 *   - Current-term or approved edit request for past/future terms
 *
 * Phase 7 changes:
 *   - Includes QA in query (QA imports only when teacher slot is empty)
 *   - Tags imported items with isAims: true + assessmentId
 *   - Smart column allocation: occupies free placeholder slots, never overwrites teacher data
 *   - Selective importedAt stamping: only marks rows actually written
 */
export async function importAimsScoresToGrades(input: ImportInput): Promise<ImportResult> {
  const { classAssignmentId, term, assessmentIds, teacherId, teacherUserId } = input;

  // Fetch class assignment with relations for snapshot/audit
  const classAssignment = await prisma.classAssignment.findUnique({
    where: { id: classAssignmentId },
    include: { subject: true, section: true },
  });
  if (!classAssignment) {
    return { savedCount: 0, skipped: { finalized: 0, notFound: 0, alreadyImported: 0, archived: 0 }, importedAssessments: [], qaSkippedOccupied: 0 };
  }

  // Phase 7: Include QA in the query (QA imports only when teacher slot is empty)
  const aimsWhere: any = { classAssignmentId, term, category: { in: ['WW', 'PT', 'QA'] } };
  if (assessmentIds && assessmentIds.length > 0) aimsWhere.assessmentId = { in: assessmentIds };
  const aimsScores = await prisma.aimsScore.findMany({
    where: aimsWhere,
    include: { student: { select: { id: true } } },
  });

  if (aimsScores.length === 0) {
    return { savedCount: 0, skipped: { finalized: 0, notFound: 0, alreadyImported: 0, archived: 0 }, importedAssessments: [], qaSkippedOccupied: 0 };
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
  let qaSkippedOccupied = 0;
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

  // Phase 7A: Compute global per-category allocation map BEFORE the per-student loop.
  const allGrades = await prisma.grade.findMany({
    where: { classAssignmentId, term },
    select: { studentId: true, writtenWorkScores: true, perfTaskScores: true },
  });

  // Fetch predecessor grades for allocation (students without own grades)
  const allStudentIds = Array.from(scoresByStudent.keys());
  const ownStudentIds = new Set(allGrades.map(g => g.studentId));
  const needsPredIds = allStudentIds.filter(sid => !ownStudentIds.has(sid));
  let predGradesForAlloc: typeof allGrades = [];
  if (needsPredIds.length > 0) {
    const predAssignments = await prisma.classAssignment.findMany({
      where: {
        subjectId: classAssignment.subjectId,
        sectionId: classAssignment.sectionId,
        schoolYear: classAssignment.schoolYear,
        isActive: false,
        id: { not: classAssignmentId },
        grades: { some: {} },
      },
      select: { id: true, archivedAt: true },
      orderBy: { archivedAt: 'desc' },
    });
    if (predAssignments.length > 0) {
      const predIds = predAssignments.map(p => p.id);
      const rawPredGrades = await prisma.grade.findMany({
        where: { classAssignmentId: { in: predIds }, studentId: { in: needsPredIds }, term },
        select: { studentId: true, writtenWorkScores: true, perfTaskScores: true },
        orderBy: { classAssignment: { archivedAt: 'desc' } },
      });
      const seen = new Set<string>();
      for (const pg of rawPredGrades) {
        if (!seen.has(pg.studentId)) { seen.add(pg.studentId); predGradesForAlloc.push(pg); }
      }
    }
  }

  // Build per-student seed map for import (full predecessor rows)
  const predSeedMap = new Map<string, any>();
  if (needsPredIds.length > 0) {
    const predAssignments2 = await prisma.classAssignment.findMany({
      where: {
        subjectId: classAssignment.subjectId,
        sectionId: classAssignment.sectionId,
        schoolYear: classAssignment.schoolYear,
        isActive: false,
        id: { not: classAssignmentId },
        grades: { some: {} },
      },
      select: { id: true, archivedAt: true },
      orderBy: { archivedAt: 'desc' },
    });
    if (predAssignments2.length > 0) {
      const predIds2 = predAssignments2.map(p => p.id);
      const rawSeeds = await prisma.grade.findMany({
        where: { classAssignmentId: { in: predIds2 }, studentId: { in: needsPredIds }, term },
        orderBy: { classAssignment: { archivedAt: 'desc' } },
      });
      for (const sg of rawSeeds) {
        if (!predSeedMap.has(sg.studentId)) predSeedMap.set(sg.studentId, sg);
      }
    }
  }

  const allGradesMerged = [...allGrades, ...predGradesForAlloc];

  const freeIndices = (key: 'writtenWorkScores' | 'perfTaskScores'): number[] => {
    const arrs = allGradesMerged.map(g => (g[key] as any[]) ?? []);
    if (arrs.length === 0) return [];
    const maxLen = Math.max(...arrs.map(a => a.length));
    const free: number[] = [];
    for (let i = 0; i < maxLen; i++) if (arrs.every(a => isFreeItem(a[i]))) free.push(i);
    return free;
  };

  const maxLenOf = (key: 'writtenWorkScores' | 'perfTaskScores'): number =>
    Math.max(0, ...allGradesMerged.map(g => ((g[key] as any[]) ?? []).length));

  const catAssessments = (cat: 'WW' | 'PT'): string[] => {
    const ids = new Set<string>();
    const sorted: { id: string; at: string }[] = [];
    for (const s of aimsScores) {
      if (s.category !== cat || s.importedAt != null) continue;
      if (!ids.has(s.assessmentId)) {
        ids.add(s.assessmentId);
        sorted.push({ id: s.assessmentId, at: s.gradedAt?.toISOString() ?? '' });
      }
    }
    sorted.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    return sorted.map(s => s.id);
  };

  const allocateIndices = (cat: 'WW' | 'PT'): Map<string, number> => {
    const key = cat === 'WW' ? 'writtenWorkScores' : 'perfTaskScores';
    const free = freeIndices(key);
    const assessments = catAssessments(cat);
    const alloc = new Map<string, number>();
    let freeIdx = 0;
    let overflow = maxLenOf(key);
    for (const id of assessments) {
      if (freeIdx < free.length) {
        alloc.set(id, free[freeIdx++]);
      } else {
        alloc.set(id, overflow++);
      }
    }
    return alloc;
  };

  const wwAllocation = allocateIndices('WW');
  const ptAllocation = allocateIndices('PT');

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

      const seedGrade = existingGrade ?? predSeedMap.get(studentId) ?? null;

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

      // Defensive dedupe: skip assessments already in the grade array with isAims
      const existingWW = (seedGrade?.writtenWorkScores as any[] ?? []);
      const existingPT = (seedGrade?.perfTaskScores as any[] ?? []);
      const existingAimsIds = new Set<string>();
      for (const it of [...existingWW, ...existingPT]) {
        if (it?.isAims && it?.assessmentId) existingAimsIds.add(it.assessmentId);
      }

      // Split into WW, PT, QA
      const wwScores = nonImported.filter(s => s.category === "WW" && !existingAimsIds.has(s.assessmentId));
      const ptScores = nonImported.filter(s => s.category === "PT" && !existingAimsIds.has(s.assessmentId));
      const qaScores = nonImported.filter(s => s.category === "QA");

      // Smart column allocation — place items at allocated indices
      const place = (arr: any[], idx: number, item: any | null, cat: 'WW' | 'PT'): any[] => {
        const out = [...arr];
        while (out.length < idx) out.push({ name: `${cat} ${out.length + 1}`, score: 0, maxScore: 0 });
        if (out.length === idx) out.push(item ?? { name: `${cat} ${idx + 1}`, score: 0, maxScore: 0 });
        else if (item) out[idx] = item;
        return out;
      };

      // Place WW items
      let mergedWW = [...existingWW];
      for (const s of wwScores) {
        const targetIdx = wwAllocation.get(s.assessmentId);
        if (targetIdx !== undefined) {
          mergedWW = place(mergedWW, targetIdx, {
            name: s.assessmentTitle,
            score: s.pointsEarned,
            maxScore: s.maxPoints,
            date: s.gradedAt?.toISOString().slice(0, 10) ?? null,
            isAims: true,
            assessmentId: s.assessmentId,
          }, 'WW');
        }
      }

      // Place PT items
      let mergedPT = [...existingPT];
      for (const s of ptScores) {
        const targetIdx = ptAllocation.get(s.assessmentId);
        if (targetIdx !== undefined) {
          mergedPT = place(mergedPT, targetIdx, {
            name: s.assessmentTitle,
            score: s.pointsEarned,
            maxScore: s.maxPoints,
            date: s.gradedAt?.toISOString().slice(0, 10) ?? null,
            isAims: true,
            assessmentId: s.assessmentId,
          }, 'PT');
        }
      }

      // QA import — skip-if-occupied
      let finalQAScore = seedGrade?.quarterlyAssessScore ?? 0;
      let finalQAMax = seedGrade?.quarterlyAssessMax ?? 100;
      let finalQADesc = seedGrade?.qaDescription ?? null;
      let finalQADate = seedGrade?.qaDate ?? null;
      let qaApplied = false;
      const rowsToMark: string[] = [];

      if (qaScores.length > 0) {
        const occupied = (seedGrade?.quarterlyAssessScore ?? 0) > 0;
        if (occupied) {
          qaSkippedOccupied++;
        } else {
          const latest = qaScores.reduce((l, s) => ((s.gradedAt ?? '') >= (l?.gradedAt ?? '') ? s : l), qaScores[0]);
          finalQAScore = latest.pointsEarned;
          finalQAMax = latest.maxPoints;
          finalQADesc = latest.assessmentTitle;
          finalQADate = latest.gradedAt?.toISOString().slice(0, 10) ?? null;
          qaApplied = true;
          rowsToMark.push(latest.id);
          importedAssessmentIds.add(latest.assessmentId);
        }
      }

      // Collect rows to mark for WW/PT
      for (const s of wwScores) {
        if (wwAllocation.has(s.assessmentId)) rowsToMark.push(s.id);
      }
      for (const s of ptScores) {
        if (ptAllocation.has(s.assessmentId)) rowsToMark.push(s.id);
      }

      // Recompute grades (never trust AIMS-computed grades)
      const calculated = await calculateGrades(
        mergedWW, mergedPT,
        finalQAScore, finalQAMax,
        effectiveWeights.ww, effectiveWeights.pt, effectiveWeights.qa,
      );

      const gradePayload = {
        writtenWorkScores: mergedWW,
        perfTaskScores: mergedPT,
        // An imported AIMS QA is a composite — it supersedes any ST1/ST2/TE breakdown.
        examScores: qaApplied ? Prisma.DbNull : undefined,
        quarterlyAssessScore: finalQAScore,
        quarterlyAssessMax: finalQAMax,
        qaDescription: finalQADesc,
        qaDate: finalQADate,
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

      // Selective importedAt stamping — only mark rows actually written
      if (rowsToMark.length > 0) {
        await tx.aimsScore.updateMany({
          where: { id: { in: rowsToMark } },
          data: { importedAt: new Date() },
        });
      }

      for (const s of [...wwScores, ...ptScores]) {
        if (wwAllocation.has(s.assessmentId) || ptAllocation.has(s.assessmentId)) {
          importedAssessmentIds.add(s.assessmentId);
        }
      }

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
          "Grades", `Imported ${rowsToMark.length} AIMS score(s)${qaApplied ? ' (incl. QA)' : ''}`,
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
    qaSkippedOccupied,
  };
}
