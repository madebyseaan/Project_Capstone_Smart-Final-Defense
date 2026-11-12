/**
 * teacher-archives-failure.test.ts
 *
 * G4 failure injection: a rejected generation promise must never affect the
 * year archive outcome. The generate function is mocked to reject.
 */

import { vi, describe, it, expect, afterAll } from "vitest";

vi.mock("../lib/teacherYearArchive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/teacherYearArchive")>();
  return {
    ...actual,
    generateTeacherYearArchives: vi.fn().mockRejectedValue(new Error("injected generation failure")),
  };
});

import { prisma } from "../lib/prisma";
import { archiveSchoolYear } from "../lib/rollover";

const YEAR = `2091-2092-${Date.now()}`;
let yearId = "";

afterAll(async () => {
  if (yearId) {
    await prisma.teacherYearArchive.deleteMany({ where: { schoolYearId: yearId } });
    await prisma.schoolYear.deleteMany({ where: { id: yearId } });
  }
});

describe("teacher archive generation failure", () => {
  it("leaves the year archived and locked when generation rejects", async () => {
    const year = await prisma.schoolYear.create({
      data: { label: YEAR, status: "ACTIVE", gradingMode: "TRANSMUTED" },
    });
    yearId = year.id;

    const section = await prisma.section.create({
      data: { name: `Section ${YEAR}`, schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
    });

    const user = await prisma.user.create({
      data: {
        username: `fail-${Date.now()}`,
        password: "hashed",
        role: "TEACHER",
        firstName: "Failure",
        lastName: "Teacher",
      },
    });
    const teacher = await prisma.teacher.create({
      data: { userId: user.id, employeeId: `EMP-FAIL-${Date.now()}` },
    });
    const subject = await prisma.subject.create({
      data: { code: `FAIL-${Date.now()}`, name: "Failure Subject" },
    });
    await prisma.classAssignment.create({
      data: { sectionId: section.id, schoolYear: YEAR, subjectId: subject.id, teacherId: teacher.id, isActive: true },
    });

    const result = await archiveSchoolYear({
      schoolYearId: year.id,
      yearLabel: YEAR,
      actor: { id: "test-admin", name: "Test Admin" },
      reason: "G4 failure injection",
    });

    expect(result.ok).toBe(true);

    const archived = await prisma.schoolYear.findUnique({ where: { id: year.id } });
    expect(archived?.status).toBe("ARCHIVED");
    const lock = await prisma.yearGradeLock.findUnique({ where: { schoolYearId: year.id } });
    expect(lock?.isLocked).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const row = await prisma.teacherYearArchive.findFirst({ where: { schoolYearId: year.id } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe("PENDING");
  });
});
