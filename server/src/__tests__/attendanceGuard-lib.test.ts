/**
 * attendanceGuard-lib.test.ts — T9: Attendance write-guard unit test
 * Tests assertSectionAttendanceWritable directly. No HTTP, no auth.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { assertSectionAttendanceWritable } from "../routes/attendance";

const YEAR_A = "2095-2096"; // Unique to avoid collision with other tests
const YEAR_CURRENT = "2026-2027"; // Must match live SystemSettings

let sectionCompleted = "";
let sectionArchived = "";
let sectionActiveWrongYear = "";
let sectionNotFound = "nonexistent-section-id";

beforeAll(async () => {
  // Section: COMPLETED status
  const s1 = await prisma.section.create({
    data: { name: "T9 Completed", schoolYear: YEAR_A, gradeLevel: "GRADE_7", status: "COMPLETED" },
  });
  sectionCompleted = s1.id;

  // Section: archivedAt set (archived)
  const s2 = await prisma.section.create({
    data: { name: "T9 Archived", schoolYear: YEAR_A, gradeLevel: "GRADE_8", status: "ACTIVE", archivedAt: new Date() },
  });
  sectionArchived = s2.id;

  // Section: ACTIVE in a wrong year
  const s3 = await prisma.section.create({
    data: { name: "T9 Wrong Year", schoolYear: YEAR_A, gradeLevel: "GRADE_9", status: "ACTIVE" },
  });
  sectionActiveWrongYear = s3.id;
});

afterAll(async () => {
  await prisma.section.deleteMany({ where: { name: { startsWith: "T9 " } } });
});

describe("T9 — assertSectionAttendanceWritable guard", () => {
  it("returns error for COMPLETED section", async () => {
    const result = await assertSectionAttendanceWritable(sectionCompleted);
    expect(result).toContain("Attendance can only be recorded");
  });

  it("returns error for archived section (archivedAt set)", async () => {
    const result = await assertSectionAttendanceWritable(sectionArchived);
    expect(result).toContain("Attendance can only be recorded");
  });

  it("returns error for section with wrong school year", async () => {
    const result = await assertSectionAttendanceWritable(sectionActiveWrongYear);
    expect(result).toContain("Attendance can only be recorded");
  });

  it("returns error for non-existent section", async () => {
    const result = await assertSectionAttendanceWritable(sectionNotFound);
    expect(result).toBe("Section not found");
  });
});
