/**
 * gradeRecalc.ts — Keep stored grade derivations aligned with the live
 * GradingConfig weights and TransmutationEntry table.
 *
 * The class-record ledger (src/lib/gradeMath.ts) and POST /api/grades/grade
 * always display/recompute:
 *     initialGrade   = WW PS × ww% + PT PS × pt% + QA PS × qa%
 *     quarterlyGrade = computeTermGrade(initialGrade, schoolYearMode, table)
 * with the CURRENT weights (subject override → subject-type GradingConfig →
 * generic fallback) and the CURRENT grading mode for each grade's school year.
 *
 * Registrar surfaces (dashboard, EOSY, SF9/SF10, EnrollPro sync) read the
 * stored `initialGrade`/`quarterlyGrade` columns instead. When an admin edits
 * weights, the transmutation table, or the grading mode, those stored columns
 * go stale and the teacher and registrar sides diverge. `recomputeStoredGrades()`
 * re-derives them from the stored category PS values so every surface agrees.
 *
 * Raw scores are never touched — only the derived columns.
 */

import { GradingMode } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { getTransmutationTable } from "./transmutationCache";
import { computeTermGrade, getGradingModeForSchoolYear } from "./gradingMode";
import { resolveEffectiveWeightsForClassAssignment } from "../routes/grades-sub/helpers";

export interface RecomputeOptions {
  schoolYear?: string;
  modeOverride?: GradingMode;
}

export interface RecomputeSummary {
  scanned: number;
  updated: number;
  unrecomputable: number;
  durationMs: number;
  byMode: Record<GradingMode, number>;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Recompute `initialGrade` / `quarterlyGrade` for stored grades using the
 * current weights, the current table, and each grade's school-year mode.
 * Idempotent: rows already matching the canonical formula are not written.
 * Concurrent calls are serialized so a run always picks up the latest config.
 */
export function recomputeStoredGrades(options: RecomputeOptions = {}): Promise<RecomputeSummary> {
  const next = queue.then(() => run(options));
  queue = next.catch(() => {});
  return next;
}

async function run(options: RecomputeOptions): Promise<RecomputeSummary> {
  const startedAt = Date.now();

  const grades = await prisma.grade.findMany({
    where: options.schoolYear
      ? { classAssignment: { is: { schoolYear: options.schoolYear } } }
      : undefined,
    select: {
      id: true,
      classAssignmentId: true,
      writtenWorkPS: true,
      perfTaskPS: true,
      quarterlyAssessPS: true,
      initialGrade: true,
      quarterlyGrade: true,
      classAssignment: { select: { schoolYear: true } },
    },
  });

  const weightsCache = new Map<string, { ww: number; pt: number; qa: number }>();
  const modeCache = new Map<string, GradingMode>();
  const updates: Array<{ id: string; initialGrade: number; quarterlyGrade: number }> = [];
  const byMode: Record<GradingMode, number> = {
    [GradingMode.TRANSMUTED]: 0,
    [GradingMode.ZERO_BASED]: 0,
  };
  let unrecomputable = 0;
  let table: Awaited<ReturnType<typeof getTransmutationTable>> | null = null;

  for (const g of grades) {
    const schoolYear = g.classAssignment.schoolYear;
    let mode = options.modeOverride ?? modeCache.get(schoolYear);
    if (!mode) {
      mode = await getGradingModeForSchoolYear(schoolYear);
      modeCache.set(schoolYear, mode);
    }
    byMode[mode] += 1;

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

    if (!table) {
      table = await getTransmutationTable();
    }
    const quarterly = computeTermGrade(initial, mode, table);

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
    byMode,
  };

  if (summary.updated > 0 || summary.unrecomputable > 0) {
    logger.info(
      `[GradeRecalc] Recomputed stored grades: ${summary.updated}/${summary.scanned} updated` +
        (summary.unrecomputable > 0 ? `, ${summary.unrecomputable} missing PS values (skipped)` : "") +
        ` (TRANSMUTED=${byMode[GradingMode.TRANSMUTED]}, ZERO_BASED=${byMode[GradingMode.ZERO_BASED]})` +
        ` in ${summary.durationMs}ms`,
    );
  }

  return summary;
}
