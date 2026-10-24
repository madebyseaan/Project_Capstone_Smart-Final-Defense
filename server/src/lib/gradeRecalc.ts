/**
 * gradeRecalc.ts — Keep stored grade derivations aligned with the live
 * GradingConfig weights and TransmutationEntry table.
 *
 * The class-record ledger (src/lib/gradeMath.ts) and POST /api/grades/grade
 * always display/recompute:
 *     initialGrade   = WW PS × ww% + PT PS × pt% + QA PS × qa%
 *     quarterlyGrade = transmute(initialGrade)
 * with the CURRENT weights (subject override → subject-type GradingConfig →
 * generic fallback) and the CURRENT transmutation table.
 *
 * Registrar surfaces (dashboard, EOSY, SF9/SF10, EnrollPro sync) read the
 * stored `initialGrade`/`quarterlyGrade` columns instead. When an admin edits
 * weights or the transmutation table, those stored columns go stale and the
 * teacher and registrar sides diverge. `recomputeStoredGrades()` re-derives
 * them from the stored category PS values so every surface agrees.
 *
 * Raw scores are never touched — only the derived columns.
 */

import { prisma } from "./prisma";
import { logger } from "./logger";
import {
  resolveEffectiveWeightsForClassAssignment,
  transmute,
} from "../routes/grades-sub/helpers";

export interface RecomputeSummary {
  scanned: number;
  updated: number;
  unrecomputable: number;
  durationMs: number;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Recompute `initialGrade` / `quarterlyGrade` for every stored grade using the
 * current weights and transmutation table. Idempotent: rows already matching
 * the canonical formula are not written. Concurrent calls are serialized so a
 * run always picks up the latest config (never coalesced with a stale run).
 */
export function recomputeStoredGrades(): Promise<RecomputeSummary> {
  const next = queue.then(() => run());
  queue = next.catch(() => {});
  return next;
}

async function run(): Promise<RecomputeSummary> {
  const startedAt = Date.now();

  const grades = await prisma.grade.findMany({
    select: {
      id: true,
      classAssignmentId: true,
      writtenWorkPS: true,
      perfTaskPS: true,
      quarterlyAssessPS: true,
      initialGrade: true,
      quarterlyGrade: true,
    },
  });

  const weightsCache = new Map<string, { ww: number; pt: number; qa: number }>();
  const updates: Array<{ id: string; initialGrade: number; quarterlyGrade: number }> = [];
  let unrecomputable = 0;

  for (const g of grades) {
    if (
      g.writtenWorkPS === null ||
      g.perfTaskPS === null ||
      g.quarterlyAssessPS === null
    ) {
      if (g.initialGrade !== null || g.quarterlyGrade !== null) unrecomputable++;
      continue;
    }

    let weights = weightsCache.get(g.classAssignmentId);
    if (!weights) {
      const resolved = await resolveEffectiveWeightsForClassAssignment(g.classAssignmentId);
      weights = { ww: resolved.ww, pt: resolved.pt, qa: resolved.qa };
      weightsCache.set(g.classAssignmentId, weights);
    }

    const initial =
      (g.writtenWorkPS * weights.ww) / 100 +
      (g.perfTaskPS * weights.pt) / 100 +
      (g.quarterlyAssessPS * weights.qa) / 100;
    const quarterly = await transmute(initial);

    const initialUpToDate =
      g.initialGrade !== null && Math.abs(g.initialGrade - initial) <= 1e-9;
    if (!initialUpToDate || g.quarterlyGrade !== quarterly) {
      updates.push({ id: g.id, initialGrade: initial, quarterlyGrade: quarterly });
    }
  }

  const BATCH = 200;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((u) =>
        prisma.grade.update({
          where: { id: u.id },
          data: { initialGrade: u.initialGrade, quarterlyGrade: u.quarterlyGrade },
        }),
      ),
    );
  }

  const summary: RecomputeSummary = {
    scanned: grades.length,
    updated: updates.length,
    unrecomputable,
    durationMs: Date.now() - startedAt,
  };

  if (summary.updated > 0 || summary.unrecomputable > 0) {
    logger.info(
      `[GradeRecalc] Recomputed stored grades: ${summary.updated}/${summary.scanned} updated` +
        (summary.unrecomputable > 0 ? `, ${summary.unrecomputable} missing PS values (skipped)` : "") +
        ` in ${summary.durationMs}ms`,
    );
  }

  return summary;
}
