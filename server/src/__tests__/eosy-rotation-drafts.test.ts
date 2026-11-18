/**
 * eosy-rotation-drafts.test.ts — EOSY draft blockers must follow the canonical
 * rotation rule: a rotation component only requires its own rank term.
 *
 * Stray out-of-term rows (e.g. a Science-Chemistry T1 grade when Chemistry is
 * rank 2) are ignored by mergeRotationSubjects, so they must not block EOSY,
 * the year status board, or the finals preview. Genuine drafts still block.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { Router } from "express";
import request from "supertest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";
import registerMainRoutes from "../routes/registrar/main";
import {
  computeSectionPromotions,
  finalizeSectionEosy,
  listSectionEosyStatuses,
} from "../lib/promotion";
import { unfinalizeSectionTerm } from "../lib/termFinalization";

const YEAR = "2094-2095";
const app = express();
app.use(express.json());
const router = Router();
registerMainRoutes(router);
app.use("/api/registrar", router);

let token = "";
let registrarUserId = "";
let teacherUserId = "";
let teacherId = "";
const studentIds: string[] = [];
const studentIdByFixture: Record<string, string> = {};
const sectionIds: Record<string, string> = {};
const subjectIds: Record<string, string> = {};
const assignmentIds: Record<string, string> = {};

const auth = () => ({ Authorization: `Bearer ${token}` });
const TERMS = ["T1", "T2", "T3"] as const;

async function cleanupYear() {
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.grade.deleteMany({ where: { classAssignment: { schoolYear: YEAR } } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.classAssignment.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.section.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
}

beforeAll(async () => {
  const suffix = Date.now();
  await cleanupYear();

  const registrar = await prisma.user.create({
    data: {
      username: `reg-eosy-rot-${suffix}`,
      password: "hashed",
      role: "REGISTRAR",
      status: "ACTIVE",
      firstName: "Reg",
      lastName: "EosyRot",
    },
  });
  registrarUserId = registrar.id;
  token = signAccessToken({
    id: registrar.id,
    username: registrar.username,
    role: "REGISTRAR",
  });

  const teacherUser = await prisma.user.create({
    data: { username: `t-eosy-rot-${suffix}`, password: "hashed", role: "TEACHER", status: "ACTIVE" },
  });
  teacherUserId = teacherUser.id;
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `EMP-EOSY-ROT-${suffix}` },
  });
  teacherId = teacher.id;

  const rotationGroupId = `EOSY_ROT_${suffix}`;
  const makeSubject = async (
    key: string,
    data: {
      code: string;
      name: string;
      rotationTermGroupId?: string | null;
      rotationTermRank?: number | null;
      rotationOutputLabel?: string | null;
    },
  ) => {
    const subject = await prisma.subject.create({ data });
    subjectIds[key] = subject.id;
    return subject;
  };

  await makeSubject("alpha", {
    code: `EOSYROT-A-${suffix}`,
    name: `EOSY Rotation 7 - Alpha ${suffix}`,
    rotationTermGroupId: rotationGroupId,
    rotationTermRank: 1,
    rotationOutputLabel: "EOSYROT",
  });
  await makeSubject("beta", {
    code: `EOSYROT-B-${suffix}`,
    name: `EOSY Rotation 7 - Beta ${suffix}`,
    rotationTermGroupId: rotationGroupId,
    rotationTermRank: 2,
    rotationOutputLabel: "EOSYROT",
  });
  await makeSubject("gamma", {
    code: `EOSYROT-C-${suffix}`,
    name: `EOSY Rotation 7 - Gamma ${suffix}`,
    rotationTermGroupId: rotationGroupId,
    rotationTermRank: 3,
    rotationOutputLabel: "EOSYROT",
  });
  await makeSubject("math", { code: `EOSYROT-M-${suffix}`, name: `EOSY Math 7 ${suffix}` });

  await prisma.schoolYear.create({ data: { label: YEAR, status: "ACTIVE" } });

  const makeSectionFixture = async (key: string, name: string) => {
    const section = await prisma.section.create({
      data: { name, schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
    });
    sectionIds[key] = section.id;

    const student = await prisma.student.create({
      data: { lrn: `LRN-EOSYROT-${key}-${suffix}`, firstName: "Test", lastName: key },
    });
    studentIds.push(student.id);
    studentIdByFixture[key] = student.id;

    await prisma.enrollment.create({
      data: {
        studentId: student.id,
        sectionId: section.id,
        schoolYear: YEAR,
        status: "ENROLLED",
        // The ready section simulates an EOSY-finalized section whose only
        // remaining DRAFT rows are stray out-of-term rotation rows.
        promotionStatus: key === "ready" ? "PROMOTED" : null,
      },
    });

    for (const subjectKey of ["alpha", "beta", "gamma", "math"] as const) {
      const assignment = await prisma.classAssignment.create({
        data: {
          sectionId: section.id,
          schoolYear: YEAR,
          subjectId: subjectIds[subjectKey],
          teacherId,
          isActive: true,
        },
      });
      assignmentIds[`${key}:${subjectKey}`] = assignment.id;
    }

    return { section, student };
  };

  const ready = await makeSectionFixture("ready", "Status Rotation Ready");
  const draft = await makeSectionFixture("draft", "Status Rotation Draft");

  const grade = (
    fixture: string,
    subjectKey: string,
    term: (typeof TERMS)[number],
    status: "DRAFT" | "FINALIZED",
    quarterlyGrade: number | null,
  ) => ({
    studentId: studentIdByFixture[fixture],
    classAssignmentId: assignmentIds[`${fixture}:${subjectKey}`],
    term,
    status,
    quarterlyGrade,
    writtenWorkScores: [],
    perfTaskScores: [],
  });

  await prisma.grade.createMany({
    data: [
      // Ready section: each rotation component is final in its own rank term.
      grade("ready", "alpha", "T1", "FINALIZED", 90),
      grade("ready", "beta", "T2", "FINALIZED", 91),
      grade("ready", "gamma", "T3", "FINALIZED", 92),
      grade("ready", "math", "T1", "FINALIZED", 88),
      grade("ready", "math", "T2", "FINALIZED", 88),
      grade("ready", "math", "T3", "FINALIZED", 88),
      // Stray out-of-term DRAFT rows. mergeRotationSubjects ignores these,
      // so they must not block EOSY or leak into the final grade.
      grade("ready", "beta", "T1", "DRAFT", 50),
      grade("ready", "gamma", "T1", "DRAFT", 50),
      grade("ready", "alpha", "T2", "DRAFT", 50),
      grade("ready", "gamma", "T2", "DRAFT", 50),
      grade("ready", "alpha", "T3", "DRAFT", 50),
      grade("ready", "beta", "T3", "DRAFT", 50),
      // Draft section: genuine out-of-term strays plus one real rank-term draft.
      grade("draft", "alpha", "T1", "FINALIZED", 90),
      grade("draft", "beta", "T2", "DRAFT", 91),
      grade("draft", "gamma", "T3", "FINALIZED", 92),
      grade("draft", "math", "T1", "FINALIZED", 88),
      grade("draft", "math", "T2", "FINALIZED", 88),
      grade("draft", "math", "T3", "FINALIZED", 88),
      grade("draft", "beta", "T1", "DRAFT", 50),
      grade("draft", "gamma", "T1", "DRAFT", 50),
    ],
  });
});

afterAll(async () => {
  await cleanupYear();
  await prisma.subject.deleteMany({
    where: { id: { in: Object.values(subjectIds) } },
  }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: { in: studentIds } } }).catch(() => {});
  await prisma.user.deleteMany({
    where: { id: { in: [registrarUserId, teacherUserId] } },
  }).catch(() => {});
});

describe("EOSY rotation draft blockers", () => {
  it("ignores stray out-of-term rotation drafts in computed promotions", async () => {
    const promotions = await computeSectionPromotions(sectionIds.ready, YEAR);
    expect(promotions).not.toBeNull();
    expect(promotions!.draftBlockers).toEqual([]);

    const subjects = promotions!.enrollments[0].subjects;
    const rotation = subjects.find((row) => row.subjectCode === "EOSYROT");
    expect(rotation).toBeDefined();
    // Each component only contributes its rank term; stray 50s must not leak.
    expect(rotation!.T1).toBe(90);
    expect(rotation!.T2).toBe(91);
    expect(rotation!.T3).toBe(92);
    expect(rotation!.finalRating).toBe(91);
  });

  it("still blocks on a genuine rank-term draft", async () => {
    const promotions = await computeSectionPromotions(sectionIds.draft, YEAR);
    expect(promotions).not.toBeNull();
    expect(promotions!.draftBlockers).toHaveLength(1);
    expect(promotions!.draftBlockers[0].term).toBe("T2");
    expect(promotions!.draftBlockers[0].subjectCode).toContain("EOSYROT-B");
  });

  it("reports the year status board without rotation false positives", async () => {
    const statuses = await listSectionEosyStatuses(YEAR);
    const byName = new Map(statuses.map((section) => [section.sectionName, section]));

    expect(byName.get("Status Rotation Ready")?.draftBlockerCount).toBe(0);
    expect(byName.get("Status Rotation Ready")?.finalized).toBe(true);
    expect(byName.get("Status Rotation Draft")?.draftBlockerCount).toBe(1);
    expect(byName.get("Status Rotation Draft")?.finalized).toBe(false);
  });

  it("excludes out-of-term rotation rows from the EOSY readiness response", async () => {
    const ready = await request(app)
      .get(`/api/registrar/finalize-status-all/${sectionIds.ready}`)
      .query({ schoolYear: YEAR })
      .set(auth());
    expect(ready.status).toBe(200);

    const readyScience = ready.body.subjects.find((row: any) =>
      row.subjectName.startsWith("EOSY Rotation 7"),
    );
    expect(readyScience).toBeDefined();
    expect(readyScience.totalDraft).toBe(0);
    expect(readyScience.totalGrades).toBe(3);
    for (const term of TERMS) {
      expect(readyScience.terms[term].draft).toBe(0);
      expect(readyScience.terms[term].total).toBe(1);
    }

    const draft = await request(app)
      .get(`/api/registrar/finalize-status-all/${sectionIds.draft}`)
      .query({ schoolYear: YEAR })
      .set(auth());
    expect(draft.status).toBe(200);

    const draftScience = draft.body.subjects.find((row: any) =>
      row.subjectName.startsWith("EOSY Rotation 7"),
    );
    expect(draftScience).toBeDefined();
    expect(draftScience.totalDraft).toBe(1);
    expect(draftScience.terms.T2.draft).toBe(1);
    expect(draftScience.terms.T1.draft).toBe(0);
  });

  it("finalizes EOSY over stray drafts and then blocks term edits", async () => {
    const result = await finalizeSectionEosy({
      sectionId: sectionIds.ready,
      schoolYear: YEAR,
      actor: { id: registrarUserId, name: "Registrar", role: "REGISTRAR" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.processed).toBe(1);
      expect(result.snapshotsCreated).toBe(6);
    }

    const guard = await unfinalizeSectionTerm({
      sectionId: sectionIds.ready,
      term: "T1",
      schoolYear: YEAR,
    });
    expect(guard).toEqual({ ok: false, error: "EOSY_FINALIZED", eosyFinalized: true });
  });

  it("does not finalize EOSY while a rank-term draft remains", async () => {
    const result = await finalizeSectionEosy({
      sectionId: sectionIds.draft,
      schoolYear: YEAR,
      actor: { id: registrarUserId, name: "Registrar", role: "REGISTRAR" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error === "DRAFT_BLOCKED") {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].term).toBe("T2");
    }
  });
});
