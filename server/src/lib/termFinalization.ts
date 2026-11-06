/**
 * termFinalization.ts — Registrar term-end grade finalization.
 *
 * Term finalization is deliberately separate from EOSY:
 *   - finalizeSectionTerm flips DRAFT -> FINALIZED for one section + term
 *   - it never creates EOSY snapshots or promotion status
 *   - EOSY remains the explicit year-end operation in registrar/eosy.ts
 *
 * Query-year semantics follow the AGENTS rule for finalization/historical
 * data: filter by schoolYear only, never by isActive/isArchived.
 */

import { Term } from "@prisma/client";
import { prisma } from "./prisma";

export const TERMS = ["T1", "T2", "T3"] as const;
export type TermName = (typeof TERMS)[number];

export interface TermFinalizationSubject {
  subjectIds: string[];
  subjectName: string;
  subjectCodes: string[];
  teacherNames: string[];
  draft: number;
  finalized: number;
  locked: number;
  total: number;
  hasGrades: boolean;
  isFinalized: boolean;
}

export interface TermFinalizationSection {
  sectionId: string;
  sectionName: string;
  gradeLevel: string;
  program: string;
  sectionStatus: string;
  adviserName: string | null;
  subjects: TermFinalizationSubject[];
  draftCount: number;
  finalizedCount: number;
  totalSubjects: number;
  finalizedSubjects: number;
  noGradeSubjects: number;
  isFinalized: boolean;
  eosyStarted: boolean;
  eosyFinalized: boolean;
  canFinalize: boolean;
}

export interface TermFinalizationOverview {
  schoolYear: string;
  term: TermName;
  currentTerm: TermName | null;
  yearStatus: string | null;
  canFinalize: boolean;
  deadline: string | null;
  termLock: {
    isLocked: boolean;
    lockedBy: string | null;
    lockedAt: string | null;
    unlockedBy: string | null;
    unlockedAt: string | null;
  } | null;
  yearLock: {
    isLocked: boolean;
    lockedBy: string | null;
    lockedAt: string | null;
  } | null;
  sections: TermFinalizationSection[];
  summary: {
    sections: number;
    sectionsFinalized: number;
    sectionsWithDrafts: number;
    totalDraftGrades: number;
    totalFinalizedGrades: number;
    totalSubjects: number;
    finalizedSubjects: number;
    noGradeSubjects: number;
  };
}

interface LockFlags {
  termLocked: boolean;
  yearLocked: boolean;
}

type SectionRow = {
  id: string;
  name: string;
  gradeLevel: string;
  program: string;
  status: string;
  adviser: { user: { firstName: string | null; lastName: string | null; username: string } } | null;
};

/**
 * "Science - Earth Science 7" -> "Science 7"
 * "TLE Exploratory - Agriculture and Fishery Arts 7" -> "TLE Exploratory 7"
 * Rotational components share one base group so a term only needs grades from
 * whichever component is offered that term.
 */
export function getBaseSubjectName(name: string): string {
  const dashIdx = name.indexOf(" - ");
  if (dashIdx === -1) return name;
  const prefix = name.substring(0, dashIdx).trim();
  const gradeMatch = name.match(/\s+(\d+)\s*$/);
  const gradeSuffix = gradeMatch ? ` ${gradeMatch[1]}` : "";
  return `${prefix}${gradeSuffix}`;
}

function teacherDisplayName(user: {
  firstName: string | null;
  lastName: string | null;
  username: string;
}): string {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.username;
}

function termDeadline(
  settings: {
    currentSchoolYear: string;
    t1EndDate: Date | null;
    t2EndDate: Date | null;
    t3EndDate: Date | null;
  } | null,
  schoolYear: string,
  term: TermName,
): Date | null {
  if (!settings || settings.currentSchoolYear !== schoolYear) return null;
  if (term === "T1") return settings.t1EndDate;
  if (term === "T2") return settings.t2EndDate;
  return settings.t3EndDate;
}

function mapTermLock(
  lock: {
    isLocked: boolean;
    lockedBy: string | null;
    lockedAt: Date | null;
    unlockedBy: string | null;
    unlockedAt: Date | null;
  } | null,
): TermFinalizationOverview["termLock"] {
  if (!lock) return null;
  return {
    isLocked: lock.isLocked,
    lockedBy: lock.lockedBy,
    lockedAt: lock.lockedAt?.toISOString() ?? null,
    unlockedBy: lock.unlockedBy,
    unlockedAt: lock.unlockedAt?.toISOString() ?? null,
  };
}

function mapYearLock(
  lock: {
    isLocked: boolean;
    lockedBy: string | null;
    lockedAt: Date | null;
  } | null,
): TermFinalizationOverview["yearLock"] {
  if (!lock) return null;
  return {
    isLocked: lock.isLocked,
    lockedBy: lock.lockedBy,
    lockedAt: lock.lockedAt?.toISOString() ?? null,
  };
}

export async function buildTermFinalizationOverview(
  schoolYear: string,
  term: TermName,
): Promise<TermFinalizationOverview | null> {
  const [settings, yearRecord, sections] = await Promise.all([
    prisma.systemSettings.findUnique({
      where: { id: "main" },
      select: {
        currentSchoolYear: true,
        currentTerm: true,
        t1EndDate: true,
        t2EndDate: true,
        t3EndDate: true,
      },
    }),
    prisma.schoolYear.findUnique({
      where: { label: schoolYear },
      include: {
        yearGradeLock: true,
        termGradeLocks: { where: { term: term as Term } },
      },
    }),
    prisma.section.findMany({
      where: { schoolYear },
      select: {
        id: true,
        name: true,
        gradeLevel: true,
        program: true,
        status: true,
        adviser: {
          select: {
            user: { select: { firstName: true, lastName: true, username: true } },
          },
        },
      },
      orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
    }),
  ]);

  if (!yearRecord && sections.length === 0) return null;

  const sectionIds = sections.map((s) => s.id);
  const [classAssignments, enrollments, allTermDrafts] = await Promise.all([
    sectionIds.length === 0
      ? Promise.resolve([])
      : prisma.classAssignment.findMany({
          where: { schoolYear, sectionId: { in: sectionIds } },
          select: {
            id: true,
            sectionId: true,
            subjectId: true,
            subject: { select: { code: true, name: true } },
            teacher: {
              select: {
                user: { select: { firstName: true, lastName: true, username: true } },
              },
            },
            grades: {
              where: { term: term as Term },
              select: { status: true },
            },
          },
        }),
    sectionIds.length === 0
      ? Promise.resolve([])
      : prisma.enrollment.findMany({
          where: { schoolYear, sectionId: { in: sectionIds }, status: "ENROLLED" },
          select: { sectionId: true, studentId: true, promotionStatus: true },
        }),
    sectionIds.length === 0
      ? Promise.resolve([])
      : prisma.grade.findMany({
          where: {
            classAssignment: { schoolYear, sectionId: { in: sectionIds } },
            status: "DRAFT",
          },
          select: {
            studentId: true,
            classAssignment: {
              select: { sectionId: true, subject: { select: { code: true } } },
            },
          },
        }),
  ]);

  // EOSY's draft blockers ignore HG subjects and learners not in the section.
  // Mirror that so "fully EOSY-finalized" cannot disagree with the EOSY page.
  const enrolledStudentsBySection = new Map<string, Set<string>>();
  for (const enrollment of enrollments) {
    const set = enrolledStudentsBySection.get(enrollment.sectionId) ?? new Set<string>();
    set.add(enrollment.studentId);
    enrolledStudentsBySection.set(enrollment.sectionId, set);
  }

  const allTermDraftsBySection = new Map<string, number>();
  for (const draft of allTermDrafts) {
    const sectionId = draft.classAssignment.sectionId;
    if ((draft.classAssignment.subject.code ?? "").toUpperCase().startsWith("HG")) continue;
    const enrolled = enrolledStudentsBySection.get(sectionId);
    if (!enrolled?.has(draft.studentId)) continue;
    allTermDraftsBySection.set(sectionId, (allTermDraftsBySection.get(sectionId) ?? 0) + 1);
  }

  const enrollmentState = new Map<
    string,
    { count: number; stored: number }
  >();
  for (const enrollment of enrollments) {
    const state = enrollmentState.get(enrollment.sectionId) ?? { count: 0, stored: 0 };
    state.count += 1;
    if (enrollment.promotionStatus !== null) state.stored += 1;
    enrollmentState.set(enrollment.sectionId, state);
  }

  const grouped = new Map<
    string,
    {
      sectionId: string;
      baseName: string;
      subjectIds: Set<string>;
      subjectCodes: Set<string>;
      teacherNames: Set<string>;
      draft: number;
      finalized: number;
      locked: number;
      total: number;
    }
  >();

  for (const ca of classAssignments) {
    if ((ca.subject?.code ?? "").toUpperCase().startsWith("HG")) continue;
    const baseName = getBaseSubjectName(ca.subject?.name ?? "");
    if (!baseName) continue;
    const key = `${ca.sectionId}::${baseName}`;
    const row =
      grouped.get(key) ??
      {
        sectionId: ca.sectionId,
        baseName,
        subjectIds: new Set<string>(),
        subjectCodes: new Set<string>(),
        teacherNames: new Set<string>(),
        draft: 0,
        finalized: 0,
        locked: 0,
        total: 0,
      };

    row.subjectIds.add(ca.subjectId);
    if (ca.subject?.code) row.subjectCodes.add(ca.subject.code);
    row.teacherNames.add(teacherDisplayName(ca.teacher.user));

    for (const grade of ca.grades) {
      row.total += 1;
      if (grade.status === "DRAFT") row.draft += 1;
      else if (grade.status === "FINALIZED") row.finalized += 1;
      else if (grade.status === "LOCKED") row.locked += 1;
    }
    grouped.set(key, row);
  }

  const subjectsBySection = new Map<string, TermFinalizationSubject[]>();
  for (const row of grouped.values()) {
    const list = subjectsBySection.get(row.sectionId) ?? [];
    list.push({
      subjectIds: [...row.subjectIds],
      subjectName: row.baseName,
      subjectCodes: [...row.subjectCodes],
      teacherNames: [...row.teacherNames],
      draft: row.draft,
      finalized: row.finalized,
      locked: row.locked,
      total: row.total,
      hasGrades: row.total > 0,
      isFinalized: row.total > 0 && row.draft === 0,
    });
    subjectsBySection.set(row.sectionId, list);
  }

  const yearArchived = yearRecord?.status === "ARCHIVED";
  const advisorNameOf = (section: SectionRow) => {
    if (!section.adviser) return null;
    return teacherDisplayName(section.adviser.user);
  };

  const sectionRows: TermFinalizationSection[] = sections.map((section) => {
    const subjects = (subjectsBySection.get(section.id) ?? []).sort((a, b) =>
      a.subjectName.localeCompare(b.subjectName),
    );
    const draftCount = subjects.reduce((sum, s) => sum + s.draft, 0);
    const finalizedCount = subjects.reduce((sum, s) => sum + s.finalized, 0);
    const finalizedSubjects = subjects.filter((s) => s.isFinalized).length;
    const noGradeSubjects = subjects.filter((s) => !s.hasGrades).length;
    const isFinalized =
      subjects.length > 0 &&
      subjects.every((s) => s.hasGrades && s.draft === 0);
    const eosyState = enrollmentState.get(section.id) ?? { count: 0, stored: 0 };

    return {
      sectionId: section.id,
      sectionName: section.name,
      gradeLevel: section.gradeLevel,
      program: section.program ?? "REGULAR",
      sectionStatus: section.status,
      adviserName: advisorNameOf(section),
      subjects,
      draftCount,
      finalizedCount,
      totalSubjects: subjects.length,
      finalizedSubjects,
      noGradeSubjects,
      isFinalized,
      eosyStarted: eosyState.stored > 0,
      eosyFinalized:
        eosyState.count > 0 &&
        eosyState.stored === eosyState.count &&
        (allTermDraftsBySection.get(section.id) ?? 0) === 0,
      canFinalize:
        !yearArchived &&
        section.status !== "ARCHIVED" &&
        section.status !== "COMPLETED" &&
        subjects.length > 0,
    };
  });

  const summary = sectionRows.reduce(
    (acc, section) => {
      acc.sections += 1;
      if (section.isFinalized) acc.sectionsFinalized += 1;
      if (section.draftCount > 0) acc.sectionsWithDrafts += 1;
      acc.totalDraftGrades += section.draftCount;
      acc.totalFinalizedGrades += section.finalizedCount;
      acc.totalSubjects += section.totalSubjects;
      acc.finalizedSubjects += section.finalizedSubjects;
      acc.noGradeSubjects += section.noGradeSubjects;
      return acc;
    },
    {
      sections: 0,
      sectionsFinalized: 0,
      sectionsWithDrafts: 0,
      totalDraftGrades: 0,
      totalFinalizedGrades: 0,
      totalSubjects: 0,
      finalizedSubjects: 0,
      noGradeSubjects: 0,
    },
  );

  const deadline = termDeadline(settings, schoolYear, term);

  return {
    schoolYear,
    term,
    currentTerm: (settings?.currentTerm as TermName | undefined) ?? null,
    yearStatus: yearRecord?.status ?? null,
    canFinalize: !yearArchived,
    deadline: deadline?.toISOString() ?? null,
    termLock: mapTermLock(yearRecord?.termGradeLocks[0] ?? null),
    yearLock: mapYearLock(yearRecord?.yearGradeLock ?? null),
    sections: sectionRows,
    summary,
  };
}

export type TermFinalizationActionError =
  | "SECTION_NOT_FOUND"
  | "SECTION_ARCHIVED"
  | "YEAR_ARCHIVED"
  | "NO_ASSIGNMENTS"
  | "EOSY_FINALIZED";

export interface TermFinalizationActionSuccess {
  ok: true;
  sectionId: string;
  sectionName: string;
  term: TermName;
  schoolYear: string;
  finalizedCount: number;
  unfinalizedCount: number;
  subjectCount: number;
  remainingSelectedDrafts: number;
  remainingTermDrafts: number;
  remainingSelectedFinalized: number;
  termLocked: boolean;
  yearLocked: boolean;
}

export interface TermFinalizationActionFailure {
  ok: false;
  error: TermFinalizationActionError;
  eosyFinalized?: boolean;
}

export type TermFinalizationActionResult =
  | TermFinalizationActionSuccess
  | TermFinalizationActionFailure;

async function loadSectionAndYear(sectionId: string, schoolYear: string) {
  const [section, yearRecord] = await Promise.all([
    prisma.section.findFirst({
      where: { id: sectionId, schoolYear },
      select: { id: true, name: true, status: true },
    }),
    prisma.schoolYear.findUnique({
      where: { label: schoolYear },
      include: {
        yearGradeLock: true,
        termGradeLocks: true,
      },
    }),
  ]);
  return { section, yearRecord };
}

function lockFlags(
  yearRecord: {
    yearGradeLock: { isLocked: boolean } | null;
    termGradeLocks: Array<{ term: Term; isLocked: boolean }>;
  } | null,
  term: TermName,
): LockFlags {
  return {
    yearLocked: yearRecord?.yearGradeLock?.isLocked ?? false,
    termLocked:
      yearRecord?.termGradeLocks.some((lock) => lock.term === term && lock.isLocked) ?? false,
  };
}

async function isSectionEosyFinalized(sectionId: string, schoolYear: string): Promise<boolean> {
  const [enrollments, draftGrades] = await Promise.all([
    prisma.enrollment.findMany({
      where: { sectionId, schoolYear, status: "ENROLLED" },
      select: { studentId: true, promotionStatus: true },
    }),
    prisma.grade.findMany({
      where: {
        classAssignment: { sectionId, schoolYear },
        status: "DRAFT",
      },
      select: {
        studentId: true,
        classAssignment: { select: { subject: { select: { code: true } } } },
      },
    }),
  ]);

  if (enrollments.length === 0) return false;

  // Exact parity with computeSectionPromotions draft blockers: HG subjects are
  // ignored, and only enrolled learners count. Partial EOSY data is recoverable
  // (re-run EOSY after term finalization).
  const enrolledStudentIds = new Set(enrollments.map((enrollment) => enrollment.studentId));
  const blockers = draftGrades.filter((grade) => {
    if ((grade.classAssignment.subject.code ?? "").toUpperCase().startsWith("HG")) return false;
    return enrolledStudentIds.has(grade.studentId);
  });

  return enrollments.every((enrollment) => enrollment.promotionStatus !== null) && blockers.length === 0;
}

export async function finalizeSectionTerm(opts: {
  sectionId: string;
  term: TermName;
  schoolYear: string;
  subjectIds?: string[];
  actorId: string;
}): Promise<TermFinalizationActionResult> {
  const { sectionId, term, schoolYear, subjectIds, actorId } = opts;
  const { section, yearRecord } = await loadSectionAndYear(sectionId, schoolYear);

  if (!section) return { ok: false, error: "SECTION_NOT_FOUND" };
  if (yearRecord?.status === "ARCHIVED") return { ok: false, error: "YEAR_ARCHIVED" };
  if (section.status === "ARCHIVED" || section.status === "COMPLETED") {
    return { ok: false, error: "SECTION_ARCHIVED" };
  }

  // EOSY is the FINAL status. Once EOSY is fully finalized, term grades must
  // not move in either direction until EOSY is explicitly unfinalized first.
  const eosyFinalized = await isSectionEosyFinalized(sectionId, schoolYear);
  if (eosyFinalized) {
    return { ok: false, error: "EOSY_FINALIZED", eosyFinalized: true };
  }

  const classAssignments = await prisma.classAssignment.findMany({
    where: {
      sectionId,
      schoolYear,
      ...(subjectIds && subjectIds.length > 0 ? { subjectId: { in: subjectIds } } : {}),
    },
    select: { id: true, subjectId: true },
  });

  if (classAssignments.length === 0) return { ok: false, error: "NO_ASSIGNMENTS" };

  const classAssignmentIds = classAssignments.map((ca) => ca.id);
  const result = await prisma.grade.updateMany({
    where: {
      classAssignmentId: { in: classAssignmentIds },
      term: term as Term,
      status: "DRAFT",
    },
    data: {
      status: "FINALIZED",
      finalizedBy: actorId,
      finalizedAt: new Date(),
    },
  });

  const [remainingSelectedDrafts, remainingTermDrafts, remainingSelectedFinalized] =
    await Promise.all([
      prisma.grade.count({
        where: {
          classAssignmentId: { in: classAssignmentIds },
          term: term as Term,
          status: "DRAFT",
        },
      }),
      prisma.grade.count({
        where: {
          classAssignment: { sectionId, schoolYear },
          term: term as Term,
          status: "DRAFT",
        },
      }),
      prisma.grade.count({
        where: {
          classAssignmentId: { in: classAssignmentIds },
          term: term as Term,
          status: "FINALIZED",
        },
      }),
    ]);

  const locks = lockFlags(yearRecord, term);

  return {
    ok: true,
    sectionId,
    sectionName: section.name,
    term,
    schoolYear,
    finalizedCount: result.count,
    unfinalizedCount: 0,
    subjectCount: new Set(classAssignments.map((ca) => ca.subjectId)).size,
    remainingSelectedDrafts,
    remainingTermDrafts,
    remainingSelectedFinalized,
    ...locks,
  };
}

export async function unfinalizeSectionTerm(opts: {
  sectionId: string;
  term: TermName;
  schoolYear: string;
  subjectIds?: string[];
}): Promise<TermFinalizationActionResult> {
  const { sectionId, term, schoolYear, subjectIds } = opts;
  const { section, yearRecord } = await loadSectionAndYear(sectionId, schoolYear);

  if (!section) return { ok: false, error: "SECTION_NOT_FOUND" };
  if (yearRecord?.status === "ARCHIVED") return { ok: false, error: "YEAR_ARCHIVED" };
  if (section.status === "ARCHIVED") return { ok: false, error: "SECTION_ARCHIVED" };

  const eosyFinalized = await isSectionEosyFinalized(sectionId, schoolYear);
  if (eosyFinalized) {
    return { ok: false, error: "EOSY_FINALIZED", eosyFinalized: true };
  }

  const classAssignments = await prisma.classAssignment.findMany({
    where: {
      sectionId,
      schoolYear,
      ...(subjectIds && subjectIds.length > 0 ? { subjectId: { in: subjectIds } } : {}),
    },
    select: { id: true, subjectId: true },
  });

  if (classAssignments.length === 0) return { ok: false, error: "NO_ASSIGNMENTS" };

  const classAssignmentIds = classAssignments.map((ca) => ca.id);
  const result = await prisma.grade.updateMany({
    where: {
      classAssignmentId: { in: classAssignmentIds },
      term: term as Term,
      status: "FINALIZED",
    },
    data: {
      status: "DRAFT",
      finalizedBy: null,
      finalizedAt: null,
    },
  });

  const [remainingSelectedDrafts, remainingTermDrafts, remainingSelectedFinalized] =
    await Promise.all([
      prisma.grade.count({
        where: {
          classAssignmentId: { in: classAssignmentIds },
          term: term as Term,
          status: "DRAFT",
        },
      }),
      prisma.grade.count({
        where: {
          classAssignment: { sectionId, schoolYear },
          term: term as Term,
          status: "DRAFT",
        },
      }),
      prisma.grade.count({
        where: {
          classAssignmentId: { in: classAssignmentIds },
          term: term as Term,
          status: "FINALIZED",
        },
      }),
    ]);

  const locks = lockFlags(yearRecord, term);

  return {
    ok: true,
    sectionId,
    sectionName: section.name,
    term,
    schoolYear,
    finalizedCount: 0,
    unfinalizedCount: result.count,
    subjectCount: new Set(classAssignments.map((ca) => ca.subjectId)).size,
    remainingSelectedDrafts,
    remainingTermDrafts,
    remainingSelectedFinalized,
    ...locks,
  };
}
