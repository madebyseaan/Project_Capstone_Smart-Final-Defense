/**
 * aims-sync.test.ts — Unit and lib-level tests for AIMS sync + import logic.
 *
 * Pure unit tests: no DB, no mocks — always pass.
 * Lib-level tests: real prisma fixtures — require migration applied.
 *   If migration is missing, lib tests are skipped (not failed).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { binTerm, dedupLatestAttempt, processAimsCourseData, type TermEndDates } from "../lib/aimsScoreSync";
import { importAimsScoresToGrades } from "../lib/aimsImport";
import { computeCourseWarnings } from "../lib/aimsCourseMatch";
import type { AimsPublicScoresPayload } from "../schemas/aims";
import { gradeSaveSchema } from "../schemas/grades";
import { prisma } from "../lib/prisma";

vi.mock("../lib/enrollproClient", () => ({
  getEnrollProStudentDetail: vi.fn().mockResolvedValue(null),
}));

// ─── Pure unit tests (no DB) ─────────────────────────────────────────────────

describe("binTerm", () => {
  const d: TermEndDates = { t1EndDate: new Date("2026-10-15"), t2EndDate: new Date("2027-01-15"), t3EndDate: new Date("2027-04-15") };
  it("T1 at boundary", () => expect(binTerm(new Date("2026-10-15"), d)).toBe("T1"));
  it("T1 before boundary", () => expect(binTerm(new Date("2026-09-01"), d)).toBe("T1"));
  it("T2 at boundary", () => expect(binTerm(new Date("2027-01-15"), d)).toBe("T2"));
  it("T3 at boundary", () => expect(binTerm(new Date("2027-04-15"), d)).toBe("T3"));
  it("null after all", () => expect(binTerm(new Date("2027-04-16"), d)).toBeNull());
  it("null when no dates", () => expect(binTerm(new Date("2026-09-01"), { t1EndDate: null, t2EndDate: null, t3EndDate: null })).toBeNull());
  it("partial dates", () => expect(binTerm(new Date("2026-10-16"), { t1EndDate: new Date("2026-10-15"), t2EndDate: null, t3EndDate: null })).toBeNull());
});

describe("dedupLatestAttempt", () => {
  const r = (o: Partial<AimsPublicScoresPayload["rows"][number]> = {}): AimsPublicScoresPayload["rows"][number] => ({
    submissionId: "s", userId: "u", studentName: "T", studentEmail: "t@t.com",
    enrollproId: 1, assessmentId: "QUIZ:a", quizId: "q", quizTitle: "Q",
    type: "QUIZ", category: "WW", isRemedial: false, sourceQuizId: null, forStudentId: null,
    passingScore: null, score: 80, maxPoints: 100, pointsEarned: 80, status: "GRADED",
    attemptNumber: 1, startedAt: null, submittedAt: null, gradedAt: "2026-09-01T00:00:00Z", ...o,
  });
  it("single row", () => expect(dedupLatestAttempt([r()])).toHaveLength(1));
  it("higher attempt wins", () => { const x = dedupLatestAttempt([r({ attemptNumber: 1, pointsEarned: 60 }), r({ attemptNumber: 2, pointsEarned: 90 })]); expect(x[0].attemptNumber).toBe(2); });
  it("tie-break gradedAt", () => { const x = dedupLatestAttempt([r({ gradedAt: "2026-09-01T00:00:00Z" }), r({ gradedAt: "2026-09-05T00:00:00Z", pointsEarned: 95 })]); expect(x[0].pointsEarned).toBe(95); });
  it("null gradedAt skipped", () => expect(dedupLatestAttempt([r({ gradedAt: null }), r()])).toHaveLength(1));
  it("composite key", () => expect(dedupLatestAttempt([r({ enrollproId: 1, assessmentId: "QUIZ:a" }), r({ enrollproId: 1, assessmentId: "TASK:b" }), r({ enrollproId: 2, assessmentId: "QUIZ:a" })])).toHaveLength(3));
  it("empty", () => expect(dedupLatestAttempt([])).toEqual([]));
});

// ─── Lib-level tests (require migration) ─────────────────────────────────────

const TS = Date.now();
const SY = "2099-2100";
const TD: TermEndDates = { t1EndDate: new Date("2026-10-15"), t2EndDate: new Date("2027-01-15"), t3EndDate: new Date("2027-04-15") };

const mkRow = (o: Partial<AimsPublicScoresPayload["rows"][number]> = {}): AimsPublicScoresPayload["rows"][number] => ({
  submissionId: "s1", userId: "u1", studentName: "S", studentEmail: "s@s.com",
  enrollproId: 99999, assessmentId: "QUIZ:q1", quizId: "q1", quizTitle: "Quiz 1",
  type: "QUIZ", category: "WW", isRemedial: false, sourceQuizId: null, forStudentId: null,
  passingScore: null, score: 80, maxPoints: 100, pointsEarned: 80, status: "GRADED",
  attemptNumber: 1, startedAt: null, submittedAt: null, gradedAt: "2026-09-15T00:00:00Z", ...o,
});
const mkPayload = (rows?: AimsPublicScoresPayload["rows"]): AimsPublicScoresPayload => ({
  course: { id: `c-${TS}`, name: "C", code: "C", subject: "S", gradeLevel: "G", sectionName: `S-${TS}`, schoolYear: SY },
  weights: { ww: 30, pt: 70 }, rows: rows ?? [mkRow()],
});

describe("processAimsCourseData", () => {
  let tid: string; let sid: string; let subId: string; let caId: string; let stId: string;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { username: `sync-${TS}`, password: "x", role: "TEACHER", firstName: "T", lastName: "T" } });
    const t = await prisma.teacher.create({ data: { userId: u.id, employeeId: `ST-${TS}` } }); tid = t.id;
    const s = await prisma.section.create({ data: { name: `SS-${TS}`, gradeLevel: "GRADE_7", schoolYear: SY } }); sid = s.id;
    const sub = await prisma.subject.create({ data: { code: `SUB-${TS}`, name: "Subj" } }); subId = sub.id;
    const a = await prisma.classAssignment.create({ data: { teacherId: tid, subjectId: subId, sectionId: sid, schoolYear: SY, aimsCourseId: `c-${TS}` } }); caId = a.id;
    const st = await prisma.student.create({ data: { lrn: `SL-${TS}`, firstName: "S", lastName: "S", enrollproId: 99999 } }); stId = st.id;
    await prisma.enrollment.create({ data: { studentId: stId, sectionId: sid, schoolYear: SY, status: "ENROLLED" } });
  });

  afterAll(async () => {
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId } });
    await prisma.enrollment.deleteMany({ where: { sectionId: sid, schoolYear: SY } });
    await prisma.classAssignment.deleteMany({ where: { id: caId } });
    await prisma.student.deleteMany({ where: { lrn: `SL-${TS}` } });
    await prisma.subject.delete({ where: { id: subId } }).catch(() => {});
    await prisma.section.delete({ where: { id: sid } }).catch(() => {});
    await prisma.teacher.delete({ where: { id: tid } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: `sync-${TS}` } });
  });

  it("upserts scores", async () => {
    const r = await processAimsCourseData(caId, mkPayload(), TD);
    expect(r.scoresUpserted).toBe(1);
    expect((await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, studentId: stId } }))!.term).toBe("T1");
  });

  it("P0-1: no deletion when term dates unset", async () => {
    expect(await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, studentId: stId } })).not.toBeNull();
    const r = await processAimsCourseData(caId, mkPayload(), { t1EndDate: null, t2EndDate: null, t3EndDate: null });
    expect(r.scoresUpserted).toBe(0);
    expect(await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, studentId: stId } })).not.toBeNull();
  });

  it("preserves imported rows during sweep", async () => {
    await prisma.aimsScore.updateMany({ where: { classAssignmentId: caId, studentId: stId }, data: { importedAt: new Date() } });
    await processAimsCourseData(caId, mkPayload([mkRow({ assessmentId: "QUIZ:q2", quizTitle: "Q2", pointsEarned: 90 })]), TD);
    expect((await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, studentId: stId, assessmentId: "QUIZ:q1" } }))!.importedAt).not.toBeNull();
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "QUIZ:q2" } });
    await prisma.aimsScore.updateMany({ where: { classAssignmentId: caId, studentId: stId, assessmentId: "QUIZ:q1" }, data: { importedAt: null } });
  });

  it("late retake preserves earlier row", async () => {
    const r = await processAimsCourseData(caId, mkPayload([mkRow({ attemptNumber: 2, gradedAt: "2027-05-01T00:00:00Z", pointsEarned: 95 })]), TD);
    expect(r.scoresUpserted).toBe(0);
    expect((await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, studentId: stId, assessmentId: "QUIZ:q1" } }))!.pointsEarned).toBe(80);
  });

  it("P0-2: null enrollproId goes to unmatched, normal rows still upsert", async () => {
    const nullEpRow = mkRow({ enrollproId: null, studentName: "AIMS Native", studentEmail: "native@test.com", assessmentId: "QUIZ:null-ep" });
    const normalRow = mkRow({ assessmentId: "QUIZ:normal", quizTitle: "Normal Quiz", pointsEarned: 85 });
    const r = await processAimsCourseData(caId, mkPayload([nullEpRow, normalRow]), TD);
    expect(r.scoresUpserted).toBe(1);
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0].enrollproId).toBeNull();
    expect(r.unmatched[0].studentName).toBe("AIMS Native");
    expect(r.unmatched[0].studentEmail).toBe("native@test.com");
    // Clean up
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: { in: ["QUIZ:null-ep", "QUIZ:normal"] } } });
  });

  it("P0-2: null studentEmail matches student fine", async () => {
    const r = await processAimsCourseData(caId, mkPayload([mkRow({ studentEmail: null, assessmentId: "QUIZ:null-email" })]), TD);
    expect(r.scoresUpserted).toBe(1);
    expect(r.unmatched).toHaveLength(0);
    // Clean up
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "QUIZ:null-email" } });
  });

  it("P0-2: remedial dedup — different assessmentIds both survive", async () => {
    const remedialRow = mkRow({ assessmentId: "QUIZ:remedial-uuid", quizTitle: "Remedial Quiz", isRemedial: true, sourceQuizId: "QUIZ:q1", forStudentId: stId });
    const originalRow = mkRow({ assessmentId: "QUIZ:q1", quizTitle: "Quiz 1", isRemedial: false });
    const r = await processAimsCourseData(caId, mkPayload([remedialRow, originalRow]), TD);
    expect(r.scoresUpserted).toBe(2);
    // Both should exist in DB
    const remedial = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "QUIZ:remedial-uuid" } });
    const original = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "QUIZ:q1" } });
    expect(remedial).not.toBeNull();
    expect(original).not.toBeNull();
    // Clean up
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "QUIZ:remedial-uuid" } });
  });

  it("P4-1: QA row survives validation and upserts with category='QA'", async () => {
    const wwRow = mkRow({ assessmentId: "QUIZ:ww1", quizTitle: "WW Quiz", category: "WW", pointsEarned: 80 });
    const qaRow = mkRow({ assessmentId: "QUIZ:qa1", quizTitle: "QA Quiz", category: "QA", pointsEarned: 90 });
    const r = await processAimsCourseData(caId, mkPayload([wwRow, qaRow]), TD);
    expect(r.scoresUpserted).toBe(2);
    const qaScore = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "QUIZ:qa1" } });
    expect(qaScore).not.toBeNull();
    expect(qaScore!.category).toBe("QA");
    // Clean up
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: { in: ["QUIZ:ww1", "QUIZ:qa1"] } } });
  });

  it("P6-1: TASK row with quizId=null survives validation and upserts", async () => {
    const quizRow = mkRow({ assessmentId: "QUIZ:q1", quizTitle: "WW Quiz", type: "QUIZ", category: "WW", quizId: "q1" });
    const taskRow = mkRow({ assessmentId: "TASK:t1", quizTitle: "PT Task", type: "TASK", category: "PT", quizId: null, pointsEarned: 70 });
    const r = await processAimsCourseData(caId, mkPayload([quizRow, taskRow]), TD);
    expect(r.scoresUpserted).toBe(2);
    const taskScore = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "TASK:t1" } });
    expect(taskScore).not.toBeNull();
    expect(taskScore!.category).toBe("PT");
    // Clean up
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: { in: ["QUIZ:q1", "TASK:t1"] } } });
  });

  it("P4-2: termIndex preferred over date binning — termIndex:2 + gradedAt in T1 → stored T2", async () => {
    // gradedAt 2026-09-15 is inside T1 window (ends 2026-10-15), but termIndex says 2
    const r = await processAimsCourseData(caId, mkPayload([mkRow({ assessmentId: "QUIZ:ti2", quizTitle: "TI2", termIndex: 2 })]), TD);
    expect(r.scoresUpserted).toBe(1);
    const score = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "QUIZ:ti2" } });
    expect(score!.term).toBe("T2");
    // Clean up
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "QUIZ:ti2" } });
  });

  it("P4-3: termIndex null falls back to date binning — gradedAt in T1 → T1", async () => {
    const r = await processAimsCourseData(caId, mkPayload([mkRow({ assessmentId: "QUIZ:tinull", quizTitle: "TINull", termIndex: null })]), TD);
    expect(r.scoresUpserted).toBe(1);
    const score = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "QUIZ:tinull" } });
    expect(score!.term).toBe("T1");
    // Clean up
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "QUIZ:tinull" } });
  });

  it("P4-4: upsert moves term when termIndex changes — T1 then T3", async () => {
    // First sync: termIndex 1
    const r1 = await processAimsCourseData(caId, mkPayload([mkRow({ assessmentId: "QUIZ:moveterm", quizTitle: "Move", termIndex: 1 })]), TD);
    expect(r1.scoresUpserted).toBe(1);
    const s1 = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "QUIZ:moveterm" } });
    expect(s1!.term).toBe("T1");
    // Second sync: same assessmentId, termIndex 3
    const r2 = await processAimsCourseData(caId, mkPayload([mkRow({ assessmentId: "QUIZ:moveterm", quizTitle: "Move", termIndex: 3 })]), TD);
    expect(r2.scoresUpserted).toBe(1);
    const s2 = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "QUIZ:moveterm" } });
    expect(s2!.term).toBe("T3");
    // Clean up
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "QUIZ:moveterm" } });
  });
});

describe("importAimsScoresToGrades", () => {
  let tid: string; let sid: string; let subId: string; let caId: string; let stId: string; let uid: string;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { username: `imp-${TS}`, password: "x", role: "TEACHER", firstName: "I", lastName: "T" } }); uid = u.id;
    const t = await prisma.teacher.create({ data: { userId: u.id, employeeId: `IT-${TS}` } }); tid = t.id;
    const s = await prisma.section.create({ data: { name: `IS-${TS}`, gradeLevel: "GRADE_8", schoolYear: SY } }); sid = s.id;
    const sub = await prisma.subject.create({ data: { code: `ISUB-${TS}`, name: "Subj" } }); subId = sub.id;
    const a = await prisma.classAssignment.create({ data: { teacherId: tid, subjectId: subId, sectionId: sid, schoolYear: SY, aimsCourseId: `ic-${TS}` } }); caId = a.id;
    const st = await prisma.student.create({ data: { lrn: `IL-${TS}`, firstName: "I", lastName: "S", enrollproId: 77777 } }); stId = st.id;
    await prisma.enrollment.create({ data: { studentId: stId, sectionId: sid, schoolYear: SY, status: "ENROLLED" } });
  });

  afterAll(async () => {
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId } });
    await prisma.gradeSnapshot.deleteMany({ where: { classAssignmentId: caId } });
    await prisma.grade.deleteMany({ where: { classAssignmentId: caId } });
    await prisma.enrollment.deleteMany({ where: { sectionId: sid, schoolYear: SY } });
    await prisma.classAssignment.deleteMany({ where: { id: caId } });
    await prisma.student.deleteMany({ where: { lrn: `IL-${TS}` } });
    await prisma.subject.delete({ where: { id: subId } }).catch(() => {});
    await prisma.section.delete({ where: { id: sid } }).catch(() => {});
    await prisma.teacher.delete({ where: { id: tid } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: `imp-${TS}` } });
  });

  it("archived grade is skipped (P0-3)", async () => {
    const g = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T1", isArchived: true, archivedAt: new Date(), archivedReason: "test", writtenWorkScores: [], perfTaskScores: [] } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "IMP:arch", assessmentTitle: "AQ", type: "QUIZ", category: "WW", score: 80, pointsEarned: 80, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r.skipped.archived).toBe(1);
    expect(r.savedCount).toBe(0);
    expect((await prisma.grade.findUnique({ where: { id: g.id } }))!.writtenWorkScores).toEqual([]);
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "IMP:arch" } });
    await prisma.grade.delete({ where: { id: g.id } });
  });

  it("FINALIZED grade is skipped", async () => {
    const g = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T2", status: "FINALIZED", finalizedAt: new Date(), writtenWorkScores: [{ name: "Ex", score: 10, maxScore: 20 }], perfTaskScores: [] } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T2", assessmentId: "IMP:fin", assessmentTitle: "FQ", type: "QUIZ", category: "WW", score: 80, pointsEarned: 80, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T2", teacherId: tid, teacherUserId: uid });
    expect(r.skipped.finalized).toBe(1);
    expect(r.savedCount).toBe(0);
    expect((await prisma.grade.findUnique({ where: { id: g.id } }))!.writtenWorkScores).toEqual([{ name: "Ex", score: 10, maxScore: 20 }]);
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "IMP:fin" } });
    await prisma.grade.delete({ where: { id: g.id } });
  });

  it("idempotency: second import appends nothing", async () => {
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "IMP:idem", assessmentTitle: "IQ", type: "QUIZ", category: "WW", score: 80, pointsEarned: 80, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15"), importedAt: new Date() } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r.skipped.alreadyImported).toBe(1);
    expect(r.savedCount).toBe(0);
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "IMP:idem" } });
  });

  it("append-only: manual items preserved + AIMS appended + grades recomputed", async () => {
    const g = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T3", writtenWorkScores: [{ name: "M1", score: 10, maxScore: 20 }, { name: "M2", score: 15, maxScore: 25 }], perfTaskScores: [{ name: "PT1", score: 40, maxScore: 50 }] } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T3", assessmentId: "IMP:ww1", assessmentTitle: "AIMS WW1", type: "QUIZ", category: "WW", score: 80, pointsEarned: 80, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T3", assessmentId: "IMP:ww2", assessmentTitle: "AIMS WW2", type: "QUIZ", category: "WW", score: 90, pointsEarned: 90, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-16") } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T3", teacherId: tid, teacherUserId: uid });
    expect(r.savedCount).toBe(1);
    expect(r.importedAssessments).toContain("IMP:ww1");
    expect(r.importedAssessments).toContain("IMP:ww2");
    const refreshed = await prisma.grade.findUnique({ where: { id: g.id } });
    const ww = refreshed!.writtenWorkScores as any[];
    expect(ww).toHaveLength(4);
    expect(ww[0]).toEqual({ name: "M1", score: 10, maxScore: 20 });
    expect(ww[1]).toEqual({ name: "M2", score: 15, maxScore: 25 });
    expect(ww[2].name).toBe("AIMS WW1");
    expect(ww[3].name).toBe("AIMS WW2");
    expect((refreshed!.perfTaskScores as any[])).toHaveLength(1);
    expect(refreshed!.writtenWorkPS).not.toBeNull();
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: { in: ["IMP:ww1", "IMP:ww2"] } } });
    await prisma.gradeSnapshot.deleteMany({ where: { gradeId: g.id } });
    await prisma.grade.delete({ where: { id: g.id } });
  });

  it("P4-5 (updated P7): import includes QA — WW appended, QA imported to quarterlyAssessScore", async () => {
    const g = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T1", writtenWorkScores: [], perfTaskScores: [] } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "IMP:qa-ww", assessmentTitle: "WW Item", type: "QUIZ", category: "WW", score: 80, pointsEarned: 80, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "IMP:qa-qa", assessmentTitle: "QA Item", type: "QUIZ", category: "QA", score: 90, pointsEarned: 90, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r.savedCount).toBe(1);
    expect(r.importedAssessments).toContain("IMP:qa-ww");
    expect(r.importedAssessments).toContain("IMP:qa-qa");
    // QA row should be imported
    const qaScore = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "IMP:qa-qa" } });
    expect(qaScore!.importedAt).not.toBeNull();
    // WW row should be imported
    const wwScore = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "IMP:qa-ww" } });
    expect(wwScore!.importedAt).not.toBeNull();
    // Grade should have WW and QA
    const refreshed = await prisma.grade.findUnique({ where: { id: g.id } });
    const ww = refreshed!.writtenWorkScores as any[];
    expect(ww).toHaveLength(1);
    expect(ww[0].name).toBe("WW Item");
    expect(refreshed!.quarterlyAssessScore).toBe(90);
    expect(refreshed!.qaDescription).toBe("QA Item");
    // Clean up
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: { in: ["IMP:qa-ww", "IMP:qa-qa"] } } });
    await prisma.gradeSnapshot.deleteMany({ where: { gradeId: g.id } });
    await prisma.grade.delete({ where: { id: g.id } });
  });

  it("P7-1: QA import fills empty TA — quarterlyAssessScore, qaDescription, qaDate set; grades recomputed", async () => {
    const g = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T1", writtenWorkScores: [], perfTaskScores: [], quarterlyAssessScore: 0, quarterlyAssessMax: 100 } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "P7:qa1", assessmentTitle: "Quarterly Exam", type: "QUIZ", category: "QA", score: 85, pointsEarned: 85, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-20") } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r.savedCount).toBe(1);
    expect(r.importedAssessments).toContain("P7:qa1");
    const refreshed = await prisma.grade.findUnique({ where: { id: g.id } });
    expect(refreshed!.quarterlyAssessScore).toBe(85);
    expect(refreshed!.quarterlyAssessMax).toBe(100);
    expect(refreshed!.qaDescription).toBe("Quarterly Exam");
    expect(refreshed!.qaDate).toBe("2026-09-20");
    expect(refreshed!.quarterlyAssessPS).not.toBeNull();
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "P7:qa1" } });
    await prisma.gradeSnapshot.deleteMany({ where: { gradeId: g.id } });
    await prisma.grade.delete({ where: { id: g.id } });
  });

  it("P7-2: QA skip-if-occupied — teacher QA (85) preserved AND QA staging row still has importedAt: null", async () => {
    const g = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T1", writtenWorkScores: [], perfTaskScores: [], quarterlyAssessScore: 85, quarterlyAssessMax: 100, qaDescription: "Teacher QA" } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "P7:qa2", assessmentTitle: "AIMS QA", type: "QUIZ", category: "QA", score: 90, pointsEarned: 90, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-20") } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r.savedCount).toBe(1);
    expect(r.qaSkippedOccupied).toBe(1);
    const refreshed = await prisma.grade.findUnique({ where: { id: g.id } });
    expect(refreshed!.quarterlyAssessScore).toBe(85);
    expect(refreshed!.qaDescription).toBe("Teacher QA");
    const qaScore = await prisma.aimsScore.findFirst({ where: { classAssignmentId: caId, assessmentId: "P7:qa2" } });
    expect(qaScore!.importedAt).toBeNull();
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "P7:qa2" } });
    await prisma.gradeSnapshot.deleteMany({ where: { gradeId: g.id } });
    await prisma.grade.delete({ where: { id: g.id } });
  });

  it("P7-3: imported items have isAims: true + assessmentId in both arrays", async () => {
    const g = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T1", writtenWorkScores: [], perfTaskScores: [] } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "P7:ww3", assessmentTitle: "AIMS WW", type: "QUIZ", category: "WW", score: 80, pointsEarned: 80, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "P7:pt3", assessmentTitle: "AIMS PT", type: "TASK", category: "PT", score: 70, pointsEarned: 70, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-16") } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r.savedCount).toBe(1);
    const refreshed = await prisma.grade.findUnique({ where: { id: g.id } });
    const ww = refreshed!.writtenWorkScores as any[];
    const pt = refreshed!.perfTaskScores as any[];
    expect(ww[0].isAims).toBe(true);
    expect(ww[0].assessmentId).toBe("P7:ww3");
    expect(pt[0].isAims).toBe(true);
    expect(pt[0].assessmentId).toBe("P7:pt3");
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: { in: ["P7:ww3", "P7:pt3"] } } });
    await prisma.gradeSnapshot.deleteMany({ where: { gradeId: g.id } });
    await prisma.grade.delete({ where: { id: g.id } });
  });

  it("P7-4: idempotency incl. QA — second import changes nothing", async () => {
    const g = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T1", writtenWorkScores: [], perfTaskScores: [], quarterlyAssessScore: 0 } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "P7:ww4", assessmentTitle: "WW4", type: "QUIZ", category: "WW", score: 80, pointsEarned: 80, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "P7:qa4", assessmentTitle: "QA4", type: "QUIZ", category: "QA", score: 90, pointsEarned: 90, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    const r1 = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r1.savedCount).toBe(1);
    const r2 = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r2.savedCount).toBe(0);
    expect(r2.skipped.alreadyImported).toBeGreaterThan(0);
    const refreshed = await prisma.grade.findUnique({ where: { id: g.id } });
    const ww = refreshed!.writtenWorkScores as any[];
    expect(ww).toHaveLength(1);
    expect(refreshed!.quarterlyAssessScore).toBe(90);
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: { in: ["P7:ww4", "P7:qa4"] } } });
    await prisma.gradeSnapshot.deleteMany({ where: { gradeId: g.id } });
    await prisma.grade.delete({ where: { id: g.id } });
  });

  it("P7-5: smart allocation — placeholder slot replaced, teacher data untouched, appends after maxLen", async () => {
    const st2 = await prisma.student.create({ data: { lrn: `SL2-${TS}`, firstName: "S2", lastName: "S2", enrollproId: 80000 + (TS % 10000) } });
    await prisma.enrollment.create({ data: { studentId: st2.id, sectionId: sid, schoolYear: SY, status: "ENROLLED" } });
    // Clean up any leftover grades for stId in T1 from prior tests
    await prisma.gradeSnapshot.deleteMany({ where: { studentId: stId, classAssignmentId: caId, term: "T1" } });
    await prisma.grade.deleteMany({ where: { studentId: stId, classAssignmentId: caId, term: "T1" } });
    const g1 = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T1", writtenWorkScores: [{ name: "WW 1", score: 0, maxScore: 10 }, { name: "WW 2", score: 0, maxScore: 10 }], perfTaskScores: [] } });
    const g2 = await prisma.grade.create({ data: { studentId: st2.id, classAssignmentId: caId, term: "T1", writtenWorkScores: [{ name: "My Quiz", score: 15, maxScore: 20, description: "Custom" }], perfTaskScores: [] } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "P7:alloc1", assessmentTitle: "AIMS A", type: "QUIZ", category: "WW", score: 80, pointsEarned: 80, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: st2.id, term: "T1", assessmentId: "P7:alloc1", assessmentTitle: "AIMS A", type: "QUIZ", category: "WW", score: 90, pointsEarned: 90, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-15") } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r.savedCount).toBe(2);
    const refreshed1 = await prisma.grade.findUnique({ where: { id: g1.id } });
    const ww1 = refreshed1!.writtenWorkScores as any[];
    // Column 0 is NOT free (student 2 has real data there), so AIMS goes to column 1
    expect(ww1[0].name).toBe("WW 1");
    expect(ww1[0].isAims).toBeUndefined();
    expect(ww1[1].isAims).toBe(true);
    expect(ww1[1].assessmentId).toBe("P7:alloc1");
    expect(ww1[1].score).toBe(80);
    const refreshed2 = await prisma.grade.findUnique({ where: { id: g2.id } });
    const ww2 = refreshed2!.writtenWorkScores as any[];
    expect(ww2[0].name).toBe("My Quiz");
    expect(ww2[0].score).toBe(15);
    expect(ww2[0].isAims).toBeUndefined();
    expect(ww2[1].isAims).toBe(true);
    expect(ww2[1].assessmentId).toBe("P7:alloc1");
    expect(ww2[1].score).toBe(90);
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: "P7:alloc1" } });
    await prisma.gradeSnapshot.deleteMany({ where: { gradeId: { in: [g1.id, g2.id] } } });
    await prisma.grade.deleteMany({ where: { id: { in: [g1.id, g2.id] } } });
    await prisma.enrollment.deleteMany({ where: { studentId: st2.id, sectionId: sid, schoolYear: SY } });
    await prisma.student.delete({ where: { id: st2.id } });
  });

  it("P7-6: free-column detection respects isAims and custom names", async () => {
    // Clean up any leftover grades for stId in T1
    await prisma.gradeSnapshot.deleteMany({ where: { studentId: stId, classAssignmentId: caId, term: "T1" } });
    await prisma.grade.deleteMany({ where: { studentId: stId, classAssignmentId: caId, term: "T1" } });
    const g = await prisma.grade.create({ data: { studentId: stId, classAssignmentId: caId, term: "T1", writtenWorkScores: [{ name: "AIMS WW", score: 80, maxScore: 100, isAims: true, assessmentId: "P7:old" }], perfTaskScores: [] } });
    await prisma.aimsScore.create({ data: { classAssignmentId: caId, studentId: stId, term: "T1", assessmentId: "P7:new", assessmentTitle: "New AIMS", type: "QUIZ", category: "WW", score: 90, pointsEarned: 90, maxPoints: 100, attemptNumber: 1, gradedAt: new Date("2026-09-20") } });
    const r = await importAimsScoresToGrades({ classAssignmentId: caId, term: "T1", teacherId: tid, teacherUserId: uid });
    expect(r.savedCount).toBe(1);
    const refreshed = await prisma.grade.findUnique({ where: { id: g.id } });
    const ww = refreshed!.writtenWorkScores as any[];
    expect(ww).toHaveLength(2);
    expect(ww[0].assessmentId).toBe("P7:old");
    expect(ww[0].isAims).toBe(true);
    expect(ww[1].assessmentId).toBe("P7:new");
    expect(ww[1].isAims).toBe(true);
    await prisma.aimsScore.deleteMany({ where: { classAssignmentId: caId, assessmentId: { in: ["P7:old", "P7:new"] } } });
    await prisma.gradeSnapshot.deleteMany({ where: { gradeId: g.id } });
    await prisma.grade.delete({ where: { id: g.id } });
  });
});

// ─── Pure unit tests for course match warnings (no DB) ─────────────────────

describe("computeCourseWarnings / subjectsMatch", () => {
  const mkAssignment = (overrides: Partial<{ schoolYear: string; sectionName: string; subjectName: string }> = {}) => ({
    schoolYear: "2029-2030",
    sectionName: "MAKABANSA",
    subjectName: "English 8",
    ...overrides,
  });

  it("suffix-only match (the bug): 'Developmental Reading' vs 'Developmental Reading 8' → no subject warning", () => {
    const warnings = computeCourseWarnings(
      { subject: "Developmental Reading" },
      mkAssignment({ subjectName: "Developmental Reading 8" }),
    );
    expect(warnings.filter(w => w.includes("Subject"))).toHaveLength(0);
  });

  it("base names equal: 'English' vs 'English' → no warning", () => {
    const warnings = computeCourseWarnings(
      { subject: "English" },
      mkAssignment({ subjectName: "English" }),
    );
    expect(warnings.filter(w => w.includes("Subject"))).toHaveLength(0);
  });

  it("cross-grade still warns: 'Filipino 7' vs 'Filipino 8' → subject warning", () => {
    const warnings = computeCourseWarnings(
      { subject: "Filipino 7" },
      mkAssignment({ subjectName: "Filipino 8" }),
    );
    expect(warnings.some(w => w.includes("Subject mismatch"))).toBe(true);
  });

  it("different subjects still warn: 'Science - Chemistry' vs 'Science 8' → warning", () => {
    const warnings = computeCourseWarnings(
      { subject: "Science - Chemistry" },
      mkAssignment({ subjectName: "Science 8" }),
    );
    expect(warnings.some(w => w.includes("Subject mismatch"))).toBe(true);
  });

  it("Grade 10 suffix: 'Science' vs 'Science 10' → no warning", () => {
    const warnings = computeCourseWarnings(
      { subject: "Science" },
      mkAssignment({ subjectName: "Science 10" }),
    );
    expect(warnings.filter(w => w.includes("Subject"))).toHaveLength(0);
  });

  it("one-sided suffix on AIMS: 'Mathematics 8' vs 'Mathematics' → no warning", () => {
    const warnings = computeCourseWarnings(
      { subject: "Mathematics 8" },
      mkAssignment({ subjectName: "Mathematics" }),
    );
    expect(warnings.filter(w => w.includes("Subject"))).toHaveLength(0);
  });

  it("section + schoolYear branches unchanged", () => {
    const warnings = computeCourseWarnings(
      { schoolYear: "2028-2029", sectionName: "OTHER", subject: "English" },
      mkAssignment({ schoolYear: "2029-2030", sectionName: "MAKABANSA", subjectName: "English" }),
    );
    expect(warnings.some(w => w.includes("School year mismatch"))).toBe(true);
    expect(warnings.some(w => w.includes("Section mismatch"))).toBe(true);
    expect(warnings.filter(w => w.includes("Subject"))).toHaveLength(0);
  });
});

// ─── P7-7: Schema preserves AIMS provenance ──────────────────────────────────

describe("P7-7: scoreItemSchema preserves isAims/assessmentId", () => {
  it("gradeSaveSchema preserves isAims and assessmentId in writtenWorkScores", () => {
    const input = {
      body: {
        studentId: "test-student",
        classAssignmentId: "test-ca",
        term: "T1" as const,
        writtenWorkScores: [
          { name: "Reading Comprehension", score: 65, maxScore: 100, isAims: true, assessmentId: "QUIZ:abc-123" },
          { name: "WW 2", score: 10, maxScore: 10 },
        ],
      },
    };
    const result = gradeSaveSchema.parse(input);
    expect(result.body.writtenWorkScores![0]).toMatchObject({
      name: "Reading Comprehension",
      score: 65,
      maxScore: 100,
      isAims: true,
      assessmentId: "QUIZ:abc-123",
    });
    expect(result.body.writtenWorkScores![1]).toMatchObject({
      name: "WW 2",
      score: 10,
      maxScore: 10,
    });
    expect((result.body.writtenWorkScores![1] as any).isAims).toBeUndefined();
  });

  it("gradeSaveSchema preserves isAims in perfTaskScores", () => {
    const input = {
      body: {
        studentId: "test-student",
        classAssignmentId: "test-ca",
        term: "T1" as const,
        perfTaskScores: [
          { name: "Persuasive Essay", score: 80, maxScore: 100, isAims: true, assessmentId: "TASK:def-456" },
        ],
      },
    };
    const result = gradeSaveSchema.parse(input);
    expect(result.body.perfTaskScores![0]).toMatchObject({
      name: "Persuasive Essay",
      score: 80,
      maxScore: 100,
      isAims: true,
      assessmentId: "TASK:def-456",
    });
  });
});
