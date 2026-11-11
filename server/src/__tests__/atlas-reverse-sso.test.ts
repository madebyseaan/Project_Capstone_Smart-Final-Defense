/**
 * atlas-reverse-sso.test.ts
 *
 * Tests for the ATLAS -> SMART reverse SSO service: state signing, ATLAS
 * exchange validation, account linking, and school-year matching.
 */
import http from "http";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../lib/prisma";
import { getActiveSchoolYear } from "../lib/schoolYearResolver";
import {
  createAtlasReverseState,
  exchangeAtlasReverseCode,
  getAtlasReverseConfig,
  isValidAtlasReverseState,
  resolveAtlasReverseUser,
  validateAtlasReverseSchoolYear,
} from "../services/atlasReverseSsoService";

const TEST_SECRET = "test-atlas-reverse-secret-1234567890";
const TEST_AUTHORIZE = "http://localhost:5998/auth/smart/authorize";
const TEST_CALLBACK = "http://localhost:5003/auth/atlas/callback";

const originalEnv = {
  authorize: process.env.ATLAS_SSO_REVERSE_AUTHORIZE_URL,
  exchange: process.env.ATLAS_SSO_REVERSE_EXCHANGE_URL,
  callback: process.env.ATLAS_SSO_REVERSE_CALLBACK_URL,
  secret: process.env.ATLAS_SSO_REVERSE_CLIENT_SECRET,
  aliasSecret: process.env.ATLAS_SMART_SSO_REVERSE_CLIENT_SECRET,
};

let server: http.Server;
let adminId = "";
let teacherId = "";
let lastAuthorization = "";
let lastBody = "";
let activeYear = { id: 0, yearLabel: "" };

function assertion(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    issuer: "ATLAS",
    identity: {
      subject: "ATLAS_USER:test-admin",
      employeeId: "ATLAS-001",
      lrn: null,
      accountName: "atlas-admin",
      email: "atlas-admin@example.test",
      firstName: "Atlas",
      middleName: null,
      lastName: "Admin",
      roles: ["SYSTEM_ADMIN"],
    },
    activeSchoolYear: activeYear,
    authenticatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

beforeAll(async () => {
  process.env.ATLAS_SSO_REVERSE_AUTHORIZE_URL = TEST_AUTHORIZE;
  process.env.ATLAS_SSO_REVERSE_CALLBACK_URL = TEST_CALLBACK;
  process.env.ATLAS_SSO_REVERSE_CLIENT_SECRET = TEST_SECRET;
  delete process.env.ATLAS_SMART_SSO_REVERSE_CLIENT_SECRET;

  const year = await getActiveSchoolYear();
  if (year.externalId == null) {
    throw new Error("Test fixture is missing an active school year externalId.");
  }
  activeYear = { id: year.externalId, yearLabel: year.label };

  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      lastAuthorization = req.headers.authorization ?? "";
      lastBody = body;
      const parsed = JSON.parse(body || "{}");

      if (parsed.code === "atlas-error") {
        sendJson(res, 401, { code: "COMPANION_SSO_CODE_INVALID", message: "The code is invalid." });
        return;
      }
      if (parsed.code === "wrong-issuer") {
        sendJson(res, 200, assertion({ issuer: "ENROLLPRO" }));
        return;
      }
      if (parsed.code === "teacher-role") {
        sendJson(res, 200, assertion({
          identity: { ...assertion().identity, roles: ["TEACHER"] },
        }));
        return;
      }
      sendJson(res, 200, assertion());
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env.ATLAS_SSO_REVERSE_EXCHANGE_URL = `http://127.0.0.1:${port}/exchange`;

  const admin = await prisma.user.create({
    data: {
      username: `atlas-reverse-admin-${Date.now()}`,
      password: "hashed",
      role: "ADMIN",
      status: "ACTIVE",
      firstName: "Atlas",
      lastName: "Admin",
      atlasSubject: "ATLAS_USER:test-admin",
    },
  });
  adminId = admin.id;

  const teacher = await prisma.user.create({
    data: {
      username: `atlas-reverse-teacher-${Date.now()}`,
      password: "hashed",
      role: "TEACHER",
      status: "ACTIVE",
      firstName: "Atlas",
      lastName: "Teacher",
      atlasSubject: "ATLAS_USER:test-teacher",
    },
  });
  teacherId = teacher.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [adminId, teacherId] } } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  if (originalEnv.authorize === undefined) delete process.env.ATLAS_SSO_REVERSE_AUTHORIZE_URL;
  else process.env.ATLAS_SSO_REVERSE_AUTHORIZE_URL = originalEnv.authorize;

  if (originalEnv.exchange === undefined) delete process.env.ATLAS_SSO_REVERSE_EXCHANGE_URL;
  else process.env.ATLAS_SSO_REVERSE_EXCHANGE_URL = originalEnv.exchange;

  if (originalEnv.callback === undefined) delete process.env.ATLAS_SSO_REVERSE_CALLBACK_URL;
  else process.env.ATLAS_SSO_REVERSE_CALLBACK_URL = originalEnv.callback;

  if (originalEnv.secret === undefined) delete process.env.ATLAS_SSO_REVERSE_CLIENT_SECRET;
  else process.env.ATLAS_SSO_REVERSE_CLIENT_SECRET = originalEnv.secret;

  if (originalEnv.aliasSecret === undefined) delete process.env.ATLAS_SMART_SSO_REVERSE_CLIENT_SECRET;
  else process.env.ATLAS_SMART_SSO_REVERSE_CLIENT_SECRET = originalEnv.aliasSecret;
});

describe("ATLAS reverse SSO — configuration and state", () => {
  it("reports configured when authorize, exchange, callback, and secret are set", () => {
    const config = getAtlasReverseConfig();
    expect(config.configured).toBe(true);
    expect(config.authorizeUrl).toBe(TEST_AUTHORIZE);
    expect(config.callbackUrl).toBe(TEST_CALLBACK);
    expect(config.exchangeUrl).toContain("/exchange");
  });

  it("accepts a matching signed state and rejects tampering", () => {
    const state = createAtlasReverseState();
    expect(isValidAtlasReverseState(state, state)).toBe(true);
    expect(isValidAtlasReverseState(`${state}x`, state)).toBe(false);
    expect(isValidAtlasReverseState(state, `${state}x`)).toBe(false);
    expect(isValidAtlasReverseState(state, undefined)).toBe(false);
  });

  it("rejects expired state", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
      const state = createAtlasReverseState();
      vi.setSystemTime(new Date("2026-11-11T00:06:00Z"));
      expect(isValidAtlasReverseState(state, state)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ATLAS reverse SSO — exchange", () => {
  it("sends the shared secret and accepts a SYSTEM_ADMIN assertion", async () => {
    const result = await exchangeAtlasReverseCode({
      code: "valid-code",
      redirectUri: TEST_CALLBACK,
    });

    expect(result.subject).toBe("ATLAS_USER:test-admin");
    expect(result.roles).toEqual(["SYSTEM_ADMIN"]);
    expect(result.activeSchoolYear).toEqual(activeYear);
    expect(lastAuthorization).toBe(`Bearer ${TEST_SECRET}`);

    const body = JSON.parse(lastBody);
    expect(body).toEqual({
      code: "valid-code",
      clientId: "smart",
      redirectUri: TEST_CALLBACK,
    });
  });

  it("rejects a non-ATLAS issuer", async () => {
    await expect(exchangeAtlasReverseCode({
      code: "wrong-issuer",
      redirectUri: TEST_CALLBACK,
    })).rejects.toMatchObject({ code: "COMPANION_REVERSE_SSO_RESPONSE_INVALID" });
  });

  it("rejects a non-admin role", async () => {
    await expect(exchangeAtlasReverseCode({
      code: "teacher-role",
      redirectUri: TEST_CALLBACK,
    })).rejects.toMatchObject({ code: "COMPANION_REVERSE_SSO_ROLE_DENIED" });
  });

  it("passes through a known ATLAS exchange error", async () => {
    await expect(exchangeAtlasReverseCode({
      code: "atlas-error",
      redirectUri: TEST_CALLBACK,
    })).rejects.toMatchObject({ code: "COMPANION_SSO_CODE_INVALID", statusCode: 401 });
  });
});

describe("ATLAS reverse SSO — account linking", () => {
  it("resolves the explicitly linked SMART admin", async () => {
    const user = await resolveAtlasReverseUser("ATLAS_USER:test-admin");
    expect(user.id).toBe(adminId);
    expect(user.role).toBe("ADMIN");
  });

  it("denies an unlinked ATLAS subject", async () => {
    await expect(resolveAtlasReverseUser("ATLAS_USER:unlinked")).rejects.toMatchObject({
      code: "COMPANION_REVERSE_SSO_LINK_REQUIRED",
    });
  });

  it("denies a linked non-admin account", async () => {
    await expect(resolveAtlasReverseUser("ATLAS_USER:test-teacher")).rejects.toMatchObject({
      code: "COMPANION_REVERSE_SSO_ROLE_DENIED",
    });
  });

  it("denies an inactive linked account", async () => {
    await prisma.user.update({ where: { id: adminId }, data: { status: "SUSPENDED" } });
    try {
      await expect(resolveAtlasReverseUser("ATLAS_USER:test-admin")).rejects.toMatchObject({
        code: "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE",
      });
    } finally {
      await prisma.user.update({ where: { id: adminId }, data: { status: "ACTIVE" } });
    }
  });
});

describe("ATLAS reverse SSO — school year", () => {
  it("accepts the matching active year", async () => {
    await expect(validateAtlasReverseSchoolYear(activeYear)).resolves.toBeUndefined();
  });

  it("rejects a mismatched active year", async () => {
    await expect(validateAtlasReverseSchoolYear({ id: 1, yearLabel: "1999-2000" })).rejects.toMatchObject({
      code: "ACTIVE_SCHOOL_YEAR_CONFLICT",
    });
  });
});
