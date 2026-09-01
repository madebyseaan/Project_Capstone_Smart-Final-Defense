/**
 * prune.test.ts — Tests for the strict SSOT prune engine.
 * Uses a fake year label (2105-2106) that never collides with real data.
 * Seeds fixture data, calls runPrune with injected EP sets, asserts results.
 * Cleanup removes all seeded data regardless of prune outcome.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { runPrune, type PruneInputs } from "../lib/prune";

const YEAR = "2105-2106";
const HISTORY_YEAR = "2104-2105";

// IDs created during seed
let schoolYearId = "";
let historyYearId = "";
let sectionId = "";
let historySectionId = "";
let studentId = "";
let historyStudentId = "";
let teacherId = "";
let teacherUserId = "";
let orphanUserId = "";
let orphanUsername = "";
let subjectId = "";
let classAssignmentId = "";
let historyClassAssignmentId = "";

const LRN_ACTIVE = `LRN-PRUNE-ACTIVE-${Date.now()}`;
const LRN_HISTORY = `LRN-PRUNE-HISTORY-${Date.now() + 1}`;
const LRN_STALE = `LRN-PRUNE-STALE-${Date.now() + 2}`;
const EMP_ACTIVE = `EMP-PRUNE-ACTIVE-${Date.now()}`;
const EMP_STALE = `EMP-PRUNE-STALE-${Date.now() + 1}`;

async function seedBase() {
  // School years
  const sy = await prisma.schoolYear.create({ data: { label: YEAR, status: "ACTIVE", externalId: 888801 } });
  schoolYearId = sy.id;
  const hy = await prisma.schoolYear.create({ data: { label: HISTORY_YEAR, status: "ARCHIVED", externalId: 888800 } });
  historyYearId = hy.id;

  // Subject
  const subj = await prisma.subject.create({ data: { code: "T-PRUNE", name: "Prune Test Subject" } });
  subjectId = subj.id;

  // Teacher with active year data (will be kept — in EP)
  const tUser = await prisma.user.create({
    data: { username: EMP_ACTIVE, password: "hashed", role: "TEACHER" },
  });
  teacherUserId = tUser.id;
  const teacher = await prisma.teacher.create({
    data: { userId: tUser.id, employeeId: EMP_ACTIVE },
  });
  teacherId = teacher.id;

  // Orphan TEACHER user (no Teacher row, not in EP)
  orphanUsername = `orphan-${Date.now()}`;
  const orphan = await prisma.user.create({
    data: { username: orphanUsername, password: "hashed", role: "TEACHER" },
  });
  orphanUserId = orphan.id;

  // Active-year section
  const sec = await prisma.section.create({
    data: { name: "Prune Section", schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
  });
  sectionId = sec.id;

  // History-year section (should survive prune)
  const hSec = await prisma.section.create({
    data: { name: "History Section", schoolYear: HISTORY_YEAR, gradeLevel: "GRADE_7", status: "ARCHIVED" },
  });
  historySectionId = hSec.id;

  // Active student (will be kept — in EP)
  const student = await prisma.student.create({
    data: { lrn: LRN_ACTIVE, firstName: "Active", lastName: "Student", gender: "Male" },
  });
  studentId = student.id;

  // History student (should survive prune)
  const hStudent = await prisma.student.create({
    data: { lrn: LRN_HISTORY, firstName: "History", lastName: "Student", gender: "Male" },
  });
  historyStudentId = hStudent.id;

  // Class assignments
  const ca = await prisma.classAssignment.create({
    data: { sectionId, schoolYear: YEAR, subjectId, teacherId, isActive: true },
  });
  classAssignmentId = ca.id;

  const hCa = await prisma.classAssignment.create({
    data: { sectionId: historySectionId, schoolYear: HISTORY_YEAR, subjectId, teacherId, isActive: true },
  });
  historyClassAssignmentId = hCa.id;

  // Enrollments
  await prisma.enrollment.create({
    data: { studentId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
  });
  await prisma.enrollment.create({
    data: { studentId: historyStudentId, sectionId: historySectionId, schoolYear: HISTORY_YEAR, status: "ENROLLED" },
  });

  // Grades
  await prisma.grade.create({
    data: { studentId, classAssignmentId, term: "T1", quarterlyGrade: 85, status: "DRAFT" },
  });
  await prisma.grade.create({
    data: { studentId: historyStudentId, classAssignmentId: historyClassAssignmentId, term: "T1", quarterlyGrade: 90, status: "FINALIZED" },
  });

  // Grade snapshots
  await prisma.gradeSnapshot.create({
    data: {
      studentId, classAssignmentId, teacherId, subjectCode: "T-PRUNE", subjectName: "Prune Test Subject",
      sectionId, sectionName: "Prune Section", schoolYear: YEAR, term: "T1", snapshot: { test: true },
    },
  });
}

async function cleanup() {
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: { in: [YEAR, HISTORY_YEAR] } } }).catch(() => {});
  await prisma.grade.deleteMany({ where: { classAssignmentId: { in: [classAssignmentId, historyClassAssignmentId] } } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: { in: [YEAR, HISTORY_YEAR] } } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { schoolYear: { in: [YEAR, HISTORY_YEAR] } } }).catch(() => {});
  await prisma.section.deleteMany({ where: { schoolYear: { in: [YEAR, HISTORY_YEAR] } } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: subjectId } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { lrn: { in: [LRN_ACTIVE, LRN_HISTORY, LRN_STALE] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [teacherUserId, orphanUserId] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { username: { startsWith: 'orphan-' } } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: { in: [YEAR, HISTORY_YEAR] } } }).catch(() => {});
}

describe("runPrune", () => {
  beforeAll(async () => {
    await cleanup();
    await seedBase();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("empty EP set injection → ABORT, nothing changed", async () => {
    const result = await runPrune({
      activeYearLabel: YEAR,
      epFacultyEmployeeIds: new Set(),
      epLearnerLrns: new Set(),
      epSectionKeys: new Set(),
      epEnrollmentPairs: new Set(),
      dryRun: false,
      maxDeletionRatio: 0.5,
    });

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toContain("CIRCUIT_BREAKER");

    // Verify nothing was deleted
    expect(await prisma.teacher.count({ where: { employeeId: EMP_ACTIVE } })).toBe(1);
    expect(await prisma.section.count({ where: { schoolYear: YEAR } })).toBe(1);
  });

  it("circuit breaker trips when ratio exceeded", async () => {
    const result = await runPrune({
      activeYearLabel: YEAR,
      epFacultyEmployeeIds: new Set(), // all teachers stale
      epLearnerLrns: new Set(), // all students stale
      epSectionKeys: new Set(), // all sections stale
      epEnrollmentPairs: new Set(),
      dryRun: false,
      maxDeletionRatio: 0.1, // very low threshold — will trip
    });

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toContain("CIRCUIT_BREAKER");
  });

  it("dry-run → identical plan counts, zero writes", async () => {
    const result = await runPrune({
      activeYearLabel: YEAR,
      epFacultyEmployeeIds: new Set([EMP_ACTIVE]),
      epLearnerLrns: new Set([LRN_ACTIVE]),
      epSectionKeys: new Set(["Prune Section:GRADE_7"]),
      epEnrollmentPairs: new Set([`${LRN_ACTIVE}:Prune Section:GRADE_7`]),
      dryRun: true,
      maxDeletionRatio: 0.5,
    });

    expect(result.aborted).toBe(false);
    expect(result.dryRun).toBe(true);

    // Nothing should be deleted
    expect(await prisma.teacher.count({ where: { employeeId: EMP_ACTIVE } })).toBe(1);
    expect(await prisma.section.count({ where: { schoolYear: YEAR } })).toBe(1);
    expect(await prisma.student.count({ where: { lrn: LRN_ACTIVE } })).toBe(1);
  });

  it("stale teacher with history → SUSPENDED, not deleted", async () => {
    // Re-seed if previous test deleted things
    await cleanup();
    await seedBase();

    const result = await runPrune({
      activeYearLabel: YEAR,
      epFacultyEmployeeIds: new Set(["nonexistent"]), // EMP_ACTIVE is stale
      epLearnerLrns: new Set([LRN_ACTIVE]),
      epSectionKeys: new Set(["Prune Section:GRADE_7"]),
      epEnrollmentPairs: new Set([`${LRN_ACTIVE}:Prune Section:GRADE_7`]),
      dryRun: false,
      maxDeletionRatio: 1.0,
    });

    expect(result.aborted).toBe(false);
    expect(result.phases.teachersSuspended).toBe(1);

    // User should be SUSPENDED, not deleted
    const user = await prisma.user.findUnique({ where: { id: teacherUserId } });
    expect(user).toBeTruthy();
    expect(user!.status).toBe("SUSPENDED");
    expect(user!.suspendedBy).toBe("prune-engine");

    // Teacher row still exists (has history)
    expect(await prisma.teacher.count({ where: { id: teacherId } })).toBe(1);

    // Active-year CAs deleted, history CAs intact
    expect(await prisma.classAssignment.count({ where: { id: classAssignmentId } })).toBe(0);
    expect(await prisma.classAssignment.count({ where: { id: historyClassAssignmentId } })).toBe(1);

    // Active-year snapshots deleted
    expect(await prisma.gradeSnapshot.count({ where: { schoolYear: YEAR, teacherId } })).toBe(0);
  });

  it("orphan TEACHER user not in EP → deleted", async () => {
    await cleanup();
    await seedBase();

    const result = await runPrune({
      activeYearLabel: YEAR,
      epFacultyEmployeeIds: new Set([EMP_ACTIVE]),
      epLearnerLrns: new Set([LRN_ACTIVE]),
      epSectionKeys: new Set(["Prune Section:GRADE_7"]),
      epEnrollmentPairs: new Set([`${LRN_ACTIVE}:Prune Section:GRADE_7`]),
      dryRun: false,
      maxDeletionRatio: 1.0,
    });

    expect(result.aborted).toBe(false);
    expect(result.phases.orphanUsersDeleted).toBe(1);

    // Orphan user should be gone
    expect(await prisma.user.findUnique({ where: { id: orphanUserId } })).toBeNull();
  });

  it("stale section → deleted + snapshots cleaned", async () => {
    await cleanup();
    await seedBase();

    const result = await runPrune({
      activeYearLabel: YEAR,
      epFacultyEmployeeIds: new Set([EMP_ACTIVE]),
      epLearnerLrns: new Set([LRN_ACTIVE]),
      epSectionKeys: new Set(), // no sections in EP
      epEnrollmentPairs: new Set(),
      dryRun: false,
      maxDeletionRatio: 1.0,
    });

    expect(result.aborted).toBe(false);
    expect(result.phases.sectionsDeleted).toBe(1);

    // Active-year section gone
    expect(await prisma.section.count({ where: { id: sectionId } })).toBe(0);

    // History section intact
    expect(await prisma.section.count({ where: { id: historySectionId } })).toBe(1);
  });

  it("stale student no history → Student deleted", async () => {
    await cleanup();
    await seedBase();

    // Create a stale student (not in EP)
    const staleStudent = await prisma.student.create({
      data: { lrn: LRN_STALE, firstName: "Stale", lastName: "Student", gender: "Male" },
    });
    await prisma.enrollment.create({
      data: { studentId: staleStudent.id, sectionId, schoolYear: YEAR, status: "ENROLLED" },
    });

    const result = await runPrune({
      activeYearLabel: YEAR,
      epFacultyEmployeeIds: new Set([EMP_ACTIVE]),
      epLearnerLrns: new Set([LRN_ACTIVE]),
      epSectionKeys: new Set(["Prune Section:GRADE_7"]),
      epEnrollmentPairs: new Set([`${LRN_ACTIVE}:Prune Section:GRADE_7`]),
      dryRun: false,
      maxDeletionRatio: 1.0,
    });

    expect(result.aborted).toBe(false);
    expect(result.phases.studentsDeleted).toBeGreaterThanOrEqual(1);

    // Stale student gone
    expect(await prisma.student.findUnique({ where: { lrn: LRN_STALE } })).toBeNull();
  });

  it("stale student WITH history → active-year data deleted, student kept", async () => {
    await cleanup();
    await seedBase();

    // Create a stale enrollment for the history student (has enrollment in HISTORY_YEAR)
    await prisma.enrollment.create({
      data: { studentId: historyStudentId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
    });

    const result = await runPrune({
      activeYearLabel: YEAR,
      epFacultyEmployeeIds: new Set([EMP_ACTIVE]),
      epLearnerLrns: new Set([LRN_ACTIVE]), // historyStudent not in EP
      epSectionKeys: new Set(["Prune Section:GRADE_7"]),
      epEnrollmentPairs: new Set([`${LRN_ACTIVE}:Prune Section:GRADE_7`]),
      dryRun: false,
      maxDeletionRatio: 1.0,
    });

    expect(result.aborted).toBe(false);

    // Active-year enrollment deleted
    const activeEnrollment = await prisma.enrollment.findFirst({
      where: { studentId: historyStudentId, schoolYear: YEAR },
    });
    expect(activeEnrollment).toBeNull();

    // History enrollment intact
    const historyEnrollment = await prisma.enrollment.findFirst({
      where: { studentId: historyStudentId, schoolYear: HISTORY_YEAR },
    });
    expect(historyEnrollment).toBeTruthy();

    // Student still exists (has history)
    expect(await prisma.student.findUnique({ where: { id: historyStudentId } })).toBeTruthy();
  });

  it("all in-EP data → no deletions", async () => {
    await cleanup();
    await seedBase();

    const result = await runPrune({
      activeYearLabel: YEAR,
      epFacultyEmployeeIds: new Set([EMP_ACTIVE, orphanUsername]),
      epLearnerLrns: new Set([LRN_ACTIVE]),
      epSectionKeys: new Set(["Prune Section:GRADE_7"]),
      epEnrollmentPairs: new Set([`${LRN_ACTIVE}:Prune Section:GRADE_7`]),
      dryRun: false,
      maxDeletionRatio: 0.5,
    });

    expect(result.aborted).toBe(false);
    expect(result.phases.teachersSuspended).toBe(0);
    expect(result.phases.teachersDeleted).toBe(0);
    expect(result.phases.orphanUsersDeleted).toBe(0);
    expect(result.phases.sectionsDeleted).toBe(0);
    expect(result.phases.studentsDeleted).toBe(0);

    // All data intact
    expect(await prisma.teacher.count({ where: { id: teacherId } })).toBe(1);
    expect(await prisma.section.count({ where: { schoolYear: YEAR } })).toBe(1);
    expect(await prisma.student.count({ where: { lrn: LRN_ACTIVE } })).toBe(1);
  });
});
