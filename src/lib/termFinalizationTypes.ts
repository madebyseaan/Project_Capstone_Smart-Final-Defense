export type TermName = "T1" | "T2" | "T3";

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

export interface TermFinalizationActionResponse {
  message: string;
  warning?: string;
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

export type TermGradeStatus = "DRAFT" | "FINALIZED" | "LOCKED" | "NO_GRADE";

export interface TermGradeSubject {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  quarterlyGrade: number | null;
  initialGrade: number | null;
  writtenWorkPS: number | null;
  perfTaskPS: number | null;
  quarterlyAssessPS: number | null;
  status: TermGradeStatus | string;
  rotationTermGroupId?: string | null;
  rotationTermRank?: number | null;
  rotationOutputLabel?: string | null;
}

export interface TermGradeStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  lrn: string;
  enrollmentStatus?: string;
  subjects: TermGradeSubject[];
  average: number | null;
  totalSubjects: number;
  gradedSubjects: number;
}

export interface TermGradesResponse {
  sectionId: string;
  term: string;
  students: TermGradeStudent[];
}

export interface TermFinalizeStatusTerm {
  draft: number;
  finalized: number;
  locked: number;
  total: number;
  isComplete: boolean;
}

export interface TermFinalizeStatusSubject {
  subjectId: string;
  subjectName: string;
  subjectIds: string[];
  terms: Record<TermName, TermFinalizeStatusTerm>;
  totalDraft: number;
  totalFinalized: number;
  totalLocked: number;
  totalGrades: number;
  isComplete: boolean;
}
