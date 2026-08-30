/**
 * rollover.ts — Year rollover detection + guardrail + archive logic.
 *
 * Called from schoolYearResolver.ts when ensureSchoolYearFromEnrollPro
 * links a NEW year (different from current). Uses Postgres advisory lock
 * to prevent concurrent rollover processing from overlapping syncs.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { setYearLock } from "./gradeLocks";
import { listUnfinalizedSections } from "./promotion";
import { createAuditLog } from "./audit";
import { broadcastSseEvent } from "./sseManager";

const ROLLOVER_ADVISORY_KEY = 738291;

export interface RolloverResult {
  action: "archived" | "locked_not_archived" | "no_change";
  previousYearId: string;
  previousYearLabel: string;
  newYearId: string;
  newYearLabel: string;
  unfinalizedCount?: number;
}

export async function handleYearChangeRollover(
  previousSchoolYearId: string,
  previousYearLabel: string,
  newSchoolYearId: string,
  newYearLabel: string
): Promise<RolloverResult> {
  if (previousSchoolYearId === newSchoolYearId) {
    return { action: "no_change", previousYearId: previousSchoolYearId, previousYearLabel, newYearId: newSchoolYearId, newYearLabel };
  }

  const actor = { id: "system", name: "Rollover Scheduler" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Acquire advisory lock — held until this transaction commits or rolls back
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLLOVER_ADVISORY_KEY})`;

      // Idempotency guard: if previous year already archived, short-circuit
      const prevYear = await tx.schoolYear.findUnique({ where: { id: previousSchoolYearId } });
      if (!prevYear || prevYear.status === "ARCHIVED") {
        return { outcome: "no_change" as const };
      }

      const unfinalized = await listUnfinalizedSections(previousYearLabel);

      if (unfinalized.length === 0) {
        await tx.grade.updateMany({
          where: { classAssignment: { schoolYear: previousYearLabel } },
          data: { isArchived: true, archivedReason: `Rollover: ${previousYearLabel} archived` },
        });
        await tx.enrollment.updateMany({
          where: { schoolYear: previousYearLabel },
          data: { isArchived: true, archivedReason: `Rollover: ${previousYearLabel} archived` },
        });
        await tx.section.updateMany({
          where: { schoolYear: previousYearLabel },
          data: { status: "COMPLETED", archivedAt: new Date() },
        });
        await tx.classAssignment.updateMany({
          where: { schoolYear: previousYearLabel },
          data: { isActive: false, archivedAt: new Date(), archivedReason: `Rollover: ${previousYearLabel} archived` },
        });
        await tx.schoolYear.update({
          where: { id: previousSchoolYearId },
          data: { status: "ARCHIVED", archivedAt: new Date() },
        });
        await tx.systemSettings.update({
          where: { id: "main" },
          data: { gradeLock: false },
        });
        return { outcome: "archived" as const, unfinalizedCount: 0 };
      }

      return { outcome: "locked_not_archived" as const, unfinalizedCount: unfinalized.length, unfinalized };
    });

    if (result.outcome === "no_change") {
      return { action: "no_change", previousYearId: previousSchoolYearId, previousYearLabel, newYearId: newSchoolYearId, newYearLabel };
    }

    // Post-transaction side-effects (outside the advisory lock scope)
    await setYearLock(previousSchoolYearId, true, actor);

    if (result.outcome === "archived") {
      await createAuditLog(
        "CONFIG" as any,
        { id: "system", username: "system", role: "ADMIN" } as any,
        `School Year Rollover: ${previousYearLabel} → ${newYearLabel}`,
        "Config",
        `Previous year ${previousYearLabel} fully finalized — archived cleanly. New year ${newYearLabel} activated.`,
        undefined,
        "WARNING" as any
      );

      broadcastSseEvent("SCHOOL_YEAR_ROLLOVER", {
        action: "archived",
        previousYear: previousYearLabel,
        newYear: newYearLabel,
      });

      logger.info(`[Rollover] ${previousYearLabel} fully finalized — archived cleanly. ${newYearLabel} activated.`);
      return {
        action: "archived",
        previousYearId: previousSchoolYearId,
        previousYearLabel,
        newYearId: newSchoolYearId,
        newYearLabel,
        unfinalizedCount: 0,
      };
    }

    // locked_not_archived
    await createAuditLog(
      "CONFIG" as any,
      { id: "system", username: "system", role: "ADMIN" } as any,
      `School Year Rollover Blocked: ${previousYearLabel}`,
      "Config",
      `Rollover detected: ${previousYearLabel} has ${result.unfinalizedCount} unfinalized section(s). Year locked but NOT archived. Admin action required.`,
      undefined,
      "WARNING" as any
    );

    broadcastSseEvent("SCHOOL_YEAR_ROLLOVER", {
      action: "locked_not_archived",
      previousYear: previousYearLabel,
      newYear: newYearLabel,
      unfinalizedCount: result.unfinalizedCount,
      unfinalizedSections: result.unfinalized!.map((s) => ({ id: s.sectionId, name: s.sectionName, draftBlockerCount: s.draftBlockerCount })),
    });

    logger.warn(`[Rollover] ${previousYearLabel} has ${result.unfinalizedCount} unfinalized section(s) — locked but NOT archived. Admin action required.`);

    return {
      action: "locked_not_archived",
      previousYearId: previousSchoolYearId,
      previousYearLabel,
      newYearId: newSchoolYearId,
      newYearLabel,
      unfinalizedCount: result.unfinalizedCount,
    };
  } catch (err) {
    logger.error(`[Rollover] Transaction failed: ${err}`);
    return { action: "no_change", previousYearId: previousSchoolYearId, previousYearLabel, newYearId: newSchoolYearId, newYearLabel };
  }
}
