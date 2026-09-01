/**
 * syncVerification.test.ts — Tests for the orphan detection and verification report.
 * Seeds deliberately inconsistent DB, asserts correct anomaly codes.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../lib/prisma";
import { findOrphanedData } from "../lib/syncVerification";

// Mock EnrollPro faculty as EMPTY — every DB teacher is "missing from EP".
// Must be top-level: vi.mock is hoisted and applies to the whole file.
vi.mock("../lib/enrollproClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/enrollproClient")>();
  return {
    ...actual,
    getEnrollProTeachers: vi.fn().mockResolvedValue([]),
  };
});

const YEAR = "2101-2102";
const LRN_ORPHAN = `LRN-ORPHAN-${Date.now()}`;
const LRN_STALE = `LRN-STALE-${Date.now()}`;

let orphanStudentId = "";
let staleStudentId = "";
let orphanUserId = "";
let staleTeacherId = "";
let orphanSubjectId = "";
let orphanSectionId = "";
let orphanSchoolYearId = "";

async function seedOrphanFixture() {
  const sy = await prisma.schoolYear.create({
    data: { label: YEAR, status: "ACTIVE", externalId: 888888 },
  });
  orphanSchoolYearId = sy.id;

  // Orphan student: no enrollments at all
  const orphanStudent = await prisma.student.create({
    data: { lrn: LRN_ORPHAN, firstName: "Orphan", lastName: "Student", gender: "Male" },
  });
  orphanStudentId = orphanStudent.id;

  // Stale student: enrollment only in a different year
  const staleStudent = await prisma.student.create({
    data: { lrn: LRN_STALE, firstName: "Stale", lastName: "Student", gender: "Female" },
  });
  staleStudentId = staleStudent.id;

  const subject = await prisma.subject.create({
    data: { code: "T-ORPHAN", name: "Orphan Test Subject" },
  });
  orphanSubjectId = subject.id;

  const section = await prisma.section.create({
    data: { name: "Orphan Section", schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
  });
  orphanSectionId = section.id;

  // Enroll stale student in a different year section
  const staleSection = await prisma.section.create({
    data: { name: "Stale Section", schoolYear: "2099-2100", gradeLevel: "GRADE_8", status: "ACTIVE" },
  });

  await prisma.enrollment.create({
    data: { studentId: staleStudentId, sectionId: staleSection.id, schoolYear: "2099-2100", status: "ENROLLED" },
  });

  // TEACHER user without Teacher profile
  const orphanUser = await prisma.user.create({
    data: { username: `orphan-teacher-${Date.now()}`, password: "hashed", role: "TEACHER" },
  });
  orphanUserId = orphanUser.id;

  // Teacher with employeeId (won't match EP since we'll mock EP to return empty)
  const staleTeacherUser = await prisma.user.create({
    data: { username: `stale-teacher-${Date.now()}`, password: "hashed", role: "TEACHER" },
  });
  const staleTeacher = await prisma.teacher.create({
    data: { userId: staleTeacherUser.id, employeeId: `EMP-STALE-${Date.now()}` },
  });
  staleTeacherId = staleTeacher.id;
}

async function cleanup() {
  await prisma.enrollment.deleteMany({ where: { studentId: staleStudentId } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: "2099-2100" } }).catch(() => {});
  await prisma.section.deleteMany({ where: { schoolYear: "2099-2100" } }).catch(() => {});
  await prisma.section.deleteMany({ where: { id: orphanSectionId } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: orphanSubjectId } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: staleTeacherId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: orphanStudentId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: staleStudentId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: orphanUserId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { username: { startsWith: "stale-teacher-" } } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { id: orphanSchoolYearId } }).catch(() => {});
}

describe("findOrphanedData", () => {
  beforeAll(async () => {
    await cleanup();
    await seedOrphanFixture();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("detects orphan students (no enrollments)", async () => {
    const report = await findOrphanedData();
    const orphan = report.orphanStudents.find((s) => s.lrn === LRN_ORPHAN);
    expect(orphan).toBeTruthy();
    expect(orphan!.lastEnrollmentYear).toBeNull();
  });

  it("detects stale students (enrollments only in non-active years)", async () => {
    const report = await findOrphanedData();
    const stale = report.orphanStudents.find((s) => s.lrn === LRN_STALE);
    expect(stale).toBeTruthy();
    expect(stale!.lastEnrollmentYear).toBe("2099-2100");
  });

  it("detects stale enrollment years", async () => {
    const report = await findOrphanedData();
    expect(report.staleEnrollmentYears).toContain("2099-2100");
  });

  it("detects users without teacher profile", async () => {
    const report = await findOrphanedData();
    const user = report.usersWithoutTeacherProfile.find((u) => u.id === orphanUserId);
    expect(user).toBeTruthy();
    expect(user!.role).toBe("TEACHER");
  });

  it("detects teachers missing from EnrollPro (mocked empty EP)", async () => {
    const report = await findOrphanedData();
    const stale = await prisma.teacher.findUnique({ where: { id: staleTeacherId } });
    expect(stale).toBeTruthy();
    const missing = report.teachersMissingFromEnrollPro.find((t) => t.employeeId === stale!.employeeId);
    expect(missing).toBeTruthy();
  });
});
