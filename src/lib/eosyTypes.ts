export type EosySectionState = "FINALIZED" | "PARTIAL" | "NOT_STARTED" | "EMPTY";

export interface EosyFinalizationSectionStatus {
  sectionId: string;
  sectionName: string;
  gradeLevel: string;
  program: string;
  sectionStatus: string;
  adviserName: string | null;
  enrollmentCount: number;
  withStoredStatus: number;
  draftBlockerCount: number;
  finalized: boolean;
  state: EosySectionState;
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
