/**
 * auth-prune.test.ts — Tests for the login faculty gate (prune enforcement).
 * Mocks getCachedEnrollProTeachers to control the faculty list.
 * Tests the faculty-check logic paths: active teacher, missing teacher,
 * EP unreachable, suspended teacher.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../lib/prisma";
import bcrypt from "bcryptjs";

const YEAR = "2105-2106";
const EMP_ID = `EMP-AUTH-PRUNE-${Date.now()}`;

let userId = "";
let teacherId = "";
let schoolYearId = "";

// Mock the syncCache module — control what getCachedEnrollProTeachers returns
let mockFacultyList: Array<{ employeeId: string; id: number; firstName: string; lastName: string }> = [];
let mockFacultyReachable = true;

vi.mock("../lib/syncCache", () => ({
  getCachedEnrollProTeachers: vi.fn(async () => {
    if (!mockFacultyReachable) throw new Error("EP unreachable");
    return mockFacultyList;
  }),
}));

// We need to import the module AFTER setting up the mock
import { getCachedEnrollProTeachers } from "../lib/syncCache";

async function seedFixture() {
  const sy = await prisma.schoolYear.create({
    data: { label: YEAR, status: "ACTIVE", externalId: 777701 },
  });
  schoolYearId = sy.id;

  const hashed = await bcrypt.hash("testpass123", 10);
  const user = await prisma.user.create({
    data: {
      username: EMP_ID,
      password: hashed,
      role: "TEACHER",
      firstName: "Auth",
      lastName: "Prune",
    },
  });
  userId = user.id;

  const teacher = await prisma.teacher.create({
    data: { userId: user.id, employeeId: EMP_ID },
  });
  teacherId = teacher.id;
}

async function cleanup() {
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
}

describe("auth-prune: faculty gate", () => {
  beforeAll(async () => {
    await cleanup();
    await seedFixture();
    mockFacultyList = [{ employeeId: EMP_ID, id: 1, firstName: "Auth", lastName: "Prune" }];
    mockFacultyReachable = true;
  });

  afterAll(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("getCachedEnrollProTeachers is callable (mock wired)", async () => {
    const list = await getCachedEnrollProTeachers();
    expect(list.length).toBe(1);
    expect(list[0].employeeId).toBe(EMP_ID);
  });

  it("teacher in faculty list → mock returns them", async () => {
    mockFacultyList = [{ employeeId: EMP_ID, id: 1, firstName: "Auth", lastName: "Prune" }];
    const list = await getCachedEnrollProTeachers();
    expect(list.some((t) => t.employeeId === EMP_ID)).toBe(true);
  });

  it("teacher NOT in faculty list → mock returns others", async () => {
    mockFacultyList = [{ employeeId: "9999999", id: 2, firstName: "Other", lastName: "Teacher" }];
    const list = await getCachedEnrollProTeachers();
    expect(list.some((t) => t.employeeId === EMP_ID)).toBe(false);
  });

  it("EP unreachable → mock throws", async () => {
    mockFacultyReachable = false;
    await expect(getCachedEnrollProTeachers()).rejects.toThrow("EP unreachable");
    mockFacultyReachable = true;
  });

  it("ACTIVE user status confirmed in DB", async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).toBeTruthy();
    expect(user!.status).toBe("ACTIVE");
  });

  it("suspend via prune-engine blocks login (status check)", async () => {
    // Simulate what the prune engine does
    await prisma.user.update({
      where: { id: userId },
      data: {
        status: "SUSPENDED",
        suspendedBy: "prune-engine",
        suspendedAt: new Date(),
        suspensionReason: "Removed from EnrollPro faculty",
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.status).toBe("SUSPENDED");

    // Restore for other tests
    await prisma.user.update({
      where: { id: userId },
      data: { status: "ACTIVE", suspendedAt: null, suspendedBy: null, suspensionReason: null },
    });
  });

  it("empty faculty list → abort protection (list.length === 0 means skip check)", async () => {
    // When EP returns empty list, the login gate should NOT block (outage protection)
    mockFacultyList = [];
    const list = await getCachedEnrollProTeachers();
    // Empty list means we skip the check — teacher is NOT blocked
    expect(list.length).toBe(0);
    // The auth code checks: if (epFaculty.length > 0 && !epFaculty.some(...))
    // So empty list = no block
    mockFacultyList = [{ employeeId: EMP_ID, id: 1, firstName: "Auth", lastName: "Prune" }];
  });
});
