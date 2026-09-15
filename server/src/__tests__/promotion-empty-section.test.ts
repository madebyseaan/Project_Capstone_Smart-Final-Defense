/**
 * promotion-empty-section.test.ts — RL-2a regression test.
 *
 * A section with zero ENROLLED learners must be treated as finalized so it can
 * never block school-year archive/rollover forever. Sections WITH learners must
 * still be blocked until promotion statuses are stored.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { listUnfinalizedSections, getSectionEosyStatus } from "../lib/promotion";

const YEAR = "2085-2086"; // unique to this test
let emptySectionId = "";
let enrolledSectionId = "";
let studentId = "";

beforeAll(async () => {
  const empty = await prisma.section.create({
    data: { name: `RL2A Empty ${Date.now()}`, schoolYear: YEAR, gradeLevel: "GRADE_8", status: "ACTIVE" },
  });
  emptySectionId = empty.id;

  const enrolled = await prisma.section.create({
    data: { name: `RL2A Enrolled ${Date.now()}`, schoolYear: YEAR, gradeLevel: "GRADE_8", status: "ACTIVE" },
  });
  enrolledSectionId = enrolled.id;

  const student = await prisma.student.create({
    data: { lrn: `LRN-RL2A-${Date.now()}`, firstName: "T", lastName: "S" },
  });
  studentId = student.id;
  await prisma.enrollment.create({
    data: { studentId, sectionId: enrolledSectionId, schoolYear: YEAR, status: "ENROLLED" },
  });
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.section.deleteMany({ where: { id: { in: [emptySectionId, enrolledSectionId] } } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: studentId } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
});

describe("RL-2a — empty sections do not block archive", () => {
  it("excludes the zero-enrollment section from unfinalized list", async () => {
    const unfinalized = await listUnfinalizedSections(YEAR);
    const ids = unfinalized.map((s) => s.sectionId);
    expect(ids).not.toContain(emptySectionId);
    expect(ids).toContain(enrolledSectionId); // control: still blocked
  });

  it("reports finalized=true for the zero-enrollment section", async () => {
    const status = await getSectionEosyStatus(emptySectionId, YEAR);
    expect(status).not.toBeNull();
    expect(status?.enrollmentCount).toBe(0);
    expect(status?.finalized).toBe(true);
  });

  it("still blocks a section with learners lacking promotion status", async () => {
    const status = await getSectionEosyStatus(enrolledSectionId, YEAR);
    expect(status?.enrollmentCount).toBe(1);
    expect(status?.finalized).toBe(false);
  });
});
