/**
 * remedial.ts — Business logic for remedial class management.
 *
 * Remedial records are SMART-local (never pushed to EnrollPro).
 * Per-subject outcomes support the DO 13 §2.1 decision matrix.
 */

import { GradeLevel, PromotionStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { NEXT_GRADE_LEVEL } from "./promotion";
import { createAuditLog } from "./audit";
import { AuditAction, AuditSeverity } from "@prisma/client";

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
  opts?: { retentionOverride?: boolean }
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

  const gradeLevel = enrollment.section.gradeLevel;

  let newStatus: PromotionStatus;
  let newGradeLevel: GradeLevel | null;

  if (allPassed) {
    newStatus = "PROMOTED";
    newGradeLevel = NEXT_GRADE_LEVEL[gradeLevel] ?? gradeLevel;
  } else if (opts?.retentionOverride) {
    newStatus = "RETAINED";
    newGradeLevel = gradeLevel;
  } else {
    newStatus = "CONDITIONALLY_PROMOTED";
    newGradeLevel = NEXT_GRADE_LEVEL[gradeLevel] ?? gradeLevel;
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
