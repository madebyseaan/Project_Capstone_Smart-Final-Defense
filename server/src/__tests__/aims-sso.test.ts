import http from "http";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { getActiveSchoolYear } from "../lib/schoolYearResolver";
import { signAccessToken } from "../lib/tokens";
import aimsSsoRoutes from "../routes/aimsSso";
import {
  aimsReverseAliasRouter,
  aimsReverseSessionRouter,
} from "../routes/aimsReverseSso";
import {
  exchangeAimsCode,
  getAimsSsoConfig,
} from "../services/aimsSsoService";
import {
  exchangeAimsReverseCode,
  getAimsReverseConfig,
  issueAimsReverseCode,
} from "../services/aimsReverseSsoService";

const TEST_SECRET = "test-aims-sso-secret-1234567890";
const TEST_AIMS_CALLBACK = "http://127.0.0.1:5000/api/v1/auth/smart/callback";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const originalEnv = {
  aimsExchangeUrl: process.env.AIMS_SSO_EXCHANGE_URL,
  aimsClientId: process.env.AIMS_SSO_CLIENT_ID,
  aimsClientSecret: process.env.AIMS_SSO_CLIENT_SECRET,
  reverseCallback: process.env.AIMS_SSO_REVERSE_CALLBACK_URL,
  reverseClientId: process.env.AIMS_SSO_REVERSE_CLIENT_ID,
  reverseClientSecret: process.env.AIMS_SSO_REVERSE_CLIENT_SECRET,
  reverseSchoolId: process.env.AIMS_SSO_SCHOOL_ID,
};

let server: http.Server;
let activeYear = { id: 0, yearLabel: "" };
let teacherUserId = "";
let adminUserId = "";
let registrarUserId = "";
let teacherId = "";
let sectionId = "";
let subjectId = "";
let classAssignmentId = "";
let aimsCourseId = "";
let aimsUserId = "";
let sectionName = "";

let partAApp: express.Express;
let partBApp: express.Express;

function restoreEnv(key: keyof typeof originalEnv, value: string | undefined) {
  const envKey = {
    aimsExchangeUrl: "AIMS_SSO_EXCHANGE_URL",
    aimsClientId: "AIMS_SSO_CLIENT_ID",
    aimsClientSecret: "AIMS_SSO_CLIENT_SECRET",
    reverseCallback: "AIMS_SSO_REVERSE_CALLBACK_URL",
    reverseClientId: "AIMS_SSO_REVERSE_CLIENT_ID",
    reverseClientSecret: "AIMS_SSO_REVERSE_CLIENT_SECRET",
    reverseSchoolId: "AIMS_SSO_SCHOOL_ID",
  }[key];

  if (value === undefined) delete process.env[envKey];
  else process.env[envKey] = value;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function aimsSuccess(code: string) {
  const classContext = code.startsWith("section-id")
    ? {
        courseId: null,
        courseCode: null,
        subject: "Araling Panlipunan",
        gradeLevel: "Grade 7",
        sectionId: 501,
        sectionName,
      }
    : code.startsWith("section-name")
      ? {
          courseId: null,
          courseCode: null,
          subject: "Araling Panlipunan",
          gradeLevel: "Grade 7",
          sectionId: null,
          sectionName,
        }
      : {
          courseId: aimsCourseId,
          courseCode: "EP-81-AP",
          subject: "Araling Panlipunan",
          gradeLevel: "Grade 7",
          sectionId: 501,
          sectionName,
        };

  return {
    success: true,
    data: {
      identity: {
        id: aimsUserId,
        role: "TEACHER",
        firstName: "Aims",
        lastName: "Teacher",
        email: null,
        username: `aims-teacher-${suffix}`,
        lrn: null,
      },
      context: {
        school: { id: "1", name: "Test School", shortName: "TS" },
        term: { schoolYear: activeYear.yearLabel, termIndex: 2 },
        class: classContext,
        teacher: { userId: aimsUserId, employeeId: `aims-teacher-${suffix}` },
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

beforeAll(async () => {
  const year = await getActiveSchoolYear();
  if (year.externalId == null) {
    throw new Error("Test fixture is missing an active school year externalId.");
  }
  activeYear = { id: year.externalId, yearLabel: year.label };
  aimsUserId = `aims-user-${suffix}`;
  aimsCourseId = `aims-course-${suffix}`;
  sectionName = `Luna-${suffix}`;

  const teacherUser = await prisma.user.create({
    data: {
      username: `aims-teacher-${suffix}`,
      password: "hashed",
      role: "TEACHER",
      status: "ACTIVE",
      firstName: "Aims",
      lastName: "Teacher",
      teacher: {
        create: { employeeId: `aims-teacher-${suffix}` },
      },
    },
    include: { teacher: true },
  });
  teacherUserId = teacherUser.id;
  teacherId = teacherUser.teacher!.id;

  const adminUser = await prisma.user.create({
    data: {
      username: `aims-admin-${suffix}`,
      password: "hashed",
      role: "ADMIN",
      status: "ACTIVE",
      firstName: "Aims",
      lastName: "Admin",
    },
  });
  adminUserId = adminUser.id;

  const registrarUser = await prisma.user.create({
    data: {
      username: `aims-registrar-${suffix}`,
      password: "hashed",
      role: "REGISTRAR",
      status: "ACTIVE",
      firstName: "Aims",
      lastName: "Registrar",
    },
  });
  registrarUserId = registrarUser.id;

  const section = await prisma.section.create({
    data: {
      name: sectionName,
      gradeLevel: "GRADE_7",
      schoolYear: activeYear.yearLabel,
      enrollproSectionId: 501,
    },
  });
  sectionId = section.id;

  const subject = await prisma.subject.create({
    data: {
      code: `AIMS-AP-${suffix}`,
      name: "Araling Panlipunan 7",
      displayName: "Araling Panlipunan",
      type: "CORE",
    },
  });
  subjectId = subject.id;

  const assignment = await prisma.classAssignment.create({
    data: {
      teacherId,
      subjectId,
      sectionId,
      schoolYear: activeYear.yearLabel,
      aimsCourseId,
      isActive: true,
    },
  });
  classAssignmentId = assignment.id;

  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const code = String(parsed.code ?? "");

      if (code.startsWith("invalid")) {
        sendJson(res, 400, { success: false, error: "Invalid code.", code: "INVALID_CODE" });
        return;
      }
      if (code.startsWith("not-provisioned")) {
        sendJson(res, 200, {
          success: true,
          data: {
            identity: {
              id: `aims-missing-${suffix}`,
              role: "TEACHER",
              firstName: "Missing",
              lastName: "Teacher",
              email: null,
              username: `missing-${suffix}`,
              lrn: null,
            },
            context: { term: { schoolYear: activeYear.yearLabel, termIndex: 1 }, class: null },
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        });
        return;
      }
      if (code.startsWith("student")) {
        sendJson(res, 200, {
          success: true,
          data: {
            identity: {
              id: `aims-student-${suffix}`,
              role: "STUDENT",
              firstName: "Aims",
              lastName: "Student",
              email: null,
              username: `aims-student-${suffix}`,
              lrn: `LRN-${suffix}`,
            },
            context: { term: { schoolYear: activeYear.yearLabel, termIndex: 1 }, class: null },
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        });
        return;
      }
      if (code.startsWith("role-mismatch")) {
        sendJson(res, 200, {
          success: true,
          data: {
            identity: {
              id: `aims-admin-${suffix}`,
              role: "TEACHER",
              firstName: "Aims",
              lastName: "Admin",
              email: null,
              username: `aims-admin-${suffix}`,
              lrn: null,
            },
            context: { term: { schoolYear: activeYear.yearLabel, termIndex: 1 }, class: null },
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        });
        return;
      }

      sendJson(res, 200, aimsSuccess(code));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  process.env.AIMS_SSO_EXCHANGE_URL = `http://127.0.0.1:${port}/exchange`;
  process.env.AIMS_SSO_CLIENT_ID = "smart";
  process.env.AIMS_SSO_CLIENT_SECRET = TEST_SECRET;
  process.env.AIMS_SSO_REVERSE_CALLBACK_URL = TEST_AIMS_CALLBACK;
  process.env.AIMS_SSO_REVERSE_CLIENT_ID = "aims";
  process.env.AIMS_SSO_REVERSE_CLIENT_SECRET = TEST_SECRET;
  process.env.AIMS_SSO_SCHOOL_ID = "1";

  partAApp = express();
  partAApp.use(express.json());
  partAApp.use("/api/auth", aimsSsoRoutes);

  partBApp = express();
  partBApp.use(express.json());
  partBApp.use("/api/auth", aimsReverseSessionRouter);
  partBApp.use("/sso", aimsReverseAliasRouter);
});

afterAll(async () => {
  await prisma.classAssignment.deleteMany({ where: { id: classAssignmentId } });
  await prisma.section.deleteMany({ where: { id: sectionId } });
  await prisma.subject.deleteMany({ where: { id: subjectId } });
  await prisma.user.deleteMany({
    where: { id: { in: [teacherUserId, adminUserId, registrarUserId] } },
  });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  restoreEnv("aimsExchangeUrl", originalEnv.aimsExchangeUrl);
  restoreEnv("aimsClientId", originalEnv.aimsClientId);
  restoreEnv("aimsClientSecret", originalEnv.aimsClientSecret);
  restoreEnv("reverseCallback", originalEnv.reverseCallback);
  restoreEnv("reverseClientId", originalEnv.reverseClientId);
  restoreEnv("reverseClientSecret", originalEnv.reverseClientSecret);
  restoreEnv("reverseSchoolId", originalEnv.reverseSchoolId);
});

describe("AIMS -> SMART SSO", () => {
  it("reports configured when exchange URL and secret are set", () => {
    expect(getAimsSsoConfig().configured).toBe(true);
  });

  it("exchanges a teacher code and deep-links by AIMS course id", async () => {
    const result = await exchangeAimsCode(`valid-${suffix}-course`);

    expect(result.user.id).toBe(teacherUserId);
    expect(result.user.aimsUserId).toBe(aimsUserId);
    expect(result.redirectTo).toBe(`/teacher/records/${classAssignmentId}?term=T2`);
  });

  it("falls back to the EnrollPro section id, then section name", async () => {
    const bySectionId = await exchangeAimsCode(`section-id-${suffix}`);
    expect(bySectionId.redirectTo).toBe(`/teacher/records/${classAssignmentId}?term=T2`);

    const bySectionName = await exchangeAimsCode(`section-name-${suffix}`);
    expect(bySectionName.redirectTo).toBe(`/teacher/records/${classAssignmentId}?term=T2`);
  });

  it("rejects an invalid AIMS code", async () => {
    await expect(exchangeAimsCode(`invalid-${suffix}`)).rejects.toMatchObject({
      code: "INVALID_CODE",
      statusCode: 400,
    });
  });

  it("rejects a student identity because SMART has no student portal", async () => {
    await expect(exchangeAimsCode(`student-${suffix}`)).rejects.toMatchObject({
      code: "AIMS_STUDENT_UNSUPPORTED",
      statusCode: 403,
    });
  });

  it("returns the identity when no SMART account matches", async () => {
    await expect(exchangeAimsCode(`not-provisioned-${suffix}`)).rejects.toMatchObject({
      code: "AIMS_ACCOUNT_NOT_PROVISIONED",
      statusCode: 403,
      identity: { firstName: "Missing", lastName: "Teacher" },
    });
  });

  it("rejects an AIMS role that differs from the SMART account role", async () => {
    await expect(exchangeAimsCode(`role-mismatch-${suffix}`)).rejects.toMatchObject({
      code: "AIMS_ROLE_MISMATCH",
      statusCode: 403,
    });
  });

  it("returns the SPA session payload and redirect over HTTP", async () => {
    const response = await request(partAApp)
      .post("/api/auth/aims/exchange")
      .send({ code: `valid-route-${suffix}` })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(typeof response.body.token).toBe("string");
    expect(typeof response.body.refreshToken).toBe("string");
    expect(response.body.user.role).toBe("TEACHER");
    expect(response.body.redirectTo).toContain("/teacher/records/");
  });

  it("returns the stable error shape over HTTP", async () => {
    const response = await request(partAApp)
      .post("/api/auth/aims/exchange")
      .send({ code: `invalid-route-${suffix}` })
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      code: "INVALID_CODE",
    });
  });
});

describe("SMART -> AIMS SSO", () => {
  it("reports configured when the callback and reverse secret are set", () => {
    expect(getAimsReverseConfig().configured).toBe(true);
  });

  it("issues and exchanges a teacher code", async () => {
    await prisma.user.update({
      where: { id: teacherUserId },
      data: { aimsUserId: `aims-reverse-${suffix}` },
    });

    const { launchUrl } = await issueAimsReverseCode(teacherUserId);
    const parsed = new URL(launchUrl);
    const code = parsed.searchParams.get("code");
    expect(parsed.origin + parsed.pathname).toBe(TEST_AIMS_CALLBACK);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const result = await exchangeAimsReverseCode({
      clientId: "aims",
      clientSecret: TEST_SECRET,
      code,
    });

    expect(result.data.identity).toMatchObject({
      id: `aims-reverse-${suffix}`,
      role: "TEACHER",
      username: `aims-teacher-${suffix}`,
      lrn: null,
    });
    expect(result.data.context.school.id).toBe("1");
    expect(result.data.context.term.schoolYear).toBe(activeYear.yearLabel);
    expect(result.data.context.term.termIndex).toBe(1);
    expect(result.data.context.class).toBeNull();
  });

  it("rejects a reused code with 409", async () => {
    const { launchUrl } = await issueAimsReverseCode(teacherUserId);
    const code = new URL(launchUrl).searchParams.get("code")!;

    await exchangeAimsReverseCode({ clientId: "aims", clientSecret: TEST_SECRET, code });
    await expect(
      exchangeAimsReverseCode({ clientId: "aims", clientSecret: TEST_SECRET, code }),
    ).rejects.toMatchObject({ code: "CODE_ALREADY_USED", statusCode: 409 });
  });

  it("rejects an expired code with 410", async () => {
    const { launchUrl } = await issueAimsReverseCode(teacherUserId);
    const code = new URL(launchUrl).searchParams.get("code")!;
    const { hashCode } = await import("../lib/companionSso");

    await prisma.companionSsoCode.update({
      where: { codeHash: hashCode(code) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      exchangeAimsReverseCode({ clientId: "aims", clientSecret: TEST_SECRET, code }),
    ).rejects.toMatchObject({ code: "CODE_EXPIRED", statusCode: 410 });
  });

  it("rejects wrong client credentials with 401", async () => {
    const { launchUrl } = await issueAimsReverseCode(teacherUserId);
    const code = new URL(launchUrl).searchParams.get("code")!;

    await expect(
      exchangeAimsReverseCode({ clientId: "aims", clientSecret: "wrong-secret", code }),
    ).rejects.toMatchObject({ code: "INVALID_CLIENT", statusCode: 401 });
  });

  it("refuses to issue a code for a registrar", async () => {
    await expect(issueAimsReverseCode(registrarUserId)).rejects.toMatchObject({
      code: "ROLE_UNSUPPORTED",
      statusCode: 403,
    });
  });

  it("returns the exact AIMS success shape over the exchange route", async () => {
    const { launchUrl } = await issueAimsReverseCode(teacherUserId);
    const code = new URL(launchUrl).searchParams.get("code")!;

    const response = await request(partBApp)
      .post("/api/auth/aims/reverse/exchange")
      .set("x-aims-client-id", "aims")
      .set("x-aims-client-secret", TEST_SECRET)
      .send({ code })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.identity.role).toBe("TEACHER");
    expect(response.body.data.context.class).toBeNull();
    expect(response.body.userId).toBeUndefined();
  });

  it("serves the root alias used by AIMS configuration", async () => {
    const { launchUrl } = await issueAimsReverseCode(teacherUserId);
    const code = new URL(launchUrl).searchParams.get("code")!;

    const response = await request(partBApp)
      .post("/sso/aims/exchange")
      .set("x-aims-client-id", "aims")
      .set("x-aims-client-secret", TEST_SECRET)
      .send({ code })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.identity.username).toBe(`aims-teacher-${suffix}`);
  });

  it("returns the exact AIMS error shape", async () => {
    const response = await request(partBApp)
      .post("/api/auth/aims/reverse/exchange")
      .set("x-aims-client-id", "aims")
      .set("x-aims-client-secret", "wrong-secret")
      .send({ code: "A".repeat(43) })
      .expect(401);

    expect(response.body).toEqual({
      success: false,
      error: "Invalid AIMS SSO client credentials.",
      code: "INVALID_CLIENT",
    });
  });

  it("authorizes the AIMS launch for an authenticated teacher", async () => {
    const token = signAccessToken({
      id: teacherUserId,
      username: `aims-teacher-${suffix}`,
      role: "TEACHER",
    });

    const response = await request(partBApp)
      .post("/api/auth/aims/reverse/authorize")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.launchUrl).toContain(TEST_AIMS_CALLBACK);
  });
});
