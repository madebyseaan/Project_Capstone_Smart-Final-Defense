/**
 * term-finalization.test.ts — Registrar term-end finalization.
 *
 * Locks the separated contract:
 *   - DRAFT -> FINALIZED is per section + term.
 *   - It never creates EOSY snapshots or promotion status (no auto-EOSY).
 *   - EOSY promotion data blocks unfinalizing term grades.
 *   - Archived years are read-only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/tokens";
import registrarRoutes from "../routes/registrar";

const YEAR = "2087-2088";
const app = express();
app.use(express.json());
app.use("/api/registrar", registrarRoutes);

let token = "";
let registrarUserId = "";
let teacherUserId = "";
let teacherId = "";
let studentId = "";
let sectionId = "";
let subjectAId = "";
let subjectBId = "";
let classAssignmentAId = "";
let classAssignmentBId = "";
let enrollmentId = "";

const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const suffix = Date.now();

  // Keep the fixed-year fixture idempotent across reruns.
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  const staleSections = await prisma.section.findMany({
    where: { schoolYear: YEAR },
    select: { id: true },
  });
  if (staleSections.length > 0) {
    await prisma.section.deleteMany({ where: { id: { in: staleSections.map((s) => s.id) } } }).catch(() => {});
  }
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});

  const registrar = await prisma.user.create({
    data: {
      username: `reg-termfin-${suffix}`,
      password: "hashed",
      role: "REGISTRAR",
      status: "ACTIVE",
      firstName: "Reg",
      lastName: "TermFin",
    },
  });
  registrarUserId = registrar.id;
  token = signAccessToken({ id: registrar.id, username: registrar.username, role: "REGISTRAR" });

  const teacherUser = await prisma.user.create({
    data: { username: `t-termfin-${suffix}`, password: "hashed", role: "TEACHER", status: "ACTIVE" },
  });
  teacherUserId = teacherUser.id;
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, employeeId: `EMP-TERMFIN-${suffix}` },
  });
  teacherId = teacher.id;

  const student = await prisma.student.create({
    data: { lrn: `LRN-TERMFIN-${suffix}`, firstName: "Term", lastName: "Fin" },
  });
  studentId = student.id;

  const subjectA = await prisma.subject.create({
    data: { code: `TERMFIN-A-${suffix}`, name: `TermFin Subject A ${suffix}` },
  });
  const subjectB = await prisma.subject.create({
    data: { code: `TERMFIN-B-${suffix}`, name: `TermFin Subject B ${suffix}` },
  });
  subjectAId = subjectA.id;
  subjectBId = subjectB.id;

  const section = await prisma.section.create({
    data: { name: `TermFin Section ${suffix}`, schoolYear: YEAR, gradeLevel: "GRADE_7", status: "ACTIVE" },
  });
  sectionId = section.id;

  const caA = await prisma.classAssignment.create({
    data: { sectionId, schoolYear: YEAR, subjectId: subjectAId, teacherId, isActive: true },
  });
  const caB = await prisma.classAssignment.create({
    data: { sectionId, schoolYear: YEAR, subjectId: subjectBId, teacherId, isActive: true },
  });
  classAssignmentAId = caA.id;
  classAssignmentBId = caB.id;

  const enrollment = await prisma.enrollment.create({
    data: { studentId, sectionId, schoolYear: YEAR, status: "ENROLLED" },
  });
  enrollmentId = enrollment.id;

  await prisma.schoolYear.create({
    data: { label: YEAR, status: "ACTIVE" },
  });

  await prisma.grade.createMany({
    data: [
      { studentId, classAssignmentId: classAssignmentAId, term: "T1", status: "DRAFT", writtenWorkScores: [], perfTaskScores: [] },
      { studentId, classAssignmentId: classAssignmentBId, term: "T1", status: "DRAFT", writtenWorkScores: [], perfTaskScores: [] },
    ],
  });
});

afterAll(async () => {
  await prisma.gradeSnapshot.deleteMany({ where: { schoolYear: YEAR } }).catch(() => {});
  await prisma.grade.deleteMany({
    where: { classAssignmentId: { in: [classAssignmentAId, classAssignmentBId] } },
  }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { id: enrollmentId } }).catch(() => {});
  await prisma.classAssignment.deleteMany({
    where: { id: { in: [classAssignmentAId, classAssignmentBId] } },
  }).catch(() => {});
  await prisma.section.deleteMany({ where: { id: sectionId } }).catch(() => {});
  await prisma.subject.deleteMany({ where: { id: { in: [subjectAId, subjectBId] } } }).catch(() => {});
  await prisma.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { id: studentId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [registrarUserId, teacherUserId] } } }).catch(() => {});
  await prisma.schoolYear.deleteMany({ where: { label: YEAR } }).catch(() => {});
});

describe("term finalization", () => {
  it("returns a term-first overview with per-subject DRAFT counts", async () => {
    const res = await request(app)
      .get("/api/registrar/term-finalization")
      .query({ schoolYear: YEAR, term: "T1" })
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.schoolYear).toBe(YEAR);
    expect(res.body.term).toBe("T1");

    const section = res.body.sections.find((s: any) => s.sectionId === sectionId);
    expect(section).toBeDefined();
    expect(section.totalSubjects).toBe(2);
    expect(section.draftCount).toBe(2);
    expect(section.finalizedSubjects).toBe(0);
    expect(section.eosyStarted).toBe(false);
    expect(section.subjects.flatMap((s: any) => s.subjectIds).sort()).toEqual(
      [subjectAId, subjectBId].sort(),
    );
  });

  it("returns the term grade preview for the requested school year", async () => {
    const res = await request(app)
      .get(`/api/registrar/student-grades/${sectionId}/T1`)
      .query({ schoolYear: YEAR })
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.students).toHaveLength(1);
    expect(res.body.students[0].subjects).toHaveLength(2);
    expect(
      res.body.students[0].subjects.every((subject: any) => subject.status === "DRAFT"),
    ).toBe(true);
  });

  it("includes dropped/transferred learners in the preview when requested", async () => {
    const suffix = Date.now();
    const extraStudent = await prisma.student.create({
      data: { lrn: `LRN-TERMFIN-DROP-${suffix}`, firstName: "Dropped", lastName: "Learner" },
    });
    const extraEnrollment = await prisma.enrollment.create({
      data: {
        studentId: extraStudent.id,
        sectionId,
        schoolYear: YEAR,
        status: "DROPPED",
      },
    });
    await prisma.grade.create({
      data: {
        studentId: extraStudent.id,
        classAssignmentId: classAssignmentAId,
        term: "T1",
        status: "DRAFT",
        writtenWorkScores: [],
        perfTaskScores: [],
      },
    });

    try {
      const enrolledOnly = await request(app)
        .get(`/api/registrar/student-grades/${sectionId}/T1`)
        .query({ schoolYear: YEAR })
        .set(auth());
      expect(enrolledOnly.status).toBe(200);
      expect(enrolledOnly.body.students).toHaveLength(1);

      const withInactive = await request(app)
        .get(`/api/registrar/student-grades/${sectionId}/T1`)
        .query({ schoolYear: YEAR, includeInactive: 1 })
        .set(auth());
      expect(withInactive.status).toBe(200);
      expect(withInactive.body.students).toHaveLength(2);

      const dropped = withInactive.body.students.find(
        (student: any) => student.studentId === extraStudent.id,
      );
      expect(dropped).toBeDefined();
      expect(dropped.enrollmentStatus).toBe("DROPPED");
    } finally {
      await prisma.grade.deleteMany({ where: { studentId: extraStudent.id } }).catch(() => {});
      await prisma.enrollment.deleteMany({ where: { id: extraEnrollment.id } }).catch(() => {});
      await prisma.student.deleteMany({ where: { id: extraStudent.id } }).catch(() => {});
    }
  });

  it("keeps rotation components separate when mergeRotations=0", async () => {
    const suffix = Date.now();
    const rotationGroupId = `TEST_ROT_${suffix}`;
    const rotationA = await prisma.subject.create({
      data: {
        code: `TERMFIN-ROT-A-${suffix}`,
        name: `Test Rotation - Alpha ${suffix}`,
        rotationTermGroupId: rotationGroupId,
        rotationTermRank: 1,
        rotationOutputLabel: "ROT",
      },
    });
    const rotationB = await prisma.subject.create({
      data: {
        code: `TERMFIN-ROT-B-${suffix}`,
        name: `Test Rotation - Beta ${suffix}`,
        rotationTermGroupId: rotationGroupId,
        rotationTermRank: 2,
        rotationOutputLabel: "ROT",
      },
    });
    const caA = await prisma.classAssignment.create({
      data: { sectionId, schoolYear: YEAR, subjectId: rotationA.id, teacherId, isActive: true },
    });
    const caB = await prisma.classAssignment.create({
      data: { sectionId, schoolYear: YEAR, subjectId: rotationB.id, teacherId, isActive: true },
    });
    await prisma.grade.createMany({
      data: [
        { studentId, classAssignmentId: caA.id, term: "T1", status: "DRAFT", writtenWorkScores: [], perfTaskScores: [] },
        { studentId, classAssignmentId: caB.id, term: "T1", status: "DRAFT", writtenWorkScores: [], perfTaskScores: [] },
      ],
    });

    try {
      const raw = await request(app)
        .get(`/api/registrar/student-grades/${sectionId}/T1`)
        .query({ schoolYear: YEAR, mergeRotations: 0 })
        .set(auth());
      expect(raw.status).toBe(200);
      const rawNames = raw.body.students[0].subjects.map((subject: any) => subject.subjectName);
      expect(rawNames).toContain(`Test Rotation - Alpha ${suffix}`);
      expect(rawNames).toContain(`Test Rotation - Beta ${suffix}`);

      const merged = await request(app)
        .get(`/api/registrar/student-grades/${sectionId}/T1`)
        .query({ schoolYear: YEAR })
        .set(auth());
      expect(merged.status).toBe(200);
      const rotationRows = merged.body.students[0].subjects.filter(
        (subject: any) => subject.rotationTermGroupId === rotationGroupId,
      );
      expect(rotationRows).toHaveLength(1);
    } finally {
      await prisma.grade.deleteMany({ where: { classAssignmentId: { in: [caA.id, caB.id] } } }).catch(() => {});
      await prisma.classAssignment.deleteMany({ where: { id: { in: [caA.id, caB.id] } } }).catch(() => {});
      await prisma.subject.deleteMany({ where: { id: { in: [rotationA.id, rotationB.id] } } }).catch(() => {});
    }
  });

  it("finalizes a single subject without touching the other subject", async () => {
    const res = await request(app)
      .post("/api/registrar/term-finalization/finalize")
      .set(auth())
      .send({ sectionId, term: "T1", schoolYear: YEAR, subjectIds: [subjectAId] });

    expect(res.status).toBe(200);
    expect(res.body.finalizedCount).toBe(1);
    expect(res.body.remainingSelectedDrafts).toBe(0);
    expect(res.body.remainingTermDrafts).toBe(1);

    const a = await prisma.grade.findFirst({ where: { classAssignmentId: classAssignmentAId, term: "T1" } });
    const b = await prisma.grade.findFirst({ where: { classAssignmentId: classAssignmentBId, term: "T1" } });
    expect(a?.status).toBe("FINALIZED");
    expect(b?.status).toBe("DRAFT");
  });

  it("finalizes the rest of the section term and NEVER creates EOSY snapshots", async () => {
    const res = await request(app)
      .post("/api/registrar/term-finalization/finalize")
      .set(auth())
      .send({ sectionId, term: "T1", schoolYear: YEAR });

    expect(res.status).toBe(200);
    expect(res.body.finalizedCount).toBe(1);
    expect(res.body.remainingTermDrafts).toBe(0);

    const snapshotCount = await prisma.gradeSnapshot.count({ where: { schoolYear: YEAR } });
    expect(snapshotCount, "term finalization must not create EOSY snapshots").toBe(0);

    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    expect(enrollment?.promotionStatus, "term finalization must not write promotion status").toBeNull();
  });

  it("unfinalizes a term when EOSY has not run", async () => {
    const res = await request(app)
      .post("/api/registrar/term-finalization/unfinalize")
      .set(auth())
      .send({ sectionId, term: "T1", schoolYear: YEAR });

    expect(res.status).toBe(200);
    expect(res.body.unfinalizedCount).toBe(2);

    const remaining = await prisma.grade.count({
      where: {
        classAssignmentId: { in: [classAssignmentAId, classAssignmentBId] },
        term: "T1",
        status: "FINALIZED",
      },
    });
    expect(remaining).toBe(0);
  });

  it("allows finalizing when EOSY promotion data is only partial (drafts remain)", async () => {
    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { promotionStatus: "PROMOTED" },
    });

    const res = await request(app)
      .post("/api/registrar/term-finalization/finalize")
      .set(auth())
      .send({ sectionId, term: "T1", schoolYear: YEAR });

    expect(res.status).toBe(200);
    expect(res.body.finalizedCount).toBe(2);

    await prisma.grade.updateMany({
      where: { classAssignmentId: { in: [classAssignmentAId, classAssignmentBId] }, term: "T1" },
      data: { status: "DRAFT" },
    });
    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { promotionStatus: null },
    });
  });

  it("blocks finalizing and unfinalizing after EOSY is fully finalized", async () => {
    await prisma.grade.updateMany({
      where: { classAssignmentId: { in: [classAssignmentAId, classAssignmentBId] }, term: "T1" },
      data: { status: "FINALIZED" },
    });
    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { promotionStatus: "PROMOTED" },
    });

    const finalizeRes = await request(app)
      .post("/api/registrar/term-finalization/finalize")
      .set(auth())
      .send({ sectionId, term: "T1", schoolYear: YEAR });
    expect(finalizeRes.status).toBe(409);
    expect(finalizeRes.body.code).toBe("EOSY_FINALIZED");

    const res = await request(app)
      .post("/api/registrar/term-finalization/unfinalize")
      .set(auth())
      .send({ sectionId, term: "T1", schoolYear: YEAR });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EOSY_FINALIZED");

    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { promotionStatus: null },
    });
  });

  it("blocks finalization for an archived school year", async () => {
    await prisma.schoolYear.update({ where: { label: YEAR }, data: { status: "ARCHIVED" } });

    const res = await request(app)
      .post("/api/registrar/term-finalization/finalize")
      .set(auth())
      .send({ sectionId, term: "T1", schoolYear: YEAR });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("YEAR_ARCHIVED");

    await prisma.schoolYear.update({ where: { label: YEAR }, data: { status: "ACTIVE" } });
  });
});
