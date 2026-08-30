/**
 * promotion.ts — Single source of truth for EOSY subject finals + promotion status.
 *
 * Counting rule: one SUBJECT = one row (final = average of its T1–T3 term finals).
 * Never count individual term grades as subjects.
 *
 * DepEd rules (JHS):
 *   0 failing subjects  → PROMOTED (next grade); Grade 10 → JHS_COMPLETER
 *   1–2 failing         → CONDITIONALLY_PROMOTED (next grade); Grade 10 → JHS_COMPLETER (completer with conditions — no separate enum value exists; failing subjects remain visible in subject rows)
 *   ≥3 failing          → RETAINED (same grade)
 *   no grades at all    → RETAINED (same grade)
 *
 * Historical/form query rule (T5): queries here filter by schoolYear ONLY — never by
 * ClassAssignment.isActive / Enrollment.isArchived, so data survives rollover archiving.
 */

import { GradeLevel, PromotionStatus, Term } from "@prisma/client";
import { prisma } from "./prisma";

export const PASSING_GRADE = 75;

export interface SubjectTermInput {
  subjectCode: string;
  subjectName: string;
  teacher?: string;
  T1: number | null;
  T2: number | null;
  T3: number | null;
  isNonPromotional?: boolean;
  rotationTermGroupId?: string | null;
  rotationTermRank?: number | null;
  rotationOutputLabel?: string | null;
}

export interface SubjectFinalRow {
  subjectCode: string;
  subjectName: string;
  teacher: string;
  T1: number | null;
  T2: number | null;
  T3: number | null;
  finalRating: number | null;
  remarks: string | null;
  status: "GRADED" | "PARTIAL" | "NG";
}

export interface PromotionDecision {
  promotionStatus: PromotionStatus | null;
  promotedToGradeLevel: GradeLevel | null;
  failingCount: number;
  generalAverage: number | null;
  generalRemarks: string | null;
}

export const NEXT_GRADE_LEVEL: Record<GradeLevel, GradeLevel | null> = {
  GRADE_7: "GRADE_8",
  GRADE_8: "GRADE_9",
  GRADE_9: "GRADE_10",
  GRADE_10: null,
};

const TERM_KEYS = ["T1", "T2", "T3"] as const;

export function canonicalSubjectKey(code: string, name: string): string {
  return `${code}::${name}`.toUpperCase();
}

export function mergeRotationSubjects(inputs: SubjectTermInput[]): SubjectTermInput[] {
  const standalone: SubjectTermInput[] = [];
  const groups = new Map<string, SubjectTermInput[]>();

  for (const row of inputs) {
    if (row.rotationTermGroupId) {
      const list = groups.get(row.rotationTermGroupId) ?? [];
      list.push(row);
      groups.set(row.rotationTermGroupId, list);
    } else {
      standalone.push(row);
    }
  }

  const merged: SubjectTermInput[] = [];
  for (const [groupId, subs] of groups) {
    const terms: Record<string, number | null> = { T1: null, T2: null, T3: null };
    for (const sub of subs) {
      if (sub.rotationTermRank && sub.rotationTermRank >= 1 && sub.rotationTermRank <= 3) {
        const termKey = `T${sub.rotationTermRank}` as "T1" | "T2" | "T3";
        const value = sub[termKey];
        if (value !== null && terms[termKey] === null) {
          terms[termKey] = value;
        }
      }
    }
    const representative = [...subs].sort((a, b) => (a.rotationTermRank ?? 0) - (b.rotationTermRank ?? 0))[0];
    merged.push({
      subjectCode: representative.rotationOutputLabel ?? representative.subjectCode,
      subjectName: representative.rotationOutputLabel
        ? representative.rotationOutputLabel.charAt(0) + representative.rotationOutputLabel.slice(1).toLowerCase()
        : representative.subjectName,
      teacher: representative.teacher,
      T1: terms.T1,
      T2: terms.T2,
      T3: terms.T3,
      rotationTermGroupId: groupId,
    });
  }

  return [...standalone, ...merged];
}

export function finalizeSubjectRows(inputs: SubjectTermInput[]): SubjectFinalRow[] {
  const promotional = mergeRotationSubjects(inputs.filter((row) => !row.isNonPromotional));

  const rows: SubjectFinalRow[] = promotional.map((row) => {
    const terms = TERM_KEYS.map((key) => row[key]).filter((v): v is number => v !== null);
    const status: SubjectFinalRow["status"] =
      terms.length === 3 ? "GRADED" : terms.length > 0 ? "PARTIAL" : "NG";
    const finalRating = terms.length > 0 ? Math.round(terms.reduce((a, b) => a + b, 0) / terms.length) : null;
    return {
      subjectCode: row.subjectCode,
      subjectName: row.subjectName,
      teacher: row.teacher ?? "",
      T1: row.T1,
      T2: row.T2,
      T3: row.T3,
      finalRating,
      remarks: finalRating !== null ? (finalRating >= PASSING_GRADE ? "Passed" : "Failed") : null,
      status,
    };
  });

  return rows.sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

export function evaluatePromotion(gradeLevel: GradeLevel, rows: SubjectFinalRow[]): PromotionDecision {
  const graded = rows.filter((r) => r.finalRating !== null);
  const generalAverage =
    graded.length > 0
      ? Math.round(graded.reduce((sum, r) => sum + (r.finalRating as number), 0) / graded.length)
      : null;
  const failingCount = rows.filter((r) => r.finalRating !== null && r.finalRating < PASSING_GRADE).length;

  let promotionStatus: PromotionStatus;
  let promotedToGradeLevel: GradeLevel | null;

  if (graded.length === 0) {
    promotionStatus = "RETAINED";
    promotedToGradeLevel = gradeLevel;
  } else if (gradeLevel === "GRADE_10") {
    promotionStatus = failingCount >= 3 ? "RETAINED" : "JHS_COMPLETER";
    promotedToGradeLevel = failingCount >= 3 ? "GRADE_10" : null;
  } else if (failingCount === 0) {
    promotionStatus = "PROMOTED";
    promotedToGradeLevel = NEXT_GRADE_LEVEL[gradeLevel];
  } else if (failingCount <= 2) {
    promotionStatus = "CONDITIONALLY_PROMOTED";
    promotedToGradeLevel = NEXT_GRADE_LEVEL[gradeLevel];
  } else {
    promotionStatus = "RETAINED";
    promotedToGradeLevel = gradeLevel;
  }

  return {
    promotionStatus,
    promotedToGradeLevel,
    failingCount,
    generalAverage,
    generalRemarks: generalAverage !== null ? (generalAverage >= PASSING_GRADE ? "Passed" : "Failed") : null,
  };
}

const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  PROMOTED: "Promoted",
  CONDITIONALLY_PROMOTED: "Conditionally Promoted",
  RETAINED: "Retained",
  JHS_COMPLETER: "JHS Completer",
};

export function promotionStatusLabel(status: PromotionStatus | null): string | null {
  if (!status) return null;
  return PROMOTION_STATUS_LABELS[status];
}

export interface DraftBlocker {
  studentId: string;
  studentName: string;
  subjectCode: string;
  subjectName: string;
  term: Term;
}

export interface EnrollmentPromotion {
  enrollmentId: string;
  studentId: string;
  lrn: string;
  studentName: string;
  subjects: SubjectFinalRow[];
  decision: PromotionDecision;
  stored: { promotionStatus: PromotionStatus | null; promotedToGradeLevel: GradeLevel | null };
}

export interface SectionPromotions {
  section: { id: string; name: string; gradeLevel: GradeLevel; schoolYear: string };
  enrollments: EnrollmentPromotion[];
  draftBlockers: DraftBlocker[];
}

export async function computeSectionPromotions(sectionId: string, schoolYear: string): Promise<SectionPromotions | null> {
  const section = await prisma.section.findFirst({
    where: { id: sectionId, schoolYear },
  });
  if (!section) return null;

  const enrollments = await prisma.enrollment.findMany({
    where: { sectionId: section.id, schoolYear, status: "ENROLLED" },
    include: { student: true },
    orderBy: { student: { lastName: "asc" } },
  });

  const classAssignments = await prisma.classAssignment.findMany({
    where: { sectionId: section.id, schoolYear },
    include: { subject: true, teacher: { include: { user: true } } },
  });

  const grades = await prisma.grade.findMany({
    where: { classAssignment: { sectionId: section.id, schoolYear } },
    include: { classAssignment: { include: { subject: true, teacher: { include: { user: true } } } } },
  });

  const draftBlockers: DraftBlocker[] = [];
  for (const grade of grades) {
    if (grade.status !== "DRAFT") continue;
    const enrollment = enrollments.find((e) => e.studentId === grade.studentId);
    if (!enrollment) continue;
    draftBlockers.push({
      studentId: grade.studentId,
      studentName: `${enrollment.student.lastName}, ${enrollment.student.firstName}`,
      subjectCode: grade.classAssignment.subject.code,
      subjectName: grade.classAssignment.subject.name,
      term: grade.term,
    });
  }

  const results: EnrollmentPromotion[] = enrollments.map((enrollment) => {
    const studentGrades = grades.filter((g) => g.studentId === enrollment.studentId && g.status === "FINALIZED");

    const subjectMap = new Map<string, SubjectTermInput>();
    for (const ca of classAssignments) {
      if (ca.subject.isNonPromotional) continue;
      const key = canonicalSubjectKey(ca.subject.code, ca.subject.name);
      if (!subjectMap.has(key)) {
        subjectMap.set(key, {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          teacher: ca.teacher?.user
            ? `${ca.teacher.user.firstName ?? ""} ${ca.teacher.user.lastName ?? ""}`.trim()
            : "",
          T1: null,
          T2: null,
          T3: null,
          rotationTermGroupId: ca.subject.rotationTermGroupId,
          rotationTermRank: ca.subject.rotationTermRank,
          rotationOutputLabel: ca.subject.rotationOutputLabel,
        });
      }
    }
    for (const grade of studentGrades) {
      const ca = grade.classAssignment;
      if (ca.subject.isNonPromotional) continue;
      const key = canonicalSubjectKey(ca.subject.code, ca.subject.name);
      if (!subjectMap.has(key)) {
        subjectMap.set(key, {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          teacher: ca.teacher?.user
            ? `${ca.teacher.user.firstName ?? ""} ${ca.teacher.user.lastName ?? ""}`.trim()
            : "",
          T1: null,
          T2: null,
          T3: null,
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

    const subjects = finalizeSubjectRows(Array.from(subjectMap.values()));
    const decision = evaluatePromotion(section.gradeLevel, subjects);

    return {
      enrollmentId: enrollment.id,
      studentId: enrollment.studentId,
      lrn: enrollment.student.lrn,
      studentName: `${enrollment.student.lastName}, ${enrollment.student.firstName}`,
      subjects,
      decision,
      stored: {
        promotionStatus: enrollment.promotionStatus ?? null,
        promotedToGradeLevel: enrollment.promotedToGradeLevel ?? null,
      },
    };
  });

  return {
    section: { id: section.id, name: section.name, gradeLevel: section.gradeLevel, schoolYear },
    enrollments: results,
    draftBlockers,
  };
}

export interface SectionEosyStatus {
  sectionId: string;
  sectionName: string;
  gradeLevel: GradeLevel | null;
  enrollmentCount: number;
  withStoredStatus: number;
  draftBlockerCount: number;
  finalized: boolean;
}

export async function getSectionEosyStatus(sectionId: string, schoolYear: string): Promise<SectionEosyStatus | null> {
  const promotions = await computeSectionPromotions(sectionId, schoolYear);
  if (!promotions) return null;
  const withStoredStatus = promotions.enrollments.filter((e) => e.stored.promotionStatus !== null).length;
  return {
    sectionId,
    sectionName: promotions.section.name,
    gradeLevel: promotions.section.gradeLevel,
    enrollmentCount: promotions.enrollments.length,
    withStoredStatus,
    draftBlockerCount: promotions.draftBlockers.length,
    finalized:
      promotions.enrollments.length > 0 &&
      withStoredStatus === promotions.enrollments.length &&
      promotions.draftBlockers.length === 0,
  };
}

export async function listUnfinalizedSections(schoolYear: string): Promise<SectionEosyStatus[]> {
  const [sections, enrollments, classAssignments, allGrades] = await Promise.all([
    prisma.section.findMany({ where: { schoolYear } }),
    prisma.enrollment.findMany({
      where: { schoolYear, status: "ENROLLED" },
      include: { student: true },
    }),
    prisma.classAssignment.findMany({
      where: { schoolYear },
      include: { subject: true },
    }),
    prisma.grade.findMany({
      where: { classAssignment: { schoolYear } },
      include: { classAssignment: { include: { subject: true } } },
    }),
  ]);

  const enrollmentsBySection = new Map<string, typeof enrollments>();
  for (const enr of enrollments) {
    const list = enrollmentsBySection.get(enr.sectionId) ?? [];
    list.push(enr);
    enrollmentsBySection.set(enr.sectionId, list);
  }

  const casBySection = new Map<string, typeof classAssignments>();
  for (const ca of classAssignments) {
    const list = casBySection.get(ca.sectionId) ?? [];
    list.push(ca);
    casBySection.set(ca.sectionId, list);
  }

  const gradesBySection = new Map<string, typeof allGrades>();
  for (const g of allGrades) {
    const list = gradesBySection.get(g.classAssignment.sectionId) ?? [];
    list.push(g);
    gradesBySection.set(g.classAssignment.sectionId, list);
  }

  const statuses: SectionEosyStatus[] = [];
  for (const section of sections) {
    const sectionEnrollments = enrollmentsBySection.get(section.id) ?? [];
    const sectionCas = casBySection.get(section.id) ?? [];
    const sectionGrades = gradesBySection.get(section.id) ?? [];

    let draftBlockerCount = 0;
    for (const grade of sectionGrades) {
      if (grade.status !== "DRAFT") continue;
      const hasEnrollment = sectionEnrollments.some((e) => e.studentId === grade.studentId);
      if (hasEnrollment) draftBlockerCount++;
    }

    let withStoredStatus = 0;
    for (const enr of sectionEnrollments) {
      if (enr.promotionStatus !== null) withStoredStatus++;
    }

    const finalized =
      sectionEnrollments.length > 0 &&
      withStoredStatus === sectionEnrollments.length &&
      draftBlockerCount === 0;

    if (!finalized) {
      statuses.push({
        sectionId: section.id,
        sectionName: section.name,
        gradeLevel: section.gradeLevel,
        enrollmentCount: sectionEnrollments.length,
        withStoredStatus,
        draftBlockerCount,
        finalized: false,
      });
    }
  }
  return statuses;
}

const EOSY_SNAPSHOT_SOURCE = "EOSY_FINALIZE";

interface EosySnapshotPayload {
  [key: string]: unknown;
}

export async function finalizeSectionEosy(opts: {
  sectionId: string;
  schoolYear: string;
  actor: { id: string; name: string; role: string };
}): Promise<
  | { ok: false; error: "SECTION_NOT_FOUND" }
  | { ok: false; error: "DRAFT_BLOCKED"; blockers: DraftBlocker[] }
  | { ok: true; processed: number; snapshotsCreated: number }
> {
  const promotions = await computeSectionPromotions(opts.sectionId, opts.schoolYear);
  if (!promotions) return { ok: false, error: "SECTION_NOT_FOUND" };
  if (promotions.draftBlockers.length > 0) {
    return { ok: false, error: "DRAFT_BLOCKED", blockers: promotions.draftBlockers };
  }

  const grades = await prisma.grade.findMany({
    where: { classAssignment: { sectionId: promotions.section.id, schoolYear: opts.schoolYear }, status: "FINALIZED" },
    include: { classAssignment: { include: { subject: true } } },
  });

  let snapshotsCreated = 0;

  await prisma.$transaction(async (tx) => {
    for (const enrollment of promotions.enrollments) {
      const studentGrades = grades.filter((g) => g.studentId === enrollment.studentId);

      for (const grade of studentGrades) {
        const ca = grade.classAssignment;
        const existing = await tx.gradeSnapshot.findFirst({
          where: {
            studentId: grade.studentId,
            classAssignmentId: grade.classAssignmentId,
            term: grade.term,
            snapshot: { path: ["source"], equals: EOSY_SNAPSHOT_SOURCE },
          },
          orderBy: { createdAt: "desc" },
        });
        const existingQuarterly = existing ? (existing.snapshot as EosySnapshotPayload).quarterlyGrade : undefined;
        if (existing && existingQuarterly === grade.quarterlyGrade) continue;

        await tx.gradeSnapshot.create({
          data: {
            gradeId: grade.id,
            studentId: grade.studentId,
            classAssignmentId: grade.classAssignmentId,
            teacherId: ca.teacherId,
            subjectCode: ca.subject.code,
            subjectName: ca.subject.name,
            sectionId: promotions.section.id,
            sectionName: promotions.section.name,
            schoolYear: opts.schoolYear,
            term: grade.term,
            snapshot: {
              source: EOSY_SNAPSHOT_SOURCE,
              finalizedBy: opts.actor.id,
              finalizedAt: new Date().toISOString(),
              writtenWorkScores: grade.writtenWorkScores,
              perfTaskScores: grade.perfTaskScores,
              quarterlyAssessScore: grade.quarterlyAssessScore,
              quarterlyAssessMax: grade.quarterlyAssessMax,
              writtenWorkPS: grade.writtenWorkPS,
              perfTaskPS: grade.perfTaskPS,
              quarterlyAssessPS: grade.quarterlyAssessPS,
              initialGrade: grade.initialGrade,
              quarterlyGrade: grade.quarterlyGrade,
              remarks: grade.remarks,
              qualitativeDescriptor: grade.qualitativeDescriptor,
            },
          },
        });
        snapshotsCreated++;
      }

      await tx.enrollment.update({
        where: { id: enrollment.enrollmentId },
        data: {
          promotionStatus: enrollment.decision.promotionStatus,
          promotedToGradeLevel: enrollment.decision.promotedToGradeLevel,
        },
      });
    }
  });

  return { ok: true, processed: promotions.enrollments.length, snapshotsCreated };
}
