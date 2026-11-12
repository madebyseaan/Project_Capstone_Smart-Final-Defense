/**
 * teacher-archives-rollover.test.ts
 *
 * G4: rollover integration, feature flag, and blocked-rollover isolation.
 * Uses the isolated *_test database.
 */

import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { archiveSchoolYear, handleYearChangeRollover } from "../lib/rollover";

const STAMP = Date.now();
const YEAR_SUCCESS = `2095-2096-${STAMP}`;
const YEAR_DISABLED = `2094-2095-${STAMP}`;
const YEAR_BLOCKED = `2093-2094-${STAMP}`;
const YEAR_NEXT = `2092-2093-${STAMP}`;

const createdYears: string[] = [];

async function seedYear(
  label: string,
  opts: { enroll?: boolean; draftGrade?: boolean; adviserOnly?: boolean } = {},
): Promise<{ yearId: string; teacherId: string; sectionId: string; assignmentId: string; studentId?: string }> {
  const year = await prisma.schoolYear.create({
    data: { label, status: "ACTIVE", gradingMode: "TRANSMUTED" },
  });
  createdYears.push(year.id);

  const section = await prisma.section.create({
    data: { name: `Section ${label}`, schoolYear: label, gradeLevel: "GRADE_7", status: "ACTIVE" },
  });

  const user = await prisma.user.create({
    data: {
      username: `roll-${label}-${Math.random().toString(36).slice(2)}`,
      password: "hashed",
      role: "TEACHER",
      firstName: "Rollover",
      lastName: "Teacher",
    },
  });

  const teacher = await prisma.teacher.create({
    data: { userId: user.id, employeeId: `EMP-${label}-${Math.random().toString(36).slice(2)}` },
  });

  if (opts.adviserOnly) {
    await prisma.section.update({ where: { id: section.id }, data: { adviserId: teacher.id } });
    return { yearId: year.id, teacherId: teacher.id, sectionId: section.id, assignmentId: "" };
  }

  const subject = await prisma.subject.create({
    data: { code: `ROLL-${label}-${Math.random().toString(36).slice(2)}`, name: "Rollover Subject" },
  });

  const assignment = await prisma.classAssignment.create({
    data: { sectionId: section.id, schoolYear: label, subjectId: subject.id, teacherId: teacher.id, isActive: true },
  });

  if (!opts.enroll) {
    return { yearId: year.id, teacherId: teacher.id, sectionId: section.id, assignmentId: assignment.id };
  }

  const student = await prisma.student.create({
    data: { lrn: `LRN-ROLL-${label}-${Math.random().toString(36).slice(2)}`, firstName: "Roll", lastName: "Learner" },
  });

  await prisma.enrollment.create({
    data: { studentId: student.id, sectionId: section.id, schoolYear: label, status: "ENROLLED" },
  });

  if (opts.draftGrade) {
    await prisma.grade.create({
      data: { studentId: student.id, classAssignmentId: assignment.id, term: "T1", status: "DRAFT" },
    });
  }

  return { yearId: year.id, teacherId: teacher.id, sectionId: section.id, assignmentId: assignment.id, studentId: student.id };
}

async function waitForComplete(schoolYearId: string): Promise<Awaited<ReturnType<typeof prisma.teacherYearArchive.findFirst>>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const row = await prisma.teacherYearArchive.findFirst({ where: { schoolYearId } });
    if (row?.status === "COMPLETE" || row?.status === "FAILED") return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return prisma.teacherYearArchive.findFirst({ where: { schoolYearId } });
}

afterAll(async () => {
  for (const yearId of createdYears) {
    await prisma.teacherYearArchive.deleteMany({ where: { schoolYearId: yearId } });
    await prisma.schoolYear.deleteMany({ where: { id: yearId } });
  }
});

describe("teacher archives rollover integration", () => {
  it("archives the year and completes teacher bundles without blocking", async () => {
    const seeded = await seedYear(YEAR_SUCCESS);

    const result = await archiveSchoolYear({
      schoolYearId: seeded.yearId,
      yearLabel: YEAR_SUCCESS,
      actor: { id: "test-admin", name: "Test Admin" },
      reason: "G4 archive test",
    });

    expect(result.ok).toBe(true);

    const year = await prisma.schoolYear.findUnique({ where: { id: seeded.yearId } });
    expect(year?.status).toBe("ARCHIVED");

    const lock = await prisma.yearGradeLock.findUnique({ where: { schoolYearId: seeded.yearId } });
    expect(lock?.isLocked).toBe(true);

    const row = await waitForComplete(seeded.yearId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe("COMPLETE");
    expect(row?.payload).not.toBeNull();
    expect(row?.teacherId).toBe(seeded.teacherId);
  });

  it("does not queue bundles when TEACHER_ARCHIVE_ENABLED=false", async () => {
    const previous = process.env.TEACHER_ARCHIVE_ENABLED;
    process.env.TEACHER_ARCHIVE_ENABLED = "false";
    try {
      const seeded = await seedYear(YEAR_DISABLED);
      const result = await archiveSchoolYear({
        schoolYearId: seeded.yearId,
        yearLabel: YEAR_DISABLED,
        actor: { id: "test-admin", name: "Test Admin" },
        reason: "G4 disabled test",
      });
      expect(result.ok).toBe(true);

      const year = await prisma.schoolYear.findUnique({ where: { id: seeded.yearId } });
      expect(year?.status).toBe("ARCHIVED");
      const count = await prisma.teacherYearArchive.count({ where: { schoolYearId: seeded.yearId } });
      expect(count).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.TEACHER_ARCHIVE_ENABLED;
      else process.env.TEACHER_ARCHIVE_ENABLED = previous;
    }
  });

  it("blocked rollover creates zero bundles and leaves the year unarchived", async () => {
    const previous = await seedYear(YEAR_BLOCKED, { enroll: true, draftGrade: true });
    const next = await seedYear(YEAR_NEXT);

    const result = await handleYearChangeRollover(
      previous.yearId,
      YEAR_BLOCKED,
      next.yearId,
      YEAR_NEXT,
    );

    expect(result.action).toBe("locked_not_archived");
    const year = await prisma.schoolYear.findUnique({ where: { id: previous.yearId } });
    expect(year?.status).toBe("ACTIVE");
    const count = await prisma.teacherYearArchive.count({ where: { schoolYearId: previous.yearId } });
    expect(count).toBe(0);
  });
});
