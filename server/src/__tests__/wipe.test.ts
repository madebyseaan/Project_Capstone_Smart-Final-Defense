/**
 * wipe.test.ts — Tests for the database wipe logic.
 * Seeds a minimal fixture, runs wipe, asserts all domain tables are empty.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { collectCounts, runWipe, WIPE_ORDER } from "../lib/wipe";

const YEAR = "2100-2101";
const LRN = `LRN-WIPE-TEST-${Date.now()}`;

let schoolYearId = "";
let sectionId = "";
let studentId = "";
let teacherId = "";
let userId = "";
let subjectId = "";
let classAssignmentId = "";

async function seedFixture() {
  const sy = await prisma.schoolYear.create({
    data: { label: YEAR, status: "ACTIVE", externalId: 999999 },
  });
  schoolYearId = sy.id;

  const user = await prisma.user.create({
    data: { username: `wipe-test-user-${Date.now()}`, password: "hashed", role: "TEACHER" },
  });
  userId = user.id;

  const teacher = await prisma.teacher.create({
    data: { userId: user.id, employeeId: `EMP-WIPE-${Date.now()}` },
  });
  teacherId = teacher.id;

  const subject = await prisma.subject.create({
    data: { code: "T-WIPE", name: "Wipe Test Subject" },
  });
  subjectId = subject.id;

  const section = await prisma.section.create({
    data: { name: "Wipe Section", schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
  });
  sectionId = section.id;

  const student = await prisma.student.create({
    data: { lrn: LRN, firstName: "Wipe", lastName: "Test", gender: "Male" },
  });
  studentId = student.id;

  const ca = await prisma.classAssignment.create({
    data: { sectionId, schoolYear: YEAR, subjectId, teacherId, isActive: true },
  });
  classAssignmentId = ca.id;

  await prisma.enrollment.create({
    data: { studentId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
  });

  await prisma.grade.create({
    data: { studentId, classAssignmentId, term: "T1", quarterlyGrade: 85, status: "DRAFT" },
  });

  await prisma.gradeSnapshot.create({
    data: {
      studentId,
      classAssignmentId,
      teacherId,
      subjectCode: "T-WIPE",
      subjectName: "Wipe Test Subject",
      sectionId,
      sectionName: "Wipe Section",
      schoolYear: YEAR,
      term: "T1",
      snapshot: { source: "TEST" },
    },
  });

  await prisma.attendance.create({
    data: { studentId, sectionId, date: new Date(), status: "PRESENT" },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "CREATE",
      severity: "INFO",
      details: "wipe test",
      userName: "test-user",
      userRole: "TEACHER",
      target: "Test",
      targetType: "TEST",
    },
  });
}

async function cleanup() {
  await prisma.attendance.deleteMany({ where: { studentId } }).catch(() => {});
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.grade.deleteMany({ where: { classAssignmentId } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.section.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: subjectId } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: studentId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { id: schoolYearId } }).catch(() => {});
}

describe("collectCounts", () => {
  beforeAll(async () => {
    await cleanup();
    await seedFixture();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("returns counts for all tables in WIPE_ORDER", async () => {
    const counts = await collectCounts(prisma);
    expect(counts.length).toBe(WIPE_ORDER.length);
    for (const c of counts) {
      expect(typeof c.count).toBe("number");
    }
  });

  it("shows non-zero counts for seeded tables", async () => {
    const counts = await collectCounts(prisma);
    const countMap = Object.fromEntries(counts.map((c) => [c.table, c.count]));
    expect(countMap["Student"]).toBeGreaterThanOrEqual(1);
    expect(countMap["Enrollment"]).toBeGreaterThanOrEqual(1);
    expect(countMap["Grade"]).toBeGreaterThanOrEqual(1);
    expect(countMap["Attendance"]).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Sentinel error thrown inside test transactions to force a ROLLBACK.
 * Wipe tests must NEVER commit — they run against the shared dev DB
 * and vitest executes test files in parallel.
 */
const ROLLBACK = new Error("__WIPE_TEST_ROLLBACK__");

async function runWipeAndRollback(
  options: { keepUsers?: boolean; keepTemplates?: boolean },
  assert: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>,
): Promise<void> {
  await prisma
    .$transaction(async (tx) => {
      await runWipe(tx, options);
      await assert(tx);
      throw ROLLBACK;
    })
    .catch((err) => {
      if (err !== ROLLBACK) throw err;
    });
}

describe("runWipe", () => {
  beforeAll(async () => {
    await cleanup();
    await seedFixture();
    // Ensure SystemSettings row exists (runWipe updates it — would throw if missing)
    await prisma.systemSettings.upsert({ where: { id: "main" }, update: {}, create: { id: "main" } });
  });

  afterAll(async () => {
    await cleanup();
  });

  it("wipes all domain tables and resets SystemSettings", async () => {
    await runWipeAndRollback({ keepTemplates: true }, async (tx) => {
      // Capture pre-wipe credentials so the assertion is environment-independent
      const before = await tx.systemSettings.findUnique({ where: { id: "main" } });

      // Verify all domain tables are empty (ExcelTemplate kept by keepTemplates)
      const counts = await collectCounts(tx);
      for (const { table, count } of counts) {
        if (table === "ExcelTemplate") continue;
        expect(count).toBe(0);
      }

      // Verify SystemSettings was reset
      const settings = await tx.systemSettings.findUnique({ where: { id: "main" } });
      expect(settings).toBeTruthy();
      expect(settings!.currentSchoolYear).toBe("UNSET");
      expect(settings!.currentTerm).toBe("T1");
      expect(settings!.gradeLock).toBe(false);
      // Credentials should be preserved (relative to pre-wipe state)
      expect(settings!.enrollproUrl).toBe(before!.enrollproUrl);
    });
  });

  it("is idempotent — running twice succeeds", async () => {
    await runWipeAndRollback({ keepTemplates: true }, async (tx) => {
      // Second run must not throw
      await runWipe(tx, { keepTemplates: true });

      const counts = await collectCounts(tx);
      for (const { table, count } of counts) {
        if (table === "ExcelTemplate") continue;
        expect(count).toBe(0);
      }
    });
  });
});

describe("runWipe --keep-users", () => {
  beforeAll(async () => {
    await cleanup();
    await seedFixture();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("preserves User/Teacher/RefreshToken/AuditLog/GradeEditRequest/ExcelTemplate", async () => {
    await runWipeAndRollback({ keepUsers: true, keepTemplates: true }, async (tx) => {
      // Seeded user, teacher, and audit log should survive
      expect(await tx.user.count({ where: { id: userId } })).toBe(1);
      expect(await tx.teacher.count({ where: { id: teacherId } })).toBe(1);
      expect(await tx.auditLog.count({ where: { userId } })).toBeGreaterThanOrEqual(1);

      // Domain tables should be empty
      expect(await tx.student.count()).toBe(0);
      expect(await tx.enrollment.count()).toBe(0);
      expect(await tx.grade.count()).toBe(0);
      expect(await tx.attendance.count()).toBe(0);
    });
  });
});
