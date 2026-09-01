import { Term, EnrollmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { getTransmutationTable } from "../../lib/transmutationCache";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { getIntegrationV1ActiveTerm } from "../../lib/enrollproClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnrollmentWithStudent {
  student: {
    id: string;
    lrn: string;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    suffix?: string | null;
    gender?: string | null;
  };
  studentId: string;
}

export interface GradeRecord {
  id: string;
  studentId: string;
  classAssignmentId: string;
  term: string;
}

export interface ClassAssignmentWithRelations {
  subject: { name: string; code: string };
  section: { _count: { enrollments: number } };
}

export interface EffectiveWeights {
  ww: number;
  pt: number;
  qa: number;
  source: "subject-override" | "subject-type" | "generic-fallback";
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const GENERIC_FALLBACK_WEIGHTS = {
  ww: 20,
  pt: 50,
  qa: 30,
} as const;

export const HG_QUALITATIVE_DESCRIPTORS = [
  'No Improvement',
  'Needs Improvement',
  'Developing',
  'Sufficiently Developed',
] as const;

export const TERM_CACHE_TTL_MS = 60_000;

// ─── Module-Level State ───────────────────────────────────────────────────────

let cachedTerm: { term: string; fetchedAt: number } | null = null;

// ─── Live Term Resolver ──────────────────────────────────────────────────────

export async function resolveCurrentTerm(): Promise<string> {
  const now = Date.now();
  if (cachedTerm && now - cachedTerm.fetchedAt < TERM_CACHE_TTL_MS) {
    return cachedTerm.term;
  }

  try {
    const activeTermData = await getIntegrationV1ActiveTerm();
    if (activeTermData?.activeTerm) {
      const termUpper = activeTermData.activeTerm.toUpperCase();
      if (['T1', 'T2', 'T3'].includes(termUpper)) {
        cachedTerm = { term: termUpper, fetchedAt: now };
        // Also persist to DB so offline fallback is correct
        await prisma.systemSettings.upsert({
          where: { id: 'main' },
          update: { currentTerm: termUpper as any },
          create: { id: 'main', currentTerm: termUpper as any },
        }).catch(() => {});
        return termUpper;
      }
    }
  } catch (err: any) {
    logger.warn(`[Grades] Live term fetch from EnrollPro failed (non-fatal): ${err.message}`);
  }

  // Fallback: read from database
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  const dbTerm = settings?.currentTerm ?? 'T1';
  cachedTerm = { term: dbTerm, fetchedAt: now };
  return dbTerm;
}

// ─── Grade Deadline Utilities ─────────────────────────────────────────────────

export interface GradeDeadlineInfo {
  termEndDate: string | null;
  daysRemaining: number | null;
  urgencyLevel: 'none' | 'warn' | 'urgent' | 'critical' | 'overdue';
  currentTerm: string;
  hasIncompleteClasses: boolean;
  incompleteCount: number;
  incompleteClasses: { subjectName: string; sectionName: string; gradedCount: number; totalStudents: number }[];
}

export async function resolveTermDeadline(
  teacherId: string,
  currentSchoolYear: string
): Promise<GradeDeadlineInfo | null> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  if (!settings) return null;

  const currentTerm = await resolveCurrentTerm();

  let termEndDate: Date | null = null;
  if (currentTerm === 'T1' && settings.t1EndDate) termEndDate = new Date(settings.t1EndDate);
  else if (currentTerm === 'T2' && settings.t2EndDate) termEndDate = new Date(settings.t2EndDate);
  else if (currentTerm === 'T3' && settings.t3EndDate) termEndDate = new Date(settings.t3EndDate);

  if (!termEndDate) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  termEndDate.setHours(0, 0, 0, 0);
  const msRemaining = termEndDate.getTime() - now.getTime();
  const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

  const activeClasses = await prisma.classAssignment.findMany({
    where: { teacherId, schoolYear: currentSchoolYear, isActive: true },
    include: {
      subject: { select: { code: true, name: true } },
      section: {
        select: {
          name: true,
          _count: {
            select: {
              enrollments: {
                where: { status: EnrollmentStatus.ENROLLED, schoolYear: currentSchoolYear },
              },
            },
          },
        },
      },
      grades: { where: { term: currentTerm as any } },
    },
  });

  const teachingClasses = activeClasses.filter(
    (ca: any) => !isHomeroomGuidanceSubjectCode(ca.subject.code)
  );

  const incompleteClasses: GradeDeadlineInfo['incompleteClasses'] = [];
  for (const ca of teachingClasses) {
    const totalStudents = ca.section._count.enrollments;
    const gradedCount = (ca.grades as any[]).filter(
      (g: any) => g.quarterlyGrade !== null
    ).length;
    if (gradedCount < totalStudents) {
      incompleteClasses.push({
        subjectName: ca.subject.name,
        sectionName: ca.section.name,
        gradedCount,
        totalStudents,
      });
    }
  }

  const incompleteCount = incompleteClasses.length;
  const hasIncompleteClasses = incompleteCount > 0;

  if (!hasIncompleteClasses) return null;

  let urgencyLevel: GradeDeadlineInfo['urgencyLevel'];
  if (daysRemaining < 0) {
    urgencyLevel = 'overdue';
  } else if (daysRemaining <= 1) {
    urgencyLevel = 'critical';
  } else if (daysRemaining <= 3) {
    urgencyLevel = 'urgent';
  } else if (daysRemaining <= 7) {
    urgencyLevel = 'warn';
  } else {
    urgencyLevel = 'none';
  }

  if (urgencyLevel === 'none') return null;

  return {
    termEndDate: termEndDate.toISOString(),
    daysRemaining,
    urgencyLevel,
    currentTerm,
    hasIncompleteClasses,
    incompleteCount,
    incompleteClasses,
  };
}

// ─── Subject Helpers ──────────────────────────────────────────────────────────

export function getBaseSubjectName(subjectName: string): string {
  return subjectName.replace(/\s+\d+$/, "").trim();
}

export function isHomeroomGuidanceSubjectCode(subjectCode?: string | null): boolean {
  return (subjectCode ?? '').toUpperCase().startsWith('HG');
}

// ─── Weight Resolver ──────────────────────────────────────────────────────────

export async function resolveEffectiveWeightsForClassAssignment(classAssignmentId: string): Promise<EffectiveWeights> {
  const classAssignment = await prisma.classAssignment.findUnique({
    where: { id: classAssignmentId },
    select: {
      subject: {
        select: {
          name: true,
          type: true,
          writtenWorkWeight: true,
          perfTaskWeight: true,
          quarterlyAssessWeight: true,
        },
      },
    },
  });

  if (!classAssignment) {
    return {
      ww: GENERIC_FALLBACK_WEIGHTS.ww,
      pt: GENERIC_FALLBACK_WEIGHTS.pt,
      qa: GENERIC_FALLBACK_WEIGHTS.qa,
      source: "generic-fallback",
    };
  }

  const subjectName = classAssignment.subject.name.trim();
  const baseSubjectName = getBaseSubjectName(subjectName);

  if (
    classAssignment.subject.writtenWorkWeight !== null &&
    classAssignment.subject.perfTaskWeight !== null &&
    classAssignment.subject.quarterlyAssessWeight !== null
  ) {
    return {
      ww: classAssignment.subject.writtenWorkWeight,
      pt: classAssignment.subject.perfTaskWeight,
      qa: classAssignment.subject.quarterlyAssessWeight,
      source: "subject-override",
    };
  }

  const gradingConfig = await prisma.gradingConfig.findUnique({
    where: { subjectType: classAssignment.subject.type },
  });

  if (gradingConfig) {
    return {
      ww: gradingConfig.writtenWorkWeight,
      pt: gradingConfig.performanceTaskWeight,
      qa: gradingConfig.quarterlyAssessWeight,
      source: "subject-type",
    };
  }

  return {
    ww: GENERIC_FALLBACK_WEIGHTS.ww,
    pt: GENERIC_FALLBACK_WEIGHTS.pt,
    qa: GENERIC_FALLBACK_WEIGHTS.qa,
    source: "generic-fallback",
  };
}

// ─── Grade Calculation ────────────────────────────────────────────────────────

export async function calculateGrades(
  writtenWorkScores: Array<{ name: string; score: number; maxScore: number }> | null,
  perfTaskScores: Array<{ name: string; score: number; maxScore: number }> | null,
  quarterlyAssessScore: number | null,
  quarterlyAssessMax: number,
  wwWeight: number,
  ptWeight: number,
  qaWeight: number
) {
  let writtenWorkPS: number | null = null;
  if (writtenWorkScores && writtenWorkScores.length > 0) {
    const totalScore = writtenWorkScores.reduce((sum, item) => sum + item.score, 0);
    const totalMax = writtenWorkScores.reduce((sum, item) => sum + item.maxScore, 0);
    writtenWorkPS = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
  }

  let perfTaskPS: number | null = null;
  if (perfTaskScores && perfTaskScores.length > 0) {
    const totalScore = perfTaskScores.reduce((sum, item) => sum + item.score, 0);
    const totalMax = perfTaskScores.reduce((sum, item) => sum + item.maxScore, 0);
    perfTaskPS = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
  }

  let quarterlyAssessPS: number | null = null;
  if (quarterlyAssessScore !== null && quarterlyAssessMax > 0) {
    quarterlyAssessPS = (quarterlyAssessScore / quarterlyAssessMax) * 100;
  }

  let initialGrade: number | null = null;
  if (writtenWorkPS !== null && perfTaskPS !== null && quarterlyAssessPS !== null) {
    initialGrade =
      (writtenWorkPS * wwWeight) / 100 +
      (perfTaskPS * ptWeight) / 100 +
      (quarterlyAssessPS * qaWeight) / 100;
  }

  let quarterlyGrade: number | null = null;
  if (initialGrade !== null) {
    quarterlyGrade = await transmute(initialGrade);
  }

  return {
    writtenWorkPS,
    perfTaskPS,
    quarterlyAssessPS,
    initialGrade,
    quarterlyGrade,
  };
}

export async function transmute(initialGrade: number): Promise<number> {
  const roundedGrade = Math.round(initialGrade * 100) / 100;
  const table = await getTransmutationTable();
  for (const entry of table) {
    if (roundedGrade >= entry.minGrade && roundedGrade <= entry.maxGrade) {
      return entry.transmutedGrade;
    }
  }
  logger.warn(
    `[Transmutation] Initial grade ${roundedGrade} did not match any range — returning fallback 60. ` +
      `Check the transmutation table for gaps or misconfigured ranges (${table.length} entries).`
  );
  return 60;
}

export async function createGradeSnapshot(params: {
  gradeId?: string;
  studentId: string;
  classAssignmentId: string;
  teacherId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
  schoolYear: string;
  term: Term;
  snapshot: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.gradeSnapshot.create({
      data: {
        gradeId: params.gradeId ?? null,
        studentId: params.studentId,
        classAssignmentId: params.classAssignmentId,
        teacherId: params.teacherId,
        subjectCode: params.subjectCode,
        subjectName: params.subjectName,
        sectionId: params.sectionId,
        sectionName: params.sectionName,
        schoolYear: params.schoolYear,
        term: params.term,
        snapshot: params.snapshot as any,
      },
    });
  } catch (error) {
    logger.error('Failed to create grade snapshot:', error);
  }
}

// Re-export shared dependencies for sub-modules
export { prisma } from "../../lib/prisma";
export { AuditAction, AuditSeverity, Prisma as PrismaClient } from "@prisma/client";
export { createAuditLog } from "../../lib/audit";
export { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
export { logger } from "../../lib/logger";
export { validate } from "../../middleware/validate";
