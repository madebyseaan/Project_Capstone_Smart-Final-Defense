/**
 * dataIntegrity.ts — Deployment/data-integrity checks for grade placement.
 *
 * Read-only. Detects the "ATLAS changed the subject, old grades are stranded on
 * archived assignments, new active assignment is empty" class of bug.
 */

import { prisma } from "./prisma";
import { deriveGradeValues } from "./gradeDerivation";
import { getGradingModeForSchoolYear } from "./gradingMode";
import { getTransmutationTable } from "./transmutationCache";
import { resolveEffectiveWeightsForClassAssignment } from "../routes/grades-sub/helpers";
import { hasAnyRotationField, validateRotationMetadata } from "./rotationMetadata";

export interface DataIntegrityAssignmentRef {
  id: string;
  subjectCode: string;
  subjectName: string;
  gradeCount: number;
  archivedReason: string | null;
}

export interface DataIntegrityAnomaly {
  code:
    | "ACTIVE_ASSIGNMENT_MISSING_GRADES"
    | "GRADES_ONLY_ON_ARCHIVED_ASSIGNMENTS"
    | "GRADE_DERIVATION_DRIFT"
    | "INVALID_ROTATION_METADATA";
  severity: "WARNING" | "CRITICAL";
  message: string;
  sectionId: string;
  sectionName: string;
  gradeLevel: string;
  subjectFamily: string;
  activeAssignments: DataIntegrityAssignmentRef[];
  archivedAssignmentsWithGrades: DataIntegrityAssignmentRef[];
}

export interface DataIntegrityReport {
  generatedAt: string;
  schoolYear: string;
  ok: boolean;
  anomalies: DataIntegrityAnomaly[];
  metrics: {
    sectionsChecked: number;
    subjectFamiliesChecked: number;
    activeAssignments: number;
    archivedAssignments: number;
    archivedAssignmentsWithGrades: number;
    affectedSections: number;
    affectedSubjectFamilies: number;
    gradeRowsChecked: number;
    gradeRowsDrifted: number;
    invalidRotationSubjects: number;
  };
}

function subjectFamilyKey(
  code: string | null | undefined,
  name: string | null | undefined,
  rotationOutputLabel: string | null | undefined,
): string {
  const upperCode = (code ?? "").trim().toUpperCase();
  if (upperCode.startsWith("TLE")) return "TLE";

  const label = (rotationOutputLabel ?? "").trim().toUpperCase();
  if (label) return label;

  const dashIndex = (name ?? "").indexOf(" - ");
  if (dashIndex > 0) return (name ?? "").slice(0, dashIndex).trim().toUpperCase();

  return upperCode.replace(/\d+$/, "") || (name ?? "").trim().toUpperCase();
}

export async function buildDataIntegrityReport(
  schoolYear: string,
): Promise<DataIntegrityReport> {
  const [assignments, gradeCounts] = await Promise.all([
    prisma.classAssignment.findMany({
      where: { schoolYear },
      select: {
        id: true,
        isActive: true,
        archivedReason: true,
        section: { select: { id: true, name: true, gradeLevel: true } },
        subjectId: true,
        subject: {
          select: { id: true, code: true, name: true, rotationOutputLabel: true },
        },
      },
    }),
    prisma.grade.groupBy({
      by: ["classAssignmentId"],
      where: { classAssignment: { schoolYear } },
      _count: { id: true },
    }),
  ]);

  const gradeCountByAssignment = new Map(
    gradeCounts.map((row) => [row.classAssignmentId, row._count.id]),
  );

  type FamilyGroup = {
    sectionId: string;
    sectionName: string;
    gradeLevel: string;
    subjectFamily: string;
    active: DataIntegrityAssignmentRef[];
    archivedWithGrades: DataIntegrityAssignmentRef[];
  };

  const groups = new Map<string, FamilyGroup>();
  const sections = new Set<string>();

  for (const assignment of assignments) {
    sections.add(assignment.section.id);
    const family = subjectFamilyKey(
      assignment.subject.code,
      assignment.subject.name,
      assignment.subject.rotationOutputLabel,
    );
    const key = `${assignment.section.id}::${family}`;
    const group =
      groups.get(key) ??
      {
        sectionId: assignment.section.id,
        sectionName: assignment.section.name,
        gradeLevel: assignment.section.gradeLevel,
        subjectFamily: family,
        active: [],
        archivedWithGrades: [],
      };
    groups.set(key, group);

    const ref: DataIntegrityAssignmentRef = {
      id: assignment.id,
      subjectCode: assignment.subject.code,
      subjectName: assignment.subject.name,
      gradeCount: gradeCountByAssignment.get(assignment.id) ?? 0,
      archivedReason: assignment.archivedReason,
    };

    if (assignment.isActive) {
      group.active.push(ref);
    } else if (ref.gradeCount > 0) {
      group.archivedWithGrades.push(ref);
    }
  }

  const anomalies: DataIntegrityAnomaly[] = [];
  const affectedSections = new Set<string>();

  for (const group of groups.values()) {
    // Only ATLAS_STALE_WITH_GRADES means the subject itself was replaced
    // (e.g. TLE Exploratory -> TLE7). ATLAS_REASSIGNED is a teacher change,
    // which is not a subject-family remap.
    const staleWithGrades = group.archivedWithGrades.filter(
      (assignment) => assignment.archivedReason === "ATLAS_STALE_WITH_GRADES",
    );
    if (staleWithGrades.length === 0) continue;

    const hasActiveGrades = group.active.some((assignment) => assignment.gradeCount > 0);
    if (hasActiveGrades) continue;

    const archivedTotal = staleWithGrades.reduce(
      (sum, assignment) => sum + assignment.gradeCount,
      0,
    );

    if (group.active.length > 0) {
      anomalies.push({
        code: "ACTIVE_ASSIGNMENT_MISSING_GRADES",
        severity: "CRITICAL",
        message:
          `Active ${group.subjectFamily} assignment(s) in ${group.sectionName} have no grades, ` +
          `but archived ${group.subjectFamily} assignment(s) still hold ${archivedTotal} grade row(s).`,
        sectionId: group.sectionId,
        sectionName: group.sectionName,
        gradeLevel: group.gradeLevel,
        subjectFamily: group.subjectFamily,
        activeAssignments: group.active,
        archivedAssignmentsWithGrades: staleWithGrades,
      });
      affectedSections.add(group.sectionId);
    } else {
      anomalies.push({
        code: "GRADES_ONLY_ON_ARCHIVED_ASSIGNMENTS",
        severity: "WARNING",
        message:
          `${group.sectionName} has no active ${group.subjectFamily} assignment, ` +
          `but archived assignment(s) still hold ${archivedTotal} grade row(s).`,
        sectionId: group.sectionId,
        sectionName: group.sectionName,
        gradeLevel: group.gradeLevel,
        subjectFamily: group.subjectFamily,
        activeAssignments: group.active,
        archivedAssignmentsWithGrades: staleWithGrades,
      });
      affectedSections.add(group.sectionId);
    }
  }

  // ── Grade derivation drift (Class Record live recompute vs stored fields) ──
  const gradingMode = await getGradingModeForSchoolYear(schoolYear);
  const transmutationTable = await getTransmutationTable();
  const weightsCache = new Map<string, { ww: number; pt: number; qa: number }>();
  const gradeRows = await prisma.grade.findMany({
    where: { classAssignment: { is: { schoolYear, isActive: true } } },
    select: {
      id: true,
      classAssignmentId: true,
      writtenWorkScores: true,
      perfTaskScores: true,
      examScores: true,
      quarterlyAssessScore: true,
      quarterlyAssessMax: true,
      writtenWorkPS: true,
      perfTaskPS: true,
      quarterlyAssessPS: true,
      initialGrade: true,
      quarterlyGrade: true,
      classAssignment: {
        select: {
          id: true,
          sectionId: true,
          subject: { select: { code: true, name: true } },
          section: { select: { name: true, gradeLevel: true } },
        },
      },
    },
  });

  const driftBySection = new Map<string, {
    sectionName: string;
    gradeLevel: string;
    checked: number;
    drifted: number;
    byAssignment: Map<string, DataIntegrityAssignmentRef>;
  }>();
  let gradeRowsChecked = 0;
  let gradeRowsDrifted = 0;

  for (const grade of gradeRows) {
    let weights = weightsCache.get(grade.classAssignmentId);
    if (!weights) {
      const resolved = await resolveEffectiveWeightsForClassAssignment(grade.classAssignmentId);
      weights = { ww: resolved.ww, pt: resolved.pt, qa: resolved.qa };
      weightsCache.set(grade.classAssignmentId, weights);
    }
    const derived = deriveGradeValues(
      {
        writtenWorkScores: grade.writtenWorkScores,
        perfTaskScores: grade.perfTaskScores,
        examScores: grade.examScores,
        quarterlyAssessScore: grade.quarterlyAssessScore,
        quarterlyAssessMax: grade.quarterlyAssessMax,
        storedWrittenWorkPS: grade.writtenWorkPS,
        storedPerfTaskPS: grade.perfTaskPS,
        storedQuarterlyAssessPS: grade.quarterlyAssessPS,
      },
      weights,
      gradingMode,
      transmutationTable,
    );
    if (derived.quarterlyGrade === null) continue;
    gradeRowsChecked += 1;

    const drifted =
      derived.quarterlyGrade !== grade.quarterlyGrade ||
      (derived.quarterlyAssessPS !== null && grade.quarterlyAssessPS !== null && Math.abs(derived.quarterlyAssessPS - grade.quarterlyAssessPS) > 1e-6);
    if (!drifted) continue;
    gradeRowsDrifted += 1;

    const sectionId = grade.classAssignment.sectionId;
    if (!driftBySection.has(sectionId)) {
      driftBySection.set(sectionId, {
        sectionName: grade.classAssignment.section.name,
        gradeLevel: grade.classAssignment.section.gradeLevel,
        checked: 0,
        drifted: 0,
        byAssignment: new Map(),
      });
    }
    const bucket = driftBySection.get(sectionId)!;
    bucket.drifted += 1;
    const assignmentKey = grade.classAssignment.id;
    const ref = bucket.byAssignment.get(assignmentKey) ?? {
      id: assignmentKey,
      subjectCode: grade.classAssignment.subject.code,
      subjectName: grade.classAssignment.subject.name,
      gradeCount: 0,
      archivedReason: null,
    };
    ref.gradeCount += 1;
    bucket.byAssignment.set(assignmentKey, ref);
  }

  for (const [sectionId, bucket] of driftBySection) {
    const checkedInSection = gradeRows.filter((row) => row.classAssignment.sectionId === sectionId).length || bucket.drifted;
    bucket.checked = checkedInSection;
    const ratio = bucket.drifted / Math.max(checkedInSection, 1);
    anomalies.push({
      code: "GRADE_DERIVATION_DRIFT",
      severity: ratio > 0.05 ? "CRITICAL" : "WARNING",
      message:
        `${bucket.sectionName} has ${bucket.drifted} stored grade row(s) that disagree with the Class Record recompute ` +
        `(${Math.round(ratio * 100)}% of ${checkedInSection}). Run scripts/repair-grade-derivations.ts.`,
      sectionId,
      sectionName: bucket.sectionName,
      gradeLevel: bucket.gradeLevel,
      subjectFamily: "All subjects",
      activeAssignments: [...bucket.byAssignment.values()],
      archivedAssignmentsWithGrades: [],
    });
    affectedSections.add(sectionId);
  }

  // ── Invalid subject rotation metadata ──
  const rotationSubjects = await prisma.subject.findMany({
    where: {
      OR: [
        { rotationTermGroupId: { not: null } },
        { rotationTermRank: { not: null } },
        { rotationOutputLabel: { not: null } },
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      rotationTermGroupId: true,
      rotationTermRank: true,
      rotationOutputLabel: true,
    },
  });
  let invalidRotationSubjects = 0;
  for (const subject of rotationSubjects) {
    const fields = {
      code: subject.code,
      rotationTermGroupId: subject.rotationTermGroupId,
      rotationTermRank: subject.rotationTermRank,
      rotationOutputLabel: subject.rotationOutputLabel,
    };
    if (!hasAnyRotationField(fields)) continue;
    const validation = validateRotationMetadata(fields);
    if (validation.valid) continue;
    invalidRotationSubjects += 1;
    const hasActiveAssignment = assignments.some((assignment) => assignment.subjectId === subject.id && assignment.isActive);
    anomalies.push({
      code: "INVALID_ROTATION_METADATA",
      severity: hasActiveAssignment ? "CRITICAL" : "WARNING",
      message: `Subject ${subject.code} has inconsistent rotation metadata (${validation.reason}). Run scripts/repair-rotation-metadata.ts.`,
      sectionId: "",
      sectionName: subject.code,
      gradeLevel: "",
      subjectFamily: subject.name,
      activeAssignments: [],
      archivedAssignmentsWithGrades: [],
    });
  }

  anomalies.sort((a, b) =>
    a.sectionName.localeCompare(b.sectionName) ||
    a.subjectFamily.localeCompare(b.subjectFamily),
  );

  const archivedAssignments = assignments.filter((assignment) => !assignment.isActive);
  const archivedAssignmentsWithGrades = archivedAssignments.filter(
    (assignment) => (gradeCountByAssignment.get(assignment.id) ?? 0) > 0,
  );

  return {
    generatedAt: new Date().toISOString(),
    schoolYear,
    ok: anomalies.length === 0,
    anomalies,
    metrics: {
      sectionsChecked: sections.size,
      subjectFamiliesChecked: groups.size,
      activeAssignments: assignments.filter((assignment) => assignment.isActive).length,
      archivedAssignments: archivedAssignments.length,
      archivedAssignmentsWithGrades: archivedAssignmentsWithGrades.length,
      affectedSections: affectedSections.size,
      affectedSubjectFamilies: new Set(
        anomalies.map((anomaly) => `${anomaly.sectionId}::${anomaly.subjectFamily}`),
      ).size,
      gradeRowsChecked,
      gradeRowsDrifted,
      invalidRotationSubjects,
    },
  };
}


