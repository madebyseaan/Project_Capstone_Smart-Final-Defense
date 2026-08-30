/**
 * rollover.ts — Year rollover detection + guardrail + archive logic.
 *
 * Called from schoolYearResolver.ts when ensureSchoolYearFromEnrollPro
 * links a NEW year (different from current). Uses Postgres advisory lock
 * to prevent concurrent rollover processing from overlapping syncs.
 */

import { AuditAction, AuditSeverity, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { setYearLock } from "./gradeLocks";
import { listUnfinalizedSections } from "./promotion";
import { createAuditLog } from "./audit";
import { broadcastSseEvent } from "./sseManager";
import { getActiveSchoolYearLabel } from "./schoolYearResolver";

const ROLLOVER_ADVISORY_KEY = 738291;

export interface RolloverResult {
  action: "archived" | "locked_not_archived" | "no_change";
  previousYearId: string;
  previousYearLabel: string;
  newYearId: string;
  newYearLabel: string;
  unfinalizedCount?: number;
}

export interface ArchiveSchoolYearResult {
  ok: boolean;
  error?: string;
  schoolYearId: string;
  yearLabel: string;
}

// ---------------------------------------------------------------------------
// archiveYearInTx — the SINGLE archive core. Receives a Prisma transaction
// client. Never opens its own transaction or acquires advisory locks.
// Contains: idempotency check, snapshot-gap check, all five archive writes,
// legacy gradeLock reset.
// ---------------------------------------------------------------------------
async function archiveYearInTx(
  tx: Prisma.TransactionClient,
  opts: { schoolYearId: string; yearLabel: string; reason: string }
): Promise<{ outcome: "archived" | "no_change" | "error"; error?: string }> {
  const { schoolYearId, yearLabel, reason } = opts;

  const year = await tx.schoolYear.findUnique({ where: { id: schoolYearId } });
  if (!year) {
    return { outcome: "error", error: "School year not found" };
  }
  if (year.status === "ARCHIVED") {
    return { outcome: "no_change" };
  }

  // Snapshot gap check: verify EOSY snapshots exist for all finalized grades
  const [finalizedCounts, snapshotCounts] = await Promise.all([
    tx.grade.groupBy({
      by: ["classAssignmentId"],
      where: { classAssignment: { schoolYear: yearLabel }, status: "FINALIZED" },
      _count: { id: true },
    }),
    tx.gradeSnapshot.groupBy({
      by: ["sectionId"],
      where: { schoolYear: yearLabel, snapshot: { path: ["source"], equals: "EOSY_FINALIZE" } },
      _count: { id: true },
    }),
  ]);

  const cas = await tx.classAssignment.findMany({
    where: { schoolYear: yearLabel },
    select: { id: true, sectionId: true },
  });
  const caToSection = new Map(cas.map((ca) => [ca.id, ca.sectionId]));

  const finalizedBySection = new Map<string, number>();
  for (const fc of finalizedCounts) {
    const sectionId = caToSection.get(fc.classAssignmentId);
    if (sectionId) {
      finalizedBySection.set(sectionId, (finalizedBySection.get(sectionId) ?? 0) + fc._count.id);
    }
  }

  const snapshotsBySection = new Map(snapshotCounts.map((sc) => [sc.sectionId, sc._count.id]));

  const gapSections: string[] = [];
  for (const [sectionId, finalCount] of finalizedBySection) {
    const snapCount = snapshotsBySection.get(sectionId) ?? 0;
    if (snapCount < finalCount) {
      const section = await tx.section.findUnique({ where: { id: sectionId }, select: { name: true } });
      gapSections.push(section?.name ?? sectionId);
    }
  }
  if (gapSections.length > 0) {
    return { outcome: "error", error: `Snapshot gap detected for sections: ${gapSections.join(", ")}. Finalize EOSY before archiving.` };
  }

  // All five archive writes + legacy gradeLock reset
  await tx.grade.updateMany({
    where: { classAssignment: { schoolYear: yearLabel } },
    data: { isArchived: true, archivedReason: reason },
  });
  await tx.enrollment.updateMany({
    where: { schoolYear: yearLabel },
    data: { isArchived: true, archivedReason: reason },
  });
  await tx.section.updateMany({
    where: { schoolYear: yearLabel },
    data: { status: "COMPLETED", archivedAt: new Date() },
  });
  await tx.classAssignment.updateMany({
    where: { schoolYear: yearLabel },
    data: { isActive: false, archivedAt: new Date(), archivedReason: reason },
  });
  await tx.schoolYear.update({
    where: { id: schoolYearId },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  await tx.systemSettings.update({
    where: { id: "main" },
    data: { gradeLock: false },
  });

  return { outcome: "archived" };
}

// ---------------------------------------------------------------------------
// archiveSchoolYear — public entry point for manual admin archive.
// Wraps archiveYearInTx in its own transaction with advisory lock.
// Post-transaction: year lock, audit log, SSE broadcast.
// ---------------------------------------------------------------------------
export async function archiveSchoolYear(opts: {
  schoolYearId: string;
  yearLabel: string;
  actor: { id: string; name: string };
  reason: string;
}): Promise<ArchiveSchoolYearResult> {
  const { schoolYearId, yearLabel, actor, reason } = opts;

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLLOVER_ADVISORY_KEY})`;
    return archiveYearInTx(tx, { schoolYearId, yearLabel, reason });
  });

  if (txResult.outcome === "error") {
    return { ok: false, error: txResult.error, schoolYearId, yearLabel };
  }
  if (txResult.outcome === "no_change") {
    return { ok: true, schoolYearId, yearLabel };
  }

  // Post-transaction side-effects
  await setYearLock(schoolYearId, true, actor);

  let activeYearLabel: string;
  try {
    activeYearLabel = await getActiveSchoolYearLabel();
  } catch {
    activeYearLabel = "unknown";
  }

  await createAuditLog(
    AuditAction.CONFIG,
    { id: actor.id, firstName: actor.name, lastName: "", role: "ADMIN" },
    `School Year Archive: ${yearLabel}`,
    "Config",
    `${reason}. New year ${activeYearLabel} active.`,
    undefined,
    AuditSeverity.WARNING
  );

  broadcastSseEvent("SCHOOL_YEAR_ROLLOVER", {
    action: "archived",
    previousYear: yearLabel,
    newYear: activeYearLabel,
  });

  logger.info(`[Rollover] ${yearLabel} archived. ${reason}`);
  return { ok: true, schoolYearId, yearLabel };
}

// ---------------------------------------------------------------------------
// handleYearChangeRollover — auto-rollover triggered by school year change.
// Uses archiveYearInTx inside its transaction (no duplicate writes).
// RETHROWS on archive failure so schoolYearResolver can revert the FK.
// ---------------------------------------------------------------------------
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

  // Fail-safe: lock the previous year FIRST so it's at least locked if archive fails
  await setYearLock(previousSchoolYearId, true, actor);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLLOVER_ADVISORY_KEY})`;

    const prevYear = await tx.schoolYear.findUnique({ where: { id: previousSchoolYearId } });
    if (!prevYear || prevYear.status === "ARCHIVED") {
      return { outcome: "no_change" as const };
    }

    const unfinalized = await listUnfinalizedSections(previousYearLabel);

    if (unfinalized.length === 0) {
      // Use the shared core — includes snapshot-gap check + all archive writes
      const archiveResult = await archiveYearInTx(tx, {
        schoolYearId: previousSchoolYearId,
        yearLabel: previousYearLabel,
        reason: `Rollover: ${previousYearLabel} archived`,
      });
      return archiveResult;
    }

    return { outcome: "locked_not_archived" as const, unfinalizedCount: unfinalized.length, unfinalized };
  });

  if (result.outcome === "no_change") {
    return { action: "no_change", previousYearId: previousSchoolYearId, previousYearLabel, newYearId: newSchoolYearId, newYearLabel };
  }

  if (result.outcome === "error") {
    // Rethrow so schoolYearResolver's catch fires → FK revert → self-healing retry
    throw new Error(`Rollover archive failed: ${result.error}`);
  }

  // Post-transaction side-effects (outside the advisory lock scope)
  if (result.outcome === "archived") {
    await createAuditLog(
      AuditAction.CONFIG,
      { id: "system", firstName: "System", lastName: "", role: "ADMIN" },
      `School Year Rollover: ${previousYearLabel} → ${newYearLabel}`,
      "Config",
      `Previous year ${previousYearLabel} fully finalized — archived cleanly. New year ${newYearLabel} activated.`,
      undefined,
      AuditSeverity.WARNING
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
  if (result.outcome === "locked_not_archived") {
    await createAuditLog(
      AuditAction.CONFIG,
      { id: "system", firstName: "System", lastName: "", role: "ADMIN" },
      `School Year Rollover Blocked: ${previousYearLabel}`,
      "Config",
      `Rollover detected: ${previousYearLabel} has ${result.unfinalizedCount} unfinalized section(s). Year locked but NOT archived. Admin action required.`,
      undefined,
      AuditSeverity.WARNING
    );

    broadcastSseEvent("SCHOOL_YEAR_ROLLOVER", {
      action: "locked_not_archived",
      previousYear: previousYearLabel,
      newYear: newYearLabel,
      unfinalizedCount: result.unfinalizedCount,
      unfinalizedSections: result.unfinalized.map((s) => ({ id: s.sectionId, name: s.sectionName, draftBlockerCount: s.draftBlockerCount })),
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
  }

  // Should not reach here, but handle gracefully
  return { action: "no_change", previousYearId: previousSchoolYearId, previousYearLabel, newYearId: newSchoolYearId, newYearLabel };
}
