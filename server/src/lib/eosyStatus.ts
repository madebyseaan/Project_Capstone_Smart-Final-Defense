/**
 * eosyStatus.ts — Year-level EOSY finalization status for the registrar board.
 *
 * Read-only composition of:
 *   - per-section promotion finalization (promotion.ts)
 *   - EOSY snapshot gaps (rollover.ts)
 *
 * No EnrollPro/ATLAS writes or reads. The page must stay usable while
 * EnrollPro is offline because finalization state lives in the SMART DB.
 */

import { prisma } from "./prisma";
import {
  listSectionEosyStatuses,
  type SectionEosyFinalizationStatus,
} from "./promotion";
import { findSnapshotGapSections } from "./rollover";

export interface EosyFinalizationSectionStatus extends SectionEosyFinalizationStatus {
  snapshotGap: boolean;
  finalizedGradeCount: number | null;
  snapshotCount: number | null;
}

export interface EosyFinalizationSummary {
  totalSections: number;
  finalizedSections: number;
  emptySections: number;
  partialSections: number;
  notStartedSections: number;
  sectionsWithDraftBlockers: number;
  totalLearners: number;
  learnersWithStoredStatus: number;
  totalDraftBlockers: number;
  snapshotGapSections: number;
  allPromotionsFinalized: boolean;
  readyForRollover: boolean;
}

export interface EosyFinalizationOverview {
  schoolYear: string;
  yearFound: boolean;
  yearStatus: string | null;
  generatedAt: string;
  summary: EosyFinalizationSummary;
  sections: EosyFinalizationSectionStatus[];
}

export async function buildEosyFinalizationOverview(
  schoolYear: string,
): Promise<EosyFinalizationOverview> {
  const [year, sectionStatuses, snapshotGaps] = await Promise.all([
    prisma.schoolYear.findUnique({
      where: { label: schoolYear },
      select: { status: true },
    }),
    listSectionEosyStatuses(schoolYear),
    findSnapshotGapSections(schoolYear),
  ]);

  const gapBySection = new Map(snapshotGaps.map((gap) => [gap.sectionId, gap]));
  const sections: EosyFinalizationSectionStatus[] = sectionStatuses.map((status) => {
    const gap = gapBySection.get(status.sectionId);
    return {
      ...status,
      snapshotGap: !!gap,
      finalizedGradeCount: gap?.finalizedCount ?? null,
      snapshotCount: gap?.snapshotCount ?? null,
    };
  });

  const summary = sections.reduce<EosyFinalizationSummary>(
    (acc, section) => {
      acc.totalSections += 1;
      if (section.state === "FINALIZED") acc.finalizedSections += 1;
      if (section.state === "EMPTY") acc.emptySections += 1;
      if (section.state === "PARTIAL") acc.partialSections += 1;
      if (section.state === "NOT_STARTED") acc.notStartedSections += 1;
      if (section.draftBlockerCount > 0) acc.sectionsWithDraftBlockers += 1;
      acc.totalLearners += section.enrollmentCount;
      acc.learnersWithStoredStatus += section.withStoredStatus;
      acc.totalDraftBlockers += section.draftBlockerCount;
      return acc;
    },
    {
      totalSections: 0,
      finalizedSections: 0,
      emptySections: 0,
      partialSections: 0,
      notStartedSections: 0,
      sectionsWithDraftBlockers: 0,
      totalLearners: 0,
      learnersWithStoredStatus: 0,
      totalDraftBlockers: 0,
      snapshotGapSections: snapshotGaps.length,
      allPromotionsFinalized: false,
      readyForRollover: false,
    },
  );

  summary.allPromotionsFinalized =
    sections.length > 0 && sections.every((section) => section.finalized);
  summary.readyForRollover =
    summary.allPromotionsFinalized && summary.snapshotGapSections === 0;

  return {
    schoolYear,
    yearFound: !!year,
    yearStatus: year?.status ?? null,
    generatedAt: new Date().toISOString(),
    summary,
    sections,
  };
}
