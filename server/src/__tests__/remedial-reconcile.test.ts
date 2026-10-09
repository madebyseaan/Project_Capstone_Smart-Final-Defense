/**
 * remedial-reconcile.test.ts — orphaned PENDING remedial rows vs promotion status.
 *
 * Covers the 2026-09-29 incident: a learner whose rotation TLE merged final is
 * passing (71/71/84 → 75) is correctly PROMOTED, but leftover never-conducted
 * PENDING strand rows made him appear in remedial History while being hidden
 * from the Pending list (which only shows CONDITIONALLY_PROMOTED enrollments).
 *
 * Rules pinned here:
 *  - finalizeSectionEosy clears never-conducted PENDING rows when the decision
 *    is not CONDITIONALLY_PROMOTED; COMPLETED / conducted rows are never touched
 *  - a passing rotation merge (75) → PROMOTED, zero rows
 *  - a failing rotation merge (< 75) → CP, exactly one canonical "TLE" row
 *  - re-finalize after a grade change removes the now-stale pending row
 *  - reconcileRemedialRows deletes untouched orphans and flags conducted ones
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { finalizeSectionEosy } from "../lib/promotion";
import { reconcileRemedialRows, getRemedialRolloverBlock } from "../lib/remedial";

const YEAR = "2099-2100";
const GROUP = "TEST_RECON_TLE";
const CODE_PREFIX = "TEST_RECON_";

let teacherId = "";
let teacherUserId = "";
let seq = 0;
const subjectIds: Record<"T1" | "T2" | "T3", string> = { T1: "", T2: "", T3: "" };
const sectionIds: string[] = [];
const studentIds: string[] = [];

async function createEnrollmentWithGrades(params: {
  t1: number;
  t2: number;
  t3: number;
  promotionStatus?: "PROMOTED" | "CONDITIONALLY_PROMOTED" | null;
}) {
  seq += 1;
  const section = await prisma.section.create({
    data: { name: `${CODE_PREFIX}Section ${seq}`, schoolYear: YEAR, gradeLevel: "GRADE_8", status: "ACTIVE" },
  });
  sectionIds.push(section.id);

  const student = await prisma.student.create({
    data: { lrn: `${CODE_PREFIX}LRN-${seq}`, firstName: "Recon", lastName: `Learner ${seq}` },
  });
  studentIds.push(student.id);

  const enrollment = await prisma.enrollment.create({
    data: {
      studentId: student.id,
      sectionId: section.id,
      schoolYear: YEAR,
      status: "ENROLLED",
      promotionStatus: params.promotionStatus ?? undefined,
      promotedToGradeLevel: params.promotionStatus === "PROMOTED" ? "GRADE_9" : undefined,
    },
  });

  const termValues: Array<{ term: "T1" | "T2" | "T3"; grade: number }> = [
    { term: "T1", grade: params.t1 },
    { term: "T2", grade: params.t2 },
    { term: "T3", grade: params.t3 },
  ];
  for (const { term, grade } of termValues) {
    const ca = await prisma.classAssignment.create({
      data: { sectionId: section.id, schoolYear: YEAR, subjectId: subjectIds[term], teacherId, isActive: true },
    });
    await prisma.grade.create({
      data: {
        studentId: student.id,
        classAssignmentId: ca.id,
        term,
        status: "FINALIZED",
        quarterlyGrade: grade,
        writtenWorkScores: [],
        perfTaskScores: [],
      },
    });
  }

  return { section, student, enrollment };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: `recon-teacher-${Date.now()}`, password: "hashed", role: "TEACHER", status: "ACTIVE" },
  });
  teacherUserId = user.id;
  const teacher = await prisma.teacher.create({
    data: { userId: user.id, employeeId: `RECON-EMP-${Date.now()}` },
  });
  teacherId = teacher.id;

  const ranks: Array<{ term: "T1" | "T2" | "T3"; rank: number }> = [
    { term: "T1", rank: 1 },
    { term: "T2", rank: 2 },
    { term: "T3", rank: 3 },
  ];
  for (const { term, rank } of ranks) {
    const subject = await prisma.subject.create({
      data: {
        code: `${CODE_PREFIX}${term}`,
        name: `Recon Strand ${term}`,
        rotationTermGroupId: GROUP,
        rotationTermRank: rank,
        rotationOutputLabel: "TLE",
      },
    });
    subjectIds[term] = subject.id;
  }
});

afterAll(async () => {
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.section.deleteMany({ where: { id: { in: sectionIds } } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: { in: studentIds } } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { rotationTermGroupId: GROUP } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: teacherUserId } }).catch(() => {});
});

describe("finalizeSectionEosy — remedial row cleanup", () => {
  it("passing rotation merge (71/71/84 → 75) is PROMOTED and clears orphaned PENDING rows", async () => {
    const { section, enrollment } = await createEnrollmentWithGrades({ t1: 71, t2: 71, t3: 84 });

    // Orphaned strand-level rows from the old seed: never conducted, wrong codes.
    await prisma.remedialClass.createMany({
      data: [
        { enrollmentId: enrollment.id, schoolYear: YEAR, gradeLevel: "GRADE_8", subjectCode: `${CODE_PREFIX}T1`, subjectName: "Recon Strand T1", originalGrade: 71, status: "PENDING" },
        { enrollmentId: enrollment.id, schoolYear: YEAR, gradeLevel: "GRADE_8", subjectCode: `${CODE_PREFIX}T2`, subjectName: "Recon Strand T2", originalGrade: 71, status: "PENDING" },
      ],
    });

    const result = await finalizeSectionEosy({
      sectionId: section.id,
      schoolYear: YEAR,
      actor: { id: "test", name: "Test", role: "REGISTRAR" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remedialRowsCleared).toBe(2);

    const updated = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(updated?.promotionStatus).toBe("PROMOTED");

    const rows = await prisma.remedialClass.count({ where: { enrollmentId: enrollment.id } });
    expect(rows).toBe(0);
  });

  it("failing rotation merge (71/71/71 → 71) is CP with one canonical TLE row", async () => {
    const { section, enrollment } = await createEnrollmentWithGrades({ t1: 71, t2: 71, t3: 71 });

    const result = await finalizeSectionEosy({
      sectionId: section.id,
      schoolYear: YEAR,
      actor: { id: "test", name: "Test", role: "REGISTRAR" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updated = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(updated?.promotionStatus).toBe("CONDITIONALLY_PROMOTED");

    const rows = await prisma.remedialClass.findMany({ where: { enrollmentId: enrollment.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].subjectCode).toBe("TLE");
    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].originalGrade).toBe(71);
  });

  it("re-finalize after a passing grade change removes the stale pending row", async () => {
    const { section, enrollment } = await createEnrollmentWithGrades({ t1: 71, t2: 71, t3: 71 });

    const first = await finalizeSectionEosy({
      sectionId: section.id,
      schoolYear: YEAR,
      actor: { id: "test", name: "Test", role: "REGISTRAR" },
    });
    expect(first.ok).toBe(true);
    expect(await prisma.remedialClass.count({ where: { enrollmentId: enrollment.id } })).toBe(1);

    // Correct the T3 strand grade so the merged TLE final reaches 75.
    const t3Ca = await prisma.classAssignment.findFirst({
      where: { sectionId: section.id, subjectId: subjectIds.T3 },
    });
    await prisma.grade.updateMany({
      where: { classAssignmentId: t3Ca!.id, term: "T3" },
      data: { quarterlyGrade: 84 },
    });

    const second = await finalizeSectionEosy({
      sectionId: section.id,
      schoolYear: YEAR,
      actor: { id: "test", name: "Test", role: "REGISTRAR" },
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.remedialRowsCleared).toBe(1);

    const updated = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(updated?.promotionStatus).toBe("PROMOTED");
    expect(await prisma.remedialClass.count({ where: { enrollmentId: enrollment.id } })).toBe(0);
  });
});

describe("reconcileRemedialRows — orphan cleanup", () => {
  it("deletes untouched orphans, keeps conducted/completed rows, and flags conducted orphans", async () => {
    const { enrollment } = await createEnrollmentWithGrades({ t1: 85, t2: 85, t3: 85, promotionStatus: "PROMOTED" });

    const orphan = await prisma.remedialClass.create({
      data: { enrollmentId: enrollment.id, schoolYear: YEAR, gradeLevel: "GRADE_8", subjectCode: "RECON_ORPHAN", subjectName: "Orphan Row", originalGrade: 71, status: "PENDING" },
    });
    const conducted = await prisma.remedialClass.create({
      data: { enrollmentId: enrollment.id, schoolYear: YEAR, gradeLevel: "GRADE_8", subjectCode: "RECON_CONDUCTED", subjectName: "Conducted Row", originalGrade: 71, remedialMark: 80, conductedFrom: new Date("2026-06-01"), status: "PENDING" },
    });
    const completed = await prisma.remedialClass.create({
      data: { enrollmentId: enrollment.id, schoolYear: YEAR, gradeLevel: "GRADE_8", subjectCode: "RECON_COMPLETED", subjectName: "Completed Row", originalGrade: 71, remedialMark: 82, outcome: "PASSED", status: "COMPLETED" },
    });

    const result = await reconcileRemedialRows({ schoolYear: YEAR });

    expect(result.rowsDeleted).toBe(1);
    expect(await prisma.remedialClass.findUnique({ where: { id: orphan.id } })).toBeNull();
    expect(await prisma.remedialClass.findUnique({ where: { id: conducted.id } })).not.toBeNull();
    expect(await prisma.remedialClass.findUnique({ where: { id: completed.id } })).not.toBeNull();
    expect(result.needsAttention.some((n) => n.enrollmentId === enrollment.id)).toBe(true);
  });

  it("deletes untouched pending rows on archived enrollments (year already rolled over)", async () => {
    const { enrollment } = await createEnrollmentWithGrades({ t1: 71, t2: 71, t3: 71, promotionStatus: "CONDITIONALLY_PROMOTED" });
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { isArchived: true, archivedReason: "test rollover" },
    });

    const orphan = await prisma.remedialClass.create({
      data: { enrollmentId: enrollment.id, schoolYear: YEAR, gradeLevel: "GRADE_8", subjectCode: "RECON_ARCHIVED", subjectName: "Archived Orphan", originalGrade: 71, status: "PENDING" },
    });

    const result = await reconcileRemedialRows({ schoolYear: YEAR });

    expect(result.rowsDeleted).toBe(1);
    expect(await prisma.remedialClass.findUnique({ where: { id: orphan.id } })).toBeNull();
  });
});

describe("getRemedialRolloverBlock — EnrollPro pre-rollover guardrail", () => {
  it("blocks when a CONDITIONALLY_PROMOTED enrollment still has a PENDING row", async () => {
    const { enrollment, student, section } = await createEnrollmentWithGrades({ t1: 71, t2: 71, t3: 71, promotionStatus: "CONDITIONALLY_PROMOTED" });
    await prisma.remedialClass.create({
      data: { enrollmentId: enrollment.id, schoolYear: YEAR, gradeLevel: "GRADE_8", subjectCode: "RECON_BLOCK", subjectName: "Blocking Subject", originalGrade: 71, status: "PENDING" },
    });

    const result = await getRemedialRolloverBlock(YEAR);

    expect(result.blocked).toBe(true);
    const entry = result.students.find((s) => s.lrn === student.lrn);
    expect(entry).toBeDefined();
    expect(entry!.pendingSubjects).toContain("Blocking Subject");
    expect(entry!.grade).toBe(section.gradeLevel);
  });
});
