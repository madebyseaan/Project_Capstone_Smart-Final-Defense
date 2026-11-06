/**
 * data-integrity.test.ts — grade placement integrity.
 *
 * Locks the ATLAS remap guard:
 *   - active assignment empty + archived same-family grades => CRITICAL
 *   - no active assignment + archived grades => WARNING
 *   - active grades present => healthy
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { buildDataIntegrityReport } from "../lib/dataIntegrity";

const YEAR = "2095-2096";

let teacherUserId = "";
let teacherId = "";
let studentId = "";
const subjectIds: string[] = [];
const sectionIds: string[] = [];
const classAssignmentIds: string[] = [];

async function cleanup() {
  await prisma.grade.deleteMany({ where: { classAssignment: { schoolYear: YEAR } } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.section.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
}

beforeAll(async () => {
  const suffix = Date.now();
  await cleanup();

  const teacherUser = await prisma.user.create({
    data: {
      username: `t-data-integrity-${suffix}`,
      password: "hashed",
      role: "TEACHER",
      status: "ACTIVE",
    },
  });
  teacherUserId = teacherUser.id;
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `EMP-DATA-INTEGRITY-${suffix}` },
  });
  teacherId = teacher.id;

  const student = await prisma.student.create({
    data: { lrn: `LRN-DATA-INTEGRITY-${suffix}`, firstName: "Data", lastName: "Integrity" },
  });
  studentId = student.id;

  const activeTle = await prisma.subject.create({
    data: {
      code: `TLE7-${suffix}`,
      name: `Technology and Livelihood Education 7 ${suffix}`,
    },
  });
  const archivedIct = await prisma.subject.create({
    data: {
      code: `TLE_ICT_EXP7-${suffix}`,
      name: `TLE Exploratory - ICT 7 ${suffix}`,
      rotationTermGroupId: "TLE_EXPLORATORY",
      rotationTermRank: 1,
      rotationOutputLabel: "TLE",
    },
  });
  const archivedFcs = await prisma.subject.create({
    data: {
      code: `TLE_FCS_EXP7-${suffix}`,
      name: `TLE Exploratory - Family and Consumer Science 7 ${suffix}`,
      rotationTermGroupId: "TLE_EXPLORATORY",
      rotationTermRank: 3,
      rotationOutputLabel: "TLE",
    },
  });
  const math = await prisma.subject.create({
    data: { code: `MATH7-${suffix}`, name: `Mathematics 7 ${suffix}` },
  });
  subjectIds.push(activeTle.id, archivedIct.id, archivedFcs.id, math.id);

  await prisma.schoolYear.create({ data: { label: YEAR, status: "ACTIVE" } });

  const makeSection = async (name: string) => {
    const section = await prisma.section.create({
      data: { name, schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
    });
    sectionIds.push(section.id);
    return section;
  };

  const assign = async (
    sectionId: string,
    subjectId: string,
    isActive: boolean,
    withGrade: boolean,
    archivedReason = "ATLAS_STALE_WITH_GRADES",
  ) => {
    const assignment = await prisma.classAssignment.create({
      data: {
        sectionId,
        subjectId,
        teacherId,
        schoolYear: YEAR,
        isActive,
        ...(isActive ? {} : { archivedAt: new Date(), archivedReason }),
      },
    });
    classAssignmentIds.push(assignment.id);
    if (withGrade) {
      await prisma.grade.create({
        data: {
          studentId,
          classAssignmentId: assignment.id,
          term: "T1",
          writtenWorkScores: [],
          perfTaskScores: [],
        },
      });
    }
    return assignment;
  };

  const stranded = await makeSection("Stranded Section");
  await assign(stranded.id, activeTle.id, true, false);
  await assign(stranded.id, archivedIct.id, false, true);

  const healthy = await makeSection("Healthy Section");
  await assign(healthy.id, activeTle.id, true, true);
  await assign(healthy.id, archivedIct.id, false, true);

  const archivedOnly = await makeSection("Archived Only Section");
  await assign(archivedOnly.id, archivedFcs.id, false, true);

  const clean = await makeSection("Clean Section");
  await assign(clean.id, math.id, true, false);

  const reassigned = await makeSection("Reassigned Section");
  await assign(reassigned.id, activeTle.id, true, false);
  await assign(reassigned.id, archivedIct.id, false, true, "ATLAS_REASSIGNED");
});

afterAll(async () => {
  await cleanup();
  await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: studentId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: teacherUserId } }).catch(() => {});
});

describe("buildDataIntegrityReport", () => {
  it("flags an empty active TLE assignment when archived TLE grades exist", async () => {
    const report = await buildDataIntegrityReport(YEAR);
    const anomaly = report.anomalies.find(
      (item) => item.sectionName === "Stranded Section",
    );

    expect(report.ok).toBe(false);
    expect(anomaly).toBeDefined();
    expect(anomaly?.code).toBe("ACTIVE_ASSIGNMENT_MISSING_GRADES");
    expect(anomaly?.severity).toBe("CRITICAL");
    expect(anomaly?.subjectFamily).toBe("TLE");
    expect(anomaly?.activeAssignments[0]?.gradeCount).toBe(0);
    expect(anomaly?.archivedAssignmentsWithGrades[0]?.gradeCount).toBe(1);
  });

  it("flags grades stranded only on archived assignments", async () => {
    const report = await buildDataIntegrityReport(YEAR);
    const anomaly = report.anomalies.find(
      (item) => item.sectionName === "Archived Only Section",
    );

    expect(anomaly).toBeDefined();
    expect(anomaly?.code).toBe("GRADES_ONLY_ON_ARCHIVED_ASSIGNMENTS");
    expect(anomaly?.severity).toBe("WARNING");
    expect(anomaly?.subjectFamily).toBe("TLE");
  });

  it("does not flag healthy or clean sections", async () => {
    const report = await buildDataIntegrityReport(YEAR);
    const names = report.anomalies.map((item) => item.sectionName);

    expect(names).not.toContain("Healthy Section");
    expect(names).not.toContain("Clean Section");
    expect(names).not.toContain("Reassigned Section");
    expect(report.metrics.sectionsChecked).toBe(5);
    expect(report.metrics.affectedSections).toBe(2);
  });
});
