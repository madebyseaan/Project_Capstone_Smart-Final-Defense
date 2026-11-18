/**
 * gradeFinalization.ts — Term-finalization seal helpers.
 *
 * A class assignment + term is sealed when at least one Grade row is
 * FINALIZED. Sealed terms reject every teacher write path unless the teacher
 * has an active correction window opened by the registrar.
 */

import type { Term } from "@prisma/client";
import { prisma } from "./prisma";

export interface TermFinalizationBlock {
  code: "TERM_FINALIZED";
  message: string;
  finalizedCount: number;
}

export async function isClassTermFinalized(
  classAssignmentId: string,
  term: Term,
): Promise<boolean> {
  const row = await prisma.grade.findFirst({
    where: { classAssignmentId, term, status: "FINALIZED" },
    select: { id: true },
  });
  return !!row;
}

export async function getTermFinalizationBlock(
  classAssignmentId: string,
  term: Term,
): Promise<TermFinalizationBlock | null> {
  const finalizedCount = await prisma.grade.count({
    where: { classAssignmentId, term, status: "FINALIZED" },
  });
  if (finalizedCount === 0) return null;
  return {
    code: "TERM_FINALIZED",
    message: `Grades for ${term} are finalized. Request a correction or contact the registrar.`,
    finalizedCount,
  };
}

export async function hasActiveCorrectionWindow(opts: {
  teacherUserId: string;
  classAssignmentId: string;
  term: Term;
  schoolYear: string;
}): Promise<boolean> {
  const row = await prisma.gradeEditRequest.findFirst({
    where: {
      teacherId: opts.teacherUserId,
      classAssignmentId: opts.classAssignmentId,
      term: opts.term,
      schoolYear: opts.schoolYear,
      windowRequired: true,
      status: "WINDOW_OPEN",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return !!row;
}

async function isAwaitingRefinalization(opts: {
  classAssignmentId: string;
  term: Term;
  schoolYear: string;
}): Promise<boolean> {
  const now = new Date();
  const row = await prisma.gradeEditRequest.findFirst({
    where: {
      classAssignmentId: opts.classAssignmentId,
      term: opts.term,
      schoolYear: opts.schoolYear,
      windowRequired: true,
      OR: [
        { status: "EXPIRED" },
        { status: "WINDOW_OPEN", expiresAt: { lte: now } },
      ],
    },
    select: { id: true },
  });
  return !!row;
}

/**
 * Returns the seal block unless the teacher has an active correction window.
 * Used by write routes so the error precedence stays:
 * locks -> finalization/window.
 *
 * After a window expires the grades are DRAFT but still locked to the teacher:
 * only the registrar can re-finalize them.
 */
export async function getWriteBlock(opts: {
  teacherUserId: string;
  classAssignmentId: string;
  term: Term;
  schoolYear: string;
}): Promise<TermFinalizationBlock | null> {
  const windowOpen = await hasActiveCorrectionWindow(opts);
  if (windowOpen) return null;

  const block = await getTermFinalizationBlock(opts.classAssignmentId, opts.term);
  if (block) return block;

  const awaiting = await isAwaitingRefinalization(opts);
  if (awaiting) {
    return {
      code: "TERM_FINALIZED",
      message: `The correction window for ${opts.term} has ended. Waiting for the registrar to re-finalize.`,
      finalizedCount: 0,
    };
  }

  return null;
}
