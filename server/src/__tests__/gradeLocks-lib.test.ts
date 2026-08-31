/**
 * gradeLocks-lib.test.ts — T8: Cross-year edit-request lock test
 * Direct unit tests for hasApprovedEditRequest and checkGradeEditLocks.
 * No HTTP, no auth, no EnrollPro dependency.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { hasApprovedEditRequest, checkGradeEditLocks, setTermLock } from "../lib/gradeLocks";
import type { Term } from "@prisma/client";

const YEAR_A = "2096-2097";
const YEAR_B = "2097-2098";

let teacherUserId = "";
let teacherId = "";

beforeAll(async () => {
  // Create a test teacher user
  const user = await prisma.user.create({
    data: { username: `test-teacher-t8-${Date.now()}`, password: "hashed", role: "TEACHER" },
  });
  teacherUserId = user.id;
  const teacher = await prisma.teacher.create({
    data: { userId: user.id, employeeId: `EMP-T8-${Date.now()}` },
  });
  teacherId = teacher.id;

  // Create two school years
  await prisma.schoolYear.create({ data: { label: YEAR_A, status: "ACTIVE", externalId: 980001 } });
  await prisma.schoolYear.create({ data: { label: YEAR_B, status: "INACTIVE", externalId: 980002 } });

  // Create an APPROVED edit request for Year A, T1, expires in future
  await prisma.gradeEditRequest.create({
    data: {
      teacherId: teacherUserId,
      teacherName: "Test Teacher T8",
      term: "T1",
      schoolYear: YEAR_A,
      reason: "T8 test",
      status: "APPROVED",
      approvedById: teacherUserId,
      approvedByName: "Self-Approve",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    },
  });

  // Create an EXPIRED edit request for Year A, T2
  await prisma.gradeEditRequest.create({
    data: {
      teacherId: teacherUserId,
      teacherName: "Test Teacher T8",
      term: "T2",
      schoolYear: YEAR_A,
      reason: "T8 expired test",
      status: "APPROVED",
      approvedById: teacherUserId,
      approvedByName: "Self-Approve",
      expiresAt: new Date(Date.now() - 1000), // already expired
    },
  });
});

afterAll(async () => {
  await prisma.gradeEditRequest.deleteMany({ where: { teacherId: teacherUserId } });
  await prisma.teacher.delete({ where: { id: teacherId } }).catch(() => {});
  await prisma.user.delete({ where: { id: teacherUserId } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: { in: [YEAR_A, YEAR_B] } } });
});

describe("T8 — hasApprovedEditRequest cross-year scope", () => {
  it("returns true for same year + same term + not expired", async () => {
    const result = await hasApprovedEditRequest(teacherUserId, "T1" as Term, YEAR_A);
    expect(result).toBe(true);
  });

  it("returns false for different year (the Round-1 bug)", async () => {
    const result = await hasApprovedEditRequest(teacherUserId, "T1" as Term, YEAR_B);
    expect(result).toBe(false);
  });

  it("returns false for expired request even same year", async () => {
    const result = await hasApprovedEditRequest(teacherUserId, "T2" as Term, YEAR_A);
    expect(result).toBe(false);
  });

  it("returns false for non-existent teacher", async () => {
    const result = await hasApprovedEditRequest("nonexistent-teacher", "T1" as Term, YEAR_A);
    expect(result).toBe(false);
  });
});

describe("T8 — checkGradeEditLocks with term lock", () => {
  it("returns TERM_LOCKED when term locked and no approved request", async () => {
    // Lock T3 for Year A (no approved request exists for T3)
    const yearA = await prisma.schoolYear.findUnique({ where: { label: YEAR_A } });
    await setTermLock(yearA!.id, "T3" as Term, true, { id: "system", name: "Test" });

    const result = await checkGradeEditLocks({
      teacherUserId,
      schoolYearLabel: YEAR_A,
      term: "T3" as Term,
    });

    expect(result).not.toBeNull();
    expect(result!.code).toBe("TERM_LOCKED");
  });

  it("allows edit when term locked BUT approved request exists (same year)", async () => {
    // T1 is locked (let's lock it), but we have an approved request for T1 Year A
    const yearA = await prisma.schoolYear.findUnique({ where: { label: YEAR_A } });
    await setTermLock(yearA!.id, "T1" as Term, true, { id: "system", name: "Test" });

    const result = await checkGradeEditLocks({
      teacherUserId,
      schoolYearLabel: YEAR_A,
      term: "T1" as Term,
    });

    // Should NOT return TERM_LOCKED because the approved request bypasses it
    expect(result?.code).not.toBe("TERM_LOCKED");
  });

  it("returns TERM_LOCKED for different year despite approved request in Year A", async () => {
    const yearB = await prisma.schoolYear.findUnique({ where: { label: YEAR_B } });
    await setTermLock(yearB!.id, "T1" as Term, true, { id: "system", name: "Test" });

    const result = await checkGradeEditLocks({
      teacherUserId,
      schoolYearLabel: YEAR_B,
      term: "T1" as Term,
    });

    expect(result).not.toBeNull();
    expect(result!.code).toBe("TERM_LOCKED");
  });
});
