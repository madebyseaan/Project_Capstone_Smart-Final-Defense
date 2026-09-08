/**
 * aimsScoreSync.ts — AIMS score sync (Step 5 of the unified sync cycle).
 *
 * For each ClassAssignment where aimsCourseId != null:
 *   1. GET /public/courses/:id/scores from AIMS
 *   2. Date-bin gradedAt → T1/T2/T3 using SystemSettings term end dates
 *   3. Dedup: keep latest attempt per (enrollproId, assessmentId)
 *   4. Match students by Student.enrollproId (with live fallback)
 *   5. Upsert AimsScore rows (idempotent)
 *   6. Stale sweep: remove non-imported scores absent from current pull
 *
 * Fail-soft: AIMS offline = skipped step, never breaks the sync cycle.
 */

import { Term } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import {
  isAimsConfigured,
  getAimsPublicScores,
} from './aimsClient';
import { getEnrollProStudentDetail } from './enrollproClient';
import { aimsPublicScoresSchema } from '../schemas/aims';
import type { AimsPublicScoresPayload } from '../schemas/aims';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AimsSyncResult {
  status: 'ok' | 'partial' | 'skipped' | 'offline';
  coursesSynced: number;
  scoresUpserted: number;
  unmatched: Array<{ classAssignmentId: string; enrollproId: number | null; studentName: string; studentEmail: string | null }>;
  lastSyncedAt: string | null;
  reason?: string;
}

export interface TermEndDates {
  t1EndDate: Date | null;
  t2EndDate: Date | null;
  t3EndDate: Date | null;
}

interface CourseProcessResult {
  scoresUpserted: number;
  unmatched: Array<{ classAssignmentId: string; enrollproId: number | null; studentName: string; studentEmail: string | null }>;
}

// ---------------------------------------------------------------------------
// Helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function binTerm(gradedAt: Date, endDates: TermEndDates): Term | null {
  if (!endDates.t1EndDate && !endDates.t2EndDate && !endDates.t3EndDate) {
    return null; // No term dates configured
  }

  if (endDates.t1EndDate && gradedAt <= endDates.t1EndDate) return 'T1';
  if (endDates.t2EndDate && gradedAt <= endDates.t2EndDate) return 'T2';
  if (endDates.t3EndDate && gradedAt <= endDates.t3EndDate) return 'T3';

  return null; // After all term end dates
}

/**
 * Pick the latest attempt per (enrollproId, assessmentId).
 * Tie-break: latest gradedAt.
 */
export function dedupLatestAttempt(rows: AimsPublicScoresPayload['rows']): AimsPublicScoresPayload['rows'] {
  const byKey = new Map<string, AimsPublicScoresPayload['rows'][number]>();

  for (const row of rows) {
    if (!row.gradedAt) continue; // Skip ungraded
    const key = `${row.enrollproId}:${row.assessmentId}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, row);
      continue;
    }

    // Higher attemptNumber wins; tie-break by gradedAt
    if (row.attemptNumber > existing.attemptNumber) {
      byKey.set(key, row);
    } else if (row.attemptNumber === existing.attemptNumber) {
      const existingDate = new Date(existing.gradedAt!).getTime();
      const currentDate = new Date(row.gradedAt!).getTime();
      if (currentDate > existingDate) {
        byKey.set(key, row);
      }
    }
  }

  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Testable inner processor (exported for lib-level tests)
// ---------------------------------------------------------------------------

/**
 * Process validated AIMS score data for a single class assignment.
 * Extracted from the sync loop so tests can inject fabricated AIMS payloads
 * without hitting the real AIMS API or running the full sync cycle.
 *
 * @param classAssignmentId - The SMART class assignment ID
 * @param validatedData - Already-validated AIMS scores payload
 * @param termEndDates - Term date boundaries for binning
 * @param epResolveCache - Per-run cache for EnrollPro student lookups (avoids N× API calls)
 */
export async function processAimsCourseData(
  classAssignmentId: string,
  validatedData: AimsPublicScoresPayload,
  termEndDates: TermEndDates,
  epResolveCache?: Map<number, { studentId: string } | null>,
): Promise<CourseProcessResult> {
  const localCache = epResolveCache ?? new Map<number, { studentId: string } | null>();
  const unmatched: CourseProcessResult['unmatched'] = [];
  let scoresUpserted = 0;

  // Cache course metadata for the read endpoint
  const { syncCache } = await import('./syncCache');
  syncCache.set(`aims:course:${validatedData.course.id}`, validatedData.course, 3600_000);
  syncCache.set(`aims:weights:${validatedData.course.id}`, validatedData.weights, 3600_000);

  // ⚠️ NEVER add ?termIndex= to the scores pull — our stale-sweep deletes non-imported
  // rows absent from the current pull. A term-filtered pull would wipe other terms' rows.
  // Always pull ALL rows and bin locally using termIndex (preferred) or date (fallback).

  // 4. Dedup: latest attempt per (enrollproId, assessmentId)
  const dedupedRows = dedupLatestAttempt(validatedData.rows);

  // P0-1 FIX: Build sweep key-set from ALL deduped rows, BEFORE binning.
  // Binning only decides WHERE a row lands, not whether it still exists upstream.
  const currentAssessmentIds = new Set(dedupedRows.map(r => r.assessmentId));
  let unbinnedCount = 0;

  // 5. Process each deduped row
  for (const row of dedupedRows) {
    const gradedAt = row.gradedAt ? new Date(row.gradedAt) : null;
    if (!gradedAt) continue;

    // termIndex is authoritative when present (active EP term at grade time).
    // Null = pre-feature row or EP offline at grade time → fall back to date binning.
    const term = row.termIndex === 1 || row.termIndex === 2 || row.termIndex === 3
      ? (`T${row.termIndex}` as Term)
      : binTerm(gradedAt, termEndDates);
    if (!term) {
      unbinnedCount++;
      continue;
    }

    // P0-2 FIX: AIMS-native students have enrollproId=null — skip DB lookup, go straight to unmatched
    if (row.enrollproId == null) {
      unmatched.push({
        classAssignmentId,
        enrollproId: null,
        studentName: row.studentName,
        studentEmail: row.studentEmail,
      });
      continue;
    }

    // Match student by enrollproId
    let student = await prisma.student.findUnique({
      where: { enrollproId: row.enrollproId },
      select: { id: true },
    });

    // P1-4 FIX: Live fallback with per-run cache (avoids N× API calls for same student)
    if (!student) {
      if (!localCache.has(row.enrollproId)) {
        let resolved: { studentId: string } | null = null;
        try {
          const epDetail = await getEnrollProStudentDetail(row.enrollproId);
          if (epDetail?.lrn) {
            const found = await prisma.student.findUnique({
              where: { lrn: epDetail.lrn },
              select: { id: true },
            });
            if (found) {
              await prisma.student.update({
                where: { id: found.id },
                data: { enrollproId: row.enrollproId },
              }).catch(() => {}); // Non-fatal if unique constraint fails
              resolved = { studentId: found.id };
            }
          }
        } catch {
          // Non-fatal — student just stays unmatched
        }
        localCache.set(row.enrollproId, resolved);
      }
      const cached = localCache.get(row.enrollproId);
      if (cached) student = { id: cached.studentId };
    }

    if (!student) {
      unmatched.push({
        classAssignmentId,
        enrollproId: row.enrollproId,
        studentName: row.studentName,
        studentEmail: row.studentEmail,
      });
      continue;
    }

    // 6. Upsert AimsScore
    try {
      await prisma.aimsScore.upsert({
        where: {
          classAssignmentId_studentId_assessmentId: {
            classAssignmentId,
            studentId: student.id,
            assessmentId: row.assessmentId,
          },
        },
        update: {
          term,
          assessmentTitle: row.quizTitle,
          type: row.type,
          category: row.category,
          score: row.score,
          pointsEarned: row.pointsEarned,
          maxPoints: row.maxPoints,
          isRemedial: row.isRemedial,
          attemptNumber: row.attemptNumber,
          gradedAt,
          syncedAt: new Date(),
        },
        create: {
          classAssignmentId,
          studentId: student.id,
          term,
          assessmentId: row.assessmentId,
          assessmentTitle: row.quizTitle,
          type: row.type,
          category: row.category,
          score: row.score,
          pointsEarned: row.pointsEarned,
          maxPoints: row.maxPoints,
          isRemedial: row.isRemedial,
          attemptNumber: row.attemptNumber,
          gradedAt,
        },
      });
      scoresUpserted++;
    } catch (upsertErr: any) {
      logger.warn(`[AimsSync] Upsert failed for ${row.assessmentId}/${row.enrollproId}: ${upsertErr.message}`);
    }
  }

  // 7. Stale sweep: delete non-imported scores absent from current pull
  const staleScores = await prisma.aimsScore.findMany({
    where: {
      classAssignmentId,
      assessmentId: { notIn: Array.from(currentAssessmentIds) },
      importedAt: null, // Never delete imported rows (provenance)
    },
    select: { id: true },
  });

  if (staleScores.length > 0) {
    await prisma.aimsScore.deleteMany({
      where: { id: { in: staleScores.map(s => s.id) } },
    });
    logger.debug(`[AimsSync] Swept ${staleScores.length} stale non-imported scores for ${classAssignmentId}`);
  }

  if (unbinnedCount > 0) {
    logger.debug(`[AimsSync] ${unbinnedCount} rows skipped (gradedAt outside term windows) for ${classAssignmentId}`);
  }

  return { scoresUpserted, unmatched };
}

// ---------------------------------------------------------------------------
// Single-course sync (P2-1: fire-and-forget from link route)
// ---------------------------------------------------------------------------

/**
 * Sync AIMS scores for a single class assignment.
 * Used by the link route to trigger an immediate per-course sync
 * without spinning the entire unified cycle.
 */
export async function syncAimsScoresForAssignment(classAssignmentId: string): Promise<CourseProcessResult> {
  if (!isAimsConfigured()) {
    return { scoresUpserted: 0, unmatched: [] };
  }

  const assignment = await prisma.classAssignment.findUnique({
    where: { id: classAssignmentId },
    select: { aimsCourseId: true },
  });
  if (!assignment?.aimsCourseId) {
    return { scoresUpserted: 0, unmatched: [] };
  }

  const scoresData = await getAimsPublicScores(assignment.aimsCourseId);
  if (!scoresData) return { scoresUpserted: 0, unmatched: [] };

  const parsed = aimsPublicScoresSchema.safeParse(scoresData);
  if (!parsed.success) return { scoresUpserted: 0, unmatched: [] };

  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'main' },
    select: { t1EndDate: true, t2EndDate: true, t3EndDate: true },
  });

  const termEndDates: TermEndDates = {
    t1EndDate: settings?.t1EndDate ?? null,
    t2EndDate: settings?.t2EndDate ?? null,
    t3EndDate: settings?.t3EndDate ?? null,
  };

  return processAimsCourseData(classAssignmentId, parsed.data, termEndDates);
}

// ---------------------------------------------------------------------------
// Full sync cycle (all linked courses)
// ---------------------------------------------------------------------------

export async function runAimsScoreSync(): Promise<AimsSyncResult> {
  if (!isAimsConfigured()) {
    return { status: 'skipped', coursesSynced: 0, scoresUpserted: 0, unmatched: [], lastSyncedAt: null, reason: 'not-configured' };
  }

  const allUnmatched: AimsSyncResult['unmatched'] = [];
  let coursesSynced = 0;
  let scoresUpserted = 0;

  try {
    // 1. Find all linked class assignments
    const linkedAssignments = await prisma.classAssignment.findMany({
      where: { aimsCourseId: { not: null } },
      include: {
        section: { select: { name: true } },
        subject: { select: { name: true } },
      },
    });

    if (linkedAssignments.length === 0) {
      return { status: 'skipped', coursesSynced: 0, scoresUpserted: 0, unmatched: [], lastSyncedAt: null, reason: 'no-linked-courses' };
    }

    // 2. Read term end dates from SystemSettings
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 'main' },
      select: { t1EndDate: true, t2EndDate: true, t3EndDate: true },
    });

    const termEndDates: TermEndDates = {
      t1EndDate: settings?.t1EndDate ?? null,
      t2EndDate: settings?.t2EndDate ?? null,
      t3EndDate: settings?.t3EndDate ?? null,
    };

    // P1-4: Per-run cache shared across all courses (avoids repeated EP calls)
    const epResolveCache = new Map<number, { studentId: string } | null>();

    // 3. Process each linked assignment
    for (const assignment of linkedAssignments) {
      const courseId = assignment.aimsCourseId!;
      const classAssignmentId = assignment.id;

      try {
        const scoresData = await getAimsPublicScores(courseId);

        if (!scoresData) {
          logger.warn(`[AimsSync] Course ${courseId} returned null (404 or error) for assignment ${classAssignmentId}`);
          continue;
        }

        // Validate response
        const parsed = aimsPublicScoresSchema.safeParse(scoresData);
        if (!parsed.success) {
          logger.warn(`[AimsSync] Invalid scores response for course ${courseId}: ${parsed.error.issues.map(i => i.message).join('; ')}`);
          continue;
        }

        const result = await processAimsCourseData(classAssignmentId, parsed.data, termEndDates, epResolveCache);
        scoresUpserted += result.scoresUpserted;
        allUnmatched.push(...result.unmatched);
        coursesSynced++;
      } catch (courseErr: any) {
        logger.warn(`[AimsSync] Failed for course ${courseId} (assignment ${classAssignmentId}): ${courseErr.message}`);
        // Continue to next course — per-course isolation
      }
    }

    const lastSyncedAt = new Date().toISOString();

    return {
      status: coursesSynced > 0 ? (allUnmatched.length > 0 ? 'partial' : 'ok') : 'offline',
      coursesSynced,
      scoresUpserted,
      unmatched: allUnmatched,
      lastSyncedAt,
    };
  } catch (err: any) {
    logger.error('[AimsSync] Fatal error:', err.message);
    return {
      status: 'offline',
      coursesSynced,
      scoresUpserted,
      unmatched: allUnmatched,
      lastSyncedAt: null,
    };
  }
}
