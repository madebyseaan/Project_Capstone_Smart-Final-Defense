/**
 * gradeLocks.ts — Per-year and per-term grade lock state + edit guard chain.
 *
 * Lock precedence (A1):
 *   archived → YEAR lock → TERM lock (APPROVED GradeEditRequest bypasses) → legacy system-wide gradeLock
 * Only registrar unfinalize + admin unlock open a YEAR/archived lock.
 */

import { Term } from "@prisma/client";
import { prisma } from "./prisma";

export type LockBlockCode = "ARCHIVED" | "YEAR_LOCKED" | "TERM_LOCKED" | "SYSTEM_LOCKED";

export interface LockBlock {
  code: LockBlockCode;
  message: string;
  term?: Term;
}

export interface GradeLockState {
  systemLocked: boolean;
  yearLocked: boolean;
  termLocks: Record<Term, boolean>;
}

export interface LockActor {
  id: string;
  name: string;
}

export async function resolveSchoolYearByLabel(label: string) {
  return prisma.schoolYear.findUnique({ where: { label } });
}

export async function getGradeLockState(schoolYearLabel: string): Promise<GradeLockState> {
  const [settings, year] = await Promise.all([
    prisma.systemSettings.findUnique({ where: { id: "main" }, select: { gradeLock: true } }),
    resolveSchoolYearByLabel(schoolYearLabel),
  ]);

  const termLocks: Record<Term, boolean> = { T1: false, T2: false, T3: false };
  let yearLocked = false;

  if (year) {
    const [yearLock, termLockRows] = await Promise.all([
      prisma.yearGradeLock.findUnique({ where: { schoolYearId: year.id } }),
      prisma.termGradeLock.findMany({ where: { schoolYearId: year.id } }),
    ]);
    yearLocked = yearLock?.isLocked ?? false;
    for (const row of termLockRows) {
      termLocks[row.term] = row.isLocked;
    }
  }

  return {
    systemLocked: settings?.gradeLock ?? false,
    yearLocked,
    termLocks,
  };
}

export async function hasApprovedEditRequest(teacherUserId: string, term: Term, schoolYear: string): Promise<boolean> {
  const req = await prisma.gradeEditRequest.findFirst({
    where: {
      teacherId: teacherUserId,
      term,
      schoolYear,
      status: "APPROVED",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return !!req;
}

export async function checkGradeEditLocks(opts: {
  teacherUserId: string;
  schoolYearLabel: string;
  term: Term;
  isArchived?: boolean;
}): Promise<LockBlock | null> {
  if (opts.isArchived) {
    return {
      code: "ARCHIVED",
      message: "Cannot edit archived grades. This school year has been finalized.",
    };
  }

  const state = await getGradeLockState(opts.schoolYearLabel);

  if (state.yearLocked) {
    return {
      code: "YEAR_LOCKED",
      message: `Grade editing is locked for school year ${opts.schoolYearLabel}. Contact registrar/admin to unlock.`,
    };
  }

  if (state.termLocks[opts.term]) {
    const approved = await hasApprovedEditRequest(opts.teacherUserId, opts.term, opts.schoolYearLabel);
    if (!approved) {
      return {
        code: "TERM_LOCKED",
        term: opts.term,
        message: `Grade editing is locked for ${opts.term} of school year ${opts.schoolYearLabel}. An approved edit request is required to edit locked terms.`,
      };
    }
  }

  if (state.systemLocked) {
    return {
      code: "SYSTEM_LOCKED",
      message: "Grade editing is locked. Contact admin to unlock.",
    };
  }

  return null;
}

export async function setYearLock(
  schoolYearId: string,
  locked: boolean,
  actor: LockActor
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.yearGradeLock.findUnique({ where: { schoolYearId } });
    if (existing?.isLocked === locked) return;
    if (!existing) {
      await tx.yearGradeLock.create({
        data: {
          schoolYearId,
          isLocked: locked,
          lockedBy: locked ? actor.id : null,
          lockedAt: locked ? new Date() : null,
          unlockedBy: locked ? null : actor.id,
          unlockedAt: locked ? null : new Date(),
        },
      });
    } else {
      await tx.yearGradeLock.update({
        where: { schoolYearId },
        data: {
          isLocked: locked,
          lockedBy: locked ? actor.id : existing.lockedBy,
          lockedAt: locked ? new Date() : existing.lockedAt,
          unlockedBy: locked ? null : actor.id,
          unlockedAt: locked ? null : new Date(),
        },
      });
    }
  });
}

export async function setTermLock(
  schoolYearId: string,
  term: Term,
  locked: boolean,
  actor: LockActor
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.termGradeLock.findUnique({
      where: { schoolYearId_term: { schoolYearId, term } },
    });
    if (existing?.isLocked === locked) return;
    if (!existing) {
      await tx.termGradeLock.create({
        data: {
          schoolYearId,
          term,
          isLocked: locked,
          lockedBy: locked ? actor.id : null,
          lockedAt: locked ? new Date() : null,
          unlockedBy: locked ? null : actor.id,
          unlockedAt: locked ? null : new Date(),
        },
      });
    } else {
      await tx.termGradeLock.update({
        where: { schoolYearId_term: { schoolYearId, term } },
        data: {
          isLocked: locked,
          lockedBy: locked ? actor.id : existing.lockedBy,
          lockedAt: locked ? new Date() : existing.lockedAt,
          unlockedBy: locked ? null : actor.id,
          unlockedAt: locked ? null : new Date(),
        },
      });
    }
  });
}
