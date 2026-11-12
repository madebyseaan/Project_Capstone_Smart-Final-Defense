/**
 * teacher-archives-lib.test.ts
 *
 * Direct-function tests for the per-teacher year archive builder. Uses the
 * isolated *_test database (guarded by scripts/require-test-db.js).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import {
  collectExpectedTeachers,
  fetchYearData,
  buildTeacherArchivePayload,
  serializeTeacherArchivePayload,
  deserializeTeacherArchive,
  ensureTeacherArchivesQueued,
  generateTeacherYearArchives,
  TEACHER_ARCHIVE_SCHEMA_VERSION,
} from "../lib/teacherYearArchive";

const YEAR = `2096-2097-${Date.now()}`;

let schoolYearId = "";
let sectionId = "";
let subjectId = "";
let studentId = "";
let teacherAId = "";
let teacherBId = "";
let userAId = "";
let userBId = "";
let assignmentId = "";

async function seed() {
  const year = await prisma.schoolYear.create({
    data: { label: YEAR, status: "ACTIVE", gradingMode: "TRANSMUTED" },
  });
  schoolYearId = year.id;

  const section = await prisma.section.create({
    data: { name: "Archive Test Section", schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
  });
  sectionId = section.id;

  const subject = await prisma.subject.create({
    data: { code: `ARCH-${Date.now()}`, name: "Archive Test Subject" },
  });
  subjectId = subject.id;

  const student = await prisma.student.create({
    data: { lrn: `LRN-ARCH-${Date.now()}`, firstName: "Archive", lastName: "Learner" },
  });
  studentId = student.id;

  const [userA, userB] = await Promise.all([
    prisma.user.create({
      data: { username: `arch-a-${Date.now()}`, password: "hashed", role: "TEACHER", firstName: "Ana", lastName: "Adviser" },
    }),
    prisma.user.create({
      data: { username: `arch-b-${Date.now()}`, password: "hashed", role: "TEACHER", firstName: "Ben", lastName: "Subject" },
    }),
  ]);
  userAId = userA.id;
  userBId = userB.id;

  const [teacherA, teacherB] = await Promise.all([
    prisma.teacher.create({ data: { userId: userA.id, employeeId: `ARCH-A-${Date.now()}` } }),
    prisma.teacher.create({ data: { userId: userB.id, employeeId: `ARCH-B-${Date.now()}` } }),
  ]);
  teacherAId = teacherA.id;
  teacherBId = teacherB.id;

  // Teacher A is advisory only; Teacher B teaches the subject.
  await prisma.section.update({ where: { id: sectionId }, data: { adviserId: teacherAId } });

  const assignment = await prisma.classAssignment.create({
    data: { sectionId, schoolYear: YEAR, subjectId, teacherId: teacherBId, isActive: true },
  });
  assignmentId = assignment.id;

  await prisma.enrollment.create({
    data: { studentId, sectionId, schoolYear: YEAR, status: "ENROLLED", promotionStatus: "PROMOTED" },
  });

  await prisma.grade.create({
    data: {
      studentId,
      classAssignmentId: assignmentId,
      term: "T1",
      writtenWorkScores: [{ score: 20, max: 20 }],
      perfTaskScores: [{ score: 30, max: 30 }],
      examScores: [{ score: 40, max: 50 }],
      initialGrade: 90,
      quarterlyGrade: 92,
      status: "FINALIZED",
    },
  });

  await prisma.attendance.create({
    data: {
      studentId,
      sectionId,
      date: new Date("2026-08-03"),
      status: "PRESENT",
      recordedBy: teacherAId,
    },
  });

  await prisma.gradeSnapshot.create({
    data: {
      studentId,
      classAssignmentId: assignmentId,
      teacherId: teacherBId,
      subjectCode: "ARCH",
      subjectName: "Archive Test Subject",
      sectionId,
      sectionName: "Archive Test Section",
      schoolYear: YEAR,
      term: "T1",
      snapshot: {
        source: "EOSY_FINALIZE",
        finalizedAt: new Date().toISOString(),
        initialGrade: 90,
        quarterlyGrade: 92,
        remarks: "Passed",
      },
    },
  });

  await prisma.gradeEditRequest.create({
    data: {
      teacherId: userBId,
      teacherName: "Ben Subject",
      term: "T1",
      schoolYear: YEAR,
      status: "APPROVED",
      reason: "Archive test request",
    },
  });

  await prisma.studentObservedValue.create({
    data: { studentId, schoolYear: YEAR, term: "T1", behaviorCode: "COURTESY", rating: "AO" },
  });
}

async function cleanup() {
  if (!schoolYearId) return;
  await prisma.teacherYearArchive.deleteMany({ where: { schoolYearId } });
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR } });
  await prisma.gradeEditRequest.deleteMany({ where: { schoolYear: YEAR } });
  await prisma.studentObservedValue.deleteMany({ where: { schoolYear: YEAR } });
  await prisma.attendance.deleteMany({ where: { sectionId } });
  await prisma.enrollment.deleteMany({ where: { sectionId } });
  await prisma.grade.deleteMany({ where: { classAssignmentId: assignmentId } });
  await prisma.classAssignment.deleteMany({ where: { sectionId } });
  await prisma.section.deleteMany({ where: { id: sectionId } });
  await prisma.schoolYear.deleteMany({ where: { id: schoolYearId } });
  await prisma.subject.deleteMany({ where: { id: subjectId } });
  await prisma.student.deleteMany({ where: { id: studentId } });
  await prisma.teacher.deleteMany({ where: { id: { in: [teacherAId, teacherBId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
}

describe("teacher year archive builder", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("collects teachers from assignments and advisory sections", async () => {
    const teachers = await collectExpectedTeachers(prisma, YEAR);
    const ids = teachers.map((t) => t.teacherId).sort();
    expect(ids).toEqual([teacherAId, teacherBId].sort());
    const adviser = teachers.find((t) => t.teacherId === teacherAId);
    expect(adviser?.teacherName).toContain("Ana");
  });

  it("builds a lean payload with the expected scope and stats", async () => {
    const data = await fetchYearData(prisma, YEAR);
    const teachers = await collectExpectedTeachers(prisma, YEAR);
    const teacherA = teachers.find((t) => t.teacherId === teacherAId)!;
    const payload = buildTeacherArchivePayload(data, teacherA, { source: "BACKFILL", backfilled: true });

    expect(payload.schemaVersion).toBe(TEACHER_ARCHIVE_SCHEMA_VERSION);
    expect(payload.source).toBe("BACKFILL");
    const summary = payload.summary as Record<string, number>;
    expect(summary.students).toBe(1);
    expect(summary.grades).toBe(0);
    expect(summary.attendanceRows).toBe(1);
    const quality = payload.dataQuality as { backfilled: boolean; warnings: string[] };
    expect(quality.backfilled).toBe(true);
    expect(quality.warnings).toContain("NO_GRADES");
    expect((payload.teacher as { name: string }).name).toContain("Ana");
  });

  it("includes grades, EOSY finalization, and edit requests for the subject teacher", async () => {
    const data = await fetchYearData(prisma, YEAR);
    const teachers = await collectExpectedTeachers(prisma, YEAR);
    const teacherB = teachers.find((t) => t.teacherId === teacherBId)!;
    const payload = buildTeacherArchivePayload(data, teacherB);

    const summary = payload.summary as Record<string, number>;
    expect(summary.grades).toBe(1);
    expect(summary.eosySnapshots).toBe(1);
    expect(summary.editRequests).toBe(1);
    expect((payload.grades as unknown[]).length).toBe(1);
    expect((payload.eosyFinalization as unknown[]).length).toBe(1);
    expect((payload.attendance as unknown[]).length).toBe(0);
    expect((payload.classAssignments as unknown[]).length).toBe(1);
  });

  it("gzip round-trips and verifies the checksum", async () => {
    const data = await fetchYearData(prisma, YEAR);
    const teachers = await collectExpectedTeachers(prisma, YEAR);
    const payload = buildTeacherArchivePayload(data, teachers[0]);
    const serialized = serializeTeacherArchivePayload(payload);

    expect(serialized.compressedBytes).toBeLessThan(serialized.rawBytes);
    expect(serialized.oversized).toBe(false);

    const decoded = deserializeTeacherArchive({
      payload: serialized.compressed,
      checksum: serialized.checksum,
      status: "COMPLETE",
    }) as Record<string, unknown>;
    expect(decoded.schemaVersion).toBe(TEACHER_ARCHIVE_SCHEMA_VERSION);
    expect((decoded.teacher as { id: string }).id).toBe(teachers[0].teacherId);

    expect(() =>
      deserializeTeacherArchive({
        payload: serialized.compressed,
        checksum: "deadbeef",
        status: "COMPLETE",
      }),
    ).toThrow(/checksum/i);
  });

  it("queues PENDING rows idempotently and completes generation", async () => {
    const first = await ensureTeacherArchivesQueued({
      schoolYearId,
      yearLabel: YEAR,
      source: "BACKFILL",
      createdBy: "test",
    });
    expect(first).toBe(2);

    const second = await ensureTeacherArchivesQueued({
      schoolYearId,
      yearLabel: YEAR,
      source: "BACKFILL",
      createdBy: "test",
    });
    expect(second).toBe(0);

    const pending = await prisma.teacherYearArchive.findMany({ where: { schoolYearId } });
    expect(pending).toHaveLength(2);
    expect(pending.every((row) => row.status === "PENDING")).toBe(true);

    const summary = await generateTeacherYearArchives(schoolYearId, { source: "BACKFILL" });
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(0);

    const complete = await prisma.teacherYearArchive.findMany({ where: { schoolYearId } });
    expect(complete.every((row) => row.status === "COMPLETE")).toBe(true);
    expect(complete.every((row) => row.payload !== null)).toBe(true);
    expect(complete.every((row) => row.checksum?.length === 64)).toBe(true);

    for (const row of complete) {
      const decoded = deserializeTeacherArchive(row) as Record<string, unknown>;
      expect(decoded.schemaVersion).toBe(TEACHER_ARCHIVE_SCHEMA_VERSION);
      expect((decoded.teacher as { id: string }).id).toBe(row.teacherId);
    }
  });
});
