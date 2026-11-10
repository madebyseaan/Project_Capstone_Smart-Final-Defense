/**
 * atlas-sso.test.ts
 *
 * Direct-function tests for the SMART -> ATLAS admin-only SSO service.
 * Seeds throwaway SMART accounts + codes and cleans up afterward.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import {
  exchangeAtlasCode,
  getAtlasSsoConfig,
  issueAtlasAuthorizationCode,
} from "../services/atlasSsoService";
import { CompanionSsoError } from "../lib/companionSso";

const TEST_SECRET = "test-atlas-secret-1234567890abcdef";
const TEST_CALLBACK = "http://localhost:5003/auth/smart/callback";
const TEST_START = "http://localhost:5003/auth/smart/start";

const originalEnv = {
  secret: process.env.ATLAS_SSO_CLIENT_SECRET,
  callback: process.env.ATLAS_SSO_CALLBACK_URL,
  start: process.env.ATLAS_SSO_START_URL,
};

let adminId = "";
let teacherId = "";

async function issueValidCode(state = "test-state"): Promise<string> {
  const { redirectUrl } = await issueAtlasAuthorizationCode(adminId, {
    responseType: "code",
    clientId: "smart",
    redirectUri: TEST_CALLBACK,
    state,
  });
  return new URL(redirectUrl).searchParams.get("code")!;
}

beforeAll(async () => {
  process.env.ATLAS_SSO_CLIENT_SECRET = TEST_SECRET;
  process.env.ATLAS_SSO_CALLBACK_URL = TEST_CALLBACK;
  process.env.ATLAS_SSO_START_URL = TEST_START;

  const admin = await prisma.user.create({
    data: {
      username: `atlas-sso-admin-${Date.now()}`,
      password: "hashed",
      role: "ADMIN",
      status: "ACTIVE",
      firstName: "Atlas",
      lastName: "Admin",
    },
  });
  adminId = admin.id;

  const teacher = await prisma.user.create({
    data: {
      username: `atlas-sso-teacher-${Date.now()}`,
      password: "hashed",
      role: "TEACHER",
      status: "ACTIVE",
      firstName: "Atlas",
      lastName: "Teacher",
    },
  });
  teacherId = teacher.id;
});

afterAll(async () => {
  await prisma.companionSsoCode.deleteMany({ where: { userId: { in: [adminId, teacherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, teacherId] } } });

  if (originalEnv.secret === undefined) delete process.env.ATLAS_SSO_CLIENT_SECRET;
  else process.env.ATLAS_SSO_CLIENT_SECRET = originalEnv.secret;

  if (originalEnv.callback === undefined) delete process.env.ATLAS_SSO_CALLBACK_URL;
  else process.env.ATLAS_SSO_CALLBACK_URL = originalEnv.callback;

  if (originalEnv.start === undefined) delete process.env.ATLAS_SSO_START_URL;
  else process.env.ATLAS_SSO_START_URL = originalEnv.start;
});

describe("ATLAS SSO — authorization", () => {
  it("reports configured when callback, secret, and start URL are set", () => {
    const config = getAtlasSsoConfig();
    expect(config.configured).toBe(true);
    expect(config.callback).toBe(TEST_CALLBACK);
    expect(config.startUrl).toBe(TEST_START);
  });

  it("issues a 43-char single-use code and echoes state unchanged", async () => {
    const { redirectUrl } = await issueAtlasAuthorizationCode(adminId, {
      responseType: "code",
      clientId: "smart",
      redirectUri: TEST_CALLBACK,
      state: "opaque-state-123",
    });
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe(TEST_CALLBACK);
    expect(url.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBe("opaque-state-123");
  });

  it("rejects non-admin SMART accounts", async () => {
    await expect(issueAtlasAuthorizationCode(teacherId, {
      responseType: "code",
      clientId: "smart",
      redirectUri: TEST_CALLBACK,
      state: "teacher-state",
    })).rejects.toMatchObject({ code: "COMPANION_REVERSE_SSO_ROLE_DENIED" });
  });

  it("rejects unknown clients, unregistered redirect URIs, and missing state", async () => {
    await expect(issueAtlasAuthorizationCode(adminId, {
      responseType: "code",
      clientId: "atlas",
      redirectUri: TEST_CALLBACK,
      state: "s",
    })).rejects.toThrowError(CompanionSsoError);

    await expect(issueAtlasAuthorizationCode(adminId, {
      responseType: "code",
      clientId: "smart",
      redirectUri: "https://evil.example/callback",
      state: "s",
    })).rejects.toThrowError(CompanionSsoError);

    await expect(issueAtlasAuthorizationCode(adminId, {
      responseType: "code",
      clientId: "smart",
      redirectUri: TEST_CALLBACK,
      state: "",
    })).rejects.toThrowError(CompanionSsoError);
  });
});

describe("ATLAS SSO — exchange", () => {
  it("returns the SMART admin identity assertion for a valid code", async () => {
    const code = await issueValidCode("state-a");
    const result = await exchangeAtlasCode({
      bearer: TEST_SECRET,
      code,
      clientId: "smart",
      redirectUri: TEST_CALLBACK,
    });

    expect(result.success).toBe(true);
    expect(result.issuer).toBe("SMART");
    expect(result.identity.subject).toBe(`SMART_USER:${adminId}`);
    expect(result.identity.roles).toEqual(["SYSTEM_ADMIN"]);
    expect(result.identity.accountName).toBeTruthy();
    expect(result.activeSchoolYear.id).toBeTypeOf("number");
    expect(result.activeSchoolYear.yearLabel).toMatch(/^\d{4}-\d{4}$/);
  });

  it("consumes the code exactly once (replay rejected)", async () => {
    const code = await issueValidCode("state-b");
    await exchangeAtlasCode({ bearer: TEST_SECRET, code, clientId: "smart", redirectUri: TEST_CALLBACK });
    await expect(exchangeAtlasCode({
      bearer: TEST_SECRET,
      code,
      clientId: "smart",
      redirectUri: TEST_CALLBACK,
    })).rejects.toMatchObject({ code: "COMPANION_SSO_CODE_INVALID" });
  });

  it("rejects a wrong bearer secret", async () => {
    const code = await issueValidCode("state-c");
    await expect(exchangeAtlasCode({
      bearer: "wrong-secret",
      code,
      clientId: "smart",
      redirectUri: TEST_CALLBACK,
    })).rejects.toMatchObject({ code: "COMPANION_SSO_CLIENT_INVALID" });
  });

  it("rejects a mismatched redirect URI or client id", async () => {
    const code = await issueValidCode("state-d");
    await expect(exchangeAtlasCode({
      bearer: TEST_SECRET,
      code,
      clientId: "smart",
      redirectUri: "https://evil.example/callback",
    })).rejects.toMatchObject({ code: "COMPANION_SSO_CODE_INVALID" });
  });

  it("rejects expired codes", async () => {
    const code = await issueValidCode("state-e");
    await prisma.companionSsoCode.updateMany({
      where: { userId: adminId, audience: "atlas" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(exchangeAtlasCode({
      bearer: TEST_SECRET,
      code,
      clientId: "smart",
      redirectUri: TEST_CALLBACK,
    })).rejects.toMatchObject({ code: "COMPANION_SSO_CODE_INVALID" });
  });

  it("rejects inactive accounts", async () => {
    const code = await issueValidCode("state-f");
    await prisma.user.update({ where: { id: adminId }, data: { status: "SUSPENDED" } });
    try {
      await expect(exchangeAtlasCode({
        bearer: TEST_SECRET,
        code,
        clientId: "smart",
        redirectUri: TEST_CALLBACK,
      })).rejects.toMatchObject({ code: "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE" });
    } finally {
      await prisma.user.update({ where: { id: adminId }, data: { status: "ACTIVE" } });
    }
  });

  it("rejects a role change after the code is issued", async () => {
    const code = await issueValidCode("state-g");
    await prisma.user.update({ where: { id: adminId }, data: { role: "TEACHER" } });
    try {
      await expect(exchangeAtlasCode({
        bearer: TEST_SECRET,
        code,
        clientId: "smart",
        redirectUri: TEST_CALLBACK,
      })).rejects.toMatchObject({ code: "COMPANION_REVERSE_SSO_ROLE_DENIED" });
    } finally {
      await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
    }
  });
});
