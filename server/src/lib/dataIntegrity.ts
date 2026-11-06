/**
 * dataIntegrity.ts — Deployment/data-integrity checks for grade placement.
 *
 * Read-only. Detects the "ATLAS changed the subject, old grades are stranded on
 * archived assignments, new active assignment is empty" class of bug.
 */

import { prisma } from "./prisma";

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
    | "GRADES_ONLY_ON_ARCHIVED_ASSIGNMENTS";
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
        subject: {
          select: { code: true, name: true, rotationOutputLabel: true },
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
    },
  };
}
