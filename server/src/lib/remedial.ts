/**
 * remedial.ts — Business logic for remedial class management.
 *
 * Remedial records are SMART-local (never pushed to EnrollPro).
 * Per-subject outcomes support the DO 13 §2.1 decision matrix.
 * G10 completers never receive remedial (grades adjusted instead);
 * retained learners repeat the grade level.
 */

import { GradeLevel, PromotionStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { NEXT_GRADE_LEVEL, finalizeSubjectRows, canonicalSubjectKey, PASSING_GRADE } from "./promotion";
import { createAuditLog } from "./audit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { getEnrollProRemedialPending } from "./enrollproClient";
import { logger } from "./logger";
import { computeDisplayName } from "./subjectDisplay";

export const REMEDIAL_PASSING_GRADE = 75;

export interface RemedialRowInput {
  remedialMark: number;
  conductedFrom?: string;
  conductedTo?: string;
}

export interface SubjectOutcome {
  subjectCode: string;
  subjectName: string;
  originalGrade: number;
  rcm: number;
  recomputedGrade: number;
  outcome: string;
}

export interface RemedialCompleteResult {
  enrollmentId: string;
  previousStatus: PromotionStatus | null;
  newStatus: PromotionStatus;
  newGradeLevel: GradeLevel | null;
  subjectOutcomes: SubjectOutcome[];
}

export function computeRfg(originalGrade: number, rcm: number): number {
  return Math.round(((originalGrade + rcm) / 2) * 10) / 10;
}

export function determineOutcome(recomputedGrade: number): string {
  return recomputedGrade >= REMEDIAL_PASSING_GRADE ? "PASSED" : "FAILED_TUTORIAL";
}

export async function completeRemedial(
  enrollmentId: string,
  actor: { id: string; name: string; role: string },
  opts?: { retentionOverride?: boolean; conductedFrom?: string; conductedTo?: string }
): Promise<RemedialCompleteResult> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      student: true,
      section: true,
      remedialClasses: { where: { status: "PENDING" } },
    },
  });

  if (!enrollment) throw new Error("ENROLLMENT_NOT_FOUND");
  if (enrollment.promotionStatus !== "CONDITIONALLY_PROMOTED") {
    throw new Error("ENROLLMENT_NOT_CONDITIONALLY_PROMOTED");
  }
  if (enrollment.remedialClasses.length === 0) {
    throw new Error("NO_PENDING_REMEDIAL_RECORDS");
  }

  const subjectOutcomes: SubjectOutcome[] = [];
  let allPassed = true;

  for (const rc of enrollment.remedialClasses) {
    if (rc.remedialMark === null) {
      throw new Error(`MISSING_RCM: ${rc.subjectName}`);
    }

    const rfg = computeRfg(rc.originalGrade, rc.remedialMark);
    const outcome = determineOutcome(rfg);
    if (outcome !== "PASSED") allPassed = false;

    subjectOutcomes.push({
      subjectCode: rc.subjectCode,
      subjectName: rc.subjectName,
      originalGrade: rc.originalGrade,
      rcm: rc.remedialMark,
      recomputedGrade: rfg,
      outcome,
    });
  }

  const failedGradeLevel = enrollment.remedialClasses[0]?.gradeLevel ?? enrollment.section.gradeLevel;

  let newStatus: PromotionStatus;
  let newGradeLevel: GradeLevel | null;

  if (allPassed) {
    newStatus = "PROMOTED";
    newGradeLevel = NEXT_GRADE_LEVEL[failedGradeLevel] ?? failedGradeLevel;
  } else if (opts?.retentionOverride) {
    newStatus = "RETAINED";
    newGradeLevel = failedGradeLevel;
  } else {
    newStatus = "CONDITIONALLY_PROMOTED";
    newGradeLevel = NEXT_GRADE_LEVEL[failedGradeLevel] ?? failedGradeLevel;
  }

  const previousStatus = enrollment.promotionStatus;

  await prisma.$transaction(async (tx) => {
    for (const so of subjectOutcomes) {
      const rcRecord = enrollment.remedialClasses.find(r => r.subjectCode === so.subjectCode);
      if (!rcRecord) continue;
      await tx.remedialClass.update({
        where: { id: rcRecord.id },
        data: {
          remedialMark: so.rcm,
          recomputedGrade: so.recomputedGrade,
          outcome: so.outcome,
          status: "COMPLETED",
          // Stamp conducted dates at completion so SF10 never ends up blank
          ...(opts?.conductedFrom ? { conductedFrom: new Date(`${opts.conductedFrom}T00:00:00.000Z`) } : {}),
          ...(opts?.conductedTo ? { conductedTo: new Date(`${opts.conductedTo}T00:00:00.000Z`) } : {}),
        },
      });
    }

    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
        promotionStatus: newStatus,
        promotedToGradeLevel: newGradeLevel,
      },
    });
  });

  await createAuditLog(
    AuditAction.UPDATE,
    actor,
    `Remedial Complete: ${enrollment.student.lastName}, ${enrollment.student.firstName}`,
    "RemedialClass",
    `Completed remedial for enrollment ${enrollmentId}: ${previousStatus} -> ${newStatus}. ` +
    `${subjectOutcomes.length} subject(s): ${subjectOutcomes.map(o => `${o.subjectName} RFG=${o.recomputedGrade} (${o.outcome})`).join(", ")}`,
    undefined,
    AuditSeverity.WARNING,
    enrollmentId,
    { subjectOutcomes, previousStatus, newStatus, newGradeLevel }
  );

  return {
    enrollmentId,
    previousStatus,
    newStatus,
    newGradeLevel,
    subjectOutcomes,
  };
}

export interface CertificateData {
  studentName: string;
  lrn: string;
  gradeLevel: string;
  section: string;
  schoolYear: string;
  subjects: {
    subjectName: string;
    originalGrade: number;
    remedialMark: number;
    recomputedGrade: number;
    outcome: string;
    conductedFrom?: Date;
    conductedTo?: Date;
  }[];
  overallResult: string;
}

export async function buildCertificate(enrollmentId: string): Promise<CertificateData | null> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      student: true,
      section: true,
      remedialClasses: { where: { status: "COMPLETED" }, orderBy: { subjectName: "asc" } },
    },
  });

  if (!enrollment || enrollment.remedialClasses.length === 0) return null;

  const allPassed = enrollment.remedialClasses.every(
    (rc) => rc.outcome === "PASSED"
  );

  return {
    studentName: `${enrollment.student.lastName}, ${enrollment.student.firstName} ${enrollment.student.middleName ?? ""}`.trim(),
    lrn: enrollment.student.lrn,
    gradeLevel: enrollment.section.gradeLevel,
    section: enrollment.section.name,
    schoolYear: enrollment.schoolYear,
    subjects: enrollment.remedialClasses.map((rc) => ({
      subjectName: rc.subjectName,
      originalGrade: rc.originalGrade,
      remedialMark: rc.remedialMark ?? 0,
      recomputedGrade: rc.recomputedGrade ?? 0,
      outcome: rc.outcome ?? "PENDING",
      conductedFrom: rc.conductedFrom ?? undefined,
      conductedTo: rc.conductedTo ?? undefined,
    })),
    overallResult: allPassed ? "PROMOTED" : enrollment.promotionStatus === "RETAINED" ? "RETAINED" : "CONDITIONALLY_PROMOTED",
  };
}

// ---------------------------------------------------------------------------
// EnrollPro back-subjects sync
// Pulls conditionally promoted learners from EnrollPro's /remedial/pending
// endpoint and creates/updates local enrollments + RemedialClass records.
// Failing subjects are computed from SMART's own finalized grade data.
// ---------------------------------------------------------------------------

export interface BackSubjectsSyncResult {
  fetched: number;
  matched: number;
  enrollmentsUpdated: number;
  remedialCreated: number;
  remedialSkipped: number;
  skippedResolved: number;
  studentsNotFound: string[];
}

/** Compute previous school year label from current (e.g. "2028-2029" → "2027-2028") */
function previousSchoolYear(sy: string): string | null {
  const match = sy.match(/^(\d{4})-(\d{4})$/);
  if (!match) return null;
  return `${Number(match[1]) - 1}-${Number(match[2]) - 1}`;
}

export async function syncBackSubjectsFromEnrollPro(
  schoolYear: string,
  actor: { id: string; name: string; role: string },
): Promise<BackSubjectsSyncResult> {
  // 1. Fetch conditionally promoted students from EnrollPro
  const epResult = await getEnrollProRemedialPending({ page: 1, limit: 1000 });
  const epItems: any[] = epResult?.items ?? [];
  logger.info(`[RemedialSync] Fetched ${epItems.length} conditionally promoted learners from EnrollPro for SY ${schoolYear}`);

  const result: BackSubjectsSyncResult = {
    fetched: epItems.length,
    matched: 0,
    enrollmentsUpdated: 0,
    remedialCreated: 0,
    remedialSkipped: 0,
    skippedResolved: 0,
    studentsNotFound: [],
  };

  if (epItems.length === 0) return result;

  const prevSY = previousSchoolYear(schoolYear);
  if (!prevSY) {
    logger.warn(`[RemedialSync] Cannot compute previous school year from "${schoolYear}"`);
    return result;
  }

  // 2. Pre-fetch all students by LRN for O(1) lookup
  const lrns = epItems.map((item: any) => item.lrn).filter(Boolean);
  const students = await prisma.student.findMany({
    where: { lrn: { in: lrns } },
    select: { id: true, lrn: true },
  });
  const studentByLrn = new Map(students.map((s) => [s.lrn, s.id]));
  logger.debug(`[RemedialSync] Matched ${studentByLrn.size} LRNs to local students`);

  // 3. Pre-fetch class assignments + subjects for the previous year
  const prevClassAssignments = await prisma.classAssignment.findMany({
    where: { schoolYear: prevSY },
    include: { subject: true },
  });
  const caById = new Map(prevClassAssignments.map((ca) => [ca.id, ca]));

  // 4. Process each learner
  for (const item of epItems) {
    const studentId = studentByLrn.get(item.lrn);
    if (!studentId) {
      result.studentsNotFound.push(item.lrn);
      continue;
    }

    // Find current year enrollment (the one to tag as CONDITIONALLY_PROMOTED + add remedial)
    const currentEnrollment = await prisma.enrollment.findFirst({
      where: { studentId, schoolYear },
      select: { id: true, promotionStatus: true, section: { select: { gradeLevel: true } } },
    });

    if (!currentEnrollment) {
      result.studentsNotFound.push(`${item.lrn} (no enrollment for ${schoolYear})`);
      continue;
    }

    result.matched++;

    // Resolve previous-SY enrollment grade level for remedial row stamping
    const prevEnrollment = await prisma.enrollment.findFirst({
      where: { studentId, schoolYear: prevSY },
      select: { section: { select: { gradeLevel: true } } },
    });
    const remedialGradeLevel = prevEnrollment?.section?.gradeLevel
      ?? ((currentEnrollment.section.gradeLevel as any) === "GRADE_9" ? "GRADE_8" as GradeLevel
        : (currentEnrollment.section.gradeLevel as any) === "GRADE_10" ? "GRADE_9" as GradeLevel
        : (currentEnrollment.section.gradeLevel as any) === "GRADE_8" ? "GRADE_7" as GradeLevel
        : currentEnrollment.section.gradeLevel);

    // Update promotion status — skip already resolved or retained students
    if (
      currentEnrollment.promotionStatus === "PROMOTED"
      || currentEnrollment.promotionStatus === "JHS_COMPLETER"
      || currentEnrollment.promotionStatus === "RETAINED"
    ) {
      result.skippedResolved++;
      continue;
    }

    const existingCompleted = await prisma.remedialClass.findFirst({
      where: { enrollmentId: currentEnrollment.id, status: "COMPLETED" },
    });
    if (existingCompleted) {
      result.skippedResolved++;
      continue;
    }

    // 5. Compute failing subjects from previous year's finalized grades
    const prevGrades = await prisma.grade.findMany({
      where: {
        studentId,
        status: "FINALIZED",
        classAssignment: { schoolYear: prevSY },
      },
    });

    // Build subject term inputs (same logic as promotion.ts)
    const subjectMap = new Map<string, {
      subjectCode: string; subjectName: string; T1: number | null; T2: number | null; T3: number | null;
      isNonPromotional?: boolean; rotationTermGroupId?: string | null; rotationTermRank?: number | null; rotationOutputLabel?: string | null;
    }>();

    for (const ca of prevClassAssignments) {
      if (ca.subject.isNonPromotional) continue;
      if ((ca.subject.code ?? '').toUpperCase().startsWith('HG')) continue;
      const key = canonicalSubjectKey(ca.subject.code, ca.subject.name);
      if (!subjectMap.has(key)) {
        subjectMap.set(key, {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          T1: null, T2: null, T3: null,
          rotationTermGroupId: ca.subject.rotationTermGroupId,
          rotationTermRank: ca.subject.rotationTermRank,
          rotationOutputLabel: ca.subject.rotationOutputLabel,
        });
      }
    }

    for (const grade of prevGrades) {
      const ca = caById.get(grade.classAssignmentId);
      if (!ca || ca.subject.isNonPromotional) continue;
      if ((ca.subject.code ?? '').toUpperCase().startsWith('HG')) continue;
      const key = canonicalSubjectKey(ca.subject.code, ca.subject.name);
      if (!subjectMap.has(key)) {
        subjectMap.set(key, {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          T1: null, T2: null, T3: null,
          rotationTermGroupId: ca.subject.rotationTermGroupId,
          rotationTermRank: ca.subject.rotationTermRank,
          rotationOutputLabel: ca.subject.rotationOutputLabel,
        });
      }
      const row = subjectMap.get(key)!;
      const termKey = grade.term as "T1" | "T2" | "T3";
      if (grade.quarterlyGrade !== null && row[termKey] === null) {
        row[termKey] = grade.quarterlyGrade;
      }
    }

    const subjectFinals = finalizeSubjectRows(Array.from(subjectMap.values()));
    const failingSubjects = subjectFinals.filter(
      (r) => r.finalRating !== null && r.finalRating < PASSING_GRADE,
    );

    if (failingSubjects.length === 0) {
      logger.debug(`[RemedialSync] ${item.lrn}: no failing subjects found in ${prevSY}`);
      continue;
    }

    // 3+ failing subjects = RETAINED, not conditionally promoted
    if (failingSubjects.length >= 3) {
      await prisma.enrollment.update({
        where: { id: currentEnrollment.id },
        data: { promotionStatus: "RETAINED" },
      });
      result.enrollmentsUpdated++;
      await prisma.remedialClass.deleteMany({ where: { enrollmentId: currentEnrollment.id } });
      continue;
    }

    // Only tag CP for 1-2 failing subjects
    if (failingSubjects.length >= 1 && failingSubjects.length <= 2) {
      if (currentEnrollment.promotionStatus !== "CONDITIONALLY_PROMOTED") {
        await prisma.enrollment.update({
          where: { id: currentEnrollment.id },
          data: { promotionStatus: "CONDITIONALLY_PROMOTED" },
        });
        result.enrollmentsUpdated++;
      }
    }

    // 6. Upsert RemedialClass rows for each failing subject
    for (const subj of failingSubjects) {
      try {
        const existingRow = await prisma.remedialClass.findUnique({
          where: {
            enrollmentId_subjectCode: {
              enrollmentId: currentEnrollment.id,
              subjectCode: subj.subjectCode,
            },
          },
        });

        if (existingRow && existingRow.status === "COMPLETED") {
          result.remedialSkipped++;
          continue;
        }

        if (existingRow) {
          await prisma.remedialClass.update({
            where: { id: existingRow.id },
            data: {
              subjectName: computeDisplayName(subj.subjectCode, subj.subjectName),
              originalGrade: subj.finalRating!,
            },
          });
        } else {
          await prisma.remedialClass.create({
            data: {
              enrollmentId: currentEnrollment.id,
              schoolYear,
              gradeLevel: remedialGradeLevel,
              subjectCode: subj.subjectCode,
              subjectName: computeDisplayName(subj.subjectCode, subj.subjectName),
              originalGrade: subj.finalRating!,
              status: "PENDING",
            },
          });
        }
        result.remedialCreated++;
      } catch {
        result.remedialSkipped++;
      }
    }
  }

  await createAuditLog(
    AuditAction.UPDATE,
    actor,
    "Remedial Sync: EnrollPro back-subjects",
    "RemedialClass",
    `Synced ${result.fetched} learners, ${result.enrollmentsUpdated} enrollments updated, ${result.remedialCreated} remedial records created. SY: ${schoolYear}`,
    undefined,
    AuditSeverity.WARNING,
    undefined,
    result,
  );

  logger.info(
    `[RemedialSync] Complete: fetched=${result.fetched}, matched=${result.matched}, ` +
    `enrollmentsUpdated=${result.enrollmentsUpdated}, remedialCreated=${result.remedialCreated}`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Backfill: create missing remedial rows for CONDITIONALLY_PROMOTED enrollments
// that have zero RemedialClass records (orphaned by sync gaps or manual errors).
// ---------------------------------------------------------------------------

export interface BackfillResult {
  enrollmentsScanned: number;
  enrollmentsFixed: number;
  rowsCreated: number;
}

export async function backfillMissingRemedialRows(): Promise<BackfillResult> {
  const result: BackfillResult = { enrollmentsScanned: 0, enrollmentsFixed: 0, rowsCreated: 0 };

  const orphans = await prisma.enrollment.findMany({
    where: { promotionStatus: "CONDITIONALLY_PROMOTED" },
    include: {
      section: true,
      remedialClasses: { select: { id: true } },
    },
  });

  const needsBackfill = orphans.filter((e) => e.remedialClasses.length === 0);
  result.enrollmentsScanned = orphans.length;

  if (needsBackfill.length === 0) return result;

  for (const enrollment of needsBackfill) {
    const grades = await prisma.grade.findMany({
      where: {
        studentId: enrollment.studentId,
        status: "FINALIZED",
        classAssignment: { schoolYear: enrollment.schoolYear },
      },
      include: { classAssignment: { include: { subject: true } } },
    });

    const subjectMap = new Map<string, { subjectCode: string; subjectName: string; T1: number | null; T2: number | null; T3: number | null }>();
    for (const g of grades) {
      const ca = g.classAssignment;
      if (ca.subject.isNonPromotional) continue;
      if ((ca.subject.code ?? '').toUpperCase().startsWith('HG')) continue;
      const key = canonicalSubjectKey(ca.subject.code, ca.subject.name);
      if (!subjectMap.has(key)) {
        subjectMap.set(key, { subjectCode: ca.subject.code, subjectName: ca.subject.name, T1: null, T2: null, T3: null });
      }
      const row = subjectMap.get(key)!;
      const termKey = g.term as "T1" | "T2" | "T3";
      if (g.quarterlyGrade !== null && row[termKey] === null) {
        row[termKey] = g.quarterlyGrade;
      }
    }

    const subjectFinals = finalizeSubjectRows(Array.from(subjectMap.values()));
    const failing = subjectFinals.filter((r) => r.finalRating !== null && r.finalRating < PASSING_GRADE);

    if (failing.length === 0) continue;

    // 3+ failing subjects = RETAINED, not conditionally promoted
    if (failing.length >= 3) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { promotionStatus: "RETAINED" },
      });
      continue;
    }

    const gradeLevel = enrollment.section.gradeLevel;

    await prisma.remedialClass.createMany({
      data: failing.map((s) => ({
        enrollmentId: enrollment.id,
        schoolYear: enrollment.schoolYear,
        gradeLevel,
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        originalGrade: s.finalRating!,
        status: "PENDING" as const,
      })),
    });

    result.enrollmentsFixed++;
    result.rowsCreated += failing.length;
  }

  logger.info(`[BackfillRemedial] Scanned ${result.enrollmentsScanned} orphans, fixed ${result.enrollmentsFixed}, created ${result.rowsCreated} rows`);
  return result;
}

// ---------------------------------------------------------------------------
// Backfill: upgrade stale CONDITIONALLY_PROMOTED → PROMOTED when all remedial
// rows are COMPLETED and all passed.
// ---------------------------------------------------------------------------

export interface StalePromotionBackfillResult {
  scanned: number;
  upgraded: number;
}

export async function backfillStaleConditionalPromotions(): Promise<StalePromotionBackfillResult> {
  const result: StalePromotionBackfillResult = { scanned: 0, upgraded: 0 };

  const conditionals = await prisma.enrollment.findMany({
    where: { promotionStatus: "CONDITIONALLY_PROMOTED" },
    include: { section: true, remedialClasses: { select: { status: true, outcome: true } } },
  });

  result.scanned = conditionals.length;

  for (const enrollment of conditionals) {
    if (enrollment.remedialClasses.length === 0) continue;
    const allCompleted = enrollment.remedialClasses.every((rc) => rc.status === "COMPLETED");
    if (!allCompleted) continue;
    const allPassed = enrollment.remedialClasses.every((rc) => rc.outcome === "PASSED");
    if (!allPassed) continue;

    const gradeLevel = enrollment.section.gradeLevel;
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        promotionStatus: "PROMOTED",
        promotedToGradeLevel: NEXT_GRADE_LEVEL[gradeLevel] ?? gradeLevel,
      },
    });
    result.upgraded++;
  }

  logger.info(`[BackfillPromotions] Scanned ${result.scanned} CONDITIONALLY_PROMOTED, upgraded ${result.upgraded} to PROMOTED`);
  return result;
}
