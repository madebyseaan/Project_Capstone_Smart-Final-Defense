/**
 * aims-resync.test.ts — Drift detection + apply path for post-import AIMS changes.
 * Requires the aims-resync-provenance migration to be applied.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { importAimsScoresToGrades } from "../lib/aimsImport";
import { applyAimsUpdates, computeAimsDrift, countPendingAimsUpdates } from "../lib/aimsResync";

const TS = Date.now();
const SY = "2099-2100";
const UID = `rs-${TS}`;

describe("aims resync", () => {
  let tid: string;
  let sid: string;
  let subId: string;
  let caId: string;
  let stId: string;
  let uid: string;

  const createGradeWithItem = async (o: {
    term: "T1" | "T2" | "T3";
    assessmentId: string;
    score: number;
    maxScore: number;
    status?: "DRAFT" | "FINALIZED";
    qaSource?: string | null;
    qaAssessmentId?: string | null;
    qaScore?: number;
  }) => {
    return prisma.grade.create({
      data: {
        studentId: stId,
        classAssignmentId: caId,
        term: o.term,
        writtenWorkScores: [{
          name: "Imported Q1",
          score: o.score,
          maxScore: o.maxScore,
          date: "2026-09-15",
          isAims: true,
          assessmentId: o.assessmentId,
        }],
        perfTaskScores: [],
        quarterlyAssessScore: o.qaScore ?? 0,
        quarterlyAssessMax: 100,
        qaSource: o.qaSource ?? null,
        qaAssessmentId: o.qaAssessmentId ?? null,
        status: o.status ?? "DRAFT",
        finalizedAt: o.status === "FINALIZED" ? new Date() : null,
      },
    });
  };

  const createAimsScore = async (o: {
    term: "T1" | "T2" | "T3";
    assessmentId: string;
    pointsEarned: number;
    maxPoints?: number;
    category?: "WW" | "PT" | "QA";
    imported?: boolean;
    baseline?: { points: number; max: number; attempt: number };
    attemptNumber?: number;
  }) => {
    const maxPoints = o.maxPoints ?? 100;
    return prisma.aimsScore.create({
      data: {
        classAssignmentId: caId,
        studentId: stId,
        term: o.term,
        assessmentId: o.assessmentId,
        assessmentTitle: "Imported Q1",
        type: "QUIZ",
        category: o.category ?? "WW",
        score: o.pointsEarned,
        pointsEarned: o.pointsEarned,
        maxPoints,
        attemptNumber: o.attemptNumber ?? 1,
        gradedAt: new Date("2026-09-15"),
        importedAt: o.imported ? new Date() : null,
        importedPointsEarned: o.baseline?.points ?? null,
        importedMaxPoints: o.baseline?.max ?? null,
        importedAttemptNumber: o.baseline?.attempt ?? null,
        importedTerm: o.imported ? o.term : null,
      },
    });
  };

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: UID, password: "x", role: "TEACHER", firstName: "R", lastName: "T" },
    });
    uid = u.id;
    const t = await prisma.teacher.create({ data: { userId: u.id, employeeId: `RT-${TS}` } });
    tid = t.id;
    const s = await prisma.section.create({
      data: { name: `RS-${TS}`, gradeLevel: "GRADE_8", schoolYear: SY },
    });
    sid = s.id;
    const sub = await prisma.subject.create({ data: { code: `RSUB-${TS}`, name: "Resync Subject" } });
    subId = sub.id;
    const a = await prisma.classAssignment.create({
      data: { teacherId: tid, subjectId: subId, sectionId: sid, schoolYear: SY, aimsCourseId: `rc-${TS}` },
    });
    caId = a.id;
    const st = await prisma.student.create({
      data: { lrn: `RL-${TS}`, firstName: "Re", lastName: "Sync", enrollproId: 88888 },
    });
    stId = st.id;
    await prisma.enrollment.create({
      data: { studentId: stId, sectionId: sid, schoolYear: SY, status: "ENROLLED" },
    });
  });

  afterAll(async () => {
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId } });
    await prisma.gradeSnapshot.deleteMany({ where: { classAssignmentId: caId } });
    await prisma.grade.deleteMany({ where: { classAssignmentId: caId } });
    await prisma.enrollment.deleteMany({ where: { sectionId: sid, schoolYear: SY } });
    await prisma.classAssignment.deleteMany({ where: { id: caId } });
    await prisma.student.deleteMany({ where: { lrn: `RL-${TS}` } });
    await prisma.subject.delete({ where: { id: subId } }).catch(() => {});
    await prisma.section.delete({ where: { id: sid } }).catch(() => {});
    await prisma.teacher.delete({ where: { id: tid } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: UID } });
  });

  it("import stamps the provenance snapshot", async () => {
    await createAimsScore({ term: "T1", assessmentId: "RS:import", pointsEarned: 8, maxPoints: 10 });
    const res = await importAimsScoresToGrades({
      classAssignmentId: caId,
      term: "T1",
      teacherId: tid,
      teacherUserId: uid,
    });
    expect(res.savedCount).toBe(1);

    const row = await prisma.aimsScore.findFirst({
      where: { classAssignmentId: caId, assessmentId: "RS:import" },
    });
    expect(row!.importedAt).not.toBeNull();
    expect(row!.importedPointsEarned).toBe(8);
    expect(row!.importedMaxPoints).toBe(10);
    expect(row!.importedAttemptNumber).toBe(1);
    expect(row!.importedTerm).toBe("T1");

    await prisma.grade.deleteMany({ where: { classAssignmentId: caId, term: "T1" } });
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "RS:import" } });
  });

  it("detects a changed score and reports previous vs current", async () => {
    await createGradeWithItem({ term: "T1", assessmentId: "RS:q1", score: 8, maxScore: 10 });
    await createAimsScore({
      term: "T1",
      assessmentId: "RS:q1",
      pointsEarned: 10,
      maxPoints: 10,
      imported: true,
      baseline: { points: 8, max: 10, attempt: 1 },
    });

    const report = await computeAimsDrift(caId, "T1");
    const change = report.changes.find((c) => c.assessmentId === "RS:q1");
    expect(change).toBeTruthy();
    expect(change!.kind).toBe("changed");
    expect(change!.previous?.pointsEarned).toBe(8);
    expect(change!.current.pointsEarned).toBe(10);
    expect(change!.teacherEdited).toBe(false);
    expect(change!.blockReason).toBeNull();
    expect(await countPendingAimsUpdates(caId, "T1")).toBe(1);
  });

  it("flags teacher-edited columns", async () => {
    await prisma.grade.updateMany({
      where: { classAssignmentId: caId, term: "T1" },
      data: {
        writtenWorkScores: [{
          name: "Imported Q1",
          score: 9,
          maxScore: 10,
          date: "2026-09-15",
          isAims: true,
          assessmentId: "RS:q1",
        }],
      },
    });

    const report = await computeAimsDrift(caId, "T1");
    const change = report.changes.find((c) => c.assessmentId === "RS:q1");
    expect(change!.teacherEdited).toBe(true);
    expect(change!.ledgerValue).toBe(9);
  });

  it("applies the update, recomputes, and is idempotent", async () => {
    const result = await applyAimsUpdates({
      classAssignmentId: caId,
      term: "T1",
      changes: [{ studentId: stId, assessmentId: "RS:q1" }],
      teacherId: tid,
      teacherUserId: uid,
    });
    expect(result.appliedCount).toBe(1);
    expect(result.updatedStudents).toBe(1);
    expect(result.skipped).toHaveLength(0);

    const grade = await prisma.grade.findFirst({
      where: { classAssignmentId: caId, term: "T1" },
    });
    const ww = grade!.writtenWorkScores as any[];
    expect(ww[0].score).toBe(10);
    expect(grade!.writtenWorkPS).toBe(100);

    const row = await prisma.aimsScore.findFirst({
      where: { classAssignmentId: caId, assessmentId: "RS:q1" },
    });
    expect(row!.importedPointsEarned).toBe(10);

    const report = await computeAimsDrift(caId, "T1");
    expect(report.changes.find((c) => c.assessmentId === "RS:q1")).toBeUndefined();

    const second = await applyAimsUpdates({
      classAssignmentId: caId,
      term: "T1",
      changes: [{ studentId: stId, assessmentId: "RS:q1" }],
      teacherId: tid,
      teacherUserId: uid,
    });
    expect(second.appliedCount).toBe(0);
    expect(second.skipped[0].reason).toBe("No longer changed");
  });

  it("refuses to update a finalized grade", async () => {
    await prisma.grade.updateMany({
      where: { classAssignmentId: caId, term: "T1" },
      data: { status: "FINALIZED", finalizedAt: new Date() },
    });
    await prisma.aimsScore.updateMany({
      where: { classAssignmentId: caId, assessmentId: "RS:q1" },
      data: { pointsEarned: 5 },
    });

    const report = await computeAimsDrift(caId, "T1");
    expect(report.changes.find((c) => c.assessmentId === "RS:q1")!.blockReason).toBe("Grade is finalized");

    const result = await applyAimsUpdates({
      classAssignmentId: caId,
      term: "T1",
      changes: [{ studentId: stId, assessmentId: "RS:q1" }],
      teacherId: tid,
      teacherUserId: uid,
    });
    expect(result.appliedCount).toBe(0);
    expect(result.skipped[0].reason).toBe("Grade is finalized");

    await prisma.grade.updateMany({
      where: { classAssignmentId: caId, term: "T1" },
      data: { status: "DRAFT", finalizedAt: null },
    });
    await prisma.aimsScore.updateMany({
      where: { classAssignmentId: caId, assessmentId: "RS:q1" },
      data: { pointsEarned: 10, importedPointsEarned: 10 },
    });
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "RS:q1" } });
    await prisma.grade.deleteMany({ where: { classAssignmentId: caId, term: "T1" } });
  });

  it("updates a QA only when it is AIMS-sourced", async () => {
    await createGradeWithItem({
      term: "T2",
      assessmentId: "RS:unused",
      score: 0,
      maxScore: 10,
      qaScore: 80,
      qaSource: null,
      qaAssessmentId: null,
    });
    await prisma.grade.updateMany({
      where: { classAssignmentId: caId, term: "T2" },
      data: { writtenWorkScores: [] },
    });
    await createAimsScore({
      term: "T2",
      assessmentId: "RS:qa",
      pointsEarned: 90,
      category: "QA",
      imported: true,
      baseline: { points: 80, max: 100, attempt: 1 },
    });

    expect((await computeAimsDrift(caId, "T2")).changes).toHaveLength(0);

    await prisma.grade.updateMany({
      where: { classAssignmentId: caId, term: "T2" },
      data: { qaSource: "AIMS", qaAssessmentId: "RS:qa" },
    });
    expect((await computeAimsDrift(caId, "T2")).changes).toHaveLength(1);

    const result = await applyAimsUpdates({
      classAssignmentId: caId,
      term: "T2",
      changes: [{ studentId: stId, assessmentId: "RS:qa" }],
      teacherId: tid,
      teacherUserId: uid,
    });
    expect(result.appliedCount).toBe(1);

    const grade = await prisma.grade.findFirst({
      where: { classAssignmentId: caId, term: "T2" },
    });
    expect(grade!.quarterlyAssessScore).toBe(90);
    expect(grade!.qaSource).toBe("AIMS");
    expect(grade!.examScores).toBeNull();

    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "RS:qa" } });
    await prisma.grade.deleteMany({ where: { classAssignmentId: caId, term: "T2" } });
  });

  it("reports a score moved to another term without applying it", async () => {
    await createGradeWithItem({ term: "T3", assessmentId: "RS:move", score: 7, maxScore: 10 });
    await createAimsScore({
      term: "T1",
      assessmentId: "RS:move",
      pointsEarned: 9,
      imported: true,
      baseline: { points: 7, max: 10, attempt: 1 },
    });
    await prisma.aimsScore.updateMany({
      where: { classAssignmentId: caId, assessmentId: "RS:move" },
      data: { importedTerm: "T3", term: "T1" },
    });

    const report = await computeAimsDrift(caId, "T3");
    const moved = report.changes.find((c) => c.assessmentId === "RS:move");
    expect(moved).toBeTruthy();
    expect(moved!.kind).toBe("term_moved");
    expect(moved!.blockReason).toContain("Moved to T1");

    const result = await applyAimsUpdates({
      classAssignmentId: caId,
      term: "T3",
      changes: [{ studentId: stId, assessmentId: "RS:move" }],
      teacherId: tid,
      teacherUserId: uid,
    });
    expect(result.appliedCount).toBe(0);
    expect(result.skipped[0].reason).toBe("AIMS score not found");

    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "RS:move" } });
    await prisma.grade.deleteMany({ where: { classAssignmentId: caId, term: "T3" } });
  });
});
