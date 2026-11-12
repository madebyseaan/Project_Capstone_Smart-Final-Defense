/**
 * eosy-finalization-status.test.ts — registrar year-level EOSY status board.
 *
 * Locks the read-only contract:
 *   - every section is reported (not only unfinalized ones)
 *   - states distinguish finalized / partial / not started / empty
 *   - HG draft grades never block EOSY finalization
 *   - snapshot gaps are surfaced separately for rollover readiness
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { Router } from "express";
import request from "supertest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";
import registerEosyRoutes from "../routes/registrar/eosy";
import {
  listSectionEosyStatuses,
  listUnfinalizedSections,
} from "../lib/promotion";

const YEAR = "2097-2098";
const app = express();
app.use(express.json());
const router = Router();
registerEosyRoutes(router);
app.use("/api/registrar", router);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let registrarToken = "";
let teacherToken = "";
let registrarUserId = "";
let teacherUserId = "";
let teacherId = "";
let mathSubjectId = "";
let hgSubjectId = "";
const studentIds: string[] = [];
const sectionIds: Record<string, string> = {};
const classAssignmentIds: Record<string, string> = {};

function authHeader(token: string) {
  return auth(token);
}

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
      username: `reg-eosy-status-${suffix}`,
      password: "hashed",
      role: "REGISTRAR",
      status: "ACTIVE",
      firstName: "Reg",
      lastName: "EosyStatus",
    },
  });
  registrarUserId = registrar.id;
  registrarToken = signAccessToken({
    id: registrar.id,
    username: registrar.username,
    role: "REGISTRAR",
  });

  const teacherUser = await prisma.user.create({
    data: {
      username: `t-eosy-status-${suffix}`,
      password: "hashed",
      role: "TEACHER",
      status: "ACTIVE",
    },
  });
  teacherUserId = teacherUser.id;
  teacherToken = signAccessToken({
    id: teacherUser.id,
    username: teacherUser.username,
    role: "TEACHER",
  });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `EMP-EOSY-STATUS-${suffix}` },
  });
  teacherId = teacher.id;

  const math = await prisma.subject.create({
    data: { code: `MATH-STATUS-${suffix}`, name: "Mathematics" },
  });
  mathSubjectId = math.id;
  const hg = await prisma.subject.create({
    data: {
      code: `HG-STATUS-${suffix}`,
      name: "Homeroom Guidance",
      isNonPromotional: true,
    },
  });
  hgSubjectId = hg.id;

  await prisma.schoolYear.create({
    data: { label: YEAR, status: "ACTIVE" },
  });

  const makeSection = async (key: string, name: string) => {
    const section = await prisma.section.create({
      data: { name, schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
    });
    sectionIds[key] = section.id;
    return section;
  };

  const makeStudent = async (key: string) => {
    const student = await prisma.student.create({
      data: { lrn: `LRN-EOSY-${key}-${suffix}`, firstName: "Test", lastName: key },
    });
    studentIds.push(student.id);
    return student;
  };

  const enroll = async (
    sectionId: string,
    studentId: string,
    promotionStatus: "PROMOTED" | null,
  ) => {
    await prisma.enrollment.create({
      data: {
        studentId,
        sectionId,
        schoolYear: YEAR,
        status: "ENROLLED",
        promotionStatus,
      },
    });
  };

  const assigned = async (sectionId: string, subjectId: string) => {
    const assignment = await prisma.classAssignment.create({
      data: { sectionId, schoolYear: YEAR, subjectId, teacherId, isActive: true },
    });
    return assignment;
  };

  const makeGrade = async (
    sectionId: string,
    assignmentId: string,
    studentId: string,
    status: "DRAFT" | "FINALIZED",
  ) => {
    return prisma.grade.create({
      data: {
        studentId,
        classAssignmentId: assignmentId,
        term: "T1",
        status,
        writtenWorkScores: [],
        perfTaskScores: [],
      },
    });
  };

  // Finalized: all enrollments have a stored promotion status.
  const finalized = await makeSection("finalized", "Status Finalized");
  const finalStudent = await makeStudent("finalized");
  await enroll(finalized.id, finalStudent.id, "PROMOTED");

  // Partially finalized: one of two learners has promotion status.
  const partial = await makeSection("partial", "Status Partial");
  const partialStudentA = await makeStudent("partial-a");
  const partialStudentB = await makeStudent("partial-b");
  await enroll(partial.id, partialStudentA.id, "PROMOTED");
  await enroll(partial.id, partialStudentB.id, null);

  // Not started: enrollment exists, no promotion status.
  const notStarted = await makeSection("notStarted", "Status Not Started");
  const notStartedStudent = await makeStudent("not-started");
  await enroll(notStarted.id, notStartedStudent.id, null);

  // Empty: no enrolled learners.
  await makeSection("empty", "Status Empty");

  // Draft blocked: all statuses stored, but a DRAFT grade remains.
  const draftBlocked = await makeSection("draftBlocked", "Status Draft Blocked");
  const draftStudent = await makeStudent("draft");
  await enroll(draftBlocked.id, draftStudent.id, "PROMOTED");
  const draftAssignment = await assigned(draftBlocked.id, mathSubjectId);
  classAssignmentIds.draftBlocked = draftAssignment.id;
  await makeGrade(draftBlocked.id, draftAssignment.id, draftStudent.id, "DRAFT");

  // Homeroom Guidance draft must not block finalization.
  const hgDraft = await makeSection("hgDraft", "Status HG Draft");
  const hgStudent = await makeStudent("hg-draft");
  await enroll(hgDraft.id, hgStudent.id, "PROMOTED");
  const hgAssignment = await assigned(hgDraft.id, hgSubjectId);
  classAssignmentIds.hgDraft = hgAssignment.id;
  await makeGrade(hgDraft.id, hgAssignment.id, hgStudent.id, "DRAFT");

  // Snapshot gap: finalized grades exist but no EOSY_FINALIZE snapshot row.
  const snapshotGap = await makeSection("snapshotGap", "Status Snapshot Gap");
  const gapStudent = await makeStudent("snapshot-gap");
  await enroll(snapshotGap.id, gapStudent.id, "PROMOTED");
  const gapAssignment = await assigned(snapshotGap.id, mathSubjectId);
  classAssignmentIds.snapshotGap = gapAssignment.id;
  await makeGrade(snapshotGap.id, gapAssignment.id, gapStudent.id, "FINALIZED");
});

afterAll(async () => {
  await cleanupYear();
  await prisma.subject.deleteMany({
    where: { id: { in: [mathSubjectId, hgSubjectId] } },
  }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: { in: studentIds } } }).catch(() => {});
  await prisma.user.deleteMany({
    where: { id: { in: [registrarUserId, teacherUserId] } },
  }).catch(() => {});
});

describe("GET /api/registrar/eosy/finalization-status", () => {
  it("rejects non-registrar users", async () => {
    const res = await request(app)
      .get("/api/registrar/eosy/finalization-status")
      .query({ schoolYear: YEAR })
      .set(authHeader(teacherToken));

    expect(res.status).toBe(403);
  });

  it("requires a schoolYear query parameter", async () => {
    const res = await request(app)
      .get("/api/registrar/eosy/finalization-status")
      .set(authHeader(registrarToken));

    expect(res.status).toBe(400);
  });

  it("reports every section with its finalization state", async () => {
    const res = await request(app)
      .get("/api/registrar/eosy/finalization-status")
      .query({ schoolYear: YEAR })
      .set(authHeader(registrarToken));

    expect(res.status).toBe(200);
    expect(res.body.schoolYear).toBe(YEAR);
    expect(res.body.yearFound).toBe(true);

    const byName = new Map<string, any>(
      res.body.sections.map((section: any) => [section.sectionName, section]),
    );

    expect(byName.get("Status Finalized")?.state).toBe("FINALIZED");
    expect(byName.get("Status Finalized")?.finalized).toBe(true);
    expect(byName.get("Status Partial")?.state).toBe("PARTIAL");
    expect(byName.get("Status Partial")?.withStoredStatus).toBe(1);
    expect(byName.get("Status Not Started")?.state).toBe("NOT_STARTED");
    expect(byName.get("Status Empty")?.state).toBe("EMPTY");
    expect(byName.get("Status Empty")?.finalized).toBe(true);
    expect(byName.get("Status Draft Blocked")?.finalized).toBe(false);
    expect(byName.get("Status Draft Blocked")?.draftBlockerCount).toBe(1);
    expect(byName.get("Status HG Draft")?.finalized).toBe(true);
    expect(byName.get("Status HG Draft")?.draftBlockerCount).toBe(0);
    expect(byName.get("Status Snapshot Gap")?.snapshotGap).toBe(true);

    expect(res.body.summary.totalSections).toBe(7);
    expect(res.body.summary.finalizedSections).toBe(3);
    expect(res.body.summary.emptySections).toBe(1);
    expect(res.body.summary.partialSections).toBe(2);
    expect(res.body.summary.notStartedSections).toBe(1);
    expect(res.body.summary.snapshotGapSections).toBe(1);
    expect(res.body.summary.readyForRollover).toBe(false);
  });

  it("returns an empty overview for an unknown school year", async () => {
    const res = await request(app)
      .get("/api/registrar/eosy/finalization-status")
      .query({ schoolYear: "2096-2097" })
      .set(authHeader(registrarToken));

    expect(res.status).toBe(200);
    expect(res.body.yearFound).toBe(false);
    expect(res.body.summary.totalSections).toBe(0);
    expect(res.body.sections).toEqual([]);
  });
});

describe("bulk status parity", () => {
  it("lists only non-finalized sections for rollover, ignoring HG drafts", async () => {
    const statuses = await listSectionEosyStatuses(YEAR);
    const unfinalized = await listUnfinalizedSections(YEAR);
    const unfinalizedNames = unfinalized.map((section) => section.sectionName).sort();

    expect(statuses).toHaveLength(7);
    expect(unfinalizedNames).toEqual([
      "Status Draft Blocked",
      "Status Not Started",
      "Status Partial",
    ]);
    expect(unfinalizedNames).not.toContain("Status HG Draft");
    expect(unfinalizedNames).not.toContain("Status Snapshot Gap");
  });
});

describe("POST /api/registrar/eosy/unfinalize-all", () => {
  it("rejects non-registrar users", async () => {
    const res = await request(app)
      .post("/api/registrar/eosy/unfinalize-all")
      .send({ schoolYear: YEAR })
      .set(authHeader(teacherToken));

    expect(res.status).toBe(403);
  });

  it("unfinalizes every section that has a stored promotion status", async () => {
    const before = await listSectionEosyStatuses(YEAR);
    const eligible = before.filter((section) => section.withStoredStatus > 0);
    expect(eligible).toHaveLength(5);

    const res = await request(app)
      .post("/api/registrar/eosy/unfinalize-all")
      .send({ schoolYear: YEAR })
      .set(authHeader(registrarToken));

    expect(res.status).toBe(200);
    expect(res.body.schoolYear).toBe(YEAR);
    expect(res.body.targeted).toBe(5);
    expect(res.body.unfinalized).toBe(5);
    expect(res.body.blocked).toEqual([]);

    const after = await listSectionEosyStatuses(YEAR);
    expect(after.every((section) => section.withStoredStatus === 0)).toBe(true);
  });

  it("is idempotent when nothing is finalized", async () => {
    const res = await request(app)
      .post("/api/registrar/eosy/unfinalize-all")
      .send({ schoolYear: YEAR })
      .set(authHeader(registrarToken));

    expect(res.status).toBe(200);
    expect(res.body.targeted).toBe(0);
    expect(res.body.unfinalized).toBe(0);
  });
});
